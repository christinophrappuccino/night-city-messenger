/**
 * SchedulingService
 * @file scripts/services/SchedulingService.js
 * @module cyberpunkred-messenger
 * @description Scheduled message delivery with TimeService + SimpleCalendar integration.
 *              Queue scheduled messages, check on time-tick, deliver via MessageService
 *              when due. Stores schedule data in world settings.
 *              Supports both real-time and in-game-time scheduling.
 */

import { MODULE_ID, EVENTS, SOCKET_OPS } from '../utils/constants.js';
import { log, isGM } from '../utils/helpers.js';

export class SchedulingService {

  /** @type {Array<object>} In-memory cache of scheduled messages */
  _scheduled = [];

  /** @type {number|null} Interval ID for periodic check */
  _checkInterval = null;

  /** Check interval in ms (every 10 seconds) */
  static CHECK_INTERVAL_MS = 10_000;

  // ─── Service Accessors (lazy getters — no constructor injection) ──

  get settingsManager() { return game.nightcity?.settingsManager; }
  get messageService() { return game.nightcity?.messageService; }
  get timeService() { return game.nightcity?.timeService; }
  get eventBus() { return game.nightcity?.eventBus; }
  get socketManager() { return game.nightcity?.socketManager; }

  // ═══════════════════════════════════════════════════════════════
  //  INITIALIZATION
  // ═══════════════════════════════════════════════════════════════

  /**
   * Initialize the scheduling service.
   * Loads persisted scheduled messages and starts the check loop.
   * Only the GM client processes deliveries.
   */
  initialize() {
    this._loadScheduled();
    this._startCheckLoop();
    this._registerSocketHandlers();
    this._registerSimpleCalendarHook();
    log.info(`SchedulingService initialized — ${this._scheduled.length} scheduled messages loaded`);
  }

