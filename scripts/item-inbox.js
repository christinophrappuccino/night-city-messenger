/**
 * Item Inbox - Core functionality for the Night City Messenger
 * Allows items to serve as secure message containers
 */
import { MODULE_ID } from './constants.js';
import { getSetting } from './settings.js';
import { formatMessage, getCurrentDateTime, cleanHtmlContent, extractSenderName } from './utils.js';
import { shareMessageFromDataShard } from './unified-shared-message-viewer.js';
import { ItemInboxConfig } from './item-inbox-config.js';

/**
 * Handle roll for decryption
 * @param {Object} actor - The actor rolling
 * @param {string} skillName - Skill to roll
 * @param {number} difficultyValue - Target difficulty
 * @returns {Promise<Object>} Roll result object
 */
async function handleDecryptionRoll(actor, skillName, difficultyValue) {
  try {
    console.log(`Attempting decryption roll with skill: ${skillName}, DV: ${difficultyValue}`);
    
    // Find the skill on the actor
    const skills = actor.items.filter(item => item.type === "skill");
    const skill = skills.find(s => s.name === skillName);
    
    if (!skill) {
      console.warn(`Skill ${skillName} not found on actor ${actor.name}`);
      return {
        success: false,
        total: 0,
        diceRoll: 0,
        skillValue: 0,
        statValue: 0,
        message: `Skill ${skillName} not found`
      };
    }
    
    // Get the skill level
    const skillLevel = skill.system.level || 0;
    
    // Get the associated stat based on skill
    let statName = "INT"; // Default to INT
    
    // Map skills to stats
    if (["Basic Tech", "Cybertech", "Electronics/Security Tech", "Forgery", "Pick Lock"].includes(skillName)) {
      statName = "TECH";
    } else if (skillName === "Interface") {
      // For Interface, check if they're a Netrunner role
      const isNetrunner = actor.items.some(i => i.type === "role" && i.name.toLowerCase() === "netrunner");
      statName = isNetrunner ? "TECH" : "INT"; // Default to INT if not a Netrunner
    }
    
    // Get the stat value
    const statValue = actor.system.stats[statName.toLowerCase()]?.value || 0;
    console.log(`Using ${statName} (${statValue}) + ${skillName} (${skillLevel})`);
    
    // Check available Luck
    const luckStat = actor.system.stats.luck?.value || 0;
    
    // Ask if player wants to use Luck
    let useLuck = 0;
    
    if (luckStat > 0) {
      const luckDialog = await new Promise(resolve => {
        new Dialog({
          title: "Use Luck Points?",
          content: `
            <div style="text-align: center;">
              <p>You have <strong>${luckStat}</strong> Luck remaining.</p>
              <p>How many Luck points do you want to add to your roll?</p>
              <div style="margin: 10px 0;">
                <input type="range" id="luck-slider" min="0" max="${luckStat}" value="0" 
                  style="width: 80%;" oninput="document.getElementById('luck-value').textContent = this.value">
              </div>
              <p>Selected: <span id="luck-value">0</span> Luck</p>
            </div>
          `,
          buttons: {
            roll: {
              icon: '<i class="fas fa-dice"></i>',
              label: "Roll!",
              callback: html => {
                const luck = parseInt(html.find('#luck-slider').val());
                resolve(luck);
              }
            },
            cancel: {
              icon: '<i class="fas fa-times"></i>',
              label: "Cancel",
              callback: () => resolve(0)
            }
          },
          default: "roll"
        }).render(true);
      });
      
      useLuck = luckDialog;
    }
    
    // Deduct luck if used
    if (useLuck > 0) {
      await actor.update({
        "system.stats.luck.value": luckStat - useLuck
      });
    }
    
    // Roll D10 
    const roll = await new Roll("1d10").evaluate({async: true});
    const diceResult = roll.total;
    
    // Calculate total with stat + skill + luck
    const total = diceResult + statValue + skillLevel + useLuck;
    
    // Determine success
    const success = total >= difficultyValue;
    
    // Format for chat
    let content = `
      <div class="cyberpunk-roll">
        <div class="cyber-header">
          <i class="fas fa-microchip cyber-icon"></i>
          <div class="cyber-title">DATA SHARD DECRYPTION</div>
          <div class="cyber-subtitle">${actor.name}</div>
        </div>
        
        <div class="roll-details">
          <div class="roll-target">
            <span class="target-label">TARGET:</span>
            <span class="target-value">DV ${difficultyValue}</span>
          </div>
          
          <div class="roll-formula">
            <div class="formula-component dice">
              <i class="fas fa-dice-d10"></i> ${diceResult}
            </div>
            <div class="formula-component">
              <span class="comp-label">${statName}</span>
              <span class="comp-value">${statValue}</span>
            </div>
            <div class="formula-component">
              <span class="comp-label">${skillName}</span>
              <span class="comp-value">${skillLevel}</span>
            </div>
            ${useLuck > 0 ? `
            <div class="formula-component luck">
              <span class="comp-label">LUCK</span>
              <span class="comp-value">${useLuck}</span>
            </div>
            ` : ''}
            <div class="formula-equals">=</div>
            <div class="formula-total">${total}</div>
          </div>
          
          <div class="roll-result ${success ? 'success' : 'failure'}">
            ${success ? 
              '<i class="fas fa-check-circle"></i> DECRYPTION SUCCESSFUL' : 
              '<i class="fas fa-times-circle"></i> DECRYPTION FAILED'}
          </div>
        </div>
      </div>
    `;
    
    // Send to chat
    ChatMessage.create({
      content: content,
      speaker: ChatMessage.getSpeaker({actor}),
      type: CONST.CHAT_MESSAGE_TYPES.ROLL,
      roll: roll
    });
    
    // Show dice in 3D if available
    if (game.dice3d) {
      await game.dice3d.showForRoll(roll);
    }
    
    return {
      success,
      total,
      diceRoll: diceResult,
      skillValue: skillLevel,
      statValue: statValue,
      statName: statName,
      luck: useLuck
    };
  } catch (error) {
    console.error(`${MODULE_ID} | Error in decryption roll:`, error);
    return {
      success: false,
      total: 0,
      diceRoll: 0,
      skillValue: 0,
      statValue: 0,
      luck: 0,
      error: error.message
    };
  }
}


export class ItemInbox {
  static initialized = false;
  
  /**
   * Initialize the Item Inbox system
   */
  static init() {
    if (this.initialized) return;
    
    console.log(`${MODULE_ID} | Initializing Item Inbox subsystem`);
    
    // Register our custom sheet
    Items.registerSheet(MODULE_ID, ItemInboxSheet, {
      types: ["cyberware", "gear", "weapon", "armor", "item", "tool"], // Apply to common item types
      makeDefault: false,
      label: "Night City Data Shard"
    });

    // Set up chat button handlers for data shard sharing
    this.setupChatButtonHandlers();
    
    // Register the config sheet class globally
    game.nightcity.itemInbox = this;
    game.nightcity.ItemInboxSheet = ItemInboxSheet;
    game.nightcity.ItemInboxConfig = ItemInboxConfig;
    
    // Override item sheet rendering
    this._overrideItemSheetRendering();
    
    // Register hooks for integration
    this._registerHooks();
    
    // Set up socket listeners
    this._setupSocketListeners();
    
    this.initialized = true;
  }
  
  /**
   * Register hooks for Item Inbox integration
   * @private
   */
  static _registerHooks() {
    // Add "Configure as Item Inbox" context menu option
    Hooks.on('getItemDirectoryEntryContext', (html, options) => {
      options.push({
        name: "Configure as Item Inbox",
        icon: '<i class="fas fa-microchip"></i>',
        condition: li => {
          const item = game.items.get(li.data('documentId'));
          return item && !item.getFlag(MODULE_ID, 'isInbox');
        },
        callback: li => {
          const item = game.items.get(li.data('documentId'));
          if (item) {
            ItemInboxConfig.show(item);
          }
        }
      });
      
      // Also add an option to view as inbox if it is one
      options.push({
        name: "View as Item Inbox",
        icon: '<i class="fas fa-eye"></i>',
        condition: li => {
          const item = game.items.get(li.data('documentId'));
          return item && item.getFlag(MODULE_ID, 'isInbox');
        },
        callback: li => {
          const item = game.items.get(li.data('documentId'));
          if (item) {
            const sheet = new ItemInboxSheet(item);
            sheet.render(true);
          }
        }
      });
    });

    // Add button to regular item sheets
    Hooks.on('renderItemSheet', (app, html, data) => {
      // Skip our own sheet
      if (app instanceof ItemInboxSheet) return;
      
      // Find the header
      const header = html.find('.window-header .window-title');
      if (header.length) {
        // Check if this item is already configured as an inbox
        const isInbox = app.document.getFlag(MODULE_ID, 'isInbox') === true;
        
        if (isInbox) {
          // If it's already an inbox, add view button
            const viewBtn = $(`
              <a class="view-as-inbox" title="View as Item Inbox">
                <i class="fas fa-inbox"></i> Item Inbox
              </a>
            `);
            
            viewBtn.on('click', () => {
              app.close();
              const sheet = new ItemInboxSheet(app.document);
              sheet.render(true);
            });
            
            header.after(viewBtn);
          } else {
            // Create a completely new element for Configure button
            const configBtn = $(`
              <a class="configure-as-inbox" title="Configure as Item Inbox">
                <i class="fas fa-cog"></i> Item Inbox
              </a>
            `);
            
            configBtn.on('click', () => {
              ItemInboxConfig.show(app.document);
            });
            
            header.after(configBtn);
          }
      }
    });
    
      // Handle sharing data shard messages to chat
      Hooks.on('renderChatMessage', (message, html, data) => {
        const flags = message.flags?.[MODULE_ID] || {};
        
        // Check if this is a shared data shard message
        if (flags.sharedDataShardMessage) {
          // Find the export and view buttons and add click handlers
          html.find('.export-to-inbox').click(async (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            
            // Disable button temporarily
            const $btn = $(ev.currentTarget);
            $btn.prop('disabled', true);
            
            try {
              const itemId = $btn.data('item-id');
              const pageId = $btn.data('page-id');
              
              const item = game.items.get(itemId);
              if (item) {
                await this.exportMessage(item, pageId);
              } else {
                ui.notifications.error("Could not find the source item.");
              }
            } catch (error) {
              console.error(`${MODULE_ID} | Error exporting from chat:`, error);
              ui.notifications.error("Failed to export message");
            } finally {
              // Re-enable button
              setTimeout(() => $btn.prop('disabled', false), 500);
            }
          });
          
          html.find('.view-message-btn').click(async (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            
            // Get data from button
            const journalId = $(ev.currentTarget).data('journal-id');
            const pageId = $(ev.currentTarget).data('page-id');
            const itemId = $(ev.currentTarget).data('item-id');
            
            // For data shard items
            if (itemId) {
              const item = game.items.get(itemId);
              if (item) {
                // Open the item sheet
                await item.sheet.render(true);
                
                // Select the message after a short delay
                setTimeout(() => {
                  if (item.sheet instanceof game.nightcity.ItemInboxSheet) {
                    item.sheet.selectedMessageId = pageId;
                    item.sheet.render(true);
                  }
                }, 200);
              }
            } else if (journalId && pageId) {
              // For regular message viewer
              if (game.nightcity?.messenger?.openViewer) {
                const viewer = game.nightcity.messenger.openViewer(journalId);
                // Wait for render then scroll to message
                setTimeout(() => {
                  if (viewer) viewer.scrollToMessage(pageId);
                }, 200);
              }
            }
          });
        }
      });
    }
  
