/**
 * DataShardService
 * @file scripts/services/DataShardService.js
 * @module night-city-messenger
 * @description Data shard operations and full 4-layer security stack enforcement.
 *              Security layers (checked in order):
 *                1. Network — Must be on the required network
 *                2. Key Item — Must possess required physical token
 *                3. Login — Must authenticate with credentials
 *                4. Encryption — Must hack/decrypt the data
 *              GM force decrypt/relock as atomic reset.
 *              Per-message encryption support.
 */

import { MODULE_ID, EVENTS, SOCKET_OPS, DEFAULTS, ENCRYPTION_TYPES, FAILURE_MODES, CONTENT_TYPES, SHARD_PRESETS } from '../utils/constants.js';
import { log, isGM, generateId } from '../utils/helpers.js';
import {
  resolveIntegrity, percentOf, tierOf, entryLevel, quantize, effectiveHit, applyLoss, unstableFor,
} from '../ui/content/IntegrityModel.js';

export class DataShardService {

  // ─── Service Accessors ───

  get eventBus() { return game.nightcity?.eventBus; }
  get skillService() { return game.nightcity?.skillService; }
  get securityService() { return game.nightcity?.securityService; }
  get iceService() { return game.nightcity?.iceService; }
  get networkService() { return game.nightcity?.networkService; }
  get soundService() { return game.nightcity?.soundService; }
  get socketManager() { return game.nightcity?.socketManager; }
  get timeService() { return game.nightcity?.timeService; }

  /** Current time in epoch ms via the configured time provider (real-time / world-time / manual / disguised). */
  _nowMs() {
    try {
      if (this.timeService) return this.timeService.getCurrentTimeMs();
    } catch { /* fallback */ }
    return Date.now();
  }

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
      // Where the journal is filed. A shard a PLAYER forged goes under
      // "Data Shards / Player-Made / <character>", so the GM can see at a glance
      // what their table has been making and whose it is. Everything else lands
      // in the flat Data Shards folder as before.
      const repo = game.nightcity?.messageRepository;
      const maker = configOverrides?.playerMade?.actorName;
      const shardFolder = maker
        ? (await repo?.getSubfolderPath?.(['Data Shards', 'Player-Made', maker])
           ?? await repo?.getShardFolder?.())
        : await repo?.getShardFolder?.();

