/**
 * Message Repository
 * File: scripts/data/MessageRepository.js
 * Module: cyberpunkred-messenger
 * Description: Handles all message data operations (CRUD)
 */

import { MODULE_ID } from '../utils/constants.js';
import { DataValidator } from './DataValidator.js';
import { JournalManager } from './JournalManager.js';

export class MessageRepository {
  constructor() {
    this.journalManager = new JournalManager();
    this.cache = new Map();
  }
  
  /**
   * Create a new message
   * @param {Object} messageData - Message data
   * @returns {Promise<Object>} Created message object
   */
  async create(messageData) {
    // Validate data
    const validation = DataValidator.validateMessage(messageData);
    if (!validation.valid) {
      throw new Error(`Invalid message data: ${validation.errors.join(', ')}`);
    }
    
    const data = validation.sanitized;
    
    // Get recipient's inbox
    const recipientJournal = await this._getRecipientJournal(data.to);
    if (!recipientJournal) {
      throw new Error(`Cannot find inbox for recipient: ${data.to}`);
    }
    
    // Format message content
    const formattedContent = this._formatMessageContent(data);
    
    // Prepare timestamp data
    const timestamp = data.timestamp || new Date().toISOString();
    
    // Prepare SimpleCalendar data if provided
    const simpleCalendarData = data.simpleCalendarData || null;
    
    // Prepare metadata with scheduling info
    const metadata = {
      ...(data.metadata || {}),
      scheduled: data.scheduled || false,
      scheduledTime: data.scheduledTime || null,
      sentVia: data.sentVia || 'manual'
    };
    
    // Create journal page
    const page = await JournalEntryPage.create({
      name: data.subject,
      type: 'text',
      text: { 
        content: formattedContent,
        format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML
      },
      flags: {
        [MODULE_ID]: {
          from: data.from,
          to: data.to,
          subject: data.subject,
          content: data.content,
          
          // Enhanced timestamp storage
          timestamp,  // ISO-8601 timestamp (always present)
          simpleCalendarData,  // SimpleCalendar data if applicable (can be null)
          
          network: data.network,
          encrypted: data.encrypted,
          status: data.status,
          
          // Enhanced metadata
          metadata,  // Includes scheduled info
          
          createdAt: new Date().toISOString()
        }
      }
    }, { parent: recipientJournal });
    
    console.log(`${MODULE_ID} | Created message: ${data.subject}`);
    
    // Convert to message object
    const message = this._pageToMessage(page);
    
    // Cache
    this.cache.set(message.id, message);
    
    return message;
  }

  /**
   * Helper to check if message was scheduled
   * @param {Object} message - Message object
   * @returns {boolean}
   */
  _isScheduledMessage(message) {
    return message.metadata?.scheduled === true;
  }

  /**
   * Get display timestamp for message
   * Uses SimpleCalendar format if available, otherwise ISO
   * @param {Object} message - Message object
   * @returns {string}
   */
  _getDisplayTimestamp(message) {
    // If has SimpleCalendar data, prefer that display
    if (message.simpleCalendarData?.display) {
      return message.simpleCalendarData.display;
    }
    
    // Otherwise return ISO timestamp
    return message.timestamp;
  }
  
  /**
   * Find message by ID
   * @param {string} messageId - Message ID
   * @returns {Promise<Object|null>}
   */
  async findById(messageId) {
    // Check cache
    if (this.cache.has(messageId)) {
      return this.cache.get(messageId);
    }
    
    // Search all inboxes
    const inboxes = this.journalManager.getAllInboxes();
    
    for (const inbox of inboxes) {
      const page = inbox.pages.get(messageId);
      if (page) {
        const message = this._pageToMessage(page);
        this.cache.set(messageId, message);
        return message;
      }
    }
    
    return null;
  }
  
  /**
   * Find all messages for a user
   * @param {string} userId - User ID
   * @returns {Promise<Array<Object>>}
   */
  async findByUser(userId) {
    const inbox = await this.journalManager.getUserInbox(userId);
    if (!inbox) return [];
    
    return this._journalToMessages(inbox);
  }
  
  /**
   * Find all messages in a journal
   * @param {string} journalId - Journal ID
   * @returns {Promise<Array<Object>>}
   */
  async findByJournal(journalId) {
    const journal = game.journal.get(journalId);
    if (!journal) return [];
    
    return this._journalToMessages(journal);
  }
  
