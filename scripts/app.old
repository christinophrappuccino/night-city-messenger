/**
 * Night City Messenger - Main Application
 * Refactored to eliminate redundancies and improve code organization
 */
import { registerSettings, getSetting } from './settings.js';
import { CyberpunkMessageViewer } from './messageViewer.js';
import { CyberpunkMessageComposer } from './messageComposer.js';
import { ContactManager } from './contactManager.js';
import { registerHooks } from './hooks.js';
import { ScheduledMessagesManager } from './scheduledMessagesManager.js';
import { MODULE_ID, TEMPLATES, AUDIO, SPAM_TEMPLATES } from './constants.js';
import { initializeGMAdminPanel, registerAdminHelpers } from './GMAdminInitializer.js';
import { ItemInbox } from './item-inbox.js';
import { 
  ensureMessageJournal, 
  showNotification, 
  getCurrentDateTime, 
  formatMessage,
  extractEmailAddress
} from './utils.js';

// Module API - expose globally for macros and other modules
export class NightCityMessenger {
  static initialized = false;
  
  /**
   * Initialize the module
   */
  static init() {
    if (this.initialized) return;
    
    console.log(`${MODULE_ID} | Initializing module`);
    
    // Register settings
    registerSettings();
    
    // Register Handlebars helpers
    this._registerHandlebarsHelpers();
    
    // Preload templates
    this._preloadTemplates();
    
    this.initialized = true;
  }

  /**
   * Initialize Folders
   */
  static _hideFolders() {
    if (!game.user.isGM) return;
    
    // Find the Player Messages folder
    let folder = game.folders.find(f => f.name === "Player Messages" && f.type === "JournalEntry");
    if (folder) {
      // Check if it's already hidden from players
      if (folder.permission.default !== CONST.DOCUMENT_PERMISSION_LEVELS.NONE) {
        // Update folder permissions
        folder.update({
          permission: { default: CONST.DOCUMENT_PERMISSION_LEVELS.NONE }
        }).then(() => {
          console.log(`${MODULE_ID} | Player Messages folder hidden from players`);
        });
      }
    }
  }
  
  /**
   * Called when Foundry is ready
   */
  static ready() {
    console.log(`${MODULE_ID} | Module ready`);

   // Hide folders from players
   this._hideFolders();
    
   // Create global objects
   game.nightcity = game.nightcity || {};
   
   // DEBUG: Log before initializing ItemInbox
   console.log(`${MODULE_ID} | About to initialize ItemInbox`);
   
   // Initialize ItemInbox subsystem (includes chat handlers)
   if (!game.nightcity.itemInbox) {
     game.nightcity.itemInbox = ItemInbox;
     ItemInbox.init(); // This now includes setupChatButtonHandlers()
     console.log(`${MODULE_ID} | ItemInbox initialized with chat button handlers`);
   }
    
    // Initialize contact manager
    if (!game.nightcity.contactManager) {
      game.nightcity.contactManager = new ContactManager();
    }
    
    // Initialize GM Admin Panel (for GMs only)
    if (game.user.isGM) {
      initializeGMAdminPanel();
      registerAdminHelpers();
    }
    
    // Make it available globally
    game.nightcity.ScheduledMessagesManager = ScheduledMessagesManager;
    
    // Viewer and Composer classes to global namespace
    game.nightcity.CyberpunkMessageViewer = CyberpunkMessageViewer;
    game.nightcity.CyberpunkMessageComposer = CyberpunkMessageComposer;
    
    // Register global API - this must happen before other operations
    game.nightcity.messenger = {
      openViewer: this.openViewer.bind(this),
      openComposer: this.openComposer.bind(this),
      sendMessage: this.sendMessage.bind(this),
      generateSpam: this.generateSpam.bind(this),
      openScheduledMessagesManager: this.openScheduledMessagesManager.bind(this),
      checkScheduledMessages: this.checkScheduledMessages.bind(this)
    };
    
    // Register socket listeners - after API is established
    this._registerSocketListeners();

    // Additional hooks for time-based features
    this._registerTimeHooks();
    
    // Global socket listener for message notifications
    game.socket.on("module.core", async (request) => {
      if (request.operation !== "messageNotification") return;
      
      const { journalId, pageId, senderName, recipientName, subject } = request.data;
      
      // Log the notification receipt
      console.log(`${MODULE_ID} | Received message notification:`, request.data);
      
      // Check if this is targeted for this user
      const isRecipient = game.user.character && game.user.character.name === recipientName;
      const isGM = game.user.isGM && getSetting('gmReceivesAllNotifications');
      
      if (isRecipient || isGM) {
        // For both recipients and GMs, update open viewers
        const journal = game.journal.get(journalId);
        if (!journal) return;
        
        // Set or verify the unread flag
        let unreadMessages = await journal.getFlag(MODULE_ID, "unreadMessages") || [];
        if (!Array.isArray(unreadMessages)) unreadMessages = [];
        
        // Make sure pageId is in unread list
        if (!unreadMessages.includes(pageId)) {
          unreadMessages.push(pageId);
          await journal.setFlag(MODULE_ID, "unreadMessages", unreadMessages);
        }
        
        // Find and update any open viewers
        const viewers = Object.values(ui.windows).filter(w => 
          w instanceof CyberpunkMessageViewer && w.journalEntry?.id === journalId
        );
        
        for (const viewer of viewers) {
          // Force refresh the viewer
          if (typeof viewer.forceRefresh === 'function') {
            await viewer.forceRefresh(isRecipient ? pageId : null);
          } else {
            // Fallback for older versions
            viewer._loadUnreadStatus().then(() => viewer.render(true));
          }
        }
        
        // For recipients, show notification
        if (isRecipient) {
          if (getSetting('enableNotifications')) {
            ui.notifications.info(`New message from ${senderName}: ${subject}`);
            showNotification(`New message from ${senderName}: ${subject}`);
          }
          
          // Play notification sound
          playAudio('notification');
        }
        
        // For GMs, show a different notification
        if (isGM && !isRecipient) {
          ui.notifications.info(`${senderName} sent a message to ${recipientName}: ${subject}`);
        }
      }
    });
    
    // Auto-create journals for characters if enabled
    if (getSetting('autoCreateJournals') && game.user.isGM) {
      this._createJournalsForCharacters();
    }
    
    // Set default email addresses for characters if needed
    if (game.user.isGM) {
      this._ensureCharacterEmails();
    }
    
    // Add UI buttons
    this._addUIButtons();
    
    // Create macros if needed
    if (game.user.isGM) {
      this._createMacros();
    }
    
    // Check for any past-due scheduled messages (for GM only)
    if (game.user.isGM) {
      setTimeout(() => {
        this.checkScheduledMessages();
      }, 2000); // Slight delay to ensure everything is loaded
    }
  }
  
