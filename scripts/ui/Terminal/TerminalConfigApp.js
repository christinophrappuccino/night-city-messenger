/**
 * TerminalConfigApp
 * @file scripts/ui/Terminal/TerminalConfigApp.js
 * @module night-city-messenger
 * @description GM authoring sheet for a Terminal (parallel to ItemInboxConfig).
 *   Tabs: Identity · Accounts · Theme · Boot · Network · Exfil. Reuses the
 *   shard config's `ncm-cfg-*` styling for a consistent GM-facing look. All
 *   writes go through TerminalService (updateConfig / addAccount / updateAccount
 *   / removeAccount / forceUnlock / relock); import/export round-trips the whole
 *   terminalConfig as a JSON blob (the spam/theme pattern).
 */

import { BaseApplication } from '../BaseApplication.js';
import { MODULE_ID, TERMINAL_PRESETS, FONT_OPTIONS, DEFAULTS, SKILL_MAP, COLOR_VAR_MAP, TERMINAL_LOGIN_STYLES, TERMINAL_MAILBOX_STYLES, TERMINAL_ICON_LIBRARY, TERMINAL_FOLDER_ICONS, BOOT_FLAVOR_LINES, BOOT_ANIMATIONS, TERMINAL_SOUND_SETS } from '../../utils/constants.js';
import { log, isGM, generateId, formatCyberDate, buildTerminalThemePrefs, resolveTerminalSound } from '../../utils/helpers.js';
import { adminDialog, adminConfirm } from '../../utils/adminTheme.js';
import { showNamePicker, documentEntries, isCarrier } from '../../utils/namePicker.js';
import { buildContentContext } from './TerminalContentPanel.js';
import { SHARED_SCOPE, normalizeFolderPath, parentPath, folderName } from '../../utils/terminalFiles.js';
import { applyCrt, resolveCrt, crtPanelContext, wireCrtPanel } from '../../utils/crt.js';

/** Clearance presets offered as one-click chips; anything else is "custom". */
const CLEARANCE_PRESETS = ['STANDARD', 'ADMIN', 'GUEST', 'SYSOP'];
/** Word pool for the password generator (⚄). */
const PASS_WORDS = ['chrome', 'samurai', 'arasaka', 'daemon', 'netwatch', 'flatline', 'preem', 'kiroshi', 'militech', 'nomad', 'glitch', 'neon', 'zeroday', 'blackwall', 'edge', 'static'];

export class TerminalConfigApp extends BaseApplication {

  /** GM tool — follows the Admin Panel theme + text size (utils/adminTheme.js). */
  static ADMIN_THEMED = true;

  item = null;
  _activeTab = 'identity';
  _editingAccountId = null;   // account id | 'new' | null
  _editorLink = null;         // pending identity pick: { masterContactId, actorId } | null (= use stored)
  /**
   * Working copy of cfg.theme (ThemeCustomizer's _workingPrefs pattern).
   * null = untouched (context reads the saved theme). Theme controls mutate
   * this via manual listeners — no re-render, so edits survive tab switches —
   * and live-preview onto the in-sheet preview + any open viewer. Save
   * persists it; closing without saving reverts the previewed viewers.
   */
  _themeDraft = null;
  /**
   * Staged preset KIT (a TERMINAL_PRESETS key) — set when a preset card is
   * clicked. The palette rides _themeDraft; the kit overlays the Boot & Login
   * tab's context (boot fields + login style) so the WHOLE machine previews
   * the preset, and Save picks it all up from the DOM inputs. Accounts seed
   * at save when the terminal has none. Cleared on save/close/"palette only".
   */
  _presetKit = null;
  /**
   * Mailbox layout staged but not saved (2026-10-25). The layout TRAVELS WITH A
   * THEME: a preset card brings its own (via the kit), a saved theme brings the
   * one it was saved with, and a manual card pick lands here too so a re-render
   * never snaps the Boot & Login card back to the kit's value. Save reads the
   * hidden input the context fills from this; cleared on save / close.
   */
  _stagedMailboxStyle = null;
  // Accounts tab list controls (search / sort / pagination — 10 per page).
  _acctSearch = '';
  // CONTENT blocks (2026-10-25): which volumes are unfolded, which folders are
  // collapsed, which mail folders are open. The shared volume starts open.
  _ctOpen = new Set([SHARED_SCOPE]);
  _ctDirClosed = new Set();
  _ctMailOpen = new Set();
  _ctTab = new Map();          // accountId → 'mail' | 'files'
  _ctFocusNewdir = null;
  _acctSort = 'name';
  _acctPage = 1;
  _acctSearchRefocus = false;
  static ACCT_PAGE_SIZE = 10;

  get terminalService() { return game.nightcity?.terminalService; }
  get networkService() { return game.nightcity?.networkService; }

