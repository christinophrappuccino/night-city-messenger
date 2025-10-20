/**
 * Skill Service
 * File: scripts/services/SkillService.js
 * Module: cyberpunkred-messenger
 * Description: Handles skill checks for Cyberpunk RED actors with flexible skill support
 */

import { MODULE_ID } from '../utils/constants.js';

export class SkillService {
  constructor() {
    this.systemId = game.system.id;
    this.isCyberpunkRED = this.systemId === 'cyberpunk-red-core';
    
    console.log(`${MODULE_ID} | SkillService initialized`);
    console.log(`${MODULE_ID} | System: ${this.systemId}`);
    console.log(`${MODULE_ID} | Cyberpunk RED: ${this.isCyberpunkRED ? 'Yes' : 'No'}`);
    
    if (this.isCyberpunkRED) {
      console.log(`${MODULE_ID} | Using item-based skill detection`);
    }
  }
  
  /**
   * Get all available skills for an actor
   * @param {Actor} actor - The actor to query
   * @returns {Array} Array of skill objects {name, value, stat, displayName}
   */
  getAvailableSkills(actor) {
    if (!actor) {
      console.warn(`${MODULE_ID} | No actor provided to getAvailableSkills`);
      return [];
    }
    
    if (this.isCyberpunkRED) {
      return this._getCPRSkills(actor);
    }
    
    // Generic fallback - try to find skills from items
    return this._getGenericSkills(actor);
  }
  
  /**
   * Get skills from Cyberpunk RED actor
   * In CPR, skills are ITEMS not properties!
   * ALSO checks for role abilities like Interface (Netrunner)
   * @private
   */
  _getCPRSkills(actor) {
    const skills = [];
    const stats = actor.system?.stats || {};
    
    // Get all skill items from the actor
    const skillItems = actor.items.filter(item => item.type === 'skill');
    
    console.log(`${MODULE_ID} | Found ${skillItems.length} skill items on ${actor.name}`);
    
    // Skill to stat mapping for Cyberpunk RED
    const skillStatMap = {
      'interface': 'tech', // Netrunners use TECH for Interface
      'electronics/security tech': 'tech',
      'basic tech': 'tech',
      'cybertech': 'tech',
      'first aid': 'tech',
      'forgery': 'tech',
      'pick lock': 'tech',
      'pick pocket': 'tech',
      'cryptography': 'int',
      'deduction': 'int',
      'education': 'int',
      'library search': 'int',
      'local expert': 'int',
      'science': 'int',
      'tactics': 'int',
      'wilderness survival': 'int',
      'accounting': 'int',
      'animal handling': 'will',
      'athletics': 'dex',
      'autofire': 'ref',
      'brawling': 'dex',
      'bribery': 'cool',
      'bureaucracy': 'int',
      'business': 'int',
      'composition': 'int',
      'concentration': 'will',
      'conceal/reveal object': 'int',
      'contortionist': 'dex',
      'conversation': 'emp',
      'criminology': 'int',
      'demolitions': 'tech',
      'drive land vehicle': 'ref',
      'electronics/security tech': 'tech',
      'endurance': 'will',
      'evasion': 'dex',
      'gamble': 'int',
      'handgun': 'ref',
      'heavy weapons': 'ref',
      'human perception': 'emp',
      'interrogation': 'cool',
      'language': 'int',
      'melee weapon': 'dex',
      'motorbike': 'ref',
      'perception': 'int',
      'persuasion': 'cool',
      'pilot': 'ref',
      'play instrument': 'tech',
      'resist torture/drugs': 'will',
      'shoulder arms': 'ref',
      'stealth': 'dex',
      'streetwise': 'cool',
      'trading': 'cool',
      'tracking': 'int',
      'wardrobe & style': 'cool',
      'weaponstech': 'tech'
    };
    
    // Check for Netrunner role and add Interface
    const netrunnerRole = actor.items.find(i => 
      i.type === 'role' && i.name.toLowerCase().includes('netrunner')
    );
    
    if (netrunnerRole) {
      const roleRank = netrunnerRole.system?.rank || 0;
      const techStat = stats.tech?.value || 0;
      const interfaceValue = roleRank + techStat;
      
      console.log(`${MODULE_ID} | Found Netrunner role - adding Interface skill (Rank ${roleRank} + TECH ${techStat} = ${interfaceValue})`);
      
      skills.push({
        key: 'interface',
        name: 'Interface',
        displayName: 'Interface',
        value: interfaceValue,
        skillLevel: roleRank,
        statValue: techStat,
        stat: 'TECH',
        hasSkill: roleRank > 0,
        itemId: netrunnerRole.id,
        isRoleAbility: true
      });
    }
    
    // Process each skill item
    for (const skillItem of skillItems) {
      const skillName = skillItem.name;
      const skillLevel = skillItem.system?.level || 0;
      
      // Determine which stat this skill uses
      const normalizedName = skillName.toLowerCase().trim();
      const statKey = skillStatMap[normalizedName] || 'int';
      
      const statValue = stats[statKey]?.value || 0;
      const totalValue = skillLevel + statValue;
      
      skills.push({
        key: skillItem.id,
        name: skillName,
        displayName: skillName,
        value: totalValue,
        skillLevel: skillLevel,
        statValue: statValue,
        stat: statKey.toUpperCase(),
        hasSkill: skillLevel > 0,
        itemId: skillItem.id,
        isRoleAbility: false
      });
    }
    
    // Sort by value (highest first), then by name
    skills.sort((a, b) => {
      if (b.value !== a.value) return b.value - a.value;
      return a.displayName.localeCompare(b.displayName);
    });
    
    return skills;
  }
  
