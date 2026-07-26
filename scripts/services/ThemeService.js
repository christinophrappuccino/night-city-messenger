/**
 * ThemeService — Player Theme Management
 * @file scripts/services/ThemeService.js
 * @module cyberpunkred-messenger
 * @description Manages theme presets, CSS variable injection, and animation levels.
 *              Loaded during ready phase, applies stored preferences immediately.
 */

import { MODULE_ID, THEME_PRESETS, COLOR_VAR_MAP, CONTRAST_SPREAD, FONT_OPTIONS, DEFAULTS } from '../utils/constants.js';
import { log, adjustLightness } from '../utils/helpers.js';

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
   * Apply a theme's CSS variables to a target element (default: the document
   * root, i.e. the player theme). Pass another element — e.g. a terminal
   * viewer's `.ncm-terminal-viewer` — to theme that subtree in isolation:
   * custom properties resolve from the nearest ancestor, and inline variables
   * beat any stylesheet rule, so the target's preset CSS still supplies
   * whatever this call doesn't write.
   *
   * `prefs.preset: null` skips the player THEME_PRESETS merge entirely — the
   * caller has already resolved its own preset (terminals merge
   * TERMINAL_PRESETS[..].theme into `colors` before calling). Without this,
   * an element-scoped call would silently inherit the *player* classic
   * palette as fallback.
   *
   * Document-global side effects (body effect classes, animation level,
   * wallpaper, the 0.5 glitch default) only run when targeting the root.
   *
   * @param {object} prefs - Theme preferences ({ preset, colors, fonts, textScale, contrast, ... })
   * @param {HTMLElement} [targetEl] - Element to write variables onto (default document root)
   */
  applyTheme(prefs, targetEl = document.documentElement) {
    const root = targetEl;
    const isRoot = targetEl === document.documentElement;
    const preset = prefs.preset === null ? {} : (THEME_PRESETS[prefs.preset] || THEME_PRESETS.classic);

    // Apply colors: player overrides on top of preset. Clear stale inline
    // values when a key resolves to nothing (e.g. a terminal whose preset
    // changed) so the stylesheet fallback shows through again.
    for (const [key, cssVar] of Object.entries(COLOR_VAR_MAP)) {
      const value = prefs.colors?.[key] || preset[key];
      if (value) root.style.setProperty(cssVar, value);
      else root.style.removeProperty(cssVar);
    }

    // Derived variables (glow effects) — only when the source color resolves
    // (element-scoped calls may leave accents to the target's own CSS).
    const glow = (cssVar, color, alpha) => {
      if (color) root.style.setProperty(cssVar, `0 0 10px ${color}${alpha}`);
      else root.style.removeProperty(cssVar);
    };
    glow('--ncm-glow-primary', prefs.colors?.primary || preset.primary, '66');
    glow('--ncm-glow-secondary', prefs.colors?.secondary || preset.secondary, '66');
    glow('--ncm-glow-accent', prefs.colors?.accent || preset.accent, '4d');

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

    if (isRoot) {
      // Effect classes on body
      document.body.classList.toggle('ncm-scanlines', prefs.scanlines !== false);
      document.body.classList.toggle('ncm-neon-glow', prefs.neonGlow !== false);
      // Animation level as data attribute
      document.body.dataset.ncmAnimationLevel = prefs.animationLevel || 'full';
    }

    // Glitch intensity (the 0.5 default is a player-theme convention; an
    // element-scoped call only writes it when explicitly configured)
    if (isRoot || prefs.glitchIntensity !== undefined) {
      root.style.setProperty('--ncm-glitch-intensity', String(prefs.glitchIntensity ?? 0.5));
    }

    // Text scale (80–120, stored as percentage, applied as multiplier)
    const textScale = (prefs.textScale ?? preset.textScale ?? 100) / 100;
    root.style.setProperty('--ncm-text-scale', String(textScale));

    // Readability contrast (70–140, stored as percentage, applied as multiplier).
    // Tone-map the bg/text/border palette in OKLCH lightness space rather than
    // applying a CSS contrast() filter — this leaves images/wallpaper untouched
    // and preserves hue/chroma (neon stays neon). Accents are excluded.
    // Always recomputes from base prefs/preset, so dragging can't compound.
    // (See CONTRAST_SPREAD in constants.js.) A key with no explicit base at
    // 100% contrast is skipped/cleared instead of written: writing the generic
    // fallback would stomp the target's own CSS (a terminal preset's
    // textMuted/border) with brand defaults for no visual gain.
    const contrast = (prefs.contrast ?? preset.contrast ?? 100) / 100;
    for (const { cssVar, key, base } of CONTRAST_SPREAD.vars) {
      const explicit = prefs.colors?.[key] || preset[key];
      if (!explicit && contrast === 1) { root.style.removeProperty(cssVar); continue; }
      root.style.setProperty(cssVar, adjustLightness(explicit || base, contrast, CONTRAST_SPREAD.pivot));
    }

    // Wallpaper — always clear when unset so removing a terminal's wallpaper
    // doesn't leave a stale inline var on the element. Strength (0–100) rides
    // along as an opacity var — real photos at the old fixed 13% over a dark
    // bg read as "wallpaper doesn't work", so it's user-tunable (default 25).
    // The path is ABSOLUTIZED (leading /): a relative url() inside a custom
    // property can resolve against the stylesheet that *uses* the var (i.e.
    // /modules/.../styles/components/ → 404) instead of the document base,
    // depending on where the value was declared — a rooted path is unambiguous.
    if (prefs.wallpaper) {
      let wp = String(prefs.wallpaper);
      if (!/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(wp)) {
        // getRoute honors a configured Foundry route prefix; fall back to a
        // bare leading slash outside Foundry (node sims / headless pages).
        // typeof-guarded — a bare `foundry?.` on an undeclared identifier
        // still ReferenceErrors (the ImagePopout lexical-global lesson).
        const route = (typeof foundry !== 'undefined') ? foundry.utils?.getRoute : null;
        wp = route ? route(wp) : `/${wp}`;
      }
      root.style.setProperty('--ncm-wallpaper', `url('${wp.replace(/'/g, "\\'")}')`);
      root.style.setProperty('--ncm-wallpaper-strength', String((prefs.wallpaperStrength ?? 25) / 100));
    } else if (isRoot) {
      root.style.removeProperty('--ncm-wallpaper');
      root.style.removeProperty('--ncm-wallpaper-strength');
    } else {
      // Element-scoped themes (terminals, preview blocks) are self-contained:
      // write an explicit `none` instead of removing, or the element would
      // INHERIT the player's :root wallpaper — a corp terminal wearing the
      // player's Agent wallpaper.
      root.style.setProperty('--ncm-wallpaper', 'none');
      root.style.setProperty('--ncm-wallpaper-strength', '0');
    }

    log.debug(`Theme applied${isRoot ? '' : ' (element-scoped)'}: ${prefs.preset ?? 'custom'}`);
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
