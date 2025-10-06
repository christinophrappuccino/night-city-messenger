/**
 * Base Application
 * File: scripts/ui/components/BaseApplication.js
 * Module: cyberpunkred-messenger
 * Description: Base class for all module applications with shared functionality
 */

import { MODULE_ID } from '../../utils/constants.js';
import { EventBus } from '../../core/EventBus.js';
import { StateManager } from '../../core/StateManager.js';
import { SettingsManager } from '../../core/SettingsManager.js';

export class BaseApplication extends Application {
  constructor(options = {}) {
    super(options);
    
    // Inject dependencies (allows for testing with mocks)
    this.eventBus = options.eventBus || EventBus.getInstance();
    this.stateManager = options.stateManager || StateManager.getInstance();
    this.settingsManager = options.settingsManager || SettingsManager.getInstance();
    
    // Track subscriptions for cleanup
    this._subscriptions = [];
    this._eventListeners = [];
    
    // Component registry
    this.components = new Map();
    
    // Apply theme
    this._applyTheme();
  }
  
  /**
   * Default options for all applications
   */
  static get defaultOptions() {
    // Try to get theme, but handle if settings aren't registered yet
    let theme = 'classic';
    try {
      if (game.settings && game.settings.get) {
        theme = game.settings.get(MODULE_ID, 'userTheme') || 'classic';
      }
    } catch (error) {
      // Settings not registered yet, use default
      theme = 'classic';
    }
    
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["ncm-app", `ncm-theme-${theme}`],
      width: 800,
      height: 600,
      resizable: true,
      closeOnSubmit: false,
      submitOnClose: false
    });
  }
  
  /**
   * Apply current theme
   * @private
   */
  _applyTheme() {
    try {
      // Try to get theme, but handle gracefully if setting doesn't exist
      let theme = 'classic';
      
      if (this.settingsManager && typeof this.settingsManager.get === 'function') {
        const settingValue = this.settingsManager.get('userTheme');
        if (settingValue) {
          theme = settingValue;
        }
      }
      
      // Add theme class if element exists
      if (this.element) {
        this.element.removeClass((index, className) => {
          return (className.match(/(^|\s)ncm-theme-\S+/g) || []).join(' ');
        });
        this.element.addClass(`ncm-theme-${theme}`);
      }
    } catch (error) {
      // Settings might not be ready yet, fail silently
      console.debug(`${MODULE_ID} | Could not apply theme:`, error.message);
    }
  }
  
  /**
   * Register a child component
   * @param {string} name - Component name
   * @param {Object} component - Component instance
   */
  registerComponent(name, component) {
    this.components.set(name, component);
  }
  
  /**
   * Get a registered component
   * @param {string} name - Component name
   * @returns {Object|null}
   */
  getComponent(name) {
    return this.components.get(name);
  }
  
  /**
   * Subscribe to events (with automatic cleanup)
   * @param {string} event - Event name
   * @param {Function} callback - Callback function
   */
  subscribe(event, callback) {
    const unsubscribe = this.eventBus.on(event, callback, this);
    this._subscriptions.push(unsubscribe);
  }
  
  /**
   * Subscribe to state changes (with automatic cleanup)
   * @param {string} key - State key
   * @param {Function} callback - Callback function
   */
  subscribeToState(key, callback) {
    const unsubscribe = this.stateManager.subscribe(key, callback);
    this._subscriptions.push(unsubscribe);
  }
  
  /**
   * Emit an event
   * @param {string} event - Event name
   * @param {*} data - Event data
   */
  emit(event, data) {
    this.eventBus.emit(event, data);
  }
  
  /**
   * Get a setting value
   * @param {string} key - Setting key
   * @returns {*}
   */
  getSetting(key) {
    try {
      return this.settingsManager.get(key);
    } catch (error) {
      // Settings might not be ready yet
      return null;
    }
  }
  
  /**
   * Set a setting value
   * @param {string} key - Setting key
   * @param {*} value - New value
   */
  async setSetting(key, value) {
    await this.settingsManager.set(key, value);
  }
  
  /**
   * Play a sound effect
   * @param {string} soundKey - Sound key (open, close, select, notification)
   */
  playSound(soundKey) {
    // Check if sounds are enabled
    if (!this.getSetting('enableSounds')) return;
    
    try {
      // Map sound keys to files
      const soundFiles = {
        'open': '2077openphone.wav',
        'close': '2077closephone.wav',
        'select': 'messageselect.mp3',
        'notification': 'notification.mp3'
      };
      
      const filename = soundFiles[soundKey];
      if (!filename) return;
      
      const audio = new Audio(`modules/${MODULE_ID}/sounds/${filename}`);
      audio.volume = 0.5; // 50% volume
      audio.play().catch(e => {
        // Fail silently - sounds are optional
        console.debug(`${MODULE_ID} | Audio play failed:`, e.message);
      });
    } catch (error) {
      // Fail silently - sounds are optional
      console.debug(`${MODULE_ID} | Could not play audio:`, error.message);
    }
  }
  
  /**
   * Get data for template
   * @param {Object} options - Render options
   * @returns {Object}
   */
  getData(options = {}) {
    return {
      moduleId: MODULE_ID,
      isGM: game.user.isGM,
      user: game.user
    };
  }
  
  /**
   * Activate listeners (override in subclasses)
   * @param {jQuery} html - The rendered HTML
   */
  activateListeners(html) {
    super.activateListeners(html);
    
    // Store jQuery reference for cleanup
    this._element = html;
    
    // Activate child component listeners
    this.components.forEach((component, name) => {
      if (component.activateListeners) {
        try {
          component.activateListeners(html);
        } catch (error) {
          console.error(`${MODULE_ID} | Error activating listeners for ${name}:`, error);
        }
      }
    });
  }
  
  /**
   * Close and cleanup
   */
  async close(options = {}) {
    // Play close sound
    this.playSound('close');
    
    // Cleanup subscriptions
    this._subscriptions.forEach(unsubscribe => {
      try {
        unsubscribe();
      } catch (error) {
        console.warn(`${MODULE_ID} | Error unsubscribing:`, error);
      }
    });
    this._subscriptions = [];
    
    // Cleanup components
    this.components.forEach((component, name) => {
      if (component.destroy) {
        try {
          component.destroy();
        } catch (error) {
          console.warn(`${MODULE_ID} | Error destroying component ${name}:`, error);
        }
      }
    });
    this.components.clear();
    
    return super.close(options);
  }
  
  /**
   * Lifecycle hook - called after first render
   * Override in subclasses
   */
  _onFirstRender() {
    // Play open sound on first render
    this.playSound('open');
  }
  
  /**
   * Lifecycle hook - called before each render
   * Override in subclasses
   */
  _onBeforeRender() {
    // Override in subclasses
  }
  
  /**
   * Lifecycle hook - called after each render
   * Override in subclasses
   */
  _onAfterRender(html) {
    // Override in subclasses
  }
  
  /**
   * Enhanced render with lifecycle hooks
   */
  async render(force = false, options = {}) {
    const isFirstRender = this._state === Application.RENDER_STATES.NONE;
    
    // Before render hook
    this._onBeforeRender();
    
    // Perform actual render
    const result = await super.render(force, options);
    
    // First render hook
    if (isFirstRender) {
      this._onFirstRender();
    }
    
    // After render hook
    this._onAfterRender(this.element);
    
    return result;
  }
  
  /**
   * Show loading state
   */
  showLoading() {
    if (this.element) {
      const content = this.element.find('.window-content');
      content.html(`
        <div class="ncm-viewer__loading">
          <div class="ncm-viewer__spinner"></div>
          <p>Loading...</p>
        </div>
      `);
    }
  }
  
  /**
   * Show error state
   * @param {string} message - Error message
   */
  showError(message) {
    if (this.element) {
      const content = this.element.find('.window-content');
      content.html(`
        <div class="ncm-viewer__empty">
          <i class="ncm-viewer__empty-icon fas fa-exclamation-triangle"></i>
          <p class="ncm-viewer__empty-text">Error</p>
          <p class="ncm-viewer__empty-subtext">${message}</p>
        </div>
      `);
    }
    ui.notifications.error(message);
  }
  
  /**
   * Refresh/re-render the application
   */
  refresh() {
    this.render(false);
  }
}