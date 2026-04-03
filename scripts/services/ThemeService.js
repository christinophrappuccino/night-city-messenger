/**
 * ThemeService — Player Theme Management
 * @file scripts/services/ThemeService.js
 * @module cyberpunkred-messenger
 * @description Manages theme presets, CSS variable injection, and animation levels.
 *              Loaded during ready phase, applies stored preferences immediately.
 */

import { MODULE_ID, THEME_PRESETS, COLOR_VAR_MAP, FONT_OPTIONS, DEFAULTS } from '../utils/constants.js';
import { log } from '../utils/helpers.js';

export class ThemeService {
  /**
   * @param {SettingsManager} settingsManager
   * @param {EventBus} eventBus
   */
  constructor(settingsManager, eventBus) {
    this._settings = settingsManager;
    this._eventBus = eventBus;
    /** @type {Set<string>} Tracks which Google Font families have been injected */
    this._loadedFonts = new Set();
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

    // Apply fonts: user overrides on top of preset defaults
    const presetFonts = {
      display: preset.fontDisplay || 'rajdhani',
      mono: preset.fontMono || 'sharetechmono',
      title: preset.fontTitle || 'orbitron',
    };
    const effectiveFonts = {
      display: prefs.fonts?.display || presetFonts.display,
      mono: prefs.fonts?.mono || presetFonts.mono,
      title: prefs.fonts?.title || presetFonts.title,
    };
    this._applyFonts(effectiveFonts, root);

    // Effect classes on body
    document.body.classList.toggle('ncm-scanlines', prefs.scanlines !== false);
    document.body.classList.toggle('ncm-neon-glow', prefs.neonGlow !== false);

    // Animation level as data attribute
    document.body.dataset.ncmAnimationLevel = prefs.animationLevel || 'full';

    // Glitch intensity
    root.style.setProperty('--ncm-glitch-intensity', String(prefs.glitchIntensity ?? 0.5));

    // Text scale (80–120, stored as percentage, applied as multiplier)
    const textScale = (prefs.textScale ?? preset.textScale ?? 100) / 100;
    root.style.setProperty('--ncm-text-scale', String(textScale));

    // Wallpaper
    if (prefs.wallpaper) {
      root.style.setProperty('--ncm-wallpaper', `url('${prefs.wallpaper}')`);
    } else {
      root.style.removeProperty('--ncm-wallpaper');
    }

    log.debug(`Theme applied: ${prefs.preset || 'custom'}`);
  }

  /**
   * Apply font selections to CSS variables and load Google Fonts if needed.
   * @param {object} fonts - { display, mono, title } keys from FONT_OPTIONS
   * @param {HTMLElement} root - document.documentElement
   * @private
   */
  _applyFonts(fonts, root) {
    const slots = [
      { key: 'display', cssVar: '--ncm-font-display', alsoSet: ['--ncm-font-body'] },
      { key: 'mono', cssVar: '--ncm-font-mono', alsoSet: [] },
      { key: 'title', cssVar: '--ncm-font-title', alsoSet: ['--ncm-font-ui'] },
    ];

    for (const slot of slots) {
      const selectedKey = fonts[slot.key];
      const entry = FONT_OPTIONS.find(o => o.key === selectedKey) || FONT_OPTIONS.find(o => o.key === 'rajdhani');
      if (!entry) continue;

      // Load from Google Fonts if needed
      if (entry.google) this._loadGoogleFont(entry.google, entry.label);

      // Set CSS variable
      root.style.setProperty(slot.cssVar, entry.family);
      for (const alias of slot.alsoSet) {
        root.style.setProperty(alias, entry.family);
      }
    }
  }

  /**
   * Inject a Google Fonts stylesheet link if not already loaded.
   * @param {string} googleParam - Google Fonts URL parameter (e.g. 'Exo+2:wght@400;600')
   * @param {string} label - Human label for logging
   * @private
   */
  _loadGoogleFont(googleParam, label) {
    if (this._loadedFonts.has(googleParam)) return;
    this._loadedFonts.add(googleParam);

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${googleParam}&display=swap`;
    document.head.appendChild(link);
    log.debug(`Loaded Google Font: ${label}`);
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
