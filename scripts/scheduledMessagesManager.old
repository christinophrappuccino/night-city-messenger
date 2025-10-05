/**
 * Scheduled Messages Manager
 * Handles viewing and managing scheduled messages
 */
import { MODULE_ID, AUDIO } from './constants.js';
import { getCurrentDateTime, formatMessage } from './utils.js';
import { getSetting } from './settings.js';

export class ScheduledMessagesManager extends Application {
  constructor() {
    super();
    
    // Initialize properties
    this.scheduledMessages = [];
    this.selectedMessage = null;
  }
  
  /**
   * Application configuration
   */
  static get defaultOptions() {
    return mergeObject(super.defaultOptions, {
      template: `modules/${MODULE_ID}/templates/scheduled-messages.html`,
      title: "Scheduled Messages",
      id: "cyberpunk-scheduled-messages",
      width: 650,
      height: 500,
      resizable: true,
      minimizable: true,
      classes: ["cyberpunk-app"]
    });
  }
  
  /**
   * Get data for the template
   */
  async getData() {
    // Load scheduled messages
    await this.loadScheduledMessages();
    
    // Format messages for display
    const formattedMessages = this.scheduledMessages.map(message => {
      const scheduledDate = new Date(message.scheduledTime);
      
      // Important: Make sure useSimpleCalendar is a boolean, not a string
      const useSimpleCalendar = message.useSimpleCalendar === true || 
                               message.useSimpleCalendar === "true";
      
      return {
        ...message,
        formattedDate: scheduledDate.toLocaleString(),
        sender: message.sender ? game.users.get(message.sender)?.name || "Unknown" : "You",
        recipient: message.to.split('(')[0].trim(),
        isSimpleCalendar: useSimpleCalendar,
        isPastDue: this._isMessagePastDue(message)
      };
    });
    
    // Sort by scheduled time, earliest first
    formattedMessages.sort((a, b) => new Date(a.scheduledTime) - new Date(b.scheduledTime));
    
    // If a message is selected, make sure to include the useSimpleCalendar flag correctly
    let selectedMessageData = null;
    if (this.selectedMessage) {
      const useSimpleCalendar = this.selectedMessage.useSimpleCalendar === true || 
                               this.selectedMessage.useSimpleCalendar === "true";
      
      selectedMessageData = {
        ...this.selectedMessage,
        useSimpleCalendar: useSimpleCalendar
      };
    }
    
    return {
      messages: formattedMessages,
      selectedMessage: selectedMessageData,
      hasSimpleCalendar: game.modules.get("foundryvtt-simple-calendar")?.active,
      isGM: game.user.isGM,
      currentTime: getCurrentDateTime()
    };
  }
  
  /**
   * Load scheduled messages from settings
   */
  async loadScheduledMessages() {
    try {
      // For GMs, load all scheduled messages
      if (game.user.isGM) {
        this.scheduledMessages = game.settings.get(MODULE_ID, "scheduledMessages") || [];
      } else {
        // For players, only load their own messages
        const allMessages = game.settings.get(MODULE_ID, "scheduledMessages") || [];
        this.scheduledMessages = allMessages.filter(m => m.sender === game.user.id);
      }
      
      // Normalize useSimpleCalendar to be boolean
      this.scheduledMessages = this.scheduledMessages.map(message => ({
        ...message,
        useSimpleCalendar: message.useSimpleCalendar === true || message.useSimpleCalendar === "true"
      }));
      
      console.log(`${MODULE_ID} | Loaded ${this.scheduledMessages.length} scheduled messages`);
    } catch (error) {
      console.error(`${MODULE_ID} | Error loading scheduled messages:`, error);
      this.scheduledMessages = [];
    }
  }
  
