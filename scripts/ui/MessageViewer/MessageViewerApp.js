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
    position: { width: 820, height: 600 },
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

  /** @type {Set<string>} IDs of bulk-selected messages */
  bulkSelected = new Set();

  /** @type {Array|null} Cached messages from last load */
  _cachedMessages = null;

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

    // ── Messages: load → filter → sort → paginate → enrich ──
    const allMessages = await this._loadMessages();
    const filtered = this._applyFilters(allMessages);
    const sorted = this._applySorting(filtered);
    const paginated = this._applyPagination(sorted);

    // ── Actor/Contact identity for inbox header ──
    const viewingActor = this.actorId ? game.actors?.get(this.actorId) : null;
    let viewingAsName, viewingAsPortrait, viewingAsInitial, viewingAsEmail;

    if (viewingActor) {
      viewingAsName = viewingActor.name;
      viewingAsPortrait = viewingActor.img || null;
      viewingAsInitial = getInitials(viewingActor.name || 'Unknown');
      viewingAsEmail = this.contactRepository?.getActorEmail?.(this.actorId) || '';
    } else {
      // Virtual inbox — resolve from master contact
      const masterContact = game.nightcity?.masterContactService?.getContact(this.actorId);
      viewingAsName = masterContact?.name || 'Unknown Contact';
      viewingAsPortrait = masterContact?.portrait || null;
      viewingAsInitial = getInitials(viewingAsName);
      viewingAsEmail = masterContact?.email || '';
    }

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

    // ── v3.2: Network pill color state ──
    const netPillState = getNetPillState(signalStrength, isDeadZone);

    // ── v3.2: Identity drawer data ──
    const viewingAsRole = viewingActor?.system?.role
      || viewingActor?.system?.lifepath?.role
      || '';
    const ownedCharacters = this._buildOwnedCharacters();

    // ── Assemble context ──
    return {
      // Identity
      viewingAsName,
      viewingAsPortrait,
      viewingAsInitial,
      viewingAsEmail,
      viewingAsRole,
      isGM: game.user.isGM,

      // v3.2 Navigation
      primaryTab,
      isMessagesTab,
      netPillState,

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

      // Feature 6-7: Special tab data
      scheduledMessages,
      shardItems,
      draftItems,

      // Layout
      density: this.density,
      sidebarWidth: this.sidebarWidth,

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

    // Bypass password input — Enter to submit
    const bypassInput = html.querySelector('.ncm-viewer__locked-bypass-input');
    if (bypassInput && !bypassInput._ncmBound) {
      bypassInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          this._bypassPassword(bypassInput.dataset.messageId);
        }
      });
      bypassInput._ncmBound = true;
    }

    // Sidebar resize
    const divider = html.querySelector('.ncm-viewer__divider');
    if (divider && !divider._ncmBound) {
      divider.addEventListener('mousedown', (event) => this._onDividerDrag(event));
      divider.addEventListener('dblclick', () => {
        this.sidebarWidth = DIVIDER_RESET_WIDTH;
        this._savePreferences();
        this.render();
      });
      divider._ncmBound = true;
    }

    // ── Real-time clock — tick TIME display every second ──
    if (this._clockInterval) clearInterval(this._clockInterval);
    const timeEl = html.querySelector('.ncm-viewer__hud-value--time');
    if (timeEl) {
      this._clockInterval = setInterval(() => {
        try {
          const now = this.timeService?.getCurrentTime?.() || new Date().toISOString();
          timeEl.textContent = formatCyberDate(now);
        } catch { /* non-critical */ }
      }, 1000);
    }

    // Feature 4 — Self-destruct timer update
    if (this._destructTimer) clearInterval(this._destructTimer);
    const destructEl = html.querySelector('[data-id="destruct-timer"]');
    if (destructEl) {
      const msg = this._getSelectedMessage();
      if (msg?.selfDestruct?.expiresAt) {
        this._destructTimer = setInterval(async () => {
          const remaining = new Date(msg.selfDestruct.expiresAt).getTime() - Date.now();
          if (remaining <= 0) {
            clearInterval(this._destructTimer);
            destructEl.innerHTML = '<i class="fas fa-skull-crossbones"></i> EXPIRED';
            // Auto-delete the message
            await this.messageService?.deleteMessage?.(this.actorId, msg.messageId);
            ui.notifications.warn('Self-destruct message expired and deleted.');
            setTimeout(() => {
              this.selectedMessageId = null;
              this.render();
            }, 1500);
            return;
          }
          const h = Math.floor(remaining / 3600000);
          const m = Math.floor((remaining % 3600000) / 60000);
          const s = Math.floor((remaining % 60000) / 1000);
          destructEl.innerHTML = `<i class="fas fa-hourglass-half" style="margin-right:3px;"></i> ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
        }, 1000);
      }
    }

    // ── Network access lockout countdown ──
    if (this._lockoutTimer) clearInterval(this._lockoutTimer);
    const lockoutEl = html.querySelector('.ncm-viewer__locked-timer');
    if (lockoutEl?.dataset.lockoutUntil) {
      this._lockoutTimer = setInterval(() => {
        const remaining = new Date(lockoutEl.dataset.lockoutUntil).getTime() - Date.now();
        if (remaining <= 0) {
          clearInterval(this._lockoutTimer);
          this._lockoutTimer = null;
          this.render(); // Re-render to show bypass options again
          return;
        }
        const m = Math.floor(remaining / 60000);
        const s = Math.floor((remaining % 60000) / 1000);
        lockoutEl.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
      }, 1000);
    }

    // ── WP-6: Trace countdown timer ──
    if (this._traceTimer) clearInterval(this._traceTimer);
    const traceEl = html.querySelector('.ncm-viewer__trace-timer');
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
      case 'set-density':
        this._setDensity(target.dataset.density);
        break;

      // ── Settings / GM ──
      case 'open-settings':
        game.nightcity?.openAdmin?.();
        break;

      // ── v3.2: Identity Drawer ──
      case 'toggle-identity-drawer':
        this._toggleIdentityDrawer();
        break;
      case 'close-identity-drawer':
        this._closeIdentityDrawer();
        break;

      // ── v3.2: Primary Tab Navigation ──
      case 'set-primary-tab': {
        const tab = target.dataset.tab;
        // Map primary tab to a default filter
        const tabFilterMap = { messages: 'inbox', shards: 'shards', scheduled: 'scheduled', drafts: 'drafts' };
        this._setFilter(tabFilterMap[tab] || 'inbox');
        break;
      }

      // ── v3.2: Header Actions ──
      case 'open-contacts': {
        const contactActorId = this.actorId || game.user?.character?.id;
        if (contactActorId) {
          game.nightcity?.openContacts?.(contactActorId);
        } else {
          ui.notifications.warn('NCM | No character assigned. Cannot open contacts.');
        }
        break;
      }
      case 'open-admin':
        game.nightcity?.openAdmin?.();
        break;
      case 'open-theme':
        game.nightcity?.openThemeCustomizer?.();
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
      case 'save-email': {
        const input = this.element?.querySelector('.ncm-viewer__drawer-field-input[data-field="email"]');
        if (input?.value && this.actorId) {
          this.contactRepository?.setActorEmail?.(this.actorId, input.value.trim());
          ui.notifications.info('NCM | Email updated.');
          this.render();
        }
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
        // Build grouped filter options and show as a simple dialog
        const networks = [...new Set(
          (await this._loadMessages()).map(m => m.network).filter(Boolean)
        )].sort();
        
        const content = `
          <div style="display:flex;flex-direction:column;gap:8px;padding:8px;">
            <div style="font-family:var(--ncm-font-title);font-size:9px;color:var(--ncm-secondary);text-transform:uppercase;letter-spacing:0.1em;">Network</div>
            ${networks.map(n => {
              const net = this.networkService?.getNetwork?.(n);
              const name = net?.name || n;
              const color = net?.theme?.color || '#8888a0';
              const active = this._filterTags?.includes(`net:${n}`) ? 'checked' : '';
              return `<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--ncm-text-primary);cursor:pointer;">
                <input type="checkbox" data-filter-tag="net:${n}" ${active} style="accent-color:${color}">
                <span style="color:${color}">${name}</span>
              </label>`;
            }).join('')}
            <div style="font-family:var(--ncm-font-title);font-size:9px;color:var(--ncm-secondary);text-transform:uppercase;letter-spacing:0.1em;margin-top:6px;">Status</div>
            ${['Encrypted', 'Has Attachments', 'Has Eddies'].map(s => {
              const key = `status:${s.toLowerCase().replace(/\s/g,'-')}`;
              const active = this._filterTags?.includes(key) ? 'checked' : '';
              return `<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--ncm-text-primary);cursor:pointer;">
                <input type="checkbox" data-filter-tag="${key}" ${active}>
                <span>${s}</span>
              </label>`;
            }).join('')}
          </div>`;

        const dlg = new Dialog({
          title: 'Message Filters',
          content,
          buttons: {
            apply: {
              icon: '<i class="fas fa-check"></i>',
              label: 'Apply',
              callback: (html) => {
                this._filterTags = [];
                html.find('[data-filter-tag]:checked').each((_, el) => {
                  this._filterTags.push(el.dataset.filterTag);
                });
                this.currentPage = 1;
                this.render(true);
              },
            },
            clear: {
              icon: '<i class="fas fa-times"></i>',
              label: 'Clear All',
              callback: () => {
                this._filterTags = [];
                this.currentPage = 1;
                this.render(true);
              },
            },
          },
          default: 'apply',
          classes: ['ncm-time-config-dialog'],
        }, { width: 280 });
        dlg.render(true);
        break;
      }

      // ── v3.2: Add Contact from detail ──
      case 'add-sender-contact': {
        const email = target.dataset.email;
        const name = target.dataset.name;
        if (email) {
          game.nightcity?.masterContactService?.createContact?.({ name: name || email.split('@')[0], email });
          ui.notifications.info(`NCM | Added ${name || email} to contacts.`);
          this.render();
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

    if (this._searchDebounce) clearTimeout(this._searchDebounce);

    this._searchDebounce = setTimeout(() => {
      this.searchTerm = value.trim();
      this.currentPage = 1;
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
    game.nightcity?.composeMessage?.({
      mode: 'reply',
      fromActorId: this.actorId,
      originalMessage: msg,
    });
  }

  _forwardMessage(messageId) {
    const msg = this._getSelectedMessage();
    if (!msg) return;
    game.nightcity?.composeMessage?.({
      mode: 'forward',
      fromActorId: this.actorId,
      originalMessage: msg,
    });
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
      game.nightcity?.openDataShard?.(item);
    } else {
      ui.notifications.warn('Data shard not found.');
    }
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

    const displayName = msg.from.split('@')[0] || 'Unknown';

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

  async _decryptMessage(messageId) {
    if (!messageId) return;
    const result = await this.messageService?.attemptDecrypt?.(messageId, this.actorId);
    if (result?.success) {
      this.render();
    }
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
  async _reconstructSignal(messageId) {
    if (!messageId) return;

    const msg = this._cachedMessages?.find(m => m.messageId === messageId);
    if (!msg?.signalDegradation || msg.signalDegradation.reconstructed) return;

    const actor = game.actors?.get(this.actorId);
    if (!actor) {
      ui.notifications.warn('NCM | No character assigned.');
      return;
    }

    const dc = msg.signalDegradation.reconstructDC ?? 15;
    const skillName = msg.signalDegradation.reconstructSkill ?? 'Electronics/Security Tech';

    const skillSvc = game.nightcity?.skillService;
    if (!skillSvc) {
      ui.notifications.warn('NCM | Skill system not available.');
      return;
    }

    const result = await skillSvc.performCheck(actor, skillName, {
      dc,
      flavor: `Reconstructing signal-degraded message`,
      context: 'ncm-signal-reconstruct',
    });

    if (result?.success) {
      await this.messageService?.updateMessageFlags?.(this.actorId, messageId, {
        signalDegradation: { ...msg.signalDegradation, reconstructed: true },
      });
      this.soundService?.play?.('hack-success');
      ui.notifications.info('NCM | Signal reconstructed — message restored.');
    } else {
      this.soundService?.play?.('hack-fail');
      ui.notifications.warn(`NCM | Reconstruction failed. (${result?.total ?? '?'} vs DV ${dc})`);
    }

    this.render();
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
        game.nightcity?.openDataShard?.(item);
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
    this.subscribe?.(EVENTS.NETWORK_CHANGED, () => this._debouncedRender());
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
    const lockedNetworkName = accessState.requiredNetworkName
      || this.networkService?.getNetwork?.(msg.network)?.name
      || msg.network || '';

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
    if (msg.traceExpiresAt && !traceCompleted && !game.user?.isGM) {
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
      lockedNetworkName,
      accessState,
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

      return {
        ...msg,
        ...this._enrichMessageDisplay(msg, currentNetworkName),
        selected: msg.messageId === this.selectedMessageId,
        bulkSelected: this.bulkSelected.has(msg.messageId),
        isNetworkLocked,
        lockedNetworkName: accessState.requiredNetworkName
          || this.networkService?.getNetwork?.(msg.network)?.name
          || msg.network || '',
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
    const contact = this._findContact(msg.from);
    const fromDisplay = contact?.name || msg.from?.split('@')[0] || 'Unknown';
    const fromInitial = (fromDisplay[0] || '?').toUpperCase();
    const fromPortrait = contact?.portrait || null;

    // ── Recipient display name ──
    const toContact = this._findContact(msg.to);
    const toDisplay = toContact?.name || msg.to?.split('@')[0] || 'Unknown';

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

    // §2.9 — Color-coded avatar
    const avatarColor = getAvatarColor(fromDisplay, contact);

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
        avatarColor: getAvatarColor(actor.name),
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
          avatarColor: getAvatarColor(actor.name),
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
            avatarColor: getAvatarColor(actor.name),
          });
        }
      }
    }

    return chars;
  }

  async close(options) {
    if (this._destructTimer) clearInterval(this._destructTimer);
    if (this._clockInterval) clearInterval(this._clockInterval);
    if (this._lockoutTimer) clearInterval(this._lockoutTimer);
    if (this._traceTimer) clearInterval(this._traceTimer);
    return super.close(options);
  }
}
