/**
 * Message Access Service
 * @file scripts/services/MessageAccessService.js
 * @module cyberpunkred-messenger
 * @description Manages network-restricted message access: checking whether an actor
 *   can read a message, processing bypass attempts (password, skill check, key item),
 *   and tracking per-actor access sessions.
 *
 *   Follows the data shard security pattern (DataShardService.checkFullSecurityStack)
 *   but simplified to a single gate (network requirement) with 3 bypass paths.
 *
 *   Access sessions are stored on the inbox journal under:
 *     journal.flags[MODULE_ID].messageAccessSessions = { [messageId]: { ... } }
 *
 *   Depends on: NetworkService, SecurityService, SkillService, MessageRepository,
 *               EventBus, SoundService
 *   Initialization priority: ready/85
 */

import { MODULE_ID, EVENTS } from '../utils/constants.js';
import { log } from '../utils/helpers.js';

/** Default max bypass attempts before lockout */
const DEFAULT_MAX_ATTEMPTS = 3;

/** Default lockout duration in ms (1 hour) */
const DEFAULT_LOCKOUT_DURATION = 3600000;

export class MessageAccessService {
  constructor() {
    /** @type {Map<string, object>} In-memory cache of access sessions keyed by "actorId::messageId" */
    this._sessionCache = new Map();
  }

  // ─── Lazy Service Accessors (via namespace — never constructor-injected) ──

  get networkService() { return game.nightcity?.networkService; }
  get securityService() { return game.nightcity?.securityService; }
  get skillService() { return game.nightcity?.skillService; }
  get messageRepo() { return game.nightcity?.messageRepository; }
  get eventBus() { return game.nightcity?.eventBus; }
  get soundService() { return game.nightcity?.soundService; }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API — Access Checks
  // ═══════════════════════════════════════════════════════════

