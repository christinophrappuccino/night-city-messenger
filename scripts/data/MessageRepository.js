/**
 * Message Repository
 * @file scripts/data/MessageRepository.js
 * @module cyberpunkred-messenger
 * @description Journal-based CRUD operations for messages.
 * Each actor has one inbox journal. Messages are stored as journal pages with flags.
 * Inbox journals are keyed by actor ID with naming convention: NCM-Inbox-{actorId}
 */

import { MODULE_ID, EVENTS } from '../utils/constants.js';

export class MessageRepository {
  constructor() {
    /** @type {Map<string, JournalEntry>} Cache of actor ID → inbox journal */
    this._inboxCache = new Map();
    /** @type {Folder|null} Cached NCM Messages folder */
    this._folder = null;
  }

  // ─── Service Accessors ────────────────────────────────────

  get eventBus() { return game.nightcity.eventBus; }
  get timeService() { return game.nightcity.timeService; }

  // ─── Inbox Folder Management ────────────────────────────────

  /**
   * Get or create the "NCM Messages" folder for inbox journals.
   * Keeps the journal sidebar clean.
   * @returns {Promise<Folder|null>}
   */
  async _getInboxFolder() {
    if (this._folder && game.folders.get(this._folder.id)) return this._folder;

    // Search existing
    this._folder = game.folders.find(f =>
      f.type === 'JournalEntry' && f.name === 'NCM Messages'
    ) ?? null;

    if (!this._folder && game.user.isGM) {
      this._folder = await Folder.create({
        name: 'NCM Messages',
        type: 'JournalEntry',
        color: '#330000',
        sorting: 'a',
      });
    }

    return this._folder;
  }

  /**
   * Compute the correct ownership object for an actor's inbox.
   * Mirrors the actor's player owners onto the journal.
   * @param {Actor} actor
   * @returns {object} Ownership object for JournalEntry
   */
  _computeOwnership(actor) {
    const ownership = { default: 0 };
    if (actor?.hasPlayerOwner) {
      for (const [userId, level] of Object.entries(actor.ownership)) {
        if (level === CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER && userId !== 'default') {
          ownership[userId] = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
        }
      }
    }
    return ownership;
  }

  /**
   * Verify and repair journal permissions to match the actor's ownership.
   * Only runs for GM. Skips if permissions already match.
   * @param {JournalEntry} journal
   * @param {Actor} actor
   */
  async _repairPermissions(journal, actor) {
    if (!game.user.isGM || !journal || !actor) return;

    const expected = this._computeOwnership(actor);
    const current = journal.ownership || {};

    // Check if repair is needed
    let needsRepair = false;
    for (const [userId, level] of Object.entries(expected)) {
      if (userId === 'default') continue;
      if (current[userId] !== level) {
        needsRepair = true;
        break;
      }
    }

    if (needsRepair) {
      await journal.update({ ownership: expected });
      console.log(`${MODULE_ID} | Repaired inbox permissions for ${actor.name}`);
    }

    // Also ensure journal is in the NCM folder
    const folder = await this._getInboxFolder();
    if (folder && journal.folder?.id !== folder.id) {
      await journal.update({ folder: folder.id });
    }
  }

  /**
   * GM tool: Repair permissions on ALL inbox journals.
   * Call via: game.nightcity.messageRepository.repairAllInboxPermissions()
   * @returns {Promise<number>} Number of journals repaired
   */
  async repairAllInboxPermissions() {
    if (!game.user.isGM) {
      ui.notifications.warn('NCM | GM only.');
      return 0;
    }

    let repaired = 0;
    const folder = await this._getInboxFolder();

    for (const journal of game.journal) {
      if (!journal.name?.startsWith('NCM-Inbox-')) continue;

      // Extract actor ID from journal name
      const isContactInbox = journal.name.startsWith('NCM-Inbox-Contact-');
      if (isContactInbox) {
        // Contact inboxes are GM-only, just ensure folder
        if (folder && journal.folder?.id !== folder.id) {
          await journal.update({ folder: folder.id });
        }
        continue;
      }

      const actorId = journal.name.replace('NCM-Inbox-', '');
      const actor = game.actors?.get(actorId);
      if (!actor) continue;

      await this._repairPermissions(journal, actor);
      repaired++;
    }

    ui.notifications.info(`NCM | Repaired permissions on ${repaired} inbox journal(s).`);
    return repaired;
  }

