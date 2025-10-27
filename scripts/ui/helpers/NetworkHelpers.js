/**
 * Handlebars Helpers for Network Selector
 * File: scripts/ui/helpers/NetworkHelpers.js
 * Module: cyberpunkred-messenger
 * Description: Helper functions for network selector templates
 */

/**
 * Register all network-related Handlebars helpers
 */
export function registerNetworkHelpers() {
  
  /**
   * Check if a network is currently connected
   * Usage: {{#if (isConnectedNetwork "CITINET")}}Connected{{/if}}
   */
  Handlebars.registerHelper('isConnectedNetwork', function(networkId) {
    const networkManager = game.nightcity?.networkManager;
    if (!networkManager) return false;
    
    const status = networkManager.getNetworkStatus();
    return status.connected && status.networkId === networkId;
  });

  /**
   * Generate signal bars HTML
   * Usage: {{{signalBars 75}}}
   */
  Handlebars.registerHelper('signalBars', function(strength) {
    if (typeof strength !== 'number') {
      strength = 0;
    }
    
    const NetworkUtils = game.nightcity?.NetworkUtils;
    if (!NetworkUtils) {
      return new Handlebars.SafeString('<span class="signal-error">N/A</span>');
    }
    
    return new Handlebars.SafeString(
      NetworkUtils.generateSignalBars(strength)
    );
  });

  /**
   * Get security icon based on level
   * Usage: {{{securityIcon "HIGH"}}}
   */
  Handlebars.registerHelper('securityIcon', function(level) {
    const icons = {
      'NONE': 'fa-unlock',
      'LOW': 'fa-lock',
      'MEDIUM': 'fa-lock',
      'HIGH': 'fa-shield-alt',
      'MAXIMUM': 'fa-shield-alt'
    };
    
    const icon = icons[level] || 'fa-question';
    return new Handlebars.SafeString(`<i class="fas ${icon}"></i>`);
  });

  /**
   * Get network type icon
   * Usage: {{{networkTypeIcon "PUBLIC"}}}
   */
  Handlebars.registerHelper('networkTypeIcon', function(type) {
    const NetworkUtils = game.nightcity?.NetworkUtils;
    if (!NetworkUtils) {
      return new Handlebars.SafeString('<i class="fas fa-wifi"></i>');
    }
    
    const icon = NetworkUtils.getNetworkTypeIcon(type);
    return new Handlebars.SafeString(`<i class="fas ${icon}"></i>`);
  });

  /**
   * Format network name with display name fallback
   * Usage: {{formatNetworkName network}}
   */
  Handlebars.registerHelper('formatNetworkName', function(network) {
    const NetworkUtils = game.nightcity?.NetworkUtils;
    if (!NetworkUtils) {
      return network?.displayName || network?.name || 'Unknown Network';
    }
    
    return NetworkUtils.formatNetworkName(network);
  });

  /**
   * Get network color based on type
   * Usage: <div style="color: {{networkColor network}};">
   */
  Handlebars.registerHelper('networkColor', function(network) {
    if (!network) return '#F65261';
    
    // Use explicit color if set
    if (network.color) return network.color;
    
    // Default colors by type
    const colors = {
      'PUBLIC': '#19f3f7',
      'CORPORATE': '#FFA500',
      'DARKNET': '#9D4EDD',
      'DEAD_ZONE': '#666666',
      'CUSTOM': '#F65261'
    };
    
    return colors[network.type] || colors.CUSTOM;
  });

  /**
   * Check if user can connect to network
   * Usage: {{#if (canConnectTo network)}}Show button{{/if}}
   */
  Handlebars.registerHelper('canConnectTo', function(network) {
    if (!network || network.available === false) return false;
    if (!network.requiresAuth) return true;
    
    // Check if authenticated
    const stateManager = game.nightcity?.stateManager;
    if (!stateManager) return false;
    
    const state = stateManager.getNetworkState();
    return state.authenticatedNetworks?.includes(network.id) || false;
  });

  /**
   * Check if network is locked
   * Usage: {{#if (isNetworkLocked network)}}Show lock{{/if}}
   */
  Handlebars.registerHelper('isNetworkLocked', function(network) {
    if (!network || !network.requiresAuth) return false;
    
    const stateManager = game.nightcity?.stateManager;
    if (!stateManager) return true;
    
    const state = stateManager.getNetworkState();
    return !state.authenticatedNetworks?.includes(network.id);
  });

  /**
   * Get signal strength class
   * Usage: <div class="{{signalClass 75}}">
   */
  Handlebars.registerHelper('signalClass', function(strength) {
    if (typeof strength !== 'number') return 'signal-none';
    
    if (strength >= 80) return 'signal-excellent';
    if (strength >= 60) return 'signal-good';
    if (strength >= 40) return 'signal-fair';
    if (strength >= 20) return 'signal-poor';
    return 'signal-weak';
  });

  /**
   * Get security level class
   * Usage: <div class="{{securityClass "HIGH"}}">
   */
  Handlebars.registerHelper('securityClass', function(level) {
    const classes = {
      'NONE': 'security-none',
      'LOW': 'security-low',
      'MEDIUM': 'security-medium',
      'HIGH': 'security-high',
      'MAXIMUM': 'security-maximum'
    };
    
    return classes[level] || 'security-unknown';
  });

  /**
   * Check if network has warnings
   * Usage: {{#if (hasNetworkWarnings network)}}Show warning{{/if}}
   */
  Handlebars.registerHelper('hasNetworkWarnings', function(network) {
    if (!network) return false;
    
    return network.traced || 
           network.monitored || 
           network.blackICE || 
           (network.type === 'DARKNET');
  });

  /**
   * Get network warning text
   * Usage: {{networkWarningText network}}
   */
  Handlebars.registerHelper('networkWarningText', function(network) {
    if (!network) return '';
    
    const warnings = [];
    
    if (network.traced) warnings.push('TRACED');
    if (network.monitored) warnings.push('MONITORED');
    if (network.blackICE) warnings.push('BLACK ICE');
    if (network.type === 'DARKNET') warnings.push('UNDERGROUND');
    
    return warnings.join(' • ');
  });

  /**
   * Check if user is GM
   * Usage: {{#if isGM}}Show GM controls{{/if}}
   */
  Handlebars.registerHelper('isGM', function() {
    return game.user?.isGM || false;
  });

  /**
   * Format timestamp for network activity
   * Usage: {{formatTimestamp timestamp}}
   */
  Handlebars.registerHelper('formatTimestamp', function(timestamp) {
    if (!timestamp) return 'Unknown';
    
    const date = new Date(timestamp);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    
    return `${day}.${month}.${year} // ${hours}:${minutes}`;
  });

  /**
   * Calculate signal percentage
   * Usage: {{signalPercentage strength}}
   */
  Handlebars.registerHelper('signalPercentage', function(strength) {
    if (typeof strength !== 'number') return '0%';
    return `${Math.round(strength)}%`;
  });

  /**
   * Check if network is available
   * Usage: {{#if (isNetworkAvailable network)}}Available{{/if}}
   */
  Handlebars.registerHelper('isNetworkAvailable', function(network) {
    if (!network) return false;
    return network.available !== false;
  });

  /**
   * Get network description with fallback
   * Usage: {{networkDescription network}}
   */
  Handlebars.registerHelper('networkDescription', function(network) {
    if (!network) return 'No information available';
    
    if (network.description) return network.description;
    
    // Default descriptions by type
    const descriptions = {
      'PUBLIC': 'Open public network accessible to all users',
      'CORPORATE': 'Secured corporate network requiring authentication',
      'DARKNET': 'Underground network used for illicit activities',
      'DEAD_ZONE': 'No network coverage in this area',
      'CUSTOM': 'Custom network configuration'
    };
    
    return descriptions[network.type] || 'Network information unavailable';
  });

  /**
   * Check if network requires authentication
   * Usage: {{#if (requiresAuth network)}}Show auth{{/if}}
   */
  Handlebars.registerHelper('requiresAuth', function(network) {
    return network?.requiresAuth || false;
  });

  /**
   * Get breach DV for network
   * Usage: DV{{breachDV network}}
   */
  Handlebars.registerHelper('breachDV', function(network) {
    if (!network || !network.security) return 15;
    
    const dvMap = {
      'NONE': 10,
      'LOW': 13,
      'MEDIUM': 15,
      'HIGH': 17,
      'MAXIMUM': 21
    };
    
    return dvMap[network.security.level] || 15;
  });

  /**
   * Compare two values for equality
   * Usage: {{#if (eq value1 value2)}}Equal{{/if}}
   */
  Handlebars.registerHelper('eq', function(a, b) {
    return a === b;
  });

  /**
   * Check if value is in array
   * Usage: {{#if (includes array value)}}Found{{/if}}
   */
  Handlebars.registerHelper('includes', function(array, value) {
    if (!Array.isArray(array)) return false;
    return array.includes(value);
  });

  /**
   * Get network status text
   * Usage: {{networkStatus network}}
   */
  Handlebars.registerHelper('networkStatus', function(network) {
    const networkManager = game.nightcity?.networkManager;
    if (!networkManager) return 'Unknown';
    
    const status = networkManager.getNetworkStatus();
    
    if (!status.connected) return 'Disconnected';
    if (status.networkId !== network?.id) return 'Available';
    
    if (status.signalStrength < 30) return 'Weak Signal';
    if (status.signalStrength < 60) return 'Fair Signal';
    if (status.signalStrength < 90) return 'Good Signal';
    return 'Connected';
  });

  /**
   * Get network range text
   * Usage: {{rangeText network}}
   */
  Handlebars.registerHelper('rangeText', function(network) {
    if (!network || typeof network.range !== 'number') return 'Unknown';
    
    const range = network.range;
    if (range >= 100) return 'Excellent';
    if (range >= 75) return 'Good';
    if (range >= 50) return 'Fair';
    if (range >= 25) return 'Poor';
    return 'Weak';
  });

  /**
   * Pluralize text based on count
   * Usage: {{pluralize count "network" "networks"}}
   */
  Handlebars.registerHelper('pluralize', function(count, singular, plural) {
    return count === 1 ? singular : plural;
  });

  /**
   * Truncate text with ellipsis
   * Usage: {{truncate text 50}}
   */
  Handlebars.registerHelper('truncate', function(text, length) {
    if (!text) return '';
    if (typeof text !== 'string') text = String(text);
    if (text.length <= length) return text;
    return text.substring(0, length) + '...';
  });

  console.log('NCM | Network Handlebars helpers registered');
}