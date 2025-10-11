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
  static async show(actor = null) {
    const targetActor = actor || game.user.character;
    
    if (!targetActor) {
      ui.notifications.warn("No character available to set up email.");
      return false;
    }
    
    const currentEmail = targetActor.getFlag(MODULE_ID, "emailAddress") || "";
    
    const content = `
      <div class="ncm-email-setup">
        <p class="ncm-email-setup__description">
          Set up email address for <strong>${targetActor.name}</strong>.
        </p>
        <div class="form-group">
          <label>Character: <strong>${targetActor.name}</strong></label>
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
        title: `Email Setup - ${targetActor.name}`,
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
              
              // Set flag on the target actor
              await targetActor.setFlag(MODULE_ID, "emailAddress", email);
              
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
  static async ensureEmailSet(actor = null) {
    const targetActor = actor || game.user.character;
    
    if (!targetActor) return false;
    
    const email = targetActor.getFlag(MODULE_ID, "emailAddress");
    
    if (!email) {
      ui.notifications.warn("You need to set up your email address first.");
      return await this.show(targetActor);
    }
    
    return true;
  }
}