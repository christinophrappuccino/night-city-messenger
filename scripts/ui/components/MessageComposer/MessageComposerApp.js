/**
 * Message Composer Application (COMPLETE)
 * File: scripts/ui/components/MessageComposer/MessageComposerApp.js
 * Module: cyberpunkred-messenger
 * Description: Full message composer with contact integration
 */

import { MODULE_ID } from '../../../utils/constants.js';
import { isValidEmail } from '../../../utils/validators.js';
import { BaseApplication } from '../BaseApplication.js';
import { PlayerEmailSetup } from '../../dialogs/PlayerEmailSetup.js';
import { ContactManagerApp } from '../ContactManager/ContactManagerApp.js';

export class MessageComposerApp extends BaseApplication {
  constructor(options = {}) {
    super(options);
    
    this.mode = options.mode || 'compose'; // 'compose', 'reply', 'forward'
    this.originalMessage = options.originalMessage || null;
    
    this.formData = {
      to: options.to || '',
      subject: options.subject || '',
      content: options.content || ''
    };
  }
  
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
  
  async getData(options = {}) {
    const actor = game.user.character;
    const senderEmail = actor?.getFlag(MODULE_ID, "emailAddress") || "No email set";
    
    return {
      ...super.getData(options),
      senderEmail,
      to: this.formData.to,
      subject: this.formData.subject,
      content: this.formData.content,
      hasEmail: senderEmail !== "No email set",
      mode: this.mode
    };
  }
  
  /**
   * Check and prompt for email setup if needed
   */
  async _ensureEmailSetup() {
    const actor = game.user.character;
    
    if (!actor) {
      ui.notifications.error("You must have a character assigned.");
      return false;
    }
    
    const email = actor.getFlag(MODULE_ID, "emailAddress");
    
    if (!email) {
      ui.notifications.warn("Please set up your email address first.");
      const success = await PlayerEmailSetup.show();
      
      if (success) {
        this.render(false); // Refresh to show new email
      }
      
      return success;
    }
    
    return true;
  }
  
  /**
   * Open contact manager for selection
   */
  _openContactPicker() {
    new ContactManagerApp({
      selectMode: true,
      onSelect: (contact) => {
        // Update recipient field
        const input = this.element.find('[name="to"]');
        input.val(contact.email);
        this.formData.to = contact.email;
        
        // Show brief confirmation
        this._showContactSelected(contact);
      }
    }).render(true);
  }
  
  /**
   * Show contact selected feedback
   */
  _showContactSelected(contact) {
    const suggestions = this.element.find('.ncm-composer__suggestions');
    
    suggestions.html(`
      <div class="ncm-composer__suggestion-item">
        ${contact.img ? 
          `<img src="${contact.img}" class="ncm-composer__suggestion-icon" />` :
          `<div class="ncm-composer__suggestion-icon--placeholder">
            <i class="fas fa-user"></i>
          </div>`
        }
        <div>
          <div class="ncm-composer__suggestion-name">${contact.name}</div>
          <div class="ncm-composer__suggestion-email">${contact.email}</div>
        </div>
      </div>
    `).show();
    
    setTimeout(() => suggestions.fadeOut(), 2000);
  }
  
  /**
   * Setup autocomplete for recipient field
   */
  async _setupRecipientAutocomplete(input, suggestions) {
    // Load all available contacts
    const userContacts = await game.user.getFlag(MODULE_ID, "contacts") || [];
    
    // Add actor emails
    const actorContacts = game.actors.contents
      .filter(a => a.getFlag(MODULE_ID, "emailAddress"))
      .map(a => ({
        name: a.name,
        email: a.getFlag(MODULE_ID, "emailAddress"),
        img: a.img
      }));
    
    const allContacts = [...userContacts, ...actorContacts];
    
    // Remove duplicates by email
    const uniqueContacts = Array.from(
      new Map(allContacts.map(c => [c.email, c])).values()
    );
    
    input.on('input', (e) => {
      const value = e.target.value.toLowerCase().trim();
      
      if (!value) {
        suggestions.hide();
        return;
      }
      
      // Filter matching contacts
      const matches = uniqueContacts.filter(c => 
        c.name.toLowerCase().includes(value) ||
        c.email.toLowerCase().includes(value)
      ).slice(0, 5);
      
      if (matches.length === 0) {
        suggestions.hide();
        return;
      }
      
      // Render suggestions
      const html = matches.map(contact => `
        <div class="ncm-composer__suggestion-item" data-email="${contact.email}">
          ${contact.img ? 
            `<img src="${contact.img}" class="ncm-composer__suggestion-icon" />` :
            `<div class="ncm-composer__suggestion-icon--placeholder">
              <i class="fas fa-user"></i>
            </div>`
          }
          <div>
            <div class="ncm-composer__suggestion-name">${contact.name}</div>
            <div class="ncm-composer__suggestion-email">${contact.email}</div>
          </div>
        </div>
      `).join('');
      
      suggestions.html(html).show();
    });
    
    // Click on suggestion
    suggestions.on('click', '.ncm-composer__suggestion-item', (e) => {
      const email = $(e.currentTarget).data('email');
      input.val(email);
      this.formData.to = email;
      suggestions.hide();
    });
    
    // Hide on blur (with delay for click to register)
    input.on('blur', () => {
      setTimeout(() => suggestions.hide(), 200);
    });
  }
  
