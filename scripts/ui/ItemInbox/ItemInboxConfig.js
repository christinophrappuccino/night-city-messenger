/**
 * ItemInboxConfig — GM Shard Configuration (Sprint 4.6 Tabbed Redesign)
 * @file scripts/ui/ItemInbox/ItemInboxConfig.js
 * @module night-city-messenger
 * @description GM-only tabbed configuration for data shard settings.
 *   5 tabs: Identity, Security, Network, Systems, Boot.
 */

import { resolveIntegrity, garbleString, garbleRate } from '../content/IntegrityModel.js';
import { MODULE_ID, DEFAULTS, SKILL_MAP, SHARD_PRESETS, NETWORK_ACCESS_MODES, NETWORK_TYPES, CONNECTION_MODES, FAILURE_MODES, ENCRYPTION_TYPES, COLOR_VAR_MAP, FONT_OPTIONS } from '../../utils/constants.js';
import { log, isGM, formatCyberDate, applyContrastToElement, buildShardThemePrefs } from '../../utils/helpers.js';
import { BaseApplication } from '../BaseApplication.js';
import { CyberTimePicker } from '../components/CyberTimePicker.js';
import { adminDialog, adminConfirm } from '../../utils/adminTheme.js';

const BOOT_ICON_OPTIONS = [
  { value: 'fas fa-shield-halved', label: 'Shield' },
  { value: 'fas fa-star', label: 'Star' },
  { value: 'fas fa-skull', label: 'Skull' },
  { value: 'fas fa-skull-crossbones', label: 'Skull & Bones' },
  { value: 'fas fa-mask', label: 'Mask' },
  { value: 'fas fa-heart', label: 'Heart' },
  { value: 'fas fa-eye', label: 'Eye' },
  { value: 'fas fa-microchip', label: 'Microchip' },
  { value: 'fas fa-tower-broadcast', label: 'Broadcast' },
  { value: 'fas fa-hard-drive', label: 'Hard Drive' },
  { value: 'fas fa-sd-card', label: 'SD Card' },
  { value: 'fas fa-brain', label: 'Brain' },
  { value: 'fas fa-bolt', label: 'Bolt' },
  { value: 'fas fa-building', label: 'Building' },
  { value: 'fas fa-crosshairs', label: 'Crosshairs' },
  { value: 'fas fa-handshake-angle', label: 'Handshake' },
  { value: 'fas fa-ghost', label: 'Ghost' },
  { value: 'fas fa-dna', label: 'DNA' },
  { value: 'fas fa-virus', label: 'Virus' },
  { value: 'fas fa-key', label: 'Key' },
];

const KEY_ITEM_ICON_OPTIONS = [
  { value: 'fas fa-id-card', label: 'ID Card' },
  { value: 'fas fa-key', label: 'Key' },
  { value: 'fas fa-fingerprint', label: 'Fingerprint' },
  { value: 'fas fa-credit-card', label: 'Credit Card' },
  { value: 'fas fa-lock', label: 'Lock' },
  { value: 'fas fa-microchip', label: 'Microchip' },
  { value: 'fas fa-shield-halved', label: 'Shield' },
  { value: 'fas fa-passport', label: 'Passport' },
  { value: 'fas fa-sim-card', label: 'SIM Card' },
  { value: 'fas fa-barcode', label: 'Barcode' },
  { value: 'fas fa-qrcode', label: 'QR Code' },
  { value: 'fas fa-file-signature', label: 'Signature' },
];

/**
 * What "the security block" means when a full shard preset opts into carrying one.
 * Kept as an explicit list rather than "everything that isn't look": a field added
 * to the config later should NOT silently start travelling inside a preset.
 */
const SHARD_SECURITY_KEYS = [
  'encrypted', 'encryptionType', 'encryptionDC', 'encryptionMode',
  'allowedSkills', 'skillDCs', 'failureMode', 'maxHackAttempts', 'lockoutDuration',
  'requiresLogin', 'loginUsername', 'loginPassword', 'loginDisplayName', 'maxLoginAttempts',
  'requiresKeyItem', 'keyItemName', 'keyItemId', 'keyItemImg', 'keyItemTag',
  'keyItemDisplayName', 'keyItemIcon', 'keyItemBypassLogin', 'keyItemBypassEncryption',
  'keyItemConsumeOnUse', 'maxKeyItemAttempts',
  'layerSecurity', 'ice',
];

/** Human labels for the themeable palette keys (COLOR_VAR_MAP order). */
const THEME_COLOR_LABELS = {
  primary: 'Primary', secondary: 'Accent (main)', accent: 'Accent (foil)',
  bgDeep: 'Background (deep)', bgBase: 'Background (base)', bgSurface: 'Surface',
  bgElevated: 'Elevated', textPrimary: 'Text (bright)', textSecondary: 'Text (body)',
  textMuted: 'Text (muted)', border: 'Border',
};

/** What a swatch shows when neither an override nor a preset supplies the key. */
const THEME_COLOR_FALLBACK = {
  primary: '#F65261', secondary: '#19f3f7', accent: '#f7c948',
  bgDeep: '#0a0a0f', bgBase: '#12121a', bgSurface: '#1a1a2e', bgElevated: '#252540',
  textPrimary: '#e0e0e8', textSecondary: '#8888a0', textMuted: '#555570', border: '#2a2a45',
};

const LAYER_FAILURE_MODES = [
  { value: 'nothing', label: 'No consequence' },
  { value: 'lockout', label: 'Timed lockout' },
  { value: 'permanent', label: 'Permanent lockout' },
  { value: 'damage', label: 'BLACK ICE damage' },
  { value: 'destroy', label: 'Destroy shard' },
];

export class ItemInboxConfig extends BaseApplication {

  /** GM tool — follows the Admin Panel theme + text size (utils/adminTheme.js). */
  static ADMIN_THEMED = true;

  item = null;
  _activeTab = 'identity';

  get dataShardService() { return game.nightcity?.dataShardService; }
  get networkService() { return game.nightcity?.networkService; }