  /**
   * Update message status
   * @param {string} messageId - Message ID
   * @param {Object} status - Status updates
   * @returns {Promise<boolean>}
   */
  async updateStatus(messageId, status) {
    const message = await this.findById(messageId);
    if (!message || !message.page) {
      console.error(`${MODULE_ID} | Message not found: ${messageId}`);
      return false;
    }
    
    try {
      // Get current status
      const currentStatus = message.page.getFlag(MODULE_ID, 'status') || {};
      
      // Merge with updates
      const newStatus = { ...currentStatus, ...status };
      
      // Update flag
      await message.page.setFlag(MODULE_ID, 'status', newStatus);
      
      // Update cache
      if (this.cache.has(messageId)) {
        const cached = this.cache.get(messageId);
        cached.status = newStatus;
      }
      
      console.log(`${MODULE_ID} | Updated message status:`, messageId, newStatus);
      
      return true;
    } catch (error) {
      console.error(`${MODULE_ID} | Error updating message status:`, error);
      return false;
    }
  }
  
  /**
   * Delete a message
   * @param {string} messageId - Message ID
   * @param {boolean} moveToDeleted - Move to deleted folder instead of permanent delete
   * @returns {Promise<boolean>}
   */
  async delete(messageId, moveToDeleted = true) {
    const message = await this.findById(messageId);
    if (!message || !message.page) {
      console.error(`${MODULE_ID} | Message not found: ${messageId}`);
      return false;
    }
    
    try {
      if (moveToDeleted) {
        // Move to deleted messages journal
        await this._moveToDeleted(message);
      } else {
        // Permanent delete
        await message.page.delete();
      }
      
      // Remove from cache
      this.cache.delete(messageId);
      
      console.log(`${MODULE_ID} | Deleted message: ${messageId}`);
      
      return true;
    } catch (error) {
      console.error(`${MODULE_ID} | Error deleting message:`, error);
      return false;
    }
  }
  
  /**
   * Search messages by criteria
   * @param {Object} criteria - Search criteria
   * @returns {Promise<Array<Object>>}
   */
  async search(criteria) {
    const { 
      userId, 
      sender, 
      subject, 
      content, 
      dateFrom, 
      dateTo,
      category
    } = criteria;
    
    // Get messages
    let messages = userId 
      ? await this.findByUser(userId)
      : await this._getAllMessages();
    
    // Apply filters
    if (sender) {
      const senderLower = sender.toLowerCase();
      messages = messages.filter(m => 
        m.from?.toLowerCase().includes(senderLower)
      );
    }
    
    if (subject) {
      const subjectLower = subject.toLowerCase();
      messages = messages.filter(m => 
        m.subject?.toLowerCase().includes(subjectLower)
      );
    }
    
    if (content) {
      const contentLower = content.toLowerCase();
      messages = messages.filter(m => 
        m.content?.toLowerCase().includes(contentLower)
      );
    }
    
    if (dateFrom) {
      const fromDate = new Date(dateFrom);
      messages = messages.filter(m => 
        new Date(m.timestamp) >= fromDate
      );
    }
    
    if (dateTo) {
      const toDate = new Date(dateTo);
      messages = messages.filter(m => 
        new Date(m.timestamp) <= toDate
      );
    }
    
    if (category) {
      if (category === 'saved') {
        messages = messages.filter(m => m.status?.saved);
      } else if (category === 'spam') {
        messages = messages.filter(m => m.status?.spam);
      } else if (category === 'inbox') {
        messages = messages.filter(m => !m.status?.spam);
      }
    }
    
    return messages;
  }
  
  /**
   * Get message count for user
   * @param {string} userId - User ID
   * @param {Object} filters - Optional filters
   * @returns {Promise<Object>} { total, unread, saved, spam }
   */
  async getMessageCount(userId, filters = {}) {
    const messages = await this.findByUser(userId);
    
    return {
      total: messages.length,
      unread: messages.filter(m => !m.status?.read).length,
      saved: messages.filter(m => m.status?.saved).length,
      spam: messages.filter(m => m.status?.spam).length
    };
  }
  
  // ========================================
  // Private Helper Methods
  // ========================================
  
