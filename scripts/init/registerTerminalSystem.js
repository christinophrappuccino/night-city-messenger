/**
 * Register Terminal System
 * @file scripts/init/registerTerminalSystem.js
 * @module cyberpunkred-messenger
 * @description Terminal Expansion initialization — constructs TerminalService and
 *   registers its macro API. A Terminal is the sibling of a Data Shard (an item
 *   you log into vs. a file you crack open); the service delegates security/ICE/
 *   storage to the shared services, so it only needs to come up AFTER them.
 *
 * Priority Map (ready phase):
 *   62   — TerminalService   (depends on EventBus, SocketManager, SecurityService,
 *                             SkillService, MessageRepository, DataShardService)
 *   64   — TerminalScenePins (drag-to-scene access points; needs TerminalService)
 *   122  — Terminal macro API (extends game.nightcity.messenger)
 */

import { log, isGM } from '../utils/helpers.js';
import { EVENTS } from '../utils/constants.js';
import { TerminalService } from '../services/TerminalService.js';
import { TerminalScenePins } from '../integrations/TerminalScenePins.js';

/**
 * @param {import('../core/ModuleInitializer.js').ModuleInitializer} initializer
 */
export function registerTerminalSystem(initializer) {
  log.debug('Registering terminal system');

  // ─── TerminalService — Priority 62 (ready) ───
  initializer.register('ready', 62, 'TerminalService', () => {
    try {
      game.nightcity.terminalService = new TerminalService();
      log.info('TerminalService registered on game.nightcity');
    } catch (err) {
      log.error(`TerminalService initialization failed: ${err.message}`);
    }
  });

  // ─── TerminalScenePins — Priority 64 (ready) ───
  // Drag a terminal item onto the canvas → a clickable map-note access point.
  // Registered on every client (players need the activateNote intercept + the
  // notes-display auto-show; drop/cleanup paths self-gate on GM).
  initializer.register('ready', 64, 'TerminalScenePins', () => {
    try {
      game.nightcity.terminalScenePins = new TerminalScenePins();
      game.nightcity.terminalScenePins.init();
    } catch (err) {
      log.error(`TerminalScenePins initialization failed: ${err.message}`);
    }
  });

  // ─── Payload effect reaper — Priority 66 (ready, GM only) ───
  // Timed utility-program effects (jammer/etc.) auto-expire on the game clock;
  // this poll flips active→done and restores reversible effects. 60s cadence,
  // mirroring the self-destruct reaper. The client viewer already shows the
  // countdown/expired state live; this persists it + undoes host side effects.
  initializer.register('ready', 66, 'Payload effect reaper', async () => {
    if (!isGM()) return;
    try {
      const { reapExpiredPayloads } = await import('../ui/content/SiphonFlow.js');
      reapExpiredPayloads().catch(err => log.warn(`Payload reap failed: ${err.message}`));
      setInterval(() => {
        reapExpiredPayloads().catch(err => log.warn(`Payload reap failed: ${err.message}`));
      }, 60000);
      log.debug('Payload effect reaper started (60s)');
    } catch (err) {
      log.error(`Payload reaper registration failed: ${err.message}`);
    }
  });

  // ─── Resident reaper — Priority 67 (ready) ───
  // Fires onDate residents (logic bombs / timed plants) whose scheduled time has
  // passed. Same 60s cadence + time-provider basis as the payload reaper; each due
  // resident routes through the GM-gated fire proposal (snoozes on "Later").
  initializer.register('ready', 67, 'Resident reaper', async () => {
    if (!isGM()) return;
    try {
      const svc = () => game.nightcity?.terminalService;
      const sweep = () => {
        svc()?.reapResidents?.().catch(err => log.warn(`Resident reap failed: ${err.message}`));
        // Close expired forged backdoor accounts (24h game-time cap, thread 6).
        svc()?.reapForgedAccounts?.().catch(err => log.warn(`Forged-account reap failed: ${err.message}`));
      };
      sweep();
      setInterval(sweep, 60000);
      log.debug('Resident + forged-account reaper started (60s)');
    } catch (err) {
      log.error(`Resident reaper registration failed: ${err.message}`);
    }
  });

  // ─── Resident action triggers — Priority 68 (ready) ───
  // onAction residents that fire when the operator exfiltrates. All 7 exfil
  // variants emit EVENTS.TERMINAL_EXFIL GM-side, so ONE listener covers them —
  // including UNGATED exfils, which never reach the trace funnel. Every OTHER
  // action (siphon/crack/decrypt/deploy/execute/upload…) is picked up centrally
  // by TraceService._fireResidentTriggers, which is why it skips 'exfil': this
  // listener already owns it, and running both would propose twice.
  initializer.register('ready', 68, 'Resident action triggers', async () => {
    if (!isGM()) return;
    try {
      const bus = game.nightcity?.eventBus;
      if (!bus) return;
      bus.on(EVENTS.TERMINAL_EXFIL, (data) => {
        if (!isGM()) return;
        const item = data?.itemId ? game.items?.get(data.itemId) : null;
        if (item) {
          game.nightcity?.terminalService?.checkActionResidents?.(item, 'exfil', {})
            ?.catch(err => log.warn(`Resident action-check failed: ${err.message}`));
        }
      });
      log.debug('Resident action triggers wired (exfil)');
    } catch (err) {
      log.error(`Resident action-trigger registration failed: ${err.message}`);
    }
  });

  // ─── openTerminal launch function — Priority 112 (ready) ───
  initializer.register('ready', 112, 'openTerminal launch', async () => {
    try {
      const { TerminalViewerApp } = await import('../ui/Terminal/TerminalViewerApp.js');

      /**
       * Open a Terminal viewer for the given item.
       * @param {Item|string} itemOrId
       * @param {object} [options]
       * @param {Actor|string} [options.actor]
       * @returns {TerminalViewerApp|null}
       */
      game.nightcity.openTerminal = (itemOrId, options = {}) => {
        const svc = game.nightcity?.terminalService;
        if (!svc) { ui.notifications.error('Night City Messenger: TerminalService not available'); return null; }

        let item = typeof itemOrId === 'string'
          ? (fromUuidSync(itemOrId) ?? game.items.get(itemOrId))
          : itemOrId;
        if (typeof itemOrId === 'string' && !item) {
          for (const actor of game.actors) { item = actor.items.get(itemOrId); if (item) break; }
        }
        if (!item) { ui.notifications.warn('Night City Messenger: Item not found'); return null; }
        if (!svc.isTerminal(item)) { ui.notifications.warn(`"${item.name}" is not a terminal`); return null; }

        let actor = options.actor;
        if (typeof actor === 'string') actor = game.actors.get(actor);
        if (!actor && !isGM()) actor = game.user.character;

        // Singleton — close any open terminal window first (fresh boot).
        const existing = Object.values(ui.windows).find(w => w.id === 'ncm-terminal-viewer');
        if (existing) existing.close({ animate: false });

        const app = new TerminalViewerApp({ item, actor });
        app.render(true);
        return app;
      };

      log.info('openTerminal() registered on game.nightcity');
    } catch (err) {
      log.error(`openTerminal launch registration failed: ${err.message}`);
    }
  });

  // ─── Terminal macro API — Priority 122 (ready) ───
  initializer.register('ready', 122, 'Terminal macro API', () => {
    try {
      const api = game.nightcity.messenger ?? {};
      const svc = () => game.nightcity.terminalService;

      const resolveItem = (itemOrId) => {
        if (typeof itemOrId !== 'string') return itemOrId;
        let item = fromUuidSync(itemOrId) ?? game.items.get(itemOrId);
        if (!item) {
          for (const actor of game.actors) {
            item = actor.items.get(itemOrId);
            if (item) break;
          }
        }
        return item;
      };

      /**
       * Convert an item to a Terminal (GM). @returns {Promise<object>}
       */
      api.convertToTerminal = async (itemOrId, config = {}) => {
        const item = resolveItem(itemOrId);
        if (!item) throw new Error('Item not found');
        return svc().convertToTerminal(item, config);
      };

      /**
       * Add an account to a Terminal (GM).
       * @param {Item|string} itemOrId
       * @param {object} accountData - { username, displayName, email?, isAdmin?, hidden?, security? }
       * @returns {Promise<object>}
       */
      api.addTerminalAccount = async (itemOrId, accountData = {}) => {
        const item = resolveItem(itemOrId);
        if (!item) throw new Error('Item not found');
        return svc().addAccount(item, accountData);
      };

      /**
       * Add a message to a Terminal account's mailbox (GM).
       * @param {Item|string} itemOrId
       * @param {string} accountId
       * @param {object} messageData - { from, subject, body, timestamp?, ... }
       * @returns {Promise<object>}
       */
      api.addTerminalMessage = async (itemOrId, accountId, messageData = {}) => {
        const item = resolveItem(itemOrId);
        if (!item) throw new Error('Item not found');
        return svc().addAccountMessage(item, accountId, messageData);
      };

      /** GM force-unlock a Terminal (bypass all account auth). */
      api.forceUnlockTerminal = async (itemOrId) => {
        const item = resolveItem(itemOrId);
        if (!item) throw new Error('Item not found');
        return svc().forceUnlock(item);
      };

      /** GM relock a Terminal (wipe sessions + reset lockouts). */
      api.relockTerminal = async (itemOrId) => {
        const item = resolveItem(itemOrId);
        if (!item) throw new Error('Item not found');
        return svc().relock(item);
      };

      game.nightcity.messenger = api;
      log.info('Terminal macro API extensions registered');
    } catch (err) {
      log.error(`Terminal macro API registration failed: ${err.message}`);
    }
  });
}
