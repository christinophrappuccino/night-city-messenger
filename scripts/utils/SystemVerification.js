/**
 * System Verification
 * File: scripts/utils/SystemVerification.js
 * Module: cyberpunkred-messenger
 * Description: Verify system health on startup
 */

import { MODULE_ID } from './constants.js';
import { EventBus } from '../core/EventBus.js';
import { StateManager } from '../core/StateManager.js';
import { SocketManager } from '../core/SocketManager.js';
import { SettingsManager } from '../core/SettingsManager.js';

export class SystemVerification {
  /**
   * Run system verification
   */
  static async run() {
    console.log(`${MODULE_ID} | Running system verification...`);
    
    const checks = [];
    
    // Check 1: Core systems
    checks.push(this._checkCoreSystems());
    
    // Check 2: Settings
    checks.push(this._checkSettings());
    
    // Check 3: Services
    checks.push(this._checkServices());
    
    // Check 4: UI components
    checks.push(this._checkUIComponents());
    
    // Check 5: Integrations
    checks.push(this._checkIntegrations());
    
    // Report results
    const passed = checks.filter(c => c.passed).length;
    const total = checks.length;
    
    if (passed === total) {
      console.log(`${MODULE_ID} | ✓ All ${total} verification checks passed`);
    } else {
      console.warn(`${MODULE_ID} | ⚠️ ${passed}/${total} verification checks passed`);
      
      checks.forEach(check => {
        if (!check.passed) {
          console.warn(`${MODULE_ID} | ✗ ${check.name}: ${check.message}`);
        }
      });
    }
  }
  
  /**
   * Check core systems
   * @private
   */
  static _checkCoreSystems() {
    try {
      const eventBus = EventBus.getInstance();
      const stateManager = StateManager.getInstance();
      const socketManager = SocketManager.getInstance();
      const settingsManager = SettingsManager.getInstance();
      
      const passed = eventBus && stateManager && socketManager && settingsManager;
      
      return {
        name: 'Core Systems',
        passed,
        message: passed ? 'All core systems initialized' : 'Some core systems missing'
      };
    } catch (error) {
      return {
        name: 'Core Systems',
        passed: false,
        message: error.message
      };
    }
  }
  
  /**
   * Check settings
   * @private
   */
  static _checkSettings() {
    try {
      const settingsManager = SettingsManager.getInstance();
      const enableSounds = settingsManager.get('enableSounds');
      
      return {
        name: 'Settings',
        passed: enableSounds !== undefined,
        message: 'Settings accessible'
      };
    } catch (error) {
      return {
        name: 'Settings',
        passed: false,
        message: error.message
      };
    }
  }
  
  /**
   * Check services
   * @private
   */
  static _checkServices() {
    try {
      const schedulingService = game.nightcity?.schedulingService;
      
      return {
        name: 'Services',
        passed: !!schedulingService,
        message: schedulingService ? 'Services initialized' : 'Some services missing'
      };
    } catch (error) {
      return {
        name: 'Services',
        passed: false,
        message: error.message
      };
    }
  }
  
  /**
   * Check UI components
   * @private
   */
  static _checkUIComponents() {
    try {
      const hasAPI = game.nightcity && 
                     typeof game.nightcity.openInbox === 'function';
      
      return {
        name: 'UI Components',
        passed: hasAPI,
        message: hasAPI ? 'UI API available' : 'UI API not found'
      };
    } catch (error) {
      return {
        name: 'UI Components',
        passed: false,
        message: error.message
      };
    }
  }
  
  /**
   * Check integrations
   * @private
   */
  static _checkIntegrations() {
    try {
      const simpleCalendar = game.modules.get('foundryvtt-simple-calendar')?.active;
      
      return {
        name: 'Integrations',
        passed: true,
        message: simpleCalendar 
          ? 'SimpleCalendar integration available' 
          : 'Running without SimpleCalendar'
      };
    } catch (error) {
      return {
        name: 'Integrations',
        passed: false,
        message: error.message
      };
    }
  }
}