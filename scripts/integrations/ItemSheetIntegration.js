/**
 * Item Sheet Integration
 * File: scripts/integrations/ItemSheetIntegration.js
 * Module: cyberpunkred-messenger
 * Description: Add inbox functionality to item sheets
 */

import { MODULE_ID } from '../utils/constants.js';

/**
 * Register item sheet hooks
 */
export function registerItemSheetHooks() {
  console.log(`${MODULE_ID} | Registering item sheet integration...`);
  
  // Hook: Render item sheet
  Hooks.on('renderItemSheet', (sheet, html, data) => {
    _addInboxButton(sheet, html, data);
  });
  
  // Hook: Get item sheet header buttons
  Hooks.on('getItemSheetHeaderButtons', (sheet, buttons) => {
    _addHeaderButtons(sheet, buttons);
  });
  
  console.log(`${MODULE_ID} | ✓ Item sheet integration registered`);
}

/**
 * Add inbox button to item sheet
 * @private
 */
function _addInboxButton(sheet, html, data) {
  const item = sheet.object;
  
  // Check if this item is configured as a data shard
  const isDataShard = item.getFlag(MODULE_ID, 'isDataShard');
  
  if (!isDataShard) return;
  
  // Add visual indicator that this is a data shard
  const header = html.find('.window-title');
  header.append(`<i class="fas fa-envelope" style="margin-left: 8px; color: var(--ncm-primary);" title="Data Shard"></i>`);
  
  // Add inbox button to sheet
  const sheetContent = html.find('.sheet-body, .item-sheet');
  
  if (sheetContent.length > 0) {
    const inboxBtn = $(`
      <div class="ncm-item-inbox-button" style="margin: 10px 0; padding: 10px; background: var(--ncm-bg-secondary); border: 2px solid var(--ncm-primary); border-radius: 4px; cursor: pointer; text-align: center;">
        <i class="fas fa-inbox"></i> <strong>Open Data Shard Inbox</strong>
      </div>
    `);
    
    inboxBtn.on('click', () => _openItemInbox(item));
    
    sheetContent.prepend(inboxBtn);
  }
}

/**
 * Add header buttons
 * @private
 */
function _addHeaderButtons(sheet, buttons) {
  const item = sheet.object;
  const isDataShard = item.getFlag(MODULE_ID, 'isDataShard');
  
  // Add "Open Inbox" button if this is a data shard
  if (isDataShard) {
    buttons.unshift({
      label: "Open Inbox",
      class: "ncm-open-inbox",
      icon: "fas fa-inbox",
      onclick: () => _openItemInbox(item)
    });
  }
  
  // Add "Configure as Data Shard" button for GMs
  if (game.user.isGM) {
    buttons.unshift({
      label: isDataShard ? "Configure Inbox" : "Make Data Shard",
      class: "ncm-configure-inbox",
      icon: "fas fa-cog",
      onclick: () => _configureItemInbox(item)
    });
  }
}

/**
 * Open item inbox viewer
 * @private
 */
async function _openItemInbox(item) {
  try {
    // Check if encrypted
    const encrypted = item.getFlag(MODULE_ID, 'encrypted');
    const hasAccess = item.getFlag(MODULE_ID, 'hasAccess') || false;
    
    // If encrypted and no access, show lock screen
    if (encrypted && !hasAccess && !game.user.isGM) {
      ui.notifications.warn('This data shard is encrypted. You need to hack it first.');
      
      // Offer to attempt hack
      new Dialog({
        title: 'Encrypted Data Shard',
        content: `
          <p>This data shard is encrypted and requires hacking to access.</p>
          <p><strong>Encryption Type:</strong> ${item.getFlag(MODULE_ID, 'encryptionType') || 'ICE'}</p>
          <p><strong>Difficulty:</strong> DV ${item.getFlag(MODULE_ID, 'encryptionDC') || 15}</p>
        `,
        buttons: {
          hack: {
            icon: '<i class="fas fa-terminal"></i>',
            label: 'Attempt Hack',
            callback: () => _attemptHack(item)
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: 'Cancel'
          }
        },
        default: 'cancel'
      }).render(true);
      
      return;
    }
    
    // Import and open the inbox viewer
    const { ItemInboxApp } = await import('../ui/components/ItemInbox/ItemInboxApp.js');
    const inbox = new ItemInboxApp(item);
    inbox.render(true);
    
  } catch (error) {
    console.error(`${MODULE_ID} | Error opening item inbox:`, error);
    ui.notifications.error('Failed to open inbox');
  }
}

/**
 * Configure item as inbox
 * @private
 */
