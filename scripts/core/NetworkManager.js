/**
 * NetworkManager - REFACTORED
 * File: scripts/core/NetworkManager.js
 * Module: cyberpunkred-messenger
 * Description: Simplified network management with scene-based availability as single source of truth
 * 
 * CHANGES FROM PREVIOUS VERSION:
 * - Removed: availability.scenes arrays from network objects
 * - Removed: hidden flag logic and _isNetworkExplicitlyConfigured()
 * - Simplified: getAvailableNetworks() now only checks scene flags
 * - Single Source of Truth: Scene flags determine availability, Network Tab stores properties only
 */

import { MODULE_ID, NETWORKS, NETWORK_RELIABILITY } from '../utils/constants.js';

export class NetworkManager {
  constructor(networkService, stateManager, eventBus) {
    this.networkService = networkService; // Existing service
    this.stateManager = stateManager;
    this.eventBus = eventBus;
    
    this.authenticatedNetworks = new Set();
    this.securityService = null;
    this.failedAttempts = new Map();
    this.knownNetworks = new Set();
    
    console.log(`${MODULE_ID} | NetworkManager initialized (refactored - scene-based)`);
  }
  
  /**
   * Initialize network manager
   * Called during module ready phase
   */
  async initialize() {
    console.log(`${MODULE_ID} | NetworkManager: Starting initialization...`);
    
    // Load or create default networks
    let networks = await this.getAllNetworks();
    if (!networks || networks.length === 0) {
      console.log(`${MODULE_ID} | No custom networks found, creating defaults...`);
      networks = await this._createDefaultNetworks();
    }
    
    // Load user's network state
    await this._loadNetworkState();
    
    // Scan for available networks in current scene
    await this.scanNetworks();

    // Initialize security service
    const { NetworkSecurityService } = await import('../services/NetworkSecurityService.js');
    this.securityService = new NetworkSecurityService();
    game.nightcity.networkSecurityService = this.securityService;
    
    console.log(`${MODULE_ID} | NetworkManager initialized with security service`);
    
    // Register hooks
    this._registerHooks();
    
    console.log(`${MODULE_ID} | NetworkManager initialized with ${networks.length} networks`);
  }
  
  /**
   * Get all networks (properties only, no availability logic)
   * @returns {Promise<Array<Object>>} All network definitions
   */
  async getAllNetworks() {
    const customNetworks = await game.settings.get(MODULE_ID, 'customNetworks') || [];
    return customNetworks;
  }
  
  /**
   * Get networks available in current scene
   * SIMPLIFIED: Scene flags are the single source of truth for availability
   * @param {Scene} scene - Scene to check (defaults to current scene)
   * @returns {Promise<Array<Object>>} Available networks
   */
  async getAvailableNetworks(scene = null) {
    // Use current scene if not provided
    if (!scene) {
      scene = game.scenes.active;
    }
    
    if (!scene) {
      console.warn(`${MODULE_ID} | No scene available for network check`);
      return [];
    }
    
    const allNetworks = await this.getAllNetworks();
    const sceneNetworkConfig = scene.getFlag(MODULE_ID, 'networks') || {};
    
    return allNetworks.filter(network => {
      const config = sceneNetworkConfig[network.id];
      
      // Simple: Is this network explicitly enabled in the scene?
      return config?.available === true;
    });
  }

  /**
   * Check if a specific network is available in the scene
   * @param {string} networkId - Network ID to check
   * @param {Scene} scene - Scene to check (defaults to current scene)
   * @returns {Promise<boolean>} True if network is available
   */
  async isNetworkAvailable(networkId, scene = null) {
    if (!scene) {
      scene = game.scenes.active;
    }
    
    if (!scene) return false;
    
    const sceneNetworkConfig = scene.getFlag(MODULE_ID, 'networks') || {};
    return sceneNetworkConfig[networkId]?.available === true;
  }