  /**
   * Get skills from generic system (from items)
   * @private
   */
  _getGenericSkills(actor) {
    const skills = [];
    const skillItems = actor.items.filter(i => i.type === 'skill');
    
    for (const skill of skillItems) {
      skills.push({
        key: skill.id,
        name: skill.name,
        displayName: skill.name,
        value: skill.system?.value || 0,
        skillLevel: skill.system?.level || 0,
        statValue: 0,
        stat: 'GENERIC',
        hasSkill: true
      });
    }
    
    return skills;
  }
  
  /**
   * Get specific skill data for an actor
   * @param {Actor} actor - The actor
   * @param {string} skillName - Name or key of the skill
   * @returns {Object|null} Skill data or null
   */
  getSkill(actor, skillName) {
    if (!actor || !skillName) return null;
    
    const skills = this.getAvailableSkills(actor);
    const normalizedSearch = skillName.toLowerCase().replace(/[^a-z0-9]/g, '');
    
    // Try exact match first
    let skill = skills.find(s => s.name.toLowerCase() === skillName.toLowerCase());
    if (skill) return skill;
    
    // Try display name match
    skill = skills.find(s => s.displayName.toLowerCase() === skillName.toLowerCase());
    if (skill) return skill;
    
    // Try normalized exact match (removes spaces, slashes, etc)
    skill = skills.find(s => {
      const skillNormalized = s.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const displayNormalized = s.displayName.toLowerCase().replace(/[^a-z0-9]/g, '');
      return skillNormalized === normalizedSearch || displayNormalized === normalizedSearch;
    });
    
    if (skill) return skill;
    
    // Try normalized partial match (handles "ElectronicsSecurity" finding "Electronics/Security Tech")
    skill = skills.find(s => {
      const skillNormalized = s.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const displayNormalized = s.displayName.toLowerCase().replace(/[^a-z0-9]/g, '');
      
      // Check if search is contained in skill name OR skill name starts with search
      return skillNormalized.includes(normalizedSearch) || 
             displayNormalized.includes(normalizedSearch) ||
             skillNormalized.startsWith(normalizedSearch) ||
             displayNormalized.startsWith(normalizedSearch);
    });
    
    if (skill) return skill;
    
    // Try partial match with original strings (for things like "Electronics" matching "Electronics/Security Tech")
    skill = skills.find(s => {
      const name = s.name.toLowerCase();
      const display = s.displayName.toLowerCase();
      const search = skillName.toLowerCase();
      return name.includes(search) || display.includes(search);
    });
    
    return skill || null;
  }
  
