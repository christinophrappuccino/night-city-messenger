/**
 * Scheduling Service
 * File: scripts/services/SchedulingService.js
 * Module: cyberpunkred-messenger
 * Description: Handles scheduled message delivery
 */

import { MODULE_ID } from '../utils/constants.js';
import { DataValidator } from '../data/DataValidator.js';
import { MessageService } from './MessageService.js';
import { SettingsManager } from '../core/SettingsManager.js';
import { EventBus, EVENTS } from '../core/EventBus.js';
import { TimeService } from './TimeService.js';

export class SchedulingService {
  constructor() {
    this.settingsManager = SettingsManager.getInstance();
    this.messageService = new MessageService();
    this.eventBus = EventBus.getInstance();
    this.checkInterval = null;
    this.checkFrequency = 60000;
    this.timeService = TimeService.getInstance();

    // Listen for time changes from SimpleCalendar
    this.eventBus.on(EVENTS.TIME_CHANGED, (data) => {
      if (data.source === 'simplecalendar') {
        console.log(`${MODULE_ID} | SimpleCalendar time changed, checking scheduled messages...`);
        this.checkScheduledMessages();
      }
    });
  }
  
  /**
   * Start the scheduling service
   */
  start() {
    if (this.checkInterval) {
      console.warn(`${MODULE_ID} | Scheduling service already running`);
      return;
    }
    
    // Get check frequency from settings (convert to ms)
    const checkFrequency = (this.settingsManager.get('scheduleCheckInterval') || 60) * 1000;
    
    console.log(`${MODULE_ID} | Starting scheduling service (checking every ${checkFrequency/1000}s)...`);
    
    // Check immediately
    this.checkScheduledMessages();
    
    // Then check periodically
    this.checkInterval = setInterval(() => {
      this.checkScheduledMessages();
    }, checkFrequency);
  }
  
