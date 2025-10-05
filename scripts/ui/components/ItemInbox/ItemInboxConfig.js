/**
 * Item Inbox Configuration
 * File: scripts/ui/components/ItemInbox/ItemInboxConfig.js
 * Module: cyberpunkred-messenger
 * Description: Configure items as data shards
 */

import { MODULE_ID } from '../../../utils/constants.js';

export class ItemInboxConfig extends FormApplication {
  constructor(item, options = {}) {
    super(item, options);
    this.item = item;
  }
  
  /**
   * Default options
   */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["ncm-app", "ncm-item-config"],
      template: `modules/${MODULE_ID}/templates/item-inbox/item-config.hbs`,
      width: 500,
      height: 600,
      resizable: true,
      title: "Data Shard Configuration",
      closeOnSubmit: true,
      submitOnChange: false
    });
  }
  
  /**
   * Get data for template
   */
  getData(options = {}) {
    const data = super.getData(options);
    
    // Get current flags
    const flags = this.item.flags[MODULE_ID] || {};
    
    return {
      ...data,
      item: this.item,
      isDataShard: flags.isDataShard || false,
      encrypted: flags.encrypted || false,
      encryptionDC: flags.encryptionDC || 15,
      encryptionType: flags.encryptionType || 'ICE',
      messages: this._getMessagesArray(flags),
      encryptionTypes: [
        { value: 'ICE', label: 'Standard ICE' },
        { value: 'BLACK_ICE', label: 'BLACK ICE (Dangerous)' },
        { value: 'RED_ICE', label: 'RED ICE (Lethal)' },
        { value: 'CUSTOM', label: 'Custom' }
      ]
    };
  }
  
  /**
   * Activate listeners
   */
  activateListeners(html) {
    super.activateListeners(html);
    
    // Toggle data shard
    html.find('[name="isDataShard"]').on('change', (event) => {
      const enabled = $(event.currentTarget).is(':checked');
      html.find('.ncm-config__data-shard-settings').toggle(enabled);
    });
    
    // Add message button
    html.find('.ncm-config__add-message-btn').on('click', () => {
      this._addMessage(html);
    });
    
    // Remove message button
    html.find('.ncm-config__remove-message-btn').on('click', (event) => {
      const index = $(event.currentTarget).data('index');
      this._removeMessage(html, index);
    });
    
    // Toggle encryption
    html.find('[name="encrypted"]').on('change', (event) => {
      const enabled = $(event.currentTarget).is(':checked');
      html.find('.ncm-config__encryption-settings').toggle(enabled);
    });
  }
  
  /**
   * Handle form submission
   */
  async _updateObject(event, formData) {
    console.log(`${MODULE_ID} | Updating item configuration:`, formData);
    
    try {
      // Build messages object
      const messages = {};
      const messageIds = [];
      
      // Parse message data from form
      let i = 0;
      while (formData[`message-${i}-from`] !== undefined) {
        const id = foundry.utils.randomID();
        
        messages[id] = {
          from: formData[`message-${i}-from`] || '',
          subject: formData[`message-${i}-subject`] || '',
          content: formData[`message-${i}-content`] || '',
          timestamp: new Date().toISOString(),
          encrypted: formData.encrypted
        };
        
        messageIds.push(id);
        i++;
      }
      
      // Update item flags
      await this.item.setFlag(MODULE_ID, 'isDataShard', formData.isDataShard);
      await this.item.setFlag(MODULE_ID, 'encrypted', formData.encrypted);
      await this.item.setFlag(MODULE_ID, 'encryptionDC', parseInt(formData.encryptionDC) || 15);
      await this.item.setFlag(MODULE_ID, 'encryptionType', formData.encryptionType);
      await this.item.setFlag(MODULE_ID, 'messages', messages);
      await this.item.setFlag(MODULE_ID, 'messageIds', messageIds);
      
      ui.notifications.info('Data shard configuration saved');
      
      // Update any open item inboxes
      Object.values(ui.windows).forEach(window => {
        if (window.constructor.name === 'ItemInboxApp' && window.item.id === this.item.id) {
          window.render(false);
        }
      });
    } catch (error) {
      console.error(`${MODULE_ID} | Error saving configuration:`, error);
      ui.notifications.error('Failed to save configuration');
    }
  }
  
  // ========================================
  // Private Helper Methods
  // ========================================
  
  /**
   * Get messages as array
   * @private
   */
  _getMessagesArray(flags) {
    const messages = [];
    const messagesData = flags.messages || {};
    const messageIds = flags.messageIds || [];
    
    messageIds.forEach(id => {
      const msg = messagesData[id];
      if (msg) {
        messages.push({
          id,
          from: msg.from || '',
          subject: msg.subject || '',
          content: msg.content || ''
        });
      }
    });
    
    return messages;
  }
  
  /**
   * Add new message
   * @private
   */
  _addMessage(html) {
    const $container = html.find('.ncm-config__messages-list');
    const index = $container.find('.ncm-config__message-item').length;
    
    const $newMessage = $(`
      <div class="ncm-config__message-item" data-index="${index}">
        <h4>Message ${index + 1}</h4>
        
        <div class="form-group">
          <label>From:</label>
          <input type="text" name="message-${index}-from" />
        </div>
        
        <div class="form-group">
          <label>Subject:</label>
          <input type="text" name="message-${index}-subject" />
        </div>
        
        <div class="form-group">
          <label>Content:</label>
          <textarea name="message-${index}-content" rows="4"></textarea>
        </div>
        
        <button type="button" class="ncm-config__remove-message-btn" data-index="${index}">
          <i class="fas fa-trash"></i> Remove
        </button>
      </div>
    `);
    
    $container.append($newMessage);
    
    // Bind remove handler
    $newMessage.find('.ncm-config__remove-message-btn').on('click', (event) => {
      const idx = $(event.currentTarget).data('index');
      this._removeMessage(html, idx);
    });
  }
  
  /**
   * Remove message
   * @private
   */
  _removeMessage(html, index) {
    const $item = html.find(`.ncm-config__message-item[data-index="${index}"]`);
    $item.remove();
    
    // Re-index remaining messages
    html.find('.ncm-config__message-item').each((i, el) => {
      const $el = $(el);
      $el.attr('data-index', i);
      $el.find('h4').text(`Message ${i + 1}`);
      
      // Update input names
      $el.find('input, textarea').each((j, input) => {
        const $input = $(input);
        const name = $input.attr('name');
        if (name) {
          const newName = name.replace(/message-\d+-/, `message-${i}-`);
          $input.attr('name', newName);
        }
      });
      
      // Update button data
      $el.find('.ncm-config__remove-message-btn').attr('data-index', i);
    });
  }
}