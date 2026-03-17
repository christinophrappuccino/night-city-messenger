/**
 * GM Master Contact Directory — Phase 2 Redesign
 * @file scripts/ui/GMContactManager/GMContactManagerApp.js
 * @module cyberpunkred-messenger
 * @description GM-only interface for the master NPC contact directory.
 *   Split-view layout: grouped contact list (left) + detail panel (right).
 *   Full CRUD, party trust, per-player relationships with trust overrides,
 *   inline-styled chips (role/org/location/tag), grouping (none/org/role/tag/folders),
 *   pagination (10 per page), custom role integration, burn/restore, push to player,
 *   import from actors, portrait upload, GM notes, and tag management.
 *
 *   Extends BaseApplication (ApplicationV2 + HandlebarsApplicationMixin).
 */

import { MODULE_ID, TEMPLATES, EVENTS } from '../../utils/constants.js';
import { log, isGM } from '../../utils/helpers.js';
import { BaseApplication } from '../BaseApplication.js';
import {
  getAvatarColor,
  getInitials,
  enrichContactForDisplay,
  getTrustData,
  getRoleIcon,
} from '../../utils/designHelpers.js';
import { RoleManagerDialog } from './RoleManagerDialog.js';

// ═══════════════════════════════════════════
//  Constants — Role & Relationship Maps
// ═══════════════════════════════════════════

const BUILT_IN_ROLES = {
  fixer:      { label: 'Fixer',      icon: 'crosshairs',       color: '#d4a017' },
  netrunner:  { label: 'Netrunner',  icon: 'terminal',         color: '#00e5ff' },
  corp:       { label: 'Corp',       icon: 'briefcase',        color: '#4a8ab5' },
  exec:       { label: 'Exec',       icon: 'building-columns', color: '#6ec1e4' },
  solo:       { label: 'Solo',       icon: 'crosshairs',       color: '#e04848' },
  tech:       { label: 'Tech',       icon: 'gear',             color: '#2ecc71' },
  medtech:    { label: 'Medtech',    icon: 'staff-snake',      color: '#1abc9c' },
  ripperdoc:  { label: 'Ripperdoc',  icon: 'syringe',          color: '#e06888' },
  media:      { label: 'Media',      icon: 'podcast',          color: '#b87aff' },
  nomad:      { label: 'Nomad',      icon: 'truck-monster',    color: '#d4844a' },
  lawman:     { label: 'Lawman',     icon: 'shield-halved',    color: '#6b8fa3' },
  rockerboy:  { label: 'Rockerboy',  icon: 'guitar',           color: '#e05cb5' },
  gang:       { label: 'Gang',       icon: 'users-line',       color: '#cc4444' },
  civilian:   { label: 'Civilian',   icon: 'user',             color: '#8888a0' },
  government: { label: 'Gov',        icon: 'landmark',         color: '#5a7fa5' },
  ai:         { label: 'A.I.',       icon: 'microchip',        color: '#ff44cc' },
};

const RELATIONSHIP_TYPES = {
  ally:       { label: 'ALLY',       icon: 'fa-handshake',            color: '#00ff41' },
  hostile:    { label: 'HOSTILE',    icon: 'fa-skull-crossbones',     color: '#ff0033' },
  rival:      { label: 'RIVAL',     icon: 'fa-bolt',                 color: '#b87aff' },
  neutral:    { label: 'NEUTRAL',   icon: 'fa-minus',                color: '#555570' },
  contact:    { label: 'CONTACT',   icon: 'fa-address-card',         color: '#7aa2c4' },
  'owes-you': { label: 'OWES YOU',  icon: 'fa-coins',                color: '#f7c948' },
  'you-owe':  { label: 'YOU OWE',   icon: 'fa-hand-holding-dollar',  color: '#d4844a' },
  patron:     { label: 'PATRON',    icon: 'fa-crown',                color: '#6ec1e4' },
  informant:  { label: 'INFORMANT', icon: 'fa-user-secret',          color: '#1abc9c' },
};

const TRUST_LABELS = {
  0: 'UNKNOWN', 1: 'SUSPICIOUS', 2: 'CAUTIOUS',
  3: 'NEUTRAL', 4: 'TRUSTED', 5: 'IMPLICITLY TRUSTED',
};

const ITEMS_PER_PAGE = 10;

/** Build inline chip style from a hex color */
function _chipStyle(color) {
  if (!color) return '';
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  return `color:${color};border-color:rgba(${r},${g},${b},0.35);background:rgba(${r},${g},${b},0.10);`;
}

/** Build inline badge style from a hex color */
function _badgeStyle(color) {
  if (!color) return '';
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  return `color:${color};border-color:rgba(${r},${g},${b},0.35);background:rgba(${r},${g},${b},0.08);`;
}

export class GMContactManagerApp extends BaseApplication {

