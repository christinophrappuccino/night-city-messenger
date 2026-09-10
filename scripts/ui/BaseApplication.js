/**
 * BaseApplication — ApplicationV2 Wrapper for NCM
 * @file scripts/ui/BaseApplication.js
 * @module night-city-messenger
 * @description Base class for all NCM UI windows. Provides:
 *   - EventBus subscription management with auto-cleanup
 *   - Atmosphere data-attribute injection (scanlines, neon, animation level)
 *   - Sound + animation helpers respecting user prefs
 *   - Consistent lifecycle management
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  RULES FOR ALL NCM APPLICATIONS                                    ║
 * ║                                                                    ║
 * ║  1. NEVER touch this.element in the constructor — it doesn't       ║
 * ║     exist yet. Foundry creates it during render().                 ║
 * ║                                                                    ║
 * ║  2. NEVER set position/left/top/width/height/padding/margin via    ║
 * ║     CSS !important on .ncm-app. Foundry sets these as inline       ║
 * ║     styles. Fighting them breaks drag + positioning.               ║
 * ║                                                                    ║
 * ║  3. NEVER override render(). Use _onRender() for post-render       ║
 * ║     logic. Foundry's render pipeline is complex — let it work.     ║
 * ║                                                                    ║
 * ║  4. All DOM manipulation happens in _onRender() or later.          ║
 * ║     Atmosphere, event listeners, custom controls — all post-render.║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import { MODULE_ID, ESSENTIAL_EFFECTS } from '../utils/constants.js';
import { log } from '../utils/helpers.js';
import { getAdminThemePrefs, stampAdminTheme, applyAdminZoom, applyGmView, toggleGmView } from '../utils/adminTheme.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * @abstract
 */
export class BaseApplication extends HandlebarsApplicationMixin(ApplicationV2) {

  /**
   * GM-tool windows opt in with `static ADMIN_THEMED = true`: they then follow
   * the Admin Panel's theme preset + text size instead of the player theme
   * (see utils/adminTheme.js). Player-facing immersive windows stay false.
   * @type {boolean}
   */
  static ADMIN_THEMED = false;

  /**
   * Immersive windows (message viewer, contacts) opt in with
   * `static GM_VIEW_TOGGLE = true`: a GM gets a header-menu toggle between
   * "GM view" (admin theme + text size, for readability) and "player view"
   * (what the players see). One client setting (`gmViewAdminTheme`) drives
   * every such window. Never affects non-GM clients.
   * @type {boolean}
   */
  static GM_VIEW_TOGGLE = false;

  /** @type {Array<{unsubscribe: Function}>} Managed EventBus subscriptions */
  #subscriptions = [];

  /** @type {boolean} Whether _onFirstRender has fired */
  #hasRenderedOnce = false;

  /** @type {boolean} Whether the centralized UI-sound listeners are attached */
  #uiSoundsWired = false;
  /** @type {?Function} document-level click handler (for cleanup) */
  #uiClickHandler = null;

  /** Unique owner ID for EventBus cleanup */
  get ownerId() {
    return `${this.constructor.name}-${this.id}`;
  }

  // ═══════════════════════════════════════════════════════════
  //  Service Accessors
  // ═══════════════════════════════════════════════════════════

  get eventBus() { return game.nightcity?.eventBus; }
  get stateManager() { return game.nightcity?.stateManager; }
  get settingsManager() { return game.nightcity?.settingsManager; }
  get themeService() { return game.nightcity?.themeService; }
  get soundService() { return game.nightcity?.soundService; }

  // ═══════════════════════════════════════════════════════════
  //  Static Configuration
  // ═══════════════════════════════════════════════════════════

  static DEFAULT_OPTIONS = {
    classes: ['ncm-app'],
    tag: 'div',
    window: {
      resizable: true,
      minimizable: true,
    },
    position: {
      width: 700,
      height: 500,
    },
  };

  // ═══════════════════════════════════════════════════════════
  //  Lifecycle — _onRender
  //  This is THE place for all post-render DOM work.
  //  Called after every render (initial + subsequent).
  // ═══════════════════════════════════════════════════════════