  /**
   * Stop the scheduling service
   */
  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      console.log(`${MODULE_ID} | Scheduling service stopped`);
    }
  }
  
  /**
   * Schedule a message
   * @param {Object} messageData - Message data
   * @returns {Promise<string>} Schedule ID
   */
  async scheduleMessage(messageData) {
    console.log(`${MODULE_ID} | Scheduling message...`, messageData);
    
    // Validate
    const validation = DataValidator.validateMessage(messageData);
    if (!validation.valid) {
      throw new Error(`Invalid message: ${validation.errors.join(', ')}`);
    }
    
    const data = validation.sanitized;
    
    // Manual validation for scheduledTime
    if (!messageData.scheduledTime) {
      throw new Error('Scheduled time is required');
    }
    
    const scheduleDate = new Date(messageData.scheduledTime);
    if (isNaN(scheduleDate.getTime())) {
      throw new Error('Invalid scheduled time format');
    }
    
    // Generate schedule ID
    const scheduleId = foundry.utils.randomID();
    
    // Store schedule data (this is what gets sent later)
    const scheduleData = {
      id: scheduleId,
      from: data.from,
      to: data.to,  // Keep original - this is who receives it when sent
      subject: data.subject,
      content: data.content,
      scheduledTime: messageData.scheduledTime,
      useSimpleCalendar: Boolean(messageData.useSimpleCalendar),
      simpleCalendarData: messageData.simpleCalendarData || null,
      actorId: data.actorId,
      network: data.network || 'CITINET',
      createdAt: new Date().toISOString(),
      createdBy: game.user.id,
      sent: false
    };
    
    console.log(`${MODULE_ID} | Schedule data prepared:`, scheduleData);
    
    // ✅ FIX: Create placeholder in SENDER's inbox (not recipient's!)
    try {
      if (data.actorId) {
        // Extract sender's email for "to" field
        const senderEmail = data.from.match(/<(.+?)>/) ? 
          data.from.match(/<(.+?)>/)[1] : 
          data.from;
        
        // Extract recipient's info for display
        const recipientEmail = data.to.match(/<(.+?)>/) ? 
          data.to.match(/<(.+?)>/)[1] : 
          data.to;
        
        const recipientName = data.to.replace(/<.+?>/, '').trim() || recipientEmail;
        
        const placeholderData = {
          // ✅ CRITICAL FIX: Reverse from/to so placeholder goes to SENDER's inbox
          from: `System <system@nightcity.net>`,  // System message
          to: data.from,  // ← SENDER receives the placeholder!
          
          subject: `⏰ Scheduled: ${data.subject}`,
          content: this._generatePlaceholderContent({
            ...messageData,
            recipientDisplay: recipientName,
            recipientEmail: recipientEmail
          }),
          timestamp: messageData.scheduledTime,
          actorId: data.actorId,
          network: data.network || 'CITINET',
          
          status: {
            scheduled: true,  // Appears in "Scheduled" filter
            sent: true,       // ✅ NEW: Mark as sent so it's not in inbox
            read: true,       // Don't show as unread
            spam: false,
            saved: false,
            deleted: false
          },
          
          metadata: {
            messageType: 'scheduled',
            scheduleId: scheduleId,
            isPlaceholder: true,
            originalTo: data.to,  // Store original recipient for display
            originalSubject: data.subject
          }
        };
        
        console.log(`${MODULE_ID} | Creating placeholder in SENDER's inbox...`);
        console.log(`${MODULE_ID} | Placeholder will go to: ${placeholderData.to}`);
        
        await this.messageService.messageRepository.create(placeholderData);
        
        console.log(`${MODULE_ID} | ✓ Placeholder created in sender's inbox`);
      }
    } catch (error) {
      console.error(`${MODULE_ID} | Error creating placeholder:`, error);
      ui.notifications.warn('Scheduled message saved, but preview may not appear');
    }
    
    // Store in settings
    const scheduled = this.settingsManager.get('scheduledMessages') || {};
    scheduled[scheduleId] = scheduleData;
    await this.settingsManager.set('scheduledMessages', scheduled);
    
    console.log(`${MODULE_ID} | ✓ Message scheduled: ${scheduleId}`);
    
    this.eventBus.emit(EVENTS.MESSAGE_SCHEDULED, { scheduleId, messageData: scheduleData });
    
    return scheduleId;
  }

  /**
   * Generate placeholder content for scheduled messages
   * @private
   */
  _generatePlaceholderContent(data) {
    const deliveryTime = this.timeService.formatTimestamp(data.scheduledTime, 'full');
    const recipientDisplay = data.recipientDisplay || data.to;
    const recipientEmail = data.recipientEmail || data.to;
    
    return `
      <div class="ncm-scheduled-message-placeholder" style="font-family: 'Rajdhani', sans-serif; background-color: #1a1a1a; border: 2px solid #19f3f7; border-radius: 5px; padding: 20px; color: #ffffff;">
        <div style="text-align: center; margin-bottom: 15px;">
          <i class="fas fa-clock" style="font-size: 2em; color: #19f3f7;"></i>
          <h3 style="color: #19f3f7; margin: 10px 0;">SCHEDULED MESSAGE</h3>
          <p style="color: #cccccc; margin: 5px 0;">This message will be sent automatically</p>
        </div>
        
        <div style="border-top: 2px solid #19f3f7; padding-top: 15px;">
          <table style="width: 100%; color: #ffffff; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; color: #F65261; font-weight: bold; width: 140px;">Scheduled For:</td>
              <td style="padding: 8px 0; color: #19f3f7; font-weight: bold;">${deliveryTime}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #F65261; font-weight: bold;">Recipient:</td>
              <td style="padding: 8px 0;">${recipientDisplay}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #F65261; font-weight: bold;">To:</td>
              <td style="padding: 8px 0; color: #888888; font-family: monospace; font-size: 0.9em;">${recipientEmail}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #F65261; font-weight: bold;">Subject:</td>
              <td style="padding: 8px 0;">${data.subject}</td>
            </tr>
          </table>
          
          <hr style="border: none; border-top: 1px solid #19f3f7; opacity: 0.3; margin: 15px 0;">
          
          <div style="margin-top: 15px;">
            <p style="color: #cccccc; margin-bottom: 8px;"><strong>Message Preview:</strong></p>
            <div style="background: #0a0a0a; border-left: 3px solid #19f3f7; padding: 12px; color: #999999; font-size: 0.9em; max-height: 150px; overflow: hidden;">
              ${data.content.substring(0, 300)}${data.content.length > 300 ? '...' : ''}
            </div>
          </div>
          
          <hr style="border: none; border-top: 1px solid #19f3f7; opacity: 0.3; margin: 15px 0;">
          
          <div style="text-align: center; padding: 10px; background: rgba(25, 243, 247, 0.1); border-radius: 3px;">
            <p style="color: #19f3f7; font-size: 0.9em; margin: 0;">
              <i class="fas fa-info-circle"></i> You can view and manage scheduled messages from the Scheduled folder
            </p>
          </div>
        </div>
      </div>
    `;
  }


  /**
   * Get formatted time display for UI
   */
  getScheduleDisplayTime(schedule) {
    if (schedule.useSimpleCalendar && schedule.simpleCalendarData) {
      return schedule.simpleCalendarData.display;
    }
    
    return this.timeService.formatTimestamp(schedule.scheduledTime, 'full');
  }

  /**
   * GM to reschedule a message
   */
  async rescheduleMessage(scheduleId, newTime) {
    if (!game.user.isGM) {
      throw new Error('Only GMs can reschedule messages');
    }
    
    const scheduled = this.settingsManager.get('scheduledMessages') || {};
    const schedule = scheduled[scheduleId];
    
    if (!schedule) {
      throw new Error('Schedule not found');
    }
    
    if (schedule.sent) {
      throw new Error('Cannot reschedule a message that was already sent');
    }
    
    // Update time
    schedule.scheduledTime = newTime;
    
    // Update SimpleCalendar data if applicable
    if (schedule.useSimpleCalendar && this.timeService.isSimpleCalendarAvailable()) {
      schedule.simpleCalendarData = this.timeService.getSimpleCalendarData();
    }
    
    scheduled[scheduleId] = schedule;
    await this.settingsManager.set('scheduledMessages', scheduled);
    
    console.log(`${MODULE_ID} | Message rescheduled:`, scheduleId);
    
    return schedule;
  }

  
  /**
   * Cancel a scheduled message
   * @param {string} scheduleId - Schedule ID
   * @returns {Promise<boolean>}
   */
  async cancelSchedule(scheduleId) {
    const scheduled = this.settingsManager.get('scheduledMessages') || {};
    
    if (!scheduled[scheduleId]) {
      return false;
    }
    
    delete scheduled[scheduleId];
    await this.settingsManager.set('scheduledMessages', scheduled);
    
    console.log(`${MODULE_ID} | Cancelled scheduled message: ${scheduleId}`);
    
    return true;
  }
  
  /**
   * Get all scheduled messages
   * @returns {Array}
   */
  getAllScheduled() {
    const scheduled = this.settingsManager.get('scheduledMessages') || {};
    return Object.values(scheduled).filter(msg => !msg.sent);
  }
  
  /**
   * Get scheduled messages for current user
   * @returns {Array}
   */
  getUserScheduled() {
    const all = this.getAllScheduled();
    return all.filter(msg => msg.createdBy === game.user.id);
  }
  
  /**
   * Check and send due messages
   * @returns {Promise<number>} Number of messages sent
   */
  async checkScheduledMessages() {
    const scheduled = this.getAllScheduled();
    const now = this.timeService.getCurrentTimestamp();
    let sent = 0;
    
    console.log(`${MODULE_ID} | Checking ${scheduled.length} scheduled messages at ${now}`);
    
    for (const schedule of scheduled) {
      try {
        // Check if message is due
        const isDue = this.timeService.isTimeDue(schedule.scheduledTime);
        
        if (!isDue) {
          console.log(`${MODULE_ID} | Message ${schedule.id} not yet due (scheduled: ${schedule.scheduledTime}, now: ${now})`);
          continue;
        }
        
        console.log(`${MODULE_ID} | Message ${schedule.id} is DUE - sending now!`);
        
        // ✅ FIX: Look for placeholder in SENDER's inbox (not recipient's!)
        if (schedule.actorId) {
          try {
            const actor = game.actors.get(schedule.actorId);
            if (actor) {
              // Get SENDER's inbox journal
              const inboxId = actor.getFlag(MODULE_ID, 'inboxJournal');
              if (inboxId) {
                const journal = game.journal.get(inboxId);
                if (journal) {
                  // Find placeholder by scheduleId
                  const placeholderPage = journal.pages.find(p => {
                    const scheduleId = p.getFlag(MODULE_ID, 'metadata')?.scheduleId;
                    const isPlaceholder = p.getFlag(MODULE_ID, 'metadata')?.isPlaceholder;
                    return scheduleId === schedule.id && isPlaceholder;
                  });
                  
                  if (placeholderPage) {
                    console.log(`${MODULE_ID} | ✓ Deleting placeholder from sender's inbox: ${placeholderPage.name}`);
                    await placeholderPage.delete();
                  } else {
                    console.warn(`${MODULE_ID} | ⚠ No placeholder found for schedule ${schedule.id} in sender's inbox`);
                    // Not a critical error - maybe user deleted it manually
                  }
                }
              }
            }
          } catch (error) {
            console.error(`${MODULE_ID} | Error deleting placeholder:`, error);
            // Continue anyway - we still want to send the message
          }
        }
        
        // ✅ Send the actual message to RECIPIENT
        const messageData = {
          from: schedule.from,
          to: schedule.to,  // Recipient gets the real message
          subject: schedule.subject,  // Original subject (no ⏰)
          content: schedule.content,
          actorId: schedule.actorId,
          timestamp: schedule.scheduledTime,
          simpleCalendarData: schedule.simpleCalendarData,
          
          // Normal message status (received by recipient)
          status: {
            scheduled: false,  // Not scheduled anymore
            sent: false,       // Received (not sent by recipient)
            read: false,       // Unread
            spam: false,
            saved: false,
            deleted: false
          },
          
          metadata: {
            messageType: 'standard',  // Normal message now
            sentVia: 'scheduled',
            originalScheduleId: schedule.id
          }
        };
        
        console.log(`${MODULE_ID} | Sending message to recipient: ${schedule.to}`);
        
        // Use MessageManager to send
        await game.nightcity.messageManager.sendMessage(messageData, {
          skipSpamCheck: true
        });
        
        // Mark as sent
        await this._markAsSent(schedule.id);
        sent++;
        
        console.log(`${MODULE_ID} | ✓ Sent scheduled message: ${schedule.id}`);
        
        // Notify recipient
        const recipientEmail = schedule.to.match(/<(.+?)>/) ? 
          schedule.to.match(/<(.+?)>/)[1] : 
          schedule.to;
          
        const recipient = game.users.find(u => 
          u.character?.getFlag(MODULE_ID, 'emailAddress') === recipientEmail
        );
        
        if (recipient) {
          game.socket.emit(`module.${MODULE_ID}`, {
            type: 'notification',
            userId: recipient.id,
            message: `New message from ${schedule.from}`
          });
        }
        
      } catch (error) {
        console.error(`${MODULE_ID} | ❌ Error sending scheduled message ${schedule.id}:`, error);
        console.error(`${MODULE_ID} | Stack:`, error.stack);
        // Continue with other messages
      }
    }
    
    if (sent > 0) {
      console.log(`${MODULE_ID} | ✓ Sent ${sent} scheduled message(s)`);
      this.eventBus.emit(EVENTS.MESSAGES_SENT, { count: sent });
      ui.notifications.info(`Sent ${sent} scheduled message${sent > 1 ? 's' : ''}`);
    } else {
      console.log(`${MODULE_ID} | No messages were due to send`);
    }
    
    return sent;
  }

  /**
   * Get statistics
   * @returns {Object}
   */
  getStatistics() {
    const all = this.getAllScheduled();
    const now = new Date(this.timeService.getCurrentTimestamp());
    
    const pastDue = all.filter(msg => {
      const scheduledDate = new Date(msg.scheduledTime);
      return scheduledDate < now && !msg.sent;
    });
    
    const upcoming = all.filter(msg => {
      const scheduledDate = new Date(msg.scheduledTime);
      return scheduledDate >= now && !msg.sent;
    });
    
    const sent = all.filter(msg => msg.sent);
    
    return {
      total: all.length,
      pastDue: pastDue.length,
      upcoming: upcoming.length,
      sent: sent.length,
      nextDelivery: upcoming.length > 0 
        ? this.timeService.formatTimestamp(
            upcoming.sort((a, b) => 
              new Date(a.scheduledTime) - new Date(b.scheduledTime)
            )[0].scheduledTime,
            'full'
          )
        : null
    };
  }
  
  // ========================================
  // Private Helper Methods
  // ========================================
  
  /**
   * Mark schedule as sent
   * @private
   */
  async _markAsSent(scheduleId) {
    const scheduled = this.settingsManager.get('scheduledMessages') || {};
    
    if (scheduled[scheduleId]) {
      scheduled[scheduleId].sent = true;
      scheduled[scheduleId].sentAt = new Date().toISOString();
      await this.settingsManager.set('scheduledMessages', scheduled);
      
      console.log(`${MODULE_ID} | Marked schedule ${scheduleId} as sent`);
    }
  }
  
  /**
   * Check if SimpleCalendar is available
   * @private
   */
  _isSimpleCalendarAvailable() {
    return game.modules.get('foundryvtt-simple-calendar')?.active;
  }
  
  /**
   * Check if SimpleCalendar time is due
   * @private
   */
  _checkSimpleCalendarDue(scheduledTime) {
    if (!this._isSimpleCalendarAvailable()) return false;
    
    try {
      const scheduled = new Date(scheduledTime);
      const currentTimestamp = SimpleCalendar.api.timestamp();
      
      const scheduledTimestamp = SimpleCalendar.api.dateToTimestamp({
        year: scheduled.getFullYear(),
        month: scheduled.getMonth(),
        day: scheduled.getDate(),
        hour: scheduled.getHours(),
        minute: scheduled.getMinutes(),
        second: 0
      });
      
      return currentTimestamp >= scheduledTimestamp;
    } catch (error) {
      console.error(`${MODULE_ID} | SimpleCalendar check error:`, error);
      return false;
    }
  }
}