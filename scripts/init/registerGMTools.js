/**
 * Register GM Tools & Customization
 * @file scripts/init/registerGMTools.js
 * @module cyberpunkred-messenger
 * @description Phase 5 initialization — wires SchedulingService, MasterContactService,
 *              MacroAPI, GM UI applications, and Phase 5 verification.
 *
 * Priority Map (ready phase):
 *   70  — SchedulingService       (depends on MessageService, TimeService)
 *   80  — MasterContactService    (depends on SettingsManager)
 *  110  — MacroAPI                (depends on all services)
 *  112  — Phase 5 UI launchers    (depends on services + MacroAPI)
 *  115  — EmailSettingsIntegration hooks
 *
 * Priority Map (init phase):
 *   40  — EmailSettingsIntegration (actor sheet hooks)
 *
 * Priority Map (postReady phase):
 *   32  — Phase 5 verification
 */

import { MODULE_ID, TEMPLATES } from '../utils/constants.js';
import { log, isGM } from '../utils/helpers.js';
import { SchedulingService } from '../services/SchedulingService.js';
import { MasterContactService } from '../services/MasterContactService.js';
import { MacroAPI } from '../integrations/MacroAPI.js';
import { EmailSettingsIntegration } from '../integrations/EmailSettingsIntegration.js';
import { Phase5Verification } from '../tests/Phase5Verification.js';
import { ContactManagerApp } from '../ui/ContactManager/ContactManagerApp.js';

/**
 * Register all Phase 5 GM tools and customization components.
 * @param {import('../core/ModuleInitializer.js').ModuleInitializer} initializer
 */
