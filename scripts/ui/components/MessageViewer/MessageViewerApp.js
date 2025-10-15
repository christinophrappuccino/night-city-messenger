/**
 * Message Viewer Application
 * File: scripts/ui/components/MessageViewer/MessageViewerApp.js
 * Module: cyberpunkred-messenger
 * Description: Main message viewer orchestrator
 */

import { MODULE_ID, debugLog } from '../../../utils/constants.js';
import { BaseApplication } from '../BaseApplication.js';
import { MessageList } from './MessageList.js';
import { MessageDetail } from './MessageDetail.js';
import { MessageFilters } from './MessageFilters.js';
import { MessagePagination } from './MessagePagination.js';
import { EVENTS } from '../../../core/EventBus.js';
import { TimeService } from '../../../services/TimeService.js';
import { MessageRepository } from '../../../data/MessageRepository.js';
import { StateManager } from '../../../core/StateManager.js';
import { 
  constructMessageStatus, 
  extractBodyFromHTML, 
  generatePreview,
  calculateMessageCounts,
  isValidScheduledPlaceholder
} from '../../../utils/messageHelpers.js';

export class MessageViewerApp extends BaseApplication {
  constructor(journalEntry, options = {}) {
    super(options);
    
    this.journalEntry = journalEntry;
    this.selectedActorId = options.actorId || game.user.character?.id || null;
    this.messageRepository = new MessageRepository();
    this.timeService = TimeService.getInstance();
    
    // Store event unsubscribers for cleanup
    this.eventUnsubscribers = [];
    
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
    
    // Setup event listeners and load messages
    this._setupEventListeners();
    this._loadMessages();
  }
  
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
   * Get data for template rendering
   * @param {Object} options - Render options
   * @returns {Object} Template data
   */
  getData(options = {}) {
    const data = super.getData(options);
    
    // Get paginated messages
    const messageData = this.messageList.getPaginatedMessages();
    
    // Get current state
    const currentFilter = this.stateManager.get('currentFilter') || 'inbox';
    const searchTerm = this.stateManager.get('searchTerm') || '';
    const selectedMessageId = this.stateManager.get('selectedMessageId');

    // Format timestamps for display
    const formattedMessages = messageData.messages.map(msg => ({
      ...msg,
      selected: msg.id === selectedMessageId,
      formattedTimestamp: this.timeService.formatTimestamp(msg.timestamp),
      relativeTime: this.timeService.formatTimestamp(msg.timestamp, 'relative'),
      fullTimestamp: this.timeService.formatTimestamp(msg.timestamp, 'full')
    }));
    
    // Get all messages and calculate counts
    const allMessages = this.stateManager.getAllMessages() || [];
    const counts = calculateMessageCounts(allMessages);
    
    debugLog('Message counts:', counts);
    
    // Advanced filters state
    const showAdvancedFilters = this.stateManager.get('showAdvancedFilters') || false;
    const advancedFilters = this.stateManager.get('advancedFilters') || {};
    
    // Get unique senders for filter dropdown
    const uniqueSenders = [...new Set(
      allMessages.map(m => m.from).filter(f => f)
    )].sort();
    
    // Check if any advanced filters are active
    const hasActiveFilters = Object.keys(advancedFilters).length > 0;
    
    // Get selected message
    const selectedMessage = selectedMessageId 
      ? allMessages.find(m => m.id === selectedMessageId)
      : null;

    // Character selection data
    const selectedActor = this.selectedActorId ? game.actors.get(this.selectedActorId) : null;
    
    // Get available characters based on user
    let availableActors = [];
    
    if (game.user.isGM) {
      // GM sees all player characters
      availableActors = game.actors.contents
        .filter(a => a.hasPlayerOwner || a.type === 'character')
        .sort((a, b) => a.name.localeCompare(b.name));
    } else {
      // Player sees only their own characters
      availableActors = game.actors.contents
        .filter(a => a.isOwner)
        .sort((a, b) => a.name.localeCompare(b.name));
    }
    
    // Show selector if GM OR player has multiple characters
    const showCharacterSelector = game.user.isGM || availableActors.length > 1;
    
    return {
      ...data,
      messages: formattedMessages,
      currentPage: messageData.currentPage,
      totalPages: messageData.totalPages,
      totalMessages: messageData.totalMessages,
      selectedMessage: selectedMessage,
      currentFilter: currentFilter,
      searchTerm: searchTerm,
      unreadCount: counts.unread,
      
      // Filter data
      showAdvancedFilters: showAdvancedFilters,
      advancedFilters: advancedFilters,
      hasActiveFilters: hasActiveFilters,
      uniqueSenders: uniqueSenders,
      
      // Category counts (use calculated counts)
      filters: counts,
      
      // Character data
      isGM: game.user.isGM,
      selectedActor: selectedActor,
      selectedActorId: this.selectedActorId,
      availableActors: availableActors,
      showCharacterSelector: showCharacterSelector,
      userName: selectedActor?.name || game.user.name,
      
      // TimeService for current time
      currentTime: this.timeService.formatTimestamp(
        this.timeService.getCurrentTimestamp()
      ),
      
      // Network
      networkName: this.stateManager.get('currentNetwork') || 'CITINET'
    };
  }

