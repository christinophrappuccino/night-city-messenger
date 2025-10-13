/**
 * Schedule Message Dialog
 * File: scripts/ui/dialogs/ScheduleMessageDialog.js
 * Module: cyberpunkred-messenger
 * Description: Dialog for scheduling message delivery
 */

import { MODULE_ID } from '../../utils/constants.js';
import { TimeService } from '../../services/TimeService.js';
import { SchedulingService } from '../../services/SchedulingService.js';

export class ScheduleMessageDialog {
  /**
   * Show schedule dialog
   * @param {Object} messageData - Message data to schedule
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Schedule result
   */
  static async show(messageData, options = {}) {
    const timeService = TimeService.getInstance();
    const schedulingService = new SchedulingService();
    
    const {
      title = 'Schedule Message',
      allowImmediate = true
    } = options;
    
    // Check if SimpleCalendar is available
    const useSimpleCalendar = timeService.isSimpleCalendarAvailable() && 
                               timeService.getTimeSource() === 'simplecalendar';
    
    return new Promise((resolve, reject) => {
      const currentTime = timeService.getCurrentTimestamp();
      const date = new Date(currentTime);
      
      // Set default to 1 hour from now
      date.setHours(date.getHours() + 1);
      const defaultDateTime = date.toISOString().slice(0, 16);
      
      const content = `
        <form class="ncm-schedule-dialog">
          <div class="ncm-schedule-dialog__info">
            <p>Schedule this message for delivery at a specific time.</p>
          </div>
          
          <div class="ncm-schedule-dialog__preview">
            <div class="ncm-schedule-dialog__preview-item">
              <strong>To:</strong> ${messageData.to}
            </div>
            <div class="ncm-schedule-dialog__preview-item">
              <strong>Subject:</strong> ${messageData.subject}
            </div>
          </div>
          
          ${useSimpleCalendar ? `
            <div class="ncm-dialog__form-group">
              <label class="ncm-dialog__label">
                <input type="checkbox" name="useSimpleCalendar" checked />
                Use In-Game Calendar (Simple Calendar)
              </label>
              <p class="ncm-dialog__hint">
                Schedule based on in-game time instead of real-world time
              </p>
            </div>
          ` : ''}
          
          <div class="ncm-dialog__form-group">
            <label class="ncm-dialog__label">Delivery Time:</label>
            <input type="datetime-local" 
                   name="scheduledTime" 
                   class="ncm-dialog__input"
                   value="${defaultDateTime}"
                   required />
            <p class="ncm-dialog__hint">
              Message will be sent when this time is reached
            </p>
          </div>
          
          <div class="ncm-schedule-dialog__current-time">
            <i class="fas fa-info-circle"></i>
            <span>
              Current time: <strong>${timeService.formatTimestamp(currentTime, 'full')}</strong>
            </span>
          </div>
        </form>
      `;
      
      const dialog = new Dialog({
        title,
        content,
        buttons: {
          schedule: {
            icon: '<i class="fas fa-clock"></i>',
            label: 'Schedule',
            callback: async (html) => {
              try {
                const scheduledTime = html.find('[name="scheduledTime"]').val();
                const useSimpleCal = html.find('[name="useSimpleCalendar"]').is(':checked');
                
                if (!scheduledTime) {
                  ui.notifications.error('Please select a delivery time');
                  reject(new Error('No time selected'));
                  return;
                }
                
                // Check if time is in the past
                const scheduledDate = new Date(scheduledTime);
                const now = new Date();
                
                if (scheduledDate <= now) {
                  const confirm = await Dialog.confirm({
                    title: 'Schedule in Past',
                    content: '<p>The selected time is in the past. The message will be sent immediately. Continue?</p>'
                  });
                  
                  if (!confirm) {
                    reject(new Error('Cancelled'));
                    return;
                  }
                }
                
                // Schedule the message
                const scheduleId = await schedulingService.scheduleMessage({
                  ...messageData,
                  scheduledTime: scheduledDate.toISOString(),
                  useSimpleCalendar: useSimpleCal
                });
                
                const formattedTime = timeService.formatTimestamp(scheduledDate.toISOString(), 'full');
                ui.notifications.info(`Message scheduled for ${formattedTime}`);
                
                resolve({
                  scheduleId,
                  scheduledTime: scheduledDate.toISOString(),
                  useSimpleCalendar: useSimpleCal
                });
              } catch (error) {
                console.error(`${MODULE_ID} | Error scheduling message:`, error);
                ui.notifications.error(`Failed to schedule: ${error.message}`);
                reject(error);
              }
            }
          },
          sendNow: allowImmediate ? {
            icon: '<i class="fas fa-paper-plane"></i>',
            label: 'Send Now Instead',
            callback: () => {
              resolve({ sendImmediately: true });
            }
          } : undefined,
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: 'Cancel',
            callback: () => {
              reject(new Error('Cancelled'));
            }
          }
        },
        default: 'schedule',
        render: (html) => {
          // Style the dialog
          html.parent().addClass('ncm-dialog');
          
          // If SimpleCalendar, update datetime-local visibility based on checkbox
          if (useSimpleCalendar) {
            const checkbox = html.find('[name="useSimpleCalendar"]');
            const datetimeInput = html.find('[name="scheduledTime"]').parent();
            
            checkbox.on('change', (e) => {
              if (e.target.checked) {
                // Using SimpleCalendar - could show SC picker
                datetimeInput.show();
              } else {
                // Using regular datetime
                datetimeInput.show();
              }
            });
          }
        }
      }, {
        classes: ['dialog', 'ncm-dialog', 'ncm-schedule-dialog-wrapper'],
        width: 500
      });
      
      dialog.render(true);
    });
  }
  
  /**
   * Show quick schedule options
   * @param {Object} messageData - Message data
   * @returns {Promise<Object>}
   */
  static async showQuickSchedule(messageData) {
    const timeService = TimeService.getInstance();
    const now = new Date();
    
    // Quick options
    const options = [
      { label: 'In 1 hour', hours: 1 },
      { label: 'In 6 hours', hours: 6 },
      { label: 'Tomorrow at 9 AM', custom: () => {
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(9, 0, 0, 0);
        return tomorrow;
      }},
      { label: 'Next week', days: 7 },
      { label: 'Custom...', custom: null }
    ];
    
    const buttons = {};
    
    options.forEach((opt, idx) => {
      buttons[`opt${idx}`] = {
        label: opt.label,
        callback: async () => {
          let scheduledTime;
          
          if (opt.custom === null) {
            // Show full dialog
            return ScheduleMessageDialog.show(messageData);
          } else if (opt.custom) {
            scheduledTime = opt.custom();
          } else if (opt.hours) {
            scheduledTime = new Date(now.getTime() + opt.hours * 60 * 60 * 1000);
          } else if (opt.days) {
            scheduledTime = new Date(now.getTime() + opt.days * 24 * 60 * 60 * 1000);
          }
          
          return {
            scheduledTime: scheduledTime.toISOString(),
            useSimpleCalendar: false
          };
        }
      };
    });
    
    buttons.cancel = {
      icon: '<i class="fas fa-times"></i>',
      label: 'Cancel'
    };
    
    return new Promise((resolve, reject) => {
      new Dialog({
        title: 'Quick Schedule',
        content: '<p>Choose when to send this message:</p>',
        buttons,
        default: 'opt0'
      }, {
        classes: ['dialog', 'ncm-dialog'],
        width: 400
      }).render(true);
    });
  }
}