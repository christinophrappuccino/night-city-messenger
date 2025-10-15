/**
 * Message Helper Utilities
 * File: scripts/utils/messageHelpers.js
 * Module: cyberpunkred-messenger
 * Description: Shared utilities for message processing
 */

import { MODULE_ID } from './constants.js';

/**
 * Construct message status object from journal page flags
 * @param {Object} flags - Journal page flags
 * @returns {Object} Status object with all boolean fields
 */
export function constructMessageStatus(flags) {
  return {
    read: Boolean(flags.status?.read),
    sent: Boolean(flags.status?.sent),
    scheduled: Boolean(flags.status?.scheduled),
    spam: Boolean(flags.status?.spam),
    saved: Boolean(flags.status?.saved),
    deleted: Boolean(flags.status?.deleted)
  };
}

/**
 * Extract message body from styled HTML content
 * @param {string} htmlContent - HTML content from journal page
 * @returns {string} Plain text body
 */
export function extractBodyFromHTML(htmlContent) {
  if (!htmlContent) return '';
  
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = htmlContent;
  
  // Find all divs, the last one with padding:15px contains the body
  const contentDivs = tempDiv.querySelectorAll('div[style*="padding:15px"]');
  
  if (contentDivs.length > 0) {
    return contentDivs[contentDivs.length - 1].innerHTML.trim();
  }
  
  // Fallback: strip all HTML tags
  return htmlContent.replace(/<[^>]*>/g, '').trim();
}

/**
 * Generate message preview text
 * @param {string} body - Message body HTML
 * @param {number} maxLength - Maximum preview length (default 100)
 * @returns {string} Preview text
 */
export function generatePreview(body, maxLength = 100) {
  let previewText = body;
  
  // Strip out reply/forward quoted sections
  previewText = previewText.replace(/<div style="border-left:[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');
  previewText = previewText.replace(/<hr[^>]*>/gi, '');
  
  // Strip all HTML tags
  const plainText = previewText.replace(/<[^>]*>/g, '').trim();
  
  // Return truncated text
  return plainText.length > maxLength 
    ? plainText.substring(0, maxLength) + '...'
    : plainText;
}

/**
 * Calculate message counts by category
 * @param {Array} messages - Array of message objects
 * @returns {Object} Count object with all categories
 */
export function calculateMessageCounts(messages) {
  return {
    total: messages.filter(m => !m.status?.deleted).length,
    unread: messages.filter(m => !m.status?.read && !m.status?.spam && !m.status?.deleted).length,
    saved: messages.filter(m => m.status?.saved && !m.status?.deleted).length,
    spam: messages.filter(m => m.status?.spam && !m.status?.deleted).length,
    sent: messages.filter(m => m.status?.sent && !m.status?.deleted).length,
    scheduled: messages.filter(m => m.status?.scheduled && !m.status?.deleted).length
  };
}

/**
 * Check if a message is an orphaned scheduled placeholder
 * @param {Object} message - Message object
 * @param {Array} allScheduled - Array of all scheduled messages from service
 * @returns {boolean} True if message should be kept, false if orphaned
 */
export function isValidScheduledPlaceholder(message, allScheduled) {
  // If it's NOT a placeholder, keep it
  if (!message.metadata?.isPlaceholder || !message.metadata?.scheduleId) {
    return true;
  }
  
  // If no schedules loaded yet (service not ready), keep placeholder to be safe
  if (!allScheduled || allScheduled.length === 0) {
    return true;
  }
  
  // Check if schedule exists
  const scheduleExists = allScheduled.some(s => s.id === message.metadata.scheduleId);
  
  if (!scheduleExists) {
    console.warn(`${MODULE_ID} | Found orphaned placeholder for schedule ${message.metadata.scheduleId}`);
    return false;
  }
  
  return true;
}