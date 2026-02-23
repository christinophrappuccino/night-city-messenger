/**
 * SecurityService
 * @file scripts/services/SecurityService.js
 * @module cyberpunkred-messenger
 * @description Lockout tracking and attempt management for network authentication
 *              and data shard security. Maintains per-actor security state including
 *              attempt counts, lockout timers, and cooldown management.
 *
 *              This service handles the "meta" security layer — tracking attempts
 *              and enforcing lockouts. The actual authentication logic lives in
 *              NetworkService (for networks) and DataShardService (for shards).
 *
 *              Depends on: EventBus, StateManager
 *              Initialization priority: ready/40
 */

import { MODULE_ID, EVENTS } from '../utils/constants.js';
import { log } from '../utils/helpers.js';

export class SecurityService {

  constructor() {
    this.eventBus = game.nightcity.eventBus;
    this.stateManager = game.nightcity.stateManager;

    /**
     * Per-actor, per-target lockout state.
     * Key format: `${actorId}::${targetId}` where targetId is a networkId or itemId.
     * @type {Map<string, SecurityState>}
     */
    this._states = new Map();

    /**
     * Active lockout timers for auto-expiry.
     * @type {Map<string, number>} key → setTimeout ID
     */
    this._timers = new Map();

    this._initialized = true;
    log.info('SecurityService initialized');
  }

  // ═══════════════════════════════════════════════════════════
  //  Types
  // ═══════════════════════════════════════════════════════════

  /**
   * @typedef {Object} SecurityState
   * @property {number} attempts - Number of failed attempts
   * @property {number} maxAttempts - Max allowed before lockout
   * @property {number|null} lockoutUntil - Timestamp (ms) when lockout expires
   * @property {number} lockoutDuration - Duration in ms for lockouts
   * @property {string} targetId - The network or item ID
   * @property {string} actorId - The actor attempting access
   */

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API — State Queries
  // ═══════════════════════════════════════════════════════════

  /**
   * Get the security state for an actor + target pair.
   * @param {string} actorId
   * @param {string} targetId - Network ID or Item ID
   * @returns {SecurityState}
   */
  getState(actorId, targetId) {
    const key = this._key(actorId, targetId);
    return this._states.get(key) ?? this._defaultState(actorId, targetId);
  }

  /**
   * Check if an actor is currently locked out from a target.
   * @param {string} actorId
   * @param {string} targetId
   * @returns {boolean}
   */
  isLockedOut(actorId, targetId) {
    const state = this.getState(actorId, targetId);
    if (!state.lockoutUntil) return false;

    if (Date.now() >= state.lockoutUntil) {
      // Lockout expired — clear it
      this._clearLockout(actorId, targetId);
      return false;
    }

    return true;
  }

  /**
   * Get remaining lockout time in ms.
   * @param {string} actorId
   * @param {string} targetId
   * @returns {number} 0 if not locked out
   */
  getLockoutRemaining(actorId, targetId) {
    const state = this.getState(actorId, targetId);
    if (!state.lockoutUntil) return 0;

    const remaining = state.lockoutUntil - Date.now();
    return remaining > 0 ? remaining : 0;
  }

