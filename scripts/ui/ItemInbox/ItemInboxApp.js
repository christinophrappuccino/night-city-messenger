/**
 * ItemInboxApp — Data Shard Viewer
 * @file scripts/ui/ItemInbox/ItemInboxApp.js
 * @module cyberpunkred-messenger
 * @description Shard viewer with layered security overlays, message list,
 *              hacking sequence, and GM override controls.
 *              Extends BaseApplication (ApplicationV2 + HandlebarsApplicationMixin).
 */

import { MODULE_ID, EVENTS, TEMPLATES, DEFAULTS, THEME_PRESETS, ENCRYPTION_TYPES, FAILURE_MODES, CONTENT_TYPES, SHARD_PRESETS } from '../../utils/constants.js';
import { log, isGM, formatCyberDate } from '../../utils/helpers.js';
import { BaseApplication } from '../BaseApplication.js';

/** Map content types to display info */
const CONTENT_TYPE_INFO = {
  [CONTENT_TYPES.MESSAGE]:  { label: 'Message',           icon: 'fas fa-envelope',         accent: 'cyan',   indexIcon: 'fas fa-envelope' },
  [CONTENT_TYPES.EDDIES]:   { label: 'Eddies Dead Drop',  icon: 'fas fa-sack-dollar',      accent: 'gold',   indexIcon: 'fas fa-sack-dollar' },
  [CONTENT_TYPES.DOSSIER]:  { label: 'Dossier',           icon: 'fas fa-id-badge',         accent: 'red',    indexIcon: 'fas fa-id-badge' },
  [CONTENT_TYPES.PAYLOAD]:  { label: 'Payload',           icon: 'fas fa-virus',            accent: 'purple', indexIcon: 'fas fa-virus' },
  [CONTENT_TYPES.AVLOG]:    { label: 'Audio/Video Log',   icon: 'fas fa-headphones',       accent: 'green',  indexIcon: 'fas fa-headphones' },
  [CONTENT_TYPES.LOCATION]: { label: 'Location',          icon: 'fas fa-map-marker-alt',   accent: 'green',  indexIcon: 'fas fa-map-marker-alt' },
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

  /** @type {boolean} Whether boot sequence has completed */
  _bootComplete = false;

  /** @type {boolean} Whether trace warning is active */
  _traceWarningActive = false;

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
      addEntry: ItemInboxApp._onAddEntry,
      removeEntry: ItemInboxApp._onRemoveEntry,
      decryptMessage: ItemInboxApp._onDecryptMessage,
      claimEddies: ItemInboxApp._onClaimEddies,
      scrollToEntry: ItemInboxApp._onScrollToEntry,
      toggleIndexStrip: ItemInboxApp._onToggleIndexStrip,
      // Legacy aliases
      addMessage: ItemInboxApp._onAddEntry,
      removeMessage: ItemInboxApp._onRemoveEntry,
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

    // Security stack
    const security = this.dataShardService?.checkFullSecurityStack(this.item, actor) ?? { blocked: false };

    // Preset info
    const presetKey = config.preset || 'blank';
    const preset = SHARD_PRESETS[presetKey] ?? SHARD_PRESETS['blank'];
    const presetTheme = config._presetTheme ?? preset?.theme ?? {};

    // Integrity
    const integrity = this.dataShardService?.checkIntegrity(this.item) ?? { enabled: false, percentage: 100, tier: 'clean' };

    // Network info
    const networkRequired = config.network?.required ?? config.requiresNetwork ?? false;
    const isTethered = config.network?.connectionMode === 'tethered';
    const currentNetworkId = this.networkService?.getCurrentNetworkId?.() ?? null;
    const currentNetworkName = this.networkService?.getCurrentNetwork?.()?.name ?? currentNetworkId ?? '';
    const signalStrength = this.networkService?.getSignalStrength?.() ?? 100;
    const showSignalRow = networkRequired && isTethered;

    // Signal bars (5 bars)
    const signalBars = this._computeSignalBars(signalStrength);
    const signalTier = signalStrength > 74 ? 'good' : signalStrength > 40 ? 'mid' : 'low';

    // Tethered disconnection check
    const showDisconnected = isTethered && networkRequired && !security.blocked && !currentNetworkId;

    // Entries (visible + hidden)
    let visibleEntries = [];
    let hiddenCount = 0;
    let totalEntryCount = 0;

    if (!security.blocked || isGM()) {
      const visibility = this.dataShardService?.getVisibleEntries(this.item) ?? { visible: [], hiddenCount: 0, totalCount: 0 };
      visibleEntries = visibility.visible;
      hiddenCount = visibility.hiddenCount;
      totalEntryCount = visibility.totalCount;
    }

    // Enrich entries with display data
    const enrichedEntries = visibleEntries.map(entry => this._enrichEntry(entry));

    // Index strip chips
    const indexChips = this._buildIndexChips(visibleEntries, hiddenCount, this.selectedMessageId);

    // Eddies totals
    let totalEddies = 0;
    let claimedEddies = 0;
    for (const entry of visibleEntries) {
      if (entry.contentType === CONTENT_TYPES.EDDIES) {
        const amt = entry.contentData?.amount ?? 0;
        totalEddies += amt;
        if (entry.contentData?.claimed) claimedEddies += amt;
      }
    }

    // ICE class for icon block
    let iceClass = 'none';
    if (state.decrypted) iceClass = 'decrypted';
    else if (config.encryptionType === ENCRYPTION_TYPES.BLACK_ICE) iceClass = 'black';
    else if (config.encryptionType === ENCRYPTION_TYPES.RED_ICE) iceClass = 'red';
    else if (config.encrypted) iceClass = 'standard';

    // Network display name
    let networkDisplayName = '';
    if (networkRequired) {
      const netConfig = config.network ?? {};
      if (netConfig.allowedNetworks?.length) {
        const net = this.networkService?.getNetwork(netConfig.allowedNetworks[0]);
        networkDisplayName = net?.name ?? netConfig.allowedNetworks[0];
      } else if (config.requiredNetwork) {
        const net = this.networkService?.getNetwork(config.requiredNetwork);
        networkDisplayName = net?.name ?? config.requiredNetwork;
      } else if (netConfig.allowedTypes?.length) {
        networkDisplayName = netConfig.allowedTypes.join(' / ');
      }
    }

    // Metadata
    const meta = config.metadata ?? {};
    const hasMetadata = !!(meta.timestamp || meta.location || meta.network);

    // Boot config
    const bootConfig = config.boot ?? {};
    const showBoot = bootConfig.enabled && !state.bootPlayed && !this._bootComplete;

    // Trace warning
    const tracing = config.network?.tracing ?? {};
    const showTraceWarning = this._traceWarningActive ?? false;

    // Available skills for hacking
    let availableSkills = [];
    if (actor && config.allowedSkills?.length) {
      availableSkills = this.skillService?.getAvailableSkills(actor, config.allowedSkills) ?? [];
      const signalMod = this.dataShardService?.getSignalDVModifier(this.item) ?? { modifier: 0 };
      availableSkills = availableSkills.map(s => ({
        ...s,
        baseDC: config.skillDCs?.[s.name] ?? config.encryptionDC ?? 15,
        signalPenalty: signalMod.modifier,
        dc: (config.skillDCs?.[s.name] ?? config.encryptionDC ?? 15) + signalMod.modifier,
      }));
    }

    const availableLuck = actor ? (this.skillService?.getAvailableLuck(actor) ?? 0) : 0;

    // Lockout timer
    let lockoutRemaining = 0;
    if (session.lockoutUntil && session.lockoutUntil > Date.now()) {
      lockoutRemaining = Math.ceil((session.lockoutUntil - Date.now()) / 1000);
    }

    return {
      hasItem: true,
      item: this.item,
      config,
      state,
      session,
      security,
      isGM: isGM(),
      hasActor: !!actor,
      actorName: actor?.name ?? 'No Character',

      // Preset / Identity
      presetKey,
      presetLabel: preset?.label ?? 'Data Shard',
      presetFaIcon: bootConfig.faIcon || preset?.icon || 'fas fa-microchip',
      presetAccent: presetTheme.accent || null,
      presetFooterText: presetTheme.footerText || '',

      // Shard display
      shardDisplayName: config.shardName || this.item.name,

      // Boot
      showBoot,
      bootAnimationStyle: bootConfig.animationStyle || 'standard-fade',
      bootSpeed: bootConfig.speed || 'normal',
      bootIconIsImage: bootConfig.iconMode === 'image' && bootConfig.imageUrl,
      bootImageUrl: bootConfig.imageUrl,
      bootImageSize: bootConfig.imageSize || 64,

      // Security state
      isBlocked: security.blocked,
      blockingLayer: security.layer,
      isDecrypted: state.decrypted,
      isEncrypted: config.encrypted,
      encryptionType: config.encryptionType,
      encryptionDC: config.encryptionDC,
      encryptionMode: config.encryptionMode,
      hackAttempts: session.hackAttempts,
      maxHackAttempts: config.maxHackAttempts,
      attemptsRemaining: Math.max(0, config.maxHackAttempts - session.hackAttempts),
      failureMode: config.failureMode,
      isLockedOut: lockoutRemaining > 0,
      lockoutRemaining,
      isPermanentlyLocked: session.lockoutUntil === Infinity,
      hackingActive: this._hackingActive,

      // ICE
      iceClass,

      // Network
      networkRequired,
      networkDisplayName,
      isTethered,
      showSignalRow,
      signalStrength,
      signalBars,
      signalTier,
      currentNetworkName,
      showDisconnected,

      // Integrity
      integrityEnabled: integrity.enabled,
      integrityPercent: integrity.percentage,
      integrityTier: integrity.tier,

      // Metadata
      hasMetadata,
      metadataTimestamp: meta.timestamp ? formatCyberDate(meta.timestamp) : '',
      metadataLocation: meta.location || '',
      metadataNetwork: meta.network || '',
      metadataClassification: meta.classification || '',

      // Entries
      visibleEntries: enrichedEntries,
      hasEntries: enrichedEntries.length > 0,
      totalEntryCount,
      visibleCount: enrichedEntries.length,
      hiddenCount,
      hasHiddenEntries: hiddenCount > 0,
      singleEntry: totalEntryCount === 1,
      singleHidden: hiddenCount === 1,

      // Index strip
      showIndexStrip: totalEntryCount > 1,
      indexChips,

      // Eddies totals
      totalEddies: totalEddies > 0 ? totalEddies.toLocaleString() : null,
      claimedEddies: claimedEddies > 0 ? claimedEddies.toLocaleString() : null,

      // Skills
      availableSkills,
      availableLuck,
      hasLuck: availableLuck > 0,

      // Overlay flags
      showNetworkOverlay: security.blocked && security.layer === 'network',
      showKeyitemOverlay: security.blocked && security.layer === 'keyitem',
      showLoginOverlay: security.blocked && security.layer === 'login',
      showEncryptionOverlay: security.blocked && security.layer === 'encryption',

      // Login state
      isLoggedIn: session.loggedIn,
      keyItemUsed: session.keyItemUsed,
      loginDisplayName: config.loginDisplayName || 'System Login',
      requiresLogin: config.requiresLogin,
      requiresKeyItem: config.requiresKeyItem,
      keyItemDisplayName: config.keyItemDisplayName || config.keyItemName || 'Access Token',
      keyItemIcon: config.keyItemIcon || 'fa-id-card',

      // Trace
      showTraceWarning,
      traceVisible: tracing.mode === 'visible',

      // State
      isDestroyed: state.destroyed === true || integrity.isBricked,
    };
  }

  // ─── Entry Enrichment Helpers ───

  /** @private */
  _enrichEntry(entry) {
    const typeInfo = CONTENT_TYPE_INFO[entry.contentType] ?? CONTENT_TYPE_INFO[CONTENT_TYPES.MESSAGE];
    const enriched = {
      ...entry,
      formattedDate: entry.timestamp ? formatCyberDate(entry.timestamp) : 'UNKNOWN',
      contentTypeLabel: typeInfo.label,
      entryIcon: typeInfo.icon,
      accentColor: typeInfo.accent,
      isMessage: entry.contentType === CONTENT_TYPES.MESSAGE || !entry.contentType,
      isEddies: entry.contentType === CONTENT_TYPES.EDDIES,
      isDossier: entry.contentType === CONTENT_TYPES.DOSSIER,
      isPayload: entry.contentType === CONTENT_TYPES.PAYLOAD,
      isAvlog: entry.contentType === CONTENT_TYPES.AVLOG,
      isLocation: entry.contentType === CONTENT_TYPES.LOCATION,
      isLocked: false,
    };

    // Per-message encryption
    if (entry.encrypted && !entry.decrypted) {
      enriched.isLocked = true;
    }

    // Eddies enrichment
    if (enriched.isEddies && entry.contentData) {
      enriched.contentData = {
        ...entry.contentData,
        amountFormatted: (entry.contentData.amount ?? 0).toLocaleString(),
        claimedByName: entry.contentData.claimedBy
          ? (game.actors?.get(entry.contentData.claimedBy)?.name ?? 'Unknown')
          : '',
      };
    }

    // Dossier enrichment
    if (enriched.isDossier && entry.contentData) {
      const cd = entry.contentData;
      enriched.contentData = {
        ...cd,
        hasSections: cd.sections?.length > 0,
        threatIsHigh: cd.stats?.threat?.toUpperCase() === 'HIGH',
        linkedActorImg: cd.linkedActorId ? game.actors?.get(cd.linkedActorId)?.img : null,
      };
    }

    // Payload enrichment
    if (enriched.isPayload && entry.contentData?.executedBy) {
      enriched.contentData = {
        ...entry.contentData,
        executedByName: game.actors?.get(entry.contentData.executedBy)?.name ?? 'Unknown',
      };
    }

    // AV Log enrichment
    if (enriched.isAvlog && entry.contentData) {
      enriched.contentData = {
        ...entry.contentData,
        isVideo: entry.contentData.mediaType === 'video',
      };
    }

    return enriched;
  }

  /** @private */
  _buildIndexChips(visibleEntries, hiddenCount, selectedId) {
    const chips = visibleEntries.map(entry => {
      const typeInfo = CONTENT_TYPE_INFO[entry.contentType] ?? CONTENT_TYPE_INFO[CONTENT_TYPES.MESSAGE];
      return {
        id: entry.id,
        title: entry.subject || 'Data Fragment',
        iconClass: typeInfo.indexIcon,
        iconColor: `var(--ncm-color-${typeInfo.accent === 'cyan' ? 'secondary' : typeInfo.accent === 'red' ? 'primary' : typeInfo.accent})`,
        isActive: entry.id === selectedId,
        isHidden: false,
      };
    });

    // Add hidden placeholder chips
    for (let i = 0; i < hiddenCount; i++) {
      chips.push({
        id: `hidden-${i}`,
        title: 'Hidden',
        iconClass: 'fas fa-lock',
        iconColor: 'var(--ncm-text-muted)',
        isActive: false,
        isHidden: true,
      });
    }

    return chips;
  }

  /** @private */
  _computeSignalBars(signal) {
    const bars = [];
    const thresholds = [1, 20, 40, 60, 80];
    for (const threshold of thresholds) {
      if (signal >= threshold) {
        bars.push(signal > 74 ? 'active' : signal > 40 ? 'mid' : 'low');
      } else {
        bars.push('off');
      }
    }
    return bars;
  }

  // ─── Lifecycle ───

  _onRender(context, options) {
    super._onRender(context, options);

    // Apply shard accent color as CSS variable
    if (context.presetAccent) {
      this.element?.style?.setProperty('--shard-accent', context.presetAccent);
    }

    // Start lockout timer countdown if active
    if (context.isLockedOut && context.lockoutRemaining > 0) {
      this._startLockoutCountdown(context.lockoutRemaining);
    }
  }

  _setupEventSubscriptions() {
    this.subscribe(EVENTS.SHARD_DECRYPTED, (data) => {
      if (data.itemId === this.item?.id) this.render();
    });
    this.subscribe(EVENTS.SHARD_RELOCKED, (data) => {
      if (data.itemId === this.item?.id) {
        this.selectedMessageId = null;
        this.render();
      }
    });
    this.subscribe(EVENTS.SHARD_STATE_CHANGED, (data) => {
      if (data.itemId === this.item?.id) this._debouncedRender();
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
    this.subscribe(EVENTS.NETWORK_CHANGED, () => this._debouncedRender());
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

  static _onAddEntry(event, target) {
    if (!isGM() || !this.item) return;
    import('./DataShardComposer.js').then(({ DataShardComposer }) => {
      new DataShardComposer({ shardItem: this.item, onSave: () => this.render() }).render(true);
    });
  }

  static async _onRemoveEntry(event, target) {
    if (!isGM() || !this.item) return;
    const messageId = target.closest('[data-entry-id]')?.dataset.entryId
      ?? target.closest('[data-message-id]')?.dataset.messageId;
    if (!messageId) return;

    const confirm = await Dialog.confirm({
      title: 'Delete Entry',
      content: '<p>Remove this entry from the data shard?</p>',
    });
    if (!confirm) return;

    await this.dataShardService.removeMessage(this.item, messageId);
    if (this.selectedMessageId === messageId) this.selectedMessageId = null;
    this.render();
  }

  static async _onDecryptMessage(event, target) {
    // Per-message decryption attempt
    const messageId = target.closest('[data-entry-id]')?.dataset.entryId
      ?? target.closest('[data-message-id]')?.dataset.messageId;
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

  // ─── Sprint 4.6 Actions ───

  static async _onClaimEddies(event, target) {
    if (!this.item) return;
    const actor = game.user?.character;
    if (!actor) {
      ui.notifications.warn('NCM | No character assigned.');
      return;
    }

    const entryId = target.closest('[data-entry-id]')?.dataset.entryId;
    if (!entryId) return;

    const confirm = await Dialog.confirm({
      title: 'Claim Eddies',
      content: '<p>Transfer these eddies to your account? This cannot be undone.</p>',
    });
    if (!confirm) return;

    const result = await this.dataShardService.claimEddies(this.item, entryId, actor);
    if (result.success) {
      ui.notifications.info(`NCM | ${result.amount.toLocaleString()} eb claimed.`);
    } else {
      ui.notifications.warn(`NCM | ${result.error || 'Claim failed.'}`);
    }
    this.render();
  }

  static _onScrollToEntry(event, target) {
    const entryId = target.closest('[data-entry-id]')?.dataset.entryId;
    if (!entryId || entryId.startsWith('hidden-')) return;

    const entryEl = this.element?.querySelector(`#shard-entry-${entryId}`);
    if (entryEl) {
      entryEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // Brief highlight flash
      entryEl.classList.add('ncm-entry-highlight');
      setTimeout(() => entryEl.classList.remove('ncm-entry-highlight'), 800);
    }

    // Update active chip
    this.selectedMessageId = entryId;
    const chips = this.element?.querySelectorAll('.ncm-shard-index-chip');
    chips?.forEach(chip => {
      chip.classList.toggle('ncm-shard-index-chip--active',
        chip.dataset.entryId === entryId);
    });
  }

  static _onToggleIndexStrip(event, target) {
    const strip = this.element?.querySelector('.ncm-shard-index-strip');
    if (strip) {
      strip.classList.toggle('ncm-shard-index-strip--collapsed');
      const icon = strip.querySelector('.ncm-shard-index-toggle i');
      if (icon) {
        icon.classList.toggle('fa-chevron-down');
        icon.classList.toggle('fa-chevron-right');
      }
    }
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
