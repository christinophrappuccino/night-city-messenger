/**
 * Data Shard Service
 * File: scripts/services/DataShardService.js
 * Module: cyberpunkred-messenger
 * Description: Core business logic for data shard operations with flexible skill checks
 */

import { MODULE_ID, ENCRYPTION_TYPES, DEFAULTS } from '../utils/constants.js';
import { EVENTS } from '../core/EventBus.js';
import { SkillService } from './SkillService.js';

export class DataShardService {
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.skillService = new SkillService();
    
    console.log(`${MODULE_ID} | DataShardService initialized`);
  }
  
  /**
   * Convert an item to a data shard
   * @param {Item} item - The item to convert
   * @param {Object} options - Configuration options
   */
  async convertToDataShard(item, options = {}) {
    const {
      encrypted = false,
      encryptionType = DEFAULTS.ENCRYPTION_TYPE,
      encryptionDC = DEFAULTS.ENCRYPTION_DC,
      allowedSkills = DEFAULTS.ALLOWED_SKILLS,
      failureMode = DEFAULTS.FAILURE_MODE,
      singleMessage = false,
      theme = DEFAULTS.THEME,
      requiresNetwork = false,
      requiredNetwork = null
    } = options;
    
    console.log(`${MODULE_ID} | Converting ${item.name} to data shard`);
    
    await item.setFlag(MODULE_ID, 'isDataShard', true);
    await item.setFlag(MODULE_ID, 'encrypted', encrypted);
    await item.setFlag(MODULE_ID, 'encryptionType', encryptionType);
    await item.setFlag(MODULE_ID, 'encryptionDC', encryptionDC);
    await item.setFlag(MODULE_ID, 'allowedSkills', allowedSkills);
    await item.setFlag(MODULE_ID, 'failureMode', failureMode);
    await item.setFlag(MODULE_ID, 'singleMessage', singleMessage);
    await item.setFlag(MODULE_ID, 'theme', theme);
    await item.setFlag(MODULE_ID, 'requiresNetwork', requiresNetwork);
    await item.setFlag(MODULE_ID, 'requiredNetwork', requiredNetwork);
    await item.setFlag(MODULE_ID, 'hackAttempts', 0);
    await item.setFlag(MODULE_ID, 'maxHackAttempts', DEFAULTS.MAX_HACK_ATTEMPTS);
    
    this.eventBus.emit(EVENTS.DATA_SHARD_OPENED, { item });
    
    ui.notifications.info(`${item.name} converted to data shard`);
  }
  
  /**
   * Add a message to a data shard
   * @param {Item} item - The data shard item
   * @param {Object} messageData - Message data
   */
  async addMessage(item, messageData) {
    console.log(`${MODULE_ID} | Adding message to ${item.name}:`, messageData);
    
    // Validate
    if (!item.getFlag(MODULE_ID, 'isDataShard')) {
      throw new Error('Item is not a data shard');
    }
    
    const singleMessage = item.getFlag(MODULE_ID, 'singleMessage');
    
    // Get or create journal
    const journal = await this._ensureJournal(item);
    
    // If single message mode, delete existing
    if (singleMessage && journal.pages.size > 0) {
      for (const page of journal.pages.contents) {
        await page.delete();
      }
    }
    
    // Check encryption mode
    const encryptionMode = item.getFlag(MODULE_ID, 'encryptionMode') || 'shard';
    const shardEncrypted = item.getFlag(MODULE_ID, 'encrypted');
    
    // Determine if this message is encrypted
    let messageEncrypted = false;
    let encryptionType = 'ICE';
    let encryptionDC = 15;
    let allowedSkills = ['Interface', 'Electronics/Security Tech'];
    
    if (encryptionMode === 'message' || encryptionMode === 'both') {
      // Per-message encryption
      messageEncrypted = messageData.encrypted || false;
      if (messageEncrypted) {
        encryptionType = messageData.encryptionType || 'ICE';
        encryptionDC = messageData.encryptionDC || 15;
        allowedSkills = messageData.allowedSkills || ['Interface', 'Electronics/Security Tech'];
      }
    } else if (encryptionMode === 'shard') {
      // Shard-level encryption (all messages inherit)
      messageEncrypted = shardEncrypted;
      if (messageEncrypted) {
        encryptionType = item.getFlag(MODULE_ID, 'encryptionType') || 'ICE';
        encryptionDC = item.getFlag(MODULE_ID, 'encryptionDC') || 15;
        allowedSkills = item.getFlag(MODULE_ID, 'allowedSkills') || ['Interface', 'Electronics/Security Tech'];
      }
    }
    
    // Get content
    const content = messageData.content || messageData.body || '';
    const timestamp = Date.now();
    
    console.log(`${MODULE_ID} | Creating page:`, {
      encrypted: messageEncrypted,
      encryptionType,
      encryptionDC,
      contentLength: content.length
    });
    
    const pageData = {
      name: messageData.subject || 'Untitled Message',
      type: 'text',
      text: {
        content: content,
        format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML
      },
      flags: {
        [MODULE_ID]: {
          messageId: foundry.utils.randomID(),
          from: messageData.from || 'unknown@nightcity.net',
          to: messageData.to || 'unknown@nightcity.net',
          subject: messageData.subject || 'No Subject',
          timestamp,
          status: {
            read: false,
            encrypted: messageEncrypted,
            decrypted: !messageEncrypted,
            saved: false
          },
          // NEW: Per-message encryption settings
          encryption: messageEncrypted ? {
            type: encryptionType,
            dc: encryptionDC,
            allowedSkills: allowedSkills,
            decryptedBy: null,
            decryptedAt: null,
            hackAttempts: 0
          } : null
        }
      }
    };
    
    const created = await journal.createEmbeddedDocuments('JournalEntryPage', [pageData]);
    
    console.log(`${MODULE_ID} | Created page:`, created[0].id);
    
    this.eventBus.emit(EVENTS.DATA_SHARD_MESSAGE_ADDED, { item, message: pageData });
    
    ui.notifications.info('Message added to data shard');
  }

  
  /**
   * Get all messages from a data shard
   * @param {Item} item - The data shard
   * @returns {Array} Array of message objects
   */
  async getMessages(item) {
    const journal = await this._findJournal(item);
    if (!journal) return [];
    
    const messages = [];
    for (const page of journal.pages.contents) {
      const flags = page.flags[MODULE_ID];
      if (flags) {
        // Get content
        let content = '';
        if (page.text) {
          content = page.text.content || page.text.markdown || '';
        }
        
        // Check if message is encrypted
        const isEncrypted = flags.status?.encrypted || false;
        const isDecrypted = flags.status?.decrypted || false;
        
        console.log(`${MODULE_ID} | Loading message:`, {
          id: page.id,
          subject: flags.subject,
          encrypted: isEncrypted,
          decrypted: isDecrypted,
          hasContent: !!content,
          contentLength: content.length
        });
        
        messages.push({
          id: page.id,
          pageId: page.id,
          page: page,
          content: content,
          body: content,
          messageData: {
            from: flags.from || 'unknown@nightcity.net',
            to: flags.to || 'unknown@nightcity.net',
            subject: flags.subject || 'No Subject',
            timestamp: flags.timestamp || Date.now(),
            date: flags.timestamp ? new Date(flags.timestamp).toLocaleString() : 'Unknown',
            encrypted: isEncrypted,
            decrypted: isDecrypted,
            ...flags.status
          },
          // NEW: Per-message encryption info
          encryption: flags.encryption || null
        });
      }
    }
    
    // Sort by timestamp (newest first)
    messages.sort((a, b) => 
      (b.messageData.timestamp || 0) - (a.messageData.timestamp || 0)
    );
    
    console.log(`${MODULE_ID} | Loaded ${messages.length} messages from ${item.name}`);
    
    return messages;
  }

  /**
   * Attempt to decrypt a message (NEW)
   * @param {JournalEntryPage} page - The message page
   * @param {Actor} actor - Actor attempting the hack
   * @returns {Promise<Object>} Result object
   */
  async attemptMessageDecrypt(page, actor) {
    const flags = page.flags[MODULE_ID];
    if (!flags) {
      throw new Error('Invalid message page');
    }
    
    const encryption = flags.encryption;
    if (!encryption) {
      return { success: true, alreadyDecrypted: true };
    }
    
    // Check if already decrypted
    if (flags.status?.decrypted) {
      return { success: true, alreadyDecrypted: true };
    }
    
    console.log(`${MODULE_ID} | Attempting to decrypt message: ${flags.subject}`);
    
    // Perform skill check
    const checkResult = await this.skillService.performCheck({
      actor,
      skills: encryption.allowedSkills,
      dc: encryption.dc,
      taskName: `Decrypting: ${flags.subject}`,
      allowLuck: true,
      autoRoll: false
    });
    
    // Handle cancellation
    if (checkResult.cancelled) {
      return { success: false, cancelled: true };
    }
    
    // Increment attempts
    encryption.hackAttempts = (encryption.hackAttempts || 0) + 1;
    await page.setFlag(MODULE_ID, 'encryption.hackAttempts', encryption.hackAttempts);
    
    // Success!
    if (checkResult.success) {
      await page.setFlag(MODULE_ID, 'status.decrypted', true);
      await page.setFlag(MODULE_ID, 'status.encrypted', false);
      await page.setFlag(MODULE_ID, 'encryption.decryptedBy', actor.id);
      await page.setFlag(MODULE_ID, 'encryption.decryptedAt', Date.now());
      
      ui.notifications.info('Message decrypted successfully!');
      
      return {
        success: true,
        ...checkResult
      };
    }
    
    // Failure - handle BLACK ICE if applicable
    if (encryption.type === 'BLACK_ICE' || encryption.type === 'RED_ICE') {
      const diceFormula = encryption.type === 'RED_ICE' ? '5d6' : '3d6';
      const damageRoll = new Roll(diceFormula);
      await damageRoll.evaluate();
      
      const damage = damageRoll.total;
      await this._applyDamage(actor, damage, damageRoll);
      
      return {
        success: false,
        ...checkResult,
        blackICE: true,
        damage
      };
    }
    
    ui.notifications.error('Failed to decrypt message');
    
    return {
      success: false,
      ...checkResult
    };
  }
  
  /**
   * Attempt to hack/decrypt a data shard
   * @param {Item} item - The data shard
   * @param {Actor} actor - Actor attempting the hack
   * @param {Object} options - Hack options
   * @returns {Promise<Object>} Result object
   */
  async attemptHack(item, actor, options = {}) {
    console.log(`${MODULE_ID} | Hack attempt on ${item.name} by ${actor.name}`);
    
    // GM override
    if (game.user.isGM && options.gmOverride) {
      console.log(`${MODULE_ID} | GM override - bypassing security`);
      await this._decrypt(item, actor);
      return { success: true, gmOverride: true };
    }
    
    // Check if already decrypted
    if (await this.isDecrypted(item)) {
      ui.notifications.info('Data shard already decrypted');
      return { success: true, alreadyDecrypted: true };
    }
    
    // Check if locked out
    if (await this._isLockedOut(item)) {
      const lockoutEnd = item.getFlag(MODULE_ID, 'lockoutUntil');
      const remaining = Math.ceil((lockoutEnd - Date.now()) / 60000);
      ui.notifications.warn(`Data shard locked out for ${remaining} more minutes`);
      return { success: false, lockedOut: true, remaining };
    }
    
    // Get configuration
    const dc = item.getFlag(MODULE_ID, 'encryptionDC') || DEFAULTS.ENCRYPTION_DC;
    const allowedSkills = item.getFlag(MODULE_ID, 'allowedSkills') || DEFAULTS.ALLOWED_SKILLS;
    const encryptionType = item.getFlag(MODULE_ID, 'encryptionType') || ENCRYPTION_TYPES.ICE;
    const failureMode = item.getFlag(MODULE_ID, 'failureMode') || DEFAULTS.FAILURE_MODE;
    
    // Perform skill check using SkillService
    const checkResult = await this.skillService.performCheck({
      actor,
      skills: allowedSkills, // Will try skills in order
      dc,
      taskName: `Hacking ${item.name}`,
      allowLuck: true,
      autoRoll: false
    });
    
    // Handle cancellation
    if (checkResult.cancelled) {
      return { success: false, cancelled: true };
    }
    
    // Increment attempts
    const currentAttempts = item.getFlag(MODULE_ID, 'hackAttempts') || 0;
    await item.setFlag(MODULE_ID, 'hackAttempts', currentAttempts + 1);
    
    // Success!
    if (checkResult.success) {
      await this._decrypt(item, actor);
      
      this.eventBus.emit(EVENTS.DATA_SHARD_HACK_ATTEMPT, { 
        item, 
        actor, 
        success: true,
        result: checkResult
      });
      
      ui.notifications.info(`Successfully hacked ${item.name}!`);
      
      return {
        success: true,
        ...checkResult
      };
    }
    
    // Failure - handle consequences
    console.log(`${MODULE_ID} | Hack failed - applying consequences`);
    
    const failureResult = await this._handleHackFailure(
      item,
      actor,
      encryptionType,
      failureMode,
      currentAttempts + 1
    );
    
    this.eventBus.emit(EVENTS.DATA_SHARD_HACK_ATTEMPT, { 
      item, 
      actor, 
      success: false,
      result: checkResult,
      failure: failureResult
    });
    
    return {
      success: false,
      ...checkResult,
      ...failureResult
    };
  }
  
  /**
   * Handle hack failure consequences
   * @private
   */
  async _handleHackFailure(item, actor, encryptionType, failureMode, attemptCount) {
    const result = {
      consequence: null,
      damage: 0,
      locked: false
    };
    
    // BLACK ICE damage
    if (encryptionType === ENCRYPTION_TYPES.BLACK_ICE || 
        encryptionType === ENCRYPTION_TYPES.RED_ICE) {
      
      const diceFormula = encryptionType === ENCRYPTION_TYPES.RED_ICE ? '5d6' : '3d6';
      const damageRoll = new Roll(diceFormula);
      await damageRoll.evaluate();
      
      result.damage = damageRoll.total;
      result.consequence = 'BLACK ICE';
      
      // Apply damage
      await this._applyDamage(actor, result.damage, damageRoll);
      
      this.eventBus.emit(EVENTS.BLACK_ICE_TRIGGERED, { 
        item, 
        actor, 
        damage: result.damage 
      });
    }
    
    // Handle failure mode
    const maxAttempts = item.getFlag(MODULE_ID, 'maxHackAttempts') || DEFAULTS.MAX_HACK_ATTEMPTS;
    
    switch (failureMode) {
      case 'lockout':
        if (attemptCount >= maxAttempts) {
          const lockoutUntil = Date.now() + DEFAULTS.LOCKOUT_DURATION;
          await item.setFlag(MODULE_ID, 'lockoutUntil', lockoutUntil);
          await item.setFlag(MODULE_ID, 'hackAttempts', 0);
          result.locked = true;
          result.consequence = result.consequence || 'LOCKOUT';
          ui.notifications.warn(`${item.name} locked for 1 hour!`);
        }
        break;
        
      case 'permanent':
        if (attemptCount >= maxAttempts) {
          await item.setFlag(MODULE_ID, 'permanentlyLocked', true);
          result.locked = true;
          result.consequence = result.consequence || 'PERMANENT_LOCK';
          ui.notifications.error(`${item.name} permanently locked!`);
        }
        break;
        
      case 'destroy':
        if (attemptCount >= maxAttempts) {
          await this._destroyMessages(item);
          result.consequence = result.consequence || 'DATA_DESTROYED';
          ui.notifications.error(`Data on ${item.name} destroyed!`);
        }
        break;
        
      case 'nothing':
      default:
        // Just stay locked, can retry
        result.consequence = result.consequence || 'RETRY_ALLOWED';
        break;
    }
    
    return result;
  }
  
  /**
   * Apply damage to actor
   * @private
   */
  async _applyDamage(actor, damage, damageRoll) {
    console.log(`${MODULE_ID} | Applying ${damage} BLACK ICE damage to ${actor.name}`);
    
    // For Cyberpunk RED system
    if (game.system.id === 'cyberpunk-red-core') {
      const currentHP = actor.system?.derivedStats?.hp?.value || 0;
      const newHP = Math.max(0, currentHP - damage);
      
      await actor.update({
        'system.derivedStats.hp.value': newHP
      });
      
      // Create dramatic damage chat message
      await ChatMessage.create({
        content: `
          <div class="ncm-black-ice-damage" style="
            background: linear-gradient(135deg, #330000 0%, #000000 100%);
            border: 2px solid #ff0000;
            padding: 15px;
            border-radius: 8px;
            box-shadow: 0 0 20px rgba(255, 0, 0, 0.5);
          ">
            <h3 style="color: #ff0000; margin: 0 0 10px 0; text-shadow: 0 0 10px #ff0000;">
              ⚡ BLACK ICE TRIGGERED ⚡
            </h3>
            <p style="color: #ffffff; font-size: 1.1em; margin: 5px 0;">
              <strong>${actor.name}</strong> takes <strong style="color: #ff0000;">${damage}</strong> damage!
            </p>
            <p style="color: #cccccc; margin: 5px 0;">
              HP: ${currentHP} → <strong style="color: ${newHP === 0 ? '#ff0000' : '#ffffff'};">${newHP}</strong>
            </p>
            ${newHP === 0 ? `
              <p style="color: #ff0000; font-weight: bold; margin: 10px 0 0 0;">
                💀 FLATLINED! 💀
              </p>
            ` : ''}
          </div>
        `,
        speaker: ChatMessage.getSpeaker({ actor })
      });
      
      // Show dice roll
      await damageRoll.toMessage({
        flavor: `<strong style="color: #ff0000;">⚡ BLACK ICE DAMAGE ⚡</strong>`,
        speaker: ChatMessage.getSpeaker({ actor })
      });
      
    } else {
      // Generic system - just notify
      ui.notifications.error(`${actor.name} would take ${damage} BLACK ICE damage!`);
    }
  }
  
  /**
   * Decrypt a data shard
   * @private
   */
  async _decrypt(item, actor) {
    await item.setFlag(MODULE_ID, 'decrypted', true);
    await item.setFlag(MODULE_ID, 'decryptedBy', actor.id);
    await item.setFlag(MODULE_ID, 'decryptedAt', Date.now());
    await item.setFlag(MODULE_ID, 'hackAttempts', 0);
    
    // Store in localStorage for this user
    const storageKey = `${MODULE_ID}-decrypted-${item.id}`;
    localStorage.setItem(storageKey, 'true');
    
    // Update message pages
    const journal = await this._ensureJournal(item);
    for (const page of journal.pages.contents) {
      await page.setFlag(MODULE_ID, 'status.decrypted', true);
      await page.setFlag(MODULE_ID, 'status.encrypted', false);
    }
    
    this.eventBus.emit(EVENTS.DATA_SHARD_DECRYPTED, { item, actor });
  }
  
  /**
   * Check if data shard is decrypted
   */
  async isDecrypted(item) {
    // Check flag
    if (item.getFlag(MODULE_ID, 'decrypted')) {
      return true;
    }
    
    // Check localStorage (persists across sessions for this user)
    const storageKey = `${MODULE_ID}-decrypted-${item.id}`;
    if (localStorage.getItem(storageKey) === 'true') {
      return true;
    }
    
    // Not encrypted in the first place
    if (!item.getFlag(MODULE_ID, 'encrypted')) {
      return true;
    }
    
    return false;
  }
  
  /**
   * Check if locked out
   * @private
   */
  async _isLockedOut(item) {
    // Check permanent lock
    if (item.getFlag(MODULE_ID, 'permanentlyLocked')) {
      return true;
    }
    
    // Check temporary lockout
    const lockoutUntil = item.getFlag(MODULE_ID, 'lockoutUntil');
    if (lockoutUntil && Date.now() < lockoutUntil) {
      return true;
    }
    
    // Clear expired lockout
    if (lockoutUntil && Date.now() >= lockoutUntil) {
      await item.setFlag(MODULE_ID, 'lockoutUntil', null);
      await item.setFlag(MODULE_ID, 'hackAttempts', 0);
    }
    
    return false;
  }
  
  /**
   * Destroy messages (failure consequence)
   * @private
   */
  async _destroyMessages(item) {
    const journal = await this._findJournal(item);
    if (journal) {
      for (const page of journal.pages.contents) {
        await page.delete();
      }
    }
    
    await item.setFlag(MODULE_ID, 'dataDestroyed', true);
  }
  
  /**
   * Delete a message
   */
  async deleteMessage(item, messageId) {
    const journal = await this._findJournal(item);
    if (!journal) return;
    
    const page = journal.pages.get(messageId);
    if (page) {
      await page.delete();
      this.eventBus.emit(EVENTS.MESSAGE_DELETED, { item, messageId });
    }
  }
  
  /**
   * Get available skills for this data shard
   * @param {Item} item - The data shard
   * @param {Actor} actor - The actor
   * @returns {Array} Array of available skill objects
   */
  getAvailableSkills(item, actor) {
    const allowedSkills = item.getFlag(MODULE_ID, 'allowedSkills') || DEFAULTS.ALLOWED_SKILLS;
    const allActorSkills = this.skillService.getAvailableSkills(actor);
    
    // Filter to only allowed skills
    return allActorSkills.filter(skill => {
      return allowedSkills.some(allowed => {
        const normalized = allowed.toLowerCase().replace(/[^a-z0-9]/g, '');
        const skillNormalized = skill.displayName.toLowerCase().replace(/[^a-z0-9]/g, '');
        return normalized === skillNormalized;
      });
    });
  }
  
  /**
   * Ensure journal exists for item
   * @private
   */
  async _ensureJournal(item) {
    let journal = await this._findJournal(item);
    
    if (!journal) {
      journal = await JournalEntry.create({
        name: `${item.name} - Data`,
        flags: {
          [MODULE_ID]: {
            isDataShardJournal: true,
            itemId: item.id
          }
        }
      });
      
      await item.setFlag(MODULE_ID, 'journalId', journal.id);
    }
    
    return journal;
  }
  
  /**
   * Find journal for item
   * @private
   */
  async _findJournal(item) {
    const journalId = item.getFlag(MODULE_ID, 'journalId');
    if (journalId) {
      return game.journal.get(journalId);
    }
    
    // Fallback: search by flag
    return game.journal.find(j => 
      j.getFlag(MODULE_ID, 'itemId') === item.id
    );
  }
}