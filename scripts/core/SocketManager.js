/**
 * SocketManager — Module Socket Communication
 * @file scripts/core/SocketManager.js
 * @module cyberpunkred-messenger
 * @description Singleton wrapper around Foundry's module socket.
 *              Routes incoming operations to registered handlers.
 */

import { MODULE_ID } from '../utils/constants.js';
import { log } from '../utils/helpers.js';

export class SocketManager {
  static #instance = null;

  static getInstance() {
    if (!SocketManager.#instance) {
      SocketManager.#instance = new SocketManager();
    }
    return SocketManager.#instance;
  }

  constructor() {
    if (SocketManager.#instance) {
      throw new Error('SocketManager is a singleton — use SocketManager.getInstance()');
    }
    /** @type {Map<string, Function>} */
    this._handlers = new Map();
    this._initialized = false;
  }

  /**
   * Initialize the socket listener. Called during ready hook.
   */
  initialize() {
    if (this._initialized) return;

    game.socket.on(`module.${MODULE_ID}`, (data) => {
      this._onMessage(data);
    });

    this._initialized = true;
    log.info('Socket initialized');
  }

  /**
   * Register a handler for a socket operation
   * @param {string} operation - Operation name (from SOCKET_OPS)
   * @param {Function} handler - Handler function receiving (data)
   */
  register(operation, handler) {
    this._handlers.set(operation, handler);
  }

  /**
   * Emit a socket message to all other clients
   * @param {string} operation - Operation name
   * @param {object} data - Payload
   */
  emit(operation, data = {}) {
    game.socket.emit(`module.${MODULE_ID}`, {
      operation,
      data,
      sender: game.user.id,
      timestamp: Date.now(),
    });
  }

  /**
   * Internal message router
   * @param {object} message
   * @private
   */
  _onMessage(message) {
    const { operation, data, sender } = message;

    // Don't process own messages
    if (sender === game.user.id) return;

    const handler = this._handlers.get(operation);
    if (handler) {
      try {
        handler(data, sender);
      } catch (error) {
        log.error(`Socket handler error for '${operation}':`, error);
      }
    } else {
      log.debug(`No handler for socket operation: ${operation}`);
    }
  }

  /**
   * Check if socket is active
   * @returns {boolean}
   */
  get isActive() {
    return this._initialized;
  }
}
