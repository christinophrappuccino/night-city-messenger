/**
 * NetworkAuthDialog
 * @file scripts/ui/NetworkManagement/NetworkAuthDialog.js
 * @module cyberpunkred-messenger
 * @description Player-facing authentication dialog for secured networks.
 *              Supports password entry and skill check prompts.
 *              Shown when a player attempts to connect to a network that
 *              requires authentication.
 *
 *              Extends BaseApplication (ApplicationV2 + HandlebarsApplicationMixin).
 */

import { MODULE_ID, EVENTS, TEMPLATES } from '../../utils/constants.js';
import { log } from '../../utils/helpers.js';
import { BaseApplication } from '../BaseApplication.js';

export class NetworkAuthDialog extends BaseApplication {

  /** @type {string} Network ID being authenticated against */
  networkId = null;

  /** @type {object} Full network object */
  network = null;

  /** @type {Function|null} Resolve callback for the promise returned by show() */
  _resolve = null;

  /** @type {string} Current auth mode: 'password' | 'skill' */
  _authMode = 'password';

  /** @type {string} Error message to display */
  _errorMessage = '';

  // ─── Service Accessors ───

  get networkService() { return game.nightcity?.networkService; }
  get securityService() { return game.nightcity?.securityService; }

  // ─── ApplicationV2 Configuration ───