  /**
   * Perform a skill check
   * @param {Object} options - Check options
   * @param {Actor} options.actor - Actor performing check
   * @param {string|Array<string>} options.skills - Skill name(s) to use (tries in order)
   * @param {number} options.dc - Difficulty Class
   * @param {string} options.taskName - Name of the task (for chat)
   * @param {boolean} options.allowLuck - Allow Luck points (default true)
   * @param {boolean} options.autoRoll - Roll immediately vs show dialog (default false)
   * @returns {Promise<Object>} Result object
   */
  async performCheck(options = {}) {
    const {
      actor,
      skills: skillNames,
      dc = 15,
      taskName = 'Skill Check',
      allowLuck = true,
      autoRoll = false
    } = options;
    
    if (!actor) {
      throw new Error(`${MODULE_ID} | No actor provided for skill check`);
    }
    
    // Normalize to array
    const skillList = Array.isArray(skillNames) ? skillNames : [skillNames];
    
    // Find the best available skill
    const availableSkills = [];
    for (const skillName of skillList) {
      const skill = this.getSkill(actor, skillName);
      if (skill) {
        availableSkills.push(skill);
      }
    }
    
    if (availableSkills.length === 0) {
      ui.notifications.warn(`${actor.name} does not have any of the required skills: ${skillList.join(', ')}`);
      return {
        success: false,
        cancelled: true,
        message: 'No required skills available'
      };
    }
    
    // Use the highest skill
    const selectedSkill = availableSkills[0];
    
    // Show dialog or auto-roll
    if (!autoRoll) {
      const proceed = await this._showCheckDialog(actor, selectedSkill, dc, taskName, allowLuck);
      if (!proceed) {
        return { success: false, cancelled: true };
      }
    }
    
    // Handle Luck if allowed
    let luckUsed = 0;
    if (allowLuck && this.isCyberpunkRED) {
      const luckStat = actor.system?.stats?.luck?.value || 0;
      if (luckStat > 0) {
        luckUsed = await this._promptForLuck(actor, luckStat);
        
        if (luckUsed > 0) {
          await actor.update({
            'system.stats.luck.value': luckStat - luckUsed
          });
        }
      }
    }
    
    // Roll the dice!
    const roll = new Roll('1d10');
    await roll.evaluate();
    
    const diceResult = roll.total;
    const total = diceResult + selectedSkill.value + luckUsed;
    const success = total >= dc;
    
    // Create result object
    const result = {
      success,
      roll: diceResult,
      skillValue: selectedSkill.value,
      skillLevel: selectedSkill.skillLevel,
      statValue: selectedSkill.statValue,
      stat: selectedSkill.stat,
      luckUsed,
      total,
      dc,
      margin: total - dc,
      skill: selectedSkill,
      rollObject: roll
    };
    
    // Create chat message
    await this._createCheckChatMessage(actor, result, taskName);
    
    return result;
  }
  
  /**
   * Show dialog before check
   * @private
   */
  async _showCheckDialog(actor, skill, dc, taskName, allowLuck) {
    const luckStat = this.isCyberpunkRED ? (actor.system?.stats?.luck?.value || 0) : 0;
    
    const content = `
      <div class="ncm-skill-check-dialog">
        <div class="ncm-check-info">
          <p><strong>Task:</strong> ${taskName}</p>
          <p><strong>Actor:</strong> ${actor.name}</p>
          <p><strong>Skill:</strong> ${skill.displayName}</p>
          <p><strong>Total Bonus:</strong> +${skill.value} (${skill.stat} ${skill.statValue} + Skill ${skill.skillLevel})</p>
          <p><strong>Target DC:</strong> ${dc}</p>
          <p><strong>Roll:</strong> 1d10 + ${skill.value}</p>
        </div>
        
        ${allowLuck && luckStat > 0 ? `
          <div class="ncm-luck-info">
            <p><i class="fas fa-clover"></i> You have <strong>${luckStat}</strong> Luck points available</p>
            <p class="ncm-help-text">You'll be prompted to use Luck after rolling</p>
          </div>
        ` : ''}
        
        <p class="ncm-check-prompt">Attempt this check?</p>
      </div>
    `;
    
    return await Dialog.confirm({
      title: taskName,
      content,
      yes: () => true,
      no: () => false,
      defaultYes: true
    });
  }
  
