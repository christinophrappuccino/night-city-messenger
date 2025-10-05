/**
 * User Management Component
 * File: scripts/ui/components/AdminPanel/UserManagement.js
 * Module: cyberpunkred-messenger
 * Description: Manage user inboxes and permissions
 */

import { MODULE_ID } from '../../../utils/constants.js';
import { JournalManager } from '../../../data/JournalManager.js';
import { MessageRepository } from '../../../data/MessageRepository.js';

export class UserManagement {
  constructor(parent) {
    this.parent = parent;
    this.journalManager = new JournalManager();
    this.messageRepository = new MessageRepository();
  }
  
  /**
   * Get user inbox information
   * @param {string} userId - User ID
   * @returns {Object}
   */
  async getUserInfo(userId) {
    const user = game.users.get(userId);
    if (!user) return null;
    
    const inbox = await this.journalManager.getUserInbox(userId);
    const messageCount = inbox ? inbox.pages.size : 0;
    
    const stats = await this.messageRepository.getMessageCount(userId);
    
    return {
      userId: userId,
      userName: user.name,
      characterName: user.character?.name || 'No Character',
      hasInbox: !!inbox,
      inboxId: inbox?.id,
      messageCount,
      stats
    };
  }
  
  /**
   * Create inbox for user
   * @param {string} userId - User ID
   */
  async createInbox(userId) {
    try {
      const inbox = await this.journalManager.createUserInbox(userId);
      
      ui.notifications.info(`Created inbox for ${inbox.name}`);
      this.parent.render(false);
    } catch (error) {
      console.error(`${MODULE_ID} | Error creating inbox:`, error);
      ui.notifications.error('Failed to create inbox');
    }
  }
  
  /**
   * Delete user's inbox
   * @param {string} userId - User ID
   */
  async deleteInbox(userId) {
    const user = game.users.get(userId);
    if (!user) return;
    
    const confirmed = await Dialog.confirm({
      title: 'Delete Inbox',
      content: `
        <p>Are you sure you want to delete the inbox for <strong>${user.name}</strong>?</p>
        <p><em>This will permanently delete all messages.</em></p>
      `,
      yes: () => true,
      no: () => false,
      defaultYes: false
    });
    
    if (!confirmed) return;
    
    try {
      const inbox = await this.journalManager.getUserInbox(userId);
      
      if (inbox) {
        await inbox.delete();
        ui.notifications.info(`Deleted inbox for ${user.name}`);
        this.parent.render(false);
      }
    } catch (error) {
      console.error(`${MODULE_ID} | Error deleting inbox:`, error);
      ui.notifications.error('Failed to delete inbox');
    }
  }
  
  /**
   * Clear user's messages
   * @param {string} userId - User ID
   */
  async clearMessages(userId) {
    const user = game.users.get(userId);
    if (!user) return;
    
    const confirmed = await Dialog.confirm({
      title: 'Clear Messages',
      content: `
        <p>Are you sure you want to clear all messages for <strong>${user.name}</strong>?</p>
      `,
      yes: () => true,
      no: () => false,
      defaultYes: false
    });
    
    if (!confirmed) return;
    
    try {
      const inbox = await this.journalManager.getUserInbox(userId);
      
      if (inbox) {
        // Delete all pages
        const pageIds = inbox.pages.map(p => p.id);
        for (const pageId of pageIds) {
          const page = inbox.pages.get(pageId);
          if (page) await page.delete();
        }
        
        ui.notifications.info(`Cleared messages for ${user.name}`);
        this.parent.render(false);
      }
    } catch (error) {
      console.error(`${MODULE_ID} | Error clearing messages:`, error);
      ui.notifications.error('Failed to clear messages');
    }
  }
  
  /**
   * Send message to user
   * @param {string} userId - User ID
   */
  sendMessageToUser(userId) {
    const user = game.users.get(userId);
    if (!user) return;
    
    const name = user.character?.name || user.name;
    const email = `${name.toLowerCase().replace(/\s+/g, '')}@nightcity.net`;
    
    // Open composer
    this.parent.eventBus.emit('composer:open', {
      to: email
    });
  }
  
  /**
   * View user's inbox
   * @param {string} userId - User ID
   */
  async viewInbox(userId) {
    try {
      const inbox = await this.journalManager.getUserInbox(userId);
      
      if (!inbox) {
        ui.notifications.warn('User has no inbox');
        return;
      }
      
      // Open message viewer
      const { MessageViewerApp } = await import('../MessageViewer/MessageViewerApp.js');
      new MessageViewerApp(inbox).render(true);
    } catch (error) {
      console.error(`${MODULE_ID} | Error viewing inbox:`, error);
      ui.notifications.error('Failed to open inbox');
    }
  }
  
  /**
   * Activate event listeners
   */
  activateListeners(html) {
    // Create inbox button
    html.find('.ncm-user__create-inbox-btn').on('click', (event) => {
      const userId = $(event.currentTarget).data('user-id');
      this.createInbox(userId);
    });
    
    // Delete inbox button
    html.find('.ncm-user__delete-inbox-btn').on('click', (event) => {
      const userId = $(event.currentTarget).data('user-id');
      this.deleteInbox(userId);
    });
    
    // Clear messages button
    html.find('.ncm-user__clear-messages-btn').on('click', (event) => {
      const userId = $(event.currentTarget).data('user-id');
      this.clearMessages(userId);
    });
    
    // Send message button
    html.find('.ncm-user__send-message-btn').on('click', (event) => {
      const userId = $(event.currentTarget).data('user-id');
      this.sendMessageToUser(userId);
    });
    
    // View inbox button
    html.find('.ncm-user__view-inbox-btn').on('click', (event) => {
      const userId = $(event.currentTarget).data('user-id');
      this.viewInbox(userId);
    });
  }
  
  /**
   * Cleanup
   */
  destroy() {
    // Cleanup if needed
  }
}