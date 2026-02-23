/**
 * ItemInboxApp — Data Shard Viewer
 * @file scripts/ui/ItemInbox/ItemInboxApp.js
 * @module cyberpunkred-messenger
 * @description Shard viewer with layered security overlays, message list,
 *              hacking sequence, and GM override controls.
 *              Extends BaseApplication (ApplicationV2 + HandlebarsApplicationMixin).
 */

import { MODULE_ID, EVENTS, TEMPLATES, DEFAULTS, THEME_PRESETS, ENCRYPTION_TYPES, FAILURE_MODES } from '../../utils/constants.js';
import { log, isGM, formatCyberDate } from '../../utils/helpers.js';
import { BaseApplication } from '../BaseApplication.js';

/** Shard visual theme definitions */
const SHARD_THEMES = {
  classic:     { label: 'Default',      accent: 'var(--ncm-color-primary)',   headerBg: 'var(--ncm-bg-surface)',  icon: 'fa-microchip' },
  arasaka:     { label: 'Arasaka',      accent: '#ff0033',                    headerBg: '#1a0000',               icon: 'fa-building' },
  militech:    { label: 'Militech',     accent: '#3388ff',                    headerBg: '#000a1a',               icon: 'fa-shield-halved' },
  biotechnica: { label: 'Biotechnica',  accent: '#00cc88',                    headerBg: '#001a0f',               icon: 'fa-dna' },
  'kang-tao':  { label: 'Kang Tao',    accent: '#ffaa00',                    headerBg: '#1a1000',               icon: 'fa-yin-yang' },
  'trauma-team':{ label: 'Trauma Team', accent: '#ff3366',                    headerBg: '#1a000a',               icon: 'fa-heart-pulse' },
  darknet:     { label: 'Darknet',      accent: '#00ff41',                    headerBg: '#000800',               icon: 'fa-ghost' },
  netwatch:    { label: 'NetWatch',     accent: '#ff8800',                    headerBg: '#0a0a1a',               icon: 'fa-eye' },
};

export class ItemInboxApp extends BaseApplication {

  // ─── Instance State ───

  /** @type {Item|null} The data shard item */
  item = null;

  /** @type {string|null} Selected message ID within the shard */
  selectedMessageId = null;

  /** @type {boolean} Whether hacking sequence is active */
  _hackingActive = false;

  /** @type {string|null} Skill currently being used for hack */
  _hackingSkill = null;

  // ─── Service Accessors ───

  get dataShardService() { return game.nightcity?.dataShardService; }
  get skillService() { return game.nightcity?.skillService; }
  get networkService() { return game.nightcity?.networkService; }
  get securityService() { return game.nightcity?.securityService; }

  // ─── ApplicationV2 Configuration ───

