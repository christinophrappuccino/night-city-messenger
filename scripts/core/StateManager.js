/**
 * State Manager
 * File: scripts/core/StateManager.js
 * Module: cyberpunkred-messenger
 * Description: Centralized state management with reactive updates
 */

import { EventBus, EVENTS } from './EventBus.js';

export class StateManager {
  static instance = null;
  
  constructor() {
    if (StateManager.instance) {
      return StateManager.instance;
    }
    
    this.eventBus = EventBus.getInstance();
    
    // Initialize state
    this.state = {
      // Message data
      messages: new Map(),
      unreadMessages: new Set(),
      
      // UI state
      selectedMessageId: null,
      currentFilter: 'inbox',
      searchTerm: '',
      advancedFilters: null,
      
      // Pagination
      pagination: {
        currentPage: 1,
        itemsPerPage: 20,
        totalPages: 1
      },
      
      // Active viewers/composers
      activeViewers: new Set(),
      activeComposers: new Set(),
      
      // Network state
      currentNetwork: 'CITINET',
      signalStrength: 100,
      
      // Cache
      cache: {
        contacts: null,
        lastRefresh: null
      }
    };
    
    StateManager.instance = this;
  }
  
  /**
   * Get singleton instance
   * @returns {StateManager}
   */
  static getInstance() {
    if (!StateManager.instance) {
      StateManager.instance = new StateManager();
    }
    return StateManager.instance;
  }
  
  /**
   * Get a state value
   * @param {string} key - State key (supports dot notation)
   * @returns {*}
   */
  get(key) {
    return this._getNestedValue(this.state, key);
  }
  
  /**
   * Set a state value
   * @param {string} key - State key (supports dot notation)
   * @param {*} value - New value
   * @param {boolean} silent - Don't emit events if true
   */
  set(key, value, silent = false) {
    const oldValue = this.get(key);
    
    // Don't update if value hasn't changed
    if (oldValue === value) return;
    
    this._setNestedValue(this.state, key, value);
    
    if (!silent) {
      // Emit specific event
      this.eventBus.emit(`${EVENTS.STATE_CHANGED}:${key}`, {
        key,
        value,
        oldValue
      });
      
      // Emit general state changed event
      this.eventBus.emit(EVENTS.STATE_CHANGED, {
        key,
        value,
        oldValue
      });
    }
  }
  
  /**
   * Update multiple state values
   * @param {Object} updates - Key-value pairs to update
   * @param {boolean} silent - Don't emit events if true
   */
  update(updates, silent = false) {
    Object.entries(updates).forEach(([key, value]) => {
      this.set(key, value, silent);
    });
  }
  
  /**
   * Subscribe to state changes
   * @param {string} key - State key to watch
   * @param {Function} callback - Callback function
   * @returns {Function} Unsubscribe function
   */
  subscribe(key, callback) {
    return this.eventBus.on(`${EVENTS.STATE_CHANGED}:${key}`, callback);
  }
  
  /**
   * Subscribe to any state change
   * @param {Function} callback - Callback function
   * @returns {Function} Unsubscribe function
   */
  subscribeAll(callback) {
    return this.eventBus.on(EVENTS.STATE_CHANGED, callback);
  }
  
  /**
   * Reset state to defaults
   * @param {boolean} silent - Don't emit events if true
   */
  reset(silent = false) {
    const oldState = { ...this.state };
    
    this.state = {
      messages: new Map(),
      unreadMessages: new Set(),
      selectedMessageId: null,
      currentFilter: 'inbox',
      searchTerm: '',
      advancedFilters: null,
      pagination: {
        currentPage: 1,
        itemsPerPage: 20,
        totalPages: 1
      },
      activeViewers: new Set(),
      activeComposers: new Set(),
      currentNetwork: 'CITINET',
      signalStrength: 100,
      cache: {
        contacts: null,
        lastRefresh: null
      }
    };
    
    if (!silent) {
      this.eventBus.emit(EVENTS.STATE_CHANGED, {
        key: '__all__',
        value: this.state,
        oldValue: oldState
      });
    }
  }
  
  /**
   * Get entire state (for debugging)
   * @returns {Object}
   */
  getAll() {
    return { ...this.state };
  }
  
  // ========================================
  // Message-specific helpers
  // ========================================
  
