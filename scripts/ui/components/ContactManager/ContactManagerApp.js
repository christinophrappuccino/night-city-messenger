/**
 * Contact Manager Application
 * File: scripts/ui/components/ContactManager/ContactManagerApp.js
 * Module: cyberpunkred-messenger
 * Description: Manage contacts and email addresses
 */

import { MODULE_ID } from '../../../utils/constants.js';
import { BaseApplication } from '../BaseApplication.js';
import { ContactRepository } from '../../../data/ContactRepository.js';

export class ContactManagerApp extends BaseApplication {
  constructor(options = {}) {
    super(options);
    
    this.contactRepository = options.contactRepository || new ContactRepository();
    
    this.searchQuery = '';
    this.selectedCategory = 'all';
  }
  
  /**
   * Default options
   */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["ncm-app", "ncm-contacts"],
      template: `modules/${MODULE_ID}/templates/contact-manager/contact-manager.hbs`,
      width: 600,
      height: 700,
      resizable: true,
      title: "Contact Manager"
    });
  }
  
  /**
   * Get data for template
   */
  getData(options = {}) {
    const data = super.getData(options);
    
    // Get contacts
    let contacts = this.searchQuery 
      ? this.contactRepository.search(this.searchQuery)
      : this.contactRepository.getAll();
    
    // Filter by category
    if (this.selectedCategory !== 'all') {
      contacts = contacts.filter(c => c.category === this.selectedCategory);
    }
    
    // Sort by name
    contacts.sort((a, b) => a.name.localeCompare(b.name));
    
    // Get categories
    const categories = this.contactRepository.getCategories();
    
    return {
      ...data,
      contacts,
      categories,
      searchQuery: this.searchQuery,
      selectedCategory: this.selectedCategory,
      hasContacts: contacts.length > 0
    };
  }
  
  /**
   * Add new contact
   */
  async addContact() {
    const content = `
      <form class="ncm-contact-form">
        <div class="form-group">
          <label>Name: *</label>
          <input type="text" name="name" required />
        </div>
        <div class="form-group">
          <label>Email: *</label>
          <input type="email" name="email" required />
        </div>
        <div class="form-group">
          <label>Category:</label>
          <input type="text" name="category" placeholder="e.g., friends, work, family" />
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
            try {
              const contactData = {
                name: html.find('[name="name"]').val().trim(),
                email: html.find('[name="email"]').val().trim(),
                category: html.find('[name="category"]').val().trim() || 'general',
                notes: html.find('[name="notes"]').val().trim()
              };
              
              await this.contactRepository.create(contactData);
              
              ui.notifications.info('Contact added');
              this.render(false);
            } catch (error) {
              ui.notifications.error(error.message);
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
   * Edit contact
   * @param {string} contactId - Contact ID
   */
  async editContact(contactId) {
    const contact = this.contactRepository.findById(contactId);
    if (!contact) return;
    
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
          <label>Category:</label>
          <input type="text" name="category" value="${contact.category || ''}" />
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
            try {
              const updates = {
                name: html.find('[name="name"]').val().trim(),
                email: html.find('[name="email"]').val().trim(),
                category: html.find('[name="category"]').val().trim() || 'general',
                notes: html.find('[name="notes"]').val().trim()
              };
              
              await this.contactRepository.update(contactId, updates);
              
              ui.notifications.info('Contact updated');
              this.render(false);
            } catch (error) {
              ui.notifications.error(error.message);
            }
          }
        },
        delete: {
          icon: '<i class="fas fa-trash"></i>',
          label: 'Delete',
          callback: async () => {
            const confirmed = await Dialog.confirm({
              title: 'Delete Contact',
              content: `<p>Are you sure you want to delete <strong>${contact.name}</strong>?</p>`,
              yes: () => true,
              no: () => false
            });
            
            if (confirmed) {
              await this.contactRepository.delete(contactId);
              ui.notifications.info('Contact deleted');
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
   * Import contacts from actors
   */
  async importFromActors() {
    try {
      const count = await this.contactRepository.importFromActors();
      
      ui.notifications.info(`Imported ${count} contacts from actors`);
      this.render(false);
    } catch (error) {
      ui.notifications.error('Failed to import contacts');
    }
  }
  
  /**
   * Activate listeners
   */
  activateListeners(html) {
    super.activateListeners(html);
    
    // Add contact button
    html.find('.ncm-contacts__add-btn').on('click', () => {
      this.addContact();
      this.playSound('click');
    });
    
    // Edit contact
    html.find('.ncm-contact__edit-btn').on('click', (event) => {
      const contactId = $(event.currentTarget).closest('.ncm-contact-item').data('contact-id');
      this.editContact(contactId);
      this.playSound('click');
    });
    
    // Compose to contact
    html.find('.ncm-contact__compose-btn').on('click', (event) => {
      const email = $(event.currentTarget).closest('.ncm-contact-item').data('email');
      
      this.eventBus.emit('composer:open', {
        to: email
      });
      
      this.playSound('click');
    });
    
    // Search
    html.find('.ncm-contacts__search-input').on('input', (event) => {
      this.searchQuery = $(event.currentTarget).val();
      this.render(false);
    });
    
    // Category filter
    html.find('.ncm-contacts__category-filter').on('change', (event) => {
      this.selectedCategory = $(event.currentTarget).val();
      this.render(false);
    });
    
    // Import button
    html.find('.ncm-contacts__import-btn').on('click', () => {
      this.importFromActors();
      this.playSound('click');
    });
  }
}