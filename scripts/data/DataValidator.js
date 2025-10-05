/**
 * Data Validator
 * File: scripts/data/DataValidator.js
 * Module: cyberpunkred-messenger
 * Description: Validates and sanitizes data for security and integrity
 */

import { MODULE_ID } from '../utils/constants.js';

export class DataValidator {
  /**
   * Validate message data
   * @param {Object} data - Message data to validate
   * @returns {Object} { valid: boolean, errors: Array, sanitized: Object }
   */
  static validateMessage(data) {
    const errors = [];
    const sanitized = {};
    
    // Required fields
    if (!data.to || typeof data.to !== 'string' || data.to.trim().length === 0) {
      errors.push('Recipient (to) is required');
    } else {
      sanitized.to = this.sanitizeEmail(data.to);
    }
    
    if (!data.from || typeof data.from !== 'string' || data.from.trim().length === 0) {
      errors.push('Sender (from) is required');
    } else {
      sanitized.from = this.sanitizeEmail(data.from);
    }
    
    if (!data.subject || typeof data.subject !== 'string' || data.subject.trim().length === 0) {
      errors.push('Subject is required');
    } else {
      sanitized.subject = this.sanitizeText(data.subject, 200);
    }
    
    if (!data.content || typeof data.content !== 'string' || data.content.trim().length === 0) {
      errors.push('Content is required');
    } else {
      sanitized.content = this.sanitizeHTML(data.content);
    }
    
    // Optional fields
    sanitized.timestamp = data.timestamp || new Date().toISOString();
    sanitized.network = data.network || 'CITINET';
    sanitized.encrypted = Boolean(data.encrypted);
    sanitized.attachments = Array.isArray(data.attachments) ? data.attachments : [];
    
    // Status
    sanitized.status = {
      read: Boolean(data.status?.read),
      saved: Boolean(data.status?.saved),
      spam: Boolean(data.status?.spam)
    };
    
    // Metadata
    sanitized.metadata = {
      networkTrace: data.metadata?.networkTrace || sanitized.network,
      signalStrength: this.validateNumber(data.metadata?.signalStrength, 0, 100, 100),
      routingPath: Array.isArray(data.metadata?.routingPath) ? data.metadata.routingPath : []
    };
    
    return {
      valid: errors.length === 0,
      errors,
      sanitized
    };
  }
  
  /**
   * Validate contact data
   * @param {Object} data - Contact data to validate
   * @returns {Object} { valid: boolean, errors: Array, sanitized: Object }
   */
  static validateContact(data) {
    const errors = [];
    const sanitized = {};
    
    // Required fields
    if (!data.name || typeof data.name !== 'string' || data.name.trim().length === 0) {
      errors.push('Name is required');
    } else {
      sanitized.name = this.sanitizeText(data.name, 100);
    }
    
    if (!data.email || typeof data.email !== 'string' || data.email.trim().length === 0) {
      errors.push('Email is required');
    } else if (!this.isValidEmail(data.email)) {
      errors.push('Invalid email format');
    } else {
      sanitized.email = this.sanitizeEmail(data.email);
    }
    
    // Optional fields
    sanitized.notes = data.notes ? this.sanitizeText(data.notes, 500) : '';
    sanitized.category = data.category ? this.sanitizeText(data.category, 50) : 'general';
    sanitized.actorId = data.actorId || null;
    
    return {
      valid: errors.length === 0,
      errors,
      sanitized
    };
  }
  
