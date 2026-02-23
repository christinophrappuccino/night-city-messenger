/**
 * Contact Manager Application
 * @file scripts/ui/ContactManager/ContactManagerApp.js
 * @module cyberpunkred-messenger
 * @description View, add, edit, and delete contacts for an actor.
 * Includes search, filtering by tags, and integration with actor directory.
 */

import { MODULE_ID, EVENTS } from '../../utils/constants.js';
import { DataValidator } from '../../data/DataValidator.js';

export class ContactManagerApp extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {

  // ─── Static Configuration ─────────────────────────────────

  static DEFAULT_OPTIONS = {
    id: 'ncm-contact-manager',
    classes: ['ncm-app', 'ncm-contact-manager'],
    tag: 'div',
    window: {
      title: 'Contacts',
      icon: 'fas fa-address-book',
      resizable: true,
      minimizable: true,
    },
    position: {
      width: 500,
      height: 550,
    },
    actions: {
      addContact: ContactManagerApp._onAddContact,
      editContact: ContactManagerApp._onEditContact,
      deleteContact: ContactManagerApp._onDeleteContact,
      saveContact: ContactManagerApp._onSaveContact,
      cancelEdit: ContactManagerApp._onCancelEdit,
      sendMessage: ContactManagerApp._onSendMessage,
      importActor: ContactManagerApp._onImportActor,
    },
  };

  static PARTS = {
    contacts: {
      template: `modules/${MODULE_ID}/templates/contact-manager/contact-manager.hbs`,
    },
  };

  // ─── Instance State ───────────────────────────────────────

  /** @type {string|null} Actor whose contacts we're managing */
  actorId = null;

  /** @type {string} Search query */
  searchTerm = '';

  /** @type {string|null} Contact being edited (contact ID) */
  editingContactId = null;

  /** @type {boolean} Are we adding a new contact? */
  isAdding = false;

  /** @type {Array} Loaded contacts */
  _contacts = [];

  // ─── Service Accessors ────────────────────────────────────

  get contactRepo() { return game.nightcity.contactRepository; }
  get soundService() { return game.nightcity.soundService; }

  // ─── Constructor ──────────────────────────────────────────

  constructor(options = {}) {
    super(options);
    this.actorId = options.actorId || this._getDefaultActorId();
  }

  // ─── Lifecycle ────────────────────────────────────────────

  async _prepareContext(options) {
    await this._loadContacts();

    let contacts = [...this._contacts];

    // Search filter
    if (this.searchTerm) {
      const q = this.searchTerm.toLowerCase();
      contacts = contacts.filter(c =>
        c.name?.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q) ||
        c.alias?.toLowerCase().includes(q) ||
        c.organization?.toLowerCase().includes(q) ||
        c.tags?.some(t => t.toLowerCase().includes(q))
      );
    }

    // Sort alphabetically
    contacts.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    // Enrich with display data
    const enrichedContacts = contacts.map(c => ({
      ...c,
      displayTags: c.tags?.join(', ') || '',
      img: c.customImg || (c.actorId ? game.actors.get(c.actorId)?.img : null) || 'icons/svg/mystery-man.svg',
      isEditing: c.id === this.editingContactId,
    }));

    const actor = game.actors.get(this.actorId);

