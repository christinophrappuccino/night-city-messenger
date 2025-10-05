/**
 * Comprehensive Color Theme Manager
 * Final revised version with all requested fixes
 */
import { MODULE_ID } from './constants.js';

export class ColorThemeManager {
  constructor() {
    this.defaultColors = {
      primaryColor: "#F65261",
      secondaryColor: "#19f3f7", 
      backgroundColor: "#330000",
      darkBackgroundColor: "#1a1a1a"
    };
    
    this.colors = this._loadColors();
    
    // Apply theme on load
    this._applyTheme();
    
    // Register save and reset handlers
    this._registerHandlers();
    
    // Make available globally
    window.colorThemeManager = this;
    
    console.log(`${MODULE_ID} | Color Theme Manager initialized`);
  }

  /**
   * Open a dedicated settings dialog for theme customization
   */
  openSettingsDialog() {
    // Define content for settings dialog
    const content = `
      <style>
        .color-setting {
          display: flex;
          margin-bottom: 12px;
          align-items: center;
        }
        .color-setting label {
          width: 120px;
          display: inline-block;
        }
        .color-input {
          display: flex;
          align-items: center;
        }
        .color-input input[type="color"] {
          margin-right: 8px;
        }
        .color-preview {
          width: 180px;
          height: 24px;
          border: 1px solid rgba(246, 82, 97, 0.3);
        }
        /* Cyberpunk styled dialog buttons */
        .dialog .dialog-buttons button {
          background-color: ${this.colors.darkBackgroundColor} !important;
          color: ${this.colors.primaryColor} !important;
          border: 1px solid ${this.colors.primaryColor} !important;
          transition: all 0.2s;
        }
        .dialog .dialog-buttons button:hover {
          background-color: ${this.colors.primaryColor} !important;
          color: ${this.colors.darkBackgroundColor} !important;
        }
        .dialog .dialog-buttons button i {
          color: ${this.colors.primaryColor} !important;
        }
        .dialog .dialog-buttons button:hover i {
          color: ${this.colors.darkBackgroundColor} !important;
        }
      </style>
      <div class="theme-settings">
        <div class="color-setting">
          <label>Primary Color:</label>
          <div class="color-input">
            <input type="color" name="primaryColor" value="${this.colors.primaryColor}">
            <div class="color-preview" style="background-color: ${this.colors.primaryColor};"></div>
          </div>
        </div>
        <div class="color-setting">
          <label>Secondary Color:</label>
          <div class="color-input">
            <input type="color" name="secondaryColor" value="${this.colors.secondaryColor}">
            <div class="color-preview" style="background-color: ${this.colors.secondaryColor};"></div>
          </div>
        </div>
        <div class="color-setting">
          <label>Background Color:</label>
          <div class="color-input">
            <input type="color" name="backgroundColor" value="${this.colors.backgroundColor}">
            <div class="color-preview" style="background-color: ${this.colors.backgroundColor};"></div>
          </div>
        </div>
        <div class="color-setting">
          <label>Dark Background:</label>
          <div class="color-input">
            <input type="color" name="darkBackgroundColor" value="${this.colors.darkBackgroundColor}">
            <div class="color-preview" style="background-color: ${this.colors.darkBackgroundColor};"></div>
          </div>
        </div>
      </div>
    `;
    
    // Create dialog with direct handling of buttons
    new Dialog({
      title: "Night City Messenger Theme Settings",
      content: content,
      buttons: {
        save: {
          icon: '<i class="fas fa-save"></i>',
          label: "Save",
          callback: (html) => {
            const newColors = {
              primaryColor: html.find('input[name="primaryColor"]').val(),
              secondaryColor: html.find('input[name="secondaryColor"]').val(),
              backgroundColor: html.find('input[name="backgroundColor"]').val(),
              darkBackgroundColor: html.find('input[name="darkBackgroundColor"]').val()
            };
            
            this.saveColors(newColors)
              .then(success => {
                if (success) {
                  ui.notifications.info("Theme colors saved successfully!");
                }
              });
          }
        },
        reset: {
          icon: '<i class="fas fa-undo"></i>',
          label: "Reset to Default",
          callback: () => {
            this.resetColors()
              .then(success => {
                if (success) {
                  ui.notifications.info("Default colors restored!");
                }
              });
          }
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: "Cancel"
        }
      },
      render: (html) => {
        // Add live preview of color changes
        html.find('input[type="color"]').on('input', (e) => {
          const $input = $(e.currentTarget);
          const value = $input.val();
          $input.next('.color-preview').css('background-color', value);
        });
        
        // Apply styling to the dialog window
        const dialogElement = html.closest('.dialog');
        dialogElement.find('.window-content').css('background-color', this.colors.backgroundColor);
        dialogElement.find('label').css('color', this.colors.primaryColor);
      }
    }).render(true);
  }
  
