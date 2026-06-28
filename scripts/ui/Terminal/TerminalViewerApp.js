/**
 * TerminalViewerApp
 * @file scripts/ui/Terminal/TerminalViewerApp.js
 * @module cyberpunkred-messenger
 * @description The player-facing Terminal window — a converted item you "log
 *   into". Drives a state machine (boot → network gate → login → manual auth →
 *   mailbox), sources its message feed from the active account via
 *   TerminalService.getAccountMessages (the source-adapter seam), and reuses the
 *   shared security/network plumbing.
 *
 *   Extends BaseApplication directly (not MessageViewerApp): the terminal uses a
 *   bespoke template (ncm-term__ classes) and its own state machine, so forking
 *   the 5,000-line viewer's render/action path would couple more than it reuses.
 *   The MessageViewer `_createMessageSource()` seam remains the documented hook
 *   for a future shared base.
 *
 *   Auth (MVP): the SECURE SHELL console handles password + skill-bypass through
 *   SecurityService (per-account lockout, keyed `terminalId::accountId`) and
 *   SkillService. The full method-card dialog (key item, AND/OR, ICE panel) lands
 *   with the NetworkAuthDialog→SecurityAuthDialog refactor. Desktop form only
 *   (agent/phone → Phase 3); narrow windows reflow via the CSS container query.
 */

import { BaseApplication } from '../BaseApplication.js';
import { MODULE_ID, TERMINAL_PRESETS, SOCKET_OPS } from '../../utils/constants.js';
import { log, isGM, formatCyberDate } from '../../utils/helpers.js';
import { getInitials } from '../../utils/designHelpers.js';

const PRIORITY_ICONS = { critical: 'fa-triangle-exclamation', urgent: 'fa-circle-exclamation', normal: 'fa-circle-info' };

/** Delegate an AppV2 action to the bound instance method of the same name. */
function action(method) {
  return function (event, target) { return this[method]?.(event, target); };
}

export class TerminalViewerApp extends BaseApplication {

  static DEFAULT_OPTIONS = {
    id: 'ncm-terminal-viewer',
    classes: ['ncm-app', 'ncm-terminal-app'],
    position: { width: 900, height: 600 },
    window: { title: 'Terminal', icon: 'fas fa-terminal', resizable: true, minimizable: true },
    actions: {
      terminalSelectAccount: action('_onSelectAccount'),
      terminalManualLogin: action('_onManualLogin'),
      terminalManualAuth: action('_onManualAuth'),
      terminalSkillBypass: action('_onSkillBypass'),
      terminalKeyItem: action('_onKeyItem'),
      terminalBackToAccounts: action('_onBackToAccounts'),
      terminalSwitchNetwork: action('_onSwitchNetwork'),
      terminalSpoofNetwork: action('_onSpoofNetwork'),
      terminalForceUnlock: action('_onForceUnlock'),
      terminalToggleSwitcher: action('_onToggleSwitcher'),
      terminalSwitchAccount: action('_onSwitchAccount'),
      terminalLogout: action('_onLogout'),
      terminalFolder: action('_onFolder'),
      terminalSelectMessage: action('_onSelectMessage'),
      terminalAddContact: action('_onAddContact'),
      terminalExfilInbox: action('_onExfilInbox'),
      terminalExfilShard: action('_onExfilShard'),
      terminalPage: action('_onPage'),
      terminalConfigure: action('_onConfigure'),
      terminalNewMessage: action('_onNewMessage'),
      terminalEditMessage: action('_onEditMessage'),
      terminalDeleteMessage: action('_onDeleteMessage'),
    },
  };

  static PARTS = { main: { template: `modules/${MODULE_ID}/templates/terminal/terminal-viewer.hbs` } };

  // ─── Service accessors ───
  get terminalService() { return game.nightcity?.terminalService; }
  get networkService() { return game.nightcity?.networkService; }
  get skillService() { return game.nightcity?.skillService; }
  get securityService() { return game.nightcity?.securityService; }
  get iceService() { return game.nightcity?.iceService; }
  get portraitService() { return game.nightcity?.portraitService; }
  get masterContactService() { return game.nightcity?.masterContactService; }
  get contactRepository() { return game.nightcity?.contactRepository; }

  // ─── Instance state ───
  /** @type {string} boot | gate | login | manual | mailbox */
  _state = 'login';
  _accountId = null;          // active (logged-in) account
  _authAccountId = null;      // account currently being authenticated (manual state)
  _selectedMessageId = null;
  _currentFolder = 'inbox';
  _currentPage = 1;
  _switcherOpen = false;
  _manualError = '';
  _networkSpoofed = false;
  _bootPlayed = false;
  _grantedPlayed = false;
  _timers = [];