  /**
   * Set all messages at once (replaces existing)
   * @param {Array} messages - Array of message objects
   */
  setMessages(messages) {
    this.state.messages.clear();
    this.state.unreadMessages.clear();
    
    messages.forEach(message => {
      this.state.messages.set(message.id, message);
      
      // Track unread messages
      if (!message.status?.read) {
        this.state.unreadMessages.add(message.id);
      }
    });
    
    this.eventBus.emit(EVENTS.MESSAGES_LOADED, messages);
  }
  
  /**
   * Add a message to state
   * @param {Object} message - Message object
   */
  addMessage(message) {
    this.state.messages.set(message.id, message);
    
    // Track unread
    if (!message.status?.read) {
      this.state.unreadMessages.add(message.id);
    }
    
    this.eventBus.emit(EVENTS.MESSAGE_RECEIVED, message);
  }
  
  /**
   * Remove a message from state
   * @param {string} messageId - Message ID
   */
  removeMessage(messageId) {
    const message = this.state.messages.get(messageId);
    this.state.messages.delete(messageId);
    this.state.unreadMessages.delete(messageId);
    
    if (message) {
      this.eventBus.emit(EVENTS.MESSAGE_DELETED, message);
    }
  }
  
  /**
   * Get message by ID
   * @param {string} messageId - Message ID
   * @returns {Object|null} Message object or null
   */
  getMessageById(messageId) {
    return this.state.messages.get(messageId) || null;
  }
  
  /**
   * Get all messages
   * @returns {Array} Array of all messages
   */
  getAllMessages() {
    return Array.from(this.state.messages.values());
  }
  
  /**
   * Get saved messages
   * @returns {Array}
   */
  getSavedMessages() {
    return this.getAllMessages().filter(m => m.status?.saved);
  }
  
  /**
   * Get spam messages
   * @returns {Array}
   */
  getSpamMessages() {
    return this.getAllMessages().filter(m => m.status?.spam);
  }
  
  /**
   * Mark message as read
   * @param {string} messageId - Message ID
   */
  markAsRead(messageId) {
    this.state.unreadMessages.delete(messageId);
    
    const message = this.state.messages.get(messageId);
    if (message) {
      message.status = { ...message.status, read: true };
      this.eventBus.emit(EVENTS.MESSAGE_READ, message);
    }
  }
  
  /**
   * Mark message as unread
   * @param {string} messageId - Message ID
   */
  markAsUnread(messageId) {
    this.state.unreadMessages.add(messageId);
    
    const message = this.state.messages.get(messageId);
    if (message) {
      message.status = { ...message.status, read: false };
    }
  }
  
  /**
   * Get unread count
   * @returns {number}
   */
  getUnreadCount() {
    return this.state.unreadMessages.size;
  }
  
  /**
   * Get filtered messages
   * @returns {Array}
   */
  getFilteredMessages() {
    let messages = Array.from(this.state.messages.values());
    
    // Apply category filter
    if (this.state.currentFilter === 'saved') {
      messages = messages.filter(m => m.status?.saved);
    } else if (this.state.currentFilter === 'spam') {
      messages = messages.filter(m => m.status?.spam);
    } else if (this.state.currentFilter === 'inbox') {
      messages = messages.filter(m => !m.status?.spam);
    }
    
    // Apply search
    if (this.state.searchTerm) {
      const search = this.state.searchTerm.toLowerCase();
      messages = messages.filter(m => 
        m.subject?.toLowerCase().includes(search) ||
        m.from?.toLowerCase().includes(search) ||
        m.to?.toLowerCase().includes(search) ||
        m.body?.toLowerCase().includes(search)
      );
    }
    
    // Apply advanced filters
    if (this.state.advancedFilters) {
      // Implement advanced filtering logic
    }
    
    return messages;
  }
  
  // ========================================
  // Private helper methods
  // ========================================
  
  /**
   * Get nested value using dot notation
   * @private
   */
  _getNestedValue(obj, path) {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }
  
  /**
   * Set nested value using dot notation
   * @private
   */
  _setNestedValue(obj, path, value) {
    const keys = path.split('.');
    const lastKey = keys.pop();
    const target = keys.reduce((current, key) => {
      if (!current[key]) current[key] = {};
      return current[key];
    }, obj);
    target[lastKey] = value;
  }
}

// Export singleton instance
export const stateManager = StateManager.getInstance();