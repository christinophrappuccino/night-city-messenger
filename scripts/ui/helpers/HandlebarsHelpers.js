/**
 * Handlebars Helpers - CORRECTED VERSION
 * File: scripts/ui/helpers/HandlebarsHelpers.js
 * Module: cyberpunkred-messenger
 * Description: All Handlebars template helpers with FIXED SCOPING
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
    // Item Inbox Helpers
    // ========================================
    
    // Checkbox checked attribute
    Handlebars.registerHelper('checked', function(condition) {
      return condition ? 'checked' : '';
    });
    
    // Select option selected attribute
    Handlebars.registerHelper('selected', function(condition) {
      return condition ? 'selected' : '';
    });
    
    // Check if encryption type is lethal (BLACK_ICE or RED_ICE)
    Handlebars.registerHelper('isLethalICE', function(encryptionType) {
      return encryptionType === 'BLACK_ICE' || encryptionType === 'RED_ICE';
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
    
    // ========================================
    // Scenes Tab Helpers
    // ========================================
    
    /**
     * Generate signal bar data for visualization
     * @param {number} signalStrength - Signal strength (0-100)
     * @returns {Array} Array of bar objects with height and active state
     */
    Handlebars.registerHelper('signalBars', function(signalStrength) {
      const numBars = 5;
      const bars = [];
      const threshold = signalStrength / 100;
      
      for (let i = 0; i < numBars; i++) {
        const barThreshold = (i + 1) / numBars;
        bars.push({
          height: (i + 1) * 20, // 20%, 40%, 60%, 80%, 100%
          active: threshold >= barThreshold
        });
      }
      
      return bars;
    });
    
    /**
     * Get security level CSS class
     */
    Handlebars.registerHelper('securityLevelClass', function(level) {
      return `security-${level}`;
    });
    
    /**
     * Format signal strength as status text
     */
    Handlebars.registerHelper('signalStatus', function(signalStrength) {
      if (signalStrength >= 80) return 'Excellent';
      if (signalStrength >= 60) return 'Good';
      if (signalStrength >= 40) return 'Fair';
      if (signalStrength >= 20) return 'Weak';
      return 'Very Weak';
    });
    
    /**
     * Get signal status badge class
     */
    Handlebars.registerHelper('signalBadgeClass', function(signalStrength) {
      if (signalStrength >= 80) return 'ncm-badge--success';
      if (signalStrength >= 60) return 'ncm-badge--info';
      if (signalStrength >= 40) return 'ncm-badge--warning';
      return 'ncm-badge--danger';
    });
    
    /**
     * Check if network has override
     */
    Handlebars.registerHelper('hasOverride', function(sceneConfig) {
      return sceneConfig?.override && Object.keys(sceneConfig.override).length > 0;
    });
    
    /**
     * Count active overrides
     */
    Handlebars.registerHelper('countOverrides', function(override) {
      if (!override) return 0;
      
      let count = 0;
      if (override.security) count++;
      if (override.reliability !== undefined) count++;
      if (override.features && Object.keys(override.features).length > 0) {
        count += Object.keys(override.features).length;
      }
      
      return count;
    });
    
    /**
     * Format scene dimensions
     */
    Handlebars.registerHelper('formatDimensions', function(width, height) {
      return `${width} × ${height} px`;
    });
    
    /**
     * Get network icon with fallback
     */
    Handlebars.registerHelper('networkIcon', function(network) {
      return network?.theme?.icon || 'fas fa-network-wired';
    });
    
    /**
     * Get network color with fallback
     */
    Handlebars.registerHelper('networkColor', function(network) {
      return network?.theme?.color || '#F65261';
    });
    
    /**
     * JSON stringify for debugging
     */
    Handlebars.registerHelper('json', function(obj) {
      return JSON.stringify(obj, null, 2);
    });
    
    /**
     * Check if value is truthy
     */
    Handlebars.registerHelper('isTruthy', function(value) {
      return !!value;
    });
    
    /**
     * Check if value is falsy
     */
    Handlebars.registerHelper('isFalsy', function(value) {
      return !value;
    });
    
    /**
     * Conditional block with multiple conditions
     */
    Handlebars.registerHelper('cond', function(v1, operator, v2, options) {
      switch (operator) {
        case '==': return v1 == v2 ? options.fn(this) : options.inverse(this);
        case '===': return v1 === v2 ? options.fn(this) : options.inverse(this);
        case '!=': return v1 != v2 ? options.fn(this) : options.inverse(this);
        case '!==': return v1 !== v2 ? options.fn(this) : options.inverse(this);
        case '<': return v1 < v2 ? options.fn(this) : options.inverse(this);
        case '<=': return v1 <= v2 ? options.fn(this) : options.inverse(this);
        case '>': return v1 > v2 ? options.fn(this) : options.inverse(this);
        case '>=': return v1 >= v2 ? options.fn(this) : options.inverse(this);
        case '&&': return v1 && v2 ? options.fn(this) : options.inverse(this);
        case '||': return v1 || v2 ? options.fn(this) : options.inverse(this);
        default: return options.inverse(this);
      }
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