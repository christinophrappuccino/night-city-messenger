/**
 * NetworkService
 * @file scripts/services/NetworkService.js
 * @module cyberpunkred-messenger
 * @description Network state management — scene-based availability, authentication
 *              (password + skill check), dead zone detection, network switching with
 *              signal strength, and message queuing integration.
 *
 *              Depends on: EventBus, StateManager, SettingsManager, SocketManager,
 *                          SoundService, ThemeService
 *
 *              Initialization priority: ready/30
 */

import { MODULE_ID, EVENTS, SOCKET_OPS, DEFAULTS, NETWORKS, NETWORK_TYPES, SECURITY_LEVELS } from '../utils/constants.js';
import { log, isGM, generateId } from '../utils/helpers.js';

export class NetworkService {

  constructor() {
    // ─── Service References (from game.nightcity) ───
    this.eventBus = game.nightcity.eventBus;
    this.stateManager = game.nightcity.stateManager;
    this.settingsManager = game.nightcity.settingsManager;
    this.socketManager = game.nightcity.socketManager;
    this.soundService = game.nightcity.soundService;

    // ─── Internal State ───
    /** @type {string} Current network ID */
    this._currentNetworkId = NETWORKS.CITINET;
    /** @type {boolean} Dead zone flag */
    this._isDeadZone = false;
    /** @type {boolean} Dead zone flag */
    this._isDeadZone = false;
    /** @type {string|null} Network ID before entering dead zone (for restore) */
    this._preDeadZoneNetworkId = null;
    /** @type {number} Current signal strength 0-100 */
    this._signalStrength = 75;
    /** @type {Set<string>} Networks the current user is authenticated to */
    this._authenticatedNetworks = new Set();
    /** @type {Map<string, object>} Cached merged network list (core + custom) */
    this._networkCache = new Map();
    /** @type {boolean} */
    this._initialized = false;

    this._buildNetworkCache();
    this._registerSceneHook();

    this._initialized = true;
    log.info('NetworkService initialized');
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API — Getters
  // ═══════════════════════════════════════════════════════════

  /** @returns {string} Current network ID */
  get currentNetworkId() { return this._currentNetworkId; }

  /** @returns {object|null} Full network object for current network */
  get currentNetwork() { return this.getNetwork(this._currentNetworkId); }

  /** @returns {boolean} */
  get isDeadZone() { return this._isDeadZone; }

  /** @returns {number} 0-100 */
  get signalStrength() { return this._signalStrength; }

  /**
   * Get a network definition by ID.
   * @param {string} networkId
   * @returns {object|null}
   */
  getNetwork(networkId) {
    return this._networkCache.get(networkId) ?? null;
  }

  /**
   * Get all known networks (core + custom).
   * @returns {object[]}
   */
  getAllNetworks() {
    return Array.from(this._networkCache.values());
  }

  /**
   * Get networks available in the current scene.
   * If no scene or no scene flags, returns globally available networks.
   * @returns {object[]}
   */
  getAvailableNetworks() {
    if (this._isDeadZone) return [];

    const sceneId = game.scenes?.viewed?.id;
    const sceneFlags = this._getSceneNetworkFlags(sceneId);

    return this.getAllNetworks().filter(net => {
      // Globally available
      if (net.availability.global) return true;
      // Available in current scene
      if (sceneId && net.availability.scenes?.includes(sceneId)) return true;
      // Scene-level override
      if (sceneFlags?.networkAvailability?.[net.id]) return true;
      return false;
    });
  }

  /**
   * Check if the user can access a specific network (available + authenticated).
   * @param {string} networkId
   * @returns {boolean}
   */
  canAccessNetwork(networkId) {
    if (this._isDeadZone) return false;

    const network = this.getNetwork(networkId);
    if (!network) return false;

    // Check availability
    const available = this.getAvailableNetworks();
    if (!available.find(n => n.id === networkId)) return false;

    // Check auth requirement
    if (network.security.requiresAuth && !this._authenticatedNetworks.has(networkId)) {
      // GM always has access
      if (isGM()) return true;
      return false;
    }

    return true;
  }

  /**
   * Get the access control block to stamp on a message being sent.
   * Returns null if the network has no restrictions.
   * @returns {object|null}
   */
  getMessageAccessControl() {
    const network = this.currentNetwork;
    if (!network) return null;
    if (!network.effects?.restrictedAccess) return null;

    return {
      restricted: true,
      requiredNetwork: network.id,
      requiredNetworkName: network.name,
      bypassable: true,
      bypass: {
        allowPassword: network.security?.requiresAuth ?? false,
        password: network.security?.password ?? '',
        allowSkillCheck: (network.security?.bypassSkills?.length ?? 0) > 0,
        bypassSkills: network.security?.bypassSkills ?? [],
        bypassDC: network.security?.bypassDC ?? 15,
        allowKeyItem: false,
        keyItemName: null,
        keyItemId: null,
        keyItemTag: null,
        keyItemConsume: false,
      },
    };
  }

  /**
   * Check if the current user is authenticated to a network.
   * @param {string} networkId
   * @returns {boolean}
   */
  isAuthenticated(networkId) {
    if (isGM()) return true;
    return this._authenticatedNetworks.has(networkId);
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API — Network Switching
  // ═══════════════════════════════════════════════════════════

  /**
   * Switch to a different network.
   * @param {string} networkId
   * @param {object} [options]
   * @param {boolean} [options.force=false] - GM override: skip auth check
   * @param {boolean} [options.silent=false] - Skip animations/sounds
   * @returns {{ success: boolean, reason?: string }}
   */
  async switchNetwork(networkId, options = {}) {
    const { force = false, silent = false } = options;

    if (this._isDeadZone && !force) {
      return { success: false, reason: 'dead_zone' };
    }

    const network = this.getNetwork(networkId);
    if (!network) {
      return { success: false, reason: 'unknown_network' };
    }

    // Check availability
    const available = this.getAvailableNetworks();
    if (!available.find(n => n.id === networkId) && !force) {
      return { success: false, reason: 'not_available' };
    }

    // Check authentication
    if (network.security.requiresAuth && !this._authenticatedNetworks.has(networkId) && !force) {
      if (!isGM()) {
        return { success: false, reason: 'auth_required', network };
      }
    }

    const previousId = this._currentNetworkId;
    this._currentNetworkId = networkId;
    this._signalStrength = network.signalStrength;

    // Play sound + emit events
    if (!silent) {
      this.soundService?.play('switch');
    }

    this.eventBus.emit(EVENTS.NETWORK_CHANGED, {
      previousNetworkId: previousId,
      currentNetworkId: networkId,
      network,
      signalStrength: this._signalStrength,
    });

    // Broadcast to other clients if GM
    if (isGM()) {
      this.socketManager.emit(SOCKET_OPS.NETWORK_STATE_CHANGED, {
        type: 'switch',
        networkId,
        sceneId: game.scenes?.viewed?.id,
      });
    }

    log.info(`Switched to network: ${network.name} (${networkId})`);
    return { success: true };
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API — Authentication
  // ═══════════════════════════════════════════════════════════

  /**
   * Attempt password authentication for a network.
   * @param {string} networkId
   * @param {string} password
   * @returns {{ success: boolean, reason?: string }}
   */
  authenticatePassword(networkId, password) {
    const network = this.getNetwork(networkId);
    if (!network) return { success: false, reason: 'unknown_network' };
    if (!network.security.requiresAuth) return { success: true };

    if (network.security.password && password === network.security.password) {
      this._authenticatedNetworks.add(networkId);
      this.soundService?.play('login-success');
      this.eventBus.emit(EVENTS.NETWORK_AUTH_SUCCESS, { networkId, method: 'password' });
      log.info(`Authenticated to ${network.name} via password`);
      return { success: true };
    }

    this.soundService?.play('login-fail');
    this.eventBus.emit(EVENTS.NETWORK_AUTH_FAILURE, { networkId, method: 'password' });
    return { success: false, reason: 'invalid_password' };
  }

  /**
   * Attempt skill-based authentication bypass for a network.
   * This checks if the result meets the DC — the actual roll is done elsewhere
   * (or in Phase 4 SkillService). For Phase 3 we accept a pre-rolled total.
   * @param {string} networkId
   * @param {number} rollTotal - The total of the skill check
   * @param {string} [skillName] - Which skill was used (for logging)
   * @returns {{ success: boolean, reason?: string }}
   */
  authenticateSkillCheck(networkId, rollTotal, skillName = 'unknown') {
    const network = this.getNetwork(networkId);
    if (!network) return { success: false, reason: 'unknown_network' };
    if (!network.security.requiresAuth) return { success: true };

    const dc = network.security.bypassDC ?? 15;

    if (rollTotal >= dc) {
      this._authenticatedNetworks.add(networkId);
      this.soundService?.play('hack-success');
      this.eventBus.emit(EVENTS.NETWORK_AUTH_SUCCESS, { networkId, method: 'skill', skillName, rollTotal, dc });
      log.info(`Authenticated to ${network.name} via ${skillName} (${rollTotal} >= ${dc})`);
      return { success: true };
    }

    this.soundService?.play('hack-fail');
    this.eventBus.emit(EVENTS.NETWORK_AUTH_FAILURE, { networkId, method: 'skill', skillName, rollTotal, dc });
    return { success: false, reason: 'skill_check_failed' };
  }

  /**
   * Revoke authentication for a network (e.g., on network reset or lockout).
   * @param {string} networkId
   */
  revokeAuth(networkId) {
    this._authenticatedNetworks.delete(networkId);
    log.debug(`Auth revoked for network: ${networkId}`);
  }

  /**
   * Clear all authentications (e.g., on scene change).
   */
  clearAllAuth() {
    this._authenticatedNetworks.clear();
    log.debug('All network authentications cleared');
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API — Dead Zones
  // ═══════════════════════════════════════════════════════════

  /**
   * Toggle dead zone for the current scene. GM only.
   * @param {string} sceneId
   * @param {boolean} isDead
   */
  async toggleDeadZone(sceneId, isDead) {
    if (!isGM()) return;

    const scene = game.scenes.get(sceneId);
    if (!scene) return;

    await scene.setFlag(MODULE_ID, 'deadZone', isDead);

    // If this is the viewed scene, update local state
    if (sceneId === game.scenes?.viewed?.id) {
      this._setDeadZone(isDead);
    }

    // Broadcast
    this.socketManager.emit(SOCKET_OPS.NETWORK_STATE_CHANGED, {
      type: 'deadZone',
      sceneId,
      isDead,
    });

    log.info(`Dead zone ${isDead ? 'enabled' : 'disabled'} for scene: ${scene.name}`);
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API — Custom Network CRUD (GM Only)
  // ═══════════════════════════════════════════════════════════

  /**
   * Create a new custom network. GM only.
   * @param {object} data - Network definition (see spec 5.3)
   * @returns {{ success: boolean, network?: object, error?: string }}
   */
  async createNetwork(data) {
    if (!isGM()) return { success: false, error: 'GM only' };

    const network = this._buildNetworkObject(data);
    const customs = this.settingsManager.get('customNetworks') ?? [];
    customs.push(network);
    await this.settingsManager.set('customNetworks', customs);

    this._buildNetworkCache();
    this.eventBus.emit(EVENTS.NETWORK_CHANGED, { type: 'created', networkId: network.id });
    log.info(`Custom network created: ${network.name} (${network.id})`);
    return { success: true, network };
  }

  /**
   * Update an existing custom network. GM only.
   * @param {string} networkId
   * @param {object} updates
   * @returns {{ success: boolean, error?: string }}
   */
  async updateNetwork(networkId, updates) {
    if (!isGM()) return { success: false, error: 'GM only' };

    // Cannot edit core networks
    const existing = this.getNetwork(networkId);
    if (!existing) return { success: false, error: 'Network not found' };
    if (existing.isCore) return { success: false, error: 'Cannot edit core networks' };

    const customs = this.settingsManager.get('customNetworks') ?? [];
    const idx = customs.findIndex(n => n.id === networkId);
    if (idx === -1) return { success: false, error: 'Custom network not found' };

    customs[idx] = foundry.utils.mergeObject(customs[idx], updates, { inplace: false });
    await this.settingsManager.set('customNetworks', customs);

    this._buildNetworkCache();
    this.eventBus.emit(EVENTS.NETWORK_CHANGED, { type: 'updated', networkId });
    log.info(`Custom network updated: ${networkId}`);
    return { success: true };
  }

  /**
   * Delete a custom network. GM only.
   * @param {string} networkId
   * @returns {{ success: boolean, error?: string }}
   */
  async deleteNetwork(networkId) {
    if (!isGM()) return { success: false, error: 'GM only' };

    const existing = this.getNetwork(networkId);
    if (!existing) return { success: false, error: 'Network not found' };
    if (existing.isCore) return { success: false, error: 'Cannot delete core networks' };

    let customs = this.settingsManager.get('customNetworks') ?? [];
    customs = customs.filter(n => n.id !== networkId);
    await this.settingsManager.set('customNetworks', customs);

    // If anyone was on this network, switch to CitiNet
    if (this._currentNetworkId === networkId) {
      await this.switchNetwork(NETWORKS.CITINET, { silent: true });
    }

    this._buildNetworkCache();
    this.eventBus.emit(EVENTS.NETWORK_CHANGED, { type: 'deleted', networkId });
    log.info(`Custom network deleted: ${networkId}`);
    return { success: true };
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API — Scene Flag Management
  // ═══════════════════════════════════════════════════════════

  /**
   * Set which networks are available in a specific scene. GM only.
   * @param {string} sceneId
   * @param {Object<string, boolean>} availability - { networkId: true/false }
   */
  async setSceneNetworkAvailability(sceneId, availability) {
    if (!isGM()) return;
    const scene = game.scenes.get(sceneId);
    if (!scene) return;

    await scene.setFlag(MODULE_ID, 'networkAvailability', availability);
    log.info(`Scene network availability updated for: ${scene.name}`);
  }

  /**
   * Set the default network for a scene. GM only.
   * @param {string} sceneId
   * @param {string} networkId
   */
  async setSceneDefaultNetwork(sceneId, networkId) {
    if (!isGM()) return;
    const scene = game.scenes.get(sceneId);
    if (!scene) return;

    await scene.setFlag(MODULE_ID, 'defaultNetwork', networkId);
    log.info(`Default network for ${scene.name} set to: ${networkId}`);
  }

  /**
   * Get network flags for a scene.
   * @param {string} sceneId
   * @returns {object}
   */
  getSceneNetworkConfig(sceneId) {
    return this._getSceneNetworkFlags(sceneId);
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API — Signal & Reliability
  // ═══════════════════════════════════════════════════════════

  /**
   * Check if a message would be delivered reliably on the current network.
   * Returns true if delivery succeeds, false if the network drops it.
   * @returns {boolean}
   */
  checkReliability() {
    if (this._isDeadZone) return false;
    const network = this.currentNetwork;
    if (!network) return false;
    return Math.random() * 100 < network.reliability;
  }

  /**
   * Get the message delay for the current network.
   * @returns {number} Delay in ms
   */
  getMessageDelay() {
    return this.currentNetwork?.effects?.messageDelay ?? 0;
  }

  /**
   * Check if messages on the current network are traced.
   * @returns {boolean}
   */
  isTraced() {
    return this.currentNetwork?.effects?.traced ?? false;
  }

  /**
   * Check if the current network provides anonymity.
   * @returns {boolean}
   */
  isAnonymous() {
    return this.currentNetwork?.effects?.anonymity ?? false;
  }

  // ═══════════════════════════════════════════════════════════
  //  INTERNAL — Network Cache
  // ═══════════════════════════════════════════════════════════

  /**
   * Rebuild the merged network cache from core + custom networks.
   * @private
   */
  _buildNetworkCache() {
    this._networkCache.clear();

    // Core networks from constants
    for (const net of DEFAULTS.CORE_NETWORKS) {
      this._networkCache.set(net.id, { ...net });
    }

    // Custom networks from settings
    try {
      const customs = this.settingsManager.get('customNetworks') ?? [];
      for (const net of customs) {
        this._networkCache.set(net.id, { ...net });
      }
    } catch {
      // Settings might not be ready yet during early init
    }
  }

  /**
   * Build a complete network object from partial input.
   * @param {object} data
   * @returns {object}
   * @private
   */
  _buildNetworkObject(data) {
    return {
      id: data.id || `net_${generateId()}`,
      name: data.name || 'Unnamed Network',
      type: data.type || NETWORK_TYPES.CUSTOM,
      isCore: false,
      availability: {
        global: data.availability?.global ?? false,
        scenes: data.availability?.scenes ?? [],
      },
      signalStrength: data.signalStrength ?? 75,
      reliability: data.reliability ?? 85,
      security: {
        level: data.security?.level ?? SECURITY_LEVELS.NONE,
        requiresAuth: data.security?.requiresAuth ?? false,
        password: data.security?.password ?? '',
        bypassSkills: data.security?.bypassSkills ?? [],
        bypassDC: data.security?.bypassDC ?? 15,
        maxAttempts: data.security?.maxAttempts ?? 3,
        lockoutDuration: data.security?.lockoutDuration ?? 3600000,
      },
      effects: {
        messageDelay: data.effects?.messageDelay ?? 0,
        traced: data.effects?.traced ?? false,
        anonymity: data.effects?.anonymity ?? false,
        canRoute: data.effects?.canRoute ?? true,
      },
      theme: {
        color: data.theme?.color ?? '#19f3f7',
        icon: data.theme?.icon ?? 'fa-wifi',
        glitchIntensity: data.theme?.glitchIntensity ?? 0.1,
      },
      description: data.description ?? '',
      lore: data.lore ?? '',
      createdBy: game.user.id,
      createdAt: new Date().toISOString(),
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  INTERNAL — Scene Hooks
  // ═══════════════════════════════════════════════════════════

  /** @private */
  _registerSceneHook() {
    // Auto-switch network on scene change
    Hooks.on('canvasReady', (canvas) => {
      this._onSceneChange(canvas.scene);
    });
  }

  /**
   * Handle scene change — check dead zone, auto-switch to scene default.
   * @param {Scene} scene
   * @private
   */
  _onSceneChange(scene) {
    if (!scene) return;

    const flags = this._getSceneNetworkFlags(scene.id);

    // Check dead zone
    const isDead = scene.getFlag(MODULE_ID, 'deadZone') ?? false;
    if (isDead !== this._isDeadZone) {
      this._setDeadZone(isDead);
    }

    // Auto-switch to scene default network if set
    const defaultNet = flags?.defaultNetwork;
    if (defaultNet && defaultNet !== this._currentNetworkId) {
      const net = this.getNetwork(defaultNet);
      if (net) {
        // Only auto-switch if the network doesn't require auth, or we're already authed
        if (!net.security.requiresAuth || this._authenticatedNetworks.has(defaultNet) || isGM()) {
          this.switchNetwork(defaultNet, { silent: false });
        } else {
          // Fall back to CitiNet
          this.switchNetwork(NETWORKS.CITINET, { silent: false });
        }
      }
    }

    // Rebuild available networks for this scene
    this._buildNetworkCache();

    log.debug(`Scene changed: ${scene.name}, dead zone: ${isDead}`);
  }

  /**
   * Set dead zone state with appropriate effects.
   * @param {boolean} isDead
   * @private
   */
  _setDeadZone(isDead) {
    const wasDead = this._isDeadZone;
    this._isDeadZone = isDead;

    if (isDead && !wasDead) {
      // Entering dead zone — save current network for later restore
      this._preDeadZoneNetworkId = this._currentNetworkId;
      this._signalStrength = 0;
      this.soundService?.play('dead-zone');
      this.eventBus.emit(EVENTS.NETWORK_DISCONNECTED, { reason: 'dead_zone' });
      log.info(`Entered dead zone — NO SIGNAL (was: ${this._preDeadZoneNetworkId})`);
    } else if (!isDead && wasDead) {
      // Leaving dead zone — restore previous network
      const restoreId = this._preDeadZoneNetworkId || this._currentNetworkId;
      this._preDeadZoneNetworkId = null;

      // Check if the previous network is still available in this scene
      const available = this.getAvailableNetworks();
      const canRestore = available.some(n => n.id === restoreId);

      if (canRestore) {
        this._currentNetworkId = restoreId;
        this._signalStrength = this.currentNetwork?.signalStrength ?? 75;
        log.info(`Left dead zone — restored to ${restoreId}`);
      } else {
        // Fall back to first available or CITINET
        const fallback = available[0]?.id || NETWORKS.CITINET;
        this._currentNetworkId = fallback;
        this._signalStrength = this.currentNetwork?.signalStrength ?? 75;
        log.info(`Left dead zone — ${restoreId} unavailable, fell back to ${fallback}`);
      }

      this.soundService?.play('connect');
      this.eventBus.emit(EVENTS.NETWORK_CONNECTED, { networkId: this._currentNetworkId });

      // Trigger queue flush via MessageService
      game.nightcity.messageService?.flushQueue();
    }
  }

  /**
   * Read scene-level network flags.
   * @param {string} sceneId
   * @returns {object}
   * @private
   */
  _getSceneNetworkFlags(sceneId) {
    if (!sceneId) return {};
    const scene = game.scenes?.get(sceneId);
    if (!scene) return {};

    return {
      networkAvailability: scene.getFlag(MODULE_ID, 'networkAvailability') ?? {},
      defaultNetwork: scene.getFlag(MODULE_ID, 'defaultNetwork') ?? null,
      deadZone: scene.getFlag(MODULE_ID, 'deadZone') ?? false,
    };
  }
}
