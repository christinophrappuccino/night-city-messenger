/**
 * Message Service
 * @file scripts/services/MessageService.js
 * @module night-city-messenger
 * @description Core messaging business logic. Handles send/receive/reply/forward/delete
 * with GM-relayed delivery pipeline. All message delivery flows through the GM's client
 * for permission safety.
 */

import { MODULE_ID, EVENTS, SOCKET_OPS } from '../utils/constants.js';
import { DataValidator } from '../data/DataValidator.js';
import { log, ANON_MASKED_EMAIL, ANON_DEFAULT_ALIAS, resolveDisplayName, resolveDisplayPortrait, chatCardTime } from '../utils/helpers.js';
import { makeMember, dedupeMembers, othersFor, selfKeys, normalizeEmail } from '../utils/participants.js';
import { replyIdentity, groupKeyOf } from '../utils/identities.js';

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

      // ── Recipients ──
      // One or many. A list of 2+ fans out — one copy per recipient, one sent
      // copy, shared messageId/threadId, every copy carrying `participants`
      // (address-keyed, see participants.js). Before this, several chips in the
      // composer packed an ARRAY into toActorId and the send died with
      // "Recipient not found" — the module had never delivered to two people.
      const list = this._normalizeRecipients(data);
      delete data.recipients;
      if (list.length > 1) return this._sendToMany(data, list, { fromActor, fromContact });
      if (list.length === 1) this._applyRecipient(data, list[0]);

      const rr = await this._resolveRecipient(data);
      if (!rr.ok) return { success: false, error: rr.error, errorCode: rr.errorCode };
      const toActor = rr.toActor;
      const toContact = rr.toContact;

      await this._stampOutgoing(data, { fromActor, fromContact, toActor, toContact });

      if (game.user.isGM) {
        return this._deliverMessage(data);
      }

      return this._relayMessage(data);
    } catch (error) {
      console.error(`${MODULE_ID} | MessageService.sendMessage:`, error);
      return { success: false, error: error.message };
    }
  }

  // ─── Recipients: one or many ───────────────────────────────

  /**
   * Every recipient the caller named, as plain {actorId, contactId, email, name}
   * entries. `data.recipients` (an array) wins; else the legacy single fields
   * (toActorId may itself be an array — the composer's old multi-chip shape).
   * @param {Object} data
   * @returns {Array<{actorId: string|null, contactId: string|null, email: string, name: string}>}
   */
  _normalizeRecipients(data) {
    // A group id (composer chip, macro API) expands to its resolved members
    // first; an explicit recipients list beside it is merged in.
    if (data.groupId) {
      const svc = game.nightcity?.contactGroupService;
      const g = svc?.findGroup?.(data.groupId, { actorId: data.fromActorId, isGM: !!game.user?.isGM });
      const fromGroup = g ? svc.recipientsFor(g).recipients : [];
      data.recipients = [...(Array.isArray(data.recipients) ? data.recipients : []), ...fromGroup];
      delete data.groupId;
    }
    const out = [];
    const push = (r) => {
      if (!r) return;
      const actorId = r.actorId || null, contactId = r.contactId || null, email = normalizeEmail(r.email || '');
      if (!actorId && !contactId && !email) return;
      if (out.some(o => (actorId && o.actorId === actorId) || (contactId && o.contactId === contactId) || (email && o.email === email))) return;
      out.push({ actorId, contactId, email, name: String(r.name || '').trim() });
    };
    if (Array.isArray(data.recipients) && data.recipients.length) {
      for (const r of data.recipients) push(r);
      return out;
    }
    if (data.anonReply) return out; // the GM resolves the hidden target at delivery
    if (Array.isArray(data.toActorId)) {
      for (const id of data.toActorId) push({ actorId: id });
      if (data.toContactId) push({ contactId: data.toContactId, email: data.to });
      return out;
    }
    if (data.toActorId || data.toContactId || data.to) push({ actorId: data.toActorId, contactId: data.toContactId, email: data.to, name: data.toName });
    return out;
  }

  /** Write one recipient entry onto the legacy single fields. */
  _applyRecipient(data, r) {
    data.toActorId = r.actorId || null;
    data.toContactId = r.contactId || undefined;
    data.to = r.email || data.to || undefined;
    if (r.name && !data.toName) data.toName = r.name;
  }

  /**
   * Resolve ONE recipient onto `data` (toActorId / toContactId / to /
   * _recipientInboxId) and run the player gates (send-only, verification).
   * Mutates `data`; returns the resolved documents or the gate's refusal.
   * @param {Object} data
   * @returns {Promise<{ok: boolean, toActor?: Actor|null, toContact?: Object|null, error?: string, errorCode?: string}>}
   */
  async _resolveRecipient(data) {
    let toActor = null;
    let toContact = null;

      // Anonymous reply: the replier doesn't know (and must never learn) the real
      // recipient — the original sender was masked. Skip recipient resolution AND
      // the verification gate; the GM resolves the true target at delivery time
      // (_deliverMessage → _resolveAnonReplyTarget) and masks it on the sent copy.
      if (!data.anonReply) {
        toActor = data.toActorId ? game.actors.get(data.toActorId) : null;
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

          // Actor-linked recipient whose actor THIS client can't see. Players
          // only receive actors they have permission on, so a shared contact
          // that links a GM-owned NPC actor (Admin → Contacts → Import Actor →
          // Share) resolves to nothing here and the send died with "Recipient
          // not found" (2026-09 tester). The master directory is a world
          // setting every client reads — resolve through it, and otherwise
          // trust the player's own actor link (the inbox is keyed by that
          // actor id; the verification gate below still applies).
          let actorLinkOnly = false;
          if (!toActor && !toContact && data.toActorId && !Array.isArray(data.toActorId)) {
            toContact = game.nightcity?.masterContactService?.getByActorId?.(data.toActorId) || null;
            if (toContact) {
              data.toContactId = toContact.id;
              recipientInboxId = data.toActorId;
            } else if (data.to) {
              actorLinkOnly = true;
              recipientInboxId = data.toActorId;
            }
          }

          if (!toActor && !toContact && !actorLinkOnly) {
            return { ok: false, error: 'Recipient not found — no matching actor or contact.', errorCode: 'NOT_FOUND' };
          }
        }

        // IDENTITIES: an alias with no actor of its own delivers into its
        // group's inbox — the character it points at, or the NPC contact it is
        // an alias of. `toContactId` stays the alias, so the mail records it.
        if (toContact && !toContact.actorId) {
          const key = groupKeyOf(game.nightcity?.masterContactService?.getAll?.() || [], toContact);
          if (key?.startsWith('a:')) {
            const aid = key.slice(2);
            toActor = game.actors.get(aid) || toActor;
            data.toActorId = aid;
            recipientInboxId = aid;
          } else if (key?.startsWith('c:')) {
            recipientInboxId = key.slice(2);
          }
        }

        // Store the resolved inbox target for delivery
        data._recipientInboxId = recipientInboxId;

        // ── Send-only Gate (players only, ALWAYS on) ──
        // A master contact flagged `sendOnly` is a one-way system address
        // (system@localhost, alerts@…): the GM sends FROM it, players can
        // never send TO it — independent of the verification setting below.
        if (!game.user.isGM) {
          const masterService = game.nightcity?.masterContactService;
          const recipientEmail = data.to || (toActor ? this._contactRepo.getActorEmail(data.toActorId) : toContact?.email);
          const mc = (recipientEmail ? masterService?.getByEmail?.(recipientEmail) : null)
            || (data.toActorId ? masterService?.getByActorId?.(data.toActorId) : null);
          if (mc?.sendOnly) {
            return {
              ok: false,
              error: 'TRANSMISSION REFUSED — this address does not accept incoming messages.',
              errorCode: 'SEND_ONLY',
            };
          }
        }

        // ── Contact Verification Gate (players only) ──
        // Players can only send to contacts that exist in the GM's Master Contact Directory.
        const requireVerification = game.settings.get(MODULE_ID, 'requireContactVerification') ?? true;

        if (!game.user.isGM && requireVerification) {
          const masterService = game.nightcity?.masterContactService;
          const recipientEmail = data.to || (toActor ? this._contactRepo.getActorEmail(data.toActorId) : toContact?.email);

          // Verified if the recipient is in the master directory OR is a registered
          // actor (verifyContact checks both — matches the setting hint). The actorId
          // branch additionally covers master contacts linked by actor without an email.
          // Correspondent rule: anyone who has ALREADY written to this character
          // is a known return address. Without it, a GM sending from an NPC actor
          // that isn't in the directory (and has no registered email) produced a
          // message the player could read but never answer ("Contact Not Found"
          // on Reply — the 2026-09 tester report).
          const verified = this._contactRepo.verifyContact(recipientEmail).verified
            || !!masterService?.getAll?.()?.find(mc => mc.actorId === data.toActorId)
            || await this._isKnownCorrespondent(data.fromActorId, {
              actorId: data.toActorId,
              contactId: data.toContactId,
              email: recipientEmail || data.to,
            });

          if (!verified) {
            return {
              ok: false,
              error: 'CONTACT NOT FOUND — Recipient not registered in the network directory.',
              errorCode: 'NO_CONTACT',
            };
          }
        }
      }

    return { ok: true, toActor, toContact };
  }

  /**
   * The address a resolved recipient will be stored under — the registered
   * flag, the directory entry's address, or the synthesized name@nightcity.net.
   */
  _recipientEmailFor(data, toActor, toContact) {
    if (data.to) return data.to;
    // Registered actor address → the directory entry's address → synthesized.
    // The directory beats a synthesized name@nightcity.net: a contact whose
    // linked actor never ran Email Setup used to get the made-up address even
    // though the GM had typed a real one into the directory.
    const flagged = toActor ? this._contactRepo.getActorEmail(data.toActorId) : '';
    if (flagged) return flagged;
    if (toContact?.email) return toContact.email;
    const name = toActor?.name || toContact?.name || '';
    return name ? `${name.toLowerCase().replace(/\s+/g, '.')}@nightcity.net` : '';
  }

  /**
   * The address an actor-backed sender writes from — the registered flag, then
   * the master directory entry (by `fromContactId`, else the entry linked to the
   * actor), else '' so the caller synthesizes name@nightcity.net.
   *
   * The twin of `_recipientEmailFor`, fixed for the same reason (tester,
   * 2026-10-24): the GM picked "example@ARK.com" from the Send-as list, but a
   * master contact WITH a linked actor is picked by actor id, so the service
   * saw only `fromActorId`, never the directory, and stamped the synthesized
   * address. The player then saw — and added to contacts — example@nightcity.net.
   * @param {Object} data
   * @param {Actor} fromActor
   * @returns {string}
   */
  _senderEmailFor(data, fromActor) {
    // An identity picked explicitly (Send-as, or a reply from the alias the
    // mail came to) wins over the character's registered address.
    const chosen = data.fromContactId && game.nightcity?.masterContactService?.getContact?.(data.fromContactId);
    if (chosen?.email && chosen.actorId && chosen.actorId === (fromActor?.id || data.fromActorId)) return chosen.email;
    // A main identity the GM starred speaks for the character, even when the
    // registered flag still holds an address from before the move. NPCs only —
    // a player character's address is the player's own Email Setup choice.
    const starred = game.nightcity?.masterContactService?.getByActorId?.(fromActor?.id || data.fromActorId);
    if (starred?.primaryIdentity && starred.email && !fromActor?.hasPlayerOwner) return starred.email;
    const flagged = this._contactRepo.getActorEmail(data.fromActorId);
    if (flagged) return flagged;
    const mcs = game.nightcity?.masterContactService;
    const entry = (data.fromContactId && mcs?.getContact?.(data.fromContactId))
      || mcs?.getByActorId?.(fromActor?.id);
    return entry?.email || '';
  }

  /**
   * Everything sendMessage stamps on an outgoing message once the recipient is
   * known: from/to addresses, NPC auto-registration, display names, ids,
   * thread, the GM overrides, network + signal + timestamp.
   * @param {Object} data
   * @param {{fromActor: Actor|null, fromContact: Object|null, toActor: Actor|null, toContact: Object|null}} ctx
   */
  async _stampOutgoing(data, { fromActor, fromContact, toActor, toContact }) {
      // ── Resolve email addresses ──
      if (!data.from) {
        if (fromActor) {
          data.from = this._senderEmailFor(data, fromActor)
            || `${fromActor.name.toLowerCase().replace(/\s+/g, '.')}@nightcity.net`;
        } else if (fromContact) {
          data.from = fromContact.email || `${fromContact.name.toLowerCase().replace(/\s+/g, '.')}@nightcity.net`;
        } else {
          data.from = data.fromName
            ? `${data.fromName.toLowerCase().replace(/\s+/g, '.')}@nightcity.net`
            : 'unknown@nightcity.net';
        }
      }
      if (!data.to) data.to = this._recipientEmailFor(data, toActor, toContact) || undefined;
      // Where the sender stood — a network node only hears mail sent on its own scene (taps, sniffers).
      // Delivery-time only: createMessage never persists it.
      if (data.sentFromScene === undefined) data.sentFromScene = game.scenes?.viewed?.id || game.user?.viewedScene || '';

      // ── Auto-register an unregistered NPC sender in the master directory ──
      // Runs BEFORE the display-name resolution so the new entry names the mail.
      await this._autoRegisterNpcSender(data, fromActor);

      // ── Preserve proper-cased display names ──
      // Stored alongside the lowercased email so names survive actor deletion
      // Master directory beats the actor name (the GM-edited directory name is
      // what players should see; the actor label is GM bookkeeping).
      if (!data.fromName) {
        data.fromName = fromContact?.name
          || resolveDisplayName({ contactId: data.fromContactId, actorId: data.fromActorId, email: data.from }, '')
          || null;
      }
      if (!data.toName) {
        data.toName = toContact?.name
          || resolveDisplayName({ contactId: data.toContactId, actorId: data.toActorId, email: data.to }, '')
          || null;
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

      // ── GM per-message overrides (composer "send via" network + backdate) ──
      const networkService = game.nightcity.networkService;
      const { viaNetwork, backdate } = this._resolveSendOverrides(data, networkService);

      // ── Network access control stamping ──
      const accessControl = networkService?.getMessageAccessControl(viaNetwork?.id ?? null) ?? null;
      if (accessControl) {
        data.accessControl = accessControl;
      }

      // ── Signal degradation stamping (low signal = garbled body) ──
      // A "send via" override reads that network's configured signal; otherwise
      // the sender's live connection.
      const signalStrength = viaNetwork
        ? (viaNetwork.signalStrength ?? 100)
        : (networkService?.signalStrength ?? 100);
      if (signalStrength < 50) {
        data.signalDegradation = {
          originalSignal: signalStrength,
          corruptionLevel: signalStrength < 20 ? 'heavy' : 'moderate',
          reconstructed: false,
          reconstructDC: signalStrength < 20 ? 18 : 13,
          reconstructSkill: 'Electronics/Security Tech',
        };
      }

      data.network = viaNetwork?.id || networkService?.currentNetworkId || data.network || 'CITINET';
      data.timestamp = backdate || this._getTimestamp();
      delete data.networkOverride;
      delete data.backdated;
  }

  /**
   * Fan out to 2+ recipients. Each recipient is resolved + gated on its own;
   * the ones that pass get a copy, the ones that fail are REPORTED (never a
   * silent drop, never an all-or-nothing refusal unless everyone fails). One
   * messageId, one threadId, one sent copy listing everyone, and a
   * `participants` list on every copy so threading and Reply All know the
   * whole party.
   * @param {Object} data  the message after sender resolution
   * @param {Array} list   from _normalizeRecipients
   * @param {{fromActor: Actor|null, fromContact: Object|null}} senderCtx
   */
  async _sendToMany(data, list, { fromActor, fromContact }) {
    const results = [];
    const okList = [];
    for (const r of list) {
      const per = { ...data, toActorId: r.actorId || null, toContactId: r.contactId || undefined, to: r.email || undefined, toName: undefined };
      delete per.recipients;
      const rr = await this._resolveRecipient(per);
      const label = r.name || r.email || r.actorId || r.contactId || '?';
      if (!rr.ok) {
        results.push({ name: label, email: r.email || '', actorId: r.actorId || null, contactId: r.contactId || null, success: false, error: rr.error, errorCode: rr.errorCode });
        continue;
      }
      per.to = this._recipientEmailFor(per, rr.toActor, rr.toContact);
      per.toName = rr.toContact?.name
        || resolveDisplayName({ contactId: per.toContactId, actorId: per.toActorId, email: per.to }, '')
        || r.name || per.to;
      okList.push({ per, rr, member: makeMember({ email: per.to, name: per.toName, hint: { actorId: per.toActorId || '', contactId: per.toContactId || '' }, role: 'to' }) });
    }

    if (!okList.length) {
      const why = results.map(x => `${x.name}: ${x.error}`).join(' · ');
      const res = { success: false, error: `No recipient could be reached — ${why}`, errorCode: 'ALL_RECIPIENTS_FAILED', results, delivered: 0, failed: results };
      if (game.user.isGM) await this.recordDeliveryFailure({ data, result: res, source: 'gm' });
      return res;
    }

    // Stamp the BASE once (ids, thread, network, timestamp…). Its "to" is the
    // whole party, which is what the sender's sent copy shows.
    data.toActorId = null;
    data.toContactId = undefined;
    delete data._recipientInboxId;
    data.to = okList.map(x => x.per.to).join(', ');
    data.toName = okList.map(x => x.per.toName).join(', ');
    await this._stampOutgoing(data, { fromActor, fromContact, toActor: null, toContact: null });
    const sender = makeMember({
      email: data.from, name: data.fromName || fromActor?.name || fromContact?.name || '',
      hint: { actorId: data.fromActorId || '', contactId: data.fromContactId || '' }, role: 'from',
    });
    data.participants = dedupeMembers([sender, ...okList.map(x => x.member)]);

    const copies = okList.map(({ per }) => ({
      ...data,
      toActorId: per.toActorId || null,
      toContactId: per.toContactId || undefined,
      to: per.to,
      toName: per.toName,
      _recipientInboxId: per._recipientInboxId,
    }));

    if (game.user.isGM) {
      const res = await this._deliverMany(data, copies);
      res.results = [...results, ...(res.results || [])];
      res.failed = res.results.filter(x => !x.success);
      // A GM group send with refused recipients: listed in Outbox → Didn't arrive.
      if (res.failed.length) await this.recordDeliveryFailure({ data, result: res, source: 'gm' });
      return res;
    }
    // Player: ONE relay carrying the copies; the GM fans out and acks once.
    const relayed = await this._relayMessage({ ...data, _fanout: copies });
    relayed.results = [...results, ...(relayed.results || [])];
    relayed.failed = relayed.results.filter(x => !x.success);
    relayed.delivered = relayed.delivered ?? (relayed.success ? copies.length : 0);
    return relayed;
  }

  /**
   * GM-side fan-out: one inbox copy per recipient (each through the normal
   * _deliverMessage, so spam filter / anon mask / terminal mirror / NPC toast
   * all apply per copy), then ONE sent copy for the author.
   * @param {Object} base   the stamped base message (to/toName = the whole party)
   * @param {Array<Object>} copies
   * @returns {Promise<{success: boolean, messageId: string, delivered: number, failed: Array, results: Array, error?: string}>}
   */
  async _deliverMany(base, copies) {
    const results = [];
    for (const copy of copies) {
      delete copy._fanout;
      const r = await this._deliverMessage(copy, { sentCopy: false });
      results.push({ name: copy.toName || copy.to, email: copy.to || '', actorId: copy.toActorId || null, contactId: copy.toContactId || null, success: !!r.success, error: r.error, errorCode: r.errorCode });
    }
    const delivered = results.filter(x => x.success).length;
    if (delivered > 0) {
      const sentBase = { ...base };
      delete sentBase._fanout;
      try { await this._createSentCopy(sentBase); } catch (err) { console.warn(`${MODULE_ID} | fan-out sent copy failed:`, err); }
    }
    const failed = results.filter(x => !x.success);
    return {
      success: delivered > 0,
      messageId: base.messageId,
      delivered,
      failed,
      results,
      error: delivered > 0 ? undefined : `No recipient could be reached — ${failed.map(x => `${x.name}: ${x.error}`).join(' · ')}`,
      errorCode: delivered > 0 ? undefined : 'ALL_RECIPIENTS_FAILED',
    };
  }

  /** The author's own copy of an outgoing message (`<id>-sent`, status.sent). */
  async _createSentCopy(data) {
    let senderInboxId = data.fromActorId || data.fromContactId;
    if (!data.fromActorId && data.fromContactId) {
      const mcs = game.nightcity?.masterContactService;
      const key = groupKeyOf(mcs?.getAll?.() || [], mcs?.getContact?.(data.fromContactId));
      if (key) senderInboxId = key.slice(2);
    }
    if (!senderInboxId) return null;
    let sentCopy = {
      ...data,
      messageId: `${data.messageId}-sent`,
      status: { sent: true, read: true, eddiesClaimed: true },
    };
    delete sentCopy._recipientInboxId; // Don't persist internal field
    delete sentCopy._fanout;
    // Anonymous reply — mask the recipient on the replier's own sent copy so
    // their outbox can't reveal the anonymous party they answered.
    if (data.anonReply) sentCopy = this._maskAnonReplyForSender(sentCopy);
    const created = await this._messageRepo.createMessage(senderInboxId, sentCopy);
    // A terminal account linked to the sender shows its outgoing mail too
    // (the account's Sent folder). Non-fatal, like the delivery mirror.
    try { await game.nightcity.terminalService?.mirrorSentToAccounts?.(sentCopy); }
    catch (err) { console.warn(`${MODULE_ID} | terminal sent-mirror failed:`, err); }
    return created;
  }

  /**
   * Direct delivery (GM client). Creates message in recipient's inbox
   * and a sent copy in sender's outbox.
   * Supports both actor-backed and contact-only inboxes.
   * @param {Object} data
   * @returns {Promise<{success: boolean, messageId?: string}>}
   */
  async _deliverMessage(data, { sentCopy = true } = {}) {
    try {
      // Anonymous reply — the player couldn't know the real recipient. Resolve it
      // GM-side from the original message's GM-owned sent copy (which retains the
      // real sender), then deliver normally. The sent copy below re-masks it so
      // the replier's own outbox never reveals who they answered.
      if (data.anonReply && !data.toActorId && !data.toContactId) {
        const target = this._resolveAnonReplyTarget(data.anonReply.parentMessageId);
        if (!target || (!target.fromActorId && !target.fromContactId)) {
          return { success: false, error: 'Anonymous reply target could not be resolved.' };
        }
        if (target.fromActorId) data.toActorId = target.fromActorId;
        else if (target.fromContactId) data.toContactId = target.fromContactId;
        if (!data.to && target.from) data.to = target.from;
      }

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

      // Anonymous Send — the recipient-facing copy must NOT carry the real
      // identity (truly hidden). Build a masked clone for the recipient inbox and
      // the recipient toast; the GM-owned sent copy below keeps the real sender.
      const recipientData = data.anonymous?.enabled ? this._maskAnonForRecipient(data) : data;

      // Create message in recipient's inbox
      const result = await this._messageRepo.createMessage(recipientInboxId, recipientData);
      if (!result.success) return result;

      // Create sent copy in sender's outbox (a fan-out writes ONE for the
      // whole party from _deliverMany instead).
      if (sentCopy) await this._createSentCopy(data);

      // Terminal mirror — an account linked to this recipient (by contact,
      // actor, or email) is that character's inbox on the machine, so the
      // delivery shows up there too. Uses the recipient-facing clone so
      // anonymous mail stays masked. Non-fatal: the inbox delivery succeeded.
      try {
        await game.nightcity.terminalService?.mirrorDeliveryToAccounts?.(recipientData);
      } catch (err) {
        console.warn(`${MODULE_ID} | terminal delivery mirror failed:`, err);
      }

      // Network-node TAPS: a runner who tapped a node of the network this went over gets a copy (EXFIL folder).
      // Non-fatal; the recipient-facing clone, so anonymous mail stays masked.
      try {
        await game.nightcity.networkService?.tapDelivery?.(recipientData);
      } catch (err) {
        console.warn(`${MODULE_ID} | node tap failed:`, err);
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
          // Use the masked clone so an online recipient's toast can't reveal the
          // real sender. The doc-sync toast path reads the already-scrubbed page.
          fromActorId: recipientData.fromActorId,
          fromContactId: recipientData.fromContactId,
          from: recipientData.from,
          fromName: recipientData.fromName,
          subject: data.subject,
          priority: data.priority || 'normal',
          preview: data.body?.substring(0, 100) || '',
          anonymous: recipientData.anonymous || null,
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
   * Build a recipient-facing clone of an anonymous message with the real sender
   * identity stripped (truly hidden). The masked email + alias come from the
   * `anonymous` block; the block itself rides along to drive the masked display.
   * The original `data` (real identity) is used only for the GM-owned sent copy.
   * @param {Object} data
   * @returns {Object}
   * @private
   */
  _maskAnonForRecipient(data) {
    const a = data.anonymous || {};
    const maskedEmail = a.maskedEmail || ANON_MASKED_EMAIL;
    return {
      ...data,
      from: maskedEmail,
      fromName: a.alias || ANON_DEFAULT_ALIAS,
      fromActorId: '',
      fromContactId: '',
      anonymous: { ...a, maskedEmail },
      // Truly hidden: the participants list on the recipient's copy names only
      // the recipients — the sender's address/ids would unmask them.
      participants: Array.isArray(data.participants) ? data.participants.filter(p => p?.role !== 'from') : [],
    };
  }

  /**
   * Resolve the real sender of an anonymous message from its GM-owned sent copy
   * (which retains the true identity). GM-side only. Scans journals for the
   * `<id>-sent` page matching the parent message id.
   * @param {string} parentMessageId — base id of the original anonymous message
   * @returns {null | {fromActorId: string, fromContactId: string, from: string}}
   * @private
   */
  _resolveAnonReplyTarget(parentMessageId) {
    if (!parentMessageId) return null;
    const base = String(parentMessageId).replace(/-sent$/, '');
    const wantId = `${base}-sent`;
    for (const journal of game.journal) {
      for (const page of journal.pages) {
        const f = page.flags?.[MODULE_ID];
        if (f?.messageId === wantId) {
          return {
            fromActorId: f.fromActorId || '',
            fromContactId: f.fromContactId || '',
            from: f.from || '',
          };
        }
      }
    }
    return null;
  }

  /**
   * Find the original anonymous masking config for a thread, so a GM reply within
   * an anonymous conversation can pre-tick Anonymous Send with the same alias/style.
   * The canonical source is the GM-owned copy of the original anon message, whose
   * `anonymous` block (role !== 'recipient' — i.e. an anon *sender* copy, not a
   * replier's masked outbox copy) retains the real masking config. GM-side only.
   * @param {Object} message — the message being replied to
   * @returns {null | {style, alias, allowReplies, traceDV, maskedEmail}}
   */
  getThreadAnonConfig(message) {
    if (!message) return null;
    const baseOf = (id) => String(id || '').replace(/-sent$/, '');
    const ids = new Set();
    if (message.messageId) ids.add(baseOf(message.messageId));
    if (message.inReplyTo) ids.add(baseOf(message.inReplyTo));
    if (Array.isArray(message.references)) message.references.forEach(r => ids.add(baseOf(r)));
    const threadId = message.threadId ? baseOf(message.threadId) : null;
    if (threadId) ids.add(threadId);

    let best = null;
    for (const journal of game.journal) {
      for (const page of journal.pages) {
        const f = page.flags?.[MODULE_ID];
        const a = f?.anonymous;
        if (!a?.enabled || a.role === 'recipient') continue;
        const pageBase = baseOf(f.messageId);
        const pageThread = f.threadId ? baseOf(f.threadId) : null;
        if (ids.has(pageBase) || (threadId && pageThread === threadId)) {
          best = a;
          // The thread-root original is definitive — stop searching.
          if (threadId && pageBase === threadId) return this._anonConfigFromBlock(a);
        }
      }
    }
    return best ? this._anonConfigFromBlock(best) : null;
  }

  /** Normalize a stored `anonymous` flag block into composer-seedable config. */
  _anonConfigFromBlock(a) {
    return {
      style: a.style || 'scrambled',
      alias: a.alias || ANON_DEFAULT_ALIAS,
      allowReplies: a.allowReplies !== false,
      traceDV: Number(a.traceDV) || 15,
      maskedEmail: a.maskedEmail || ANON_MASKED_EMAIL,
    };
  }

  /**
   * Mask the recipient on the replier's own sent copy of an anonymous reply, so
   * their outbox never reveals the anonymous party they answered. The `anonymous`
   * block carries role 'recipient' to drive the masked TO display in the viewer.
   * @param {Object} data
   * @returns {Object}
   * @private
   */
  _maskAnonReplyForSender(data) {
    const r = data.anonReply || {};
    return {
      ...data,
      to: r.maskedEmail || ANON_MASKED_EMAIL,
      toName: r.alias || ANON_DEFAULT_ALIAS,
      toActorId: '',
      toContactId: '',
      anonymous: {
        enabled: true,
        role: 'recipient',
        style: r.style || 'scrambled',
        alias: r.alias || ANON_DEFAULT_ALIAS,
        maskedEmail: r.maskedEmail || ANON_MASKED_EMAIL,
      },
    };
  }

  /**
   * GM-side: reveal (unmask) an anonymous sender on a recipient's message page
   * after a successful trace. Resolves the real identity from the GM-owned sent
   * copy and patches the player-readable page (GM can write any document); the
   * update syncs back to the player and the mask resolves to the real sender.
   * @param {string} messageId — recipient's message id
   * @param {string} inboxActorId — the recipient inbox owner (actor id)
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async revealAnonSender(messageId, inboxActorId) {
    if (!game.user.isGM) return { success: false, error: 'GM only' };
    const real = this._resolveAnonReplyTarget(messageId);
    if (!real || (!real.fromActorId && !real.fromContactId && !real.from)) {
      return { success: false, error: 'Could not resolve the real sender (no sent copy found).' };
    }

    // Read the current anonymous block and rewrite it WHOLE with traced:true —
    // a nested `anonymous.traced` dot-path update is unreliable for flags (see
    // CLAUDE.md), and the player-side unmask hinges entirely on `traced` landing.
    let currentAnon = {};
    try {
      const msgs = await this._messageRepo.getMessages(inboxActorId, { filter: 'all', includeDeleted: true });
      currentAnon = msgs.find(m => m.messageId === messageId)?.anonymous || {};
    } catch { /* fall back to a minimal block */ }

    const result = await this._messageRepo.updateMessage(inboxActorId, messageId, {
      fromActorId: real.fromActorId || '',
      fromContactId: real.fromContactId || '',
      from: real.from || '',
      anonymous: { ...currentAnon, enabled: true, traced: true },
    });
    if (result.success) {
      log.info(`Anonymous sender revealed for message ${messageId} (inbox ${inboxActorId}) → actor ${real.fromActorId || real.fromContactId || real.from}`);
    } else {
      log.warn(`revealAnonSender: page update failed for ${messageId} in inbox ${inboxActorId}: ${result.error}`);
    }
    return result;
  }

  /**
   * GM-side socket handler for an anonymous-trace attempt from a player.
   * On success, reveal the sender; either way, toast the GM with the outcome.
   * @param {object} data — { messageId, inboxActorId, success, byActorName }
   */
  async handleAnonTraceRequest(data) {
    if (!game.user.isGM) return;
    if (data?.success) {
      const result = await this.revealAnonSender(data.messageId, data.inboxActorId);
      if (result?.success) {
        this.notificationService?.showToastV2?.({
          type: 'message', icon: 'fas fa-user-secret', title: 'Anonymous Sender Traced',
          detail: `${data.byActorName || 'A player'} traced an anonymous message — identity revealed.`,
          duration: 6000, priority: 'normal',
        });
      } else {
        // The roll succeeded but the GM couldn't reveal — surface it so it isn't
        // silently swallowed (the most common cause is a missing/renamed sent copy).
        log.warn(`Anon trace reveal failed: ${result?.error || 'unknown'}`, data);
        ui.notifications?.warn(`NCM | Trace by ${data.byActorName || 'a player'} succeeded but reveal failed: ${result?.error || 'unknown'}`);
      }
    } else {
      this.notificationService?.showToastV2?.({
        type: 'message', icon: 'fas fa-user-secret', title: 'Trace Attempt Failed',
        detail: `${data.byActorName || 'A player'} failed to trace an anonymous sender.`,
        duration: 6000, priority: 'normal',
      });
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
        return { success: true, messageId: data.messageId, queued: true, reason: 'gm_offline' };
      }

      // Dead zone — the composer's Send button already reads "Queue" here, but
      // nothing enforced it: the message relayed at once and arrived heavily
      // garbled (signal 0). Honour the label: hold it in the queue, which the
      // NETWORK_CONNECTED listener flushes when the scene gets signal back.
      const forced = !!data._forceRelay;
      delete data._forceRelay;
      if (!forced && game.nightcity?.networkService?.isDeadZone) {
        this._queueMessage(data);
        return { success: true, messageId: data.messageId, queued: true, reason: 'dead_zone' };
      }

      // Relay to the GM and WAIT for the delivery confirmation. The old path
      // returned success the instant the socket emit went out, so a GM-side
      // failure (orphaned inbox, unresolvable anonymous reply…) arrived as a
      // stray toast AFTER the composer had already shown "Delivered" and
      // closed — the tester's "my player failed to send and we don't know why".
      const ack = this._awaitDeliveryAck(data.messageId);
      this.socketManager.emit(SOCKET_OPS.MESSAGE_RELAY, data);
      const result = await ack;

      if (result.timeout) {
        return {
          success: false,
          errorCode: 'RELAY_TIMEOUT',
          error: "No confirmation from the GM's client. The message may not have been delivered — ask the GM to check their console, then Retry.",
        };
      }
      const failed = Array.isArray(result.failed)
        ? result.failed.map(x => ({ ...x, error: MessageService.playerFacingError(x.error) }))
        : undefined;
      if (!result.success) {
        return {
          success: false,
          errorCode: result.errorCode || 'DELIVERY_FAILED',
          error: MessageService.playerFacingError(result.error),
          rawError: result.error,
          results: result.results,
          failed,
          delivered: result.delivered ?? 0,
        };
      }

      this.soundService?.play('send');
      return { success: true, messageId: data.messageId, results: result.results, failed, delivered: result.delivered };
    } catch (error) {
      console.error(`${MODULE_ID} | MessageService._relayMessage:`, error);
      return { success: false, error: error.message };
    }
  }

  /** How long a relayed send waits for the GM's delivery confirmation. */
  static RELAY_ACK_TIMEOUT_MS = 8000;

  /**
   * Register a pending relay and return a promise that resolves with the GM's
   * MESSAGE_DELIVERED payload for that messageId, or `{ timeout: true }`.
   * @param {string} messageId
   * @param {number} [timeoutMs]
   * @returns {Promise<{success?: boolean, error?: string, errorCode?: string, timeout?: boolean}>}
   * @private
   */
  _awaitDeliveryAck(messageId, timeoutMs = MessageService.RELAY_ACK_TIMEOUT_MS) {
    this._pendingRelays ??= new Map();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this._pendingRelays.delete(messageId);
        resolve({ timeout: true });
      }, timeoutMs);
      this._pendingRelays.set(messageId, (payload) => {
        clearTimeout(timer);
        this._pendingRelays.delete(messageId);
        resolve(payload);
      });
    });
  }

  /**
   * Translate a GM-side delivery error into a sentence the PLAYER can act on.
   * The raw repository text ("Could not access inbox journal") is kept on the
   * result as `rawError` and in the console for the GM.
   * @param {string} raw
   * @returns {string}
   */
  static playerFacingError(raw) {
    const r = String(raw || '').trim();
    const map = [
      [/could not access inbox journal/i,
        "The recipient's inbox could not be opened on the GM's side. Ask your GM to check Admin → Tools → Orphan Audit."],
      [/no recipient inbox target/i,
        'No inbox exists for that address. Check the recipient and try again.'],
      [/anonymous reply target/i,
        "The anonymous sender could not be traced back for delivery. Tell your GM — the original message's sent copy may be missing."],
      [/lacks permission|does not have permission/i,
        "The GM's client could not write the message (a permission error). Ask the GM to check their console."],
    ];
    for (const [re, text] of map) if (re.test(r)) return text;
    return r ? `Delivery failed on the GM's side: ${r}` : "Delivery failed on the GM's side for an unknown reason.";
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

    // The GM's junk list wins over everything below — an address marked junk is junk
    // for every recipient, whether or not the unknown-sender filter is on.
    if (!data.anonymous?.enabled && !data.status?.sent && !data.isBroadcast
        && game.nightcity?.spamService?.isListedJunk?.(data.from)) {
      log.debug('SpamFilter: route — sender is on the junk list', { from: data.from });
      return true;
    }

    // Master toggle
    let enabled = false;
    try { enabled = game.settings.get(MODULE_ID, 'spamUnknownSenderEnabled'); } catch { return bail('settings unavailable'); }
    if (!enabled) return bail('filter disabled');

    // Only normal inbound mail to a player-owned actor (players check Spam).
    const toActor = data.toActorId ? game.actors.get(data.toActorId) : null;
    if (!toActor?.hasPlayerOwner) return bail('recipient is not a player-owned actor');
    if (data.status?.sent || data.status?.spam) return bail('already sent/spam');
    if (data.isBroadcast || data.type === 'broadcast') return bail('broadcast');
    // Anonymous mail is a deliberate GM action — never auto-route it to Spam
    // (the sender is "unknown" by design, which would otherwise always match).
    if (data.anonymous?.enabled) return bail('anonymous send (spam-exempt)');

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
  /**
   * GM sends FROM an NPC actor that has no master-directory entry → create one
   * (linked to the actor, with its portrait + CPR role) and tell the GM. This
   * keeps the directory the source of truth: the player can Add the sender
   * as a VERIFIED contact, reply, and a later GM rename propagates. Skips
   * player-owned senders, players, and anything already in the directory by
   * actor or by email. Gated by the world setting `autoRegisterNpcSenders`.
   * Mutates `data.fromContactId` on success. Never blocks the send.
   * @param {object} data — the outgoing message data (after `from` is resolved)
   * @param {Actor|null} fromActor
   * @returns {Promise<object|null>} the created contact, or null
   */
  async _autoRegisterNpcSender(data, fromActor) {
    try {
      if (!game.user?.isGM || !fromActor || fromActor.hasPlayerOwner) return null;
      if (game.settings.get(MODULE_ID, 'autoRegisterNpcSenders') === false) return null;
      const mcs = game.nightcity?.masterContactService;
      if (!mcs?.addContact) return null;

      const byActor = mcs.getByActorId?.(fromActor.id);
      if (byActor) {
        if (!data.fromContactId) data.fromContactId = byActor.id;
        return null;
      }
      if (data.from && mcs.getByEmail?.(data.from)) return null;

      // CPR roles are actor items (type 'role'), not actor.system.role.
      const roleItem = fromActor.items?.find?.(i => i.type === 'role');
      const img = fromActor.img || '';
      const created = await mcs.addContact({
        name: fromActor.name,
        email: data.from || '',
        actorId: fromActor.id,
        portrait: img && !img.includes('mystery-man') ? img : null,
        role: (roleItem?.name || '').toLowerCase().trim() || 'npc',
        notes: `Auto-registered when the GM sent "${data.subject || '(no subject)'}" from this actor.`,
      });
      if (!created?.success) {
        log.warn(`MessageService: auto-register of "${fromActor.name}" failed — ${created?.error || 'unknown'}`);
        return null;
      }
      data.fromContactId = created.contact.id;
      ui.notifications?.info(
        `NCM | "${fromActor.name}" wasn't in the Master Contact list — added it (${created.contact.email}). Edit the name/details in Admin → Contacts.`
      );
      log.info(`MessageService: auto-registered NPC sender "${fromActor.name}" as master contact ${created.contact.id}`);
      return created.contact;
    } catch (err) {
      log.warn(`MessageService: auto-register skipped — ${err?.message || err}`);
      return null;
    }
  }

  /**
   * Has `target` ever sent mail to `inboxActorId`'s mailbox? Used by the
   * player send gate so a reply (or a fresh message back) to someone who
   * wrote first is never bounced as CONTACT NOT FOUND. Spam-routed mail and
   * still-masked anonymous mail don't count — those senders are deliberately
   * unknown to the player.
   * @param {string} inboxActorId — the sending player's actor
   * @param {{actorId?: string, contactId?: string, email?: string}} target
   * @returns {Promise<boolean>}
   */
  async _isKnownCorrespondent(inboxActorId, { actorId, contactId, email } = {}) {
    if (!inboxActorId || (!actorId && !contactId && !email)) return false;
    try {
      const msgs = await this._messageRepo.getMessages(inboxActorId, { filter: 'all' });
      const norm = (email || '').toLowerCase().trim();
      return msgs.some(m => {
        if (m.status?.sent || m.status?.spam) return false;
        if (String(m.messageId || '').endsWith('-sent')) return false;
        if (m.anonymous?.enabled && !m.anonymous?.traced) return false;
        if (actorId && m.fromActorId === actorId) return true;
        if (contactId && m.fromContactId === contactId) return true;
        return !!norm && (m.from || '').toLowerCase().trim() === norm;
      });
    } catch (err) {
      log.warn(`MessageService: correspondent check failed — ${err?.message || err}`);
      return false;
    }
  }

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
      _queueReason: game.nightcity?.networkService?.isDeadZone ? 'dead_zone' : 'gm_offline',
    });
    console.log(`${MODULE_ID} | Message queued. Queue size: ${this._messageQueue.length}`);
    this._syncQueueToGm();
  }

  // ─── Held mail, seen from the GM (Admin → Messages → Outbox) ──
  //
  // The queue lives on the client that queued it (a player in a dead zone, or
  // with no GM online). A player tells the GM what they are holding whenever a
  // GM is online to hear it; the GM can deliver it now (the GM delivers the
  // reported, already-stamped data itself and tells the player to drop it) or
  // cancel it. Mail queued while no GM was online is reported the next time the
  // queue changes.

  /** One row per held message: local ones, plus (GM) every player's report. */
  getQueue() {
    const row = (d, extra = {}) => ({
      messageId: d.messageId || d.id || '',
      fromActorId: d.fromActorId || null, toActorId: d.toActorId || null,
      from: d.fromName || d.from || '', to: d.toName || d.to || '',
      subject: d.subject || '', eddies: Number(d.eddies) || 0,
      recipientCount: Array.isArray(d._fanout) ? d._fanout.length : 1,
      queuedAt: d._queuedAt || null,
      reason: d._queueReason === 'dead_zone' ? 'Dead zone — no signal' : d._queueReason === 'gm_offline' ? 'No GM was online' : (d._queueReason || 'Held'),
      ...extra,
    });
    const out = this._messageQueue.map((d) => row(d));
    for (const [userId, rep] of this._remoteQueues || []) {
      for (const d of rep.entries || []) out.push(row(d, { userId, userName: rep.userName || 'a player', remote: true }));
    }
    return out;
  }

  /** Player → GM: report what this client is holding (no-op for a GM or with no GM online). */
  _syncQueueToGm() {
    try {
      if (game.user?.isGM || !game.users?.find?.(u => u.isGM && u.active)) return;
      this.socketManager?.emit?.(SOCKET_OPS.MESSAGE_QUEUE_SYNC, { userName: game.user?.name, entries: this._messageQueue });
    } catch (err) { console.warn(`${MODULE_ID} | queue sync failed:`, err); }
  }

  /** GM: store a player's report of held mail. */
  receiveQueueSync(data, senderUserId) {
    if (!game.user?.isGM || !senderUserId) return;
    this._remoteQueues ||= new Map();
    if (!data?.entries?.length) this._remoteQueues.delete(senderUserId);
    else this._remoteQueues.set(senderUserId, { userName: data.userName || game.users?.get?.(senderUserId)?.name, entries: data.entries });
    this.eventBus?.emit?.('schedule:updated', { queue: true });
  }

  /** Player: the GM delivered or cancelled one of my held messages — drop it. */
  handleQueueCommand(data) {
    const i = this._messageQueue.findIndex(d => d.messageId === data?.messageId);
    if (i < 0) return;
    const [d] = this._messageQueue.splice(i, 1);
    if (data.op === 'cancel') ui.notifications?.warn?.(`NCM | The GM cancelled your held message "${d.subject || '(no subject)'}".`);
    this._syncQueueToGm();
  }

  /** Deliver one held message now. Local: relay it (past the dead zone). GM on a player's: deliver it here. */
  async forceDeliver(messageId) {
    const i = this._messageQueue.findIndex(d => d.messageId === messageId);
    if (i >= 0) {
      const [d] = this._messageQueue.splice(i, 1);
      this._syncQueueToGm();
      if (game.user?.isGM) {
        const r = Array.isArray(d._fanout) && d._fanout.length ? await this._deliverMany({ ...d }, d._fanout) : await this._deliverMessage(d);
        return { success: !!r?.success, error: r?.error };
      }
      return this._relayMessage({ ...d, _forceRelay: true });
    }
    if (!game.user?.isGM) return { success: false, error: 'Not in the queue' };
    for (const [userId, rep] of this._remoteQueues || []) {
      const d = (rep.entries || []).find(x => x.messageId === messageId);
      if (!d) continue;
      rep.entries = rep.entries.filter(x => x !== d);
      // handleMessageRelay delivers, records a failure and acks the player (who
      // is not waiting on it, so they get the late-ack toast).
      await this.handleMessageRelay({ ...d }, userId);
      this.socketManager?.emit?.(SOCKET_OPS.MESSAGE_QUEUE_CMD, { forUserId: userId, op: 'delivered', messageId });
      return { success: true };
    }
    return { success: false, error: 'That message is no longer held' };
  }

  /** Cancel one held message (it is never delivered). */
  async cancelQueued(messageId) {
    const i = this._messageQueue.findIndex(d => d.messageId === messageId);
    if (i >= 0) { this._messageQueue.splice(i, 1); this._syncQueueToGm(); return { success: true }; }
    for (const [userId, rep] of this._remoteQueues || []) {
      if (!(rep.entries || []).some(x => x.messageId === messageId)) continue;
      rep.entries = rep.entries.filter(x => x.messageId !== messageId);
      this.socketManager?.emit?.(SOCKET_OPS.MESSAGE_QUEUE_CMD, { forUserId: userId, op: 'cancel', messageId });
      return { success: true };
    }
    return { success: false, error: 'That message is no longer held' };
  }

  // ─── Delivery failures (Admin → Messages → Outbox → Didn't arrive) ──
  //
  // A refused or failed send used to be a GM toast and nothing else. Every
  // place that toasts the GM about one (a player's relay, a GM fan-out with
  // refused recipients) also writes a row here; Retry re-sends the mail to the
  // recipients that failed. Retries never carry eddies (the sender was
  // refunded — re-sending money would mint it).

  static FAILURE_LOG_CAP = 100;

  /** What a retry sends: the message without its stamps, its eddies or its fan-out. */
  _retryPayload(data, failed = null) {
    const keep = ['fromActorId', 'fromContactId', 'from', 'subject', 'body', 'priority', 'isBroadcast', 'attachments',
      'threadId', 'inReplyTo', 'references', 'anonymous', 'anonReply', 'toActorId', 'toContactId', 'to', 'contentType', 'contentData'];
    const out = {};
    for (const k of keep) if (data?.[k] !== undefined && data[k] !== null) out[k] = foundry.utils?.deepClone ? foundry.utils.deepClone(data[k]) : data[k];
    if (failed?.length) {
      delete out.toActorId; delete out.toContactId; delete out.to;
      out.recipients = failed.map(x => ({ actorId: x.actorId || null, contactId: x.contactId || null, email: x.email || '', name: x.name || '' }));
    }
    return out;
  }

  /** GM: append a row to the failure log. Never throws. */
  async recordDeliveryFailure({ data, result, source = 'relay', byUserName = '' }) {
    try {
      if (!game.user?.isGM) return null;
      const failed = result?.failed?.length ? result.failed : null;
      const row = {
        id: foundry.utils?.randomID?.() || String(Date.now()),
        at: new Date().toISOString(),
        gameAt: this._getTimestamp?.() || null,
        baseId: String(data?.messageId || '').replace(/-sent$/, ''),
        source,
        byUserName,
        fromName: data?.fromName || data?.from || byUserName || 'Unknown',
        toName: failed ? failed.map(x => x.name || x.email).join(', ') : (data?.toName || data?.to || 'unknown recipient'),
        groupSize: Array.isArray(data?._fanout) ? data._fanout.length : (failed ? (result.results?.length || failed.length) : 1),
        subject: data?.subject || '',
        why: failed ? failed.map(x => `${x.name || x.email || '?'}: ${x.error || 'unknown error'}`).join(' · ') : (result?.error || 'unknown error'),
        hadEddies: Number(data?.eddies) > 0,
        retry: this._retryPayload(data, failed),
      };
      const list = [row, ...(game.settings.get(MODULE_ID, 'deliveryFailures') || [])].slice(0, MessageService.FAILURE_LOG_CAP);
      await game.settings.set(MODULE_ID, 'deliveryFailures', list);
      return row;
    } catch (err) {
      console.warn(`${MODULE_ID} | could not record a delivery failure:`, err);
      return null;
    }
  }

  getDeliveryFailures() {
    try { return game.settings.get(MODULE_ID, 'deliveryFailures') || []; } catch { return []; }
  }

  async dismissDeliveryFailure(id) {
    const list = this.getDeliveryFailures();
    await game.settings.set(MODULE_ID, 'deliveryFailures', id ? list.filter(r => r.id !== id) : []);
    return { success: true };
  }

  /** GM: send a failed message again; a success removes the row, a failure updates its reason. */
  async retryDeliveryFailure(id) {
    const row = this.getDeliveryFailures().find(r => r.id === id);
    if (!row) return { success: false, error: 'That failure is no longer listed' };
    const result = await this.sendMessage(foundry.utils?.deepClone ? foundry.utils.deepClone(row.retry) : { ...row.retry });
    const list = this.getDeliveryFailures();
    if (result?.success && !result.failed?.length) {
      await game.settings.set(MODULE_ID, 'deliveryFailures', list.filter(r => r.id !== id));
    } else {
      const why = result?.failed?.length ? result.failed.map(x => `${x.name}: ${x.error || 'unknown error'}`).join(' · ') : (result?.error || 'unknown error');
      await game.settings.set(MODULE_ID, 'deliveryFailures', list.map(r => r.id === id ? { ...r, why, retriedAt: new Date().toISOString() } : r));
    }
    return result;
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
      // A held fan-out is already stamped and split — relay it as is (re-running
      // sendMessage on it found no recipient).
      if (Array.isArray(queue[i]._fanout) && queue[i]._fanout.length) await this._relayMessage(queue[i]);
      else await this.sendMessage(queue[i]);
    }
    this._syncQueueToGm();

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
  buildReply(originalMessage, fromActorId, replyBody, { all = false, fromContactId = null } = {}) {
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

    // Anonymous reply — the original sender was masked. The replier can't know
    // the real target; carry an anonReply descriptor (no toActorId/to) so the GM
    // resolves the true recipient at delivery and masks it on the sent copy.
    const anon = originalMessage.anonymous;
    if (anon?.enabled && anon.role !== 'recipient' && !anon.traced) {
      reply.anonReply = {
        parentMessageId: String(originalMessage.messageId || '').replace(/-sent$/, ''),
        alias: anon.alias || ANON_DEFAULT_ALIAS,
        style: anon.style || 'scrambled',
        maskedEmail: anon.maskedEmail || ANON_MASKED_EMAIL,
      };
      return reply;
    }

    // Resolve reply target — actor or contact
    if (originalMessage.fromActorId) {
      reply.toActorId = originalMessage.fromActorId;
      // Sent from one of that character's identities → answer THAT identity.
      if (originalMessage.fromContactId) {
        reply.toContactId = originalMessage.fromContactId;
        if (originalMessage.from) reply.to = originalMessage.from;
      }
    } else if (originalMessage.fromContactId) {
      reply.toContactId = originalMessage.fromContactId;
      reply.to = originalMessage.from; // Use the email directly
    } else if (originalMessage.from) {
      // Last resort: try to find by email
      reply.to = originalMessage.from;
    }

    // Mail that reached one of the replier's identities goes back out FROM it.
    const mine = replyIdentity(game.nightcity?.masterContactService?.getAll?.() || [], originalMessage, { actorId: fromActorId, contactId: fromContactId });
    if (mine) { reply.fromContactId = mine.id; reply.from = mine.email || undefined; }

    // Reply All — everyone on the message except the replier. Participants are
    // address-keyed members (participants.js); self is excluded by actor id,
    // address AND directory id so the replier never mails themselves.
    if (all) {
      const others = this.replyAllRecipients(originalMessage, fromActorId);
      if (others.length) reply.recipients = others;
    }

    return reply;
  }

  /**
   * Who a Reply All from `fromActorId` goes to: the original sender plus every
   * other participant, minus the replier. Empty when the message has no
   * participants list (pre-fan-out mail) or is anonymous (the mask would leak).
   * @param {Object} originalMessage
   * @param {string} fromActorId
   * @returns {Array<{actorId: string|null, contactId: string|null, email: string, name: string}>}
   */
  replyAllRecipients(originalMessage, fromActorId) {
    const anon = originalMessage?.anonymous;
    if (anon?.enabled && !anon.traced) return [];
    const parts = Array.isArray(originalMessage?.participants) ? originalMessage.participants : [];
    if (!parts.length) return [];
    const actor = fromActorId ? game.actors?.get(fromActorId) : null;
    const me = selfKeys({
      actorId: fromActorId,
      email: fromActorId ? this._contactRepo?.getActorEmail?.(fromActorId) : '',
      contactId: game.nightcity?.masterContactService?.getByActorId?.(fromActorId)?.id || '',
    });
    if (actor?.name) me.add(String(actor.name).toLowerCase());
    return othersFor(parts, me).map(p => ({
      actorId: p.hint?.actorId || null,
      contactId: p.hint?.contactId || null,
      email: p.email || '',
      name: p.name || '',
    }));
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
   * Mark a message unread again (the inbox's own button, Admin → All mail).
   * @param {string} actorId
   * @param {string} messageId
   */
  async markAsUnread(actorId, messageId) {
    const result = await this._messageRepo.markAsUnread(actorId, messageId);
    if (result.success) {
      this.eventBus.emit(EVENTS.MESSAGE_READ, { messageId, actorId, unread: true });
      this.socketManager.emit(SOCKET_OPS.MESSAGE_STATUS_UPDATE, { actorId, messageId, update: 'unread' });
    }
    return result;
  }

  /**
   * Mark every unread message in an actor's mailbox as read — one batched
   * journal write via the repository, then ONE event/socket sync (listeners
   * only read `actorId`, so the missing per-message id is fine).
   * @param {string} actorId
   * @returns {Promise<{success: boolean, count: number, error?: string}>}
   */
  async markAllAsRead(actorId) {
    const result = await this._messageRepo.markAllAsRead(actorId);
    if (result.success && result.count > 0) {
      this.eventBus.emit(EVENTS.MESSAGE_READ, { messageId: null, actorId, all: true, readAt: new Date().toISOString() });
      this.socketManager.emit(SOCKET_OPS.MESSAGE_STATUS_UPDATE, {
        actorId, messageId: null, update: 'read', all: true,
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
      return { success: false, error: 'No character assigned' };
    }

    // Find the message in inbox
    const inbox = await this._messageRepo.getInboxJournal(actorId);
    if (!inbox) return { success: false, error: 'Inbox not found' };

    const page = inbox.pages.find(p =>
      p.flags?.[MODULE_ID]?.messageId === messageId
    );
    if (!page) return { success: false, error: 'Message not found' };

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
      return { success: false, error: 'Skill system not available' };
    }

    // An animated caller (the viewer's cipher grid) passes deferChat: it posts
    // the chat card and plays the outcome at its own climax, so this service
    // stays quiet. A caller with a window but no animation passes `reveal`.
    const quiet = !!options.deferChat;
    const result = await skillSvc.performCheck(actor, skillName, {
      dc,
      luckSpend,
      flavor: `Decrypting ${encryption.type || 'ICE'}-protected message`,
      context: 'ncm-message-decrypt',
      deferChat: quiet,
      reveal: options.reveal ? { verdictSound: false, ...options.reveal } : null,
    });

    if (result?.success) {
      await this._messageRepo.updateMessageFlags(actorId, messageId, {
        status: { ...flags.status, encrypted: false },
      });
      if (!quiet) this.soundService?.play('hack-success');
      this.eventBus?.emit(EVENTS.MESSAGE_STATUS_CHANGED, { messageId, actorId });
      game.nightcity?.traceService?.logSuccess({ actor, action: 'message-decrypt', objectName: flags?.subject || 'encrypted message', targetKind: 'message', targetMessageId: messageId, severity: 'hostile' });
      if (!quiet) ui.notifications.info('NCM | Message decrypted.');
      return { success: true, roll: result };
    }

    if (!quiet) this.soundService?.play('hack-fail');

    // Trace funnel (§6a) — a failed message decrypt (may carry ICE).
    game.nightcity?.traceService?.fireTrace({
      actor, action: 'message-decrypt', objectName: flags?.subject || 'encrypted message', targetKind: 'message', targetMessageId: messageId, severity: 'hostile',
      dv: dc ?? null, margin: (result?.total != null && dc != null) ? result.total - dc : null,
    });

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

    if (!quiet) ui.notifications.warn(`NCM | Decryption failed. (${result?.total ?? '?'} vs DV ${dc})`);
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
  async handleMessageRelay(data, senderUserId = null) {
    if (!game.user.isGM) return;

    console.log(`${MODULE_ID} | GM handling message relay: ${data.messageId}`);
    let result;
    // "Send as the account" from a terminal: the GM verifies the machine allows
    // it and that the sender really is that account (TerminalService.verifyAccountSend).
    if (data.terminalSend) {
      const v = game.nightcity?.terminalService?.verifyAccountSend?.(data) || { ok: false, reason: 'terminals unavailable' };
      if (!v.ok) result = { success: false, error: `Refused: ${v.reason}.` };
    }
    if (result) { /* refused above */ } else if (Array.isArray(data._fanout) && data._fanout.length) {
      const base = { ...data };
      delete base._fanout;
      result = await this._deliverMany(base, data._fanout);
    } else {
      result = await this._deliverMessage(data);
    }

    // The GM is the one who can FIX a failed delivery (orphaned inbox, bad
    // directory entry), so they hear about it too — previously only the sender
    // got a (missable) toast and the GM saw nothing.
    if (!result.success || result.failed?.length) {
      const who = data.fromName || data.from || game.users.get(senderUserId)?.name || 'A player';
      const to = data.toName || data.to || data.toActorId || data.toContactId || 'unknown recipient';
      const why = result.failed?.length
        ? result.failed.map(x => `${x.name}: ${x.error || 'unknown error'}`).join(' · ')
        : (result.error || 'unknown error');
      console.warn(`${MODULE_ID} | Relayed message ${data.messageId} from ${who} to ${to} failed: ${why}`);
      ui.notifications.warn(`NCM | Could not deliver ${who} → ${to}: ${why}`, { permanent: true });
      // …and it stays listed in Admin → Messages → Outbox → Didn't arrive.
      await this.recordDeliveryFailure({ data, result, source: 'relay', byUserName: game.users.get(senderUserId)?.name || '' });
    }

    // Send delivery confirmation back to the sender. `forUserId` lets every
    // other client ignore it — the socket is a broadcast.
    this.socketManager.emit(SOCKET_OPS.MESSAGE_DELIVERED, {
      messageId: data.messageId,
      success: result.success,
      error: result.error,
      errorCode: result.errorCode,
      delivered: result.delivered,
      failed: result.failed,
      results: result.results,
      forUserId: senderUserId,
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
    // Not ours — the socket broadcasts to every client, and this used to toast
    // "Message delivery failed" at players who never sent anything.
    if (data.forUserId && data.forUserId !== game.user.id) return;

    const pending = this._pendingRelays?.get(data.messageId);
    if (pending) {
      // The sending composer is waiting on this — it shows the outcome itself.
      pending(data);
      return;
    }

    // No one waiting (ack after the timeout, or a legacy client): fall back to
    // the toast so the result isn't lost.
    if (data.success) {
      console.log(`${MODULE_ID} | Message ${data.messageId} delivered successfully`);
    } else {
      console.warn(`${MODULE_ID} | Message ${data.messageId} delivery failed: ${data.error}`);
      ui.notifications.warn(`Message delivery failed: ${MessageService.playerFacingError(data.error)}`);
    }
  }

  // ─── Share to Chat ────────────────────────────────────────

  /**
   * The body as chat HTML. Composer bodies are already HTML (sanitised at compose),
   * so they pass through; a plain-text body (macro API, legacy mail) keeps its line
   * breaks and gets its angle brackets escaped — never rendered raw, never shown as
   * literal tags.
   * @param {string} body
   * @returns {string}
   */
  static chatBodyHtml(body) {
    const s = String(body ?? '');
    if (/<\/?[a-z][^>]*>/i.test(s)) return s;
    return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/\r?\n/g, '<br>');
  }

  /**
   * Split a long body for the card's fold: the first paragraph stays open, the
   * rest sits in a <details> that opens EXPANDED (the whole message is what was
   * asked for) and folds on click. Short bodies are not split at all.
   * @param {string} html  the card-ready body (chatBodyHtml)
   * @returns {{ head: string, tail: string, isLong: boolean, moreLines: number }}
   */
  static splitChatBody(html) {
    const s = String(html ?? '');
    const text = (x) => x.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const blocks = (x) => (x.match(/<(p|li|br|h\d|blockquote)\b/gi) || []).length;
    const long = text(s).length > 700 || blocks(s) > 8;
    if (!long) return { head: s, tail: '', isLong: false, moreLines: 0 };
    // cut after the first paragraph (or first line break), never mid-tag
    let cut = -1;
    const p = s.indexOf('</p>');
    if (p >= 0) cut = p + 4;
    else { const br = s.indexOf('<br'); if (br >= 0) cut = s.indexOf('>', br) + 1; }
    if (cut <= 0 || cut >= s.length - 1) return { head: s, tail: '', isLong: false, moreLines: 0 };
    const head = s.slice(0, cut), tail = s.slice(cut);
    const moreLines = Math.max(1, Math.ceil(text(tail).length / 48) + blocks(tail));
    return { head, tail, isLong: true, moreLines };
  }

  /**
   * Share a message to chat as the ONE shared-message card. The player's inbox
   * (Share) and Admin → Messages (Share to Chat) both land here — the admin path
   * used to post its own "GM Intercept — Not visible to players" card to a PUBLIC
   * chat message, cut the body at 200 characters, and escaped the body's HTML into
   * visible tags (tester, 2026-10-20). The WHOLE body ships; From/To resolve to
   * names the directory-first way with the address beneath; a masked anonymous
   * sender shows its alias, never the real name.
   * @param {Object} message
   * @param {string} [actorId]            the character sharing it (speaker + "via")
   * @param {object} [o]
   * @param {string} [o.sharedBy]         "via" label override (the admin path passes 'GM')
   */
  async shareToChat(message, actorId, { sharedBy } = {}) {
    try {
      const anon = message.anonymous;
      const masked = !!(anon?.enabled && !anon.traced && anon.role !== 'recipient');
      const fromName = masked
        ? (anon.alias || ANON_DEFAULT_ALIAS)
        : resolveDisplayName({ contactId: message.fromContactId, actorId: message.fromActorId, email: message.from, storedName: message.fromName }, message.from || 'Unknown');
      const toName = resolveDisplayName({ contactId: message.toContactId, actorId: message.toActorId, email: message.to, storedName: message.toName }, message.to || 'Unknown');
      const bodyHtml = MessageService.chatBodyHtml(message.body);
      const fold = MessageService.splitChatBody(bodyHtml);
      // People rows carry the ids the per-client add-contact hook needs — NEVER
      // for a masked anonymous sender (the card would leak the real identity).
      // The directory id is backfilled from the actor / address so a player whose
      // contact entry is keyed on the master id still reads as "in contacts".
      const master = game.nightcity?.masterContactService;
      const dirId = (contactId, actorId, email) => contactId
        || (actorId && master?.getByActorId?.(actorId)?.id)
        || (email && master?.getByEmail?.(email)?.id)
        || '';
      const from = masked
        ? { name: fromName, addr: '', portrait: '' }
        : { name: fromName, addr: (message.from && message.from !== fromName) ? message.from : '', email: message.from || '', actorId: message.fromActorId || '',
            contactId: dirId(message.fromContactId, message.fromActorId, message.from),
            portrait: resolveDisplayPortrait({ contactId: message.fromContactId, actorId: message.fromActorId, email: message.from }) || '' };
      const to = { name: toName, addr: (message.to && message.to !== toName) ? message.to : '', email: message.to || '', actorId: message.toActorId || '',
        contactId: dirId(message.toContactId, message.toActorId, message.to),
        portrait: resolveDisplayPortrait({ contactId: message.toContactId, actorId: message.toActorId, email: message.to }) || '' };
      const via = sharedBy || (actorId ? game.actors.get(actorId)?.name : game.user.name);
      const content = await renderTemplate(
        `modules/${MODULE_ID}/templates/chat/message-card.hbs`,
        {
          message: { ...message, messageIdShort: (message.messageId || '').slice(0, 8), bodyHtml, fromName, toName },
          from, to,
          bodyHead: fold.head, bodyTail: fold.tail, isLong: fold.isLong, moreLines: fold.moreLines,
          when: chatCardTime(message.timestamp),
          sharedBy: via,
          viaGM: !actorId,
          showPriority: !!(message.priority && message.priority !== 'normal'),
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

  /**
   * Resolve the GM composer's per-message overrides. Both are GM-ONLY and
   * opt-in by flag, so every other caller (players, the dead-zone queue flush,
   * relayed sends) keeps the old rule: the sender's live connection + now.
   *  - `networkOverride` + `network`  → send via that network (must exist).
   *  - `backdated` + `timestamp`      → stamp that date; only a PAST date
   *    counts (a future one is the scheduler's job, not a stamp).
   * @returns {{ viaNetwork: object|null, backdate: string|null }}
   */
  _resolveSendOverrides(data, networkService) {
    if (!game.user?.isGM) return { viaNetwork: null, backdate: null };
    const viaNetwork = (data.networkOverride && data.network)
      ? (networkService?.getNetwork?.(data.network) ?? null)
      : null;
    let backdate = null;
    if (data.backdated && data.timestamp) {
      const ms = new Date(data.timestamp).getTime();
      if (Number.isFinite(ms) && ms <= this._nowMs()) backdate = new Date(ms).toISOString();
    }
    return { viaNetwork, backdate };
  }

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
