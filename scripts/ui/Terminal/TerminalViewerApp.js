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
import { MODULE_ID, TERMINAL_PRESETS, SOCKET_OPS, EVENTS } from '../../utils/constants.js';
import { log, isGM, formatCyberDate, buildTerminalThemePrefs, resolveTerminalSound, resolveOperator, openOperatorPicker, getOperatorActors, isHiddenCharacter, canOperate, guardSecretInputs, terminalReachRule } from '../../utils/helpers.js';
import { playerConfirm, playerDialog } from '../../utils/adminTheme.js';
import { getInitials } from '../../utils/designHelpers.js';
import { showNamePicker, documentEntries } from '../../utils/namePicker.js';
import { cleanHtml } from '../../utils/richText.js';
import { SHARED_SCOPE, listingFor, formatSize, gateLabel, parentPath } from '../../utils/terminalFiles.js';
import { enrichContent, toggleSecretReveal, applySyslogFilter, openGalleryImage, closeGalleryLightbox, resolveEnvelope, CONTENT_TYPE_INFO, displayContentType, programEffectInfo } from '../content/ContentRenderers.js';
import { runSiphon, runEddiesClaim, runCrack, runMalwareDeploy, runContentUnlock, runCamAction, runPayloadExecute, runPayloadKill, runPayloadSniff, runAnalyze, toggleSchematicLock } from '../content/SiphonFlow.js';
import { runSecurityConsole } from '../content/SecurityConsole.js';
import { resolveEncoderConfig, isEligibleBlank, blankRuleRefusal } from '../content/EncoderModel.js';
import { adminLabelFor, resolveAdminAccess, adminReadOnlyBlocks } from '../../utils/terminalAdmin.js';
import { shardTerm as T, withArticle } from '../../utils/shardTerm.js';
import { NetworkAuthDialog } from '../NetworkManagement/NetworkAuthDialog.js';
import { playBootVideo } from '../content/BootVideo.js';
import { bypassDCFor } from '../../utils/bypassSkills.js';
import { applyCrt, resolveCrt, CRT_OFF, capCrt, playerCrtCap } from '../../utils/crt.js';

const PRIORITY_ICONS = { critical: 'fa-triangle-exclamation', urgent: 'fa-circle-exclamation', normal: 'fa-circle-info' };

/**
 * Exfil action presentation — the menu chip + the security-console framing for
 * each action. `order` drives menu position. Keyed by the action id the policy
 * (`TerminalService.getExfilPolicy`) uses.
 */
const EXFIL_META = {
  agent:   { order: 1, label: 'To my Agent',    icon: 'fas fa-download',    accent: 'cyan',   title: 'Download to Agent', confirm: 'Download', intro: 'AltLink this file across to your Agent.', ok: 'DOWNLOAD COMPLETE', fail: 'DOWNLOAD TRACED' },
  // label/title/intro follow the world's word for a shard (utils/shardTerm.js), read when shown.
  shard:   { order: 2, get label() { return `Burn to ${T('short')}`; }, icon: 'fas fa-sd-card', accent: 'gold', get title() { return `Burn to ${T('one')}`; }, confirm: 'Burn', get intro() { return `Etch this file onto ${withArticle(T('one', 'lower'))} — your go-bag copy.`; }, ok: 'BURN COMPLETE', fail: 'BURN TRACED' },
  forward: { order: 3, label: 'Forward',         icon: 'fas fa-share',       accent: 'cyan',   title: 'Forward to Contact', confirm: 'Forward', intro: 'Send this file on to one of your contacts as a message.', ok: 'FORWARD SENT', fail: 'FORWARD TRACED' },
  leak:    { order: 4, label: 'Leak to the Net', icon: 'fas fa-tower-broadcast', accent: 'red', title: 'Leak to the Net', confirm: 'Leak', intro: 'Dump this file to the open Net. Once it’s out, it’s out — and loud.', ok: 'LEAKED', fail: 'LEAK TRACED' },
  sell:    { order: 5, label: 'Sell to a Fixer', icon: 'fas fa-hand-holding-dollar', accent: 'gold', title: 'Sell to a Fixer', confirm: 'Sell', intro: 'Move this file to a fixer for eddies. They pay for what’s useful.', ok: 'DEAL CLOSED', fail: 'DEAL TRACED' },
  wipe:    { order: 6, label: 'Wipe Original',   icon: 'fas fa-eraser',      accent: 'red',    title: 'Wipe Original', confirm: 'Wipe', intro: 'Delete this file from the terminal for good. Cover your tracks.', ok: 'FILE WIPED', fail: 'WIPE TRACED' },
  // SAVE FRAME (#37) — the stream escape hatch. You can't download a live feed;
  // you CAN take a picture of what it's showing. Feed galleries only.
  saveFrame: { order: 0, label: 'Save Frame', icon: 'fas fa-camera', accent: 'green', title: 'Save Frame', confirm: 'Capture', intro: 'You can’t copy a live stream — but you can grab what it’s showing right now.', ok: 'FRAME CAPTURED', fail: 'CAPTURE TRACED' },
};

/**
 * Delegate an AppV2 action to the bound instance method of the same name. A handler that throws
 * (or rejects) is SAID out loud — testers reported "clicking does nothing" with no console open
 * (2026-10-29), and a swallowed error looks exactly like a dead button.
 */
