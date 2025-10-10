/**
 * Message Viewer Application
 * File: scripts/ui/components/MessageViewer/MessageViewerApp.js
 * Module: cyberpunkred-messenger
 * Description: Main message viewer orchestrator
 */

import { MODULE_ID } from '../../../utils/constants.js';
import { BaseApplication } from '../BaseApplication.js';
import { MessageList } from './MessageList.js';
import { MessageDetail } from './MessageDetail.js';
import { MessageFilters } from './MessageFilters.js';
import { MessagePagination } from './MessagePagination.js';
import { EVENTS } from '../../../core/EventBus.js';

export class MessageViewerApp extends BaseApplication {
  constructor(journalEntry, options = {}) {
    super(options);
    
    this.journalEntry = journalEntry;
    
    // Initialize components
    this.messageList = new MessageList(this);
    this.messageDetail = new MessageDetail(this);
    this.messageFilters = new MessageFilters(this);
    this.messagePagination = new MessagePagination(this);
    
    // Register components
    this.registerComponent('messageList', this.messageList);
    this.registerComponent('messageDetail', this.messageDetail);
    this.registerComponent('messageFilters', this.messageFilters);
    this.registerComponent('messagePagination', this.messagePagination);
    
    // Load messages into state
    this._loadMessages();
  }
  
