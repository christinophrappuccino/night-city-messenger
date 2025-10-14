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
    // Validate
    const validation = DataValidator.validateScheduledMessage(messageData);
    if (!validation.valid) {
      throw new Error(`Invalid scheduled message: ${validation.errors.join(', ')}`);
    }
    
    const data = validation.sanitized;
    
    // Generate schedule ID
    const scheduleId = foundry.utils.randomID();
    
    // Store schedule data
    const scheduleData = {
      id: scheduleId,
      from: data.from,
      to: data.to,
      subject: data.subject,
      content: data.content,
      scheduledTime: data.scheduledTime,
      useSimpleCalendar: data.useSimpleCalendar || false,
      simpleCalendarData: data.simpleCalendarData || null,
      actorId: data.actorId,
      network: data.network || 'CITINET',
      createdAt: new Date().toISOString(),
      createdBy: game.user.id,
      sent: false
    };
    
    console.log(`${MODULE_ID} | Scheduling message:`, scheduleData);
    
    // ✅ FIX 1: Create placeholder using MessageRepository (proper way)
    try {
      if (data.actorId) {
        // Create placeholder that will appear in inbox
        const placeholderData = {
          from: data.from,
          to: data.to,
          subject: `⏰ ${data.subject}`,  // Clock emoji to indicate scheduled
          content: this._generatePlaceholderContent(data),
          timestamp: data.scheduledTime,  // Use scheduled time
          actorId: data.actorId,
          network: data.network || 'CITINET',
          
          // ✅ CRITICAL: Set status to scheduled
          status: {
            scheduled: true,  // This makes it filterable as "scheduled"
            sent: false,
            read: true,       // Don't clutter unread
            spam: false,
            saved: false,
            deleted: false
          },
          
          // ✅ CRITICAL: Include scheduleId in metadata
          metadata: {
            messageType: 'scheduled',
            scheduleId: scheduleId,  // Link placeholder to schedule
            isPlaceholder: true
          }
        };
        
        console.log(`${MODULE_ID} | Creating placeholder with scheduleId=${scheduleId}`);
        
        // Use MessageRepository directly through MessageService
        await this.messageService.messageRepository.create(placeholderData);
        
        console.log(`${MODULE_ID} | ✓ Created scheduled placeholder`);
      }
    } catch (error) {
      console.error(`${MODULE_ID} | Error creating scheduled placeholder:`, error);
      console.error(`${MODULE_ID} | Stack:`, error.stack);
      // ⚠️ Don't throw - we still want to save the schedule
      ui.notifications.warn('Scheduled message saved, but preview may not appear in inbox');
    }
    
    // Store in settings
    const scheduled = this.settingsManager.get('scheduledMessages') || {};
    scheduled[scheduleId] = scheduleData;
    await this.settingsManager.set('scheduledMessages', scheduled);
    
    console.log(`${MODULE_ID} | ✓ Message scheduled with ID: ${scheduleId}`);
    
    // Emit event
    this.eventBus.emit(EVENTS.MESSAGE_SCHEDULED, { scheduleId, messageData: scheduleData });
    
    return scheduleId;
  }

  /**
   * Generate placeholder content for scheduled messages
   * @private
   */
  _generatePlaceholderContent(data) {
    const deliveryTime = this.timeService.formatTimestamp(data.scheduledTime, 'full');
    
    return `
      <div class="ncm-scheduled-message-placeholder" style="font-family: 'Rajdhani', sans-serif; background-color: #1a1a1a; border: 2px solid #19f3f7; border-radius: 5px; padding: 20px; color: #ffffff;">
        <div style="text-align: center; margin-bottom: 15px;">
          <i class="fas fa-clock" style="font-size: 2em; color: #19f3f7;"></i>
          <h3 style="color: #19f3f7; margin: 10px 0;">SCHEDULED FOR DELIVERY</h3>
        </div>
        <div style="border-top: 2px solid #19f3f7; padding-top: 15px;">
          <p><strong style="color: #F65261;">Delivery Time:</strong> <span style="color: #19f3f7;">${deliveryTime}</span></p>
          <p><strong style="color: #F65261;">From:</strong> ${data.from}</p>
          <p><strong style="color: #F65261;">To:</strong> ${data.to}</p>
          <p><strong style="color: #F65261;">Subject:</strong> ${data.subject}</p>
          <hr style="border-color: #19f3f7; opacity: 0.3; margin: 15px 0;">
          <p style="color: #cccccc;"><em>Message preview:</em></p>
          <div style="color: #999999; font-size: 0.9em; max-height: 200px; overflow: hidden;">
            ${data.content.substring(0, 300)}${data.content.length > 300 ? '...' : ''}
          </div>
          <hr style="border-color: #19f3f7; opacity: 0.3; margin: 15px 0;">
          <p style="text-align: center; color: #19f3f7; font-size: 0.9em;">
            <i class="fas fa-info-circle"></i> This message will be automatically delivered at the scheduled time
          </p>
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
        
        // ✅ FIX 2: Find and delete the placeholder (improved search)
        if (schedule.actorId) {
          try {
            const actor = game.actors.get(schedule.actorId);
            if (actor) {
              // Get inbox journal
              const inboxId = actor.getFlag(MODULE_ID, 'inboxJournal');
              if (inboxId) {
                const journal = game.journal.get(inboxId);
                if (journal) {
                  // Find placeholder by scheduleId in metadata
                  const placeholderPage = journal.pages.find(p => {
                    const scheduleId = p.getFlag(MODULE_ID, 'metadata')?.scheduleId;
                    const isPlaceholder = p.getFlag(MODULE_ID, 'metadata')?.isPlaceholder;
                    return scheduleId === schedule.id && isPlaceholder;
                  });
                  
                  if (placeholderPage) {
                    console.log(`${MODULE_ID} | ✓ Deleting placeholder: ${placeholderPage.name}`);
                    await placeholderPage.delete();
                  } else {
                    console.warn(`${MODULE_ID} | ⚠ No placeholder found for schedule ${schedule.id}`);
                  }
                }
              }
            }
          } catch (error) {
            console.error(`${MODULE_ID} | Error deleting placeholder:`, error);
            // Continue anyway - we still want to send the message
          }
        }
        
        // ✅ FIX 3: Send the actual message with proper status
        const messageData = {
          from: schedule.from,
          to: schedule.to,
          subject: schedule.subject,
          content: schedule.content,
          actorId: schedule.actorId,
          timestamp: schedule.scheduledTime, // Use scheduled time as send time
          simpleCalendarData: schedule.simpleCalendarData,
          
          // Proper status for delivered message
          status: {
            scheduled: false, // No longer scheduled
            sent: false,      // It's received, not sent (from recipient's perspective)
            read: false,      // Unread (new message)
            spam: false,
            saved: false,
            deleted: false
          },
          
          metadata: {
            messageType: 'standard',  // Now it's a normal message
            sentVia: 'scheduled',
            originalScheduleId: schedule.id
          }
        };
        
        // Use MessageManager to send
        await game.nightcity.messageManager.sendMessage(messageData, {
          skipSpamCheck: true // Don't spam-check scheduled messages
        });
        
        // Mark as sent in schedule data
        await this._markAsSent(schedule.id);
        sent++;
        
        console.log(`${MODULE_ID} | ✓ Sent scheduled message: ${schedule.id}`);
        
        // Notify recipient
        const recipient = game.users.find(u => 
          u.character?.getFlag(MODULE_ID, 'emailAddress') === schedule.to.split('<')[1]?.split('>')[0]
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