/**
 * User Settings Panel
 * File: scripts/ui/components/Settings/UserSettingsPanel.js
 * Module: cyberpunkred-messenger
 * Description: User preferences and customization
 */

import { MODULE_ID } from '../../../utils/constants.js';
import { BaseApplication } from '../BaseApplication.js';

export class UserSettingsPanel extends BaseApplication {
  constructor(options = {}) {
    super(options);
    
    this.activeTab = 'general';
  }
  
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["ncm-app", "ncm-settings-panel"],
      template: `modules/${MODULE_ID}/templates/settings/user-settings.hbs`,
      width: 700,
      height: 600,
      resizable: true,
      title: "Messenger Settings",
      tabs: [
        {
          navSelector: ".ncm-settings__tabs",
          contentSelector: ".ncm-settings__content",
          initial: "general"
        }
      ]
    });
  }
  
  async getData(options = {}) {
    const data = super.getData(options);
    
    // Get current settings
    const actor = game.user.character;
    const userSettings = await this._loadUserSettings();
    
    return {
      ...data,
      actor,
      email: actor?.getFlag(MODULE_ID, 'emailAddress') || '',
      hasCharacter: !!actor,
      characterName: actor?.name || 'No character assigned',
      settings: userSettings,
      tabs: [
        { id: 'general', label: 'General', icon: 'fa-cog' },
        { id: 'appearance', label: 'Appearance', icon: 'fa-palette' },
        { id: 'notifications', label: 'Notifications', icon: 'fa-bell' },
        { id: 'advanced', label: 'Advanced', icon: 'fa-sliders-h' }
      ]
    };
  }
  
  /**
   * Load user settings from flags
   */
  async _loadUserSettings() {
    const defaults = {
      // General
      email: '',
      messagesPerPage: 20,
      autoRefresh: true,
      refreshInterval: 30,
      
      // Appearance
      theme: 'cyberpunk-red',
      primaryColor: '#F65261',
      secondaryColor: '#19f3f7',
      backgroundColor: '#1a1a1a',
      fontFamily: 'Rajdhani',
      fontSize: 'medium',
      showAnimations: true,
      compactMode: false,
      
      // Notifications
      soundEnabled: true,
      soundVolume: 50,
      desktopNotifications: false,
      notifyOnNewMessage: true,
      notifyOnScheduledSend: true,
      
      // Advanced
      debugMode: false,
      cacheMessages: true,
      autoMarkRead: true,
      confirmDelete: true,
      showNetworkStatus: true,
      showTimestamps: true
    };
    
    const saved = await game.user.getFlag(MODULE_ID, 'userSettings') || {};
    return { ...defaults, ...saved };
  }
  
  /**
   * Save user settings
   */
  async _saveUserSettings(settings) {
    await game.user.setFlag(MODULE_ID, 'userSettings', settings);
    
    // Apply theme immediately
    this._applyTheme(settings);
    
    // Emit event for other components to update
    Hooks.callAll('ncm:settingsChanged', settings);
  }
  
  /**
   * Apply theme changes to document
   */
  _applyTheme(settings) {
    const root = document.documentElement;
    
    root.style.setProperty('--ncm-primary', settings.primaryColor);
    root.style.setProperty('--ncm-secondary', settings.secondaryColor);
    root.style.setProperty('--ncm-background', settings.backgroundColor);
    root.style.setProperty('--ncm-font-family', settings.fontFamily);
    
    // Font size
    const fontSizes = {
      small: '14px',
      medium: '16px',
      large: '18px'
    };
    root.style.setProperty('--ncm-font-size-base', fontSizes[settings.fontSize] || '16px');
    
    // Animations
    if (!settings.showAnimations) {
      document.body.classList.add('ncm-no-animations');
    } else {
      document.body.classList.remove('ncm-no-animations');
    }
    
    // Compact mode
    if (settings.compactMode) {
      document.body.classList.add('ncm-compact-mode');
    } else {
      document.body.classList.remove('ncm-compact-mode');
    }
  }
  
  activateListeners(html) {
    super.activateListeners(html);
    
    // Email setup
    html.find('[data-action="change-email"]').on('click', this._onChangeEmail.bind(this));
    
    // Color pickers
    html.find('[name="primaryColor"]').on('change', this._onColorChange.bind(this));
    html.find('[name="secondaryColor"]').on('change', this._onColorChange.bind(this));
    html.find('[name="backgroundColor"]').on('change', this._onColorChange.bind(this));
    
    // Theme presets
    html.find('[data-action="apply-theme"]').on('click', this._onApplyTheme.bind(this));
    
    // Reset to defaults
    html.find('[data-action="reset-theme"]').on('click', this._onResetTheme.bind(this));
    
    // Save settings
    html.find('[data-action="save-settings"]').on('click', this._onSaveSettings.bind(this));
    
    // Preview theme
    html.find('[data-action="preview-theme"]').on('click', this._onPreviewTheme.bind(this));
    
    // Test notification
    html.find('[data-action="test-notification"]').on('click', this._onTestNotification.bind(this));
    
    // Test sound
    html.find('[data-action="test-sound"]').on('click', this._onTestSound.bind(this));
    
    // Clear cache
    html.find('[data-action="clear-cache"]').on('click', this._onClearCache.bind(this));
  }
  
  /**
   * Change email handler
   */
  async _onChangeEmail(event) {
    event.preventDefault();
    
    const { PlayerEmailSetup } = await import('../../dialogs/PlayerEmailSetup.js');
    const success = await PlayerEmailSetup.show();
    
    if (success) {
      this.render(false);
    }
  }
  
  /**
   * Color change handler - live preview
   */
  _onColorChange(event) {
    const input = event.currentTarget;
    const color = input.value;
    const property = input.name;
    
    document.documentElement.style.setProperty(`--ncm-${property.replace('Color', '')}`, color);
  }
  
  /**
   * Apply theme preset
   */
  async _onApplyTheme(event) {
    event.preventDefault();
    
    const theme = $(event.currentTarget).data('theme');
    const presets = this._getThemePresets();
    
    if (!presets[theme]) return;
    
    const settings = await this._loadUserSettings();
    Object.assign(settings, presets[theme]);
    
    this._applyTheme(settings);
    this.render(false);
  }
  
  /**
   * Reset theme to defaults
   */
  async _onResetTheme(event) {
    event.preventDefault();
    
    const confirm = await Dialog.confirm({
      title: "Reset Theme",
      content: "<p>Reset all appearance settings to defaults?</p>"
    });
    
    if (confirm) {
      const defaults = {
        theme: 'cyberpunk-red',
        primaryColor: '#F65261',
        secondaryColor: '#19f3f7',
        backgroundColor: '#1a1a1a',
        fontFamily: 'Rajdhani',
        fontSize: 'medium',
        showAnimations: true,
        compactMode: false
      };
      
      const settings = await this._loadUserSettings();
      Object.assign(settings, defaults);
      
      await this._saveUserSettings(settings);
      this.render(false);
      ui.notifications.info('Theme reset to defaults');
    }
  }
  
  /**
   * Save all settings
   */
  async _onSaveSettings(event) {
    event.preventDefault();
    
    const form = this.element.find('form')[0];
    const formData = new FormData(form);
    
    const settings = await this._loadUserSettings();
    
    // Update settings from form
    for (const [key, value] of formData.entries()) {
      if (value === 'on') {
        settings[key] = true;
      } else if (value === 'off') {
        settings[key] = false;
      } else if (!isNaN(value) && value !== '') {
        settings[key] = Number(value);
      } else {
        settings[key] = value;
      }
    }
    
    await this._saveUserSettings(settings);
    
    ui.notifications.info('Settings saved!');
    this.close();
  }
  
  /**
   * Preview theme
   */
  _onPreviewTheme(event) {
    event.preventDefault();
    
    const form = this.element.find('form')[0];
    const formData = new FormData(form);
    
    const preview = {
      primaryColor: formData.get('primaryColor'),
      secondaryColor: formData.get('secondaryColor'),
      backgroundColor: formData.get('backgroundColor'),
      fontFamily: formData.get('fontFamily'),
      fontSize: formData.get('fontSize'),
      showAnimations: formData.get('showAnimations') === 'on',
      compactMode: formData.get('compactMode') === 'on'
    };
    
    this._applyTheme(preview);
  }
  
  /**
   * Test notification
   */
  _onTestNotification(event) {
    event.preventDefault();
    
    ui.notifications.info('This is a test notification!');
    
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Night City Messenger', {
        body: 'You have a new message!',
        icon: 'modules/cyberpunkred-messenger/assets/icon.png'
      });
    }
  }
  
  /**
   * Test sound
   */
  async _onTestSound(event) {
    event.preventDefault();
    
    const volume = this.element.find('[name="soundVolume"]').val() / 100;
    
    try {
      const audio = new Audio('modules/cyberpunkred-messenger/assets/sounds/notification.mp3');
      audio.volume = volume;
      await audio.play();
    } catch (error) {
      console.error('Could not play test sound:', error);
      ui.notifications.warn('Sound test failed. Check console.');
    }
  }
  
  /**
   * Clear cache
   */
  async _onClearCache(event) {
    event.preventDefault();
    
    const confirm = await Dialog.confirm({
      title: "Clear Cache",
      content: "<p>Clear all cached message data?</p>"
    });
    
    if (confirm) {
      // Clear cached data
      await game.user.unsetFlag(MODULE_ID, 'cachedMessages');
      
      ui.notifications.info('Cache cleared!');
    }
  }
  
  /**
   * Get theme presets
   */
  _getThemePresets() {
    return {
      'cyberpunk-red': {
        primaryColor: '#F65261',
        secondaryColor: '#19f3f7',
        backgroundColor: '#1a1a1a',
        fontFamily: 'Rajdhani'
      },
      'neon-blue': {
        primaryColor: '#00d4ff',
        secondaryColor: '#ff006e',
        backgroundColor: '#0a0a1a',
        fontFamily: 'Orbitron'
      },
      'corpo-gold': {
        primaryColor: '#ffd700',
        secondaryColor: '#4a90e2',
        backgroundColor: '#1a1a24',
        fontFamily: 'Rajdhani'
      },
      'dark-minimal': {
        primaryColor: '#ffffff',
        secondaryColor: '#888888',
        backgroundColor: '#0d0d0d',
        fontFamily: 'system-ui'
      },
      'nomad-green': {
        primaryColor: '#00ff41',
        secondaryColor: '#ff9800',
        backgroundColor: '#1a2a1a',
        fontFamily: 'Courier New'
      }
    };
  }
}