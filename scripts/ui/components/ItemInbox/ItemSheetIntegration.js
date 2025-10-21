/**
 * Item Sheet Integration - COMPLETE FIX
 * File: scripts/integrations/ItemSheetIntegration.js
 * 
 * FIXES:
 * 1. Remove duplicate buttons (only keep one "View Data Shard" button)
 * 2. Use global reference instead of dynamic import
 * 3. Better error handling
 * 4. Clean permissions (GM only for configure)
 */

import { MODULE_ID } from '../utils/constants.js';

/**
 * Register item sheet hooks
 */
export function registerItemSheetHooks() {
  console.log(`${MODULE_ID} | Registering item sheet integration...`);
  
  // Hook: Render item sheet - add banner
  Hooks.on('renderItemSheet', (sheet, html, data) => {
    _addDataShardBanner(sheet, html, data);
  });
  
  // Hook: Get item sheet header buttons - SINGLE BUTTON ONLY
  Hooks.on('getItemSheetHeaderButtons', (sheet, buttons) => {
    _addSingleHeaderButton(sheet, buttons);
  });
  
  console.log(`${MODULE_ID} | ✓ Item sheet integration registered`);
}

/**
 * Add SINGLE header button - no duplicates
 * @private
 */
function _addSingleHeaderButton(sheet, buttons) {
  const item = sheet.object;
  const isDataShard = item.getFlag(MODULE_ID, 'isDataShard');
  
  if (isDataShard) {
    // SINGLE button for data shards
    buttons.unshift({
      label: "View Data Shard",
      class: "ncm-view-data-shard",
      icon: "fas fa-microchip",
      onclick: () => _openItemInbox(item)
    });
  }
  
  // GM configure button
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
 * Add visual banner to data shard items
 * @private
 */
function _addDataShardBanner(sheet, html, data) {
  const item = sheet.object;
  
  // Only add banner to data shards
  const isDataShard = item.getFlag(MODULE_ID, 'isDataShard');
  if (!isDataShard) return;
  
  // Add visual indicator to window title
  const header = html.find('.window-title');
  if (header.length) {
    const encrypted = item.getFlag(MODULE_ID, 'encrypted');
    const isDecrypted = item.getFlag(MODULE_ID, 'decrypted');
    
    const iconClass = encrypted && !isDecrypted ? 'fa-lock' : 'fa-microchip';
    const iconColor = encrypted && !isDecrypted ? '#F65261' : '#19f3f7';
    const iconTitle = encrypted && !isDecrypted ? 'Encrypted Data Shard' : 'Data Shard';
    
    header.append(`<i class="fas ${iconClass}" style="margin-left: 8px; color: ${iconColor};" title="${iconTitle}"></i>`);
  }
  
  // Add info banner to sheet body
  const sheetBody = html.find('.sheet-body, .item-sheet');
  if (sheetBody.length > 0) {
    const encrypted = item.getFlag(MODULE_ID, 'encrypted');
    const isDecrypted = item.getFlag(MODULE_ID, 'decrypted');
    const encryptionType = item.getFlag(MODULE_ID, 'encryptionType') || 'ICE';
    const encryptionDC = item.getFlag(MODULE_ID, 'encryptionDC') || 15;
    
    let bannerContent = '';
    
    if (encrypted && !isDecrypted) {
      // Encrypted banner
      bannerContent = `
        <div class="ncm-data-shard-banner ncm-encrypted" style="
          margin: 10px 0;
          padding: 15px;
          background: linear-gradient(135deg, rgba(51, 0, 0, 0.9), rgba(26, 26, 26, 0.9));
          border: 2px solid #F65261;
          border-radius: 4px;
          text-align: center;
          box-shadow: 0 0 20px rgba(246, 82, 97, 0.3);
        ">
          <div style="font-size: 2em; margin-bottom: 10px;">
            <i class="fas fa-lock" style="color: #F65261;"></i>
          </div>
          <div style="font-size: 1.2em; font-weight: bold; color: #F65261; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 2px;">
            ENCRYPTED DATA SHARD
          </div>
          <div style="color: #ffffff; margin-bottom: 10px;">
            <strong>Security:</strong> ${encryptionType} • <strong>Difficulty:</strong> DV ${encryptionDC}
          </div>
          <button class="ncm-open-data-shard-btn" style="
            padding: 10px 20px;
            background: #F65261;
            color: #1a1a1a;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-weight: bold;
            font-size: 1em;
            transition: all 0.3s;
          " data-item-id="${item.id}">
            <i class="fas fa-terminal"></i> Access Data Shard
          </button>
        </div>
      `;
    } else {
      // Decrypted/Open banner
      bannerContent = `
        <div class="ncm-data-shard-banner ncm-decrypted" style="
          margin: 10px 0;
          padding: 15px;
          background: linear-gradient(135deg, rgba(0, 51, 51, 0.9), rgba(26, 26, 26, 0.9));
          border: 2px solid #19f3f7;
          border-radius: 4px;
          text-align: center;
          box-shadow: 0 0 20px rgba(25, 243, 247, 0.3);
        ">
          <div style="font-size: 2em; margin-bottom: 10px;">
            <i class="fas fa-microchip" style="color: #19f3f7;"></i>
          </div>
          <div style="font-size: 1.2em; font-weight: bold; color: #19f3f7; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 2px;">
            DATA SHARD ${encrypted ? '• DECRYPTED' : '• OPEN ACCESS'}
          </div>
          <button class="ncm-open-data-shard-btn" style="
            padding: 10px 20px;
            background: #19f3f7;
            color: #1a1a1a;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-weight: bold;
            font-size: 1em;
            transition: all 0.3s;
          " data-item-id="${item.id}">
            <i class="fas fa-inbox"></i> View Messages
          </button>
        </div>
      `;
    }
    
    const $banner = $(bannerContent);
    
    // Add hover effect
    $banner.find('.ncm-open-data-shard-btn').hover(
      function() { $(this).css('transform', 'scale(1.05)'); },
      function() { $(this).css('transform', 'scale(1)'); }
    );
    
    // CRITICAL: Use global reference instead of dynamic import
    $banner.find('.ncm-open-data-shard-btn').on('click', function() {
      const itemId = $(this).data('item-id');
      const item = game.items.get(itemId);
      if (item) {
        _openItemInbox(item);
      }
    });
    
    sheetBody.prepend($banner);
  }
}

/**
 * Open item inbox viewer - FIXED to use global reference
 * @private
 */
function _openItemInbox(item) {
  try {
    console.log(`${MODULE_ID} | Opening data shard inbox: ${item.name}`);
    
    // CRITICAL FIX: Use global reference instead of dynamic import
    if (!game.nightcity?.ItemInboxApp) {
      console.error(`${MODULE_ID} | ItemInboxApp not available in game.nightcity`);
      ui.notifications.error('Data Shard system not initialized. Please refresh and try again.');
      return;
    }
    
    // Create and render the app using global reference
    const ItemInboxApp = game.nightcity.ItemInboxApp;
    const inbox = new ItemInboxApp(item);
    inbox.render(true);
    
    console.log(`${MODULE_ID} | ✓ Data shard opened successfully`);
    
  } catch (error) {
    console.error(`${MODULE_ID} | Error opening item inbox:`, error);
    ui.notifications.error(`Failed to open data shard: ${error.message}`);
  }
}

/**
 * Configure item as data shard - FIXED to use global reference
 * @private
 */
function _configureItemInbox(item) {
  try {
    console.log(`${MODULE_ID} | Opening data shard configuration for: ${item.name}`);
    
    // CRITICAL FIX: Use global reference instead of dynamic import
    if (!game.nightcity?.ItemInboxConfig) {
      console.error(`${MODULE_ID} | ItemInboxConfig not available in game.nightcity`);
      ui.notifications.error('Data Shard configuration not available. Please refresh and try again.');
      return;
    }
    
    // Create and render the config using global reference
    const ItemInboxConfig = game.nightcity.ItemInboxConfig;
    const config = new ItemInboxConfig(item);
    config.render(true);
    
    console.log(`${MODULE_ID} | ✓ Data shard config opened successfully`);
    
  } catch (error) {
    console.error(`${MODULE_ID} | Error opening inbox config:`, error);
    ui.notifications.error(`Failed to open data shard configuration: ${error.message}`);
  }
}