  // ═══════════════════════════════════════════════════════════
  //  Instance State
  // ═══════════════════════════════════════════════════════════

  /** @type {string|null} Selected contact ID in the list */
  _selectedContactId = null;

  /** @type {boolean} Creating a new contact */
  _isCreating = false;

  /** @type {boolean} Editing an existing contact */
  _isEditing = false;

  /** @type {string} Current search query */
  _searchQuery = '';

  /** @type {string[]} Active tag filters */
  _activeTagFilters = [];

  /** @type {string} Organization filter */
  _orgFilter = '';

  /** @type {Set<string>} Selected contacts for bulk operations */
  _bulkSelected = new Set();

  /** @type {string} Grouping mode: 'none'|'organization'|'role'|'tag'|'folders' */
  _groupBy = 'none';

  /** @type {number} Current page (1-indexed) */
  _currentPage = 1;

  /** @type {Set<string>} Keys of collapsed groups */
  _collapsedGroups = new Set();

  /** @type {string[]} All group keys (computed in _buildGroups, used by collapseAll) */
  _allGroupKeys = [];

  /** @type {Set<string>} Actor IDs with notes expanded in detail view */
  _expandedNotes = new Set();

  /** @type {number} Saved scroll position for list panel */
  _listScrollTop = 0;

  // ═══════════════════════════════════════════════════════════
  //  Service Accessors
  // ═══════════════════════════════════════════════════════════

