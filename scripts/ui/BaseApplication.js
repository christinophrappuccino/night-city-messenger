/**
 * BaseApplication — ApplicationV2 Wrapper for NCM
 * @file scripts/ui/BaseApplication.js
 * @module cyberpunkred-messenger
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

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * @abstract
 */
export class BaseApplication extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @type {Array<{unsubscribe: Function}>} Managed EventBus subscriptions */
  #subscriptions = [];

  /** @type {boolean} Whether _onFirstRender has fired */
  #hasRenderedOnce = false;

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

    // First render only: one-time setup
    if (!this.#hasRenderedOnce) {
      this.#hasRenderedOnce = true;
      this._setupEventSubscriptions();
      this._onFirstRender(context, options);
    }
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
