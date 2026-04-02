/**
 * Register Ready-Phase Services
 * @file scripts/init/registerReadyServices.js
 * @module cyberpunkred-messenger
 * @description Services that require game.ready — TimeService, ThemeService, SoundService,
 *              SocketManager initialization, and the postReady health check.
 */

import { log } from '../utils/helpers.js';
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

  // ─── postReady: Final flag ───
  initializer.register('postReady', 100, 'Ready flag', () => {
    game.nightcity.ready = true;
    log.info('╔══════════════════════════════════════════╗');
    log.info('║   Night City Messenger v4.1 — ONLINE    ║');
    log.info('╚══════════════════════════════════════════╝');
  });
}
