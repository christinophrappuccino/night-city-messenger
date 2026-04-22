/**
 * Chat Integration
 * @file scripts/integrations/ChatIntegration.js
 * @module cyberpunkred-messenger
 * @description Handles chat card rendering, delegated event binding on #chat-log,
 * and message sharing to Foundry chat.
 */

import { MODULE_ID } from '../utils/constants.js';
import { log } from '../utils/helpers.js';

export class ChatIntegration {

  /**
   * Register chat integration hooks. Called once during init phase.
   */
  static register() {
    // Delegated event binding — register once when chat log renders
    Hooks.once('renderChatLog', (app, html) => {
      const chatLog = html[0] || html;

      chatLog.addEventListener('click', (e) => {
        // Handle "View in Inbox" button on shared message cards
        const viewBtn = e.target.closest('[data-action="ncm-view-message"]');
        if (viewBtn) {
          e.preventDefault();
          const { actorId, messageId } = viewBtn.dataset;
          game.nightcity.openInbox?.(actorId, messageId);
          return;
        }

        // Handle "Reply" button on chat cards
        const replyBtn = e.target.closest('[data-action="ncm-reply"]');
        if (replyBtn) {
          e.preventDefault();
          const { fromActorId, messageId } = replyBtn.dataset;
          game.nightcity.composeMessage?.({ replyTo: messageId, toActorId: fromActorId });
          return;
        }
      });
    });

    // Style chat messages from this module
    Hooks.on('renderChatMessage', (message, html) => {
      const flags = message.flags?.[MODULE_ID];
      if (!flags) return;

      const el = html[0] || html;
      el.classList.add('ncm-chat-card');

      if (flags.type === 'shared-message') {
        el.classList.add('ncm-chat-card--message');
      }
    });

    log.info('ChatIntegration registered');
  }
}