function action(method) {
  return function (event, target) {
    const fail = (err) => {
      log.error(`Terminal action ${method} failed:`, err);
      ui.notifications?.error?.(`NCM | Terminal: ${method.replace(/^_on/, '')} failed — ${err?.message || err}`);
    };
    if (typeof this[method] !== 'function') { fail(new Error('no handler')); return; }
    try {
      const r = this[method](event, target);
      return r?.catch ? r.catch(fail) : r;
    } catch (err) { fail(err); }
  };
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
      terminalAdminView: action('_onAdminView'),
      terminalAdminBack: action('_onAdminBack'),
      terminalAdminPick: action('_onAdminPick'),
      terminalComposeAs: action('_onComposeAs'),
      terminalReplyAs: action('_onReplyAs'),
      terminalLogout: action('_onLogout'),
      terminalFolder: action('_onFolder'),
      terminalMoveTo: action('_onMoveTo'),
      terminalTtyCmd: action('_onTtyCmdClick'),
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
      terminalView: action('_onView'),
      terminalFsOpen: action('_onFsOpen'),
      terminalFsBack: action('_onFsBack'),
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
  _viewAs = null;             // ADMIN ACCESS: the account an admin is viewing (null = its own) — see _boxId()
  _authAccountId = null;      // account currently being authenticated (manual state)
  _selectedMessageId = null;
  _currentFolder = 'inbox';
  _currentPage = 1;
  // MAIL | FILES view (2026-10-25) and the open folder of the FILES tree
  // ({ scope: SHARED_SCOPE | accountId, path }). Both are app state so they
  // survive the re-render every click triggers.
  _view = 'mail';
  _fsSel = null;
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
  /**
   * Accounts unlocked in THIS window → the credentials they were unlocked
   * against (tester 2026-10-27: a player who once typed a password got in
   * forever — after closing, refreshing, even after the GM changed the
   * password — because "unlocked" lived on the item's session record, which
   * only Relock cleared). The session is the open window now: closing it,
   * Log out, or a refresh ends it, and a changed password no longer matches.
   * @type {Map<string, string>}
   */
  _unlocked = new Map();

  constructor(options = {}) {
    super(options);
    this.item = options.item;
    this.actor = options.actor ?? resolveOperator() ?? null;
    this.actorId = this.actor?.id ?? null;
    const cfg = this.terminalService?.getConfig(this.item);
    this._state = (cfg?.boot?.enabled) ? 'boot' : this._resolveEntryState();
    // A session left on the item by a window that never closed cleanly (a
    // refresh, a closed browser) ends here, so the record matches reality.
    this._clearStoredSession();
    // The machine's uplink is world state on the item — a relayed player switch
    // or a GM-side edit lands as an item update on every client, so re-render
    // off the document sync (this is also what refreshes the requesting player
    // after their socket-relayed switch). Skipped mid-animation states.
    this._onItemUpdate = (doc, changes) => {
      if (doc.id !== this.item?.id) return;
      if (!foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`)) return;
      // The GM changed this account's password / login methods while we were
      // in it: the unlock no longer holds — back to the login screen.
      if (this._accountId && this._state === 'mailbox' && this._needsAuth(this._accountId)) {
        this._endSession('CREDENTIALS CHANGED — log in again.');
        return;
      }
      if (this._state === 'boot' || this._state === 'granted') return;
      this._recheckGate();   // the GM may have just opened it up
      this._debouncedRender();
    };
    Hooks.on('updateItem', this._onItemUpdate);
    // network nodes: a node switched off / jammed can cut this machine's uplink on the viewed scene
    this._onNodesChange = (setting) => {
      if (setting?.key !== `${MODULE_ID}.networkNodes`) return;
      if (this._state === 'boot' || this._state === 'granted') return;
      this._debouncedRender();
    };
    Hooks.on('updateSetting', this._onNodesChange);
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
  async _prepareContext(options) {
    try { return await this._buildContext(options); } catch (err) {
      // Same reason as action(): a context that throws leaves the window frozen on its last frame.
      log.error('Terminal render failed:', err);
      ui.notifications?.error?.(`NCM | Terminal could not draw this screen — ${err?.message || err}`);
      throw err;
    }
  }

  async _buildContext() {
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
      // Mailbox layout (TERMINAL_MAILBOX_STYLES) — a root attribute so CSS can
      // skin per style; the mailbox context adds the per-style flags.
      mailboxStyle: cfg.mailboxStyle || 'classic',
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
    if (this._state === 'mailbox' && this._accountId && this._viewAs
        && !this.terminalService?.adminViewVerdict(this.item, this._accountId, this._viewAs)?.ok) {
      this._viewAs = null; this._selectedMessageId = null; this._fsSel = null;
      ui.notifications?.warn(`${this._terminalName()}: that account can no longer be viewed.`);
    }
    if (this._state === 'mailbox' && this._accountId) {
      const acct = this.terminalService?.getAccount(this.item, this._accountId);
      if (acct && !this.terminalService.uplinkReaches(this.item, acct.network)) {
        this._accountId = null;
        this._viewAs = null;
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
      skillBypass: (sec.allowSkillCheck ?? true) ? { skill, dv: bypassDCFor(sec, skill) } : null,
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
      customSeconds: boot.customSeconds ?? null,
      // VIDEO boot (2026-10-25): the video IS the splash — the template drops the
      // choreography and BootVideo.js runs the stage.
      isVideo: !!(boot.videoUrl || '').trim(),
      videoUrl: (boot.videoUrl || '').trim(),
      videoOverlay: !!boot.videoOverlay,
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
    const net = terminalReachRule(cfg.network || {});
    const isAny = (net.accessMode ?? 'any') === 'any';
    const named = isAny ? [] : (net.allowedNetworks || []).map(id => this.networkService?.getNetwork?.(id)).filter(Boolean);
    const reqName = named.map(n => n.name).join(' or ') || (isAny ? 'any network' : 'an authorized network');
    const currentId = this.networkService?.currentNetworkId;
    const networks = (this.networkService?.getAvailableNetworks?.() || []).map(n => {
      const isCurrent = n.id === currentId;
      const isAllowed = this.networkService.networkPasses(net, n);
      const requiresAuth = n.security?.requiresAuth && !this.networkService?.isAuthenticated?.(n.id);
      let statusClass = 'deny', statusLabel = 'DENIED';
      if (isCurrent) { statusClass = 'conn'; statusLabel = 'CONNECTED'; }
      else if (isAllowed && requiresAuth) { statusClass = 'sec'; statusLabel = '<i class="fas fa-lock"></i> SECURED'; }
      else if (isAllowed) { statusClass = 'valid'; statusLabel = '<i class="fas fa-check"></i> VALID'; }
      const signal = n.signalStrength ?? 70;
      return {
        id: n.id, name: n.name, typeLabel: n.type || 'Subnet', signal,
        color: n.theme?.color || '#19f3f7', icon: `fas ${n.theme?.icon || 'fa-wifi'}`, theme: n.theme || null,
        isCurrent, isRequired: named.some(r => r.id === n.id), weak: signal < 50,
        // Only a network that would let them in can be clicked; a denied one would just move their connection.
        canClick: isAllowed && !isCurrent,
        statusClass, statusLabel,
      };
    });
    const skill = (cfg.network?.bypassSkills || [])[0];
    return {
      requiredNetwork: reqName,
      requiredSecured: named.some(n => n.security?.requiresAuth),
      networks,
      spoof: skill ? { skill, dv: cfg.network?.bypassDV ?? 18 } : null,
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
      skillBypass: (account && security.allowSkillCheck && skill) ? { skill, dv: bypassDCFor(security, skill) } : null,
      keyItemBypass: (account && security.allowKeyItem && security.keyItemName) ? { name: security.keyItemName } : null,
      error: this._manualError,
      lockout,
    };
  }

  async _mailboxContext(cfg) {
    // The BOX is whose mailbox is on screen: the viewed account while an admin
    // views another one (_viewAs), else the logged-in account. Rights (folder
    // gates, read-only) stay the logged-in admin's.
    const account = this.terminalService?.getAccount(this.item, this._boxId());
    const raw = this._boxMessages();

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
    // MAIL | FILES is a VIEW, not a filter (2026-10-25, terminalFiles.js): the
    // mail folders hold mail, and a file only when it is in the Trash (a
    // deleted file sits in the shredder like anything else); FILES is the
    // directory tree built from every live file's path, across this account's
    // home and the machine's shared volume.
    const mailish = all.filter(m => m.envelope !== 'file' || m.status?.deleted);
    const liveFiles = all.filter(m => m.envelope === 'file' && !m.status?.deleted);
    const isFilesView = this._view === 'files';
    const counts = Object.fromEntries(folderDefs.map(fd => [fd.id, mailish.filter(inFolder[fd.id]).length]));
    const unread = Object.fromEntries(folderDefs.map(fd => [fd.id, mailish.filter(inFolder[fd.id]).filter(m => !m.status?.read && !m.status?.deleted).length]));
    const folder = inFolder[this._currentFolder] ? this._currentFolder : 'inbox';
    let list = mailish.filter(inFolder[folder]);
    // Mailbox STYLE (2026-10-25): tabs / tty / desktop are skins over this same
    // context; the desktop shows the drives as icons even in MAIL view, so it
    // builds the files context regardless (the listing stays hidden there).
    const style = cfg.mailboxStyle || 'classic';
    let fsCtx = null;
    if (isFilesView || style === 'desktop') {
      fsCtx = this._filesContext(account, all, liveFiles);
      fsCtx.otherHomes = this._otherHomesContext();
      if (isFilesView) list = fsCtx.listFiles;   // the open folder's files are what the detail can show
      else fsCtx.showListing = false;
    }

    // "N objects failed to sync" — GM-toggleable per terminal (showSyncHint).
    // Counted within the current folder so the number matches what's missing
    // from the list the player is looking at. GM never needs the hint.
    let syncHint = null;
    if (!isGM() && cfg.connection?.showSyncHint !== false) {
      const hiddenInFolder = raw.filter(m =>
        !this.terminalService.isContentVisible(this.item, m.networkVisibility) && inFolder[folder](m));
      if (hiddenInFolder.length) syncHint = { count: hiddenInFolder.length };
    }

    const fileCount = list.filter(m => m.envelope === 'file').length;

    if (this._selectedMessageId && !list.find(m => m.messageId === this._selectedMessageId)) this._selectedMessageId = null;
    // FILES view opens on the folder LISTING, not on its first file.
    if (!this._selectedMessageId && list.length && !isFilesView) this._selectedMessageId = list[0].messageId;

    // Pagination (the FILES listing scrolls instead).
    const PAGE = isFilesView ? Math.max(1, list.length) : TerminalViewerApp.PAGE_SIZE;
    const maxPage = Math.max(1, Math.ceil(list.length / PAGE));
    if (this._currentPage > maxPage) this._currentPage = maxPage;
    if (this._currentPage < 1) this._currentPage = 1;
    const start = (this._currentPage - 1) * PAGE;
    const pageItems = list.slice(start, start + PAGE);

    const gm = isGM();
    const messages = pageItems.map(m => this._rowVm(m, gm));
    // The TTY prompt opens entries by NUMBER — the numbers are the rows as shown.
    this._ttyList = isFilesView ? (fsCtx?.listFiles || []) : pageItems;

    const folderDef = folderDefs.find(fd => fd.id === folder) || folderDefs[0];
    const selected = list.find(m => m.messageId === this._selectedMessageId);
    // HUD shows the MACHINE's uplink (the pill), never the player's network.
    return {
      hud: {
        // The logged-in account's rank — not the box's (an admin viewing another account is still an admin).
        isAdmin: !!this.terminalService?.getAccount(this.item, this._accountId)?.isAdmin,
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
      // ADMIN ACCESS: the banner while viewing, and the View-as list in the switcher.
      adminView: this._adminViewContext(cfg),
      adminTargets: this._switcherOpen ? this._adminTargetsContext() : [],
      // SEND AS THE ACCOUNT (config.accountMail.compose) — WRITE in the HUD, Reply as on mail.
      composeAs: this._composeAsContext(),
      folders: folderDefs.map(fd => ({
        key: fd.id, label: fd.name, icon: fd.icon, count: counts[fd.id] ?? 0, unread: unread[fd.id] ?? 0, active: folder === fd.id,
      })),
      // Mailbox style flags + the bits only a style needs (tty prompt, desktop window/clock).
      mailboxStyle: style,
      msTabs: style === 'tabs', msTty: style === 'tty', msDesktop: style === 'desktop',
      ttyPrompt: `${this._viewAs ? (this.terminalService?.getAccount(this.item, this._accountId)?.username || 'admin') : (account?.username || 'guest')}@${this._terminalName().replace(/\s+/g, '-').toUpperCase()}:${isFilesView ? '/' + (this._fsSel?.path || '') : '~/' + (folderDef?.name || 'inbox').toLowerCase().replace(/\s+/g, '_')}$`,
      deskWindow: isFilesView
        ? { title: '/' + (fsCtx?.listing?.path || '') + (fsCtx?.listing?.isShared ? '  (shared)' : ''), icon: 'fas fa-folder-open' }
        : { title: folderDef?.name || 'Inbox', icon: folderDef?.icon || 'fas fa-inbox' },
      deskClock: formatCyberDate(game.nightcity?.timeService?.getCurrentTime?.() || new Date().toISOString()),
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
      // MAIL | FILES view switch + the FILES tree/listing (2026-10-25).
      isFilesView,
      view: { mail: mailish.filter(m => !m.status?.deleted).length, files: liveFiles.length },
      fs: fsCtx,
      // A file opened from the FILES tree gets a "back to the folder" chip.
      fsBack: isFilesView && !!selected,
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
        denied: !policy[k].allow || this._adminReadOnly(k),
        denyReason: this._adminReadOnly(k) && policy[k].allow ? 'ADMIN: READ-ONLY' : policy[k].denyReason,
      }));
  }

  // ═══════════════════════════════════════════════════════════
  //  ADMIN ACCESS — view another account (utils/terminalAdmin.js)
  // ═══════════════════════════════════════════════════════════

  /** Whose mailbox is on screen: the viewed account, else the logged-in one. */
  _boxId() { return this._viewAs || this._accountId; }

  /** The box's entries, folder gates judged with the LOGGED-IN account's rights. */
  _boxMessages() {
    return this.terminalService?.getAccountMessages(this.item, this._boxId(), this._viewAs ? { gateAccountId: this._accountId } : {}) || [];
  }

  /** What players see the admin view called (theme.adminLabel → preset → default). */
  _adminLabel() { return adminLabelFor(this._effectiveConfig?.() || {}, TERMINAL_PRESETS); }

  /** Read-only viewing blocks the actions that change the machine (Wipe). */
  _adminReadOnly(action) {
    if (!this._viewAs) return false;
    return resolveAdminAccess(this._effectiveConfig?.() || {}).rights === 'read' && adminReadOnlyBlocks(action);
  }

  /** The banner view-model, or null when not viewing. */
  _adminViewContext(cfg) {
    if (!this._viewAs) return null;
    const t = this.terminalService?.getAccount(this.item, this._viewAs);
    if (!t) return null;
    const name = t.displayName || t.username || 'account';
    return {
      label: adminLabelFor(cfg, TERMINAL_PRESETS),
      name, username: t.username || name,
      initials: getInitials(name), portrait: this._accountPortrait(t),
      readOnly: resolveAdminAccess(cfg).rights === 'read',
    };
  }

  /** The View-as list for the switcher (only for an admin account). */
  _adminTargetsContext() {
    const svc = this.terminalService;
    if (!svc?.getAccount(this.item, this._accountId)?.isAdmin) return [];
    return (svc.adminViewTargets(this.item, this._accountId) || []).map(({ account: a, verdict }) => ({
      id: a.id, displayName: a.displayName || a.username,
      initials: getInitials(a.displayName || a.username || '?'), portrait: this._accountPortrait(a),
      hidden: !!a.hidden, ok: verdict.ok, reason: verdict.reason, isViewing: a.id === this._viewAs,
    }));
  }

  /** Other accounts' homes for the FILES tree (an admin only): click = view that account. */
  _otherHomesContext() {
    const svc = this.terminalService;
    const me = svc?.getAccount(this.item, this._accountId);
    if (!me?.isAdmin) return [];
    const out = [];
    if (this._viewAs) out.push({ id: me.id, username: me.username || me.displayName, tag: 'YOU', ok: true, isBack: true });
    for (const { account: a, verdict } of (svc.adminViewTargets(this.item, this._accountId) || [])) {
      if (a.id === this._viewAs) continue;
      out.push({ id: a.id, username: a.username || a.displayName, tag: a.hidden ? 'HIDDEN' : '', ok: verdict.ok, reason: verdict.reason });
    }
    return out;
  }

  /** The WRITE / Reply-as view-model: who the mail goes out as, or null when off. */
  _composeAsContext() {
    const svc = this.terminalService;
    const box = this._boxId();
    if (!box || !svc?.canAccountCompose?.(this.item, box) || this._adminReadOnly('send')) return null;
    const id = svc.accountSendIdentity(this.item, box);
    return { username: id.username, name: id.name, email: id.email };
  }

  /** Open the composer AS the account on screen (its identity, its address book). */
  _openComposeAs(extra = {}) {
    const svc = this.terminalService;
    const box = this._boxId();
    if (!this._composeAsContext()) return ui.notifications.warn(`${this._terminalName()}: this account can't send mail.`);
    const id = svc.accountSendIdentity(this.item, box);
    // The player's OWN account (they own its character) — their own mail, not an
    // impersonation: eddies allowed, no intrusion row in the Activity Log.
    const ownerActor = id.fromActorId ? game.actors?.get(id.fromActorId) : null;
    const own = !isGM() && !!ownerActor?.isOwner;
    const op = resolveOperator();
    game.nightcity?.composeMessage?.({
      fromActorId: id.fromActorId, fromContactId: id.fromContactId,
      terminalSend: {
        itemUuid: this.item.uuid, accountId: box, username: id.username, machine: this._terminalName(), own,
        operatorId: op?.id || '', operatorName: op?.name || game.user.name,
      },
      addressBook: svc.accountAddressBook(this.item, box),
      ...extra,
    });
  }

  _onComposeAs() { this._openComposeAs(); }

  /** Reply AS the account to the open message (back to its sender, threaded). */
  _onReplyAs() {
    const msg = this._currentSelectedRaw();
    if (!msg) return;
    this._openComposeAs({ mode: 'reply', originalMessage: msg });
  }

  /** Start viewing another account (no credentials). Logged to the Activity Log. */
  _startAdminView(targetId, { files = false } = {}) {
    const svc = this.terminalService;
    const v = svc?.adminViewVerdict(this.item, this._accountId, targetId);
    if (!v?.ok) { ui.notifications?.warn(`${this._terminalName()}: ${v?.reason || 'that account cannot be viewed'}.`); return; }
    this._viewAs = targetId;
    this._switcherOpen = false;
    this._selectedMessageId = null;
    this._currentFolder = 'inbox';
    this._currentPage = 1;
    this._fsSel = null;
    if (files) this._view = 'files';
    const t = svc.getAccount(this.item, targetId);
    const me = svc.getAccount(this.item, this._accountId);
    try {
      game.nightcity?.traceService?.logSuccess({
        actor: this.actor, action: 'admin-view', hostItem: this.item, severity: 'minor',
        source: `${me?.username || 'admin'} viewed ${t?.username || targetId}`,
      });
    } catch (e) { log.debug('admin-view log failed', e); }
    this._playTermSound('login-success');
    this.render(false);
  }

  _onAdminView(event, target) {
    const id = target?.dataset?.accountId;
    if (!id) return;
    if (id === this._accountId) return this._onAdminBack();
    this._startAdminView(id, { files: target?.dataset?.files === '1' });
  }

  _onAdminBack() {
    if (!this._viewAs) return;
    this._viewAs = null;
    this._switcherOpen = false;
    this._selectedMessageId = null;
    this._currentFolder = 'inbox';
    this._currentPage = 1;
    this._fsSel = null;
    this.render(false);
  }

  /** "View another…" on the banner opens the account switcher (where the View-as list is). */
  _onAdminPick() {
    this._switcherOpen = true;
    this.render(false);
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
        portrait: this._senderPortrait(msg),
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
        const ICON = { inbox: 'fas fa-inbox', saved: 'fas fa-bookmark', trash: 'fas fa-trash' };
        return all.map(fd => ({ id: fd.id, name: fd.name, icon: fd.icon || ICON[fd.id] || 'fas fa-folder', selected: fd.id === loc }));
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
      // FILES view (2026-10-25): the tree and the folder listing are scrollers too.
      tree: el.querySelector('.ncm-term__fs-tree')?.scrollTop ?? 0,
      listing: el.querySelector('.ncm-term__fs-scroll')?.scrollTop ?? 0,
      fsKey: this._fsSel ? `${this._fsSel.scope}:${this._fsSel.path}` : null,
    };
  }

  /** @override */
  _onRender(context, options) {
    try { this._onRenderInner(context, options); } catch (err) {
      log.error('Terminal post-render wiring failed:', err);
      ui.notifications?.error?.(`NCM | Terminal: a control failed to wire up — ${err?.message || err}`);
    }
  }

  _onRenderInner(context, options) {
    super._onRender(context, options);
    guardSecretInputs(this.element); // read-only until touched — no browser autofill
    this._wireDragMove();
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
    // The ONE CRT film (crt.css): this terminal's theme.crt (a legacy scanlines:true
    // reads as a look), else its preset's crt, else off — painted on the WINDOW ROOT
    // (header included) over the player's own film, and capped by the player's
    // accessibility setting. The viewer element itself carries no film.
    this.refreshCrt();
    if (viewerEl && viewerEl !== this.element) applyCrt(viewerEl, CRT_OFF);
    viewerEl?.setAttribute('data-term-flicker', String(themeCfg.flicker === true));
    this._syncWindowTitle(context);
    // TTY mailbox style: the prompt line. Enter runs the command; focus returns
    // to it after a command so the keyboard flow never breaks.
    // Every command runs on Enter (or the ⏎ button beside the prompt).
    const tty = this.element?.querySelector('[data-tty-prompt]');
    if (tty) {
      const run = () => { const v = tty.value; tty.value = ''; this._onTtyCommand(v); };
      tty.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); run(); }
      });
      this.element.querySelector('[data-tty-run]')?.addEventListener('click', (e) => { e.preventDefault(); run(); });
      // The caret waits in the prompt: after a command, and on every render unless something else
      // in this window (a field, the Move menu) has the focus.
      const busy = document.activeElement && this.element.contains(document.activeElement) && document.activeElement !== tty && document.activeElement !== document.body;
      if (this._ttyFocus || !busy) { this._ttyFocus = false; tty.focus({ preventScroll: true }); }
    }
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
      const tree = this.element?.querySelector('.ncm-term__fs-tree');
      if (tree && memo.tree) tree.scrollTop = memo.tree;
      const fsKey = this._fsSel ? `${this._fsSel.scope}:${this._fsSel.path}` : null;
      if (memo.listing && fsKey && fsKey === memo.fsKey) {
        const ls = this.element?.querySelector('.ncm-term__fs-scroll');
        if (ls) ls.scrollTop = memo.listing;
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

  /** Boot length per speed chip, as a multiple of BOOT_BASE_MS. 'dramatic' is
   *  deliberately well past the shard's 1.4 — the tester could not tell it
   *  from normal. 'custom' reads boot.customSeconds (whole-boot length). */
  static BOOT_SPEED_MULT = { fast: 0.5, normal: 1.0, dramatic: 1.9 };
  static BOOT_BASE_MS = 2100;

  /** Whole-boot hold in ms for a boot config (speed chip or custom seconds). */
  static bootHoldMs(boot = {}) {
    const base = TerminalViewerApp.BOOT_BASE_MS;
    if (boot.speed === 'custom') {
      const s = Number(boot.customSeconds);
      if (Number.isFinite(s) && s > 0) return Math.round(Math.min(60, Math.max(0.5, s)) * 1000);
      return base;
    }
    return Math.round(base * (TerminalViewerApp.BOOT_SPEED_MULT[boot.speed] ?? 1));
  }

  _playBoot() {
    if (this._bootPlayed) return;
    this._bootPlayed = true;
    const bootEl = this.element?.querySelector('.ncm-term__boot');
    if (!bootEl) { this._afterBoot(); return; }
    const bootCfg = this._effectiveConfig().boot || {};
    // VIDEO boot (2026-10-25): no choreography, no boot sound — the video's own
    // audio and its own length rule the boot; click skips; reduced motion skips
    // the whole thing like it skips the choreography. BootVideo.js owns the
    // wall-clock cap so a bad path can never leave a black stage.
    if ((bootCfg.videoUrl || '').trim()) {
      const level = this.themeService?.getAnimationLevel?.() || 'full';
      if (level !== 'full') { this._afterBoot(); return; }
      this._bootVideo = playBootVideo(bootEl, {
        url: bootCfg.videoUrl.trim(),
        onDone: () => {
          this._bootVideo = null;
          bootEl.style.transition = 'opacity .4s'; bootEl.style.opacity = '0';
          this._timer(() => this._afterBoot(), 420);
        },
      });
      return;
    }
    this._playTermSound('shard-boot');
    // Speed was a dead chip until 2026-10-25: this hold was a literal 2100 and
    // the log-line stagger lived in CSS nth-child delays, so fast / normal /
    // dramatic rendered identically. Everything below scales off ONE hold.
    const hold = TerminalViewerApp.bootHoldMs(this._effectiveConfig().boot || {});
    const fill = bootEl.querySelector('.ncm-term__boot-fill');
    if (fill) fill.style.transition = `width ${Math.round(hold * 0.85)}ms cubic-bezier(.22,1,.36,1)`;
    requestAnimationFrame(() => { if (fill) fill.style.width = '100%'; });
    const lines = bootEl.querySelectorAll('.ncm-term__boot-log div');
    // Lines land evenly across the first ~80% of the hold (the CSS nth-child
    // delays stay as the no-JS fallback; an inline animation-delay beats them).
    const step = lines.length ? Math.min(Math.round(hold * 0.8 / lines.length), Math.round(350 * hold / TerminalViewerApp.BOOT_BASE_MS)) : 0;
    const lead = Math.round(hold * 0.12);
    lines.forEach((d, i) => { d.style.animationDelay = `${lead + i * step}ms`; });
    this._timer(() => {
      bootEl.style.transition = 'opacity .4s'; bootEl.style.opacity = '0';
      this._timer(() => this._afterBoot(), 420);
    }, hold);
  }

  _afterBoot() { this._enterState(this._resolveEntryState()); }

  // ═══════════════════════════════════════════════════════════
  //  Session — what THIS window has unlocked
  // ═══════════════════════════════════════════════════════════

  /** The account's login settings as one string — any change re-locks it. */
  _credKey(accountId) {
    const s = this.terminalService?.getAccount(this.item, accountId)?.security || {};
    return JSON.stringify([
      !!s.requiresAuth, s.allowPassword ?? null, s.password || '',
      !!s.allowSkillCheck, s.bypassSkills || [], s.bypassSkillDCs || {}, s.bypassDC ?? null,
      !!s.allowKeyItem, s.keyItemName || '', s.keyItemTag || '', s.authLogic || 'any',
    ]);
  }

  /**
   * Does entering this account need a login? Not for an open account or a
   * GM force-unlocked terminal; otherwise only if THIS window has not unlocked
   * it against the account's CURRENT credentials.
   */
  _needsAuth(accountId) {
    if (this.terminalService?.getState(this.item)?.gmBypassed) return false;
    const account = this.terminalService?.getAccount(this.item, accountId);
    if (!account?.security?.requiresAuth) return false;
    return this._unlocked.get(accountId) !== this._credKey(accountId);
  }

  /** Clear this operator's stored session on the item (best effort, players relay). */
  _clearStoredSession() {
    if (!this.actorId || !this.item) return;
    try {
      const s = this.terminalService?.getSession(this.item, this.actorId);
      if (s?.activeAccountId || s?.loggedInAccounts?.length) {
        this.terminalService.logout(this.item, this.actorId, true)?.catch?.(() => {});
      }
    } catch { /* session write is best-effort */ }
  }

  /** End the session in this window — every unlock forgotten, back to login. */
  _endSession(message = '') {
    this._unlocked.clear();
    this._clearStoredSession();
    this._accountId = null;
    this._viewAs = null;
    this._authAccountId = null;
    this._switcherOpen = false;
    this._manualError = message;
    this._enterState('login');
  }

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
    if (!this._needsAuth(id)) {
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
    if (!this._needsAuth(id)) return this._loginSuccess(id);
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
    const dc = bypassDCFor(account.security, skill);
    try {
      const who = account.displayName || account.username || 'account';
      const result = await this.skillService.performCheck(this.actor, skill, {
        dc, flavor: 'Terminal Bypass', context: `Terminal login: ${this._terminalName()} · ${who}`,
        // The login's own sound set plays the outcome; the reveal only spins.
        reveal: { host: this.element, title: `Forcing the ${who} login`, ctx: `Terminal login · ${this._terminalName()}`, ok: 'Access granted', no: 'Access denied', verdictSound: false },
      });
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
    this._unlocked.set(accountId, this._credKey(accountId));
    await this.terminalService.recordLoginSuccess(this.item, accountId, this.actorId);
    this._accountId = accountId;
    this._viewAs = null;
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
    // The normal connect path: a secured network opens its login dialog. A refused login explains itself.
    const res = await game.nightcity?.connectToNetwork?.(id);
    if (res && !res.success && res.reason !== 'auth_failed') {
      const name = this.networkService?.getNetwork?.(id)?.name || 'that network';
      const why = { dead_zone: 'There is no signal here.', not_available: `${name} doesn't reach this scene.` }[res.reason] || `Couldn't connect to ${name}.`;
      ui.notifications.warn(`NCM | ${why}`);
    }
    this._recheckGate();
  }

  /** On the gate, let the player through as soon as they qualify. Leaving a network later never logs anyone out. */
  _recheckGate() {
    if (this._state !== 'gate') return;
    const next = this._resolveEntryState();
    if (next !== 'gate') this._enterState(next);
  }

  /** The player can change network from the Agent while the gate is up. */
  _setupEventSubscriptions() {
    this.subscribe(EVENTS.NETWORK_CHANGED, () => this._recheckGate());
  }

  async _onSpoofNetwork() {
    if (!this.actor) return ui.notifications.warn('No character to roll with.');
    const cfg = this.terminalService.getConfig(this.item);
    const skill = (cfg.network?.bypassSkills || [])[0] || 'Interface';
    const dc = cfg.network?.bypassDV ?? 18;
    try {
      const result = await this.skillService.performCheck(this.actor, skill, {
        dc, flavor: 'Network Spoof', context: `Network spoof: ${this._terminalName()}`,
        reveal: { host: this.element, title: 'Spoofing the network check', ctx: `Network spoof · ${this._terminalName()}`, ok: 'Spoof accepted', no: 'Spoof rejected' },
      });
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
    const dc = bypassDCFor(network.security, skill);
    try {
      const result = await this.skillService.performCheck(this.actor, skill, {
        dc, flavor: 'Network Join', context: `Network join: ${network.name || networkId}`,
        reveal: { host: this.element, title: `Joining ${network.name || 'the network'}`, ctx: `Uplink · ${this._terminalName()}`, ok: 'Uplink established', no: 'Join refused', verdictSound: false },
      });
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
          sourceLabel: `${T('short', 'lower')}: "${shard.name}"`,
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
    if (!this._needsAuth(id)) {
      this._loginSuccess(id);
    } else {
      this._authAccountId = id; this._manualError = ''; this._enterState('manual');
    }
  }

  async _onLogout() {
    // Log out ends the session: every account unlocked in this window locks again.
    this._endSession('');
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
    this._unlocked.clear();
    try { this.terminalService.logout(this.item, this.actorId); } catch { /* session write is best-effort */ }
    this._accountId = null;
    this._viewAs = null;
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
    this._view = 'mail';
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

  /** MAIL | FILES view switch (2026-10-25). */
  _onView(event, target) {
    const v = target?.dataset?.view === 'files' ? 'files' : 'mail';
    if (v === this._view) return;
    this._view = v;
    this._selectedMessageId = null;
    this._currentPage = 1;
    this.render(false);
  }

  /**
   * Open a folder of the FILES tree (a root, a directory row, a breadcrumb
   * segment, the ".." row). A locked folder refuses with its reason — it is in
   * the tree so the player knows it exists, never so they can open it. A tree
   * row that is a FILE carries data-message-id and selects it as well.
   */
  _onFsOpen(event, target) {
    const scope = target?.dataset?.scope;
    if (!scope) return;
    if (target.dataset.locked === '1') {
      ui.notifications?.warn(`ACCESS DENIED — ${target.dataset.lockLabel || 'restricted folder'}`);
      this._playTermSound('login-fail');
      return;
    }
    this._view = 'files';
    this._fsSel = { scope, path: target.dataset.path || '' };
    this._selectedMessageId = target.dataset.messageId || null;
    this.render(false);
  }

  /**
   * TTY mailbox style — the prompt's command set. Deliberately tiny and
   * forgiving: a NUMBER opens that row, m/f switch MAIL/FILES, cd <name> opens
   * a mail folder or a sub-folder (cd .. goes up), n/p page, ls re-lists, ?
   * explains. Anything else is echoed back as unknown. Mouse clicks still work.
   */
  _onTtyCommand(raw) {
    const c = String(raw || '').trim();
    this._ttyFocus = true;
    if (!c) { this.render(false); return; }
    const say = (m) => ui.notifications?.info(`${this._terminalName()}: ${m}`);
    const lower = c.toLowerCase();
    if (/^\d+$/.test(c)) {
      const m = (this._ttyList || [])[Number(c) - 1];
      if (!m) { say(`no entry #${c}`); return; }
      this._selectedMessageId = m.messageId;
      this.render(false);
      return;
    }
    if (lower === 'm' || lower === 'mail') { this._view = 'mail'; this._selectedMessageId = null; this.render(false); return; }
    if (lower === 'f' || lower === 'files' || lower === 'ls -l') { this._view = 'files'; this._selectedMessageId = null; this.render(false); return; }
    if (lower === 'ls' || lower === 'clear' || lower === 'back' || lower === 'q') { this._selectedMessageId = null; this.render(false); return; }
    // The way OUT of a tty box: logout / exit / su / switch all go back to the login screen,
    // where another account can be picked (there is no dropdown in this style).
    // ADMIN ACCESS: `su <name>` views another account, `exit` comes back from one.
    const su = /^su\s+(\S+)$/i.exec(c);
    if (su) {
      const want = su[1].toLowerCase();
      const hit = (this.terminalService.getConfig(this.item).accounts || []).find(a => (a.username || '').toLowerCase() === want || (a.displayName || '').toLowerCase() === want);
      if (hit && hit.id === this._accountId) { this._onAdminBack(); return; }
      const v = hit ? this.terminalService.adminViewVerdict(this.item, this._accountId, hit.id) : null;
      if (!v?.ok) { say(`su: ${hit && v?.listed ? `${su[1]}: ${v.reason}` : (v?.reason === 'not an admin account' ? 'permission denied' : `${su[1]}: no such account`)}`); this._playTermSound('login-fail'); return; }
      this._startAdminView(hit.id);
      return;
    }
    if (lower === 'exit' && this._viewAs) { this._onAdminBack(); return; }
    // SEND AS THE ACCOUNT: `write` / `mail`-style compose, `reply` to the open message.
    if (lower === 'write' || lower === 'compose' || lower === 'w') { if (this._composeAsContext()) this._onComposeAs(); else say('write: this account cannot send mail'); return; }
    if (lower === 'reply' || lower === 'r') { if (!this._selectedMessageId) say('reply: open a message first (its number)'); else if (this._composeAsContext()) this._onReplyAs(); else say('reply: this account cannot send mail'); return; }
    if (['logout', 'exit', 'su', 'switch', 'users'].includes(lower)) { this._onLogout(); return; }
    if (lower === 'n' || lower === 'p') { this._currentPage += lower === 'n' ? 1 : -1; this.render(false); return; }
    if (lower === '?' || lower === 'help') { say(`a number opens that row · m = mail · f = files · cd <folder> (cd .. = up) · n / p = next / previous page · ls = relist · logout = back to the login screen${this._composeAsContext() ? ' · write = new mail as this account · reply = answer the open message' : ''}${this.terminalService.getAccount(this.item, this._accountId)?.isAdmin ? ' · su <name> = view another account as admin · exit = back to your own' : ''}`); return; }
    const cd = /^cd\s+(.+)$/i.exec(c);
    if (cd) {
      const name = cd[1].trim().replace(/\/+$/, '');
      const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (this._view === 'files' && this._fsSel) {
        if (name === '..' || name === '/') { this._fsSel = { scope: this._fsSel.scope, path: name === '/' ? '' : (this._fsSel.path.includes('/') ? this._fsSel.path.slice(0, this._fsSel.path.lastIndexOf('/')) : '') }; this._selectedMessageId = null; this.render(false); return; }
        const tree = this.terminalService.buildFileTree(this.item, this._fsSel.scope, this._accountId);
        const want = norm(this._fsSel.path ? `${this._fsSel.path}/${name}` : name);
        const hit = tree.dirs.find(d => norm(d.path) === want) || tree.dirs.find(d => norm(d.name) === norm(name) && d.parent === this._fsSel.path);
        if (hit) {
          if (hit.locked) { say(`ACCESS DENIED — ${hit.path}: ${hit.effectiveGate?.mode === 'admin' ? 'admins only' : 'restricted'}`); this._playTermSound('login-fail'); return; }
          this._fsSel = { scope: this._fsSel.scope, path: hit.path }; this._selectedMessageId = null; this.render(false); return;
        }
        if (norm(name) === 'home' || norm(name) === 'shared') { this._fsSel = { scope: norm(name) === 'shared' ? SHARED_SCOPE : this._boxId(), path: '' }; this._selectedMessageId = null; this.render(false); return; }
      }
      const fd = (this.terminalService.getFolders(this.item) || []).find(f => norm(f.name) === norm(name) || norm(f.id) === norm(name));
      if (fd) { this._currentFolder = fd.id; this._view = 'mail'; this._currentPage = 1; this._selectedMessageId = null; this.render(false); return; }
      say(`no such folder: ${name}`);
      return;
    }
    say(`unknown command: ${c} — type ? for help`);
  }

  /**
   * Paint this terminal's film on its window root: the (overlaid) theme's crt, else
   * the preset's, capped by the player's "Film on terminals & shards" setting.
   * @param {{cap?: string}} [opts] - a cap to preview instead of the saved one
   */
  refreshCrt(opts = {}) {
    if (!this.element) return;
    const cfg = this._effectiveConfig?.() || {};
    const theme = cfg.theme && typeof cfg.theme === 'object' ? cfg.theme : {};
    const presetCrt = TERMINAL_PRESETS[theme.preset]?.theme?.crt || null;
    applyCrt(this.element, capCrt(resolveCrt(theme, presetCrt), opts.cap ?? playerCrtCap()));
  }

  /** Back from an open file to its folder listing. */
  _onFsBack() {
    this._selectedMessageId = null;
    this.render(false);
  }

  /**
   * One sidebar/listing row for a message (mail or file). Typed content shows
   * its file-type tag as the preview line; plain messages show a stripped-HTML
   * body snippet. `displayContentType` resolves a disguised payload to its
   * COVER type — reading contentType straight off the message announced
   * "Payload" in the sidebar and blew the disguise before the player ever
   * opened it. ENVELOPE (#37): a FILE row drops the sender line entirely — the
   * content-type icon replaces the priority dot, the filename replaces the
   * sender, and "type · size · path" replaces the body preview.
   */
  _rowVm(m, gm = isGM()) {
    const ct = displayContentType(m, { isGM: gm });
    const ctInfo = ct ? CONTENT_TYPE_INFO[ct] : null;
    const snippet = ct ? '' : String(m.body || '')
      .replace(/<[^>]*>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 90);
    const env = resolveEnvelope({ ...m, contentType: ct });
    return {
      messageId: m.messageId,
      isFile: env.isFile,
      isStream: !!env.isStream,
      shared: !!m.shared,
      from: m.from || 'unknown',
      subject: m.subject || '(no subject)',
      priority: m.priority || 'normal',
      encrypted: !!m.status?.encrypted,
      isSelected: m.messageId === this._selectedMessageId,
      // A live feed isn't FROM a moment — it's happening.
      time: env.isStream ? 'LIVE' : (m.timestamp ? formatCyberDate(m.timestamp, { dateOnly: true }) : ''),
      modified: env.isStream ? 'LIVE' : (m.timestamp ? formatCyberDate(m.timestamp) : ''),
      preview: snippet,
      // A file row leads with the ENVELOPE's icon/label — a live feed reads as
      // a CAMERA FEED, not an "Image Gallery" (the mode is its identity).
      typeLabel: (env.isFile ? env.typeLabel : ctInfo?.label) || null,
      typeIcon: (env.isFile ? env.typeIcon : ctInfo?.icon) || null,
      filename: env.filename || '',
      fileSize: env.isFile && env.size !== '—' ? env.size : '',
      filePath: env.path || '',
      fileOwner: env.owner || '',
      accent: env.accent || (ctInfo ? CONTENT_TYPE_INFO[ct]?.accent : '') || '',
      // A file has no urgency — it just wasn't there before.
      isNew: env.isFile && !m.status?.read,
      flagged: !!m.contentData?.flagged,
      // GM-only marker: gated off the current uplink (players never see the row).
      offNet: gm && !this.terminalService.uplinkReaches(this.item, m.networkVisibility),
    };
  }

  /**
   * FILES view-model (2026-10-25): the tree per volume (this account's HOME and
   * the machine's SHARED volume) and the listing of the open folder. The rules
   * are terminalFiles.js; this only shapes them for the template. `all` is
   * already gate-filtered for a player (getAccountMessages), so a locked
   * folder's files never reach the DOM; the folder itself stays in the tree,
   * locked, with its reason.
   */
  _filesContext(account, all, liveFiles) {
    const svc = this.terminalService;
    const gm = isGM();
    const folders = svc.getFileFolders(this.item);
    // NB: the key is subLabel, not `sub` — `sub` is a registered Handlebars helper and a context field by that name renders NaN.
    const mk = (scope, label, subLabel, icon, tag) => ({ scope, label, subLabel, icon, tag, tree: svc.buildFileTree(this.item, scope, this._accountId, all) });
    const roots = [mk(this._boxId(), 'home', account?.username || '', this._viewAs ? 'fas fa-house-user' : 'fas fa-house', this._viewAs ? (this._adminLabel() + ' VIEW').slice(0, 24) : null)];
    const shared = mk(SHARED_SCOPE, 'shared', this._terminalName(), 'fas fa-hard-drive', 'SHARED');
    if (gm || shared.tree.dirs.length || shared.tree.files.length) roots.push(shared);

    let sel = this._fsSel;
    if (!sel || !roots.some(r => r.scope === sel.scope)) sel = { scope: roots[0].scope, path: '' };
    const root = roots.find(r => r.scope === sel.scope);
    // A folder that no longer exists (deleted / renamed under you) → its root.
    if (sel.path && !root.tree.dirs.some(d => d.path === sel.path)) sel = { scope: sel.scope, path: '' };
    this._fsSel = sel;

    const dirVm = (r, d) => ({
      scope: r.scope, path: d.path, name: d.name, depth: d.depth + 1,
      count: d.deepCount, size: formatSize(d.bytes),
      locked: d.locked, gated: d.effectiveGate?.mode !== 'everyone',
      lockLabel: gateLabel(d.effectiveGate),
      active: sel.scope === r.scope && sel.path === d.path,
    });
    const rootsVm = roots.map(r => ({
      scope: r.scope, label: r.label, subLabel: r.subLabel, icon: r.icon, tag: r.tag,
      isActiveRoot: sel.scope === r.scope && sel.path === '',
      count: r.tree.totalFiles,
      dirs: r.tree.dirs.map(d => dirVm(r, d)),
      // Root-level files sit in the tree; a folder's files show in the listing.
      files: (r.tree.byPath.get('') || []).map(e => this._rowVm(e, gm)),
    }));

    const listing = listingFor(root.tree, sel.path, { account: svc.getAccount(this.item, this._accountId) || account, isGM: gm, folders });
    const dir = listing.dir;
    const newest = listing.files.reduce((t, e) => (e.timestamp && (!t || e.timestamp > t)) ? e.timestamp : t, '');
    const crumb = [{ scope: sel.scope, path: '', name: root.label }, ...listing.crumb.slice(1).map(c => ({ scope: sel.scope, path: c.path, name: c.name }))];
    crumb.forEach((c, i) => { c.last = i === crumb.length - 1; });
    const listingVm = {
      scope: sel.scope, path: sel.path, isRoot: !sel.path, isShared: sel.scope === SHARED_SCOPE,
      machine: this._terminalName(),
      icon: listing.locked ? 'fas fa-lock' : 'fas fa-folder-open',
      crumb,
      locked: listing.locked,
      lockLabel: listing.locked ? gateLabel(dir?.effectiveGate) : '',
      gated: !!dir && dir.effectiveGate?.mode !== 'everyone',
      gateLabel: dir ? gateLabel(dir.effectiveGate) : '',
      parent: sel.path ? { scope: sel.scope, path: parentPath(sel.path) } : null,
      stats: {
        files: listing.files.length, dirs: listing.subdirs.length,
        size: formatSize(listing.bytes),
        modified: newest ? formatCyberDate(newest, { dateOnly: true }) : '',
      },
      subdirs: listing.subdirs.map(d => dirVm(root, d)),
      files: listing.files.map(e => this._rowVm(e, gm)),
      empty: !listing.locked && !listing.subdirs.length && !listing.files.length,
    };
    const totalBytes = roots.reduce((s, r) => s + r.tree.totalBytes, 0);
    return {
      roots: rootsVm,
      listing: listingVm,
      listFiles: listing.files,
      showListing: !this._selectedMessageId,
      usage: {
        label: `${this._terminalName()} · ${liveFiles.length} file${liveFiles.length === 1 ? '' : 's'} · ${formatSize(totalBytes)}`,
        // A machine's disk is fiction: 5% per MB, capped, so the bar reads as
        // "some" rather than lying about capacity.
        pct: Math.min(92, Math.max(4, Math.round(totalBytes / (1024 * 1024) * 5))),
      },
    };
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
    // In FILES view the new entry is a FILE in the open folder, on the open
    // volume (shared → the shared volume). `homeAccountId` is what "this
    // account" means in the composer's Store-on control.
    const inFiles = this._view === 'files' && this._fsSel;
    const scope = inFiles ? this._fsSel.scope : this._boxId();
    import('../ItemInbox/DataShardComposer.js').then(({ DataShardComposer }) => {
      new DataShardComposer({
        target: { kind: 'terminal', item: this.item, accountId: scope, homeAccountId: this._boxId(), folderPath: inFiles ? this._fsSel.path : '' },
        editData: inFiles ? { envelope: 'file', file: { path: this._fsSel.path } } : undefined,
        onSave: () => this.render(false),
      }).render(true);
    });
  }

  /** Edit message — loads the entry into the shared content composer. */
  _onEditMessage(event, target) {
    if (!isGM()) return;
    const id = target?.dataset?.messageId || this._selectedMessageId;
    const raw = this._boxMessages().find(m => m.messageId === id);
    if (!raw) return;
    import('../ItemInbox/DataShardComposer.js').then(({ DataShardComposer }) => {
      new DataShardComposer({
        // The entry's OWN scope (a shared file stays shared when edited).
        target: { kind: 'terminal', item: this.item, accountId: raw.accountId || this._boxId(), homeAccountId: this._boxId(), folderPath: raw.file?.path || '' },
        editData: DataShardComposer.terminalEditData(raw), onSave: () => this.render(false),
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
  /** Move ▾ menu item: the message id rides on the menu, the folder on the item. */
  async _onMoveTo(event, target) {
    const id = target?.closest?.('[data-move-root]')?.dataset.messageId;
    const folder = target?.dataset?.folder;
    if (!id || !folder) return;
    target.closest('details')?.removeAttribute('open');
    if (target.classList.contains('is-cur')) return;
    await this._onMoveMessage(id, folder);
    const name = this.terminalService?.getFolders(this.item)?.find(f => f.id === folder)?.name || folder;
    ui.notifications.info(`NCM | Moved to ${name}.`);
  }

  /** A clickable TTY hint runs the same command as typing it. */
  _onTtyCmdClick(event, target) {
    const c = target?.dataset?.cmd;
    if (c) this._onTtyCommand(c);
  }

  /**
   * GM: drag a message row onto a folder (sidebar folder, tab, desktop icon, TTY folder) to move it.
   * Uses its own drag type so the canvas / Item Piles drop handlers never see it.
   */
  _wireDragMove() {
    if (!isGM() || !this.element) return;
    const TYPE = 'application/x-ncm-terminal-message';
    for (const row of this.element.querySelectorAll('[data-action="terminalSelectMessage"][data-message-id]')) {
      row.setAttribute('draggable', 'true');
      if (!row.title) row.title = 'Drag onto a folder to move it';
      row.addEventListener('dragstart', (ev) => {
        ev.dataTransfer?.setData(TYPE, row.dataset.messageId);
        if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
        this.element.classList.add('is-dragging-msg');
      });
      row.addEventListener('dragend', () => this.element?.classList.remove('is-dragging-msg'));
    }
    for (const f of this.element.querySelectorAll('[data-action="terminalFolder"][data-folder]')) {
      f.addEventListener('dragover', (ev) => {
        if (!ev.dataTransfer?.types?.includes(TYPE)) return;
        ev.preventDefault(); ev.dataTransfer.dropEffect = 'move'; f.classList.add('is-drop');
      });
      f.addEventListener('dragleave', () => f.classList.remove('is-drop'));
      f.addEventListener('drop', async (ev) => {
        const id = ev.dataTransfer?.getData(TYPE);
        f.classList.remove('is-drop');
        this.element?.classList.remove('is-dragging-msg');
        if (!id) return;
        ev.preventDefault(); ev.stopPropagation();
        await this._onMoveMessage(id, f.dataset.folder);
        const name = this.terminalService?.getFolders(this.item)?.find(x => x.id === f.dataset.folder)?.name || f.dataset.folder;
        ui.notifications.info(`NCM | Moved to ${name}.`);
      });
    }
    // The Move ▾ menu closes on an outside click (it is a <details>).
    if (!this._moveCloser) {
      this._moveCloser = (ev) => {
        for (const d of this.element?.querySelectorAll?.('details.ncm-term__move[open]') || []) if (!d.contains(ev.target)) d.removeAttribute('open');
      };
      document.addEventListener('pointerdown', this._moveCloser, true);
    }
  }

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

  /**
   * The sender's portrait: the identity the mail names (`fromContactId`) first,
   * then the directory entry for the address, then the character. An alias
   * never borrows its character's face (PortraitService).
   */
  _senderPortrait(msg) {
    const mcs = game.nightcity?.masterContactService;
    const master = (msg.fromContactId && mcs?.getContact?.(msg.fromContactId)) || this._findContactByEmail(msg.from);
    if (master) return this.portraitService?.resolvePortrait(master) || null;
    return msg.fromActorId ? (this.portraitService?.resolvePortrait({ actorId: msg.fromActorId }) || null) : null;
  }

  async _onAddContact(event, target) {
    const msg = this._currentSelectedRaw();
    if (!msg || !this.actorId) return;
    const name = this._resolveSenderName(msg);
    // Master-directory sender → carry its portrait + linked actor + id so the
    // player contact is a real, portrait-bearing identity (the PortraitService
    // contact-creation rule).
    const master = this._findContactByEmail(msg.from);
    const portrait = this._senderPortrait(msg);
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
    if (this._adminReadOnly(action)) { ui.notifications?.warn(`${this._adminLabel()}: read-only — this account can be read, not changed.`); return; }
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
      const res = await this.terminalService.exfilSaveFrame(this.item, this._boxId(), msg.messageId, index, targetId, aim);
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
      const res = await this.terminalService.exfilToInbox(this.item, this._boxId(), [msg.messageId], targetId);
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
      a.type === 'character' && (a.isOwner || a.hasPlayerOwner) && !isHiddenCharacter(a.id));
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
    // A player burns onto an existing shard or something the GM's blank rule
    // allows — never onto a weapon or a cyberarm (it would be converted).
    const encCfg = resolveEncoderConfig(game.nightcity?.settingsManager?.getEncoderConfigRaw?.() ?? {});
    const writable = (i) => isGM() || !!i.flags?.[MODULE_ID]?.isDataShard
      || isEligibleBlank(encCfg, { name: i.name, type: i.type, tierId: i.flags?.[MODULE_ID]?.blankTier || '' });
    const owned = [...(this.actor?.items ?? [])].filter((i) => carrier(i) && writable(i));
    const world = isGM() ? game.items.contents.filter(carrier) : [];
    const candidates = [...owned, ...world];
    if (!candidates.length) return ui.notifications.warn(isGM() ? 'No item to burn onto.' : `Nothing you carry can take the file. ${blankRuleRefusal(encCfg)}`);
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
    const res = await this.terminalService.exfilToShard(this.item, this._boxId(), [msg.messageId], target);
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
        .map((e) => (isShard(byId.get(e.id)) ? { ...e, tag: T('short', 'upper') } : e))
        .sort((a, b) => ((!!b.tag) - (!!a.tag)) || a.name.localeCompare(b.name));
    };
    const pick = await showNamePicker({
      admin: false,
      title: `Burn to ${T('one')}`,
      hint: `Pick the item to burn this file onto. Burning onto an item that isn't ${withArticle(T('short', 'lower'))} converts it.`,
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
      accountId: this._boxId(),
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
      const res = await this.terminalService.exfilForward(this.item, this._boxId(), [msg.messageId], targetId, forwarder);
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
      const res = await this.terminalService.exfilWipe(this.item, this._boxId(), [msg.messageId]);
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
      a.type === 'character' && (a.hasPlayerOwner || a.getFlag?.(MODULE_ID, 'email')) && !isHiddenCharacter(a.id));
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
    const raw = this._boxMessages().find(m => m.messageId === id);
    if (!raw || raw.contentType !== 'banking') return;
    await runSiphon({ actor, raw: raw.contentData, itemUuid: this.item?.uuid, messageId: id, host: this.element });
    this.render(false);
  }

  /** Eddies content — claim into a character's wealth (shared flow). */
  async _onClaimEddies(event, target) {
    const id = target?.closest?.('[data-entry-id]')?.dataset.entryId || this._selectedMessageId;
    const raw = this._boxMessages().find(m => m.messageId === id);
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
    const raw = this._boxMessages().find(m => m.messageId === id);
    if (!raw || raw.contentType !== 'credentials' || Number.isNaN(idx)) return;
    const actor = resolveOperator();
    const ok = await runCrack({ actor, raw: raw.contentData, entryIndex: idx, messageId: id, force: isGM() && !actor, host: this.element });
    if (ok) this.render(false);
  }

  /** Locked sub-content — decrypt a gallery frame / declassify redactions (shared flow). */
  async _onContentUnlock(event, target) {
    const id = target?.closest?.('[data-entry-id]')?.dataset.entryId || this._selectedMessageId;
    const kind = target?.dataset?.unlockKind;
    const raw = this._boxMessages().find(m => m.messageId === id);
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
    const prev = this.actorId;
    this.actor = resolveOperator() ?? null;
    this.actorId = this.actor?.id ?? null;
    // Another character did not type those passwords.
    if (this.actorId !== prev) {
      this._unlocked.clear();
      if (this._accountId) {
        try { if (prev) this.terminalService.logout(this.item, prev, true)?.catch?.(() => {}); } catch { /* best effort */ }
        this._accountId = null; this._viewAs = null;
        this._enterState('login');
        return;
      }
    }
    this.render(false);
  }

  /**
   * ANALYZE — the player-facing file scan (offered on every typed file so its
   * presence can't tell them which one is a trojan).
   */
  async _onAnalyzeFile(event, target) {
    const id = target?.closest?.('[data-entry-id]')?.dataset.entryId || this._selectedMessageId;
    const raw = this._boxMessages().find(m => m.messageId === id);
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
    const raw = this._boxMessages().find(m => m.messageId === id);
    if (!raw) return;
    const ok = await toggleSchematicLock({ raw: raw.contentData, index: Number(target?.dataset?.index ?? -1), messageId: id });
    if (ok) this.render(false);
  }

  /** Camera feed — LOOP / CUT / RESTORE / TAKE CONTROL (shared flow). */
  async _onCamAction(event, target) {
    const id = target?.closest?.('[data-entry-id]')?.dataset.entryId || this._selectedMessageId;
    const act = target?.dataset?.camAct;
    const raw = this._boxMessages().find(m => m.messageId === id);
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
    const raw = this._boxMessages().find(m => m.messageId === id);
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
    const raw = this._boxMessages().find(m => m.messageId === id);
    if (!raw || raw.contentType !== 'payload') return;
    const actor = resolveOperator();
    const res = await runPayloadExecute({ actor, raw: raw.contentData, messageId: id, sourceLabel: this._terminalName(), host: this.element, force: isGM() && !actor });
    if (res) this.render(false);
  }

  /** Payload — KILL a running timed effect early. */
  async _onPayloadKill(event, target) {
    const id = target?.closest?.('[data-entry-id]')?.dataset.entryId || this._selectedMessageId;
    const raw = this._boxMessages().find(m => m.messageId === id);
    if (!raw) return;
    const res = await runPayloadKill({ actor: resolveOperator(), raw: raw.contentData, messageId: id, host: this.element });
    if (res) this.render(false);
  }

  /** Payload — SNIFF a suspected disguised file (roll to unmask). */
  async _onPayloadSniff(event, target) {
    const id = target?.closest?.('[data-entry-id]')?.dataset.entryId || this._selectedMessageId;
    const raw = this._boxMessages().find(m => m.messageId === id);
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
      this._accountId, this._viewAs || "", this._currentFolder, this._view, this._fsSel ? `${this._fsSel.scope}:${this._fsSel.path}` : '', this._currentPage,
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
    return this._boxMessages()
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
    // Closing the terminal ends the session — the next open asks again.
    this._unlocked.clear();
    this._clearStoredSession();
    this._timers.forEach(clearTimeout);
    this._timers = [];
    this._bootVideo?.destroy?.(); this._bootVideo = null;
    if (this._lockdownTimer) { clearInterval(this._lockdownTimer); this._lockdownTimer = null; }
    Hooks.off('updateItem', this._onItemUpdate);
    Hooks.off('updateSetting', this._onNodesChange);
    if (this._moveCloser) { document.removeEventListener('pointerdown', this._moveCloser, true); this._moveCloser = null; }
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
