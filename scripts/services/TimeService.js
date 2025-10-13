/**
 * Time Service
 * File: scripts/services/TimeService.js
 * Module: cyberpunkred-messenger
 * Description: Central time management for Night City Messenger
 * Handles real-world time, SimpleCalendar integration, and manual time entry
 */

import { MODULE_ID } from '../utils/constants.js';
import { EventBus, EVENTS } from '../core/EventBus.js';
import { SettingsManager } from '../core/SettingsManager.js';

export class TimeService {
  static instance = null;
  
  constructor() {
    if (TimeService.instance) {
      return TimeService.instance;
    }
    
    this.settingsManager = SettingsManager.getInstance();
    this.eventBus = EventBus.getInstance();
    
    // State
    this.useSimpleCalendar = false;
    this.manualTime = null;
    this.clockUpdateInterval = null;
    
    // Detect SimpleCalendar
    this._detectSimpleCalendar();
    
    // Initialize hooks
    this._initializeHooks();
    
    TimeService.instance = this;
    console.log(`${MODULE_ID} | TimeService initialized`);
  }
  
  /**
   * Get singleton instance
   * @returns {TimeService}
   */
  static getInstance() {
    if (!TimeService.instance) {
      TimeService.instance = new TimeService();
    }
    return TimeService.instance;
  }
  
  // ========================================
  // Time Source Detection & Configuration
  // ========================================
  
  /**
   * Detect if SimpleCalendar is available and configured
   * @private
   */
  _detectSimpleCalendar() {
    const isActive = game.modules.get('foundryvtt-simple-calendar')?.active;
    const timeSource = this.settingsManager.get('timeSource');
    
    this.useSimpleCalendar = isActive && timeSource === 'simplecalendar';
    
    if (isActive && timeSource === 'simplecalendar') {
      console.log(`${MODULE_ID} | Using SimpleCalendar for time`);
    } else if (!isActive && timeSource === 'simplecalendar') {
      console.warn(`${MODULE_ID} | SimpleCalendar selected but not available, falling back to real-world time`);
      this.useSimpleCalendar = false;
    }
  }
  
  /**
   * Check if SimpleCalendar is available
   * @returns {boolean}
   */
  isSimpleCalendarAvailable() {
    return game.modules.get('foundryvtt-simple-calendar')?.active && 
           typeof SimpleCalendar !== 'undefined';
  }
  
  /**
   * Get current time source
   * @returns {string} 'realworld', 'simplecalendar', or 'manual'
   */
  getTimeSource() {
    return this.settingsManager.get('timeSource') || 'realworld';
  }
  
  // ========================================
  // Current Time Retrieval
  // ========================================
  
  /**
   * Get current timestamp based on configured source
   * @returns {string} ISO-8601 timestamp
   */
  getCurrentTimestamp() {
    const timeSource = this.getTimeSource();
    
    switch (timeSource) {
      case 'simplecalendar':
        if (this.useSimpleCalendar) {
          return this._getSimpleCalendarTimestamp();
        }
        // Fallthrough if SimpleCalendar not available
        
      case 'manual':
        if (this.manualTime) {
          return this.manualTime;
        }
        // Fallthrough if no manual time set
        
      case 'realworld':
      default:
        return new Date().toISOString();
    }
  }
  
  /**
   * Get SimpleCalendar timestamp as ISO-8601
   * @private
   * @returns {string}
   */
  _getSimpleCalendarTimestamp() {
    try {
      const scTimestamp = SimpleCalendar.api.timestamp();
      const scDate = SimpleCalendar.api.timestampToDate(scTimestamp);
      
      // Convert to JavaScript Date
      const date = new Date(
        scDate.year,
        scDate.month,
        scDate.day,
        scDate.hour || 0,
        scDate.minute || 0,
        scDate.second || 0
      );
      
      return date.toISOString();
    } catch (error) {
      console.error(`${MODULE_ID} | Error getting SimpleCalendar time:`, error);
      return new Date().toISOString();
    }
  }
  
  /**
   * Get SimpleCalendar data for storage
   * @returns {Object|null}
   */
  getSimpleCalendarData() {
    if (!this.useSimpleCalendar) return null;
    
    try {
      const timestamp = SimpleCalendar.api.timestamp();
      const date = SimpleCalendar.api.timestampToDate(timestamp);
      const display = SimpleCalendar.api.formatDateTime(date);
      
      return {
        timestamp,
        date,
        display
      };
    } catch (error) {
      console.error(`${MODULE_ID} | Error getting SimpleCalendar data:`, error);
      return null;
    }
  }
  
  // ========================================
  // Time Formatting
  // ========================================
  
