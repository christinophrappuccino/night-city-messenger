/**
 * Data Shard Service
 * File: scripts/services/DataShardService.js
 * Module: cyberpunkred-messenger
 * Description: Handles data shard operations (convert items, encryption, hacking)
 */

import { MODULE_ID } from '../utils/constants.js';
import { EventBus, EVENTS } from '../core/EventBus.js'; // ✅ EVENTS from EventBus
import { MessageRepository } from '../data/MessageRepository.js';

export class DataShardService {
  constructor() {
    this.eventBus = EventBus.getInstance();
    this.messageRepository = new MessageRepository();
  }
  
  /**
   * Convert an item to a data shard
   * @param {Item} item - The item to convert
   * @param {Object} config - Configuration options
   */
  async convertToDataShard(item, config = {}) {
    if (!item) throw new Error('No item provided');
    
    const defaultConfig = {
      type: 'multi',           // 'single' or 'multi' message
      encrypted: false,
      encryptionDC: 15,
      encryptionType: 'ICE',
      theme: 'default',
      failureMode: 'lockout'  // 'lockout', 'traceback', 'damage', 'corrupt'
    };
    
    const shardConfig = { ...defaultConfig, ...config };
    
    console.log(`${MODULE_ID} | Converting item to data shard:`, item.name, shardConfig);
    
    try {
      // Set the data shard flag
      await item.setFlag(MODULE_ID, 'isDataShard', true);
      
      // Set configuration
      await item.setFlag(MODULE_ID, 'dataShardType', shardConfig.type);
      await item.setFlag(MODULE_ID, 'encrypted', shardConfig.encrypted);
      await item.setFlag(MODULE_ID, 'encryptionDC', shardConfig.encryptionDC);
      await item.setFlag(MODULE_ID, 'encryptionType', shardConfig.encryptionType);
      await item.setFlag(MODULE_ID, 'theme', shardConfig.theme);
      await item.setFlag(MODULE_ID, 'failureMode', shardConfig.failureMode);
      
      // Create associated journal for messages
      const journal = await this._ensureJournal(item);
      
      // Emit event
      this.eventBus.emit(EVENTS.DATA_SHARD_CREATED, { item, journal, config: shardConfig });
      
      ui.notifications.info(`${item.name} converted to data shard!`);
      
      return { item, journal, config: shardConfig };
      
    } catch (error) {
      console.error(`${MODULE_ID} | Error converting to data shard:`, error);
      ui.notifications.error('Failed to convert item to data shard');
      throw error;
    }
  }
  
  /**
   * Add a message to a data shard
   * @param {Item} item - The data shard item
   * @param {Object} messageData - Message content
   */
  async addMessage(item, messageData) {
    if (!item) throw new Error('No item provided');
    
    const isDataShard = item.getFlag(MODULE_ID, 'isDataShard');
    if (!isDataShard) {
      throw new Error('Item is not a data shard');
    }
    
    console.log(`${MODULE_ID} | Adding message to data shard:`, item.name);
    
    try {
      // Get the journal
      const journal = await this._ensureJournal(item);
      
      // Check data shard type
      const dataShardType = item.getFlag(MODULE_ID, 'dataShardType') || 'single';
      
      // For single message data shards, delete existing messages first
      if (dataShardType === 'single' && journal.pages.size > 0) {
        const confirmed = await Dialog.confirm({
          title: "Replace Message?",
          content: "<p>This is a single-message data shard. Adding a new message will replace the existing one.</p><p>Continue?</p>"
        });
        
        if (!confirmed) return null;
        
        await journal.deleteEmbeddedDocuments("JournalEntryPage", 
          journal.pages.contents.map(p => p.id)
        );
      }
      
      // Format the message content
      const formattedContent = this._formatMessage(messageData);
      
      // Get encryption status
      const encrypted = item.getFlag(MODULE_ID, 'encrypted') || false;
      
      // Create the message page
      const pages = await journal.createEmbeddedDocuments("JournalEntryPage", [{
        name: messageData.subject || "Data Message",
        type: "text",
        text: {
          content: formattedContent
        },
        flags: {
          [MODULE_ID]: {
            messageData: {
              from: messageData.from || 'Unknown',
              to: messageData.to || 'Unknown',
              subject: messageData.subject || 'No Subject',
              date: messageData.date || new Date().toISOString()
            },
            status: {
              read: false,
              saved: false,
              spam: false,
              encrypted: encrypted,
              decrypted: !encrypted
            }
          }
        }
      }]);
      
      const page = pages[0];
      
      // Emit event
      this.eventBus.emit(EVENTS.DATA_SHARD_MESSAGE_ADDED, { item, page });
      
      ui.notifications.info("Message added to data shard!");
      
      return page;
      
    } catch (error) {
      console.error(`${MODULE_ID} | Error adding message:`, error);
      ui.notifications.error('Failed to add message to data shard');
      throw error;
    }
  }
  