  /**
   * Get remaining attempts before lockout.
   * @param {string} actorId
   * @param {string} targetId
   * @returns {number}
   */
  getRemainingAttempts(actorId, targetId) {
    const state = this.getState(actorId, targetId);
    return Math.max(0, state.maxAttempts - state.attempts);
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API — Attempt Recording
  // ═══════════════════════════════════════════════════════════

  /**
   * Initialize tracking for an actor + target with specific limits.
   * Call this before the first attempt to set maxAttempts and lockoutDuration.
   * @param {string} actorId
   * @param {string} targetId
   * @param {object} config
   * @param {number} [config.maxAttempts=3]
   * @param {number} [config.lockoutDuration=3600000]
   */
  initTracking(actorId, targetId, config = {}) {
    const key = this._key(actorId, targetId);
    const existing = this._states.get(key);

    if (existing) {
      // Update limits but preserve attempts
      existing.maxAttempts = config.maxAttempts ?? existing.maxAttempts;
      existing.lockoutDuration = config.lockoutDuration ?? existing.lockoutDuration;
    } else {
      this._states.set(key, {
        actorId,
        targetId,
        attempts: 0,
        maxAttempts: config.maxAttempts ?? 3,
        lockoutUntil: null,
        lockoutDuration: config.lockoutDuration ?? 3600000,
      });
    }
  }

  /**
   * Record a failed attempt. Returns the updated state.
   * Automatically triggers lockout if maxAttempts reached.
   * @param {string} actorId
   * @param {string} targetId
   * @returns {{ state: SecurityState, lockedOut: boolean }}
   */
  recordFailedAttempt(actorId, targetId) {
    const key = this._key(actorId, targetId);
    let state = this._states.get(key);

    if (!state) {
      state = this._defaultState(actorId, targetId);
      this._states.set(key, state);
    }

    state.attempts++;

    // Check for lockout
    if (state.attempts >= state.maxAttempts) {
      state.lockoutUntil = Date.now() + state.lockoutDuration;
      this._startLockoutTimer(actorId, targetId, state.lockoutDuration);

      this.eventBus.emit(EVENTS.NETWORK_LOCKOUT, {
        actorId,
        targetId,
        lockoutUntil: state.lockoutUntil,
        duration: state.lockoutDuration,
      });

      log.info(`Lockout triggered: actor ${actorId} → target ${targetId} for ${state.lockoutDuration}ms`);
      return { state: { ...state }, lockedOut: true };
    }

    return { state: { ...state }, lockedOut: false };
  }

  /**
   * Record a successful attempt. Resets the attempt counter.
   * @param {string} actorId
   * @param {string} targetId
   */
  recordSuccess(actorId, targetId) {
    const key = this._key(actorId, targetId);
    const state = this._states.get(key);
    if (state) {
      state.attempts = 0;
      state.lockoutUntil = null;
    }
    this._clearTimer(key);
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API — Resets (GM Operations)
  // ═══════════════════════════════════════════════════════════

  /**
   * Reset security state for an actor + target pair. GM only.
   * @param {string} actorId
   * @param {string} targetId
   */
  resetState(actorId, targetId) {
    const key = this._key(actorId, targetId);
    this._states.delete(key);
    this._clearTimer(key);
    log.debug(`Security state reset: ${key}`);
  }

  /**
   * Reset all security states for a target. GM only.
   * Useful when a network password changes or a shard is relocked.
   * @param {string} targetId
   */
  resetAllForTarget(targetId) {
    const toDelete = [];
    for (const [key, state] of this._states) {
      if (state.targetId === targetId) {
        toDelete.push(key);
      }
    }
    for (const key of toDelete) {
      this._states.delete(key);
      this._clearTimer(key);
    }
    log.debug(`Security states reset for target: ${targetId} (${toDelete.length} cleared)`);
  }

  /**
   * Reset all security states for an actor. GM only.
   * @param {string} actorId
   */
  resetAllForActor(actorId) {
    const toDelete = [];
    for (const [key, state] of this._states) {
      if (state.actorId === actorId) {
        toDelete.push(key);
      }
    }
    for (const key of toDelete) {
      this._states.delete(key);
      this._clearTimer(key);
    }
    log.debug(`Security states reset for actor: ${actorId} (${toDelete.length} cleared)`);
  }

  /**
   * Clear ALL security states. GM only.
   */
  resetAll() {
    for (const key of this._timers.keys()) {
      this._clearTimer(key);
    }
    this._states.clear();
    log.info('All security states cleared');
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API — Reporting
  // ═══════════════════════════════════════════════════════════

  /**
   * Get all active lockouts.
   * @returns {SecurityState[]}
   */
  getActiveLockouts() {
    const now = Date.now();
    const lockouts = [];
    for (const state of this._states.values()) {
      if (state.lockoutUntil && state.lockoutUntil > now) {
        lockouts.push({ ...state });
      }
    }
    return lockouts;
  }

  /**
   * Get all states for a specific target (for GM review).
   * @param {string} targetId
   * @returns {SecurityState[]}
   */
  getStatesForTarget(targetId) {
    const results = [];
    for (const state of this._states.values()) {
      if (state.targetId === targetId) {
        results.push({ ...state });
      }
    }
    return results;
  }

  // ═══════════════════════════════════════════════════════════
  //  INTERNAL
  // ═══════════════════════════════════════════════════════════

  /** @private */
  _key(actorId, targetId) {
    return `${actorId}::${targetId}`;
  }

  /** @private */
  _defaultState(actorId, targetId) {
    return {
      actorId,
      targetId,
      attempts: 0,
      maxAttempts: 3,
      lockoutUntil: null,
      lockoutDuration: 3600000,
    };
  }

  /** @private */
  _clearLockout(actorId, targetId) {
    const key = this._key(actorId, targetId);
    const state = this._states.get(key);
    if (state) {
      state.lockoutUntil = null;
      state.attempts = 0;
    }
    this._clearTimer(key);
  }

  /** @private */
  _startLockoutTimer(actorId, targetId, duration) {
    const key = this._key(actorId, targetId);
    this._clearTimer(key);

    const timerId = setTimeout(() => {
      this._clearLockout(actorId, targetId);
      log.debug(`Lockout expired: ${key}`);
    }, duration);

    this._timers.set(key, timerId);
  }

  /** @private */
  _clearTimer(key) {
    const timerId = this._timers.get(key);
    if (timerId) {
      clearTimeout(timerId);
      this._timers.delete(key);
    }
  }
}
