/**
 * Email Settings Integration
 * @file scripts/integrations/EmailSettingsIntegration.js
 * @module cyberpunkred-messenger
 * @description Hooks into actor sheet rendering to inject an email address field.
 *              Read/write flags.cyberpunkred-messenger.email. Shows on both
 *              character and NPC sheets. GM can edit any, players can edit their own.
 */

import { MODULE_ID } from '../utils/constants.js';
import { log, isGM } from '../utils/helpers.js';
import { DataValidator } from '../data/DataValidator.js';

export class EmailSettingsIntegration {

  /**
   * Register hooks for actor sheet injection.
   * Called once during init phase.
   */
  static register() {
    // Hook into ALL actor sheet renders
    Hooks.on('renderActorSheet', (app, html, data) => {
      EmailSettingsIntegration._injectEmailField(app, html, data);
    });

    // Also hook into CPR-specific sheets if they exist
    Hooks.on('renderCPRActorSheet', (app, html, data) => {
      EmailSettingsIntegration._injectEmailField(app, html, data);
    });

    log.info('EmailSettingsIntegration: Actor sheet hooks registered');
  }

  /**
   * Inject email field into actor sheet.
   * @param {Application} app - The actor sheet application
   * @param {jQuery|HTMLElement} html - The rendered HTML
   * @param {object} data - Template data
   * @private
   */
  static _injectEmailField(app, html, data) {
    try {
      const actor = app.actor || app.document;
      if (!actor) return;

      // Ensure html is a proper element
      const root = html instanceof jQuery ? html[0] : html;
      if (!root) return;

      // Check if already injected (prevent duplicates)
      if (root.querySelector('.ncm-email-field')) return;

      // Determine permissions
      const canEdit = isGM() || actor.isOwner;
      const currentEmail = actor.getFlag(MODULE_ID, 'email') || '';

      // Build the HTML for the email field
      const emailHtml = document.createElement('div');
      emailHtml.classList.add('ncm-email-field', 'form-group');
      emailHtml.innerHTML = `
        <label>
          <i class="fas fa-at" style="color: var(--ncm-secondary, #19f3f7); margin-right: 4px;"></i>
          NCM Email
        </label>
        <div class="form-fields">
          <input type="text"
                 name="flags.${MODULE_ID}.email"
                 value="${this._escapeHtml(currentEmail)}"
                 placeholder="handle@nightcity.net"
                 ${canEdit ? '' : 'disabled'}
                 class="ncm-email-input"
                 style="font-family: 'Share Tech Mono', 'Courier New', monospace; color: var(--ncm-secondary, #19f3f7);"
          />
          ${!currentEmail && canEdit ? '<button type="button" class="ncm-email-generate" title="Generate email"><i class="fas fa-magic"></i></button>' : ''}
        </div>
      `;

      // Find insertion point — look for common sheet areas
      const insertTarget = this._findInsertionPoint(root);
      if (insertTarget) {
        insertTarget.parentNode.insertBefore(emailHtml, insertTarget.nextSibling);
      } else {
        // Fallback: append to the sheet header or first tab
        const header = root.querySelector('.sheet-header, header, .window-content > form');
        if (header) {
          // Insert after header
          header.appendChild(emailHtml);
        }
      }

      // Wire up events
      if (canEdit) {
        const input = emailHtml.querySelector('input');
        const generateBtn = emailHtml.querySelector('.ncm-email-generate');

        // Save on blur / change
        if (input) {
          input.addEventListener('change', async (e) => {
            const newEmail = e.target.value.trim();

            if (newEmail && !DataValidator.isValidEmail(newEmail)) {
              ui.notifications.warn('NCM: Invalid email format.');
              e.target.value = currentEmail;
              return;
            }

            try {
              await actor.update({
                [`flags.${MODULE_ID}.email`]: newEmail || null,
              });
              log.debug(`Email updated for ${actor.name}: ${newEmail || '(cleared)'}`);
            } catch (error) {
              console.error(`${MODULE_ID} | EmailSettingsIntegration: Failed to update email`, error);
            }
          });
        }

        // Generate button
        if (generateBtn) {
          generateBtn.addEventListener('click', () => {
            const handle = actor.name.toLowerCase()
              .replace(/[^a-z0-9\s]/g, '')
              .replace(/\s+/g, '.')
              .substring(0, 30);
            const suggested = `${handle}@nightcity.net`;
            if (input) {
              input.value = suggested;
              input.dispatchEvent(new Event('change'));
            }
          });
        }
      }

    } catch (error) {
      // Non-fatal — don't break actor sheets
      console.warn(`${MODULE_ID} | EmailSettingsIntegration: Failed to inject email field`, error);
    }
  }

  /**
   * Find the best insertion point on the actor sheet.
   * Looks for name field, details section, or identity fields.
   * @param {HTMLElement} root
   * @returns {HTMLElement|null}
   * @private
   */
  static _findInsertionPoint(root) {
    // Try common CPR sheet selectors
    const selectors = [
      // CPR-specific
      '.identity-section .form-group:last-child',
      '[name="name"]',
      '.sheet-header .form-group:last-child',
      // Generic
      '.header-fields .form-group:last-child',
      '.character-details .form-group:last-child',
      '.sheet-body .tab[data-tab="description"] .form-group:first-child',
    ];

    for (const selector of selectors) {
      const el = root.querySelector(selector);
      if (el) return el.closest('.form-group') || el;
    }

    return null;
  }

  /**
   * Escape HTML entities for safe attribute insertion.
   * @param {string} str
   * @returns {string}
   * @private
   */
  static _escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}
