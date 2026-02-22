/**
 * ThemeService — Player Theme Management
 * @file scripts/services/ThemeService.js
 * @module cyberpunkred-messenger
 * @description Manages theme presets, CSS variable injection, and animation levels.
 *              Loaded during ready phase, applies stored preferences immediately.
 */

import { MODULE_ID, THEME_PRESETS, COLOR_VAR_MAP, DEFAULTS } from '../utils/constants.js';
import { log } from '../utils/helpers.js';

export class ThemeService {
  /**
   * @param {SettingsManager} settingsManager
   * @param {EventBus} eventBus
   */
  constructor(settingsManager, eventBus) {
    this._settings = settingsManager;
    this._eventBus = eventBus;
  }

  /**
   * Initialize — load and apply saved theme
   */
  initialize() {
    this.applyCurrentTheme();
    log.info('ThemeService initialized');
  }

  /**
   * Apply the current user's theme preferences
   */
  applyCurrentTheme() {
    const prefs = this._settings.getTheme();
    this.applyTheme(prefs);
  }

  /**
   * Apply a theme to the document
   * @param {object} prefs - Player theme preferences
   */
  applyTheme(prefs) {
    const root = document.documentElement;
    const preset = THEME_PRESETS[prefs.preset] || THEME_PRESETS.classic;

    // Apply colors: player overrides on top of preset
    for (const [key, cssVar] of Object.entries(COLOR_VAR_MAP)) {
      const value = prefs.colors?.[key] || preset[key];
      if (value) root.style.setProperty(cssVar, value);
    }

    // Derived variables (glow effects)
    const primary = prefs.colors?.primary || preset.primary;
    const secondary = prefs.colors?.secondary || preset.secondary;
    const accent = prefs.colors?.accent || preset.accent;
    root.style.setProperty('--ncm-glow-primary', `0 0 10px ${primary}66`);
    root.style.setProperty('--ncm-glow-secondary', `0 0 10px ${secondary}66`);
    root.style.setProperty('--ncm-glow-accent', `0 0 10px ${accent}4d`);

    // Effect classes on body
    document.body.classList.toggle('ncm-scanlines', prefs.scanlines !== false);
    document.body.classList.toggle('ncm-neon-glow', prefs.neonGlow !== false);

    // Animation level as data attribute
    document.body.dataset.ncmAnimationLevel = prefs.animationLevel || 'full';

    // Glitch intensity
    root.style.setProperty('--ncm-glitch-intensity', String(prefs.glitchIntensity ?? 0.5));

    // Wallpaper
    if (prefs.wallpaper) {
      root.style.setProperty('--ncm-wallpaper', `url('${prefs.wallpaper}')`);
    } else {
      root.style.removeProperty('--ncm-wallpaper');
    }

    log.debug(`Theme applied: ${prefs.preset || 'custom'}`);
  }

  /**
   * Update theme and persist
   * @param {object} updates - Partial theme updates
   */
  async updateTheme(updates) {
    await this._settings.setTheme(updates);
    this.applyCurrentTheme();
    this._eventBus.emit('theme:changed', updates);
  }

  /**
   * Reset to defaults
   */
  async resetTheme() {
    await this._settings.set('playerTheme', foundry.utils.deepClone(DEFAULTS.PLAYER_THEME));
    this.applyCurrentTheme();
    this._eventBus.emit('theme:changed', DEFAULTS.PLAYER_THEME);
  }

  /**
   * Get current animation level
   * @returns {'full'|'reduced'|'off'}
   */
  getAnimationLevel() {
    const prefs = this._settings.getTheme();
    return prefs.animationLevel || 'full';
  }

  /**
   * Get all available presets
   * @returns {object}
   */
  getPresets() {
    return THEME_PRESETS;
  }
}