  /**
   * Register Handlebars helpers - SIMPLIFIED HELPERS
   * @private
   */
  static _registerHandlebarsHelpers() {
    // Extract sender name from From field
    Handlebars.registerHelper('extractSenderName', function(text) {
      if (!text) return "Unknown Sender";
      try {
        let senderName = text.replace(/\s*\([^)]+\)/, "").trim();
        senderName = senderName.replace(/"([^"]+)"/g, function(match, group) {
          return `"${group}" `;
        }).trim();
        return senderName || "Unknown Sender";
      } catch (error) {
        console.error(`${MODULE_ID} | Error extracting sender name:`, error);
        return text || "Unknown Sender";
      }
    });
    
    // RegEx extraction helper - with improved handling
    Handlebars.registerHelper('regexExtract', function(text, pattern) {
      if (!text) {
        return ["", "Unknown"];
      }
      
      try {
        // First ensure we have text as a string
        const textStr = String(text);
        
        // Fix for pattern escaping - remove any extra backslashes
        const cleanPattern = pattern.replace(/\\\\+/g, '\\');
        const regex = new RegExp(cleanPattern, 's'); // Add 's' flag for multi-line matching
        const match = textStr.match(regex);
        
        // Default values if no match
        if (!match || !match[1]) {
          if (pattern.includes('Date')) return ["", "Unknown Date"];
          if (pattern.includes('From')) return ["", "Unknown Sender"];
          if (pattern.includes('To')) return ["", "Unknown Recipient"];
          if (pattern.includes('Subject')) return ["", "No Subject"];
        }
        
        return match || ["", "Unknown"];
      } catch (error) {
        console.error(`${MODULE_ID} | Error with regex extraction:`, error);
        // Determine what type of data we're extracting and return appropriate default
        if (pattern.includes('Date')) return ["", "Unknown Date"];
        if (pattern.includes('From')) return ["", "Unknown Sender"];
        if (pattern.includes('To')) return ["", "Unknown Recipient"];
        if (pattern.includes('Subject')) return ["", "No Subject"];
        return ["", "Unknown"];
      }
    });
    
    // COMBINED HELPER for message content extraction
    Handlebars.registerHelper('extractMessageText', function(content) {
      if (!content) return '<p>No content available</p>';
      
      try {
        // Convert to string if needed
        const contentStr = String(content);
        
        // Check if this has the journal-email-display format
        if (contentStr.includes('journal-email-display')) {
          // Find the inner content div and extract JUST its innerHTML
          const contentMatch = contentStr.match(/<div style="padding:15px;color:#ffffff;background-color:#1a1a1a">([\s\S]*?)<\/div>\s*<\/div>/);
          if (contentMatch && contentMatch[1]) {
            return new Handlebars.SafeString(contentMatch[1]); // Return as HTML
          }
        }
        
        // Fall back to the original method for old format messages
        const lastEndIndex = contentStr.lastIndexOf('[End]');
        if (lastEndIndex !== -1) {
          return new Handlebars.SafeString(contentStr.substring(lastEndIndex + 5).trim());
        }
        
        return contentStr;
      } catch (error) {
        console.error(`${MODULE_ID} | Error extracting message text:`, error);
        return '<p>Error processing message content</p>';
      }
    });
    
    // MERGED isSpam helper that handles both direct template and legacy usage
    Handlebars.registerHelper('isSpam', function(page) {
      if (!page) return false;
      
      // Direct content check (fastest)
      if (page.text?.content?.includes('[SPAM]')) return true;
      
      // Check for matching active viewer cache
      const viewers = Object.values(ui.windows).filter(w => {
        return w.constructor.name === "CyberpunkMessageViewer";
      });
      
      for (const viewer of viewers) {
        // Use cache from viewer if page ID matches
        if (page.id && viewer.statusCache?.has(page.id)) {
          const status = viewer.statusCache.get(page.id);
          if (status.spam !== undefined) return status.spam;
        }
      }
      
      // Fallback to flag check
      try {
        const status = page.getFlag ? page.getFlag(MODULE_ID, "status") : null;
        return status ? status.spam : false;
      } catch (error) {
        console.warn(`${MODULE_ID} | Error checking spam flag in template:`, error);
        return false;
      }
    });
    
    // MERGED isSaved helper that handles both direct template and legacy usage
    Handlebars.registerHelper('isSaved', function(page) {
      if (!page) return false;
      
      // Check for matching active viewer cache
      const viewers = Object.values(ui.windows).filter(w => {
        return w.constructor.name === "CyberpunkMessageViewer";
      });
      
      for (const viewer of viewers) {
        // Use cache from viewer if page ID matches
        if (page.id && viewer.statusCache?.has(page.id)) {
          const status = viewer.statusCache.get(page.id);
          if (status.saved !== undefined) return status.saved;
        }
      }
      
      // Fallback to flag check
      try {
        const status = page.getFlag ? page.getFlag(MODULE_ID, "status") : null;
        return status ? status.saved : false;
      } catch (error) {
        console.warn(`${MODULE_ID} | Error checking saved flag in template:`, error);
        return false;
      }
    });
    
    // Helper to check if a page is unread
    Handlebars.registerHelper('isPageUnread', function(pageId, unreadMessages) {
      if (!pageId || !unreadMessages) return false;
      
      // If unreadMessages is a Set
      if (unreadMessages instanceof Set) {
        return unreadMessages.has(pageId);
      }
      
      // If unreadMessages is an Array
      if (Array.isArray(unreadMessages)) {
        return unreadMessages.includes(pageId);
      }
      
      return false;
    });
    
    // Helper to check if a value is in a Set
    Handlebars.registerHelper('includes', function(array, value) {
      if (!array || !value) return false;
      
      // If it's a Set
      if (array instanceof Set) {
        return array.has(value);
      }
      
      // If it's an Array
      if (Array.isArray(array)) {
        return array.includes(value);
      }
      
      // If unreadMessages isn't a Set but an object with .has method
      if (typeof array.has === 'function') {
        return array.has(value);
      }
      
      return false;
    });
    
    // Equality helper
    Handlebars.registerHelper('eq', function(a, b) {
      return a === b;
    });
  }
  
  /**
   * Preload Handlebars templates
   * @private
   */
  static async _preloadTemplates() {
    // Build template list from TEMPLATES constant
    const templatePaths = Object.values(TEMPLATES);
    
    console.log(`${MODULE_ID} | Preloading templates:`, templatePaths);
    
    // Preload all templates
    try {
      await loadTemplates(templatePaths);
      console.log(`${MODULE_ID} | Templates loaded successfully`);
    } catch (error) {
      console.error(`${MODULE_ID} | Error loading templates:`, error);
      
      // Try to load each template individually to identify which one fails
      for (const path of templatePaths) {
        try {
          await loadTemplates([path]);
          console.log(`${MODULE_ID} | Successfully loaded: ${path}`);
        } catch (e) {
          console.error(`${MODULE_ID} | Failed to load template: ${path}`);
        }
      }
    }
  }

  /**
   * Register time-related hooks
   * @private
   */
  static _registerTimeHooks() {
    // Hook into SimpleCalendar if available
    if (game.modules.get("foundryvtt-simple-calendar")?.active) {
      Hooks.on('simple-calendar.dateChanged', (data) => {
        console.log(`${MODULE_ID} | Calendar date changed`);
        
        // Check for scheduled messages when time changes
        if (game.user.isGM) {
          this.checkScheduledMessages();
        }
        
        // Handle spam generation
        if (game.user.isGM && getSetting('enableSpamGeneration')) {
          this._handleDateChange(data);
        }
      });
    }
    
    // Also check periodically for real-time scheduled messages
    if (game.user.isGM) {
      setInterval(() => {
        this._checkRealTimeScheduledMessages();
      }, 60000); // Check every minute
    }
  }

  /**
   * Check for real-time scheduled messages
   * @private
   */
  static async _checkRealTimeScheduledMessages() {
    const scheduledMessages = game.settings.get(MODULE_ID, "scheduledMessages") || [];
    
    // Filter for non-SimpleCalendar messages that are past due
    const now = new Date();
    const pastDueMessages = [];
    const remainingMessages = [];
    
    for (const message of scheduledMessages) {
      try {
        // Only check non-SimpleCalendar messages
        if (!message.useSimpleCalendar) {
          const scheduledTime = new Date(message.scheduledTime);
          
          if (now >= scheduledTime) {
            pastDueMessages.push(message);
          } else {
            remainingMessages.push(message);
          }
        } else {
          // Keep SimpleCalendar messages
          remainingMessages.push(message);
        }
      } catch (error) {
        console.error(`${MODULE_ID} | Error checking real-time scheduled message:`, error);
        remainingMessages.push(message); // Keep on error
      }
    }
    
    // If there are past-due messages, send them quietly
    if (pastDueMessages.length > 0) {
      console.log(`${MODULE_ID} | Found ${pastDueMessages.length} past-due real-time messages`);
      
      // Send each message
      let sentCount = 0;
      for (const message of pastDueMessages) {
        try {
          // Update the date to current time
          message.date = getCurrentDateTime();
          
          // Send the message
          await this.sendMessage({
            to: message.to,
            from: message.from,
            subject: message.subject,
            content: message.content,
            date: message.date
          });
          
          sentCount++;
        } catch (error) {
          console.error(`${MODULE_ID} | Error sending past-due message:`, error);
        }
      }
      
      // Save the remaining messages
      await game.settings.set(MODULE_ID, "scheduledMessages", remainingMessages);
      
      // Notify that messages were sent
      ui.notifications.info(`Sent ${sentCount} scheduled messages`);
    }
  }

  /**
   * Add UI buttons to the token controls - Updated to include scheduled messages
   * @private
   */
  static _addUIButtons() {
    const controls = ui.controls.controls.find(c => c.name === "token");
    if (!controls) return;
    
    // Remove existing buttons first to avoid duplicates
    controls.tools = controls.tools.filter(t => 
      t.name !== 'nightcity-messenger' && 
      t.name !== 'compose-message' &&
      t.name !== 'scheduled-messages'
    );
    
    // Add buttons if user has permission
    if (game.user.isGM || game.user.character) {
      // Add messenger button
      controls.tools.push({
        name: 'nightcity-messenger',
        title: 'Night City Messages',
        icon: 'fas fa-envelope',
        button: true,
        onClick: () => this.openViewer()
      });
      
      // Add composer button
      controls.tools.push({
        name: 'compose-message',
        title: 'Compose Message',
        icon: 'fas fa-pen',
        button: true,
        onClick: () => this.openComposer()
      });
      
      // Add scheduled messages button
      controls.tools.push({
        name: 'scheduled-messages',
        title: 'Scheduled Messages',
        icon: 'fas fa-calendar-alt',
        button: true,
        onClick: () => this.openScheduledMessagesManager()
      });
    }
    
    // Refresh UI to show new buttons
    ui.controls.render(true);
  }
  
  /**
   * Set email addresses for characters that don't have them
   * @private
   */
  static _ensureCharacterEmails() {
    const defaultDomain = getSetting('defaultDomain') || "nightcity.net";
    
    game.actors.filter(a => a.type === "character").forEach(async actor => {
      if (!actor?.id) return;
      
      const hasEmail = actor.getFlag(MODULE_ID, "emailAddress");
      
      if (!hasEmail) {
        // Generate a default email
        const sanitized = actor.name
          .toLowerCase()
          .replace(/[^\w\s]/gi, '')  // Remove special characters
          .replace(/\s+/g, '.');     // Replace spaces with periods
        
        const email = `${sanitized}@${defaultDomain}`;
        await actor.setFlag(MODULE_ID, "emailAddress", email);
        console.log(`${MODULE_ID} | Set email address for ${actor.name}: ${email}`);
      }
    });
  }
  
  /**
   * Register socket listeners
   * @private
   */
  static _registerSocketListeners() {
    game.socket.on(`module.${MODULE_ID}`, async (data) => {
      console.log(`${MODULE_ID} | Socket message received:`, data);
      
      // Handle notification operations for all users
      if (data.operation === 'notification' && data.userId === game.user.id) {
        // Show notification for targeted user
        if (getSetting('enableNotifications')) {
          showNotification(data.message);
          
          try {
            if (getSetting('enableSounds') && AUDIO.notification) {
              await AUDIO.notification.play();
            }
          } catch(e) {
            console.warn(`${MODULE_ID} | Could not play notification sound:`, e);
          }
        }
      }

        // Handle Item Inbox operations
        if (data.operation === 'traceback' && game.user.isGM) {
          ui.notifications.warn(`Decryption attempt traced: ${data.characterName} attempted to decrypt ${data.itemName}`);
        }
      
      // Socket handler for updating inbox
      if (data.operation === 'updateInbox') {
        console.log(`${MODULE_ID} | Received updateInbox operation:`, data);
        
        const journal = game.journal.get(data.journalId);
        if (!journal) {
          console.error(`${MODULE_ID} | Could not find journal ${data.journalId}`);
          return;
        }
        
        // For targeted user or GM with the setting enabled
        const isTargeted = data.targetUserId === game.user.id;
        const isGMCopy = game.user.isGM && getSetting('gmReceivesAllNotifications');
        
        if (isTargeted || isGMCopy) {
          console.log(`${MODULE_ID} | Processing inbox update for ${isTargeted ? 'targeted user' : 'GM'}`);
          
          // For GMs, show a notification about the message
          if (isGMCopy && !isTargeted && data.fromName && data.toName) {
            ui.notifications.info(`${data.fromName} sent a message to ${data.toName}: ${data.subject || 'No Subject'}`);
          }
          
          // Update the unread messages flag directly
          if (data.pageId) {
            // Get current unread messages flag
            let unreadMessages = await journal.getFlag(MODULE_ID, "unreadMessages") || [];
            if (!Array.isArray(unreadMessages)) unreadMessages = [];
            
            // Add pageId if not already present
            if (!unreadMessages.includes(data.pageId)) {
              unreadMessages.push(data.pageId);
              
              // Update the flag immediately
              await journal.setFlag(MODULE_ID, "unreadMessages", unreadMessages);
              console.log(`${MODULE_ID} | Added ${data.pageId} to unread messages for ${journal.name}`);
            }
            
            // Find any open viewers
            const viewers = Object.values(ui.windows).filter(w => 
              w instanceof game.nightcity.CyberpunkMessageViewer && 
              w.journalEntry?.id === journal.id
            );
            
            // Force refresh each open viewer
            for (const viewer of viewers) {
              console.log(`${MODULE_ID} | Refreshing viewer instance:`, viewer);
              
              // Call forceRefresh if it exists
              if (typeof viewer.forceRefresh === 'function') {
                await viewer.forceRefresh();
              } else {
                // Fallback approach - reload unread status and render
                await viewer._loadUnreadStatus();
                viewer.render(true);
              }
            }
            
            // Show notification and play sound if targeted
            if (isTargeted && getSetting('enableNotifications')) {
              // Create simple notification
              ui.notifications.info(`New message from ${data.fromName || 'Someone'}: ${data.subject || 'No Subject'}`);
              
              // Also create custom floating notification
              showNotification(`New message from ${data.fromName || 'Someone'}: ${data.subject || 'No Subject'}`);
            }
          }
        }
      }
      
      // Only GMs handle remaining socket operations
      if (game.user.isGM) {
        this._handleSocketOperation(data);
      }
    });
  }
  
  /**
   * Handle socket operations
   * @param {Object} data - Socket data
   * @private
   */
  static _handleSocketOperation(data) {
    // STEP 1: Add ONLY the deletedMessagesStructureReady to the permission check
    if (!game.user.isGM && 
        data.operation !== 'notification' && 
        data.operation !== 'updateInbox' &&
        data.operation !== 'updateMessageStatus' &&
        data.operation !== 'deletedMessagesStructureReady') return;
    
    const { operation, userId, pageId, journalId, status, targetUserId, content } = data;
    
    switch (operation) {
      case 'updateMessageStatus':
        // For GMs, process the request
        if (game.user.isGM) {
          this._updateMessageStatus(journalId, pageId, status, content);
        }
        break;
        
      case 'requestUnreadUpdate':
        // NEW: Handle unread messages flag update requests
        if (game.user.isGM) {
          const journal = game.journal.get(data.journalId);
          if (journal) {
            console.log(`${MODULE_ID} | GM updating unread messages for journal ${journal.name}`);
            journal.setFlag(MODULE_ID, "unreadMessages", data.unreadMessages)
              .then(() => console.log(`${MODULE_ID} | Unread messages updated successfully`))
              .catch(err => console.error(`${MODULE_ID} | Error updating unread messages:`, err));
          }
        }
        break;
        
      case 'createMessageRequest':
        // Handle message creation requests from players
        if (game.user.isGM) {
          console.log(`${MODULE_ID} | GM creating message on behalf of player ${data.userId}`);
          
          // Use the normal send message function as GM
          this.sendMessage(data.messageData)
            .then(page => {
              if (page) {
                console.log(`${MODULE_ID} | Successfully created message for player ${data.userId}`);
              }
            })
            .catch(error => {
              console.error(`${MODULE_ID} | Error creating message for player:`, error);
            });
        }
        break;

      case 'requestItemMessageContent':
        // Handle requests for item message content
        if (game.user.isGM) {
          const item = game.items.get(data.itemId);
          if (!item) return;
          
          // Get the item's journal
          const journalId = item.getFlag(MODULE_ID, 'journalId');
          if (!journalId) return;
          
          const journal = game.journal.get(journalId);
          if (!journal) return;
          
          // Get the page
          const page = journal.pages.get(data.pageId);
          if (!page) return;
          
          // Extract metadata
          const content = page.text.content;
          const dateMatch = content.match(/\[Date\](.+?)\[End\]/);
          const fromMatch = content.match(/\[From\](.+?)\[End\]/);
          const toMatch = content.match(/\[To\](.+?)\[End\]/);
          const subjectMatch = content.match(/\[Subject\](.+?)\[End\]/);
          
          // Get clean content
          const messageContent = cleanHtmlContent(content);
          
          // Create a chat message with the content to share with the requesting user
          const messageData = {
            content: `
            <div class="cyberpunk-shared-message">
              <div class="message-header-line"></div>
              <div class="message-header-bar">
                <div class="header-icon"><i class="fas fa-microchip"></i></div>
                <div class="header-title">DATA SHARD CONTENTS</div>
                <div class="header-status">SHARED BY GM</div>
              </div>
              <div class="message-info">
                <div class="message-subject">${subjectMatch ? subjectMatch[1].trim() : "No Subject"}</div>
                <div class="message-details">
                  <div class="message-detail"><span>FROM:</span> <span class="message-detail-value">${fromMatch ? fromMatch[1].trim() : "Unknown Sender"}</span></div>
                  <div class="message-detail"><span>TO:</span> <span class="message-detail-value">${toMatch ? toMatch[1].trim() : "Unknown Recipient"}</span></div>
                  <div class="message-detail"><span>DATE:</span> <span class="message-detail-value">${dateMatch ? dateMatch[1].trim() : "Unknown Date"}</span></div>
                  <div class="message-detail"><span>SOURCE:</span> <span class="message-detail-value">${item.name}</span></div>
                </div>
              </div>
              <div class="message-preview">
                ${messageContent}
              </div>
              <div class="message-actions-bar">
                <button class="export-to-inbox" type="button" data-journal-id="${journalId}" data-page-id="${data.pageId}" data-item-id="${data.itemId}">
                  <i class="fas fa-download"></i> Export to Inbox
                </button>
              </div>
            </div>`,
            user: game.user.id,
            whisper: [data.userId],
            speaker: {
              alias: "Data Shard Content"
            },
            flags: {
              [MODULE_ID]: {
                sharedDataShardMessage: true,
                messageId: data.pageId,
                journalId: journalId, 
                itemId: data.itemId,
                itemUuid: item.uuid
              }
            }
          };
          
          ChatMessage.create(messageData);
        }
        break;
        
      case 'createMessage':
        if (game.user.isGM) {
          this._createMessage(data.message);
        }
        break;
        
      case 'requestPermission':
        if (game.user.isGM) {
          this._grantJournalPermission(journalId, userId);
        }
        break;
        
      case 'notification':
        // This is handled separately in the socket listener
        break;
        
      case 'updateInbox':
        this._updateClientInbox(targetUserId, journalId, pageId);
        break;

      // STEP 1: Add ONLY this one case to test
      case 'deletedMessagesStructureReady':
        // Player receives confirmation that structure is ready
        if (data.userId === game.user.id) {
          console.log(`${MODULE_ID} | Deleted messages structure is ready`);
          ui.notifications.info("Deletion system initialized by GM");
        }
        break;

        case 'createDeletedMessagesStructure':
          // GM creates the folder structure for players
          if (game.user.isGM) {
            try {
              console.log(`${MODULE_ID} | GM creating deleted messages structure for ${data.characterName}`);
              
              // Get or create the Deleted Messages folder
              let folder = game.folders.find(f => 
                f.name === "Deleted Messages" && 
                f.type === "JournalEntry"
              );
              
              if (!folder) {
                Folder.create({
                  name: "Deleted Messages",
                  type: "JournalEntry",
                  parent: null,
                  color: "#ff0000",
                  flags: {
                    [MODULE_ID]: {
                      isDeletedMessagesFolder: true
                    }
                  }
                }).then(folder => {
                  console.log(`${MODULE_ID} | GM created Deleted Messages folder`);
                  
                  // Notify the requesting player that the structure is ready
                  game.socket.emit(`module.${MODULE_ID}`, {
                    operation: 'deletedMessagesStructureReady',
                    userId: data.userId,
                    folderId: folder.id
                  });
                }).catch(error => {
                  console.error(`${MODULE_ID} | Error creating deleted messages structure:`, error);
                });
              }
            } catch (error) {
              console.error(`${MODULE_ID} | Error in createDeletedMessagesStructure:`, error);
            }
          }
          break;

        case 'deletionRequest':
          // Handle simple deletion requests (fallback mode)
          if (game.user.isGM) {
            console.log(`${MODULE_ID} | GM received deletion request from ${data.requestedBy}`);
            
            ChatMessage.create({
              content: `<div style="background: #330000; border: 2px solid #F65261; border-radius: 8px; padding: 15px; color: #ffffff;"><div style="color: #F65261; font-weight: bold; font-size: 1.1em; margin-bottom: 10px;">🗑️ MESSAGE DELETION REQUEST</div><div><strong>${data.requestedBy}</strong> has requested to delete:<br><em>"${data.originalMessageName}"</em></div><div style="margin-top: 10px; padding: 8px; background: rgba(246, 82, 97, 0.1); border-radius: 4px; font-size: 0.9em;"><strong>Note:</strong> This was a simplified deletion request. The message is hidden from the player's view.</div></div>`,
              whisper: game.users.filter(u => u.isGM).map(u => u.id),
              speaker: { alias: "Night City Messenger System" }
            });
          }
          break;
          
    }
  }


  /**
   * Send socket message as player (utility method)
   * @param {string} operation - Socket operation
   * @param {Object} data - Operation data
   * @returns {Promise<void>}
   */
  static async sendPlayerRequest(operation, data) {
    if (game.user.isGM) {
      // For GMs, process directly
      return this._handleSocketOperation({
        operation,
        userId: game.user.id,
        ...data
      });
    }
    
    // For players, send via socket
    game.socket.emit(`module.${MODULE_ID}`, {
      operation,
      userId: game.user.id,
      ...data
    });
    
    // Return a resolved promise
    return Promise.resolve();
  }
  
  /**
   * Update a message's status flags
   * @param {string} journalId - Journal ID
   * @param {string} pageId - Page ID
   * @param {Object} status - Status object
   * @private
   */
  static async _updateMessageStatus(journalId, pageId, status, content) {
    if (!game.user.isGM) return;
    
    const journal = game.journal.get(journalId);
    if (!journal) return;
    
    const page = journal.pages.get(pageId);
    if (!page) return;
    
    try {
      // Prepare update data
      const updateData = {
        [`flags.${MODULE_ID}.status`]: status
      };
      
      // If content was provided, update it too
      if (content) {
        updateData["text.content"] = content;
      }
      
      // Update as GM
      await page.update(updateData);
      
      console.log(`${MODULE_ID} | Updated message status for page ${pageId}`);
    } catch (error) {
      console.error(`${MODULE_ID} | Error updating message status:`, error);
    }
  }
  
  /**
   * Create a new message
   * @param {Object} messageData - Message data
   * @private
   */
  static async _createMessage(messageData) {
    const { to, from, subject, content, date } = messageData;
    
    try {
      // Find the recipient's journal
      const recipientName = to.split('(')[0].trim();
      const journal = await ensureMessageJournal(recipientName);
      
      // Create the message
      await journal.createEmbeddedDocuments("JournalEntryPage", [{
        name: subject,
        type: "text",
        text: {
          content: messageData.formattedContent
        },
        [`flags.${MODULE_ID}.status`]: {
          read: false,
          saved: false,
          spam: messageData.spam || false
        }
      }]);
      
      // Send notification to recipient's player
      const recipientUser = game.users.find(u => 
        u.character && u.character.name === recipientName
      );
      
      if (recipientUser) {
        game.socket.emit(`module.${MODULE_ID}`, {
          operation: 'notification',
          userId: recipientUser.id,
          message: `New message from ${from}: ${subject}`
        });
      }
    } catch (error) {
      console.error(`${MODULE_ID} | Error creating message:`, error);
    }
  }
  
  /**
   * Grant journal permission to a user
   * @param {string} journalId - Journal ID
   * @param {string} userId - User ID
   * @private
   */
 static async _grantJournalPermission(journalId, userId) {
   const journal = game.journal.get(journalId);
   const user = game.users.get(userId);
   
   if (!journal || !user) return;
   
   // Grant permission more liberally - for any character's journal if player
   if (user.character || user.isGM) {
     // FIX: Create ownership object properly
     const ownership = foundry.utils.duplicate(journal.ownership);
     ownership[userId] = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
     
     // Update via the proper update method
     await journal.update({ ownership: ownership });
     console.log(`${MODULE_ID} | Granted message access to ${user.name} for journal ${journal.name}`);
     
     // Force update for observers
     game.socket.emit(`module.${MODULE_ID}`, {
       operation: 'journalPermissionUpdated',
       journalId: journal.id,
       userId: userId
     });
   }
 }

  
  /**
   * Auto-create journals for characters
   * @private
   */
  static async _createJournalsForCharacters() {
    if (!game.user.isGM) return;
    
    // Create folder for messages if it doesn't exist
    let folder = game.folders.find(f => f.name === "Player Messages" && f.type === "JournalEntry");
    if (!folder) {
      folder = await Folder.create({
        name: "Player Messages",
        type: "JournalEntry",
        parent: null,
        // FIX: Use ownership instead of permission for v11+
        ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE }
      });
    } else if (folder.ownership.default !== CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE) {
      // Update ownership on existing folder
      await folder.update({
        ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE }
      });
    }
    
    // Get all player characters
    const playerCharacters = game.actors.filter(a => 
      a.hasPlayerOwner && a.type === "character"
    );
    
    // Create journals for each character
    for (const character of playerCharacters) {
      if (!character || !character.name) continue;
      
      const journalName = `${character.name}'s Messages`;
      let journal = game.journal.getName(journalName);
      
      if (!journal) {
        // Find the owner user
        const ownerUser = game.users.find(u => u.character && u.character.id === character.id);
        
        // FIX: Create ownership object using v11+ system
        const ownership = {
          default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE
        };
        
        // Assign owner permission to the character's player
        if (ownerUser) {
          ownership[ownerUser.id] = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
        }
        
        // Always give GM permission for maintenance
        for (const user of game.users) {
          if (user.isGM) {
            ownership[user.id] = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
          }
        }
        
        // Create journal with correct ownership
        journal = await JournalEntry.create({
          name: journalName,
          folder: folder.id,
          ownership: ownership // FIX: Use ownership instead of permission
        });
        
        console.log(`${MODULE_ID} | Created message journal for ${character.name}`);
      } else {
        // For existing journals, verify ownership
        const ownerUser = game.users.find(u => u.character && u.character.id === character.id);
        
        if (ownerUser) {
          const ownership = foundry.utils.duplicate(journal.ownership);
          ownership[ownerUser.id] = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
          
          // Ensure GMs have ownership
          for (const user of game.users) {
            if (user.isGM) {
              ownership[user.id] = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
            }
          }
          
          await journal.update({ ownership: ownership });
        }
      }
    }
  }

  /**
   * Unified message export function
   * @param {Object} messageData - The message data to export
   * @param {Actor} recipient - The recipient actor
   * @returns {Promise<boolean>} Success status
   */
  static async exportMessageToInbox(messageData, recipient = null) {
    try {
      // Determine recipient - use provided actor, or fall back to user's character
      const targetActor = recipient || game.user.character;
      
      // For GMs with no character, offer selection
      if (!targetActor && game.user.isGM) {
        // Show dialog to select character
        const characters = game.actors.filter(a => a.type === "character");
        if (characters.length === 0) {
          ui.notifications.error("No characters available for export");
          return false;
        }
        
        return new Promise(resolve => {
          new Dialog({
            title: "Select Recipient",
            content: `
              <form>
                <div class="form-group">
                  <label>Export to character:</label>
                  <select id="character-select">
                    ${characters.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
                  </select>
                </div>
              </form>
            `,
            buttons: {
              export: {
                icon: '<i class="fas fa-download"></i>',
                label: "Export",
                callback: html => {
                  const actorId = html.find('#character-select').val();
                  const actor = game.actors.get(actorId);
                  if (actor) {
                    // Call self with selected actor
                    this.exportMessageToInbox(messageData, actor).then(resolve);
                  } else {
                    ui.notifications.error("No valid recipient selected");
                    resolve(false);
                  }
                }
              },
              cancel: {
                icon: '<i class="fas fa-times"></i>',
                label: "Cancel",
                callback: () => resolve(false)
              }
            },
            default: "export"
          }).render(true);
        });
      }
      
      // If still no target, show error
      if (!targetActor) {
        ui.notifications.error("No valid recipient for message export. Please assign a character to your user or select a target character.");
        return false;
      }
      
      // Format content with export note if needed
      if (!messageData.content.includes("exported from")) {
        const exportNote = `<div style="color:#19f3f7;font-style:italic;margin-bottom:10px;padding:5px;border:1px solid #19f3f7;background:rgba(25,243,247,0.1)">
          [This message was exported to ${targetActor.name}'s inbox on ${getCurrentDateTime()}]
        </div>`;
        messageData.content = exportNote + messageData.content;
      }
      
      // Create the message in recipient's journal
      const recipientName = targetActor.name;
      const journalName = `${recipientName}'s Messages`;
      
      // Find or create the journal
      let journal = game.journal.getName(journalName);
      
      if (!journal && game.user.isGM) {
        // Create folder if it doesn't exist
        let folder = game.folders.find(f => f.name === "Player Messages" && f.type === "JournalEntry");
        if (!folder) {
          folder = await Folder.create({
            name: "Player Messages",
            type: "JournalEntry",
            parent: null
          });
        }
        
        // Create journal
        journal = await JournalEntry.create({
          name: journalName,
          folder: folder.id
        });
      }
      
      if (!journal) {
        ui.notifications.error(`Cannot find message journal for ${recipientName}`);
        return false;
      }
      
      // Format the message - PRESERVE ORIGINAL METADATA
      const formattedContent = formatMessage({
        date: messageData.date || getCurrentDateTime(),
        from: messageData.from,
        to: messageData.to, // Keep original "To" field
        subject: messageData.subject,
        content: messageData.content
      });
      
      // Create the message
      const [page] = await journal.createEmbeddedDocuments("JournalEntryPage", [{
        name: messageData.subject,
        type: "text",
        text: {
          content: formattedContent
        },
        [`flags.${MODULE_ID}.status`]: {
          read: false,
          saved: false,
          spam: false
        }
      }]);
      
      if (page) {
        // Mark as unread
        let unreadMessages = await journal.getFlag(MODULE_ID, "unreadMessages") || [];
        if (!Array.isArray(unreadMessages)) unreadMessages = [];
        
        if (!unreadMessages.includes(page.id)) {
          unreadMessages.push(page.id);
          await journal.setFlag(MODULE_ID, "unreadMessages", unreadMessages);
        }
        
        // Notify the recipient
        const ownerUser = game.users.find(u => u.character && u.character.id === targetActor.id);
        if (ownerUser) {
          game.socket.emit(`module.${MODULE_ID}`, {
            operation: 'updateInbox',
            targetUserId: ownerUser.id,
            journalId: journal.id,
            pageId: page.id,
            fromName: messageData.from.split('(')[0].trim(),
            toName: recipientName,
            subject: messageData.subject
          });
        }
        
        ui.notifications.info(`Message exported to ${recipientName}'s inbox`);
        return true;
      }
      
      return false;
    } catch (error) {
      console.error(`${MODULE_ID} | Error exporting message:`, error);
      ui.notifications.error(`Export failed: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Create macros for Night City Messenger - Updated to include scheduled messages
   * @private
   */
  static async _createMacros() {
    if (!game.user.isGM) return;

    // Check if macros already exist
    const viewerMacro = game.macros.find(m => 
      m.name === "Night City Messages" && 
      m.command === "game.nightcity.messenger.openViewer()"
    );

    const composerMacro = game.macros.find(m => 
      m.name === "Compose Message" && 
      m.command === "game.nightcity.messenger.openComposer()"
    );
    
    const scheduledMacro = game.macros.find(m =>
      m.name === "Scheduled Messages" &&
      m.command === "game.nightcity.messenger.openScheduledMessagesManager()"
    );

    // Create the viewer macro if it doesn't exist
    if (!viewerMacro) {
      await Macro.create({
        name: "Night City Messages",
        type: "script", 
        img: "icons/svg/book.svg",
        command: "game.nightcity.messenger.openViewer()"
      });
      console.log(`${MODULE_ID} | Created 'Night City Messages' macro`);
    }
    
    // Create the composer macro if it doesn't exist
    if (!composerMacro) {
      await Macro.create({
        name: "Compose Message",
        type: "script",
        img: "icons/svg/pen.svg",
        command: "game.nightcity.messenger.openComposer()"
      });
      console.log(`${MODULE_ID} | Created 'Compose Message' macro`);
    }
    
    // Create the scheduled messages macro if it doesn't exist
    if (!scheduledMacro) {
      await Macro.create({
        name: "Scheduled Messages",
        type: "script",
        img: "icons/svg/calendar.svg",
        command: "game.nightcity.messenger.openScheduledMessagesManager()"
      });
      console.log(`${MODULE_ID} | Created 'Scheduled Messages' macro`);
    }
  }
  
  /**
   * Open the message viewer for a character
   * @param {string|null} journalId - Journal ID or null for current character
   * @returns {CyberpunkMessageViewer} The message viewer app
   */
  static openViewer(journalId = null) {
    let journal;
    
    if (journalId) {
      journal = game.journal.get(journalId);
    } else if (game.user.character) {
      const journalName = `${game.user.character.name}'s Messages`;
      journal = game.journal.getName(journalName);
    } else if (game.user.isGM) {
      // For GM, try to find any character's journal
      const playerChar = game.actors.find(a => a.hasPlayerOwner && a.type === "character");
      if (playerChar) {
        const journalName = `${playerChar.name}'s Messages`;
        journal = game.journal.getName(journalName);
      }
    }
    
    if (!journal) {
      ui.notifications.error("No message journal found. Make sure you have a character assigned or create message journals first.");
      if (game.user.isGM) {
        this._createJournalsForCharacters(); // Try to create journals
        ui.notifications.info("Attempting to create message journals for characters.");
      }
      return null;
    }
    
    // Find existing app instance
    const existingApp = Object.values(ui.windows).find(w => 
      w instanceof CyberpunkMessageViewer && w.journalEntry.id === journal.id
    );
    
    if (existingApp) {
      existingApp.maximize();
      existingApp.bringToTop();
      return existingApp;
    }
    
    // Create new app
    const viewer = new CyberpunkMessageViewer(journal);
    viewer.render(true);
    
    // Play sound if enabled
    if (getSetting('enableSounds')) {
      try {
        AUDIO.open.play().catch(e => console.warn("Audio play failed:", e));
      } catch (e) {
        console.warn("Could not play audio:", e);
      }
    }
    
    return viewer;
  }
  
  /**
   * Open the message composer
   * @param {Object} options - Composer options
   * @returns {Promise<CyberpunkMessageComposer>} The composer app
   */
  static async openComposer(options = {}) {
    // Create and initialize the composer
    const composer = new CyberpunkMessageComposer();
    await composer.initialize();
    
    // Set any pre-filled data
    if (options.to) composer.setRecipient(options.to);
    if (options.subject) composer.setSubject(options.subject);
    if (options.content) composer.setContent(options.content);
    if (options.replyTo) composer.setReplyData(options.replyTo);
    
    composer.render(true);
    
    // Play sound if enabled
    if (getSetting('enableSounds')) {
      try {
        AUDIO.open.play().catch(e => console.warn("Audio play failed:", e));
      } catch (e) {
        console.warn("Could not play audio:", e);
      }
    }
    
    return composer;
  }
  
  /**
   * Send a message programmatically
   * @param {Object} messageData - Message data
   * @returns {Promise<JournalEntryPage>} The created message
   */
  static async sendMessage(messageData) {
    // Validate required fields
    if (!messageData.to || !messageData.from || !messageData.subject || !messageData.content) {
      throw new Error("Missing required message fields");
    }
    
    try {
      // Check if there are multiple recipients
      if (messageData.to.includes(',')) {
        const recipients = messageData.to.split(',').map(rec => rec.trim());
        let sentPages = [];
        
        for (const recipient of recipients) {
          // Create a copy of the message data for this recipient
          const singleRecipientData = { ...messageData, to: recipient };
          const page = await this._sendSingleMessage(singleRecipientData);
          if (page) sentPages.push(page);
        }
        
        // Return the first page or null
        return sentPages.length > 0 ? sentPages[0] : null;
      } else {
        // Single recipient
        return await this._sendSingleMessage(messageData);
      }
    } catch (error) {
      console.error(`${MODULE_ID} | Error sending message:`, error);
      throw error;
    }
  }
  
  /**
   * Send a message to a single recipient
   * @param {Object} messageData - Message data
   * @returns {Promise<JournalEntryPage>} The created message
   * @private
   */
  static async _sendSingleMessage(messageData) {
    try {
      // Find recipient journal
      const recipientName = messageData.to.split('(')[0].trim();
      
      // For players, always use GM proxy
      if (!game.user.isGM) {
        console.log(`${MODULE_ID} | Player sending message through GM proxy`);
        
        // Use socket to have GM create the message
        game.socket.emit(`module.${MODULE_ID}`, {
          operation: 'createMessageRequest',
          userId: game.user.id,
          messageData: messageData
        });
        
        // For better UX, show success notification
        ui.notifications.info("Message sent!");
        
        // Return a placeholder as the promise result
        return true;
      }
      
      // Only GMs can create messages directly
      const journal = await ensureMessageJournal(recipientName);
      
      // Format the message using the plain text formatter
      const formattedContent = formatMessage({
        date: messageData.date || getCurrentDateTime(),
        from: messageData.from,
        to: messageData.to,
        subject: messageData.subject,
        content: messageData.content
      });
      
      // Create the message
      const [page] = await journal.createEmbeddedDocuments("JournalEntryPage", [{
        name: messageData.subject,
        type: "text",
        text: {
          content: formattedContent
        },
        [`flags.${MODULE_ID}.status`]: {
          read: false,
          saved: false,
          spam: messageData.spam || false
        },
        [`flags.${MODULE_ID}.createdAt`]: new Date().toISOString()
      }]);
      
      // Update the unread messages flag
      if (page) {
        let unreadMessages = await journal.getFlag(MODULE_ID, "unreadMessages") || [];
        if (!Array.isArray(unreadMessages)) unreadMessages = [];
        
        // Add the page to unread messages if not already there
        if (!unreadMessages.includes(page.id)) {
          unreadMessages.push(page.id);
          await journal.setFlag(MODULE_ID, "unreadMessages", unreadMessages);
          console.log(`${MODULE_ID} | Added ${page.id} to unread messages for ${journal.name}`);
        }
        
        // Notify recipient through socket
        const recipientUser = game.users.find(u => 
          u.character && u.character.name === recipientName
        );
        
        if (recipientUser) {
          console.log(`${MODULE_ID} | Sending notification to ${recipientUser.name}`);
          
          // Socket notification to update inbox
          game.socket.emit(`module.${MODULE_ID}`, {
            operation: 'updateInbox',
            targetUserId: recipientUser.id,
            journalId: journal.id,
            pageId: page?.id,
            fromName: messageData.from.split('(')[0].trim(),
            toName: recipientName,
            subject: messageData.subject
          });
        }
      }
      
      return page;
    } catch (error) {
      console.error(`${MODULE_ID} | Error sending message to ${messageData.to}:`, error);
      return null;
    }
  }

  /**
   * Open the scheduled messages manager
   * @returns {ScheduledMessagesManager} The manager app
   */
  static openScheduledMessagesManager() {
    // Import the manager class if needed
    if (!game.nightcity.ScheduledMessagesManager) {
      console.error(`${MODULE_ID} | ScheduledMessagesManager not found`);
      ui.notifications.error("Scheduled messages feature not available");
      return null;
    }
    
    // Find existing app instance
    const existingApp = Object.values(ui.windows).find(w => 
      w instanceof game.nightcity.ScheduledMessagesManager
    );
    
    if (existingApp) {
      existingApp.maximize();
      existingApp.bringToTop();
      return existingApp;
    }
    
    // Create new app
    const manager = new game.nightcity.ScheduledMessagesManager();
    manager.render(true);
    
    // Play sound if enabled
    if (getSetting('enableSounds')) {
      try {
        AUDIO.open.play().catch(e => console.warn("Audio play failed:", e));
      } catch (e) {
        console.warn("Could not play audio:", e);
      }
    }
    
    return manager;
  }

  /**
   * Check for past-due scheduled messages
   * Called after time changes (especially after SimpleCalendar changes)
   */
  static checkScheduledMessages(fromCalendar = false) {
    if (!game.user.isGM) return;
    
    console.log(`${MODULE_ID} | Checking scheduled messages (fromCalendar: ${fromCalendar})`);
    
    // Get scheduled messages
    const scheduledMessages = game.settings.get(MODULE_ID, "scheduledMessages") || [];
    console.log(`${MODULE_ID} | Found ${scheduledMessages.length} scheduled messages`);
    
    if (scheduledMessages.length === 0) return;
    
    // Get manager class
    const ManagerClass = game.nightcity.ScheduledMessagesManager;
    
    // Create a temporary instance to handle auto-sending
    const manager = new ManagerClass();
    
    // Use the auto-send method
    manager._autoSendPastDueMessages();
  }

  /**
   * Send past-due messages
   * @param {Array} pastDueMessages - Messages to send
   * @param {Array} remainingMessages - Messages to keep
   * @private
   */
  static async _sendPastDueMessages(pastDueMessages, remainingMessages) {
    // Create a progress dialog
    const progressContent = `
      <div style="padding: 10px;">
        <p>Sending ${pastDueMessages.length} messages...</p>
        <div class="progress-bar">
          <div class="progress-fill" style="width: 0%"></div>
        </div>
        <p class="progress-text">0/${pastDueMessages.length}</p>
      </div>
    `;
    
    const dialog = new Dialog({
      title: "Sending Messages",
      content: progressContent,
      buttons: {},
      close: () => {}
    });
    
    dialog.render(true);
    
    // Apply some styles to the dialog
    setTimeout(() => {
      dialog.element.find('.progress-bar').css({
        'width': '100%',
        'height': '20px',
        'background-color': '#1a1a1a',
        'border': '1px solid #F65261',
        'border-radius': '4px',
        'overflow': 'hidden',
        'margin': '10px 0'
      });
      
      dialog.element.find('.progress-fill').css({
        'height': '100%',
        'background': 'linear-gradient(90deg, #F65261, #19f3f7)',
        'width': '0%',
        'transition': 'width 0.3s ease'
      });
      
      dialog.element.find('.progress-text').css({
        'text-align': 'center',
        'margin-top': '5px',
        'color': '#F65261'
      });
    }, 100);
    
    // Process messages
    let sentCount = 0;
    
    for (const message of pastDueMessages) {
      try {
        // Update the date to current time
        message.date = getCurrentDateTime();
        
        // Send the message
        await this.sendMessage({
          to: message.to,
          from: message.from,
          subject: message.subject,
          content: message.content,
          date: message.date
        });
        
        sentCount++;
        
        // Update progress
        const percent = Math.round((sentCount / pastDueMessages.length) * 100);
        dialog.element.find('.progress-fill').css('width', `${percent}%`);
        dialog.element.find('.progress-text').text(`${sentCount}/${pastDueMessages.length}`);
        
        // Short delay between sends
        await new Promise(resolve => setTimeout(resolve, 300));
      } catch (error) {
        console.error(`${MODULE_ID} | Error sending past-due message:`, error);
      }
    }
    
    // Save the remaining messages
    await game.settings.set(MODULE_ID, "scheduledMessages", remainingMessages);
    
    // Close dialog after a short delay
    setTimeout(() => {
      dialog.close();
      ui.notifications.info(`Sent ${sentCount} past-due messages`);
    }, 1500);
  }
  
  /**
   * Generate a spam message for a character
   * @param {string|Actor} character - Character name or Actor object
   * @returns {Promise<JournalEntryPage>} The created spam message
   */
  static async generateSpam(character) {
    if (!getSetting('enableSpamGeneration')) return null;
    
    const characterName = typeof character === 'string' ? character : character.name;
    
    // Get a random spam template
    const spamIndex = Math.floor(Math.random() * SPAM_TEMPLATES.length);
    const spam = SPAM_TEMPLATES[spamIndex];
    
    // Send the spam message
    return this.sendMessage({
      to: characterName,
      from: `"SPAM" (${spam.sender})`,
      subject: spam.subject,
      content: spam.content,
      spam: true
    });
  }
}

// THIS IS THE CRITICAL PART - CONNECT TO FOUNDRY HOOKS
Hooks.once('init', () => NightCityMessenger.init());
Hooks.once('ready', () => NightCityMessenger.ready());