  /**
   * Set up socket listeners
   * @private
   */
  static _setupSocketListeners() {
    game.socket.on(`module.${MODULE_ID}`, (data) => {
      if (data.operation === 'traceback' && game.user.isGM) {
        ui.notifications.warn(`Decryption attempt traced: ${data.characterName} attempted to decrypt ${data.itemName}`);
      }
    });
  }
  
  /**
   * Convert an item to a Data Shard with proper LIMITED permissions
   * @param {Item} item - The item to convert
   * @returns {Promise<boolean>} Success flag
   */
  static async convertToDataShard(item) {
    // Show confirmation dialog first
    const confirm = await Dialog.confirm({
      title: "Convert to Data Shard",
      content: "Convert this item to a Data Shard? This will enable sharing with other players while keeping their inventories clean.",
      defaultYes: false
    });
    
    if (!confirm) return false;
    
    try {
      console.log(`${MODULE_ID} | Converting item ${item.name} to data shard`);
      
      // Get current owner
      const owner = item.isOwner ? game.user : game.users.find(u => item.testUserPermission(u, "OWNER"));
      
      // FIX: Use OBSERVER instead of LIMITED for better compatibility
      const ownership = {
        default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER // Use OBSERVER instead of LIMITED
      };
      
      // Set owner permission
      if (owner) {
        ownership[owner.id] = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
      }
      
      // Always ensure GMs have owner permission
      game.users.filter(u => u.isGM).forEach(gm => {
        ownership[gm.id] = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
      });
      
      // Create journal for messages if needed
      let journalId = item.getFlag(MODULE_ID, 'journalId');
      let journal;
      
      if (!journalId) {
        // Create new journal with same ownership as item
        journal = await JournalEntry.create({
          name: `${item.name} - Data Shard Messages`,
          ownership: ownership, // Use same ownership structure
          folder: null // Don't put in Player Messages folder to avoid clutter
        });
        journalId = journal.id;
      } else {
        journal = game.journal.get(journalId);
        if (journal) {
          // Update existing journal ownership to match
          await journal.update({ ownership: ownership });
        }
      }
      
      // Update item with all data shard flags and OBSERVER ownership
      await item.update({
        ownership: ownership, // Set OBSERVER ownership here
        [`flags.${MODULE_ID}.isDataShard`]: true,
        [`flags.${MODULE_ID}.dataShardType`]: 'single',
        [`flags.${MODULE_ID}.encrypted`]: false,
        [`flags.${MODULE_ID}.dvValue`]: getSetting('defaultEncryptionDV') || 15,
        [`flags.${MODULE_ID}.journalId`]: journalId,
        [`flags.${MODULE_ID}.convertedAt`]: Date.now(),
        [`flags.core.sheetClass`]: `${MODULE_ID}.ItemInboxSheet`
      });
      
      console.log(`${MODULE_ID} | Data shard conversion completed with OBSERVER ownership`);
      ui.notifications.info(`${item.name} converted to Data Shard. Others can view shared content.`);
      
      // Close current sheet and reopen as ItemInboxSheet
      if (item.sheet.rendered) {
        await item.sheet.close();
      }
      
      // Force sheet class change and reopen
      setTimeout(() => {
        item.sheet = new game.nightcity.ItemInboxSheet(item, {});
        item.sheet.render(true);
      }, 100);
      
      return true;
      
    } catch (error) {
      console.error(`${MODULE_ID} | Error converting to data shard:`, error);
      ui.notifications.error(`Conversion failed: ${error.message}`);
      return false;
    }
  }


  /**
   * Set up chat button handlers for shared data shard messages
   * Place this in ItemInbox.init() method
   */
  static setupChatButtonHandlers() {
    // Handle sharing data shard messages to chat
    Hooks.on('renderChatMessage', (message, html, data) => {
      const flags = message.flags?.[MODULE_ID] || {};
      
      // Check if this is a shared data shard message
      if (flags.sharedDataShardMessage) {
        
        // Handle "View Data Shard" button - FIXED to handle permissions better
        html.find('.view-message-btn').off('click').on('click', async (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          
          const itemId = $(ev.currentTarget).data('item-id');
          const pageId = $(ev.currentTarget).data('page-id');
          
          if (!itemId) {
            ui.notifications.error("No data shard reference found");
            return;
          }
          
          try {
            // Get the item directly
            const item = game.items.get(itemId);
            
            if (!item) {
              ui.notifications.error("Data shard not found");
              return;
            }
            
            // FIX: Check permissions more robustly
            const userLevel = item.getUserLevel(game.user);
            if (userLevel < CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER) {
              ui.notifications.error("You don't have permission to view this data shard");
              return;
            }
            
            console.log(`${MODULE_ID} | Opening data shard ${item.name} for user ${game.user.name}`);
            
            // Force the correct sheet class if needed
            if (!(item.sheet instanceof ItemInboxSheet)) {
              item.sheet = new ItemInboxSheet(item, {});
            }
            
            // Open the item sheet directly
            await item.sheet.render(true);
            
            // Select the specific message after a brief delay
            if (pageId) {
              setTimeout(() => {
                if (item.sheet.rendered && item.sheet instanceof ItemInboxSheet) {
                  item.sheet.selectedMessageId = pageId;
                  item.sheet.render(false); // Re-render to show selected message
                }
              }, 300);
            }
            
          } catch (error) {
            console.error(`${MODULE_ID} | Error opening data shard:`, error);
            ui.notifications.error("Failed to open data shard");
          }
        });
        
        // Handle "Export to Inbox" button  
        html.find('.export-to-inbox').off('click').on('click', async (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          
          const $btn = $(ev.currentTarget);
          $btn.prop('disabled', true);
          
          try {
            const itemId = $btn.data('item-id');
            const pageId = $btn.data('page-id');
            
            const item = game.items.get(itemId);
            if (item && pageId) {
              await ItemInbox.exportMessageFromDataShard(item, pageId);
            }
          } catch (error) {
            console.error(`${MODULE_ID} | Error exporting from chat:`, error);
            ui.notifications.error("Failed to export message");
          } finally {
            setTimeout(() => $btn.prop('disabled', false), 500);
          }
        });
      }
    });
  }

  /**
   * Export a message from a data shard to a character's inbox
   * Add this method to the ItemInbox class
   * @param {Item} item - The data shard item
   * @param {string} pageId - The message page ID
   * @returns {Promise<boolean>} Success status
   */
  // =========================================================================
  // FIX 1: Store read status persistently when messages are marked as read
  // Add this to your markAsRead method in messageViewer.js
  // =========================================================================