  constructor(options = {}) {
    super(options);
    this.item = options.item;
    this.actor = options.actor ?? game.user?.character ?? null;
    this.actorId = this.actor?.id ?? null;
    const cfg = this.terminalService?.getConfig(this.item);
    this._state = (cfg?.boot?.enabled) ? 'boot' : this._resolveEntryState();
  }

  /** @override — "{username} @ {ORG}" once in; "{ORG} — login" otherwise. */
  get title() {
    const name = this._terminalName();
    if (this._state === 'mailbox' && this._accountId) {
      const acct = this.terminalService?.getAccount(this.item, this._accountId);
      return `${acct?.username || 'user'} @ ${name}`;
    }
    return `${name} — login`;
  }

  // ═══════════════════════════════════════════════════════════
  //  Context
  // ═══════════════════════════════════════════════════════════

  /** @override */
  async _prepareContext() {
    const cfg = this.terminalService?.getConfig(this.item) ?? {};
    const preset = cfg.theme?.preset || cfg.preset || 'arasaka-workstation';
    const ctx = {
      preset,
      formFactor: cfg.formFactor || 'desktop',
      state: this._state,
      terminalName: this._terminalName(),
      presetIcon: TERMINAL_PRESETS[preset]?.icon || 'fas fa-server',
      banner: cfg.boot?.banner || this._terminalName(),
    };

    if (this._state === 'boot') {
      ctx.boot = this._bootContext(cfg, preset);
    } else if (this._state === 'gate') {
      Object.assign(ctx, this._gateContext(cfg));
    } else if (this._state === 'login') {
      Object.assign(ctx, this._loginContext(cfg));
    } else if (this._state === 'manual') {
      Object.assign(ctx, this._manualContext());
    } else if (this._state === 'granted') {
      const acct = this.terminalService?.getAccount(this.item, this._accountId) || {};
      ctx.account = {
        displayName: acct.displayName || acct.username || 'user',
        username: acct.username || '',
        role: acct.role || (acct.isAdmin ? 'ADMINISTRATOR' : ''),
        initials: getInitials(acct.displayName || acct.username || '?'),
        portrait: this._accountPortrait(acct),
      };
    } else {
      Object.assign(ctx, await this._mailboxContext(cfg));
    }
    return ctx;
  }

  _terminalName() {
    return this.terminalService?.getConfig(this.item)?.terminalName || this.item?.name || 'Terminal';
  }

  _bootContext(cfg, preset) {
    const boot = cfg.boot || {};
    return {
      boot: {
        icon: TERMINAL_PRESETS[preset]?.icon || 'fas fa-server',
        title: boot.title || this._terminalName(),
        subtitle: boot.subtitle || '',
        progressLabel: 'Establishing secure session...',
        animationStyle: boot.animationStyle || 'standard-fade',
        speed: boot.speed || 'normal',
        logLines: Array.isArray(boot.logLines) ? boot.logLines : [],
      },
    };
  }

  _gateContext(cfg) {
    const net = cfg.network || {};
    const required = (net.allowedNetworks || [])[0] || '';
    const reqName = this.networkService?.getNetwork?.(required)?.name || required || 'an authorized network';
    const currentId = this.networkService?.currentNetworkId;
    const allowedSet = new Set(net.allowedNetworks || []);
    const networks = (this.networkService?.getAvailableNetworks?.() || []).map(n => {
      const isCurrent = n.id === currentId;
      const isAllowed = allowedSet.size === 0 || allowedSet.has(n.id) || (net.allowedTypes || []).includes(n.type);
      const requiresAuth = n.security?.requiresAuth && !this.networkService?.isAuthenticated?.(n.id);
      let statusClass = 'deny', statusLabel = 'DENIED';
      if (isCurrent) { statusClass = 'conn'; statusLabel = 'CONNECTED'; }
      else if (isAllowed && requiresAuth) { statusClass = 'sec'; statusLabel = '<i class="fas fa-lock"></i> SECURED'; }
      else if (isAllowed) { statusClass = 'valid'; statusLabel = '<i class="fas fa-check"></i> VALID'; }
      const signal = n.signalStrength ?? 70;
      return {
        id: n.id, name: n.name, typeLabel: n.type || 'Subnet', signal,
        color: n.theme?.color || '#19f3f7', icon: `fas ${n.theme?.icon || 'fa-wifi'}`,
        isCurrent, isRequired: n.id === required, weak: signal < 50,
        statusClass, statusLabel,
      };
    });
    const skill = (cfg.network?.bypassSkills || [])[0];
    return {
      requiredNetwork: reqName,
      requiredSecured: true,
      networks,
      spoof: skill ? { skill, dv: cfg.network?.bypassDV ?? cfg.network?.signalThreshold ?? 18 } : null,
      isGM: isGM(),
    };
  }

