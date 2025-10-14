/**
 * Time Widget Component - MINIMAL FIX
 * File: scripts/ui/components/MessageComposer/TimeWidget.js
 * Module: cyberpunkred-messenger
 * Description: Live clock display and time control for composer
 * 
 * ✅ ONLY CHANGES: Lines 165 and 181 - removed parent.render() calls
 */

import { MODULE_ID } from '../../../utils/constants.js';
import { TimeService } from '../../../services/TimeService.js';
import { SettingsManager } from '../../../core/SettingsManager.js';

export class TimeWidget {
  constructor(parent) {
    this.parent = parent;
    this.timeService = TimeService.getInstance();
    this.settingsManager = SettingsManager.getInstance();
    
    this.element = null;
    this.clockInterval = null;
    this.customTime = null; // GM override time
  }
  
  /**
   * Render the time widget
   * @returns {string} HTML string
   */
  render() {
    const showClock = this.settingsManager.get('showTimeInComposer');
    const isGM = game.user.isGM;
    const gmTimeOverride = this.settingsManager.get('gmTimeOverride');
    
    // Players can set future times, GMs can set any time (past or future)
    const canSetTime = isGM || true; // Everyone can set time now
    
    if (!showClock && !canSetTime) {
      return '';
    }
    
    const currentTime = this.getCurrentDisplayTime();
    
    return `
      <div class="ncm-time-widget">
        ${showClock ? `
          <div class="ncm-time-widget__display">
            <i class="fas fa-clock ncm-time-widget__icon"></i>
            <div class="ncm-time-widget__time">
              <span class="ncm-time-widget__time-value" data-live-time="true">
                ${currentTime.time}
              </span>
              <span class="ncm-time-widget__date-value">
                ${currentTime.date}
              </span>
            </div>
            ${this.customTime ? `
              <span class="ncm-time-widget__custom-indicator" title="Custom time set">
                <i class="fas fa-user-clock"></i>
              </span>
            ` : ''}
          </div>
        ` : ''}
        
        ${canSetTime ? `
          <button class="ncm-btn ncm-btn--small ncm-time-widget__set-btn" 
                  data-action="set-custom-time"
                  title="${isGM ? 'Set custom send time (GM can set past/future)' : 'Schedule for future time'}">
            <i class="fas fa-calendar-alt"></i>
            ${this.customTime ? 'Custom Time' : (isGM ? 'Set Time' : 'Schedule')}
          </button>
          ${this.customTime ? `
            <button class="ncm-btn ncm-btn--small ncm-time-widget__clear-btn"
                    data-action="clear-custom-time"
                    title="Clear custom time">
              <i class="fas fa-times"></i>
            </button>
          ` : ''}
        ` : ''}
      </div>
    `;
  }
  
  /**
   * Get current display time
   * @returns {Object} {time, date}
   */
  getCurrentDisplayTime() {
    const timestamp = this.customTime || this.timeService.getCurrentTimestamp();
    const date = new Date(timestamp);
    
    return {
      time: this.timeService.formatTimeOnly(timestamp, true),
      date: this.timeService.formatDateOnly(timestamp)
    };
  }
  
  /**
   * Start live clock updates
   */
  startLiveClock() {
    // Stop any existing interval
    this.stopLiveClock();
    
    if (!this.settingsManager.get('showTimeInComposer')) {
      return;
    }
    
    // Update every second
    this.clockInterval = setInterval(() => {
      this.updateDisplay();
    }, 1000);
  }
  
  /**
   * Stop live clock updates
   */
  stopLiveClock() {
    if (this.clockInterval) {
      clearInterval(this.clockInterval);
      this.clockInterval = null;
    }
  }
  
  /**
   * Update the displayed time
   */
  updateDisplay() {
    if (!this.element) return;
    
    const { time, date } = this.getCurrentDisplayTime();
    
    const timeEl = this.element.querySelector('.ncm-time-widget__time-value');
    const dateEl = this.element.querySelector('.ncm-time-widget__date-value');
    
    if (timeEl) timeEl.textContent = time;
    if (dateEl) dateEl.textContent = date;
    
    // ✅ NEW: Update button text and custom indicator visibility
    this.updateButtons();
  }
  
