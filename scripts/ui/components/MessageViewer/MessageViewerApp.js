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
import { TimeService } from '../../../services/TimeService.js';

export class MessageViewerApp extends BaseApplication {
  constructor(journalEntry, options = {}) {
    super(options);
    
    this.journalEntry = journalEntry;

    // Track which actor's inbox we're viewing (for GMs)
    this.selectedActorId = options.actorId || game.user.character?.id || null;

    this.timeService = TimeService.getInstance();
    
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

    // Format timestamps for display
    const formattedMessages = messageData.messages.map(msg => ({
      ...msg,
      formattedTimestamp: this.timeService.formatTimestamp(msg.timestamp),
      relativeTime: this.timeService.formatTimestamp(msg.timestamp, 'relative'),
      fullTimestamp: this.timeService.formatTimestamp(msg.timestamp, 'full')
    }));
    
    // Get all messages for counting
    const allMessages = this.stateManager.getAllMessages() || [];
    
    // Calculate counts manually (StateManager might not have these methods)
    const unreadCount = allMessages.filter(m => !m.status?.read && !m.status?.spam && !m.status?.deleted).length;
    const savedCount = allMessages.filter(m => m.status?.saved && !m.status?.deleted).length;
    const spamCount = allMessages.filter(m => m.status?.spam && !m.status?.deleted).length;
    const sentCount = allMessages.filter(m => m.status?.sent && !m.status?.deleted).length;
    const scheduledCount = allMessages.filter(m => m.status?.scheduled && !m.status?.deleted).length;
    
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
      unreadCount: unreadCount,
      
      // Filter data
      showAdvancedFilters: showAdvancedFilters,
      advancedFilters: advancedFilters,
      hasActiveFilters: hasActiveFilters,
      uniqueSenders: uniqueSenders,
      
      // Category counts
      filters: {
        all: allMessages.filter(m => !m.status?.deleted).length,
        unread: unreadCount,
        saved: savedCount,
        spam: spamCount,
        sent: sentCount,
        scheduled: scheduledCount
      },
      
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
      
      // Network (you might have this elsewhere)
      networkName: this.stateManager.get('currentNetwork') || 'CITINET'
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

    // Character selector
    html.find('[data-action="select-character"]').on('change', this._onCharacterSelect.bind(this));
    
    // Email setup button (for players without email)
    html.find('[data-action="setup-email"]').on('click', this._onSetupEmail.bind(this));
    
    // Message selection
    html.find('[data-action="select-message"]').on('click', this._onSelectMessage.bind(this));
    
    // Message actions
    html.find('[data-action="delete-message"]').on('click', this._onDeleteMessage.bind(this));
    html.find('[data-action="mark-spam"]').on('click', this._onMarkSpam.bind(this));
    html.find('[data-action="save-message"]').on('click', this._onSaveMessage.bind(this));
    html.find('[data-action="reply"]').on('click', this._onReply.bind(this));
    html.find('[data-action="forward"]').on('click', this._onForward.bind(this)); 
    html.find('[data-action="share-to-chat"]').on('click', this._onShareToChat.bind(this));
    
    // Compose and refresh
    html.find('[data-action="compose"]').on('click', this._onCompose.bind(this));
    html.find('[data-action="refresh"]').on('click', this._onRefresh.bind(this));

    // Contact manager integration
    html.find('[data-action="open-contacts"]').on('click', this._onOpenContacts.bind(this));
    html.find('[data-action="add-sender-to-contacts"]').on('click', this._onAddSenderToContacts.bind(this));

    // Reschedule Message
    html.find('[data-action="reschedule-message"]').on('click', (e) => {
      this._onRescheduleMessage(e);
    });

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
      
      // Get body: prefer flags.content, fallback to extracting from HTML
      let body = flags.content || '';
      
      if (!body && page.text?.content) {
        // Extract ONLY the message body from the styled HTML
        // The body is in the second div with padding:15px style
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = page.text.content;
        
        // Find all divs, the last one with padding:15px contains the body
        const contentDivs = tempDiv.querySelectorAll('div[style*="padding:15px"]');
        if (contentDivs.length > 0) {
          body = contentDivs[contentDivs.length - 1].innerHTML.trim();
        } else {
          // Fallback: strip all HTML
          body = page.text.content.replace(/<[^>]*>/g, '').trim();
        }
      }
      
      return {
        id: page.id,
        from: flags.from || 'Unknown',
        to: flags.to || 'Unknown',
        subject: flags.subject || 'No Subject',
        body: body,
        timestamp: flags.timestamp || new Date().toISOString(),
        network: flags.network || 'CITINET',
        status: flags.status || {
          read: false,
          saved: false,
          spam: false,
          encrypted: false,
          infected: false
        },
        preview: this._generatePreview(body)
      };
    });
    
    this.stateManager.setMessages(messages);
  }
  
  /**
   * Generate message preview
   * @private
   */
  _generatePreview(body) {
    let previewText = body;
    
    // Strip out reply/forward quoted sections
    // Remove anything in the styled quote divs
    previewText = previewText.replace(/<div style="border-left:[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');
    previewText = previewText.replace(/<hr[^>]*>/gi, '');
    
    // Strip all HTML tags
    const plainText = previewText.replace(/<[^>]*>/g, '').trim();
    
    // Return first 100 chars
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
    
    // Update selected actor
    this.selectedActorId = actorId;
    
    // Find or create inbox for this actor
    const actor = game.actors.get(actorId);
    if (!actor) {
      ui.notifications.error("Character not found");
      return;
    }
    
    // Find actor's inbox journal
    const inboxName = `${actor.name}'s Messages`;
    let inbox = game.journal.getName(inboxName);
    
    // Create inbox if it doesn't exist
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
    
    // Update journal entry
    this.journalEntry = inbox;
    
    // Reload messages
    this._loadMessages();
    
    // Reset state
    this.stateManager.set('currentPage', 1);
    this.stateManager.set('selectedMessageId', null);
    
    // Re-render
    this.render(false);
    
    this.playSound?.('click');
  }

  /**
   * Open email setup for current character
   * @private
   */
  async _onSetupEmail(event) {
    event.preventDefault();
    
    // Get the currently selected actor
    const selectedActor = this.selectedActorId ? game.actors.get(this.selectedActorId) : null;
    
    if (!selectedActor) {
      ui.notifications.warn("Please select a character first.");
      return;
    }
    
    const { PlayerEmailSetup } = await import('../../dialogs/PlayerEmailSetup.js');
    
    // Pass the selected actor
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
    
    const selectedActor = this.selectedActorId ? game.actors.get(this.selectedActorId) : null;
    
    if (!selectedActor) {
      ui.notifications.warn("Please select a character first.");
      return;
    }
    
    const messageId = this.stateManager.get('selectedMessageId');
    if (!messageId) return;
    
    const messageData = this.stateManager.getMessageById(messageId);
    if (!messageData) return;
    
    // Extract just the email address
    const { extractEmailAddress } = await import('../../../utils/validators.js');
    const recipientEmail = extractEmailAddress(messageData.from) || messageData.from;
    
    // Open composer with reply context
    const { MessageComposerApp } = await import('../MessageComposer/MessageComposerApp.js');
    new MessageComposerApp({
      actor: selectedActor,
      actorId: this.selectedActorId,
      mode: 'reply',
      to: recipientEmail,  // Just email
      subject: `Re: ${messageData.subject}`,
      originalMessage: messageData  // Pass full message for display
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
    
    // Open composer with forward context
    const { MessageComposerApp } = await import('../MessageComposer/MessageComposerApp.js');
    new MessageComposerApp({
      actor: selectedActor,
      actorId: this.selectedActorId,
      mode: 'forward',
      subject: `Fwd: ${messageData.subject}`,
      originalMessage: messageData  // Pass full message for display
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
    
    // Get the currently selected actor
    const selectedActor = this.selectedActorId ? game.actors.get(this.selectedActorId) : null;
    
    if (!selectedActor) {
      ui.notifications.warn("Please select a character first.");
      return;
    }
    
    const { MessageComposerApp } = await import('../MessageComposer/MessageComposerApp.js');
    
    // Pass the selected actor context
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
    
    // Get the currently selected actor
    const selectedActor = this.selectedActorId ? game.actors.get(this.selectedActorId) : null;
    
    if (!selectedActor) {
      ui.notifications.warn("Please select a character first.");
      return;
    }
    
    const { ContactManagerApp } = await import('../ContactManager/ContactManagerApp.js');
    
    // Pass the selected actor context
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
    
    // Use utility to parse email (handles both formats)
    const { extractEmailAddress } = await import('../../../utils/validators.js');
    const email = extractEmailAddress(message.from);
    
    if (!email) {
      ui.notifications.warn("Could not parse sender information.");
      return;
    }
    
    // Extract name (everything before email markers)
    const name = message.from
      .replace(/\s*<[^>]+>/, '')
      .replace(/\s*\([^)]+\)/, '')
      .trim() || email.split('@')[0];
    
    // Get current contacts
    const contacts = await game.user.getFlag(MODULE_ID, 'contacts') || [];
    
    // Check if already exists
    if (contacts.some(c => c.email === email)) {
      ui.notifications.info(`${name} is already in your contacts.`);
      return;
    }
    
    // Add contact
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
    
    const messages = this.stateManager.get('messages');
    const message = messages instanceof Map ? 
      messages.get(messageId) : messages.find(m => m.id === messageId);
    
    if (!message) return;
    
    // Check if this is a scheduled message
    const isScheduled = message.metadata?.messageType === 'scheduled';
    
    if (!isScheduled) {
      ui.notifications.warn('This is not a scheduled message');
      return;
    }
    
    try {
      // Get the schedule ID from the message
      const scheduleId = message.metadata?.scheduleId;
      
      if (!scheduleId) {
        ui.notifications.error('Unable to find schedule information');
        return;
      }
      
      // Open time picker
      const newTime = await this.timeService.pickDateTime({
        title: 'Reschedule Message',
        currentTime: message.scheduledTime || message.timestamp,
        allowPast: game.user.isGM,
        allowFuture: true
      });
      
      // Reschedule using the scheduling service
      await game.nightcity.schedulingService.rescheduleMessage(scheduleId, newTime);
      
      // Update the message display
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
   * Open user settings panel
   * @private
   */
  async _onOpenSettings(event) {
    event.preventDefault();
    
    // Get the currently selected actor
    const selectedActor = this.selectedActorId ? game.actors.get(this.selectedActorId) : null;
    
    if (!selectedActor) {
      ui.notifications.warn("Please select a character first.");
      return;
    }
    
    const { UserSettingsPanel } = await import('../Settings/UserSettingsPanel.js');
    
    // Pass the selected actor context
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
   * Show detailed time info:
   */
  showTimeDetails(messageId) {
    const message = this.stateManager.getMessageById(messageId);
    if (!message) return;
    
    const timeInfo = [];
    
    // Show ISO timestamp
    timeInfo.push(`<strong>Timestamp:</strong> ${message.timestamp}`);
    
    // Show formatted versions
    timeInfo.push(`<strong>12-hour:</strong> ${this.timeService.formatTimestamp(message.timestamp, '12h')}`);
    timeInfo.push(`<strong>24-hour:</strong> ${this.timeService.formatTimestamp(message.timestamp, '24h')}`);
    timeInfo.push(`<strong>Relative:</strong> ${this.timeService.formatTimestamp(message.timestamp, 'relative')}`);
    
    // If SimpleCalendar data exists
    if (message.simpleCalendarData) {
      timeInfo.push(`<strong>In-Game Time:</strong> ${message.simpleCalendarData.display}`);
    }
    
    // If scheduled
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
}