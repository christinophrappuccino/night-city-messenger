/**
 * Macro API
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
     * Open message viewer
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
    game.nightcity.openContacts = async () => {
      await this._ensureReady();
      const { openContactManager } = await import('./UIRegistry.js');
      return openContactManager();
    };
    
    /**
     * Open admin panel
     */
    game.nightcity.openAdmin = async () => {
      await this._ensureReady();
      const { openAdminPanel } = await import('./UIRegistry.js');
      return openAdminPanel();
    };
    
    /**
     * Open item inbox
     */
    game.nightcity.openDataShard = async (item) => {
      await this._ensureReady();
      const { openItemInbox } = await import('./UIRegistry.js');
      return openItemInbox(item);
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
    game.nightcity.sendMessage = async (to, subject, content) => {
      const messageService = await game.nightcity.getMessageService();
      
      return await messageService.sendMessage({
        to,
        subject,
        content
      });
    };
    
    /**
     * Search messages
     */
    game.nightcity.searchMessages = async (criteria) => {
      const messageRepository = await game.nightcity.getMessageRepository();
      return await messageRepository.search(criteria);
    };
    
    /**
     * Get statistics
     */
    game.nightcity.getStatistics = async (userId = null) => {
      const messageService = await game.nightcity.getMessageService();
      return await messageService.getStatistics(userId);
    };
    
    // ========================================
    // Debug Functions
    // ========================================
    
    /**
     * Debug info
     */
    game.nightcity.debug = () => {
      console.log('=== Night City Messenger Debug ===');
      console.log('Ready:', game.nightcity.ready);
      console.log('Module ID:', MODULE_ID);
      console.log('Available APIs:', Object.keys(game.nightcity).filter(k => typeof game.nightcity[k] === 'function'));
      console.log('=== End Debug ===');
    };
    
    console.log(`${MODULE_ID} | ✓ Macro API (services) registered`);
    console.log(`${MODULE_ID} | Access via: game.nightcity`);
  }
  
  /**
   * Wait for module to be ready
   * @private
   */
  static async _ensureReady() {
    // If already ready, return immediately
    if (game.nightcity.ready) return;
    
    // Wait for ready flag
    return new Promise((resolve) => {
      const checkReady = () => {
        if (game.nightcity.ready) {
          resolve();
        } else {
          setTimeout(checkReady, 100);
        }
      };
      checkReady();
    });
  }
}