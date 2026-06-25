/**
 * Message Service
 * @file scripts/services/MessageService.js
 * @module cyberpunkred-messenger
 * @description Core messaging business logic. Handles send/receive/reply/forward/delete
 * with GM-relayed delivery pipeline. All message delivery flows through the GM's client
 * for permission safety.
 */

import { MODULE_ID, EVENTS, SOCKET_OPS } from '../utils/constants.js';
import { DataValidator } from '../data/DataValidator.js';
import { log } from '../utils/helpers.js';

export class MessageService {
  constructor() {
    /** @type {Array} Local message queue for dead zone / GM offline */
    this._messageQueue = [];
  }

  // ─── Service Accessors (all via namespace — never constructor-injected) ──

  get _messageRepo() { return game.nightcity.messageRepository; }
  get _contactRepo() { return game.nightcity.contactRepository; }
  get eventBus() { return game.nightcity.eventBus; }
  get socketManager() { return game.nightcity.socketManager; }
  get timeService() { return game.nightcity.timeService; }
  get soundService() { return game.nightcity.soundService; }
  get notificationService() { return game.nightcity.notificationService; }
  get iceService() { return game.nightcity?.iceService; }

  // ─── Send Pipeline ────────────────────────────────────────

  /**
   * Send a message. Routes through GM relay for delivery.
   * @param {Object} data - Message data
   * @param {string} data.toActorId - Recipient actor ID
   * @param {string} data.fromActorId - Sender actor ID  
   * @param {string} data.subject
   * @param {string} data.body
   * @param {string} [data.priority='normal']
   * @param {string} [data.inReplyTo] - Parent message ID for threading
   * @param {string} [data.threadId] - Thread group ID
   * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
   */
  async sendMessage(data) {
    try {
      // Validate
      const validation = DataValidator.validateMessage(data);
      if (!validation.valid) {
        return { success: false, error: validation.errors.join(', ') };
      }

      // Sanitize body
      data.body = DataValidator.sanitizeBody(data.body);

      // ── Resolve sender identity ──
      const fromActor = data.fromActorId ? game.actors.get(data.fromActorId) : null;
      const fromContact = !fromActor && data.fromContactId
        ? game.nightcity?.masterContactService?.getContact(data.fromContactId)
        : null;

      // GM can send as a master contact without a linked actor
      if (!fromActor && !fromContact && !game.user.isGM) {
        return { success: false, error: 'Sender actor not found' };
      }

      // ── Resolve recipient identity ──
      // Try actorId first, then contactId, then email lookup
      let toActor = data.toActorId ? game.actors.get(data.toActorId) : null;
      let toContact = null;
      let recipientInboxId = data.toActorId; // The ID used for inbox storage

      if (!toActor) {
        // Try resolving via contactId
        if (data.toContactId) {
          toContact = game.nightcity?.masterContactService?.getContact(data.toContactId);
          if (toContact) {
            // If the contact has a linked actor, use that
            if (toContact.actorId) {
              toActor = game.actors.get(toContact.actorId);
              data.toActorId = toContact.actorId;
              recipientInboxId = toContact.actorId;
            } else {
              recipientInboxId = data.toContactId;
            }
          }
        }
        // Try resolving via email in master contacts
        if (!toActor && !toContact && data.to) {
          toContact = game.nightcity?.masterContactService?.getByEmail(data.to);
          if (toContact) {
            data.toContactId = toContact.id;
            if (toContact.actorId) {
              toActor = game.actors.get(toContact.actorId);
              data.toActorId = toContact.actorId;
              recipientInboxId = toContact.actorId;
            } else {
              recipientInboxId = toContact.id;
            }
          }
        }

        if (!toActor && !toContact) {
          return { success: false, error: 'Recipient not found — no matching actor or contact.' };
        }
      }

      // Store the resolved inbox target for delivery
      data._recipientInboxId = recipientInboxId;

      // ── Contact Verification Gate (players only) ──
      // Players can only send to contacts that exist in the GM's Master Contact Directory.
      const requireVerification = game.settings.get(MODULE_ID, 'requireContactVerification') ?? true;

      if (!game.user.isGM && requireVerification) {
        const masterService = game.nightcity?.masterContactService;
        const recipientEmail = data.to || (toActor ? this._contactRepo.getActorEmail(data.toActorId) : toContact?.email);

        // Verified if the recipient is in the master directory OR is a registered
        // actor (verifyContact checks both — matches the setting hint). The actorId
        // branch additionally covers master contacts linked by actor without an email.
        const verified = this._contactRepo.verifyContact(recipientEmail).verified
          || !!masterService?.getAll?.()?.find(mc => mc.actorId === data.toActorId);

        if (!verified) {
          return {
            success: false,
            error: 'CONTACT NOT FOUND — Recipient not registered in the network directory.',
            errorCode: 'NO_CONTACT',
          };
        }
      }

      // ── Resolve email addresses ──
      if (!data.from) {
        if (fromActor) {
          data.from = this._contactRepo.getActorEmail(data.fromActorId)
            || `${fromActor.name.toLowerCase().replace(/\s+/g, '.')}@nightcity.net`;
        } else if (fromContact) {
          data.from = fromContact.email || `${fromContact.name.toLowerCase().replace(/\s+/g, '.')}@nightcity.net`;
        } else {
          data.from = data.fromName
            ? `${data.fromName.toLowerCase().replace(/\s+/g, '.')}@nightcity.net`
            : 'unknown@nightcity.net';
        }
      }
      if (!data.to) {
        if (toActor) {
          data.to = this._contactRepo.getActorEmail(data.toActorId)
            || `${toActor.name.toLowerCase().replace(/\s+/g, '.')}@nightcity.net`;
        } else if (toContact) {
          data.to = toContact.email || `${toContact.name.toLowerCase().replace(/\s+/g, '.')}@nightcity.net`;
        }
      }

      // ── Preserve proper-cased display names ──
      // Stored alongside the lowercased email so names survive actor deletion
      if (!data.fromName) {
        data.fromName = fromActor?.name || fromContact?.name || null;
      }
      if (!data.toName) {
        data.toName = toActor?.name || toContact?.name || null;
      }

      // Generate IDs
      const messageId = foundry.utils.randomID();
      data.messageId = messageId;
      if (!data.threadId) {
        // Prefer the conversation root (first reference), then the direct parent,
        // else start a new thread rooted at this message. Never leave it undefined —
        // an undefined threadId would orphan a reply/forward from its conversation.
        data.threadId = (Array.isArray(data.references) && data.references[0])
          || data.inReplyTo
          || messageId;
      }

      // ── Network access control stamping ──
      const networkService = game.nightcity.networkService;
      const accessControl = networkService?.getMessageAccessControl() ?? null;
      if (accessControl) {
        data.accessControl = accessControl;
      }

      // ── Signal degradation stamping (low signal = garbled body) ──
      const signalStrength = networkService?.signalStrength ?? 100;
      if (signalStrength < 50) {
        data.signalDegradation = {
          originalSignal: signalStrength,
          corruptionLevel: signalStrength < 20 ? 'heavy' : 'moderate',
          reconstructed: false,
          reconstructDC: signalStrength < 20 ? 18 : 13,
          reconstructSkill: 'Electronics/Security Tech',
        };
      }

      data.network = networkService?.currentNetworkId || data.network || 'CITINET';
      data.timestamp = this._getTimestamp();

      if (game.user.isGM) {
        return this._deliverMessage(data);
      }

      return this._relayMessage(data);
    } catch (error) {
      console.error(`${MODULE_ID} | MessageService.sendMessage:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Direct delivery (GM client). Creates message in recipient's inbox
   * and a sent copy in sender's outbox.
   * Supports both actor-backed and contact-only inboxes.
   * @param {Object} data
   * @returns {Promise<{success: boolean, messageId?: string}>}
   */
  async _deliverMessage(data) {
    try {
      // Resolve recipient inbox: actorId, contactId, or pre-resolved _recipientInboxId
      const recipientInboxId = data._recipientInboxId || data.toActorId || data.toContactId;
      if (!recipientInboxId) {
        return { success: false, error: 'No recipient inbox target' };
      }

      // Unknown-sender spam filtering — may route this message to the player's
      // Spam folder instead of the Inbox (and suppress the new-message toast).
      let spamFiltered = false;
      try {
        spamFiltered = await this._shouldSpamFilter(data);
      } catch (err) {
        console.warn(`${MODULE_ID} | spam-filter check failed:`, err);
      }
      if (spamFiltered) {
        data.status = { ...(data.status || {}), spam: true };
      }

      // Create message in recipient's inbox
      const result = await this._messageRepo.createMessage(recipientInboxId, data);
      if (!result.success) return result;

      // Create sent copy in sender's outbox
      // Resolve sender inbox: actor or contact
      const senderInboxId = data.fromActorId || data.fromContactId;
      if (senderInboxId) {
        const sentCopy = {
          ...data,
          messageId: `${data.messageId}-sent`,
          status: { sent: true, read: true, eddiesClaimed: true },
        };
        delete sentCopy._recipientInboxId; // Don't persist internal field
        await this._messageRepo.createMessage(senderInboxId, sentCopy);
      }

      // Emit events
      this.eventBus.emit(EVENTS.MESSAGE_SENT, {
        messageId: data.messageId,
        toActorId: data.toActorId,
        toContactId: data.toContactId,
        fromActorId: data.fromActorId,
        fromContactId: data.fromContactId,
        network: data.network,
        subject: data.subject,
        fromActorName: game.actors?.get(data.fromActorId)?.name ?? data.fromContactId ?? 'Unknown',
        toActorName: game.actors?.get(data.toActorId)?.name ?? data.toContactId ?? 'Unknown',
      });

      // Notify recipient via socket (only for actor-backed recipients — contacts are GM-local).
      // Spam-filtered mail is delivered silently so the player discovers it in Spam.
      if (data.toActorId && !spamFiltered) {
        this.socketManager.emit(SOCKET_OPS.MESSAGE_NOTIFY, {
          messageId: data.messageId,
          toActorId: data.toActorId,
          fromActorId: data.fromActorId,
          fromContactId: data.fromContactId,
          from: data.from,
          fromName: data.fromName,
          subject: data.subject,
          priority: data.priority || 'normal',
          preview: data.body?.substring(0, 100) || '',
        });
      }

      // Play send sound
      this.soundService?.play('send');

      // GM awareness: toast when a player messages an NPC. Delivery always runs
      // on the GM client, so the GM never gets the recipient's socket toast for
      // NPC-directed mail — this is the only path that surfaces it.
      this._notifyGmOfNpcMail({ ...data, _recipientInboxId: recipientInboxId });

      console.log(`${MODULE_ID} | Message ${data.messageId} delivered to inbox ${recipientInboxId}`);
      return { success: true, messageId: data.messageId };
    } catch (error) {
      console.error(`${MODULE_ID} | MessageService._deliverMessage:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Relay message through GM via socket (player client).
   * @param {Object} data
   * @returns {Promise<{success: boolean, messageId?: string}>}
   */
  async _relayMessage(data) {
    try {
      // Check if GM is online
      const gmUser = game.users.find(u => u.isGM && u.active);
      if (!gmUser) {
        // Queue for later delivery
        this._queueMessage(data);
        ui.notifications.warn('GM is offline. Message queued for delivery.');
        return { success: true, messageId: data.messageId, queued: true };
      }

      // Emit relay request via socket
      this.socketManager.emit(SOCKET_OPS.MESSAGE_RELAY, data);

      // Optimistic: play send sound
      this.soundService?.play('send');

      return { success: true, messageId: data.messageId };
    } catch (error) {
      console.error(`${MODULE_ID} | MessageService._relayMessage:`, error);
      this._queueMessage(data);
      return { success: false, error: error.message };
    }
  }

  /**
   * GM-only: surface a toast when a player sends mail to an NPC.
   * Runs on the delivering GM client. No-op for NPC→player, NPC→NPC, or
   * GM-composed mail, and respects the `notifyGmNpcMail` setting.
   * @param {Object} data — delivered message data (with _recipientInboxId)
   * @private
   */
  _notifyGmOfNpcMail(data) {
    try {
      if (!game.user.isGM) return;

      let enabled = true;
      try { enabled = game.settings.get(MODULE_ID, 'notifyGmNpcMail'); } catch { enabled = true; }
      if (!enabled) return;

      // Sender must be a player-owned character.
      const fromActor = data.fromActorId ? game.actors.get(data.fromActorId) : null;
      if (!fromActor?.hasPlayerOwner) return;

      // Recipient must be an NPC: a non-player actor, or a contact-only inbox.
      const toActor = data.toActorId ? game.actors.get(data.toActorId) : null;
      const recipientIsNpc = toActor ? !toActor.hasPlayerOwner : true;
      if (!recipientIsNpc) return;

      const recipientInboxId = data._recipientInboxId || data.toActorId || data.toContactId;
      if (!recipientInboxId) return;

      const recipientName = data.toName
        || toActor?.name
        || (data.toContactId && game.nightcity?.masterContactService?.getContact(data.toContactId)?.name)
        || data.to
        || 'NPC';
      const senderName = data.fromName || fromActor.name || data.from || 'A player';

      this.notificationService?.showNpcMailNotification({
        recipientInboxId,
        recipientName,
        senderName,
        subject: data.subject,
        messageId: data.messageId,
        priority: data.priority || 'normal',
      });
    } catch (error) {
      console.warn(`${MODULE_ID} | MessageService._notifyGmOfNpcMail:`, error);
    }
  }

  /**
   * Decide whether an inbound message should be routed to the recipient's Spam
   * folder because it's from a sender they haven't added as a contact.
   * GM-side (delivery always runs on the GM). Probabilistic + configurable.
   * @param {Object} data — message data being delivered
   * @returns {Promise<boolean>}
   * @private
   */
  async _shouldSpamFilter(data) {
    // `bail` logs the reason (visible with debugMode on) and returns false so a
    // GM can see exactly why a message did or didn't land in Spam.
    const bail = (reason) => { log.debug(`SpamFilter: skip — ${reason}`, { from: data.from, to: data.toActorId }); return false; };

    // Master toggle
    let enabled = false;
    try { enabled = game.settings.get(MODULE_ID, 'spamUnknownSenderEnabled'); } catch { return bail('settings unavailable'); }
    if (!enabled) return bail('filter disabled');

    // Only normal inbound mail to a player-owned actor (players check Spam).
    const toActor = data.toActorId ? game.actors.get(data.toActorId) : null;
    if (!toActor?.hasPlayerOwner) return bail('recipient is not a player-owned actor');
    if (data.status?.sent || data.status?.spam) return bail('already sent/spam');
    if (data.isBroadcast || data.type === 'broadcast') return bail('broadcast');

    // Optionally never filter messages from other player characters (party comms).
    const fromActor = data.fromActorId ? game.actors.get(data.fromActorId) : null;
    let excludePlayers = true;
    try { excludePlayers = game.settings.get(MODULE_ID, 'spamUnknownSenderExcludePlayers'); } catch { /* default */ }
    if (excludePlayers && fromActor?.hasPlayerOwner) return bail('sender is a player character (excludePlayers on)');

    // If the recipient has already added this sender, never filter.
    if (await this._isSenderInRecipientContacts(data.toActorId, data)) return bail('sender already in recipient contacts');

    // Scope: 'known' requires the sender to exist as a real contact — a master
    // directory entry (by id or email) or a registered character ("a contact
    // exists but isn't added"). 'all' also catches completely unknown addresses.
    let scope = 'known';
    try { scope = game.settings.get(MODULE_ID, 'spamUnknownSenderScope') || 'known'; } catch { /* default */ }
    if (scope === 'known') {
      const knownSender = !!fromActor
        || !!data.fromContactId
        || (!!data.from && !!this._contactRepo?.verifyContact(data.from)?.verified);
      if (!knownSender) return bail("scope 'known' and sender not in directory (use scope 'all' for unknown addresses)");
    }

    // Roll the configured chance.
    let chance = 0;
    try { chance = Number(game.settings.get(MODULE_ID, 'spamUnknownSenderChance')) || 0; } catch { return bail('chance setting unavailable'); }
    if (chance <= 0) return bail('chance is 0');
    const filtered = (Math.random() * 100) < chance;
    log.debug(`SpamFilter: ${filtered ? 'ROUTE TO SPAM' : 'pass'} (chance ${chance}%)`, { from: data.from, to: data.toActorId });
    return filtered;
  }

  /**
   * Whether the recipient has the sender saved as a contact (by email, linked
   * actor, or master-contact id).
   * @param {string} recipientActorId
   * @param {Object} data — message data (from, fromActorId, fromContactId)
   * @returns {Promise<boolean>}
   * @private
   */
  async _isSenderInRecipientContacts(recipientActorId, data) {
    try {
      const contacts = await this._contactRepo.getContacts(recipientActorId);
      if (!contacts.length) return false;
      const email = (data.from || '').toLowerCase().trim();
      const fromActorId = data.fromActorId || null;
      const fromContactId = data.fromContactId || null;
      return contacts.some(c =>
        (email && c.email?.toLowerCase().trim() === email) ||
        (fromActorId && (c.actorId === fromActorId || c.linkedActorId === fromActorId)) ||
        (fromContactId && c.masterContactId === fromContactId)
      );
    } catch {
      return false;
    }
  }

  // ─── Message Queue (Dead Zone / GM Offline) ───────────────

  /**
   * Queue a message for later delivery.
   * @param {Object} data
   */
  _queueMessage(data) {
    this._messageQueue.push({
      ...data,
      _queuedAt: new Date().toISOString(),
    });
    console.log(`${MODULE_ID} | Message queued. Queue size: ${this._messageQueue.length}`);
  }

  /**
   * Flush the message queue (called on reconnect / dead zone exit).
   * Messages are sent with 150ms stagger for the arrival animation.
   */
  async flushQueue() {
    if (this._messageQueue.length === 0) return;

    const queue = [...this._messageQueue];
    this._messageQueue = [];

    console.log(`${MODULE_ID} | Flushing ${queue.length} queued messages`);

    for (let i = 0; i < queue.length; i++) {
      if (i > 0) await this._delay(150);
      await this.sendMessage(queue[i]);
    }

    this.eventBus.emit(EVENTS.QUEUE_FLUSHED, { count: queue.length });
  }

  /** @returns {number} */
  get queueSize() { return this._messageQueue.length; }

  // ─── Reply / Forward ──────────────────────────────────────

  /**
   * Build reply data from an original message.
   * Handles both actor-backed and contact-only senders.
   * @param {Object} originalMessage
   * @param {string} fromActorId - The replying actor
   * @param {string} replyBody
   * @returns {Object} Message data ready for sendMessage()
   */
  buildReply(originalMessage, fromActorId, replyBody) {
    const reply = {
      fromActorId,
      subject: originalMessage.subject?.startsWith('RE: ')
        ? originalMessage.subject
        : `RE: ${originalMessage.subject || '(no subject)'}`,
      body: replyBody,
      threadId: originalMessage.threadId,
      inReplyTo: originalMessage.messageId,
      references: this._buildReferences(originalMessage),
      priority: 'normal',
    };

    // Resolve reply target — actor or contact
    if (originalMessage.fromActorId) {
      reply.toActorId = originalMessage.fromActorId;
    } else if (originalMessage.fromContactId) {
      reply.toContactId = originalMessage.fromContactId;
      reply.to = originalMessage.from; // Use the email directly
    } else if (originalMessage.from) {
      // Last resort: try to find by email
      reply.to = originalMessage.from;
    }

    return reply;
  }

  /**
   * Build forward data from an original message.
   * @param {Object} originalMessage
   * @param {string} fromActorId - The forwarding actor
   * @param {string} toActorId - New recipient
   * @param {string} [forwardBody] - Optional added text above forwarded content
   * @returns {Object}
   */
  buildForward(originalMessage, fromActorId, toActorId, forwardBody = '') {
    const divider = '\n\n--- Forwarded Message ---\n';
    const header = `From: ${originalMessage.from}\nTo: ${originalMessage.to}\nDate: ${originalMessage.timestamp}\nSubject: ${originalMessage.subject}\n\n`;

    return {
      toActorId,
      fromActorId,
      subject: originalMessage.subject?.startsWith('FWD: ')
        ? originalMessage.subject
        : `FWD: ${originalMessage.subject || '(no subject)'}`,
      body: forwardBody + divider + header + (originalMessage.body || ''),
      // Keep forwards attached to the conversation they came from. The new
      // recipient simply sees a single-message thread until they reply.
      threadId: originalMessage.threadId,
      inReplyTo: originalMessage.messageId,
      references: this._buildReferences(originalMessage),
      priority: 'normal',
    };
  }

  /**
   * Append the parent message to its ancestor chain (base ids, no "-sent" twin),
   * de-duplicated. Powers robust thread reconstruction across replies + forwards.
   * @param {Object} originalMessage
   * @returns {string[]}
   */
  _buildReferences(originalMessage) {
    const refs = Array.isArray(originalMessage.references)
      ? originalMessage.references.map(r => String(r).replace(/-sent$/, ''))
      : [];
    const parent = String(originalMessage.messageId || '').replace(/-sent$/, '');
    if (parent && !refs.includes(parent)) refs.push(parent);
    return refs;
  }

  /**
   * Send a quick reply (predefined short response).
   * @param {Object} originalMessage
   * @param {string} fromActorId
   * @param {string} quickReplyText - e.g. "ACK", "WILCO", "NEGATIVE"
   * @returns {Promise<{success: boolean, messageId?: string}>}
   */
  async sendQuickReply(originalMessage, fromActorId, quickReplyText) {
    const replyData = this.buildReply(originalMessage, fromActorId, quickReplyText);
    return this.sendMessage(replyData);
  }

  // ─── Read / Delete / Save ─────────────────────────────────

  /**
   * Mark a message as read.
   * @param {string} actorId
   * @param {string} messageId
   */
  async markAsRead(actorId, messageId) {
    const result = await this._messageRepo.markAsRead(actorId, messageId);
    if (result.success) {
      this.eventBus.emit(EVENTS.MESSAGE_READ, { messageId, actorId, readAt: new Date().toISOString() });
      // Sync status to other clients
      this.socketManager.emit(SOCKET_OPS.MESSAGE_STATUS_UPDATE, {
        actorId, messageId, update: 'read',
      });
    }
    return result;
  }

  /**
   * Soft-delete a message.
   * @param {string} actorId
   * @param {string} messageId
   */
  async deleteMessage(actorId, messageId) {
    const result = await this._messageRepo.softDeleteMessage(actorId, messageId);
    if (result.success) {
      this.eventBus.emit(EVENTS.MESSAGE_DELETED, { messageId });
    }
    return result;
  }

  /**
   * Toggle saved/starred status.
   * @param {string} actorId
   * @param {string} messageId
   */
  async toggleSaved(actorId, messageId) {
    return this._messageRepo.toggleSaved(actorId, messageId);
  }

  /**
   * Mark a message as spam.
   * @param {string} actorId
   * @param {string} messageId
   * @returns {Promise<{success: boolean}>}
   */
  async markSpam(actorId, messageId) {
    return this._messageRepo.updateMessageFlags(actorId, messageId, {
      status: { spam: true },
    });
  }

  /**
   * Remove spam flag from a message.
   * @param {string} actorId
   * @param {string} messageId
   * @returns {Promise<{success: boolean}>}
   */
  async unmarkSpam(actorId, messageId) {
    return this._messageRepo.updateMessageFlags(actorId, messageId, {
      status: { spam: false },
    });
  }

  /**
   * Restore a soft-deleted message from trash.
   * @param {string} actorId
   * @param {string} messageId
   * @returns {Promise<{success: boolean}>}
   */
  async restoreFromTrash(actorId, messageId) {
    return this._messageRepo.updateMessageFlags(actorId, messageId, {
      status: { deleted: false },
    });
  }

  /**
   * Permanently delete a message (hard delete).
   * @param {string} actorId
   * @param {string} messageId
   * @returns {Promise<{success: boolean}>}
   */
  async permanentDelete(actorId, messageId) {
    return this._messageRepo.hardDeleteMessage(actorId, messageId);
  }

  /**
   * Empty all trashed messages for an actor (permanent delete).
   * @param {string} actorId
   * @returns {Promise<{success: boolean, count: number}>}
   */
  async emptyTrash(actorId) {
    const messages = await this._messageRepo.getMessages(actorId, {
      filter: 'all',
      includeDeleted: true,
    });
    const trashed = messages.filter(m => m.status?.deleted);
    let count = 0;
    for (const msg of trashed) {
      const result = await this._messageRepo.hardDeleteMessage(actorId, msg.messageId);
      if (result.success) count++;
    }
    return { success: true, count };
  }

  /**
   * Empty all spam messages for an actor (permanent delete).
   * @param {string} actorId
   * @returns {Promise<{success: boolean, count: number}>}
   */
  async emptySpam(actorId) {
    const messages = await this._messageRepo.getMessages(actorId);
    const spam = messages.filter(m => m.status?.spam && !m.status?.deleted);
    let count = 0;
    for (const msg of spam) {
      const result = await this._messageRepo.hardDeleteMessage(actorId, msg.messageId);
      if (result.success) count++;
    }
    return { success: true, count };
  }

  // ─── Query Methods ────────────────────────────────────────

  /**
   * Get messages for an actor with filtering.
   * @param {string} actorId
   * @param {Object} [options]
   */
  async getMessages(actorId, options = {}) {
    return this._messageRepo.getMessages(actorId, options);
  }

  /**
   * Get a single message.
   * @param {string} actorId
   * @param {string} messageId
   */
  async getMessage(actorId, messageId) {
    return this._messageRepo.getMessage(actorId, messageId);
  }

  /**
   * Get unread count for an actor.
   * @param {string} actorId
   * @returns {Promise<number>}
   */
  async getUnreadCount(actorId) {
    return this._messageRepo.getUnreadCount(actorId);
  }

  /**
   * Get message thread.
   * @param {string} actorId
   * @param {string} threadId
   */
  async getThread(actorId, threadId) {
    return this._messageRepo.getThread(actorId, threadId);
  }

  /**
   * Update specific flags on a message.
   * @param {string} actorId
   * @param {string} messageId
   * @param {object} flagUpdates
   * @returns {Promise<{success: boolean}>}
   */
  async updateMessageFlags(actorId, messageId, flagUpdates) {
    return this._messageRepo.updateMessageFlags(actorId, messageId, flagUpdates);
  }

  // ─── Message Encryption ─────────────────────────────────

  /**
   * Attempt to decrypt an encrypted message via skill check.
   * Uses caller-provided skill/luck if present, else falls back to encryption config.
   *
   * @param {string} messageId
   * @param {string} actorId - The actor attempting decryption
   * @param {object} [options]
   * @param {string} [options.skillName] - Skill chosen in the dialog
   * @param {number} [options.luckSpend=0] - Luck points to spend
   * @returns {Promise<{ success: boolean, roll?: object }>}
   */
  async attemptDecrypt(messageId, actorId, options = {}) {
    const actor = game.actors?.get(actorId);
    if (!actor) {
      ui.notifications.warn('NCM | No character assigned.');
      return { success: false };
    }

    // Find the message in inbox
    const inbox = await this._messageRepo.getInboxJournal(actorId);
    if (!inbox) return { success: false };

    const page = inbox.pages.find(p =>
      p.flags?.[MODULE_ID]?.messageId === messageId
    );
    if (!page) return { success: false };

    const flags = page.flags?.[MODULE_ID];
    if (!flags?.status?.encrypted) {
      return { success: true }; // Already decrypted
    }

    const encryption = flags.encryption || {};
    const dc = encryption.dc ?? 15;
    // Use caller-provided skill/luck if present, else fall back to encryption config
    const skillName = options.skillName || encryption.skill || 'Interface';
    const luckSpend = options.luckSpend ?? 0;

    // Route through SkillService for full CPR roll
    const skillSvc = game.nightcity?.skillService;
    if (!skillSvc) {
      ui.notifications.warn('NCM | Skill system not available.');
      return { success: false };
    }

    const result = await skillSvc.performCheck(actor, skillName, {
      dc,
      luckSpend,
      flavor: `Decrypting ${encryption.type || 'ICE'}-protected message`,
      context: 'ncm-message-decrypt',
    });

    if (result?.success) {
      await this._messageRepo.updateMessageFlags(actorId, messageId, {
        status: { ...flags.status, encrypted: false },
      });
      this.soundService?.play('hack-success');
      this.eventBus?.emit(EVENTS.MESSAGE_STATUS_CHANGED, { messageId, actorId });
      ui.notifications.info('NCM | Message decrypted.');
      return { success: true, roll: result };
    }

    this.soundService?.play('hack-fail');

    // BLACK ICE / RED ICE: apply damage on failure
    let iceDamage = null;
    if (this.iceService?.isLethalICE(encryption)) {
      const failureMode = encryption.failureMode || 'nothing';
      if (failureMode === 'damage') {
        iceDamage = await this.iceService.applyDamage(actor, encryption, {
          context: 'message',
          targetName: flags.subject || 'Encrypted Message',
        });
      }
    }

    ui.notifications.warn(`NCM | Decryption failed. (${result?.total ?? '?'} vs DV ${dc})`);
    return { success: false, roll: result, iceDamage };
  }

  /**
   * GM force decrypt — bypasses skill check entirely.
   * @param {string} messageId
   * @param {string} [actorId] - Inbox owner. If omitted, searches all inboxes.
   */
  async forceDecrypt(messageId, actorId) {
    if (!game.user?.isGM) return;

    if (actorId) {
      await this._messageRepo.updateMessageFlags(actorId, messageId, {
        status: { encrypted: false },
      });
    } else {
      // Search all inboxes for this message (GM tool)
      for (const journal of game.journal) {
        const inbox = this._messageRepo.constructor.identifyInbox(journal);
        if (!inbox) continue;
        const page = journal.pages.find(p =>
          p.flags?.[MODULE_ID]?.messageId === messageId
        );
        if (page) {
          await this._messageRepo.updateMessageFlags(inbox.ownerId, messageId, {
            status: { encrypted: false },
          });
        }
      }
    }

    this.eventBus?.emit(EVENTS.MESSAGE_STATUS_CHANGED, { messageId });
    ui.notifications.info('NCM | Message force-decrypted.');
  }

  /**
   * GM encrypt an existing message after send.
   * @param {string} actorId - Inbox owner
   * @param {string} messageId
   * @param {object} [encryption] - { type: 'ICE'|'BLACK_ICE', dc: number, skill: string }
   */
  async encryptMessage(actorId, messageId, encryption = {}) {
    if (!game.user?.isGM) return;

    await this._messageRepo.updateMessageFlags(actorId, messageId, {
      status: { encrypted: true },
      encryption: {
        type: encryption.type || 'ICE',
        dc: encryption.dc ?? 15,
        skill: encryption.skill || 'Interface',
      },
    });

    this.eventBus?.emit(EVENTS.MESSAGE_STATUS_CHANGED, { messageId });
    ui.notifications.info('NCM | Message encrypted.');
  }

  // ─── GM Operations ────────────────────────────────────────

  /**
   * Handle incoming message relay from a player (GM side).
   * @param {Object} data - Message data from player's sendMessage
   */
  async handleMessageRelay(data) {
    if (!game.user.isGM) return;

    console.log(`${MODULE_ID} | GM handling message relay: ${data.messageId}`);
    const result = await this._deliverMessage(data);

    // Send delivery confirmation back to sender
    this.socketManager.emit(SOCKET_OPS.MESSAGE_DELIVERED, {
      messageId: data.messageId,
      success: result.success,
      error: result.error,
    });
  }

  /**
   * Handle incoming notification (recipient side).
   * @param {Object} data - Notification data
   */
  async handleMessageNotification(data) {
    // Check if this notification is for an actor we own
    const actor = game.actors.get(data.toActorId);
    if (!actor?.isOwner) return;

    console.log(`${MODULE_ID} | New message notification for ${data.toActorId}`);

    // Toast + receive sound are driven by the MESSAGE_RECEIVED listener
    // (registerMessagingSystem). Emit once with the full payload so the toast
    // can show the sender name and subject.
    this.eventBus.emit(EVENTS.MESSAGE_RECEIVED, {
      messageId: data.messageId,
      toActorId: data.toActorId,
      fromActorId: data.fromActorId,
      fromContactId: data.fromContactId,
      from: data.from,
      fromName: data.fromName,
      subject: data.subject,
      preview: data.preview,
      priority: data.priority || 'normal',
    });
  }

  /**
   * GM-side self-destruct reaper. Scans every inbox and permanently erases
   * TIMED self-destruct messages whose expiry has passed — even if the
   * recipient never opened them. `after_read` messages are left alone (those
   * are consumed only when the recipient reads + leaves them in the viewer).
   *
   * Uses the configured time provider (TimeService) for "now", so timed
   * destruction respects world-time / manual / disguised modes.
   *
   * @returns {Promise<number>} Count of messages erased.
   */
  async reapSelfDestruct() {
    if (!game.user.isGM) return 0;
    const repo = this._messageRepo;
    if (!repo) return 0;

    const nowMs = this._nowMs();
    let reaped = 0;

    try {
      for (const journal of game.journal ?? []) {
        const inbox = repo.constructor.identifyInbox(journal);
        if (!inbox) continue;

        const expired = [];
        for (const page of journal.pages ?? []) {
          const f = page.flags?.[MODULE_ID];
          if (!f?.messageId) continue;
          if (f.status?.sent || f.status?.deleted) continue;
          const sd = f.selfDestruct;
          if (!sd?.expiresAt || sd.mode === 'after_read') continue;
          if (new Date(sd.expiresAt).getTime() <= nowMs) {
            expired.push({ pageId: page.id, messageId: f.messageId });
          }
        }

        if (expired.length) {
          await journal.deleteEmbeddedDocuments('JournalEntryPage', expired.map(e => e.pageId));
          reaped += expired.length;
          for (const e of expired) {
            this.eventBus?.emit(EVENTS.MESSAGE_DELETED, { messageId: e.messageId, actorId: inbox.ownerId });
          }
        }
      }
    } catch (error) {
      console.error(`${MODULE_ID} | MessageService.reapSelfDestruct:`, error);
    }

    if (reaped) {
      this.notificationService?.refreshBadge?.();
      console.log(`${MODULE_ID} | Self-destruct reaper erased ${reaped} expired message(s).`);
    }
    return reaped;
  }

  /**
   * Handle delivery confirmation (sender side).
   * @param {Object} data
   */
  handleDeliveryConfirmation(data) {
    if (data.success) {
      console.log(`${MODULE_ID} | Message ${data.messageId} delivered successfully`);
    } else {
      console.warn(`${MODULE_ID} | Message ${data.messageId} delivery failed: ${data.error}`);
      ui.notifications.warn(`Message delivery failed: ${data.error}`);
    }
  }

  // ─── Share to Chat ────────────────────────────────────────

  /**
   * Share a message to the Foundry chat as a styled card.
   * @param {Object} message
   * @param {string} [actorId] - The actor sharing the message
   */
  async shareToChat(message, actorId) {
    try {
      const content = await renderTemplate(
        `modules/${MODULE_ID}/templates/chat/message-card.hbs`,
        {
          message: {
            ...message,
            messageIdShort: (message.messageId || '').slice(0, 8),
          },
          sharedBy: actorId ? game.actors.get(actorId)?.name : game.user.name,
          showPriority: message.priority && message.priority !== 'normal',
          MODULE_ID,
        }
      );

      const speaker = actorId
        ? ChatMessage.getSpeaker({ actor: game.actors.get(actorId) })
        : ChatMessage.getSpeaker();

      await ChatMessage.create({
        content,
        speaker,
        flags: {
          [MODULE_ID]: {
            type: 'shared-message',
            messageId: message.messageId,
          }
        }
      });
    } catch (error) {
      console.error(`${MODULE_ID} | MessageService.shareToChat:`, error);
      ui.notifications.error('Failed to share message to chat.');
    }
  }

  // ─── Helpers ──────────────────────────────────────────────

  _getTimestamp() {
    try {
      if (this.timeService) return this.timeService.getCurrentTime();
    } catch { /* fallback */ }
    return new Date().toISOString();
  }

  /** Current time in epoch ms via the configured time provider. */
  _nowMs() {
    try {
      if (this.timeService) return this.timeService.getCurrentTimeMs();
    } catch { /* fallback */ }
    return Date.now();
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