  /**
   * Mark a message as read - ENHANCED to store persistent read status
   * Replace the markAsRead method in your messageViewer.js with this version
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

  // =========================================================================
  // FIX 2: Check persistent read status when loading unread messages
  // Replace the _loadUnreadStatus method in your messageViewer.js with this:
  // =========================================================================

  /**
   * Load unread message status - ENHANCED to check persistent read status
   * Replace the _loadUnreadStatus method in your messageViewer.js
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

  // =========================================================================
  // FIX 3: Enhanced export function that checks persistent read status
  // Replace the exportMessageFromDataShard in your item-inbox.js with this:
  // =========================================================================

  /**
   * Export a message from a data shard to a character's inbox
   * FIXED: Uses persistent read status from localStorage
   */
  static async exportMessageFromDataShard(item, pageId, targetCharacter) {
    try {
      console.log(`${MODULE_ID} | Exporting message from data shard to ${targetCharacter.name}`);
      
      // Get the journal and validate (keeping your existing validation code)
      const journalId = item.getFlag(MODULE_ID, 'journalId');
      if (!journalId) {
        ui.notifications.error("No message journal found for this data shard");
        return false;
      }
      
      const journal = game.journal.get(journalId);
      if (!journal) {
        ui.notifications.error("Message journal not found");
        return false;
      }
      
      const page = journal.pages.get(pageId);
      if (!page) {
        ui.notifications.error("Message not found in data shard");
        return false;
      }
      
      // Check if message is decrypted (your existing code)
      const status = page.getFlag(MODULE_ID, "status") || {};
      const locallyDecrypted = localStorage.getItem(`${MODULE_ID}-decrypted-${item.id}-${pageId}`) === 'true';
      
      if (status.encrypted && !status.decrypted && !locallyDecrypted) {
        ui.notifications.error("Cannot export encrypted message. Decrypt it first.");
        return false;
      }
      
      // Extract message content (using simplified version - replace with your extraction logic)
      const rawContent = page.text.content;
      const dateMatch = rawContent.match(/\[Date\]\s*(.*?)\s*\[End\]/s);
      const fromMatch = rawContent.match(/\[From\]\s*(.*?)\s*\[End\]/s);
      const subjectMatch = rawContent.match(/\[Subject\]\s*(.*?)\s*\[End\]/s);
      
      let messageContent = rawContent
        .replace(/\[Date\].*?\[End\]/gs, '')
        .replace(/\[From\].*?\[End\]/gs, '')
        .replace(/\[To\].*?\[End\]/gs, '')
        .replace(/\[Subject\].*?\[End\]/gs, '')
        .trim();
      
      const exportNote = `Exported from Data Shard: ${item.name} by ${game.user.character?.name || game.user.name}`;
      const exportedContent = `<div style="color: #19f3f7; font-style: italic; margin-bottom: 10px; padding: 5px; border: 1px solid #19f3f7; background: rgba(25, 243, 247, 0.1);">
        ${exportNote}
      </div>
      ${messageContent}`;
      
      const messageData = {
        from: fromMatch ? fromMatch[1].trim() : "Unknown Sender",
        to: targetCharacter.name,
        subject: subjectMatch ? subjectMatch[1].trim() : page.name,
        content: exportedContent,
        date: dateMatch ? dateMatch[1].trim() : getCurrentDateTime()
      };
      
      // Get target character's inbox journal
      const journalName = `${targetCharacter.name}'s Messages`;
      let targetJournal = game.journal.getName(journalName);
      
      if (!targetJournal) {
        targetJournal = await JournalEntry.create({
          name: journalName,
          folder: null,
          flags: {
            [MODULE_ID]: {
              isCharacterInbox: true,
              characterId: targetCharacter.id,
              characterName: targetCharacter.name
            }
          }
        });
      }
      
      if (!targetJournal) {
        ui.notifications.error(`Could not create inbox for ${targetCharacter.name}`);
        return false;
      }
      
      // STEP 1: Find any open viewers for this journal BEFORE making changes
      const openViewers = Object.values(ui.windows).filter(w => 
        w instanceof game.nightcity.CyberpunkMessageViewer && 
        w.journalEntry?.id === targetJournal.id
      );
      
      console.log(`${MODULE_ID} | Found ${openViewers.length} open viewers for ${targetJournal.name}`);
      
      // STEP 2: Get persistent read status from localStorage
      const persistentlyReadMessages = new Set();
      
      if (targetJournal.pages) {
        for (const existingPage of targetJournal.pages.contents) {
          const readStatusKey = `${MODULE_ID}-read-${targetJournal.id}-${existingPage.id}`;
          const isReadPersistently = localStorage.getItem(readStatusKey) === 'true';
          
          if (isReadPersistently) {
            persistentlyReadMessages.add(existingPage.id);
            console.log(`${MODULE_ID} | Found persistently read message: ${existingPage.id} (${existingPage.name})`);
          }
        }
      }
      
      // STEP 3: Create the new message
      const { formatMessage } = await import('./utils.js');
      const formattedContent = formatMessage(messageData);
      
      const [newPage] = await targetJournal.createEmbeddedDocuments("JournalEntryPage", [{
        name: messageData.subject,
        type: "text",
        text: {
          content: formattedContent
        },
        [`flags.${MODULE_ID}.status`]: {
          read: false,
          saved: false,
          spam: false
        },
        [`flags.${MODULE_ID}.createdAt`]: new Date().toISOString()
      }]);
      
      if (!newPage) {
        ui.notifications.error("Failed to create exported message");
        return false;
      }
      
      // STEP 4: Update unread messages flag while preserving persistent read status
      let unreadMessages = await targetJournal.getFlag(MODULE_ID, "unreadMessages") || [];
      if (!Array.isArray(unreadMessages)) unreadMessages = [];
      
      // Add the new page to unread
      if (!unreadMessages.includes(newPage.id)) {
        unreadMessages.push(newPage.id);
      }
      
      // Remove persistently read messages from unread list
      unreadMessages = unreadMessages.filter(pageId => {
        if (persistentlyReadMessages.has(pageId)) {
          console.log(`${MODULE_ID} | Removing persistently read message from unread: ${pageId}`);
          return false; // Remove from unread
        }
        return true; // Keep in unread
      });
      
      // Update the journal flag
      await targetJournal.setFlag(MODULE_ID, "unreadMessages", unreadMessages);
      console.log(`${MODULE_ID} | Updated unread list. New unread count: ${unreadMessages.length} (preserved ${persistentlyReadMessages.size} read messages)`);
      
      // STEP 5: Update any open viewers immediately with correct status
      for (const viewer of openViewers) {
        console.log(`${MODULE_ID} | Updating open viewer with correct unread status`);
        
        // Update the viewer's unread set with the corrected data
        viewer.unreadMessages = new Set(unreadMessages);
        
        // Select the new message
        viewer.selectedPage = newPage;
        
        // Re-render the viewer to show the new message and correct read status
        viewer.render(true);
      }
      
      // STEP 6: Notify target user if they're online
      const targetUser = game.users.find(u => u.character && u.character.name === targetCharacter.name);
      if (targetUser && targetUser.active) {
        game.socket.emit(`module.${MODULE_ID}`, {
          operation: 'notification',
          userId: targetUser.id,
          message: `Exported message from data shard: ${messageData.subject}`
        });
        
        // Send updateInbox for users without open viewers
        if (openViewers.length === 0) {
          game.socket.emit(`module.${MODULE_ID}`, {
            operation: 'updateInbox',
            targetUserId: targetUser.id,
            journalId: targetJournal.id,
            pageId: newPage.id,
            fromName: messageData.from,
            toName: targetCharacter.name,
            subject: messageData.subject
          });
        }
      }
      
      ui.notifications.info(`Message exported to ${targetCharacter.name}'s inbox!`);
      return true;
      
    } catch (error) {
      console.error(`${MODULE_ID} | Error exporting message:`, error);
      ui.notifications.error("Failed to export message");
      return false;
    }
  }


  /**
   * Override default item rendering to use inbox sheet if configured
   */
  static _overrideItemSheetRendering() {
    // Store the original _getSheetClass method
    const originalGetSheetClass = Item.prototype._getSheetClass;
    
    // Override the method
    Item.prototype._getSheetClass = function() {
      // Check if this item is configured as an inbox
      if (this.getFlag(MODULE_ID, 'isInbox') === true) {
        // Return our custom sheet class
        return game.nightcity.ItemInboxSheet;
      }
      
      // Otherwise use the original method
      return originalGetSheetClass.call(this);
    };
  }
  
  /**
   * Ensure a journal entry exists for this item's data shard contents
   * @param {Item} item - The item
   * @returns {Promise<JournalEntry>} The journal entry
   */
  static async ensureDataShardJournal(item) {
    if (!item || !item.id) return null;
    
    // FIX: Check for EITHER isDataShard OR isInbox flag
    const isDataShard = item.getFlag(MODULE_ID, 'isDataShard');
    const isInbox = item.getFlag(MODULE_ID, 'isInbox');
    
    if (!isDataShard && !isInbox) {
      console.warn(`${MODULE_ID} | Item ${item.name} is not configured as data shard or inbox`);
      return null;
    }
    
    // Get or create the Data Shard Contents folder
    let folder = game.folders.find(f => f.name === "Data Shard Contents" && f.type === "JournalEntry");
    if (!folder) {
      folder = await Folder.create({
        name: "Data Shard Contents",
        type: "JournalEntry",
        parent: null,
        // Special flag to indicate this is our folder
        flags: {
          [MODULE_ID]: {
            dataShardFolder: true
          }
        }
      });
    }
    
    // Try to get existing journal entry for this item
    const journalId = item.getFlag(MODULE_ID, 'journalId');
    let journal = journalId ? game.journal.get(journalId) : null;
    
    // If no journal or it doesn't exist, create one
    if (!journal) {
      // Create journal name based on item and owner
      const owner = item.actor ? item.actor.name : (game.user.character?.name || "Unknown");
      const journalName = `${item.name} Data [${owner}]`;
      
      // Create journal entry
      journal = await JournalEntry.create({
        name: journalName,
        folder: folder.id,
        // Flags to link back to the item
        flags: {
          [MODULE_ID]: {
            dataShardJournal: true,
            itemId: item.id,
            itemUuid: item.uuid,
            itemName: item.name
          }
        }
      });
      
      // Update the item with the journal ID
      await item.setFlag(MODULE_ID, 'journalId', journal.id);
      
      console.log(`${MODULE_ID} | Created journal entry for data shard: ${journalName}`);
    }
    
    return journal;
  }
  
  /**
   * Add a message to a data shard
   * @param {Item} item - The item
   * @param {Object} messageData - Message data
   * @returns {Promise<JournalEntryPage>} The created message page
   */
  static async addMessage(item, messageData) {
    if (!item || !item.id) return null;
    
    // FIX: Check for EITHER isDataShard OR isInbox flag
    const isDataShard = item.getFlag(MODULE_ID, 'isDataShard');
    const isInbox = item.getFlag(MODULE_ID, 'isInbox');
    
    if (!isDataShard && !isInbox) {
      console.error(`${MODULE_ID} | Cannot add message: Item is not configured as data shard or inbox`);
      ui.notifications.error("This item is not configured as a data shard or inbox. Please configure it first.");
      return null;
    }
    
    // If it's an inbox but not a data shard, auto-upgrade it
    if (isInbox && !isDataShard) {
      console.log(`${MODULE_ID} | Auto-upgrading inbox item to data shard`);
      await item.setFlag(MODULE_ID, 'isDataShard', true);
      
      // Set default data shard properties if they don't exist
      if (!item.getFlag(MODULE_ID, 'dataShardType')) {
        await item.setFlag(MODULE_ID, 'dataShardType', 'single');
      }
      if (item.getFlag(MODULE_ID, 'encrypted') === undefined) {
        await item.setFlag(MODULE_ID, 'encrypted', false);
      }
    }
    
    // Get the journal
    const journal = await this.ensureDataShardJournal(item);
    if (!journal) {
      console.error(`${MODULE_ID} | Failed to get journal for data shard`);
      return null;
    }
    
    // Check data shard type
    const dataShardType = item.getFlag(MODULE_ID, 'dataShardType') || 'single';
    
    // For single message data shards, delete existing messages first
    if (dataShardType === 'single' && journal.pages.size > 0) {
      await journal.deleteEmbeddedDocuments("JournalEntryPage", 
        journal.pages.contents.map(p => p.id)
      );
    }
    
    // Format the message content with metadata tags
    const formattedContent = `
      [Date]${messageData.date || getCurrentDateTime()}[End]
      [From]${messageData.from || 'Unknown'}[End]
      [To]${messageData.to || 'Unknown'}[End]
      [Subject]${messageData.subject || 'No Subject'}[End]
      
      ${messageData.content || ''}
    `;
    
    // Create the message page
    const page = await journal.createEmbeddedDocuments("JournalEntryPage", [{
      name: messageData.subject || "Data Message",
      type: "text",
      text: {
        content: formattedContent
      },
      flags: {
        [MODULE_ID]: {
          status: {
            read: false,
            saved: false,
            spam: false,
            encrypted: item.getFlag(MODULE_ID, 'encrypted') || false,
            decrypted: !item.getFlag(MODULE_ID, 'encrypted') || false
          }
        }
      }
    }]);
    
    console.log(`${MODULE_ID} | Added message to data shard: ${messageData.subject}`);
    ui.notifications.info("Message added to data shard successfully!");
    
    return page[0];
  }
  
