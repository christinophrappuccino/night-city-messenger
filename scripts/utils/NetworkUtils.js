/**
 * NetworkUtils
 * File: scripts/utils/NetworkUtils.js
 * Module: cyberpunkred-messenger
 * Description: Helper functions for network operations and UI
 */

import { MODULE_ID } from './constants.js';

export class NetworkUtils {
  
  /**
   * Format network name for display
   * @param {Object|string} network - Network object or name
   * @returns {string} Formatted name
   */
  static formatNetworkName(network) {
    if (!network) return 'NO SIGNAL';
    
    if (typeof network === 'string') {
      return network.toUpperCase();
    }
    
    return (network.name || 'UNKNOWN').toUpperCase();
  }
  
  /**
   * Get signal strength CSS class
   * @param {number} strength - Signal strength (0-100)
   * @returns {string} CSS class name
   */
  static getSignalClass(strength) {
    if (strength >= 80) return 'signal-excellent';
    if (strength >= 60) return 'signal-good';
    if (strength >= 40) return 'signal-fair';
    if (strength >= 20) return 'signal-poor';
    return 'signal-none';
  }
  
  /**
   * Format security level for display
   * @param {string} level - Security level
   * @returns {string} Display text
   */
  static formatSecurityLevel(level) {
    const levels = {
      'none': 'OPEN',
      'low': 'LOW SECURITY',
      'medium': 'MEDIUM SECURITY',
      'high': 'HIGH SECURITY',
      'black-ice': 'BLACK ICE ACTIVE'
    };
    return levels[level] || 'UNKNOWN';
  }
  
  /**
   * Generate signal strength bars HTML
   * @param {number} strength - Signal strength (0-100)
   * @returns {string} HTML for signal bars
   */
  static generateSignalBars(strength) {
    const bars = 4;
    const activeBars = Math.ceil((strength / 100) * bars);
    const signalClass = this.getSignalClass(strength);
    
    let html = `<div class="signal-bars ${signalClass}">`;
    for (let i = 1; i <= bars; i++) {
      const height = i * 3;
      const active = i <= activeBars ? 'active' : '';
      html += `<div class="signal-bar bar-${i} ${active}" style="height: ${height}px;"></div>`;
    }
    html += '</div>';
    
    return html;
  }
  
  /**
   * Check if user can manage networks (GM only)
   * @returns {boolean}
   */
  static canManageNetworks() {
    return game.user.isGM;
  }
  
  /**
   * Get network type icon
   * @param {string} type - Network type
   * @returns {string} FontAwesome icon class
   */
  static getNetworkTypeIcon(type) {
    const icons = {
      'public': 'fa-wifi',
      'corporate': 'fa-building',
      'darknet': 'fa-user-secret',
      'military': 'fa-shield-alt',
      'custom': 'fa-network-wired',
      'none': 'fa-ban'
    };
    return icons[type] || 'fa-question';
  }
  
  /**
   * Get network type color
   * @param {string} type - Network type
   * @returns {string} Hex color
   */
  static getNetworkTypeColor(type) {
    const colors = {
      'public': '#19f3f7',
      'corporate': '#FFD700',
      'darknet': '#9400D3',
      'military': '#ff0000',
      'custom': '#ffff00',
      'none': '#666666'
    };
    return colors[type] || '#ffffff';
  }
  
  /**
   * Format network reliability as percentage
   * @param {number} reliability - Reliability (0-100)
   * @returns {string} Formatted percentage
   */
  static formatReliability(reliability) {
    if (reliability >= 95) return 'EXCELLENT';
    if (reliability >= 85) return 'GOOD';
    if (reliability >= 70) return 'FAIR';
    if (reliability >= 50) return 'POOR';
    return 'UNSTABLE';
  }
  
  /**
   * Calculate network bypass DC based on security level
   * @param {string} securityLevel - Security level
   * @returns {number} Difficulty Class
   */
  static getDefaultBypassDC(securityLevel) {
    const dcs = {
      'none': 0,
      'low': 10,
      'medium': 13,
      'high': 17,
      'black-ice': 20
    };
    return dcs[securityLevel] || 15;
  }
  
  /**
   * Get security icon
   * @param {string} level - Security level
   * @returns {string} FontAwesome icon class
   */
  static getSecurityIcon(level) {
    const icons = {
      'none': 'fa-unlock',
      'low': 'fa-lock-open',
      'medium': 'fa-lock',
      'high': 'fa-shield-alt',
      'black-ice': 'fa-skull-crossbones'
    };
    return icons[level] || 'fa-lock';
  }
  
