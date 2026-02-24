/**
 * GMContactManagerApp
 * @file scripts/ui/GMContactManager/GMContactManagerApp.js
 * @module cyberpunkred-messenger
 * @description GM interface for the master NPC contact directory.
 *              Search/filter, add/edit/remove NPC contacts, bulk operations,
 *              push contacts to player address books.
 *              Extends BaseApplication (ApplicationV2 + HandlebarsApplicationMixin).
 */

import { MODULE_ID, TEMPLATES } from '../../utils/constants.js';
import { log, isGM } from '../../utils/helpers.js';
import { BaseApplication } from '../BaseApplication.js';

export class GMContactManagerApp extends BaseApplication {

  /** @type {string|null} Selected contact ID for editing */
  _selectedContactId = null;

  /** @type {boolean} Creating a new contact */
  _isCreating = false;

  /** @type {string} Search filter */
  _searchQuery = '';

  /** @type {string} Tag filter */
  _tagFilter = '';

  /** @type {string} Organization filter */
  _orgFilter = '';

  // ─── Service Accessors ───

  get masterContactService() { return game.nightcity?.masterContactService; }

  // ─── ApplicationV2 Configuration ───

  static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
    id: 'ncm-gm-contact-manager',
    classes: ['ncm-app', 'ncm-gm-contact-manager'],
    window: {
      title: 'NCM.GMContacts.Title',
      icon: 'fas fa-address-book',
      resizable: true,
      minimizable: true,
    },
    position: {
      width: 850,
      height: 600,
    },
    actions: {
      selectContact: GMContactManagerApp._onSelectContact,
      createContact: GMContactManagerApp._onCreateContact,
      saveContact: GMContactManagerApp._onSaveContact,
      deleteContact: GMContactManagerApp._onDeleteContact,
      cancelEdit: GMContactManagerApp._onCancelEdit,
      pushToPlayer: GMContactManagerApp._onPushToPlayer,
      syncAllToPlayer: GMContactManagerApp._onSyncAllToPlayer,
      importFromActors: GMContactManagerApp._onImportFromActors,
      linkActor: GMContactManagerApp._onLinkActor,
      filterByTag: GMContactManagerApp._onFilterByTag,
      filterByOrg: GMContactManagerApp._onFilterByOrg,
      clearFilters: GMContactManagerApp._onClearFilters,
      bulkDelete: GMContactManagerApp._onBulkDelete,
      composeToContact: GMContactManagerApp._onComposeToContact,
    },
  }, { inplace: false });

  static PARTS = {
    main: {
      template: TEMPLATES.GM_CONTACT_MANAGER,
    },
  };

  // ─── Data Preparation ───

  async _prepareContext(options) {
    const svc = this.masterContactService;
    if (!svc) return { hasService: false };

    // Apply filters
    let contacts = svc.getAll();
    if (this._searchQuery) {
      contacts = svc.search(this._searchQuery);
    }
    if (this._tagFilter) {
      const tagFiltered = svc.filterByTag(this._tagFilter);
      contacts = contacts.filter(c => tagFiltered.find(tf => tf.id === c.id));
    }
    if (this._orgFilter) {
      const orgFiltered = svc.filterByOrganization(this._orgFilter);
      contacts = contacts.filter(c => orgFiltered.find(of => of.id === c.id));
    }

    // Sort alphabetically by name
    contacts.sort((a, b) => a.name.localeCompare(b.name));

    // Selected contact details
    let selectedContact = null;
    if (this._selectedContactId) {
      selectedContact = svc.getContact(this._selectedContactId);
      if (selectedContact) {
        // Resolve linked actor name
        if (selectedContact.actorId) {
          const actor = game.actors.get(selectedContact.actorId);
          selectedContact = { ...selectedContact, actorName: actor?.name ?? '(unknown actor)' };
        }
      }
    }

    // Available actors for linking
    const availableActors = game.actors.map(a => ({
      id: a.id,
      name: a.name,
      img: a.img,
      hasPlayerOwner: a.hasPlayerOwner,
    })).sort((a, b) => a.name.localeCompare(b.name));

    // Available player actors for push-to-player
    const playerActors = game.actors
      .filter(a => a.hasPlayerOwner)
      .map(a => ({ id: a.id, name: a.name }));

    return {
      hasService: true,
      contacts,
      contactCount: svc.getAll().length,
      filteredCount: contacts.length,
      selectedContact,
      isCreating: this._isCreating,
      isEditing: !!this._selectedContactId || this._isCreating,
      searchQuery: this._searchQuery,
      tagFilter: this._tagFilter,
      orgFilter: this._orgFilter,
      allTags: svc.getAllTags(),
      allOrganizations: svc.getAllOrganizations(),
      availableActors,
      playerActors,
      MODULE_ID,
    };
  }

  // ─── Event Subscriptions ───

  _setupEventSubscriptions() {
    this.subscribe('contacts:masterUpdated', () => this.render(true));
  }

  // ─── Action Handlers ───

  static _onSelectContact(event, target) {
    const contactId = target.closest('[data-contact-id]')?.dataset.contactId;
    if (!contactId) return;

    this._selectedContactId = contactId;
    this._isCreating = false;
    this.render(true);
  }

  static _onCreateContact(event, target) {
    this._selectedContactId = null;
    this._isCreating = true;
    this.render(true);
  }

  static async _onSaveContact(event, target) {
    const form = this.element.querySelector('.ncm-contact-form');
    if (!form) return;

    const formData = new FormData(form);
    const data = {
      name: formData.get('name'),
      email: formData.get('email'),
      alias: formData.get('alias'),
      organization: formData.get('organization'),
      phone: formData.get('phone'),
      portrait: formData.get('portrait'),
      notes: formData.get('notes'),
      actorId: formData.get('actorId') || null,
      type: formData.get('type') || 'npc',
      tags: (formData.get('tags') || '').split(',').map(t => t.trim()).filter(Boolean),
    };

    try {
      let result;
      if (this._isCreating) {
        result = await this.masterContactService.addContact(data);
        if (result.success) {
          this._selectedContactId = result.contact.id;
          this._isCreating = false;
          ui.notifications.info(`Contact "${data.name}" created.`);
        }
      } else if (this._selectedContactId) {
        result = await this.masterContactService.updateContact(this._selectedContactId, data);
        if (result.success) {
          ui.notifications.info(`Contact "${data.name}" updated.`);
        }
      }

      if (!result?.success) {
        ui.notifications.error(result?.error || 'Failed to save contact.');
      }

      this.render(true);
    } catch (error) {
      console.error(`${MODULE_ID} | GMContactManagerApp._onSaveContact:`, error);
      ui.notifications.error('Failed to save contact.');
    }
  }

  static async _onDeleteContact(event, target) {
    const contactId = this._selectedContactId;
    if (!contactId) return;

    const contact = this.masterContactService.getContact(contactId);
    const confirmed = await Dialog.confirm({
      title: 'Delete Contact',
      content: `<p>Delete <strong>${contact?.name ?? 'this contact'}</strong>? This cannot be undone.</p>`,
    });

    if (!confirmed) return;

    const result = await this.masterContactService.removeContact(contactId);
    if (result.success) {
      this._selectedContactId = null;
      ui.notifications.info('Contact deleted.');
      this.render(true);
    }
  }

  static _onCancelEdit(event, target) {
    this._selectedContactId = null;
    this._isCreating = false;
    this.render(true);
  }

  static async _onPushToPlayer(event, target) {
    const actorId = target.closest('[data-actor-id]')?.dataset.actorId
      || this.element.querySelector('[name="pushTargetActor"]')?.value;
    if (!actorId || !this._selectedContactId) return;

    const result = await this.masterContactService.pushToPlayer(this._selectedContactId, actorId);
    if (result.success) {
      ui.notifications.info('Contact pushed to player.');
    } else {
      ui.notifications.error(result.error || 'Failed to push contact.');
    }
  }

  static async _onSyncAllToPlayer(event, target) {
    const actorId = this.element.querySelector('[name="syncTargetActor"]')?.value;
    if (!actorId) {
      ui.notifications.warn('Select a player to sync contacts to.');
      return;
    }

    const result = await this.masterContactService.syncAllToPlayer(actorId);
    if (result.success) {
      ui.notifications.info(`Synced ${result.synced} contacts.`);
    }
  }

  static async _onImportFromActors(event, target) {
    const result = await this.masterContactService.importFromActors();
    if (result.success) {
      ui.notifications.info(`Imported ${result.imported} contacts from actors.`);
      this.render(true);
    }
  }

  static async _onLinkActor(event, target) {
    // Open a FilePicker-style actor selector
    // For now, use the dropdown value in the form
    // The form handles this via the actorId select
  }

  static _onFilterByTag(event, target) {
    this._tagFilter = target.closest('[data-tag]')?.dataset.tag || '';
    this.render(true);
  }

  static _onFilterByOrg(event, target) {
    this._orgFilter = target.closest('[data-org]')?.dataset.org || '';
    this.render(true);
  }

  static _onClearFilters(event, target) {
    this._searchQuery = '';
    this._tagFilter = '';
    this._orgFilter = '';
    this.render(true);
  }

  static async _onBulkDelete(event, target) {
    const checkboxes = this.element.querySelectorAll('.ncm-contact-checkbox:checked');
    const ids = [...checkboxes].map(cb => cb.dataset.contactId).filter(Boolean);

    if (ids.length === 0) {
      ui.notifications.warn('No contacts selected.');
      return;
    }

    const confirmed = await Dialog.confirm({
      title: 'Bulk Delete',
      content: `<p>Delete <strong>${ids.length}</strong> selected contacts? This cannot be undone.</p>`,
    });
    if (!confirmed) return;

    const result = await this.masterContactService.bulkRemove(ids);
    if (result.success) {
      this._selectedContactId = null;
      ui.notifications.info(`Deleted ${result.removed} contacts.`);
      this.render(true);
    }
  }

  static _onComposeToContact(event, target) {
    const contactId = target.closest('[data-contact-id]')?.dataset.contactId || this._selectedContactId;
    if (!contactId) return;

    const contact = this.masterContactService.getContact(contactId);
    if (!contact) return;

    game.nightcity.composeMessage?.({
      to: contact.email,
      toActorId: contact.actorId,
    });
  }

  // ─── Render Callback — Wire Search Input ───

  _onRender(context, options) {
    super._onRender(context, options);

    const searchInput = this.element.querySelector('.ncm-contact-search-input');
    if (searchInput) {
      searchInput.value = this._searchQuery;
      searchInput.addEventListener('input', foundry.utils.debounce((e) => {
        this._searchQuery = e.target.value;
        this.render(true);
      }, 300));
    }
  }
}
