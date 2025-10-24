/**
 * Debug Utilities
 * File: scripts/utils/debug.js
 * Module: cyberpunkred-messenger
 * Description: Debugging and logging utilities
 */

import { MODULE_ID } from './constants.js';

/**
 * Log a debug message (only if debug mode enabled)
 * @param {...any} args - Arguments to log
 */
export function debugLog(...args) {
  // For now, always log. You can add a debug setting later.
  console.log(`${MODULE_ID} |`, ...args);
}

/**
 * Log a warning message
 * @param {...any} args - Arguments to log
 */
export function debugWarn(...args) {
  console.warn(`${MODULE_ID} |`, ...args);
}

/**
 * Log an error message
 * @param {...any} args - Arguments to log
 */
export function debugError(...args) {
  console.error(`${MODULE_ID} |`, ...args);
}

/**
 * Log a table for structured data
 * @param {any} data - Data to display in table format
 */
export function debugTable(data) {
  console.table(data);
}