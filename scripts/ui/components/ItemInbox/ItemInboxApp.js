/**
 * Item Inbox Application
 * File: scripts/ui/components/ItemInbox/ItemInboxApp.js
 * Module: cyberpunkred-messenger
 * Description: View messages stored in items (data shards)
 */

import { MODULE_ID } from '../../../utils/constants.js';
import { BaseApplication } from '../BaseApplication.js';
import { EncryptionSystem } from './EncryptionSystem.js';
import { HackingSystem } from './HackingSystem.js';
import { MessageRepository } from '../../../data/MessageRepository.js';

export class ItemInboxApp extends BaseApplication {
  constructor(item, options = {}) {
    super(options);
    
    this.item = item;
    
    // Check if item is a data shard
    if (!this.item.getFlag(MODULE_ID, 'isDataShard')) {
      ui.notifications.error('This item is not configured as a data shard');
      throw new Error('Item is not a data shard');
    }
    
    // Systems
    this.encryptionSystem = new EncryptionSystem(this);
    this.hackingSystem = new HackingSystem(this);
    this.messageRepository = new MessageRepository();
    
    // Register components
    this.registerComponent('encryption', this.encryptionSystem);
    this.registerComponent('hacking', this.hackingSystem);
    
    // State
    this.selectedMessageId = null;
    
    // Load decryption status from localStorage
    this._loadDecryptionStatus();
  }
  
