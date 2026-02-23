/**
 * Message Viewer Application
 * @file scripts/ui/MessageViewer/MessageViewerApp.js
 * @module cyberpunkred-messenger
 * @description Split-panel inbox UI with message list + detail pane.
 * Extends BaseApplication (ApplicationV2) with full messaging capabilities.
 */

import { MODULE_ID, EVENTS, TEMPLATES } from '../../utils/constants.js';

export class MessageViewerApp extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {

  // ─── Static Configuration ─────────────────────────────────

  static DEFAULT_OPTIONS = {
    id: 'ncm-message-viewer',
    classes: ['ncm-app', 'ncm-message-viewer'],
    tag: 'div',
    window: {
      title: 'Night City Messenger',
      icon: 'fas fa-envelope',
      resizable: true,
      minimizable: true,
    },
    position: {
      width: 800,
      height: 600,
    },
    actions: {
      selectMessage: MessageViewerApp._onSelectMessage,
      compose: MessageViewerApp._onCompose,
      reply: MessageViewerApp._onReply,
      forward: MessageViewerApp._onForward,
      deleteMessage: MessageViewerApp._onDelete,
      toggleSaved: MessageViewerApp._onToggleSaved,
      shareToChat: MessageViewerApp._onShareToChat,
      quickReply: MessageViewerApp._onQuickReply,
      filterMessages: MessageViewerApp._onFilter,
      searchMessages: MessageViewerApp._onSearch,
      refreshInbox: MessageViewerApp._onRefresh,
      openContacts: MessageViewerApp._onOpenContacts,
      prevPage: MessageViewerApp._onPrevPage,
      nextPage: MessageViewerApp._onNextPage,
    },
  };

  static PARTS = {
    viewer: {
      template: `modules/${MODULE_ID}/templates/message-viewer/message-viewer.hbs`,
    },
  };

  // ─── Instance State ───────────────────────────────────────

  /** @type {string|null} Currently viewing actor's inbox */
  actorId = null;

  /** @type {string|null} Selected message ID */
  selectedMessageId = null;

  /** @type {string} Current filter: inbox/sent/saved/deleted */
  currentFilter = 'inbox';

  /** @type {number} Current page (1-based) */
  currentPage = 1;

  /** @type {number} Messages per page */
  pageSize = 25;

  /** @type {string} Search term */
  searchTerm = '';

  /** @type {Array} Cached messages for current view */
  _messages = [];

  /** @type {Object|null} Currently selected message detail */
  _selectedMessage = null;

  /** @type {Array} EventBus subscription IDs for cleanup */
  _subscriptions = [];

  // ─── Service Accessors ────────────────────────────────────

  get messageService() { return game.nightcity.messageService; }
  get contactRepo() { return game.nightcity.contactRepository; }
  get soundService() { return game.nightcity.soundService; }
  get eventBus() { return game.nightcity.eventBus; }
  get notificationService() { return game.nightcity.notificationService; }

  // ─── Constructor ──────────────────────────────────────────

  constructor(options = {}) {
    super(options);
    this.actorId = options.actorId || this._getDefaultActorId();
  }

  // ─── Lifecycle ────────────────────────────────────────────

  async _prepareContext(options) {
    await this._loadMessages();

    const actor = game.actors.get(this.actorId);
    const totalPages = Math.ceil(this._messages.length / this.pageSize) || 1;
    const startIndex = (this.currentPage - 1) * this.pageSize;
    const pageMessages = this._messages.slice(startIndex, startIndex + this.pageSize);

    // Enrich messages with display data
    const messages = pageMessages.map(m => this._enrichMessage(m));

    // Get selected message detail
    let selectedMessage = null;
    if (this.selectedMessageId) {
      selectedMessage = this._messages.find(m => m.messageId === this.selectedMessageId);
      if (selectedMessage) {
        selectedMessage = this._enrichMessage(selectedMessage, true);
      }
    }

    // Get quick replies for this actor
    const quickReplies = this.contactRepo?.getQuickReplies(this.actorId) || 
      ['ACK', 'WILCO', 'NEGATIVE'];

    // Unread count
    const unreadCount = this._messages.filter(m => !m.status?.read && !m.status?.sent).length;

    return {
      actor: actor ? { id: actor.id, name: actor.name, img: actor.img } : null,
      email: this.contactRepo?.getActorEmail(this.actorId) || '',
      messages,
      selectedMessage,
      quickReplies,
      unreadCount,
      currentFilter: this.currentFilter,
      searchTerm: this.searchTerm,
      currentPage: this.currentPage,
      totalPages,
      hasNextPage: this.currentPage < totalPages,
      hasPrevPage: this.currentPage > 1,
      isEmpty: messages.length === 0,
      isGM: game.user.isGM,
      filters: [
        { id: 'inbox', label: 'Inbox', icon: 'fa-inbox', active: this.currentFilter === 'inbox' },
        { id: 'sent', label: 'Sent', icon: 'fa-paper-plane', active: this.currentFilter === 'sent' },
        { id: 'saved', label: 'Saved', icon: 'fa-star', active: this.currentFilter === 'saved' },
        { id: 'deleted', label: 'Deleted', icon: 'fa-trash', active: this.currentFilter === 'deleted' },
      ],
      MODULE_ID,
    };
  }