  /**
   * Check if a message is past due - IMPROVED VERSION
   * @param {Object} message - Message object
   * @returns {boolean} True if past due
   * @private
   */
  _isMessagePastDue(message) {
    // Normalize useSimpleCalendar to be boolean
    const useSimpleCalendar = message.useSimpleCalendar === true || 
                             message.useSimpleCalendar === "true";
    
    // Check if using Simple Calendar and it's available
    if (useSimpleCalendar && game.modules.get("foundryvtt-simple-calendar")?.active && SimpleCalendar?.api) {
      try {
        console.log(`${MODULE_ID} | Checking in-game scheduled message:`, message);
        
        // Get current timestamp
        const currentTimestamp = SimpleCalendar.api.timestamp();
        console.log(`${MODULE_ID} | Current timestamp:`, currentTimestamp);
        
        // Get current date from timestamp
        const currentDate = SimpleCalendar.api.timestampToDate(currentTimestamp);
        console.log(`${MODULE_ID} | Current date from timestamp:`, currentDate);
        
        // Convert scheduled time to a date object
        const scheduledDate = new Date(message.scheduledTime);
        console.log(`${MODULE_ID} | Scheduled JS Date:`, scheduledDate);
        
        // Apply the adjustment: add 1 to the current day to match the UI
        const adjustedCurrentDate = {
          ...currentDate,
          day: currentDate.day + 1
        };
        console.log(`${MODULE_ID} | Adjusted current date (day+1):`, adjustedCurrentDate);
        
        // Convert adjusted current date back to timestamp
        // Note: We need to use month+1 for dateToTimestamp since it expects 1-indexed months
        const adjustedCurrentTimestamp = SimpleCalendar.api.dateToTimestamp({
          year: adjustedCurrentDate.year,
          month: adjustedCurrentDate.month + 1,
          day: adjustedCurrentDate.day,
          hour: adjustedCurrentDate.hour || 0,
          minute: adjustedCurrentDate.minute || 0
        });
        console.log(`${MODULE_ID} | Adjusted current timestamp:`, adjustedCurrentTimestamp);
        
        // Convert scheduled date to SimpleCalendar format for comparison
        const scheduleData = {
          year: scheduledDate.getFullYear(),
          month: scheduledDate.getMonth() + 1, // Convert to 1-indexed for dateToTimestamp
          day: scheduledDate.getDate(),
          hour: scheduledDate.getHours(),
          minute: scheduledDate.getMinutes()
        };
        console.log(`${MODULE_ID} | Schedule data for SimpleCalendar:`, scheduleData);
        
        // Convert to SimpleCalendar timestamp
        const scheduledTimestamp = SimpleCalendar.api.dateToTimestamp(scheduleData);
        console.log(`${MODULE_ID} | Scheduled timestamp:`, scheduledTimestamp);
        
        // Compare using the adjusted timestamp
        const isPastDue = adjustedCurrentTimestamp >= scheduledTimestamp;
        console.log(`${MODULE_ID} | Is past due (ADJUSTED timestamp comparison): ${isPastDue}`);
        
        return isPastDue;
      } catch (error) {
        console.error(`${MODULE_ID} | Error comparing SimpleCalendar dates:`, error);
        return false;
      }
    } else {
      // Use real-world time
      console.log(`${MODULE_ID} | Checking real-world scheduled message:`, message);
      const now = new Date();
      const scheduledTime = new Date(message.scheduledTime);
      
      console.log(`${MODULE_ID} | Real-world comparison - Scheduled: ${scheduledTime.toISOString()}, Current: ${now.toISOString()}`);
      
      const isPastDue = now >= scheduledTime;
      console.log(`${MODULE_ID} | Message is past due: ${isPastDue}`);
      
      return isPastDue;
    }
  }

