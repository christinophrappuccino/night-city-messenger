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
 * Open message viewer (inbox)
 * @param {string} actorId - Optional actor ID (for GM to view specific inbox)
 * @returns {MessageViewerApp}
 */
export async function openMessageViewer(actorId = null) {
  const { MessageViewerApp } = await import('../ui/components/MessageViewer/MessageViewerApp.js');
  
  // Determine which actor's inbox to open
  let targetActorId = actorId;
  
  // If no actor specified
  if (!targetActorId) {
    if (game.user.isGM) {
      // GM: Prompt to select character or use a default
      // For now, we'll open with no selection and let them pick
      targetActorId = null;
    } else {
      // Player: Use their assigned character
      targetActorId = game.user.character?.id;
      
      if (!targetActorId) {
        ui.notifications.warn("You must have a character assigned to view messages.");
        return null;
      }
    }
  }
  
  // Get the actor
  let actor = null;
  if (targetActorId) {
    actor = game.actors.get(targetActorId);
    
    if (!actor) {
      ui.notifications.error("Character not found.");
      return null;
    }
  }
  
  // Find or create inbox journal
  let inbox = null;
  
  if (actor) {
    const inboxName = `${actor.name}'s Messages`;
    inbox = game.journal.getName(inboxName);
    
    // Create inbox if it doesn't exist (GM only)
    if (!inbox && game.user.isGM) {
      // Find or create Player Messages folder
      let folder = game.folders.getName("Player Messages");
      
      if (!folder) {
        folder = await Folder.create({
          name: "Player Messages",
          type: "JournalEntry",
          sorting: "a"
        });
      }
      
      inbox = await JournalEntry.create({
        name: inboxName,
        folder: folder.id
      });
      
      ui.notifications.info(`Created inbox for ${actor.name}`);
    }
    
    if (!inbox) {
      ui.notifications.error(`No inbox found for ${actor.name}. Ask your GM to create one.`);
      return null;
    }
  }
  
  // Check for existing viewer window
  const existingViewer = Object.values(ui.windows).find(w => 
    w instanceof MessageViewerApp && 
    w.journalEntry?.id === inbox?.id
  );
  
  if (existingViewer) {
    existingViewer.bringToTop();
    return existingViewer;
  }
  
  // Create new viewer
  const viewer = new MessageViewerApp(inbox, {
    actorId: targetActorId
  });
  
  viewer.render(true);
  
  return viewer;
}

/**
 * Quick helper for opening specific character's inbox
 * @param {string} actorId - Actor ID
 */
export async function openInboxForActor(actorId) {
  return openMessageViewer(actorId);
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