  /**
   * Get recipient's journal
   * @private
   */
  async _getRecipientJournal(email) {
    // Find actor by email flag (most reliable)
    const actor = game.actors.find(a => 
      a.getFlag(MODULE_ID, "emailAddress") === email
    );
    
    if (actor) {
      // Get or create inbox for this actor
      const inboxName = `${actor.name}'s Messages`;
      let inbox = game.journal.getName(inboxName);
      
      if (!inbox && game.user.isGM) {
        // Auto-create inbox
        const folder = await this.journalManager.ensureFolder("Player Messages");
        inbox = await JournalEntry.create({
          name: inboxName,
          folder: folder.id
        });
        console.log(`${MODULE_ID} | Auto-created inbox for ${actor.name}`);
      }
      
      return inbox;
    }
    
    // Fallback: Extract name from email
    const recipientName = email.split('@')[0];
    const user = game.users.find(u => 
      u.character?.name.toLowerCase().replace(/\s+/g, '.') === recipientName.toLowerCase()
    );
    
    if (user) {
      return await this.journalManager.ensureUserInbox(user.id);
    }
    
    return null;
  }
  
  /**
   * Format message content for journal
   * @private
   */
  _formatMessageContent(data) {
    return `
      <div class="journal-email-display" style="font-family:'Rajdhani',sans-serif;background-color:#1a1a1a;border:2px solid #F65261;border-radius:5px;padding:20px;color:#ffffff;">
        <div style="border-bottom:2px solid #F65261;padding-bottom:10px;margin-bottom:15px;">
          <div style="display:flex;justify-content:space-between;margin-bottom:5px;">
            <span style="color:#F65261;font-weight:bold;">From:</span>
            <span style="color:#19f3f7;">${data.from}</span>
          </div>
          <div style="display:flex;justify-content:space-between;margin-bottom:5px;">
            <span style="color:#F65261;font-weight:bold;">To:</span>
            <span style="color:#19f3f7;">${data.to}</span>
          </div>
          <div style="display:flex;justify-content:space-between;margin-bottom:5px;">
            <span style="color:#F65261;font-weight:bold;">Subject:</span>
            <span style="color:#ffffff;">${data.subject}</span>
          </div>
          <div style="display:flex;justify-content:space-between;">
            <span style="color:#F65261;font-weight:bold;">Date:</span>
            <span style="color:#cccccc;font-style:italic;">${data.timestamp}</span>
          </div>
        </div>
        <div style="padding:15px;color:#ffffff;background-color:#1a1a1a;">
          ${data.content}
        </div>
      </div>
    `;
  }
  
  /**
   * Convert journal page to message object
   * @private
   */
  _pageToMessage(page) {
    const flags = page.flags[MODULE_ID] || {};
    
    return {
      id: page.id,
      subject: flags.subject || page.name,
      from: flags.from || '',
      to: flags.to || '',
      content: page.text?.content || '',
      timestamp: flags.timestamp || flags.createdAt,
      network: flags.network || 'CITINET',
      encrypted: flags.encrypted || false,
      status: flags.status || { read: false, saved: false, spam: false },
      metadata: flags.metadata || {},
      page: page // Keep reference for updates
    };
  }
  
  /**
   * Convert journal to array of messages
   * @private
   */
  _journalToMessages(journal) {
    if (!journal.pages) return [];
    
    return Array.from(journal.pages.values()).map(page => 
      this._pageToMessage(page)
    );
  }
  
  /**
   * Get all messages from all inboxes
   * @private
   */
  async _getAllMessages() {
    const inboxes = this.journalManager.getAllInboxes();
    const allMessages = [];
    
    for (const inbox of inboxes) {
      const messages = this._journalToMessages(inbox);
      allMessages.push(...messages);
    }
    
    return allMessages;
  }
  
  /**
   * Move message to deleted folder
   * @private
   */
  async _moveToDeleted(message) {
    // Get or create deleted journal for user
    const userId = game.user.id;
    let deletedJournal = await this.journalManager.getUserDeletedJournal(userId);
    
    if (!deletedJournal) {
      if (game.user.isGM) {
        deletedJournal = await this.journalManager.createUserDeletedJournal(userId);
      } else {
        // Player can't create, just delete permanently
        await message.page.delete();
        return;
      }
    }
    
    // Create a copy in deleted journal
    await JournalEntryPage.create({
      name: message.subject,
      type: 'text',
      text: message.page.text,
      flags: {
        [MODULE_ID]: {
          ...message.page.flags[MODULE_ID],
          deletedAt: new Date().toISOString(),
          originalJournal: message.page.parent.id
        }
      }
    }, { parent: deletedJournal });
    
    // Delete original
    await message.page.delete();
  }
  
  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
  }
}