  /**
   * Attempt to hack/decrypt a data shard
   * @param {Item} item - The data shard item
   * @param {Actor} actor - The actor attempting the hack
   */
  async attemptHack(item, actor) {
    if (!item || !actor) throw new Error('Missing item or actor');
    
    const isDataShard = item.getFlag(MODULE_ID, 'isDataShard');
    if (!isDataShard) throw new Error('Item is not a data shard');
    
    const encrypted = item.getFlag(MODULE_ID, 'encrypted');
    if (!encrypted) {
      ui.notifications.info('This data shard is not encrypted');
      return { success: true, alreadyDecrypted: true };
    }
    
    console.log(`${MODULE_ID} | Attempting hack on data shard:`, item.name);
    
    try {
      // Check for lockout
      const isLockedOut = await this._checkLockout(item, actor);
      if (isLockedOut) {
        ui.notifications.error('System locked - Too many failed attempts');
        return { success: false, reason: 'locked_out' };
      }
      
      // Get encryption difficulty
      const dc = item.getFlag(MODULE_ID, 'encryptionDC') || 15;
      
      // Perform skill check (Interface + INT + 1d10)
      const result = await this._performHackRoll(actor, dc);
      
      if (result.success) {
        // Success! Decrypt the data shard
        await this._decrypt(item, actor);
        
        // Create chat message
        await this._createHackMessage(actor, item, true, result);
        
        // Clear any lockouts
        await item.unsetFlag(MODULE_ID, 'lockoutUntil');
        await item.unsetFlag(MODULE_ID, 'failedAttempts');
        
        ui.notifications.info('Data shard decrypted successfully!');
        
        return { success: true, roll: result };
        
      } else {
        // Failure - handle consequences
        const failureMode = item.getFlag(MODULE_ID, 'failureMode') || 'lockout';
        await this._handleHackFailure(item, actor, failureMode);
        
        // Create chat message
        await this._createHackMessage(actor, item, false, result);
        
        return { success: false, roll: result, consequence: failureMode };
      }
      
    } catch (error) {
      console.error(`${MODULE_ID} | Error during hack attempt:`, error);
      ui.notifications.error('Hack attempt failed');
      throw error;
    }
  }
  
  /**
   * Get all messages from a data shard
   * @param {Item} item - The data shard item
   */
  async getMessages(item) {
    if (!item) return [];
    
    const isDataShard = item.getFlag(MODULE_ID, 'isDataShard');
    if (!isDataShard) return [];
    
    try {
      const journal = await this._ensureJournal(item);
      if (!journal) return [];
      
      const messages = [];
      
      for (const page of journal.pages.contents) {
        const messageData = page.getFlag(MODULE_ID, 'messageData');
        const status = page.getFlag(MODULE_ID, 'status');
        
        messages.push({
          id: page.id,
          name: page.name,
          content: page.text.content,
          messageData: messageData || {},
          status: status || {},
          page: page
        });
      }
      
      return messages;
      
    } catch (error) {
      console.error(`${MODULE_ID} | Error getting messages:`, error);
      return [];
    }
  }
  
  // ========================================================================
  // PRIVATE METHODS
  // ========================================================================
  
  /**
   * Ensure a journal exists for this data shard
   * @private
   */
  async _ensureJournal(item) {
    // Check for existing journal
    const journalId = item.getFlag(MODULE_ID, 'journalId');
    let journal = journalId ? game.journal.get(journalId) : null;
    
    if (journal) return journal;
    
    // Create new journal
    const folderName = "Data Shard Contents";
    let folder = game.folders.find(f => f.name === folderName && f.type === "JournalEntry");
    
    if (!folder) {
      folder = await Folder.create({
        name: folderName,
        type: "JournalEntry",
        parent: null
      });
    }
    
    const owner = item.actor ? item.actor.name : "Unknown";
    const journalName = `${item.name} Data [${owner}]`;
    
    journal = await JournalEntry.create({
      name: journalName,
      folder: folder.id,
      flags: {
        [MODULE_ID]: {
          dataShardJournal: true,
          itemId: item.id,
          itemUuid: item.uuid
        }
      }
    });
    
    // Link journal to item
    await item.setFlag(MODULE_ID, 'journalId', journal.id);
    
    console.log(`${MODULE_ID} | Created journal for data shard:`, journalName);
    
    return journal;
  }
  
