/**
 * Register Ready-Phase Services
 * @file scripts/init/registerReadyServices.js
 * @module night-city-messenger
 * @description Services that require game.ready — TimeService, ThemeService, SoundService,
 *              SocketManager initialization, and the postReady health check.
 */

import { log } from '../utils/helpers.js';
import { MODULE_ID } from '../utils/constants.js';
import { runMigrations } from '../core/MigrationRunner.js';
import { TimeService } from '../services/TimeService.js';
import { ThemeService } from '../services/ThemeService.js';
import { SoundService } from '../services/SoundService.js';
import { ContactBreachService } from '../services/ContactBreachService.js';


export function registerReadyServices(initializer) {

  // ─── TimeService ───
  initializer.register('ready', 10, 'TimeService', () => {
    const timeService = new TimeService();
    timeService.initialize();
    game.nightcity.timeService = timeService;
  });

  // ─── ThemeService ───
  initializer.register('ready', 15, 'ThemeService', () => {
    const themeService = new ThemeService(
      game.nightcity.settingsManager,
      game.nightcity.eventBus
    );
    themeService.initialize();
    game.nightcity.themeService = themeService;
  });

  // ─── SoundService ───
  initializer.register('ready', 16, 'SoundService', async () => {
    const soundService = new SoundService(game.nightcity.settingsManager);
    await soundService.initialize();
    game.nightcity.soundService = soundService;
  });

  //  ─── ContactBreachService ───
  initializer.register('ready', 83, 'ContactBreachService', async () => {
    game.nightcity.contactBreachService = new ContactBreachService();
    log.info('ContactBreachService initialized');
  });

  // ─── MessageAccessService ───
  initializer.register('ready', 85, 'MessageAccessService', async () => {
    const { MessageAccessService } = await import('../services/MessageAccessService.js');
    game.nightcity.messageAccessService = new MessageAccessService();
    log.info('MessageAccessService initialized');
  });

  // ─── PortraitService ───
  initializer.register('ready', 82, 'PortraitService', async () => {
    const { PortraitService } = await import('../services/PortraitService.js');
    game.nightcity.portraitService = new PortraitService();
    log.info('PortraitService initialized');
  });

  // ─── ContactShareService ───
  initializer.register('ready', 84, 'ContactShareService', async () => {
    const { ContactShareService } = await import('../services/ContactShareService.js');
    game.nightcity.contactShareService = new ContactShareService();
    log.info('ContactShareService initialized');
  });

  // ─── EmailService ───
  initializer.register('ready', 86, 'EmailService', async () => {
    const { EmailService } = await import('../services/EmailService.js');
    game.nightcity.emailService = new EmailService({
      networkService: game.nightcity.networkService,
    });

    // Register the setup flow launcher
    game.nightcity.openEmailSetup = async (actor) => {
      if (!actor) {
        actor = game.user?.character;
        if (!actor) {
          ui.notifications.warn('NCM | No actor assigned to open email setup.');
          return null;
        }
      }
      const { EmailSetupFlow } = await import('../ui/dialogs/EmailSetupFlow.js');
      return EmailSetupFlow.run(actor, game.nightcity.emailService);
    };

    log.info('EmailService initialized');
  });

  // ─── SocketManager init ───
  initializer.register('ready', 100, 'SocketManager init', () => {
    game.nightcity.socketManager.initialize();
  });

  // ─── Malware Workshop launcher (GM program authoring) ───
  initializer.register('ready', 113, 'openMalwareWorkshop launch', async () => {
    const { MalwareWorkshopApp } = await import('../ui/MalwareWorkshop/MalwareWorkshopApp.js');
    /**
     * Open the GM Malware Workshop.
     * @param {object} [opts] { target?:{kind,item,accountId?,onSave?}, program?, libId? }
     */
    game.nightcity.openMalwareWorkshop = (opts = {}) => {
      if (!game.user?.isGM) { ui.notifications?.warn('NCM | The Malware Workshop is GM-only.'); return null; }
      const existing = Object.values(ui.windows).find((w) => w.id === 'ncm-malware-workshop');
      if (existing) existing.close({ animate: false });
      const app = new MalwareWorkshopApp(opts);
      app.render(true);
      return app;
    };
    // Macro-API alias
    if (game.nightcity.messenger) game.nightcity.messenger.openMalwareWorkshop = game.nightcity.openMalwareWorkshop;
  });

  // ─── Program Deck launcher (view a shard's programs — cartridge reader) ───
  initializer.register('ready', 114, 'openProgramDeck launch', async () => {
    const { ProgramDeckApp } = await import('../ui/ProgramDeck/ProgramDeckApp.js');
    game.nightcity.openProgramDeck = (itemOrId) => {
      const item = (typeof itemOrId === 'string') ? game.items?.get(itemOrId) : itemOrId;
      if (!item) { ui.notifications?.warn('NCM | No item for the Program Deck.'); return null; }
      const existing = Object.values(ui.windows).find((w) => w.id === 'ncm-program-deck');
      if (existing) existing.close({ animate: false });
      const app = new ProgramDeckApp({ item });
      app.render(true);
      return app;
    };
    if (game.nightcity.messenger) game.nightcity.messenger.openProgramDeck = game.nightcity.openProgramDeck;
  });

  // ─── Schema migrations — version-keyed world-data upgrades (GM only).
  //     Runs BEFORE anything reads evolving flag shapes in earnest; no-ops
  //     when the world is already current. See core/MigrationRunner.js. ───
  initializer.register('postReady', 5, 'Schema migrations', async () => {
    try {
      await runMigrations();
    } catch (err) {
      log.error(`Schema migration pass failed: ${err.message}`);
    }
  });

  // ─── Integration Bridge (public API + hook mirroring for other modules) ───
  initializer.register('postReady', 95, 'IntegrationBridge', async () => {
    const { initializeIntegrationBridge } = await import('../integrations/IntegrationBridge.js');
    await initializeIntegrationBridge();
  });

  // ─── postReady: Final flag ───
  initializer.register('postReady', 100, 'Ready flag', () => {
    game.nightcity.ready = true;
    const v = game.modules.get(MODULE_ID)?.version || '?';
    log.info('╔══════════════════════════════════════════╗');
    log.info(`║   Night City Messenger v${v} — ONLINE`.padEnd(43) + '║');
    log.info('╚══════════════════════════════════════════╝');
  });
}