  /**
   * Decrypt a message in a data shard
   * @param {Item} item - The item
   * @param {string} pageId - The message page ID
   * @param {number} rollResult - The decryption roll result
   * @returns {Promise<boolean>} Success flag
   */
  static async decryptMessage(item, pageId, rollResult) {
    if (!item || !pageId) return false;
    
    // Get the journal
    const journalId = item.getFlag(MODULE_ID, 'journalId');
    if (!journalId) return false;
    
    const journal = game.journal.get(journalId);
    if (!journal) return false;
    
    // Get the page
    const page = journal.pages.get(pageId);
    if (!page) return false;
    
    // Check if item is encrypted
    const isEncrypted = item.getFlag(MODULE_ID, 'encrypted');
    if (!isEncrypted) {
      // If not encrypted, mark as decrypted automatically
      await page.setFlag(MODULE_ID, "status.decrypted", true);
      return true;
    }
    
    // Get encryption difficulty
    const dvValue = item.getFlag(MODULE_ID, 'dvValue') || getSetting('defaultEncryptionDV');
    
    // Check if decryption was successful
    const success = rollResult >= dvValue;
    
    if (success) {
      // Mark as decrypted
      await page.setFlag(MODULE_ID, "status.decrypted", true);
      
      // Log success
      console.log(`${MODULE_ID} | Successfully decrypted message in ${item.name}`);
      return true;
    } else {
      // Handle failure based on failure outcome setting
      const failureOutcome = item.getFlag(MODULE_ID, 'failureOutcome') || getSetting('defaultFailureOutcome');
      
      switch (failureOutcome) {
        case 'lockout':
          // Set a lockout timer
          const lockoutUntil = Date.now() + (1000 * 60 * 5); // 5 minute lockout
          await item.setFlag(MODULE_ID, 'lockoutUntil', lockoutUntil);
          break;
          
        case 'traceback':
          // Send a notification to GM
          if (game.user.isGM) {
            ui.notifications.warn(`Decryption attempt traced on ${item.name}!`);
          } else {
            // Use socket to notify GM
            game.socket.emit(`module.${MODULE_ID}`, {
              operation: 'traceback',
              itemName: item.name,
              characterName: game.user.character?.name || "Unknown",
              timestamp: Date.now()
            });
          }
          break;
          
        case 'damage':
          // Apply damage to character (if applicable)
          if (item.actor) {
            // Calculate damage based on DV
            const damage = Math.floor(dvValue / 3);
            
            // Check if we have any damage track system
            if (typeof item.actor.applyDamage === 'function') {
              item.actor.applyDamage(damage, "emp");
              ui.notifications.warn(`Feedback shock! ${damage} EMP damage applied.`);
            } else {
              ui.notifications.warn(`Feedback shock! Character would take ${damage} EMP damage.`);
            }
          }
          break;
          
        case 'corrupt':
          // Permanently corrupt the message
          await page.setFlag(MODULE_ID, "status.corrupted", true);
          ui.notifications.error("Message data corrupted! Permanent data loss occurred.");
          break;
      }
      
      // Log failure
      console.log(`${MODULE_ID} | Failed to decrypt message in ${item.name}, outcome: ${failureOutcome}`);
      return false;
    }
  }
  
  /**
   * Export a message from a data shard to character inbox
   * @param {Item} item - The item
   * @param {string} pageId - The message page ID
   * @param {Actor} recipient - The recipient actor (defaults to character)
   * @returns {Promise<boolean>} Success flag
   */
  static async exportMessage(item, pageId, recipient = null) {
    if (!item || !pageId) return false;
    
    // Get the journal
    const journalId = item.getFlag(MODULE_ID, 'journalId');
    if (!journalId) return false;
    
    const journal = game.journal.get(journalId);
    if (!journal) return false;
    
    // Get the page
    const page = journal.pages.get(pageId);
    if (!page) return false;
    
    // Check if message is decrypted
    const isDecrypted = page.getFlag(MODULE_ID, "status.decrypted");
    if (!isDecrypted) {
      ui.notifications.error("Cannot export encrypted message. Decrypt it first.");
      return false;
    }
    
    // Extract message data from the page
    const content = page.text.content;
    
    // Extract message metadata
    const dateMatch = content.match(/\[Date\](.+?)\[End\]/);
    const fromMatch = content.match(/\[From\](.+?)\[End\]/);
    const toMatch = content.match(/\[To\](.+?)\[End\]/);
    const subjectMatch = content.match(/\[Subject\](.+?)\[End\]/);
    
    // Extract content
    let messageContent = cleanHtmlContent(content);
    
    // Create export note
    const exportNote = `[This message was exported from ${item.name} on ${getCurrentDateTime()}]`;
    
    // Create message data
    const messageData = {
      from: fromMatch ? fromMatch[1].trim() : "Unknown Sender",
      to: toMatch ? toMatch[1].trim() : "Unknown Recipient", 
      subject: subjectMatch ? subjectMatch[1].trim() : page.name,
      content: `<div style="color: #19f3f7; font-style: italic; margin-bottom: 10px; padding: 5px; border: 1px solid #19f3f7; background: rgba(25, 243, 247, 0.1);">
        ${exportNote}
      </div>
      ${messageContent}`,
      date: dateMatch ? dateMatch[1].trim() : getCurrentDateTime()
    };
    
    // Use the unified export function
    return NightCityMessenger.exportMessageToInbox(messageData, recipient);
  }
  
  /**
   * Share a data shard message to chat
   * @param {Item} item - The item
   * @param {string} pageId - The message page ID
   * @returns {Promise<ChatMessage>} The created chat message
   */
  static async shareMessage(item, pageId) {
    if (!item || !pageId) return null;
    
    // Get the journal
    const journalId = item.getFlag(MODULE_ID, 'journalId');
    if (!journalId) return null;
    
    const journal = game.journal.get(journalId);
    if (!journal) return null;
    
    // Get the page
    const page = journal.pages.get(pageId);
    if (!page) return null;
    
    // Check if message is decrypted
    const isDecrypted = page.getFlag(MODULE_ID, "status.decrypted");
    if (!isDecrypted) {
      ui.notifications.error("Cannot share encrypted message. Decrypt it first.");
      return null;
    }
    
    // Extract message details
    const content = page.text.content;
    
    // Extract metadata
    const dateMatch = content.match(/\[Date\](.+?)\[End\]/);
    const fromMatch = content.match(/\[From\](.+?)\[End\]/);
    const toMatch = content.match(/\[To\](.+?)\[End\]/);
    const subjectMatch = content.match(/\[Subject\](.+?)\[End\]/);
    
    const from = fromMatch ? fromMatch[1].trim() : "Unknown Sender";
    const to = toMatch ? toMatch[1].trim() : "Unknown Recipient";
    const date = dateMatch ? dateMatch[1].trim() : "Unknown Date";
    const subject = subjectMatch ? subjectMatch[1].trim() : "No Subject";
    
    // Clean message content
    const messageContent = cleanHtmlContent(content);
    
    // Create chat message with enhanced styling
    const messageData = {
      content: `
      <div class="cyberpunk-shared-message">
        <div class="message-header-line"></div>
        <div class="message-header-bar">
          <div class="header-icon"><i class="fas fa-microchip"></i></div>
          <div class="header-title">DATA SHARD CONTENTS</div>
          <div class="header-status">DECRYPTED</div>
        </div>
        <div class="message-info">
          <div class="message-subject">${subject}</div>
          <div class="message-details" style="display: flex; flex-direction: column; gap: 5px;">
            <div class="message-detail"><span>FROM:</span> <span class="message-detail-value">${from}</span></div>
            <div class="message-detail"><span>TO:</span> <span class="message-detail-value">${to}</span></div>
            <div class="message-detail"><span>DATE:</span> <span class="message-detail-value">${date}</span></div>
            <div class="message-detail"><span>SOURCE:</span> <span class="message-detail-value">${item.name}</span></div>
          </div>
        </div>
        <div class="message-preview">
          ${messageContent}
        </div>
        <div class="message-actions-bar">
          <button class="view-message-btn" type="button" data-journal-id="${journal.id}" data-page-id="${page.id}" data-item-id="${item.id}">
            <i class="fas fa-eye"></i> View in Data Shard
          </button>
          <div class="action-line"></div>
        </div>
      </div>`,
      user: game.user.id,
      speaker: {
        alias: game.user.character?.name || game.user.name
      },
      flags: {
        [MODULE_ID]: {
          sharedDataShardMessage: true,
          messageId: page.id,
          journalId: journal.id,
          itemId: item.id,
          itemUuid: item.uuid
        }
      }
    };
    
    // Create the chat message
    const message = await ChatMessage.create(messageData);
    
    // Play notification sound
    if (getSetting('enableSounds')) {
      try {
        AUDIO.notification.play().catch(e => console.warn(`${MODULE_ID} | Audio play failed:`, e));
      } catch (e) {
        console.warn(`${MODULE_ID} | Could not play notification sound:`, e);
      }
    }
    
    ui.notifications.info("Message shared to chat!");
    return message;
  }
}

/**
 * Custom Item Sheet for Data Shards
 */