  /**
   * Automatically send past-due messages without confirmation dialogs
   * @private
   */
  async _autoSendPastDueMessages() {
    // Reload messages to ensure we have the latest
    await this.loadScheduledMessages();
    
    // Find past-due messages
    const pastDueMessages = this.scheduledMessages.filter(message => this._isMessagePastDue(message));
    
    if (pastDueMessages.length === 0) {
      console.log(`${MODULE_ID} | No past-due messages to send`);
      return;
    }
    
    console.log(`${MODULE_ID} | Auto-sending ${pastDueMessages.length} past-due messages`);
    
    // Process messages
    const allMessages = [...this.scheduledMessages];
    const remainingMessages = allMessages.filter(message => 
      !pastDueMessages.some(m => m.created === message.created)
    );
    
    let sentCount = 0;
    for (const message of pastDueMessages) {
      try {
        await this._sendScheduledMessage(message);
        sentCount++;
      } catch (error) {
        console.error(`${MODULE_ID} | Error auto-sending message:`, error);
      }
    }
    
    // Save the updated messages list
    await game.settings.set(MODULE_ID, "scheduledMessages", remainingMessages);
    
    // Show a notification
    if (sentCount > 0) {
      ui.notifications.info(`Auto-sent ${sentCount} scheduled messages`);
    }
  }
  
  /**
   * Activate application listeners
   * @param {jQuery} html - The app HTML
   */
  activateListeners(html) {
    super.activateListeners(html);
    
    // Message selection
    html.find('.message-item').click(ev => this._onMessageClick(ev));
    
    // Action buttons
    html.find('.edit-message').click(ev => this._onEditMessage(ev));
    html.find('.delete-message').click(ev => this._onDeleteMessage(ev));
    html.find('.send-now').click(ev => this._onSendNow(ev));
    
    // New scheduled message button
    html.find('.new-scheduled-btn').click(ev => this._onNewScheduledMessage(ev));
    
    // Date/time picker changes
    html.find('#edit-scheduled-time').change(ev => this._onScheduledTimeChange(ev));
    html.find('#use-simple-calendar').change(ev => this._onCalendarOptionChange(ev));
    
    // Save changes button
    html.find('#save-changes-btn').click(ev => this._onSaveChanges(ev));
    
    // Check past due messages
    this._checkPastDueMessages();
  }
  
  /**
   * Handle message click
   * @param {Event} event - Click event
   * @private
   */
  _onMessageClick(event) {
    const messageId = event.currentTarget.dataset.messageId;
    const message = this.scheduledMessages.find(m => m.created === messageId);
    
    if (message) {
      this.selectedMessage = message;
      this.render(true);
    }
  }
  
  /**
   * Handle edit message button
   * @param {Event} event - Click event
   * @private
   */
  _onEditMessage(event) {
    event.preventDefault();
    event.stopPropagation();
    
    const messageId = event.currentTarget.dataset.messageId;
    const message = this.scheduledMessages.find(m => m.created === messageId);
    
    if (message) {
      this.selectedMessage = message;
      this._showEditPanel();
    }
  }
  
  /**
   * Show the edit panel
   * @private
   */
  _showEditPanel() {
    const editPanel = this.element.find('.edit-panel');
    editPanel.show();
    
    // Set form values
    const scheduledDate = new Date(this.selectedMessage.scheduledTime);
    
    // Format the date for datetime-local input
    const dateString = scheduledDate.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
    
    this.element.find('#edit-scheduled-time').val(dateString);
    
    // Normalize useSimpleCalendar to be boolean
    const useSimpleCalendar = this.selectedMessage.useSimpleCalendar === true || 
                            this.selectedMessage.useSimpleCalendar === "true";
    
    this.element.find('#use-simple-calendar').prop('checked', useSimpleCalendar);
    
    // Show/hide calendar note based on the checkbox state
    this.element.find('.calendar-note').toggle(useSimpleCalendar);
    
    // Show/hide SimpleCalendar options based on availability
    if (!game.modules.get("foundryvtt-simple-calendar")?.active) {
      this.element.find('.calendar-option').hide();
    }
  }
  
  /**
   * Handle scheduled time change
   * @param {Event} event - Change event
   * @private
   */
  _onScheduledTimeChange(event) {
    // This just updates the UI, actual saving happens on save button
    const newTime = event.currentTarget.value;
    const date = new Date(newTime);
    
    this.element.find('.preview-time').text(date.toLocaleString());
  }
  
