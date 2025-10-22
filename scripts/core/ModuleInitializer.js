/**
 * Module Initializer
 * File: scripts/core/ModuleInitializer.js
 * Module: cyberpunkred-messenger
 * Description: Orchestrates module initialization with proper dependency order
 */

import { MODULE_ID } from '../utils/constants.js';
import { EventBus } from './EventBus.js';
import { StateManager } from './StateManager.js';
import { SocketManager } from './SocketManager.js';
import { SettingsManager } from './SettingsManager.js';

export class ModuleInitializer {
  constructor() {
    this.phases = {
      preInit: [],
      init: [],
      ready: [],
      postReady: []
    };
    
    this.initialized = false;
    this.ready = false;
  }
  
  /**
   * Register a function to run during a specific phase
   * @param {string} phase - Phase name (preInit, init, ready, postReady)
   * @param {Function} fn - Function to run
   * @param {number} priority - Priority (lower runs first)
   */
  register(phase, fn, priority = 100) {
    if (!this.phases[phase]) {
      throw new Error(`Invalid phase: ${phase}`);
    }
    
    this.phases[phase].push({ fn, priority });
    this.phases[phase].sort((a, b) => a.priority - b.priority);
  }
  
  /**
   * Run pre-initialization (Foundry's init hook)
   */
  async runPreInit() {
    console.log(`${MODULE_ID} | ========================================`);
    console.log(`${MODULE_ID} | PRE-INIT PHASE`);
    console.log(`${MODULE_ID} | ========================================`);
    
    try {
      // Initialize core systems
      console.log(`${MODULE_ID} | Initializing core systems...`);
      
      // Event Bus (first, everything depends on it)
      const eventBus = EventBus.getInstance();
      console.log(`${MODULE_ID} | ✓ Event Bus initialized`);
      
      // State Manager
      const stateManager = StateManager.getInstance();
      console.log(`${MODULE_ID} | ✓ State Manager initialized`);
      
      // NEW: Ensure game.nightcity exists, then expose instances
      game.nightcity = game.nightcity || {};  // ← THIS IS CRITICAL!
      game.nightcity.eventBus = eventBus;
      game.nightcity.stateManager = stateManager;
      console.log(`${MODULE_ID} | ✓ Core instances exposed on game.nightcity`);
      
      // NEW: Initialize default network state
      stateManager.set('currentNetwork', 'CITINET', true);
      stateManager.set('signalStrength', 95, true);
      console.log(`${MODULE_ID} | ✓ Network state initialized (CITINET, 95%)`);
      
      // Settings Manager
      const settings = SettingsManager.getInstance();
      settings.register();
      console.log(`${MODULE_ID} | ✓ Settings registered`);
      
      // Run registered pre-init functions
      await this._runPhase('preInit');
      
      console.log(`${MODULE_ID} | ✓ Pre-initialization complete`);
    } catch (error) {
      console.error(`${MODULE_ID} | ❌ Pre-initialization failed:`, error);
      throw error;
    }
  }
  
  /**
   * Run initialization (Foundry's init hook, after preInit)
   */
  async runInit() {
    console.log(`${MODULE_ID} | ========================================`);
    console.log(`${MODULE_ID} | INIT PHASE`);
    console.log(`${MODULE_ID} | ========================================`);
    
    try {
      // Run registered init functions
      await this._runPhase('init');
      
      this.initialized = true;
      console.log(`${MODULE_ID} | ✓ Initialization complete`);
    } catch (error) {
      console.error(`${MODULE_ID} | ❌ Initialization failed:`, error);
      throw error;
    }
  }
  
  /**
   * Run ready phase (Foundry's ready hook)
   */
  async runReady() {
    console.log(`${MODULE_ID} | ========================================`);
    console.log(`${MODULE_ID} | READY PHASE`);
    console.log(`${MODULE_ID} | ========================================`);
    
    try {
      // Initialize socket communication
      const socketManager = SocketManager.getInstance();
      socketManager.initialize();
      console.log(`${MODULE_ID} | ✓ Socket Manager initialized`);
      
      // Run registered ready functions
      await this._runPhase('ready');
      
      this.ready = true;
      console.log(`${MODULE_ID} | ✓ Ready phase complete`);
      
      // Run post-ready functions (after a short delay)
      setTimeout(() => this.runPostReady(), 100);
    } catch (error) {
      console.error(`${MODULE_ID} | ❌ Ready phase failed:`, error);
      throw error;
    }
  }
  
  /**
   * Run post-ready phase (final setup)
   */
  async runPostReady() {
    console.log(`${MODULE_ID} | ========================================`);
    console.log(`${MODULE_ID} | POST-READY PHASE`);
    console.log(`${MODULE_ID} | ========================================`);
    
    try {
      await this._runPhase('postReady');
      
      console.log(`${MODULE_ID} | ========================================`);
      console.log(`${MODULE_ID} | ✅ MODULE FULLY INITIALIZED`);
      console.log(`${MODULE_ID} | ========================================`);
    } catch (error) {
      console.error(`${MODULE_ID} | ❌ Post-ready phase failed:`, error);
    }
  }
  
  /**
   * Run all functions in a phase
   * @private
   */
  async _runPhase(phase) {
    const functions = this.phases[phase];
    
    if (functions.length === 0) {
      console.log(`${MODULE_ID} | No functions registered for ${phase} phase`);
      return;
    }
    
    console.log(`${MODULE_ID} | Running ${functions.length} ${phase} functions...`);
    
    for (const { fn, priority } of functions) {
      try {
        await fn();
      } catch (error) {
        console.error(`${MODULE_ID} | Error in ${phase} function (priority ${priority}):`, error);
      }
    }
  }
  
  /**
   * Check if module is initialized
   * @returns {boolean}
   */
  isInitialized() {
    return this.initialized;
  }
  
  /**
   * Check if module is ready
   * @returns {boolean}
   */
  isReady() {
    return this.ready;
  }
}

// Create singleton instance
export const moduleInitializer = new ModuleInitializer();