  /**
   * Check if an actor can read a specific message.
   * Returns the full access state — whether blocked, and available bypass methods.
   *
   * This is the primary method called by the inbox viewer when rendering messages.
   *
   * @param {object} message - The message object (from MessageRepository._pageToMessage)
   * @param {Actor} actor - The actor attempting to read
   * @returns {{
   *   canRead: boolean,
   *   restricted: boolean,
   *   requiredNetwork: string|null,
   *   requiredNetworkName: string,
   *   onCorrectNetwork: boolean,
   *   bypassed: boolean,
   *   bypassMethod: string|null,
   *   bypassOptions: { password: boolean, skillCheck: boolean, keyItem: boolean },
   *   bypassSkills: string[],
   *   bypassDC: number,
   *   keyItemName: string|null,
   *   lockedOut: boolean,
   *   lockoutUntil: string|null,
   *   hackAttempts: number,
   *   maxAttempts: number,
   *   gmOverride: boolean,
   * }}
   */
  checkAccess(message, actor) {
    const ac = message?.accessControl;

    // No restrictions — message is open
    if (!ac?.restricted) {
      return { canRead: true, restricted: false };
    }

    // GM always has access
    if (game.user?.isGM) {
      return {
        canRead: true,
        restricted: true,
        gmOverride: true,
        requiredNetwork: ac.requiredNetwork,
        requiredNetworkName: ac.requiredNetworkName || ac.requiredNetwork,
      };
    }

    // Check if on the correct network right now
    const onCorrectNetwork = this.networkService?.satisfiesMessageAccess(ac) ?? false;
    if (onCorrectNetwork) {
      return {
        canRead: true,
        restricted: true,
        onCorrectNetwork: true,
        requiredNetwork: ac.requiredNetwork,
        requiredNetworkName: ac.requiredNetworkName || ac.requiredNetwork,
      };
    }

    // Check if previously bypassed
    const session = this._getSession(actor?.id, message.messageId);
    if (session?.bypassed) {
      return {
        canRead: true,
        restricted: true,
        bypassed: true,
        bypassMethod: session.bypassMethod,
        requiredNetwork: ac.requiredNetwork,
        requiredNetworkName: ac.requiredNetworkName || ac.requiredNetwork,
      };
    }

    // Check lockout
    if (session?.lockoutUntil) {
      const now = Date.now();
      const lockoutEnd = new Date(session.lockoutUntil).getTime();
      if (now < lockoutEnd) {
        return {
          canRead: false,
          restricted: true,
          onCorrectNetwork: false,
          lockedOut: true,
          lockoutUntil: session.lockoutUntil,
          requiredNetwork: ac.requiredNetwork,
          requiredNetworkName: ac.requiredNetworkName || ac.requiredNetwork,
          hackAttempts: session.hackAttempts ?? 0,
          maxAttempts: DEFAULT_MAX_ATTEMPTS,
          bypassOptions: { password: false, skillCheck: false, keyItem: false },
        };
      }
      // Lockout expired — clear it silently (will be persisted on next attempt)
    }

    // Blocked — return available bypass options
    return {
      canRead: false,
      restricted: true,
      onCorrectNetwork: false,
      bypassed: false,
      lockedOut: false,
      requiredNetwork: ac.requiredNetwork,
      requiredNetworkName: ac.requiredNetworkName || ac.requiredNetwork,
      bypassOptions: {
        password: !!(ac.bypassable && ac.bypass?.allowPassword),
        skillCheck: !!(ac.bypassable && ac.bypass?.allowSkillCheck),
        keyItem: !!(ac.bypassable && ac.bypass?.allowKeyItem),
      },
      bypassSkills: ac.bypass?.bypassSkills ?? [],
      bypassDC: ac.bypass?.bypassDC ?? 15,
      keyItemName: ac.bypass?.keyItemName ?? null,
      hackAttempts: session?.hackAttempts ?? 0,
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API — Bypass Attempts
  // ═══════════════════════════════════════════════════════════

  /**
   * Attempt password bypass for a restricted message.
   *
   * @param {string} messageId
   * @param {string} actorId
   * @param {string} password - The password entered by the player
   * @param {object} accessControl - The message's accessControl block
   * @returns {Promise<{ success: boolean, error?: string, attemptsRemaining?: number, lockedOut?: boolean, lockoutUntil?: string }>}
   */
  async attemptPasswordBypass(messageId, actorId, password, accessControl) {
    if (!accessControl?.bypass?.allowPassword) {
      return { success: false, error: 'Password bypass not available for this message' };
    }

    const correct = password === accessControl.bypass.password;

    if (correct) {
      await this._recordBypass(actorId, messageId, 'password');
      this.soundService?.play('login-success');
      this.eventBus?.emit(EVENTS.MESSAGE_ACCESS_GRANTED, {
        messageId, actorId, method: 'password',
      });
      log.info(`Message ${messageId}: password bypass successful for actor ${actorId}`);
      return { success: true };
    }

    // Failed attempt
    return this._handleFailedAttempt(actorId, messageId, 'password');
  }

  /**
   * Attempt skill check bypass for a restricted message.
   * Routes through SkillService for full CPR skill check (stat + skill + d10).
   *
   * @param {string} messageId
   * @param {Actor} actor - The actor performing the check
   * @param {string} skillName - The skill to use (e.g., 'Interface')
   * @param {object} accessControl - The message's accessControl block
   * @returns {Promise<{ success: boolean, roll?: object, error?: string, attemptsRemaining?: number, lockedOut?: boolean }>}
   */
  async attemptSkillBypass(messageId, actor, skillName, accessControl) {
    if (!accessControl?.bypass?.allowSkillCheck) {
      return { success: false, error: 'Skill bypass not available for this message' };
    }

    // Validate skill is in the allowed list
    const allowedSkills = accessControl.bypass.bypassSkills ?? [];
    if (allowedSkills.length > 0 && !allowedSkills.includes(skillName)) {
      return { success: false, error: `${skillName} cannot be used to bypass this restriction` };
    }

    const dc = accessControl.bypass.bypassDC ?? 15;

    // Route through SkillService — same path as data shard hacking
    const skillSvc = this.skillService;
    if (!skillSvc) {
      return { success: false, error: 'Skill system not available' };
    }

    const result = await skillSvc.performCheck(actor, skillName, dc);

    if (result?.success) {
      await this._recordBypass(actor.id, messageId, 'skill');
      this.soundService?.play('hack-success');
      this.eventBus?.emit(EVENTS.MESSAGE_ACCESS_GRANTED, {
        messageId, actorId: actor.id, method: 'skill', skill: skillName, roll: result,
      });
      log.info(`Message ${messageId}: skill bypass (${skillName}) successful for actor ${actor.id}`);
      return { success: true, roll: result };
    }

    // Failed skill check
    const failResult = await this._handleFailedAttempt(actor.id, messageId, 'skill');
    this.soundService?.play('hack-fail');
    return { ...failResult, roll: result };
  }

  /**
   * Attempt key item bypass for a restricted message.
   * Checks actor inventory by ID → Tag → Name (same priority as DataShardService).
   *
   * @param {string} messageId
   * @param {Actor} actor - The actor presenting the key item
   * @param {object} accessControl - The message's accessControl block
   * @returns {Promise<{ success: boolean, keyItem?: Item, consumed?: boolean, error?: string }>}
   */
  async attemptKeyItemBypass(messageId, actor, accessControl) {
    if (!accessControl?.bypass?.allowKeyItem) {
      return { success: false, error: 'Key item bypass not available for this message' };
    }

    const bp = accessControl.bypass;
    const keyItem = this._findKeyItem(actor, bp);

    if (!keyItem) {
      this.soundService?.play('key-rejected');
      log.info(`Message ${messageId}: key item not found in inventory for actor ${actor.id}`);
      return { success: false, error: 'Required access item not found in inventory' };
    }

    // Key item found — grant access
    let consumed = false;
    if (bp.keyItemConsume) {
      try {
        await actor.deleteEmbeddedDocuments('Item', [keyItem.id]);
        consumed = true;
        log.info(`Key item "${keyItem.name}" consumed for message access`);
      } catch (err) {
        log.error(`Failed to consume key item: ${err.message}`);
      }
    }

    await this._recordBypass(actor.id, messageId, 'keyitem');
    this.soundService?.play('key-accepted');
    this.eventBus?.emit(EVENTS.MESSAGE_ACCESS_GRANTED, {
      messageId, actorId: actor.id, method: 'keyitem',
      keyItemName: keyItem.name, consumed,
    });

    log.info(`Message ${messageId}: key item bypass ("${keyItem.name}") successful for actor ${actor.id}`);
    return { success: true, keyItem, consumed };
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API — GM Operations
  // ═══════════════════════════════════════════════════════════

  /**
   * GM force-reveal: grant access to a message for an actor.
   * Bypasses all restrictions immediately.
   *
   * @param {string} messageId
   * @param {string} actorId
   */
  async gmForceReveal(messageId, actorId) {
    if (!game.user?.isGM) return;

    await this._recordBypass(actorId, messageId, 'gm_override');
    this.eventBus?.emit(EVENTS.MESSAGE_ACCESS_GRANTED, {
      messageId, actorId, method: 'gm_override',
    });

    log.info(`GM force-revealed message ${messageId} for actor ${actorId}`);
  }

  /**
   * GM re-restrict: revoke a bypass, re-lock the message for an actor.
   * Resets all session state — the actor must bypass again.
   *
   * @param {string} messageId
   * @param {string} actorId
   */
  async gmReRestrict(messageId, actorId) {
    if (!game.user?.isGM) return;

    await this._updateSession(actorId, messageId, {
      bypassed: false,
      bypassMethod: null,
      bypassedAt: null,
      hackAttempts: 0,
      lockoutUntil: null,
    });

    this.eventBus?.emit(EVENTS.MESSAGE_ACCESS_REVOKED, { messageId, actorId });
    log.info(`GM re-restricted message ${messageId} for actor ${actorId}`);
  }

  /**
   * GM clear lockout for an actor on a specific message.
   * Resets attempt counter and removes lockout timer without granting access.
   *
   * @param {string} messageId
   * @param {string} actorId
   */
  async gmClearLockout(messageId, actorId) {
    if (!game.user?.isGM) return;

    await this._updateSession(actorId, messageId, {
      lockoutUntil: null,
      hackAttempts: 0,
    });

    log.info(`GM cleared lockout on message ${messageId} for actor ${actorId}`);
  }

  /**
   * GM modify a message's access control after send.
   * Allows adding/removing bypass options, changing required network, etc.
   *
   * @param {string} actorId - Inbox owner (whose inbox the message is in)
   * @param {string} messageId
   * @param {object} updates - Partial accessControl updates to merge
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  async gmUpdateAccessControl(actorId, messageId, updates) {
    if (!game.user?.isGM) {
      return { success: false, error: 'GM only' };
    }

    try {
      const result = await this.messageRepo?.updateMessageFlags(actorId, messageId, {
        accessControl: updates,
      });

      if (result?.success) {
        log.info(`GM updated access control on message ${messageId} in inbox ${actorId}`);
        this.eventBus?.emit(EVENTS.INBOX_REFRESH, { actorId });
      }

      return result || { success: false, error: 'MessageRepository not available' };
    } catch (err) {
      log.error(`Failed to update message access control: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API — Utility
  // ═══════════════════════════════════════════════════════════

  /**
   * Clear the in-memory session cache.
   * Called on world reload or when the inbox journal changes.
   */
  clearCache() {
    this._sessionCache.clear();
  }

  /**
   * Check if a message has any access restrictions at all.
   * Quick check that avoids full checkAccess() overhead.
   *
   * @param {object} message
   * @returns {boolean}
   */
  isRestricted(message) {
    return !!(message?.accessControl?.restricted);
  }

  // ═══════════════════════════════════════════════════════════
  //  INTERNAL — Failed Attempt Handling
  // ═══════════════════════════════════════════════════════════

  /**
   * Process a failed bypass attempt (password or skill).
   * Increments attempt counter, triggers lockout if max reached.
   *
   * @param {string} actorId
   * @param {string} messageId
   * @param {string} method - 'password' or 'skill'
   * @returns {Promise<{ success: false, error: string, attemptsRemaining?: number, lockedOut?: boolean, lockoutUntil?: string }>}
   * @private
   */
  async _handleFailedAttempt(actorId, messageId, method) {
    const session = this._getSession(actorId, messageId);
    const attempts = (session?.hackAttempts ?? 0) + 1;

    if (attempts >= DEFAULT_MAX_ATTEMPTS) {
      // Lockout
      const lockoutUntil = new Date(Date.now() + DEFAULT_LOCKOUT_DURATION).toISOString();
      await this._updateSession(actorId, messageId, {
        hackAttempts: attempts,
        lockoutUntil,
      });

      this.soundService?.play('lockout');
      this.eventBus?.emit(EVENTS.MESSAGE_ACCESS_DENIED, {
        messageId, actorId, method, lockedOut: true,
      });

      log.info(`Message ${messageId}: ${method} bypass failed — actor ${actorId} locked out until ${lockoutUntil}`);
      return {
        success: false,
        error: 'Too many failed attempts — access locked',
        lockedOut: true,
        lockoutUntil,
      };
    }

    // Not yet locked out
    await this._updateSession(actorId, messageId, { hackAttempts: attempts });
    this.soundService?.play('login-fail');

    const remaining = DEFAULT_MAX_ATTEMPTS - attempts;
    log.info(`Message ${messageId}: ${method} bypass failed — ${remaining} attempts remaining for actor ${actorId}`);

    return {
      success: false,
      error: method === 'password' ? 'Incorrect password' : 'Check failed',
      attemptsRemaining: remaining,
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  INTERNAL — Key Item Search
  // ═══════════════════════════════════════════════════════════

  /**
   * Search actor inventory for a matching key item.
   * Same priority order as DataShardService._findKeyItem:
   *   1. By Item ID (exact match)
   *   2. By Tag (flag-based)
   *   3. By Name (case-insensitive, trimmed)
   *
   * @param {Actor} actor
   * @param {object} bypass - The bypass config from accessControl
   * @returns {Item|null}
   * @private
   */
  _findKeyItem(actor, bypass) {
    if (!actor?.items) return null;

    // Strategy 1: By Item ID
    if (bypass.keyItemId) {
      const item = actor.items.get(bypass.keyItemId);
      if (item) return item;
    }

    // Strategy 2: By Tag
    if (bypass.keyItemTag) {
      const item = actor.items.find(i =>
        i.getFlag(MODULE_ID, 'keyTag') === bypass.keyItemTag
      );
      if (item) return item;
    }

    // Strategy 3: By Name (case-insensitive)
    if (bypass.keyItemName) {
      const target = bypass.keyItemName.toLowerCase().trim();
      const item = actor.items.find(i =>
        i.name.toLowerCase().trim() === target
      );
      if (item) return item;
    }

    return null;
  }

  // ═══════════════════════════════════════════════════════════
  //  INTERNAL — Session Management
  // ═══════════════════════════════════════════════════════════

  /**
   * Get access session for an actor + message combo.
   * Checks in-memory cache first, then falls back to journal flags.
   *
   * @param {string} actorId
   * @param {string} messageId
   * @returns {object|null}
   * @private
   */
  _getSession(actorId, messageId) {
    if (!actorId || !messageId) return null;

    const cacheKey = `${actorId}::${messageId}`;
    if (this._sessionCache.has(cacheKey)) {
      return this._sessionCache.get(cacheKey);
    }

    // Load from journal flags
    const inbox = this._getInboxJournal(actorId);
    if (!inbox) return null;

    const sessions = inbox.getFlag(MODULE_ID, 'messageAccessSessions') ?? {};
    const session = sessions[messageId] ?? null;

    if (session) {
      this._sessionCache.set(cacheKey, session);
    }

    return session;
  }

  /**
   * Record a successful bypass.
   *
   * @param {string} actorId
   * @param {string} messageId
   * @param {string} method - 'password' | 'skill' | 'keyitem' | 'gm_override'
   * @private
   */
  async _recordBypass(actorId, messageId, method) {
    await this._updateSession(actorId, messageId, {
      bypassed: true,
      bypassMethod: method,
      bypassedAt: new Date().toISOString(),
      hackAttempts: 0,
      lockoutUntil: null,
    });
  }

  /**
   * Update a session entry (merge with existing).
   * Single atomic flag write on the inbox journal.
   *
   * @param {string} actorId
   * @param {string} messageId
   * @param {object} updates - Partial session updates to merge
   * @private
   */
  async _updateSession(actorId, messageId, updates) {
    if (!actorId || !messageId) return;

    const inbox = this._getInboxJournal(actorId);
    if (!inbox) {
      log.warn(`Cannot update message access session — inbox journal not found for actor ${actorId}`);
      return;
    }

    // Deep clone existing sessions to avoid mutation
    const sessions = foundry.utils.deepClone(
      inbox.getFlag(MODULE_ID, 'messageAccessSessions') ?? {}
    );

    // Merge updates into the specific message session
    sessions[messageId] = {
      ...(sessions[messageId] ?? {}),
      ...updates,
    };

    // Single atomic write
    await inbox.setFlag(MODULE_ID, 'messageAccessSessions', sessions);

    // Update in-memory cache
    const cacheKey = `${actorId}::${messageId}`;
    this._sessionCache.set(cacheKey, sessions[messageId]);
  }

  /**
   * Get the inbox journal for an actor.
   * Uses MessageRepository's journal accessor.
   *
   * Note: This is a sync call — getInboxJournal on the repo is async,
   * but the journal is cached after first access. We look it up by
   * searching game.journal directly for the sync path.
   *
   * @param {string} actorId
   * @returns {JournalEntry|null}
   * @private
   */
  _getInboxJournal(actorId) {
    if (!actorId) return null;

    // Search game.journal for the inbox keyed to this actor
    // MessageRepository creates journals named "NCM-Inbox-{actorId}"
    // with flags: { [MODULE_ID]: { type: 'inbox', actorId } }
    return game.journal?.find(j =>
      j.name === `NCM-Inbox-${actorId}` ||
      j.getFlag(MODULE_ID, 'actorId') === actorId
    ) ?? null;
  }
}
