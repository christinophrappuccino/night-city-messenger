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
  get contactBreachService() { return game.nightcity?.contactBreachService; }

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
      openGMContacts: ContactManagerApp._onOpenGMContacts,

      // ─── Gm Verify Contact ───
      gmVerifyContact:   ContactManagerApp._onGMVerifyContact,
      gmUnverifyContact: ContactManagerApp._onGMUnverifyContact,

      // ─── Contact actions ───
      sendMessage:    ContactManagerApp._onSendMessage,
      shareContact:   ContactManagerApp._onShareContact,
      uploadPortrait: ContactManagerApp._onUploadPortrait,
      breachContact:  ContactManagerApp._onBreachContact,
      removePortrait: ContactManagerApp._onRemovePortrait,
      setTrustLevel:    ContactManagerApp._onSetTrustLevel,
      burnContact:      ContactManagerApp._onBurnContact,
      restoreContact:   ContactManagerApp._onRestoreContact,
      breachContact:    ContactManagerApp._onBreachContact,
      forceDecrypt:     ContactManagerApp._onForceDecrypt,

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
    this.gmInspectMode = options.gmInspectMode || false;
  }

  // ── Dynamic window title ──────────────────────────────
  get title() {
    if (this.gmInspectMode) {
      const actorName = game.actors.get(this.actorId)?.name || 'Unknown';
      return `NCM Contacts — ${actorName} [GM]`;
    }
    return game.i18n.localize('NCM.ContactManager.Title');
  }

  // ═══════════════════════════════════════════════════════════
  //  Data Preparation
  // ═══════════════════════════════════════════════════════════

  async _prepareContext(options) {
    await this._loadContacts();

    // ── Stamp verification display data onto each contact ──
    const requireVerification = game.settings.get(MODULE_ID, 'requireContactVerification') ?? true;

    for (const contact of this._contacts) {
      // Verification class for CSS
      if (contact.burned) {
        contact._verifyClass = 'burned';
        contact._verifyLabel = 'BURNED';
        contact._canMessage = false;
      } else if (contact.verifiedOverride) {
        contact._verifyClass = 'gm-verified';
        contact._verifyLabel = 'GM VERIFIED';
        contact._canMessage = true;
      } else if (contact.verified) {
        contact._verifyClass = 'verified';
        contact._verifyLabel = 'VERIFIED';
        contact._canMessage = true;
      } else {
        contact._verifyClass = 'unverified';
        contact._verifyLabel = 'UNVERIFIED';
        // Can still message if verification is disabled globally
        contact._canMessage = !requireVerification;
      }
    }

    // ── Verification counts ──
    const verifiedCount = this._contacts.filter(
      c => c.verified || c.verifiedOverride
    ).length;
    const unverifiedCount = this._contacts.filter(
      c => !c.verified && !c.verifiedOverride && !c.burned
    ).length;

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

    // ── Resolve editing contact for form population ──
    let editingContact = null;
    if (this.editingContactId) {
      const raw = this._contacts.find(c => c.id === this.editingContactId);
      if (raw) editingContact = enrichContactForDisplay(raw, { isGM: game.user.isGM });
    }

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

      // Edit Contact
      editingContact,
      isGridView: this.viewMode === 'grid',

      // Tags
      allTags: tagPills,

      // Network
      currentNetwork,

      // Verification context
      gmInspectMode: this.gmInspectMode,
      inspectedActorName: this.gmInspectMode
        ? game.actors.get(this.actorId)?.name || 'Unknown'
        : null,
      verifiedCount,
      unverifiedCount,
      requireVerification,

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
    this._setupEmailVerification(); 
    if (game.user.isGM) {
      this._setupTrustHoverPreview(this.element);
    }
  }

  /**
   * Set up hover preview on interactive trust segments.
   * When hovering segment N, all segments 1..N light up with preview class.
   * @param {HTMLElement} element
   */
  _setupTrustHoverPreview(element) {
    const interactiveBars = element.querySelectorAll('.ncm-trust-detail__bar--interactive');

    for (const bar of interactiveBars) {
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
  //  Email Verification
  // ═══════════════════════════════════════════════════════════

  /**
   * Live email verification on the contact form.
   * Debounces input, checks against master directory,
   * updates the indicator icon and hint text in real time.
   * @private
   */
  _setupEmailVerification() {
    const emailInput = this.element?.querySelector('.ncm-email-verify-input');
    const indicator = this.element?.querySelector('.ncm-email-verify-indicator');
    const hint = this.element?.querySelector('.ncm-email-verify-hint');
    if (!emailInput || !indicator) return;

    let debounceTimer;

    emailInput.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      const email = e.target.value.trim();

      if (!email) {
        indicator.dataset.verifyStatus = 'unknown';
        indicator.innerHTML = '<i class="fas fa-circle-question"></i>';
        if (hint) {
          hint.textContent = "Enter the contact's net address. The system will verify it.";
          hint.classList.remove('ncm-form-hint--danger', 'ncm-form-hint--success');
        }
        return;
      }

      // Show checking state
      indicator.dataset.verifyStatus = 'checking';
      indicator.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

      debounceTimer = setTimeout(() => {
        const contactRepo = game.nightcity?.contactRepository;
        if (!contactRepo?.verifyContact) return;

        const result = contactRepo.verifyContact(email);

        if (result.verified) {
          indicator.dataset.verifyStatus = 'verified';
          indicator.innerHTML = '<i class="fas fa-circle-check"></i>';
          if (hint) {
            hint.textContent = 'CONNECTION ESTABLISHED — Address verified.';
            hint.classList.remove('ncm-form-hint--danger');
            hint.classList.add('ncm-form-hint--success');
          }

          // Auto-populate name if the field is empty
          const nameInput = this.element?.querySelector('[name="name"]');
          const masterContact = game.nightcity?.masterContactService?.getByEmail(email);
          if (masterContact && nameInput && !nameInput.value.trim()) {
            nameInput.value = masterContact.name;
          }
        } else {
          indicator.dataset.verifyStatus = 'unverified';
          indicator.innerHTML = '<i class="fas fa-triangle-exclamation"></i>';
          if (hint) {
            hint.textContent = 'NO SIGNAL — Address not found in directory. Contact will be unverified.';
            hint.classList.remove('ncm-form-hint--success');
            hint.classList.add('ncm-form-hint--danger');
          }
        }
      }, 400);
    });
  }

  /**
   * GM force-verifies an unverified contact in the inspected player's book.
   */
  static async _onGMVerifyContact(event, target) {
    event.stopPropagation();
    if (!game.user.isGM) return;

    const contactId = target.closest('[data-contact-id]')?.dataset.contactId;
    if (!contactId) return;

    const contactRepo = game.nightcity?.contactRepository;
    const result = await contactRepo?.gmOverrideVerification(this.actorId, contactId, true);

    if (result?.success) {
      const contact = this._contacts.find(c => c.id === contactId);
      ui.notifications.info(`Contact "${contact?.name || contactId}" force-verified.`);
      this.render(true);
    } else {
      ui.notifications.error(result?.error || 'Failed to verify contact.');
    }
  }

  /**
   * GM revokes verification from a contact.
   */
  static async _onGMUnverifyContact(event, target) {
    event.stopPropagation();
    if (!game.user.isGM) return;

    const contactId = target.closest('[data-contact-id]')?.dataset.contactId;
    if (!contactId) return;

    const contact = this._contacts.find(c => c.id === contactId);
    const confirmed = await Dialog.confirm({
      title: 'Revoke Verification',
      content: `<p>Revoke verification for <strong>${contact?.name || 'this contact'}</strong>?`
        + `<br>The player will no longer be able to message them.</p>`,
    });
    if (!confirmed) return;

    const contactRepo = game.nightcity?.contactRepository;
    const result = await contactRepo?.gmOverrideVerification(this.actorId, contactId, false);

    if (result?.success) {
      ui.notifications.info(`Verification revoked for "${contact?.name}".`);
      this.render(true);
    } else {
      ui.notifications.error(result?.error || 'Failed to unverify contact.');
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Event Subscriptions
  // ═══════════════════════════════════════════════════════════

  _setupEventSubscriptions() {
    this.subscribe(EVENTS.CONTACT_UPDATED, () => this._debouncedRender());
    this.subscribe(EVENTS.CONTACT_BURNED, () => this.render());
    this.subscribe(EVENTS.CONTACT_SHARED, () => this.render());
    this.subscribe(EVENTS.CONTACT_TRUST_CHANGED, () => this.render());
    this.subscribe(EVENTS.CONTACT_TAGS_UPDATED, () => this.render());
    this.subscribe(EVENTS.CONTACT_DECRYPTED, () => {});
    this.subscribe(EVENTS.CONTACT_BREACH_FAILED, () => {});
    this.subscribe(EVENTS.CONTACTS_REVERIFIED, () => {
       this._loadContacts();
       this.render(true);
     });
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

    // GM-only fields
    if (game.user.isGM) {
      const trustVal = formData.get('trust');
      if (trustVal !== null && trustVal !== undefined) {
        data.trust = parseInt(trustVal, 10);
      }
      const relationship = formData.get('relationship');
      if (relationship !== null) data.relationship = relationship;
    }

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

  /**
   * Open GM Master Contact Directory.
   */
  static _onOpenGMContacts(event, target) {
    if (!game.user.isGM) return;
    if (game.nightcity?.gmContactManager) {
      game.nightcity.gmContactManager.render(true);
    }
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
        toActorId: contact.actorId || null,
      });
    }
  }

  /**
   * Share contact with another player (Sprint 3.4 — stub).
   */
  static async _onShareContact(event, target) {
    event.stopPropagation();
    const contactId = target.closest('[data-contact-id]')?.dataset.contactId;
    if (!contactId) return;

    const contact = this._contacts.find(c => c.id === contactId);
    if (!contact) return;

    // Dynamic import to keep initial bundle light
    const { ContactShareDialog } = await import('./ContactShareDialog.js');
    new ContactShareDialog({
      senderActorId: this.actorId,
      contact,
    }).render(true);
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
   * Player clicks encrypted overlay → attempt breach via ContactBreachService.
   * Handles success (unscramble animation) and failure (denied animation).
   * @static
   */
  static async _onBreachContact(event, target) {
    event.stopPropagation();

    const contactId = target.closest('[data-contact-id]')?.dataset.contactId;
    if (!contactId) return;

    // Get the actor performing the breach
    const actor = game.user?.character;
    if (!actor) {
      ui.notifications.warn('Select a character to attempt the breach.');
      return;
    }

    const breachService = this.contactBreachService;
    if (!breachService) {
      ui.notifications.error('Breach service not available.');
      return;
    }

    // Find the overlay element for animation (grid or list view)
    const overlayEl = target.closest('.ncm-encrypted-overlay')
      || target.closest('.ncm-list-item__ice-overlay')
      || target;
    const cardEl = overlayEl.closest('[data-contact-id]');
    const isListView = overlayEl.classList.contains('ncm-list-item__ice-overlay');

    // Show breaching state
    overlayEl.classList.add('ncm-encrypted-overlay--breaching');

    // Attempt breach
    const result = await breachService.attemptBreach(
      this.actorId,
      contactId,
      actor,
      { luckSpend: 0 } // TODO: Add luck dialog option in future
    );

    // Remove breaching indicator
    overlayEl.classList.remove('ncm-encrypted-overlay--breaching');

    if (result.success) {
      // ── SUCCESS: Unscramble animation ──
      if (isListView) {
        this._playListUnscrambleAnimation(overlayEl, cardEl, () => { this.render(); });
      } else {
        this._playUnscrambleAnimation(overlayEl, cardEl, () => { this.render(); });
      }
    } else if (result.error) {
      // Service-level error (not a failed roll)
      ui.notifications.error(result.error);
    } else {
      // ── FAILED ROLL: Denied animation ──
      if (isListView) {
        this._playListDeniedAnimation(overlayEl);
      } else {
        this._playDeniedAnimation(overlayEl);
      }
    }
  }

  /**
   * GM sets trust level by clicking a segment in the trust detail panel.
   * data-trust-value is 0-5 (0 = reset to unknown).
   * @static
   */
  static async _onSetTrustLevel(event, target) {
    event.stopPropagation();

    if (!game.user.isGM) {
      ui.notifications.warn('Only the GM can modify trust levels.');
      return;
    }

    const contactId = target.closest('[data-contact-id]')?.dataset.contactId
      || target.dataset.contactId;
    const trustValue = parseInt(target.dataset.trustValue, 10);

    if (!contactId || isNaN(trustValue)) return;

    const contactRepo = this.contactRepo;
    if (!contactRepo) return;

    // Get contact name for feedback
    const contacts = await contactRepo.getContacts(this.actorId);
    const contact = contacts.find(c => c.id === contactId);
    if (!contact) return;

    // Set trust
    const result = await contactRepo.setTrust(this.actorId, contactId, trustValue);
    if (!result.success) {
      ui.notifications.error(`Failed to update trust: ${result.error}`);
      return;
    }

    // Determine trust label for toast
    const labels = {
      0: 'UNKNOWN', 1: 'LOW', 2: 'LOW', 3: 'MEDIUM', 4: 'HIGH', 5: 'HIGH'
    };
    const label = labels[trustValue] || 'UNKNOWN';

    // Toast feedback
    const notificationService = game.nightcity?.notificationService;
    notificationService?.showToast(
      'Trust Updated',
      `${contact.name} → ${label}`,
      trustValue >= 4 ? 'success' : trustValue >= 3 ? 'warning' : trustValue >= 1 ? 'error' : 'info',
      3000
    );

    // EventBus for cross-component refresh
    const eventBus = game.nightcity?.eventBus;
    eventBus?.emit(EVENTS.CONTACT_TRUST_CHANGED, {
      actorId: this.actorId,
      contactId,
      contactName: contact.name,
      trust: trustValue,
    });

    // Sound
    game.nightcity?.soundService?.play('notification');

    // Re-render
    this.render();
  }

  /**
   * GM burns a contact. Shows confirmation dialog first.
   * On confirm: sets burned=true, auto-drops trust to 1 if higher,
   * fires events, shows toast, plays burn transition animation.
   * @static
   */
  static async _onBurnContact(event, target) {
    event.stopPropagation();

    if (!game.user.isGM) {
      ui.notifications.warn('Only the GM can burn contacts.');
      return;
    }

    const contactId = target.closest('[data-contact-id]')?.dataset.contactId
      || target.dataset.contactId;
    if (!contactId) return;

    const contactRepo = this.contactRepo;
    if (!contactRepo) return;

    // Get contact for confirmation
    const contacts = await contactRepo.getContacts(this.actorId);
    const contact = contacts.find(c => c.id === contactId);
    if (!contact) return;

    // Already burned? Shouldn't happen but guard
    if (contact.burned) {
      ui.notifications.info(`${contact.name} is already burned.`);
      return;
    }

    // ── Confirmation Dialog ──
    const confirmed = await Dialog.confirm({
      title: 'Burn Contact',
      content: `
        <div style="font-family: 'Rajdhani', sans-serif; padding: 8px 0;">
          <p style="color: #ff0033; font-weight: 700; font-size: 14px; margin-bottom: 6px;">
            <i class="fas fa-fire"></i> Burn ${contact.name}?
          </p>
          <p style="color: #8888a0; font-size: 12px; line-height: 1.5;">
            This marks the contact as compromised. Their identity is blown —
            trust will drop to LOW and the contact will be flagged across all views.
          </p>
          <p style="color: #555570; font-size: 10px; margin-top: 8px;">
            This action is reversible via "Restore Contact".
          </p>
        </div>
      `,
      yes: { icon: 'fas fa-fire', label: 'Burn' },
      no: { icon: 'fas fa-times', label: 'Cancel' },
      defaultYes: false,
    });

    if (!confirmed) return;

    // ── Execute Burn ──

    // Set burned flag
    const burnResult = await contactRepo.setBurned(this.actorId, contactId, true);
    if (!burnResult.success) {
      ui.notifications.error(`Failed to burn contact: ${burnResult.error}`);
      return;
    }

    // Auto-drop trust to 1 if currently higher
    if (contact.trust > 1) {
      await contactRepo.setTrust(this.actorId, contactId, 1);
    }

    // ── Play burn transition animation ──
    // Find the card/list-item in the DOM and add transition classes
    const app = this;
    const cardEl = app.element?.querySelector(`[data-contact-id="${contactId}"]`);
    if (cardEl) {
      // Add flash + transition classes
      cardEl.classList.add('ncm-card--burn-flash', 'ncm-card--burn-transition');

      // Clean up after animation
      setTimeout(() => {
        cardEl.classList.remove('ncm-card--burn-flash', 'ncm-card--burn-transition');
        app.render(); // Full re-render with burned state
      }, 600);
    } else {
      // No DOM element found (maybe list view or off-screen), just re-render
      this.render();
    }

    // Sound
    game.nightcity?.soundService?.play('hack-fail');

    // Toast
    game.nightcity?.notificationService?.showContactBurned({
      contactName: contact.name,
      actorId: this.actorId,
      contactId,
    });

    // EventBus
    game.nightcity?.eventBus?.emit(EVENTS.CONTACT_BURNED, {
      actorId: this.actorId,
      contactId,
      contactName: contact.name,
      burned: true,
    });
  }

  /**
   * GM restores a burned contact. Reverses the burned flag
   * but does NOT auto-restore trust level.
   * @static
   */
  static async _onRestoreContact(event, target) {
    event.stopPropagation();

    if (!game.user.isGM) {
      ui.notifications.warn('Only the GM can restore contacts.');
      return;
    }

    const contactId = target.closest('[data-contact-id]')?.dataset.contactId
      || target.dataset.contactId;
    if (!contactId) return;

    const contactRepo = this.contactRepo;
    if (!contactRepo) return;

    const contacts = await contactRepo.getContacts(this.actorId);
    const contact = contacts.find(c => c.id === contactId);
    if (!contact) return;

    if (!contact.burned) {
      ui.notifications.info(`${contact.name} is not burned.`);
      return;
    }

    // Restore
    const result = await contactRepo.setBurned(this.actorId, contactId, false);
    if (!result.success) {
      ui.notifications.error(`Failed to restore contact: ${result.error}`);
      return;
    }

    // Toast
    game.nightcity?.notificationService?.showToast(
      'Contact Restored',
      `${contact.name} — identity restored. Trust level unchanged.`,
      'info',
      4000
    );

    // Sound
    game.nightcity?.soundService?.play('notification');

    // EventBus
    game.nightcity?.eventBus?.emit(EVENTS.CONTACT_BURNED, {
      actorId: this.actorId,
      contactId,
      contactName: contact.name,
      burned: false,
    });

    // Re-render
    this.render();
  }

  /**
   * GM force-decrypts an encrypted contact (bypasses ICE).
   * @static
   */
  static async _onForceDecrypt(event, target) {
    event.stopPropagation();

    if (!game.user.isGM) return;

    const contactId = target.closest('[data-contact-id]')?.dataset.contactId
      || target.dataset.contactId;
    if (!contactId) return;

    const breachService = this.contactBreachService;
    if (!breachService) {
      ui.notifications.error('Breach service not available.');
      return;
    }

    const result = await breachService.forceDecrypt(this.actorId, contactId);
    if (result.success) {
      // Find overlay for animation
      const cardEl = this.element?.querySelector(`[data-contact-id="${contactId}"]`);
      const overlayEl = cardEl?.querySelector('.ncm-encrypted-overlay')
        || cardEl?.querySelector('.ncm-list-item__ice-overlay');
      const isListView = overlayEl?.classList.contains('ncm-list-item__ice-overlay');

      if (overlayEl) {
        if (isListView) {
          this._playListUnscrambleAnimation(overlayEl, cardEl, () => { this.render(); });
        } else {
          this._playUnscrambleAnimation(overlayEl, cardEl, () => { this.render(); });
        }
      } else {
        this.render();
      }
    } else {
      ui.notifications.error(`Force decrypt failed: ${result.error}`);
    }
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
  //  Animation Helpers
  // ═══════════════════════════════════════════════════════════

  /**
   * Play the unscramble/glitch-dissolve animation on the encrypted overlay.
   * Overlay glitch-scrambles away, card does a resolve animation.
   *
   * @param {HTMLElement} overlayEl — The .ncm-encrypted-overlay element
   * @param {HTMLElement} cardEl    — The parent card element
   * @param {Function}    onComplete — Called when animation finishes
   */
  _playUnscrambleAnimation(overlayEl, cardEl, onComplete) {
    if (!overlayEl) {
      onComplete?.();
      return;
    }

    // Inject ACCESS GRANTED text
    let grantedText = overlayEl.querySelector('.ncm-encrypted-overlay__granted-text');
    if (!grantedText) {
      grantedText = document.createElement('span');
      grantedText.className = 'ncm-encrypted-overlay__granted-text';
      grantedText.textContent = 'ACCESS GRANTED';
      overlayEl.appendChild(grantedText);
    }

    // Hide GM bypass button during animation
    const gmBypass = overlayEl.querySelector('.ncm-encrypted-overlay__gm-bypass');
    if (gmBypass) gmBypass.style.display = 'none';

    // Phase 1: Overlay shatter (900ms)
    overlayEl.classList.add('ncm-encrypted-overlay--unscramble');

    // Phase 2: Card resolve (starts at 700ms)
    if (cardEl) {
      setTimeout(() => {
        cardEl.classList.add('ncm-card--decrypted-resolve');
      }, 700);
    }

    // Phase 3: Cleanup + re-render (1300ms)
    setTimeout(() => {
      onComplete?.();
    }, 1300);
  }

  /**
   * Play the denied animation on the encrypted overlay.
   * Red flash + shake + ACCESS DENIED text.
   *
   * @param {HTMLElement} overlayEl — The .ncm-encrypted-overlay element
   */
  _playDeniedAnimation(overlayEl) {
    if (!overlayEl) return;

    // Inject ACCESS DENIED text if not present
    let deniedText = overlayEl.querySelector('.ncm-encrypted-overlay__denied-text');
    if (!deniedText) {
      deniedText = document.createElement('span');
      deniedText.className = 'ncm-encrypted-overlay__denied-text';
      deniedText.textContent = 'ACCESS DENIED';
      overlayEl.appendChild(deniedText);
    }

    // Add animation classes
    overlayEl.classList.add('ncm-encrypted-overlay--denied', 'ncm-encrypted-overlay--shake');

    // Clean up after animation
    setTimeout(() => {
      overlayEl.classList.remove('ncm-encrypted-overlay--denied', 'ncm-encrypted-overlay--shake');
      // Remove denied text after it fades
      setTimeout(() => {
        deniedText?.remove();
      }, 1200);
    }, 500);
  }

  /**
   * Play unscramble animation on list view ICE overlay.
   * Overlay shatters horizontally, row gets cyan flash.
   *
   * @param {HTMLElement} overlayEl — The .ncm-list-item__ice-overlay element
   * @param {HTMLElement} rowEl     — The parent .ncm-list-item element
   * @param {Function}    onComplete — Called when animation finishes
   */
  _playListUnscrambleAnimation(overlayEl, rowEl, onComplete) {
    if (!overlayEl) {
      onComplete?.();
      return;
    }

    // Inject ACCESS GRANTED text
    let grantedText = overlayEl.querySelector('.ncm-list-item__ice-granted-text');
    if (!grantedText) {
      grantedText = document.createElement('span');
      grantedText.className = 'ncm-list-item__ice-granted-text';
      grantedText.textContent = 'ACCESS GRANTED';
      overlayEl.appendChild(grantedText);
    }

    // Hide GM bypass during animation
    const gmBypass = overlayEl.querySelector('.ncm-list-item__ice-gm-bypass');
    if (gmBypass) gmBypass.style.display = 'none';

    // Phase 1: Overlay shatters (900ms)
    overlayEl.classList.add('ncm-list-item__ice-overlay--unscramble');

    // Phase 2: Row resolve flash (starts at 700ms)
    if (rowEl) {
      setTimeout(() => {
        rowEl.classList.add('ncm-list-item--decrypted-resolve');
      }, 700);
    }

    // Phase 3: Cleanup + re-render (1300ms)
    setTimeout(() => {
      onComplete?.();
    }, 1300);
  }

  /**
   * Play denied animation on list view ICE overlay.
   * Red flash + shake + ACCESS DENIED text.
   *
   * @param {HTMLElement} overlayEl — The .ncm-list-item__ice-overlay element
   */
  _playListDeniedAnimation(overlayEl) {
    if (!overlayEl) return;

    // Inject ACCESS DENIED text
    let deniedText = overlayEl.querySelector('.ncm-list-item__ice-denied-text');
    if (!deniedText) {
      deniedText = document.createElement('span');
      deniedText.className = 'ncm-list-item__ice-denied-text';
      deniedText.textContent = 'ACCESS DENIED';
      overlayEl.appendChild(deniedText);
    }

    // Add animation classes
    overlayEl.classList.add('ncm-list-item__ice-overlay--denied', 'ncm-list-item__ice-overlay--shake');

    // Clean up after animation
    setTimeout(() => {
      overlayEl.classList.remove('ncm-list-item__ice-overlay--denied', 'ncm-list-item__ice-overlay--shake');
      setTimeout(() => {
        deniedText?.remove();
      }, 1200);
    }, 500);
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
