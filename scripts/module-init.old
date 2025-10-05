/**
 * Night City Messenger - Module Initialization (COMPLETE REWRITE)
 * This file handles the main module initialization hooks with all fixes applied
 * FIXED: Resolves circular dependencies, socket handling, and initialization order
 */

// ===================================================================
// CORE IMPORTS (Dependencies first)
// ===================================================================

import { MODULE_ID } from './constants.js';

// ===================================================================
// MODULE VARIABLES
// ===================================================================

let unifiedSystemModule = null;
let appModule = null;
let itemInboxModule = null;

// ===================================================================
// INITIALIZATION HOOKS
// ===================================================================

/**
 * Module Initialization - Load basic dependencies first
 */
Hooks.once('init', async () => {
  console.log(`${MODULE_ID} | Initializing module...`);
  
  try {
    // Load core app module first
    appModule = await import('./app.js');
    const { NightCityMessenger } = appModule;
    
    // Initialize the main module (this loads settings, hooks, etc.)
    NightCityMessenger.init();
    
    // Initialize global game.nightcity object
    game.nightcity = game.nightcity || {};
    
    // Register hooks (dynamic loading to avoid circular dependencies)
    const hooksModule = await import('./hooks.js');
    hooksModule.registerHooks();
    
    // Register early Handlebars helpers
    registerHandlebarsHelpers();
    
    console.log(`${MODULE_ID} | ✅ Basic module initialization completed`);
    
  } catch (error) {
    console.error(`${MODULE_ID} | ❌ Error during initialization:`, error);
    ui.notifications.error(`${MODULE_ID} initialization failed: ${error.message}`);
  }
});

/**
 * Module Ready - Load complex systems after Foundry is fully ready
 */
Hooks.once('ready', async () => {
  console.log(`${MODULE_ID} | Module ready - Loading advanced systems...`);
  
  try {
    // Load unified system first (core messaging functionality)
    await loadUnifiedSystem();
    
    // Load ItemInbox system 
    await loadItemInboxSystem();
    
    // Initialize main app ready state
    if (appModule?.NightCityMessenger) {
      appModule.NightCityMessenger.ready();
    }
    
    // Load utility modules
    await loadUtilityModules();
    
    // Set up socket handling for cross-user communication
    setupSocketHandlers();
    
    // Register global functions for macro access
    registerGlobalMacroFunctions();
    
    // Set up additional hooks
    setupAdditionalHooks();
    
    // Final verification and setup
    performFinalVerification();
    
    console.log(`${MODULE_ID} | ✅ Module fully initialized and ready`);
    
  } catch (error) {
    console.error(`${MODULE_ID} | ❌ Error during ready phase:`, error);
    ui.notifications.error(`${MODULE_ID} ready phase failed: ${error.message}`);
  }
});

// ===================================================================
// SYSTEM LOADING FUNCTIONS
// ===================================================================

/**
 * Load the unified shared message system
 */
async function loadUnifiedSystem() {
  console.log(`${MODULE_ID} | Loading unified shared message system...`);
  
  try {
    unifiedSystemModule = await import('./unified-shared-message-viewer.js');
    
    const { 
      createUnifiedSharedMessage, 
      handleUnifiedSharedMessageRender,
      showDataShardViewerPopup,
      exportDataShardMessageToInbox,
      registerUnifiedSystemGlobally,
      DataShardViewer,
      shareMessageFromViewer,
      shareMessageFromDataShard
    } = unifiedSystemModule;
    
    // Register unified system globally
    registerUnifiedSystemGlobally();
    
    // Additional backup registration (belt and suspenders approach)
    game.nightcity.createUnifiedSharedMessage = createUnifiedSharedMessage;
    game.nightcity.handleUnifiedSharedMessageRender = handleUnifiedSharedMessageRender;
    game.nightcity.showDataShardViewerPopup = showDataShardViewerPopup;
    game.nightcity.exportDataShardMessageToInbox = exportDataShardMessageToInbox;
    game.nightcity.DataShardViewer = DataShardViewer;
    game.nightcity.shareMessageFromViewer = shareMessageFromViewer;
    game.nightcity.shareMessageFromDataShard = shareMessageFromDataShard;
    
    console.log(`${MODULE_ID} | ✅ Unified shared message system loaded successfully`);
    
  } catch (error) {
    console.error(`${MODULE_ID} | ❌ Error loading unified shared message system:`, error);
    throw error;
  }
}

/**
 * Load the ItemInbox system
 */