  /**
   * Format timestamp for display
   * @param {string} timestamp - ISO-8601 timestamp
   * @param {string} format - Format type: '12h', '24h', 'relative', 'full'
   * @returns {string}
   */
  formatTimestamp(timestamp, format = null) {
    if (!timestamp) return 'Unknown';
    
    // Use setting if no format specified
    if (!format) {
      format = this.settingsManager.get('timeDisplayFormat') || '12h';
    }
    
    // If using SimpleCalendar and we have SC data, prefer that
    if (this.useSimpleCalendar && timestamp.simpleCalendarData) {
      return timestamp.simpleCalendarData.display;
    }
    
    try {
      const date = new Date(timestamp);
      
      if (isNaN(date.getTime())) {
        return 'Invalid Date';
      }
      
      switch (format) {
        case '12h':
          return this._format12Hour(date);
        case '24h':
          return this._format24Hour(date);
        case 'relative':
          return this._formatRelative(date);
        case 'full':
          return this._formatFull(date);
        default:
          return this._format12Hour(date);
      }
    } catch (error) {
      console.error(`${MODULE_ID} | Error formatting timestamp:`, error);
      return 'Invalid Date';
    }
  }
  
  /**
   * Format as 12-hour time
   * @private
   */
  _format12Hour(date) {
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  }
  
  /**
   * Format as 24-hour time
   * @private
   */
  _format24Hour(date) {
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  }
  
  /**
   * Format as relative time
   * @private
   */
  _formatRelative(date) {
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);
    
