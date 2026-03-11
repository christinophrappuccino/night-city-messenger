/**
 * DocumentSyncBridge
 * @file scripts/integrations/DocumentSyncBridge.js
 * @module cyberpunkred-messenger
 * @description Bridges Foundry's built-in document update hooks into the NCM
 *              EventBus, enabling real-time cross-client sync without extra
 *              socket traffic.
 *
 * WHY THIS WORKS:
 * When the GM calls scene.setFlag(), item.update(), or game.settings.set(),
 * Foundry automatically propagates the change to ALL connected clients and
 * fires the corresponding hook (updateScene, updateItem, updateSetting) on
 * every client. We just need to listen for those hooks, check if NCM data
 * changed, and emit the right EventBus events so open UIs re-render.
 *
 * This replaces the need for most custom socket broadcasts for data that's
 * stored in flags/settings. Sockets are still needed for:
 *   - Message relay (player → GM → recipient pipeline)
 *   - Transient notifications (toast popups, sounds)
 *   - Delivery confirmations
 *   - Anything that doesn't persist to a Foundry document
 *
 * REGISTRATION:
 * Call DocumentSyncBridge.register(eventBus) once during the 'ready' phase,
 * after all services are initialized.
 */

import { MODULE_ID, EVENTS } from '../utils/constants.js';
import { log } from '../utils/helpers.js';

export class DocumentSyncBridge {

  /** @type {import('../core/EventBus.js').EventBus} */
  static _eventBus = null;

  /** @type {number[]} Hook IDs for cleanup */
  static _hookIds = [];

  /**
   * Register all document sync hooks.
   * @param {import('../core/EventBus.js').EventBus} eventBus
   */
  static register(eventBus) {
    if (!eventBus) {
      log.error('DocumentSyncBridge: EventBus is required');
      return;
    }

    this._eventBus = eventBus;

    // ─── Scene Flag Changes ───────────────────────────────
    // Fires on ALL clients when any scene's flags change.
    // Covers: networkAvailability, deadZone, defaultNetwork
    this._hookIds.push(
      Hooks.on('updateScene', (scene, changes, options, userId) => {
        this._onSceneUpdate(scene, changes, userId);
      })
    );

    // ─── Item Flag Changes ────────────────────────────────
    // Fires on ALL clients when any item's flags change.
    // Covers: data shard config/state, security changes,
    //         force-decrypt, relock, hack state
    this._hookIds.push(
      Hooks.on('updateItem', (item, changes, options, userId) => {
        this._onItemUpdate(item, changes, userId);
      })
    );

    // ─── Actor Flag Changes ───────────────────────────────
    // Fires on ALL clients when actor flags change.
    // Covers: email address, contact lists, player preferences
    this._hookIds.push(
      Hooks.on('updateActor', (actor, changes, options, userId) => {
        this._onActorUpdate(actor, changes, userId);
      })
    );

    // ─── Journal Changes ──────────────────────────────────
    // Fires on ALL clients when journal pages are created,
    // updated, or deleted. Covers: new messages arriving,
    // message status changes (read/deleted/saved)
    this._hookIds.push(
      Hooks.on('updateJournalEntry', (journal, changes, options, userId) => {
        this._onJournalUpdate(journal, changes, userId);
      })
    );

    // Journal page CRUD — more granular than journal-level
    this._hookIds.push(
      Hooks.on('createJournalEntryPage', (page, options, userId) => {
        this._onJournalPageCreated(page, userId);
      })
    );

    this._hookIds.push(
      Hooks.on('updateJournalEntryPage', (page, changes, options, userId) => {
        this._onJournalPageUpdated(page, changes, userId);
      })
    );

    this._hookIds.push(
      Hooks.on('deleteJournalEntryPage', (page, options, userId) => {
        this._onJournalPageDeleted(page, userId);
      })
    );

    // ─── World Settings Changes ───────────────────────────
    // Fires on ALL clients when a world setting changes.
    // Covers: customNetworks, scheduledMessages, masterContacts,
    //         module config
    this._hookIds.push(
      Hooks.on('updateSetting', (setting) => {
        this._onSettingUpdate(setting);
      })
    );

    log.info('DocumentSyncBridge: Registered all document hooks');
  }

  /**
   * Cleanup all hooks. Call on module teardown if needed.
   */
  static teardown() {
    // Foundry doesn't have a clean "remove hook by ID" for named hooks,
    // but we can track and remove them
    this._hookIds = [];
    this._eventBus = null;
    log.debug('DocumentSyncBridge: Torn down');
  }

  // ═══════════════════════════════════════════════════════════
  //  Hook Handlers
  // ═══════════════════════════════════════════════════════════

