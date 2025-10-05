/**
 * UI Component Registry
 * File: scripts/integrations/UIRegistry.js
 * Module: cyberpunkred-messenger
 * Description: Central registry for all UI components
 */

import { MODULE_ID } from '../utils/constants.js';
import { EventBus } from '../core/EventBus.js';

/**
 * Register all UI components
 */
export function registerUIComponents() {
  console.log(`${MODULE_ID} | Registering UI components...`);
  
  // Make components available globally
  game.nightcity = game.nightcity || {};
  game.nightcity.ui = {};
  
  // Listen for component open events
  const eventBus = EventBus.getInstance();
  
  // Composer open event
  eventBus.on('composer:open', async (data) => {
    const { MessageComposerApp } = await import('../ui/components/MessageComposer/MessageComposerApp.js');
    const composer = new MessageComposerApp(data);
    composer.render(true);
  });
  
  console.log(`${MODULE_ID} | ✓ UI components registered`);
}

/**
 * Open message viewer for user
 * @param {string} userId - User ID (defaults to current user)
 */
export async function openMessageViewer(userId = null) {
  userId = userId || game.user.id;
  
  try {
    const { JournalManager } = await import('../data/JournalManager.js');
    const journalManager = new JournalManager();
    
    // Get or create inbox
    let inbox;
    if (game.user.isGM) {
      inbox = await journalManager.ensureUserInbox(userId);
    } else {
      inbox = await journalManager.getUserInbox(userId);
      
      if (!inbox) {
        ui.notifications.error('No inbox found. Contact your GM.');
        return;
      }
    }
    
    // Open viewer
    const { MessageViewerApp } = await import('../ui/components/MessageViewer/MessageViewerApp.js');
    new MessageViewerApp(inbox).render(true);
  } catch (error) {
    console.error(`${MODULE_ID} | Error opening message viewer:`, error);
    ui.notifications.error('Failed to open messages');
  }
}

/**
 * Open message composer
 * @param {Object} options - Composer options
 */
export async function openMessageComposer(options = {}) {
  const { MessageComposerApp } = await import('../ui/components/MessageComposer/MessageComposerApp.js');
  const composer = new MessageComposerApp(options);
  composer.render(true);
}

/**
 * Open contact manager
 */
export async function openContactManager() {
  const { ContactManagerApp } = await import('../ui/components/ContactManager/ContactManagerApp.js');
  const manager = new ContactManagerApp();
  manager.render(true);
}

/**
 * Open admin panel (GM only)
 */
export async function openAdminPanel() {
  if (!game.user.isGM) {
    ui.notifications.error('Admin panel is only accessible to GMs');
    return;
  }
  
  const { AdminPanelApp } = await import('../ui/components/AdminPanel/AdminPanelApp.js');
  const panel = new AdminPanelApp();
  panel.render(true);
}

/**
 * Open item inbox
 * @param {Item} item - Item to open
 */
export async function openItemInbox(item) {
  if (!item) {
    ui.notifications.error('No item provided');
    return;
  }
  
  const isDataShard = item.getFlag(MODULE_ID, 'isDataShard');
  
  if (!isDataShard) {
    ui.notifications.error('This item is not a data shard');
    return;
  }
  
  const { ItemInboxApp } = await import('../ui/components/ItemInbox/ItemInboxApp.js');
  new ItemInboxApp(item).render(true);
}