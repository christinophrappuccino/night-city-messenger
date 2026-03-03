/**
 * NetworkAuthDialog
 * @file scripts/ui/NetworkManagement/NetworkAuthDialog.js
 * @module cyberpunkred-messenger
 * @description Player-facing authentication dialog for secured networks.
 *              Supports password entry and skill check prompts.
 *              Shown when a player attempts to connect to a network that
 *              requires authentication.
 *
 *              WP-4 Polish:
 *              • Live lockout countdown (setInterval, cleared on close)
 *              • Enter key submits password form
 *              • Dynamic remaining-count in error messages
 *              • Sound hooks for auth success / failure / lockout
 *              • SkillService integration point (Phase 4 ready)
 *              • GM bypass now grants actual auth on the network
 *              • Crit success / crit failure labels on skill check chat cards
 *              • _formatDuration uses MM:SS for lockout display
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

  /** @type {number|null} setInterval ID for live lockout countdown */
  _lockoutTimerId = null;

  /** @type {Function|null} Bound keydown handler for cleanup */
  _keydownHandler = null;

  // ─── Service Accessors ───

  get networkService() { return game.nightcity?.networkService; }
  get securityService() { return game.nightcity?.securityService; }

  /**
   * Phase 4 SkillService — returns null if not yet available.
   * When present, provides full stat+skill resolution for CPR actors.
   * @returns {object|null}
   */
  get skillService() { return game.nightcity?.skillService ?? null; }

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
      togglePasswordVisibility: NetworkAuthDialog._onTogglePasswordVisibility,
      gmBypass: NetworkAuthDialog._onGMBypass,
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

  // ═══════════════════════════════════════════════════════════
  //  Data Preparation
  // ═══════════════════════════════════════════════════════════

  async _prepareContext(options) {
    const network = this.network;
    if (!network) return {};

    const hasPassword = !!network.security.password;
    const hasSkillBypass = network.security.bypassSkills?.length > 0;

    // Derive maxAttempts early — needed for pip computation below
    const maxAttempts = network.security.maxAttempts ?? 3;

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
      : maxAttempts;

    // --- Attempt Pips ---
    const usedAttempts = maxAttempts - remainingAttempts;
    const attemptPips = [];

    if (isLockedOut) {
      // All pips are 'used' in lockout state
      for (let i = 0; i < maxAttempts; i++) {
        attemptPips.push({ state: 'used' });
      }
    } else {
      for (let i = 0; i < maxAttempts; i++) {
        if (i < usedAttempts) {
          attemptPips.push({ state: 'used' });
        } else if (i === usedAttempts) {
          attemptPips.push({ state: 'current' });
        } else {
          attemptPips.push({ state: 'unused' });
        }
      }
    }

    // --- Network Type Label & Security Tag Class ---
    const typeLabels = {
      public: 'Public Subnet',
      hidden: 'Hidden Subnet',
      corporate: 'Corporate Subnet',
      government: 'Government Subnet',
      custom: 'Custom Subnet',
    };
    const networkTypeLabel = typeLabels[network.type] || 'Subnet';

    const securityTagMap = {
      none: 'green',
      low: 'cyan',
      standard: 'warn',
      advanced: 'purple',
      maximum: 'danger',
    };
    const securityTagClass = securityTagMap[(network.security.level || 'standard').toLowerCase()] || 'warn';

    // --- Skill Breakdown (for skill check mode) ---
    let skillBreakdown = null;
    if (this._authMode === 'skill' && hasSkillBypass) {
      skillBreakdown = this._buildSkillBreakdown(network);
    }

    return {
      network: {
        id: network.id,
        name: network.name,
        type: network.type,
        icon: network.theme?.icon ?? 'fa-wifi',
        color: network.theme?.color ?? '#19f3f7',
        securityLevel: network.security.level,
        description: network.description,
        typeLabel: networkTypeLabel,
        securityTagClass,
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
      lockoutRemainingMs: lockoutRemaining,
      remainingAttempts,
      maxAttempts,

      attemptPips,
      skillBreakdown,

      errorMessage: this._errorMessage,
      hasError: !!this._errorMessage,

      isGM: game.user?.isGM ?? false,

      MODULE_ID,
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  Lifecycle
  // ═══════════════════════════════════════════════════════════

  /**
   * After render — set auth state attribute, wire Enter key, start lockout timer.
   */
  _onRender(context, options) {
    super._onRender?.(context, options);

    // Set auth state attribute for CSS accent bar color
    if (context.isLockedOut) {
      this.element.dataset.authState = 'lockout';
    } else if (context.isSkillMode) {
      this.element.dataset.authState = 'skill';
    } else {
      this.element.dataset.authState = 'password';
    }

    // ── Enter key submission for password mode ──
    this._unbindKeydown();
    if (context.isPasswordMode && !context.isLockedOut) {
      const input = this.element.querySelector('.ncm-auth__password-input');
      if (input) {
        this._keydownHandler = (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            const btn = this.element.querySelector('[data-action="submitPassword"]');
            btn?.click();
          }
        };
        input.addEventListener('keydown', this._keydownHandler);

        // Auto-focus password input
        requestAnimationFrame(() => input.focus());
      }
    }

    // ── Live lockout countdown ──
    this._clearLockoutTimer();
    if (context.isLockedOut && context.lockoutRemainingMs > 0) {
      this._startLockoutCountdown();
    }
  }

  /**
   * Cleanup on close — resolve promise, clear timers, unbind listeners.
   */
  _onClose(options) {
    super._onClose?.(options);
    this._clearLockoutTimer();
    this._unbindKeydown();

    // If dialog closes without successful auth, resolve with failure
    if (this._resolve) {
      this._resolve({ success: false, method: 'cancelled' });
      this._resolve = null;
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Action Handlers
  // ═══════════════════════════════════════════════════════════

  /**
   * Submit the password and check against NetworkService.
   * Tracks attempts via SecurityService; shows dynamic remaining count.
   */
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

    // NetworkService.authenticatePassword handles sound internally
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
      // Record failed attempt and build dynamic error message
      if (actorId) {
        const { lockedOut } = this.securityService?.recordFailedAttempt(actorId, this.networkId) ?? {};
        if (lockedOut) {
          this._errorMessage = 'SYSTEM LOCKED — Too many failed attempts.';
          this.soundService?.play('lockout');
        } else {
          const remaining = this.securityService?.getRemainingAttempts(actorId, this.networkId) ?? '?';
          this._errorMessage = `ACCESS DENIED — Invalid credentials. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`;
        }
      } else {
        this._errorMessage = 'ACCESS DENIED — Invalid credentials.';
      }
      this.render();
    }
  }

  /**
   * Attempt a skill check bypass. Rolls 1d10, reads actor stats,
   * and delegates to NetworkService.authenticateSkillCheck().
   *
   * Phase 4: If SkillService is available, delegates stat+skill resolution
   * to it instead of manual item lookup.
   */
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

    // Check lockout before rolling
    if (this.securityService?.isLockedOut(actor.id, this.networkId)) {
      this._errorMessage = 'SYSTEM LOCKED — Too many failed attempts.';
      this.soundService?.play('lockout');
      this.render();
      return;
    }

    const dc = this.network.security.bypassDC ?? 15;
    const roll = new Roll('1d10');
    await roll.evaluate();

    // Resolve stat + skill bonuses (Phase 4 SkillService → manual fallback)
    const { statBonus, skillBonus } = this._resolveSkillBonuses(actor, skillName);
    const total = roll.total + skillBonus + statBonus;

    // Critical handling (CPR: 10 = crit success, 1 = crit failure on d10)
    const isCritSuccess = roll.total === 10;
    const isCritFailure = roll.total === 1;
    let critLabel = '';
    if (isCritSuccess) critLabel = ' — <span style="color:#00ff41;">CRITICAL SUCCESS</span>';
    if (isCritFailure) critLabel = ' — <span style="color:#ff0033;">CRITICAL FAILURE</span>';

    // Show the roll in chat
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: `<strong>Network Bypass: ${this.network.name}</strong><br>
               ${skillName} vs DV ${dc}${critLabel}<br>
               Roll: ${roll.total} + Skill: ${skillBonus} + Stat: ${statBonus} = <strong>${total}</strong>`,
    });

    // NetworkService.authenticateSkillCheck handles sound internally
    const authResult = this.networkService.authenticateSkillCheck(this.networkId, total, skillName);

    if (authResult.success) {
      this.securityService?.recordSuccess(actor.id, this.networkId);
      this._errorMessage = '';
      if (this._resolve) {
        this._resolve({ success: true, method: 'skill', skillName, total, isCritSuccess });
        this._resolve = null;
      }
      this.close();
    } else {
      const { lockedOut } = this.securityService?.recordFailedAttempt(actor.id, this.networkId) ?? {};
      if (lockedOut) {
        this._errorMessage = 'SYSTEM LOCKED — Too many failed attempts.';
        this.soundService?.play('lockout');
      } else {
        const remaining = this.securityService?.getRemainingAttempts(actor.id, this.networkId) ?? '?';
        this._errorMessage = `ACCESS DENIED — ${skillName} check failed (${total} vs DV ${dc}). ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`;
      }
      this.render();
    }
  }

  /**
   * Toggle password field visibility between password/text.
   */
  static _onTogglePasswordVisibility(event, target) {
    const input = this.element.querySelector('.ncm-auth__password-input');
    if (!input) return;

    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';

    // Swap icon
    const icon = target.querySelector('i');
    if (icon) {
      icon.classList.toggle('fa-eye', !isPassword);
      icon.classList.toggle('fa-eye-slash', isPassword);
    }
  }

  /**
   * GM bypass — skip auth entirely and grant network access.
   */
  static _onGMBypass(event, target) {
    if (!game.user?.isGM) return;

    // Grant actual auth so the subsequent network switch succeeds
    this.networkService?.grantAuth?.(this.networkId);

    if (this._resolve) {
      this._resolve({ success: true, method: 'gm_bypass' });
      this._resolve = null;
    }
    this.close();
  }

  /**
   * Switch between password and skill check modes.
   * Preserves attempt count — mode switch doesn't reset attempts.
   */
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

  // ═══════════════════════════════════════════════════════════
  //  Skill Resolution
  // ═══════════════════════════════════════════════════════════

  /**
   * Build the skill breakdown object for the template display panel.
   * Attempts Phase 4 SkillService first, falls back to manual CPR lookup.
   * @param {object} network - Full network object
   * @returns {object|null} { statName, statValue, skillName, skillValue, total, needed }
   */
  _buildSkillBreakdown(network) {
    const actor = game.user?.character;
    const primarySkill = network.security.bypassSkills?.[0];
    if (!actor || !primarySkill) return null;

    // Phase 4: Use SkillService if available
    if (this.skillService?.getSkillBreakdown) {
      try {
        const breakdown = this.skillService.getSkillBreakdown(actor, primarySkill);
        if (breakdown) {
          const dc = network.security.bypassDC ?? 15;
          const total = (breakdown.statValue ?? 0) + (breakdown.skillValue ?? 0);
          return {
            statName: breakdown.statName ?? 'INT',
            statValue: breakdown.statValue ?? 0,
            skillName: primarySkill,
            skillValue: breakdown.skillValue ?? 0,
            total,
            needed: Math.max(1, dc - total),
          };
        }
      } catch (err) {
        log.debug('SkillService.getSkillBreakdown failed, falling back to manual lookup', err);
      }
    }

    // Fallback: Manual CPR system lookup
    return this._manualSkillBreakdown(actor, primarySkill, network);
  }

  /**
   * Manual stat + skill lookup for CPR system actors.
   * @param {Actor} actor
   * @param {string} skillName
   * @param {object} network
   * @returns {object}
   */
  _manualSkillBreakdown(actor, skillName, network) {
    const statName = 'INT';
    const statValue = actor.system?.stats?.int?.value ?? 0;

    let skillValue = 0;
    const skillKey = skillName.toLowerCase().replace(/\s+/g, '');

    // Try direct skills object first
    if (actor.system?.skills?.[skillKey]?.level !== undefined) {
      skillValue = actor.system.skills[skillKey].level;
    } else {
      // CPR: Skills can also be items on the actor
      try {
        const skillItem = actor.items?.find(i =>
          i.type === 'skill' && i.name.toLowerCase() === skillName.toLowerCase()
        );
        if (skillItem) {
          skillValue = skillItem.system?.level ?? 0;
        }
      } catch {
        log.debug(`Could not read skill "${skillName}" from actor — showing base values`);
      }
    }

    const total = statValue + skillValue;
    const dc = network.security.bypassDC ?? 15;
    return { statName, statValue, skillName, skillValue, total, needed: Math.max(1, dc - total) };
  }

  /**
   * Resolve stat + skill bonuses for the actual dice roll.
   * Phase 4: delegates to SkillService if available.
   * @param {Actor} actor
   * @param {string} skillName
   * @returns {{ statBonus: number, skillBonus: number }}
   */
  _resolveSkillBonuses(actor, skillName) {
    // Phase 4: Use SkillService if available
    if (this.skillService?.resolveSkillBonuses) {
      try {
        const result = this.skillService.resolveSkillBonuses(actor, skillName);
        if (result) return result;
      } catch (err) {
        log.debug('SkillService.resolveSkillBonuses failed, falling back to manual lookup', err);
      }
    }

    // Fallback: Manual CPR lookup
    let skillBonus = 0;
    let statBonus = 0;
    try {
      const skillItem = actor.items?.find(i =>
        i.type === 'skill' && i.name.toLowerCase() === skillName.toLowerCase()
      );
      if (skillItem) {
        skillBonus = skillItem.system?.level ?? 0;
        const statName = skillItem.system?.stat;
        if (statName && actor.system?.stats?.[statName]) {
          statBonus = actor.system.stats[statName]?.value ?? 0;
        }
      }
    } catch {
      log.debug(`Could not read skill "${skillName}" from actor — using raw roll`);
    }

    return { statBonus, skillBonus };
  }

  // ═══════════════════════════════════════════════════════════
  //  Lockout Countdown
  // ═══════════════════════════════════════════════════════════

  /**
   * Start a live countdown that updates the lockout timer element every second.
   * When the timer reaches 0, re-renders to exit lockout state.
   */
  _startLockoutCountdown() {
    this._clearLockoutTimer();

    const actorId = game.user?.character?.id;
    if (!actorId) return;

    this._lockoutTimerId = setInterval(() => {
      const remaining = this.securityService?.getLockoutRemaining(actorId, this.networkId) ?? 0;

      if (remaining <= 0) {
        // Lockout expired — re-render to show normal auth state
        this._clearLockoutTimer();
        this._errorMessage = '';
        this.render();
        return;
      }

      // Update the timer element in-place to avoid full re-render flicker
      const timerEl = this.element?.querySelector('.ncm-auth__lockout-timer');
      if (timerEl) {
        timerEl.textContent = this._formatDuration(remaining);
      }
    }, 1000);
  }

  /** Clear the lockout countdown interval. */
  _clearLockoutTimer() {
    if (this._lockoutTimerId !== null) {
      clearInterval(this._lockoutTimerId);
      this._lockoutTimerId = null;
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Keydown Binding
  // ═══════════════════════════════════════════════════════════

  /** Remove the Enter key listener from the password input. */
  _unbindKeydown() {
    if (this._keydownHandler) {
      const input = this.element?.querySelector('.ncm-auth__password-input');
      input?.removeEventListener('keydown', this._keydownHandler);
      this._keydownHandler = null;
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Helpers
  // ═══════════════════════════════════════════════════════════

  /**
   * Format a duration in ms to MM:SS (or H:MM:SS for longer lockouts).
   * @param {number} ms
   * @returns {string}
   */
  _formatDuration(ms) {
    if (ms <= 0) return '0:00';
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }
}