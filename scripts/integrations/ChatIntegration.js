/**
 * Chat Integration
 * @file scripts/integrations/ChatIntegration.js
 * @module night-city-messenger
 * @description Handles chat card rendering, delegated event binding on #chat-log,
 * and message sharing to Foundry chat.
 */

import { MODULE_ID } from '../utils/constants.js';
import { log } from '../utils/helpers.js';
import { onRenderChatMessage } from '../utils/compat.js';

export class ChatIntegration {

  /**
   * Register chat integration hooks. Called once during init phase.
   */
  static register() {
    // Delegated event binding on EVERY chat log — the sidebar's and a popped-out one (audit COMPAT-10: `once` bound
    // only the first, so the card buttons were dead in a pop-out). Each element is bound once.
    const bound = new WeakSet();
    Hooks.on('renderChatLog', (app, html) => {
      const chatLog = html[0] || html;
      if (!chatLog?.addEventListener || bound.has(chatLog)) return;
      bound.add(chatLog);

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
    // renderChatMessageHTML on v13, renderChatMessage on v12 — an element either way (utils/compat.js)
    onRenderChatMessage((message, el) => {
      const flags = message.flags?.[MODULE_ID];
      if (!flags || !el) return;

      el.classList.add('ncm-chat-card');

      if (flags.type === 'shared-message') {
        el.classList.add('ncm-chat-card--message');
      }
    });

    log.info('ChatIntegration registered');
  }
}
