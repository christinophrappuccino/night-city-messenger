/**
 * Network Service - FIXED
 * File: scripts/services/NetworkService.js
 * Module: cyberpunkred-messenger
 * Description: Manages network connections, signal strength, and access control
 * 
 * FIX: _isValidNetwork() now properly checks custom network IDs
 */

import { MODULE_ID, NETWORKS, NETWORK_RELIABILITY } from '../utils/constants.js';

export class NetworkService {
  constructor(stateManager, eventBus) {
    this.stateManager = stateManager;
    this.eventBus = eventBus;
    
    console.log(`${MODULE_ID} | NetworkService initialized`);
  }
  
  /**
   * Get current network
   * @returns {string} Current network name
   */
  getCurrentNetwork() {
    return this.stateManager.get('currentNetwork') || NETWORKS.CITINET;
  }
  
  /**
   * Get current signal strength
   * @returns {number} Signal strength (0-100)
   */
  getSignalStrength() {
    return this.stateManager.get('signalStrength') || 100;
  }
  
  /**
   * Set current network
   * @param {string} network - Network to switch to
   * @param {Object} options - Options
   */
  async setCurrentNetwork(network, options = {}) {
    const oldNetwork = this.getCurrentNetwork();
    
    console.log(`${MODULE_ID} | Switching network: ${oldNetwork} → ${network}`);
    
    // Validate network
    if (!this._isValidNetwork(network)) {
      throw new Error(`Invalid network: ${network}`);
    }
    
    // Update state
    this.stateManager.set('currentNetwork', network);
    
    // Update signal strength based on network
    const reliability = this._getNetworkReliability(network);
    this.stateManager.set('signalStrength', reliability);
    
    // Emit event
    this.eventBus.emit('network:changed', {
      oldNetwork,
      newNetwork: network,
      signalStrength: reliability
    });
    
    // Show notification unless silent
    if (!options.silent) {
      ui.notifications.info(`Connected to ${network}`);
    }
  }
  
  /**
   * Check if can access a specific network
   * @param {string} requiredNetwork - Network that's required
   * @returns {boolean} Can access
   */
  canAccessNetwork(requiredNetwork) {
    if (!requiredNetwork) return true; // No requirement
    
    const currentNetwork = this.getCurrentNetwork();
    
    // Check if on correct network
    if (currentNetwork === requiredNetwork) {
      return true;
    }
    
    // Dead zones can't access anything
    if (currentNetwork === NETWORKS.DEAD_ZONE) {
      return false;
    }
    
    // Check if network is bridged (future feature)
    if (this._isNetworkBridged(currentNetwork, requiredNetwork)) {
      return true;
    }
    
    return false;
  }
  
  /**
   * Check network requirements for data shard
   * @param {Item} item - Data shard item
   * @returns {Object} Network check result
   */
  checkNetworkRequirement(item) {
    const requiresNetwork = item.getFlag(MODULE_ID, 'requiresNetwork');
    
    // No requirement
    if (!requiresNetwork) {
      return {
        required: false,
        accessible: true,
        currentNetwork: this.getCurrentNetwork(),
        requiredNetwork: null
      };
    }
    
    const requiredNetwork = item.getFlag(MODULE_ID, 'requiredNetwork');
    const currentNetwork = this.getCurrentNetwork();
    const canAccess = this.canAccessNetwork(requiredNetwork);
    
    return {
      required: true,
      accessible: canAccess,
      currentNetwork,
      requiredNetwork,
      signalStrength: this.getSignalStrength()
    };
  }
  
  /**
   * Get network info
   * @param {string} network - Network name
   * @returns {Object} Network information
   */
  getNetworkInfo(network) {
    const reliability = this._getNetworkReliability(network);
    
    return {
      name: network,
      displayName: this._getNetworkDisplayName(network),
      reliability,
      description: this._getNetworkDescription(network),
      color: this._getNetworkColor(network),
      icon: this._getNetworkIcon(network)
    };
  }
  
  /**
   * Get all available networks
   * @returns {Array<Object>} Array of network info
   */
  getAvailableNetworks() {
    const networks = [
      NETWORKS.CITINET,
      NETWORKS.CORPNET,
      NETWORKS.DARKNET,
      NETWORKS.DEAD_ZONE
    ];
    
    // Add custom networks from settings
    const customNetworks = game.settings.get(MODULE_ID, 'customNetworks') || [];
    // Extract just the IDs from custom networks
    const customNetworkIds = customNetworks.map(n => n.id);
    networks.push(...customNetworkIds);
    
    return networks.map(n => this.getNetworkInfo(n));
  }
  
