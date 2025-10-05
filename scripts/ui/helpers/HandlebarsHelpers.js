/**
 * Handlebars Helpers
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
    // Date Helpers
    // ========================================
    
    Handlebars.registerHelper('formatDate', function(date) {
      if (!date) return 'Unknown';
      return new Date(date).toLocaleString();
    });
    
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