  /**
   * Load saved colors from user flags
   * @returns {Object} Color settings
   * @private
   */
  _loadColors() {
    try {
      const saved = game.user.getFlag(MODULE_ID, 'colorTheme');
      return saved || {...this.defaultColors};
    } catch (e) {
      console.warn(`${MODULE_ID} | Could not load colors, using defaults:`, e);
      return {...this.defaultColors};
    }
  }
  
  /**
   * Save colors to user flags
   * @param {Object} colors - Color settings to save
   * @returns {Promise} Promise that resolves when saved
   */
  async saveColors(colors) {
    try {
      // Validate colors
      if (!colors.primaryColor || !colors.secondaryColor || 
          !colors.backgroundColor || !colors.darkBackgroundColor) {
        throw new Error("Invalid color values");
      }

      console.log(`${MODULE_ID} | Saving color theme:`, colors);
      
      // Update local colors
      this.colors = {...colors};
      
      // Save to user flags
      await game.user.setFlag(MODULE_ID, 'colorTheme', colors);
      
      // Apply the new theme
      this._applyTheme();
      
      return true;
    } catch (e) {
      console.error(`${MODULE_ID} | Error saving colors:`, e);
      ui.notifications.error("Could not save color theme: " + e.message);
      return false;
    }
  }
  
  /**
   * Reset colors to defaults
   * @returns {Promise} Promise that resolves when reset
   */
  async resetColors() {
    try {
      // Reset local colors
      this.colors = {...this.defaultColors};
      
      // Save to user flags
      await game.user.setFlag(MODULE_ID, 'colorTheme', this.defaultColors);
      
      // Apply the default theme
      this._applyTheme();
      
      return true;
    } catch (e) {
      console.error(`${MODULE_ID} | Error resetting colors:`, e);
      ui.notifications.error("Could not reset color theme");
      return false;
    }
  }
  