      // Create linked journal for shard messages
      const journal = await JournalEntry.create({
        name: `${item.name} — Shard`,
        ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER },
        folder: shardFolder?.id || null,
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
      // An ARCHIVE copy (see archiveShardsToItems) shares the SOURCE shard's
      // journal — it is a window onto the player's shard, not a second copy of
      // it. Deleting that journal here would gut the player's real shard, so an
      // archive can only ever remove itself.
      const isArchive = !!item.getFlag(MODULE_ID, 'shardArchive');

      // Remove all NCM flags
      await item.update({
        [`flags.-=${MODULE_ID}`]: null,
      });

      // Optionally delete linked journal
      if (deleteJournal && journalId && !isArchive) {
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

    // Build effective hackedLayers:
    // Merge the actor's session AND the gm-override session (if GM)
    // so admin panel layer toggles apply regardless of which actor the GM has assigned
    let hackedLayers = [...(session.hackedLayers || [])];
    if (game.user?.isGM) {
      const gmOverride = state.sessions?.['gm-override'];
      if (gmOverride?.hackedLayers) {
        for (const l of gmOverride.hackedLayers) {
          if (!hackedLayers.includes(l)) hackedLayers.push(l);
        }
      }
    }

    // Effective session flags — merge gm-override booleans for GM
    let effectiveKeyItemUsed = session.keyItemUsed;
    let effectiveLoggedIn = session.loggedIn;
    if (game.user?.isGM) {
      const gmOverride = state.sessions?.['gm-override'];
      if (gmOverride?.keyItemUsed) effectiveKeyItemUsed = true;
      if (gmOverride?.loggedIn) effectiveLoggedIn = true;
    }

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
    if (config.requiresKeyItem && !effectiveKeyItemUsed && !hackedLayers.includes('keyitem')) {
      return {
        blocked: true,
        layer: 'keyitem',
        reason: config.keyItemDisplayName || config.keyItemName || 'Access token required',
        config,
        session,
      };
    }

    // Layer 3: LOGIN
    if (config.requiresLogin && !effectiveLoggedIn && !hackedLayers.includes('login')) {
      // Check key item bypass
      if (config.requiresKeyItem && config.keyItemBypassLogin && effectiveKeyItemUsed) {
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
      if (config.requiresKeyItem && config.keyItemBypassEncryption && effectiveKeyItemUsed) {
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

  /**
   * Validate a player-selected item against key item requirements.
   * Wrong guesses count as attempts; lockout after max.
   * @param {Item} shardItem
   * @param {Actor} actor
   * @param {string} selectedItemId - the item ID the player chose from inventory
   * @returns {Promise<{ success: boolean, consumed?: boolean, locked?: boolean, attemptsRemaining?: number, bypassLogin?: boolean, bypassEncryption?: boolean, error?: string }>}
   */
  async validateKeyItem(shardItem, actor, selectedItemId, options = {}) {
    if (!actor) return { success: false, error: 'No actor provided' };

    const config = this._getConfig(shardItem);
    if (!config.requiresKeyItem) return { success: false, error: 'Shard does not require key item' };

    const state = this._getState(shardItem);
    const session = this._getActorSession(state, actor.id);
    const maxAttempts = config.maxKeyItemAttempts || 3;

    // Check if already locked out from too many wrong guesses
    if (session.keyItemAttempts >= maxAttempts) {
      return { success: false, locked: true, attemptsRemaining: 0, error: 'Too many failed attempts. Access denied.' };
    }

    // Get the selected item from actor inventory
    const selectedItem = actor.items.get(selectedItemId);
    if (!selectedItem) return { success: false, error: 'Item not found in inventory' };

    // Check if the selected item matches the key item criteria
    const isMatch = this._isKeyItemMatch(selectedItem, config);

    if (isMatch) {
      // Consume on use
      let consumed = false;
      if (config.keyItemConsumeOnUse) {
        try {
          await actor.deleteEmbeddedDocuments('Item', [selectedItem.id]);
          consumed = true;
          log.info(`Key item "${selectedItem.name}" consumed for shard "${shardItem.name}"`);
        } catch (err) {
          log.warn(`Failed to consume key item: ${err.message}`);
        }
      }

      // Grant access
      await this._updateActorSession(shardItem, actor.id, { keyItemUsed: true });

      this.eventBus?.emit(EVENTS.SHARD_KEY_ITEM_PRESENTED, {
        itemId: shardItem.id,
        actorId: actor.id,
        keyItemId: selectedItem.id,
        bypassLogin: config.keyItemBypassLogin,
        bypassEncryption: config.keyItemBypassEncryption,
      });
      if (!options.silent) this.soundService?.play('key-accepted');
      this._broadcastStateChange(shardItem.id);

      return {
        success: true,
        keyItem: selectedItem,
        consumed,
        bypassLogin: config.keyItemBypassLogin,
        bypassEncryption: config.keyItemBypassEncryption,
      };
    }

    // Wrong item — increment attempts
    const newAttempts = (session.keyItemAttempts || 0) + 1;
    const updates = { keyItemAttempts: newAttempts };
    await this._updateActorSession(shardItem, actor.id, updates);

    // Trace funnel (§6a) — wrong key item, a minor quiet log entry.
    game.nightcity?.traceService?.fireTrace({ actor, action: 'shard-keyitem', hostItem: shardItem, severity: 'minor', quiet: true });

    const attemptsRemaining = Math.max(0, maxAttempts - newAttempts);
    const locked = newAttempts >= maxAttempts;

    this.eventBus?.emit(EVENTS.SHARD_KEY_ITEM_FAILED, {
      itemId: shardItem.id,
      actorId: actor.id,
      selectedItemId,
      attemptsRemaining,
      locked,
    });
    if (!options.silent) this.soundService?.play('key-rejected');
    this._broadcastStateChange(shardItem.id);

    return {
      success: false,
      locked,
      attemptsRemaining,
      error: locked ? 'Maximum attempts exceeded. Access permanently denied.' : 'Token rejected.',
    };
  }

  /**
   * Check if a specific item matches the key item criteria.
   * @param {Item} item
   * @param {object} config
   * @returns {boolean}
   */
  _isKeyItemMatch(item, config) {
    if (config.keyItemId && item.id === config.keyItemId) return true;
    if (config.keyItemTag && item.getFlag(MODULE_ID, 'keyTag') === config.keyItemTag) return true;
    if (config.keyItemName) {
      const target = config.keyItemName.toLowerCase().trim();
      if (item.name.toLowerCase().trim() === target) return true;
    }
    return false;
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
    if (session.lockoutUntil && this._nowMs() < session.lockoutUntil) {
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

    // Trace funnel (§6a) — a fumbled credential is a minor, quiet log entry.
    game.nightcity?.traceService?.fireTrace({ actor, action: 'shard-login', hostItem: shardItem, severity: 'minor', quiet: true });

    if (newAttempts >= maxAttempts) {
      updates.lockoutUntil = this._nowMs() + (config.lockoutDuration || 3600000);
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
    if (session.lockoutUntil && this._nowMs() < session.lockoutUntil) {
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

    // ─── Resolve ICE info for UI display ───
    const isLethal = config.encryptionType === ENCRYPTION_TYPES.BLACK_ICE || config.encryptionType === ENCRYPTION_TYPES.RED_ICE;
    const iceInfo = isLethal ? this._resolveICE(config) : null;

    // ─── Handle Result ───
    // `options.silent` suppresses the service's outcome sounds so an animated
    // caller (the UI breach sequence) can own the audio at its climax instead
    // of the result spoiling ~6s early. Non-animated callers (per-message
    // decrypt, macro API) leave it off and keep the immediate sounds.
    if (rollResult.success) {
      const successResult = await this._handleHackSuccess(shardItem, actor, rollResult, isMessageHack, options.messageId, options.silent);
      successResult.iceInfo = iceInfo;
      successResult.encryptionType = config.encryptionType;
      return successResult;
    } else {
      const failResult = await this._handleHackFailure(shardItem, actor, rollResult, config, session, options.silent);
      if (!failResult.iceInfo) failResult.iceInfo = iceInfo;
      failResult.encryptionType = config.encryptionType;
      return failResult;
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

      // A chip only holds so much. `config.capacity` is stamped from the blank's
      // tier when a player encodes it (0 = no limit, which is also every shard
      // authored before tiers could be sized, so nothing existing changes).
      const limit = Math.max(0, Math.round(Number(config.capacity) || 0));
      if (limit > 0) {
        const used = this.getShardMessages(shardItem)?.length ?? 0;
        if (used >= limit) {
          log.warn(`Shard "${shardItem.name}" is full (${used}/${limit})`);
          return { success: false, error: `That chip is full — it holds ${limit} entr${limit === 1 ? 'y' : 'ies'}.`, full: true };
        }
      }

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
            corruption: 0,
            // Network visibility (per-entry)
            networkVisibility: messageData.networkVisibility ?? {
              restricted: false,
              allowedNetworks: [],
              allowedTypes: [],
            },
            // ENVELOPE (#37) — a shard holds FILES as readily as a terminal
            // does (and a burned file must keep its file envelope). Built
            // field-by-field here too, so it must be read explicitly.
            envelope: messageData.envelope === 'file' ? 'file' : 'mail',
            file: messageData.file ? { ...messageData.file } : null,
            exfil: messageData.exfil ? { ...messageData.exfil } : null,
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
      iconColor: preset.theme?.iconColor || '',
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

  /** The shard's integrity block, resolved over every default (IntegrityModel). */
  getIntegrityConfig(shardItem) {
    return resolveIntegrity(this._getConfig(shardItem).integrity);
  }

  /**
   * Get the current integrity status of a shard.
   * @param {Item} shardItem
   * @returns {{ enabled: boolean, current: number, max: number, percentage: number, tier: string, isBricked: boolean, mode: string, cfg: object }}
   */
  checkIntegrity(shardItem) {
    const cfg = this.getIntegrityConfig(shardItem);
    if (!cfg.enabled) {
      return { enabled: false, current: 100, max: 100, percentage: 100, tier: 'clean', isBricked: false, mode: cfg.mode, cfg };
    }
    const pct = percentOf(cfg);
    return {
      enabled: true,
      current: cfg.currentIntegrity,
      max: cfg.maxIntegrity,
      percentage: pct,
      tier: tierOf(pct),
      isBricked: pct <= 0,
      mode: cfg.mode,
      // The threshold is a PERCENT (it used to be compared to raw points, which
      // was only right when Max was 100).
      belowCorruptionThreshold: pct < cfg.corruptionThreshold,
      cfg,
    };
  }

  /**
   * One hit to a shard's integrity — a failed breach, or a GM's Damage button.
   * Below the data-loss threshold (mechanical mode) each entry independently
   * rolls the per-entry chance to take one more step of damage.
   *
   * GM-owned writes: the integrity number is on the item and entry damage on the
   * GM-owned journal, so a PLAYER relays (SHARD_INTEGRITY_REQUEST). Before this
   * the page write simply threw for players and was swallowed, which is why a
   * player's failed breaches never corrupted anything.
   *
   * @param {Item} shardItem
   * @param {object} [opts]
   * @param {number}  [opts.amount]    points to take before hardening (default: degradePerFailure)
   * @param {boolean} [opts.rollLoss=true] roll per-entry data loss (mechanical mode)
   * @param {string}  [opts.by]        who did it — shown on the dead screen
   * @returns {Promise<{ newIntegrity:number, damaged:string[], relayed?:boolean }>}
   */
  async degradeIntegrity(shardItem, opts = {}) {
    const cfg = this.getIntegrityConfig(shardItem);
    if (!cfg.enabled) return { newIntegrity: 100, damaged: [] };

    if (!isGM()) {
      this._relayIntegrity('degrade', shardItem, { amount: opts.amount ?? null, rollLoss: opts.rollLoss !== false, by: opts.by || '' });
      return { newIntegrity: cfg.currentIntegrity, damaged: [], relayed: true };
    }

    const hit = effectiveHit(opts.amount ?? cfg.degradePerFailure, cfg.hardening);
    const before = cfg.currentIntegrity;
    const newValue = Math.max(0, before - hit);
    const pct = cfg.maxIntegrity > 0 ? Math.round((newValue / cfg.maxIntegrity) * 100) : 0;
    const damaged = [];

    // Entry damage FIRST, then the item write — the viewer re-renders off the
    // item update, so the pages must already carry the new damage by then.
    if (cfg.mode === 'mechanical' && opts.rollLoss !== false && pct < cfg.corruptionThreshold) {
      const journal = this._getLinkedJournal(shardItem);
      const updates = [];
      for (const page of journal?.pages ?? []) {
        const f = page.flags?.[MODULE_ID];
        if (f?.type !== 'shard-message') continue;
        const level = entryLevel(f);
        if (level >= 1) continue;
        if (Math.random() >= cfg.corruptionChance) continue;
        const next = cfg.loss === 'whole' ? 1 : quantize(level + 0.25);
        updates.push({ _id: page.id, [`flags.${MODULE_ID}.corruption`]: next, [`flags.${MODULE_ID}.corrupted`]: next >= 1 });
        damaged.push(f.messageId);
        this.eventBus?.emit(EVENTS.SHARD_ENTRY_CORRUPTED, { itemId: shardItem.id, entryId: f.messageId, level: next });
      }
      if (updates.length) await journal.updateEmbeddedDocuments('JournalEntryPage', updates);
    }

    const history = [...cfg.history];
    if (!history.length) history.push(Math.round((before / cfg.maxIntegrity) * 100));
    history.push(pct);
    await shardItem.update({
      [`flags.${MODULE_ID}.config.integrity.currentIntegrity`]: newValue,
      [`flags.${MODULE_ID}.config.integrity.history`]: history.slice(-40),
      [`flags.${MODULE_ID}.config.integrity.lastHit`]: { by: opts.by || '', at: this._nowIso() },
    });

    this.eventBus?.emit(EVENTS.SHARD_INTEGRITY_CHANGED, { itemId: shardItem.id, newIntegrity: newValue });
    if (newValue <= 0 && before > 0) {
      this.eventBus?.emit(EVENTS.SHARD_INTEGRITY_BRICKED, { itemId: shardItem.id });
      this.soundService?.play('shard-brick');
    }

    log.debug(`Shard "${shardItem.name}" integrity: ${before} → ${newValue} (−${hit})${damaged.length ? ` · ${damaged.length} entr${damaged.length === 1 ? 'y' : 'ies'} damaged` : ''}`);
    return { newIntegrity: newValue, damaged };
  }

  /**
   * GM: set shard integrity to a percentage. Restoring ABOVE the data-loss
   * threshold repairs every entry (unless `uncorrupt:false`); a full restore
   * (100%) always does, and clears the hit history and salvage attempts.
   * @param {Item} shardItem
   * @param {number} percent — 0–100
   * @param {object} [opts]
   * @param {boolean} [opts.uncorrupt=true]
   * @returns {Promise<{ success: boolean, newIntegrity: number, percent: number, uncorruptedCount?: number }>}
   */
  async setIntegrity(shardItem, percent, opts = {}) {
    if (!isGM()) return { success: false, error: 'GM only' };
    const cfg = this.getIntegrityConfig(shardItem);
    if (!cfg.enabled) return { success: false, error: 'Integrity not enabled' };

    const max = cfg.maxIntegrity;
    const newValue = Math.max(0, Math.min(Math.round(max * percent / 100), max));
    const oldPct = percentOf(cfg);
    const full = percent >= 100;

    let uncorruptedCount = 0;
    const uncorrupt = opts.uncorrupt !== false && (full || (percent >= cfg.corruptionThreshold && oldPct < cfg.corruptionThreshold));
    if (uncorrupt) uncorruptedCount = await this._setAllEntryLevels(shardItem, 0);

    const upd = { [`flags.${MODULE_ID}.config.integrity.currentIntegrity`]: newValue };
    if (full) {
      upd[`flags.${MODULE_ID}.config.integrity.history`] = [];
      upd[`flags.${MODULE_ID}.config.integrity.salvaged`] = [];
    } else {
      upd[`flags.${MODULE_ID}.config.integrity.history`] = [...cfg.history, Math.round(percent)].slice(-40);
    }
    await shardItem.update(upd);
    await this._unbrick(shardItem, newValue);

    this.eventBus?.emit(EVENTS.SHARD_INTEGRITY_CHANGED, { itemId: shardItem.id, newIntegrity: newValue });
    log.info(`GM set shard "${shardItem.name}" integrity → ${newValue} (${percent}%)${uncorruptedCount ? ` · ${uncorruptedCount} entries repaired` : ''}`);
    return { success: true, newIntegrity: newValue, percent, uncorruptedCount };
  }

  /**
   * Set ONE entry's damage level (0..1, quarter steps). Reconstruct, the GM's
   * per-entry pips, and salvage all land here. Players relay.
   * @returns {Promise<{ success: boolean, level?: number, relayed?: boolean }>}
   */
  async setEntryCorruption(shardItem, entryId, level) {
    const lv = quantize(level);
    if (!isGM()) {
      this._relayIntegrity('entry', shardItem, { entryId, level: lv });
      return { success: true, level: lv, relayed: true };
    }
    const page = this._getLinkedJournal(shardItem)?.pages?.find(p => p.flags?.[MODULE_ID]?.messageId === entryId);
    if (!page) return { success: false, error: 'Entry not found' };
    await page.update({ [`flags.${MODULE_ID}.corruption`]: lv, [`flags.${MODULE_ID}.corrupted`]: lv >= 1 });
    this._broadcastStateChange(shardItem.id);
    return { success: true, level: lv };
  }

  /** GM: repair every entry on the shard (integrity untouched). */
  async repairAllEntries(shardItem) {
    if (!isGM()) return { success: false, error: 'GM only' };
    const count = await this._setAllEntryLevels(shardItem, 0);
    this._broadcastStateChange(shardItem.id);
    return { success: true, count };
  }

  /**
   * Restore integrity points (the cosmetic-mode REPAIR roll). Players relay.
   * @returns {Promise<{ success: boolean, newIntegrity?: number, relayed?: boolean }>}
   */
  async repairIntegrity(shardItem, points) {
    const cfg = this.getIntegrityConfig(shardItem);
    if (!cfg.enabled) return { success: false, error: 'Integrity not enabled' };
    if (!isGM()) {
      this._relayIntegrity('repair', shardItem, { points });
      return { success: true, relayed: true };
    }
    const newValue = Math.min(cfg.maxIntegrity, cfg.currentIntegrity + Math.max(0, Math.round(Number(points) || 0)));
    const pct = Math.round((newValue / cfg.maxIntegrity) * 100);
    await shardItem.update({
      [`flags.${MODULE_ID}.config.integrity.currentIntegrity`]: newValue,
      [`flags.${MODULE_ID}.config.integrity.history`]: [...cfg.history, pct].slice(-40),
    });
    this.eventBus?.emit(EVENTS.SHARD_INTEGRITY_CHANGED, { itemId: shardItem.id, newIntegrity: newValue });
    return { success: true, newIntegrity: newValue };
  }

  /**
   * Record that a character has used their one salvage attempt on a dead shard,
   * and — on a success — bring it back at `salvagePct`, every entry heavily
   * damaged (mechanical mode). Players relay.
   * @param {Item} shardItem
   * @param {string} actorId
   * @param {boolean} ok
   */
  async salvageShard(shardItem, actorId, ok) {
    const cfg = this.getIntegrityConfig(shardItem);
    if (!cfg.enabled) return { success: false, error: 'Integrity not enabled' };
    if (!isGM()) {
      this._relayIntegrity('salvage', shardItem, { actorId, ok: !!ok });
      return { success: true, relayed: true };
    }
    const salvaged = [...new Set([...cfg.salvaged, String(actorId || 'unknown')])];
    if (!ok) {
      await shardItem.update({ [`flags.${MODULE_ID}.config.integrity.salvaged`]: salvaged });
      return { success: true, recovered: false };
    }
    const newValue = Math.max(1, Math.round(cfg.maxIntegrity * cfg.dead.salvagePct / 100));
    if (cfg.mode === 'mechanical') {
      const journal = this._getLinkedJournal(shardItem);
      const updates = [];
      for (const page of journal?.pages ?? []) {
        const f = page.flags?.[MODULE_ID];
        if (f?.type !== 'shard-message') continue;
        const next = Math.max(entryLevel(f), 0.75);
        updates.push({ _id: page.id, [`flags.${MODULE_ID}.corruption`]: next, [`flags.${MODULE_ID}.corrupted`]: next >= 1 });
      }
      if (updates.length) await journal.updateEmbeddedDocuments('JournalEntryPage', updates);
    }
    await shardItem.update({
      [`flags.${MODULE_ID}.config.integrity.currentIntegrity`]: newValue,
      [`flags.${MODULE_ID}.config.integrity.salvaged`]: salvaged,
      [`flags.${MODULE_ID}.config.integrity.history`]: [...cfg.history, cfg.dead.salvagePct].slice(-40),
    });
    await this._unbrick(shardItem, newValue);
    this.eventBus?.emit(EVENTS.SHARD_INTEGRITY_CHANGED, { itemId: shardItem.id, newIntegrity: newValue });
    return { success: true, recovered: true, newIntegrity: newValue };
  }

  /**
   * A shard entry ready to leave the chip (an UPLOAD copies it onto a terminal):
   * the damage is baked into the copy, so carrying a corrupted file somewhere
   * else is never a free repair. Returns null for an entry that is fully lost.
   * @param {Item} shardItem
   * @param {object} entry  a getShardMessages() entry
   */
  exportEntry(shardItem, entry) {
    const cfg = this.getIntegrityConfig(shardItem);
    const level = cfg.enabled && cfg.mode === 'mechanical' ? entryLevel(entry) : 0;
    if (!level) return entry;
    const copy = foundry.utils.deepClone(entry);
    const dmg = applyLoss(copy, level, cfg);
    if (dmg.gone) return null;
    delete copy.corruption;
    copy.corrupted = false;
    return copy;
  }

  /**
   * The penalty a damaged PROGRAM entry runs with (`{dvPenalty, misfire}`), or
   * null when it runs clean. Read by every place a shard's program is run.
   */
  programInstability(shardItem, entry) {
    const cfg = this.getIntegrityConfig(shardItem);
    if (!cfg.enabled || cfg.mode !== 'mechanical') return null;
    return unstableFor(entryLevel(entry), cfg);
  }

  /** GM-side handler for SHARD_INTEGRITY_REQUEST. */
  async handleIntegrityRequest(data = {}) {
    if (!isGM()) return;
    const item = data.itemUuid ? fromUuidSync(data.itemUuid) : null;
    if (!item || !this.isDataShard(item)) { log.warn(`Integrity relay: shard ${data.itemUuid} not found`); return; }
    switch (data.op) {
      case 'degrade': return this.degradeIntegrity(item, { amount: data.amount ?? undefined, rollLoss: data.rollLoss !== false, by: data.by || '' });
      case 'entry':   return this.setEntryCorruption(item, data.entryId, data.level);
      case 'repair':  return this.repairIntegrity(item, data.points);
      case 'salvage': return this.salvageShard(item, data.actorId, !!data.ok);
      default: log.warn(`Integrity relay: unknown op "${data.op}"`);
    }
  }

  /** @private Player → GM relay. Warns when there is no GM to land the write. */
  _relayIntegrity(op, shardItem, payload = {}) {
    if (!game.users?.activeGM) {
      ui.notifications?.warn('NCM | No GM connected — the shard change could not be saved.');
      return false;
    }
    this.socketManager?.emit(SOCKET_OPS.SHARD_INTEGRITY_REQUEST, { op, itemUuid: shardItem.uuid, userId: game.user?.id, ...payload });
    return true;
  }

  /** @private Set every entry's damage level; returns how many changed. */
  async _setAllEntryLevels(shardItem, level) {
    const journal = this._getLinkedJournal(shardItem);
    if (!journal) return 0;
    const lv = quantize(level);
    const updates = [];
    for (const page of journal.pages) {
      const f = page.flags?.[MODULE_ID];
      if (f?.type !== 'shard-message') continue;
      if (entryLevel(f) === lv && !!f.corrupted === (lv >= 1)) continue;
      updates.push({ _id: page.id, [`flags.${MODULE_ID}.corruption`]: lv, [`flags.${MODULE_ID}.corrupted`]: lv >= 1 });
    }
    if (updates.length) await journal.updateEmbeddedDocuments('JournalEntryPage', updates);
    return updates.length;
  }

  /** @private A shard brought back above 0 is no longer destroyed. */
  async _unbrick(shardItem, newValue) {
    if (newValue <= 0) return;
    const state = this._getState(shardItem);
    if (state.destroyed) {
      await shardItem.unsetFlag(MODULE_ID, 'state');
      await shardItem.setFlag(MODULE_ID, 'state', { ...state, destroyed: false });
    }
  }

  /** @private ISO "now" through the time provider. */
  _nowIso() {
    try { return new Date(this._nowMs()).toISOString(); } catch { return new Date().toISOString(); }
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
      // Wire to CPR wealth ledger — wealth is an object { value, transactions }
      const wealth = foundry.utils.deepClone(actor.system.wealth);
      wealth.value += amount;
      const transaction = `Increased by ${amount} to ${wealth.value}`;
      const reason = `NCM: Claimed ${amount.toLocaleString()} eb from data shard`;
      wealth.transactions.push([transaction, reason]);
      await actor.update({ 'system.wealth': wealth });

      // Mark as claimed on the journal page. The shard journal is GM-owned
      // (players are OBSERVER), so a direct page.update from a player throws —
      // and the nested contentData.* dot-path write is the unreliable-flag
      // gotcha anyway. persistContentData writes the whole contentData (GM
      // direct, player via the CONTENT_UPDATE_REQUEST relay).
      const { persistContentData } = await import('../ui/content/SiphonFlow.js');
      await persistContentData(entryId, {
        // claimedRealMs = real time, drives the one-shot claim animation (the
        // enricher's justClaimed window compares against Date.now()).
        ...contentData, claimed: true, claimedBy: actor.id, claimedAt: new Date().toISOString(), claimedRealMs: Date.now(),
      }, `NCM | ${actor.name} claimed ${amount.toLocaleString()} eb (${shardItem.name}).`);

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
  async _handleHackSuccess(shardItem, actor, rollResult, isMessageHack, messageId, silent = false) {
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
    if (!silent) this.soundService?.play('hack-success');
    this._broadcastStateChange(shardItem.id);

    // Activity feed — a successful shard breach (no heat).
    game.nightcity?.traceService?.logSuccess({
      actor, action: 'shard-hack', hostItem: shardItem, severity: 'hostile',
      dv: rollResult?.dc ?? null,
      margin: (rollResult?.total != null && rollResult?.dc != null) ? rollResult.total - rollResult.dc : null,
    });

    return {
      success: true,
      roll: rollResult,
      failureEffect: null,
    };
  }

  /** @private */
  async _handleHackFailure(shardItem, actor, rollResult, config, session, silent = false) {
    const newAttempts = (session.hackAttempts || 0) + 1;
    const updates = { hackAttempts: newAttempts };

    // Trace funnel (§6a) — a failed shard breach. `quiet: silent` respects the
    // animated-UI-owns-the-climax contract; the log + heat always record.
    game.nightcity?.traceService?.fireTrace({
      actor, action: 'shard-hack', hostItem: shardItem, severity: 'hostile', quiet: silent,
      dv: rollResult?.dc ?? null,
      margin: (rollResult?.total != null && rollResult?.dc != null) ? rollResult.total - rollResult.dc : null,
    });

    // Degrade integrity if enabled (fire-and-forget, non-blocking)
    if (config.integrity?.enabled) {
      this.degradeIntegrity(shardItem, { by: actor?.name || '' }).catch(err => log.warn(`Integrity degrade failed: ${err.message}`));
    }

    const result = {
      success: false,
      roll: rollResult,
      failureEffect: config.failureMode,
      damage: 0,
      damageFormula: null,
      diceResults: [],
      iceInfo: null,
      locked: false,
      destroyed: false,
    };

    // Resolve ICE info upfront (for UI display even when no damage)
    const isLethal = config.encryptionType === ENCRYPTION_TYPES.BLACK_ICE || config.encryptionType === ENCRYPTION_TYPES.RED_ICE;
    if (isLethal) {
      result.iceInfo = this._resolveICE(config);
    }

    // Record failed attempt in SecurityService
    const secResult = this.securityService?.recordFailedAttempt(actor.id, shardItem.id);

    switch (config.failureMode) {
      case FAILURE_MODES.LOCKOUT:
        if (newAttempts >= config.maxHackAttempts) {
          updates.lockoutUntil = this._nowMs() + (config.lockoutDuration || 3600000);
          result.locked = true;
          if (!silent) this.soundService?.play('lockout');
        }
        break;

      case FAILURE_MODES.PERMANENT:
        if (newAttempts >= config.maxHackAttempts) {
          updates.lockoutUntil = Number.MAX_SAFE_INTEGER; // Permanent lockout (survives JSON)
          result.locked = true;
          if (!silent) this.soundService?.play('lockout');
        }
        break;

      case FAILURE_MODES.DAMAGE:
        // BLACK ICE damage — resolve source and apply
        if (isLethal) {
          this._currentShardName = shardItem.name;
          this._currentShardId = shardItem.id;
          const damageResult = await this._applyBlackICEDamage(actor, config, silent);
          result.damage = damageResult.damage;
          result.damageFormula = damageResult.formula;
          result.diceResults = damageResult.diceResults ?? [];
          result.iceInfo = damageResult.iceInfo ?? result.iceInfo;
        }
        // Also lockout after max attempts
        if (newAttempts >= config.maxHackAttempts) {
          updates.lockoutUntil = this._nowMs() + (config.lockoutDuration || 3600000);
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
    if (!silent) this.soundService?.play('hack-fail');

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
    const nowMs = this._nowMs();
    const isLockedOut = lockoutUntil > nowMs;
    const lockoutRemaining = isLockedOut ? Math.ceil((lockoutUntil - nowMs) / 1000) : 0;
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

    // Trace funnel (§6a) — a failed hack of a security layer.
    game.nightcity?.traceService?.fireTrace({
      actor: game.actors?.get(actorId), action: 'shard-layer', hostItem: item,
      objectName: `${item?.name || 'shard'} · ${layer}`, severity: 'hostile', quiet: true,
    });

    const result = { locked: false, destroyed: false, damage: 0 };

    // Degrade integrity on any failed layer hack if enabled
    if (config.integrity?.enabled && layerSec.degradeOnFail) {
      this.degradeIntegrity(item, { by: game.actors?.get(actorId)?.name || '' }).catch(err => log.warn(`Integrity degrade failed: ${err.message}`));
    }

    if (newCount >= max) {
      switch (failureMode) {
        case FAILURE_MODES.LOCKOUT:
          updates.layerLockoutUntil = this._nowMs() + lockoutDuration;
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
            this._currentShardName = item.name;
            this._currentShardId = item.id;
            const damageResult = await this._applyBlackICEDamage(actor, config);
            result.damage = damageResult.damage;
          }
          if (newCount >= max) {
            updates.layerLockoutUntil = this._nowMs() + lockoutDuration;
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
   * Delegates to shared ICEService.
   * @param {Actor} actor
   * @param {object} config — Shard config with encryptionType + ice
   * @returns {Promise<{damage: number, iceInfo: object}>}
   * @private
   */
  async _applyBlackICEDamage(actor, config, silent = false) {
    const iceService = this.iceService;
    if (!iceService) {
      log.warn('ICEService not available, falling back to basic damage');
      return { damage: 0, iceInfo: this._resolveICE(config) };
    }

    const result = await iceService.applyDamage(actor, config, {
      context: 'shard',
      targetName: this._currentShardName || 'Data Shard',
      silent,
    });

    // Also emit the shard-specific event for ItemInboxApp animation
    this.eventBus?.emit(EVENTS.SHARD_BLACK_ICE, {
      itemId: this._currentShardId,
      actorId: actor.id,
      damage: result.damage,
      iceInfo: result.iceInfo,
    });

    return {
      damage: result.damage,
      formula: result.formula,
      diceResults: result.diceResults ?? [],
      iceInfo: result.iceInfo,
    };
  }

  /**
   * Resolve ICE configuration to concrete combat info.
   * Delegates to shared ICEService, with local fallback.
   * @param {object} config
   * @returns {object} ICE info
   */
  _resolveICE(config) {
    return this.iceService?.resolveICE(config) ?? this._resolveICEFallback(config);
  }

  /** @private Fallback if ICEService not yet loaded */
  _resolveICEFallback(config) {
    const encType = config.encryptionType || 'ICE';
    const iceConfig = config.ice ?? {};
    const source = iceConfig.source ?? 'default';

    // ─── Actor source: pull stats from linked Black ICE actor ───
    if (source === 'actor' && iceConfig.actorId) {
      const iceActor = game.actors?.get(iceConfig.actorId);
      if (iceActor) {
        const atk = iceActor.system?.stats?.atk ?? 0;
        return {
          name: iceActor.name || 'BLACK ICE',
          img: iceActor.img || null,
          formula: `${atk} + 1d10`,
          atk,
          class: iceActor.system?.class || null,
          actorId: iceActor.id,
          encryptionType: encType,
        };
      }
      log.warn(`ICE actor "${iceConfig.actorId}" not found, falling back to default`);
    }

    // ─── Custom source: GM-defined name + formula ───
    if (source === 'custom' && iceConfig.customDamage) {
      return {
        name: iceConfig.customName || (encType === ENCRYPTION_TYPES.RED_ICE ? 'RED ICE' : 'BLACK ICE'),
        img: iceConfig.customPortrait || null,
        formula: iceConfig.customDamage,
        atk: null,
        class: null,
        actorId: null,
        encryptionType: encType,
      };
    }

    // ─── Default source: generic dice by type ───
    const isRed = encType === ENCRYPTION_TYPES.RED_ICE;
    return {
      name: isRed ? 'RED ICE' : 'BLACK ICE',
      img: null,
      formula: isRed ? '5d6' : '3d6',
      atk: null,
      class: null,
      actorId: null,
      encryptionType: encType,
    };
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

      this.soundService?.play('shard-expire');
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
  /**
   * Item folders for the archive, created level by level. Items CAN be foldered
   * (unlike an actor's embedded items, which is the whole reason this exists).
   * @param {string[]} path
   * @returns {Promise<Folder|null>}
   */
  async _getOrCreateItemFolder(path = []) {
    const names = path.filter(Boolean).map(String);
    let parent = null;
    for (const name of names) {
      let next = game.folders.find(f =>
        f.type === 'Item' && f.name === name && (f.folder?.id ?? null) === (parent?.id ?? null)
      ) ?? null;
      if (!next) {
        if (!isGM()) return parent;
        next = await Folder.create({ name, type: 'Item', folder: parent?.id ?? null, sorting: 'a' });
      }
      if (!next) return parent;
      parent = next;
    }
    return parent;
  }

  /**
   * What a GM would archive, without doing it. A read-only census so the dialog
   * can say exactly what will happen before anything is written.
   * @param {object} [o]
   * @param {boolean} [o.playerMadeOnly] only shards a player forged
   * @returns {{ pending: object[], already: number, orphans: Item[] }}
   */
  surveyShardArchive({ playerMadeOnly = true } = {}) {
    const archives = (game.items?.contents ?? []).filter(i => i.getFlag(MODULE_ID, 'shardArchive'));
    const archivedIds = new Set(archives.map(i => i.getFlag(MODULE_ID, 'shardArchive')?.sourceId).filter(Boolean));

    const pending = [];
    for (const actor of (game.actors?.contents ?? [])) {
      for (const item of (actor.items ?? [])) {
        if (!item.getFlag(MODULE_ID, 'isDataShard')) continue;
        if (item.getFlag(MODULE_ID, 'shardArchive')) continue;            // never archive an archive
        const cfg = item.getFlag(MODULE_ID, 'shardConfig') || item.getFlag(MODULE_ID, 'config') || {};
        if (playerMadeOnly && !cfg.playerMade?.actorName) continue;
        if (archivedIds.has(item.id)) continue;
        pending.push({ item, actor, maker: cfg.playerMade?.actorName || actor.name, name: cfg.shardName || item.name });
      }
    }

    // An archive whose source is gone is a window onto nothing.
    const orphans = archives.filter((a) => {
      const src = a.getFlag(MODULE_ID, 'shardArchive') || {};
      const owner = game.actors?.get(src.sourceActorId);
      return !owner?.items?.get(src.sourceId);
    });

    return { pending, already: archives.length - orphans.length, orphans };
  }

  /**
   * Copy actor-held shards into the WORLD item directory, in folders, so a GM can
   * see and open them like any other item.
   *
   * These are REFERENCE copies, and deliberately so: an item embedded in an actor
   * cannot live in a folder, and moving it would take the player's shard away.
   * The copy carries the SAME `journalId`, so it is a live window on the real
   * contents rather than a snapshot that drifts — and `removeDataShard` refuses
   * to delete that shared journal for an archive.
   * @param {object} [o]
   * @param {boolean} [o.playerMadeOnly]
   * @returns {Promise<{created:number, folders:number, orphansRemoved:number, error?:string}>}
   */
  async archiveShardsToItems({ playerMadeOnly = true, pruneOrphans = false } = {}) {
    if (!isGM()) return { created: 0, folders: 0, orphansRemoved: 0, error: 'GM only' };
    const survey = this.surveyShardArchive({ playerMadeOnly });
    const root = 'Player-Made Shards';
    let created = 0;
    const folderNames = new Set();

    try {
      // Group by maker so one folder is made per character, not per shard.
      const byMaker = new Map();
      for (const row of survey.pending) {
        if (!byMaker.has(row.maker)) byMaker.set(row.maker, []);
        byMaker.get(row.maker).push(row);
      }

      for (const [maker, rows] of byMaker) {
        const folder = await this._getOrCreateItemFolder([root, maker]);
        if (folder) folderNames.add(folder.id);
        const payloads = rows.map(({ item, actor }) => {
          const data = item.toObject();
          delete data._id;
          data.folder = folder?.id ?? null;
          data.flags = data.flags || {};
          data.flags[MODULE_ID] = {
            ...(data.flags[MODULE_ID] || {}),
            shardArchive: {
              sourceId: item.id,
              sourceActorId: actor.id,
              sourceActorName: actor.name,
              at: new Date().toISOString(),
            },
          };
          return data;
        });
        if (payloads.length) {
          const made = await Item.createDocuments(payloads);
          created += made?.length ?? 0;
        }
      }

      let orphansRemoved = 0;
      if (pruneOrphans && survey.orphans.length) {
        await Item.deleteDocuments(survey.orphans.map(i => i.id));
        orphansRemoved = survey.orphans.length;
      }

      log.info(`Shard archive: ${created} copied, ${orphansRemoved} orphan(s) removed`);
      return { created, folders: folderNames.size, orphansRemoved };
    } catch (err) {
      log.error(`Shard archive failed: ${err.message}`);
      return { created, folders: folderNames.size, orphansRemoved: 0, error: err.message };
    }
  }

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
      // Integrity damage, 0..1 (IntegrityModel.entryLevel reads legacy `corrupted` as 1).
      corruption: typeof flags.corruption === 'number' ? flags.corruption : (flags.corrupted ? 1 : 0),
      contentData: flags.contentData ?? {},
      networkVisibility: flags.networkVisibility ?? { restricted: false, allowedNetworks: [], allowedTypes: [] },
      // ENVELOPE (#37) — 'mail' default keeps every legacy shard entry identical.
      envelope: flags.envelope === 'file' ? 'file' : 'mail',
      file: flags.file || null,
      exfil: flags.exfil || null,
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
    // Legacy flat-field support: if no network object, fall back to the old
    // requiresNetwork/requiredNetwork pair. (Shard-specific back-compat — kept
    // here, not in the shared NetworkService.checkAccess contract.)
    if (!config.network?.required && config.requiresNetwork) {
      const onNetwork = this.networkService?.isOnNetwork(config.requiredNetwork) ?? false;
      return onNetwork
        ? { allowed: true }
        : { allowed: false, reason: `Requires network: ${config.requiredNetwork}`, requiredNetwork: config.requiredNetwork };
    }

    // Shared contract — one source of truth for network access (shards + terminals).
    if (!this.networkService) return { allowed: false, reason: 'No network connection' };
    return this.networkService.checkAccess(config.network ?? {});
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
