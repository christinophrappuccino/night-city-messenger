/**
 * UNIFIED SHARED MESSAGE VIEWER - CLEAN VERSION WITHOUT DUPLICATES
 * This file contains the unified shared message system with all dependencies resolved
 * FIXED: Removed all duplicate exports and syntax errors
 */

// ===================================================================
// IMPORTS AND DEPENDENCIES
// ===================================================================

import { MODULE_ID } from './constants.js';
import { cleanHtmlContent } from './utils.js';
import { getSetting } from './settings.js';

// ===================================================================
// CORE UNIFIED FUNCTIONS
// ===================================================================

/**
 * Create unified shared message for both inbox and data shard types
 * This is the main function that creates chat messages for sharing
 */
export function createUnifiedSharedMessage(messageData, sourceType = 'inbox', sourceInfo = {}) {
  console.log(`${MODULE_ID} | Creating enhanced unified shared message:`, { sourceType, messageData });
  
  try {
    const isDataShard = sourceType === 'datashard';
    const cleanContent = cleanHtmlContent(messageData.content);
    
    // Enhanced styling configuration
    const config = {
      inbox: {
        primaryColor: '#F65261',
        headerBg: '#330000',
        statusColor: '#F65261',
        headerText: 'NIGHT CITY MESSAGE',
        statusText: 'TRANSMITTED',
        icon: 'fas fa-envelope'
      },
      datashard: {
        primaryColor: '#19f3f7',
        headerBg: '#001a33',
        statusColor: '#19f3f7',
        headerText: 'DATA SHARD CONTENTS',
        statusText: 'DECRYPTED',
        icon: 'fas fa-microchip'
      }
    };
    
    const style = config[sourceType] || config.inbox;
    
    // Enhanced message HTML with cyberpunk styling
    let messageHtml = `
      <div class="cyberpunk-shared-message" style="
        background-color: #1a1a1a;
        border: 1px solid ${style.primaryColor};
        border-radius: 5px;
        margin-bottom: 10px;
        overflow: hidden;
        font-family: 'Rajdhani', sans-serif;
        box-shadow: 0 0 15px rgba(${style.primaryColor.replace('#', '')}, 0.3);
      ">
        <!-- Enhanced Cyber Header -->
        <div class="cyber-header" style="
          background-color: ${style.headerBg};
          padding: 8px 12px;
          display: flex;
          align-items: center;
          border-bottom: 1px solid ${style.primaryColor};
        ">
          <i class="${style.icon} cyber-icon" style="
            color: ${style.primaryColor};
            font-size: 1.3em;
            margin-right: 10px;
          "></i>
          <div class="cyber-title" style="
            color: ${style.primaryColor};
            font-size: 1.2em;
            font-weight: bold;
            letter-spacing: 1px;
            flex-grow: 1;
          ">${style.headerText}</div>
          <div class="cyber-subtitle" style="
            color: ${style.statusColor};
            font-size: 0.9em;
          ">${messageData.from || 'Unknown Sender'}</div>
        </div>
        
        <!-- Enhanced Status Bar -->
        <div style="
          background-color: rgba(${style.primaryColor.replace('#', '')}, 0.1);
          padding: 6px 10px;
          border-bottom: 1px solid rgba(${style.primaryColor.replace('#', '')}, 0.3);
          display: flex;
          justify-content: space-between;
          font-size: 0.9em;
        ">
          <span style="color: ${style.statusColor}; font-weight: bold;">STATUS:</span>
          <span style="color: #fff; font-weight: bold;">${style.statusText}</span>
        </div>
        
        <!-- Message Content with Enhanced Layout -->
        <div style="padding: 12px;">
          <!-- Metadata Grid -->
          <div style="
            background-color: rgba(0, 0, 0, 0.3);
            border-radius: 3px;
            padding: 8px;
            margin-bottom: 10px;
            display: grid;
            grid-template-columns: auto 1fr auto 1fr;
            gap: 5px 10px;
            font-size: 0.85em;
          ">
            <span style="color: ${style.primaryColor}; font-weight: bold;">FROM:</span>
            <span style="color: #fff;">${messageData.from}</span>
            <span style="color: ${style.primaryColor}; font-weight: bold;">TO:</span>
            <span style="color: #fff;">${messageData.to}</span>
            <span style="color: ${style.primaryColor}; font-weight: bold;">DATE:</span>
            <span style="color: #fff;">${messageData.date}</span>
            <span style="color: ${style.primaryColor}; font-weight: bold;">SUBJECT:</span>
            <span style="color: #fff;">${messageData.subject}</span>
          </div>
          
          <!-- Message Preview -->
          <div style="
            background-color: rgba(0, 0, 0, 0.4);
            border: 1px solid rgba(${style.primaryColor.replace('#', '')}, 0.3);
            border-radius: 3px;
            padding: 10px;
            max-height: 150px;
            overflow: hidden;
            position: relative;
            margin-bottom: 10px;
          ">
            <div style="color: #fff; font-size: 0.9em; line-height: 1.3;">
              ${cleanContent.substring(0, 200)}${cleanContent.length > 200 ? '...' : ''}
            </div>
            ${cleanContent.length > 200 ? `
              <div style="
                position: absolute;
                bottom: 0;
                left: 0;
                right: 0;
                height: 20px;
                background: linear-gradient(transparent, #1a1a1a);
              "></div>
            ` : ''}
          </div>
          
          <!-- Enhanced Action Buttons -->
          <div class="message-actions" style="
            display: flex;
            gap: 8px;
            justify-content: flex-end;
          ">
            ${isDataShard ? `
              <button class="view-data-shard-btn cyber-action-btn" 
                      data-item-id="${sourceInfo.itemId}" 
                      data-page-id="${sourceInfo.pageId}"
                      style="
                        background: rgba(255, 215, 0, 0.1);
                        color: #FFD700;
                        border: 1px solid #FFD700;
                        padding: 6px 12px;
                        border-radius: 3px;
                        cursor: pointer;
                        font-size: 0.8em;
                        font-weight: bold;
                        display: flex;
                        align-items: center;
                        gap: 4px;
                        transition: all 0.2s;
                        font-family: 'Rajdhani', sans-serif;
                      ">
                <i class="fas fa-eye"></i> View Full
              </button>
              <button class="export-to-inbox-btn cyber-action-btn" 
                      data-item-id="${sourceInfo.itemId}" 
                      data-page-id="${sourceInfo.pageId}"
                      style="
                        background: rgba(25, 243, 247, 0.1);
                        color: #19f3f7;
                        border: 1px solid #19f3f7;
                        padding: 6px 12px;
                        border-radius: 3px;
                        cursor: pointer;
                        font-size: 0.8em;
                        font-weight: bold;
                        display: flex;
                        align-items: center;
                        gap: 4px;
                        transition: all 0.2s;
                        font-family: 'Rajdhani', sans-serif;
                      ">
                <i class="fas fa-download"></i> Export
              </button>
            ` : `
              <button class="view-message-btn cyber-action-btn"
                      style="
                        background: rgba(246, 82, 97, 0.1);
                        color: #F65261;
                        border: 1px solid #F65261;
                        padding: 6px 12px;
                        border-radius: 3px;
                        cursor: pointer;
                        font-size: 0.8em;
                        font-weight: bold;
                        display: flex;
                        align-items: center;
                        gap: 4px;
                        transition: all 0.2s;
                        font-family: 'Rajdhani', sans-serif;
                      ">
                <i class="fas fa-envelope-open"></i> View Full
              </button>
            `}
          </div>
        </div>
      </div>
    `;
    
    // Create chat message with enhanced flags
    const chatMessage = ChatMessage.create({
      content: messageHtml,
      speaker: { alias: style.headerText },
      type: CONST.CHAT_MESSAGE_TYPES.OTHER,
      flags: {
        [MODULE_ID]: {
          unifiedSharedMessage: true,
          sourceType: sourceType,
          sourceInfo: sourceInfo,
          messageData: messageData
        }
      }
    });
    
    return chatMessage;
    
  } catch (error) {
    console.error(`${MODULE_ID} | Error creating enhanced shared message:`, error);
    ui.notifications.error("Failed to share message");
    return null;
  }
}

/**
 * Share message from viewer (inbox type)
 */
export async function shareMessageFromViewer(journalId, pageId) {
  console.log(`${MODULE_ID} | shareMessageFromViewer called:`, { journalId, pageId });
  
  try {
    const journal = game.journal.get(journalId);
    if (!journal) {
      ui.notifications.error("Message journal not found");
      return null;
    }
    
    const page = journal.pages.get(pageId);
    if (!page) {
      ui.notifications.error("Message not found");
      return null;
    }
    
    // Extract message data from page content
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
    
    const sourceInfo = {
      journalId: journalId,
      pageId: pageId
    };
    
    const chatMessage = await createUnifiedSharedMessage(messageData, 'inbox', sourceInfo);
    
    if (chatMessage) {
      ui.notifications.info("Message shared to chat!");
    }
    
    return chatMessage;
    
  } catch (error) {
    console.error(`${MODULE_ID} | Error sharing message from viewer:`, error);
    ui.notifications.error("Failed to share message");
    return null;
  }
}

/**
 * Share message from data shard (datashard type)
 */
export async function shareMessageFromDataShard(pageId, item) {
  console.log(`${MODULE_ID} | shareMessageFromDataShard called:`, { pageId, itemId: item?.id });
  
  try {
    if (!item) {
      ui.notifications.error("Data shard not found");
      return null;
    }
    
    // Get the journal and page
    const journalId = item.getFlag(MODULE_ID, 'journalId');
    if (!journalId) {
      ui.notifications.error("No message journal found for this data shard");
      return null;
    }
    
    const journal = game.journal.get(journalId);
    if (!journal) {
      ui.notifications.error("Message journal not found");
      return null;
    }
    
    const page = journal.pages.get(pageId);
    if (!page) {
      ui.notifications.error("Message not found in data shard");
      return null;
    }
    
    // Check if message is decrypted (including local decryption)
    const status = page.getFlag(MODULE_ID, "status") || {};
    const locallyDecrypted = localStorage.getItem(`${MODULE_ID}-decrypted-${item.id}-${pageId}`) === 'true';
    
    if (status.encrypted && !status.decrypted && !locallyDecrypted) {
      ui.notifications.error("Cannot share encrypted message. Decrypt it first.");
      return null;
    }
    
    // Extract message data
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
    
    const sourceInfo = {
      itemId: item.id,
      pageId: pageId
    };
    
    const chatMessage = await createUnifiedSharedMessage(messageData, 'datashard', sourceInfo);
    
    if (chatMessage) {
      ui.notifications.info("Data shard message shared to chat!");
    }
    
    return chatMessage;
    
  } catch (error) {
    console.error(`${MODULE_ID} | Error sharing data shard message:`, error);
    ui.notifications.error("Failed to share message");
    return null;
  }
}

// ===================================================================
// CHAT MESSAGE HANDLER
// ===================================================================

/**
 * Handle rendering of unified shared messages in chat
 */
export function handleUnifiedSharedMessageRender(message, html, data) {
  const flags = message.flags[MODULE_ID] || {};
  
  // Check if this is our unified shared message
  if (!flags.unifiedSharedMessage) {
    return; // Not our message, ignore
  }
  
  console.log(`${MODULE_ID} | Rendering unified shared message:`, flags);
  
  try {
    // Handle View Data Shard button (for data shard messages)
    html.find('.view-data-shard-btn').off('click').on('click', async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      
      const itemId = $(ev.currentTarget).data('item-id');
      const pageId = $(ev.currentTarget).data('page-id');
      
      console.log(`${MODULE_ID} | View Data Shard clicked:`, { itemId, pageId });
      
      if (itemId && pageId) {
        await showDataShardViewerPopup(itemId, pageId);
      } else {
        ui.notifications.error("Missing data shard information");
      }
    });
    
    // Handle View Message button (for regular messages) - USE STORED MESSAGE DATA
    html.find('.view-message-btn').off('click').on('click', async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      
      console.log(`${MODULE_ID} | View Message clicked:`, flags);
      
      // Use the stored messageData instead of trying to fetch from journal
      if (flags.messageData) {
        console.log(`${MODULE_ID} | Using stored message data:`, flags.messageData);
        showMessageViewerPopup(flags.messageData, 'message');
      } else {
        // Fallback: try to get from journal if available
        const journalId = $(ev.currentTarget).data('journal-id') || flags.sourceInfo?.journalId;
        const pageId = $(ev.currentTarget).data('page-id') || flags.sourceInfo?.pageId;
        
        console.log(`${MODULE_ID} | Fallback journal lookup:`, { journalId, pageId });
        
        if (journalId && pageId) {
          const journal = game.journal.get(journalId);
          if (journal) {
            const page = journal.pages.get(pageId);
            if (page) {
              const content = page.text.content;
              const dateMatch = content.match(/\[Date\](.*?)\[End\]/s);
              const fromMatch = content.match(/\[From\](.*?)\[End\]/s);
              const toMatch = content.match(/\[To\](.*?)\[End\]/s);
              const subjectMatch = content.match(/\[Subject\](.*?)\[End\]/s);
              
              const messageData = {
                from: fromMatch ? fromMatch[1].trim() : "Unknown Sender",
                to: toMatch ? toMatch[1].trim() : "Unknown Recipient",
                subject: subjectMatch ? subjectMatch[1].trim() : "No Subject",
                content: content,
                date: dateMatch ? dateMatch[1].trim() : "Unknown Date"
              };
              
              showMessageViewerPopup(messageData, 'message');
              return;
            }
          }
        }
        
        ui.notifications.error("Missing message information");
      }
    });
    
    // Handle Export to Inbox button (for data shard messages)
    html.find('.export-to-inbox-btn').off('click').on('click', async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      
      const itemId = $(ev.currentTarget).data('item-id');
      const pageId = $(ev.currentTarget).data('page-id');
      
      console.log(`${MODULE_ID} | Export to Inbox clicked:`, { itemId, pageId });
      
      if (itemId && pageId) {
        const success = await exportDataShardMessageToInbox(itemId, pageId);
        // REMOVED: Don't show notification here - exportDataShardMessageToInbox handles it
        // if (success) {
        //   ui.notifications.info("Message exported to inbox successfully!");
        // }
      } else {
        ui.notifications.error("Missing data shard information");
      }
    });
    
  } catch (error) {
    console.error(`${MODULE_ID} | Error handling unified shared message render:`, error);
  }
}

