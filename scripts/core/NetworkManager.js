/**
 * NetworkManager - Core Network System
 * File: scripts/core/NetworkManager.js
 * Module: cyberpunkred-messenger
 * 
 * REFACTORED VERSION - Scene Tab is Single Source of Truth
 * 
 * Manages network connections, availability, and authentication.
 * Network availability is now controlled EXCLUSIVELY through scene flags.
 * Network objects define properties only (name, security, theme, etc.)
 */

const MODULE_ID = 'cyberpunkred-messenger';

export class NetworkManager {
  constructor() {
    this.currentNetwork = null;
    this.currentScene = null;
    this.connectionHistory = [];
    this.eventListeners = new Map();
    
    console.log(`${MODULE_ID} | NetworkManager initialized`);
  }

  /**
   * Initialize the network manager
   */
  async initialize() {
    console.log(`${MODULE_ID} | Initializing NetworkManager...`);
    
    // Create default networks if none exist
    const networks = await game.settings.get(MODULE_ID, 'customNetworks');
    if (!networks || networks.length === 0) {
      await this.createDefaultNetworks();
    }
    
    // Set current scene
    this.currentScene = game.scenes.current;
    
    // Try to connect to a network
    if (this.currentScene) {
      await this.autoConnect();
    }
    
    console.log(`${MODULE_ID} | NetworkManager ready`);
  }

  /**
   * Get networks available in current scene
   * SIMPLIFIED: Only checks scene flags - no sync logic
   * 
   * @param {Scene} scene - Scene to check (defaults to current scene)
   * @returns {Promise<Array>} Available networks
   */
  async getAvailableNetworks(scene = null) {
    const targetScene = scene || this.currentScene || game.scenes.current;
    
    if (!targetScene) {
      console.warn(`${MODULE_ID} | No scene available for network check`);
      return [];
    }

    // Get all networks
    const { NetworkStorage } = await import('../storage/NetworkStorage.js');
    const allNetworks = await NetworkStorage.getAllNetworks();
    
    // Get scene configuration
    const sceneConfig = targetScene.getFlag(MODULE_ID, 'networks') || {};
    
    // Filter to only networks with available = true in scene flags
    return allNetworks.filter(network => {
      const config = sceneConfig[network.id];
      return config?.available === true;
    });
  }

  /**
   * Get a specific network by ID
   * @param {string} networkId - Network ID
   * @returns {Promise<Object|null>} Network object
   */
  async getNetwork(networkId) {
    const { NetworkStorage } = await import('../storage/NetworkStorage.js');
    return await NetworkStorage.getNetwork(networkId);
  }

  /**
   * Get all networks (regardless of availability)
   * @returns {Promise<Array>} All networks
   */
  async getAllNetworks() {
    const { NetworkStorage } = await import('../storage/NetworkStorage.js');
    return await NetworkStorage.getAllNetworks();
  }

  /**
   * Connect to a network
   * @param {string} networkId - Network ID
   * @param {Object} options - Connection options
   * @returns {Promise<Object>} Connection result
   */
  async connectToNetwork(networkId, options = {}) {
    console.log(`${MODULE_ID} | Attempting to connect to network: ${networkId}`);
    
    const network = await this.getNetwork(networkId);
    if (!network) {
      return {
        success: false,
        error: 'Network not found'
      };
    }

    // Check if network is available in current scene
    const available = await this.getAvailableNetworks();
    const isAvailable = available.some(n => n.id === networkId);
    
    if (!isAvailable && !game.user.isGM) {
      return {
        success: false,
        error: 'Network not available in this scene',
        requiresSceneConfig: true
      };
    }

    // GM can always connect (override)
    if (game.user.isGM) {
      this.currentNetwork = network;
      await this._logConnection(networkId, true, 'GM Override');
      
      ui.notifications.info(`Connected to ${network.name} (GM Override)`);
      
      return {
        success: true,
        gmOverride: true,
        network: network
      };
    }

    // Check authentication
    if (network.requiresAuth || network.security?.requiresAuth) {
      if (!options.password && !options.skipAuth) {
        return {
          success: false,
          requiresAuth: true,
          network: network
        };
      }

      // Verify password if provided
      if (options.password) {
        const passwordHash = this._hashPassword(options.password);
        if (passwordHash !== network.security?.password) {
          await this._logConnection(networkId, false, 'Invalid Password');
          return {
            success: false,
            error: 'Invalid password',
            requiresAuth: true
          };
        }
      }
    }

    // Connection successful
    this.currentNetwork = network;
    await this._logConnection(networkId, true, 'User Connection');
    
    ui.notifications.info(`Connected to ${network.name}`);
    
    // Emit connection event
    this._emitEvent('network:connected', { network });
    
    return {
      success: true,
      network: network
    };
  }

  /**
   * Disconnect from current network
   */
  async disconnect() {
    if (!this.currentNetwork) return;
    
    const network = this.currentNetwork;
    this.currentNetwork = null;
    
    await this._logConnection(network.id, true, 'Disconnected');
    
    ui.notifications.info(`Disconnected from ${network.name}`);
    
    // Emit disconnection event
    this._emitEvent('network:disconnected', { network });
  }