  /**
   * Get network signal strength for a scene
   * @param {string} networkId - Network ID
   * @param {Scene} scene - Scene to check (defaults to current scene)
   * @returns {Promise<number>} Signal strength (0-100)
   */
  async getNetworkSignalStrength(networkId, scene = null) {
    if (!scene) {
      scene = game.scenes.active;
    }
    
    if (!scene) return 0;
    
    const sceneNetworkConfig = scene.getFlag(MODULE_ID, 'networks') || {};
    const config = sceneNetworkConfig[networkId];
    
    if (!config?.available) return 0;
    
    return config.signalStrength || 0;
  }
  
  /**
   * Create default network definitions
   * SIMPLIFIED: No availability arrays, properties only
   * @private
   */
  async _createDefaultNetworks() {
    const defaultNetworks = [
      {
        id: 'CITINET',
        name: 'CitiNet',
        type: 'public',
        signalStrength: 90,
        reliability: 95,
        security: {
          level: 'none',
          requiresAuth: false,
          password: null,
          bypassDC: 0,
          attempts: 999,
          lockoutDuration: 0
        },
        effects: {
          messageDelay: 0,
          traced: false,
          anonymity: false,
          canRoute: true
        },
        theme: {
          color: '#19f3f7',
          icon: 'fa-wifi',
          glitchIntensity: 0.1
        },
        description: 'Night City\'s public network. Standard connectivity.',
        gmNotes: 'Default public access'
      },
      {
        id: 'CORPNET',
        name: 'CorpNet',
        type: 'corporate',
        signalStrength: 95,
        reliability: 99,
        security: {
          level: 'medium',
          requiresAuth: true,
          password: null,
          bypassDC: 15,
          attempts: 3,
          lockoutDuration: 3600
        },
        effects: {
          messageDelay: 0,
          traced: true,
          anonymity: false,
          canRoute: false
        },
        theme: {
          color: '#FFD700',
          icon: 'fa-building',
          glitchIntensity: 0.05
        },
        description: 'Corporate network. Requires authentication. High security.',
        gmNotes: 'Monitored by corp security'
      },
      {
        id: 'DARKNET',
        name: 'DarkNet',
        type: 'underground',
        signalStrength: 60,
        reliability: 70,
        security: {
          level: 'high',
          requiresAuth: true,
          password: null,
          bypassDC: 20,
          attempts: 5,
          lockoutDuration: 7200
        },
        effects: {
          messageDelay: 2000,
          traced: false,
          anonymity: true,
          canRoute: true
        },
        theme: {
          color: '#9400D3',
          icon: 'fa-user-secret',
          glitchIntensity: 0.3
        },
        description: 'Underground network. Anonymized routing. Unstable.',
        gmNotes: 'NetWatch monitored'
      },
      {
        id: 'DEAD_ZONE',
        name: 'Dead Zone',
        type: 'none',
        signalStrength: 0,
        reliability: 0,
        security: {
          level: 'none',
          requiresAuth: false,
          password: null,
          bypassDC: 0,
          attempts: 0,
          lockoutDuration: 0
        },
        effects: {
          messageDelay: 0,
          traced: false,
          anonymity: false,
          canRoute: false
        },
        theme: {
          color: '#666666',
          icon: 'fa-ban',
          glitchIntensity: 0
        },
        description: 'No network coverage. Complete blackout.',
        gmNotes: 'No connectivity'
      }
    ];
    
    await game.settings.set(MODULE_ID, 'customNetworks', defaultNetworks);
    console.log(`${MODULE_ID} | Created ${defaultNetworks.length} default networks`);
    
    return defaultNetworks;
  }
  
  /**
   * Scan for available networks in current scene
   * @returns {Promise<Array<Object>>} Available networks
   */
  async scanNetworks() {
    const scene = game.scenes.active;
    if (!scene) {
      console.warn(`${MODULE_ID} | No active scene for network scan`);
      return [];
    }
    
    const available = await this.getAvailableNetworks(scene);
    
    // Update state
    if (this.stateManager) {
      this.stateManager.setState({
        availableNetworks: available.map(n => n.id)
      });
    }
    
    // Emit event
    if (this.eventBus) {
      this.eventBus.emit('networks:scanned', { 
        scene: scene.id, 
        networks: available 
      });
    }
    
    return available;
  }
  