export class ItemInboxSheet extends ItemSheet {
  constructor(item, options = {}) {
    super(item, options);
    
    // Check if this is an inbox item
    const isInbox = item.getFlag(MODULE_ID, 'isInbox') === true;
    
    // If not configured as an inbox, redirect to config
    if (!isInbox) {
      // Close this sheet
      this.close();
      
      // Show config instead
      setTimeout(() => {
        ItemInboxConfig.show(item);
      }, 100);
      
      return;
    }
    
    // Initialize properties for inbox items
    this.inboxType = item.getFlag(MODULE_ID, 'inboxType') || 'single';
    this.encrypted = item.getFlag(MODULE_ID, 'encrypted') || false;
    this.skillCheck = item.getFlag(MODULE_ID, 'skillCheck') || getSetting('defaultDecryptionSkill');
    this.dvValue = item.getFlag(MODULE_ID, 'dvValue') || getSetting('defaultEncryptionDV');
    this.failureOutcome = item.getFlag(MODULE_ID, 'failureOutcome') || getSetting('defaultFailureOutcome');
    this.theme = item.getFlag(MODULE_ID, 'theme') || 'default';
    
    // Get journal
    this.journalId = item.getFlag(MODULE_ID, 'journalId');
    
    // Decryption state
    this.attemptingDecryption = false;
    this.decryptionRoll = null;
    this.selectedMessageId = null;
  }
  /**
   * Default options for the data shard sheet
   */
  static get defaultOptions() {
    return mergeObject(super.defaultOptions, {
      classes: ["cyberpunk-app", "item-inbox-sheet"],
      template: `modules/${MODULE_ID}/templates/item-inbox-sheet.html`,
      width: 650,
      height: 600,
      tabs: [{navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "messages"}],
      dragDrop: [{dragSelector: ".item-list .item", dropSelector: null}]
    });
  }
  
  /**
   * Get data for the template
   */
  async getData() {
    // Get base item data
    const data = await super.getData();
    const item = this.object;
    
    // Debug log to check current flag values
    const encryptedFlag = item.getFlag(MODULE_ID, 'encrypted');
    const dataTypeFlag = item.getFlag(MODULE_ID, 'dataShardType');
    const isDataShardFlag = item.getFlag(MODULE_ID, 'isDataShard');
    const isInboxFlag = item.getFlag(MODULE_ID, 'isInbox');
    
    console.log(`${MODULE_ID} | Current item flags:`, {
      encrypted: encryptedFlag,
      dataShardType: dataTypeFlag,
      isDataShard: isDataShardFlag,
      isInbox: isInboxFlag,
      itemId: item.id,
      hasJournal: !!item.getFlag(MODULE_ID, 'journalId')
    });
    
    // FIX: Set isDataShard based on either flag
    this.isDataShard = isDataShardFlag || isInboxFlag;
    this.inboxType = item.getFlag(MODULE_ID, 'inboxType') || 'single';
    this.encrypted = encryptedFlag || false;
    this.skillCheck = item.getFlag(MODULE_ID, 'skillCheck') || getSetting('defaultDecryptionSkill');
    this.dvValue = item.getFlag(MODULE_ID, 'dvValue') || getSetting('defaultEncryptionDV');
    this.failureOutcome = item.getFlag(MODULE_ID, 'failureOutcome') || getSetting('defaultFailureOutcome');
    this.theme = item.getFlag(MODULE_ID, 'theme') || 'default';
    
    // Get journal
    this.journalId = item.getFlag(MODULE_ID, 'journalId');
    
    // Add current date/time for display
    data.currentDate = getCurrentDateTime();
    
    // Add inbox-specific data
    data.isDataShard = this.isDataShard; // This will now be true for both isDataShard and isInbox items
    data.dataShardType = dataTypeFlag || 'single'; // Default to single if not set
    data.encrypted = encryptedFlag || false;
    data.skillCheck = item.getFlag(MODULE_ID, 'skillCheck') || getSetting('defaultDecryptionSkill');
    data.dvValue = item.getFlag(MODULE_ID, 'dvValue') || getSetting('defaultEncryptionDV');
    data.failureOutcome = item.getFlag(MODULE_ID, 'failureOutcome') || getSetting('defaultFailureOutcome');
    data.theme = item.getFlag(MODULE_ID, 'theme') || 'default';
    data.isGM = game.user.isGM;
    
    // Fix for description - ensure it's a plain string
    if (item.system && item.system.description) {
      if (typeof item.system.description === 'object') {
        data.itemDescription = item.system.description.value || "";
      } else {
        data.itemDescription = item.system.description;
      }
    } else {
      data.itemDescription = "";
    }
    
    // Add the system data 
    data.system = duplicate(item.system);
    
    // Add decryption state - FIXED: Include all decryption variables
    data.attemptingDecryption = this.attemptingDecryption;
    data.decryptionRoll = this.decryptionRoll;
    data.decryptionSuccessful = this.decryptionSuccessful;
    data.showOpenMessageButton = this.showOpenMessageButton;
    
    // Check for lockout
    data.lockedOut = false;
    const lockoutUntil = item.getFlag(MODULE_ID, 'lockoutUntil');
    if (lockoutUntil) {
      const now = Date.now();
      if (now < lockoutUntil) {
        data.lockedOut = true;
        data.lockoutRemaining = Math.ceil((lockoutUntil - now) / 1000 / 60); // minutes
      } else {
        // Clear lockout if expired
        await item.unsetFlag(MODULE_ID, 'lockoutUntil');
      }
    }
    
    // Get messages from journal
    data.messages = await this._getMessages();
    console.log(`${MODULE_ID} | Messages count: ${data.messages.length}`);
    
    // Use the actual data shard type from the flags
    data.isSingleMode = (dataTypeFlag || 'single') === 'single';
    console.log(`${MODULE_ID} | Is single mode: ${data.isSingleMode}`);

    // Auto-select in single mode if a message exists
    if (data.isSingleMode && data.messages.length > 0) {
      // Check if we need to auto-select the first message
      if (!this.selectedMessageId || !data.messages.find(m => m.id === this.selectedMessageId)) {
        this.selectedMessageId = data.messages[0].id;
        console.log(`${MODULE_ID} | Single mode - auto-selected first message: ${this.selectedMessageId}`);
      }
      data.selectedMessage = data.messages.find(m => m.id === this.selectedMessageId);
    } else if (this.selectedMessageId) {
      // Normal multi-mode selection
      data.selectedMessage = data.messages.find(m => m.id === this.selectedMessageId);
    } else {
      data.selectedMessage = null;
    }
    
    // Create Handlebars attribute for template use
    data.dataShardTypeAttr = `data-shard-type="${data.dataShardType}"`;
    
    // Add theme data
    data.themes = {
      'default': 'Default',
      'arasaka': 'Arasaka',
      'militech': 'Militech',
      'trauma': 'Trauma Team',
      'netwatch': 'NetWatch'
    };
    
    // Skill options
    data.skills = {
      'Interface': 'Interface',
      'ElectronicsSecurity': 'Electronics/Security Tech',
      'Cryptography': 'Cryptography',
      'Education': 'Education'
    };
    
    // Failure outcomes
    data.failureOutcomes = {
      'none': 'No Effect',
      'lockout': 'Lockout (5 min)',
      'traceback': 'Traceback Alert',
      'damage': 'Feedback Damage',
      'corrupt': 'Corrupt Message'
    };
    
    // Add current date
    data.currentDate = new Date().toLocaleString();
    
    return data;
  }
  
  /**
   * Get messages from the data shard
   * @returns {Promise<Array>} Array of messages
   * @private
   */
  async _getMessages() {
    const messages = [];
    
    // Get the journal
    if (!this.journalId) return messages;
    
    const journal = game.journal.get(this.journalId);
    if (!journal) return messages;
    
    // Get pages
    const pages = journal.pages.contents || [];
    
    // Process each page
    for (const page of pages) {
      const status = page.getFlag(MODULE_ID, "status") || {};
      const content = page.text?.content || "";
      
      // Extract metadata
      const dateMatch = content.match(/\[Date\](.+?)\[End\]/);
      const fromMatch = content.match(/\[From\](.+?)\[End\]/);
      const toMatch = content.match(/\[To\](.+?)\[End\]/);
      const subjectMatch = content.match(/\[Subject\](.+?)\[End\]/);
      
      // Each message can have individual encryption status
      const messageEncrypted = status.encrypted !== undefined ? status.encrypted : this.encrypted; // Fall back to data shard setting
      const locallyDecrypted = this._isMessageDecrypted(page.id);

      messages.push({
        id: page.id,
        name: page.name,
        date: dateMatch ? dateMatch[1].trim() : "Unknown Date",
        from: fromMatch ? fromMatch[1].trim() : "Unknown Sender",
        to: toMatch ? toMatch[1].trim() : "Unknown Recipient",
        subject: subjectMatch ? subjectMatch[1].trim() : "No Subject",
        content: cleanHtmlContent(content),
        isEncrypted: messageEncrypted && !status.decrypted && !locallyDecrypted,
        isDecrypted: status.decrypted || locallyDecrypted,
        isCorrupted: status.corrupted,
        isRead: status.read
      });
    }
    
    return messages;
  }
  
