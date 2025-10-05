/**
 * Message Service
 * File: scripts/services/MessageService.js
 * Module: cyberpunkred-messenger
 * Description: Business logic for message operations
 */

import { MODULE_ID } from '../utils/constants.js';
import { MessageRepository } from '../data/MessageRepository.js';
import { EventBus, EVENTS } from '../core/EventBus.js';
import { SocketManager, SOCKET_OPERATIONS } from '../core/SocketManager.js';
import { StateManager } from '../core/StateManager.js';
import { NotificationService } from './NotificationService.js';
import { SpamDetectionService } from './SpamDetectionService.js';

export class MessageService {
  constructor(options = {}) {
    this.messageRepository = options.messageRepository || new MessageRepository();
    this.eventBus = options.eventBus || EventBus.getInstance();
    this.socketManager = options.socketManager || SocketManager.getInstance();
    this.stateManager = options.stateManager || StateManager.getInstance();
    this.notificationService = options.notificationService || new NotificationService();
    this.spamDetection = options.spamDetection || new SpamDetectionService();
  }
  
  /**
   * Send a message
   * @param {Object} messageData - Message data
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Sent message
   */
  async sendMessage(messageData, options = {}) {
    console.log(`${MODULE_ID} | Sending message...`, messageData);
    
    // Add sender if not present
    if (!messageData.from) {
      messageData.from = this._getCurrentUserEmail();
    }
    
    // Add timestamp if not present
    if (!messageData.timestamp) {
      messageData.timestamp = this._getCurrentDateTime();
    }
    
    // Check for spam (unless GM or override)
    if (!game.user.isGM && !options.skipSpamCheck) {
      const isSpam = this.spamDetection.detectSpam(messageData);
      if (isSpam) {
        throw new Error('Message flagged as spam. Please review content and try again.');
      }
    }
    
    // Apply network effects
    if (!options.skipNetworkCheck) {
      messageData = await this._applyNetworkEffects(messageData);
    }
    
    // Create message
    try {
      const message = await this.messageRepository.create(messageData);
      
      console.log(`${MODULE_ID} | Message sent successfully:`, message.id);
      
      // Emit local event
      this.eventBus.emit(EVENTS.MESSAGE_SENT, message);
      
      // Notify recipient via socket
      const recipient = this._getUserByEmail(messageData.to);
      if (recipient) {
        this.socketManager.emitToUser(recipient.id, SOCKET_OPERATIONS.MESSAGE_RECEIVED, {
          messageId: message.id,
          from: message.from,
          subject: message.subject
        });
      }
      
      // Show notification
      this.notificationService.success('Message sent successfully');
      
      // Play send sound
      this.notificationService.playSound('notification');
      
      return message;
    } catch (error) {
      console.error(`${MODULE_ID} | Error sending message:`, error);
      this.notificationService.error(`Failed to send message: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Reply to a message
   * @param {string} messageId - Original message ID
   * @param {Object} replyData - Reply content
   * @returns {Promise<Object>}
   */
  async replyToMessage(messageId, replyData) {
    // Get original message
    const original = await this.messageRepository.findById(messageId);
    if (!original) {
      throw new Error('Original message not found');
    }
    
    // Build reply message
    const messageData = {
      to: original.from,
      from: this._getCurrentUserEmail(),
      subject: replyData.subject || `Re: ${original.subject}`,
      content: this._formatReplyContent(replyData.content, original),
      timestamp: this._getCurrentDateTime(),
      network: original.network
    };
    
    // Send
    return await this.sendMessage(messageData, { skipSpamCheck: true });
  }
  
  /**
   * Forward a message
   * @param {string} messageId - Message ID to forward
   * @param {Object} forwardData - Forward details
   * @returns {Promise<Object>}
   */
  async forwardMessage(messageId, forwardData) {
    // Get original message
    const original = await this.messageRepository.findById(messageId);
    if (!original) {
      throw new Error('Original message not found');
    }
    
    // Build forwarded message
    const messageData = {
      to: forwardData.to,
      from: this._getCurrentUserEmail(),
      subject: forwardData.subject || `Fwd: ${original.subject}`,
      content: this._formatForwardedContent(forwardData.content, original),
      timestamp: this._getCurrentDateTime(),
      network: original.network
    };
    
    // Send
    return await this.sendMessage(messageData, { skipSpamCheck: true });
  }
  
  /**
   * Mark message as read
   * @param {string} messageId - Message ID
   * @returns {Promise<boolean>}
   */
  async markAsRead(messageId) {
    try {
      const success = await this.messageRepository.updateStatus(messageId, {
        read: true
      });
      
      if (success) {
        this.stateManager.markAsRead(messageId);
        this.eventBus.emit(EVENTS.MESSAGE_READ, { messageId });
      }
      
      return success;
    } catch (error) {
      console.error(`${MODULE_ID} | Error marking message as read:`, error);
      return false;
    }
  }
  
  /**
   * Mark message as unread
   * @param {string} messageId - Message ID
   * @returns {Promise<boolean>}
   */
  async markAsUnread(messageId) {
    try {
      const success = await this.messageRepository.updateStatus(messageId, {
        read: false
      });
      
      if (success) {
        this.stateManager.markAsUnread(messageId);
      }
      
      return success;
    } catch (error) {
      console.error(`${MODULE_ID} | Error marking message as unread:`, error);
      return false;
    }
  }
  
  /**
   * Save/unsave a message
   * @param {string} messageId - Message ID
   * @param {boolean} saved - Save status
   * @returns {Promise<boolean>}
   */
  async toggleSaved(messageId, saved) {
    try {
      const success = await this.messageRepository.updateStatus(messageId, {
        saved: saved
      });
      
      if (success) {
        this.eventBus.emit(EVENTS.MESSAGE_SAVED, { messageId, saved });
        this.notificationService.info(saved ? 'Message saved' : 'Message unsaved');
      }
      
      return success;
    } catch (error) {
      console.error(`${MODULE_ID} | Error toggling saved status:`, error);
      return false;
    }
  }
  
  /**
   * Mark message as spam
   * @param {string} messageId - Message ID
   * @param {boolean} spam - Spam status
   * @returns {Promise<boolean>}
   */
  async toggleSpam(messageId, spam) {
    try {
      const success = await this.messageRepository.updateStatus(messageId, {
        spam: spam
      });
      
      if (success) {
        this.eventBus.emit(EVENTS.MESSAGE_SPAM, { messageId, spam });
        this.notificationService.info(spam ? 'Marked as spam' : 'Unmarked as spam');
      }
      
      return success;
    } catch (error) {
      console.error(`${MODULE_ID} | Error toggling spam status:`, error);
      return false;
    }
  }
  
  /**
   * Delete a message
   * @param {string} messageId - Message ID
   * @param {boolean} moveToDeleted - Move to deleted folder
   * @returns {Promise<boolean>}
   */
  async deleteMessage(messageId, moveToDeleted = true) {
    // Confirm deletion
    const confirmed = await Dialog.confirm({
      title: 'Delete Message',
      content: `
        <p>Are you sure you want to delete this message?</p>
        ${moveToDeleted ? '<p><em>The message will be moved to your Deleted folder.</em></p>' : ''}
      `,
      yes: () => true,
      no: () => false,
      defaultYes: false
    });
    
    if (!confirmed) return false;
    
    try {
      const success = await this.messageRepository.delete(messageId, moveToDeleted);
      
      if (success) {
        this.stateManager.removeMessage(messageId);
        this.eventBus.emit(EVENTS.MESSAGE_DELETED, { messageId });
        this.notificationService.success('Message deleted');
      }
      
      return success;
    } catch (error) {
      console.error(`${MODULE_ID} | Error deleting message:`, error);
      this.notificationService.error('Failed to delete message');
      return false;
    }
  }
  
  /**
   * Get message statistics for user
   * @param {string} userId - User ID
   * @returns {Promise<Object>}
   */
  async getStatistics(userId = null) {
    userId = userId || game.user.id;
    
    const stats = await this.messageRepository.getMessageCount(userId);
    
    return {
      ...stats,
      inbox: stats.total - stats.spam,
      spamRate: stats.total > 0 ? (stats.spam / stats.total * 100).toFixed(1) : 0
    };
  }
  
  /**
   * Search messages
   * @param {Object} criteria - Search criteria
   * @returns {Promise<Array>}
   */
  async searchMessages(criteria) {
    return await this.messageRepository.search(criteria);
  }
  
  /**
   * Share message to chat
   * @param {string} messageId - Message ID
   * @returns {Promise<void>}
   */
  async shareToChat(messageId) {
    const message = await this.messageRepository.findById(messageId);
    if (!message) {
      throw new Error('Message not found');
    }
    
    // Create chat message
    const chatContent = await renderTemplate(
      `modules/${MODULE_ID}/templates/shared/message-shared.hbs`,
      {
        message: message,
        canReply: true
      }
    );
    
    await ChatMessage.create({
      content: chatContent,
      speaker: ChatMessage.getSpeaker({ actor: game.user.character }),
      type: CONST.CHAT_MESSAGE_TYPES.IC,
      flags: {
        [MODULE_ID]: {
          type: 'shared-message',
          messageId: message.id
        }
      }
    });
    
    this.notificationService.success('Message shared to chat');
  }
  
  // ========================================
  // Private Helper Methods
  // ========================================
  
  /**
   * Get current user's email
   * @private
   */
  _getCurrentUserEmail() {
    const character = game.user.character;
    const name = character?.name || game.user.name;
    return `${name.toLowerCase().replace(/\s+/g, '')}@nightcity.net`;
  }
  
  /**
   * Get current date/time
   * @private
   */
  _getCurrentDateTime() {
    // Check if SimpleCalendar is available
    if (game.modules.get('foundryvtt-simple-calendar')?.active) {
      try {
        return SimpleCalendar.api.currentDateTimeDisplay().display;
      } catch (e) {
        console.warn(`${MODULE_ID} | SimpleCalendar error:`, e);
      }
    }
    
    // Fallback to real-world time
    return new Date().toLocaleString();
  }
  
  /**
   * Get user by email
   * @private
   */
  _getUserByEmail(email) {
    const username = email.split('@')[0].toLowerCase();
    
    return game.users.find(u => 
      u.character?.name.toLowerCase().replace(/\s+/g, '') === username ||
      u.name.toLowerCase().replace(/\s+/g, '') === username
    );
  }
  
  /**
   * Apply network effects to message
   * @private
   */
  async _applyNetworkEffects(messageData) {
    // Get current network state
    const network = this.stateManager.get('currentNetwork');
    const signalStrength = this.stateManager.get('signalStrength');
    
    // Add network metadata
    messageData.network = network;
    messageData.metadata = {
      ...messageData.metadata,
      networkTrace: network,
      signalStrength: signalStrength
    };
    
    // Apply reliability check
    if (signalStrength < 50) {
      // Chance of message corruption
      if (Math.random() > (signalStrength / 100)) {
        throw new Error('Network signal too weak. Message failed to send.');
      }
    }
    
    // Dead zone check
    if (network === 'DEAD_ZONE') {
      throw new Error('No network connection. Cannot send message.');
    }
    
    return messageData;
  }
  
  /**
   * Format reply content
   * @private
   */
  _formatReplyContent(newContent, originalMessage) {
    return `
      ${newContent}
      
      <div class="quoted-message" style="border-left: 2px solid #F65261; padding-left: 10px; margin-top: 15px; color: #999;">
        <p><strong>On ${originalMessage.timestamp}, ${originalMessage.from} wrote:</strong></p>
        ${originalMessage.content}
      </div>
    `;
  }
  
  /**
   * Format forwarded content
   * @private
   */
  _formatForwardedContent(additionalContent, originalMessage) {
    return `
      ${additionalContent || ''}
      
      <div class="forwarded-message" style="border-left: 2px solid #19f3f7; padding-left: 10px; margin-top: 15px; color: #999;">
        <p><strong>---------- Forwarded message ----------</strong></p>
        <p><strong>From:</strong> ${originalMessage.from}</p>
        <p><strong>Date:</strong> ${originalMessage.timestamp}</p>
        <p><strong>Subject:</strong> ${originalMessage.subject}</p>
        <hr style="border-color: #19f3f7;">
        ${originalMessage.content}
      </div>
    `;
  }
}