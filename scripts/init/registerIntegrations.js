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
}