  _onRender(context, options) {
    this._setupEventSubscriptions();
    this._setupSearchInput();
    this._highlightSelectedMessage();
  }

  _onClose(options) {
    // Clean up EventBus subscriptions
    for (const unsub of this._subscriptions) {
      if (typeof unsub === 'function') unsub();
    }
    this._subscriptions = [];
  }

  // ─── Data Loading ─────────────────────────────────────────

  async _loadMessages() {
    if (!this.actorId) {
      this._messages = [];
      return;
    }

    let messages = await this.messageService.getMessages(this.actorId, {
      filter: this.currentFilter,
      sortBy: 'newest',
    });

    // Apply search filter
    if (this.searchTerm) {
      const q = this.searchTerm.toLowerCase();
      messages = messages.filter(m =>
        m.subject?.toLowerCase().includes(q) ||
        m.from?.toLowerCase().includes(q) ||
        m.to?.toLowerCase().includes(q) ||
        m.body?.toLowerCase().includes(q)
      );
    }

    this._messages = messages;
  }

  /**
   * Enrich a message with display-ready properties.
   * @param {Object} msg
   * @param {boolean} [full=false] - Include full body (for detail view)
   * @returns {Object}
   */
  _enrichMessage(msg, full = false) {
    const fromActor = game.actors.get(msg.fromActorId);
    const toActor = game.actors.get(msg.toActorId);

    return {
      ...msg,
      fromName: fromActor?.name || msg.from || 'Unknown',
      fromImg: fromActor?.img || 'icons/svg/mystery-man.svg',
      toName: toActor?.name || msg.to || 'Unknown',
      toImg: toActor?.img || 'icons/svg/mystery-man.svg',
      displayDate: this._formatDate(msg.timestamp),
      preview: full ? msg.body : this._stripHtml(msg.body || '').substring(0, 80),
      isSelected: msg.messageId === this.selectedMessageId,
      isUnread: !msg.status?.read && !msg.status?.sent,
      isSaved: msg.status?.saved || false,
      priorityClass: msg.priority === 'critical' ? 'ncm-priority--critical' :
                     msg.priority === 'urgent' ? 'ncm-priority--urgent' : '',
    };
  }

  // ─── Action Handlers ──────────────────────────────────────

  static async _onSelectMessage(event, target) {
    const messageId = target.closest('[data-message-id]')?.dataset.messageId;
    if (!messageId || messageId === this.selectedMessageId) return;

    this.selectedMessageId = messageId;

    // Mark as read if unread
    const msg = this._messages.find(m => m.messageId === messageId);
    if (msg && !msg.status?.read && !msg.status?.sent) {
      await this.messageService.markAsRead(this.actorId, messageId);
      msg.status.read = true;
    }

    this.soundService?.play('click');
    this.render();
  }

  static _onCompose(event, target) {
    game.nightcity.composeMessage?.({ fromActorId: this.actorId });
  }

  static _onReply(event, target) {
    if (!this._selectedMessage && this.selectedMessageId) {
      this._selectedMessage = this._messages.find(m => m.messageId === this.selectedMessageId);
    }
    if (!this._selectedMessage) return;

    game.nightcity.composeMessage?.({
      mode: 'reply',
      originalMessage: this._selectedMessage,
      fromActorId: this.actorId,
    });
  }

  static _onForward(event, target) {
    if (!this._selectedMessage && this.selectedMessageId) {
      this._selectedMessage = this._messages.find(m => m.messageId === this.selectedMessageId);
    }
    if (!this._selectedMessage) return;

    game.nightcity.composeMessage?.({
      mode: 'forward',
      originalMessage: this._selectedMessage,
      fromActorId: this.actorId,
    });
  }

