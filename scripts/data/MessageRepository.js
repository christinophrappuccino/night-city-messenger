/**
 * Message Repository — v2 (Organized Journals)
 * @file scripts/data/MessageRepository.js
 * @module cyberpunkred-messenger
 * @description Journal-based CRUD operations for messages.
 *
 * v2 changes:
 *   - Subfolder structure: Night City Messenger / {Inboxes, NPC Mail, Data Shards, Deleted}
 *   - Flag-based journal lookup (actorId/contactId in flags, name is display-only)
 *   - Human-readable journal names: "{Name} — Inbox"
 *   - Human-readable page names: "{From} — {Subject} | {MM/DD/YYYY}"
 *   - Migration tool for existing worlds
 *   - Deleted folder for archived/removed journals
 */

import { MODULE_ID, EVENTS } from '../utils/constants.js';

// ── Folder names (plain, functional, GM-friendly) ──
const ROOT_FOLDER   = 'Night City Messenger';
const INBOX_FOLDER  = 'Inboxes';
const NPC_FOLDER    = 'NPC Mail';
const SHARD_FOLDER  = 'Data Shards';
const DELETED_FOLDER = 'Deleted';

// ── Legacy name patterns (for migration detection) ──
const LEGACY_INBOX_PREFIX   = 'NCM-Inbox-';
const LEGACY_CONTACT_PREFIX = 'NCM-Inbox-Contact-';
const LEGACY_SHARD_PREFIX   = '[NCM Shard] ';
const LEGACY_FOLDER_NAME    = 'NCM Messages';

export class MessageRepository {
  constructor() {
    /** @type {Map<string, JournalEntry>} Cache of ownerId → inbox journal */
    this._inboxCache = new Map();
    /** @type {Map<string, Folder>} Cache of subfolder name → Folder */
    this._folderCache = new Map();
    /** @type {Folder|null} Root folder cache */
    this._rootFolder = null;
  }

  // ─── Service Accessors ────────────────────────────────────

  get eventBus() { return game.nightcity.eventBus; }
  get timeService() { return game.nightcity.timeService; }

  // ═══════════════════════════════════════════════════════════
  //  Folder Management
  // ═══════════════════════════════════════════════════════════

  /**
   * Get or create the root "Night City Messenger" folder.
   * @returns {Promise<Folder|null>}
   */
  async _getOrCreateRootFolder() {
    if (this._rootFolder && game.folders.get(this._rootFolder.id)) return this._rootFolder;

    this._rootFolder = game.folders.find(f =>
      f.type === 'JournalEntry' && f.name === ROOT_FOLDER && !f.folder
    ) ?? null;

    if (!this._rootFolder && game.user.isGM) {
      this._rootFolder = await Folder.create({
        name: ROOT_FOLDER,
        type: 'JournalEntry',
        color: '#330000',
        sorting: 'a',
      });
    }

    return this._rootFolder;
  }

  /**
   * Get or create a named subfolder under the root.
   * @param {string} name — Subfolder name (e.g. 'Inboxes')
   * @returns {Promise<Folder|null>}
   */
  async _getOrCreateSubfolder(name) {
    if (this._folderCache.has(name)) {
      const cached = this._folderCache.get(name);
      if (game.folders.get(cached.id)) return cached;
      this._folderCache.delete(name);
    }

    const root = await this._getOrCreateRootFolder();
    if (!root) return null;

    let folder = game.folders.find(f =>
      f.type === 'JournalEntry' && f.name === name && f.folder?.id === root.id
    ) ?? null;

    if (!folder && game.user.isGM) {
      folder = await Folder.create({
        name,
        type: 'JournalEntry',
        folder: root.id,
        sorting: 'a',
      });
    }

    if (folder) this._folderCache.set(name, folder);
    return folder;
  }

  /** Get or create the Inboxes subfolder. */
  async getInboxFolder() { return this._getOrCreateSubfolder(INBOX_FOLDER); }

  /** Get or create the NPC Mail subfolder. */
  async getContactMailFolder() { return this._getOrCreateSubfolder(NPC_FOLDER); }

  /** Get or create the Data Shards subfolder. (Public — used by DataShardService) */
  async getShardFolder() { return this._getOrCreateSubfolder(SHARD_FOLDER); }

  /** Get or create the Deleted subfolder. */
  async getDeletedFolder() { return this._getOrCreateSubfolder(DELETED_FOLDER); }