  /**
   * Connect to a network
   * @param {string} networkId - Network to connect to
   * @param {Object} options - Connection options
   * @returns {Promise<Object>} Connection result
   */
  async connectToNetwork(networkId, options = {}) {
    const scene = game.scenes.active;
    
    // Check if network is available in current scene
    const isAvailable = await this.isNetworkAvailable(networkId, scene);
    
    if (!isAvailable && !game.user.isGM) {
      return {
        success: false,
        reason: 'network_unavailable',
        message: `Network ${networkId} is not available in this location`
      };
    }
    
    // Get network definition
    const network = await this.getNetwork(networkId);
    if (!network) {
      return {
        success: false,
        reason: 'network_not_found',
        message: `Network ${networkId} not found`
      };
    }
    
    // Check authentication
    if (network.security?.requiresAuth && !this.authenticatedNetworks.has(networkId)) {
      if (game.user.isGM && !options.requireAuth) {
        console.log(`${MODULE_ID} | GM bypassing auth for ${networkId}`);
        return {
          success: true,
          gmOverride: true,
          network: network
        };
      }
      
      return {
        success: false,
        reason: 'auth_required',
        requiresAuth: true,
        network: network,
        message: `Network ${network.name} requires authentication`
      };
    }
    
    // Connect
    if (this.networkService) {
      await this.networkService.connect(networkId);
    }
    
    // Update state
    if (this.stateManager) {
      this.stateManager.setState({
        currentNetwork: networkId,
        connected: true
      });
    }
    
    // Emit event
    if (this.eventBus) {
      this.eventBus.emit('network:connected', { 
        networkId,
        scene: scene?.id
      });
    }
    
    return {
      success: true,
      network: network
    };
  }
  
  /**
   * Get a specific network by ID
   * @param {string} networkId - Network ID
   * @returns {Promise<Object|null>} Network object or null
   */
  async getNetwork(networkId) {
    const networks = await this.getAllNetworks();
    return networks.find(n => n.id === networkId) || null;
  }
  
  /**
   * Get current network status
   * @returns {Object} Current network status
   */
  getNetworkStatus() {
    if (!this.stateManager) {
      return { connected: false, networkId: null };
    }
    
    const state = this.stateManager.getState();
    return {
      connected: state.connected || false,
      networkId: state.currentNetwork || null
    };
  }
  
  /**
   * Load network state from user flags
   * @private
   */
  async _loadNetworkState() {
    const currentNetwork = game.user.getFlag(MODULE_ID, 'currentNetwork');
    const authenticated = game.user.getFlag(MODULE_ID, 'authenticatedNetworks') || [];
    
    if (currentNetwork && this.stateManager) {
      this.stateManager.setState({
        currentNetwork: currentNetwork,
        connected: true
      });
    }
    
    this.authenticatedNetworks = new Set(authenticated);
  }
  
  /**
   * Register Foundry hooks
   * @private
   */
  _registerHooks() {
    // Re-scan networks when scene changes
    Hooks.on('canvasReady', async (canvas) => {
      console.log(`${MODULE_ID} | Scene changed, re-scanning networks`);
      await this.scanNetworks();
    });
  }
  