  static async _onDelete(event, target) {
    const messageId = target.closest('[data-message-id]')?.dataset.messageId || this.selectedMessageId;
    if (!messageId) return;

    await this.messageService.deleteMessage(this.actorId, messageId);

    if (this.selectedMessageId === messageId) {
      this.selectedMessageId = null;
    }

    this.render();
  }

  static async _onToggleSaved(event, target) {
    const messageId = target.closest('[data-message-id]')?.dataset.messageId || this.selectedMessageId;
    if (!messageId) return;

    await this.messageService.toggleSaved(this.actorId, messageId);
    this.render();
  }

  static async _onShareToChat(event, target) {
    if (!this.selectedMessageId) return;
    const msg = this._messages.find(m => m.messageId === this.selectedMessageId);
    if (msg) {
      await this.messageService.shareToChat(msg, this.actorId);
      ui.notifications.info('Message shared to chat.');
    }
  }

  static async _onQuickReply(event, target) {
    const text = target.dataset.quickReply;
    if (!text || !this.selectedMessageId) return;

    const msg = this._messages.find(m => m.messageId === this.selectedMessageId);
    if (!msg) return;

    const result = await this.messageService.sendQuickReply(msg, this.actorId, text);
    if (result.success) {
      ui.notifications.info(`Quick reply sent: ${text}`);
    }
  }

  static _onFilter(event, target) {
    const filter = target.dataset.filter;
    if (!filter || filter === this.currentFilter) return;

    this.currentFilter = filter;
    this.currentPage = 1;
    this.selectedMessageId = null;
    this.soundService?.play('click');
    this.render();
  }

  static _onSearch(event, target) {
    // Handled by search input listener
  }

  static async _onRefresh(event, target) {
    this.selectedMessageId = null;
    this.render();
  }

  static _onOpenContacts(event, target) {
    game.nightcity.openContacts?.(this.actorId);
  }

  static _onPrevPage() {
    if (this.currentPage > 1) {
      this.currentPage--;
      this.render();
    }
  }

  static _onNextPage() {
    const totalPages = Math.ceil(this._messages.length / this.pageSize);
    if (this.currentPage < totalPages) {
      this.currentPage++;
      this.render();
    }
  }

  // ─── Event Subscriptions ──────────────────────────────────

  _setupEventSubscriptions() {
    // Clean previous subscriptions
    for (const unsub of this._subscriptions) {
      if (typeof unsub === 'function') unsub();
    }
    this._subscriptions = [];

    if (!this.eventBus) return;

    // Refresh on new messages
    const sub1 = this.eventBus.on(EVENTS.MESSAGE_RECEIVED, (data) => {
      if (data.toActorId === this.actorId) {
        this.render();
      }
    });
    this._subscriptions.push(() => this.eventBus.off(EVENTS.MESSAGE_RECEIVED, sub1));

    // Refresh on inbox refresh signal
    const sub2 = this.eventBus.on(EVENTS.INBOX_REFRESH, (data) => {
      if (data.actorId === this.actorId) {
        this.render();
      }
    });
    this._subscriptions.push(() => this.eventBus.off(EVENTS.INBOX_REFRESH, sub2));
  }

  _setupSearchInput() {
    const searchInput = this.element?.querySelector('.ncm-search-input');
    if (!searchInput) return;

    let debounceTimer;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        this.searchTerm = e.target.value;
        this.currentPage = 1;
        this.render();
      }, 300);
    });
  }

  _highlightSelectedMessage() {
    if (!this.selectedMessageId || !this.element) return;
    const item = this.element.querySelector(`[data-message-id="${this.selectedMessageId}"]`);
    if (item) {
      item.classList.add('ncm-message-item--selected');
      item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  // ─── Helpers ──────────────────────────────────────────────

  _getDefaultActorId() {
    // Use the user's primary character, or first owned actor
    if (game.user.character) return game.user.character.id;
    const owned = game.actors.find(a => a.isOwner && a.hasPlayerOwner);
    return owned?.id || null;
  }

  _formatDate(timestamp) {
    if (!timestamp) return '';
    try {
      const d = new Date(timestamp);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const hours = String(d.getHours()).padStart(2, '0');
      const mins = String(d.getMinutes()).padStart(2, '0');
      return `${year}.${month}.${day} // ${hours}:${mins}`;
    } catch {
      return timestamp;
    }
  }

  _stripHtml(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
  }
}
