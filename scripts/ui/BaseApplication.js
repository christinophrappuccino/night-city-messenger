/**
 * BaseApplication — ApplicationV2 Wrapper for NCM
 * @file scripts/ui/BaseApplication.js
 * @module cyberpunkred-messenger
 * @description Base class for all NCM UI windows. Provides:
 *              - EventBus subscription management with auto-cleanup
 *              - Theme integration (CSS class application)
 *              - Sound integration helpers
 *              - Animation level checking
 *              - Consistent window behavior
 */

import { MODULE_ID, ESSENTIAL_EFFECTS } from '../utils/constants.js';
import { log } from '../utils/helpers.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * @abstract
 */
export class BaseApplication extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @type {Array<{unsubscribe: Function}>} */
  #subscriptions = [];

  /** Unique owner ID for EventBus cleanup */
  get ownerId() {
    return `${this.constructor.name}-${this.id}`;
  }

  // ─── Service Accessors ───

  get eventBus() { return game.nightcity?.eventBus; }
  get stateManager() { return game.nightcity?.stateManager; }
  get settingsManager() { return game.nightcity?.settingsManager; }
  get themeService() { return game.nightcity?.themeService; }
  get soundService() { return game.nightcity?.soundService; }

  // ─── Default Options ───

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

  // ─── Lifecycle ───

  /**
   * Called after the application is rendered to the DOM
   * @param {object} context
   * @param {object} options
   */
  _onRender(context, options) {
    super._onRender(context, options);
    this._setupEventSubscriptions();
  }

  /**
   * Override to set up EventBus subscriptions.
   * Subclasses should call this.subscribe() here.
   * @protected
   */
  _setupEventSubscriptions() {
    // Override in subclasses
  }

  /**
   * Called when the application is closed
   * @param {object} options
   */
  async close(options = {}) {
    this._cleanupSubscriptions();
    return super.close(options);
  }

  // ─── EventBus Helpers ───

  /**
   * Subscribe to an EventBus event with auto-cleanup
   * @param {string} event
   * @param {Function} callback
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
   * Clean up all EventBus subscriptions
   * @private
   */
  _cleanupSubscriptions() {
    for (const handle of this.#subscriptions) {
      handle.unsubscribe();
    }
    this.#subscriptions = [];

    // Belt-and-suspenders: also clean by owner ID
    if (this.eventBus) {
      this.eventBus.removeByOwner(this.ownerId);
    }
  }

  // ─── Animation Helpers ───

  /**
   * Play a CSS animation effect, respecting animation level
   * @param {HTMLElement} element
   * @param {string} effectClass - CSS class to add/remove
   * @param {number} duration - ms
   * @returns {Promise<void>}
   */
  playEffect(element, effectClass, duration) {
    const level = this.themeService?.getAnimationLevel() || 'full';

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
   * Play a sound via SoundService
   * @param {string} soundId
   * @param {object} [options]
   */
  playSound(soundId, options) {
    this.soundService?.play(soundId, options);
  }
}
