/**
 * Message List Component
 * File: scripts/ui/components/MessageViewer/MessageList.js
 * Module: cyberpunkred-messenger
 * Description: Handles message list rendering and interaction
 */

import { MODULE_ID } from '../../../utils/constants.js';
import { EVENTS } from '../../../core/EventBus.js';

export class MessageList {
  constructor(parent) {
    this.parent = parent;
    this.eventBus = parent.eventBus;
    this.stateManager = parent.stateManager;
    
    this.selectedMessageId = null;
    
    // Subscribe to relevant state changes
    this._setupSubscriptions();
  }
  
  /**
   * Setup state subscriptions
   * @private
   */
  _setupSubscriptions() {
    // Re-render when messages change
    this.parent.subscribe(EVENTS.MESSAGE_RECEIVED, () => {
      this.parent.render(false);
    });
    
    this.parent.subscribe(EVENTS.MESSAGE_DELETED, () => {
      this.parent.render(false);
    });
    
    this.parent.subscribe(EVENTS.MESSAGE_READ, () => {
      this._updateMessageStatus();
    });
    
    // Re-render when filter changes
    this.parent.subscribeToState('currentFilter', () => {
      this.parent.render(false);
    });
    
    this.parent.subscribeToState('searchTerm', () => {
      this.parent.render(false);
    });
  }
  
  /**
   * Get filtered and sorted messages for current view
   * @returns {Array}
   */
  getMessages() {
    const messages = this.stateManager.getFilteredMessages();
    
    // Sort by date (newest first)
    return messages.sort((a, b) => {
      const dateA = new Date(a.timestamp || 0);
      const dateB = new Date(b.timestamp || 0);
      return dateB - dateA;
    });
  }
  
  /**
   * Get paginated messages
   * @returns {Object} { messages, currentPage, totalPages }
   */
  getPaginatedMessages() {
    const allMessages = this.getMessages();
    const pagination = this.stateManager.get('pagination');
    const { currentPage, itemsPerPage } = pagination;
    
    const totalPages = Math.ceil(allMessages.length / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    
    const messages = allMessages.slice(startIndex, endIndex);
    
    return {
      messages,
      currentPage,
      totalPages,
      totalCount: allMessages.length
    };
  }
  
  /**
   * Select a message
   * @param {string} messageId - Message ID
   */
  selectMessage(messageId) {
    this.selectedMessageId = messageId;
    this.stateManager.set('selectedMessageId', messageId);
    
    // Mark as read
    const message = this.stateManager.get('messages').get(messageId);
    if (message && !message.status?.read) {
      this.stateManager.markAsRead(messageId);
      
      // Persist read status
      this._persistReadStatus(messageId);
    }
    
    // Update UI
    this._updateSelectedUI();
    
    // Emit event
    this.eventBus.emit('message:selected', { messageId });
  }
  
  /**
   * Update selected message UI
   * @private
   */
  _updateSelectedUI() {
    const $element = this.parent._element;
    if (!$element) return;
    
    // Remove previous selection
    $element.find('.ncm-message-item').removeClass('ncm-message-item--selected');
    
    // Add selection to current
    if (this.selectedMessageId) {
      $element.find(`[data-message-id="${this.selectedMessageId}"]`)
        .addClass('ncm-message-item--selected');
    }
  }
  
  /**
   * Update message status in UI
   * @private
   */
  _updateMessageStatus() {
    const $element = this.parent._element;
    if (!$element) return;
    
    const unreadMessages = this.stateManager.get('unreadMessages');
    
    $element.find('.ncm-message-item').each((index, item) => {
      const $item = $(item);
      const messageId = $item.data('message-id');
      
      if (unreadMessages.has(messageId)) {
        $item.addClass('ncm-message-item--unread');
      } else {
        $item.removeClass('ncm-message-item--unread');
      }
    });
  }
  
  /**
   * Persist read status to localStorage and journal flags
   * @private
   */
  async _persistReadStatus(messageId) {
    const message = this.stateManager.get('messages').get(messageId);
    if (!message || !message.page) return;
    
    try {
      // Update journal page flag
      await message.page.setFlag(MODULE_ID, 'status', {
        ...message.status,
        read: true
      });
      
      // Update localStorage
      const journalId = message.page.parent.id;
      const readKey = `${MODULE_ID}-read-${journalId}-${messageId}`;
      localStorage.setItem(readKey, 'true');
    } catch (error) {
      console.error(`${MODULE_ID} | Error persisting read status:`, error);
    }
  }
  
  /**
   * Activate event listeners
   * @param {jQuery} html - The application HTML
   */
  activateListeners(html) {
    // Message item click
    html.find('.ncm-message-item').on('click', (event) => {
      const messageId = $(event.currentTarget).data('message-id');
      this.selectMessage(messageId);
      
      // Play click sound
      this.parent.playSound('click');
    });
    
    // Unread indicator click (mark as read/unread toggle)
    html.find('.ncm-message-item__unread-indicator').on('click', (event) => {
      event.stopPropagation();
      
      const messageId = $(event.currentTarget).closest('.ncm-message-item').data('message-id');
      const unreadMessages = this.stateManager.get('unreadMessages');
      
      if (unreadMessages.has(messageId)) {
        this.stateManager.markAsRead(messageId);
      } else {
        this.stateManager.markAsUnread(messageId);
      }
      
      this._updateMessageStatus();
    });
  }
  
  /**
   * Cleanup
   */
  destroy() {
    this.selectedMessageId = null;
  }
}