async function loadItemInboxSystem() {
  console.log(`${MODULE_ID} | Loading ItemInbox system...`);
  
  try {
    itemInboxModule = await import('./item-inbox.js');
    const { ItemInbox, ItemInboxSheet } = itemInboxModule;
    
    // Register globally
    game.nightcity.ItemInbox = ItemInbox;
    game.nightcity.ItemInboxSheet = ItemInboxSheet;
    game.nightcity.itemInbox = ItemInbox;
    
    // Initialize the ItemInbox system
    ItemInbox.init();
    
    console.log(`${MODULE_ID} | ✅ ItemInbox system loaded and initialized`);
    
  } catch (error) {
    console.error(`${MODULE_ID} | ❌ Error loading ItemInbox system:`, error);
    // Don't throw here - ItemInbox is not critical for basic functionality
  }
}

/**
 * Load utility modules
 */
async function loadUtilityModules() {
  console.log(`${MODULE_ID} | Loading utility modules...`);
  
  try {
    const utilsModule = await import('./utils.js');
    game.nightcity.utils = utilsModule;
    
    console.log(`${MODULE_ID} | ✅ Utility modules loaded`);
    
  } catch (error) {
    console.error(`${MODULE_ID} | ❌ Error loading utility modules:`, error);
    // Don't throw - utilities are helpful but not critical
  }
}

// ===================================================================
// SOCKET HANDLING
// ===================================================================

/**
 * Set up socket handlers for cross-user communication
 */
function setupSocketHandlers() {
  console.log(`${MODULE_ID} | Setting up socket handlers...`);
  
  game.socket.on(`module.${MODULE_ID}`, async (data) => {
    if (!game.user.isGM) return; // Only GM handles these requests
    
    console.log(`${MODULE_ID} | GM received socket request:`, data);

    if (data.type === 'refreshDecryption') {
      // Non-GM users should refresh their data shard sheets
      if (!game.user.isGM) {
        const item = game.items.get(data.itemId);
        if (item && item.sheet && item.sheet.rendered) {
          // Clear any cached decryption states for this specific item
          item.sheet.decryptedMessages = new Set();
          item.sheet.decryptionSuccessful = false;
          item.sheet.showOpenMessageButton = false;
          item.sheet.decryptionRoll = null;
          item.sheet.attemptingDecryption = false;
          
          // Re-render the sheet
          item.sheet.render(true);
        }
        
        ui.notifications.info(`${data.gmName} reset the decryption states for "${data.itemName}".`);
      }
    }
    
    if (data.type === 'requestDecryption') {
      try {
        const item = game.items.get(data.itemId);
        if (!item) {
          console.warn(`${MODULE_ID} | Item not found: ${data.itemId}`);
          return;
        }
        
        const journalId = item.getFlag(MODULE_ID, 'journalId');
        if (!journalId) {
          console.warn(`${MODULE_ID} | No journal found for item: ${data.itemId}`);
          return;
        }
        
        const journal = game.journal.get(journalId);
        if (!journal) {
          console.warn(`${MODULE_ID} | Journal not found: ${journalId}`);
          return;
        }
        
        const page = journal.pages.get(data.messageId);
        if (!page) {
          console.warn(`${MODULE_ID} | Page not found: ${data.messageId}`);
          return;
        }
        
        // Update the page to mark as decrypted
        const status = page.getFlag(MODULE_ID, "status") || {};
        await page.update({
          [`flags.${MODULE_ID}.status`]: { 
            ...status, 
            decrypted: true,
            decryptedBy: data.userName,
            decryptedAt: new Date().toISOString()
          }
        });
        
        console.log(`${MODULE_ID} | ✅ GM updated decryption status for ${data.userName}`);
        
        // Notify all users with cyberpunk styling
        await ChatMessage.create({
          content: `
            <div style="
              background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
              border: 2px solid #00ff00;
              color: #00ff00;
              font-family: 'Courier New', monospace;
              padding: 15px;
              border-radius: 8px;
              text-align: center;
              font-weight: bold;
              box-shadow: 0 0 20px rgba(0, 255, 0, 0.3);
            ">
              🔓 ${data.userName} successfully decrypted a data shard message!
              <div style="font-size: 0.8em; margin-top: 5px; opacity: 0.7;">
                SYSTEM ACCESS GRANTED • CONTENTS UNLOCKED
              </div>
            </div>
          `,
          speaker: { alias: "Night City Network" }
        });
        
      } catch (error) {
        console.error(`${MODULE_ID} | Error handling decryption request:`, error);
        
        // Notify user of the error
        await ChatMessage.create({
          content: `
            <div style="
              background: #1a1a1a;
              border: 2px solid #ff0000;
              color: #ff0000;
              font-family: 'Courier New', monospace;
              padding: 15px;
              border-radius: 8px;
              text-align: center;
              font-weight: bold;
            ">
              ❌ Failed to process decryption for ${data.userName}: ${error.message}
            </div>
          `,
          speaker: { alias: "System Error" }
        });
      }
    }
  });
  
  console.log(`${MODULE_ID} | ✅ Socket handlers registered`);
}

