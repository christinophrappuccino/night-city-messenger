/**
 * Contact Manager Application (Complete)
 * File: scripts/ui/components/ContactManager/ContactManagerApp.js
 * Module: cyberpunkred-messenger
 * Description: Full contact management system
 */

import { MODULE_ID } from '../../../utils/constants.js';
import { isValidEmail } from '../../../utils/validators.js';
import { BaseApplication } from '../BaseApplication.js';

export class ContactManagerApp extends BaseApplication {
  constructor(options = {}) {
    super(options);
    
    this.contacts = [];
    this.searchTerm = '';
    this.viewMode = 'list';
    this.selectMode = options.selectMode || false;
    this.onSelect = options.onSelect || null;
    
    // Use passed actor or fallback to user's character
    this.actor = options.actor || game.user.character;
    this.actorId = options.actorId || this.actor?.id;
  }
  
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["ncm-app", "ncm-contact-manager"],
      template: `modules/${MODULE_ID}/templates/contact-manager/contact-manager.hbs`,
      width: 600,
      height: 700,
      resizable: true,
      title: "Contact Manager"
    });
  }
  
  async getData(options = {}) {
    await this._loadContacts();
    
    // Filter contacts by search
    let filtered = this.contacts;
    if (this.searchTerm) {
      const term = this.searchTerm.toLowerCase();
      filtered = this.contacts.filter(c => 
        c.name.toLowerCase().includes(term) ||
        c.email.toLowerCase().includes(term)
      );
    }
    
    // Sort alphabetically
    filtered.sort((a, b) => a.name.localeCompare(b.name));
    
    // Group by first letter for list view
    const grouped = {};
    if (this.viewMode === 'list') {
      for (const contact of filtered) {
        const letter = contact.name[0].toUpperCase();
        if (!grouped[letter]) grouped[letter] = [];
        grouped[letter].push(contact);
      }
    }
    
    return {
      ...super.getData(options),
      contacts: filtered,
      groupedContacts: grouped,
      contactCount: this.contacts.length,
      searchTerm: this.searchTerm,
      viewMode: this.viewMode,
      selectMode: this.selectMode
    };
  }
  
  /**
   * Load contacts from user flags
   */
  async _loadContacts() {
    try {
      // Load contacts from the specific actor's perspective
      this.contacts = await game.user.getFlag(MODULE_ID, "contacts") || [];
      
      // Also scan for actors with email addresses
      const actorContacts = game.actors.contents
        .filter(a => a.getFlag(MODULE_ID, "emailAddress"))
        .map(a => ({
          id: `actor_${a.id}`,
          name: a.name,
          email: a.getFlag(MODULE_ID, "emailAddress"),
          img: a.img,
          type: 'character',
          readonly: true
        }));
      
      // Merge, avoiding duplicates
      const emailSet = new Set(this.contacts.map(c => c.email));
      for (const ac of actorContacts) {
        if (!emailSet.has(ac.email)) {
          this.contacts.push(ac);
          emailSet.add(ac.email);
        }
      }
      
      return this.contacts;
    } catch (error) {
      console.error(`${MODULE_ID} | Error loading contacts:`, error);
      return [];
    }
  }
  
  /**
   * Save contacts to user flags
   */
  async _saveContacts() {
    // Only save non-readonly contacts
    const toSave = this.contacts.filter(c => !c.readonly);
    await game.user.setFlag(MODULE_ID, "contacts", toSave);
  }
  
  /**
   * Show add contact dialog
   */
  async addContact() {
    const content = `
      <form class="ncm-contact-form">
        <div class="form-group">
          <label>Name: *</label>
          <input type="text" name="name" required autocomplete="off" />
        </div>
        <div class="form-group">
          <label>Email: *</label>
          <input type="email" name="email" required autocomplete="off" />
        </div>
        <div class="form-group">
          <label>Notes:</label>
          <textarea name="notes" rows="3"></textarea>
        </div>
      </form>
    `;
    
    new Dialog({
      title: 'Add Contact',
      content,
      buttons: {
        save: {
          icon: '<i class="fas fa-save"></i>',
          label: 'Save',
          callback: async (html) => {
            const name = html.find('[name="name"]').val().trim();
            const email = html.find('[name="email"]').val().trim();
            const notes = html.find('[name="notes"]').val().trim();
            
            if (!name || !email) {
              ui.notifications.error("Name and email are required.");
              return;
            }
            
            if (!isValidEmail(email)) {
              ui.notifications.error("Invalid email format.");
              return;
            }
            
            // Check for duplicate
            if (this.contacts.some(c => c.email === email)) {
              ui.notifications.warn("Contact with this email already exists.");
              return;
            }
            
            // Add contact
            this.contacts.push({
              id: foundry.utils.randomID(),
              name,
              email,
              notes,
              createdAt: new Date().toISOString()
            });
            
            await this._saveContacts();
            ui.notifications.info(`Contact "${name}" added.`);
            this.render(false);
          }
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: 'Cancel'
        }
      },
      default: 'save'
    }, {
      classes: ['dialog', 'ncm-dialog'],
      width: 400
    }).render(true);
  }
  
  /**
   * Edit contact
   */
  async editContact(contactId) {
    const contact = this.contacts.find(c => c.id === contactId);
    if (!contact) return;
    
    if (contact.readonly) {
      ui.notifications.warn("Cannot edit character-linked contacts.");
      return;
    }
    
    const content = `
      <form class="ncm-contact-form">
        <div class="form-group">
          <label>Name: *</label>
          <input type="text" name="name" value="${contact.name}" required />
        </div>
        <div class="form-group">
          <label>Email: *</label>
          <input type="email" name="email" value="${contact.email}" required />
        </div>
        <div class="form-group">
          <label>Notes:</label>
          <textarea name="notes" rows="3">${contact.notes || ''}</textarea>
        </div>
      </form>
    `;
    
    new Dialog({
      title: 'Edit Contact',
      content,
      buttons: {
        save: {
          icon: '<i class="fas fa-save"></i>',
          label: 'Save',
          callback: async (html) => {
            contact.name = html.find('[name="name"]').val().trim();
            contact.email = html.find('[name="email"]').val().trim();
            contact.notes = html.find('[name="notes"]').val().trim();
            
            if (!isValidEmail(contact.email)) {
              ui.notifications.error("Invalid email format.");
              return;
            }
            
            await this._saveContacts();
            ui.notifications.info("Contact updated.");
            this.render(false);
          }
        },
        delete: {
          icon: '<i class="fas fa-trash"></i>',
          label: 'Delete',
          callback: async () => {
            const confirmed = await Dialog.confirm({
              title: 'Delete Contact',
              content: `<p>Delete <strong>${contact.name}</strong>?</p>`
            });
            
            if (confirmed) {
              this.contacts = this.contacts.filter(c => c.id !== contactId);
              await this._saveContacts();
              ui.notifications.info("Contact deleted.");
              this.render(false);
            }
          }
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: 'Cancel'
        }
      },
      default: 'save'
    }, {
      classes: ['dialog', 'ncm-dialog'],
      width: 400
    }).render(true);
  }
  
  /**
   * Select contact (if in select mode)
   */
  selectContact(contact) {
    if (this.selectMode && this.onSelect) {
      this.onSelect(contact);
      this.close();
    }
  }
  
  activateListeners(html) {
    super.activateListeners(html);
    
    // Add contact button
    html.find('[data-action="add-contact"]').on('click', () => {
      this.addContact();
    });
    
    // Edit contact
    html.find('[data-action="edit-contact"]').on('click', (e) => {
      const contactId = $(e.currentTarget).data('contact-id');
      this.editContact(contactId);
    });
    
    // Delete contact
    html.find('[data-action="delete-contact"]').on('click', async (e) => {
      const contactId = $(e.currentTarget).data('contact-id');
      const contact = this.contacts.find(c => c.id === contactId);
      
      if (!contact) return;
      
      if (contact.readonly) {
        ui.notifications.warn("Cannot delete character-linked contacts.");
        return;
      }
      
      const confirmed = await Dialog.confirm({
        title: 'Delete Contact',
        content: `<p>Delete <strong>${contact.name}</strong>?</p>`
      });
      
      if (confirmed) {
        this.contacts = this.contacts.filter(c => c.id !== contactId);
        await this._saveContacts();
        ui.notifications.info("Contact deleted.");
        this.render(false);
      }
    });
    
    // Select contact (in select mode)
    html.find('[data-action="select-contact"]').on('click', (e) => {
      const contactId = $(e.currentTarget).data('contact-id');
      const contact = this.contacts.find(c => c.id === contactId);
      if (contact) this.selectContact(contact);
    });
    
    // Search
    html.find('[data-action="search"]').on('input', (e) => {
      this.searchTerm = $(e.currentTarget).val();
      this.render(false);
    });
    
    // View mode toggle
    html.find('[data-action="view-list"]').on('click', () => {
      this.viewMode = 'list';
      this.render(false);
    });
    
    html.find('[data-action="view-grid"]').on('click', () => {
      this.viewMode = 'grid';
      this.render(false);
    });
  }
}