  /**
   * Called after the application is rendered to the DOM.
   * @param {object} context — Template context data
   * @param {object} options — Render options
   */
  _onRender(context, options) {
    // Let Foundry/parent do its thing first
    super._onRender(context, options);

    // Apply atmosphere data attributes (scanlines, neon, animation level)
    this._applyAtmosphere();

    // GM tools: the admin theme overrides the atmosphere just applied.
    // Immersive windows with the GM-view toggle follow the client setting.
    if (this.constructor.ADMIN_THEMED) this._applyAdminTheme();
    else if (this.constructor.GM_VIEW_TOGGLE) {
      const on = applyGmView(this.element, { applyZoom: (pct) => this._applyAdminTextScale(pct) });
      if (!on) this._applyAdminTextScale(100); // shrink the frame back if it was scaled
    }

    // First render only: one-time setup
    if (!this.#hasRenderedOnce) {
      this.#hasRenderedOnce = true;
      this._wireUiSounds();
      this.playSound('open');
      this._setupEventSubscriptions();
      this._onFirstRender(context, options);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Centralized UI sound feedback
  //  Every NCM window gets a consistent click sound on its actionable
  //  controls, plus open/close — wired ONCE here so apps don't sprinkle
  //  play('click') by hand (which drifted inconsistent). (Hover SFX was
  //  intentionally removed.) Domain/event sounds (decrypt, send, hack…)
  //  still layer on top.
  // ═══════════════════════════════════════════════════════════

  /**
   * Attach a delegated click sound listener for this app's controls.
   * Uses document-level capture + a containment guard (the project's blessed
   * pattern — element-level listeners are unreliable in Foundry), and is torn
   * down in close(). Only the app whose element contains the target plays, so
   * multiple open windows never double up.
   * @private
   */
  _wireUiSounds() {
    if (this.#uiSoundsWired) return;
    this.#uiSoundsWired = true;

    const ACTIONABLE = 'button, [data-action], a[href], .ncm-clickable, [role="button"]';
    const inApp = (node) => node instanceof Node && !!this.element?.contains(node);
    const actionable = (target) => {
      const el = target?.closest?.(ACTIONABLE);
      if (!el || !inApp(el)) return null;
      if (el.disabled || el.classList.contains('disabled')) return null;
      return el;
    };

    this.#uiClickHandler = (ev) => {
      if (!inApp(ev.target)) return;
      if (actionable(ev.target)) this.soundService?.playClick();
    };

    document.addEventListener('click', this.#uiClickHandler, true);
  }

  /**
   * Called only on the very first render. Override in subclasses for
   * one-time DOM setup (event listeners, drag handles, etc).
   * @param {object} context
   * @param {object} options
   * @protected
   */
  _onFirstRender(context, options) {
    // Override in subclasses
  }

  /**
   * Override to set up EventBus subscriptions.
   * Called once on first render. Subclasses should call this.subscribe().
   * @protected
   */
  _setupEventSubscriptions() {
    // Override in subclasses
  }

  // ═══════════════════════════════════════════════════════════
  //  Lifecycle — Close
  // ═══════════════════════════════════════════════════════════

  /**
   * Close the application and clean up all subscriptions.
   * @param {object} options
   */
  async close(options = {}) {
    this.playSound('close');
    if (this.#uiClickHandler) document.removeEventListener('click', this.#uiClickHandler, true);
    this.#uiClickHandler = null;
    this.#uiSoundsWired = false;
    this._cleanupSubscriptions();
    return super.close(options);
  }

  // ═══════════════════════════════════════════════════════════
  //  Atmosphere — Data Attribute Injection
  // ═══════════════════════════════════════════════════════════

  /**
   * Apply atmosphere data attributes to the application element.
   * These gate CSS atmosphere layers without body-class toggling.
   *
   * Sets on this.element:
   *   data-ncm-scanlines       = "true" | "false"
   *   data-ncm-neon            = "true" | "false"
   *   data-ncm-animation-level = "full" | "reduced" | "off"
   *
   * Safe to call repeatedly — fails silently if element or prefs missing.
   * @protected
   */
  _applyAtmosphere() {
    const el = this.element;
    if (!el) return;

    try {
      const prefs = this.settingsManager?.getTheme?.() ?? {};

      el.dataset.ncmScanlines = String(prefs.scanlines !== false);
      el.dataset.ncmNeon = String(prefs.neonGlow !== false);
      el.dataset.ncmAnimationLevel = prefs.animationLevel || 'full';

    } catch (err) {
      // Non-fatal — atmosphere is progressive enhancement
      log.debug('BaseApplication._applyAtmosphere(): prefs unavailable, using defaults');
      el.dataset.ncmScanlines = 'true';
      el.dataset.ncmNeon = 'true';
      el.dataset.ncmAnimationLevel = 'full';
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Admin theme (GM tools only — see static ADMIN_THEMED)
  // ═══════════════════════════════════════════════════════════

  /**
   * Apply the Admin Panel's theme preset + text size to this window. Runs
   * after _applyAtmosphere so it wins. Safe to call from a subclass that
   * overrides _onRender without calling super (DataShardComposer does).
   * @protected
   */
  _applyAdminTheme() {
    const el = this.element;
    if (!el) return;
    const prefs = getAdminThemePrefs();
    stampAdminTheme(el, prefs);
    this._applyAdminTextScale(prefs.textScale);
  }

  /**
   * Text-size zoom on `.window-content` (frame/header stay 1:1) and a
   * one-time frame resize by the same ratio so the layout keeps its
   * proportions instead of squeezing into fewer layout pixels.
   * @param {number} pct — 100–150
   * @protected
   */
  _applyAdminTextScale(pct) {
    const el = this.element;
    if (!el) return;
    const clamped = Math.min(150, Math.max(100, Number(pct) || 100));
    applyAdminZoom(el.querySelector('.window-content'), clamped);
    const prev = this._appliedTextScale ?? 100;
    if (clamped !== prev) {
      const ratio = clamped / prev;
      const { width, height } = this.position ?? {};
      const next = {};
      if (typeof width === 'number' && width > 0) next.width = Math.round(width * ratio);
      if (typeof height === 'number' && height > 0) next.height = Math.round(height * ratio);
      if (Object.keys(next).length) {
        try { this.setPosition(next); } catch { /* non-fatal */ }
      }
      this._appliedTextScale = clamped;
    }
  }

  /**
   * Header ⋮ menu: GM-view windows offer the GM a theme toggle.
   * @override
   */
  _getHeaderControls() {
    // The GM-view toggle is the visible header BUTTON injected by
    // syncGmViewControls — it is deliberately NOT also a ⋮-menu entry (the
    // menu duplicated the affordance; dev dropped it 2026-09-10). Always
    // return a COPY: super hands back the shared options array.
    return [...(super._getHeaderControls?.() ?? [])];
  }

  /**
   * Actions without an explicit DEFAULT_OPTIONS handler land here (header
   * controls included). Subclasses that override this should call super.
   * @override
   */
  _onClickAction(event, target) {
    if (target?.dataset?.action === 'toggleGmView') { toggleGmView(); return; }
    return super._onClickAction?.(event, target);
  }

  // ═══════════════════════════════════════════════════════════
  //  EventBus Helpers
  // ═══════════════════════════════════════════════════════════

  /**
   * Subscribe to an EventBus event with auto-cleanup on close.
   * @param {string} event — Event name
   * @param {Function} callback — Handler function
   */
  subscribe(event, callback) {
    if (!this.eventBus) {
      log.warn(`Cannot subscribe to '${event}' — EventBus not available`);
      return;
    }
    const handle = this.eventBus.on(event, callback, this.ownerId);
    this.#subscriptions.push(handle);
  }

  /**
   * Debounced render — coalesces rapid EventBus events into
   * a single render pass. Use in subscriptions instead of
   * () => this.render() when the event source may fire in bursts
   * (e.g. GM toggling multiple networks, bulk message operations).
   *
   * 150ms: fast enough to feel instant, slow enough to batch.
   * @type {Function}
   * @protected
   */
  _debouncedRender = foundry.utils.debounce(() => {
    if (this.rendered && !this._animationActive) this.render();
  }, 150);

  /**
   * Clean up all EventBus subscriptions.
   * @private
   */
  _cleanupSubscriptions() {
    for (const handle of this.#subscriptions) {
      try {
        handle.unsubscribe();
      } catch (err) {
        log.debug(`Subscription cleanup error: ${err.message}`);
      }
    }
    this.#subscriptions = [];

    // Belt-and-suspenders: also clean by owner ID
    if (this.eventBus?.removeByOwner) {
      this.eventBus.removeByOwner(this.ownerId);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Animation Helpers
  // ═══════════════════════════════════════════════════════════

  /**
   * Play a CSS animation effect, respecting animation level preference.
   * @param {HTMLElement} element — Target element
   * @param {string} effectClass — CSS class to toggle
   * @param {number} duration — Duration in ms
   * @returns {Promise<void>}
   */
  playEffect(element, effectClass, duration) {
    const level = this.themeService?.getAnimationLevel?.() || 'full';

    if (level === 'off') return Promise.resolve();
    if (level === 'reduced' && !ESSENTIAL_EFFECTS.includes(effectClass)) {
      return Promise.resolve();
    }

    return new Promise(resolve => {
      element.classList.add(effectClass);
      setTimeout(() => {
        element.classList.remove(effectClass);
        resolve();
      }, duration);
    });
  }

  /**
   * Play a sound via SoundService.
   * @param {string} soundId — Sound identifier from SOUND_PATHS
   * @param {object} [options] — { volume, loop }
   */
  playSound(soundId, options) {
    this.soundService?.play(soundId, options);
  }

  // ═══════════════════════════════════════════════════════════
  //  Utility
  // ═══════════════════════════════════════════════════════════

  /**
   * Get the current animation level.
   * @returns {'full'|'reduced'|'off'}
   */
  get animationLevel() {
    return this.themeService?.getAnimationLevel?.() || 'full';
  }

  /**
   * Check if animations are enabled (full or reduced).
   * @returns {boolean}
   */
  get animationsEnabled() {
    return this.animationLevel !== 'off';
  }
}
