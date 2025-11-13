/**
 * NetworkManager - Streamlined Version
 * File: scripts/core/NetworkManager.js
 * Module: cyberpunkred-messenger
 * Description: Simplified network management with single source of truth
 * 
 * SIMPLIFIED: 
 * - Networks stored in settings only
 * - Scene availability in scene flags only  
 * - Cleaner authentication flow
 * - Reduced complexity
 */

import { MODULE_ID } from '../utils/constants.js';

export class NetworkManager {
  constructor(networkService, stateManager, eventBus) {
    // Keep backward compatibility with existing initialization
    this.networkService = networkService || null;
    this.stateManager = stateManager || null;
    this.eventBus = eventBus || null;
    
    // Simplified state
    this.currentNetwork = null;
    this.authenticatedNetworks = new Set();
    this._networksCache = null;
    
    console.log(`${MODULE_ID} | NetworkManager constructed (streamlined version)`);
  }
  
  /**
   * Initialize network manager - SIMPLIFIED
   */
  async initialize() {
    console.log(`${MODULE_ID} | NetworkManager: Initializing (streamlined)...`);
    
    try {
      // Ensure settings exist
      let networks = game.settings.get(MODULE_ID, 'networks');
      if (!networks || networks.length === 0) {
        await this._createDefaultNetworks();
        networks = game.settings.get(MODULE_ID, 'networks');
      }
      
      // Load user state
      this.currentNetwork = game.user.getFlag(MODULE_ID, 'currentNetwork');
      const authList = game.user.getFlag(MODULE_ID, 'authenticatedNetworks') || [];
      this.authenticatedNetworks = new Set(authList);
      
      // Register hooks
      this._registerHooks();
      
      console.log(`${MODULE_ID} | NetworkManager initialized with ${networks.length} networks`);
    } catch (error) {
      console.error(`${MODULE_ID} | NetworkManager initialization error:`, error);
      
      // Try to at least create defaults
      try {
        await this._createDefaultNetworks();
        console.log(`${MODULE_ID} | Created default networks as fallback`);
      } catch (e) {
        console.error(`${MODULE_ID} | Failed to create defaults:`, e);
      }
    }
  }
  
  /* -------------------------------------------- */
  /*  Core Network Operations - SIMPLIFIED        */
  /* -------------------------------------------- */
  
  /**
   * Get all networks from settings (single source)
   */
  async getAllNetworks() {
    if (this._networksCache) return this._networksCache;
    
    const networks = game.settings.get(MODULE_ID, 'networks') || [];
    this._networksCache = networks;
    return networks;
  }
  
  /**
   * Get networks available in current scene
   */
  async getAvailableNetworks() {
    const scene = game.scenes.current;
    if (!scene) return [];
    
    const allNetworks = await this.getAllNetworks();
    const sceneConfig = scene.getFlag(MODULE_ID, 'networks') || {};
    
    // Filter to available networks with signal
    return allNetworks
      .filter(network => {
        const config = sceneConfig[network.id];
        return config?.available !== false;
      })
      .map(network => ({
        ...network,
        signal: sceneConfig[network.id]?.signal || 100
      }));
  }
  
  /**
   * Create a new network (simplified structure)
   */
  async createNetwork(networkData) {
    const networks = await this.getAllNetworks();
    
    // Simple network structure
    const network = {
      id: networkData.id || networkData.name.toLowerCase().replace(/\s+/g, '_'),
      name: networkData.name || 'New Network',
      type: networkData.type || 'CUSTOM',
      icon: networkData.icon || 'fa-wifi',
      color: networkData.color || '#19f3f7',
      description: networkData.description || '',
      
      // Simple auth
      requiresAuth: networkData.requiresAuth || false,
      authType: networkData.authType || 'password',
      password: networkData.password || '',
      hackingDC: networkData.hackingDC || 15,
      hackingSkill: networkData.hackingSkill || 'interface',
      
      // Capabilities  
      canSendMessages: networkData.canSendMessages !== false,
      canAccessShards: networkData.canAccessShards !== false
    };
    
    // Check for duplicates
    if (networks.find(n => n.id === network.id)) {
      ui.notifications.error(`Network ID "${network.id}" already exists`);
      return null;
    }
    
    networks.push(network);
    await this._saveNetworks(networks);
    
    this.eventBus?.emit('network:created', { network });
    return network;
  }
  
  /**
   * Update an existing network
   */
  async updateNetwork(networkId, updates) {
    const networks = await this.getAllNetworks();
    const index = networks.findIndex(n => n.id === networkId);
    
    if (index === -1) return null;
    
    networks[index] = { ...networks[index], ...updates };
    await this._saveNetworks(networks);
    
    this.eventBus?.emit('network:updated', { network: networks[index] });
    return networks[index];
  }
  
