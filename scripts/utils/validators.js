/**
 * Email Validators
 * File: scripts/utils/validators.js
 * Module: cyberpunkred-messenger
 * Description: Validation utilities for email addresses
 */

/**
 * Validate email format
 * @param {string} email - Email to validate
 * @returns {boolean} True if valid
 */
export function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  
  // Basic email regex
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email.trim());
}

/**
 * Extract email from "Name (email@domain.net)" format
 * @param {string} str - String containing email
 * @returns {string|null} Email or null
 */
export function extractEmailAddress(str) {
  if (!str) return null;
  
  // Check for parentheses format: "Name (email@domain.net)"
  const parenMatch = str.match(/\(([^)]+@[^)]+)\)/);
  if (parenMatch) {
    return parenMatch[1].trim();
  }
  
  // Check for angle bracket format: "Name <email@domain.net>"
  const angleMatch = str.match(/<([^>]+@[^>]+)>/);
  if (angleMatch) {
    return angleMatch[1].trim();
  }
  
  // If string is just an email
  if (isValidEmail(str)) {
    return str.trim();
  }
  
  return null;
}

/**
 * Format email with name: "Name (email@domain.net)"
 * @param {string} name - Display name
 * @param {string} email - Email address
 * @returns {string} Formatted string
 */
export function formatEmailWithName(name, email) {
  if (!email) return name || '';
  if (!name) return email;
  return `${name} (${email})`;
}

/**
 * Parse email string into parts
 * @param {string} str - Email string
 * @returns {Object} { name, email }
 */
export function parseEmail(str) {
  if (!str) return { name: '', email: '' };
  
  const email = extractEmailAddress(str);
  
  if (!email) {
    return { name: str.trim(), email: '' };
  }
  
  // Extract name from "Name (email)" or "Name <email>"
  const name = str
    .replace(/\([^)]+\)/, '')
    .replace(/<[^>]+>/, '')
    .trim();
  
  return { name: name || email, email };
}