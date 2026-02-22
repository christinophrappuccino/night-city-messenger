/**
 * TimeService — Game Time Management
 * @file scripts/services/TimeService.js
 * @module cyberpunkred-messenger
 * @description Provides game-world timestamps using SimpleCalendar when available,
 *              falling back to Foundry world time or real time.
 */

import { log } from '../utils/helpers.js';

export class TimeService {
  constructor() {
    this._simpleCalendar = null;
  }

  /**
   * Initialize — detect SimpleCalendar
   */
  initialize() {
    if (typeof SimpleCalendar !== 'undefined') {
      this._simpleCalendar = SimpleCalendar;
      log.info('TimeService: SimpleCalendar detected');
    } else {
      log.info('TimeService: Using fallback time (no SimpleCalendar)');
    }
  }

  /**
   * Get current game time as ISO string
   * @returns {string}
   */
  getCurrentTime() {
    if (this._simpleCalendar) {
      try {
        const dt = this._simpleCalendar.api.currentDateTime();
        return new Date(dt.year, dt.month, dt.day, dt.hour, dt.minute, dt.seconds || 0).toISOString();
      } catch {
        // Fallback
      }
    }

    // Foundry world time fallback
    if (game.time?.worldTime) {
      return new Date(game.time.worldTime * 1000).toISOString();
    }

    // Real time last resort
    return new Date().toISOString();
  }

  /**
   * Check if SimpleCalendar is available
   * @returns {boolean}
   */
  get hasSimpleCalendar() {
    return this._simpleCalendar !== null;
  }
}
