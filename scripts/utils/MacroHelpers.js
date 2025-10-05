/**
 * Macro Helpers
 * File: scripts/utils/MacroHelpers.js
 * Module: cyberpunkred-messenger
 * Description: Safe wrapper functions for use in macros
 */

import { MODULE_ID } from './constants.js';

/**
 * Safely call a Night City function
 * @param {Function} fn - Function to call
 * @param {Array} args - Arguments
 * @returns {Promise<any>}
 */
export async function safeCall(fn, ...args) {
  try {
    // Check if game.nightcity exists
    if (!game.nightcity) {
      ui.notifications.error('Night City Messenger is not loaded');
      return null;
    }
    
    // Check if function exists
    if (typeof fn !== 'function') {
      ui.notifications.error('Invalid function');
      return null;
    }
    
    // Call function
    return await fn(...args);
  } catch (error) {
    console.error(`${MODULE_ID} | Error in macro:`, error);
    ui.notifications.error(`Error: ${error.message}`);
    return null;
  }
}

/**
 * Wait for module to be ready
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<boolean>}
 */
export async function waitForReady(timeout = 10000) {
  const start = Date.now();
  
  return new Promise((resolve) => {
    const checkReady = () => {
      if (game.nightcity?.ready) {
        resolve(true);
      } else if (Date.now() - start > timeout) {
        console.error(`${MODULE_ID} | Timeout waiting for module to be ready`);
        resolve(false);
      } else {
        setTimeout(checkReady, 100);
      }
    };
    checkReady();
  });
}