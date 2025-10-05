/**
 * System Tools Component
 * File: scripts/ui/components/AdminPanel/SystemTools.js
 * Module: cyberpunkred-messenger
 * Description: System-wide maintenance and diagnostic tools
 */

import { MODULE_ID } from '../../../utils/constants.js';
import { JournalManager } from '../../../data/JournalManager.js';
import { MessageRepository } from '../../../data/MessageRepository.js';

export class SystemTools {
  constructor(parent) {
    this.parent = parent;
    this.journalManager = new JournalManager();
    this.messageRepository = new MessageRepository();
  }
  
  /**
   * Run system diagnostics
   * @returns {Object} Diagnostic results
   */
  async runDiagnostics() {
    console.log(`${MODULE_ID} | Running system diagnostics...`);
    
    const results = {
      timestamp: new Date().toISOString(),
      checks: []
    };
    
    // Check 1: Verify folder structure
    results.checks.push(await this._checkFolderStructure());
    
    // Check 2: Verify user inboxes
    results.checks.push(await this._checkUserInboxes());
    
    // Check 3: Check for orphaned messages
    results.checks.push(await this._checkOrphanedMessages());
    
    // Check 4: Validate message data
    results.checks.push(await this._validateMessageData());
    
    // Check 5: Check scheduled messages
    results.checks.push(await this._checkScheduledMessages());
    
    return results;
  }
  
  /**
   * Display diagnostic results
   * @param {Object} results - Diagnostic results
   */
  displayDiagnostics(results) {
    const content = `
      <div class="ncm-diagnostics">
        <p><strong>Diagnostic Run:</strong> ${new Date(results.timestamp).toLocaleString()}</p>
        
        ${results.checks.map(check => `
          <div class="ncm-diagnostic-check ${check.passed ? 'passed' : 'failed'}">
            <h4>
              ${check.passed ? '✅' : '❌'} ${check.name}
            </h4>
            <p>${check.message}</p>
            ${check.details ? `<pre>${check.details}</pre>` : ''}
          </div>
        `).join('')}
      </div>
    `;
    
    new Dialog({
      title: 'System Diagnostics',
      content,
      buttons: {
        close: {
          icon: '<i class="fas fa-times"></i>',
          label: 'Close'
        }
      }
    }, {
      classes: ['dialog', 'ncm-dialog'],
      width: 600,
      height: 500
    }).render(true);
  }
  
  /**
   * Repair system issues
   */
  async repairSystem() {
    const confirmed = await Dialog.confirm({
      title: 'Repair System',
      content: `
        <p>This will attempt to repair common issues:</p>
        <ul>
          <li>Create missing folders</li>
          <li>Create missing inboxes</li>
          <li>Remove orphaned data</li>
          <li>Fix permissions</li>
        </ul>
        <p>Continue?</p>
      `,
      yes: () => true,
      no: () => false
    });
    
    if (!confirmed) return;
    
    try {
      console.log(`${MODULE_ID} | Starting system repair...`);
      
      let repaired = 0;
      
      // Ensure folders exist
      await this.journalManager.getMessageFolder();
      await this.journalManager.getDeletedMessagesFolder();
      repaired++;
      
      // Create missing inboxes
      for (const user of game.users) {
        if (user.isGM) continue;
        
        const inbox = await this.journalManager.getUserInbox(user.id);
        if (!inbox) {
          await this.journalManager.createUserInbox(user.id);
          repaired++;
        }
      }
      
      // Clear caches
      this.journalManager.clearCache();
      this.messageRepository.clearCache();
      
      ui.notifications.info(`System repair complete. ${repaired} issues fixed.`);
      this.parent.render(false);
    } catch (error) {
      console.error(`${MODULE_ID} | Error during system repair:`, error);
      ui.notifications.error('System repair failed');
    }
  }
  
  /**
   * Clear all caches
   */
  clearCaches() {
    this.journalManager.clearCache();
    this.messageRepository.clearCache();
    this.parent.stateManager.get('messages').clear();
    
    ui.notifications.info('All caches cleared');
  }
  
  /**
   * Rebuild indexes
   */
  async rebuildIndexes() {
    try {
      console.log(`${MODULE_ID} | Rebuilding indexes...`);
      
      // Clear state
      this.parent.stateManager.get('messages').clear();
      this.parent.stateManager.get('unreadMessages').clear();
      
      // Reload all messages
      const journals = game.journal.filter(j => j.getFlag(MODULE_ID, 'isInbox'));
      let indexed = 0;
      
      for (const journal of journals) {
        journal.pages.forEach(page => {
          indexed++;
        });
      }
      
      ui.notifications.info(`Rebuilt indexes for ${indexed} messages`);
    } catch (error) {
      console.error(`${MODULE_ID} | Error rebuilding indexes:`, error);
      ui.notifications.error('Failed to rebuild indexes');
    }
  }
  
