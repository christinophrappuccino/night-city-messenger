/**
 * Register Network System
 * @file scripts/init/registerNetworkSystem.js
 * @module cyberpunkred-messenger
 * @description Phase 3 — Network system initialization.
 *              Registers NetworkService, SecurityService, NetworkAccessLogService,
 *              socket handlers for network state, and wires UI launch functions.
 *
 *              Priorities follow the master spec:
 *                ready/30  → NetworkService
 *                ready/40  → SecurityService
 *                ready/90  → NetworkAccessLogService
 *                ready/110 → UI launch function override (openNetworkManagement)
 */

import { MODULE_ID, EVENTS, SOCKET_OPS } from '../utils/constants.js';
import { log, isGM } from '../utils/helpers.js';

// Services
import { NetworkService } from '../services/NetworkService.js';
import { SecurityService } from '../services/SecurityService.js';
import { NetworkAccessLogService } from '../services/NetworkAccessLogService.js';

// UI Applications
import { NetworkManagementApp } from '../ui/NetworkManagement/NetworkManagementApp.js';
import { NetworkAuthDialog } from '../ui/NetworkManagement/NetworkAuthDialog.js';
import { DeadZoneWarningApp } from '../ui/NetworkManagement/DeadZoneWarningApp.js';

// Verification
import { Phase3Verification } from '../tests/Phase3Verification.js';

/**
 * Track open management app instance for singleton behavior
 * @type {NetworkManagementApp|null}
 */
let _managementApp = null;

