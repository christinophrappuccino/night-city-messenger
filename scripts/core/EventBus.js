/**
 * EventBus — Decoupled pub/sub communication
 * @file scripts/core/EventBus.js
 * @module cyberpunkred-messenger
 * @description Singleton event bus for module-wide communication.
 *              Supports namespaced subscriptions for guaranteed cleanup.
 */

import { MODULE_SHORT } from '../utils/constants.js';

export class EventBus {
  /** @type {EventBus|null} */
  static #instance = null;

  /** @returns {EventBus} */
  static getInstance() {
    if (!EventBus.#instance) {
      EventBus.#instance = new EventBus();
    }
    return EventBus.#instance;
  }

  constructor() {
    if (EventBus.#instance) {
      throw new Error('EventBus is a singleton — use EventBus.getInstance()');
    }
    /** @type {Map<string, Set<{ callback: Function, owner: string|null }>>} */
    this._listeners = new Map();
  }

  /**
   * Subscribe to an event
   * @param {string} event - Event name
   * @param {Function} callback - Handler function
   * @param {string} [owner] - Owner ID for grouped cleanup (e.g., app instance ID)
   * @returns {{ unsubscribe: Function }} Cleanup handle
   */
  on(event, callback, owner = null) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    const entry = { callback, owner };
    this._listeners.get(event).add(entry);

    return {
      unsubscribe: () => {
        this._listeners.get(event)?.delete(entry);
      },
    };
  }

  /**
   * Emit an event to all listeners
   * @param {string} event - Event name
   * @param {*} data - Event payload
   */
  emit(event, data) {
    const listeners = this._listeners.get(event);
    if (!listeners || listeners.size === 0) return;

    for (const { callback } of listeners) {
      try {
        callback(data);
      } catch (error) {
        console.error(`${MODULE_SHORT} | EventBus error in '${event}' handler:`, error);
      }
    }
  }

  /**
   * Remove all subscriptions belonging to an owner
   * @param {string} owner - Owner ID to clean up
   */
  removeByOwner(owner) {
    for (const [event, listeners] of this._listeners) {
      for (const entry of listeners) {
        if (entry.owner === owner) {
          listeners.delete(entry);
        }
      }
      if (listeners.size === 0) {
        this._listeners.delete(event);
      }
    }
  }

  /**
   * Get count of listeners (for diagnostics)
   * @returns {number}
   */
  get listenerCount() {
    let count = 0;
    for (const listeners of this._listeners.values()) {
      count += listeners.size;
    }
    return count;
  }

  /**
   * Get all registered event names (for diagnostics)
   * @returns {string[]}
   */
  get eventNames() {
    return [...this._listeners.keys()];
  }
}