  /**
   * Setup event listeners for auto-refresh
   * @private
   */
  _setupEventListeners() {
    // Store unsubscribers for proper cleanup
    this.eventUnsubscribers.push(
      this.eventBus.on(EVENTS.MESSAGE_RECEIVED, (data) => {
        if (data.journalId === this.journalEntry?.id || 
            data.actorId === this.selectedActorId) {
          debugLog('New message received, refreshing viewer');
          this._loadMessages();
          this.render(false);
        }
      })
    );
    
    this.eventUnsubscribers.push(
      this.eventBus.on(EVENTS.MESSAGE_SCHEDULED, (data) => {
        if (data.scheduleId || data.actorId === this.selectedActorId) {
          debugLog('Message scheduled, refreshing viewer');
          this._loadMessages();
          this.render(false);
        }
      })
    );
    
    this.eventUnsubscribers.push(
      this.eventBus.on(EVENTS.SCHEDULE_CANCELLED, (data) => {
        if (data.scheduleId || data.actorId === this.selectedActorId) {
          debugLog('Schedule cancelled, refreshing viewer');
          this._loadMessages();
          this.render(false);
        }
      })
    );
    
    this.eventUnsubscribers.push(
      this.eventBus.on(EVENTS.MESSAGE_SENT, (data) => {
        if (data.journalId === this.journalEntry?.id || 
            data.actorId === this.selectedActorId) {
          debugLog('Message sent, refreshing viewer');
          this._loadMessages();
          this.render(false);
        }
      })
    );
  }
  
  activateListeners(html) {
    super.activateListeners(html);
    
    // Filter buttons
    html.find('[data-action="filter"]').on('click', this._onFilterClick.bind(this));
    html.find('[data-action="search"]').on('input', this._onSearchInput.bind(this));
    html.find('[data-action="select-character"]').on('change', this._onCharacterSelect.bind(this));
    html.find('[data-action="setup-email"]').on('click', this._onSetupEmail.bind(this));
    
    // Message selection and actions
    html.find('[data-action="select-message"]').on('click', this._onSelectMessage.bind(this));
    html.find('[data-action="delete-message"]').on('click', this._onDeleteMessage.bind(this));
    html.find('[data-action="mark-spam"]').on('click', this._onMarkSpam.bind(this));
    html.find('[data-action="save-message"]').on('click', this._onSaveMessage.bind(this));
    html.find('[data-action="reply"]').on('click', this._onReply.bind(this));
    html.find('[data-action="forward"]').on('click', this._onForward.bind(this)); 
    html.find('[data-action="share-to-chat"]').on('click', this._onShareToChat.bind(this));
    
    // Compose and refresh
    html.find('[data-action="compose"]').on('click', this._onCompose.bind(this));
    html.find('[data-action="refresh"]').on('click', this._onRefresh.bind(this));
    html.find('[data-action="open-contacts"]').on('click', this._onOpenContacts.bind(this));
    html.find('[data-action="add-sender-to-contacts"]').on('click', this._onAddSenderToContacts.bind(this));
    
    // Scheduling actions
    html.find('[data-action="reschedule-message"]').on('click', this._onRescheduleMessage.bind(this));
    html.find('[data-action="cancel-schedule"]').on('click', this._onCancelSchedule.bind(this));
    
    // Advanced filters
    html.find('[data-action="toggle-filters"]').on('click', this._onToggleFilters.bind(this));
    html.find('[data-filter-field]').on('change', this._onFilterFieldChange.bind(this));
    html.find('[data-action="apply-filters"]').on('click', this._onApplyFilters.bind(this));
    html.find('[data-action="reset-filters"]').on('click', this._onResetFilters.bind(this));
    
    // Admin and settings
    html.find('[data-action="open-admin"]').on('click', this._onOpenAdmin.bind(this));
    html.find('[data-action="open-settings"]').on('click', this._onOpenSettings.bind(this));
    
    // Pagination
    html.find('[data-action="prev-page"]').on('click', this._onPrevPage.bind(this));
    html.find('[data-action="next-page"]').on('click', this._onNextPage.bind(this));
  }
  
