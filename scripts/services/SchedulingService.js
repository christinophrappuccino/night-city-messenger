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
import { EventBus } from '../core/EventBus.js';
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
    
    // Generate schedule ID
    const scheduleId = foundry.utils.randomID();
    
    // Prepare schedule data
    const scheduleData = {
      id: scheduleId,
      from: messageData.from,
      to: messageData.to,
      subject: messageData.subject,
      content: messageData.content,
      scheduledTime: messageData.scheduledTime,
      useSimpleCalendar: messageData.useSimpleCalendar || false,
      actorId: messageData.actorId,
      createdAt: this.timeService.getCurrentTimestamp(),
      sent: false,
      sentAt: null
    };
    
    // If using SimpleCalendar, store additional data
    if (messageData.useSimpleCalendar && this.timeService.isSimpleCalendarAvailable()) {
      scheduleData.simpleCalendarData = this.timeService.getSimpleCalendarData();
    }
    
    // Store in settings
    const scheduled = this.settingsManager.get('scheduledMessages') || {};
    scheduled[scheduleId] = scheduleData;
    await this.settingsManager.set('scheduledMessages', scheduled);
    
    console.log(`${MODULE_ID} | Message scheduled:`, scheduleId);
    
    // Emit event
    this.eventBus.emit(EVENTS.MESSAGE_SCHEDULED, scheduleData);
    
    return scheduleId;
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
          continue;
        }
        
        // Send message
        console.log(`${MODULE_ID} | Sending scheduled message:`, schedule.id);
        
        // Prepare message data with proper timestamp
        const messageData = {
          from: schedule.from,
          to: schedule.to,
          subject: schedule.subject,
          content: schedule.content,
          timestamp: schedule.scheduledTime, // Use scheduled time, not current time
          actorId: schedule.actorId
        };
        
        // Include SimpleCalendar data if it was used
        if (schedule.useSimpleCalendar && schedule.simpleCalendarData) {
          messageData.simpleCalendarData = schedule.simpleCalendarData;
        }
        
        await this.messageService.sendMessage(messageData, { 
          skipSpamCheck: true 
        });
        
        // Mark as sent
        await this._markAsSent(schedule.id);
        
        sent++;
        
        // Notify GM
        if (game.user.isGM) {
          ui.notifications.info(`Scheduled message sent: "${schedule.subject}"`);
        }
      } catch (error) {
        console.error(`${MODULE_ID} | Error sending scheduled message:`, error);
        // Could retry or notify GM
      }
    }
    
    if (sent > 0) {
      console.log(`${MODULE_ID} | Sent ${sent} scheduled messages`);
      
      // Emit event
      this.eventBus.emit(EVENTS.TIME_SCHEDULED_MESSAGE_DUE, { count: sent });
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