  /**
   * Scene updated — check for NCM flag changes.
   * @param {Scene} scene
   * @param {object} changes - The diff object
   * @param {string} userId - Who made the change
   * @private
   */
  static _onSceneUpdate(scene, changes, userId) {
    const ncmFlags = changes?.flags?.[MODULE_ID];
    if (!ncmFlags) return; // Not our data, ignore

    const isCurrentScene = scene.id === canvas.scene?.id;

    // Network availability changed
    if ('networkAvailability' in ncmFlags) {
      log.debug(`SyncBridge: Network availability changed on ${scene.name} by user ${userId}`);
      this._eventBus.emit(EVENTS.NETWORK_CHANGED, {
        sceneId: scene.id,
        isCurrentScene,
        source: 'document-sync',
        changedBy: userId,
      });
    }

    // Dead zone toggled
    if ('deadZone' in ncmFlags) {
      log.debug(`SyncBridge: Dead zone toggled on ${scene.name}`);
      this._eventBus.emit(EVENTS.NETWORK_CHANGED, {
        sceneId: scene.id,
        isCurrentScene,
        isDead: ncmFlags.deadZone,
        source: 'document-sync',
        changedBy: userId,
      });
    }

    // Default network changed for scene
    if ('defaultNetwork' in ncmFlags) {
      log.debug(`SyncBridge: Default network changed on ${scene.name}`);
      this._eventBus.emit(EVENTS.NETWORK_CHANGED, {
        sceneId: scene.id,
        isCurrentScene,
        defaultNetwork: ncmFlags.defaultNetwork,
        source: 'document-sync',
        changedBy: userId,
      });
    }
  }

  /**
   * Item updated — check for data shard flag changes.
   * @param {Item} item
   * @param {object} changes
   * @param {string} userId
   * @private
   */
  static _onItemUpdate(item, changes, userId) {
    const ncmFlags = changes?.flags?.[MODULE_ID];
    if (!ncmFlags) return;

    const isDataShard = item.getFlag(MODULE_ID, 'isDataShard');
    if (!isDataShard) return;

    // Shard state changed (decrypt, relock, hack attempts, sessions)
    if ('state' in ncmFlags) {
      log.debug(`SyncBridge: Shard state changed for ${item.name}`);
      this._eventBus.emit(EVENTS.SHARD_STATE_CHANGED ?? 'shard:stateChanged', {
        itemId: item.id,
        itemName: item.name,
        source: 'document-sync',
        changedBy: userId,
      });
    }

    // Shard config changed (GM edited security, encryption, etc.)
    if ('config' in ncmFlags) {
      log.debug(`SyncBridge: Shard config changed for ${item.name}`);
      this._eventBus.emit(EVENTS.SHARD_STATE_CHANGED ?? 'shard:stateChanged', {
        itemId: item.id,
        itemName: item.name,
        configChanged: true,
        source: 'document-sync',
        changedBy: userId,
      });
    }
  }

  /**
   * Actor updated — check for NCM flag changes.
   * @param {Actor} actor
   * @param {object} changes
   * @param {string} userId
   * @private
   */
  static _onActorUpdate(actor, changes, userId) {
    const ncmFlags = changes?.flags?.[MODULE_ID];
    if (!ncmFlags) return;

    // Email address changed
    if ('email' in ncmFlags || 'emailAddress' in ncmFlags) {
      log.debug(`SyncBridge: Email changed for ${actor.name}`);
      this._eventBus.emit(EVENTS.CONTACT_UPDATED ?? 'contact:updated', {
        actorId: actor.id,
        actorName: actor.name,
        source: 'document-sync',
        changedBy: userId,
      });
    }

    // Contacts list changed
    if ('contacts' in ncmFlags) {
      log.debug(`SyncBridge: Contacts changed for ${actor.name}`);
      this._eventBus.emit(EVENTS.CONTACT_UPDATED ?? 'contact:updated', {
        actorId: actor.id,
        source: 'document-sync',
        changedBy: userId,
      });
    }

    // Theme / preferences changed
    if ('theme' in ncmFlags || 'preferences' in ncmFlags) {
      this._eventBus.emit(EVENTS.THEME_CHANGED ?? 'theme:changed', {
        actorId: actor.id,
        source: 'document-sync',
        changedBy: userId,
      });
    }
  }

  /**
   * Journal entry updated — check if it's an NCM inbox.
   * @param {JournalEntry} journal
   * @param {object} changes
   * @param {string} userId
   * @private
   */
  static _onJournalUpdate(journal, changes, userId) {
    // Check if this is an NCM inbox journal
    const isInbox = journal.getFlag(MODULE_ID, 'isInbox')
                 || journal.name?.startsWith('[NCM]');
    if (!isInbox) return;

    const actorId = journal.getFlag(MODULE_ID, 'actorId');
    if (!actorId) return;

    // Skip if we're the one who made the change (avoid double-render)
    if (userId === game.user.id) return;

    log.debug(`SyncBridge: Inbox journal updated for actor ${actorId}`);
    this._eventBus.emit(EVENTS.INBOX_REFRESH ?? 'inbox:refresh', {
      actorId,
      source: 'document-sync',
      changedBy: userId,
    });
  }

