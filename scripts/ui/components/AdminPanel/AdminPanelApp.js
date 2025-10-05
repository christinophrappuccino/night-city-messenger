/**
 * Admin Panel Application
 * File: scripts/ui/components/AdminPanel/AdminPanelApp.js
 * Module: cyberpunkred-messenger
 * Description: GM administration tools for the messaging system
 */

import { MODULE_ID } from '../../../utils/constants.js';
import { BaseApplication } from '../BaseApplication.js';
import { StatisticsPanel } from './StatisticsPanel.js';
import { UserManagement } from './UserManagement.js';
import { SystemTools } from './SystemTools.js';
import { MessageService } from '../../../services/MessageService.js';
import { SchedulingService } from '../../../services/SchedulingService.js';

export class AdminPanelApp extends BaseApplication {
  constructor(options = {}) {
    super(options);
    
    // Check if user is GM
    if (!game.user.isGM) {
      ui.notifications.error('Admin panel is only accessible to GMs');
      throw new Error('Unauthorized access to admin panel');
    }
    
    // Services
    this.messageService = options.messageService || new MessageService();
    this.schedulingService = options.schedulingService || new SchedulingService();
    
    // Current active tab
    this.activeTab = 'overview';
    
    // Initialize components
    this.statisticsPanel = new StatisticsPanel(this);
    this.userManagement = new UserManagement(this);
    this.systemTools = new SystemTools(this);
    
    // Register components
    this.registerComponent('statistics', this.statisticsPanel);
    this.registerComponent('users', this.userManagement);
    this.registerComponent('system', this.systemTools);
    
    // Auto-refresh timer
    this.refreshInterval = null;
  }
  