  _loginContext(cfg) {
    const accounts = (this.terminalService?.getAccounts(this.item) || []).map(a => this._cardContext(a, cfg));
    const securedCount = accounts.filter(a => !a.isOpen).length;
    return {
      accounts,
      accountCount: accounts.length,
      secured: securedCount > 0,
      onlineCount: 0,
      iceWarning: this._iceWarning(cfg),
    };
  }

  _cardContext(account, cfg) {
    const security = account.security || {};
    // Truthful display: show the account's real security even for the GM (GM
    // bypasses on click via force-unlock, but the cards shouldn't all read "open").
    const requiresAuth = !!security.requiresAuth && !this.terminalService?.getState(this.item)?.gmBypassed;
    const methods = [];
    if (!requiresAuth) methods.push({ type: 'open', icon: 'fas fa-lock-open', label: 'Open — no login' });
    else {
      if (security.allowPassword ?? security.password) methods.push({ type: 'lock', icon: 'fas fa-lock', label: 'Password' });
      if (security.allowSkillCheck) methods.push({ type: 'skill', icon: 'fas fa-dice-d20', label: 'Skill' });
      if (security.allowKeyItem) methods.push({ type: 'lock', icon: 'fas fa-id-card', label: 'Key' });
      if (!methods.length) methods.push({ type: 'lock', icon: 'fas fa-lock', label: 'Secured' });
    }
    return {
      id: account.id,
      displayName: account.displayName || account.username || 'Account',
      username: account.username || '',
      role: account.role || (account.isAdmin ? 'ADMINISTRATOR' : ''),
      portrait: this._accountPortrait(account),
      initials: getInitials(account.displayName || account.username || '?'),
      isAdmin: !!account.isAdmin,
      isDefault: account.id === cfg.defaultAccountId,
      isOpen: !requiresAuth,
      isSelected: account.id === this._authAccountId,
      lastLogin: '',
      wmarkIcon: account.isAdmin ? 'fas fa-user-gear' : 'fas fa-user',
      authMethods: methods,
      tooltip: requiresAuth ? 'Requires authentication' : 'Open account',
    };
  }

  _manualContext() {
    const account = this._authAccountId ? this.terminalService?.getAccount(this.item, this._authAccountId) : null;
    const security = account?.security || {};
    const skill = (security.bypassSkills || [])[0];
    const lockout = account && this.actorId
      ? this.terminalService?.isAccountLockedOut(this.item, account.id, this.actorId)
      : false;
    return {
      shellHost: (this._terminalName() || 'terminal').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      account: account ? { username: account.username, displayName: account.displayName } : null,
      prefillUsername: '',
      skillBypass: (account && security.allowSkillCheck && skill) ? { skill, dv: security.bypassDC ?? 15 } : null,
      keyItemBypass: (account && security.allowKeyItem && security.keyItemName) ? { name: security.keyItemName } : null,
      error: this._manualError,
      lockout,
    };
  }

  async _mailboxContext(cfg) {
    const account = this.terminalService?.getAccount(this.item, this._accountId);
    const all = this.terminalService?.getAccountMessages(this.item, this._accountId) || [];

    // Folder filters.
    const inFolder = {
      inbox: m => !m.status?.deleted && !m.status?.sent,
      saved: m => m.status?.saved && !m.status?.deleted,
      trash: m => !!m.status?.deleted,
    };
    const counts = {
      inbox: all.filter(inFolder.inbox).length,
      saved: all.filter(inFolder.saved).length,
      trash: all.filter(inFolder.trash).length,
    };
    const folder = inFolder[this._currentFolder] ? this._currentFolder : 'inbox';
    const list = all.filter(inFolder[folder]);

    if (this._selectedMessageId && !list.find(m => m.messageId === this._selectedMessageId)) this._selectedMessageId = null;
    if (!this._selectedMessageId && list.length) this._selectedMessageId = list[0].messageId;

    // Pagination.
    const PAGE = TerminalViewerApp.PAGE_SIZE;
    const maxPage = Math.max(1, Math.ceil(list.length / PAGE));
    if (this._currentPage > maxPage) this._currentPage = maxPage;
    if (this._currentPage < 1) this._currentPage = 1;
    const start = (this._currentPage - 1) * PAGE;
    const pageItems = list.slice(start, start + PAGE);

    const messages = pageItems.map(m => ({
      messageId: m.messageId,
      from: m.from || 'unknown',
      subject: m.subject || '(no subject)',
      priority: m.priority || 'normal',
      encrypted: !!m.status?.encrypted,
      isSelected: m.messageId === this._selectedMessageId,
    }));

    const emptyLabels = { inbox: 'Inbox is empty', saved: 'No saved messages', trash: 'Trash is empty' };
    const folderLabels = { inbox: 'INBOX', saved: 'SAVED', trash: 'TRASH' };
    const selected = list.find(m => m.messageId === this._selectedMessageId);
    const netName = this.networkService?.currentNetwork?.name || 'OFFLINE';
    return {
      hud: { netName, isAdmin: !!account?.isAdmin, trace: null },
      account: {
        displayName: account?.displayName || account?.username || 'user',
        username: account?.username || '',
        initials: getInitials(account?.displayName || account?.username || '?'),
        portrait: this._accountPortrait(account || {}),
      },
      switchAccounts: this._switcherOpen ? this._switcherAccounts() : [],
      switcherOpen: this._switcherOpen,
      folders: [
        { key: 'inbox', label: 'Inbox', icon: 'fas fa-inbox', count: counts.inbox, active: folder === 'inbox' },
        { key: 'saved', label: 'Saved', icon: 'fa-regular fa-star', count: counts.saved, active: folder === 'saved' },
        { key: 'trash', label: 'Trash', icon: 'fas fa-trash-can', count: counts.trash, active: folder === 'trash' },
      ],
      listLabel: `${folderLabels[folder]} · ${list.length} MESSAGE${list.length === 1 ? '' : 'S'}`,
      emptyLabel: emptyLabels[folder],
      messages,
      pagination: maxPage > 1 ? { page: this._currentPage, maxPage, hasPrev: this._currentPage > 1, hasNext: this._currentPage < maxPage } : null,
      isGM: isGM(),
      selectedMessage: selected ? this._detailContext(selected) : null,
      allowExfil: cfg.allowExfil !== false,
    };
  }

