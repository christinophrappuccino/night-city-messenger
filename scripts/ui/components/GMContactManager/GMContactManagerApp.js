/**
 * ENHANCED GM Master Contact Manager
 * File: scripts/ui/components/GMContactManager/GMContactManagerApp.js
 * Module: cyberpunkred-messenger
 * Description: GM-only interface with SORTING, TAGS, and FULL EDITING
 * 
 * ENHANCEMENTS:
 * - Multi-field sorting with UI controls
 * - Tag/label filtering
 * - Edit actor emails (with warnings)
 * - Quick "Send As" button
 * - Import/Export CSV
 * - Better visual layout
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
    this.typeFilter = 'all'; // 'all', 'actor', 'custom'
    this.tagFilter = 'all'; // 'all' or specific tag
    this.sortBy = 'name'; // 'name', 'email', 'organization', 'type', 'createdAt', 'role'
    this.sortOrder = 'asc'; // 'asc' or 'desc'
  }
  
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["ncm-app", "ncm-gm-contact-manager"],
      template: `modules/${MODULE_ID}/templates/gm-contact-manager/gm-contact-manager.hbs`,
      width: 1000,
      height: 750,
      resizable: true,
      title: "🔒 GM Master Contact Directory"
    });
  }
  
  async getData(options = {}) {
    await this._loadContacts();
    
    // Get all available tags
    const allTags = this.masterContactService?.getAllTags() || [];
    
    // Filter contacts
    let filtered = this.contacts;
    
    // Search filter
    if (this.searchTerm && this.searchTerm.trim() !== '') {
      const term = this.searchTerm.toLowerCase();
      filtered = filtered.filter(c => 
        (c.name && c.name.toLowerCase().includes(term)) ||
        (c.email && c.email.toLowerCase().includes(term)) ||
        (c.organization && c.organization.toLowerCase().includes(term)) ||
        (c.role && c.role.toLowerCase().includes(term)) ||
        (c.tags && c.tags.some(tag => tag.toLowerCase().includes(term)))
      );
    }
    
    // Type filter
    if (this.typeFilter && this.typeFilter !== 'all') {
      if (this.typeFilter === 'actor') {
        filtered = filtered.filter(c => c.isActor);
      } else if (this.typeFilter === 'custom') {
        filtered = filtered.filter(c => !c.isActor);
      }
    }
    
    // Tag filter
    if (this.tagFilter && this.tagFilter !== 'all') {
      filtered = filtered.filter(c => 
        c.tags && c.tags.includes(this.tagFilter)
      );
    }
    
    // Apply sorting
    filtered = this._sortContacts(filtered);
    
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
      tagFilter: this.tagFilter,
      allTags: allTags,
      sortBy: this.sortBy,
      sortOrder: this.sortOrder,
      hasContacts: this.contacts.length > 0,
      showingFiltered: this.searchTerm || this.typeFilter !== 'all' || this.tagFilter !== 'all'
    };
  }
  
  /**
   * Sort contacts based on current sort settings
   */
  _sortContacts(contacts) {
    const multiplier = this.sortOrder === 'desc' ? -1 : 1;
    
    return contacts.sort((a, b) => {
      let aVal, bVal;
      
      switch (this.sortBy) {
        case 'name':
          aVal = (a.name || '').toLowerCase();
          bVal = (b.name || '').toLowerCase();
          break;
        case 'email':
          aVal = (a.email || '').toLowerCase();
          bVal = (b.email || '').toLowerCase();
          break;
        case 'organization':
          aVal = (a.organization || '').toLowerCase();
          bVal = (b.organization || '').toLowerCase();
          break;
        case 'type':
          aVal = a.isActor ? 'actor' : 'custom';
          bVal = b.isActor ? 'actor' : 'custom';
          break;
        case 'createdAt':
          aVal = a.createdAt || '';
          bVal = b.createdAt || '';
          break;
        case 'role':
          aVal = (a.role || '').toLowerCase();
          bVal = (b.role || '').toLowerCase();
          break;
        default:
          aVal = (a.name || '').toLowerCase();
          bVal = (b.name || '').toLowerCase();
      }
      
      if (aVal < bVal) return -1 * multiplier;
      if (aVal > bVal) return 1 * multiplier;
      return 0;
    });
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
    
    // Tag filter
    html.find('[data-filter="tag"]').on('change', (e) => {
      this.tagFilter = $(e.currentTarget).val();
      this.playSound('click');
      this.render(false);
    });
    
    // Sort field selector
    html.find('[data-action="sort-by"]').on('change', (e) => {
      this.sortBy = $(e.currentTarget).val();
      this.playSound('click');
      this.render(false);
    });
    
    // Sort order toggle
    html.find('[data-action="toggle-sort-order"]').on('click', (e) => {
      this.sortOrder = this.sortOrder === 'asc' ? 'desc' : 'asc';
      this.playSound('click');
      this.render(false);
    });
    
    // Add contact
    html.find('[data-action="add-contact"]').on('click', () => {
      this.addContact();
    });
    
    // Edit contact (⚡ now works for actors too!)
    html.find('[data-action="edit-contact"]').on('click', (e) => {
      const contactId = $(e.currentTarget).closest('[data-contact-id]').data('contact-id');
      this.editContact(contactId);
    });
    
    // Delete contact
    html.find('[data-action="delete-contact"]').on('click', (e) => {
      const contactId = $(e.currentTarget).closest('[data-contact-id]').data('contact-id');
      this.deleteContact(contactId);
    });
    
    // ⚡ NEW: Send As button
    html.find('[data-action="send-as"]').on('click', async (e) => {
      const contactId = $(e.currentTarget).closest('[data-contact-id]').data('contact-id');
      await this.sendAsContact(contactId);
    });
    
    // ⚡ NEW: Import CSV
    html.find('[data-action="import-csv"]').on('click', () => {
      this.importCSV();
    });
    
    // ⚡ NEW: Export CSV
    html.find('[data-action="export-csv"]').on('click', () => {
      this.exportCSV();
    });
    
    // Refresh
    html.find('[data-action="refresh"]').on('click', () => {
      this.render(false);
    });
  }
  
  /**
   * Show add/edit contact dialog
   * ⚡ ENHANCED: Now allows editing actor contacts with warnings
   */
  async _showContactDialog(existingContact = null) {
    const isEdit = !!existingContact;
    const isActor = existingContact?.isActor || false;
    
    // Get all tags for autocomplete
    const allTags = this.masterContactService?.getAllTags() || [];
    const currentTags = existingContact?.tags || [];
    
    return new Promise((resolve) => {
      new Dialog({
        title: isEdit ? (isActor ? '⚡ Edit Actor Contact' : 'Edit Custom Contact') : 'Add Contact to Master List',
        content: `
          <form class="ncm-contact-form">
            ${isActor ? `
              <div class="form-group" style="background: rgba(246, 82, 97, 0.1); padding: 10px; border-radius: 4px; margin-bottom: 15px;">
                <i class="fas fa-exclamation-triangle" style="color: #F65261;"></i>
                <strong>Actor-Linked Contact</strong>
                <p style="margin: 5px 0 0 0; font-size: 0.9em;">Changes will be synced to the actor. The actor's name cannot be changed here.</p>
              </div>
            ` : ''}
            
            <div class="form-group">
              <label>Name *</label>
              <input type="text" name="name" value="${existingContact?.name || ''}" 
                     ${isActor ? 'disabled title="Actor name cannot be changed from here"' : 'required'} />
            </div>
            
            <div class="form-group">
              <label>Email Address * ${isActor ? '<em>(Will sync to actor)</em>' : ''}</label>
              <input type="email" name="email" value="${existingContact?.email || ''}" 
                     required 
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
              <label>Tags <em>(comma-separated)</em></label>
              <input type="text" name="tags" value="${currentTags.join(', ')}" 
                     placeholder="Fixer, Enemy, Important, etc." />
              ${allTags.length > 0 ? `
                <div style="margin-top: 5px; font-size: 0.85em; color: #999;">
                  Existing tags: ${allTags.join(', ')}
                </div>
              ` : ''}
            </div>
            
            ${!isActor ? `
              <div class="form-group">
                <label>Avatar Image URL</label>
                <input type="text" name="img" value="${existingContact?.img || ''}" 
                       placeholder="icons/svg/mystery-man.svg" />
              </div>
            ` : ''}
            
            <div class="form-group">
              <label>GM Notes</label>
              <textarea name="notes" rows="3" placeholder="Private notes about this contact...">${existingContact?.notes || ''}</textarea>
            </div>
          </form>
          
          <style>
            .ncm-contact-form .form-group {
              margin-bottom: 12px;
            }
            .ncm-contact-form label {
              display: block;
              font-weight: bold;
              margin-bottom: 4px;
              color: #F65261;
            }
            .ncm-contact-form input,
            .ncm-contact-form textarea {
              width: 100%;
              padding: 6px;
              background: rgba(0, 0, 0, 0.3);
              border: 1px solid #333;
              color: #fff;
              border-radius: 4px;
            }
            .ncm-contact-form input:disabled {
              opacity: 0.5;
              cursor: not-allowed;
            }
            .ncm-contact-form em {
              color: #19f3f7;
              font-size: 0.9em;
            }
          </style>
        `,
        buttons: {
          save: {
            icon: '<i class="fas fa-save"></i>',
            label: isEdit ? 'Update' : 'Add',
            callback: (html) => {
              const tagsInput = html.find('[name="tags"]').val().trim();
              const tags = tagsInput ? tagsInput.split(',').map(t => t.trim()).filter(t => t) : [];
              
              const formData = {
                name: html.find('[name="name"]').val().trim(),
                email: html.find('[name="email"]').val().trim(),
                organization: html.find('[name="organization"]').val().trim(),
                role: html.find('[name="role"]').val().trim(),
                tags: tags,
                notes: html.find('[name="notes"]').val().trim()
              };
              
              if (!isActor) {
                formData.img = html.find('[name="img"]').val().trim() || 'icons/svg/mystery-man.svg';
              }
              
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
      }, {
        width: 500
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
   * ⚡ ENHANCED: Now works for actor contacts too!
   */
  async editContact(contactId) {
    const contact = this.contacts.find(c => c.id === contactId);
    
    if (!contact) {
      ui.notifications.warn('Contact not found');
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
  
  /**
   * ⚡ NEW: Send message AS this contact
   */
  async sendAsContact(contactId) {
    const contact = this.contacts.find(c => c.id === contactId);
    
    if (!contact) {
      ui.notifications.warn('Contact not found');
      return;
    }
    
    // Open composer with this contact as the sender
    const MessageComposerApp = game.nightcity?.MessageComposerApp;
    if (!MessageComposerApp) {
      ui.notifications.error('Message Composer not available');
      return;
    }
    
    new MessageComposerApp({
      gmMode: true,
      fromContact: contact
    }).render(true);
    
    this.playSound('notification');
    ui.notifications.info(`Composing as ${contact.name} (${contact.email})`);
  }
  
  /**
   * ⚡ NEW: Import contacts from CSV
   */
  async importCSV() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv';
    
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      const text = await file.text();
      const lines = text.split('\n').filter(l => l.trim());
      
      if (lines.length < 2) {
        ui.notifications.error('CSV file is empty or invalid');
        return;
      }
      
      // Parse CSV (simple parser, assumes comma-separated)
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
      const data = [];
      
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim());
        const row = {};
        
        headers.forEach((header, index) => {
          row[header] = values[index] || '';
        });
        
        data.push(row);
      }
      
      // Ask about merge strategy
      const merge = await Dialog.confirm({
        title: 'Import Contacts',
        content: `
          <p>Found <strong>${data.length}</strong> contacts in CSV.</p>
          <p><strong>How should duplicates be handled?</strong></p>
          <p><em>Yes = Update existing contacts</em><br/><em>No = Skip duplicates</em></p>
        `
      });
      
      // Import
      const result = await this.masterContactService.importFromCSV(data, merge);
      
      // Show results
      let message = `Import complete:\n`;
      message += `- Added: ${result.added}\n`;
      message += `- Updated: ${result.updated}\n`;
      message += `- Skipped: ${result.skipped}\n`;
      
      if (result.errors.length > 0) {
        message += `\nErrors:\n${result.errors.slice(0, 5).join('\n')}`;
        if (result.errors.length > 5) {
          message += `\n... and ${result.errors.length - 5} more`;
        }
      }
      
      ui.notifications.info(`Imported ${result.added + result.updated} contacts`);
      console.log(message);
      
      this.render(false);
    };
    
    input.click();
  }
  
  /**
   * ⚡ NEW: Export contacts to CSV
   */
  async exportCSV() {
    const data = this.masterContactService.exportToCSV();
    
    if (data.length === 0) {
      ui.notifications.warn('No contacts to export');
      return;
    }
    
    // Create CSV content
    const headers = ['name', 'email', 'organization', 'role', 'type', 'tags', 'notes', 'createdAt'];
    let csv = headers.join(',') + '\n';
    
    data.forEach(row => {
      const values = headers.map(h => {
        let val = row[h] || '';
        // Escape commas and quotes
        if (val.includes(',') || val.includes('"')) {
          val = `"${val.replace(/"/g, '""')}"`;
        }
        return val;
      });
      csv += values.join(',') + '\n';
    });
    
    // Download file
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `night-city-contacts-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    
    ui.notifications.info(`Exported ${data.length} contacts to CSV`);
    this.playSound('notification');
  }
}