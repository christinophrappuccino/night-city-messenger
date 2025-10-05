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

export class SchedulingService {
  constructor() {
    this.settingsManager = SettingsManager.getInstance();
    this.messageService = new MessageService();
    this.eventBus = EventBus.getInstance();
    
    this.checkInterval = null;
    this.checkFrequency = 60000; // Check every minute
  }
  
  /**
   * Start the scheduling service
   */
  start() {
    if (this.checkInterval) {
      console.warn(`${MODULE_ID} | Scheduling service already running`);
      return;
    }
    
    console.log(`${MODULE_ID} | Starting scheduling service...`);
    
    // Check immediately
    this.checkScheduledMessages();
    
    // Then check periodically
    this.checkInterval = setInterval(() => {
      this.checkScheduledMessages();
    }, this.checkFrequency);
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
    
    // Generate ID
    const scheduleId = foundry.utils.randomID();
    
    // Get all scheduled messages
    const scheduled = this.settingsManager.get('scheduledMessages') || {};
    
    // Add new schedule
    scheduled[scheduleId] = {
      id: scheduleId,
      ...data,
      createdBy: game.user.id,
      createdAt: new Date().toISOString(),
      sent: false
    };
    
    // Save
    await this.settingsManager.set('scheduledMessages', scheduled);
    
    console.log(`${MODULE_ID} | Message scheduled for ${data.scheduledTime}`);
    
    return scheduleId;
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
    // Only GM can send scheduled messages
    if (!game.user.isGM) return 0;
    
    const scheduled = this.getAllScheduled();
    const now = new Date();
    let sent = 0;
    
    console.log(`${MODULE_ID} | Checking ${scheduled.length} scheduled messages...`);
    
    for (const schedule of scheduled) {
      try {
        const dueDate = new Date(schedule.scheduledTime);
        
        // Check if SimpleCalendar mode
        if (schedule.useSimpleCalendar && this._isSimpleCalendarAvailable()) {
          const isDue = this._checkSimpleCalendarDue(schedule.scheduledTime);
          if (!isDue) continue;
        } else {
          // Regular time check
          if (now < dueDate) continue;
        }
        
        // Send message
        console.log(`${MODULE_ID} | Sending scheduled message:`, schedule.id);
        
        await this.messageService.sendMessage({
          from: schedule.from,
          to: schedule.to,
          subject: schedule.subject,
          content: schedule.content,
          timestamp: schedule.scheduledTime
        }, { skipSpamCheck: true });
        
        // Mark as sent
        await this._markAsSent(schedule.id);
        
        sent++;
      } catch (error) {
        console.error(`${MODULE_ID} | Error sending scheduled message:`, error);
      }
    }
    
    if (sent > 0) {
      console.log(`${MODULE_ID} | Sent ${sent} scheduled messages`);
    }
    
    return sent;
  }
  
  /**
   * Get statistics
   * @returns {Object}
   */
  getStatistics() {
    const all = this.getAllScheduled();
    const now = new Date();
    
    const pastDue = all.filter(msg => new Date(msg.scheduledTime) < now);
    const upcoming = all.filter(msg => new Date(msg.scheduledTime) >= now);
    
    return {
      total: all.length,
      pastDue: pastDue.length,
      upcoming: upcoming.length,
      nextDelivery: upcoming.length > 0 
        ? upcoming.sort((a, b) => new Date(a.scheduledTime) - new Date(b.scheduledTime))[0].scheduledTime
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