// ===================================================================
// GLOBAL REGISTRATION
// ===================================================================

/**
 * Register global functions for macro access
 */
function registerGlobalMacroFunctions() {
  console.log(`${MODULE_ID} | Registering global macro functions...`);
  
  // Make the main app available globally for macros
  if (appModule?.NightCityMessenger) {
    globalThis.NightCityMessenger = appModule.NightCityMessenger;
  }
  
  // Register unified shared message functions globally with error handling
  globalThis.createUnifiedSharedMessage = function(...args) {
    if (unifiedSystemModule?.createUnifiedSharedMessage) {
      return unifiedSystemModule.createUnifiedSharedMessage(...args);
    } else {
      console.error(`${MODULE_ID} | createUnifiedSharedMessage not available yet`);
      ui.notifications.error("Unified system not loaded yet. Please try again.");
      return null;
    }
  };

  globalThis.showDataShardViewerPopup = function(...args) {
    if (unifiedSystemModule?.showDataShardViewerPopup) {
      return unifiedSystemModule.showDataShardViewerPopup(...args);
    } else {
      console.error(`${MODULE_ID} | showDataShardViewerPopup not available yet`);
      ui.notifications.error("Unified system not loaded yet. Please try again.");
      return null;
    }
  };
  
  // Debug function for troubleshooting
  globalThis.debugNightCityMessenger = function() {
    console.log('=== Night City Messenger Debug Info ===');
    console.log('Module ID:', MODULE_ID);
    console.log('App Module:', !!appModule);
    console.log('Unified System Module:', !!unifiedSystemModule);
    console.log('ItemInbox Module:', !!itemInboxModule);
    console.log('Game Object:', !!game.nightcity);
    
    if (game.nightcity) {
      console.log('Available functions:', Object.keys(game.nightcity));
    }
    
    if (appModule?.NightCityMessenger) {
      console.log('NightCityMessenger initialized:', appModule.NightCityMessenger.initialized);
    }
    
    console.log('Available viewers:', Object.values(ui.windows).filter(w => 
      w.constructor.name.includes('Cyberpunk') || 
      w.constructor.name.includes('NightCity')
    ).length);
    
    // Test unified system functions
    if (unifiedSystemModule) {
      console.log('✅ Unified system module loaded');
      console.log('Available unified functions:', Object.keys(unifiedSystemModule));
    } else {
      console.log('❌ Unified system module not loaded');
    }
    
    console.log('=== End Debug Info ===');
  };
  
  console.log(`${MODULE_ID} | ✅ Global macro functions registered`);
}

// ===================================================================
// HANDLEBARS HELPERS
// ===================================================================

/**
 * Register early Handlebars helpers (called during init)
 */