  static PAGE_SIZE = 12;

  _switcherAccounts() {
    return (this.terminalService?.getAccounts(this.item) || []).map(a => {
      const isCurrent = a.id === this._accountId;
      const gmBypassed = this.terminalService?.getState(this.item)?.gmBypassed;
      const open = !a.security?.requiresAuth || gmBypassed;
      let statusLabel = 'current';
      if (!isCurrent) statusLabel = open ? 'open' : '<i class="fas fa-lock"></i> re-auth';
      return {
        id: a.id, displayName: a.displayName || a.username,
        initials: getInitials(a.displayName || a.username || '?'),
        portrait: this._accountPortrait(a), isCurrent, isOpen: open && !isCurrent, statusLabel,
      };
    });
  }

  _detailContext(msg) {
    const senderName = this._resolveSenderName(msg);
    const contact = this._findContactByEmail(msg.from);
    const priority = msg.priority || 'normal';
    return {
      messageId: msg.messageId,
      subject: msg.subject || '(no subject)',
      classification: msg.metadata?.classification || '',
      sender: {
        name: senderName,
        email: msg.from || '',
        initials: getInitials(senderName),
        portrait: contact ? this.portraitService?.resolvePortrait(contact) : (msg.fromActorId ? this.portraitService?.resolvePortrait({ actorId: msg.fromActorId }) : null),
      },
      isContact: !!contact,
      timeAgo: this._relativeTime(msg.timestamp),
      timeAbs: this._absDate(msg.timestamp),
      priority,
      priorityLabel: priority.toUpperCase(),
      priorityIcon: PRIORITY_ICONS[priority] || PRIORITY_ICONS.normal,
      network: this.networkService?.getNetwork?.(msg.network)?.name || msg.network || 'CITINET',
      bodyHtml: this._sanitizeBody(msg.body || ''),
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  Render — boot animation + window title + switcher outside-click
  // ═══════════════════════════════════════════════════════════

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    // Theme the window by preset (CSS palette fallback; full theming later).
    this.element?.querySelector('.ncm-terminal-viewer')?.setAttribute('data-terminal-preset', context.preset);
    this._syncWindowTitle(context);
    if (this._state === 'boot') this._playBoot();
    if (this._state === 'granted' && !this._grantedPlayed) {
      this._grantedPlayed = true;
      this._timer(() => { this._grantedPlayed = false; this._enterState('mailbox'); }, 1500);
    }
    // Enter-to-submit in the auth console.
    if (this._state === 'manual') {
      const pass = this.element?.querySelector('input[name="manualPassword"]');
      pass?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this._onManualAuth(); } });
    }
  }

  /** Re-skin the AppV2 window title with the colored {user} @ {ORG} treatment. */
  _syncWindowTitle(context) {
    const el = this.element?.querySelector('.window-title');
    if (!el) return;
    const name = this._terminalName();
    if (this._state === 'mailbox' && this._accountId) {
      const acct = this.terminalService?.getAccount(this.item, this._accountId);
      el.innerHTML = `<span class="ncm-term__title-user">${Handlebars.escapeExpression(acct?.username || 'user')}</span><span class="ncm-term__title-at">@</span><span class="ncm-term__title-org">${Handlebars.escapeExpression(name)}</span>`;
    } else {
      el.innerHTML = `<span class="ncm-term__title-org">${Handlebars.escapeExpression(name)}</span><span class="ncm-term__title-at"> — login</span>`;
    }
  }

  _playBoot() {
    if (this._bootPlayed) return;
    this._bootPlayed = true;
    const bootEl = this.element?.querySelector('.ncm-term__boot');
    if (!bootEl) { this._afterBoot(); return; }
    this.soundService?.play?.('shard-boot');
    const fill = bootEl.querySelector('.ncm-term__boot-fill');
    requestAnimationFrame(() => { if (fill) fill.style.width = '100%'; });
    bootEl.querySelectorAll('.ncm-term__boot-log div').forEach((d, i) => {
      this._timer(() => { d.style.opacity = '1'; }, 400 + i * 240);
    });
    this._timer(() => {
      bootEl.style.transition = 'opacity .4s'; bootEl.style.opacity = '0';
      this._timer(() => this._afterBoot(), 420);
    }, 2100);
  }

  _afterBoot() { this._enterState(this._resolveEntryState()); }

  // ═══════════════════════════════════════════════════════════
  //  State machine
  // ═══════════════════════════════════════════════════════════

  _resolveEntryState() {
    const net = this.terminalService?.checkNetworkAccess(this.item) ?? { allowed: true };
    if (!net.allowed && !this._networkSpoofed) return 'gate';
    return 'login';
  }

  _enterState(state) {
    this._state = state;
    this._switcherOpen = false;
    this.render(false);
  }

  // ═══════════════════════════════════════════════════════════
  //  Actions — login / auth
  // ═══════════════════════════════════════════════════════════

  _onSelectAccount(event, target) {
    const id = target?.dataset?.accountId;
    if (!id) return;
    if (!this.terminalService.requiresAuth(this.item, id, this.actorId)) {
      this._loginSuccess(id);
    } else {
      this._authAccountId = id;
      this._manualError = '';
      this._enterState('manual');
    }
  }

  _onManualLogin() { this._authAccountId = null; this._manualError = ''; this._enterState('manual'); }
  _onBackToAccounts() { this._authAccountId = null; this._manualError = ''; this._enterState('login'); }

  /** Resolve the account being authed: bound (card) or typed username (secret). */
  _resolveAuthAccount() {
    if (this._authAccountId) return this.terminalService.getAccount(this.item, this._authAccountId);
    const uname = this.element?.querySelector('input[name="manualUsername"]')?.value?.trim().toLowerCase();
    if (!uname) return null;
    return (this.terminalService.getAccounts(this.item, { includeHidden: true }) || [])
      .find(a => (a.username || '').toLowerCase() === uname) || null;
  }

  async _onManualAuth() {
    const account = this._resolveAuthAccount();
    if (!account) { this._manualError = 'No such account.'; return this.render(false); }
    if (this.terminalService.isAccountLockedOut(this.item, account.id, this.actorId)) {
      this._manualError = 'Account locked out. Try again later.'; return this.render(false);
    }
    const password = this.element?.querySelector('input[name="manualPassword"]')?.value ?? '';
    const expected = account.security?.password ?? '';
    if (account.security?.allowPassword && expected && password === expected) {
      return this._loginSuccess(account.id);
    }
    this._failAuth(account);
  }

  async _onSkillBypass() {
    const account = this._resolveAuthAccount();
    if (!account || !this.actor) { this._manualError = 'No character to roll with.'; return this.render(false); }
    if (this.terminalService.isAccountLockedOut(this.item, account.id, this.actorId)) {
      this._manualError = 'Account locked out.'; return this.render(false);
    }
    const skill = (account.security?.bypassSkills || [])[0];
    const dc = account.security?.bypassDC ?? 15;
    try {
      const result = await this.skillService.performCheck(this.actor, skill, { dc, flavor: 'Terminal Bypass' });
      if (result?.success) return this._loginSuccess(account.id);
    } catch (err) { log.error(`Terminal skill bypass failed: ${err.message}`); }
    this._failAuth(account);
  }

  async _onKeyItem() {
    const account = this._resolveAuthAccount();
    if (!account) { this._manualError = 'No such account.'; return this.render(false); }
    if (this.terminalService.isAccountLockedOut(this.item, account.id, this.actorId)) {
      this._manualError = 'Account locked out.'; return this.render(false);
    }
    if (!this.actor) { this._manualError = 'No character — no inventory to check.'; return this.render(false); }
    const want = (account.security?.keyItemName || '').trim().toLowerCase();
    const tag = account.security?.keyItemTag || '';
    const has = this.actor.items?.find(i =>
      (tag && i.getFlag(MODULE_ID, 'keyTag') === tag) ||
      (want && (i.name || '').trim().toLowerCase() === want));
    if (has) return this._loginSuccess(account.id);
    this._failAuth(account);
  }

  _failAuth(account) {
    const res = this.terminalService.recordLoginFailure(this.item, account.id, this.actorId);
    this.soundService?.play?.('hack-fail');
    // ICE on failure mode === 'damage'
    if (account.security?.failureMode === 'damage' && this.actor) {
      try { this.iceService?.applyDamage?.(this.actor, account.security); } catch { /* non-fatal */ }
    }
    this._manualError = res.lockedOut
      ? 'ACCESS DENIED — account locked out.'
      : `ACCESS DENIED — ${res.attemptsRemaining} attempt${res.attemptsRemaining === 1 ? '' : 's'} left.`;
    this.render(false);
  }

  async _loginSuccess(accountId) {
    await this.terminalService.recordLoginSuccess(this.item, accountId, this.actorId);
    this._accountId = accountId;
    this._authAccountId = null;
    this._manualError = '';
    this._selectedMessageId = null;
    this._currentFolder = 'inbox';
    this._currentPage = 1;
    this.soundService?.play?.('shard-decrypt');
    // Brief ACCESS GRANTED / Welcome flourish, then into the mailbox.
    this._enterState('granted');
  }

  // ═══════════════════════════════════════════════════════════
  //  Actions — network gate
  // ═══════════════════════════════════════════════════════════

  async _onSwitchNetwork(event, target) {
    const id = target?.dataset?.networkId;
    if (!id) return;
    await this.networkService?.switchNetwork?.(id);
    this._enterState(this._resolveEntryState());
  }

  async _onSpoofNetwork() {
    if (!this.actor) return ui.notifications.warn('No character to roll with.');
    const cfg = this.terminalService.getConfig(this.item);
    const skill = (cfg.network?.bypassSkills || [])[0] || 'Interface';
    const dc = cfg.network?.bypassDV ?? 18;
    try {
      const result = await this.skillService.performCheck(this.actor, skill, { dc, flavor: 'Network Spoof' });
      if (result?.success) { this._networkSpoofed = true; this._enterState('login'); return; }
      ui.notifications.warn('Network spoof failed.');
    } catch (err) { log.error(`Network spoof failed: ${err.message}`); }
  }

  async _onForceUnlock() {
    if (!isGM()) return;
    await this.terminalService.forceUnlock(this.item);
    this._enterState(this._resolveEntryState());
  }

  // ═══════════════════════════════════════════════════════════
  //  Actions — mailbox
  // ═══════════════════════════════════════════════════════════

  _onToggleSwitcher() { this._switcherOpen = !this._switcherOpen; this.render(false); }

  _onSwitchAccount(event, target) {
    const id = target?.dataset?.accountId;
    if (!id || id === this._accountId) { this._switcherOpen = false; return this.render(false); }
    this._switcherOpen = false;
    if (!this.terminalService.requiresAuth(this.item, id, this.actorId)) {
      this._loginSuccess(id);
    } else {
      this._authAccountId = id; this._manualError = ''; this._enterState('manual');
    }
  }

  async _onLogout() {
    await this.terminalService.logout(this.item, this.actorId);
    this._accountId = null;
    this._switcherOpen = false;
    this._enterState('login');
  }

  _onFolder(event, target) {
    this._currentFolder = target?.dataset?.folder || 'inbox';
    this._currentPage = 1;
    this._selectedMessageId = null;
    this.render(false);
  }

  _onPage(event, target) {
    const dir = target?.dataset?.dir;
    this._currentPage += (dir === 'next' ? 1 : -1);
    this.render(false);
  }

  _onSelectMessage(event, target) {
    this._selectedMessageId = target?.dataset?.messageId || null;
    this.render(false);
  }

  // ─── GM authoring (in-viewer) ───

  async _onConfigure() {
    const { TerminalConfigApp } = await import('./TerminalConfigApp.js');
    new TerminalConfigApp({ item: this.item }).render(true);
  }

  async _onNewMessage() {
    if (!isGM() || !this._accountId) return;
    const data = await this._messageDialog(null);
    if (!data) return;
    const { classification, ...rest } = data;
    await this.terminalService.addAccountMessage(this.item, this._accountId, { ...rest, metadata: classification ? { classification } : {} });
    this.render(false);
  }

  async _onEditMessage(event, target) {
    if (!isGM()) return;
    const id = target?.dataset?.messageId || this._selectedMessageId;
    const raw = (this.terminalService?.getAccountMessages(this.item, this._accountId) || []).find(m => m.messageId === id);
    if (!raw) return;
    const data = await this._messageDialog(raw);
    if (!data) return;
    await this.terminalService.updateAccountMessage(this.item, id, data);
    this.render(false);
  }

  async _onDeleteMessage(event, target) {
    if (!isGM()) return;
    const id = target?.dataset?.messageId || this._selectedMessageId;
    const ok = await Dialog.confirm({ title: 'Delete Message', content: '<p>Permanently delete this message from the terminal?</p>' });
    if (!ok) return;
    await this.terminalService.removeAccountMessage(this.item, id);
    if (this._selectedMessageId === id) this._selectedMessageId = null;
    this.render(false);
  }

  /** Shared GM compose/edit dialog. Returns message data or null. */
  async _messageDialog(msg) {
    const esc = (s) => Handlebars.escapeExpression(s ?? '');
    const prio = msg?.priority || 'normal';
    const content = `
      <div style="display:flex;flex-direction:column;gap:8px;font-family:var(--ncm-font-body,sans-serif)">
        <label>From <input type="text" name="from" value="${esc(msg?.from)}" placeholder="sender@domain"></label>
        <label>Subject <input type="text" name="subject" value="${esc(msg?.subject)}"></label>
        <label>Classification <input type="text" name="classification" value="${esc(msg?.metadata?.classification)}" placeholder="optional, e.g. CONFIDENTIAL"></label>
        <label>Priority
          <select name="priority">
            <option value="normal" ${prio === 'normal' ? 'selected' : ''}>Normal</option>
            <option value="urgent" ${prio === 'urgent' ? 'selected' : ''}>Urgent</option>
            <option value="critical" ${prio === 'critical' ? 'selected' : ''}>Critical</option>
          </select>
        </label>
        <label>Body <textarea name="body" rows="6">${esc(msg?.body)}</textarea></label>
      </div>`;
    let result = null;
    await new Promise((resolve) => {
      new Dialog({
        title: msg ? 'Edit Message' : 'New Message',
        content,
        buttons: {
          save: { label: msg ? 'Save' : 'Add', callback: (html) => {
            result = {
              from: html.find('[name="from"]').val(),
              subject: html.find('[name="subject"]').val(),
              classification: html.find('[name="classification"]').val(),
              priority: html.find('[name="priority"]').val(),
              body: html.find('[name="body"]').val(),
            };
          } },
          cancel: { label: 'Cancel' },
        },
        default: 'save',
        close: () => resolve(),
      }).render(true);
    });
    return result;
  }

  // ═══════════════════════════════════════════════════════════
  //  Actions — exfil / contacts
  // ═══════════════════════════════════════════════════════════

  async _onAddContact(event, target) {
    const msg = this._currentSelectedRaw();
    if (!msg || !this.actorId) return;
    const name = this._resolveSenderName(msg);
    const contact = this._findContactByEmail(msg.from);
    const portrait = msg.fromActorId ? this.portraitService?.resolvePortrait({ actorId: msg.fromActorId }) : null;
    try {
      await this.contactRepository?.addContact(this.actorId, {
        name, email: msg.from || '', actorId: msg.fromActorId || null, portrait: portrait || null,
      });
      ui.notifications.info(`Added ${name} to your contacts.`);
      this.render(false);
    } catch (err) { log.error(`Add-contact from terminal failed: ${err.message}`); }
  }

  async _onExfilInbox() {
    const msg = this._currentSelectedRaw();
    if (!msg) return;
    const targetId = await this._pickOwnedCharacter();
    if (!targetId) return;
    if (isGM()) {
      const res = await this.terminalService.exfilToInbox(this.item, this._accountId, [msg.messageId], targetId);
      const who = game.actors?.get(targetId)?.name || 'inbox';
      if (res.success) ui.notifications.info(`Copied to ${who}'s Agent (Recovered).`);
      else ui.notifications.warn(res.error || 'Exfil failed.');
    } else {
      // Player can't write the GM-owned inbox journal — relay to the GM.
      this._relayExfil({ dest: 'inbox', messageIds: [msg.messageId], targetActorId: targetId });
      ui.notifications.info('Download requested — check your Recovered folder.');
    }
  }

  /** Pick which owned character's Agent inbox to download into. */
  async _pickOwnedCharacter() {
    const owned = (game.actors?.contents ?? []).filter(a =>
      a.type === 'character' && (a.isOwner || a.hasPlayerOwner));
    if (!owned.length) { ui.notifications.warn('No owned character to download into.'); return null; }
    if (owned.length === 1) return owned[0].id;
    const options = owned.map(a => `<option value="${a.id}">${Handlebars.escapeExpression(a.name)}</option>`).join('');
    let picked = null;
    await new Promise((resolve) => {
      new Dialog({
        title: 'Download to Agent',
        content: `<p>Send to which character's inbox?</p><select style="width:100%">${options}</select>`,
        buttons: {
          ok: { label: 'Download', callback: (html) => { picked = html.find('select').val(); } },
          cancel: { label: 'Cancel' },
        },
        default: 'ok', close: () => resolve(),
      }).render(true);
    });
    return picked;
  }

  async _onExfilShard() {
    const msg = this._currentSelectedRaw();
    if (!msg) return;
    // Players pick from their OWN inventory; GMs can also target world items.
    const candidates = [...(this.actor?.items ?? []), ...(isGM() ? game.items.contents : [])].filter(Boolean);
    if (!candidates.length) return ui.notifications.warn('No item to burn onto.');
    const options = candidates.slice(0, 50).map(i => `<option value="${i.id}">${Handlebars.escapeExpression(i.name)}</option>`).join('');
    let pickedId = null;
    await new Promise((resolve) => {
      new Dialog({
        title: 'Burn to Data Shard',
        content: `<p>Pick an item to burn this message onto:</p><select style="width:100%">${options}</select>`,
        buttons: {
          burn: { label: 'Burn', callback: (html) => { pickedId = html.find('select').val(); } },
          cancel: { label: 'Cancel' },
        },
        default: 'burn', close: () => resolve(),
      }).render(true);
    });
    if (!pickedId) return;
    const target = candidates.find(i => i.id === pickedId);
    if (!isGM()) {
      // Player can't convert/write the GM-owned shard journal — relay to the GM.
      this._relayExfil({ dest: 'shard', messageIds: [msg.messageId], targetItemId: pickedId });
      return ui.notifications.info(`Burn requested for "${target.name}".`);
    }
    const res = await this.terminalService.exfilToShard(this.item, this._accountId, [msg.messageId], target);
    if (res.success) {
      ui.notifications.info(`Burned to "${target.name}".`);
      // Refresh the directory/sheets so a just-converted shard shows its badge now.
      setTimeout(() => {
        ui.items?.render();
        for (const sheet of Object.values(ui.windows)) {
          if (sheet.actor?.items?.has(target.id)) sheet.render(false);
        }
      }, 150);
    } else {
      ui.notifications.warn(res.error || 'Burn failed.');
    }
  }

  /** Send an exfil request to the GM client (player relay). */
  _relayExfil({ dest, messageIds, targetActorId, targetItemId }) {
    game.nightcity?.socketManager?.emit?.(SOCKET_OPS.TERMINAL_EXFIL_REQUEST, {
      requestId: foundry.utils.randomID(),
      userId: game.user.id,
      itemUuid: this.item?.uuid,
      accountId: this._accountId,
      messageIds, dest, targetActorId, targetItemId,
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  Helpers
  // ═══════════════════════════════════════════════════════════

  _currentSelectedRaw() {
    return (this.terminalService?.getAccountMessages(this.item, this._accountId) || [])
      .find(m => m.messageId === this._selectedMessageId) || null;
  }

  _accountPortrait(account) {
    if (!account) return null;
    if (account.masterContactId) {
      const c = this.masterContactService?.getContact(account.masterContactId);
      if (c) { const p = this.portraitService?.resolvePortrait(c); if (p) return p; }
    }
    return this.portraitService?.resolvePortrait({ portrait: account.portrait, actorId: account.actorId }) || null;
  }

  _resolveSenderName(msg) {
    if (msg.fromActorId) { const a = game.actors?.get(msg.fromActorId); if (a) return a.name; }
    if (msg.fromContactId) { const c = this.masterContactService?.getContact(msg.fromContactId); if (c) return c.name; }
    const contact = this._findContactByEmail(msg.from);
    if (contact) return contact.name;
    return msg.from || 'Unknown';
  }

  _findContactByEmail(email) {
    if (!email) return null;
    return this.masterContactService?.getByEmail?.(email) || null;
  }

  _iceWarning(cfg) {
    const armed = (this.terminalService?.getAccounts(this.item) || [])
      .some(a => a.security?.failureMode === 'damage');
    if (!armed) return '';
    const max = Math.min(...(this.terminalService.getAccounts(this.item).map(a => a.security?.maxAttempts ?? 3)));
    return `BLACK ICE armed · ${max} failed attempts triggers lockout`;
  }

  /** Absolute in-world date+time for a message, via the configured date format. */
  _absDate(iso) {
    if (!iso) return '';
    try { return formatCyberDate(iso); } catch { return ''; }
  }

  _relativeTime(iso) {
    if (!iso) return '';
    const now = game.nightcity?.timeService?.getCurrentTimeMs?.() ?? Date.now();
    const diff = now - new Date(iso).getTime();
    if (diff < 0) return 'scheduled';
    const m = 60000, h = 3600000, d = 86400000;
    if (diff < m) return 'just now';
    if (diff < h) return `${Math.floor(diff / m)}m ago`;
    if (diff < d) return `${Math.floor(diff / h)}h ago`;
    return `${Math.floor(diff / d)} day${Math.floor(diff / d) === 1 ? '' : 's'} ago`;
  }

  /** Minimal body sanitizer — strip tags, preserve text. Terminal MVP = plain. */
  _sanitizeBody(body) {
    const text = String(body).replace(/<[^>]*>/g, '');
    return Handlebars.escapeExpression(text).replace(/\n/g, '<br>');
  }

  _timer(fn, ms) { const t = setTimeout(fn, ms); this._timers.push(t); return t; }

  /** @override */
  async close(options) {
    this._timers.forEach(clearTimeout);
    this._timers = [];
    return super.close(options);
  }
}
