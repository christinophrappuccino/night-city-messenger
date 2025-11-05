/**
 * NetworkManager - MERGED VERSION
 * File: scripts/core/NetworkManager.js
 * Module: cyberpunkred-messenger
 * 
 * Combines:
 * - NEW: Simplified availability logic (scene flags authoritative)
 * - EXISTING: Full authentication, security, and GM tools
 * - EXISTING: NetworkSecurityService integration
 * - EXISTING: Auto-switch and scene overrides
 */

import { MODULE_ID, NETWORKS, NETWORK_RELIABILITY } from '../utils/constants.js';

export class NetworkManager {
  constructor(networkService, stateManager, eventBus) {
    this.networkService = networkService; // Existing service
    this.stateManager = stateManager;
    this.eventBus = eventBus;
    
    // Authentication state
    this.authenticatedNetworks = new Set();
    this.securityService = null;
    this.failedAttempts = new Map();
    this.knownNetworks = new Set();
    
    // Availability cache
    this._cache = {
      availableNetworks: null,
      lastScene: null
    };
    
    console.log(`${MODULE_ID} | NetworkManager initialized (enhanced + streamlined)`);
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
   * Uses NEW defaultHidden flag instead of old hidden flag
   * @private
   */
  async _createDefaultNetworks() {
    const defaultNetworks = [
      {
        id: 'CITINET',
        name: 'CitiNet',
        type: 'public',
        defaultHidden: false, // NEW: Visible by default
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
        gmNotes: ''
      },
      {
        id: 'CORPNET',
        name: 'CorpNet',
        type: 'corporate',
        defaultHidden: false, // NEW: Visible by default (GM can disable per scene)
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
        gmNotes: 'Alert security on breach attempts'
      },
      {
        id: 'DARKNET',
        name: 'DarkNet',
        type: 'darknet',
        defaultHidden: true, // NEW: Hidden by default (players discover it)
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
        gmNotes: 'Players need to know about darknet nodes to connect'
      },
      {
        id: 'DEAD_ZONE',
        name: 'Dead Zone',
        type: 'none',
        defaultHidden: false, // NEW: Visible (represents no signal)
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
   * Get networks available in current scene
   * 
   * NEW PRIORITY SYSTEM:
   * 1. Scene flag exists → Use it (GM has configured this network)
   * 2. No scene flag → Check if player knows network (has messages from it)
   * 3. Still unknown → Check defaultHidden flag
   * 
   * @param {Scene} scene - Scene to check (defaults to current)
   * @param {Actor} actor - Actor to check known networks for (defaults to controlled)
   * @returns {Array} Available network objects
   */
  async getAvailableNetworks(scene = null, actor = null) {
    scene = scene || canvas.scene || game.scenes.current;
    if (!scene) return [];

    // Check cache
    if (this._cache.availableNetworks && this._cache.lastScene === scene.id) {
      return this._cache.availableNetworks;
    }

    const allNetworks = await this.getAllNetworks();
    actor = actor || this._getPlayerActor();
    const knownNetworkIds = this._getKnownNetworkIds(actor);
    
    const available = allNetworks.filter(network => {
      // PRIORITY 1: Explicit scene configuration (AUTHORITATIVE)
      const sceneNetworks = scene.getFlag(MODULE_ID, 'networks') || {};
      const sceneConfig = sceneNetworks[network.id];
      
      if (sceneConfig !== undefined) {
        // Scene flag exists = GM has explicitly configured this
        // This overrides ALL other considerations including defaultHidden
        return sceneConfig.available === true;
      }
      
      // PRIORITY 2: Player knows this network (has received messages)
      if (knownNetworkIds.has(network.id)) {
        // Player has interacted with this network
        // Show it even if defaultHidden = true
        return true;
      }
      
      // PRIORITY 3: No configuration, no messages → use defaultHidden
      // defaultHidden = true means "hide by default until GM enables or player discovers"
      return !network.defaultHidden;
    });

    // Cache result
    this._cache.availableNetworks = available;
    this._cache.lastScene = scene.id;

    return available;
  }

  /**
   * Get network IDs that the player has interacted with
   * (has sent or received messages from these networks)
   * 
   * @param {Actor} actor - Actor to check
   * @returns {Set} Set of known network IDs
   */
  _getKnownNetworkIds(actor) {
    const known = new Set();
    
    if (!actor) return known;

    // Check actor's known networks flag (set by revealNetwork)
    const flaggedKnown = actor.getFlag(MODULE_ID, 'knownNetworks') || [];
    flaggedKnown.forEach(id => known.add(id));

    // Check actor's journal entries for messages
    const journalEntries = game.journal.filter(j => {
      const owner = j.getFlag(MODULE_ID, 'owner');
      return owner === actor.id;
    });

    for (const journal of journalEntries) {
      for (const page of journal.pages) {
        const messageData = page.getFlag(MODULE_ID, 'message');
        if (messageData?.network) {
          known.add(messageData.network);
        }
      }
    }

    // Also check messages where this actor is the sender
    for (const journal of game.journal) {
      for (const page of journal.pages) {
        const messageData = page.getFlag(MODULE_ID, 'message');
        if (messageData?.from?.includes(actor.name) || 
            messageData?.from?.includes(actor.id)) {
          if (messageData.network) {
            known.add(messageData.network);
          }
        }
      }
    }

    return known;
  }

  /**
   * Get the current player's actor
   * @returns {Actor|null}
   */
  _getPlayerActor() {
    if (game.user.character) return game.user.character;
    
    const controlled = game.user.getActiveTokens();
    if (controlled.length > 0) {
      return controlled[0].actor;
    }
    
    return null;
  }

  /**
   * Check if player knows about a hidden network (LEGACY - maintained for compatibility)
   * @private
   */
  _isKnownNetwork(networkId) {
    const actor = this._getPlayerActor();
    if (!actor) return false;
    
    const knownNetworks = actor.getFlag(MODULE_ID, 'knownNetworks') || [];
    return knownNetworks.includes(networkId);
  }
  
  /**
   * Reveal a hidden network to a character
   * Adds network to player's known networks so it bypasses defaultHidden
   */
  async revealNetwork(networkId, actor) {
    const allNetworks = await this.getAllNetworks();
    const network = allNetworks.find(n => n.id === networkId);
    if (!network) return;
    
    const knownNetworks = actor.getFlag(MODULE_ID, 'knownNetworks') || [];
    if (!knownNetworks.includes(networkId)) {
      knownNetworks.push(networkId);
      await actor.setFlag(MODULE_ID, 'knownNetworks', knownNetworks);
      
      // Clear cache since availability changed
      this._clearCache();
      
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
   * Get network configuration for current scene
   * Includes signal strength and overrides
   * 
   * @param {string} networkId - Network ID
   * @param {Scene} scene - Scene to check
   * @returns {Object} Network configuration
   */
  getNetworkConfig(networkId, scene = null) {
    scene = scene || canvas.scene || game.scenes.current;
    if (!scene) return this._getDefaultConfig();

    const sceneNetworks = scene.getFlag(MODULE_ID, 'networks') || {};
    const config = sceneNetworks[networkId];

    if (!config) {
      return this._getDefaultConfig();
    }

    return {
      available: config.available ?? false,
      signalStrength: config.signalStrength ?? 100,
      override: config.override || {}
    };
  }

  /**
   * Get default network configuration
   * @returns {Object}
   */
  _getDefaultConfig() {
    return {
      available: false,
      signalStrength: 100,
      override: {}
    };
  }

  /**
   * Set network availability in a scene
   * This is the PRIMARY way GMs configure networks
   * 
   * @param {string} networkId - Network ID
   * @param {boolean} available - Availability status
   * @param {Scene} scene - Scene to update
   */
  async setNetworkAvailability(networkId, available, scene = null) {
    scene = scene || canvas.scene || game.scenes.current;
    if (!scene) {
      ui.notifications.warn("No scene available to configure");
      return;
    }

    const sceneNetworks = scene.getFlag(MODULE_ID, 'networks') || {};
    
    // Create or update config
    sceneNetworks[networkId] = {
      ...sceneNetworks[networkId],
      available: available,
      signalStrength: sceneNetworks[networkId]?.signalStrength ?? 100
    };

    await scene.setFlag(MODULE_ID, 'networks', sceneNetworks);
    
    // Clear cache
    this._clearCache();
    
    // Emit event for UI updates
    Hooks.callAll('cyberpunkred-messenger.networkAvailabilityChanged', {
      networkId,
      sceneId: scene.id,
      available
    });

    this.eventBus.emit('network:availabilityChanged', {
      networkId,
      sceneId: scene.id,
      available
    });
  }

  /**
   * Set signal strength for a network in a scene
   * 
   * @param {string} networkId - Network ID
   * @param {number} strength - Signal strength (0-100)
   * @param {Scene} scene - Scene to update
   */
  async setSignalStrength(networkId, strength, scene = null) {
    scene = scene || canvas.scene || game.scenes.current;
    if (!scene) return;

    const sceneNetworks = scene.getFlag(MODULE_ID, 'networks') || {};
    
    sceneNetworks[networkId] = {
      ...sceneNetworks[networkId],
      signalStrength: Math.max(0, Math.min(100, strength)),
      available: sceneNetworks[networkId]?.available ?? false
    };

    await scene.setFlag(MODULE_ID, 'networks', sceneNetworks);
    this._clearCache();
    
    Hooks.callAll('cyberpunkred-messenger.signalStrengthChanged', {
      networkId,
      sceneId: scene.id,
      strength
    });

    this.eventBus.emit('network:signalChanged', {
      networkId,
      sceneId: scene.id,
      strength
    });
  }

  /**
   * Enable all networks in the current scene
   * Useful for "open world" areas where all networks work
   * 
   * @param {Scene} scene - Scene to update
   */
  async enableAllNetworks(scene = null) {
    scene = scene || canvas.scene || game.scenes.current;
    if (!scene) return;

    const allNetworks = await this.getAllNetworks();
    const sceneNetworks = scene.getFlag(MODULE_ID, 'networks') || {};

    for (const network of allNetworks) {
      sceneNetworks[network.id] = {
        ...sceneNetworks[network.id],
        available: true,
        signalStrength: sceneNetworks[network.id]?.signalStrength ?? 100
      };
    }

    await scene.setFlag(MODULE_ID, 'networks', sceneNetworks);
    this._clearCache();
    
    ui.notifications.info(`All networks enabled in ${scene.name}`);
    Hooks.callAll('cyberpunkred-messenger.networkAvailabilityChanged', {
      sceneId: scene.id,
      bulk: true
    });
  }

  /**
   * Disable all networks in the current scene
   * Useful for dead zones or secure facilities
   * 
   * @param {Scene} scene - Scene to update
   */
  async disableAllNetworks(scene = null) {
    scene = scene || canvas.scene || game.scenes.current;
    if (!scene) return;

    const allNetworks = await this.getAllNetworks();
    const sceneNetworks = scene.getFlag(MODULE_ID, 'networks') || {};

    for (const network of allNetworks) {
      sceneNetworks[network.id] = {
        ...sceneNetworks[network.id],
        available: false,
        signalStrength: sceneNetworks[network.id]?.signalStrength ?? 100
      };
    }

    await scene.setFlag(MODULE_ID, 'networks', sceneNetworks);
    this._clearCache();
    
    ui.notifications.warn(`All networks disabled in ${scene.name}`);
    Hooks.callAll('cyberpunkred-messenger.networkAvailabilityChanged', {
      sceneId: scene.id,
      bulk: true
    });
  }

  /**
   * Reset scene configuration to defaults
   * Removes all scene flags, letting defaultHidden and known networks control visibility
   * 
   * @param {Scene} scene - Scene to reset
   */
  async resetSceneConfig(scene = null) {
    scene = scene || canvas.scene || game.scenes.current;
    if (!scene) return;

    await scene.unsetFlag(MODULE_ID, 'networks');
    this._clearCache();
    
    ui.notifications.info(`Network configuration reset for ${scene.name}`);
    Hooks.callAll('cyberpunkred-messenger.networkAvailabilityChanged', {
      sceneId: scene.id,
      reset: true
    });
  }

  /**
   * Clear availability cache
   * Call this whenever network configuration changes
   */
  _clearCache() {
    this._cache.availableNetworks = null;
    this._cache.lastScene = null;
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
    const actor = this._getPlayerActor();
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
    
    const actor = this._getPlayerActor();
    
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
    
    const actor = this._getPlayerActor();
    if (!actor) {
      return { success: false, error: 'No character selected' };
    }
    
    // Use security service for authentication
    return await this.securityService.attemptPasswordAuth(actor, networkId, password, network);
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
      actor = this._getPlayerActor();
    }
    
    if (!actor) {
      return { success: false, error: 'No character selected' };
    }
    
    // Use security service for bypass attempt
    return await this.securityService.attemptBypass(actor, networkId, network);
  }
  
  /**
   * Check if actor is authenticated
   */
  isAuthenticated(actor, networkId) {
    if (!actor || !networkId || !this.securityService) {
      return false;
    }
    
    const authStatus = this.securityService.checkAuthentication(actor, networkId);
    return authStatus.authenticated;
  }

  /**
   * GM force unlock network for actor
   */
  async gmUnlockNetwork(actor, networkId) {
    if (!game.user.isGM) {
      throw new Error('Only GMs can force unlock networks');
    }
    
    await this.securityService.gmForceUnlock(actor, networkId);
  }

  /**
   * GM reset authentication for actor
   */
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
    const actor = this._getPlayerActor();
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
   * Get the current active network
   * @returns {Object|null} Network object
   */
  getCurrentNetwork() {
    const networkId = this.networkService.getCurrentNetwork();
    if (!networkId) return null;
    
    const allNetworks = this.getAllNetworks();
    return allNetworks.find(n => n.id === networkId);
  }

  /**
   * Set the current active network
   * @param {string} networkId - Network ID to activate
   */
  async setCurrentNetwork(networkId) {
    const allNetworks = await this.getAllNetworks();
    const network = allNetworks.find(n => n.id === networkId);
    if (!network) {
      console.warn(`[${MODULE_ID}] Network not found: ${networkId}`);
      return false;
    }

    // Check if network is available
    const available = await this.getAvailableNetworks();
    if (!available.find(n => n.id === networkId)) {
      ui.notifications.warn(`${network.name} is not available in this location`);
      return false;
    }

    await this.networkService.setCurrentNetwork(networkId, { silent: true });
    
    Hooks.callAll('cyberpunkred-messenger.networkChanged', network);
    this.eventBus.emit('network:changed', { network });
    
    return true;
  }

  /**
   * Get current signal strength
   * @returns {number} Signal strength (0-100)
   */
  getSignalStrength() {
    const currentNetworkId = this.networkService.getCurrentNetwork();
    if (!currentNetworkId) return 0;
    
    const config = this.getNetworkConfig(currentNetworkId);
    return config.signalStrength;
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
    const actor = this._getPlayerActor();
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
    const actor = this._getPlayerActor();
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
    const availableNetworks = await this.getAvailableNetworks(scene);
    
    if (availableNetworks.length === 0) {
      // No networks available - switch to DEAD_ZONE
      await this.setCurrentNetwork('DEAD_ZONE');
      
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
        await this.setCurrentNetwork(preferredNetwork);
        
        ChatMessage.create({
          content: `
            <div class="ncm-chat-notification ncm-chat-notification--info">
              <div class="ncm-chat-notification__icon">
                <i class="${preferred.theme.icon}" style="color: ${preferred.theme.color}"></i>
              </div>
              <div class="ncm-chat-notification__content">
                <h4>Network Auto-Switch</h4>
                <p>Connected to ${preferred.name} (preferred network for ${scene.name})</p>
                <p class="ncm-hint">Signal Strength: ${this.getSignalStrength()}%</p>
              </div>
            </div>
          `,
          whisper: [game.user.id]
        });
        
        return;
      }
    }
    
    // No preferred network or it's unavailable - find strongest signal
    const strongestNetwork = this._findStrongestNetwork(availableNetworks, scene);
    
    if (!strongestNetwork) return; // Shouldn't happen, but safety check
    
    await this.setCurrentNetwork(strongestNetwork.id);
    
    ChatMessage.create({
      content: `
        <div class="ncm-chat-notification ncm-chat-notification--success">
          <div class="ncm-chat-notification__icon">
            <i class="${strongestNetwork.theme.icon}" style="color: ${strongestNetwork.theme.color}"></i>
          </div>
          <div class="ncm-chat-notification__content">
            <h4>Network Auto-Switch</h4>
            <p>Connected to ${strongestNetwork.name} (strongest signal in ${scene.name})</p>
            <p class="ncm-hint">Signal Strength: ${this.getSignalStrength()}%</p>
          </div>
        </div>
      `,
      whisper: [game.user.id]
    });
  }

  /**
   * Find network with strongest signal
   * @private
   * @param {Array<Object>} networks - Available networks
   * @param {Scene} scene - Current scene
   * @returns {Object|null} Network with strongest signal
   */
  _findStrongestNetwork(networks, scene) {
    if (networks.length === 0) return null;
    
    // Get scene signal strengths
    const networksWithSignal = networks.map(network => {
      const config = this.getNetworkConfig(network.id, scene);
      return {
        ...network,
        signalStrength: config.signalStrength
      };
    });
    
    return networksWithSignal.reduce((strongest, current) => {
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
    const scene = canvas.scene || game.scenes.current;
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
  async getEffectiveNetworkConfig(networkId) {
    const allNetworks = await this.getAllNetworks();
    const network = allNetworks.find(n => n.id === networkId);
    if (!network) return null;
    
    const scene = canvas.scene || game.scenes.current;
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
    Hooks.on('canvasReady', async (canvas) => {
      console.log(`${MODULE_ID} | Scene changed, re-scanning networks...`);
      this._clearCache();
      await this.scanNetworks();
      
      // Auto-switch if enabled
      if (canvas.scene) {
        await this.autoSwitchNetwork(canvas.scene);
      }
    });
    
    // Re-scan when controlled token changes
    Hooks.on('controlToken', async () => {
      await this._loadNetworkState();
      this._clearCache();
      await this.scanNetworks();
    });

    // Clear cache when scene flags change
    Hooks.on('updateScene', (scene, data, options, userId) => {
      // Clear cache when network flags change
      if (data.flags && data.flags[MODULE_ID]) {
        this._clearCache();
      }
    });

    // Hook handler for scene changes (static for NetworkManager class)
    Hooks.on('canvasReady', (canvas) => {
      if (game.nightcity?.messenger?.networkManager) {
        const manager = game.nightcity.messenger.networkManager;
        
        // If current network is no longer available, clear it
        if (manager.networkService) {
          const currentNetworkId = manager.networkService.getCurrentNetwork();
          if (currentNetworkId) {
            manager.getAvailableNetworks(canvas.scene).then(available => {
              if (!available.find(n => n.id === currentNetworkId)) {
                manager.networkService.setCurrentNetwork(null);
                ui.notifications.warn("Network connection lost - moved to dead zone");
              }
            });
          }
        }
      }
    });
  }
}