  /**
   * Send the message
   */
  async sendMessage() {
    const actor = game.user.character;
    const senderEmail = actor?.getFlag(MODULE_ID, "emailAddress");
    
    if (!senderEmail) {
      ui.notifications.error("You must set up your email address first.");
      return;
    }
    
    const { to, subject, content } = this.formData;
    
    // Validate
    if (!to) {
      ui.notifications.error("Please enter a recipient.");
      return;
    }
    
    if (!isValidEmail(to)) {
      ui.notifications.error("Invalid recipient email format.");
      return;
    }
    
    if (!subject) {
      ui.notifications.error("Please enter a subject.");
      return;
    }
    
    if (!content) {
      ui.notifications.error("Please enter message content.");
      return;
    }
    
    try {
      // Call your existing message sending system
      await game.nightcity.messageManager.send({
        from: `${actor.name} (${senderEmail})`,
        to,
        subject,
        content,
        timestamp: new Date().toISOString()
      });
      
      ui.notifications.info("Message sent!");
      this.close();
      
    } catch (error) {
      console.error(`${MODULE_ID} | Error sending message:`, error);
      ui.notifications.error("Failed to send message.");
    }
  }
  
  activateListeners(html) {
    super.activateListeners(html);
    
    // Setup email button (if no email)
    const actor = game.user.character;
    const email = actor?.getFlag(MODULE_ID, "emailAddress");
    
    if (!email) {
      const headerBottom = html.find('.ncm-header__bottom');
      headerBottom.append(`
        <button class="ncm-btn ncm-btn--small ncm-btn--primary" data-action="setup-email">
          <i class="fas fa-envelope-open-text"></i> Set Up Email
        </button>
      `);
    }
    
    html.find('[data-action="setup-email"]').on('click', async () => {
      const success = await PlayerEmailSetup.show();
      if (success) {
        this.render(false);
      }
    });
    
    // Contact selection button
    html.find('[data-action="select-contact"]').on('click', () => {
      this._openContactPicker();
    });
    
    // Recipient autocomplete
    const recipientInput = html.find('[name="to"]');
    const suggestions = html.find('.ncm-composer__suggestions');
    this._setupRecipientAutocomplete(recipientInput, suggestions);
    
    // Track form changes
    html.find('[name="to"]').on('change', (e) => {
      this.formData.to = $(e.currentTarget).val().trim();
    });
    
    html.find('[name="subject"]').on('change', (e) => {
      this.formData.subject = $(e.currentTarget).val().trim();
    });
    
    html.find('[name="content"]').on('change', (e) => {
      this.formData.content = $(e.currentTarget).val().trim();
    });
    
    // Send button
    html.find('[data-action="send"]').on('click', async (e) => {
      e.preventDefault();
      await this.sendMessage();
    });
    
    // Cancel button
    html.find('[data-action="cancel"]').on('click', () => {
      this.close();
    });
  }
  
  /**
   * Override render to check email on open
   */
  async render(force = false, options = {}) {
    // Check email setup before rendering
    if (!this.rendered) {
      const hasEmail = await this._ensureEmailSetup();
      if (!hasEmail) {
        return this; // Don't render if email setup was cancelled
      }
    }
    
    return super.render(force, options);
  }
}