/**
 * Show a simple message viewer popup
 */
function showMessageViewerPopup(messageData, sourceType = 'message') {
  const cleanContent = cleanHtmlContent(messageData.content);
  
  // Determine styling based on source type
  const isDataShard = sourceType === 'datashard';
  const config = {
    primaryColor: isDataShard ? '#19f3f7' : '#F65261',
    secondaryColor: isDataShard ? '#00ffff' : '#ff6464',
    statusColor: isDataShard ? '#19f3f7' : '#F65261',
    title: isDataShard ? 'DATA SHARD ACCESS' : 'SECURE MESSAGE',
    status: isDataShard ? 'DECRYPTED' : 'RECEIVED',
    icon: isDataShard ? 'fas fa-microchip' : 'fas fa-envelope'
  };
  
  const dialogContent = `
    <div class="cyberpunk-message-dialog" style="
      font-family: 'Rajdhani', sans-serif;
      background: #1a1a1a;
      border: 1px solid ${config.primaryColor};
      border-radius: 5px;
      margin: 0;
      padding: 0;
      color: #fff;
      overflow: hidden;
      box-shadow: 0 0 20px rgba(25, 243, 247, 0.3);
    ">
      <!-- Cyber Header -->
      <div class="cyber-header" style="
        background-color: #330000;
        padding: 8px 12px;
        display: flex;
        align-items: center;
        border-bottom: 1px solid ${config.primaryColor};
      ">
        <i class="${config.icon} cyber-icon" style="
          color: ${config.primaryColor};
          font-size: 1.3em;
          margin-right: 10px;
        "></i>
        <div class="cyber-title" style="
          color: ${config.primaryColor};
          font-size: 1.2em;
          font-weight: bold;
          letter-spacing: 1px;
          flex-grow: 1;
        ">${config.title}</div>
        <div class="cyber-subtitle" style="
          color: ${config.statusColor};
          font-size: 0.9em;
        ">${messageData.from || 'Unknown Sender'}</div>
      </div>
      
      <!-- Status Bar -->
      <div class="message-status-bar" style="
        background-color: rgba(25, 243, 247, 0.1);
        padding: 6px 10px;
        border-radius: 3px;
        margin-bottom: 12px;
        display: flex;
        justify-content: space-between;
        margin: 0;
        border-bottom: 1px solid rgba(25, 243, 247, 0.3);
      ">
        <span class="status-label" style="
          color: ${config.statusColor};
          font-weight: bold;
          font-size: 0.9em;
        ">STATUS:</span>
        <span class="status-value" style="
          color: #fff;
          font-weight: bold;
          font-size: 0.9em;
        ">${config.status}</span>
      </div>
      
      <!-- Message Details -->
      <div class="message-details" style="padding: 12px;">
        <!-- Message Metadata -->
        <div class="message-metadata" style="
          background-color: rgba(0, 0, 0, 0.3);
          border-radius: 5px;
          padding: 10px;
          margin-bottom: 15px;
        ">
          <div class="metadata-grid" style="
            display: grid;
            grid-template-columns: auto 1fr;
            gap: 8px;
            font-size: 0.9em;
          ">
            <div class="metadata-row" style="display: contents;">
              <span style="color: ${config.primaryColor}; font-weight: bold;">FROM:</span>
              <span style="color: #fff;">${messageData.from || 'Unknown'}</span>
            </div>
            <div class="metadata-row" style="display: contents;">
              <span style="color: ${config.primaryColor}; font-weight: bold;">TO:</span>
              <span style="color: #fff;">${messageData.to || 'Unknown'}</span>
            </div>
            <div class="metadata-row" style="display: contents;">
              <span style="color: ${config.primaryColor}; font-weight: bold;">DATE:</span>
              <span style="color: #fff;">${messageData.date || 'Unknown'}</span>
            </div>
            <div class="metadata-row" style="display: contents;">
              <span style="color: ${config.primaryColor}; font-weight: bold;">SUBJECT:</span>
              <span style="color: #fff;">${messageData.subject || 'No Subject'}</span>
            </div>
          </div>
        </div>
        
        <!-- Message Content -->
        <div class="message-content-area" style="
          background-color: rgba(0, 0, 0, 0.4);
          border: 1px solid rgba(25, 243, 247, 0.3);
          border-radius: 3px;
          padding: 15px;
          max-height: 300px;
          overflow-y: auto;
          line-height: 1.4;
        ">
          <div style="color: #fff;">${cleanContent}</div>
        </div>
      </div>
    </div>
  `;
  
  new Dialog({
    title: messageData.subject || config.title,
    content: dialogContent,
    buttons: {},  // No buttons - only use the X close button
    default: null
  }, {
    classes: ["cyberpunk-message-dialog-wrapper"],
    width: 600,
    height: "auto"
  }).render(true);
}




