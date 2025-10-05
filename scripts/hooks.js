/**
 * Foundry VTT hooks for the Night City Messenger module
 * FIXED: Updated to avoid circular dependencies and use proper dynamic imports
 */

// ===================================================================
// IMPORTS
// ===================================================================

import { MODULE_ID, AUDIO } from './constants.js';
import { getSetting } from './settings.js';
import { 
  showNotification, 
  extractMessageMetadata, 
  extractSenderName, 
  getCurrentDateTime,
  cleanHtmlContent 
} from './utils.js';

// ===================================================================
// DYNAMIC MODULE REFERENCES
// ===================================================================

// Use dynamic loading to avoid circular dependencies
let unifiedMessageModule = null;
let appModule = null;
let viewerModule = null;
let composerModule = null;

// ===================================================================
// MAIN HOOKS REGISTRATION
// ===================================================================

/**
 * Register all necessary Foundry VTT hooks
 * FIXED: Load modules dynamically to avoid circular dependencies
 */
export function registerHooks() {
  console.log(`${MODULE_ID} | Registering hooks...`);
  
  // Hook for new journal entry pages (messages) being created
  Hooks.on('createJournalEntryPage', (page, options, userId) => {
    _handleNewMessage(page, options, userId);
  });
  
  // FIXED: Use dynamic import for unified shared message handler
  Hooks.on('renderChatMessage', async (message, html, data) => {
    // Load unified message module if not already loaded
    if (!unifiedMessageModule) {
      try {
        unifiedMessageModule = await import('./unified-shared-message-viewer.js');
      } catch (error) {
        console.error(`${MODULE_ID} | Error loading unified message module:`, error);
        return;
      }
    }
    
    // Call the unified handler
    if (unifiedMessageModule.handleUnifiedSharedMessageRender) {
      unifiedMessageModule.handleUnifiedSharedMessageRender(message, html, data);
    }
  });
  
  // Hook for actor creation (to auto-generate email addresses)
  Hooks.on('createActor', (actor, options, userId) => {
    _handleActorCreated(actor, options, userId);
  });
  
  // Hook for user updates (character assignment changes)
  Hooks.on('updateUser', (user, updateData, options, userId) => {
    _handleUserUpdate(user, updateData, options, userId);
  });
  
  // Hook for SimpleCalendar date changes (if available)
  Hooks.on('updateWorldTime', (worldTime, dt) => {
    _handleDateChange({ worldTime, dt });
  });
  
  // Hook for SimpleCalendar specific events (if available)
  Hooks.on('simple-calendar-date-time-change', (data) => {
    _handleDateChange(data);
  });
  
  console.log(`${MODULE_ID} | ✅ Hooks registered successfully`);
}

// ===================================================================
// HOOK HANDLERS
// ===================================================================

/**
 * Handle new message creation
 * @private
 */
function _handleNewMessage(page, options, userId) {
  try {
    // Only handle messages with our module's flags
    const flags = page.flags[MODULE_ID];
    if (!flags || (!flags.isMessage && !flags.isSpam)) {
      return;
    }
    
    console.log(`${MODULE_ID} | New message created:`, {
      pageId: page.id,
      pageName: page.name,
      userId: userId,
      flags: flags
    });
    
    // Extract metadata for notifications
    const metadata = extractMessageMetadata(page.text.content);
    const senderName = extractSenderName(metadata.from);
    
    // Show notification to relevant users
    if (flags.isMessage && getSetting('enableNotifications')) {
      // Only show to the recipient if it's a real message
      const recipientUsers = _getRecipientsForMessage(metadata.to);
      
      recipientUsers.forEach(user => {
        if (user.id !== userId && user.active) { // Don't notify the sender
          showNotification(
            `New message from ${senderName}`,
            `Subject: ${metadata.subject || 'No Subject'}`,
            user.id
          );
        }
      });
    }
    
    // Play sound if enabled
    if (getSetting('enableSounds') && userId !== game.user.id) {
      AudioHelper.play({ src: AUDIO.newMessage, volume: 0.5, autoplay: true, loop: false }, false);
    }
    
  } catch (error) {
    console.error(`${MODULE_ID} | Error handling new message:`, error);
  }
}

/**
 * Handle actor creation for auto-generating email addresses
 * @private
 */
