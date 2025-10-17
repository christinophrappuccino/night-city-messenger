/**
 * Event Bus
 * File: scripts/core/EventBus.js
 * Module: cyberpunkred-messenger
 * Description: Centralized event system for loose coupling between components
 */

export class EventBus {
  static instance = null;
  
  constructor() {
    if (EventBus.instance) {
      return EventBus.instance;
    }
    
    this.events = new Map();
    this.debugMode = false;
    
    EventBus.instance = this;
  }
  
  /**
   * Get singleton instance
   * @returns {EventBus}
   */
  static getInstance() {
    if (!EventBus.instance) {
      EventBus.instance = new EventBus();
    }
    return EventBus.instance;
  }
  
  /**
   * Subscribe to an event
   * @param {string} event - Event name
   * @param {Function} callback - Callback function
   * @param {Object} context - Context for callback (optional)
   * @returns {Function} Unsubscribe function
   */
  on(event, callback, context = null) {
    if (typeof callback !== 'function') {
      throw new Error('EventBus: Callback must be a function');
    }
    
    if (!this.events.has(event)) {
      this.events.set(event, new Set());
    }
    
    const listener = { callback, context };
    this.events.get(event).add(listener);
    
    if (this.debugMode) {
      console.log(`EventBus | Subscribed to: ${event}`, listener);
    }
    
    // Return unsubscribe function
    return () => this.off(event, callback);
  }
  
  /**
   * Subscribe to an event once
   * @param {string} event - Event name
   * @param {Function} callback - Callback function
   * @param {Object} context - Context for callback (optional)
   * @returns {Function} Unsubscribe function
   */
  once(event, callback, context = null) {
    const wrappedCallback = (...args) => {
      this.off(event, wrappedCallback);
      callback.call(context, ...args);
    };
    
    return this.on(event, wrappedCallback, context);
  }
  
  /**
   * Unsubscribe from an event
   * @param {string} event - Event name
   * @param {Function} callback - Callback function to remove
   */
  off(event, callback) {
    if (!this.events.has(event)) return;
    
    const listeners = this.events.get(event);
    
    // Find and remove the listener
    for (const listener of listeners) {
      if (listener.callback === callback) {
        listeners.delete(listener);
        
        if (this.debugMode) {
          console.log(`EventBus | Unsubscribed from: ${event}`);
        }
        
        break;
      }
    }
    
    // Clean up empty event sets
    if (listeners.size === 0) {
      this.events.delete(event);
    }
  }
  
  /**
   * Remove all listeners for an event
   * @param {string} event - Event name
   */
  offAll(event) {
    if (this.events.has(event)) {
      this.events.delete(event);
      
      if (this.debugMode) {
        console.log(`EventBus | Removed all listeners for: ${event}`);
      }
    }
  }
  
  /**
   * Emit an event
   * @param {string} event - Event name
   * @param {*} data - Data to pass to listeners
   * @returns {number} Number of listeners notified
   */
  emit(event, data) {
    if (!this.events.has(event)) {
      if (this.debugMode) {
        console.log(`EventBus | No listeners for: ${event}`);
      }
      return 0;
    }
    
    const listeners = this.events.get(event);
    let notified = 0;
    
    if (this.debugMode) {
      console.log(`EventBus | Emitting: ${event}`, data);
    }
    
    listeners.forEach(listener => {
      try {
        if (listener.context) {
          listener.callback.call(listener.context, data);
        } else {
          listener.callback(data);
        }
        notified++;
      } catch (error) {
        console.error(`EventBus | Error in event handler for ${event}:`, error);
      }
    });
    
    return notified;
  }
  
  /**
   * Get listener count for an event
   * @param {string} event - Event name
   * @returns {number}
   */
  listenerCount(event) {
    return this.events.has(event) ? this.events.get(event).size : 0;
  }
  
  /**
   * Get all registered events
   * @returns {Array<string>}
   */
  getEvents() {
    return Array.from(this.events.keys());
  }
  
  /**
   * Clear all events
   */
  clear() {
    this.events.clear();
    
    if (this.debugMode) {
      console.log('EventBus | Cleared all events');
    }
  }
  
  /**
   * Enable debug mode
   */
  enableDebug() {
    this.debugMode = true;
  }
  
  /**
   * Disable debug mode
   */
  disableDebug() {
    this.debugMode = false;
  }
}

// Export singleton instance
export const eventBus = EventBus.getInstance();

// Event name constants for type safety
export const EVENTS = {
  // Message events
  MESSAGE_SENT: 'message:sent',
  MESSAGE_RECEIVED: 'message:received',
  MESSAGE_READ: 'message:read',
  MESSAGE_DELETED: 'message:deleted',
  MESSAGE_SAVED: 'message:saved',
  MESSAGE_SPAM: 'message:spam',
  MESSAGES_LOADED: 'messages:loaded',

  // Schedule Events
  MESSAGE_SCHEDULED: 'message:scheduled',
  SCHEDULE_CANCELLED: 'schedule:cancelled',
  
  // UI events
  UI_VIEWER_OPENED: 'ui:viewer:opened',
  UI_VIEWER_CLOSED: 'ui:viewer:closed',
  UI_COMPOSER_OPENED: 'ui:composer:opened',
  UI_COMPOSER_CLOSED: 'ui:composer:closed',

  // Data Shard events
  DATA_SHARD_CREATED: 'dataShard:created',
  DATA_SHARD_MESSAGE_ADDED: 'dataShard:messageAdded',
  DATA_SHARD_DECRYPTED: 'dataShard:decrypted',
  DATA_SHARD_LOCKED: 'dataShard:locked',
  DATA_SHARD_CORRUPTED: 'dataShard:corrupted',
  DATA_SHARD_HACK_ATTEMPT: 'dataShard:hackAttempt',
  DATA_SHARD_MESSAGE_DELETED: 'dataShard:messageDeleted',
  DATA_SHARD_SHARED: 'dataShard:shared',
  
  // State events
  STATE_CHANGED: 'state:changed',
  STATE_FILTER_CHANGED: 'state:filter:changed',
  STATE_SEARCH_CHANGED: 'state:search:changed',
  
  // Network events
  SOCKET_MESSAGE: 'socket:message',
  SOCKET_CONNECTED: 'socket:connected',
  SOCKET_DISCONNECTED: 'socket:disconnected',
  
  // Settings events
  SETTINGS_CHANGED: 'settings:changed',
  THEME_CHANGED: 'theme:changed',
  
  // Notification events
  NOTIFICATION_SHOW: 'notification:show',
  NOTIFICATION_HIDE: 'notification:hide',
  
  // Time events
  TIME_CHANGED: 'time:changed',
  TIME_SOURCE_CHANGED: 'time:source:changed',
  TIME_SCHEDULED_MESSAGE_DUE: 'time:scheduled:due',
  TIME_MANUAL_SET: 'time:manual:set'
};