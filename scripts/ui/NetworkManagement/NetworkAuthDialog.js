/**
 * NetworkAuthDialog
 * @file scripts/ui/NetworkManagement/NetworkAuthDialog.js
 * @module night-city-messenger
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

import { MODULE_ID, EVENTS, TEMPLATES, SKILL_MAP } from '../../utils/constants.js';
import { log, resolveOperator, guardSecretInputs } from '../../utils/helpers.js';
import { BaseApplication } from '../BaseApplication.js';
import { showNamePicker, documentEntries, isCarrier } from '../../utils/namePicker.js';
import { NetworkAuthAdapter, TerminalAuthAdapter } from './SecurityAuthAdapters.js';

export class NetworkAuthDialog extends BaseApplication {

  /**
   * @type {string} SecurityService target key. A network id, or a terminal
   * `terminalId::accountId`. (Named `networkId` for back-compat — it is the
   * key SecurityService tracks lockout/attempts under.)
   */
  networkId = null;

  /** @type {object} Source-shaped object { id, name, type, theme, description, security } */
  network = null;

  /**
   * @type {import('./SecurityAuthAdapters.js').NetworkAuthAdapter} Source
   * adapter — abstracts refresh / checkPassword / checkSkill / grant so the
   * dialog serves networks AND terminal accounts. Defaults to a network
   * adapter (existing behavior byte-identical).
   */
  _adapter = null;

  /** @type {Function|null} Resolve callback for the promise returned by show() */
  _resolve = null;

  /** @type {string} Current auth mode: 'password' | 'skill' */
  _authMode = 'password';

  /** @type {Set<string>} Completed method names: 'password', 'skill', 'keyitem' */
  _completedMethods = new Set();

  /** @type {string} Error message to display */
  _errorMessage = '';

  /** @type {number|null} setInterval ID for live lockout countdown */
  _lockoutTimerId = null;

  /** @type {Function|null} Bound keydown handler for cleanup */
  _keydownHandler = null;

  // ─── Service Accessors ───

  get networkService() { return game.nightcity?.networkService; }
  get securityService() { return game.nightcity?.securityService; }
  get iceService() { return game.nightcity?.iceService; }
  get dataShardService() { return game.nightcity?.dataShardService; }

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
      browseKeyItem: NetworkAuthDialog._onBrowseKeyItem,
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
      dialog._adapter = new NetworkAuthAdapter(networkId);
      dialog.networkId = networkId;
      dialog.network = network;
      dialog._resolve = resolve;

      const hasPassword = network.security.allowPassword ?? !!network.security.password;
      const hasSkillBypass = (network.security.allowSkillCheck ?? false) && network.security.bypassSkills?.length > 0;
      dialog._authMode = hasPassword ? 'password' : (hasSkillBypass ? 'skill' : 'password');

      dialog.render(true);
    });
  }

  /**
   * Show the method-card auth dialog for a TERMINAL account — the same
   * strict-AND/OR / lockout / ICE UI networks use. Resolves with
   * { success, method } like {@link show}; the caller (TerminalViewerApp)
   * runs the actual login on success.
   * @param {Item} item @param {string} accountId
   * @returns {Promise<{ success: boolean, method?: string }>}
   */
  static async showForAccount(item, accountId) {
    const adapter = new TerminalAuthAdapter(item, accountId);
    const source = adapter.refresh();
    if (!source) {
      ui.notifications.error('NCM | Unknown account.');
      return { success: false };
    }

    return new Promise((resolve) => {
      const dialog = new NetworkAuthDialog();
      dialog._adapter = adapter;
      dialog.networkId = adapter.targetId;   // SecurityService key
      dialog.network = source;
      dialog._resolve = resolve;

      const sec = source.security;
      const hasPassword = sec.allowPassword ?? !!sec.password;
      const hasSkillBypass = (sec.allowSkillCheck ?? false) && sec.bypassSkills?.length > 0;
      dialog._authMode = hasPassword ? 'password' : (hasSkillBypass ? 'skill' : 'password');

      dialog.render(true);
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  Data Preparation
  // ═══════════════════════════════════════════════════════════

  async _prepareContext(options) {
    // Always re-fetch from the source (network / terminal account) to get the
    // latest data (e.g. after a GM saves the config mid-dialog).
    const freshNetwork = this._adapter?.refresh();
    if (freshNetwork) this.network = freshNetwork;
    const network = this.network;
    if (!network) return {};

    const hasPassword = network.security.allowPassword ?? !!network.security.password;
    const hasSkillBypass = (network.security.allowSkillCheck ?? false) && network.security.bypassSkills?.length > 0;
    const hasKeyItem = (network.security.allowKeyItem ?? false) && !!(network.security.keyItemName || network.security.keyItemTag);

    // Derive maxAttempts early — needed for pip computation below
    const maxAttempts = network.security.maxAttempts ?? 3;

    // Get lockout status for current actor
    const actorId = resolveOperator()?.id;
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
      terminal: 'Terminal Account',
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

    // --- Skill Breakdown (when skill bypass is available) ---
    let skillBreakdown = null;
    if (hasSkillBypass) {
      skillBreakdown = this._buildSkillBreakdown(network);
    }

    // --- Auth logic and completion state ---
    const authLogic = network.security.authLogic ?? 'any';
    const isAndMode = authLogic === 'all';

    // Debug: trace what the dialog reads
    console.log(`NCM | Auth dialog — network: ${network.name}, authLogic: "${authLogic}", security:`, JSON.stringify(network.security));

    const passwordCompleted = this._completedMethods.has('password');
    const skillCompleted = this._completedMethods.has('skill');
    const keyItemCompleted = this._completedMethods.has('keyitem');

    // Build logic description for the player
    let logicDescription = '';
    const enabledMethods = [];
    if (hasPassword) enabledMethods.push('Password');
    if (hasSkillBypass) enabledMethods.push('Skill Check');
    if (hasKeyItem) enabledMethods.push('Key Item');
    if (isAndMode) {
      logicDescription = enabledMethods.join(' AND ');
    } else {
      logicDescription = enabledMethods.join(' OR ');
    }

    // --- Black ICE (lethal countermeasures) — lifted up so skill rows can warn ---
    const isLethalICE = this.iceService?.isLethalICE(network.security) ?? false;
    const iceInfo = isLethalICE ? this.iceService.resolveICE(network.security) : null;
    const iceDealsDamage = network.security.failureMode === 'damage';
    const skillDanger = (isLethalICE && iceDealsDamage && iceInfo?.formula)
      ? `${iceInfo.formula} to HP`
      : '';

    // --- Method numbering, progress + active card (method-card redesign) ---
    const methodOrder = [];
    if (hasPassword) methodOrder.push('password');
    if (hasSkillBypass) methodOrder.push('skill');
    if (hasKeyItem) methodOrder.push('keyitem');
    const methodsTotal = methodOrder.length;
    const completionMap = { password: passwordCompleted, skill: skillCompleted, keyitem: keyItemCompleted };
    const completedCount = methodOrder.filter(m => completionMap[m]).length;
    const allComplete = methodsTotal > 0 && completedCount >= methodsTotal;
    // AND-mode progress label + the first not-yet-completed method (the "active" card)
    const progressLabel = allComplete ? 'Complete' : `Step ${completedCount + 1} of ${methodsTotal}`;
    const activeMethod = isAndMode ? (methodOrder.find(m => !completionMap[m]) ?? null) : null;
    // Per-method display numbers (1-based, display order) — surfaced only in AND mode
    const passwordNum = hasPassword ? methodOrder.indexOf('password') + 1 : 0;
    const skillNum = hasSkillBypass ? methodOrder.indexOf('skill') + 1 : 0;
    const keyItemNum = hasKeyItem ? methodOrder.indexOf('keyitem') + 1 : 0;
    // OR dividers render only in OR mode, between consecutive method cards
    const showOrBeforeSkill = !isAndMode && hasSkillBypass && hasPassword;
    const showOrBeforeKeyItem = !isAndMode && hasKeyItem && (hasPassword || hasSkillBypass);
    // Policy banner is only meaningful when more than one method is offered
    const showPolicy = methodsTotal > 1;

    // The breakdown grid represents one skill — only accurate (non-confusing)
    // when there's a single bypass skill; multi-skill networks show per-row values.
    const showBreakdownGrid = !!skillBreakdown && (network.security.bypassSkills?.length ?? 0) <= 1;

    return {
      network: {
        id: network.id,
        name: network.name,
        type: network.type,
        icon: network.theme?.icon ?? 'fa-wifi',
        color: network.theme?.color ?? '#19f3f7',
        theme: network.theme || {},
        securityLevel: network.security.level,
        description: network.description,
        typeLabel: networkTypeLabel,
        securityTagClass,
      },

      hasPassword,
      hasSkillBypass,
      hasKeyItem,
      authLogic,
      isAndMode,
      logicDescription,

      // method-card redesign: numbering, progress, active card, OR dividers
      methodsTotal,
      completedCount,
      allComplete,
      progressLabel,
      showPolicy,
      passwordActive: activeMethod === 'password',
      skillActive: activeMethod === 'skill',
      keyItemActive: activeMethod === 'keyitem',
      passwordNum,
      skillNum,
      keyItemNum,
      showOrBeforeSkill,
      showOrBeforeKeyItem,
      showBreakdownGrid,

      passwordCompleted,
      skillCompleted,
      keyItemCompleted,

      keyItemName: network.security.keyItemName ?? '',
      keyItemTag: network.security.keyItemTag ?? '',
      presentedItemName: this._presentedItemName ?? null,
      presentedItemImg: this._presentedItemImg ?? null,
      keyItemError: this._keyItemError ?? null,

      bypassSkills: (network.security.bypassSkills ?? []).map(skill => {
        const bd = this._breakdownForSkill(network, skill);
        return {
          // Canonical skill name (matches the actor's Item) for display AND the
          // data-skill the roll fires with — falls back to the raw config name.
          name: bd?.skillName ?? skill,
          dc: network.security.bypassDC ?? 15,
          danger: skillDanger,
          // Per-skill resolved values so each row shows the character's own level
          statName: bd?.statName ?? 'INT',
          statValue: bd?.statValue ?? 0,
          skillValue: bd?.skillValue ?? 0,
          total: bd?.total ?? 0,
        };
      }),
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

      // ICE info (computed above so skill rows can carry the HP-damage warning)
      isLethalICE,
      iceInfo,
      iceDealsDamage,
      networkEncryptionType: network.security.encryptionType || 'ICE',
      networkFailureMode: network.security.failureMode || 'lockout',

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
    guardSecretInputs(this.element); // read-only until touched — no browser autofill
    super._onRender?.(context, options);

    // Set auth state attribute for CSS accent bar color
    if (context.isLockedOut) {
      this.element.dataset.authState = 'lockout';
    } else if (context.isLethalICE) {
      // Lethal ICE present — red bar reads the danger at a glance
      this.element.dataset.authState = 'ice';
    } else if (context.hasKeyItem && !context.hasPassword && !context.hasSkillBypass) {
      this.element.dataset.authState = 'keyitem';
    } else if (context.hasSkillBypass && !context.hasPassword) {
      this.element.dataset.authState = 'skill';
    } else {
      this.element.dataset.authState = 'password';
    }

    // ── Enter key submission for password field (always when present) ──
    this._unbindKeydown();
    if (context.hasPassword && !context.isLockedOut) {
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
    const passwordInput = this.element.querySelector('[name="ncm-net-key"]');
    const password = passwordInput?.value ?? '';

    if (!password.trim()) {
      this._errorMessage = 'Enter a password.';
      this.render();
      return;
    }

    // Init security tracking
    const actorId = resolveOperator()?.id;
    if (actorId) {
      this.securityService?.initTracking(actorId, this.networkId, {
        maxAttempts: this.network.security.maxAttempts ?? 3,
        lockoutDuration: this.network.security.lockoutDuration ?? 3600000,
      });
    }

    // The adapter checks the password (network service or terminal account);
    // it owns the success/fail sound.
    const result = this._adapter.checkPassword(password);

    if (result.success) {
      if (actorId) this.securityService?.recordSuccess(actorId, this.networkId);

      this._errorMessage = '';
      this._completedMethods.add('password');
      game.nightcity?.traceService?.logSuccess({ actor: actorId ? game.actors?.get(actorId) : null, action: 'net-auth', objectName: this.network?.name || 'Network', targetKind: 'network', targetNetworkId: this.networkId, severity: 'major' });

      // Check if all required methods are now complete
      if (this._checkAuthComplete()) return;

      // Not fully done yet (AND mode) — re-render to show completion badge
      this.render();
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
      // Trace funnel (§6a) — failed network password auth.
      game.nightcity?.traceService?.fireTrace({ actor: actorId ? game.actors?.get(actorId) : null, action: 'net-auth', objectName: this.network?.name || 'Network', targetKind: 'network', targetNetworkId: this.networkId, severity: 'major' });
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

    const actor = resolveOperator();
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

    // Roll through SkillService.performCheck — the canonical CPR path (the SAME
    // one shard hacking / ICE breach use). It resolves stat + skill correctly,
    // handles crit/fumble + Luck, and posts the skill-check ("network bypass")
    // chat card. Falls back to a manual d10 only if the service is unavailable.
    let total;
    const svc = this.skillService;
    if (svc?.performCheck) {
      const rollResult = await svc.performCheck(actor, skillName, {
        dc,
        showChat: true,
        context: `Network Bypass: ${this.network.name || 'Network'}`,
        flavor: `${this.network.security.encryptionType || 'ICE'} // DV ${dc}`,
      });
      total = rollResult.total;
    } else {
      const roll = new Roll('1d10');
      await roll.evaluate();
      const { statBonus, skillBonus } = this._resolveSkillBonuses(actor, skillName);
      total = roll.total + skillBonus + statBonus;
      await roll.toMessage({
        speaker: ChatMessage.getSpeaker({ actor }),
        flavor: `<strong>Network Bypass: ${this.network.name}</strong><br>
                 ${skillName} vs DV ${dc}<br>
                 Total: <strong>${total}</strong>`,
      });
    }

    // The adapter checks the roll total vs the bypass DV; it owns the sound.
    const authResult = this._adapter.checkSkill(total, skillName);

    if (authResult.success) {
      this.securityService?.recordSuccess(actor.id, this.networkId);
      this._errorMessage = '';
      this._completedMethods.add('skill');
      game.nightcity?.traceService?.logSuccess({ actor, action: 'net-hack', objectName: this.network?.name || 'Network', targetKind: 'network', targetNetworkId: this.networkId, dv: dc, margin: (total != null && dc != null) ? total - dc : null, severity: 'major' });

      // Check if all required methods are now complete
      if (this._checkAuthComplete()) return;

      // Not fully done yet (AND mode) — re-render to show completion badge
      this.render();
    } else {
      const { lockedOut } = this.securityService?.recordFailedAttempt(actor.id, this.networkId) ?? {};

      // ─── ICE Damage on failure ───
      const sec = this.network.security;
      const isLethal = this.iceService?.isLethalICE(sec);
      if (isLethal && sec.failureMode === 'damage' && this.iceService) {
        const damageResult = await this.iceService.applyDamage(actor, sec, {
          context: 'network',
          targetName: this.network.name || 'Network',
        });
        if (damageResult.damage > 0) {
          const iceName = damageResult.iceInfo?.name || 'BLACK ICE';
          ui.notifications.error(`NCM | ${iceName} deals ${damageResult.damage} HP damage to ${actor.name}!`);
        }
      }

      if (lockedOut) {
        this._errorMessage = 'SYSTEM LOCKED — Too many failed attempts.';
        this.soundService?.play('lockout');
      } else {
        const remaining = this.securityService?.getRemainingAttempts(actor.id, this.networkId) ?? '?';
        this._errorMessage = `ACCESS DENIED — ${skillName} check failed (${total} vs DV ${dc}). ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`;
      }
      // Trace funnel (§6a) — failed network skill-bypass (carries ICE).
      game.nightcity?.traceService?.fireTrace({ actor, action: 'net-hack', objectName: this.network?.name || 'Network', targetKind: 'network', targetNetworkId: this.networkId, dv: dc, margin: (total != null && dc != null) ? total - dc : null, severity: 'hostile' });
      this.render();
    }
  }

  /**
   * Toggle password field visibility between password/text.
   */
  static _onTogglePasswordVisibility(event, target) {
    const input = this.element.querySelector('.ncm-auth__password-input');
    if (!input) return;

    // The field is a shadowed text input (helpers.shadowSecretInput): the DOM shows
    // bullets and the real text lives in script, so "show" flips the shadow's mask.
    let isPassword;
    if (input.ncmSetMasked) {
      isPassword = input.dataset.ncmUnmasked !== '1';
      input.ncmSetMasked(!isPassword);
      input.dataset.ncmUnmasked = isPassword ? '1' : '';
    } else {
      isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';
    }

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

    // Grant actual auth so the subsequent switch/login succeeds (network:
    // marks authenticated; terminal: no-op — resolve drives the login).
    this._adapter?.grant();

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
  //  Key Item Handlers
  // ═══════════════════════════════════════════════════════════

  /**
   * Browse the operator's inventory for the credential — the shared picker on
   * the PLAYER theme, chips per item type. (Replaced itemPicker.js, which painted
   * literal brand hex from an inline <style> and rebuilt the list per keystroke.)
   */
  static async _onBrowseKeyItem(event, target) {
    const actor = resolveOperator();
    if (!actor) {
      ui.notifications.warn('NCM | No character assigned.');
      return;
    }
    const keyItemName = this.network?.security?.keyItemName || 'access credential';
    const items = (actor.items?.contents ?? []).filter(isCarrier);
    if (!items.length) {
      ui.notifications.warn('NCM | No items in inventory.');
      return;
    }
    const pick = await showNamePicker({
      admin: false,
      title: 'Present Access Credential',
      hint: `Select an item to present as "${keyItemName}".`,
      entries: documentEntries(items, { group: 'type', note: (i) => i.type }),
      placeholder: 'search your inventory…',
    });
    const item = pick?.id ? actor.items.get(pick.id) : null;
    if (item) this._processKeyItem(item);
  }

  /**
   * Process a presented key item — check against network requirements.
   * @param {Item} item
   */
  _processKeyItem(item) {
    const network = this._adapter?.refresh() ?? this.network;
    const sec = network?.security;
    if (!sec) return;

    const keyItemName = (sec.keyItemName || '').toLowerCase().trim();
    const keyItemTag = (sec.keyItemTag || '').toLowerCase().trim();
    const itemName = (item.name || '').toLowerCase().trim();
    const itemTag = (item.system?.tag || item.flags?.tag || '').toLowerCase().trim();

    // Check match
    let matched = false;
    if (keyItemTag && itemTag === keyItemTag) matched = true;
    if (keyItemName && itemName === keyItemName) matched = true;

    if (matched) {
      // Success — consume if configured
      if (sec.keyItemConsume && item.actor) {
        item.actor.deleteEmbeddedDocuments('Item', [item.id]).catch(err => {
          console.warn('NCM | Failed to consume key item:', err);
        });
      }

      this.soundService?.play('key-accepted');
      this._completedMethods.add('keyitem');
      this._keyItemError = null;
      this._presentedItemName = item.name;
      this._presentedItemImg = item.img;

      // Check if all required methods are now complete
      if (this._checkAuthComplete()) return;

      // Not fully done yet (AND mode) — re-render to show completion badge
      this.render();
    } else {
      // Wrong item
      this._presentedItemName = item.name;
      this._presentedItemImg = item.img;
      this._keyItemError = `"${item.name}" is not a valid access credential for ${network.name}.`;
      this.soundService?.play('key-rejected');
      this.render();
    }
  }

  /**
   * Check if all required auth methods are completed.
   * - 'any' mode: any single completion resolves.
   * - 'all' mode: all enabled non-keyitem methods must be completed.
   *   Key item always bypasses (handled in _processKeyItem directly).
   * @returns {boolean} true if auth is complete and dialog was closed
   */
  _checkAuthComplete() {
    // Re-read from the source to ensure the latest saved config
    const network = this._adapter?.refresh() ?? this.network;
    const sec = network?.security;
    const authLogic = sec?.authLogic ?? 'any';

    if (authLogic === 'any') {
      // Any single method completing is enough
      this._adapter?.grant();
      if (this._resolve) {
        const methods = [...this._completedMethods].join('+');
        this._resolve({ success: true, method: methods });
        this._resolve = null;
      }
      this.close();
      return true;
    }

    // AND mode: check ALL enabled methods
    const needPassword = !!(sec?.allowPassword);
    const needSkill = !!(sec?.allowSkillCheck) && (sec?.bypassSkills?.length > 0);
    const needKeyItem = !!(sec?.allowKeyItem) && !!(sec?.keyItemName || sec?.keyItemTag);

    const passwordDone = !needPassword || this._completedMethods.has('password');
    const skillDone = !needSkill || this._completedMethods.has('skill');
    const keyItemDone = !needKeyItem || this._completedMethods.has('keyitem');

    if (passwordDone && skillDone && keyItemDone) {
      // All required methods completed
      this._adapter?.grant();
      if (this._resolve) {
        const methods = [...this._completedMethods].join('+');
        this._resolve({ success: true, method: methods });
        this._resolve = null;
      }
      this.close();
      return true;
    }

    // Not done yet
    return false;
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
    const primarySkill = network.security.bypassSkills?.[0];
    if (!primarySkill) return null;
    return this._breakdownForSkill(network, primarySkill);
  }

  /**
   * Canonicalize a configured bypass-skill name to the actor's actual skill
   * Item name using punctuation/space-insensitive matching. Networks store
   * names like "Electronics/SecurityTech" / "BasicTech" while CPR skill Items
   * are "Electronics/Security Tech" / "Basic Tech" — without this the exact
   * lookup misses and the skill level resolves to 0. Returns the matched Item
   * name (so display + roll + chat all use the real name), or the raw name
   * unchanged when nothing matches.
   * @param {Actor} actor
   * @param {string} rawName
   * @returns {string}
   */
  _resolveSkillName(actor, rawName) {
    if (!actor || !rawName) return rawName;
    const norm = (s) => String(s).toLowerCase().replace(/[\s_/\\&.-]+/g, '');
    const target = norm(rawName);
    const match = (actor.items ?? []).find(i =>
      i.type === 'skill' && norm(i.name) === target
    );
    return match ? match.name : rawName;
  }

  /**
   * Resolve a stat+skill breakdown for an arbitrary bypass skill so each
   * skill row can show the character's actual level in *that* skill (not
   * just the primary). SkillService first, manual CPR lookup as fallback.
   * @param {object} network
   * @param {string} skillName
   * @returns {object|null} { statName, statValue, skillName, skillValue, total, needed }
   */
  _breakdownForSkill(network, skillName) {
    const actor = resolveOperator();
    if (!actor || !skillName) return null;
    const dc = network.security.bypassDC ?? 15;

    // Canonicalize to the actor's real skill name (handles missing spaces etc.)
    skillName = this._resolveSkillName(actor, skillName);

    // SkillService.getSkillData is the canonical CPR resolver — the SAME path
    // shard hacking uses. It reads the skill Item's level + linked stat and
    // resolves the stat value from actor.system.stats. (The old code called
    // getSkillBreakdown/resolveSkillBonuses, which don't exist, so it always
    // silently fell back to the buggy manual lookup below.)
    const svc = this.skillService;
    if (svc?.getSkillData) {
      try {
        const d = svc.getSkillData(actor, skillName);
        // Diagnostic: when the skill can't be matched on the actor, surface the
        // requested name vs. the actor's actual skill items (debugMode only).
        if (!d.found) {
          const owned = (actor.items ?? []).filter(i => i.type === 'skill').map(i => i.name);
          log.debug(`Network bypass: skill "${skillName}" not found on ${actor.name}. ` +
            `Actor skills: ${owned.join(', ') || '(none)'}`);
        }
        const statValue = d.statValue ?? 0;
        const skillValue = d.skillLevel ?? 0;
        const total = statValue + skillValue;
        return {
          statName: (d.statName || 'int').toUpperCase(),
          statValue,
          skillName,
          skillValue,
          total,
          needed: Math.max(1, dc - total),
        };
      } catch (err) {
        log.debug('SkillService.getSkillData failed, falling back to manual lookup', err);
      }
    }

    // Fallback: Manual CPR system lookup
    return this._manualSkillBreakdown(actor, skillName, network);
  }

  /**
   * Manual stat + skill lookup for CPR system actors.
   * @param {Actor} actor
   * @param {string} skillName
   * @param {object} network
   * @returns {object}
   */
  _manualSkillBreakdown(actor, skillName, network) {
    const dc = network.security.bypassDC ?? 15;
    const wanted = (skillName || '').toLowerCase().trim();

    let skillValue = 0;
    let statKey = null;

    // CPR: skills are embedded Items of type 'skill' (level + linked stat)
    try {
      const skillItem = actor.items?.find(i =>
        i.type === 'skill' && (i.name || '').toLowerCase().trim() === wanted
      );
      if (skillItem) {
        skillValue = skillItem.system?.level ?? skillItem.system?.value ?? 0;
        if (skillItem.system?.stat) statKey = String(skillItem.system.stat).toLowerCase();
      }
    } catch (err) {
      log.debug(`Could not read skill "${skillName}" from actor: ${err?.message}`);
    }

    // Resolve the linked stat via SKILL_MAP when the skill Item wasn't matched,
    // so the STAT bonus is never silently dropped (the old code only read the
    // stat inside the `if (skillItem)` branch → 0 when the lookup missed).
    if (!statKey) {
      const mapEntry = SKILL_MAP[skillName] ?? SKILL_MAP[(skillName || '').trim()];
      statKey = (mapEntry?.stat || 'int').toLowerCase();
    }

    const statBlock = actor.system?.stats?.[statKey];
    const statValue = (typeof statBlock === 'object' ? statBlock?.value : statBlock) ?? 0;
    const total = statValue + skillValue;
    return { statName: statKey.toUpperCase(), statValue, skillName, skillValue, total, needed: Math.max(1, dc - total) };
  }

  /**
   * Resolve stat + skill bonuses for the actual dice roll.
   * Phase 4: delegates to SkillService if available.
   * @param {Actor} actor
   * @param {string} skillName
   * @returns {{ statBonus: number, skillBonus: number }}
   */
  _resolveSkillBonuses(actor, skillName) {
    // Use the SAME resolver as the displayed breakdown so the roll total can
    // never disagree with what the player was shown. Routes through
    // SkillService.getSkillData first, hardened manual lookup as fallback.
    const bd = this._breakdownForSkill(this.network, skillName);
    return { statBonus: bd?.statValue ?? 0, skillBonus: bd?.skillValue ?? 0 };
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

    const actorId = resolveOperator()?.id;
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