  /**
   * Activate listeners
   * @param {jQuery} html - The HTML
   */
  activateListeners(html) {
    super.activateListeners(html);
    
    // Debug what buttons exist
    console.log("Available buttons in item-inbox.js:", {
      toggleEncryption: html.find('.toggle-encryption').length,
      toggleType: html.find('.toggle-data-shard-type').length,
      exportBtn: html.find('.export-button, .action-btn.export-btn').length,
      shareBtn: html.find('.share-button, .action-btn.share-btn').length,
      decryptBtn: html.find('.decrypt-button').length
    });

    // Revert Back to Normal Item
    console.log("Setting up revert button listener");

    // Then set up the click listener with proper selector
    html.find('button.revert-to-normal-item').click(async ev => {
      console.log("Revert button clicked");
      
      ev.preventDefault();
      
      // Show confirmation dialog
      const confirmed = await Dialog.confirm({
        title: "Revert to Normal Item?",
        content: "This will switch the view back to the standard item sheet. Your data shard configuration will be preserved.",
        yes: () => true,
        no: () => false
      });
      
      if (confirmed) {
        console.log("Confirmation accepted, switching to default sheet");
        
        // Close this sheet
        await this.close();
        
        // Remove the flag that marks this as an inbox
        await this.object.update({
          "flags.core.sheetClass": null,
          "flags.cyberpunkred-messenger.isInbox": false
        });
        
        // Force open default sheet after a short delay
        setTimeout(() => {
          console.log("Opening default sheet");
          // Force it to use the system's default sheet
          const newSheet = this.object.sheet;
          newSheet.render(true);
        }, 200);
      }
    });
    
    // Check if we're in single mode
    const isSingleMode = this.object.getFlag(MODULE_ID, 'dataShardType') === 'single';
    console.log(`${MODULE_ID} | In activateListeners, isSingleMode: ${isSingleMode}`);
    
    // Apply single mode styling
    if (isSingleMode) {
      html.find('.messages-container').addClass('single-mode');
      
      // Hide message list in single mode
      html.find('.message-list').hide();
      
      // Make message detail take full width
      html.find('.message-detail').css({
        'grid-column': '1 / -1',
        'width': '100%'
      });
      
      // Show add message button if no messages
      if (this.selectedMessageId === null) {
        html.find('.add-message-button').addClass('highlight-button');
      }
    } else {
      // Multi mode
      html.find('.messages-container').removeClass('single-mode');
      html.find('.message-list').show();
    }
    
    // Config options - Use direct jQuery binding
    html.find('.toggle-encryption').on('click', event => {
      event.preventDefault();
      console.log("Toggle encryption clicked");
      this._toggleEncryption(event);
    });
    
    html.find('.toggle-data-shard-type').on('click', event => {
      event.preventDefault();
      console.log("Toggle data shard type clicked");
      this._toggleDataShardType(event);
    });

    // Add this with your other button listeners
    html.find('.open-message-btn').on('click', event => {
      event.preventDefault();
      console.log("Open message button clicked");
      this._openDecryptedMessage(event);
    });
    
    // Use direct selectors for form elements
    html.find('select.skill-select').on('change', event => this._updateSkill(event));
    html.find('input.dv-input').on('change', event => this._updateDV(event));
    html.find('select.failure-outcome-select').on('change', event => this._updateFailureOutcome(event));
    html.find('select.theme-select').on('change', event => this._updateTheme(event));
    
    // Message list
    html.find('.message-item').on('click', event => {
      event.preventDefault();
      console.log("Message item clicked");
      this._selectMessage(event);
    });

    // Reset Decryption
    html.find('.reset-decryption-btn').on('click', event => {
      event.preventDefault();
      console.log("Reset decryption button clicked");
      this._resetDecryption(event);
    });

    // Toggle Single Message Encryption
    html.find('.toggle-message-encryption').on('click', event => {
      event.preventDefault();
      console.log("Toggle message encryption clicked");
      this._toggleMessageEncryption(event);
    });
    
    // Add message button
    html.find('.add-message-button').on('click', event => {
      event.preventDefault();
      console.log("Add message button clicked");
      this._addNewMessage(event);
    });
    
    // Decrypt button
    html.find('.decrypt-button').on('click', event => {
      event.preventDefault();
      console.log("Decrypt button clicked");
      this._attemptDecryption(event);
    });
    
    // Message actions - Try more specific selectors
    html.find('button.export-button, button.action-btn.export-btn').on('click', event => {
      event.preventDefault();
      console.log("Export button clicked");
      this._exportToInbox(event);
    });
    
    html.find('button.share-button, button.action-btn.share-btn').on('click', event => {
      event.preventDefault();
      console.log("Share button clicked");
      this._shareMessage(event);
    });
    
    // Roll skill check
    html.find('.roll-skill-check').on('click', event => {
      event.preventDefault();
      console.log("Roll skill check clicked");
      this._rollSkillCheck(event);
    });
  }


  
  /**
   * Toggle encryption
   * @param {Event} event - Click event
   * @private
   */
  async _toggleEncryption(event) {
    event.preventDefault();
    
    if (!game.user.isGM) {
      ui.notifications.error("Only GMs can modify encryption settings");
      return;
    }
    
    const item = this.object;
    const currentlyEncrypted = this.encrypted;
    
    try {
      // Toggle global encryption
      await item.update({
        [`flags.${MODULE_ID}.encrypted`]: !currentlyEncrypted
      });
      
      // If disabling encryption, mark all messages as decrypted
      if (currentlyEncrypted) {
        const journalId = item.getFlag(MODULE_ID, 'journalId');
        if (journalId) {
          const journal = game.journal.get(journalId);
          if (journal) {
            // Update all pages to be decrypted
            const updates = journal.pages.map(page => ({
              _id: page.id,
              [`flags.${MODULE_ID}.status.encrypted`]: false,
              [`flags.${MODULE_ID}.status.decrypted`]: true
            }));
            
            await journal.updateEmbeddedDocuments("JournalEntryPage", updates);
            
            // Clear all local decryption states
            journal.pages.forEach(page => {
              const decryptionKey = `${MODULE_ID}-decrypted-${item.id}-${page.id}`;
              localStorage.removeItem(decryptionKey);
            });
          }
        }
        
        ui.notifications.info("Encryption disabled - all messages are now accessible");
      } else {
        ui.notifications.info("Encryption enabled - use individual message buttons to encrypt specific messages");
      }
      
      this.encrypted = !currentlyEncrypted;
      this.render(true);
      
    } catch (error) {
      console.error(`${MODULE_ID} | Error toggling encryption:`, error);
      ui.notifications.error("Failed to toggle encryption");
    }
  }
  
  /**
   * Toggle data shard type
   * @param {Event} event - Click event
   * @private
   */
  async _toggleDataShardType(event) {
    event.preventDefault();
    
    // Get current state with explicit defaults
    const item = this.object;
    const currentType = item.getFlag(MODULE_ID, 'dataShardType') || 'single';
    
    // Log current state
    console.log(`${MODULE_ID} | Current data shard type:`, currentType);
    
    // Toggle type
    const newType = currentType === 'single' ? 'multi' : 'single';
    
    try {
      // Update the local property first
      this.dataShardType = newType;
      
      // Set the flag with explicit update
      await item.update({
        [`flags.${MODULE_ID}.dataShardType`]: newType
      });
      
      // Log new state
      console.log(`${MODULE_ID} | New data shard type saved:`, newType);
      
      // Show notification
      ui.notifications.info(`Data Shard type changed to ${newType === 'single' ? 'Single Message' : 'Multi Message'}`);
      
      // Force a complete re-render after a short delay to ensure flags are saved
      setTimeout(() => {
        // Reset selectedMessageId when switching modes
        if (newType === 'single') {
          // In single mode, auto-select the first message if available
          this._selectFirstMessage();
        }
        this.render(true);
      }, 100);
      
      return true;
    } catch (error) {
      console.error(`${MODULE_ID} | Error toggling data shard type:`, error);
      return false;
    }
  }
  
  /**
   * Select the first available message
   * @private
   */
  async _selectFirstMessage() {
    // Get the journal
    const journalId = this.object.getFlag(MODULE_ID, 'journalId');
    if (!journalId) return;
    
    const journal = game.journal.get(journalId);
    if (!journal || !journal.pages || journal.pages.size === 0) return;
    
    // Get the first page
    const firstPage = journal.pages.contents[0];
    if (firstPage) {
      console.log(`${MODULE_ID} | Auto-selecting first message: ${firstPage.id}`);
      this.selectedMessageId = firstPage.id;
    }
  }

  /**
   * Update skill check
   * @param {Event} event - Change event
   * @private
   */
  async _updateSkill(event) {
    const item = this.object;
    const skill = event.currentTarget.value;
    
    try {
      // Update the local property
      this.skillCheck = skill;
      
      // Use update instead of setFlag
      await item.update({
        [`flags.${MODULE_ID}.skillCheck`]: skill
      });
      
      console.log(`${MODULE_ID} | Skill updated to:`, skill);
      return true;
    } catch (error) {
      console.error(`${MODULE_ID} | Error updating skill:`, error);
      return false;
    }
  }
  
  /**
   * Update difficulty value
   * @param {Event} event - Change event
   * @private
   */
  async _updateDV(event) {
    const item = this.object;
    const dv = parseInt(event.currentTarget.value) || 15;
    
    try {
      // Update the local property
      this.dvValue = dv;
      
      // Use update instead of setFlag
      await item.update({
        [`flags.${MODULE_ID}.dvValue`]: dv
      });
      
      console.log(`${MODULE_ID} | DV updated to:`, dv);
      return true;
    } catch (error) {
      console.error(`${MODULE_ID} | Error updating DV:`, error);
      return false;
    }
  }
  
  /**
   * Update failure outcome
   * @param {Event} event - Change event
   * @private
   */
  async _updateFailureOutcome(event) {
    const item = this.object;
    const outcome = event.currentTarget.value;
    
    try {
      // Update the local property
      this.failureOutcome = outcome;
      
      // Use update instead of setFlag
      await item.update({
        [`flags.${MODULE_ID}.failureOutcome`]: outcome
      });
      
      console.log(`${MODULE_ID} | Failure outcome updated to:`, outcome);
      return true;
    } catch (error) {
      console.error(`${MODULE_ID} | Error updating failure outcome:`, error);
      return false;
    }
  }
  
  /**
   * Update theme
   * @param {Event} event - Change event
   * @private
   */
  async _updateTheme(event) {
    const item = this.object;
    const theme = event.currentTarget.value;
    
    try {
      // Update the local property
      this.theme = theme;
      
      // Use update instead of setFlag
      await item.update({
        [`flags.${MODULE_ID}.theme`]: theme
      });
      
      console.log(`${MODULE_ID} | Theme updated to:`, theme);
      
      // Force re-render to apply theme
      this.render(true);
      return true;
    } catch (error) {
      console.error(`${MODULE_ID} | Error updating theme:`, error);
      return false;
    }
  }
  
  /**
   * Select a message
   * @param {Event} event - Click event
   * @private
   */
  _selectMessage(event) {
    event.preventDefault();
    
    const messageId = event.currentTarget.dataset.messageId;
    this.selectedMessageId = messageId;
    
    this.render(true);
  }
  
  /**
   * Attempt to decrypt a message
   * @param {Event} event - Click event
   * @private
   */
  _attemptDecryption(event) {
    event.preventDefault();
    
    if (!this.selectedMessageId) {
      ui.notifications.error("No message selected");
      return;
    }
    
    this.attemptingDecryption = true;
    this.render(true);
  }
  
