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
import { MODULE_ID, TERMINAL_PRESETS, FONT_OPTIONS, DEFAULTS, SKILL_MAP } from '../../utils/constants.js';
import { log, isGM, generateId, formatCyberDate } from '../../utils/helpers.js';

/** Clearance presets offered as one-click chips; anything else is "custom". */
const CLEARANCE_PRESETS = ['STANDARD', 'ADMIN', 'GUEST', 'SYSOP'];
/** Word pool for the password generator (⚄). */
const PASS_WORDS = ['chrome', 'samurai', 'arasaka', 'daemon', 'netwatch', 'flatline', 'preem', 'kiroshi', 'militech', 'nomad', 'glitch', 'neon', 'zeroday', 'blackwall', 'edge', 'static'];

export class TerminalConfigApp extends BaseApplication {

  item = null;
  _activeTab = 'identity';
  _editingAccountId = null;   // account id | 'new' | null
  _editorLink = null;         // pending identity pick: { masterContactId, actorId } | null (= use stored)

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
      browseAcctPortrait: TerminalConfigApp._onBrowseAcctPortrait,
      unlinkIdentity: TerminalConfigApp._onUnlinkIdentity,
      generatePassword: TerminalConfigApp._onGeneratePassword,
      pickKeyItem: TerminalConfigApp._onPickKeyItem,
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

      // Machine uplink (Layer 1) — the terminal's OWN connection.
      uplinkInterfaces: (this.networkService?.getAllNetworks?.() || []).map(n => {
        const iface = (cfg.connection?.interfaces || []).find(i => i.networkId === n.id);
        return { id: n.id, name: n.name, checked: !!iface, preAuthorized: !!iface?.preAuthorized };
      }),
      uplinkDefaults: [{ value: '', label: 'Local only (offline)', selected: !cfg.connection?.defaultNetworkId }]
        .concat((this.networkService?.getAllNetworks?.() || []).map(n => ({
          value: n.id, label: n.name, selected: n.id === cfg.connection?.defaultNetworkId,
        }))),
      uplinkAllowSwitch: cfg.connection?.allowPlayerSwitching !== false,
      uplinkSyncHint: cfg.connection?.showSyncHint !== false,

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

    this._wireAccountEditor(el);
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
      connection: {
        interfaces: [...el.querySelectorAll('[name="uplinkIface"]:checked')].map(i => ({
          networkId: i.value,
          preAuthorized: !!el.querySelector(`[name="uplinkPre"][value="${i.value}"]`)?.checked,
        })),
        defaultNetworkId: val('uplinkDefault') || null,
        allowPlayerSwitching: chk('uplinkAllowSwitch'),
        showSyncHint: chk('uplinkSyncHint'),
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

  static _onAddAccount() { this._editingAccountId = 'new'; this._editorLink = null; this._activeTab = 'accounts'; this.render(false); }
  static _onEditAccount(event, target) { this._editingAccountId = target.dataset.accountId; this._editorLink = null; this._activeTab = 'accounts'; this.render(false); }
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

  /** Searchable world-item picker for the key item (burn-picker pattern —
   *  reuses the .ncm-burn-* dialog styling; sheet-abstraction types filtered). */
  static _onPickKeyItem() {
    const esc = Handlebars.escapeExpression;
    const NON_CARRIER = ['skill', 'role', 'criticalInjury', 'netarch'];
    const items = (game.items?.contents || [])
      .filter(i => !NON_CARRIER.includes(i.type))
      .sort((x, y) => x.name.localeCompare(y.name));
    const rows = items.map(i => `
      <div class="ncm-burn-row" data-name="${esc(i.name)}">
        <img src="${esc(i.img)}" alt="">
        <span class="ncm-burn-name">${esc(i.name)}</span>
        <span class="ncm-burn-type">${esc(i.type)}</span>
      </div>`).join('');
    const dlg = new Dialog({
      title: 'Key Item',
      content: `
        <div class="ncm-burn-hint">Pick the item a character must carry to open this account (matched by name).</div>
        <input type="text" class="ncm-burn-search" placeholder="search items…">
        <div class="ncm-burn-list">${rows || '<div class="ncm-burn-hint" style="padding:8px">no world items — type the name manually</div>'}</div>`,
      buttons: { cancel: { label: 'Cancel' } },
      render: (html) => {
        const root = html[0] ?? html;
        const list = root.querySelector('.ncm-burn-list');
        root.querySelector('.ncm-burn-search')?.addEventListener('input', (ev) => {
          const q = ev.target.value.trim().toLowerCase();
          list?.querySelectorAll('.ncm-burn-row').forEach(r => {
            r.style.display = r.dataset.name.toLowerCase().includes(q) ? '' : 'none';
          });
        });
        list?.addEventListener('click', (ev) => {
          const row = ev.target.closest('.ncm-burn-row');
          if (!row) return;
          const input = this.element?.querySelector('[name="secKeyItemName"]');
          if (input) { input.value = row.dataset.name; input.dispatchEvent(new Event('input', { bubbles: true })); }
          dlg.close();
        });
      },
    }, { classes: ['ncm-burn-dialog'] });
    dlg.render(true);
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
