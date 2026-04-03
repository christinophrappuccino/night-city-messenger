/**
 * Register UI Components
 * @file scripts/init/registerUIComponents.js
 * @module cyberpunkred-messenger
 * @description Registers scene controls, token HUD buttons, and UI launch functions.
 */

import { MODULE_ID, MODULE_TITLE } from '../utils/constants.js';
import { log, isGM } from '../utils/helpers.js';

export function registerUIComponents(initializer) {
  initializer.register('init', 20, 'Scene controls', () => {
    Hooks.on('getSceneControlButtons', (controls) => {
      if (!game.nightcity) return;

      const tools = [
        {
          name: 'ncm-inbox',
          title: game.i18n.localize('NCM.SceneControls.OpenInbox'),
          icon: 'fas fa-envelope',
          button: true,
          onClick: () => game.nightcity.openNCM?.(),
        },
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
        layer: 'controls',
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
      ui.notifications.info('Night City Messenger: Character Select (Phase 2)');
    };
    ns.openInbox = (actorId) => {
      ui.notifications.info(`Night City Messenger: Inbox (Phase 2) — actorId: ${actorId ?? 'self'}`);
    };
    ns.composeMessage = (data) => {
      ui.notifications.info('Night City Messenger: Composer (Phase 2)');
    };
    ns.openContacts = (actorId) => {
      ui.notifications.info('Night City Messenger: Contacts (Phase 2)');
    };
    ns.openAdmin = () => {
      if (!game.user.isGM) return ui.notifications.warn('GM only');
      ui.notifications.info('Night City Messenger: Admin Panel (Phase 5)');
    };
    ns.openDataShard = (item) => {
      ui.notifications.info('Night City Messenger: Data Shard (Phase 4)');
    };
    ns.openNetworkManagement = () => {
      if (!game.user.isGM) return ui.notifications.warn('GM only');
      ui.notifications.info('Night City Messenger: Network Management (Phase 3)');
    };
    ns.openThemeCustomizer = () => {
      ui.notifications.info('Night City Messenger: Theme Customizer (Phase 5)');
    };

    log.info('UI launch stubs registered');
  });
}
