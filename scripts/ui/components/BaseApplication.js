/**
 * Base Application - FIXED RENDER
 * File: scripts/ui/components/BaseApplication.js
 * Module: cyberpunkred-messenger
 * 
 * CRITICAL FIX: Don't break Foundry's render system!
 */

import { MODULE_ID } from '../../utils/constants.js';
import { EventBus } from '../../core/EventBus.js';
import { StateManager } from '../../core/StateManager.js';
import { SettingsManager } from '../../core/SettingsManager.js';

export class BaseApplication extends Application {
  constructor(options = {}) {
    super(options);
    
    // Inject dependencies
    this.eventBus = options.eventBus || EventBus.getInstance();
    this.stateManager = options.stateManager || StateManager.getInstance();
    this.settingsManager = options.settingsManager || SettingsManager.getInstance();
    
    // Track subscriptions for cleanup
    this._subscriptions = [];
    this._eventListeners = [];
    
    // Component registry
    this.components = new Map();
    
    // Track first render
    this._hasRendered = false;
  }
  
  /**
   * Default options for all applications
   */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["ncm-app"],
      width: 800,
      height: 600,
      resizable: true,
      minimizable: true,
      closeOnSubmit: false,
      submitOnClose: false,
      // CRITICAL: Empty array, not array with null objects!
      dragDrop: []
    });
  }
  
  /**
   * CRITICAL: Don't override render() incorrectly!
   * This was likely breaking Foundry's window creation
   */
  async render(force = false, options = {}) {
    const isFirstRender = !this._hasRendered;
    
    // Call parent render FIRST - this creates the window structure!
    const result = await super.render(force, options);
    
    // Now we can safely add our customizations
    if (isFirstRender) {
      this._hasRendered = true;
      this._onFirstRender();
      this._applyTheme(); // Apply theme AFTER window is created
    }
    
    return result;
  }
  
  /**
   * Apply current theme
   * @private
   */
  _applyTheme() {
    try {
      if (!this.element) return; // Safety check
      
      let theme = 'classic';
      
      if (this.settingsManager && typeof this.settingsManager.get === 'function') {
        const settingValue = this.settingsManager.get('userTheme');
        if (settingValue) {
          theme = settingValue;
        }
      }
      
      // Add theme class to Foundry's wrapper (not template)
      this.element.removeClass((index, className) => {
        return (className.match(/(^|\s)ncm-theme-\S+/g) || []).join(' ');
      });
      this.element.addClass(`ncm-theme-${theme}`);
      
    } catch (error) {
      console.debug(`${MODULE_ID} | Could not apply theme:`, error.message);
    }
  }
  
  /**
   * Register a child component
   */
  registerComponent(name, component) {
    this.components.set(name, component);
  }
  
  /**
   * Get a registered component
   */
  getComponent(name) {
    return this.components.get(name);
  }
  
  /**
   * Subscribe to events (with automatic cleanup)
   */
  subscribe(event, callback) {
    const unsubscribe = this.eventBus.on(event, callback, this);
    this._subscriptions.push(unsubscribe);
  }
  
  /**
   * Subscribe to state changes (with automatic cleanup)
   */
  subscribeToState(key, callback) {
    const unsubscribe = this.stateManager.subscribe(key, callback);
    this._subscriptions.push(unsubscribe);
  }
  
  /**
   * Emit an event
   */
  emit(event, data) {
    this.eventBus.emit(event, data);
  }
  
  /**
   * Get a setting value
   */
  getSetting(key) {
    try {
      return this.settingsManager.get(key);
    } catch (error) {
      return null;
    }
  }
  
  /**
   * Set a setting value
   */
  async setSetting(key, value) {
    await this.settingsManager.set(key, value);
  }
  
  /**
   * Play a sound effect
   */
  playSound(soundKey) {
    try {
      const enableSounds = this.getSetting('enableSounds');
      if (!enableSounds) return;
      
      const soundMap = {
        open: 'modules/cyberpunkred-messenger/sounds/open.ogg',
        close: 'modules/cyberpunkred-messenger/sounds/close.ogg',
        click: 'modules/cyberpunkred-messenger/sounds/click.ogg',
        notification: 'modules/cyberpunkred-messenger/sounds/notification.ogg',
        error: 'modules/cyberpunkred-messenger/sounds/error.ogg'
      };
      
      const soundPath = soundMap[soundKey];
      if (soundPath) {
        AudioHelper.play({ src: soundPath, volume: 0.8, loop: false }, false);
      }
    } catch (error) {
      console.debug(`${MODULE_ID} | Could not play sound:`, error);
    }
  }
  
  /**
   * Activate listeners
   * CRITICAL: Call super.activateListeners FIRST!
   */
  activateListeners(html) {
    // MUST call parent first to set up Foundry's listeners
    super.activateListeners(html);
    
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
    console.log('🔴 CLOSE STARTING');
    
    // Play close sound
    this.playSound('close');
    
    // Cleanup subscriptions
    console.log('🟡 Cleaning subscriptions...');
    this._subscriptions.forEach(unsubscribe => {
      try {
        if (typeof unsubscribe === 'function') {
          unsubscribe();
        }
      } catch (error) {
        console.warn(`${MODULE_ID} | Error unsubscribing:`, error);
      }
    });
    this._subscriptions = [];
    
    // Cleanup components
    console.log('🟡 Cleaning components...');
    this.components.forEach((component, name) => {
      if (component && typeof component.destroy === 'function') {
        try {
          component.destroy();
        } catch (error) {
          console.warn(`${MODULE_ID} | Error destroying component ${name}:`, error);
        }
      }
    });
    this.components.clear();
    
    console.log('🟢 Calling super.close()...');
    const result = await super.close(options);
    console.log('✅ CLOSE COMPLETE');
    
    return result;
  }
  
  /**
   * Lifecycle hook - called after first render
   */
  _onFirstRender() {
    this.playSound('open');
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