  /**
   * Roll skill check for decryption
   * @param {Event} event - Click event
   * @private
   */
  async _rollSkillCheck(event) {
    event.preventDefault();
    
    const item = this.object;
    const actor = game.user.character || item.actor;
    
    if (!actor) {
      ui.notifications.warn("No character available to make this check.");
      return;
    }
    
    // FIXED: Make sure we have a selected message
    if (!this.selectedMessageId) {
      ui.notifications.error("No message selected for decryption");
      return;
    }
    
    console.log(`Rolling with actor: ${actor.name} for message: ${this.selectedMessageId}`);
    
    // Map skill check type to proper Cyberpunk RED skill name
    let skillName = this.skillCheck || 'Interface';
    
    // Ensure skill name matches exactly the skill names in the Cyberpunk RED system
    const cprSkillMap = {
      'Interface': 'Interface',
      'ElectronicsSecurity': 'Electronics/Security Tech',
      'Cryptography': 'Cryptography',
      'Education': 'Education',
      'BasicTech': 'Basic Tech',
      'Cybertech': 'Cybertech'
    };
    
    // Use the mapped skill name if available
    skillName = cprSkillMap[skillName] || skillName;
    
    console.log(`Using skill: ${skillName}`);
    const dvValue = this.dvValue || 15;
    
    // Use our custom roll handler
    const result = await handleDecryptionRoll(actor, skillName, dvValue);
    console.log("Decryption roll result:", result);
    
    // Store the roll result
    this.decryptionRoll = result;
    this.decryptionRoll.messageId = this.selectedMessageId; // ADD THIS
    
    // Process the results for the SPECIFIC selected message
    if (result.success) {
      console.log(`${MODULE_ID} | Decryption successful for message: ${this.selectedMessageId}`);
      
      // Store success state for THIS message specifically
      this.decryptionSuccessful = true;
      this.showOpenMessageButton = true;
      
      await this._handleSuccessfulDecryption();
    } else {
      console.log(`${MODULE_ID} | Decryption failed for message: ${this.selectedMessageId}`);
      this.decryptionSuccessful = false;
      this.showOpenMessageButton = false;
      await this._handleFailedDecryption();
    }

    this.render(true);
  }

  /**
   * Toggle encryption for a specific message (GM only)
   * @param {Event} event - Click event
   * @private
   */
  async _toggleMessageEncryption(event) {
    event.preventDefault();
    
    if (!game.user.isGM) {
      ui.notifications.error("Only GMs can modify message encryption");
      return;
    }
    
    const messageId = event.currentTarget.dataset.messageId;
    if (!messageId) {
      ui.notifications.error("No message ID found");
      return;
    }
    
    const item = this.object;
    const journalId = item.getFlag(MODULE_ID, 'journalId');
    if (!journalId) {
      ui.notifications.error("No journal found for this data shard");
      return;
    }
    
    const journal = game.journal.get(journalId);
    if (!journal) {
      ui.notifications.error("Journal not found");
      return;
    }
    
    const page = journal.pages.get(messageId);
    if (!page) {
      ui.notifications.error("Message page not found");
      return;
    }
    
    try {
      // Get current status
      const status = page.getFlag(MODULE_ID, "status") || {};
      const currentlyEncrypted = status.encrypted !== undefined ? status.encrypted : this.encrypted;
      
      // Toggle encryption for this specific message
      await page.update({
        [`flags.${MODULE_ID}.status`]: { 
          ...status, 
          encrypted: !currentlyEncrypted,
          decrypted: false, // Reset decryption when toggling encryption
          decryptedBy: null,
          decryptedAt: null
        }
      });
      
      // Clear any local decryption for this message
      const decryptionKey = `${MODULE_ID}-decrypted-${item.id}-${messageId}`;
      localStorage.removeItem(decryptionKey);
      
      ui.notifications.info(`Message ${!currentlyEncrypted ? 'encrypted' : 'decrypted'}`);
      this.render(true);
      
    } catch (error) {
      console.error(`${MODULE_ID} | Error toggling message encryption:`, error);
      ui.notifications.error("Failed to toggle message encryption");
    }
  }

  /**
   * Open decrypted message in a popup viewer
   * @param {Event} event - Click event
   * @private
   */
  async _openDecryptedMessage(event) {
    event.preventDefault();
    
    if (!this.selectedMessageId) {
      ui.notifications.error("No message selected");
      return;
    }
    
    const item = this.object;
    const journalId = item.getFlag(MODULE_ID, 'journalId');
    
    if (!journalId) {
      ui.notifications.error("No message journal found");
      return;
    }
    
    const journal = game.journal.get(journalId);
    if (!journal) {
      ui.notifications.error("Message journal not found");
      return;
    }
    
    const page = journal.pages.get(this.selectedMessageId);
    if (!page) {
      ui.notifications.error("Message not found");
      return;
    }
    
    // Extract message details
    const content = page.text.content;
    const dateMatch = content.match(/\[Date\](.+?)\[End\]/);
    const fromMatch = content.match(/\[From\](.+?)\[End\]/);
    const toMatch = content.match(/\[To\](.+?)\[End\]/);
    const subjectMatch = content.match(/\[Subject\](.+?)\[End\]/);
    
    const messageData = {
      from: fromMatch ? fromMatch[1].trim() : "Unknown Sender",
      to: toMatch ? toMatch[1].trim() : "Unknown Recipient",
      subject: subjectMatch ? subjectMatch[1].trim() : "No Subject",
      content: content,
      date: dateMatch ? dateMatch[1].trim() : "Unknown Date"
    };
    
    // Use the unified system to show the data shard viewer popup
    const { showDataShardViewerPopup } = await import('./unified-shared-message-viewer.js');
    await showDataShardViewerPopup(item.id, this.selectedMessageId);
  }

 /**
  * Handle successful decryption with cool animation
  * @private
  */
 async _handleSuccessfulDecryption() {
   // Store decryption state locally (per user)
   const decryptionKey = `${MODULE_ID}-decrypted-${this.object.id}-${this.selectedMessageId}`;
   localStorage.setItem(decryptionKey, 'true');
   
   // Also store in memory for immediate use
   this.decryptedMessages = this.decryptedMessages || new Set();
   this.decryptedMessages.add(this.selectedMessageId);
   
   this.decryptionSuccessful = true;
   this.showOpenMessageButton = true;
   
   // Create cyberpunk success animation
   this._showDecryptionSuccessAnimation();
   
   ui.notifications.info("Decryption successful! Message unlocked.");
 }

 /**
  * Show cyberpunk hacking/decryption animation
  * @private
  */
 _showDecryptionSuccessAnimation() {
   // Create a hacking-style overlay
   const overlay = $(`
     <div id="hacking-overlay" style="
       position: fixed; 
       top: 0; 
       left: 0; 
       right: 0; 
       bottom: 0; 
       background: rgba(0,0,0,0.95); 
       z-index: 100000; 
       display: flex; 
       align-items: center; 
       justify-content: center; 
       font-family: 'Courier New', monospace;
     ">
       <div style="
         width: 500px; 
         background: linear-gradient(135deg, #0a0a0a, #1a1a1a); 
         border: 1px solid #00ff00; 
         color: #00ff00; 
         overflow: hidden; 
         box-shadow: 
           0 0 50px rgba(0,255,0,0.3),
           inset 0 0 50px rgba(0,255,0,0.05);
       ">
         <!-- Terminal header -->
         <div style="
           background: #000; 
           padding: 8px 15px; 
           border-bottom: 1px solid #00ff00;
           font-size: 0.9em;
           display: flex;
           justify-content: space-between;
         ">
           <span>[NETRUNNER@NEURAL-LINK]</span>
           <span class="terminal-cursor" style="animation: cursor-blink 1s infinite;">█</span>
         </div>
         
         <!-- Hacking content -->
         <div style="padding: 20px; min-height: 200px;">
           <div class="hack-lines" style="margin-bottom: 15px;">
             <div class="hack-line" style="margin: 3px 0; opacity: 0;">$ initiating quantum decryption...</div>
             <div class="hack-line" style="margin: 3px 0; opacity: 0;">$ scanning neural pathways...</div>
             <div class="hack-line" style="margin: 3px 0; opacity: 0;">$ bypassing ice protocols...</div>
             <div class="hack-line" style="margin: 3px 0; opacity: 0;">$ cracking encryption matrix...</div>
             <div class="hack-line" style="margin: 3px 0; opacity: 0; color: #ffff00;">! firewall detected - adapting...</div>
             <div class="hack-line" style="margin: 3px 0; opacity: 0;">$ deploying counter-intrusion...</div>
             <div class="hack-line" style="margin: 3px 0; opacity: 0;">$ accessing data fragments...</div>
             <div class="hack-line" style="margin: 3px 0; opacity: 0; color: #ff6600;">! system resistance encountered...</div>
             <div class="hack-line" style="margin: 3px 0; opacity: 0;">$ executing neural override...</div>
             <div class="hack-line" style="margin: 3px 0; opacity: 0;">$ decryption vector established...</div>
             <div class="hack-line" style="margin: 3px 0; opacity: 0; color: #00ffff;">$ breakthrough achieved!</div>
             <div class="hack-line success-line" style="margin: 10px 0; opacity: 0; color: #00ff00; font-weight: bold; font-size: 1.1em;">
               ✓ ENCRYPTION BROKEN - DATA ACCESSIBLE
             </div>
           </div>
           
           <!-- Fake code matrix -->
           <div class="code-matrix" style="
             background: #0a0a0a;
             padding: 10px;
             border: 1px solid #00ff00;
             font-size: 0.8em;
             line-height: 1.2;
             overflow: hidden;
             height: 60px;
           ">
             <div class="matrix-line">01001000 01100001 01100011 01101011</div>
             <div class="matrix-line">11100101 10110011 00101110 01000001</div>
             <div class="matrix-line">00110101 11001010 01110110 10001100</div>
           </div>
         </div>
       </div>
     </div>
   `);
   
   // Add hacking CSS animations
   if (!$('#hacking-animations').length) {
     $('head').append(`
       <style id="hacking-animations">
         @keyframes cursor-blink {
           0%, 50% { opacity: 1; }
           51%, 100% { opacity: 0; }
         }
         
         @keyframes type-appear {
           0% { 
             opacity: 0;
             transform: translateX(-10px);
           }
           100% { 
             opacity: 1;
             transform: translateX(0);
           }
         }
         
         @keyframes matrix-scroll {
           0% { transform: translateY(0); }
           100% { transform: translateY(-20px); }
         }
         
         .matrix-line {
           animation: matrix-scroll 3s linear infinite;
           color: #00ff00;
           opacity: 0.7;
         }
         
         .matrix-line:nth-child(2) {
           animation-delay: -1s;
         }
         
         .matrix-line:nth-child(3) {
           animation-delay: -2s;
         }
       </style>
     `);
   }
   
   // Add to DOM
   $('body').append(overlay);
   
   // Animate hacking lines appearing one by one
   const hackLines = overlay.find('.hack-line');
   let currentLine = 0;
   
   const typeInterval = setInterval(() => {
     if (currentLine < hackLines.length) {
       const line = hackLines.eq(currentLine);
       line.css({
         opacity: 1,
         animation: 'type-appear 0.3s ease-out'
       });
       
       // Add typing sound effect (visual)
       if (currentLine < hackLines.length - 1) {
         // Regular hack line
         setTimeout(() => {
           line.append('<span style="animation: cursor-blink 0.5s;">█</span>');
           setTimeout(() => line.find('span').remove(), 400);
         }, 100);
       }
       
       currentLine++;
     } else {
       clearInterval(typeInterval);
       
       // Show success and wait before closing
       setTimeout(() => {
         overlay.fadeOut(800, () => {
           overlay.remove();
         });
       }, 1500);
     }
   }, 400); // Each line appears every 400ms
 }