  /**
   * Format message content
   * @private
   */
  _formatMessage(messageData) {
    return `
      <div class="ncm-data-shard-message">
        <div class="ncm-message-header">
          <div class="ncm-message-meta">
            <span class="ncm-meta-label">DATE:</span> ${messageData.date || 'Unknown'}
          </div>
          <div class="ncm-message-meta">
            <span class="ncm-meta-label">FROM:</span> ${messageData.from || 'Unknown'}
          </div>
          <div class="ncm-message-meta">
            <span class="ncm-meta-label">TO:</span> ${messageData.to || 'Unknown'}
          </div>
        </div>
        <div class="ncm-message-subject">
          ${messageData.subject || 'No Subject'}
        </div>
        <div class="ncm-message-body">
          ${messageData.content || messageData.body || ''}
        </div>
      </div>
    `;
  }
  
  /**
   * Perform hack roll
   * @private
   */
  async _performHackRoll(actor, dc) {
    // Get Interface skill
    const skill = actor.items.find(i => 
      i.type === 'skill' && 
      i.name.toLowerCase() === 'interface'
    );
    
    if (!skill) {
      ui.notifications.warn('Actor does not have Interface skill');
      return { success: false, message: 'Missing Interface skill' };
    }
    
    const skillLevel = skill.system.level || 0;
    
    // Get INT stat
    const int = actor.system.stats?.int?.value || 0;
    
    // Roll 1d10
    const roll = new Roll('1d10');
    await roll.evaluate();
    
    const dice = roll.total;
    const total = dice + skillLevel + int;
    const success = total >= dc;
    
    console.log(`${MODULE_ID} | Hack roll:`, { dice, skillLevel, int, total, dc, success });
    
    return {
      success,
      roll: total,
      dice,
      skill: skillLevel,
      stat: int,
      dc,
      rollObject: roll
    };
  }
  
  /**
   * Decrypt a data shard
   * @private
   */
  async _decrypt(item, actor) {
    // Mark as decrypted
    await item.setFlag(MODULE_ID, 'decrypted', true);
    await item.setFlag(MODULE_ID, 'decryptedBy', actor.id);
    await item.setFlag(MODULE_ID, 'decryptedAt', Date.now());
    
    // Also store in localStorage for this user
    const storageKey = `${MODULE_ID}-decrypted-${item.id}`;
    localStorage.setItem(storageKey, 'true');
    
    // Update all message pages to decrypted status
    const journal = await this._ensureJournal(item);
    for (const page of journal.pages.contents) {
      await page.setFlag(MODULE_ID, 'status.decrypted', true);
      await page.setFlag(MODULE_ID, 'status.encrypted', false);
    }
    
    // Emit event
    this.eventBus.emit(EVENTS.DATA_SHARD_DECRYPTED, { item, actor });
  }
  
  /**
   * Check if actor is locked out
   * @private
   */
  async _checkLockout(item, actor) {
    const lockoutUntil = item.getFlag(MODULE_ID, 'lockoutUntil');
    if (!lockoutUntil) return false;
    
    const now = Date.now();
    if (now < lockoutUntil) {
      const minutes = Math.ceil((lockoutUntil - now) / 1000 / 60);
      console.log(`${MODULE_ID} | Actor locked out for ${minutes} more minutes`);
      return true;
    }
    
    // Lockout expired, clear it
    await item.unsetFlag(MODULE_ID, 'lockoutUntil');
    await item.unsetFlag(MODULE_ID, 'failedAttempts');
    return false;
  }
  