export function registerGMTools(initializer) {
  log.debug('Registering GM tools & customization (Phase 5)');

  // ═══════════════════════════════════════════════════════════
  //  INIT PHASE — Email Settings Integration Hooks
  //  Priority 40 (after item sheet hooks at 30)
  // ═══════════════════════════════════════════════════════════

  initializer.register('init', 40, 'EmailSettingsIntegration', () => {
    EmailSettingsIntegration.register();
    log.info('EmailSettingsIntegration hooks registered');
  });

  // ═══════════════════════════════════════════════════════════
  //  READY PHASE — SchedulingService
  //  Priority 70 (after MessageService at 50, TimeService at 10)
  // ═══════════════════════════════════════════════════════════

  initializer.register('ready', 70, 'SchedulingService', () => {
    try {
      const schedulingService = new SchedulingService();
      schedulingService.initialize();
      game.nightcity.schedulingService = schedulingService;
      log.info('SchedulingService registered on game.nightcity');
    } catch (err) {
      log.error(`SchedulingService initialization failed: ${err.message}`);
    }
  });

  // ═══════════════════════════════════════════════════════════
  //  READY PHASE — MasterContactService
  //  Priority 80 (after SchedulingService at 70)
  // ═══════════════════════════════════════════════════════════

  initializer.register('ready', 80, 'MasterContactService', () => {
    try {
      const masterContactService = new MasterContactService();
      masterContactService.initialize();
      game.nightcity.masterContactService = masterContactService;
      log.info('MasterContactService registered on game.nightcity');
    } catch (err) {
      log.error(`MasterContactService initialization failed: ${err.message}`);
    }
  });

  // ═══════════════════════════════════════════════════════════
  //  READY PHASE — MacroAPI
  //  Priority 110 (after all services, before UI launchers)
  // ═══════════════════════════════════════════════════════════

  initializer.register('ready', 110, 'MacroAPI', () => {
    try {
      MacroAPI.register();
      log.info('MacroAPI registered');
    } catch (err) {
      log.error(`MacroAPI registration failed: ${err.message}`);
    }
  });

  // ═══════════════════════════════════════════════════════════
  //  READY PHASE — Phase 5 UI Launch Functions
  //  Priority 112 (overrides Phase 1 stubs at 110)
  // ═══════════════════════════════════════════════════════════

  initializer.register('ready', 112, 'Phase 5 UI launchers', () => {
    const ns = game.nightcity;

    // Track singleton windows
    const _openWindows = new Map();

    /**
     * Helper: Open or bring to front a singleton window.
     * @param {string} key
     * @param {Function} AppClass
     * @param {object} [options]
     * @returns {BaseApplication}
     */
    const _openSingleton = async (key, AppClass, options = {}) => {
      let app = _openWindows.get(key);
      if (app?.rendered) {
        app.bringToFront();
        return app;
      }

      // Lazy import to avoid circular dependency issues
      const mod = await AppClass();
      const Cls = mod.default || Object.values(mod)[0];

      app = new Cls(options);
      _openWindows.set(key, app);

      const origClose = app.close.bind(app);
      app.close = async (...args) => {
        _openWindows.delete(key);
        return origClose(...args);
      };

      app.render(true);
      return app;
    };

    // ─── Admin Panel (GM only) ───
    ns.openAdmin = async () => {
      if (!game.user.isGM) return ui.notifications.warn('GM only');
      return _openSingleton('admin-panel', () =>
        import('../ui/AdminPanel/AdminPanelApp.js')
      );
    };

    // ─── GM Contact Manager (GM only) ───
    ns.openGMContacts = async () => {
      if (!game.user.isGM) return ui.notifications.warn('GM only');
      return _openSingleton('gm-contacts', () =>
        import('../ui/GMContactManager/GMContactManagerApp.js')
      );
    };

    // ── Store the class reference for AdminPanel's GM inspect mode ──
    ns._ContactManagerApp = ContactManagerApp;

    // ── openContacts (updated to accept gmInspectMode) ──
    ns.openContacts = (actorId, options = {}) => {
      if (!actorId) {
        const owned = game.actors.find(a => a.isOwner && a.getFlag(MODULE_ID, 'email'));
        actorId = owned?.id;
      }
      if (!actorId) {
        ui.notifications.warn('No actor with email found.');
        return;
      }

      // GM inspect mode always opens a fresh window (not singleton)
      if (options.gmInspectMode) {
        const app = new ContactManagerApp({
          actorId,
          gmInspectMode: true,
        });
        app.render(true);
        return;
      }

      // Normal player mode — singleton per actor
      _openSingleton(`contacts-${actorId}`, ContactManagerApp, { actorId });
    };

    // ─── Theme Customizer (all players) ───
    ns.openThemeCustomizer = async () => {
      return _openSingleton('theme-customizer', () =>
        import('../ui/ThemeCustomizer/ThemeCustomizerApp.js')
      );
    };

    // ─── Player Email Setup (utility — called programmatically) ───
    ns.setupEmail = async (actorId) => {
      const { PlayerEmailSetup } = await import('../ui/dialogs/PlayerEmailSetup.js');
      return PlayerEmailSetup.show(actorId);
    };

    ns.ensureEmail = async (actorId) => {
      const { PlayerEmailSetup } = await import('../ui/dialogs/PlayerEmailSetup.js');
      return PlayerEmailSetup.ensureEmail(actorId);
    };

    log.info('Phase 5 UI launch functions registered');
  });

  // ═══════════════════════════════════════════════════════════
  //  POST-READY PHASE — Phase 5 Verification
  //  Priority 32 (after Phase 4 verification at 31)
  // ═══════════════════════════════════════════════════════════

  initializer.register('postReady', 32, 'Phase 5 Verification', async () => {
    // Register on namespace for manual runs
    game.nightcity.verifyPhase5 = () => new Phase5Verification().run();

    // Auto-run in debug mode
    try {
      if (game.settings.get(MODULE_ID, 'debugMode')) {
        await new Phase5Verification().run();
      }
    } catch (err) {
      log.error(`Phase 5 verification failed: ${err.message}`);
    }
  });
}