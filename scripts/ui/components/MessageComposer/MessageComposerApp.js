/**
 * Message Composer Application
 * File: scripts/ui/components/MessageComposer/MessageComposerApp.js
 * Module: cyberpunkred-messenger
 * Description: Compose and send messages
 */

import { MODULE_ID } from '../../../utils/constants.js';
import { BaseApplication } from '../BaseApplication.js';
import { RecipientSelector } from './RecipientSelector.js';
import { MessageEditor } from './MessageEditor.js';
import { SchedulingPanel } from './SchedulingPanel.js';
import { MessageService } from '../../../services/MessageService.js';
import { ContactRepository } from '../../../data/ContactRepository.js';
import { EVENTS } from '../../../core/EventBus.js';

export class MessageComposerApp extends BaseApplication {
  constructor(options = {}) {
    super(options);
    
    // Services
    this.messageService = options.messageService || new MessageService();
    this.contactRepository = options.contactRepository || new ContactRepository();
    
    // Composition mode
    this.mode = options.mode || 'new'; // new, reply, forward
    this.originalMessage = options.originalMessage || null;
    
    // Form data
    this.formData = {
      to: options.to || '',
      subject: options.subject || '',
      content: options.content || '',
      from: this._getCurrentUserEmail()
    };
    
    // Initialize components
    this.recipientSelector = new RecipientSelector(this);
    this.messageEditor = new MessageEditor(this);
    this.schedulingPanel = new SchedulingPanel(this);
    
    // Register components
    this.registerComponent('recipientSelector', this.recipientSelector);
    this.registerComponent('messageEditor', this.messageEditor);
    this.registerComponent('schedulingPanel', this.schedulingPanel);
    
    // Subscribe to composer open events
    this.subscribe('composer:open', (data) => {
      this._handleComposerOpen(data);
    });
  }
  
