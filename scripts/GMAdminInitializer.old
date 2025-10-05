/**
 * GM Admin Panel initializer
 * Registers the admin panel in the module
 */
import { MODULE_ID } from './constants.js';
import { GMMailAdmin } from './GMMailAdmin.js';

// Register the GM Admin Panel
export function initializeGMAdminPanel() {
  // Register the class globally
  game.nightcity = game.nightcity || {};
  game.nightcity.GMMailAdmin = GMMailAdmin;
  
  // Add a button to the module settings
  Hooks.on('renderSettingsConfig', (app, html, data) => {
    // Find the messaging module settings
    const moduleSettings = html.find(`h2:contains("${game.modules.get(MODULE_ID).title}")`);
    
    if (moduleSettings.length && game.user.isGM) {
      // Add a button after the heading
      const adminButton = $(`
        <div class="form-group">
          <button type="button" id="open-mail-admin" class="open-mail-admin">
            <i class="fas fa-toolbox"></i> Open Mail Admin Panel
          </button>
          <p class="notes">Open the advanced Night City Messenger administration panel for GM tools.</p>
        </div>
      `);
      
      // Insert after the heading
      moduleSettings.after(adminButton);
      
      // Add click handler
      adminButton.find('button').on('click', () => {
        const adminPanel = new GMMailAdmin();
        adminPanel.render(true);
      });
      
      // Add some inline styling
      adminButton.find('button').css({
        'background': '#F65261',
        'color': '#000000',
        'border': 'none',
        'padding': '8px 15px',
        'border-radius': '4px',
        'cursor': 'pointer',
        'font-weight': 'bold',
        'margin-bottom': '10px'
      });
    }
  });
  
  // Add Admin Panel button to the token controls
  Hooks.on('getSceneControlButtons', (controls) => {
    // Only for GMs
    if (!game.user.isGM) return;
    
    // Find the token controls group
    const tokenControls = controls.find(c => c.name === 'token');
    
    if (tokenControls) {
      // Add the admin button
      tokenControls.tools.push({
        name: 'mail-admin',
        title: 'Night City Mail Admin',
        icon: 'fas fa-toolbox',
        button: true,
        onClick: () => {
          const adminPanel = new GMMailAdmin();
          adminPanel.render(true);
        }
      });
    }
  });
}

// Add handlebars helpers for the admin panel
export function registerAdminHelpers() {
  // Calculate percentage helper
  Handlebars.registerHelper('calculatePercentage', function(value, total) {
    if (!total || total === 0) return 0;
    return Math.round((value / total) * 100);
  });
  
  // Subtract helper
  Handlebars.registerHelper('subtract', function(a, b) {
    return a - b;
  });
  
  // Get flag helper
  Handlebars.registerHelper('getFlag', function(object, module, flag) {
    if (!object || typeof object.getFlag !== 'function') return null;
    if (!module || !flag) return null;
    
    try {
      return object.getFlag(module, flag);
    } catch (error) {
      console.warn(`Error getting flag ${module}.${flag}:`, error);
      return null;
    }
  });
}