  /**
   * Apply the current theme - COMPREHENSIVE IMPLEMENTATION
   * @private
   */
  _applyTheme() {
    // Remove any existing style element
    $('#cyberpunk-messenger-theme').remove();
    
    // Create style element for theme
    const styleElement = $(`
      <style id="cyberpunk-messenger-theme">
        /** === GLOBAL COLOR OVERRIDES === **/
        /* Primary color overrides - ALL TEXT */
        #cyberpunk-journal .header, 
        .email-header,
        .header i,
        .control-buttons button,
        .cyber-button,
        .compose-container *, 
        .compose-container .header-title,
        .compose-container label,
        .cyberpunk-header *, 
        .filter-button,
        .compose-new-btn,
        .message-subject, 
        .email-body strong,
        .header-title, 
        .header-field label,
        .welcome-text,
        .search-controls *,
        .message-actions *,
        .sidebar-messages *,
        .action-btn *,
        .cyber-button *,
        .subject,
        .sender,
        .date,
        .page-title *,
        .dialog .window-content *,
        .compose-container .form-group label,
        .edit-email,
        .send-to,
        .remove-contact,
        .contacts-list *,
        .email-directory *,
        .journal-entry-content *,
        .message-placeholder *,
        .message-detail-container *,
        .forwarded-message *,
        .quoted-message *,
        .pagination-controls *,
        .setting-actions *,
        .settings-panel *,
        .advanced-filter-panel * {
          color: ${this.colors.primaryColor} !important;
        }

        /* Background Color Overrides - ALL BACKGROUNDS */
        #cyberpunk-journal,
        #cyberpunk-journal .header,
        .message-container,
        #cyberpunk-journal .content,
        .compose-container,
        .control-buttons button,
        .cyber-button,
        .message-body,
        .editor-container,
        .message-actions,
        .message-footer,
        .message-scroll-area,
        .empty-message-view,
        .compose-container .button-row,
        .pagination-controls,
        .dialog .window-content,
        .formatted-preview {
          background-color: ${this.colors.backgroundColor} !important;
        }


        /* Dark Background Overrides - SECONDARY BACKGROUNDS */
        #cyberpunk-journal .sidebar,
        .header-section,
        .editor,
        .ProseMirror,
        .search-input,
        .settings-panel,
        .advanced-filter-panel,
        .editor-container .editor,
        .header-field input,
        .header-field select,
        .email-suggestions,
        .sender-dropdown,
        .dialog .form-group input,
        .dialog .form-group select,
        .contacts-list .contact-entry,
        .email-directory .email-entry,
        .email-suggestion,
        .no-messages,
        .message-detail-bar,
        .message-info,
        .message-preview,
        .message-detail-container {
          background-color: ${this.colors.darkBackgroundColor} !important;
        }

        /* Border Color Overrides - ALL BORDERS */
        #cyberpunk-journal,
        #cyberpunk-journal .header,
        .message-footer, 
        #cyberpunk-journal .header-controls,
        .compose-container .cyberpunk-header,
        .header-section,
        .control-buttons button,
        .compose-container .control-buttons button:hover,
        .cyber-button,
        .editor,
        .ProseMirror,
        .search-input,
        .header-field input,
        .header-field select,
        .character-portrait,
        .action-btn,
        .filter-button,
        .compose-new-btn,
        .cyber-button,
        .page-btn,
        .button-row,
        .sender-dropdown,
        .date-range input,
        .dialog .form-group input,
        .dialog .form-group select,
        .contacts-list .contact-entry,
        .email-directory .email-entry,
        .pagination-controls,
        .page-title.selected,
        .settings-panel,
        .advanced-filter-panel,
        .email-suggestion,
        .message-detail-line,
        .forwarded-message,
        .quoted-message,
        .no-messages,
        .control-buttons button, 
        .cyber-button,
        .dialog .dialog-buttons button {
          border-color: ${this.colors.primaryColor} !important;
        }
        
        #cyberpunk-journal .page-title {
          border-bottom-color: ${this.colors.primaryColor} !important;
        }

        /* Secondary Color Overrides */
        .connectivity i,
        .connection-status i,
        .connection-status,
        .message-unread,
        .email-display-container span,
        .email-suggestion .email {
          color: ${this.colors.secondaryColor} !important;
        }
        
        .message-unread::before,
        .new-message-badge {
          background-color: ${this.colors.secondaryColor} !important;
        }
        
        /* Button Hover & Active States */
        .action-btn:hover,
        .category-btn:hover,
        .filter-button:hover,
        .compose-new-btn:hover,
        .category-btn.active,
        .cyber-button:hover,
        .action-btn.active,
        .control-buttons button:hover,
        .compose-container .control-buttons button:hover,
        .settings-panel .save-settings,
        .filter-actions .apply-filters,
        .page-btn:hover:not([disabled]),
        .dialog .dialog-buttons button:hover {
          background-color: ${this.colors.primaryColor} !important;
          color: ${this.colors.darkBackgroundColor} !important;
          border-color: ${this.colors.primaryColor} !important;
        }
        
        /* Fix all button children elements */
        .action-btn:hover *,
        .category-btn:hover *,
        .filter-button:hover *,
        .compose-new-btn:hover *,
        .category-btn.active *,
        .cyber-button:hover *,
        .action-btn.active *,
        .settings-panel .save-settings *,
        .filter-actions .apply-filters *,
        .page-btn:hover:not([disabled]) *,
        .dialog .dialog-buttons button:hover * {
          color: ${this.colors.darkBackgroundColor} !important;
        }

        /* Message List Item Hover Effect */
        #cyberpunk-journal .page-title:hover {
          background-color: rgba(${this._hexToRgb(this.colors.primaryColor)}, 0.15) !important;
        }
        
        #cyberpunk-journal .page-title.selected {
          background-color: rgba(${this._hexToRgb(this.colors.primaryColor)}, 0.2) !important;
          border-left: 3px solid ${this.colors.primaryColor} !important;
        }

        /* Special elements */
        .message-header-line,
        .message-detail-line {
          background: linear-gradient(90deg, ${this.colors.primaryColor}, ${this.colors.secondaryColor}) !important;
        }
        
        /* Message subject header */
        .message-subject {
          text-shadow: 0 0 5px ${this.colors.primaryColor} !important;
        }
        
        /* Scrollbar styling */
        .message-scroll-area::-webkit-scrollbar-track,
        .sidebar-messages::-webkit-scrollbar-track {
          background: ${this.colors.backgroundColor} !important;
        }
        
        .message-scroll-area::-webkit-scrollbar-thumb,
        .sidebar-messages::-webkit-scrollbar-thumb {
          background-color: ${this.colors.primaryColor} !important;
          border-color: ${this.colors.backgroundColor} !important;
        }

        .email-header {
          border-color: ${this.colors.primaryColor} !important;
        }
        
        /* Schedule button special styling */
        .schedule-send-btn,
        #schedule-button {
          border-color: ${this.colors.secondaryColor} !important;
          background: rgba(${this._hexToRgb(this.colors.secondaryColor)}, 0.1) !important;
          color: ${this.colors.secondaryColor} !important;
        }
        
        .schedule-send-btn:hover,
        #schedule-button:hover {
          background: rgba(${this._hexToRgb(this.colors.secondaryColor)}, 0.2) !important;
        }
        
        .schedule-send-btn *,
        #schedule-button *,
        #schedule-button i {
          color: ${this.colors.secondaryColor} !important;
        }
        
        /* Notification styling */
        .cyberpunk-message-notification {
          background-color: ${this.colors.darkBackgroundColor} !important;
          border-color: ${this.colors.primaryColor} !important;
          color: ${this.colors.primaryColor} !important;
        }

        /* Dialog content style overrides */
        .dialog .dialog-content .form-group label {
          color: ${this.colors.primaryColor} !important;
        }

        /* Content text overrides - ensure readable text */
        .email-body, 
        .message-body .journal-entry-content, 
        .message-preview, 
        .message-container .email-body, 
        .ProseMirror p, 
        .ProseMirror div,
        .editor-content {
          color: #FFFFFF !important;
        }

        /* Chat message integration styling */
        .chat-message .message-content .cyberpunk-shared-message {
          background: ${this.colors.darkBackgroundColor} !important;
          border: 1px solid ${this.colors.primaryColor} !important;
        }
        
        .chat-message .message-content .message-header-line {
          background: linear-gradient(90deg, ${this.colors.primaryColor}, ${this.colors.secondaryColor}) !important;
        }
        
        .chat-message .message-content .header-icon,
        .chat-message .message-content .header-title {
          color: ${this.colors.primaryColor} !important;
        }
        
        .chat-message .message-content .header-status {
          color: ${this.colors.secondaryColor} !important;
        }
        
        .view-message-btn {
          border: 1px solid ${this.colors.primaryColor} !important;
          color: ${this.colors.primaryColor} !important;
        }
        
        .view-message-btn:hover {
          background: ${this.colors.primaryColor} !important;
          color: ${this.colors.darkBackgroundColor} !important;
        }
        
        .view-message-btn:hover * {
          color: ${this.colors.darkBackgroundColor} !important;
        }
        
        /* ProseMirror editor menu buttons - FIXED */
        .editor menu button {
          color: ${this.colors.primaryColor} !important;
          border: 1px solid transparent !important;
          background-color: transparent !important;
        }
        
        .editor menu button:hover {
          background-color: ${this.colors.primaryColor} !important;
          color: ${this.colors.darkBackgroundColor} !important;
          border-color: ${this.colors.primaryColor} !important;
        }
        
        .editor menu button:hover i {
          color: ${this.colors.darkBackgroundColor} !important;
        }
        
        .editor menu button.active {
          background-color: ${this.colors.primaryColor} !important;
          color: ${this.colors.darkBackgroundColor} !important;
          border-color: ${this.colors.primaryColor} !important;
        }
        
        .editor menu button.active i {
          color: ${this.colors.darkBackgroundColor} !important;
        }
        
        /* Make sure editor menu has proper background */
        .editor menu {
          background-color: ${this.colors.darkBackgroundColor} !important;
          border-color: ${this.colors.primaryColor} !important;
        }
        
        /* Dialog buttons */
        .dialog .dialog-buttons button {
          background-color: ${this.colors.darkBackgroundColor} !important;
          color: ${this.colors.primaryColor} !important;
          border: 1px solid ${this.colors.primaryColor} !important;
        }
        
        .dialog .dialog-buttons button i {
          color: ${this.colors.primaryColor} !important;
        }
        
        .dialog .dialog-buttons button:hover {
          background-color: ${this.colors.primaryColor} !important;
          color: ${this.colors.darkBackgroundColor} !important;
        }
        
        .dialog .dialog-buttons button:hover i {
          color: ${this.colors.darkBackgroundColor} !important;
        }
        
        /* Schedule dialog */
        .dialog input[type="datetime-local"] {
          background-color: ${this.colors.darkBackgroundColor} !important;
          color: ${this.colors.primaryColor} !important;
          border-color: ${this.colors.primaryColor} !important;
        }
        
        .simple-calendar-selector {
          background-color: ${this.colors.darkBackgroundColor} !important;
          border-color: ${this.colors.primaryColor} !important;
        }
      </style>
    `);
    
    // Add to document
    $('head').append(styleElement);
    
    // Also apply to any open dialogs 
    this._applyThemeToDialogs();
  }
  