  /**
   * Default options
   */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "ncm-message-viewer",
      classes: ["ncm-app", "ncm-message-viewer"],
      template: "modules/cyberpunkred-messenger/templates/message-viewer/viewer.hbs",
      width: 900,
      height: 700,
      resizable: true,
      minimizable: true,
      title: "Night City Messages",
      tabs: [],
      scrollY: []
    });
  }
  
  /**
   * Get data for template
   */
  getData(options = {}) {
    const data = super.getData(options);
    
    // Get paginated messages
    const messageData = this.messageList.getPaginatedMessages();
    
    // Get current state
    const currentFilter = this.stateManager.get('currentFilter') || 'inbox';
    const searchTerm = this.stateManager.get('searchTerm') || '';
    const selectedMessageId = this.stateManager.get('selectedMessageId');
    const unreadCount = this.stateManager.getUnreadCount();
    
    // Advanced filters state
    const showAdvancedFilters = this.stateManager.get('showAdvancedFilters') || false;
    const advancedFilters = this.stateManager.get('advancedFilters') || {};
    
    // Get unique senders for filter dropdown
    const uniqueSenders = [...new Set(
      this.stateManager.getAllMessages().map(m => m.from)
    )].sort();
    
    // Check if any advanced filters are active
    const hasActiveFilters = Object.keys(advancedFilters).length > 0;
    
    // Get selected message
    const selectedMessage = selectedMessageId 
      ? this.stateManager.getMessageById(selectedMessageId)
      : null;
    
    return {
      ...data,
      messages: messageData.messages,
      currentPage: messageData.currentPage,
      totalPages: messageData.totalPages,
      totalMessages: messageData.totalMessages,
      selectedMessage: selectedMessage,
      currentFilter: currentFilter,
      searchTerm: searchTerm,
      unreadCount: unreadCount,
      
      // Filter data
      showAdvancedFilters: showAdvancedFilters,
      advancedFilters: advancedFilters,
      hasActiveFilters: hasActiveFilters,
      uniqueSenders: uniqueSenders,
      
      filters: {
        all: this.stateManager.getAllMessages().length,
        unread: unreadCount,
        saved: this.stateManager.getSavedMessages().length,
        spam: this.stateManager.getSpamMessages().length,
        sent: this.stateManager.getSentMessages().length,
        scheduled: this.stateManager.getScheduledMessages().length
      },
      
      // User info
      userName: game.user.character?.name || game.user.name,
      isGM: game.user.isGM
    };
  }
  
  /**
   * Activate event listeners
   */
  activateListeners(html) {
    super.activateListeners(html);
    
    // Filter buttons
    html.find('[data-action="filter"]').on('click', this._onFilterClick.bind(this));
    
    // Search input
    html.find('[data-action="search"]').on('input', this._onSearchInput.bind(this));
    
    // Message selection
    html.find('[data-action="select-message"]').on('click', this._onSelectMessage.bind(this));
    
    // Message actions
    html.find('[data-action="delete-message"]').on('click', this._onDeleteMessage.bind(this));
    html.find('[data-action="mark-spam"]').on('click', this._onMarkSpam.bind(this));
    html.find('[data-action="save-message"]').on('click', this._onSaveMessage.bind(this));
    html.find('[data-action="reply"]').on('click', this._onReply.bind(this));
    html.find('[data-action="share-to-chat"]').on('click', this._onShareToChat.bind(this));
    
    // Compose and refresh
    html.find('[data-action="compose"]').on('click', this._onCompose.bind(this));
    html.find('[data-action="refresh"]').on('click', this._onRefresh.bind(this));

    // Contact manager integration
    html.find('[data-action="open-contacts"]').on('click', this._onOpenContacts.bind(this));
    html.find('[data-action="add-sender-to-contacts"]').on('click', this._onAddSenderToContacts.bind(this));

    // Advanced filters toggle
    html.find('[data-action="toggle-filters"]').on('click', this._onToggleFilters.bind(this));
    
    // Filter field changes
    html.find('[data-filter-field]').on('change', this._onFilterFieldChange.bind(this));
    
    // Apply filters
    html.find('[data-action="apply-filters"]').on('click', this._onApplyFilters.bind(this));
    
    // Reset filters
    html.find('[data-action="reset-filters"]').on('click', this._onResetFilters.bind(this));
    
    // Open admin panel
    html.find('[data-action="open-admin"]').on('click', this._onOpenAdmin.bind(this));

    // Settings button
    html.find('[data-action="open-settings"]').on('click', this._onOpenSettings.bind(this));
    
    // Pagination
    html.find('[data-action="prev-page"]').on('click', this._onPrevPage.bind(this));
    html.find('[data-action="next-page"]').on('click', this._onNextPage.bind(this));
  }
  
  /**
   * Load messages from journal
   * @private
   */
  _loadMessages() {
    if (!this.journalEntry) return;
    
    const pages = this.journalEntry.pages.contents;
    const messages = pages.map(page => {
      const flags = page.flags[MODULE_ID] || {};
      return {
        id: page.id,
        from: flags.from || 'Unknown',
        to: flags.to || 'Unknown',
        subject: flags.subject || 'No Subject',
        body: flags.body || '',
        timestamp: flags.timestamp || new Date().toISOString(),
        network: flags.network || 'CITINET',
        status: flags.status || {
          read: false,
          saved: false,
          spam: false,
          encrypted: false,
          infected: false
        },
        preview: this._generatePreview(flags.body || '')
      };
    });
    
    this.stateManager.setMessages(messages);
  }
  
  /**
   * Generate message preview
   * @private
   */
  _generatePreview(body) {
    const plainText = body.replace(/<[^>]*>/g, '');
    return plainText.length > 100 
      ? plainText.substring(0, 100) + '...'
      : plainText;
  }
  
  /**
   * Filter click handler
   * @private
   */
  async _onFilterClick(event) {
    event.preventDefault();
    const filter = $(event.currentTarget).data('filter');
    this.stateManager.set('currentFilter', filter);
    this.stateManager.set('currentPage', 1);
    this.render();
  }
  
  /**
   * Search input handler
   * @private
   */
  async _onSearchInput(event) {
    const searchTerm = $(event.currentTarget).val();
    this.stateManager.set('searchTerm', searchTerm);
    this.stateManager.set('currentPage', 1);
    this.render();
  }
  
  /**
   * Select message handler
   * @private
   */
  async _onSelectMessage(event) {
    event.preventDefault();
    const messageId = $(event.currentTarget).data('message-id');
    
    // Mark as read
    await this.messageList.markAsRead(messageId);
    
    // Select message
    this.stateManager.set('selectedMessageId', messageId);
    this.render();
  }
  
  /**
   * Delete message handler
   * @private
   */
  async _onDeleteMessage(event) {
    event.preventDefault();
    const messageId = this.stateManager.get('selectedMessageId');
    
    if (!messageId) return;
    
    const confirm = await Dialog.confirm({
      title: "Delete Message",
      content: "<p>Are you sure you want to delete this message?</p>",
      yes: () => true,
      no: () => false
    });
    
    if (confirm) {
      await this.messageList.deleteMessage(messageId);
      this.stateManager.set('selectedMessageId', null);
      this.render();
      ui.notifications.info('Message deleted');
    }
  }
  
  /**
   * Mark spam handler
   * @private
   */
  async _onMarkSpam(event) {
    event.preventDefault();
    const messageId = this.stateManager.get('selectedMessageId');
    
    if (!messageId) return;
    
    await this.messageList.toggleSpam(messageId);
    this.render();
    ui.notifications.info('Message marked as spam');
  }
  
  /**
   * Save message handler
   * @private
   */
  async _onSaveMessage(event) {
    event.preventDefault();
    const messageId = this.stateManager.get('selectedMessageId');
    
    if (!messageId) return;
    
    await this.messageList.toggleSaved(messageId);
    this.render();
  }
  
  /**
   * Reply handler
   * @private
   */
  async _onReply(event) {
    event.preventDefault();
    const message = this.stateManager.get('selectedMessageId');
    
    if (!message) return;
    
    const messageData = this.stateManager.getMessageById(message);
    
    // Open composer with reply data
    const { MessageComposerApp } = await import('../MessageComposer/MessageComposerApp.js');
    new MessageComposerApp({
      replyTo: messageData
    }).render(true);
  }
  
  /**
   * Share to chat handler
   * @private
   */
  async _onShareToChat(event) {
    event.preventDefault();
    const messageId = this.stateManager.get('selectedMessageId');
    
    if (!messageId) return;
    
    await this.messageDetail.shareToChat(messageId);
    ui.notifications.info('Message shared to chat');
  }
  
  /**
   * Compose handler
   * @private
   */
  async _onCompose(event) {
    event.preventDefault();
    
    const { MessageComposerApp } = await import('../MessageComposer/MessageComposerApp.js');
    new MessageComposerApp().render(true);
  }
  
  /**
   * Refresh handler
   * @private
   */
  async _onRefresh(event) {
    event.preventDefault();
    this._loadMessages();
    this.render();
    ui.notifications.info('Messages refreshed');
  }

  /**
   * Open contact manager
   * @private
   */
  async _onOpenContacts(event) {
    event.preventDefault();
    
    const { ContactManagerApp } = await import('../ContactManager/ContactManagerApp.js');
    new ContactManagerApp().render(true);
  }

  /**
   * Add sender to contacts
   * @private
   */
  async _onAddSenderToContacts(event) {
    event.preventDefault();
    
    const messageId = this.stateManager.get('selectedMessageId');
    if (!messageId) return;
    
    const message = this.stateManager.getMessageById(messageId);
    if (!message) return;
    
    // Parse sender - format: "Name (email@domain.net)"
    const senderMatch = message.from.match(/^(.+?)\s*\((.+?)\)$/);
    
    if (!senderMatch) {
      ui.notifications.warn("Could not parse sender information.");
      return;
    }
    
    const [, name, email] = senderMatch;
    
    // Get current contacts
    const contacts = await game.user.getFlag(MODULE_ID, 'contacts') || [];
    
    // Check if already exists
    if (contacts.some(c => c.email === email.trim())) {
      ui.notifications.info(`${name} is already in your contacts.`);
      return;
    }
    
    // Add contact
    contacts.push({
      id: foundry.utils.randomID(),
      name: name.trim(),
      email: email.trim(),
      createdAt: new Date().toISOString()
    });
    
    await game.user.setFlag(MODULE_ID, 'contacts', contacts);
    ui.notifications.info(`Added ${name} to contacts.`);
    
    this.playSound('click');
  }

  /**
   * Open user settings panel
   * @private
   */
  async _onOpenSettings(event) {
    event.preventDefault();
    
    const { UserSettingsPanel } = await import('../Settings/UserSettingsPanel.js');
    new UserSettingsPanel().render(true);
    
    this.playSound('click');
  }

  /**
   * Toggle advanced filters panel
   * @private
   */
  _onToggleFilters(event) {
    event.preventDefault();
    
    const current = this.stateManager.get('showAdvancedFilters') || false;
    this.stateManager.set('showAdvancedFilters', !current);
    
    this.render(false);
    this.playSound('click');
  }

  /**
   * Handle filter field changes
   * @private
   */
  _onFilterFieldChange(event) {
    const field = $(event.currentTarget).data('filter-field');
    const value = event.currentTarget.type === 'checkbox' 
      ? event.currentTarget.checked 
      : $(event.currentTarget).val();
    
    // Store temporarily (apply on button click)
    const filters = this.stateManager.get('advancedFilters') || {};
    
    if (value === '' || value === false) {
      delete filters[field];
    } else {
      filters[field] = value;
    }
    
    this.stateManager.set('advancedFilters', filters);
  }

  /**
   * Apply advanced filters
   * @private
   */
  _onApplyFilters(event) {
    event.preventDefault();
    
    // Filters are already stored in state from field changes
    // Just re-render to apply them
    this.stateManager.set('currentPage', 1);
    this.render(false);
    
    ui.notifications.info('Filters applied');
    this.playSound('click');
  }

  /**
   * Reset advanced filters
   * @private
   */
  _onResetFilters(event) {
    event.preventDefault();
    
    this.stateManager.set('advancedFilters', {});
    this.stateManager.set('currentPage', 1);
    
    this.render(false);
    
    ui.notifications.info('Filters reset');
    this.playSound('click');
  }

  /**
   * Open admin panel (GM only)
   * @private
   */
  async _onOpenAdmin(event) {
    event.preventDefault();
    
    if (!game.user.isGM) {
      ui.notifications.warn('Only GMs can access admin tools');
      return;
    }
    
    const { AdminPanelApp } = await import('../AdminPanel/AdminPanelApp.js');
    new AdminPanelApp().render(true);
    
    this.playSound('click');
  }
  
  /**
   * Previous page handler
   * @private
   */
  async _onPrevPage(event) {
    event.preventDefault();
    const currentPage = this.stateManager.get('currentPage') || 1;
    if (currentPage > 1) {
      this.stateManager.set('currentPage', currentPage - 1);
      this.render();
    }
  }
  
  /**
   * Next page handler
   * @private
   */
  async _onNextPage(event) {
    event.preventDefault();
    const messageData = this.messageList.getPaginatedMessages();
    const currentPage = this.stateManager.get('currentPage') || 1;
    
    if (currentPage < messageData.totalPages) {
      this.stateManager.set('currentPage', currentPage + 1);
      this.render();
    }
  }
}