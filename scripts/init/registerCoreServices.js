/**
 * Register Core Services
 * @file scripts/init/registerCoreServices.js
 * @module cyberpunkred-messenger
 * @description Initializes core singletons and registers settings.
 */

import { MODULE_ID } from '../utils/constants.js';
import { log } from '../utils/helpers.js';
import { EventBus } from '../core/EventBus.js';
import { StateManager } from '../core/StateManager.js';
import { SettingsManager } from '../core/SettingsManager.js';
import { SocketManager } from '../core/SocketManager.js';

export function registerCoreServices(initializer) {
  // ─── preInit: Create singletons ───
  initializer.register('preInit', 10, 'Core singletons', () => {
    const eventBus = EventBus.getInstance();
    const stateManager = StateManager.getInstance();
    const settingsManager = SettingsManager.getInstance();
    const socketManager = SocketManager.getInstance();

    // Wire up EventBus to StateManager
    stateManager.setEventBus(eventBus);

    // Store references for later
    initializer._core = { eventBus, stateManager, settingsManager, socketManager };
    log.info('Core singletons created');
  });

  // ─── preInit: Register settings ───
  initializer.register('preInit', 30, 'Settings registration', () => {
    initializer._core.settingsManager.registerAll();
  });

  // ─── init: Set up game.nightcity namespace ───
  initializer.register('init', 10, 'Namespace setup', () => {
    const { eventBus, stateManager, settingsManager, socketManager } = initializer._core;

    game.nightcity = {
      ready: false,
      eventBus,
      stateManager,
      settingsManager,
      socketManager,

      // Services populated during ready phase
      themeService: null,
      soundService: null,
      timeService: null,
      skillService: null,
      networkService: null,
      securityService: null,
      messageService: null,
      notificationService: null,
      dataShardService: null,
      schedulingService: null,
      masterContactService: null,
      accessLogService: null,

      // UI launch functions populated later
      openInbox: null,
      composeMessage: null,
      openContacts: null,
      openAdmin: null,
      openDataShard: null,
      openNetworkManagement: null,
      openThemeCustomizer: null,
    };

    log.info('game.nightcity namespace created');
  });
}