  /**
   * Handle calendar option change
   * @param {Event} event - Change event
   * @private
   */
  _onCalendarOptionChange(event) {
    // This just updates the UI, actual saving happens on save button
    const useSimpleCalendar = event.currentTarget.checked;
    this.element.find('.calendar-note').toggle(useSimpleCalendar);
  }
  
  /**
   * Handle save changes button
   * @param {Event} event - Click event
   * @private
   */
  async _onSaveChanges(event) {
    event.preventDefault();
    
    if (!this.selectedMessage) return;
    
    // Get updated values
    const newScheduledTime = this.element.find('#edit-scheduled-time').val();
    const useSimpleCalendar = this.element.find('#use-simple-calendar').is(':checked');
    
    // Update the message
    const updatedMessage = {
      ...this.selectedMessage,
      scheduledTime: newScheduledTime,
      useSimpleCalendar: useSimpleCalendar 
    };
    
    console.log(`${MODULE_ID} | Updating scheduled message:`, updatedMessage);
    
    // Find and update in the scheduled messages array
    const allMessages = game.settings.get(MODULE_ID, "scheduledMessages") || [];
    const index = allMessages.findIndex(m => m.created === this.selectedMessage.created);
    
    if (index !== -1) {
      allMessages[index] = updatedMessage;
      
      // Save the updated array
      await game.settings.set(MODULE_ID, "scheduledMessages", allMessages);
      
      // Update local array and rerender
      await this.loadScheduledMessages();
      this.render(true);
      
      ui.notifications.info("Scheduled message updated");
    }
  }
  
  /**
   * Handle delete message button
   * @param {Event} event - Click event
   * @private
   */
  async _onDeleteMessage(event) {
    event.preventDefault();
    event.stopPropagation();
    
    const messageId = event.currentTarget.dataset.messageId;
    
    // Show confirmation dialog
    new Dialog({
      title: "Delete Scheduled Message",
      content: "<p>Are you sure you want to delete this scheduled message?</p>",
      buttons: {
        yes: {
          icon: '<i class="fas fa-trash"></i>',
          label: "Delete",
          callback: async () => await this._deleteScheduledMessage(messageId)
        },
        no: {
          icon: '<i class="fas fa-times"></i>',
          label: "Cancel"
        }
      },
      default: "no"
    }).render(true);
  }
  
  /**
   * Delete a scheduled message
   * @param {string} messageId - Message ID
   * @private
   */
  async _deleteScheduledMessage(messageId) {
    // Get all scheduled messages
    const allMessages = game.settings.get(MODULE_ID, "scheduledMessages") || [];
    
    // Filter out the message to delete
    const updatedMessages = allMessages.filter(m => m.created !== messageId);
    
    // Save the updated array
    await game.settings.set(MODULE_ID, "scheduledMessages", updatedMessages);
    
    // Update local array and rerender
    await this.loadScheduledMessages();
    this.render(true);
    
    ui.notifications.info("Scheduled message deleted");
  }
  
  /**
   * Handle send now button
   * @param {Event} event - Click event
   * @private
   */
  async _onSendNow(event) {
    event.preventDefault();
    event.stopPropagation();
    
    const messageId = event.currentTarget.dataset.messageId;
    const message = this.scheduledMessages.find(m => m.created === messageId);
    
    if (message) {
      // Show sending indicator
      const $button = $(event.currentTarget);
      const originalText = $button.html();
      $button.html('<i class="fas fa-spinner fa-spin"></i> Sending...');
      $button.prop('disabled', true);
      
      // Send the message
      try {
        await this._sendScheduledMessage(message);
        
        // Delete the scheduled message
        await this._deleteScheduledMessage(messageId);
        
        ui.notifications.info("Message sent successfully");
      } catch (error) {
        console.error(`${MODULE_ID} | Error sending message:`, error);
        ui.notifications.error("Failed to send message");
        
        // Restore button
        $button.html(originalText);
        $button.prop('disabled', false);
      }
    }
  }
  
