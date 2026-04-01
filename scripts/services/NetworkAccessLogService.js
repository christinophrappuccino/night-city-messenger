/**
 * NetworkAccessLogService
 * @file scripts/services/NetworkAccessLogService.js
 * @module cyberpunkred-messenger
 * @description Logs network connections, disconnections, authentication attempts,
 *              and security events for GM review. Persists to world settings via
 *              debounced saves. Subscribes to EventBus events automatically.
 *
 *              Depends on: EventBus, NetworkService, SettingsManager
 *              Initialization priority: ready/90
 */

import { MODULE_ID, EVENTS } from '../utils/constants.js';
import { log } from '../utils/helpers.js';

/**
 * @typedef {Object} AccessLogEntry
 * @property {string} id - Unique entry ID
 * @property {string} timestamp - ISO-8601 timestamp
 * @property {string} type - Event type
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
 * @property {string} [message] - Human-readable display message
 * @property {boolean} [manual] - True if GM-created entry
 * @property {object} [extra] - Additional metadata
 */

export class NetworkAccessLogService {

  /** @type {number} Maximum log entries to retain */
  static MAX_ENTRIES = 500;

  /** @type {number} Save debounce delay in ms */
  static SAVE_DELAY = 2000;

  constructor() {
    this.eventBus = game.nightcity.eventBus;
    this.settingsManager = game.nightcity.settingsManager;

    /** @type {AccessLogEntry[]} Persistent log entries */
    this._entries = [];

    /** @type {Function[]} EventBus unsubscribe handles */
    this._subscriptions = [];

    /** @type {number|null} Debounce timer for saves */
    this._saveTimer = null;

    this._loadFromSettings();
    this._wireEvents();
    this._initialized = true;
    log.info(`NetworkAccessLogService initialized (${this._entries.length} entries loaded)`);
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API — Log Queries
  // ═══════════════════════════════════════════════════════════

  getEntries(filters = {}) {
    let results = [...this._entries];

    if (filters.type) results = results.filter(e => e.type === filters.type);
    if (filters.networkId) results = results.filter(e => e.networkId === filters.networkId);
    if (filters.actorId) results = results.filter(e => e.actorId === filters.actorId);
    if (filters.since) {
      const sinceMs = new Date(filters.since).getTime();
      results = results.filter(e => new Date(e.timestamp).getTime() >= sinceMs);
    }

    results.reverse();
    return results.slice(0, filters.limit ?? 50);
  }

  getStats() {
    const stats = {};
    for (const entry of this._entries) {
      stats[entry.type] = (stats[entry.type] || 0) + 1;
    }
    return stats;
  }

  get entryCount() {
    return this._entries.length;
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API — Manual Logging
  // ═══════════════════════════════════════════════════════════

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

  updateEntry(entryId, updates = {}) {
    const entry = this._entries.find(e => e.id === entryId);
    if (!entry) return false;
    Object.assign(entry, updates);
    this._scheduleSave();
    log.debug(`Access log entry updated: ${entryId}`);
    return true;
  }

  deleteEntry(entryId) {
    const idx = this._entries.findIndex(e => e.id === entryId);
    if (idx === -1) return false;
    this._entries.splice(idx, 1);
    this._scheduleSave();
    log.debug(`Access log entry deleted: ${entryId}`);
    return true;
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API — Management
  // ═══════════════════════════════════════════════════════════

  /** Clear all entries. Saves immediately. */
  clearLog() {
    this._entries = [];
    this._saveNow();
    log.info('Access log cleared');
  }

  /** Export as JSON (for re-import). */
  exportLog() {
    return JSON.stringify(this._entries, null, 2);
  }

  /**
   * Export as formatted plain text for readability.
   * @returns {string}
   */
  exportFormatted() {
    const lines = [
      '════════════════════════════════════════════════════════════════════',
      '  NIGHT CITY MESSENGER — NETWORK ACCESS LOG',
      `  Exported: ${new Date().toISOString()}`,
      `  Entries: ${this._entries.length}`,
      '════════════════════════════════════════════════════════════════════',
      '',
      'DATE       TIME      TYPE             NETWORK        ACTOR            MESSAGE',
      '────────── ──────── ──────────────── ────────────── ──────────────── ─────────────────────────────────',
    ];

    const sorted = [...this._entries].reverse();

    for (const e of sorted) {
      const d = new Date(e.timestamp);
      const date = `${String(d.getUTCMonth() + 1).padStart(2, '0')}.${String(d.getUTCDate()).padStart(2, '0')}.${d.getUTCFullYear()}`;
      const time = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')}`;
      const typeTag = `[${(e.type ?? 'EVENT').toUpperCase()}]`.padEnd(16);
      const net = (e.networkName ?? e.networkId ?? '—').padEnd(14);
      const actor = (e.actorName ?? 'System').padEnd(16);
      const manual = e.manual ? ' [GM]' : '';

      lines.push(`${date} ${time}  ${typeTag} ${net} ${actor} ${e.message ?? ''}${manual}`);
    }

    lines.push('');
    lines.push('════════════════════════════════════════════════════════════════════');
    lines.push('  END OF LOG');
    lines.push('════════════════════════════════════════════════════════════════════');

    return lines.join('\n');
  }

  /**
   * Import log entries from JSON. Merges with existing, deduplicates by ID.
   * @param {string} json
   * @returns {{ success: boolean, imported: number, error?: string }}
   */
  importLog(json) {
    try {
      const parsed = JSON.parse(json);
      if (!Array.isArray(parsed)) {
        return { success: false, imported: 0, error: 'Expected an array of log entries' };
      }

      const existingIds = new Set(this._entries.map(e => e.id));
      let imported = 0;

      for (const entry of parsed) {
        if (!entry.id || !entry.timestamp || !entry.type) continue;
        if (existingIds.has(entry.id)) continue;
        this._entries.push(entry);
        existingIds.add(entry.id);
        imported++;
      }

      if (this._entries.length > NetworkAccessLogService.MAX_ENTRIES) {
        this._entries = this._entries.slice(-NetworkAccessLogService.MAX_ENTRIES);
      }

      this._saveNow();
      log.info(`Access log: imported ${imported} entries`);
      return { success: true, imported };
    } catch (err) {
      return { success: false, imported: 0, error: err.message };
    }
  }

  destroy() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveNow();
    }
    for (const unsub of this._subscriptions) {
      if (typeof unsub === 'function') unsub();
    }
    this._subscriptions = [];
  }

  // ═══════════════════════════════════════════════════════════
  //  INTERNAL — Persistence
  // ═══════════════════════════════════════════════════════════

  /** @private */
  _loadFromSettings() {
    try {
      const stored = this.settingsManager?.get('networkAccessLog') ?? [];
      if (Array.isArray(stored)) {
        this._entries = stored;
      }
    } catch (err) {
      log.warn('Access log: failed to load from settings', err.message);
      this._entries = [];
    }
  }

  /** @private */
  _scheduleSave() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this._saveNow();
      this._saveTimer = null;
    }, NetworkAccessLogService.SAVE_DELAY);
  }

  /** @private */
  _saveNow() {
    if (!game.user?.isGM) return;
    try {
      this.settingsManager?.set('networkAccessLog', this._entries);
      log.debug(`Access log: saved ${this._entries.length} entries`);
    } catch (err) {
      log.warn('Access log: failed to save', err.message);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  INTERNAL — Event Wiring
  // ═══════════════════════════════════════════════════════════

  /** @private */
  _wireEvents() {
    if (!this.eventBus) return;

    // Helper: get current user's character actor info
    const _actor = () => {
      const char = game.user?.character;
      return { actorId: char?.id ?? null, actorName: char?.name ?? game.user?.name ?? 'Unknown' };
    };

    this._sub(EVENTS.NETWORK_CHANGED, (data) => {
      if (data.type === 'switch' || data.previousNetworkId) {
        const networkService = game.nightcity.networkService;
        const net = networkService?.getNetwork(data.currentNetworkId || data.networkId);
        const prevNet = data.previousNetworkId
          ? networkService?.getNetwork(data.previousNetworkId)
          : null;
        const a = _actor();
        this._push({
          type: 'network_switch',
          networkId: data.currentNetworkId || data.networkId,
          networkName: net?.name,
          actorId: a.actorId,
          actorName: a.actorName,
          message: prevNet
            ? `Switched from ${prevNet.name} → ${net?.name ?? 'unknown'}`
            : `Connected to ${net?.name ?? 'unknown'}`,
        });
      }
    });

    this._sub(EVENTS.NETWORK_CONNECTED, (data) => {
      const networkService = game.nightcity.networkService;
      const net = networkService?.getNetwork(data.networkId);
      const a = _actor();
      this._push({
        type: 'connect',
        networkId: data.networkId,
        networkName: net?.name,
        actorId: a.actorId,
        actorName: a.actorName,
        message: `Connected to ${net?.name ?? data.networkId}`,
      });
    });

    this._sub(EVENTS.NETWORK_DISCONNECTED, (data) => {
      const a = _actor();
      this._push({
        type: 'disconnect',
        networkId: 'none',
        actorId: a.actorId,
        actorName: a.actorName,
        reason: data.reason,
        message: data.reason
          ? `Disconnected — ${data.reason}`
          : 'Disconnected from network',
      });
    });

    this._sub(EVENTS.NETWORK_AUTH_SUCCESS, (data) => {
      const networkService = game.nightcity.networkService;
      const net = networkService?.getNetwork(data.networkId);
      const a = _actor();
      const methodLabel = data.method === 'skill'
        ? `${data.skillName ?? 'skill check'} (${data.rollTotal} vs DV ${data.dc})`
        : (data.method ?? 'password');
      this._push({
        type: 'auth_success',
        networkId: data.networkId,
        networkName: net?.name,
        actorId: a.actorId,
        actorName: a.actorName,
        method: data.method,
        skillName: data.skillName,
        rollTotal: data.rollTotal,
        dc: data.dc,
        message: `Auth success — ${methodLabel} accepted`,
      });
    });

    this._sub(EVENTS.NETWORK_AUTH_FAILURE, (data) => {
      const networkService = game.nightcity.networkService;
      const net = networkService?.getNetwork(data.networkId);
      const a = _actor();
      const methodLabel = data.method === 'skill'
        ? `${data.skillName ?? 'skill check'} (${data.rollTotal} vs DV ${data.dc})`
        : (data.method ?? 'password');
      this._push({
        type: 'auth_failure',
        networkId: data.networkId,
        networkName: net?.name,
        actorId: a.actorId,
        actorName: a.actorName,
        method: data.method,
        skillName: data.skillName,
        rollTotal: data.rollTotal,
        dc: data.dc,
        message: `Auth failure — ${methodLabel} rejected`,
      });
    });

    this._sub(EVENTS.NETWORK_LOCKOUT, (data) => {
      const networkService = game.nightcity?.networkService;
      const net = networkService?.getNetwork(data.targetId);
      const actorName = game.actors?.get(data.actorId)?.name ?? 'Unknown';
      this._push({
        type: 'lockout',
        networkId: data.targetId,
        networkName: net?.name ?? data.targetId,
        actorId: data.actorId,
        actorName,
        extra: { lockoutUntil: data.lockoutUntil, duration: data.duration },
        message: `Lockout — ${actorName} blocked from access`,
      });
    });

    // ─── Trace: Message trace completed (player's countdown expired) ───
    this._sub(EVENTS.TRACE_COMPLETE, (data) => {
      const networkService = game.nightcity?.networkService;
      const net = networkService?.getNetwork(data.networkId);
      const actorName = data.actorName ?? game.actors?.get(data.actorId)?.name ?? 'Unknown';
      this._push({
        type: 'trace',
        networkId: data.networkId,
        networkName: net?.name ?? data.networkId,
        actorId: data.actorId,
        actorName,
        message: `Message opened — trace countdown expired`,
        extra: {
          messageId: data.messageId,
          actorId: data.actorId,
        },
      });
    });

    // ─── Trace: Message sent on a traced network ───
    this._sub(EVENTS.MESSAGE_SENT, (data) => {
      if (!data.network) return;
      const networkService = game.nightcity?.networkService;
      const net = networkService?.getNetwork(data.network);
      if (!net?.effects?.traced) return;

      const actorName = data.fromActorName ?? game.actors?.get(data.fromActorId)?.name ?? 'Unknown';
      const toName = data.toActorName ?? 'unknown recipient';
      const subjectSnippet = data.subject ? ` — "${data.subject}"` : '';
      this._push({
        type: 'message_trace',
        networkId: data.network,
        networkName: net.name,
        actorId: data.fromActorId,
        actorName,
        message: `To: ${toName}${subjectSnippet}`,
        extra: {
          messageId: data.messageId,
          actorId: data.fromActorId,
        },
      });
    });

    // ─── Trace: Shard decrypted — check for trace config ───
    this._sub(EVENTS.SHARD_DECRYPTED, (data) => {
      if (!data.itemId) return;
      // Find the shard item
      const item = game.items?.get(data.itemId)
        ?? Array.from(game.actors ?? []).reduce((found, a) => found ?? a.items?.get(data.itemId), null);
      if (!item) return;

      const shardFlags = item.getFlag?.(MODULE_ID, 'shardData') ?? {};
      const tracing = shardFlags.security?.tracing ?? {};
      // Only fire if tracing is configured with a trigger
      if (!tracing.triggerOn || tracing.triggerOn === 'none') return;
      // Match trigger: 'access' fires on any decrypt, 'hack-attempt' and 'any' also fire
      if (tracing.triggerOn !== 'access' && tracing.triggerOn !== 'hack-attempt' && tracing.triggerOn !== 'any') return;

      const actorName = game.actors?.get(data.actorId)?.name ?? (data.actorId === 'gm-override' ? 'GM' : 'Unknown');
      const networkService = game.nightcity?.networkService;
      const currentNetId = networkService?.currentNetworkId ?? 'CITINET';
      const net = networkService?.getNetwork(currentNetId);
      const shardName = item.name ?? 'Unknown Shard';
      const traceMsg = tracing.traceMessage ?? `Shard "${shardName}" — trace target alerted`;

      // Emit SHARD_TRACE_FIRED event
      this.eventBus?.emit(EVENTS.SHARD_TRACE_FIRED, {
        itemId: data.itemId,
        shardName,
        actorId: data.actorId,
        actorName,
        networkId: currentNetId,
        networkName: net?.name,
        traceTarget: tracing.traceTarget,
        traceMessage: traceMsg,
      });

      // Log it
      this._push({
        type: 'shard_trace',
        networkId: currentNetId,
        networkName: net?.name ?? currentNetId,
        actorId: data.actorId,
        actorName,
        message: traceMsg,
        extra: {
          itemId: data.itemId,
          actorId: data.actorId,
        },
      });
    });
  }

  /** @private */
  _sub(event, handler) {
    const ref = this.eventBus.on(event, handler);
    this._subscriptions.push(() => this.eventBus.off(event, ref));
  }

  // ═══════════════════════════════════════════════════════════
  //  INTERNAL — Ring Buffer
  // ═══════════════════════════════════════════════════════════

  /** @private */
  _push(data) {
    const entry = {
      id: foundry.utils.randomID(),
      timestamp: new Date().toISOString(),
      userId: game.user?.id,
      userName: game.user?.name,
      ...data,
    };

    this._entries.push(entry);

    if (this._entries.length > NetworkAccessLogService.MAX_ENTRIES) {
      this._entries = this._entries.slice(-NetworkAccessLogService.MAX_ENTRIES);
    }

    this._scheduleSave();
    log.debug(`Access log: [${entry.type}] ${entry.networkName ?? entry.networkId}`);
  }
}