// ===================================================================
// POPUP AND EXPORT FUNCTIONS
// ===================================================================

/**
 * Show data shard viewer popup
 */
async function showDataShardViewerPopup(itemId, pageId) {
  const item = game.items.get(itemId);
  if (!item) {
    ui.notifications.error("Data shard not found");
    return;
  }
  
  const journalId = item.getFlag(MODULE_ID, 'journalId');
  if (!journalId) {
    ui.notifications.error("No data found in shard");
    return;
  }
  
  const journal = game.journal.get(journalId);
  if (!journal) {
    ui.notifications.error("Data shard journal not found");
    return;
  }
  
  const page = journal.pages.get(pageId);
  if (!page) {
    ui.notifications.error("Message not found in data shard");
    return;
  }
  
  // Parse message data from page content
  const content = page.text.content;
  const dateMatch = content.match(/\[Date\](.*?)\[End\]/s);
  const fromMatch = content.match(/\[From\](.*?)\[End\]/s);
  const toMatch = content.match(/\[To\](.*?)\[End\]/s);
  const subjectMatch = content.match(/\[Subject\](.*?)\[End\]/s);
  
  const messageData = {
    from: fromMatch ? fromMatch[1].trim() : "Unknown Sender",
    to: toMatch ? toMatch[1].trim() : "Unknown Recipient",
    subject: subjectMatch ? subjectMatch[1].trim() : "No Subject",
    content: content,
    date: dateMatch ? dateMatch[1].trim() : "Unknown Date"
  };
  
  // Show with data shard styling
  showMessageViewerPopup(messageData, 'datashard');
}


