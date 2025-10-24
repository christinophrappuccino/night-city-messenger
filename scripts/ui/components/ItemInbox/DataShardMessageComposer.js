/**
 * Data Shard Message Composer
 * File: scripts/ui/components/ItemInbox/DataShardMessageComposer.js
 * Module: cyberpunkred-messenger
 * Description: Advanced message composer for data shards with full GM control
 */

import { MODULE_ID } from '../../../utils/constants.js';
import { EventBus } from '../../../core/EventBus.js';
import { DataShardService } from '../../../services/DataShardService.js';

export class DataShardMessageComposer extends Application {
  constructor(dataShard, options = {}) {
    super(options);
    
    this.dataShard = dataShard;
    const eventBus = EventBus.getInstance();
    this.dataShardService = new DataShardService(eventBus);
    
    // Message data
    this.messageData = {
      from: options.from || '',
      to: options.to || '',
      subject: options.subject || '',
      content: options.content || '',
      date: options.date || new Date().toISOString()
    };
    
    // Templates
    this.templates = this._getMessageTemplates();
    this.selectedTemplate = null;
  }
  
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["ncm-app", "ncm-datashard-composer"],
      template: `modules/${MODULE_ID}/templates/item-inbox/message-composer.hbs`,
      width: 700,
      height: 600,
      resizable: true,
      title: "Compose Message for Data Shard"
    });
  }
  
  get title() {
    return `Compose Message: ${this.dataShard.name}`;
  }
  
  async getData(options = {}) {
    const data = await super.getData(options);
    
    // Get data shard encryption mode
    const encryptionMode = this.dataShard.getFlag(MODULE_ID, 'encryptionMode') || 'shard';
    const shardEncrypted = this.dataShard.getFlag(MODULE_ID, 'encrypted') || false;
    
    // Check if per-message encryption is allowed
    const allowMessageEncryption = encryptionMode === 'message' || encryptionMode === 'both';
    
    // Get all actors for sender/recipient suggestions
    const actors = game.actors.contents.map(a => ({
      id: a.id,
      name: a.name,
      email: a.getFlag(MODULE_ID, 'email') || `${a.name.toLowerCase().replace(/\s/g, '.')}@nightcity.net`
    }));
    
    // Get contacts if available
    const contacts = this._getContacts();
    
    return {
      ...data,
      dataShard: this.dataShard,
      messageData: this.messageData,
      actors,
      contacts,
      templates: this.templates,
      selectedTemplate: this.selectedTemplate,
      isGM: game.user.isGM,
      canEditAll: game.user.isGM || this.dataShard.isOwner,
      currentUserEmail: game.user.character?.getFlag(MODULE_ID, 'email') || 'unknown@nightcity.net',
      
      // NEW: Encryption options
      allowMessageEncryption,
      shardEncrypted,
      encryptionMode,
      messageEncrypted: this.messageData.encrypted || false,
      encryptionType: this.messageData.encryptionType || 'ICE',
      encryptionDC: this.messageData.encryptionDC || 15,
      allowedSkills: this.messageData.allowedSkills || ['Interface', 'Electronics/Security Tech'],
      
      // Encryption types for dropdown
      encryptionTypes: [
        { value: 'ICE', label: 'Standard ICE' },
        { value: 'BLACK_ICE', label: 'BLACK ICE (3d6 damage)' },
        { value: 'RED_ICE', label: 'RED ICE (5d6 damage)' }
      ]
    };
  }
  
  activateListeners(html) {
    super.activateListeners(html);
    
    // Template selection
    html.find('.ncm-template-select').change(this._onTemplateChange.bind(this));
    
    // Quick fill buttons
    html.find('.ncm-quick-fill-from').click(this._onQuickFillFrom.bind(this));
    html.find('.ncm-quick-fill-to').click(this._onQuickFillTo.bind(this));
    
    // Insert variables
    html.find('.ncm-insert-variable').click(this._onInsertVariable.bind(this));
    
    // Preview
    html.find('.ncm-preview-message').click(this._onPreview.bind(this));
    
    // Send/Save buttons
    html.find('.ncm-send-message').click(this._onSendMessage.bind(this));
    html.find('.ncm-save-draft').click(this._onSaveDraft.bind(this));

    // Toggle message encryption
    html.find('#message-encrypted').change(this._onToggleEncryption.bind(this));

    // Master List button (GM only)
    if (game.user.isGM) {
      html.find('[data-action="select-from-master"]').on('click', () => {
        this._openFromPicker();
      });
    }
    
    // Rich text formatting
    html.find('.ncm-format-bold').click(() => this._formatText('bold'));
    html.find('.ncm-format-italic').click(() => this._formatText('italic'));
    html.find('.ncm-format-code').click(() => this._formatText('code'));
    html.find('.ncm-format-header').click(() => this._formatText('h3'));
  }
  
  // =========================================================================
  // EVENT HANDLERS
  // =========================================================================
  
  /**
   * Handle template selection
   * @private
   */
  async _onTemplateChange(event) {
    const templateId = $(event.currentTarget).val();
    
    if (!templateId || templateId === '') {
      this.selectedTemplate = null;
      return;
    }
    
    const template = this.templates.find(t => t.id === templateId);
    if (!template) return;
    
    this.selectedTemplate = template;
    
    // Apply template
    this.messageData = {
      ...this.messageData,
      subject: template.subject,
      content: template.content
    };
    
    // Re-render to show template content
    this.render(false);
  }
  
  /**
   * Quick fill FROM field
   * @private
   */
  async _onQuickFillFrom(event) {
    event.preventDefault();
    
    const choices = {};
    
    // Add user's character
    if (game.user.character) {
      const email = game.user.character.getFlag(MODULE_ID, 'email') || 
        `${game.user.character.name.toLowerCase().replace(/\s/g, '.')}@nightcity.net`;
      choices[email] = `${game.user.character.name} (${email})`;
    }
    
    // Add all actors (GM only)
    if (game.user.isGM) {
      game.actors.contents.forEach(a => {
        const email = a.getFlag(MODULE_ID, 'email') || 
          `${a.name.toLowerCase().replace(/\s/g, '.')}@nightcity.net`;
        choices[email] = `${a.name} (${email})`;
      });
      
      // Add common system addresses
      choices['system@nightcity.net'] = 'System';
      choices['admin@arasaka.com'] = 'Arasaka Admin';
      choices['security@militech.com'] = 'Militech Security';
      choices['alert@netwatch.gov'] = 'NetWatch Alert';
      choices['dispatch@trauma.team'] = 'Trauma Team';
    }
    
    const selected = await this._showSelectDialog('Select Sender', choices);
    if (selected) {
      $(event.currentTarget).closest('.ncm-form-group').find('input[name="from"]').val(selected);
    }
  }
  
  /**
   * Quick fill TO field
   * @private
   */
  async _onQuickFillTo(event) {
    event.preventDefault();
    
    const choices = {};
    
    // Add all actors
    game.actors.contents.forEach(a => {
      const email = a.getFlag(MODULE_ID, 'email') || 
        `${a.name.toLowerCase().replace(/\s/g, '.')}@nightcity.net`;
      choices[email] = `${a.name} (${email})`;
    });
    
    // Add common addresses
    choices['all@crew.net'] = 'All Crew Members';
    choices['team@runners.net'] = 'Team';
    
    const selected = await this._showSelectDialog('Select Recipient', choices);
    if (selected) {
      $(event.currentTarget).closest('.ncm-form-group').find('input[name="to"]').val(selected);
    }
  }
  
  /**
   * Insert variable into content
   * @private
   */
  _onInsertVariable(event) {
    event.preventDefault();
    
    const variable = $(event.currentTarget).data('variable');
    const textarea = this.element.find('textarea[name="content"]')[0];
    
    if (!textarea) return;
    
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    
    const before = text.substring(0, start);
    const after = text.substring(end);
    
    textarea.value = before + `{{${variable}}}` + after;
    textarea.selectionStart = textarea.selectionEnd = start + variable.length + 4;
    textarea.focus();
  }
  
  /**
   * Preview message
   * @private
   */
  async _onPreview(event) {
    event.preventDefault();
    
    // Get form data
    const formData = this._getFormData();
    
    // Process variables
    const processedContent = this._processVariables(formData.content);
    
    // Show preview dialog
    new Dialog({
      title: "Message Preview",
      content: `
        <div class="ncm-message-preview">
          <div class="ncm-preview-header">
            <div><strong>FROM:</strong> ${formData.from}</div>
            <div><strong>TO:</strong> ${formData.to}</div>
            <div><strong>DATE:</strong> ${new Date(formData.date).toLocaleString()}</div>
          </div>
          <div class="ncm-preview-subject">
            <strong>SUBJECT:</strong> ${formData.subject}
          </div>
          <div class="ncm-preview-content">
            ${processedContent}
          </div>
        </div>
      `,
      buttons: {
        close: {
          icon: '<i class="fas fa-times"></i>',
          label: "Close"
        }
      }
    }).render(true);
  }
  
  /**
   * Handle encryption toggle
   * @private
   */
  _onToggleEncryption(event) {
    const encrypted = $(event.currentTarget).prop('checked');
    
    // Show/hide encryption options
    if (encrypted) {
      this.element.find('.ncm-encryption-options').show();
    } else {
      this.element.find('.ncm-encryption-options').hide();
    }
  }

  /**
   * Send message (updated with encryption)
   * @private
   */
  async _onSendMessage(event) {
    event.preventDefault();
    
    try {
      // Get form data
      const formData = this._getFormData();
      
      // Validate
      if (!formData.subject || !formData.content) {
        ui.notifications.error('Subject and content are required');
        return;
      }
      
      // Process variables
      formData.content = this._processVariables(formData.content);
      
      // Add encryption data if message is encrypted
      if (formData.messageEncrypted) {
        formData.encrypted = true;
        formData.encryptionType = formData.encryptionType || 'ICE';
        formData.encryptionDC = parseInt(formData.encryptionDC) || 15;
        
        // Get allowed skills
        const allowedSkills = [];
        this.element.find('input[name="allowedSkills"]:checked').each((i, el) => {
          allowedSkills.push($(el).val());
        });
        formData.allowedSkills = allowedSkills.length > 0 ? allowedSkills : ['Interface', 'Electronics/Security Tech'];
        
        console.log(`${MODULE_ID} | Creating encrypted message:`, {
          encrypted: formData.encrypted,
          type: formData.encryptionType,
          dc: formData.encryptionDC,
          skills: formData.allowedSkills
        });
      } else {
        formData.encrypted = false;
      }
      
      const eventBus = EventBus.getInstance();
      const dataShardService = new DataShardService(eventBus);
      
      // Add to data shard
      await dataShardService.addMessage(this.dataShard, formData);
      
      ui.notifications.info('Message added to data shard!');
      this.close();
      
    } catch (error) {
      console.error(`${MODULE_ID} | Error sending message:`, error);
      ui.notifications.error('Failed to add message');
    }
  }
  
  /**
   * Save as draft
   * @private
   */
  async _onSaveDraft(event) {
    event.preventDefault();
    
    const formData = this._getFormData();
    
    // Store in localstorage
    localStorage.setItem(`${MODULE_ID}-draft-${this.dataShard.id}`, JSON.stringify(formData));
    
    ui.notifications.info('Draft saved!');
  }

  /**
   * Open FROM picker - Opens GM Contact Manager for selection
   * ⚡ NEW: Opens the enhanced GM Contact Manager
   * @private
   */
  _openFromPicker() {
    const GMContactManagerApp = game.nightcity?.GMContactManagerApp;
    
    if (!GMContactManagerApp) {
      ui.notifications.error('GM Contact Manager not available. Please reload Foundry.');
      return;
    }
    
    // Open GM Contact Manager with callback
    const manager = new GMContactManagerApp();
    
    // Store reference to this composer
    const composer = this;
    
    // Override the sendAsContact method to handle selection
    const originalSendAs = manager.sendAsContact.bind(manager);
    manager.sendAsContact = async function(contactId) {
      const contact = this.contacts.find(c => c.id === contactId);
      
      if (!contact) {
        ui.notifications.warn('Contact not found');
        return;
      }
      
      // Set the FROM field in data shard composer
      const fromInput = composer.element.find('[name="from"]');
      fromInput.val(contact.email);
      composer.messageData.from = contact.email;
      
      // Visual feedback
      ui.notifications.info(`Selected: ${contact.name} (${contact.email})`);
      
      // Close the manager
      this.close();
    };
    
    manager.render(true);
  }
  
  // =========================================================================
  // HELPER METHODS
  // =========================================================================
  
  /**
   * Get form data
   * @private
   */
  _getFormData() {
    const form = this.element.find('form')[0];
    if (!form) return this.messageData;
    
    const formData = new FormDataExtended(form).object;
    
    return {
      from: formData.from || '',
      to: formData.to || '',
      subject: formData.subject || '',
      content: formData.content || '',
      date: formData.date || new Date().toISOString(),
      
      // NEW: Encryption fields
      messageEncrypted: formData.messageEncrypted || false,
      encryptionType: formData.encryptionType || 'ICE',
      encryptionDC: formData.encryptionDC || 15,
      allowedSkills: formData.allowedSkills || []
    };
  }
  
  /**
   * Process template variables
   * @private
   */
  _processVariables(content) {
    let processed = content;
    
    const variables = {
      playerName: game.user.character?.name || 'Unknown',
      userName: game.user.name,
      date: new Date().toLocaleDateString(),
      time: new Date().toLocaleTimeString(),
      datetime: new Date().toLocaleString(),
      shardName: this.dataShard.name,
      randomEddies: Math.floor(Math.random() * 10000) + 1000,
      randomLocation: this._getRandomLocation()
    };
    
    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`{{${key}}}`, 'g');
      processed = processed.replace(regex, value);
    }
    
    return processed;
  }
  
  /**
   * Format text in textarea
   * @private
   */
  _formatText(format) {
    const textarea = this.element.find('textarea[name="content"]')[0];
    if (!textarea) return;
    
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = textarea.value.substring(start, end);
    
    if (!selectedText) {
      ui.notifications.warn('Please select text to format');
      return;
    }
    
    let formatted = '';
    
    switch (format) {
      case 'bold':
        formatted = `<strong>${selectedText}</strong>`;
        break;
      case 'italic':
        formatted = `<em>${selectedText}</em>`;
        break;
      case 'code':
        formatted = `<code>${selectedText}</code>`;
        break;
      case 'h3':
        formatted = `<h3>${selectedText}</h3>`;
        break;
    }
    
    const before = textarea.value.substring(0, start);
    const after = textarea.value.substring(end);
    
    textarea.value = before + formatted + after;
    textarea.selectionStart = start;
    textarea.selectionEnd = start + formatted.length;
    textarea.focus();
  }
  
  /**
   * Show selection dialog
   * @private
   */
  async _showSelectDialog(title, choices) {
    return new Promise((resolve) => {
      new Dialog({
        title,
        content: `
          <form>
            <div class="form-group">
              <label>Select:</label>
              <select name="selection" style="width: 100%;">
                <option value="">-- Select --</option>
                ${Object.entries(choices).map(([value, label]) => 
                  `<option value="${value}">${label}</option>`
                ).join('')}
              </select>
            </div>
          </form>
        `,
        buttons: {
          select: {
            icon: '<i class="fas fa-check"></i>',
            label: "Select",
            callback: (html) => {
              const value = html.find('[name="selection"]').val();
              resolve(value);
            }
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: "Cancel",
            callback: () => resolve(null)
          }
        },
        default: "select"
      }).render(true);
    });
  }
  
  /**
   * Get message templates
   * @private
   */
  _getMessageTemplates() {
    return [
      {
        id: 'job_offer',
        name: 'Job Offer',
        subject: 'New Job Opportunity',
        content: `<h3>Job Available</h3>
<p>Got a job that might interest you.</p>
<p><strong>Type:</strong> [Specify job type]</p>
<p><strong>Location:</strong> {{randomLocation}}</p>
<p><strong>Payment:</strong> {{randomEddies}} eddies</p>
<p><strong>Risk Level:</strong> Medium</p>
<p>Reply if interested. Time sensitive.</p>`
      },
      {
        id: 'threat',
        name: 'Threat',
        subject: 'Final Warning',
        content: `<p style="color: #ff0000;"><strong>You've been warned.</strong></p>
<p>Back off from [specify situation] or face the consequences.</p>
<p>This is your last chance.</p>
<p style="color: #666;">- You know who</p>`
      },
      {
        id: 'intel',
        name: 'Intelligence Report',
        subject: 'Intelligence: [Topic]',
        content: `<h3>CLASSIFIED INTELLIGENCE REPORT</h3>
<p><strong>Date:</strong> {{datetime}}</p>
<p><strong>Source:</strong> Field Agent</p>
<p><strong>Subject:</strong> [Specify subject]</p>
<hr>
<p>[Add intelligence details here]</p>
<p><strong>Recommendation:</strong> [Add recommendation]</p>`
      },
      {
        id: 'corpo_memo',
        name: 'Corporate Memo',
        subject: 'INTERNAL MEMO',
        content: `<div style="font-family: monospace;">
TO: All Staff<br>
FROM: Management<br>
RE: [Subject]<br>
DATE: {{date}}<br>
<hr>
<p>[Memo content]</p>
<p><em>This communication is confidential.</em></p>
</div>`
      },
      {
        id: 'blackmail',
        name: 'Blackmail',
        subject: 'We Need to Talk',
        content: `<p>I know about [specify secret].</p>
<p>Transfer {{randomEddies}} eddies to the following account, or everyone will know.</p>
<p><strong>Account:</strong> XXXX-XXXX-XXXX</p>
<p>You have 24 hours.</p>`
      },
      {
        id: 'news',
        name: 'News Article',
        subject: 'Breaking: [Headline]',
        content: `<h2>[News Headline]</h2>
<p><em>Night City News Network - {{datetime}}</em></p>
<p>[Lead paragraph]</p>
<p>[Additional details]</p>
<p>[Quote from authority figure]</p>`
      }
    ];
  }
  
  /**
   * Get random Night City location
   * @private
   */
  _getRandomLocation() {
    const locations = [
      'Downtown', 'Watson', 'Westbrook', 'Heywood', 'Pacifica',
      'Santo Domingo', 'City Center', 'The Badlands', 'Japantown',
      'Kabuki', 'Little China', 'Corpo Plaza', 'Combat Zone'
    ];
    return locations[Math.floor(Math.random() * locations.length)];
  }
  
  /**
   * Get contacts
   * @private
   */
  _getContacts() {
    // TODO: Integrate with contact manager if available
    return [];
  }
  
  /**
   * Load draft if exists
   * @private
   */
  _loadDraft() {
    const draft = localStorage.getItem(`${MODULE_ID}-draft-${this.dataShard.id}`);
    if (draft) {
      try {
        this.messageData = JSON.parse(draft);
      } catch (error) {
        console.error(`${MODULE_ID} | Error loading draft:`, error);
      }
    }
  }
}