/**
 * Template Manager
 * File: scripts/ui/helpers/TemplateManager.js
 * Module: cyberpunkred-messenger
 * Description: Preload and manage Handlebars templates
 */

import { MODULE_ID } from '../../utils/constants.js';

export class TemplateManager {
  /**
   * Preload all templates
   */
  static async preloadTemplates() {
    console.log(`${MODULE_ID} | Preloading templates...`);
    
    const templates = [
      // Message Viewer
      `modules/${MODULE_ID}/templates/message-viewer/viewer.hbs`,
      `modules/${MODULE_ID}/templates/message-viewer/partials/message-list.hbs`,
      `modules/${MODULE_ID}/templates/message-viewer/partials/message-item.hbs`,
      `modules/${MODULE_ID}/templates/message-viewer/partials/message-detail.hbs`,
      `modules/${MODULE_ID}/templates/message-viewer/partials/filters-panel.hbs`,
      `modules/${MODULE_ID}/templates/message-viewer/partials/network-status-indicator.hbs`,
      
      // Message Composer
      `modules/${MODULE_ID}/templates/message-composer/composer.hbs`,
      `modules/${MODULE_ID}/templates/message-composer/partials/recipient-field.hbs`,
      `modules/${MODULE_ID}/templates/message-composer/partials/editor.hbs`,
      `modules/${MODULE_ID}/templates/message-composer/partials/scheduling-panel.hbs`,
      
      // Contact Manager
      `modules/${MODULE_ID}/templates/contact-manager/contact-manager.hbs`,
      
      // GM Contact Manager (GM-only)
      `modules/${MODULE_ID}/templates/gm-contact-manager/gm-contact-manager.hbs`,
      
      // Admin Panel
      `modules/${MODULE_ID}/templates/admin-panel/admin-panel.hbs`,
      `modules/${MODULE_ID}/templates/admin-panel/partials/statistics.hbs`,
      `modules/${MODULE_ID}/templates/admin-panel/partials/user-management.hbs`,
      `modules/${MODULE_ID}/templates/admin-panel/partials/system-tools.hbs`,

      // Network Selector Templates
      `modules/${MODULE_ID}/templates/network-selector/network-selector.hbs`,
      `modules/${MODULE_ID}/templates/network-selector/partials/network-item.hbs`,
      `modules/${MODULE_ID}/templates/dialogs/network-auth.hbs`,

      // Item Inbox
      `modules/${MODULE_ID}/templates/item-inbox/item-inbox.hbs`,
      `modules/${MODULE_ID}/templates/item-inbox/item-config.hbs`,
      `modules/${MODULE_ID}/templates/item-inbox/message-shared.hbs`,
      `modules/${MODULE_ID}/templates/item-inbox/message-composer.hbs`,
      `modules/${MODULE_ID}/templates/item-inbox/hack-result.hbs`,
      
      // Shared
      `modules/${MODULE_ID}/templates/shared/message-shared.hbs`,
      `modules/${MODULE_ID}/templates/shared/notification.hbs`
    ];
    
    try {
      await loadTemplates(templates);
      console.log(`${MODULE_ID} | ✓ ${templates.length} templates preloaded`);
    } catch (error) {
      console.error(`${MODULE_ID} | ❌ Error preloading templates:`, error);
    }
  }
}