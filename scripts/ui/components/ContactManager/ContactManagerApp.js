/**
 * Contact Manager Application - ENHANCED
 * File: scripts/ui/components/ContactManager/ContactManagerApp.js
 * Module: cyberpunkred-messenger
 * 
 * NEW FEATURES:
 * - Alias/nickname support
 * - Custom tags for categorization
 * - Custom contact images
 * - Type filtering
 * - Enhanced grid view
 * - Character context from parent
 */

import { MODULE_ID } from '../../../utils/constants.js';
import { isValidEmail } from '../../../utils/validators.js';
import { BaseApplication } from '../BaseApplication.js';

export class ContactManagerApp extends BaseApplication {
  constructor(options = {}) {
    super(options);
    
    this.contacts = [];
    this.searchTerm = '';
    this.typeFilter = 'all'; // NEW: Filter by type
    this.viewMode = 'list'; // 'list' or 'grid'
    this.selectMode = options.selectMode || false;
    this.onSelect = options.onSelect || null;
    
    // ✅ FIX: Accept actor context from parent (MessageViewer)
    this.actor = options.actor || game.user.character;
    this.actorId = options.actorId || this.actor?.id;
  }
  
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["ncm-app", "ncm-contact-manager"],
      template: `modules/${MODULE_ID}/templates/contact-manager/contact-manager.hbs`,
      width: 700,
      height: 750,
      resizable: true,
      title: "Contact Manager"
    });
  }
  
  /**
   * Get data for template
   */
  async getData(options = {}) {
    await this._loadContacts();
    
    // Filter contacts by search AND type
    let filtered = this.contacts;
    
    // Apply search filter
    if (this.searchTerm && this.searchTerm.trim() !== '') {
      const term = this.searchTerm.toLowerCase();
      filtered = filtered.filter(c => 
        (c.name && c.name.toLowerCase().includes(term)) ||
        (c.email && c.email.toLowerCase().includes(term)) ||
        (c.alias && c.alias.toLowerCase().includes(term)) ||
        (c.type && c.type.toLowerCase().includes(term)) ||
        (c.tags && c.tags.some(tag => tag.toLowerCase().includes(term)))
      );
    }
    
    // ✅ FIX: Apply type filter
    if (this.typeFilter && this.typeFilter !== 'all') {
      filtered = filtered.filter(c => c.type === this.typeFilter);
    }
    
    // Sort alphabetically by name
    filtered.sort((a, b) => {
      const nameA = (a.name || '').toLowerCase();
      const nameB = (b.name || '').toLowerCase();
      return nameA.localeCompare(nameB);
    });
    
    // Create proper category structure for list view
    let contactsByCategory = [];
    
    if (this.viewMode === 'list') {
      const grouped = {};
      
      for (const contact of filtered) {
        const firstLetter = (contact.name && contact.name[0]) 
          ? contact.name[0].toUpperCase() 
          : '#';
        
        if (!grouped[firstLetter]) {
          grouped[firstLetter] = [];
        }
        
        grouped[firstLetter].push(contact);
      }
      
      contactsByCategory = Object.keys(grouped)
        .sort()
        .map(letter => ({
          category: letter,
          contacts: grouped[letter]
        }));
    }
    
    return {
      ...super.getData(options),
      contacts: filtered,
      contactsByCategory: contactsByCategory,
      contactCount: this.contacts.length,
      filteredCount: filtered.length,
      searchTerm: this.searchTerm,
      typeFilter: this.typeFilter, // ✅ NEW
      viewMode: this.viewMode,
      selectMode: this.selectMode,
      
      // Context info
      hasCharacter: !!this.actor,
      characterName: this.actor?.name || 'No Character',
      
      // Helper flags
      hasContacts: this.contacts.length > 0,
      isListView: this.viewMode === 'list',
      isGridView: this.viewMode === 'grid',
      showingFiltered: this.searchTerm || this.typeFilter !== 'all'
    };
  }
  
  /**
   * Load contacts from user flags and actors
   */
  async _loadContacts() {
    try {
      // Load saved contacts from user flags
      this.contacts = await game.user.getFlag(MODULE_ID, "contacts") || [];
      
      // Scan for actors with email addresses
      const actorContacts = game.actors.contents
        .filter(a => {
          const emailAddress = a.getFlag(MODULE_ID, "emailAddress");
          return emailAddress && emailAddress.trim() !== '';
        })
        .map(a => ({
          id: `actor_${a.id}`,
          name: a.name,
          email: a.getFlag(MODULE_ID, "emailAddress"),
          img: a.img,
          type: 'character',
          alias: null,
          tags: [],
          notes: '',
          readonly: true
        }));
      
      // Merge, avoiding duplicates by email
      const emailSet = new Set(this.contacts.map(c => c.email));
      
      for (const ac of actorContacts) {
        if (!emailSet.has(ac.email)) {
          this.contacts.push(ac);
          emailSet.add(ac.email);
        }
      }
      
      console.log(`${MODULE_ID} | Loaded ${this.contacts.length} contacts`);
      
    } catch (error) {
      console.error(`${MODULE_ID} | Error loading contacts:`, error);
      ui.notifications.error("Failed to load contacts");
      this.contacts = [];
    }
  }
  
  /**
   * Save contacts to user flags
   */
  async _saveContacts() {
    try {
      // Filter out readonly (actor-linked) contacts before saving
      const saveableContacts = this.contacts.filter(c => !c.readonly);
      
      await game.user.setFlag(MODULE_ID, "contacts", saveableContacts);
      
      console.log(`${MODULE_ID} | Saved ${saveableContacts.length} contacts`);
      
    } catch (error) {
      console.error(`${MODULE_ID} | Error saving contacts:`, error);
      ui.notifications.error("Failed to save contacts");
    }
  }
  
  /**
   * Activate listeners
   */
  activateListeners(html) {
    super.activateListeners(html);
    
    // Add contact button
    html.find('[data-action="add-contact"]').on('click', () => {
      this.addContact();
    });
    
    // Edit contact
    html.find('[data-action="edit-contact"]').on('click', (e) => {
      e.stopPropagation();
      const contactId = $(e.currentTarget).data('contact-id');
      this.editContact(contactId);
    });
    
    // Delete contact
    html.find('[data-action="delete-contact"]').on('click', async (e) => {
      e.stopPropagation();
      const contactId = $(e.currentTarget).data('contact-id');
      await this.deleteContact(contactId);
    });
    
    // ✅ FIX: Compose to contact
    html.find('[data-action="compose-to"]').on('click', async (e) => {
      e.stopPropagation();
      const contactId = $(e.currentTarget).data('contact-id');
      await this.composeToContact(contactId);
    });
    
    // Select contact (in select mode)
    html.find('[data-action="select-contact"]').on('click', (e) => {
      const contactId = $(e.currentTarget).data('contact-id');
      const contact = this.contacts.find(c => c.id === contactId);
      if (contact) {
        if (this.selectMode) {
          this.selectContact(contact);
        } else {
          // In normal mode, click opens edit
          this.editContact(contactId);
        }
      }
    });
    
    // ✅ FIX: Search input
    html.find('[data-action="search"]').on('input', (e) => {
      this.searchTerm = $(e.currentTarget).val();
      this.render(false);
    });
    
    // ✅ FIX: Type filter dropdown
    html.find('[data-filter="type"]').on('change', (e) => {
      this.typeFilter = $(e.currentTarget).val();
      this.playSound('click');
      this.render(false);
    });
    
    // View mode toggle - List
    html.find('[data-action="view-list"]').on('click', () => {
      this.viewMode = 'list';
      this.playSound('click');
      this.render(false);
    });
    
    // View mode toggle - Grid
    html.find('[data-action="view-grid"]').on('click', () => {
      this.viewMode = 'grid';
      this.playSound('click');
      this.render(false);
    });
    
    // Category toggle (for list view)
    html.find('[data-action="toggle-category"]').on('click', (e) => {
      const $header = $(e.currentTarget);
      const $category = $header.closest('.ncm-contact-category');
      $category.toggleClass('ncm-contact-category--collapsed');
      this.playSound('click');
    });
    
    // Import/Export
    html.find('[data-action="import-contacts"]').on('click', () => {
      this.importContacts();
    });
    
    html.find('[data-action="export-contacts"]').on('click', () => {
      this.exportContacts();
    });
  }
  
  /**
   * ✅ ENHANCED: Add new contact with full fields
   */
  async addContact() {
    const contact = await this._showContactDialog();
    
    if (contact) {
      this.contacts.push({
        id: foundry.utils.randomID(),
        ...contact,
        createdAt: new Date().toISOString()
      });
      
      await this._saveContacts();
      ui.notifications.info(`Contact "${contact.name}" added.`);
      this.playSound('notification');
      this.render(false);
    }
  }
  
  /**
   * ✅ ENHANCED: Edit existing contact with full fields
   */
  async editContact(contactId) {
    const contact = this.contacts.find(c => c.id === contactId);
    
    if (!contact) {
      ui.notifications.warn("Contact not found.");
      return;
    }
    
    if (contact.readonly) {
      ui.notifications.warn("Cannot edit character-linked contacts. You can only modify their alias, tags, and notes.");
      // Still allow editing some fields for readonly contacts
    }
    
    const updated = await this._showContactDialog(contact);
    
    if (updated) {
      // Merge updates (preserve readonly fields if applicable)
      if (contact.readonly) {
        // Only update allowed fields
        contact.alias = updated.alias;
        contact.tags = updated.tags;
        contact.notes = updated.notes;
        contact.customImg = updated.customImg;
      } else {
        // Update all fields
        Object.assign(contact, updated);
      }
      
      await this._saveContacts();
      ui.notifications.info(`Contact "${contact.name}" updated.`);
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
      ui.notifications.warn("Contact not found.");
      return;
    }
    
    if (contact.readonly) {
      ui.notifications.warn("Cannot delete character-linked contacts.");
      return;
    }
    
    const confirmed = await Dialog.confirm({
      title: 'Delete Contact',
      content: `<p>Delete <strong>${contact.name}</strong>?</p><p>This cannot be undone.</p>`
    });
    
    if (confirmed) {
      this.contacts = this.contacts.filter(c => c.id !== contactId);
      await this._saveContacts();
      ui.notifications.info(`Contact "${contact.name}" deleted.`);
      this.playSound('click');
      this.render(false);
    }
  }
  
  /**
   * ✅ FIX: Compose message to contact with character context
   */
  async composeToContact(contactId) {
    const contact = this.contacts.find(c => c.id === contactId);
    
    if (!contact) {
      ui.notifications.warn("Contact not found.");
      return;
    }
    
    // ✅ Check if we have a character
    if (!this.actor) {
      ui.notifications.warn("No character selected. Please select a character first.");
      return;
    }
    
    // Import and open composer with character context
    const { MessageComposerApp } = await import('../MessageComposer/MessageComposerApp.js');
    const composer = new MessageComposerApp({
      to: contact.email,
      actorId: this.actorId,
      actor: this.actor
    });
    
    composer.render(true);
    this.playSound('click');
  }
  
  /**
   * Select contact (callback mode)
   */
  selectContact(contact) {
    if (this.selectMode && this.onSelect) {
      this.onSelect(contact);
      this.close();
    }
  }
  
  /**
   * ✅ ENHANCED: Contact dialog with ALL fields
   * @private
   */
  async _showContactDialog(existingContact = null) {
    // Prepare tags as comma-separated string
    const tagsString = existingContact?.tags ? existingContact.tags.join(', ') : '';
    
    // Check if readonly
    const isReadonly = existingContact?.readonly || false;
    
    return new Promise((resolve) => {
      new Dialog({
        title: existingContact ? 'Edit Contact' : 'Add Contact',
        content: `
          <form class="ncm-contact-form">
            <div class="form-group">
              <label>Name *</label>
              <input type="text" name="name" value="${existingContact?.name || ''}" 
                     ${isReadonly ? 'disabled' : ''} required />
              ${isReadonly ? '<p class="hint">Character name cannot be changed</p>' : ''}
            </div>
            
            <div class="form-group">
              <label>Alias / Nickname</label>
              <input type="text" name="alias" value="${existingContact?.alias || ''}" 
                     placeholder="Street name or nickname" />
              <p class="hint">Shows up in parentheses next to their real name</p>
            </div>
            
            <div class="form-group">
              <label>Email *</label>
              <input type="email" name="email" value="${existingContact?.email || ''}" 
                     ${isReadonly ? 'disabled' : ''} required />
              ${isReadonly ? '<p class="hint">Character email cannot be changed</p>' : ''}
            </div>
            
            <div class="form-group">
              <label>Type</label>
              <select name="type" ${isReadonly ? 'disabled' : ''}>
                <option value="player" ${existingContact?.type === 'player' ? 'selected' : ''}>Player</option>
                <option value="npc" ${existingContact?.type === 'npc' ? 'selected' : ''}>NPC</option>
                <option value="corp" ${existingContact?.type === 'corp' ? 'selected' : ''}>Corporation</option>
                <option value="fixer" ${existingContact?.type === 'fixer' ? 'selected' : ''}>Fixer</option>
                <option value="netrunner" ${existingContact?.type === 'netrunner' ? 'selected' : ''}>Netrunner</option>
                <option value="media" ${existingContact?.type === 'media' ? 'selected' : ''}>Media</option>
                <option value="law" ${existingContact?.type === 'law' ? 'selected' : ''}>Law Enforcement</option>
                <option value="gang" ${existingContact?.type === 'gang' ? 'selected' : ''}>Gang Member</option>
                <option value="other" ${existingContact?.type === 'other' ? 'selected' : ''}>Other</option>
              </select>
            </div>
            
            <div class="form-group">
              <label>Tags</label>
              <input type="text" name="tags" value="${tagsString}" 
                     placeholder="reliable, dangerous, tech, corporate" />
              <p class="hint">Comma-separated tags for organization</p>
            </div>
            
            <div class="form-group">
              <label>Image Path</label>
              <input type="text" name="customImg" value="${existingContact?.customImg || existingContact?.img || ''}" 
                     placeholder="path/to/image.jpg" />
              <p class="hint">Custom image for this contact (overrides default)</p>
            </div>
            
            <div class="form-group">
              <label>Notes</label>
              <textarea name="notes" rows="3" placeholder="Internal notes about this contact">${existingContact?.notes || ''}</textarea>
              <p class="hint">Private notes (not visible to anyone else)</p>
            </div>
          </form>
          
          <style>
            .ncm-contact-form .form-group {
              margin-bottom: 1rem;
            }
            .ncm-contact-form label {
              display: block;
              margin-bottom: 0.25rem;
              font-weight: bold;
              color: var(--ncm-secondary, #19f3f7);
            }
            .ncm-contact-form input,
            .ncm-contact-form select,
            .ncm-contact-form textarea {
              width: 100%;
              padding: 0.5rem;
              background: var(--ncm-bg-tertiary, #1a1a1a);
              border: 1px solid var(--ncm-border-secondary, #444);
              border-radius: 4px;
              color: var(--ncm-text-primary, #fff);
              font-family: 'Courier New', monospace;
            }
            .ncm-contact-form input:focus,
            .ncm-contact-form select:focus,
            .ncm-contact-form textarea:focus {
              outline: none;
              border-color: var(--ncm-secondary, #19f3f7);
            }
            .ncm-contact-form .hint {
              margin-top: 0.25rem;
              font-size: 0.85em;
              color: var(--ncm-text-tertiary, #888);
              font-style: italic;
            }
            .ncm-contact-form input:disabled {
              opacity: 0.5;
              cursor: not-allowed;
            }
          </style>
        `,
        buttons: {
          save: {
            icon: '<i class="fas fa-check"></i>',
            label: 'Save',
            callback: (html) => {
              const formData = new FormData(html.find('form')[0]);
              
              const name = formData.get('name').trim();
              const alias = formData.get('alias').trim();
              const email = formData.get('email').trim();
              const type = formData.get('type');
              const tagsInput = formData.get('tags').trim();
              const customImg = formData.get('customImg').trim();
              const notes = formData.get('notes').trim();
              
              // Parse tags
              const tags = tagsInput
                ? tagsInput.split(',').map(t => t.trim()).filter(Boolean)
                : [];
              
              // Validation
              if (!name || !email) {
                ui.notifications.warn("Name and email are required.");
                resolve(null);
                return;
              }
              
              if (!isValidEmail(email)) {
                ui.notifications.warn("Invalid email format.");
                resolve(null);
                return;
              }
              
              resolve({
                name,
                alias: alias || null,
                email,
                type,
                tags,
                customImg: customImg || null,
                notes: notes || ''
              });
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
        classes: ['dialog', 'ncm-dialog'],
        width: 500
      }).render(true);
    });
  }
  
  /**
   * ✅ ENHANCED: Export contacts with new fields
   */
  async exportContacts() {
    const exportData = {
      version: '2.0',  // ✅ Bumped version for new format
      timestamp: new Date().toISOString(),
      contacts: this.contacts.filter(c => !c.readonly).map(c => ({
        name: c.name,
        alias: c.alias,
        email: c.email,
        type: c.type,
        tags: c.tags || [],
        customImg: c.customImg,
        notes: c.notes,
        img: c.img,
        createdAt: c.createdAt
      }))
    };
    
    const filename = `ncm-contacts-${Date.now()}.json`;
    const json = JSON.stringify(exportData, null, 2);
    
    saveDataToFile(json, 'application/json', filename);
    ui.notifications.info("Contacts exported.");
    this.playSound('notification');
  }
  
  /**
   * ✅ ENHANCED: Import contacts with new fields
   */
  async importContacts() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        
        if (!data.contacts || !Array.isArray(data.contacts)) {
          throw new Error("Invalid contact file format");
        }
        
        // Check version and migrate if needed
        const version = data.version || '1.0';
        let importedContacts = data.contacts;
        
        if (version === '1.0') {
          // Migrate old format to new
          importedContacts = data.contacts.map(c => ({
            ...c,
            alias: null,
            tags: [],
            customImg: null,
            notes: ''
          }));
        }
        
        // Merge with existing
        const emailSet = new Set(this.contacts.map(c => c.email));
        let imported = 0;
        
        for (const contact of importedContacts) {
          if (!emailSet.has(contact.email)) {
            this.contacts.push({
              ...contact,
              id: foundry.utils.randomID()
            });
            imported++;
          }
        }
        
        if (imported > 0) {
          await this._saveContacts();
          ui.notifications.info(`Imported ${imported} new contact(s).`);
          this.playSound('notification');
          this.render(false);
        } else {
          ui.notifications.warn("No new contacts to import.");
        }
        
      } catch (error) {
        console.error(`${MODULE_ID} | Import error:`, error);
        ui.notifications.error("Failed to import contacts.");
      }
    };
    
    input.click();
  }
}