  /**
   * Delete a network
   */
  async deleteNetwork(networkId) {
    // Protect default networks
    if (['CITINET', 'CORPNET', 'DARKNET'].includes(networkId)) {
      ui.notifications.error('Cannot delete default networks');
      return false;
    }
    
    const networks = await this.getAllNetworks();
    const filtered = networks.filter(n => n.id !== networkId);
    
    if (filtered.length === networks.length) return false;
    
    await this._saveNetworks(filtered);
    
    // Disconnect if this was current network
    if (this.currentNetwork === networkId) {
      await this.disconnect();
    }
    
    this.eventBus?.emit('network:deleted', { networkId });
    return true;
  }
  
  /* -------------------------------------------- */
  /*  Scene Network Configuration                 */
  /* -------------------------------------------- */
  
  /**
   * Set network availability in scene (simplified)
   */
  async setSceneNetwork(sceneId, networkId, config) {
    const scene = game.scenes.get(sceneId);
    if (!scene) return;
    
    const networks = scene.getFlag(MODULE_ID, 'networks') || {};
    
    networks[networkId] = {
      available: config.available ?? true,
      signal: config.signal ?? 100
    };
    
    await scene.setFlag(MODULE_ID, 'networks', networks);
    this.eventBus?.emit('scene:networkUpdated', { sceneId, networkId, config });
  }
  
  /**
   * Quick scan for available networks
   */
  async scanNetworks() {
    console.log(`${MODULE_ID} | Scanning for available networks...`);
    
    const available = await this.getAvailableNetworks();
    
    // Add scan animation
    this.eventBus?.emit('network:scan:start');
    
    await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate scan
    
    this.eventBus?.emit('network:scan:complete', { networks: available });
    
    return available;
  }
  
  /* -------------------------------------------- */
  /*  Connection & Authentication - SIMPLIFIED    */
  /* -------------------------------------------- */
  
  /**
   * Connect to a network
   */
  async connectToNetwork(networkId) {
    const network = (await this.getAllNetworks()).find(n => n.id === networkId);
    if (!network) {
      ui.notifications.error('Network not found');
      return false;
    }
    
    // Check scene availability
    const available = await this.getAvailableNetworks();
    const sceneNetwork = available.find(n => n.id === networkId);
    
    if (!sceneNetwork) {
      ui.notifications.warn(`${network.name} is not available in this location`);
      return false;
    }
    
    // Handle authentication if needed
    if (network.requiresAuth && !this.authenticatedNetworks.has(networkId)) {
      const success = await this._authenticate(network);
      if (!success) {
        this.eventBus?.emit('network:authentication:failed', { network });
        return false;
      }
      
      this.authenticatedNetworks.add(networkId);
      await this._saveAuthState();
    }
    
    // Disconnect from current
    if (this.currentNetwork && this.currentNetwork !== networkId) {
      await this.disconnect();
    }
    
    // Connect
    this.currentNetwork = networkId;
    await game.user.setFlag(MODULE_ID, 'currentNetwork', networkId);
    
    // Announce connection
    await ChatMessage.create({
      content: `<div class="ncm-network-connect">
        <i class="fas ${network.icon}" style="color: ${network.color}"></i>
        <strong>Connected to ${network.name}</strong>
        <div>Signal: ${sceneNetwork.signal}%</div>
      </div>`,
      speaker: ChatMessage.getSpeaker({ alias: 'Network System' }),
      whisper: [game.user.id]
    });
    
    this.eventBus?.emit('network:connected', { network, signal: sceneNetwork.signal });
    return true;
  }
  
  /**
   * Disconnect from current network
   */
  async disconnect() {
    if (!this.currentNetwork) return;
    
    const networkId = this.currentNetwork;
    this.currentNetwork = null;
    await game.user.unsetFlag(MODULE_ID, 'currentNetwork');
    
    this.eventBus?.emit('network:disconnected', { networkId });
  }
  
  /**
   * Simplified authentication
   */
  async _authenticate(network) {
    if (network.authType === 'password') {
      return await this._passwordAuth(network);
    } else {
      return await this._hackingAuth(network);
    }
  }
  
  /**
   * Password authentication
   */
  async _passwordAuth(network) {
    return new Promise(resolve => {
      new Dialog({
        title: `${network.name} Authentication`,
        content: `
          <div class="ncm-auth-dialog">
            <p>Enter password for ${network.name}:</p>
            <input type="password" id="network-password" autofocus>
          </div>
        `,
        buttons: {
          connect: {
            icon: '<i class="fas fa-sign-in-alt"></i>',
            label: 'Connect',
            callback: html => {
              const input = html.find('#network-password').val();
              resolve(input === network.password);
            }
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: 'Cancel',
            callback: () => resolve(false)
          }
        },
        default: 'connect'
      }).render(true);
    });
  }
  