  // ═══════════════════════════════════════════════════════════
  //  Naming Helpers
  // ═══════════════════════════════════════════════════════════

  /**
   * Format a human-readable journal name.
   * @param {string} ownerName — Actor or contact name
   * @param {'inbox'|'mail'|'shard'} type
   * @returns {string}
   */
  static formatJournalName(ownerName, type) {
    switch (type) {
      case 'inbox': return `${ownerName} — Inbox`;
      case 'mail':  return `${ownerName} — Mail`;
      case 'shard': return `${ownerName} — Shard`;
      default:      return `${ownerName} — ${type}`;
    }
  }

  /**
   * Format a human-readable journal page name.
   * @param {string} from — Sender name or email
   * @param {string} subject — Message subject
   * @param {string} [timestamp] — ISO timestamp
   * @param {boolean} [isSent=false] — Prefix with "To:" for sent copies
   * @returns {string}
   */
  static formatPageName(from, subject, timestamp, isSent = false) {
    const prefix = isSent ? 'To: ' : '';
    const subj = subject || '(no subject)';
    const date = MessageRepository._formatDate(timestamp);
    // Truncate from if too long (Foundry has page name limits)
    const fromTrunc = from?.length > 30 ? from.substring(0, 27) + '...' : (from || 'Unknown');
    return `${prefix}${fromTrunc} — ${subj} | ${date}`;
  }

