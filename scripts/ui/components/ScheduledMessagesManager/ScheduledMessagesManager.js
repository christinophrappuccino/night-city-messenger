/**
 * Scheduled Messages Manager
 * File: scripts/ui/components/ScheduledMessagesManager/ScheduledMessagesManager.js
 * Module: cyberpunkred-messenger
 * Description: GM interface for managing scheduled messages
 */

import { MODULE_ID } from '../../../utils/constants.js';
import { BaseApplication } from '../BaseApplication.js';
import { SchedulingService } from '../../../services/SchedulingService.js';
import { TimeService } from '../../../services/TimeService.js';
import { ScheduleMessageDialog } from '../../dialogs/ScheduleMessageDialog.js';

export class ScheduledMessagesManager extends BaseApplication {
  constructor(options = {}) {
    super(options);
    
    if (!game.user.isGM) {
      ui.notifications.error('Only GMs can access the scheduled messages manager');
      this.close();
      return;
    }
    
    this.schedulingService = new SchedulingService();
    this.timeService = TimeService.getInstance();
    
    this.sortBy = 'time'; // 'time', 'from', 'to', 'subject'
    this.sortOrder = 'asc';
    this.filterStatus = 'all'; // 'all', 'upcoming', 'pastdue'
    
    // Auto-refresh every 30 seconds
    this.refreshInterval = setInterval(() => {
      this.render(false);
    }, 30000);
  }
  
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["ncm-app", "ncm-scheduled-manager"],
      template: `modules/${MODULE_ID}/templates/scheduled-messages/manager.hbs`,
      width: 800,
      height: 600,
      resizable: true,
      title: "Scheduled Messages Manager"
    });
  }
  
  async getData(options = {}) {
    const data = super.getData(options);
    
    // Get all scheduled messages
    let scheduled = this.schedulingService.getAllScheduled();
    
    // Filter
    if (this.filterStatus !== 'all') {
      const now = new Date(this.timeService.getCurrentTimestamp());
      
      if (this.filterStatus === 'upcoming') {
        scheduled = scheduled.filter(msg => 
          new Date(msg.scheduledTime) >= now && !msg.sent
        );
      } else if (this.filterStatus === 'pastdue') {
        scheduled = scheduled.filter(msg => 
          new Date(msg.scheduledTime) < now && !msg.sent
        );
      } else if (this.filterStatus === 'sent') {
        scheduled = scheduled.filter(msg => msg.sent);
      }
    }
    
    // Sort
    scheduled.sort((a, b) => {
      let aVal, bVal;
      
      switch (this.sortBy) {
        case 'time':
          aVal = new Date(a.scheduledTime);
          bVal = new Date(b.scheduledTime);
          break;
        case 'from':
          aVal = a.from.toLowerCase();
          bVal = b.from.toLowerCase();
          break;
        case 'to':
          aVal = a.to.toLowerCase();
          bVal = b.to.toLowerCase();
          break;
        case 'subject':
          aVal = a.subject.toLowerCase();
          bVal = b.subject.toLowerCase();
          break;
        default:
          return 0;
      }
      
      const comparison = aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
      return this.sortOrder === 'asc' ? comparison : -comparison;
    });
    
    // Format for display
    const formattedScheduled = scheduled.map(msg => ({
      ...msg,
      displayTime: this.schedulingService.getScheduleDisplayTime(msg),
      relativeTime: this.timeService.formatTimestamp(msg.scheduledTime, 'relative'),
      isPastDue: new Date(msg.scheduledTime) < new Date(this.timeService.getCurrentTimestamp()) && !msg.sent,
      statusClass: msg.sent ? 'sent' : 
                   new Date(msg.scheduledTime) < new Date(this.timeService.getCurrentTimestamp()) ? 'pastdue' : 
                   'upcoming'
    }));
    
    // Get statistics
    const stats = this.schedulingService.getStatistics();
    
    return {
      ...data,
      scheduled: formattedScheduled,
      stats,
      sortBy: this.sortBy,
      sortOrder: this.sortOrder,
      filterStatus: this.filterStatus,
      hasScheduled: formattedScheduled.length > 0,
      currentTime: this.timeService.formatTimestamp(
        this.timeService.getCurrentTimestamp(), 
        'full'
      )
    };
  }
  
  /**
   * Send scheduled message immediately
   */
  async sendNow(scheduleId) {
    const confirm = await Dialog.confirm({
      title: 'Send Scheduled Message',
      content: '<p>Send this scheduled message immediately?</p>'
    });
    
    if (!confirm) return;
    
    try {
      const scheduled = this.schedulingService.getAllScheduled()
        .find(s => s.id === scheduleId);
      
      if (!scheduled) {
        throw new Error('Schedule not found');
      }
      
      // Send the message
      await game.nightcity.messageManager.sendMessage({
        from: scheduled.from,
        to: scheduled.to,
        subject: scheduled.subject,
        content: scheduled.content,
        timestamp: this.timeService.getCurrentTimestamp(), // Use current time
        actorId: scheduled.actorId
      }, { skipSpamCheck: true });
      
      // Mark as sent
      await this.schedulingService.deleteSchedule(scheduleId);
      
      ui.notifications.info('Message sent successfully');
      this.render(false);
      
    } catch (error) {
      console.error(`${MODULE_ID} | Error sending scheduled message:`, error);
      ui.notifications.error(`Failed to send: ${error.message}`);
    }
  }
  
  /**
   * Reschedule a message
   */
  async reschedule(scheduleId) {
    try {
      const scheduled = this.schedulingService.getAllScheduled()
        .find(s => s.id === scheduleId);
      
      if (!scheduled) {
        throw new Error('Schedule not found');
      }
      
      const newTime = await this.timeService.pickDateTime({
        title: 'Reschedule Message',
        currentTime: scheduled.scheduledTime,
        allowPast: true,
        allowFuture: true
      });
      
      await this.schedulingService.rescheduleMessage(scheduleId, newTime);
      
      ui.notifications.info('Message rescheduled');
      this.render(false);
      
    } catch (error) {
      if (error.message !== 'Cancelled') {
        console.error(`${MODULE_ID} | Error rescheduling:`, error);
        ui.notifications.error(`Failed to reschedule: ${error.message}`);
      }
    }
  }
  
  /**
   * Delete a scheduled message
   */
  async deleteSchedule(scheduleId) {
    const confirm = await Dialog.confirm({
      title: 'Delete Scheduled Message',
      content: '<p>Delete this scheduled message? This cannot be undone.</p>'
    });
    
    if (!confirm) return;
    
    try {
      await this.schedulingService.deleteSchedule(scheduleId);
      ui.notifications.info('Scheduled message deleted');
      this.render(false);
      
    } catch (error) {
      console.error(`${MODULE_ID} | Error deleting schedule:`, error);
      ui.notifications.error(`Failed to delete: ${error.message}`);
    }
  }
  
  /**
   * View message details
   */
  showDetails(scheduleId) {
    const scheduled = this.schedulingService.getAllScheduled()
      .find(s => s.id === scheduleId);
    
    if (!scheduled) return;
    
    const content = `
      <div class="ncm-schedule-details">
        <div class="ncm-schedule-details__field">
          <strong>From:</strong> ${scheduled.from}
        </div>
        <div class="ncm-schedule-details__field">
          <strong>To:</strong> ${scheduled.to}
        </div>
        <div class="ncm-schedule-details__field">
          <strong>Subject:</strong> ${scheduled.subject}
        </div>
        <div class="ncm-schedule-details__field">
          <strong>Scheduled Time:</strong> ${this.schedulingService.getScheduleDisplayTime(scheduled)}
        </div>
        <div class="ncm-schedule-details__field">
          <strong>Created:</strong> ${this.timeService.formatTimestamp(scheduled.createdAt, 'full')}
        </div>
        ${scheduled.useSimpleCalendar ? `
          <div class="ncm-schedule-details__field">
            <strong>Time Source:</strong> Simple Calendar
          </div>
        ` : ''}
        ${scheduled.sent ? `
          <div class="ncm-schedule-details__field">
            <strong>Status:</strong> Sent
          </div>
          <div class="ncm-schedule-details__field">
            <strong>Sent At:</strong> ${this.timeService.formatTimestamp(scheduled.sentAt, 'full')}
          </div>
        ` : ''}
        <div class="ncm-schedule-details__content">
          <strong>Message Content:</strong>
          <div class="ncm-schedule-details__preview">
            ${scheduled.content}
          </div>
        </div>
      </div>
    `;
    
    new Dialog({
      title: 'Scheduled Message Details',
      content,
      buttons: {
        close: {
          icon: '<i class="fas fa-times"></i>',
          label: 'Close'
        }
      }
    }, {
      classes: ['dialog', 'ncm-dialog', 'ncm-schedule-details-dialog'],
      width: 600
    }).render(true);
  }
  
  /**
   * Export scheduled messages
   */
  async exportScheduled() {
    const scheduled = this.schedulingService.getAllScheduled();
    
    const data = {
      exported: this.timeService.getCurrentTimestamp(),
      timeSource: this.timeService.getTimeSource(),
      messages: scheduled.map(msg => ({
        id: msg.id,
        from: msg.from,
        to: msg.to,
        subject: msg.subject,
        scheduledTime: msg.scheduledTime,
        useSimpleCalendar: msg.useSimpleCalendar,
        sent: msg.sent
      }))
    };
    
    const filename = `scheduled-messages-${Date.now()}.json`;
    const json = JSON.stringify(data, null, 2);
    
    saveDataToFile(json, 'application/json', filename);
    ui.notifications.info('Scheduled messages exported');
  }
  
  /**
   * Force check all scheduled messages
   */
  async forceCheck() {
    ui.notifications.info('Checking scheduled messages...');
    
    try {
      const sent = await this.schedulingService.checkScheduledMessages();
      
      if (sent > 0) {
        ui.notifications.info(`Sent ${sent} scheduled message${sent > 1 ? 's' : ''}`);
      } else {
        ui.notifications.info('No messages were due to send');
      }
      
      this.render(false);
      
    } catch (error) {
      console.error(`${MODULE_ID} | Error checking scheduled:`, error);
      ui.notifications.error('Failed to check scheduled messages');
    }
  }
  
  activateListeners(html) {
    super.activateListeners(html);
    
    // Sort controls
    html.find('[data-action="sort"]').on('click', (e) => {
      const sortBy = e.currentTarget.dataset.sortBy;
      
      if (this.sortBy === sortBy) {
        // Toggle order
        this.sortOrder = this.sortOrder === 'asc' ? 'desc' : 'asc';
      } else {
        this.sortBy = sortBy;
        this.sortOrder = 'asc';
      }
      
      this.render(false);
    });
    
    // Filter
    html.find('[name="filterStatus"]').on('change', (e) => {
      this.filterStatus = e.target.value;
      this.render(false);
    });
    
    // Actions
    html.find('[data-action="send-now"]').on('click', async (e) => {
      const scheduleId = e.currentTarget.closest('[data-schedule-id]').dataset.scheduleId;
      await this.sendNow(scheduleId);
    });
    
    html.find('[data-action="reschedule"]').on('click', async (e) => {
      const scheduleId = e.currentTarget.closest('[data-schedule-id]').dataset.scheduleId;
      await this.reschedule(scheduleId);
    });
    
    html.find('[data-action="delete"]').on('click', async (e) => {
      const scheduleId = e.currentTarget.closest('[data-schedule-id]').dataset.scheduleId;
      await this.deleteSchedule(scheduleId);
    });
    
    html.find('[data-action="view-details"]').on('click', (e) => {
      const scheduleId = e.currentTarget.closest('[data-schedule-id]').dataset.scheduleId;
      this.showDetails(scheduleId);
    });
    
    // Bulk actions
    html.find('[data-action="export"]').on('click', async () => {
      await this.exportScheduled();
    });
    
    html.find('[data-action="force-check"]').on('click', async () => {
      await this.forceCheck();
    });
    
    html.find('[data-action="refresh"]').on('click', () => {
      this.render(false);
    });
  }
  
  async close(options = {}) {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
    
    return super.close(options);
  }
}

// ========================================
// Global API
// ========================================

/**
 * Open the scheduled messages manager
 */
export function openScheduledMessagesManager() {
  if (!game.user.isGM) {
    ui.notifications.warn('Only GMs can manage scheduled messages');
    return;
  }
  
  new ScheduledMessagesManager().render(true);
}

// Make available in API
Hooks.once('ready', () => {
  if (!game.nightcity) game.nightcity = {};
  game.nightcity.openScheduledMessagesManager = openScheduledMessagesManager;
});