  /**
   * Send a scheduled message
   * @param {Object} message - Message data
   * @private
   */
  async _sendScheduledMessage(message) {
    // Update the date field to current time
    message.date = getCurrentDateTime();
    
    console.log(`${MODULE_ID} | Sending scheduled message:`, message);
    
    // Use the global messenger API
    if (game.nightcity?.messenger?.sendMessage) {
      return game.nightcity.messenger.sendMessage({
        to: message.to,
        from: message.from,
        subject: message.subject,
        content: message.content,
        date: message.date
      });
    } else {
      throw new Error("Messaging system not properly initialized");
    }
  }
  
  /**
   * Handle new scheduled message button
   * @param {Event} event - Click event
   * @private
   */
  _onNewScheduledMessage(event) {
    event.preventDefault();
    
    // Open composer with a flag to indicate scheduling
    if (game.nightcity?.messenger?.openComposer) {
      game.nightcity.messenger.openComposer({ scheduledMode: true });
      this.close();
    }
  }
  
  /**
   * Check for past-due messages
   * @private
   */
  async _checkPastDueMessages() {
    // Only GM can send past-due messages
    if (!game.user.isGM) return;
    
    // First make sure all messages have proper boolean values for useSimpleCalendar
    await this.loadScheduledMessages();
    
    const pastDueMessages = this.scheduledMessages.filter(message => this._isMessagePastDue(message));
    
    if (pastDueMessages.length > 0) {
      console.log(`${MODULE_ID} | Found ${pastDueMessages.length} past-due messages:`, pastDueMessages);
      
      // Ask the GM if they want to send these messages
      if (pastDueMessages.length > 0) {
        new Dialog({
          title: "Past-Due Messages",
          content: `<p>There are ${pastDueMessages.length} scheduled messages that are past their scheduled time. Would you like to send them now?</p>`,
          buttons: {
            yes: {
              icon: '<i class="fas fa-paper-plane"></i>',
              label: "Send All",
              callback: async () => await this._sendPastDueMessages(pastDueMessages)
            },
            review: {
              icon: '<i class="fas fa-search"></i>',
              label: "Review First",
              callback: () => {
                // Just close the dialog and let them review
              }
            },
            no: {
              icon: '<i class="fas fa-times"></i>',
              label: "Not Now"
            }
          },
          default: "review"
        }).render(true);
      }
    }
  }
  
  /**
   * Send all past-due messages
   * @param {Array} messages - Messages to send
   * @private
   */
  async _sendPastDueMessages(messages) {
    // Show a progress dialog
    const progressContent = `
      <p>Sending ${messages.length} messages...</p>
      <div class="progress-bar">
        <div class="progress-fill" style="width: 0%"></div>
      </div>
      <p class="progress-text">0/${messages.length}</p>
    `;
    
    const dialog = new Dialog({
      title: "Sending Messages",
      content: progressContent,
      buttons: {},
      close: () => {}
    });
    
    dialog.render(true);
    
    // Process messages
    const allMessages = game.settings.get(MODULE_ID, "scheduledMessages") || [];
    const remainingMessages = [...allMessages];
    
    let sentCount = 0;
    for (const message of messages) {
      try {
        await this._sendScheduledMessage(message);
        
        // Remove from remaining messages
        const index = remainingMessages.findIndex(m => m.created === message.created);
        if (index !== -1) {
          remainingMessages.splice(index, 1);
        }
        
        sentCount++;
        
        // Update progress
        const percent = Math.round((sentCount / messages.length) * 100);
        dialog.element.find('.progress-fill').css('width', `${percent}%`);
        dialog.element.find('.progress-text').text(`${sentCount}/${messages.length}`);
      } catch (error) {
        console.error(`${MODULE_ID} | Error sending past-due message:`, error);
      }
    }
    
    // Save the updated messages
    await game.settings.set(MODULE_ID, "scheduledMessages", remainingMessages);
    
    // Close dialog after a short delay
    setTimeout(() => {
      dialog.close();
      ui.notifications.info(`Sent ${sentCount} past-due messages`);
      
      // Refresh this application
      this.loadScheduledMessages();
      this.render(true);
    }, 1500);
  }
}