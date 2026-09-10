/**
 * Register Core Services
 * @file scripts/init/registerCoreServices.js
 * @module night-city-messenger
 * @description Initializes core singletons and registers settings.
 */

import { MODULE_ID } from '../utils/constants.js';
import { log } from '../utils/helpers.js';
import { EventBus } from '../core/EventBus.js';
import { StateManager } from '../core/StateManager.js';
import { SettingsManager } from '../core/SettingsManager.js';
import { SocketManager } from '../core/SocketManager.js';
import { DocumentSyncBridge } from '../integrations/DocumentSyncBridge.js';
import { migrateClientSettings, runNamespaceMigration } from '../core/NamespaceMigration.js';

export function registerCoreServices(initializer) {
  // ─── preInit: Carry client settings over from the module's original id ───
  // Runs on EVERY client before any setting is registered or read (localStorage
  // copy, never clobbers). The GM-side world migration is at ready/1 below.
  initializer.register('preInit', 1, 'Legacy client-settings carry-over', () => {
    migrateClientSettings();
  });

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

  // ─── ready: Migrate world data from the module's original id (GM, once) ───
  // MUST be the first ready task: every later service loads flags/settings
  // into memory, so the move has to land before they look. Prompts the GM,
  // then requests a world reload so all clients rebuild from the moved data.
  initializer.register('ready', 1, 'Legacy namespace migration', async () => {
    await runNamespaceMigration();
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
      iceService: null,
      messageService: null,
      notificationService: null,
      dataShardService: null,
      schedulingService: null,
      masterContactService: null,
      accessLogService: null,
      emailService: null,

      // UI launch functions populated later
      openInbox: null,
      composeMessage: null,
      openContacts: null,
      openAdmin: null,
      openDataShard: null,
      openNetworkManagement: null,
      openThemeCustomizer: null,
      openEmailSetup: null,
    };

    log.info('game.nightcity namespace created');
  });

  // ─── ready: Document Sync Bridge ───
  initializer.register('ready', 105, 'Document sync bridge', () => {
    const eventBus = game.nightcity.eventBus;
    if (eventBus) {
      DocumentSyncBridge.register(eventBus);
      log.info('DocumentSyncBridge registered');
    }
  });
}
