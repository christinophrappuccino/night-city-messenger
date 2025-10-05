/**
 * Message Detail Component
 * File: scripts/ui/components/MessageViewer/MessageDetail.js
 * Module: cyberpunkred-messenger
 * Description: Handles message detail view and actions
 */

import { MODULE_ID } from '../../../utils/constants.js';
import { EVENTS } from '../../../core/EventBus.js';

export class MessageDetail {
  constructor(parent) {
    this.parent = parent;
    this.eventBus = parent.eventBus;
    this.stateManager = parent.stateManager;
    
    // Subscribe to message selection
    this.parent.subscribe('message:selected', (data) => {
      this.render(data.messageId);
    });
  }
  
  /**
   * Get the currently selected message
   * @returns {Object|null}
   */
  getCurrentMessage() {
    const messageId = this.stateManager.get('selectedMessageId');
    if (!messageId) return null;
    
    return this.stateManager.get('messages').get(messageId);
  }
  
  /**
   * Render the message detail
   * @param {string} messageId - Message ID
   */
  render(messageId) {
    const $element = this.parent._element;
    if (!$element) return;
    
    const message = this.stateManager.get('messages').get(messageId);
    if (!message) {
      this._renderEmpty();
      return;
    }
    
    const $detailContainer = $element.find('.ncm-viewer__detail');
    if (!$detailContainer.length) return;
    
    // The actual rendering is handled by Handlebars template
    // This just triggers parent re-render
    this.parent.render(false);
  }
  
  /**
   * Render empty state
   * @private
   */
  _renderEmpty() {
    const $element = this.parent._element;
    if (!$element) return;
    
    const $detailContainer = $element.find('.ncm-viewer__detail');
    $detailContainer.html(`
      <div class="ncm-detail-empty">
        <i class="fas fa-envelope fa-4x"></i>
        <p>Select a message to view content</p>
      </div>
    `);
  }
  
  /**
   * Save message
   */
  async saveMessage() {
    const message = this.getCurrentMessage();
    if (!message) return;
    
    try {
      const newStatus = !message.status?.saved;
      
      // Update state
      message.status = { ...message.status, saved: newStatus };
      
      // Update journal flag
      if (message.page) {
        await message.page.setFlag(MODULE_ID, 'status', message.status);
      }
      
      // Emit event
      this.eventBus.emit(EVENTS.MESSAGE_SAVED, { messageId: message.id, saved: newStatus });
      
      // Update UI
      this.parent.render(false);
      
      ui.notifications.info(newStatus ? 'Message saved' : 'Message unsaved');
    } catch (error) {
      console.error(`${MODULE_ID} | Error saving message:`, error);
      ui.notifications.error('Failed to save message');
    }
  }
  
  /**
   * Mark message as spam
   */
  async markAsSpam() {
    const message = this.getCurrentMessage();
    if (!message) return;
    
    try {
      const newStatus = !message.status?.spam;
      
      // Update state
      message.status = { ...message.status, spam: newStatus };
      
      // Update journal flag
      if (message.page) {
        await message.page.setFlag(MODULE_ID, 'status', message.status);
      }
      
      // Emit event
      this.eventBus.emit(EVENTS.MESSAGE_SPAM, { messageId: message.id, spam: newStatus });
      
      // Update UI
      this.parent.render(false);
      
      ui.notifications.info(newStatus ? 'Marked as spam' : 'Unmarked as spam');
    } catch (error) {
      console.error(`${MODULE_ID} | Error marking spam:`, error);
      ui.notifications.error('Failed to update spam status');
    }
  }
  
  /**
   * Delete message
   */
  async deleteMessage() {
    const message = this.getCurrentMessage();
    if (!message) return;
    
    // Confirm deletion
    const confirmed = await Dialog.confirm({
      title: 'Delete Message',
      content: '<p>Are you sure you want to delete this message?</p>',
      yes: () => true,
      no: () => false,
      defaultYes: false
    });
    
    if (!confirmed) return;
    
    try {
      // Remove from state
      this.stateManager.removeMessage(message.id);
      
      // Delete journal page
      if (message.page) {
        await message.page.delete();
      }
      
      // Clear selection
      this.stateManager.set('selectedMessageId', null);
      
      // Update UI
      this.parent.render(false);
      
      ui.notifications.info('Message deleted');
    } catch (error) {
      console.error(`${MODULE_ID} | Error deleting message:`, error);
      ui.notifications.error('Failed to delete message');
    }
  }
  
  /**
   * Reply to message
   */
  replyToMessage() {
    const message = this.getCurrentMessage();
    if (!message) return;
    
    // Emit event to open composer
    this.eventBus.emit('composer:open', {
      mode: 'reply',
      originalMessage: message,
      to: message.from,
      subject: `Re: ${message.subject}`
    });
  }
  
  /**
   * Forward message
   */
  forwardMessage() {
    const message = this.getCurrentMessage();
    if (!message) return;
    
    // Emit event to open composer
    this.eventBus.emit('composer:open', {
      mode: 'forward',
      originalMessage: message,
      subject: `Fwd: ${message.subject}`,
      content: message.content
    });
  }
  
  /**
   * Share message to chat
   */
  async shareToChat() {
    const message = this.getCurrentMessage();
    if (!message) return;
    
    try {
      // Import the shared message function
      const { shareMessageFromViewer } = await import('../../../utils/shared-message.js');
      
      await shareMessageFromViewer(message.page.parent.id, message.id);
      
      ui.notifications.info('Message shared to chat');
    } catch (error) {
      console.error(`${MODULE_ID} | Error sharing message:`, error);
      ui.notifications.error('Failed to share message to chat');
    }
  }
  
  /**
   * Activate event listeners
   * @param {jQuery} html - The application HTML
   */
  activateListeners(html) {
    // Action buttons
    html.find('.ncm-action-save').on('click', () => {
      this.saveMessage();
      this.parent.playSound('click');
    });
    
    html.find('.ncm-action-spam').on('click', () => {
      this.markAsSpam();
      this.parent.playSound('click');
    });
    
    html.find('.ncm-action-delete').on('click', () => {
      this.deleteMessage();
      this.parent.playSound('click');
    });
    
    html.find('.ncm-action-reply').on('click', () => {
      this.replyToMessage();
      this.parent.playSound('click');
    });
    
    html.find('.ncm-action-forward').on('click', () => {
      this.forwardMessage();
      this.parent.playSound('click');
    });
    
    html.find('.ncm-action-share').on('click', () => {
      this.shareToChat();
      this.parent.playSound('click');
    });
  }
  
  /**
   * Cleanup
   */
  destroy() {
    // Cleanup if needed
  }
}