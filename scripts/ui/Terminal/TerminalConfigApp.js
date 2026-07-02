/**
 * TerminalConfigApp
 * @file scripts/ui/Terminal/TerminalConfigApp.js
 * @module cyberpunkred-messenger
 * @description GM authoring sheet for a Terminal (parallel to ItemInboxConfig).
 *   Tabs: Identity · Accounts · Theme · Boot · Network · Exfil. Reuses the
 *   shard config's `ncm-cfg-*` styling for a consistent GM-facing look. All
 *   writes go through TerminalService (updateConfig / addAccount / updateAccount
 *   / removeAccount / forceUnlock / relock); import/export round-trips the whole
 *   terminalConfig as a JSON blob (the spam/theme pattern).
 */

import { BaseApplication } from '../BaseApplication.js';
import { MODULE_ID, TERMINAL_PRESETS, FONT_OPTIONS, DEFAULTS } from '../../utils/constants.js';
import { log, isGM, generateId } from '../../utils/helpers.js';

export class TerminalConfigApp extends BaseApplication {

  item = null;
  _activeTab = 'identity';
  _editingAccountId = null;   // account id | 'new' | null

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
      applyPreset: TerminalConfigApp._onApplyPreset,
      addAccount: TerminalConfigApp._onAddAccount,
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
    const presetKey = cfg.theme?.preset || 'arasaka-workstation';

    const presets = Object.entries(TERMINAL_PRESETS).map(([key, p]) => ({
      key, label: p.label, icon: p.icon, active: key === presetKey,
    }));

    const fontSel = (slot, cur) => FONT_OPTIONS.map(f => ({ key: f.key, label: f.label, selected: f.key === cur }));
    const theme = cfg.theme || {};

    const accounts = (cfg.accounts || []).map(a => ({
      id: a.id,
      displayName: a.displayName || a.username || 'Account',
      username: a.username || '',
      isAdmin: !!a.isAdmin,
      hidden: !!a.hidden,
      isDefault: a.id === cfg.defaultAccountId,
      linkedContact: a.masterContactId ? (game.nightcity?.masterContactService?.getContact(a.masterContactId)?.name || '') : '',
      methods: this._accountMethodSummary(a.security || {}),
    }));

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
      accountCount: accounts.length,

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

      // Theme
      presets, presetKey,
      colPrimary: theme.primary || '#ff0033',
      colSecondary: theme.secondary || '#19f3f7',
      colAccent: theme.accent || '#f7c948',
      colBg: theme.bgDeep || '#0a0006',
      fontDisplay: fontSel('display', theme.fontDisplay || 'rajdhani'),
      fontMono: fontSel('mono', theme.fontMono || 'sharetechmono'),
      fontTitle: fontSel('title', theme.fontTitle || 'orbitron'),
      textScale: theme.textScale || 100,
      contrast: theme.contrast || 100,

      // Boot
      bootEnabled: cfg.boot?.enabled !== false,
      bootTitle: cfg.boot?.title || '',
      bootSubtitle: cfg.boot?.subtitle || '',
      bootBanner: cfg.boot?.banner || '',
      bootFaIcon: cfg.boot?.faIcon || '',
      bootImageUrl: cfg.boot?.imageUrl || '',
      bootIconModes: ['preset', 'fa', 'image'].map(v => ({
        value: v,
        label: { preset: 'Theme preset icon', fa: 'Font Awesome icon', image: 'Custom image / logo' }[v],
        selected: v === (cfg.boot?.iconMode || (cfg.boot?.faIcon ? 'fa' : 'preset')),
      })),
      bootIconMode: cfg.boot?.iconMode || (cfg.boot?.faIcon ? 'fa' : 'preset'),
      bootIcon: TERMINAL_PRESETS[presetKey]?.icon || 'fas fa-server',
      bootAnimation: cfg.boot?.animationStyle || 'standard-fade',
      bootSpeed: cfg.boot?.speed || 'normal',
      bootLogLines: cfg.boot?.logLines || [],
      animationOptions: ['standard-fade', 'holographic-snap', 'scan-sweep', 'warm-dissolve', 'glitch-stutter', 'instant-dump']
        .map(v => ({ value: v, selected: v === (cfg.boot?.animationStyle || 'standard-fade') })),
      speedOptions: ['fast', 'normal', 'dramatic'].map(v => ({ value: v, selected: v === (cfg.boot?.speed || 'normal') })),

