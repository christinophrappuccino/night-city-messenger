/**
 * Cyberpunk Chat Helper
 * File: scripts/ui/helpers/CyberpunkChatHelper.js
 * Module: cyberpunkred-messenger
 * Description: Create beautifully styled cyberpunk-themed chat messages
 */

import { MODULE_ID } from '../../utils/constants.js';

export class CyberpunkChatHelper {
  
  /**
   * Create a styled decryption roll chat message
   * @param {Object} data - Roll data
   * @param {Actor} actor - The actor
   * @param {Roll} roll - The Foundry roll object
   */
  static async createDecryptionRollMessage(data, actor, roll) {
    const { success, total, diceRoll, skillValue, statValue, statName, luck, dc, skillName } = data;
    
    const content = `
      <div class="ncm-cyberpunk-roll">
        <div class="ncm-cyber-header">
          <i class="fas fa-microchip ncm-cyber-icon"></i>
          <div class="ncm-cyber-title">DATA SHARD DECRYPTION</div>
          <div class="ncm-cyber-subtitle">${actor.name}</div>
        </div>
        
        <div class="ncm-roll-details">
          <div class="ncm-roll-target">
            <span class="ncm-target-label">TARGET:</span>
            <span class="ncm-target-value">DV ${dc}</span>
          </div>
          
          <div class="ncm-roll-formula">
            <div class="ncm-formula-component ncm-dice">
              <i class="fas fa-dice-d10"></i> ${diceRoll}
            </div>
            <div class="ncm-formula-component">
              <span class="ncm-comp-label">${statName}</span>
              <span class="ncm-comp-value">${statValue}</span>
            </div>
            <div class="ncm-formula-component">
              <span class="ncm-comp-label">${skillName}</span>
              <span class="ncm-comp-value">${skillValue}</span>
            </div>
            ${luck > 0 ? `
            <div class="ncm-formula-component ncm-luck">
              <span class="ncm-comp-label">LUCK</span>
              <span class="ncm-comp-value">${luck}</span>
            </div>
            ` : ''}
            <div class="ncm-formula-equals">=</div>
            <div class="ncm-formula-total">${total}</div>
          </div>
          
          <div class="ncm-roll-result ${success ? 'ncm-success' : 'ncm-failure'}">
            ${success ? 
              '<i class="fas fa-check-circle"></i> DECRYPTION SUCCESSFUL' : 
              '<i class="fas fa-times-circle"></i> DECRYPTION FAILED'}
          </div>
        </div>
      </div>
    `;
    
    await ChatMessage.create({
      content,
      speaker: ChatMessage.getSpeaker({ actor }),
      type: CONST.CHAT_MESSAGE_TYPES.ROLL,
      roll
    });
    
    // Show 3D dice if available
    if (game.dice3d) {
      await game.dice3d.showForRoll(roll);
    }
  }
  
  /**
   * Create a styled network breach chat message
   * @param {Object} data - Breach data
   */
  static async createNetworkBreachMessage(data, actor, roll) {
    const { success, total, diceRoll, skillValue, statValue, statName, luck, dc, skillName, targetName } = data;
    
    const content = `
      <div class="ncm-cyberpunk-roll">
        <div class="ncm-cyber-header ${success ? 'ncm-success-bg' : 'ncm-failure-bg'}">
          <i class="fas fa-user-secret ncm-cyber-icon ncm-pulse"></i>
          <div class="ncm-cyber-title">${success ? 'BREACH SUCCESSFUL' : 'BREACH FAILED'}</div>
          <div class="ncm-cyber-subtitle">${actor.name}</div>
        </div>
        
        <div class="ncm-roll-details">
          <div class="ncm-roll-target">
            <span class="ncm-target-label">TARGET:</span>
            <span class="ncm-target-value">${targetName}</span>
          </div>
          
          <div class="ncm-breach-method">
            <span class="ncm-method-label">METHOD:</span>
            <span class="ncm-method-value">${skillName}</span>
          </div>
          
          <div class="ncm-roll-formula">
            <div class="ncm-formula-component ncm-dice">
              <i class="fas fa-dice-d10"></i> ${diceRoll}
            </div>
            <div class="ncm-formula-component">
              <span class="ncm-comp-label">${statName}</span>
              <span class="ncm-comp-value">${statValue}</span>
            </div>
            <div class="ncm-formula-component">
              <span class="ncm-comp-label">${skillName}</span>
              <span class="ncm-comp-value">${skillValue}</span>
            </div>
            ${luck > 0 ? `
            <div class="ncm-formula-component ncm-luck">
              <span class="ncm-comp-label">LUCK</span>
              <span class="ncm-comp-value">${luck}</span>
            </div>
            ` : ''}
            <div class="ncm-formula-equals">=</div>
            <div class="ncm-formula-total">${total}</div>
          </div>
          
          <div class="ncm-roll-result ${success ? 'ncm-success' : 'ncm-failure'}">
            ${success 
              ? '<i class="fas fa-check-circle"></i> AUTHENTICATION BYPASSED' 
              : '<i class="fas fa-times-circle"></i> SECURITY HELD FIRM'}
          </div>
          
          <div class="ncm-roll-margin">
            ${success 
              ? `<span class="ncm-success-text">Margin of Success: +${total - dc}</span>` 
              : `<span class="ncm-failure-text">Missed by: ${dc - total}</span>`}
          </div>
        </div>
      </div>
    `;
    
    await ChatMessage.create({
      content,
      speaker: ChatMessage.getSpeaker({ actor }),
      rolls: [roll],
      type: CONST.CHAT_MESSAGE_TYPES.ROLL,
      sound: success ? CONFIG.sounds.dice : CONFIG.sounds.lock,
      flags: {
        'cyberpunkred-messenger': {
          type: 'network-breach',
          success,
          targetName
        }
      }
    });
  }
  
