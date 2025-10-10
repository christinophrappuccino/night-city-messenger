/**
 * Email Settings Registration
 * File: scripts/integrations/EmailSettingsRegistration.js
 * Module: cyberpunkred-messenger
 * Description: Register email setup in module settings
 */

import { MODULE_ID } from '../utils/constants.js';

/**
 * Email Setup Menu for Module Settings
 */
class EmailSetupMenu extends FormApplication {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      title: "Email Address Setup",
      id: "ncm-email-setup",
      template: `modules/${MODULE_ID}/templates/settings/email-setup.hbs`,
      width: 500,
      height: "auto",
      closeOnSubmit: true
    });
  }
  
  getData() {
    const actor = game.user.character;
    const currentEmail = actor?.getFlag(MODULE_ID, "emailAddress") || "";
    
    return {
      hasCharacter: !!actor,
      characterName: actor?.name || "No character assigned",
      currentEmail
    };
  }
  
  async _updateObject(event, formData) {
    const actor = game.user.character;
    
    if (!actor) {
      ui.notifications.error("You must have a character assigned.");
      return;
    }
    
    const email = formData.email?.trim();
    
    if (!email) {
      ui.notifications.error("Email address is required.");
      return;
    }
    
    if (!email.includes('@') || !email.includes('.')) {
      ui.notifications.error("Invalid email format.");
      return;
    }
    
    await actor.setFlag(MODULE_ID, "emailAddress", email);
    ui.notifications.info(`Email address set to: ${email}`);
  }
}

/**
 * Register email settings
 */
export function registerEmailSettings() {
  console.log(`${MODULE_ID} | Registering email settings...`);
  
  // Register menu in module settings
  game.settings.registerMenu(MODULE_ID, 'emailSetup', {
    name: 'Email Setup',
    label: 'Set Your Email Address',
    hint: 'Configure your character\'s email address for Night City Messenger',
    icon: 'fas fa-envelope-open-text',
    type: EmailSetupMenu,
    restricted: false // Available to all players
  });
}

/**
 * Register actor sheet hooks for email indicator
 */
export function registerActorSheetHooks() {
  Hooks.on('renderActorSheet', (app, html, data) => {
    // Only for owned actors
    if (!app.actor.isOwner) return;
    
    const actor = app.actor;
    const email = actor.getFlag(MODULE_ID, "emailAddress");
    
    // Add email indicator to character sheet header
    const header = html.find('.window-header');
    
    if (header.length) {
      const emailBtn = $(`
        <a class="ncm-email-indicator" title="${email ? `Email: ${email}` : 'Set up email'}">
          <i class="fas fa-envelope"></i>
          ${email ? 
            '<i class="fas fa-check-circle" style="color: #4ade80;"></i>' : 
            '<i class="fas fa-exclamation-circle" style="color: #f59e0b;"></i>'
          }
        </a>
      `);
      
      emailBtn.on('click', async (e) => {
        e.preventDefault();
        const { PlayerEmailSetup } = await import('../ui/dialogs/PlayerEmailSetup.js');
        await PlayerEmailSetup.show();
      });
      
      header.find('.window-title').after(emailBtn);
    }
  });
}

/**
 * Auto-prompt for email on first composer/inbox open
 */
export function registerEmailPrompts() {
  Hooks.on('ncm:beforeOpenComposer', async () => {
    const actor = game.user.character;
    if (!actor) return;
    
    const email = actor.getFlag(MODULE_ID, "emailAddress");
    
    if (!email) {
      const { PlayerEmailSetup } = await import('../ui/dialogs/PlayerEmailSetup.js');
      await PlayerEmailSetup.show();
    }
  });
  
  Hooks.on('ncm:beforeOpenInbox', async () => {
    const actor = game.user.character;
    if (!actor) return;
    
    const email = actor.getFlag(MODULE_ID, "emailAddress");
    
    if (!email) {
      const { PlayerEmailSetup } = await import('../ui/dialogs/PlayerEmailSetup.js');
      await PlayerEmailSetup.show();
    }
  });
}