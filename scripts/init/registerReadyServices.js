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
