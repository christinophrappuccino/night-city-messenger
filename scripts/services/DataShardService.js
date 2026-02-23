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

import { MODULE_ID, EVENTS, SOCKET_OPS, DEFAULTS, ENCRYPTION_TYPES, FAILURE_MODES } from '../utils/constants.js';
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
   * @returns {Promise<{ success: boolean, journalId?: string }>}
   */
  async convertToDataShard(item, configOverrides = {}) {
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

      // Merge config with defaults
      const config = foundry.utils.mergeObject(
        foundry.utils.deepClone(DEFAULTS.SHARD_CONFIG),
        configOverrides,
        { inplace: false }
      );

      // Single atomic flag write
      await item.update({
        [`flags.${MODULE_ID}.isDataShard`]: true,
        [`flags.${MODULE_ID}.config`]: config,
        [`flags.${MODULE_ID}.state`]: foundry.utils.deepClone(DEFAULTS.SHARD_STATE),
        [`flags.${MODULE_ID}.journalId`]: journal.id,
      });

      this.eventBus?.emit(EVENTS.SHARD_CREATED, { itemId: item.id });
      this.soundService?.play('shard-insert');
      log.info(`Item "${item.name}" converted to data shard (journal: ${journal.id})`);

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

    // GM bypass — GMs always see content (but overlays still show for them to manage)
    // Note: GM bypass is handled at the UI level, not here.
    // Service always returns the true security state.

    // Layer 1: NETWORK
    if (config.requiresNetwork && config.requiredNetwork) {
      const onNetwork = this.networkService?.isOnNetwork(config.requiredNetwork) ?? false;
      if (!onNetwork) {
        return {
          blocked: true,
          layer: 'network',
          reason: `Requires network: ${config.requiredNetwork}`,
          config,
          session,
          requiredNetwork: config.requiredNetwork,
        };
      }
    }

    // Layer 2: KEY ITEM
    if (config.requiresKeyItem && !session.keyItemUsed) {
      return {
        blocked: true,
        layer: 'keyitem',
        reason: config.keyItemDisplayName || config.keyItemName || 'Access token required',
        config,
        session,
      };
    }

    // Layer 3: LOGIN
    if (config.requiresLogin && !session.loggedIn) {
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

    // Determine DC — per-skill DCs override global
    const dc = config.skillDCs?.[skillName] ?? config.encryptionDC ?? 15;

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
      const state = this._getState(shardItem);
      state.decrypted = true;

      await shardItem.update({ [`flags.${MODULE_ID}.state`]: state });
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
      // Atomic reset — single write
      await shardItem.update({
        [`flags.${MODULE_ID}.state`]: {
          decrypted: false,
          sessions: {},
        },
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
   * Add a message to a data shard. GM only.
   * @param {Item} shardItem
   * @param {object} messageData - { from, subject, body, timestamp, encrypted?, encryptionDC? }
   * @returns {Promise<{ success: boolean, messageId?: string }>}
   */
  async addMessage(shardItem, messageData) {
    if (!isGM()) return { success: false, error: 'GM only' };

    const journal = this._getLinkedJournal(shardItem);
    if (!journal) return { success: false, error: 'No linked journal found' };

    try {
      const messageId = generateId();
      const config = this._getConfig(shardItem);

      await journal.createEmbeddedDocuments('JournalEntryPage', [{
        name: messageData.subject || 'Data Fragment',
        type: 'text',
        text: { content: messageData.body || '' },
        flags: {
          [MODULE_ID]: {
            messageId,
            type: 'shard-message',
            from: messageData.from || 'UNKNOWN',
            subject: messageData.subject || 'Data Fragment',
            timestamp: messageData.timestamp || new Date().toISOString(),
            // Per-message encryption (only if encryptionMode === 'message')
            encrypted: config.encryptionMode === 'message' ? (messageData.encrypted !== false) : false,
            encryptionDC: messageData.encryptionDC ?? config.encryptionDC,
            decrypted: false,
          },
        },
      }]);

      log.debug(`Message "${messageData.subject}" added to shard "${shardItem.name}"`);
      return { success: true, messageId };
    } catch (err) {
      log.error(`Failed to add message to shard: ${err.message}`);
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
          updates.lockoutUntil = Infinity; // Permanent lockout
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
  //  PRIVATE — BLACK ICE Damage
  // ═══════════════════════════════════════════════════════════

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
      from: flags.from || 'UNKNOWN',
      subject: flags.subject || 'Data Fragment',
      body: page.text?.content || '',
      timestamp: flags.timestamp,
      encrypted: flags.encrypted ?? false,
      encryptionDC: flags.encryptionDC,
      decrypted: flags.decrypted ?? false,
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
