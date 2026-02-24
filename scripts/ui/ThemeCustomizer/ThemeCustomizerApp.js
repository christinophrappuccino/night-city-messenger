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

import { MODULE_ID, TEMPLATES, THEME_PRESETS, COLOR_VAR_MAP, DEFAULTS } from '../../utils/constants.js';
import { log } from '../../utils/helpers.js';
import { BaseApplication } from '../BaseApplication.js';

export class ThemeCustomizerApp extends BaseApplication {

  /** @type {object} Working copy of theme preferences for live preview */
  _workingPrefs = null;

  /** @type {boolean} Whether unsaved changes exist */
  _isDirty = false;

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
      resetDefaults: ThemeCustomizerApp._onResetDefaults,
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

    return {
      presets,
      colorEntries,
      animationLevels,
      densityOptions,
      scanlines: prefs.scanlines !== false,
      neonGlow: prefs.neonGlow !== false,
      glitchIntensity: Math.round((prefs.glitchIntensity ?? 0.5) * 100),
      soundEnabled: prefs.soundEnabled !== false,
      soundVolume: Math.round((prefs.soundVolume ?? 0.5) * 100),
      isDirty: this._isDirty,
      currentPresetLabel: currentPreset.label || prefs.preset,
      MODULE_ID,
    };
  }

  // ─── Action Handlers ───

  static _onSelectPreset(event, target) {
    const presetKey = target.closest('[data-preset]')?.dataset.preset;
    if (!presetKey || !THEME_PRESETS[presetKey]) return;

    this._workingPrefs.preset = presetKey;
    // Clear custom color overrides when switching presets
    this._workingPrefs.colors = {
      primary: null, secondary: null, accent: null,
      bgDeep: null, bgBase: null, bgSurface: null,
      bgElevated: null, textPrimary: null, textSecondary: null,
    };
    this._isDirty = true;

    // Live preview
    this.themeService?.applyTheme(this._workingPrefs);
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
    this.themeService?.applyTheme(this._workingPrefs);
    this.render(true);
  }

  static _onSetAnimationLevel(event, target) {
    const level = target.closest('[data-level]')?.dataset.level;
    if (!level) return;
    this._workingPrefs.animationLevel = level;
    this._isDirty = true;
    this.themeService?.applyTheme(this._workingPrefs);
    this.render(true);
  }

  static _onToggleScanlines(event, target) {
    this._workingPrefs.scanlines = !this._workingPrefs.scanlines;
    this._isDirty = true;
    this.themeService?.applyTheme(this._workingPrefs);
    this.render(true);
  }

  static _onToggleNeonGlow(event, target) {
    this._workingPrefs.neonGlow = !this._workingPrefs.neonGlow;
    this._isDirty = true;
    this.themeService?.applyTheme(this._workingPrefs);
    this.render(true);
  }

  static _onSetGlitchIntensity(event, target) {
    const slider = this.element.querySelector('[name="glitchIntensity"]');
    if (!slider) return;
    this._workingPrefs.glitchIntensity = parseInt(slider.value) / 100;
    this._isDirty = true;
    this.themeService?.applyTheme(this._workingPrefs);
  }

  static _onSetDensity(event, target) {
    const density = target.closest('[data-density]')?.dataset.density;
    if (!density) return;
    this._workingPrefs.messageDensity = density;
    this._isDirty = true;
    this.render(true);
  }

  static async _onResetDefaults(event, target) {
    const confirmed = await Dialog.confirm({
      title: 'Reset Theme',
      content: '<p>Reset all theme settings to defaults?</p>',
    });
    if (!confirmed) return;

    this._workingPrefs = foundry.utils.deepClone(DEFAULTS.PLAYER_THEME);
    this._isDirty = true;
    this.themeService?.applyTheme(this._workingPrefs);
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

    // Wire color inputs for live preview
    this.element.querySelectorAll('input[type="color"]').forEach(input => {
      input.addEventListener('input', (e) => {
        const colorKey = e.target.closest('[data-color-key]')?.dataset.colorKey;
        if (!colorKey) return;
        if (!this._workingPrefs.colors) this._workingPrefs.colors = {};
        this._workingPrefs.colors[colorKey] = e.target.value;
        this._isDirty = true;
        this.themeService?.applyTheme(this._workingPrefs);
      });
    });

    // Wire glitch slider
    const glitchSlider = this.element.querySelector('[name="glitchIntensity"]');
    if (glitchSlider) {
      glitchSlider.addEventListener('input', (e) => {
        this._workingPrefs.glitchIntensity = parseInt(e.target.value) / 100;
        this._isDirty = true;
        this.themeService?.applyTheme(this._workingPrefs);
      });
    }

    // Wire volume slider
    const volumeSlider = this.element.querySelector('[name="soundVolume"]');
    if (volumeSlider) {
      volumeSlider.addEventListener('input', (e) => {
        this._workingPrefs.soundVolume = parseInt(e.target.value) / 100;
        this._isDirty = true;
      });
    }
  }

  // ─── Helpers ───

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