  static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
    id: 'ncm-item-inbox',
    classes: ['ncm-app', 'ncm-item-inbox'],
    window: {
      title: 'NCM.DataShard.Title',
      icon: 'fas fa-microchip',
      resizable: true,
      minimizable: true,
    },
    position: {
      width: 650,
      height: 550,
    },
    actions: {
      selectMessage: ItemInboxApp._onSelectMessage,
      attemptBreach: ItemInboxApp._onAttemptBreach,
      selectSkill: ItemInboxApp._onSelectSkill,
      spendLuck: ItemInboxApp._onSpendLuck,
      presentKeyItem: ItemInboxApp._onPresentKeyItem,
      submitLogin: ItemInboxApp._onSubmitLogin,
      forceDecrypt: ItemInboxApp._onForceDecrypt,
      relockShard: ItemInboxApp._onRelockShard,
      openConfig: ItemInboxApp._onOpenConfig,
      addMessage: ItemInboxApp._onAddMessage,
      removeMessage: ItemInboxApp._onRemoveMessage,
      decryptMessage: ItemInboxApp._onDecryptMessage,
    },
  }, { inplace: false });

  static PARTS = {
    main: {
      template: TEMPLATES.ITEM_INBOX,
    },
  };

  // ─── Constructor ───

  constructor(options = {}) {
    super(options);
    if (options.item) {
      this.item = options.item;
    }
  }

  /** Override window title */
  get title() {
    return this.item ? `DATA SHARD: ${this.item.name}` : 'DATA SHARD';
  }

  // ─── Data Preparation ───

  async _prepareContext(options) {
    if (!this.item) return { hasItem: false };

    const config = this.dataShardService?.getConfig(this.item) ?? DEFAULTS.SHARD_CONFIG;
    const state = this.dataShardService?.getState(this.item) ?? DEFAULTS.SHARD_STATE;
    const actor = game.user?.character;
    const actorId = actor?.id;
    const session = actorId
      ? (this.dataShardService?.getActorSession(this.item, actorId) ?? DEFAULTS.ACTOR_SESSION)
      : DEFAULTS.ACTOR_SESSION;

    // Check security stack
    const security = this.dataShardService?.checkFullSecurityStack(this.item, actor) ?? { blocked: false };

    // Get shard messages (only if not blocked or GM)
    let messages = [];
    if (!security.blocked || isGM()) {
      messages = this.dataShardService?.getShardMessages(this.item) ?? [];
    }

    // Get selected message detail
    let selectedMessage = null;
    if (this.selectedMessageId && messages.length) {
      selectedMessage = messages.find(m => m.id === this.selectedMessageId) ?? null;
    }

    // Available skills for hacking
    let availableSkills = [];
    if (actor && config.allowedSkills?.length) {
      availableSkills = this.skillService?.getAvailableSkills(actor, config.allowedSkills) ?? [];
      // Attach per-skill DCs
      availableSkills = availableSkills.map(s => ({
        ...s,
        dc: config.skillDCs?.[s.name] ?? config.encryptionDC ?? 15,
      }));
    }

    // Luck info
    const availableLuck = actor ? (this.skillService?.getAvailableLuck(actor) ?? 0) : 0;

    // Lockout timer
    let lockoutRemaining = 0;
    if (session.lockoutUntil && session.lockoutUntil > Date.now()) {
      lockoutRemaining = Math.ceil((session.lockoutUntil - Date.now()) / 1000);
    }

    // Shard theme
    const theme = SHARD_THEMES[config.theme] ?? SHARD_THEMES.classic;

    // Network info (for network overlay)
    let requiredNetworkName = '';
    if (config.requiresNetwork && config.requiredNetwork) {
      const net = this.networkService?.getNetwork(config.requiredNetwork);
      requiredNetworkName = net?.name ?? config.requiredNetwork;
    }

    // Per-message encryption info
    const messagesWithEncryption = messages.map(m => {
      if (config.encryptionMode === 'message' && m.encrypted && !m.decrypted) {
        return { ...m, isLocked: true };
      }
      return { ...m, isLocked: false };
    });

    // Pre-compute formatted dates
    const formattedMessages = messagesWithEncryption.map(m => ({
      ...m,
      formattedDate: m.timestamp ? formatCyberDate(m.timestamp) : 'UNKNOWN',
      isSelected: m.id === this.selectedMessageId,
    }));

    return {
      hasItem: true,
      item: this.item,
      itemName: this.item.name,
      config,
      state,
      session,
      security,
      isBlocked: security.blocked,
      blockingLayer: security.layer,
      isGM: isGM(),
      hasActor: !!actor,
      actorName: actor?.name ?? 'No Character',

      // Security overlay data
      requiresNetwork: config.requiresNetwork,
      requiredNetworkName,
      requiresKeyItem: config.requiresKeyItem,
      keyItemDisplayName: config.keyItemDisplayName || config.keyItemName || 'Access Token',
      keyItemIcon: config.keyItemIcon || 'fa-id-card',
      requiresLogin: config.requiresLogin,
      loginDisplayName: config.loginDisplayName || 'System Login',
      isEncrypted: config.encrypted,
      encryptionType: config.encryptionType,
      encryptionMode: config.encryptionMode,
      encryptionDC: config.encryptionDC,
      hackAttempts: session.hackAttempts,
      maxHackAttempts: config.maxHackAttempts,
      attemptsRemaining: Math.max(0, config.maxHackAttempts - session.hackAttempts),
      failureMode: config.failureMode,
      isLockedOut: lockoutRemaining > 0,
      lockoutRemaining,
      isPermanentlyLocked: session.lockoutUntil === Infinity,

      // Skill data
      availableSkills,
      availableLuck,
      hasLuck: availableLuck > 0,

      // Messages
      messages: formattedMessages,
      messageCount: formattedMessages.length,
      selectedMessage: selectedMessage ? {
        ...selectedMessage,
        formattedDate: selectedMessage.timestamp ? formatCyberDate(selectedMessage.timestamp) : 'UNKNOWN',
      } : null,
      hasMessages: formattedMessages.length > 0,
      singleMessage: config.singleMessage,

      // Theme
      theme,
      themeKey: config.theme,
      themeAccent: theme.accent,

      // State flags for template
      isDecrypted: state.decrypted,
      isLoggedIn: session.loggedIn,
      keyItemUsed: session.keyItemUsed,
      isDestroyed: state.destroyed === true,

      // Pre-computed overlay flags (avoids unregistered eq helper)
      showNetworkOverlay: security.blocked && security.layer === 'network',
      showKeyitemOverlay: security.blocked && security.layer === 'keyitem',
      showLoginOverlay: security.blocked && security.layer === 'login',
      showEncryptionOverlay: security.blocked && security.layer === 'encryption',

      // First message for singleMessage mode
      firstMessage: formattedMessages[0] ?? null,

      // Hacking state
      hackingActive: this._hackingActive,
      hackingSkill: this._hackingSkill,
    };
  }

  // ─── Lifecycle ───

  _onRender(context, options) {
    super._onRender(context, options);

    // Apply shard theme accent color as CSS variable
    if (context.themeAccent) {
      this.element?.style?.setProperty('--ncm-shard-accent', context.themeAccent);
    }

    // Start lockout timer countdown if active
    if (context.isLockedOut && context.lockoutRemaining > 0) {
      this._startLockoutCountdown(context.lockoutRemaining);
    }
  }

  _setupEventSubscriptions() {
    // Re-render when shard state changes
    this.subscribe(EVENTS.SHARD_DECRYPTED, (data) => {
      if (data.itemId === this.item?.id) this.render();
    });
    this.subscribe(EVENTS.SHARD_RELOCKED, (data) => {
      if (data.itemId === this.item?.id) {
        this.selectedMessageId = null;
        this.render();
      }
    });
    this.subscribe(EVENTS.SHARD_KEY_ITEM_PRESENTED, (data) => {
      if (data.itemId === this.item?.id) this.render();
    });
    this.subscribe(EVENTS.SHARD_LOGIN_SUCCESS, (data) => {
      if (data.itemId === this.item?.id) this.render();
    });
    this.subscribe(EVENTS.SHARD_BLACK_ICE, (data) => {
      if (data.itemId === this.item?.id) this._playBlackICEEffect(data.damage);
    });
    // Network changes may affect the network overlay
    this.subscribe(EVENTS.NETWORK_CHANGED, () => this.render());
  }

  // ─── Lockout Timer ───

  /** @private */
  _startLockoutCountdown(seconds) {
    if (this._lockoutInterval) clearInterval(this._lockoutInterval);

    this._lockoutInterval = setInterval(() => {
      const el = this.element?.querySelector('.ncm-lockout-timer');
      if (!el) {
        clearInterval(this._lockoutInterval);
        return;
      }
      seconds--;
      if (seconds <= 0) {
        clearInterval(this._lockoutInterval);
        this.render();
        return;
      }
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      el.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }, 1000);
  }

  // ─── Action Handlers ───

  static _onSelectMessage(event, target) {
    const messageId = target.closest('[data-message-id]')?.dataset.messageId;
    if (!messageId) return;
    this.selectedMessageId = messageId;
    this.render();
    this.soundService?.play('click');
  }

  static async _onAttemptBreach(event, target) {
    if (!this.item) return;
    const actor = game.user?.character;
    if (!actor) {
      ui.notifications.warn('NCM | No character assigned. Set your character in User Configuration.');
      return;
    }

    // If a skill is already selected, use it
    const skillName = this._hackingSkill || target.dataset.skill;
    if (!skillName) {
      ui.notifications.info('NCM | Select a skill to attempt breach.');
      return;
    }

    this._hackingActive = true;
    this.render();

    // Brief delay for animation
    await new Promise(r => setTimeout(r, 500));

    const result = await this.dataShardService.attemptHack(this.item, actor, skillName, {
      luckSpend: 0,
    });

    this._hackingActive = false;
    this._hackingSkill = null;

    if (result.success) {
      await this._playHackSuccessEffect();
    } else {
      await this._playHackFailEffect(result);
    }

    this.render();
  }

  static _onSelectSkill(event, target) {
    const skillName = target.dataset.skill;
    if (!skillName) return;
    this._hackingSkill = skillName;
    this.render();
    this.soundService?.play('click');
  }

  static async _onSpendLuck(event, target) {
    if (!this.item) return;
    const actor = game.user?.character;
    if (!actor) return;

    const skillName = this._hackingSkill;
    if (!skillName) {
      ui.notifications.info('NCM | Select a skill first, then spend Luck.');
      return;
    }

    // Prompt for Luck amount
    const availableLuck = this.skillService?.getAvailableLuck(actor) ?? 0;
    if (availableLuck <= 0) {
      ui.notifications.warn('NCM | No Luck points available.');
      return;
    }

    const luckSpend = await new Promise(resolve => {
      new Dialog({
        title: 'Spend Luck',
        content: `<p>Available Luck: <strong>${availableLuck}</strong></p>
                  <div class="form-group">
                    <label>Points to spend:</label>
                    <input type="number" name="luck" value="1" min="1" max="${availableLuck}" />
                  </div>`,
        buttons: {
          spend: {
            label: 'Spend',
            callback: html => resolve(parseInt(html.find('[name=luck]').val()) || 0),
          },
          cancel: {
            label: 'Cancel',
            callback: () => resolve(0),
          },
        },
        default: 'spend',
      }).render(true);
    });

    if (luckSpend <= 0) return;

    this._hackingActive = true;
    this.render();
    await new Promise(r => setTimeout(r, 500));

    const result = await this.dataShardService.attemptHack(this.item, actor, skillName, {
      luckSpend,
    });

    this._hackingActive = false;
    this._hackingSkill = null;

    if (result.success) {
      await this._playHackSuccessEffect();
    } else {
      await this._playHackFailEffect(result);
    }

    this.render();
  }

  static async _onPresentKeyItem(event, target) {
    if (!this.item) return;
    const actor = game.user?.character;
    if (!actor) {
      ui.notifications.warn('NCM | No character assigned.');
      return;
    }

    const config = this.dataShardService?.getConfig(this.item);

    // Consume confirmation
    if (config?.keyItemConsumeOnUse) {
      const confirm = await Dialog.confirm({
        title: 'Consume Access Token',
        content: `<p>Using this access token will <strong>remove it from your inventory</strong>. Continue?</p>`,
      });
      if (!confirm) return;
    }

    const result = await this.dataShardService.presentKeyItem(this.item, actor);
    if (result.success) {
      ui.notifications.info('NCM | Access token accepted.');
      await this._playEffect(this.element, 'ncm-fade-in', 400);
    } else {
      ui.notifications.warn(`NCM | ${result.error || 'Access token rejected.'}`);
    }
    this.render();
  }

  static async _onSubmitLogin(event, target) {
    if (!this.item) return;
    const actor = game.user?.character;
    if (!actor) {
      ui.notifications.warn('NCM | No character assigned.');
      return;
    }

    const usernameInput = this.element.querySelector('[name="login-username"]');
    const passwordInput = this.element.querySelector('[name="login-password"]');
    const username = usernameInput?.value ?? '';
    const password = passwordInput?.value ?? '';

    if (!password.trim()) {
      ui.notifications.warn('NCM | Enter a password.');
      return;
    }

    const result = await this.dataShardService.attemptLogin(this.item, actor, username, password);
    if (result.success) {
      ui.notifications.info('NCM | Login successful.');
    } else if (result.locked) {
      ui.notifications.error('NCM | Account locked — too many failed attempts.');
    } else {
      ui.notifications.warn(`NCM | Login failed. ${result.attemptsRemaining} attempts remaining.`);
    }
    this.render();
  }

  // ─── GM Actions ───

  static async _onForceDecrypt(event, target) {
    if (!isGM() || !this.item) return;
    await this.dataShardService.forceDecrypt(this.item);
    ui.notifications.info('NCM | Shard force-decrypted.');
    this.render();
  }

  static async _onRelockShard(event, target) {
    if (!isGM() || !this.item) return;
    const confirm = await Dialog.confirm({
      title: 'Relock Data Shard',
      content: '<p>This will reset ALL security state (login sessions, hack attempts, encryption). Continue?</p>',
    });
    if (!confirm) return;

    await this.dataShardService.relockShard(this.item);
    this.selectedMessageId = null;
    ui.notifications.info('NCM | Shard relocked.');
    this.render();
  }

  static _onOpenConfig(event, target) {
    if (!isGM() || !this.item) return;
    // Dynamically import to avoid circular dependency
    import('./ItemInboxConfig.js').then(({ ItemInboxConfig }) => {
      new ItemInboxConfig({ item: this.item }).render(true);
    });
  }

  static _onAddMessage(event, target) {
    if (!isGM() || !this.item) return;
    import('./DataShardComposer.js').then(({ DataShardComposer }) => {
      new DataShardComposer({ shardItem: this.item, onSave: () => this.render() }).render(true);
    });
  }

  static async _onRemoveMessage(event, target) {
    if (!isGM() || !this.item) return;
    const messageId = target.closest('[data-message-id]')?.dataset.messageId;
    if (!messageId) return;

    const confirm = await Dialog.confirm({
      title: 'Delete Message',
      content: '<p>Remove this message from the data shard?</p>',
    });
    if (!confirm) return;

    await this.dataShardService.removeMessage(this.item, messageId);
    if (this.selectedMessageId === messageId) this.selectedMessageId = null;
    this.render();
  }

  static async _onDecryptMessage(event, target) {
    // Per-message decryption attempt
    const messageId = target.closest('[data-message-id]')?.dataset.messageId;
    if (!messageId || !this.item) return;

    const actor = game.user?.character;
    if (!actor) {
      ui.notifications.warn('NCM | No character assigned.');
      return;
    }

    const skillName = this._hackingSkill || this.dataShardService?.getConfig(this.item)?.allowedSkills?.[0];
    if (!skillName) return;

    const result = await this.dataShardService.attemptHack(this.item, actor, skillName, {
      messageId,
    });

    if (result.success) {
      ui.notifications.info('NCM | Message decrypted.');
    } else {
      ui.notifications.warn('NCM | Decryption failed.');
    }
    this.render();
  }

  // ─── Effects ───

  /** @private */
  async _playHackSuccessEffect() {
    const overlay = this.element?.querySelector('.ncm-security-overlay-encryption');
    if (overlay) {
      overlay.classList.add('ncm-shatter');
      await new Promise(r => setTimeout(r, 800));
    }
    this.soundService?.play('hack-success');
  }

  /** @private */
  async _playHackFailEffect(result) {
    const el = this.element;
    if (!el) return;

    el.classList.add('ncm-screen-shake');
    el.classList.add('ncm-flash-red');
    await new Promise(r => setTimeout(r, 500));
    el.classList.remove('ncm-screen-shake');
    el.classList.remove('ncm-flash-red');
  }

  /** @private */
  async _playBlackICEEffect(damage) {
    const el = this.element;
    if (!el) return;

    el.classList.add('ncm-black-ice-hit');
    el.classList.add('ncm-screen-shake-heavy');

    // Floating damage number
    const dmgEl = document.createElement('div');
    dmgEl.classList.add('ncm-damage-float');
    dmgEl.textContent = `-${damage}`;
    el.appendChild(dmgEl);

    this.soundService?.play('black-ice');

    await new Promise(r => setTimeout(r, 1000));
    el.classList.remove('ncm-black-ice-hit');
    el.classList.remove('ncm-screen-shake-heavy');
    dmgEl.remove();
  }

  // ─── Cleanup ───

  async close(options) {
    if (this._lockoutInterval) clearInterval(this._lockoutInterval);
    return super.close(options);
  }
}
