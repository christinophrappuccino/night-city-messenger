/**
 * GM Master Contact Manager
 * File: scripts/ui/components/GMContactManager/GMContactManagerApp.js
 * Module: cyberpunkred-messenger
 * Description: GM-only interface for managing all email identities in the world
 */

import { MODULE_ID } from '../../../utils/constants.js';
import { BaseApplication } from '../BaseApplication.js';
import { isValidEmail } from '../../../utils/validators.js';

export class GMContactManagerApp extends BaseApplication {
  constructor(options = {}) {
    super(options);
    
    if (!game.user.isGM) {
      ui.notifications.error('GM Master Contact Manager is only accessible to GMs');
      this.close();
      return;
    }
    
    this.masterContactService = game.nightcity?.masterContactService;
    this.contacts = [];
    this.searchTerm = '';
    this.typeFilter = 'all'; // 'all', 'actor', 'custom', 'corporate', etc.
  }
  
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["ncm-app", "ncm-gm-contact-manager"],
      template: `modules/${MODULE_ID}/templates/gm-contact-manager/gm-contact-manager.hbs`,
      width: 900,
      height: 700,
      resizable: true,
      title: "🔒 GM Master Contact Directory"
    });
  }
  
  async getData(options = {}) {
    await this._loadContacts();
    
    // Filter contacts
    let filtered = this.contacts;
    
    // Search filter
    if (this.searchTerm && this.searchTerm.trim() !== '') {
      const term = this.searchTerm.toLowerCase();
      filtered = filtered.filter(c => 
        (c.name && c.name.toLowerCase().includes(term)) ||
        (c.email && c.email.toLowerCase().includes(term)) ||
        (c.organization && c.organization.toLowerCase().includes(term)) ||
        (c.role && c.role.toLowerCase().includes(term))
      );
    }
    
    // Type filter
    if (this.typeFilter && this.typeFilter !== 'all') {
      if (this.typeFilter === 'actor') {
        filtered = filtered.filter(c => c.isActor);
      } else if (this.typeFilter === 'custom') {
        filtered = filtered.filter(c => !c.isActor);
      } else {
        filtered = filtered.filter(c => c.type === this.typeFilter);
      }
    }
    
    // Group by type for display
    const grouped = {
      actors: filtered.filter(c => c.isActor),
      custom: filtered.filter(c => !c.isActor)
    };
    
    return {
      ...super.getData(options),
      contacts: filtered,
      groupedContacts: grouped,
      contactCount: this.contacts.length,
      filteredCount: filtered.length,
      actorCount: this.contacts.filter(c => c.isActor).length,
      customCount: this.contacts.filter(c => !c.isActor).length,
      searchTerm: this.searchTerm,
      typeFilter: this.typeFilter,
      hasContacts: this.contacts.length > 0,
      showingFiltered: this.searchTerm || this.typeFilter !== 'all'
    };
  }
  
  async _loadContacts() {
    if (!this.masterContactService) {
      console.error(`${MODULE_ID} | Master Contact Service not available`);
      this.contacts = [];
      return;
    }
    
    await this.masterContactService.loadContacts();
    this.contacts = this.masterContactService.getAllContacts();
  }
  
  activateListeners(html) {
    super.activateListeners(html);
    
    // Search
    html.find('[data-action="search"]').on('input', (e) => {
      this.searchTerm = $(e.currentTarget).val();
      this.render(false);
    });
    
    // Type filter
    html.find('[data-filter="type"]').on('change', (e) => {
      this.typeFilter = $(e.currentTarget).val();
      this.playSound('click');
      this.render(false);
    });
    
    // Add contact
    html.find('[data-action="add-contact"]').on('click', () => {
      this.addContact();
    });
    
    // Edit contact
    html.find('[data-action="edit-contact"]').on('click', (e) => {
      const contactId = $(e.currentTarget).closest('[data-contact-id]').data('contact-id');
      this.editContact(contactId);
    });
    
    // Delete contact
    html.find('[data-action="delete-contact"]').on('click', (e) => {
      const contactId = $(e.currentTarget).closest('[data-contact-id]').data('contact-id');
      this.deleteContact(contactId);
    });
    
    // Refresh
    html.find('[data-action="refresh"]').on('click', () => {
      this.render(false);
    });
  }
  
  /**
   * Show add/edit contact dialog
   */
  async _showContactDialog(existingContact = null) {
    const isEdit = !!existingContact;
    const isActor = existingContact?.isActor || false;
    
    return new Promise((resolve) => {
      new Dialog({
        title: isEdit ? 'Edit Contact' : 'Add Contact to Master List',
        content: `
          <form class="ncm-contact-form">
            <div class="form-group">
              <label>Name * ${isActor ? '<em>(Actor-linked)</em>' : ''}</label>
              <input type="text" name="name" value="${existingContact?.name || ''}" 
                     ${isActor ? 'disabled' : 'required'} />
            </div>
            
            <div class="form-group">
              <label>Email Address * ${isActor ? '<em>(Actor-linked)</em>' : ''}</label>
              <input type="email" name="email" value="${existingContact?.email || ''}" 
                     ${isActor ? 'disabled' : 'required'} 
                     placeholder="name@domain.net" />
            </div>
            
            <div class="form-group">
              <label>Organization/Corp</label>
              <input type="text" name="organization" value="${existingContact?.organization || ''}" 
                     placeholder="Arasaka, Militech, etc." />
            </div>
            
            <div class="form-group">
              <label>Role/Title</label>
              <input type="text" name="role" value="${existingContact?.role || ''}" 
                     placeholder="Fixer, Corpo, Netrunner, etc." />
            </div>
            
            <div class="form-group">
              <label>Avatar Image URL</label>
              <input type="text" name="img" value="${existingContact?.img || ''}" 
                     placeholder="icons/svg/mystery-man.svg" />
            </div>
            
            <div class="form-group">
              <label>GM Notes</label>
              <textarea name="notes" rows="3" placeholder="Private notes about this contact...">${existingContact?.notes || ''}</textarea>
            </div>
            
            ${isActor ? '<p class="hint"><i class="fas fa-info-circle"></i> This contact is linked to an actor. Name and email cannot be changed here.</p>' : ''}
          </form>
          
          <style>
            .ncm-contact-form { display: flex; flex-direction: column; gap: 12px; }
            .ncm-contact-form .form-group { display: flex; flex-direction: column; gap: 4px; }
            .ncm-contact-form label { font-weight: bold; color: #F65261; }
            .ncm-contact-form label em { font-weight: normal; color: #999; font-size: 0.9em; }
            .ncm-contact-form input, .ncm-contact-form textarea { 
              padding: 8px; 
              background: #2a0000; 
              border: 1px solid #666; 
              color: white; 
              border-radius: 4px;
            }
            .ncm-contact-form input:disabled { opacity: 0.5; cursor: not-allowed; }
            .ncm-contact-form .hint { 
              background: rgba(25, 243, 247, 0.1); 
              border-left: 3px solid #19f3f7; 
              padding: 8px; 
              margin-top: 8px;
              font-size: 0.9em;
            }
          </style>
        `,
        buttons: {
          save: {
            icon: '<i class="fas fa-save"></i>',
            label: isEdit ? 'Update' : 'Add',
            callback: (html) => {
              const formData = {
                name: html.find('[name="name"]').val().trim(),
                email: html.find('[name="email"]').val().trim(),
                organization: html.find('[name="organization"]').val().trim(),
                role: html.find('[name="role"]').val().trim(),
                img: html.find('[name="img"]').val().trim() || 'icons/svg/mystery-man.svg',
                notes: html.find('[name="notes"]').val().trim()
              };
              
              resolve(formData);
            }
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: 'Cancel',
            callback: () => resolve(null)
          }
        },
        default: 'save'
      }).render(true);
    });
  }
  
  /**
   * Add new contact
   */
  async addContact() {
    const contactData = await this._showContactDialog();
    
    if (!contactData) return;
    
    const success = await this.masterContactService.addContact(contactData);
    
    if (success) {
      this.playSound('notification');
      this.render(false);
    }
  }
  
  /**
   * Edit existing contact
   */
  async editContact(contactId) {
    const contact = this.contacts.find(c => c.id === contactId);
    
    if (!contact) {
      ui.notifications.warn('Contact not found');
      return;
    }
    
    if (contact.isActor) {
      ui.notifications.warn('Actor-linked contacts must be edited on the actor sheet (email address field)');
      return;
    }
    
    const updates = await this._showContactDialog(contact);
    
    if (!updates) return;
    
    const success = await this.masterContactService.updateContact(contactId, updates);
    
    if (success) {
      this.playSound('click');
      this.render(false);
    }
  }
  
  /**
   * Delete contact
   */
  async deleteContact(contactId) {
    const contact = this.contacts.find(c => c.id === contactId);
    
    if (!contact) {
      ui.notifications.warn('Contact not found');
      return;
    }
    
    if (contact.isActor) {
      ui.notifications.warn('Cannot delete actor-linked contacts. They are synced from actors.');
      return;
    }
    
    const confirmed = await Dialog.confirm({
      title: 'Delete Contact',
      content: `<p>Delete <strong>${contact.name}</strong> (${contact.email}) from the master list?</p><p>This cannot be undone.</p>`
    });
    
    if (!confirmed) return;
    
    const success = await this.masterContactService.deleteContact(contactId);
    
    if (success) {
      this.playSound('click');
      this.render(false);
    }
  }
}