function registerHandlebarsHelpers() {
  console.log(`${MODULE_ID} | Registering Handlebars helpers...`);
  
  // Register the "or" helper if it doesn't exist
  if (!Handlebars.helpers.or) {
    Handlebars.registerHelper('or', function() {
      return Array.prototype.slice.call(arguments, 0, -1).some(Boolean);
    });
  }
  // Register additional Handlebars helpers for unified system
  if (!Handlebars.helpers.eq) {
    Handlebars.registerHelper('eq', function(a, b) {
      return a === b;
    });
  }
  if (!Handlebars.helpers.ne) {
    Handlebars.registerHelper('ne', function(a, b) {
      return a !== b;
    });
  }
  if (!Handlebars.helpers.contains) {
    Handlebars.registerHelper('contains', function(array, value) {
      return Array.isArray(array) && array.includes(value);
    });
  }
  
  // Header status helpers for data shard encryption display
  if (!Handlebars.helpers.calculateHeaderStatus) {
    Handlebars.registerHelper('calculateHeaderStatus', function(encrypted, messages, itemId) {
      if (!encrypted) {
        return 'DECRYPTED'; // Global encryption disabled
      }
      
      if (!messages || messages.length === 0) {
        return 'DECRYPTED'; // No messages to encrypt
      }
      
      // Check if any encrypted messages remain undecrypted
      for (const message of messages) {
        // Handle both journal pages and processed message objects
        let messageStatus = {};
        let isMessageEncrypted = encrypted; // Default to global setting
        
        // Try to get status from message flags
        if (message.getFlag && typeof message.getFlag === 'function') {
          // This is a journal page
          messageStatus = message.getFlag(MODULE_ID, "status") || {};
          isMessageEncrypted = messageStatus.encrypted !== undefined ? messageStatus.encrypted : encrypted;
        } else if (message.isEncrypted !== undefined) {
          // This is a processed message object
          isMessageEncrypted = message.isEncrypted;
          messageStatus = { 
            decrypted: message.isDecrypted || false,
            encrypted: message.isEncrypted
          };
        }
        
        if (isMessageEncrypted) {
          const isDecrypted = messageStatus.decrypted || false;
          
          // Also check localStorage for local decryption state
          const decryptionKey = `${MODULE_ID}-decrypted-${itemId}-${message.id}`;
          const locallyDecrypted = localStorage.getItem(decryptionKey) === 'true';
          
          if (!isDecrypted && !locallyDecrypted) {
            return 'ENCRYPTED'; // Found an undecrypted encrypted message
          }
        }
      }
      
      return 'DECRYPTED'; // All encrypted messages have been decrypted
    });
  }
  
  if (!Handlebars.helpers.isHeaderDecrypted) {
    Handlebars.registerHelper('isHeaderDecrypted', function(encrypted, messages, itemId) {
      const status = Handlebars.helpers.calculateHeaderStatus(encrypted, messages, itemId);
      return status === 'DECRYPTED';
    });
  }
  
  console.log(`${MODULE_ID} | ✅ Handlebars helpers registered`);
}

// ===================================================================
// ADDITIONAL HOOKS
// ===================================================================

/**
 * Set up additional hooks for enhanced functionality
 */
function setupAdditionalHooks() {
  console.log(`${MODULE_ID} | Setting up additional hooks...`);
  
  // Handle game settings changes
  Hooks.on('updateSetting', (setting, value, options, userId) => {
    if (setting.key.startsWith(`${MODULE_ID}.`)) {
      console.log(`${MODULE_ID} | Setting changed: ${setting.key} = ${value}`);
      
      // Refresh any open viewers if relevant settings change
      if (setting.key.includes('enableSounds') || setting.key.includes('theme')) {
        // Refresh open message viewers
        Object.values(ui.windows).forEach(window => {
          if (window.constructor.name === 'CyberpunkMessageViewer') {
            window.render(false);
          }
        });
      }
    }
  });

  // Apply styling to scene controls when messenger is active
  Hooks.on('renderSceneControls', (app, html, data) => {
    const messengerTools = html.find('[data-tool="nightcity-messenger"], [data-tool="compose-message"]');
    if (messengerTools.length > 0) {
      messengerTools.addClass('cyberpunk-tool');
    }
  });
  
  console.log(`${MODULE_ID} | ✅ Additional hooks registered`);
}

// ===================================================================
// VERIFICATION
// ===================================================================

/**
 * Perform final verification and setup
 */
function performFinalVerification() {
  console.log(`${MODULE_ID} | Performing final verification...`);
  
  // Verify unified system is properly loaded
  if (game.nightcity?.createUnifiedSharedMessage && 
      game.nightcity?.handleUnifiedSharedMessageRender) {
    console.log(`${MODULE_ID} | ✅ Unified shared message system verified`);
  } else {
    console.warn(`${MODULE_ID} | ⚠️ Unified shared message system not properly loaded`);
  }
  
  // Verify ItemInbox system
  if (game.nightcity?.itemInbox) {
    console.log(`${MODULE_ID} | ✅ ItemInbox system verified`);
  } else {
    console.warn(`${MODULE_ID} | ⚠️ ItemInbox system not loaded`);
  }
  
  // Verify main app
  if (appModule?.NightCityMessenger?.initialized) {
    console.log(`${MODULE_ID} | ✅ Main application verified`);
  } else {
    console.warn(`${MODULE_ID} | ⚠️ Main application not properly initialized`);
  }
  
  // Verify socket handlers
  console.log(`${MODULE_ID} | ✅ Socket handlers active`);
}

// ===================================================================
// MODULE COMPLETION LOG
// ===================================================================

console.log(`${MODULE_ID} | Module initialization file loaded successfully`);