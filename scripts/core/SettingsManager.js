/**
 * Settings Manager
 * File: scripts/core/SettingsManager.js
 * Module: cyberpunkred-messenger
 * Description: Centralized settings management with reactive updates
 */

import { MODULE_ID } from '../utils/constants.js';
import { EventBus, EVENTS } from './EventBus.js';

export class SettingsManager {
  static instance = null;
  
  constructor() {
    if (SettingsManager.instance) {
      return SettingsManager.instance;
    }
    
    this.eventBus = EventBus.getInstance();
    this.cache = new Map();
    this.registered = false;
    
    SettingsManager.instance = this;
  }
  
  /**
   * Get singleton instance
   * @returns {SettingsManager}
   */
  static getInstance() {
    if (!SettingsManager.instance) {
      SettingsManager.instance = new SettingsManager();
    }
    return SettingsManager.instance;
  }
  
  /**
   * Register all module settings
   */
  register() {
    if (this.registered) {
      console.warn(`${MODULE_ID} | Settings already registered`);
      return;
    }
    
    // Core settings
    game.settings.register(MODULE_ID, 'enableSounds', {
      name: 'Enable Sound Effects',
      hint: 'Play cyberpunk-themed sounds for interface interactions',
      scope: 'client',
      config: true,
      type: Boolean,
      default: true,
      onChange: value => this._onSettingChanged('enableSounds', value)
    });
    
    game.settings.register(MODULE_ID, 'enableNotifications', {
      name: 'Enable Notifications',
      hint: 'Show desktop-style notifications for new messages',
      scope: 'client',
      config: true,
      type: Boolean,
      default: true,
      onChange: value => this._onSettingChanged('enableNotifications', value)
    });
    
    game.settings.register(MODULE_ID, 'messagesPerPage', {
      name: 'Messages Per Page',
      hint: 'Number of messages to display per page',
      scope: 'client',
      config: true,
      type: Number,
      default: 20,
      range: { min: 5, max: 100, step: 5 },
      onChange: value => this._onSettingChanged('messagesPerPage', value)
    });
    
    // Theme settings
    game.settings.register(MODULE_ID, 'themeColors', {
      name: 'Theme Colors',
      hint: 'Custom color scheme for the messenger interface',
      scope: 'client',
      config: false, // Hidden, managed through UI
      type: Object,
      default: {
        primary: '#F65261',
        secondary: '#19f3f7',
        background: '#330000',
        darkBackground: '#1a1a1a'
      },
      onChange: value => this._onSettingChanged('themeColors', value)
    });
    
    // GM settings
    game.settings.register(MODULE_ID, 'allowPlayerCompose', {
      name: 'Allow Player Compose',
      hint: 'Allow players to send messages to NPCs and other players',
      scope: 'world',
      config: true,
      type: Boolean,
      default: true,
      onChange: value => this._onSettingChanged('allowPlayerCompose', value)
    });
    
    game.settings.register(MODULE_ID, 'spamFilterEnabled', {
      name: 'Enable Spam Filter',
      hint: 'Automatically detect and mark spam messages',
      scope: 'world',
      config: true,
      type: Boolean,
      default: true,
      onChange: value => this._onSettingChanged('spamFilterEnabled', value)
    });
    
    // Data storage
    game.settings.register(MODULE_ID, 'scheduledMessages', {
      name: 'Scheduled Messages',
      hint: 'Storage for scheduled message data',
      scope: 'world',
      config: false,
      type: Object,
      default: {},
      onChange: value => this._onSettingChanged('scheduledMessages', value)
    });
    
    game.settings.register(MODULE_ID, 'contacts', {
      name: 'Saved Contacts',
      hint: 'Storage for contact data',
      scope: 'client',
      config: false,
      type: Object,
      default: {},
      onChange: value => this._onSettingChanged('contacts', value)
    });
    
    this.registered = true;
    console.log(`${MODULE_ID} | Settings registered`);
  }
  
  /**
   * Get a setting value (with caching)
   * @param {string} key - Setting key
   * @returns {*}
   */
  get(key) {
    if (this.cache.has(key)) {
      return this.cache.get(key);
    }
    
    try {
      const value = game.settings.get(MODULE_ID, key);
      this.cache.set(key, value);
      return value;
    } catch (error) {
      console.error(`${MODULE_ID} | Error getting setting ${key}:`, error);
      return null;
    }
  }
  
  /**
   * Set a setting value
   * @param {string} key - Setting key
   * @param {*} value - New value
   * @returns {Promise<void>}
   */
  async set(key, value) {
    try {
      await game.settings.set(MODULE_ID, key, value);
      this.cache.set(key, value);
    } catch (error) {
      console.error(`${MODULE_ID} | Error setting ${key}:`, error);
      throw error;
    }
  }
  
  /**
   * Subscribe to setting changes
   * @param {string} key - Setting key
   * @param {Function} callback - Callback function
   * @returns {Function} Unsubscribe function
   */
  subscribe(key, callback) {
    return this.eventBus.on(`${EVENTS.SETTINGS_CHANGED}:${key}`, callback);
  }
  
  /**
   * Clear cache for a setting
   * @param {string} key - Setting key
   */
  clearCache(key) {
    if (key) {
      this.cache.delete(key);
    } else {
      this.cache.clear();
    }
  }
  
  /**
   * Handle setting change
   * @private
   */
  _onSettingChanged(key, value) {
    this.cache.set(key, value);
    
    console.log(`${MODULE_ID} | Setting changed: ${key}`, value);
    
    // Emit specific event
    this.eventBus.emit(`${EVENTS.SETTINGS_CHANGED}:${key}`, { key, value });
    
    // Emit general event
    this.eventBus.emit(EVENTS.SETTINGS_CHANGED, { key, value });
    
    // Special handling for theme changes
    if (key === 'themeColors') {
      this.eventBus.emit(EVENTS.THEME_CHANGED, value);
    }
  }
}

// Export singleton instance
export const settingsManager = SettingsManager.getInstance();