  /**
   * ✅ NEW: Update button states without re-rendering entire composer
   */
  updateButtons() {
    if (!this.element) return;
    
    const $widget = $(this.element);
    const isGM = game.user.isGM;
    
    // Update "Set Time" button text
    const $setBtn = $widget.find('[data-action="set-custom-time"]');
    if ($setBtn.length) {
      const newText = this.customTime ? 'Custom Time' : (isGM ? 'Set Time' : 'Schedule');
      $setBtn.find('i').siblings().remove(); // Remove old text
      $setBtn.append(` ${newText}`);
    }
    
    // Show/hide clear button
    const $clearBtn = $widget.find('[data-action="clear-custom-time"]');
    if (this.customTime) {
      if ($clearBtn.length === 0) {
        // Add clear button if it doesn't exist
        $setBtn.after(`
          <button class="ncm-btn ncm-btn--small ncm-time-widget__clear-btn"
                  data-action="clear-custom-time"
                  title="Clear custom time">
            <i class="fas fa-times"></i>
          </button>
        `);
        // Re-bind the event
        $widget.find('[data-action="clear-custom-time"]').on('click', async (e) => {
          e.preventDefault();
          await this.clearCustomTime();
        });
      }
    } else {
      $clearBtn.remove();
    }
    
    // Show/hide custom indicator
    const $customIndicator = $widget.find('.ncm-time-widget__custom-indicator');
    if (this.customTime) {
      if ($customIndicator.length === 0) {
        // Add indicator if it doesn't exist
        $widget.find('.ncm-time-widget__time').append(`
          <span class="ncm-time-widget__custom-indicator" title="Custom time set">
            <i class="fas fa-user-clock"></i>
          </span>
        `);
      }
    } else {
      $customIndicator.remove();
    }
  }
  
  /**
   * Show custom time picker
   * ✅ FIXED: No longer re-renders entire composer
   */
  async showTimePicker() {
    const isGM = game.user.isGM;
    
    try {
      const timestamp = await this.timeService.pickDateTime({
        title: isGM ? 'Set Message Send Time' : 'Schedule Message',
        currentTime: this.customTime || this.timeService.getCurrentTimestamp(),
        allowPast: isGM, // Only GMs can backdate
        allowFuture: true // Everyone can schedule future
      });
      
      // For non-GMs, ensure the time is in the future
      if (!isGM) {
        const selectedTime = new Date(timestamp);
        const now = new Date(this.timeService.getCurrentTimestamp());
        
        if (selectedTime <= now) {
          ui.notifications.error('Scheduled time must be in the future');
          return;
        }
      }
      
      this.customTime = timestamp;
      
      // ✅ FIXED: Only update the widget display, not entire composer
      this.updateDisplay();
      
      const timeLabel = isGM ? 'Custom time set' : 'Message scheduled for';
      ui.notifications.info(`${timeLabel}: ${this.timeService.formatTimestamp(timestamp)}`);
    } catch (error) {
      if (error.message !== 'Cancelled') {
        console.error(`${MODULE_ID} | Error setting custom time:`, error);
        ui.notifications.error('Failed to set custom time');
      }
    }
  }
  
  /**
   * Clear custom time
   * ✅ FIXED: No longer re-renders entire composer
   */
  async clearCustomTime() {
    this.customTime = null;
    
    // ✅ FIXED: Only update the widget display, not entire composer
    this.updateDisplay();
    
    ui.notifications.info('Using current time');
  }
  
  /**
   * Get time to use for sending
   * @returns {string} ISO timestamp
   */
  getSendTime() {
    return this.customTime || this.timeService.getCurrentTimestamp();
  }
  
  /**
   * Check if using custom time
   * @returns {boolean}
   */
  hasCustomTime() {
    return this.customTime !== null;
  }
  
  /**
   * Activate event listeners
   * @param {jQuery} html - Parent HTML element
   */
  activateListeners(html) {
    this.element = html.find('.ncm-time-widget')[0];
    
    if (!this.element) return;
    
    // Set custom time button
    html.find('[data-action="set-custom-time"]').on('click', async (e) => {
      e.preventDefault();
      await this.showTimePicker();
    });
    
    // Clear custom time button
    html.find('[data-action="clear-custom-time"]').on('click', async (e) => {
      e.preventDefault();
      await this.clearCustomTime();
    });
    
    // Start live clock
    this.startLiveClock();
  }
  
  /**
   * Cleanup
   */
  destroy() {
    this.stopLiveClock();
    this.element = null;
  }
}