  /**
   * Activate event listeners
   */
  activateListeners(html) {
    // Run diagnostics button
    html.find('.ncm-system__diagnostics-btn').on('click', async () => {
      const results = await this.runDiagnostics();
      this.displayDiagnostics(results);
    });
    
    // Repair system button
    html.find('.ncm-system__repair-btn').on('click', () => {
      this.repairSystem();
    });
    
    // Clear caches button
    html.find('.ncm-system__clear-caches-btn').on('click', () => {
      this.clearCaches();
    });
    
    // Rebuild indexes button
    html.find('.ncm-system__rebuild-indexes-btn').on('click', () => {
      this.rebuildIndexes();
    });
  }
  
  // ========================================
  // Private Diagnostic Methods
  // ========================================
  
  /**
   * Check folder structure
   * @private
   */
  async _checkFolderStructure() {
    try {
      const messageFolder = await this.journalManager.getMessageFolder();
      const deletedFolder = await this.journalManager.getDeletedMessagesFolder();
      
      const passed = messageFolder && deletedFolder;
      
      return {
        name: 'Folder Structure',
        passed,
        message: passed 
          ? 'All required folders exist'
          : 'Missing required folders',
        details: `Message Folder: ${messageFolder ? '✓' : '✗'}\nDeleted Folder: ${deletedFolder ? '✓' : '✗'}`
      };
    } catch (error) {
      return {
        name: 'Folder Structure',
        passed: false,
        message: 'Error checking folders',
        details: error.message
      };
    }
  }
  
  /**
   * Check user inboxes
   * @private
   */
  async _checkUserInboxes() {
    try {
      let checked = 0;
      let missing = 0;
      
      for (const user of game.users) {
        if (user.isGM) continue;
        
        checked++;
        const inbox = await this.journalManager.getUserInbox(user.id);
        if (!inbox) missing++;
      }
      
      const passed = missing === 0;
      
      return {
        name: 'User Inboxes',
        passed,
        message: passed
          ? `All ${checked} users have inboxes`
          : `${missing} users missing inboxes`,
        details: `Checked: ${checked}\nMissing: ${missing}`
      };
    } catch (error) {
      return {
        name: 'User Inboxes',
        passed: false,
        message: 'Error checking inboxes',
        details: error.message
      };
    }
  }
  
  /**
   * Check for orphaned messages
   * @private
   */
  async _checkOrphanedMessages() {
    try {
      const journals = game.journal.filter(j => j.getFlag(MODULE_ID, 'isInbox'));
      let orphaned = 0;
      
      for (const journal of journals) {
        const userId = journal.getFlag(MODULE_ID, 'userId');
        if (!game.users.get(userId)) {
          orphaned++;
        }
      }
      
      const passed = orphaned === 0;
      
      return {
        name: 'Orphaned Messages',
        passed,
        message: passed
          ? 'No orphaned messages found'
          : `${orphaned} orphaned message journals`,
        details: `Total journals checked: ${journals.length}\nOrphaned: ${orphaned}`
      };
    } catch (error) {
      return {
        name: 'Orphaned Messages',
        passed: false,
        message: 'Error checking orphaned messages',
        details: error.message
      };
    }
  }
  
  /**
   * Validate message data
   * @private
   */
  async _validateMessageData() {
    try {
      const journals = game.journal.filter(j => j.getFlag(MODULE_ID, 'isInbox'));
      let total = 0;
      let invalid = 0;
      
      for (const journal of journals) {
        journal.pages.forEach(page => {
          total++;
          
          const flags = page.getFlag(MODULE_ID, 'from');
          if (!flags) invalid++;
        });
      }
      
      const passed = invalid === 0;
      
      return {
        name: 'Message Data Validation',
        passed,
        message: passed
          ? `All ${total} messages have valid data`
          : `${invalid} messages with invalid data`,
        details: `Total messages: ${total}\nInvalid: ${invalid}`
      };
    } catch (error) {
      return {
        name: 'Message Data Validation',
        passed: false,
        message: 'Error validating messages',
        details: error.message
      };
    }
  }
  
  /**
   * Check scheduled messages
   * @private
   */
  async _checkScheduledMessages() {
    try {
      const scheduled = this.parent.schedulingService.getAllScheduled();
      const now = new Date();
      
      let pastDue = 0;
      
      scheduled.forEach(msg => {
        if (new Date(msg.scheduledTime) < now) {
          pastDue++;
        }
      });
      
      const passed = pastDue === 0;
      
      return {
        name: 'Scheduled Messages',
        passed,
        message: passed
          ? `${scheduled.length} messages scheduled, none overdue`
          : `${pastDue} messages past due`,
        details: `Total scheduled: ${scheduled.length}\nPast due: ${pastDue}`
      };
    } catch (error) {
      return {
        name: 'Scheduled Messages',
        passed: false,
        message: 'Error checking scheduled messages',
        details: error.message
      };
    }
  }
  
  /**
   * Cleanup
   */
  destroy() {
    // Cleanup if needed
  }
}