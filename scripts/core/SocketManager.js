/**
 * SocketManager — Module Socket Communication
 * @file scripts/core/SocketManager.js
 * @module night-city-messenger
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
   *
   * WHO SENT IT comes from the Foundry server, never from the payload. The
   * server forwards a module socket event as `emit(event, data, this.user.id)`
   * (dist/server/sockets.mjs, handleCustomSocket), so the AUTHENTICATED user id
   * is the listener's second argument. The payload's own `sender` field is
   * written by the sending client and can name anyone, so it is never trusted
   * (audit SEC-01).
   */
  initialize() {
    if (this._initialized) return;

    game.socket.on(`module.${MODULE_ID}`, (message, userId) => {
      this._onMessage(message, userId);
    });

    this._initialized = true;
    log.info('Socket initialized');
  }

  /**
   * Register a handler for a socket operation
   * @param {string} operation - Operation name (from SOCKET_OPS)
   * @param {Function} handler - Handler function receiving (data, senderUserId).
   *   senderUserId is the server-verified id of the user who emitted it, or null
   *   when the transport did not supply one.
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
      // Informational only. Receivers use the server-supplied id instead.
      sender: game.user.id,
      timestamp: Date.now(),
    });
  }

  /**
   * Internal message router
   * @param {object} message - The emitted payload
   * @param {string} [userId] - The server-verified id of the emitting user
   * @private
   */
  _onMessage(message, userId) {
    if (!message || typeof message !== 'object') return;
    const { operation, data } = message;
    if (typeof operation !== 'string') return;

    // The server's id, never message.sender (which the emitting client wrote).
    const sender = (typeof userId === 'string' && userId) ? userId : null;

    // Foundry's server never echoes an emit to its own sender; this only guards
    // against a loopback in tests or a future transport.
    if (sender && sender === game.user?.id) return;

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