  /**
   * Default options
   */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["ncm-app", "ncm-item-inbox"],
      template: `modules/${MODULE_ID}/templates/item-inbox/item-inbox.hbs`,
      width: 800,
      height: 700,
      resizable: true,
      title: "Data Shard"
    });
  }
  
  /**
   * Get window title
   */
  get title() {
    return `Data Shard: ${this.item.name}`;
  }
  
  /**
   * Get data for template
   */
  getData(options = {}) {
    const data = super.getData(options);
    
    // Get item flags
    const flags = this.item.flags[MODULE_ID] || {};
    const encrypted = flags.encrypted || false;
    const encryptionDC = flags.encryptionDC || 15;
    const encryptionType = flags.encryptionType || 'ICE';
    
    // Get messages
    const messageIds = flags.messageIds || [];
    const messages = this._getMessages(messageIds);
    
    // Check encryption status
    const isFullyDecrypted = this.encryptionSystem.isFullyDecrypted(messages);
    const encryptionStatus = this.encryptionSystem.getEncryptionStatus(messages);
    
    // Get selected message
    const selectedMessage = messages.find(m => m.id === this.selectedMessageId);
    
    // Check if user can decrypt
    const canDecrypt = this._canUserDecrypt();
    
    return {
      ...data,
      item: this.item,
      
      // Encryption
      encrypted,
      encryptionDC,
      encryptionType,
      isFullyDecrypted,
      encryptionStatus,
      canDecrypt,
      
      // Messages
      messages,
      hasMessages: messages.length > 0,
      messageCount: messages.length,
      selectedMessage,
      
      // User info
      isGM: game.user.isGM,
      actorName: game.user.character?.name || game.user.name
    };
  }
  
  /**
   * Select a message
   * @param {string} messageId - Message ID
   */
  selectMessage(messageId) {
    this.selectedMessageId = messageId;
    this.render(false);
  }
  
  /**
   * Attempt to decrypt the data shard
   */
  async attemptDecryption() {
    const actor = game.user.character;
    
    if (!actor) {
      ui.notifications.error('You need a character to attempt decryption');
      return;
    }
    
    // Check if already decrypted
    if (this.encryptionSystem.isGloballyDecrypted()) {
      ui.notifications.info('Data shard is already decrypted');
      return;
    }
    
    // Get encryption DC
    const dc = this.item.getFlag(MODULE_ID, 'encryptionDC') || 15;
    
    // Attempt hack
    const result = await this.hackingSystem.attemptHack(actor, dc);
    
    if (result.success) {
      // Decrypt globally
      await this.item.setFlag(MODULE_ID, 'encrypted', false);
      
      // Mark all messages as decrypted
      await this._decryptAllMessages();
      
      // Create success chat message
      await this._createHackChatMessage(actor, result, true);
      
      ui.notifications.info('Data shard decrypted successfully!');
      this.render(false);
    } else {
      // Create failure chat message
      await this._createHackChatMessage(actor, result, false);
      
      ui.notifications.error('Decryption failed!');
      
      // Check for BLACK ICE
      if (result.blackICE) {
        ui.notifications.error(`BLACK ICE triggered! ${result.damage} damage!`);
      }
    }
  }
  
  /**
   * GM force decrypt
   */
  async forceDecrypt() {
    if (!game.user.isGM) return;
    
    const confirmed = await Dialog.confirm({
      title: 'Force Decrypt',
      content: '<p>Bypass all encryption and reveal all messages?</p>',
      yes: () => true,
      no: () => false
    });
    
    if (!confirmed) return;
    
    // Decrypt
    await this.item.setFlag(MODULE_ID, 'encrypted', false);
    await this._decryptAllMessages();
    
    ui.notifications.info('Data shard force decrypted');
    this.render(false);
  }
  
  /**
   * Export message to character inbox
   * @param {string} messageId - Message ID
   */
  async exportMessage(messageId) {
    const actor = game.user.character;
    
    if (!actor) {
      ui.notifications.error('You need a character to export messages');
      return;
    }
    
    try {
      // Get message data
      const messageData = this._getMessageById(messageId);
      if (!messageData) {
        throw new Error('Message not found');
      }
      
      // Create message in character's inbox
      await this.messageRepository.create({
        to: `${actor.name.toLowerCase().replace(/\s+/g, '')}@nightcity.net`,
        from: messageData.from || 'unknown@datashard.net',
        subject: messageData.subject,
        content: messageData.content,
        timestamp: new Date().toISOString()
      });
      
      ui.notifications.info('Message exported to your inbox');
    } catch (error) {
      console.error(`${MODULE_ID} | Error exporting message:`, error);
      ui.notifications.error('Failed to export message');
    }
  }
  
  /**
   * Share message to chat
   * @param {string} messageId - Message ID
   */
  async shareToChat(messageId) {
    const messageData = this._getMessageById(messageId);
    if (!messageData) return;
    
    // Check if decrypted
    if (messageData.isEncrypted && !messageData.isDecrypted) {
      ui.notifications.warn('Cannot share encrypted message');
      return;
    }
    
    // Create chat message
    const chatContent = await renderTemplate(
      `modules/${MODULE_ID}/templates/item-inbox/message-shared.hbs`,
      {
        message: messageData,
        itemName: this.item.name,
        sharedBy: game.user.name
      }
    );
    
    await ChatMessage.create({
      content: chatContent,
      speaker: ChatMessage.getSpeaker({ actor: game.user.character }),
      type: CONST.CHAT_MESSAGE_TYPES.IC,
      flags: {
        [MODULE_ID]: {
          type: 'shared-datashard-message',
          itemId: this.item.id,
          messageId: messageId
        }
      }
    });
    
    ui.notifications.info('Message shared to chat');
  }
  
  /**
   * Open item configuration
   */
  openConfiguration() {
    const { ItemInboxConfig } = require('./ItemInboxConfig.js');
    new ItemInboxConfig(this.item).render(true);
  }
  
  /**
   * Activate listeners
   */
  activateListeners(html) {
    super.activateListeners(html);
    
    // Message selection
    html.find('.ncm-inbox-message-item').on('click', (event) => {
      const messageId = $(event.currentTarget).data('message-id');
      this.selectMessage(messageId);
      this.playSound('click');
    });
    
    // Decrypt button
    html.find('.ncm-inbox__decrypt-btn').on('click', () => {
      this.attemptDecryption();
      this.playSound('click');
    });
    
    // Force decrypt (GM only)
    html.find('.ncm-inbox__force-decrypt-btn').on('click', () => {
      this.forceDecrypt();
      this.playSound('click');
    });
    
    // Export message
    html.find('.ncm-inbox__export-btn').on('click', () => {
      if (this.selectedMessageId) {
        this.exportMessage(this.selectedMessageId);
        this.playSound('click');
      }
    });
    
    // Share to chat
    html.find('.ncm-inbox__share-btn').on('click', () => {
      if (this.selectedMessageId) {
        this.shareToChat(this.selectedMessageId);
        this.playSound('click');
      }
    });
    
    // Configure button (GM only)
    html.find('.ncm-inbox__config-btn').on('click', () => {
      this.openConfiguration();
      this.playSound('click');
    });
  }
  
  /**
   * Lifecycle: First render
   */
  _onFirstRender() {
    console.log(`${MODULE_ID} | Item inbox opened: ${this.item.name}`);
    this.playSound('open');
  }
  
  // ========================================
  // Private Helper Methods
  // ========================================
  
  /**
   * Get messages from item
   * @private
   */
  _getMessages(messageIds) {
    const messages = [];
    const messagesData = this.item.getFlag(MODULE_ID, 'messages') || {};
    const globalEncrypted = this.item.getFlag(MODULE_ID, 'encrypted') || false;
    
    messageIds.forEach(id => {
      const msgData = messagesData[id];
      if (!msgData) return;
      
      // Check if message is encrypted
      const isEncrypted = msgData.encrypted !== undefined 
        ? msgData.encrypted 
        : globalEncrypted;
      
      // Check if decrypted
      const isDecrypted = this._isMessageDecrypted(id);
      
      messages.push({
        id,
        from: msgData.from || 'Unknown',
        subject: msgData.subject || 'No Subject',
        content: msgData.content || '',
        timestamp: msgData.timestamp || '',
        isEncrypted,
        isDecrypted,
        canView: !isEncrypted || isDecrypted || game.user.isGM
      });
    });
    
    return messages;
  }
  
  /**
   * Get message by ID
   * @private
   */
  _getMessageById(messageId) {
    const messagesData = this.item.getFlag(MODULE_ID, 'messages') || {};
    const msgData = messagesData[messageId];
    
    if (!msgData) return null;
    
    const globalEncrypted = this.item.getFlag(MODULE_ID, 'encrypted') || false;
    const isEncrypted = msgData.encrypted !== undefined 
      ? msgData.encrypted 
      : globalEncrypted;
    
    return {
      id: messageId,
      from: msgData.from || 'Unknown',
      subject: msgData.subject || 'No Subject',
      content: msgData.content || '',
      timestamp: msgData.timestamp || '',
      isEncrypted,
      isDecrypted: this._isMessageDecrypted(messageId)
    };
  }
  
  /**
   * Check if message is decrypted
   * @private
   */
  _isMessageDecrypted(messageId) {
    // Check localStorage for local decryption state
    const key = `${MODULE_ID}-decrypted-${this.item.id}-${messageId}`;
    return localStorage.getItem(key) === 'true';
  }
  
  /**
   * Load decryption status from localStorage
   * @private
   */
  _loadDecryptionStatus() {
    const messageIds = this.item.getFlag(MODULE_ID, 'messageIds') || [];
    
    messageIds.forEach(id => {
      const key = `${MODULE_ID}-decrypted-${this.item.id}-${id}`;
      const decrypted = localStorage.getItem(key) === 'true';
      
      if (decrypted) {
        console.log(`${MODULE_ID} | Message ${id} is decrypted`);
      }
    });
  }
  
  /**
   * Decrypt all messages
   * @private
   */
  async _decryptAllMessages() {
    const messageIds = this.item.getFlag(MODULE_ID, 'messageIds') || [];
    
    messageIds.forEach(id => {
      const key = `${MODULE_ID}-decrypted-${this.item.id}-${id}`;
      localStorage.setItem(key, 'true');
    });
  }
  
  /**
   * Check if user can decrypt
   * @private
   */
  _canUserDecrypt() {
    // GM can always decrypt
    if (game.user.isGM) return true;
    
    // Must have a character
    if (!game.user.character) return false;
    
    // Check if character has required skills/abilities
    // (In a full implementation, this would check actual character stats)
    return true;
  }
  
  /**
   * Create hack result chat message
   * @private
   */
  async _createHackChatMessage(actor, result, success) {
    const content = await renderTemplate(
      `modules/${MODULE_ID}/templates/item-inbox/hack-result.hbs`,
      {
        actor: actor,
        item: this.item,
        success: success,
        roll: result.roll,
        total: result.total,
        dc: result.dc,
        blackICE: result.blackICE,
        damage: result.damage
      }
    );
    
    await ChatMessage.create({
      content,
      speaker: ChatMessage.getSpeaker({ actor }),
      type: CONST.CHAT_MESSAGE_TYPES.ROLL,
      flags: {
        [MODULE_ID]: {
          type: 'hack-attempt',
          itemId: this.item.id,
          success: success
        }
      }
    });
  }
}