    return {
      actor: actor ? { id: actor.id, name: actor.name } : null,
      contacts: enrichedContacts,
      searchTerm: this.searchTerm,
      isAdding: this.isAdding,
      editingContactId: this.editingContactId,
      contactCount: this._contacts.length,
      isEmpty: enrichedContacts.length === 0,
      isGM: game.user.isGM,

      // Empty form for adding
      newContact: this.isAdding ? {
        name: '', email: '', organization: '', phone: '',
        alias: '', tags: '', notes: '', type: 'npc',
      } : null,

      // Edit form
      editContact: this.editingContactId
        ? this._contacts.find(c => c.id === this.editingContactId) || null
        : null,

      MODULE_ID,
    };
  }

  _onRender(context, options) {
    this._setupSearchInput();
  }

  // ─── Data Loading ─────────────────────────────────────────

  async _loadContacts() {
    if (!this.actorId) {
      this._contacts = [];
      return;
    }
    this._contacts = await this.contactRepo.getContacts(this.actorId);
  }

  // ─── Action Handlers ──────────────────────────────────────

  static _onAddContact(event, target) {
    this.isAdding = true;
    this.editingContactId = null;
    this.render();
  }

  static _onEditContact(event, target) {
    const contactId = target.closest('[data-contact-id]')?.dataset.contactId;
    if (!contactId) return;

    this.editingContactId = contactId;
    this.isAdding = false;
    this.render();
  }

  static async _onDeleteContact(event, target) {
    const contactId = target.closest('[data-contact-id]')?.dataset.contactId;
    if (!contactId) return;

    const contact = this._contacts.find(c => c.id === contactId);
    const confirmed = await Dialog.confirm({
      title: 'Delete Contact',
      content: `<p>Remove <strong>${contact?.name || 'this contact'}</strong> from your contacts?</p>`,
    });

    if (!confirmed) return;

    const result = await this.contactRepo.removeContact(this.actorId, contactId);
    if (result.success) {
      if (this.editingContactId === contactId) this.editingContactId = null;
      this.render();
    } else {
      ui.notifications.error(`Failed to delete contact: ${result.error}`);
    }
  }

  static async _onSaveContact(event, target) {
    const form = this.element?.querySelector('.ncm-contact-form');
    if (!form) return;

    const formData = new FormData(form);
    const data = {
      name: formData.get('name')?.trim(),
      email: formData.get('email')?.trim(),
      organization: formData.get('organization')?.trim(),
      phone: formData.get('phone')?.trim(),
      alias: formData.get('alias')?.trim(),
      tags: formData.get('tags')?.split(',').map(t => t.trim()).filter(Boolean) || [],
      notes: formData.get('notes')?.trim(),
      type: formData.get('type') || 'npc',
    };

    // Validate
    const validation = DataValidator.validateContact(data);
    if (!validation.valid) {
      ui.notifications.warn(validation.errors.join(', '));
      return;
    }

    let result;
    if (this.isAdding) {
      result = await this.contactRepo.addContact(this.actorId, data);
    } else if (this.editingContactId) {
      result = await this.contactRepo.updateContact(this.actorId, this.editingContactId, data);
    }

    if (result?.success) {
      this.isAdding = false;
      this.editingContactId = null;
      this.soundService?.play('click');
      this.render();
    } else {
      ui.notifications.error(`Failed to save: ${result?.error}`);
    }
  }

  static _onCancelEdit(event, target) {
    this.isAdding = false;
    this.editingContactId = null;
    this.render();
  }

  static _onSendMessage(event, target) {
    const contactId = target.closest('[data-contact-id]')?.dataset.contactId;
    const contact = this._contacts.find(c => c.id === contactId);
    if (!contact) return;

    game.nightcity.composeMessage?.({
      fromActorId: this.actorId,
      toActorId: contact.actorId || null,
    });
  }

  static async _onImportActor(event, target) {
    // Show actor picker to import as contact
    const actors = game.actors.filter(a => {
      const email = a.getFlag(MODULE_ID, 'email');
      return email && !this._contacts.some(c => c.actorId === a.id);
    });

    if (actors.length === 0) {
      ui.notifications.info('No additional actors with email addresses found.');
      return;
    }

    // Simple selection dialog
    const content = `<div class="ncm-import-list">
      ${actors.map(a => `
        <label class="ncm-import-item">
          <input type="checkbox" name="actorIds" value="${a.id}">
          <img src="${a.img}" width="24" height="24" style="border-radius:50%">
          <span>${a.name}</span>
          <span class="ncm-text-muted">${a.getFlag(MODULE_ID, 'email')}</span>
        </label>
      `).join('')}
    </div>`;

    const dialog = await Dialog.prompt({
      title: 'Import Actors as Contacts',
      content,
      callback: (html) => {
        const checked = html.find ? html.find('input:checked') : html[0]?.querySelectorAll('input:checked');
        return Array.from(checked || []).map(el => el.value);
      },
    });

    if (!dialog || dialog.length === 0) return;

    for (const actorId of dialog) {
      const actor = game.actors.get(actorId);
      if (!actor) continue;

      await this.contactRepo.addContact(this.actorId, {
        name: actor.name,
        email: actor.getFlag(MODULE_ID, 'email') || '',
        actorId: actor.id,
        type: actor.hasPlayerOwner ? 'player' : 'npc',
        customImg: actor.img,
      });
    }

    this.render();
  }

  // ─── Search ───────────────────────────────────────────────

  _setupSearchInput() {
    const searchInput = this.element?.querySelector('.ncm-contact-search');
    if (!searchInput) return;

    let debounceTimer;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        this.searchTerm = e.target.value;
        this.render();
      }, 200);
    });
  }

  // ─── Helpers ──────────────────────────────────────────────

  _getDefaultActorId() {
    if (game.user.character) return game.user.character.id;
    return game.actors.find(a => a.isOwner)?.id || null;
  }
}
