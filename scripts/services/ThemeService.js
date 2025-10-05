/**
 * Theme Service
 * File: scripts/services/ThemeService.js
 * Module: cyberpunkred-messenger
 * Description: Manages visual themes using CSS custom properties
 */

import { MODULE_ID } from '../utils/constants.js';
import { SettingsManager } from '../core/SettingsManager.js';
import { EventBus, EVENTS } from '../core/EventBus.js';

export class ThemeService {
  constructor() {
    this.settingsManager = SettingsManager.getInstance();
    this.eventBus = EventBus.getInstance();
    
    this.defaultTheme = {
      primary: '#F65261',
      secondary: '#19f3f7',
      background: '#330000',
      darkBackground: '#1a1a1a'
    };
    
    this.currentTheme = this._loadTheme();
    
    // Apply theme on construction
    this.applyTheme();
  }
  
  /**
   * Apply current theme
   */
  applyTheme() {
    // Find all module elements
    const elements = document.querySelectorAll('.ncm-app, .ncm-dialog, [data-module="cyberpunkred-messenger"]');
    
    elements.forEach(element => {
      this._applyThemeToElement(element);
    });
    
    console.log(`${MODULE_ID} | Theme applied to ${elements.length} elements`);
    
    // Emit event
    this.eventBus.emit(EVENTS.THEME_CHANGED, this.currentTheme);
  }
  
  /**
   * Apply theme to specific element
   * @param {HTMLElement} element - Element to style
   */
  _applyThemeToElement(element) {
    element.style.setProperty('--ncm-primary', this.currentTheme.primary);
    element.style.setProperty('--ncm-secondary', this.currentTheme.secondary);
    element.style.setProperty('--ncm-background', this.currentTheme.background);
    element.style.setProperty('--ncm-dark-bg', this.currentTheme.darkBackground);
  }
  
  /**
   * Update theme colors
   * @param {Object} colors - Color updates
   * @returns {Promise<void>}
   */
  async updateTheme(colors) {
    this.currentTheme = {
      ...this.currentTheme,
      ...colors
    };
    
    await this.settingsManager.set('themeColors', this.currentTheme);
    
    this.applyTheme();
  }
  
  /**
   * Reset to default theme
   * @returns {Promise<void>}
   */
  async resetTheme() {
    this.currentTheme = { ...this.defaultTheme };
    
    await this.settingsManager.set('themeColors', this.currentTheme);
    
    this.applyTheme();
  }
  
  /**
   * Get current theme
   * @returns {Object}
   */
  getTheme() {
    return { ...this.currentTheme };
  }
  
  /**
   * Get default theme
   * @returns {Object}
   */
  getDefaultTheme() {
    return { ...this.defaultTheme };
  }
  
  /**
   * Open theme settings dialog
   */
  openSettings() {
    const content = `
      <div class="ncm-theme-settings">
        <div class="form-group">
          <label>Primary Color:</label>
          <input type="color" name="primary" value="${this.currentTheme.primary}" />
        </div>
        <div class="form-group">
          <label>Secondary Color:</label>
          <input type="color" name="secondary" value="${this.currentTheme.secondary}" />
        </div>
        <div class="form-group">
          <label>Background Color:</label>
          <input type="color" name="background" value="${this.currentTheme.background}" />
        </div>
        <div class="form-group">
          <label>Dark Background:</label>
          <input type="color" name="darkBackground" value="${this.currentTheme.darkBackground}" />
        </div>
      </div>
    `;
    
    new Dialog({
      title: 'Theme Settings',
      content,
      buttons: {
        save: {
          icon: '<i class="fas fa-save"></i>',
          label: 'Save',
          callback: async (html) => {
            const colors = {
              primary: html.find('[name="primary"]').val(),
              secondary: html.find('[name="secondary"]').val(),
              background: html.find('[name="background"]').val(),
              darkBackground: html.find('[name="darkBackground"]').val()
            };
            
            await this.updateTheme(colors);
            ui.notifications.info('Theme updated');
          }
        },
        reset: {
          icon: '<i class="fas fa-undo"></i>',
          label: 'Reset',
          callback: async () => {
            await this.resetTheme();
            ui.notifications.info('Theme reset to default');
          }
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: 'Cancel'
        }
      },
      default: 'save'
    }, {
      classes: ['dialog', 'ncm-dialog']
    }).render(true);
  }
  
  /**
   * Load theme from settings
   * @private
   */
  _loadTheme() {
    try {
      const saved = this.settingsManager.get('themeColors');
      return { ...this.defaultTheme, ...saved };
    } catch (e) {
      return { ...this.defaultTheme };
    }
  }
}