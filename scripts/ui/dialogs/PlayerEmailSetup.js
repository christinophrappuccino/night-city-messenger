/**
 * PlayerEmailSetup
 * @file scripts/ui/dialogs/PlayerEmailSetup.js
 * @module cyberpunkred-messenger
 * @description Dialog for players to set their character's email address.
 *              Called on first message attempt if no email set. Validates format,
 *              suggests based on character name.
 *              Extends BaseApplication (ApplicationV2 + HandlebarsApplicationMixin).
 */

import { MODULE_ID, TEMPLATES } from '../../utils/constants.js';
import { log } from '../../utils/helpers.js';
import { BaseApplication } from '../BaseApplication.js';
import { DataValidator } from '../../data/DataValidator.js';

export class PlayerEmailSetup extends BaseApplication {

  /** @type {string|null} Actor ID for email setup */
  actorId = null;

  /** @type {object|null} Actor document */
  actor = null;

  /** @type {Function|null} Resolve callback for the promise returned by show() */
  _resolve = null;

  /** @type {string} Error message to display */
  _errorMessage = '';

  /** @type {string} Current email value in the input */
  _emailValue = '';

  // ─── ApplicationV2 Configuration ───

  static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
    id: 'ncm-email-setup',
    classes: ['ncm-app', 'ncm-email-setup-dialog'],
    window: {
      title: 'NCM.Email.Setup',
      icon: 'fas fa-at',
      resizable: false,
      minimizable: false,
    },
    position: {
      width: 420,
      height: 'auto',
    },
    actions: {
      confirm: PlayerEmailSetup._onConfirm,
      cancel: PlayerEmailSetup._onCancel,
      useSuggestion: PlayerEmailSetup._onUseSuggestion,
    },
  }, { inplace: false });

  static PARTS = {
    main: {
      template: TEMPLATES.PLAYER_EMAIL_SETUP,
    },
  };

  // ─── Static Factory ───

  /**
   * Show the email setup dialog for an actor.
   * Returns a promise that resolves with the email address or null if cancelled.
   * @param {string} actorId
   * @returns {Promise<string|null>}
   */
  static async show(actorId) {
    const actor = game.actors.get(actorId);
    if (!actor) {
      ui.notifications.error('NCM | Actor not found.');
      return null;
    }

    // Check if email already exists
    const existing = actor.getFlag(MODULE_ID, 'email');
    if (existing) return existing;

    return new Promise((resolve) => {
      const dialog = new PlayerEmailSetup();
      dialog.actorId = actorId;
      dialog.actor = actor;
      dialog._resolve = resolve;
      dialog._emailValue = PlayerEmailSetup._suggestEmail(actor);
      dialog.render(true);
    });
  }

  /**
   * Check if an actor has an email set, and prompt if not.
   * Convenience wrapper for common use in message sending.
   * @param {string} actorId
   * @returns {Promise<string|null>}
   */
  static async ensureEmail(actorId) {
    const actor = game.actors.get(actorId);
    if (!actor) return null;

    const existing = actor.getFlag(MODULE_ID, 'email');
    if (existing) return existing;

    return PlayerEmailSetup.show(actorId);
  }

  // ─── Data Preparation ───

  async _prepareContext(options) {
    const suggestions = this._generateSuggestions();

    return {
      actorName: this.actor?.name ?? 'Unknown',
      actorImg: this.actor?.img ?? '',
      emailValue: this._emailValue,
      errorMessage: this._errorMessage,
      suggestions,
      MODULE_ID,
    };
  }

  // ─── Action Handlers ───

  static async _onConfirm(event, target) {
    const input = this.element.querySelector('input[name="email"]');
    const email = input?.value?.trim();

    if (!email) {
      this._errorMessage = 'Email address is required.';
      this.render(true);
      return;
    }

    if (!DataValidator.isValidEmail(email)) {
      this._errorMessage = 'Invalid email format. Use: handle@domain.net';
      this.render(true);
      return;
    }

    try {
      // Save email to actor flags
      await this.actor.update({
        [`flags.${MODULE_ID}.email`]: email,
      });

      log.info(`Email set for ${this.actor.name}: ${email}`);
      ui.notifications.info(`Email set: ${email}`);

      this._resolve?.(email);
      this._resolve = null;
      this.close();
    } catch (error) {
      console.error(`${MODULE_ID} | PlayerEmailSetup._onConfirm:`, error);
      this._errorMessage = 'Failed to save email. Check console.';
      this.render(true);
    }
  }

  static _onCancel(event, target) {
    this._resolve?.(null);
    this._resolve = null;
    this.close();
  }

  static _onUseSuggestion(event, target) {
    const suggestion = target.closest('[data-suggestion]')?.dataset.suggestion;
    if (!suggestion) return;

    this._emailValue = suggestion;
    this._errorMessage = '';
    this.render(true);
  }

  // ─── Close Override ───

  async close(options = {}) {
    // Resolve with null if closed without confirming
    if (this._resolve) {
      this._resolve(null);
      this._resolve = null;
    }
    return super.close(options);
  }

  // ─── Render Callback ───

  _onRender(context, options) {
    super._onRender(context, options);

    // Focus the email input
    const input = this.element.querySelector('input[name="email"]');
    if (input) {
      input.focus();
      input.select();

      // Enter key submits
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          PlayerEmailSetup._onConfirm.call(this, e, input);
        }
      });

      // Live validation
      input.addEventListener('input', (e) => {
        this._emailValue = e.target.value;
        this._errorMessage = '';
      });
    }
  }

  // ─── Helpers ───

  /**
   * Generate email suggestions based on character name.
   * @returns {Array<string>}
   * @private
   */
  _generateSuggestions() {
    if (!this.actor) return [];

    const name = this.actor.name;
    const handle = name.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '.');
    const first = handle.split('.')[0];
    const initials = name.split(/\s+/).map(w => w[0]?.toLowerCase()).join('');

    const domains = ['nightcity.net', 'nclink.com', 'dataterm.nc'];
    const suggestions = [];

    // Primary suggestion
    suggestions.push(`${handle}@${domains[0]}`);

    // Variations
    if (first && first !== handle) {
      suggestions.push(`${first}@${domains[1]}`);
    }
    if (initials.length >= 2) {
      suggestions.push(`${initials}@${domains[2]}`);
    }

    return suggestions.slice(0, 3);
  }

  /**
   * Generate a default email suggestion from an actor.
   * @param {Actor} actor
   * @returns {string}
   * @private
   */
  static _suggestEmail(actor) {
    const handle = actor.name.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, '.')
      .substring(0, 30);
    return `${handle}@nightcity.net`;
  }
}