    if (seconds < 0) return 'In the future';
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`;
    
    // Over a week, show date
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    });
  }
  
  /**
   * Format with full details
   * @private
   */
  _formatFull(date) {
    return date.toLocaleString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
  }
  
  /**
   * Format time only (no date)
   * @param {string|Date} timestamp
   * @param {boolean} use12Hour
   * @returns {string}
   */
  formatTimeOnly(timestamp, use12Hour = true) {
    try {
      const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
      
      return date.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: use12Hour
      });
    } catch (error) {
      return 'Unknown';
    }
  }
  
  /**
   * Format date only (no time)
   * @param {string|Date} timestamp
   * @returns {string}
   */
  formatDateOnly(timestamp) {
    try {
      const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
      
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } catch (error) {
      return 'Unknown';
    }
  }
  
  // ========================================
  // Time Selection & Scheduling
  // ========================================
  
  /**
   * Show date/time picker dialog
   * @param {Object} options - Picker options
   * @returns {Promise<string>} Selected timestamp
   */
  async pickDateTime(options = {}) {
    const {
      title = 'Select Date and Time',
      currentTime = this.getCurrentTimestamp(),
      allowPast = false,
      allowFuture = true
    } = options;
    
    // If using SimpleCalendar, use its picker
    if (this.useSimpleCalendar && SimpleCalendar.api.showDatePicker) {
      return await this._showSimpleCalendarPicker(options);
    }
    
    // Otherwise show custom picker
    return await this._showCustomPicker(options);
  }
  
  /**
   * Show SimpleCalendar date picker
   * @private
   */
  async _showSimpleCalendarPicker(options) {
    return new Promise((resolve, reject) => {
      try {
        // SimpleCalendar's date picker (if available)
        SimpleCalendar.api.showDatePicker({
          callback: (selectedDate) => {
            const timestamp = SimpleCalendar.api.dateToTimestamp(selectedDate);
            const isoDate = this._simpleCalendarToISO(selectedDate);
            resolve(isoDate);
          }
        });
      } catch (error) {
        console.error(`${MODULE_ID} | SimpleCalendar picker error:`, error);
        // Fallback to custom picker
        this._showCustomPicker(options).then(resolve).catch(reject);
      }
    });
  }
  
  /**
   * Convert SimpleCalendar date to ISO
   * @private
   */
  _simpleCalendarToISO(scDate) {
    const date = new Date(
      scDate.year,
      scDate.month,
      scDate.day,
      scDate.hour || 0,
      scDate.minute || 0,
      scDate.second || 0
    );
    return date.toISOString();
  }
  
  /**
   * Show custom date/time picker
   * @private
   */
  async _showCustomPicker(options) {
    const {
      title = 'Select Date and Time',
      currentTime = this.getCurrentTimestamp()
    } = options;
    
    return new Promise((resolve, reject) => {
      const date = new Date(currentTime);
      const dateValue = date.toISOString().slice(0, 10);
      const timeValue = date.toTimeString().slice(0, 5);
      
      new Dialog({
        title,
        content: `
          <form class="ncm-datetime-picker">
            <div class="form-group">
              <label>Date:</label>
              <input type="date" name="date" value="${dateValue}" />
            </div>
            <div class="form-group">
              <label>Time:</label>
              <input type="time" name="time" value="${timeValue}" />
            </div>
          </form>
        `,
        buttons: {
          select: {
            icon: '<i class="fas fa-check"></i>',
            label: 'Select',
            callback: (html) => {
              const dateStr = html.find('[name="date"]').val();
              const timeStr = html.find('[name="time"]').val();
              
              if (!dateStr || !timeStr) {
                ui.notifications.error('Please select both date and time');
                reject(new Error('Date and time required'));
                return;
              }
              
              const timestamp = new Date(`${dateStr}T${timeStr}`).toISOString();
              resolve(timestamp);
            }
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: 'Cancel',
            callback: () => reject(new Error('Cancelled'))
          }
        },
        default: 'select'
      }, {
        classes: ['dialog', 'ncm-dialog'],
        width: 400
      }).render(true);
    });
  }
  
  /**
   * Set manual time (GM only)
   * @param {string} timestamp - ISO-8601 timestamp
   */
  setManualTime(timestamp) {
    if (!game.user.isGM) {
      console.warn(`${MODULE_ID} | Only GMs can set manual time`);
      return;
    }
    
    this.manualTime = timestamp;
    this.eventBus.emit(EVENTS.TIME_CHANGED, { timestamp });
    console.log(`${MODULE_ID} | Manual time set:`, timestamp);
  }
  
  /**
   * Clear manual time
   */
  clearManualTime() {
    this.manualTime = null;
    this.eventBus.emit(EVENTS.TIME_CHANGED, { timestamp: this.getCurrentTimestamp() });
  }
  
  // ========================================
  // Live Clock Updates
  // ========================================
  
  /**
   * Start live clock updates
   * @param {Function} callback - Called with current time
   * @param {number} interval - Update interval in ms (default 1000)
   */
  startLiveClock(callback, interval = 1000) {
    if (this.clockUpdateInterval) {
      this.stopLiveClock();
    }
    
    // Initial call
    callback(this.getCurrentTimestamp());
    
    // Periodic updates
    this.clockUpdateInterval = setInterval(() => {
      callback(this.getCurrentTimestamp());
    }, interval);
  }
  
  /**
   * Stop live clock updates
   */
  stopLiveClock() {
    if (this.clockUpdateInterval) {
      clearInterval(this.clockUpdateInterval);
      this.clockUpdateInterval = null;
    }
  }
  
  // ========================================
  // Time Comparison
  // ========================================
  
  /**
   * Check if a time is in the past
   * @param {string} timestamp
   * @returns {boolean}
   */
  isPast(timestamp) {
    const now = new Date(this.getCurrentTimestamp());
    const then = new Date(timestamp);
    return then < now;
  }
  
  /**
   * Check if a time is in the future
   * @param {string} timestamp
   * @returns {boolean}
   */
  isFuture(timestamp) {
    return !this.isPast(timestamp);
  }
  
  /**
   * Check if a scheduled time has arrived
   * @param {string} scheduledTime - ISO timestamp
   * @returns {boolean}
   */
  isTimeDue(scheduledTime) {
    const now = new Date(this.getCurrentTimestamp());
    const scheduled = new Date(scheduledTime);
    return now >= scheduled;
  }
  
  // ========================================
  // Hooks & Events
  // ========================================
  
  /**
   * Initialize Foundry hooks
   * @private
   */
  _initializeHooks() {
    // Listen for SimpleCalendar time changes
    if (this.isSimpleCalendarAvailable()) {
      Hooks.on('simple-calendar-date-time-change', (data) => {
        this._onSimpleCalendarChange(data);
      });
      
      console.log(`${MODULE_ID} | SimpleCalendar hooks registered`);
    }
    
    // Listen for settings changes
    Hooks.on(`${MODULE_ID}.settingChanged`, (key, value) => {
      if (key === 'timeSource') {
        this._detectSimpleCalendar();
        this.eventBus.emit(EVENTS.TIME_SOURCE_CHANGED, { source: value });
      }
    });
  }
  
  /**
   * Handle SimpleCalendar time changes
   * @private
   */
  _onSimpleCalendarChange(data) {
    console.log(`${MODULE_ID} | SimpleCalendar time changed:`, data);
    
    // Emit event for scheduled message checking
    this.eventBus.emit(EVENTS.TIME_CHANGED, {
      timestamp: this._getSimpleCalendarTimestamp(),
      source: 'simplecalendar',
      data
    });
  }
  
  // ========================================
  // Cleanup
  // ========================================
  
  /**
   * Destroy the service
   */
  destroy() {
    this.stopLiveClock();
    TimeService.instance = null;
    console.log(`${MODULE_ID} | TimeService destroyed`);
  }
}