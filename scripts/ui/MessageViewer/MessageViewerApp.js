/**
 * Message Viewer Application
 * @file scripts/ui/MessageViewer/MessageViewerApp.js
 * @module cyberpunkred-messenger
 * @description Inbox window: message list (filterable, sortable, paginated),
 *   message detail panel, and quick-reply bar.
 *
 *   Sprint 2A changes:
 *     - _toggleDropdown() updated for new container classes (.ncm-network-badge, .ncm-tab-control)
 *     - _onDelegatedClick() adds 'close-window' action, fixes bulk action case names
 *     - _prepareContext() unchanged — already provides all data the new template needs
 *
 *   Sprint 2B changes:
 *     - Import getSecurityStripData, classifyAttachments, getFileIcon from designHelpers
 *     - _getEnrichedMessage() adds security strip data, classified attachments
 *     - _onDelegatedClick() adds breach-attachment, gm-force-breach, open-attachment handlers
 *     - New methods: _breachAttachment(), _gmForceBreachAttachment(), _openAttachment()
 *
 *   Sprint 2C changes:
 *     - Import getAvatarColor, getNetworkThemeClass, getNetworkAccentColor, getThreatBadgeData
 *     - _enrichMessageDisplay() adds avatarColor, networkThemeClass, networkAccentColor,
 *       showNetworkBadge, networkBadgeLabel, networkBadgeVariant, threatBadge
 *     - _enrichMessages() passes currentNetworkName for network badge visibility logic
 */

import { BaseApplication } from '../BaseApplication.js';
import { NetworkAuthDialog } from '../NetworkManagement/NetworkAuthDialog.js';
import {
  computeSignalBar,
  getInitials,
  getPriorityBadgeVariant,
  getSecurityStripData,
  classifyAttachments,
  getFileIcon,
  getAvatarColor,
  getNetworkThemeClass,
  getNetworkAccentColor,
  getThreatBadgeData,
} from '../../utils/designHelpers.js';
import { EVENTS, SOCKET_OPS } from '../../utils/constants.js';
import { formatCyberDate } from '../../utils/helpers.js';

const MODULE_ID = 'cyberpunkred-messenger';
const MESSAGES_PER_PAGE = 25;
const DEBOUNCE_SEARCH_MS = 250;
const MIN_SIDEBAR_WIDTH = 200;
const MAX_SIDEBAR_WIDTH = 600;
const DEFAULT_SIDEBAR_WIDTH = 300;
const DIVIDER_RESET_WIDTH = DEFAULT_SIDEBAR_WIDTH;

const QUICK_REPLIES_DEFAULT = ['ACK', 'WILCO', 'NEGATIVE', 'On my way', 'Hold position'];

const SORT_LABELS = {
  newest: 'Newest',
  oldest: 'Oldest',
  unread: 'Unread',
  sender: 'Sender',
  priority: 'Priority',
};

const PRIORITY_ORDER = { critical: 0, urgent: 1, normal: 2 };

/**
 * Derive network pill color state from signal strength.
 * @param {number} signal — 0–100
 * @param {boolean} isDead — Dead zone flag
 * @returns {'strong'|'good'|'weak'|'critical'|'dead'}
 */
function getNetPillState(signal, isDead) {
  if (isDead || signal <= 0) return 'dead';
  if (signal < 25) return 'critical';
  if (signal < 50) return 'weak';
  if (signal < 80) return 'good';
  return 'strong';
}

/**
 * Derive primaryTab from the currentFilter value.
 * Message filters (inbox, unread, sent, saved, trash, spam) → 'messages'
 * Everything else maps directly.
 */
const MESSAGE_FILTERS = new Set(['inbox', 'unread', 'sent', 'saved', 'trash', 'spam']);
function getPrimaryTab(filter) {
  if (MESSAGE_FILTERS.has(filter)) return 'messages';
  if (filter === 'shards') return 'shards';
  if (filter === 'scheduled') return 'scheduled';
  if (filter === 'drafts') return 'drafts';
  return 'messages';
}

/**
 * Compute relative time string and recency flag from an ISO timestamp.
 * @param {string} isoTimestamp
 * @returns {{ relativeTime: string, isRecentMessage: boolean }}
 */
function computeRelativeTime(isoTimestamp) {
  if (!isoTimestamp) return { relativeTime: '', isRecentMessage: false };
  const now = Date.now();
  const then = new Date(isoTimestamp).getTime();
  const diff = now - then;
  if (diff < 0) return { relativeTime: 'future', isRecentMessage: false };

  const MINUTE = 60000;
  const HOUR = 3600000;
  const DAY = 86400000;

  let relativeTime;
  if (diff < MINUTE) relativeTime = 'just now';
  else if (diff < HOUR) relativeTime = `${Math.floor(diff / MINUTE)}m ago`;
  else if (diff < DAY) relativeTime = `${Math.floor(diff / HOUR)}h ago`;
  else if (diff < DAY * 7) relativeTime = `${Math.floor(diff / DAY)}d ago`;
  else relativeTime = `${Math.floor(diff / DAY)}d ago`;

  return { relativeTime, isRecentMessage: diff < HOUR };
}

/**
 * Build a 3-char network pip label from a network name.
 * E.g. "DARKNET" → "DRK", "CORPNET" → "CRP", "CITINET" → "CIT"
 */
function getNetPipLabel(name) {
  if (!name) return '';
  const upper = name.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (upper.length <= 3) return upper;
  // Take first, middle, last consonant-rich chars
  return upper.substring(0, 3);
}

export class MessageViewerApp extends BaseApplication {

  /** @override */
  static DEFAULT_OPTIONS = {
    id: 'ncm-message-viewer',
    classes: ['ncm-app', 'ncm-message-viewer-window'],
    position: { width: 880, height: 600 },
    window: {
      title: 'Night City Messenger',
      icon: 'fas fa-satellite-dish',
      resizable: true,
      minimizable: true,
    },
    actions: {},
  };

  static PARTS = {
    viewer: {
      template: `modules/${MODULE_ID}/templates/message-viewer/message-viewer.hbs`,
    },
  };

  // ─────────────── Instance State (per-window, not global) ───────────────

  /** @type {string|null} ID of the currently viewing actor */
  actorId = null;

  /** @type {string|null} Currently selected message ID */
  selectedMessageId = null;

  /** @type {string} Active category filter */
  currentFilter = 'inbox';

  /** @type {string} Active sort mode */
  currentSort = 'newest';

  /** @type {number} Current page */
  currentPage = 1;

  /** @type {string} Search term */
  searchTerm = '';

  /** @type {boolean} Whether search bar is expanded */
  searchActive = false;

  /** @type {string|null} Network filter */
  networkFilter = null;

  /** @type {string} Density mode: compact | normal | comfortable */
  density = 'normal';

  /** @type {Array} Cached contacts for synchronous _findContact lookups */
  _cachedContacts = [];

  /** @type {number} Sidebar width in pixels */
  sidebarWidth = DEFAULT_SIDEBAR_WIDTH;

  /** @type {boolean} Whether the message list panel is collapsed */
  _listCollapsed = false;

  /** @type {Set<string>} IDs of bulk-selected messages */
  bulkSelected = new Set();

  /** @type {Array|null} Cached messages from last load */
  _cachedMessages = null;

  /** @type {Array<string>} Message IDs on current page, for keyboard navigation */
  _lastPaginatedIds = [];

  /** @type {number|null} Search debounce timer */
  _searchDebounce = null;

  // ─────────────── Service Accessors ───────────────

  get messageService() { return game.nightcity?.messageService; }
  get contactRepository() { return game.nightcity?.contactRepository; }
  get networkService() { return game.nightcity?.networkService; }
  get timeService() { return game.nightcity?.timeService; }
  get soundService() { return game.nightcity?.soundService; }
  get stateManager() { return game.nightcity?.stateManager; }
  get messageAccessService() { return game.nightcity?.messageAccessService; }
  get iceService() { return game.nightcity?.iceService; }

  // ═══════════════════════════════════════════════════════════
  //  Lifecycle
  // ═══════════════════════════════════════════════════════════

  constructor(options = {}) {
    super(options);
    this.actorId = options.actorId || game.user?.character?.id || null;
    this._loadPreferences();
    this._setupEventSubscriptions();
  }

  /**
   * @override Save scroll position before every re-render.
   * Covers selectMessage, EventBus-triggered renders, filter changes, etc.
   */
  async render(options) {
    this._saveScrollPosition();
    return super.render(options);
  }

  // ═══════════════════════════════════════════════════════════
  //  Helper Utilities
  // ═══════════════════════════════════════════════════════════

  _getViewingAsName() {
    if (!this.actorId) return 'Unknown';
    const actor = game.actors?.get(this.actorId);
    if (actor) return actor.name;
    // Virtual inbox — check master contacts
    const contact = game.nightcity?.masterContactService?.getContact(this.actorId);
    return contact?.name || 'Unknown';
  }

  /**
   * Look up a contact by email address from the viewer owner's contact list.
   * Uses a cached contact list to avoid async in render paths.
   * @param {string} address — Email address to search
   * @returns {object|null} Contact data or null
   */
  _findContact(address) {
    if (!address || !this._cachedContacts) return null;
    const normalized = address.toLowerCase();
    return this._cachedContacts.find(c =>
      c.email?.toLowerCase() === normalized
    ) || null;
  }

  /**
   * Refresh the cached contact list for the viewer's owner.
   * Called during _prepareContext before any _findContact calls.
   */
  async _refreshContactCache() {
    if (!this.actorId || !this.contactRepository) {
      this._cachedContacts = [];
      return;
    }
    try {
      this._cachedContacts = await this.contactRepository.getContacts(this.actorId) || [];
    } catch {
      this._cachedContacts = [];
    }
  }

  _getThemePrefs() {
    try {
      return game.nightcity?.settingsManager?.getTheme?.() || {};
    } catch {
      return {};
    }
  }

  /**
   * Save the current scroll position of the message list before re-render.
   * Restored in _onRender() via this._savedScrollTop.
   */
  _saveScrollPosition() {
    const listEl = this.element?.querySelector('.ncm-viewer__msg-list');
    if (listEl) {
      this._savedScrollTop = listEl.scrollTop;
    }
  }

  _loadPreferences() {
    try {
      const prefs = game.nightcity?.settingsManager?.getInboxPrefs?.(this.actorId);
      if (prefs) {
        this.density = prefs.density || 'normal';
        this.currentSort = prefs.sort || 'newest';
        this.sidebarWidth = prefs.sidebarWidth || DEFAULT_SIDEBAR_WIDTH;
      }
    } catch { /* defaults are fine */ }
  }

  _savePreferences() {
    try {
      game.nightcity?.settingsManager?.setInboxPrefs?.(this.actorId, {
        density: this.density,
        sort: this.currentSort,
        sidebarWidth: this.sidebarWidth,
      });
    } catch { /* non-critical */ }
  }

  // ═══════════════════════════════════════════════════════════
  //  Network Helpers
  // ═══════════════════════════════════════════════════════════

  _getCurrentNetworkData() {
    try {
      return this.networkService?.currentNetwork || { name: 'CITINET', id: 'citinet' };
    } catch {
      return { name: 'CITINET', id: 'citinet' };
    }
  }

  _getAvailableNetworks() {
    try {
      return this.networkService?.getAvailableNetworks?.() || [];
    } catch {
      return [];
    }
  }

  /**
   * Build enriched network list for the selector dropdown.
   * Each network gets a `state` property: 'active' | 'locked' | 'unavailable'.
   * Shows ALL known networks so players can see what's unavailable in this scene.
   * @returns {{ selectorNetworks: object[], availableCount: number }}
   */
  _buildSelectorNetworks() {
    const networkService = this.networkService;
    if (!networkService) return { selectorNetworks: [], availableCount: 0 };

    const isDeadZone = networkService.isDeadZone;
    if (isDeadZone) return { selectorNetworks: [], availableCount: 0 };

    const allNetworks = networkService.getAllNetworks?.() ?? [];
    const availableIds = new Set(
      (networkService.getAvailableNetworks?.() ?? []).map(n => n.id)
    );
    const currentId = networkService.currentNetworkId;

    const typeLabels = {
      public: 'Public Subnet',
      hidden: 'Hidden Subnet',
      corporate: 'Corporate Subnet',
      government: 'Government Subnet',
      custom: 'Custom Subnet',
    };

    let availableCount = 0;

    const selectorNetworks = allNetworks.map(net => {
      const isAvailable = availableIds.has(net.id);
      const isActive = net.id === currentId;
      const requiresAuth = net.security?.requiresAuth ?? false;
      const isAuthenticated = networkService.isAuthenticated?.(net.id) ?? false;
      const isGM = game.user?.isGM ?? false;

      let state;
      if (!isAvailable) {
        state = 'unavailable';
      } else if (isActive) {
        state = 'active';
        availableCount++;
      } else if (requiresAuth && !isAuthenticated && !isGM) {
        state = 'locked';
        availableCount++;
      } else {
        state = 'available';
        availableCount++;
      }

      return {
        id: net.id,
        name: net.name,
        type: net.type,
        typeLabel: typeLabels[net.type] || 'Subnet',
        icon: net.theme?.icon ?? 'fa-wifi',
        color: net.theme?.color ?? '#19f3f7',
        theme: net.theme || {},
        signalStrength: net.signalStrength ?? 75,
        state,
        requiresAuth,
        isAuthenticated,
      };
    });

    // Sort: active first, then available, then locked, then unavailable
    const stateOrder = { active: 0, available: 1, locked: 2, unavailable: 3 };
    selectorNetworks.sort((a, b) => (stateOrder[a.state] ?? 9) - (stateOrder[b.state] ?? 9));

    return { selectorNetworks, availableCount };
  }

  _signalToLevel(strength) {
    if (strength === 0) return 'dead';
    if (strength <= 25) return 'weak';
    if (strength <= 50) return 'fair';
    return 'strong';
  }

  _deriveConnectionStatus(signal, network) {
    const isDeadZone = this.networkService?.isDeadZone ?? false;
    if (isDeadZone) return 'NO_SIGNAL';
    if (!network || signal === 0) return 'NO_SIGNAL';
    if (signal <= 30) return 'DEGRADED';
    return 'CONNECTED';
  }

  /**
   * Derive decorative latency value.
   * Not real latency — atmospheric flavor based on network type and signal.
   * @param {object} network
   * @param {number} signal — 0-100
   * @returns {number} ms
   */
  _deriveLatency(network, signal = 100) {
    if (!network) return 999;
    const base = network.effects?.messageDelay ?? 0;
    const jitter = Math.floor(Math.random() * 40) + 12;
    // Worse signal = higher latency
    const signalPenalty = Math.floor((100 - signal) * 0.8);
    return Math.max(jitter, Math.floor(base * 0.1) + jitter + signalPenalty);
  }

  /**
   * Derive decorative encryption cipher label from network security level.
   * @param {object} network
   * @returns {string}
   */
  _deriveEncryptionCipher(network) {
    if (!network) return 'NONE';
    switch (network.security?.level) {
      case 'MAXIMUM': return 'RSA-4096';
      case 'HIGH':    return 'AES-256';
      case 'LOW':     return 'XOR-128';
      case 'NONE':    return 'NONE';
      default:        return 'AES-256';
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Context Preparation
  // ═══════════════════════════════════════════════════════════

  /** @override */
  async _prepareContext(options) {
    // ── Refresh contact cache for _findContact lookups ──
    await this._refreshContactCache();

    // ── Cache custom roles for role-colored avatars ──
    this._customRoles = game.nightcity?.masterContactService?.getCustomRoles?.() || [];

    // ── Messages: load → filter → sort → paginate → enrich ──
    const allMessages = await this._loadMessages();
    const filtered = this._applyFilters(allMessages);
    const sorted = this._applySorting(filtered);
    const paginated = this._applyPagination(sorted);

    // Store paginated IDs for keyboard navigation
    this._lastPaginatedIds = paginated.map(m => m.messageId);

    // ── Actor/Contact identity for inbox header ──
    const viewingActor = this.actorId ? game.actors?.get(this.actorId) : null;
    let viewingAsName, viewingAsPortrait, viewingAsInitial, viewingAsEmail, viewingAsHandle;

    if (viewingActor) {
      viewingAsName = viewingActor.name;
      viewingAsPortrait = viewingActor.img || null;
      viewingAsInitial = getInitials(viewingActor.name || 'Unknown');
      viewingAsEmail = this.contactRepository?.getActorEmail?.(this.actorId) || '';
      viewingAsHandle = viewingActor.getFlag?.('cyberpunkred-messenger', 'emailHandle') || viewingAsName;
    } else {
      // Virtual inbox — resolve from master contact
      const masterContact = game.nightcity?.masterContactService?.getContact(this.actorId);
      viewingAsName = masterContact?.name || 'Unknown Contact';
      viewingAsPortrait = masterContact?.portrait || null;
      viewingAsInitial = getInitials(viewingAsName);
      viewingAsEmail = masterContact?.email || '';
      viewingAsHandle = viewingAsName;
    }

    // Can this user change their identity?
    const canChangeIdentity = game.user.isGM || (game.nightcity?.emailService?.canPlayerBurn?.() ?? false);

    // ── Sort options for dropdown template ──
    const sortOptions = Object.entries(SORT_LABELS).map(([id, label]) => ({
      id,
      label,
      active: id === this.currentSort,
    }));

    // ── Category counts ──
    const counts = this._computeCounts(allMessages);

    // ── Feature 6: Scheduled messages ──
    const scheduledRaw = game.nightcity?.schedulingService?.getPending?.() || [];
    const scheduledMessages = scheduledRaw
      .filter(e => e.messageData?.fromActorId === this.actorId)
      .map(e => ({
        scheduleId: e.scheduleId,
        toName: game.actors.get(e.messageData.toActorId)?.name || e.messageData.to || 'Unknown',
        subject: e.messageData.subject || '(no subject)',
        deliveryTime: e.deliveryTime || '',
        useGameTime: e.useGameTime || false,
      }));
    counts.scheduled = scheduledMessages.length;

    // ── Feature 7: Data shards (inventory + received) ──
    const shardItems = this._buildShardItems(allMessages);
    counts.shards = shardItems.length;
    const shardCounts = {
      all: shardItems.length,
      received: shardItems.filter(s => s.isReceived).length,
      inventory: shardItems.filter(s => !s.isReceived).length,
      encrypted: shardItems.filter(s => s.isEncrypted).length,
    };

    // ── Feature: Drafts ──
    const draftItems = this._buildDraftItems();
    counts.drafts = draftItems.length;

    // ── Selected message enrichment ──
    let selectedMessage = null;
    if (this.selectedMessageId) {
      selectedMessage = await this._getEnrichedMessage(this.selectedMessageId, allMessages);
    }

    // ── Network state ──
    const currentNetwork = this._getCurrentNetworkData();
    const enriched = await this._enrichMessages(paginated, currentNetwork?.name);
    const availableNetworks = this._getAvailableNetworks();
    const signalStrength = this.networkService?.signalStrength ?? 100;
    const signalLevel = this._signalToLevel(signalStrength);
    const isDeadZone = this.networkService?.isDeadZone ?? false;
    const displayNetwork = isDeadZone
      ? { name: 'NO SIGNAL', id: 'dead_zone' }
      : currentNetwork;
    const { selectorNetworks, availableCount } = this._buildSelectorNetworks();
    const currentSceneName = game.scenes?.viewed?.name || 'Unknown Area';

    // Signal bar data for design system partial
    const signalData = computeSignalBar(signalStrength);
    const signalQuality = signalData.quality;
    const signalSegments = signalData.segments;

    // Unique networks present in messages (for network filter dropdown)
    const messageNetworks = [...new Set(
      allMessages.map(m => m.network).filter(Boolean)
    )].sort();

    // ── Player preferences ──
    const themePrefs = this._getThemePrefs();
    const quickReplies = themePrefs.quickReplies || QUICK_REPLIES_DEFAULT;

    // ── HUD strip data ──
    const connectionStatus = this._deriveConnectionStatus(signalStrength, currentNetwork);
    const queuedMessageCount = this.stateManager?.get('queuedMessageCount') ?? 0;
    const encryptionCipher = this._deriveEncryptionCipher(currentNetwork);
    const latencyMs = this._deriveLatency(currentNetwork, signalStrength);

    // ── v3.2: Two-tier navigation ──
    const primaryTab = getPrimaryTab(this.currentFilter);
    const isMessagesTab = primaryTab === 'messages';

    // ── v3.2: Network pill color state + signal bars ──
    const netPillState = getNetPillState(signalStrength, isDeadZone);
    // 4-bar signal strength indicator (mockup spec: 80%+=4, 50-79%=3, 25-49%=2, 1-24%=1, 0=0)
    const activeBarCount = isDeadZone ? 0
      : signalStrength >= 80 ? 4
      : signalStrength >= 50 ? 3
      : signalStrength >= 25 ? 2
      : signalStrength > 0 ? 1 : 0;
    const netPillBars = [1, 2, 3, 4].map(i => ({ active: i <= activeBarCount }));

    // ── v3.2: Identity drawer data ──
    const viewingAsRole = viewingActor?.system?.role
      || viewingActor?.system?.lifepath?.role
      || '';
    const ownedCharacters = this._buildOwnedCharacters();

    // ── Ambient Network State Strips ──
    const netEffects = currentNetwork?.effects || {};
    const netTheme = currentNetwork?.theme || {};
    const netId = (currentNetwork?.id || '').toLowerCase();

    // Signal strip: show when degraded (<50%) but not dead
    let ambientSignalStrip = null;
    if (!isDeadZone && signalStrength < 50 && signalStrength > 0) {
      const isCritical = signalStrength < 25;
      ambientSignalStrip = {
        variant: isCritical ? 'critical' : 'weak',
        label: isCritical ? 'Critical Signal' : 'Weak Signal',
        status: isCritical ? 'CORRUPTION RISK' : `DELAY +${Math.floor((100 - signalStrength) * 3)}MS`,
        detailHint: isCritical
          ? 'Critical signal — messages may be corrupted'
          : 'Weak signal — messages may be delayed',
      };
    }

    // Darknet anonymous strip: show when on a network with anonymity: true
    const ambientDarknet = !isDeadZone && !!netEffects.anonymity;

    // Traced strip: show when on a network with traced: true
    let ambientTraced = null;
    if (!isDeadZone && netEffects.traced) {
      const color = netTheme.color || '#4488ff';
      // Parse hex to rgb for CSS rgba()
      const r = parseInt(color.slice(1,3), 16) || 68;
      const g = parseInt(color.slice(3,5), 16) || 136;
      const b = parseInt(color.slice(5,7), 16) || 255;
      const isGovnet = netId === 'govnet' || !netEffects.canRoute;
      ambientTraced = {
        color,
        rgb: `${r},${g},${b}`,
        detail: isGovnet
          ? 'Walled garden — external routing disabled · All data classified'
          : 'All traffic logged — messages, metadata, routing',
        agencyIcon: isGovnet ? 'fa-shield-halved' : 'fa-eye',
        agencyName: netEffects.tracedBy || (isGovnet ? 'NCPD/Gov' : 'NetWatch'),
      };
    }

    // Network mode for CSS data attribute (used for body effects etc.)
    const networkMode = isDeadZone ? 'dead'
      : ambientDarknet ? 'darknet'
      : ambientTraced ? 'traced'
      : 'normal';

    // ── Assemble context ──
    return {
      // Identity
      viewingAsName,
      viewingAsPortrait,
      viewingAsInitial,
      viewingAsEmail,
      viewingAsHandle,
      viewingAsRole,
      canChangeIdentity,
      isGM: game.user.isGM,

      // v3.2 Navigation
      primaryTab,
      isMessagesTab,
      netPillState,
      netPillBars,

      // v3.2 Identity Drawer
      ownedCharacters,

      // Network
      currentNetwork: displayNetwork,
      realNetwork: currentNetwork,
      availableNetworks,
      signalStrength,
      signalLevel,
      signalQuality,
      signalSegments,
      isDeadZone,
      selectorNetworks,
      availableCount,
      currentSceneName,

      // Ambient Network State Strips
      networkMode,
      ambientSignalStrip,
      ambientDarknet,
      ambientTraced,

      // HUD Strip
      connectionStatus,
      queuedMessageCount,
      encryptionCipher,
      latencyMs,
      currentGameTime: formatCyberDate(this.timeService?.getCurrentTime?.() || new Date().toISOString()),

      // Messages
      messages: enriched,
      selectedMessage,
      totalMessages: filtered.length,
      totalPages: Math.max(1, Math.ceil(filtered.length / MESSAGES_PER_PAGE)),
      currentPage: this.currentPage,

      // Filtering & Sorting
      currentFilter: this.currentFilter,
      sortOptions,
      currentSort: this.currentSort,
      sortLabel: SORT_LABELS[this.currentSort] || 'Sort',
      searchTerm: this.searchTerm,
      searchActive: this.searchActive,
      networkFilter: this.networkFilter,
      showNetworkFilter: messageNetworks.length > 1,
      messageNetworks,
      counts,

      // Active filter tags (for refinement bar tag pills)
      hasDateRange: !!(this._dateRangeFrom || this._dateRangeTo),
      dateRangeLabel: this._buildDateRangeLabel(),
      activeFilterTags: this._buildActiveFilterTags(),
      hasActiveFilters: !!(this._filterTags?.length),
      activeFilterCount: this._filterTags?.length || 0,

      // Feature 6-7: Special tab data
      scheduledMessages,
      shardItems,
      shardCounts,
      draftItems,

      // Layout
      density: this.density,
      sidebarWidth: this.sidebarWidth,
      listCollapsed: this._listCollapsed,

      // Bulk Actions
      showBulkActions: this.bulkSelected.size > 0,
      bulkCount: this.bulkSelected.size,
      allSelected: enriched.length > 0
        && enriched.every(m => this.bulkSelected.has(m.messageId)),

      // Quick Reply
      quickReplies,

      // Status Bar
      unreadCount: counts.unread || 0,
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  Event Binding
  // ═══════════════════════════════════════════════════════════

  /** @override */
  _onRender(context, options) {
    super._onRender?.(context, options);
    const html = this.element;
    if (!html) return;

    // Track current network for change detection
    this._previousNetwork = this._getCurrentNetworkData();

    // ── Scroll preservation — restore saved scroll position ──
    if (this._savedScrollTop != null) {
      const listEl = html.querySelector('.ncm-viewer__msg-list');
      if (listEl) {
        listEl.scrollTop = this._savedScrollTop;
        this._savedScrollTop = null;
      }
    }

    // Delegated click handler (bind once — element persists across renders)
    if (!this._delegatedClickBound) {
      html.addEventListener('click', (event) => this._onDelegatedClick(event));
      this._delegatedClickBound = true;
    }

    // Keyboard shortcuts (bind once — cleaned up in close())
    if (!this._keydownBound) {
      this._boundKeydown = (event) => this._onKeydown(event);
      document.addEventListener('keydown', this._boundKeydown);
      this._keydownBound = true;
    }

    // Search input
    const searchInput = html.querySelector('.ncm-viewer__search-input');
    if (searchInput && !searchInput._ncmBound) {
      searchInput.addEventListener('input', (event) => this._onSearchInput(event));
      searchInput.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') this._toggleSearch();
      });
      searchInput._ncmBound = true;
    }

    // Quick reply input — Enter to send
    const replyInput = html.querySelector('.ncm-viewer__quick-reply-input');
    if (replyInput && !replyInput._ncmBound) {
      replyInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          this._sendCustomReply();
        }
      });
      replyInput._ncmBound = true;
    }

