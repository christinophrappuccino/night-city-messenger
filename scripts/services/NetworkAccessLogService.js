/**
 * NetworkAccessLogService
 * @file scripts/services/NetworkAccessLogService.js
 * @module cyberpunkred-messenger
 * @description Logs network connections, disconnections, authentication attempts,
 *              and security events for GM review. Maintains an in-memory ring buffer
 *              with configurable max size. Subscribes to EventBus events automatically.
 *
 *              Depends on: EventBus, NetworkService
 *              Initialization priority: ready/90
 */

import { MODULE_ID, EVENTS } from '../utils/constants.js';
import { log } from '../utils/helpers.js';

/**
 * @typedef {Object} AccessLogEntry
 * @property {string} id - Unique entry ID
 * @property {string} timestamp - ISO-8601 timestamp
 * @property {string} type - Event type: connect, disconnect, auth_success, auth_failure, lockout, dead_zone, network_switch
 * @property {string} networkId - Network involved
 * @property {string} [networkName] - Human-readable network name
 * @property {string} [actorId] - Actor who triggered the event
 * @property {string} [actorName] - Human-readable actor name
 * @property {string} [userId] - Foundry user ID
 * @property {string} [userName] - Foundry user name
 * @property {string} [method] - Auth method: password, skill
 * @property {string} [skillName] - Skill used for bypass
 * @property {number} [rollTotal] - Roll result for skill bypass
 * @property {number} [dc] - Difficulty class
 * @property {string} [reason] - Failure reason
 * @property {string} [message] - Human-readable display message (auto-generated or GM-written)
 * @property {boolean} [manual] - True if GM-created entry (RP planted evidence, etc.)
 * @property {object} [extra] - Additional metadata
 */

export class NetworkAccessLogService {

  /** @type {number} Maximum log entries to retain */
  static MAX_ENTRIES = 500;

