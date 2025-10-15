/**
 * Socket Handlers
 * File: scripts/integrations/SocketHandlers.js
 * Module: cyberpunkred-messenger
 * Description: Handle socket communications between users
 */

import { MODULE_ID } from '../utils/constants.js';
import { SocketManager, SOCKET_OPERATIONS } from '../core/SocketManager.js';
import { EventBus, EVENTS } from '../core/EventBus.js';
import { NotificationService } from '../services/NotificationService.js';

/**
 * Register all socket handlers
 */
export function registerSocketHandlers() {
  console.log(`${MODULE_ID} | Registering socket handlers...`);
  
  const socketManager = SocketManager.getInstance();
  const eventBus = EventBus.getInstance();
  const notificationService = new NotificationService();
  
  // ========================================
  // Message Operations
  // ========================================
  
  /**
   * Handle message received
   */
  socketManager.registerHandler(SOCKET_OPERATIONS.MESSAGE_RECEIVED, async (data) => {
    console.log(`${MODULE_ID} | Message received notification:`, data);
    
    // Show notification
    notificationService.showNewMessageNotification({
      from: data.from,
      subject: data.subject
    });
    
    // Emit local event
    eventBus.emit(EVENTS.MESSAGE_RECEIVED, data);
    
    // Refresh any open viewers
    Object.values(ui.windows).forEach(window => {
      if (window.constructor.name === 'MessageViewerApp') {
        window.render(false);
      }
    });
  });
  
  /**
   * Handle message status update
   */
  socketManager.registerHandler(SOCKET_OPERATIONS.MESSAGE_STATUS_UPDATE, async (data) => {
    console.log(`${MODULE_ID} | Message status update:`, data);
    
    // Emit local event
    eventBus.emit(EVENTS.MESSAGE_READ, data);
  });
  
  /**
   * Handle inbox update
   */
  socketManager.registerHandler(SOCKET_OPERATIONS.UPDATE_INBOX, async (data) => {
    console.log(`${MODULE_ID} | Inbox update:`, data);
    
    // Refresh viewers for this inbox
    Object.values(ui.windows).forEach(window => {
      if (window.constructor.name === 'MessageViewerApp' && 
          window.journalEntry?.id === data.journalId) {
        window.render(false);
      }
    });
  });

  // ========================================
  // Schedule Operations
  // ========================================

  /**
   * Handle message scheduled
   */
  socketManager.registerHandler(SOCKET_OPERATIONS.MESSAGE_SCHEDULED, async (data) => {
    console.log(`${MODULE_ID} | Message scheduled notification:`, data);
    
    // Emit local event
    eventBus.emit(EVENTS.MESSAGE_SCHEDULED, data);
    
    // Refresh any open viewers for this actor
    Object.values(ui.windows).forEach(window => {
      if (window.constructor.name === 'MessageViewerApp' && 
          window.selectedActorId === data.actorId) {
        console.log(`${MODULE_ID} | Refreshing viewer for scheduled message`);
        window._loadMessages();
        window.render(false);
      }
    });
  });

  /**
   * Handle schedule cancelled
   */
  socketManager.registerHandler(SOCKET_OPERATIONS.SCHEDULE_CANCELLED, async (data) => {
    console.log(`${MODULE_ID} | Schedule cancelled notification:`, data);
    
    // Emit local event
    eventBus.emit(EVENTS.SCHEDULE_CANCELLED, data);
    
    // Refresh any open viewers for this actor
    Object.values(ui.windows).forEach(window => {
      if (window.constructor.name === 'MessageViewerApp' && 
          window.selectedActorId === data.actorId) {
        console.log(`${MODULE_ID} | Refreshing viewer after schedule cancellation`);
        window._loadMessages();
        window.render(false);
      }
    });
  });
  
  // ========================================
  // Deletion Operations
  // ========================================
  
  /**
   * Handle deleted messages structure ready
   */
  socketManager.registerHandler(SOCKET_OPERATIONS.DELETED_MESSAGES_STRUCTURE_READY, (data) => {
    if (data.userId === game.user.id) {
      console.log(`${MODULE_ID} | Deleted messages structure is ready`);
      ui.notifications.info("Deletion system initialized by GM");
    }
  });
  
  /**
   * Handle create deleted messages structure
   */
  socketManager.registerHandler(SOCKET_OPERATIONS.CREATE_DELETED_MESSAGES_STRUCTURE, async (data) => {
    if (!game.user.isGM) return;
    
    try {
      console.log(`${MODULE_ID} | GM creating deleted messages structure for ${data.characterName}`);
      
      const { JournalManager } = await import('../data/JournalManager.js');
      const journalManager = new JournalManager();
      
      // Create folder and journal
      const folder = await journalManager.getDeletedMessagesFolder();
      
      if (folder) {
        // Notify the requesting player
        socketManager.emitToUser(data.userId, SOCKET_OPERATIONS.DELETED_MESSAGES_STRUCTURE_READY, {
          folderId: folder.id
        });
      }
    } catch (error) {
      console.error(`${MODULE_ID} | Error creating deleted messages structure:`, error);
    }
  });
  
  /**
   * Handle deletion request
   */
  socketManager.registerHandler(SOCKET_OPERATIONS.DELETION_REQUEST, async (data) => {
    if (!game.user.isGM) return;
    
    console.log(`${MODULE_ID} | GM received deletion request from ${data.requestedBy}`);
    
    // Create chat notification for GM
    await ChatMessage.create({
      content: `
        <div style="background: #330000; border: 2px solid #F65261; padding: 15px; border-radius: 4px;">
          <h3 style="color: #F65261;">🗑️ MESSAGE DELETION REQUEST</h3>
          <p><strong>${data.requestedBy}</strong> has requested to delete:</p>
          <p><em>"${data.originalMessageName}"</em></p>
          <p style="margin-top: 10px; font-size: 0.9em; color: #cccccc;">
            <strong>Note:</strong> This was a simplified deletion request.
            The player may not have permission to create deleted message journals.
          </p>
        </div>
      `,
      whisper: [game.user.id]
    });
  });
  
  console.log(`${MODULE_ID} | ✓ Socket handlers registered`);
}