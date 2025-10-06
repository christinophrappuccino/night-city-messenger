/**
 * Chat Integration
 * File: scripts/integrations/ChatIntegration.js
 * Module: cyberpunkred-messenger
 * Description: Integrate messenger with Foundry's chat system
 */

import { MODULE_ID } from '../utils/constants.js';
import { EventBus, EVENTS } from '../core/EventBus.js';

/**
 * Register chat integration hooks
 */
export function registerChatIntegration() {
  console.log(`${MODULE_ID} | Registering chat integration...`);
  
  const eventBus = EventBus.getInstance();
  
  // Hook: Render chat message
  Hooks.on('renderChatMessage', (message, html, data) => {
    _handleRenderChatMessage(message, html, data);
  });
  
  // Hook: Get chat log context menu options
  Hooks.on('getChatLogEntryContext', (html, options) => {
    _addChatContextOptions(html, options);
  });
  
  // Listen for share-to-chat events from the messenger
  eventBus.on(EVENTS.MESSAGE_SHARED, (data) => {
    _createSharedMessageChatCard(data);
  });
  
  console.log(`${MODULE_ID} | ✓ Chat integration registered`);
}

/**
 * Handle rendering of chat messages
 * @private
 */
function _handleRenderChatMessage(message, html, data) {
  // Check if this is a messenger chat card
  const messageType = message.getFlag(MODULE_ID, 'type');
  
  if (!messageType) return;
  
  // Add our styling class
  html.addClass('ncm-chat-message');
  
  // Handle different message types
  switch (messageType) {
    case 'shared-message':
      _enhanceSharedMessage(html, message);
      break;
    case 'hack-result':
      _enhanceHackResult(html, message);
      break;
    case 'notification':
      _enhanceNotification(html, message);
      break;
  }
}

/**
 * Enhance shared message display
 * @private
 */
function _enhanceSharedMessage(html, message) {
  // Add reply button if can reply
  const canReply = message.getFlag(MODULE_ID, 'canReply');
  
  if (canReply && game.user.id !== message.user.id) {
    const footer = html.find('.message-content');
    const replyBtn = $(`
      <button class="ncm-chat-reply" data-message-id="${message.id}">
        <i class="fas fa-reply"></i> Reply
      </button>
    `);
    
    replyBtn.on('click', (event) => {
      event.preventDefault();
      _handleChatReply(message);
    });
    
    footer.append(replyBtn);
  }
}

/**
 * Enhance hack result display
 * @private
 */
function _enhanceHackResult(html, message) {
  const success = message.getFlag(MODULE_ID, 'success');
  
  // Add visual styling based on success/failure
  if (success) {
    html.addClass('ncm-hack-success');
  } else {
    html.addClass('ncm-hack-failure');
  }
}

/**
 * Enhance notification display
 * @private
 */
function _enhanceNotification(html, message) {
  const notificationType = message.getFlag(MODULE_ID, 'notificationType');
  
  // Add type-specific class
  html.addClass(`ncm-notification-${notificationType}`);
}

/**
 * Add context menu options to chat messages
 * @private
 */
function _addChatContextOptions(html, options) {
  // Only add for messages that support it
  options.push({
    name: "Forward to Messenger",
    icon: '<i class="fas fa-share"></i>',
    condition: li => {
      const message = game.messages.get(li.data("messageId"));
      return message && message.content && !message.getFlag(MODULE_ID, 'type');
    },
    callback: li => {
      const message = game.messages.get(li.data("messageId"));
      _forwardToMessenger(message);
    }
  });
}

/**
 * Handle reply button click
 * @private
 */
async function _handleChatReply(message) {
  const originalFrom = message.getFlag(MODULE_ID, 'from');
  const originalSubject = message.getFlag(MODULE_ID, 'subject');
  
  if (!originalFrom) {
    ui.notifications.warn('Cannot reply to this message');
    return;
  }
  
  // Open composer with reply data
  const { MessageComposerApp } = await import('../ui/components/MessageComposer/MessageComposerApp.js');
  
  const composer = new MessageComposerApp({
    mode: 'reply',
    to: originalFrom,
    subject: `Re: ${originalSubject}`,
    originalMessage: message
  });
  
  composer.render(true);
}

/**
 * Forward chat message to messenger
 * @private
 */