  // ─── Inbox Journal Management ─────────────────────────────

  /**
   * Get or create the inbox journal for an actor OR a master contact.
   * Resolves the owner transparently:
   *   - If ownerId matches a Foundry actor → actor inbox (NCM-Inbox-{actorId})
   *   - If ownerId matches a master contact → contact inbox (NCM-Inbox-Contact-{contactId})
   * Player characters get journals owned by the player's user.
   * NPCs and contacts get journals owned by the GM.
   * @param {string} ownerId - Actor ID or master contact ID
   * @returns {Promise<JournalEntry|null>}
   */
  async getInboxJournal(ownerId) {
    if (!ownerId) return null;

    // Check cache first
    if (this._inboxCache.has(ownerId)) {
      const cached = this._inboxCache.get(ownerId);
      if (game.journal.get(cached.id)) return cached;
      this._inboxCache.delete(ownerId);
    }

    // ── Determine inbox type ──
    const actor = game.actors?.get(ownerId);
    const isActorInbox = !!actor;

    let journalName;
    let ownerLabel;

    if (isActorInbox) {
      journalName = `NCM-Inbox-${ownerId}`;
      ownerLabel = actor.name;
    } else {
      // Check if it's a master contact ID
      const contact = game.nightcity?.masterContactService?.getContact(ownerId);
      if (!contact) {
        console.warn(`${MODULE_ID} | No actor or master contact found for ID "${ownerId}"`);
        return null;
      }
      journalName = `NCM-Inbox-Contact-${ownerId}`;
      ownerLabel = contact.name;
    }

    // ── Search existing journals ──
    let journal = game.journal.find(j => j.name === journalName);

    if (!journal) {
      // Only GM can create journals
      if (!game.user.isGM) {
        console.warn(`${MODULE_ID} | Non-GM cannot create inbox for ${ownerLabel} (${ownerId})`);
        return null;
      }

      // Determine ownership
      const ownership = isActorInbox ? this._computeOwnership(actor) : { default: 0 };

      // Get or create the NCM Messages folder
      const folder = await this._getInboxFolder();

      journal = await JournalEntry.create({
        name: journalName,
        ownership,
        folder: folder?.id || null,
        flags: {
          [MODULE_ID]: {
            type: isActorInbox ? 'inbox' : 'contactInbox',
            actorId: isActorInbox ? ownerId : null,
            contactId: isActorInbox ? null : ownerId,
            createdAt: new Date().toISOString(),
          }
        }
      });

      console.log(`${MODULE_ID} | Created ${isActorInbox ? 'actor' : 'contact'} inbox journal for ${ownerLabel} (${ownerId})`);
    } else if (isActorInbox && game.user.isGM) {
      // Existing journal — verify permissions match actor ownership
      await this._repairPermissions(journal, actor);
    }

    this._inboxCache.set(ownerId, journal);
    return journal;
  }

  // ─── Message CRUD ─────────────────────────────────────────

