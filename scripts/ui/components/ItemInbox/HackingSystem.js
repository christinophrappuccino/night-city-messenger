/**
 * Hacking System
 * File: scripts/ui/components/ItemInbox/HackingSystem.js
 * Module: cyberpunkred-messenger
 * Description: Handles hacking attempts for encrypted data shards
 */

import { MODULE_ID } from '../../../utils/constants.js';

export class HackingSystem {
  constructor(parent) {
    this.parent = parent;
    this.item = parent.item;
  }
  
  /**
   * Attempt to hack the data shard
   * @param {Actor} actor - Actor attempting the hack
   * @param {number} dc - Difficulty class
   * @returns {Promise<Object>} Result object
   */
  async attemptHack(actor, dc) {
    console.log(`${MODULE_ID} | Hack attempt - Actor: ${actor.name}, DC: ${dc}`);
    
    // Get actor's relevant skill
    const skillValue = this._getHackingSkill(actor);
    
    // Roll
    const roll = await new Roll('1d10').evaluate();
    const total = roll.total + skillValue;
    
    console.log(`${MODULE_ID} | Roll: ${roll.total} + ${skillValue} = ${total}`);
    
    // Check success
    const success = total >= dc;
    
    // Check for BLACK ICE
    const encryptionType = this.item.getFlag(MODULE_ID, 'encryptionType') || 'ICE';
    let blackICE = false;
    let damage = 0;
    
    if (!success && (encryptionType === 'BLACK_ICE' || encryptionType === 'RED_ICE')) {
      blackICE = true;
      damage = await this._rollBlackICEDamage(encryptionType);
      
      // Apply damage to actor
      await this._applyDamage(actor, damage);
    }
    
    return {
      success,
      roll,
      total,
      dc,
      skillValue,
      blackICE,
      damage
    };
  }
  
  /**
   * Get actor's hacking skill value
   * @private
   */
  _getHackingSkill(actor) {
    // For Cyberpunk RED system
    if (game.system.id === 'cyberpunk-red-core') {
      // Try to get Interface skill
      const skills = actor.system?.skills || {};
      
      if (skills.interface) {
        return skills.interface.value || 0;
      }
      
      // Fallback to INT stat
      const stats = actor.system?.stats || {};
      if (stats.int) {
        return stats.int.value || 0;
      }
    }
    
    // Generic fallback
    return 0;
  }
  
  /**
   * Roll BLACK ICE damage
   * @private
   */
  async _rollBlackICEDamage(type) {
    let diceFormula = '3d6';
    
    if (type === 'RED_ICE') {
      diceFormula = '5d6';
    }
    
    const damageRoll = await new Roll(diceFormula).evaluate();
    
    // Show dice roll
    await damageRoll.toMessage({
      flavor: `<strong>BLACK ICE DAMAGE</strong>`,
      speaker: ChatMessage.getSpeaker()
    });
    
    return damageRoll.total;
  }
  
  /**
   * Apply damage to actor
   * @private
   */
  async _applyDamage(actor, damage) {
    console.log(`${MODULE_ID} | Applying ${damage} BLACK ICE damage to ${actor.name}`);
    
    // For Cyberpunk RED system
    if (game.system.id === 'cyberpunk-red-core') {
      const currentHP = actor.system?.derivedStats?.hp?.value || 0;
      const newHP = Math.max(0, currentHP - damage);
      
      await actor.update({
        'system.derivedStats.hp.value': newHP
      });
      
      // Create damage chat message
      await ChatMessage.create({
        content: `
          <div class="ncm-black-ice-damage">
            <h3 style="color: #ff0000;">⚡ BLACK ICE TRIGGERED</h3>
            <p><strong>${actor.name}</strong> takes <strong>${damage}</strong> damage!</p>
            <p>HP: ${currentHP} → ${newHP}</p>
          </div>
        `,
        speaker: ChatMessage.getSpeaker({ actor })
      });
    } else {
      // Generic system - just notify
      ui.notifications.error(`${actor.name} would take ${damage} BLACK ICE damage!`);
    }
  }
  
  /**
   * Show hacking dialog
   * @param {Actor} actor - Actor attempting hack
   * @param {number} dc - Difficulty class
   * @returns {Promise<boolean>} Whether to proceed
   */
  async showHackingDialog(actor, dc) {
    const skillValue = this._getHackingSkill(actor);
    const encryptionType = this.item.getFlag(MODULE_ID, 'encryptionType') || 'ICE';
    const hasBlackICE = encryptionType === 'BLACK_ICE' || encryptionType === 'RED_ICE';
    
    const content = `
      <div class="ncm-hacking-dialog">
        <p><strong>Target:</strong> ${this.item.name}</p>
        <p><strong>Encryption DC:</strong> ${dc}</p>
        <p><strong>Your Skill:</strong> ${skillValue}</p>
        <p><strong>Roll:</strong> 1d10 + ${skillValue}</p>
        
        ${hasBlackICE ? `
          <div style="background: #330000; border: 2px solid #ff0000; padding: 10px; margin-top: 10px; border-radius: 4px;">
            <p style="color: #ff0000; font-weight: bold;">
              <i class="fas fa-exclamation-triangle"></i> WARNING: BLACK ICE DETECTED
            </p>
            <p style="color: #ffffff;">
              Failure will trigger defensive countermeasures and cause damage!
            </p>
          </div>
        ` : ''}
        
        <p style="margin-top: 15px;">Attempt to hack this data shard?</p>
      </div>
    `;
    
    return await Dialog.confirm({
      title: 'Hack Data Shard',
      content,
      yes: () => true,
      no: () => false,
      defaultYes: true
    });
  }
  
  /**
   * Cleanup
   */
  destroy() {
    // Cleanup if needed
  }
}