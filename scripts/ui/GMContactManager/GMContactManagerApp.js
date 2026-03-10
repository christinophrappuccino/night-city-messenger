/**
 * GM Master Contact Directory — Sprint 3.10
 * @file scripts/ui/GMContactManager/GMContactManagerApp.js
 * @module cyberpunkred-messenger
 * @description GM-only interface for the master NPC contact directory.
 *   Split-view layout: scrollable contact list (left) + detail panel (right).
 *   Full CRUD, trust editing, burn/restore, relationship badges, push to player,
 *   import from actors, portrait upload, GM notes, and tag management.
 *
 *   Extends BaseApplication (ApplicationV2 + HandlebarsApplicationMixin).
 *
 *   Reuses existing services:
 *     - MasterContactService for contact CRUD + push operations
 *     - ContactRepository for trust/burn/encrypt flag management
 *     - PortraitService for image upload/resize
 *     - ContactShareService for Data Drop animations on push
 *     - enrichContactForDisplay() from designHelpers for display-ready data
 */

import { MODULE_ID, TEMPLATES, EVENTS } from '../../utils/constants.js';
import { log, isGM } from '../../utils/helpers.js';
import { BaseApplication } from '../BaseApplication.js';
import {
  getAvatarColor,
  getInitials,
  enrichContactForDisplay,
  getTrustData,
} from '../../utils/designHelpers.js';

export class GMContactManagerApp extends BaseApplication {

  // ═══════════════════════════════════════════════════════════
  //  Instance State
  // ═══════════════════════════════════════════════════════════

  /** @type {string|null} Selected contact ID in the list */
  _selectedContactId = null;

  /** @type {boolean} Creating a new contact (shows form in detail panel) */
  _isCreating = false;

  /** @type {boolean} Editing an existing contact (shows form in detail panel) */
  _isEditing = false;

  /** @type {string} Current search query */
  _searchQuery = '';

  /** @type {string[]} Active tag filters */
  _activeTagFilters = [];

  /** @type {string} Organization filter */
  _orgFilter = '';

  /** @type {Set<string>} Selected contacts for bulk operations */
  _bulkSelected = new Set();

  // ═══════════════════════════════════════════════════════════
  //  Service Accessors
  // ═══════════════════════════════════════════════════════════

  get masterContactService() { return game.nightcity?.masterContactService; }
  get contactRepo() { return game.nightcity?.contactRepository; }
  get portraitService() { return game.nightcity?.portraitService; }
  get shareService() { return game.nightcity?.contactShareService; }
  get notificationService() { return game.nightcity?.notificationService; }

  // ═══════════════════════════════════════════════════════════
  //  ApplicationV2 Configuration
  // ═══════════════════════════════════════════════════════════

