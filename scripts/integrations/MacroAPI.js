/**
 * Macro API
 * @file scripts/integrations/MacroAPI.js
 * @module cyberpunkred-messenger
 * @description Consolidated public API on game.nightcity. Wraps all services into
 *              clean macro-friendly functions. Each function resolves string IDs to
 *              documents for convenience.
 */

import { MODULE_ID } from '../utils/constants.js';
import { log, isGM } from '../utils/helpers.js';

export class MacroAPI {

  /**
   * Register all macro API functions on game.nightcity and game.nightcity.messenger.
   * Called at ready/110 after all services are available.
   */
  static register() {
    const ns = game.nightcity;
    if (!ns) {
      log.error('MacroAPI: game.nightcity namespace not available');
      return;
    }

    // ─── Create the messenger sub-namespace for explicit macro usage ───
    ns.messenger = ns.messenger || {};

    // ═══════════════════════════════════════════════════════════
    //  MESSAGE FUNCTIONS
    // ═══════════════════════════════════════════════════════════

    /**
     * Send a message. Resolves actor names/IDs automatically.
     * @param {object} data
     * @param {string} data.toActorId - Recipient actor ID (or name)
     * @param {string} data.fromActorId - Sender actor ID (or name)
     * @param {string} data.subject
     * @param {string} data.body
     * @param {string} [data.priority='normal']
     * @returns {Promise<{success: boolean, messageId?: string}>}
     */
    ns.messenger.sendMessage = async (data) => {
      const resolved = MacroAPI._resolveActors(data);
      return ns.messageService?.sendMessage(resolved) ?? { success: false, error: 'MessageService unavailable' };
    };

    /**
     * Get messages for an actor.
     * @param {string} actorIdOrName
     * @param {object} [options]
     * @returns {Promise<Array>}
     */
    ns.messenger.getMessages = async (actorIdOrName, options = {}) => {
      const actorId = MacroAPI._resolveActorId(actorIdOrName);
      if (!actorId) return [];
      return ns.messageService?.getMessages(actorId, options) ?? [];
    };

    /**
     * Get unread count for an actor.
     * @param {string} actorIdOrName
     * @returns {Promise<number>}
     */
    ns.messenger.getUnreadCount = async (actorIdOrName) => {
      const actorId = MacroAPI._resolveActorId(actorIdOrName);
      if (!actorId) return 0;
      return ns.messageService?.getUnreadCount(actorId) ?? 0;
    };

    /**
     * Delete a message (soft-delete).
     * @param {string} actorIdOrName
     * @param {string} messageId
     * @returns {Promise<{success: boolean}>}
     */
    ns.messenger.deleteMessage = async (actorIdOrName, messageId) => {
      const actorId = MacroAPI._resolveActorId(actorIdOrName);
      if (!actorId) return { success: false, error: 'Actor not found' };
      return ns.messageService?.deleteMessage(actorId, messageId) ?? { success: false };
    };

    /**
     * Share a message to Foundry chat.
     * @param {object} message - Message object
     * @param {string} [actorIdOrName] - Actor sharing the message
     */
    ns.messenger.shareToChat = async (message, actorIdOrName) => {
      const actorId = actorIdOrName ? MacroAPI._resolveActorId(actorIdOrName) : null;
      return ns.messageService?.shareToChat(message, actorId);
    };

    // ═══════════════════════════════════════════════════════════
    //  SCHEDULING FUNCTIONS
    // ═══════════════════════════════════════════════════════════

    /**
     * Schedule a message for future delivery.
     * @param {object} messageData - Standard message data
     * @param {string} deliveryTime - ISO-8601 timestamp
     * @param {object} [options]
     * @returns {Promise<{success: boolean, scheduleId?: string}>}
     */
    ns.messenger.scheduleMessage = async (messageData, deliveryTime, options = {}) => {
      const resolved = MacroAPI._resolveActors(messageData);
      return ns.schedulingService?.scheduleMessage(resolved, deliveryTime, options)
        ?? { success: false, error: 'SchedulingService unavailable' };
    };

    /**
     * Cancel a scheduled message.
     * @param {string} scheduleId
     * @returns {Promise<{success: boolean}>}
     */
    ns.messenger.cancelScheduled = async (scheduleId) => {
      return ns.schedulingService?.cancelScheduled(scheduleId)
        ?? { success: false, error: 'SchedulingService unavailable' };
    };

    /**
     * Get all pending scheduled messages.
     * @returns {Array}
     */
    ns.messenger.getPendingScheduled = () => {
      return ns.schedulingService?.getPending() ?? [];
    };

    // ═══════════════════════════════════════════════════════════
    //  NETWORK FUNCTIONS
    // ═══════════════════════════════════════════════════════════

    /**
     * Get current network info.
     * @returns {object|null}
     */
    ns.messenger.getCurrentNetwork = () => {
      return ns.networkService?.currentNetwork ?? null;
    };

    /**
     * Get signal strength.
     * @returns {number}
     */
    ns.messenger.getSignalStrength = () => {
      return ns.networkService?.signalStrength ?? 0;
    };

    /**
     * Get available networks for current scene.
     * @returns {Array}
     */
    ns.messenger.getAvailableNetworks = () => {
      return ns.networkService?.getAvailableNetworks() ?? [];
    };

    /**
     * Set the active network. GM only.
     * @param {string} networkId
     * @returns {Promise<{success: boolean}>}
     */
    ns.messenger.setNetwork = async (networkId) => {
      if (!isGM()) return { success: false, error: 'GM only' };
      return ns.networkService?.setNetwork(networkId) ?? { success: false };
    };

    /**
     * Toggle dead zone for a scene. GM only.
     * @param {string} [sceneId] - Defaults to active scene
     * @param {boolean} [isDeadZone]
     */
    ns.messenger.toggleDeadZone = async (sceneId, isDeadZone) => {
      if (!isGM()) return { success: false, error: 'GM only' };
      const scene = sceneId ? game.scenes.get(sceneId) : game.scenes.active;
      if (!scene) return { success: false, error: 'Scene not found' };
      return ns.networkService?.setDeadZone(scene.id, isDeadZone) ?? { success: false };
    };

    // ═══════════════════════════════════════════════════════════
    //  DATA SHARD FUNCTIONS
    // ═══════════════════════════════════════════════════════════

    /**
     * Convert an item to a data shard. GM only.
     * @param {string|Item} itemOrId - Item document or ID
     * @param {object} [config] - Shard configuration overrides
     * @returns {Promise<{success: boolean}>}
     */
    ns.messenger.convertToDataShard = async (itemOrId, config = {}) => {
      if (!isGM()) return { success: false, error: 'GM only' };
      const item = MacroAPI._resolveItem(itemOrId);
      if (!item) return { success: false, error: 'Item not found' };
      return ns.dataShardService?.convertToDataShard(item, config) ?? { success: false };
    };

    /**
     * Attempt to hack a data shard.
     * @param {string|Item} itemOrId
     * @param {string|Actor} actorOrId
     * @param {object} [options]
     * @returns {Promise<{success: boolean}>}
     */
    ns.messenger.hackShard = async (itemOrId, actorOrId, options = {}) => {
      const item = MacroAPI._resolveItem(itemOrId);
      const actor = MacroAPI._resolveActor(actorOrId);
      if (!item) return { success: false, error: 'Item not found' };
      if (!actor) return { success: false, error: 'Actor not found' };
      return ns.dataShardService?.attemptHack(item, actor, options) ?? { success: false };
    };

    /**
     * Force decrypt a data shard. GM only.
     * @param {string|Item} itemOrId
     * @returns {Promise<{success: boolean}>}
     */
    ns.messenger.forceDecryptShard = async (itemOrId) => {
      if (!isGM()) return { success: false, error: 'GM only' };
      const item = MacroAPI._resolveItem(itemOrId);
      if (!item) return { success: false, error: 'Item not found' };
      return ns.dataShardService?.forceDecrypt(item) ?? { success: false };
    };

    /**
     * Relock a data shard. GM only.
     * @param {string|Item} itemOrId
     * @returns {Promise<{success: boolean}>}
     */
    ns.messenger.relockShard = async (itemOrId) => {
      if (!isGM()) return { success: false, error: 'GM only' };
      const item = MacroAPI._resolveItem(itemOrId);
      if (!item) return { success: false, error: 'Item not found' };
      return ns.dataShardService?.relockShard(item) ?? { success: false };
    };

    /**
     * Add a message to a data shard. GM only.
     * @param {string|Item} itemOrId
     * @param {object} messageData
     * @returns {Promise<{success: boolean}>}
     */
    ns.messenger.addShardMessage = async (itemOrId, messageData) => {
      if (!isGM()) return { success: false, error: 'GM only' };
      const item = MacroAPI._resolveItem(itemOrId);
      if (!item) return { success: false, error: 'Item not found' };
      return ns.dataShardService?.addMessage(item, messageData) ?? { success: false };
    };

    /**
     * Present a key item to a data shard.
     * @param {string|Item} shardItemOrId
     * @param {string|Actor} actorOrId
     * @returns {Promise<{success: boolean}>}
     */
    ns.messenger.presentKeyItem = async (shardItemOrId, actorOrId) => {
      const item = MacroAPI._resolveItem(shardItemOrId);
      const actor = MacroAPI._resolveActor(actorOrId);
      if (!item) return { success: false, error: 'Item not found' };
      if (!actor) return { success: false, error: 'Actor not found' };
      return ns.dataShardService?.presentKeyItem(item, actor) ?? { success: false };
    };

    // ═══════════════════════════════════════════════════════════
    //  CONTACT FUNCTIONS
    // ═══════════════════════════════════════════════════════════

    /**
     * Get master contacts. GM only.
     * @returns {Array}
     */
    ns.messenger.getMasterContacts = () => {
      return ns.masterContactService?.getAll() ?? [];
    };

    /**
     * Add a master contact. GM only.
     * @param {object} data
     * @returns {Promise<{success: boolean, contact?: object}>}
     */
    ns.messenger.addMasterContact = async (data) => {
      if (!isGM()) return { success: false, error: 'GM only' };
      return ns.masterContactService?.addContact(data) ?? { success: false };
    };

    /**
     * Push a master contact to a player.
     * @param {string} contactId
     * @param {string} actorIdOrName
     * @returns {Promise<{success: boolean}>}
     */
    ns.messenger.pushContactToPlayer = async (contactId, actorIdOrName) => {
      if (!isGM()) return { success: false, error: 'GM only' };
      const actorId = MacroAPI._resolveActorId(actorIdOrName);
      if (!actorId) return { success: false, error: 'Actor not found' };
      return ns.masterContactService?.pushToPlayer(contactId, actorId) ?? { success: false };
    };

    // ═══════════════════════════════════════════════════════════
    //  UI FUNCTIONS (augment existing stubs)
    // ═══════════════════════════════════════════════════════════

    // These are registered by registerGMTools at priority 112+
    // MacroAPI provides aliases on the messenger sub-namespace

    ns.messenger.openInbox = (actorIdOrName, messageId) => {
      const actorId = actorIdOrName ? MacroAPI._resolveActorId(actorIdOrName) : undefined;
      return ns.openInbox?.(actorId, messageId);
    };

    ns.messenger.openComposer = (data) => {
      return ns.composeMessage?.(data);
    };

    ns.messenger.openContacts = (actorIdOrName) => {
      const actorId = actorIdOrName ? MacroAPI._resolveActorId(actorIdOrName) : undefined;
      return ns.openContacts?.(actorId);
    };

    ns.messenger.openAdmin = () => ns.openAdmin?.();
    ns.messenger.openThemeCustomizer = () => ns.openThemeCustomizer?.();
    ns.messenger.openNetworkManagement = () => ns.openNetworkManagement?.();

    ns.messenger.openDataShard = (itemOrId) => {
      const item = MacroAPI._resolveItem(itemOrId);
      if (!item) return ui.notifications.error('Item not found');
      return ns.openDataShard?.(item);
    };

    ns.messenger.openGMContacts = () => {
      if (!isGM()) return ui.notifications.warn('GM only');
      return ns.openGMContacts?.();
    };

    log.info(`MacroAPI registered — ${Object.keys(ns.messenger).length} functions on game.nightcity.messenger`);
  }

