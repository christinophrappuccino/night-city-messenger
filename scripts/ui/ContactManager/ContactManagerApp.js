/**
 * Contact Manager Application — Sprint 3 Rewrite
 * @file scripts/ui/ContactManager/ContactManagerApp.js
 * @module cyberpunkred-messenger
 * @description Player contact directory with grid/list toggle, custom tag filtering,
 *   search, trust meters, portraits, burned/encrypted states.
 *   Extends BaseApplication for lifecycle, EventBus, and atmosphere management.
 *
 *   Sprint 3 features:
 *     - Grid view (card grid) and List view (dense rows)
 *     - Custom tag system (user-created, gold dashed-border pills)
 *     - Trust meter display (5-segment, GM-controlled)
 *     - Burned contact state (visual drama)
 *     - Encrypted/ICE contacts (hack to reveal)
 *     - Portrait upload overlay
 *     - Status indicators (derived from actor online state)
 *     - Network-themed display (citinet/darknet/corpnet)
 *     - Context-aware footer with keyboard shortcuts
 */

import { MODULE_ID, TEMPLATES, EVENTS } from '../../utils/constants.js';
import { log } from '../../utils/helpers.js';
import { BaseApplication } from '../BaseApplication.js';
import {
  getAvatarColor,
  getInitials,
  enrichContactForDisplay,
} from '../../utils/designHelpers.js';

export class ContactManagerApp extends BaseApplication {

  // ═══════════════════════════════════════════════════════════
  //  Instance State
  // ═══════════════════════════════════════════════════════════

  /** @type {string|null} Actor whose contacts we're managing */
  actorId = null;

  /** @type {string} Current view mode: 'grid' | 'list' */
  viewMode = 'grid';

  /** @type {string} Current search query */
  searchTerm = '';

  /** @type {string[]} Currently active tag filters */
  activeTagFilters = [];

  /** @type {string|null} Currently selected contact ID */
  selectedContactId = null;

  /** @type {boolean} Whether user is adding a new contact */
  isAdding = false;

  /** @type {string|null} Contact being edited */
  editingContactId = null;

  /** @type {Array} Cached contact data */
  _contacts = [];

  /** @type {string[]} All available tags */
  _allTags = [];

  // ═══════════════════════════════════════════════════════════
  //  Service Accessors
  // ═══════════════════════════════════════════════════════════

  get contactRepo() { return game.nightcity?.contactRepository; }
  get networkService() { return game.nightcity?.networkService; }
  get messageService() { return game.nightcity?.messageService; }
  get portraitService() { return game.nightcity?.portraitService; }

  // ═══════════════════════════════════════════════════════════
  //  ApplicationV2 Configuration
  // ═══════════════════════════════════════════════════════════