  /**
   * Auto-connect to best available network
   */
  async autoConnect() {
    const available = await this.getAvailableNetworks();
    
    if (available.length === 0) {
      console.log(`${MODULE_ID} | No networks available for auto-connect`);
      return;
    }

    // Check for preferred network in scene settings
    const sceneSettings = this.currentScene?.getFlag(MODULE_ID, 'settings') || {};
    const preferredId = sceneSettings.preferredNetwork;
    
    if (preferredId) {
      const preferred = available.find(n => n.id === preferredId);
      if (preferred) {
        await this.connectToNetwork(preferredId, { skipAuth: true });
        return;
      }
    }

    // Default: Connect to strongest signal
    const strongest = available.reduce((best, current) => {
      const bestSignal = this._getNetworkSignal(best.id) || 0;
      const currentSignal = this._getNetworkSignal(current.id) || 0;
      return currentSignal > bestSignal ? current : best;
    }, available[0]);

    await this.connectToNetwork(strongest.id, { skipAuth: true });
  }

  /**
   * Get network signal strength for current scene
   * @param {string} networkId - Network ID
   * @returns {number} Signal strength (0-100)
   */
  _getNetworkSignal(networkId) {
    if (!this.currentScene) return 0;
    
    const sceneConfig = this.currentScene.getFlag(MODULE_ID, 'networks') || {};
    return sceneConfig[networkId]?.signalStrength || 0;
  }

  /**
   * Get current network status
   * @returns {Object} Network status
   */
  getNetworkStatus() {
    return {
      connected: !!this.currentNetwork,
      network: this.currentNetwork,
      scene: this.currentScene,
      signalStrength: this.currentNetwork ? this._getNetworkSignal(this.currentNetwork.id) : 0
    };
  }

  /**
   * Create default networks
   */
  async createDefaultNetworks() {
    console.log(`${MODULE_ID} | Creating default networks...`);
    
    const defaultNetworks = [
      {
        id: 'CITINET',
        name: 'CitiNet',
        type: 'PUBLIC',
        signalStrength: 100,
        reliability: 95,
        security: {
          level: 'LOW',
          requiresAuth: false,
          password: null,
          iceDamage: '0d6'
        },
        effects: {
          anonymous: false,
          encrypted: false,
          traced: true,
          monitored: true
        },
        theme: {
          color: '#19f3f7',
          icon: 'fas fa-city'
        },
        description: 'Public city network. Monitored by NetWatch.',
        gmNotes: 'Standard public network'
      },
      {
        id: 'CORPNET',
        name: 'CorpNet',
        type: 'CORPORATE',
        signalStrength: 100,
        reliability: 99,
        security: {
          level: 'HIGH',
          requiresAuth: true,
          password: null,
          iceDamage: '3d6'
        },
        effects: {
          anonymous: false,
          encrypted: true,
          traced: true,
          monitored: true
        },
        theme: {
          color: '#F65261',
          icon: 'fas fa-building'
        },
        description: 'Corporate network. Requires authentication.',
        gmNotes: 'Protected by ICE'
      },
      {
        id: 'DARKNET',
        name: 'DarkNet',
        type: 'UNDERGROUND',
        signalStrength: 75,
        reliability: 60,
        security: {
          level: 'MEDIUM',
          requiresAuth: true,
          password: null,
          iceDamage: '1d6'
        },
        effects: {
          anonymous: true,
          encrypted: true,
          traced: false,
          monitored: false
        },
        theme: {
          color: '#9C27B0',
          icon: 'fas fa-mask'
        },
        description: 'Anonymous underground network. Unreliable but untraceable.',
        gmNotes: 'Used by criminals and netrunners'
      },
      {
        id: 'DEAD_ZONE',
        name: 'Dead Zone',
        type: 'NONE',
        signalStrength: 0,
        reliability: 0,
        security: {
          level: 'NONE',
          requiresAuth: false,
          password: null,
          iceDamage: '0d6'
        },
        effects: {
          anonymous: false,
          encrypted: false,
          traced: false,
          monitored: false
        },
        theme: {
          color: '#424242',
          icon: 'fas fa-ban'
        },
        description: 'No network connectivity. Complete blackout.',
        gmNotes: 'No connectivity'
      }
    ];
    
    await game.settings.set(MODULE_ID, 'customNetworks', defaultNetworks);
    console.log(`${MODULE_ID} | Created ${defaultNetworks.length} default networks`);
    
    return defaultNetworks;
  }

  /**
   * Hash password for comparison
   * @private
   */
  _hashPassword(password) {
    let hash = 0;
    for (let i = 0; i < password.length; i++) {
      const char = password.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }

  /**
   * Log connection attempt
   * @private
   */
  async _logConnection(networkId, success, reason) {
    const network = await this.getNetwork(networkId);
    if (!network) return;

    const entry = {
      timestamp: new Date().toISOString(),
      networkId: networkId,
      networkName: network.name,
      success: success,
      reason: reason,
      user: game.user.name,
      scene: this.currentScene?.name || 'Unknown'
    };

    this.connectionHistory.push(entry);

    // Keep only last 100 entries
    if (this.connectionHistory.length > 100) {
      this.connectionHistory = this.connectionHistory.slice(-100);
    }

    // Emit log event
    this._emitEvent('network:log', entry);
  }

  /**
   * Emit event to listeners
   * @private
   */
  _emitEvent(eventName, data) {
    const listeners = this.eventListeners.get(eventName) || [];
    listeners.forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error(`${MODULE_ID} | Error in event listener:`, error);
      }
    });
  }

  /**
   * Register event listener
   */
  on(eventName, callback) {
    if (!this.eventListeners.has(eventName)) {
      this.eventListeners.set(eventName, []);
    }
    this.eventListeners.get(eventName).push(callback);
  }

  /**
   * Unregister event listener
   */
  off(eventName, callback) {
    if (!this.eventListeners.has(eventName)) return;
    
    const listeners = this.eventListeners.get(eventName);
    const index = listeners.indexOf(callback);
    if (index > -1) {
      listeners.splice(index, 1);
    }
  }
}