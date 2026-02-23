/**
 * Message Service
 * @file scripts/services/MessageService.js
 * @module cyberpunkred-messenger
 * @description Core messaging business logic. Handles send/receive/reply/forward/delete
 * with GM-relayed delivery pipeline. All message delivery flows through the GM's client
 * for permission safety.
 */

import { MODULE_ID, EVENTS, SOCKET_OPS } from '../utils/constants.js';
import { DataValidator } from '../data/DataValidator.js';

export class MessageService {
  constructor() {
    /** @type {Array} Local message queue for dead zone / GM offline */
    this._messageQueue = [];
  }

  // ─── Service Accessors (all via namespace — never constructor-injected) ──

  get _messageRepo() { return game.nightcity.messageRepository; }
  get _contactRepo() { return game.nightcity.contactRepository; }
  get eventBus() { return game.nightcity.eventBus; }
  get socketManager() { return game.nightcity.socketManager; }
  get timeService() { return game.nightcity.timeService; }
  get soundService() { return game.nightcity.soundService; }
  get notificationService() { return game.nightcity.notificationService; }

  // ─── Send Pipeline ────────────────────────────────────────

  /**
   * Send a message. Routes through GM relay for delivery.
   * @param {Object} data - Message data
   * @param {string} data.toActorId - Recipient actor ID
   * @param {string} data.fromActorId - Sender actor ID  
   * @param {string} data.subject
   * @param {string} data.body
   * @param {string} [data.priority='normal']
   * @param {string} [data.inReplyTo] - Parent message ID for threading
   * @param {string} [data.threadId] - Thread group ID
   * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
   */
  async sendMessage(data) {
    try {
      // Validate
      const validation = DataValidator.validateMessage(data);
      if (!validation.valid) {
        return { success: false, error: validation.errors.join(', ') };
      }

      // Sanitize body
      data.body = DataValidator.sanitizeBody(data.body);

      // Resolve email addresses from actor IDs
      const fromActor = game.actors.get(data.fromActorId);
      const toActor = game.actors.get(data.toActorId);
      if (!fromActor) return { success: false, error: 'Sender actor not found' };
      if (!toActor) return { success: false, error: 'Recipient actor not found' };

      data.from = data.from || this._contactRepo.getActorEmail(data.fromActorId) || `${fromActor.name.toLowerCase().replace(/\s+/g, '.')}@nightcity.net`;
      data.to = data.to || this._contactRepo.getActorEmail(data.toActorId) || `${toActor.name.toLowerCase().replace(/\s+/g, '.')}@nightcity.net`;

      // Generate IDs
      const messageId = foundry.utils.randomID();
      data.messageId = messageId;
      if (!data.threadId) {
        data.threadId = data.inReplyTo ? undefined : messageId; // Will be set by reply logic
      }

      // Add timestamp
      data.timestamp = this._getTimestamp();

      // If we are the GM, deliver directly
      if (game.user.isGM) {
        return this._deliverMessage(data);
      }

      // Otherwise, relay through GM via socket
      return this._relayMessage(data);
    } catch (error) {
      console.error(`${MODULE_ID} | MessageService.sendMessage:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Direct delivery (GM client). Creates message in recipient's inbox
   * and a sent copy in sender's outbox.
   * @param {Object} data
   * @returns {Promise<{success: boolean, messageId?: string}>}
   */
  async _deliverMessage(data) {
    try {
      // Create message in recipient's inbox
      const result = await this._messageRepo.createMessage(data.toActorId, data);
      if (!result.success) return result;

      // Create sent copy in sender's outbox
      const sentCopy = { ...data, status: { sent: true, read: true } };
      await this._messageRepo.createMessage(data.fromActorId, sentCopy);

      // Emit events
      this.eventBus.emit(EVENTS.MESSAGE_SENT, {
        messageId: data.messageId,
        toActorId: data.toActorId,
        fromActorId: data.fromActorId,
      });

      // Notify recipient via socket
      this.socketManager.emit(SOCKET_OPS.MESSAGE_NOTIFY, {
        messageId: data.messageId,
        toActorId: data.toActorId,
        fromActorId: data.fromActorId,
        from: data.from,
        subject: data.subject,
        priority: data.priority || 'normal',
        preview: data.body?.substring(0, 100) || '',
      });

      // Play send sound
      this.soundService?.play('send');

      console.log(`${MODULE_ID} | Message ${data.messageId} delivered to actor ${data.toActorId}`);
      return { success: true, messageId: data.messageId };
    } catch (error) {
      console.error(`${MODULE_ID} | MessageService._deliverMessage:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Relay message through GM via socket (player client).
   * @param {Object} data
   * @returns {Promise<{success: boolean, messageId?: string}>}
   */
  async _relayMessage(data) {
    try {
      // Check if GM is online
      const gmUser = game.users.find(u => u.isGM && u.active);
      if (!gmUser) {
        // Queue for later delivery
        this._queueMessage(data);
        ui.notifications.warn('GM is offline. Message queued for delivery.');
        return { success: true, messageId: data.messageId, queued: true };
      }

      // Emit relay request via socket
      this.socketManager.emit(SOCKET_OPS.MESSAGE_RELAY, data);

      // Optimistic: play send sound
      this.soundService?.play('send');

      return { success: true, messageId: data.messageId };
    } catch (error) {
      console.error(`${MODULE_ID} | MessageService._relayMessage:`, error);
      this._queueMessage(data);
      return { success: false, error: error.message };
    }
  }

  // ─── Message Queue (Dead Zone / GM Offline) ───────────────

  /**
   * Queue a message for later delivery.
   * @param {Object} data
   */
  _queueMessage(data) {
    this._messageQueue.push({
      ...data,
      _queuedAt: new Date().toISOString(),
    });
    console.log(`${MODULE_ID} | Message queued. Queue size: ${this._messageQueue.length}`);
  }

  /**
   * Flush the message queue (called on reconnect / dead zone exit).
   * Messages are sent with 150ms stagger for the arrival animation.
   */
  async flushQueue() {
    if (this._messageQueue.length === 0) return;

    const queue = [...this._messageQueue];
    this._messageQueue = [];

    console.log(`${MODULE_ID} | Flushing ${queue.length} queued messages`);

    for (let i = 0; i < queue.length; i++) {
      if (i > 0) await this._delay(150);
      await this.sendMessage(queue[i]);
    }

    this.eventBus.emit(EVENTS.QUEUE_FLUSHED, { count: queue.length });
  }

  /** @returns {number} */
  get queueSize() { return this._messageQueue.length; }

  // ─── Reply / Forward ──────────────────────────────────────

  /**
   * Build reply data from an original message.
   * @param {Object} originalMessage
   * @param {string} fromActorId - The replying actor
   * @param {string} replyBody
   * @returns {Object} Message data ready for sendMessage()
   */
  buildReply(originalMessage, fromActorId, replyBody) {
    return {
      toActorId: originalMessage.fromActorId,
      fromActorId,
      subject: originalMessage.subject?.startsWith('RE: ')
        ? originalMessage.subject
        : `RE: ${originalMessage.subject || '(no subject)'}`,
      body: replyBody,
      threadId: originalMessage.threadId,
      inReplyTo: originalMessage.messageId,
      priority: 'normal',
    };
  }

  /**
   * Build forward data from an original message.
   * @param {Object} originalMessage
   * @param {string} fromActorId - The forwarding actor
   * @param {string} toActorId - New recipient
   * @param {string} [forwardBody] - Optional added text above forwarded content
   * @returns {Object}
   */
  buildForward(originalMessage, fromActorId, toActorId, forwardBody = '') {
    const divider = '\n\n--- Forwarded Message ---\n';
    const header = `From: ${originalMessage.from}\nTo: ${originalMessage.to}\nDate: ${originalMessage.timestamp}\nSubject: ${originalMessage.subject}\n\n`;

    return {
      toActorId,
      fromActorId,
      subject: originalMessage.subject?.startsWith('FWD: ')
        ? originalMessage.subject
        : `FWD: ${originalMessage.subject || '(no subject)'}`,
      body: forwardBody + divider + header + (originalMessage.body || ''),
      priority: 'normal',
    };
  }

  /**
   * Send a quick reply (predefined short response).
   * @param {Object} originalMessage
   * @param {string} fromActorId
   * @param {string} quickReplyText - e.g. "ACK", "WILCO", "NEGATIVE"
   * @returns {Promise<{success: boolean, messageId?: string}>}
   */
  async sendQuickReply(originalMessage, fromActorId, quickReplyText) {
    const replyData = this.buildReply(originalMessage, fromActorId, quickReplyText);
    return this.sendMessage(replyData);
  }

  // ─── Read / Delete / Save ─────────────────────────────────

  /**
   * Mark a message as read.
   * @param {string} actorId
   * @param {string} messageId
   */
  async markAsRead(actorId, messageId) {
    const result = await this._messageRepo.markAsRead(actorId, messageId);
    if (result.success) {
      this.eventBus.emit(EVENTS.MESSAGE_READ, { messageId, actorId, readAt: new Date().toISOString() });
      // Sync status to other clients
      this.socketManager.emit(SOCKET_OPS.MESSAGE_STATUS_UPDATE, {
        actorId, messageId, update: 'read',
      });
    }
    return result;
  }

  /**
   * Soft-delete a message.
   * @param {string} actorId
   * @param {string} messageId
   */
  async deleteMessage(actorId, messageId) {
    const result = await this._messageRepo.softDeleteMessage(actorId, messageId);
    if (result.success) {
      this.eventBus.emit(EVENTS.MESSAGE_DELETED, { messageId });
    }
    return result;
  }

  /**
   * Toggle saved/starred status.
   * @param {string} actorId
   * @param {string} messageId
   */
  async toggleSaved(actorId, messageId) {
    return this._messageRepo.toggleSaved(actorId, messageId);
  }

  // ─── Query Methods ────────────────────────────────────────

  /**
   * Get messages for an actor with filtering.
   * @param {string} actorId
   * @param {Object} [options]
   */
  async getMessages(actorId, options = {}) {
    return this._messageRepo.getMessages(actorId, options);
  }

  /**
   * Get a single message.
   * @param {string} actorId
   * @param {string} messageId
   */
  async getMessage(actorId, messageId) {
    return this._messageRepo.getMessage(actorId, messageId);
  }

  /**
   * Get unread count for an actor.
   * @param {string} actorId
   * @returns {Promise<number>}
   */
  async getUnreadCount(actorId) {
    return this._messageRepo.getUnreadCount(actorId);
  }

  /**
   * Get message thread.
   * @param {string} actorId
   * @param {string} threadId
   */
  async getThread(actorId, threadId) {
    return this._messageRepo.getThread(actorId, threadId);
  }

  // ─── GM Operations ────────────────────────────────────────

  /**
   * Handle incoming message relay from a player (GM side).
   * @param {Object} data - Message data from player's sendMessage
   */
  async handleMessageRelay(data) {
    if (!game.user.isGM) return;

    console.log(`${MODULE_ID} | GM handling message relay: ${data.messageId}`);
    const result = await this._deliverMessage(data);

    // Send delivery confirmation back to sender
    this.socketManager.emit(SOCKET_OPS.MESSAGE_DELIVERED, {
      messageId: data.messageId,
      success: result.success,
      error: result.error,
    });
  }

  /**
   * Handle incoming notification (recipient side).
   * @param {Object} data - Notification data
   */
  async handleMessageNotification(data) {
    // Check if this notification is for an actor we own
    const actor = game.actors.get(data.toActorId);
    if (!actor?.isOwner) return;

    console.log(`${MODULE_ID} | New message notification for ${data.toActorId}`);

    // Show notification
    this.notificationService?.showMessageNotification(data);

    // Emit event for UI refresh
    this.eventBus.emit(EVENTS.MESSAGE_RECEIVED, {
      messageId: data.messageId,
      toActorId: data.toActorId,
      fromActorId: data.fromActorId,
      priority: data.priority,
    });

    // Play receive sound
    if (data.priority === 'urgent' || data.priority === 'critical') {
      this.soundService?.play('receive-urgent');
    } else {
      this.soundService?.play('receive');
    }
  }

  /**
   * Handle delivery confirmation (sender side).
   * @param {Object} data
   */
  handleDeliveryConfirmation(data) {
    if (data.success) {
      console.log(`${MODULE_ID} | Message ${data.messageId} delivered successfully`);
    } else {
      console.warn(`${MODULE_ID} | Message ${data.messageId} delivery failed: ${data.error}`);
      ui.notifications.warn(`Message delivery failed: ${data.error}`);
    }
  }

  // ─── Share to Chat ────────────────────────────────────────

  /**
   * Share a message to the Foundry chat as a styled card.
   * @param {Object} message
   * @param {string} [actorId] - The actor sharing the message
   */
  async shareToChat(message, actorId) {
    try {
      const content = await renderTemplate(
        `modules/${MODULE_ID}/templates/chat/message-card.hbs`,
        {
          message,
          sharedBy: actorId ? game.actors.get(actorId)?.name : game.user.name,
          MODULE_ID,
        }
      );

      const speaker = actorId
        ? ChatMessage.getSpeaker({ actor: game.actors.get(actorId) })
        : ChatMessage.getSpeaker();

      await ChatMessage.create({
        content,
        speaker,
        flags: {
          [MODULE_ID]: {
            type: 'shared-message',
            messageId: message.messageId,
          }
        }
      });
    } catch (error) {
      console.error(`${MODULE_ID} | MessageService.shareToChat:`, error);
      ui.notifications.error('Failed to share message to chat.');
    }
  }

  // ─── Helpers ──────────────────────────────────────────────

  _getTimestamp() {
    try {
      if (this.timeService) return this.timeService.getCurrentTime();
    } catch { /* fallback */ }
    return new Date().toISOString();
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