  /**
   * Default options
   */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["ncm-app", "ncm-composer"],
      template: `modules/${MODULE_ID}/templates/message-composer/composer.hbs`,
      width: 700,
      height: 600,
      resizable: true,
      title: "Compose Message"
    });
  }
  
  /**
   * Get data for template
   */
  getData(options = {}) {
    const data = super.getData(options);
    
    // Get all contacts
    const contacts = this.contactRepository.getAll();
    
    // Get recent recipients (from state or localStorage)
    const recentRecipients = this._getRecentRecipients();
    
    // Get all actors for recipient suggestions
    const actors = game.actors
      .filter(a => a.type === 'character')
      .map(a => ({
        id: a.id,
        name: a.name,
        email: `${a.name.toLowerCase().replace(/\s+/g, '')}@nightcity.net`,
        img: a.img
      }));
    
    return {
      ...data,
      mode: this.mode,
      formData: this.formData,
      contacts: contacts,
      recentRecipients: recentRecipients,
      actorSuggestions: actors,
      originalMessage: this.originalMessage,
      characterName: game.user.character?.name || game.user.name,
      userEmail: this.formData.from
    };
  }
  
  /**
   * Send message
   * @param {Object} formData - Form data
   * @param {boolean} schedule - Whether to schedule instead of send
   * @returns {Promise<void>}
   */
  async sendMessage(formData, schedule = false) {
    try {
      // Validate form
      if (!formData.to || !formData.subject || !formData.content) {
        throw new Error('Please fill in all required fields');
      }
      
      // Build message data
      const messageData = {
        to: formData.to,
        from: this.formData.from,
        subject: formData.subject,
        content: formData.content,
        network: this.stateManager.get('currentNetwork') || 'CITINET'
      };
      
      if (schedule) {
        // Open scheduling dialog
        this.schedulingPanel.openScheduleDialog(messageData);
      } else {
        // Send immediately
        await this.messageService.sendMessage(messageData);
        
        // Track recipient
        this._addRecentRecipient(formData.to);
        
        // Close composer
        this.close();
      }
    } catch (error) {
      console.error(`${MODULE_ID} | Error sending message:`, error);
      ui.notifications.error(error.message);
    }
  }
  
  /**
   * Save as draft
   * @param {Object} formData - Form data
   */
  async saveDraft(formData) {
    try {
      // Store draft in localStorage
      const draftKey = `${MODULE_ID}-draft-${game.user.id}`;
      const draft = {
        ...formData,
        savedAt: new Date().toISOString()
      };
      
      localStorage.setItem(draftKey, JSON.stringify(draft));
      
      ui.notifications.info('Draft saved');
    } catch (error) {
      console.error(`${MODULE_ID} | Error saving draft:`, error);
      ui.notifications.error('Failed to save draft');
    }
  }
  
  /**
   * Load draft
   * @returns {Object|null}
   */
  loadDraft() {
    try {
      const draftKey = `${MODULE_ID}-draft-${game.user.id}`;
      const stored = localStorage.getItem(draftKey);
      
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (error) {
      console.error(`${MODULE_ID} | Error loading draft:`, error);
    }
    
    return null;
  }
  
  /**
   * Clear draft
   */
  clearDraft() {
    const draftKey = `${MODULE_ID}-draft-${game.user.id}`;
    localStorage.removeItem(draftKey);
  }
  
  /**
   * Activate listeners
   */
  activateListeners(html) {
    super.activateListeners(html);
    
    // Send button
    html.find('.ncm-composer__send-btn').on('click', (event) => {
      event.preventDefault();
      
      const formData = this._getFormData(html);
      this.sendMessage(formData, false);
      
      this.playSound('click');
    });
    
    // Schedule button
    html.find('.ncm-composer__schedule-btn').on('click', (event) => {
      event.preventDefault();
      
      const formData = this._getFormData(html);
      this.sendMessage(formData, true);
      
      this.playSound('click');
    });
    
    // Save draft button
    html.find('.ncm-composer__draft-btn').on('click', (event) => {
      event.preventDefault();
      
      const formData = this._getFormData(html);
      this.saveDraft(formData);
      
      this.playSound('click');
    });
    
    // Load draft button
    html.find('.ncm-composer__load-draft-btn').on('click', (event) => {
      event.preventDefault();
      
      const draft = this.loadDraft();
      if (draft) {
        this._populateForm(html, draft);
        ui.notifications.info('Draft loaded');
      } else {
        ui.notifications.warn('No draft found');
      }
      
      this.playSound('click');
    });
    
    // Cancel button
    html.find('.ncm-composer__cancel-btn').on('click', (event) => {
      event.preventDefault();
      this.close();
    });
  }
  
  /**
   * Lifecycle: First render
   */
  _onFirstRender() {
    console.log(`${MODULE_ID} | Composer opened in ${this.mode} mode`);
    
    // Play open sound
    this.playSound('open');
    
    // Emit event
    this.eventBus.emit(EVENTS.UI_COMPOSER_OPENED, {
      mode: this.mode
    });
    
    // Register in state
    this.stateManager.get('activeComposers').add(this.appId);
  }
  
  /**
   * Close composer
   */
  async close(options = {}) {
    // Emit event
    this.eventBus.emit(EVENTS.UI_COMPOSER_CLOSED, {
      mode: this.mode
    });
    
    // Remove from active composers
    this.stateManager.get('activeComposers').delete(this.appId);
    
    return super.close(options);
  }
  
  // ========================================
  // Private Helper Methods
  // ========================================
  
  /**
   * Get current user's email
   * @private
   */
  _getCurrentUserEmail() {
    const character = game.user.character;
    const name = character?.name || game.user.name;
    return `${name.toLowerCase().replace(/\s+/g, '')}@nightcity.net`;
  }
  
  /**
   * Get form data from HTML
   * @private
   */
  _getFormData(html) {
    return {
      to: html.find('[name="to"]').val().trim(),
      subject: html.find('[name="subject"]').val().trim(),
      content: html.find('[name="content"]').val().trim()
    };
  }
  
  /**
   * Populate form with data
   * @private
   */
  _populateForm(html, data) {
    html.find('[name="to"]').val(data.to || '');
    html.find('[name="subject"]').val(data.subject || '');
    html.find('[name="content"]').val(data.content || '');
  }
  
  /**
   * Get recent recipients
   * @private
   */
  _getRecentRecipients() {
    try {
      const key = `${MODULE_ID}-recent-recipients-${game.user.id}`;
      const stored = localStorage.getItem(key);
      return stored ? JSON.parse(stored) : [];
    } catch (e) {
      return [];
    }
  }
  
  /**
   * Add recent recipient
   * @private
   */
  _addRecentRecipient(email) {
    const recent = this._getRecentRecipients();
    
    // Remove if already exists
    const filtered = recent.filter(r => r !== email);
    
    // Add to front
    filtered.unshift(email);
    
    // Keep only last 10
    const limited = filtered.slice(0, 10);
    
    // Save
    const key = `${MODULE_ID}-recent-recipients-${game.user.id}`;
    localStorage.setItem(key, JSON.stringify(limited));
  }
  
  /**
   * Handle composer open event
   * @private
   */
  _handleComposerOpen(data) {
    if (data.mode) {
      this.mode = data.mode;
    }
    
    if (data.originalMessage) {
      this.originalMessage = data.originalMessage;
    }
    
    if (data.to) {
      this.formData.to = data.to;
    }
    
    if (data.subject) {
      this.formData.subject = data.subject;
    }
    
    if (data.content) {
      this.formData.content = data.content;
    }
    
    // Re-render
    this.render(true);
  }
}