  static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
    id: 'ncm-contact-manager',
    classes: ['ncm-app', 'ncm-contact-manager'],
    window: {
      title: 'Contacts',
      icon: 'fas fa-address-book',
      resizable: true,
      minimizable: true,
    },
    position: {
      width: 700,
      height: 620,
    },
    actions: {
      // ─── View actions ───
      setViewMode:    ContactManagerApp._onSetViewMode,
      selectContact:  ContactManagerApp._onSelectContact,

      // ─── Tag filter actions ───
      toggleTagFilter: ContactManagerApp._onToggleTagFilter,
      removeTagFilter: ContactManagerApp._onRemoveTagFilter,
      clearTagFilter:  ContactManagerApp._onClearTagFilter,
      startAddTag:     ContactManagerApp._onStartAddTag,

      // ─── Contact CRUD ───
      addContact:     ContactManagerApp._onAddContact,
      editContact:    ContactManagerApp._onEditContact,
      deleteContact:  ContactManagerApp._onDeleteContact,
      saveContact:    ContactManagerApp._onSaveContact,
      cancelEdit:     ContactManagerApp._onCancelEdit,

      // ─── Contact actions ───
      sendMessage:    ContactManagerApp._onSendMessage,
      shareContact:   ContactManagerApp._onShareContact,
      uploadPortrait: ContactManagerApp._onUploadPortrait,
      breachContact:  ContactManagerApp._onBreachContact,
      removePortrait: ContactManagerApp._onRemovePortrait,

      // ─── Other ───
      openSettings:   ContactManagerApp._onOpenSettings,
    },
  }, { inplace: false });

  static PARTS = {
    contacts: {
      template: TEMPLATES.CONTACT_MANAGER,
    },
  };

  // ═══════════════════════════════════════════════════════════
  //  Lifecycle
  // ═══════════════════════════════════════════════════════════

  constructor(options = {}) {
    super(options);
    this.actorId = options.actorId || null;
  }

  // ═══════════════════════════════════════════════════════════
  //  Data Preparation
  // ═══════════════════════════════════════════════════════════

  async _prepareContext(options) {
    await this._loadContacts();

    // ── Owner info ──
    const actor = this.actorId ? game.actors.get(this.actorId) : null;
    const ownerName = actor?.name || 'Unknown';
    const ownerEmail = actor ? this.contactRepo?.getActorEmail(this.actorId) || '' : '';
    const ownerAvatarColor = getAvatarColor(ownerName);
    const ownerInitials = getInitials(ownerName);
    const ownerPortrait = actor?.img && actor.img !== 'icons/svg/mystery-man.svg' ? actor.img : '';

    // ── Current network ──
    const currentNetwork = this.networkService?.getCurrentNetwork?.()?.name || 'CITINET';

    // ── Filter contacts ──
    let filtered = [...this._contacts];

    // Search filter
    if (this.searchTerm) {
      const q = this.searchTerm.toLowerCase();
      filtered = filtered.filter(c =>
        c.name?.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q) ||
        c.alias?.toLowerCase().includes(q) ||
        c.organization?.toLowerCase().includes(q) ||
        c.role?.toLowerCase().includes(q) ||
        c.tags?.some(t => t.toLowerCase().includes(q))
      );
    }

    // Tag filter
    if (this.activeTagFilters.length > 0) {
      filtered = filtered.filter(c =>
        this.activeTagFilters.some(tag => c.tags?.includes(tag))
      );
    }

    // ── Enrich contacts for display ──
    const enriched = filtered.map(c =>
      enrichContactForDisplay(c, {
        selectedId: this.selectedContactId,
        currentNetwork,
      })
    );

    // ── Compute stats from ALL contacts (unfiltered) ──
    const allEnriched = this._contacts.map(c =>
      enrichContactForDisplay(c, { currentNetwork })
    );
    const onlineCount = allEnriched.filter(c =>
      ['active', 'online'].includes(c.status)
    ).length;
    const favoriteCount = this._contacts.filter(c => c.favorite).length;

    // ── Tag pills data ──
    const tagPills = this._allTags.map(tag => ({
      name: tag,
      active: this.activeTagFilters.includes(tag),
    }));

    return {
      // Owner
      ownerName,
      ownerEmail,
      ownerAvatarColor,
      ownerInitials,
      ownerPortrait: ownerPortrait || '',
      hasOwnerPortrait: !!ownerPortrait,

      // Counts
      contactCount: this._contacts.length,
      filteredCount: enriched.length,
      onlineCount,
      favoriteCount,

      // View state
      viewMode: this.viewMode,
      searchTerm: this.searchTerm,
      hasSearch: !!this.searchTerm || this.activeTagFilters.length > 0,
      hasActiveTagFilter: this.activeTagFilters.length > 0,

      // Contacts
      contacts: enriched,
      isEmpty: enriched.length === 0,

      // Tags
      allTags: tagPills,

      // Network
      currentNetwork,

      // Editing state (for future add/edit form integration)
      isAdding: this.isAdding,
      editingContactId: this.editingContactId,
      isGM: game.user.isGM,

      MODULE_ID,
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  Post-Render — DOM Setup
  // ═══════════════════════════════════════════════════════════

  _onRender(context, options) {
    super._onRender(context, options);
    this._setupSearchInput();
    this._setupKeyboardShortcuts();
  }

  /**
   * Wire up search input with debounced filtering.
   */
  _setupSearchInput() {
    const input = this.element?.querySelector('.ncm-contact-search');
    if (!input) return;

    // Remove prior listeners (safe for re-render)
    const handler = this._boundSearchHandler || (this._boundSearchHandler = this._debounce((e) => {
      this.searchTerm = e.target.value;
      this.render();
    }, 200));

    input.removeEventListener('input', handler);
    input.addEventListener('input', handler);
  }

  /**
   * Wire up keyboard shortcuts (/ to focus search, etc).
   */
  _setupKeyboardShortcuts() {
    const el = this.element;
    if (!el) return;

    // Remove prior listener
    if (this._boundKeyHandler) {
      el.removeEventListener('keydown', this._boundKeyHandler);
    }

    this._boundKeyHandler = (e) => {
      // Skip if typing in an input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      if (e.key === '/') {
        e.preventDefault();
        this.element?.querySelector('.ncm-contact-search')?.focus();
      } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        this.isAdding = true;
        this.render();
      }
    };

    el.addEventListener('keydown', this._boundKeyHandler);
  }

  // ═══════════════════════════════════════════════════════════
  //  Event Subscriptions
  // ═══════════════════════════════════════════════════════════

  _setupEventSubscriptions() {
    // Re-render when contacts are modified externally (e.g. GM push)
    this.subscribe(EVENTS.CONTACT_BURNED, () => this.render());
    this.subscribe(EVENTS.CONTACT_SHARED, () => this.render());
    this.subscribe(EVENTS.CONTACT_TRUST_CHANGED, () => this.render());
    this.subscribe(EVENTS.CONTACT_TAGS_UPDATED, () => this.render());
  }

  // ═══════════════════════════════════════════════════════════
  //  Data Loading
  // ═══════════════════════════════════════════════════════════

  async _loadContacts() {
    if (!this.actorId || !this.contactRepo) {
      this._contacts = [];
      this._allTags = [];
      return;
    }

    this._contacts = await this.contactRepo.getContacts(this.actorId);
    this._allTags = await this.contactRepo.getAllTags(this.actorId);
  }

  // ═══════════════════════════════════════════════════════════
  //  Action Handlers — View
  // ═══════════════════════════════════════════════════════════

  /**
   * Toggle between grid and list view.
   */
  static _onSetViewMode(event, target) {
    const mode = target.dataset.mode;
    if (mode && (mode === 'grid' || mode === 'list')) {
      this.viewMode = mode;
      this.render();
    }
  }

  /**
   * Select a contact (toggle selection).
   */
  static _onSelectContact(event, target) {
    const contactId = target.closest('[data-contact-id]')?.dataset.contactId;
    if (!contactId) return;

    this.selectedContactId = this.selectedContactId === contactId ? null : contactId;
    this.render();
  }

  // ═══════════════════════════════════════════════════════════
  //  Action Handlers — Tag Filters
  // ═══════════════════════════════════════════════════════════

  /**
   * Toggle a tag filter on/off.
   */
  static _onToggleTagFilter(event, target) {
    event.stopPropagation();
    const tag = target.closest('[data-tag]')?.dataset.tag;
    if (!tag) return;

    if (this.activeTagFilters.includes(tag)) {
      this.activeTagFilters = this.activeTagFilters.filter(t => t !== tag);
    } else {
      this.activeTagFilters.push(tag);
    }
    this.render();
  }

  /**
   * Remove a specific active tag filter.
   */
  static _onRemoveTagFilter(event, target) {
    event.stopPropagation();
    const tag = target.closest('[data-tag]')?.dataset.tag;
    if (!tag) return;

    this.activeTagFilters = this.activeTagFilters.filter(t => t !== tag);
    this.render();
  }

  /**
   * Clear all tag filters (show ALL).
   */
  static _onClearTagFilter(event, target) {
    this.activeTagFilters = [];
    this.render();
  }

  /**
   * Start inline tag creation.
   * Shows a dialog to enter the new tag name.
   */
  static async _onStartAddTag(event, target) {
    const result = await Dialog.prompt({
      title: 'Create Tag',
      content: `
        <form class="ncm-dialog-form">
          <div class="form-group">
            <label>Tag Name</label>
            <input type="text" name="tagName" placeholder="e.g. HEIST CREW"
                   maxlength="20" autofocus style="text-transform: uppercase;" />
          </div>
        </form>`,
      callback: (html) => {
        const name = html.querySelector('[name="tagName"]')?.value?.trim()?.toUpperCase();
        return name || null;
      },
      rejectClose: false,
    });

    if (result && this.contactRepo) {
      await this.contactRepo.addCustomTag(this.actorId, result);
      this.render();
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Action Handlers — Contact CRUD
  // ═══════════════════════════════════════════════════════════

  /**
   * Open add contact form.
   */
  static _onAddContact(event, target) {
    // TODO: Sprint 3 add form — for now, use the existing dialog pattern
    this.isAdding = true;
    this.editingContactId = null;
    this.render();
  }

  /**
   * Open edit form for a contact.
   */
  static _onEditContact(event, target) {
    event.stopPropagation();
    const contactId = target.closest('[data-contact-id]')?.dataset.contactId;
    if (!contactId) return;

    this.editingContactId = contactId;
    this.isAdding = false;
    this.render();
  }

  /**
   * Delete a contact with confirmation.
   */
  static async _onDeleteContact(event, target) {
    event.stopPropagation();
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
      if (this.selectedContactId === contactId) this.selectedContactId = null;
      if (this.editingContactId === contactId) this.editingContactId = null;
      this.render();
    } else {
      ui.notifications.error(`Failed to delete contact: ${result.error}`);
    }
  }

  /**
   * Save contact from add/edit form.
   */
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
      role: formData.get('role')?.trim()?.toLowerCase(),
      tags: formData.get('tags')?.split(',').map(t => t.trim().toUpperCase()).filter(Boolean) || [],
      notes: formData.get('notes')?.trim(),
      type: formData.get('type') || 'npc',
      network: formData.get('network')?.trim()?.toLowerCase() || 'citinet',
    };

    if (!data.name) {
      ui.notifications.warn('Contact name is required.');
      return;
    }

    try {
      let result;
      if (this.isAdding) {
        result = await this.contactRepo.addContact(this.actorId, data);
        if (result.success) {
          this.isAdding = false;
          this.selectedContactId = result.contact.id;
          ui.notifications.info(`Contact "${data.name}" added.`);
        }
      } else if (this.editingContactId) {
        result = await this.contactRepo.updateContact(this.actorId, this.editingContactId, data);
        if (result.success) {
          this.editingContactId = null;
          ui.notifications.info(`Contact "${data.name}" updated.`);
        }
      }

      if (!result?.success) {
        ui.notifications.error(result?.error || 'Failed to save contact.');
      }

      this.render();
    } catch (error) {
      console.error(`${MODULE_ID} | ContactManagerApp._onSaveContact:`, error);
      ui.notifications.error('Failed to save contact.');
    }
  }

  /**
   * Cancel add/edit.
   */
  static _onCancelEdit(event, target) {
    this.isAdding = false;
    this.editingContactId = null;
    this.render();
  }

  // ═══════════════════════════════════════════════════════════
  //  Action Handlers — Contact Actions
  // ═══════════════════════════════════════════════════════════

  /**
   * Open message composer addressed to this contact.
   */
  static _onSendMessage(event, target) {
    event.stopPropagation();
    const contactId = target.closest('[data-contact-id]')?.dataset.contactId;
    if (!contactId) return;

    const contact = this._contacts.find(c => c.id === contactId);
    if (!contact?.email) {
      ui.notifications.warn('Contact has no email address.');
      return;
    }

    // Launch composer with pre-filled recipient
    if (game.nightcity?.composeMessage) {
      game.nightcity.composeMessage({
        fromActorId: this.actorId,
        to: contact.email,
      });
    }
  }

  /**
   * Share contact with another player (Sprint 3.4 — stub).
   */
  static _onShareContact(event, target) {
    event.stopPropagation();
    const contactId = target.closest('[data-contact-id]')?.dataset.contactId;
    if (!contactId) return;

    // TODO: Sprint 3.4 — Open share dialog with Data Drop
    ui.notifications.info('Contact sharing coming in Sprint 3.4.');
  }

  /**
   * Upload a portrait image for a contact.
   * Offers choice between FilePicker (Foundry paths) and native file input.
   * Processes image via PortraitService (resize/crop to 128×128).
   */
  static async _onUploadPortrait(event, target) {
    event.stopPropagation();
    const contactId = target.closest('[data-contact-id]')?.dataset.contactId;
    if (!contactId) return;

    // Permission check
    const portraitService = this.portraitService;
    if (!portraitService?.canUploadPortrait(this.actorId)) {
      ui.notifications.warn('You do not have permission to modify this contact.');
      return;
    }

    // Offer choice: FilePicker vs native upload
    const useFilePicker = await Dialog.confirm({
      title: 'Upload Portrait',
      content: `
        <p style="font-family: 'Share Tech Mono', monospace; font-size: 11px; color: var(--ncm-text-secondary, #8888a0);">
          Choose image source:
        </p>
        <p style="font-family: 'Share Tech Mono', monospace; font-size: 10px; color: var(--ncm-text-muted, #555570);">
          <strong>Yes</strong> — Browse Foundry files (world/module images)<br>
          <strong>No</strong> — Upload from your computer (auto-resized to 128×128)
        </p>`,
      yes: 'Browse Files',
      no: 'Upload Local',
      defaultYes: true,
    });

    let result;

    if (useFilePicker) {
      // FilePicker approach — stores file path (lighter on flags)
      result = await portraitService.uploadViaFilePicker(
        this.actorId, contactId, { useBase64: false }
      );
    } else {
      // Native file input — processes to base64
      result = await portraitService.uploadViaFileInput(this.actorId, contactId);
    }

    if (result.success) {
      ui.notifications.info('Portrait updated.');
      this.render();
    } else if (result.error && result.error !== 'No file selected' && result.error !== 'Upload cancelled') {
      ui.notifications.error(`Portrait upload failed: ${result.error}`);
    }
  }

  /**
   * Remove portrait from a contact (revert to initials).
   */
  static async _onRemovePortrait(event, target) {
    event.stopPropagation();
    const contactId = target.closest('[data-contact-id]')?.dataset.contactId;
    if (!contactId) return;

    const portraitService = this.portraitService;
    if (!portraitService) return;

    const result = await portraitService.removePortrait(this.actorId, contactId);
    if (result.success) {
      ui.notifications.info('Portrait removed.');
      this.render();
    }
  }


  /**
   * Attempt to breach an encrypted contact (Sprint 3.7 — stub).
   */
  static _onBreachContact(event, target) {
    event.stopPropagation();
    const contactId = target.closest('[data-contact-id]')?.dataset.contactId;
    if (!contactId) return;

    // TODO: Sprint 3.7 — Trigger hack flow via SkillService
    ui.notifications.info('ICE breach coming in Sprint 3.7.');
  }

  /**
   * Open settings / preferences.
   */
  static _onOpenSettings(event, target) {
    if (game.nightcity?.openThemeCustomizer) {
      game.nightcity.openThemeCustomizer();
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Utilities
  // ═══════════════════════════════════════════════════════════

  /**
   * Simple debounce utility.
   * @param {Function} fn
   * @param {number} delay
   * @returns {Function}
   */
  _debounce(fn, delay) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }
}
