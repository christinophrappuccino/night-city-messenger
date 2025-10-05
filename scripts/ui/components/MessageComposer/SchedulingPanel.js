/**
 * Scheduling Panel Component
 * File: scripts/ui/components/MessageComposer/SchedulingPanel.js
 * Module: cyberpunkred-messenger
 * Description: Schedule message delivery
 */

import { MODULE_ID } from '../../../utils/constants.js';
import { SchedulingService } from '../../../services/SchedulingService.js';

export class SchedulingPanel {
  constructor(parent) {
    this.parent = parent;
    this.schedulingService = new SchedulingService();
  }
  
  /**
   * Open schedule dialog
   * @param {Object} messageData - Message data to schedule
   */
  openScheduleDialog(messageData) {
    const useSimpleCalendar = game.modules.get('foundryvtt-simple-calendar')?.active;
    
    const content = `
      <form class="ncm-schedule-form">
        <p>Schedule this message for delivery at a specific time.</p>
        
        <div class="form-group">
          <label>Delivery Time:</label>
          <input type="datetime-local" name="scheduledTime" required />
        </div>
        
        ${useSimpleCalendar ? `
          <div class="form-group">
            <label>
              <input type="checkbox" name="useSimpleCalendar" />
              Use Simple Calendar (in-game time)
            </label>
          </div>
        ` : ''}
        
        <div class="ncm-schedule-preview">
          <strong>Message Preview:</strong>
          <div><strong>To:</strong> ${messageData.to}</div>
          <div><strong>Subject:</strong> ${messageData.subject}</div>
        </div>
      </form>
    `;
    
    new Dialog({
      title: 'Schedule Message',
      content,
      buttons: {
        schedule: {
          icon: '<i class="fas fa-clock"></i>',
          label: 'Schedule',
          callback: async (html) => {
            await this.scheduleMessage(html, messageData);
          }
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: 'Cancel'
        }
      },
      default: 'schedule',
      render: (html) => {
        // Set default time (1 hour from now)
        const now = new Date();
        now.setHours(now.getHours() + 1);
        const defaultTime = now.toISOString().slice(0, 16);
        html.find('[name="scheduledTime"]').val(defaultTime);
      }
    }, {
      classes: ['dialog', 'ncm-dialog'],
      width: 500
    }).render(true);
  }
  
  /**
   * Schedule message
   * @param {jQuery} html - Dialog HTML
   * @param {Object} messageData - Message data
   */
  async scheduleMessage(html, messageData) {
    try {
      const scheduledTime = html.find('[name="scheduledTime"]').val();
      const useSimpleCalendar = html.find('[name="useSimpleCalendar"]').is(':checked');
      
      if (!scheduledTime) {
        throw new Error('Please select a delivery time');
      }
      
      // Schedule
      const scheduleId = await this.schedulingService.scheduleMessage({
        ...messageData,
        scheduledTime,
        useSimpleCalendar
      });
      
      ui.notifications.info(`Message scheduled for ${new Date(scheduledTime).toLocaleString()}`);
      
      // Close composer
      this.parent.close();
    } catch (error) {
      console.error(`${MODULE_ID} | Error scheduling message:`, error);
      ui.notifications.error(error.message);
    }
  }
  
  /**
   * Activate event listeners
   */
  activateListeners(html) {
    // No persistent listeners needed - handled in dialog
  }
  
  /**
   * Cleanup
   */
  destroy() {
    // Cleanup if needed
  }
}