  /**
   * Apply theme colors to open dialogs
   * @private
   */
  _applyThemeToDialogs() {
    // Style all dialogs
    $('.dialog .window-content').css('background', this.colors.backgroundColor);
    $('.dialog .form-group label').css('color', this.colors.primaryColor);
    $('.dialog .form-group input, .dialog .form-group select').css({
      'background': this.colors.darkBackgroundColor,
      'border-color': this.colors.primaryColor,
      'color': this.colors.primaryColor
    });
    
    // Style dialog buttons
    $('.dialog .dialog-buttons button').css({
      'background-color': this.colors.darkBackgroundColor,
      'color': this.colors.primaryColor,
      'border-color': this.colors.primaryColor
    });
    
    $('.dialog .dialog-buttons button i').css('color', this.colors.primaryColor);
    
    // Fix any schedule dialog elements
    $('input[type="datetime-local"]').css({
      'background-color': this.colors.darkBackgroundColor,
      'color': this.colors.primaryColor,
      'border-color': this.colors.primaryColor
    });
    
    $('.simple-calendar-selector').css({
      'background-color': this.colors.darkBackgroundColor,
      'border-color': this.colors.primaryColor
    });
    
    // Fix any schedule button icons
    $('#schedule-button i').css('color', this.colors.secondaryColor);
    $('.schedule-send-btn i').css('color', this.colors.secondaryColor);
  }
  