  /**
   * Load messages from journal and update state
   * @private
   */
  _loadMessages() {
    if (!this.journalEntry) return;
    
    // Filter out pages that Foundry has marked as deleted
    const pages = this.journalEntry.pages.contents.filter(page => {
      return !page._tombstone && page.id;
    });
    
    const messages = pages.map(page => {
      const flags = page.flags[MODULE_ID] || {};
      
      // Get body: prefer flags.content, fallback to extracting from HTML
      let body = flags.content || '';
      
      if (!body && page.text?.content) {
        body = extractBodyFromHTML(page.text.content);
      }
      
      return {
        id: page.id,
        from: flags.from || 'Unknown',
        to: flags.to || 'Unknown',
        subject: flags.subject || 'No Subject',
        body: body,
        timestamp: flags.timestamp || new Date().toISOString(),
        network: flags.network || 'CITINET',
        status: constructMessageStatus(flags),
        metadata: flags.metadata || {},
        page: page,
        preview: generatePreview(body)
      };
    });

    // Filter out orphaned placeholders safely
    const allScheduled = game.nightcity?.schedulingService?.getAllScheduled() || [];
    const validMessages = messages.filter(message => 
      isValidScheduledPlaceholder(message, allScheduled)
    );

    this.stateManager.setMessages(validMessages);
  }
  
