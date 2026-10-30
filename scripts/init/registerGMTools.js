/**
 * Register GM Tools & Customization
 * @file scripts/init/registerGMTools.js
 * @module night-city-messenger
 * @description Phase 5 initialization — wires SchedulingService, MasterContactService,
 *              MacroAPI, GM UI applications, and Phase 5 verification.
 *
 * Priority Map (ready phase):
 *   70  — SchedulingService       (depends on MessageService, TimeService)
 *   80  — MasterContactService    (depends on SettingsManager)
 *  110  — MacroAPI                (depends on all services)
 *  112  — Phase 5 UI launchers    (depends on services + MacroAPI)
 *
 * Priority Map (postReady phase):
 *   32  — Phase 5 verification
 */

import { MODULE_ID, TEMPLATES } from '../utils/constants.js';
import { log, isGM, isSelectableCharacter } from '../utils/helpers.js';
import { registerAdminDialogHook } from '../utils/adminTheme.js';
import { SchedulingService } from '../services/SchedulingService.js';
import { MasterContactService } from '../services/MasterContactService.js';
import { ContactGroupService } from '../services/ContactGroupService.js';
import { MacroAPI } from '../integrations/MacroAPI.js';
import { Phase5Verification } from '../tests/Phase5Verification.js';
import { ContactManagerApp } from '../ui/ContactManager/ContactManagerApp.js';

/**
 * Register all Phase 5 GM tools and customization components.
 * @param {import('../core/ModuleInitializer.js').ModuleInitializer} initializer
 */
export function registerGMTools(initializer) {
  log.debug('Registering GM tools & customization (Phase 5)');

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
      // Contact groups ride on the directory (members resolve through it).
      const contactGroupService = new ContactGroupService();
      contactGroupService.initialize();
      game.nightcity.contactGroupService = contactGroupService;
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

  // Foundry Dialogs opened by GM tools (adminDialog/adminConfirm/adminPrompt)
  // carry the admin theme preset + text size — see utils/adminTheme.js.
  initializer.register('ready', 111, 'Admin dialog theme hook', () => {
    registerAdminDialogHook();
  });

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

    // ─── One admin tab, in the panel or popped out (2026-10-27 redesign) ───
    // openAdminTab('contacts', { select: contactId })            → the panel, on that tab
    // openAdminTab('networks', { popout: true, select: netId })  → its own larger window
    // `select` is handed to the tab's openTo(select) so it can open on that row.
    ns.openAdminTab = async (tab, { popout = false, select = null } = {}) => {
      if (!game.user.isGM) return ui.notifications.warn('GM only');
      const { AdminPanelApp } = await import('../ui/AdminPanel/AdminPanelApp.js');
      if (popout) return AdminPanelApp.openTabWindow(tab, { select });
      const panel = await ns.openAdmin();
      if (!panel) return null;
      if (select && typeof panel.tabs?.[tab]?.openTo === 'function') panel.tabs[tab].openTo(select);
      panel._activeTab = tab;
      panel.render(true);
      return panel;
    };

    // ─── GM Contact Manager → Admin → Contacts (the window was folded into the tab, 2026-10-27) ───
    // Kept as an alias so macros and old buttons still land somewhere: opens the
    // panel on Contacts (on a contact when given its id).
    ns.openGMContacts = async (select = null) => ns.openAdminTab('contacts', { select });

    // ── Store the class reference for AdminPanel's GM inspect mode ──
    ns._ContactManagerApp = ContactManagerApp;

    // ── openContacts (updated to accept gmInspectMode) ──
    ns.openContacts = (actorId, options = {}) => {
      if (!actorId) {
        const owned = game.actors.find(a => a.isOwner && isSelectableCharacter(a) && a.getFlag(MODULE_ID, 'email'));
        actorId = owned?.id;
      }
      if (!actorId) {
        // If no actor with email, maybe they need setup
        const fallback = game.user?.character?.id;
        if (fallback && !game.user.isGM) {
          const emailService = game.nightcity?.emailService;
          if (emailService?.isSetupRequired() && !emailService.hasEmail(game.user.character)) {
            game.nightcity.openEmailSetup(game.user.character).then(email => {
              if (email) ns.openContacts(fallback, options);
            });
            return;
          }
        }
        ui.notifications.warn('No actor with email found.');
        return;
      }

      // ── Email setup intercept ──
      if (!game.user.isGM && !options.gmInspectMode) {
        const emailService = game.nightcity?.emailService;
        if (emailService?.isSetupRequired()) {
          const actor = game.actors.get(actorId);
          if (actor && !emailService.hasEmail(actor)) {
            game.nightcity.openEmailSetup(actor).then(email => {
              if (email) ns.openContacts(actorId, options);
            });
            return;
          }
        }
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
      _openSingleton(`contacts-${actorId}`, () =>
        import('../ui/ContactManager/ContactManagerApp.js'),
        { actorId }
      );
    };

    // ─── Theme Customizer (all players) ───
    ns.openThemeCustomizer = async (opts = {}) => {
      const app = await _openSingleton('theme-customizer', () =>
        import('../ui/ThemeCustomizer/ThemeCustomizerApp.js'), opts);
      // Honor an activeTab even when the window was already open (the constructor
      // only runs on a fresh open) — e.g. the Sound Settings entry point.
      if (opts.activeTab && app && app._activeTab !== opts.activeTab) {
        app._activeTab = opts.activeTab;
        if (app.rendered) app.render(false);
      }
      return app;
    };

    // ─── Player Email Setup (utility — uses new EmailSetupFlow) ───
    ns.setupEmail = async (actorId) => {
      const actor = actorId ? game.actors.get(actorId) : game.user?.character;
      return game.nightcity.openEmailSetup(actor);
    };

    ns.ensureEmail = async (actorId) => {
      const actor = actorId ? game.actors.get(actorId) : game.user?.character;
      if (!actor) return null;
      const emailService = game.nightcity?.emailService;
      if (emailService?.hasEmail(actor)) return emailService.getEmail(actor);
      return game.nightcity.openEmailSetup(actor);
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