/**
 * Register Integrations
 * @file scripts/init/registerIntegrations.js
 * @module cyberpunkred-messenger
 * @description Chat integration, item sheet hooks, email field hooks.
 */

import { log } from '../utils/helpers.js';

export function registerIntegrations(initializer) {
  initializer.register('init', 30, 'Chat integration', () => {
    // Delegated event listener on chat log for NCM chat cards
    Hooks.once('renderChatLog', (app, html) => {
      const chatLog = html[0] ?? html;
      chatLog.addEventListener('click', (e) => {
        const action = e.target.closest('[data-ncm-action]');
        if (!action) return;

        const actionName = action.dataset.ncmAction;
        log.debug(`Chat card action: ${actionName}`);
        // Phase 2: route to appropriate handler
      });
    });
    log.info('Chat integration registered');
  });
}