  static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
    id: 'ncm-item-inbox-config',
    classes: ['ncm-app', 'ncm-item-inbox-config'],
    window: { title: 'NCM.DataShard.Config', icon: 'fas fa-cog', resizable: true, minimizable: false },
    position: { width: 680, height: 720 },
    actions: {
      saveConfig: ItemInboxConfig._onSaveConfig,
      applyPreset: ItemInboxConfig._onApplyPreset,
      addSkill: ItemInboxConfig._onAddSkill,
      removeSkill: ItemInboxConfig._onRemoveSkill,
      addBootLogLine: ItemInboxConfig._onAddBootLogLine,
      removeBootLogLine: ItemInboxConfig._onRemoveBootLogLine,
      resetDefaults: ItemInboxConfig._onResetDefaults,
      selectIcon: ItemInboxConfig._onSelectIcon,
      browseImage: ItemInboxConfig._onBrowseImage,
      changeIconMode: ItemInboxConfig._onChangeIconMode,
      selectIconColor: ItemInboxConfig._onSelectIconColor,
      relockShard: ItemInboxConfig._onRelockShard,
      switchTab: ItemInboxConfig._onSwitchTab,
      selectAccessMode: ItemInboxConfig._onSelectAccessMode,
      selectConnMode: ItemInboxConfig._onSelectConnMode,
      toggleNetwork: ItemInboxConfig._onToggleNetwork,
      selectIceMode: ItemInboxConfig._onSelectIceMode,
      selectIceActor: ItemInboxConfig._onSelectIceActor,
      searchKeyItem: ItemInboxConfig._onSearchKeyItem,
      clearKeyItem: ItemInboxConfig._onClearKeyItem,
      previewBoot: ItemInboxConfig._onPreviewBoot,
      toggleNetworkType: ItemInboxConfig._onToggleNetworkType,
      openTimePicker: ItemInboxConfig._onOpenTimePicker,
    },
  }, { inplace: false });

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/item-inbox/item-inbox-config.hbs` },
  };

  constructor(options = {}) {
    super(options);
    if (options.item) this.item = options.item;
  }

  get title() { return `Configure Shard: ${this.item?.name ?? 'Unknown'}`; }

  // ═══════════════════════════════════════════════════════════
  //  LIFECYCLE — Wire change listeners for reactive UI
  // ═══════════════════════════════════════════════════════════

  _onRender(context, options) {
    super._onRender?.(context, options);
    const el = this.element;
    if (!el) return;

    // ─── Restore active tab ───
    if (this._activeTab && this._activeTab !== 'identity') {
      el.querySelectorAll('.ncm-cfg-tab').forEach(t => t.classList.toggle('ncm-cfg-tab--active', t.dataset.tab === this._activeTab));
      el.querySelectorAll('.ncm-cfg-panel').forEach(p => p.classList.toggle('ncm-cfg-panel--active', p.dataset.panel === this._activeTab));
    }

    // ─── Pipeline auto-update on checkbox change ───
    const layerCheckboxes = el.querySelectorAll('[name="networkRequired"], [name="requiresKeyItem"], [name="requiresLogin"], [name="encrypted"]');
    layerCheckboxes.forEach(cb => {
      cb.addEventListener('change', () => this._updatePipeline());
    });

    // ─── ICE type dropdown → show/hide ICE source section ───
    const iceTypeSel = el.querySelector('[name="encryptionType"]');
    if (iceTypeSel) {
      iceTypeSel.addEventListener('change', () => this._updateIceVisibility());
      this._updateIceVisibility(); // Initial state
    }

    // ─── Network access mode → show/hide conditional sections ───
    this._updateNetworkConditionals();

    // ─── Integrity: card pickers, per-mode rows, legibility sample ───
    this._wireIntegrity();

    // ─── Text size / contrast sliders: readout + live preview on any open viewer ───
    const wireDisplaySlider = (name, valClass, clamp, preview) => {
      el.querySelector(`[name="${name}"]`)?.addEventListener('input', (e) => {
        const pct = clamp(e.target.value);
        const label = el.querySelector(`.${valClass}`);
        if (label) label.textContent = `${pct}%`;
        this._displayPreviewed = true;
        this._displaySaved = false;
        preview(pct);
      });
    };
    wireDisplaySlider('textScale', 'ncm-cfg-scale-val', ItemInboxConfig._clampTextScale, (p) => this._previewShardTextScale(p));
    wireDisplaySlider('contrast', 'ncm-cfg-contrast-val', ItemInboxConfig._clampContrast, (p) => this._previewShardContrast(p));

    this._wireThemeTab();

    // ─── Icon mode instant switching ───
    const iconModeSel = el.querySelector('[name="bootIconMode"]');
    if (iconModeSel) {
      iconModeSel.addEventListener('change', () => {
        const mode = iconModeSel.value;
        el.querySelectorAll('.ncm-cfg-icon-mode-section').forEach(s => {
          s.style.display = s.dataset.iconMode === mode ? '' : 'none';
        });
      });
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  THEME — the draft contract
  // ═══════════════════════════════════════════════════════════
  //
  //  Theme controls are UNNAMED and data-keyed (`data-stc`), so they never reach
  //  the form reader. They mutate `this._themeDraft` through manual listeners with
  //  NO re-render, which is what lets an edit survive a tab switch — the bug that
  //  made the terminal's theme tab discard work before it was rebuilt this way.
  //  `_onSaveConfig` persists the draft; `close()` reverts any preview it pushed.
  //
  //  A cleared override is stored as '' rather than deleted: `updateConfig` merges
  //  through `mergeObject`, which would keep a removed key's old value, and an
  //  empty string is falsy so `buildShardThemePrefs` falls through to the preset
  //  exactly as an absent key would.

  /** `config.theme` → the theme object, tolerating both legacy shapes. */
  static _readTheme(config) {
    const t = config?.theme;
    if (!t || typeof t !== 'object') return { colors: {}, fonts: {} };   // the legacy preset-key string
    return { colors: {}, fonts: {}, ...foundry.utils.deepClone(t) };
  }

  /** The working copy, created on first edit. */
  _draft() {
    if (!this._themeDraft) {
      const config = this.dataShardService?.getConfig(this.item) ?? {};
      this._themeDraft = ItemInboxConfig._readTheme(config);
      this._themeDraft.colors ??= {};
      this._themeDraft.fonts ??= {};
    }
    return this._themeDraft;
  }

  /** Saved shard themes (world setting) — always an array. */
  static _savedThemes() {
    try {
      const v = game.settings.get(MODULE_ID, 'shardThemePresets');
      return Array.isArray(v) ? v : [];
    } catch { return []; }
  }

  /**
   * Wire the Theme tab. Every listener is manual and mutates the draft without a
   * render (see `_repaintThemeTab` for why a render is not an option here).
   */
  _wireThemeTab() {
    const el = this.element;
    if (!el) return;
    const panel = el.querySelector('[data-panel="theme"]');
    if (!panel || panel.dataset.wired) return;
    panel.dataset.wired = '1';

    const touch = () => { this._displayPreviewed = true; this._displaySaved = false; };

    // Colour pickers fire `input` continuously while dragging — preview live,
    // which is the whole point of a colour picker.
    panel.addEventListener('input', (ev) => {
      const t = ev.target.closest('[data-stc]');
      if (!t) return;
      const kind = t.dataset.stc;
      const d = this._draft();
      if (kind === 'color') { d.colors[t.dataset.key] = t.value; t.closest('[data-stc-row]')?.classList.add('is-override'); }
      else if (kind === 'wallpaper') d.wallpaper = t.value.trim();
      else if (kind === 'wallpaperStrength') {
        d.wallpaperStrength = ItemInboxConfig._clampStrength(t.value);
        const lbl = panel.querySelector('.ncm-stc-wp-val');
        if (lbl) lbl.textContent = `${d.wallpaperStrength}%`;
      } else return;
      touch();
      this._previewTheme();
    });

    panel.addEventListener('change', (ev) => {
      const t = ev.target.closest('[data-stc]');
      if (!t || t.dataset.stc !== 'font') return;
      this._draft().fonts[t.dataset.slot] = t.value;
      touch();
      this._previewTheme();
    });

    panel.addEventListener('click', (ev) => {
      const t = ev.target.closest('[data-stc]');
      if (!t) return;
      const kind = t.dataset.stc;
      if (kind === 'color' || kind === 'wallpaper' || kind === 'wallpaperStrength' || kind === 'font') return;
      ev.preventDefault();
      this._onThemeAction(kind, t);
    });
  }

  /** Theme-tab buttons. Kept off the ApplicationV2 actions map because none of
   *  them may trigger a render (the unsaved-edits rule). */
  async _onThemeAction(kind, target) {
    const d = this._draft();
    const touch = () => { this._displayPreviewed = true; this._displaySaved = false; };

    switch (kind) {
      case 'preset': {
        // A preset card stages that preset's LOOK. Prior colour overrides are
        // cleared, or the card you just clicked would visibly do nothing.
        this._themePresetKey = target.dataset.key || 'blank';
        d.colors = {};
        touch(); this._repaintThemeTab(); this._previewTheme();
        return;
      }
      case 'colorReset': {
        const key = target.dataset.key;
        d.colors[key] = '';                 // '' not delete — see the draft contract
        touch(); this._repaintThemeTab(); this._previewTheme();
        return;
      }
      case 'colorResetAll': {
        d.colors = {};
        touch(); this._repaintThemeTab(); this._previewTheme();
        return;
      }
      case 'wallpaperBrowse': {
        const fp = new FilePicker({
          type: 'image',
          current: d.wallpaper || '',
          callback: (path) => {
            d.wallpaper = path;
            const input = this.element?.querySelector('[data-stc="wallpaper"]');
            if (input) input.value = path;
            touch(); this._previewTheme();
          },
        });
        fp.render(true);
        return;
      }
      case 'wallpaperClear': {
        d.wallpaper = '';
        const input = this.element?.querySelector('[data-stc="wallpaper"]');
        if (input) input.value = '';
        touch(); this._previewTheme();
        return;
      }
      default:
        return kind.startsWith('full')
          ? this._onFullPresetAction(kind, target)
          : this._onSavedThemeAction(kind, target);
    }
  }

  /**
   * The saved-theme library (world setting `shardThemePresets`).
   *
   * A saved theme is the LOOK only — palette, fonts, wallpaper. It deliberately
   * carries no security block: several shipped presets ship Black ICE at DV 20,
   * and a GM applying something labelled "a theme" must not silently arm a shard.
   * (Same reason the Encoder never hands `convertToDataShard` a preset KEY.)
   */
  async _onSavedThemeAction(kind, target) {
    if (!isGM()) return;
    const list = ItemInboxConfig._savedThemes();
    const i = Number(target?.dataset?.index);
    const write = async (next) => {
      await game.settings.set(MODULE_ID, 'shardThemePresets', next);
      this._rebuildSavedThemeList();
    };
    // What a save captures: the draft, plus the preset it was built on, so
    // applying it elsewhere reproduces what you were looking at.
    const snapshot = () => {
      const d = foundry.utils.deepClone(this._draft());
      d.basePreset = this._themePresetKey ?? this.dataShardService?.getConfig(this.item)?.preset ?? 'blank';
      return d;
    };

    switch (kind) {
      case 'themeSave': {
        const name = await ItemInboxConfig._promptName('Save this look', this.item?.name || 'Shard theme');
        if (!name) return;
        await write([...list, { name, theme: snapshot() }]);
        ui.notifications.info(`NCM | Saved the look as "${name}".`);
        return;
      }
      case 'themeApply': {
        const entry = list[i];
        if (!entry) return;
        const t = foundry.utils.deepClone(entry.theme || {});
        if (t.basePreset) { this._themePresetKey = t.basePreset; delete t.basePreset; }
        t.colors ??= {}; t.fonts ??= {};
        this._themeDraft = t;
        this._displayPreviewed = true; this._displaySaved = false;
        this._repaintThemeTab();
        this._syncThemeInputs();
        this._previewTheme();
        ui.notifications.info(`NCM | Applied "${entry.name}". Save the shard to keep it.`);
        return;
      }
      case 'themeOverwrite': {
        if (!list[i]) return;
        const ok = await adminConfirm({ title: 'Overwrite', content: `<p>Replace <b>${list[i].name}</b> with this shard's current look?</p>` });
        if (!ok) return;
        list[i] = { name: list[i].name, theme: snapshot() };
        await write(list);
        return;
      }
      case 'themeDelete': {
        if (!list[i]) return;
        const ok = await adminConfirm({ title: 'Delete', content: `<p>Delete the saved look <b>${list[i].name}</b>?</p>` });
        if (!ok) return;
        list.splice(i, 1);
        await write(list);
        return;
      }
      case 'themeExport': {
        const entry = list[i];
        if (!entry) return;
        ItemInboxConfig._download(`ncm-shard-theme-${entry.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.json`,
          JSON.stringify({ ncmShardTheme: 1, name: entry.name, theme: entry.theme }, null, 2));
        return;
      }
      case 'themeImport': {
        const picked = await ItemInboxConfig._readJsonFile();
        if (!picked) return;
        // Accept the envelope OR a bare theme object — the spam/terminal precedent.
        const entries = Array.isArray(picked) ? picked : [picked];
        const added = [];
        for (const raw of entries) {
          const theme = raw?.ncmShardTheme ? raw.theme : (raw?.theme || raw);
          if (!theme || typeof theme !== 'object') continue;
          added.push({ name: String(raw?.name || 'Imported look'), theme });
        }
        if (!added.length) return void ui.notifications.warn('NCM | That file had no shard theme in it.');
        await write([...list, ...added]);
        ui.notifications.info(`NCM | Imported ${added.length} look${added.length === 1 ? '' : 's'}.`);
        return;
      }
      default:
        log.debug(`ItemInboxConfig: unhandled theme action ${kind}`);
    }
  }

  /**
   * The FULL preset library (world setting `shardPresetLibrary`) — a whole shard
   * setup you can stamp out again, not just its colours.
   *
   * What it captures: look (theme + preset), startup (boot), and identity
   * (metadata, readability). **Security is opt-in per save**, unticked by default,
   * and an entry that carries one says so on its row and again when you apply it.
   * The reason is the standing rule about presets: several shipped ones ship Black
   * ICE at DV 20, and a GM reaching for "make another one like this" must never
   * arm a shard without being told.
   */
  async _onFullPresetAction(kind, target) {
    if (!isGM() || !this.item) return;
    const list = ItemInboxConfig._fullPresets();
    const i = Number(target?.dataset?.index);
    const write = async (next) => {
      await game.settings.set(MODULE_ID, 'shardPresetLibrary', next);
      this._rebuildFullPresetList();
    };

    switch (kind) {
      case 'fullSave': {
        const picked = await ItemInboxConfig._promptFullSave(this.item?.name || 'Shard setup');
        if (!picked?.name) return;
        await write([...list, { name: picked.name, config: this._snapshotShard(picked.withSecurity) }]);
        ui.notifications.info(`NCM | Saved "${picked.name}"${picked.withSecurity ? ' with its security' : ' (look and startup only)'}.`);
        return;
      }
      case 'fullApply': {
        const entry = list[i];
        if (!entry) return;
        const hasSec = !!entry.config?.security;
        const ok = await adminConfirm({
          title: 'Apply shard preset',
          content: `<p>Apply <b>${entry.name}</b> to this shard?</p>
            <p>It overwrites the look, startup and identity${hasSec
              ? ' <b>and its security block</b> — encryption, login and key item.'
              : '. Its security is untouched.'}</p>
            <p><b>This saves immediately</b>, and any unsaved edits on the other tabs are lost.</p>`,
        });
        if (!ok) return;
        const c = entry.config || {};
        const updates = {
          preset: c.preset || 'blank',
          theme: foundry.utils.deepClone(c.theme || {}),
          boot: foundry.utils.deepClone(c.boot || {}),
          metadata: foundry.utils.deepClone(c.metadata || {}),
          textScale: ItemInboxConfig._clampTextScale(c.textScale),
          contrast: ItemInboxConfig._clampContrast(c.contrast),
          ...(hasSec ? foundry.utils.deepClone(c.security) : {}),
        };
        const res = await this.dataShardService.updateConfig(this.item, updates);
        if (!res?.success) return void ui.notifications.error(`NCM | Failed: ${res?.error || 'unknown'}`);
        this._themeDraft = null;
        this._themePresetKey = null;
        this._displaySaved = true;
        ui.notifications.info(`NCM | Applied "${entry.name}".`);
        for (const { app } of this._openViewers()) app.render(false);
        this.render();
        return;
      }
      case 'fullOverwrite': {
        const entry = list[i];
        if (!entry) return;
        const ok = await adminConfirm({ title: 'Overwrite', content: `<p>Replace <b>${entry.name}</b> with this shard's current setup?</p>` });
        if (!ok) return;
        // Replace IN PLACE, keeping the name and whatever security choice it was
        // saved with — an overwrite should not quietly re-order the library or
        // change whether the entry is armed.
        list[i] = { name: entry.name, config: this._snapshotShard(!!entry.config?.security) };
        await write(list);
        ui.notifications.info(`NCM | Overwrote "${entry.name}".`);
        return;
      }
      case 'fullDelete': {
        if (!list[i]) return;
        const ok = await adminConfirm({ title: 'Delete', content: `<p>Delete the shard preset <b>${list[i].name}</b>?</p>` });
        if (!ok) return;
        list.splice(i, 1);
        await write(list);
        return;
      }
      case 'fullExport': {
        const entry = list[i];
        if (!entry) return;
        ItemInboxConfig._download(`ncm-shard-preset-${entry.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.json`,
          JSON.stringify({ ncmShardPreset: 1, name: entry.name, config: entry.config }, null, 2));
        return;
      }
      case 'fullImport': {
        const raw = await ItemInboxConfig._readJsonFile();
        if (!raw) return;
        const entries = (Array.isArray(raw) ? raw : [raw])
          .map((r) => ({ name: String(r?.name || 'Imported shard'), config: r?.ncmShardPreset ? r.config : (r?.config || r) }))
          .filter((e) => e.config && typeof e.config === 'object');
        if (!entries.length) return void ui.notifications.warn('NCM | That file had no shard preset in it.');
        // Import NEVER auto-applies — the terminal-library precedent.
        await write([...list, ...entries]);
        const armed = entries.filter((e) => e.config.security).length;
        ui.notifications.info(`NCM | Imported ${entries.length} preset${entries.length === 1 ? '' : 's'}`
          + (armed ? `, ${armed} carrying a security block.` : '.'));
        return;
      }
      default:
        log.debug(`ItemInboxConfig: unhandled full-preset action ${kind}`);
    }
  }

  /**
   * This shard's current setup, as a library entry's `config`. Reads the DRAFT for
   * the theme (so saving captures what you are looking at, not what is on disk)
   * and the stored config for everything else.
   * @param {boolean} withSecurity copy the security block too
   */
  _snapshotShard(withSecurity) {
    const cfg = this.dataShardService?.getConfig(this.item) ?? {};
    const snap = {
      preset: this._themePresetKey ?? cfg.preset ?? 'blank',
      theme: this._themeDraft ? foundry.utils.deepClone(this._themeDraft) : ItemInboxConfig._readTheme(cfg),
      boot: foundry.utils.deepClone(cfg.boot ?? {}),
      metadata: foundry.utils.deepClone(cfg.metadata ?? {}),
      textScale: ItemInboxConfig._clampTextScale(cfg.textScale),
      contrast: ItemInboxConfig._clampContrast(cfg.contrast),
    };
    if (withSecurity) {
      snap.security = {};
      for (const k of SHARD_SECURITY_KEYS) if (k in cfg) snap.security[k] = foundry.utils.deepClone(cfg[k]);
    }
    return snap;
  }

  /** The full-preset library — always an array. */
  static _fullPresets() {
    try {
      const v = game.settings.get(MODULE_ID, 'shardPresetLibrary');
      return Array.isArray(v) ? v : [];
    } catch { return []; }
  }

  /** Name + "include security" in one dialog, because they are one decision. */
  static _promptFullSave(placeholder = '') {
    return new Promise((resolve) => {
      let out = null;
      const dlg = adminDialog({
        title: 'Save this shard as a preset',
        content: `
          <p><input type="text" class="ncm-stc-nameinput" value="${String(placeholder).replace(/"/g, '&quot;')}" style="width:100%"></p>
          <p style="margin-top:8px"><label style="display:flex;align-items:center;gap:8px;text-transform:none;font-weight:400">
            <input type="checkbox" class="ncm-stc-withsec">
            <span>Include this shard's security (encryption, login, key item)</span></label></p>
          <p class="ncm-cfg-hint" style="margin:6px 0 0">Leave it unticked and the preset is look, startup and identity only — applying it can never arm a shard by surprise.</p>`,
        buttons: {
          ok: {
            label: 'Save',
            callback: (html) => {
              const r = html[0] ?? html;
              const name = r.querySelector('.ncm-stc-nameinput')?.value?.trim();
              if (name) out = { name, withSecurity: !!r.querySelector('.ncm-stc-withsec')?.checked };
            },
          },
          cancel: { label: 'Cancel' },
        },
        default: 'ok',
        render: (html) => setTimeout(() => (html[0] ?? html).querySelector('.ncm-stc-nameinput')?.select(), 30),
        close: () => resolve(out),
      });
      dlg.render(true);
    });
  }

  /** Repaint the full-preset rows in place (no render — the unsaved-edits rule). */
  _rebuildFullPresetList() {
    const host = this.element?.querySelector('[data-stc-full]');
    if (!host) return;
    const list = ItemInboxConfig._fullPresets();
    const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    host.innerHTML = list.length ? list.map((t, i) => `
      <div class="ncm-tc__citem">
        <i class="fas fa-microchip" style="color:var(--ncm-text-muted);font-size:10px"></i>
        <span class="ncm-tc__citem-name">${esc(t.name)}</span>
        ${t.config?.security ? '<span class="ncm-stc-secchip" data-tooltip="Applying this also overwrites security">SECURITY</span>' : ''}
        <div class="ncm-tc__citem-actions">
          <button type="button" data-stc="fullApply" data-index="${i}" data-tooltip="Apply to this shard"><i class="fas fa-check"></i></button>
          <button type="button" data-stc="fullOverwrite" data-index="${i}" data-name="${esc(t.name)}" data-tooltip="Overwrite with this shard"><i class="fas fa-save"></i></button>
          <button type="button" data-stc="fullExport" data-index="${i}" data-tooltip="Export JSON"><i class="fas fa-file-export"></i></button>
          <button type="button" class="ncm-tc__citem-del" data-stc="fullDelete" data-index="${i}" data-tooltip="Delete"><i class="fas fa-trash"></i></button>
        </div>
      </div>`).join('')
      : '<div class="ncm-tc__cempty">No shard presets yet — build one shard fully, then Save it here to stamp out more.</div>';
  }

  /** Repaint the saved-theme rows in place (no render — the unsaved-edits rule). */
  _rebuildSavedThemeList() {
    const host = this.element?.querySelector('[data-stc-saved]');
    if (!host) return;
    const list = ItemInboxConfig._savedThemes();
    const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    host.innerHTML = list.length ? list.map((t, i) => `
      <div class="ncm-tc__citem">
        <div class="ncm-tc__citem-swatch">
          <span style="background:${esc(t.theme?.colors?.secondary || '#19f3f7')}"></span>
          <span style="background:${esc(t.theme?.colors?.accent || '#f7c948')}"></span>
          <span style="background:${esc(t.theme?.colors?.bgSurface || '#1a1a2e')}"></span>
        </div>
        <span class="ncm-tc__citem-name">${esc(t.name)}</span>
        <div class="ncm-tc__citem-actions">
          <button type="button" data-stc="themeApply" data-index="${i}" data-tooltip="Apply to this shard"><i class="fas fa-check"></i></button>
          <button type="button" data-stc="themeOverwrite" data-index="${i}" data-tooltip="Overwrite with this shard's look"><i class="fas fa-save"></i></button>
          <button type="button" data-stc="themeExport" data-index="${i}" data-tooltip="Export JSON"><i class="fas fa-file-export"></i></button>
          <button type="button" class="ncm-tc__citem-del" data-stc="themeDelete" data-index="${i}" data-tooltip="Delete"><i class="fas fa-trash"></i></button>
        </div>
      </div>`).join('')
      : '<div class="ncm-tc__cempty">No saved looks yet — dress a shard, then Save this look to reuse it.</div>';
  }

  /** Push the draft back into the tab's inputs (after applying a saved look). */
  _syncThemeInputs() {
    const el = this.element;
    const d = this._draft();
    if (!el) return;
    for (const sel of el.querySelectorAll('[data-stc="font"]')) sel.value = d.fonts?.[sel.dataset.slot] || sel.value;
    const wp = el.querySelector('[data-stc="wallpaper"]');
    if (wp) wp.value = d.wallpaper || '';
    const st = el.querySelector('[data-stc="wallpaperStrength"]');
    if (st) {
      st.value = ItemInboxConfig._clampStrength(d.wallpaperStrength);
      const lbl = el.querySelector('.ncm-stc-wp-val');
      if (lbl) lbl.textContent = `${st.value}%`;
    }
  }

  /** A one-field name prompt, in the admin palette. */
  static _promptName(title, placeholder = '') {
    return new Promise((resolve) => {
      let out = null;
      const dlg = adminDialog({
        title,
        content: `<p><input type="text" class="ncm-stc-nameinput" value="${String(placeholder).replace(/"/g, '&quot;')}" style="width:100%"></p>`,
        buttons: {
          ok: { label: 'Save', callback: (html) => { out = (html[0] ?? html).querySelector('.ncm-stc-nameinput')?.value?.trim() || null; } },
          cancel: { label: 'Cancel' },
        },
        default: 'ok',
        render: (html) => setTimeout(() => (html[0] ?? html).querySelector('.ncm-stc-nameinput')?.select(), 30),
        close: () => resolve(out),
      });
      dlg.render(true);
    });
  }

  /** Blob download (the ContactsTab / spam-template pattern). */
  static _download(filename, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  /** Hidden file input → parsed JSON, or null. */
  static _readJsonFile() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json,.json';
      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        if (!file) return resolve(null);
        try { resolve(JSON.parse(await file.text())); }
        catch (err) { ui.notifications.error(`NCM | Could not read that file: ${err.message}`); resolve(null); }
      });
      input.click();
    });
  }

  /** Clamp the wallpaper strength slider (5–100, blank → 25). */
  static _clampStrength(v) {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) return 25;
    return Math.min(100, Math.max(5, n));
  }

  /** Clamp a per-shard text size to the slider's 80–150% range (NaN/blank → 100). */
  static _clampTextScale(v) {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) return 100;
    return Math.min(150, Math.max(80, n));
  }

  /** Clamp a per-shard contrast to the slider's 70–140% range (NaN/blank → 100). */
  static _clampContrast(v) {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) return 100;
    return Math.min(140, Math.max(70, n));
  }

  /**
   * Every open viewer of THIS shard — the live-preview targets.
   * Returns BOTH elements because they carry different things: the palette is
   * written to the app root (so the window frame follows too) while the contrast
   * tone-map and the text scale live on the inner `.ncm-item-inbox`, exactly as
   * `ItemInboxApp._applyShardTheme` arranges them.
   * @returns {Array<{app: object, appRoot: HTMLElement, inbox: HTMLElement}>}
   */
  _openViewers() {
    const out = [];
    for (const app of foundry.applications.instances.values()) {
      if (app === this || app.item?.id !== this.item?.id) continue;
      const appRoot = app.element;
      const inbox = appRoot?.querySelector?.('.ncm-item-inbox');
      if (appRoot && inbox) out.push({ app, appRoot, inbox });
    }
    return out;
  }

  /** Back-compat shim for the two display sliders. */
  _openViewerRoots() { return this._openViewers().map((v) => v.inbox); }

  /**
   * Push the draft palette onto every open viewer of this shard, and onto the
   * config's own preview strip so the sliders visibly do something even with no
   * viewer open. DOM-only (no render) so it can ride a slider drag.
   */
  _previewTheme() {
    const theme = this._draft();
    const presetKey = this._themePresetKey ?? this.dataShardService?.getConfig(this.item)?.preset ?? 'blank';
    const ts = this.themeService;
    if (!ts) return;

    for (const { appRoot, inbox } of this._openViewers()) {
      const scale = ItemInboxConfig._clampTextScale(this.element?.querySelector('[name="textScale"]')?.value);
      const contrast = ItemInboxConfig._clampContrast(this.element?.querySelector('[name="contrast"]')?.value);
      ts.applyTheme(buildShardThemePrefs(theme, presetKey, { textScale: scale, contrast: 100 }), appRoot);
      applyContrastToElement(inbox, contrast, { baseFrom: appRoot });
    }

    // The strip inside this sheet. It is NOT admin-themed on purpose: it has to
    // show the PLAYER's view of the shard, while the sheet around it stays in the
    // admin palette (the Theme Customizer's _scopePreviewToPlayerTheme precedent).
    const strip = this.element?.querySelector('.ncm-stc-live');
    if (strip) {
      ts.applyTheme(buildShardThemePrefs(theme, presetKey, { textScale: 100, contrast: 100 }), strip);
      applyContrastToElement(strip, ItemInboxConfig._clampContrast(this.element?.querySelector('[name="contrast"]')?.value), { baseFrom: strip });
    }
  }

  /** Re-render an open viewer from its SAVED state — used to drop an unsaved preview. */
  _revertThemePreview() {
    for (const { app } of this._openViewers()) app.render(false);
  }

  /**
   * Repaint the Theme tab from the draft — DOM-only.
   *
   * This sheet CANNOT re-render to refresh itself: `_prepareContext` reads the
   * STORED config, so a `render()` would throw away every unsaved edit in Identity,
   * Security, Network, Systems and Boot. So each control updates its own siblings
   * by hand, the way the terminal's theme tab does.
   */
  _repaintThemeTab() {
    const el = this.element;
    if (!el) return;
    const theme = this._draft();
    const presetKey = this._themePresetKey ?? this.dataShardService?.getConfig(this.item)?.preset ?? 'blank';
    const pal = SHARD_PRESETS[presetKey]?.palette || {};

    el.querySelectorAll('[data-stc="preset"]').forEach((card) => {
      card.classList.toggle('ncm-tc__pcard--active', card.dataset.key === presetKey);
    });
    // The hidden input is what `_onSaveConfig` reads for `config.preset` — the
    // cards are the UI, this is the save contract.
    const hidden = el.querySelector('[name="preset"]');
    if (hidden) hidden.value = presetKey;

    for (const row of el.querySelectorAll('[data-stc-row]')) {
      const key = row.dataset.stcRow;
      const override = theme.colors?.[key];
      const swatch = row.querySelector('[data-stc="color"]');
      if (swatch) swatch.value = override || pal[key] || THEME_COLOR_FALLBACK[key] || '#19f3f7';
      row.classList.toggle('is-override', !!override);
    }
  }

  /**
   * Push a text-size preview onto every open viewer of this shard by setting
   * --ncm-shard-text-scale on its .ncm-item-inbox root (the same var the
   * template stamps from config.textScale). DOM-only — no render, so it's
   * cheap enough to ride the slider drag.
   */
  _previewShardTextScale(pct) {
    const mult = String(ItemInboxConfig._clampTextScale(pct) / 100);
    for (const root of this._openViewerRoots()) root.style.setProperty('--ncm-shard-text-scale', mult);
  }

  /** Same for contrast — the viewer's own _onRender path (applyContrastToElement), run on the live root. */
  _previewShardContrast(pct) {
    for (const root of this._openViewerRoots()) applyContrastToElement(root, ItemInboxConfig._clampContrast(pct));
  }

  /**
   * Closing without saving drops every preview this sheet pushed — the dragged
   * text-size / contrast, and any staged palette. A full re-render of the open
   * viewer is the honest revert for the palette: it repaints from the SAVED
   * config, so there is no inline leftover to hunt down key by key.
   */
  async close(options) {
    if (this._displayPreviewed && !this._displaySaved && this.item) {
      const cfg = this.dataShardService?.getConfig(this.item) ?? {};
      this._previewShardTextScale(cfg.textScale);
      this._previewShardContrast(cfg.contrast);
      if (this._themeDraft || this._themePresetKey) this._revertThemePreview();
    }
    return super.close(options);
  }

  /** Update pipeline node states from current checkbox values */
  _updatePipeline() {
    const el = this.element;
    if (!el) return;
    const mapping = [
      { name: 'networkRequired', index: 0 },
      { name: 'requiresKeyItem', index: 1 },
      { name: 'requiresLogin', index: 2 },
      { name: 'encrypted', index: 3 },
    ];
    const nodes = el.querySelectorAll('.ncm-cfg-pipe-node');
    const arrows = el.querySelectorAll('.ncm-cfg-pipe-arrow');
    mapping.forEach(({ name, index }) => {
      const checked = !!el.querySelector(`[name="${name}"]`)?.checked;
      const node = nodes[index];
      const arrow = arrows[index];
      if (node) {
        node.querySelector('.ncm-cfg-pipe-icon')?.classList.toggle('ncm-cfg-pipe-icon--on', checked);
        node.querySelector('.ncm-cfg-pipe-label')?.classList.toggle('ncm-cfg-pipe-label--on', checked);
      }
      if (arrow) arrow.classList.toggle('ncm-cfg-pipe-arrow--on', checked);
    });
    // Also update layer card borders
    mapping.forEach(({ name }) => {
      const checked = !!el.querySelector(`[name="${name}"]`)?.checked;
      const layer = el.querySelector(`[name="${name}"]`)?.closest('.ncm-cfg-layer');
      if (layer) layer.classList.toggle('ncm-cfg-layer--enabled', checked);
    });
  }

  /** Show/hide ICE source based on encryption type */
  _updateIceVisibility() {
    const el = this.element;
    if (!el) return;
    const iceType = el.querySelector('[name="encryptionType"]')?.value || 'ICE';
    const isLethal = iceType === 'BLACK_ICE' || iceType === 'RED_ICE';
    const iceSource = el.querySelector('[data-ice-source]');
    if (iceSource) iceSource.style.display = isLethal ? '' : 'none';
    // Update damage dice display
    const diceEl = el.querySelector('[data-dmg-dice]');
    if (diceEl) diceEl.textContent = iceType === 'RED_ICE' ? '5d6' : '3d6';
  }

  /** Show/hide network sections based on access mode */
  _updateNetworkConditionals() {
    const el = this.element;
    if (!el) return;
    const mode = el.querySelector('[name="accessMode"]')?.value || 'any';
    const netGrid = el.querySelector('[data-net-section="whitelist"]');
    const typeSection = el.querySelector('[data-net-section="type"]');
    if (netGrid) netGrid.style.display = (mode === 'whitelist' || mode === 'both') ? '' : 'none';
    if (typeSection) typeSection.style.display = (mode === 'type' || mode === 'both') ? '' : 'none';
  }

  // ═══════════════════════════════════════════════════════════
  //  DATA PREPARATION
  // ═══════════════════════════════════════════════════════════

  async _prepareContext(options) {
    if (!this.item) return { hasItem: false };
    const config = this.dataShardService?.getConfig(this.item) ?? foundry.utils.deepClone(DEFAULTS.SHARD_CONFIG);
    const networks = this.networkService?.getAllNetworks?.() ?? [];
    const meta = config.metadata ?? {};

    // ─── Presets ───
    const presetOptions = Object.entries(SHARD_PRESETS).map(([key, p]) => ({
      value: key, label: p.label, selected: config.preset === key,
    }));

    // ─── Theme tab ───
    // The DRAFT is the source of truth while this sheet is open (see _themeDraft):
    // theme controls are unnamed and data-keyed, so they mutate the draft without a
    // re-render, and a tab switch cannot silently discard them.
    const theme = this._themeDraft ?? ItemInboxConfig._readTheme(config);
    const presetKey = this._themePresetKey ?? config.preset ?? 'blank';
    const pal = SHARD_PRESETS[presetKey]?.palette || {};

    const themePresetCards = Object.entries(SHARD_PRESETS).map(([key, p]) => {
      const q = p.palette || {};
      return {
        key,
        label: p.label,
        active: key === presetKey,
        // The blank preset has no palette on purpose — it follows the player's
        // own Agent theme, so its swatch shows the brand defaults.
        sw1: q.secondary || '#19f3f7',
        sw2: q.accent || '#f7c948',
        sw3: q.bgSurface || '#1a1a2e',
      };
    });

    const themeColors = Object.keys(COLOR_VAR_MAP).map((key) => ({
      key,
      label: THEME_COLOR_LABELS[key] || key,
      // What the swatch shows: the override, else the preset's, else the brand
      // default — so the picker always opens on the colour you can actually see.
      value: theme.colors?.[key] || pal[key] || THEME_COLOR_FALLBACK[key] || '#19f3f7',
      hasOverride: !!theme.colors?.[key],
    }));

    const fontSel = (slot, current) => FONT_OPTIONS.map((f) => ({
      value: f.key, label: f.label, selected: f.key === current,
    }));
    const themeFonts = [
      { slot: 'display', label: 'Body / Display', options: fontSel('display', theme.fonts?.display || 'rajdhani') },
      { slot: 'mono', label: 'Monospace', options: fontSel('mono', theme.fonts?.mono || 'sharetechmono') },
      { slot: 'title', label: 'Titles', options: fontSel('title', theme.fonts?.title || 'orbitron') },
    ];

    const savedThemes = ItemInboxConfig._savedThemes().map((t, i) => ({
      index: i, name: t.name,
      sw1: t.theme?.colors?.secondary || '#19f3f7',
      sw2: t.theme?.colors?.accent || '#f7c948',
      sw3: t.theme?.colors?.bgSurface || '#1a1a2e',
    }));

    const fullPresets = ItemInboxConfig._fullPresets().map((t, i) => ({
      index: i, name: t.name, hasSecurity: !!t.config?.security,
    }));

    // ─── Encryption types ───
    const encryptionTypes = [
      { value: 'ICE', label: 'Standard ICE', selected: config.encryptionType === 'ICE' },
      { value: 'BLACK_ICE', label: 'BLACK ICE (3d6 damage)', selected: config.encryptionType === 'BLACK_ICE' },
      { value: 'RED_ICE', label: 'RED ICE (5d6, lethal)', selected: config.encryptionType === 'RED_ICE' },
    ];

    // ─── Skills ───
    const skillEntries = (config.allowedSkills || []).map(name => ({
      name, dc: config.skillDCs?.[name] ?? config.encryptionDC ?? 15,
      stat: SKILL_MAP[name]?.stat?.toUpperCase() ?? '?',
    }));
    const allSkills = Object.keys(SKILL_MAP).filter(s => !(config.allowedSkills || []).includes(s)).sort();

    // ─── Failure modes ───
    const failureModes = [
      { value: 'nothing', label: 'No consequence', selected: config.failureMode === 'nothing' },
      { value: 'lockout', label: 'Lockout (timed)', selected: config.failureMode === 'lockout' },
      { value: 'permanent', label: 'Permanent lockout', selected: config.failureMode === 'permanent' },
      { value: 'damage', label: 'BLACK ICE damage + lockout', selected: config.failureMode === 'damage' },
      { value: 'destroy', label: 'Self-destruct shard', selected: config.failureMode === 'destroy' },
    ];
    const lockoutMinutes = Math.round((config.lockoutDuration || 3600000) / 60000);

    // ─── Layer failure modes (reusable list) ───
    const layerFailureModes = LAYER_FAILURE_MODES;

    // ─── Per-layer hack config ───
    const layerSec = config.layerSecurity ?? {};
    const perLayer = layerSec.perLayer ?? {};

    // ─── Network ───
    const netConfig = config.network ?? {};
    const networkRequired = netConfig.required ?? config.requiresNetwork ?? false;
    const accessMode = netConfig.accessMode ?? 'any';

    const networkOptions = networks.map(n => ({
      value: n.id, label: n.name, type: n.type || 'PUBLIC',
      color: n.theme?.color || '#19f3f7',
      icon: n.theme?.icon || 'fa-wifi',
      theme: n.theme || {},
      selected: (netConfig.allowedNetworks ?? []).includes(n.id),
    }));
    const networkTypeChecks = Object.values(NETWORK_TYPES).map(t => ({
      value: t, label: t, checked: (netConfig.allowedTypes ?? []).includes(t),
    }));

    // ─── Tracing ───
    const tracing = netConfig.tracing ?? {};

    // ─── Integrity ─── (resolved over every default — docs/SHARD-INTEGRITY.md)
    const integrity = config.integrity ?? {};
    const ig = resolveIntegrity(integrity);

    // ─── Expiration ───
    const expiration = config.expiration ?? {};
    const expirationHours = Math.round((expiration.timerDuration || 172800000) / 3600000);

    // ─── Boot ───
    const boot = config.boot ?? {};
    const bootIconOptions = BOOT_ICON_OPTIONS.map(o => ({ ...o, selected: boot.faIcon === o.value }));
    const bootLogLines = boot.logLines ?? [];

    // ─── Icon colors ───
    const ICON_COLORS = [
      { key: 'red', hex: '#F65261' }, { key: 'cyan', hex: '#19f3f7' },
      { key: 'gold', hex: '#f7c948' }, { key: 'green', hex: '#00ff41' },
      { key: 'purple', hex: '#a855f7' }, { key: 'danger', hex: '#ff0033' },
      { key: 'orange', hex: '#e88030' }, { key: 'white', hex: '#e0e0e8' },
      { key: 'muted', hex: '#888888' },
    ];
    const bootIconColor = boot.iconColor || '';
    const iconColorOptions = ICON_COLORS.map(c => ({ ...c, isActive: bootIconColor === c.hex }));

    // ─── Key Item icon options ───
    const keyItemIconOptions = KEY_ITEM_ICON_OPTIONS.map(o => ({
      ...o, selected: config.keyItemIcon === o.value,
    }));

    // ─── ICE source ───
    const iceConfig = config.ice ?? {};
    const iceSource = iceConfig.source ?? 'default';

    // ─── Black ICE actors ───
    const blackIceActors = (game.actors?.filter(a =>
      a.type === 'blackIce' || a.type === 'black-ice' ||
      a.getFlag(MODULE_ID, 'isBlackICE') ||
      a.name?.toLowerCase().includes('black ice')
    ) ?? []).map(a => ({
      id: a.id, name: a.name, img: a.img,
      atk: a.system?.stats?.atk ?? 0,
      damage: a.system?.stats?.atk ? `ATK: ${a.system.stats.atk}` : '',
      iceClass: a.system?.class || '',
      selected: iceConfig.actorId === a.id,
    }));

    // ─── Security layer count ───
    let securityLayerCount = 0;
    if (networkRequired) securityLayerCount++;
    if (config.requiresKeyItem) securityLayerCount++;
    if (config.requiresLogin) securityLayerCount++;
    if (config.encrypted) securityLayerCount++;

    // ─── Timestamp formatted for trigger display ───
    let metaTimestampFormatted = '';
    if (meta.timestamp) {
      try {
        metaTimestampFormatted = formatCyberDate(meta.timestamp);
      } catch (err) {
        log.debug(`ItemInboxConfig: invalid meta.timestamp '${meta.timestamp}' — ${err.message}`);
      }
    }

    // ─── ICE damage dice display ───
    const iceDamageDice = config.encryptionType === 'RED_ICE' ? '5d6'
      : config.encryptionType === 'BLACK_ICE' ? '3d6' : '—';

    return {
      hasItem: true,
      itemName: this.item.name,
      itemImg: this.item.img,
      itemType: this.item.type || 'Item',
      config,

      // Preset
      presetOptions,
      textScale: ItemInboxConfig._clampTextScale(config.textScale),
      contrast: ItemInboxConfig._clampContrast(config.contrast),

      // Theme tab
      themePresetCards,
      themeColors,
      themeFonts,
      savedThemes,
      fullPresets,
      themeDirty: !!this._themeDraft,
      themeWallpaper: theme.wallpaper || '',
      themeWallpaperStrength: ItemInboxConfig._clampStrength(theme.wallpaperStrength),
      previewName: config.shardName || this.item.name,

      // Identity
      shardName: config.shardName || '',
      shardDescription: config.shardDescription || '',

      // Metadata
      metaCreator: meta.creator || '',
      metaNetwork: meta.network || '',
      metaLocation: meta.location || '',
      metaTimestamp: meta.timestamp || '',
      metaTimestampFormatted,
      metaClassification: meta.classification || '',
      typeLineModePresetStatus: (meta.typeLineMode ?? 'preset-status') === 'preset-status',
      typeLineModeStatusOnly: meta.typeLineMode === 'status-only',
      typeLineModeCustom: meta.typeLineMode === 'custom',
      typeLineCustom: meta.typeLineCustom || '',

      // Encryption
      isEncrypted: config.encrypted,
      encryptionTypes,
      encryptionDC: config.encryptionDC,
      encryptionModeShard: config.encryptionMode === 'shard',
      encryptionModeMessage: config.encryptionMode === 'message',

      // Skills
      skillEntries, allSkills, hasSkills: skillEntries.length > 0,

      // Failure (encryption layer)
      failureModes, maxHackAttempts: config.maxHackAttempts, lockoutMinutes,

      // Layer failure modes list
      layerFailureModes,

      // Per-layer hack config
      networkHackMaxAttempts: perLayer.network?.maxAttempts ?? 3,
      networkHackFailureMode: perLayer.network?.failureMode ?? 'nothing',
      networkHackLockoutMin: Math.round((perLayer.network?.lockoutDuration || 3600000) / 60000),
      keyitemHackMaxAttempts: perLayer.keyitem?.maxAttempts ?? 3,
      keyitemHackFailureMode: perLayer.keyitem?.failureMode ?? 'nothing',
      loginHackMaxAttempts: perLayer.login?.maxAttempts ?? 3,
      loginHackFailureMode: perLayer.login?.failureMode ?? 'nothing',

      // Security
      securityLayerCount,

      // Login
      requiresLogin: config.requiresLogin,
      loginUsername: config.loginUsername,
      loginPassword: config.loginPassword,
      loginDisplayName: config.loginDisplayName,
      maxLoginAttempts: config.maxLoginAttempts,

      // Key Item
      requiresKeyItem: config.requiresKeyItem,
      keyItemName: config.keyItemName,
      keyItemId: config.keyItemId,
      keyItemTag: config.keyItemTag,
      keyItemDisplayName: config.keyItemDisplayName,
      keyItemIcon: config.keyItemIcon,
      keyItemImg: config.keyItemImg || (config.keyItemId ? game.items?.get(config.keyItemId)?.img : '') || '',
      keyItemBypassLogin: config.keyItemBypassLogin,
      keyItemBypassEncryption: config.keyItemBypassEncryption,
      keyItemConsumeOnUse: config.keyItemConsumeOnUse,
      keyItemIconOptions,

      // Network
      networkRequired,
      accessModeValue: accessMode,
      accessModeAny: accessMode === 'any',
      accessModeWhitelist: accessMode === 'whitelist',
      accessModeType: accessMode === 'type',
      networkTypeChecks,
      networkOptions,
      connectionModeValue: netConfig.connectionMode ?? 'offline',
      connectionModeOffline: (netConfig.connectionMode ?? 'offline') === 'offline',
      connectionModeTethered: (netConfig.connectionMode ?? 'offline') === 'tethered',
      signalThreshold: netConfig.signalThreshold ?? 40,
      signalDVModifier: netConfig.signalDVModifier ?? true,
      signalDegradation: netConfig.signalDegradation ?? false,

      // Tracing
      tracingEnabled: tracing.enabled ?? false,
      tracingMode: tracing.mode ?? 'silent',
      tracingModeSilent: (tracing.mode ?? 'silent') === 'silent',
      tracingModeWarned: tracing.mode === 'warned',
      tracingModeVisible: tracing.mode === 'visible',
      tracingTriggerOn: tracing.triggerOn ?? 'access',
      tracingRevealIdentity: tracing.revealIdentity ?? true,
      tracingRevealLocation: tracing.revealLocation ?? false,

      // Integrity
      integrityEnabled: ig.enabled,
      ig,
      igChancePct: Math.round(ig.corruptionChance * 100),
      igSkillOptions: [...new Set([ig.recon.skill, ...Object.keys(SKILL_MAP)])].map(v => ({ value: v, selected: v === ig.recon.skill })),

      // Expiration
      expirationEnabled: expiration.enabled ?? false,
      expirationModeTimer: (expiration.mode ?? 'timer') === 'timer',
      expirationModeCalendar: (expiration.mode ?? 'timer') === 'calendar',
      expirationModeAccess: (expiration.mode ?? 'timer') === 'on-access',
      expirationHours,
      expirationAccessCount: expiration.accessCount ?? 1,

      // Boot
      bootEnabled: boot.enabled ?? true,
      bootIconModeFa: (boot.iconMode ?? 'fa') === 'fa',
      bootIconModeImage: (boot.iconMode ?? 'fa') === 'image',
      bootIconModeItem: boot.iconMode === 'item',
      bootIconOptions,
      bootFaIconCustom: boot.faIcon || '',
      bootImageUrl: boot.imageUrl || '',
      bootImageSize: boot.imageSize || 64,
      bootTitle: boot.title || '',
      bootSubtitle: boot.subtitle || '',
      bootProgressLabel: boot.progressLabel || '',
      bootSpeed: boot.speed || 'normal',
      bootSpeedFast: boot.speed === 'fast',
      bootSpeedNormal: (boot.speed ?? 'normal') === 'normal',
      bootSpeedDramatic: boot.speed === 'dramatic',
      bootSpeedCustom: boot.speed === 'custom',
      bootCustomSeconds: boot.customSeconds ?? '',
      bootLogLines,
      bootIconColor,
      iconColorOptions,

      // ICE source
      iceSource,
      iceSourceDefault: iceSource === 'default',
      iceSourceCustom: iceSource === 'custom',
      iceSourceActor: iceSource === 'actor',
      iceCustomName: iceConfig.customName || '',
      iceCustomPortrait: iceConfig.customPortrait || '',
      iceCustomDamage: iceConfig.customDamage || '',
      iceActorId: iceConfig.actorId || '',
      iceDamageDice,
      blackIceActors,

      // Display
      singleMessage: config.singleMessage,
      notifyGM: config.notifyGM ?? true,
      notifyContact: config.notifyContact ?? false,

      // Item (CPR system properties)
      itemPrice: this.item?.system?.price?.market ?? 100,
      itemAmount: this.item?.system?.amount ?? 1,
      itemBrand: this.item?.system?.brand || '',
      itemEquippedOwned: (this.item?.system?.equipped || 'owned') === 'owned',
      itemEquippedCarried: this.item?.system?.equipped === 'carried',
      itemEquippedEquipped: this.item?.system?.equipped === 'equipped',
      itemIsElectronic: this.item?.system?.isElectronic ?? false,
      itemConcealable: this.item?.system?.concealable?.concealable ?? false,
      itemDescription: this.item?.system?.description?.value || '',
      itemSourceBook: this.item?.system?.source?.book || '',
      itemSourcePage: this.item?.system?.source?.page || 0,
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  SAVE CONFIG
  // ═══════════════════════════════════════════════════════════

  static async _onSaveConfig(event, target) {
    if (!isGM() || !this.item) return;
    const el = this.element;
    const val = (name, fallback = '') => el.querySelector(`[name="${name}"]`)?.value ?? fallback;
    const checked = (name) => !!el.querySelector(`[name="${name}"]`)?.checked;

    const allowedSkills = this._collectSkills();
    const skillDCs = this._collectSkillDCs();
    const bootLogLines = this._collectBootLogLines();
    const allowedNetworks = this._collectNetworks();
    const allowedTypes = this._collectCheckedValues('allowedType');

    // Timestamp — stored as ISO from CyberTimePicker hidden input
    const metaTimestamp = val('metaTimestamp');

    const config = {
      preset: val('preset', 'blank'),
      shardName: val('shardName'),
      shardDescription: val('shardDescription'),

      metadata: {
        creator: val('metaCreator'),
        network: val('metaNetwork'),
        location: val('metaLocation'),
        timestamp: metaTimestamp,
        classification: val('metaClassification'),
        typeLineMode: val('typeLineMode', 'preset-status'),
        typeLineCustom: val('typeLineCustom'),
        custom: {},
      },

      encrypted: checked('encrypted'),
      encryptionType: val('encryptionType', 'ICE'),
      encryptionDC: parseInt(val('encryptionDC')) || 15,
      encryptionMode: val('encryptionMode', 'shard'),
      allowedSkills,
      skillDCs,
      failureMode: val('failureMode', 'lockout'),
      maxHackAttempts: parseInt(val('maxHackAttempts')) || 3,
      lockoutDuration: (parseInt(val('lockoutMinutes')) || 60) * 60000,

      requiresLogin: checked('requiresLogin'),
      loginUsername: val('loginUsername'),
      loginPassword: val('loginPassword'),
      loginDisplayName: val('loginDisplayName'),
      maxLoginAttempts: parseInt(val('maxLoginAttempts')) || 3,

      requiresKeyItem: checked('requiresKeyItem'),
      keyItemName: val('keyItemName') || null,
      keyItemId: val('keyItemId') || null,
      keyItemTag: val('keyItemTag') || null,
      keyItemImg: val('keyItemImg') || null,
      keyItemDisplayName: val('keyItemDisplayName'),
      keyItemIcon: val('keyItemIcon', 'fa-id-card'),
      keyItemBypassLogin: checked('keyItemBypassLogin'),
      keyItemBypassEncryption: checked('keyItemBypassEncryption'),
      keyItemConsumeOnUse: checked('keyItemConsumeOnUse'),

      // Per-layer hack security
      layerSecurity: {
        enabled: true,
        perLayer: {
          network: {
            maxAttempts: parseInt(val('networkHackMaxAttempts')) || 3,
            failureMode: val('networkHackFailureMode', 'nothing'),
            lockoutDuration: (parseInt(val('networkHackLockoutMin')) || 60) * 60000,
          },
          keyitem: {
            maxAttempts: parseInt(val('keyitemHackMaxAttempts')) || 3,
            failureMode: val('keyitemHackFailureMode', 'nothing'),
          },
          login: {
            maxAttempts: parseInt(val('loginHackMaxAttempts')) || 3,
            failureMode: val('loginHackFailureMode', 'nothing'),
          },
        },
      },

      // ICE source
      ice: {
        source: val('iceSource', 'default'),
        customName: val('iceCustomName'),
        customPortrait: val('iceCustomPortrait'),
        customDamage: val('iceCustomDamage'),
        actorId: val('iceActorId'),
      },

      network: {
        required: checked('networkRequired'),
        accessMode: val('accessMode', 'any'),
        allowedNetworks,
        allowedTypes,
        connectionMode: val('connectionMode', 'offline'),
        signalThreshold: parseInt(val('signalThreshold')) || 40,
        signalDVModifier: checked('signalDVModifier'),
        signalDegradation: checked('signalDegradation'),
        tracing: {
          enabled: checked('tracingEnabled'),
          mode: val('tracingMode', 'silent'),
          triggerOn: val('tracingTriggerOn', 'access'),
          traceTarget: null,
          traceMessage: null,
          traceDelay: 0,
          revealIdentity: checked('tracingRevealIdentity'),
          revealLocation: checked('tracingRevealLocation'),
          cooldown: 0,
        },
      },

      requiresNetwork: checked('networkRequired'),
      requiredNetwork: allowedNetworks[0] || null,

      integrity: this._collectIntegrity(val, checked),

      expiration: {
        enabled: checked('expirationEnabled'),
        mode: val('expirationMode', 'timer'),
        timerDuration: (parseInt(val('expirationHours')) || 48) * 3600000,
        calendarDate: null,
        accessCount: parseInt(val('expirationAccessCount')) || 1,
      },

      boot: {
        enabled: checked('bootEnabled'),
        iconMode: val('bootIconMode', 'fa'),
        faIcon: val('bootFaIcon', 'fas fa-microchip'),
        iconColor: val('bootIconColor'),
        imageUrl: val('bootImageUrl') || null,
        imageSize: parseInt(val('bootImageSize')) || 64,
        imageTint: val('bootImageTint') || '',
        imageBorderRadius: 'rounded',
        title: val('bootTitle'),
        subtitle: val('bootSubtitle'),
        progressLabel: val('bootProgressLabel'),
        logLines: bootLogLines,
        speed: val('bootSpeed', 'normal'),
        customSeconds: parseFloat(val('bootCustomSeconds')) || null,
        animationStyle: SHARD_PRESETS[val('preset')]?.boot?.animationStyle || 'standard-fade',
      },

      linkedShards: [],
      notifyGM: checked('notifyGM'),
      notifyContact: checked('notifyContact'),
      notifyContactId: null,
      // The theme OBJECT (palette overrides / fonts / wallpaper). This used to be
      // `val('preset')` — a bare preset-key string that nothing ever read, which is
      // why `config.theme` has two legacy shapes in the wild; buildShardThemePrefs
      // tolerates both, so no migration is needed.
      theme: this._themeDraft
        ? foundry.utils.deepClone(this._themeDraft)
        : ItemInboxConfig._readTheme(this.dataShardService?.getConfig(this.item) ?? {}),
      textScale: ItemInboxConfig._clampTextScale(val('textScale')),
      contrast: ItemInboxConfig._clampContrast(val('contrast')),
      singleMessage: checked('singleMessage'),
    };
    this._displaySaved = true;

    const result = await this.dataShardService.updateConfig(this.item, config);
    if (result.success) {
      // Also save CPR system properties directly on the item
      try {
        await this.item.update({
          'system.price.market': parseInt(val('itemPrice')) || 0,
          'system.amount': parseInt(val('itemAmount')) || 1,
          'system.brand': val('itemBrand'),
          'system.equipped': val('itemEquipped', 'owned'),
          'system.isElectronic': checked('itemIsElectronic'),
          'system.concealable.concealable': checked('itemConcealable'),
          'system.description.value': val('itemDescription'),
          'system.source.book': val('itemSourceBook'),
          'system.source.page': parseInt(val('itemSourcePage')) || 0,
        });
      } catch (err) {
        console.warn(`${MODULE_ID} | Failed to update item system properties:`, err);
      }
      ui.notifications.info('NCM | Shard configuration saved.');
      this.close();
    } else {
      ui.notifications.error(`NCM | Failed: ${result.error}`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  INTEGRITY
  // ═══════════════════════════════════════════════════════════

  /**
   * Read the Integrity section. The shard's LIVE state — current integrity, the
   * hit history, who has spent a salvage — is carried over from what is stored:
   * this used to reset current integrity to Max on every save, so editing any
   * other setting quietly healed a damaged shard. Zero is a real value for every
   * number here (`parseInt(x) || 40` used to turn 0 back into the default).
   * @private
   */
  _collectIntegrity(val, checked) {
    const stored = resolveIntegrity(this.dataShardService?.getConfig(this.item)?.integrity ?? {});
    const n = (name, d) => { const v = String(val(name, '')).trim(); return v === '' || !Number.isFinite(+v) ? d : +v; };
    const enabled = checked('integrityEnabled');
    const max = Math.max(1, Math.round(n('integrityMax', stored.maxIntegrity)));
    // Switching integrity ON starts the shard healthy; otherwise keep its damage.
    const current = (!stored.enabled && enabled) ? max : Math.min(stored.currentIntegrity, max);
    return {
      enabled,
      mode: val('integrityMode', stored.mode) === 'mechanical' ? 'mechanical' : 'cosmetic',
      maxIntegrity: max,
      currentIntegrity: current,
      degradePerFailure: n('integrityDegradePerFailure', stored.degradePerFailure),
      hardening: n('integrityHardening', stored.hardening),
      corruptionThreshold: n('integrityCorruptionThreshold', stored.corruptionThreshold),
      corruptionChance: n('integrityCorruptionChance', Math.round(stored.corruptionChance * 100)) / 100,
      legibility: val('integrityLegibility', stored.legibility),
      effects: { scan: checked('igFxScan'), tear: checked('igFxTear'), garble: checked('igFxGarble'), steady: checked('igFxSteady') },
      loss: val('igLoss', stored.loss),
      hideLost: checked('igHideLost'),
      protectMoney: checked('igProtectMoney'),
      programsGlitchy: checked('igProgramsGlitchy'),
      glitchDV: n('igGlitchDV', stored.glitchDV),
      misfire: n('igMisfire', stored.misfire),
      recon: {
        enabled: checked('igReconEnabled'),
        skill: val('igReconSkill', stored.recon.skill),
        dv: n('igReconDV', stored.recon.dv),
        perStep: n('igReconPerStep', stored.recon.perStep),
        step: val('igReconStep', stored.recon.step),
        worsen: checked('igReconWorsen'),
      },
      repairPts: n('igRepairPts', stored.repairPts),
      dead: {
        list: val('igDeadList', stored.dead.list),
        salvage: checked('igDeadSalvage'),
        salvageDV: n('igSalvageDV', stored.dead.salvageDV),
        salvagePct: n('igSalvagePct', stored.dead.salvagePct),
      },
      history: stored.history,
      lastHit: stored.lastHit,
      salvaged: stored.salvaged,
    };
  }

  /**
   * Integrity section live behaviour: the two card pickers (mode, how it looks),
   * show/hide of the rows that only apply to one mode, and the legibility sample.
   * DOM-only — nothing here re-renders, so unsaved edits elsewhere survive.
   * @private
   */
  _wireIntegrity() {
    const box = this.element?.querySelector('[data-ig-cfg]');
    if (!box) return;
    const SAMPLE = 'Convoy manifest attached — ETA 0400.';
    const sync = () => {
      const mode = box.querySelector('[name="integrityMode"]')?.value || 'cosmetic';
      box.dataset.igMode = mode;
      box.querySelectorAll('[data-ig-show]').forEach(el => { el.hidden = el.dataset.igShow !== mode; });
      const on = (name) => !!box.querySelector(`[name="${name}"]`)?.checked;
      const tog = (sel, show) => box.querySelectorAll(sel).forEach(el => { el.hidden = !show; });
      tog('[data-ig-show-glitchy]', on('igProgramsGlitchy'));
      tog('[data-ig-show-recon]', on('igReconEnabled'));
      tog('[data-ig-show-salvage]', on('igDeadSalvage'));
      const leg = box.querySelector('[name="integrityLegibility"]')?.value || 'rough';
      const sample = box.querySelector('[data-ig-sample]');
      if (sample) sample.textContent = `At Critical → ${garbleString(SAMPLE, garbleRate(leg, 'severe'), `sample:${leg}`)}`;
    };
    box.querySelectorAll('[data-ig-pick]').forEach(group => {
      group.addEventListener('click', (ev) => {
        const card = ev.target.closest('.ncm-cfg-am-card');
        if (!card) return;
        group.querySelectorAll('.ncm-cfg-am-card').forEach(c => c.classList.toggle('ncm-cfg-am-card--sel', c === card));
        const input = box.querySelector(group.dataset.igPick === 'mode' ? '[name="integrityMode"]' : '[name="integrityLegibility"]');
        if (input) input.value = card.dataset.v;
        sync();
      });
    });
    box.addEventListener('change', sync);
    sync();
  }

  // ═══════════════════════════════════════════════════════════
  //  TAB SWITCHING
  // ═══════════════════════════════════════════════════════════

  static _onSwitchTab(event, target) {
    const tab = target.dataset.tab;
    if (!tab) return;
    this._activeTab = tab;

    // Update tab bar
    this.element.querySelectorAll('.ncm-cfg-tab').forEach(t => {
      t.classList.toggle('ncm-cfg-tab--active', t.dataset.tab === tab);
    });
    // Update panels
    this.element.querySelectorAll('.ncm-cfg-panel').forEach(p => {
      p.classList.toggle('ncm-cfg-panel--active', p.dataset.panel === tab);
    });
    // Scroll content to top
    const content = this.element.querySelector('.ncm-cfg-content');
    if (content) content.scrollTop = 0;
  }

  // ═══════════════════════════════════════════════════════════
  //  NETWORK INTERACTIVE ACTIONS
  // ═══════════════════════════════════════════════════════════

  static _onSelectAccessMode(event, target) {
    const mode = target.dataset.mode || target.closest('[data-mode]')?.dataset.mode;
    if (!mode) return;
    // Scoped to THIS picker — the Integrity section reuses the card style.
    const group = target.closest('.ncm-cfg-access-modes') || this.element;
    group.querySelectorAll('.ncm-cfg-am-card').forEach(c => c.classList.remove('ncm-cfg-am-card--sel'));
    (target.closest('.ncm-cfg-am-card') || target).classList.add('ncm-cfg-am-card--sel');
    const input = this.element.querySelector('[name="accessMode"]');
    if (input) input.value = mode;
    this._updateNetworkConditionals();
  }

  static _onSelectConnMode(event, target) {
    const mode = target.dataset.mode || target.closest('[data-mode]')?.dataset.mode;
    if (!mode) return;
    this.element.querySelectorAll('.ncm-cfg-cm-card').forEach(c => c.classList.remove('ncm-cfg-cm-card--sel'));
    (target.closest('.ncm-cfg-cm-card') || target).classList.add('ncm-cfg-cm-card--sel');
    const input = this.element.querySelector('[name="connectionMode"]');
    if (input) input.value = mode;
  }

  static _onToggleNetwork(event, target) {
    const card = target.closest('.ncm-cfg-net-card') || target;
    const netId = card.dataset.netId;
    if (!netId) return;
    card.classList.toggle('ncm-cfg-net-card--on');
    const isOn = card.classList.contains('ncm-cfg-net-card--on');
    const container = this.element.querySelector('#ncm-network-hidden-inputs');
    if (!container) return;

    if (isOn) {
      if (!container.querySelector(`[data-net-hidden="${netId}"]`)) {
        const inp = document.createElement('input');
        inp.type = 'hidden'; inp.name = 'allowedNetwork'; inp.value = netId;
        inp.dataset.netHidden = netId;
        container.appendChild(inp);
      }
    } else {
      container.querySelector(`[data-net-hidden="${netId}"]`)?.remove();
    }
  }

  static _onToggleNetworkType(event, target) {
    const card = target.closest('.ncm-cfg-type-card') || target;
    const typeVal = card.dataset.typeValue;
    if (!typeVal) return;
    card.classList.toggle('ncm-cfg-type-card--on');
    // Toggle the hidden checkbox
    const cb = this.element.querySelector(`input[name="allowedType"][value="${typeVal}"]`);
    if (cb) cb.checked = card.classList.contains('ncm-cfg-type-card--on');
  }

  // ═══════════════════════════════════════════════════════════
  //  ICE SOURCE
  // ═══════════════════════════════════════════════════════════

  static _onSelectIceMode(event, target) {
    const mode = target.dataset.mode || target.closest('[data-mode]')?.dataset.mode;
    if (!mode) return;
    this.element.querySelectorAll('.ncm-cfg-ice-card').forEach(c => c.classList.remove('ncm-cfg-ice-card--sel'));
    (target.closest('.ncm-cfg-ice-card') || target).classList.add('ncm-cfg-ice-card--sel');
    this.element.querySelectorAll('.ncm-cfg-ice-panel').forEach(p => p.classList.remove('ncm-cfg-ice-panel--on'));
    this.element.querySelector(`[data-ice-panel="${mode}"]`)?.classList.add('ncm-cfg-ice-panel--on');
    const input = this.element.querySelector('[name="iceSource"]');
    if (input) input.value = mode;
  }

  static _onSelectIceActor(event, target) {
    const card = target.closest('.ncm-cfg-actor-card') || target;
    const actorId = card.dataset.actorId;
    if (!actorId) return;
    this.element.querySelectorAll('.ncm-cfg-actor-card').forEach(c => c.classList.remove('ncm-cfg-actor-card--sel'));
    card.classList.add('ncm-cfg-actor-card--sel');
    const input = this.element.querySelector('[name="iceActorId"]');
    if (input) input.value = actorId;
  }

  // ═══════════════════════════════════════════════════════════
  //  KEY ITEM PICKER
  // ═══════════════════════════════════════════════════════════

  static async _onSearchKeyItem(event, target) {
    const items = game.items?.contents ?? [];
    if (items.length === 0) {
      ui.notifications.warn('NCM | No items found in the world.');
      return;
    }

    // Build card-based HTML content
    const itemCards = items.map(item => {
      const img = item.img && !item.img.includes('mystery-man') ? `<img src="${item.img}" alt="">` : `<i class="fas fa-cube"></i>`;
      const escapedName = item.name.replace(/"/g, '&quot;').replace(/</g, '&lt;');
      return `<div class="ncm-ip-item" data-item-id="${item.id}" data-item-name="${item.name.toLowerCase()}">
        <div class="ncm-ip-item-img">${img}</div>
        <div style="flex:1;min-width:0">
          <div class="ncm-ip-item-name">${escapedName}</div>
          <div class="ncm-ip-item-type">${item.type || 'Item'}</div>
        </div>
      </div>`;
    }).join('');

    const content = `
      <div class="ncm-ip-search-wrap">
        <i class="fas fa-magnifying-glass"></i>
        <input type="text" class="ncm-ip-search" placeholder="Search items..." autofocus />
      </div>
      <div class="ncm-ip-list">${itemCards || '<div class="ncm-ip-empty">No items found</div>'}</div>
    `;

    let selectedItem = null;

    const dialog = adminDialog({
      title: 'Select Key Item',
      content,
      buttons: { cancel: { label: 'Cancel', callback: () => {} } },
      default: 'cancel',
      render: (html) => {
        const jq = html instanceof jQuery ? html : $(html);
        const listEl = jq.find('.ncm-ip-list')[0] || jq[0]?.querySelector('.ncm-ip-list');
        const searchEl = jq.find('.ncm-ip-search')[0] || jq[0]?.querySelector('.ncm-ip-search');

        // Search filtering
        if (searchEl) {
          searchEl.addEventListener('input', () => {
            const query = searchEl.value.toLowerCase().trim();
            const cards = (listEl || jq[0]).querySelectorAll('.ncm-ip-item');
            cards.forEach(card => {
              const name = card.dataset.itemName || '';
              card.style.display = !query || name.includes(query) ? '' : 'none';
            });
          });
        }

        // Click to select
        if (listEl) {
          listEl.addEventListener('click', (e) => {
            const card = e.target.closest('.ncm-ip-item');
            if (!card) return;
            const itemId = card.dataset.itemId;
            selectedItem = game.items.get(itemId);
            if (selectedItem) dialog.close();
          });
        }
      },
    }, {
      classes: ['dialog', 'ncm-item-picker-dialog'],
      width: 420,
      height: 480,
      resizable: true,
    });

    await new Promise(resolve => {
      dialog.close = new Proxy(dialog.close, {
        apply(target, thisArg, args) {
          const result = Reflect.apply(target, thisArg, args);
          resolve();
          return result;
        }
      });
      dialog.render(true);
    });

    if (!selectedItem) return;

    // Direct DOM update — no render() needed
    const el = this.element;
    const setVal = (name, v) => { const inp = el.querySelector(`[name="${name}"]`); if (inp) inp.value = v; };
    setVal('keyItemName', selectedItem.name);
    setVal('keyItemId', selectedItem.id);
    setVal('keyItemImg', selectedItem.img || '');

    // Update filled picker display
    const filled = el.querySelector('[data-key-item-filled]');
    const empty = el.querySelector('[data-key-item-empty]');
    if (filled) {
      filled.style.display = '';
      // Image
      const imgSlot = filled.querySelector('[data-key-item-img-slot]');
      if (imgSlot) {
        const imgSrc = selectedItem.img;
        if (imgSrc && !imgSrc.includes('mystery-man')) {
          imgSlot.innerHTML = `<img src="${imgSrc}" alt="" style="width:100%;height:100%;object-fit:cover;border:none;">`;
        } else {
          imgSlot.innerHTML = '<i class="fas fa-cube"></i>';
        }
      }
      // Name
      const nameSlot = filled.querySelector('[data-key-item-name-slot]');
      if (nameSlot) nameSlot.textContent = selectedItem.name;
      // ID
      const idSlot = filled.querySelector('[data-key-item-id-slot]');
      if (idSlot) idSlot.textContent = selectedItem.id ? `ID: ${selectedItem.id}` : '';
    }
    if (empty) empty.style.display = 'none';
  }

  static _onClearKeyItem(event, target) {
    const el = this.element;
    const setVal = (name, v) => { const inp = el.querySelector(`[name="${name}"]`); if (inp) inp.value = v; };
    setVal('keyItemName', '');
    setVal('keyItemId', '');
    setVal('keyItemImg', '');

    // Toggle visibility
    const filled = el.querySelector('[data-key-item-filled]');
    const empty = el.querySelector('[data-key-item-empty]');
    if (filled) filled.style.display = 'none';
    if (empty) empty.style.display = '';
  }

  // ═══════════════════════════════════════════════════════════
  //  BOOT PREVIEW
  // ═══════════════════════════════════════════════════════════

  static async _onPreviewBoot(event, target) {
    const el = this.element;
    const frame = el.querySelector('[data-boot-preview]');
    if (!frame) return;

    // Read current form values
    const title = el.querySelector('[name="bootTitle"]')?.value || 'DATA SHARD';
    const subtitle = el.querySelector('[name="bootSubtitle"]')?.value || '';
    const progressLabel = el.querySelector('[name="bootProgressLabel"]')?.value || 'Loading...';
    const speedSel = el.querySelector('[name="bootSpeed"]')?.value || 'normal';
    const speed = { fast: 1500, normal: 3500, dramatic: 5000 }[speedSel] || 3500;
    const iconMode = el.querySelector('[name="bootIconMode"]')?.value || 'fa';
    const iconClass = el.querySelector('[name="bootFaIcon"]')?.value || 'fas fa-microchip';
    const userIconColor = el.querySelector('[name="bootIconColor"]')?.value || '';
    const imageUrl = el.querySelector('[name="bootImageUrl"]')?.value || '';
    const logInputs = el.querySelectorAll('[name="bootLogLine"]');
    const logLines = Array.from(logInputs).map(i => i.value).filter(Boolean);

    // ─── Preset theme integration ───
    const presetKey = el.querySelector('[name="preset"]')?.value || 'blank';
    const preset = SHARD_PRESETS[presetKey] ?? SHARD_PRESETS['blank'];
    const theme = preset?.theme ?? {};
    const animStyle = preset?.boot?.animationStyle || 'standard-fade';

    // Resolve accent color: user override > preset theme > fallback
    const accent = userIconColor || theme.accent || '#19f3f7';
    // Resolve background from preset
    const bgColor = theme.headerBg || '#0a0a0f';
    const logColor = theme.colorTemp === 'warm' ? '#ffcc66' : '#00ff41';

    // Clear and build preview
    frame.innerHTML = '';
    frame.style.cssText = `position:relative;background:${bgColor};`;

    const area = document.createElement('div');
    area.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;';
    frame.appendChild(area);

    // ─── Icon (FA or Image) ───
    const icon = document.createElement('div');
    icon.style.cssText = `width:44px;height:44px;border-radius:50%;border:2px solid ${accent};color:${accent};display:flex;align-items:center;justify-content:center;font-size:18px;opacity:0;transform:scale(0.5);overflow:hidden;`;
    if (iconMode === 'image' && imageUrl) {
      icon.innerHTML = `<img src="${imageUrl}" style="width:100%;height:100%;object-fit:cover;border:none;">`;
    } else {
      icon.innerHTML = `<i class="${iconClass}"></i>`;
    }
    area.appendChild(icon);

    // Title
    const titleEl = document.createElement('div');
    titleEl.style.cssText = `font-family:'Orbitron',sans-serif;font-size:10px;font-weight:700;color:${accent};text-transform:uppercase;letter-spacing:0.12em;opacity:0;transform:translateY(4px);text-align:center;padding:0 10px;`;
    titleEl.textContent = title;
    area.appendChild(titleEl);

    // Subtitle
    const subEl = document.createElement('div');
    subEl.style.cssText = `font-family:'Share Tech Mono',monospace;font-size:9px;color:rgba(255,255,255,0.35);opacity:0;text-align:center;padding:0 10px;`;
    subEl.textContent = subtitle;
    area.appendChild(subEl);

    // Progress bar
    const track = document.createElement('div');
    track.style.cssText = 'width:50%;height:3px;background:rgba(255,255,255,0.06);border-radius:2px;overflow:hidden;opacity:0;';
    const fill = document.createElement('div');
    fill.style.cssText = `height:100%;width:0;background:${accent};border-radius:2px;`;
    track.appendChild(fill);
    area.appendChild(track);

    const pLabel = document.createElement('div');
    pLabel.style.cssText = 'font-family:"Share Tech Mono",monospace;font-size:8px;color:rgba(255,255,255,0.25);opacity:0;';
    pLabel.textContent = progressLabel;
    area.appendChild(pLabel);

    // Log area
    const logArea = document.createElement('div');
    logArea.style.cssText = `position:absolute;bottom:8px;left:10px;right:10px;font-family:"Share Tech Mono",monospace;font-size:8px;color:${logColor};line-height:1.5;`;
    frame.appendChild(logArea);

    // ─── Animation choreography based on animationStyle ───
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const transition = (el, prop, dur = '0.3s') => el.style.transition = `${prop} ${dur} ease`;

    // Style-specific timing modifiers
    const isFast = animStyle === 'instant-dump';
    const isGlitch = animStyle === 'glitch-stutter';
    const isSnap = animStyle === 'holographic-snap' || animStyle === 'authority-stamp';
    const isSweep = animStyle === 'scan-sweep';
    const isWarm = animStyle === 'warm-dissolve';
    const isBreathe = animStyle === 'neon-breathe';
    const isFlash = animStyle === 'camera-flash';

    // Step 1: Icon entrance
    await wait(isFast ? 80 : 200);
    if (isSnap) {
      icon.style.transition = 'all 0.15s cubic-bezier(0.2, 1.5, 0.4, 1)';
    } else if (isGlitch) {
      icon.style.transition = 'all 0.1s steps(3)';
    } else if (isWarm) {
      icon.style.transition = 'all 0.8s ease';
    } else {
      icon.style.transition = 'all 0.4s ease';
    }
    icon.style.opacity = '1'; icon.style.transform = 'scale(1)';

    if (isFlash) {
      // Camera flash effect
      const flash = document.createElement('div');
      flash.style.cssText = 'position:absolute;inset:0;background:white;opacity:0.6;transition:opacity 0.3s;pointer-events:none;z-index:10;';
      frame.appendChild(flash);
      await wait(100);
      flash.style.opacity = '0';
      await wait(300);
      flash.remove();
    }

    // Step 2: Title
    await wait(isFast ? 150 : isSnap ? 200 : 400);
    transition(titleEl, 'all', isSnap ? '0.15s' : isWarm ? '0.6s' : '0.3s');
    titleEl.style.opacity = '1'; titleEl.style.transform = 'translateY(0)';

    // Step 3: Subtitle
    await wait(isFast ? 100 : 250);
    transition(subEl, 'all', isWarm ? '0.6s' : '0.3s');
    subEl.style.opacity = '1';

    // Step 4: Progress bar
    await wait(isFast ? 80 : 200);
    transition(track, 'opacity'); track.style.opacity = '1';
    transition(pLabel, 'opacity'); pLabel.style.opacity = '1';

    // Step 5: Fill progress
    const progressDuration = isFast ? speed * 0.3 : speed * 0.5;
    const progressSteps = isFast ? 5 : isGlitch ? 10 : 20;
    for (let i = 1; i <= progressSteps; i++) {
      const pct = (i / progressSteps * 100);
      if (isGlitch && Math.random() < 0.3) {
        // Glitch: jump ahead/back randomly
        fill.style.width = (pct + (Math.random() * 10 - 5)) + '%';
      } else {
        fill.style.width = pct + '%';
      }
      fill.style.transition = isGlitch ? 'width 0.05s steps(2)' : `width ${progressDuration/progressSteps/1000}s linear`;
      await wait(progressDuration / progressSteps);
    }
    fill.style.width = '100%';

    // Step 6: Log lines
    const lineDelay = logLines.length > 0 ? Math.max(80, (speed * 0.3) / logLines.length) : 0;
    for (const line of logLines) {
      const lineEl = document.createElement('div');
      lineEl.style.cssText = `opacity:0;transform:translateX(${isSweep ? '8px' : '-4px'});transition:all ${isGlitch ? '0.1s steps(2)' : '0.2s ease'};`;
      lineEl.textContent = `> ${line}`;
      logArea.appendChild(lineEl);
      await wait(40);
      lineEl.style.opacity = '0.6'; lineEl.style.transform = 'translateX(0)';
      await wait(lineDelay);
    }

    // Step 7: Fade out
    await wait(isFast ? 300 : 600);
    area.style.transition = 'opacity 0.4s'; area.style.opacity = '0';
    logArea.style.transition = 'opacity 0.4s'; logArea.style.opacity = '0';
    await wait(500);

    frame.innerHTML = '<div class="ncm-cfg-pf-idle">Click Preview to test</div>';
    frame.style.background = '';
  }

  // ═══════════════════════════════════════════════════════════
  //  PRESET APPLICATION
  // ═══════════════════════════════════════════════════════════

  static async _onApplyPreset(event, target) {
    if (!isGM() || !this.item) return;
    const presetKey = this.element.querySelector('[name="preset"]')?.value;
    if (!presetKey || !SHARD_PRESETS[presetKey]) return;
    const confirm = await adminConfirm({
      title: 'Apply Preset',
      content: `<p>Apply <strong>${SHARD_PRESETS[presetKey].label}</strong>? Overwrites security, boot, and theme.</p>`,
    });
    if (!confirm) return;
    const result = await this.dataShardService.applyPreset(this.item, presetKey);
    if (result.success) {
      ui.notifications.info(`NCM | Preset "${SHARD_PRESETS[presetKey].label}" applied.`);
      this.render();
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  SKILL MANAGEMENT
  // ═══════════════════════════════════════════════════════════

  static _onAddSkill(event, target) {
    const select = this.element.querySelector('[name="newSkill"]');
    const skillName = select?.value;
    if (!skillName) return;
    const container = this.element.querySelector('.ncm-cfg-skill-list');
    if (!container) return;
    const dc = parseInt(this.element.querySelector('[name="encryptionDC"]')?.value) || 15;
    const entry = document.createElement('div');
    entry.classList.add('ncm-cfg-skill-row');
    entry.dataset.skill = skillName;
    const stat = SKILL_MAP[skillName]?.stat?.toUpperCase() ?? '?';
    entry.innerHTML = `<span class="ncm-cfg-skill-name">${skillName} <small>(${stat})</small></span>
      <span class="ncm-cfg-skill-dv-label">DV</span>
      <input type="number" name="skillDC-${skillName}" value="${dc}" min="1" max="30" class="ncm-cfg-skill-dv" />
      <button type="button" class="ncm-cfg-btn-icon ncm-cfg-btn-icon--danger" data-action="removeSkill" data-skill="${skillName}"><i class="fas fa-times"></i></button>`;
    container.appendChild(entry);
    const opt = select.querySelector(`option[value="${skillName}"]`);
    if (opt) opt.remove();
    select.value = '';
  }

  static _onRemoveSkill(event, target) {
    const skillName = target.dataset.skill || target.closest('[data-skill]')?.dataset.skill;
    if (!skillName) return;
    this.element.querySelector(`.ncm-cfg-skill-row[data-skill="${skillName}"]`)?.remove();
  }

  // ═══════════════════════════════════════════════════════════
  //  BOOT LOG LINE MANAGEMENT
  // ═══════════════════════════════════════════════════════════

  static _onAddBootLogLine(event, target) {
    const container = this.element.querySelector('.ncm-cfg-boot-log-list');
    if (!container) return;
    const entry = document.createElement('div');
    entry.classList.add('ncm-cfg-boot-log-entry');
    entry.innerHTML = `<input type="text" name="bootLogLine" class="ncm-cfg-input" value="" placeholder="Log line..." />
      <button type="button" class="ncm-cfg-btn-icon ncm-cfg-btn-icon--danger" data-action="removeBootLogLine"><i class="fas fa-times"></i></button>`;
    container.appendChild(entry);
  }

  static _onRemoveBootLogLine(event, target) {
    target.closest('.ncm-cfg-boot-log-entry')?.remove();
  }

  // ═══════════════════════════════════════════════════════════
  //  RESET & RELOCK
  // ═══════════════════════════════════════════════════════════

  static async _onResetDefaults(event, target) {
    const confirm = await adminConfirm({ title: 'Reset', content: '<p>Reset all to defaults? Cannot be undone.</p>' });
    if (!confirm) return;
    await this.dataShardService.updateConfig(this.item, foundry.utils.deepClone(DEFAULTS.SHARD_CONFIG));
    this.render();
  }

  static async _onRelockShard(event, target) {
    if (!this.item) return;
    const confirm = await adminConfirm({
      title: 'Relock All Security',
      content: `<p>Resets ALL security for all players. Cannot be undone.</p>`,
    });
    if (!confirm) return;
    const result = await this.dataShardService?.relockShard(this.item);
    if (result?.success) {
      ui.notifications.info('NCM | All security relocked.');
      for (const app of Object.values(ui.windows)) {
        if (app.item?.id === this.item.id && app !== this) app.render(true);
      }
    } else {
      ui.notifications.error(`NCM | Relock failed: ${result?.error || 'Unknown'}`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  ICON & IMAGE PICKERS
  // ═══════════════════════════════════════════════════════════

  static _onSelectIcon(event, target) {
    const icon = target.dataset.icon;
    const targetInput = target.dataset.target;
    if (!icon || !targetInput) return;
    const input = this.element?.querySelector(`[name="${targetInput}"]`);
    if (input) input.value = icon;
    const grid = target.closest('.ncm-cfg-icon-grid');
    grid?.querySelectorAll('.ncm-cfg-ig-item').forEach(el => {
      el.classList.toggle('ncm-cfg-ig-item--active', el.dataset.icon === icon);
    });
  }

  static _onBrowseImage(event, target) {
    const targetInput = target.dataset.target;
    if (!targetInput) return;
    const input = this.element?.querySelector(`[name="${targetInput}"]`);
    new FilePicker({
      type: 'image',
      current: input?.value || '',
      callback: (path) => { if (input) input.value = path; },
    }).render(true);
  }

  static _onChangeIconMode(event, target) {
    const mode = target.value;
    const sections = this.element.querySelectorAll('.ncm-cfg-icon-mode-section');
    sections.forEach(s => {
      s.style.display = s.dataset.iconMode === mode ? '' : 'none';
    });
  }

  static _onSelectIconColor(event, target) {
    const color = target.dataset.color;
    const targetInput = target.dataset.target;
    if (!color || !targetInput) return;
    const input = this.element?.querySelector(`[name="${targetInput}"]`);
    if (input) input.value = color;
    const row = target.closest('.ncm-cfg-color-dots');
    row?.querySelectorAll('.ncm-cfg-color-dot').forEach(dot => {
      dot.classList.toggle('ncm-cfg-color-dot--active', dot.dataset.color === color);
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  TIMESTAMP PICKER
  // ═══════════════════════════════════════════════════════════

  /** Open CyberTimePicker for the metadata timestamp field */
  static _onOpenTimePicker(event, target) {
    const inputName = target.dataset.target || 'metaTimestamp';
    const hiddenInput = this.element?.querySelector(`input[name="${inputName}"]`);
    const triggerValue = target.querySelector('.ncm-ctp-trigger__value');

    CyberTimePicker.open({
      value: hiddenInput?.value || '',
      onSet: (iso, formatted) => {
        if (hiddenInput) hiddenInput.value = iso;
        if (triggerValue) {
          triggerValue.textContent = formatted;
          triggerValue.classList.remove('ncm-ctp-trigger__value--empty');
        }
      },
      onClear: () => {
        if (hiddenInput) hiddenInput.value = '';
        if (triggerValue) {
          triggerValue.textContent = 'No timestamp set';
          triggerValue.classList.add('ncm-ctp-trigger__value--empty');
        }
      },
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  COLLECTION HELPERS
  // ═══════════════════════════════════════════════════════════

  _collectSkills() {
    return Array.from(this.element?.querySelectorAll('.ncm-cfg-skill-row') || [])
      .map(el => el.dataset.skill).filter(Boolean);
  }

  _collectSkillDCs() {
    const dcs = {};
    for (const el of this.element?.querySelectorAll('.ncm-cfg-skill-row') || []) {
      const name = el.dataset.skill;
      const dc = el.querySelector('.ncm-cfg-skill-dv');
      if (name && dc) dcs[name] = parseInt(dc.value) || 15;
    }
    return dcs;
  }

  _collectBootLogLines() {
    return Array.from(this.element?.querySelectorAll('[name="bootLogLine"]') || [])
      .map(el => el.value?.trim()).filter(Boolean);
  }

  _collectNetworks() {
    return Array.from(this.element?.querySelectorAll('[data-net-hidden]') || [])
      .map(el => el.value).filter(Boolean);
  }

  _collectCheckedValues(namePrefix) {
    const checked = Array.from(this.element?.querySelectorAll(`[name^="${namePrefix}"]:checked`) || []);
    const hidden = Array.from(this.element?.querySelectorAll(`input[type="hidden"][name^="${namePrefix}"]`) || []);
    return [...checked, ...hidden].map(el => el.value).filter(Boolean);
  }
}