  static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
    id: 'ncm-network-auth',
    classes: ['ncm-app', 'ncm-network-auth-dialog'],
    window: {
      title: 'NCM.Network.AuthRequired',
      resizable: false,
      minimizable: false,
    },
    position: {
      width: 420,
      height: 'auto',
    },
    actions: {
      submitPassword: NetworkAuthDialog._onSubmitPassword,
      attemptSkillCheck: NetworkAuthDialog._onAttemptSkillCheck,
      switchMode: NetworkAuthDialog._onSwitchMode,
      cancel: NetworkAuthDialog._onCancel,
    },
  }, { inplace: false });

  static PARTS = {
    main: {
      template: TEMPLATES.NETWORK_AUTH_DIALOG,
    },
  };

  // ─── Static Factory ───

  /**
   * Show the auth dialog for a network and return a promise that resolves
   * with { success: boolean, method?: string } when the dialog closes.
   * @param {string} networkId
   * @returns {Promise<{ success: boolean, method?: string }>}
   */
  static async show(networkId) {
    const networkService = game.nightcity?.networkService;
    const network = networkService?.getNetwork(networkId);
    if (!network) {
      ui.notifications.error('NCM | Unknown network.');
      return { success: false };
    }

    return new Promise((resolve) => {
      const dialog = new NetworkAuthDialog();
      dialog.networkId = networkId;
      dialog.network = network;
      dialog._resolve = resolve;

      // Determine default auth mode
      const hasPassword = !!network.security.password;
      const hasSkillBypass = network.security.bypassSkills?.length > 0;
      dialog._authMode = hasPassword ? 'password' : (hasSkillBypass ? 'skill' : 'password');

      dialog.render(true);
    });
  }

  // ─── Data Preparation ───

  async _prepareContext(options) {
    const network = this.network;
    if (!network) return {};

    const hasPassword = !!network.security.password;
    const hasSkillBypass = network.security.bypassSkills?.length > 0;

    // Get lockout status for current actor
    const actorId = game.user?.character?.id;
    const isLockedOut = actorId
      ? this.securityService?.isLockedOut(actorId, this.networkId)
      : false;
    const lockoutRemaining = actorId
      ? this.securityService?.getLockoutRemaining(actorId, this.networkId)
      : 0;
    const remainingAttempts = actorId
      ? this.securityService?.getRemainingAttempts(actorId, this.networkId)
      : 3;

    return {
      network: {
        id: network.id,
        name: network.name,
        type: network.type,
        icon: network.theme?.icon ?? 'fa-wifi',
        color: network.theme?.color ?? '#19f3f7',
        securityLevel: network.security.level,
        description: network.description,
      },

      hasPassword,
      hasSkillBypass,
      hasBothModes: hasPassword && hasSkillBypass,
      authMode: this._authMode,
      isPasswordMode: this._authMode === 'password',
      isSkillMode: this._authMode === 'skill',

      bypassSkills: (network.security.bypassSkills ?? []).map(skill => ({
        name: skill,
        dc: network.security.bypassDC ?? 15,
      })),
      bypassDC: network.security.bypassDC ?? 15,

      isLockedOut,
      lockoutRemaining: this._formatDuration(lockoutRemaining),
      remainingAttempts,
      maxAttempts: network.security.maxAttempts ?? 3,

      errorMessage: this._errorMessage,
      hasError: !!this._errorMessage,

      MODULE_ID,
    };
  }

  // ─── Lifecycle ───

  _onClose(options) {
    super._onClose?.(options);
    // If dialog closes without successful auth, resolve with failure
    if (this._resolve) {
      this._resolve({ success: false, method: 'cancelled' });
      this._resolve = null;
    }
  }

  // ─── Action Handlers ───

  static async _onSubmitPassword(event, target) {
    const passwordInput = this.element.querySelector('[name="password"]');
    const password = passwordInput?.value ?? '';

    if (!password.trim()) {
      this._errorMessage = 'Enter a password.';
      this.render();
      return;
    }

    // Init security tracking
    const actorId = game.user?.character?.id;
    if (actorId) {
      this.securityService?.initTracking(actorId, this.networkId, {
        maxAttempts: this.network.security.maxAttempts ?? 3,
        lockoutDuration: this.network.security.lockoutDuration ?? 3600000,
      });
    }

    const result = this.networkService.authenticatePassword(this.networkId, password);

    if (result.success) {
      if (actorId) this.securityService?.recordSuccess(actorId, this.networkId);

      this._errorMessage = '';
      if (this._resolve) {
        this._resolve({ success: true, method: 'password' });
        this._resolve = null;
      }
      this.close();
    } else {
      // Record failed attempt
      if (actorId) {
        const { lockedOut } = this.securityService?.recordFailedAttempt(actorId, this.networkId) ?? {};
        if (lockedOut) {
          this._errorMessage = 'SYSTEM LOCKED — Too many failed attempts.';
          this.soundService?.play('lockout');
        } else {
          this._errorMessage = 'ACCESS DENIED — Invalid credentials.';
        }
      } else {
        this._errorMessage = 'ACCESS DENIED — Invalid credentials.';
      }
      this.render();
    }
  }

  static async _onAttemptSkillCheck(event, target) {
    const skillName = target.dataset.skill;
    if (!skillName) return;

    const actor = game.user?.character;
    if (!actor) {
      ui.notifications.warn('NCM | No character assigned. Set your character in User Configuration.');
      return;
    }

    // Init security tracking
    this.securityService?.initTracking(actor.id, this.networkId, {
      maxAttempts: this.network.security.maxAttempts ?? 3,
      lockoutDuration: this.network.security.lockoutDuration ?? 3600000,
    });

    // Check lockout
    if (this.securityService?.isLockedOut(actor.id, this.networkId)) {
      this._errorMessage = 'SYSTEM LOCKED — Too many failed attempts.';
      this.render();
      return;
    }

    // For Phase 3, we do a simple 1d10 roll + prompt.
    // Phase 4 SkillService will replace this with full stat+skill+1d10+crits.
    const dc = this.network.security.bypassDC ?? 15;
    const roll = new Roll('1d10');
    await roll.evaluate();

    // Try to read skill value from actor (CPR system)
    let skillBonus = 0;
    let statBonus = 0;
    try {
      // CPR: Skills are items on the actor
      const skillItem = actor.items.find(i =>
        i.type === 'skill' && i.name.toLowerCase() === skillName.toLowerCase()
      );
      if (skillItem) {
        skillBonus = skillItem.system?.level ?? 0;
        // Try to get linked stat
        const statName = skillItem.system?.stat;
        if (statName && actor.system?.stats?.[statName]) {
          statBonus = actor.system.stats[statName]?.value ?? 0;
        }
      }
    } catch {
      // Non-CPR system or skill not found — use just the die roll
      log.debug(`Could not read skill "${skillName}" from actor — using raw roll`);
    }

    const total = roll.total + skillBonus + statBonus;

    // Show the roll in chat
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: `<strong>Network Bypass: ${this.network.name}</strong><br>
               ${skillName} vs DC ${dc}<br>
               Roll: ${roll.total} + Skill: ${skillBonus} + Stat: ${statBonus} = <strong>${total}</strong>`,
    });

    const authResult = this.networkService.authenticateSkillCheck(this.networkId, total, skillName);

    if (authResult.success) {
      this.securityService?.recordSuccess(actor.id, this.networkId);
      this._errorMessage = '';
      if (this._resolve) {
        this._resolve({ success: true, method: 'skill', skillName, total });
        this._resolve = null;
      }
      this.close();
    } else {
      const { lockedOut } = this.securityService?.recordFailedAttempt(actor.id, this.networkId) ?? {};
      if (lockedOut) {
        this._errorMessage = 'SYSTEM LOCKED — Too many failed attempts.';
        this.soundService?.play('lockout');
      } else {
        this._errorMessage = `ACCESS DENIED — ${skillName} check failed (${total} vs DC ${dc}).`;
      }
      this.render();
    }
  }

  static _onSwitchMode(event, target) {
    const mode = target.dataset.mode;
    if (mode === 'password' || mode === 'skill') {
      this._authMode = mode;
      this._errorMessage = '';
      this.render();
    }
  }

  static _onCancel() {
    this.close();
  }

  // ─── Helpers ───

  _formatDuration(ms) {
    if (ms <= 0) return '0s';
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }
}
