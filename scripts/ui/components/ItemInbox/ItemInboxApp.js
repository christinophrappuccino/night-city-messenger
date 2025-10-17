/**
 * Item Inbox Application (Fixed)
 * File: scripts/ui/components/ItemInbox/ItemInboxApp.js
 * Module: cyberpunkred-messenger
 * Description: View messages stored in items (data shards)
 */

import { MODULE_ID } from '../../../utils/constants.js';
import { BaseApplication } from '../BaseApplication.js';
import { DataShardService } from '../../../services/DataShardService.js';
import { EVENTS } from '../../../core/EventBus.js';

export class ItemInboxApp extends BaseApplication {
  constructor(item, options = {}) {
    super(options);
    
    this.item = item;
    
    // Check if item is a data shard
    if (!this.item.getFlag(MODULE_ID, 'isDataShard')) {
      ui.notifications.error('This item is not configured as a data shard');
      throw new Error('Item is not a data shard');
    }
    
    // Initialize service
    this.dataShardService = new DataShardService();
    
    // State
    this.selectedMessageId = null;
    this.messages = [];
    this.attemptingHack = false;
    
    // Load messages
    this._loadMessages();
    
    // Setup event listeners
    this._setupEvents();
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
      title: "Data Shard",
      tabs: []
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
  async getData(options = {}) {
    const data = await super.getData(options);
    
    // Get item flags
    const encrypted = this.item.getFlag(MODULE_ID, 'encrypted') || false;
    const encryptionDC = this.item.getFlag(MODULE_ID, 'encryptionDC') || 15;
    const encryptionType = this.item.getFlag(MODULE_ID, 'encryptionType') || 'ICE';
    const theme = this.item.getFlag(MODULE_ID, 'theme') || 'default';
    const dataShardType = this.item.getFlag(MODULE_ID, 'dataShardType') || 'single';
    
    // Check if decrypted
    const decrypted = this.item.getFlag(MODULE_ID, 'decrypted') || false;
    const locallyDecrypted = localStorage.getItem(`${MODULE_ID}-decrypted-${this.item.id}`) === 'true';
    const isDecrypted = decrypted || locallyDecrypted || !encrypted;
    
    // Check lockout
    const lockoutUntil = this.item.getFlag(MODULE_ID, 'lockoutUntil');
    const isLockedOut = lockoutUntil && Date.now() < lockoutUntil;
    const lockoutMinutes = isLockedOut ? Math.ceil((lockoutUntil - Date.now()) / 1000 / 60) : 0;
    
    // Get messages
    const messages = this.messages.map(msg => ({
      ...msg,
      isSelected: msg.id === this.selectedMessageId,
      canView: isDecrypted || game.user.isGM
    }));
    
    // Get selected message
    const selectedMessage = messages.find(m => m.id === this.selectedMessageId);
    
    // Check if user can attempt hack
    const canHack = game.user.character && !isDecrypted && !isLockedOut;
    
    // Show encrypted overlay?
    const showEncryptedOverlay = encrypted && !isDecrypted && !game.user.isGM;
    
    return {
      ...data,
      item: this.item,
      itemName: this.item.name,
      itemDescription: this.item.system.description || '',
      
      // Configuration
      encrypted,
      encryptionDC,
      encryptionType,
      theme,
      isSingleMode: dataShardType === 'single',
      
      // Status
      isDecrypted,
      isLockedOut,
      lockoutMinutes,
      canHack,
      showEncryptedOverlay,
      attemptingHack: this.attemptingHack,
      
      // Messages
      messages,
      messageCount: messages.length,
      selectedMessage,
      hasMessages: messages.length > 0,
      
      // Permissions
      isOwner: this.item.isOwner,
      isGM: game.user.isGM,
      canAddMessage: this.item.isOwner || game.user.isGM
    };
  }
  
  /**
   * Activate listeners
   */
  activateListeners(html) {
    super.activateListeners(html);
    
    // Message selection
    html.find('.ncm-message-item').click(this._onMessageSelect.bind(this));
    
    // Hack attempt
    html.find('.ncm-hack-button').click(this._onHackAttempt.bind(this));
    
    // Add message
    html.find('.ncm-add-message').click(this._onAddMessage.bind(this));
    
    // Share to chat
    html.find('.ncm-share-message').click(this._onShareMessage.bind(this));
    
    // Delete message
    html.find('.ncm-delete-message').click(this._onDeleteMessage.bind(this));
    
    // Configure
    html.find('.ncm-configure').click(this._onConfigure.bind(this));
  }
  
  // ========================================================================
  // EVENT HANDLERS
  // ========================================================================
  
  /**
   * Handle message selection
   * @private
   */
  async _onMessageSelect(event) {
    event.preventDefault();
    const messageId = $(event.currentTarget).data('message-id');
    
    this.selectedMessageId = messageId;
    this.render(false);
  }
  
  /**
   * Handle hack attempt
   * @private
   */
  async _onHackAttempt(event) {
    event.preventDefault();
    
    const actor = game.user.character;
    if (!actor) {
      ui.notifications.error('You must have a character selected to hack');
      return;
    }
    
    // Confirm the attempt
    const confirmed = await Dialog.confirm({
      title: "Attempt Hack",
      content: `
        <p>Attempt to decrypt this data shard?</p>
        <p><strong>Encryption:</strong> ${this.item.getFlag(MODULE_ID, 'encryptionType') || 'ICE'}</p>
        <p><strong>Difficulty:</strong> DV ${this.item.getFlag(MODULE_ID, 'encryptionDC') || 15}</p>
        <p><strong>Failure Mode:</strong> ${this.item.getFlag(MODULE_ID, 'failureMode') || 'Lockout'}</p>
      `
    });
    
    if (!confirmed) return;
    
    // Set state
    this.attemptingHack = true;
    this.render(false);
    
    try {
      // Attempt the hack
      const result = await this.dataShardService.attemptHack(this.item, actor);
      
      if (result.success) {
        // Success! Reload messages
        await this._loadMessages();
        ui.notifications.info('Data shard decrypted successfully!');
      } else {
        ui.notifications.error(`Hack failed: ${result.consequence || 'Access denied'}`);
      }
      
    } catch (error) {
      console.error(`${MODULE_ID} | Hack attempt error:`, error);
      ui.notifications.error('Hack attempt failed');
    } finally {
      this.attemptingHack = false;
      this.render(false);
    }
  }
  
  /**
   * Handle add message
   * @private
   */
  async _onAddMessage(event) {
    event.preventDefault();
    
    // Import and open the advanced composer
    const { DataShardMessageComposer } = await import('./DataShardMessageComposer.js');
    
    const composer = new DataShardMessageComposer(this.item, {
      // Pre-fill if needed
      from: game.user.character?.getFlag(MODULE_ID, 'email') || '',
      to: '',
      subject: '',
      content: ''
    });
    
    composer.render(true);
    
    // Listen for message added
    composer.once('close', async () => {
      // Reload messages
      await this._loadMessages();
      this.render(false);
    });
  }
  
  /**
   * Handle share message
   * @private
   */
  async _onShareMessage(event) {
    event.preventDefault();
    
    if (!this.selectedMessageId) {
      ui.notifications.warn('No message selected');
      return;
    }
    
    const message = this.messages.find(m => m.id === this.selectedMessageId);
    if (!message) return;
    
    // Share to chat
    await this._shareToChat(message);
  }
  
  /**
   * Handle delete message
   * @private
   */
  async _onDeleteMessage(event) {
    event.preventDefault();
    
    if (!this.selectedMessageId) {
      ui.notifications.warn('No message selected');
      return;
    }
    
    const confirmed = await Dialog.confirm({
      title: "Delete Message",
      content: "<p>Are you sure you want to delete this message?</p>"
    });
    
    if (!confirmed) return;
    
    try {
      const message = this.messages.find(m => m.id === this.selectedMessageId);
      if (message && message.page) {
        await message.page.delete();
        await this._loadMessages();
        this.selectedMessageId = null;
        this.render(false);
        ui.notifications.info('Message deleted');
      }
    } catch (error) {
      console.error(`${MODULE_ID} | Error deleting message:`, error);
      ui.notifications.error('Failed to delete message');
    }
  }
  
  /**
   * Handle configure
   * @private
   */
  async _onConfigure(event) {
    event.preventDefault();
    
    // Import and open config dialog
    const { ItemInboxConfig } = await import('./ItemInboxConfig.js');
    new ItemInboxConfig(this.item, { parent: this }).render(true);
  }
  
  // ========================================================================
  // HELPER METHODS
  // ========================================================================
  
  /**
   * Load messages from data shard
   * @private
   */
  async _loadMessages() {
    try {
      this.messages = await this.dataShardService.getMessages(this.item);
      
      // Auto-select first message in single mode
      const dataShardType = this.item.getFlag(MODULE_ID, 'dataShardType') || 'single';
      if (dataShardType === 'single' && this.messages.length > 0 && !this.selectedMessageId) {
        this.selectedMessageId = this.messages[0].id;
      }
      
    } catch (error) {
      console.error(`${MODULE_ID} | Error loading messages:`, error);
      this.messages = [];
    }
  }
  
  /**
   * Prompt for message data
   * @private
   */
  async _promptMessageData() {
    return new Promise((resolve) => {
      new Dialog({
        title: "Add Message",
        content: `
          <form>
            <div class="form-group">
              <label>From:</label>
              <input type="text" name="from" value="Unknown" />
            </div>
            <div class="form-group">
              <label>To:</label>
              <input type="text" name="to" value="Unknown" />
            </div>
            <div class="form-group">
              <label>Subject:</label>
              <input type="text" name="subject" value="No Subject" />
            </div>
            <div class="form-group">
              <label>Content:</label>
              <textarea name="content" rows="8" style="width: 100%; font-family: monospace;"></textarea>
            </div>
          </form>
        `,
        buttons: {
          add: {
            icon: '<i class="fas fa-plus"></i>',
            label: "Add",
            callback: (html) => {
              const form = html.find('form')[0];
              const formData = new FormDataExtended(form).object;
              resolve({
                from: formData.from,
                to: formData.to,
                subject: formData.subject,
                content: formData.content,
                date: new Date().toISOString()
              });
            }
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: "Cancel",
            callback: () => resolve(null)
          }
        },
        default: "add"
      }).render(true);
    });
  }
  
  /**
   * Share message to chat
   * @private
   */
  async _shareToChat(message) {
    const content = `
      <div class="ncm-shared-data-shard-message">
        <header>
          <i class="fas fa-microchip"></i>
          DATA SHARD CONTENTS
        </header>
        <div class="ncm-message-info">
          <div class="ncm-shard-name">${this.item.name}</div>
          <div class="ncm-message-subject">${message.messageData.subject}</div>
        </div>
        <div class="ncm-message-meta">
          <span>FROM: ${message.messageData.from}</span>
          <span>TO: ${message.messageData.to}</span>
          <span>DATE: ${message.messageData.date}</span>
        </div>
        <div class="ncm-message-content">
          ${message.content}
        </div>
        <div class="ncm-message-actions">
          <button class="ncm-view-data-shard" data-item-id="${this.item.id}" data-message-id="${message.id}">
            <i class="fas fa-eye"></i> View Data Shard
          </button>
        </div>
      </div>
    `;
    
    await ChatMessage.create({
      content,
      speaker: ChatMessage.getSpeaker(),
      flags: {
        [MODULE_ID]: {
          sharedDataShard: true,
          itemId: this.item.id,
          messageId: message.id
        }
      }
    });
    
    ui.notifications.info('Message shared to chat');
  }
  
  /**
   * Setup event listeners
   * @private
   */
  _setupEvents() {
    // Listen for data shard updates
    this.eventBus.on(EVENTS.DATA_SHARD_MESSAGE_ADDED, async (data) => {
      if (data.item.id === this.item.id) {
        await this._loadMessages();
        this.render(false);
      }
    });
    
    this.eventBus.on(EVENTS.DATA_SHARD_DECRYPTED, async (data) => {
      if (data.item.id === this.item.id) {
        await this._loadMessages();
        this.render(false);
      }
    });
  }
  
  /**
   * Close handler
   */
  async close(options = {}) {
    // Cleanup
    this.eventBus.off(EVENTS.DATA_SHARD_MESSAGE_ADDED);
    this.eventBus.off(EVENTS.DATA_SHARD_DECRYPTED);
    
    return super.close(options);
  }
}