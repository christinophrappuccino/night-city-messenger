/**
 * Data Validators
 * @file scripts/utils/validators.js
 * @module cyberpunkred-messenger
 * @description Validation functions for messages, contacts, networks, and shards
 */

/**
 * Validate a message object has required fields
 * @param {object} msg
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateMessage(msg) {
  const errors = [];
  if (!msg.from) errors.push('Missing sender (from)');
  if (!msg.to) errors.push('Missing recipient (to)');
  if (!msg.toActorId) errors.push('Missing recipient actor ID (toActorId)');
  if (!msg.subject && !msg.body) errors.push('Message must have subject or body');
  return { valid: errors.length === 0, errors };
}

/**
 * Validate a contact object
 * @param {object} contact
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateContact(contact) {
  const errors = [];
  if (!contact.name) errors.push('Contact must have a name');
  if (!contact.email) errors.push('Contact must have an email');
  return { valid: errors.length === 0, errors };
}

/**
 * Validate an email format (basic)
 * @param {string} email
 * @returns {boolean}
 */
export function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
