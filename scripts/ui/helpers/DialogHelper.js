/**
 * Dialog Helper
 * File: scripts/ui/helpers/DialogHelper.js
 * Module: cyberpunkred-messenger
 * Description: Cyberpunk-styled dialog utilities
 */

import { MODULE_ID } from '../../utils/constants.js';

export class DialogHelper {
  
  /**
   * Show luck dialog with slider
   * @param {Actor} actor - The actor
   * @returns {Promise<number>} Luck points to use
   */
  static async showLuckDialog(actor) {
    const luckStat = actor.system.stats.luck?.value || 0;
    
    if (luckStat === 0) {
      return 0;
    }
    
    return new Promise(resolve => {
      new Dialog({
        title: "Use Luck Points?",
        content: `
          <div class="ncm-luck-dialog">
            <div class="ncm-luck-header">
              <i class="fas fa-clover"></i>
              <h3>Luck Available</h3>
            </div>
            
            <div class="ncm-luck-body">
              <p>You have <strong class="ncm-luck-value">${luckStat}</strong> Luck remaining.</p>
              <p>How many Luck points do you want to add to your roll?</p>
              
              <div class="ncm-luck-slider-container">
                <input 
                  type="range" 
                  id="luck-slider" 
                  min="0" 
                  max="${luckStat}" 
                  value="0" 
                  class="ncm-luck-slider"
                  oninput="document.getElementById('luck-value').textContent = this.value"
                >
              </div>
              
              <div class="ncm-luck-selected">
                Selected: <span id="luck-value" class="ncm-luck-value">0</span> Luck
              </div>
            </div>
          </div>
        `,
        buttons: {
          roll: {
            icon: '<i class="fas fa-dice"></i>',
            label: "Roll!",
            callback: html => {
              const luck = parseInt(html.find('#luck-slider').val()) || 0;
              resolve(luck);
            }
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: "Cancel",
            callback: () => resolve(null)
          }
        },
        default: "roll",
        render: html => {
          html.find('.dialog-content').css({
            'background': 'linear-gradient(135deg, rgba(26, 26, 26, 0.95) 0%, rgba(51, 0, 0, 0.95) 100%)',
            'border': '2px solid var(--ncm-primary)',
            'font-family': "'Rajdhani', sans-serif"
          });
        }
      }).render(true);
    });
  }
  