  /**
   * Attempt to switch networks (requires skill check in future)
   * @param {string} targetNetwork - Network to switch to
   * @param {Actor} actor - Actor attempting switch (optional)
   * @returns {Promise<boolean>} Success
   */
  async attemptNetworkSwitch(targetNetwork, actor = null) {
    // For now, just switch
    // In future: require Interface skill check, take time, etc.
    
    try {
      await this.setCurrentNetwork(targetNetwork);
      return true;
    } catch (error) {
      console.error(`${MODULE_ID} | Network switch failed:`, error);
      ui.notifications.error(`Failed to connect to ${targetNetwork}`);
      return false;
    }
  }
  
  /**
   * Get network reliability
   * @private
   */
  _getNetworkReliability(network) {
    // Check custom networks first
    const customNetworks = game.settings.get(MODULE_ID, 'customNetworks') || [];
    const customNetwork = customNetworks.find(n => n.id === network);
    if (customNetwork && typeof customNetwork.reliability === 'number') {
      return customNetwork.reliability;
    }
    
    // Fall back to standard networks
    return NETWORK_RELIABILITY[network] || 95;
  }
  
  /**
   * Check if network is valid
   * @private
   * 
   * FIX: Now properly checks if custom network IDs exist
   */
  _isValidNetwork(network) {
    const standardNetworks = Object.values(NETWORKS);
    
    // Check standard networks first
    if (standardNetworks.includes(network)) {
      return true;
    }
    
    // Check custom networks by ID (not by object equality!)
    const customNetworks = game.settings.get(MODULE_ID, 'customNetworks') || [];
    return customNetworks.some(n => n.id === network);
  }
  
  /**
   * Check if networks are bridged (future feature)
   * @private
   */
  _isNetworkBridged(currentNetwork, requiredNetwork) {
    // Future: Allow certain networks to access others
    // e.g., CORPNET might bridge to DARKNET in certain conditions
    return false;
  }
  
  /**
   * Get display name for network
   * @private
   */
  _getNetworkDisplayName(network) {
    // Check custom networks
    const customNetworks = game.settings.get(MODULE_ID, 'customNetworks') || [];
    const customNetwork = customNetworks.find(n => n.id === network);
    if (customNetwork) {
      return customNetwork.name || network;
    }
    
    // Standard network names
    const names = {
      [NETWORKS.CITINET]: 'CitiNet',
      [NETWORKS.CORPNET]: 'CorpNet',
      [NETWORKS.DARKNET]: 'DarkNet',
      [NETWORKS.DEAD_ZONE]: 'Dead Zone'
    };
    
    return names[network] || network;
  }
  
  /**
   * Get description for network
   * @private
   */
  _getNetworkDescription(network) {
    // Check custom networks
    const customNetworks = game.settings.get(MODULE_ID, 'customNetworks') || [];
    const customNetwork = customNetworks.find(n => n.id === network);
    if (customNetwork) {
      return customNetwork.description || '';
    }
    
    const descriptions = {
      [NETWORKS.CITINET]: 'Night City\'s public network',
      [NETWORKS.CORPNET]: 'Corporate network - high security',
      [NETWORKS.DARKNET]: 'Underground network - anonymous',
      [NETWORKS.DEAD_ZONE]: 'No connectivity'
    };
    
    return descriptions[network] || '';
  }
  
  /**
   * Get color for network
   * @private
   */
  _getNetworkColor(network) {
    // Check custom networks
    const customNetworks = game.settings.get(MODULE_ID, 'customNetworks') || [];
    const customNetwork = customNetworks.find(n => n.id === network);
    if (customNetwork?.theme?.color) {
      return customNetwork.theme.color;
    }
    
    const colors = {
      [NETWORKS.CITINET]: '#19f3f7',
      [NETWORKS.CORPNET]: '#F65261',
      [NETWORKS.DARKNET]: '#9400D3',
      [NETWORKS.DEAD_ZONE]: '#666666'
    };
    
    return colors[network] || '#19f3f7';
  }
  
  /**
   * Get icon for network
   * @private
   */
  _getNetworkIcon(network) {
    // Check custom networks
    const customNetworks = game.settings.get(MODULE_ID, 'customNetworks') || [];
    const customNetwork = customNetworks.find(n => n.id === network);
    if (customNetwork?.theme?.icon) {
      return customNetwork.theme.icon;
    }
    
    const icons = {
      [NETWORKS.CITINET]: 'fa-wifi',
      [NETWORKS.CORPNET]: 'fa-building',
      [NETWORKS.DARKNET]: 'fa-user-secret',
      [NETWORKS.DEAD_ZONE]: 'fa-ban'
    };
    
    return icons[network] || 'fa-network-wired';
  }
}