  /**
   * Filter click handler
   * @private
   */
  async _onFilterClick(event) {
    event.preventDefault();
    const filter = $(event.currentTarget).data('filter');
    
    const oldFilter = this.stateManager.get('currentFilter');
    
    this.stateManager.set('currentFilter', filter);
    this.stateManager.set('currentPage', 1);
    
    // Reload messages if switching filters
    if (oldFilter !== filter) {
      this._loadMessages();
    }
    
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
   * Handle character selection change (GM only)
   * @private
   */
  async _onCharacterSelect(event) {
    event.preventDefault();
    
    const actorId = $(event.currentTarget).val();
    
    if (!actorId) {
      ui.notifications.warn("Please select a character");
      return;
    }
    
    this.selectedActorId = actorId;
    
    const actor = game.actors.get(actorId);
    if (!actor) {
      ui.notifications.error("Character not found");
      return;
    }
    
    // Find actor's inbox journal
    const inboxName = `${actor.name}'s Messages`;
    let inbox = game.journal.getName(inboxName);
    
    // Create inbox if it doesn't exist (GM only)
    if (!inbox && game.user.isGM) {
      inbox = await JournalEntry.create({
        name: inboxName,
        folder: game.folders.getName("Player Messages")?.id
      });
      
      ui.notifications.info(`Created inbox for ${actor.name}`);
    }
    
    if (!inbox) {
      ui.notifications.error(`No inbox found for ${actor.name}`);
      return;
    }
    
    this.journalEntry = inbox;
    this._loadMessages();
    
    // Reset state
    this.stateManager.set('currentPage', 1);
    this.stateManager.set('selectedMessageId', null);
    
    this.render(false);
    this.playSound?.('click');
  }

  /**
   * Open email setup for current character
   * @private
   */
  async _onSetupEmail(event) {
    event.preventDefault();
    
    const selectedActor = this.selectedActorId ? game.actors.get(this.selectedActorId) : null;
    
    if (!selectedActor) {
      ui.notifications.warn("Please select a character first.");
      return;
    }
    
    const { PlayerEmailSetup } = await import('../../dialogs/PlayerEmailSetup.js');
    const success = await PlayerEmailSetup.show(selectedActor);
    
    if (success) {
      this.render(false);
    }
    
    this.playSound?.('click');
  }
  
  /**
   * Select message handler
   * @private
   */
  async _onSelectMessage(event) {
    event.preventDefault();
    const messageId = $(event.currentTarget).data('message-id');
    
    await this.messageList.markAsRead(messageId);
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
    
    const selectedActor = this.selectedActorId ? game.actors.get(this.selectedActorId) : null;
    
    if (!selectedActor) {
      ui.notifications.warn("Please select a character first.");
      return;
    }
    
    const messageId = this.stateManager.get('selectedMessageId');
    if (!messageId) return;
    
    const messageData = this.stateManager.getMessageById(messageId);
    if (!messageData) return;
    
    const { extractEmailAddress } = await import('../../../utils/validators.js');
    const recipientEmail = extractEmailAddress(messageData.from) || messageData.from;
    
    const { MessageComposerApp } = await import('../MessageComposer/MessageComposerApp.js');
    new MessageComposerApp({
      actor: selectedActor,
      actorId: this.selectedActorId,
      mode: 'reply',
      to: recipientEmail,
      subject: `Re: ${messageData.subject}`,
      originalMessage: messageData
    }).render(true);
    
    this.playSound('click');
  }

  /**
   * Forward handler
   * @private
   */
  async _onForward(event) {
    event.preventDefault();
    
    const selectedActor = this.selectedActorId ? game.actors.get(this.selectedActorId) : null;
    
    if (!selectedActor) {
      ui.notifications.warn("Please select a character first.");
      return;
    }
    
    const messageId = this.stateManager.get('selectedMessageId');
    if (!messageId) return;
    
    const messageData = this.stateManager.getMessageById(messageId);
    if (!messageData) return;
    
    const { MessageComposerApp } = await import('../MessageComposer/MessageComposerApp.js');
    new MessageComposerApp({
      actor: selectedActor,
      actorId: this.selectedActorId,
      mode: 'forward',
      subject: `Fwd: ${messageData.subject}`,
      originalMessage: messageData
    }).render(true);
    
    this.playSound('click');
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
    
    const selectedActor = this.selectedActorId ? game.actors.get(this.selectedActorId) : null;
    
    if (!selectedActor) {
      ui.notifications.warn("Please select a character first.");
      return;
    }
    
    const { MessageComposerApp } = await import('../MessageComposer/MessageComposerApp.js');
    
    new MessageComposerApp({
      actorId: this.selectedActorId,
      actor: selectedActor
    }).render(true);
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
    
    const selectedActor = this.selectedActorId ? game.actors.get(this.selectedActorId) : null;
    
    if (!selectedActor) {
      ui.notifications.warn("Please select a character first.");
      return;
    }
    
    const { ContactManagerApp } = await import('../ContactManager/ContactManagerApp.js');
    
    new ContactManagerApp({
      actorId: this.selectedActorId,
      actor: selectedActor
    }).render(true);
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
    
    const { extractEmailAddress } = await import('../../../utils/validators.js');
    const email = extractEmailAddress(message.from);
    
    if (!email) {
      ui.notifications.warn("Could not parse sender information.");
      return;
    }
    
    const name = message.from
      .replace(/\s*<[^>]+>/, '')
      .replace(/\s*\([^)]+\)/, '')
      .trim() || email.split('@')[0];
    
    const contacts = await game.user.getFlag(MODULE_ID, 'contacts') || [];
    
    if (contacts.some(c => c.email === email)) {
      ui.notifications.info(`${name} is already in your contacts.`);
      return;
    }
    
    contacts.push({
      id: foundry.utils.randomID(),
      name: name,
      email: email,
      createdAt: new Date().toISOString()
    });
    
    await game.user.setFlag(MODULE_ID, 'contacts', contacts);
    ui.notifications.info(`Added ${name} to contacts.`);
    
    this.playSound('click');
  }

  /**
   * Reschedule a scheduled message
   * @private
   */
  async _onRescheduleMessage(event) {
    event.preventDefault();
    
    const messageId = this.stateManager.get('selectedMessageId');
    if (!messageId) return;
    
    const message = this.stateManager.getMessageById(messageId);
    if (!message) return;
    
    const isScheduled = message.metadata?.messageType === 'scheduled';
    
    if (!isScheduled) {
      ui.notifications.warn('This is not a scheduled message');
      return;
    }
    
    try {
      const scheduleId = message.metadata?.scheduleId;
      
      if (!scheduleId) {
        ui.notifications.error('Unable to find schedule information');
        return;
      }
      
      const newTime = await this.timeService.pickDateTime({
        title: 'Reschedule Message',
        currentTime: message.scheduledTime || message.timestamp,
        allowPast: game.user.isGM,
        allowFuture: true
      });
      
      await game.nightcity.schedulingService.rescheduleMessage(scheduleId, newTime);
      
      message.scheduledTime = newTime;
      message.timestamp = newTime;
      
      ui.notifications.info(`Message rescheduled for ${this.timeService.formatTimestamp(newTime)}`);
      
      this.render(false);
      
    } catch (error) {
      if (error.message !== 'Cancelled') {
        console.error(`${MODULE_ID} | Error rescheduling message:`, error);
        ui.notifications.error(`Failed to reschedule: ${error.message}`);
      }
    }
  }