  /**
   * Show skill selection dialog (for multiple skills with different DVs)
   * @param {Object} options - Skill options
   * @returns {Promise<Object>} Selected skill and DC
   */
  static async showSkillSelectionDialog(options) {
    const { actor, skills, targetName, description } = options;
    
    if (!skills || skills.length === 0) {
      throw new Error('No skills provided');
    }
    
    // If only one skill, return it immediately
    if (skills.length === 1) {
      return skills[0];
    }
    
    return new Promise((resolve, reject) => {
      const buttons = {};
      
      // Create a button for each skill
      skills.forEach((skillOption, index) => {
        const { skillName, dc, description: skillDesc } = skillOption;
        
        // Get skill level from actor
        const actorSkills = actor.items.filter(i => i.type === 'skill');
        const actorSkill = actorSkills.find(s => s.name === skillName);
        const skillLevel = actorSkill?.system?.level || 0;
        
        buttons[`skill_${index}`] = {
          icon: '<i class="fas fa-terminal"></i>',
          label: `${skillName} (DV ${dc})`,
          callback: () => resolve(skillOption)
        };
      });
      
      // Add cancel button
      buttons.cancel = {
        icon: '<i class="fas fa-times"></i>',
        label: "Cancel",
        callback: () => resolve(null)
      };
      
      // Build skill table
      const skillRows = skills.map((skillOption, index) => {
        const { skillName, dc, description: skillDesc } = skillOption;
        
        // Get skill level from actor
        const actorSkills = actor.items.filter(i => i.type === 'skill');
        const actorSkill = actorSkills.find(s => s.name === skillName);
        const skillLevel = actorSkill?.system?.level || 0;
        const hasSkill = skillLevel > 0;
        
        return `
          <tr class="${!hasSkill ? 'ncm-skill-unavailable' : ''}">
            <td>
              <strong>${skillName}</strong>
              ${skillDesc ? `<br><span class="ncm-skill-desc">${skillDesc}</span>` : ''}
            </td>
            <td class="ncm-skill-level ${!hasSkill ? 'ncm-text-error' : 'ncm-text-success'}">
              ${hasSkill ? skillLevel : 'Not Trained'}
            </td>
            <td class="ncm-skill-dc">DV ${dc}</td>
          </tr>
        `;
      }).join('');
      
      new Dialog({
        title: "Select Skill to Use",
        content: `
          <div class="ncm-skill-dialog">
            <div class="ncm-skill-header">
              <i class="fas fa-brain"></i>
              <h3>Choose Your Approach</h3>
            </div>
            
            <div class="ncm-skill-body">
              ${description ? `<p class="ncm-skill-desc">${description}</p>` : ''}
              <p class="ncm-target-info">
                <strong>Target:</strong> ${targetName}
              </p>
              
              <table class="ncm-skill-table">
                <thead>
                  <tr>
                    <th>Skill</th>
                    <th>Your Level</th>
                    <th>Difficulty</th>
                  </tr>
                </thead>
                <tbody>
                  ${skillRows}
                </tbody>
              </table>
              
              <p class="ncm-skill-note">
                <i class="fas fa-info-circle"></i>
                Choose the skill you want to use for this attempt
              </p>
            </div>
          </div>
        `,
        buttons,
        default: "skill_0",
        render: html => {
          html.find('.dialog-content').css({
            'background': 'linear-gradient(135deg, rgba(26, 26, 26, 0.95) 0%, rgba(51, 0, 0, 0.95) 100%)',
            'border': '2px solid var(--ncm-secondary)',
            'font-family': "'Rajdhani', sans-serif"
          });
          
          // Disable buttons for skills the actor doesn't have
          skills.forEach((skillOption, index) => {
            const actorSkills = actor.items.filter(i => i.type === 'skill');
            const actorSkill = actorSkills.find(s => s.name === skillOption.skillName);
            const hasSkill = actorSkill && actorSkill.system.level > 0;
            
            if (!hasSkill) {
              html.find(`button[data-button="skill_${index}"]`)
                .prop('disabled', true)
                .css('opacity', '0.5');
            }
          });
        }
      }, {
        width: 600
      }).render(true);
    });
  }
  
  /**
   * Show confirmation dialog (cyberpunk styled)
   * @param {Object} options - Dialog options
   * @returns {Promise<boolean>} Confirmed
   */
  static async showConfirmDialog(options) {
    const { title, content, icon = 'fas fa-question-circle', confirmLabel = 'Confirm', cancelLabel = 'Cancel' } = options;
    
    return new Promise(resolve => {
      new Dialog({
        title,
        content: `
          <div class="ncm-confirm-dialog">
            <div class="ncm-confirm-icon">
              <i class="${icon}"></i>
            </div>
            <div class="ncm-confirm-content">
              ${content}
            </div>
          </div>
        `,
        buttons: {
          confirm: {
            icon: '<i class="fas fa-check"></i>',
            label: confirmLabel,
            callback: () => resolve(true)
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: cancelLabel,
            callback: () => resolve(false)
          }
        },
        default: "cancel",
        render: html => {
          html.find('.dialog-content').css({
            'background': 'linear-gradient(135deg, rgba(26, 26, 26, 0.95) 0%, rgba(51, 0, 0, 0.95) 100%)',
            'border': '2px solid var(--ncm-warning)',
            'font-family': "'Rajdhani', sans-serif"
          });
        }
      }).render(true);
    });
  }
}