  /**
   * Prompt for Luck usage
   * @private
   */
  async _promptForLuck(actor, maxLuck) {
    return new Promise(resolve => {
      const d = new Dialog({
        title: 'Use Luck Points?',
        content: `
          <div class="ncm-luck-dialog">
            <p>You have <strong>${maxLuck}</strong> Luck points available.</p>
            <p>How many would you like to use on this roll?</p>
            
            <div class="form-group">
              <label>Luck Points to Use:</label>
              <div style="display: flex; align-items: center; gap: 10px;">
                <input type="range" id="luck-slider" min="0" max="${maxLuck}" value="0" 
                       style="flex: 1;" oninput="document.getElementById('luck-value').innerText = this.value" />
                <span id="luck-value" style="font-weight: bold; min-width: 30px;">0</span>
              </div>
            </div>
            
            <p class="ncm-help-text">Each point adds +1 to your roll</p>
          </div>
        `,
        buttons: {
          use: {
            icon: '<i class="fas fa-clover"></i>',
            label: 'Use Luck',
            callback: html => {
              const luck = parseInt(html.find('#luck-slider').val());
              resolve(luck);
            }
          },
          skip: {
            icon: '<i class="fas fa-times"></i>',
            label: 'Skip',
            callback: () => resolve(0)
          }
        },
        default: 'use'
      });
      
      d.render(true);
    });
  }
  
  /**
   * Create chat message for check
   * @private
   */
  async _createCheckChatMessage(actor, result, taskName) {
    const { success, roll, skillValue, skillLevel, statValue, stat, luckUsed, total, dc, margin, skill } = result;
    
    const content = `
      <div class="ncm-skill-check-card cyberpunk-roll">
        <div class="ncm-check-header cyber-header">
          <i class="fas fa-dice-d10 cyber-icon"></i>
          <div class="cyber-title">${taskName.toUpperCase()}</div>
          <div class="cyber-subtitle">${actor.name}</div>
        </div>
        
        <div class="ncm-check-body roll-details">
          <div class="ncm-check-target roll-target">
            <span class="target-label">TARGET:</span>
            <span class="target-value">DV ${dc}</span>
          </div>
          
          <div class="ncm-check-formula roll-formula">
            <div class="formula-component dice">
              <i class="fas fa-dice-d10"></i> ${roll}
            </div>
            <div class="formula-component">
              <span class="comp-label">${stat}</span>
              <span class="comp-value">${statValue}</span>
            </div>
            <div class="formula-component">
              <span class="comp-label">${skill.displayName}</span>
              <span class="comp-value">${skillLevel}</span>
            </div>
            ${luckUsed > 0 ? `
              <div class="formula-component luck">
                <span class="comp-label">LUCK</span>
                <span class="comp-value">${luckUsed}</span>
              </div>
            ` : ''}
            <div class="formula-equals">=</div>
            <div class="formula-total">${total}</div>
          </div>
          
          <div class="ncm-check-result roll-result ${success ? 'success' : 'failure'}">
            ${success ? `
              <i class="fas fa-check-circle"></i>
              <strong>SUCCESS!</strong>
              ${margin > 5 ? `<span class="margin-text">Exceeded by ${margin}</span>` : ''}
            ` : `
              <i class="fas fa-times-circle"></i>
              <strong>FAILURE</strong>
              ${margin < -5 ? `<span class="margin-text">Failed by ${Math.abs(margin)}</span>` : ''}
            `}
          </div>
        </div>
      </div>
    `;
    
    await ChatMessage.create({
      content,
      speaker: ChatMessage.getSpeaker({ actor }),
      type: CONST.CHAT_MESSAGE_TYPES.ROLL,
      roll: result.rollObject,
      flags: {
        [MODULE_ID]: {
          type: 'skill-check',
          success,
          taskName
        }
      }
    });
  }
  
  /**
   * Get recommended skills for hacking
   * @returns {Array<string>} Array of skill names
   */
  getHackingSkills() {
    return [
      'Interface',
      'Electronics/Security Tech',
      'Basic Tech',
      'Cryptography'
    ];
  }
  
  /**
   * Get recommended skills for authentication bypass
   * @returns {Array<string>} Array of skill names
   */
  getAuthenticationSkills() {
    return [
      'Interface',
      'Electronics/Security Tech',
      'Library Search',
      'Education',
      'Deduction'
    ];
  }
  
  /**
   * Quick skill check - simplified version
   * @param {Actor} actor - The actor
   * @param {string} skillName - Skill to check
   * @param {number} dc - Difficulty
   * @returns {Promise<boolean>} Success or failure
   */
  async quickCheck(actor, skillName, dc) {
    const result = await this.performCheck({
      actor,
      skills: skillName,
      dc,
      taskName: `${skillName} Check`,
      allowLuck: false,
      autoRoll: true
    });
    
    return result.success;
  }
}