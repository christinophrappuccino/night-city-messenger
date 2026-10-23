/**
 * TerminalViewerApp
 * @file scripts/ui/Terminal/TerminalViewerApp.js
 * @module night-city-messenger
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
 *   Auth: selecting a secured account opens the shared method-card dialog
 *   (`NetworkAuthDialog.showForAccount` via `TerminalAuthAdapter`) — password
 *   / skill / key-item with strict AND/OR, per-account lockout (SecurityService,
 *   keyed `terminalId::accountId`), and Black ICE. The lockscreen/keypad inline
 *   password paths and the secret-login console stay as quick-entry shortcuts.
 *   Desktop form only (agent/phone → Phase 3); narrow windows reflow via the
 *   CSS container query.
 */

import { BaseApplication } from '../BaseApplication.js';
import { MODULE_ID, TERMINAL_PRESETS, SOCKET_OPS } from '../../utils/constants.js';
import { log, isGM, formatCyberDate, buildTerminalThemePrefs, resolveTerminalSound, resolveOperator, openOperatorPicker, getOperatorActors, canOperate, guardSecretInputs } from '../../utils/helpers.js';
import { playerConfirm, playerDialog } from '../../utils/adminTheme.js';
import { getInitials } from '../../utils/designHelpers.js';
import { showNamePicker, documentEntries } from '../../utils/namePicker.js';
import { cleanHtml } from '../../utils/richText.js';
import { enrichContent, toggleSecretReveal, applySyslogFilter, openGalleryImage, closeGalleryLightbox, resolveEnvelope, CONTENT_TYPE_INFO, displayContentType, programEffectInfo } from '../content/ContentRenderers.js';
import { runSiphon, runEddiesClaim, runCrack, runMalwareDeploy, runContentUnlock, runCamAction, runPayloadExecute, runPayloadKill, runPayloadSniff, runAnalyze, toggleSchematicLock } from '../content/SiphonFlow.js';
import { runSecurityConsole } from '../content/SecurityConsole.js';
import { NetworkAuthDialog } from '../NetworkManagement/NetworkAuthDialog.js';

const PRIORITY_ICONS = { critical: 'fa-triangle-exclamation', urgent: 'fa-circle-exclamation', normal: 'fa-circle-info' };

/**
 * Exfil action presentation — the menu chip + the security-console framing for
 * each action. `order` drives menu position. Keyed by the action id the policy
 * (`TerminalService.getExfilPolicy`) uses.
 */