  async _handleFailedDecryption() {
    const failureOutcome = this.failureOutcome || 'none';
    
    switch (failureOutcome) {
      case 'lockout':
        // Set a lockout timer (5 minutes)
        const lockoutUntil = Date.now() + (1000 * 60 * 5);
        await this.object.setFlag(MODULE_ID, 'lockoutUntil', lockoutUntil);
        ui.notifications.warn("Decryption failed! System locked for 5 minutes.");
        break;
        
      case 'traceback':
        // Send notification to GM
        ui.notifications.warn("Decryption failed! Traceback detected!");
        
        if (!game.user.isGM) {
          game.socket.emit(`module.${MODULE_ID}`, {
            operation: 'traceback',
            itemName: this.object.name,
            characterName: game.user.character?.name || "Unknown"
          });
        }
        break;
        
      case 'damage':
        // Calculate damage based on DV
        const damage = Math.floor(this.dvValue / 3);
        ui.notifications.warn(`Decryption failed! Feedback shock! ${damage} EMP damage applied.`);
        break;
        
      case 'corrupt':
        // Corrupt the message
        const journalId = this.object.getFlag(MODULE_ID, 'journalId');
        const journal = game.journal.get(journalId);
        const page = journal?.pages.get(this.selectedMessageId);
        
        if (page) {
          await page.update({
            [`flags.${MODULE_ID}.status.corrupted`]: true
          });
        }
        
        ui.notifications.error("Decryption failed! Message data corrupted!");
        break;
        
      default:
        ui.notifications.warn("Decryption failed!");
    }
  }

  /**
   * Check if a message is decrypted (locally)
   * @param {string} messageId - The message ID
   * @returns {boolean} Is decrypted
   * @private
   */
  _isMessageDecrypted(messageId) {
    // Check memory first
    if (this.decryptedMessages?.has(messageId)) {
      return true;
    }
    
    // Check localStorage
    const decryptionKey = `${MODULE_ID}-decrypted-${this.object.id}-${messageId}`;
    return localStorage.getItem(decryptionKey) === 'true';
  }

  /**
   * Reset all decryption states (GM only)
   * @param {Event} event - Click event
   * @private
   */
  async _resetDecryption(event) {
    event.preventDefault();
    
    if (!game.user.isGM) {
      ui.notifications.error("Only GMs can reset decryption states");
      return;
    }
    
    const item = this.object;
    
    const confirmed = await Dialog.confirm({
      title: "Reset Decryption",
      content: `
        <div style="margin-bottom: 15px;">
          <strong>Reset Decryption for "${item.name}"</strong>
        </div>
        <p>This will:</p>
        <ul>
          <li>Clear all local decryption states for this data shard</li>
          <li>Reset all messages in this item to encrypted state</li>
          <li>All players will need to decrypt again</li>
        </ul>
        <p><strong>This action cannot be undone!</strong></p>
      `,
      yes: () => true,
      no: () => false,
      defaultYes: false
    });
    
    if (!confirmed) return;
    
    try {
      // Clear local decryption states for this item only
      const journalId = item.getFlag(MODULE_ID, 'journalId');
      if (journalId) {
        const journal = game.journal.get(journalId);
        if (journal) {
          // Clear localStorage for all messages in THIS data shard only
          journal.pages.contents.forEach(page => {
            const decryptionKey = `${MODULE_ID}-decrypted-${item.id}-${page.id}`;
            localStorage.removeItem(decryptionKey);
          });
          
          // Clear any journal page decryption flags for this item (if GM has permission)
          for (const page of journal.pages.contents) {
            try {
              const status = page.getFlag(MODULE_ID, "status") || {};
              if (status.decrypted) {
                await page.update({
                  [`flags.${MODULE_ID}.status`]: { 
                    ...status, 
                    decrypted: false,
                    decryptedBy: null,
                    decryptedAt: null
                  }
                });
              }
            } catch (error) {
              console.warn(`${MODULE_ID} | Could not reset journal flag for page ${page.id}:`, error);
            }
          }
        }
      }
      
      // Clear memory cache for this sheet
      this.decryptedMessages = new Set();
      this.decryptionSuccessful = false;
      this.showOpenMessageButton = false;
      this.decryptionRoll = null;
      this.attemptingDecryption = false;
      
      // Re-render this sheet
      this.render(true);
      
      ui.notifications.info(`Decryption reset for "${item.name}"!`);
      
      // Notify other users to refresh THIS data shard only
      game.socket.emit(`module.${MODULE_ID}`, {
        type: 'refreshDecryption',
        itemId: item.id,
        itemName: item.name,
        gmName: game.user.name
      });
      
    } catch (error) {
      console.error(`${MODULE_ID} | Error resetting decryption:`, error);
      ui.notifications.error("Failed to reset decryption states");
    }
  }
  
  /**
   * Export message to inbox
   * @param {Event} event - Click event
   * @private
   */
  async _exportToInbox(event) {
    event.preventDefault();
    
    if (!this.selectedMessageId) {
      ui.notifications.error("No message selected");
      return;
    }
    
    const item = this.object;
    await ItemInbox.exportMessage(item, this.selectedMessageId);
  }
  
  /**
   * Enhanced share message method for ItemInboxSheet class
   * Replace the existing _shareMessage method in ItemInboxSheet
   * @param {Event} event - Click event
   * @private
   */
  async _shareMessage(event) {
    event.preventDefault();
    return await shareMessageFromDataShard(this.selectedMessageId, this.object);
  }
  
  /**
   * Add a new message
   * @param {Event} event - Click event
   * @private
   */
  async _addNewMessage(event) {
    event.preventDefault();
    
    const item = this.object;
    
    // FIX: Check for either flag and auto-upgrade if needed
    const isDataShard = item.getFlag(MODULE_ID, 'isDataShard');
    const isInbox = item.getFlag(MODULE_ID, 'isInbox');
    
    if (!isDataShard && !isInbox) {
      ui.notifications.error("This item is not configured as a data shard or inbox");
      return;
    }
    
    // Auto-upgrade inbox to data shard if needed
    if (isInbox && !isDataShard) {
      console.log(`${MODULE_ID} | Auto-upgrading inbox to data shard for message addition`);
      await item.setFlag(MODULE_ID, 'isDataShard', true);
      
      // Set default values if not present
      if (!item.getFlag(MODULE_ID, 'dataShardType')) {
        await item.setFlag(MODULE_ID, 'dataShardType', 'single');
      }
      if (item.getFlag(MODULE_ID, 'encrypted') === undefined) {
        await item.setFlag(MODULE_ID, 'encrypted', false);
      }
      
      // Re-render to update the UI
      this.render(true);
    }
    
    // Check if this is a single message data shard
    const dataShardType = item.getFlag(MODULE_ID, 'dataShardType') || 'single';
    if (dataShardType === 'single' && this._getMessages().length > 0) {
      const confirm = await Dialog.confirm({
        title: "Replace Message",
        content: "This is a single message data shard. Adding a new message will replace the existing one. Continue?",
        defaultYes: false
      });
      
      if (!confirm) return;
    }
    
    // Open a dialog to compose the message
    new Dialog({
      title: "Compose Data Shard Message",
      content: `
        <form>
          <div class="form-group">
            <label>From:</label>
            <input type="text" name="from" value="${game.user.character?.name || 'Unknown'}" placeholder="Sender Name">
          </div>
          <div class="form-group">
            <label>To:</label>
            <input type="text" name="to" value="Data Shard Recipient" placeholder="Recipient Name">
          </div>
          <div class="form-group">
            <label>Subject:</label>
            <input type="text" name="subject" placeholder="Message Subject">
          </div>
          <div class="form-group">
            <label>Content:</label>
            <textarea name="content" rows="10" placeholder="Message Content"></textarea>
          </div>
        </form>
      `,
      buttons: {
        add: {
          icon: '<i class="fas fa-plus"></i>',
          label: "Add Message",
          callback: html => {
            const from = html.find('[name="from"]').val();
            const to = html.find('[name="to"]').val();
            const subject = html.find('[name="subject"]').val();
            const content = html.find('[name="content"]').val();
            
            if (!subject || !content) {
              ui.notifications.error("Subject and content are required");
              return;
            }
            
            ItemInbox.addMessage(item, {
              from,
              to,
              subject,
              content
            }).then(() => this.render(true));
          }
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: "Cancel"
        }
      },
      default: "add",
      render: html => {
        // Add some styling
        html.find('.form-group').css({
          'margin-bottom': '10px'
        });
        html.find('input, textarea').css({
          'width': '100%',
          'background': '#1a1a1a',
          'color': '#ffffff',
          'border': '1px solid #F65261',
          'padding': '5px',
          'border-radius': '3px'
        });
        html.find('textarea').css({
          'height': '150px',
          'resize': 'vertical'
        });
      }
    }).render(true);
  }
}
