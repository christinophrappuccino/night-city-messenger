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
      breachContact:  ContactManagerApp._onBreachContact,
      forceDecrypt:   ContactManagerApp._onForceDecrypt,

      // ─── v5.1 Split View actions ───
      toggleGroup:    ContactManagerApp._onToggleGroup,
      collapseAll:    ContactManagerApp._onCollapseAll,
      expandAll:      ContactManagerApp._onExpandAll,
      toggleFavorite: ContactManagerApp._onToggleFavorite,

      // ─── Form helpers ───
      browsePortrait:     ContactManagerApp._onBrowsePortrait,
      createFolderInline: ContactManagerApp._onCreateFolderInline,
      selectIceMode:      ContactManagerApp._onSelectIceMode,
      selectIceActor:     ContactManagerApp._onSelectIceActor,
      browseIcePortrait:  ContactManagerApp._onBrowseIcePortrait,

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
      if (contact.verifiedOverride) {
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
      .filter(c => c.isFavorite && !c.isEncrypted)
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
    const unverifiedCount = this._contacts.filter(c => !c.verified && !c.verifiedOverride).length;

    // ── Existing folders (for datalist in form) ──
    const masterSvc = game.nightcity?.masterContactService;
    const existingFolders = masterSvc
      ? [...new Set(masterSvc.getAll().map(c => c.folder).filter(Boolean))].sort()
      : [];

    // ── Available actors (for linked actor select in GM form) ──
    const availableActors = game.user.isGM
      ? game.actors.contents.map(a => ({
          id: a.id, name: a.name,
          hasPlayerOwner: a.hasPlayerOwner,
        }))
      : [];

    // ── Custom roles from GM settings ──
    const customRoles = masterSvc?.getCustomRoles?.() || [];

    // ── Black ICE actors (for ICE source picker) ──
    const editContact = editingContact || (this.isAdding ? null : null);
    const iceConfig = editContact || {};
    const iceSource = iceConfig.iceSource || 'default';

    const blackIceActors = game.user.isGM
      ? (game.actors?.filter(a =>
          a.type === 'blackIce' || a.type === 'black-ice' ||
          a.getFlag?.(MODULE_ID, 'isBlackICE') ||
          a.name?.toLowerCase().includes('black ice')
        ) ?? []).map(a => ({
          id: a.id, name: a.name, img: a.img,
          atk: a.system?.stats?.atk ?? 0,
          damage: a.system?.stats?.atk ? `ATK ${a.system.stats.atk}` : (a.system?.damage || ''),
          selected: iceConfig.iceActorId === a.id,
        }))
      : [];

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

      // Folders + Actors + Roles (for form)
      existingFolders,
      availableActors,
      customRoles,
      blackIceActors,

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
   * Always adds special ICE Protected group at bottom.
   * @param {Array} contacts — enriched contacts
   * @returns {{ groups: Array, hasGroups: boolean }}
   */
  _buildGroups(contacts) {
    if (this._groupBy === 'none') {
      // Flat list with ICE group at bottom
      const normal = contacts.filter(c => !c.isEncrypted);
      const encrypted = contacts.filter(c => c.isEncrypted);

      const groups = [];
      if (normal.length) {
        groups.push({
          key: '_all', name: 'All Contacts', icon: 'fas fa-address-book',
          contacts: normal, isCollapsed: false,
        });
      }
      if (encrypted.length) {
        groups.push({
          key: '_encrypted', name: 'ICE Protected', icon: 'fas fa-lock',
          contacts: encrypted, isCollapsed: this._collapsedGroups.has('_encrypted'),
          isEncryptedGroup: true,
        });
      }

      return { groups, hasGroups: encrypted.length > 0 };
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
      if (contact.isEncrypted) continue;
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

    // Add special ICE group at bottom
    const encrypted = contacts.filter(c => c.isEncrypted);

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
      // Encrypted at bottom
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
    this._setupICEToggle();
    this._setupRoleSelect();
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
   * Wire up ICE toggle conditionals on the form.
   * Shows/hides the ICE details row when encryption dropdown changes.
   * Shows/hides BLACK ICE damage input when BLACK ICE dropdown changes.
   */
  _setupICEToggle() {
    // Show/hide ICE details when encryption toggled
    const iceSelect = this.element?.querySelector('.ncm-ice-toggle-select');
    const iceRow = this.element?.querySelector('.ncm-form-row--ice-details');
    if (iceSelect && iceRow) {
      iceSelect.addEventListener('change', (e) => {
        iceRow.style.display = e.target.value === 'true' ? '' : 'none';
      });
    }

    // Show/hide BLACK ICE source panel when BLACK ICE toggled
    const blackIceSelect = this.element?.querySelector('.ncm-blackice-toggle-select');
    const iceSourceBlock = this.element?.querySelector('.ncm-form-ice-source');
    if (blackIceSelect && iceSourceBlock) {
      blackIceSelect.addEventListener('change', (e) => {
        iceSourceBlock.style.display = e.target.value === 'true' ? '' : 'none';
      });
    }
  }

  /**
   * Wire up the "Manage Roles…" option in the role select dropdown.
   * When selected, opens the RoleManagerDialog and resets the select.
   */
  _setupRoleSelect() {
    if (!game.user.isGM) return;
    const select = this.element?.querySelector('.ncm-form-select--role');
    if (!select) return;

    select.addEventListener('change', async (e) => {
      if (e.target.value !== '__manage_roles__') return;

      // Reset to current role
      const currentRole = this.editingContactId
        ? (this._contacts.find(c => c.id === this.editingContactId)?.role || 'npc')
        : 'npc';
      e.target.value = currentRole;

      // Dynamic import to keep bundle light
      const { RoleManagerDialog } = await import('../GMContactManager/RoleManagerDialog.js');
      const masterSvc = game.nightcity?.masterContactService;
      if (masterSvc) {
        const dialog = new RoleManagerDialog(masterSvc);
        dialog.open();
      }
    });
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
    this._collapsedGroups = new Set(['_all', '_encrypted']);
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
      location: formData.get('location')?.trim(),
      alias: formData.get('alias')?.trim(),
      role: formData.get('role')?.trim()?.toLowerCase(),
      portrait: formData.get('portrait')?.trim() || '',
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

      // Folder (GM only)
      const folder = formData.get('folder')?.trim();
      if (folder !== undefined) data.folder = folder || '';

      // Linked actor (GM only)
      const actorId = formData.get('actorId');
      if (actorId !== null) data.actorId = actorId || null;

      // ICE fields (GM only) — selects return "true"/"false" strings
      const encryptedVal = formData.get('encrypted');
      if (encryptedVal !== null) {
        data.encrypted = encryptedVal === 'true';
      }
      const encryptionDV = formData.get('encryptionDV');
      if (encryptionDV !== null) {
        data.encryptionDV = parseInt(encryptionDV, 10) || 15;
      }
      const encryptionSkill = formData.get('encryptionSkill');
      if (encryptionSkill) {
        data.encryptionSkill = encryptionSkill.trim();
      }
      const maxBreachAttempts = formData.get('maxBreachAttempts');
      if (maxBreachAttempts !== null) {
        data.maxBreachAttempts = parseInt(maxBreachAttempts, 10) || 3;
      }
      const blackIceVal = formData.get('blackIce');
      if (blackIceVal !== null) {
        data.blackIce = blackIceVal === 'true';
      }

      // ICE source fields (Default / Custom / Actor)
      if (data.blackIce) {
        const iceSource = formData.get('iceSource') || 'default';
        data.iceSource = iceSource;

        if (iceSource === 'custom') {
          data.iceCustomName = formData.get('iceCustomName')?.trim() || '';
          data.iceCustomPortrait = formData.get('iceCustomPortrait')?.trim() || '';
          data.blackIceDamage = formData.get('iceCustomDamage')?.trim() || '3d6';
        } else if (iceSource === 'actor') {
          data.iceActorId = formData.get('iceActorId') || '';
          // Damage derived from actor at runtime, store actor ref
          data.blackIceDamage = formData.get('blackIceDamage')?.trim() || '3d6';
        } else {
          // Default mode
          const blackIceDamage = formData.get('blackIceDamage');
          if (blackIceDamage) {
            data.blackIceDamage = blackIceDamage.trim();
          }
        }
      } else {
        const blackIceDamage = formData.get('blackIceDamage');
        if (blackIceDamage) {
          data.blackIceDamage = blackIceDamage.trim();
        }
      }
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
    game.nightcity?.openGMContacts?.();
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

    // Direct FilePicker — same as everywhere else in NCM
    const result = await portraitService.uploadViaFilePicker(
      this.actorId, contactId, { useBase64: false }
    );

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
    const skillService = game.nightcity?.skillService;
    if (!breachService || !skillService) {
      ui.notifications.error('Breach service not available.');
      return;
    }

    // Get the contact data (re-fetch from repo for fresh attempt count)
    await this._loadContacts();
    const contact = this._contacts.find(c => c.id === contactId);
    if (!contact || !contact.encrypted) return;

    // ── Lockout check ──
    if (contact.breachLockoutUntil && Date.now() < contact.breachLockoutUntil) {
      const remaining = Math.ceil((contact.breachLockoutUntil - Date.now()) / 60000);
      ui.notifications.warn(`ICE lockout active — ${remaining} minute${remaining !== 1 ? 's' : ''} remaining.`);
      return;
    }

    const skillName = contact.encryptionSkill || 'Interface';
    const dc = contact.encryptionDV || 15;
    const maxAttempts = contact.maxBreachAttempts || 3;
    const currentAttempts = contact.breachAttempts || 0;

    // Get the player's skill info
    const availableSkills = skillService.getAvailableSkills(actor, [skillName]) ?? [];
    const skill = availableSkills.find(s => s.name === skillName) || availableSkills[0];
    const skillTotal = skill?.total ?? 0;
    const availableLuck = skillService.getAvailableLuck(actor) ?? 0;

    // ICE portrait
    let icePortrait = '';
    if (contact.blackIce) {
      if (contact.iceSource === 'custom' && contact.iceCustomPortrait) {
        icePortrait = contact.iceCustomPortrait;
      } else if (contact.iceSource === 'actor' && contact.iceActorId) {
        icePortrait = game.actors.get(contact.iceActorId)?.img || '';
      }
    }

    // Show breach dialog
    const dialogResult = await this._showBreachDialog({
      dc,
      skillName: skill?.name || skillName,
      skillTotal,
      skillStat: skill?.stat || '',
      availableLuck,
      isBlackICE: !!contact.blackIce,
      blackIceDamage: contact.blackIceDamage || '3d6',
      icePortrait,
      actorName: actor.name,
      currentAttempt: currentAttempts + 1,
      maxAttempts,
    });

    if (!dialogResult) return;

    // Show breaching state on overlay
    const overlayEl = target.closest('.ncm-ice') || target;

    // ── Phase 1: Breach initiation — terminal lines + accelerating scan ──
    await this._playBreachInit(overlayEl, contact.blackIce);

    // Execute breach
    const result = await breachService.attemptBreach(
      this.actorId, contactId, actor,
      { luckSpend: dialogResult.luck, skillOverride: dialogResult.skill }
    );

    if (result.success) {
      // ── Phase 2a: SUCCESS — unlock + dissolve ──
      await this._playBreachSuccess(overlayEl);
      this.render();
      // ── Phase 3: Reveal — staggered fade-in of decrypted contact ──
      this._playContactReveal();
    } else if (result.error) {
      overlayEl.classList?.remove('ncm-ice--breaching');
      ui.notifications.error(result.error);
      this.render();
    } else {
      // ── Phase 2b: FAILURE — corruption + denied ──
      await this._playBreachDenied(overlayEl, result.blackIce);
      this.render();
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
      this._playContactReveal();
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
  //  Action Handlers — Form Helpers
  // ═══════════════════════════════════════════════════════════

  /**
   * Browse Foundry files for a portrait image path.
   */
  static _onBrowsePortrait(event, target) {
    event.stopPropagation();
    const input = this.element?.querySelector('[name="portrait"]');
    if (!input) return;

    const fp = new FilePicker({
      type: 'image',
      current: input.value || '',
      callback: (path) => {
        if (path) input.value = path;
      },
    });
    fp.browse();
  }

  /**
   * Create a new folder name via prompt and fill into the folder input.
   */
  static async _onCreateFolderInline(event, target) {
    event.stopPropagation();
    const result = await Dialog.prompt({
      title: 'Create Folder',
      content: `
        <form class="ncm-dialog-form">
          <div class="form-group">
            <label>Folder Name</label>
            <input type="text" name="folderName" placeholder="e.g. Main Story NPCs" maxlength="40" autofocus />
          </div>
        </form>`,
      callback: (html) => (html[0] || html).querySelector('[name="folderName"]')?.value?.trim(),
      rejectClose: false,
    });

    if (!result) return;
    const input = this.element?.querySelector('[name="folder"]');
    if (input) input.value = result;
  }

  /**
   * Switch ICE source mode (default / custom / actor).
   * Shows the matching panel, hides others, updates hidden input.
   */
  static _onSelectIceMode(event, target) {
    event.stopPropagation();
    const mode = target.closest('[data-mode]')?.dataset.mode;
    if (!mode) return;

    // Toggle card selection
    const cards = this.element?.querySelectorAll('.ncm-cfg-ice-card');
    cards?.forEach(c => c.classList.toggle('ncm-cfg-ice-card--sel', c.dataset.mode === mode));

    // Toggle panels
    const panels = this.element?.querySelectorAll('[data-ice-panel]');
    panels?.forEach(p => p.classList.toggle('ncm-cfg-ice-panel--on', p.dataset.icePanel === mode));

    // Update hidden input
    const hidden = this.element?.querySelector('[name="iceSource"]');
    if (hidden) hidden.value = mode;
  }

  /**
   * Select a BLACK ICE actor from the actor grid.
   */
  static _onSelectIceActor(event, target) {
    event.stopPropagation();
    const actorId = target.closest('[data-actor-id]')?.dataset.actorId;
    if (!actorId) return;

    // Toggle card selection
    const cards = this.element?.querySelectorAll('.ncm-cfg-actor-card');
    cards?.forEach(c => c.classList.toggle('ncm-cfg-actor-card--sel', c.dataset.actorId === actorId));

    // Update hidden input
    const hidden = this.element?.querySelector('[name="iceActorId"]');
    if (hidden) hidden.value = actorId;
  }

  /**
   * Browse for a custom ICE portrait via FilePicker.
   */
  static _onBrowseIcePortrait(event, target) {
    event.stopPropagation();
    const input = this.element?.querySelector('[name="iceCustomPortrait"]');
    if (!input) return;
    const fp = new FilePicker({
      type: 'image',
      current: input.value || '',
      callback: (path) => { if (path) input.value = path; },
    });
    fp.browse();
  }

  // ═══════════════════════════════════════════════════════════
  //  Breach Dialog + Animations
  // ═══════════════════════════════════════════════════════════

  /**
   * Show a themed breach dialog with skill info, luck slider, odds gauge.
   * Lighter than data shard's hack dialog — single skill, compact layout.
   * @param {object} opts
   * @returns {Promise<{skill: string, luck: number}|null>}
   */
  async _showBreachDialog(opts) {
    let luckSpend = 0;
    let cancelled = true;

    const calcOdds = (total, luck, dc) => {
      const needed = dc - total - luck;
      if (needed <= 1) return 100;
      if (needed > 10) return 0;
      return Math.round(((10 - needed + 1) / 10) * 100);
    };

    const initOdds = calcOdds(opts.skillTotal, 0, opts.dc);
    const oddsClass = initOdds >= 60 ? 'high' : initOdds >= 30 ? 'mid' : 'low';

    // BLACK ICE danger zone
    let dangerHTML = '';
    if (opts.isBlackICE) {
      const imgHTML = opts.icePortrait
        ? `<img src="${opts.icePortrait}" alt="BLACK ICE" class="ncm-bd-danger__img" />`
        : `<div class="ncm-bd-danger__icon"><i class="fas fa-skull-crossbones"></i></div>`;
      dangerHTML = `
        <div class="ncm-bd-danger">
          ${imgHTML}
          <div class="ncm-bd-danger__text">
            <div class="ncm-bd-danger__title">BLACK ICE — Lethal Countermeasures</div>
            <div class="ncm-bd-danger__sub">Failure deals <strong>${opts.blackIceDamage}</strong> damage directly.</div>
          </div>
        </div>`;
    }

    // Luck gauge
    const maxLuck = opts.availableLuck || 0;
    let luckHTML = '';
    if (maxLuck > 0) {
      const segs = Array.from({ length: Math.min(maxLuck, 10) }, (_, i) =>
        `<div class="ncm-bd-luck__seg" data-seg="${i}"></div>`
      ).join('');
      luckHTML = `
        <div class="ncm-bd-section-label"><i class="fas fa-clover"></i> LUCK BOOST <span class="ncm-bd-luck__avail">${maxLuck}</span></div>
        <div class="ncm-bd-luck">
          <button type="button" class="ncm-bd-luck__adj" data-adj="-1">&minus;</button>
          <div class="ncm-bd-luck__gauge">${segs}</div>
          <button type="button" class="ncm-bd-luck__adj" data-adj="+1">+</button>
          <span class="ncm-bd-luck__val">0</span>
        </div>`;
    }

    const content = `
      <div class="ncm-bd-body">
        <div class="ncm-bd-header">
          <div class="ncm-bd-header__icon ${opts.isBlackICE ? 'ncm-bd-header__icon--danger' : ''}">
            <i class="fas fa-${opts.isBlackICE ? 'skull-crossbones' : 'terminal'}"></i>
          </div>
          <div class="ncm-bd-header__info">
            <div class="ncm-bd-header__title">Contact ICE Breach</div>
            <div class="ncm-bd-header__sub">${opts.actorName} attempting intrusion</div>
          </div>
        </div>

        ${dangerHTML}

        <div class="ncm-bd-skill">
          <div class="ncm-bd-section-label"><i class="fas fa-crosshairs"></i> SKILL CHECK</div>
          <div class="ncm-bd-skill__row">
            <span class="ncm-bd-skill__name">${opts.skillName}</span>
            <span class="ncm-bd-skill__detail">${opts.skillStat ? opts.skillStat + ' ' : ''}${opts.skillTotal} + 1d10</span>
            <span class="ncm-bd-skill__vs">vs</span>
            <span class="ncm-bd-skill__dc">DV ${opts.dc}</span>
          </div>
        </div>

        ${luckHTML}

        <div class="ncm-bd-odds">
          <div class="ncm-bd-odds__header">
            <span class="ncm-bd-odds__label">Success Probability</span>
            <span class="ncm-bd-odds__pct ${oddsClass}" data-odds-pct>${initOdds}%</span>
          </div>
          <div class="ncm-bd-odds__track">
            <div class="ncm-bd-odds__fill ${oddsClass}" data-odds-fill style="width:${initOdds}%;"></div>
          </div>
          <div class="ncm-bd-breakdown" data-breakdown>
            <span class="ncm-bd-val">${opts.skillTotal}</span>
            <span class="ncm-bd-op">+</span>
            <span class="ncm-bd-die">1d10</span>
            <span class="ncm-bd-op">vs</span>
            <span class="ncm-bd-vs">DV ${opts.dc}</span>
          </div>
        </div>

        ${opts.maxAttempts ? (() => {
          const dots = Array.from({ length: opts.maxAttempts }, (_, i) => {
            if (i < (opts.currentAttempt - 1)) return '<div class="ncm-ice__attempt-dot ncm-ice__attempt-dot--used"></div>';
            if (i === (opts.currentAttempt - 1)) return '<div class="ncm-ice__attempt-dot ncm-ice__attempt-dot--current"></div>';
            return '<div class="ncm-ice__attempt-dot"></div>';
          }).join('');
          return `<div class="ncm-bd-attempts"><span class="ncm-bd-section-label"><i class="fas fa-circle-dot"></i> ATTEMPT ${opts.currentAttempt} / ${opts.maxAttempts}</span><div class="ncm-bd-attempts__dots">${dots}</div></div>`;
        })() : ''}
      </div>`;

    const themeClass = opts.isBlackICE ? 'ncm-bd-theme--black' : 'ncm-bd-theme--cyan';

    await new Promise(resolve => {
      const d = new Dialog({
        title: opts.isBlackICE ? 'BLACK ICE Breach' : 'ICE Breach',
        content,
        buttons: {
          execute: {
            icon: `<i class="fas fa-${opts.isBlackICE ? 'skull-crossbones' : 'bolt'}"></i>`,
            label: opts.isBlackICE ? 'Risk Breach' : 'Breach',
            callback: () => { cancelled = false; },
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: 'Abort',
          },
        },
        default: 'cancel',
        close: () => resolve(),
        render: (html) => {
          const jq = html.closest ? html : $(html);
          const dialog = jq.closest('.dialog, .window-app');
          dialog.addClass(`ncm-breach-dialog ${themeClass}`);

          const updateOdds = () => {
            const odds = calcOdds(opts.skillTotal, luckSpend, opts.dc);
            const cls = odds >= 60 ? 'high' : odds >= 30 ? 'mid' : 'low';
            jq.find('[data-odds-pct]').text(odds + '%').removeClass('high mid low').addClass(cls);
            jq.find('[data-odds-fill]').css('width', odds + '%').removeClass('high mid low').addClass(cls);
            jq.find('.ncm-bd-luck__val').text(luckSpend);

            const totalWithLuck = opts.skillTotal + luckSpend;
            jq.find('[data-breakdown]').html(
              `<span class="ncm-bd-val">${totalWithLuck}</span>` +
              (luckSpend > 0 ? `<span class="ncm-bd-luck-add">+${luckSpend} luck</span>` : '') +
              `<span class="ncm-bd-op">+</span><span class="ncm-bd-die">1d10</span>` +
              `<span class="ncm-bd-op">vs</span><span class="ncm-bd-vs">DV ${opts.dc}</span>`
            );

            jq.find('.ncm-bd-luck__seg').each(function(i) {
              $(this).toggleClass('ncm-bd-luck__seg--active', i < luckSpend);
            });
          };

          jq.find('.ncm-bd-luck__adj').on('click', function() {
            const adj = parseInt(this.dataset.adj);
            luckSpend = Math.max(0, Math.min(maxLuck, luckSpend + adj));
            updateOdds();
          });
        },
      });
      d.render(true);
    });

    if (cancelled) return null;
    return { skill: opts.skillName, luck: luckSpend };
  }


  // ═══════════════════════════════════════════════════════════
  //  Breach Animation Sequence (CSS-driven, no DOM injection)
  // ═══════════════════════════════════════════════════════════

  /**
   * Phase 1: Breach initiation — add breaching class (CSS handles ring + collapse),
   * cycle status text through phases.
   * Duration: ~3.5s
   */
  async _playBreachInit(overlayEl, isBlackICE) {
    if (!overlayEl) return;

    overlayEl.classList.add('ncm-ice--breaching');

    const status = overlayEl.querySelector('.ncm-ice__status');
    if (!status) return;

    const phases = isBlackICE
      ? ['Probing ICE barrier...', 'BLACK ICE countermeasures detected', 'Injecting exploit...', 'Decrypting...']
      : ['Probing ICE barrier...', 'Mapping encryption layers...', 'Injecting exploit...', 'Decrypting...'];

    for (const text of phases) {
      status.style.opacity = '0';
      await new Promise(r => setTimeout(r, 150));
      status.textContent = text;
      status.style.opacity = '1';
      await new Promise(r => setTimeout(r, 700));
    }

    // Final hold
    status.style.opacity = '0';
    await new Promise(r => setTimeout(r, 200));
    status.textContent = 'Resolving...';
    status.style.opacity = '1';
    await new Promise(r => setTimeout(r, 500));
  }

  /**
   * Phase 2a: Breach SUCCESS — granted flash + result text + dissolve.
   */
  async _playBreachSuccess(overlayEl) {
    if (!overlayEl) return;

    overlayEl.classList.remove('ncm-ice--breaching');

    // Clear status
    const status = overlayEl.querySelector('.ncm-ice__status');
    if (status) status.style.opacity = '0';

    // Show result
    const result = overlayEl.querySelector('.ncm-ice__result');
    if (result) {
      result.innerHTML = `
        <div class="ncm-ice__result-icon"><i class="fas fa-lock-open"></i></div>
        <div class="ncm-ice__result-label">Access Granted</div>
        <div class="ncm-ice__result-sub">ICE barrier neutralized</div>
      `;
      result.className = 'ncm-ice__result ncm-ice__result--granted ncm-ice__result--visible';
    }

    overlayEl.classList.add('ncm-ice--granted');
    await new Promise(r => setTimeout(r, 900));

    overlayEl.classList.add('ncm-ice--dissolve');
    await new Promise(r => setTimeout(r, 1000));
  }

  /**
   * Phase 2b: Breach DENIED — red flash + shake + result text.
   * BLACK ICE: swap to damage splash after delay.
   */
  async _playBreachDenied(overlayEl, blackIceResult) {
    if (!overlayEl) return;

    overlayEl.classList.remove('ncm-ice--breaching');

    // Clear status
    const status = overlayEl.querySelector('.ncm-ice__status');
    if (status) status.style.opacity = '0';

    // Show denied result
    const result = overlayEl.querySelector('.ncm-ice__result');
    if (result) {
      result.innerHTML = `
        <div class="ncm-ice__result-icon"><i class="fas fa-shield-halved"></i></div>
        <div class="ncm-ice__result-label">Access Denied</div>
        <div class="ncm-ice__result-sub">ICE countermeasures hold</div>
      `;
      result.className = 'ncm-ice__result ncm-ice__result--denied ncm-ice__result--visible';
    }

    overlayEl.classList.add('ncm-ice--denied');

    // BLACK ICE: show damage splash
    if (blackIceResult?.damage && result) {
      await new Promise(r => setTimeout(r, 1200));

      result.innerHTML = `
        <div class="ncm-ice__result-icon"><i class="fas fa-skull-crossbones"></i></div>
        <div class="ncm-ice__result-label">${blackIceResult.damage}</div>
        <div class="ncm-ice__result-sub">BLACK ICE DAMAGE</div>
      `;
      result.className = 'ncm-ice__result ncm-ice__result--damage ncm-ice__result--visible';
      await new Promise(r => setTimeout(r, 2000));
    } else {
      await new Promise(r => setTimeout(r, 2000));
    }

    // Cleanup — restore to idle state
    overlayEl.classList.remove('ncm-ice--denied');
    if (result) {
      result.className = 'ncm-ice__result';
      result.innerHTML = '';
    }
    if (status) status.textContent = '';
  }

  /**
   * Phase 3: Contact reveal — staggered fade-in of decrypted contact detail.
   * Called after render() has replaced the ICE overlay with actual contact info.
   * Uses requestAnimationFrame to ensure DOM is flushed.
   */
  _playContactReveal() {
    requestAnimationFrame(() => {
      const detail = this.element?.querySelector('.ncm-split__detail');
      if (!detail) return;

      // Find all revealable elements in order
      const selectors = [
        '.ncm-detail__avatar',
        '.ncm-detail__name',
        '.ncm-detail__alias',
        '.ncm-detail__chips',
        '.ncm-detail__actions',
        '.ncm-info-card',
        '.ncm-info-card + .ncm-info-card',
        '.ncm-info-card + .ncm-info-card + .ncm-info-card',
      ];

      // Also grab all info cards individually for staggering
      const cards = detail.querySelectorAll('.ncm-info-card');
      const elements = [];

      // Collect unique elements in visual order
      const avatar = detail.querySelector('.ncm-detail__avatar');
      const name = detail.querySelector('.ncm-detail__name');
      const alias = detail.querySelector('.ncm-detail__alias');
      const chips = detail.querySelector('.ncm-detail__chips');
      const actions = detail.querySelector('.ncm-detail__actions');

      if (avatar) elements.push(avatar);
      if (name) elements.push(name);
      if (alias) elements.push(alias);
      if (chips) elements.push(chips);
      if (actions) elements.push(actions);
      cards.forEach(c => elements.push(c));

      // Set initial state and stagger reveal
      elements.forEach((el, i) => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(12px)';
        el.style.transition = 'none';
      });

      // Force reflow
      void detail.offsetHeight;

      // Animate in with stagger
      elements.forEach((el, i) => {
        setTimeout(() => {
          el.style.transition = 'opacity 0.4s ease, transform 0.4s cubic-bezier(0.16,1,0.3,1)';
          el.style.opacity = '1';
          el.style.transform = 'translateY(0)';
        }, 60 * i);
      });

      // Clean up inline styles after animation completes
      setTimeout(() => {
        elements.forEach(el => {
          el.style.opacity = '';
          el.style.transform = '';
          el.style.transition = '';
        });
      }, 60 * elements.length + 500);
    });
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
