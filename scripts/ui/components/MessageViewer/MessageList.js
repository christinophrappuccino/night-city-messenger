/**
 * Message List Component - FIXED
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
   * @returns {Object} { messages, currentPage, totalPages, totalMessages }
   */
  getPaginatedMessages() {
    // ✅ FIXED: this.app -> this.parent
    const currentFilter = this.parent.stateManager.get('currentFilter') || 'inbox';
    const searchTerm = this.parent.stateManager.get('searchTerm') || '';
    const currentPage = this.parent.stateManager.get('currentPage') || 1;
    const messagesPerPage = this.parent.stateManager.get('messagesPerPage') || 20;
    
    // Get filtered messages
    let filtered = this._getFilteredMessages(currentFilter);
    
    // Apply search
    if (searchTerm) {
      filtered = this._searchMessages(filtered, searchTerm);
    }
    
    // Apply advanced filters
    filtered = this._applyAdvancedFilters(filtered);
    
    // Sort by date (newest first)
    filtered.sort((a, b) => {
      const dateA = new Date(a.timestamp || 0);
      const dateB = new Date(b.timestamp || 0);
      return dateB - dateA;
    });
    
    // Calculate pagination
    const totalMessages = filtered.length;
    const totalPages = Math.ceil(totalMessages / messagesPerPage);
    const startIndex = (currentPage - 1) * messagesPerPage;
    const endIndex = startIndex + messagesPerPage;
    
    // Get page of messages
    const messages = filtered.slice(startIndex, endIndex);
    
    return {
      messages,
      currentPage,
      totalPages,
      totalMessages
    };
  }
  
  /**
   * Get filtered messages by category
   * ✅ NEW: Missing method that was referenced
   * @private
   */
  _getFilteredMessages(filter) {
    const allMessages = this.stateManager.getAllMessages() || [];
    
    switch (filter) {
      case 'inbox':
        // Inbox = NOT sent by me, NOT spam, NOT deleted
        return allMessages.filter(m => 
          !m.status?.sent && 
          !m.status?.spam && 
          !m.status?.deleted
        );
      
      case 'unread':
        // Unread inbox messages
        return allMessages.filter(m => 
          !m.status?.read && 
          !m.status?.sent && 
          !m.status?.spam && 
          !m.status?.deleted
        );
      
      case 'sent':
        // Messages I sent - has sent flag = true
        return allMessages.filter(m => 
          m.status?.sent && 
          !m.status?.deleted
        );
      
      case 'saved':
        return allMessages.filter(m => 
          m.status?.saved && 
          !m.status?.deleted
        );
      
      case 'spam':
        return allMessages.filter(m => 
          m.status?.spam && 
          !m.status?.deleted
        );
      
      case 'scheduled':
        return allMessages.filter(m => m.status?.scheduled);
      
      case 'deleted':
        return allMessages.filter(m => 
          m.status?.deleted
        );
      
      case 'all':
      default:
        return allMessages.filter(m => 
          !m.status?.deleted
        );
    }
  }
  
  /**
   * Search messages by term
   * ✅ NEW: Missing method that was referenced
   * @private
   */
  _searchMessages(messages, searchTerm) {
    if (!searchTerm || searchTerm.trim() === '') {
      return messages;
    }
    
    const term = searchTerm.toLowerCase().trim();
    
    return messages.filter(m => {
      // Search in from
      if (m.from?.toLowerCase().includes(term)) return true;
      
      // Search in to
      if (m.to?.toLowerCase().includes(term)) return true;
      
      // Search in subject
      if (m.subject?.toLowerCase().includes(term)) return true;
      
      // Search in body
      if (m.body?.toLowerCase().includes(term)) return true;
      
      // Search in preview
      if (m.preview?.toLowerCase().includes(term)) return true;
      
      return false;
    });
  }
  
  /**
   * Get filtered messages based on advanced filters
   * @private
   */
  _applyAdvancedFilters(messages) {
    // ✅ FIXED: this.app -> this.parent
    const filters = this.parent.stateManager.get('advancedFilters') || {};
    
    let filtered = [...messages];
    
    // Filter by sender
    if (filters.sender) {
      filtered = filtered.filter(m => m.from === filters.sender);
    }
    
    // Filter by date range
    if (filters.dateFrom) {
      const fromDate = new Date(filters.dateFrom);
      filtered = filtered.filter(m => new Date(m.timestamp) >= fromDate);
    }
    
    if (filters.dateTo) {
      const toDate = new Date(filters.dateTo);
      toDate.setHours(23, 59, 59, 999); // End of day
      filtered = filtered.filter(m => new Date(m.timestamp) <= toDate);
    }
    
    // Filter by unread only
    if (filters.unreadOnly) {
      filtered = filtered.filter(m => !m.status?.read);
    }
    
    return filtered;
  }
  
  /**
   * Select a message
   * @param {string} messageId - Message ID
   */
  async selectMessage(messageId) {
    this.selectedMessageId = messageId;
    this.stateManager.set('selectedMessageId', messageId);
    
    // Mark as read
    const messages = this.stateManager.get('messages');
    const message = messages instanceof Map ? messages.get(messageId) : messages.find(m => m.id === messageId);
    
    if (message && !message.status?.read) {
      await this.markAsRead(messageId);
    }
    
    // Update UI
    this._updateSelectedUI();
    
    // Emit event
    this.eventBus.emit('message:selected', { messageId });
  }
  
  /**
   * Mark message as read
   * ✅ NEW: Extracted for reusability
   * @param {string} messageId
   */
  async markAsRead(messageId) {
    // Update state
    this.stateManager.markAsRead(messageId);
    
    // Persist read status
    await this._persistReadStatus(messageId);
    
    // Emit event
    this.eventBus.emit(EVENTS.MESSAGE_READ, { messageId });
  }
  
  /**
   * Toggle saved status
   * ✅ NEW: For save button
   * @param {string} messageId
   */
  async toggleSaved(messageId) {
    const messages = this.stateManager.get('messages');
    const message = messages instanceof Map ? messages.get(messageId) : messages.find(m => m.id === messageId);
    
    if (!message) return;
    
    const isSaved = message.status?.saved || false;
    
    // Update state
    this.stateManager.updateMessageStatus(messageId, { saved: !isSaved });
    
    // Persist to journal
    if (message.page) {
      await message.page.setFlag(MODULE_ID, 'status', {
        ...message.status,
        saved: !isSaved
      });
    }
    
    // Emit event
    this.eventBus.emit(EVENTS.MESSAGE_UPDATED, { messageId });
  }
  
  /**
   * Toggle spam status
   * ✅ NEW: For spam button
   * @param {string} messageId
   */
  async toggleSpam(messageId) {
    const messages = this.stateManager.get('messages');
    const message = messages instanceof Map ? messages.get(messageId) : messages.find(m => m.id === messageId);
    
    if (!message) return;
    
    const isSpam = message.status?.spam || false;
    
    // Update state
    this.stateManager.updateMessageStatus(messageId, { spam: !isSpam });
    
    // Persist to journal
    if (message.page) {
      await message.page.setFlag(MODULE_ID, 'status', {
        ...message.status,
        spam: !isSpam
      });
    }
    
    // Emit event
    this.eventBus.emit(EVENTS.MESSAGE_UPDATED, { messageId });
  }
  
  /**
   * Delete message
   * ✅ NEW: For delete button
   * @param {string} messageId
   */
  async deleteMessage(messageId, permanent = false) {
    const messages = this.stateManager.get('messages');
    const message = messages instanceof Map ? 
      messages.get(messageId) : messages.find(m => m.id === messageId);
    
    if (!message || !message.page) return;
    
    try {
      if (permanent && game.user.isGM) {
        // ✅ GM ONLY: Permanent deletion
        const confirm = await Dialog.confirm({
          title: "Permanently Delete Message",
          content: `
            <p style="color: var(--ncm-primary, #F65261);">
              <i class="fas fa-exclamation-triangle"></i> 
              <strong>Warning: This cannot be undone!</strong>
            </p>
            <p>Permanently delete this message from the database?</p>
            <p style="font-size: 0.9em; opacity: 0.7;">
              Only use this for testing or removing corrupt data.
            </p>
          `
        });
        
        if (!confirm) return;
        
        // Actually delete the journal page
        await message.page.delete();
        this.stateManager.removeMessage(messageId);
        
        ui.notifications.info('Message permanently deleted');
      } else {
        // ✅ DEFAULT: Soft delete (mark as deleted)
        this.stateManager.updateMessageStatus(messageId, { deleted: true });
        
        // Persist to journal
        await message.page.setFlag(MODULE_ID, 'status', {
          ...message.status,
          deleted: true,
          deletedAt: new Date().toISOString(),
          deletedBy: game.user.id
        });
        
        ui.notifications.info('Message moved to trash');
      }
      
      // Emit event
      this.eventBus.emit(EVENTS.MESSAGE_DELETED, { messageId });
      
    } catch (error) {
      console.error(`${MODULE_ID} | Error deleting message:`, error);
      ui.notifications.error('Failed to delete message');
      throw error;
    }
  }
  
  /**
   * Restore deleted message
   * ✅ NEW: Restore from trash
   */
  async restoreMessage(messageId) {
    const messages = this.stateManager.get('messages');
    const message = messages instanceof Map ? 
      messages.get(messageId) : messages.find(m => m.id === messageId);
    
    if (!message || !message.page) return;
    
    try {
      // Update state
      this.stateManager.updateMessageStatus(messageId, { deleted: false });
      
      // Persist to journal
      await message.page.setFlag(MODULE_ID, 'status', {
        ...message.status,
        deleted: false,
        restoredAt: new Date().toISOString(),
        restoredBy: game.user.id
      });
      
      ui.notifications.info('Message restored');
      
      // Emit event
      this.eventBus.emit(EVENTS.MESSAGE_UPDATED, { messageId });
      
    } catch (error) {
      console.error(`${MODULE_ID} | Error restoring message:`, error);
      ui.notifications.error('Failed to restore message');
      throw error;
    }
  }
  
  /**
   * Empty trash (GM only)
   * ✅ NEW: Permanently delete all trashed messages
   */
  async emptyTrash() {
    if (!game.user.isGM) {
      ui.notifications.warn('Only GMs can empty the trash');
      return;
    }
    
    const deletedMessages = this.stateManager.getAllMessages()
      .filter(m => m.status?.deleted);
    
    if (deletedMessages.length === 0) {
      ui.notifications.info('Trash is already empty');
      return;
    }
    
    const confirm = await Dialog.confirm({
      title: "Empty Trash",
      content: `
        <p style="color: var(--ncm-primary, #F65261);">
          <i class="fas fa-exclamation-triangle"></i> 
          <strong>Warning: This cannot be undone!</strong>
        </p>
        <p>Permanently delete <strong>${deletedMessages.length}</strong> message(s) from trash?</p>
      `
    });
    
    if (!confirm) return;
    
    try {
      for (const message of deletedMessages) {
        if (message.page) {
          await message.page.delete();
          this.stateManager.removeMessage(message.id);
        }
      }
      
      ui.notifications.info(`Emptied trash: ${deletedMessages.length} messages permanently deleted`);
      
    } catch (error) {
      console.error(`${MODULE_ID} | Error emptying trash:`, error);
      ui.notifications.error('Failed to empty trash');
    }
  }
  
  /**
   * Update selected message UI
   * @private
   */
  _updateSelectedUI() {
    const $element = this.parent.element;
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
    const $element = this.parent.element;
    if (!$element) return;
    
    const messages = this.stateManager.get('messages');
    
    $element.find('.ncm-message-item').each((index, item) => {
      const $item = $(item);
      const messageId = $item.data('message-id');
      const message = messages instanceof Map ? messages.get(messageId) : messages.find(m => m.id === messageId);
      
      if (message?.status?.read) {
        $item.removeClass('ncm-message-item--unread');
        $item.addClass('ncm-message-item--read');
      } else {
        $item.addClass('ncm-message-item--unread');
        $item.removeClass('ncm-message-item--read');
      }
    });
  }
  
  /**
   * Persist read status to localStorage and journal flags
   * @private
   */
  async _persistReadStatus(messageId) {
    const messages = this.stateManager.get('messages');
    const message = messages instanceof Map ? messages.get(messageId) : messages.find(m => m.id === messageId);
    
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
      if (this.parent.playSound) {
        this.parent.playSound('click');
      }
    });
    
    // Unread indicator click (mark as read/unread toggle)
    html.find('.ncm-message-item__unread-indicator').on('click', (event) => {
      event.stopPropagation();
      
      const messageId = $(event.currentTarget).closest('.ncm-message-item').data('message-id');
      const messages = this.stateManager.get('messages');
      const message = messages instanceof Map ? messages.get(messageId) : messages.find(m => m.id === messageId);
      
      if (message?.status?.read) {
        this.stateManager.markAsUnread(messageId);
      } else {
        this.markAsRead(messageId);
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