/**
 * Register Integrations
 * @file scripts/init/registerIntegrations.js
 * @module cyberpunkred-messenger
 * @description Chat integration, item sheet hooks, email field hooks.
 */

import { log } from '../utils/helpers.js';
import { ChatIntegration } from '../integrations/ChatIntegration.js';

export function registerIntegrations(initializer) {
  initializer.register('init', 30, 'Chat integration', () => {
    ChatIntegration.register();
    log.info('Chat integration registered');
  });

  // Phase 5: Item sheet hooks for email field on actor sheets
  initializer.register('init', 40, 'Item sheet hooks', () => {
    // Phase 5: EmailSettingsIntegration
    log.debug('Item sheet hooks (Phase 5 — stub)');
  });
}