    // Bypass password input — removed, now handled via NetworkAuthDialog

    // Sidebar resize
    const divider = html.querySelector('.ncm-viewer__divider');
    if (divider && !divider._ncmBound) {
      divider.addEventListener('mousedown', (event) => {
        // Don't start drag if list is collapsed or if clicking the toggle button
        if (this._listCollapsed || event.target.closest('.ncm-viewer__collapse-toggle')) return;
        this._onDividerDrag(event);
      });
      divider.addEventListener('dblclick', (event) => {
        if (event.target.closest('.ncm-viewer__collapse-toggle')) return;
        if (this._listCollapsed) {
          this._toggleListPanel();
        } else {
          this.sidebarWidth = DIVIDER_RESET_WIDTH;
          this._savePreferences();
          this.render();
        }
      });
      divider._ncmBound = true;
    }

    // Apply collapsed state from instance property (survives re-render)
    if (this._listCollapsed) {
      html.querySelector('.ncm-viewer__split')?.classList.add('ncm-viewer__split--list-collapsed');
    }

    // ── Real-time clock — tick TIME display every second ──
    if (this._clockInterval) clearInterval(this._clockInterval);
    const timeValEl = html.querySelector('.ncm-viewer__hud-time-val');
    if (timeValEl) {
      this._clockInterval = setInterval(() => {
        try {
          const now = this.timeService?.getCurrentTime?.() || new Date().toISOString();
          timeValEl.textContent = formatCyberDate(now);
        } catch { /* non-critical */ }
      }, 1000);
    }

    // Feature 4 — Self-destruct timer — see _setupDestructFill()

    // ── Network access lockout countdown — see _setupLockoutCountdown() ──

    // ── WP-6: Trace countdown timer ──
    if (this._traceTimer) clearInterval(this._traceTimer);
    const traceEl = html.querySelector('.ncm-viewer__trace-bar-timer');
    if (traceEl?.dataset.traceExpires) {
      const expiresAt = traceEl.dataset.traceExpires;
      this._traceTimer = setInterval(async () => {
        const remaining = new Date(expiresAt).getTime() - Date.now();
        if (remaining <= 0) {
          clearInterval(this._traceTimer);
          this._traceTimer = null;
          traceEl.textContent = 'TRACED';
          traceEl.closest('.ncm-viewer__trace-bar')?.classList.add('ncm-viewer__trace-bar--complete');

          // Notify GM via socket
          const msg = this._getSelectedMessage();
          if (msg) {
            game.nightcity?.socketManager?.emit(SOCKET_OPS.TRACE_COMPLETE, {
              actorId: this.actorId,
              actorName: game.actors?.get(this.actorId)?.name,
              messageId: msg.messageId,
              network: msg.network,
              scene: game.scenes?.viewed?.name,
            });
            // Mark trace complete
            await this.messageService?.updateMessageFlags?.(this.actorId, msg.messageId, {
              traceCompleted: true,
            });
            ui.notifications.error('NCM | TRACE COMPLETE — Your location has been logged.');
          }
          return;
        }
        const m = Math.floor(remaining / 60000);
        const s = Math.floor((remaining % 60000) / 1000);
        traceEl.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
      }, 1000);
    }