  // ═══════════════════════════════════════════════════════════
  //  RESOLUTION HELPERS
  // ═══════════════════════════════════════════════════════════

  /**
   * Resolve an actor from ID, name, or Actor document.
   * @param {string|Actor} input
   * @returns {Actor|null}
   */
  static _resolveActor(input) {
    if (!input) return null;
    if (typeof input === 'object' && input.documentName === 'Actor') return input;

    // Try by ID first
    let actor = game.actors.get(input);
    if (actor) return actor;

    // Try by name
    actor = game.actors.getName(input);
    return actor ?? null;
  }

  /**
   * Resolve an actor ID from ID, name, or Actor document.
   * @param {string|Actor} input
   * @returns {string|null}
   */
  static _resolveActorId(input) {
    if (!input) return null;
    if (typeof input === 'object' && input.id) return input.id;

    // Check if it's already a valid ID
    if (game.actors.get(input)) return input;

    // Try by name
    const actor = game.actors.getName(input);
    return actor?.id ?? null;
  }

  /**
   * Resolve an item from ID, name, or Item document.
   * @param {string|Item} input
   * @returns {Item|null}
   */
  static _resolveItem(input) {
    if (!input) return null;
    if (typeof input === 'object' && input.documentName === 'Item') return input;

    // Try by ID
    let item = game.items.get(input);
    if (item) return item;

    // Try by name
    item = game.items.getName(input);
    return item ?? null;
  }

  /**
   * Resolve actor IDs in message data.
   * Converts names to IDs where needed.
   * @param {object} data
   * @returns {object}
   */
  static _resolveActors(data) {
    const resolved = { ...data };

    if (data.toActorId) {
      resolved.toActorId = MacroAPI._resolveActorId(data.toActorId) || data.toActorId;
    }
    if (data.fromActorId) {
      resolved.fromActorId = MacroAPI._resolveActorId(data.fromActorId) || data.fromActorId;
    }

    return resolved;
  }
}
