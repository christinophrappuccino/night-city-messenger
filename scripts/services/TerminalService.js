/**
 * TerminalService
 * @file scripts/services/TerminalService.js
 * @module cyberpunkred-messenger
 * @description Terminal operations — a Terminal is a converted Item you "log
 *   into" (an account-scoped mailbox), the sibling of a Data Shard (a file you
 *   crack open). This service is the data + session layer; it deliberately
 *   DELEGATES the security/ICE machinery to the shared services rather than
 *   re-implementing them:
 *
 *     - Login attempts/lockout → SecurityService, keyed on the per-account
 *       targetId `${terminalId}::${accountId}` (so per-account lockout is free).
 *     - Black ICE on auth failure → ICEService (via the auth dialog), unchanged.
 *     - Message storage → one linked JournalEntry per terminal, each page tagged
 *       with the owning `accountId`; messages reuse the standard message flag
 *       shape so MessageRepository._pageToMessage / the whole viewer pipeline
 *       work unchanged.
 *
 *   Mirrors DataShardService's three-flag pattern: isTerminal / terminalConfig /
 *   terminalState / journalId.
 *
 *   Phase 1 (MVP): convert, accounts, per-account message read, login plumbing,
 *   GM force-unlock/relock, exfil (to inbox / to shard). Content type = MESSAGE
 *   only. Player conversion wizard, content-type catalog, send-as, trace, and
 *   the apps/desktop metaphor are later phases (see docs/TERMINAL-EXPANSION.md).
 */

import { MODULE_ID, EVENTS, SOCKET_OPS, DEFAULTS, CONTENT_TYPES } from '../utils/constants.js';
import { log, isGM, generateId, formatCyberDate } from '../utils/helpers.js';
import { MessageRepository } from '../data/MessageRepository.js';

export class TerminalService {

  // ─── Service Accessors ───

  get eventBus() { return game.nightcity?.eventBus; }
  get securityService() { return game.nightcity?.securityService; }
  get iceService() { return game.nightcity?.iceService; }
  get skillService() { return game.nightcity?.skillService; }
  get networkService() { return game.nightcity?.networkService; }
  get soundService() { return game.nightcity?.soundService; }
  get socketManager() { return game.nightcity?.socketManager; }
  get timeService() { return game.nightcity?.timeService; }

  /** Current in-world time as ISO via the time provider (not raw Date.now). */
  _nowIso() {
    try { if (this.timeService) return this.timeService.getCurrentTime(); } catch { /* fallback */ }
    return new Date().toISOString();
  }
  get messageRepository() { return game.nightcity?.messageRepository; }
  get dataShardService() { return game.nightcity?.dataShardService; }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API — Conversion
  // ═══════════════════════════════════════════════════════════

  /**
   * Is this item a Terminal?
   * @param {Item} item
   * @returns {boolean}
   */
  isTerminal(item) {
    return !!item?.getFlag(MODULE_ID, 'isTerminal');
  }

