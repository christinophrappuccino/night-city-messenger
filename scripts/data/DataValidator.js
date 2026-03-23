/**
 * Data Validator
 * @file scripts/data/DataValidator.js
 * @module cyberpunkred-messenger
 * @description Validation utilities for messages, contacts, and other data structures.
 * Game-time aware — never compares game-world dates against new Date().
 */

import { MODULE_ID } from '../utils/constants.js';

export class DataValidator {

  /**
   * Validate message data before creation.
   * @param {Object} data
   * @returns {{valid: boolean, errors: string[]}}
   */
  static validateMessage(data) {
    const errors = [];

    if (!data.toActorId && !data.toContactId && !data.to) {
      errors.push('Recipient is required');
    }
    if (!data.fromActorId && !data.fromContactId && !data.from) {
      errors.push('Sender is required');
    }
    if (!data.subject?.trim() && !data.body?.trim()) {
      errors.push('Message must have a subject or body');
    }
    if (data.subject && data.subject.length > 200) {
      errors.push('Subject must be under 200 characters');
    }
    if (data.priority && !['low', 'normal', 'high', 'urgent', 'critical'].includes(data.priority)) {
      errors.push('Invalid priority level');
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Validate contact data.
   * @param {Object} data
   * @returns {{valid: boolean, errors: string[]}}
   */
  static validateContact(data) {
    const errors = [];

    if (!data.name?.trim()) {
      errors.push('Contact name is required');
    }
    if (data.email && !DataValidator.isValidEmail(data.email)) {
      errors.push('Invalid email format');
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Basic email format validation (cyberpunk-flexible).
   * Allows standard format and cyberpunk domains.
   * @param {string} email
   * @returns {boolean}
   */
  static isValidEmail(email) {
    if (!email || typeof email !== 'string') return false;
    // Flexible format: something@something
    return /^[^\s@]+@[^\s@]+$/.test(email.trim());
  }

  /**
   * Validate a scheduled delivery time against game time.
   * @param {string} scheduledDate - ISO timestamp
   * @returns {boolean}
   */
  static validateScheduledTime(scheduledDate) {
    try {
      const timeService = game.nightcity?.timeService;
      if (timeService) {
        const gameTime = timeService.getCurrentTime();
        return new Date(scheduledDate) > new Date(gameTime);
      }
      // Fallback: just check it's a valid date
      return !isNaN(new Date(scheduledDate).getTime());
    } catch {
      return false;
    }
  }

  /**
   * Sanitize HTML content for message bodies.
   * Allows basic formatting but strips dangerous elements.
   * @param {string} html
   * @returns {string}
   */
  static sanitizeBody(html) {
    if (!html) return '';
    // Use a temporary DOM element for sanitization
    const temp = document.createElement('div');
    temp.innerHTML = html;

    // Remove script tags and event handlers
    const scripts = temp.querySelectorAll('script, style, iframe, object, embed');
    scripts.forEach(el => el.remove());

    // Remove event handler attributes
    const allElements = temp.querySelectorAll('*');
    allElements.forEach(el => {
      for (const attr of [...el.attributes]) {
        if (attr.name.startsWith('on')) {
          el.removeAttribute(attr.name);
        }
      }
    });

    return temp.innerHTML;
  }
}
