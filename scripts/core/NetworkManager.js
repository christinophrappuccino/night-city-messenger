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
    
    // Check if authentication required
    if (network.security.requiresAuth && !this.authenticatedNetworks.has(networkId)) {
      if (password) {
        const authResult = await this.authenticate(networkId, password);
        if (!authResult.success) {
          return authResult;
        }
      } else {
        return { success: false, requiresAuth: true };
      }
    }
    
    // Disconnect from current network
    const currentNetwork = this.networkService.getCurrentNetwork();
    if (currentNetwork && currentNetwork !== networkId) {
      await this._disconnect();
    }
    
    // Connect to new network using existing NetworkService
    await this.networkService.setCurrentNetwork(network.id, { silent: true });
    
    // Save state
    await this._saveNetworkState();
    
    // Create chat announcement
    await this._announceConnection(network);
    
    // Emit event
    this.eventBus.emit('network:connected', { network });
    
    console.log(`${MODULE_ID} | Connected to ${network.name}`);
    
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
    
    // Check lockout
    const lockout = this.failedAttempts.get(networkId);
    if (lockout && lockout.lockedUntil > Date.now()) {
      const remaining = Math.ceil((lockout.lockedUntil - Date.now()) / 1000);
      return { 
        success: false, 
        locked: true,
        error: `Locked out. Try again in ${remaining}s` 
      };
    }
    
    // GM override
    if (game.user.isGM) {
      this.authenticatedNetworks.add(networkId);
      console.log(`${MODULE_ID} | GM override: authenticated to ${networkId}`);
      return { success: true, gmOverride: true };
    }
    
    // Verify password
    const passwordHash = this._hashPassword(password);
    if (network.security.password === passwordHash) {
      this.authenticatedNetworks.add(networkId);
      this.failedAttempts.delete(networkId);
      
      console.log(`${MODULE_ID} | Authenticated to ${networkId}`);
      
      return { success: true };
    }
    
    // Failed attempt
    const attempts = lockout ? lockout.attempts + 1 : 1;
    
    if (attempts >= network.security.attempts) {
      // Lockout
      this.failedAttempts.set(networkId, {
        attempts: attempts,
        lockedUntil: Date.now() + network.security.lockoutDuration
      });
      
      console.log(`${MODULE_ID} | Network ${networkId} locked out after ${attempts} attempts`);
      
      return { 
        success: false, 
        locked: true,
        error: `Too many failed attempts. Locked for ${network.security.lockoutDuration / 1000}s` 
      };
    } else {
      this.failedAttempts.set(networkId, {
        attempts: attempts,
        lockedUntil: null
      });
      
      return { 
        success: false, 
        attempts: attempts,
        remaining: network.security.attempts - attempts,
        error: 'Invalid access code' 
      };
    }
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
    
    // Import existing skill service
    const SkillService = game.nightcity.SkillService;
    if (!SkillService) {
      console.error(`${MODULE_ID} | SkillService not available`);
      return { success: false, error: 'Skill system not available' };
    }
    
    // Perform skill check
    const result = await SkillService.performCheck({
      actor: actor,
      skills: ['Interface', 'Electronics/Security Tech', 'Basic Tech'],
      dc: network.security.bypassDC,
      taskName: `Breaching ${network.name}`,
      allowLuck: true,
      autoRoll: false
    });
    
    if (result.cancelled) {
      return { success: false, cancelled: true };
    }
    
    if (result.success) {
      // Success! Grant authentication
      this.authenticatedNetworks.add(networkId);
      
      console.log(`${MODULE_ID} | ${actor.name} successfully breached ${network.name}`);
      
      // Create success chat message
      await ChatMessage.create({
        content: `
          <div style="background: rgba(0, 255, 0, 0.1); border: 1px solid #00ff00; padding: 10px; border-radius: 4px;">
            <h3 style="color: #00ff00; margin: 0 0 10px 0;">
              <i class="fas fa-check-circle"></i> BREACH SUCCESSFUL
            </h3>
            <p><strong>${actor.name}</strong> bypassed ${network.name} security</p>
            <p style="font-size: 0.9em;">Roll: ${result.total} vs DC ${network.security.bypassDC}</p>
          </div>
        `,
        speaker: ChatMessage.getSpeaker({ actor })
      });
      
      // NetWatch alert if traced
      if (network.effects.traced) {
        await this._triggerNetWatchAlert(actor, network);
      }
      
      return { success: true, result };
    } else {
      // Failure
      console.log(`${MODULE_ID} | ${actor.name} failed to breach ${network.name}`);
      
      await ChatMessage.create({
        content: `
          <div style="background: rgba(255, 0, 0, 0.1); border: 1px solid #ff0000; padding: 10px; border-radius: 4px;">
            <h3 style="color: #ff0000; margin: 0 0 10px 0;">
              <i class="fas fa-times-circle"></i> BREACH FAILED
            </h3>
            <p><strong>${actor.name}</strong> failed to bypass ${network.name}</p>
            <p style="font-size: 0.9em;">Roll: ${result.total} vs DC ${network.security.bypassDC}</p>
            <p class="warning" style="color: #ff9900;">ICE detected intrusion attempt</p>
          </div>
        `,
        speaker: ChatMessage.getSpeaker({ actor })
      });
      
      return { success: false, result };
    }
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
   * Create chat message announcing connection
   * @private
   */
  async _announceConnection(network) {
    await ChatMessage.create({
      content: `
        <div style="background: rgba(25, 243, 247, 0.1); border: 1px solid #19f3f7; padding: 10px; border-radius: 4px;">
          <p style="margin: 0;">
            <i class="fas ${network.theme.icon}" style="color: ${network.theme.color};"></i>
            Connected to <strong style="color: ${network.theme.color};">${network.name}</strong>
          </p>
          <p style="margin: 5px 0 0 0; font-size: 0.85em; color: #ccc;">
            Signal: ${network.signalStrength}%
          </p>
        </div>
      `,
      whisper: [game.user.id]
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