/**
 * ThemeCustomizerApp
 * @file scripts/ui/ThemeCustomizer/ThemeCustomizerApp.js
 * @module cyberpunkred-messenger
 * @description Player-accessible theme editor. Live CSS variable preview,
 *              preset selector (8 presets from ThemeService), custom color
 *              overrides, animation level toggle, font selector.
 *              Saves to user flags (client settings).
 *              Extends BaseApplication (ApplicationV2 + HandlebarsApplicationMixin).
 */

import { MODULE_ID, TEMPLATES, THEME_PRESETS, COLOR_VAR_MAP, FONT_OPTIONS, DEFAULTS } from '../../utils/constants.js';
import { log } from '../../utils/helpers.js';
import { BaseApplication } from '../BaseApplication.js';

export class ThemeCustomizerApp extends BaseApplication {

  /** @type {object} Working copy of theme preferences for live preview */
  _workingPrefs = null;

  /** @type {boolean} Whether unsaved changes exist */
  _isDirty = false;

  /** @type {string} Currently active tab */
  _activeTab = 'presets';

  // ─── Service Accessors ───

  get themeService() { return game.nightcity?.themeService; }
  get settingsManager() { return game.nightcity?.settingsManager; }

  // ─── ApplicationV2 Configuration ───

  static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
    id: 'ncm-theme-customizer',
    classes: ['ncm-app', 'ncm-theme-customizer'],
    window: {
      title: 'NCM.Theme.Customizer',
      icon: 'fas fa-palette',
      resizable: true,
      minimizable: true,
    },
    position: {
      width: 500,
      height: 620,
    },
    actions: {
      selectPreset: ThemeCustomizerApp._onSelectPreset,
      updateColor: ThemeCustomizerApp._onUpdateColor,
      setAnimationLevel: ThemeCustomizerApp._onSetAnimationLevel,
      toggleScanlines: ThemeCustomizerApp._onToggleScanlines,
      toggleNeonGlow: ThemeCustomizerApp._onToggleNeonGlow,
      setGlitchIntensity: ThemeCustomizerApp._onSetGlitchIntensity,
      setDensity: ThemeCustomizerApp._onSetDensity,
      setFont: ThemeCustomizerApp._onSetFont,
      resetDefaults: ThemeCustomizerApp._onResetDefaults,
      resetColors: ThemeCustomizerApp._onResetColors,
      saveAsCustomPreset: ThemeCustomizerApp._onSaveAsCustomPreset,
      applyCustomPreset: ThemeCustomizerApp._onApplyCustomPreset,
      overwriteCustomPreset: ThemeCustomizerApp._onOverwriteCustomPreset,
      deleteCustomPreset: ThemeCustomizerApp._onDeleteCustomPreset,
      importTheme: ThemeCustomizerApp._onImportTheme,
      exportTheme: ThemeCustomizerApp._onExportTheme,
      save: ThemeCustomizerApp._onSave,
      cancel: ThemeCustomizerApp._onCancel,
    },
  }, { inplace: false });

  static PARTS = {
    main: {
      template: TEMPLATES.THEME_CUSTOMIZER,
    },
  };

  // ─── Lifecycle ───

  constructor(options = {}) {
    super(options);
    // Initialize working copy from current settings
    const current = this.settingsManager?.getTheme() ?? foundry.utils.deepClone(DEFAULTS.PLAYER_THEME);
    this._workingPrefs = foundry.utils.deepClone(current);
    // Ensure fonts object exists
    if (!this._workingPrefs.fonts) {
      this._workingPrefs.fonts = foundry.utils.deepClone(DEFAULTS.PLAYER_THEME.fonts);
    }
  }

  // ─── Data Preparation ───

  async _prepareContext(options) {
    const prefs = this._workingPrefs;
    const currentPreset = THEME_PRESETS[prefs.preset] || THEME_PRESETS.classic;

    // Build preset list with active indicator
    const presets = Object.entries(THEME_PRESETS).map(([key, preset]) => ({
      key,
      label: preset.label,
      primary: preset.primary,
      secondary: preset.secondary,
      bgBase: preset.bgBase,
      isActive: key === prefs.preset,
    }));

    // Build color editor entries — show effective color (override or preset default)
    const colorEntries = Object.entries(COLOR_VAR_MAP).map(([key, cssVar]) => ({
      key,
      cssVar,
      label: this._colorLabel(key),
      value: prefs.colors?.[key] || currentPreset[key] || '#000000',
      hasOverride: !!prefs.colors?.[key],
      presetDefault: currentPreset[key] || '#000000',
    }));

    // Animation levels
    const animationLevels = [
      { id: 'full', label: 'Full', active: prefs.animationLevel === 'full' },
      { id: 'reduced', label: 'Reduced', active: prefs.animationLevel === 'reduced' },
      { id: 'off', label: 'Off', active: prefs.animationLevel === 'off' },
    ];

    // Density options
    const densityOptions = [
      { id: 'compact', label: 'Compact', active: prefs.messageDensity === 'compact' },
      { id: 'normal', label: 'Normal', active: prefs.messageDensity === 'normal' },
      { id: 'comfortable', label: 'Comfortable', active: prefs.messageDensity === 'comfortable' },
    ];

    // Font selectors — all fonts available in every slot
    const fonts = prefs.fonts || DEFAULTS.PLAYER_THEME.fonts;
    const fontSelectors = [
      { slot: 'display', label: 'Body / Display', options: FONT_OPTIONS.map(f => ({ ...f, selected: f.key === fonts.display })) },
      { slot: 'mono', label: 'Monospace / Data', options: FONT_OPTIONS.map(f => ({ ...f, selected: f.key === fonts.mono })) },
      { slot: 'title', label: 'Titles / Chrome', options: FONT_OPTIONS.map(f => ({ ...f, selected: f.key === fonts.title })) },
    ];

    return {
      presets,
      colorEntries,
      animationLevels,
      densityOptions,
      scanlines: prefs.scanlines !== false,
      neonGlow: prefs.neonGlow !== false,
      glitchIntensity: Math.round((prefs.glitchIntensity ?? 0.5) * 100),
      textScale: prefs.textScale ?? 100,
      soundEnabled: prefs.soundEnabled !== false,
      soundVolume: Math.round((prefs.soundVolume ?? 0.5) * 100),
      isDirty: this._isDirty,
      currentPresetLabel: currentPreset.label || prefs.preset,
      fontSelectors,
      MODULE_ID,
      activeTab: this._activeTab || 'presets',
      customPresets: this._getCustomPresets().map((cp, i) => ({
        ...cp,
        primary: cp.colors?.primary || THEME_PRESETS[cp.preset]?.primary || '#F65261',
        secondary: cp.colors?.secondary || THEME_PRESETS[cp.preset]?.secondary || '#19f3f7',
        bgBase: cp.colors?.bgBase || THEME_PRESETS[cp.preset]?.bgBase || '#12121a',
      })),
    };
  }

  // ─── Action Handlers ───

  static _onSelectPreset(event, target) {
    const presetKey = target.closest('[data-preset]')?.dataset.preset;
    if (!presetKey || !THEME_PRESETS[presetKey]) return;

    const preset = THEME_PRESETS[presetKey];
    this._workingPrefs.preset = presetKey;
    // Clear custom color overrides when switching presets
    this._workingPrefs.colors = {
      primary: null, secondary: null, accent: null,
      bgDeep: null, bgBase: null, bgSurface: null,
      bgElevated: null, textPrimary: null, textSecondary: null,
    };
    // Reset fonts to preset defaults
    this._workingPrefs.fonts = {
      display: preset.fontDisplay || 'rajdhani',
      mono: preset.fontMono || 'sharetechmono',
      title: preset.fontTitle || 'orbitron',
    };
    this._isDirty = true;

    // Live preview
    this._applyLive();
    this.render(true);
    this.playSound('click');
  }

  static _onUpdateColor(event, target) {
    const colorKey = target.closest('[data-color-key]')?.dataset.colorKey;
    const input = target.closest('.ncm-color-entry')?.querySelector('input[type="color"]');
    if (!colorKey || !input) return;

    const value = input.value;
    if (!this._workingPrefs.colors) this._workingPrefs.colors = {};
    this._workingPrefs.colors[colorKey] = value;
    this._isDirty = true;

    // Live preview
    this._applyLive();
    this.render(true);
  }

  static _onSetAnimationLevel(event, target) {
    const level = target.closest('[data-level]')?.dataset.level;
    if (!level) return;
    this._workingPrefs.animationLevel = level;
    this._isDirty = true;
    this._applyLive();
    this.render(true);
  }

  static _onToggleScanlines(event, target) {
    this._workingPrefs.scanlines = !this._workingPrefs.scanlines;
    this._isDirty = true;
    this._applyLive();
    this.render(true);
  }

  static _onToggleNeonGlow(event, target) {
    this._workingPrefs.neonGlow = !this._workingPrefs.neonGlow;
    this._isDirty = true;
    this._applyLive();
    this.render(true);
  }

  static _onSetGlitchIntensity(event, target) {
    const slider = this.element.querySelector('[name="glitchIntensity"]');
    if (!slider) return;
    this._workingPrefs.glitchIntensity = parseInt(slider.value) / 100;
    this._isDirty = true;
    this._applyLive();
  }

  static _onSetDensity(event, target) {
    const density = target.closest('[data-density]')?.dataset.density;
    if (!density) return;
    this._workingPrefs.messageDensity = density;
    this._isDirty = true;
    this.render(true);
  }

  static _onSetFont(event, target) {
    // Font selects are wired via addEventListener in _onRender,
    // but this handler exists for any button-based font selection.
    // See _onRender for the actual wiring.
  }

  static async _onResetDefaults(event, target) {
    const confirmed = await Dialog.confirm({
      title: 'Reset Theme',
      content: '<p>Reset all theme settings to defaults?</p>',
    });
    if (!confirmed) return;

    this._workingPrefs = foundry.utils.deepClone(DEFAULTS.PLAYER_THEME);
    this._isDirty = true;
    this._applyLive();
    this.render(true);
    ui.notifications.info('Theme reset to defaults.');
  }

  static async _onSave(event, target) {
    try {
      await this.themeService?.updateTheme(this._workingPrefs);
      this._isDirty = false;
      ui.notifications.info('Theme saved.');
      this.playSound('click');
      this.render(true);
    } catch (error) {
      console.error(`${MODULE_ID} | ThemeCustomizerApp._onSave:`, error);
      ui.notifications.error('Failed to save theme.');
    }
  }

  static async _onCancel(event, target) {
    if (this._isDirty) {
      // Revert live preview
      this.themeService?.applyCurrentTheme();
    }
    this.close();
  }

  // ─── Close Override — Revert if Unsaved ───

  async close(options = {}) {
    if (this._isDirty) {
      this.themeService?.applyCurrentTheme();
    }
    return super.close(options);
  }

  // ─── Render Callback — Wire Inputs ───

  _onRender(context, options) {
    super._onRender(context, options);

    // ── Tab switching (DOM-based, not data-action) ──
    this.element.querySelectorAll('[data-tc-tab]').forEach(tab => {
      tab.addEventListener('click', (e) => {
        const tabId = e.currentTarget.dataset.tcTab;
        if (!tabId) return;
        this._activeTab = tabId;
        // Toggle active tab
        this.element.querySelectorAll('[data-tc-tab]').forEach(t => t.classList.toggle('ncm-tc__tab--active', t.dataset.tcTab === tabId));
        // Toggle active panel
        this.element.querySelectorAll('[data-tc-panel]').forEach(p => p.classList.toggle('ncm-tc__panel--active', p.dataset.tcPanel === tabId));
      });
    });

    // ── Color inputs (live preview) ──
    this.element.querySelectorAll('input[type="color"]').forEach(input => {
      input.addEventListener('input', (e) => {
        const colorKey = e.target.closest('[data-color-key]')?.dataset.colorKey;
        if (!colorKey) return;
        if (!this._workingPrefs.colors) this._workingPrefs.colors = {};
        this._workingPrefs.colors[colorKey] = e.target.value;
        this._isDirty = true;
        this._applyLive();
        // Update hex display
        const hex = e.target.closest('.ncm-tc__color-entry')?.querySelector('.ncm-tc__color-hex');
        if (hex) hex.textContent = e.target.value;
      });
    });

    // ── Glitch slider ──
    const glitchSlider = this.element.querySelector('[name="glitchIntensity"]');
    if (glitchSlider) {
      glitchSlider.addEventListener('input', (e) => {
        this._workingPrefs.glitchIntensity = parseInt(e.target.value) / 100;
        this._isDirty = true;
        this._applyLive();
      });
    }

    // ── Text scale slider ──
    const scaleSlider = this.element.querySelector('[name="textScale"]');
    if (scaleSlider) {
      scaleSlider.addEventListener('input', (e) => {
        this._workingPrefs.textScale = parseInt(e.target.value);
        this._isDirty = true;
        this._applyLive();
        const label = this.element.querySelector('.ncm-tc__scale-val');
        if (label) label.textContent = `${e.target.value}%`;
      });
    }

    // ── Volume slider ──
    const volumeSlider = this.element.querySelector('[name="soundVolume"]');
    if (volumeSlider) {
      volumeSlider.addEventListener('input', (e) => {
        this._workingPrefs.soundVolume = parseInt(e.target.value) / 100;
        this._isDirty = true;
      });
    }

    // ── Font selects ──
    this.element.querySelectorAll('[data-font-slot]').forEach(select => {
      select.addEventListener('change', (e) => {
        const slot = e.target.dataset.fontSlot;
        const key = e.target.value;
        if (!slot || !key) return;
        if (!this._workingPrefs.fonts) this._workingPrefs.fonts = {};
        this._workingPrefs.fonts[slot] = key;
        this._isDirty = true;
        this._applyLive();
      });
    });
  }

  /**
   * Apply theme live and refresh atmosphere on all NCM windows.
   * @private
   */
  _applyLive() {
    this.themeService?.applyTheme(this._workingPrefs);
    // Refresh data attributes on all open NCM windows
    document.querySelectorAll('.ncm-app').forEach(el => {
      el.dataset.ncmScanlines = String(this._workingPrefs.scanlines !== false);
      el.dataset.ncmNeon = String(this._workingPrefs.neonGlow !== false);
      el.dataset.ncmAnimationLevel = this._workingPrefs.animationLevel || 'full';
    });
  }

  // ─── Helpers ───

  /**
   * Get custom presets from client settings.
   * @returns {Array}
   */
  _getCustomPresets() {
    try {
      return game.settings.get(MODULE_ID, 'customPresets') ?? [];
    } catch { return []; }
  }

  /**
   * Save custom presets to client settings.
   * @param {Array} presets
   */
  async _setCustomPresets(presets) {
    await game.settings.set(MODULE_ID, 'customPresets', presets);
  }

  // ─── Custom Preset Actions ───

  static async _onResetColors(event, target) {
    const preset = THEME_PRESETS[this._workingPrefs.preset] || THEME_PRESETS.classic;
    this._workingPrefs.colors = {
      primary: null, secondary: null, accent: null,
      bgDeep: null, bgBase: null, bgSurface: null,
      bgElevated: null, textPrimary: null, textSecondary: null,
    };
    this._isDirty = true;
    this._applyLive();
    this.render(true);
    ui.notifications.info('Colors reset to preset defaults.');
  }

  static async _onSaveAsCustomPreset(event, target) {
    const name = await new Promise(resolve => {
      new Dialog({
        title: 'Save Custom Preset',
        content: `<div style="padding:8px 0;"><label style="font-family:'Share Tech Mono',monospace;font-size:10px;color:#8888a0;text-transform:uppercase;">Preset Name</label><input type="text" id="ncm-preset-name" value="My Custom Theme" style="width:100%;margin-top:4px;padding:6px 8px;background:#0a0a0f;border:1px solid #2a2a45;color:#e0e0e8;font-family:'Rajdhani',sans-serif;font-size:13px;border-radius:2px;" /></div>`,
        buttons: {
          save: { icon: '<i class="fas fa-save"></i>', label: 'Save', callback: (html) => resolve(html.find('#ncm-preset-name').val()?.trim()) },
          cancel: { label: 'Cancel', callback: () => resolve(null) },
        },
        default: 'save',
      }, { classes: ['ncm-pick-dialog'], width: 340 }).render(true);
    });
    if (!name) return;

    const presets = this._getCustomPresets();
    presets.push({ name, ...foundry.utils.deepClone(this._workingPrefs) });
    await this._setCustomPresets(presets);
    this.render(true);
    ui.notifications.info(`Saved custom preset: ${name}`);
  }

  static async _onApplyCustomPreset(event, target) {
    const index = parseInt(target.closest('[data-custom-index]')?.dataset.customIndex);
    const presets = this._getCustomPresets();
    if (isNaN(index) || !presets[index]) return;

    this._workingPrefs = foundry.utils.deepClone(presets[index]);
    delete this._workingPrefs.name; // Strip the name field
    this._isDirty = true;
    this._applyLive();
    this.render(true);
  }

  static async _onOverwriteCustomPreset(event, target) {
    const index = parseInt(target.closest('[data-custom-index]')?.dataset.customIndex);
    const presets = this._getCustomPresets();
    if (isNaN(index) || !presets[index]) return;

    const name = presets[index].name;
    presets[index] = { name, ...foundry.utils.deepClone(this._workingPrefs) };
    await this._setCustomPresets(presets);
    this.render(true);
    ui.notifications.info(`Overwritten preset: ${name}`);
  }

  static async _onDeleteCustomPreset(event, target) {
    const index = parseInt(target.closest('[data-custom-index]')?.dataset.customIndex);
    const presets = this._getCustomPresets();
    if (isNaN(index) || !presets[index]) return;

    const name = presets[index].name;
    const confirmed = await Dialog.confirm({ title: 'Delete Preset', content: `<p>Delete custom preset "${name}"?</p>` });
    if (!confirmed) return;

    presets.splice(index, 1);
    await this._setCustomPresets(presets);
    this.render(true);
    ui.notifications.info(`Deleted preset: ${name}`);
  }

  static _onExportTheme(event, target) {
    const data = JSON.stringify(this._workingPrefs, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ncm-theme-${(this._workingPrefs.preset || 'custom').replace(/\s+/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    ui.notifications.info('Theme exported.');
  }

  static _onImportTheme(event, target) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const imported = JSON.parse(text);
        if (!imported.preset && !imported.colors) {
          ui.notifications.warn('Invalid theme file.');
          return;
        }
        this._workingPrefs = foundry.utils.mergeObject(
          foundry.utils.deepClone(DEFAULTS.PLAYER_THEME),
          imported,
          { inplace: false }
        );
        this._isDirty = true;
        this._applyLive();
        this.render(true);
        ui.notifications.info('Theme imported successfully.');
      } catch (err) {
        console.error(`${MODULE_ID} | Import failed:`, err);
        ui.notifications.error('Failed to import theme file.');
      }
    });
    input.click();
  }

  /**
   * Convert camelCase color key to readable label.
   * @param {string} key
   * @returns {string}
   * @private
   */
  _colorLabel(key) {
    const labels = {
      primary: 'Primary',
      secondary: 'Secondary',
      accent: 'Accent',
      bgDeep: 'Background (Deep)',
      bgBase: 'Background (Base)',
      bgSurface: 'Surface',
      bgElevated: 'Elevated',
      textPrimary: 'Text (Primary)',
      textSecondary: 'Text (Secondary)',
    };
    return labels[key] || key;
  }
}
