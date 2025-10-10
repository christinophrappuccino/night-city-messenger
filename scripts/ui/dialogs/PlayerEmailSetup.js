/**
 * Player Email Setup Dialog
 * File: scripts/ui/dialogs/PlayerEmailSetup.js
 * Module: cyberpunkred-messenger
 * Description: Allows players to set their own email address
 */

import { MODULE_ID } from '../../utils/constants.js';
import { isValidEmail } from '../../utils/validators.js';

export class PlayerEmailSetup {
  /**
   * Show email setup dialog for current user
   */
  static async show() {
    const actor = game.user.character;
    
    if (!actor) {
      ui.notifications.warn("You must have a character assigned to set up email.");
      return;
    }
    
    const currentEmail = actor.getFlag(MODULE_ID, "emailAddress") || "";
    
    const content = `
      <div class="ncm-email-setup">
        <p class="ncm-email-setup__description">
          Set up your character's email address for Night City Messenger.
        </p>
        <div class="form-group">
          <label>Character: <strong>${actor.name}</strong></label>
        </div>
        <div class="form-group">
          <label>Email Address:</label>
          <input 
            type="email" 
            name="email" 
            value="${currentEmail}"
            placeholder="yourname@nightcity.net"
            autocomplete="off"
            class="ncm-input"
          />
          <small class="ncm-help-text">
            Examples: streetkid@nightcity.net, runner@darknet.nc, merc@corporat.net
          </small>
        </div>
      </div>
    `;
    
    return new Promise((resolve) => {
      new Dialog({
        title: "Email Setup",
        content,
        buttons: {
          save: {
            icon: '<i class="fas fa-save"></i>',
            label: "Save",
            callback: async (html) => {
              const email = html.find('[name="email"]').val().trim();
              
              if (!email) {
                ui.notifications.error("Email address is required.");
                resolve(false);
                return;
              }
              
              if (!isValidEmail(email)) {
                ui.notifications.error("Invalid email format.");
                resolve(false);
                return;
              }
              
              // Set flag on actor
              await actor.setFlag(MODULE_ID, "emailAddress", email);
              
              ui.notifications.info(`Email address set to: ${email}`);
              resolve(true);
            }
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: "Cancel",
            callback: () => resolve(false)
          }
        },
        default: "save",
        close: () => resolve(false)
      }, {
        classes: ['dialog', 'ncm-dialog'],
        width: 400
      }).render(true);
    });
  }
  
  /**
   * Check if player has email set, prompt if not
   */
  static async ensureEmailSet() {
    const actor = game.user.character;
    
    if (!actor) return false;
    
    const email = actor.getFlag(MODULE_ID, "emailAddress");
    
    if (!email) {
      ui.notifications.warn("You need to set up your email address first.");
      return await this.show();
    }
    
    return true;
  }
}