/**
 * Handlebars Helpers - CLEAN VERSION
 * File: scripts/ui/helpers/HandlebarsHelpers.js
 * Module: cyberpunkred-messenger
 * Description: All Handlebars template helpers
 */

import { MODULE_ID } from '../../utils/constants.js';

export class HandlebarsHelpers {
  /**
   * Register all helpers
   */
  static register() {
    console.log(`${MODULE_ID} | Registering Handlebars helpers...`);
    
    // ========================================
    // Comparison Helpers
    // ========================================
    
    Handlebars.registerHelper('eq', function(a, b) {
      return a === b;
    });
    
    Handlebars.registerHelper('ne', function(a, b) {
      return a !== b;
    });
    
    Handlebars.registerHelper('lt', function(a, b) {
      return a < b;
    });
    
    Handlebars.registerHelper('gt', function(a, b) {
      return a > b;
    });
    
    Handlebars.registerHelper('lte', function(a, b) {
      return a <= b;
    });
    
    Handlebars.registerHelper('gte', function(a, b) {
      return a >= b;
    });
    
    Handlebars.registerHelper('and', function() {
      return Array.prototype.slice.call(arguments, 0, -1).every(Boolean);
    });
    
    Handlebars.registerHelper('or', function() {
      return Array.prototype.slice.call(arguments, 0, -1).some(Boolean);
    });
    
    Handlebars.registerHelper('not', function(value) {
      return !value;
    });
    
    // ========================================
    // Collection Helpers
    // ========================================
    
    Handlebars.registerHelper('includes', function(array, value) {
      if (!array) return false;
      
      if (array instanceof Set) {
        return array.has(value);
      }
      
      if (Array.isArray(array)) {
        return array.includes(value);
      }
      
      if (typeof array.has === 'function') {
        return array.has(value);
      }
      
      return false;
    });
    
    Handlebars.registerHelper('length', function(array) {
      if (!array) return 0;
      if (array instanceof Set || array instanceof Map) return array.size;
      if (Array.isArray(array)) return array.length;
      return 0;
    });
    
    // ========================================
    // String Helpers
    // ========================================
    
    Handlebars.registerHelper('uppercase', function(str) {
      return str ? str.toUpperCase() : '';
    });
    
    Handlebars.registerHelper('lowercase', function(str) {
      return str ? str.toLowerCase() : '';
    });
    
    Handlebars.registerHelper('truncate', function(str, length) {
      if (!str) return '';
      if (str.length <= length) return str;
      return str.substring(0, length) + '...';
    });
    
    // ========================================
    // Message Helpers
    // ========================================
    
    Handlebars.registerHelper('extractField', function(content, fieldName) {
      if (!content) return 'Unknown';
      
      try {
        const regex = new RegExp(`\\[${fieldName}\\](.+?)\\[End\\]`, 's');
        const match = content.match(regex);
        return match ? match[1].trim() : 'Unknown';
      } catch (error) {
        return 'Unknown';
      }
    });
    
    Handlebars.registerHelper('extractMessageText', function(content) {
      if (!content) return '<p>No content available</p>';
      
      try {
        const contentStr = String(content);
        
        // Check for journal-email-display format
        if (contentStr.includes('journal-email-display')) {
          const contentMatch = contentStr.match(/<div style="padding:15px;color:#ffffff;background-color:#1a1a1a">([\s\S]*?)<\/div>\s*<\/div>/);
          if (contentMatch && contentMatch[1]) {
            return new Handlebars.SafeString(contentMatch[1]);
          }
        }
        
        // Fallback to old format
        const lastEndIndex = contentStr.lastIndexOf('[End]');
        if (lastEndIndex !== -1) {
          return new Handlebars.SafeString(contentStr.substring(lastEndIndex + 5).trim());
        }
        
        return contentStr;
      } catch (error) {
        return '<p>Error processing message content</p>';
      }
    });
    
    // ========================================
    // Date/Time Helpers
    // ========================================
    
    
    // Format date and time together
    Handlebars.registerHelper('formatDateTime', function(timestamp) {
      if (!timestamp) return 'Unknown Date';
      
      try {
        const date = new Date(timestamp);
        
        if (isNaN(date.getTime())) return 'Invalid Date';
        
        // Format: "Oct 11, 2025 14:30"
        return date.toLocaleString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        });
      } catch (error) {
        console.error('Error formatting date:', error);
        return 'Invalid Date';
      }
    });
    
    // Format time only
    Handlebars.registerHelper('formatTime', function(timestamp) {
      if (!timestamp) return '';
      
      try {
        const date = new Date(timestamp);
        
        if (isNaN(date.getTime())) return '';
        
        // Format: "14:30"
        return date.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        });
      } catch (error) {
        console.error('Error formatting time:', error);
        return '';
      }
    });
    
    // Format date only
    Handlebars.registerHelper('formatDate', function(timestamp) {
      if (!timestamp) return '';
      
      try {
        const date = new Date(timestamp);
        
        if (isNaN(date.getTime())) return '';
        
        // Format: "Oct 11, 2025"
        return date.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric'
        });
      } catch (error) {
        console.error('Error formatting date:', error);
        return '';
      }
    });

    Handlebars.registerHelper('formatMessageTimestamp', function(timestamp) {
      if (!timestamp) return 'Unknown';
      
      try {
        const timeService = game.nightcity?.timeService;
        if (!timeService) {
          // Fallback if service not ready
          const date = new Date(timestamp);
          return date.toLocaleString();
        }
        
        // Use configured format from settings
        return timeService.formatTimestamp(timestamp);
      } catch (error) {
        console.error('Error formatting timestamp:', error);
        return 'Invalid Date';
      }
    });

    Handlebars.registerHelper('formatScheduledTime', function(scheduleData) {
      if (!scheduleData) return 'Unknown';
      
      try {
        const timeService = game.nightcity?.timeService;
        if (!timeService) return 'Unknown';
        
        // Check if using SimpleCalendar
        if (scheduleData.useSimpleCalendar && scheduleData.simpleCalendarData) {
          return scheduleData.simpleCalendarData.display;
        }
        
        return timeService.formatTimestamp(scheduleData.scheduledTime, 'full');
      } catch (error) {
        return 'Invalid';
      }
    });
    
    // Relative time (e.g., "2 hours ago")
    Handlebars.registerHelper('fromNow', function(timestamp) {
      if (!timestamp) return '';
      
      try {
        const date = new Date(timestamp);
        const now = new Date();
        const seconds = Math.floor((now - date) / 1000);
        
        if (seconds < 60) return 'just now';
        if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
        if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`;
        
        // Fall back to date format
        return date.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric'
        });
      } catch (error) {
        console.error('Error calculating relative time:', error);
        return '';
      }
    });
    
    // Legacy helper (kept for compatibility)
    Handlebars.registerHelper('timeAgo', function(date) {
      if (!date) return 'Unknown';
      
      const now = new Date();
      const then = new Date(date);
      const seconds = Math.floor((now - then) / 1000);
      
      if (seconds < 60) return 'Just now';
      if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
      if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
      return `${Math.floor(seconds / 86400)}d ago`;
    });
    
    // ========================================
    // Number Helpers
    // ========================================
    
    Handlebars.registerHelper('add', function(a, b) {
      return a + b;
    });
    
    Handlebars.registerHelper('subtract', function(a, b) {
      return a - b;
    });
    
    Handlebars.registerHelper('multiply', function(a, b) {
      return a * b;
    });
    
    Handlebars.registerHelper('divide', function(a, b) {
      return b !== 0 ? a / b : 0;
    });
    
    Handlebars.registerHelper('percentage', function(value, total) {
      if (!total || total === 0) return 0;
      return Math.round((value / total) * 100);
    });
    
    Handlebars.registerHelper('pluralize', function(count, singular, plural) {
      return count === 1 ? singular : (plural || singular + 's');
    });
    
    // ========================================
    // Conditional Helpers
    // ========================================
    
    Handlebars.registerHelper('ifCond', function(v1, operator, v2, options) {
      switch (operator) {
        case '==': return (v1 == v2) ? options.fn(this) : options.inverse(this);
        case '===': return (v1 === v2) ? options.fn(this) : options.inverse(this);
        case '!=': return (v1 != v2) ? options.fn(this) : options.inverse(this);
        case '!==': return (v1 !== v2) ? options.fn(this) : options.inverse(this);
        case '<': return (v1 < v2) ? options.fn(this) : options.inverse(this);
        case '<=': return (v1 <= v2) ? options.fn(this) : options.inverse(this);
        case '>': return (v1 > v2) ? options.fn(this) : options.inverse(this);
        case '>=': return (v1 >= v2) ? options.fn(this) : options.inverse(this);
        case '&&': return (v1 && v2) ? options.fn(this) : options.inverse(this);
        case '||': return (v1 || v2) ? options.fn(this) : options.inverse(this);
        default: return options.inverse(this);
      }
    });
    
    console.log(`${MODULE_ID} | ✓ Handlebars helpers registered`);
  }
}