  /**
   * Journal page created — new message arrived in an inbox.
   * @param {JournalEntryPage} page
   * @param {string} userId
   * @private
   */
  static _onJournalPageCreated(page, userId) {
    const journal = page.parent;
    if (!journal) return;

    const isInbox = journal.getFlag(MODULE_ID, 'isInbox')
                 || journal.name?.startsWith('[NCM]');
    if (!isInbox) return;

    const actorId = journal.getFlag(MODULE_ID, 'actorId');
    if (!actorId) return;

    // Skip if we initiated (GM delivering message handles its own UI)
    if (userId === game.user.id) return;

    const msgFlags = page.flags?.[MODULE_ID];
    if (!msgFlags?.messageId) return;

    log.debug(`SyncBridge: New message page in inbox for actor ${actorId}`);
    this._eventBus.emit(EVENTS.MESSAGE_RECEIVED ?? 'message:received', {
      messageId: msgFlags.messageId,
      toActorId: actorId,
      fromActorId: msgFlags.fromActorId,
      subject: msgFlags.subject,
      priority: msgFlags.priority || 'normal',
      source: 'document-sync',
      changedBy: userId,
    });
  }

  /**
   * Journal page updated — message status changed (read, saved, deleted).
   * @param {JournalEntryPage} page
   * @param {object} changes
   * @param {string} userId
   * @private
   */
  static _onJournalPageUpdated(page, changes, userId) {
    const journal = page.parent;
    if (!journal) return;

    const isInbox = journal.getFlag(MODULE_ID, 'isInbox')
                 || journal.name?.startsWith('[NCM]');
    if (!isInbox) return;

    const ncmFlags = changes?.flags?.[MODULE_ID];
    if (!ncmFlags) return;

    // Skip own changes
    if (userId === game.user.id) return;

    const actorId = journal.getFlag(MODULE_ID, 'actorId');
    const messageId = page.flags?.[MODULE_ID]?.messageId;

    if (actorId && messageId) {
      log.debug(`SyncBridge: Message ${messageId} updated in inbox for ${actorId}`);
      this._eventBus.emit(EVENTS.MESSAGE_STATUS_CHANGED ?? 'message:statusChanged', {
        messageId,
        actorId,
        source: 'document-sync',
        changedBy: userId,
      });
    }
  }

  /**
   * Journal page deleted — message hard-deleted.
   * @param {JournalEntryPage} page
   * @param {string} userId
   * @private
   */
  static _onJournalPageDeleted(page, userId) {
    const journal = page.parent;
    if (!journal) return;

    const isInbox = journal.getFlag(MODULE_ID, 'isInbox')
                 || journal.name?.startsWith('[NCM]');
    if (!isInbox) return;

    if (userId === game.user.id) return;

    const actorId = journal.getFlag(MODULE_ID, 'actorId');
    const messageId = page.flags?.[MODULE_ID]?.messageId;

    if (actorId) {
      log.debug(`SyncBridge: Message deleted from inbox for ${actorId}`);
      this._eventBus.emit(EVENTS.MESSAGE_DELETED ?? 'message:deleted', {
        messageId,
        actorId,
        source: 'document-sync',
        changedBy: userId,
      });
    }
  }

  /**
   * World setting updated — check for NCM settings.
   * @param {Setting} setting
   * @private
   */
  static _onSettingUpdate(setting) {
    if (!setting.key?.startsWith(`${MODULE_ID}.`)) return;

    const settingName = setting.key.replace(`${MODULE_ID}.`, '');

    switch (settingName) {
      case 'customNetworks':
        log.debug('SyncBridge: Custom networks setting changed');
        // Rebuild network cache on all clients
        game.nightcity?.networkService?._buildNetworkCache?.();
        this._eventBus.emit(EVENTS.NETWORK_CHANGED, {
          source: 'document-sync',
          settingChanged: 'customNetworks',
        });
        break;

      case 'coreNetworkOverrides':
        log.debug('SyncBridge: Core network overrides changed');
        // Rebuild network cache on all clients (merges overrides onto core defs)
        game.nightcity?.networkService?._buildNetworkCache?.();
        this._eventBus.emit(EVENTS.NETWORK_CHANGED, {
          source: 'document-sync',
          settingChanged: 'coreNetworkOverrides',
        });
        break;

      case 'masterContacts':
        log.debug('SyncBridge: Master contacts setting changed');
        this._eventBus.emit(EVENTS.CONTACT_UPDATED ?? 'contact:updated', {
          source: 'document-sync',
          settingChanged: 'masterContacts',
        });
        break;

      case 'scheduledMessages':
        log.debug('SyncBridge: Scheduled messages setting changed');
        // SchedulingService already handles this via its own socket,
        // but emit for any UI that cares (admin panel)
        this._eventBus.emit('schedule:updated', {
          source: 'document-sync',
        });
        break;

      default:
        // Generic setting change — could be module config
        log.debug(`SyncBridge: Setting ${settingName} changed`);
        break;
    }
  }
}
