/**
 * TimeService — Game Time Provider System
 * @file scripts/services/TimeService.js
 * @module cyberpunkred-messenger
 *
 * @description Unified time provider for all NCM features. Supports 6 modes:
 *
 *   auto            — Auto-detect: SimpleCalendar → SmallTime → worldTime → real
 *   simple-calendar — SimpleCalendar API explicitly
 *   world-time      — Foundry's game.time.worldTime
 *   real-time       — Date.now() always
 *   manual          — GM-controlled, no auto-tick
 *   disguised       — Real-time clock offset to a fictional date (e.g. Night City 2045)
 *
 * Every consumer calls timeService.getCurrentTime() and gets an ISO string.
 * The only thing that changes is where that string comes from.
 */

import { MODULE_ID } from '../utils/constants.js';
import { log, isGM } from '../utils/helpers.js';

/** @type {string[]} Valid provider mode keys */
export const TIME_PROVIDER_MODES = ['auto', 'simple-calendar', 'world-time', 'real-time', 'manual', 'disguised'];

/** @type {Object<string,string>} Human-readable labels */
export const TIME_PROVIDER_LABELS = {
  'auto':            'Auto-Detect',
  'simple-calendar': 'SimpleCalendar',
  'world-time':      'Foundry World Time',
  'real-time':       'Real-World Time',
  'manual':          'Manual (GM Set)',
  'disguised':       'Disguised Time',
};

export class TimeService {

  // ═══════════════════════════════════════════════════════════
  //  State
  // ═══════════════════════════════════════════════════════════

  /** @type {string} Active provider mode */
  _mode = 'auto';

  /** @type {string|null} Resolved provider for 'auto' mode */
  _autoResolved = null;

  /** @type {boolean} SimpleCalendar detected */
  _hasSimpleCalendar = false;

  /** @type {boolean} SmallTime detected */
  _hasSmallTime = false;

  // ═══════════════════════════════════════════════════════════
  //  Initialization
  // ═══════════════════════════════════════════════════════════

  /**
   * Initialize the time service. Call after settings are registered and game is ready.
   */
  initialize() {
    // Detect available modules
    this._hasSimpleCalendar = typeof SimpleCalendar !== 'undefined'
      && game.modules.get('foundryvtt-simple-calendar')?.active === true;

    this._hasSmallTime = game.modules.get('smalltime')?.active === true;

    // Read configured mode from settings
    try {
      this._mode = game.settings.get(MODULE_ID, 'timeProvider') || 'auto';
    } catch {
      this._mode = 'auto';
    }

    // Resolve auto mode
    if (this._mode === 'auto') {
      this._autoResolved = this._detectBestProvider();
    }

    const effective = this._mode === 'auto' ? `auto → ${this._autoResolved}` : this._mode;
    log.info(`TimeService initialized: mode=${effective}`);

    if (this._hasSimpleCalendar) log.info('TimeService: SimpleCalendar detected');
    if (this._hasSmallTime) log.info('TimeService: SmallTime detected');
  }

  // ═══════════════════════════════════════════════════════════
  //  Core API — getCurrentTime()
  // ═══════════════════════════════════════════════════════════

