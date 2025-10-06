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
      classes: ["ncm-app", "ncm-message-viewer"], // NCM classes for styling
      template: "modules/cyberpunkred-messenger/templates/viewer.html",
      width: 900,
      height: 700,
      resizable: true,
      minimizable: true,
      title: "Night City Messages",
      dragDrop: [{ dragSelector: null, dropSelector: null }],
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
    const currentFilter = this.stateManager.get('currentFilter');
    const searchTerm = this.stateManager.get('searchTerm');
    const selectedMessageId = this.stateManager.get('selectedMessageId');
    const unreadCount = this.stateManager.getUnreadCount();
    
    // Get selected message
    const selectedMessage = selectedMessageId 
      ? this.stateManager.get('messages').get(selectedMessageId)
      : null;
    
    return {
      ...data,
      journalEntry: this.journalEntry,
      
      // Messages
      messages: messageData.messages,
      selectedMessage: selectedMessage,
      
      // Filters
      currentFilter: currentFilter,
      searchTerm: searchTerm,
      
      // Pagination
      pagination: {
        currentPage: messageData.currentPage,
        totalPages: messageData.totalPages,
        totalCount: messageData.totalCount,
        hasNext: messageData.currentPage < messageData.totalPages,
        hasPrev: messageData.currentPage > 1
      },
      
      // Stats
      unreadCount: unreadCount,
      
      // User info
      characterName: game.user.character?.name || game.user.name,
      currentTime: this._getCurrentTime(),
      
      // Settings
      enableSounds: this.getSetting('enableSounds')
    };
  }
  
  /**
   * Load messages from journal into state
   * @private
   */
  _loadMessages() {
    if (!this.journalEntry || !this.journalEntry.pages) return;
    
    console.log(`${MODULE_ID} | Loading messages from journal:`, this.journalEntry.name);
    
    const messages = this.stateManager.get('messages');
    const unreadMessages = this.stateManager.get('unreadMessages');
    
    this.journalEntry.pages.forEach(page => {
      // Parse message data from page
      const message = this._pageToMessage(page);
      
      // Add to state
      messages.set(message.id, message);
      
      // Check if unread
      if (!this._isMessageRead(page)) {
        unreadMessages.add(message.id);
      }
    });
    
    console.log(`${MODULE_ID} | Loaded ${messages.size} messages, ${unreadMessages.size} unread`);
  }
  
  /**
   * Convert journal page to message object
   * @private
   */
  _pageToMessage(page) {
    const content = page.text?.content || '';
    
    // Extract metadata
    const from = this._extractField(content, 'From');
    const to = this._extractField(content, 'To');
    const subject = this._extractField(content, 'Subject');
    const date = this._extractField(content, 'Date');
    
    // Get status flags
    const status = page.getFlag(MODULE_ID, 'status') || {
      read: false,
      saved: false,
      spam: false
    };
    
    return {
      id: page.id,
      subject: subject || page.name,
      from: from,
      to: to,
      content: content,
      timestamp: date || page.getFlag(MODULE_ID, 'createdAt'),
      status: status,
      page: page // Keep reference for updates
    };
  }
  
  /**
   * Extract field from message content
   * @private
   */
  _extractField(content, fieldName) {
    const regex = new RegExp(`\\[${fieldName}\\](.+?)\\[End\\]`, 's');
    const match = content.match(regex);
    return match ? match[1].trim() : '';
  }
  
  /**
   * Check if message has been read
   * @private
   */
  _isMessageRead(page) {
    // Check flag
    const status = page.getFlag(MODULE_ID, 'status');
    if (status?.read) return true;
    
    // Check localStorage
    const readKey = `${MODULE_ID}-read-${this.journalEntry.id}-${page.id}`;
    return localStorage.getItem(readKey) === 'true';
  }
  
  /**
   * Get current time string
   * @private
   */
  _getCurrentTime() {
    // Check if SimpleCalendar is available
    if (game.modules.get('foundryvtt-simple-calendar')?.active) {
      try {
        return SimpleCalendar.api.currentDateTimeDisplay().display;
      } catch (e) {
        console.warn(`${MODULE_ID} | SimpleCalendar error:`, e);
      }
    }
    
    // Fallback to real-world time
    return new Date().toLocaleString();
  }
  
  /**
   * Lifecycle: First render
   */
  _onFirstRender() {
    console.log(`${MODULE_ID} | Message viewer first render`);
    
    // Play open sound
    this.playSound('open');
    
    // Emit event
    this.eventBus.emit(EVENTS.UI_VIEWER_OPENED, {
      journalId: this.journalEntry.id
    });
    
    // Register in state
    this.stateManager.get('activeViewers').add(this.appId);
  }
  
  /**
   * Activate listeners
   */
  activateListeners(html) {
    super.activateListeners(html);
    
    // Compose button
    html.find('.ncm-viewer__compose-btn').on('click', () => {
      this.eventBus.emit('composer:open', {});
      this.playSound('click');
    });
    
    // Settings button
    html.find('.ncm-viewer__settings-btn').on('click', () => {
      // Open settings
      this.playSound('click');
    });
  }
  
  /**
   * Close viewer
   */
  async close(options = {}) {
    // Emit event
    this.eventBus.emit(EVENTS.UI_VIEWER_CLOSED, {
      journalId: this.journalEntry.id
    });
    
    // Remove from active viewers
    this.stateManager.get('activeViewers').delete(this.appId);
    
    return super.close(options);
  }
}