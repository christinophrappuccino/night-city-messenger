/**
 * Contact Manager Application — v5.1 Split View Rewrite
 * @file scripts/ui/ContactManager/ContactManagerApp.js
 * @module cyberpunkred-messenger
 * @description Player contact directory with split-view layout:
 *   Left: quick-dial favorites, sort/group bar, collapsible grouped list
 *   Right: detail panel with profile, info cards, last interaction, relationship, notes
 *   Preserves grid view as alternate mode. Full keyboard shortcuts.
 *
 *   v5.1 additions over Sprint 3:
 *     - Split view (list mode)
 *     - Collapsible group headers (by role/org/location)
 *     - Quick-dial favorites strip
 *     - Detail panel with info cards
 *     - Favorite toggle
 *     - Notes auto-save
 *     - Context-aware footer shortcuts
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
  viewMode = 'list';

  /** @type {string} Current search query */
  searchTerm = '';

  /** @type {string[]} Currently active tag filters */
  activeTagFilters = [];

  /** @type {string|null} Currently selected contact ID (split view) */
  selectedContactId = null;

  /** @type {boolean} Whether user is adding a new contact */
  isAdding = false;

  /** @type {string|null} Contact being edited */
  editingContactId = null;

  /** @type {Array} Cached contact data */
  _contacts = [];

  /** @type {string[]} All available tags */
  _allTags = [];

  // ── v5.1 Split View State ──

  /** @type {string} Group-by mode: 'none' | 'role' | 'organization' | 'location' */
  _groupBy = 'none';

  /** @type {string} Sort mode: 'name' | 'recent' | 'trust' */
  _sortBy = 'name';

  /** @type {Set<string>} Collapsed group keys */
  _collapsedGroups = new Set();

  /** @type {number} List scroll position preservation */
  _listScrollTop = 0;

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
      width: 960,
      height: 680,
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

      // ─── GM Verify Contact ───
      gmVerifyContact:   ContactManagerApp._onGMVerifyContact,
      gmUnverifyContact: ContactManagerApp._onGMUnverifyContact,

      // ─── Contact actions ───
      sendMessage:    ContactManagerApp._onSendMessage,
      shareContact:   ContactManagerApp._onShareContact,
      uploadPortrait: ContactManagerApp._onUploadPortrait,
      removePortrait: ContactManagerApp._onRemovePortrait,
      setTrustLevel:  ContactManagerApp._onSetTrustLevel,
      burnContact:    ContactManagerApp._onBurnContact,
      restoreContact: ContactManagerApp._onRestoreContact,
      breachContact:  ContactManagerApp._onBreachContact,
      forceDecrypt:   ContactManagerApp._onForceDecrypt,

      // ─── v5.1 Split View actions ───
      toggleGroup:    ContactManagerApp._onToggleGroup,
      collapseAll:    ContactManagerApp._onCollapseAll,
      expandAll:      ContactManagerApp._onExpandAll,
      toggleFavorite: ContactManagerApp._onToggleFavorite,

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

    // ── Verification stamping ──
    const requireVerification = game.settings.get(MODULE_ID, 'requireContactVerification') ?? true;
    for (const contact of this._contacts) {
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
        contact._canMessage = !requireVerification;
      }
    }

    // ── Owner info ──
    const actor = this.actorId ? game.actors.get(this.actorId) : null;
    const ownerName = actor?.name || 'Unknown';
    const ownerEmail = actor ? this.contactRepo?.getActorEmail(this.actorId) || '' : '';
    const ownerAvatarColor = getAvatarColor(ownerName);
    const ownerInitials = getInitials(ownerName);
    const ownerPortrait = actor?.img && actor.img !== 'icons/svg/mystery-man.svg' ? actor.img : '';

    // ── Current network ──
    const currentNetwork = this.networkService?.currentNetwork?.name || 'CITINET';

    // ── Filter contacts ──
    let filtered = [...this._contacts];
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
    if (this.activeTagFilters.length > 0) {
      filtered = filtered.filter(c =>
        this.activeTagFilters.some(tag => c.tags?.includes(tag))
      );
    }

    // ── Enrich for display ──
    const enriched = filtered.map(c =>
      enrichContactForDisplay(c, {
        selectedId: this.selectedContactId,
        currentNetwork,
      })
    );

    // ── Sort ──
    this._sortContacts(enriched);

    // ── Stats (from ALL contacts, not filtered) ──
    const allEnriched = this._contacts.map(c =>
      enrichContactForDisplay(c, { currentNetwork })
    );
    const onlineCount = allEnriched.filter(c =>
      ['active', 'online'].includes(c.status)
    ).length;
    const favoriteCount = this._contacts.filter(c => c.favorite).length;

    // ── Build groups (for list/split view) ──
    const { groups, hasGroups } = this._buildGroups(enriched);

    // ── Quick-dial favorites (max 8) ──
    const quickDialContacts = allEnriched
      .filter(c => c.isFavorite && !c.isBurned && !c.isEncrypted)
      .slice(0, 8);

    // ── Selected contact detail ──
    let selectedContact = null;
    let lastInteraction = null;
    let hasRelationship = false;
    let selectedRelationship = null;
    let selectedRelationshipNote = null;

    if (this.selectedContactId) {
      selectedContact = enriched.find(c => c.id === this.selectedContactId)
        || allEnriched.find(c => c.id === this.selectedContactId);

      if (selectedContact) {
        // Last interaction placeholder — TODO: MessageRepository.getLastMessageWith()
        // For now, leave null (card simply won't render)

        // Relationship data (only if GM has revealed via revealTrust)
        if (selectedContact.relationship) {
          hasRelationship = true;
          selectedRelationship = selectedContact.relationship;
          selectedRelationshipNote = selectedContact.relationshipNote || '';
        } else if (selectedContact.trust > 0 && selectedContact.revealTrust) {
          hasRelationship = true;
        }
      }
    }

    // ── Tag pills ──
    const tagPills = this._allTags.map(tag => ({
      name: tag,
      active: this.activeTagFilters.includes(tag),
    }));

    // ── Editing contact ──
    let editingContact = null;
    if (this.editingContactId) {
      const raw = this._contacts.find(c => c.id === this.editingContactId);
      if (raw) editingContact = enrichContactForDisplay(raw, { isGM: game.user.isGM });
    }

    // ── Verification counts ──
    const verifiedCount = this._contacts.filter(c => c.verified || c.verifiedOverride).length;
    const unverifiedCount = this._contacts.filter(c => !c.verified && !c.verifiedOverride && !c.burned).length;

    return {
      // Owner
      ownerName, ownerEmail, ownerAvatarColor, ownerInitials,
      ownerPortrait, hasOwnerPortrait: !!ownerPortrait,

      // Counts
      contactCount: this._contacts.length,
      filteredCount: enriched.length,
      onlineCount, favoriteCount,

      // View state
      viewMode: this.viewMode,
      isGridView: this.viewMode === 'grid',
      searchTerm: this.searchTerm,
      hasSearch: !!this.searchTerm || this.activeTagFilters.length > 0,
      hasActiveTagFilter: this.activeTagFilters.length > 0,

      // v5.1 split view
      groupBy: this._groupBy,
      sortBy: this._sortBy,
      groups, hasGroups,
      quickDialContacts,

      // Selected contact detail
      selectedContact, lastInteraction,
      hasRelationship, selectedRelationship, selectedRelationshipNote,

      // Contacts (for grid view)
      contacts: enriched,
      isEmpty: enriched.length === 0,

      // Edit form
      editingContact,
      isAdding: this.isAdding,
      editingContactId: this.editingContactId,

      // Tags
      allTags: tagPills,

      // Network
      currentNetwork,

      // Verification
      gmInspectMode: this.gmInspectMode,
      inspectedActorName: this.gmInspectMode ? game.actors.get(this.actorId)?.name || 'Unknown' : null,
      verifiedCount, unverifiedCount, requireVerification,

      isGM: game.user.isGM,
      MODULE_ID,
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  Grouping + Sorting
  // ═══════════════════════════════════════════════════════════

  /**
   * Build groups from enriched contacts based on _groupBy mode.
   * Always adds special Burned and ICE Protected groups at bottom.
   * @param {Array} contacts — enriched contacts
   * @returns {{ groups: Array, hasGroups: boolean }}
   */
  _buildGroups(contacts) {
    if (this._groupBy === 'none') {
      // Flat list with special groups at bottom
      const normal = contacts.filter(c => !c.isBurned && !c.isEncrypted);
      const burned = contacts.filter(c => c.isBurned);
      const encrypted = contacts.filter(c => c.isEncrypted && !c.isBurned);

      const groups = [];
      if (normal.length) {
        groups.push({
          key: '_all', name: 'All Contacts', icon: 'fas fa-address-book',
          contacts: normal, isCollapsed: false,
        });
      }
      if (burned.length) {
        groups.push({
          key: '_burned', name: 'Burned', icon: 'fas fa-fire',
          contacts: burned, isCollapsed: this._collapsedGroups.has('_burned'),
          isBurnedGroup: true,
        });
      }
      if (encrypted.length) {
        groups.push({
          key: '_encrypted', name: 'ICE Protected', icon: 'fas fa-lock',
          contacts: encrypted, isCollapsed: this._collapsedGroups.has('_encrypted'),
          isEncryptedGroup: true,
        });
      }

      return { groups, hasGroups: burned.length > 0 || encrypted.length > 0 };
    }

    // ── Grouped mode ──
    const roleIcons = {
      fixer: 'fas fa-crosshairs', solo: 'fas fa-gun', netrunner: 'fas fa-terminal',
      tech: 'fas fa-wrench', medtech: 'fas fa-kit-medical', media: 'fas fa-camera',
      exec: 'fas fa-briefcase', lawman: 'fas fa-gavel', nomad: 'fas fa-truck-monster',
      rockerboy: 'fas fa-guitar',
    };

    const field = this._groupBy; // 'role' | 'organization' | 'location'
    const groupMap = new Map();

    for (const contact of contacts) {
      if (contact.isBurned || contact.isEncrypted) continue;
      const key = (contact[field] || '').trim().toLowerCase() || '_ungrouped';
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          key,
          name: contact[field]?.trim() || 'Ungrouped',
          icon: field === 'role' ? (roleIcons[key] || 'fas fa-user') :
                field === 'organization' ? 'fas fa-building' :
                field === 'location' ? 'fas fa-location-dot' : 'fas fa-folder',
          contacts: [],
          isCollapsed: this._collapsedGroups.has(key),
        });
      }
      groupMap.get(key).contacts.push(contact);
    }

    // Sort groups alphabetically, ungrouped last
    const groups = [...groupMap.values()].sort((a, b) => {
      if (a.key === '_ungrouped') return 1;
      if (b.key === '_ungrouped') return -1;
      return a.name.localeCompare(b.name);
    });

    // Add special groups at bottom
    const burned = contacts.filter(c => c.isBurned);
    const encrypted = contacts.filter(c => c.isEncrypted && !c.isBurned);

    if (burned.length) {
      groups.push({
        key: '_burned', name: 'Burned', icon: 'fas fa-fire',
        contacts: burned, isCollapsed: this._collapsedGroups.has('_burned'),
        isBurnedGroup: true,
      });
    }
    if (encrypted.length) {
      groups.push({
        key: '_encrypted', name: 'ICE Protected', icon: 'fas fa-lock',
        contacts: encrypted, isCollapsed: this._collapsedGroups.has('_encrypted'),
        isEncryptedGroup: true,
      });
    }

    return { groups, hasGroups: true };
  }

  /**
   * Sort contacts in place.
   */
  _sortContacts(contacts) {
    contacts.sort((a, b) => {
      // Burned always at bottom
      if (a.isBurned !== b.isBurned) return a.isBurned ? 1 : -1;
      // Encrypted at bottom (above burned)
      if (a.isEncrypted !== b.isEncrypted) return a.isEncrypted ? 1 : -1;

      switch (this._sortBy) {
        case 'trust':
          return (b.trust || 0) - (a.trust || 0) || a.name.localeCompare(b.name);
        case 'recent':
          // TODO: Use last message timestamp when available
          return a.name.localeCompare(b.name);
        case 'name':
        default:
          return a.name.localeCompare(b.name);
      }
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  Post-Render — DOM Setup
  // ═══════════════════════════════════════════════════════════

  _onRender(context, options) {
    super._onRender(context, options);
    this._setupSearchInput();
    this._setupKeyboardShortcuts();
    this._setupEmailVerification();
    this._setupSelectListeners();
    this._setupNotesAutoSave();
    this._restoreListScroll();

    if (game.user.isGM) {
      this._setupTrustHoverPreview(this.element);
    }
  }

  /**
   * Wire up manual change listeners for <select> elements.
   * Foundry's data-action on <select> fires on click, not change.
   */
  _setupSelectListeners() {
    const groupSelect = this.element?.querySelector('.ncm-group-select');
    if (groupSelect) {
      groupSelect.addEventListener('change', (e) => {
        this._groupBy = e.target.value;
        this.render();
      });
    }
    const sortSelect = this.element?.querySelector('.ncm-sort-select');
    if (sortSelect) {
      sortSelect.addEventListener('change', (e) => {
        this._sortBy = e.target.value;
        this.render();
      });
    }
  }

  /**
   * Auto-save notes textarea with debounce.
   */
  _setupNotesAutoSave() {
    const textarea = this.element?.querySelector('.ncm-notes-textarea');
    if (!textarea) return;

    const contactId = textarea.dataset.contactId;
    if (!contactId) return;

    if (!this._boundNotesHandler) {
      this._boundNotesHandler = this._debounce(async (e) => {
        const id = e.target.dataset.contactId;
        if (!id) return;
        await this.contactRepo?.updateContact(this.actorId, id, { notes: e.target.value });
      }, 800);
    }

    textarea.removeEventListener('input', this._boundNotesHandler);
    textarea.addEventListener('input', this._boundNotesHandler);
  }

  /**
   * Restore scroll position after re-render.
   * Attach passive scroll listener to track position.
   */
  _restoreListScroll() {
    const scrollEl = this.element?.querySelector('.ncm-list-scroll');
    if (!scrollEl) return;

    // Restore
    if (this._listScrollTop > 0) {
      scrollEl.scrollTop = this._listScrollTop;
    }

    // Track
    scrollEl.addEventListener('scroll', () => {
      this._listScrollTop = scrollEl.scrollTop;
    }, { passive: true });
  }

  /**
   * Set up hover preview on interactive trust segments.
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

    const handler = this._boundSearchHandler || (this._boundSearchHandler = this._debounce((e) => {
      this.searchTerm = e.target.value;
      this.render();
    }, 200));

    input.removeEventListener('input', handler);
    input.addEventListener('input', handler);
  }

  /**
   * Wire up keyboard shortcuts.
   */
  _setupKeyboardShortcuts() {
    const el = this.element;
    if (!el) return;

    if (this._boundKeyHandler) {
      el.removeEventListener('keydown', this._boundKeyHandler);
    }

    this._boundKeyHandler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      switch (e.key) {
        case '/':
          e.preventDefault();
          this.element?.querySelector('.ncm-contact-search')?.focus();
          break;
        case 'n': case 'N':
          e.preventDefault();
          this.isAdding = true;
          this.render();
          break;
        case 'g': case 'G':
          e.preventDefault();
          this._cycleGroupBy();
          break;
        case 'f': case 'F':
          if (this.selectedContactId) {
            e.preventDefault();
            this._toggleFavoriteSelected();
          }
          break;
        case 'm': case 'M':
          if (this.selectedContactId) {
            e.preventDefault();
            this._sendMessageToSelected();
          }
          break;
        case 'e': case 'E':
          if (this.selectedContactId) {
            e.preventDefault();
            this.editingContactId = this.selectedContactId;
            this.isAdding = false;
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
    };

    el.addEventListener('keydown', this._boundKeyHandler);
  }

  /**
   * Live email verification on the contact form.
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

  // ═══════════════════════════════════════════════════════════
  //  Event Subscriptions
  // ═══════════════════════════════════════════════════════════

  _setupEventSubscriptions() {
    this.subscribe(EVENTS.CONTACT_UPDATED, () => this._debouncedRender());
    this.subscribe(EVENTS.CONTACT_BURNED, () => this.render());
    this.subscribe(EVENTS.CONTACT_SHARED, () => this.render());
    this.subscribe(EVENTS.CONTACT_TRUST_CHANGED, () => this.render());
    this.subscribe(EVENTS.CONTACT_TAGS_UPDATED, () => this.render());
    this.subscribe(EVENTS.CONTACT_DECRYPTED, () => this.render());
    this.subscribe(EVENTS.CONTACT_BREACH_FAILED, () => {});
    this.subscribe(EVENTS.CONTACT_BLACK_ICE, () => {});
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

  static _onSetViewMode(event, target) {
    const mode = target.dataset.mode;
    if (mode && (mode === 'grid' || mode === 'list')) {
      this.viewMode = mode;
      this.render();
    }
  }

  static _onSelectContact(event, target) {
    const contactId = target.closest('[data-contact-id]')?.dataset.contactId;
    if (!contactId) return;
    this.selectedContactId = this.selectedContactId === contactId ? null : contactId;
    this.render();
  }

  // ═══════════════════════════════════════════════════════════
  //  Action Handlers — v5.1 Split View
  // ═══════════════════════════════════════════════════════════

  static _onToggleGroup(event, target) {
    const groupKey = target.closest('[data-group]')?.dataset.group;
    if (!groupKey) return;
    if (this._collapsedGroups.has(groupKey)) {
      this._collapsedGroups.delete(groupKey);
    } else {
      this._collapsedGroups.add(groupKey);
    }
    this.render();
  }

  static _onCollapseAll() {
    // Collect all current group keys and collapse them
    this._collapsedGroups = new Set(['_all', '_burned', '_encrypted']);
    // Also add dynamic group keys
    for (const c of this._contacts) {
      const key = (c[this._groupBy] || '').trim().toLowerCase() || '_ungrouped';
      this._collapsedGroups.add(key);
    }
    this.render();
  }

  static _onExpandAll() {
    this._collapsedGroups.clear();
    this.render();
  }

  static async _onToggleFavorite(event, target) {
    event.stopPropagation();
    const contactId = target.closest('[data-contact-id]')?.dataset.contactId;
    if (!contactId) return;

    const contact = this._contacts.find(c => c.id === contactId);
    if (!contact) return;

    const result = await this.contactRepo?.updateContact(this.actorId, contactId, {
      favorite: !contact.favorite,
    });
    if (result?.success) {
      this.render();
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Action Handlers — Tag Filters
  // ═══════════════════════════════════════════════════════════

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

  static _onRemoveTagFilter(event, target) {
    event.stopPropagation();
    const tag = target.closest('[data-tag]')?.dataset.tag;
    if (!tag) return;
    this.activeTagFilters = this.activeTagFilters.filter(t => t !== tag);
    this.render();
  }

  static _onClearTagFilter(event, target) {
    this.activeTagFilters = [];
    this.render();
  }

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

  static _onAddContact(event, target) {
    this.isAdding = true;
    this.editingContactId = null;
    this.render();
  }

  static _onEditContact(event, target) {
    event.stopPropagation();
    const contactId = target.closest('[data-contact-id]')?.dataset.contactId;
    if (!contactId) return;
    this.editingContactId = contactId;
    this.isAdding = false;
    this.render();
  }

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

  static _onCancelEdit(event, target) {
    this.isAdding = false;
    this.editingContactId = null;
    this.render();
  }

  static _onOpenGMContacts(event, target) {
    if (!game.user.isGM) return;
    if (game.nightcity?.gmContactManager) {
      game.nightcity.gmContactManager.render(true);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Action Handlers — GM Verify
  // ═══════════════════════════════════════════════════════════

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
  //  Action Handlers — Contact Actions
  // ═══════════════════════════════════════════════════════════

  static _onSendMessage(event, target) {
    event.stopPropagation();
    const contactId = target.closest('[data-contact-id]')?.dataset.contactId;
    if (!contactId) return;

    const contact = this._contacts.find(c => c.id === contactId);
    if (!contact?.email) {
      ui.notifications.warn('Contact has no email address.');
      return;
    }
    if (game.nightcity?.composeMessage) {
      game.nightcity.composeMessage({
        fromActorId: this.actorId,
        toActorId: contact.actorId || null,
      });
    }
  }

  static async _onShareContact(event, target) {
    event.stopPropagation();
    const contactId = target.closest('[data-contact-id]')?.dataset.contactId;
    if (!contactId) return;

    const contact = this._contacts.find(c => c.id === contactId);
    if (!contact) return;

    const { ContactShareDialog } = await import('./ContactShareDialog.js');
    new ContactShareDialog({ senderActorId: this.actorId, contact }).render(true);
  }

  static async _onUploadPortrait(event, target) {
    event.stopPropagation();
    const contactId = target.closest('[data-contact-id]')?.dataset.contactId;
    if (!contactId) return;

    const portraitService = this.portraitService;
    if (!portraitService?.canUploadPortrait(this.actorId)) {
      ui.notifications.warn('You do not have permission to modify this contact.');
      return;
    }

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
      result = await portraitService.uploadViaFilePicker(this.actorId, contactId, { useBase64: false });
    } else {
      result = await portraitService.uploadViaFileInput(this.actorId, contactId);
    }

    if (result.success) {
      ui.notifications.info('Portrait updated.');
      this.render();
    } else if (result.error && result.error !== 'No file selected' && result.error !== 'Upload cancelled') {
      ui.notifications.error(`Portrait upload failed: ${result.error}`);
    }
  }

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

  static async _onBreachContact(event, target) {
    event.stopPropagation();
    const contactId = target.closest('[data-contact-id]')?.dataset.contactId;
    if (!contactId) return;

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

    const overlayEl = target.closest('.ncm-ice') || target.closest('.ncm-encrypted-overlay') || target;
    overlayEl.classList?.add('ncm-encrypted-overlay--breaching');

    const result = await breachService.attemptBreach(this.actorId, contactId, actor, { luckSpend: 0 });

    overlayEl.classList?.remove('ncm-encrypted-overlay--breaching');

    if (result.success) {
      this.render();
    } else if (result.error) {
      ui.notifications.error(result.error);
    }
  }

  static async _onSetTrustLevel(event, target) {
    event.stopPropagation();
    if (!game.user.isGM) {
      ui.notifications.warn('Only the GM can modify trust levels.');
      return;
    }

    const contactId = target.closest('[data-contact-id]')?.dataset.contactId || target.dataset.contactId;
    const trustValue = parseInt(target.dataset.trustValue, 10);
    if (!contactId || isNaN(trustValue)) return;

    const contactRepo = this.contactRepo;
    if (!contactRepo) return;

    const contacts = await contactRepo.getContacts(this.actorId);
    const contact = contacts.find(c => c.id === contactId);
    if (!contact) return;

    const result = await contactRepo.setTrust(this.actorId, contactId, trustValue);
    if (!result.success) {
      ui.notifications.error(`Failed to update trust: ${result.error}`);
      return;
    }

    const labels = { 0: 'UNKNOWN', 1: 'LOW', 2: 'LOW', 3: 'MEDIUM', 4: 'HIGH', 5: 'HIGH' };
    game.nightcity?.notificationService?.showToast(
      'Trust Updated', `${contact.name} → ${labels[trustValue] || 'UNKNOWN'}`,
      trustValue >= 4 ? 'success' : trustValue >= 3 ? 'warning' : trustValue >= 1 ? 'error' : 'info',
      3000
    );

    game.nightcity?.eventBus?.emit(EVENTS.CONTACT_TRUST_CHANGED, {
      actorId: this.actorId, contactId, contactName: contact.name, trust: trustValue,
    });
    game.nightcity?.soundService?.play('notification');
    this.render();
  }

  static async _onBurnContact(event, target) {
    event.stopPropagation();
    if (!game.user.isGM) return;

    const contactId = target.closest('[data-contact-id]')?.dataset.contactId || target.dataset.contactId;
    if (!contactId) return;

    const contactRepo = this.contactRepo;
    if (!contactRepo) return;

    const contacts = await contactRepo.getContacts(this.actorId);
    const contact = contacts.find(c => c.id === contactId);
    if (!contact || contact.burned) return;

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

    const burnResult = await contactRepo.setBurned(this.actorId, contactId, true);
    if (!burnResult.success) {
      ui.notifications.error(`Failed to burn contact: ${burnResult.error}`);
      return;
    }
    if (contact.trust > 1) {
      await contactRepo.setTrust(this.actorId, contactId, 1);
    }

    game.nightcity?.soundService?.play('hack-fail');
    game.nightcity?.notificationService?.showContactBurned({
      contactName: contact.name, actorId: this.actorId, contactId,
    });
    game.nightcity?.eventBus?.emit(EVENTS.CONTACT_BURNED, {
      actorId: this.actorId, contactId, contactName: contact.name, burned: true,
    });
    this.render();
  }

  static async _onRestoreContact(event, target) {
    event.stopPropagation();
    if (!game.user.isGM) return;

    const contactId = target.closest('[data-contact-id]')?.dataset.contactId || target.dataset.contactId;
    if (!contactId) return;

    const contactRepo = this.contactRepo;
    if (!contactRepo) return;

    const contacts = await contactRepo.getContacts(this.actorId);
    const contact = contacts.find(c => c.id === contactId);
    if (!contact?.burned) return;

    const result = await contactRepo.setBurned(this.actorId, contactId, false);
    if (!result.success) {
      ui.notifications.error(`Failed to restore contact: ${result.error}`);
      return;
    }

    game.nightcity?.notificationService?.showToast(
      'Contact Restored', `${contact.name} — identity restored. Trust level unchanged.`, 'info', 4000
    );
    game.nightcity?.soundService?.play('notification');
    game.nightcity?.eventBus?.emit(EVENTS.CONTACT_BURNED, {
      actorId: this.actorId, contactId, contactName: contact.name, burned: false,
    });
    this.render();
  }

  static async _onForceDecrypt(event, target) {
    event.stopPropagation();
    if (!game.user.isGM) return;

    const contactId = target.closest('[data-contact-id]')?.dataset.contactId || target.dataset.contactId;
    if (!contactId) return;

    const breachService = this.contactBreachService;
    if (!breachService) {
      ui.notifications.error('Breach service not available.');
      return;
    }

    const result = await breachService.forceDecrypt(this.actorId, contactId);
    if (result.success) {
      this.render();
    } else {
      ui.notifications.error(`Force decrypt failed: ${result.error}`);
    }
  }

  static _onOpenSettings(event, target) {
    if (game.nightcity?.openThemeCustomizer) {
      game.nightcity.openThemeCustomizer();
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Navigation Helpers
  // ═══════════════════════════════════════════════════════════

  /**
   * Navigate the list up/down by delta.
   */
  _navigateList(delta) {
    const items = this.element?.querySelectorAll('.ncm-list-item');
    if (!items?.length) return;

    const ids = [...items].map(el => el.dataset.contactId);
    const currentIdx = ids.indexOf(this.selectedContactId);
    let newIdx = currentIdx + delta;
    if (newIdx < 0) newIdx = ids.length - 1;
    if (newIdx >= ids.length) newIdx = 0;

    this.selectedContactId = ids[newIdx];
    this.render();
  }

  /**
   * Cycle through groupBy options.
   */
  _cycleGroupBy() {
    const modes = ['none', 'role', 'organization', 'location'];
    const idx = modes.indexOf(this._groupBy);
    this._groupBy = modes[(idx + 1) % modes.length];
    this.render();
  }

  /**
   * Toggle favorite on the currently selected contact.
   */
  async _toggleFavoriteSelected() {
    if (!this.selectedContactId) return;
    const contact = this._contacts.find(c => c.id === this.selectedContactId);
    if (!contact) return;
    await this.contactRepo?.updateContact(this.actorId, this.selectedContactId, {
      favorite: !contact.favorite,
    });
    this.render();
  }

  /**
   * Send message to the currently selected contact.
   */
  _sendMessageToSelected() {
    if (!this.selectedContactId) return;
    const contact = this._contacts.find(c => c.id === this.selectedContactId);
    if (!contact?.email) return;
    if (game.nightcity?.composeMessage) {
      game.nightcity.composeMessage({
        fromActorId: this.actorId,
        toActorId: contact.actorId || null,
      });
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Utilities
  // ═══════════════════════════════════════════════════════════

  /**
   * Simple debounce utility.
   */
  _debounce(fn, delay) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }
}