    // ── Keyboard navigation: scroll selected message into view ──
    if (this._scrollToMessageId) {
      const scrollTargetId = this._scrollToMessageId;
      this._scrollToMessageId = null;
      const el = html.querySelector(`[data-message-id="${scrollTargetId}"]`);
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    // ── Search: restore focus + cursor after render ──
    if (this._restoreSearchFocus) {
      const { value, cursorPos } = this._restoreSearchFocus;
      this._restoreSearchFocus = null;
      const input = html.querySelector('.ncm-viewer__search-input');
      if (input) {
        input.value = value;
        input.focus();
        const pos = Math.min(cursorPos, value.length);
        input.setSelectionRange(pos, pos);
      }
    }

    // ── Category pills: slide-in after tab switch ──
    if (this._pillsSlideFrom) {
      const direction = this._pillsSlideFrom;
      this._pillsSlideFrom = null;
      const track = html.querySelector('.ncm-viewer__pills-track');
      if (track) {
        // Start at offset position (no transition)
        track.classList.add(`ncm-viewer__pills-track--enter-${direction}`);
        // Next frame: enable transition and slide to center
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            track.classList.remove(`ncm-viewer__pills-track--enter-${direction}`);
            track.classList.add('ncm-viewer__pills-track--enter-active');
            // Clean up class after animation
            setTimeout(() => track.classList.remove('ncm-viewer__pills-track--enter-active'), 350);
          });
        });
      }
    }

    // ── Ambient Strip Animations ──
    this._setupAmbientAnimations(html);

    // ── Destruct bar fill percentage ──
    this._setupDestructFill(html);

    // ── Lockout timer (redesigned) ──
    this._setupLockoutCountdown(html);
  }

  /**
   * Set up ambient network strip animations — scramble text, relay hops, waveform.
   * All intervals stored for cleanup in close().
   * @param {HTMLElement} html — Root element
   */
  _setupAmbientAnimations(html) {
    // Clean up previous intervals
    if (this._ambientIntervals) {
      this._ambientIntervals.forEach(id => clearInterval(id));
    }
    if (this._ambientRAF) cancelAnimationFrame(this._ambientRAF);
    this._ambientIntervals = [];

    // ── Scramble text (darknet anonymous strip) ──
    const scrambleEl = html.querySelector('.ncm-viewer__anon-strip-scramble');
    if (scrambleEl) {
      const GLITCH = '░▒▓█▌▐╔╗╚╝║═╬┼▄▀■□';
      const id = setInterval(() => {
        let r = '';
        for (let i = 0; i < 6; i++) r += GLITCH[Math.floor(Math.random() * GLITCH.length)];
        scrambleEl.textContent = r;
      }, 800);
      this._ambientIntervals.push(id);
    }

    // ── Relay hop animation (darknet) ──
    const hops = html.querySelectorAll('.ncm-viewer__anon-strip-hop');
    if (hops.length) {
      let current = 0;
      const id = setInterval(() => {
        hops.forEach((h, i) => h.classList.toggle('ncm-viewer__anon-strip-hop--active', i === current));
        current = (current + 1) % hops.length;
      }, 600);
      this._ambientIntervals.push(id);
    }

    // ── Signal waveform animation (SVG path) ──
    const wavePath = html.querySelector('.ncm-viewer__signal-wave-path');
    if (wavePath) {
      const isCritical = html.querySelector('.ncm-viewer__signal-strip--critical');
      const animate = () => {
        const pts = [];
        const w = 200, mid = 6;
        if (isCritical) {
          // EKG-style: long flatlines with sharp spikes
          let x = 0;
          while (x <= w) {
            if (Math.random() < 0.07 && x > 10 && x < w - 10) {
              pts.push(`${x},${mid}`, `${x+2},${mid-4-Math.random()*2}`,
                `${x+4},${mid+4+Math.random()*2}`, `${x+6},${mid}`);
              x += 8;
            } else {
              pts.push(`${x},${(mid + (Math.random()-0.5)*0.4).toFixed(1)}`);
              x += 3;
            }
          }
        } else {
          // Gentle sine wave with jitter
          for (let x = 0; x <= w; x += 2) {
            const y = mid + Math.sin(x * 0.08 + Date.now() * 0.002) * 2
              + (Math.random() - 0.5) * 0.8;
            pts.push(`${x},${Math.max(1, Math.min(11, y)).toFixed(1)}`);
          }
        }
        wavePath.setAttribute('d', `M${pts.join(' L')}`);
        this._ambientRAF = requestAnimationFrame(animate);
      };
      this._ambientRAF = requestAnimationFrame(animate);
    }
  }

  /**
   * Set up self-destruct fill bar width based on remaining time.
   * @param {HTMLElement} html
   */
  _setupDestructFill(html) {
    const fillEl = html.querySelector('.ncm-viewer__destruct-bar-fill');
    const timerEl = html.querySelector('.ncm-viewer__destruct-bar-timer');
    const barEl = html.querySelector('.ncm-viewer__destruct-bar');
    const labelEl = html.querySelector('.ncm-viewer__destruct-bar-label');
    if (!fillEl || !timerEl || !barEl) return;

    const msg = this._getSelectedMessage();
    if (!msg?.selfDestruct?.expiresAt) return;

    const expiresAt = new Date(msg.selfDestruct.expiresAt).getTime();
    const totalDuration = msg.selfDestruct.duration || 600000;
    let hasEscalated = false;
    let hasExpired = false;

    const updateFill = () => {
      const remaining = expiresAt - Date.now();

      if (remaining <= 0 && !hasExpired) {
        hasExpired = true;
        fillEl.style.width = '0%';
        timerEl.textContent = '00:00:00';
        barEl.classList.remove('ncm-viewer__destruct-bar--urgent');
        barEl.classList.add('ncm-viewer__destruct-bar--expired');
        if (labelEl) labelEl.textContent = 'Self-Destruct';
        clearInterval(this._destructFillTimer);
        // Trigger expiration animation
        this._playDestructExpiration(msg);
        return;
      }

      if (remaining <= 0) return;

      const pct = Math.max(0, Math.min(100, (remaining / totalDuration) * 100));
      fillEl.style.width = `${pct}%`;

      const h = Math.floor(remaining / 3600000);
      const m = Math.floor((remaining % 3600000) / 60000);
      const s = Math.floor((remaining % 60000) / 1000);
      timerEl.textContent = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;

      // Escalation: < 30 seconds remaining
      if (remaining <= 30000 && !hasEscalated) {
        hasEscalated = true;
        barEl.classList.add('ncm-viewer__destruct-bar--urgent');
        if (labelEl) labelEl.textContent = 'Self-Destruct Imminent';
        // Add red vignette to body
        const bodyEl = this.element?.querySelector('.ncm-viewer__detail-body');
        bodyEl?.classList.add('ncm-viewer__detail-body--destruct-warn');
      }
    };

    updateFill();
    if (this._destructFillTimer) clearInterval(this._destructFillTimer);
    this._destructFillTimer = setInterval(updateFill, 1000);
  }

  /**
   * Play the self-destruct expiration animation.
   * Injects a destruction overlay, blurs/dissolves the body,
   * then auto-deletes the message after the animation completes.
   * @param {object} msg — The self-destructing message
   */
  async _playDestructExpiration(msg) {
    const html = this.element;
    if (!html) return;

    const detailPanel = html.querySelector('.ncm-viewer__detail-panel');
    const bodyEl = html.querySelector('.ncm-viewer__detail-body');
    if (!detailPanel) return;

    // Add body dissolve
    bodyEl?.classList.add('ncm-viewer__detail-body--destroying');

    // Inject destruction overlay
    const overlay = document.createElement('div');
    overlay.className = 'ncm-destruct-expire';
    overlay.innerHTML = `
      <div class="ncm-destruct-expire__vignette"></div>
      <div class="ncm-destruct-expire__static"></div>
      <div class="ncm-destruct-expire__scanline"></div>
      <div class="ncm-destruct-expire__slices">
        <div class="ncm-destruct-expire__slice" style="top:12%;animation-delay:0.1s;"></div>
        <div class="ncm-destruct-expire__slice" style="top:28%;animation-delay:0.25s;"></div>
        <div class="ncm-destruct-expire__slice" style="top:45%;animation-delay:0.05s;"></div>
        <div class="ncm-destruct-expire__slice" style="top:63%;animation-delay:0.18s;"></div>
        <div class="ncm-destruct-expire__slice" style="top:78%;animation-delay:0.12s;"></div>
        <div class="ncm-destruct-expire__slice" style="top:91%;animation-delay:0.3s;"></div>
      </div>
      <div class="ncm-destruct-expire__center">
        <i class="fas fa-fire ncm-destruct-expire__icon"></i>
        <div class="ncm-destruct-expire__title">Data Destroyed</div>
        <div class="ncm-destruct-expire__sub">Self-destruct sequence complete.<br>Message permanently erased.</div>
      </div>
    `;

    detailPanel.style.position = 'relative';
    detailPanel.appendChild(overlay);

    // Trigger animation
    requestAnimationFrame(() => overlay.classList.add('ncm-destruct-expire--active'));
    this.soundService?.play?.('destruct');

    // Wait for animation, then delete and re-render
    await new Promise(r => setTimeout(r, 3000));

    // Auto-delete the message
    if (msg?.messageId) {
      await this.messageService?.deleteMessage?.(this.actorId, msg.messageId);
      ui.notifications.warn('NCM | Self-destruct message expired and deleted.');
    }

    this.selectedMessageId = null;
    overlay.remove();
    this.render();
  }

  /**
   * Set up lockout countdown for the redesigned lockout overlay.
   * @param {HTMLElement} html
   */
  _setupLockoutCountdown(html) {
    if (this._lockoutTimer) clearInterval(this._lockoutTimer);
    const timerEl = html.querySelector('.ncm-viewer__lockout-timer');
    if (!timerEl?.dataset.lockoutUntil) return;

    const until = new Date(timerEl.dataset.lockoutUntil).getTime();
    this._lockoutTimer = setInterval(async () => {
      const remaining = until - Date.now();
      if (remaining <= 0) {
        clearInterval(this._lockoutTimer);
        this._lockoutTimer = null;
        // Play access granted transition then re-render
        await this._playAccessGrantedTransition('Lockout expired — access restored...');
        this.render();
        return;
      }
      const m = Math.floor(remaining / 60000);
      const s = Math.floor((remaining % 60000) / 1000);
      timerEl.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    }, 1000);
  }

  // ═══════════════════════════════════════════════════════════
  //  Delegated Click Router
  // ═══════════════════════════════════════════════════════════

  async _onDelegatedClick(event) {
    const target = event.target.closest('[data-action]');
    if (!target) return;

    const action = target.dataset.action;
    const messageId = target.closest('[data-message-id]')?.dataset.messageId;

    switch (action) {
      // ── Navigation ──
      case 'select-message':
        this._selectMessage(messageId);
        break;
      case 'set-filter':
        this._setFilter(target.dataset.filter);
        break;
      case 'set-sort':
        this._setSort(target.dataset.sort);
        break;
      case 'toggle-sort-dropdown':
        this._toggleDropdown('.ncm-sort-dropdown', target);
        break;
      case 'toggleNetworkSelector':
        this._toggleNetworkSelector(target);
        break;
      case 'toggle-network-filter':
        this._toggleDropdown('.ncm-network-filter-dropdown', target);
        break;
      case 'selectNetwork':
        this._onSelectNetwork(target.dataset.networkId);
        break;
      case 'filter-network':
        this._setNetworkFilter(target.dataset.network);
        break;
      case 'toggle-search':
        this._toggleSearch();
        break;
      case 'prev-page':
        this._setPage(this.currentPage - 1);
        break;
      case 'next-page':
        this._setPage(this.currentPage + 1);
        break;

      // ── Message Actions ──
      case 'reply-message':
        this._replyToMessage(messageId);
        break;
      case 'forward-message':
        this._forwardMessage(messageId);
        break;
      case 'delete-message':
        this._deleteMessage(messageId);
        break;
      case 'save-message':
        this._toggleSave(messageId);
        break;
      case 'mark-spam':
        this._markSpam(messageId);
        break;
      case 'share-to-chat':
        this._shareToChat(messageId);
        break;
      case 'empty-trash':
        this._emptyTrash();
        break;
      case 'empty-spam':
        this._emptySpam();
        break;
      case 'permanent-delete':
        this._permanentDelete(messageId);
        break;
      case 'restore-message':
        this._restoreMessage(messageId);
        break;

      // ── Quick Reply ──
      case 'quick-reply':
        this._sendQuickReply(target.dataset.reply);
        break;
      case 'send-reply':
        this._sendCustomReply();
        break;

      // ── Compose ──
      case 'compose-new':
      case 'compose-message':
        game.nightcity?.composeMessage?.({ fromActorId: this.actorId });
        break;

      // ── Encryption (original) ──
      case 'decrypt-message':
        this._decryptMessage(messageId);
        break;
      case 'force-decrypt-message':
        this._forceDecryptMessage(messageId);
        break;

      // ── Network Access Bypass ──
      case 'bypass-password':
        this._bypassPassword(target.dataset.messageId);
        break;
      case 'bypass-skill':
        this._bypassSkill(target.dataset.messageId, target.dataset.skill);
        break;
      case 'bypass-keyitem':
        this._bypassKeyItem(target.dataset.messageId);
        break;
      case 'gm-force-reveal':
        this._gmForceReveal(target.dataset.messageId);
        break;

      // ── Network Restricted: Connect CTA → opens auth dialog ──
      case 'connect-network':
        this._connectToRestrictedNetwork(target.dataset.networkId);
        break;

      // ── Network Changed: Reconnect to old network ──
      case 'reconnect-network':
        this._connectToRestrictedNetwork(target.dataset.networkId);
        // Remove the overlay
        target.closest('.ncm-net-changed')?.remove();
        break;

      // ── Network Changed: Dismiss and go back to inbox ──
      case 'dismiss-net-changed':
        target.closest('.ncm-net-changed')?.remove();
        this.selectedMessageId = null;
        this.render();
        break;

      // ── Encrypted: Attempt Decryption (redesigned CTA) ──
      case 'attempt-decrypt':
        this._decryptMessage(target.dataset.messageId);
        break;

      // ── GM: Reset Lockout Timer ──
      case 'gm-reset-lockout':
        this._gmResetLockout(target.dataset.messageId);
        break;

      // ── Malware Actions ──
      case 'quarantine-malware':
        this._quarantineMalware(target.dataset.messageId);
        break;
      case 'analyze-malware':
        this._analyzeMalware(target.dataset.messageId);
        break;

      // ── WP-5: Signal Reconstruction ──
      case 'reconstruct-signal':
        this._reconstructSignal(target.dataset.messageId);
        break;

      // ── Feature 1: Eddies Claim ──
      case 'claim-eddies':
        this._claimEddies(target.dataset.messageId, parseInt(target.dataset.amount));
        break;

      // ── Feature 2: Encrypted Block Decrypt ──
      case 'decrypt-block':
        this._decryptBlock(target.dataset.blockKey);
        break;

      // ── Feature 6: Scheduled Messages ──
      case 'cancel-scheduled':
        this._cancelScheduled(target.dataset.scheduleId);
        break;
      case 'edit-scheduled':
        this._editScheduled(target.dataset.scheduleId);
        break;

      // ── Feature 7: Data Shards ──
      case 'open-shard':
        this._openShard(target.closest('[data-item-id]')?.dataset.itemId);
        break;
      case 'filter-shards':
        this._filterShards(target.dataset.shardFilter, target);
        break;

      // ── Drafts ──
      case 'open-draft':
        this._openDraft(target.closest('[data-actor-id]')?.dataset.actorId);
        break;
      case 'delete-draft':
        this._deleteDraft(target.closest('[data-actor-id]')?.dataset.actorId);
        break;

      // ── Sprint 2B: Attachment Actions ──
      case 'breach-attachment':
        this._breachAttachment(messageId, target.dataset.attachmentIndex);
        break;
      case 'gm-force-breach':
        this._gmForceBreachAttachment(messageId, target.dataset.attachmentIndex);
        break;
      case 'open-attachment':
        this._openAttachment(messageId, target.dataset.attachmentIndex);
        break;

      // ── Quick Wins: Add Contact from message ──
      case 'add-contact':
        this._addContactFromMessage();
        break;

      // ── Bulk Actions ──
      case 'toggle-select':
        this._toggleBulkSelect(target.dataset.messageId);
        break;
      case 'select-all':
        this._selectAll();
        break;
      case 'bulk-read':
      case 'bulk-mark-read':
        this._bulkMarkRead();
        break;
      case 'bulk-delete':
        this._bulkDelete();
        break;
      case 'bulk-cancel':
      case 'bulk-clear':
        this.bulkSelected.clear();
        this.render();
        break;
      case 'bulk-mark-spam':
        this._bulkMarkSpam();
        break;

      // ── Layout ──
      case 'toggle-density-dropdown':
        this._toggleDropdown('.ncm-density-dropdown', target);
        break;
      case 'set-density':
        this._setDensity(target.dataset.density);
        break;

      // ── Settings / Preferences ──
      case 'open-settings':
        game.nightcity?.openThemeCustomizer?.();
        break;

      // ── v3.2: Identity Drawer ──
      case 'toggle-identity-drawer':
        this._toggleIdentityDrawer();
        break;
      case 'close-identity-drawer':
        this._closeIdentityDrawer();
        break;
      case 're-login':
        game.nightcity?.reLogin?.();
        break;

      // ── v3.2: Primary Tab Navigation ──
      case 'set-primary-tab': {
        const tab = target.dataset.tab;
        const tabFilterMap = { messages: 'inbox', shards: 'shards', scheduled: 'scheduled', drafts: 'drafts' };
        const newFilter = tabFilterMap[tab] || 'inbox';

        // Determine slide direction based on tab order
        const TAB_ORDER = ['messages', 'shards', 'scheduled', 'drafts'];
        const oldTab = getPrimaryTab(this.currentFilter);
        const oldIndex = TAB_ORDER.indexOf(oldTab);
        const newIndex = TAB_ORDER.indexOf(tab);
        if (tab === oldTab) break; // Same tab, no-op

        const goingRight = newIndex > oldIndex;

        // Animate current pills out
        const track = this.element?.querySelector('.ncm-viewer__pills-track');
        if (track) {
          track.classList.add(goingRight ? 'ncm-viewer__pills-track--exit-left' : 'ncm-viewer__pills-track--exit-right');
          // After exit animation, render with new content and slide in
          this._pillsSlideFrom = goingRight ? 'right' : 'left';
          setTimeout(() => this._setFilter(newFilter), 200);
        } else {
          // No track element (e.g. scheduled/drafts tabs) — just switch immediately
          this._setFilter(newFilter);
        }
        break;
      }

      // ── v3.2: Header Actions ──
      case 'open-contacts': {
        const contactActorId = this.actorId || game.user?.character?.id;
        if (!contactActorId) {
          ui.notifications.warn('NCM | No character assigned. Cannot open contacts.');
          break;
        }
        game.nightcity?.openContacts?.(contactActorId);
        break;
      }
      case 'open-admin':
        game.nightcity?.openAdmin?.();
        break;
      case 'toggle-list-panel':
        this._toggleListPanel();
        break;

      // ── v3.2: Character Switcher ──
      case 'switch-character': {
        const newActorId = target.closest('[data-actor-id]')?.dataset.actorId;
        if (newActorId && newActorId !== this.actorId) {
          this.actorId = newActorId;
          this.selectedMessageId = null;
          this.currentPage = 1;
          this._closeIdentityDrawer();
          this.render(true);
        }
        break;
      }

      // ── v3.2: Email Save ──
      case 'change-identity': {
        const actor = game.actors.get(this.actorId);
        if (!actor) break;
        const emailService = game.nightcity?.emailService;
        if (!emailService) break;

        // If actor has an email, warn about burn first
        if (emailService.hasEmail(actor)) {
          const currentEmail = emailService.getEmail(actor);
          const confirmed = await new Promise(resolve => {
            new Dialog({
              title: 'Edit NET Identity',
              content: `<div class="ncm-burn-dialog">
                <div class="ncm-burn-dialog__heading">Change Your Identity</div>
                <div class="ncm-burn-dialog__sub">Changing your email will permanently burn your current identity. All past messages from this address will show as [BURNED].</div>
                <div class="ncm-burn-dialog__warning">
                  <i class="fas fa-triangle-exclamation ncm-burn-dialog__warning-icon"></i>
                  <div class="ncm-burn-dialog__warning-text">Your current identity <strong>${currentEmail}</strong> will be permanently burned. This cannot be undone.</div>
                </div>
                <div class="ncm-burn-dialog__current">
                  <div class="ncm-burn-dialog__current-label">Current Identity (will be burned)</div>
                  <div class="ncm-burn-dialog__current-email">${currentEmail}</div>
                </div>
                <div class="ncm-burn-dialog__consequences">
                  <div class="ncm-burn-dialog__consequence"><i class="fas fa-check ncm-burn-dialog__consequence-ok"></i> Existing messages preserved in all inboxes</div>
                  <div class="ncm-burn-dialog__consequence"><i class="fas fa-check ncm-burn-dialog__consequence-ok"></i> Old messages show sender as [BURNED]</div>
                  <div class="ncm-burn-dialog__consequence"><i class="fas fa-xmark ncm-burn-dialog__consequence-bad"></i> Cannot send or receive until re-registered</div>
                  <div class="ncm-burn-dialog__consequence ncm-burn-dialog__consequence--last"><i class="fas fa-xmark ncm-burn-dialog__consequence-bad"></i> Old handle may be claimed by another agent</div>
                </div>
              </div>`,
              buttons: {
                burn: {
                  icon: '<i class="fas fa-fire"></i>',
                  label: 'Burn & Re-register',
                  callback: () => resolve(true),
                },
                cancel: {
                  icon: '<i class="fas fa-times"></i>',
                  label: 'Cancel',
                  callback: () => resolve(false),
                },
              },
              default: 'cancel',
              close: () => resolve(false),
            }, {
              classes: ['ncm-app', 'ncm-burn-confirm'],
              width: 440,
            }).render(true);
          });
          if (!confirmed) break;

          // Burn current identity
          await emailService.burnEmail(actor, 'manual');
          ui.notifications.info(`NCM | Identity burned: ${currentEmail}`);
        }

        // Launch setup flow for re-registration
        const newEmail = await game.nightcity.openEmailSetup(actor);
        if (newEmail) {
          ui.notifications.info(`NCM | New identity registered: ${newEmail}`);
        }
        this.render();
        break;
      }

      // ── v3.2: Date Picker ──
      case 'open-date-picker': {
        const { DateRangePicker } = await import('../components/DateRangePicker.js');
        DateRangePicker.open({
          from: this._dateRangeFrom || null,
          to: this._dateRangeTo || null,
          onApply: (from, to) => {
            this._dateRangeFrom = from;
            this._dateRangeTo = to;
            this.currentPage = 1;
            this.render();
          },
          onClear: () => {
            this._dateRangeFrom = null;
            this._dateRangeTo = null;
            this.currentPage = 1;
            this.render();
          },
        });
        break;
      }

      // ── v3.2: Filter Dropdown ──
      case 'toggle-filter-dropdown': {
        // Toggle inline filter dropdown (same pattern as sort dropdown)
        const existing = this.element?.querySelector('.ncm-filter-dropdown');
        if (existing && !existing.classList.contains('ncm-hidden')) {
          existing.classList.add('ncm-hidden');
          break;
        }

        // Build dynamic content
        const networks = [...new Set(
          (await this._loadMessages()).map(m => m.network).filter(Boolean)
        )].sort();

        const container = target.closest('.ncm-viewer__filter-trigger');
        let dropdown = container?.querySelector('.ncm-filter-dropdown');
        if (!dropdown) {
          dropdown = document.createElement('div');
          dropdown.className = 'ncm-filter-dropdown ncm-hidden';
          container?.appendChild(dropdown);
        }

        // Network section
        const netItems = networks.map(n => {
          const net = this.networkService?.getNetwork?.(n);
          const name = net?.name || n;
          const color = net?.theme?.color || '#8888a0';
          const checked = this._filterTags?.includes(`net:${n}`) ? 'checked' : '';
          return `<label class="ncm-filter-dropdown__item" data-filter-tag="net:${n}">
            <span class="ncm-filter-dropdown__check ${checked ? 'ncm-filter-dropdown__check--on' : ''}" style="border-color: ${color}40; ${checked ? `background: ${color}20;` : ''}">
              ${checked ? `<i class="fas fa-check" style="color: ${color};"></i>` : ''}
            </span>
            <i class="fas ${net?.theme?.icon || 'fa-wifi'}" style="color: ${color}; font-size: 9px; width: 14px; text-align: center;"></i>
            <span class="ncm-filter-dropdown__label" style="color: ${color};">${name}</span>
          </label>`;
        }).join('');

        // Status section
        const statusItems = [
          { key: 'status:encrypted', label: 'Encrypted', icon: 'fa-lock', color: '#00D4E6' },
          { key: 'status:has-attachments', label: 'Attachments', icon: 'fa-paperclip', color: '#8888a0' },
          { key: 'status:has-eddies', label: 'Has Eddies', icon: 'fa-coins', color: '#F0C55B' },
        ].map(s => {
          const checked = this._filterTags?.includes(s.key) ? 'checked' : '';
          return `<label class="ncm-filter-dropdown__item" data-filter-tag="${s.key}">
            <span class="ncm-filter-dropdown__check ${checked ? 'ncm-filter-dropdown__check--on' : ''}" style="border-color: ${s.color}40; ${checked ? `background: ${s.color}20;` : ''}">
              ${checked ? `<i class="fas fa-check" style="color: ${s.color};"></i>` : ''}
            </span>
            <i class="fas ${s.icon}" style="color: ${s.color}80; font-size: 9px; width: 14px; text-align: center;"></i>
            <span class="ncm-filter-dropdown__label">${s.label}</span>
          </label>`;
        }).join('');

        dropdown.innerHTML = `
          <div class="ncm-filter-dropdown__section-title">Network</div>
          ${netItems || '<div class="ncm-filter-dropdown__empty">No networks</div>'}
          <div class="ncm-filter-dropdown__divider"></div>
          <div class="ncm-filter-dropdown__section-title">Status</div>
          ${statusItems}
          <div class="ncm-filter-dropdown__actions">
            <span class="ncm-filter-dropdown__btn ncm-filter-dropdown__btn--apply" data-action="apply-filters">
              <i class="fas fa-check"></i> Apply
            </span>
            <span class="ncm-filter-dropdown__btn ncm-filter-dropdown__btn--clear" data-action="clear-filters">
              <i class="fas fa-times"></i> Clear
            </span>
          </div>
        `;

        dropdown.classList.remove('ncm-hidden');

        // Toggle checkmarks on click
        dropdown.querySelectorAll('.ncm-filter-dropdown__item').forEach(item => {
          item.addEventListener('click', (e) => {
            e.stopPropagation();
            const check = item.querySelector('.ncm-filter-dropdown__check');
            const tag = item.dataset.filterTag;
            const isOn = check.classList.toggle('ncm-filter-dropdown__check--on');
            const color = check.style.borderColor.replace(/40$/, '');
            if (isOn) {
              check.style.background = check.style.borderColor.replace(/40/, '20');
              check.innerHTML = `<i class="fas fa-check" style="color: ${item.querySelector('i').style.color};"></i>`;
            } else {
              check.style.background = '';
              check.innerHTML = '';
            }
          });
        });

        // Close on outside click (one-shot)
        const closeHandler = (e) => {
          if (!dropdown.contains(e.target) && !container.contains(e.target)) {
            dropdown.classList.add('ncm-hidden');
            document.removeEventListener('mousedown', closeHandler);
          }
        };
        setTimeout(() => document.addEventListener('mousedown', closeHandler), 0);
        break;
      }

      case 'apply-filters': {
        const dropdown = this.element?.querySelector('.ncm-filter-dropdown');
        if (!dropdown) break;
        this._filterTags = [];
        dropdown.querySelectorAll('.ncm-filter-dropdown__check--on').forEach(check => {
          const item = check.closest('[data-filter-tag]');
          if (item) this._filterTags.push(item.dataset.filterTag);
        });
        dropdown.classList.add('ncm-hidden');
        this.currentPage = 1;
        this.render(true);
        break;
      }

      case 'clear-filters': {
        const dropdown = this.element?.querySelector('.ncm-filter-dropdown');
        if (dropdown) dropdown.classList.add('ncm-hidden');
        this._filterTags = [];
        this.currentPage = 1;
        this.render(true);
        break;
      }

      case 'remove-filter-tag':
        this._removeFilterTag(target.dataset.tag);
        break;
      case 'clear-date-range':
        this._clearDateRange();
        break;

      // ── v3.2: Add Contact from detail ──
      case 'add-sender-contact': {
        const email = target.dataset.email;
        const name = target.dataset.name;
        if (!email || !this.actorId) break;
        try {
          const repo = this.contactRepository;
          if (repo?.addContact) {
            const result = await repo.addContact(this.actorId, {
              name: name || email.split('@')[0],
              email,
              network: this._getSelectedMessage()?.network || 'CITINET',
              trust: 'neutral',
              notes: 'Added from message viewer',
            });
            if (result?.success) {
              ui.notifications.info(`NCM | Added ${name || email} to contacts.`);
              await this._refreshContactCache();
              this.render(true);
            } else {
              ui.notifications.warn(`NCM | ${result?.error || 'Could not add contact.'}`);
            }
          } else {
            ui.notifications.warn('NCM | Contact system unavailable.');
          }
        } catch (err) {
          console.error('NCM | Failed to add contact:', err);
          ui.notifications.error('NCM | Failed to add contact.');
        }
        break;
      }

      // ── v3.2: Collapsible detail grid ──
      case 'toggle-detail-grid': {
        const grid = this.element?.querySelector('.ncm-viewer__detail-grid');
        const btn = this.element?.querySelector('.ncm-viewer__detail-expand');
        if (grid) {
          grid.classList.toggle('ncm-viewer__detail-grid--collapsed');
          if (btn) btn.classList.toggle('ncm-viewer__detail-expand--open');
        }
        break;
      }

      // ── Thread ──
      case 'toggle-thread':
        this._toggleThread();
        break;

      // ── Window ──
      case 'close-window':
        this.close();
        break;
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Search
  // ═══════════════════════════════════════════════════════════

  _onSearchInput(event) {
    const value = event.target.value;
    const cursorPos = event.target.selectionStart;

    if (this._searchDebounce) clearTimeout(this._searchDebounce);

    this._searchDebounce = setTimeout(() => {
      this.searchTerm = value.trim();
      this.currentPage = 1;
      this._restoreSearchFocus = { value, cursorPos: cursorPos ?? value.length };
      this.render();
    }, DEBOUNCE_SEARCH_MS);
  }

  // ═══════════════════════════════════════════════════════════
  //  Identity Drawer
  // ═══════════════════════════════════════════════════════════

  _toggleIdentityDrawer() {
    const viewer = this.element?.querySelector('.ncm-viewer');
    if (!viewer) return;
    viewer.classList.toggle('ncm-viewer--drawer-open');
  }

  _closeIdentityDrawer() {
    const viewer = this.element?.querySelector('.ncm-viewer');
    if (!viewer) return;
    viewer.classList.remove('ncm-viewer--drawer-open');
  }

  // ═══════════════════════════════════════════════════════════
  //  Search
  // ═══════════════════════════════════════════════════════════

  _toggleSearch() {
    this.searchActive = !this.searchActive;
    this.render();

    // Focus the input after render
    if (this.searchActive) {
      requestAnimationFrame(() => {
        const input = this.element?.querySelector('.ncm-viewer__search-input');
        input?.focus();
      });
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Filtering
  // ═══════════════════════════════════════════════════════════

  _applyFilters(messages) {
    let result = [...messages];

    // Category filter
    switch (this.currentFilter) {
      case 'inbox':
        result = result.filter(m => !m.status.deleted && !m.status.spam && !m.status.sent);
        break;
      case 'unread':
        result = result.filter(m => !m.status.read && !m.status.deleted && !m.status.spam && !m.status.sent);
        break;
      case 'sent':
        result = result.filter(m => m.status.sent && !m.status.deleted);
        break;
      case 'saved':
        result = result.filter(m => m.status.saved && !m.status.deleted);
        break;
      case 'spam':
        result = result.filter(m => m.status.spam && !m.status.deleted);
        break;
      case 'trash':
        result = result.filter(m => m.status.deleted);
        break;
      case 'scheduled':
      case 'shards':
      case 'drafts':
        // These tabs have their own content — return empty message list
        result = [];
        break;
    }

    // Network filter
    if (this.networkFilter) {
      result = result.filter(m => m.network === this.networkFilter);
    }

    // Search filter
    if (this.searchTerm) {
      const term = this.searchTerm.toLowerCase();
      result = result.filter(m =>
        m.subject?.toLowerCase().includes(term) ||
        m.body?.toLowerCase().includes(term) ||
        m.from?.toLowerCase().includes(term) ||
        m.to?.toLowerCase().includes(term)
      );
    }

    // Date range filter
    if (this._dateRangeFrom) {
      const fromMs = new Date(this._dateRangeFrom).getTime();
      result = result.filter(m => m.timestamp && new Date(m.timestamp).getTime() >= fromMs);
    }
    if (this._dateRangeTo) {
      const toMs = new Date(this._dateRangeTo).getTime() + 86400000;
      result = result.filter(m => m.timestamp && new Date(m.timestamp).getTime() < toMs);
    }

    // Filter tags
    if (this._filterTags?.length) {
      for (const tag of this._filterTags) {
        if (tag.startsWith('net:')) {
          const netId = tag.substring(4);
          result = result.filter(m => m.network === netId);
        } else if (tag === 'status:encrypted') {
          result = result.filter(m => m.status?.encrypted);
        } else if (tag === 'status:has-attachments') {
          result = result.filter(m => m.attachments?.length > 0);
        } else if (tag === 'status:has-eddies') {
          result = result.filter(m => m.eddies > 0);
        }
      }
    }

    return result;
  }

  _setFilter(filter) {
    this.currentFilter = filter;
    this.currentPage = 1;
    this.selectedMessageId = null;
    this.bulkSelected.clear();
    this.render(true);
    this.soundService?.play?.('click');
  }

  _setSort(sortKey) {
    this.currentSort = sortKey;
    this.currentPage = 1;
    this._savePreferences();
    this.render();
    this.soundService?.play?.('click');
  }

  /**
   * Handle network selection from the selector dropdown.
   * If the network requires auth and the player isn't authenticated,
   * shows the NetworkAuthDialog first. On success, switches.
   * @param {string} networkId
   */
  async _onSelectNetwork(networkId) {
    if (!networkId) return;
    this._closeNetworkSelector();

    const networkService = this.networkService;
    if (!networkService) return;

    const network = networkService.getNetwork?.(networkId);
    if (!network) return;

    // Check if auth is required
    const requiresAuth = network.security?.requiresAuth ?? false;
    const isAuthenticated = networkService.isAuthenticated?.(networkId) ?? false;
    const isGM = game.user?.isGM ?? false;

    if (requiresAuth && !isAuthenticated && !isGM) {
      // Show auth dialog
      const result = await NetworkAuthDialog.show(networkId);
      if (!result.success) return; // Cancelled or failed
    }

    // Switch to the network
    const switchResult = await networkService.switchNetwork?.(networkId);
    if (switchResult?.success === false) {
      ui.notifications.warn(`NCM | Could not switch to ${network.name}: ${switchResult.reason || 'unknown error'}`);
    }

  }

  _setNetworkFilter(network) {
    this.networkFilter = network || null;
    this.currentPage = 1;
    this.render();
  }

  /**
   * Build a short label for the active date range.
   * @returns {string} e.g. "Mar 1 – Mar 15" or ""
   */
  _buildDateRangeLabel() {
    if (!this._dateRangeFrom && !this._dateRangeTo) return '';
    const fmt = (d) => {
      if (!d) return '…';
      const dt = new Date(d);
      return `${dt.toLocaleString('en', { month: 'short', timeZone: 'UTC' })} ${dt.getUTCDate()}`;
    };
    return `${fmt(this._dateRangeFrom)} – ${fmt(this._dateRangeTo)}`;
  }

  /**
   * Build enriched tag pill data from _filterTags for the refinement bar.
   * Each tag becomes { tag, label, icon, type } for the template.
   * @returns {Array<{tag: string, label: string, icon: string, type: string}>}
   */
  _buildActiveFilterTags() {
    if (!this._filterTags?.length) return [];
    return this._filterTags.map(tag => {
      if (tag.startsWith('net:')) {
        const netId = tag.substring(4);
        const net = this.networkService?.getNetwork?.(netId);
        return {
          tag,
          label: net?.name || netId,
          icon: net?.theme?.icon || 'fa-wifi',
          type: 'net',
        };
      } else if (tag === 'status:encrypted') {
        return { tag, label: 'Encrypted', icon: 'fa-lock', type: 'status' };
      } else if (tag === 'status:has-attachments') {
        return { tag, label: 'Attachments', icon: 'fa-paperclip', type: 'status' };
      } else if (tag === 'status:has-eddies') {
        return { tag, label: 'Eddies', icon: 'fa-coins', type: 'custom' };
      }
      return { tag, label: tag, icon: 'fa-tag', type: 'custom' };
    });
  }

  /**
   * Remove a single filter tag and re-render.
   * @param {string} tag — The filter tag to remove (e.g. "net:DARKNET")
   */
  _removeFilterTag(tag) {
    if (!this._filterTags?.length) return;
    this._filterTags = this._filterTags.filter(t => t !== tag);
    this.currentPage = 1;
    this.render(true);
  }

  /**
   * Clear the date range filter.
   */
  _clearDateRange() {
    this._dateRangeFrom = null;
    this._dateRangeTo = null;
    this.currentPage = 1;
    this.render(true);
  }

  // ═══════════════════════════════════════════════════════════
  //  Sorting
  // ═══════════════════════════════════════════════════════════

  _applySorting(messages) {
    const sorted = [...messages];

    switch (this.currentSort) {
      case 'newest':
        sorted.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        break;
      case 'oldest':
        sorted.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        break;
      case 'unread':
        sorted.sort((a, b) => {
          if (a.status.read === b.status.read) return new Date(b.timestamp) - new Date(a.timestamp);
          return a.status.read ? 1 : -1;
        });
        break;
      case 'sender':
        sorted.sort((a, b) => (a.from || '').localeCompare(b.from || ''));
        break;
      case 'priority':
        sorted.sort((a, b) => {
          const pa = PRIORITY_ORDER[a.priority] ?? 2;
          const pb = PRIORITY_ORDER[b.priority] ?? 2;
          if (pa !== pb) return pa - pb;
          return new Date(b.timestamp) - new Date(a.timestamp);
        });
        break;
    }

    return sorted;
  }

  // ═══════════════════════════════════════════════════════════
  //  Keyboard Shortcuts
  // ═══════════════════════════════════════════════════════════

  /**
   * Global keyboard shortcut handler.
   * Matches the footer hints:
   *   With message selected: R=Reply, F=Forward, S=Save, Del=Trash, ↑↓=Navigate
   *   Always: /=Search, N=New, ↑↓=Navigate, Enter=Select, Esc=Deselect
   *
   * Skips when focus is inside an input, textarea, or contenteditable element
   * so typing in search, quick-reply, or bypass fields works normally.
   */
  _onKeydown(event) {
    // Guard: skip if app isn't rendered or visible
    if (!this.element) return;

    // Guard: skip if typing inside an input field
    const tag = event.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || event.target.isContentEditable) return;

    // Guard: skip if the active element is inside a different Foundry application
    const activeApp = event.target.closest?.('.application, .app');
    if (activeApp && !this.element.contains(activeApp) && activeApp !== this.element) return;

    // Guard: skip if modifier keys held (allow browser/OS shortcuts)
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    const key = event.key;
    const hasSelection = !!this.selectedMessageId;
    const isMessages = getPrimaryTab(this.currentFilter) === 'messages';

    switch (key) {
      // ── Navigation ──
      case 'ArrowUp':
        event.preventDefault();
        if (isMessages) this._navigateMessages(-1);
        break;
      case 'ArrowDown':
        event.preventDefault();
        if (isMessages) this._navigateMessages(1);
        break;
      case 'Enter':
        event.preventDefault();
        if (isMessages && !hasSelection) {
          // Select first message in list
          const firstId = this._lastPaginatedIds?.[0];
          if (firstId) this._selectMessage(firstId);
        }
        break;

      // ── Actions requiring selected message ──
      case 'r':
      case 'R':
        if (hasSelection && isMessages) {
          event.preventDefault();
          this._replyToMessage(this.selectedMessageId);
        }
        break;
      case 'f':
      case 'F':
        if (hasSelection && isMessages) {
          event.preventDefault();
          this._forwardMessage(this.selectedMessageId);
        }
        break;
      case 's':
      case 'S':
        if (hasSelection && isMessages) {
          event.preventDefault();
          this._toggleSave(this.selectedMessageId);
        }
        break;
      case 'Delete':
      case 'Backspace':
        if (hasSelection && isMessages) {
          event.preventDefault();
          this._deleteMessage(this.selectedMessageId);
        }
        break;
      case 'Escape':
        if (hasSelection) {
          event.preventDefault();
          this.selectedMessageId = null;
          this.render();
        }
        break;

      // ── Global shortcuts ──
      case '/':
        event.preventDefault();
        this._focusSearch();
        break;
      case 'n':
      case 'N':
        event.preventDefault();
        game.nightcity?.composeMessage?.({ fromActorId: this.actorId });
        break;
    }
  }

  /**
   * Navigate the message list by offset (-1 = up, +1 = down).
   * Uses _lastPaginatedIds to find current position and move.
   * If no message is selected, selects the first (down) or last (up) in the page.
   */
  _navigateMessages(direction) {
    const ids = this._lastPaginatedIds;
    if (!ids?.length) return;

    let targetId;
    if (!this.selectedMessageId) {
      // No selection — pick first or last based on direction
      targetId = direction > 0 ? ids[0] : ids[ids.length - 1];
    } else {
      const currentIndex = ids.indexOf(this.selectedMessageId);
      if (currentIndex === -1) {
        targetId = ids[0];
      } else {
        const nextIndex = currentIndex + direction;
        if (nextIndex < 0 || nextIndex >= ids.length) return; // At boundary
        targetId = ids[nextIndex];
      }
    }

    if (targetId) {
      this._scrollToMessageId = targetId;
      this._selectMessage(targetId);
    }
  }

  /**
   * Focus the search input field.
   */
  _focusSearch() {
    const searchInput = this.element?.querySelector('.ncm-viewer__search-input');
    if (searchInput) {
      searchInput.focus();
      searchInput.select();
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Pagination
  // ═══════════════════════════════════════════════════════════

  _applyPagination(messages) {
    const start = (this.currentPage - 1) * MESSAGES_PER_PAGE;
    return messages.slice(start, start + MESSAGES_PER_PAGE);
  }

  _setPage(page) {
    const maxPage = Math.max(1, Math.ceil((this._cachedMessages?.length || 0) / MESSAGES_PER_PAGE));
    this.currentPage = Math.max(1, Math.min(page, maxPage));
    this.render();
  }

  // ═══════════════════════════════════════════════════════════
  //  Message Selection
  // ═══════════════════════════════════════════════════════════

  async _selectMessage(messageId) {
    if (!messageId) return;
    this.selectedMessageId = messageId;
    this.render();

    // Mark as read
    this.messageService?.markAsRead?.(this.actorId, messageId);
    this.soundService?.play?.('click');

    // WP-6 — Trace: start countdown for traced network messages on first open
    if (!game.user?.isGM) {
      const msg = this._cachedMessages?.find(m => m.messageId === messageId);
      if (msg?.network && !msg.status?.sent && !msg.traceStarted && !msg.traceCompleted) {
        const network = this.networkService?.getNetwork?.(msg.network);
        if (network?.effects?.traced) {
          const traceWindow = network.traceWindow ?? 180000; // 3 minutes default
          const traceExpiresAt = new Date(Date.now() + traceWindow).toISOString();
          await this.messageService?.updateMessageFlags?.(this.actorId, messageId, {
            traceStarted: new Date().toISOString(),
            traceExpiresAt,
          });
          // Update local cache so re-render picks it up
          if (msg) {
            msg.traceStarted = new Date().toISOString();
            msg.traceExpiresAt = traceExpiresAt;
          }
          this.render();
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Bulk Selection
  // ═══════════════════════════════════════════════════════════

  _toggleBulkSelect(messageId) {
    if (this.bulkSelected.has(messageId)) {
      this.bulkSelected.delete(messageId);
    } else {
      this.bulkSelected.add(messageId);
    }
    this.render();
  }

  _selectAll() {
    if (!this._cachedMessages) return;
    const allIds = this._cachedMessages.map(m => m.messageId);
    const allSelected = allIds.every(id => this.bulkSelected.has(id));

    if (allSelected) {
      this.bulkSelected.clear();
    } else {
      allIds.forEach(id => this.bulkSelected.add(id));
    }
    this.render();
  }

  async _bulkMarkRead() {
    for (const id of this.bulkSelected) {
      await this.messageService?.markAsRead?.(this.actorId, id);
    }
    this.bulkSelected.clear();
    this.render();
  }

  async _bulkDelete() {
    for (const id of this.bulkSelected) {
      await this.messageService?.deleteMessage?.(this.actorId, id);
    }
    this.bulkSelected.clear();
    this.selectedMessageId = null;
    this.render();
  }

  async _bulkMarkSpam() {
    for (const id of this.bulkSelected) {
      await this.messageService?.markSpam?.(this.actorId, id);
    }
    this.bulkSelected.clear();
    this.render();
  }

  // ═══════════════════════════════════════════════════════════
  //  Message Actions
  // ═══════════════════════════════════════════════════════════

  _replyToMessage(messageId) {
    const msg = this._getSelectedMessage();
    if (!msg) return;

    // Check if current network can route to the recipient
    const currentNet = this._getCurrentNetworkData();
    const netEffects = currentNet?.effects || {};
    if (netEffects.canRoute === false) {
      this._showReplyBlockedDialog(currentNet, msg);
      return;
    }

    game.nightcity?.composeMessage?.({
      mode: 'reply',
      fromActorId: this.actorId,
      originalMessage: msg,
    });
  }

  _forwardMessage(messageId) {
    const msg = this._getSelectedMessage();
    if (!msg) return;

    // Check if current network can route
    const currentNet = this._getCurrentNetworkData();
    const netEffects = currentNet?.effects || {};
    if (netEffects.canRoute === false) {
      this._showReplyBlockedDialog(currentNet, msg);
      return;
    }

    game.nightcity?.composeMessage?.({
      mode: 'forward',
      fromActorId: this.actorId,
      originalMessage: msg,
    });
  }

  /**
   * Show a "Cannot Route Reply" dialog when the current network
   * doesn't allow outbound routing (e.g. GOVNET walled garden).
   * @param {object} network — Current network data
   * @param {object} msg — The message being replied to
   */
  _showReplyBlockedDialog(network, msg) {
    const netName = network?.name || 'Current Network';
    const netIcon = network?.theme?.icon || 'fa-shield-halved';
    const netColor = network?.theme?.color || '#ff6600';
    const recipient = msg?.from || 'unknown';

    new Dialog({
      title: 'Cannot Route Reply',
      content: `
        <div class="ncm-hd-body" style="padding:16px;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;">
            <div style="width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:rgba(246,82,97,0.08);color:var(--ncm-primary,#F65261);font-size:11px;">
              <i class="fas fa-ban"></i>
            </div>
            <div style="font-family:'Orbitron',sans-serif;font-size:10px;letter-spacing:0.12em;color:var(--ncm-primary,#F65261);text-transform:uppercase;">Cannot Route Reply</div>
          </div>
          <div style="font-size:11px;color:var(--ncm-text-secondary,#8888a0);line-height:1.7;margin-bottom:14px;">
            <strong style="color:var(--ncm-text-primary,#e0e0e8);">${netName}</strong> does not allow outbound routing to external networks.
            Your reply to <strong style="color:var(--ncm-text-primary,#e0e0e8);">${recipient}</strong> cannot be delivered on this network.
          </div>
          <div style="display:flex;align-items:center;justify-content:center;gap:0;margin-bottom:14px;">
            <div style="display:flex;flex-direction:column;align-items:center;gap:4px;">
              <div style="width:36px;height:36px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:14px;color:var(--ncm-secondary,#19f3f7);border:1px solid rgba(25,243,247,0.2);background:rgba(25,243,247,0.06);"><i class="fas fa-user"></i></div>
              <span style="font-family:'Share Tech Mono',monospace;font-size:7px;color:var(--ncm-text-muted,#555570);text-transform:uppercase;">You</span>
            </div>
            <div style="display:flex;align-items:center;gap:3px;padding:0 8px;">
              <span style="width:20px;height:1px;background:rgba(25,243,247,0.2);"></span>
              <i class="fas fa-check" style="font-size:8px;color:rgba(25,243,247,0.4);"></i>
              <span style="width:20px;height:1px;background:rgba(25,243,247,0.2);"></span>
            </div>
            <div style="display:flex;flex-direction:column;align-items:center;gap:4px;">
              <div style="width:36px;height:36px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:14px;color:${netColor};border:1px solid ${netColor}33;background:${netColor}0F;"><i class="fas ${netIcon}"></i></div>
              <span style="font-family:'Share Tech Mono',monospace;font-size:7px;color:var(--ncm-text-muted,#555570);text-transform:uppercase;">${netName}</span>
            </div>
            <div style="display:flex;align-items:center;gap:3px;padding:0 8px;">
              <span style="width:20px;height:0;border-top:1px dashed rgba(246,82,97,0.3);"></span>
              <i class="fas fa-xmark" style="font-size:10px;color:var(--ncm-primary,#F65261);"></i>
              <span style="width:20px;height:0;border-top:1px dashed rgba(246,82,97,0.3);"></span>
            </div>
            <div style="display:flex;flex-direction:column;align-items:center;gap:4px;">
              <div style="width:36px;height:36px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:14px;color:var(--ncm-text-muted,#555570);border:1px solid var(--ncm-border,#2a2a45);background:rgba(85,85,112,0.06);opacity:0.5;"><i class="fas fa-envelope"></i></div>
              <span style="font-family:'Share Tech Mono',monospace;font-size:7px;color:var(--ncm-text-muted,#555570);text-transform:uppercase;">Recipient</span>
            </div>
          </div>
          <div style="font-family:'Share Tech Mono',monospace;font-size:8px;color:var(--ncm-text-dim,#3a3a50);text-align:center;padding:8px 12px;border-top:1px solid var(--ncm-border,#2a2a45);background:rgba(10,10,15,0.3);margin:0 -16px -16px;border-radius:0 0 6px 6px;">
            <i class="fas fa-info-circle" style="margin-right:4px;"></i>
            Switch to CITINET or DARKNET to send external replies
          </div>
        </div>`,
      buttons: {
        switchNet: {
          icon: '<i class="fas fa-exchange-alt"></i>',
          label: 'Switch Network',
          callback: () => {
            // Open network selector
            const pill = this.element?.querySelector('.ncm-viewer__net-pill');
            if (pill) this._toggleNetworkSelector(pill);
          },
        },
        cancel: { icon: '<i class="fas fa-times"></i>', label: 'Cancel' },
      },
      default: 'cancel',
    }, { classes: ['dialog', 'ncm-hack-dialog', 'ncm-hd-theme-cyan'], width: 380 }).render(true);
  }

  async _deleteMessage(messageId) {
    if (!messageId) return;
    await this.messageService?.deleteMessage?.(this.actorId, messageId);
    if (this.selectedMessageId === messageId) this.selectedMessageId = null;
    this.render();
  }

  async _toggleSave(messageId) {
    if (!messageId) return;
    await this.messageService?.toggleSaved?.(this.actorId, messageId);
    this.render();
  }

  async _markSpam(messageId) {
    if (!messageId) return;
    await this.messageService?.markSpam?.(this.actorId, messageId);
    this.render();
  }

  async _restoreMessage(messageId) {
    if (!messageId) return;
    if (this.currentFilter === 'spam') {
      await this.messageService?.unmarkSpam?.(this.actorId, messageId);
    } else {
      await this.messageService?.restoreFromTrash?.(this.actorId, messageId);
    }
    this.render();
  }

  async _permanentDelete(messageId) {
    if (!messageId) return;
    const confirm = await Dialog.confirm({
      title: 'Permanently Delete',
      content: '<p>This message will be <strong>permanently deleted</strong>. This cannot be undone.</p>',
    });
    if (!confirm) return;
    await this.messageService?.permanentDelete?.(this.actorId, messageId);
    if (this.selectedMessageId === messageId) this.selectedMessageId = null;
    this.render();
  }

  async _restoreFromTrash(messageId) {
    if (!messageId) return;
    await this.messageService?.restoreFromTrash?.(this.actorId, messageId);
    this.render();
  }

  async _emptyTrash() {
    const confirm = await Dialog.confirm({
      title: 'Empty Trash',
      content: '<p>Permanently delete <strong>all messages in Trash</strong>? This cannot be undone.</p>',
    });
    if (!confirm) return;
    const result = await this.messageService?.emptyTrash?.(this.actorId);
    if (result?.count > 0) {
      ui.notifications.info(`${result.count} message(s) permanently deleted.`);
    }
    this.selectedMessageId = null;
    this.render();
  }

  async _emptySpam() {
    const confirm = await Dialog.confirm({
      title: 'Empty Spam',
      content: '<p>Permanently delete <strong>all spam messages</strong>? This cannot be undone.</p>',
    });
    if (!confirm) return;
    const result = await this.messageService?.emptySpam?.(this.actorId);
    if (result?.count > 0) {
      ui.notifications.info(`${result.count} spam message(s) permanently deleted.`);
    }
    this.selectedMessageId = null;
    this.render();
  }

  // ── Feature 1: Eddies Claim ──

  async _claimEddies(messageId, amount) {
    if (!messageId || !amount || amount <= 0) return;

    // Prevent claiming on your own sent messages
    const msg = this._getSelectedMessage();
    if (msg?.status?.sent) {
      ui.notifications.warn('Cannot claim eddies from your own sent message.');
      return;
    }

    const actor = game.actors.get(this.actorId);
    if (!actor) {
      ui.notifications.warn('No character assigned.');
      return;
    }

    // Show loading state
    const claimEl = this.element?.querySelector(`.ncm-viewer__eddies[data-message-id="${messageId}"]`);
    const progress = claimEl?.querySelector('[data-id="eddies-progress"]');
    if (claimEl) claimEl.classList.add('ncm-viewer__eddies--loading');

    // Animate progress bar
    if (progress) {
      progress.style.width = '30%';
      await new Promise(r => setTimeout(r, 300));
      progress.style.width = '70%';
      await new Promise(r => setTimeout(r, 400));
      progress.style.width = '100%';
      await new Promise(r => setTimeout(r, 300));
    }

    // Credit to actor's wealth (CPR system — deepClone + array transaction format)
    try {
      const wealth = foundry.utils.deepClone(actor.system.wealth);
      wealth.value += amount;
      const transaction = `Increased by ${amount} to ${wealth.value}`;
      const reason = `NCM: Received ${amount.toLocaleString()} eb via message`;
      wealth.transactions.push([transaction, reason]);

      if (actor.isOwner || game.user.isGM) {
        await actor.update({ 'system.wealth': wealth });
      }

      // Mark as claimed on message flags
      await this.messageService?.updateMessageFlags?.(this.actorId, messageId, {
        status: { eddiesClaimed: true, eddiesClaimedAt: formatCyberDate(this.timeService?.getCurrentTime?.() || new Date().toISOString()) },
      });

      ui.notifications.info(`${amount.toLocaleString()} eb claimed successfully.`);
      this.soundService?.play?.('receive');
    } catch (error) {
      console.error('NCM | Eddies claim failed:', error);
      ui.notifications.error('Failed to claim eddies.');
    }

    this.render();
  }

  // ── Feature 2: Encrypted Block Decrypt ──

  async _decryptBlock(blockKey) {
    if (!blockKey) return;

    if (!this._decryptedBlocks) this._decryptedBlocks = new Set();

    // Add to local set for immediate UI feedback
    this._decryptedBlocks.add(blockKey);

    // Persist to message flags so it survives re-render and app close
    // blockKey format: "messageId-blockIdx"
    const dashIdx = blockKey.lastIndexOf('-');
    const messageId = dashIdx > 0 ? blockKey.substring(0, dashIdx) : null;
    if (messageId && this.actorId) {
      try {
        const msg = this._cachedMessages?.find(m => m.messageId === messageId);
        const existing = msg?.decryptedBlocks || [];
        if (!existing.includes(blockKey)) {
          await this.messageService?.updateMessageFlags(
            this.actorId, messageId,
            { decryptedBlocks: [...existing, blockKey] }
          );
        }
      } catch (err) {
        console.warn('NCM | Failed to persist decrypted block state:', err);
      }
    }

    this.soundService?.play?.('hack-success');
    ui.notifications.info('NCM | Block decrypted.');
    this.render();
  }

  // ── Feature 6: Cancel Scheduled Message ──

  async _cancelScheduled(scheduleId) {
    if (!scheduleId) return;
    const confirm = await Dialog.confirm({
      title: 'Cancel Scheduled Message',
      content: '<p>Cancel this scheduled message? It will not be delivered.</p>',
    });
    if (!confirm) return;

    const result = await game.nightcity?.schedulingService?.cancelScheduled?.(scheduleId);
    if (result?.success) {
      ui.notifications.info('Scheduled message cancelled.');
    } else {
      ui.notifications.error(`Failed to cancel: ${result?.error || 'Unknown error'}`);
    }
    this.render();
  }

  async _editScheduled(scheduleId) {
    if (!scheduleId) return;
    const entry = game.nightcity?.schedulingService?.getScheduled?.(scheduleId);
    if (!entry) {
      ui.notifications.warn('Scheduled message not found.');
      return;
    }

    // Warn user — cancelling is permanent, they need to re-schedule after editing
    const confirm = await Dialog.confirm({
      title: 'Edit Scheduled Message',
      content: `<p>This will <strong>cancel the scheduled delivery</strong> and open the message in the composer for editing.</p>
        <p>You'll need to re-send or re-schedule after making changes.</p>`,
    });
    if (!confirm) return;

    // Cancel the pending scheduled message
    await game.nightcity?.schedulingService?.cancelScheduled?.(scheduleId);

    // Open composer pre-filled with the message data
    const msgData = entry.messageData || {};
    game.nightcity?.composeMessage?.({
      fromActorId: msgData.fromActorId || this.actorId,
      toActorId: msgData.toActorId,
      subject: msgData.subject || '',
      body: msgData.body || '',
      priority: msgData.priority || 'normal',
    });

    this.render();
  }

  // ── Feature 7: Open Data Shard ──

  _openShard(itemId) {
    if (!itemId) return;
    const item = game.items.get(itemId)
      || game.actors.get(this.actorId)?.items.get(itemId);
    if (item) {
      const actor = game.actors.get(this.actorId);
      game.nightcity?.openDataShard?.(item, { actor });
    } else {
      ui.notifications.warn('Data shard not found.');
    }
  }

  /**
   * Filter shard items by category — pure DOM manipulation, no re-render.
   * @param {string} filter — 'all' | 'received' | 'inventory' | 'encrypted'
   * @param {HTMLElement} pillEl — The clicked pill element
   */
  _filterShards(filter, pillEl) {
    const html = this.element;
    if (!html) return;

    // Toggle active pill
    html.querySelectorAll('[data-action="filter-shards"]').forEach(p =>
      p.classList.toggle('ncm-pill--active', p === pillEl)
    );

    // Show/hide shard items
    html.querySelectorAll('.ncm-viewer__shard-item').forEach(item => {
      const type = item.dataset.shardType;
      const encrypted = item.dataset.shardEncrypted === 'true';
      let show = true;
      if (filter === 'received') show = type === 'received';
      else if (filter === 'inventory') show = type === 'inventory';
      else if (filter === 'encrypted') show = encrypted;
      item.style.display = show ? '' : 'none';
    });
  }

  // ── Drafts ──

  _openDraft(actorId) {
    if (!actorId) return;
    const actor = game.actors.get(actorId);
    if (!actor) return;

    const draft = actor.getFlag('cyberpunkred-messenger', 'composerDraft');
    if (!draft) {
      ui.notifications.warn('Draft not found or expired.');
      return;
    }

    // Open composer — it will auto-restore the draft via _restoreDraft()
    game.nightcity?.composeMessage?.({ fromActorId: actorId });
  }

  async _deleteDraft(actorId) {
    if (!actorId) return;
    const actor = game.actors.get(actorId);
    if (!actor) return;

    await actor.unsetFlag('cyberpunkred-messenger', 'composerDraft').catch(() => {});
    ui.notifications.info('Draft deleted.');
    this.render();
  }

  async _shareToChat(messageId) {
    const msg = this._getSelectedMessage();
    if (!msg) return;
    await this.messageService?.shareToChat?.(msg, this.actorId);
  }

  /**
   * Quick-add the sender of the selected message as a contact.
   * Creates a new contact entry using the sender's email and display name.
   */
  async _addContactFromMessage() {
    const msg = this._getSelectedMessage();
    if (!msg?.from) return;

    const contact = this._findContact(msg.from);
    if (contact) {
      ui.notifications.info(`${msg.from} is already in your contacts.`);
      return;
    }

    const displayName = (msg.fromActorId ? game.actors?.get(msg.fromActorId)?.name : null)
      || msg.fromName || msg.from.split('@')[0] || 'Unknown';

    try {
      // Try the contact repository's add method
      const repo = this.contactRepository;
      if (repo?.addContact) {
        await repo.addContact({
          actorId: this.actorId,
          name: displayName,
          email: msg.from,
          network: msg.network || 'CITINET',
          trust: 'neutral',
          notes: `Added from message: "${msg.subject || '(no subject)'}"`,
        });
      } else if (repo?.createContact) {
        await repo.createContact({
          actorId: this.actorId,
          name: displayName,
          email: msg.from,
          network: msg.network || 'CITINET',
        });
      } else {
        ui.notifications.warn('Contact system unavailable.');
        return;
      }

      ui.notifications.info(`Added "${displayName}" (${msg.from}) to contacts.`);
      this.soundService?.play?.('receive');
      this.render();
    } catch (error) {
      console.error('NCM | Failed to add contact:', error);
      ui.notifications.error('Failed to add contact.');
    }
  }

  async _sendQuickReply(replyText) {
    if (!replyText || !this.selectedMessageId) return;
    const msg = this._getSelectedMessage();
    if (!msg) return;

    // Verify we have a reply target (actor or contact)
    if (!msg.fromActorId && !msg.fromContactId && !msg.from) {
      ui.notifications.warn('Cannot reply — no sender identity to reply to.');
      return;
    }

    try {
      const result = await this.messageService?.sendQuickReply?.(msg, this.actorId, replyText);
      if (result?.success) {
        this.soundService?.play?.('send');
        ui.notifications.info(`Reply sent: "${replyText}"`);
        setTimeout(() => this.render(), 300);
      } else {
        this.soundService?.play?.('error');
        ui.notifications.warn(`Reply failed: ${result?.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('NCM | Quick reply failed:', error);
      ui.notifications.error('Failed to send reply.');
    }
  }

  async _sendCustomReply() {
    const input = this.element?.querySelector('.ncm-viewer__quick-reply-input');
    const text = input?.value?.trim();
    if (!text) return;
    await this._sendQuickReply(text);
    if (input) input.value = '';
  }

  /**
   * Attempt to decrypt an ICE-protected message with a unique cipher-matrix animation.
   * Different from the shard hacking terminal — this is a visual decryption grid
   * with character reveals and a rotating cipher ring.
   * @param {string} messageId
   */
  async _decryptMessage(messageId) {
    if (!messageId) return;
    const html = this.element;
    if (!html) return;

    const msg = this._cachedMessages?.find(m => m.messageId === messageId)
      || (await this._getEnrichedMessage(messageId));
    const encryption = msg?.encryption || {};
    const iceName = encryption.type || 'ICE';
    const dc = encryption.dc ?? 15;

    // ── Skill + Luck Dialog ──
    const actor = game.actors?.get(this.actorId);
    if (!actor) { ui.notifications.warn('NCM | No character assigned.'); return; }

    const skillSvc = game.nightcity?.skillService;
    const allowedSkills = encryption.bypassSkills || ['Interface', 'Electronics/Security Tech'];
    const skills = skillSvc?.getAvailableSkills(actor, allowedSkills) || [];
    const availableLuck = skillSvc?.getAvailableLuck(actor) ?? 0;

    // Resolve ICE info for danger zone display
    const isLethalICE = this.iceService?.isLethalICE(encryption) ?? false;
    const iceInfo = isLethalICE ? this.iceService?.resolveICE(encryption) : null;

    const dialogResult = await this._showMessageSkillDialog({
      title: isLethalICE ? `${iceInfo?.name || 'BLACK ICE'} Decryption` : 'Message Decryption',
      icon: isLethalICE ? 'fas fa-skull-crossbones' : 'fas fa-key',
      color: isLethalICE ? '#ff0033' : '#F0C55B',
      subtitle: `Decrypting ${iceName} encryption — DV ${dc}`,
      skills,
      dc,
      availableLuck,
      actorName: actor.name,
      executeLabel: isLethalICE ? 'Risk Breach' : 'Decrypt',
      executeIcon: isLethalICE ? 'fas fa-skull-crossbones' : 'fas fa-lock-open',
      isBlackICE: isLethalICE,
      iceInfo,
      encryptionType: encryption.type,
    });
    if (!dialogResult) return; // Cancelled

    const chosenSkill = dialogResult.skill;
    const chosenLuck = dialogResult.luck;

    // Find the encrypted overlay container (re-query — DOM may have re-rendered during dialog)
    const overlay = this.element?.querySelector('.ncm-viewer__encrypted');
    if (!overlay) {
      const result = await this.messageService?.attemptDecrypt?.(messageId, this.actorId, { skillName: chosenSkill, luckSpend: chosenLuck });
      if (result?.success) this.render();
      return;
    }

    // Suppress event-driven re-renders during cipher matrix animation
    this._animationActive = true;

    // ── Build the hex character grid (8x6 = 48 cells) ──
    const GLYPHS = '0123456789ABCDEF░▒▓█╬╠╣╦╩';
    const COLS = 8, ROWS = 6;
    let gridCells = '';
    for (let i = 0; i < ROWS * COLS; i++) {
      const ch = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
      gridCells += `<span class="ncm-decrypt__cell" data-idx="${i}">${ch}</span>`;
    }

    // ── Inject Decryption Matrix UI ──
    overlay.innerHTML = `
      <div class="ncm-decrypt">
        <div class="ncm-decrypt__header">
          <div class="ncm-decrypt__header-dot"></div>
          <span class="ncm-decrypt__header-title">Decryption Matrix</span>
          <span class="ncm-decrypt__header-ice">${iceName} // DV ${dc}</span>
        </div>
        <div class="ncm-decrypt__body">
          <div class="ncm-decrypt__grid-panel">
            <div class="ncm-decrypt__grid" data-grid>${gridCells}</div>
            <div class="ncm-decrypt__grid-info">
              <span class="ncm-decrypt__grid-pct" data-pct>0%</span>
              <span class="ncm-decrypt__grid-status" data-status>ENCRYPTED</span>
            </div>
          </div>
          <div class="ncm-decrypt__key-panel">
            <div class="ncm-decrypt__ring" data-ring>
              <div class="ncm-decrypt__ring-outer"></div>
              <div class="ncm-decrypt__ring-inner"></div>
              <div class="ncm-decrypt__ring-core">
                <i class="fas fa-key"></i>
              </div>
            </div>
            <div class="ncm-decrypt__key-label" data-key-label>Analyzing cipher...</div>
            <div class="ncm-decrypt__key-log" data-key-log></div>
          </div>
        </div>
        <div class="ncm-decrypt__bar">
          <div class="ncm-decrypt__bar-fill" data-bar-fill></div>
          <span class="ncm-decrypt__bar-label" data-bar-label>Initializing...</span>
        </div>
        <div class="ncm-decrypt__result" data-result style="display:none;"></div>
      </div>
    `;

    // ── Refs ──
    const _timers = [];
    const delay = (fn, ms) => new Promise(r => { _timers.push(setTimeout(() => { fn(); r(); }, ms)); });
    const cells = overlay.querySelectorAll('.ncm-decrypt__cell');
    const pctEl = overlay.querySelector('[data-pct]');
    const statusEl = overlay.querySelector('[data-status]');
    const barFill = overlay.querySelector('[data-bar-fill]');
    const barLabel = overlay.querySelector('[data-bar-label]');
    const keyLabel = overlay.querySelector('[data-key-label]');
    const keyLog = overlay.querySelector('[data-key-log]');
    const ring = overlay.querySelector('[data-ring]');
    const resultEl = overlay.querySelector('[data-result]');

    const setBar = (pct, label) => {
      if (barFill) barFill.style.width = `${pct}%`;
      if (barLabel) barLabel.textContent = label;
    };
    const addKeyLog = (text) => {
      const s = document.createElement('div');
      s.className = 'ncm-decrypt__key-log-line';
      s.textContent = text;
      keyLog.appendChild(s);
      keyLog.scrollTop = keyLog.scrollHeight;
    };

    // Scramble animation — cells cycle random chars
    let scrambleInterval = setInterval(() => {
      cells.forEach(c => {
        if (!c.classList.contains('ncm-decrypt__cell--solved')) {
          c.textContent = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
        }
      });
    }, 100);

    // Solve cells progressively
    const solveCount = (count) => {
      const unsolved = [...cells].filter(c => !c.classList.contains('ncm-decrypt__cell--solved'));
      const toSolve = unsolved.slice(0, count);
      toSolve.forEach(c => {
        c.classList.add('ncm-decrypt__cell--solved');
        c.textContent = '0123456789ABCDEF'[Math.floor(Math.random() * 16)];
      });
      const total = [...cells].filter(c => c.classList.contains('ncm-decrypt__cell--solved')).length;
      const pct = Math.round((total / cells.length) * 100);
      if (pctEl) pctEl.textContent = `${pct}%`;
    };

    // ── Phase 1: Cipher analysis ──
    setBar(8, 'Analyzing cipher structure...');
    addKeyLog(`Target: ${iceName}`);
    await delay(() => { addKeyLog('Cipher type: polyalphabetic'); setBar(15, 'Mapping key space...'); }, 500);
    await delay(() => { solveCount(4); addKeyLog('Key length: estimated 256-bit'); setBar(25, 'Probing key rotations...'); }, 500);

    // ── Phase 2: Key rotation ──
    if (ring) ring.classList.add('ncm-decrypt__ring--spinning');
    await delay(() => { keyLabel.textContent = 'Rotating cipher keys...'; addKeyLog('Rotation 1: partial match'); solveCount(5); setBar(35, 'Matching patterns...'); }, 500);
    await delay(() => { addKeyLog('Rotation 2: frequency analysis'); solveCount(6); setBar(45, 'Frequency analysis...'); }, 400);
    await delay(() => { addKeyLog('Rotation 3: key candidate found'); solveCount(5); setBar(55, 'Testing candidate key...'); }, 400);

    // ── Phase 3: Brute force ──
    await delay(() => { keyLabel.textContent = 'Injecting key sequence...'; addKeyLog('Brute force: 2^18 combinations'); solveCount(6); setBar(65, 'Injecting key...'); }, 500);
    await delay(() => { addKeyLog('Collision detected — escalating'); solveCount(4); setBar(75, 'Escalating...'); }, 400);
    await delay(() => { setBar(85, 'Rolling dice...'); keyLabel.textContent = 'Final key injection...'; }, 300);

    // ── Phase 4: Skill check ──
    await delay(() => { addKeyLog(`Rolling ${chosenSkill}...`); setBar(90, 'Rolling...'); }, 400);

    const result = await this.messageService?.attemptDecrypt?.(messageId, this.actorId, {
      skillName: chosenSkill,
      luckSpend: chosenLuck,
    });
    const success = !!result?.success;
    const roll = result?.roll || {};
    const total = roll.total ?? '?';

    // ── Phase 5: Result ──
    clearInterval(scrambleInterval);

    if (success) {
      // Solve all remaining cells rapidly
      if (ring) ring.classList.add('ncm-decrypt__ring--cracked');
      setBar(100, 'DECRYPTED');
      if (statusEl) { statusEl.textContent = 'DECRYPTED'; statusEl.style.color = '#00ff41'; }

      // Rapid cascade solve
      const unsolved = [...cells].filter(c => !c.classList.contains('ncm-decrypt__cell--solved'));
      for (let i = 0; i < unsolved.length; i++) {
        await delay(() => {
          unsolved[i].classList.add('ncm-decrypt__cell--solved');
          unsolved[i].textContent = '0123456789ABCDEF'[Math.floor(Math.random() * 16)];
          const solved = [...cells].filter(c => c.classList.contains('ncm-decrypt__cell--solved')).length;
          if (pctEl) pctEl.textContent = `${Math.round((solved / cells.length) * 100)}%`;
        }, 30);
      }

      this.soundService?.play?.('hack-success');
      addKeyLog('██ KEY ACCEPTED ██');

      await delay(() => {
        resultEl.style.display = 'flex';
        resultEl.innerHTML = `
          <div class="ncm-decrypt__result-card ncm-decrypt__result-card--success">
            <i class="fas fa-lock-open ncm-decrypt__result-icon"></i>
            <div class="ncm-decrypt__result-title">Message Decrypted</div>
            <div class="ncm-decrypt__result-sub">${iceName} cipher broken. Content unlocked.</div>
            <div class="ncm-decrypt__result-roll">
              <span style="color:#00ff41;font-family:var(--ncm-font-title);font-size:22px;font-weight:700;">${total}</span>
              <span style="font-family:var(--ncm-font-mono);font-size:9px;color:var(--ncm-text-dim);">vs</span>
              <span style="color:var(--ncm-accent);font-family:var(--ncm-font-title);font-size:22px;font-weight:700;">${dc}</span>
            </div>
            <div class="ncm-decrypt__result-continue">Click to read message...</div>
          </div>`;
      }, 400);
    } else {
      // Cells glitch red and reset
      if (ring) ring.classList.add('ncm-decrypt__ring--rejected');
      setBar(100, 'KEY REJECTED');
      if (statusEl) { statusEl.textContent = 'KEY REJECTED'; statusEl.style.color = '#ff0033'; }

      cells.forEach(c => {
        c.classList.remove('ncm-decrypt__cell--solved');
        c.classList.add('ncm-decrypt__cell--failed');
      });
      // Re-scramble
      scrambleInterval = setInterval(() => {
        cells.forEach(c => { c.textContent = GLYPHS[Math.floor(Math.random() * GLYPHS.length)]; });
      }, 80);

      this.soundService?.play?.('hack-fail');
      addKeyLog('██ KEY REJECTED ██');

      // BLACK ICE damage on failure
      const iceDmg = result?.iceDamage;
      if (iceDmg?.damage > 0) {
        addKeyLog(`⚡ ${iceDmg.iceInfo?.name || 'BLACK ICE'} RETALIATION — ${iceDmg.damage} HP`);
        // Screen shake + red flash
        this._playBlackICEHit(iceDmg.damage);
      }

      await delay(() => {
        clearInterval(scrambleInterval);
        resultEl.style.display = 'flex';
        const dmgHtml = iceDmg?.damage > 0
          ? `<div style="margin-top:8px;padding:6px 10px;border-radius:4px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.2);text-align:center;">
              ${iceDmg.iceInfo?.img ? `<img src="${iceDmg.iceInfo.img}" style="width:24px;height:24px;border-radius:2px;border:1px solid rgba(239,68,68,0.3);vertical-align:middle;margin-right:6px;" />` : ''}
              <span style="font-family:var(--ncm-font-title);font-size:11px;color:var(--ncm-danger);letter-spacing:0.1em;">⚡ ${iceDmg.iceInfo?.name || 'BLACK ICE'}</span>
              <span style="font-family:var(--ncm-font-title);font-size:18px;color:var(--ncm-danger);font-weight:700;margin-left:6px;">-${iceDmg.damage} HP</span>
            </div>` : '';
        resultEl.innerHTML = `
          <div class="ncm-decrypt__result-card ncm-decrypt__result-card--fail">
            <i class="fas fa-shield-halved ncm-decrypt__result-icon"></i>
            <div class="ncm-decrypt__result-title">${iceDmg?.damage > 0 ? 'ICE Retaliation' : 'Decryption Failed'}</div>
            <div class="ncm-decrypt__result-sub">${iceName} cipher held. Key rejected.</div>
            <div class="ncm-decrypt__result-roll">
              <span style="color:var(--ncm-danger);font-family:var(--ncm-font-title);font-size:22px;font-weight:700;">${total}</span>
              <span style="font-family:var(--ncm-font-mono);font-size:9px;color:var(--ncm-text-dim);">vs</span>
              <span style="color:var(--ncm-accent);font-family:var(--ncm-font-title);font-size:22px;font-weight:700;">${dc}</span>
            </div>
            ${dmgHtml}
            <div class="ncm-decrypt__result-continue">Click to continue...</div>
          </div>`;
      }, iceDmg?.damage > 0 ? 1200 : 800);
    }

    await new Promise(resolve => {
      const dismiss = () => { resultEl?.removeEventListener('click', dismiss); resolve(); };
      resultEl?.addEventListener('click', dismiss);
      _timers.push(setTimeout(dismiss, 8000));
    });
    _timers.forEach(t => clearTimeout(t));
    clearInterval(scrambleInterval);
    this._animationActive = false;
    this.render();
  }

  async _forceDecryptMessage(messageId) {
    if (!messageId || !game.user.isGM) return;
    await this.messageService?.forceDecrypt?.(messageId, this.actorId);
    this.render();
  }

  // ═══════════════════════════════════════════════════════════
  //  Network Access Bypass Handlers
  // ═══════════════════════════════════════════════════════════

  async _bypassPassword(messageId) {
    const input = this.element?.querySelector(`input[name="bypassPassword"][data-message-id="${messageId}"]`);
    const password = input?.value?.trim();
    if (!password) {
      ui.notifications.warn('NCM | Enter an access code.');
      return;
    }

    const msg = this._cachedMessages?.find(m => m.messageId === messageId);
    if (!msg?.accessControl) return;

    const result = await this.messageAccessService?.attemptPasswordBypass(
      messageId, this.actorId, password, msg.accessControl
    );

    if (result?.success) {
      this.soundService?.play?.('login-success');
      ui.notifications.info('NCM | Access granted.');
    } else if (result?.lockedOut) {
      this.soundService?.play?.('lockout');
      ui.notifications.error('NCM | SYSTEM LOCKED — Too many failed attempts.');
    } else {
      this.soundService?.play?.('login-fail');
      const remaining = result?.attemptsRemaining ?? '?';
      ui.notifications.warn(`NCM | ACCESS DENIED. ${remaining} attempt(s) remaining.`);
    }

    this.render();
  }

  async _bypassSkill(messageId, skillName) {
    if (!skillName) return;

    const msg = this._cachedMessages?.find(m => m.messageId === messageId);
    if (!msg?.accessControl) return;

    const actor = game.actors?.get(this.actorId);
    if (!actor) {
      ui.notifications.warn('NCM | No character assigned.');
      return;
    }

    const result = await this.messageAccessService?.attemptSkillBypass(
      messageId, actor, skillName, msg.accessControl
    );

    if (result?.success) {
      ui.notifications.info('NCM | Access granted — bypass successful.');
    } else if (result?.lockedOut) {
      this.soundService?.play?.('lockout');
      ui.notifications.error('NCM | SYSTEM LOCKED — Too many failed attempts.');
    } else {
      ui.notifications.warn('NCM | Bypass failed.');
    }

    this.render();
  }

  async _bypassKeyItem(messageId) {
    const msg = this._cachedMessages?.find(m => m.messageId === messageId);
    if (!msg?.accessControl) return;

    const actor = game.actors?.get(this.actorId);
    if (!actor) {
      ui.notifications.warn('NCM | No character assigned.');
      return;
    }

    const result = await this.messageAccessService?.attemptKeyItemBypass(
      messageId, actor, msg.accessControl
    );

    if (result?.success) {
      const consumed = result.consumed ? ' (item consumed)' : '';
      ui.notifications.info(`NCM | Access granted via ${result.keyItem?.name}${consumed}`);
    } else {
      ui.notifications.warn(`NCM | ${result.error || 'Required access item not found in inventory.'}`);
    }

    this.render();
  }

  async _gmForceReveal(messageId) {
    if (!game.user?.isGM) return;
    await this.messageAccessService?.gmForceReveal(messageId, this.actorId);
    ui.notifications.info('NCM | Message force-revealed.');
    this.render();
  }

  /**
   * WP-5: Attempt to reconstruct a signal-degraded message via skill check.
   */
  /**
   * Signal reconstruction with animated frequency-analysis sequence.
   * Injects a waveform/signal UI into the signal-reconstruct block,
   * performs the skill check, then shows repair/fail animation.
   * @param {string} messageId
   */
  async _reconstructSignal(messageId) {
    if (!messageId) return;
    const html = this.element;

    const msg = this._cachedMessages?.find(m => m.messageId === messageId);
    if (!msg?.signalDegradation || msg.signalDegradation.reconstructed) return;

    const actor = game.actors?.get(this.actorId);
    if (!actor) {
      ui.notifications.warn('NCM | No character assigned.');
      return;
    }

    const dc = msg.signalDegradation.reconstructDC ?? 15;
    const defaultSkill = msg.signalDegradation.reconstructSkill ?? 'Electronics/Security Tech';
    const corruptPct = msg.signalDegradation.corruptionPercent ?? 30;
    const origSignal = msg.signalDegradation.originalSignal ?? 12;

    const skillSvc = game.nightcity?.skillService;
    if (!skillSvc) {
      ui.notifications.warn('NCM | Skill system not available.');
      return;
    }

    // ── Skill + Luck Dialog ──
    const allowedSkills = msg.signalDegradation.allowedSkills
      || ['Electronics/Security Tech', 'Basic Tech', 'Cybertech'];
    const skills = skillSvc.getAvailableSkills(actor, allowedSkills) || [];
    const availableLuck = skillSvc.getAvailableLuck(actor) ?? 0;

    const dialogResult = await this._showMessageSkillDialog({
      title: 'Signal Reconstruction',
      icon: 'fas fa-signal',
      color: '#FBBF24',
      subtitle: `Reconstructing ${corruptPct}% corrupted signal — DV ${dc}`,
      skills,
      dc,
      availableLuck,
      actorName: actor.name,
      executeLabel: 'Reconstruct',
      executeIcon: 'fas fa-wrench',
    });
    if (!dialogResult) return; // Cancelled

    const chosenSkill = dialogResult.skill;
    const chosenLuck = dialogResult.luck;

    // Find the reconstruct block (re-query — DOM may have re-rendered during dialog)
    const reconBlock = this.element?.querySelector('.ncm-viewer__signal-reconstruct');
    const bodyEl = this.element?.querySelector('.ncm-viewer__detail-body');
    if (!bodyEl) return;

    // Suppress event-driven re-renders during signal animation
    this._animationActive = true;

    // Inject signal analysis overlay into the body
    const overlay = document.createElement('div');
    overlay.className = 'ncm-signal-seq';
    overlay.innerHTML = `
      <div class="ncm-signal-seq__header">
        <div class="ncm-signal-seq__dot"></div>
        <span class="ncm-signal-seq__title">Signal Analysis</span>
        <span class="ncm-signal-seq__meta">${chosenSkill} // DV ${dc}</span>
      </div>
      <div class="ncm-signal-seq__viz">
        <canvas class="ncm-signal-seq__canvas" data-canvas width="480" height="100"></canvas>
        <div class="ncm-signal-seq__freq-labels">
          <span>ORIG: ${origSignal}%</span>
          <span>CORRUPT: ${corruptPct}%</span>
          <span data-boost-label>BOOST: --</span>
        </div>
      </div>
      <div class="ncm-signal-seq__log" data-log></div>
      <div class="ncm-signal-seq__bar">
        <div class="ncm-signal-seq__bar-fill" data-bar-fill></div>
        <span class="ncm-signal-seq__bar-label" data-bar-label>Initializing...</span>
      </div>
      <div class="ncm-signal-seq__result" data-result style="display:none;"></div>
    `;

    // Hide original content, show animation
    const origDisplay = bodyEl.style.display;
    bodyEl.style.display = 'none';
    bodyEl.parentNode.insertBefore(overlay, bodyEl);

    // Animation helpers
    const _timers = [];
    const delay = (fn, ms) => new Promise(r => { _timers.push(setTimeout(() => { fn(); r(); }, ms)); });
    const canvas = overlay.querySelector('[data-canvas]');
    const ctx = canvas?.getContext('2d');
    const logEl = overlay.querySelector('[data-log]');
    const barFill = overlay.querySelector('[data-bar-fill]');
    const barLabel = overlay.querySelector('[data-bar-label]');
    const boostLabel = overlay.querySelector('[data-boost-label]');
    const resultEl = overlay.querySelector('[data-result]');

    const addLog = (cls, text) => {
      const div = document.createElement('div');
      div.className = `ncm-signal-seq__log-line ncm-signal-seq__log-line--${cls}`;
      div.innerHTML = text;
      logEl.appendChild(div);
      logEl.scrollTop = logEl.scrollHeight;
    };
    const setBar = (pct, label) => {
      if (barFill) barFill.style.width = `${pct}%`;
      if (barLabel) barLabel.textContent = label;
    };

    // Waveform drawing
    let wavePhase = 0;
    let noiseLevel = 0.8; // starts very noisy
    let signalBoost = origSignal;
    let waveRAF = null;
    const drawWave = () => {
      if (!ctx) return;
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      // Grid lines
      ctx.strokeStyle = 'rgba(251,191,36,0.06)';
      ctx.lineWidth = 0.5;
      for (let y = 0; y < h; y += 20) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
      for (let x = 0; x < w; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }

      // Corrupted signal (red, fading as we reconstruct)
      ctx.beginPath();
      ctx.strokeStyle = `rgba(239,68,68,${0.3 * noiseLevel})`;
      ctx.lineWidth = 1;
      for (let x = 0; x < w; x += 2) {
        const noise = (Math.random() - 0.5) * 40 * noiseLevel;
        const y = h/2 + Math.sin((x + wavePhase) * 0.03) * 15 + noise;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Clean signal (cyan, getting stronger)
      ctx.beginPath();
      ctx.strokeStyle = `rgba(0,212,230,${0.2 + (1 - noiseLevel) * 0.6})`;
      ctx.lineWidth = 1.5;
      for (let x = 0; x < w; x += 2) {
        const y = h/2 + Math.sin((x + wavePhase) * 0.03) * 15 * (1 - noiseLevel * 0.5);
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Center line
      ctx.strokeStyle = 'rgba(251,191,36,0.08)';
      ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(0, h/2); ctx.lineTo(w, h/2); ctx.stroke();

      wavePhase += 2;
      waveRAF = requestAnimationFrame(drawWave);
    };
    drawWave();

    // ── Phase 1: Init ──
    addLog('sys', `SIGNAL ANALYSIS v4.6 — Corruption: ${corruptPct}%`);
    await delay(() => { addLog('sys', `Original signal strength: ${origSignal}%`); setBar(10, 'Scanning frequencies...'); }, 300);

    // ── Phase 2: Frequency scan ──
    await delay(() => addLog('scan', 'Scanning carrier frequency... band locked'), 400);
    await delay(() => { addLog('scan', `Noise floor: ${(corruptPct * 0.7).toFixed(0)}dB — mapping interference pattern`); setBar(25, 'Mapping interference...'); }, 500);
    await delay(() => { noiseLevel = 0.6; signalBoost = 30; boostLabel.textContent = `BOOST: ${signalBoost}%`; }, 200);
    await delay(() => { addLog('scan', 'Interference pattern isolated. Applying inverse filter...'); setBar(40, 'Filtering noise...'); }, 500);

    // ── Phase 3: Filter & boost ──
    await delay(() => { noiseLevel = 0.4; signalBoost = 55; boostLabel.textContent = `BOOST: ${signalBoost}%`; addLog('boost', 'Signal amplification: +20dB'); }, 400);
    await delay(() => { setBar(55, 'Boosting signal...'); addLog('boost', 'Error correction: Reed-Solomon active'); }, 400);
    await delay(() => { noiseLevel = 0.25; signalBoost = 70; boostLabel.textContent = `BOOST: ${signalBoost}%`; setBar(70, 'Reconstructing packets...'); }, 400);

    // ── Phase 4: Skill check ──
    const luckStr = chosenLuck > 0 ? ` + ${chosenLuck} Luck` : '';
    await delay(() => { addLog('sys', ''); addLog('roll', `<i class="fas fa-dice" style="margin-right:4px;"></i> ${chosenSkill}${luckStr} check vs DV ${dc}...`); setBar(85, 'Rolling...'); }, 400);

    const result = await skillSvc.performCheck(actor, chosenSkill, {
      dc,
      luckSpend: chosenLuck,
      flavor: `Reconstructing signal-degraded message`,
      context: 'ncm-signal-reconstruct',
    });

    const success = !!result?.success;
    const total = result?.total ?? '?';
    const dieRoll = result?.processedRoll ?? result?.rollValue ?? '?';

    await delay(() => {
      const color = success ? '#00ff41' : '#ff0033';
      addLog('roll', `Result: <span style="color:${color};font-size:13px;font-weight:700;">${total}</span> vs DV ${dc}`);
      setBar(100, success ? 'SIGNAL RESTORED' : 'RECONSTRUCTION FAILED');
    }, 400);

    // ── Phase 5: Result ──
    if (success) {
      await delay(() => {
        noiseLevel = 0.02;
        signalBoost = 98;
        boostLabel.textContent = 'BOOST: 98%';
        addLog('success', '██ SIGNAL RESTORED — Packets reconstructed ██');
      }, 500);
      this.soundService?.play?.('hack-success');

      await this.messageService?.updateMessageFlags?.(this.actorId, messageId, {
        signalDegradation: { ...msg.signalDegradation, reconstructed: true },
      });

      await delay(() => {
        resultEl.style.display = 'flex';
        resultEl.innerHTML = `
          <div class="ncm-signal-seq__result-card ncm-signal-seq__result-card--success">
            <i class="fas fa-signal ncm-signal-seq__result-icon"></i>
            <div class="ncm-signal-seq__result-title">Signal Restored</div>
            <div class="ncm-signal-seq__result-sub">Message packets reconstructed successfully.</div>
            <div class="ncm-signal-seq__result-roll">
              <span class="ncm-signal-seq__result-total" style="color:#00ff41;">${total}</span>
              <span class="ncm-signal-seq__result-vs">vs</span>
              <span class="ncm-signal-seq__result-dv">${dc}</span>
            </div>
            <div class="ncm-signal-seq__result-continue">Click to view restored message...</div>
          </div>`;
      }, 400);
    } else {
      await delay(() => {
        noiseLevel = 0.9;
        signalBoost = origSignal;
        boostLabel.textContent = `BOOST: ${origSignal}%`;
        addLog('fail', '██ RECONSTRUCTION FAILED — Signal too degraded ██');
      }, 500);
      this.soundService?.play?.('hack-fail');

      await delay(() => {
        resultEl.style.display = 'flex';
        resultEl.innerHTML = `
          <div class="ncm-signal-seq__result-card ncm-signal-seq__result-card--fail">
            <i class="fas fa-signal ncm-signal-seq__result-icon" style="opacity:0.4;"></i>
            <div class="ncm-signal-seq__result-title">Reconstruction Failed</div>
            <div class="ncm-signal-seq__result-sub">Unable to recover lost packets.</div>
            <div class="ncm-signal-seq__result-roll">
              <span class="ncm-signal-seq__result-total" style="color:var(--ncm-danger);">${total}</span>
              <span class="ncm-signal-seq__result-vs">vs</span>
              <span class="ncm-signal-seq__result-dv">${dc}</span>
            </div>
            <div class="ncm-signal-seq__result-continue">Click to continue...</div>
          </div>`;
      }, 400);
    }

    // Wait for click to dismiss
    await new Promise(resolve => {
      const dismiss = () => { resultEl?.removeEventListener('click', dismiss); resolve(); };
      resultEl?.addEventListener('click', dismiss);
      _timers.push(setTimeout(dismiss, 8000));
    });

    // Cleanup
    _timers.forEach(t => clearTimeout(t));
    if (waveRAF) cancelAnimationFrame(waveRAF);
    overlay.remove();
    bodyEl.style.display = origDisplay;
    this._animationActive = false;
    this.render();
  }

  /**
   * Open the NetworkAuthDialog for a restricted network.
   * Called when player clicks "Connect to [Network]" in the restricted overlay.
   * On successful auth, the network auto-switches and the overlay dissolves on re-render.
   * @param {string} networkId — ID of the network to connect to
   */
  async _connectToRestrictedNetwork(networkId) {
    if (!networkId) return;

    const networkService = this.networkService;
    if (!networkService) {
      ui.notifications.warn('NCM | Network service not available.');
      return;
    }

    const network = networkService.getNetwork?.(networkId);
    if (!network) {
      ui.notifications.warn(`NCM | Network "${networkId}" not found.`);
      return;
    }

    // Use the static show() API — returns { success, method } via promise
    try {
      const { NetworkAuthDialog } = await import('../NetworkManagement/NetworkAuthDialog.js');
      const result = await NetworkAuthDialog.show(networkId);

      if (result?.success) {
        // Auth succeeded — switch to this network
        await networkService.switchNetwork?.(network.id);
        ui.notifications.info(`NCM | Connected to ${network.name}.`);
        // Play access granted transition, then re-render to show message
        await this._playAccessGrantedTransition(
          `Connected to ${network.name} — loading message content...`
        );
        this.render();
      }
      // If cancelled or failed, the dialog already handles notifications
    } catch (err) {
      console.error('NCM | Failed to open NetworkAuthDialog:', err);
      ui.notifications.error('NCM | Failed to open network authentication.');
    }
  }

  /**
   * GM: Reset lockout timer on a network-restricted message.
   * @param {string} messageId
   */
  async _gmResetLockout(messageId) {
    if (!game.user?.isGM) return;
    await this.messageAccessService?.resetLockout?.(messageId, this.actorId);
    ui.notifications.info('NCM | Lockout timer reset.');
    this.render();
  }

  /**
   * Quarantine a malware-infected message — disables its payload.
   * @param {string} messageId
   */
  async _quarantineMalware(messageId) {
    if (!messageId) return;
    await this.messageService?.updateMessageFlags?.(this.actorId, messageId, {
      status: { quarantined: true },
    });
    this.soundService?.play?.('hack-success');
    ui.notifications.info('NCM | Malware quarantined.');
    this.render();
  }

  /**
   * Analyze a malware-infected message — share details to chat for the GM.
   * @param {string} messageId
   */
  async _analyzeMalware(messageId) {
    if (!messageId) return;
    const msg = this._cachedMessages?.find(m => m.messageId === messageId);
    if (!msg) return;

    const actor = game.actors?.get(this.actorId);
    const content = await renderTemplate(
      `modules/${MODULE_ID}/templates/chat/malware-analysis.hbs`,
      {
        actorName: actor?.name || 'Unknown',
        source: msg.fromDisplay || msg.from || 'Unknown',
        subject: msg.subject || 'No subject',
        malwareType: msg.malware?.type?.toUpperCase() || null,
        networkDisplay: game.nightcity?.networkService?.getCurrentNetworkName?.() || 'CITINET',
      }
    );

    await ChatMessage.create({
      content,
      speaker: ChatMessage.getSpeaker({ actor }),
      whisper: game.users.filter(u => u.isGM).map(u => u.id),
    });
    ui.notifications.info('NCM | Malware analysis sent to GM.');
  }

  _toggleThread() {
    // Toggle thread expansion in detail view — implementation depends on thread UI
    this.render();
  }

  // ═══════════════════════════════════════════════════════════
  //  Sprint 2B: Attachment Actions
  // ═══════════════════════════════════════════════════════════

  async _breachAttachment(messageId, attachmentIndex) {
    if (!messageId || attachmentIndex == null) return;
    game.nightcity?.messenger?.attemptBreachAttachment?.(
      messageId, parseInt(attachmentIndex), this.actorId
    );
  }

  async _gmForceBreachAttachment(messageId, attachmentIndex) {
    if (!messageId || attachmentIndex == null || !game.user.isGM) return;
    await this.messageService?.forceBreachAttachment?.(messageId, parseInt(attachmentIndex));
    this.render();
  }

  _openAttachment(messageId, attachmentIndex) {
    if (!messageId || attachmentIndex == null) return;
    const msg = this._getSelectedMessage();
    const att = msg?.attachments?.[parseInt(attachmentIndex)];
    if (!att) return;

    // Data shard — open in ItemInboxApp
    if (att.itemId) {
      const item = game.items.get(att.itemId)
        || game.actors.get(this.actorId)?.items.get(att.itemId);
      if (item) {
        const actor = game.actors.get(this.actorId);
        game.nightcity?.openDataShard?.(item, { actor });
      } else {
        ui.notifications.warn('Data shard not found in inventory.');
      }
      return;
    }

    // File attachment — use Foundry's viewers
    const fileUrl = att.path || att.url;
    if (!fileUrl) return;

    const ext = fileUrl.split('.').pop()?.toLowerCase();

    // Images — Foundry ImagePopout
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) {
      new ImagePopout(fileUrl, { title: att.name || 'Attachment' }).render(true);
      return;
    }

    // PDFs — Foundry's built-in PDF viewer (v12+)
    if (ext === 'pdf') {
      const journalSheet = new JournalSheet(
        new JournalEntry({ name: att.name || 'PDF', pages: [] }),
        { editable: false }
      );
      // Fallback: open in Foundry frame
      const frame = new FrameViewer(fileUrl, { title: att.name || 'PDF' });
      frame.render(true);
      return;
    }

    // Everything else — open in a Foundry FrameViewer (stays in app)
    try {
      const frame = new FrameViewer(fileUrl, {
        title: att.name || 'Attachment',
      });
      frame.render(true);
    } catch {
      // FrameViewer not available in this Foundry version — fallback
      window.open(fileUrl, '_blank');
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Density
  // ═══════════════════════════════════════════════════════════

  _setDensity(density) {
    this.density = density || 'normal';
    this._savePreferences();
    this.render();
  }

  // ═══════════════════════════════════════════════════════════
  //  Dropdown Management
  // ═══════════════════════════════════════════════════════════

  /**
   * Toggle a dropdown menu.
   * Sprint 2A: Updated container selectors for new layout.
   *   .ncm-network-badge (was .ncm-network-selector)
   *   .ncm-tab-control   (was .ncm-sort-control)
   *   .ncm-network-filter-control (unchanged)
   */
  _toggleDropdown(selector, triggerEl) {
    const html = this.element;
    if (!html) return;

    // Close all other dropdowns first
    html.querySelectorAll('.ncm-net-selector-wrap, .ncm-sort-dropdown, .ncm-network-filter-dropdown')
      .forEach(d => {
        if (!d.matches(selector)) d.classList.add('ncm-hidden');
      });

    // Find the dropdown relative to the trigger — check v3.2 + legacy containers
    const container = triggerEl.closest(
      '.ncm-viewer__net-pill, .ncm-viewer__sort-btn, .ncm-viewer__refine-controls, ' +
      '.ncm-inbox-network, .ncm-tab-control, .ncm-sort-control, .ncm-network-filter-control'
    );
    const dropdown = container?.querySelector(selector);
    if (dropdown) {
      dropdown.classList.toggle('ncm-hidden');
    }
  }

  /**
   * Toggle the WP-5 network selector dropdown.
   * Closes all other dropdowns first.
   * @param {HTMLElement} triggerEl
   */
  _toggleNetworkSelector(triggerEl) {
    const html = this.element;
    if (!html) return;

    // Close other dropdowns
    html.querySelectorAll('.ncm-sort-dropdown, .ncm-network-filter-dropdown')
      .forEach(d => d.classList.add('ncm-hidden'));

    // Find the selector wrap — v3.2 + legacy
    const container = triggerEl.closest('.ncm-viewer__net-pill, .ncm-inbox-network');
    const selectorWrap = container?.querySelector('.ncm-net-selector-wrap');
    if (selectorWrap) {
      selectorWrap.classList.toggle('ncm-hidden');
    }
  }

  /**
   * Close the network selector dropdown.
   */
  _closeNetworkSelector() {
    const wrap = this.element?.querySelector('.ncm-net-selector-wrap');
    wrap?.classList.add('ncm-hidden');
  }

  // ═══════════════════════════════════════════════════════════
  //  Sidebar Resize
  // ═══════════════════════════════════════════════════════════

  /**
   * Toggle the message list panel collapsed/expanded.
   * Direct DOM manipulation for instant feedback — no re-render needed.
   */
  _toggleListPanel() {
    this._listCollapsed = !this._listCollapsed;
    const split = this.element?.querySelector('.ncm-viewer__split');
    if (!split) return;

    if (this._listCollapsed) {
      split.classList.add('ncm-viewer__split--list-collapsed');
    } else {
      split.classList.remove('ncm-viewer__split--list-collapsed');
    }
  }

  _onDividerDrag(event) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = this.sidebarWidth;
    const html = this.element;
    const panel = html?.querySelector('.ncm-viewer__list-panel');

    const onMouseMove = (e) => {
      const delta = e.clientX - startX;
      const newWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, startWidth + delta));
      if (panel) panel.style.width = `${newWidth}px`;
      this.sidebarWidth = newWidth;
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      this._savePreferences();
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  // ═══════════════════════════════════════════════════════════
  //  EventBus Subscriptions
  // ═══════════════════════════════════════════════════════════

  _setupEventSubscriptions() {
    // ── Message events (real-time inbox updates via DocumentSyncBridge) ──
    this.subscribe?.(EVENTS.MESSAGE_RECEIVED, () => this._debouncedRender());
    this.subscribe?.(EVENTS.MESSAGE_SENT, () => this._debouncedRender());
    this.subscribe?.(EVENTS.MESSAGE_READ, () => this._debouncedRender());
    this.subscribe?.(EVENTS.MESSAGE_DELETED, () => this._debouncedRender());
    this.subscribe?.(EVENTS.MESSAGE_STATUS_CHANGED, () => this._debouncedRender());
    this.subscribe?.(EVENTS.INBOX_REFRESH, () => this._debouncedRender());
    this.subscribe?.(EVENTS.QUEUE_FLUSHED, () => this._debouncedRender());
    this.subscribe?.(EVENTS.SCHEDULE_UPDATED, () => this._debouncedRender());

    // ── Network events ──
    this.subscribe?.(EVENTS.NETWORK_CHANGED, (data) => {
      this._handleNetworkChange(data);
    });
    this.subscribe?.(EVENTS.NETWORK_CONNECTED, () => this._debouncedRender());
    this.subscribe?.(EVENTS.NETWORK_DISCONNECTED, () => this._debouncedRender());

    // ── UI / theme events ──
    this.subscribe?.(EVENTS.THEME_CHANGED, () => this._debouncedRender());
    this.subscribe?.(EVENTS.CONTACT_UPDATED, () => this._debouncedRender());
  }

  // ═══════════════════════════════════════════════════════════
  //  Data Loading & Enrichment
  // ═══════════════════════════════════════════════════════════

  async _loadMessages() {
    if (!this.messageService || !this.actorId) return [];
    try {
      // Fetch ALL messages — viewer handles filtering via _applyFilters
      return await this.messageService.getMessages(this.actorId, {
        filter: 'all',
        includeDeleted: true,
      }) || [];
    } catch (err) {
      console.error(`${MODULE_ID} | Failed to load messages:`, err);
      return [];
    }
  }

  _getSelectedMessage() {
    return this._cachedMessages?.find(m => m.messageId === this.selectedMessageId) || null;
  }

  /**
   * Build the full enriched message for the detail panel.
   * Sprint 2B: Now includes security strip data and classified attachments.
   */
  async _getEnrichedMessage(messageId, allMessages) {
    const msg = allMessages.find(m => m.messageId === messageId);
    if (!msg) return null;

    const displayData = this._enrichMessageDisplay(msg, this._getCurrentNetworkData()?.name);
    const contact = this._findContact(msg.from);
    const attachments = msg.attachments || [];

    // §2.4 — Security verification strip (items array format)
    const security = getSecurityStripData(msg, contact);

    // §2.6/2.8 — Classify attachments into encrypted vs regular
    const classified = classifyAttachments(attachments);

    // ── Quick win: sender contact check for "Add to Contacts" button ──
    const senderIsContact = !!contact;

    // ── Network/access restriction check via MessageAccessService ──
    const viewingActor = this.actorId ? game.actors?.get(this.actorId) : null;
    const accessState = this.messageAccessService?.checkAccess(msg, viewingActor)
      ?? { canRead: true, restricted: false };
    const isNetworkLocked = !accessState.canRead;
    const hasNetworkRestriction = !!accessState.restricted;
    const lockedNetworkName = accessState.requiredNetworkName
      || this.networkService?.getNetwork?.(msg.network)?.name
      || msg.network || '';

    // ── Enriched network data for redesigned restricted overlay ──
    // Build whenever the message HAS restrictions — not just when locked.
    // GMs see the content but get a "restricted" indicator.
    let restrictedNetworkData = null;
    if (hasNetworkRestriction && (accessState.requiredNetwork || msg.accessControl?.requiredNetwork)) {
      const netId = accessState.requiredNetwork || msg.accessControl?.requiredNetwork;
      const net = this.networkService?.getNetwork?.(netId);
      if (net) {
        const theme = net.theme || {};
        const sec = net.security || {};
        const color = theme.color || '#4488ff';
        const r = parseInt(color.slice(1,3), 16) || 68;
        const g = parseInt(color.slice(3,5), 16) || 136;
        const b = parseInt(color.slice(5,7), 16) || 255;
        // Build requirement chips from auth config
        const reqChips = [];
        if (sec.requiresAuth) {
          if (sec.password || sec.hasPassword) reqChips.push({ type: 'password', icon: 'fa-key', label: 'Password' });
          if (sec.skillCheck || sec.hasSkillBypass) reqChips.push({ type: 'skill', icon: 'fa-dice-d20', label: 'Skill Check' });
          if (sec.keyItem || sec.hasKeyItem) reqChips.push({ type: 'keyitem', icon: 'fa-id-badge', label: net.security.keyItemName || 'Key Item' });
        }
        // Determine AND vs OR logic
        const authLogic = sec.authLogic || 'OR';
        restrictedNetworkData = {
          networkId: net.id,
          name: net.name,
          type: net.type || 'Unknown',
          typeLabel: (net.type || 'Unknown').charAt(0) + (net.type || 'Unknown').slice(1).toLowerCase(),
          icon: theme.icon || 'fa-wifi',
          color,
          rgb: `${r},${g},${b}`,
          glow: `rgba(${r},${g},${b},0.04)`,
          securityLevel: (sec.level || 'NONE').toUpperCase(),
          securityTagClass: (sec.level || 'none').toLowerCase(),
          reqChips,
          authLogic,
          isLockedOut: accessState.lockedOut || false,
          lockoutUntil: accessState.lockoutUntil || null,
          remainingAttempts: accessState.maxAttempts ? (accessState.maxAttempts - (accessState.hackAttempts || 0)) : null,
          maxAttempts: accessState.maxAttempts || 3,
          hackAttempts: accessState.hackAttempts || 0,
          // Pre-computed pip array for template iteration
          attemptPips: Array.from({ length: accessState.maxAttempts || 3 }, (_, i) => ({
            state: i < (accessState.hackAttempts || 0) ? 'used' : 'available',
          })),
        };
      }
    }
    // Feature 1 — Eddies data (different display for sent vs received)
    let eddiesData = null;
    if (msg.eddies && msg.eddies > 0) {
      const isSent = !!msg.status?.sent;
      const claimed = msg.status?.eddiesClaimed || false;
      eddiesData = {
        amount: msg.eddies,
        formatted: `${msg.eddies.toLocaleString()} eb`,
        claimed: isSent ? true : claimed, // Sent copies always show as "completed"
        claimedAt: isSent ? 'Sent' : (msg.status?.eddiesClaimedAt || ''),
        isSentCopy: isSent,
      };
    }

    // Feature 3 — Build attachment card data for thumbnails
    const attachmentCards = this._buildAttachmentCards(attachments, msg.eddies);

    // Feature 4 — Self-destruct data (not on sent copies — sender doesn't need countdown)
    let selfDestructActive = false;
    let selfDestructDisplay = '';
    if (msg.selfDestruct && !msg.status?.sent) {
      if (msg.selfDestruct.mode === 'after_read' && msg.status?.read) {
        selfDestructActive = true;
        selfDestructDisplay = 'After close';
      } else if (msg.selfDestruct.expiresAt) {
        const remaining = new Date(msg.selfDestruct.expiresAt).getTime() - Date.now();
        if (remaining > 0) {
          selfDestructActive = true;
          const h = Math.floor(remaining / 3600000);
          const m2 = Math.floor((remaining % 3600000) / 60000);
          const s = Math.floor((remaining % 60000) / 1000);
          selfDestructDisplay = `${String(h).padStart(2,'0')}:${String(m2).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
        }
      }
    }

    // Feature 2 — Merge persisted decrypted blocks into local set, then transform body
    if (msg.decryptedBlocks?.length) {
      if (!this._decryptedBlocks) this._decryptedBlocks = new Set();
      msg.decryptedBlocks.forEach(key => this._decryptedBlocks.add(key));
    }
    let bodyRendered = this._renderMessageBody(msg.body, msg.messageId);

    // WP-5 — Signal degradation: corrupt body text if not reconstructed (GM sees clean)
    if (msg.signalDegradation && !msg.signalDegradation.reconstructed && !game.user?.isGM) {
      bodyRendered = this._applySignalCorruption(bodyRendered, msg.signalDegradation.corruptionLevel);
    }

    // WP-6 — Trace state for traced network messages
    let traceActive = false;
    let traceExpiresAt = msg.traceExpiresAt || null;
    const traceCompleted = msg.traceCompleted || false;
    if (msg.traceExpiresAt && !traceCompleted) {
      const remaining = new Date(msg.traceExpiresAt).getTime() - Date.now();
      if (remaining > 0) {
        traceActive = true;
      }
    }

    // WP-7 — Network body visual effect
    let networkBodyEffect = null;
    const resolvedNet = this.networkService?.getNetwork?.(msg.network);
    if (resolvedNet) {
      const netId = (resolvedNet.id || '').toLowerCase();
      if (netId === 'darknet') networkBodyEffect = 'darknet';
      else if (netId === 'govnet') networkBodyEffect = 'govnet';
      else if (netId === 'corpnet') networkBodyEffect = 'corpnet';
    }

    return {
      ...msg,
      ...displayData,
      bodyRendered,
      threadInfo: this._getThreadInfo(msg, allMessages),
      attachments,
      security,
      encryptedAttachments: classified.encrypted,
      regularAttachments: classified.regular,
      eddiesData,
      attachmentCards,
      hasAttachmentCards: attachmentCards.length > 0,
      selfDestructActive,
      selfDestructDisplay,
      isSent: !!msg.status?.sent,
      senderIsContact,
      isNetworkLocked,
      hasNetworkRestriction,
      lockedNetworkName,
      accessState,
      restrictedNetworkData,
      networkBodyEffect,
      traceActive,
      traceExpiresAt,
      traceCompleted,
    };
  }

  /**
   * Enrich a page of messages for list display.
   * Sprint 2C: Now receives currentNetworkName for network badge logic.
   *
   * @param {Array} messages — Paginated message array
   * @param {string} [currentNetworkName] — Current active network name
   * @returns {Array} Enriched messages with display data
   */
  async _enrichMessages(messages, currentNetworkName) {
    this._cachedMessages = messages;

    // Resolve viewing actor once for all access checks
    const viewingActor = this.actorId ? game.actors?.get(this.actorId) : null;
    const accessSvc = this.messageAccessService;

    return messages.map(msg => {
      // Network/access restriction check via MessageAccessService
      const accessState = accessSvc?.checkAccess(msg, viewingActor)
        ?? { canRead: true, restricted: false };
      const isNetworkLocked = !accessState.canRead;

      // Encrypted state for list item styling
      const isEncrypted = !!msg.status?.encrypted;
      const encryption = msg.encryption || {};
      let encryptionTag = '';
      if (isEncrypted) {
        const iceType = encryption.type || 'ICE';
        const isBlackIce = iceType === 'BLACK_ICE' || iceType === 'RED_ICE';
        encryptionTag = isBlackIce ? iceType.replace('_', ' ') : `${iceType} // DV ${encryption.dc ?? 15}`;
      }

      // Darknet origin for list item styling
      const msgNetNorm = (msg.network || '').toLowerCase();
      const isDarknet = msgNetNorm.includes('dark');

      // Trace state for list item
      const isTraced = !!(msg.traceExpiresAt || msg.traceCompleted);
      const traceAgency = msg.traceAgency || null;

      // Self-destruct for list item display
      let hasSelfDestruct = false;
      let selfDestructListDisplay = '';
      let selfDestructUrgent = false;
      if (msg.selfDestruct && !msg.status?.sent) {
        hasSelfDestruct = true;
        if (msg.selfDestruct.mode === 'after_read' && msg.status?.read) {
          selfDestructListDisplay = 'ON READ';
        } else if (msg.selfDestruct.expiresAt) {
          const remaining = new Date(msg.selfDestruct.expiresAt).getTime() - Date.now();
          if (remaining > 0) {
            const m = Math.floor(remaining / 60000);
            const s = Math.floor((remaining % 60000) / 1000);
            selfDestructListDisplay = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
            selfDestructUrgent = remaining <= 30000;
          } else {
            selfDestructListDisplay = '00:00';
            selfDestructUrgent = true;
          }
        }
      }

      return {
        ...msg,
        ...this._enrichMessageDisplay(msg, currentNetworkName),
        selected: msg.messageId === this.selectedMessageId,
        bulkSelected: this.bulkSelected.has(msg.messageId),
        isNetworkLocked,
        lockedNetworkName: accessState.requiredNetworkName
          || this.networkService?.getNetwork?.(msg.network)?.name
          || msg.network || '',
        // New list-item state fields
        isEncrypted,
        encryptionTag,
        isDarknet,
        isTraced,
        traceAgency,
        hasSelfDestruct,
        selfDestructListDisplay,
        selfDestructUrgent,
      };
    });
  }

  /**
   * Compute display fields for a single message.
   * Sprint 2C: Adds avatarColor, networkThemeClass, networkAccentColor,
   *   showNetworkBadge, networkBadgeLabel, networkBadgeVariant, threatBadge.
   *
   * @param {object} msg — Raw message data
   * @param {string} [currentNetworkName] — Active network for badge comparison
   * @returns {object} Display enrichment fields
   */
  _enrichMessageDisplay(msg, currentNetworkName) {
    // ── Sender display name ──
    // Priority: contact name → actor name → stored name → email handle fallback
    const contact = this._findContact(msg.from);
    const fromActor = msg.fromActorId ? game.actors?.get(msg.fromActorId) : null;
    let fromDisplay = contact?.name || fromActor?.name || msg.fromName || msg.from?.split('@')[0] || 'Unknown';
    let fromPortrait = contact?.portrait || fromActor?.img || null;

    // ── Encrypted sender detection ──
    // If the sender's contact is ICE-protected in this actor's contact list,
    // redact identity. The real data stays in message flags and journals
    // for GM inspection via the admin panel or journal sidebar.
    const isSenderEncrypted = !!(contact?.encrypted);
    if (isSenderEncrypted) {
      fromDisplay = '████████';
      fromPortrait = null;
    }

    // ── Burned sender detection ──
    const burnCheck = game.nightcity?.emailService?.isBurnedEmail?.(msg.from) ?? { burned: false };
    const isBurnedSender = burnCheck.burned;
    if (isBurnedSender && !contact?.name) {
      fromDisplay = fromActor?.name || msg.fromName || msg.from?.split('@')[0] || 'Unknown';
    }

    const fromInitial = isSenderEncrypted ? '?' : (fromDisplay[0] || '?').toUpperCase();

    // ── Recipient display name ──
    // Priority: contact name → actor name → stored name → email handle fallback
    const toContact = this._findContact(msg.to);
    const toActor = msg.toActorId ? game.actors?.get(msg.toActorId) : null;
    const toDisplay = toContact?.name || toActor?.name || msg.toName || msg.to?.split('@')[0] || 'Unknown';

    // ── Priority badge variant for tag-badge partial ──
    const priorityVariant = getPriorityBadgeVariant(msg.priority || 'normal');

    // ── Network label (resolved display name) ──
    const networkLabel = this.networkService?.getNetwork?.(msg.network)?.name || msg.network || '';

    // ── Formatted time using formatCyberDate helper ──
    let formattedTime = '';
    try {
      if (msg.timestamp) {
        formattedTime = formatCyberDate(msg.timestamp);
      }
    } catch {
      formattedTime = msg.timestamp || '';
    }

    // ── Body preview (for comfortable density) ──
    const bodyPreview = msg.body
      ? msg.body.replace(/<[^>]+>/g, '').substring(0, 120)
      : '';

    // ══════════════════════════════════════════════════════
    //  Sprint 2C — Visual personality enrichment
    // ══════════════════════════════════════════════════════

    // §2.9 — Color-coded avatar (role colors from GM Admin Panel)
    // Encrypted senders get neutral muted color to avoid identity leaks via color
    const avatarColor = isSenderEncrypted
      ? '#555570'
      : getAvatarColor(fromDisplay, contact, this._customRoles);

    // §2.10 — Network theme class
    const networkThemeClass = getNetworkThemeClass(msg.network);

    // §2.10 — Network accent color for avatar border
    const networkAccentColor = getNetworkAccentColor(msg.network);

    // §2.10 — Network tag badge (show only when message network differs from current)
    const msgNetworkNorm = (msg.network || '').toLowerCase().trim();
    const curNetworkNorm = (currentNetworkName || '').toLowerCase().trim();
    const showNetworkBadge = !!(msg.network && msgNetworkNorm !== curNetworkNorm && msgNetworkNorm !== 'citinet');
    // Resolve display name via NetworkService; fall back to raw network field
    const resolvedNetwork = this.networkService?.getNetwork?.(msg.network);
    const networkBadgeLabel = resolvedNetwork?.name || msg.network || '';
    // Derive badge variant suffix for color matching
    let networkBadgeVariant = 'default';
    if (msgNetworkNorm.includes('dark')) networkBadgeVariant = 'darknet';
    else if (msgNetworkNorm.includes('corp')) networkBadgeVariant = 'corpnet';

    // Network badge icon — use actual theme when available, fallback to type map
    const networkIconMap = {
      'darknet': 'fa-user-secret',
      'corpnet': 'fa-building',
      'citinet': 'fa-wifi',
    };
    const networkBadgeIcon = resolvedNetwork?.theme?.icon || networkIconMap[networkBadgeVariant] || 'fa-network-wired';
    const rawTheme = resolvedNetwork?.theme || {};
    const networkBadgeTheme = {
      ...rawTheme,
      color: rawTheme.color || networkAccentColor || null,
      icon: rawTheme.icon || networkIconMap[networkBadgeVariant] || 'fa-network-wired',
    };

    // Priority icon for detail panel tag-badge partial
    const priorityIconMap = {
      'critical': 'fas fa-triangle-exclamation',
      'urgent': 'fas fa-bolt',
    };
    const priorityIcon = priorityIconMap[(msg.priority || '').toLowerCase()] || '';

    // §2.7 — Threat badge for malware
    const threatBadge = getThreatBadgeData(msg);

    // ══════════════════════════════════════════════════════
    //  v3.2 — Stacked timestamp + network pip + stripe
    // ══════════════════════════════════════════════════════

    // Stacked timestamp: date on top, relative below
    let formattedDate = '';
    try {
      if (msg.timestamp) formattedDate = formatCyberDate(msg.timestamp, { dateOnly: true });
    } catch { formattedDate = ''; }
    const { relativeTime, isRecentMessage } = computeRelativeTime(msg.timestamp);

    // Network stripe color (all messages get the stripe)
    const themeColor = resolvedNetwork?.theme?.color || networkAccentColor || null;
    const netStripeColor = themeColor ? `${themeColor}40` : null; // 25% opacity hex suffix

    // Network pip (only for messages from a different network than current)
    const isDifferentNetwork = !!(msg.network && msgNetworkNorm !== curNetworkNorm);
    const netPipColor = isDifferentNetwork ? (themeColor || null) : null;
    const netPipIcon = isDifferentNetwork
      ? (resolvedNetwork?.theme?.icon || networkBadgeIcon || 'fa-network-wired')
      : null;
    const netPipLabel = isDifferentNetwork ? getNetPipLabel(networkBadgeLabel) : null;

    return {
      fromDisplay,
      fromInitial,
      fromPortrait,
      isBurnedSender,
      isSenderEncrypted,
      toDisplay,
      priorityVariant,
      priorityIcon,
      networkLabel,
      formattedTime,
      bodyPreview,
      // Sprint 2C
      avatarColor,
      networkThemeClass,
      networkAccentColor,
      showNetworkBadge,
      networkBadgeLabel,
      networkBadgeVariant,
      networkBadgeIcon, 
      networkBadgeTheme,
      threatBadge,
      // v3.2 — Stacked time + network pip
      formattedDate,
      relativeTime,
      isRecentMessage,
      netStripeColor,
      netPipColor,
      netPipIcon,
      netPipLabel,
    };
  }

  _renderMessageBody(body, messageId) {
    if (!body) return '';

    // Feature 2 — Transform ncm-encrypted-text-block into interactive locked/decrypted blocks
    const decryptedBlocks = this._decryptedBlocks || new Set();
    let rendered = body.replace(
      /<div\s+class="ncm-encrypted-text-block"[^>]*data-label="([^"]*)"[^>]*>([\s\S]*?)<\/div>/gi,
      (match, label, content, offset) => {
        // Generate a block index from position for tracking
        const blockIdx = body.indexOf(match);
        const blockKey = `${messageId}-${blockIdx}`;
        const isDecrypted = decryptedBlocks.has(blockKey);

        if (isDecrypted) {
          return `<div class="ncm-encrypted-block ncm-encrypted-block--decrypted">
            <div class="ncm-encrypted-block__label"><i class="fas fa-unlock"></i> DECRYPTED</div>
            <div class="ncm-encrypted-block__content">${content}</div>
          </div>`;
        } else {
          return `<div class="ncm-encrypted-block ncm-encrypted-block--locked" data-block-key="${blockKey}">
            <div class="ncm-encrypted-block__label"><i class="fas fa-shield-halved"></i> ${label || 'ICE-ENCRYPTED BLOCK'}</div>
            <div class="ncm-encrypted-block__content">${content}</div>
            <div class="ncm-encrypted-block__overlay">
              <i class="fas fa-lock"></i>
              <span class="ncm-encrypted-block__overlay-text">Encrypted Content</span>
              <button class="ncm-encrypted-block__decrypt-btn" data-action="decrypt-block" data-block-key="${blockKey}">
                <i class="fas fa-terminal" style="margin-right:3px;"></i> Decrypt
              </button>
            </div>
          </div>`;
        }
      }
    );

    return rendered;
  }

  /**
   * WP-5: Apply signal corruption to rendered HTML body.
   * Replaces random characters with garbled unicode block characters.
   * Only corrupts text content, not HTML tags.
   * @param {string} html - Rendered HTML body
   * @param {string} level - 'moderate' or 'heavy'
   * @returns {string} Corrupted HTML
   */
  _applySignalCorruption(html, level) {
    const corruptChars = '█▓░▒╬╫╪┼┤├╡╞╟╢';
    const ratio = level === 'heavy' ? 0.4 : 0.2;

    // Use a seeded approach based on the string to keep corruption stable across renders
    let seedIdx = 0;
    return html.replace(/>[^<]+</g, (match) => {
      const text = match.slice(1, -1);
      const corrupted = text.split('').map(char => {
        if (char === ' ' || char === '\n' || char === '\r' || char === '\t') return char;
        seedIdx++;
        // Deterministic pseudo-random based on character position
        const hash = ((seedIdx * 2654435761) >>> 0) / 4294967296;
        if (hash < ratio) {
          const ci = Math.floor(((seedIdx * 48271) >>> 0) % corruptChars.length);
          return `<span class="ncm-corrupt-char">${corruptChars[ci]}</span>`;
        }
        return char;
      }).join('');
      return `>${corrupted}<`;
    });
  }

  /**
   * Build attachment card data for the thumbnail grid (Feature 3).
   */
  _buildAttachmentCards(attachments, eddiesAmount) {
    const cards = [];

    for (let i = 0; i < attachments.length; i++) {
      const att = attachments[i];
      if (att.isEddies) continue; // Handled by eddies claim block

      const ext = (att.name || att.path || '').split('.').pop()?.toLowerCase() || '';
      const isImage = ['jpg','jpeg','png','gif','webp','svg'].includes(ext);
      const isShard = !!att.itemId;

      cards.push({
        action: isShard ? 'open-shard' : 'open-attachment',
        itemId: att.itemId || '',
        name: att.name || 'Unknown',
        meta: isShard ? `DATA SHARD${att.size ? ` • ${att.size}` : ''}` : `${ext.toUpperCase() || 'FILE'}${att.size ? ` • ${att.size}` : ''}`,
        metaClass: isShard ? 'ncm-attach-card__meta--shard' : '',
        thumbClass: isShard ? 'ncm-attach-card__thumb--shard' : isImage ? 'ncm-attach-card__thumb--image' : '',
        thumbIcon: isShard ? 'fas fa-microchip' : isImage ? 'fas fa-image' : (att.icon || 'fas fa-file'),
        thumbSrc: isImage && att.path ? att.path : null,
        nameStyle: '',
      });
    }

    // Add eddies as a card too (visual only — claim handled separately)
    if (eddiesAmount && eddiesAmount > 0) {
      cards.push({
        action: '',
        itemId: '',
        name: `${eddiesAmount.toLocaleString()} eb`,
        meta: 'EDDIES TRANSFER',
        metaClass: 'ncm-attach-card__meta--eddies',
        thumbClass: 'ncm-attach-card__thumb--eddies',
        thumbIcon: 'fas fa-coins',
        thumbSrc: null,
        nameStyle: 'color: var(--ncm-success, #00ff41);',
      });
    }

    return cards;
  }

  _getThreadInfo(msg, allMessages) {
    if (!msg.threadId) return null;
    const thread = allMessages.filter(m => m.threadId === msg.threadId && m.messageId !== msg.messageId);
    if (thread.length === 0) return null;
    return {
      count: thread.length,
      latest: thread.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0],
    };
  }

  /**
   * Build draft items from actors with saved composerDraft flags.
   */
  _buildDraftItems() {
    const MODULE_ID_LOCAL = 'cyberpunkred-messenger';
    const items = [];

    // Check current viewing actor
    const actor = game.actors.get(this.actorId);
    if (actor) {
      const draft = actor.getFlag(MODULE_ID_LOCAL, 'composerDraft');
      if (draft?.savedAt) {
        const age = Date.now() - new Date(draft.savedAt).getTime();
        if (age < 86400000) { // < 24 hours
          const recipientName = draft.recipients?.[0]?.email
            || (draft.recipients?.[0]?.actorId ? game.actors.get(draft.recipients[0].actorId)?.name : null)
            || null;
          items.push({
            actorId: this.actorId,
            recipientName,
            subject: draft.subject || '',
            savedAt: formatCyberDate(draft.savedAt),
          });
        }
      }
    }

    // GM: also check other actors they might have drafted as
    if (game.user.isGM) {
      for (const a of game.actors) {
        if (a.id === this.actorId) continue;
        const draft = a.getFlag(MODULE_ID_LOCAL, 'composerDraft');
        if (draft?.savedAt) {
          const age = Date.now() - new Date(draft.savedAt).getTime();
          if (age < 86400000) {
            items.push({
              actorId: a.id,
              recipientName: draft.recipients?.[0]?.email || null,
              subject: draft.subject ? `[${a.name}] ${draft.subject}` : `[${a.name}] (no subject)`,
              savedAt: formatCyberDate(draft.savedAt),
            });
          }
        }
      }
    }

    return items;
  }

  /**
   * Build combined shard items list for the Shards tab (Feature 7).
   * Includes actor inventory shards + shards received as message attachments.
   */
  _buildShardItems(allMessages) {
    const MODULE_ID_LOCAL = 'cyberpunkred-messenger';
    const items = [];
    const seenIds = new Set();

    // Actor inventory shards
    const actor = game.actors.get(this.actorId);
    if (actor) {
      for (const item of actor.items) {
        const config = item.getFlag(MODULE_ID_LOCAL, 'shardConfig') || item.getFlag(MODULE_ID_LOCAL, 'config');
        if (!config) continue;
        seenIds.add(item.id);
        const messages = game.nightcity?.dataShardService?.getShardMessages?.(item) || [];
        items.push({
          id: item.id,
          name: item.name,
          img: item.img,
          isReceived: false,
          isEncrypted: config.encrypted || false,
          fragmentCount: messages.length,
          fromName: null,
        });
      }
    }

    // Shards received as message attachments
    for (const msg of allMessages) {
      if (!msg.attachments) continue;
      for (const att of msg.attachments) {
        if (!att.itemId || seenIds.has(att.itemId)) continue;
        seenIds.add(att.itemId);
        const item = game.items?.get(att.itemId) || actor?.items?.get(att.itemId);
        items.push({
          id: att.itemId,
          name: att.name || item?.name || 'Unknown Shard',
          img: item?.img || null,
          isReceived: true,
          isEncrypted: att.encrypted || false,
          fragmentCount: null,
          fromName: msg.from || msg.fromActorId ? (game.actors.get(msg.fromActorId)?.name || msg.from) : null,
        });
      }
    }

    return items;
  }

  _computeCounts(messages) {
    const counts = {
      total: 0,
      unread: 0,
      sent: 0,
      saved: 0,
      spam: 0,
      trash: 0,
    };

    for (const m of messages) {
      if (m.status.deleted) {
        counts.trash++;
        continue;
      }
      if (m.status.spam) {
        counts.spam++;
        continue;
      }
      if (m.status.sent) {
        counts.sent++;
        continue;
      }
      counts.total++;
      if (!m.status.read) counts.unread++;
      if (m.status.saved) counts.saved++;
    }

    return counts;
  }

  /**
   * Build list of characters the current user owns for the identity drawer switcher.
   * @returns {Array<{actorId, name, portrait, initials, email, isActive, avatarColor}>}
   */
  _buildOwnedCharacters() {
    const characters = [];
    const currentUser = game.user;
    if (!currentUser) return characters;

    // Collect actors this user owns
    for (const actor of game.actors) {
      const isOwner = actor.isOwner && actor.hasPlayerOwner;
      const isGMAll = currentUser.isGM; // GM can see all
      if (!isOwner && !isGMAll) continue;
      // Skip actors without emails (non-messenger actors)
      const email = this.contactRepository?.getActorEmail?.(actor.id) || '';
      if (!email && !currentUser.isGM) continue;

      characters.push({
        actorId: actor.id,
        name: actor.name,
        portrait: actor.img || null,
        initials: getInitials(actor.name || 'Unknown'),
        email,
        isActive: actor.id === this.actorId,
        avatarColor: getAvatarColor(actor.name, null, this._customRoles),
      });
    }
    return characters;
  }

  /**
   * Build list of characters the current user owns for the identity drawer switcher.
   * @returns {Array<{actorId, name, portrait, initials, email, isActive, avatarColor}>}
   */
  _buildOwnedCharacters() {
    const chars = [];
    const seenIds = new Set();

    for (const user of game.users) {
      if (user.id !== game.user.id) continue;
      const actor = user.character;
      if (actor && !seenIds.has(actor.id)) {
        seenIds.add(actor.id);
        chars.push({
          actorId: actor.id,
          name: actor.name,
          portrait: actor.img || null,
          initials: getInitials(actor.name || 'Unknown'),
          email: this.contactRepository?.getActorEmail?.(actor.id) || '',
          isActive: actor.id === this.actorId,
          avatarColor: getAvatarColor(actor.name, null, this._customRoles),
        });
      }
    }

    // Also include any actors this user owns directly
    if (game.user.isGM) {
      // GMs see all player characters
      for (const user of game.users) {
        if (user.isGM || !user.character) continue;
        const actor = user.character;
        if (!seenIds.has(actor.id)) {
          seenIds.add(actor.id);
          chars.push({
            actorId: actor.id,
            name: actor.name,
            portrait: actor.img || null,
            initials: getInitials(actor.name || 'Unknown'),
            email: this.contactRepository?.getActorEmail?.(actor.id) || '',
            isActive: actor.id === this.actorId,
            avatarColor: getAvatarColor(actor.name, null, this._customRoles),
          });
        }
      }
    }

    return chars;
  }

  // ═══════════════════════════════════════════════════════════
  //  Network Change Detection + Access Granted Transition
  // ═══════════════════════════════════════════════════════════

  /**
   * Handle NETWORK_CHANGED event — detect if viewing a restricted message
   * and show a "Connection Lost" overlay if the required network changed.
   * @param {object} [data] — Event data (may contain oldNetwork, newNetwork)
   */
  _handleNetworkChange(data) {
    const selectedMsg = this._getSelectedMessage();
    const newNet = this._getCurrentNetworkData();
    const oldNet = this._previousNetwork || data?.oldNetwork || newNet;
    this._previousNetwork = newNet;

    // No message selected — just re-render
    if (!selectedMsg) {
      this._debouncedRender();
      return;
    }

    // Check if the selected message is network-restricted via access service
    const viewingActor = this.actorId ? game.actors?.get(this.actorId) : null;
    const accessState = this.messageAccessService?.checkAccess(selectedMsg, viewingActor)
      ?? { canRead: true, restricted: false };

    // If message isn't restricted, just re-render
    if (!accessState.restricted) {
      this._debouncedRender();
      return;
    }

    // If we were on the required network and now we're not, show overlay
    const requiredNet = accessState.requiredNetwork || selectedMsg.network;
    if (oldNet?.id !== newNet?.id && oldNet?.id === requiredNet) {
      this._showNetworkChangedOverlay(oldNet, newNet, selectedMsg);
    } else if (!accessState.canRead) {
      // We're not on the right network at all — show overlay
      const requiredNetData = this.networkService?.getNetwork?.(requiredNet) || { name: requiredNet, id: requiredNet };
      this._showNetworkChangedOverlay(requiredNetData, newNet, selectedMsg);
    } else {
      this._debouncedRender();
    }
  }

  /**
   * Show the "Connection Lost" overlay in the detail panel.
   * @param {object} oldNet — Previous network data
   * @param {object} newNet — New current network data
   * @param {object} msg — The restricted message being viewed
   */
  _showNetworkChangedOverlay(oldNet, newNet, msg) {
    const html = this.element;
    const detailPanel = html?.querySelector('.ncm-viewer__detail-panel');
    if (!detailPanel) { this._debouncedRender(); return; }

    const oldName = oldNet?.name || 'Unknown';
    const oldIcon = oldNet?.theme?.icon || 'fa-wifi';
    const newName = newNet?.name || 'Unknown';
    const newIcon = newNet?.theme?.icon || 'fa-wifi';

    // Remove any existing overlay
    detailPanel.querySelector('.ncm-net-changed')?.remove();

    const overlay = document.createElement('div');
    overlay.className = 'ncm-net-changed';
    overlay.innerHTML = `
      <div class="ncm-net-changed__bg"></div>
      <div class="ncm-net-changed__grain"></div>
      <div class="ncm-net-changed__flash"></div>
      <div class="ncm-net-changed__center">
        <i class="fas fa-link-slash ncm-net-changed__icon"></i>
        <div class="ncm-net-changed__title">Connection Lost</div>
        <div class="ncm-net-changed__sub">
          Network changed. Your connection to <strong>${oldName}</strong> was interrupted.<br>
          Re-authenticate or return to the inbox.
        </div>
        <div class="ncm-net-changed__nets">
          <div class="ncm-net-changed__pill ncm-net-changed__pill--old">
            <i class="fas ${oldIcon}"></i> ${oldName.toUpperCase()}
          </div>
          <i class="fas fa-arrow-right ncm-net-changed__arrow"></i>
          <div class="ncm-net-changed__pill ncm-net-changed__pill--new">
            <i class="fas ${newIcon}"></i> ${newName.toUpperCase()}
          </div>
        </div>
        <div class="ncm-net-changed__actions">
          <button class="ncm-btn ncm-btn--secondary" data-action="reconnect-network"
                  data-network-id="${oldNet?.id || ''}">
            <i class="fas fa-plug-circle-bolt"></i> Reconnect to ${oldName}
          </button>
          <button class="ncm-btn ncm-btn--ghost" data-action="dismiss-net-changed">
            <i class="fas fa-arrow-left"></i> Back to Inbox
          </button>
        </div>
      </div>
    `;

    detailPanel.style.position = 'relative';
    detailPanel.appendChild(overlay);
    this.soundService?.play?.('disconnect');

    // Trigger animation
    requestAnimationFrame(() => overlay.classList.add('ncm-net-changed--active'));
  }

  /**
   * Play the Access Granted transition overlay.
   * Used after successful network auth, bypass, or lockout expiry.
   * Green scanline, lock icon, loading bar — then auto-dismiss and re-render.
   * @param {string} [sub] — Optional subtitle text
   * @returns {Promise<void>}
   */
  async _playAccessGrantedTransition(sub) {
    const html = this.element;
    const detailPanel = html?.querySelector('.ncm-viewer__detail-panel');
    if (!detailPanel) return;

    const overlay = document.createElement('div');
    overlay.className = 'ncm-access-granted';
    overlay.innerHTML = `
      <div class="ncm-access-granted__bg"></div>
      <div class="ncm-access-granted__glow"></div>
      <div class="ncm-access-granted__scan"></div>
      <div class="ncm-access-granted__center">
        <div class="ncm-access-granted__ring">
          <i class="fas fa-lock-open ncm-access-granted__icon"></i>
        </div>
        <div class="ncm-access-granted__title">Access Granted</div>
        <div class="ncm-access-granted__sub">${sub || 'Authentication verified — loading message content...'}</div>
        <div class="ncm-access-granted__load">
          <div class="ncm-access-granted__load-bar"></div>
        </div>
      </div>
    `;

    detailPanel.style.position = 'relative';
    detailPanel.appendChild(overlay);
    this.soundService?.play?.('login-success');

    requestAnimationFrame(() => overlay.classList.add('ncm-access-granted--active'));

    // Auto-dismiss — fast, don't stack delay on top of previous animations
    await new Promise(r => setTimeout(r, 1200));
    overlay.style.transition = 'opacity 0.3s';
    overlay.style.opacity = '0';
    await new Promise(r => setTimeout(r, 300));
    overlay.remove();
  }

  // ═══════════════════════════════════════════════════════════
  //  Message Reveal Transitions
  //  Played between animation result dismiss and re-render.
  //  Injected into .ncm-viewer__detail-panel, then render()
  //  naturally replaces it with the message content.
  // ═══════════════════════════════════════════════════════════

  /**
   * Play BLACK ICE hit effect — screen shake, red flash, floating damage number.
   * Used when a decrypt attempt triggers BLACK ICE retaliation.
   * @param {number} damage — Damage dealt
   */
  _playBlackICEHit(damage) {
    const el = this.element;
    if (!el) return;

    // Screen shake
    el.classList.add('ncm-black-ice-hit');

    // Floating damage number
    const dmgEl = document.createElement('div');
    dmgEl.className = 'ncm-viewer__damage-float';
    dmgEl.textContent = `-${damage}`;
    const detailPanel = el.querySelector('.ncm-viewer__detail-panel') || el;
    detailPanel.style.position = 'relative';
    detailPanel.appendChild(dmgEl);

    this.soundService?.play?.('black-ice');

    setTimeout(() => {
      el.classList.remove('ncm-black-ice-hit');
      dmgEl.remove();
    }, 1000);
  }

  /**
   * Play a success reveal transition in the detail panel.
   * Two variants:
   *   'decrypt' — Green scanline sweep, lock shatters, hex rain dissolves
   *   'signal'  — Cyan frequency lock, waveform resolves, static clears
   *
   * @param {'decrypt'|'signal'} type — Transition variant
   * @param {object} [opts] — Display data
   * @param {string} [opts.title] — Override title text
   * @param {string} [opts.sub] — Override subtitle
   * @returns {Promise<void>} — Resolves when animation completes
   */
  async _playMessageRevealTransition(type, opts = {}) {
    const html = this.element;
    const detailPanel = html?.querySelector('.ncm-viewer__detail-panel');
    if (!detailPanel) return;

    const isDecrypt = type === 'decrypt';
    const color = isDecrypt ? '#00ff41' : '#00D4E6';
    const rgb = isDecrypt ? '0,255,65' : '0,212,230';
    const icon = isDecrypt ? 'fa-lock-open' : 'fa-signal';
    const title = opts.title || (isDecrypt ? 'ACCESS GRANTED' : 'SIGNAL LOCKED');
    const sub = opts.sub || (isDecrypt ? 'Decryption complete — loading message...' : 'Signal restored — loading clean transmission...');

    const overlay = document.createElement('div');
    overlay.className = 'ncm-reveal';
    overlay.setAttribute('data-variant', type);
    overlay.innerHTML = `
      <div class="ncm-reveal__bg" style="--reveal-rgb:${rgb};--reveal-color:${color};"></div>
      <div class="ncm-reveal__scanline" style="--reveal-color:${color};"></div>
      ${isDecrypt ? `
        <div class="ncm-reveal__hex-rain">
          ${Array.from({length: 40}, () => `<span class="ncm-reveal__hex-char" style="left:${Math.random()*100}%;animation-delay:${Math.random()*0.8}s;animation-duration:${0.8+Math.random()*0.6}s;">${'0123456789ABCDEF'[Math.floor(Math.random()*16)]}</span>`).join('')}
        </div>
      ` : `
        <div class="ncm-reveal__static-clear"></div>
      `}
      <div class="ncm-reveal__center">
        <div class="ncm-reveal__icon-ring" style="--reveal-color:${color};--reveal-rgb:${rgb};">
          <i class="fas ${icon} ncm-reveal__icon"></i>
        </div>
        <div class="ncm-reveal__title" style="color:${color};">${title}</div>
        <div class="ncm-reveal__sub">${sub}</div>
        <div class="ncm-reveal__loading">
          <div class="ncm-reveal__loading-bar" style="--reveal-color:${color};"></div>
        </div>
      </div>
    `;

    // Inject overlay into detail panel
    detailPanel.style.position = 'relative';
    detailPanel.appendChild(overlay);

    // Force reflow then trigger animations
    overlay.offsetHeight; // eslint-disable-line no-unused-expressions
    overlay.classList.add('ncm-reveal--active');

    // Wait for transition duration
    await new Promise(r => setTimeout(r, 1400));

    // Fade out
    overlay.classList.add('ncm-reveal--exit');
    await new Promise(r => setTimeout(r, 300));

    overlay.remove();
  }

  // ═══════════════════════════════════════════════════════════
  //  Skill + Luck Selection Dialog
  //  Reusable for decryption and signal reconstruction.
  //  Same visual pattern as shard _showHackDialog but adapted
  //  for message operations (no BLACK ICE danger zone).
  // ═══════════════════════════════════════════════════════════

  /**
   * Show a themed skill/luck selection dialog before a message operation.
   * @param {object} opts
   * @param {string} opts.title       — Dialog title
   * @param {string} opts.icon        — FontAwesome icon class
   * @param {string} opts.color       — Accent color hex
   * @param {string} [opts.subtitle]  — Description line
   * @param {Array}  opts.skills      — Skill objects from SkillService.getAvailableSkills()
   * @param {number} opts.dc          — Difficulty value
   * @param {number} opts.availableLuck — Actor's current luck points
   * @param {string} opts.actorName   — Actor display name
   * @param {string} [opts.executeLabel] — Button label (default 'Execute')
   * @param {string} [opts.executeIcon]  — Button icon (default 'fas fa-bolt')
   * @returns {Promise<{skill:string, luck:number, total:number}|null>} — null if cancelled
   */
  async _showMessageSkillDialog(opts) {
    let selectedSkill = null;
    let selectedTotal = 0;
    let luckSpend = 0;
    let cancelled = true;

    const calcOdds = (total, luck, dc) => {
      const needed = dc - total - luck;
      if (needed <= 1) return 100;
      if (needed > 10) return 0;
      return Math.round(((10 - needed + 1) / 10) * 100);
    };

    // Skill list
    const skillRows = (opts.skills || []).map(s => {
      return `<button type="button" class="ncm-hd-skill-btn" data-skill="${s.name}" data-total="${s.total}" data-stat="${s.stat}">
        <div class="ncm-hd-skill-check"><i class="fas fa-check"></i></div>
        <span class="ncm-hd-skill-name">${s.name}</span>
        <span class="ncm-hd-skill-detail">${s.stat} ${s.total} + 1d10</span>
        <span class="ncm-hd-skill-total">${s.total}</span>
      </button>`;
    }).join('');

    const skillListHTML = skillRows
      ? `<div class="ncm-hd-section-label"><i class="fas fa-crosshairs"></i> SELECT SKILL</div>
         <div class="ncm-hd-skill-list">${skillRows}</div>`
      : '';

    // Luck gauge
    const maxLuck = opts.availableLuck || 0;
    let luckHTML = '';
    if (maxLuck > 0) {
      const segs = Array.from({ length: maxLuck }, (_, i) =>
        `<div class="ncm-hd-luck-seg" data-seg="${i}"></div>`
      ).join('');
      luckHTML = `
        <div class="ncm-hd-section-label"><i class="fas fa-clover"></i> LUCK BOOST <span class="ncm-hd-luck-avail">Available: ${maxLuck}</span></div>
        <div class="ncm-hd-luck-row">
          <button type="button" class="ncm-hd-luck-adj" data-adj="-1">&minus;</button>
          <div class="ncm-hd-luck-gauge">${segs}</div>
          <button type="button" class="ncm-hd-luck-adj" data-adj="+1">+</button>
          <span class="ncm-hd-luck-val ncm-hd-luck-val--zero">0</span>
        </div>`;
    } else {
      luckHTML = `<div class="ncm-hd-section-label" style="opacity:0.4;"><i class="fas fa-clover"></i> NO LUCK AVAILABLE</div>`;
    }

    // Odds gauge
    const oddsHTML = `
      <div class="ncm-hd-odds">
        <div class="ncm-hd-odds-header">
          <span class="ncm-hd-odds-label">Success Probability</span>
          <span class="ncm-hd-odds-pct" data-odds-pct>—</span>
        </div>
        <div class="ncm-hd-odds-track">
          <div class="ncm-hd-odds-fill" data-odds-fill style="width:0%;"></div>
        </div>
      </div>
      <div class="ncm-hd-breakdown" data-breakdown>Select a skill...</div>`;

    // BLACK ICE danger zone
    const isBlackICE = opts.isBlackICE || false;
    const ice = opts.iceInfo;
    let dangerHTML = '';
    if (isBlackICE && ice) {
      const iceImgHTML = ice.img
        ? `<img src="${ice.img}" alt="${ice.name}" class="ncm-hd-danger-portrait" />`
        : `<div class="ncm-hd-danger-icon"><i class="fas fa-radiation"></i></div>`;
      const iceClassHTML = ice.class ? `<span class="ncm-hd-danger-class">${ice.class}</span>` : '';
      const formulaLabel = ice.formula || (opts.encryptionType === 'RED_ICE' ? '5d6' : '3d6');
      dangerHTML = `
      <div class="ncm-hd-danger">
        ${iceImgHTML}
        <div class="ncm-hd-danger-text">
          <div class="ncm-hd-danger-label">${ice.name} — Lethal Countermeasures ${iceClassHTML}</div>
          <div class="ncm-hd-danger-sub">Failure deals <strong>${formulaLabel}</strong> damage directly.</div>
        </div>
      </div>`;
    }

    const content = `
      <div class="ncm-hd-body">
        <div class="ncm-hd-header">
          <div class="ncm-hd-icon" style="color:${opts.color || 'var(--ncm-secondary)'};">
            <i class="${opts.icon || 'fas fa-bolt'}"></i>
          </div>
          ${opts.subtitle ? `<div class="ncm-hd-subtitle">${opts.subtitle}</div>` : ''}
        </div>
        ${dangerHTML}
        ${skillListHTML}
        ${luckHTML}
        ${oddsHTML}
      </div>`;

    const themeClass = isBlackICE ? 'ncm-hd-theme-black'
      : opts.color === '#f7c948' || opts.color === 'var(--ncm-accent)' || opts.color === '#F0C55B'
        ? 'ncm-hd-theme-gold'
      : opts.color === '#FBBF24' ? 'ncm-hd-theme-gold'
      : 'ncm-hd-theme-cyan';

    await new Promise(resolve => {
      const d = new Dialog({
        title: opts.title || 'Skill Check',
        content,
        buttons: {
          execute: {
            icon: `<i class="${opts.executeIcon || 'fas fa-bolt'}"></i>`,
            label: opts.executeLabel || 'Execute',
            callback: () => { cancelled = false; },
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: 'Abort',
            callback: () => {},
          },
        },
        default: 'cancel',
        close: () => resolve(),
        render: html => {
          const jq = html.closest ? html : $(html);
          const body = jq.find('.ncm-hd-body').length ? jq : jq.parent();

          const updateAll = () => {
            const odds = selectedSkill ? calcOdds(selectedTotal, luckSpend, opts.dc) : 0;
            const cls = odds >= 60 ? 'high' : odds >= 30 ? 'mid' : 'low';
            body.find('[data-odds-pct]').text(selectedSkill ? odds + '%' : '—')
              .removeClass('high mid low').addClass(cls);
            body.find('[data-odds-fill]').css('width', (selectedSkill ? odds : 0) + '%')
              .removeClass('high mid low').addClass(cls);

            const bd = body.find('[data-breakdown]');
            if (!selectedSkill) {
              bd.html('Select a skill...');
            } else {
              let p = `<span class="ncm-hd-val">${selectedTotal}</span> <span class="ncm-hd-op">+</span> <span class="ncm-hd-die">1d10</span>`;
              if (luckSpend > 0) p += ` <span class="ncm-hd-op">+</span> <span class="ncm-hd-luck-color">${luckSpend} LUCK</span>`;
              p += ` <span class="ncm-hd-op" style="margin:0 4px;">vs</span> <span class="ncm-hd-vs">DV ${opts.dc}</span>`;
              bd.html(p);
            }

            const execBtn = body.closest('.dialog').find('button[data-button="execute"]');
            execBtn.prop('disabled', !selectedSkill).toggleClass('ncm-hd-btn--disabled', !selectedSkill);
          };

          // Skill selection
          body.find('.ncm-hd-skill-btn').on('click', function () {
            selectedSkill = this.dataset.skill;
            selectedTotal = parseInt(this.dataset.total) || 0;
            body.find('.ncm-hd-skill-btn').removeClass('ncm-hd-skill-btn--selected');
            $(this).addClass('ncm-hd-skill-btn--selected');
            updateAll();
          });

          // Luck adjustment
          body.find('.ncm-hd-luck-adj').on('click', function () {
            luckSpend = Math.max(0, Math.min(maxLuck, luckSpend + parseInt(this.dataset.adj)));
            body.find('.ncm-hd-luck-val').text(luckSpend)
              .toggleClass('ncm-hd-luck-val--zero', luckSpend === 0);
            body.find('.ncm-hd-luck-seg').each(function (i) {
              $(this).toggleClass('ncm-hd-luck-seg--filled', i < luckSpend);
            });
            updateAll();
          });

          // Disable execute until skill selected
          body.closest('.dialog').find('button[data-button="execute"]')
            .prop('disabled', true).addClass('ncm-hd-btn--disabled');
        },
      }, { classes: ['dialog', 'ncm-hack-dialog', themeClass], width: 360 });
      d.render(true);
    });

    if (cancelled || !selectedSkill) return null;
    return { skill: selectedSkill, luck: luckSpend, total: selectedTotal };
  }

  async close(options) {
    if (this._destructTimer) clearInterval(this._destructTimer);
    if (this._destructFillTimer) clearInterval(this._destructFillTimer);
    if (this._clockInterval) clearInterval(this._clockInterval);
    if (this._lockoutTimer) clearInterval(this._lockoutTimer);
    if (this._traceTimer) clearInterval(this._traceTimer);
    // Ambient strip animations
    if (this._ambientIntervals) {
      this._ambientIntervals.forEach(id => clearInterval(id));
      this._ambientIntervals = [];
    }
    if (this._ambientRAF) cancelAnimationFrame(this._ambientRAF);
    // Remove global keyboard listener
    if (this._boundKeydown) {
      document.removeEventListener('keydown', this._boundKeydown);
      this._boundKeydown = null;
      this._keydownBound = false;
    }
    return super.close(options);
  }
}