      // Network
      networkRequired: !!cfg.network?.required,
      accessMode: cfg.network?.accessMode || 'any',
      accessModes: ['any', 'whitelist', 'type'].map(v => ({ value: v, selected: v === (cfg.network?.accessMode || 'any') })),
      allNetworks,
      signalThreshold: cfg.network?.signalThreshold ?? 40,

      // Exfil
      allowExfil: cfg.allowExfil !== false,
    };
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
    const CLS = ['', 'RESTRICTED', 'CONFIDENTIAL', 'SECRET', 'TOP SECRET'];
    return {
      isNew, id: a.id,
      displayName: a.displayName || '', username: a.username || '', email: a.email || '',
      isAdmin: !!a.isAdmin, hidden: !!a.hidden,
      // Credential / badge fields
      role: a.role || '', clearance: a.clearance || '', idNumber: a.idNumber || '',
      location: a.location || '', lastLogin: a.lastLogin || '',
      classificationOpts: CLS.map(v => ({
        value: v, label: v || '— inherit terminal —', selected: v === (a.classification || ''),
      })),
      requiresAuth: !!s.requiresAuth,
      allowPassword: !!(s.allowPassword ?? s.password),
      password: s.password || '',
      allowSkillCheck: !!s.allowSkillCheck,
      skill: (s.bypassSkills || [])[0] || 'Interface',
      bypassDC: s.bypassDC ?? 15,
      allowKeyItem: !!s.allowKeyItem,
      keyItemName: s.keyItemName || '',
      authLogic: s.authLogic || 'any',
      failureMode: s.failureMode || 'lockout',
      failureModes: ['nothing', 'lockout', 'permanent', 'damage'].map(v => ({ value: v, selected: v === (s.failureMode || 'lockout') })),
      maxAttempts: s.maxAttempts ?? 3,
      lockoutMin: Math.round((s.lockoutDuration ?? 3600000) / 60000),
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  Render — restore tab + manual change listeners
  // ═══════════════════════════════════════════════════════════

  _onRender(context, options) {
    super._onRender?.(context, options);
    const el = this.element;
    if (!el) return;
    el.querySelectorAll('.ncm-cfg-tab').forEach(t => t.classList.toggle('ncm-cfg-tab--active', t.dataset.tab === this._activeTab));
    el.querySelectorAll('.ncm-cfg-panel').forEach(p => p.classList.toggle('ncm-cfg-panel--active', p.dataset.panel === this._activeTab));

    // ─── Boot icon: live preview + only show the field for the chosen source.
    //     Manual listeners — selects don't fire reliably via data-action. ───
    const syncBootIcon = () => {
      const mode = el.querySelector('[name="bootIconMode"]')?.value || 'preset';
      el.querySelector('[data-boot-icon-row="fa"]')?.classList.toggle('ncm-cfg-row--hidden', mode !== 'fa');
      el.querySelector('[data-boot-icon-row="image"]')?.classList.toggle('ncm-cfg-row--hidden', mode !== 'image');
      const preview = el.querySelector('.ncm-cfg-icon-preview');
      if (!preview) return;
      const fa = el.querySelector('[name="bootFaIcon"]')?.value?.trim();
      const img = el.querySelector('[name="bootImageUrl"]')?.value?.trim();
      const presetIcon = context.bootIcon || 'fas fa-server';
      if (mode === 'image' && img) preview.innerHTML = `<img src="${Handlebars.escapeExpression(img)}" alt="">`;
      else preview.innerHTML = `<i class="${Handlebars.escapeExpression((mode === 'fa' && fa) ? fa : presetIcon)}"></i>`;
    };
    el.querySelector('[name="bootIconMode"]')?.addEventListener('change', syncBootIcon);
    el.querySelector('[name="bootFaIcon"]')?.addEventListener('input', syncBootIcon);
    el.querySelector('[name="bootImageUrl"]')?.addEventListener('input', syncBootIcon);
    syncBootIcon();
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
      theme: {
        preset: val('themePreset'),
        primary: val('colPrimary'), secondary: val('colSecondary'), accent: val('colAccent'), bgDeep: val('colBg'),
        fontDisplay: val('fontDisplay'), fontMono: val('fontMono'), fontTitle: val('fontTitle'),
        textScale: parseInt(val('textScale', '100'), 10) || 100,
        contrast: parseInt(val('contrast', '100'), 10) || 100,
      },
      boot: {
        enabled: chk('bootEnabled'),
        title: val('bootTitle'), subtitle: val('bootSubtitle'), banner: val('bootBanner'),
        iconMode: val('bootIconMode', 'preset'), faIcon: val('bootFaIcon'), imageUrl: val('bootImageUrl'),
        animationStyle: val('bootAnimation'), speed: val('bootSpeed'), logLines,
      },
      network: {
        required: chk('networkRequired'),
        accessMode: val('accessMode'),
        allowedNetworks: [...el.querySelectorAll('[name="netAllowed"]:checked')].map(i => i.value),
        signalThreshold: parseInt(val('signalThreshold', '40'), 10) || 40,
      },
      allowExfil: chk('allowExfil'),
    };
    const res = await this.terminalService.updateConfig(this.item, updates);
    if (res?.success) ui.notifications.info('Terminal configuration saved.');
    else ui.notifications.error(res?.error || 'Save failed.');
    this.render(false);
  }

  static async _onApplyPreset(event, target) {
    const key = target.dataset.preset || this.element.querySelector('[name="themePreset"]')?.value;
    const preset = TERMINAL_PRESETS[key];
    if (!preset) return;
    const cfg = this.terminalService.getConfig(this.item);
    const updates = {
      theme: { ...(cfg.theme || {}), ...(preset.theme || {}), preset: key },
      boot: { ...(cfg.boot || {}), ...(preset.boot || {}) },
    };
    // Seed accounts only when none exist yet.
    await this.terminalService.updateConfig(this.item, updates);
    if (!(cfg.accounts || []).length && Array.isArray(preset.accounts)) {
      for (const seed of preset.accounts) {
        await this.terminalService.addAccount(this.item, foundry.utils.mergeObject(
          { security: { ...(preset.security || {}) } }, seed, { inplace: false }));
      }
    }
    ui.notifications.info(`Applied preset: ${preset.label}`);
    this.render(false);
  }

  static _onAddAccount() { this._editingAccountId = 'new'; this._activeTab = 'accounts'; this.render(false); }
  static _onEditAccount(event, target) { this._editingAccountId = target.dataset.accountId; this._activeTab = 'accounts'; this.render(false); }
  static _onCancelAccount() { this._editingAccountId = null; this.render(false); }

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
    };
    const id = this._editingAccountId;
    let res;
    if (id === 'new') res = await this.terminalService.addAccount(this.item, data);
    else res = await this.terminalService.updateAccount(this.item, id, data);
    if (res?.success) { this._editingAccountId = null; ui.notifications.info('Account saved.'); }
    else ui.notifications.error(res?.error || 'Account save failed.');
    this.render(false);
  }

  static async _onRemoveAccount(event, target) {
    const id = target.dataset.accountId;
    const ok = await Dialog.confirm({ title: 'Remove Account', content: '<p>Remove this account? Its messages are left orphaned in the journal.</p>' });
    if (!ok) return;
    await this.terminalService.removeAccount(this.item, id);
    if (this._editingAccountId === id) this._editingAccountId = null;
    this.render(false);
  }

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
    const ok = await Dialog.confirm({ title: 'Relock Terminal', content: '<p>Wipe all sessions and reset lockouts?</p>' });
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
