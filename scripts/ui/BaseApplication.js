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
      closeOnSubmit: false,
      submitOnClose: false
    });
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
   * Get a setting value
   * @param {string} key - Setting key
   * @returns {*}
   */
  getSetting(key) {
    return this.settingsManager.get(key);
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
   * @param {string} soundKey - Sound key from SOUNDS constant
   */
  playSound(soundKey) {
    if (!this.getSetting('enableSounds')) return;
    
    try {
      const audio = new Audio(`modules/${MODULE_ID}/sounds/${soundKey}.wav`);
      audio.play().catch(e => console.warn(`${MODULE_ID} | Audio play failed:`, e));
    } catch (error) {
      console.warn(`${MODULE_ID} | Could not play audio:`, error);
    }
  }
  
  /**
   * Activate listeners (override in subclasses)
   */
  activateListeners(html) {
    super.activateListeners(html);
    
    // Store jQuery reference for cleanup
    this._element = html;
    
    // Activate child component listeners
    this.components.forEach((component, name) => {
      if (component.activateListeners) {
        component.activateListeners(html);
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
    this._subscriptions.forEach(unsubscribe => unsubscribe());
    this._subscriptions = [];
    
    // Cleanup components
    this.components.forEach((component, name) => {
      if (component.destroy) {
        component.destroy();
      }
    });
    this.components.clear();
    
    return super.close(options);
  }
  
  /**
   * Lifecycle hook - called after first render
   */
  _onFirstRender() {
    // Override in subclasses
  }
  
  /**
   * Lifecycle hook - called before each render
   */
  _onBeforeRender() {
    // Override in subclasses
  }
  
  /**
   * Lifecycle hook - called after each render
   */
  _onAfterRender(html) {
    // Override in subclasses
  }
  
  /**
   * Enhanced render with lifecycle hooks
   */
  async render(force = false, options = {}) {
    const isFirstRender = this._state === Application.RENDER_STATES.NONE;
    
    this._onBeforeRender();
    
    const result = await super.render(force, options);
    
    if (isFirstRender) {
      this._onFirstRender();
    }
    
    this._onAfterRender(this.element);
    
    return result;
  }
}