  /**
   * Format lockout duration
   * @param {number} duration - Duration in milliseconds
   * @returns {string} Human-readable duration
   */
  static formatLockoutDuration(duration) {
    const seconds = Math.floor(duration / 1000);
    const minutes = Math.floor(seconds / 60);
    
    if (minutes > 0) {
      const remainingSeconds = seconds % 60;
      if (remainingSeconds > 0) {
        return `${minutes}m ${remainingSeconds}s`;
      }
      return `${minutes}m`;
    }
    
    return `${seconds}s`;
  }
  
  /**
   * Validate network ID format
   * @param {string} id - Network ID
   * @returns {boolean} Is valid
   */
  static isValidNetworkId(id) {
    if (!id || typeof id !== 'string') return false;
    // Allow alphanumeric, underscores, hyphens
    return /^[A-Z0-9_-]+$/i.test(id);
  }
  
  /**
   * Sanitize network name for use as ID
   * @param {string} name - Network name
   * @returns {string} Sanitized ID
   */
  static sanitizeNetworkId(name) {
    if (!name) return '';
    
    return name
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }
  
  /**
   * Get network description based on type
   * @param {string} type - Network type
   * @returns {string} Default description
   */
  static getDefaultDescription(type) {
    const descriptions = {
      'public': 'Public network accessible to all citizens.',
      'corporate': 'Secure corporate network with monitoring.',
      'darknet': 'Underground network for anonymous communication.',
      'military': 'Military-grade encrypted network.',
      'custom': 'Custom network configuration.'
    };
    return descriptions[type] || 'Custom network.';
  }
  
  /**
   * Check if network is traced (monitored)
   * @param {Object} network - Network object
   * @returns {boolean} Is traced
   */
  static isNetworkTraced(network) {
    return network?.effects?.traced === true;
  }
  
  /**
   * Check if network provides anonymity
   * @param {Object} network - Network object
   * @returns {boolean} Is anonymous
   */
  static isNetworkAnonymous(network) {
    return network?.effects?.anonymity === true;
  }
  
  /**
   * Get warning message for network type
   * @param {Object} network - Network object
   * @returns {string|null} Warning message or null
   */
  static getNetworkWarning(network) {
    if (!network) return null;
    
    if (network.effects?.traced) {
      return 'WARNING: Network activity is monitored by NetWatch';
    }
    
    if (network.security?.level === 'black-ice') {
      return 'DANGER: BLACK ICE protection active - failed breaches cause damage';
    }
    
    if (network.reliability < 50) {
      return 'WARNING: Unstable connection - messages may fail';
    }
    
    return null;
  }
  
  /**
   * Sort networks by priority for display
   * @param {Array} networks - Array of networks
   * @returns {Array} Sorted networks
   */
  static sortNetworksByPriority(networks) {
    return networks.sort((a, b) => {
      // Global networks first
      if (a.availability.global && !b.availability.global) return -1;
      if (!a.availability.global && b.availability.global) return 1;
      
      // Then by signal strength
      if (a.signalStrength !== b.signalStrength) {
        return b.signalStrength - a.signalStrength;
      }
      
      // Then alphabetically
      return a.name.localeCompare(b.name);
    });
  }
  
  /**
   * Create network badge HTML
   * @param {Object} network - Network object
   * @returns {string} HTML for network badge
   */
  static createNetworkBadge(network) {
    if (!network) return '';
    
    const color = network.theme?.color || '#19f3f7';
    const icon = network.theme?.icon || 'fa-wifi';
    
    return `
      <div class="network-badge" style="color: ${color};">
        <i class="fas ${icon}"></i>
        <span>${network.name}</span>
      </div>
    `;
  }
  
  /**
   * Format network status message
   * @param {Object} status - Network status object
   * @returns {string} Status message
   */
  static formatNetworkStatus(status) {
    if (!status.connected) {
      return status.searching ? 'Searching for networks...' : 'No network connection';
    }
    
    return `Connected to ${status.networkId || 'unknown'}`;
  }
  
  /**
   * Calculate estimated message delay
   * @param {Object} network - Network object
   * @returns {string} Human-readable delay
   */
  static getMessageDelay(network) {
    if (!network || !network.effects?.messageDelay) {
      return 'Instant';
    }
    
    const delay = network.effects.messageDelay;
    if (delay < 60) {
      return `${delay}s`;
    }
    
    const minutes = Math.floor(delay / 60);
    return `${minutes}m`;
  }
}