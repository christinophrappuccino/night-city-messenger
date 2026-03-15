/**
 * DataShardService
 * @file scripts/services/DataShardService.js
 * @module cyberpunkred-messenger
 * @description Data shard operations and full 4-layer security stack enforcement.
 *              Security layers (checked in order):
 *                1. Network — Must be on the required network
 *                2. Key Item — Must possess required physical token
 *                3. Login — Must authenticate with credentials
 *                4. Encryption — Must hack/decrypt the data
 *              GM force decrypt/relock as atomic reset.
 *              Per-message encryption support.
 */

import { MODULE_ID, EVENTS, SOCKET_OPS, DEFAULTS, ENCRYPTION_TYPES, FAILURE_MODES, CONTENT_TYPES, NETWORK_ACCESS_MODES, CONNECTION_MODES, SHARD_PRESETS } from '../utils/constants.js';
import { log, isGM, generateId } from '../utils/helpers.js';

export class DataShardService {

  // ─── Service Accessors ───

  get eventBus() { return game.nightcity?.eventBus; }
  get skillService() { return game.nightcity?.skillService; }
  get securityService() { return game.nightcity?.securityService; }
  get networkService() { return game.nightcity?.networkService; }
  get soundService() { return game.nightcity?.soundService; }
  get socketManager() { return game.nightcity?.socketManager; }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API — Shard Conversion
  // ═══════════════════════════════════════════════════════════

