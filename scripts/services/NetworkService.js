/**
 * NetworkService
 * @file scripts/services/NetworkService.js
 * @module night-city-messenger
 * @description Network state management — scene-based availability, authentication
 *              (password + skill check), dead zone detection, network switching with
 *              signal strength, and message queuing integration.
 *
 *              Depends on: EventBus, StateManager, SettingsManager, SocketManager,
 *                          SoundService, ThemeService
 *
 *              Initialization priority: ready/30
 */

import { MODULE_ID, EVENTS, SOCKET_OPS, DEFAULTS, NETWORKS, NETWORK_TYPES, SECURITY_LEVELS, NETWORK_ACCESS_MODES, CONNECTION_MODES } from '../utils/constants.js';
import { log, isGM, generateId, whisperCardHtml } from '../utils/helpers.js';
import { bypassDCFor } from '../utils/bypassSkills.js';
import { sourceUuidOf, prewireFlags } from '../utils/scenesAtlas.js';
import { liveRun, withRun, expiredRuns } from '../utils/networkNodes.js';
import { sanitizeNode, listNodes, cutNetworks, carriedNetworks, sceneBlocks, expiredJams, statePatch, appendLog, NODE_STATES, NODE_EFFECTS, activeEffects, withEffect, expiredEffects, nodeIsUp,
  NODE_PROGRAMS, makeInfection, familyNodes, wormTarget } from '../utils/networkNodes.js';

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
    /** @type {boolean} true while the dead zone was entered because the scene's nodes cut every reachable network */
    this._nodeDead = false;
    /** @type {string|null} the network a node cut moved us off (restored when it comes back) */
    this._preNodeCutNetworkId = null;

    this._buildNetworkCache();
    this._registerSceneHook();
    this._registerNodeHooks();

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
    // A network whose every node on this scene is down does not reach it (utils/networkNodes.js, the scene rule).
    const cut = sceneId ? cutNetworks(this._nodeMap(), sceneId, this._nowMs()) : new Set();
    const carried = sceneId ? carriedNetworks(this._nodeMap(), sceneId, this._nowMs()) : new Set();

    return this.getAllNetworks().filter(net => {
      if (cut.has(net.id)) return false;
      if (carried.has(net.id)) return true;
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
    if (network.security.requiresAuth && !this._authOk(networkId)) {
      // GM always has access
      if (isGM()) return true;
      return false;
    }

    return true;
  }

  /**
   * Get the access control block to stamp on a message being sent.
   * Returns null if the network has no restrictions.
   * @param {string|null} [networkId] - Stamp for this network instead of the
   *   current connection (the GM composer's per-message "send via" override).
   * @returns {object|null}
   */
  getMessageAccessControl(networkId = null) {
    const network = networkId ? this.getNetwork(networkId) : this.currentNetwork;
    if (!network) return null;
    if (!network.effects?.restrictedAccess) return null;

    return {
      restricted: true,
      requiredNetwork: network.id,
      requiredNetworkName: network.name,
      bypassable: true,
      bypass: {
        // Explicit method flags from network security config
        allowPassword: network.security?.allowPassword ?? !!(network.security?.password),
        password: network.security?.password ?? '',
        allowSkillCheck: network.security?.allowSkillCheck ?? (network.security?.bypassSkills?.length > 0),
        authLogic: network.security?.authLogic ?? 'any',
        bypassSkills: network.security?.bypassSkills ?? [],
        bypassDC: network.security?.bypassDC ?? 15,
        bypassSkillDCs: network.security?.bypassSkillDCs ?? {},
        allowKeyItem: network.security?.allowKeyItem ?? false,
        keyItemName: network.security?.keyItemName ?? null,
        keyItemId: null,
        keyItemTag: network.security?.keyItemTag ?? null,
        keyItemConsume: network.security?.keyItemConsume ?? false,
      },
    };
  }

  /**
   * Check if the current network allows sending to a specific target network.
   * @param {string} targetNetworkId
   * @returns {{ allowed: boolean, reason?: string }}
  */
  canSendToNetwork(targetNetworkId) {
    const current = this.currentNetwork;
    if (!current) return { allowed: false, reason: 'No active network' };
    if (current.id === targetNetworkId) return { allowed: true };

    if (!current.effects?.canRoute) {
      return {
        allowed: false,
        reason: `${current.name} does not permit cross-network routing`,
      };
    }

    const allowed = current.effects?.allowedRecipientNetworks ?? [];
    if (allowed.length > 0 && !allowed.includes(targetNetworkId)) {
      return {
        allowed: false,
        reason: `${current.name} cannot route to ${targetNetworkId}`,
      };
    }

    return { allowed: true };
   }

  /**
   * Check if the current network satisfies a message's access requirement.
   * @param {object} accessControl - The message's accessControl block
   * @returns {boolean}
   */
  satisfiesMessageAccess(accessControl) {
    if (!accessControl?.restricted) return true;
    return this.isOnNetwork(accessControl.requiredNetwork);
  }

   /**
    * Get all network IDs reachable from the current network.
    * Used by composer to filter recipient list.
    * @returns {string[]}
    */
  getReachableNetworkIds() {
    const current = this.currentNetwork;
    if (!current) return [];

    if (!current.effects?.canRoute) {
      return [current.id];
    }

    const allowed = current.effects?.allowedRecipientNetworks ?? [];
    if (allowed.length > 0) {
      return [...new Set([current.id, ...allowed])];
    }

    return this.getAllNetworks().map(n => n.id);
  }

  /**
    * Check if the player is currently connected to a specific network.
    * @param {string} networkId
    * @returns {boolean}
    */
  isOnNetwork(networkId) {
    return this._currentNetworkId === networkId;
  }

  /**
   * Check if the current user is authenticated to a network.
   * @param {string} networkId
   * @returns {boolean}
   */
  isAuthenticated(networkId) {
    if (isGM()) return true;
    return this._authOk(networkId);
  }

  /** Logged in to a network on this client — by its login, or through a BACKDOOR one of this user's characters left on any of its nodes. @private */
  _authOk(networkId) {
    if (this._authenticatedNetworks.has(networkId)) return true;
    return this.hasBackdoor(networkId);
  }

  /** A live backdoor on any node of this network for a character this user owns (network nodes, step 4). */
  hasBackdoor(networkId) {
    try {
      const now = this._nowMs();
      const mine = new Set((game.actors?.filter?.((a) => a.isOwner) ?? []).map((a) => a.id));
      if (!mine.size) return false;
      return this.getNodes({ networkId }).some((n) => activeEffects(n, 'backdoors', now).some((e) => mine.has(e.actorId)));
    } catch { return false; }
  }

  /**
   * Evaluate a network-access config block against the CURRENT connection.
   * The shared "am I on an allowed network with enough signal?" contract used by
   * both Data Shards and Terminals — each caller owns the `required` decision and
   * any GM bypass; this only answers the access question itself (no GM bypass
   * here, so shard behavior is unchanged by the extraction).
   *
   * @param {object} netConfig - { accessMode, allowedNetworks[], allowedTypes[], connectionMode, signalThreshold }
   * @returns {{ allowed: boolean, reason?: string, requiredNetwork?: string|null, signalInfo?: {signal:number, threshold:number} }}
   */
  checkAccess(netConfig = {}) {
    const currentNetworkId = this.currentNetworkId;

    // No network connected at all.
    if (!currentNetworkId) {
      return { allowed: false, reason: 'No network connection' };
    }

    if (!this.networkPasses(netConfig, this.currentNetwork ?? { id: currentNetworkId })) {
      const requirements = [];
      if (netConfig.allowedTypes?.length) requirements.push(`Type: ${netConfig.allowedTypes.join(', ')}`);
      if (netConfig.allowedNetworks?.length) requirements.push(`Networks: ${netConfig.allowedNetworks.join(', ')}`);
      return {
        allowed: false,
        reason: `Network access restricted — ${requirements.join(' or ')}`,
        requiredNetwork: netConfig.allowedNetworks?.[0] ?? null,
      };
    }

    // Tethered connection — also enforce a minimum signal.
    if (netConfig.connectionMode === CONNECTION_MODES.TETHERED) {
      const signal = this.signalStrength ?? 100;
      const threshold = netConfig.signalThreshold ?? 40;
      if (signal < threshold) {
        return {
          allowed: false,
          reason: `Signal too weak (${signal}% < ${threshold}% required)`,
          signalInfo: { signal, threshold },
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Does this network satisfy an access block's mode? The one rule behind checkAccess
   * and the terminal gate's per-network status, so the two can't disagree.
   * @param {object} netConfig - { accessMode, allowedNetworks[], allowedTypes[] }
   * @param {{ id: string, type?: string }} network
   * @returns {boolean}
   */
  networkPasses(netConfig = {}, network) {
    const byId = (netConfig.allowedNetworks ?? []).includes(network?.id);
    const byType = (netConfig.allowedTypes ?? []).includes(network?.type ?? null);
    switch (netConfig.accessMode ?? NETWORK_ACCESS_MODES.ANY) {
      case NETWORK_ACCESS_MODES.WHITELIST: return byId;
      case NETWORK_ACCESS_MODES.TYPE: return byType;
      case NETWORK_ACCESS_MODES.BOTH: return byId || byType;
      default: return true;
    }
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
    if (network.security.requiresAuth && !this._authOk(networkId) && !force) {
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

    // Broadcast to other clients — GM broadcasts for scene sync, players for access log
    this.socketManager.emit(SOCKET_OPS.NETWORK_STATE_CHANGED, {
      type: 'switch',
      networkId,
      sceneId: game.scenes?.viewed?.id,
      actorId: game.user?.character?.id ?? null,
      actorName: game.user?.character?.name ?? game.user?.name ?? 'Unknown',
      isGMAction: isGM(),
    });

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
  authenticateSkillCheck(networkId, rollTotal, skillName = 'unknown', { silent = false } = {}) {
    const network = this.getNetwork(networkId);
    if (!network) return { success: false, reason: 'unknown_network' };
    if (!network.security.requiresAuth) return { success: true };

    const dc = bypassDCFor(network.security, skillName);

    if (rollTotal >= dc) {
      this._authenticatedNetworks.add(networkId);
      if (!silent) this.soundService?.play('hack-success');
      this.eventBus.emit(EVENTS.NETWORK_AUTH_SUCCESS, { networkId, method: 'skill', skillName, rollTotal, dc });
      log.info(`Authenticated to ${network.name} via ${skillName} (${rollTotal} >= ${dc})`);
      return { success: true };
    }

    if (!silent) this.soundService?.play('hack-fail');
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

    const existing = this.getNetwork(networkId);
    if (!existing) return { success: false, error: 'Network not found' };

    // Core networks: save overrides separately (protect id, isCore)
    if (existing.isCore) {
      const overrides = foundry.utils.deepClone(
        this.settingsManager.get('coreNetworkOverrides') ?? {}
      );
      // Never allow overriding id or isCore
      delete updates.id;
      delete updates.isCore;
      overrides[networkId] = foundry.utils.mergeObject(overrides[networkId] ?? {}, updates, { inplace: false });
      await this.settingsManager.set('coreNetworkOverrides', overrides);

      this._buildNetworkCache();
      this.eventBus.emit(EVENTS.NETWORK_CHANGED, { type: 'updated', networkId });
      log.info(`Core network override saved: ${networkId}`);
      return { success: true };
    }

    // Custom networks: update in place
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
  //  PUBLIC API — Network nodes (dev/design/NETWORK-NODES.md)
  // ═══════════════════════════════════════════════════════════

  /** @private the raw { id: node } map */
  _nodeMap() { try { return this.settingsManager.get('networkNodes') || {}; } catch { return {}; } }

  /** @private game-clock now (nodes keep game time, like every other timer) */
  _nowMs() { return game.nightcity?.timeService?.getCurrentTimeMs?.() ?? Date.now(); }

  /**
   * Every node, sanitized, optionally narrowed to a network and/or a scene.
   * @param {{networkId?: string, sceneId?: string}} [filter]
   * @returns {object[]}
   */
  getNodes(filter = {}) {
    return listNodes(Object.values(this._nodeMap()).map(sanitizeNode), filter);
  }

  /**
   * Networks cut on the viewed scene by their nodes, and why: { [networkId]: { state: 'jammed'|'damaged'|'off', until } }.
   * The network selector shows these as their own rows.
   */
  getSceneBlocks(sceneId = game.scenes?.viewed?.id) {
    return sceneId ? sceneBlocks(this._nodeMap(), sceneId, this._nowMs()) : {};
  }

  /** true while this client has no signal because the scene's nodes cut everything (not a dead-zone scene). */
  get isNodeDead() { return !!this._nodeDead; }

  /** @param {string} nodeId @returns {object|null} */
  getNode(nodeId) {
    const raw = this._nodeMap()[nodeId];
    return raw ? sanitizeNode(raw) : null;
  }

  /** @private write one node (or delete it with null). GM only. */
  async _writeNode(nodeId, node) {
    const map = foundry.utils.deepClone(this._nodeMap());
    const before = map[nodeId];
    if (node) map[nodeId] = node; else delete map[nodeId];
    await this.settingsManager.set('networkNodes', map);
    if (node) this._logNodeActivity(node, before);
  }

  /**
   * @private Every line a write adds to a node's own log also goes to Admin → Networks → Activity log (type 'node'),
   * stamped with the node's network and scene, so the GM sees who used which node where.
   */
  _logNodeActivity(node, before) {
    const svc = game.nightcity?.accessLogService;
    if (!svc?._push || !isGM()) return;
    const seen = new Set((before?.log || []).map((e) => `${e.ts}|${e.who}|${e.what}`));
    const fresh = (node.log || []).filter((e) => !seen.has(`${e.ts}|${e.who}|${e.what}`));
    if (!fresh.length || fresh.length > 5) return;
    const net = this.getNetwork?.(node.networkId);
    for (const e of fresh) {
      svc._push({ type: 'node', networkId: node.networkId, networkName: net?.name, actorName: e.who || 'Someone', sceneId: node.sceneId || '',
        message: `${node.name}: ${e.what}`, extra: { nodeId: node.id } });
    }
  }

  /**
   * Create or update a node. GM only. Unknown fields are dropped by sanitizeNode.
   * @param {object} data
   * @returns {Promise<{success: boolean, node?: object, error?: string}>}
   */
  async saveNode(data = {}) {
    if (!isGM()) return { success: false, error: 'GM only' };
    const prev = data.id ? this.getNode(data.id) : null;
    const node = sanitizeNode({ ...(prev || {}), ...data, id: data.id || `node_${generateId()}`, createdAt: prev?.createdAt || this._nowMs() });
    if (!node.networkId || !this.getNetwork(node.networkId)) return { success: false, error: 'Network not found' };
    await this._writeNode(node.id, node);
    log.info(`Network node ${prev ? 'updated' : 'created'}: ${node.name} (${node.id})`);
    return { success: true, node };
  }

  /** Delete a node. GM only. */
  async deleteNode(nodeId) {
    if (!isGM()) return { success: false, error: 'GM only' };
    if (!this._nodeMap()[nodeId]) return { success: false, error: 'Node not found' };
    await this._writeNode(nodeId, null);
    return { success: true };
  }

  /**
   * Switch a node on / off, jam it for a while, or mark it damaged. GM writes; a player relays.
   * @param {string} nodeId
   * @param {'on'|'off'|'jammed'|'damaged'} state
   * @param {{minutes?: number, who?: string}} [opts]
   */
  async setNodeState(nodeId, state, { minutes = 0, who = '' } = {}) {
    if (!NODE_STATES[state]) return { success: false, error: 'Unknown state' };
    if (!isGM()) {
      if (!game.users?.activeGM) return { success: false, error: 'No GM is connected to make the change.' };
      this.socketManager.emit(SOCKET_OPS.NETWORK_NODE_REQUEST, { op: 'state', nodeId, state, minutes, who: who || game.user.character?.name || game.user.name, userId: game.user.id });
      return { success: true, relayed: true };
    }
    const node = this.getNode(nodeId);
    if (!node) return { success: false, error: 'Node not found' };
    const now = this._nowMs();
    const patch = statePatch(state, { now, minutes });
    const what = state === 'jammed' ? 'jammed for ' + Math.round((patch.jammedUntil - now) / 60000) + ' min'
      : state === 'damaged' ? 'damaged' : 'switched ' + state;
    await this._writeNode(nodeId, { ...node, ...patch, log: appendLog(node.log, { ts: now, who: who || 'GM', what }) });
    return { success: true };
  }

  /** GM side of the player relay. @param {object} data */
  async handleNodeRequest(data = {}) {
    if (!isGM()) return;
    if (data.op === 'state') return this.setNodeState(data.nodeId, data.state, { minutes: data.minutes, who: data.who });
    if (data.op === 'log') return this.nodeLog(data.nodeId, data.who, data.what);
    if (data.op === 'alert') return this.bumpNodeAlert(data.nodeId, data.delta);
    if (data.op === 'wipe') return this.wipeNodeLog(data.nodeId, data.who);
    if (data.op === 'effect') return this.addNodeEffect(data.nodeId, data.kind, data.effect);
    if (data.op === 'unEffect') return this.removeNodeEffect(data.nodeId, data.kind, data.effectId, data.who);
    if (data.op === 'run') return this.saveRun(data.nodeId, data.run);
    if (data.op === 'unRun') return this.clearRun(data.nodeId, data.actorId);
    if (data.op === 'infect') return this.insertProgram(data.nodeId, data.kind, data.program);
    if (data.op === 'clean') return this.cleanInfection(data.nodeId, data.infectionId, data.who);
    if (data.op === 'recall') return this.recallFamily(data.family, data.actorId);
    if (data.op === 'collect') return this.collectSniffer(data.nodeId, data.infectionId, data.actorId);
  }

  // ─── Infections (step 5): a program inserted from a shard lives on the node ───

  /**
   * Install a network program on a node. Patch cleans the node instead of installing.
   * @param {string} nodeId @param {'worm'|'tap'|'bomb'|'sniffer'|'patch'} kind
   * @param {{name, actorId, actorName, quality, stealthDV, params}} program
   */
  async insertProgram(nodeId, kind, program = {}) {
    if (!NODE_PROGRAMS[kind]) return { success: false, error: 'Unknown program' };
    const relayed = this._nodeRelay('infect', { nodeId, kind, program }); if (relayed) return relayed;
    const node = this.getNode(nodeId); if (!node) return { success: false, error: 'Node not found' };
    const now = this._nowMs();
    if (kind === 'patch') {
      const n = node.infections.length;
      this._questCleaned(node, node.infections, program.actorName || '');
      await this._writeNode(nodeId, { ...node, infections: [], log: appendLog(node.log, { ts: now, who: program.actorName || '', what: n ? `patched — ${n} infection${n === 1 ? '' : 's'} cleaned` : 'patched' }) });
      return { success: true, cleaned: n };
    }
    const id = `inf_${generateId()}`;
    const add = [makeInfection(kind, { ...program, id, now })];
    const carry = kind === 'worm' ? add[0].carry : '';
    if (carry) add.push(makeInfection(carry, { ...program, id: `inf_${generateId()}`, family: id, now, name: `${program.name || 'Worm'} → ${NODE_PROGRAMS[carry].label}` }));
    await this._writeNode(nodeId, { ...node, infections: [...node.infections, ...add].slice(-30) });
    return { success: true, infection: add[0] };
  }

  /** Clean one infection off ONE node (a sweep that found it, the GM). Its family elsewhere is untouched. */
  async cleanInfection(nodeId, infectionId, who = '') {
    const relayed = this._nodeRelay('clean', { nodeId, infectionId, who }); if (relayed) return relayed;
    const node = this.getNode(nodeId); if (!node) return { success: false, error: 'Node not found' };
    const gone = node.infections.find((x) => x.id === infectionId);
    if (!gone) return { success: false, error: 'Already gone' };
    // cleaning a worm takes what it carried on this node with it
    const keep = node.infections.filter((x) => x.id !== infectionId && !(gone.kind === 'worm' && x.family === gone.family));
    this._questCleaned(node, node.infections.filter((x) => !keep.includes(x)), who);
    await this._writeNode(nodeId, { ...node, infections: keep, log: appendLog(node.log, { ts: this._nowMs(), who, what: `cleaned a ${NODE_PROGRAMS[gone.kind].label.toLowerCase()}` }) });
    return { success: true };
  }

  /** The planter pulls their program back — every node of the family. */
  async recallFamily(family, actorId) {
    const relayed = this._nodeRelay('recall', { family, actorId }); if (relayed) return relayed;
    const map = foundry.utils.deepClone(this._nodeMap());
    let n = 0;
    for (const [id, raw] of Object.entries(map)) {
      const node = sanitizeNode(raw);
      const keep = node.infections.filter((x) => !(x.family === family && (!actorId || x.actorId === actorId)));
      if (keep.length !== node.infections.length) { n++; map[id] = { ...node, infections: keep }; }
    }
    if (n) await this.settingsManager.set('networkNodes', map);
    return { success: true, nodes: n };
  }

  /** A sniffer's catch goes to the planter's EXFIL folder and the sniffer starts over. */
  async collectSniffer(nodeId, infectionId, actorId) {
    const relayed = this._nodeRelay('collect', { nodeId, infectionId, actorId }); if (relayed) return relayed;
    const node = this.getNode(nodeId); if (!node) return { success: false, error: 'Node not found' };
    const inf = node.infections.find((x) => x.id === infectionId && x.kind === 'sniffer');
    if (!inf || (actorId && inf.actorId !== actorId)) return { success: false, error: 'Not yours to collect' };
    const repo = game.nightcity?.messageRepository;
    let made = 0;
    for (const m of inf.loot) {
      const res = await repo?.createMessage?.(inf.actorId, { ...m, messageId: generateId(), threadId: undefined, eddies: 0, status: { read: false },
        metadata: { ...(m.metadata || {}), recovered: true, recoveredFrom: `SNIFFER · ${node.name}`, recoveredTo: m.to || '', recoveredAt: new Date(this._nowMs()).toISOString(), recoveredOrigTs: m.timestamp } });
      if (res?.success) made++;
    }
    await this._writeNode(nodeId, { ...node, infections: node.infections.map((x) => (x.id === infectionId ? { ...x, loot: [] } : x)) });
    return { success: true, collected: made };
  }

  /**
   * GM tick (rides the 30 s jam reaper): worms whose time came spread to another node of the network (its carried
   * program with it), up to their limit; blackout bombs whose time came switch off every node their family reached.
   * @returns {Promise<{spread:number, fired:number}>}
   */
  async tickInfections() {
    if (!isGM() || (game.users?.activeGM && game.users.activeGM.id !== game.user.id)) return { spread: 0, fired: 0 };
    const now = this._nowMs();
    let map = foundry.utils.deepClone(this._nodeMap());
    const all = () => Object.values(map).map(sanitizeNode);
    let spread = 0, fired = 0, dirty = false;
    // worms
    for (const node of all()) {
      for (const inf of node.infections.filter((x) => x.kind === 'worm' && x.nextAt && now >= x.nextAt)) {
        const cur = sanitizeNode(map[node.id]);
        const target = wormTarget(all(), cur, inf);
        cur.infections = cur.infections.map((x) => (x.id === inf.id ? { ...x, nextAt: target ? x.nextAt + x.every * 3600000 : 0 } : x));
        map[node.id] = cur;
        dirty = true;
        if (!target) continue;
        const t = sanitizeNode(map[target.id]);
        const copies = cur.infections.filter((x) => x.family === inf.family && (x.id === inf.id || x.kind !== 'worm'))
          .map((x) => ({ ...x, id: `inf_${generateId()}`, at: now, nextAt: x.kind === 'worm' ? now + x.every * 3600000 : 0, loot: [] }));
        t.infections = [...t.infections, ...copies].slice(-30);
        map[target.id] = t;
        spread++;
      }
    }
    // bombs
    const due = all().flatMap((n) => n.infections.filter((x) => x.kind === 'bomb' && x.fireAt && now >= x.fireAt));
    for (const fam of new Set(due.map((x) => x.family))) {
      for (const n of familyNodes(all(), fam)) {
        const cur = sanitizeNode(map[n.id]);
        map[n.id] = { ...cur, state: 'off', jammedUntil: 0, infections: cur.infections.filter((x) => !(x.family === fam && x.kind === 'bomb')),
          log: appendLog(cur.log, { ts: now, who: '', what: 'BLACKOUT — switched off' }) };
        fired++;
      }
      dirty = true;
    }
    if (dirty) await this.settingsManager.set('networkNodes', map);
    return { spread, fired };
  }

  /**
   * Leave a tap or a backdoor on a node (a session action). One per runner per node — a second replaces the first.
   * @param {string} nodeId @param {'taps'|'backdoors'} kind
   * @param {{actorId:string, actorName:string, minutes?:number}} effect
   */
  async addNodeEffect(nodeId, kind, effect = {}) {
    if (!NODE_EFFECTS[kind] || !effect.actorId) return { success: false, error: 'Bad effect' };
    const relayed = this._nodeRelay('effect', { nodeId, kind, effect }); if (relayed) return relayed;
    const node = this.getNode(nodeId); if (!node) return { success: false, error: 'Node not found' };
    const now = this._nowMs();
    const e = { id: `fx_${generateId()}`, actorId: effect.actorId, actorName: effect.actorName || '', at: now, until: Number(effect.minutes) > 0 ? now + Number(effect.minutes) * 60000 : 0 };
    await this._writeNode(nodeId, { ...node, [kind]: withEffect(node[kind], e) });
    return { success: true, effect: e };
  }

  /**
   * Save a runner's session on a node (moves spent, still jacked in). A record keeps its `since` / `until`; a new one
   * starts the window now. `minutes` 0 = sessions are not saved (every jack-in starts fresh).
   * @param {string} nodeId @param {{actorId, actorName, rank, moves, used, open, minutes?}} run
   */
  async saveRun(nodeId, run = {}) {
    if (!run.actorId) return { success: false, error: 'No runner' };
    const relayed = this._nodeRelay('run', { nodeId, run }); if (relayed) return relayed;
    const node = this.getNode(nodeId); if (!node) return { success: false, error: 'Node not found' };
    const now = this._nowMs();
    const was = liveRun(node, run.actorId, now);
    const minutes = Number(run.minutes) || 0;
    if (!was && minutes <= 0) return { success: true, skipped: true };
    const rec = { actorId: run.actorId, actorName: run.actorName || was?.actorName || '', rank: run.rank ?? was?.rank ?? 0,
      moves: run.moves ?? was?.moves ?? 0, used: run.used ?? was?.used ?? 0, open: !!run.open, kicks: was?.kicks || 0,
      since: was?.since || now, until: was?.until || now + minutes * 60000 };
    await this._writeNode(nodeId, { ...node, runs: withRun(node.runs, rec) });
    return { success: true, run: rec };
  }

  /**
   * GM: throw a runner out of a node. Their console drops the session on its next look (`kicks` goes up); the moves
   * they spent stay spent. Damage and a lockout are the caller's (the inspector's kick dialog).
   */
  async kickRun(nodeId, actorId, who = 'GM') {
    if (!isGM()) return { success: false, error: 'GM only' };
    const node = this.getNode(nodeId); if (!node) return { success: false, error: 'Node not found' };
    const run = (node.runs || []).find((r) => r.actorId === actorId);
    if (!run) return { success: false, error: 'They are not in this node' };
    await this._writeNode(nodeId, { ...node, runs: withRun(node.runs, { ...run, open: false, kicks: (run.kicks || 0) + 1 }),
      log: appendLog(node.log, { ts: this._nowMs(), who: who || 'GM', what: `kicked ${run.actorName || 'a runner'} out` }) });
    return { success: true };
  }

  /** GM: change how many moves a runner has spent (give one back, take one). */
  async setRunUsed(nodeId, actorId, used) {
    if (!isGM()) return { success: false, error: 'GM only' };
    const node = this.getNode(nodeId); if (!node) return { success: false, error: 'Node not found' };
    const run = (node.runs || []).find((r) => r.actorId === actorId);
    if (!run) return { success: false, error: 'No session' };
    await this._writeNode(nodeId, { ...node, runs: withRun(node.runs, { ...run, used: Math.max(0, Math.min(run.moves, Math.round(Number(used) || 0))) }) });
    return { success: true };
  }

  /** GM: edit an infection in place (name, who planted it, the DV a sweep needs, quest, note). */
  async updateInfection(nodeId, infectionId, patch = {}) {
    if (!isGM()) return { success: false, error: 'GM only' };
    const node = this.getNode(nodeId); if (!node) return { success: false, error: 'Node not found' };
    if (!node.infections.some((x) => x.id === infectionId)) return { success: false, error: 'Already gone' };
    const ok = ['name', 'actorName', 'stealthDV', 'quest', 'note'];
    const p = Object.fromEntries(Object.entries(patch).filter(([k]) => ok.includes(k)));
    await this._writeNode(nodeId, { ...node, infections: node.infections.map((x) => (x.id === infectionId ? { ...x, ...p } : x)) });
    return { success: true };
  }

  /** @private A quest infection came off a node — whisper every GM. */
  _questCleaned(node, infs, who) {
    const quests = infs.filter((x) => x.quest);
    if (!quests.length || typeof ChatMessage === 'undefined') return;
    const gms = (game.users?.filter?.((u) => u.isGM) || []).map((u) => u.id);
    const html = whisperCardHtml({ tone: 'ok', icon: 'fa-flag-checkered', title: 'Quest — infection cleaned',
      lines: quests.map((q) => `<b>${q.name}</b> is off <b>${node.name}</b>${who ? ` — cleaned by ${who}` : ''}.${q.note ? ` <i>${q.note}</i>` : ''}`) });
    ChatMessage.create({ content: html, whisper: gms, speaker: { alias: 'Night City Messenger' } }).catch(() => {});
  }

  /** End a runner's saved session (the GM's reset) — their next jack-in starts fresh. */
  async clearRun(nodeId, actorId) {
    const relayed = this._nodeRelay('unRun', { nodeId, actorId }); if (relayed) return relayed;
    const node = this.getNode(nodeId); if (!node) return { success: false, error: 'Node not found' };
    if (!(node.runs || []).some((r) => r.actorId === actorId)) return { success: false, error: 'No session' };
    await this._writeNode(nodeId, { ...node, runs: node.runs.filter((r) => r.actorId !== actorId) });
    return { success: true };
  }

  /** Remove a tap / backdoor (a System sweep that found it, or the GM). */
  async removeNodeEffect(nodeId, kind, effectId, who = '') {
    if (!NODE_EFFECTS[kind]) return { success: false, error: 'Bad effect' };
    const relayed = this._nodeRelay('unEffect', { nodeId, kind, effectId, who }); if (relayed) return relayed;
    const node = this.getNode(nodeId); if (!node) return { success: false, error: 'Node not found' };
    const gone = (node[kind] || []).find((e) => e.id === effectId);
    if (!gone) return { success: false, error: 'Already gone' };
    await this._writeNode(nodeId, { ...node, [kind]: node[kind].filter((e) => e.id !== effectId),
      log: appendLog(node.log, { ts: this._nowMs(), who, what: `removed a ${NODE_EFFECTS[kind].label.toLowerCase()}` }) });
    return { success: true };
  }

  /**
   * A TAP: after a delivery (GM client — MessageService._deliverMessage), every runner with a live tap on an UP node of
   * the network the mail went over, standing on the scene the SENDER was on (`sentFromScene`), gets a copy in their
   * inbox's EXFIL folder — a node hears what passes through it, not the whole city. Mail with no scene is never heard. Never the sender or the recipient
   * themselves; a fan-out is copied once; money never travels on a copy.
   * @param {object} data — the recipient-facing message (anonymous mail is already masked)
   */
  async tapDelivery(data) {
    if (!isGM() || !data?.network || !data.sentFromScene) return 0;
    const now = this._nowMs();
    const nodes = this.getNodes({ networkId: data.network }).filter((n) => nodeIsUp(n, now) && n.sceneId === data.sentFromScene);
    const tappers = new Map();
    for (const n of nodes) for (const e of activeEffects(n, 'taps', now)) if (!tappers.has(e.actorId)) tappers.set(e.actorId, { node: n, sloppy: false });
    for (const n of nodes) for (const x of n.infections.filter((i) => i.kind === 'tap')) {
      const was = tappers.get(x.actorId);
      if (!was || (was.sloppy && !x.sloppy)) tappers.set(x.actorId, { node: n, sloppy: x.sloppy });
    }
    // sniffers record (cap) — collected later from a session
    const sniffers = nodes.flatMap((n) => n.infections.filter((i) => i.kind === 'sniffer').map((i) => ({ n, i })));
    if (sniffers.length) {
      const k0 = [data.subject, data.from, data.timestamp].join('|');
      this._sniffSeen ??= new Set();
      const fresh = sniffers.filter(({ i }) => !this._sniffSeen.has(`${i.id}|${k0}`) && i.actorId !== data.fromActorId && i.actorId !== data.toActorId);
      if (fresh.length) {
        const map = foundry.utils.deepClone(this._nodeMap());
        for (const { n, i } of fresh) {
          this._sniffSeen.add(`${i.id}|${k0}`);
          const cur = sanitizeNode(map[n.id]);
          const m = { subject: data.subject, from: data.from, to: data.to, body: data.body, timestamp: data.timestamp, network: data.network, fromActorId: data.fromActorId, fromContactId: data.fromContactId };
          cur.infections = cur.infections.map((x) => (x.id === i.id ? { ...x, loot: [...x.loot, m].slice(-x.cap) } : x));
          map[n.id] = cur;
        }
        if (this._sniffSeen.size > 600) this._sniffSeen = new Set([...this._sniffSeen].slice(-300));
        await this.settingsManager.set('networkNodes', map);
      }
    }
    if (!tappers.size) return 0;
    const key = [data.subject, data.from, data.timestamp].join('|');
    this._tapSeen ??= new Map();
    let made = 0;
    for (const [actorId, { node, sloppy }] of tappers) {
      if (actorId === data.fromActorId || actorId === data.toActorId) continue;
      const k = `${actorId}|${key}`;
      if (this._tapSeen.has(k)) continue;
      this._tapSeen.set(k, now);
      if (this._tapSeen.size > 300) this._tapSeen.delete(this._tapSeen.keys().next().value);
      const repo = game.nightcity?.messageRepository;
      if (!repo || !game.actors?.get(actorId)) continue;
      const cd = data.contentType === 'eddies' ? { ...(data.contentData || {}), claimed: true } : data.contentData;
      const res = await repo.createMessage(actorId, {
        ...data, messageId: generateId(), threadId: undefined, eddies: 0, contentData: cd, status: { read: false },
        ...(sloppy ? { body: '<p><em>[garbled — a sloppy tap caught the subject line only]</em></p>', contentType: undefined, contentData: undefined } : {}),
        metadata: { ...(data.metadata || {}), recovered: true, recoveredFrom: `TAP · ${node.name}`, recoveredTo: data.to || '', recoveredAt: new Date(now).toISOString(), recoveredOrigTs: data.timestamp },
      });
      if (res?.success) made++;
    }
    return made;
  }

  /** @private GM writes, a player relays; no GM online → false. */
  _nodeRelay(op, payload) {
    if (isGM()) return null;
    if (!game.users?.activeGM) return { success: false, error: 'No GM is connected to make the change.' };
    this.socketManager.emit(SOCKET_OPS.NETWORK_NODE_REQUEST, { op, ...payload, userId: game.user.id });
    return { success: true, relayed: true };
  }

  /** Add a line to a node's log ("Rache jacked in"). */
  async nodeLog(nodeId, who, what) {
    const relayed = this._nodeRelay('log', { nodeId, who, what }); if (relayed) return relayed;
    const node = this.getNode(nodeId); if (!node) return { success: false, error: 'Node not found' };
    await this._writeNode(nodeId, { ...node, log: appendLog(node.log, { ts: this._nowMs(), who, what }) });
    return { success: true };
  }

  /** Raise (or lower) a node's alert level, clamped. */
  async bumpNodeAlert(nodeId, delta = 1) {
    const relayed = this._nodeRelay('alert', { nodeId, delta }); if (relayed) return relayed;
    const node = this.getNode(nodeId); if (!node) return { success: false, error: 'Node not found' };
    const alert = Math.max(0, Math.min(3, (node.alert || 0) + (Number(delta) || 0)));
    await this._writeNode(nodeId, { ...node, alert, alertAt: this._nowMs() });
    return { success: true, alert };
  }

  /** Mark every log line by `who` as wiped (a runner taking their name off the node). */
  async wipeNodeLog(nodeId, who) {
    const relayed = this._nodeRelay('wipe', { nodeId, who }); if (relayed) return relayed;
    const node = this.getNode(nodeId); if (!node) return { success: false, error: 'Node not found' };
    const key = String(who || '').toLowerCase();
    let n = 0;
    const log = node.log.map((e) => { if (!e.wiped && String(e.who || '').toLowerCase() === key) { n++; return { ...e, wiped: true }; } return e; });
    await this._writeNode(nodeId, { ...node, log });
    return { success: true, wiped: n };
  }

  /** GM: turn jams whose time has run out back on. Called on a timer. */
  async reapNodeJams() {
    if (!isGM() || (game.users?.activeGM && game.users.activeGM.id !== game.user.id)) return;
    const now = this._nowMs();
    const all = Object.values(this._nodeMap()).map(sanitizeNode);
    const done = expiredJams(all, now);
    const fx = all.map((n) => [n, expiredEffects(n, now)]).filter(([, e]) => Object.keys(e).length);
    const runs = all.filter((n) => expiredRuns(n, now).length);
    if (!done.length && !fx.length && !runs.length) return;
    const map = foundry.utils.deepClone(this._nodeMap());
    for (const n of done) map[n.id] = { ...sanitizeNode(map[n.id]), state: 'on', jammedUntil: 0, log: appendLog(n.log, { ts: now, who: '', what: 'jam ended — back on' }) };
    for (const [n, e] of fx) {
      const cur = sanitizeNode(map[n.id]);
      for (const [k, gone] of Object.entries(e)) { const ids = new Set(gone.map((x) => x.id)); cur[k] = cur[k].filter((x) => !ids.has(x.id)); }
      map[n.id] = cur;
    }
    for (const n of runs) { const cur = sanitizeNode(map[n.id]); cur.runs = cur.runs.filter((r) => now < r.until); map[n.id] = cur; }
    await this.settingsManager.set('networkNodes', map);
  }

  /**
   * Re-apply the scene rule to THIS client's connection: when the scene's nodes cut the network we are on, move to
   * another network that still reaches (or to no signal at all, through the dead-zone path so queued mail waits);
   * when it comes back, return to it.
   * @private
   */
  _reevaluateNodes() {
    // The GM's connection follows the scene too (dev, 2026-10-29: "I jammed it and I'm still on it"); the GM still
    // sends from anywhere through the composer's VIA override, and the signature below keeps this from repeating.
    const scene = game.scenes?.viewed;
    if (!scene) return;
    const sceneDead = scene.getFlag(MODULE_ID, 'deadZone') ?? false;
    const cut = cutNetworks(this._nodeMap(), scene.id, this._nowMs());
    // Act only when something that matters changed — the world-time hook fires every second on a ticking clock.
    const carried = carriedNetworks(this._nodeMap(), scene.id, this._nowMs());
    const sig = [scene.id, [...cut].sort().join(','), [...carried].sort().join(','), this._currentNetworkId, this._nodeDead, this._isDeadZone].join('|');
    if (sig === this._nodeSig) return;
    this._nodeSig = sig;

    if (this._nodeDead) {
      if (sceneDead) { this._nodeDead = false; return; }               // the scene's own dead zone owns it now
      this._isDeadZone = false;                                        // ask what reaches with the node block lifted
      const reach = this.getAvailableNetworks();
      this._isDeadZone = true;
      if (reach.length) {
        this._nodeDead = false;
        this._preDeadZoneNetworkId = this._preNodeCutNetworkId || this._preDeadZoneNetworkId;
        this._setDeadZone(false);
        this._preNodeCutNetworkId = null;
      }
      return;
    }
    if (this._isDeadZone) return;

    const available = this.getAvailableNetworks();
    const cur = this._currentNetworkId;
    if (cur && cut.has(cur)) {
      const net = this.getNetwork(cur);
      ui.notifications?.warn((net?.name || 'Network') + ' signal lost — its node here is down.');
      this._preNodeCutNetworkId = cur;
      if (available.length) {
        this.soundService?.play('dead-zone');
        this.switchNetwork(available[0].id, { force: true, silent: true });
      } else {
        this._nodeDead = true;
        this._setDeadZone(true);
      }
      return;
    }
    // back: the network a node cut moved us off reaches again
    const back = this._preNodeCutNetworkId;
    if (back && back !== cur && available.some((n) => n.id === back)) {
      this._preNodeCutNetworkId = null;
      ui.notifications?.info((this.getNetwork(back)?.name || 'Network') + ' is back.');
      this.switchNetwork(back, { force: true, silent: true });
    }
  }

  /** @private node-driven updates on every client + the GM's jam reaper */
  _registerNodeHooks() {
    Hooks.on('updateSetting', (setting) => {
      if (setting?.key !== MODULE_ID + '.networkNodes') return;
      this._reevaluateNodes();
      this.eventBus.emit(EVENTS.NETWORK_CHANGED, { type: 'nodes', source: 'nodes' });
    });
    // a jam runs out on the game clock — readers see it at once, the reaper tidies the record
    Hooks.on('updateWorldTime', () => { if (Object.values(this._nodeMap()).some((n) => n?.state === 'jammed')) this._reevaluateNodes(); });
    if (isGM()) this._nodeReaper = setInterval(() => {
      this.reapNodeJams().then(() => this.tickInfections()).catch((e) => log.warn('Node reaper failed', e));
    }, 30000);
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
   * Apply a compendium scene's pre-wiring (Admin → Networks → Scenes → In compendiums) to the world copy that was just
   * imported from it. The record is keyed by the pack uuid Foundry stamps on the copy. GM only; never throws.
   * @param {Scene} scene
   * @returns {Promise<boolean>} true when something was applied
   */
  async applyScenePrewire(scene) {
    if (!isGM() || !scene) return false;
    try {
      const src = sourceUuidOf(scene);
      if (!src) return false;
      const map = game.settings.get(MODULE_ID, 'scenePrewire') || {};
      const flags = prewireFlags(map[src]);
      if (!flags) return false;
      await scene.update({ [`flags.${MODULE_ID}`]: flags });
      log.info(`Scene pre-wiring applied to ${scene.name} (from ${src})`);
      return true;
    } catch (e) { log.warn('NetworkService.applyScenePrewire failed', e); return false; }
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

    // Load GM overrides for core networks
    let coreOverrides = {};
    try {
      coreOverrides = this.settingsManager.get('coreNetworkOverrides') ?? {};
    } catch { /* Settings might not be ready yet */ }

    // Core networks from constants, merged with any GM overrides
    for (const net of DEFAULTS.CORE_NETWORKS) {
      const override = coreOverrides[net.id];
      if (override) {
        this._networkCache.set(net.id, foundry.utils.mergeObject({ ...net }, override, { inplace: false }));
      } else {
        this._networkCache.set(net.id, { ...net });
      }
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
        allowPassword: data.security?.allowPassword ?? !!(data.security?.password),
        allowSkillCheck: data.security?.allowSkillCheck ?? (data.security?.bypassSkills?.length > 0),
        authLogic: data.security?.authLogic ?? 'any',  // 'any' = OR, 'all' = AND (key item always bypasses)
        bypassSkills: data.security?.bypassSkills ?? [],
        bypassDC: data.security?.bypassDC ?? 15,
        bypassSkillDCs: data.security?.bypassSkillDCs ?? {},
        allowKeyItem: data.security?.allowKeyItem ?? false,
        keyItemName: data.security?.keyItemName ?? '',
        keyItemTag: data.security?.keyItemTag ?? '',
        keyItemImg: data.security?.keyItemImg ?? '',
        keyItemConsume: data.security?.keyItemConsume ?? false,
        maxAttempts: data.security?.maxAttempts ?? 3,
        lockoutDuration: data.security?.lockoutDuration ?? 3600000,
        // Countermeasure visibility override (utils/countermeasures.js) — absent = inherit.
        ...(data.security?.countermeasures ? { countermeasures: data.security.countermeasures } : {}),
        // ICE configuration (mirrors shard config pattern)
        encryptionType: data.security?.encryptionType ?? 'ICE',
        failureMode: data.security?.failureMode ?? 'lockout',
        ice: {
          source: data.security?.ice?.source ?? 'default',
          actorId: data.security?.ice?.actorId ?? null,
          customName: data.security?.ice?.customName ?? '',
          customPortrait: data.security?.ice?.customPortrait ?? '',
          customDamage: data.security?.ice?.customDamage ?? '',
        },
      },
      effects: {
        messageDelay: data.effects?.messageDelay ?? 0,
        traced: data.effects?.traced ?? false,
        anonymity: data.effects?.anonymity ?? false,
        canRoute: data.effects?.canRoute ?? true,
        restrictedAccess: data.effects?.restrictedAccess ?? false,
        allowedRecipientNetworks: data.effects?.allowedRecipientNetworks ?? [],
      },
      theme: {
        color: data.theme?.color ?? '#19f3f7',
        icon: data.theme?.icon ?? 'fa-wifi',
        iconMode: data.theme?.iconMode ?? 'fa',
        customImage: data.theme?.customImage ?? '',
        glitchIntensity: data.theme?.glitchIntensity ?? 0.1,
      },
      description: data.description ?? '',
      lore: data.lore ?? '',
      group: data.group ?? '',
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
        if (!net.security.requiresAuth || this._authOk(defaultNet) || isGM()) {
          this.switchNetwork(defaultNet, { silent: false });
        } else {
          // Fall back to CitiNet
          this.switchNetwork(NETWORKS.CITINET, { silent: false });
        }
      }
    }

    // Rebuild available networks for this scene
    this._buildNetworkCache();

    // A new scene, a new set of nodes: a node-made dead zone does not follow us here.
    if (!isDead) this._nodeDead = false;   // the scene-flag check above already restored the signal
    this._reevaluateNodes();

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

// ─── One queue for every node write (2026-10-29, dev: "my moves got reset — 3 of 3 after jacking back in") ───
// Every node write reads the node map, changes it and writes the whole map back. Two writes that overlap (a session
// action saving the spent move AND writing its log line; two relayed player requests the GM handles at once) both
// start from the same map, and the later one silently undoes the earlier. These methods now run one at a time.
// None of them calls another (a nested call would wait on itself) — keep it that way.
const NODE_WRITERS = ['setNodeState', 'nodeLog', 'bumpNodeAlert', 'wipeNodeLog', 'addNodeEffect', 'removeNodeEffect', 'saveRun', 'clearRun',
  'kickRun', 'setRunUsed', 'updateInfection', 'insertProgram', 'cleanInfection', 'recallFamily', 'collectSniffer', 'saveNode', 'deleteNode',
  'reapNodeJams', 'tickInfections', 'tapDelivery'];
for (const name of NODE_WRITERS) {
  const orig = NetworkService.prototype[name];
  if (typeof orig !== 'function') continue;
  NetworkService.prototype[name] = function nodeQueued(...args) {
    const run = () => orig.apply(this, args);
    const p = (this._nodeQueue || Promise.resolve()).then(run, run);
    this._nodeQueue = p.catch(() => {});
    return p;
  };
}