  /**
   * Cancel scheduled message
   * @private
   */
  async _onCancelSchedule(event) {
    event.preventDefault();
    
    const selectedId = this.stateManager.get('selectedMessageId');
    if (!selectedId) {
      ui.notifications.warn('No message selected');
      return;
    }
    
    const message = this.stateManager.getMessageById(selectedId);
    if (!message || !message.metadata?.isPlaceholder) {
      ui.notifications.warn('This is not a scheduled message');
      return;
    }
    
    const confirm = await Dialog.confirm({
      title: 'Cancel Scheduled Message',
      content: `
        <p>Cancel this scheduled message?</p>
        <p style="color: var(--ncm-primary, #F65261); margin-top: 10px;">
          <i class="fas fa-exclamation-triangle"></i>
          <strong>Warning:</strong> This will remove the scheduled message placeholder.
        </p>
      `
    });
    
    if (!confirm) return;
    
    try {
      // Delete the journal page
      if (message.page) {
        await message.page.delete();
        console.log(`${MODULE_ID} | Deleted scheduled message placeholder: ${message.id}`);
      }
      
      this.stateManager.removeMessage(selectedId);
      this.stateManager.set('selectedMessageId', null);
      
      // Optionally clean up scheduling service settings
      const scheduleId = message.metadata?.scheduleId;
      if (scheduleId && game.nightcity?.schedulingService) {
        try {
          await game.nightcity.schedulingService.cancelSchedule(scheduleId);
        } catch (error) {
          console.warn(`${MODULE_ID} | Could not remove from scheduling service:`, error.message);
        }
      }
      
      ui.notifications.info('Scheduled message cancelled');
      
      this._loadMessages();
      this.render(false);
      this.playSound?.('delete');
      
    } catch (error) {
      console.error(`${MODULE_ID} | Error cancelling scheduled message:`, error);
      ui.notifications.error(`Failed to cancel: ${error.message}`);
    }
  }

  /**
   * Open user settings panel
   * @private
   */
  async _onOpenSettings(event) {
    event.preventDefault();
    
    const selectedActor = this.selectedActorId ? game.actors.get(this.selectedActorId) : null;
    
    if (!selectedActor) {
      ui.notifications.warn("Please select a character first.");
      return;
    }
    
    const { UserSettingsPanel } = await import('../Settings/UserSettingsPanel.js');
    
    new UserSettingsPanel({
      actorId: this.selectedActorId,
      actor: selectedActor
    }).render(true);
    
    this.playSound?.('click');
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
   * Show detailed time info for a message
   * @param {string} messageId - Message ID
   */
  showTimeDetails(messageId) {
    const message = this.stateManager.getMessageById(messageId);
    if (!message) return;
    
    const timeInfo = [];
    
    timeInfo.push(`<strong>Timestamp:</strong> ${message.timestamp}`);
    timeInfo.push(`<strong>12-hour:</strong> ${this.timeService.formatTimestamp(message.timestamp, '12h')}`);
    timeInfo.push(`<strong>24-hour:</strong> ${this.timeService.formatTimestamp(message.timestamp, '24h')}`);
    timeInfo.push(`<strong>Relative:</strong> ${this.timeService.formatTimestamp(message.timestamp, 'relative')}`);
    
    if (message.simpleCalendarData) {
      timeInfo.push(`<strong>In-Game Time:</strong> ${message.simpleCalendarData.display}`);
    }
    
    if (message.metadata?.scheduled) {
      timeInfo.push(`<strong>Scheduled:</strong> Yes`);
    }
    
    new Dialog({
      title: 'Message Time Details',
      content: `
        <div class="ncm-time-details">
          ${timeInfo.map(info => `<div class="ncm-time-details__row">${info}</div>`).join('')}
        </div>
      `,
      buttons: {
        close: {
          icon: '<i class="fas fa-times"></i>',
          label: 'Close'
        }
      }
    }, {
      classes: ['dialog', 'ncm-dialog'],
      width: 500
    }).render(true);
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

  /**
   * Cleanup when viewer is closed
   * @returns {Promise<void>}
   */
  async close(options = {}) {
    // Clean up event listeners using stored unsubscribers
    this.eventUnsubscribers.forEach(unsubscribe => unsubscribe());
    this.eventUnsubscribers = [];
    
    // Call parent close
    return super.close(options);
  }
}