  static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
    id: 'ncm-terminal-config',
    classes: ['ncm-app', 'ncm-item-inbox-config'],
    window: { title: 'Configure Terminal', icon: 'fas fa-sliders', resizable: true, minimizable: false },
    position: { width: 700, height: 760 },
    actions: {
      switchTab: TerminalConfigApp._onSwitchTab,
      saveConfig: TerminalConfigApp._onSaveConfig,
      clearPresetKit: TerminalConfigApp._onClearPresetKit,
      selectTermPreset: TerminalConfigApp._onSelectTermPreset,
      resetTermColors: TerminalConfigApp._onResetTermColors,
      saveTermTheme: TerminalConfigApp._onSaveTermTheme,
      applyTermTheme: TerminalConfigApp._onApplyTermTheme,
      overwriteTermTheme: TerminalConfigApp._onOverwriteTermTheme,
      deleteTermTheme: TerminalConfigApp._onDeleteTermTheme,
      exportTermTheme: TerminalConfigApp._onExportTermTheme,
      importTermTheme: TerminalConfigApp._onImportTermTheme,
      addAccount: TerminalConfigApp._onAddAccount,
      acctPage: TerminalConfigApp._onAcctPage,
      editAccount: TerminalConfigApp._onEditAccount,
      cancelAccount: TerminalConfigApp._onCancelAccount,
      saveAccount: TerminalConfigApp._onSaveAccount,
      removeAccount: TerminalConfigApp._onRemoveAccount,
      addBootLogLine: TerminalConfigApp._onAddBootLogLine,
      removeBootLogLine: TerminalConfigApp._onRemoveBootLogLine,
      forceUnlock: TerminalConfigApp._onForceUnlock,
      relock: TerminalConfigApp._onRelock,
      exportConfig: TerminalConfigApp._onExportConfig,
      importConfig: TerminalConfigApp._onImportConfig,
      browseBootImage: TerminalConfigApp._onBrowseBootImage,
      browseBootVideo: TerminalConfigApp._onBrowseBootVideo,
      clearBootVideo: TerminalConfigApp._onClearBootVideo,
      browseWallpaper: TerminalConfigApp._onBrowseWallpaper,
      generateBootLines: TerminalConfigApp._onGenerateBootLines,
      browseSsImage: TerminalConfigApp._onBrowseSsImage,
      saveFullPreset: TerminalConfigApp._onSaveFullPreset,
      applyFullPreset: TerminalConfigApp._onApplyFullPreset,
      overwriteFullPreset: TerminalConfigApp._onOverwriteFullPreset,
      deleteFullPreset: TerminalConfigApp._onDeleteFullPreset,
      exportFullPreset: TerminalConfigApp._onExportFullPreset,
      importFullPreset: TerminalConfigApp._onImportFullPreset,
      browseAcctPortrait: TerminalConfigApp._onBrowseAcctPortrait,
      unlinkIdentity: TerminalConfigApp._onUnlinkIdentity,
      generatePassword: TerminalConfigApp._onGeneratePassword,
      pickKeyItem: TerminalConfigApp._onPickKeyItem,
      folderAdd: TerminalConfigApp._onFolderAdd,
      folderRemove: TerminalConfigApp._onFolderRemove,
      // Content blocks — the file repository (2026-10-25).
      ctToggle: TerminalConfigApp._onCtToggle,
      ctTab: TerminalConfigApp._onCtTab,
      ctDirToggle: TerminalConfigApp._onCtDirToggle,
      ctMailToggle: TerminalConfigApp._onCtMailToggle,
      ctFolderFocus: TerminalConfigApp._onCtFolderFocus,
      ctFolderAddSub: TerminalConfigApp._onCtFolderAddSub,
      ctFolderRename: TerminalConfigApp._onCtFolderRename,
      ctFolderRemove: TerminalConfigApp._onCtFolderRemove,
      ctGateAccounts: TerminalConfigApp._onCtGateAccounts,
      ctAdd: TerminalConfigApp._onCtAdd,
      ctEntryEdit: TerminalConfigApp._onCtEntryEdit,
      ctEntryDelete: TerminalConfigApp._onCtEntryDelete,
      ctOpenTerminal: TerminalConfigApp._onCtOpenTerminal,
    },
  }, { inplace: false });

  static PARTS = { main: { template: `modules/${MODULE_ID}/templates/terminal/terminal-config.hbs` } };

  constructor(options = {}) {
    super(options);
    if (options.item) this.item = options.item;
  }

  get title() { return `Configure Terminal: ${this.item?.name ?? 'Unknown'}`; }

  // ═══════════════════════════════════════════════════════════
  //  Context
  // ═══════════════════════════════════════════════════════════

  async _prepareContext() {
    const cfg = this.terminalService?.getConfig(this.item) ?? foundry.utils.deepClone(DEFAULTS.TERMINAL_CONFIG);
    const state = this.terminalService?.getState(this.item) ?? {};
    // Theme values render from the DRAFT when one exists (unsaved edits
    // survive tab-switch re-renders), else the saved theme.
    const theme = this._themeDraft ?? (cfg.theme || {});
    const presetKey = theme.preset || 'classic';

    const presets = [
      // 'classic' has no TERMINAL_PRESETS entry — it's the no-preset brand look.
      { key: 'classic', label: 'Classic', icon: 'fas fa-terminal', active: presetKey === 'classic', sw1: '#F65261', sw2: '#19f3f7', sw3: '#1a1a2e' },
      ...Object.entries(TERMINAL_PRESETS).map(([key, p]) => ({
        key, label: p.label, icon: p.icon, active: key === presetKey,
        sw1: p.theme?.primary || '#F65261', sw2: p.theme?.secondary || '#19f3f7', sw3: p.theme?.bgSurface || '#1a1a2e',
      })),
    ];

    const fontSel = (slot, cur) => FONT_OPTIONS.map(f => ({ key: f.key, label: f.label, selected: f.key === cur }));
    // Effective-value fallbacks: the ACTIVE preset's palette, then the brand
    // defaults (variables.css). Save persists the draft object — not these
    // display values — so an untouched theme stays untouched.
    const tp = TERMINAL_PRESETS[presetKey]?.theme || {};
    const colorBase = {
      primary: '#F65261', secondary: '#19f3f7', accent: '#f7c948',
      bgDeep: '#0a0a0f', bgBase: '#12121a', bgSurface: '#1a1a2e', bgElevated: '#252540',
      textPrimary: '#ededf0', textSecondary: '#bdbdd0',
    };
    const colorLabels = {
      primary: 'Primary', secondary: 'Secondary', accent: 'Accent',
      bgDeep: 'Background (Deep)', bgBase: 'Background (Base)', bgSurface: 'Surface',
      bgElevated: 'Elevated', textPrimary: 'Text (Primary)', textSecondary: 'Text (Secondary)',
    };
    const themeColorEntries = Object.keys(COLOR_VAR_MAP).map(key => ({
      key,
      label: colorLabels[key] || key,
      value: theme[key] || tp[key] || colorBase[key],
      hasOverride: !!theme[key],
    }));
    const themeFontSelectors = [
      { slot: 'display', label: 'Body / Display', options: fontSel('display', theme.fontDisplay || tp.fontDisplay || 'rajdhani') },
      { slot: 'mono', label: 'Monospace', options: fontSel('mono', theme.fontMono || tp.fontMono || 'sharetechmono') },
      { slot: 'title', label: 'Titles', options: fontSel('title', theme.fontTitle || tp.fontTitle || 'orbitron') },
    ];
    // Preset kit overlay (see _presetKit) — boot, login style, MOTD/welcome,
    // screensaver, and folder names all preview the staged preset; Save then
    // reads the kit-prefilled inputs from the DOM.
    const kit = this._presetKit ? TERMINAL_PRESETS[this._presetKit] : null;
    const bootCfg = kit?.boot ? { ...(cfg.boot || {}), ...kit.boot } : (cfg.boot || {});
    const loginStyleKey = kit?.loginStyle || cfg.loginStyle || 'cards';
    const mailboxStyleKey = this._currentMailboxStyle();
    const loginCfg = kit?.login ? { ...(cfg.login || {}), ...kit.login } : (cfg.login || {});
    const ssCfg = kit?.screensaver ? { ...(cfg.screensaver || {}), ...kit.screensaver } : (cfg.screensaver || {});
    const fnCfg = kit?.folderNames ? { ...(cfg.folderNames || {}), ...kit.folderNames } : (cfg.folderNames || {});
    const soundSetKey = kit?.soundSet || cfg.soundSet || 'default';
    const savedThemes = this._getTermThemes().map((entry, i) => ({
      index: i,
      name: entry.name,
      // The layout the theme was saved with (legacy entries have none → applying leaves the layout alone).
      layoutIcon: TERMINAL_MAILBOX_STYLES.find(s => s.key === entry.mailboxStyle)?.icon || '',
      layoutLabel: TERMINAL_MAILBOX_STYLES.find(s => s.key === entry.mailboxStyle)?.label || '',
      sw1: entry.theme?.primary || TERMINAL_PRESETS[entry.theme?.preset]?.theme?.primary || '#F65261',
      sw2: entry.theme?.secondary || TERMINAL_PRESETS[entry.theme?.preset]?.theme?.secondary || '#19f3f7',
      sw3: entry.theme?.bgSurface || TERMINAL_PRESETS[entry.theme?.preset]?.theme?.bgSurface || '#1a1a2e',
    }));

    // Accounts list view — enriched rows (portrait / role / clearance /
    // methods / status at a glance) + search / sort / pagination.
    const allAccounts = (cfg.accounts || []).map(a => {
      const contact = a.masterContactId ? game.nightcity?.masterContactService?.getContact(a.masterContactId) : null;
      const requiresAuth = a.security?.requiresAuth !== false && !!a.security?.requiresAuth;
      const name = a.displayName || a.username || 'Account';
      return {
        id: a.id,
        displayName: name,
        username: a.username || '',
        email: a.email || '',
        role: a.role || (a.isAdmin ? 'ADMINISTRATOR' : ''),
        clearance: (a.clearance || '').toUpperCase(),
        portrait: a.portrait || contact?.portrait || '',
        initials: name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase(),
        isAdmin: !!a.isAdmin,
        hidden: !!a.hidden,
        isDefault: a.id === cfg.defaultAccountId,
        isOpen: !requiresAuth,
        gated: !!a.network?.restricted,
        linkedContact: contact?.name || '',
        methods: this._accountMethodSummary(a.security || {}),
      };
    });
    const q = this._acctSearch.trim().toLowerCase();
    let filtered = !q ? allAccounts : allAccounts.filter(a =>
      [a.displayName, a.username, a.email, a.role, a.linkedContact].some(v => v.toLowerCase().includes(q)));
    const sorters = {
      name: (a, b) => a.displayName.localeCompare(b.displayName),
      username: (a, b) => a.username.localeCompare(b.username),
      admins: (a, b) => (b.isAdmin - a.isAdmin) || a.displayName.localeCompare(b.displayName),
      open: (a, b) => (b.isOpen - a.isOpen) || a.displayName.localeCompare(b.displayName),
    };
    filtered = [...filtered].sort(sorters[this._acctSort] || sorters.name);
    const acctMaxPage = Math.max(1, Math.ceil(filtered.length / TerminalConfigApp.ACCT_PAGE_SIZE));
    if (this._acctPage > acctMaxPage) this._acctPage = acctMaxPage;
    // CONTENT (2026-10-25): the shared volume + every account's mail/files,
    // drawn as the folder tree the player will see (TerminalContentPanel).
    const content = buildContentContext({
      svc: this.terminalService, item: this.item, accounts: cfg.accounts || [],
      folderDefs: this.terminalService.getFolders(this.item),
      ui: { open: this._ctOpen, dirClosed: this._ctDirClosed, mailOpen: this._ctMailOpen, tab: this._ctTab },
    });
    const accounts = filtered
      .slice((this._acctPage - 1) * TerminalConfigApp.ACCT_PAGE_SIZE, this._acctPage * TerminalConfigApp.ACCT_PAGE_SIZE)
      .map(a => ({ ...a, ct: content.byAccount[a.id] }));
    const acctSummary = {
      total: allAccounts.length,
      admins: allAccounts.filter(a => a.isAdmin).length,
      open: allAccounts.filter(a => a.isOpen).length,
      secured: allAccounts.filter(a => !a.isOpen).length,
      hidden: allAccounts.filter(a => a.hidden).length,
      gated: allAccounts.filter(a => a.gated).length,
    };
    const acctControls = {
      search: this._acctSearch,
      filteredCount: filtered.length,
      isFiltered: !!q,
      sortOptions: [
        { value: 'name', label: 'Name' }, { value: 'username', label: 'Username' },
        { value: 'admins', label: 'Admins first' }, { value: 'open', label: 'Open first' },
      ].map(o => ({ ...o, selected: o.value === this._acctSort })),
      pager: acctMaxPage > 1 ? { page: this._acctPage, maxPage: acctMaxPage, hasPrev: this._acctPage > 1, hasNext: this._acctPage < acctMaxPage } : null,
    };

    const editing = this._editingAccountId
      ? this._editorContext(cfg, this._editingAccountId)
      : null;

    const allNetworks = (this.networkService?.getAllNetworks?.() || []).map(n => ({
      id: n.id, name: n.name, checked: (cfg.network?.allowedNetworks || []).includes(n.id),
    }));

    return {
      isGM: isGM(),
      gmBypassed: !!state.gmBypassed,
      tab: this._activeTab,
      tabs: {
        identity: this._activeTab === 'identity',
        accounts: this._activeTab === 'accounts',
        theme: this._activeTab === 'theme',
        boot: this._activeTab === 'boot',
        network: this._activeTab === 'network',
        exfil: this._activeTab === 'exfil',
      },
      accountCount: acctSummary.total,
      acctSummary, acctControls,
      content,

      // Identity
      terminalName: cfg.terminalName || '',
      itemName: this.item?.name || '',
      owner: cfg.metadata?.owner || '',
      org: cfg.metadata?.org || '',
      location: cfg.metadata?.location || '',
      classification: cfg.metadata?.classification || '',
      journalName: game.journal?.get(this.item?.getFlag(MODULE_ID, 'journalId'))?.name || '—',

      // Accounts
      accounts, editing,

      // Theme (draft-aware; see the theme block above)
      presets, presetKey,
      themeColorEntries, themeFontSelectors, savedThemes,
      themeDirty: !!this._themeDraft,
      previewName: cfg.terminalName || this.item?.name || 'TERMINAL',
      textScale: theme.textScale || 100,
      contrast: theme.contrast || 100,
      themeWallpaper: theme.wallpaper || '',
      themeWallStrength: theme.wallpaperStrength ?? 25,
      themeFlicker: theme.flicker === true,
      // The ONE CRT film — resolved from the draft/saved theme, else the preset's.
      themeCrt: crtPanelContext(resolveCrt(theme, TERMINAL_PRESETS[theme.preset]?.theme?.crt || null)),
      themeGlitch: theme.glitch ?? 0,

      // Login screen + screensaver + folder names (Boot & Login / Identity tabs)
      loginStyles: TERMINAL_LOGIN_STYLES.map(s => ({ ...s, active: loginStyleKey === s.key })),
      loginStyleKey,
      // Mailbox layout cards (TERMINAL_MAILBOX_STYLES, 2026-10-25).
      mailboxStyles: TERMINAL_MAILBOX_STYLES.map(s => ({ ...s, active: mailboxStyleKey === s.key })),
      mailboxStyleKey,
      soundSets: Object.entries(TERMINAL_SOUND_SETS).map(([key, s]) => ({
        key, label: s.label, icon: s.icon, hint: s.hint, active: key === soundSetKey,
      })),
      soundSetKey,
      presetKitLabel: kit?.label || '',
      loginMotd: loginCfg.motd || '',
      loginWelcome: loginCfg.welcomeText || '',
      ssEnabled: ssCfg.enabled === true,
      ssIdle: ssCfg.idleSeconds || 120,
      ssText: ssCfg.text || '',
      ssIconMode: ssCfg.iconMode || 'boot',
      ssIconModes: ['boot', 'fa', 'image', 'none'].map(v => ({
        value: v,
        label: { boot: 'Boot icon', fa: 'Icon class', image: 'Image', none: 'No logo' }[v],
        selected: v === (ssCfg.iconMode || 'boot'),
      })),
      ssFaIcon: ssCfg.faIcon || '',
      ssImageUrl: ssCfg.imageUrl || '',
      ssMotion: ssCfg.motion || 'drift',
      ssMotions: ['drift', 'bounce', 'static'].map(v => ({ value: v, selected: v === (ssCfg.motion || 'drift') })),
      // Full terminal preset library (world setting terminalPresetLibrary).
      fullPresets: this._getFullPresets().map((entry, i) => ({
        index: i,
        name: entry.name,
        styleIcon: TERMINAL_LOGIN_STYLES.find(s => s.key === (entry.config?.loginStyle || 'cards'))?.icon || 'fas fa-id-card',
        sw1: entry.config?.theme?.primary || '#F65261',
        sw2: entry.config?.theme?.secondary || '#19f3f7',
        sw3: entry.config?.theme?.bgSurface || '#1a1a2e',
      })),
      // Modular folder editor (Identity tab). System names ride folderNames
      // (kit-overlaid, the preset contract); icons/visibility/customs ride
      // cfg.folders. An icon value outside the curated list stays selectable.
      folderRows: (() => {
        const fld = cfg.folders || {};
        const ic = fld.icons || {};
        const iconOpts = (sel) => {
          const opts = TERMINAL_FOLDER_ICONS.map(i => ({ c: i.c, label: i.label, selected: i.c === sel }));
          if (sel && !opts.some(o => o.selected)) opts.unshift({ c: sel, label: sel, selected: true });
          return opts;
        };
        return [
          { id: 'inbox', kind: 'inbox', name: fnCfg.inbox || '', placeholder: 'Inbox — e.g. CASE FILES, PATIENTS', icons: iconOpts(ic.inbox || 'fas fa-inbox'), isSystem: true, canHide: false, enabled: true },
          { id: 'saved', kind: 'saved', name: fnCfg.saved || '', placeholder: 'Saved — e.g. EVIDENCE, ARCHIVE', icons: iconOpts(ic.saved || 'fa-regular fa-star'), isSystem: true, canHide: true, enabled: fld.savedEnabled !== false },
          { id: 'trash', kind: 'trash', name: fnCfg.trash || '', placeholder: 'Trash — e.g. PURGED, DISPOSAL', icons: iconOpts(ic.trash || 'fas fa-trash-can'), isSystem: true, canHide: true, enabled: fld.trashEnabled !== false },
          ...(fld.custom || []).map(c => ({ id: c.id, kind: 'custom', name: c.name || '', placeholder: 'Folder name', icons: iconOpts(c.icon || 'fas fa-folder'), isSystem: false })),
        ];
      })(),
      // Boot icon library (visual picker) — active = the currently saved class.
      iconLibrary: TERMINAL_ICON_LIBRARY.map(i => ({ ...i, active: i.c === (bootCfg.faIcon || '') })),

      // Boot — reads the kit-overlaid bootCfg so a staged preset shows here
      // immediately (Save then reads these inputs from the DOM).
      bootEnabled: bootCfg.enabled !== false,
      bootTitle: bootCfg.title || '',
      bootSubtitle: bootCfg.subtitle || '',
      bootBanner: bootCfg.banner || '',
      bootFaIcon: bootCfg.faIcon || '',
      bootImageUrl: bootCfg.imageUrl || '',
      bootImageFree: bootCfg.imageFrame === 'free',
      bootVideoUrl: bootCfg.videoUrl || '',
      bootVideoOverlay: !!bootCfg.videoOverlay,
      bootIconModes: ['preset', 'fa', 'image'].map(v => ({
        value: v,
        label: { preset: 'Theme preset icon', fa: 'Font Awesome icon', image: 'Custom image / logo' }[v],
        selected: v === (bootCfg.iconMode || (bootCfg.faIcon ? 'fa' : 'preset')),
      })),
      bootIconMode: bootCfg.iconMode || (bootCfg.faIcon ? 'fa' : 'preset'),
      bootIcon: TERMINAL_PRESETS[presetKey]?.icon || 'fas fa-server',
      bootAnimation: bootCfg.animationStyle || 'standard-fade',
      bootSpeed: bootCfg.speed || 'normal',
      bootCustomSeconds: bootCfg.customSeconds ?? '',
      bootSpeedIsCustom: bootCfg.speed === 'custom',
      bootLogLines: bootCfg.logLines || [],
      animationOptions: BOOT_ANIMATIONS.map(a => ({
        value: a.key, hint: a.hint, selected: a.key === (bootCfg.animationStyle || 'standard-fade'),
      })),
      speedOptions: ['fast', 'normal', 'dramatic', 'custom'].map(v => ({ value: v, selected: v === (bootCfg.speed || 'normal') })),

      // Network
      networkRequired: !!cfg.network?.required,
      accessMode: cfg.network?.accessMode || 'any',
      accessModes: ['any', 'whitelist', 'type'].map(v => ({ value: v, selected: v === (cfg.network?.accessMode || 'any') })),
      allNetworks,
      signalThreshold: cfg.network?.signalThreshold ?? 40,
      scenePinRange: cfg.scenePin?.range ?? 0,
      // Netrunning resolution override (design §5) — 'inherit' follows the world.
      hackResolutionModes: ['inherit', 'auto', 'flagged', 'gm'].map(v => ({
        value: v, selected: v === (cfg.hackResolution || 'inherit'),
        label: v === 'inherit' ? 'Follow the world setting (default)'
          : v === 'auto' ? 'Auto-roll — NCM rolls the check itself'
          : v === 'flagged' ? 'Auto-roll + NET card for the GM'
          : 'GM adjudicates — the table runs the NET',
      })),

      // Machine uplink (Layer 1) — the terminal's OWN connection.
      uplinkInterfaces: (this.networkService?.getAllNetworks?.() || []).map(n => {
        const iface = (cfg.connection?.interfaces || []).find(i => i.networkId === n.id);
        return { id: n.id, name: n.name, checked: !!iface, preAuthorized: !!iface?.preAuthorized, wired: !!iface?.wired };
      }),
      uplinkDefaults: [{ value: '', label: 'Local only (offline)', selected: !cfg.connection?.defaultNetworkId }]
        .concat((this.networkService?.getAllNetworks?.() || []).map(n => ({
          value: n.id, label: n.name, selected: n.id === cfg.connection?.defaultNetworkId,
        }))),
      uplinkAllowSwitch: cfg.connection?.allowPlayerSwitching !== false,
      uplinkSyncHint: cfg.connection?.showSyncHint !== false,

      // Exfil — master switch + per-action policy rows.
      allowExfil: cfg.allowExfil !== false,
      exfilRows: this._exfilRows(cfg),
      exfilSellPrice: (cfg.exfil?.sell?.price ?? DEFAULTS.TERMINAL_CONFIG.exfil.sell.price),
    };
  }

  /** Per-action exfil config rows (allow / require-roll / skill / DV). */
  _exfilRows(cfg) {
    const base = DEFAULTS.TERMINAL_CONFIG.exfil;
    const ex = cfg.exfil || {};
    const meta = {
      agent:   { label: 'To my Agent',   icon: 'fas fa-download' },
      shard:   { label: 'Burn to Shard',  icon: 'fas fa-sd-card' },
      forward: { label: 'Forward',        icon: 'fas fa-share' },
      leak:    { label: 'Leak to the Net', icon: 'fas fa-tower-broadcast' },
      sell:    { label: 'Sell to a Fixer', icon: 'fas fa-hand-holding-dollar' },
      wipe:    { label: 'Wipe Original',   icon: 'fas fa-eraser' },
    };
    return Object.keys(meta).map(key => {
      const d = base[key], c = ex[key] || {};
      const skill = c.skill || d.skill;
      // Skill dropdown from SKILL_MAP (account-editor pattern) — a legacy /
      // hand-typed value stays selectable at the top instead of vanishing.
      const skills = Object.keys(SKILL_MAP);
      if (skill && !skills.includes(skill)) skills.unshift(skill);
      return {
        key, cap: key.charAt(0).toUpperCase() + key.slice(1),
        label: meta[key].label, icon: meta[key].icon,
        allow: c.allow ?? d.allow,
        require: !!(c.require ?? d.require),
        skill,
        skillOptions: skills.map(s => ({ name: s, selected: s === skill })),
        dv: Number(c.dv ?? d.dv) || 15,
        isSell: key === 'sell',
      };
    });
  }

  _accountMethodSummary(s) {
    const out = [];
    if (!s.requiresAuth) { out.push({ label: 'Open', cls: 'on' }); return out; }
    if (s.allowPassword ?? s.password) out.push({ label: 'Password', cls: 'on' });
    if (s.allowSkillCheck) out.push({ label: `${(s.bypassSkills || [])[0] || 'Skill'} DV ${s.bypassDC ?? 15}`, cls: 'on' });
    if (s.allowKeyItem) out.push({ label: `Key: ${s.keyItemName || '?'}`, cls: 'on' });
    if (out.length > 1) out.push({ label: (s.authLogic === 'all' ? 'ALL (AND)' : 'ANY (OR)'), cls: 'logic' });
    if (s.failureMode === 'damage') out.push({ label: 'BLACK_ICE', cls: 'ice' });
    return out;
  }

  _editorContext(cfg, id) {
    const isNew = id === 'new';
    const a = isNew ? foundry.utils.deepClone(DEFAULTS.TERMINAL_ACCOUNT) : (cfg.accounts || []).find(x => x.id === id);
    if (!a) return null;
    const s = a.security || {};

    // ── Linked identity (A) — a pending pick (unsaved) overrides the stored link ──
    const link = this._editorLink ?? { masterContactId: a.masterContactId || '', actorId: a.actorId || '' };
    let linkedName = '', linkedEmail = '', linkedPortrait = null, linkedSource = '';
    if (link.masterContactId) {
      const c = game.nightcity?.masterContactService?.getContact(link.masterContactId);
      if (c) {
        linkedName = c.name; linkedEmail = c.email || ''; linkedSource = 'CONTACT';
        linkedPortrait = game.nightcity?.portraitService?.resolvePortrait?.(c) || c.portrait || null;
      }
    } else if (link.actorId) {
      const act = game.actors?.get(link.actorId);
      if (act) {
        linkedName = act.name; linkedEmail = act.getFlag(MODULE_ID, 'email') || '';
        linkedPortrait = act.img || null; linkedSource = 'ACTOR';
      }
    }

    // ── Clearance chips (C) ──
    const clearance = a.clearance || '';
    const clearanceIsCustom = !!clearance && !CLEARANCE_PRESETS.includes(clearance);

    // ── Skill dropdown (E) — SKILL_MAP keys, keeping a legacy value visible ──
    const curSkill = (s.bypassSkills || [])[0] || 'Interface';
    const skills = Object.keys(SKILL_MAP);
    if (!skills.includes(curSkill)) skills.unshift(curSkill);

    const cls = a.classification || '';
    const failureMode = s.failureMode || 'lockout';

    return {
      isNew, id: a.id,
      displayName: a.displayName || '', username: a.username || '', email: a.email || '',
      isAdmin: !!a.isAdmin, hidden: !!a.hidden,
      portrait: a.portrait || '',
      isLinked: !!linkedName,
      linkedName, linkedEmail, linkedPortrait, linkedSource,
      linkedInitials: (linkedName[0] || '?').toUpperCase(),
      // Credential / badge fields
      role: a.role || '', clearance, idNumber: a.idNumber || '',
      location: a.location || '', lastLogin: a.lastLogin || '',
      clearanceChips: CLEARANCE_PRESETS.map(v => ({ value: v, on: v === clearance })),
      clearanceIsCustom,
      classification: cls,
      isRestricted: cls === 'RESTRICTED', isConfidential: cls === 'CONFIDENTIAL',
      isSecret: cls === 'SECRET', isTopSecret: cls === 'TOP SECRET',
      requiresAuth: !!s.requiresAuth,
      allowPassword: !!(s.allowPassword ?? s.password),
      password: s.password || '',
      allowSkillCheck: !!s.allowSkillCheck,
      skillOpts: skills.map(v => ({ value: v, selected: v === curSkill })),
      bypassDC: s.bypassDC ?? 15,
      allowKeyItem: !!s.allowKeyItem,
      keyItemName: s.keyItemName || '',
      // Network visibility — the account only exists on these uplinks.
      netRestricted: !!a.network?.restricted,
      netAllowed: (this.networkService?.getAllNetworks?.() || []).map(n => ({
        id: n.id, name: n.name, checked: (a.network?.allowedNetworks || []).includes(n.id),
      })),
      authLogic: s.authLogic || 'any',
      failureMode,
      failNothing: failureMode === 'nothing', failLockout: failureMode === 'lockout',
      failPermanent: failureMode === 'permanent', failDamage: failureMode === 'damage',
      maxAttempts: s.maxAttempts ?? 3,
      lockoutMin: Math.round((s.lockoutDuration ?? 3600000) / 60000),
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  Render — restore tab + manual change listeners
  // ═══════════════════════════════════════════════════════════

  /**
   * Scroll memo (2026-10-25): every data-action re-renders the whole sheet, so
   * unfolding an account or a folder snapped the sheet back to the top. The
   * .ncm-cfg-content scroller and every per-folder scroller ([data-ct-scroll])
   * remember their position across the render; opening/closing the account
   * editor deliberately starts at the top (`_scrollReset`).
   * @override
   */
  async _preRender(context, options) {
    await super._preRender?.(context, options);
    const el = this.element;
    if (!el) return;
    if (this._scrollReset) { this._scrollReset = false; this._scrollMemo = null; return; }
    const memo = { content: el.querySelector('.ncm-cfg-content')?.scrollTop ?? 0, inner: {} };
    el.querySelectorAll('[data-ct-scroll]').forEach(s => { if (s.scrollTop) memo.inner[s.dataset.ctScroll] = s.scrollTop; });
    this._scrollMemo = memo;
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const el = this.element;
    if (!el) return;
    const memo = this._scrollMemo;
    if (memo) {
      const c = el.querySelector('.ncm-cfg-content');
      if (c && memo.content) c.scrollTop = memo.content;
      for (const [k, v] of Object.entries(memo.inner)) {
        const s = el.querySelector(`[data-ct-scroll="${CSS.escape(k)}"]`);
        if (s) s.scrollTop = v;
      }
    }
    el.querySelectorAll('.ncm-cfg-tab').forEach(t => t.classList.toggle('ncm-cfg-tab--active', t.dataset.tab === this._activeTab));
    el.querySelectorAll('.ncm-cfg-panel').forEach(p => p.classList.toggle('ncm-cfg-panel--active', p.dataset.panel === this._activeTab));

    this._wireBootTab(el, context);
    this._foldOpenAfterRender();   // accordion: grow a just-opened fold from 0
    this._wireAccountsTab(el);
    this._wireContentTab(el);
    this._wireAccountEditor(el);
    this._wireThemeTab(el);
    // Paint the in-sheet theme preview (draft or saved) on every render.
    this._applyThemeLive();
  }

  /**
   * Boot & Login tab wiring — live splash preview, icon source segments +
   * searchable icon grid, animation/speed chips, login-style cards. All
   * DOM-only (no re-render); chips/segments/cards mirror into hidden inputs
   * bearing the ORIGINAL field names so _onSave reads one contract.
   * @private
   */
  _wireBootTab(el, context) {
    const panel = el.querySelector('[data-panel="boot"]');
    if (!panel) return;
    const esc = Handlebars.escapeExpression;

    // ── Live splash preview bindings ──
    const bp = (key) => panel.querySelector(`[data-bp="${key}"]`);
    const syncBootIcon = () => {
      const mode = panel.querySelector('[name="bootIconMode"]')?.value || 'preset';
      panel.querySelector('[data-boot-icon-row="fa"]')?.classList.toggle('ncm-cfg-row--hidden', mode !== 'fa');
      panel.querySelector('[data-boot-icon-row="image"]')?.classList.toggle('ncm-cfg-row--hidden', mode !== 'image');
      const fa = panel.querySelector('[name="bootFaIcon"]')?.value?.trim();
      const img = panel.querySelector('[name="bootImageUrl"]')?.value?.trim();
      const presetIcon = context.bootIcon || 'fas fa-server';
      const iconHtml = (mode === 'image' && img)
        ? `<img src="${esc(img)}" alt="">`
        : `<i class="${esc((mode === 'fa' && fa) ? fa : presetIcon)}"></i>`;
      const prev = bp('icon');
      if (prev) {
        prev.innerHTML = iconHtml;
        // "No frame" preview — mirror the viewer's --free treatment.
        const free = mode === 'image' && !!panel.querySelector('[name="bootImageFree"]')?.checked;
        prev.classList.toggle('ncm-cfg-bootprev-icon--free', free);
      }
    };
    const bindText = (name, key) => {
      panel.querySelector(`[name="${name}"]`)?.addEventListener('input', (e) => {
        const t = bp(key);
        if (t) t.textContent = e.target.value;
      });
    };
    bindText('bootTitle', 'title');
    bindText('bootSubtitle', 'subtitle');
    const syncLog = () => {
      const t = bp('log');
      if (t) t.innerHTML = [...panel.querySelectorAll('[name="bootLogLine"]')]
        .map(i => i.value.trim()).filter(Boolean).map(v => `<div>${esc(v)}</div>`).join('');
    };
    panel.querySelectorAll('[name="bootLogLine"]').forEach(i => i.addEventListener('input', syncLog));

    // ── Icon source segments ──
    panel.querySelectorAll('[data-icon-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        const modeInput = panel.querySelector('[name="bootIconMode"]');
        if (modeInput) modeInput.value = btn.dataset.iconMode;
        panel.querySelectorAll('[data-icon-mode]').forEach(b => b.classList.toggle('is-on', b === btn));
        syncBootIcon();
      });
    });

    // ── Icon grid: search filter + pick ──
    panel.querySelector('[data-icon-search]')?.addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      panel.querySelectorAll('[data-icon-class]').forEach(cell => {
        const hit = !q || cell.dataset.iconClass.includes(q) || (cell.dataset.iconK || '').includes(q);
        cell.style.display = hit ? '' : 'none';
      });
    });
    panel.querySelectorAll('[data-icon-class]').forEach(cell => {
      cell.addEventListener('click', () => {
        const input = panel.querySelector('[name="bootFaIcon"]');
        if (input) input.value = cell.dataset.iconClass;
        panel.querySelectorAll('[data-icon-class]').forEach(c => c.classList.toggle('is-on', c === cell));
        syncBootIcon();
      });
    });
    panel.querySelector('[name="bootFaIcon"]')?.addEventListener('input', () => {
      // Free-typed class: clear the grid highlight unless it matches a cell.
      const v = panel.querySelector('[name="bootFaIcon"]')?.value?.trim();
      panel.querySelectorAll('[data-icon-class]').forEach(c => c.classList.toggle('is-on', c.dataset.iconClass === v));
      syncBootIcon();
    });
    panel.querySelector('[name="bootImageUrl"]')?.addEventListener('input', syncBootIcon);
    panel.querySelector('[name="bootImageFree"]')?.addEventListener('change', syncBootIcon);
    // Boot VIDEO (2026-10-25): the splash preview cannot play it, so it says so.
    const syncBootVideo = () => {
      const url = panel.querySelector('[name="bootVideoUrl"]')?.value?.trim();
      const note = panel.querySelector('[data-bp="video"]');
      if (note) { note.style.display = url ? '' : 'none'; note.querySelector('b').textContent = url ? url.split('/').pop() : ''; }
      panel.querySelector('.ncm-cfg-bootprev-splash')?.classList.toggle('is-video', !!url);
    };
    panel.querySelector('[name="bootVideoUrl"]')?.addEventListener('input', syncBootVideo);
    syncBootVideo();

    // ── Animation / speed chips. Picking a boot animation replays it in the
    //    splash preview (attr swap + forced reflow to restart the CSS). ──
    const splash = panel.querySelector('.ncm-cfg-bootprev-splash');
    const replayBootAnim = (anim) => {
      if (!splash) return;
      splash.removeAttribute('data-boot-animation');
      void splash.offsetWidth; // reflow — restart the entrance animation
      splash.setAttribute('data-boot-animation', anim);
    };
    panel.querySelectorAll('[data-chip-group]').forEach(group => {
      const name = group.dataset.chipGroup;
      group.querySelectorAll('[data-chip]').forEach(chip => {
        chip.addEventListener('click', () => {
          const input = panel.querySelector(`[name="${name}"]`);
          if (input) input.value = chip.dataset.chip;
          group.querySelectorAll('[data-chip]').forEach(c => c.classList.toggle('is-on', c === chip));
          if (name === 'bootAnimation') replayBootAnim(chip.dataset.chip);
          if (name === 'bootSpeed') {
            // The seconds field shows only for the custom chip. style.display,
            // not [hidden] — .ncm-cfg-row is display:flex and would win.
            const row = panel.querySelector('[data-boot-custom]');
            if (row) row.style.display = chip.dataset.chip === 'custom' ? '' : 'none';
          }
        });
      });
    });
    // Initial preview animation state (no replay — just the attribute), and
    // the explicit ▶ REPLAY button.
    splash?.setAttribute('data-boot-animation', panel.querySelector('[name="bootAnimation"]')?.value || 'standard-fade');
    panel.querySelector('[data-boot-replay]')?.addEventListener('click', () => {
      replayBootAnim(panel.querySelector('[name="bootAnimation"]')?.value || 'standard-fade');
    });

    // ── Mailbox layout cards (hidden input `mailboxStyle`, the login-style contract) ──
    panel.querySelectorAll('[data-mailbox-style]').forEach(card => {
      card.addEventListener('click', () => {
        const input = panel.querySelector('[name="mailboxStyle"]');
        if (input) input.value = card.dataset.mailboxStyle;
        panel.querySelectorAll('[data-mailbox-style]').forEach(c => c.classList.toggle('is-on', c === card));
        // Stage it (survives re-renders, beats a staged kit) and show it on any open viewer.
        this._stagedMailboxStyle = card.dataset.mailboxStyle;
        this._applyThemeLive();
      });
    });

    // ── Login style cards + live login preview ──
    panel.querySelectorAll('[data-login-style]').forEach(card => {
      card.addEventListener('click', () => {
        const input = panel.querySelector('[name="loginStyle"]');
        if (input) input.value = card.dataset.loginStyle;
        panel.querySelectorAll('[data-login-style]').forEach(c => c.classList.toggle('is-on', c === card));
        this._syncLoginPreview(panel);
      });
    });

    // ── Sound profile cards + audition. The audition plays a short demo
    //    (boot → login-success → login-fail) through the clicked card's set,
    //    so the GM hears a set BEFORE selecting it. Real setTimeout — pure
    //    UI feedback, not game time. ──
    panel.querySelectorAll('[data-sound-set]').forEach(card => {
      card.addEventListener('click', () => {
        const input = panel.querySelector('[name="soundSet"]');
        if (input) input.value = card.dataset.soundSet;
        panel.querySelectorAll('[data-sound-set]').forEach(c => c.classList.toggle('is-on', c === card));
      });
    });
    panel.querySelector('[data-sound-audition]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const setKey = panel.querySelector('[name="soundSet"]')?.value || 'default';
      const demo = ['shard-boot', 'login-success', 'login-fail'];
      demo.forEach((id, i) => {
        setTimeout(() => {
          const s = resolveTerminalSound(setKey, id);
          this.soundService?.playStyled?.(s.id, { rate: s.rate, volume: s.volume });
        }, i * 900);
      });
    });

    // ── Screensaver: icon-source segments, option rows, live preview ──
    const syncSsRows = () => {
      const mode = panel.querySelector('[name="ssIconMode"]')?.value || 'boot';
      panel.querySelector('[data-ss-row="fa"]')?.classList.toggle('ncm-cfg-row--hidden', mode !== 'fa');
      panel.querySelector('[data-ss-row="image"]')?.classList.toggle('ncm-cfg-row--hidden', mode !== 'image');
    };
    panel.querySelectorAll('[data-ss-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = panel.querySelector('[name="ssIconMode"]');
        if (input) input.value = btn.dataset.ssMode;
        panel.querySelectorAll('[data-ss-mode]').forEach(b => b.classList.toggle('is-on', b === btn));
        syncSsRows();
        this._syncSsPreview(panel);
      });
    });
    ['ssFaIcon', 'ssImageUrl', 'ssText'].forEach(n => {
      panel.querySelector(`[name="${n}"]`)?.addEventListener('input', () => this._syncSsPreview(panel));
    });
    panel.querySelectorAll('[data-chip-group="ssMotion"] [data-chip]').forEach(chip => {
      chip.addEventListener('click', () => this._syncSsPreview(panel));
    });

    syncBootIcon();
    syncSsRows();
    this._syncLoginPreview(panel);
    this._syncSsPreview(panel);
  }

  /**
   * Mini live preview of the selected login style, built from the terminal's
   * REAL accounts (first three). Pure DOM — rebuilt on every card click.
   * @private
   */
  _syncLoginPreview(panel) {
    const host = panel.querySelector('.ncm-cfg-lprev');
    if (!host) return;
    const esc = Handlebars.escapeExpression;
    const style = panel.querySelector('[name="loginStyle"]')?.value || 'cards';
    const cfg = this.terminalService.getConfig(this.item);
    const accounts = (cfg.accounts || []).filter(a => !a.hidden).slice(0, 3);
    if (!accounts.length) accounts.push({ displayName: 'operator', username: 'operator', security: { requiresAuth: true } });
    const nm = (a) => esc(a.displayName || a.username || 'user');
    const ini = (a) => esc((a.displayName || a.username || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase());
    const locked = (a) => a.security?.requiresAuth !== false;
    const name = esc(cfg.terminalName || this.item?.name || 'TERMINAL');
    let html = '';
    if (style === 'crt') {
      html = `<div class="ncm-cfg-lprev-crt"><div class="ncm-cfg-lprev-crthd">${name}</div>` +
        accounts.map(a => `<div>&gt; ${esc(a.username || a.displayName)} <span>${locked(a) ? 'LOCKED' : 'OPEN'}</span></div>`).join('') +
        `<div class="ncm-cfg-lprev-crtp">login: <b></b></div></div>`;
    } else if (style === 'roster') {
      html = `<div class="ncm-cfg-lprev-roster">` + accounts.map(a =>
        `<div class="ncm-cfg-lprev-rrow"><span class="ncm-cfg-lprev-av">${ini(a)}</span><span class="ncm-cfg-lprev-nm">${nm(a)}</span><span class="ncm-cfg-lprev-st${locked(a) ? '' : ' is-open'}">${locked(a) ? 'LOCKED' : 'ACTIVE'}</span></div>`).join('') + `</div>`;
    } else if (style === 'lockscreen') {
      const f = accounts[0];
      html = `<div class="ncm-cfg-lprev-lock"><span class="ncm-cfg-lprev-bigav">${ini(f)}</span><b>${nm(f)}</b><span class="ncm-cfg-lprev-pass">enter passcode…</span></div>`;
    } else if (style === 'keypad') {
      html = `<div class="ncm-cfg-lprev-keypad"><span class="ncm-cfg-lprev-lcd">▪ ▪ ▪ _</span><span class="ncm-cfg-lprev-pad">${[1,2,3,4,5,6,7,8,9,'✕',0,'⏎'].map(k => `<b>${k}</b>`).join('')}</span></div>`;
    } else if (style === 'portraits') {
      html = `<div class="ncm-cfg-lprev-ports">` + accounts.map(a =>
        `<span class="ncm-cfg-lprev-port"><span class="ncm-cfg-lprev-bigav">${ini(a)}</span><i>${nm(a)}</i></span>`).join('') + `</div>`;
    } else {
      html = `<div class="ncm-cfg-lprev-cards">` + accounts.map(a =>
        `<span class="ncm-cfg-lprev-card"><span class="ncm-cfg-lprev-av">${ini(a)}</span><b>${nm(a)}</b><i>${locked(a) ? '⚿ SECURED' : 'OPEN'}</i></span>`).join('') + `</div>`;
    }
    host.innerHTML = html;
  }

  /**
   * Mini live preview of the idle screensaver (logo + marquee, motion class).
   * @private
   */
  _syncSsPreview(panel) {
    const host = panel.querySelector('.ncm-cfg-ssprev');
    if (!host) return;
    const esc = Handlebars.escapeExpression;
    const cfg = this.terminalService.getConfig(this.item);
    const mode = panel.querySelector('[name="ssIconMode"]')?.value || 'boot';
    const fa = panel.querySelector('[name="ssFaIcon"]')?.value?.trim();
    const img = panel.querySelector('[name="ssImageUrl"]')?.value?.trim();
    const text = panel.querySelector('[name="ssText"]')?.value?.trim() || cfg.terminalName || this.item?.name || 'TERMINAL';
    const motion = panel.querySelector('[name="ssMotion"]')?.value || 'drift';
    let logo = '';
    if (mode !== 'none') {
      if (mode === 'image' && img) logo = `<img src="${esc(img)}" alt="">`;
      else if (mode === 'fa' && fa) logo = `<i class="${esc(fa)}"></i>`;
      else {
        const bootFa = panel.querySelector('[name="bootFaIcon"]')?.value?.trim();
        const bootImg = panel.querySelector('[name="bootImageUrl"]')?.value?.trim();
        const bootMode = panel.querySelector('[name="bootIconMode"]')?.value || 'preset';
        if (bootMode === 'image' && bootImg) logo = `<img src="${esc(bootImg)}" alt="">`;
        else {
          // Draft-aware preset key: a staged preset's icon previews before Save.
          const presetKey = this._themeDraft?.preset || cfg.theme?.preset;
          logo = `<i class="${esc((bootMode === 'fa' && bootFa) ? bootFa : (TERMINAL_PRESETS[presetKey]?.icon || 'fas fa-server'))}"></i>`;
        }
      }
    }
    host.dataset.ssMotion = motion;
    host.innerHTML = `<div class="ncm-cfg-ssprev-inner">${logo ? `<div class="ncm-cfg-ssprev-logo">${logo}</div>` : ''}<div class="ncm-cfg-ssprev-text">${esc(text)}</div></div>`;
  }

  /** Roll 4 random flavor lines into the boot log list (DOM-only — Save keeps). */
  static _onGenerateBootLines() {
    const panel = this.element?.querySelector('[data-panel="boot"]');
    const list = panel?.querySelector('.ncm-cfg-boot-log-list');
    if (!list) return;
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const esc = Handlebars.escapeExpression;
    const lines = [];
    const used = new Set();
    while (lines.length < 4 && used.size < BOOT_FLAVOR_LINES.templates.length) {
      const t = pick(BOOT_FLAVOR_LINES.templates);
      if (used.has(t)) continue;
      used.add(t);
      lines.push(`${t.replace('{NET}', pick(BOOT_FLAVOR_LINES.nets))} ${pick(BOOT_FLAVOR_LINES.statuses)}`);
    }
    list.innerHTML = lines.map(l =>
      `<div class="ncm-cfg-boot-log-entry"><input type="text" name="bootLogLine" class="ncm-cfg-input" value="${esc(l)}"><button type="button" class="ncm-cfg-btn-icon ncm-cfg-btn-icon--danger" data-action="removeBootLogLine"><i class="fas fa-times"></i></button></div>`).join('');
    // Refresh the preview + rebind the new inputs.
    const t = this.element?.querySelector('[data-bp="log"]');
    if (t) t.innerHTML = lines.map(l => `<div>${esc(l)}</div>`).join('');
    list.querySelectorAll('[name="bootLogLine"]').forEach(i => i.addEventListener('input', () => {
      if (t) t.innerHTML = [...list.querySelectorAll('[name="bootLogLine"]')]
        .map(x => x.value.trim()).filter(Boolean).map(v => `<div>${esc(v)}</div>`).join('');
    }));
  }

  /** FilePicker for the screensaver image (Boot & Login tab). */
  static _onBrowseSsImage() {
    const input = this.element?.querySelector('[name="ssImageUrl"]');
    new FilePicker({
      type: 'image',
      current: input?.value || '',
      callback: (path) => {
        if (input) { input.value = path; input.dispatchEvent(new Event('input', { bubbles: true })); }
      },
    }).render(true);
  }

  // ═══════════════════════════════════════════════════════════
  //  Full terminal preset library (world setting terminalPresetLibrary):
  //  theme + boot + loginStyle + login + screensaver + folderNames +
  //  metadata + account SEEDS (ids and world-specific links stripped).
  // ═══════════════════════════════════════════════════════════

  _getFullPresets() {
    try { return game.settings.get(MODULE_ID, 'terminalPresetLibrary') ?? []; } catch { return []; }
  }

  async _setFullPresets(presets) {
    await game.settings.set(MODULE_ID, 'terminalPresetLibrary', presets);
  }

  /** Snapshot the current terminal as a reusable preset config. @private */
  _collectFullPreset() {
    const cfg = this.terminalService.getConfig(this.item);
    const pick = foundry.utils.deepClone({
      theme: this._themeDraft ?? cfg.theme ?? { preset: 'classic' },
      boot: cfg.boot || {},
      loginStyle: cfg.loginStyle || 'cards',
      mailboxStyle: cfg.mailboxStyle || 'classic',
      login: cfg.login || {},
      screensaver: cfg.screensaver || {},
      folderNames: cfg.folderNames || {},
      folders: cfg.folders || {},
      metadata: cfg.metadata || {},
      soundSet: cfg.soundSet || 'default',
      accounts: (cfg.accounts || []).map(a => {
        // Seeds, not copies: fresh ids on apply; world-specific identity
        // links don't travel (they reference this world's documents).
        const seed = foundry.utils.deepClone(a);
        delete seed.id; delete seed.masterContactId; delete seed.actorId;
        return seed;
      }),
    });
    return pick;
  }

  static async _onSaveFullPreset() {
    const name = await new Promise(resolve => {
      adminDialog({
        title: 'Save Terminal Preset',
        content: '<div style="padding:8px 0;"><label style="font-family:\'Share Tech Mono\',monospace;font-size:10px;color:#8888a0;text-transform:uppercase;">Preset Name</label><input type="text" id="ncm-fpreset-name" value="My Terminal" style="width:100%;margin-top:4px;padding:6px 8px;background:#0a0a0f;border:1px solid #2a2a45;color:#e0e0e8;font-family:\'Rajdhani\',sans-serif;font-size:13px;border-radius:2px;" /></div>',
        buttons: {
          save: { icon: '<i class="fas fa-save"></i>', label: 'Save', callback: (html) => resolve(html.find('#ncm-fpreset-name').val()?.trim()) },
          cancel: { label: 'Cancel', callback: () => resolve(null) },
        },
        default: 'save',
      }, { classes: ['ncm-pick-dialog'], width: 340 }).render(true);
    });
    if (!name) return;
    const presets = this._getFullPresets();
    presets.push({ name, config: this._collectFullPreset() });
    await this._setFullPresets(presets);
    this.render(false);
    ui.notifications.info(`Saved terminal preset: ${name}`);
  }

  static async _onApplyFullPreset(event, target) {
    const index = parseInt(target.closest('[data-fpreset-index]')?.dataset.fpresetIndex, 10);
    const entry = this._getFullPresets()[index];
    if (!entry?.config) return;
    const cfg = this.terminalService.getConfig(this.item);
    const seedCount = (entry.config.accounts || []).length;
    const confirmed = await adminConfirm({
      title: `Apply Terminal Preset: ${entry.name}`,
      content: `<p>Overwrites this terminal's <strong>theme, boot, login style, mailbox layout, MOTD/welcome, screensaver, and folder names</strong>${(cfg.accounts || []).length ? '' : (seedCount ? ` and seeds <strong>${seedCount} account${seedCount === 1 ? '' : 's'}</strong>` : '')}. Messages and existing accounts are untouched.</p>`,
    });
    if (!confirmed) return;
    const { accounts, ...rest } = foundry.utils.deepClone(entry.config);
    await this.terminalService.updateConfig(this.item, rest);
    if (!(cfg.accounts || []).length && Array.isArray(accounts)) {
      for (const seed of accounts) await this.terminalService.addAccount(this.item, seed);
    }
    this._themeDraft = null; // the preset's theme is now the saved theme
    this._revertThemePreview();
    this.render(false);
    ui.notifications.info(`Applied terminal preset: ${entry.name}`);
  }

  static async _onOverwriteFullPreset(event, target) {
    const index = parseInt(target.closest('[data-fpreset-index]')?.dataset.fpresetIndex, 10);
    const presets = this._getFullPresets();
    if (!presets[index]) return;
    presets[index] = { name: presets[index].name, config: this._collectFullPreset() };
    await this._setFullPresets(presets);
    this.render(false);
    ui.notifications.info(`Overwrote terminal preset: ${presets[index].name}`);
  }

  static async _onDeleteFullPreset(event, target) {
    const index = parseInt(target.closest('[data-fpreset-index]')?.dataset.fpresetIndex, 10);
    const presets = this._getFullPresets();
    if (!presets[index]) return;
    const name = presets[index].name;
    const confirmed = await adminConfirm({ title: 'Delete Terminal Preset', content: `<p>Delete "${name}" from the library?</p>` });
    if (!confirmed) return;
    presets.splice(index, 1);
    await this._setFullPresets(presets);
    this.render(false);
    ui.notifications.info(`Deleted terminal preset: ${name}`);
  }

  static _onExportFullPreset(event, target) {
    // Export a library entry when clicked from a row; else the current terminal.
    const index = parseInt(target.closest('[data-fpreset-index]')?.dataset.fpresetIndex, 10);
    const entry = Number.isInteger(index) ? this._getFullPresets()[index] : null;
    const name = entry?.name || this.item?.name || 'terminal';
    const config = entry?.config || this._collectFullPreset();
    const blob = new Blob([JSON.stringify({ ncmTerminalPreset: 1, name, config }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ncm-terminal-preset-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    ui.notifications.info(`Exported terminal preset: ${name}`);
  }

  static _onImportFullPreset() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        if (!parsed?.ncmTerminalPreset || !parsed.config) return ui.notifications.warn('Not a terminal preset file.');
        const presets = this._getFullPresets();
        presets.push({ name: parsed.name || file.name.replace(/\.json$/i, ''), config: parsed.config });
        await this._setFullPresets(presets);
        this.render(false);
        ui.notifications.info(`Imported terminal preset: ${parsed.name} — apply it from the library list.`);
      } catch (err) {
        log.error(`Terminal preset import failed: ${err.message}`);
        ui.notifications.error('Failed to import preset file.');
      }
    });
    input.click();
  }

  /** FilePicker for the terminal wallpaper (Theme tab — writes the draft). */
  static _onBrowseWallpaper() {
    const input = this.element?.querySelector('[data-ttc-wallpaper]');
    new FilePicker({
      type: 'image',
      current: input?.value || '',
      callback: (path) => {
        if (input) input.value = path;
        this._ensureThemeDraft().wallpaper = path;
        this._applyThemeLive();
      },
    }).render(true);
  }

  /**
   * Manual listeners for the account editor (A–F UX widgets). All state that
   * chips/pills carry is mirrored into hidden inputs bearing the ORIGINAL
   * field names, so `_onSaveAccount` reads one contract. No-ops when the
   * editor isn't open.
   * @private
   */
  _wireAccountEditor(el) {
    const editor = el.querySelector('.ncm-acct-editor');
    if (!editor) return;
    const esc = Handlebars.escapeExpression;

    // ── Dirty tracking (F) ──
    const markDirty = () => editor.classList.add('ncm-acct-editor--dirty');
    editor.addEventListener('input', markDirty);
    editor.addEventListener('change', markDirty);
    this._markEditorDirty = markDirty;

    // ── Network-gated toggle: show/hide the uplink checkbox row ──
    const netToggle = el.querySelector('[name="acctNetRestricted"]');
    netToggle?.addEventListener('change', () => {
      const row = el.querySelector('[data-acct-net-row]');
      if (row) row.hidden = !netToggle.checked;
    });

    // ── B · Portrait tile: live preview ──
    const syncPortrait = () => {
      const tile = el.querySelector('.ncm-acct-portile');
      if (!tile) return;
      const path = el.querySelector('[name="acctPortrait"]')?.value?.trim();
      tile.innerHTML = path ? `<img src="${esc(path)}" alt="">` : '<i class="fas fa-user"></i>';
    };
    el.querySelector('[name="acctPortrait"]')?.addEventListener('input', syncPortrait);

    // ── A · Identity search dropdown ──
    const search = el.querySelector('.ncm-acct-idsearch');
    const dd = el.querySelector('.ncm-acct-dd');
    if (search && dd) {
      search.addEventListener('input', () => {
        const q = search.value.trim().toLowerCase();
        if (!q) { dd.hidden = true; dd.innerHTML = ''; return; }
        const hits = this._identityCandidates()
          .filter(c => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q))
          .slice(0, 8);
        dd.innerHTML = hits.map((c, i) => `
          <div class="ncm-acct-dd-row" data-idx="${i}">
            <span class="ncm-acct-dd-pic">${c.portrait ? `<img src="${esc(c.portrait)}" alt="">` : esc((c.name[0] || '?').toUpperCase())}</span>
            <span class="ncm-acct-dd-id"><span class="ncm-acct-dd-nm">${esc(c.name)}</span><span class="ncm-acct-dd-em">${esc(c.email)}</span></span>
            <span class="ncm-acct-dd-src ncm-acct-dd-src--${c.kind}">${c.kind === 'contact' ? 'CONTACT' : 'ACTOR'}</span>
          </div>`).join('')
          || '<div class="ncm-acct-dd-empty">no matches — save with an email to create a new contact</div>';
        dd.hidden = false;
        dd.querySelectorAll('.ncm-acct-dd-row').forEach(r =>
          r.addEventListener('click', () => this._applyIdentityPick(hits[Number(r.dataset.idx)])));
      });
    }

    // ── C · Chip sets writing hidden inputs (clearance / classification / logic / failure) ──
    el.querySelectorAll('.ncm-acct-chips[data-chipset]').forEach(set => {
      set.addEventListener('click', (ev) => {
        const chip = ev.target.closest('[data-value]');
        if (!chip) return;
        const input = el.querySelector(`[name="${set.dataset.chipset}"]`);
        set.querySelectorAll('[data-value]').forEach(c => {
          const cls = c.classList.contains('ncm-acct-pill') ? 'ncm-acct-pill--on' : 'ncm-acct-chip--on';
          c.classList.toggle(cls, c === chip);
        });
        if (set.dataset.chipset === 'acctClearance') {
          const isCustom = chip.dataset.value === '__custom';
          const row = el.querySelector('.ncm-acct-clear-custom-row');
          if (row) row.hidden = !isCustom;
          if (input) input.value = isCustom ? (el.querySelector('.ncm-acct-clear-custom')?.value || '') : chip.dataset.value;
        } else if (input) {
          input.value = chip.dataset.value;
        }
        markDirty();
      });
    });
    el.querySelector('.ncm-acct-clear-custom')?.addEventListener('input', (ev) => {
      const input = el.querySelector('[name="acctClearance"]');
      if (input) input.value = ev.target.value;
    });

    // ── D · Last-access time composer (game clock via timeService) ──
    const timeWrap = el.querySelector('.ncm-acct-timechips');
    if (timeWrap) {
      const lastInput = el.querySelector('[name="acctLastLogin"]');
      const customRow = el.querySelector('.ncm-acct-time-custom-row');
      const stamp = (iso) => {
        if (!lastInput) return;
        try { lastInput.value = formatCyberDate(iso); } catch { lastInput.value = iso; }
        markDirty();
      };
      timeWrap.addEventListener('click', (ev) => {
        const chip = ev.target.closest('.ncm-acct-chip');
        if (!chip) return;
        timeWrap.querySelectorAll('.ncm-acct-chip').forEach(c => c.classList.toggle('ncm-acct-chip--on', c === chip));
        if (chip.hasAttribute('data-time-custom')) { if (customRow) customRow.hidden = false; return; }
        if (customRow) customRow.hidden = true;
        const off = Number(chip.dataset.timeOffset) || 0;
        const nowMs = game.nightcity?.timeService?.getCurrentTimeMs?.() ?? Date.now();
        stamp(new Date(nowMs - off).toISOString());
      });
      el.querySelector('.ncm-acct-time-custom')?.addEventListener('change', (ev) => {
        if (ev.target.value) stamp(new Date(ev.target.value).toISOString());
      });
    }

    // ── E · Method-card toggles tint their card ──
    el.querySelectorAll('.ncm-acct-mcard').forEach(card => {
      const tgl = card.querySelector('.ncm-acct-tgl input');
      tgl?.addEventListener('change', () => card.classList.toggle('ncm-acct-mcard--on', tgl.checked));
    });
  }

  /** Search pool for the identity picker: master contacts + world actors. @private */
  _identityCandidates() {
    const out = [];
    const svc = game.nightcity;
    for (const c of svc?.masterContactService?.getAll?.() || []) {
      out.push({
        kind: 'contact', id: c.id, name: c.name || '', email: c.email || '',
        portrait: svc?.portraitService?.resolvePortrait?.(c) || c.portrait || null,
        actorId: c.actorId || '',
      });
    }
    const linkedActors = new Set(out.map(x => x.actorId).filter(Boolean));
    for (const a of game.actors || []) {
      if (linkedActors.has(a.id)) continue; // already reachable via its contact
      out.push({ kind: 'actor', id: a.id, name: a.name || '', email: a.getFlag(MODULE_ID, 'email') || '', portrait: a.img || null, actorId: a.id });
    }
    return out;
  }

  /** Apply an identity pick: link + autofill name/email/portrait, DOM-only
   *  (a render would discard the GM's other unsaved edits). @private */
  _applyIdentityPick(c) {
    const el = this.element;
    if (!el || !c) return;
    this._editorLink = { masterContactId: c.kind === 'contact' ? c.id : '', actorId: c.actorId || '' };
    const esc = Handlebars.escapeExpression;
    const fill = (name, v) => {
      const i = el.querySelector(`[name="${name}"]`);
      if (i) { i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); }
    };
    fill('acctDisplayName', c.name);
    if (c.email) fill('acctEmail', c.email);
    if (c.portrait) fill('acctPortrait', c.portrait);
    const card = el.querySelector('.ncm-acct-idcard');
    if (card) {
      card.classList.remove('ncm-acct-idcard--none');
      card.querySelector('[data-id-name]').textContent = c.name;
      card.querySelector('[data-id-email]').textContent = c.email || '';
      card.querySelector('[data-id-tag]').textContent = `LINKED · ${c.kind === 'contact' ? 'CONTACT' : 'ACTOR'}`;
      const pic = card.querySelector('.ncm-acct-idcard-pic');
      if (pic) pic.innerHTML = c.portrait ? `<img src="${esc(c.portrait)}" alt="">` : esc((c.name[0] || '?').toUpperCase());
    }
    const search = el.querySelector('.ncm-acct-idsearch');
    if (search) search.value = '';
    const dd = el.querySelector('.ncm-acct-dd');
    if (dd) { dd.hidden = true; dd.innerHTML = ''; }
    this._markEditorDirty?.();
  }

  /** FilePicker for the account portrait. */
  static _onBrowseAcctPortrait() {
    const input = this.element?.querySelector('[name="acctPortrait"]');
    new FilePicker({
      type: 'image',
      current: input?.value || '',
      callback: (path) => {
        if (input) { input.value = path; input.dispatchEvent(new Event('input', { bubbles: true })); }
      },
    }).render(true);
  }

  /** FilePicker for the boot VIDEO (.webm / .mp4). */
  static _onBrowseBootVideo() {
    const input = this.element?.querySelector('[name="bootVideoUrl"]');
    new FilePicker({
      type: 'video',
      current: input?.value || '',
      callback: (path) => {
        if (input) { input.value = path; input.dispatchEvent(new Event('input', { bubbles: true })); }
      },
    }).render(true);
  }
  static _onClearBootVideo() {
    const input = this.element?.querySelector('[name="bootVideoUrl"]');
    if (input) { input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); }
  }

  /** FilePicker for the boot logo image. */
  static _onBrowseBootImage(event, target) {
    const input = this.element?.querySelector('[name="bootImageUrl"]');
    new FilePicker({
      type: 'image',
      current: input?.value || '',
      callback: (path) => {
        if (input) { input.value = path; input.dispatchEvent(new Event('input', { bubbles: true })); }
      },
    }).render(true);
  }

  // ═══════════════════════════════════════════════════════════
  //  Actions
  // ═══════════════════════════════════════════════════════════

  static _onSwitchTab(event, target) {
    this._activeTab = target.dataset.tab;
    const el = this.element;
    el.querySelectorAll('.ncm-cfg-tab').forEach(t => t.classList.toggle('ncm-cfg-tab--active', t.dataset.tab === this._activeTab));
    el.querySelectorAll('.ncm-cfg-panel').forEach(p => p.classList.toggle('ncm-cfg-panel--active', p.dataset.panel === this._activeTab));
  }

  static async _onSaveConfig() {
    const el = this.element;
    const v = (name) => el.querySelector(`[name="${name}"]`);
    const val = (name, d = '') => v(name)?.value ?? d;
    const chk = (name) => !!v(name)?.checked;
    const logLines = [...el.querySelectorAll('[name="bootLogLine"]')].map(i => i.value).filter(s => s.trim());

    const updates = {
      terminalName: val('terminalName'),
      metadata: { owner: val('owner'), org: val('org'), location: val('location'), classification: val('classification') },
      // The theme's save contract is the DRAFT object, not form inputs — the
      // tab's controls are unnamed and mutate _themeDraft via manual listeners
      // (the ThemeCustomizer pattern). No draft = theme untouched, keep as-is.
      theme: foundry.utils.deepClone(this._themeDraft ?? this.terminalService.getConfig(this.item)?.theme ?? { preset: 'classic' }),
      boot: {
        enabled: chk('bootEnabled'),
        title: val('bootTitle'), subtitle: val('bootSubtitle'), banner: val('bootBanner'),
        iconMode: val('bootIconMode', 'preset'), faIcon: val('bootFaIcon'), imageUrl: val('bootImageUrl'),
        imageFrame: chk('bootImageFree') ? 'free' : 'framed',
        animationStyle: val('bootAnimation'), speed: val('bootSpeed'), logLines,
        customSeconds: parseFloat(val('bootCustomSeconds')) || null,
        videoUrl: val('bootVideoUrl'), videoOverlay: chk('bootVideoOverlay'),
      },
      loginStyle: val('loginStyle', 'cards') || 'cards',
      mailboxStyle: val('mailboxStyle', 'classic') || 'classic',
      login: { motd: val('loginMotd'), welcomeText: val('loginWelcome') },
      screensaver: {
        enabled: chk('ssEnabled'),
        idleSeconds: parseInt(val('ssIdle', '120'), 10) || 120,
        text: val('ssText'),
        iconMode: val('ssIconMode', 'boot') || 'boot',
        faIcon: val('ssFaIcon'),
        imageUrl: val('ssImageUrl'),
        motion: val('ssMotion', 'drift') || 'drift',
      },
      // Folder editor rows → folderNames (system names — the preset-compatible
      // contract) + folders (icons / saved-trash visibility / custom folders).
      ...(() => {
        const rows = [...el.querySelectorAll('[data-folder-row]')];
        const sys = (kind) => rows.find(r => r.dataset.folderKind === kind);
        const nameOf = (kind) => sys(kind)?.querySelector('[data-f-name]')?.value?.trim() || '';
        const iconOf = (kind) => sys(kind)?.querySelector('[data-f-icon]')?.value || '';
        const onOf = (kind) => {
          const box = sys(kind)?.querySelector('[data-f-on]');
          return box ? box.checked : true;
        };
        return {
          folderNames: { inbox: nameOf('inbox'), saved: nameOf('saved'), trash: nameOf('trash') },
          folders: {
            icons: { inbox: iconOf('inbox'), saved: iconOf('saved'), trash: iconOf('trash') },
            savedEnabled: onOf('saved'),
            trashEnabled: onOf('trash'),
            custom: rows.filter(r => r.dataset.folderKind === 'custom').map(r => ({
              id: r.dataset.folderId || `f_${foundry.utils.randomID(8)}`,
              name: r.querySelector('[data-f-name]')?.value?.trim() || '',
              icon: r.querySelector('[data-f-icon]')?.value || 'fas fa-folder',
            })).filter(c => c.name),
          },
        };
      })(),
      soundSet: val('soundSet', 'default') || 'default',
      network: {
        required: chk('networkRequired'),
        accessMode: val('accessMode'),
        allowedNetworks: [...el.querySelectorAll('[name="netAllowed"]:checked')].map(i => i.value),
        signalThreshold: parseInt(val('signalThreshold', '40'), 10) || 40,
      },
      scenePin: { range: Math.max(0, parseInt(val('scenePinRange', '0'), 10) || 0) },
      hackResolution: ['inherit', 'auto', 'flagged', 'gm'].includes(val('hackResolution')) ? val('hackResolution') : 'inherit',
      connection: {
        interfaces: [...el.querySelectorAll('[name="uplinkIface"]:checked')].map(i => ({
          networkId: i.value,
          preAuthorized: !!el.querySelector(`[name="uplinkPre"][value="${i.value}"]`)?.checked,
          wired: !!el.querySelector(`[name="uplinkWired"][value="${i.value}"]`)?.checked,
        })),
        defaultNetworkId: val('uplinkDefault') || null,
        allowPlayerSwitching: chk('uplinkAllowSwitch'),
        showSyncHint: chk('uplinkSyncHint'),
      },
      allowExfil: chk('allowExfil'),
      exfil: ['agent', 'shard', 'forward', 'leak', 'sell', 'wipe'].reduce((acc, key) => {
        const cap = key.charAt(0).toUpperCase() + key.slice(1);
        acc[key] = {
          allow: chk(`exfil${cap}Allow`),
          require: chk(`exfil${cap}Require`),
          skill: val(`exfil${cap}Skill`, 'Interface') || 'Interface',
          dv: parseInt(val(`exfil${cap}Dv`, '15'), 10) || 15,
        };
        if (key === 'sell') acc[key].price = Math.max(0, parseInt(val('exfilSellPrice', '0'), 10) || 0);
        return acc;
      }, {}),
    };
    const res = await this.terminalService.updateConfig(this.item, updates);
    if (res?.success) {
      // Staged preset kit: the boot/loginStyle values were read from the
      // (kit-overlaid) DOM inputs above; only the account seeds remain.
      const kit = this._presetKit ? TERMINAL_PRESETS[this._presetKit] : null;
      if (kit && !(this.terminalService.getConfig(this.item).accounts || []).length && Array.isArray(kit.accounts)) {
        for (const seed of kit.accounts) {
          await this.terminalService.addAccount(this.item, foundry.utils.mergeObject(
            { security: { ...(kit.security || {}) } }, seed, { inplace: false }));
        }
        ui.notifications.info(`Seeded ${kit.accounts.length} account${kit.accounts.length === 1 ? '' : 's'} from: ${kit.label}`);
      }
      this._themeDraft = null; // saved — context reads cfg.theme again
      this._presetKit = null;
      this._stagedMailboxStyle = null;
      ui.notifications.info('Terminal configuration saved.');
    } else ui.notifications.error(res?.error || 'Save failed.');
    this.render(false);
  }

  /**
   * "Palette only" — drop the staged preset KIT (boot/login style/accounts),
   * keeping just the colors+fonts in the theme draft.
   */
  static _onClearPresetKit() {
    this._presetKit = null;
    this.render(false);
  }

  /** Add a custom folder row to the Identity tab's folder editor (DOM-only —
      Save reads the rows; no re-render so other unsaved edits survive). */
  static _onFolderAdd() {
    const rows = this.element?.querySelector('[data-folder-rows]');
    if (!rows) return;
    const esc = Handlebars.escapeExpression;
    const opts = TERMINAL_FOLDER_ICONS.map(i =>
      `<option value="${esc(i.c)}"${i.c === 'fas fa-folder' ? ' selected' : ''}>${esc(i.label)}</option>`).join('');
    const row = document.createElement('div');
    row.className = 'ncm-cfg-folder-row';
    row.setAttribute('data-folder-row', '');
    row.dataset.folderKind = 'custom';
    row.dataset.folderId = `f_${foundry.utils.randomID(8)}`;
    row.innerHTML = `<select class="ncm-cfg-select ncm-cfg-folder-icon" data-f-icon>${opts}</select>`
      + '<input type="text" class="ncm-cfg-input ncm-cfg-flex" data-f-name value="" placeholder="Folder name">'
      + '<button type="button" class="ncm-cfg-btn-icon" data-action="folderRemove" data-tooltip="Remove folder (its mail returns to the Inbox)"><i class="fas fa-xmark"></i></button>';
    rows.appendChild(row);
    row.querySelector('[data-f-name]')?.focus();
  }

  static _onFolderRemove(event, target) {
    target.closest('[data-folder-row]')?.remove();
  }

  // ═══════════════════════════════════════════════════════════
  //  Theme tab (ThemeCustomizer pattern: draft + live preview)
  // ═══════════════════════════════════════════════════════════

  /** Lazy-init the working theme copy from the saved config. @private */
  _ensureThemeDraft() {
    if (!this._themeDraft) {
      const cfg = this.terminalService?.getConfig(this.item);
      this._themeDraft = foundry.utils.deepClone(cfg?.theme || { preset: 'classic' });
    }
    return this._themeDraft;
  }

  /**
   * Apply the draft (or saved) theme live: to the sheet's own preview blocks
   * (.ncm-ttc-live) and to any open viewer of this terminal. Saved-state
   * revert is just a viewer re-render (its _onRender reapplies cfg.theme).
   * @private
   */
  _applyThemeLive() {
    if (!this.themeService) return;
    const cfg = this.terminalService?.getConfig(this.item) || {};
    const t = this._themeDraft ?? cfg.theme ?? {};
    const prefs = buildTerminalThemePrefs(t, t.preset || 'classic');
    for (const el of this.element?.querySelectorAll('.ncm-ttc-live') || []) {
      this.themeService.applyTheme(prefs, el);
    }

    // Open viewers of this terminal preview the FULL staged state, not just
    // the palette: the config-preview overlay carries the draft theme plus
    // the staged kit's boot/loginStyle/login/screensaver/folderNames, and the
    // viewer renders it as if saved (setConfigPreview). Re-render only on kit
    // transitions — palette-only updates go through cheap inline vars below,
    // so color/slider drags never trigger render storms.
    const kit = this._presetKit ? TERMINAL_PRESETS[this._presetKit] : null;
    const overlay = (this._themeDraft || kit || this._stagedMailboxStyle) ? {
      ...(this._themeDraft ? { theme: foundry.utils.deepClone(this._themeDraft) } : {}),
      mailboxStyle: this._currentMailboxStyle(),
      ...(kit ? foundry.utils.deepClone({
        boot: { ...(cfg.boot || {}), ...(kit.boot || {}) },
        loginStyle: kit.loginStyle || cfg.loginStyle || 'cards',
        login: { ...(cfg.login || {}), ...(kit.login || {}) },
        screensaver: { ...(cfg.screensaver || {}), ...(kit.screensaver || {}) },
        folderNames: { ...(cfg.folderNames || {}), ...(kit.folderNames || {}) },
        soundSet: kit.soundSet || cfg.soundSet || 'default',
      }) : {}),
    } : null;
    const kitSig = `${this._presetKit || ''}|${this._currentMailboxStyle()}`;
    const kitChanged = kitSig !== (this._lastKitPushed ?? null);

    for (const app of foundry.applications?.instances?.values?.() ?? []) {
      if (app === this || !app.rendered) continue;
      if (app.item?.id !== this.item?.id || typeof app._applyCustomTheme !== 'function') continue;
      app.setConfigPreview?.(overlay, { rerender: kitChanged });
      const viewerEl = app.element?.querySelector('.ncm-terminal-viewer');
      if (!viewerEl) continue;
      viewerEl.setAttribute('data-terminal-preset', t.preset || 'classic');
      this.themeService.applyTheme(prefs, viewerEl);
      // The window header (title/controls) lives outside the viewer element —
      // theme the app frame root too so the chrome previews along.
      if (app.element && app.element !== viewerEl) this.themeService.applyTheme(prefs, app.element);
      // Per-terminal effects preview on the real viewer; the CRT film also
      // previews on the strip (it is just attributes on a host).
      app.refreshCrt?.();   // the viewer re-reads its (overlaid) theme.crt and paints its window root
      viewerEl.setAttribute('data-term-flicker', String(t.flicker === true));
    }
    const stripCrt = resolveCrt(t, TERMINAL_PRESETS[t.preset]?.theme?.crt || null);
    this.element?.querySelectorAll('.ncm-tc__preview.ncm-ttc-live').forEach(el => applyCrt(el, stripCrt));
    this._lastKitPushed = kitSig;
  }

  /**
   * The mailbox layout as currently staged: a manual pick / an applied saved
   * theme (`_stagedMailboxStyle`) → the staged preset kit's → the saved config.
   * ONE reader so the Boot & Login card, the live preview and the saved-theme
   * writer can never disagree.
   */
  _currentMailboxStyle() {
    const kit = this._presetKit ? TERMINAL_PRESETS[this._presetKit] : null;
    const cfg = this.terminalService?.getConfig(this.item) || {};
    const v = this._stagedMailboxStyle || kit?.mailboxStyle || cfg.mailboxStyle || 'classic';
    return TERMINAL_MAILBOX_STYLES.some(s => s.key === v) ? v : 'classic';
  }

  /** Clear the preview overlay on open viewers (re-renders the saved state). @private */
  _revertThemePreview() {
    for (const app of foundry.applications?.instances?.values?.() ?? []) {
      if (app !== this && app.rendered && app.item?.id === this.item?.id &&
          typeof app._applyCustomTheme === 'function') {
        app.setConfigPreview?.(null, { rerender: true });
      }
    }
    this._lastKitPushed = null;
  }

  /** @override — closing with unsaved staging reverts previewed viewers. */
  async close(options = {}) {
    if (this._themeDraft || this._presetKit || this._stagedMailboxStyle) {
      this._revertThemePreview();
      this._themeDraft = null;
      this._presetKit = null;
      this._stagedMailboxStyle = null;
    }
    return super.close(options);
  }

  /**
   * Manual listeners for the Theme tab (colors / fonts / sliders — the
   * ThemeCustomizer wiring: mutate the draft, live-apply, never re-render).
   * @private
   */
  _wireThemeTab(el) {
    const panel = el.querySelector('[data-panel="theme"]');
    if (!panel) return;

    panel.querySelectorAll('.ncm-tc__color-entry input[type="color"]').forEach(input => {
      input.addEventListener('input', (e) => {
        const key = e.target.closest('[data-color-key]')?.dataset.colorKey;
        if (!key) return;
        this._ensureThemeDraft()[key] = e.target.value;
        const entry = e.target.closest('.ncm-tc__color-entry');
        const hex = entry?.querySelector('.ncm-tc__color-hex');
        if (hex) hex.textContent = e.target.value;
        this._applyThemeLive();
      });
    });

    panel.querySelectorAll('select[data-font-slot]').forEach(sel => {
      sel.addEventListener('change', (e) => {
        const key = { display: 'fontDisplay', mono: 'fontMono', title: 'fontTitle' }[e.target.dataset.fontSlot];
        if (!key) return;
        this._ensureThemeDraft()[key] = e.target.value;
        this._applyThemeLive();
      });
    });

    const wireSlider = (name, key, valClass, fallback = 100) => {
      panel.querySelector(`input[name="${name}"]`)?.addEventListener('input', (e) => {
        this._ensureThemeDraft()[key] = parseInt(e.target.value, 10) || fallback;
        const label = panel.querySelector(`.${valClass}`);
        if (label) label.textContent = `${e.target.value}%`;
        this._applyThemeLive();
      });
    };
    wireSlider('ttcTextScale', 'textScale', 'ncm-ttc-scale-val');
    wireSlider('ttcContrast', 'contrast', 'ncm-ttc-contrast-val');
    wireSlider('ttcGlitch', 'glitch', 'ncm-ttc-glitch-val', 0);
    wireSlider('ttcWallStrength', 'wallpaperStrength', 'ncm-ttc-wall-val', 25);

    // Wallpaper path (typed or via the browseWallpaper FilePicker action).
    panel.querySelector('[data-ttc-wallpaper]')?.addEventListener('input', (e) => {
      this._ensureThemeDraft().wallpaper = e.target.value.trim();
      this._applyThemeLive();
    });

    // Effect switches (flicker) — tc-style knobs, draft-backed.
    panel.querySelectorAll('[data-ttc-toggle]').forEach(sw => {
      sw.addEventListener('click', () => {
        const key = sw.dataset.ttcToggle;
        const draft = this._ensureThemeDraft();
        draft[key] = !(draft[key] === true);
        sw.classList.toggle('ncm-tc__switch--on', draft[key]);
        this._applyThemeLive();
      });
    });
    // The ONE CRT film: style chips · intensity · vignette · rolling band, all
    // on draft.crt (DOM-only, no re-render — the Theme tab contract).
    const crtDraft = () => {
      const d = this._ensureThemeDraft();
      if (!d.crt || typeof d.crt !== 'object') d.crt = resolveCrt(d, TERMINAL_PRESETS[d.preset]?.theme?.crt || null);
      delete d.scanlines; // the legacy boolean is superseded the moment crt exists
      return d.crt;
    };
    // The shared CRT panel (templates/partials/crt-panel.hbs): crt.js wires it to this terminal's draft.
    wireCrtPanel(panel.querySelector('[data-crt-panel]'), { draft: crtDraft, onChange: () => this._applyThemeLive() });
  }

  /**
   * Preset card click — stage the FULL preset: palette+fonts into the theme
   * draft (live-previewed), boot + login style as the staged KIT (overlays
   * the Boot & Login tab; Save commits everything; accounts seed at save
   * when the terminal has none). Prior color/font overrides are dropped
   * first (a preset pick is a clean starting point); 'classic' has no
   * TERMINAL_PRESETS entry, so it stages pure fallthrough + no kit.
   */
  static _onSelectTermPreset(event, target) {
    const key = target.dataset.preset;
    const draft = { ...this._ensureThemeDraft() };
    for (const k of [...Object.keys(COLOR_VAR_MAP), 'fontDisplay', 'fontMono', 'fontTitle']) delete draft[k];
    this._themeDraft = { ...draft, ...foundry.utils.deepClone(TERMINAL_PRESETS[key]?.theme || {}), preset: key };
    this._presetKit = TERMINAL_PRESETS[key] ? key : null;
    this._stagedMailboxStyle = null;   // the preset's own layout rides the kit
    this._applyThemeLive();
    this.render(false);
  }

  /** Drop the per-key color overrides — back to the preset palette. */
  static _onResetTermColors() {
    const draft = this._ensureThemeDraft();
    for (const key of Object.keys(COLOR_VAR_MAP)) delete draft[key];
    this._applyThemeLive();
    this.render(false);
    ui.notifications.info('Colors reset to preset defaults.');
  }

  // ─── Saved terminal themes (world setting, shared across terminals) ───

  _getTermThemes() {
    try { return game.settings.get(MODULE_ID, 'terminalThemePresets') ?? []; } catch { return []; }
  }

  async _setTermThemes(themes) {
    await game.settings.set(MODULE_ID, 'terminalThemePresets', themes);
  }

  static async _onSaveTermTheme() {
    const name = await new Promise(resolve => {
      adminDialog({
        title: 'Save Terminal Theme',
        content: '<div style="padding:8px 0;"><label style="font-family:\'Share Tech Mono\',monospace;font-size:10px;color:#8888a0;text-transform:uppercase;">Theme Name</label><input type="text" id="ncm-tterm-name" value="My Terminal Theme" style="width:100%;margin-top:4px;padding:6px 8px;background:#0a0a0f;border:1px solid #2a2a45;color:#e0e0e8;font-family:\'Rajdhani\',sans-serif;font-size:13px;border-radius:2px;" /></div>',
        buttons: {
          save: { icon: '<i class="fas fa-save"></i>', label: 'Save', callback: (html) => resolve(html.find('#ncm-tterm-name').val()?.trim()) },
          cancel: { label: 'Cancel', callback: () => resolve(null) },
        },
        default: 'save',
      }, { classes: ['ncm-pick-dialog'], width: 340 }).render(true);
    });
    if (!name) return;
    const cfg = this.terminalService.getConfig(this.item);
    const themes = this._getTermThemes();
    themes.push({ name, theme: foundry.utils.deepClone(this._themeDraft ?? cfg.theme ?? { preset: 'classic' }), mailboxStyle: this._currentMailboxStyle() });
    await this._setTermThemes(themes);
    this.render(false);
    ui.notifications.info(`Saved terminal theme: ${name}`);
  }

  static _onApplyTermTheme(event, target) {
    const index = parseInt(target.closest('[data-theme-index]')?.dataset.themeIndex, 10);
    const entry = this._getTermThemes()[index];
    if (!entry) return;
    this._themeDraft = foundry.utils.deepClone(entry.theme || {});
    // A theme saved since 2026-10-25 carries its mailbox layout; an older one leaves the layout alone.
    if (TERMINAL_MAILBOX_STYLES.some(s => s.key === entry.mailboxStyle)) this._stagedMailboxStyle = entry.mailboxStyle;
    this._applyThemeLive();
    this.render(false);
  }

  static async _onOverwriteTermTheme(event, target) {
    const index = parseInt(target.closest('[data-theme-index]')?.dataset.themeIndex, 10);
    const themes = this._getTermThemes();
    if (!themes[index]) return;
    const cfg = this.terminalService.getConfig(this.item);
    themes[index] = { name: themes[index].name, theme: foundry.utils.deepClone(this._themeDraft ?? cfg.theme ?? { preset: 'classic' }), mailboxStyle: this._currentMailboxStyle() };
    await this._setTermThemes(themes);
    this.render(false);
    ui.notifications.info(`Overwrote theme: ${themes[index].name}`);
  }

  static async _onDeleteTermTheme(event, target) {
    const index = parseInt(target.closest('[data-theme-index]')?.dataset.themeIndex, 10);
    const themes = this._getTermThemes();
    if (!themes[index]) return;
    const name = themes[index].name;
    const confirmed = await adminConfirm({ title: 'Delete Theme', content: `<p>Delete saved terminal theme "${name}"?</p>` });
    if (!confirmed) return;
    themes.splice(index, 1);
    await this._setTermThemes(themes);
    this.render(false);
    ui.notifications.info(`Deleted theme: ${name}`);
  }

  static _onExportTermTheme() {
    const cfg = this.terminalService.getConfig(this.item);
    const theme = this._themeDraft ?? cfg.theme ?? { preset: 'classic' };
    const data = JSON.stringify({ ncmTerminalTheme: 1, theme, mailboxStyle: this._currentMailboxStyle() }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ncm-terminal-theme-${(theme.preset || 'custom').replace(/\s+/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    ui.notifications.info('Terminal theme exported.');
  }

  static _onImportTermTheme() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        // Accept the export envelope or a bare theme object.
        const theme = parsed.ncmTerminalTheme ? parsed.theme : parsed;
        const known = ['preset', 'fontDisplay', 'fontMono', 'fontTitle', 'textScale', 'contrast', ...Object.keys(COLOR_VAR_MAP)];
        if (!theme || typeof theme !== 'object' || !known.some(k => k in theme)) {
          return ui.notifications.warn('Not a terminal theme file.');
        }
        this._themeDraft = { preset: 'classic', ...foundry.utils.deepClone(theme) };
        if (TERMINAL_MAILBOX_STYLES.some(s => s.key === parsed.mailboxStyle)) this._stagedMailboxStyle = parsed.mailboxStyle;
        this._applyThemeLive();
        this.render(false);
        ui.notifications.info('Terminal theme imported — Save to keep it.');
      } catch (err) {
        log.error(`Terminal theme import failed: ${err.message}`);
        ui.notifications.error('Failed to import theme file.');
      }
    });
    input.click();
  }

  static _onAcctPage(event, target) {
    const dir = parseInt(target?.dataset?.dir, 10) || 0;
    this._acctPage = Math.max(1, this._acctPage + dir);
    this.render(false);
  }

  /**
   * CONTENT blocks (2026-10-25) — the three selects (who-can-open, its
   * clearance level, Move-to…) and the "new folder" input need manual
   * listeners (selects don't fire via data-action). Every write goes through
   * TerminalService (saveFileFolder / moveFile / …) and re-renders.
   * @private
   */
  _wireContentTab(el) {
    const panel = el.querySelector('[data-panel="accounts"]');
    if (!panel) return;
    const svc = this.terminalService;
    const item = this.item;

    // "New folder in /x" — type a name, press Enter.
    panel.querySelectorAll('[data-ct-newdir]').forEach(inp => {
      inp.addEventListener('keydown', async (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const name = normalizeFolderPath(inp.value);
        if (!name) return;
        const res = await svc.saveFileFolder(item, { scope: inp.dataset.scope, path: name });
        if (!res.success) { ui.notifications.warn(res.error || 'Could not add the folder.'); return; }
        this._ctFocusNewdir = inp.dataset.scope;
        this.render(false);
      });
      // Enter inside the row must not bubble into the account row's editAccount.
      inp.addEventListener('click', (e) => e.stopPropagation());
    });
    if (this._ctFocusNewdir) {
      const inp = panel.querySelector(`[data-ct-newdir][data-scope="${this._ctFocusNewdir}"]`);
      this._ctFocusNewdir = null;
      inp?.focus();
    }

    // Who can open — the gate mode. Picking "chosen accounts" opens the picker.
    panel.querySelectorAll('[data-ct-gate]').forEach(sel => {
      sel.addEventListener('click', (e) => e.stopPropagation());
      sel.addEventListener('change', async () => {
        const { scope, path } = sel.dataset;
        const mode = sel.value;
        if (mode === 'accounts') { await this._pickGateAccounts(scope, path); return; }
        const cur = svc.getFileFolders(item).find(f => f.scope === scope && f.path === path);
        const res = await svc.saveFileFolder(item, { ...(cur || {}), scope, path, gate: { mode, min: cur?.gate?.min ?? 1, accountIds: cur?.gate?.accountIds || [] } });
        if (!res.success) ui.notifications.warn(res.error || 'Could not save the folder.');
        this.render(false);
      });
    });
    panel.querySelectorAll('[data-ct-gatemin]').forEach(inp => {
      inp.addEventListener('click', (e) => e.stopPropagation());
      inp.addEventListener('change', async () => {
        const { scope, path } = inp.dataset;
        const cur = svc.getFileFolders(item).find(f => f.scope === scope && f.path === path);
        const min = Math.max(0, parseInt(inp.value, 10) || 0);
        await svc.saveFileFolder(item, { ...(cur || {}), scope, path, gate: { ...(cur?.gate || { mode: 'clearance', accountIds: [] }), mode: 'clearance', min } });
        this.render(false);
      });
    });

    // Move to… (any volume / folder, or a new folder on the same volume).
    panel.querySelectorAll('[data-ct-move]').forEach(sel => {
      sel.addEventListener('click', (e) => e.stopPropagation());
      sel.addEventListener('change', async () => {
        const id = sel.dataset.messageId;
        let [scope, path] = sel.value === '__new__' ? [null, null] : sel.value.split('|');
        if (sel.value === '__new__') {
          const entry = svc.getAllMessages(item).find(m => m.messageId === id);
          scope = entry?.accountId || SHARED_SCOPE;
          const name = await this._askText({ title: 'New folder', label: 'Folder name', value: '' });
          if (!name) { this.render(false); return; }
          path = normalizeFolderPath(name);
          await svc.saveFileFolder(item, { scope, path });
        }
        const res = await svc.moveFile(item, id, { scope, path: path || '' });
        if (!res.success) ui.notifications.warn(res.error || 'Could not move the entry.');
        this.render(false);
      });
    });
  }

  /** A one-line text prompt in the admin preset. Resolves the trimmed text or null. */
  _askText({ title, label, value = '' }) {
    const esc = (s) => Handlebars.escapeExpression(s ?? '');
    return new Promise(resolve => {
      let out = null;
      adminDialog({
        title,
        content: `<div class="ncm-cfg-prompt"><label style="display:flex;flex-direction:column;gap:6px;text-transform:none">${esc(label)}<input type="text" name="ncmText" value="${esc(value)}" autofocus autocomplete="off"></label></div>`,
        buttons: {
          ok: { icon: '<i class="fas fa-check"></i>', label: 'OK', callback: (html) => { out = (html.find?.('[name="ncmText"]').val() ?? html[0]?.querySelector('[name="ncmText"]')?.value ?? '').trim() || null; } },
          cancel: { icon: '<i class="fas fa-times"></i>', label: 'Cancel' },
        },
        default: 'ok',
        close: () => resolve(out),
      }, { classes: ['ncm-pick-dialog'], width: 340 }).render(true);
    });
  }

  /** Multi-pick the accounts that may open a folder, then save the gate. */
  async _pickGateAccounts(scope, path) {
    const svc = this.terminalService;
    const cur = svc.getFileFolders(this.item).find(f => f.scope === scope && f.path === path);
    const accounts = this.terminalService.getConfig(this.item).accounts || [];
    const picks = await showNamePicker({
      title: `Who can open /${path}`,
      hint: 'Admin accounts always can. Pick the others.',
      multi: true, chips: false,
      entries: accounts.map(a => ({ id: a.id, name: a.displayName || a.username, sub: a.username, img: a.portrait || '' })),
      selected: cur?.gate?.accountIds || [],
      emptyText: 'no accounts on this terminal yet',
      placeholder: 'search accounts…',
    });
    if (!Array.isArray(picks)) { this.render(false); return; }
    const accountIds = picks.map(p => p.id).filter(Boolean);
    await svc.saveFileFolder(this.item, { ...(cur || {}), scope, path, gate: { mode: accountIds.length ? 'accounts' : 'everyone', min: cur?.gate?.min ?? 0, accountIds } });
    this.render(false);
  }

  /**
   * Accounts list toolbar — live search (debounced re-render with refocus)
   * and sort select (manual change listener per the selects gotcha).
   * @private
   */
  _wireAccountsTab(el) {
    const panel = el.querySelector('[data-panel="accounts"]');
    if (!panel) return;
    const search = panel.querySelector('input[name="acctSearch"]');
    search?.addEventListener('input', (e) => {
      this._acctSearch = e.target.value;
      this._acctPage = 1;
      this._acctSearchRefocus = true;
      clearTimeout(this._acctSearchTimer);
      this._acctSearchTimer = setTimeout(() => this.render(false), 250);
    });
    if (this._acctSearchRefocus && search) {
      this._acctSearchRefocus = false;
      search.focus();
      search.setSelectionRange(search.value.length, search.value.length);
    }
    panel.querySelector('select[name="acctSort"]')?.addEventListener('change', (e) => {
      this._acctSort = e.target.value;
      this._acctPage = 1;
      this.render(false);
    });
  }

  static _onAddAccount() { this._editingAccountId = 'new'; this._editorLink = null; this._activeTab = 'accounts'; this._scrollReset = true; this.render(false); }
  static _onEditAccount(event, target) { this._editingAccountId = target.dataset.accountId; this._editorLink = null; this._activeTab = 'accounts'; this._scrollReset = true; this.render(false); }
  static _onCancelAccount() { this._editingAccountId = null; this._editorLink = null; this.render(false); }

  /** Clear the identity link (pending + stored on next save). DOM-only. */
  static _onUnlinkIdentity() {
    this._editorLink = { masterContactId: '', actorId: '' };
    this.element?.querySelector('.ncm-acct-idcard')?.classList.add('ncm-acct-idcard--none');
    this._markEditorDirty?.();
  }

  /** Roll a themed passphrase into the password field. */
  static _onGeneratePassword() {
    const input = this.element?.querySelector('[name="secPassword"]');
    if (!input) return;
    const w = () => PASS_WORDS[Math.floor(Math.random() * PASS_WORDS.length)];
    const a = w(); let b = w();
    while (b === a) b = w();
    input.value = `${a[0].toUpperCase()}${a.slice(1)}-${b}-${Math.floor(Math.random() * 90) + 10}`;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /** Key item for the account — the shared world picker (folder chips; matched by name). */
  static async _onPickKeyItem() {
    const input = this.element?.querySelector('[name="secKeyItemName"]');
    const pick = await showNamePicker({
      title: 'Key Item',
      hint: 'Pick the item a character must carry to open this account (matched by name).',
      entries: documentEntries((game.items?.contents || []).filter(isCarrier), { note: (i) => i.type }),
      emptyText: 'no world items — type the name manually',
      placeholder: 'search items or folders…',
    });
    if (!pick || !input) return;
    input.value = pick.name;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  static async _onSaveAccount() {
    const el = this.element;
    const v = (n) => el.querySelector(`[name="${n}"]`);
    const val = (n, d = '') => v(n)?.value ?? d;
    const chk = (n) => !!v(n)?.checked;
    const data = {
      displayName: val('acctDisplayName'),
      username: val('acctUsername'),
      email: val('acctEmail'),
      isAdmin: chk('acctIsAdmin'),
      hidden: chk('acctHidden'),
      role: val('acctRole'),
      clearance: val('acctClearance'),
      idNumber: val('acctIdNumber'),
      classification: val('acctClassification'),
      location: val('acctLocation'),
      lastLogin: val('acctLastLogin'),
      portrait: val('acctPortrait').trim(),
      security: {
        requiresAuth: chk('secRequiresAuth'),
        allowPassword: chk('secAllowPassword'),
        password: val('secPassword'),
        allowSkillCheck: chk('secAllowSkill'),
        bypassSkills: [val('secSkill', 'Interface')],
        bypassDC: parseInt(val('secDV', '15'), 10) || 15,
        allowKeyItem: chk('secAllowKeyItem'),
        keyItemName: val('secKeyItemName'),
        authLogic: val('secAuthLogic', 'any'),
        failureMode: val('secFailureMode', 'lockout'),
        maxAttempts: parseInt(val('secMaxAttempts', '3'), 10) || 3,
        lockoutDuration: (parseInt(val('secLockoutMin', '60'), 10) || 60) * 60000,
      },
      // Account network gating vs the machine's uplink — gated accounts VANISH
      // from the login list until the terminal connects to a matching network.
      network: {
        restricted: chk('acctNetRestricted'),
        allowedNetworks: [...el.querySelectorAll('[name="acctNetAllowed"]:checked')].map(i => i.value),
        allowedTypes: [],
      },
    };
    const id = this._editingAccountId;

    // ── Master-contact link-or-create (the email field's promise) ──
    // Precedence: an explicit picker choice/unlink this session (_editorLink)
    // → the stored link. Then a non-empty email resolves against the GM master
    // directory: link the matching contact, else create one — so the account
    // is a real, portrait-bearing directory identity.
    const mcs = game.nightcity?.masterContactService;
    const cfg = this.terminalService.getConfig(this.item);
    const existing = id === 'new' ? null : (cfg.accounts || []).find(x => x.id === id);
    const link = this._editorLink ?? { masterContactId: existing?.masterContactId || '', actorId: existing?.actorId || '' };
    data.masterContactId = link.masterContactId || '';
    data.actorId = link.actorId || '';
    const email = (data.email || '').trim();
    if (email && mcs) {
      const current = data.masterContactId ? mcs.getContact(data.masterContactId) : null;
      const sameEmail = current && (current.email || '').toLowerCase().trim() === email.toLowerCase();
      if (!sameEmail) {
        const found = mcs.getByEmail(email);
        if (found) {
          data.masterContactId = found.id;
          ui.notifications.info(`Linked to master contact "${found.name}".`);
        } else {
          const created = await mcs.addContact({
            name: data.displayName || data.username || email.split('@')[0],
            email,
            portrait: data.portrait || null,
            role: data.role || '',
            organization: cfg.metadata?.org || '',
            location: data.location || cfg.metadata?.location || '',
            // A terminal-account address is a machine login, not a person's
            // agent — send-only by default (players can't message/reply/add).
            // Untick "Send-only" in the Master List to open it up.
            sendOnly: true,
            notes: `Terminal account on "${this.item?.name || 'terminal'}".`,
          });
          if (created?.success) {
            data.masterContactId = created.contact.id;
            ui.notifications.info(`Created master contact "${created.contact.name}".`);
          }
        }
      }
      // Pull the linked contact's portrait when the account has none.
      if (!data.portrait) {
        const linked = mcs.getContact(data.masterContactId);
        if (linked?.portrait) data.portrait = linked.portrait;
      }
    }

    let res;
    if (id === 'new') res = await this.terminalService.addAccount(this.item, data);
    else res = await this.terminalService.updateAccount(this.item, id, data);
    if (res?.success) { this._editingAccountId = null; this._editorLink = null; ui.notifications.info('Account saved.'); }
    else ui.notifications.error(res?.error || 'Account save failed.');
    this.render(false);
  }

  static async _onRemoveAccount(event, target) {
    const id = target.dataset.accountId;
    const ok = await adminConfirm({ title: 'Remove Account', content: '<p>Remove this account? Its messages are left orphaned in the journal.</p>' });
    if (!ok) return;
    await this.terminalService.removeAccount(this.item, id);
    if (this._editingAccountId === id) this._editingAccountId = null;
    this.render(false);
  }

  // ── CONTENT blocks (the file repository, 2026-10-25) ──
  static async _onCtToggle(event, target) {
    const s = target.dataset.scope;
    const sel = `[data-action="ctToggle"][data-scope="${CSS.escape(s)}"]`;
    if (this._ctOpen.has(s)) { await this._foldClose(target); this._ctOpen.delete(s); }
    else { this._ctOpen.add(s); this._foldEnter = sel; }
    this.render(false);
  }

  /**
   * Accordion motion (2026-10-25, dev: "make the opening of the accordion animate open smoothly").
   * The sheet re-renders on every click and a fold's body only exists while open, so a CSS
   * transition has nothing to animate from (the standing AppV2 rule). Opening: the toggle stores
   * a selector for its trigger, and _onRender grows the freshly rendered body from 0. Closing:
   * the LIVE body shrinks to 0 first, then the state changes and the sheet re-renders.
   * The body is the element right after the toggle's row (an account's content block, a
   * folder's scroll list). Reduced motion skips both.
   */
  _foldBody(trigger) {
    const row = trigger?.closest?.('.ncm-acctl-row, .ncm-acctl-dir');
    const next = row?.nextElementSibling;
    return next?.matches?.('.ncm-acctl-ent, .ncm-acctl-scroll') ? next : null;
  }
  _foldMotionOk() {
    try { if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false; } catch { /* ignore */ }
    const lvl = this.element?.dataset?.ncmAnimationLevel;
    return lvl !== 'off' && lvl !== 'reduced';
  }
  async _foldClose(trigger) {
    const body = this._foldBody(trigger);
    if (!body || !this._foldMotionOk() || typeof body.animate !== 'function') return;
    const h = body.getBoundingClientRect().height;
    body.style.overflow = 'hidden';
    try {
      await body.animate([{ height: `${h}px`, opacity: 1 }, { height: '0px', opacity: 0 }],
        { duration: 200, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' }).finished;
    } catch { /* interrupted — the render replaces it anyway */ }
  }
  _foldOpenAfterRender() {
    const sel = this._foldEnter; this._foldEnter = null;
    if (!sel || !this._foldMotionOk()) return;
    const body = this._foldBody(this.element?.querySelector(sel));
    if (!body || typeof body.animate !== 'function') return;
    const h = body.getBoundingClientRect().height;
    if (!h) return;
    body.style.overflow = 'hidden';
    const anim = body.animate([{ height: '0px', opacity: 0 }, { height: `${h}px`, opacity: 1 }],
      { duration: 280, easing: 'cubic-bezier(.22,1,.36,1)' });
    anim.finished.then(() => { body.style.overflow = ''; }).catch(() => {});
  }
  static _onCtTab(event, target) {
    this._ctTab.set(target.dataset.scope, target.dataset.tab === 'files' ? 'files' : 'mail');
    this.render(false);
  }
  static async _onCtDirToggle(event, target) {
    const k = `${target.dataset.scope}:${target.dataset.path}`;
    if (this._ctDirClosed.has(k)) {
      this._ctDirClosed.delete(k);
      this._foldEnter = `.ncm-acctl-dir-cv[data-action="ctDirToggle"][data-scope="${CSS.escape(target.dataset.scope)}"][data-path="${CSS.escape(target.dataset.path)}"]`;
    } else { await this._foldClose(target); this._ctDirClosed.add(k); }
    this.render(false);
  }
  static async _onCtMailToggle(event, target) {
    const k = `${target.dataset.account}:${target.dataset.folder}`;
    if (this._ctMailOpen.has(k)) { await this._foldClose(target); this._ctMailOpen.delete(k); }
    else {
      this._ctMailOpen.add(k);
      this._foldEnter = `.ncm-acctl-dir-cv[data-action="ctMailToggle"][data-account="${CSS.escape(target.dataset.account)}"][data-folder="${CSS.escape(target.dataset.folder)}"]`;
    }
    this.render(false);
  }
  static _onCtFolderFocus(event, target) {
    this.element?.querySelector(`[data-ct-newdir][data-scope="${target.dataset.scope}"]`)?.focus();
  }
  static async _onCtFolderAddSub(event, target) {
    const { scope, path } = target.dataset;
    const name = await this._askText({ title: 'New sub-folder', label: `Inside /${path}` });
    if (!name) return;
    const res = await this.terminalService.saveFileFolder(this.item, { scope, path: `${path}/${normalizeFolderPath(name)}` });
    if (!res.success) ui.notifications.warn(res.error || 'Could not add the folder.');
    this._ctDirClosed.delete(`${scope}:${path}`);
    this.render(false);
  }
  static async _onCtFolderRename(event, target) {
    const { scope, path } = target.dataset;
    const cur = folderName(path);
    const name = await this._askText({ title: 'Rename folder', label: 'New name', value: cur });
    if (!name || normalizeFolderPath(name) === cur) return;
    const parent = parentPath(path);
    const res = await this.terminalService.renameFileFolder(this.item, scope, path, parent ? `${parent}/${normalizeFolderPath(name)}` : normalizeFolderPath(name));
    if (!res.success) ui.notifications.warn(res.error || 'Could not rename the folder.');
    else if (res.moved) ui.notifications.info(`Folder renamed — ${res.moved} file${res.moved === 1 ? '' : 's'} re-filed.`);
    this.render(false);
  }
  static async _onCtFolderRemove(event, target) {
    const { scope, path } = target.dataset;
    const ok = await adminConfirm({ title: 'Delete Folder', content: `<p>Delete <strong>/${Handlebars.escapeExpression(path)}</strong>? Its files and sub-folders move up one level — nothing is deleted from the machine.</p>` });
    if (!ok) return;
    const res = await this.terminalService.removeFileFolder(this.item, scope, path);
    if (!res.success) ui.notifications.warn(res.error || 'Could not delete the folder.');
    this.render(false);
  }
  static async _onCtGateAccounts(event, target) {
    await this._pickGateAccounts(target.dataset.scope, target.dataset.path);
  }
  /** + Message / + File — the SAME composer the mailbox button opens, pre-filed. */
  static async _onCtAdd(event, target) {
    const { scope, env, path, folder } = target.dataset;
    const { DataShardComposer } = await import('../ItemInbox/DataShardComposer.js');
    const editData = env === 'file'
      ? { envelope: 'file', file: { path: path || '' } }
      : (folder ? { envelope: 'mail', folder: (folder === 'inbox' || folder === 'saved' || folder === 'trash') ? '' : folder, status: { saved: folder === 'saved', deleted: folder === 'trash' } } : undefined);
    new DataShardComposer({
      target: { kind: 'terminal', item: this.item, accountId: scope, homeAccountId: scope === SHARED_SCOPE ? null : scope, folderPath: path || '' },
      editData,
      onSave: () => this.render(false),
    }).render(true);
  }
  static async _onCtEntryEdit(event, target) {
    const id = target.dataset.messageId;
    const raw = this.terminalService.getAllMessages(this.item).find(m => m.messageId === id);
    if (!raw) return;
    const { DataShardComposer } = await import('../ItemInbox/DataShardComposer.js');
    new DataShardComposer({
      target: { kind: 'terminal', item: this.item, accountId: raw.accountId, homeAccountId: raw.shared ? null : raw.accountId, folderPath: raw.file?.path || '' },
      editData: {
        entryId: id, contentType: raw.contentType || 'message',
        from: raw.from || '', subject: raw.subject || '', body: raw.body || '',
        timestamp: raw.timestamp || '', contentData: raw.contentData ?? {},
        envelope: raw.envelope || 'mail', file: raw.file || null, exfil: raw.exfil || null,
        folder: raw.folder || '', status: raw.status || {},
      },
      onSave: () => this.render(false),
    }).render(true);
  }
  static async _onCtEntryDelete(event, target) {
    const id = target.dataset.messageId;
    const ok = await adminConfirm({ title: 'Delete Entry', content: '<p>Permanently delete this entry from the terminal?</p>' });
    if (!ok) return;
    const res = await this.terminalService.removeAccountMessage(this.item, id);
    if (!res.success) ui.notifications.warn(res.error || 'Could not delete the entry.');
    this.render(false);
  }
  static _onCtOpenTerminal() { game.nightcity?.openTerminal?.(this.item); }

  static _onAddBootLogLine() {
    const list = this.element.querySelector('.ncm-cfg-boot-log-list');
    if (!list) return;
    const row = document.createElement('div');
    row.className = 'ncm-cfg-boot-log-entry';
    row.innerHTML = `<input type="text" name="bootLogLine" class="ncm-cfg-input" value=""><button type="button" class="ncm-cfg-btn-icon ncm-cfg-btn-icon--danger" data-action="removeBootLogLine"><i class="fas fa-times"></i></button>`;
    list.appendChild(row);
  }
  static _onRemoveBootLogLine(event, target) { target.closest('.ncm-cfg-boot-log-entry')?.remove(); }

  static async _onForceUnlock() { await this.terminalService.forceUnlock(this.item); ui.notifications.info('Terminal force-unlocked (GM bypass).'); this.render(false); }
  static async _onRelock() {
    const ok = await adminConfirm({ title: 'Relock Terminal', content: '<p>Wipe all sessions and reset lockouts?</p>' });
    if (!ok) return;
    await this.terminalService.relock(this.item);
    ui.notifications.info('Terminal relocked.');
    this.render(false);
  }

  static _onExportConfig() {
    const cfg = this.terminalService.getConfig(this.item);
    const blob = new Blob([JSON.stringify({ ncmTerminalConfig: 1, exportedAt: new Date().toISOString(), config: cfg }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ncm-terminal-${(this.item?.name || 'terminal').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  static _onImportConfig() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'application/json';
    input.onchange = async () => {
      try {
        const text = await input.files[0].text();
        const parsed = JSON.parse(text);
        const cfg = parsed.config || parsed;
        if (!cfg || typeof cfg !== 'object') throw new Error('Invalid file');
        // Fresh ids for imported accounts so they don't collide.
        if (Array.isArray(cfg.accounts)) cfg.accounts = cfg.accounts.map(a => ({ ...a, id: `acct_${generateId()}` }));
        await this.terminalService.updateConfig(this.item, cfg);
        ui.notifications.info('Terminal configuration imported.');
        this.render(false);
      } catch (err) {
        log.error(`Terminal import failed: ${err.message}`);
        ui.notifications.error('Import failed — invalid file.');
      }
    };
    input.click();
  }
}
