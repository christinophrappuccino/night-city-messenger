/**
 * Register UI Components
 * @file scripts/init/registerUIComponents.js
 * @module night-city-messenger
 * @description Registers scene controls, token HUD buttons, and UI launch functions.
 */

import { ncmNotify } from '../utils/notify.js';
import { MODULE_ID, MODULE_TITLE } from '../utils/constants.js';
import { log, isGM } from '../utils/helpers.js';
import { registerMinimizeControls } from '../utils/windowMinimize.js';
import { InteractionLayerClass } from '../utils/compat.js';

export function registerUIComponents(initializer) {
  // A visible minimize button on every NCM window + the bigger dialogs (scripts/utils/windowMinimize.js).
  initializer.register('init', 21, 'Minimize buttons', () => {
    try { registerMinimizeControls(); } catch (err) { log.error(`Minimize buttons failed: ${err.message}`); }
  });

  initializer.register('init', 20, 'Scene controls', () => {
    // The button group needs a canvas layer of its OWN. It used to name core's shared 'controls' layer, and Foundry
    // picks a group by its layer (SceneControls#initialize: the FIRST group on that layer wins), so a module that
    // also uses 'controls' — Grid Scaler — opened instead of the messenger (tester 2026-11-03). An empty
    // interaction layer: nothing is drawn on it, it only gives the group a unique name.
    const IL = InteractionLayerClass();
    let groupLayer = 'controls';
    if (IL && globalThis.CONFIG?.Canvas?.layers) {
      class NCMControlsLayer extends IL {
        static get layerOptions() { return foundry.utils.mergeObject(super.layerOptions, { name: 'ncmControls' }); }
      }
      CONFIG.Canvas.layers.ncmControls = { layerClass: NCMControlsLayer, group: 'interface' };
      groupLayer = 'ncmControls';
    }

    Hooks.on('getSceneControlButtons', (controls) => {
      if (!game.nightcity) return;

      let callsOn = true;
      try { callsOn = game.settings.get(MODULE_ID, 'callsEnabled') !== false; } catch { /* registered later: show it */ }
      const tools = [
        {
          name: 'ncm-inbox',
          title: game.i18n.localize('NCM.SceneControls.OpenInbox'),
          icon: 'fas fa-envelope',
          button: true,
          onClick: () => game.nightcity.openNCM?.(),
        },
        ...(callsOn ? [{
          name: 'ncm-phone',
          title: game.i18n.localize('NCM.SceneControls.Phone'),
          icon: 'fas fa-phone',
          button: true,
          onClick: () => game.nightcity.openPhone?.(),
        }] : []),
        {
          name: 'ncm-compose',
          title: game.i18n.localize('NCM.SceneControls.ComposeMessage'),
          icon: 'fas fa-pen-to-square',
          button: true,
          onClick: () => game.nightcity.composeMessage?.(),
        },
        {
          name: 'ncm-contacts',
          title: game.i18n.localize('NCM.SceneControls.Contacts'),
          icon: 'fas fa-address-book',
          button: true,
          onClick: () => game.nightcity.openContacts?.(),
        },
      ];

      // GM-only tools
      if (isGM()) {
        tools.push(
          {
            name: 'ncm-networks',
            title: game.i18n.localize('NCM.SceneControls.NetworkManagement'),
            icon: 'fas fa-network-wired',
            button: true,
            onClick: () => game.nightcity.openNetworkManagement?.(),
          },
          {
            name: 'ncm-admin',
            title: game.i18n.localize('NCM.SceneControls.AdminPanel'),
            icon: 'fas fa-terminal',
            button: true,
            onClick: () => game.nightcity.openAdmin?.(),
          },
        );
      }

      controls.push({
        name: MODULE_ID,
        title: MODULE_TITLE,
        icon: 'fas fa-satellite-dish',
        layer: groupLayer,
        tools,
      });
    });

    log.info('Scene controls registered');
  });

  // ─── UI Launch Functions (stubs for Phase 1) ───
  initializer.register('ready', 110, 'UI launch functions', () => {
    const ns = game.nightcity;

    // Stubs — replaced by actual Application classes in Phase 2+
    ns.openNCM = () => {
      ncmNotify.info('Night City Messenger: Character Select (Phase 2)');
    };
    ns.openInbox = (actorId) => {
      ncmNotify.info(`Night City Messenger: Inbox (Phase 2) — actorId: ${actorId ?? 'self'}`);
    };
    ns.composeMessage = (data) => {
      ncmNotify.info('Night City Messenger: Composer (Phase 2)');
    };
    ns.openContacts = (actorId) => {
      ncmNotify.info('Night City Messenger: Contacts (Phase 2)');
    };
    ns.openAdmin = () => {
      if (!game.user.isGM) return ncmNotify.warn('GM only');
      ncmNotify.info('Night City Messenger: Admin Panel (Phase 5)');
    };
    ns.openDataShard = (item) => {
      ncmNotify.info('Night City Messenger: Data Shard (Phase 4)');
    };
    ns.openNetworkManagement = () => {
      if (!game.user.isGM) return ncmNotify.warn('GM only');
      ncmNotify.info('Night City Messenger: Network Management (Phase 3)');
    };
    ns.openThemeCustomizer = () => {
      ncmNotify.info('Night City Messenger: Theme Customizer (Phase 5)');
    };

    log.info('UI launch stubs registered');
  });
}
