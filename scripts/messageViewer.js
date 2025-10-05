/**
 * Message Viewer application for Night City Messenger
 */
import { MODULE_ID, AUDIO, MESSAGE_CATEGORIES, TEMPLATES } from './constants.js';
import { getCurrentDateTime, cleanHtmlContent, extractSenderName, parseDateTime } from './utils.js';
import { getSetting } from './settings.js';
import { NightCityMessenger } from './app.js';
import { shareMessageFromViewer } from './unified-shared-message-viewer.js';

/**
 * The main message viewer application
 */
export class CyberpunkMessageViewer extends Application {
  // Static Properties
  static MAX_MESSAGES_DISPLAYED = 20;

  /**
   * @param {JournalEntry} journalEntry - The journal entry containing messages
   */
  constructor(journalEntry) {
    super();
    this.journalEntry = journalEntry;
    this.characterName = this.journalEntry.name.replace("'s Messages", "");
    this.selectedPage = null;
    this.unreadMessages = new Set(); // Initialize as empty set
    this.messagesPerPage = getSetting('messagesPerPage') || 10;
    this.currentPage = 1;
    this.totalPages = 1;
    this.currentCategory = MESSAGE_CATEGORIES.INBOX;
    this.statusCache = new Map();
    this.advancedFilters = null;
    this.searchTerm = "";
    this._unreadStatusLoaded = false;
    this._ensureJournalPermissions();
  }
  
  /**
   * Application configuration
   */
  static get defaultOptions() {
    return mergeObject(super.defaultOptions, {
      template: TEMPLATES.VIEWER,
      title: "Night City Messenger",
      id: "cyberpunk-messenger-viewer",
      width: 800,
      height: 600,
      resizable: true,
      minimizable: true,
      classes: ["cyberpunk-app"],
      scrollY: [".message-scroll-area", ".sidebar-messages"]
    });
  }
  
  /**
   * Get data for the template
   */
  getData() {
    // Always convert unreadMessages to array format for template use
    const unreadArray = this.unreadMessages instanceof Set ? 
      Array.from(this.unreadMessages) : 
      (Array.isArray(this.unreadMessages) ? this.unreadMessages : []);
      
    // Log current unread state for debugging
    console.log(`${MODULE_ID} | getData called. Current unread messages:`, unreadArray);
      
    return {
      pages: this.journalEntry.pages.contents || [],
      filteredPages: this._getFilteredMessages(),
      selectedPage: this.selectedPage,
      currentTime: getCurrentDateTime(),
      characterName: this.characterName,
      categories: Object.values(MESSAGE_CATEGORIES),
      currentCategory: this.currentCategory,
      messagesPerPage: this.messagesPerPage,
      currentPage: this.currentPage,
      totalPages: this.totalPages,
      isGM: game.user.isGM,
      uniqueSenders: this._getUniqueSenders(),
      unreadMessages: unreadArray,
      searchTerm: this.searchTerm,
      advancedFilters: this.advancedFilters,
      viewer: this
    };
  }

  /**
   * Override render to ensure unread status is loaded and start polling
   */
  async render(force = false, options = {}) {
    // If unread status hasn't been loaded yet, load it before rendering
    if (!this._unreadStatusLoaded) {
      await this._loadUnreadStatus();
      this._unreadStatusLoaded = true;
    }
    
    // Call the parent render method
    const result = await super.render(force, options);
    
    // Start polling after rendering
    this._startPolling();
    
    return result;
  }

  /**
   * Override close to stop polling when the viewer is closed
   */
  close(options = {}) {
    // Stop polling before closing
    this._stopPolling();
    
    // Close as normal
    return super.close(options);
  }

  /**
   * Render Inner
   * @private
   */
  async _renderInner(...args) {
    // Call the parent method to get the HTML
    const html = await super._renderInner(...args);
    
    // Log unread messages for debugging
    console.log(`${MODULE_ID} | _renderInner called. Unread messages:`, 
      this.unreadMessages instanceof Set ? Array.from(this.unreadMessages) : this.unreadMessages);
    
    // Now manually add the unread classes and badges to matching elements
    if (this.unreadMessages instanceof Set && this.unreadMessages.size > 0) {
      // Find all message items
      const messageItems = html.find('.page-title');
      
      messageItems.each((i, el) => {
        const $el = $(el);
        const pageId = $el.data('pageId');
        
        if (pageId && this.unreadMessages.has(pageId)) {
          // Add the unread class
          $el.addClass('message-unread');
          
          // Add the NEW badge if it doesn't exist
          const $messageContent = $el.find('.message-email-content');
          if ($messageContent.length && !$messageContent.find('.new-message-badge').length) {
            $messageContent.prepend('<span class="new-message-badge">NEW</span>');
          }
        }
      });
    }
    
    return html;
  }

  
  /**
   * Load unread message status
   * @private
   */
  async _loadUnreadStatus() {
    try {
      // Get the latest data directly from the journal
      const journal = game.journal.get(this.journalEntry.id);
      if (!journal) {
        console.error(`${MODULE_ID} | Journal not found`);
        this.unreadMessages = new Set();
        return this.unreadMessages;
      }
      
      // Get the unread messages flag
      let unread = await journal.getFlag(MODULE_ID, "unreadMessages") || [];
      
      // Ensure unread is an array
      if (!Array.isArray(unread)) {
        console.warn(`${MODULE_ID} | Unread messages is not an array:`, unread);
        unread = [];
      }
      
      // IMPORTANT: Filter out messages that are persistently marked as read
      const filteredUnread = unread.filter(pageId => {
        const readStatusKey = `${MODULE_ID}-read-${journal.id}-${pageId}`;
        const isReadPersistently = localStorage.getItem(readStatusKey) === 'true';
        
        if (isReadPersistently) {
          console.log(`${MODULE_ID} | Found persistently read message, removing from unread: ${pageId}`);
          return false; // Remove from unread list
        }
        return true; // Keep in unread list
      });
      
      // Create a new Set to force reactivity
      this.unreadMessages = new Set(filteredUnread);
      
      console.log(`${MODULE_ID} | Loaded ${this.unreadMessages.size} unread messages for ${journal.name} (filtered from ${unread.length})`);
      console.log(`${MODULE_ID} | Unread messages IDs:`, Array.from(this.unreadMessages));
      
      return this.unreadMessages;
    } catch (error) {
      console.error(`${MODULE_ID} | Error loading unread status:`, error);
      this.unreadMessages = new Set();
      return this.unreadMessages;
    }
  }

  /**
   * Update all viewers with new messages
   * This static method can be called from anywhere to refresh all open viewers
   * @param {string} journalId - Journal ID
   * @param {string} pageId - Page ID of the new message
   * @static
   */
  static updateViewers(journalId, pageId) {
    console.log(`${MODULE_ID} | Static updateViewers called for journal ${journalId}, page ${pageId}`);
    
    // Find all open viewers for this journal
    const viewers = Object.values(ui.windows).filter(w => 
      w instanceof CyberpunkMessageViewer && 
      w.journalEntry?.id === journalId
    );
    
    // Update each viewer
    for (const viewer of viewers) {
      console.log(`${MODULE_ID} | Updating viewer:`, viewer);
      
      // Add the new page ID to unread messages
      if (pageId && viewer.unreadMessages instanceof Set) {
        viewer.unreadMessages.add(pageId);
      }
      
      // Force re-render
      viewer.render(true);
    }
    
    return viewers.length;
  }
  
  /**
   * Ensure the user has permission to access this journal
   * @private
   */
  _ensureJournalPermissions() {
    // Only run this for players, not for GMs
    if (game.user.isGM) return;
    
    const journal = this.journalEntry;
    if (!journal) return;
    
    // FIX: Use ownership system and more robust permission checking
    const userLevel = journal.getUserLevel(game.user);
    const requiredLevel = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
    
    // Check if this is the player's own journal
    const isOwnJournal = game.user.character && 
      journal.name === `${game.user.character.name}'s Messages`;
    
    // If it's their own journal and they don't have permission, directly set it
    if (isOwnJournal && userLevel < requiredLevel) {
      // Direct ownership update using v11+ system
      const ownership = foundry.utils.duplicate(journal.ownership);
      ownership[game.user.id] = requiredLevel;
      
      // Update journal ownership directly
      journal.update({ownership: ownership}).catch(err => {
        console.error(`${MODULE_ID} | Error updating ownership:`, err);
        // No fallback to request - we'll just log the error
      });
      
      // Don't show any notifications - just silently try to fix it
    }
  }

  
  /**
   * Mark a message as read
   * @param {string} pageId - Page ID
   * @returns {Promise<boolean>} Success flag
   */
  async markAsRead(pageId) {
    try {
      if (this.unreadMessages.has(pageId)) {
        console.log(`${MODULE_ID} | Marking message ${pageId} as read`);
        
        // Update local state immediately for UI responsiveness
        this.unreadMessages.delete(pageId);
        
        // Update UI first for better UX
        const messageElement = this.element.find(`.page-title[data-page-id="${pageId}"]`);
        messageElement.removeClass('message-unread');
        messageElement.find(".new-message-badge").remove();
        
        // IMPORTANT: Store the read status persistently in localStorage
        // This will survive viewer closes and page refreshes
        const readStatusKey = `${MODULE_ID}-read-${this.journalEntry.id}-${pageId}`;
        localStorage.setItem(readStatusKey, 'true');
        console.log(`${MODULE_ID} | Stored persistent read status for: ${pageId}`);
        
        // For players AND GMs, update the journal flag
        try {
          let unreadMessages = await this.journalEntry.getFlag(MODULE_ID, "unreadMessages") || [];
          if (!Array.isArray(unreadMessages)) unreadMessages = [];
          
          // Remove the pageId from unread messages
          const index = unreadMessages.indexOf(pageId);
          if (index > -1) {
            unreadMessages.splice(index, 1);
            
            // For non-GMs, use socket; for GMs, update directly
            if (!game.user.isGM) {
              // Send updated array via socket using your existing format
              game.socket.emit(`module.${MODULE_ID}`, {
                operation: 'requestUnreadUpdate',
                journalId: this.journalEntry.id,
                unreadMessages: unreadMessages
              });
              console.log(`${MODULE_ID} | Player sent unread update via socket`);
            } else {
              // GM updates directly
              await this.journalEntry.setFlag(MODULE_ID, "unreadMessages", unreadMessages);
              console.log(`${MODULE_ID} | GM updated unread messages directly`);
            }
          }
        } catch (error) {
          console.error(`${MODULE_ID} | Error updating unread status:`, error);
        }
        
        return true;
      }
      
      return false;
    } catch (error) {
      console.error(`${MODULE_ID} | Error marking message as read:`, error);
      return false;
    }
  }