  /**
   * Create a styled login attempt message
   * @param {Object} data - Login data
   */
  static async createLoginMessage(data) {
    const { success, actor, attempts, maxAttempts, shardName } = data;
    
    const content = `
      <div class="ncm-cyberpunk-message">
        <div class="ncm-cyber-header ${success ? 'ncm-success-bg' : 'ncm-failure-bg'}">
          <i class="fas fa-user-lock ncm-cyber-icon"></i>
          <div class="ncm-cyber-title">AUTHENTICATION ${success ? 'SUCCESSFUL' : 'FAILED'}</div>
          <div class="ncm-cyber-subtitle">${actor?.name || 'Unknown User'}</div>
        </div>
        
        <div class="ncm-message-body">
          <div class="ncm-message-detail">
            <span class="ncm-label">Target:</span>
            <span class="ncm-value">${shardName}</span>
          </div>
          <div class="ncm-message-detail">
            <span class="ncm-label">Attempts:</span>
            <span class="ncm-value ${attempts >= maxAttempts ? 'ncm-text-error' : ''}">${attempts}/${maxAttempts}</span>
          </div>
          
          ${success ? `
          <div class="ncm-success-box">
            <i class="fas fa-check-circle"></i>
            Access granted to ${shardName}
          </div>
          ` : `
          <div class="ncm-failure-box">
            <i class="fas fa-times-circle"></i>
            Invalid credentials
            ${attempts >= maxAttempts ? '<br><strong>ACCOUNT LOCKED</strong>' : ''}
          </div>
          `}
        </div>
      </div>
    `;
    
    await ChatMessage.create({
      content,
      speaker: ChatMessage.getSpeaker({ actor }),
      type: CONST.CHAT_MESSAGE_TYPES.OOC
    });
  }
  
  /**
   * Create BLACK ICE damage message
   * @param {Object} data - Damage data
   */
  static async createBlackICEMessage(data) {
    const { actor, damage, hp, maxHP, shardName } = data;
    
    const content = `
      <div class="ncm-cyberpunk-message ncm-danger">
        <div class="ncm-cyber-header ncm-danger-bg">
          <i class="fas fa-skull-crossbones ncm-cyber-icon ncm-pulse"></i>
          <div class="ncm-cyber-title">BLACK ICE TRIGGERED</div>
          <div class="ncm-cyber-subtitle">${actor.name}</div>
        </div>
        
        <div class="ncm-message-body">
          <div class="ncm-ice-warning">
            <i class="fas fa-exclamation-triangle"></i>
            LETHAL COUNTERMEASURES ACTIVATED
          </div>
          
          <div class="ncm-damage-display">
            <div class="ncm-damage-value">${damage}</div>
            <div class="ncm-damage-label">DAMAGE</div>
          </div>
          
          <div class="ncm-hp-bar">
            <div class="ncm-hp-label">HP: ${hp}/${maxHP}</div>
            <div class="ncm-hp-bar-container">
              <div class="ncm-hp-bar-fill" style="width: ${(hp/maxHP)*100}%"></div>
            </div>
          </div>
          
          <div class="ncm-message-detail">
            <span class="ncm-label">Source:</span>
            <span class="ncm-value ncm-text-error">${shardName}</span>
          </div>
        </div>
      </div>
    `;
    
    await ChatMessage.create({
      content,
      speaker: ChatMessage.getSpeaker({ actor }),
      type: CONST.CHAT_MESSAGE_TYPES.IC
    });
  }
}