  /**
   * Handle hack failure consequences
   * @private
   */
  async _handleHackFailure(item, actor, failureMode) {
    console.log(`${MODULE_ID} | Handling hack failure:`, failureMode);
    
    // Track failed attempts
    const failedAttempts = (item.getFlag(MODULE_ID, 'failedAttempts') || 0) + 1;
    await item.setFlag(MODULE_ID, 'failedAttempts', failedAttempts);
    
    switch (failureMode) {
      case 'lockout':
        // Lock out for 1 hour (game time)
        const lockoutDuration = 60 * 60 * 1000; // 1 hour in ms
        await item.setFlag(MODULE_ID, 'lockoutUntil', Date.now() + lockoutDuration);
        ui.notifications.error('System locked due to failed hack attempt');
        break;
        
      case 'traceback':
        // Alert the owner
        await this._sendTracebackAlert(item, actor);
        ui.notifications.warn('Traceback initiated - owner has been alerted');
        break;
        
      case 'damage':
        // Deal damage to actor
        await this._dealEMPDamage(actor, '1d6');
        ui.notifications.error('EMP feedback detected - taking damage!');
        break;
        
      case 'corrupt':
        // Corrupt some messages
        await this._corruptMessages(item, Math.floor(Math.random() * 3) + 1);
        ui.notifications.warn('System corruption detected');
        break;
    }
  }
  
  /**
   * Send traceback alert to owner
   * @private
   */
  async _sendTracebackAlert(item, hacker) {
    if (!item.actor) return;
    
    const messageData = {
      from: 'security@system.net',
      to: item.actor.getFlag(MODULE_ID, 'email') || 'unknown',
      subject: 'SECURITY ALERT: Unauthorized Access Attempt',
      content: `
        <p><strong>SECURITY BREACH DETECTED</strong></p>
        <p>Unauthorized access attempt on secure data.</p>
        <p><strong>Location:</strong> ${item.name}</p>
        <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
        <p><strong>Trace:</strong> ${hacker.name}</p>
      `
    };
    
    // Use MessageRepository to create the alert
    await this.messageRepository.create(messageData);
  }
  
  /**
   * Deal EMP damage
   * @private
   */
  async _dealEMPDamage(actor, formula) {
    const roll = new Roll(formula);
    await roll.evaluate();
    
    const currentHP = actor.system.hp?.value || 0;
    const newHP = Math.max(0, currentHP - roll.total);
    
    await actor.update({
      'system.hp.value': newHP
    });
    
    await ChatMessage.create({
      content: `
        <div class="ncm-emp-damage">
          <h3>⚡ EMP FEEDBACK</h3>
          <p><strong>${actor.name}</strong> takes <strong>${roll.total}</strong> damage from system feedback!</p>
        </div>
      `,
      speaker: ChatMessage.getSpeaker({ actor })
    });
  }
  
  /**
   * Corrupt random messages
   * @private
   */
  async _corruptMessages(item, count) {
    const journal = await this._ensureJournal(item);
    const pages = journal.pages.contents;
    
    if (pages.length === 0) return;
    
    for (let i = 0; i < Math.min(count, pages.length); i++) {
      const randomPage = pages[Math.floor(Math.random() * pages.length)];
      await randomPage.setFlag(MODULE_ID, 'status.corrupted', true);
    }
  }
  
  /**
   * Create hack attempt chat message
   * @private
   */
  async _createHackMessage(actor, item, success, result) {
    const content = `
      <div class="ncm-hack-attempt ${success ? 'success' : 'failure'}">
        <header>
          <i class="fas fa-${success ? 'unlock' : 'lock'}"></i>
          DATA SHARD ${success ? 'DECRYPTED' : 'HACK FAILED'}
        </header>
        <div class="ncm-hack-details">
          <div class="ncm-hacker">${actor.name}</div>
          <div class="ncm-target">${item.name}</div>
          <div class="ncm-roll-result">
            Roll: <strong>${result.roll}</strong> vs DV <strong>${result.dc}</strong>
            <br>
            <span class="ncm-roll-breakdown">
              (${result.stat} INT + ${result.skill} Interface + ${result.dice} d10)
            </span>
          </div>
        </div>
      </div>
    `;
    
    await ChatMessage.create({
      content,
      speaker: ChatMessage.getSpeaker({ actor }),
      type: CONST.CHAT_MESSAGE_TYPES.ROLL,
      sound: success ? 
        `modules/${MODULE_ID}/assets/sounds/hack-success.mp3` : 
        `modules/${MODULE_ID}/assets/sounds/hack-failure.mp3`
    });
  }
}