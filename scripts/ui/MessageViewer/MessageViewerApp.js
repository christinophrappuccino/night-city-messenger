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
import { EVENTS } from '../../utils/constants.js';

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

  // ═══════════════════════════════════════════════════════════
  //  Lifecycle
  // ═══════════════════════════════════════════════════════════

  constructor(options = {}) {
    super(options);
    this.actorId = options.actorId || game.user?.character?.id || null;
    this.subscribe(EVENTS.CONTACT_UPDATED, () => this.render());
    this._loadPreferences();
    this._setupEventSubscriptions();
  }

  // ═══════════════════════════════════════════════════════════
  //  Helper Utilities
  // ═══════════════════════════════════════════════════════════

  _getViewingAsName() {
    if (!this.actorId) return 'Unknown';
    const actor = game.actors?.get(this.actorId);
    return actor?.name || 'Unknown';
  }

  _findContact(address) {
    if (!address || !this.contactRepository) return null;
    try {
      return this.contactRepository.findByEmail?.(address)
        || this.contactRepository.findByAddress?.(address)
        || null;
    } catch {
      return null;
    }
  }

  _getThemePrefs() {
    try {
      return game.nightcity?.settingsManager?.getTheme?.() || {};
    } catch {
      return {};
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
    // ── Messages: load → filter → sort → paginate → enrich ──
    const allMessages = await this._loadMessages();
    const filtered = this._applyFilters(allMessages);
    const sorted = this._applySorting(filtered);
    const paginated = this._applyPagination(sorted);

    // ── Actor identity for inbox header ──
    const viewingActor = this.actorId ? game.actors?.get(this.actorId) : null;
    const viewingAsPortrait = viewingActor?.img || null;
    const viewingAsInitial = getInitials(viewingActor?.name || 'Unknown');
    const viewingAsEmail = this.contactRepository?.getActorEmail?.(this.actorId) || '';

    // ── Sort options for dropdown template ──
    const sortOptions = Object.entries(SORT_LABELS).map(([id, label]) => ({
      id,
      label,
      active: id === this.currentSort,
    }));

    // ── Category counts ──
    const counts = this._computeCounts(allMessages);

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

    // ── Assemble context ──
    return {
      // Identity
      viewingAsName: this._getViewingAsName(),
      viewingAsPortrait,
      viewingAsInitial,
      viewingAsEmail,
      isGM: game.user.isGM,

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

    // ── Re-render on network state changes (bind once) ──
    if (!this._networkChangeListenerBound) {
      const eventBus = game.nightcity?.eventBus;
      if (eventBus) {
        eventBus.on(EVENTS.NETWORK_CHANGED, () => this.render());
        eventBus.on(EVENTS.NETWORK_CONNECTED, () => this.render());
        eventBus.on(EVENTS.NETWORK_DISCONNECTED, () => this.render());
        this._networkChangeListenerBound = true;
      }
    }

    // Delegated click handler (bind once — element persists across renders)
    if (!this._delegatedClickBound) {
      html.addEventListener('click', (event) => this._onDelegatedClick(event));
      this._delegatedClickBound = true;
    }

    // Search input
    const searchInput = html.querySelector('.ncm-search-input');
    if (searchInput && !searchInput._ncmBound) {
      searchInput.addEventListener('input', (event) => this._onSearchInput(event));
      searchInput.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') this._toggleSearch();
      });
      searchInput._ncmBound = true;
    }

    // Sidebar resize
    const divider = html.querySelector('.ncm-panel-divider');
    if (divider && !divider._ncmBound) {
      divider.addEventListener('mousedown', (event) => this._onDividerDrag(event));
      divider.addEventListener('dblclick', () => {
        this.sidebarWidth = DIVIDER_RESET_WIDTH;
        this._savePreferences();
        this.render();
      });
      divider._ncmBound = true;
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Delegated Click Router
  // ═══════════════════════════════════════════════════════════

  _onDelegatedClick(event) {
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
      case 'reply':
        this._replyToMessage(messageId);
        break;
      case 'forward':
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
        game.nightcity?.messenger?.composeMessage?.({ actorId: this.actorId });
        break;

      // ── Encryption (original) ──
      case 'decrypt-message':
        this._decryptMessage(messageId);
        break;
      case 'force-decrypt-message':
        this._forceDecryptMessage(messageId);
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

  _toggleSearch() {
    this.searchActive = !this.searchActive;
    this.render();

    // Focus the input after render
    if (this.searchActive) {
      requestAnimationFrame(() => {
        const input = this.element?.querySelector('.ncm-search-input');
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

    return result;
  }

  _setFilter(filter) {
    this.currentFilter = filter;
    this.currentPage = 1;
    this.selectedMessageId = null;
    this.bulkSelected.clear();
    this.render();
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

  _selectMessage(messageId) {
    if (!messageId) return;

    this.selectedMessageId = messageId;
    this.render();

    // Mark as read
    this.messageService?.markRead?.(messageId, this.actorId);
    this.soundService?.play?.('click');
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
      await this.messageService?.markRead?.(id, this.actorId);
    }
    this.bulkSelected.clear();
    this.render();
  }

  async _bulkDelete() {
    for (const id of this.bulkSelected) {
      await this.messageService?.deleteMessage?.(id, this.actorId);
    }
    this.bulkSelected.clear();
    this.selectedMessageId = null;
    this.render();
  }

  async _bulkMarkSpam() {
    for (const id of this.bulkSelected) {
      await this.messageService?.markSpam?.(id, this.actorId);
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
    game.nightcity?.messenger?.composeMessage?.({
      actorId: this.actorId,
      to: msg.from,
      subject: `RE: ${msg.subject || ''}`,
      inReplyTo: msg.messageId,
      threadId: msg.threadId || msg.messageId,
    });
  }

  _forwardMessage(messageId) {
    const msg = this._getSelectedMessage();
    if (!msg) return;
    game.nightcity?.messenger?.composeMessage?.({
      actorId: this.actorId,
      subject: `FWD: ${msg.subject || ''}`,
      body: `\n\n--- Forwarded ---\nFrom: ${msg.from}\n${msg.body || ''}`,
    });
  }

  async _deleteMessage(messageId) {
    if (!messageId) return;
    await this.messageService?.deleteMessage?.(messageId, this.actorId);
    if (this.selectedMessageId === messageId) this.selectedMessageId = null;
    this.render();
  }

  async _toggleSave(messageId) {
    if (!messageId) return;
    await this.messageService?.toggleSave?.(messageId, this.actorId);
    this.render();
  }

  async _markSpam(messageId) {
    if (!messageId) return;
    await this.messageService?.markSpam?.(messageId, this.actorId);
    this.render();
  }

  async _shareToChat(messageId) {
    const msg = this._getSelectedMessage();
    if (!msg) return;
    game.nightcity?.chatIntegration?.shareMessage?.(msg);
  }

  _sendQuickReply(replyText) {
    if (!replyText || !this.selectedMessageId) return;
    const msg = this._getSelectedMessage();
    if (!msg) return;

    game.nightcity?.messenger?.sendMessage?.({
      actorId: this.actorId,
      to: msg.from,
      subject: `RE: ${msg.subject || ''}`,
      body: replyText,
      inReplyTo: msg.messageId,
      threadId: msg.threadId || msg.messageId,
    });
    this.soundService?.play?.('send');
  }

  _sendCustomReply() {
    const input = this.element?.querySelector('.ncm-quick-reply-input');
    const text = input?.value?.trim();
    if (!text) return;
    this._sendQuickReply(text);
    if (input) input.value = '';
  }

  async _decryptMessage(messageId) {
    if (!messageId) return;
    game.nightcity?.messenger?.attemptDecrypt?.(messageId, this.actorId);
  }

  async _forceDecryptMessage(messageId) {
    if (!messageId || !game.user.isGM) return;
    await this.messageService?.forceDecrypt?.(messageId);
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

    // Delegate to Foundry's file viewer or trigger download
    if (att.path || att.url) {
      const fileUrl = att.path || att.url;
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

    // Find the dropdown relative to the trigger
    const container = triggerEl.closest('.ncm-inbox-network, .ncm-tab-control, .ncm-sort-control, .ncm-network-filter-control');
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

    // Find the selector wrap
    const container = triggerEl.closest('.ncm-inbox-network');
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
    const panel = html?.querySelector('.ncm-message-list-panel');

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
    this.subscribe?.('message:received', () => this._debouncedRender());
    this.subscribe?.('message:read', () => this._debouncedRender());
    this.subscribe?.('message:deleted', () => this._debouncedRender());
    this.subscribe?.('network:changed', () => this._debouncedRender());
    this.subscribe?.('theme:changed', () => this._debouncedRender());
  }

  // ═══════════════════════════════════════════════════════════
  //  Data Loading & Enrichment
  // ═══════════════════════════════════════════════════════════

  async _loadMessages() {
    if (!this.messageService || !this.actorId) return [];
    try {
      return await this.messageService.getMessages(this.actorId) || [];
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

    const displayData = this._enrichMessageDisplay(msg);
    const contact = this._findContact(msg.from);
    const attachments = msg.attachments || [];

    // §2.4 — Security verification strip
    const security = getSecurityStripData(msg, contact);

    // §2.6/2.8 — Classify attachments into encrypted vs regular
    const classified = classifyAttachments(attachments);

    return {
      ...msg,
      ...displayData,
      bodyRendered: this._renderMessageBody(msg.body),
      threadInfo: this._getThreadInfo(msg, allMessages),
      attachments,
      security,
      encryptedAttachments: classified.encrypted,
      regularAttachments: classified.regular,
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

    return messages.map(msg => ({
      ...msg,
      ...this._enrichMessageDisplay(msg, currentNetworkName),
      selected: msg.messageId === this.selectedMessageId,
      bulkSelected: this.bulkSelected.has(msg.messageId),
    }));
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

    // ── Network label (short name for badge) ──
    const networkLabel = msg.network || '';

    // ── Formatted time using TimeService or fallback ──
    let formattedTime = '';
    try {
      if (this.timeService?.formatCyberDate) {
        formattedTime = this.timeService.formatCyberDate(msg.timestamp);
      } else if (msg.timestamp) {
        const d = new Date(msg.timestamp);
        const yr = d.getFullYear();
        const mo = String(d.getMonth() + 1).padStart(2, '0');
        const dy = String(d.getDate()).padStart(2, '0');
        const hr = String(d.getHours()).padStart(2, '0');
        const mn = String(d.getMinutes()).padStart(2, '0');
        formattedTime = `${yr}.${mo}.${dy} // ${hr}:${mn}`;
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
    const networkBadgeLabel = msg.network || '';
    // Derive badge variant suffix for color matching
    let networkBadgeVariant = 'default';
    if (msgNetworkNorm.includes('dark')) networkBadgeVariant = 'darknet';
    else if (msgNetworkNorm.includes('corp')) networkBadgeVariant = 'corpnet';

    // Network badge icon — distinct per network
    const networkIconMap = {
      'darknet': 'fa-user-secret',
      'corpnet': 'fa-building',
      'citinet': 'fa-wifi',
    };
    const networkBadgeIcon = networkIconMap[networkBadgeVariant] || 'fa-network-wired';

    // Priority icon for detail panel tag-badge partial
    const priorityIconMap = {
      'critical': 'fas fa-triangle-exclamation',
      'urgent': 'fas fa-bolt',
    };
    const priorityIcon = priorityIconMap[(msg.priority || '').toLowerCase()] || '';

    // §2.7 — Threat badge for malware
    const threatBadge = getThreatBadgeData(msg);

    return {
      fromDisplay,
      fromInitial,
      fromPortrait,
      toDisplay,
      priorityVariant,
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
      threatBadge,
    };
  }

  _renderMessageBody(body) {
    if (!body) return '';
    // Basic HTML pass-through — Foundry will sanitize
    return body;
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
}
