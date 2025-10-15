/**
 * Message Repository
 * File: scripts/data/MessageRepository.js
 * Module: cyberpunkred-messenger
 * Description: Handles all message data operations (CRUD)
 */

import { MODULE_ID, debugLog } from '../utils/constants.js';
import { DataValidator } from './DataValidator.js';
import { JournalManager } from './JournalManager.js';
import { constructMessageStatus, extractBodyFromHTML } from '../utils/messageHelpers.js';

export class MessageRepository {
  constructor() {
    this.journalManager = new JournalManager();
    this.cache = new Map();
  }
  
  /**
   * Create a new message in a journal
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
    const simpleCalendarData = data.simpleCalendarData || null;
    
    // Properly merge status - preserve all provided values
    const defaultStatus = {
      read: false,
      sent: false,
      scheduled: false,
      spam: false,
      saved: false,
      deleted: false
    };
    
    const status = {
      ...defaultStatus,
      ...(data.status || {})
    };
    
    debugLog('Creating message with status:', status);
    
    // Prepare metadata with scheduling info
    const metadata = {
      ...(data.metadata || {}),
      scheduled: data.scheduled || false,
      scheduledTime: data.scheduledTime || null,
      sentVia: data.sentVia || 'manual',
      messageType: data.metadata?.messageType || 'standard'
    };
    
    // Create journal page in RECIPIENT's inbox
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
          timestamp,
          simpleCalendarData,
          network: data.network,
          encrypted: data.encrypted,
          status: status,
          metadata,
          createdAt: new Date().toISOString()
        }
      }
    }, { parent: recipientJournal });
    
    console.log(`${MODULE_ID} | ✓ Created message: ${data.subject}`);
    
    // Create copy in sender's sent folder
    if (data.actorId && !data.metadata?.isPlaceholder) {
      await this._createSentCopy(data, timestamp, simpleCalendarData, metadata);
    }
    
    // Convert to message object
    const message = this._pageToMessage(page);
    
    // Cache
    this.cache.set(message.id, message);
    
    return message;
  }

  /**
   * Check if message was scheduled
   * @param {Object} message - Message object
   * @returns {boolean}
   * @private
   */
  _isScheduledMessage(message) {
    return message.metadata?.scheduled === true;
  }

  /**
   * Get display timestamp for message
   * Uses SimpleCalendar format if available, otherwise ISO
   * @param {Object} message - Message object
   * @returns {string}
   * @private
   */
  _getDisplayTimestamp(message) {
    if (message.simpleCalendarData?.display) {
      return message.simpleCalendarData.display;
    }
    
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
   * Update message status flags
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
      
      debugLog('Updated message status:', messageId, newStatus);
      
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
        await this._moveToDeleted(message);
      } else {
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
   * Get recipient's journal by email
   * @param {string} emailString - Email string (can be "Name <email>" format)
   * @returns {Promise<JournalEntry|null>}
   * @private
   */
  async _getRecipientJournal(emailString) {
    // Extract email from "Name <email>" format
    const email = emailString.match(/<(.+?)>/) 
      ? emailString.match(/<(.+?)>/)[1] 
      : emailString;
    
    debugLog('Looking for inbox with email:', email);
    
    // Find actor by email flag
    const actor = game.actors.find(a => 
      a.getFlag(MODULE_ID, "emailAddress") === email
    );
    
    if (actor) {
      return await this.journalManager.getActorInbox(actor.id);
    }
    
    return null;
  }
  
  /**
   * Create copy in sender's sent folder
   * @param {Object} data - Message data
   * @param {string} timestamp - ISO timestamp
   * @param {Object} simpleCalendarData - SimpleCalendar data
   * @param {Object} metadata - Message metadata
   * @private
   */
  async _createSentCopy(data, timestamp, simpleCalendarData, metadata) {
    try {
      const actor = game.actors.get(data.actorId);
      
      if (!actor) {
        console.warn(`${MODULE_ID} | No actor found for actorId: ${data.actorId}`);
        return;
      }
      
      // Try both formats
      const possessiveName = `${actor.name}'s Messages`;
      const simpleName = `${actor.name} Messages`;
      
      let journal = game.journal.getName(possessiveName) || game.journal.getName(simpleName);
      
      if (!journal) {
        journal = game.journal.find(j => 
          j.getFlag(MODULE_ID, 'isInbox') && 
          j.getFlag(MODULE_ID, 'actorId') === actor.id
        );
      }
      
      if (!journal && game.user.isGM) {
        const folder = await this.journalManager.getMessageFolder();
        
        journal = await JournalEntry.create({
          name: possessiveName,
          folder: folder?.id || null,
          flags: {
            [MODULE_ID]: {
              isInbox: true,
              actorId: actor.id,
              characterName: actor.name
            }
          }
        });
        
        console.log(`${MODULE_ID} | Created inbox: ${journal.name}`);
      }
      
      if (!journal) {
        console.error(`${MODULE_ID} | Could not get/create inbox for sender: ${actor.name}`);
        return;
      }
      
      // Format message content
      const formattedContent = this._formatMessageContent(data);
      
      // Create sent copy with SENT status
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
            timestamp,
            simpleCalendarData,
            network: data.network || 'CITINET',
            encrypted: data.encrypted || false,
            
            // SENDER's copy has SENT status
            status: {
              read: true,
              sent: true,
              scheduled: false, 
              spam: false,
              saved: false,
              deleted: false
            },
            
            metadata: metadata,
            createdAt: new Date().toISOString()
          }
        }
      }, { parent: journal });
      
      console.log(`${MODULE_ID} | ✓ Created sent copy: ${page.name}`);
      
    } catch (error) {
      console.error(`${MODULE_ID} | Error creating sent copy:`, error);
    }
  }
  
  /**
   * Format message content for journal display
   * @param {Object} data - Message data
   * @returns {string} Formatted HTML content
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
   * @param {JournalEntryPage} page - Journal page
   * @returns {Object} Message object
   * @private
   */
  _pageToMessage(page) {
    const flags = page.flags[MODULE_ID] || {};
    
    // Extract body from HTML if needed
    let body = flags.content || '';
    if (!body && page.text?.content) {
      body = extractBodyFromHTML(page.text.content);
    }
    
    return {
      id: page.id,
      subject: flags.subject || page.name,
      from: flags.from || '',
      to: flags.to || '',
      content: page.text?.content || '',
      body: body,
      timestamp: flags.timestamp || flags.createdAt || page.sort,
      simpleCalendarData: flags.simpleCalendarData || null,
      network: flags.network || 'CITINET',
      encrypted: flags.encrypted || false,
      status: constructMessageStatus(flags),
      metadata: {
        ...(flags.metadata || {}),
        messageType: flags.metadata?.messageType || flags.type || 'standard',
        scheduleId: flags.metadata?.scheduleId || flags.scheduleId
      },
      attachments: flags.attachments || [],
      createdAt: flags.createdAt || page.sort,
      page: page // Keep reference for updates
    };
  }

  /**
   * Convert journal to array of messages
   * @param {JournalEntry} journal - Journal entry
   * @returns {Array<Object>} Array of messages
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
   * @returns {Promise<Array<Object>>}
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
   * @param {Object} message - Message object
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
   * Clear message cache
   */
  clearCache() {
    this.cache.clear();
  }
}