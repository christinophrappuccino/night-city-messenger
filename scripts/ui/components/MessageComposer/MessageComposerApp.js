/**
 * Message Composer Application
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
    
    this.mode = options.mode || 'compose';
    this.originalMessage = options.originalMessage || null;
    this.actor = options.actor || game.user.character;
    this.actorId = options.actorId || this.actor?.id;
    
    // Build initial content
    let initialContent = options.content || '';
    
    if (this.mode === 'reply' && this.originalMessage) {
      initialContent = this._formatReplyContent(this.originalMessage);
    } else if (this.mode === 'forward' && this.originalMessage) {
      initialContent = this._formatForwardContent(this.originalMessage);
    }
    
    this.formData = {
      to: options.to || '',
      subject: options.subject || '',
      content: initialContent
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
    const data = super.getData(options);
    const senderEmail = this.actor?.getFlag(MODULE_ID, "emailAddress") || "No email set";
    
    return {
      ...data,
      actor: this.actor,
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
    if (!this.actor) {
      ui.notifications.error("No character selected.");
      return false;
    }
    
    const email = this.actor.getFlag(MODULE_ID, "emailAddress");
    
    if (!email) {
      ui.notifications.warn("Please set up your email address first.");
      const success = await PlayerEmailSetup.show(this.actor);
      
      if (success) {
        this.render(false);
      }
      
      return success;
    }
    
    return true;
  }
  
  /**
   * Format reply content
   */
  _formatReplyContent(message) {
    const bodyText = message.body || '';
    
    return `
  <div style="border-left: 4px solid #F65261; padding: 12px 16px; margin: 0 0 16px 0; background-color: rgba(246, 82, 97, 0.1); user-select: text; -webkit-user-select: text; cursor: text;">
    <p style="color: #F65261; font-weight: bold; margin: 0 0 8px 0; user-select: text;">▸ REPLY TO MESSAGE</p>
    <p style="margin: 4px 0; user-select: text;"><strong style="color: #F65261;">From:</strong> <span style="color: #19f3f7;">${message.from}</span></p>
    <p style="margin: 4px 0; user-select: text;"><strong style="color: #F65261;">To:</strong> <span style="color: #19f3f7;">${message.to}</span></p>
    <p style="margin: 4px 0; user-select: text;"><strong style="color: #F65261;">Date:</strong> <span style="color: #cccccc;">${message.timestamp}</span></p>
    <p style="margin: 4px 0; user-select: text;"><strong style="color: #F65261;">Subject:</strong> <span style="color: #ffffff;">${message.subject}</span></p>
    <hr style="border-color: #F65261; opacity: 0.3; margin: 8px 0;">
    <div style="color: #999999; font-size: 0.95em; margin: 8px 0 0 0; user-select: text;">${bodyText}</div>
  </div>
  <hr style="border: 1px solid #F65261; margin: 16px 0;">
  <p><br></p>
    `;
  }

  /**
   * Format forward content
   */
  _formatForwardContent(message) {
    const bodyText = message.body || '';
    
    return `
  <div style="border-left: 4px solid #19f3f7; padding: 12px 16px; margin: 0 0 16px 0; background-color: rgba(25, 243, 247, 0.1); user-select: text; -webkit-user-select: text; cursor: text;">
    <p style="color: #19f3f7; font-weight: bold; margin: 0 0 8px 0; user-select: text;">▸ FORWARDED MESSAGE</p>
    <p style="margin: 4px 0; user-select: text;"><strong style="color: #19f3f7;">From:</strong> <span style="color: #19f3f7;">${message.from}</span></p>
    <p style="margin: 4px 0; user-select: text;"><strong style="color: #19f3f7;">To:</strong> <span style="color: #19f3f7;">${message.to}</span></p>
    <p style="margin: 4px 0; user-select: text;"><strong style="color: #19f3f7;">Date:</strong> <span style="color: #cccccc;">${message.timestamp}</span></p>
    <p style="margin: 4px 0; user-select: text;"><strong style="color: #19f3f7;">Subject:</strong> <span style="color: #ffffff;">${message.subject}</span></p>
    <hr style="border-color: #19f3f7; opacity: 0.3; margin: 8px 0;">
    <div style="color: #999999; font-size: 0.95em; margin: 8px 0 0 0; user-select: text;">${bodyText}</div>
  </div>
  <hr style="border: 1px solid #19f3f7; margin: 16px 0;">
  <p><br></p>
    `;
  }
  
  /**
   * Open contact picker
   */
  _openContactPicker() {
    new ContactManagerApp({
      selectMode: true,
      onSelect: (contact) => {
        const input = this.element.find('[name="to"]');
        input.val(contact.email);
        this.formData.to = contact.email;
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
    const userContacts = await game.user.getFlag(MODULE_ID, "contacts") || [];
    
    const actorContacts = game.actors.contents
      .filter(a => a.getFlag(MODULE_ID, "emailAddress"))
      .map(a => ({
        name: a.name,
        email: a.getFlag(MODULE_ID, "emailAddress"),
        img: a.img
      }));
    
    const allContacts = [...userContacts, ...actorContacts];
    const uniqueContacts = Array.from(
      new Map(allContacts.map(c => [c.email, c])).values()
    );
    
    input.on('input', (e) => {
      const value = e.target.value.toLowerCase().trim();
      
      if (!value) {
        suggestions.hide();
        return;
      }
      
      const matches = uniqueContacts.filter(c => 
        c.name.toLowerCase().includes(value) ||
        c.email.toLowerCase().includes(value)
      ).slice(0, 5);
      
      if (matches.length === 0) {
        suggestions.hide();
        return;
      }
      
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
    
    suggestions.on('click', '.ncm-composer__suggestion-item', (e) => {
      const email = $(e.currentTarget).data('email');
      input.val(email);
      this.formData.to = email;
      suggestions.hide();
    });
    
    input.on('blur', () => {
      setTimeout(() => suggestions.hide(), 200);
    });
  }

  /**
   * Show emoji picker
   */
  _showEmojiPicker() {
    const emojis = [
      '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃',
      '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😙',
      '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔',
      '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '🤥',
      '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮',
      '🤧', '🥵', '🥶', '😵', '🤯', '🤠', '🥳', '😎', '🤓', '🧐',
      '👍', '👎', '👌', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉',
      '👆', '👇', '☝️', '✋', '🤚', '🖐️', '🖖', '👋', '🤝', '💪',
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔',
      '⭐', '🌟', '✨', '⚡', '🔥', '💥', '💯', '✅', '❌', '⚠️'
    ];
    
    const content = `
      <div class="ncm-emoji-picker">
        ${emojis.map(emoji => `<button type="button" class="ncm-emoji-btn" data-emoji="${emoji}">${emoji}</button>`).join('')}
      </div>
      <style>
        .ncm-emoji-picker {
          display: grid;
          grid-template-columns: repeat(10, 1fr);
          gap: 4px;
          max-height: 300px;
          overflow-y: auto;
        }
        .ncm-emoji-btn {
          font-size: 24px;
          padding: 8px;
          border: 1px solid #333;
          background: #1a1a1a;
          cursor: pointer;
          border-radius: 4px;
          transition: all 0.2s;
        }
        .ncm-emoji-btn:hover {
          background: #F65261;
          transform: scale(1.1);
        }
      </style>
    `;
    
    new Dialog({
      title: "Insert Emoji",
      content: content,
      buttons: {},
      render: (html) => {
        html.find('.ncm-emoji-btn').on('click', (e) => {
          const emoji = $(e.currentTarget).data('emoji');
          document.execCommand('insertText', false, emoji);
          this.element.find('.ncm-composer__editor').focus();
          html.closest('.app').find('.header-button.close').click();
        });
      }
    }).render(true);
  }
  
  /**
   * Send message
   */
  async sendMessage() {
    const senderEmail = this.actor?.getFlag(MODULE_ID, "emailAddress");
    
    if (!senderEmail) {
      ui.notifications.error("You must set up your email address first.");
      return;
    }
    
    const to = this.element.find('[name="to"]').val()?.trim() || '';
    const subject = this.element.find('[name="subject"]').val()?.trim() || '';
    const contentDiv = this.element.find('.ncm-composer__editor')[0];
    const content = contentDiv?.innerHTML?.trim() || '';
    
    console.log(`${MODULE_ID} | Sending:`, { to, subject, contentLength: content.length });
    
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
    
    const strippedContent = content.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, '').trim();
    if (!content || !strippedContent) {
      ui.notifications.error("Please enter message content.");
      return;
    }
    
    try {
      if (!game.nightcity?.messageManager) {
        console.error(`${MODULE_ID} | Message manager not available`);
        ui.notifications.error("Message system not ready. Please try again.");
        return;
      }
      
      const messageData = {
        from: `${this.actor.name} <${senderEmail}>`,
        to,
        subject,
        content,
        timestamp: new Date().toISOString(),
        actorId: this.actor.id
      };
      
      await game.nightcity.messageManager.sendMessage(messageData);
      
      ui.notifications.info("Message sent!");
      this.close();
      
    } catch (error) {
      console.error(`${MODULE_ID} | Error sending message:`, error);
      ui.notifications.error(`Failed to send message: ${error.message}`);
    }
  }
  
  activateListeners(html) {
    super.activateListeners(html);
    
    // Setup email button
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
    
    // Font family selector
    html.find('[data-action="font-family"]').on('change', (e) => {
      const font = e.target.value;
      if (font) {
        document.execCommand('fontName', false, font);
        html.find('.ncm-composer__editor').focus();
        e.target.value = ''; // Reset
      }
    });
    
    // Font size selector
    html.find('[data-action="font-size"]').on('change', (e) => {
      const size = e.target.value;
      if (size) {
        document.execCommand('fontSize', false, size);
        html.find('.ncm-composer__editor').focus();
        e.target.value = ''; // Reset
      }
    });
    
    // Text color
    html.find('[data-action="text-color"]').on('click', (e) => {
      e.preventDefault();
      const colorPicker = $(e.currentTarget).siblings('.ncm-composer__color-picker[data-color-type="text"]');
      colorPicker.click();
    });
    
    html.find('.ncm-composer__color-picker[data-color-type="text"]').on('change', (e) => {
      const color = e.target.value;
      document.execCommand('foreColor', false, color);
      html.find('.ncm-composer__editor').focus();
    });
    
    // Highlight color
    html.find('[data-action="highlight-color"]').on('click', (e) => {
      e.preventDefault();
      const colorPicker = $(e.currentTarget).siblings('.ncm-composer__color-picker[data-color-type="background"]');
      colorPicker.click();
    });
    
    html.find('.ncm-composer__color-picker[data-color-type="background"]').on('change', (e) => {
      const color = e.target.value;
      document.execCommand('hiliteColor', false, color);
      html.find('.ncm-composer__editor').focus();
    });
    
    // Standard formatting
    html.find('[data-format]').on('click', (e) => {
      e.preventDefault();
      const format = $(e.currentTarget).data('format');
      const blockType = $(e.currentTarget).data('block-type');
      const editor = html.find('.ncm-composer__editor')[0];
      
      editor.focus();
      
      try {
        // Special handling for lists
        if (format === 'insertUnorderedList' || format === 'insertOrderedList') {
          // Get selection
          const selection = window.getSelection();
          if (selection.rangeCount > 0) {
            document.execCommand(format, false, null);
          }
        } else if (blockType) {
          document.execCommand(format, false, blockType);
        } else {
          document.execCommand(format, false, null);
        }
      } catch (error) {
        console.warn(`${MODULE_ID} | Command ${format} not supported:`, error);
      }
      
      editor.focus();
    });
    
    // Insert link
    html.find('[data-action="insert-link"]').on('click', async (e) => {
      e.preventDefault();
      
      new Dialog({
        title: "Insert Link",
        content: `
          <form>
            <div class="form-group">
              <label>URL:</label>
              <input type="text" name="url" placeholder="https://example.com" autofocus />
            </div>
            <div class="form-group">
              <label>Link Text (optional):</label>
              <input type="text" name="text" placeholder="Click here" />
            </div>
          </form>
        `,
        buttons: {
          insert: {
            icon: '<i class="fas fa-check"></i>',
            label: "Insert",
            callback: (html) => {
              const url = html.find('[name="url"]').val();
              const text = html.find('[name="text"]').val();
              
              if (url) {
                if (text) {
                  document.execCommand('insertHTML', false, `<a href="${url}">${text}</a>`);
                } else {
                  document.execCommand('createLink', false, url);
                }
                this.element.find('.ncm-composer__editor').focus();
              }
            }
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: "Cancel"
          }
        },
        default: "insert"
      }).render(true);
    });
    
    // Insert image
    html.find('[data-action="insert-image"]').on('click', async (e) => {
      e.preventDefault();
      
      new FilePicker({
        type: "image",
        callback: (path) => {
          document.execCommand('insertImage', false, path);
          this.element.find('.ncm-composer__editor').focus();
        }
      }).browse();
    });
    
    // Insert emoji
    html.find('[data-action="insert-emoji"]').on('click', (e) => {
      e.preventDefault();
      this._showEmojiPicker();
    });
    
    // Contact picker
    html.find('[data-action="select-contact"]').on('click', () => {
      this._openContactPicker();
    });
    
    // Recipient autocomplete
    const recipientInput = html.find('[name="to"]');
    const suggestions = html.find('.ncm-composer__suggestions');
    this._setupRecipientAutocomplete(recipientInput, suggestions);
    
    // Send button
    html.find('[data-action="send"]').on('click', async (e) => {
      e.preventDefault();
      await this.sendMessage();
    });
    
    // Cancel button
    html.find('[data-action="cancel"]').on('click', () => {
      this.close();
    });
    
    // Handle Enter in subject
    html.find('[name="subject"]').on('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        html.find('.ncm-composer__editor').focus();
      }
    });
  }
  
  /**
   * Override render to check email on open
   */
  async render(force = false, options = {}) {
    if (!this.rendered) {
      const hasEmail = await this._ensureEmailSetup();
      if (!hasEmail) {
        return this;
      }
    }
    
    return super.render(force, options);
  }
}