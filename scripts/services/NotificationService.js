/**
 * Notification Service
 * File: scripts/services/NotificationService.js
 * Module: cyberpunkred-messenger
 * Description: Handles user notifications (UI and audio)
 */

import { MODULE_ID } from '../utils/constants.js';
import { EventBus, EVENTS } from '../core/EventBus.js';
import { SettingsManager } from '../core/SettingsManager.js';

export class NotificationService {
  constructor() {
    this.eventBus = EventBus.getInstance();
    this.settingsManager = SettingsManager.getInstance();
    
    // Audio instances
    this.sounds = {
      open: new Audio(`modules/${MODULE_ID}/sounds/2077openphone.wav`),
      click: new Audio(`modules/${MODULE_ID}/sounds/messageselect.mp3`),
      close: new Audio(`modules/${MODULE_ID}/sounds/2077closephone.wav`),
      notification: new Audio(`modules/${MODULE_ID}/sounds/notification.mp3`)
    };
    
    // Active notifications
    this.activeNotifications = new Set();
  }
  
  /**
   * Show success notification
   * @param {string} message - Notification message
   * @param {Object} options - Additional options
   */
  success(message, options = {}) {
    if (this.settingsManager.get('enableNotifications')) {
      ui.notifications.info(message);
    }
    
    this.eventBus.emit(EVENTS.NOTIFICATION_SHOW, {
      type: 'success',
      message,
      options
    });
  }
  
  /**
   * Show error notification
   * @param {string} message - Notification message
   * @param {Object} options - Additional options
   */
  error(message, options = {}) {
    if (this.settingsManager.get('enableNotifications')) {
      ui.notifications.error(message);
    }
    
    this.eventBus.emit(EVENTS.NOTIFICATION_SHOW, {
      type: 'error',
      message,
      options
    });
  }
  
  /**
   * Show warning notification
   * @param {string} message - Notification message
   * @param {Object} options - Additional options
   */
  warning(message, options = {}) {
    if (this.settingsManager.get('enableNotifications')) {
      ui.notifications.warn(message);
    }
    
    this.eventBus.emit(EVENTS.NOTIFICATION_SHOW, {
      type: 'warning',
      message,
      options
    });
  }
  
  /**
   * Show info notification
   * @param {string} message - Notification message
   * @param {Object} options - Additional options
   */
  info(message, options = {}) {
    if (this.settingsManager.get('enableNotifications')) {
      ui.notifications.info(message);
    }
    
    this.eventBus.emit(EVENTS.NOTIFICATION_SHOW, {
      type: 'info',
      message,
      options
    });
  }
  
  /**
   * Show custom styled notification
   * @param {Object} data - Notification data
   */
  showCustomNotification(data) {
    const {
      title = 'Night City Messenger',
      message,
      icon = 'fas fa-envelope',
      duration = 4000
    } = data;
    
    // Create notification element
    const $notification = $(`
      <div class="ncm-notification" style="
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: #1a1a1a;
        border: 1px solid #F65261;
        padding: 15px;
        color: #F65261;
        z-index: 10000;
        border-radius: 4px;
        box-shadow: 0 2px 10px rgba(246, 82, 97, 0.3);
        max-width: 300px;
        animation: slideIn 0.3s ease-out;
      ">
        <div style="display: flex; align-items: center; gap: 10px;">
          <i class="${icon}" style="font-size: 1.5em; color: #19f3f7;"></i>
          <div>
            <div style="font-weight: bold; margin-bottom: 5px;">${title}</div>
            <div style="font-size: 0.9em; color: #ffffff;">${message}</div>
          </div>
        </div>
      </div>
    `);
    
    // Add to document
    $('body').append($notification);
    
    // Track
    this.activeNotifications.add($notification);
    
    // Auto-hide
    setTimeout(() => {
      $notification.fadeOut(300, () => {
        $notification.remove();
        this.activeNotifications.delete($notification);
      });
    }, duration);
    
    // Click to dismiss
    $notification.on('click', () => {
      $notification.fadeOut(300, () => {
        $notification.remove();
        this.activeNotifications.delete($notification);
      });
    });
  }
  
  /**
   * Show new message notification
   * @param {Object} message - Message data
   */
  showNewMessageNotification(message) {
    this.showCustomNotification({
      title: 'New Message',
      message: `From: ${message.from}<br>Subject: ${message.subject}`,
      icon: 'fas fa-envelope',
      duration: 5000
    });
    
    // Play notification sound
    this.playSound('notification');
  }
  
  /**
   * Play a sound effect
   * @param {string} soundKey - Sound key (open, click, close, notification)
   */
  playSound(soundKey) {
    if (!this.settingsManager.get('enableSounds')) return;
    
    const sound = this.sounds[soundKey];
    if (!sound) {
      console.warn(`${MODULE_ID} | Sound not found: ${soundKey}`);
      return;
    }
    
    try {
      // Reset and play
      sound.currentTime = 0;
      sound.play().catch(e => {
        console.warn(`${MODULE_ID} | Audio play failed:`, e);
      });
    } catch (error) {
      console.warn(`${MODULE_ID} | Could not play audio:`, error);
    }
  }
  
  /**
   * Clear all active notifications
   */
  clearAll() {
    this.activeNotifications.forEach($notification => {
      $notification.fadeOut(300, () => $notification.remove());
    });
    
    this.activeNotifications.clear();
  }
  
  /**
   * Confirm dialog
   * @param {Object} options - Dialog options
   * @returns {Promise<boolean>}
   */
  async confirm(options) {
    const {
      title = 'Confirm',
      content = 'Are you sure?',
      yes = 'Yes',
      no = 'No',
      defaultYes = false
    } = options;
    
    return await Dialog.confirm({
      title,
      content,
      yes: () => true,
      no: () => false,
      defaultYes
    });
  }
  
  /**
   * Prompt dialog
   * @param {Object} options - Dialog options
   * @returns {Promise<string|null>}
   */
  async prompt(options) {
    const {
      title = 'Input',
      content = '',
      label = 'Enter value:',
      default: defaultValue = ''
    } = options;
    
    return new Promise((resolve) => {
      new Dialog({
        title,
        content: `
          <form>
            <div class="form-group">
              <label>${label}</label>
              <input type="text" name="input" value="${defaultValue}" autofocus />
            </div>
          </form>
        `,
        buttons: {
          ok: {
            icon: '<i class="fas fa-check"></i>',
            label: 'OK',
            callback: (html) => {
              const value = html.find('[name="input"]').val();
              resolve(value);
            }
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: 'Cancel',
            callback: () => resolve(null)
          }
        },
        default: 'ok',
        close: () => resolve(null)
      }).render(true);
    });
  }
}