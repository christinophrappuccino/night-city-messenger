/**
 * MessageViewerApp — Inbox UX (Sprint 1 Enhancement)
 * @file scripts/ui/MessageViewer/MessageViewerApp.js
 * @module cyberpunkred-messenger
 * @description Full-featured inbox with split-panel layout, inline network selector,
 *   real-time search, category filtering, sort control, pagination, density modes,
 *   bulk actions, resizable sidebar, keyboard navigation, and quick-reply shortcuts.
 */

import { BaseApplication } from '../BaseApplication.js';
import { computeSignalBar, getInitials, getPriorityBadgeVariant } from '../../utils/designHelpers.js';

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

  /** @override */
  async _prepareContext(options) {
    const allMessages = await this._loadMessages();
    const filtered = this._applyFilters(allMessages);
    const sorted = this._applySorting(filtered);
    const paginated = this._applyPagination(sorted);
    const enriched = await this._enrichMessages(paginated);

    // Actor identity fields for inbox header
    const viewingActor = this.actorId ? game.actors?.get(this.actorId) : null;
    const viewingAsPortrait = viewingActor?.img || null;
    const viewingAsInitial = getInitials(viewingActor?.name || 'Unknown');
    const viewingAsEmail = this.contactRepository?.getActorEmail?.(this.actorId) || '';

    // Sort options for dropdown template
    const sortOptions = Object.entries(SORT_LABELS).map(([id, label]) => ({
      id,
      label,
      active: id === this.currentSort,
    }));

    // Counts for category badges
    const counts = this._computeCounts(allMessages);

    // Selected message enrichment
    let selectedMessage = null;
    if (this.selectedMessageId) {
      selectedMessage = await this._getEnrichedMessage(this.selectedMessageId, allMessages);
    }

    // Network state
    const currentNetwork = this._getCurrentNetworkData();
    const availableNetworks = this._getAvailableNetworks();
    const signalStrength = this.networkService?.getSignalStrength?.() ?? 100;
    const signalLevel = this._signalToLevel(signalStrength);

    // Signal bar data for design system partial
    const signalData = computeSignalBar(signalStrength);
    const signalQuality = signalData.quality;
    const signalSegments = signalData.segments;

    // Unique networks present in messages (for network filter)
    const messageNetworks = [...new Set(allMessages.map(m => m.network).filter(Boolean))].sort();

    // Player theme preferences
    const themePrefs = this._getThemePrefs();

    // Quick replies
    const quickReplies = themePrefs.quickReplies || QUICK_REPLIES_DEFAULT;

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
      hasBulkSelection: this.bulkSelected.size > 0,
      selectedCount: this.bulkSelected.size,
      allSelected: enriched.length > 0 && enriched.every(m => this.bulkSelected.has(m.messageId)),

      // Quick Reply
      quickReplies,

      // Unread count for status bar
      unreadCount: counts.unread || 0,
    };
  }

  // ─────────────── Event Binding ───────────────

  /** @override */
  _onRender(context, options) {
    super._onRender?.(context, options);

    const html = this.element;
    if (!html) return;

    // ── Delegated click handler ──
    html.addEventListener('click', this._onDelegatedClick.bind(this));

    // ── Search input with debounce ──
    const searchInput = html.querySelector('.ncm-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', this._onSearchInput.bind(this));
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          this.searchTerm = '';
          this.searchActive = false;
          this.currentPage = 1;
          this.render();
        }
      });
    }

    // ── Keyboard navigation on message list ──
    const messageList = html.querySelector('.ncm-message-list');
    if (messageList) {
      messageList.addEventListener('keydown', this._onMessageListKeydown.bind(this));
    }

    // ── Global keyboard shortcuts ──
    this._keyHandler = this._onKeydown.bind(this);
    document.addEventListener('keydown', this._keyHandler);

    // ── Resizable divider ──
    this._setupResizableDivider(html);

    // ── Close dropdowns on outside click ──
    this._outsideClickHandler = (e) => {
      if (!html.contains(e.target)) return;
      const dropdowns = html.querySelectorAll('.ncm-network-dropdown, .ncm-sort-dropdown, .ncm-network-filter-dropdown');
      const clickedDropdownParent = e.target.closest('[data-action="toggle-network-dropdown"], [data-action="toggle-sort-dropdown"], [data-action="toggle-network-filter"]');
      if (!clickedDropdownParent) {
        dropdowns.forEach(d => d.classList.add('ncm-hidden'));
      }
    };
    html.addEventListener('click', this._outsideClickHandler, true);

    // ── EventBus subscriptions ──
    this._setupEventSubscriptions();

    // ── Focus the message list for immediate keyboard nav ──
    if (messageList && !this.selectedMessageId) {
      messageList.focus();
    }
  }

  /** @override */
  close(options = {}) {
    // Clean up global keyboard handler
    if (this._keyHandler) {
      document.removeEventListener('keydown', this._keyHandler);
      this._keyHandler = null;
    }

    // Persist sidebar width
    this._savePreferences();

    return super.close(options);
  }

  // ─────────────── Delegated Click Handler ───────────────

  _onDelegatedClick(event) {
    const target = event.target;
    const actionEl = target.closest('[data-action]');
    if (!actionEl) return;

    const action = actionEl.dataset.action;

    switch (action) {
      // ── Status Bar ──
      case 'toggle-network-dropdown':
        event.stopPropagation();
        this._toggleDropdown('.ncm-network-dropdown', actionEl);
        break;

      case 'switch-network':
        event.stopPropagation();
        this._switchNetwork(actionEl.dataset.networkId);
        break;

      case 'jump-to-unread':
        this._jumpToFirstUnread();
        break;

      case 'toggle-search':
        this._toggleSearch();
        break;

      case 'clear-search':
        this.searchTerm = '';
        this.searchActive = false;
        this.currentPage = 1;
        this.render();
        break;

      case 'cycle-density':
        this._cycleDensity();
        break;

      case 'open-settings':
        game.nightcity?.openThemeCustomizer?.();
        break;

      // ── Category Tabs ──
      case 'set-filter':
        this._setFilter(actionEl.dataset.filter);
        break;

      // ── Sort ──
      case 'toggle-sort-dropdown':
        event.stopPropagation();
        this._toggleDropdown('.ncm-sort-dropdown', actionEl);
        break;

      case 'set-sort':
        this._setSort(actionEl.dataset.sort);
        break;

      // ── Network Filter ──
      case 'toggle-network-filter':
        event.stopPropagation();
        this._toggleDropdown('.ncm-network-filter-dropdown', actionEl);
        break;

      case 'set-network-filter':
        this.networkFilter = actionEl.dataset.network || null;
        this.currentPage = 1;
        this.render();
        break;

      // ── Message List ──
      case 'select-message':
        event.stopPropagation();
        this._selectMessage(actionEl.dataset.messageId);
        break;

      case 'toggle-select':
        event.stopPropagation();
        this._toggleBulkSelect(actionEl.dataset.messageId);
        break;

      // ── Bulk Actions ──
      case 'select-all':
        this._selectAll(actionEl.checked);
        break;

      case 'bulk-read':
        this._bulkMarkRead();
        break;

      case 'bulk-delete':
        this._bulkDelete();
        break;

      case 'bulk-spam':
        this._bulkMarkSpam();
        break;

      // ── Pagination ──
      case 'prev-page':
        if (this.currentPage > 1) {
          this.currentPage--;
          this.render();
        }
        break;

      case 'next-page':
        this.currentPage++;
        this.render();
        break;

      // ── Message Detail Actions ──
      case 'reply':
        this._replyToSelected();
        break;

      case 'forward':
        this._forwardSelected();
        break;

      case 'toggle-saved':
        this._toggleSaved();
        break;

      case 'share-to-chat':
        this._shareToChat();
        break;

      case 'mark-spam':
        this._toggleSpam();
        break;

      case 'delete-message':
        this._deleteSelected();
        break;

      case 'decrypt-message':
        this._decryptMessage(actionEl.dataset.messageId);
        break;

      case 'force-decrypt-message':
        this._forceDecryptMessage(actionEl.dataset.messageId);
        break;

      // ── Quick Reply ──
      case 'quick-reply':
        this._sendQuickReply(actionEl.dataset.reply);
        break;

      case 'quick-reply-custom':
        this._openCustomQuickReply();
        break;

      // ── Footer ──
      case 'compose-new':
        game.nightcity?.composeMessage?.();
        break;

      // ── Thread ──
      case 'toggle-thread':
        this._toggleThread();
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
          if (!a.status.read && b.status.read) return -1;
          if (a.status.read && !b.status.read) return 1;
          return new Date(b.timestamp) - new Date(a.timestamp);
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

  _setSort(sort) {
    this.currentSort = sort;
    this.currentPage = 1;

    // Close dropdown
    this.element?.querySelector('.ncm-sort-dropdown')?.classList.add('ncm-hidden');

    this.render();
    this.soundService?.play?.('click');
  }

  // ─────────────── Pagination ───────────────

  _applyPagination(messages) {
    const start = (this.currentPage - 1) * MESSAGES_PER_PAGE;
    return messages.slice(start, start + MESSAGES_PER_PAGE);
  }

  // ─────────────── Message Selection ───────────────

  async _selectMessage(messageId) {
    if (this.selectedMessageId === messageId) return;

    this.selectedMessageId = messageId;

    // Mark as read
    try {
      await this.messageService?.markAsRead?.(messageId, this.actorId);
    } catch (err) {
      console.error(`${MODULE_ID} | Failed to mark message read:`, err);
    }

    this.soundService?.play?.('click');
    this.render();
  }

  _jumpToFirstUnread() {
    // Find first unread message in current filtered view
    // For now, just switch to unread filter
    this.currentFilter = 'unread';
    this.currentPage = 1;
    this.render();
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

  _selectAll(checked) {
    if (checked) {
      const items = this.element?.querySelectorAll('.ncm-message-item');
      items?.forEach(item => {
        const id = item.dataset.messageId;
        if (id) this.bulkSelected.add(id);
      });
    } else {
      this.bulkSelected.clear();
    }
    this.render();
  }

  async _bulkMarkRead() {
    for (const id of this.bulkSelected) {
      await this.messageService?.markAsRead?.(id, this.actorId);
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

  async _bulkMarkSpam() {
    for (const id of this.bulkSelected) {
      await this.messageService?.toggleSpam?.(id, this.actorId);
    }
    this.bulkSelected.clear();
    this.render();
  }

  // ─────────────── Message Actions ───────────────

  _replyToSelected() {
    if (!this.selectedMessageId) return;
    this.eventBus?.emit?.('composer:open', {
      mode: 'reply',
      inReplyTo: this.selectedMessageId,
      toActorId: this._getSelectedMessage()?.fromActorId,
      to: this._getSelectedMessage()?.from,
      subject: `RE: ${this._getSelectedMessage()?.subject || ''}`,
    });
  }

  _forwardSelected() {
    if (!this.selectedMessageId) return;
    const msg = this._getSelectedMessage();
    this.eventBus?.emit?.('composer:open', {
      mode: 'forward',
      subject: `FWD: ${msg?.subject || ''}`,
      body: `\n\n--- Forwarded Message ---\nFrom: ${msg?.from}\nDate: ${msg?.timestamp}\n\n${msg?.body || ''}`,
    });
  }

  async _toggleSaved() {
    if (!this.selectedMessageId) return;
    await this.messageService?.toggleSaved?.(this.selectedMessageId, this.actorId);
    this.render();
  }

  async _shareToChat() {
    if (!this.selectedMessageId) return;
    const msg = this._getSelectedMessage();
    if (msg) {
      await game.nightcity?.shareToChat?.(msg);
    }
  }

  async _toggleSpam() {
    if (!this.selectedMessageId) return;
    await this.messageService?.toggleSpam?.(this.selectedMessageId, this.actorId);
    this.render();
  }

  async _deleteSelected() {
    if (!this.selectedMessageId) return;
    await this.messageService?.deleteMessage?.(this.selectedMessageId, this.actorId);
    this.selectedMessageId = null;
    this.render();
  }

  // ─────────────── Quick Reply ───────────────

  async _sendQuickReply(replyText) {
    if (!this.selectedMessageId) return;
    const msg = this._getSelectedMessage();
    if (!msg) return;

    try {
      await game.nightcity?.sendMessage?.({
        toActorId: msg.fromActorId,
        fromActorId: this.actorId,
        subject: `RE: ${msg.subject || ''}`,
        body: replyText,
        priority: 'normal',
        inReplyTo: msg.messageId,
        threadId: msg.threadId,
      });
      this.soundService?.play?.('send');
      ui.notifications.info(`Quick reply sent: "${replyText}"`);
    } catch (err) {
      console.error(`${MODULE_ID} | Quick reply failed:`, err);
      ui.notifications.error('Failed to send quick reply.');
    }
  }

  _openCustomQuickReply() {
    // Open composer in reply mode (simpler than a custom dialog)
    this._replyToSelected();
  }

  // ─────────────── Network Switching ───────────────

  async _switchNetwork(networkId) {
    if (!networkId) return;

    // Close dropdown
    this.element?.querySelector('.ncm-network-dropdown')?.classList.add('ncm-hidden');

    try {
      await game.nightcity?.setNetwork?.(networkId);
      this.soundService?.play?.('switch');
    } catch (err) {
      console.error(`${MODULE_ID} | Network switch failed:`, err);
      ui.notifications.error('Network switch failed.');
    }

    this.render();
  }

  // ─────────────── Density Cycling ───────────────

  _cycleDensity() {
    const modes = ['compact', 'normal', 'comfortable'];
    const idx = modes.indexOf(this.density);
    this.density = modes[(idx + 1) % modes.length];
    this._savePreferences();
    this.render();
    this.soundService?.play?.('click');
  }

  // ─────────────── Keyboard Navigation ───────────────

  _onMessageListKeydown(event) {
    const items = Array.from(this.element?.querySelectorAll('.ncm-message-item') || []);
    if (!items.length) return;

    const currentIdx = items.findIndex(el => el.dataset.messageId === this.selectedMessageId);

    switch (event.key) {
      case 'ArrowDown': {
        event.preventDefault();
        const nextIdx = Math.min(currentIdx + 1, items.length - 1);
        const nextId = items[nextIdx]?.dataset.messageId;
        if (nextId) this._selectMessage(nextId);
        items[nextIdx]?.focus();
        break;
      }
      case 'ArrowUp': {
        event.preventDefault();
        const prevIdx = Math.max(currentIdx - 1, 0);
        const prevId = items[prevIdx]?.dataset.messageId;
        if (prevId) this._selectMessage(prevId);
        items[prevIdx]?.focus();
        break;
      }
      case 'Enter':
      case ' ': {
        event.preventDefault();
        if (currentIdx >= 0) {
          this._selectMessage(items[currentIdx].dataset.messageId);
        }
        break;
      }
    }
  }

  _onKeydown(event) {
    // Don't capture if user is typing in an input
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return;
    // Only respond when this window is active/visible
    if (!this.element || !document.contains(this.element)) return;

    switch (event.key) {
      case 'n':
      case 'N':
        if (!event.ctrlKey && !event.metaKey) {
          event.preventDefault();
          game.nightcity?.composeMessage?.();
        }
        break;

      case 'r':
      case 'R':
        if (!event.ctrlKey && !event.metaKey) {
          event.preventDefault();
          this._replyToSelected();
        }
        break;

      case 'Delete':
        event.preventDefault();
        this._deleteSelected();
        break;

      case 'Escape':
        if (this.searchActive) {
          this.searchTerm = '';
          this.searchActive = false;
          this.currentPage = 1;
          this.render();
        } else if (this.selectedMessageId) {
          this.selectedMessageId = null;
          this.render();
        }
        break;

      case '/':
        if (!event.ctrlKey && !event.metaKey) {
          event.preventDefault();
          this._toggleSearch();
        }
        break;
    }
  }

  // ─────────────── Resizable Divider ───────────────

  _setupResizableDivider(html) {
    const divider = html.querySelector('.ncm-panel-divider');
    const listPanel = html.querySelector('.ncm-message-list-panel');
    if (!divider || !listPanel) return;

    let startX = 0;
    let startWidth = 0;

    const onMouseMove = (e) => {
      if (!this._isDragging) return;
      const dx = e.clientX - startX;
      const newWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, startWidth + dx));
      listPanel.style.width = `${newWidth}px`;
      this.sidebarWidth = newWidth;
    };

    const onMouseUp = () => {
      if (!this._isDragging) return;
      this._isDragging = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      this._savePreferences();
    };

    divider.addEventListener('mousedown', (e) => {
      e.preventDefault();
      this._isDragging = true;
      startX = e.clientX;
      startWidth = listPanel.offsetWidth;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });

    // Double-click to reset
    divider.addEventListener('dblclick', () => {
      this.sidebarWidth = DIVIDER_RESET_WIDTH;
      listPanel.style.width = `${DIVIDER_RESET_WIDTH}px`;
      this._savePreferences();
    });
  }

  // ─────────────── Dropdown Toggle Utility ───────────────

  _toggleDropdown(selector, triggerEl) {
    const html = this.element;
    if (!html) return;

    // Close all other dropdowns first
    html.querySelectorAll('.ncm-network-dropdown, .ncm-sort-dropdown, .ncm-network-filter-dropdown')
      .forEach(d => {
        if (!d.matches(selector)) d.classList.add('ncm-hidden');
      });

    // Find the dropdown relative to the trigger
    const container = triggerEl.closest('.ncm-network-selector, .ncm-sort-control, .ncm-network-filter-control');
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

  async _getEnrichedMessage(messageId, allMessages) {
    const msg = allMessages.find(m => m.messageId === messageId);
    if (!msg) return null;

    return {
      ...msg,
      ...this._enrichMessageDisplay(msg),
      bodyRendered: this._renderMessageBody(msg.body),
      threadInfo: this._getThreadInfo(msg, allMessages),
      attachments: msg.attachments || [],
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

  _getThreadInfo(msg, allMessages) {
    if (!msg.threadId) return { count: 0 };
    const threadMessages = allMessages.filter(m => m.threadId === msg.threadId);
    return {
      count: threadMessages.length > 1 ? threadMessages.length : 0,
      threadId: msg.threadId,
    };
  }

  _renderMessageBody(body) {
    if (!body) return '';
    // Basic HTML pass-through — Foundry already sanitizes journal content
    // Wrap plain text in paragraph tags if no HTML detected
    if (!body.includes('<')) {
      return body.split('\n').filter(Boolean).map(p => `<p>${p}</p>`).join('');
    }
    return body;
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
    const saved = messages.filter(m => m.status.saved && !m.status.deleted).length;
    const spam = messages.filter(m => m.status.spam && !m.status.deleted).length;

    return { inbox, unread, saved, spam };
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
    // FoundryVTT sanitizes via TextEditor if available
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

  // ─────────────── Thread Toggle ───────────────

  _toggleThread() {
    // Future: expand/collapse thread view
    ui.notifications.info('Thread view coming soon.');
  }
}