  /**
   * Validate scheduled message data
   * @param {Object} data - Scheduled message data
   * @returns {Object} { valid: boolean, errors: Array, sanitized: Object }
   */
  static validateScheduledMessage(data) {
    const errors = [];
    
    // Validate base message
    const messageValidation = this.validateMessage(data);
    if (!messageValidation.valid) {
      errors.push(...messageValidation.errors);
    }
    
    const sanitized = messageValidation.sanitized;
    
    // Schedule-specific fields
    if (!data.scheduledTime) {
      errors.push('Scheduled time is required');
    } else {
      const scheduleDate = new Date(data.scheduledTime);
      if (isNaN(scheduleDate.getTime())) {
        errors.push('Invalid scheduled time');
      } else if (scheduleDate < new Date()) {
        errors.push('Scheduled time must be in the future');
      } else {
        sanitized.scheduledTime = scheduleDate.toISOString();
      }
    }
    
    sanitized.useSimpleCalendar = Boolean(data.useSimpleCalendar);
    sanitized.sent = Boolean(data.sent);
    
    return {
      valid: errors.length === 0,
      errors,
      sanitized
    };
  }
  
  // ========================================
  // Sanitization Methods
  // ========================================
  
  /**
   * Sanitize email address
   * @param {string} email - Email to sanitize
   * @returns {string}
   */
  static sanitizeEmail(email) {
    return email.trim().toLowerCase();
  }
  
  /**
   * Sanitize plain text
   * @param {string} text - Text to sanitize
   * @param {number} maxLength - Maximum length
   * @returns {string}
   */
  static sanitizeText(text, maxLength = 1000) {
    let sanitized = text.trim();
    
    // Remove any HTML tags
    sanitized = sanitized.replace(/<[^>]*>/g, '');
    
    // Limit length
    if (maxLength && sanitized.length > maxLength) {
      sanitized = sanitized.substring(0, maxLength);
    }
    
    return sanitized;
  }
  
  /**
   * Sanitize HTML content (allow safe tags only)
   * @param {string} html - HTML to sanitize
   * @returns {string}
   */
  static sanitizeHTML(html) {
    // Use Foundry's built-in TextEditor sanitization if available
    if (typeof TextEditor !== 'undefined' && TextEditor.enrichHTML) {
      // Create a temporary div to parse HTML
      const temp = document.createElement('div');
      temp.innerHTML = html;
      
      // Remove script tags
      temp.querySelectorAll('script').forEach(el => el.remove());
      
      // Remove dangerous attributes
      temp.querySelectorAll('*').forEach(el => {
        // Remove event handlers
        Array.from(el.attributes).forEach(attr => {
          if (attr.name.startsWith('on')) {
            el.removeAttribute(attr.name);
          }
        });
        
        // Remove javascript: links
        if (el.hasAttribute('href') && el.getAttribute('href').startsWith('javascript:')) {
          el.removeAttribute('href');
        }
      });
      
      return temp.innerHTML;
    }
    
    // Fallback: strip all HTML
    return this.sanitizeText(html);
  }
  
  /**
   * Validate and clamp number
   * @param {*} value - Value to validate
   * @param {number} min - Minimum value
   * @param {number} max - Maximum value
   * @param {number} defaultValue - Default if invalid
   * @returns {number}
   */
  static validateNumber(value, min, max, defaultValue) {
    const num = Number(value);
    
    if (isNaN(num)) {
      return defaultValue;
    }
    
    return Math.max(min, Math.min(max, num));
  }
  
  /**
   * Check if string is valid email format
   * @param {string} email - Email to check
   * @returns {boolean}
   */
  static isValidEmail(email) {
    // Basic email validation (cyberpunk style allows for creative domains)
    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return regex.test(email);
  }
  
  /**
   * Validate journal entry ID
   * @param {string} id - Journal ID
   * @returns {boolean}
   */
  static isValidJournalId(id) {
    return typeof id === 'string' && id.length > 0 && id.length <= 16;
  }
  
  /**
   * Validate actor ID
   * @param {string} id - Actor ID
   * @returns {boolean}
   */
  static isValidActorId(id) {
    return typeof id === 'string' && id.length > 0 && id.length <= 16;
  }
  
  /**
   * Sanitize network name
   * @param {string} network - Network name
   * @returns {string}
   */
  static sanitizeNetworkName(network) {
    // Convert to uppercase, remove special chars except underscore and dash
    return network.toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  }
}