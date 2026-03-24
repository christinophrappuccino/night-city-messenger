/**
 * Register Data Shard System
 * @file scripts/init/registerDataShardSystem.js
 * @module cyberpunkred-messenger
 * @description Phase 4 initialization — wires SkillService, DataShardService,
 *              ItemInboxApp launch function, and ItemSheetIntegration hooks.
 *
 * Priority Map (ready phase):
 *   20  — SkillService       (no dependencies, needed by DataShardService)
 *   60  — DataShardService   (depends on EventBus, SocketManager, SecurityService, SkillService)
 *  112  — ItemInboxApp launch (depends on DataShardService, SkillService)
 *  115  — ItemSheetIntegration hooks (depends on DataShardService)
 */

import { MODULE_ID, EVENTS } from '../utils/constants.js';
import { log, isGM } from '../utils/helpers.js';
import { SkillService } from '../services/SkillService.js';
import { DataShardService } from '../services/DataShardService.js';
import { ItemSheetIntegration } from '../integrations/ItemSheetIntegration.js';
import { Phase4Verification } from '../tests/Phase4Verification.js';

/**
 * Register all Phase 4 data shard system components with the ModuleInitializer.
 * @param {import('../core/ModuleInitializer.js').ModuleInitializer} initializer
 */
export function registerDataShardSystem(initializer) {
  log.debug('Registering data shard system (Phase 4)');

  // ═══════════════════════════════════════════════════════════════
  //  SkillService — Priority 20 (ready)
  //  No service dependencies. Provides CPR skill checks for
  //  DataShardService hacking and network skill-based auth.
  // ═══════════════════════════════════════════════════════════════

  initializer.register('ready', 20, 'SkillService', () => {
    try {
      const skillService = new SkillService();
      game.nightcity.skillService = skillService;
      log.info('SkillService registered on game.nightcity');
    } catch (err) {
      log.error(`SkillService initialization failed: ${err.message}`);
      // Non-blocking — DataShardService will degrade gracefully
    }
  });

  // ═══════════════════════════════════════════════════════════════
  //  DataShardService — Priority 60 (ready)
  //  Depends on: EventBus (core/5), SocketManager (core/10),
  //              SecurityService (network/40), SkillService (shard/20)
  // ═══════════════════════════════════════════════════════════════

  initializer.register('ready', 60, 'DataShardService', () => {
    try {
      const dataShardService = new DataShardService();
      game.nightcity.dataShardService = dataShardService;
      log.info('DataShardService registered on game.nightcity');
    } catch (err) {
      log.error(`DataShardService initialization failed: ${err.message}`);
    }
  });

  // ═══════════════════════════════════════════════════════════════
  //  ItemInboxApp Launch Function — Priority 112 (ready)
  //  Registers game.nightcity.openDataShard() for macro API and
  //  direct programmatic access to the shard viewer.
  // ═══════════════════════════════════════════════════════════════

  initializer.register('ready', 112, 'openDataShard launch', async () => {
    try {
      // Lazy import to avoid loading UI classes during service init
      const { ItemInboxApp } = await import('../ui/ItemInbox/ItemInboxApp.js');

      /**
       * Open a data shard viewer for the given item.
       * @param {Item|string} itemOrId - Item document or item ID
       * @param {object} [options]
       * @param {Actor|string} [options.actor] - Actor or actor ID for context
       * @returns {ItemInboxApp|null}
       */
      game.nightcity.openDataShard = (itemOrId, options = {}) => {
        const dataShardService = game.nightcity?.dataShardService;
        if (!dataShardService) {
          ui.notifications.error('Night City Messenger: DataShardService not available');
          return null;
        }

        // Resolve item
        let item;
        if (typeof itemOrId === 'string') {
          // Try as UUID first, then as ID in all items
          item = fromUuidSync(itemOrId) ?? game.items.get(itemOrId);
          // Also check actor inventories
          if (!item) {
            for (const actor of game.actors) {
              item = actor.items.get(itemOrId);
              if (item) break;
            }
          }
        } else {
          item = itemOrId;
        }

        if (!item) {
          ui.notifications.warn('Night City Messenger: Item not found');
          return null;
        }

        if (!dataShardService.isDataShard(item)) {
          ui.notifications.warn(`"${item.name}" is not a data shard`);
          return null;
        }

        // Resolve actor
        let actor = options.actor;
        if (typeof actor === 'string') {
          actor = game.actors.get(actor);
        }
        if (!actor && !isGM()) {
          // Try to get the user's assigned character
          actor = game.user.character;
        }

        // Close any existing app for this item to ensure fresh boot sequence
        const existingId = `ncm-item-inbox-${item.id}`;
        const existing = Object.values(ui.windows).find(w => w.id === existingId);
        if (existing) {
          existing.close({ animate: false });
        }

        // Create and render the app
        const app = new ItemInboxApp({ item, actor });
        app.render(true);
        return app;
      };

      log.info('openDataShard() registered on game.nightcity');
    } catch (err) {
      log.error(`ItemInboxApp launch registration failed: ${err.message}`);
    }
  });

  // ═══════════════════════════════════════════════════════════════
  //  ItemSheetIntegration — Priority 115 (ready)
  //  Hooks into item sheet rendering to add "Data Shard" controls.
  //  Depends on DataShardService being available.
  // ═══════════════════════════════════════════════════════════════

  initializer.register('ready', 115, 'ItemSheetIntegration', async () => {
    try {
      const integration = new ItemSheetIntegration();
      integration.activate();
      game.nightcity._itemSheetIntegration = integration;
      log.info('ItemSheetIntegration hooks activated');
    } catch (err) {
      log.error(`ItemSheetIntegration failed: ${err.message}`);
    }
  });

  // ═══════════════════════════════════════════════════════════════
  //  Macro API Extensions — Priority 120 (ready)
  //  Adds shard-specific operations to game.nightcity.messenger
  // ═══════════════════════════════════════════════════════════════

  initializer.register('ready', 120, 'Shard macro API', async () => {
    try {
      const api = game.nightcity.messenger ?? {};

      /**
       * Convert an item to a data shard.
       * @param {Item|string} itemOrId
       * @param {object} [config] - Optional config overrides
       * @returns {Promise<Item>}
       */
      api.convertToDataShard = async (itemOrId, config = {}) => {
        const item = typeof itemOrId === 'string'
          ? (fromUuidSync(itemOrId) ?? game.items.get(itemOrId))
          : itemOrId;
        if (!item) throw new Error('Item not found');
        return game.nightcity.dataShardService.convertToDataShard(item, config);
      };

      /**
       * Attempt to hack a data shard.
       * @param {Item|string} itemOrId
       * @param {Actor|string} actorOrId
       * @param {string} skillName
       * @param {object} [options]
       * @returns {Promise<HackResult>}
       */
      api.hackShard = async (itemOrId, actorOrId, skillName, options = {}) => {
        const item = typeof itemOrId === 'string'
          ? (fromUuidSync(itemOrId) ?? game.items.get(itemOrId))
          : itemOrId;
        const actor = typeof actorOrId === 'string'
          ? game.actors.get(actorOrId)
          : actorOrId;
        if (!item) throw new Error('Item not found');
        if (!actor) throw new Error('Actor not found');
        return game.nightcity.dataShardService.attemptHack(item, actor, skillName, options);
      };

      /**
       * Force decrypt a shard (GM only).
       * @param {Item|string} itemOrId
       */
      api.forceDecryptShard = async (itemOrId) => {
        const item = typeof itemOrId === 'string'
          ? (fromUuidSync(itemOrId) ?? game.items.get(itemOrId))
          : itemOrId;
        if (!item) throw new Error('Item not found');
        return game.nightcity.dataShardService.forceDecrypt(item);
      };

      /**
       * Relock a shard (GM only).
       * @param {Item|string} itemOrId
       */
      api.relockShard = async (itemOrId) => {
        const item = typeof itemOrId === 'string'
          ? (fromUuidSync(itemOrId) ?? game.items.get(itemOrId))
          : itemOrId;
        if (!item) throw new Error('Item not found');
        return game.nightcity.dataShardService.relockShard(item);
      };

      /**
       * Add a message to a shard (GM only).
       * @param {Item|string} itemOrId
       * @param {object} messageData - { from, subject, body, timestamp, encrypted, encryptionDC }
       * @returns {Promise<string>} The message ID
       */
      api.addShardMessage = async (itemOrId, messageData) => {
        const item = typeof itemOrId === 'string'
          ? (fromUuidSync(itemOrId) ?? game.items.get(itemOrId))
          : itemOrId;
        if (!item) throw new Error('Item not found');
        return game.nightcity.dataShardService.addMessage(item, messageData);
      };

      // ─── Message Encryption API ──────────────────────

      /**
       * Attempt to decrypt an encrypted message via skill check.
       * @param {string} messageId
       * @param {string} actorId - The actor attempting decryption
       * @returns {Promise<{ success: boolean, roll?: object }>}
       */
      api.attemptDecrypt = async (messageId, actorId) => {
        return game.nightcity.messageService?.attemptDecrypt(messageId, actorId);
      };

      /**
       * GM force decrypt a message (bypasses skill check).
       * @param {string} messageId
       * @param {string} [actorId] - Inbox owner. If omitted, searches all inboxes.
       */
      api.forceDecrypt = async (messageId, actorId) => {
        return game.nightcity.messageService?.forceDecrypt(messageId, actorId);
      };

      /**
       * GM encrypt an existing message after send.
       * @param {string} actorId - Inbox owner
       * @param {string} messageId
       * @param {object} [encryption] - { type: 'ICE'|'BLACK_ICE', dc: number, skill: string }
       */
      api.encryptMessage = async (actorId, messageId, encryption) => {
        return game.nightcity.messageService?.encryptMessage(actorId, messageId, encryption);
      };

      game.nightcity.messenger = api;
      log.info('Shard macro API extensions registered');
    } catch (err) {
      log.error(`Shard macro API registration failed: ${err.message}`);
    }
  });

  // ═══════════════════════════════════════════════════════════════
  //  Phase 4 Verification — postReady/30
  // ═══════════════════════════════════════════════════════════════

  initializer.register('postReady', 31, 'Phase 4 verification', () => {
    game.nightcity.verifyPhase4 = () => Phase4Verification.run();

    try {
      if (game.settings.get(MODULE_ID, 'debugMode')) {
        Phase4Verification.run();
      }
    } catch {
      // Setting may not be registered
    }
  });
}