  /**
   * Format a timestamp as MM/DD/YYYY.
   * @param {string} [isoTimestamp]
   * @returns {string}
   */
  static _formatDate(isoTimestamp) {
    if (!isoTimestamp) return '??/??/????';
    try {
      const d = new Date(isoTimestamp);
      if (isNaN(d.getTime())) return '??/??/????';
      const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(d.getUTCDate()).padStart(2, '0');
      const yyyy = d.getUTCFullYear();
      return `${mm}/${dd}/${yyyy}`;
    } catch {
      return '??/??/????';
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Journal Lookup (Flag-based with Legacy Fallback)
  // ═══════════════════════════════════════════════════════════

  /**
   * Compute the correct ownership object for an actor's inbox.
   * @param {Actor} actor
   * @returns {object}
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
   * Verify and repair journal permissions + folder placement.
   * @param {JournalEntry} journal
   * @param {Actor} actor
   * @param {Folder} targetFolder
   */
  async _repairPermissions(journal, actor, targetFolder) {
    if (!game.user.isGM || !journal || !actor) return;

    const expected = this._computeOwnership(actor);
    const current = journal.ownership || {};
    const updates = {};

    // Check permissions
    let needsPermRepair = false;
    for (const [userId, level] of Object.entries(expected)) {
      if (userId === 'default') continue;
      if (current[userId] !== level) { needsPermRepair = true; break; }
    }
    if (needsPermRepair) updates.ownership = expected;

    // Check folder placement
    if (targetFolder && journal.folder?.id !== targetFolder.id) {
      updates.folder = targetFolder.id;
    }

    // Check flags exist
    const flags = journal.flags?.[MODULE_ID];
    if (!flags?.type || !flags?.actorId) {
      updates[`flags.${MODULE_ID}`] = {
        ...(flags || {}),
        type: 'inbox',
        actorId: actor.id,
      };
    }

    if (Object.keys(updates).length > 0) {
      await journal.update(updates);
      console.log(`${MODULE_ID} | Repaired inbox journal for ${actor.name}`);
    }
  }

  /**
   * GM tool: Repair permissions on ALL inbox journals.
   * @returns {Promise<number>}
   */
  async repairAllInboxPermissions() {
    if (!game.user.isGM) {
      ui.notifications.warn('NCM | GM only.');
      return 0;
    }

    let repaired = 0;
    const inboxFolder = await this.getInboxFolder();
    const contactFolder = await this.getContactMailFolder();

    for (const journal of game.journal) {
      const flags = journal.flags?.[MODULE_ID];
      const isNcmInbox = flags?.type === 'inbox' || journal.name?.startsWith(LEGACY_INBOX_PREFIX);
      const isNcmContact = flags?.type === 'contactInbox' || journal.name?.startsWith(LEGACY_CONTACT_PREFIX);

      if (!isNcmInbox && !isNcmContact) continue;

      if (isNcmContact) {
        if (contactFolder && journal.folder?.id !== contactFolder.id) {
          await journal.update({ folder: contactFolder.id });
        }
        continue;
      }

      // Actor inbox
      const actorId = flags?.actorId || journal.name?.replace(LEGACY_INBOX_PREFIX, '');
      const actor = game.actors?.get(actorId);
      if (!actor) continue;

      await this._repairPermissions(journal, actor, inboxFolder);
      repaired++;
    }

    ui.notifications.info(`NCM | Repaired ${repaired} inbox journal(s).`);
    return repaired;
  }

  /**
   * Get or create the inbox journal for an actor or master contact.
   * Uses flag-based lookup with legacy name fallback.
   * @param {string} ownerId — Actor ID or master contact ID
   * @returns {Promise<JournalEntry|null>}
   */
  async getInboxJournal(ownerId) {
    if (!ownerId) return null;

    // ── Cache check ──
    if (this._inboxCache.has(ownerId)) {
      const cached = this._inboxCache.get(ownerId);
      if (game.journal.get(cached.id)) return cached;
      this._inboxCache.delete(ownerId);
    }

    // ── Determine inbox type ──
    const actor = game.actors?.get(ownerId);
    const isActorInbox = !!actor;
    let ownerLabel;

    if (isActorInbox) {
      ownerLabel = actor.name;
    } else {
      const contact = game.nightcity?.masterContactService?.getContact(ownerId);
      if (!contact) {
        console.warn(`${MODULE_ID} | No actor or contact found for ID "${ownerId}"`);
        return null;
      }
      ownerLabel = contact.name;
    }

    // ── 1. Flag-based lookup (v2) ──
    let journal = game.journal.find(j => {
      const flags = j.flags?.[MODULE_ID];
      if (!flags) return false;
      if (isActorInbox) return flags.type === 'inbox' && flags.actorId === ownerId;
      return flags.type === 'contactInbox' && flags.contactId === ownerId;
    });

    // ── 2. Legacy name fallback ──
    if (!journal) {
      const legacyName = isActorInbox
        ? `${LEGACY_INBOX_PREFIX}${ownerId}`
        : `${LEGACY_CONTACT_PREFIX}${ownerId}`;
      journal = game.journal.find(j => j.name === legacyName);
    }

    // ── 3. Create new if not found ──
    if (!journal) {
      if (!game.user.isGM) {
        console.warn(`${MODULE_ID} | Non-GM cannot create inbox for ${ownerLabel}`);
        return null;
      }

      const ownership = isActorInbox ? this._computeOwnership(actor) : { default: 0 };
      const folder = isActorInbox
        ? await this.getInboxFolder()
        : await this.getContactMailFolder();

      const journalName = MessageRepository.formatJournalName(
        ownerLabel,
        isActorInbox ? 'inbox' : 'mail'
      );

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

      console.log(`${MODULE_ID} | Created ${isActorInbox ? 'inbox' : 'contact mail'} journal: "${journalName}"`);

    } else if (isActorInbox && game.user.isGM) {
      const folder = await this.getInboxFolder();
      await this._repairPermissions(journal, actor, folder);
    }

    this._inboxCache.set(ownerId, journal);
    return journal;
  }

  // ═══════════════════════════════════════════════════════════
  //  Message CRUD
  // ═══════════════════════════════════════════════════════════

  /**
   * Create a message in the recipient's inbox journal.
   * @param {string} recipientId
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
      const isSent = messageData.status?.sent || false;

      // Resolve sender display name for page title
      const fromName = this._resolveSenderName(messageData);

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
            infected: messageData.status?.infected || false,
            deleted: false,
            sent: isSent,
            scheduled: false,
            eddiesClaimed: messageData.status?.eddiesClaimed || false,
            eddiesClaimedAt: null,
          },

          encryption: messageData.encryption || null,
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
          accessControl: messageData.accessControl || null,
        }
      };

      // Human-readable page name
      const displayFrom = isSent
        ? (messageData.to || 'Unknown')
        : fromName;
      const pageName = MessageRepository.formatPageName(
        displayFrom,
        messageData.subject,
        timestamp,
        isSent
      );

      const page = await journal.createEmbeddedDocuments('JournalEntryPage', [{
        name: pageName,
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
   * Resolve a human-readable sender name from message data.
   * @param {object} messageData
   * @returns {string}
   */
  _resolveSenderName(messageData) {
    // Try actor name first
    if (messageData.fromActorId) {
      const actor = game.actors?.get(messageData.fromActorId);
      if (actor) return actor.name;
    }
    // Try master contact name
    if (messageData.fromContactId) {
      const contact = game.nightcity?.masterContactService?.getContact(messageData.fromContactId);
      if (contact) return contact.name;
    }
    // Fall back to email
    return messageData.from || 'Unknown';
  }

  /**
   * Get all messages for an actor with optional filtering.
   * @param {string} actorId
   * @param {Object} [options]
   * @param {string} [options.filter] - 'inbox'|'sent'|'saved'|'deleted'|'all'
   * @param {boolean} [options.includeDeleted]
   * @param {string} [options.sortBy] - 'newest'|'oldest'|'unread'
   * @param {number} [options.limit]
   * @param {number} [options.offset]
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
          if (!includeDeleted) messages = messages.filter(m => !m.status.deleted);
          break;
      }

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

      if (options.offset) messages = messages.slice(options.offset);
      if (options.limit) messages = messages.slice(0, options.limit);
      return messages;
    } catch (error) {
      console.error(`${MODULE_ID} | MessageRepository.getMessages:`, error);
      return [];
    }
  }

  async getMessage(actorId, messageId) {
    try {
      const journal = await this.getInboxJournal(actorId);
      if (!journal) return null;
      const page = journal.pages.find(p => p.flags?.[MODULE_ID]?.messageId === messageId);
      return page ? this._pageToMessage(page) : null;
    } catch (error) {
      console.error(`${MODULE_ID} | MessageRepository.getMessage:`, error);
      return null;
    }
  }

  async updateMessage(actorId, messageId, updates) {
    try {
      const journal = await this.getInboxJournal(actorId);
      if (!journal) return { success: false, error: 'Inbox not found' };

      const page = journal.pages.find(p => p.flags?.[MODULE_ID]?.messageId === messageId);
      if (!page) return { success: false, error: 'Message not found' };

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

  async updateMessageFlags(actorId, messageId, flagUpdates) {
    try {
      const journal = await this.getInboxJournal(actorId);
      if (!journal) return { success: false, error: 'Inbox not found' };

      const page = journal.pages.find(p => p.flags?.[MODULE_ID]?.messageId === messageId);
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

  async markAsRead(actorId, messageId) {
    return this.updateMessage(actorId, messageId, {
      'status.read': true,
      readAt: new Date().toISOString(),
    });
  }

  async softDeleteMessage(actorId, messageId) {
    return this.updateMessage(actorId, messageId, { 'status.deleted': true });
  }

  async hardDeleteMessage(actorId, messageId) {
    try {
      const journal = await this.getInboxJournal(actorId);
      if (!journal) return { success: false, error: 'Inbox not found' };

      if (!game.user.isGM && !journal.isOwner) {
        return { success: false, error: 'No permission to delete from this inbox' };
      }

      const page = journal.pages.find(p => p.flags?.[MODULE_ID]?.messageId === messageId);
      if (!page) return { success: false, error: 'Message not found' };

      await journal.deleteEmbeddedDocuments('JournalEntryPage', [page.id]);
      return { success: true };
    } catch (error) {
      console.error(`${MODULE_ID} | MessageRepository.hardDeleteMessage:`, error);
      return { success: false, error: error.message };
    }
  }

  async toggleSaved(actorId, messageId) {
    const msg = await this.getMessage(actorId, messageId);
    if (!msg) return { success: false };
    const newSaved = !msg.status.saved;
    const result = await this.updateMessage(actorId, messageId, { 'status.saved': newSaved });
    return { ...result, saved: newSaved };
  }

  async getUnreadCount(actorId) {
    const messages = await this.getMessages(actorId, { filter: 'inbox' });
    return messages.filter(m => !m.status.read).length;
  }

  async getThread(actorId, threadId) {
    const all = await this.getMessages(actorId, { filter: 'all' });
    return all.filter(m => m.threadId === threadId)
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  }

  // ═══════════════════════════════════════════════════════════
  //  Journal Archival (Deleted Folder)
  // ═══════════════════════════════════════════════════════════

  /**
   * Move a journal to the Deleted subfolder (GM recycle bin).
   * Prefixes name with [Deleted] and notes the source folder.
   * @param {JournalEntry} journal
   * @param {string} [reason] — Why it was archived (e.g. "Actor deleted")
   * @returns {Promise<boolean>}
   */
  async archiveJournal(journal, reason = '') {
    if (!game.user.isGM || !journal) return false;

    try {
      const deletedFolder = await this.getDeletedFolder();
      if (!deletedFolder) return false;

      const source = journal.folder?.name || 'Root';
      const prefix = reason ? `[${reason}]` : '[Deleted]';
      const newName = `${prefix} ${journal.name} (was in: ${source})`;

      await journal.update({
        name: newName,
        folder: deletedFolder.id,
      });

      console.log(`${MODULE_ID} | Archived journal "${journal.name}" → Deleted folder`);
      return true;
    } catch (error) {
      console.error(`${MODULE_ID} | Failed to archive journal:`, error);
      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Migration
  // ═══════════════════════════════════════════════════════════

  /**
   * Detect if legacy journal format exists.
   * @returns {boolean}
   */
  needsMigration() {
    return game.journal.some(j =>
      j.name?.startsWith(LEGACY_INBOX_PREFIX) ||
      j.name?.startsWith(LEGACY_SHARD_PREFIX)
    );
  }

  /**
   * Migrate all NCM journals to v2 organized format.
   * Safe to run multiple times (idempotent).
   * @returns {Promise<{inboxes: number, contacts: number, shards: number, pages: number}>}
   */
  async migrateJournalOrganization() {
    if (!game.user.isGM) {
      ui.notifications.warn('NCM | Journal migration is GM-only.');
      return { inboxes: 0, contacts: 0, shards: 0, pages: 0 };
    }

    console.log(`${MODULE_ID} | Starting journal organization migration...`);
    const stats = { inboxes: 0, contacts: 0, shards: 0, pages: 0 };

    // ── 1. Create folder structure ──
    const inboxFolder = await this.getInboxFolder();
    const contactFolder = await this.getContactMailFolder();
    const shardFolder = await this.getShardFolder();
    await this.getDeletedFolder();

    // ── 2. Migrate old "NCM Messages" folder contents ──
    const legacyFolder = game.folders.find(f =>
      f.type === 'JournalEntry' && f.name === LEGACY_FOLDER_NAME
    );

    // ── 3. Process all journals ──
    for (const journal of game.journal) {
      const flags = journal.flags?.[MODULE_ID];
      const name = journal.name || '';

      // ── Actor inboxes ──
      if (flags?.type === 'inbox' || name.startsWith(LEGACY_INBOX_PREFIX)) {
        const actorId = flags?.actorId || name.replace(LEGACY_CONTACT_PREFIX, '').replace(LEGACY_INBOX_PREFIX, '');

        // Skip if it's actually a contact inbox misidentified by prefix
        if (name.startsWith(LEGACY_CONTACT_PREFIX)) continue;

        const actor = game.actors?.get(actorId);
        const actorName = actor?.name || actorId;
        const newName = MessageRepository.formatJournalName(actorName, 'inbox');
        const updates = {};

        // Rename if still using legacy name
        if (name.startsWith(LEGACY_INBOX_PREFIX)) {
          updates.name = newName;
        }

        // Ensure flags
        if (!flags?.type || !flags?.actorId) {
          updates[`flags.${MODULE_ID}`] = {
            ...(flags || {}),
            type: 'inbox',
            actorId: actorId,
            createdAt: flags?.createdAt || new Date().toISOString(),
          };
        }

        // Move to correct folder
        if (inboxFolder && journal.folder?.id !== inboxFolder.id) {
          updates.folder = inboxFolder.id;
        }

        if (Object.keys(updates).length > 0) {
          await journal.update(updates);
          stats.inboxes++;
        }

        // Rename pages
        stats.pages += await this._migratePageNames(journal);
        continue;
      }

      // ── Contact inboxes ──
      if (flags?.type === 'contactInbox' || name.startsWith(LEGACY_CONTACT_PREFIX)) {
        const contactId = flags?.contactId || name.replace(LEGACY_CONTACT_PREFIX, '');
        const contact = game.nightcity?.masterContactService?.getContact(contactId);
        const contactName = contact?.name || contactId;
        const newName = MessageRepository.formatJournalName(contactName, 'mail');
        const updates = {};

        if (name.startsWith(LEGACY_CONTACT_PREFIX)) {
          updates.name = newName;
        }

        if (!flags?.type || !flags?.contactId) {
          updates[`flags.${MODULE_ID}`] = {
            ...(flags || {}),
            type: 'contactInbox',
            contactId: contactId,
            createdAt: flags?.createdAt || new Date().toISOString(),
          };
        }

        if (contactFolder && journal.folder?.id !== contactFolder.id) {
          updates.folder = contactFolder.id;
        }

        if (Object.keys(updates).length > 0) {
          await journal.update(updates);
          stats.contacts++;
        }

        stats.pages += await this._migratePageNames(journal);
        continue;
      }

      // ── Shard journals ──
      if (flags?.type === 'data-shard' || name.startsWith(LEGACY_SHARD_PREFIX)) {
        const updates = {};

        // Rename from "[NCM Shard] X" to "X — Shard"
        if (name.startsWith(LEGACY_SHARD_PREFIX)) {
          const itemName = name.replace(LEGACY_SHARD_PREFIX, '');
          updates.name = MessageRepository.formatJournalName(itemName, 'shard');
        }

        if (shardFolder && journal.folder?.id !== shardFolder.id) {
          updates.folder = shardFolder.id;
        }

        if (Object.keys(updates).length > 0) {
          await journal.update(updates);
          stats.shards++;
        }

        stats.pages += await this._migratePageNames(journal);
        continue;
      }
    }

    // ── 4. Remove empty legacy folder ──
    if (legacyFolder) {
      const remaining = game.journal.filter(j => j.folder?.id === legacyFolder.id);
      if (remaining.length === 0) {
        await legacyFolder.delete();
        console.log(`${MODULE_ID} | Removed empty legacy folder "${LEGACY_FOLDER_NAME}"`);
      }
    }

    console.log(`${MODULE_ID} | Migration complete:`, stats);
    return stats;
  }

  /**
   * Rename legacy "MSG-{id}" pages to human-readable names.
   * @param {JournalEntry} journal
   * @returns {Promise<number>} Number of pages renamed
   */
  async _migratePageNames(journal) {
    let renamed = 0;

    for (const page of journal.pages) {
      // Only rename pages that still have legacy names
      if (!page.name?.startsWith('MSG-')) continue;

      const flags = page.flags?.[MODULE_ID];
      if (!flags) continue;

      const isSent = flags.status?.sent || false;
      const from = isSent
        ? (flags.to || 'Unknown')
        : this._resolveSenderName(flags);
      const newName = MessageRepository.formatPageName(
        from, flags.subject, flags.timestamp, isSent
      );

      await page.update({ name: newName });
      renamed++;
    }

    return renamed;
  }

  // ═══════════════════════════════════════════════════════════
  //  Helpers
  // ═══════════════════════════════════════════════════════════

  _pageToMessage(page) {
    const flags = page.flags?.[MODULE_ID];
    if (!flags?.messageId) return null;

    return {
      _pageId: page.id,
      _journalId: page.parent?.id,
      messageId: flags.messageId,
      threadId: flags.threadId,
      inReplyTo: flags.inReplyTo,
      from: flags.from,
      fromActorId: flags.fromActorId,
      fromContactId: flags.fromContactId || '',
      to: flags.to,
      toActorId: flags.toActorId,
      toContactId: flags.toContactId || '',
      subject: flags.subject,
      body: flags.body,
      priority: flags.priority || 'normal',
      timestamp: flags.timestamp,
      simpleCalendarData: flags.simpleCalendarData,
      readAt: flags.readAt,
      network: flags.network,
      status: { ...flags.status },
      encryption: flags.encryption ? { ...flags.encryption } : null,
      metadata: { ...flags.metadata },
      attachments: flags.attachments || [],
      malware: flags.malware,
      eddies: flags.eddies || 0,
      selfDestruct: flags.selfDestruct || null,
      accessControl: flags.accessControl || null,
      decryptedBlocks: flags.decryptedBlocks || [],
      signalDegradation: flags.signalDegradation || null,
      traceStarted: flags.traceStarted || null,
      traceExpiresAt: flags.traceExpiresAt || null,
      traceCompleted: flags.traceCompleted || false,
    };
  }

  _getTimestamp() {
    try {
      if (this.timeService) return this.timeService.getCurrentTime();
    } catch (e) { /* fallback */ }
    return new Date().toISOString();
  }

  clearCache() {
    this._inboxCache.clear();
    this._folderCache.clear();
    this._rootFolder = null;
  }
}