  /**
   * Create a message in the recipient's inbox journal.
   * @param {string} recipientId - Actor ID or master contact ID (both resolve via getInboxJournal)
   * @param {Object} messageData
   * @returns {Promise<{success: boolean, messageId?: string, page?: JournalEntryPage}>}
   */
  async createMessage(recipientId, messageData) {
    try {
      const journal = await this.getInboxJournal(recipientId);
      if (!journal) {
        return { success: false, error: 'Could not access inbox journal' };
      }

      const messageId = messageData.messageId || foundry.utils.randomID();
      const timestamp = messageData.timestamp || this._getTimestamp();

      const flags = {
        [MODULE_ID]: {
          messageId,
          threadId: messageData.threadId || messageId,
          inReplyTo: messageData.inReplyTo || null,

          from: messageData.from || '',
          fromActorId: messageData.fromActorId || '',
          fromContactId: messageData.fromContactId || '',
          to: messageData.to || '',
          toActorId: messageData.toActorId || (game.actors?.get(recipientId) ? recipientId : ''),
          toContactId: messageData.toContactId || (!game.actors?.get(recipientId) ? recipientId : ''),

          subject: messageData.subject || '(no subject)',
          body: messageData.body || '',
          priority: messageData.priority || 'normal',

          timestamp,
          simpleCalendarData: messageData.simpleCalendarData || null,
          readAt: null,

          network: messageData.network || 'CITINET',

          status: {
            read: messageData.status?.read || false,
            saved: false,
            spam: false,
            encrypted: messageData.status?.encrypted || !!messageData.encryption || false,
            infected: false,
            deleted: false,
            sent: messageData.status?.sent || false,
            scheduled: false,
            eddiesClaimed: false,
            eddiesClaimedAt: null,
          },

          encryption: messageData.encryption || null,

          // Composer features
          eddies: messageData.eddies || 0,
          selfDestruct: messageData.selfDestruct || null,

          metadata: {
            networkTrace: messageData.metadata?.networkTrace || null,
            signalStrength: messageData.metadata?.signalStrength || 100,
            routingPath: messageData.metadata?.routingPath || [],
            scheduledDelivery: messageData.metadata?.scheduledDelivery || null,
            deliveredAt: messageData.metadata?.deliveredAt || null,
          },

          attachments: messageData.attachments || [],
          malware: null,

          // Network Access Control (restricted network messaging)
          accessControl: messageData.accessControl || null,
        }
      };

      const page = await journal.createEmbeddedDocuments('JournalEntryPage', [{
        name: `MSG-${messageId}`,
        type: 'text',
        text: { content: messageData.body || '', format: 1 },
        flags,
      }]);

      return { success: true, messageId, page: page[0] };
    } catch (error) {
      console.error(`${MODULE_ID} | MessageRepository.createMessage:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get all messages for an actor with optional filtering.
   * @param {string} actorId 
   * @param {Object} [options]
   * @param {string} [options.filter] - 'inbox' | 'sent' | 'saved' | 'deleted' | 'all'
   * @param {boolean} [options.includeDeleted] - Include soft-deleted messages
   * @param {string} [options.sortBy] - 'newest' | 'oldest' | 'unread'
   * @param {number} [options.limit] - Max messages to return
   * @param {number} [options.offset] - Pagination offset
   * @returns {Promise<Array>}
   */
  async getMessages(actorId, options = {}) {
    try {
      const journal = await this.getInboxJournal(actorId);
      if (!journal) return [];

      const filter = options.filter || 'inbox';
      const includeDeleted = options.includeDeleted || false;

      let messages = journal.pages.contents
        .map(page => this._pageToMessage(page))
        .filter(msg => msg !== null);

      // Apply filters
      switch (filter) {
        case 'inbox':
          messages = messages.filter(m => !m.status.sent && !m.status.deleted);
          break;
        case 'sent':
          messages = messages.filter(m => m.status.sent && !m.status.deleted);
          break;
        case 'saved':
          messages = messages.filter(m => m.status.saved && !m.status.deleted);
          break;
        case 'deleted':
          messages = messages.filter(m => m.status.deleted);
          break;
        case 'all':
          if (!includeDeleted) {
            messages = messages.filter(m => !m.status.deleted);
          }
          break;
      }

      // Sort
      const sortBy = options.sortBy || 'newest';
      switch (sortBy) {
        case 'newest':
          messages.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
          break;
        case 'oldest':
          messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
          break;
        case 'unread':
          messages.sort((a, b) => {
            if (a.status.read !== b.status.read) return a.status.read ? 1 : -1;
            return new Date(b.timestamp) - new Date(a.timestamp);
          });
          break;
      }

      // Pagination
      if (options.offset) messages = messages.slice(options.offset);
      if (options.limit) messages = messages.slice(0, options.limit);

      return messages;
    } catch (error) {
      console.error(`${MODULE_ID} | MessageRepository.getMessages:`, error);
      return [];
    }
  }

  /**
   * Get a single message by ID from an actor's inbox.
   * @param {string} actorId 
   * @param {string} messageId 
   * @returns {Promise<Object|null>}
   */
  async getMessage(actorId, messageId) {
    try {
      const journal = await this.getInboxJournal(actorId);
      if (!journal) return null;

      const page = journal.pages.find(p => {
        const flags = p.flags?.[MODULE_ID];
        return flags?.messageId === messageId;
      });

      return page ? this._pageToMessage(page) : null;
    } catch (error) {
      console.error(`${MODULE_ID} | MessageRepository.getMessage:`, error);
      return null;
    }
  }

  /**
   * Update a message's flags (batch update).
   * @param {string} actorId 
   * @param {string} messageId 
   * @param {Object} updates - Partial flag updates to merge
   * @returns {Promise<{success: boolean}>}
   */
  async updateMessage(actorId, messageId, updates) {
    try {
      const journal = await this.getInboxJournal(actorId);
      if (!journal) return { success: false, error: 'Inbox not found' };

      const page = journal.pages.find(p => {
        return p.flags?.[MODULE_ID]?.messageId === messageId;
      });
      if (!page) return { success: false, error: 'Message not found' };

      // Build batch update object
      const flagUpdates = {};
      for (const [key, value] of Object.entries(updates)) {
        flagUpdates[`flags.${MODULE_ID}.${key}`] = value;
      }

      await page.update(flagUpdates);
      return { success: true };
    } catch (error) {
      console.error(`${MODULE_ID} | MessageRepository.updateMessage:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
     * Update specific flags on a message.
     * @param {string} actorId - Inbox owner
     * @param {string} messageId
     * @param {object} flagUpdates - Partial flag updates to merge
     * @returns {Promise<{ success: boolean, error?: string }>}
     */
    async updateMessageFlags(actorId, messageId, flagUpdates) {
      try {
        const journal = await this.getInboxJournal(actorId);
        if (!journal) return { success: false, error: 'Inbox not found' };

        const page = journal.pages.find(p =>
          p.flags?.[MODULE_ID]?.messageId === messageId
        );
        if (!page) return { success: false, error: 'Message not found' };

        const currentFlags = page.flags?.[MODULE_ID] ?? {};
        const merged = foundry.utils.mergeObject(currentFlags, flagUpdates, { inplace: false });

        await page.update({ [`flags.${MODULE_ID}`]: merged });
        return { success: true };
      } catch (error) {
        console.error(`${MODULE_ID} | MessageRepository.updateMessageFlags:`, error);
        return { success: false, error: error.message };
      }
    }

  /**
   * Mark a message as read.
   * @param {string} actorId 
   * @param {string} messageId 
   * @returns {Promise<{success: boolean}>}
   */
  async markAsRead(actorId, messageId) {
    return this.updateMessage(actorId, messageId, {
      'status.read': true,
      readAt: new Date().toISOString(),
    });
  }

  /**
   * Soft-delete a message (sets deleted flag, preserves data).
   * @param {string} actorId 
   * @param {string} messageId 
   * @returns {Promise<{success: boolean}>}
   */
  async softDeleteMessage(actorId, messageId) {
    return this.updateMessage(actorId, messageId, {
      'status.deleted': true,
    });
  }

  /**
   * Hard-delete a message (removes the journal page). GM only.
   * @param {string} actorId 
   * @param {string} messageId 
   * @returns {Promise<{success: boolean}>}
   */
  async hardDeleteMessage(actorId, messageId) {
    try {
      const journal = await this.getInboxJournal(actorId);
      if (!journal) return { success: false, error: 'Inbox not found' };

      // Allow if user is GM or owns the inbox journal
      if (!game.user.isGM && !journal.isOwner) {
        return { success: false, error: 'No permission to delete from this inbox' };
      }

      const page = journal.pages.find(p => {
        return p.flags?.[MODULE_ID]?.messageId === messageId;
      });
      if (!page) return { success: false, error: 'Message not found' };

      await journal.deleteEmbeddedDocuments('JournalEntryPage', [page.id]);
      return { success: true };
    } catch (error) {
      console.error(`${MODULE_ID} | MessageRepository.hardDeleteMessage:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Toggle saved/starred status on a message.
   * @param {string} actorId 
   * @param {string} messageId 
   * @returns {Promise<{success: boolean, saved?: boolean}>}
   */
  async toggleSaved(actorId, messageId) {
    const msg = await this.getMessage(actorId, messageId);
    if (!msg) return { success: false };
    const newSaved = !msg.status.saved;
    const result = await this.updateMessage(actorId, messageId, {
      'status.saved': newSaved,
    });
    return { ...result, saved: newSaved };
  }

  /**
   * Get unread count for an actor's inbox.
   * @param {string} actorId 
   * @returns {Promise<number>}
   */
  async getUnreadCount(actorId) {
    const messages = await this.getMessages(actorId, { filter: 'inbox' });
    return messages.filter(m => !m.status.read).length;
  }

  /**
   * Get messages in a thread.
   * @param {string} actorId 
   * @param {string} threadId 
   * @returns {Promise<Array>}
   */
  async getThread(actorId, threadId) {
    const all = await this.getMessages(actorId, { filter: 'all' });
    return all
      .filter(m => m.threadId === threadId)
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  }

  // ─── Helpers ──────────────────────────────────────────────

  /**
   * Convert a journal page to a message object.
   * @param {JournalEntryPage} page 
   * @returns {Object|null}
   */
  _pageToMessage(page) {
    const flags = page.flags?.[MODULE_ID];
    if (!flags?.messageId) return null;

    return {
      // Foundry references
      _pageId: page.id,
      _journalId: page.parent?.id,

      // Identity
      messageId: flags.messageId,
      threadId: flags.threadId,
      inReplyTo: flags.inReplyTo,

      // Routing
      from: flags.from,
      fromActorId: flags.fromActorId,
      fromContactId: flags.fromContactId || '',
      to: flags.to,
      toActorId: flags.toActorId,
      toContactId: flags.toContactId || '',

      // Content
      subject: flags.subject,
      body: flags.body,
      priority: flags.priority || 'normal',

      // Timing
      timestamp: flags.timestamp,
      simpleCalendarData: flags.simpleCalendarData,
      readAt: flags.readAt,

      // Context
      network: flags.network,

      // Status
      status: { ...flags.status },

      // Encryption
      encryption: flags.encryption ? { ...flags.encryption } : null,

      // Metadata
      metadata: { ...flags.metadata },

      // Future
      attachments: flags.attachments || [],
      malware: flags.malware,

      // Composer features
      eddies: flags.eddies || 0,
      selfDestruct: flags.selfDestruct || null,

      // Network Access Control
      accessControl: flags.accessControl || null,

      // Inline encrypted block state
      decryptedBlocks: flags.decryptedBlocks || [],

      // Signal degradation (low signal garbled text)
      signalDegradation: flags.signalDegradation || null,

      // Trace state (traced network countdown)
      traceStarted: flags.traceStarted || null,
      traceExpiresAt: flags.traceExpiresAt || null,
      traceCompleted: flags.traceCompleted || false,
    };
  }

  /**
   * Get current timestamp via TimeService or fallback.
   * @returns {string} ISO timestamp
   */
  _getTimestamp() {
    try {
      if (this.timeService) {
        return this.timeService.getCurrentTime();
      }
    } catch (e) { /* fallback */ }
    return new Date().toISOString();
  }

  /**
   * Clear the inbox journal cache (useful on world reload).
   */
  clearCache() {
    this._inboxCache.clear();
  }
}