async function _forwardToMessenger(chatMessage) {
  try {
    const { MessageComposerApp } = await import('../ui/components/MessageComposer/MessageComposerApp.js');
    
    // Extract content
    let content = chatMessage.content;
    
    // Strip HTML if needed
    const temp = document.createElement('div');
    temp.innerHTML = content;
    content = temp.textContent || temp.innerText || '';
    
    // Open composer with forwarded content
    const composer = new MessageComposerApp({
      mode: 'forward',
      subject: `Fwd: Chat from ${chatMessage.user.name}`,
      content: `\n\n--- Forwarded from chat ---\n${content}\n--- End forwarded content ---`
    });
    
    composer.render(true);
  } catch (error) {
    console.error(`${MODULE_ID} | Error forwarding to messenger:`, error);
    ui.notifications.error('Failed to forward message');
  }
}

/**
 * Create a chat card for a shared message
 * @private
 */
async function _createSharedMessageChatCard(data) {
  // FIXED: Handle different property names (content vs body)
  const { from, subject, recipient } = data;
  const content = data.content || data.body || '';
  
  // Safety check - ensure content is a string
  const safeContent = String(content || '');
  
  // Create chat message content
  const chatContent = `
    <div class="ncm-chat-card">
      <div class="ncm-chat-card__header">
        <i class="fas fa-envelope ncm-chat-card__icon"></i>
        <strong class="ncm-chat-card__title">Shared Message</strong>
      </div>
      <div class="ncm-chat-card__content">
        <p><strong>From:</strong> ${from || 'Unknown'}</p>
        <p><strong>Subject:</strong> ${subject || 'No Subject'}</p>
        <hr>
        <div class="ncm-chat-card__message">${safeContent.substring(0, 200)}${safeContent.length > 200 ? '...' : ''}</div>
      </div>
      ${recipient ? `<div class="ncm-chat-card__footer"><small>Shared with: ${recipient}</small></div>` : ''}
    </div>
  `;
  
  // Create the chat message
  await ChatMessage.create({
    content: chatContent,
    speaker: ChatMessage.getSpeaker(),
    flags: {
      [MODULE_ID]: {
        type: 'shared-message',
        canReply: true,
        from: from,
        subject: subject
      }
    }
  });
}

/**
 * Create hack result chat card
 * @param {Object} data - Hack result data
 */
export async function createHackResultChatCard(data) {
  const { actor, target, success, roll, damage } = data;
  
  const content = `
    <div class="ncm-chat-card ncm-hack-result">
      <div class="ncm-chat-card__header">
        <i class="fas fa-terminal ncm-chat-card__icon"></i>
        <strong class="ncm-chat-card__title">Hack Attempt</strong>
      </div>
      <div class="ncm-chat-card__content">
        <p><strong>Netrunner:</strong> ${actor.name}</p>
        <p><strong>Target:</strong> ${target.name}</p>
        <p><strong>Result:</strong> <span class="${success ? 'success' : 'failure'}">${success ? 'SUCCESS' : 'FAILURE'}</span></p>
        ${roll ? `<p><strong>Roll:</strong> ${roll.total}</p>` : ''}
        ${damage ? `<p><strong>BLACK ICE Damage:</strong> ${damage.total}</p>` : ''}
      </div>
    </div>
  `;
  
  await ChatMessage.create({
    content: content,
    speaker: ChatMessage.getSpeaker({ actor }),
    type: CONST.CHAT_MESSAGE_TYPES.OTHER,
    flags: {
      [MODULE_ID]: {
        type: 'hack-result',
        success: success
      }
    }
  });
}

/**
 * Create notification chat card
 * @param {Object} data - Notification data
 */
export async function createNotificationChatCard(data) {
  const { title, message, type = 'info' } = data;
  
  const icons = {
    info: 'fa-info-circle',
    success: 'fa-check-circle',
    warning: 'fa-exclamation-triangle',
    error: 'fa-times-circle'
  };
  
  const content = `
    <div class="ncm-chat-card ncm-notification ncm-notification-${type}">
      <div class="ncm-chat-card__header">
        <i class="fas ${icons[type]} ncm-chat-card__icon"></i>
        <strong class="ncm-chat-card__title">${title}</strong>
      </div>
      <div class="ncm-chat-card__content">
        <p>${message}</p>
      </div>
    </div>
  `;
  
  await ChatMessage.create({
    content: content,
    speaker: ChatMessage.getSpeaker(),
    flags: {
      [MODULE_ID]: {
        type: 'notification',
        notificationType: type
      }
    }
  });
}