  /**
   * Create a custom network
   * @param {Object} networkData - Network properties
   * @returns {Promise<Object>} Created network
   */
  async createNetwork(networkData) {
    if (!game.user.isGM) {
      throw new Error('Only GMs can create networks');
    }
    
    // Validate required fields
    if (!networkData.id || !networkData.name) {
      throw new Error('Network must have id and name');
    }
    
    const networks = await this.getAllNetworks();
    
    // Check for duplicate ID
    if (networks.find(n => n.id === networkData.id)) {
      throw new Error(`Network with ID ${networkData.id} already exists`);
    }
    
    // Build network object (properties only, no availability)
    const network = {
      id: networkData.id,
      name: networkData.name,
      type: networkData.type || 'custom',
      signalStrength: networkData.signalStrength || 100,
      reliability: networkData.reliability || 100,
      security: networkData.security || {
        level: 'none',
        requiresAuth: false,
        password: null,
        bypassDC: 0,
        attempts: 999,
        lockoutDuration: 0
      },
      effects: networkData.effects || {
        messageDelay: 0,
        traced: false,
        anonymity: false,
        canRoute: true
      },
      theme: networkData.theme || {
        color: '#19f3f7',
        icon: 'fa-wifi',
        glitchIntensity: 0.1
      },
      description: networkData.description || '',
      gmNotes: networkData.gmNotes || ''
    };
    
    // Save
    networks.push(network);
    await game.settings.set(MODULE_ID, 'customNetworks', networks);
    
    console.log(`${MODULE_ID} | Created network: ${network.name}`);
    
    // Emit event
    if (this.eventBus) {
      this.eventBus.emit('network:created', { network });
    }
    
    return network;
  }
  
  /**
   * Update a network
   * @param {string} networkId - Network ID
   * @param {Object} updates - Properties to update
   * @returns {Promise<Object>} Updated network
   */
  async updateNetwork(networkId, updates) {
    if (!game.user.isGM) {
      throw new Error('Only GMs can update networks');
    }
    
    const networks = await this.getAllNetworks();
    const index = networks.findIndex(n => n.id === networkId);
    
    if (index === -1) {
      throw new Error(`Network ${networkId} not found`);
    }
    
    // Merge updates (shallow merge for now)
    networks[index] = {
      ...networks[index],
      ...updates,
      id: networkId // Ensure ID doesn't change
    };
    
    await game.settings.set(MODULE_ID, 'customNetworks', networks);
    
    console.log(`${MODULE_ID} | Updated network: ${networkId}`);
    
    // Emit event
    if (this.eventBus) {
      this.eventBus.emit('network:updated', { 
        networkId, 
        network: networks[index] 
      });
    }
    
    return networks[index];
  }
  
  /**
   * Delete a network
   * @param {string} networkId - Network ID
   * @returns {Promise<boolean>} True if deleted
   */
  async deleteNetwork(networkId) {
    if (!game.user.isGM) {
      throw new Error('Only GMs can delete networks');
    }
    
    // Prevent deleting default networks
    const defaultIds = ['CITINET', 'CORPNET', 'DARKNET', 'DEAD_ZONE'];
    if (defaultIds.includes(networkId)) {
      throw new Error('Cannot delete default networks');
    }
    
    const networks = await this.getAllNetworks();
    const filtered = networks.filter(n => n.id !== networkId);
    
    if (filtered.length === networks.length) {
      return false; // Network not found
    }
    
    await game.settings.set(MODULE_ID, 'customNetworks', filtered);
    
    console.log(`${MODULE_ID} | Deleted network: ${networkId}`);
    
    // Emit event
    if (this.eventBus) {
      this.eventBus.emit('network:deleted', { networkId });
    }
    
    return true;
  }
  
  /**
   * Check if user knows about a network (for discovery mechanics)
   * @param {string} networkId - Network ID
   * @returns {boolean} True if known
   */
  _isKnownNetwork(networkId) {
    return this.knownNetworks.has(networkId);
  }
  
  /**
   * Mark a network as known to the user
   * @param {string} networkId - Network ID
   */
  async discoverNetwork(networkId) {
    this.knownNetworks.add(networkId);
    
    // Save to user flags
    await game.user.setFlag(MODULE_ID, 'knownNetworks', Array.from(this.knownNetworks));
    
    console.log(`${MODULE_ID} | User discovered network: ${networkId}`);
    
    // Emit event
    if (this.eventBus) {
      this.eventBus.emit('network:discovered', { networkId });
    }
  }
}