const EXFIL_META = {
  agent:   { order: 1, label: 'To my Agent',    icon: 'fas fa-download',    accent: 'cyan',   title: 'Download to Agent', confirm: 'Download', intro: 'AltLink this file across to your Agent.', ok: 'DOWNLOAD COMPLETE', fail: 'DOWNLOAD TRACED' },
  shard:   { order: 2, label: 'Burn to Shard',   icon: 'fas fa-sd-card',     accent: 'gold',   title: 'Burn to Data Shard', confirm: 'Burn', intro: 'Etch this file onto a physical data shard — your go-bag copy.', ok: 'BURN COMPLETE', fail: 'BURN TRACED' },
  forward: { order: 3, label: 'Forward',         icon: 'fas fa-share',       accent: 'cyan',   title: 'Forward to Contact', confirm: 'Forward', intro: 'Send this file on to one of your contacts as a message.', ok: 'FORWARD SENT', fail: 'FORWARD TRACED' },
  leak:    { order: 4, label: 'Leak to the Net', icon: 'fas fa-tower-broadcast', accent: 'red', title: 'Leak to the Net', confirm: 'Leak', intro: 'Dump this file to the open Net. Once it’s out, it’s out — and loud.', ok: 'LEAKED', fail: 'LEAK TRACED' },
  sell:    { order: 5, label: 'Sell to a Fixer', icon: 'fas fa-hand-holding-dollar', accent: 'gold', title: 'Sell to a Fixer', confirm: 'Sell', intro: 'Move this file to a fixer for eddies. They pay for what’s useful.', ok: 'DEAL CLOSED', fail: 'DEAL TRACED' },
  wipe:    { order: 6, label: 'Wipe Original',   icon: 'fas fa-eraser',      accent: 'red',    title: 'Wipe Original', confirm: 'Wipe', intro: 'Delete this file from the terminal for good. Cover your tracks.', ok: 'FILE WIPED', fail: 'WIPE TRACED' },
  // SAVE FRAME (#37) — the stream escape hatch. You can't download a live feed;
  // you CAN take a picture of what it's showing. Feed galleries only.
  saveFrame: { order: 0, label: 'Save Frame', icon: 'fas fa-camera', accent: 'green', title: 'Save Frame', confirm: 'Capture', intro: 'You can’t copy a live stream — but you can grab what it’s showing right now.', ok: 'FRAME CAPTURED', fail: 'CAPTURE TRACED' },
};

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
      terminalInlineAuth: action('_onInlineAuth'),
      terminalFocusAccount: action('_onFocusAccount'),
      terminalSkillBypass: action('_onSkillBypass'),
      terminalKeyItem: action('_onKeyItem'),
      terminalBackToAccounts: action('_onBackToAccounts'),
      terminalSwitchNetwork: action('_onSwitchNetwork'),
      terminalSpoofNetwork: action('_onSpoofNetwork'),
      terminalForceUnlock: action('_onForceUnlock'),
      terminalToggleUplink: action('_onToggleUplink'),
      terminalSelectUplink: action('_onSelectUplink'),
      terminalNetAuth: action('_onNetAuth'),
      terminalNetSkillBypass: action('_onNetSkillBypass'),
      terminalNetGmJoin: action('_onNetGmJoin'),
      terminalNetCancel: action('_onNetCancel'),
      terminalToggleSwitcher: action('_onToggleSwitcher'),
      terminalSwitchOperator: action('_onSwitchOperator'),
      terminalOperatorTools: action('_onToggleTools'),
      terminalUpload: action('_onUpload'),
      terminalSystemSweep: action('_onSystemSweep'),
      terminalProgramInfo: action('_onProgramInfo'),
      analyzeFile: action('_onAnalyzeFile'),
      terminalSwitchAccount: action('_onSwitchAccount'),
      terminalLogout: action('_onLogout'),
      terminalFolder: action('_onFolder'),
      terminalSelectMessage: action('_onSelectMessage'),
      terminalAddContact: action('_onAddContact'),
      terminalReplyAgent: action('_onReplyAgent'),
      terminalExfil: action('_onExfilAction'),
      siphonFunds: action('_onSiphonFunds'),
      claimEddies: action('_onClaimEddies'),
      crackCred: action('_onCrackCred'),
      contentUnlock: action('_onContentUnlock'),
      schemLockToggle: action('_onSchemLockToggle'),
      deployMalware: action('_onDeployMalware'),
      executePayload: action('_onExecutePayload'),
      payloadKill: action('_onPayloadKill'),
      payloadSniff: action('_onPayloadSniff'),
      credToggleSecret: action('_onCredToggleSecret'),
      syslogFilter: action('_onSyslogFilter'),
      galleryView: action('_onGalleryView'),
      camAction: action('_onCamAction'),
      goToScene: action('_onGoToScene'),
      terminalEnvFilter: action('_onEnvFilter'),
      terminalToggleSide: action('_onToggleSide'),
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
  _toolsOpen = false;
  _manualError = '';
  _networkSpoofed = false;
  _bootPlayed = false;
  _grantedPlayed = false;
  _timers = [];
  _focusAccountId = null;     // lockscreen/keypad featured account (null = default)
  _ssTimer = null;            // screensaver idle timer (real-time by design)
  _ssActive = false;
  /**
   * GM config-preview overlay — pushed by an open TerminalConfigApp while a
   * theme draft / preset kit is staged, so THIS viewer previews the unsaved
   * look (login style, boot, MOTD, screensaver, folders, palette) live.
   * Top-level keys REPLACE the saved config blocks (see _effectiveConfig).
   * Cleared by the config on save/close/"palette only".
   */
  _cfgPreview = null;
  _uplinkOpen = false;        // machine-uplink dropdown (login hero + mailbox HUD)
  _netAuthTarget = null;      // networkId currently in the join-challenge console
  _netAuthError = '';

  constructor(options = {}) {
    super(options);
    this.item = options.item;
    this.actor = options.actor ?? resolveOperator() ?? null;
    this.actorId = this.actor?.id ?? null;
    const cfg = this.terminalService?.getConfig(this.item);
    this._state = (cfg?.boot?.enabled) ? 'boot' : this._resolveEntryState();
    // The machine's uplink is world state on the item — a relayed player switch
    // or a GM-side edit lands as an item update on every client, so re-render
    // off the document sync (this is also what refreshes the requesting player
    // after their socket-relayed switch). Skipped mid-animation states.
    this._onItemUpdate = (doc, changes) => {
      if (doc.id !== this.item?.id) return;
      if (!foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`)) return;
      if (this._state === 'boot' || this._state === 'granted') return;
      this._debouncedRender();
    };
    Hooks.on('updateItem', this._onItemUpdate);
    // Mailbox pages live in the linked world journal — page CRUD from any
    // client (a GM edit, a relayed player write, a delivery mirrored into an
    // account by MessageService) syncs as document hooks, so re-render off
    // them too. Without this an open mailbox only refreshed on the next
    // interaction (the relayed-write lag). _debouncedRender skips while
    // _animationActive (the exfil FX overlay would otherwise be destroyed by
    // a wipe's own page deletions mid-animation).
    this._onPageChange = (page) => {
      if (!page?.parent || page.parent.id !== this.item?.getFlag?.(MODULE_ID, 'journalId')) return;
      // Mailbox only — messages render nowhere else, and a re-render during
      // login/manual would wipe a half-typed password.
      if (this._state !== 'mailbox') return;
      this._debouncedRender();
    };
    Hooks.on('createJournalEntryPage', this._onPageChange);
    Hooks.on('updateJournalEntryPage', this._onPageChange);
    Hooks.on('deleteJournalEntryPage', this._onPageChange);
    // Screensaver activity detection — document-level capture with a
    // containment guard (element-level listeners are unreliable in Foundry);
    // removed in close().
    this._onActivity = (ev) => {
      if (!this.element?.contains?.(ev.target)) return;
      this._resetScreensaver();
    };
    document.addEventListener('pointerdown', this._onActivity, true);
    document.addEventListener('keydown', this._onActivity, true);
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

  /**
   * The saved config with the GM preview overlay (if any) shallow-merged on
   * top. SHALLOW on purpose: the overlay's `theme` is the config sheet's
   * whole draft (deleted overrides must fall through to the preset CSS, which
   * a deep merge would resurrect), and its boot/login/etc. blocks are the
   * complete staged values.
   */
  _effectiveConfig() {
    const cfg = this.terminalService?.getConfig(this.item) ?? {};
    return this._cfgPreview ? { ...cfg, ...this._cfgPreview } : cfg;
  }

  /**
   * Config-sheet preview channel. `rerender` is the config's call — kit
   * (markup) transitions re-render; palette-only updates don't (the sheet
   * applies those as cheap inline vars, so slider drags stay smooth).
   */
  setConfigPreview(overlay, { rerender = false } = {}) {
    this._cfgPreview = overlay;
    if (rerender && this._state !== 'boot' && this._state !== 'granted') this.render(false);
  }

  /**
   * Play a terminal sound through the terminal's sound set (config.soundSet →
   * TERMINAL_SOUND_SETS remap + rate/volume shaping). ALL sounds this viewer
   * plays go through here — never soundService.play(rawId) — so a set can
   * re-skin the machine's whole audio personality. Overlay-aware, like every
   * render-visible config read.
   */
  _playTermSound(soundId) {
    const s = resolveTerminalSound(this._effectiveConfig()?.soundSet || 'default', soundId);
    this.soundService?.playStyled?.(s.id, { rate: s.rate, volume: s.volume });
  }

  /** @override */
  async _prepareContext() {
    const cfg = this._effectiveConfig();
    const preset = cfg.theme?.preset || cfg.preset || 'arasaka-workstation';
    const logo = this._resolveBootIcon(cfg, preset);

    // Player-contact email cache — the sender "Add to contacts" chip keys on
    // the VIEWING PLAYER's own list (not the master directory: directory
    // senders are exactly the ones worth adding). Async repo read once per
    // render; _detailContext stays synchronous.
    this._playerContactEmails = new Set();
    if (this.actorId && this.contactRepository) {
      try {
        ((await this.contactRepository.getContacts(this.actorId)) || [])
          .forEach(c => c.email && this._playerContactEmails.add(c.email.toLowerCase()));
      } catch (err) { log.debug(`Contact cache skipped: ${err.message}`); }
    }
    const ctx = {
      preset,
      formFactor: cfg.formFactor || 'desktop',
      state: this._state,
      terminalName: this._terminalName(),
      // Login-hero logo — same 3-source resolution as the boot splash so a
      // configured custom icon/image shows here too (and never an empty box).
      presetIcon: logo.icon,
      logoImage: logo.imageUrl,
      logoFree: logo.imageFree,
      banner: cfg.boot?.banner || this._terminalName(),
    };

    // Session drop: the account being viewed is network-gated and the machine's
    // uplink no longer reaches it (someone switched networks mid-session) —
    // back to the login screen, where the account has vanished. Raw
    // uplinkReaches, NOT isContentVisible: the GM auto-pass would make the
    // drop untestable from a GM client, and losing the session is machine
    // behavior, not a content gate (GM bypass stays explicit). The GM lands on
    // a login list that still shows the account, OFF-NET chipped.
    if (this._state === 'mailbox' && this._accountId) {
      const acct = this.terminalService?.getAccount(this.item, this._accountId);
      if (acct && !this.terminalService.uplinkReaches(this.item, acct.network)) {
        this._accountId = null;
        this._selectedMessageId = null;
        this._state = 'login';
        ui.notifications?.warn('UPLINK LOST — session dropped.');
      }
    }

    if (this._state === 'boot') {
      ctx.boot = this._bootContext(cfg, preset);
    } else if (this._state === 'gate') {
      Object.assign(ctx, this._gateContext(cfg));
    } else if (this._state === 'login') {
      Object.assign(ctx, this._loginContext(cfg));
    } else if (this._state === 'manual') {
      Object.assign(ctx, this._manualContext());
    } else if (this._state === 'granted') {
      Object.assign(ctx, this._grantedContext(cfg));
    } else {
      Object.assign(ctx, await this._mailboxContext(cfg));
    }

    // Machine uplink pill + dropdown (login hero + mailbox HUD) and, when a
    // secured join is in progress, the challenge console overlay.
    if (this._state === 'login' || this._state === 'mailbox') {
      ctx.uplink = this._uplinkContext(cfg);
      if (this._netAuthTarget) ctx.netAuth = this._netAuthContext();
    }
    return ctx;
  }

  /**
   * View-model for the machine-uplink pill + dropdown. The pill shows the
   * TERMINAL's own connection (never the player's Agent network); the dropdown
   * lists the machine's configured interfaces plus a LOCAL ONLY disconnect row.
   */
  _uplinkContext(cfg) {
    const conn = cfg.connection || {};
    const { networkId, network } = this.terminalService?.getUplink(this.item) ?? { networkId: null, network: null };
    const gm = isGM();
    const canSwitch = gm || conn.allowPlayerSwitching !== false;
    const options = (this.terminalService?.getUplinkInterfaces(this.item) || []).map(i => {
      // Wired (LAN drop) = always full signal + ethernet icon; wireless reads
      // the network's configured signalStrength (the same number the Agent
      // viewer shows), so the bars are honest instead of decorative.
      const signal = i.wired ? 100 : (i.network.signalStrength ?? 75);
      return {
        id: i.networkId,
        name: i.network.name,
        typeLabel: i.network.type || 'Subnet',
        color: i.network.theme?.color || '#19f3f7',
        icon: i.wired ? 'fas fa-network-wired' : `fas ${i.network.theme?.icon || 'fa-wifi'}`,
        // Full theme block for the ncm-net-icon helper — a network configured
        // with a custom image (iconMode 'image') renders it, like every other
        // network list in the app. Wired keeps its hardline glyph override.
        theme: i.network.theme || null,
        signal,
        sigLabel: i.wired ? 'wired' : `${signal}%`,
        wired: i.wired,
        isActive: i.state === 'active',
        isLocked: i.state === 'locked',
      };
    });
    const active = options.find(o => o.isActive) || null;
    return {
      name: network?.name || 'LOCAL ONLY',
      color: network?.theme?.color || '',
      offline: !networkId,
      // Current connection quality — drives the HUD signal bars.
      signal: active?.signal ?? 0,
      wired: !!active?.wired,
      sigLabel: active ? active.sigLabel : 'offline',
      open: this._uplinkOpen && canSwitch,
      canSwitch,
      options,
      count: options.length,
      // Only render the pill at all when the terminal has interfaces configured
      // (a legacy/unconfigured terminal keeps its old chrome untouched).
      show: options.length > 0 || !!conn.interfaces?.length,
    };
  }

  /** View-model for the secured-join challenge console. */
  _netAuthContext() {
    const network = this.networkService?.getNetwork?.(this._netAuthTarget);
    const sec = network?.security || {};
    const skill = (sec.bypassSkills || [])[0] || 'Interface';
    const lockedOut = this.securityService?.isLockedOut?.(this.actorId, this._netTargetId(this._netAuthTarget));
    return {
      networkId: this._netAuthTarget,
      networkName: network?.name || this._netAuthTarget,
      color: network?.theme?.color || '#19f3f7',
      shellHost: (this._terminalName() || 'terminal').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      joinCmd: (network?.name || 'network').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      allowPassword: (sec.allowPassword ?? !!sec.password) && !!sec.password,
      skillBypass: (sec.allowSkillCheck ?? true) ? { skill, dv: sec.bypassDC ?? 15 } : null,
      error: this._netAuthError,
      lockout: !!lockedOut,
      isGM: isGM(),
    };
  }

  /** SecurityService key for a machine-uplink join (distinct from account keys). */
  _netTargetId(networkId) {
    return `${this.item?.id}::net::${networkId}`;
  }

  _terminalName() {
    return this.terminalService?.getConfig(this.item)?.terminalName || this.item?.name || 'Terminal';
  }

  /**
   * Resolve the terminal's icon from its boot config → { icon, imageUrl }.
   * Source: 'preset' (theme icon) | 'fa' (custom FA class) | 'image' (logo).
   * Legacy configs with only faIcon set imply 'fa'. Shared by the boot splash
   * and the login hero so both show the same (never-empty) icon.
   */
  _resolveBootIcon(cfg, preset) {
    const boot = cfg.boot || {};
    const mode = boot.iconMode || (boot.faIcon ? 'fa' : 'preset');
    return {
      icon: (mode === 'fa' && boot.faIcon) ? boot.faIcon : (TERMINAL_PRESETS[preset]?.icon || 'fas fa-server'),
      imageUrl: (mode === 'image' && boot.imageUrl) ? boot.imageUrl : null,
      // 'free' = render the logo at natural aspect with no icon-square chrome
      // (wide corp logos looked crammed inside the 88px box).
      imageFree: boot.imageFrame === 'free',
    };
  }

  /**
   * The boot splash view-model. Returned OBJECT is assigned to `ctx.boot`
   * directly (`ctx.boot = this._bootContext(...)`), so it must be the boot
   * fields themselves — NOT wrapped in `{ boot: … }`. (It previously returned
   * `{ boot: {…} }`, double-nesting to `ctx.boot.boot`, so the template's
   * `{{boot.icon}}`/`{{boot.title}}` were undefined → blank icon square + no
   * text on the boot screen.)
   */
  _bootContext(cfg, preset) {
    const boot = cfg.boot || {};
    const logo = this._resolveBootIcon(cfg, preset);
    return {
      icon: logo.icon,
      imageUrl: logo.imageUrl,
      imageFree: logo.imageFree,
      title: boot.title || this._terminalName(),
      subtitle: boot.subtitle || '',
      progressLabel: boot.progressLabel || 'Establishing secure session...',
      animationStyle: boot.animationStyle || 'standard-fade',
      speed: boot.speed || 'normal',
      logLines: Array.isArray(boot.logLines) ? boot.logLines : [],
    };
  }

  /**
   * ACCESS GRANTED view-model — the "credential badge" design. Pulls the
   * operator identity from the logged-in account and the org/classification
   * from the terminal metadata; derives a clearance label from admin status.
   */
  _grantedContext(cfg) {
    const acct = this.terminalService?.getAccount(this.item, this._accountId) || {};
    const meta = cfg.metadata || {};
    const name = acct.displayName || acct.username || 'user';
    return {
      account: {
        displayName: name,
        username: acct.username || '',
        role: acct.role || (acct.isAdmin ? 'ADMINISTRATOR' : 'OPERATOR'),
        initials: getInitials(name),
        portrait: this._accountPortrait(acct),
      },
      badge: {
        org: meta.org || this._terminalName(),
        // Per-account classification wins; else the terminal's; else RESTRICTED.
        classification: (acct.classification || meta.classification || 'RESTRICTED').toUpperCase(),
        idLabel: acct.idNumber || acct.email || acct.username || '—',
        clearance: (acct.clearance || (acct.isAdmin ? 'ADMIN' : 'STANDARD')).toUpperCase(),
        location: acct.location || meta.location || '',
        // Authored flavor wins; else the machine's own footprint log supplies
        // the real previous login; else it's genuinely the first.
        lastLogin: acct.lastLogin
          || (this._prevLogin?.ts ? formatCyberDate(this._prevLogin.ts) : 'FIRST LOGIN'),
      },
      // Custom ACCESS GRANTED line (config.login.welcomeText; empty = default).
      welcomeText: (cfg.login?.welcomeText || '').trim(),
      // "N new since last login" — mail that arrived after the previous
      // footprint on this account. Absent on a first login.
      newSince: this._newSinceLastLogin(),
    };
  }

  /** Count unseen-since-previous-login mailbox messages (0 = show nothing). */
  _newSinceLastLogin() {
    const prevTs = this._prevLogin?.ts;
    if (!prevTs) return 0;
    const cutoff = new Date(prevTs).getTime();
    if (!Number.isFinite(cutoff)) return 0;
    const msgs = this.terminalService?.getAccountMessages(this.item, this._accountId) || [];
    return msgs.filter(m =>
      !m.status?.sent && !m.status?.deleted && !m.status?.spam &&
      m.timestamp && new Date(m.timestamp).getTime() > cutoff
    ).length;
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
        color: n.theme?.color || '#19f3f7', icon: `fas ${n.theme?.icon || 'fa-wifi'}`, theme: n.theme || null,
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
    // Login-screen style (config.loginStyle) — same accounts/auth underneath,
    // different presentation. lockscreen/keypad feature ONE account (the
    // switch row refocuses via _focusAccountId); CRT reuses the SECURE SHELL
    // console for the actual auth, so its screen is just banner + list.
    const style = cfg.loginStyle || 'cards';
    const focusId = this._focusAccountId || cfg.defaultAccountId;
    const focus = accounts.find(a => a.id === focusId) || accounts[0] || null;
    return {
      accounts,
      accountCount: accounts.length,
      secured: securedCount > 0,
      onlineCount: 0,
      iceWarning: this._iceWarning(cfg),
      loginStyle: style,
      styleCards: style === 'cards',
      styleCrt: style === 'crt',
      styleRoster: style === 'roster',
      styleLock: style === 'lockscreen',
      styleKeypad: style === 'keypad',
      stylePortraits: style === 'portraits',
      motd: (cfg.login?.motd || '').trim(),
      focus,
      others: focus ? accounts.filter(a => a.id !== focus.id) : accounts,
      inlineError: this._manualError,
      shellHost: (this._terminalName() || 'terminal').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      // GM: config gear on the login screen — no need to log in just to
      // change a preset.
      isGM: isGM(),
      // WHO you're about to act as. Same chip as the mailbox HUD, and it belongs
      // here for the same reason the uplink pill does: the choice matters BEFORE
      // you log in (a login skill check rolls against the operator's stats), and
      // finding out you were the wrong character only after logging in is the bug
      // that paid siphoned eddies to the wrong PC.
      operator: this._operatorChipContext(),
    };
  }

  /** The OPERATOR chip's view-model — shared by the mailbox HUD and the login screen. */
  _operatorChipContext() {
    return {
      name: this.actor?.name || '',
      canSwitch: getOperatorActors().length > 1,
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
      // lockscreen/keypad: password entry can be inline; other-method-only
      // accounts route to the SECURE SHELL console instead.
      hasPassword: requiresAuth && !!(security.allowPassword ?? security.password),
      isSelected: account.id === this._authAccountId,
      // Escalation/earned lockout — the card reads locked and clicking it is
      // refused (see _lockGuard). Players never bypass this via an open account
      // or a remembered session (the requiresAuth gate skipped both).
      lockedOut: this.actorId ? this.terminalService?.isAccountLockedOut(this.item, account.id, this.actorId) : false,
      lastLogin: '',
      wmarkIcon: account.isAdmin ? 'fas fa-user-gear' : 'fas fa-user',
      authMethods: methods,
      tooltip: requiresAuth ? 'Requires authentication' : 'Open account',
      // GM-only: this account is network-gated off the current uplink (players
      // never receive gated accounts — the service filters them out).
      offNet: isGM() && !this.terminalService?.uplinkReaches(this.item, account.network),
      // GM-only: hidden (secret-login) account — players never get it in the
      // list (getAccounts filters), so chip it for the GM instead of looking
      // like the hiding is broken.
      hiddenGm: isGM() && !!account.hidden,
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
    const raw = this.terminalService?.getAccountMessages(this.item, this._accountId) || [];

    // Per-message network gating vs the MACHINE's uplink. Players only see what
    // the current connection reaches (isContentVisible GM-bypasses, so the GM
    // list stays complete — gated rows get an OFF-NET chip instead).
    const all = raw.filter(m => this.terminalService.isContentVisible(this.item, m.networkVisibility));

    // Folder filters — modular set from TerminalService.getFolders (Inbox →
    // customs → Saved → Trash), LOCATION semantics (the Move-to… model): a
    // message lives in exactly one place — Trash (deleted) > Saved (saved) >
    // its custom folder (`folder` flag) > the Inbox. Unknown/removed folder
    // ids fall back to the Inbox so deleting a folder never hides mail.
    const folderDefs = this.terminalService?.getFolders(this.item) || [];
    const customIds = new Set(folderDefs.filter(fd => fd.kind === 'custom').map(fd => fd.id));
    const inFolder = {
      inbox: m => !m.status?.deleted && !m.status?.saved && !m.status?.sent && !(m.folder && customIds.has(m.folder)),
      saved: m => m.status?.saved && !m.status?.deleted,
      trash: m => !!m.status?.deleted,
    };
    for (const id of customIds) inFolder[id] = m => m.folder === id && !m.status?.deleted && !m.status?.saved && !m.status?.sent;
    const counts = Object.fromEntries(folderDefs.map(fd => [fd.id, all.filter(inFolder[fd.id]).length]));
    const folder = inFolder[this._currentFolder] ? this._currentFolder : 'inbox';
    let list = all.filter(inFolder[folder]);   // narrowed further by the MAIL/FILES solo below

    // "N objects failed to sync" — GM-toggleable per terminal (showSyncHint).
    // Counted within the current folder so the number matches what's missing
    // from the list the player is looking at. GM never needs the hint.
    let syncHint = null;
    if (!isGM() && cfg.connection?.showSyncHint !== false) {
      const hiddenInFolder = raw.filter(m =>
        !this.terminalService.isContentVisible(this.item, m.networkVisibility) && inFolder[folder](m));
      if (hiddenInFolder.length) syncHint = { count: hiddenInFolder.length };
    }

    // MAIL / FILES solo (#37). Counted BEFORE the solo is applied (the chips
    // must always show both totals), then applied to the LIST itself rather
    // than hidden with CSS — hiding rows would leave the pagination counting
    // things you can't see. It's app state (`_envFilter`), so it survives the
    // re-render that selecting a message triggers; force-cleared when the
    // folder isn't mixed, so a stale solo can't empty a folder with no chip
    // left to undo it.
    const mailCount = list.filter(m => m.envelope !== 'file').length;
    const fileCount = list.length - mailCount;
    const envMixed = !!(mailCount && fileCount);
    const activeEnvFilter = envMixed ? (this._envFilter || 'all') : 'all';
    if (activeEnvFilter !== 'all') {
      const wantFile = activeEnvFilter === 'file';
      list = list.filter(m => (m.envelope === 'file') === wantFile);
    }

    if (this._selectedMessageId && !list.find(m => m.messageId === this._selectedMessageId)) this._selectedMessageId = null;
    if (!this._selectedMessageId && list.length) this._selectedMessageId = list[0].messageId;

    // Pagination.
    const PAGE = TerminalViewerApp.PAGE_SIZE;
    const maxPage = Math.max(1, Math.ceil(list.length / PAGE));
    if (this._currentPage > maxPage) this._currentPage = maxPage;
    if (this._currentPage < 1) this._currentPage = 1;
    const start = (this._currentPage - 1) * PAGE;
    const pageItems = list.slice(start, start + PAGE);

    const gm = isGM();
    const messages = pageItems.map(m => {
      // Typed content shows its file-type tag as the preview line; plain
      // messages show a stripped-HTML body snippet. `displayContentType`
      // resolves a disguised payload to its COVER type — reading contentType
      // straight off the message announced "Payload" in the sidebar and blew
      // the disguise before the player ever opened it.
      const ct = displayContentType(m, { isGM: gm });
      const ctInfo = ct ? CONTENT_TYPE_INFO[ct] : null;
      const snippet = ct ? '' : String(m.body || '')
        .replace(/<[^>]*>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 90);
      // ENVELOPE (#37) — a FILE row drops the sender line entirely: the
      // content-type icon replaces the priority dot, the filename replaces the
      // sender, and "type · size · path" replaces the body preview. A disguised
      // payload still resolves through displayContentType first, so a file row
      // can't blow the disguise either.
      const env = resolveEnvelope({ ...m, contentType: ct });
      return {
        messageId: m.messageId,
        isFile: env.isFile,
        from: m.from || 'unknown',
        subject: m.subject || '(no subject)',
        priority: m.priority || 'normal',
        encrypted: !!m.status?.encrypted,
        isSelected: m.messageId === this._selectedMessageId,
        // A live feed isn't FROM a moment — it's happening.
        time: env.isStream ? 'LIVE' : (m.timestamp ? formatCyberDate(m.timestamp, { dateOnly: true }) : ''),
        preview: snippet,
        // A file row leads with the ENVELOPE's icon/label — a live feed reads as
        // a CAMERA FEED, not an "Image Gallery" (the mode is its identity).
        typeLabel: (env.isFile ? env.typeLabel : ctInfo?.label) || null,
        typeIcon: (env.isFile ? env.typeIcon : ctInfo?.icon) || null,
        // File-row fields — kept as SEPARATE values (not one pre-joined string)
        // so the row can render the type as a colored chip and the size/path as
        // their own muted line: same 3-line skeleton as a mail row, so a mixed
        // list reads as one list instead of two competing ones.
        filename: env.filename || '',
        fileSize: env.isFile && env.size !== '—' ? env.size : '',
        filePath: env.path || '',
        fileOwner: env.owner || '',
        accent: env.accent || (ctInfo ? CONTENT_TYPE_INFO[ct]?.accent : '') || '',
        // A file has no urgency — it just wasn't there before.
        isNew: env.isFile && !m.status?.read,
        // GM-only marker: gated off the current uplink (players never see the row).
        offNet: gm && !this.terminalService.uplinkReaches(this.item, m.networkVisibility),
      };
    });

    const folderDef = folderDefs.find(fd => fd.id === folder) || folderDefs[0];
    const selected = list.find(m => m.messageId === this._selectedMessageId);
    // HUD shows the MACHINE's uplink (the pill), never the player's network.
    return {
      hud: {
        isAdmin: !!account?.isAdmin,
        trace: null,
        // WHO the rolls/eddies/skill reads run as (see the HUD chip comment).
        // Same view-model the login screen's chip uses, so the two can't drift.
        operator: this._operatorChipContext().name,
        canSwitchOperator: this._operatorChipContext().canSwitch,
        // Operator TOOLS menu (upload / hacking) — gated by canOperate.
        tools: this._operatorToolsContext(),
      },
      syncHint,
      account: {
        displayName: account?.displayName || account?.username || 'user',
        username: account?.username || '',
        initials: getInitials(account?.displayName || account?.username || '?'),
        portrait: this._accountPortrait(account || {}),
      },
      switchAccounts: this._switcherOpen ? this._switcherAccounts() : [],
      switcherOpen: this._switcherOpen,
      folders: folderDefs.map(fd => ({
        key: fd.id, label: fd.name, icon: fd.icon, count: counts[fd.id] ?? 0, active: folder === fd.id,
      })),
      // Idle screensaver (config.screensaver) — overlay markup lives in the
      // mailbox state; _resetScreensaver drives the --on class. Logo resolves
      // per iconMode: 'boot' follows the boot icon, 'fa'/'image' are custom,
      // 'none' drops it. `motion` picks the drift/bounce/static animation.
      screensaver: cfg.screensaver?.enabled ? this._screensaverContext(cfg) : null,
      // "OBJECTS" once files are in the mix — they aren't messages.
      listLabel: fileCount
        ? `${(folderDef?.name || 'Inbox').toUpperCase()} · ${list.length} OBJECT${list.length === 1 ? '' : 'S'}`
        : `${(folderDef?.name || 'Inbox').toUpperCase()} · ${list.length} MESSAGE${list.length === 1 ? '' : 'S'}`,
      emptyLabel: `${folderDef?.name || 'This folder'} is empty`,
      // One mixed list, so the chips only render when there's something to separate.
      envFilter: envMixed ? { mail: mailCount, file: fileCount } : null,
      activeEnvFilter,
      // Mailbox collapsed to a rail → the open file gets the full width.
      sideCollapsed: !!this._sideCollapsed,
      messages,
      pagination: maxPage > 1 ? { page: this._currentPage, maxPage, hasPrev: this._currentPage > 1, hasNext: this._currentPage < maxPage } : null,
      isGM: isGM(),
      selectedMessage: selected ? this._detailContext(selected) : null,
      exfilActions: this._exfilMenu(),
    };
  }

  /**
   * Build the exfil menu for the SELECTED entry (#37) — the terminal policy
   * layered with the entry's own override (`resolveEntryExfil`).
   *
   * A **denied** action isn't hidden, it renders as a dead chip with its reason
   * ("LIVE STREAM") — hiding a button reads as "the UI is broken", while a
   * stated reason teaches the rule. Authoring can still force a silent hide
   * (`hideDenied`) for things whose very existence is the secret. An action the
   * POLICY simply doesn't offer never renders at all (that's not a denial).
   */
  _exfilMenu() {
    const msg = this._currentSelectedRaw();
    if (!msg) return [];
    const policy = this.terminalService?.resolveEntryExfil?.(this.item, msg);
    if (!policy?.master) return [];
    return Object.keys(EXFIL_META)
      .filter((k) => {
        const p = policy[k];
        if (!p || p.hidden) return false;
        return p.allow || p.denied; // denied → dead chip; policy-off → absent
      })
      .sort((a, b) => EXFIL_META[a].order - EXFIL_META[b].order)
      .map(k => ({
        action: k, label: EXFIL_META[k].label, icon: EXFIL_META[k].icon,
        gated: !!policy[k].require && policy[k].allow,
        dv: policy[k].dv,
        denied: !policy[k].allow,
        denyReason: policy[k].denyReason,
      }));
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
    // ENVELOPE (#37) — file entries render a filesystem header instead of a
    // sender header (everything not authored derives: size, extension, count).
    const env = resolveEnvelope(msg);

    // Typed content (design doc §8c) — a terminal message can be a
    // spreadsheet/calendar/syslog/… not just plain mail. When contentType is
    // set, hand the entry to the SHARED content-body partial via the registry;
    // exfil is read-only here, so actions stay passive (interactive:false).
    const contentType = msg.contentType || msg.metadata?.contentType || null;
    const isTypedContent = !!contentType && contentType !== 'message';
    let content = null;
    if (isTypedContent) {
      content = enrichContent({
        id: msg.messageId,
        contentType,
        contentData: msg.contentData || msg.metadata?.contentData || {},
        subject: msg.subject,
        from: msg.from,
        body: msg.body,
        timestamp: msg.timestamp,
        // `interactive` means "this consumer WIRES the content actions" — the
        // terminal wires all of them (executePayload/payloadKill/payloadSniff/
        // contentUnlock/deployMalware/claimEddies/siphonFunds/…). It passed
        // false, which silently hid the payload RUN/KILL buttons, the schematic
        // SCOUT, and the GM Go-to-Scene chips in every terminal. Only the
        // composer's read-only live preview passes false.
      }, { isGM: isGM(), interactive: true });
    }

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
      // "Add to contacts" keys on the viewing player's OWN list — a master-
      // directory sender is exactly the kind worth adding (was `!!contact`,
      // which hid the chip for every directory identity). Send-only system
      // addresses can never be added or replied to.
      isContact: !!(msg.from && this._playerContactEmails?.has(msg.from.toLowerCase())),
      // ENVELOPE (#37) — a FILE has no sender: no avatar, no ADD, no REPLY.
      // Its owner is a NODE (SECCAM-B2), not an Agent you can write back to.
      file: env.isFile ? env : null,
      isFile: env.isFile,
      canAddContact: !env.isFile && !!(msg.from && this.actorId &&
        !this._playerContactEmails?.has(msg.from.toLowerCase()) &&
        !game.nightcity?.masterContactService?.isSendOnly?.(msg.from)),
      canReply: !env.isFile && !!(msg.from && resolveOperator() &&
        this.contactRepository?.verifyContact?.(msg.from)?.verified &&
        !game.nightcity?.masterContactService?.isSendOnly?.(msg.from)),
      timeAgo: this._relativeTime(msg.timestamp),
      timeAbs: this._absDate(msg.timestamp),
      priority,
      priorityLabel: priority.toUpperCase(),
      priorityIcon: PRIORITY_ICONS[priority] || PRIORITY_ICONS.normal,
      network: this.networkService?.getNetwork?.(msg.network)?.name || msg.network || 'CITINET',
      isTypedContent,
      content,
      bodyHtml: this._sanitizeBody(msg.body || ''),
      // GM "Move to…" selector — every folder, current location selected
      // (location: Trash > Saved > custom folder > Inbox).
      moveOptions: isGM() ? (() => {
        const defs = this.terminalService?.getFolders(this.item) || [];
        const loc = msg.status?.deleted ? 'trash'
          : msg.status?.saved ? 'saved'
          : (defs.some(fd => fd.kind === 'custom' && fd.id === msg.folder) ? msg.folder : 'inbox');
        // Hidden Saved/Trash still appear as move targets for the GM.
        const all = [...defs];
        if (!all.some(fd => fd.id === 'saved')) all.push({ id: 'saved', name: 'Saved' });
        if (!all.some(fd => fd.id === 'trash')) all.push({ id: 'trash', name: 'Trash' });
        return all.map(fd => ({ id: fd.id, name: fd.name, selected: fd.id === loc }));
      })() : null,
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  Render — boot animation + window title + switcher outside-click
  // ═══════════════════════════════════════════════════════════

  /** @override — capture pane scroll before the re-render tears down the DOM. */
  async _preRender(context, options) {
    await super._preRender(context, options);
    const el = this.element;
    if (!el) return;
    this._scrollMemo = {
      // The message LIST is the sidebar's scroller now (folders stay pinned).
      side: el.querySelector('.ncm-term__list')?.scrollTop ?? 0,
      detail: el.querySelector('.ncm-term__detail')?.scrollTop ?? 0,
      msgId: this._renderedMsgId ?? null,
    };
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    guardSecretInputs(this.element); // read-only until touched — no browser autofill
    // Theme the window: preset attribute (CSS palette fallback) + the saved
    // custom theme applied live as inline variables on the viewer root.
    const viewerEl = this.element?.querySelector('.ncm-terminal-viewer');
    viewerEl?.setAttribute('data-terminal-preset', context.preset);
    this._applyCustomTheme(viewerEl, context.preset);
    // ALSO theme the AppV2 frame root: the window header (title spans, header
    // controls) sits OUTSIDE .ncm-terminal-viewer, so without this its
    // --ncm-* lookups resolved to :root — i.e. the PLAYER's theme, not the
    // terminal's. Inline vars on the app root give the chrome the effective
    // terminal palette (buildTerminalThemePrefs already folds the preset in).
    if (this.element && this.element !== viewerEl) this._applyCustomTheme(this.element, context.preset);
    // Per-terminal effects (theme.scanlines/flicker — opt-in, separate from
    // the player's own atmosphere prefs). Glitch rides --ncm-glitch-intensity
    // via applyTheme. Overlay-aware, like everything render-visible.
    const themeCfg = this._effectiveConfig().theme || {};
    viewerEl?.setAttribute('data-term-scanlines', String(themeCfg.scanlines === true));
    viewerEl?.setAttribute('data-term-flicker', String(themeCfg.flicker === true));
    this._syncWindowTitle(context);
    // SAVE FRAME (#37) — only the terminal knows the exfil policy, so it stamps
    // the capturable feed thumbs here; the shared lightbox reads the attrs and
    // renders the button (+ the honest "can't copy a stream" chip). Keeps the
    // policy out of ContentRenderers, which serves all three viewers.
    this._stampFrameCapture();
    // GM "Move to…" folder selector — manual change listener (the standing
    // gotcha: data-action on a <select> fires on click, not value change).
    this.element?.querySelectorAll('[data-move-message]').forEach(sel => {
      sel.addEventListener('change', (e) => this._onMoveMessage(e.target.dataset.moveMessage, e.target.value));
    });
    // Restore pane scroll — every action re-renders, and without this each
    // click snapped both panes back to the top. The detail pane only restores
    // when the same message is still open (a new message starts at the top).
    const memo = this._scrollMemo;
    if (memo) {
      const side = this.element?.querySelector('.ncm-term__list');
      if (side && memo.side) side.scrollTop = memo.side;
      if (memo.detail && memo.msgId && memo.msgId === this._selectedMessageId) {
        const det = this.element?.querySelector('.ncm-term__detail');
        if (det) det.scrollTop = memo.detail;
      }
    }
    // ─── MOTION (#38) — stamp the entrance animations ───
    // The terminal re-renders on EVERY click, so an animation tied to "render"
    // would twitch the list constantly. Each `is-fresh` is applied only when the
    // thing it describes actually changed:
    //   · the LIST cascades when its contents change (folder / account / filter
    //     / page), NOT when you merely select a row within it;
    //   · the DETAIL slides only when a DIFFERENT message is opened.
    this._stampMotion(context);

    this._renderedMsgId = this._selectedMessageId;
    if (this._state === 'boot') this._playBoot();
    if (this._state === 'granted' && !this._grantedPlayed) {
      this._grantedPlayed = true;
      this._playTermSound('login-success');
      // Hold for the full sequence (keep in sync with the badge CSS delays):
      // materialise → reader sweep + fields type in + hairline fill (~1.6s) →
      // verify pulse + portrait badge (~2.0s) → ACCESS GRANTED (~2.3s) → beat.
      this._timer(() => { this._grantedPlayed = false; this._enterState('mailbox'); }, 2700);
    }
    // Enter-to-submit in the auth console.
    if (this._state === 'manual') {
      const pass = this.element?.querySelector('input[name="ncm-term-key"]');
      pass?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this._onManualAuth(); } });
    }
    // Enter-to-submit in the uplink join-challenge console.
    if (this._netAuthTarget) {
      const pass = this.element?.querySelector('input[name="ncm-term-netkey"]');
      pass?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this._onNetAuth(); } });
    }
    // Inline password on the lockscreen login style: Enter submits for the
    // focused account (the input carries data-account-id).
    if (this._state === 'login') {
      const inlinePass = this.element?.querySelector('.ncm-term__lockpass input[name="ncm-term-key"]');
      inlinePass?.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        this._onInlineAuth(e, inlinePass);
      });
      inlinePass?.focus();
      // Keypad login style: pad keys write into the hidden password input and
      // echo dots on the LCD; ⏎ submits, ✕ clears. Manual listeners — these
      // must not re-render per keypress.
      const pad = this.element?.querySelector('.ncm-term__pad');
      if (pad) {
        const input = this.element.querySelector('.ncm-term__keypad input[name="ncm-term-key"]');
        const lcd = this.element.querySelector('.ncm-term__lcd-code');
        const echo = () => { if (lcd) lcd.textContent = input?.value ? '▪ '.repeat(input.value.length).trim() : '_'; };
        pad.querySelectorAll('[data-key]').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const k = btn.dataset.key;
            if (!input) return;
            if (k === 'clear') input.value = '';
            else if (k === 'enter') return this._onInlineAuth(e, btn);
            else if (input.value.length < 24) input.value += k;
            echo();
          });
        });
        echo();
      }
    }
    // Idle screensaver — (re)arm on every render; mailbox only.
    this._resetScreensaver();
    // SYSTEM LOCKDOWN takeover — shown after a forced/earned lockout kick, with a
    // live countdown, so the bounce reads as "the system sealed you out" instead
    // of an unexplained drop.
    this._syncLockdown();
  }

  /**
   * Inject / update the SYSTEM LOCKDOWN overlay while the operator is locked out.
   * The AppV2 re-render replaces the element, so this re-injects each render and
   * (re)starts a 1s countdown ticker; when the lockout expires it clears itself
   * and re-renders so the login cards become clickable again. GMs never see it
   * (they aren't the ones getting locked out of their own boxes).
   */
  _syncLockdown() {
    if (this._lockdownTimer) { clearInterval(this._lockdownTimer); this._lockdownTimer = null; }
    const host = this.element?.querySelector('.ncm-terminal-viewer');
    host?.querySelector('.ncm-term__lockdown')?.remove();
    const acct = this._lockdownAccountId;
    if (!acct || !host || this._state !== 'login' || isGM()) return;
    let rem = this.terminalService?.getAccountLockoutRemaining(this.item, acct, this.actorId) || 0;
    if (rem <= 0) { this._lockdownAccountId = null; return; }

    const account = this.terminalService?.getAccount(this.item, acct);
    const who = Handlebars.escapeExpression(account?.displayName || account?.username || 'this terminal');
    const fmt = (ms) => {
      const s = Math.max(0, Math.ceil(ms / 1000));
      return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    };
    const reduced = !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    const el = document.createElement('div');
    el.className = 'ncm-term__lockdown' + (reduced ? ' is-reduced' : '');
    el.innerHTML = `
      <div class="ncm-term__lockdown-scan"></div>
      <div class="ncm-term__lockdown-box">
        <div class="ncm-term__lockdown-ico"><i class="fas fa-lock"></i></div>
        <div class="ncm-term__lockdown-ttl">SYSTEM LOCKDOWN</div>
        <div class="ncm-term__lockdown-sub">ACCESS SUSPENDED — too many failed attempts</div>
        <div class="ncm-term__lockdown-acct">${who}</div>
        <div class="ncm-term__lockdown-clock"><span class="ncm-term__lockdown-time">${fmt(rem)}</span><span class="ncm-term__lockdown-lbl">until reset</span></div>
        <button type="button" class="ncm-term__lockdown-ack"><i class="fas fa-angle-left"></i> STAND DOWN</button>
      </div>`;
    host.appendChild(el);
    this._playTermSound('lockout');
    el.querySelector('.ncm-term__lockdown-ack')?.addEventListener('click', () => {
      // Hide the takeover but keep the account sealed — re-clicking it re-shows
      // this via _lockGuard. Just returns them to the login list.
      this._lockdownAccountId = null;
      if (this._lockdownTimer) { clearInterval(this._lockdownTimer); this._lockdownTimer = null; }
      el.classList.add('is-out');
      setTimeout(() => el.remove(), 260);
    });
    const timeEl = el.querySelector('.ncm-term__lockdown-time');
    this._lockdownTimer = setInterval(() => {
      rem = this.terminalService?.getAccountLockoutRemaining(this.item, acct, this.actorId) || 0;
      if (rem <= 0) {
        clearInterval(this._lockdownTimer); this._lockdownTimer = null;
        this._lockdownAccountId = null;
        this._playTermSound('shard-decrypt');
        this.render(false);   // lockout lifted → cards clickable again
        return;
      }
      if (timeEl) timeEl.textContent = fmt(rem);
    }, 1000);
  }

  /**
   * Apply the terminal's saved custom theme (colors / fonts / text scale /
   * contrast from cfg.theme) as inline CSS variables on the viewer root, via
   * the element-scoped ThemeService.applyTheme. The effective value for each
   * key = the GM's saved override, else the TERMINAL_PRESETS palette, else
   * nothing (the preset attribute CSS / base palette shows through — a fresh
   * terminal stores only { preset } and renders exactly as before). preset:
   * null stops applyTheme from merging the *player* THEME_PRESETS in.
   * Re-runs on every render, so a config Save updates an open viewer live
   * (the constructor's updateItem hook re-renders on the flag write).
   */
  _applyCustomTheme(viewerEl, presetKey) {
    if (!viewerEl || !this.themeService) return;
    const t = this._effectiveConfig().theme || {};
    this.themeService.applyTheme(buildTerminalThemePrefs(t, presetKey), viewerEl);
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
    this._playTermSound('shard-boot');
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
    this._uplinkOpen = false;
    this._netAuthTarget = null;
    this._netAuthError = '';
    this.render(false);
  }

  // ═══════════════════════════════════════════════════════════
  //  Actions — login / auth
  // ═══════════════════════════════════════════════════════════

  /**
   * The authoritative lockout gate for EVERY login entry point. An escalation
   * (or earned) lockout must hold regardless of how the player tries to get in —
   * the old `requiresAuth` check let them straight past it two ways: an OPEN
   * account (no auth) and a session that still "remembered" the login both
   * returned requiresAuth=false and dropped into `_loginSuccess` with no lockout
   * check at all ("the player easily can just log back in"). This runs first on
   * card pick / focus / switch / manual / inline AND as the final gate inside
   * `_loginSuccess`. Locked → shows the SYSTEM LOCKDOWN takeover with a live
   * countdown; the account stays sealed until it expires or the GM clears it.
   * @returns {boolean} true if locked (caller must abort)
   */
  _lockGuard(accountId) {
    if (!accountId || !this.actorId) return false;
    const rem = this.terminalService?.getAccountLockoutRemaining(this.item, accountId, this.actorId) || 0;
    if (rem <= 0) return false;
    this._lockdownAccountId = accountId;
    if (this._state !== 'login') { this._enterState('login'); } else { this.render(false); }
    return true;
  }

  async _onSelectAccount(event, target) {
    const id = target?.dataset?.accountId;
    if (!id) return;
    if (this._lockGuard(id)) return;
    // MOTION (#38): the picked card holds while the others fall away, THEN the
    // flow continues — the machine responds to the choice instead of cutting.
    await this._playCardPick(target);
    if (!this.terminalService.requiresAuth(this.item, id, this.actorId)) {
      return this._loginSuccess(id);
    }
    // Secured account → the shared method-card auth dialog (password / skill /
    // key-item, strict AND/OR, lockout, Black ICE). Lands the login on
    // success; a cancel just returns to the account list.
    const result = await NetworkAuthDialog.showForAccount(this.item, id);
    if (result?.success) this._loginSuccess(id);
    // Cancelled/failed → put the cards back, or the login screen stays faded out.
    else this._resetCardPick();
  }

  /** Undo the pick visual when the auth dialog is cancelled or fails. */
  _resetCardPick() {
    this.element?.querySelectorAll('.ncm-term__cards, .ncm-term__roster, .ncm-term__portraits')
      .forEach(w => w.classList.remove('is-picking'));
    this.element?.querySelectorAll('.is-picked').forEach(c => c.classList.remove('is-picked'));
  }

  _onManualLogin() { this._authAccountId = null; this._manualError = ''; this._enterState('manual'); }
  _onBackToAccounts() { this._authAccountId = null; this._manualError = ''; this._enterState('login'); }

  /** Resolve the account being authed: bound (card) or typed username (secret). */
  _resolveAuthAccount() {
    if (this._authAccountId) return this.terminalService.getAccount(this.item, this._authAccountId);
    const uname = this.element?.querySelector('input[name="ncm-term-op"]')?.value?.trim().toLowerCase();
    if (!uname) return null;
    return (this.terminalService.getAccounts(this.item, { includeHidden: true }) || [])
      .find(a => (a.username || '').toLowerCase() === uname) || null;
  }

  /**
   * Inline password auth for the lockscreen/keypad login styles — the password
   * field lives on the login screen itself, so bind the target account from
   * the control and run the normal manual-auth path (same lockout/ICE rules;
   * a failure re-renders the login screen with `inlineError`).
   */
  async _onInlineAuth(event, target) {
    const id = target?.dataset?.accountId || target?.closest('[data-account-id]')?.dataset?.accountId;
    if (id && this._lockGuard(id)) return;
    if (id) this._authAccountId = id;
    return this._onManualAuth();
  }

  /**
   * Lockscreen/keypad "switch user" row — refocus the featured account. An
   * OPEN account logs straight in (no password panel to show).
   */
  _onFocusAccount(event, target) {
    const id = target?.dataset?.accountId;
    if (!id) return;
    if (this._lockGuard(id)) return;
    if (!this.terminalService.requiresAuth(this.item, id, this.actorId)) return this._loginSuccess(id);
    this._focusAccountId = id;
    this._manualError = '';
    this.render(false);
  }

  async _onManualAuth() {
    const account = this._resolveAuthAccount();
    if (!account) { this._manualError = 'No such account.'; return this.render(false); }
    if (this.terminalService.isAccountLockedOut(this.item, account.id, this.actorId)) {
      this._manualError = 'Account locked out. Try again later.'; return this.render(false);
    }
    const password = this.element?.querySelector('input[name="ncm-term-key"]')?.value ?? '';
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
    this._playTermSound('hack-fail');
    // ICE on failure mode === 'damage'
    if (account.security?.failureMode === 'damage' && this.actor) {
      try { this.iceService?.applyDamage?.(this.actor, account.security); } catch { /* non-fatal */ }
    }
    this._manualError = res.lockedOut
      ? 'ACCESS DENIED — account locked out.'
      : `ACCESS DENIED — ${res.attemptsRemaining} attempt${res.attemptsRemaining === 1 ? '' : 's'} left.`;
    // Trace funnel (§6a) — a failed terminal account login.
    game.nightcity?.traceService?.fireTrace({ actor: this.actor, action: 'terminal-login', hostItem: this.item, objectName: `${this._terminalName()} · ${account?.displayName || account?.username || 'account'}`, severity: 'major' });
    this.render(false);
  }

  async _loginSuccess(accountId) {
    // Final authority — no path reaches the mailbox past an active lockout, even
    // an open account or a session that still remembers the login.
    if (this._lockGuard(accountId)) return;
    // Flip to 'granted' BEFORE the session flag write: the write echoes back
    // through the updateItem hook on this same client, and with the state
    // still 'manual'/'login' the hook's boot/granted guard doesn't skip it —
    // the debounced re-render then rebuilt the badge DOM ~150ms into its
    // animation, restarting it (the "card slides in twice" bug).
    this._state = 'granted';
    // Capture the PREVIOUS footprint before this login's own write lands (the
    // relayed player write lags anyway; reading first makes both sides agree).
    this._prevLogin = this.terminalService.getLastLogin?.(this.item, accountId) || null;
    await this.terminalService.recordLoginSuccess(this.item, accountId, this.actorId);
    this._accountId = accountId;
    this._authAccountId = null;
    this._manualError = '';
    this._selectedMessageId = null;
    this._currentFolder = 'inbox';
    this._currentPage = 1;
    this._playTermSound('shard-decrypt');
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
  //  Actions — machine uplink (Layer 1)
  // ═══════════════════════════════════════════════════════════

  _onToggleUplink() {
    this._uplinkOpen = !this._uplinkOpen;
    this.render(false);
  }

  async _onSelectUplink(event, target) {
    const raw = target?.dataset?.networkId;
    this._uplinkOpen = false;
    if (raw === undefined) return this.render(false);
    const networkId = raw === 'local' ? null : raw;
    const current = this.terminalService?.getUplink(this.item)?.networkId ?? null;
    if (networkId === current) return this.render(false);
    if (networkId) {
      const iface = (this.terminalService?.getUplinkInterfaces(this.item) || []).find(i => i.networkId === networkId);
      if (!iface) return this.render(false);
      if (iface.state === 'locked') {
        // Secured network the machine holds no credential for — join challenge.
        this._netAuthTarget = networkId;
        this._netAuthError = '';
        return this.render(false);
      }
    }
    await this._switchUplink(networkId, { authorized: false });
  }

  /**
   * Point the machine at a network. GM writes directly; players relay through
   * the socket (item flags aren't player-writable) — their viewer refreshes
   * when the flag write syncs back (the updateItem hook in the constructor).
   */
  async _switchUplink(networkId, { authorized = false } = {}) {
    if (isGM()) {
      const res = await this.terminalService.setUplink(this.item, networkId, { remember: authorized });
      if (!res?.success) ui.notifications?.warn(res?.error || 'Uplink switch failed.');
      this.render(false);
      return;
    }
    game.nightcity?.socketManager?.emit?.(SOCKET_OPS.TERMINAL_NET_REQUEST, {
      itemUuid: this.item?.uuid,
      networkId,
      authorized,
      userId: game.user.id,
    });
    this.render(false);
  }

  _onNetCancel() {
    this._netAuthTarget = null;
    this._netAuthError = '';
    this.render(false);
  }

  async _onNetAuth() {
    const networkId = this._netAuthTarget;
    const network = this.networkService?.getNetwork?.(networkId);
    if (!network) return this._onNetCancel();
    if (this.securityService?.isLockedOut?.(this.actorId, this._netTargetId(networkId))) {
      this._netAuthError = 'Interface locked out. Try again later.';
      return this.render(false);
    }
    const password = this.element?.querySelector('input[name="ncm-term-netkey"]')?.value ?? '';
    const expected = network.security?.password ?? '';
    if (expected && password === expected) return this._netJoinSuccess(networkId);
    this._failNetAuth(network);
  }

  async _onNetSkillBypass() {
    const networkId = this._netAuthTarget;
    const network = this.networkService?.getNetwork?.(networkId);
    if (!network) return this._onNetCancel();
    if (!this.actor) { this._netAuthError = 'No character to roll with.'; return this.render(false); }
    if (this.securityService?.isLockedOut?.(this.actorId, this._netTargetId(networkId))) {
      this._netAuthError = 'Interface locked out.';
      return this.render(false);
    }
    const skill = (network.security?.bypassSkills || [])[0] || 'Interface';
    const dc = network.security?.bypassDC ?? 15;
    try {
      const result = await this.skillService.performCheck(this.actor, skill, { dc, flavor: 'Network Join' });
      if (result?.success) return this._netJoinSuccess(networkId);
    } catch (err) { log.error(`Uplink skill bypass failed: ${err.message}`); }
    this._failNetAuth(network);
  }

  /** GM: join a secured interface without credentials (testing / story fiat). */
  async _onNetGmJoin() {
    if (!isGM()) return;
    const networkId = this._netAuthTarget;
    this._netAuthTarget = null;
    this._netAuthError = '';
    await this._switchUplink(networkId, { authorized: true });
  }

  async _netJoinSuccess(networkId) {
    this.securityService?.recordSuccess?.(this.actorId, this._netTargetId(networkId));
    this._netAuthTarget = null;
    this._netAuthError = '';
    this._playTermSound('login-success');
    // authorized:true — the machine remembers the credential (state.connection.authenticated).
    await this._switchUplink(networkId, { authorized: true });
  }

  _failNetAuth(network) {
    const networkId = this._netAuthTarget;
    const sec = network?.security || {};
    const targetId = this._netTargetId(networkId);
    this.securityService?.initTracking?.(this.actorId, targetId, {
      maxAttempts: sec.maxAttempts ?? 3,
      lockoutDuration: sec.lockoutDuration ?? 3600000,
    });
    this.securityService?.recordFailedAttempt?.(this.actorId, targetId);
    this._playTermSound('hack-fail');
    if (sec.failureMode === 'damage' && this.actor) {
      try { this.iceService?.applyDamage?.(this.actor, sec); } catch { /* non-fatal */ }
    }
    const lockedOut = this.securityService?.isLockedOut?.(this.actorId, targetId);
    const remaining = this.securityService?.getRemainingAttempts?.(this.actorId, targetId) ?? 0;
    this._netAuthError = lockedOut
      ? 'ACCESS DENIED — interface locked out.'
      : `ACCESS DENIED — ${remaining} attempt${remaining === 1 ? '' : 's'} left.`;
    // Trace funnel (§6a) — a failed terminal network-join auth.
    game.nightcity?.traceService?.fireTrace({ actor: this.actor, action: 'terminal-net', hostItem: this.item, objectName: network?.name || 'network join', severity: 'major' });
    this.render(false);
  }

  // ═══════════════════════════════════════════════════════════
  //  Actions — mailbox
  // ═══════════════════════════════════════════════════════════

  _onToggleSwitcher() { this._switcherOpen = !this._switcherOpen; this.render(false); }

  // ═══════════════════════════════════════════════════════════
  //  OPERATOR TOOLS — upload / hacking (design §4, §5b)
  // ═══════════════════════════════════════════════════════════

  /** Context for the HUD OPERATOR-TOOLS menu. Gated by canOperate. @private */
  _operatorToolsContext() {
    const cap = canOperate(this.actor);
    const noActor = !this.actor;
    const uploadReason = !cap.ok ? cap.reason : (noActor ? 'No operator assigned — pick a character first.' : '');
    // Active programs installed on this box. A player sees only what THEY planted
    // (provenance.plantedBy); the GM sees every resident. Confirms "my upload is live".
    const residents = game.nightcity?.terminalService?.getResidents?.(this.item) || [];
    const gm = isGM();
    const active = residents
      .filter(r => (r.state === 'armed' || r.state === 'fired')
        && (gm || r.provenance?.plantedBy === this.actor?.id))
      .map(r => {
        const info = programEffectInfo(r.effectType);
        const byId = r.provenance?.plantedBy;
        return {
          id: r.id, label: info?.label || r.effectType, icon: info?.icon || 'fas fa-microchip',
          desc: info?.blurb || 'a planted program',
          fired: r.state === 'fired', state: r.state === 'fired' ? 'TRIGGERED' : 'ARMED',
          expanded: this._opsInfoId === r.id,
          hasFile: !!r.firedMessageId,   // planted a mailbox file → click jumps to it
          by: gm && byId ? (game.actors?.get(byId)?.name || 'an operator') : '',
        };
      });
    return {
      open: !!this._toolsOpen,
      canOperate: cap.ok && !noActor,
      reason: uploadReason,
      items: [
        { action: 'terminalUpload', icon: 'fas fa-upload', label: 'UPLOAD',
          desc: 'push a carried program onto this box', disabled: !cap.ok || noActor, reason: uploadReason },
        { action: 'terminalSystemSweep', icon: 'fas fa-satellite-dish', label: 'SYSTEM SWEEP',
          desc: 'scan this box for planted programs', disabled: !cap.ok, reason: !cap.ok ? cap.reason : '' },
      ],
      active,
      activeCount: active.length,
      activeMine: !gm,
    };
  }

  _onToggleTools() { this._toolsOpen = !this._toolsOpen; this._opsInfoId = null; this.render(false); }

  /** Click an ACTIVE PROGRAM row → jump to the file it planted, else expand it. */
  _onProgramInfo(event, target) {
    const rid = target?.dataset?.residentId;
    const r = (game.nightcity?.terminalService?.getResidents?.(this.item) || []).find(x => x.id === rid);
    // A fired PLANT created a mailbox file — go to it.
    if (r?.firedMessageId) {
      const acct = r.firedAccountId;
      if (!acct || acct === this._accountId || isGM()) {
        if (acct && acct !== this._accountId && isGM()) this._accountId = acct;
        this._selectedMessageId = r.firedMessageId;
        this._toolsOpen = false; this._opsInfoId = null;
        this.render(true);
        return;
      }
      ui.notifications.info('NCM | That program planted a file in another account — log into it to view.');
      return;
    }
    // No planted file (armed, or an execute/run program) → expand to show what it does.
    this._opsInfoId = (this._opsInfoId === rid) ? null : rid;
    this.render(false);
  }

  /** UPLOAD — gather carried programs + visible accounts, run the picker, upload. */
  async _onUpload() {
    this._toolsOpen = false;
    const cap = canOperate(this.actor);
    if (!cap.ok) { ui.notifications.warn(`NCM | ${cap.reason}`); return this.render(false); }
    if (!this.actor) { ui.notifications.warn('NCM | No operator assigned to run the upload.'); return this.render(false); }
    const programs = await this._gatherCarriedPrograms();
    if (!programs.length) { ui.notifications.info('NCM | You are not carrying anything uploadable.'); return this.render(false); }
    const accounts = this._uploadTargetAccounts();
    const { runUploadConsole } = await import('../content/UploadConsole.js');
    const picked = await runUploadConsole({ programs, accounts, terminalName: this._terminalName(), host: this.element });
    if (!picked) return this.render(false);
    const { runUpload } = await import('../content/UploadFlow.js');
    await runUpload({ actor: this.actor, program: picked.program, targetItem: this.item, accountId: picked.accountId, host: this.element });
    this.render(false);
  }

  /** OPERATOR TOOLS → SYSTEM SWEEP. Deep-scan this box for planted residents and
   *  defuse them. A GM without a character force-reveals; a player rolls. @private */
  async _onSystemSweep() {
    this._toolsOpen = false;
    const cap = canOperate(this.actor);
    if (!cap.ok) { ui.notifications.warn(`NCM | ${cap.reason}`); return this.render(false); }
    if (!this.actor && !isGM()) { ui.notifications.warn('NCM | No operator assigned to run the sweep.'); return this.render(false); }
    const { runSystemSweep } = await import('../content/SystemSweep.js');
    await runSystemSweep({ item: this.item, actor: this.actor, host: this.element });
    this.render(false);
  }

  /** Target mailboxes = player-visible accounts (hidden/net-gated already filtered)
   *  + the account you're logged into. @private */
  _uploadTargetAccounts() {
    const svc = this.terminalService;
    const seen = new Set(); const out = [];
    const add = (a) => { if (a && !seen.has(a.id)) { seen.add(a.id); out.push({ id: a.id, label: a.displayName || a.username || a.id, email: a.email || '' }); } };
    (svc.getAccounts(this.item) || []).forEach(add);
    if (this._accountId) add(svc.getAccount(this.item, this._accountId));
    return out;
  }

  /** Scan the operator's held data shards for entries flagged `uploadable`, mapped
   *  to program descriptors the UploadConsole/runUpload consume. (Agent-inbox
   *  source + EXECUTE families are later slices.) @private */
  async _gatherCarriedPrograms() {
    const shardSvc = game.nightcity?.dataShardService;
    const actor = this.actor;
    if (!shardSvc?.isDataShard || !actor) {
      log.debug(`Upload: no ${!actor ? 'operator resolved (set the OPERATOR chip)' : 'shard service'} — nothing to gather.`);
      return [];
    }
    const out = [];
    const shards = (actor.items ?? []).filter(i => shardSvc.isDataShard(i));
    log.debug(`Upload: operator "${actor.name}" carries ${shards.length} data shard(s).`);
    for (const shard of shards) {
      let entries = [];
      try { entries = shardSvc.getShardMessages(shard) || []; } catch { entries = []; }
      // A damaged entry leaves the chip DAMAGED (its loss baked into the copy), and
      // a fully lost one can't be uploaded at all — carrying a file somewhere else
      // is never a free repair.
      entries = entries.map(e => shardSvc.exportEntry(shard, e)).filter(Boolean);
      log.debug(`Upload: shard "${shard.name}" — ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}, ${entries.filter(e => e.contentData?.uploadable).length} uploadable: [${entries.map(e => `${e.contentType}:${e.contentData?.name || e.subject}=${e.contentData?.uploadable ? 'Y' : 'n'}`).join(', ')}]`);
      for (const e of entries) {
        const cd = e.contentData || {};
        if (!cd.uploadable) continue;
        // A malware/payload entry with an `uploadEffect` verb is an EXECUTE program
        // (installs a keylog/backdoor/Black-ICE resident); everything else — incl.
        // a malware file with no verb — uploads as a PLANT of the file itself.
        const uploadVerb = (e.contentType === 'malware' || e.contentType === 'payload') ? (cd.uploadEffect || '') : '';
        // RUN verbs are instant utilities that operate on the whole box (scanner reveals
        // hidden accounts, icebreaker unseals, skeleton-key clears locks, jammer drops the
        // uplink). Uploading one RUNS it against this terminal now — it doesn't plant.
        const RUN_VERBS = ['scanner', 'skeletonKey', 'jammer'];
        const runVerb = RUN_VERBS.includes(uploadVerb) ? uploadVerb
          : (e.contentType === 'payload' && RUN_VERBS.includes(cd.effect?.type)) ? cd.effect.type : '';
        const execVerb = runVerb ? '' : uploadVerb;
        const info = CONTENT_TYPE_INFO[e.contentType];
        const base = {
          name: e.subject || cd.name || 'file',
          sourceLabel: `shard: "${shard.name}"`,
          uploadDV: Number(cd.uploadDV) || 15,
          uploadSkill: cd.uploadSkill || 'Interface',
          stealthDV: cd.uploadStealthDV || undefined,
          traceOnFail: !!cd.uploadTraceOnFail,
        };
        if (runVerb) {
          out.push({ ...base, effectType: runVerb, family: 'run',
            description: programEffectInfo(runVerb).blurb || 'runs against this box' });
        } else if (execVerb) {
          const params = {};
          if (execVerb === 'deployICE' && cd.iceActorId) params.iceActorId = cd.iceActorId;
          out.push({ ...base, effectType: execVerb, family: 'execute', params,
            trigger: cd.uploadTrigger || undefined,   // honor the authored trigger (kind + detail)
            description: programEffectInfo(execVerb).blurb || 'installs a program' });
        } else {
          // The planted copy must NOT carry the upload-config keys forward.
          const plantCd = { ...cd };
          for (const k of ['uploadable', 'uploadDV', 'uploadSkill', 'uploadStealthDV', 'uploadTraceOnFail', 'uploadTrigger', 'uploadEffect']) delete plantCd[k];
          out.push({ ...base, effectType: 'plant', family: 'plant',
            description: `forged ${(info?.label || e.contentType || 'file').toLowerCase()}`,
            params: { entry: { contentType: e.contentType, contentData: plantCd, subject: e.subject || '', from: e.from || '' } } });
        }
      }
    }
    return out;
  }

  _onSwitchAccount(event, target) {
    const id = target?.dataset?.accountId;
    if (!id || id === this._accountId) { this._switcherOpen = false; return this.render(false); }
    this._switcherOpen = false;
    if (this._lockGuard(id)) return;
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

  /**
   * A forced (escalation) lockout just invalidated this session — slam the
   * connection shut. Called by SecurityService._kickLockedViewers on every
   * client that mirrors the lockout, so the operator is bounced to the login
   * screen (where the per-account lockout state now reads locked) instead of
   * sitting in a mailbox the system claims to have sealed.
   * @param {string} [message] shown as the login-screen error line
   */
  forceLogout(message = 'CONNECTION TERMINATED — locked out.') {
    const lockedAcct = this._accountId;
    try { this.terminalService.logout(this.item, this.actorId); } catch { /* session write is best-effort */ }
    this._accountId = null;
    this._authAccountId = null;
    this._playTermSound('hack-fail');
    this._manualError = message;
    // Show the SYSTEM LOCKDOWN takeover with a live countdown (the "animation of
    // what's happening" — the kick alone read as an unexplained bounce). Keyed on
    // the account that was active; escalation locks them all for the same window.
    if (lockedAcct && this.terminalService?.getAccountLockoutRemaining(this.item, lockedAcct, this.actorId) > 0) {
      this._lockdownAccountId = lockedAcct;
    }
    this._enterState('login');
  }

  _onFolder(event, target) {
    this._currentFolder = target?.dataset?.folder || 'inbox';
    this._currentPage = 1;
    this._selectedMessageId = null;
    // Changing folder clears the MAIL/FILES solo — a folder with no files, still
    // filtered to FILES, would render an empty list with no chips to undo it.
    this._envFilter = 'all';
    this.render(false);
  }

  /**
   * Collapse the mailbox sidebar to a rail — a spreadsheet, camera multiplex or
   * schematic then gets the machine's full width (the MessageViewer's
   * --list-collapsed precedent). Instance state, so it survives re-renders.
   */
  _onToggleSide() {
    this._sideCollapsed = !this._sideCollapsed;
    // DOM-ONLY — do NOT re-render (the MessageViewer's _toggleListPanel does the
    // same). An AppV2 re-render REPLACES the element, so it's born already
    // collapsed and the CSS transition has nothing to animate FROM: the panel
    // just snaps. Toggling the class on the live node is what makes it glide.
    // The template still stamps the class from `_sideCollapsed`, so the state
    // survives the next real render.
    const panes = this.element?.querySelector('.ncm-term__panes');
    panes?.classList.toggle('ncm-term__panes--collapsed', this._sideCollapsed);
    const btn = this.element?.querySelector('.ncm-term__side-toggle');
    if (btn) {
      btn.dataset.tooltip = this._sideCollapsed ? 'Show the mailbox' : 'Hide the mailbox — full-width view';
      const i = btn.querySelector('i');
      if (i) i.className = `fas fa-chevron-${this._sideCollapsed ? 'right' : 'left'}`;
    }
  }

  /**
   * MAIL / FILES solo — real app state, so it SURVIVES the re-render that
   * selecting a message triggers (as a display-only class toggle it reset
   * itself on the very first click). Clicking the active chip returns to ALL.
   */
  _onEnvFilter(event, target) {
    const f = target?.dataset?.f;
    const next = (f === 'mail' || f === 'file') ? f : 'all';
    this._envFilter = (this._envFilter === next && next !== 'all') ? 'all' : next;
    this._currentPage = 1;
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

  /** New message — opens the shared content composer (all content types). */
  _onNewMessage() {
    if (!isGM() || !this._accountId) return;
    import('../ItemInbox/DataShardComposer.js').then(({ DataShardComposer }) => {
      new DataShardComposer({
        target: { kind: 'terminal', item: this.item, accountId: this._accountId },
        onSave: () => this.render(false),
      }).render(true);
    });
  }

  /** Edit message — loads the entry into the shared content composer. */
  _onEditMessage(event, target) {
    if (!isGM()) return;
    const id = target?.dataset?.messageId || this._selectedMessageId;
    const raw = (this.terminalService?.getAccountMessages(this.item, this._accountId) || []).find(m => m.messageId === id);
    if (!raw) return;
    const editData = {
      entryId: id, contentType: raw.contentType || 'message',
      from: raw.from || '', subject: raw.subject || '', body: raw.body || '',
      timestamp: raw.timestamp || '', contentData: raw.contentData ?? {},
      // Envelope + per-entry exfil override (#37) — without these the composer
      // would silently reset a FILE back to mail (and wipe its override) on
      // every edit-save, since the edit path writes entryData straight to flags.
      envelope: raw.envelope || 'mail', file: raw.file || null, exfil: raw.exfil || null,
    };
    import('../ItemInbox/DataShardComposer.js').then(({ DataShardComposer }) => {
      new DataShardComposer({
        target: { kind: 'terminal', item: this.item, accountId: this._accountId },
        editData, onSave: () => this.render(false),
      }).render(true);
    });
  }

  /**
   * GM — the "Move to…" selector (replaced the old bookmark/archive toggles;
   * location semantics: a message lives in exactly one of Trash / Saved /
   * a custom folder / the Inbox). System locations ride status flags, customs
   * ride the `folder` flag; the permanent delete stays a separate confirmed
   * action. Manual `change` listener (selects don't fire via data-action).
   */
  async _onMoveMessage(messageId, loc) {
    if (!isGM() || !messageId) return;
    const system = loc === 'inbox' || loc === 'saved' || loc === 'trash';
    const res = await this.terminalService?.updateAccountMessage(this.item, messageId, {
      folder: system ? '' : loc,
      status: { saved: loc === 'saved', deleted: loc === 'trash' },
    });
    if (!res?.success) ui.notifications.warn(res?.error || 'Move failed.');
    this.render(false);
  }

  async _onDeleteMessage(event, target) {
    if (!isGM()) return;
    const id = target?.dataset?.messageId || this._selectedMessageId;
    const ok = await playerConfirm({ title: 'Delete Message', content: '<p>Permanently delete this message from the terminal?</p>' });
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
      playerDialog({
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
    // Master-directory sender → carry its portrait + linked actor + id so the
    // player contact is a real, portrait-bearing identity (the PortraitService
    // contact-creation rule).
    const master = this._findContactByEmail(msg.from);
    const portrait = master
      ? this.portraitService?.resolvePortrait(master)
      : (msg.fromActorId ? this.portraitService?.resolvePortrait({ actorId: msg.fromActorId }) : null);
    try {
      const existing = (await this.contactRepository?.getContacts(this.actorId)) || [];
      if (msg.from && existing.some(c => (c.email || '').toLowerCase() === msg.from.toLowerCase())) {
        ui.notifications.info(`${name} is already in your contacts.`);
        return;
      }
      await this.contactRepository?.addContact(this.actorId, {
        name, email: msg.from || '',
        actorId: msg.fromActorId || master?.actorId || null,
        portrait: portrait || null,
        masterContactId: master?.id || null,
      });
      ui.notifications.info(`Added ${name} to your contacts.`);
      this.render(false);
    } catch (err) { log.error(`Add-contact from terminal failed: ${err.message}`); }
  }

  /** Sender chip — compose to this sender from the player's OWN Agent. */
  _onReplyAgent(event, target) {
    const msg = this._currentSelectedRaw();
    if (!msg?.from) return;
    game.nightcity?.composeMessage?.({ to: msg.from, subject: msg.subject ? `Re: ${msg.subject}` : '' });
  }

  /**
   * Exfil dispatcher — every exfil chip routes here. Runs the immersive
   * security console (styled confirm + the action's OPTIONAL skill gate from
   * config), then, on pass, performs the action. A gated FAIL fires a trace
   * and aborts (you were logged before the transfer finished). GM/player split
   * lives inside each `_doExfil*`.
   */
  async _onExfilAction(event, target) {
    const action = target?.dataset?.exfil;
    const meta = EXFIL_META[action];
    if (!meta) return;
    const msg = this._currentSelectedRaw();
    if (!msg) return;
    // Per-entry policy (#37): the terminal's policy layered with this entry's
    // override. A denied action renders as a dead chip — clicking it just
    // restates the reason rather than doing nothing.
    const policy = this.terminalService?.resolveEntryExfil?.(this.item, msg);
    const p = policy?.[action];
    if (!p?.allow) {
      if (p?.denied) {
        game.nightcity?.soundService?.play('error');
        ui.notifications.warn(p.denyReason === 'LIVE STREAM'
          ? 'NCM | You can’t copy a live stream — capture a frame instead.'
          : `NCM | ${meta.label} is blocked on this file (${p.denyReason.toLowerCase()}).`);
      }
      return;
    }

    const actor = this.actor || resolveOperator();
    const gated = !!p.require && !!actor;
    const res = await runSecurityConsole({
      title: meta.title, icon: meta.icon, accent: meta.accent, host: this.element,
      intro: meta.intro, confirmLabel: meta.confirm,
      gate: gated ? { require: true, skill: p.skill, dv: p.dv, actor, context: `Exfil: ${meta.label}`, flavor: `${meta.title} // DV ${p.dv}`, net: { verb: 'Control', action: 'exfil', hostItem: this.item } } : null,
      successLabel: meta.ok, failLabel: meta.fail,
    });
    if (res.cancelled) return;
    if (gated && !res.ok) {
      game.nightcity?.traceService?.fireTrace({ actor, action: 'exfil', source: meta.label, hostItem: this.item, dv: p.dv, margin: (res.total ?? p.dv) - p.dv, severity: 'hostile' });
      ui.notifications.warn(`NCM | ${meta.label} traced — the attempt was logged (rolled ${res.total ?? '?'} vs DV ${p.dv}).`);
      return;
    }

    // Exfil authorized (ungated, or the gate passed) — log it to the activity feed.
    game.nightcity?.traceService?.logSuccess({ actor, action: 'exfil', source: meta.label, hostItem: this.item, severity: 'hostile' });
    switch (action) {
      case 'agent':   return this._doExfilInbox(msg);
      case 'shard':   return this._doExfilShard(msg);
      case 'forward': return this._doExfilForward(msg);
      case 'leak':    return this._doExfilLeak(msg);
      case 'sell':    return this._doExfilSell(msg, p.price ?? 0);
      case 'wipe':    return this._doExfilWipe(msg);
      // The channel comes from the clicked button (the monitor rail carries
      // data-index); from the detail menu it's the currently-open channel, and
      // failing that the first capturable one.
      case 'saveFrame': return this._doSaveFrame(msg, target?.dataset?.index);
    }
  }

  /**
   * SAVE FRAME — capture what a feed channel is showing into the operator's
   * Agent (Recovered). The PTZ aim rides in the caption (see
   * TerminalService.exfilSaveFrame for why we don't rasterize the crop).
   */
  async _doSaveFrame(msg, rawIndex) {
    const cd = msg.contentData || {};
    let index = Number(rawIndex);
    if (!Number.isInteger(index) || index < 0) {
      index = (cd.images || []).findIndex(i => i.url && !i.locked && !i.corrupted && !i.cut);
    }
    if (index < 0) { ui.notifications.warn('NCM | No channel to capture.'); return; }
    const targetId = await this._pickOwnedCharacter();
    if (!targetId) return;
    // The PTZ readout, if that channel is a steerable head being driven.
    const aim = this.element?.querySelector('[data-ptz-vp] [data-ptz-read]')?.textContent?.trim() || '';
    closeGalleryLightbox(this.element);
    const fxDone = this._playExfilFx('download', 'frame capture');
    if (isGM()) {
      const res = await this.terminalService.exfilSaveFrame(this.item, this._accountId, msg.messageId, index, targetId, aim);
      await fxDone;
      if (res.success) ui.notifications.info(`NCM | ${res.label} frame saved to ${this._exfilFolder()}.`);
      else ui.notifications.warn(res.error || 'Capture failed.');
    } else {
      this._relayExfil({ dest: 'saveFrame', messageIds: [msg.messageId], targetActorId: targetId, frameIndex: index, aim });
      await fxDone;
      ui.notifications.info(`NCM | Frame captured — check your ${this._exfilFolder()} folder.`);
    }
  }

  async _doExfilInbox(msg) {
    const targetId = await this._pickOwnedCharacter();
    if (!targetId) return;
    const fxDone = this._playExfilFx('download', msg.subject || 'file');
    if (isGM()) {
      const res = await this.terminalService.exfilToInbox(this.item, this._accountId, [msg.messageId], targetId);
      const who = game.actors?.get(targetId)?.name || 'inbox';
      await fxDone;
      if (res.success) ui.notifications.info(`Copied to ${who}'s Agent (${this._exfilFolder()}).`);
      else ui.notifications.warn(res.error || 'Exfil failed.');
    } else {
      // Player can't write the GM-owned inbox journal — relay to the GM.
      this._relayExfil({ dest: 'inbox', messageIds: [msg.messageId], targetActorId: targetId });
      await fxDone;
      ui.notifications.info(`Download requested — check your ${this._exfilFolder()} folder.`);
    }
  }

  /**
   * The Agent folder that catches exfiltrated intel. GM-renameable (the
   * `exfilFolderName` world setting) — every toast, chip and tab reads THIS, so
   * a table that calls it "Salvage" sees "Salvage" everywhere, not in one place.
   */
  _exfilFolder() {
    return game.nightcity?.settingsManager?.getExfilFolderName?.() || 'Exfil';
  }

  /**
   * Immersive exfil overlay — 'download' (terminal → Agent packet stream) or
   * 'burn' (laser-etching the file onto a shard). Purely cosmetic; resolves
   * when the choreography finishes (~2.2s, instant-ish under reduced motion).
   */
  _playExfilFx(kind, label = '') {
    const host = this.element?.querySelector('.ncm-terminal-viewer');
    if (!host) return Promise.resolve();
    host.querySelector('.ncm-term__fx')?.remove();
    const esc = Handlebars.escapeExpression;
    const reduced = !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    const isBurn = kind === 'burn';
    const fx = document.createElement('div');
    fx.className = `ncm-term__fx ncm-term__fx--${kind}`;
    fx.innerHTML = isBurn ? `
      <div class="ncm-term__fx-box">
        <div class="ncm-term__fx-chip"><i class="fas fa-microchip"></i><span class="ncm-term__fx-laser"></span>
          <span class="ncm-term__fx-spark"></span><span class="ncm-term__fx-spark"></span><span class="ncm-term__fx-spark"></span><span class="ncm-term__fx-spark"></span></div>
        <div class="ncm-term__fx-label">BURNING // <span>${esc(label)}</span></div>
        <div class="ncm-term__fx-track"><i></i></div>
        <div class="ncm-term__fx-done"><i class="fas fa-circle-check"></i> BURN COMPLETE</div>
      </div>` : `
      <div class="ncm-term__fx-box">
        <div class="ncm-term__fx-nodes">
          <span class="ncm-term__fx-node"><i class="fas fa-server"></i></span>
          <span class="ncm-term__fx-stream"><b></b><b></b><b></b><b></b><b></b><b></b></span>
          <span class="ncm-term__fx-node ncm-term__fx-node--dst"><i class="fas fa-mobile-screen-button"></i></span>
        </div>
        <div class="ncm-term__fx-label">DOWNLOADING // <span>${esc(label)}</span></div>
        <div class="ncm-term__fx-track"><i></i></div>
        <div class="ncm-term__fx-done"><i class="fas fa-circle-check"></i> SAVED TO RECOVERED</div>
      </div>`;
    host.appendChild(fx);
    this._playTermSound(isBurn ? 'shard-compile' : 'send');
    // Suppress debounced re-renders while the overlay plays — a wipe's own
    // page deletions (and other synced journal writes) fire the page hooks,
    // and a mid-FX render would destroy this DOM.
    this._animationActive = true;
    const climax = reduced ? 150 : 1500;
    return new Promise((resolve) => {
      this._timer(() => {
        fx.classList.add('is-done');
        this._playTermSound(isBurn ? 'shard-insert' : 'receive');
      }, climax);
      this._timer(() => fx.classList.add('is-out'), climax + 700);
      this._timer(() => { fx.remove(); this._animationActive = false; resolve(); }, climax + 1100);
    });
  }

  /** Pick which owned character's Agent inbox to download into. */
  async _pickOwnedCharacter() {
    const owned = (game.actors?.contents ?? []).filter(a =>
      a.type === 'character' && (a.isOwner || a.hasPlayerOwner));
    if (!owned.length) { ui.notifications.warn('No owned character to download into.'); return null; }
    if (owned.length === 1) return owned[0].id;
    const pick = await showNamePicker({
      title: 'Download to Agent',
      hint: "Send to which character's inbox?",
      entries: documentEntries(owned),
      placeholder: 'search characters…',
    });
    return pick?.id || null;
  }

  /** CPR item types that can't physically carry a shard (sheet abstractions,
   *  not objects) — previously the picker listed EVERY actor item, so a CPR
   *  character's dozens of skill items drowned out (and, past the old 50-item
   *  cap, entirely hid) the real gear. */
  static NON_CARRIER_TYPES = ['skill', 'role', 'criticalInjury', 'netarch'];

  async _doExfilShard(msg) {
    // Players pick from their OWN inventory; GMs can also target world items.
    const carrier = (i) => i && !TerminalViewerApp.NON_CARRIER_TYPES.includes(i.type);
    const owned = [...(this.actor?.items ?? [])].filter(carrier);
    const world = isGM() ? game.items.contents.filter(carrier) : [];
    const candidates = [...owned, ...world];
    if (!candidates.length) return ui.notifications.warn('No item to burn onto.');
    const pickedId = await this._pickBurnTarget(owned, world);
    if (!pickedId) return;
    const target = candidates.find(i => i.id === pickedId);
    const fxDone = this._playExfilFx('burn', target.name);
    if (!isGM()) {
      // Player can't convert/write the GM-owned shard journal — relay to the GM.
      this._relayExfil({ dest: 'shard', messageIds: [msg.messageId], targetItemId: pickedId });
      await fxDone;
      return ui.notifications.info(`Burn requested for "${target.name}".`);
    }
    const res = await this.terminalService.exfilToShard(this.item, this._accountId, [msg.messageId], target);
    await fxDone;
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

  /**
   * Burn-target picker — the shared picker on the PLAYER theme: the operator's
   * gear under a Carried chip (a GM also gets World), existing shards first and
   * tagged SHARD. Resolves the picked item id or null.
   */
  async _pickBurnTarget(owned, world) {
    const isShard = (i) => !!i?.flags?.[MODULE_ID]?.isDataShard;
    const build = (items, group) => {
      const byId = new Map(items.map((i) => [i.id, i]));
      return documentEntries(items, { group: () => group, note: (i) => i.type })
        .map((e) => (isShard(byId.get(e.id)) ? { ...e, tag: 'SHARD' } : e))
        .sort((a, b) => ((b.tag === 'SHARD') - (a.tag === 'SHARD')) || a.name.localeCompare(b.name));
    };
    const pick = await showNamePicker({
      admin: false,
      title: 'Burn to Data Shard',
      hint: "Pick the item to burn this file onto. Burning onto an item that isn't a shard converts it.",
      entries: [...build(owned, 'Carried'), ...build(world, 'World')],
      placeholder: 'search items…',
    });
    return pick?.id || null;
  }

  /** Send an exfil request to the GM client (player relay). */
  _relayExfil({ dest, messageIds, targetActorId, targetItemId, forwarder, frameIndex, aim }) {
    game.nightcity?.socketManager?.emit?.(SOCKET_OPS.TERMINAL_EXFIL_REQUEST, {
      requestId: foundry.utils.randomID(),
      userId: game.user.id,
      itemUuid: this.item?.uuid,
      accountId: this._accountId,
      messageIds, dest, targetActorId, targetItemId, forwarder, frameIndex, aim,
    });
  }

  /** Forward a file on to a chosen contact's Agent inbox (GM direct / relay). */
  async _doExfilForward(msg) {
    const targetId = await this._pickMessageableActor('Forward To');
    if (!targetId) return;
    const who = game.actors?.get(targetId)?.name || 'contact';
    const forwarder = { email: this.actor?.getFlag?.(MODULE_ID, 'email') || '', actorId: this.actorId || '' };
    if (isGM()) {
      const res = await this.terminalService.exfilForward(this.item, this._accountId, [msg.messageId], targetId, forwarder);
      if (res.success) ui.notifications.info(`Forwarded to ${who}.`);
      else ui.notifications.warn(res.error || 'Forward failed.');
    } else {
      this._relayExfil({ dest: 'forward', messageIds: [msg.messageId], targetActorId: targetId, forwarder });
      ui.notifications.info(`Forward requested to ${who}.`);
    }
  }

  /** Leak a file to the open Net — a public chat artifact everyone sees. */
  async _doExfilLeak(msg) {
    const esc = Handlebars.escapeExpression;
    const who = this.actor?.name || resolveOperator()?.name || game.user?.name || 'An operator';
    const subject = msg.subject || '(untitled file)';
    const preview = (msg.preview || msg.body || '').toString().replace(/<[^>]*>/g, '').slice(0, 160);
    try {
      await ChatMessage.create({
        speaker: { alias: 'NET // LEAK' },
        content: `<div class="ncm-leak-card"><strong style="color:#ff5252"><i class="fas fa-tower-broadcast"></i> DATA LEAK</strong><div style="margin-top:4px"><em>${esc(subject)}</em> — dumped to the open Net from <b>${esc(this._terminalName())}</b>.</div>${preview ? `<div style="margin-top:4px;opacity:.8;font-size:12px">${esc(preview)}…</div>` : ''}</div>`,
      });
    } catch (err) { log.error(`Leak chat failed: ${err.message}`); }
    this._playTermSound('trace-fire');
    ui.notifications.info(`Leaked "${subject}" to the Net — it's public now.`);
  }

  /** Sell a file to a fixer — credits the operator's wealth at the set price. */
  async _doExfilSell(msg, price) {
    const actor = this.actor || resolveOperator();
    if (!actor) { ui.notifications.warn('No character to bank the eddies.'); return; }
    const amount = Math.max(0, Number(price) || 0);
    if (amount > 0) await this._creditActorWealth(actor, amount, `NCM: Sold "${msg.subject || 'file'}" to a fixer`);
    this._playTermSound('eddies-claim');
    try {
      const gmIds = ChatMessage.getWhisperRecipients('GM').map(u => u.id);
      await ChatMessage.create({
        whisper: gmIds, speaker: { alias: 'FIXER NET' },
        content: `${Handlebars.escapeExpression(actor.name)} sold <em>${Handlebars.escapeExpression(msg.subject || 'a file')}</em>${amount > 0 ? ` for <b>${amount.toLocaleString()} eb</b>` : ''} from ${Handlebars.escapeExpression(this._terminalName())}.`,
      });
    } catch (err) { log.error(`Sell alert failed: ${err.message}`); }
    ui.notifications.info(amount > 0 ? `Sold for ${amount.toLocaleString()} eb — banked to ${actor.name}.` : 'Sold — the fixer sets the price (GM adjudicates).');
  }

  /** Wipe a file off the terminal (GM direct / relay). */
  async _doExfilWipe(msg) {
    if (isGM()) {
      const res = await this.terminalService.exfilWipe(this.item, this._accountId, [msg.messageId]);
      if (res.success) {
        if (this._selectedMessageId === msg.messageId) this._selectedMessageId = null;
        this.render(false);
        ui.notifications.info('File wiped from the terminal.');
      } else ui.notifications.warn(res.error || 'Wipe failed.');
    } else {
      this._relayExfil({ dest: 'wipe', messageIds: [msg.messageId] });
      if (this._selectedMessageId === msg.messageId) this._selectedMessageId = null;
      this.render(false);
      ui.notifications.info('Wipe requested.');
    }
  }

  /** Credit an actor's CPR wealth (the eddies-claim ledger pattern). */
  async _creditActorWealth(actor, amount, reason) {
    try {
      const wealth = foundry.utils.deepClone(actor.system.wealth);
      wealth.value += amount;
      wealth.transactions = wealth.transactions || [];
      wealth.transactions.push([`Increased by ${amount} to ${wealth.value}`, reason]);
      if (actor.isOwner || isGM()) await actor.update({ 'system.wealth': wealth });
    } catch (err) { log.error(`Wealth credit failed: ${err.message}`); }
  }

  /** Pick a messageable character (contacts) to forward to. */
  async _pickMessageableActor(title = 'Send To') {
    const actors = (game.actors?.contents ?? []).filter(a =>
      a.type === 'character' && (a.hasPlayerOwner || a.getFlag?.(MODULE_ID, 'email')));
    if (!actors.length) { ui.notifications.warn('No contacts to send to.'); return null; }
    const pick = await showNamePicker({
      title,
      hint: 'Forward to which contact?',
      entries: documentEntries(actors),
      placeholder: 'search contacts…',
    });
    return pick?.id || null;
  }

  /** Banking content — siphon funds (shared flow; see SiphonFlow.js). */
  async _onSiphonFunds(event, target) {
    const actor = resolveOperator();
    if (!actor) { ui.notifications.warn('NCM | No character assigned.'); return; }
    const id = target?.closest?.('[data-entry-id]')?.dataset.entryId || this._selectedMessageId;
    const raw = (this.terminalService?.getAccountMessages(this.item, this._accountId) || []).find(m => m.messageId === id);
    if (!raw || raw.contentType !== 'banking') return;
    await runSiphon({ actor, raw: raw.contentData, itemUuid: this.item?.uuid, messageId: id, host: this.element });
    this.render(false);
  }

  /** Eddies content — claim into a character's wealth (shared flow). */
  async _onClaimEddies(event, target) {
    const id = target?.closest?.('[data-entry-id]')?.dataset.entryId || this._selectedMessageId;
    const raw = (this.terminalService?.getAccountMessages(this.item, this._accountId) || []).find(m => m.messageId === id);
    if (!raw || raw.contentType !== 'eddies') return;
    let actor = resolveOperator();
    if (!actor) {
      const pickedId = await this._pickOwnedCharacter();
      actor = pickedId ? game.actors?.get(pickedId) : null;
    }
    if (!actor) return;
    const res = await runEddiesClaim({
      actor, raw: raw.contentData, messageId: id,
      sourceLabel: this._terminalName?.() || this.item?.name || 'terminal', host: this.element,
    });
    if (res?.success) this.render(false);
  }

  /** Credentials content — crack a locked entry (shared flow). GM without an
   *  assigned character force-reveals, mirroring the anon-trace precedent. */
  async _onCrackCred(event, target) {
    const id = target?.closest?.('[data-entry-id]')?.dataset.entryId || this._selectedMessageId;
    const idx = Number(target?.dataset?.credIndex);
    const raw = (this.terminalService?.getAccountMessages(this.item, this._accountId) || []).find(m => m.messageId === id);
    if (!raw || raw.contentType !== 'credentials' || Number.isNaN(idx)) return;
    const actor = resolveOperator();
    const ok = await runCrack({ actor, raw: raw.contentData, entryIndex: idx, messageId: id, force: isGM() && !actor, host: this.element });
    if (ok) this.render(false);
  }

  /** Locked sub-content — decrypt a gallery frame / declassify redactions (shared flow). */
  async _onContentUnlock(event, target) {
    const id = target?.closest?.('[data-entry-id]')?.dataset.entryId || this._selectedMessageId;
    const kind = target?.dataset?.unlockKind;
    const raw = (this.terminalService?.getAccountMessages(this.item, this._accountId) || []).find(m => m.messageId === id);
    if (!raw || !kind) return;
    const actor = resolveOperator();
    const ok = await runContentUnlock({
      actor, raw: raw.contentData, kind, index: Number(target?.dataset?.index ?? -1),
      messageId: id, force: isGM() && (!actor || target?.dataset?.unlockForce === '1'), host: this.element,
    });
    if (ok) this.render(false);
  }

  /**
   * Switch the OPERATOR — the character every roll / siphon / claim / skill
   * read in this viewer acts as. Re-resolves `this.actor` (cached in the
   * constructor) so the change takes effect immediately.
   */
  async _onSwitchOperator() {
    // host = this viewer → the FUI modal inherits this terminal's preset.
    if (!(await openOperatorPicker(this.element))) return;
    this.actor = resolveOperator() ?? null;
    this.actorId = this.actor?.id ?? null;
    this.render(false);
  }

  /**
   * ANALYZE — the player-facing file scan (offered on every typed file so its
   * presence can't tell them which one is a trojan).
   */
  async _onAnalyzeFile(event, target) {
    const id = target?.closest?.('[data-entry-id]')?.dataset.entryId || this._selectedMessageId;
    const raw = (this.terminalService?.getAccountMessages(this.item, this._accountId) || []).find(m => m.messageId === id);
    if (!raw) { log.warn(`Terminal analyze: entry lookup failed (id=${id}).`); return; }
    const ok = await runAnalyze({
      actor: this.actor, raw: raw.contentData, contentType: raw.contentType,
      messageId: id, host: this.element,
    });
    if (ok) this.render(false);
  }

  /** Schematic — GM per-point lock toggle from the legend (no roll). */
  async _onSchemLockToggle(event, target) {
    const id = target?.closest?.('[data-entry-id]')?.dataset.entryId || this._selectedMessageId;
    const raw = (this.terminalService?.getAccountMessages(this.item, this._accountId) || []).find(m => m.messageId === id);
    if (!raw) return;
    const ok = await toggleSchematicLock({ raw: raw.contentData, index: Number(target?.dataset?.index ?? -1), messageId: id });
    if (ok) this.render(false);
  }

  /** Camera feed — LOOP / CUT / RESTORE / TAKE CONTROL (shared flow). */
  async _onCamAction(event, target) {
    const id = target?.closest?.('[data-entry-id]')?.dataset.entryId || this._selectedMessageId;
    const act = target?.dataset?.camAct;
    const raw = (this.terminalService?.getAccountMessages(this.item, this._accountId) || []).find(m => m.messageId === id);
    if (!raw || !act) return;
    const ok = await runCamAction({
      actor: resolveOperator(), raw: raw.contentData, act,
      index: Number(target.dataset.index ?? -1), messageId: id, host: this.element,
    });
    // TAKE CONTROL swaps the open monitor's stage in place; the persisted acts
    // close the lightbox before re-rendering (its document listeners clean up).
    if (ok && act !== 'control') { closeGalleryLightbox(this.element); this.render(false); }
  }

  /** GM — jump to a linked scene (calendar events, schematic pins, feed cams). */
  _onGoToScene(event, target) {
    const sceneId = target?.closest?.('[data-scene-id]')?.dataset.sceneId;
    const scene = sceneId ? game.scenes?.get(sceneId) : null;
    if (!scene) { ui.notifications.warn('NCM | Scene not found.'); return; }
    scene.view();
    ui.notifications.info(`NCM | Viewing scene: ${scene.name}`);
  }

  /** Malware — DEPLOY (normal = mark deployed + GM adjudicates; honeypot = trace). */
  async _onDeployMalware(event, target) {
    const id = target?.closest?.('[data-entry-id]')?.dataset.entryId || this._selectedMessageId;
    const raw = (this.terminalService?.getAccountMessages(this.item, this._accountId) || []).find(m => m.messageId === id);
    // A silent return here reads as "DEPLOY does nothing" — say why.
    if (!raw || raw.contentType !== 'malware') {
      log.warn(`Terminal deploy: entry lookup failed (id=${id}, found=${!!raw}, type=${raw?.contentType}).`);
      return;
    }
    const actor = resolveOperator();
    const res = await runMalwareDeploy({ actor, raw: raw.contentData, messageId: id, sourceLabel: this._terminalName(), host: this.element });
    if (res) this.render(false);
  }

  /** Payload — RUN (utility program: gate roll → module-native effect + macro). */
  async _onExecutePayload(event, target) {
    const id = target?.closest?.('[data-entry-id]')?.dataset.entryId || this._selectedMessageId;
    const raw = (this.terminalService?.getAccountMessages(this.item, this._accountId) || []).find(m => m.messageId === id);
    if (!raw || raw.contentType !== 'payload') return;
    const actor = resolveOperator();
    const res = await runPayloadExecute({ actor, raw: raw.contentData, messageId: id, sourceLabel: this._terminalName(), host: this.element, force: isGM() && !actor });
    if (res) this.render(false);
  }

  /** Payload — KILL a running timed effect early. */
  async _onPayloadKill(event, target) {
    const id = target?.closest?.('[data-entry-id]')?.dataset.entryId || this._selectedMessageId;
    const raw = (this.terminalService?.getAccountMessages(this.item, this._accountId) || []).find(m => m.messageId === id);
    if (!raw) return;
    const res = await runPayloadKill({ actor: resolveOperator(), raw: raw.contentData, messageId: id, host: this.element });
    if (res) this.render(false);
  }

  /** Payload — SNIFF a suspected disguised file (roll to unmask). */
  async _onPayloadSniff(event, target) {
    const id = target?.closest?.('[data-entry-id]')?.dataset.entryId || this._selectedMessageId;
    const raw = (this.terminalService?.getAccountMessages(this.item, this._accountId) || []).find(m => m.messageId === id);
    if (!raw) return;
    const actor = resolveOperator();
    const ok = await runPayloadSniff({ actor, raw: raw.contentData, messageId: id, force: isGM(), host: this.element });
    if (ok) this.render(false);
  }

  /**
   * MOTION (#38) — decide what, if anything, animates on THIS render.
   *
   * The whole point is restraint: the terminal re-renders on every click, so
   * anything keyed to "a render happened" would jitter permanently. We compare
   * a cheap signature of the LIST against the last one and only cascade when the
   * list really changed (folder switch, account switch, MAIL/FILES solo, page).
   * Selecting a row inside the same list must NOT re-cascade it — that was the
   * whole failure mode this guards against.
   */
  _stampMotion(context) {
    const el = this.element;
    if (!el || this._state !== 'mailbox') return;

    // Signature of WHAT'S IN the list — deliberately excludes the selection.
    const sig = [
      this._accountId, this._currentFolder, this._envFilter || 'all', this._currentPage,
      (context?.messages || []).map(m => m.messageId).join(','),
    ].join('|');
    const listEl = el.querySelector('.ncm-term__list');
    if (listEl && sig !== this._listSig) {
      listEl.classList.remove('is-fresh');
      void listEl.offsetWidth;            // reflow → the animation actually re-runs
      listEl.classList.add('is-fresh');
    }
    this._listSig = sig;

    // The detail slides only when a DIFFERENT message is opened (not when the
    // same one re-renders because you claimed eddies / decrypted a frame / …).
    const detailEl = el.querySelector('.ncm-term__detail');
    if (detailEl && this._selectedMessageId && this._selectedMessageId !== this._renderedMsgId) {
      detailEl.classList.remove('is-fresh');
      void detailEl.offsetWidth;
      detailEl.classList.add('is-fresh');
    }
  }

  /**
   * MOTION (#38) — the login pick: the chosen card holds (lift + glow) while the
   * others fall away, then the flow continues into the auth dialog / mailbox.
   * The machine reads as RESPONDING to your choice instead of teleporting.
   * Resolves immediately under reduced motion (the visual still resolves, it
   * just doesn't wait).
   */
  async _playCardPick(target) {
    // Works for whichever login style is on screen — cards / roster / portraits
    // are the same "pick → shell" beat. (crt, lockscreen and keypad have their
    // own character and deliberately opt out: no wrapper, no animation.)
    const card = target?.closest?.('.ncm-term__card, .ncm-term__rrow, .ncm-term__port');
    const wrap = card?.closest?.('.ncm-term__cards, .ncm-term__roster, .ncm-term__portraits');
    if (!card || !wrap) return;
    let reduced = false;
    try { reduced = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { /* no matchMedia */ }
    card.classList.add('is-picked');
    wrap.classList.add('is-picking');
    if (reduced) return;
    await new Promise(r => this._timer(r, 260));   // the cards' own transition is .3s
  }

  /**
   * Mark the open feed's channels as capturable (or not) for the lightbox:
   * `data-save-frame` + `data-save-frame-dv` when SAVE FRAME is allowed, and
   * `data-no-copy` when the stream is (as it always is) uncopyable — so the
   * monitor can state the rule instead of silently omitting a button.
   */
  _stampFrameCapture() {
    const msg = this._currentSelectedRaw();
    if (!msg || msg.contentType !== 'gallery' || msg.contentData?.mode !== 'feed') return;
    const policy = this.terminalService?.resolveEntryExfil?.(this.item, msg);
    const sf = policy?.saveFrame;
    const noCopy = !!policy?.master && !!policy?.agent?.denied;
    for (const btn of this.element?.querySelectorAll('.ncm-ct-cam__view') || []) {
      if (sf?.allow) {
        btn.dataset.saveFrame = '1';
        if (sf.require) btn.dataset.saveFrameDv = String(sf.dv);
      }
      if (noCopy) btn.dataset.noCopy = '1';
    }
  }

  /** Credentials — show/hide a secret (client-side only). */
  _onCredToggleSecret(event, target) { toggleSecretReveal(target); }

  /** Syslog — severity filter chips (client-side only). */
  _onSyslogFilter(event, target) { applySyslogFilter(target); }

  /** Gallery — enlarge a thumbnail (immersive NCM lightbox). */
  _onGalleryView(event, target) { openGalleryImage(target, { host: this.element }); }

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
  /**
   * A plain message body on the machine. Used to strip EVERY tag (so a bold line or a
   * list authored in the composer rendered as flat text here while the Agent and the
   * shard kept the formatting); now the shared whitelist cleaner — same output as the
   * other two viewers, pasted inline colours dropped, a tagless body keeps its breaks.
   */
  _sanitizeBody(body) {
    return cleanHtml(String(body ?? ''), { mode: 'rich' });
  }

  _timer(fn, ms) { const t = setTimeout(fn, ms); this._timers.push(t); return t; }

  // ═══════════════════════════════════════════════════════════
  //  Screensaver (config.screensaver — idle dim + drifting marquee)
  // ═══════════════════════════════════════════════════════════

  /** Screensaver view-model — see the screensaver key in _mailboxContext. */
  _screensaverContext(cfg) {
    const ss = cfg.screensaver || {};
    let logo = null;
    if (ss.iconMode !== 'none') {
      if (ss.iconMode === 'fa' && ss.faIcon?.trim()) logo = { icon: ss.faIcon.trim() };
      else if (ss.iconMode === 'image' && ss.imageUrl?.trim()) logo = { imageUrl: ss.imageUrl.trim() };
      else {
        const boot = this._resolveBootIcon(cfg, cfg.theme?.preset || 'classic');
        logo = { icon: boot.icon, imageUrl: boot.imageUrl };
      }
    }
    return {
      text: (ss.text || '').trim() || this._terminalName(),
      logo,
      motion: ['drift', 'bounce', 'static'].includes(ss.motion) ? ss.motion : 'drift',
    };
  }

  /**
   * (Re)arm the idle timer. Any activity inside the window (the document-level
   * capture listener in the constructor) or any re-render lands here; waking
   * just removes the overlay class. Real-time setTimeout is deliberate —
   * idle detection is a real-world concern, not game time.
   */
  _resetScreensaver() {
    if (this._ssTimer) { clearTimeout(this._ssTimer); this._ssTimer = null; }
    if (this._ssActive) {
      this._ssActive = false;
      this.element?.querySelector('.ncm-term__saver')?.classList.remove('ncm-term__saver--on');
    }
    const cfg = this._effectiveConfig();
    if (!cfg?.screensaver?.enabled || this._state !== 'mailbox') return;
    const idleMs = Math.max(10, cfg.screensaver.idleSeconds || 120) * 1000;
    this._ssTimer = setTimeout(() => {
      this._ssActive = true;
      this.element?.querySelector('.ncm-term__saver')?.classList.add('ncm-term__saver--on');
    }, idleMs);
    this._timers.push(this._ssTimer);
  }

  /** @override */
  async close(options) {
    this._timers.forEach(clearTimeout);
    this._timers = [];
    if (this._lockdownTimer) { clearInterval(this._lockdownTimer); this._lockdownTimer = null; }
    Hooks.off('updateItem', this._onItemUpdate);
    Hooks.off('createJournalEntryPage', this._onPageChange);
    Hooks.off('updateJournalEntryPage', this._onPageChange);
    Hooks.off('deleteJournalEntryPage', this._onPageChange);
    if (this._onActivity) {
      document.removeEventListener('pointerdown', this._onActivity, true);
      document.removeEventListener('keydown', this._onActivity, true);
    }
    return super.close(options);
  }
}