  static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
    id: 'ncm-gm-contact-manager',
    classes: ['ncm-app', 'ncm-gm-contact-manager'],
    window: {
      title: 'Master Contacts — GM Control',
      icon: 'fas fa-address-book',
      resizable: true,
      minimizable: true,
    },
    position: {
      width: 880,
      height: 620,
    },
    actions: {
      // ─── List navigation ───
      selectContact:    GMContactManagerApp._onSelectContact,

      // ─── Contact CRUD ───
      createContact:    GMContactManagerApp._onCreateContact,
      editContact:      GMContactManagerApp._onEditContact,
      saveContact:      GMContactManagerApp._onSaveContact,
      deleteContact:    GMContactManagerApp._onDeleteContact,
      cancelEdit:       GMContactManagerApp._onCancelEdit,

      // ─── Trust / Burn / Restore ───
      setTrustLevel:    GMContactManagerApp._onSetTrustLevel,
      burnContact:      GMContactManagerApp._onBurnContact,
      restoreContact:   GMContactManagerApp._onRestoreContact,

      // ─── Relationship ───
      // (handled by change event listener in _setupRelationshipSelect)

      // ─── Push / Share ───
      pushToPlayer:     GMContactManagerApp._onPushToPlayer,
      pushAllToPlayer:  GMContactManagerApp._onPushAllToPlayer,

      // ─── Import / Link ───
      importContactsJSON: GMContactManagerApp._onImportContactsJSON,
      linkActor:        GMContactManagerApp._onLinkActor,
      unlinkActor:      GMContactManagerApp._onUnlinkActor,

      // ─── Portrait ───
      uploadPortrait:   GMContactManagerApp._onUploadPortrait,
      removePortrait:   GMContactManagerApp._onRemovePortrait,

      // ─── Tag filters ───
      toggleTagFilter:  GMContactManagerApp._onToggleTagFilter,
      clearTagFilters:  GMContactManagerApp._onClearTagFilters,
      startAddTag:      GMContactManagerApp._onStartAddTag,

      // ─── Contact actions ───
      composeToContact: GMContactManagerApp._onComposeToContact,
      sendAsContact:    GMContactManagerApp._onSendAsContact,
      openContactInbox: GMContactManagerApp._onOpenContactInbox,
      exportContacts:   GMContactManagerApp._onExportContacts,

      // ─── Bulk ───
      bulkToggle:       GMContactManagerApp._onBulkToggle,
      bulkDelete:       GMContactManagerApp._onBulkDelete,
    },
  }, { inplace: false });

  static PARTS = {
    main: {
      template: TEMPLATES.GM_CONTACT_MANAGER,
    },
  };

  // ═══════════════════════════════════════════════════════════
  //  Data Preparation
  // ═══════════════════════════════════════════════════════════

  async _prepareContext(options) {
    const svc = this.masterContactService;
    if (!svc) return { hasService: false };

    // ── Get all contacts ──
    let allContacts = svc.getAll();

    // ── Apply search filter ──
    if (this._searchQuery) {
      const q = this._searchQuery.toLowerCase();
      allContacts = allContacts.filter(c =>
        (c.name || '').toLowerCase().includes(q) ||
        (c.email || '').toLowerCase().includes(q) ||
        (c.organization || '').toLowerCase().includes(q) ||
        (c.alias || '').toLowerCase().includes(q) ||
        (c.tags || []).some(t => t.toLowerCase().includes(q))
      );
    }

    // ── Apply tag filters ──
    if (this._activeTagFilters.length > 0) {
      allContacts = allContacts.filter(c =>
        this._activeTagFilters.every(tag =>
          (c.tags || []).some(t => t.toUpperCase() === tag.toUpperCase())
        )
      );
    }

    // ── Apply org filter ──
    if (this._orgFilter) {
      allContacts = allContacts.filter(c =>
        (c.organization || '').toUpperCase() === this._orgFilter.toUpperCase()
      );
    }

    // ── Sort alphabetically ──
    allContacts.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    // ── Enrich contacts for display ──
    const enriched = allContacts.map(c => enrichContactForDisplay(c, {
      selectedId: this._selectedContactId,
      isGM: true,
    }));

    // ── Selected contact enrichment ──
    let selectedContact = null;
    let selectedEnriched = null;
    if (this._selectedContactId && !this._isCreating) {
      selectedContact = svc.getContact(this._selectedContactId);
      if (selectedContact) {
        selectedEnriched = enrichContactForDisplay(selectedContact, {
          selectedId: this._selectedContactId,
          isGM: true,
        });

        // Resolve linked actor info + player owner
        if (selectedContact.actorId) {
          const actor = game.actors.get(selectedContact.actorId);
          selectedEnriched.actorName = actor?.name ?? '(unknown actor)';
          selectedEnriched.actorImg = actor?.img;

          // Find player owner name
          if (actor?.hasPlayerOwner) {
            const ownerEntry = Object.entries(actor.ownership || {}).find(
              ([uid, level]) => uid !== 'default' && level === CONST.DOCUMENT_PERMISSION_LEVELS.OWNER
            );
            if (ownerEntry) {
              const ownerUser = game.users.get(ownerEntry[0]);
              selectedEnriched.playerOwnerName = ownerUser?.name || null;
            }
          }
        }

        // Trust detail data (for expanded panel)
        selectedEnriched.trustData = getTrustData(selectedContact.trust || 0);
        selectedEnriched.trustDescription = selectedEnriched.trustData.description;

        // Relationship display
        selectedEnriched.relationshipBadges = this._buildRelationshipBadges(selectedContact);
      }
    }

    // ── Collect all tags for filter pills ──
    const allTagsRaw = svc.getAllTags?.() || [];
    const tagPills = allTagsRaw.map(tag => ({
      label: tag.toUpperCase(),
      value: tag,
      isActive: this._activeTagFilters.includes(tag.toUpperCase()),
    }));

    // ── Collect all organizations for filtering ──
    const allOrgs = svc.getAllOrganizations?.() || [];

    // ── Available actors for linking + push targets ──
    const availableActors = game.actors
      .map(a => ({
        id: a.id,
        name: a.name,
        img: a.img,
        hasPlayerOwner: a.hasPlayerOwner,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const playerActors = game.actors
      .map(a => ({
        id: a.id,
        name: a.name,
        img: a.img,
        isPlayer: a.hasPlayerOwner,
        ownerName: a.hasPlayerOwner
          ? Object.entries(a.ownership || {}).reduce((name, [uid, level]) => {
              if (uid !== 'default' && level === CONST.DOCUMENT_PERMISSION_LEVELS.OWNER) {
                return game.users.get(uid)?.name || name;
              }
              return name;
            }, null)
          : null,
        initials: getInitials(a.name),
        avatarColor: getAvatarColor(a.name),
      }))
      .sort((a, b) => {
        // Players first, then alphabetical
        if (a.isPlayer !== b.isPlayer) return a.isPlayer ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    // ── Stats ──
    const totalCount = svc.getAll().length;
    const linkedCount = svc.getAll().filter(c => c.actorId).length;

    return {
      hasService: true,

      // Contact data
      contacts: enriched,
      contactCount: totalCount,
      filteredCount: enriched.length,
      linkedCount,

      // Selected / editing
      selectedContact: selectedEnriched,
      hasSelection: !!selectedEnriched,
      isCreating: this._isCreating,
      isEditing: this._isEditing,
      showForm: this._isCreating || this._isEditing,
      showDetail: !!selectedEnriched && !this._isEditing,

      // Filters
      searchQuery: this._searchQuery,
      activeTagFilters: this._activeTagFilters,
      hasActiveTagFilter: this._activeTagFilters.length > 0,
      tagPills,
      allOrgs,
      orgFilter: this._orgFilter,

      // Actors
      availableActors,
      playerActors,

      // Relationships dropdown options
      relationshipOptions: [
        { value: '', label: '— None —' },
        { value: 'ally', label: 'ALLY', icon: 'fa-handshake' },
        { value: 'hostile', label: 'HOSTILE', icon: 'fa-skull-crossbones' },
        { value: 'owes-you', label: 'OWES YOU', icon: 'fa-coins' },
        { value: 'you-owe', label: 'YOU OWE', icon: 'fa-hand-holding-dollar' },
      ],

      MODULE_ID,
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  Lifecycle
  // ═══════════════════════════════════════════════════════════

  _setupEventSubscriptions() {
    this.subscribe('contacts:masterUpdated', () => this._debouncedRender());
    this.subscribe(EVENTS.CONTACT_TRUST_CHANGED, () => this.render());
    this.subscribe(EVENTS.CONTACT_BURNED, () => this.render());
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this._setupSearchInput();
    this._setupTrustHoverPreview();
    this._setupGMNotesAutosave();
    this._setupKeyboardShortcuts();
    this._setupRelationshipSelect();
    this._setupPushSelect();
  }

  // ═══════════════════════════════════════════════════════════
  //  Post-Render Setup
  // ═══════════════════════════════════════════════════════════

  /**
   * Wire up search input with debounced filtering.
   */
  _setupSearchInput() {
    const input = this.element?.querySelector('.ncm-gm-search-input');
    if (!input) return;

    const handler = this._boundSearchHandler || (this._boundSearchHandler = this._debounce((e) => {
      this._searchQuery = e.target.value;
      this.render();
    }, 250));

    input.removeEventListener('input', handler);
    input.addEventListener('input', handler);
  }

  /**
   * Hover preview for interactive trust segments in the detail panel.
   */
  _setupTrustHoverPreview() {
    const bars = this.element?.querySelectorAll('.ncm-trust-detail__bar--interactive');
    if (!bars) return;

    for (const bar of bars) {
      const segments = [...bar.querySelectorAll('.ncm-trust-detail__segment')];

      bar.addEventListener('mouseover', (e) => {
        const seg = e.target.closest('.ncm-trust-detail__segment');
        if (!seg) return;
        const idx = segments.indexOf(seg);
        if (idx < 0) return;
        segments.forEach((s, i) => {
          s.classList.toggle('ncm-trust-detail__segment--preview', i <= idx);
        });
      });

      bar.addEventListener('mouseleave', () => {
        segments.forEach(s => s.classList.remove('ncm-trust-detail__segment--preview'));
      });
    }
  }

  /**
   * Auto-save GM notes on blur.
   */
  _setupGMNotesAutosave() {
    const textarea = this.element?.querySelector('.ncm-gm-notes__textarea');
    if (!textarea || !this._selectedContactId) return;

    textarea.addEventListener('blur', async () => {
      const notes = textarea.value;
      const contact = this.masterContactService?.getContact(this._selectedContactId);
      if (contact && contact.notes !== notes) {
        await this.masterContactService.updateContact(this._selectedContactId, { notes });
        log.info(`GM notes saved for ${contact.name}`);
      }
    });
  }

  /**
   * Keyboard shortcuts: / to focus search, N for new, DEL to delete, E to edit.
   */
  _setupKeyboardShortcuts() {
    const handler = this._boundKeyHandler || (this._boundKeyHandler = (e) => {
      // Don't capture when typing in inputs
      if (e.target.matches('input, textarea, select')) return;

      switch (e.key) {
        case '/':
          e.preventDefault();
          this.element?.querySelector('.ncm-gm-search-input')?.focus();
          break;
        case 'n':
        case 'N':
          e.preventDefault();
          this._selectedContactId = null;
          this._isCreating = true;
          this._isEditing = false;
          this.render();
          break;
        case 'e':
        case 'E':
          if (this._selectedContactId) {
            e.preventDefault();
            this._isEditing = true;
            this._isCreating = false;
            this.render();
          }
          break;
        case 'Delete':
          if (this._selectedContactId) {
            GMContactManagerApp._onDeleteContact.call(this, e, e.target);
          }
          break;
        case 'Escape':
          if (this._isCreating || this._isEditing) {
            this._isCreating = false;
            this._isEditing = false;
            this.render();
          }
          break;
        case 'ArrowDown':
          e.preventDefault();
          this._navigateList(1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          this._navigateList(-1);
          break;
      }
    });

    this.element?.removeEventListener('keydown', handler);
    this.element?.addEventListener('keydown', handler);
  }

  /**
   * Wire up relationship select with change event (not data-action, which fires on click).
   */
  _setupRelationshipSelect() {
    const select = this.element?.querySelector('.ncm-relationship-select');
    if (!select || !this._selectedContactId) return;

    select.addEventListener('change', async (e) => {
      const relationship = e.target.value;
      const contactId = this._selectedContactId;
      if (!contactId) return;

      await this.masterContactService?.updateContact(contactId, { relationship });
      ui.notifications.info(`Relationship updated.`);
      this.render(true);
    });
  }

  /**
   * Wire up the push-to-player select (both bar and per-contact).
   */
  _setupPushSelect() {
    // Push all bar select doesn't need change listener — the Push All button reads its value
  }

  /**
   * Navigate up/down in the contact list.
   */
  _navigateList(direction) {
    const items = [...(this.element?.querySelectorAll('.ncm-gm-list-item') || [])];
    if (!items.length) return;

    const currentIdx = items.findIndex(el =>
      el.dataset.contactId === this._selectedContactId
    );

    let nextIdx;
    if (currentIdx < 0) {
      nextIdx = direction > 0 ? 0 : items.length - 1;
    } else {
      nextIdx = Math.max(0, Math.min(items.length - 1, currentIdx + direction));
    }

    const nextId = items[nextIdx]?.dataset.contactId;
    if (nextId) {
      this._selectedContactId = nextId;
      this._isCreating = false;
      this._isEditing = false;
      this.render();
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Helpers
  // ═══════════════════════════════════════════════════════════

  /**
   * Build relationship badge data for a contact.
   */
  _buildRelationshipBadges(contact) {
    const badges = [];
    const rel = contact.relationship;

    if (rel === 'ally') {
      badges.push({ class: 'ncm-badge--ally', icon: 'fa-handshake', label: 'ALLY' });
    } else if (rel === 'hostile') {
      badges.push({ class: 'ncm-badge--hostile', icon: 'fa-skull-crossbones', label: 'HOSTILE' });
    } else if (rel === 'owes-you') {
      badges.push({ class: 'ncm-badge--owes-you', icon: 'fa-coins', label: 'OWES YOU' });
    } else if (rel === 'you-owe') {
      badges.push({ class: 'ncm-badge--you-owe', icon: 'fa-hand-holding-dollar', label: 'YOU OWE' });
    }

    return badges;
  }

  /**
   * Simple debounce utility.
   */
  _debounce(fn, delay) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  Action Handlers — Navigation
  // ═══════════════════════════════════════════════════════════

  /**
   * Select a contact in the list panel.
   */
  static _onSelectContact(event, target) {
    const contactId = target.closest('[data-contact-id]')?.dataset.contactId;
    if (!contactId) return;

    // Toggle selection if already selected
    if (this._selectedContactId === contactId && !this._isEditing) {
      this._selectedContactId = null;
    } else {
      this._selectedContactId = contactId;
    }
    this._isCreating = false;
    this._isEditing = false;
    this.render();
  }

  // ═══════════════════════════════════════════════════════════
  //  Action Handlers — CRUD
  // ═══════════════════════════════════════════════════════════

  /**
   * Start creating a new contact (shows form in detail panel).
   */
  static _onCreateContact(event, target) {
    this._selectedContactId = null;
    this._isCreating = true;
    this._isEditing = false;
    this.render();
  }

  /**
   * Switch to edit mode for the selected contact.
   */
  static _onEditContact(event, target) {
    if (!this._selectedContactId) return;
    this._isEditing = true;
    this._isCreating = false;
    this.render();
  }

  /**
   * Save a new or edited contact from the form.
   */
  static async _onSaveContact(event, target) {
    const form = this.element?.querySelector('.ncm-contact-form');
    if (!form) return;

    const formData = new FormData(form);
    const data = {
      name: formData.get('name')?.trim(),
      email: formData.get('email')?.trim(),
      alias: formData.get('alias')?.trim(),
      organization: formData.get('organization')?.trim(),
      phone: formData.get('phone')?.trim(),
      portrait: formData.get('portrait')?.trim(),
      notes: formData.get('notes')?.trim(),
      actorId: formData.get('actorId') || null,
      role: formData.get('role') || 'npc',
      relationship: formData.get('relationship') || '',
      tags: (formData.get('tags') || '').split(',').map(t => t.trim().toUpperCase()).filter(Boolean),
    };

    if (!data.name) {
      ui.notifications.warn('Contact name is required.');
      return;
    }

    try {
      let result;
      if (this._isCreating) {
        result = await this.masterContactService.addContact(data);
        if (result.success) {
          this._selectedContactId = result.contact.id;
          this._isCreating = false;
          this._isEditing = false;
          ui.notifications.info(`Contact "${data.name}" created.`);
        }
      } else if (this._selectedContactId) {
        result = await this.masterContactService.updateContact(this._selectedContactId, data);
        if (result.success) {
          this._isEditing = false;
          ui.notifications.info(`Contact "${data.name}" updated.`);
        }
      }

      if (!result?.success) {
        ui.notifications.error(result?.error || 'Failed to save contact.');
      }

      this.render();
    } catch (error) {
      console.error(`${MODULE_ID} | GMContactManagerApp._onSaveContact:`, error);
      ui.notifications.error('Failed to save contact.');
    }
  }

  /**
   * Delete the selected contact with confirmation.
   */
  static async _onDeleteContact(event, target) {
    const contactId = this._selectedContactId;
    if (!contactId) return;

    const contact = this.masterContactService?.getContact(contactId);
    const confirmed = await Dialog.confirm({
      title: 'Delete Contact',
      content: `
        <div style="text-align: center; padding: 8px 0;">
          <p style="color: var(--ncm-text-primary, #e0e0e8);">
            Delete <strong style="color: var(--ncm-primary, #F65261);">${contact?.name ?? 'this contact'}</strong>?
          </p>
          <p style="color: var(--ncm-text-muted, #555570); font-size: 11px;">
            This removes the contact from the master directory permanently.
          </p>
        </div>`,
    });

    if (!confirmed) return;

    const result = await this.masterContactService.removeContact(contactId);
    if (result.success) {
      this._selectedContactId = null;
      this._isEditing = false;
      ui.notifications.info(`Contact "${contact?.name}" deleted.`);
      this.render();
    } else {
      ui.notifications.error('Failed to delete contact.');
    }
  }

  /**
   * Cancel create/edit mode.
   */
  static _onCancelEdit(event, target) {
    this._isCreating = false;
    this._isEditing = false;
    this.render();
  }

  // ═══════════════════════════════════════════════════════════
  //  Action Handlers — Trust / Burn / Restore
  // ═══════════════════════════════════════════════════════════

  /**
   * Set trust level on the selected contact (from clickable trust segments).
   */
  static async _onSetTrustLevel(event, target) {
    const trustValue = parseInt(target.dataset.trustValue, 10);
    const contactId = target.dataset.contactId || this._selectedContactId;
    if (!contactId || isNaN(trustValue)) return;

    const contact = this.masterContactService?.getContact(contactId);
    if (!contact) return;

    await this.masterContactService.updateContact(contactId, { trust: trustValue });

    const levelLabel = getTrustData(trustValue).description.split(' — ')[0];
    ui.notifications.info(`Trust set to ${levelLabel} for ${contact.name}.`);

    this.soundService?.play?.('click');
    this.eventBus?.emit(EVENTS.CONTACT_TRUST_CHANGED, { contactId, trust: trustValue });
    this.render(true);
  }

  /**
   * Burn a contact — sets burned flag, drops trust to 1 if higher.
   */
  static async _onBurnContact(event, target) {
    const contactId = this._selectedContactId;
    if (!contactId) return;

    const contact = this.masterContactService?.getContact(contactId);
    if (!contact) return;

    const confirmed = await Dialog.confirm({
      title: 'Burn Contact',
      content: `
        <div style="text-align: center; padding: 8px 0;">
          <p style="color: var(--ncm-danger, #ff0033);">
            <i class="fas fa-fire"></i> BURN CONTACT
          </p>
          <p style="color: var(--ncm-text-primary, #e0e0e8);">
            Mark <strong>${contact.name}</strong> as compromised?
          </p>
          <p style="color: var(--ncm-text-muted, #555570); font-size: 11px;">
            Players will see burned status. Trust will drop to LOW.
          </p>
        </div>`,
    });

    if (!confirmed) return;

    const updates = { burned: true };
    if ((contact.trust || 0) > 1) {
      updates.trust = 1;
    }

    await this.masterContactService.updateContact(contactId, updates);

    this.soundService?.play?.('hack-fail');
    this.notificationService?.showToast?.({
      title: 'CONTACT BURNED',
      detail: `${contact.name} — identity compromised`,
      type: 'danger',
      icon: 'fas fa-fire',
    });
    this.eventBus?.emit(EVENTS.CONTACT_BURNED, { contactId, burned: true });
    this.render();
  }

  /**
   * Restore a burned contact.
   */
  static async _onRestoreContact(event, target) {
    const contactId = this._selectedContactId;
    if (!contactId) return;

    const contact = this.masterContactService?.getContact(contactId);
    if (!contact) return;

    await this.masterContactService.updateContact(contactId, { burned: false });

    this.soundService?.play?.('click');
    ui.notifications.info(`${contact.name} restored — no longer burned.`);
    this.eventBus?.emit(EVENTS.CONTACT_BURNED, { contactId, burned: false });
    this.render();
  }

  // ═══════════════════════════════════════════════════════════
  //  Action Handlers — Relationship
  // ═══════════════════════════════════════════════════════════

  /**
   * Set relationship badge for a contact.
   */
  static async _onSetRelationship(event, target) {
    const relationship = target.dataset.relationship || target.value;
    const contactId = this._selectedContactId;
    if (!contactId) return;

    await this.masterContactService.updateContact(contactId, { relationship });
    this.soundService?.play?.('click');
    this.render();
  }

  // ═══════════════════════════════════════════════════════════
  //  Action Handlers — Push / Share
  // ═══════════════════════════════════════════════════════════

  /**
   * Push the selected contact to a player's contact list.
   */
  static async _onPushToPlayer(event, target) {
    const actorId = this.element?.querySelector('[name="pushTargetActor"]')?.value;
    const contactId = this._selectedContactId;
    if (!actorId || !contactId) {
      ui.notifications.warn('Select a character to share with.');
      return;
    }

    const includePortrait = this.element?.querySelector('[name="pushIncludePortrait"]')?.checked ?? true;

    const result = await this.masterContactService.pushToPlayer(contactId, actorId, {
      includePortrait,
    });

    if (result.success) {
      const contact = this.masterContactService.getContact(contactId);
      const actor = game.actors.get(actorId);
      ui.notifications.info(`${contact?.name} shared to ${actor?.name}'s contacts.`);
      this.soundService?.play?.('click');
    } else {
      ui.notifications.error(result.error || 'Failed to share contact.');
    }
  }

  /**
   * Push all currently filtered contacts to a player.
   */
  static async _onPushAllToPlayer(event, target) {
    const actorId = this.element?.querySelector('[name="pushAllTargetActor"]')?.value;
    if (!actorId) {
      ui.notifications.warn('Select a player to push contacts to.');
      return;
    }

    const actor = game.actors.get(actorId);
    const confirmed = await Dialog.confirm({
      title: 'Push All Contacts',
      content: `<p>Push all currently visible contacts to <strong>${actor?.name}</strong>?</p>`,
    });

    if (!confirmed) return;

    const result = await this.masterContactService.syncAllToPlayer?.(actorId);
    if (result?.success) {
      ui.notifications.info(`${result.count} contacts pushed to ${actor.name}.`);
    } else {
      ui.notifications.error('Failed to push contacts.');
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Action Handlers — Import / Link
  // ═══════════════════════════════════════════════════════════

  /**
   * Import contacts from a JSON file.
   */
  static async _onImportContactsJSON(event, target) {
    const svc = this.masterContactService;
    if (!svc) return;

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.style.display = 'none';
    document.body.appendChild(input);

    input.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const contacts = JSON.parse(text);

        if (!Array.isArray(contacts)) {
          ui.notifications.error('Invalid format — expected a JSON array of contacts.');
          return;
        }

        let imported = 0;
        let skipped = 0;
        const existing = svc.getAll() || [];
        const existingEmails = new Set(existing.map(c => c.email?.toLowerCase()));

        for (const c of contacts) {
          if (!c.name) { skipped++; continue; }
          if (c.email && existingEmails.has(c.email.toLowerCase())) { skipped++; continue; }

          const result = await svc.addContact({
            name: c.name,
            email: c.email || '',
            alias: c.alias || '',
            phone: c.phone || '',
            organization: c.organization || '',
            portrait: c.portrait || '',
            type: c.type || c.role || 'npc',
            tags: c.tags || [],
            notes: c.notes || '',
            relationship: c.relationship || '',
            trust: c.trust ?? 3,
          });
          if (result?.success) {
            imported++;
            existingEmails.add(c.email?.toLowerCase());
          }
        }

        ui.notifications.info(`Imported ${imported} contacts.${skipped ? ` ${skipped} skipped.` : ''}`);
        this.render(true);
      } catch (err) {
        console.error('NCM | Import contacts failed:', err);
        ui.notifications.error('Failed to parse JSON file.');
      } finally {
        input.remove();
      }
    });

    input.click();
  }

  /**
   * Open a searchable actor-linking dialog for the selected contact.
   */
  static async _onLinkActor(event, target) {
    const contactId = this._selectedContactId;
    if (!contactId) return;

    const contact = this.masterContactService?.getContact(contactId);
    if (!contact) return;

    const actors = game.actors.map(a => ({
      id: a.id,
      name: a.name,
      img: a.img,
      isPlayer: a.hasPlayerOwner,
      ownerName: a.hasPlayerOwner
        ? Object.entries(a.ownership || {}).reduce((name, [uid, level]) => {
            if (uid !== 'default' && level === CONST.DOCUMENT_PERMISSION_LEVELS.OWNER) {
              return game.users.get(uid)?.name || name;
            }
            return name;
          }, null)
        : null,
    })).sort((a, b) => {
      if (a.isPlayer !== b.isPlayer) return a.isPlayer ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    const actorRows = actors.map(a => {
      const isLinked = a.id === contact.actorId;
      const playerTag = a.isPlayer ? `<span style="color:#f7c948;font-size:9px;"> (${a.ownerName || 'Player'})</span>` : '';
      const linkedTag = isLinked ? `<span style="color:#00ff41;font-size:9px;"> ✓ LINKED</span>` : '';
      const imgHtml = a.img && a.img !== 'icons/svg/mystery-man.svg'
        ? `<img src="${a.img}" style="width:24px;height:24px;border-radius:50%;object-fit:cover;margin-right:6px;">`
        : `<span style="display:inline-block;width:24px;height:24px;border-radius:50%;background:#252540;text-align:center;line-height:24px;font-size:10px;font-weight:700;margin-right:6px;color:#8888a0;">${a.name[0]}</span>`;

      return `<div class="ncm-link-actor-row" data-actor-id="${a.id}" style="display:flex;align-items:center;padding:4px 8px;cursor:pointer;border-bottom:1px solid rgba(42,42,69,0.3);${isLinked ? 'background:rgba(0,255,65,0.05);' : ''}">${imgHtml}<span style="flex:1;font-size:11px;font-weight:600;">${a.name}</span>${playerTag}${linkedTag}</div>`;
    }).join('');

    const currentLinked = contact.actorId ? (game.actors.get(contact.actorId)?.name || 'Unknown') : 'None';

    const content = `
      <div style="margin-bottom:8px;">
        <input type="text" id="ncm-link-search" placeholder="Search actors..."
               style="width:100%;padding:4px 8px;font-family:monospace;font-size:10px;background:#1a1a2e;border:1px solid #2a2a45;color:#e0e0e8;border-radius:2px;outline:none;">
      </div>
      <div id="ncm-link-actor-list" style="max-height:300px;overflow-y:auto;border:1px solid #2a2a45;border-radius:2px;">
        ${actorRows}
      </div>
      <p style="font-size:9px;color:#8888a0;margin-top:6px;">Currently linked: <strong>${currentLinked}</strong></p>
    `;

    // Need 'this' reference for the callback
    const app = this;

    const d = new Dialog({
      title: `Link Actor — ${contact.name}`,
      content,
      buttons: {
        unlink: {
          icon: '<i class="fas fa-link-slash"></i>',
          label: 'Unlink',
          callback: async () => {
            await app.masterContactService.updateContact(contactId, { actorId: '' });
            ui.notifications.info(`${contact.name} unlinked.`);
            app.render(true);
          },
        },
        cancel: { icon: '<i class="fas fa-times"></i>', label: 'Cancel' },
      },
      default: 'cancel',
      render: (html) => {
        const searchInput = html[0]?.querySelector('#ncm-link-search') || html.find('#ncm-link-search')[0];
        const listContainer = html[0]?.querySelector('#ncm-link-actor-list') || html.find('#ncm-link-actor-list')[0];

        if (searchInput) {
          searchInput.addEventListener('input', (e) => {
            const q = e.target.value.toLowerCase();
            listContainer?.querySelectorAll('.ncm-link-actor-row').forEach(row => {
              row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
            });
          });
          setTimeout(() => searchInput.focus(), 50);
        }

        if (listContainer) {
          listContainer.addEventListener('click', async (e) => {
            const row = e.target.closest('[data-actor-id]');
            if (!row) return;
            const selectedActorId = row.dataset.actorId;

            await app.masterContactService.updateContact(contactId, { actorId: selectedActorId });
            const actor = game.actors.get(selectedActorId);
            ui.notifications.info(`${contact.name} linked to ${actor?.name}.`);
            app.render(true);
            d.close();
          });
        }
      },
    }, { classes: ['ncm-app'], width: 400 });

    d.render(true);
  }

  /**
   * Unlink the current actor from the selected contact.
   */
  static async _onUnlinkActor(event, target) {
    const contactId = this._selectedContactId;
    if (!contactId) return;

    await this.masterContactService.updateContact(contactId, { actorId: '' });
    ui.notifications.info('Actor unlinked.');
    this.render(true);
  }

  // ═══════════════════════════════════════════════════════════
  //  Action Handlers — Portrait
  // ═══════════════════════════════════════════════════════════

  /**
   * Upload a portrait for the selected contact via FilePicker.
   */
  static async _onUploadPortrait(event, target) {
    event.stopPropagation();
    const contactId = this._selectedContactId;
    if (!contactId) return;

    const fp = new FilePicker({
      type: 'image',
      current: '',
      callback: async (path) => {
        if (!path) return;

        // Process via PortraitService if available
        let finalPath = path;
        if (this.portraitService?.processImage) {
          try {
            finalPath = await this.portraitService.processImage(path);
          } catch (err) {
            log.warn('PortraitService processing failed, using raw path:', err);
          }
        }

        await this.masterContactService.updateContact(contactId, { portrait: finalPath });
        this.render();
      },
    });
    fp.browse();
  }

  /**
   * Remove the portrait from the selected contact.
   */
  static async _onRemovePortrait(event, target) {
    event.stopPropagation();
    const contactId = this._selectedContactId;
    if (!contactId) return;

    await this.masterContactService.updateContact(contactId, { portrait: '' });
    this.render();
  }

  // ═══════════════════════════════════════════════════════════
  //  Action Handlers — Tag Filters
  // ═══════════════════════════════════════════════════════════

  /**
   * Toggle a tag filter.
   */
  static _onToggleTagFilter(event, target) {
    event.stopPropagation();
    const tag = target.closest('[data-tag]')?.dataset.tag?.toUpperCase();
    if (!tag) return;

    if (this._activeTagFilters.includes(tag)) {
      this._activeTagFilters = this._activeTagFilters.filter(t => t !== tag);
    } else {
      this._activeTagFilters.push(tag);
    }
    this.render();
  }

  /**
   * Clear all tag filters.
   */
  static _onClearTagFilters(event, target) {
    this._activeTagFilters = [];
    this._orgFilter = '';
    this.render();
  }

  /**
   * Create a new custom tag via dialog.
   */
  static async _onStartAddTag(event, target) {
    const result = await Dialog.prompt({
      title: 'Create Tag',
      content: `
        <form class="ncm-dialog-form">
          <div class="form-group">
            <label>Tag Name</label>
            <input type="text" name="tagName" placeholder="e.g. ARASAKA"
                   maxlength="20" autofocus style="text-transform: uppercase;" />
          </div>
        </form>`,
      callback: (html) => {
        const name = html.querySelector('[name="tagName"]')?.value?.trim()?.toUpperCase();
        return name || null;
      },
      rejectClose: false,
    });

    if (result && this.masterContactService?.addTag) {
      await this.masterContactService.addTag(result);
      this.render();
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Action Handlers — Compose
  // ═══════════════════════════════════════════════════════════

  /**
   * Open message composer addressed to the selected contact.
   */
  static _onComposeToContact(event, target) {
    const contactId = this._selectedContactId;
    if (!contactId) return;

    const contact = this.masterContactService?.getContact(contactId);
    if (!contact?.email) {
      ui.notifications.warn('Contact has no email address.');
      return;
    }

    if (game.nightcity?.composeMessage) {
      game.nightcity.composeMessage({ toActorId: contact.actorId || null });
    }
  }

  /**
   * Open the composer as this contact (send-as identity).
   * Uses the contact's email and name as the sender.
   */
  static _onSendAsContact(event, target) {
    const contactId = this._selectedContactId;
    if (!contactId) return;

    const contact = this.masterContactService?.getContact(contactId);
    if (!contact) return;

    if (game.nightcity?.composeMessage) {
      // If the contact has a linked actor, use that; otherwise use contact identity
      if (contact.actorId) {
        game.nightcity.composeMessage({ fromActorId: contact.actorId });
      } else {
        game.nightcity.composeMessage({
          fromContact: {
            id: contact.id,
            name: contact.name,
            email: contact.email,
            portrait: contact.portrait || null,
          },
        });
      }
    }
  }

  /**
   * Open the viewer showing this contact's virtual inbox.
   * Uses the contactId for actor-less contacts or actorId for linked ones.
   */
  static _onOpenContactInbox(event, target) {
    const contactId = this._selectedContactId;
    if (!contactId) return;

    const contact = this.masterContactService?.getContact(contactId);
    if (!contact) return;

    // Use linked actor inbox if available, otherwise contact virtual inbox
    const inboxId = contact.actorId || contactId;

    if (game.nightcity?.openInbox) {
      game.nightcity.openInbox(inboxId);
    } else {
      // Fallback — try to open MessageViewerApp directly
      const viewerClass = game.nightcity?.MessageViewerApp;
      if (viewerClass) {
        new viewerClass({ actorId: inboxId }).render(true);
      } else {
        ui.notifications.warn('Message viewer not available.');
      }
    }
  }

  /**
   * Export all master contacts as JSON file.
   */
  static _onExportContacts(event, target) {
    const svc = this.masterContactService;
    if (!svc) return;

    const contacts = svc.getAll?.() || [];
    const data = JSON.stringify(contacts, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `ncm-master-contacts-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);

    ui.notifications.info(`Exported ${contacts.length} contacts.`);
  }

  // ═══════════════════════════════════════════════════════════
  //  Action Handlers — Bulk
  // ═══════════════════════════════════════════════════════════

  static _onBulkToggle(event, target) {
    const contactId = target.closest('[data-contact-id]')?.dataset.contactId;
    if (!contactId) return;

    if (this._bulkSelected.has(contactId)) {
      this._bulkSelected.delete(contactId);
    } else {
      this._bulkSelected.add(contactId);
    }
    // No full re-render for bulk toggle — toggle class directly
    target.closest('.ncm-gm-list-item')?.classList.toggle('ncm-gm-list-item--bulk-selected');
  }

  static async _onBulkDelete(event, target) {
    if (!this._bulkSelected.size) {
      ui.notifications.warn('No contacts selected for bulk operation.');
      return;
    }

    const confirmed = await Dialog.confirm({
      title: 'Bulk Delete',
      content: `<p>Delete <strong>${this._bulkSelected.size}</strong> selected contacts?</p>`,
    });

    if (!confirmed) return;

    let deleted = 0;
    for (const id of this._bulkSelected) {
      const result = await this.masterContactService.removeContact(id);
      if (result.success) deleted++;
    }

    this._bulkSelected.clear();
    this._selectedContactId = null;
    ui.notifications.info(`Deleted ${deleted} contacts.`);
    this.render();
  }
}