  /**
   * Hacking authentication (skill check)
   */
  async _hackingAuth(network) {
    const actor = game.user.character;
    if (!actor) {
      ui.notifications.warn('No character selected');
      return false;
    }
    
    const skill = network.hackingSkill || 'interface';
    const dc = network.hackingDC || 15;
    const skillValue = actor.system.skills[skill]?.value || 0;
    
    const roll = await new Roll(`1d10 + ${skillValue}`).evaluate();
    
    await roll.toMessage({
      flavor: `
        <div class="ncm-hack-attempt">
          <strong>Attempting to bypass ${network.name}</strong>
          <div>DC: ${dc}</div>
          <div class="${roll.total >= dc ? 'success' : 'failure'}">
            ${roll.total >= dc ? '✓ ACCESS GRANTED' : '✗ ACCESS DENIED'}
          </div>
        </div>
      `,
      speaker: ChatMessage.getSpeaker({ actor })
    });
    
    return roll.total >= dc;
  }
  
  /* -------------------------------------------- */
  /*  Network Status                              */
  /* -------------------------------------------- */
  
  /**
   * Get current network status
   */
  getNetworkStatus() {
    return {
      connected: !!this.currentNetwork,
      networkId: this.currentNetwork,
      authenticated: this.currentNetwork ? 
        this.authenticatedNetworks.has(this.currentNetwork) : false
    };
  }
  
  /**
   * Check if authenticated with a network
   */
  isAuthenticated(networkId) {
    return this.authenticatedNetworks.has(networkId);
  }
  
  /* -------------------------------------------- */
  /*  Private Helper Methods                      */
  /* -------------------------------------------- */
  
  /**
   * Save networks to settings
   */
  async _saveNetworks(networks) {
    this._networksCache = null; // Clear cache
    await game.settings.set(MODULE_ID, 'networks', networks);
  }
  
  /**
   * Save authentication state
   */
  async _saveAuthState() {
    await game.user.setFlag(MODULE_ID, 'authenticatedNetworks', 
      Array.from(this.authenticatedNetworks));
  }
  
  /**
   * Create default networks
   */
  async _createDefaultNetworks() {
    const defaults = [
      {
        id: 'CITINET',
        name: 'CitiNet',
        type: 'DEFAULT',
        icon: 'fa-wifi',
        color: '#19f3f7',
        description: 'Night City public network. Monitored by NetWatch.',
        requiresAuth: false,
        canSendMessages: true,
        canAccessShards: true
      },
      {
        id: 'CORPNET',
        name: 'CorpNet',
        type: 'DEFAULT',
        icon: 'fa-building',
        color: '#f65261',
        description: 'Corporate secure network. High-speed, encrypted.',
        requiresAuth: true,
        authType: 'password',
        password: 'corpo2045',
        canSendMessages: true,
        canAccessShards: true
      },
      {
        id: 'DARKNET',
        name: 'DarkNet',
        type: 'DEFAULT',
        icon: 'fa-user-secret',
        color: '#9b59b6',
        description: 'Underground network. Anonymous but dangerous.',
        requiresAuth: true,
        authType: 'hacking',
        hackingDC: 18,
        hackingSkill: 'interface',
        canSendMessages: true,
        canAccessShards: true
      }
    ];
    
    await game.settings.set(MODULE_ID, 'networks', defaults);
    console.log(`${MODULE_ID} | Created default networks`);
  }
  
  /**
   * Register hooks
   */
  _registerHooks() {
    // Clear cache and validate connection on scene change
    Hooks.on('canvasReady', async () => {
      this._networksCache = null;
      
      // Check if current network is still available
      const available = await this.getAvailableNetworks();
      if (this.currentNetwork && !available.find(n => n.id === this.currentNetwork)) {
        ui.notifications.warn('Lost network connection - not available in this location');
        await this.disconnect();
        
        // Try to connect to CitiNet if available
        if (available.find(n => n.id === 'CITINET')) {
          await this.connectToNetwork('CITINET');
        }
      }
    });
  }
  
  /**
   * Auto-switch network based on scene (GM feature)
   */
  async autoSwitchNetwork(scene) {
    if (!game.user.isGM) return;
    
    const sceneDefault = scene.getFlag(MODULE_ID, 'defaultNetwork');
    if (sceneDefault) {
      await this.connectToNetwork(sceneDefault);
    }
  }
}

// Register settings on init
Hooks.once('init', () => {
  game.settings.register(MODULE_ID, 'networks', {
    scope: 'world',
    config: false,
    type: Array,
    default: []
  });
});