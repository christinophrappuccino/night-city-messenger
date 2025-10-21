/**
 * Item Sheet Integration - DUPLICATE BUTTON FIX
 * File: scripts/integrations/ItemSheetIntegration.js
 * Module: cyberpunkred-messenger
 * Description: Adds data shard functionality to item sheets
 * 
 * FIXES:
 * 1. Single button only (no more duplicates)
 * 2. Uses global references (no dynamic imports)
 * 3. Proper hook management
 */

import { MODULE_ID } from '../utils/constants.js';

// Track if hooks are already registered (prevent double registration)
let hooksRegistered = false;

/**
 * Register item sheet hooks (call only once!)
 */
export function registerItemSheetHooks() {
  if (hooksRegistered) {
    console.warn(`${MODULE_ID} | Item sheet hooks already registered, skipping...`);
    return;
  }
  
  console.log(`${MODULE_ID} | Registering item sheet integration...`);
  
  // Hook: Get item sheet header buttons
  Hooks.on('getItemSheetHeaderButtons', (sheet, buttons) => {
    _addHeaderButtons(sheet, buttons);
  });
  
  // Hook: Render item sheet (for visual indicators only)
  Hooks.on('renderItemSheet', (sheet, html, data) => {
    _addVisualIndicators(sheet, html, data);
  });
  
  hooksRegistered = true;
  console.log(`${MODULE_ID} | ✓ Item sheet integration registered`);
}

/**
 * Add header buttons (SINGLE button approach)
 * @private
 */
function _addHeaderButtons(sheet, buttons) {
  const item = sheet.object;
  const isDataShard = item.getFlag(MODULE_ID, 'isDataShard');
  
  // PLAYER BUTTON: Only if item is already a data shard
  if (isDataShard) {
    buttons.unshift({
      label: "View Data Shard",
      class: "ncm-view-data-shard",
      icon: "fas fa-microchip",
      onclick: () => _openItemInbox(item)
    });
  }
  
  // GM BUTTON: Configure or make into data shard
  if (game.user.isGM) {
    buttons.unshift({
      label: isDataShard ? "Configure Data Shard" : "Make Data Shard",
      class: "ncm-configure-data-shard",
      icon: "fas fa-cog",
      onclick: () => _configureItemInbox(item)
    });
  }
}

/**
 * Add visual indicators to data shard items
 * @private
 */
function _addVisualIndicators(sheet, html, data) {
  const item = sheet.object;
  const isDataShard = item.getFlag(MODULE_ID, 'isDataShard');
  
  if (!isDataShard) return;
  
  // Add icon to window title
  const header = html.find('.window-title');
  if (header.length && !header.find('.ncm-data-shard-icon').length) {
    const encrypted = item.getFlag(MODULE_ID, 'encrypted');
    const isDecrypted = item.getFlag(MODULE_ID, 'decrypted');
    
    const iconClass = encrypted && !isDecrypted ? 'fa-lock' : 'fa-microchip';
    const iconColor = encrypted && !isDecrypted ? '#F65261' : '#19f3f7';
    const iconTitle = encrypted && !isDecrypted ? 'Encrypted Data Shard' : 'Data Shard';
    
    header.append(`
      <i class="fas ${iconClass} ncm-data-shard-icon" 
         style="margin-left: 8px; color: ${iconColor}; filter: drop-shadow(0 0 3px ${iconColor});" 
         title="${iconTitle}">
      </i>
    `);
  }
}

/**
 * Open item inbox viewer (uses global reference)
 * @private
 */
function _openItemInbox(item) {
  try {
    console.log(`${MODULE_ID} | Opening data shard: ${item.name}`);
    
    // Check for global reference
    if (!game.nightcity?.ItemInboxApp) {
      console.error(`${MODULE_ID} | ItemInboxApp not available in game.nightcity`);
      ui.notifications.error('Data Shard system not initialized. Please refresh.');
      return;
    }
    
    // Create and render
    const ItemInboxApp = game.nightcity.ItemInboxApp;
    const inbox = new ItemInboxApp(item);
    inbox.render(true);
    
    console.log(`${MODULE_ID} | ✓ Data shard opened`);
    
  } catch (error) {
    console.error(`${MODULE_ID} | Error opening data shard:`, error);
    ui.notifications.error(`Failed to open data shard: ${error.message}`);
  }
}

/**
 * Configure item as data shard (uses global reference)
 * @private
 */
function _configureItemInbox(item) {
  try {
    console.log(`${MODULE_ID} | Opening data shard configuration: ${item.name}`);
    
    // Check for global reference
    if (!game.nightcity?.ItemInboxConfig) {
      console.error(`${MODULE_ID} | ItemInboxConfig not available in game.nightcity`);
      ui.notifications.error('Data Shard configuration not available. Please refresh.');
      return;
    }
    
    // Create and render
    const ItemInboxConfig = game.nightcity.ItemInboxConfig;
    const config = new ItemInboxConfig(item);
    config.render(true);
    
    console.log(`${MODULE_ID} | ✓ Data shard config opened`);
    
  } catch (error) {
    console.error(`${MODULE_ID} | Error opening config:`, error);
    ui.notifications.error(`Failed to open configuration: ${error.message}`);
  }
}