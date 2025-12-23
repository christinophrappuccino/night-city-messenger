/**
 * NetworkManager
 * File: scripts/core/NetworkManager.js
 * Module: cyberpunkred-messenger
 * Description: Enhanced network management with custom networks, authentication, and scene-based availability
 * 
 * EXTENDS: NetworkService.js (maintains backward compatibility)
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
    
    console.log(`${MODULE_ID} | NetworkManager initialized (enhanced)`);
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
   * Get all networks (both default and custom)
   */
  async getAllNetworks() {
    const customNetworks = await game.settings.get(MODULE_ID, 'customNetworks') || [];
    return customNetworks;
  }
  
  /**
   * Create default network definitions
   * @private
   */
  async _createDefaultNetworks() {
    const defaultNetworks = [
      {
        id: 'CITINET',
        name: 'CitiNet',
        type: 'public',
        availability: {
          global: true,
          scenes: []
        },
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
        description: 'Night City\'s public network. Always available, never secure.',
        hidden: false,
        gmNotes: ''
      },
      {
        id: 'CORPNET',
        name: 'CorpNet',
        type: 'corporate',
        availability: {
          global: false,
          scenes: [] // GM will assign to specific scenes
        },
        signalStrength: 100,
        reliability: 99,
        security: {
          level: 'high',
          requiresAuth: true,
          password: null, // Will be set by GM
          bypassDC: 17,
          attempts: 3,
          lockoutDuration: 600000 // 10 minutes
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
          glitchIntensity: 0.2
        },
        description: 'Corporate network. High security, monitored by NetWatch.',
        hidden: false,
        gmNotes: 'Alert security on breach attempts'
      },
      {
        id: 'DARKNET',
        name: 'DarkNet',
        type: 'darknet',
        availability: {
          global: false,
          scenes: [] // Players must discover darknet nodes
        },
        signalStrength: 60,
        reliability: 80,
        security: {
          level: 'medium',
          requiresAuth: true,
          password: null,
          bypassDC: 13,
          attempts: 5,
          lockoutDuration: 180000 // 3 minutes
        },
        effects: {
          messageDelay: 2,
          traced: false,
          anonymity: true,
          canRoute: true
        },
        theme: {
          color: '#9400D3',
          icon: 'fa-user-secret',
          glitchIntensity: 0.5
        },
        description: 'Anonymous network. Unstable but untraceable.',
        hidden: true, // Hidden until player discovers it
        gmNotes: 'Players need to know about darknet nodes to connect'
      },
      {
        id: 'DEAD_ZONE',
        name: 'Dead Zone',
        type: 'none',
        availability: {
          global: false,
          scenes: [] // GM assigns to dead zones
        },
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
        hidden: false,
        gmNotes: 'No connectivity'
      }
    ];
    
    await game.settings.set(MODULE_ID, 'customNetworks', defaultNetworks);
    console.log(`${MODULE_ID} | Created ${defaultNetworks.length} default networks`);
    
    return defaultNetworks;
  }
  
  /**
   * Get networks available in current scene
   */
  async getAvailableNetworks(scene = canvas.scene) {
    const allNetworks = await this.getAllNetworks();
    
    return allNetworks.filter(network => {
      // Hidden networks don't show unless player knows about them
      if (network.hidden && !this._isKnownNetwork(network.id)) {
        return false;
      }
      
      // Global networks always available
      if (network.availability.global) {
        return true;
      }
      
      // Scene-specific networks
      if (scene && network.availability.scenes.includes(scene.id)) {
        return true;
      }
      
      return false;
    });
  }
  
  /**
   * Check if player knows about a hidden network
   * @private
   */
  _isKnownNetwork(networkId) {
    const actor = game.user.character;
    if (!actor) return false;
    
    const knownNetworks = actor.getFlag(MODULE_ID, 'knownNetworks') || [];
    return knownNetworks.includes(networkId);
  }
  
  /**
   * Reveal a hidden network to a character
   */
  async revealNetwork(networkId, actor) {
    const network = (await this.getAllNetworks()).find(n => n.id === networkId);
    if (!network || !network.hidden) return;
    
    const knownNetworks = actor.getFlag(MODULE_ID, 'knownNetworks') || [];
    if (!knownNetworks.includes(networkId)) {
      knownNetworks.push(networkId);
      await actor.setFlag(MODULE_ID, 'knownNetworks', knownNetworks);
      
      ui.notifications.info(`Discovered network: ${network.name}`);
      
      await ChatMessage.create({
        content: `
          <div style="background: rgba(148, 0, 211, 0.2); border: 1px solid #9400D3; padding: 10px; border-radius: 4px;">
            <h3 style="color: #9400D3; margin: 0 0 10px 0;">
              <i class="fas fa-wifi"></i> NETWORK DISCOVERED
            </h3>
            <p><strong>${actor.name}</strong> discovered <strong>${network.name}</strong></p>
            <p style="font-size: 0.9em; color: #ccc;">${network.description}</p>
          </div>
        `,
        whisper: [game.user.id]
      });
    }
  }
  
  /**
   * Scan for available networks
   */
  async scanNetworks() {
    const availableNetworks = await this.getAvailableNetworks();
    
    console.log(`${MODULE_ID} | Scan found ${availableNetworks.length} networks`);
    
    // Emit event for UI updates
    this.eventBus.emit('network:scanned', { networks: availableNetworks });
    
    // Check for auto-connect favorites
    await this._checkAutoConnect(availableNetworks);
    
    return availableNetworks;
  }
  
  /**
   * Auto-connect to favorite network if available
   * @private
   */
  async _checkAutoConnect(availableNetworks) {
    const actor = game.user.character;
    if (!actor) return;
    
    const prefs = actor.getFlag(MODULE_ID, 'networkPreferences') || {};
    if (!prefs.autoConnect) return;
    
    // Find first available favorite that we're authenticated to
    const favorites = prefs.favorites || [];
    for (const networkId of favorites) {
      const network = availableNetworks.find(n => n.id === networkId);
      if (network && this.authenticatedNetworks.has(networkId)) {
        await this.connectToNetwork(networkId);
        console.log(`${MODULE_ID} | Auto-connected to favorite: ${networkId}`);
        return;
      }
    }
  }
  
  /**
   * Connect to a network
   * @param {string} networkId - Network ID to connect to
   * @param {string} password - Password (if required)
   * @returns {Object} Result { success, requiresAuth, error }
   */
  async connectToNetwork(networkId, password = null) {
    const availableNetworks = await this.getAvailableNetworks();
    const network = availableNetworks.find(n => n.id === networkId);
    
    if (!network) {
      return { success: false, error: 'Network not available' };
    }
    
    const actor = game.user.character;
    
    // Check authentication if required
    if (network.security?.requiresAuth || network.requiresAuth) {
      if (!actor) {
        return { success: false, requiresAuth: true };
      }
      
      const authStatus = this.securityService.checkAuthentication(actor, networkId);
      
      if (!authStatus.authenticated) {
        return { success: false, requiresAuth: true };
      }
    }
    
    // Disconnect from current
    const currentNetwork = this.networkService.getCurrentNetwork();
    if (currentNetwork && currentNetwork !== networkId) {
      await this._disconnect();
    }
    
    // Connect
    await this.networkService.setCurrentNetwork(network.id, { silent: true });
    await this._saveNetworkState();
    await this._announceConnection(network);
    
    this.eventBus.emit('network:connected', { network });
    
    return { success: true };
  }
  
  /**
   * Disconnect from current network
   * @private
   */
  async _disconnect() {
    const currentNetwork = this.networkService.getCurrentNetwork();
    if (!currentNetwork) return;
    
    console.log(`${MODULE_ID} | Disconnecting from ${currentNetwork}`);
    
    this.eventBus.emit('network:disconnected', { networkId: currentNetwork });
  }
  
  /**
   * Authenticate with password
   * @param {string} networkId - Network to authenticate to
   * @param {string} password - Password to try
   * @returns {Object} Result
   */
  async authenticate(networkId, password) {
    const allNetworks = await this.getAllNetworks();
    const network = allNetworks.find(n => n.id === networkId);
    
    if (!network) {
      return { success: false, error: 'Network not found' };
    }
    
    const actor = game.user.character;
    if (!actor) {
      return { success: false, error: 'No character selected' };
    }
    
    // Use security service for authentication
    return await this.securityService.attemptPasswordAuth(actor, networkId, password, network);
  }
  
  /**
   * Hash password (simple implementation for demo)
   * @private
   */
  _hashPassword(password) {
    // In production, use proper crypto
    // For now, simple hash for proof of concept
    let hash = 0;
    for (let i = 0; i < password.length; i++) {
      const char = password.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }
  
  /**
   * Attempt to bypass network security (hacking)
   * Integrates with existing HackingSystem.js
   */
  async attemptBypass(networkId, actor) {
    const allNetworks = await this.getAllNetworks();
    const network = allNetworks.find(n => n.id === networkId);
    
    if (!network) {
      return { success: false, error: 'Network not found' };
    }
    
    if (!actor) {
      actor = game.user.character;
    }
    
    if (!actor) {
      return { success: false, error: 'No character selected' };
    }
    
    // Use security service for bypass attempt
    return await this.securityService.attemptBypass(actor, networkId, network);
  }
  
  /**
   * Trigger NetWatch alert
   * @private
   */
  async _triggerNetWatchAlert(actor, network) {
    await ChatMessage.create({
      content: `
        <div style="background: rgba(255, 165, 0, 0.2); border: 1px solid #FFA500; padding: 10px; border-radius: 4px;">
          <h3 style="color: #FFA500; margin: 0 0 10px 0;">
            ⚠️ NETWATCH ALERT
          </h3>
          <p>Unauthorized access detected on <strong>${network.name}</strong></p>
          <p style="font-size: 0.9em; color: #ccc;">Tracing connection...</p>
        </div>
      `,
      whisper: [game.user.id]
    });
    
    // Notify GM
    if (!game.user.isGM) {
      game.socket.emit(`module.${MODULE_ID}`, {
        type: 'netwatch-alert',
        actorId: actor.id,
        networkId: network.id,
        timestamp: Date.now()
      });
    }
  }

  /**
   * Check if actor is authenticated:
   * @private
   */

  isAuthenticated(actor, networkId) {
    if (!actor || !networkId || !this.securityService) {
      return false;
    }
    
    const authStatus = this.securityService.checkAuthentication(actor, networkId);
    return authStatus.authenticated;
  }

  /**
   * GM tools for authentication:
   * @private
   */

  async gmUnlockNetwork(actor, networkId) {
    if (!game.user.isGM) {
      throw new Error('Only GMs can force unlock networks');
    }
    
    await this.securityService.gmForceUnlock(actor, networkId);
  }

  async gmResetAuthentication(actor, networkId = null) {
    if (!game.user.isGM) {
      throw new Error('Only GMs can reset authentication');
    }
    
    await this.securityService.gmResetAuth(actor, networkId);
  }
  
  /**
   * Create chat message announcing connection
   * @private
   */
  async _announceConnection(network) {
    const actor = game.user.character;
    let authStatus = '';
    
    if (actor && this.securityService) {
      const status = this.securityService.checkAuthentication(actor, network.id);
      if (status.authenticated) {
        if (status.temporary) {
          authStatus = ' <span style="color: #FFC107;">(Temporary Access)</span>';
          if (status.traced) {
            authStatus += ' <span style="color: #F65261;">[TRACED]</span>';
          }
        } else {
          authStatus = ' <span style="color: #4CAF50;">(Authenticated)</span>';
        }
      }
    }
    
    await ChatMessage.create({
      content: `
        <div class="ncm-network-announcement" style="
          background: linear-gradient(135deg, rgba(25, 243, 247, 0.1) 0%, rgba(25, 243, 247, 0.05) 100%);
          border-left: 3px solid #19f3f7;
          padding: 12px;
          border-radius: 3px;
        ">
          <p style="margin: 0; font-family: 'Rajdhani', sans-serif;">
            <i class="fas fa-wifi" style="color: #19f3f7;"></i>
            <strong>Connected to ${network.displayName || network.name}</strong>${authStatus}
          </p>
        </div>
      `,
      type: CONST.CHAT_MESSAGE_TYPES.OOC,
      flags: {
        [MODULE_ID]: {
          type: 'network-connection',
          networkId: network.id
        }
      }
    });
  }


  
  /**
   * Get current network status for UI
   */
  getNetworkStatus() {
    const currentNetworkId = this.networkService.getCurrentNetwork();
    
    if (!currentNetworkId) {
      return {
        connected: false,
        searching: true,
        network: null
      };
    }
    
    return {
      connected: true,
      networkId: currentNetworkId,
      signalStrength: this.networkService.getSignalStrength(),
      status: 'connected'
    };
  }
  
  /**
   * Check if data shard is accessible on current network
   * (Integrates with existing NetworkService)
   */
  canAccessDataShard(dataShard) {
    const networkCheck = this.networkService.checkNetworkRequirement(dataShard);
    return networkCheck.accessible;
  }
  
  /**
   * Save current network state to actor
   * @private
   */
  async _saveNetworkState() {
    const actor = game.user.character;
    if (!actor) return;
    
    const currentNetwork = this.networkService.getCurrentNetwork();
    
    await actor.setFlag(MODULE_ID, 'network', {
      currentNetwork: currentNetwork || null,
      authenticatedNetworks: Array.from(this.authenticatedNetworks),
      failedAttempts: Object.fromEntries(this.failedAttempts)
    });
  }
  
  /**
   * Load network state from actor
   * @private
   */
  async _loadNetworkState() {
    const actor = game.user.character;
    if (!actor) return;
    
    const state = actor.getFlag(MODULE_ID, 'network');
    if (!state) return;
    
    this.authenticatedNetworks = new Set(state.authenticatedNetworks || []);
    this.failedAttempts = new Map(Object.entries(state.failedAttempts || {}));
    
    console.log(`${MODULE_ID} | Loaded network state: ${this.authenticatedNetworks.size} authenticated networks`);
  }
  
  /**
   * Auto-switch to best network for current scene
   * Called when scene changes and user has auto-switch enabled
   */
  async autoSwitchNetwork(scene) {
    // Check if auto-switch is enabled for this scene
    const autoSwitch = scene.getFlag(MODULE_ID, 'autoSwitch');
    if (autoSwitch === false) return; // Default is true, so only false disables it
    
    // Check if user wants auto-switch (per-user setting)
    const userAutoSwitch = game.user.getFlag(MODULE_ID, 'autoSwitchNetwork');
    if (userAutoSwitch === false) return; // Default is true
    
    // Get available networks for this scene
    const availableNetworks = await this._getAvailableNetworksForScene(scene);
    
    if (availableNetworks.length === 0) {
      // No networks available - switch to DEAD_ZONE
      await this.switchNetwork('DEAD_ZONE');
      
      ChatMessage.create({
        content: `
          <div class="ncm-chat-notification ncm-chat-notification--warning">
            <div class="ncm-chat-notification__icon">
              <i class="fas fa-exclamation-triangle"></i>
            </div>
            <div class="ncm-chat-notification__content">
              <h4>Network Dead Zone</h4>
              <p>Entered ${scene.name} - no network signals detected</p>
            </div>
          </div>
        `,
        whisper: [game.user.id]
      });
      
      return;
    }
    
    // Check for preferred network
    const preferredNetwork = scene.getFlag(MODULE_ID, 'preferredNetwork');
    if (preferredNetwork) {
      const preferred = availableNetworks.find(n => n.id === preferredNetwork);
      if (preferred) {
        await this.switchNetwork(preferredNetwork);
        
        ChatMessage.create({
          content: `
            <div class="ncm-chat-notification ncm-chat-notification--info">
              <div class="ncm-chat-notification__icon">
                <i class="${preferred.theme.icon}" style="color: ${preferred.theme.color}"></i>
              </div>
              <div class="ncm-chat-notification__content">
                <h4>Network Auto-Switch</h4>
                <p>Connected to ${preferred.name} (preferred network for ${scene.name})</p>
                <p class="ncm-hint">Signal Strength: ${preferred.signalStrength}%</p>
              </div>
            </div>
          `,
          whisper: [game.user.id]
        });
        
        return;
      }
    }
    
    // No preferred network or it's unavailable - find strongest signal
    const strongestNetwork = this._findStrongestNetwork(availableNetworks);
    
    if (!strongestNetwork) return; // Shouldn't happen, but safety check
    
    await this.switchNetwork(strongestNetwork.id);
    
    ChatMessage.create({
      content: `
        <div class="ncm-chat-notification ncm-chat-notification--success">
          <div class="ncm-chat-notification__icon">
            <i class="${strongestNetwork.theme.icon}" style="color: ${strongestNetwork.theme.color}"></i>
          </div>
          <div class="ncm-chat-notification__content">
            <h4>Network Auto-Switch</h4>
            <p>Connected to ${strongestNetwork.name} (strongest signal in ${scene.name})</p>
            <p class="ncm-hint">Signal Strength: ${strongestNetwork.signalStrength}%</p>
          </div>
        </div>
      `,
      whisper: [game.user.id]
    });
  }

  /**
   * Get available networks for a scene
   * @private
   * @param {Scene} scene - The scene
   * @returns {Promise<Array<Object>>} Available networks with scene config
   */
  async _getAvailableNetworksForScene(scene) {
    const sceneNetworks = scene.getFlag(MODULE_ID, 'networks') || {};
    const allNetworks = await this.getAllNetworks();
    const availableNetworks = [];
    
    // Check each network
    for (const network of allNetworks) {
      const sceneConfig = sceneNetworks[network.id] || {
        available: true,
        signalStrength: 100,
        override: null
      };
      
      // Only include if available in this scene
      if (sceneConfig.available) {
        availableNetworks.push({
          ...network,
          signalStrength: sceneConfig.signalStrength,
          sceneOverride: sceneConfig.override
        });
      }
    }
    
    return availableNetworks;
  }

  /**
   * Find network with strongest signal
   * @private
   * @param {Array<Object>} networks - Available networks
   * @returns {Object|null} Network with strongest signal
   */
  _findStrongestNetwork(networks) {
    if (networks.length === 0) return null;
    
    return networks.reduce((strongest, current) => {
      return current.signalStrength > strongest.signalStrength ? current : strongest;
    });
  }

  /**
   * Get current scene network config
   * Used by other systems to check network state in current scene
   * @param {string} networkId - Network ID
   * @returns {Object} Scene network configuration
   */
  getCurrentSceneNetworkConfig(networkId) {
    const scene = game.scenes.active;
    if (!scene) return null;
    
    const sceneNetworks = scene.getFlag(MODULE_ID, 'networks') || {};
    return sceneNetworks[networkId] || {
      available: true,
      signalStrength: 100,
      override: null
    };
  }

  /**
   * Apply scene-specific overrides to network config
   * @private
   * @param {Object} network - Base network config
   * @param {Object} override - Scene-specific overrides
   * @returns {Object} Merged network config
   */
  _applySceneOverrides(network, override) {
    if (!override) return network;
    
    const merged = foundry.utils.deepClone(network);
    
    // Apply security overrides
    if (override.security) {
      merged.security = foundry.utils.mergeObject(merged.security, override.security);
    }
    
    // Apply reliability override
    if (override.reliability !== undefined) {
      merged.reliability = override.reliability;
    }
    
    // Apply feature overrides
    if (override.features) {
      merged.features = foundry.utils.mergeObject(merged.features, override.features);
    }
    
    return merged;
  }

  /**
   * Get effective network configuration for current scene
   * Returns network config with scene overrides applied
   * @param {string} networkId - Network ID
   * @returns {Object|null} Effective network configuration
   */
  getEffectiveNetworkConfig(networkId) {
    const allNetworks = this.getAllNetworks();
    const network = allNetworks.find(n => n.id === networkId);
    if (!network) return null;
    
    const scene = game.scenes.active;
    if (!scene) return network;
    
    const sceneConfig = this.getCurrentSceneNetworkConfig(networkId);
    if (!sceneConfig || !sceneConfig.override) return network;
    
    return this._applySceneOverrides(network, sceneConfig.override);
  }
  
  /**
   * Register Foundry hooks
   * @private
   */
  _registerHooks() {
    // Re-scan when scene changes
    Hooks.on('canvasReady', async () => {
      console.log(`${MODULE_ID} | Scene changed, re-scanning networks...`);
      await this.scanNetworks();
    });
    
    // Re-scan when controlled token changes
    Hooks.on('controlToken', async () => {
      await this._loadNetworkState();
      await this.scanNetworks();
    });
  }
}