  /**
   * Verify that unread status change persisted (for non-GM users)
   * @param {string} pageId - Page ID to verify
   * @private
   */
  async _verifyUnreadStatus(pageId) {
    try {
      // Reload the unread status from the journal
      const journal = game.journal.get(this.journalEntry.id);
      if (!journal) return;
      
      const currentUnread = await journal.getFlag(MODULE_ID, "unreadMessages") || [];
      
      // If the pageId is still in the unread list, the socket request failed
      if (currentUnread.includes(pageId)) {
        console.warn(`${MODULE_ID} | Unread status update failed for ${pageId}, retrying...`);
        
        // Try the socket request again
        game.socket.emit(`module.${MODULE_ID}`, {
          operation: 'requestUnreadUpdate',
          journalId: this.journalEntry.id,
          pageId: pageId,
          userId: game.user.id,
          action: 'remove',
          retry: true
        });
      } else {
        console.log(`${MODULE_ID} | Unread status successfully persisted for ${pageId}`);
      }
    } catch (error) {
      console.error(`${MODULE_ID} | Error verifying unread status:`, error);
    }
  }
  
  /**
   * Get unique senders from messages
   * @returns {Array} Unique sender names
   * @private
   */
  _getUniqueSenders() {
    const senders = new Set();
    this.journalEntry.pages.contents.forEach(page => {
      if (!page?.text?.content) return;
      
      const fromMatch = page.text.content.match(/\[From\](.+?)\[End\]/);
      if (fromMatch) {
        const sender = fromMatch[1].trim();
        // Extract name without email
        let displayName = sender.split('(')[0].trim();
        // Remove quotes for cleaner display
        displayName = displayName.replace(/"/g, '').trim();
        senders.add(displayName);
      }
    });
    return Array.from(senders).sort();
  }
  
  /**
   * Get filtered messages based on current category and filters
   * @returns {Array} Filtered messages
   * @private
   */
  _getFilteredMessages() {
    const allPages = this.journalEntry.pages.contents || [];
    let filteredPages = [...allPages];
    
    // Debug output for unread messages
    console.log(`${MODULE_ID} | Filtering messages. Unread messages:`, Array.from(this.unreadMessages));
    
    // IMPORTANT: Filter out messages hidden from player (deleted messages)
    if (!game.user.isGM) {
      filteredPages = filteredPages.filter(page => {
        const hiddenFromPlayer = page.getFlag ? page.getFlag(MODULE_ID, "hiddenFromPlayer") : false;
        if (hiddenFromPlayer) {
          console.log(`${MODULE_ID} | Hiding deleted message from player: ${page.id} (${page.name})`);
        }
        return !hiddenFromPlayer;
      });
    }
    
    // Filter by category
    switch (this.currentCategory) {
      case MESSAGE_CATEGORIES.SPAM:
        filteredPages = filteredPages.filter(page => this._isSpam(page));
        break;
      
      case MESSAGE_CATEGORIES.SAVED:
        filteredPages = filteredPages.filter(page => this._isSaved(page));
        break;
        
      case MESSAGE_CATEGORIES.SENT:
        // Filter for sent messages - show messages where the From matches current character
        const currentCharName = game.user.character?.name || "";
        filteredPages = filteredPages.filter(page => {
          const content = page.text?.content || "";
          const fromMatch = content.match(/\[From\](.+?)\[End\]/);
          if (!fromMatch) return false;
          
          const from = fromMatch[1].trim();
          return from.includes(currentCharName) || 
                 (game.user.isGM && from.includes("GM")); // GMs see all "sent" messages
        });
        break;
      
      case MESSAGE_CATEGORIES.INBOX:
      default:
        filteredPages = filteredPages.filter(page => !this._isSpam(page));
        break;
    }
    
    // Apply search term if present
    if (this.searchTerm && this.searchTerm.trim() !== "") {
      const searchLower = this.searchTerm.toLowerCase();
      filteredPages = filteredPages.filter(page => {
        const content = page.text?.content || "";
        const name = page.name || "";
        
        // Extract metadata for search
        const fromMatch = content.match(/\[From\](.+?)\[End\]/);
        const toMatch = content.match(/\[To\](.+?)\[End\]/);
        const subjectMatch = content.match(/\[Subject\](.+?)\[End\]/);
        
        // Get cleaned content for better search
        const cleanedContent = cleanHtmlContent(content).toLowerCase();
        
        // Check if search term appears in any relevant field
        return name.toLowerCase().includes(searchLower) || 
               (fromMatch && fromMatch[1].toLowerCase().includes(searchLower)) ||
               (toMatch && toMatch[1].toLowerCase().includes(searchLower)) ||
               (subjectMatch && subjectMatch[1].toLowerCase().includes(searchLower)) ||
               cleanedContent.includes(searchLower);
      });
    }
    
    // Apply advanced filters if they exist
    if (this.advancedFilters) {
      // Filter by sender
      if (this.advancedFilters.sender) {
        filteredPages = filteredPages.filter(page => {
          const content = page.text?.content || "";
          const fromMatch = content.match(/\[From\](.+?)\[End\]/);
          if (!fromMatch) return false;
          
          const sender = fromMatch[1].trim().toLowerCase();
          const filterSender = this.advancedFilters.sender.toLowerCase();
          
          return sender.includes(filterSender) || 
                  sender.replace(/"/g, '').includes(filterSender);
        });
      }
      
      // Filter by date range
      if (this.advancedFilters.dateFrom || this.advancedFilters.dateTo) {
        filteredPages = filteredPages.filter(page => {
          const content = page.text?.content || "";
          const dateMatch = content.match(/\[Date\](.+?)\[End\]/);
          if (!dateMatch) return false;
          
          const messageDate = dateMatch[1].trim();
          return this._isDateInRange(messageDate, 
                                  this.advancedFilters.dateFrom, 
                                  this.advancedFilters.dateTo);
        });
      }
      
      // Filter by unread (with persistent read status support)
      if (this.advancedFilters.unreadOnly) {
        filteredPages = filteredPages.filter(page => {
          // Check both the viewer's unread set AND persistent read status
          const isInUnreadSet = this.unreadMessages.has(page.id);
          const readStatusKey = `${MODULE_ID}-read-${this.journalEntry.id}-${page.id}`;
          const isReadPersistently = localStorage.getItem(readStatusKey) === 'true';
          
          // Message is unread if it's in the unread set AND not persistently marked as read
          return isInUnreadSet && !isReadPersistently;
        });
      }
    }
    
    // Sort filtered pages by date (newest first)
    // If dates are the same, sort by creation timestamp if available
    filteredPages.sort((a, b) => {
      const aDate = this._getMessageDate(a);
      const bDate = this._getMessageDate(b);
      
      // If dates are equal, try to sort by creation time
      if (aDate === bDate) {
        // Try to get creation time from flags
        const aCreated = a.getFlag ? a.getFlag(MODULE_ID, "createdAt") : null;
        const bCreated = b.getFlag ? b.getFlag(MODULE_ID, "createdAt") : null;
        
        // If both have creation timestamps, use them
        if (aCreated && bCreated) {
          return new Date(bCreated) - new Date(aCreated); // Newest first
        }
        
        // Fallback to journal page IDs (higher IDs are newer)
        return b.id.localeCompare(a.id);
      }
      
      // Different dates, use date comparison
      return bDate - aDate; // Newest first
    });
    
    // Update pagination
    this.totalPages = Math.ceil(filteredPages.length / this.messagesPerPage);
    this.currentPage = Math.min(this.currentPage, this.totalPages || 1);
    
    // Return the current page slice
    const startIndex = (this.currentPage - 1) * this.messagesPerPage;
    const endIndex = Math.min(startIndex + this.messagesPerPage, filteredPages.length);
    
    const finalPages = filteredPages.slice(startIndex, endIndex);
    
    // Debug output for final results
    console.log(`${MODULE_ID} | Filtered ${allPages.length} messages to ${filteredPages.length}, showing ${finalPages.length} on page ${this.currentPage}`);
    
    return finalPages;
  }
  
  /**
   * Check if a message is marked as spam
   * @param {JournalEntryPage} page - The page to check
   * @returns {boolean} Is spam
   * @private
   */
  _isSpam(page) {
    // Safety check for valid page object
    if (!page || typeof page.getFlag !== 'function' || !page.text?.content) {
      return false;
    }
    
    // Check cache first
    if (this.statusCache.has(page.id)) {
      const status = this.statusCache.get(page.id);
      if (status.spam !== undefined) return status.spam;
    }
    
    // Check flag
    try {
      const status = page.getFlag(MODULE_ID, "status");
      if (status && status.spam !== undefined) return status.spam;
    } catch (e) {
      console.warn(`${MODULE_ID} | Error checking spam flag:`, e);
    }
    
    // Check content for [SPAM] marker
    return page.text.content.includes('[SPAM]');
  }
  
  /**
   * Check if a message is marked as saved
   * @param {JournalEntryPage} page - The page to check
   * @returns {boolean} Is saved
   * @private
   */
  _isSaved(page) {
    // Safety check for valid page object
    if (!page || typeof page.getFlag !== 'function') {
      return false;
    }
    
    // Check cache first
    if (this.statusCache.has(page.id)) {
      const status = this.statusCache.get(page.id);
      if (status.saved !== undefined) return status.saved;
    }
    
    // Check flag
    try {
      const status = page.getFlag(MODULE_ID, "status");
      return status ? status.saved : false;
    } catch (e) {
      console.warn(`${MODULE_ID} | Error checking saved flag:`, e);
      return false;
    }
  }
  
  /**
   * Get message timestamp
   * @param {JournalEntryPage} page - The page to check
   * @returns {number} Timestamp
   * @private
   */
  _getMessageDate(page) {
    if (!page?.text?.content) return 0;
    
    const content = page.text.content;
    const dateMatch = content.match(/\[Date\](.+?)\[End\]/);
    const dateStr = dateMatch ? dateMatch[1].trim() : "";
    return parseDateTime(dateStr);
  }
  
  /**
   * Check if a date is within a range
   * @param {string} messageDate - Message date
   * @param {Date|null} fromDate - Start date
   * @param {Date|null} toDate - End date
   * @returns {boolean} In range
   * @private
   */
  _isDateInRange(messageDate, fromDate, toDate) {
    if (!messageDate) return false;
    if (!fromDate && !toDate) return true;
    
    const messageTime = parseDateTime(messageDate);
    if (!messageTime) return false;
    
    // Convert to Date objects
    const messageDateTime = new Date(messageTime);
    const fromDateTime = fromDate ? new Date(fromDate) : new Date(0);
    const toDateTime = toDate ? new Date(toDate) : new Date(8640000000000000); // Max date
    
    return messageDateTime >= fromDateTime && messageDateTime <= toDateTime;
  }
  
  /**
   * Save a message
   * @param {string} pageId - Page ID
   * @param {boolean} isSaved - Save state
   * @returns {Promise<boolean>} Success flag
   */
  async saveMessage(pageId, isSaved) {
    try {
      const page = this.journalEntry.pages.get(pageId);
      if (!page) return false;
      
      // Get current status
      const status = duplicate(page.getFlag(MODULE_ID, "status") || {});
      const newStatus = {...status, saved: isSaved};
      
      // Update the status cache immediately for responsive UI
      this.statusCache.set(pageId, newStatus);
      
      // For GMs, update directly
      if (game.user.isGM) {
        await page.update({
          [`flags.${MODULE_ID}.status`]: newStatus
        });
        return true;
      }
      
      // For players, use socket to request update
      game.socket.emit(`module.${MODULE_ID}`, {
        operation: 'updateMessageStatus',
        userId: game.user.id,
        journalId: this.journalEntry.id,
        pageId: pageId,
        status: newStatus
      });
      
      // Update local UI to look like it worked (for better UX)
      const button = this.element.find(`.action-btn.save-btn`);
      if (button.length) {
        if (isSaved) {
          button.addClass('active');
          button.html(`<i class="fas fa-star"></i> Unsave`);
        } else {
          button.removeClass('active');
          button.html(`<i class="fas fa-star"></i> Save`);
        }
      }
      
      return true;
    } catch (error) {
      console.error(`${MODULE_ID} | Error saving message:`, error);
      ui.notifications.error("Could not save message.");
      return false;
    }
  }
  
  /**
   * Mark a message as spam
   * @param {string} pageId - Page ID
   * @param {boolean} isSpam - Spam state
   * @returns {Promise<boolean>} Success flag
   */
  async markAsSpam(pageId, isSpam) {
    try {
      const page = this.journalEntry.pages.get(pageId);
      if (!page) return false;
      
      // Get current status and content
      const status = duplicate(page.getFlag(MODULE_ID, "status") || {});
      const newStatus = {...status, spam: isSpam};
      const rawContent = page.text.content;
      let newContent;
      
      // Modify content to add or remove [SPAM] marker
      if (isSpam && !rawContent.includes('[SPAM]')) {
        newContent = rawContent.replace('[Subject]', '[Subject] [SPAM]');
      } else if (!isSpam && rawContent.includes('[SPAM]')) {
        newContent = rawContent.replace('[SPAM] ', '');
      } else {
        newContent = rawContent;
      }
      
      // Update the status cache immediately
      this.statusCache.set(pageId, newStatus);
      
      // For GMs, update directly
      if (game.user.isGM) {
        await page.update({
          "text.content": newContent,
          [`flags.${MODULE_ID}.status`]: newStatus
        });
        return true;
      }
      
      // For players, use socket to request update
      game.socket.emit(`module.${MODULE_ID}`, {
        operation: 'updateMessageStatus',
        userId: game.user.id,
        journalId: this.journalEntry.id,
        pageId: pageId,
        status: newStatus,
        content: newContent
      });
      
      // Update local UI to look like it worked (for better UX)
      const button = this.element.find(`.action-btn.spam-btn`);
      if (button.length) {
        if (isSpam) {
          button.addClass('active');
          button.html(`<i class="fas fa-exclamation-triangle"></i> Unspam`);
        } else {
          button.removeClass('active');
          button.html(`<i class="fas fa-exclamation-triangle"></i> Spam`);
        }
      }
      
      return true;
    } catch (error) {
      console.error(`${MODULE_ID} | Error marking as spam:`, error);
      ui.notifications.error("Could not update message.");
      return false;
    }
  }
  
  /**
   * Format journal content for export/display
   * @param {string} content - Message content
   * @returns {string} Formatted content
   * @private
   */
  _formatJournalContent(content) {
    if (!content) return '';
    
    // Extract metadata
    const dateMatch = content.match(/\[Date\](.+?)\[End\]/);
    const fromMatch = content.match(/\[From\](.+?)\[End\]/);
    const toMatch = content.match(/\[To\](.+?)\[End\]/);
    const subjectMatch = content.match(/\[Subject\](.+?)\[End\]/);
    
    const date = dateMatch ? dateMatch[1].trim() : "Unknown Date";
    const from = fromMatch ? fromMatch[1].trim() : "Unknown Sender";
    const to = toMatch ? toMatch[1].trim() : "Unknown Recipient";
    const subject = subjectMatch ? subjectMatch[1].trim() : "No Subject";
    
    // Extract the actual message content
    let messageBody = content;
    messageBody = messageBody.replace(/\[Date\].*?\[End\]/gs, "");
    messageBody = messageBody.replace(/\[From\].*?\[End\]/gs, "");
    messageBody = messageBody.replace(/\[To\].*?\[End\]/gs, "");
    messageBody = messageBody.replace(/\[Subject\].*?\[End\]/gs, "");
    messageBody = messageBody.trim();
    
    // Create a nicely formatted journal page
    return `
  <div class="journal-entry-content">
    <div class="message-metadata">
  [Date] ${date} [End]
  [From] ${from} [End]
  [To] ${to} [End]
  [Subject] ${subject} [End]
    </div>
    <div class="message-body">
  ${messageBody}
    </div>
  </div>
      `;
  }
  
  /**
   * Reply to a message
   * @param {string} pageId - Page ID
   */
  async replyToMessage(pageId) {
    const page = this.journalEntry.pages.get(pageId);
    if (!page) return;
    
    const content = page.text.content;
    const fromMatch = content.match(/\[From\](.+?)\[End\]/);
    const subjectMatch = content.match(/\[Subject\](.+?)\[End\]/);
    const dateMatch = content.match(/\[Date\](.+?)\[End\]/);
    
    if (!fromMatch) {
      ui.notifications.error("Cannot determine message sender for reply.");
      return;
    }
    
    // Extract recipient data
    const to = fromMatch[1].trim();
    const subject = subjectMatch ? 
      `RE: ${subjectMatch[1].trim().replace(/^RE:\s*/, '')}` :
      "RE: No Subject";
    
    // Extract original message info for quoting
    const date = dateMatch ? dateMatch[1].trim() : "Unknown Date";
    const sender = fromMatch[1].trim().split('(')[0].trim();
    const originalSubject = subjectMatch ? subjectMatch[1].trim() : "No Subject";
    
    // Clean the original content for quoting
    const originalContent = cleanHtmlContent(content);
    
    // Create the quoted reply content
    const quoteContent = `
<p></p>
<div style="padding: 10px; margin: 10px 0; border-left: 2px solid #F65261; background: rgba(246, 82, 97, 0.1);">
  <p><strong>On ${date}, ${sender} wrote:</strong></p>
  <p><strong>Subject:</strong> ${originalSubject}</p>
  ${originalContent}
</div>
<p></p>
    `;
    
    // Open composer with pre-filled fields
    NightCityMessenger.openComposer({
      to: to,
      subject: subject,
      content: quoteContent,
      replyTo: {
        id: page.id,
        content: page.text.content
      }
    });
  }

  /**
   * Handle delete message button
   * @param {Event} event - Click event
   * @private
   */
  async _onDeleteMessage(event) {
    if (getSetting('enableSounds')) {
      try {
        AUDIO.click.play().catch(e => console.warn("Audio play failed:", e));
      } catch (e) {
        console.warn("Could not play audio:", e);
      }
    }
    
    if (!this.selectedPage) {
      ui.notifications.error("No message selected to delete");
      return;
    }
    
    const pageId = this.selectedPage.id;
    const messageName = this.selectedPage.name;
    
    // Confirmation dialog
    const confirmed = await Dialog.confirm({
      title: "Delete Message",
      content: `<div style="margin-bottom: 15px;">
        <p><strong>Delete this message?</strong></p>
        <p style="font-style: italic; color: #666;">"${messageName}"</p>
        <hr>
        <p style="font-size: 0.9em; color: #888;">
          ${game.user.isGM ? 
            'As GM, this will permanently delete the message.' : 
            'This will send a deletion request to the GM for review.'}
        </p>
      </div>`,
      yes: () => true,
      no: () => false,
      defaultYes: false
    });
    
    if (!confirmed) return;
    
    // Call the delete function
    const success = await this.deleteMessage(pageId);
    
    if (success) {
      // Clear selection and refresh
      this.selectedPage = null;
      this.render(true);
      
      const action = game.user.isGM ? 'deleted' : 'marked for deletion';
      ui.notifications.info(`Message ${action} successfully`);
    }
  }

  /**
   * Delete a message (or request deletion for players)
   * @param {string} pageId - Page ID to delete
   * @returns {Promise<boolean>} Success status
   */
  async deleteMessage(pageId) {
    try {
      const page = this.journalEntry.pages.get(pageId);
      if (!page) {
        ui.notifications.error("Message not found");
        return false;
      }
      
      if (game.user.isGM) {
        // GM can delete directly
        return await this._deleteMessageDirectly(pageId);
      } else {
        // Player sends deletion request
        return await this._requestMessageDeletion(pageId);
      }
    } catch (error) {
      console.error(`${MODULE_ID} | Error deleting message:`, error);
      ui.notifications.error("Failed to delete message");
      return false;
    }
  }

  /**
   * GM direct deletion
   * @param {string} pageId - Page ID to delete
   * @returns {Promise<boolean>} Success status
   * @private
   */
  async _deleteMessageDirectly(pageId) {
    try {
      const page = this.journalEntry.pages.get(pageId);
      if (!page) return false;
      
      // Remove from unread messages flag
      let unreadMessages = await this.journalEntry.getFlag(MODULE_ID, "unreadMessages") || [];
      if (Array.isArray(unreadMessages)) {
        const index = unreadMessages.indexOf(pageId);
        if (index > -1) {
          unreadMessages.splice(index, 1);
          await this.journalEntry.setFlag(MODULE_ID, "unreadMessages", unreadMessages);
        }
      }
      
      // Remove from local unread set
      this.unreadMessages.delete(pageId);
      
      // Clean up persistent read status
      const readStatusKey = `${MODULE_ID}-read-${this.journalEntry.id}-${pageId}`;
      localStorage.removeItem(readStatusKey);
      
      // Delete the page
      await this.journalEntry.deleteEmbeddedDocuments("JournalEntryPage", [pageId]);
      
      console.log(`${MODULE_ID} | GM deleted message: ${pageId}`);
      return true;
    } catch (error) {
      console.error(`${MODULE_ID} | Error in GM direct deletion:`, error);
      return false;
    }
  }

  /**
   * Player deletion request
   * @param {string} pageId - Page ID to request deletion for
   * @returns {Promise<boolean>} Success status
   * @private
   */
  // =========================================================================
  // FIXED DELETE SYSTEM - Now Uses Your Working Socket Handler
  // Replace these methods in your messageViewer.js
  // =========================================================================

  /**
   * Ensure deleted messages journal exists - FIXED to use socket system
   * Replace your _ensureDeletedMessagesJournal method with this version
   */
  async _ensureDeletedMessagesJournal() {
    try {
      const characterName = game.user.character?.name || "Unknown";
      const journalName = `${characterName} Deleted Messages`;
      
      // Check if journal already exists
      let deletedJournal = game.journal.getName(journalName);
      
      if (!deletedJournal) {
        if (game.user.isGM) {
          // GM can create both folder and journal
          console.log(`${MODULE_ID} | GM creating deleted messages structure`);
          
          // Get or create the Deleted Messages folder
          let folder = game.folders.find(f => 
            f.name === "Deleted Messages" && 
            f.type === "JournalEntry"
          );
          
          if (!folder) {
            folder = await Folder.create({
              name: "Deleted Messages",
              type: "JournalEntry",
              parent: null,
              color: "#ff0000",
              flags: {
                [MODULE_ID]: {
                  isDeletedMessagesFolder: true
                }
              }
            });
            console.log(`${MODULE_ID} | GM created Deleted Messages folder`);
          }
          
          // Create the journal
          deletedJournal = await JournalEntry.create({
            name: journalName,
            folder: folder.id,
            flags: {
              [MODULE_ID]: {
                isDeletedMessagesJournal: true,
                characterName: characterName
              }
            }
          });
          
          console.log(`${MODULE_ID} | GM created deleted messages journal: ${journalName}`);
        } else {
          // Player requests GM to create folder structure via socket
          console.log(`${MODULE_ID} | Player requesting GM to create deleted messages structure`);
          
          game.socket.emit(`module.${MODULE_ID}`, {
            operation: 'createDeletedMessagesStructure',
            characterName: characterName,
            userId: game.user.id
          });
          
          // Try to create journal without folder for now
          try {
            deletedJournal = await JournalEntry.create({
              name: journalName,
              folder: null, // No folder to avoid permission issues
              flags: {
                [MODULE_ID]: {
                  isDeletedMessagesJournal: true,
                  characterName: characterName
                }
              }
            });
            
            console.log(`${MODULE_ID} | Player created deleted messages journal without folder: ${journalName}`);
          } catch (journalError) {
            console.error(`${MODULE_ID} | Player could not create journal either:`, journalError);
            return null;
          }
        }
      }
      
      return deletedJournal;
    } catch (error) {
      console.error(`${MODULE_ID} | Error ensuring deleted messages journal:`, error);
      
      // Final fallback: create journal without folder
      if (!game.user.isGM) {
        try {
          const characterName = game.user.character?.name || "Unknown";
          const journalName = `${characterName} Deleted Messages`;
          
          console.log(`${MODULE_ID} | Attempting final fallback journal creation`);
          
          const fallbackJournal = await JournalEntry.create({
            name: journalName,
            folder: null,
            flags: {
              [MODULE_ID]: {
                isDeletedMessagesJournal: true,
                characterName: characterName
              }
            }
          });
          
          console.log(`${MODULE_ID} | Created fallback deleted messages journal`);
          return fallbackJournal;
        } catch (fallbackError) {
          console.error(`${MODULE_ID} | Final fallback also failed:`, fallbackError);
          return null;
        }
      }
      
      return null;
    }
  }

  /**
   * Player deletion request - ENHANCED to use socket fallback
   * Replace your _requestMessageDeletion method with this version
   */
  async _requestMessageDeletion(pageId) {
    try {
      const page = this.journalEntry.pages.get(pageId);
      if (!page) return false;
      
      const characterName = game.user.character?.name || game.user.name;
      const currentTime = getCurrentDateTime();
      
      // Hide the message from player's view immediately (good UX)
      await page.setFlag(MODULE_ID, "hiddenFromPlayer", true);
      
      // Remove from unread messages for the player
      let unreadMessages = await this.journalEntry.getFlag(MODULE_ID, "unreadMessages") || [];
      if (Array.isArray(unreadMessages)) {
        const index = unreadMessages.indexOf(pageId);
        if (index > -1) {
          unreadMessages.splice(index, 1);
          await this.journalEntry.setFlag(MODULE_ID, "unreadMessages", unreadMessages);
        }
      }
      
      // Remove from local unread set
      this.unreadMessages.delete(pageId);
      
      // Clean up persistent read status
      const readStatusKey = `${MODULE_ID}-read-${this.journalEntry.id}-${pageId}`;
      localStorage.removeItem(readStatusKey);
      
      // Try to create full deletion request
      const deletedJournal = await this._ensureDeletedMessagesJournal();
      
      if (deletedJournal) {
        // Create detailed deletion request entry
        const deletionContent = `
  <div style="background: #330000; border: 2px solid #F65261; border-radius: 8px; padding: 15px; margin-bottom: 15px;">
    <div style="color: #F65261; font-weight: bold; font-size: 1.2em; margin-bottom: 10px;">
      🗑️ DELETION REQUEST
    </div>
    <div style="color: #ffffff; margin-bottom: 10px;">
      <strong>Requested by:</strong> ${characterName}<br>
      <strong>Request Time:</strong> ${currentTime}<br>
      <strong>Original Journal:</strong> ${this.journalEntry.name}<br>
      <strong>Message ID:</strong> ${pageId}
    </div>
    <div style="background: rgba(246, 82, 97, 0.1); padding: 10px; border-radius: 4px; margin-top: 10px;">
      <strong style="color: #F65261;">GM Actions:</strong><br>
      <em>Review the message below and decide whether to approve or deny this deletion request.</em>
    </div>
  </div>

  <div style="background: #1a1a1a; border: 1px solid #666; border-radius: 4px; padding: 15px;">
    <div style="color: #19f3f7; font-weight: bold; margin-bottom: 10px;">ORIGINAL MESSAGE CONTENT:</div>
    ${page.text.content}
  </div>`;
        
        // Create the deletion request page
        await deletedJournal.createEmbeddedDocuments("JournalEntryPage", [{
          name: `DELETE REQUEST: ${page.name} [${characterName}]`,
          type: "text",
          text: {
            content: deletionContent
          },
          flags: {
            [MODULE_ID]: {
              isDeletionRequest: true,
              originalPageId: pageId,
              originalJournalId: this.journalEntry.id,
              requestedBy: characterName,
              requestedByUserId: game.user.id,
              requestTime: currentTime,
              originalMessageName: page.name,
              status: 'pending'
            }
          }
        }]);
        
        console.log(`${MODULE_ID} | Created detailed deletion request for: ${pageId}`);
        
        // Send detailed chat notification to GM
        ChatMessage.create({
          content: `
  <div style="background: #330000; border: 2px solid #F65261; border-radius: 8px; padding: 15px; color: #ffffff;">
    <div style="color: #F65261; font-weight: bold; font-size: 1.1em; margin-bottom: 10px;">
      🗑️ MESSAGE DELETION REQUEST
    </div>
    <div>
      <strong>${characterName}</strong> has requested to delete the message:<br>
      <em>"${page.name}"</em>
    </div>
    <div style="margin-top: 10px; padding: 10px; background: rgba(246, 82, 97, 0.1); border-radius: 4px;">
      <strong>Action Required:</strong> Check the "Deleted Messages" folder to review and approve/deny this request.
    </div>
  </div>`,
          whisper: game.users.filter(u => u.isGM).map(u => u.id),
          speaker: { alias: "Night City Messenger System" }
        });
      } else {
        // Fallback: Use socket system for simple notification
        console.log(`${MODULE_ID} | Using socket fallback for deletion request`);
        
        game.socket.emit(`module.${MODULE_ID}`, {
          operation: 'deletionRequest',
          originalPageId: pageId,
          originalJournalId: this.journalEntry.id,
          requestedBy: characterName,
          requestedByUserId: game.user.id,
          requestTime: currentTime,
          originalMessageName: page.name,
          originalMessageContent: page.text.content
        });
      }
      
      console.log(`${MODULE_ID} | Deletion request processed for: ${pageId}`);
      return true;
      
    } catch (error) {
      console.error(`${MODULE_ID} | Error creating deletion request:`, error);
      ui.notifications.error(`Failed to create deletion request: ${error.message}`);
      return false;
    }
  }

  /**
   * Ensure deleted messages journal exists
   * @returns {Promise<JournalEntry>} The deleted messages journal
   * @private
   */
  async _ensureDeletedMessagesJournal() {
    try {
      const characterName = game.user.character?.name || "Unknown";
      const journalName = `${characterName} Deleted Messages`;
      
      // Check if journal already exists
      let deletedJournal = game.journal.getName(journalName);
      
      if (!deletedJournal) {
        if (game.user.isGM) {
          // GM can create both folder and journal
          console.log(`${MODULE_ID} | GM creating deleted messages structure`);
          
          // Get or create the Deleted Messages folder
          let folder = game.folders.find(f => 
            f.name === "Deleted Messages" && 
            f.type === "JournalEntry"
          );
          
          if (!folder) {
            folder = await Folder.create({
              name: "Deleted Messages",
              type: "JournalEntry",
              parent: null,
              color: "#ff0000",
              flags: {
                [MODULE_ID]: {
                  isDeletedMessagesFolder: true
                }
              }
            });
            console.log(`${MODULE_ID} | GM created Deleted Messages folder`);
          }
          
          // Create the journal
          deletedJournal = await JournalEntry.create({
            name: journalName,
            folder: folder.id,
            flags: {
              [MODULE_ID]: {
                isDeletedMessagesJournal: true,
                characterName: characterName
              }
            }
          });
          
          console.log(`${MODULE_ID} | GM created deleted messages journal: ${journalName}`);
        } else {
          // Player requests GM to create folder structure via socket
          console.log(`${MODULE_ID} | Player requesting GM to create deleted messages structure`);
          
          game.socket.emit(`module.${MODULE_ID}`, {
            operation: 'createDeletedMessagesStructure',
            characterName: characterName,
            userId: game.user.id
          });
          
          // Try to create journal without folder for now
          try {
            deletedJournal = await JournalEntry.create({
              name: journalName,
              folder: null, // No folder to avoid permission issues
              flags: {
                [MODULE_ID]: {
                  isDeletedMessagesJournal: true,
                  characterName: characterName
                }
              }
            });
            
            console.log(`${MODULE_ID} | Player created deleted messages journal without folder: ${journalName}`);
          } catch (journalError) {
            console.error(`${MODULE_ID} | Player could not create journal either:`, journalError);
            return null;
          }
        }
      }
      
      return deletedJournal;
    } catch (error) {
      console.error(`${MODULE_ID} | Error ensuring deleted messages journal:`, error);
      
      // Final fallback: create journal without folder
      if (!game.user.isGM) {
        try {
          const characterName = game.user.character?.name || "Unknown";
          const journalName = `${characterName} Deleted Messages`;
          
          console.log(`${MODULE_ID} | Attempting final fallback journal creation`);
          
          const fallbackJournal = await JournalEntry.create({
            name: journalName,
            folder: null,
            flags: {
              [MODULE_ID]: {
                isDeletedMessagesJournal: true,
                characterName: characterName
              }
            }
          });
          
          console.log(`${MODULE_ID} | Created fallback deleted messages journal`);
          return fallbackJournal;
        } catch (fallbackError) {
          console.error(`${MODULE_ID} | Final fallback also failed:`, fallbackError);
          return null;
        }
      }
      
      return null;
    }
  }
  
  /**
   * Forward a message
   * @param {string} pageId - Page ID
   */
  async forwardMessage(pageId) {
    const page = this.journalEntry.pages.get(pageId);
    if (!page) return;
    
    const content = page.text.content;
    const subjectMatch = content.match(/\[Subject\](.+?)\[End\]/);
    const fromMatch = content.match(/\[From\](.+?)\[End\]/);
    const dateMatch = content.match(/\[Date\](.+?)\[End\]/);
    
    const subject = subjectMatch ? 
      `FWD: ${subjectMatch[1].trim().replace(/^FWD:\s*/, '')}` :
      "FWD: No Subject";
    
    // Get additional metadata for the forwarded message
    const date = dateMatch ? dateMatch[1].trim() : "Unknown Date";
    const sender = fromMatch ? fromMatch[1].trim() : "Unknown Sender";
    
    // Clean the content and format as a forwarded message
    const messageContent = cleanHtmlContent(content);
    const forwardedContent = `
<div style="padding: 10px; margin: 10px 0; border-left: 2px solid #19f3f7; background: rgba(25, 243, 247, 0.1);">
  <p style="color: #19f3f7;">---------- Forwarded Message ----------</p>
  <p><strong>From:</strong> ${sender}</p>
  <p><strong>Date:</strong> ${date}</p>
  <p><strong>Subject:</strong> ${subjectMatch ? subjectMatch[1].trim() : "No Subject"}</p>
  <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(25, 243, 247, 0.3);">
    ${messageContent}
  </div>
  <p style="color: #19f3f7;">--------------------------------------</p>
</div>
<p></p>
    `;
    
    // Open composer with pre-filled fields
    NightCityMessenger.openComposer({
      subject: subject,
      content: forwardedContent,
      forwardFrom: {
        id: page.id,
        content: page.text.content
      }
    });
  }
  
  /**
   * Export a message
   * @param {string} pageId - Page ID
   * @param {string} exportType - Export type
   * @param {string} name - Export name
   * @param {Object} options - Export options
   * @returns {Promise<Document>} Created document
   */
  async exportMessage(pageId, exportType, name, options = {}) {
    const page = this.journalEntry.pages.get(pageId);
    if (!page) return null;
    
    const content = page.text.content;
    const formattedContent = this._formatJournalContent(content);
    
    try {
      if (exportType === 'journal') {
        // Create a new journal entry with formatted content
        return await JournalEntry.create({
          name: name || page.name,
          content: formattedContent,
          folder: this.journalEntry.folder,
          // Include flags for proper display
          flags: {
            [MODULE_ID]: {
              isExportedMessage: true,
              originalMessageId: pageId,
              originalJournalId: this.journalEntry.id
            }
          }
        });
      } else if (exportType === 'item') {
        // For systems that support data shards or similar items
        const itemData = {
          name: name || page.name,
          type: 'data_shard',
          img: "icons/svg/tablet.svg"
        };
        
        // Handle different system data structures
        if (game.system.id === 'cyberpunkred') {
          // Cyberpunk RED specific item data
          itemData.system = {
            description: formattedContent,
            isreadonly: options.encrypted || false,
            owner: game.user.character ? game.user.character.name : "Unknown",
            equipped: false
          };
        } else {
          // Generic fallback
          itemData.data = {
            description: formattedContent,
            source: this.characterName,
            date: new Date().toISOString()
          };
        }
        
        // Set flags for potential future use
        itemData.flags = {
          [MODULE_ID]: {
            isExportedMessage: true,
            originalMessageId: pageId,
            originalJournalId: this.journalEntry.id,
            encrypted: options.encrypted || false
          }
        };
        
        return await Item.create(itemData);
      }
      
      return null;
    } catch (error) {
      console.error(`${MODULE_ID} | Error exporting message:`, error);
      ui.notifications.error("Failed to export message. Check console for errors.");
      return null;
    }
  }

  /**
   * Force refresh with the latest data
   * This should be called when the inbox needs updating
   */
  async forceRefresh(newPageId = null) {
    console.log(`${MODULE_ID} | Force refreshing viewer for journal: ${this.journalEntry.id}`);
    
    // Clear any cached data
    this.statusCache.clear();
    
    // Reload the journal to get any updates
    const journal = game.journal.get(this.journalEntry.id);
    if (!journal) {
      console.error(`${MODULE_ID} | Journal not found in forceRefresh: ${this.journalEntry.id}`);
      return;
    }
    
    // Update our journal reference
    this.journalEntry = journal;
    
    // Force reload unread status with persistent read filtering
    try {
      const unreadFlag = await journal.getFlag(MODULE_ID, "unreadMessages") || [];
      console.log(`${MODULE_ID} | forceRefresh got unread flag:`, unreadFlag);
      
      // Filter based on persistent read status
      const filteredUnread = unreadFlag.filter(pageId => {
        const readStatusKey = `${MODULE_ID}-read-${journal.id}-${pageId}`;
        const isReadPersistently = localStorage.getItem(readStatusKey) === 'true';
        
        if (isReadPersistently) {
          console.log(`${MODULE_ID} | forceRefresh: Preserving read status for: ${pageId}`);
          return false; // Remove from unread list
        }
        return true; // Keep in unread list
      });
      
      // Create new Set with filtered data
      this.unreadMessages = new Set(filteredUnread);
      
      console.log(`${MODULE_ID} | forceRefresh: Filtered unread from ${unreadFlag.length} to ${filteredUnread.length}`);
      
      // If we have a specific new page ID, select it and ensure it's marked unread
      if (newPageId && journal.pages.has(newPageId)) {
        console.log(`${MODULE_ID} | forceRefresh selecting new page: ${newPageId}`);
        this.selectedPage = journal.pages.get(newPageId);
        
        // Make sure the new page is actually in the unread set (unless persistently read)
        const readStatusKey = `${MODULE_ID}-read-${journal.id}-${newPageId}`;
        const isNewPageRead = localStorage.getItem(readStatusKey) === 'true';
        
        if (!isNewPageRead) {
          this.unreadMessages.add(newPageId);
        }
      }
      
      // Force render with true to ensure complete refresh
      this.render(true);
    } catch (error) {
      console.error(`${MODULE_ID} | Error in forceRefresh:`, error);
    }
  }

  /**
   * Start polling for new messages
   * @private
   */
  _startPolling() {
    this._stopPolling();
    
    this._pollingInterval = setInterval(async () => {
      // Only poll if visible and not minimized
      if (!this.rendered || this._element?.hasClass('minimized')) return;
      
      try {
        // Check for unread messages first
        const journal = game.journal.get(this.journalEntry.id);
        if (journal) {
          // Get unread messages flag
          const unreadFlag = await journal.getFlag(MODULE_ID, "unreadMessages");
          
          // If flag doesn't exist or isn't an array, skip
          if (!Array.isArray(unreadFlag)) return;
          
          // Check for changes
          const currentUnread = Array.from(this.unreadMessages || []);
          const hasChanges = unreadFlag.length !== currentUnread.length || 
                             unreadFlag.some(id => !currentUnread.includes(id));
          
          if (hasChanges) {
            console.log(`${MODULE_ID} | Polling found changes, applying persistent read status...`);
            
            // Filter the unread flag based on persistent read status
            const filteredUnread = unreadFlag.filter(pageId => {
              const readStatusKey = `${MODULE_ID}-read-${this.journalEntry.id}-${pageId}`;
              const isReadPersistently = localStorage.getItem(readStatusKey) === 'true';
              
              if (isReadPersistently) {
                console.log(`${MODULE_ID} | Polling: Preserving read status for: ${pageId}`);
                return false; // Remove from unread list
              }
              return true; // Keep in unread list
            });
            
            // Update with the filtered unread list
            this.unreadMessages = new Set(filteredUnread);
            
            console.log(`${MODULE_ID} | Polling: Updated unread count from ${unreadFlag.length} to ${filteredUnread.length}`);
            this.render(true);
          }
        }

        // Check scheduled messages - only for GM and less frequently
        if (game.user.isGM && this._lastScheduledCheck === undefined || 
            (Date.now() - this._lastScheduledCheck) > 60000) { // Once per minute
          this._lastScheduledCheck = Date.now();
          
          // Auto-check scheduled messages
          if (game.user.isGM && game.nightcity?.messenger?.checkScheduledMessages) {
            console.log(`${MODULE_ID} | Polling checking scheduled messages`);
            this._checkScheduledMessagesAutoSend();
          }
        }
      } catch (error) {
        console.error(`${MODULE_ID} | Error in polling:`, error);
      }
    }, 10000); // Check every 10 seconds
  }

  /**
   * New method to auto-check and send scheduled messages
   * @private
   */
  async _checkScheduledMessagesAutoSend() {
    // Get scheduled messages
    const scheduledMessages = game.settings.get(MODULE_ID, "scheduledMessages") || [];
    if (scheduledMessages.length === 0) return;
    
    // Get manager class if needed
    if (!game.nightcity?.ScheduledMessagesManager) return;
    
    const ManagerClass = game.nightcity.ScheduledMessagesManager;
    
    // Create temporary instance
    const manager = new ManagerClass();
    
    // Check for and auto-send past-due messages
    await manager._autoSendPastDueMessages();
  }

  /**
   * Stop polling for new messages
   * @private
   */
  _stopPolling() {
    if (this._pollingInterval) {
      clearInterval(this._pollingInterval);
      this._pollingInterval = null;
      console.log(`${MODULE_ID} | Stopped polling for new messages`);
    }
  }
  
  /**
   * Scroll to a specific message
   * @param {string} pageId - Page ID
   */
  scrollToMessage(pageId) {
    // Make sure the message is in the current view
    this.selectedPage = this.journalEntry.pages.get(pageId);
    
    // Mark the message as read
    this.markAsRead(pageId);
    
    // Re-render to update the view
    this.render(true);
    
    // Scroll to the message after render
    this.element.ready(() => {
      const messageElement = this.element.find(`.page-title[data-page-id="${pageId}"]`);
      if (messageElement.length) {
        messageElement.get(0).scrollIntoView({ behavior: 'smooth' });
        messageElement.addClass('highlight-message');
        
        // Remove highlight after animation
        setTimeout(() => {
          messageElement.removeClass('highlight-message');
        }, 2000);
      }
    });
  }
  
  /**
   * Set advanced filters
   * @param {Object} filters - Filter object
   */
  setAdvancedFilters(filters) {
    this.advancedFilters = filters;
    this.currentPage = 1; // Reset to first page
    this.render(true);
  }
  
  /**
   * Clear advanced filters
   */
  clearAdvancedFilters() {
    this.advancedFilters = null;
    this.render(true);
  }
  
  /**
   * Set current category
   * @param {string} category - Category name
   */
  setCategory(category) {
    if (Object.values(MESSAGE_CATEGORIES).includes(category)) {
      this.currentCategory = category;
      this.currentPage = 1; // Reset to first page
      this.render(true);
    }
  }
  
  /**
   * Close the application
   */
  close(options = {}) {
    if (getSetting('enableSounds')) {
      try {
        AUDIO.close.play().catch(e => console.warn("Audio play failed:", e));
      } catch (e) {
        console.warn("Could not play audio:", e);
      }
    }
    return super.close(options);
  }
  
  /**
   * Activate application listeners
   * @param {jQuery} html - The app HTML
   */
  activateListeners(html) {
    super.activateListeners(html);
    
    // Message selection
    html.find('.page-title').click(ev => this._onMessageClick(ev));
    
    // Category buttons
    html.find('.category-btn').click(ev => this._onCategoryClick(ev));
    
    // Search input - enable input and handle searching
    const searchInput = html.find('.search-input');
    searchInput.prop('disabled', false);
    searchInput.on('input', ev => this._onSearch(ev));
    
    // Settings gear
    html.find('.settings-gear').click(ev => this._onSettingsClick(ev));

    // Add scheduled button handler
    html.find('.scheduled-btn').click(ev => this._onScheduledClick(ev));

    // Add GM tools button handler
    html.find('.gm-tools-button').click(ev => this._onGMToolsClick(ev));
    
    // Combined filter button
    html.find('.filter-button').click(ev => this._onAdvancedFilterToggle(ev));
    html.find('.apply-filters').click(ev => this._onApplyAdvancedFilters(ev));
    html.find('.reset-filters').click(ev => this._onResetAdvancedFilters(ev));
    
    // Pagination
    html.find('.prev-page').click(ev => this._onPrevPage(ev));
    html.find('.next-page').click(ev => this._onNextPage(ev));
    
    // Message actions
    html.find('.action-btn.save-btn').click(ev => this._onSaveMessage(ev));
    html.find('.action-btn.spam-btn').click(ev => this._onMarkAsSpam(ev));
    html.find('.action-btn.reply-btn').click(ev => this._onReplyMessage(ev));
    html.find('.action-btn.forward-btn').click(ev => this._onForwardMessage(ev));
    html.find('.action-btn.export-btn').click(ev => this._onExportMessage(ev));
    html.find('.action-btn.share-btn').click(ev => this._onShareMessage(ev));
    html.find('.action-btn.delete-btn').click(ev => this._onDeleteMessage(ev));

    // Compose new message buttons
    html.find('.compose-new-btn, .compose-new-btn-large').click(ev => this._onComposeNewMessage(ev));
    
    // Remove document-level click handlers when component is closed
    // Using jQuery's event namespace instead of this.on
    const appId = this.id;
    
    // Add cleanup function to application options
    this.options.closeCallback = () => {
      $(document).off(`click.nightcity-filter-${appId}`);
    };
    
    // Add namespaced document click handlers
    $(document).on(`click.nightcity-filter-${appId}`, ev => {
      if (!$(ev.target).closest('.advanced-filter-panel, .filter-button').length) {
        html.find('.advanced-filter-panel').removeClass('active');
      }
    });
    
  }

  /**
   * Clean up event listeners when closing
   * Add this method to CyberpunkMessageViewer
   */
  close(options = {}) {
    // Call the closeCallback if it exists
    if (this.options.closeCallback) {
      this.options.closeCallback();
    }
    
    if (getSetting('enableSounds')) {
      try {
        AUDIO.close.play().catch(e => console.warn("Audio play failed:", e));
      } catch (e) {
        console.warn("Could not play audio:", e);
      }
    }
    
    return super.close(options);
  }

  // New method to handle scheduled button click
  /**
   * Handle scheduled messages button click
   * @param {Event} event - Click event
   * @private
   */
  _onScheduledClick(event) {
    event.preventDefault();
    
    if (getSetting('enableSounds')) {
      try {
        AUDIO.click.play().catch(e => console.warn("Audio play failed:", e));
      } catch (e) {
        console.warn("Could not play audio:", e);
      }
    }
    
    // Open the scheduled messages manager
    if (game.nightcity?.messenger?.openScheduledMessagesManager) {
      game.nightcity.messenger.openScheduledMessagesManager();
    } else {
      ui.notifications.warn("Scheduled messages feature not available");
    }
  }

  /**
   * Handle GM tools button click
   * @param {Event} event - Click event
   * @private
   */
  _onGMToolsClick(event) {
    event.preventDefault();
    
    if (getSetting('enableSounds')) {
      try {
        AUDIO.click.play().catch(e => console.warn("Audio play failed:", e));
      } catch (e) {
        console.warn("Could not play audio:", e);
      }
    }
    
    // Open the GM Mail Admin Panel
    if (game.nightcity?.GMMailAdmin) {
      const adminPanel = new game.nightcity.GMMailAdmin();
      adminPanel.render(true);
    } else {
      ui.notifications.warn("GM Mail Admin not available");
    }
  }
  
  /**
   * Handle settings gear click
   * @param {Event} event - Click event
   * @private
   */
  _onSettingsClick(event) {
    event.preventDefault();
    event.stopPropagation();
    
    if (getSetting('enableSounds')) {
      try {
        AUDIO.click.play().catch(e => console.warn("Audio play failed:", e));
      } catch (e) {
        console.warn("Could not play audio:", e);
      }
    }
    
    // Call the dedicated dialog method
    if (window.colorThemeManager) {
      window.colorThemeManager.openSettingsDialog();
    } else {
      ui.notifications.warn("Color theme manager not available");
    }
  }
  
  /**
   * Handle message click
   * @param {Event} event - Click event
   * @private
   */
  _onMessageClick(event) {
    if (getSetting('enableSounds')) {
      try {
        AUDIO.click.play().catch(e => console.warn("Audio play failed:", e));
      } catch (e) {
        console.warn("Could not play audio:", e);
      }
    }
    
    const pageId = event.currentTarget.dataset.pageId;
    const page = this.journalEntry.pages.get(pageId);
    
    if (page) {
      this.selectedPage = page;
      this.markAsRead(pageId);
      this.render(true);
    }
  }
  
  /**
   * Handle category button click
   * @param {Event} event - Click event
   * @private
   */
  _onCategoryClick(event) {
    if (getSetting('enableSounds')) {
      try {
        AUDIO.click.play().catch(e => console.warn("Audio play failed:", e));
      } catch (e) {
        console.warn("Could not play audio:", e);
      }
    }
    
    const category = event.currentTarget.dataset.category;
    this.setCategory(category);
  }
  
  /**
   * Handle search input
   * @param {Event} event - Input event
   * @private
   */
  _onSearch(event) {
    const searchTerm = event.target.value.trim();
    
    // Delay search to reduce render calls
    clearTimeout(this._searchTimeout);
    this._searchTimeout = setTimeout(() => {
      this.searchTerm = searchTerm;
      this.currentPage = 1; // Reset to first page
      this.render(true);
    }, 300);
  }

  /**
   * Handle advanced filter toggle
   * @param {Event} event - Click event
   * @private
   */
  _onAdvancedFilterToggle(event) {
    event.preventDefault();
    event.stopPropagation();
    
    if (getSetting('enableSounds')) {
      try {
        AUDIO.click.play().catch(e => console.warn("Audio play failed:", e));
      } catch (e) {
        console.warn("Could not play audio:", e);
      }
    }
    
    const panel = this.element.find('.advanced-filter-panel');
    panel.toggleClass('active');
  }

  /**
   * Handle apply advanced filters button
   * @param {Event} event - Click event
   * @private
   */
  _onApplyAdvancedFilters(event) {
    if (getSetting('enableSounds')) {
      try {
        AUDIO.click.play().catch(e => console.warn("Audio play failed:", e));
      } catch (e) {
        console.warn("Could not play audio:", e);
      }
    }
    
    const panel = this.element.find('.advanced-filter-panel');
    
    // Get sender
    const sender = panel.find('.sender-dropdown').val();
    
    // Get date range
    const dateFrom = panel.find('.date-from').val();
    const dateTo = panel.find('.date-to').val();
    
    // Check for unread only filter
    const unreadOnly = panel.find('.filter-unread').is(':checked');
    
    // Set filters
    this.setAdvancedFilters({
      sender: sender || null,
      dateFrom: dateFrom ? new Date(dateFrom) : null,
      dateTo: dateTo ? new Date(dateTo) : null,
      unreadOnly: unreadOnly
    });
    
    // Close panel
    panel.removeClass('active');
    
    // Add visual indicator if filters are active
    const filterButton = this.element.find('.filter-button');
    if (sender || dateFrom || dateTo || unreadOnly) {
      if (!filterButton.find('.filter-badge').length) {
        filterButton.append('<span class="filter-badge"></span>');
      }
    } else {
      filterButton.find('.filter-badge').remove();
    }
  }
  
  /**
   * Handle reset advanced filters button
   * @param {Event} event - Click event
   * @private
   */
  _onResetAdvancedFilters(event) {
    if (getSetting('enableSounds')) {
      try {
        AUDIO.click.play().catch(e => console.warn("Audio play failed:", e));
      } catch (e) {
        console.warn("Could not play audio:", e);
      }
    }
    
    const panel = this.element.find('.advanced-filter-panel');
    
    // Reset inputs
    panel.find('.sender-dropdown').val('');
    panel.find('.date-from').val('');
    panel.find('.date-to').val('');
    panel.find('.filter-unread').prop('checked', false);
    
    // Clear filters
    this.clearAdvancedFilters();
    
    // Remove filter badge
    this.element.find('.filter-button .filter-badge').remove();
    
    // Close panel
    panel.removeClass('active');
  }
  
  /**
   * Handle pagination previous page
   * @param {Event} event - Click event
   * @private
   */
  _onPrevPage(event) {
    if (this.currentPage > 1) {
      if (getSetting('enableSounds')) {
        try {
          AUDIO.click.play().catch(e => console.warn("Audio play failed:", e));
        } catch (e) {
          console.warn("Could not play audio:", e);
        }
      }
      
      this.currentPage--;
      this.render(true);
    }
  }
  
  /**
   * Handle pagination next page
   * @param {Event} event - Click event
   * @private
   */
  _onNextPage(event) {
    if (this.currentPage < this.totalPages) {
      if (getSetting('enableSounds')) {
        try {
          AUDIO.click.play().catch(e => console.warn("Audio play failed:", e));
        } catch (e) {
          console.warn("Could not play audio:", e);
        }
      }
      
      this.currentPage++;
      this.render(true);
    }
  }
  
  /**
   * Handle save message button
   * @param {Event} event - Click event
   * @private
   */
  _onSaveMessage(event) {
    if (getSetting('enableSounds')) {
      try {
        AUDIO.click.play().catch(e => console.warn("Audio play failed:", e));
      } catch (e) {
        console.warn("Could not play audio:", e);
      }
    }
    
    const pageId = this.selectedPage.id;
    const isSaved = this._isSaved(this.selectedPage);
    
    this.saveMessage(pageId, !isSaved).then(success => {
      if (success) {
        const $btn = $(event.currentTarget);
        $btn.toggleClass('active');
        $btn.html(`<i class="fas fa-star"></i> ${!isSaved ? 'Unsave' : 'Save'}`);
        this.render(true);
      }
    });
  }
  
  /**
   * Handle mark as spam button
   * @param {Event} event - Click event
   * @private
   */
  _onMarkAsSpam(event) {
    if (getSetting('enableSounds')) {
      try {
        AUDIO.click.play().catch(e => console.warn("Audio play failed:", e));
      } catch (e) {
        console.warn("Could not play audio:", e);
      }
    }
    
    const pageId = this.selectedPage.id;
    const isSpam = this._isSpam(this.selectedPage);
    
    this.markAsSpam(pageId, !isSpam).then(success => {
      if (success) {
        const $btn = $(event.currentTarget);
        $btn.toggleClass('active');
        $btn.html(`<i class="fas fa-exclamation-triangle"></i> ${!isSpam ? 'Unspam' : 'Spam'}`);
        this.render(true);
      }
    });
  }
  
  /**
   * Handle reply message button
   * @param {Event} event - Click event
   * @private
   */
  _onReplyMessage(event) {
    if (getSetting('enableSounds')) {
      try {
        AUDIO.click.play().catch(e => console.warn("Audio play failed:", e));
      } catch (e) {
        console.warn("Could not play audio:", e);
      }
    }
    
    const pageId = this.selectedPage.id;
    this.replyToMessage(pageId);
  }
  
  /**
   * Handle forward message button
   * @param {Event} event - Click event
   * @private
   */
  _onForwardMessage(event) {
    if (getSetting('enableSounds')) {
      try {
        AUDIO.click.play().catch(e => console.warn("Audio play failed:", e));
      } catch (e) {
        console.warn("Could not play audio:", e);
      }
    }
    
    const pageId = this.selectedPage.id;
    this.forwardMessage(pageId);
  }
  
  /**
   * Handle share message to chat
   * @param {Event} event - Click event
   * @private
   */
  async _onShareMessage(event) {
    try {
      // Check if we have a selected page
      if (!this.selectedPage) {
        ui.notifications.error("No message selected");
        return;
      }
      
      const pageId = this.selectedPage.id;
      const journalId = this.journalEntry.id;
      
      console.log(`${MODULE_ID} | Sharing message with pageId: ${pageId}, journalId: ${journalId}`);
      
      // Use the unified shared message system
      const { shareMessageFromViewer } = await import('./unified-shared-message-viewer.js');
      const result = await shareMessageFromViewer(journalId, pageId);
      
      if (result) {
        console.log(`${MODULE_ID} | Message shared successfully`);
      }
      
    } catch (error) {
      console.error(`${MODULE_ID} | Error sharing message:`, error);
      ui.notifications.error("Failed to share message to chat");
    }
  }

  /**
   * Handle compose new message button click
   * @param {Event} event - Click event
   * @private
   */
  _onComposeNewMessage(event) {
    event.preventDefault();
    
    if (getSetting('enableSounds')) {
      try {
        AUDIO.click.play().catch(e => console.warn("Audio play failed:", e));
      } catch (e) {
        console.warn("Could not play audio:", e);
      }
    }
    
    // Open the composer
    game.nightcity.messenger.openComposer();
  }

  static _applyChatMessageStyling(message, html, data) {
    // Make sure we're only targeting our own messages
    const sharedMessages = html.find('.cyberpunk-shared-message');
    if (sharedMessages.length === 0) return;
    
    console.log(`${MODULE_ID} | Applying message styling to chat message`);
    
    // Force proper button styling
    const buttons = html.find('.cyberpunk-shared-message button');
    buttons.css({
      'background-color': '#1a1a1a',
      'color': '#F65261',
      'border': '1px solid #F65261',
      'border-radius': '4px',
      'padding': '6px 12px',
      'cursor': 'pointer',
      'font-size': '0.9em',
      'display': 'inline-flex',
      'align-items': 'center',
      'gap': '6px',
      'font-family': 'Rajdhani, sans-serif',
      'min-width': '120px',
      'justify-content': 'center'
    });
    
    // Special styling for each button type
    html.find('.export-to-inbox').css({
      'background-color': 'rgba(25, 243, 247, 0.1)',
      'color': '#19f3f7',
      'border-color': '#19f3f7'
    });
    
    html.find('.view-message-btn').css({
      'background-color': 'rgba(255, 215, 0, 0.1)',
      'color': '#FFD700',
      'border-color': '#FFD700'
    });
    
    // Ensure proper hover effects by adding classes
    buttons.hover(
      function() {
        const $this = $(this);
        if ($this.hasClass('export-to-inbox')) {
          $this.css({
            'background-color': '#19f3f7',
            'color': '#1a1a1a'
          });
        } else if ($this.hasClass('view-message-btn')) {
          $this.css({
            'background-color': '#FFD700',
            'color': '#1a1a1a'
          });
        } else {
          $this.css({
            'background-color': '#F65261',
            'color': '#1a1a1a'
          });
        }
      },
      function() {
        const $this = $(this);
        if ($this.hasClass('export-to-inbox')) {
          $this.css({
            'background-color': 'rgba(25, 243, 247, 0.1)',
            'color': '#19f3f7'
          });
        } else if ($this.hasClass('view-message-btn')) {
          $this.css({
            'background-color': 'rgba(255, 215, 0, 0.1)',
            'color': '#FFD700'
          });
        } else {
          $this.css({
            'background-color': '#1a1a1a',
            'color': '#F65261'
          });
        }
      }
    );
    
    // Restructure the message details to be stacked
    const messageDetails = html.find('.message-details');
    if (messageDetails.length > 0) {
      // Remove grid styling and add vertical stack
      messageDetails.css({
        'display': 'flex',
        'flex-direction': 'column',
        'gap': '5px'
      });
      
      // Adjust spacing for message detail items
      const detailItems = messageDetails.find('.message-detail');
      detailItems.css({
        'margin-bottom': '4px'
      });
      
      // Make labels more prominent
      const labels = detailItems.find('span:first-child');
      labels.css({
        'font-weight': 'bold',
        'color': '#F65261',
        'min-width': '60px',
        'display': 'inline-block'
      });
    }
  }

  
  /**
   * Handle export message button
   * @param {Event} event - Click event
   * @private
   */
  _onExportMessage(event) {
    if (getSetting('enableSounds')) {
      try {
        AUDIO.click.play().catch(e => console.warn("Audio play failed:", e));
      } catch (e) {
        console.warn("Could not play audio:", e);
      }
    }
    
    const pageId = this.selectedPage.id;
    const page = this.journalEntry.pages.get(pageId);
    
    if (!page) return;
    
    // Extract subject for default name
    const content = page.text.content;
    const subjectMatch = content.match(/\[Subject\](.+?)\[End\]/);
    const defaultName = subjectMatch ? 
      subjectMatch[1].trim() : 
      page.name || "Exported Message";
    
    // Show export dialog with improved UI
    new Dialog({
      title: "Export Message",
      content: `
        <form>
          <div class="form-group">
            <label>Export As:</label>
            <select name="export-type" class="export-type-select">
              <option value="journal">Journal Entry</option>
              <option value="item">Data Shard Item</option>
            </select>
          </div>
          <div class="form-group">
            <label>Name:</label>
            <input type="text" name="export-name" value="${defaultName}">
          </div>
          <div class="form-group export-options">
            <label class="checkbox">
              <input type="checkbox" name="encrypted">
              Encrypted
            </label>
            <div class="encryption-options" style="display: none; margin-left: 20px;">
              <label>Difficulty Value:</label>
              <input type="number" name="dv" value="15" min="5" max="30">
            </div>
          </div>
        </form>
        <script>
          // Toggle encryption options visibility
          $('input[name="encrypted"]').change(function() {
            if($(this).is(':checked')) {
              $('.encryption-options').slideDown(200);
            } else {
              $('.encryption-options').slideUp(200);
            }
          });
          
          // Toggle options based on export type
          $('.export-type-select').change(function() {
            if($(this).val() === 'item') {
              $('.export-options').show();
            } else {
              $('.export-options').hide();
            }
          });
        </script>
      `,
      buttons: {
        export: {
          icon: '<i class="fas fa-file-export"></i>',
          label: "Export",
          callback: async (html) => {
            const exportType = html.find('[name="export-type"]').val();
            const name = html.find('[name="export-name"]').val();
            const encrypted = html.find('[name="encrypted"]').is(':checked');
            const dv = encrypted ? parseInt(html.find('[name="dv"]').val()) : 0;
            
            // Show a loading message
            ui.notifications.info("Exporting message...");
            
            const doc = await this.exportMessage(pageId, exportType, name, { encrypted, dv });
            
            if (doc) {
              ui.notifications.info(`Message exported as ${doc.documentName}: ${doc.name}`);
              
              // Open the new document
              if (exportType === 'journal') {
                doc.sheet.render(true);
              } else if (exportType === 'item') {
                // If it's a player's character, add to inventory
                if (game.user.character && !game.user.isGM) {
                  await game.user.character.createEmbeddedDocuments("Item", [doc.toObject()]);
                  ui.notifications.info(`Added ${doc.name} to ${game.user.character.name}'s inventory`);
                } else {
                  doc.sheet.render(true);
                }
              }
            }
          }
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: "Cancel"
        }
      },
      default: "export",
      render: (html) => {
        // Initialize to journal entry options
        html.find('.export-options').hide();
      }
    }).render(true);
  }
}