export function registerNetworkSystem(initializer) {

  // ═══════════════════════════════════════════════════════════
  //  READY PHASE — Priority 30: NetworkService
  // ═══════════════════════════════════════════════════════════

  initializer.register('ready', 30, 'NetworkService', () => {
    const networkService = new NetworkService();
    game.nightcity.networkService = networkService;
    log.info('NetworkService initialized');
  });

  // ═══════════════════════════════════════════════════════════
  //  READY PHASE — Priority 40: SecurityService
  // ═══════════════════════════════════════════════════════════

  initializer.register('ready', 40, 'SecurityService', () => {
    const securityService = new SecurityService();
    game.nightcity.securityService = securityService;
    log.info('SecurityService initialized');
  });

  // ═══════════════════════════════════════════════════════════
  //  READY PHASE — Priority 90: NetworkAccessLogService
  // ═══════════════════════════════════════════════════════════

  initializer.register('ready', 90, 'NetworkAccessLogService', () => {
    const accessLogService = new NetworkAccessLogService();
    game.nightcity.accessLogService = accessLogService;
    log.info('NetworkAccessLogService initialized');
  });

  // ═══════════════════════════════════════════════════════════
  //  READY PHASE — Priority 95: Network Socket Handlers
  // ═══════════════════════════════════════════════════════════

  initializer.register('ready', 95, 'Network socket handlers', () => {
    const socketManager = game.nightcity.socketManager;
    const networkService = game.nightcity.networkService;
    const eventBus = game.nightcity.eventBus;

    if (!socketManager || !networkService) {
      log.warn('Network socket handlers: missing dependencies');
      return;
    }

    // ─── Network State Changed (GM → All Clients) ─────────
    socketManager.register(SOCKET_OPS.NETWORK_STATE_CHANGED, (data, sender) => {
      const { type, networkId, sceneId, isDead } = data;

      switch (type) {
        case 'switch':
          // GM changed the active network — all clients should be notified
          log.debug(`Socket: network state changed — switch to ${networkId}`);
          eventBus.emit(EVENTS.NETWORK_CHANGED, {
            currentNetworkId: networkId,
            sceneId,
            source: 'socket',
          });
          break;

        case 'deadZone':
          // Dead zone toggled for a scene
          log.debug(`Socket: dead zone ${isDead ? 'on' : 'off'} for scene ${sceneId}`);
          // If this is our viewed scene, the canvasReady hook will handle it
          // But emit an event so UI can update immediately
          if (sceneId === game.scenes?.viewed?.id) {
            if (isDead) {
              eventBus.emit(EVENTS.NETWORK_DISCONNECTED, { reason: 'dead_zone', source: 'socket' });
            } else {
              eventBus.emit(EVENTS.NETWORK_CONNECTED, {
                networkId: networkService.currentNetworkId,
                source: 'socket',
              });
            }
          }
          break;

        default:
          log.debug(`Socket: unknown network state type: ${type}`);
      }
    });

    log.info('Network socket handlers registered');
  });

  // ═══════════════════════════════════════════════════════════
  //  READY PHASE — Priority 108: Wire MessageService dead zone integration
  // ═══════════════════════════════════════════════════════════

  initializer.register('ready', 108, 'Network ↔ MessageService integration', () => {
    const eventBus = game.nightcity.eventBus;
    const messageService = game.nightcity.messageService;
    const networkService = game.nightcity.networkService;

    if (!eventBus || !messageService || !networkService) {
      log.debug('Network ↔ MessageService integration: dependencies not ready (may not be Phase 2 yet)');
      return;
    }

    // When we leave a dead zone (NETWORK_CONNECTED), flush the message queue
    eventBus.on(EVENTS.NETWORK_CONNECTED, (data) => {
      if (data.source === 'socket' || data.reason !== 'dead_zone') {
        // Socket events mean the GM toggled dead zone off — flush our queue
        messageService.flushQueue();
      }
    });

    // When a message is about to send, check dead zone
    // (MessageService already has queue logic, but this ensures the network
    //  service state is checked even for newly-composed messages)
    log.info('Network ↔ MessageService integration wired');
  });

  // ═══════════════════════════════════════════════════════════
  //  READY PHASE — Priority 112: UI Launch Functions
  //  (Override the stubs from registerUIComponents at 110)
  // ═══════════════════════════════════════════════════════════

  initializer.register('ready', 112, 'Network UI launch functions', () => {
    const ns = game.nightcity;
    log.info('Registering network UI launch functions...');

    // ─── openNetworkManagement (GM only) ────────────────────
    ns.openNetworkManagement = () => {
      if (!isGM()) {
        ui.notifications.warn('NCM | Network Management is GM-only.');
        return;
      }

      // Singleton pattern: reuse if already rendered, otherwise create fresh
      if (_managementApp?.rendered) {
        _managementApp.bringToFront();
        return;
      }

      _managementApp = new NetworkManagementApp();
      _managementApp.render(true);
    };

    // Network Manager Alias
    ns.openNetworkManager = ns.openNetworkManagement;

    // ─── Network Public API Functions ───────────────────────
    ns.getCurrentNetwork = () => ns.networkService?.currentNetwork ?? null;
    ns.getSignalStrength = () => ns.networkService?.signalStrength ?? 0;
    ns.getAvailableNetworks = () => ns.networkService?.getAvailableNetworks() ?? [];

    ns.setNetwork = async (networkId) => {
      if (!isGM()) {
        ui.notifications.warn('NCM | setNetwork is GM-only.');
        return { success: false };
      }
      return ns.networkService?.switchNetwork(networkId, { force: true }) ?? { success: false };
    };

    ns.toggleDeadZone = async (sceneId, isDead) => {
      if (!isGM()) {
        ui.notifications.warn('NCM | toggleDeadZone is GM-only.');
        return;
      }
      return ns.networkService?.toggleDeadZone(sceneId, isDead);
    };

    /**
     * Attempt to connect to a network. If auth is required, shows the auth dialog.
     * @param {string} networkId
     * @returns {Promise<{ success: boolean }>}
     */
    ns.connectToNetwork = async (networkId) => {
      const networkService = ns.networkService;
      if (!networkService) return { success: false };

      const network = networkService.getNetwork(networkId);
      if (!network) {
        ui.notifications.warn('NCM | Unknown network.');
        return { success: false };
      }

      // If no auth required, or already authenticated, just switch
      if (!network.security.requiresAuth || networkService.isAuthenticated(networkId) || isGM()) {
        return networkService.switchNetwork(networkId);
      }

      // Show auth dialog
      const authResult = await NetworkAuthDialog.show(networkId);
      if (authResult.success) {
        return networkService.switchNetwork(networkId);
      }

      return { success: false, reason: 'auth_failed' };
    };

    // ─── WP-5: Dead Zone Warning Overlay ────────────────────
    DeadZoneWarningApp.registerListeners();
    ns.showDeadZoneWarning = (sceneName) => DeadZoneWarningApp.show(sceneName);

    // ─── Phase 3 Verification ───────────────────────────────
    ns.verifyPhase3 = () => Phase3Verification.run();

    log.info('Network UI launch functions registered');
  });
}