  constructor() {
    this.eventBus = game.nightcity.eventBus;

    /** @type {AccessLogEntry[]} Ring buffer of log entries */
    this._entries = [];

    /** @type {Function[]} EventBus unsubscribe handles */
    this._subscriptions = [];

    this._wireEvents();
    this._initialized = true;
    log.info('NetworkAccessLogService initialized');
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API — Log Queries
  // ═══════════════════════════════════════════════════════════

  /**
   * Get all log entries, newest first.
   * @param {object} [filters]
   * @param {string} [filters.type] - Filter by event type
   * @param {string} [filters.networkId] - Filter by network
   * @param {string} [filters.actorId] - Filter by actor
   * @param {number} [filters.limit=50] - Max results
   * @param {string} [filters.since] - ISO timestamp — only entries after this time
   * @returns {AccessLogEntry[]}
   */
  getEntries(filters = {}) {
    let results = [...this._entries];

    if (filters.type) {
      results = results.filter(e => e.type === filters.type);
    }
    if (filters.networkId) {
      results = results.filter(e => e.networkId === filters.networkId);
    }
    if (filters.actorId) {
      results = results.filter(e => e.actorId === filters.actorId);
    }
    if (filters.since) {
      const sinceMs = new Date(filters.since).getTime();
      results = results.filter(e => new Date(e.timestamp).getTime() >= sinceMs);
    }

    // Already newest-first from push order
    results.reverse();

    const limit = filters.limit ?? 50;
    return results.slice(0, limit);
  }

  /**
   * Get count of entries by type.
   * @returns {Object<string, number>}
   */
  getStats() {
    const stats = {};
    for (const entry of this._entries) {
      stats[entry.type] = (stats[entry.type] || 0) + 1;
    }
    return stats;
  }

  /**
   * Get total entry count.
   * @returns {number}
   */
  get entryCount() {
    return this._entries.length;
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API — Manual Logging
  // ═══════════════════════════════════════════════════════════

  /**
   * Add a custom log entry (for events not auto-captured).
   * @param {string} type
   * @param {object} data
   */
  addEntry(type, data = {}) {
    this._push({
      type,
      networkId: data.networkId ?? 'unknown',
      networkName: data.networkName,
      actorId: data.actorId,
      actorName: data.actorName,
      userId: data.userId ?? game.user.id,
      userName: data.userName ?? game.user.name,
      method: data.method,
      skillName: data.skillName,
      rollTotal: data.rollTotal,
      dc: data.dc,
      reason: data.reason,
      message: data.message,
      extra: data.extra,
    });
  }

  /**
   * Add a GM-created manual log entry for RP purposes.
   * Entries are flagged as manual and highlighted in the UI.
   * Use cases: planted evidence, fake traces, NPC hack records, etc.
   * @param {object} data
   * @param {string} data.networkId - Target network ID
   * @param {string} [data.networkName] - Human-readable network name
   * @param {string} [data.actorName='Unknown'] - Freeform actor name (can be "DAEMON_07", "NetWatch", etc.)
   * @param {string} [data.type='manual'] - Event type for icon/styling
   * @param {string} [data.message=''] - Freeform log message
   */
  addManualEntry(data = {}) {
    this._push({
      type: data.type ?? 'manual',
      networkId: data.networkId ?? 'unknown',
      networkName: data.networkName,
      actorName: data.actorName ?? 'Unknown',
      message: data.message ?? '',
      manual: true,
    });
  }

  /**
   * Update an existing log entry by ID. GM only.
   * @param {string} entryId
   * @param {object} updates - Fields to merge into the entry
   * @returns {boolean} True if found and updated
   */
  updateEntry(entryId, updates = {}) {
    const entry = this._entries.find(e => e.id === entryId);
    if (!entry) return false;
    Object.assign(entry, updates);
    log.debug(`Access log entry updated: ${entryId}`);
    return true;
  }

  /**
   * Delete a log entry by ID. GM only.
   * @param {string} entryId
   * @returns {boolean} True if found and removed
   */
  deleteEntry(entryId) {
    const idx = this._entries.findIndex(e => e.id === entryId);
    if (idx === -1) return false;
    this._entries.splice(idx, 1);
    log.debug(`Access log entry deleted: ${entryId}`);
    return true;
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API — Management
  // ═══════════════════════════════════════════════════════════

  /**
   * Clear all log entries. GM only.
   */
  clearLog() {
    this._entries = [];
    log.info('Access log cleared');
  }

  /**
   * Export log as JSON string (for GM download/review).
   * @returns {string}
   */
  exportLog() {
    return JSON.stringify(this._entries, null, 2);
  }

  /**
   * Destroy the service — clean up EventBus subscriptions.
   */
  destroy() {
    for (const unsub of this._subscriptions) {
      if (typeof unsub === 'function') unsub();
    }
    this._subscriptions = [];
  }

  // ═══════════════════════════════════════════════════════════
  //  INTERNAL — Event Wiring
  // ═══════════════════════════════════════════════════════════

  /** @private */
  _wireEvents() {
    if (!this.eventBus) return;

    // Network switched
    this._sub(EVENTS.NETWORK_CHANGED, (data) => {
      if (data.type === 'switch' || data.previousNetworkId) {
        const networkService = game.nightcity.networkService;
        const net = networkService?.getNetwork(data.currentNetworkId || data.networkId);
        const prevNet = data.previousNetworkId
          ? networkService?.getNetwork(data.previousNetworkId)
          : null;
        this._push({
          type: 'network_switch',
          networkId: data.currentNetworkId || data.networkId,
          networkName: net?.name,
          message: prevNet
            ? `Switched from ${prevNet.name} → ${net?.name ?? 'unknown'}`
            : `Connected to ${net?.name ?? 'unknown'}`,
        });
      }
    });

    // Network connected (e.g., leaving dead zone)
    this._sub(EVENTS.NETWORK_CONNECTED, (data) => {
      const networkService = game.nightcity.networkService;
      const net = networkService?.getNetwork(data.networkId);
      this._push({
        type: 'connect',
        networkId: data.networkId,
        networkName: net?.name,
        message: `Connected to ${net?.name ?? data.networkId}`,
      });
    });

    // Network disconnected (e.g., entering dead zone)
    this._sub(EVENTS.NETWORK_DISCONNECTED, (data) => {
      this._push({
        type: 'disconnect',
        networkId: 'none',
        reason: data.reason,
        message: data.reason
          ? `Disconnected — ${data.reason}`
          : 'Disconnected from network',
      });
    });

    // Auth success
    this._sub(EVENTS.NETWORK_AUTH_SUCCESS, (data) => {
      const networkService = game.nightcity.networkService;
      const net = networkService?.getNetwork(data.networkId);
      const methodLabel = data.method === 'skill'
        ? `${data.skillName ?? 'skill check'} (${data.rollTotal} vs DV ${data.dc})`
        : (data.method ?? 'password');
      this._push({
        type: 'auth_success',
        networkId: data.networkId,
        networkName: net?.name,
        method: data.method,
        skillName: data.skillName,
        rollTotal: data.rollTotal,
        dc: data.dc,
        message: `Auth success — ${methodLabel} accepted`,
      });
    });

    // Auth failure
    this._sub(EVENTS.NETWORK_AUTH_FAILURE, (data) => {
      const networkService = game.nightcity.networkService;
      const net = networkService?.getNetwork(data.networkId);
      const methodLabel = data.method === 'skill'
        ? `${data.skillName ?? 'skill check'} (${data.rollTotal} vs DV ${data.dc})`
        : (data.method ?? 'password');
      this._push({
        type: 'auth_failure',
        networkId: data.networkId,
        networkName: net?.name,
        method: data.method,
        skillName: data.skillName,
        rollTotal: data.rollTotal,
        dc: data.dc,
        message: `Auth failure — ${methodLabel} rejected`,
      });
    });

    // Lockout
    this._sub(EVENTS.NETWORK_LOCKOUT, (data) => {
      const actorName = game.actors?.get(data.actorId)?.name ?? 'Unknown';
      this._push({
        type: 'lockout',
        networkId: data.targetId,
        actorId: data.actorId,
        actorName,
        extra: { lockoutUntil: data.lockoutUntil, duration: data.duration },
        message: `Lockout — ${actorName} blocked from access`,
      });
    });
  }

  /**
   * Subscribe to an EventBus event with auto-tracking for cleanup.
   * @param {string} event
   * @param {Function} handler
   * @private
   */
  _sub(event, handler) {
    const ref = this.eventBus.on(event, handler);
    this._subscriptions.push(() => this.eventBus.off(event, ref));
  }

  // ═══════════════════════════════════════════════════════════
  //  INTERNAL — Ring Buffer
  // ═══════════════════════════════════════════════════════════

  /**
   * Push a new entry into the ring buffer.
   * @param {object} data
   * @private
   */
  _push(data) {
    const entry = {
      id: foundry.utils.randomID(),
      timestamp: new Date().toISOString(),
      userId: game.user?.id,
      userName: game.user?.name,
      ...data,
    };

    this._entries.push(entry);

    // Ring buffer: drop oldest entries
    if (this._entries.length > NetworkAccessLogService.MAX_ENTRIES) {
      this._entries = this._entries.slice(-NetworkAccessLogService.MAX_ENTRIES);
    }

    log.debug(`Access log: [${entry.type}] ${entry.networkName ?? entry.networkId}`);
  }
}