  /**
   * Convert an item into a Terminal. GM only. Single atomic flag write.
   * Creates one linked journal (OBSERVER) for all account messages.
   * Mirrors DataShardService.convertToDataShard — GM instant-convert uses the
   * default config; the GM customizes accounts/security/theme afterwards.
   *
   * @param {Item} item
   * @param {object} [configOverrides] - merged over DEFAULTS.TERMINAL_CONFIG
   * @returns {Promise<{ success: boolean, journalId?: string, error?: string }>}
   */
  async convertToTerminal(item, configOverrides = {}) {
    if (!item) return { success: false, error: 'No item provided' };
    if (!isGM()) return { success: false, error: 'GM only operation' };
    if (item.getFlag(MODULE_ID, 'isTerminal')) {
      return { success: false, error: 'Item is already a terminal' };
    }

    try {
      const folder = await this.messageRepository?.getTerminalFolder?.();

      const journal = await JournalEntry.create({
        name: `${item.name} — Terminal`,
        ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER },
        folder: folder?.id || null,
        flags: { [MODULE_ID]: { type: 'terminal', linkedItemId: item.id } },
      });

      const config = foundry.utils.mergeObject(
        foundry.utils.deepClone(DEFAULTS.TERMINAL_CONFIG),
        configOverrides,
        { inplace: false }
      );

      await item.update({
        [`flags.${MODULE_ID}.isTerminal`]: true,
        [`flags.${MODULE_ID}.terminalConfig`]: config,
        [`flags.${MODULE_ID}.terminalState`]: foundry.utils.deepClone(DEFAULTS.TERMINAL_STATE),
        [`flags.${MODULE_ID}.journalId`]: journal.id,
      });

      this.eventBus?.emit(EVENTS.TERMINAL_CREATED, { itemId: item.id });
      this.soundService?.play('shard-insert');
      log.info(`Item "${item.name}" converted to terminal (journal: ${journal.id})`);
      return { success: true, journalId: journal.id };
    } catch (err) {
      log.error(`Failed to convert item to terminal: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  /**
   * Strip Terminal status from an item. GM only.
   * @param {Item} item
   * @param {boolean} [deleteJournal=false] - also delete the linked message journal
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  async removeTerminal(item, deleteJournal = false) {
    if (!isGM()) return { success: false, error: 'GM only' };
    if (!this.isTerminal(item)) return { success: false, error: 'Not a terminal' };

    try {
      const journalId = item.getFlag(MODULE_ID, 'journalId');
      // Clear all per-account security tracking before dropping the flags.
      for (const account of this.getConfig(item).accounts || []) {
        this.securityService?.resetAllForTarget(this._targetId(item, account.id));
      }
      await item.update({ [`flags.-=${MODULE_ID}`]: null });
      if (deleteJournal && journalId) {
        await game.journal.get(journalId)?.delete();
      }
      log.info(`Terminal removed from "${item.name}"`);
      return { success: true };
    } catch (err) {
      log.error(`Failed to remove terminal: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API — Config / State
  // ═══════════════════════════════════════════════════════════

  /** Get the merged terminal config (defaults ← stored). @param {Item} item */
  getConfig(item) {
    const raw = item?.getFlag(MODULE_ID, 'terminalConfig');
    return foundry.utils.mergeObject(
      foundry.utils.deepClone(DEFAULTS.TERMINAL_CONFIG),
      raw ?? {},
      { inplace: false }
    );
  }

  /** Get the merged terminal state (defaults ← stored). @param {Item} item */
  getState(item) {
    const raw = item?.getFlag(MODULE_ID, 'terminalState');
    return foundry.utils.mergeObject(
      foundry.utils.deepClone(DEFAULTS.TERMINAL_STATE),
      raw ?? {},
      { inplace: false }
    );
  }

  /**
   * GM update terminal config (shallow merge over current). GM only.
   * @param {Item} item
   * @param {object} configUpdates
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  async updateConfig(item, configUpdates) {
    if (!isGM()) return { success: false, error: 'GM only' };
    try {
      const next = foundry.utils.mergeObject(this.getConfig(item), configUpdates, { inplace: false });
      await item.update({ [`flags.${MODULE_ID}.terminalConfig`]: next });
      return { success: true };
    } catch (err) {
      log.error(`Terminal config update failed: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API — Accounts
  // ═══════════════════════════════════════════════════════════

  /**
   * Accounts visible on the login screen. `hidden` accounts are omitted for
   * players until discovered (discovery → P2); the GM always sees them.
   * @param {Item} item
   * @param {object} [opts]
   * @param {boolean} [opts.includeHidden] - force-include hidden accounts
   * @returns {object[]}
   */
  getAccounts(item, { includeHidden = false } = {}) {
    const accounts = this.getConfig(item).accounts || [];
    if (includeHidden || isGM()) return accounts;
    return accounts.filter(a => !a.hidden);
  }

  /** @param {Item} item @param {string} accountId @returns {object|null} */
  getAccount(item, accountId) {
    return (this.getConfig(item).accounts || []).find(a => a.id === accountId) || null;
  }

  /**
   * Add an account. GM only. Generates a stable id; the first account becomes
   * the login-screen default.
   * @param {Item} item
   * @param {object} [accountData] - merged over DEFAULTS.TERMINAL_ACCOUNT
   * @returns {Promise<{ success: boolean, accountId?: string, error?: string }>}
   */
  async addAccount(item, accountData = {}) {
    if (!isGM()) return { success: false, error: 'GM only' };
    if (!this.isTerminal(item)) return { success: false, error: 'Not a terminal' };

    try {
      const config = this.getConfig(item);
      const accountId = accountData.id || `acct_${generateId()}`;
      const account = foundry.utils.mergeObject(
        foundry.utils.deepClone(DEFAULTS.TERMINAL_ACCOUNT),
        { ...accountData, id: accountId },
        { inplace: false }
      );
      const accounts = [...(config.accounts || []), account];
      const updates = { [`flags.${MODULE_ID}.terminalConfig.accounts`]: accounts };
      if (!config.defaultAccountId) {
        updates[`flags.${MODULE_ID}.terminalConfig.defaultAccountId`] = accountId;
      }
      await item.update(updates);
      log.debug(`Account "${account.username || accountId}" added to terminal "${item.name}"`);
      return { success: true, accountId };
    } catch (err) {
      log.error(`Failed to add terminal account: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  /**
   * Update an account's fields. GM only.
   * @param {Item} item @param {string} accountId @param {object} updates
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  async updateAccount(item, accountId, updates) {
    if (!isGM()) return { success: false, error: 'GM only' };
    try {
      const accounts = (this.getConfig(item).accounts || []).map(a =>
        a.id === accountId ? foundry.utils.mergeObject(a, updates, { inplace: false }) : a
      );
      await item.update({ [`flags.${MODULE_ID}.terminalConfig.accounts`]: accounts });
      return { success: true };
    } catch (err) {
      log.error(`Failed to update terminal account: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  /**
   * Remove an account (does NOT delete its tagged messages — they become
   * orphaned in the journal; a future cleanup can sweep them). GM only.
   * @param {Item} item @param {string} accountId
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  async removeAccount(item, accountId) {
    if (!isGM()) return { success: false, error: 'GM only' };
    try {
      const config = this.getConfig(item);
      const accounts = (config.accounts || []).filter(a => a.id !== accountId);
      const updates = { [`flags.${MODULE_ID}.terminalConfig.accounts`]: accounts };
      if (config.defaultAccountId === accountId) {
        updates[`flags.${MODULE_ID}.terminalConfig.defaultAccountId`] = accounts[0]?.id || '';
      }
      await item.update(updates);
      this.securityService?.resetAllForTarget(this._targetId(item, accountId));
      return { success: true };
    } catch (err) {
      log.error(`Failed to remove terminal account: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API — Account Messages
  // ═══════════════════════════════════════════════════════════

  /**
   * All messages for one account, in the standard message shape the viewer
   * consumes (via MessageRepository._pageToMessage). This is the source the
   * TerminalViewerApp's source-adapter calls. Sorted newest first.
   * @param {Item} item
   * @param {string} accountId
   * @returns {object[]}
   */
  getAccountMessages(item, accountId) {
    const journal = this._getLinkedJournal(item);
    if (!journal || !accountId) return [];
    const repo = this.messageRepository;
    return journal.pages.contents
      .filter(p => p.flags?.[MODULE_ID]?.accountId === accountId)
      .map(p => repo?._pageToMessage?.(p))
      .filter(Boolean)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }

  /**
   * Add a message to an account's mailbox. GM only. Writes a journal page using
   * the standard message flag shape (so the viewer reads it unchanged) plus the
   * `accountId` tag that scopes it to this account.
   *
   * @param {Item} item
   * @param {string} accountId
   * @param {object} messageData - { from, fromActorId?, fromContactId?, subject, body, timestamp?, priority?, attachments?, eddies?, network? }
   * @returns {Promise<{ success: boolean, messageId?: string, error?: string }>}
   */
  async addAccountMessage(item, accountId, messageData = {}) {
    if (!isGM()) return { success: false, error: 'GM only' };
    const journal = this._getLinkedJournal(item);
    if (!journal) return { success: false, error: 'No linked journal' };
    if (!this.getAccount(item, accountId)) return { success: false, error: 'Unknown account' };

    try {
      const messageId = messageData.messageId || generateId();
      const flags = this._buildMessageFlags(messageId, accountId, messageData);
      await journal.createEmbeddedDocuments('JournalEntryPage', [{
        name: this._pageName(messageData),
        type: 'text',
        text: { content: messageData.body || '', format: 1 },
        flags: { [MODULE_ID]: flags },
      }]);
      log.debug(`Message "${messageData.subject}" added to terminal account "${accountId}"`);
      return { success: true, messageId };
    } catch (err) {
      log.error(`Failed to add terminal message: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  /**
   * Edit an existing message's content. GM only. Sets leaf flags (safe for a
   * page.update merge) + the page text/name.
   * @param {Item} item @param {string} messageId
   * @param {object} updates - { from?, subject?, body?, priority?, classification? }
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  async updateAccountMessage(item, messageId, updates = {}) {
    if (!isGM()) return { success: false, error: 'GM only' };
    const journal = this._getLinkedJournal(item);
    if (!journal) return { success: false, error: 'No linked journal' };
    const page = journal.pages.find(p => p.flags?.[MODULE_ID]?.messageId === messageId);
    if (!page) return { success: false, error: 'Message not found' };
    try {
      const ns = `flags.${MODULE_ID}`;
      const upd = {};
      if (updates.from !== undefined) upd[`${ns}.from`] = updates.from;
      if (updates.subject !== undefined) { upd[`${ns}.subject`] = updates.subject; upd.name = this._pageName({ from: updates.from ?? page.flags[MODULE_ID].from, subject: updates.subject, timestamp: page.flags[MODULE_ID].timestamp }); }
      if (updates.priority !== undefined) upd[`${ns}.priority`] = updates.priority;
      if (updates.classification !== undefined) upd[`${ns}.metadata.classification`] = updates.classification;
      if (updates.body !== undefined) { upd[`${ns}.body`] = updates.body; upd['text.content'] = updates.body; }
      await page.update(upd);
      return { success: true };
    } catch (err) {
      log.error(`Failed to update terminal message: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  /**
   * Remove a message page by id. GM only.
   * @param {Item} item @param {string} messageId
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  async removeAccountMessage(item, messageId) {
    if (!isGM()) return { success: false, error: 'GM only' };
    const journal = this._getLinkedJournal(item);
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
  //  PUBLIC API — Login / Sessions
  // ═══════════════════════════════════════════════════════════

  /**
   * The per-actor session blob: which account is active, which have been
   * unlocked this session.
   * @param {Item} item @param {string} actorId
   * @returns {{ activeAccountId: string|null, loggedInAccounts: string[], firstAccessedAt: string|null }}
   */
  getSession(item, actorId) {
    const state = this.getState(item);
    const s = state.sessions?.[actorId] ?? {};
    return {
      activeAccountId: s.activeAccountId ?? null,
      loggedInAccounts: Array.isArray(s.loggedInAccounts) ? s.loggedInAccounts : [],
      firstAccessedAt: s.firstAccessedAt ?? null,
    };
  }

  /**
   * Layer 0 — the SHARED network gate (in front of all per-account auth). A
   * networked terminal is only reachable when the player's Agent is connected to
   * an allowed network with enough signal. Delegates to the shared
   * NetworkService.checkAccess contract (same logic shards use). GM and a
   * force-unlocked terminal bypass.
   *
   * @param {Item} item
   * @returns {{ allowed: boolean, reason?: string, requiredNetwork?: string|null, signalInfo?: object }}
   */
  checkNetworkAccess(item) {
    const config = this.getConfig(item);
    if (!config.network?.required) return { allowed: true };
    // GM bypass is EXPLICIT (force-unlock → gmBypassed), mirroring shard
    // forceDecrypt — so a GM can still experience/test the gate until they bypass.
    if (this.getState(item).gmBypassed) return { allowed: true };
    if (!this.networkService) return { allowed: false, reason: 'No network connection' };
    return this.networkService.checkAccess(config.network);
  }

  /**
   * The auth descriptor for an account — the `{ security, name, targetId }`
   * shape the (generalized) NetworkAuthDialog consumes, and the key
   * SecurityService tracks lockout under. targetId = `${terminalId}::${accountId}`.
   * @param {Item} item @param {string} accountId
   * @returns {{ security: object, name: string, targetId: string }|null}
   */
  getAuthDescriptor(item, accountId) {
    const account = this.getAccount(item, accountId);
    if (!account) return null;
    return {
      security: account.security || {},
      name: account.displayName || account.username || 'Account',
      targetId: this._targetId(item, accountId),
    };
  }

  /**
   * Does this actor still need to authenticate to enter the account?
   * False when: the account is open (no requiresAuth), the GM has force-unlocked,
   * the user is the GM, or the actor already unlocked it this session.
   * @param {Item} item @param {string} accountId @param {string} actorId
   * @returns {boolean}
   */
  requiresAuth(item, accountId, actorId) {
    // GM bypass is EXPLICIT via force-unlock (gmBypassed), NOT automatic — so the
    // GM sees locked accounts and can test the login (or force-unlock to skip).
    if (this.getState(item).gmBypassed) return false;
    const account = this.getAccount(item, accountId);
    if (!account?.security?.requiresAuth) return false;
    return !this.getSession(item, actorId).loggedInAccounts.includes(accountId);
  }

  /**
   * Resolve the full entry state for the login screen's 3-state machine:
   *   1. network blocked  → show "connect to {requiredNetwork}" gate (Layer 0)
   *   2. on network, pick  → account cards / CRT prompt (Layer 1)
   *   3. active session    → straight into the mailbox
   * Each account is annotated with its per-actor auth/lockout status.
   *
   * @param {Item} item
   * @param {string} actorId
   * @returns {{ networkBlocked: boolean, networkReason?: string, requiredNetwork?: string|null,
   *             signalInfo?: object, activeAccountId: string|null,
   *             accounts: Array<object & { requiresAuth: boolean, lockedOut: boolean, attemptsRemaining: number }> }}
   */
  getEntryState(item, actorId) {
    const net = this.checkNetworkAccess(item);
    const session = this.getSession(item, actorId);
    const accounts = this.getAccounts(item).map(a => ({
      ...a,
      requiresAuth: this.requiresAuth(item, a.id, actorId),
      lockedOut: this.isAccountLockedOut(item, a.id, actorId),
      attemptsRemaining: this.getRemainingAttempts(item, a.id, actorId),
    }));
    return {
      networkBlocked: !net.allowed,
      networkReason: net.reason,
      requiredNetwork: net.requiredNetwork ?? null,
      signalInfo: net.signalInfo,
      activeAccountId: session.activeAccountId,
      accounts,
    };
  }

  /** Is this actor currently locked out of the account? @returns {boolean} */
  isAccountLockedOut(item, accountId, actorId) {
    return !!this.securityService?.isLockedOut?.(actorId, this._targetId(item, accountId));
  }

  /** Remaining attempts before lockout. @returns {number} */
  getRemainingAttempts(item, accountId, actorId) {
    const account = this.getAccount(item, accountId);
    const max = account?.security?.maxAttempts ?? 3;
    return this.securityService?.getRemainingAttempts?.(actorId, this._targetId(item, accountId)) ?? max;
  }

  /**
   * Record a successful login: marks the account unlocked + active for this
   * actor's session and clears its SecurityService attempt counter.
   * @param {Item} item @param {string} accountId @param {string} actorId
   * @returns {Promise<{ success: boolean }>}
   */
  async recordLoginSuccess(item, accountId, actorId) {
    const targetId = this._targetId(item, accountId);
    this.securityService?.recordSuccess?.(actorId, targetId);
    if (actorId) {
      const session = this.getSession(item, actorId);
      const loggedInAccounts = session.loggedInAccounts.includes(accountId)
        ? session.loggedInAccounts
        : [...session.loggedInAccounts, accountId];
      await this._updateSession(item, actorId, {
        activeAccountId: accountId,
        loggedInAccounts,
        firstAccessedAt: session.firstAccessedAt || new Date().toISOString(),
      });
    }
    this.eventBus?.emit(EVENTS.TERMINAL_LOGIN_SUCCESS, { itemId: item.id, accountId, actorId });
    this._broadcastStateChange(item.id);
    return { success: true };
  }

  /**
   * Record a failed login attempt. Lockout (and any ICE) are driven by
   * SecurityService / the auth dialog exactly as for networks and shards.
   * @param {Item} item @param {string} accountId @param {string} actorId
   * @returns {{ lockedOut: boolean, attemptsRemaining: number }}
   */
  recordLoginFailure(item, accountId, actorId) {
    const account = this.getAccount(item, accountId);
    const targetId = this._targetId(item, accountId);
    this.securityService?.initTracking?.(actorId, targetId, {
      maxAttempts: account?.security?.maxAttempts ?? 3,
      lockoutDuration: account?.security?.lockoutDuration ?? 3600000,
    });
    this.securityService?.recordFailedAttempt?.(actorId, targetId);
    this.eventBus?.emit(EVENTS.TERMINAL_LOGIN_FAILURE, { itemId: item.id, accountId, actorId });
    return {
      lockedOut: this.isAccountLockedOut(item, accountId, actorId),
      attemptsRemaining: this.getRemainingAttempts(item, accountId, actorId),
    };
  }

  /**
   * Switch the active account for an actor (must already be unlocked, else the
   * viewer routes back to the login screen for re-auth).
   * @param {Item} item @param {string} actorId @param {string} accountId
   */
  async setActiveAccount(item, actorId, accountId) {
    await this._updateSession(item, actorId, { activeAccountId: accountId });
    this._broadcastStateChange(item.id);
  }

  /**
   * Log the actor out — back to the login screen. Clears the active account
   * (and, when full=true, the unlocked set so every account re-auths).
   * @param {Item} item @param {string} actorId @param {boolean} [full=false]
   */
  async logout(item, actorId, full = false) {
    const updates = { activeAccountId: null };
    if (full) updates.loggedInAccounts = [];
    await this._updateSession(item, actorId, updates);
    this._broadcastStateChange(item.id);
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API — GM Bypass / Relock
  // ═══════════════════════════════════════════════════════════

  /**
   * GM force-unlock — bypass all account auth (mirrors shard forceDecrypt).
   * GM only. Cleared by {@link relock}.
   * @param {Item} item
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  async forceUnlock(item) {
    if (!isGM()) return { success: false, error: 'GM only' };
    try {
      const state = this.getState(item);
      state.gmBypassed = true;
      await item.update({ [`flags.${MODULE_ID}.terminalState`]: state });
      this._broadcastStateChange(item.id);
      log.info(`GM force-unlocked terminal "${item.name}"`);
      return { success: true };
    } catch (err) {
      log.error(`Terminal force-unlock failed: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  /**
   * GM relock — wipe all sessions + clear gmBypass + reset every account's
   * SecurityService tracking. GM only.
   *
   * Uses unsetFlag → setFlag (NOT a merge): Foundry's update() mergeObject would
   * merge `sessions: {}` INTO the existing sessions, leaving lockouts intact —
   * the standing nested-flag-write gotcha (shard relockShard lesson).
   * @param {Item} item
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  async relock(item) {
    if (!isGM()) return { success: false, error: 'GM only' };
    try {
      for (const account of this.getConfig(item).accounts || []) {
        this.securityService?.resetAllForTarget(this._targetId(item, account.id));
      }
      await item.unsetFlag(MODULE_ID, 'terminalState');
      await item.setFlag(MODULE_ID, 'terminalState', foundry.utils.deepClone(DEFAULTS.TERMINAL_STATE));
      this.eventBus?.emit(EVENTS.TERMINAL_RELOCKED, { itemId: item.id });
      this.soundService?.play('shard-relock');
      this._broadcastStateChange(item.id);
      log.info(`GM relocked terminal "${item.name}"`);
      return { success: true };
    } catch (err) {
      log.error(`Terminal relock failed: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API — Exfiltration
  // ═══════════════════════════════════════════════════════════

  /**
   * Exfil selected messages into a player's own Agent inbox (read-it-later).
   * Copies each as a fresh inbox page via MessageRepository.createMessage —
   * which fires the normal document-sync hooks, so no new delivery path. Each
   * copy is stamped `metadata.recoveredFrom = <terminal name>`.
   *
   * GM-side write (the inbox journal is GM-owned); the player path will relay
   * through a socket op in a later phase.
   *
   * @param {Item} item
   * @param {string} accountId
   * @param {string[]} messageIds
   * @param {string} targetActorId - whose inbox to copy into
   * @returns {Promise<{ success: boolean, count: number, error?: string }>}
   */
  async exfilToInbox(item, accountId, messageIds, targetActorId) {
    if (!this.getConfig(item).allowExfil) return { success: false, count: 0, error: 'Exfiltration disabled for this terminal' };
    if (!isGM()) return { success: false, count: 0, error: 'GM only (player exfil relay → later phase)' };
    if (!targetActorId) return { success: false, count: 0, error: 'No target actor' };

    const repo = this.messageRepository;
    if (!repo) return { success: false, count: 0, error: 'MessageRepository unavailable' };

    const terminalName = this._displayName(item);
    const account = this.getAccount(item, accountId);
    const source = `${terminalName} · ${account?.username || accountId}`;
    const origTo = account?.email || account?.displayName || account?.username || accountId;
    const messages = this.getAccountMessages(item, accountId);
    const ids = new Set(messageIds || []);
    let count = 0;

    for (const msg of messages.filter(m => ids.has(m.messageId))) {
      const res = await repo.createMessage(targetActorId, {
        ...msg,
        // Original sender (from/fromActorId/fromContactId) and timestamp ride along
        // via the spread — From and the original time stay intact. The original
        // recipient (the terminal account, e.g. v_arasaka) is carried as `to` so
        // the copy reads "hr@arasaka → v_arasaka", not "→ {downloader}". The
        // `recovered` flag routes it to the Agent's Recovered folder (not the inbox).
        messageId: generateId(),
        threadId: undefined,
        eddies: 0,                       // never carry eddies onto a copy (no double-grant)
        to: origTo,
        toActorId: account?.actorId || '',
        toContactId: account?.masterContactId || '',
        body: msg.body || '',           // clean body — the Recovered chip carries provenance
        status: { read: false },
        metadata: { ...(msg.metadata || {}), recovered: true, recoveredFrom: source, recoveredTo: origTo, recoveredAt: this._nowIso(), recoveredOrigTs: msg.timestamp },
      });
      if (res?.success) count++;
    }

    this.eventBus?.emit(EVENTS.TERMINAL_EXFIL, { itemId: item.id, accountId, dest: 'inbox', count });
    log.info(`Exfil → inbox: ${count} message(s) from terminal "${terminalName}" to actor ${targetActorId}`);
    return { success: count > 0, count };
  }

  /**
   * Exfil selected messages onto a physical Data Shard (the "go-bag"). If the
   * target item isn't already a shard, it's converted first (default config).
   * Each entry keeps its contentType/contentData, so a copied MESSAGE stays a
   * message. GM-side; the player path relays through SHARD_CONVERT_REQUEST in a
   * later phase.
   *
   * @param {Item} item - source terminal
   * @param {string} accountId
   * @param {string[]} messageIds
   * @param {Item} targetItem - the item to burn onto
   * @returns {Promise<{ success: boolean, count: number, error?: string }>}
   */
  async exfilToShard(item, accountId, messageIds, targetItem) {
    if (!this.getConfig(item).allowExfil) return { success: false, count: 0, error: 'Exfiltration disabled for this terminal' };
    if (!isGM()) return { success: false, count: 0, error: 'GM only (player exfil relay → later phase)' };
    if (!targetItem) return { success: false, count: 0, error: 'No target item' };

    const shardSvc = this.dataShardService;
    if (!shardSvc) return { success: false, count: 0, error: 'DataShardService unavailable' };

    if (!shardSvc.isDataShard(targetItem)) {
      const conv = await shardSvc.convertToDataShard(targetItem);
      if (!conv?.success) return { success: false, count: 0, error: conv?.error || 'Shard conversion failed' };
    }

    const terminalName = this._displayName(item);
    const account = this.getAccount(item, accountId);
    const source = `${terminalName} · ${account?.username || accountId}`;
    const messages = this.getAccountMessages(item, accountId);
    const ids = new Set(messageIds || []);
    let count = 0;

    for (const msg of messages.filter(m => ids.has(m.messageId))) {
      const res = await shardSvc.addMessage(targetItem, {
        contentType: CONTENT_TYPES.MESSAGE,
        from: msg.from,                  // original sender preserved
        subject: msg.subject,
        body: this._provenanceHeader(source, msg.timestamp) + (msg.body || ''),
        timestamp: msg.timestamp,        // original time preserved
        contentData: { recoveredFrom: source, recoveredOrigTs: msg.timestamp },
      });
      if (res?.success) count++;
    }

    this.eventBus?.emit(EVENTS.TERMINAL_EXFIL, { itemId: item.id, accountId, dest: 'shard', count });
    log.info(`Exfil → shard: ${count} message(s) from terminal "${terminalName}" to item "${targetItem.name}"`);
    return { success: count > 0, count };
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API — Enumeration (Admin tab)
  // ═══════════════════════════════════════════════════════════

  /**
   * Every Terminal in the world — world items + actor-owned items (mirrors the
   * shard collector). Used by the Admin Terminals tab.
   * @returns {Item[]}
   */
  collectTerminals() {
    const out = [];
    for (const it of game.items ?? []) {
      if (this.isTerminal(it)) out.push(it);
    }
    for (const actor of game.actors ?? []) {
      for (const it of actor.items ?? []) {
        if (this.isTerminal(it)) out.push(it);
      }
    }
    return out;
  }

  // ═══════════════════════════════════════════════════════════
  //  PRIVATE
  // ═══════════════════════════════════════════════════════════

  /** SecurityService target key for an account. @private */
  _targetId(item, accountId) {
    return `${item.id}::${accountId}`;
  }

  /** Display name for the terminal (config override → item name). @private */
  _displayName(item) {
    return this.getConfig(item).terminalName || item?.name || 'Terminal';
  }

  /**
   * Provenance banner prepended to an exfiltrated copy so it's obvious the
   * content was recovered — without touching the original From or timestamp.
   * @private
   */
  _provenanceHeader(source, origTs) {
    let when = '';
    try { when = origTs ? ` · ${formatCyberDate(origTs)}` : ''; } catch { /* ignore */ }
    return `<div class="ncm-recovered-banner" style="font-family:monospace;font-size:11px;opacity:.75;border-left:2px solid #19f3f7;padding:3px 9px;margin:0 0 10px">⟁ RECOVERED // ${source}${when}</div>`;
  }

  /** @private */
  _getLinkedJournal(item) {
    const journalId = item?.getFlag(MODULE_ID, 'journalId');
    return journalId ? game.journal.get(journalId) : null;
  }

  /** @private Merge an actor's session blob and write the whole state flag. */
  async _updateSession(item, actorId, updates) {
    if (!actorId) return;
    const state = this.getState(item);
    if (!state.sessions) state.sessions = {};
    state.sessions[actorId] = { ...this.getSession(item, actorId), ...updates };
    await item.update({ [`flags.${MODULE_ID}.terminalState`]: state });
  }

  /**
   * Build the stored message-flag block for a terminal page. Matches the shape
   * MessageRepository._pageToMessage reads, plus the `accountId` scope tag.
   * @private
   */
  _buildMessageFlags(messageId, accountId, data) {
    return {
      accountId,
      messageId,
      threadId: data.threadId || messageId,
      inReplyTo: data.inReplyTo || null,
      references: Array.isArray(data.references) ? data.references : [],
      from: data.from || 'UNKNOWN',
      fromActorId: data.fromActorId || '',
      fromContactId: data.fromContactId || '',
      to: data.to || '',
      toActorId: data.toActorId || '',
      toContactId: data.toContactId || '',
      subject: data.subject || '(no subject)',
      body: data.body || '',
      priority: data.priority || 'normal',
      timestamp: data.timestamp || this._nowIso(),
      readAt: null,
      network: data.network || 'CITINET',
      status: {
        read: data.status?.read || false,
        saved: false,
        spam: false,
        encrypted: !!data.encryption || false,
        infected: false,
        deleted: false,
        sent: false,
        scheduled: false,
        eddiesClaimed: false,
        eddiesClaimedAt: null,
      },
      encryption: data.encryption || null,
      eddies: data.eddies || 0,
      selfDestruct: null,
      // Typed content (design doc §8c) — null = ordinary message; set =
      // rendered via the shared content-body partial in the viewer.
      contentType: data.contentType || null,
      contentData: data.contentData || null,
      metadata: { ...(data.metadata || {}) },
      attachments: data.attachments || [],
      malware: null,
      accessControl: data.accessControl || null,
      anonymous: data.anonymous || null,
    };
  }

  /** @private Human-readable page title. */
  _pageName(data) {
    return MessageRepository.formatPageName(
      data.from || 'Unknown',
      data.subject,
      data.timestamp,
      false
    );
  }

  /** @private Notify other clients that this terminal's state changed. */
  _broadcastStateChange(itemId) {
    try {
      this.socketManager?.emit(SOCKET_OPS.TERMINAL_STATE_CHANGED, { itemId });
    } catch {
      // Non-fatal
    }
  }
}
