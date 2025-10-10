/**
 * Macro API - COMPLETE & FIXED
 * File: scripts/integrations/MacroAPI.js
 * Module: cyberpunkred-messenger
 * Description: Public API for macros and other modules
 */

import { MODULE_ID } from '../utils/constants.js';

/**
 * Macro API
 */
export class MacroAPI {
  /**
   * Register early (during init) - UI functions only
   */
  static registerEarly() {
    console.log(`${MODULE_ID} | Registering macro API (early)...`);
    
    // Ensure namespace exists
    game.nightcity = game.nightcity || {};
    
    // ========================================
    // UI Functions - Available immediately
    // ========================================
    
    /**
     * Open message viewer (inbox)
     */
    game.nightcity.openInbox = async (userId = null) => {
      await this._ensureReady();
      const { openMessageViewer } = await import('./UIRegistry.js');
      return openMessageViewer(userId);
    };
    
    /**
     * Open message composer
     */
    game.nightcity.composeMessage = async (options = {}) => {
      await this._ensureReady();
      const { openMessageComposer } = await import('./UIRegistry.js');
      return openMessageComposer(options);
    };
    
    /**
     * Open contact manager
     */
    game.nightcity.openContactManager = async () => {
      await this._ensureReady();
      const { openContactManager } = await import('./UIRegistry.js');
      return openContactManager();
    };
    
    /**
     * Alias for convenience
     */
    game.nightcity.openContacts = game.nightcity.openContactManager;
    
    /**
     * Open admin panel (GM only)
     */
    game.nightcity.openAdmin = async () => {
      await this._ensureReady();
      const { openAdminPanel } = await import('./UIRegistry.js');
      return openAdminPanel();
    };
    
    /**
     * Alias for admin panel
     */
    game.nightcity.openAdminPanel = game.nightcity.openAdmin;
    
    /**
     * Open item inbox (data shard)
     */
    game.nightcity.openDataShard = async (item) => {
      await this._ensureReady();
      const { openItemInbox } = await import('./UIRegistry.js');
      return openItemInbox(item);
    };
    
    /**
     * Alias for data shard
     */
    game.nightcity.openItemInbox = game.nightcity.openDataShard;
    
    /**
     * Open email setup dialog
     */
    game.nightcity.openEmailSetup = async () => {
      await this._ensureReady();
      const { PlayerEmailSetup } = await import('../ui/dialogs/PlayerEmailSetup.js');
      return await PlayerEmailSetup.show();
    };
    
    console.log(`${MODULE_ID} | ✓ Macro API (early) registered`);
  }
  
  /**
   * Register services (during ready)
   */
  static registerServices() {
    console.log(`${MODULE_ID} | Registering macro API (services)...`);
    
    // ========================================
    // Service Access
    // ========================================
    
    /**
     * Get message service
     */
    game.nightcity.getMessageService = async () => {
      const { MessageService } = await import('../services/MessageService.js');
      return new MessageService();
    };
    
    /**
     * Get scheduling service
     */
    game.nightcity.getSchedulingService = () => {
      return game.nightcity.schedulingService;
    };
    
    /**
     * Get notification service
     */
    game.nightcity.getNotificationService = async () => {
      const { NotificationService } = await import('../services/NotificationService.js');
      return new NotificationService();
    };
    
    // ========================================
    // Data Access
    // ========================================
    
    /**
     * Get message repository
     */
    game.nightcity.getMessageRepository = async () => {
      const { MessageRepository } = await import('../data/MessageRepository.js');
      return new MessageRepository();
    };
    
    /**
     * Get contact repository
     */
    game.nightcity.getContactRepository = async () => {
      const { ContactRepository } = await import('../data/ContactRepository.js');
      return new ContactRepository();
    };
    
    // ========================================
    // Utility Functions
    // ========================================
    
    /**
     * Send a message (shorthand)
     */
    game.nightcity.sendMessage = async (messageData) => {
      const service = await game.nightcity.getMessageService();
      return service.sendMessage(messageData);
    };
    
    /**
     * Create inbox for user
     */
    game.nightcity.createInbox = async (userId) => {
      if (!game.user.isGM) {
        ui.notifications.error('Only GMs can create inboxes');
        return;
      }
      const { JournalManager } = await import('../data/JournalManager.js');
      const manager = new JournalManager();
      return manager.createUserInbox(userId);
    };
    
    /**
     * Flag item as data shard
     */
    game.nightcity.flagAsDataShard = async (item, options = {}) => {
      if (!item) {
        ui.notifications.error('No item provided');
        return;
      }
      
      await item.setFlag(MODULE_ID, 'isDataShard', true);
      
      if (options.encrypted) {
        await item.setFlag(MODULE_ID, 'encrypted', true);
        await item.setFlag(MODULE_ID, 'encryptionDC', options.encryptionDC || 15);
      }
      
      ui.notifications.info(`${item.name} flagged as data shard`);
    };
    
    // ========================================
    // Email & Contact Functions
    // ========================================
    
    /**
     * Get current user's email
     */
    game.nightcity.getMyEmail = () => {
      const actor = game.user.character;
      if (!actor) {
        ui.notifications.warn("You must have a character assigned.");
        return null;
      }
      return actor.getFlag(MODULE_ID, 'emailAddress') || null;
    };
    
    /**
     * Get all contacts
     */
    game.nightcity.getContacts = async () => {
      const userContacts = await game.user.getFlag(MODULE_ID, 'contacts') || [];
      
      // Add actor emails
      const actorContacts = game.actors.contents
        .filter(a => a.getFlag(MODULE_ID, 'emailAddress'))
        .map(a => ({
          id: `actor_${a.id}`,
          name: a.name,
          email: a.getFlag(MODULE_ID, 'emailAddress'),
          img: a.img,
          type: 'character'
        }));
      
      // Merge and deduplicate
      const all = [...userContacts, ...actorContacts];
      const unique = Array.from(new Map(all.map(c => [c.email, c])).values());
      
      return unique;
    };
    
    /**
     * Add a contact programmatically
     */
    game.nightcity.addContact = async (name, email) => {
      if (!name || !email) {
        ui.notifications.error("Name and email are required.");
        return false;
      }
      
      if (!email.includes('@') || !email.includes('.')) {
        ui.notifications.error("Invalid email format.");
        return false;
      }
      
      const contacts = await game.user.getFlag(MODULE_ID, 'contacts') || [];
      
      // Check duplicate
      if (contacts.some(c => c.email === email)) {
        ui.notifications.warn("Contact already exists.");
        return false;
      }
      
      // Add
      contacts.push({
        id: foundry.utils.randomID(),
        name,
        email,
        createdAt: new Date().toISOString()
      });
      
      await game.user.setFlag(MODULE_ID, 'contacts', contacts);
      ui.notifications.info(`Added ${name} to contacts.`);
      return true;
    };
    
    console.log(`${MODULE_ID} | ✓ Macro API (services) registered`);
    console.log(`${MODULE_ID} | Available API:`, Object.keys(game.nightcity).sort());
  }
  
  /**
   * Ensure game is ready
   * @private
   */
  static async _ensureReady() {
    if (!game.ready) {
      return new Promise(resolve => {
        Hooks.once('ready', resolve);
      });
    }
  }
}