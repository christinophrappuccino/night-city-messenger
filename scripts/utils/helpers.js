/**
 * Utility Helpers
 * @file scripts/utils/helpers.js
 * @module cyberpunkred-messenger
 * @description Shared utility functions used across the module
 */

import { MODULE_ID, MODULE_SHORT } from './constants.js';

/**
 * Module-prefixed console logger
 */
export const log = {
  info: (...args) => console.log(`${MODULE_SHORT} |`, ...args),
  warn: (...args) => console.warn(`${MODULE_SHORT} |`, ...args),
  error: (...args) => console.error(`${MODULE_SHORT} |`, ...args),
  debug: (...args) => {
    try {
      if (game.settings?.get(MODULE_ID, 'debugMode')) {
        console.debug(`${MODULE_SHORT} |`, ...args);
      }
    } catch {
      // Setting not yet registered — silently skip
    }
  },
};

/**
 * Generate a unique ID using Foundry's utility
 * @returns {string}
 */
export function generateId() {
  return foundry.utils.randomID();
}

/**
 * Deep merge objects (non-mutating)
 * @param {object} target
 * @param {object} source
 * @returns {object}
 */
export function deepMerge(target, source) {
  return foundry.utils.mergeObject(target, source, { inplace: false });
}

/**
 * Localize a string key
 * @param {string} key - Dot-notation i18n key (e.g., 'NCM.Messages.Inbox')
 * @param {object} [data] - Interpolation data
 * @returns {string}
 */
export function localize(key, data = {}) {
  return game.i18n.format(key, data);
}

/**
 * Check if the current user is a GM
 * @returns {boolean}
 */
export function isGM() {
  return game.user?.isGM ?? false;
}

/**
 * Get the primary owned actor for the current user
 * @returns {Actor|null}
 */
export function getPlayerActor() {
  return game.user?.character ?? null;
}

/**
 * Format a timestamp in cyberpunk style: 2045.03.15 // 14:30
 * @param {string|number|Date} timestamp
 * @returns {string}
 */
/**
 * Format timestamp in cyberpunk style. Respects the module's 12h/24h setting.
 * @param {string|number|Date} timestamp
 * @param {object} [options]
 * @param {boolean} [options.seconds=false] - Include seconds
 * @returns {string}
 */
export function formatCyberDate(timestamp, options = {}) {
  const d = new Date(timestamp);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const sec = String(d.getSeconds()).padStart(2, '0');

  // Check setting — default to 24h if settings not available yet
  let use12h = false;
  try {
    use12h = game.settings?.get(MODULE_ID, 'timeFormat') === '12h';
  } catch { /* settings not registered yet — use 24h */ }

  if (use12h) {
    let hr = d.getHours();
    const ampm = hr >= 12 ? 'PM' : 'AM';
    hr = hr % 12 || 12;
    const timeStr = options.seconds ? `${hr}:${min}:${sec} ${ampm}` : `${hr}:${min} ${ampm}`;
    return `${year}.${month}.${day} // ${timeStr}`;
  }

  const hr = String(d.getHours()).padStart(2, '0');
  const timeStr = options.seconds ? `${hr}:${min}:${sec}` : `${hr}:${min}`;
  return `${year}.${month}.${day} // ${timeStr}`;
}

/**
 * Debounce a function
 * @param {Function} fn
 * @param {number} delay - ms
 * @returns {Function}
 */
export function debounce(fn, delay = 300) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

/**
 * Truncate text with ellipsis
 * @param {string} str
 * @param {number} maxLen
 * @returns {string}
 */
export function truncate(str, maxLen = 50) {
  if (!str || str.length <= maxLen) return str ?? '';
  return str.substring(0, maxLen - 3) + '...';
}
