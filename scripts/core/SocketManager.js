/**
 * Socket Manager
 * File: scripts/core/SocketManager.js
 * Module: cyberpunkred-messenger
 * Description: Handles socket communication for multi-user functionality
 */

import { MODULE_ID } from '../utils/constants.js';
import { EventBus, EVENTS } from './EventBus.js';

export class SocketManager {
  static instance = null;
  
  constructor() {
    if (SocketManager.instance) {
      return SocketManager.instance;
    }
    
    this.eventBus = EventBus.getInstance();
    this.handlers = new Map();
    this.socketActive = false;
    
    SocketManager.instance = this;
  }
  
  /**
   * Get singleton instance
   * @returns {SocketManager}
   */
  static getInstance() {
    if (!SocketManager.instance) {
      SocketManager.instance = new SocketManager();
    }
    return SocketManager.instance;
  }
  
  /**
   * Initialize socket listeners
   */
  initialize() {
    if (this.socketActive) {
      console.warn(`${MODULE_ID} | Socket already initialized`);
      return;
    }
    
    game.socket.on(`module.${MODULE_ID}`, this._handleSocketMessage.bind(this));
    this.socketActive = true;
    
    console.log(`${MODULE_ID} | Socket manager initialized`);
    this.eventBus.emit(EVENTS.SOCKET_CONNECTED);
  }
  
  /**
   * Register a handler for a specific operation
   * @param {string} operation - Operation name
   * @param {Function} handler - Handler function
   */
  registerHandler(operation, handler) {
    if (typeof handler !== 'function') {
      throw new Error('Handler must be a function');
    }
    
    this.handlers.set(operation, handler);
    console.log(`${MODULE_ID} | Registered socket handler: ${operation}`);
  }
  
  /**
   * Unregister a handler
   * @param {string} operation - Operation name
   */
  unregisterHandler(operation) {
    this.handlers.delete(operation);
  }
  
  /**
   * Emit a socket message
   * @param {string} operation - Operation name
   * @param {Object} data - Data to send
   * @param {Array<string>} targetUsers - Specific user IDs (optional)
   */
  emit(operation, data = {}, targetUsers = null) {
    const payload = {
      operation,
      senderId: game.user.id,
      timestamp: Date.now(),
      ...data
    };
    
    // If targeting specific users, add that info
    if (targetUsers) {
      payload.targetUsers = Array.isArray(targetUsers) ? targetUsers : [targetUsers];
    }
    
    console.log(`${MODULE_ID} | Emitting socket message:`, operation, payload);
    
    game.socket.emit(`module.${MODULE_ID}`, payload);
    
    // Also emit to local event bus
    this.eventBus.emit(EVENTS.SOCKET_MESSAGE, { operation, data: payload });
  }
  
  /**
   * Emit to specific user
   * @param {string} userId - Target user ID
   * @param {string} operation - Operation name
   * @param {Object} data - Data to send
   */
  emitToUser(userId, operation, data = {}) {
    this.emit(operation, data, [userId]);
  }
  
  /**
   * Emit to GM
   * @param {string} operation - Operation name
   * @param {Object} data - Data to send
   */
  emitToGM(operation, data = {}) {
    const gmUsers = game.users.filter(u => u.isGM).map(u => u.id);
    this.emit(operation, data, gmUsers);
  }
  
  /**
   * Handle incoming socket messages
   * @private
   */
  async _handleSocketMessage(data) {
    console.log(`${MODULE_ID} | Received socket message:`, data);
    
    // Check if message is targeted and if we're a target
    if (data.targetUsers && !data.targetUsers.includes(game.user.id)) {
      console.log(`${MODULE_ID} | Message not for this user, ignoring`);
      return;
    }
    
    const { operation } = data;
    
    // Check for registered handler
    if (this.handlers.has(operation)) {
      try {
        const handler = this.handlers.get(operation);
        await handler(data);
      } catch (error) {
        console.error(`${MODULE_ID} | Error in socket handler for ${operation}:`, error);
      }
    } else {
      console.warn(`${MODULE_ID} | No handler registered for operation: ${operation}`);
    }
    
    // Emit to event bus for any listeners
    this.eventBus.emit(`socket:${operation}`, data);
  }
  
  /**
   * Cleanup
   */
  destroy() {
    if (this.socketActive) {
      game.socket.off(`module.${MODULE_ID}`);
      this.socketActive = false;
      this.handlers.clear();
      
      console.log(`${MODULE_ID} | Socket manager destroyed`);
      this.eventBus.emit(EVENTS.SOCKET_DISCONNECTED);
    }
  }
}

// Export singleton instance
export const socketManager = SocketManager.getInstance();

// Socket operation constants
export const SOCKET_OPERATIONS = {
  // Message operations
  MESSAGE_SENT: 'message:sent',
  MESSAGE_RECEIVED: 'message:received',
  MESSAGE_STATUS_UPDATE: 'message:status:update',
  MESSAGE_DELETED: 'message:deleted',
  
  // Inbox operations
  UPDATE_INBOX: 'updateInbox',
  
  // System operations
  DELETED_MESSAGES_STRUCTURE_READY: 'deletedMessagesStructureReady',
  CREATE_DELETED_MESSAGES_STRUCTURE: 'createDeletedMessagesStructure',
  DELETION_REQUEST: 'deletionRequest',
  
  // Sync operations
  SYNC_REQUEST: 'sync:request',
  SYNC_RESPONSE: 'sync:response'
};