  /**
   * Default options
   */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["ncm-app", "ncm-admin"],
      template: `modules/${MODULE_ID}/templates/admin-panel/admin-panel.hbs`,
      width: 900,
      height: 700,
      resizable: true,
      title: "Night City Mail - Admin Panel",
      tabs: [{
        navSelector: ".ncm-admin__tabs",
        contentSelector: ".ncm-admin__content",
        initial: "overview"
      }]
    });
  }
  
  /**
   * Get data for template
   */
  async getData(options = {}) {
    const data = super.getData(options);
    
    // Get system-wide statistics
    const stats = await this._getSystemStatistics();
    
    // Get all users
    const users = game.users.map(u => ({
      id: u.id,
      name: u.name,
      characterName: u.character?.name || 'No Character',
      isGM: u.isGM,
      active: u.active
    }));
    
    // Get scheduled messages
    const scheduledMessages = this.schedulingService.getAllScheduled();
    const schedulingStats = this.schedulingService.getStatistics();
    
    return {
      ...data,
      activeTab: this.activeTab,
      stats,
      users,
      scheduledMessages,
      schedulingStats,
      hasScheduledMessages: scheduledMessages.length > 0
    };
  }
  
  /**
   * Switch active tab
   * @param {string} tab - Tab name
   */
  switchTab(tab) {
    this.activeTab = tab;
    this.render(false);
  }
  
  /**
   * Start auto-refresh
   */
  startAutoRefresh() {
    if (this.refreshInterval) return;
    
    // Refresh every 30 seconds
    this.refreshInterval = setInterval(() => {
      if (this.rendered) {
        this.render(false);
      }
    }, 30000);
    
    console.log(`${MODULE_ID} | Admin panel auto-refresh started`);
  }
  
  /**
   * Stop auto-refresh
   */
  stopAutoRefresh() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
      console.log(`${MODULE_ID} | Admin panel auto-refresh stopped`);
    }
  }
  
  /**
   * Activate listeners
   */
  activateListeners(html) {
    super.activateListeners(html);
    
    // Tab navigation
    html.find('.ncm-admin__tab').on('click', (event) => {
      const tab = $(event.currentTarget).data('tab');
      this.switchTab(tab);
      this.playSound('click');
    });
    
    // Refresh button
    html.find('.ncm-admin__refresh-btn').on('click', () => {
      this.render(false);
      ui.notifications.info('Statistics refreshed');
      this.playSound('click');
    });
    
    // Export data button
    html.find('.ncm-admin__export-btn').on('click', () => {
      this.exportData();
      this.playSound('click');
    });
    
    // Send scheduled messages button
    html.find('.ncm-admin__send-scheduled-btn').on('click', async () => {
      await this.sendScheduledMessages();
      this.playSound('click');
    });
    
    // Clear all messages button (dangerous)
    html.find('.ncm-admin__clear-all-btn').on('click', () => {
      this.clearAllMessages();
      this.playSound('click');
    });
  }
  
  /**
   * Export system data
   */
  async exportData() {
    try {
      // Gather all data
      const exportData = {
        timestamp: new Date().toISOString(),
        version: game.modules.get(MODULE_ID).version,
        statistics: await this._getSystemStatistics(),
        users: game.users.map(u => ({
          id: u.id,
          name: u.name,
          character: u.character?.name
        })),
        scheduledMessages: this.schedulingService.getAllScheduled(),
        settings: {
          enableSounds: this.getSetting('enableSounds'),
          enableNotifications: this.getSetting('enableNotifications'),
          spamFilterEnabled: this.getSetting('spamFilterEnabled')
        }
      };
      
      // Create download
      const blob = new Blob([JSON.stringify(exportData, null, 2)], {
        type: 'application/json'
      });
      
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `night-city-messenger-export-${Date.now()}.json`;
      a.click();
      
      URL.revokeObjectURL(url);
      
      ui.notifications.info('Data exported successfully');
    } catch (error) {
      console.error(`${MODULE_ID} | Error exporting data:`, error);
      ui.notifications.error('Failed to export data');
    }
  }
  
  /**
   * Send all scheduled messages that are due
   */
  async sendScheduledMessages() {
    try {
      const count = await this.schedulingService.checkScheduledMessages();
      
      if (count > 0) {
        ui.notifications.info(`Sent ${count} scheduled messages`);
        this.render(false);
      } else {
        ui.notifications.info('No messages ready to send');
      }
    } catch (error) {
      console.error(`${MODULE_ID} | Error sending scheduled messages:`, error);
      ui.notifications.error('Failed to send scheduled messages');
    }
  }
  
  /**
   * Clear all messages (dangerous operation)
   */
  async clearAllMessages() {
    const confirmed = await Dialog.confirm({
      title: '⚠️ DANGER: Clear All Messages',
      content: `
        <div style="background: #660000; padding: 15px; border: 2px solid #ff0000; border-radius: 4px;">
          <p style="color: #ff6666; font-weight: bold; margin-bottom: 10px;">
            <i class="fas fa-exclamation-triangle"></i> WARNING: DESTRUCTIVE OPERATION
          </p>
          <p style="color: #ffffff;">
            This will <strong>permanently delete ALL messages</strong> from all users.
          </p>
          <p style="color: #ffffff;">
            This action <strong>CANNOT be undone</strong>.
          </p>
          <p style="color: #ff9999; margin-top: 10px;">
            Are you absolutely sure you want to continue?
          </p>
        </div>
      `,
      yes: () => true,
      no: () => false,
      defaultYes: false
    });
    
    if (!confirmed) return;
    
    // Double confirmation
    const doubleConfirm = await Dialog.confirm({
      title: 'Final Confirmation',
      content: '<p>Type "DELETE ALL" to confirm:</p><input type="text" id="confirm-text" style="width: 100%;" />',
      yes: (html) => {
        const text = html.find('#confirm-text').val();
        return text === 'DELETE ALL';
      },
      no: () => false,
      defaultYes: false
    });
    
    if (!doubleConfirm) {
      ui.notifications.warn('Confirmation text did not match. Operation cancelled.');
      return;
    }
    
    try {
      // Delete all message journals
      const journals = game.journal.filter(j => 
        j.getFlag(MODULE_ID, 'isInbox') ||
        j.getFlag(MODULE_ID, 'isDeletedMessagesJournal')
      );
      
      for (const journal of journals) {
        await journal.delete();
      }
      
      ui.notifications.warn(`Deleted ${journals.length} message journals`);
      
      // Clear state
      this.stateManager.get('messages').clear();
      this.stateManager.get('unreadMessages').clear();
      
      this.render(false);
    } catch (error) {
      console.error(`${MODULE_ID} | Error clearing messages:`, error);
      ui.notifications.error('Failed to clear messages');
    }
  }
  
  /**
   * Lifecycle: First render
   */
  _onFirstRender() {
    console.log(`${MODULE_ID} | Admin panel opened`);
    
    this.playSound('open');
    
    // Start auto-refresh
    this.startAutoRefresh();
  }
  
  /**
   * Close admin panel
   */
  async close(options = {}) {
    // Stop auto-refresh
    this.stopAutoRefresh();
    
    return super.close(options);
  }
  
  // ========================================
  // Private Helper Methods
  // ========================================
  
  /**
   * Get system-wide statistics
   * @private
   */
  async _getSystemStatistics() {
    const stats = {
      totalMessages: 0,
      totalUnread: 0,
      totalSaved: 0,
      totalSpam: 0,
      messagesByUser: [],
      recentActivity: []
    };
    
    // Get all inbox journals
    const journals = game.journal.filter(j => j.getFlag(MODULE_ID, 'isInbox'));
    
    for (const journal of journals) {
      const userId = journal.getFlag(MODULE_ID, 'userId');
      const user = game.users.get(userId);
      
      if (!user) continue;
      
      let userStats = {
        userId: userId,
        userName: user.name,
        characterName: user.character?.name || 'No Character',
        total: journal.pages.size,
        unread: 0,
        saved: 0,
        spam: 0
      };
      
      // Count by status
      journal.pages.forEach(page => {
        const status = page.getFlag(MODULE_ID, 'status') || {};
        
        if (!status.read) userStats.unread++;
        if (status.saved) userStats.saved++;
        if (status.spam) userStats.spam++;
      });
      
      stats.totalMessages += userStats.total;
      stats.totalUnread += userStats.unread;
      stats.totalSaved += userStats.saved;
      stats.totalSpam += userStats.spam;
      
      stats.messagesByUser.push(userStats);
    }
    
    // Sort by total messages
    stats.messagesByUser.sort((a, b) => b.total - a.total);
    
    return stats;
  }
}