async function _configureItemInbox(item) {
  try {
    const { ItemInboxConfig } = await import('../ui/components/ItemInbox/ItemInboxConfig.js');
    const config = new ItemInboxConfig(item);
    config.render(true);
  } catch (error) {
    console.error(`${MODULE_ID} | Error opening inbox config:`, error);
    ui.notifications.error('Failed to open configuration');
  }
}

/**
 * Attempt to hack the item
 * @private
 */
async function _attemptHack(item) {
  // Get the actor doing the hacking
  const actor = game.user.character;
  
  if (!actor) {
    ui.notifications.error('You need a character to attempt hacking');
    return;
  }
  
  // Get encryption details
  const encryptionDC = item.getFlag(MODULE_ID, 'encryptionDC') || 15;
  const encryptionType = item.getFlag(MODULE_ID, 'encryptionType') || 'ICE';
  const skillToUse = item.getFlag(MODULE_ID, 'hackingSkill') || 'Interface';
  
  // Request roll from user
  const content = `
    <p>Attempting to hack <strong>${item.name}</strong></p>
    <p><strong>Target DV:</strong> ${encryptionDC}</p>
    <p><strong>Skill:</strong> ${skillToUse}</p>
    <div class="form-group">
      <label>Roll Result:</label>
      <input type="number" id="roll-result" placeholder="Enter your roll result" />
    </div>
  `;
  
  new Dialog({
    title: 'Hack Attempt',
    content: content,
    buttons: {
      submit: {
        icon: '<i class="fas fa-dice-d20"></i>',
        label: 'Submit Roll',
        callback: async (html) => {
          const rollResult = parseInt(html.find('#roll-result').val());
          
          if (isNaN(rollResult)) {
            ui.notifications.error('Please enter a valid roll result');
            return;
          }
          
          const success = rollResult >= encryptionDC;
          
          if (success) {
            // Grant access
            await item.setFlag(MODULE_ID, 'hasAccess', true);
            ui.notifications.info(`Successfully hacked ${item.name}!`);
            
            // Create chat message
            const { createHackResultChatCard } = await import('./ChatIntegration.js');
            await createHackResultChatCard({
              actor: actor,
              target: item,
              success: true,
              roll: { total: rollResult }
            });
            
            // Open the inbox
            _openItemInbox(item);
            
          } else {
            ui.notifications.error(`Failed to hack ${item.name}`);
            
            // Handle failure consequences
            await _handleHackFailure(item, actor, encryptionType);
            
            // Create chat message
            const { createHackResultChatCard } = await import('./ChatIntegration.js');
            await createHackResultChatCard({
              actor: actor,
              target: item,
              success: false,
              roll: { total: rollResult }
            });
          }
        }
      },
      cancel: {
        icon: '<i class="fas fa-times"></i>',
        label: 'Cancel'
      }
    },
    default: 'submit'
  }).render(true);
}

/**
 * Handle hack failure consequences
 * @private
 */
async function _handleHackFailure(item, actor, encryptionType) {
  const failureOutcome = item.getFlag(MODULE_ID, 'failureOutcome') || 'locked';
  
  switch (failureOutcome) {
    case 'blackice':
      // BLACK ICE damage
      if (encryptionType === 'BLACK_ICE' || encryptionType === 'RED_ICE') {
        const damageRoll = await new Roll(encryptionType === 'RED_ICE' ? '8d6' : '5d6').evaluate();
        
        ui.notifications.error(`BLACK ICE activated! ${damageRoll.total} damage!`);
        
        // Apply damage to actor if possible
        if (actor.system?.hp?.value !== undefined) {
          const newHP = Math.max(0, actor.system.hp.value - damageRoll.total);
          await actor.update({ 'system.hp.value': newHP });
          
          ChatMessage.create({
            content: `<p><strong>${actor.name}</strong> triggered BLACK ICE and took <strong>${damageRoll.total}</strong> damage!</p>`,
            speaker: ChatMessage.getSpeaker({ actor })
          });
        }
      }
      break;
      
    case 'corrupted':
      // Delete messages
      ui.notifications.warn('Data corrupted! Messages may be lost.');
      break;
      
    case 'traced':
      // NetWatch notification
      ui.notifications.warn('Your intrusion attempt has been detected!');
      ChatMessage.create({
        content: `<p><strong>NETWATCH ALERT:</strong> Unauthorized access attempt detected from ${actor.name}</p>`,
        whisper: game.users.filter(u => u.isGM).map(u => u.id)
      });
      break;
      
    case 'disabled':
      // Temporarily disable the item
      ui.notifications.warn('The data shard has been temporarily disabled.');
      await item.setFlag(MODULE_ID, 'disabled', true);
      await item.setFlag(MODULE_ID, 'disabledUntil', Date.now() + (30 * 60 * 1000)); // 30 minutes
      break;
      
    default:
      // Just stays locked
      ui.notifications.info('The encryption holds. The data shard remains locked.');
  }
}