function _handleActorCreated(actor, options, userId) {
  // Only auto-generate emails for character-type actors
  if (actor.type !== 'character') {
    return;
  }
  
  // Check if actor already has an email
  const existingEmail = actor.getFlag(MODULE_ID, 'emailAddress');
  if (existingEmail) {
    return;
  }
  
  // Generate email based on actor name
  if (actor.name && actor.name.trim()) {
    const domain = getSetting('defaultDomain') || 'nightcity.net';
    const cleanName = actor.name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .substring(0, 20); // Limit length
    
    const email = `${cleanName}@${domain}`;
    
    // Store email in actor flags
    actor.setFlag(MODULE_ID, 'emailAddress', email).then(() => {
      console.log(`${MODULE_ID} | Auto-generated email for ${actor.name}: ${email}`);
    }).catch(err => {
      console.error(`${MODULE_ID} | Error setting email for ${actor.name}:`, err);
    });
  }
}

/**
 * Handle user character assignment changes
 * @private
 */
function _handleUserUpdate(user, updateData, options, userId) {
  // Check if character assignment changed
  if ('character' in updateData) {
    console.log(`${MODULE_ID} | User character assignment changed:`, {
      userId: user.id,
      userName: user.name,
      characterId: updateData.character
    });
    
    // Refresh any open message viewers for this user
    if (userId === game.user.id) {
      Object.values(ui.windows).forEach(window => {
        if (window.constructor.name === 'CyberpunkMessageViewer') {
          window.render(false);
        }
      });
    }
  }
}

/**
 * Handle SimpleCalendar date changes
 * @private
 */
async function _handleDateChange(data) {
  console.log(`${MODULE_ID} | Date changed, checking for scheduled events...`);
  
  // Load app module if needed
  if (!appModule) {
    try {
      appModule = await import('./app.js');
    } catch (error) {
      console.warn(`${MODULE_ID} | Could not load app module for date change:`, error);
      return;
    }
  }
  
  // Check for scheduled messages if GM
  if (game.user.isGM && appModule.NightCityMessenger?.checkScheduledMessages) {
    appModule.NightCityMessenger.checkScheduledMessages();
  }
  
  // Generate spam messages if enabled and appropriate interval has passed
  if (game.user.isGM && getSetting('enableAutoSpam')) {
    const spamInterval = getSetting('spamInterval') || 24; // hours
    const lastSpamTime = game.settings.get(MODULE_ID, 'lastSpamTime') || 0;
    const currentTime = Date.now();
    
    if (currentTime - lastSpamTime >= (spamInterval * 60 * 60 * 1000)) {
      // Time to generate spam
      if (appModule.NightCityMessenger?.generateSpam) {
        appModule.NightCityMessenger.generateSpam();
        game.settings.set(MODULE_ID, 'lastSpamTime', currentTime);
      }
    }
  }
}

// ===================================================================
// HELPER FUNCTIONS
// ===================================================================

/**
 * Get recipient users for a message
 * @private
 */
function _getRecipientsForMessage(toField) {
  const recipients = [];
  
  if (!toField) {
    return recipients;
  }
  
  // Check if it's an email address
  if (toField.includes('@')) {
    // Find actors with this email
    const actorsWithEmail = game.actors.filter(actor => 
      actor.getFlag(MODULE_ID, 'emailAddress') === toField
    );
    
    // Find users assigned to those actors
    actorsWithEmail.forEach(actor => {
      const user = game.users.find(u => u.character?.id === actor.id);
      if (user) {
        recipients.push(user);
      }
    });
  } else {
    // Try to find by character name
    const actor = game.actors.find(a => a.name === toField);
    if (actor) {
      const user = game.users.find(u => u.character?.id === actor.id);
      if (user) {
        recipients.push(user);
      }
    }
  }
  
  return recipients;
}

/**
 * Check if spam generation should occur
 * @private
 */
function _shouldGenerateSpam() {
  if (!game.user.isGM) return false;
  if (!getSetting('enableAutoSpam')) return false;
  
  const spamChance = getSetting('spamChance') || 0.3;
  return Math.random() < spamChance;
}

/**
 * Generate a spam message
 * @private
 */
async function _generateSpamMessage() {
  if (!appModule) {
    try {
      appModule = await import('./app.js');
    } catch (error) {
      console.warn(`${MODULE_ID} | Could not load app module for spam generation:`, error);
      return;
    }
  }
  
  if (appModule.NightCityMessenger?.generateSpam) {
    appModule.NightCityMessenger.generateSpam();
  }
}

// ===================================================================
// EXPORT VERIFICATION
// ===================================================================

console.log(`${MODULE_ID} | Hooks module loaded successfully`);