  /**
   * Get the current game time as an ISO-8601 string.
   * This is the ONE method everything in NCM calls.
   * @returns {string} ISO-8601 timestamp
   */
  getCurrentTime() {
    const mode = this._mode === 'auto' ? (this._autoResolved || 'real-time') : this._mode;

    switch (mode) {
      case 'simple-calendar':
        return this._getSimpleCalendarTime();

      case 'world-time':
        return this._getWorldTime();

      case 'real-time':
        return new Date().toISOString();

      case 'manual':
        return this._getManualTime();

      case 'disguised':
        return this._getDisguisedTime();

      default:
        return new Date().toISOString();
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Provider Implementations
  // ═══════════════════════════════════════════════════════════

  /**
   * SimpleCalendar — read from SC API.
   * @returns {string}
   * @private
   */
  _getSimpleCalendarTime() {
    if (!this._hasSimpleCalendar) return new Date().toISOString();

    try {
      const dt = SimpleCalendar.api.currentDateTime();
      // Use Date.UTC — SC values are game-world time, not local timezone
      const ms = Date.UTC(dt.year, dt.month, dt.day, dt.hour, dt.minute, dt.seconds || 0);
      return new Date(ms).toISOString();
    } catch (err) {
      log.warn('TimeService: SimpleCalendar read failed, falling back to real time', err);
      return new Date().toISOString();
    }
  }

  /**
   * Foundry worldTime — the built-in game clock.
   * SmallTime manipulates this same value, so this covers both.
   * @returns {string}
   * @private
   */
  _getWorldTime() {
    if (game.time?.worldTime) {
      return new Date(game.time.worldTime * 1000).toISOString();
    }
    return new Date().toISOString();
  }

  /**
   * Manual mode — GM-set static timestamp, no auto-tick.
   * @returns {string}
   * @private
   */
  _getManualTime() {
    try {
      const stored = game.settings.get(MODULE_ID, 'manualTime');
      if (stored) return stored;
    } catch { /* not set yet */ }
    return new Date().toISOString();
  }

  /**
   * Disguised mode — real-time clock offset to a fictional date.
   *
   * The GM sets a "disguised base" (e.g. "2045-03-18T22:00:00").
   * We record the real-world time at that moment as the "anchor".
   * From then on: getCurrentTime() = disguisedBase + (Date.now() - anchor)
   *
   * The clock ticks in perfect sync with real time, just shows a different date.
   * @returns {string}
   * @private
   */
  _getDisguisedTime() {
    try {
      const baseIso = game.settings.get(MODULE_ID, 'disguisedBaseTime');
      const anchor = game.settings.get(MODULE_ID, 'disguisedAnchor');

      if (baseIso && anchor) {
        const baseMs = new Date(baseIso).getTime();
        const elapsed = Date.now() - anchor;
        return new Date(baseMs + elapsed).toISOString();
      }
    } catch { /* settings not configured yet */ }

    // Not configured — fall back to real time
    return new Date().toISOString();
  }

  // ═══════════════════════════════════════════════════════════
  //  Auto-Detection
  // ═══════════════════════════════════════════════════════════

  /**
   * Detect the best available provider for auto mode.
   * Priority: SimpleCalendar → SmallTime (worldTime) → worldTime → real-time
   * @returns {string} Provider mode key
   * @private
   */
  _detectBestProvider() {
    if (this._hasSimpleCalendar) return 'simple-calendar';
    if (this._hasSmallTime) return 'world-time';
    if (game.time?.worldTime > 0) return 'world-time';
    return 'real-time';
  }

  // ═══════════════════════════════════════════════════════════
  //  GM Controls — Mode Switching & Configuration
  // ═══════════════════════════════════════════════════════════

  /**
   * Get current mode and status info (for display in admin panel / tools tab).
   * @returns {object}
   */
  getProviderInfo() {
    const mode = this._mode;
    const effective = mode === 'auto' ? (this._autoResolved || 'real-time') : mode;

    return {
      mode,
      effective,
      label: TIME_PROVIDER_LABELS[mode] || mode,
      effectiveLabel: TIME_PROVIDER_LABELS[effective] || effective,
      hasSimpleCalendar: this._hasSimpleCalendar,
      hasSmallTime: this._hasSmallTime,
      isAuto: mode === 'auto',
      isManual: mode === 'manual',
      isDisguised: mode === 'disguised',
      currentTime: this.getCurrentTime(),
    };
  }

  /**
   * Switch the time provider mode. GM only.
   * @param {string} newMode - One of TIME_PROVIDER_MODES
   */
  async setMode(newMode) {
    if (!isGM()) return;
    if (!TIME_PROVIDER_MODES.includes(newMode)) {
      log.warn(`TimeService: Invalid mode "${newMode}". Valid: ${TIME_PROVIDER_MODES.join(', ')}`);
      return;
    }

    await game.settings.set(MODULE_ID, 'timeProvider', newMode);
    this._mode = newMode;

    if (newMode === 'auto') {
      this._autoResolved = this._detectBestProvider();
    }

    const effective = newMode === 'auto' ? `auto → ${this._autoResolved}` : newMode;
    log.info(`TimeService: Mode changed to ${effective}`);
    ui.notifications.info(`NCM | Time provider set to: ${effective}`);
  }

  /**
   * Set disguised time — anchors the fictional date to right now.
   * From this point on, the clock ticks in real-time from the given base.
   * @param {string} baseIso - The fictional date/time as ISO string (e.g. "2045-03-18T22:00:00")
   */
  async setDisguisedTime(baseIso) {
    if (!isGM()) return;

    const anchor = Date.now();
    await game.settings.set(MODULE_ID, 'disguisedBaseTime', baseIso);
    await game.settings.set(MODULE_ID, 'disguisedAnchor', anchor);

    // Auto-switch to disguised mode if not already
    if (this._mode !== 'disguised') {
      await this.setMode('disguised');
    }

    log.info(`TimeService: Disguised time set to ${baseIso} (anchored at ${new Date(anchor).toISOString()})`);
  }

  /**
   * Set manual time to a specific value.
   * @param {string} isoString - The time to set
   */
  async setManualTime(isoString) {
    if (!isGM()) return;

    await game.settings.set(MODULE_ID, 'manualTime', isoString);

    if (this._mode !== 'manual') {
      await this.setMode('manual');
    }

    log.info(`TimeService: Manual time set to ${isoString}`);
  }

  /**
   * Advance manual time by a number of seconds.
   * @param {number} seconds - Seconds to advance (can be negative)
   */
  async advanceManualTime(seconds) {
    if (!isGM()) return;
    if (this._mode !== 'manual') {
      ui.notifications.warn('NCM | Manual time advance only works in Manual mode.');
      return;
    }

    const current = this._getManualTime();
    const ms = new Date(current).getTime() + (seconds * 1000);
    const newTime = new Date(ms).toISOString();
    await game.settings.set(MODULE_ID, 'manualTime', newTime);
    log.info(`TimeService: Manual time advanced by ${seconds}s → ${newTime}`);
  }

  /**
   * Re-anchor the disguised clock without changing the displayed time.
   * Useful if the GM pauses the session and resumes later —
   * call this on resume so the clock picks up from where it left off
   * instead of jumping forward by the real-world gap.
   */
  async reanchorDisguisedTime() {
    if (!isGM() || this._mode !== 'disguised') return;

    const currentDisguised = this._getDisguisedTime();
    await game.settings.set(MODULE_ID, 'disguisedBaseTime', currentDisguised);
    await game.settings.set(MODULE_ID, 'disguisedAnchor', Date.now());
    log.info(`TimeService: Disguised time re-anchored at ${currentDisguised}`);
  }

  // ═══════════════════════════════════════════════════════════
  //  Legacy Compat
  // ═══════════════════════════════════════════════════════════

  /**
   * Check if SimpleCalendar is available.
   * @returns {boolean}
   * @deprecated Use getProviderInfo().hasSimpleCalendar instead
   */
  get hasSimpleCalendar() {
    return this._hasSimpleCalendar;
  }
}
