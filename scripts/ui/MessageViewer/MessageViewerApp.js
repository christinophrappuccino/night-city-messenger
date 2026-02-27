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
 */

import { BaseApplication } from '../BaseApplication.js';
import {
  computeSignalBar,
  getInitials,
  getPriorityBadgeVariant,
  getSecurityStripData,
  classifyAttachments,
  getFileIcon,
} from '../../utils/designHelpers.js';

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

  /** @type {string|null} ID of the currently selected message */
  selectedMessageId = null;

  /** @type {string} Current filter category: inbox, unread, sent, saved, spam, trash */
  currentFilter = 'inbox';

  /** @type {string} Current sort mode */
  currentSort = 'newest';

  /** @type {string} Current search term */
  searchTerm = '';

  /** @type {boolean} Whether the search input is expanded */
  searchActive = false;

  /** @type {string|null} Network filter (null = all networks) */
  networkFilter = null;

  /** @type {number} Current page (1-indexed) */
  currentPage = 1;

  /** @type {string} Message density: compact, normal, comfortable */
  density = 'normal';

  /** @type {number} Sidebar width in px */
  sidebarWidth = DEFAULT_SIDEBAR_WIDTH;

  /** @type {Set<string>} Message IDs selected for bulk operations */
  bulkSelected = new Set();

  /** @type {string|null} Actor ID whose inbox we are viewing */
  actorId = null;

  /** @type {number|null} Debounce timer for search */
  _searchDebounce = null;

  /** @type {boolean} Is the user currently dragging the divider? */
  _isDragging = false;

  // ─────────────── Constructor ───────────────

  constructor(options = {}) {
    super(options);

    // Accept actorId from options or determine from user's character
    this.actorId = options.actorId || this._getDefaultActorId();

    // Load persisted preferences
    this._loadPreferences();
  }

  // ─────────────── Service Accessors ───────────────

  get messageService() { return game.nightcity?.messageService; }
  get networkService() { return game.nightcity?.networkService; }
  get themeService() { return game.nightcity?.themeService; }
  get soundService() { return game.nightcity?.soundService; }
  get timeService() { return game.nightcity?.timeService; }
  get contactRepository() { return game.nightcity?.contactRepository; }
  get eventBus() { return game.nightcity?.eventBus; }
  get settingsManager() { return game.nightcity?.settingsManager; }

  // ─────────────── Data Preparation ───────────────

  // ═══════════════════════════════════════════════════════════
  //  HUD Helpers
  // ═══════════════════════════════════════════════════════════

  /**
   * Derive connection status from signal strength and network state.
   * @param {number} signal — 0-100
   * @param {object} network — current network data
   * @returns {"CONNECTED"|"DEGRADED"|"NO_SIGNAL"}
   */
  _deriveConnectionStatus(signal, network) {
    if (!network || network.id === 'DEAD_ZONE' || signal <= 0) return 'NO_SIGNAL';
    if (signal < 30) return 'DEGRADED';
    return 'CONNECTED';
  }

  /**
   * Derive decorative latency from network properties.
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
    const enriched = await this._enrichMessages(paginated);

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
    const availableNetworks = this._getAvailableNetworks();
    const signalStrength = this.networkService?.getSignalStrength?.() ?? 100;
    const signalLevel = this._signalToLevel(signalStrength);

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
      currentNetwork,
      availableNetworks,
      signalStrength,
      signalLevel,
      signalQuality,
      signalSegments,

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

  // ─────────────── Event Binding ───────────────

  /** @override */
  _onRender(context, options) {
    super._onRender?.(context, options);

    const html = this.element;
    if (!html) return;

    // Delegated click handler
    html.addEventListener('click', (event) => this._onDelegatedClick(event));

    // Search input
    const searchInput = html.querySelector('.ncm-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => this._onSearchInput(e));
    }

    // Setup event subscriptions on first render
    if (!this._subscriptionsReady) {
      this._setupEventSubscriptions();
      this._subscriptionsReady = true;
    }
  }

  // ─────────────── Action Dispatch ───────────────

  _onDelegatedClick(event) {
    const target = event.target.closest('[data-action]');
    if (!target) return;

    const action = target.dataset.action;
    const messageId = target.dataset.messageId || target.closest('[data-message-id]')?.dataset.messageId;

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
      case 'next-page':
        this._setPage(this.currentPage + 1);
        break;
      case 'prev-page':
        this._setPage(this.currentPage - 1);
        break;

      // ── Search & Dropdowns ──
      case 'toggle-search':
        this._toggleSearch();
        break;
      case 'toggle-network-dropdown':
        this._toggleDropdown('.ncm-network-dropdown', target);
        break;
      case 'toggle-sort-dropdown':
        this._toggleDropdown('.ncm-sort-dropdown', target);
        break;
      case 'toggle-network-filter':
        this._toggleDropdown('.ncm-network-filter-dropdown', target);
        break;

      // ── Network ──
      case 'select-network':
        this._selectNetwork(target.dataset.networkId);
        break;
      case 'set-network-filter':
        this._setNetworkFilter(target.dataset.network || null);
        break;

      // ── Message Actions ──
      case 'reply-message':
        this._replyToMessage(messageId);
        break;
      case 'forward-message':
        this._forwardMessage(messageId);
        break;
      case 'save-message':
        this._saveMessage(messageId);
        break;
      case 'delete-message':
        this._deleteMessage(messageId);
        break;
      case 'share-to-chat':
        this._shareToChat(messageId);
        break;
      case 'quick-reply':
        this._sendQuickReply(target.dataset.text, messageId);
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
        this._bulkMarkRead();
        break;
      case 'bulk-delete':
        this._bulkDelete();
        break;
      case 'bulk-cancel':
        this.bulkSelected.clear();
        this.render();
        break;

      // ── Layout ──
      case 'set-density':
        this._setDensity(target.dataset.density);
        break;
      case 'compose-message':
        game.nightcity?.messenger?.composeMessage?.({ actorId: this.actorId });
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

  // ─────────────── Search ───────────────

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

  // ─────────────── Filtering ───────────────

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

  // ─────────────── Sorting ───────────────

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

  // ─────────────── Pagination ───────────────

  _applyPagination(messages) {
    const start = (this.currentPage - 1) * MESSAGES_PER_PAGE;
    return messages.slice(start, start + MESSAGES_PER_PAGE);
  }

  _setPage(page) {
    const maxPage = Math.max(1, Math.ceil(this._cachedMessages?.length || 0 / MESSAGES_PER_PAGE));
    this.currentPage = Math.max(1, Math.min(page, maxPage));
    this.render();
  }

  // ─────────────── Message Selection ───────────────

  _selectMessage(messageId) {
    if (!messageId) return;

    this.selectedMessageId = messageId;
    this.render();

    // Mark as read
    this.messageService?.markRead?.(messageId, this.actorId);
    this.soundService?.play?.('click');
  }

  // ─────────────── Bulk Selection ───────────────

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
    if (this.bulkSelected.has(this.selectedMessageId)) {
      this.selectedMessageId = null;
    }
    this.render();
  }

  // ─────────────── Message Actions ───────────────

  _replyToMessage(messageId) {
    const msg = this._getSelectedMessage();
    if (!msg) return;
    game.nightcity?.messenger?.composeMessage?.({
      actorId: this.actorId,
      to: msg.from,
      subject: msg.subject?.startsWith('RE:') ? msg.subject : `RE: ${msg.subject || ''}`,
      inReplyTo: msg.messageId,
      threadId: msg.threadId || msg.messageId,
    });
  }

  _forwardMessage(messageId) {
    const msg = this._getSelectedMessage();
    if (!msg) return;
    game.nightcity?.messenger?.composeMessage?.({
      actorId: this.actorId,
      subject: msg.subject?.startsWith('FWD:') ? msg.subject : `FWD: ${msg.subject || ''}`,
      body: `\n\n--- Forwarded Message ---\nFrom: ${msg.from}\nDate: ${msg.timestamp}\n\n${msg.body || ''}`,
    });
  }

  async _saveMessage(messageId) {
    if (!messageId) return;
    await this.messageService?.toggleSaved?.(messageId, this.actorId);
    this.render();
  }

  async _deleteMessage(messageId) {
    if (!messageId) return;
    await this.messageService?.deleteMessage?.(messageId, this.actorId);
    if (this.selectedMessageId === messageId) {
      this.selectedMessageId = null;
    }
    this.render();
  }

  _shareToChat(messageId) {
    const msg = this._getSelectedMessage();
    if (!msg) return;
    game.nightcity?.messenger?.shareToChat?.(msg);
    this.soundService?.play?.('click');
  }

  _sendQuickReply(text, messageId) {
    const msg = this._getSelectedMessage();
    if (!msg || !text) return;
    game.nightcity?.messenger?.sendMessage?.({
      from: this.contactRepository?.getActorEmail?.(this.actorId),
      to: msg.from,
      subject: msg.subject?.startsWith('RE:') ? msg.subject : `RE: ${msg.subject || ''}`,
      body: text,
      actorId: this.actorId,
      inReplyTo: msg.messageId,
      threadId: msg.threadId || msg.messageId,
    });
    this.soundService?.play?.('send');
  }

  // ─────────────── Network Selection ───────────────

  _selectNetwork(networkId) {
    if (!networkId || !game.user.isGM) return;
    this.networkService?.setCurrentNetwork?.(networkId);
    this.render();
  }

  _setNetworkFilter(network) {
    this.networkFilter = network || null;
    this.currentPage = 1;
    this.render();
  }

  // ─────────────── Density ───────────────

  _setDensity(density) {
    this.density = density || 'normal';
    this._savePreferences();
    this.render();
  }

  // ─────────────── Dropdown Management ───────────────

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
    html.querySelectorAll('.ncm-network-dropdown, .ncm-sort-dropdown, .ncm-network-filter-dropdown')
      .forEach(d => {
        if (!d.matches(selector)) d.classList.add('ncm-hidden');
      });

    // Find the dropdown relative to the trigger
    const container = triggerEl.closest('.ncm-network-badge, .ncm-tab-control, .ncm-network-filter-control');
    const dropdown = container?.querySelector(selector);
    if (dropdown) {
      dropdown.classList.toggle('ncm-hidden');
    }
  }

  // ─────────────── EventBus Subscriptions ───────────────

  _setupEventSubscriptions() {
    // Subscribe via BaseApplication's managed subscription (auto-cleanup)
    this.subscribe?.('message:received', () => this.render());
    this.subscribe?.('message:read', () => this.render());
    this.subscribe?.('message:deleted', () => this.render());
    this.subscribe?.('network:changed', () => this.render());
    this.subscribe?.('theme:changed', () => this.render());
  }

  // ─────────────── Data Loading Helpers ───────────────

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
    // This is a synchronous accessor for the cached message data
    // Used by action handlers that need quick access
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

  async _enrichMessages(messages) {
    this._cachedMessages = messages;

    return messages.map(msg => ({
      ...msg,
      ...this._enrichMessageDisplay(msg),
      selected: msg.messageId === this.selectedMessageId,
      bulkSelected: this.bulkSelected.has(msg.messageId),
    }));
  }

  _enrichMessageDisplay(msg) {
    // Sender display name
    const contact = this._findContact(msg.from);
    const fromDisplay = contact?.name || msg.from?.split('@')[0] || 'Unknown';
    const fromInitial = (fromDisplay[0] || '?').toUpperCase();
    const fromPortrait = contact?.portrait || null;

    // Recipient display name
    const toContact = this._findContact(msg.to);
    const toDisplay = toContact?.name || msg.to?.split('@')[0] || 'Unknown';

    // Priority badge variant for tag-badge partial
    const priorityVariant = getPriorityBadgeVariant(msg.priority || 'normal');

    // Network label (short name for badge)
    const networkLabel = msg.network || '';

    // Formatted time using TimeService or fallback
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

    // Body preview (for comfortable density)
    const bodyPreview = msg.body
      ? msg.body.replace(/<[^>]*>/g, '').substring(0, 120)
      : '';

    return {
      fromDisplay,
      fromInitial,
      fromPortrait,
      toDisplay,
      priorityVariant,
      networkLabel,
      formattedTime,
      bodyPreview,
    };
  }

  _computeCounts(messages) {
    const inbox = messages.filter(m => !m.status.deleted && !m.status.spam && !m.status.sent).length;
    const unread = messages.filter(m => !m.status.read && !m.status.deleted && !m.status.spam && !m.status.sent).length;
    const sent = messages.filter(m => m.status.sent && !m.status.deleted).length;
    const saved = messages.filter(m => m.status.saved && !m.status.deleted).length;
    const spam = messages.filter(m => m.status.spam && !m.status.deleted).length;
    const trash = messages.filter(m => m.status.deleted).length;
    const total = messages.length;

    return { total, inbox, unread, sent, saved, spam, trash };
  }

  // ─────────────── Display Formatting Helpers ───────────────

  _formatTimestamp(timestamp) {
    if (!timestamp) return '—';

    // Try TimeService for in-world time first
    if (this.timeService?.formatTime) {
      return this.timeService.formatTime(timestamp);
    }

    // Fallback: cyberpunk-style format
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return '—';

    const y = date.getFullYear();
    const mo = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const mi = String(date.getMinutes()).padStart(2, '0');

    return `${y}.${mo}.${d} // ${h}:${mi}`;
  }

  _formatTimestampFull(timestamp) {
    if (!timestamp) return '—';
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return '—';

    const y = date.getFullYear();
    const mo = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const mi = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');

    return `${y}.${mo}.${d} // ${h}:${mi}:${s}`;
  }

  _stripHtml(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
  }

  _renderMessageBody(body) {
    // Allow basic HTML but sanitize dangerous content
    if (!body) return '<p class="ncm-body-empty">[ No content ]</p>';
    // Wrap plain text in paragraph tags if no HTML detected
    if (!body.includes('<')) {
      return body.split('\n').filter(Boolean).map(p => `<p>${p}</p>`).join('');
    }
    return body;
  }

  _signalToLevel(strength) {
    if (strength >= 80) return 5;
    if (strength >= 60) return 4;
    if (strength >= 40) return 3;
    if (strength >= 20) return 2;
    if (strength > 0) return 1;
    return 0;
  }

  _getThreadInfo(msg, allMessages) {
    if (!msg.threadId) return null;
    const threadMessages = allMessages.filter(m => m.threadId === msg.threadId);
    if (threadMessages.length <= 1) return null;
    return { count: threadMessages.length, expanded: false };
  }

  // ─────────────── Network Data Helpers ───────────────

  _getCurrentNetworkData() {
    const networkService = this.networkService;
    if (!networkService) {
      return { id: 'CITINET', name: 'CITINET', icon: 'fas fa-wifi', requiresAuth: false };
    }
    const current = networkService.getCurrentNetwork?.();
    return current || { id: 'CITINET', name: 'CITINET', icon: 'fas fa-wifi', requiresAuth: false };
  }

  _getAvailableNetworks() {
    const networkService = this.networkService;
    if (!networkService) return [];
    const networks = networkService.getAvailableNetworks?.() || [];
    const currentId = networkService.getCurrentNetwork?.()?.id;
    return networks.map(n => ({ ...n, active: n.id === currentId }));
  }

  // ─────────────── Contact Lookup ───────────────

  _findContact(email) {
    if (!email || !this.contactRepository) return null;
    const contacts = this.contactRepository.getContacts?.(this.actorId) || [];
    return contacts.find(c => c.email === email) || null;
  }

  // ─────────────── Actor / Identity Helpers ───────────────

  _getDefaultActorId() {
    // Player's assigned character, or first owned actor
    if (game.user?.character?.id) return game.user.character.id;
    const owned = game.actors?.filter(a => a.isOwner);
    return owned?.[0]?.id || null;
  }

  _getViewingAsName() {
    if (!this.actorId) return 'Unknown';
    const actor = game.actors?.get(this.actorId);
    return actor?.name || 'Unknown';
  }

  _getThemePrefs() {
    try {
      return game.settings?.get(MODULE_ID, 'playerTheme') || {};
    } catch {
      return {};
    }
  }

  // ─────────────── Preference Persistence ───────────────

  _loadPreferences() {
    const prefs = this._getThemePrefs();
    this.density = prefs.messageDensity || 'normal';
    this.sidebarWidth = prefs.sidebarWidth || DEFAULT_SIDEBAR_WIDTH;
    this.currentSort = prefs.defaultSort || 'newest';
  }

  _savePreferences() {
    try {
      const current = this._getThemePrefs();
      game.settings?.set(MODULE_ID, 'playerTheme', {
        ...current,
        messageDensity: this.density,
        sidebarWidth: this.sidebarWidth,
        defaultSort: this.currentSort,
      });
    } catch (err) {
      console.warn(`${MODULE_ID} | Failed to save preferences:`, err);
    }
  }

  // ─────────────── Encryption Handlers ───────────────

  async _decryptMessage(messageId) {
    if (!messageId) return;
    try {
      const result = await game.nightcity?.dataShardService?.attemptMessageDecrypt?.(messageId, this.actorId);
      if (result?.success) {
        this.soundService?.play?.('hack-success');
      } else {
        this.soundService?.play?.('hack-fail');
      }
      this.render();
    } catch (err) {
      console.error(`${MODULE_ID} | Decrypt failed:`, err);
    }
  }

  async _forceDecryptMessage(messageId) {
    if (!messageId || !game.user.isGM) return;
    try {
      await game.nightcity?.messageService?.forceDecryptMessage?.(messageId);
      this.render();
    } catch (err) {
      console.error(`${MODULE_ID} | Force decrypt failed:`, err);
    }
  }

  // ─────────────── Sprint 2B: Attachment Handlers ───────────────

  /**
   * §2.6 — Attempt to breach an encrypted attachment via EventBus → attemptHack flow.
   * @param {string} messageId — Parent message ID
   * @param {string|number} attachmentIndex — Index of the attachment
   */
  async _breachAttachment(messageId, attachmentIndex) {
    if (!messageId || attachmentIndex == null) return;
    const idx = Number(attachmentIndex);

    try {
      this.soundService?.play?.('click');

      // Emit breach attempt via EventBus — DataShardService listens
      const result = await game.nightcity?.dataShardService?.attemptAttachmentBreach?.(
        messageId,
        idx,
        this.actorId
      );

      if (result?.success) {
        this.soundService?.play?.('hack-success');
        ui.notifications.info('Attachment breach successful. Data unlocked.');
      } else {
        this.soundService?.play?.('hack-fail');
        const reason = result?.reason || 'ICE countermeasure activated.';
        ui.notifications.warn(`Breach failed: ${reason}`);
      }

      this.render();
    } catch (err) {
      console.error(`${MODULE_ID} | Attachment breach error:`, err);
      ui.notifications.error('Breach attempt encountered an error.');
    }
  }

  /**
   * §2.6 — GM force-breach an encrypted attachment (bypasses checks).
   * @param {string} messageId — Parent message ID
   * @param {string|number} attachmentIndex — Index of the attachment
   */
  async _gmForceBreachAttachment(messageId, attachmentIndex) {
    if (!messageId || attachmentIndex == null || !game.user.isGM) return;
    const idx = Number(attachmentIndex);

    try {
      await game.nightcity?.messageService?.forceDecryptAttachment?.(messageId, idx);
      this.soundService?.play?.('hack-success');
      ui.notifications.info('GM: Attachment force-decrypted.');
      this.render();
    } catch (err) {
      console.error(`${MODULE_ID} | GM force breach error:`, err);
    }
  }

  /**
   * §2.8 — Open a regular (non-encrypted) attachment.
   * Delegates to Foundry's journal viewer, image viewer, or download.
   * @param {string} messageId — Parent message ID
   * @param {string|number} attachmentIndex — Index of the attachment
   */
  _openAttachment(messageId, attachmentIndex) {
    if (attachmentIndex == null) return;
    const idx = Number(attachmentIndex);

    const msg = this._getSelectedMessage();
    if (!msg) return;

    const attachment = msg.attachments?.[idx];
    if (!attachment) return;

    // If encrypted and not decrypted, don't open
    if (attachment.encrypted && !attachment.decrypted) {
      ui.notifications.warn('This attachment is ICE-protected. Breach required.');
      return;
    }

    // Delegate to the file viewer based on type
    if (attachment.journalId) {
      // Journal-linked attachment — open in Foundry journal
      const journal = game.journal?.get(attachment.journalId);
      journal?.sheet?.render(true);
    } else if (attachment.url) {
      // Direct URL — open in new tab or image viewer
      const ext = attachment.name?.split('.').pop()?.toLowerCase() || '';
      const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'];

      if (imageExts.includes(ext)) {
        new ImagePopout(attachment.url, { title: attachment.name }).render(true);
      } else {
        window.open(attachment.url, '_blank');
      }
    } else {
      ui.notifications.info(`File: ${attachment.name || 'Unknown file'}`);
    }

    this.soundService?.play?.('click');
  }

  // ─────────────── Thread Toggle ───────────────

  _toggleThread() {
    // Future: expand/collapse thread view
    ui.notifications.info('Thread view coming soon.');
  }
}