  /**
   * Convert an item into a data shard. Single atomic flag write.
   * Creates a linked journal for shard messages.
   * @param {Item} item - The item to convert
   * @param {object} [configOverrides] - Optional config overrides
   * @param {string} [presetKey] - Optional preset key from SHARD_PRESETS
   * @returns {Promise<{ success: boolean, journalId?: string }>}
   */
  async convertToDataShard(item, configOverrides = {}, presetKey = null) {
    if (!item) return { success: false, error: 'No item provided' };
    if (!isGM()) return { success: false, error: 'GM only operation' };

    // Check if already a shard
    if (item.getFlag(MODULE_ID, 'isDataShard')) {
      return { success: false, error: 'Item is already a data shard' };
    }

    try {
      // Create linked journal for shard messages
      const journal = await JournalEntry.create({
        name: `[NCM Shard] ${item.name}`,
        ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER },
        flags: { [MODULE_ID]: { type: 'data-shard', linkedItemId: item.id } },
      });

      // Build config: defaults → preset overrides → manual overrides
      let config = foundry.utils.deepClone(DEFAULTS.SHARD_CONFIG);

      // Apply preset if specified
      if (presetKey && SHARD_PRESETS[presetKey]) {
        config = this._applyPresetToConfig(config, presetKey);
      }

      // Apply manual overrides last (highest priority)
      config = foundry.utils.mergeObject(config, configOverrides, { inplace: false });

      // Single atomic flag write
      await item.update({
        [`flags.${MODULE_ID}.isDataShard`]: true,
        [`flags.${MODULE_ID}.config`]: config,
        [`flags.${MODULE_ID}.state`]: foundry.utils.deepClone(DEFAULTS.SHARD_STATE),
        [`flags.${MODULE_ID}.journalId`]: journal.id,
      });

      this.eventBus?.emit(EVENTS.SHARD_CREATED, { itemId: item.id, preset: presetKey });
      this.soundService?.play('shard-insert');
      log.info(`Item "${item.name}" converted to data shard (journal: ${journal.id}, preset: ${presetKey || 'none'})`);

      return { success: true, journalId: journal.id };
    } catch (err) {
      log.error(`Failed to convert item to shard: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  /**
   * Remove data shard status from an item. GM only.
   * Optionally deletes the linked journal.
   * @param {Item} item
   * @param {boolean} [deleteJournal=false]
   * @returns {Promise<{ success: boolean }>}
   */
  async removeDataShard(item, deleteJournal = false) {
    if (!isGM()) return { success: false, error: 'GM only' };
    if (!item?.getFlag(MODULE_ID, 'isDataShard')) return { success: false, error: 'Not a data shard' };

    try {
      const journalId = item.getFlag(MODULE_ID, 'journalId');

      // Remove all NCM flags
      await item.update({
        [`flags.-=${MODULE_ID}`]: null,
      });

      // Optionally delete linked journal
      if (deleteJournal && journalId) {
        const journal = game.journal.get(journalId);
        if (journal) await journal.delete();
      }

      log.info(`Data shard removed from "${item.name}"`);
      return { success: true };
    } catch (err) {
      log.error(`Failed to remove data shard: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API — Security Stack
  // ═══════════════════════════════════════════════════════════

  /**
   * Check the full 4-layer security stack for a data shard.
   * Validates: Network → Key Item → Login → Encryption
   * Returns the first blocking layer.
   *
   * @param {Item} item - The data shard item
   * @param {Actor} [actor] - The actor attempting access
   * @returns {{ blocked: boolean, layer?: string, reason?: string, config?: object, session?: object }}
   */
  checkFullSecurityStack(item, actor) {
    const config = this._getConfig(item);
    const state = this._getState(item);
    const session = this._getActorSession(state, actor?.id);

    // GM force-bypass flag — set by forceDecrypt, cleared by relockShard
    if (state.gmBypassed) {
      return { blocked: false, config, session };
    }

    // Check hacked layers (player bypassed via skill check)
    const hackedLayers = session.hackedLayers || [];

    // Layer 1: NETWORK
    // Supports both new `network` object and legacy flat `requiresNetwork` / `requiredNetwork`
    const networkRequired = config.network?.required ?? config.requiresNetwork ?? false;
    if (networkRequired && !hackedLayers.includes('network')) {
      const networkResult = this._checkNetworkAccess(config);
      if (!networkResult.allowed) {
        return {
          blocked: true,
          layer: 'network',
          reason: networkResult.reason,
          config,
          session,
          requiredNetwork: networkResult.requiredNetwork,
          connectionMode: config.network?.connectionMode ?? 'offline',
          signalInfo: networkResult.signalInfo,
        };
      }
    }

    // Layer 2: KEY ITEM
    if (config.requiresKeyItem && !session.keyItemUsed && !hackedLayers.includes('keyitem')) {
      return {
        blocked: true,
        layer: 'keyitem',
        reason: config.keyItemDisplayName || config.keyItemName || 'Access token required',
        config,
        session,
      };
    }

    // Layer 3: LOGIN
    if (config.requiresLogin && !session.loggedIn && !hackedLayers.includes('login')) {
      // Check key item bypass
      if (config.requiresKeyItem && config.keyItemBypassLogin && session.keyItemUsed) {
        // Key item bypasses login — skip this layer
      } else {
        return {
          blocked: true,
          layer: 'login',
          reason: config.loginDisplayName || 'Authentication required',
          config,
          session,
        };
      }
    }

    // Layer 4: ENCRYPTION
    if (config.encrypted && config.encryptionMode === 'shard' && !state.decrypted) {
      // Check key item bypass
      if (config.requiresKeyItem && config.keyItemBypassEncryption && session.keyItemUsed) {
        // Key item bypasses encryption — skip this layer
      } else {
        return {
          blocked: true,
          layer: 'encryption',
          reason: `${config.encryptionType} encryption active`,
          config,
          session,
          encryptionType: config.encryptionType,
          encryptionDC: config.encryptionDC,
          hackAttempts: session.hackAttempts,
          maxAttempts: config.maxHackAttempts,
          lockoutUntil: session.lockoutUntil,
        };
      }
    }

    return { blocked: false, config, session };
  }

  /**
   * Check if a specific message within a shard is encrypted.
   * Only relevant when encryptionMode === 'message'.
   * @param {Item} item
   * @param {string} messageId
   * @returns {{ encrypted: boolean, dc?: number }}
   */
  checkMessageEncryption(item, messageId) {
    const config = this._getConfig(item);
    if (config.encryptionMode !== 'message' || !config.encrypted) {
      return { encrypted: false };
    }

    const journal = this._getLinkedJournal(item);
    if (!journal) return { encrypted: false };

    const page = journal.pages.find(p => p.flags?.[MODULE_ID]?.messageId === messageId);
    if (!page) return { encrypted: false };

    const msgFlags = page.flags?.[MODULE_ID] ?? {};
    return {
      encrypted: msgFlags.encrypted !== false,
      dc: msgFlags.encryptionDC ?? config.encryptionDC,
      decrypted: msgFlags.decrypted === true,
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API — Key Item Access
  // ═══════════════════════════════════════════════════════════

  /**
   * Attempt to present a key item for shard access.
   * Checks inventory by ID → Tag → Name (priority order).
   *
   * @param {Item} shardItem - The data shard
   * @param {Actor} actor - The actor presenting the key
   * @returns {Promise<{ success: boolean, keyItem?: Item, consumed?: boolean, bypassLogin?: boolean, bypassEncryption?: boolean }>}
   */
  async presentKeyItem(shardItem, actor) {
    if (!actor) return { success: false, error: 'No actor provided' };

    const config = this._getConfig(shardItem);
    if (!config.requiresKeyItem) return { success: false, error: 'Shard does not require key item' };

    // Find matching key item in actor's inventory
    const keyItem = this._findKeyItem(actor, config);

    if (!keyItem) {
      this.eventBus?.emit(EVENTS.SHARD_KEY_ITEM_FAILED, {
        itemId: shardItem.id,
        actorId: actor.id,
        reason: 'Key item not found in inventory',
      });
      this.soundService?.play('key-rejected');
      return { success: false, error: 'Required access token not found' };
    }

    // Consume on use (with confirmation handled by UI before calling this)
    let consumed = false;
    if (config.keyItemConsumeOnUse) {
      try {
        await actor.deleteEmbeddedDocuments('Item', [keyItem.id]);
        consumed = true;
        log.info(`Key item "${keyItem.name}" consumed for shard "${shardItem.name}"`);
      } catch (err) {
        log.warn(`Failed to consume key item: ${err.message}`);
      }
    }

    // Update actor session
    await this._updateActorSession(shardItem, actor.id, { keyItemUsed: true });

    this.eventBus?.emit(EVENTS.SHARD_KEY_ITEM_PRESENTED, {
      itemId: shardItem.id,
      actorId: actor.id,
      keyItemId: keyItem.id,
      bypassLogin: config.keyItemBypassLogin,
      bypassEncryption: config.keyItemBypassEncryption,
    });
    this.soundService?.play('key-accepted');

    // Broadcast state change
    this._broadcastStateChange(shardItem.id);

    return {
      success: true,
      keyItem,
      consumed,
      bypassLogin: config.keyItemBypassLogin,
      bypassEncryption: config.keyItemBypassEncryption,
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API — Login Authentication
  // ═══════════════════════════════════════════════════════════

  /**
   * Attempt login authentication for a shard.
   * @param {Item} shardItem
   * @param {Actor} actor
   * @param {string} username
   * @param {string} password
   * @returns {Promise<{ success: boolean, locked?: boolean, attemptsRemaining?: number }>}
   */
  async attemptLogin(shardItem, actor, username, password) {
    if (!actor) return { success: false, error: 'No actor' };

    const config = this._getConfig(shardItem);
    if (!config.requiresLogin) return { success: false, error: 'Login not required' };

    const state = this._getState(shardItem);
    const session = this._getActorSession(state, actor.id);

    // Check lockout
    if (session.lockoutUntil && Date.now() < session.lockoutUntil) {
      return { success: false, locked: true, lockoutUntil: session.lockoutUntil };
    }

    // Validate credentials
    const usernameMatch = !config.loginUsername || 
      username.trim().toLowerCase() === config.loginUsername.trim().toLowerCase();
    const passwordMatch = password === config.loginPassword;

    if (usernameMatch && passwordMatch) {
      await this._updateActorSession(shardItem, actor.id, {
        loggedIn: true,
        loginAttempts: 0,
      });

      this.eventBus?.emit(EVENTS.SHARD_LOGIN_SUCCESS, { itemId: shardItem.id, actorId: actor.id });
      this.soundService?.play('login-success');
      this._broadcastStateChange(shardItem.id);

      return { success: true };
    }

    // Failed attempt
    const newAttempts = (session.loginAttempts || 0) + 1;
    const maxAttempts = config.maxLoginAttempts || 3;
    const updates = { loginAttempts: newAttempts };

    if (newAttempts >= maxAttempts) {
      updates.lockoutUntil = Date.now() + (config.lockoutDuration || 3600000);
    }

    await this._updateActorSession(shardItem, actor.id, updates);

    this.eventBus?.emit(EVENTS.SHARD_LOGIN_FAILURE, {
      itemId: shardItem.id,
      actorId: actor.id,
      attemptsRemaining: Math.max(0, maxAttempts - newAttempts),
    });
    this.soundService?.play('login-fail');

    return {
      success: false,
      locked: newAttempts >= maxAttempts,
      attemptsRemaining: Math.max(0, maxAttempts - newAttempts),
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API — Hacking (Encryption Layer)
  // ═══════════════════════════════════════════════════════════

  /**
   * Attempt to hack/breach a shard's encryption.
   * Routes through SkillService for the actual dice roll.
   *
   * @param {Item} shardItem - The data shard
   * @param {Actor} actor - The actor attempting the hack
   * @param {string} skillName - The skill being used
   * @param {object} [options]
   * @param {number} [options.luckSpend=0] - Luck points to spend
   * @param {string} [options.messageId] - For per-message encryption
   * @returns {Promise<HackResult>}
   *
   * @typedef {object} HackResult
   * @property {boolean} success
   * @property {object} roll - The SkillCheckResult from SkillService
   * @property {string} [failureEffect] - What happens on failure
   * @property {number} [damage] - BLACK ICE damage dealt
   * @property {boolean} [locked] - Whether the actor is now locked out
   * @property {boolean} [destroyed] - Whether the shard was destroyed
   */
  async attemptHack(shardItem, actor, skillName, options = {}) {
    if (!actor) return { success: false, error: 'No actor' };
    if (!this.skillService) return { success: false, error: 'SkillService not available' };

    const config = this._getConfig(shardItem);
    const state = this._getState(shardItem);
    const session = this._getActorSession(state, actor.id);
    const isMessageHack = !!options.messageId;

    // Check lockout
    if (session.lockoutUntil && Date.now() < session.lockoutUntil) {
      return { success: false, locked: true, lockoutUntil: session.lockoutUntil };
    }

    // Check max attempts
    if (session.hackAttempts >= config.maxHackAttempts && config.failureMode === 'permanent') {
      return { success: false, locked: true, permanent: true };
    }

    // Determine DC — per-skill DCs override global, plus signal penalty
    const baseDC = config.skillDCs?.[skillName] ?? config.encryptionDC ?? 15;
    const signalMod = this.getSignalDVModifier(shardItem);
    const dc = baseDC + signalMod.modifier;

    // Initialize security tracking
    this.securityService?.initTracking(actor.id, shardItem.id, {
      maxAttempts: config.maxHackAttempts,
      lockoutDuration: config.lockoutDuration,
    });

    // ─── Perform Skill Check via SkillService ───
    const rollResult = await this.skillService.performCheck(actor, skillName, {
      dc,
      luckSpend: options.luckSpend ?? 0,
      showChat: true,
      context: `Breaching ICE: ${shardItem.name}`,
      flavor: `${config.encryptionType} // DV ${dc}`,
    });

    // ─── Handle Result ───
    if (rollResult.success) {
      return this._handleHackSuccess(shardItem, actor, rollResult, isMessageHack, options.messageId);
    } else {
      return this._handleHackFailure(shardItem, actor, rollResult, config, session);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API — GM Operations
  // ═══════════════════════════════════════════════════════════

  /**
   * GM force decrypt a shard. Bypasses all security.
   * @param {Item} shardItem
   * @returns {Promise<{ success: boolean }>}
   */
  async forceDecrypt(shardItem) {
    if (!isGM()) return { success: false, error: 'GM only' };

    try {
      // Bypass ALL security layers — not just encryption
      // Must use unsetFlag + setFlag to avoid mergeObject issues
      await shardItem.unsetFlag(MODULE_ID, 'state');
      await shardItem.setFlag(MODULE_ID, 'state', {
        decrypted: true,
        gmBypassed: true,  // Tells security stack to skip all layers for everyone
        sessions: {},
        destroyed: false,
        bootPlayed: true, // Skip boot on force decrypt
        firstAccessedAt: null,
        accessCount: 0,
      });

      this.securityService?.resetAllForTarget(shardItem.id);
      this.eventBus?.emit(EVENTS.SHARD_DECRYPTED, { itemId: shardItem.id, actorId: 'gm-override' });
      this.soundService?.play('shard-decrypt');
      this._broadcastStateChange(shardItem.id);

      log.info(`GM force-decrypted shard "${shardItem.name}"`);
      return { success: true };
    } catch (err) {
      log.error(`Force decrypt failed: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  /**
   * GM relock a shard — atomic reset of all runtime state.
   * @param {Item} shardItem
   * @returns {Promise<{ success: boolean }>}
   */
  async relockShard(shardItem) {
    if (!isGM()) return { success: false, error: 'GM only' };

    try {
      // CRITICAL: Foundry's update() uses mergeObject on flags, which means
      // `sessions: {}` merges INTO existing sessions, leaving lockoutUntil intact.
      // Must DELETE the flag first, then write a clean state.
      await shardItem.unsetFlag(MODULE_ID, 'state');
      await shardItem.setFlag(MODULE_ID, 'state', {
        decrypted: false,
        sessions: {},
        destroyed: false,
        bootPlayed: false,
        firstAccessedAt: null,
        accessCount: 0,
      });

      // Clear all security tracking for this shard
      this.securityService?.resetAllForTarget(shardItem.id);

      this.eventBus?.emit(EVENTS.SHARD_RELOCKED, { itemId: shardItem.id });
      this.soundService?.play('shard-relock');
      this._broadcastStateChange(shardItem.id);

      log.info(`GM relocked shard "${shardItem.name}"`);
      return { success: true };
    } catch (err) {
      log.error(`Relock failed: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  /**
   * GM update shard configuration.
   * @param {Item} shardItem
   * @param {object} configUpdates
   * @returns {Promise<{ success: boolean }>}
   */
  async updateConfig(shardItem, configUpdates) {
    if (!isGM()) return { success: false, error: 'GM only' };

    try {
      const currentConfig = this._getConfig(shardItem);
      const newConfig = foundry.utils.mergeObject(currentConfig, configUpdates, { inplace: false });

      await shardItem.update({ [`flags.${MODULE_ID}.config`]: newConfig });
      log.debug(`Shard config updated for "${shardItem.name}"`);
      return { success: true };
    } catch (err) {
      log.error(`Config update failed: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API — Shard Messages
  // ═══════════════════════════════════════════════════════════

  /**
   * Get all messages stored in a data shard's linked journal.
   * @param {Item} shardItem
   * @returns {Array<object>}
   */
  getShardMessages(shardItem) {
    const journal = this._getLinkedJournal(shardItem);
    if (!journal) return [];

    return journal.pages
      .map(page => this._pageToShardMessage(page))
      .filter(Boolean)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }

  /**
   * Add an entry to a data shard. GM only.
   * Supports all content types: message, eddies, dossier, payload, avlog, location.
   *
   * @param {Item} shardItem
   * @param {object} messageData - { from, subject, body, timestamp, contentType?, contentData?, encrypted?, encryptionDC?, networkVisibility? }
   * @returns {Promise<{ success: boolean, messageId?: string }>}
   */
  async addMessage(shardItem, messageData) {
    if (!isGM()) return { success: false, error: 'GM only' };

    const journal = this._getLinkedJournal(shardItem);
    if (!journal) return { success: false, error: 'No linked journal found' };

    try {
      const messageId = generateId();
      const config = this._getConfig(shardItem);
      const contentType = messageData.contentType || CONTENT_TYPES.MESSAGE;

      await journal.createEmbeddedDocuments('JournalEntryPage', [{
        name: messageData.subject || 'Data Fragment',
        type: 'text',
        text: { content: messageData.body || '' },
        flags: {
          [MODULE_ID]: {
            messageId,
            type: 'shard-message',
            contentType,
            from: messageData.from || 'UNKNOWN',
            subject: messageData.subject || 'Data Fragment',
            timestamp: messageData.timestamp || new Date().toISOString(),
            // Content-type-specific payload
            contentData: messageData.contentData ?? {},
            // Per-message encryption (only if encryptionMode === 'message')
            encrypted: config.encryptionMode === 'message' ? (messageData.encrypted !== false) : false,
            encryptionDC: messageData.encryptionDC ?? config.encryptionDC,
            decrypted: false,
            corrupted: false,
            // Network visibility (per-entry)
            networkVisibility: messageData.networkVisibility ?? {
              restricted: false,
              allowedNetworks: [],
              allowedTypes: [],
            },
          },
        },
      }]);

      log.debug(`Entry "${messageData.subject}" (${contentType}) added to shard "${shardItem.name}"`);
      return { success: true, messageId };
    } catch (err) {
      log.error(`Failed to add entry to shard: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  /**
   * Remove a message from a data shard. GM only.
   * @param {Item} shardItem
   * @param {string} messageId
   * @returns {Promise<{ success: boolean }>}
   */
  async removeMessage(shardItem, messageId) {
    if (!isGM()) return { success: false, error: 'GM only' };

    const journal = this._getLinkedJournal(shardItem);
    if (!journal) return { success: false, error: 'No linked journal' };

    const page = journal.pages.find(p => p.flags?.[MODULE_ID]?.messageId === messageId);
    if (!page) return { success: false, error: 'Message not found' };

    try {
      await journal.deleteEmbeddedDocuments('JournalEntryPage', [page.id]);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API — Queries
  // ═══════════════════════════════════════════════════════════

  /**
   * Check if an item is a data shard.
   * @param {Item} item
   * @returns {boolean}
   */
  isDataShard(item) {
    return item?.getFlag(MODULE_ID, 'isDataShard') === true;
  }

  /**
   * Get shard config.
   * @param {Item} item
   * @returns {object}
   */
  getConfig(item) {
    return this._getConfig(item);
  }

  /**
   * Get shard state.
   * @param {Item} item
   * @returns {object}
   */
  getState(item) {
    return this._getState(item);
  }

  /**
   * Get actor session for a shard.
   * @param {Item} item
   * @param {string} actorId
   * @returns {object}
   */
  getActorSession(item, actorId) {
    const state = this._getState(item);
    return this._getActorSession(state, actorId);
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API — Presets (Sprint 4.6)
  // ═══════════════════════════════════════════════════════════

  /**
   * Get a shard preset definition by key.
   * @param {string} presetKey
   * @returns {object|null}
   */
  getPreset(presetKey) {
    return SHARD_PRESETS[presetKey] ?? null;
  }

  /**
   * Get all available shard preset keys with labels.
   * @returns {Array<{ key: string, label: string, icon: string }>}
   */
  getAllPresets() {
    return Object.entries(SHARD_PRESETS).map(([key, preset]) => ({
      key,
      label: preset.label,
      icon: preset.icon,
    }));
  }

  /**
   * Apply a preset to an existing data shard. GM only.
   * Merges preset security, boot, and theme into current config.
   * Does NOT overwrite manual config changes — preset is a base layer.
   *
   * @param {Item} shardItem
   * @param {string} presetKey
   * @returns {Promise<{ success: boolean }>}
   */
  async applyPreset(shardItem, presetKey) {
    if (!isGM()) return { success: false, error: 'GM only' };
    if (!SHARD_PRESETS[presetKey]) return { success: false, error: `Unknown preset: ${presetKey}` };

    try {
      const currentConfig = this._getConfig(shardItem);
      const newConfig = this._applyPresetToConfig(currentConfig, presetKey);

      await shardItem.update({ [`flags.${MODULE_ID}.config`]: newConfig });
      this.eventBus?.emit(EVENTS.SHARD_PRESET_APPLIED, { itemId: shardItem.id, preset: presetKey });

      log.info(`Preset "${presetKey}" applied to shard "${shardItem.name}"`);
      return { success: true };
    } catch (err) {
      log.error(`Failed to apply preset: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API — Integrity System (Sprint 4.6)
  // ═══════════════════════════════════════════════════════════

  /**
   * Get the current integrity status of a shard.
   * @param {Item} shardItem
   * @returns {{ enabled: boolean, current: number, max: number, percentage: number, tier: string, isBricked: boolean }}
   */
  checkIntegrity(shardItem) {
    const config = this._getConfig(shardItem);
    const integrity = config.integrity ?? {};

    if (!integrity.enabled) {
      return { enabled: false, current: 100, max: 100, percentage: 100, tier: 'clean', isBricked: false };
    }

    const current = integrity.currentIntegrity ?? 100;
    const max = integrity.maxIntegrity ?? 100;
    const pct = max > 0 ? Math.round((current / max) * 100) : 0;

    let tier = 'clean';
    if (pct <= 0) tier = 'bricked';
    else if (pct <= 24) tier = 'severe';
    else if (pct <= 49) tier = 'heavy';
    else if (pct <= 74) tier = 'light';

    return {
      enabled: true,
      current,
      max,
      percentage: pct,
      tier,
      isBricked: pct <= 0,
      mode: integrity.mode ?? 'cosmetic',
      belowCorruptionThreshold: current < (integrity.corruptionThreshold ?? 40),
    };
  }

  /**
   * Degrade a shard's integrity after a failed hack attempt.
   * If mechanical mode + below corruption threshold, may corrupt individual entries.
   * GM only (called internally after hack failure, or directly by GM).
   *
   * @param {Item} shardItem
   * @returns {Promise<{ newIntegrity: number, corruptedEntries: string[] }>}
   */
  async degradeIntegrity(shardItem) {
    const config = this._getConfig(shardItem);
    const integrity = config.integrity ?? {};

    if (!integrity.enabled) return { newIntegrity: 100, corruptedEntries: [] };

    const degradeAmount = integrity.degradePerFailure ?? 15;
    const newValue = Math.max(0, (integrity.currentIntegrity ?? 100) - degradeAmount);
    const corruptedEntries = [];

    // Update integrity value
    await shardItem.update({
      [`flags.${MODULE_ID}.config.integrity.currentIntegrity`]: newValue,
    });

    // Mechanical corruption check
    if (integrity.mode === 'mechanical' && newValue < (integrity.corruptionThreshold ?? 40)) {
      const journal = this._getLinkedJournal(shardItem);
      if (journal) {
        const chance = integrity.corruptionChance ?? 0.3;
        for (const page of journal.pages) {
          const flags = page.flags?.[MODULE_ID];
          if (flags?.type === 'shard-message' && !flags.corrupted && !flags.decrypted) {
            if (Math.random() < chance) {
              await page.update({ [`flags.${MODULE_ID}.corrupted`]: true });
              corruptedEntries.push(flags.messageId);
              this.eventBus?.emit(EVENTS.SHARD_ENTRY_CORRUPTED, {
                itemId: shardItem.id, entryId: flags.messageId,
              });
            }
          }
        }
      }
    }

    this.eventBus?.emit(EVENTS.SHARD_INTEGRITY_CHANGED, {
      itemId: shardItem.id, newIntegrity: newValue,
    });

    if (newValue <= 0) {
      this.eventBus?.emit(EVENTS.SHARD_INTEGRITY_BRICKED, { itemId: shardItem.id });
      this.soundService?.play('shard-brick');
    }

    log.debug(`Shard "${shardItem.name}" integrity: ${newValue}${corruptedEntries.length ? ` (${corruptedEntries.length} entries corrupted)` : ''}`);
    return { newIntegrity: newValue, corruptedEntries };
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API — Eddies Claim (Sprint 4.6)
  // ═══════════════════════════════════════════════════════════

  /**
   * Claim eddies from an eddies-type shard entry.
   * Wires the amount to the actor's CPR wealth ledger.
   *
   * @param {Item} shardItem
   * @param {string} entryId - The messageId of the eddies entry
   * @param {Actor} actor - The actor claiming the eddies
   * @returns {Promise<{ success: boolean, amount?: number }>}
   */
  async claimEddies(shardItem, entryId, actor) {
    if (!actor) return { success: false, error: 'No actor provided' };

    const journal = this._getLinkedJournal(shardItem);
    if (!journal) return { success: false, error: 'No linked journal' };

    const page = journal.pages.find(p => p.flags?.[MODULE_ID]?.messageId === entryId);
    if (!page) return { success: false, error: 'Entry not found' };

    const flags = page.flags?.[MODULE_ID];
    if (flags.contentType !== CONTENT_TYPES.EDDIES) {
      return { success: false, error: 'Entry is not an eddies type' };
    }

    const contentData = flags.contentData ?? {};
    if (contentData.claimed) {
      return { success: false, error: 'Eddies already claimed' };
    }

    const amount = contentData.amount ?? 0;
    if (amount <= 0) return { success: false, error: 'No eddies to claim' };

    try {
      // Wire to CPR wealth ledger — uses array format ["description", "reason"]
      const currentWealth = actor.system?.wealth ?? [];
      const newEntry = [`Claimed ${amount}eb from data shard`, 'Data Shard Eddies'];
      const updatedWealth = [...currentWealth, newEntry];
      await actor.update({ 'system.wealth': updatedWealth });

      // Mark as claimed on the journal page
      await page.update({
        [`flags.${MODULE_ID}.contentData.claimed`]: true,
        [`flags.${MODULE_ID}.contentData.claimedBy`]: actor.id,
        [`flags.${MODULE_ID}.contentData.claimedAt`]: new Date().toISOString(),
      });

      this.eventBus?.emit(EVENTS.SHARD_EDDIES_CLAIMED, {
        itemId: shardItem.id, entryId, actorId: actor.id, amount,
      });
      this.soundService?.play('eddies-claim');

      log.info(`${actor.name} claimed ${amount}eb from shard "${shardItem.name}"`);
      return { success: true, amount };
    } catch (err) {
      log.error(`Eddies claim failed: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API — Signal & Visibility (Sprint 4.6)
  // ═══════════════════════════════════════════════════════════

  /**
   * Calculate the DV modifier from current signal strength.
   * Low signal increases hack difficulty.
   * @param {Item} shardItem
   * @returns {{ modifier: number, signalStrength: number, label: string }}
   */
  getSignalDVModifier(shardItem) {
    const config = this._getConfig(shardItem);
    if (!config.network?.signalDVModifier) return { modifier: 0, signalStrength: 100, label: '' };

    const signal = this.networkService?.signalStrength ?? 100;

    // DV modifier scale: 100-75 = +0, 74-50 = +2, 49-25 = +4, 24-1 = +8
    let modifier = 0;
    let label = '';
    if (signal <= 24) { modifier = 8; label = 'Critical signal'; }
    else if (signal <= 49) { modifier = 4; label = 'Weak signal'; }
    else if (signal <= 74) { modifier = 2; label = 'Degraded signal'; }

    return { modifier, signalStrength: signal, label };
  }

  /**
   * Filter shard entries by network visibility for the current network.
   * Returns entries the current connection can see, plus metadata about hidden entries.
   *
   * @param {Item} shardItem
   * @returns {{ visible: Array, hiddenCount: number, totalCount: number }}
   */
  getVisibleEntries(shardItem) {
    const allEntries = this.getShardMessages(shardItem);
    const totalCount = allEntries.length;

    // If GM, all visible
    if (isGM()) return { visible: allEntries, hiddenCount: 0, totalCount };

    const currentNetworkId = this.networkService?.currentNetworkId ?? null;
    const currentNetworkType = this.networkService?.currentNetwork?.type ?? null;

    const visible = [];
    let hiddenCount = 0;

    for (const entry of allEntries) {
      const nv = entry.networkVisibility;
      if (!nv?.restricted) {
        visible.push(entry);
        continue;
      }

      // Check if current network satisfies the entry's visibility requirements
      const networkMatch = nv.allowedNetworks?.length
        ? nv.allowedNetworks.includes(currentNetworkId)
        : false;
      const typeMatch = nv.allowedTypes?.length
        ? nv.allowedTypes.includes(currentNetworkType)
        : false;

      if (networkMatch || typeMatch) {
        visible.push(entry);
      } else {
        hiddenCount++;
      }
    }

    return { visible, hiddenCount, totalCount };
  }

  // ═══════════════════════════════════════════════════════════
  //  PRIVATE — Hack Result Handlers
  // ═══════════════════════════════════════════════════════════

  /** @private */
  async _handleHackSuccess(shardItem, actor, rollResult, isMessageHack, messageId) {
    if (isMessageHack && messageId) {
      // Decrypt individual message
      await this._decryptMessage(shardItem, messageId);
    } else {
      // Decrypt entire shard
      const state = this._getState(shardItem);
      state.decrypted = true;
      await shardItem.update({ [`flags.${MODULE_ID}.state`]: state });
    }

    // Reset hack attempts on success
    await this._updateActorSession(shardItem, actor.id, { hackAttempts: 0 });
    this.securityService?.recordSuccess(actor.id, shardItem.id);

    this.eventBus?.emit(EVENTS.SHARD_DECRYPTED, { itemId: shardItem.id, actorId: actor.id });
    this.soundService?.play('hack-success');
    this._broadcastStateChange(shardItem.id);

    return {
      success: true,
      roll: rollResult,
      failureEffect: null,
    };
  }

  /** @private */
  async _handleHackFailure(shardItem, actor, rollResult, config, session) {
    const newAttempts = (session.hackAttempts || 0) + 1;
    const updates = { hackAttempts: newAttempts };

    // Degrade integrity if enabled (fire-and-forget, non-blocking)
    if (config.integrity?.enabled) {
      this.degradeIntegrity(shardItem).catch(err => log.warn(`Integrity degrade failed: ${err.message}`));
    }

    const result = {
      success: false,
      roll: rollResult,
      failureEffect: config.failureMode,
      damage: 0,
      locked: false,
      destroyed: false,
    };

    // Record failed attempt in SecurityService
    const secResult = this.securityService?.recordFailedAttempt(actor.id, shardItem.id);

    switch (config.failureMode) {
      case FAILURE_MODES.LOCKOUT:
        if (newAttempts >= config.maxHackAttempts) {
          updates.lockoutUntil = Date.now() + (config.lockoutDuration || 3600000);
          result.locked = true;
          this.soundService?.play('lockout');
        }
        break;

      case FAILURE_MODES.PERMANENT:
        if (newAttempts >= config.maxHackAttempts) {
          updates.lockoutUntil = Number.MAX_SAFE_INTEGER; // Permanent lockout (survives JSON)
          result.locked = true;
          this.soundService?.play('lockout');
        }
        break;

      case FAILURE_MODES.DAMAGE:
        // BLACK ICE damage — apply HP damage
        if (config.encryptionType === ENCRYPTION_TYPES.BLACK_ICE || config.encryptionType === ENCRYPTION_TYPES.RED_ICE) {
          const damage = await this._applyBlackICEDamage(actor, config.encryptionType);
          result.damage = damage;
          this.eventBus?.emit(EVENTS.SHARD_BLACK_ICE, {
            itemId: shardItem.id,
            actorId: actor.id,
            damage,
          });
        }
        // Also lockout after max attempts
        if (newAttempts >= config.maxHackAttempts) {
          updates.lockoutUntil = Date.now() + (config.lockoutDuration || 3600000);
          result.locked = true;
        }
        break;

      case FAILURE_MODES.DESTROY:
        if (newAttempts >= config.maxHackAttempts) {
          // Shard self-destructs — wipe all messages
          await this._destroyShard(shardItem);
          result.destroyed = true;
        }
        break;

      case FAILURE_MODES.NOTHING:
      default:
        // No additional consequences
        break;
    }

    await this._updateActorSession(shardItem, actor.id, updates);

    this.eventBus?.emit(EVENTS.SHARD_HACK_ATTEMPT, {
      itemId: shardItem.id,
      actorId: actor.id,
      success: false,
      roll: rollResult.total,
      dc: rollResult.dc,
    });
    this.soundService?.play('hack-fail');

    return result;
  }

  // ═══════════════════════════════════════════════════════════
  //  LAYER HACK — Attempt Tracking & Consequences
  // ═══════════════════════════════════════════════════════════

  /**
   * Get hack attempt info for a specific security layer (network/keyitem/login).
   * @param {Item} item
   * @param {string} actorId
   * @param {string} layer - 'network' | 'keyitem' | 'login'
   * @returns {{ attempts: number, max: number, isLockedOut: boolean, lockoutRemaining: number }}
   */
  getLayerHackInfo(item, actorId, layer) {
    const config = this.getConfig(item);
    const layerSec = config.layerSecurity ?? {};
    const max = layerSec.maxAttempts ?? 3;
    const state = this._getState(item);
    const session = this._getActorSession(state, actorId);
    const attempts = session.layerHackAttempts?.[layer] ?? 0;
    const lockoutUntil = session.layerLockoutUntil ?? 0;
    const isLockedOut = lockoutUntil > Date.now();
    const lockoutRemaining = isLockedOut ? Math.ceil((lockoutUntil - Date.now()) / 1000) : 0;
    return { attempts, max, isLockedOut, lockoutRemaining };
  }

  /**
   * Record a failed layer hack attempt and apply configured consequences.
   * @param {Item} item
   * @param {string} actorId
   * @param {string} layer - 'network' | 'keyitem' | 'login'
   * @returns {Promise<{ locked: boolean, destroyed: boolean, damage: number }>}
   */
  async handleLayerHackFailure(item, actorId, layer) {
    const config = this.getConfig(item);
    const layerSec = config.layerSecurity ?? {};
    const failureMode = layerSec.failureMode ?? 'nothing';
    const max = layerSec.maxAttempts ?? 3;
    const lockoutDuration = layerSec.lockoutDuration ?? 3600000;

    const state = this._getState(item);
    const session = this._getActorSession(state, actorId);
    const prevAttempts = session.layerHackAttempts ?? {};
    const newCount = (prevAttempts[layer] ?? 0) + 1;

    const updates = {
      layerHackAttempts: { ...prevAttempts, [layer]: newCount },
    };

    const result = { locked: false, destroyed: false, damage: 0 };

    // Degrade integrity on any failed layer hack if enabled
    if (config.integrity?.enabled && layerSec.degradeOnFail) {
      this.degradeIntegrity(item).catch(err => log.warn(`Integrity degrade failed: ${err.message}`));
    }

    if (newCount >= max) {
      switch (failureMode) {
        case FAILURE_MODES.LOCKOUT:
          updates.layerLockoutUntil = Date.now() + lockoutDuration;
          result.locked = true;
          this.soundService?.play('lockout');
          break;

        case FAILURE_MODES.PERMANENT:
          updates.layerLockoutUntil = Number.MAX_SAFE_INTEGER;
          result.locked = true;
          this.soundService?.play('lockout');
          break;

        case FAILURE_MODES.DESTROY:
          await this._destroyShard(item);
          result.destroyed = true;
          break;

        case FAILURE_MODES.DAMAGE: {
          // BLACK ICE damage even on layer hacks if configured
          const actor = game.actors?.get(actorId);
          if (actor) {
            const damage = await this._applyBlackICEDamage(actor, config.encryptionType || 'ICE');
            result.damage = damage;
          }
          if (newCount >= max) {
            updates.layerLockoutUntil = Date.now() + lockoutDuration;
            result.locked = true;
          }
          break;
        }

        case FAILURE_MODES.NOTHING:
        default:
          break;
      }
    }

    await this._updateActorSession(item, actorId, updates);
    return result;
  }

  /**
   * Reset layer hack attempts for an actor on this shard.
   * @param {Item} item
   * @param {string} actorId
   */
  async resetLayerHackAttempts(item, actorId) {
    await this._updateActorSession(item, actorId, {
      layerHackAttempts: {},
      layerLockoutUntil: null,
    });
  }

  /**
   * Apply BLACK ICE damage to an actor.
   * BLACK_ICE: 3d6, RED_ICE: 5d6
   * @param {Actor} actor
   * @param {string} encryptionType
   * @returns {Promise<number>} damage dealt
   * @private
   */
  async _applyBlackICEDamage(actor, encryptionType) {
    const formula = encryptionType === ENCRYPTION_TYPES.RED_ICE ? '5d6' : '3d6';

    try {
      const damageRoll = new Roll(formula);
      await damageRoll.evaluate();
      const damage = damageRoll.total;

      // Apply damage to actor HP
      const currentHP = actor.system?.derivedStats?.hp?.value ?? actor.system?.hp?.value ?? 0;
      const newHP = Math.max(0, currentHP - damage);

      // Try both possible HP paths for CPR system
      const hpUpdate = actor.system?.derivedStats?.hp
        ? { 'system.derivedStats.hp.value': newHP }
        : { 'system.hp.value': newHP };

      await actor.update(hpUpdate);

      // Post damage to chat
      await damageRoll.toMessage({
        speaker: ChatMessage.getSpeaker({ alias: 'BLACK ICE' }),
        flavor: `<strong style="color:#ff0033">⚡ ${encryptionType} DAMAGE</strong><br>${actor.name} takes ${damage} damage!`,
      });

      this.soundService?.play('black-ice');
      log.info(`BLACK ICE (${encryptionType}) dealt ${damage} damage to ${actor.name} (HP: ${currentHP} → ${newHP})`);

      return damage;
    } catch (err) {
      log.error(`Failed to apply BLACK ICE damage: ${err.message}`);
      return 0;
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  PRIVATE — Shard Destruction
  // ═══════════════════════════════════════════════════════════

  /** @private */
  async _destroyShard(shardItem) {
    try {
      const journal = this._getLinkedJournal(shardItem);
      if (journal) {
        // Delete all pages (messages)
        const pageIds = journal.pages.map(p => p.id);
        if (pageIds.length) {
          await journal.deleteEmbeddedDocuments('JournalEntryPage', pageIds);
        }
      }

      // Mark as destroyed in state
      await shardItem.update({
        [`flags.${MODULE_ID}.state`]: {
          decrypted: false,
          sessions: {},
          destroyed: true,
        },
      });

      log.info(`Shard "${shardItem.name}" self-destructed`);
    } catch (err) {
      log.error(`Shard destruction failed: ${err.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  PRIVATE — Per-Message Encryption
  // ═══════════════════════════════════════════════════════════

  /** @private */
  async _decryptMessage(shardItem, messageId) {
    const journal = this._getLinkedJournal(shardItem);
    if (!journal) return;

    const page = journal.pages.find(p => p.flags?.[MODULE_ID]?.messageId === messageId);
    if (!page) return;

    await page.update({ [`flags.${MODULE_ID}.decrypted`]: true });
  }

  // ═══════════════════════════════════════════════════════════
  //  PRIVATE — Data Accessors
  // ═══════════════════════════════════════════════════════════

  /** @private */
  _getConfig(item) {
    const raw = item?.getFlag(MODULE_ID, 'config');
    return foundry.utils.mergeObject(
      foundry.utils.deepClone(DEFAULTS.SHARD_CONFIG),
      raw ?? {},
      { inplace: false }
    );
  }

  /** @private */
  _getState(item) {
    const raw = item?.getFlag(MODULE_ID, 'state');
    return foundry.utils.mergeObject(
      foundry.utils.deepClone(DEFAULTS.SHARD_STATE),
      raw ?? {},
      { inplace: false }
    );
  }

  /** @private */
  _getActorSession(state, actorId) {
    if (!actorId) return { ...DEFAULTS.ACTOR_SESSION };
    return foundry.utils.mergeObject(
      { ...DEFAULTS.ACTOR_SESSION },
      state.sessions?.[actorId] ?? {},
      { inplace: false }
    );
  }

  /** @private */
  async _updateActorSession(item, actorId, updates) {
    const state = this._getState(item);
    if (!state.sessions) state.sessions = {};
    state.sessions[actorId] = foundry.utils.mergeObject(
      this._getActorSession(state, actorId),
      updates,
      { inplace: false }
    );
    await item.update({ [`flags.${MODULE_ID}.state`]: state });
  }

  /** @private */
  _getLinkedJournal(item) {
    const journalId = item?.getFlag(MODULE_ID, 'journalId');
    return journalId ? game.journal.get(journalId) : null;
  }

  /** @private */
  _pageToShardMessage(page) {
    const flags = page?.flags?.[MODULE_ID];
    if (!flags || flags.type !== 'shard-message') return null;

    return {
      id: flags.messageId,
      pageId: page.id,
      contentType: flags.contentType || CONTENT_TYPES.MESSAGE,  // Backward compat: undefined → 'message'
      from: flags.from || 'UNKNOWN',
      subject: flags.subject || 'Data Fragment',
      body: page.text?.content || '',
      timestamp: flags.timestamp,
      encrypted: flags.encrypted ?? false,
      encryptionDC: flags.encryptionDC,
      decrypted: flags.decrypted ?? false,
      corrupted: flags.corrupted ?? false,
      contentData: flags.contentData ?? {},
      networkVisibility: flags.networkVisibility ?? { restricted: false, allowedNetworks: [], allowedTypes: [] },
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  PRIVATE — Key Item Matching
  // ═══════════════════════════════════════════════════════════

  /**
   * Find a key item in an actor's inventory. Priority: ID → Tag → Name.
   * @private
   */
  _findKeyItem(actor, config) {
    if (!actor?.items) return null;

    // Strategy 1: By Item ID (exact match)
    if (config.keyItemId) {
      const item = actor.items.get(config.keyItemId);
      if (item) return item;
    }

    // Strategy 2: By Tag (flag-based)
    if (config.keyItemTag) {
      const item = actor.items.find(i =>
        i.getFlag(MODULE_ID, 'keyTag') === config.keyItemTag
      );
      if (item) return item;
    }

    // Strategy 3: By Name (case-insensitive, trimmed)
    if (config.keyItemName) {
      const target = config.keyItemName.toLowerCase().trim();
      const item = actor.items.find(i =>
        i.name.toLowerCase().trim() === target
      );
      if (item) return item;
    }

    return null;
  }

  // ═══════════════════════════════════════════════════════════
  //  PRIVATE — Network Access Check (Sprint 4.6)
  // ═══════════════════════════════════════════════════════════

  /**
   * Check if the current network connection satisfies the shard's network requirements.
   * Handles all access modes: any, whitelist, type, both.
   * Also checks tethered connection and signal threshold.
   *
   * @param {object} config - The shard config
   * @returns {{ allowed: boolean, reason?: string, requiredNetwork?: string, signalInfo?: object }}
   * @private
   */
  _checkNetworkAccess(config) {
    const netConfig = config.network ?? {};
    const currentNetworkId = this.networkService?.currentNetworkId ?? null;
    const currentNetworkType = this.networkService?.currentNetwork?.type ?? null;

    // Legacy flat field support: if no network object, fall back to old requiresNetwork/requiredNetwork
    if (!config.network?.required && config.requiresNetwork) {
      const onNetwork = this.networkService?.isOnNetwork(config.requiredNetwork) ?? false;
      if (!onNetwork) {
        return {
          allowed: false,
          reason: `Requires network: ${config.requiredNetwork}`,
          requiredNetwork: config.requiredNetwork,
        };
      }
      return { allowed: true };
    }

    // No network connected at all
    if (!currentNetworkId) {
      return {
        allowed: false,
        reason: 'No network connection',
      };
    }

    // Check access mode
    const mode = netConfig.accessMode ?? 'any';
    let accessGranted = false;

    switch (mode) {
      case NETWORK_ACCESS_MODES.ANY:
        accessGranted = true;
        break;

      case NETWORK_ACCESS_MODES.WHITELIST:
        accessGranted = (netConfig.allowedNetworks ?? []).includes(currentNetworkId);
        break;

      case NETWORK_ACCESS_MODES.TYPE:
        accessGranted = (netConfig.allowedTypes ?? []).includes(currentNetworkType);
        break;

      case NETWORK_ACCESS_MODES.BOTH:
        accessGranted = (netConfig.allowedNetworks ?? []).includes(currentNetworkId)
          || (netConfig.allowedTypes ?? []).includes(currentNetworkType);
        break;

      default:
        accessGranted = true;
    }

    if (!accessGranted) {
      const requirements = [];
      if (netConfig.allowedTypes?.length) requirements.push(`Type: ${netConfig.allowedTypes.join(', ')}`);
      if (netConfig.allowedNetworks?.length) requirements.push(`Networks: ${netConfig.allowedNetworks.join(', ')}`);
      return {
        allowed: false,
        reason: `Network access restricted — ${requirements.join(' or ')}`,
        requiredNetwork: netConfig.allowedNetworks?.[0] ?? null,
      };
    }

    // Tethered connection: check signal threshold
    if (netConfig.connectionMode === CONNECTION_MODES.TETHERED) {
      const signal = this.networkService?.signalStrength ?? 100;
      const threshold = netConfig.signalThreshold ?? 40;

      if (signal < threshold) {
        return {
          allowed: false,
          reason: `Signal too weak (${signal}% < ${threshold}% required)`,
          signalInfo: { signal, threshold },
        };
      }
    }

    return { allowed: true };
  }

  // ═══════════════════════════════════════════════════════════
  //  PRIVATE — Preset Application (Sprint 4.6)
  // ═══════════════════════════════════════════════════════════

  /**
   * Merge a preset's defaults into a shard config.
   * Preset values provide a base layer — existing manual config takes priority.
   * @param {object} config - Current config
   * @param {string} presetKey - Preset key from SHARD_PRESETS
   * @returns {object} Merged config
   * @private
   */
  _applyPresetToConfig(config, presetKey) {
    const preset = SHARD_PRESETS[presetKey];
    if (!preset) return config;

    const merged = foundry.utils.deepClone(config);
    merged.preset = presetKey;

    // Apply security defaults from preset
    if (preset.security) {
      merged.encrypted = preset.security.encrypted ?? merged.encrypted;
      merged.encryptionType = preset.security.encryptionType ?? merged.encryptionType;
      merged.encryptionDC = preset.security.encryptionDC ?? merged.encryptionDC;
      merged.failureMode = preset.security.failureMode ?? merged.failureMode;
      merged.maxHackAttempts = preset.security.maxHackAttempts ?? merged.maxHackAttempts;
    }

    // Apply boot config from preset
    if (preset.boot) {
      merged.boot = foundry.utils.mergeObject(merged.boot, preset.boot, { inplace: false });
    }

    // Apply theme from preset (the viewer uses this for accent colors, watermarks, etc.)
    if (preset.theme) {
      merged.theme = presetKey;
      // Store the full theme object for the viewer
      merged._presetTheme = foundry.utils.deepClone(preset.theme);
    }

    return merged;
  }

  // ═══════════════════════════════════════════════════════════
  //  PRIVATE — Socket Broadcast
  // ═══════════════════════════════════════════════════════════

  /** @private */
  _broadcastStateChange(itemId) {
    try {
      this.socketManager?.emit(SOCKET_OPS.SHARD_STATE_CHANGED, { itemId });
    } catch {
      // Non-fatal
    }
  }
}
