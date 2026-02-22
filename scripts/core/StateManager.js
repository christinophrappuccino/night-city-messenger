/**
 * StateManager — Global runtime state container
 * @file scripts/core/StateManager.js
 * @module cyberpunkred-messenger
 * @description Singleton for global module state (NOT per-window UI state).
 *              Tracks network status, connection state, and system-wide flags.
 *              Per-window state belongs on the Application instance.
 */

import { MODULE_SHORT } from '../utils/constants.js';

export class StateManager {
  static #instance = null;

  static getInstance() {
    if (!StateManager.#instance) {
      StateManager.#instance = new StateManager();
    }
    return StateManager.#instance;
  }

  constructor() {
    if (StateManager.#instance) {
      throw new Error('StateManager is a singleton — use StateManager.getInstance()');
    }
    /** @type {Map<string, *>} */
    this._state = new Map();
    /** @type {EventBus|null} */
    this._eventBus = null;
  }

  /**
   * Connect to EventBus for state change notifications
   * @param {EventBus} eventBus
   */
  setEventBus(eventBus) {
    this._eventBus = eventBus;
  }

  /**
   * Get a state value
   * @param {string} key
   * @param {*} [defaultValue]
   * @returns {*}
   */
  get(key, defaultValue = undefined) {
    return this._state.has(key) ? this._state.get(key) : defaultValue;
  }

  /**
   * Set a state value
   * @param {string} key
   * @param {*} value
   */
  set(key, value) {
    const previous = this._state.get(key);
    this._state.set(key, value);
    if (this._eventBus && previous !== value) {
      this._eventBus.emit(`state:${key}`, { key, value, previous });
    }
  }

  /**
   * Check if a key exists
   * @param {string} key
   * @returns {boolean}
   */
  has(key) {
    return this._state.has(key);
  }

  /**
   * Delete a state key
   * @param {string} key
   */
  delete(key) {
    this._state.delete(key);
  }

  /**
   * Get all state as a plain object (for diagnostics)
   * @returns {object}
   */
  toObject() {
    return Object.fromEntries(this._state);
  }
}
