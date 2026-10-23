/**
 * TerminalService
 * @file scripts/services/TerminalService.js
 * @module night-city-messenger
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
 *   the apps/desktop metaphor are later phases (see dev/design/TERMINAL-EXPANSION.md).
 */

import { MODULE_ID, EVENTS, SOCKET_OPS, DEFAULTS, CONTENT_TYPES } from '../utils/constants.js';
import { log, isGM, generateId, formatCyberDate } from '../utils/helpers.js';
import { MessageRepository } from '../data/MessageRepository.js';
import { suggestFilename } from '../ui/content/ContentRenderers.js';

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
    // Network-gated accounts VANISH for players until the machine's uplink
    // reaches their network (isContentVisible GM-bypasses, so the GM keeps the
    // full list). This covers the login cards, the switcher, AND the
    // secret-login username path — a gated account is unreachable, not merely
    // unlisted.
    const accounts = (this.getConfig(item).accounts || [])
      .filter(a => this.isContentVisible(item, a.network));
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
   * Mirror a delivered Agent message into every terminal account that
   * represents the recipient — an account linked to a character/contact IS
   * that identity's inbox on the machine, so mail sent (or replied) to them
   * shows up on the terminal too, original From/timestamp intact. Called by
   * MessageService._deliverMessage (always the GM client) with the
   * recipient-facing payload, so anonymous mail arrives pre-masked. Non-fatal:
   * the primary inbox delivery has already succeeded.
   *
   * Matching (any one): account.masterContactId === data.toContactId ·
   * account.actorId === data.toActorId · account.email === data.to
   * (case-insensitive). Reads config accounts directly, not getAccounts —
   * hidden/net-gated accounts still receive mail (those filters are read-time
   * player visibility, not ownership).
   *
   * The mirror gets its OWN messageId (`<id>-t-<accountId>`): content
   * mutations resolve pages by messageId across ALL journals
   * (applySiphonToJournal takes the first hit), so a shared id would let a
   * claim/siphon land on the inbox copy while the mirror stayed live (or vice
   * versa). Money never duplicates (the exfil no-double-grant rule): the
   * mirror carries eddies 0 + neutralized contentData — the recipient's real
   * inbox copy is the canonical claim surface.
   *
   * @param {object} data - delivery payload (recipient-facing clone)
   * @returns {Promise<{ success: boolean, mirrored: number }>}
   */
  async mirrorDeliveryToAccounts(data) {
    if (!isGM() || !data?.messageId) return { success: true, mirrored: 0 };
    // Spam-routed mail is delivered silently to the Spam folder — surfacing it
    // on a terminal would defeat the filter.
    if (data.status?.spam) return { success: true, mirrored: 0 };
    const toEmail = (data.to || '').trim().toLowerCase();
    let mirrored = 0;
    for (const item of this.collectTerminals()) {
      const journal = this._getLinkedJournal(item);
      if (!journal) continue;
      for (const acct of (this.getConfig(item).accounts || [])) {
        const match =
          (data.toContactId && acct.masterContactId && acct.masterContactId === data.toContactId) ||
          (data.toActorId && acct.actorId && acct.actorId === data.toActorId) ||
          (toEmail && (acct.email || '').trim().toLowerCase() === toEmail);
        if (!match) continue;
        const mirrorId = `${data.messageId}-t-${acct.id}`;
        // Deterministic id doubles as the redelivery guard.
        if (journal.pages.contents.some(p => p.flags?.[MODULE_ID]?.messageId === mirrorId)) continue;
        const res = await this.addAccountMessage(item, acct.id, {
          ...data,
          messageId: mirrorId,
          eddies: 0,
          contentData: this._exfilContentData(data),
          folder: '',
          status: { read: false },
        });
        if (res?.success) mirrored++;
      }
    }
    if (mirrored) log.debug(`Delivery ${data.messageId} mirrored to ${mirrored} terminal account(s)`);
    return { success: true, mirrored };
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
      if (updates.folder !== undefined) upd[`${ns}.folder`] = updates.folder;
      if (updates.subject !== undefined) { upd[`${ns}.subject`] = updates.subject; upd.name = this._pageName({ from: updates.from ?? page.flags[MODULE_ID].from, subject: updates.subject, timestamp: page.flags[MODULE_ID].timestamp }); }
      if (updates.priority !== undefined) upd[`${ns}.priority`] = updates.priority;
      if (updates.classification !== undefined) upd[`${ns}.metadata.classification`] = updates.classification;
      if (updates.body !== undefined) { upd[`${ns}.body`] = updates.body; upd['text.content'] = updates.body; }
      // Status writes go per-leaf (`status.saved`, `status.deleted`, …) — the
      // reliable dot-path form; a nested object merge is the standing gotcha.
      if (updates.status && typeof updates.status === 'object') {
        for (const [k, val] of Object.entries(updates.status)) upd[`${ns}.status.${k}`] = val;
      }
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

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API — Machine Uplink (Layer 1)
  //
  //  The terminal's OWN connection, independent of the player's Agent network.
  //  Interfaces = what the machine's hardware can reach (GM-configured; scene
  //  availability / dead zones deliberately don't apply — a wired box works in
  //  a jam). Content marked with networkVisibility gates on THIS connection.
  // ═══════════════════════════════════════════════════════════

  /**
   * The terminal's live connection. Resolution: stored state → config default →
   * null (LOCAL ONLY). A stored network that no longer exists or is no longer an
   * interface degrades to LOCAL ONLY rather than erroring.
   * @param {Item} item
   * @returns {{ networkId: string|null, network: object|null }}
   */
  getUplink(item) {
    const cfg = this.getConfig(item).connection || {};
    const conn = this.getState(item).connection || {};
    const interfaceIds = new Set((cfg.interfaces || []).map(i => i.networkId));
    const resolve = (id) => {
      if (!id || !interfaceIds.has(id)) return null;
      return this.networkService?.getNetwork?.(id) || null;
    };
    // '__DEFAULT__' (the unset sentinel — survives whole-state rewrites) follows
    // the config default; null = explicitly disconnected (LOCAL ONLY).
    const wantedId = conn.currentNetworkId === '__DEFAULT__' ? cfg.defaultNetworkId : conn.currentNetworkId;
    const network = resolve(wantedId);
    return { networkId: network ? wantedId : null, network };
  }

  /**
   * The machine's interfaces resolved to selector rows: full network object +
   * uplink state ('active' | 'available' | 'locked'). Deleted networks are
   * dropped. 'locked' = secured network the machine holds no credential for
   * (not preAuthorized, not yet joined this campaign).
   * @param {Item} item
   * @returns {Array<{ networkId: string, network: object, state: string, preAuthorized: boolean }>}
   */
  getUplinkInterfaces(item) {
    const cfg = this.getConfig(item).connection || {};
    const { networkId: currentId } = this.getUplink(item);
    return (cfg.interfaces || [])
      .map(i => {
        const network = this.networkService?.getNetwork?.(i.networkId);
        if (!network) return null;
        let state = 'available';
        if (i.networkId === currentId) state = 'active';
        else if (network.security?.requiresAuth && !this._uplinkAuthorized(item, i)) state = 'locked';
        // wired = a physical LAN drop: always full signal (display/fiction only —
        // uplinks already ignore scene jamming for gating).
        return { networkId: i.networkId, network, state, preAuthorized: !!i.preAuthorized, wired: !!i.wired };
      })
      .filter(Boolean);
  }

  /**
   * The terminal's mailbox folders, resolved and ordered for the sidebar:
   * Inbox → custom folders → Saved → Trash. System folder NAMES come from
   * config.folderNames (the preset-compatible contract); config.folders layers
   * icons, saved/trash visibility, and GM-authored customs on top. Legacy
   * configs (no `folders` key) resolve to exactly the old three folders.
   * @param {Item} item
   * @returns {Array<{ id: string, name: string, icon: string, kind: 'inbox'|'custom'|'saved'|'trash' }>}
   */
  getFolders(item) {
    const cfg = this.getConfig(item);
    const fn = cfg.folderNames || {};
    const f = cfg.folders || {};
    const ic = f.icons || {};
    const out = [{ id: 'inbox', name: (fn.inbox || '').trim() || 'Inbox', icon: ic.inbox || 'fas fa-inbox', kind: 'inbox' }];
    for (const c of f.custom || []) {
      if (c?.id && (c.name || '').trim()) out.push({ id: c.id, name: c.name.trim(), icon: c.icon || 'fas fa-folder', kind: 'custom' });
    }
    if (f.savedEnabled !== false) out.push({ id: 'saved', name: (fn.saved || '').trim() || 'Saved', icon: ic.saved || 'fa-regular fa-star', kind: 'saved' });
    if (f.trashEnabled !== false) out.push({ id: 'trash', name: (fn.trash || '').trim() || 'Trash', icon: ic.trash || 'fas fa-trash-can', kind: 'trash' });
    return out;
  }

  /** @private Does the machine hold a credential for this interface's network? */
  _uplinkAuthorized(item, iface) {
    if (iface.preAuthorized) return true;
    const auth = this.getState(item).connection?.authenticated || {};
    return !!auth[iface.networkId];
  }

  /**
   * Point the machine's uplink at a network (null = LOCAL ONLY / disconnect).
   * GM-side write (item flags aren't player-writable on world items) — players
   * relay via SOCKET_OPS.TERMINAL_NET_REQUEST. `remember` stamps the network
   * into connection.authenticated (set after a successful secured join, so the
   * machine keeps the credential).
   *
   * Whole-block rewrite of terminalState (the nested-flag dot-path gotcha).
   * @param {Item} item @param {string|null} networkId @param {{ remember?: boolean }} [opts]
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  async setUplink(item, networkId, { remember = false } = {}) {
    if (!isGM()) return { success: false, error: 'GM only (players relay via socket)' };
    if (networkId) {
      const iface = (this.getConfig(item).connection?.interfaces || []).find(i => i.networkId === networkId);
      if (!iface) return { success: false, error: 'Network is not an interface of this terminal' };
    }
    try {
      const state = this.getState(item);
      const conn = { ...(state.connection || {}), currentNetworkId: networkId || null };
      if (remember && networkId) conn.authenticated = { ...(conn.authenticated || {}), [networkId]: true };
      state.connection = conn;
      await item.update({ [`flags.${MODULE_ID}.terminalState`]: state });
      this._broadcastStateChange(item.id);
      log.debug(`Terminal "${item.name}" uplink → ${networkId || 'LOCAL ONLY'}`);
      return { success: true };
    } catch (err) {
      log.error(`Terminal uplink switch failed: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  /**
   * Raw networkVisibility check against the machine's uplink — NO GM bypass
   * (the viewer uses this to badge OFF-NET rows for the GM). Unrestricted
   * content is always visible; restricted content needs the uplink to match by
   * network id or type. LOCAL ONLY (null uplink) reaches only unrestricted
   * content. Mirrors DataShardService.getVisibleEntries semantics.
   * @param {Item} item @param {object|null} nv - { restricted, allowedNetworks[], allowedTypes[] }
   * @returns {boolean}
   */
  uplinkReaches(item, nv) {
    if (!nv?.restricted) return true;
    const { networkId, network } = this.getUplink(item);
    if (!networkId) return false;
    if ((nv.allowedNetworks || []).includes(networkId)) return true;
    if (network?.type && (nv.allowedTypes || []).includes(network.type)) return true;
    return false;
  }

  /** networkVisibility check with GM bypass — the enforcement entry point. */
  isContentVisible(item, nv) {
    if (isGM()) return true;
    return this.uplinkReaches(item, nv);
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
      // GM-only annotation: this account is network-gated off the current uplink
      // (players never receive it — getAccounts already filtered theirs).
      offNet: !this.uplinkReaches(item, a.network),
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

  /** Remaining lockout time (ms) for this actor on this account. 0 = not locked. */
  getAccountLockoutRemaining(item, accountId, actorId) {
    return this.securityService?.getLockoutRemaining?.(actorId, this._targetId(item, accountId)) || 0;
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
      // The footprint log survives a reset — it's the GM's audit trail, and
      // "log everyone out" shouldn't erase who logged in before.
      const keepLog = this.getState(item).loginLog;
      const fresh = foundry.utils.deepClone(DEFAULTS.TERMINAL_STATE);
      if (Array.isArray(keepLog) && keepLog.length) fresh.loginLog = keepLog;
      await item.unsetFlag(MODULE_ID, 'terminalState');
      await item.setFlag(MODULE_ID, 'terminalState', fresh);
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
   * GM-side write (the inbox journal is GM-owned); players reach this via the
   * SOCKET_OPS.TERMINAL_EXFIL_REQUEST relay (SocketHandlers), never directly.
   *
   * @param {Item} item
   * @param {string} accountId
   * @param {string[]} messageIds
   * @param {string} targetActorId - whose inbox to copy into
   * @returns {Promise<{ success: boolean, count: number, error?: string }>}
   */
  async exfilToInbox(item, accountId, messageIds, targetActorId) {
    if (!this.getConfig(item).allowExfil) return { success: false, count: 0, error: 'Exfiltration disabled for this terminal' };
    if (!isGM()) return { success: false, count: 0, error: 'GM only — player calls relay via TERMINAL_EXFIL_REQUEST' };
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
        contentData: this._exfilContentData(msg),
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
   * SAVE FRAME (#37) — the camera-feed escape hatch. A live stream can't be
   * copied off the machine (resolveEntryExfil denies agent/shard/forward/sell/
   * leak on a feed), but you can grab **what it is showing right now**: one
   * channel's frame becomes a single-image GALLERY in the operator's Recovered
   * folder, stamped with the cam id and the feed clock.
   *
   * The capture is the frame's source image, NOT a pixel-crop of the PTZ view —
   * cropping would mean rasterizing to a data URI and stuffing hundreds of KB of
   * base64 into world data on every capture. Instead the PTZ aim (pan/tilt/zoom)
   * rides along in the caption, so the intel ("I was looking at the loading bay")
   * survives without bloating the world.
   *
   * GM-only write (the inbox journal is GM-owned); players relay via
   * TERMINAL_EXFIL_REQUEST `dest: 'saveFrame'`.
   */
  async exfilSaveFrame(item, accountId, messageId, index, targetActorId, aim = '') {
    if (!this.getConfig(item).allowExfil) return { success: false, error: 'Exfiltration disabled for this terminal' };
    if (!isGM()) return { success: false, error: 'GM only' };
    if (!targetActorId) return { success: false, error: 'No target actor' };
    const repo = this.messageRepository;
    if (!repo) return { success: false, error: 'MessageRepository unavailable' };

    const msg = this.getAccountMessages(item, accountId).find(m => m.messageId === messageId);
    const cd = msg?.contentData || {};
    const img = (cd.images || [])[Number(index)] || null;
    if (!img?.url || img.locked || img.corrupted || img.cut) {
      return { success: false, error: 'That channel has nothing to capture' };
    }

    const label = img.label || `CAM_${String(Number(index) + 1).padStart(2, '0')}`;
    // A looped camera is showing OLD footage — the capture must record the time
    // it is DISPLAYING, not the time you took it. (Loop a cam, save a frame, and
    // you've captured the loop: that's the correct, cruel outcome.)
    let stamp = img.loopedTime || '';
    if (!stamp) {
      try { stamp = formatCyberDate(this._nowIso(), { timeOnly: true, seconds: true }); } catch { stamp = ''; }
    }
    const caption = [img.caption, `${label} @ ${stamp || 'unknown time'}`, aim].filter(Boolean).join(' · ');
    const terminalName = this._displayName(item);
    const account = this.getAccount(item, accountId);
    const source = `${terminalName} · ${account?.username || accountId}`;
    const fname = `${label.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${(stamp || '').replace(/[^0-9]/g, '') || 'frame'}.img`;

    const res = await repo.createMessage(targetActorId, {
      messageId: generateId(),
      from: cd.source || label,
      subject: `${label} — frame capture`,
      body: '',
      contentType: CONTENT_TYPES.GALLERY,
      // A single still — never a feed (a captured frame is not a live stream).
      contentData: { title: `${label} — frame capture`, source: cd.source || '', images: [{ url: img.url, label, caption, time: stamp }] },
      // The capture is a FILE, not mail — it lands with a file envelope.
      envelope: 'file',
      file: { filename: fname, owner: cd.source || label, size: '' },
      status: { read: false },
      metadata: { recovered: true, recoveredFrom: source, recoveredTo: account?.email || account?.username || accountId, recoveredAt: this._nowIso(), recoveredOrigTs: msg.timestamp },
    });
    if (!res?.success) return { success: false, error: res?.error || 'Capture failed' };

    this.eventBus?.emit(EVENTS.TERMINAL_EXFIL, { itemId: item.id, accountId, dest: 'saveFrame', count: 1 });
    log.info(`Save frame: ${label} from terminal "${terminalName}" → actor ${targetActorId}`);
    return { success: true, count: 1, label };
  }

  /**
   * Exfil selected messages onto a physical Data Shard (the "go-bag"). If the
   * target item isn't already a shard, it's converted first (default config).
   * Each entry keeps its contentType/contentData, so a copied MESSAGE stays a
   * message. GM-side; players reach this via the SOCKET_OPS.TERMINAL_EXFIL_REQUEST
   * relay (SocketHandlers), never directly.
   *
   * @param {Item} item - source terminal
   * @param {string} accountId
   * @param {string[]} messageIds
   * @param {Item} targetItem - the item to burn onto
   * @returns {Promise<{ success: boolean, count: number, error?: string }>}
   */
  async exfilToShard(item, accountId, messageIds, targetItem) {
    if (!this.getConfig(item).allowExfil) return { success: false, count: 0, error: 'Exfiltration disabled for this terminal' };
    if (!isGM()) return { success: false, count: 0, error: 'GM only — player calls relay via TERMINAL_EXFIL_REQUEST' };
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
    let lastError = null;

    for (const msg of messages.filter(m => ids.has(m.messageId))) {
      // Typed content (spreadsheet/syslog/banking/…) burns as-is so the copy
      // renders identically on the shard; the provenance body header stays a
      // plain-message affordance (typed bodies never render).
      const contentType = msg.contentType || CONTENT_TYPES.MESSAGE;
      const isTyped = contentType !== CONTENT_TYPES.MESSAGE;
      const res = await shardSvc.addMessage(targetItem, {
        contentType,
        from: msg.from,                  // original sender preserved
        subject: msg.subject,
        body: isTyped ? (msg.body || '') : this._provenanceHeader(source, msg.timestamp) + (msg.body || ''),
        timestamp: msg.timestamp,        // original time preserved
        contentData: this._exfilContentData(msg, { recoveredFrom: source, recoveredOrigTs: msg.timestamp }),
      });
      if (res?.success) count++;
      // Keep the first refusal: a shard can now be FULL (a tier's capacity), and
      // "0 copied" with no reason reads as a broken button.
      else if (!lastError && res?.error) lastError = res.error;
    }

    this.eventBus?.emit(EVENTS.TERMINAL_EXFIL, { itemId: item.id, accountId, dest: 'shard', count });
    log.info(`Exfil → shard: ${count} message(s) from terminal "${terminalName}" to item "${targetItem.name}"`);
    return { success: count > 0, count, ...(count === 0 && lastError ? { error: lastError } : {}) };
  }

  /**
   * Resolve the per-action exfil policy (allow/require/skill/dv per action +
   * sell price), applying `allowExfil` as the master gate and back-compat
   * defaults for legacy configs (no `config.exfil` → agent+shard ON/ungated,
   * the four new actions OFF = today's behavior). Read by the viewer to build
   * the exfil menu + feed each action's optional security-console gate.
   * @param {Item} item
   * @returns {{master:boolean, [action:string]:{allow,require,skill,dv,price?}}}
   */
  getExfilPolicy(item) {
    const cfg = this.getConfig(item) || {};
    const master = cfg.allowExfil !== false;
    const base = DEFAULTS.TERMINAL_CONFIG.exfil;
    const ex = cfg.exfil || {};
    const out = { master };
    for (const key of Object.keys(base)) {
      const d = base[key], c = ex[key] || {};
      out[key] = {
        allow: master && (c.allow ?? d.allow),
        require: !!(c.require ?? d.require),
        skill: c.skill || d.skill,
        dv: Number(c.dv ?? d.dv) || 15,
      };
      if (key === 'sell') out[key].price = Math.max(0, Number(c.price ?? d.price) || 0);
    }
    return out;
  }

  /**
   * Resolve the exfil policy FOR ONE ENTRY (#37) — the terminal policy is the
   * default; the entry's own `exfil` override layers on top per action:
   *
   *   entry.exfil = {
   *     agent: { state: 'inherit'|'allow'|'deny', dv? }, shard: {...}, …,
   *     denyReason: 'LIVE STREAM',   // shown on the dead chip
   *     hideDenied: false,           // true = hide the action instead of a chip
   *   }
   *
   * Two hard rules:
   *  - **The terminal's `allowExfil` master is a CEILING.** Master off = nothing
   *    leaves, and no entry can widen it. An entry can only narrow, or widen
   *    within what the master permits.
   *  - **A live camera feed cannot be copied.** You can't download a stream —
   *    agent/shard/forward/sell/leak are denied on it regardless of authoring
   *    (SAVE FRAME is the escape hatch, and WIPE still works: you can always
   *    pull the plug). This is physics, not policy, so it's enforced here rather
   *    than left to the GM to remember.
   *  - **SAVE FRAME only exists on a feed** — it's hidden everywhere else.
   *
   * @returns {object} per-action `{ allow, require, skill, dv, denied, denyReason, hidden }`
   */
  resolveEntryExfil(item, entry = {}) {
    const base = this.getExfilPolicy(item);
    const ov = entry.exfil || {};
    const isFeed = entry.contentType === CONTENT_TYPES.GALLERY && entry.contentData?.mode === 'feed';
    // A stream is not a file: it cannot be copied off the machine at all.
    const STREAM_BLOCKED = ['agent', 'shard', 'forward', 'sell', 'leak'];
    // MODE (the piece that made overrides feel broken): in 'inherit' mode an
    // untouched action follows the terminal's Exfil tab. In **'custom'** mode the
    // entry is the whole story — anything NOT explicitly allowed here is DENIED.
    // That's the "allow only this one, lock everything else" intent; without it,
    // setting one action to ALLOW left the rest INHERITing an allow, so ticking
    // "hide" appeared to do nothing at all.
    const custom = ov.mode === 'custom';
    const out = { master: base.master, isFeed, mode: custom ? 'custom' : 'inherit' };
    for (const key of Object.keys(base)) {
      if (key === 'master') continue;
      const b = base[key];
      const o = ov[key] || {};
      const state = ['allow', 'deny'].includes(o.state) ? o.state : 'inherit';

      // SAVE FRAME is feed-only.
      if (key === 'saveFrame' && !isFeed) { out[key] = { ...b, allow: false, hidden: true }; continue; }

      let allow;
      if (state === 'allow') allow = base.master;
      else if (state === 'deny') allow = false;
      else allow = custom ? false : b.allow;   // custom: unspecified = denied

      let denyReason = '';
      if (isFeed && STREAM_BLOCKED.includes(key)) { allow = false; denyReason = 'LIVE STREAM'; }
      else if (!allow && (state === 'deny' || custom)) denyReason = ov.denyReason || 'COPY-PROTECTED';

      out[key] = {
        allow,
        require: o.require ?? b.require,
        skill: o.skill || b.skill,
        dv: Number(o.dv) || b.dv,
        // `denied` = deliberately blocked (render a dead chip with the reason);
        // a plain policy-off action just doesn't render at all.
        denied: !allow && !!denyReason && base.master,
        denyReason,
        hidden: !!ov.hideDenied && !allow,
      };
      if (key === 'sell') out[key].price = b.price;
    }
    // "The override isn't doing anything" is otherwise undiagnosable — say
    // exactly what was read and what it resolved to (debugMode).
    if (entry.exfil) {
      log.debug(`resolveEntryExfil(${entry.messageId}): mode=${out.mode} master=${out.master} feed=${isFeed} → `
        + Object.keys(base).filter(k => k !== 'master')
          .map(k => `${k}:${out[k].hidden ? 'hidden' : (out[k].allow ? 'allow' : (out[k].denied ? `denied(${out[k].denyReason})` : 'off'))}`)
          .join(' '));
    }
    return out;
  }

  /**
   * Forward selected messages into another recipient's Agent inbox — a normal
   * delivery framed as "Fwd:" from the forwarder (NOT a Recovered copy). GM
   * writes the inbox journal; the player path relays (dest 'forward').
   * @param {Item} item @param {string} accountId @param {string[]} messageIds
   * @param {string} targetActorId  the recipient
   * @param {{email?:string, actorId?:string, name?:string}} [forwarder]
   */
  async exfilForward(item, accountId, messageIds, targetActorId, forwarder = {}) {
    if (!this.getConfig(item).allowExfil) return { success: false, count: 0, error: 'Exfiltration disabled for this terminal' };
    if (!isGM()) return { success: false, count: 0, error: 'GM only (relayed)' };
    if (!targetActorId) return { success: false, count: 0, error: 'No recipient' };
    const repo = this.messageRepository;
    if (!repo) return { success: false, count: 0, error: 'MessageRepository unavailable' };

    const recipient = game.actors?.get(targetActorId);
    const toLabel = recipient?.getFlag?.(MODULE_ID, 'email') || recipient?.name || targetActorId;
    const messages = this.getAccountMessages(item, accountId);
    const ids = new Set(messageIds || []);
    let count = 0;

    for (const msg of messages.filter(m => ids.has(m.messageId))) {
      const res = await repo.createMessage(targetActorId, {
        ...msg,
        messageId: generateId(), threadId: undefined, eddies: 0,
        from: forwarder.email || 'forwarded@ncm.net',
        fromActorId: forwarder.actorId || '', fromContactId: '',
        to: toLabel, toActorId: targetActorId, toContactId: '',
        subject: `Fwd: ${msg.subject || '(no subject)'}`,
        body: msg.body || '',
        contentData: this._exfilContentData(msg),
        status: { read: false },
      });
      if (res?.success) count++;
    }

    this.eventBus?.emit(EVENTS.TERMINAL_EXFIL, { itemId: item.id, accountId, dest: 'forward', count });
    log.info(`Exfil → forward: ${count} message(s) to actor ${targetActorId}`);
    return { success: count > 0, count };
  }

  /**
   * Wipe selected messages off the terminal (cover your tracks). Hard-deletes
   * the source pages. GM-side (journal owner); the player path relays (dest
   * 'wipe'). Independent of `allowExfil` deliberately — a delete isn't a copy;
   * it's still gated by the viewer's per-action policy.
   * @param {Item} item @param {string} accountId @param {string[]} messageIds
   */
  async exfilWipe(item, accountId, messageIds) {
    if (!isGM()) return { success: false, count: 0, error: 'GM only (relayed)' };
    let count = 0;
    for (const id of (messageIds || [])) {
      const r = await this.removeAccountMessage(item, id);
      if (r?.success) count++;
    }
    this.eventBus?.emit(EVENTS.TERMINAL_EXFIL, { itemId: item.id, accountId, dest: 'wipe', count });
    log.info(`Exfil → wipe: ${count} message(s) removed from terminal ${item?.id}`);
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

  /**
   * contentData for an exfil copy — the original rides along verbatim so the
   * copy renders identically, but money affordances are neutralized (the
   * `eddies: 0` no-double-grant rule): a copied EDDIES file reads as claimed,
   * a copied BANKING file can't be siphoned again.
   * @private
   */
  _exfilContentData(msg, extra = {}) {
    if (!msg.contentType && !msg.contentData && !Object.keys(extra).length) return null;
    const cd = { ...(msg.contentData || {}), ...extra };
    if (msg.contentType === CONTENT_TYPES.EDDIES) cd.claimed = true;
    if (msg.contentType === CONTENT_TYPES.BANKING) cd.allowSiphon = false;
    return cd;
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

  // ═══════════════════════════════════════════════════════════
  //  Login footprints — who logged into which account, when
  // ═══════════════════════════════════════════════════════════

  /** Cap for the per-terminal login footprint log. */
  static LOGIN_LOG_CAP = 50;

  /** The machine's login footprint log, oldest → newest. @param {Item} item */
  getLoginLog(item) {
    const list = this.getState(item).loginLog;
    return Array.isArray(list) ? [...list] : [];
  }

  /**
   * The newest recorded login on one account (i.e. the PREVIOUS login when
   * read before this session's own write lands). Null on a fresh account.
   * @param {Item} item @param {string} accountId
   */
  getLastLogin(item, accountId) {
    const list = this.getState(item).loginLog;
    if (!Array.isArray(list)) return null;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i]?.accountId === accountId) return list[i];
    }
    return null;
  }

  /** @private Append one footprint entry (game-clock timestamp), capped. */
  _appendLoginLog(existing, item, accountId, actorId) {
    const account = this.getAccount(item, accountId);
    const actor = actorId ? game.actors?.get(actorId) : null;
    const entry = {
      ts: game.nightcity?.timeService?.getCurrentTime?.() ?? new Date().toISOString(),
      accountId,
      username: account?.username || account?.displayName || accountId,
      operatorId: actorId || '',
      operatorName: actor?.name || '',
    };
    const list = Array.isArray(existing) ? [...existing, entry] : [entry];
    return list.slice(-TerminalService.LOGIN_LOG_CAP);
  }

  /**
   * GM-side landing point for the player session relay (login / account
   * switch / logout state writes — players can't update the world item).
   * @param {Item} item @param {string} actorId @param {object} updates
   */
  async applySessionUpdate(item, actorId, updates) {
    if (!isGM()) return;
    await this._updateSession(item, actorId, updates);
  }

  /** @private Merge an actor's session blob and write the whole state flag.
   *  Players can't update the GM-owned world item — they relay the write via
   *  SOCKET_OPS.TERMINAL_SESSION_REQUEST (the uplink-switch pattern; no
   *  RESULT op — the flag write syncs back and the viewer re-renders off its
   *  updateItem hook). The local viewer proceeds on its own instance state
   *  (`_accountId`), so the brief sync lag is invisible. */
  async _updateSession(item, actorId, updates) {
    if (!actorId) return;
    if (!isGM()) {
      this.socketManager?.emit(SOCKET_OPS.TERMINAL_SESSION_REQUEST, {
        itemUuid: item.uuid, actorId, updates,
      });
      return;
    }
    const state = this.getState(item);
    if (!state.sessions) state.sessions = {};
    state.sessions[actorId] = { ...this.getSession(item, actorId), ...updates };
    // Login footprints — every session establishment (GM login or relayed
    // player login) lands here, so this is the ONE place the machine records
    // who logged into which account, and when (game clock). Capped.
    if (updates.activeAccountId) {
      state.loginLog = this._appendLoginLog(state.loginLog, item, updates.activeAccountId, actorId);
    }
    await item.update({ [`flags.${MODULE_ID}.terminalState`]: state });
    // onLogin resident triggers (design §3a). This GM-side branch is the ONE
    // chokepoint for ALL session establishment — the GM's own logins AND relayed
    // player logins both land here — so it's where onLogin residents fire (the
    // per-client EventBus wouldn't carry a player's login to the GM). Non-blocking
    // so a GM's fire-proposal Dialog can't stall the session write.
    if (updates.activeAccountId) {
      this._checkLoginResidents(item, updates.activeAccountId, actorId)
        .catch(err => log.warn(`Resident login-check failed: ${err.message}`));
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  RESIDENTS — installed programs that fire on a trigger (§3a)
  // ═══════════════════════════════════════════════════════════
  //
  //  A resident is a program left behind on a terminal that fires LATER, when a
  //  trigger condition is met (next login, a date, an action). It's the primitive
  //  behind PLANT (blackmail content the next login finds), keyloggers, backdoor
  //  accounts, and logic bombs. Firing is GM-owned and GM-GATED: a matched trigger
  //  PROPOSES to the GM (Fire / Defuse / Later), it never auto-applies. Detection
  //  is via ANALYZE vs stealthDV (a later slice).

  /** All residents on a terminal (armed/fired/defused). @param {Item} item */
  getResidents(item) {
    return this.getState(item).residents || [];
  }

  /**
   * Install a resident. GM-side (upload will relay — thread 3). Stamps an id and
   * `state:'armed'`, merges caller provenance/stealthDV.
   * @param {Item} item @param {object} resident { effectType, params, trigger, provenance?, stealthDV? }
   * @returns {Promise<{success:boolean, resident?:object, error?:string}>}
   */
  async installResident(item, resident = {}) {
    if (!isGM()) return { success: false, error: 'GM only (upload relays)' };
    if (!this.isTerminal(item)) return { success: false, error: 'Not a terminal' };
    try {
      const record = {
        id: `res_${generateId()}`,
        effectType: resident.effectType || 'adjudicate',
        params: resident.params || {},
        trigger: resident.trigger || { kind: 'manual' },
        provenance: resident.provenance || {},
        stealthDV: Number(resident.stealthDV) || 0,
        slotKey: resident.slotKey || '',
        state: 'armed',
        firedAt: null,
        installedAt: new Date().toISOString(),
      };
      const state = this.getState(item);
      const list = [...(state.residents || [])];
      // One program aimed at one mailbox occupies one SLOT: a re-upload REPLACES
      // the armed plant already there instead of stacking a duplicate. Without
      // this, a player who retried a bad forge left N armed copies and the GM's
      // next login prompt fired every one of them. Only ARMED plants are
      // replaced — a fired one already landed, so a re-upload is a new file.
      const slot = record.slotKey ? list.findIndex(r => r.slotKey === record.slotKey && r.state === 'armed') : -1;
      if (slot >= 0) {
        log.debug(`Terminal "${item.name}": re-upload replaced armed resident in slot ${record.slotKey}`);
        list[slot] = record;
      } else list.push(record);
      state.residents = list;
      await item.update({ [`flags.${MODULE_ID}.terminalState`]: state });
      log.debug(`Terminal "${item.name}": installed resident ${record.effectType} (trigger ${record.trigger.kind})`);
      return { success: true, resident: record };
    } catch (err) { log.error(`Install resident failed: ${err.message}`); return { success: false, error: err.message }; }
  }

  /** Patch a resident by id (GM-side). */
  async updateResident(item, id, patch = {}) {
    if (!isGM()) return { success: false };
    const state = this.getState(item);
    state.residents = (state.residents || []).map(r => (r.id === id ? { ...r, ...patch } : r));
    await item.update({ [`flags.${MODULE_ID}.terminalState`]: state });
    return { success: true };
  }

  /** Remove a resident by id (GM-side). */
  async removeResident(item, id) {
    if (!isGM()) return { success: false };
    const state = this.getState(item);
    state.residents = (state.residents || []).filter(r => r.id !== id);
    await item.update({ [`flags.${MODULE_ID}.terminalState`]: state });
    return { success: true };
  }

  /**
   * Scan onLogin residents when an account becomes active, and propose firing to
   * the GM. GM-side (called from _updateSession). A resident fires at most once
   * (armed → fired/defused).
   * @private
   */
  async _checkLoginResidents(item, accountId, actorId) {
    if (!isGM()) return;
    const now = this._nowMs();
    const matches = this.getResidents(item).filter(r =>
      r.state === 'armed' &&
      r.trigger?.kind === 'onLogin' &&
      (!r.trigger.accountId || r.trigger.accountId === accountId) &&
      (!r.trigger.actorId || r.trigger.actorId === actorId) &&
      (!r.snoozeUntil || r.snoozeUntil <= now));
    for (const r of matches) {
      // Serialize the proposals so two triggers don't stack two Dialogs at once.
      await this._proposeResidentFire(item, r, { accountId, actorId });
    }
  }

  /**
   * The element of an open viewer for this terminal, if any — the FUI modals are
   * host-scoped, so appending into it makes the prompt inherit THAT machine's
   * --ncm-* preset instead of the brand default. Null when nothing is open (the
   * modal then falls back to document.body).
   * @private @param {Item} item @returns {HTMLElement|null}
   */
  _openViewerElement(item) {
    try {
      const w = Object.values(ui.windows).find(v => v?.item?.id === item?.id && v?.element?.classList?.contains('ncm-terminal-app'));
      return w?.element ?? null;
    } catch { return null; }
  }

  /**
   * GM-gated fire proposal (§3a: a trigger match PROPOSES, never auto-fires —
   * unless `residentFireMode` says otherwise). Fire / Defuse / Later. GM-side.
   * @private @returns {Promise<void>}
   */
  async _proposeResidentFire(item, resident, { accountId, actorId } = {}) {
    if (!isGM()) return;
    // In-memory guard: never stack two prompts for the SAME resident (the reaper
    // and a login can both match in one tick).
    this._proposing ??= new Set();
    if (this._proposing.has(resident.id)) return;
    this._proposing.add(resident.id);
    try {
      const label = this._residentLabel(resident);
      const who = actorId ? (game.actors?.get(actorId)?.name || 'an operator') : 'the system clock';

      // `residentFireMode` — default 'auto' (fire + tell the GM); a table that
      // wants the pause-for-the-netrun prompt sets it to 'propose'.
      let mode = 'auto';
      try { mode = game.settings.get(MODULE_ID, 'residentFireMode') || 'auto'; } catch { /* not registered */ }

      if (mode === 'manual') {
        // Never prompt: it stays armed until the GM fires it from Admin → Security.
        ui.notifications.info(`NCM | "${label}" triggered on ${item.name} — armed and waiting (fire it from Admin → Security).`);
        return;
      }
      if (mode === 'auto') {
        await this.fireResident(item, resident, { accountId, actorId });
        return;
      }

      const choice = await (async () => {
        const { runResidentConsole } = await import('../ui/content/ResidentConsole.js');
        return runResidentConsole({
          label, resident, hostName: item.name, who,
          mailbox: this.getAccount(item, resident.params?.accountId || accountId)?.displayName || '',
          // Inherit the machine's own preset when a viewer of it is open.
          host: this._openViewerElement(item),
        });
      })();
      // The resident may have been fired/defused elsewhere while the prompt sat open.
      const fresh = this.getResidents(item).find(r => r.id === resident.id);
      if (!fresh || fresh.state !== 'armed') return;
      if (choice === 'fire') await this.fireResident(item, resident, { accountId, actorId });
      else if (choice === 'defuse') {
        await this.updateResident(item, resident.id, { state: 'defused' });
        ui.notifications.info(`NCM | Resident "${label}" defused.`);
      } else {
        // Later → snooze so a 60s reaper (or a re-login) doesn't re-prompt at once.
        await this.updateResident(item, resident.id, { snoozeUntil: this._nowMs() + 10 * 60 * 1000 });
      }
    } finally {
      this._proposing.delete(resident.id);
    }
  }

  /**
   * Fire a resident's effect (GM-side). Routes the effect type through the shared
   * effect engine (`_fireResidentEffect`), marks the resident fired, logs + alerts.
   * PLANT / keylog / forgeAccount / deployICE / logicBomb are native (thread 6);
   * an unknown type honestly degrades to a GM-adjudicate alert.
   * @param {Item} item @param {object} resident @param {object} [ctx] { accountId, actorId }
   */
  async fireResident(item, resident, { accountId, actorId } = {}) {
    if (!isGM()) return { success: false };
    const label = this._residentLabel(resident);
    let report = '';
    const out = {};   // captures a planted message's id/account (plant verb) for the OPS "go to" link
    try {
      report = await this._fireResidentEffect(item, resident.effectType, resident.params || {}, {
        accountId, actorId, resident, out,
      });
    } catch (err) { log.error(`Fire resident failed: ${err.message}`); report = `error: ${err.message}`; }

    await this.updateResident(item, resident.id, {
      state: 'fired', firedAt: new Date().toISOString(),
      ...(out.messageId ? { firedMessageId: out.messageId, firedAccountId: out.accountId } : {}),
    });
    // Activity feed — a resident firing is a notable event (no heat; the trace was
    // already paid at upload/arming time).
    game.nightcity?.traceService?.logSuccess({ actor: game.actors?.get(resident.provenance?.plantedBy), action: `${resident.effectType || 'resident'}-fired`, source: label, hostItem: item, severity: 'hostile' });
    this._residentGmAlert(`Resident "${label}" fired on ${item.name} — ${report}.`);
    log.debug(`Resident fired: ${label} on ${item.name} — ${report}`);
    return { success: true, report };
  }

  /**
   * The shared effect engine for triggered residents (design §1, thread 6). Given
   * an effect type + params, applies it and returns a human report string. Split
   * out of `fireResident` so `logicBomb` can run an INNER effect through the same
   * switch without re-marking the outer resident.
   * @private
   * @param {Item} item
   * @param {string} effectType
   * @param {object} params
   * @param {object} ctx { accountId?, actorId?, resident? }
   * @returns {Promise<string>} report
   */
  async _fireResidentEffect(item, effectType, params = {}, ctx = {}) {
    const { accountId, actorId, resident } = ctx;
    switch (effectType) {
      case 'plant': {
        const targetAcct = params.accountId || accountId;
        if (targetAcct && params.entry) {
          const res = await this.addAccountMessage(item, targetAcct, foundry.utils.deepClone(params.entry));
          // Record where the planted file landed so the OPS "active programs" row can jump to it.
          if (ctx.out && res?.messageId) { ctx.out.messageId = res.messageId; ctx.out.accountId = targetAcct; }
          return res?.success
            ? `planted "${params.entry.subject || 'a file'}" in ${this.getAccount(item, targetAcct)?.displayName || targetAcct}'s mailbox`
            : `plant failed: ${res?.error || 'unknown'}`;
        }
        return 'plant had no target account or entry';
      }

      case 'forgeAccount': {
        // Write a hidden backdoor account and hand the creds to whoever planted it.
        const runner = game.actors?.get(resident?.provenance?.plantedBy) || (actorId ? game.actors?.get(actorId) : null);
        const res = await this.forgeBackdoorAccount(item, { actor: runner, params });
        return res?.success
          ? `forged backdoor account "${res.username}" (${res.expiresLabel})`
          : `backdoor forge failed: ${res?.error || 'unknown'}`;
      }

      case 'keylog': {
        // The trigger IS the capture: whoever's login fired this resident is the
        // captured session. Hand the account (+ operator) to the runner as a
        // usable credential lead (they can type the username at secret-login).
        const acct = this.getAccount(item, accountId);
        const who = actorId ? (game.actors?.get(actorId)?.name || 'an operator') : 'someone';
        const uname = acct?.username || accountId || 'unknown';
        const runner = game.actors?.get(resident?.provenance?.plantedBy);
        const capture = `KEYLOG // ${item.name}: ${who} logged into "${uname}"`;
        this._deliverToRunner(runner, `<b>NCM keylog:</b> ${capture}. Type <b>${uname}</b> at "Log in with another account" to reach that mailbox.`);
        return `captured login "${uname}" (${who})`;
      }

      case 'deployICE': {
        // Bite the intruder whose login fired it. Runner-brought ICE
        // (params.iceActorId) wins; else the box's own configured ICE; else it
        // honestly degrades (no ICE to loose).
        const victim = actorId ? game.actors?.get(actorId) : null;
        if (!victim) return 'no intruder to bite (ICE stays armed for the next login)';
        const iceCfg = this._resolveDeployIce(item, params, accountId);
        if (!iceCfg) return 'no Black ICE available on this box — GM to adjudicate';
        try {
          await game.nightcity?.iceService?.applyDamage(victim,
            { encryptionType: 'BLACK_ICE', ice: iceCfg },
            { context: 'terminal', targetName: this._residentLabel(resident) });
          return `Black ICE struck ${victim.name}`;
        } catch (err) { log.error(`deployICE bite failed: ${err.message}`); return `ICE failed to fire: ${err.message}`; }
      }

      case 'logicBomb': {
        // A timed single-effect bomb: run its ONE inner effect through this same
        // engine. No nesting (an inner logicBomb is refused) — the recursion fence
        // from the design (decision #6).
        const inner = params.inner || {};
        if (!inner.effectType) return 'logic bomb had no payload';
        if (inner.effectType === 'logicBomb') return 'logic bomb refused to nest another logic bomb';
        const innerReport = await this._fireResidentEffect(item, inner.effectType, inner.params || {}, ctx);
        return `logic bomb detonated → ${innerReport}`;
      }

      default:
        return `resident effect "${effectType}" — GM to adjudicate`;
    }
  }

  /**
   * Resolve the ICE config for a deployICE resident. Runner-brought
   * (params.iceActorId) takes precedence; otherwise the box's own ICE from the
   * logged-into account's security block (or any account that has one). Returns an
   * ICEService-shaped `{ source, actorId, ... }` or null when the box has none.
   * @private
   */
  _resolveDeployIce(item, params = {}, accountId = null) {
    if (params.iceActorId) return { source: 'actor', actorId: params.iceActorId };
    const accts = this.getConfig(item).accounts || [];
    const scoped = accountId ? accts.find(a => a.id === accountId) : null;
    const pick = (a) => {
      const ice = a?.security?.ice;
      if (!ice) return null;
      if (ice.source === 'actor' && ice.actorId) return ice;
      if (ice.source && ice.source !== 'default') return ice; // custom-named ICE
      return null;
    };
    return pick(scoped) || accts.map(pick).find(Boolean) || null;
  }

  /**
   * Forge a hidden backdoor account on a terminal (the forgeAccount verb, shared by
   * the instant deploy path in SiphonFlow and the triggered resident path here).
   * The account is HIDDEN (reachable only via secret-login by typing its username)
   * and password-protected, so the creds are a real usable pair. It carries a
   * `forged` provenance block with a game-time expiry (canon: implanted commands
   * last ~24h) that `reapForgedAccounts` sweeps. GM-only.
   * @param {Item} item @param {object} a { actor, params:{ username?, password?, admin?, ttlHours?, displayName? } }
   * @returns {Promise<{ success:boolean, username?:string, password?:string, expiresLabel?:string, error?:string }>}
   */
  async forgeBackdoorAccount(item, { actor = null, params = {} } = {}) {
    if (!isGM()) return { success: false, error: 'GM only' };
    if (!this.isTerminal(item)) return { success: false, error: 'Not a terminal' };
    try {
      const username = (params.username || `bd_${generateId().slice(0, 5)}`).toLowerCase();
      const password = params.password || this._genBackdoorPassword();
      // 0 / negative ttl = permanent-until-found; else a game-time expiry.
      const ttlHours = params.ttlHours === undefined ? 24 : Number(params.ttlHours);
      const expiresAt = ttlHours > 0 ? this._nowMs() + ttlHours * 3600000 : null;
      const account = {
        username,
        displayName: params.displayName || 'System Service',
        isAdmin: !!params.admin,
        hidden: true,
        role: 'Service Account',
        clearance: params.admin ? 'ROOT' : 'SERVICE',
        security: {
          allowPassword: true, password,
          allowSkillCheck: false, allowKeyItem: false,
          authLogic: 'any', maxAttempts: 3, lockoutDuration: 3600000,
          failureMode: 'lockout', encryptionType: 'ICE',
          ice: { source: 'default', actorId: null },
        },
        forged: {
          by: actor?.id || null, byName: actor?.name || 'Unknown',
          at: new Date(this._nowMs()).toISOString(),
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        },
      };
      const res = await this.addAccount(item, account);
      if (!res?.success) return { success: false, error: res?.error || 'add failed' };
      const expiresLabel = expiresAt ? `expires in ~${ttlHours}h` : 'permanent until found';
      // Hand the creds to the runner (their Agent) + alert the GM.
      this._deliverToRunner(actor,
        `<b>NCM backdoor:</b> account <b>${username}</b> / <b>${password}</b> on ${item.name} (${expiresLabel}). Reach it via "Log in with another account".`);
      return { success: true, username, password, expiresLabel };
    } catch (err) { log.error(`forgeBackdoorAccount failed: ${err.message}`); return { success: false, error: err.message }; }
  }

  /** @private A short, typeable backdoor password (word + digits). */
  _genBackdoorPassword() {
    const words = ['ghost', 'raven', 'shard', 'neon', 'wire', 'dusk', 'vault', 'echo', 'kilo', 'onyx'];
    const w = words[Math.floor((this._nowMs() % words.length))];
    return `${w}${100 + (this._nowMs() % 900)}`;
  }

  /**
   * Deliver a security payoff (keylog capture, backdoor creds) to the runner who
   * planted it — a whisper to that actor's owning users (+ the GM). Falls back to a
   * GM-only whisper when the runner has no online owner.
   * @private @param {Actor|null} runner @param {string} html
   */
  _deliverToRunner(runner, html) {
    try {
      const gmIds = game.users?.filter(u => u.isGM).map(u => u.id) ?? [];
      const ownerIds = runner
        ? (game.users?.filter(u => !u.isGM && runner.testUserPermission?.(u, 'OWNER')).map(u => u.id) ?? [])
        : [];
      const whisper = [...new Set([...gmIds, ...ownerIds])];
      ChatMessage.create({ content: html, whisper: whisper.length ? whisper : gmIds });
    } catch (err) { log.warn(`Runner delivery failed: ${err.message}`); }
  }

  /**
   * GM reaper — remove forged backdoor accounts whose game-time expiry has passed
   * (canon: implanted commands are temporary). Runs on the resident-reaper cadence.
   * Honors the time provider, so a paused/rewound clock is respected.
   */
  async reapForgedAccounts() {
    if (!isGM()) return;
    const now = this._nowMs();
    for (const item of game.items) {
      if (!this.isTerminal(item)) continue;
      const accts = this.getConfig(item).accounts || [];
      const expired = accts.filter(a => {
        const at = a?.forged?.expiresAt;
        return at && Date.parse(at) <= now;
      });
      for (const a of expired) {
        await this.removeAccount(item, a.id);
        this._residentGmAlert(`Backdoor account "${a.username}" on ${item.name} expired and was closed.`);
        log.debug(`Forged account "${a.username}" expired on ${item.name}`);
      }
    }
  }

  /** @private Short human label for a resident. */
  _residentLabel(resident) {
    const names = { plant: 'planted file', keylog: 'keylogger', forgeAccount: 'backdoor account', logicBomb: 'logic bomb', deployICE: 'Black ICE', adjudicate: 'program' };
    return resident?.params?.name || names[resident?.effectType] || 'resident program';
  }

  /** @private GM-only toast + whisper (the durable trace log lands in thread 4). */
  _residentGmAlert(msg) {
    try {
      ui.notifications.info(`NCM | ${msg}`);
      const gmIds = game.users?.filter(u => u.isGM).map(u => u.id) ?? [];
      if (gmIds.length) {
        const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        ChatMessage.create({ content: `<b>NCM resident:</b> ${esc(msg)}`, whisper: gmIds });
      }
    } catch (err) { log.warn(`Resident GM alert failed: ${err.message}`); }
  }

  /** @private Current time via the provider (honors paused/rewound world clock). */
  _nowMs() { try { return this.timeService?.getCurrentTimeMs?.() ?? Date.now(); } catch { return Date.now(); } }

  /**
   * GM reaper — fire onDate residents whose scheduled time has passed. Runs on the
   * payload-reaper cadence (registered in registerTerminalSystem). Times go through
   * the time provider, so a paused/rewound world clock is honored; each match routes
   * through the same GM-gated proposal (which snoozes on "Later" so this 60s poll
   * doesn't re-prompt).
   */
  async reapResidents() {
    if (!isGM()) return;
    const now = this._nowMs();
    for (const item of game.items) {
      if (!this.isTerminal(item)) continue;
      const due = this.getResidents(item).filter(r =>
        r.state === 'armed' && r.trigger?.kind === 'onDate' &&
        Number(r.trigger.atMs) && Number(r.trigger.atMs) <= now &&
        (!r.snoozeUntil || r.snoozeUntil <= now));
      for (const r of due) await this._proposeResidentFire(item, r, {});
    }
  }

  /**
   * onAction trigger — a resident armed to fire on a specific action (siphon /
   * exfil / …). Call this GM-side after such an action lands on a terminal.
   * @param {Item} item @param {string} action @param {object} [ctx] { actorId }
   */
  async checkActionResidents(item, action, { actorId } = {}) {
    if (!isGM() || !this.isTerminal(item)) return;
    const now = this._nowMs();
    const matches = this.getResidents(item).filter(r =>
      r.state === 'armed' && r.trigger?.kind === 'onAction' && r.trigger.action === action &&
      (!r.trigger.actorId || r.trigger.actorId === actorId) &&
      (!r.snoozeUntil || r.snoozeUntil <= now));
    for (const r of matches) await this._proposeResidentFire(item, r, { actorId });
  }

  /**
   * onHeat trigger — a resident armed to fire once the operator's heat on THIS
   * box reaches a threshold ("when they're running hot enough to be desperate").
   * Driven from the trace funnel, which is where heat actually moves, so it is
   * checked after both a tripped defense and a clean action.
   * @param {Item} item @param {number} heat current decayed heat for this operator
   * @param {object} [ctx] { actorId }
   */
  async checkHeatResidents(item, heat, { actorId } = {}) {
    if (!isGM() || !this.isTerminal(item)) return;
    const now = this._nowMs();
    const level = Number(heat) || 0;
    const matches = this.getResidents(item).filter(r =>
      r.state === 'armed' && r.trigger?.kind === 'onHeat' &&
      level >= (Number(r.trigger.atLeast) || 0) &&
      (!r.trigger.actorId || r.trigger.actorId === actorId) &&
      (!r.snoozeUntil || r.snoozeUntil <= now));
    for (const r of matches) await this._proposeResidentFire(item, r, { actorId });
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
      participants: Array.isArray(data.participants) ? data.participants : [],
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
      // Custom-folder membership ('' / 'inbox' = the Inbox). The system
      // locations 'saved'/'trash' translate to their status flags instead
      // (location semantics — the Move-to model). Unknown ids fall back to
      // the Inbox at read time, so deleting a folder never hides mail.
      folder: ['inbox', 'saved', 'trash'].includes(data.folder) ? '' : (data.folder || ''),
      status: {
        read: data.status?.read || false,
        // Honor the caller (the composer files straight into Saved/Trash) —
        // hardcoding these false is the field-by-field gotcha that ate spam.
        saved: data.status?.saved || data.folder === 'saved' || false,
        spam: false,
        encrypted: !!data.encryption || false,
        infected: false,
        deleted: data.status?.deleted || data.folder === 'trash' || false,
        sent: false,
        scheduled: false,
        // AUDIT (2026-07-13): these were hardcoded false/null — the same
        // field-by-field gotcha. An exfil/mirror copy of an already-claimed
        // eddies drop must stay claimed, or the money is claimable twice.
        eddiesClaimed: data.status?.eddiesClaimed || false,
        eddiesClaimedAt: data.status?.eddiesClaimedAt || null,
      },
      encryption: data.encryption || null,
      eddies: data.eddies || 0,
      selfDestruct: data.selfDestruct || null,
      // Typed content (design doc §8c) — null = ordinary message; set =
      // rendered via the shared content-body partial in the viewer.
      contentType: data.contentType || null,
      contentData: data.contentData || null,
      // ENVELOPE (#37) — 'mail' (default) or 'file': a machine artifact with a
      // filename/path/owner-node instead of a sender. `file` holds only what the
      // GM AUTHORED; everything else derives at read time (resolveEnvelope).
      envelope: data.envelope === 'file' ? 'file' : 'mail',
      file: data.file ? { ...data.file } : null,
      // Per-entry exfil override (#37) — layered over the terminal's policy by
      // TerminalService.resolveEntryExfil. null = inherit everything.
      exfil: data.exfil ? { ...data.exfil } : null,
      // Per-message network gating vs the TERMINAL's uplink (shard shape).
      // null = ungated. Exfil copies deliberately never carry it (a downloaded
      // file is local; MessageRepository.createMessage doesn't persist the key
      // and exfilToShard doesn't pass it).
      networkVisibility: data.networkVisibility || null,
      metadata: { ...(data.metadata || {}) },
      attachments: data.attachments || [],
      malware: null,
      accessControl: data.accessControl || null,
      anonymous: data.anonymous || null,
    };
  }

  /**
   * @private Human-readable page title. A FILE names itself off its filename —
   * a file has no sender, so the mail formatter would title it "Unknown".
   */
  _pageName(data) {
    if (data.envelope === 'file') {
      const name = data.file?.filename || suggestFilename(data.contentType, data.contentData || {}, data.subject);
      return `[FILE] ${name}`;
    }
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