  get masterContactService() { return game.nightcity?.masterContactService; }
  get contactRepo() { return game.nightcity?.contactRepository; }
  get portraitService() { return game.nightcity?.portraitService; }
  get shareService() { return game.nightcity?.contactShareService; }
  get notificationService() { return game.nightcity?.notificationService; }
  get soundService() { return game.nightcity?.soundService; }
  get eventBus() { return game.nightcity?.eventBus; }

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
      width: 920,
      height: 680,
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
      // ─── Trust ───
      setTrustLevel:    GMContactManagerApp._onSetTrustLevel,
      burnContact:      GMContactManagerApp._onBurnContact,
      restoreContact:   GMContactManagerApp._onRestoreContact,
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
      // ─── Grouping / Pagination ───
      toggleGroup:      GMContactManagerApp._onToggleGroup,
      collapseAll:      GMContactManagerApp._onCollapseAll,
      expandAll:        GMContactManagerApp._onExpandAll,
      createFolder:     GMContactManagerApp._onCreateFolder,
      renameFolder:     GMContactManagerApp._onRenameFolder,
      prevPage:         GMContactManagerApp._onPrevPage,
      nextPage:         GMContactManagerApp._onNextPage,
      // ─── Relationship notes (detail) ───
      toggleRelNote:    GMContactManagerApp._onToggleRelNote,
    },
  }, { inplace: false });

  static PARTS = {
    main: { template: TEMPLATES.GM_CONTACT_MANAGER },
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
        (c.location || '').toLowerCase().includes(q) ||
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

    // ── Custom roles from settings ──
    const customRoles = svc.getCustomRoles?.() || [];

    // ── Build merged role lookup (built-in + custom) ──
    const allRoles = { ...BUILT_IN_ROLES };
    for (const cr of customRoles) {
      allRoles[cr.id] = { label: cr.label, icon: cr.icon, color: cr.color };
    }

    // ── Enrich contacts for list display ──
    const enriched = allContacts.map(c => {
      const base = enrichContactForDisplay(c, {
        selectedId: this._selectedContactId,
        isGM: true,
      });

      // Role chip inline style for list item
      const roleLower = (c.role || '').toLowerCase();
      const roleData = allRoles[roleLower];
      base.roleChipStyle = roleData ? _chipStyle(roleData.color) : '';
      base.roleLabel = roleData ? roleData.label.toUpperCase() : (roleLower || '').toUpperCase();

      return base;
    });

    // ── Pagination ──
    const totalFiltered = enriched.length;
    const totalPages = Math.max(1, Math.ceil(totalFiltered / ITEMS_PER_PAGE));
    if (this._currentPage > totalPages) this._currentPage = totalPages;
    const pageStart = (this._currentPage - 1) * ITEMS_PER_PAGE;
    const paged = enriched.slice(pageStart, pageStart + ITEMS_PER_PAGE);

    // ── Grouping ──
    // Pass full enriched list for accurate group counts; paged subset for visible contacts
    const groups = this._buildGroups(paged, allRoles, enriched);

    // ── Player actors ──
    const playerActors = [];
    for (const user of game.users ?? []) {
      if (user.isGM || !user.character) continue;
      playerActors.push({
        id: user.character.id,
        name: user.character.name,
        img: user.character.img,
        isPlayer: true,
        ownerName: user.name,
        initials: getInitials(user.character.name),
        avatarColor: getAvatarColor(user.character.name),
        initial: (user.character.name || '?').charAt(0).toUpperCase(),
      });
    }

    // ── Available actors for linking ──
    const availableActors = game.actors
      .map(a => ({
        id: a.id,
        name: a.name,
        img: a.img,
        hasPlayerOwner: a.hasPlayerOwner,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // ── Selected contact enrichment ──
    let selectedEnriched = null;
    let perPlayerRelationships = [];
    if (this._selectedContactId && !this._isCreating) {
      const selectedContact = svc.getContact(this._selectedContactId);
      if (selectedContact) {
        selectedEnriched = enrichContactForDisplay(selectedContact, {
          selectedId: this._selectedContactId,
          isGM: true,
        });

        // Resolve linked actor info
        if (selectedContact.actorId) {
          const actor = game.actors.get(selectedContact.actorId);
          selectedEnriched.actorName = actor?.name ?? '(unknown actor)';
          selectedEnriched.actorImg = actor?.img;
          if (actor?.hasPlayerOwner) {
            const ownerEntry = Object.entries(actor.ownership || {}).find(
              ([uid, level]) => uid !== 'default' && level === CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER
            );
            if (ownerEntry) {
              selectedEnriched.playerOwnerName = game.users.get(ownerEntry[0])?.name || null;
            }
          }
        }

        // Trust data
        selectedEnriched.trustData = getTrustData(selectedContact.trust || 0);
        selectedEnriched.trustLabel = TRUST_LABELS[selectedContact.trust ?? 0] || 'UNKNOWN';

        // Build inline-styled chips (role, org, location, tags)
        selectedEnriched.chips = this._buildChips(selectedContact, allRoles);

        // Per-player relationships for detail view
        selectedEnriched.playerRelationships = this._buildPlayerRelationships(
          selectedContact, playerActors
        );

        // Per-player relationships for edit form
        perPlayerRelationships = this._buildPerPlayerFormData(selectedContact, playerActors);
      }
    }

    // ── Collect all tags for filter pills ──
    const allTagsRaw = svc.getAllTags?.() || [];
    const tagPills = allTagsRaw.map(tag => ({
      label: tag.toUpperCase(),
      value: tag,
      isActive: this._activeTagFilters.includes(tag.toUpperCase()),
    }));

    // ── Stats ──
    const totalCount = svc.getAll().length;
    const linkedCount = svc.getAll().filter(c => c.actorId).length;

    // ── Existing folder names (for datalist in form) ──
    const existingFolders = [...new Set(
      svc.getAll().map(c => c.folder).filter(Boolean)
    )].sort();

    return {
      hasService: true,

      // Contact data
      groups,
      contactCount: totalCount,
      filteredCount: totalFiltered,
      linkedCount,

      // Selected / editing
      selectedContact: selectedEnriched,
      hasSelection: !!selectedEnriched,
      isCreating: this._isCreating,
      isEditing: this._isEditing,
      showForm: this._isCreating || this._isEditing,
      showDetail: !!selectedEnriched && !this._isEditing,

      // Grouping
      groupBy: this._groupBy,
      isFolderMode: this._groupBy === 'folders',

      // Pagination
      currentPage: this._currentPage,
      totalPages,
      showPagination: totalPages > 1,
      hasPrevPage: this._currentPage > 1,
      hasNextPage: this._currentPage < totalPages,

      // Filters
      searchQuery: this._searchQuery,
      activeTagFilters: this._activeTagFilters,
      hasActiveTagFilter: this._activeTagFilters.length > 0,
      tagPills,
      orgFilter: this._orgFilter,

      // Actors
      availableActors,
      playerActors,

      // Roles
      customRoles,

      // Folders
      existingFolders,

      // Per-player relationships (form)
      perPlayerRelationships,

      MODULE_ID,
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  Grouping Logic
  // ═══════════════════════════════════════════════════════════

  _buildGroups(pagedContacts, allRoles, allEnriched) {
    if (this._groupBy === 'none') {
      return [{
        key: '__all__',
        label: 'All Contacts',
        icon: 'fa-address-book',
        showHeader: false,
        collapsed: false,
        isFolder: false,
        totalInGroup: allEnriched.length,
        contacts: pagedContacts,
      }];
    }

    /** Extract group key(s) for a contact based on current groupBy mode */
    const _groupKeys = (c) => {
      if (this._groupBy === 'organization') {
        return [c.organization || 'Unaffiliated'];
      } else if (this._groupBy === 'role') {
        const roleLower = (c.role || '').toLowerCase();
        const roleData = allRoles[roleLower];
        return [roleData ? roleData.label : (roleLower || 'No Role')];
      } else if (this._groupBy === 'tag') {
        return (c.tags && c.tags.length) ? c.tags : ['Untagged'];
      } else if (this._groupBy === 'folders') {
        return [c.folder || 'Unfiled'];
      }
      return ['Other'];
    };

    // Build full counts from ALL filtered contacts (not just current page)
    const fullCountMap = new Map();
    for (const c of allEnriched) {
      for (const key of _groupKeys(c)) {
        fullCountMap.set(key, (fullCountMap.get(key) || 0) + 1);
      }
    }

    // Build paged groups — only contacts visible on current page
    const groupMap = new Map();
    for (const c of pagedContacts) {
      for (const key of _groupKeys(c)) {
        if (!groupMap.has(key)) groupMap.set(key, []);
        groupMap.get(key).push(c);
      }
    }

    // Sort groups alphabetically, but put catch-all groups last
    const catchAll = new Set(['Unfiled', 'Unaffiliated', 'Untagged', 'No Role']);
    // Use full count keys so we know ALL group names (for collapseAll)
    const allKeys = [...fullCountMap.keys()].sort((a, b) => {
      if (catchAll.has(a) && !catchAll.has(b)) return 1;
      if (!catchAll.has(a) && catchAll.has(b)) return -1;
      return a.localeCompare(b);
    });

    // Store all group keys for collapseAll (Bug 2 fix)
    this._allGroupKeys = allKeys;

    const groupIcon = {
      organization: 'fa-building',
      role: 'fa-user-tag',
      tag: 'fa-tag',
      folders: 'fa-folder',
    }[this._groupBy] || 'fa-folder';

    // Only return groups that have contacts on the current page
    return allKeys
      .filter(key => groupMap.has(key))
      .map(key => ({
        key,
        label: key,
        icon: this._groupBy === 'folders'
          ? (catchAll.has(key) ? 'fa-folder-open' : 'fa-folder')
          : groupIcon,
        showHeader: true,
        collapsed: this._collapsedGroups.has(key),
        isFolder: this._groupBy === 'folders' && !catchAll.has(key),
        totalInGroup: fullCountMap.get(key) || 0,
        contacts: groupMap.get(key) || [],
      }));
  }

  // ═══════════════════════════════════════════════════════════
  //  Chip Building (inline-styled)
  // ═══════════════════════════════════════════════════════════

  _buildChips(contact, allRoles) {
    const chips = [];
    const roleLower = (contact.role || '').toLowerCase();
    const roleData = allRoles[roleLower];

    // Role chip
    if (roleData) {
      chips.push({
        label: roleData.label,
        icon: roleData.icon,
        style: _chipStyle(roleData.color),
      });
    }

    // Organization
    if (contact.organization) {
      chips.push({
        label: contact.organization,
        icon: 'building',
        style: _chipStyle('#7aa2c4'),
      });
    }

    // Location
    if (contact.location) {
      chips.push({
        label: contact.location,
        icon: 'location-dot',
        style: _chipStyle('#c47a2a'),
      });
    }

    // Tags (skip if already used as role)
    if (contact.tags) {
      for (const tag of contact.tags) {
        if (roleLower && tag.toLowerCase() === roleLower) continue;
        chips.push({
          label: tag,
          icon: null,
          style: _chipStyle('#19f3f7'),
        });
      }
    }

    // Alias
    if (contact.alias) {
      chips.push({
        label: `"${contact.alias}"`,
        icon: null,
        style: _chipStyle('#c8c8dc'),
      });
    }

    return chips;
  }

  // ═══════════════════════════════════════════════════════════
  //  Per-Player Relationships (Detail View)
  // ═══════════════════════════════════════════════════════════

  _buildPlayerRelationships(contact, playerActors) {
    const rels = contact.relationships || {};
    const partyTrust = contact.trust ?? 0;

    return playerActors.map(pa => {
      const rel = rels[pa.id] || {};
      const relType = rel.type || '';
      const relData = RELATIONSHIP_TYPES[relType];
      const playerTrust = rel.trust != null ? rel.trust : partyTrust;
      const isOverride = rel.trust != null && rel.trust !== partyTrust;

      return {
        actorId: pa.id,
        characterName: pa.name,
        playerName: pa.ownerName,
        initial: pa.initial,
        relType,
        relBadgeLabel: relData?.label || '',
        relIcon: relData?.icon || '',
        relBadgeStyle: relData ? _badgeStyle(relData.color) : '',
        displayTrust: playerTrust,
        partyTrust,
        isOverride,
        trustSegments: [1, 2, 3, 4, 5].map(v => ({
          value: v,
          active: v <= playerTrust,
        })),
        hasNote: !!rel.note,
        note: rel.note || '',
        showNote: this._expandedNotes.has(pa.id) && !!rel.note,
      };
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  Per-Player Relationships (Form Data)
  // ═══════════════════════════════════════════════════════════

  _buildPerPlayerFormData(contact, playerActors) {
    const rels = contact.relationships || {};
    const partyTrust = contact.trust ?? 0;

    return playerActors.map(pa => {
      const rel = rels[pa.id] || {};
      const trust = rel.trust;
      const effectiveTrust = trust != null ? trust : partyTrust;
      const isOverride = trust != null && trust !== partyTrust;

      return {
        actorId: pa.id,
        characterName: pa.name,
        initial: pa.initial,
        relType: rel.type || '',
        trustValue: trust,
        trustDisplay: trust != null ? (isOverride ? `${trust}*` : `${trust}`) : '—',
        isOverride,
        note: rel.note || '',
        // Precomputed flags for each trust level pip
        trustLevel1: effectiveTrust >= 1,
        trustLevel2: effectiveTrust >= 2,
        trustLevel3: effectiveTrust >= 3,
        trustLevel4: effectiveTrust >= 4,
        trustLevel5: effectiveTrust >= 5,
      };
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  Lifecycle
  // ═══════════════════════════════════════════════════════════

  _setupEventSubscriptions() {
    this.subscribe('contacts:masterUpdated', () => this._debouncedRender());
    this.subscribe(EVENTS.CONTACT_TRUST_CHANGED, () => this.render());
    this.subscribe(EVENTS.CONTACT_BURNED, () => this.render());
    this.subscribe('roles:updated', () => this.render());
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this._setupSearchInput();
    this._setupTrustHoverPreview();
    this._setupGMNotesAutosave();
    this._setupKeyboardShortcuts();
    this._setupGroupBySelect();
    this._setupTrustPipClicks();
    this._restoreListScroll();
    this._setupRoleSelectManage();
  }

  // ═══════════════════════════════════════════════════════════
  //  Post-Render Setup
  // ═══════════════════════════════════════════════════════════

  _setupSearchInput() {
    const input = this.element?.querySelector('.ncm-gm-search-input');
    if (!input) return;

    const handler = this._boundSearchHandler || (this._boundSearchHandler = this._debounce((e) => {
      this._searchQuery = e.target.value;
      this._currentPage = 1;
      this.render();
    }, 250));

    input.removeEventListener('input', handler);
    input.addEventListener('input', handler);
  }

  _setupTrustHoverPreview() {
    const bars = this.element?.querySelectorAll('.ncm-trust-bar--interactive');
    if (!bars) return;

    for (const bar of bars) {
      const segments = [...bar.querySelectorAll('.ncm-trust-seg')];
      bar.addEventListener('mouseover', (e) => {
        const seg = e.target.closest('.ncm-trust-seg');
        if (!seg) return;
        const idx = segments.indexOf(seg);
        if (idx < 0) return;
        segments.forEach((s, i) => {
          s.classList.toggle('ncm-trust-seg--preview', i <= idx);
        });
      });
      bar.addEventListener('mouseleave', () => {
        segments.forEach(s => s.classList.remove('ncm-trust-seg--preview'));
      });
    }
  }

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
   * Wire up group-by select with change event (not data-action, which fires on click).
   */
  _setupGroupBySelect() {
    const select = this.element?.querySelector('.ncm-gm-group-bar__select');
    if (!select) return;

    select.addEventListener('change', (e) => {
      this._groupBy = e.target.value;
      this._collapsedGroups.clear();
      this._currentPage = 1;
      this.render();
    });
  }

  /**
   * Wire up trust pip clicks in the per-player relationship form rows.
   */
  _setupTrustPipClicks() {
    const pips = this.element?.querySelectorAll('.ncm-rel-form-trust__pip');
    if (!pips) return;

    for (const pip of pips) {
      pip.addEventListener('click', (e) => {
        e.stopPropagation();
        const container = pip.closest('.ncm-rel-form-trust');
        if (!container) return;

        const clickedValue = parseInt(pip.dataset.pip, 10);
        const currentTrust = parseInt(container.dataset.trust, 10);

        // Toggle: click same value = clear (null), click different = set
        const newValue = clickedValue === currentTrust ? null : clickedValue;
        container.dataset.trust = newValue != null ? newValue : '';

        // Update visual state
        const allPips = [...container.querySelectorAll('.ncm-rel-form-trust__pip')];
        allPips.forEach(p => {
          const pVal = parseInt(p.dataset.pip, 10);
          const isActive = newValue != null && pVal <= newValue;
          p.classList.toggle('ncm-rel-form-trust__pip--active', isActive);
        });

        // Update trust label in the row
        const row = container.closest('.ncm-rel-form-row');
        const label = row?.querySelector('.ncm-rel-form-row__trust-label');
        if (label) {
          if (newValue != null) {
            // Check if this overrides party trust
            const trustSelect = this.element?.querySelector('[name="trust"]');
            const partyTrust = trustSelect ? parseInt(trustSelect.value, 10) : 0;
            const isOverride = newValue !== partyTrust;
            label.textContent = isOverride ? `${newValue}*` : `${newValue}`;
            label.classList.toggle('ncm-rel-form-row__trust-label--override', isOverride);
          } else {
            label.textContent = '—';
            label.classList.remove('ncm-rel-form-row__trust-label--override');
          }
        }
      });
    }
  }

  /**
   * Restore list scroll position after render.
   */
  _restoreListScroll() {
    const listScroll = this.element?.querySelector('.ncm-gm-list-scroll');
    if (listScroll && this._listScrollTop) {
      listScroll.scrollTop = this._listScrollTop;
    }

    // Track scroll for preservation
    if (listScroll) {
      listScroll.addEventListener('scroll', () => {
        this._listScrollTop = listScroll.scrollTop;
      }, { passive: true });
    }
  }

  /**
   * Wire up the role select to detect "Manage Roles..." and open the dialog.
   * Uses addEventListener('change') — data-action on <select> fires on click, not change.
   */
  _setupRoleSelectManage() {
    const select = this.element?.querySelector('.ncm-form-select--role');
    if (!select) return;

    select.addEventListener('change', (e) => {
      if (e.target.value !== '__manage_roles__') return;

      // Reset select to current contact's role (don't leave it on the action option)
      const currentRole = this._isEditing
        ? (this.masterContactService?.getContact(this._selectedContactId)?.role || 'npc')
        : 'npc';
      e.target.value = currentRole;

      // Open the role manager dialog
      const dialog = new RoleManagerDialog(this.masterContactService);
      dialog.open();
    });
  }

  _setupKeyboardShortcuts() {
    const handler = this._boundKeyHandler || (this._boundKeyHandler = (e) => {
      if (e.target.matches('input, textarea, select')) return;

      switch (e.key) {
        case '/':
          e.preventDefault();
          this.element?.querySelector('.ncm-gm-search-input')?.focus();
          break;
        case 'n': case 'N':
          e.preventDefault();
          this._selectedContactId = null;
          this._isCreating = true;
          this._isEditing = false;
          this.render();
          break;
        case 'e': case 'E':
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

  _navigateList(direction) {
    const items = [...(this.element?.querySelectorAll('.ncm-gm-list-item') || [])];
    if (!items.length) return;
    const currentIdx = items.findIndex(el => el.dataset.contactId === this._selectedContactId);
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
      this._expandedNotes.clear();
      this.render();
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Helpers
  // ═══════════════════════════════════════════════════════════

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

  static _onSelectContact(event, target) {
    const contactId = target.closest('[data-contact-id]')?.dataset.contactId;
    if (!contactId) return;

    if (this._selectedContactId === contactId && !this._isEditing) {
      this._selectedContactId = null;
    } else {
      this._selectedContactId = contactId;
    }
    this._isCreating = false;
    this._isEditing = false;
    this._expandedNotes.clear();
    this.render();
  }

  // ═══════════════════════════════════════════════════════════
  //  Action Handlers — CRUD
  // ═══════════════════════════════════════════════════════════

  static _onCreateContact(event, target) {
    this._selectedContactId = null;
    this._isCreating = true;
    this._isEditing = false;
    this.render();
  }

  static _onEditContact(event, target) {
    if (!this._selectedContactId) return;
    this._isEditing = true;
    this._isCreating = false;
    this.render();
  }

  static async _onSaveContact(event, target) {
    const form = this.element?.querySelector('.ncm-contact-form');
    if (!form) return;

    // Use direct DOM reads (Foundry's FormDataExtended unreliable for dynamic rows)
    const _val = (name) => form.querySelector(`[name="${name}"]`)?.value?.trim() || '';
    const _checked = (name) => form.querySelector(`[name="${name}"]`)?.checked ?? false;

    const data = {
      name: _val('name'),
      email: _val('email'),
      alias: _val('alias'),
      organization: _val('organization'),
      phone: _val('phone'),
      portrait: _val('portrait'),
      notes: _val('notes'),
      actorId: _val('actorId') || null,
      role: (_val('role') === '__manage_roles__' ? '' : _val('role')) || '',
      location: _val('location'),
      trust: parseInt(_val('trust'), 10) || 0,
      encrypted: _val('encrypted') === 'true',
      encryptionDV: parseInt(_val('encryptionDV'), 10) || 15,
      blackIce: _val('blackIce') === 'true',
      blackIceDamage: _val('blackIceDamage'),
      tags: (_val('tags') || '').split(',').map(t => t.trim().toUpperCase()).filter(Boolean),
      folder: _val('folder'),
    };

    if (!data.name) {
      ui.notifications.warn('Contact name is required.');
      return;
    }

    // Build relationships from per-player form rows (DOM reads)
    const relRows = form.querySelectorAll('.ncm-rel-form-row');
    if (relRows.length) {
      const relationships = {};
      for (const row of relRows) {
        const actorId = row.dataset.actorId;
        if (!actorId) continue;
        const type = row.querySelector('.ncm-rel-select')?.value || '';
        const trustContainer = row.querySelector('.ncm-rel-form-trust');
        const trustRaw = trustContainer?.dataset.trust;
        const trust = (trustRaw != null && trustRaw !== '') ? parseInt(trustRaw, 10) : null;
        const note = row.querySelector('.ncm-rel-note-input')?.value?.trim() || '';

        if (type || note || trust != null) {
          relationships[actorId] = { type: type || '', trust, note };
        }
      }
      data.relationships = relationships;
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

  static _onCancelEdit(event, target) {
    this._isCreating = false;
    this._isEditing = false;
    this.render();
  }

  // ═══════════════════════════════════════════════════════════
  //  Action Handlers — Trust / Burn / Restore
  // ═══════════════════════════════════════════════════════════

  static async _onSetTrustLevel(event, target) {
    const trustValue = parseInt(target.dataset.trustValue, 10);
    const contactId = target.dataset.contactId || this._selectedContactId;
    if (!contactId || isNaN(trustValue)) return;

    const contact = this.masterContactService?.getContact(contactId);
    if (!contact) return;

    await this.masterContactService.updateContact(contactId, { trust: trustValue });

    const label = TRUST_LABELS[trustValue] || 'UNKNOWN';
    ui.notifications.info(`Trust set to ${label} for ${contact.name}.`);

    this.soundService?.play?.('click');
    this.eventBus?.emit(EVENTS.CONTACT_TRUST_CHANGED, { contactId, trust: trustValue });
    this.render(true);
  }

  static async _onBurnContact(event, target) {
    const contactId = this._selectedContactId;
    if (!contactId) return;

    const contact = this.masterContactService?.getContact(contactId);
    if (!contact) return;

    const confirmed = await Dialog.confirm({
      title: 'Burn Contact',
      content: `
        <div style="text-align: center; padding: 8px 0;">
          <p style="color: var(--ncm-danger, #ff0033);"><i class="fas fa-fire"></i> BURN CONTACT</p>
          <p style="color: var(--ncm-text-primary, #e0e0e8);">Mark <strong>${contact.name}</strong> as compromised?</p>
          <p style="color: var(--ncm-text-muted, #555570); font-size: 11px;">Players will see burned status. Trust will drop to LOW.</p>
        </div>`,
    });

    if (!confirmed) return;

    const updates = { burned: true };
    if ((contact.trust || 0) > 1) updates.trust = 1;

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
  //  Action Handlers — Grouping / Pagination
  // ═══════════════════════════════════════════════════════════

  static _onToggleGroup(event, target) {
    const key = target.closest('[data-group-key]')?.dataset.groupKey;
    if (!key) return;

    if (this._collapsedGroups.has(key)) {
      this._collapsedGroups.delete(key);
    } else {
      this._collapsedGroups.add(key);
    }
    this.render();
  }

  static _onCollapseAll(event, target) {
    // Use precomputed group keys — covers groups on all pages, not just current DOM
    if (this._allGroupKeys?.length) {
      for (const key of this._allGroupKeys) {
        this._collapsedGroups.add(key);
      }
    }
    this.render();
  }

  static _onExpandAll(event, target) {
    this._collapsedGroups.clear();
    this.render();
  }

  static async _onCreateFolder(event, target) {
    const result = await Dialog.prompt({
      title: 'Create Folder',
      content: `
        <form class="ncm-dialog-form">
          <div class="form-group">
            <label>Folder Name</label>
            <input type="text" name="folderName" placeholder="e.g. Main Story NPCs" maxlength="40" autofocus />
          </div>
        </form>`,
      callback: (html) => html.querySelector('[name="folderName"]')?.value?.trim(),
      rejectClose: false,
    });
    if (!result) return;

    // Folder names are stored as contact.folder values — no separate storage needed
    ui.notifications.info(`Folder "${result}" created. Assign contacts via the edit form.`);
  }

  static async _onRenameFolder(event, target) {
    event.stopPropagation();
    const oldName = target.closest('[data-folder]')?.dataset.folder;
    if (!oldName) return;

    const newName = await Dialog.prompt({
      title: 'Rename Folder',
      content: `
        <form class="ncm-dialog-form">
          <div class="form-group">
            <label>New Name</label>
            <input type="text" name="folderName" value="${oldName}" maxlength="40" autofocus />
          </div>
        </form>`,
      callback: (html) => html.querySelector('[name="folderName"]')?.value?.trim(),
      rejectClose: false,
    });

    if (!newName || newName === oldName) return;

    // Rename folder on all contacts that use it
    const svc = this.masterContactService;
    const contacts = svc.getAll().filter(c => c.folder === oldName);
    for (const c of contacts) {
      await svc.updateContact(c.id, { folder: newName });
    }

    ui.notifications.info(`Renamed "${oldName}" to "${newName}" (${contacts.length} contacts updated).`);
    this.render();
  }

  static _onPrevPage(event, target) {
    if (this._currentPage > 1) {
      this._currentPage--;
      this._listScrollTop = 0;
      this.render();
    }
  }

  static _onNextPage(event, target) {
    // Guard: _prepareContext clamps page, but skip render if already at end
    this._currentPage++;
    this._listScrollTop = 0;
    this.render();
  }

  // ═══════════════════════════════════════════════════════════
  //  Action Handlers — Relationship Notes
  // ═══════════════════════════════════════════════════════════

  static _onToggleRelNote(event, target) {
    const actorId = target.closest('[data-actor-id]')?.dataset.actorId;
    if (!actorId) return;

    if (this._expandedNotes.has(actorId)) {
      this._expandedNotes.delete(actorId);
    } else {
      this._expandedNotes.add(actorId);
    }
    this.render();
  }

  // ═══════════════════════════════════════════════════════════
  //  Action Handlers — Push / Share
  // ═══════════════════════════════════════════════════════════

  static async _onPushToPlayer(event, target) {
    const actorId = this.element?.querySelector('[name="pushTargetActor"]')?.value;
    const contactId = this._selectedContactId;
    if (!actorId || !contactId) {
      ui.notifications.warn('Select a character to share with.');
      return;
    }

    const includePortrait = this.element?.querySelector('[name="pushIncludePortrait"]')?.checked ?? true;
    const result = await this.masterContactService.pushToPlayer(contactId, actorId, { includePortrait });

    if (result.success) {
      const contact = this.masterContactService.getContact(contactId);
      const actor = game.actors.get(actorId);
      ui.notifications.info(`${contact?.name} shared to ${actor?.name}'s contacts.`);
      this.soundService?.play?.('click');
    } else {
      ui.notifications.error(result.error || 'Failed to share contact.');
    }
  }

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
            role: c.role || c.type || '',
            location: c.location || '',
            tags: c.tags || [],
            notes: c.notes || '',
            trust: c.trust ?? 3,
            relationships: c.relationships || {},
            folder: c.folder || '',
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

  static async _onLinkActor(event, target) {
    const contactId = this._selectedContactId;
    if (!contactId) return;

    const contact = this.masterContactService?.getContact(contactId);
    if (!contact) return;

    const actors = game.actors.map(a => ({
      id: a.id, name: a.name, img: a.img,
      isPlayer: a.hasPlayerOwner,
      ownerName: a.hasPlayerOwner
        ? Object.entries(a.ownership || {}).reduce((name, [uid, level]) => {
            if (uid !== 'default' && level === CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER) {
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
      <p style="font-size:9px;color:#8888a0;margin-top:6px;">Currently linked: <strong>${currentLinked}</strong></p>`;

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

  static async _onUploadPortrait(event, target) {
    event.stopPropagation();
    const contactId = this._selectedContactId;
    if (!contactId) return;

    const fp = new FilePicker({
      type: 'image',
      current: '',
      callback: async (path) => {
        if (!path) return;
        let finalPath = path;
        if (this.portraitService?.processImage) {
          try { finalPath = await this.portraitService.processImage(path); }
          catch (err) { log.warn('PortraitService processing failed, using raw path:', err); }
        }
        await this.masterContactService.updateContact(contactId, { portrait: finalPath });
        this.render();
      },
    });
    fp.browse();
  }

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

  static _onToggleTagFilter(event, target) {
    event.stopPropagation();
    const tag = target.closest('[data-tag]')?.dataset.tag?.toUpperCase();
    if (!tag) return;

    if (this._activeTagFilters.includes(tag)) {
      this._activeTagFilters = this._activeTagFilters.filter(t => t !== tag);
    } else {
      this._activeTagFilters.push(tag);
    }
    this._currentPage = 1;
    this.render();
  }

  static _onClearTagFilters(event, target) {
    this._activeTagFilters = [];
    this._orgFilter = '';
    this._currentPage = 1;
    this.render();
  }

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

  static _onSendAsContact(event, target) {
    const contactId = this._selectedContactId;
    if (!contactId) return;
    const contact = this.masterContactService?.getContact(contactId);
    if (!contact) return;

    if (game.nightcity?.composeMessage) {
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

  static _onOpenContactInbox(event, target) {
    const contactId = this._selectedContactId;
    if (!contactId) return;
    const contact = this.masterContactService?.getContact(contactId);
    if (!contact) return;

    const inboxId = contact.actorId || contactId;
    if (game.nightcity?.openInbox) {
      game.nightcity.openInbox(inboxId);
    } else {
      const viewerClass = game.nightcity?.MessageViewerApp;
      if (viewerClass) {
        new viewerClass({ actorId: inboxId }).render(true);
      } else {
        ui.notifications.warn('Message viewer not available.');
      }
    }
  }

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