  /**
   * Clean up on module teardown.
   */
  destroy() {
    if (this._checkInterval) {
      clearInterval(this._checkInterval);
      this._checkInterval = null;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  PUBLIC API
  // ═══════════════════════════════════════════════════════════════

  /**
   * Schedule a message for future delivery.
   * @param {object} messageData - Standard message data (toActorId, fromActorId, subject, body, etc.)
   * @param {string} deliveryTime - ISO-8601 timestamp for delivery (game time)
   * @param {object} [options]
   * @param {boolean} [options.useGameTime=true] - Compare against game time (vs real time)
   * @returns {{ success: boolean, scheduleId?: string, error?: string }}
   */
  async scheduleMessage(messageData, deliveryTime, options = {}) {
    try {
      if (!messageData.toActorId || !messageData.fromActorId) {
        return { success: false, error: 'Sender and recipient are required' };
      }

      if (!deliveryTime) {
        return { success: false, error: 'Delivery time is required' };
      }

      const useGameTime = options.useGameTime !== false;

      // Validate delivery time is in the future
      const now = useGameTime
        ? this.timeService?.getCurrentTime() ?? new Date().toISOString()
        : new Date().toISOString();

      if (new Date(deliveryTime) <= new Date(now)) {
        return { success: false, error: 'Delivery time must be in the future' };
      }

      const scheduleId = foundry.utils.randomID();
      const entry = {
        scheduleId,
        messageData: { ...messageData },
        deliveryTime,
        useGameTime,
        createdAt: new Date().toISOString(),
        createdBy: game.user.id,
        status: 'pending', // pending, delivered, cancelled
      };

      this._scheduled.push(entry);
      await this._persistScheduled();

      // Sync to other clients
      this.socketManager?.emit(SOCKET_OPS.SCHEDULE_SYNC, {
        action: 'add',
        entry,
      });

      this.eventBus?.emit(EVENTS.MESSAGE_SCHEDULED, {
        scheduleId,
        deliveryTime,
        fromActorId: messageData.fromActorId,
        toActorId: messageData.toActorId,
      });

      log.info(`Message scheduled: ${scheduleId} for delivery at ${deliveryTime}`);
      return { success: true, scheduleId };
    } catch (error) {
      console.error(`${MODULE_ID} | SchedulingService.scheduleMessage:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Cancel a scheduled message.
   * @param {string} scheduleId
   * @returns {{ success: boolean, error?: string }}
   */
  async cancelScheduled(scheduleId) {
    try {
      const idx = this._scheduled.findIndex(e => e.scheduleId === scheduleId);
      if (idx === -1) {
        return { success: false, error: 'Scheduled message not found' };
      }

      const entry = this._scheduled[idx];
      if (entry.status !== 'pending') {
        return { success: false, error: `Cannot cancel — status is '${entry.status}'` };
      }

      entry.status = 'cancelled';
      this._scheduled.splice(idx, 1);
      await this._persistScheduled();

      this.socketManager?.emit(SOCKET_OPS.SCHEDULE_SYNC, {
        action: 'cancel',
        scheduleId,
      });

      log.info(`Scheduled message cancelled: ${scheduleId}`);
      return { success: true };
    } catch (error) {
      console.error(`${MODULE_ID} | SchedulingService.cancelScheduled:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Edit a pending scheduled message.
   * @param {string} scheduleId
   * @param {object} updates - Partial updates to messageData or deliveryTime
   * @returns {{ success: boolean, error?: string }}
   */
  async editScheduled(scheduleId, updates) {
    try {
      const entry = this._scheduled.find(e => e.scheduleId === scheduleId);
      if (!entry) {
        return { success: false, error: 'Scheduled message not found' };
      }
      if (entry.status !== 'pending') {
        return { success: false, error: `Cannot edit — status is '${entry.status}'` };
      }

      if (updates.deliveryTime) {
        entry.deliveryTime = updates.deliveryTime;
      }
      if (updates.messageData) {
        foundry.utils.mergeObject(entry.messageData, updates.messageData);
      }

      await this._persistScheduled();

      this.socketManager?.emit(SOCKET_OPS.SCHEDULE_SYNC, {
        action: 'edit',
        scheduleId,
        updates,
      });

      log.info(`Scheduled message updated: ${scheduleId}`);
      return { success: true };
    } catch (error) {
      console.error(`${MODULE_ID} | SchedulingService.editScheduled:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get all pending scheduled messages.
   * @returns {Array<object>}
   */
  getPending() {
    return this._scheduled.filter(e => e.status === 'pending');
  }

  /**
   * Get all scheduled messages (including delivered/cancelled for admin view).
   * @returns {Array<object>}
   */
  getAll() {
    return [...this._scheduled];
  }

  /**
   * Get a specific scheduled message by ID.
   * @param {string} scheduleId
   * @returns {object|null}
   */
  getScheduled(scheduleId) {
    return this._scheduled.find(e => e.scheduleId === scheduleId) ?? null;
  }

  // ═══════════════════════════════════════════════════════════════
  //  INTERNAL — Check Loop & Delivery
  // ═══════════════════════════════════════════════════════════════

  /**
   * Start the periodic check loop. Only the GM delivers.
   * @private
   */
  _startCheckLoop() {
    if (this._checkInterval) clearInterval(this._checkInterval);

    this._checkInterval = setInterval(() => {
      this._checkAndDeliver();
    }, SchedulingService.CHECK_INTERVAL_MS);
  }

  /**
   * Check all pending messages and deliver those that are due.
   * Only the GM client performs actual delivery.
   * @private
   */
  async _checkAndDeliver() {
    if (!isGM()) return; // Only GM delivers

    const pending = this.getPending();
    if (pending.length === 0) return;

    let delivered = 0;

    for (const entry of pending) {
      const now = entry.useGameTime
        ? this.timeService?.getCurrentTime() ?? new Date().toISOString()
        : new Date().toISOString();

      if (new Date(entry.deliveryTime) <= new Date(now)) {
        const result = await this._deliverScheduled(entry);
        if (result.success) delivered++;
      }
    }

    if (delivered > 0) {
      await this._persistScheduled();
      log.info(`Delivered ${delivered} scheduled message(s)`);
    }
  }

  /**
   * Deliver a single scheduled message via MessageService.
   * @param {object} entry
   * @returns {{ success: boolean }}
   * @private
   */
  async _deliverScheduled(entry) {
    try {
      const msgData = {
        ...entry.messageData,
        metadata: {
          ...(entry.messageData.metadata || {}),
          scheduledDelivery: entry.deliveryTime,
          scheduleId: entry.scheduleId,
        },
      };

      // Remove the scheduled status flag
      if (msgData.status) {
        msgData.status.scheduled = false;
      }

      const result = await this.messageService?.sendMessage(msgData);

      if (result?.success) {
        entry.status = 'delivered';
        entry.deliveredAt = new Date().toISOString();
        log.info(`Scheduled message delivered: ${entry.scheduleId}`);
      } else {
        log.warn(`Scheduled delivery failed for ${entry.scheduleId}: ${result?.error}`);
        return { success: false };
      }

      return { success: true };
    } catch (error) {
      console.error(`${MODULE_ID} | SchedulingService._deliverScheduled:`, error);
      return { success: false };
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  INTERNAL — Persistence
  // ═══════════════════════════════════════════════════════════════

  /**
   * Load scheduled messages from world settings.
   * @private
   */
  _loadScheduled() {
    try {
      const stored = this.settingsManager?.get('scheduledMessages') ?? [];
      // Only keep pending entries (clean up old delivered/cancelled)
      this._scheduled = stored.filter(e => e.status === 'pending');
    } catch (error) {
      log.warn('Failed to load scheduled messages — starting fresh');
      this._scheduled = [];
    }
  }

  /**
   * Persist scheduled messages to world settings.
   * Only stores pending entries.
   * @private
   */
  async _persistScheduled() {
    try {
      const toStore = this._scheduled.filter(e => e.status === 'pending');
      await this.settingsManager?.set('scheduledMessages', toStore);
    } catch (error) {
      console.error(`${MODULE_ID} | SchedulingService._persistScheduled:`, error);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  INTERNAL — Socket & Calendar Hooks
  // ═══════════════════════════════════════════════════════════════

  /**
   * Register socket handler for schedule sync across clients.
   * @private
   */
  _registerSocketHandlers() {
    this.socketManager?.register(SOCKET_OPS.SCHEDULE_SYNC, (data) => {
      if (data.action === 'add' && data.entry) {
        // Avoid duplicate from own emit
        if (!this._scheduled.find(e => e.scheduleId === data.entry.scheduleId)) {
          this._scheduled.push(data.entry);
        }
      } else if (data.action === 'cancel' && data.scheduleId) {
        this._scheduled = this._scheduled.filter(e => e.scheduleId !== data.scheduleId);
      } else if (data.action === 'edit' && data.scheduleId && data.updates) {
        const entry = this._scheduled.find(e => e.scheduleId === data.scheduleId);
        if (entry) {
          if (data.updates.deliveryTime) entry.deliveryTime = data.updates.deliveryTime;
          if (data.updates.messageData) {
            foundry.utils.mergeObject(entry.messageData, data.updates.messageData);
          }
        }
      }
    });
  }

  /**
   * Hook into SimpleCalendar time changes for game-time–based scheduling.
   * @private
   */
  _registerSimpleCalendarHook() {
    // SimpleCalendar emits a hook when time changes
    if (typeof SimpleCalendar !== 'undefined') {
      Hooks.on('simple-calendar-date-time-change', () => {
        this._checkAndDeliver();
      });
      log.debug('SchedulingService: SimpleCalendar time-change hook registered');
    }

    // Also listen for Foundry world time updates (fallback)
    Hooks.on('updateWorldTime', () => {
      this._checkAndDeliver();
    });
  }
}