  /**
   * Convert hex color to RGB components
   * @param {string} hex - Hex color code
   * @returns {string} Comma-separated RGB values
   * @private
   */
  _hexToRgb(hex) {
    // Remove # if present
    hex = hex.replace('#', '');
    
    // Parse the RGB components
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    
    return `${r}, ${g}, ${b}`;
  }
  
  /**
   * Register UI handlers for the settings panel
   * @private
   */
  _registerHandlers() {
    // IMPORTANT: Remove any existing handlers first to prevent duplicates
    $(document).off('click', '.save-settings');
    $(document).off('click', '.reset-default');
    $(document).off('input', '.settings-panel input[type="color"]');
    
    // Add event handlers with proper binding to 'this'
    $(document).on('click', '.save-settings', (event) => {
      event.preventDefault();
      
      console.log(`${MODULE_ID} | Save settings clicked`);
      
      const newColors = {
        primaryColor: $('.settings-panel input[name="primaryColor"]').val(),
        secondaryColor: $('.settings-panel input[name="secondaryColor"]').val(),
        backgroundColor: $('.settings-panel input[name="backgroundColor"]').val(),
        darkBackgroundColor: $('.settings-panel input[name="darkBackgroundColor"]').val()
      };
      
      console.log(`${MODULE_ID} | New colors:`, newColors);
      
      // Use the bound instance for saveColors
      this.saveColors(newColors)
        .then(success => {
          if (success) {
            ui.notifications.info("Color theme saved successfully!");
            $('.settings-panel').removeClass('active');
          }
        })
        .catch(error => {
          console.error(`${MODULE_ID} | Error saving colors:`, error);
          ui.notifications.error("Failed to save color theme");
        });
    });
    
    $(document).on('click', '.reset-default', (event) => {
      event.preventDefault();
      
      console.log(`${MODULE_ID} | Reset default clicked`);
      
      // Update the color inputs in the UI
      $('.settings-panel input[name="primaryColor"]').val(this.defaultColors.primaryColor);
      $('.settings-panel input[name="secondaryColor"]').val(this.defaultColors.secondaryColor);
      $('.settings-panel input[name="backgroundColor"]').val(this.defaultColors.backgroundColor);
      $('.settings-panel input[name="darkBackgroundColor"]').val(this.defaultColors.darkBackgroundColor);
      
      // Update the color previews
      $('.settings-panel .color-preview').each((i, el) => {
        const $el = $(el);
        const colorName = $el.prev('input').attr('name');
        $el.css('background-color', this.defaultColors[colorName]);
      });
      
      // Use the bound instance for resetColors
      this.resetColors()
        .then(success => {
          if (success) {
            ui.notifications.info("Default colors restored!");
          }
        })
        .catch(error => {
          console.error(`${MODULE_ID} | Error resetting colors:`, error);
          ui.notifications.error("Failed to reset color theme");
        });
    });
    
    // Update preview on color change
    $(document).on('input', '.settings-panel input[type="color"]', (e) => {
      const $input = $(e.currentTarget);
      const value = $input.val();
      $input.next('.color-preview').css('background-color', value);
    });
  }
  
  /**
   * Debug method to check theme status
   * Useful for troubleshooting theme issues
   */
  debugTheme() {
    console.log("=== Theme Manager Debug ===");
    console.log("Current colors:", this.colors);
    console.log("Default colors:", this.defaultColors);
    console.log("Theme element exists:", $('#cyberpunk-messenger-theme').length > 0);
    console.log("Global reference:", window.colorThemeManager === this);
    console.log("=== End Debug ===");
    
    return {
      currentColors: {...this.colors},
      defaultColors: {...this.defaultColors},
      globalReference: window.colorThemeManager === this,
      themeElementExists: $('#cyberpunk-messenger-theme').length > 0
    };
  }
}

// Initialize the color theme manager when Foundry is ready
Hooks.once('ready', () => {
  // Create the singleton instance
  const manager = new ColorThemeManager();
  
  // Make sure it's globally available
  if (!window.colorThemeManager) {
    window.colorThemeManager = manager;
  }
});

// Export the class
export default ColorThemeManager;