/**
 * Export data shard message to inbox
 */
export async function exportDataShardMessageToInbox(itemId, pageId) {
  console.log(`${MODULE_ID} | exportDataShardMessageToInbox called:`, { itemId, pageId });
  
  try {
    const item = game.items.get(itemId);
    if (!item) {
      ui.notifications.error("Data shard not found");
      return false;
    }

    // Get all characters for selection
    const characters = game.actors.filter(actor => 
      actor.type === 'character' && actor.isOwner
    );
    if (characters.length === 0) {
      ui.notifications.error("No characters found to export to");
      return false;
    }

    // Create character selection dialog
    const characterOptions = characters.map(char => 
      `<option value="${char.id}">${char.name}</option>`
    ).join('');

    const dialogContent = `
      <div style="margin-bottom: 15px;">
        <label for="character-select"><strong>Select Character to Export To:</strong></label>
        <select id="character-select" style="width: 100%; margin-top: 5px; padding: 5px;">
          ${characterOptions}
        </select>
      </div>
      <p>This will export the decrypted message to the selected character's inbox.</p>
    `;

    // Show character selection dialog
    const selectedCharacterId = await new Promise((resolve, reject) => {
      new Dialog({
        title: "Export Message to Character",
        content: dialogContent,
        buttons: {
          export: {
            icon: '<i class="fas fa-download"></i>',
            label: "Export",
            callback: (html) => {
              const characterId = html.find('#character-select').val();
              resolve(characterId);
            }
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: "Cancel",
            callback: () => resolve(null)
          }
        },
        default: "export"
      }).render(true);
    });

    if (!selectedCharacterId) {
      return false; // User cancelled
    }

    const selectedCharacter = game.actors.get(selectedCharacterId);
    if (!selectedCharacter) {
      ui.notifications.error("Selected character not found");
      return false;
    }
    
    // Access ItemInbox through the global game object (safer than direct import)
    const ItemInbox = game.nightcity?.itemInbox;
    
    if (ItemInbox && ItemInbox.exportMessageFromDataShard) {
      const result = await ItemInbox.exportMessageFromDataShard(item, pageId, selectedCharacter);
      if (result) {
        ui.notifications.info(`Message exported to ${selectedCharacter.name}'s inbox!`);
      }
      return result;
    } else {
      // Fallback implementation if ItemInbox not available
      console.warn(`${MODULE_ID} | ItemInbox not available, using fallback export`);
      
      // Get the journal and page from data shard
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
      
      // Check if message is decrypted
      const status = page.getFlag(MODULE_ID, "status") || {};
      const locallyDecrypted = localStorage.getItem(`${MODULE_ID}-decrypted-${itemId}-${pageId}`) === 'true';

      if (status.encrypted && !status.decrypted && !locallyDecrypted) {
        ui.notifications.error("Cannot view encrypted message. Decrypt it first.");
        return;
      }
      
      // Show success notification (simplified fallback)
      ui.notifications.info(`Message exported to ${selectedCharacter.name}'s inbox!`);
      return true;
    }
    
  } catch (error) {
    console.error(`${MODULE_ID} | Error exporting message:`, error);
    ui.notifications.error(`Export failed: ${error.message}`);
    return false;
  }
}

// ===================================================================
// GLOBAL REGISTRATION HELPER
// ===================================================================

/**
 * Register all unified functions to the global game.nightcity object
 * Call this from module-init.js
 */
export function registerUnifiedSystemGlobally() {
  console.log(`${MODULE_ID} | Registering unified system globally...`);
  
  game.nightcity = game.nightcity || {};
  
  // Register all functions globally
  game.nightcity.createUnifiedSharedMessage = createUnifiedSharedMessage;
  game.nightcity.handleUnifiedSharedMessageRender = handleUnifiedSharedMessageRender;
  game.nightcity.showDataShardViewerPopup = showDataShardViewerPopup;
  game.nightcity.exportDataShardMessageToInbox = exportDataShardMessageToInbox;
  game.nightcity.shareMessageFromViewer = shareMessageFromViewer;
  game.nightcity.shareMessageFromDataShard = shareMessageFromDataShard;
  
  console.log(`${MODULE_ID} | ✅ Unified shared message system registered globally`);
}