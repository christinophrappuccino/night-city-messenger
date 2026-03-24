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
import { NetworkAuthDialog } from '../NetworkManagement/NetworkAuthDialog.js';

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

  /** @type {boolean} Guards against re-render during security splashes/animations */
  _transitionActive = false;

  /** @type {boolean} Show unlock splash on next render */
  _pendingUnlockSplash = false;

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
      hackLayer: ItemInboxApp._onHackLayer,
      spendLuck: ItemInboxApp._onSpendLuck,
      searchInventory: ItemInboxApp._onSearchInventory,
      clearTokenSlot: ItemInboxApp._onClearTokenSlot,
      confirmPresentToken: ItemInboxApp._onConfirmPresentToken,
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
      executePayload: ItemInboxApp._onExecutePayload,
      goToScene: ItemInboxApp._onGoToScene,
      editEntry: ItemInboxApp._onEditEntry,
      switchNetwork: ItemInboxApp._onSwitchNetwork,
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
    // Set unique app ID per item BEFORE super() reads it
    if (options.item?.id) {
      options.id = `ncm-item-inbox-${options.item.id}`;
    }
    super(options);
    if (options.item) {
      this.item = options.item;
    }
    // Reset boot state for this instance
    this._bootComplete = false;

    // Foundry Hook: re-render when this item's flags change (relock, decrypt, etc.)
    this._hookId = Hooks.on('updateItem', (item, changes) => {
      if (item.id === this.item?.id && changes?.flags) {
        // Don't re-render during active hacking sequence or transition splash
        if (this._hackingActive || this._transitionActive) return;
        log.debug(`ItemInboxApp: updateItem hook fired for ${item.name}, re-rendering`);
        this.render(true);
      }
    });
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
    const currentNetworkId = this.networkService?.currentNetworkId ?? null;
    const currentNetworkName = this.networkService?.currentNetwork?.name ?? currentNetworkId ?? '';
    const signalStrength = this.networkService?.signalStrength ?? 100;
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

    // Resolve ICE info for hacking sequence display
    const isLethalICE = config.encryptionType === ENCRYPTION_TYPES.BLACK_ICE || config.encryptionType === ENCRYPTION_TYPES.RED_ICE;
    const resolvedICE = isLethalICE ? this.dataShardService?._resolveICE(config) : null;

    // Network display name — handles all access modes
    let networkDisplayName = '';
    if (networkRequired) {
      const netConfig = config.network ?? {};
      const accessMode = netConfig.accessMode ?? 'any';
      if (accessMode === 'any') {
        networkDisplayName = 'Any Network';
      } else if (accessMode === 'whitelist' || accessMode === 'both') {
        if (netConfig.allowedNetworks?.length) {
          const names = netConfig.allowedNetworks.map(id => {
            const net = this.networkService?.getNetwork(id);
            return net?.name ?? id;
          });
          networkDisplayName = names.join(' / ');
        } else if (config.requiredNetwork) {
          const net = this.networkService?.getNetwork(config.requiredNetwork);
          networkDisplayName = net?.name ?? config.requiredNetwork;
        } else {
          networkDisplayName = 'Specific Network (not configured)';
        }
      } else if (accessMode === 'type') {
        if (netConfig.allowedTypes?.length) {
          networkDisplayName = netConfig.allowedTypes.join(' / ') + ' networks';
        } else {
          networkDisplayName = 'Network Type (not configured)';
        }
      }
    }

    // Available networks for selector (used in network overlay)
    const netConfig = networkRequired ? (config.network ?? {}) : {};
    const allowedNetIds = netConfig.allowedNetworks ?? [];
    const allowedTypes = netConfig.allowedTypes ?? [];
    const netAccessMode = netConfig.accessMode ?? 'any';
    const availableNetworks = (this.networkService?.getAvailableNetworks?.() ?? []).map(n => ({
      id: n.id,
      name: n.name,
      type: n.type || '',
      isCurrent: n.id === currentNetworkId,
      isAllowed: netAccessMode === 'any' || allowedNetIds.includes(n.id) || allowedTypes.includes(n.type),
      requiresAuth: (n.security?.requiresAuth ?? false) && !(this.networkService?.isAuthenticated?.(n.id) ?? false),
      icon: n.theme?.icon || 'fa-wifi',
      color: n.theme?.color || '#19f3f7',
      theme: n.theme || {},
    }));

    // Metadata
    const meta = config.metadata ?? {};
    const hasMetadata = !!(meta.timestamp || meta.location || meta.network);
    const presetLabel = preset?.label ?? 'Data Shard';

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
        selected: s.name === this._hackingSkill,
      }));
      // Compute selected skill total for status bar
      const selectedSkill = availableSkills.find(s => s.selected);
      if (selectedSkill) this._hackingSkillTotal = selectedSkill.total;
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
      presetLabel,
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
      hackAttemptCurrent: session.hackAttempts + 1,
      attemptsRemaining: Math.max(0, config.maxHackAttempts - session.hackAttempts),
      failureMode: config.failureMode,
      isLockedOut: lockoutRemaining > 0,
      lockoutRemaining,
      isPermanentlyLocked: session.lockoutUntil === Infinity || session.lockoutUntil >= Number.MAX_SAFE_INTEGER,
      hackingActive: this._hackingActive,
      hackingSkillName: this._hackingSkill || null,
      hackingSkillTotal: this._hackingSkillTotal || null,
      isBlackICE: config.encryptionType === 'BLACK_ICE',
      isRedICE: config.encryptionType === 'RED_ICE',
      isLethalICE,
      iceImg: resolvedICE?.img || null,
      iceName: resolvedICE?.name || config.encryptionType || 'ICE',
      iceClass: resolvedICE?.class || null,

      // Attempt dots (for visual dot indicators)
      attemptDots: Array.from({ length: config.maxHackAttempts || 3 }, (_, i) => ({
        used: i < session.hackAttempts,
        current: i === session.hackAttempts,
      })),

      // ICE
      iceClass,

      // Network
      networkRequired,
      networkDisplayName,
      requiredNetworkName: networkDisplayName,
      isTethered,
      showSignalRow,
      signalStrength,
      signalBars,
      signalTier,
      currentNetworkName,
      currentNetworkId,
      availableNetworks,
      showDisconnected,
      networkBlockReason: security.layer === 'network' ? (security.reason || '') : '',
      networkSignalBlocked: !!(security.layer === 'network' && security.signalInfo),
      networkSignalThreshold: security.signalInfo?.threshold ?? null,

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

      // Type line display mode
      typeLineIsCustom: meta.typeLineMode === 'custom',
      typeLineIsStatusOnly: meta.typeLineMode === 'status-only',
      typeLineCustomText: meta.typeLineCustom || presetLabel,

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
      hasSkills: availableSkills.length > 0,
      availableLuck,
      hasLuck: availableLuck > 0,

      // Overlay flags
      isBlocked: security.blocked,
      showNetworkOverlay: security.blocked && security.layer === 'network',
      showKeyitemOverlay: security.blocked && security.layer === 'keyitem',
      showLoginOverlay: security.blocked && security.layer === 'login',
      showEncryptionOverlay: security.blocked && security.layer === 'encryption',
      pendingUnlockSplash: this._pendingUnlockSplash,

      // Login state
      isLoggedIn: session.loggedIn,
      keyItemUsed: session.keyItemUsed,
      loginDisplayName: config.loginDisplayName || 'System Login',
      requiresLogin: config.requiresLogin,
      maxLoginAttempts: config.maxLoginAttempts || 3,
      loginAttemptsCurrent: (session.loginAttempts || 0) + 1,
      requiresKeyItem: config.requiresKeyItem,
      keyItemDisplayName: config.keyItemDisplayName || config.keyItemName || 'Access Token',
      keyItemIcon: config.keyItemIcon || 'fa-id-card',
      maxKeyItemAttempts: config.maxKeyItemAttempts || 3,
      keyItemAttemptsCurrent: (session.keyItemAttempts || 0) + 1,
      keyItemAttemptsUsed: session.keyItemAttempts || 0,
      keyItemAttemptsRemaining: Math.max(0, (config.maxKeyItemAttempts || 3) - (session.keyItemAttempts || 0)),
      keyItemLockedOut: (session.keyItemAttempts || 0) >= (config.maxKeyItemAttempts || 3),
      keyItemAttemptDots: Array.from({ length: config.maxKeyItemAttempts || 3 }, (_, i) => ({
        used: i < (session.keyItemAttempts || 0),
        current: i === (session.keyItemAttempts || 0),
      })),

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
    const ACCENT_HEX = {
      red: '#F65261', cyan: '#19f3f7', gold: '#f7c948',
      green: '#00ff41', purple: '#a855f7', danger: '#ff0033', muted: '#888888',
    };

    const chips = visibleEntries.map(entry => {
      const typeInfo = CONTENT_TYPE_INFO[entry.contentType] ?? CONTENT_TYPE_INFO[CONTENT_TYPES.MESSAGE];
      return {
        id: entry.id,
        title: entry.subject || 'Data Fragment',
        iconClass: typeInfo.indexIcon,
        iconColor: ACCENT_HEX[typeInfo.accent] || '#19f3f7',
        accentClass: `ncm-shard-index-chip--${typeInfo.accent || 'cyan'}`,
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
        iconColor: '#555570',
        accentClass: 'ncm-shard-index-chip--muted',
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

  /** Override render to save scroll position before DOM is replaced */
  async render(force) {
    // Save scroll position of content area before re-render
    const content = this.element?.querySelector('.ncm-shard-content');
    if (content) this._savedScrollTop = content.scrollTop;
    return super.render(force);
  }

  // ─── Lifecycle ───

  _onRender(context, options) {
    super._onRender(context, options);

    // Apply preset theme class to the .ncm-item-inbox element (not app root)
    if (this.element) {
      const inbox = this.element.querySelector('.ncm-item-inbox') || this.element;
      inbox.classList.forEach(cls => {
        if (cls.startsWith('ncm-preset-')) inbox.classList.remove(cls);
      });
      const presetKey = context.presetKey || 'blank';
      inbox.classList.add(`ncm-preset-${presetKey}`);
    }

    // Apply shard accent color as CSS variable
    if (context.presetAccent) {
      this.element?.style?.setProperty('--shard-accent', context.presetAccent);
    }

    // Restore scroll position after re-render
    if (this._savedScrollTop != null) {
      const content = this.element?.querySelector('.ncm-shard-content');
      if (content) content.scrollTop = this._savedScrollTop;
      this._savedScrollTop = null;
    }

    // Start lockout timer countdown if active, clear if not
    if (context.isLockedOut && context.lockoutRemaining > 0) {
      this._startLockoutCountdown(context.lockoutRemaining);
    } else if (this._lockoutInterval) {
      clearInterval(this._lockoutInterval);
      this._lockoutInterval = null;
    }

    // Show climactic SHARD UNLOCKED splash when all security layers are cleared
    if (this._pendingUnlockSplash && !context.isBlocked && !this._hackingActive) {
      this._pendingUnlockSplash = false;
      // Remove template-rendered opaque cover → inject animated splash (both synchronous, no paint gap)
      this.element?.querySelector('.ncm-sec-unlock-cover')?.remove();
      this._showTransitionSplash({
        icon: 'fas fa-lock-open',
        iconStyle: 'accent',
        preTitle: 'ALL SECURITY LAYERS CLEARED',
        title: 'Shard Unlocked',
        titleColor: 'var(--sp-accent)',
        subtitle: `${context.shardDisplayName || 'Data Shard'} contents are now accessible.`,
        progressColor: 'accent',
        footerText: 'Loading data...',
        duration: 2500,
        sound: 'hack-success',
      });
    }

    // Play boot sequence on first render if enabled
    if (context.showBoot && !this._bootComplete) {
      this._playBootSequence(context);
    }
  }

  _setupEventSubscriptions() {
    const _guard = () => !this._hackingActive && !this._transitionActive;

    this.subscribe(EVENTS.SHARD_DECRYPTED, (data) => {
      if (data.itemId === this.item?.id && _guard()) this.render();
    });
    this.subscribe(EVENTS.SHARD_RELOCKED, (data) => {
      if (data.itemId === this.item?.id) {
        this.selectedMessageId = null;
        this._hackingActive = false;
        this._transitionActive = false;
        this._pendingUnlockSplash = false;
        this.render(true);
      }
    });
    this.subscribe(EVENTS.SHARD_STATE_CHANGED, (data) => {
      if (data.itemId === this.item?.id && _guard()) this._debouncedRender();
    });
    this.subscribe(EVENTS.SHARD_KEY_ITEM_PRESENTED, (data) => {
      if (data.itemId === this.item?.id && _guard()) this.render();
    });
    this.subscribe(EVENTS.SHARD_LOGIN_SUCCESS, (data) => {
      if (data.itemId === this.item?.id && _guard()) this.render();
    });
    this.subscribe(EVENTS.SHARD_BLACK_ICE, (data) => {
      if (data.itemId === this.item?.id) this._playBlackICEEffect(data.damage);
    });
    this.subscribe(EVENTS.NETWORK_CHANGED, () => {
      if (_guard()) this._debouncedRender();
    });
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

    const config = this.dataShardService?.getConfig(this.item) ?? {};
    const dc = config.encryptionDC ?? 15;

    // Get available skills — dialog handles selection
    const availableSkills = this.skillService?.getAvailableSkills(actor, config.allowedSkills) ?? [];
    if (availableSkills.length === 0) {
      ui.notifications.warn('NCM | No skills configured for this shard.');
      return;
    }

    const skills = availableSkills.map(s => ({
      ...s,
      dc: config.skillDCs?.[s.name] ?? dc,
    }));
    const availableLuck = this.skillService?.getAvailableLuck(actor) ?? 0;

    // Attempt info
    const state = this.dataShardService._getState(this.item);
    const session = this.dataShardService._getActorSession(state, actor.id);
    const attempts = config.maxHackAttempts ? {
      current: (session.hackAttempts || 0) + 1,
      max: config.maxHackAttempts,
    } : null;

    // ─── Resolve ICE info for dialog display ───
    const isLethalICE = config.encryptionType === 'BLACK_ICE' || config.encryptionType === 'RED_ICE';
    const iceInfo = isLethalICE ? this.dataShardService?._resolveICE(config) : null;

    // ─── Themed Hack Dialog (skill + luck combined) ───
    const dialogResult = await this._showHackDialog({
      title: isLethalICE ? `${iceInfo?.name || 'BLACK ICE'} Breach` : 'ICE Breach',
      icon: isLethalICE ? 'fas fa-skull-crossbones' : 'fas fa-shield-halved',
      color: isLethalICE ? '#ff0033' : '#19f3f7',
      subtitle: `Breaching ${iceInfo?.name || config.encryptionType || 'Standard'} encryption on ${this.item.name}`,
      skills,
      dc,
      availableLuck,
      actorName: actor.name,
      encryptionType: config.encryptionType,
      iceInfo,
      attempts,
    });
    if (!dialogResult) return;

    const skillName = dialogResult.skill;
    const luckSpend = dialogResult.luck;

    // ─── Show hacking screen ───
    this._hackingActive = true;
    this._transitionActive = true;
    await this.render(true);

    // Safety delay to ensure DOM is painted
    await new Promise(r => setTimeout(r, 150));

    // ─── Perform the hack ───
    const result = await this.dataShardService.attemptHack(this.item, actor, skillName, {
      luckSpend,
    });

    // ─── Play the terminal sequence ───
    await this._playHackSequence(result, skillName, luckSpend);

    this._hackingActive = false;
    this._transitionActive = false;
    this._hackingSkill = null;
    this._pendingUnlockSplash = true;
    this.render(true);
  }

  static _onSelectSkill(event, target) {
    const skillName = target.dataset.skill;
    if (!skillName) return;
    this._hackingSkill = skillName;
    this.soundService?.play('click');
    this.render();
  }

  /**
   * Hack a specific security layer (network/key item/login).
   * Uses the shard's configured skills + encryption DV as fallback.
   * Tracks attempts per-layer and applies configurable consequences.
   */
  static async _onHackLayer(event, target) {
    if (!this.item) return;
    const actor = game.user?.character;
    if (!actor) {
      ui.notifications.warn('NCM | No character assigned.');
      return;
    }

    const layer = target.dataset.layer;
    if (!layer) return;

    const config = this.dataShardService?.getConfig(this.item) ?? {};
    const layerSec = config.layerSecurity ?? {};
    const LAYER_FLAVOR = {
      network: { title: 'Network Spoofing', icon: 'fas fa-wifi', color: '#19f3f7', verb: 'Spoofed network access', subtitle: 'Spoofing network handshake to bypass access control' },
      keyitem: { title: 'Forge Token', icon: 'fas fa-fingerprint', color: '#f7c948', verb: 'Token forged digitally', subtitle: 'Digitally forging authentication token signature' },
      login: { title: 'Brute Force Login', icon: 'fas fa-terminal', color: '#00ff41', verb: 'Credentials cracked', subtitle: 'Brute-forcing login credentials via dictionary attack' },
    };
    const flavor = LAYER_FLAVOR[layer] || { title: 'Bypass', icon: 'fas fa-unlock', color: 'var(--sp-accent)', verb: 'Layer bypassed', subtitle: 'Bypassing security layer' };

    // ─── Check layer lockout ───
    if (layerSec.enabled) {
      const hackInfo = this.dataShardService.getLayerHackInfo(this.item, actor.id, layer);
      if (hackInfo.isLockedOut) {
        const mins = Math.ceil(hackInfo.lockoutRemaining / 60);
        ui.notifications.warn(`NCM | Layer hacking locked out. ${mins > 9999 ? 'Permanent' : `${mins}m remaining`}.`);
        return;
      }
    }

    // Get available skills
    const availableSkills = this.skillService?.getAvailableSkills(actor, config.allowedSkills) ?? [];
    if (availableSkills.length === 0) {
      ui.notifications.warn('NCM | No skills configured for this shard.');
      return;
    }

    // Prepare skills with per-skill DCs
    const dc = config.encryptionDC ?? 15;
    const skills = availableSkills.map(s => ({
      ...s,
      dc: config.skillDCs?.[s.name] ?? dc,
    }));
    const availableLuck = this.skillService?.getAvailableLuck(actor) ?? 0;

    // ─── Layer attempt info for dialog ───
    let layerAttempts = null;
    if (layerSec.enabled) {
      const info = this.dataShardService.getLayerHackInfo(this.item, actor.id, layer);
      layerAttempts = { current: info.attempts + 1, max: info.max };
    }

    // ─── Themed Hack Dialog (skill + luck combined) ───
    const dialogResult = await this._showHackDialog({
      title: flavor.title,
      icon: flavor.icon,
      color: flavor.color,
      subtitle: flavor.subtitle,
      skills,
      dc,
      availableLuck,
      actorName: actor.name,
      attempts: layerAttempts,
    });
    if (!dialogResult) return;

    const selectedSkill = dialogResult.skill;
    const luckSpend = dialogResult.luck;

    this._transitionActive = true;

    // Perform skill check
    const selectedDC = config.skillDCs?.[selectedSkill] ?? dc;
    const rollResult = await this.skillService.performCheck(actor, selectedSkill, {
      dc: selectedDC,
      luckSpend,
      showChat: true,
      context: `${flavor.title}: ${this.item.name}`,
      flavor: `${layer.toUpperCase()} Layer // DV ${selectedDC}`,
    });

    if (rollResult.success) {
      // Mark layer as hacked in session
      await this.dataShardService._updateActorSession(this.item, actor.id, {
        ...(layer === 'login' ? { loggedIn: true } : {}),
        ...(layer === 'keyitem' ? { keyItemUsed: true } : {}),
        hackedLayers: [...(this.dataShardService._getActorSession(
          this.dataShardService._getState(this.item), actor.id
        ).hackedLayers || []), layer],
      });

      await this._showTransitionSplash({
        icon: flavor.icon,
        iconStyle: layer === 'keyitem' ? 'gold' : layer === 'login' ? 'green' : 'accent',
        preTitle: `${selectedSkill} ${rollResult.total} vs DV ${selectedDC}`,
        title: flavor.verb,
        titleColor: flavor.color,
        progressColor: layer === 'keyitem' ? 'gold' : layer === 'login' ? 'green' : 'accent',
        footerText: 'Layer bypassed. Proceeding...',
        duration: 2000,
        sound: 'hack-success',
      });
    } else {
      // ─── Handle layer hack failure consequences ───
      if (layerSec.enabled) {
        const consequence = await this.dataShardService.handleLayerHackFailure(this.item, actor.id, layer);
        if (consequence.destroyed) {
          ui.notifications.error('NCM | Shard self-destructed! All data lost.');
        } else if (consequence.locked) {
          ui.notifications.warn(`NCM | ${flavor.title} failed. Maximum attempts exceeded — locked out.`);
        } else if (consequence.damage > 0) {
          ui.notifications.warn(`NCM | ${flavor.title} failed. BLACK ICE dealt ${consequence.damage} damage!`);
          await this._playBlackICEEffect(consequence.damage);
        } else {
          ui.notifications.warn(`NCM | ${flavor.title} failed. Roll: ${rollResult.total} vs DV ${selectedDC}.`);
        }
      } else {
        ui.notifications.warn(`NCM | ${flavor.title} failed. Roll: ${rollResult.total} vs DV ${selectedDC}.`);
      }
    }

    this._transitionActive = false;
    this._pendingUnlockSplash = true;
    this.render(true);
  }

  static async _onSpendLuck(event, target) {
    // Luck is now integrated into the Attempt Breach flow via dialog
    // This handler kept for backward compat — just triggers breach
    return this._onAttemptBreach.call(this, event, target);
  }

  /**
   * Switch network from within the shard's network overlay.
   * If the target network requires authentication, opens NetworkAuthDialog first.
   * Shows a transition splash on success before proceeding to next security layer.
   */
  static async _onSwitchNetwork(event, target) {
    const networkId = target.dataset.networkId || target.value;
    if (!networkId) return;

    const networkService = this.networkService;
    if (!networkService) return;

    try {
      const network = networkService.getNetwork?.(networkId);
      if (!network) return;

      // Check if auth is required (mirrors MessageViewerApp._onSelectNetwork)
      const requiresAuth = network.security?.requiresAuth ?? false;
      const isAuthenticated = networkService.isAuthenticated?.(networkId) ?? false;
      const isGMUser = game.user?.isGM ?? false;

      if (requiresAuth && !isAuthenticated && !isGMUser) {
        // Show auth dialog — blocks until resolved
        const result = await NetworkAuthDialog.show(networkId);
        if (!result.success) return; // Cancelled or failed — stay on current overlay
      }

      // Guard against hook-driven re-renders during transition
      this._transitionActive = true;

      // Save scroll before re-render
      const content = this.element?.querySelector('.ncm-shard-content');
      if (content) this._savedScrollTop = content.scrollTop;

      const switchResult = await networkService.switchNetwork(networkId);
      if (switchResult?.success === false) {
        this._transitionActive = false;
        ui.notifications.warn(`NCM | Could not switch to ${network.name}: ${switchResult.reason || 'unknown error'}`);
        return;
      }

      // Success — show transition splash before proceeding
      const iconColor = network.theme?.color || '#19f3f7';
      await this._showTransitionSplash({
        icon: 'fas fa-network-wired',
        iconStyle: 'accent',
        preTitle: 'NETWORK CONNECTION ESTABLISHED',
        title: network.name,
        titleColor: iconColor,
        subtitle: requiresAuth ? 'Authenticated and connected.' : 'Signal locked. Proceeding...',
        progressColor: 'accent',
        footerText: 'Verifying access...',
        duration: 2000,
        sound: 'login-success',
      });

      this._transitionActive = false;
      this._pendingUnlockSplash = true;
      this.render(true);
    } catch (err) {
      this._transitionActive = false;
      console.error('NCM | Failed to switch network from shard overlay:', err);
      ui.notifications.warn('NCM | Could not switch network.');
    }
  }

  static async _onSearchInventory(event, target) {
    if (!this.item) return;
    const actor = game.user?.character;
    if (!actor) {
      ui.notifications.warn('NCM | No character assigned.');
      return;
    }

    const config = this.dataShardService?.getConfig(this.item);
    const keyItemDisplayName = config?.keyItemDisplayName || config?.keyItemName || 'Access Token';

    // Show inventory items — exclude skills, roles, cyberware (not presentable tokens)
    const EXCLUDED_TYPES = new Set(['skill', 'role', 'cyberware']);
    const allItems = (actor.items?.contents ?? []).filter(i => !EXCLUDED_TYPES.has(i.type));
    if (allItems.length === 0) {
      ui.notifications.warn('NCM | No presentable items in inventory.');
      return;
    }

    // Sort alphabetically
    const sortedItems = [...allItems].sort((a, b) => a.name.localeCompare(b.name));

    // Build themed picker dialog with search bar
    let selectedItem = null;
    const dialogContent = `
      <div class="ncm-token-picker">
        <div class="ncm-token-picker-search">
          <i class="fas fa-search"></i>
          <input type="text" class="ncm-token-picker-input" placeholder="Search inventory..." autocomplete="off" />
        </div>
        <div class="ncm-token-picker-hint">Select an item to present as <strong>${keyItemDisplayName}</strong></div>
        <div class="ncm-token-picker-list">
          ${sortedItems.map(item => `
            <div class="ncm-token-picker-card" data-item-id="${item.id}" data-item-name="${item.name.toLowerCase()}">
              <img src="${item.img || 'icons/svg/item-bag.svg'}" class="ncm-token-picker-card-img" />
              <div class="ncm-token-picker-card-info">
                <div class="ncm-token-picker-card-name">${item.name}</div>
                <div class="ncm-token-picker-card-type">${item.type || 'Item'}</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    await new Promise(resolve => {
      const d = new Dialog({
        title: `Search Inventory — ${keyItemDisplayName}`,
        content: dialogContent,
        buttons: { cancel: { label: 'Cancel', callback: () => {} } },
        default: 'cancel',
        close: resolve,
        render: (html) => {
          const list = html[0]?.querySelector?.('.ncm-token-picker-list') ?? html.find('.ncm-token-picker-list')[0];
          const input = html[0]?.querySelector?.('.ncm-token-picker-input') ?? html.find('.ncm-token-picker-input')[0];

          // Search filtering
          input?.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase().trim();
            list?.querySelectorAll('.ncm-token-picker-card').forEach(card => {
              const name = card.dataset.itemName || '';
              card.style.display = (!query || name.includes(query)) ? '' : 'none';
            });
          });
          input?.focus();

          // Card click to select
          list?.querySelectorAll('.ncm-token-picker-card').forEach(card => {
            card.addEventListener('click', () => {
              const itemId = card.dataset.itemId;
              selectedItem = sortedItems.find(i => i.id === itemId) || null;
              d.close();
            });
          });
        },
      }, { classes: ['ncm-token-picker-dialog'], width: 340 });
      d.render(true);
    });

    if (!selectedItem) return;

    // Populate the token slot via direct DOM
    this._selectedTokenItem = selectedItem;
    const slotEmpty = this.element?.querySelector('[data-token-empty]');
    const slotFilled = this.element?.querySelector('[data-token-filled]');
    const tokenImg = this.element?.querySelector('[data-token-img]');
    const tokenName = this.element?.querySelector('[data-token-name]');
    const tokenType = this.element?.querySelector('[data-token-type]');
    const confirmBtn = this.element?.querySelector('[data-token-confirm]');

    if (slotEmpty) slotEmpty.style.display = 'none';
    if (slotFilled) { slotFilled.style.display = 'flex'; slotFilled.classList.add('ncm-sec-animate-in'); }
    if (tokenImg) { tokenImg.src = selectedItem.img || 'icons/svg/item-bag.svg'; }
    if (tokenName) tokenName.textContent = selectedItem.name;
    if (tokenType) tokenType.textContent = selectedItem.type || 'Item';
    if (confirmBtn) { confirmBtn.style.display = 'block'; confirmBtn.classList.add('ncm-sec-animate-in'); }

    this.soundService?.play('click');
  }

  static _onClearTokenSlot(event, target) {
    this._selectedTokenItem = null;
    const slotEmpty = this.element?.querySelector('[data-token-empty]');
    const slotFilled = this.element?.querySelector('[data-token-filled]');
    const confirmBtn = this.element?.querySelector('[data-token-confirm]');
    if (slotEmpty) slotEmpty.style.display = 'flex';
    if (slotFilled) slotFilled.style.display = 'none';
    if (confirmBtn) confirmBtn.style.display = 'none';
  }

  static async _onConfirmPresentToken(event, target) {
    if (!this.item || !this._selectedTokenItem) return;
    const actor = game.user?.character;
    if (!actor) return;

    const config = this.dataShardService?.getConfig(this.item);
    const selectedItem = this._selectedTokenItem;

    // Consume confirmation (only shown if config says consume on use)
    if (config?.keyItemConsumeOnUse) {
      const confirm = await Dialog.confirm({
        title: 'Consume Access Token',
        content: `<p>Using <strong>${selectedItem.name}</strong> will <strong>remove it from your inventory</strong> if correct. Continue?</p>`,
      });
      if (!confirm) return;
    }

    // Guard against updateItem hook re-render during validation + animation
    this._transitionActive = true;

    // Validate the selected item via DataShardService
    const result = await this.dataShardService.validateKeyItem(this.item, actor, selectedItem.id);

    if (result.success) {
      // ─── Correct item — show success transition ───
      await this._showTransitionSplash({
        iconHtml: `<img src="${selectedItem.img || 'icons/svg/item-bag.svg'}" style="width:40px;height:40px;border:none;border-radius:3px;" />`,
        iconStyle: 'gold',
        title: 'Token Accepted',
        titleColor: '#f7c948',
        subtitle: `<strong>${selectedItem.name}</strong> verified.${result.consumed ? ' Token consumed.' : ''}`,
        progressColor: 'gold',
        footerText: 'Access layer cleared. Proceeding...',
        duration: 2200,
        sound: 'hack-success',
      });
      this._selectedTokenItem = null;
      this._transitionActive = false;
      this._pendingUnlockSplash = true;
      this.render(true);
    } else {
      // ─── Wrong item — rejection feedback ───
      this.soundService?.play('key-rejected');

      // Shake the token slot (item stays visible during shake)
      // Force reflow so animation replays if class was previously applied
      const tokenSlot = this.element?.querySelector('[data-token-slot]');
      if (tokenSlot) {
        tokenSlot.classList.remove('ncm-sec-token-rejected');
        void tokenSlot.offsetHeight; // force reflow
        tokenSlot.classList.add('ncm-sec-token-rejected');
      }

      // Flash the status message
      const statusEl = this.element?.querySelector('[data-token-status]');
      if (statusEl) {
        statusEl.textContent = result.locked
          ? 'MAXIMUM ATTEMPTS EXCEEDED — ACCESS DENIED'
          : `TOKEN REJECTED — ${result.attemptsRemaining} attempt${result.attemptsRemaining !== 1 ? 's' : ''} remaining`;
        statusEl.classList.remove('ncm-sec-token-status-flash');
        void statusEl.offsetHeight;
        statusEl.classList.add('ncm-sec-token-status-flash');
        setTimeout(() => statusEl.classList.remove('ncm-sec-token-status-flash'), 1500);
      }

      // After shake completes, clear the slot and release the guard
      this._selectedTokenItem = null;
      setTimeout(() => {
        if (tokenSlot) tokenSlot.classList.remove('ncm-sec-token-rejected');
        const slotEmpty = this.element?.querySelector('[data-token-empty]');
        const slotFilled = this.element?.querySelector('[data-token-filled]');
        const confirmBtn = this.element?.querySelector('[data-token-confirm]');
        if (slotEmpty) slotEmpty.style.display = 'flex';
        if (slotFilled) slotFilled.style.display = 'none';
        if (confirmBtn) confirmBtn.style.display = 'none';

        this._transitionActive = false;
      }, 650);

      // If locked out, re-render to show lockout state
      if (result.locked) {
        setTimeout(() => {
          this._transitionActive = false;
          this.render(true);
        }, 1800);
      } else {
        // Update attempt dots without full re-render
        const dots = this.element?.querySelectorAll('[data-token-dot]');
        if (dots) {
          const state = this.dataShardService?._getState(this.item);
          const session = this.dataShardService?._getActorSession(state, actor.id);
          const used = session?.keyItemAttempts || 0;
          dots.forEach((dot, i) => {
            dot.classList.toggle('ncm-sec-attempt-dot--used', i < used);
            dot.classList.toggle('ncm-sec-attempt-dot--current', i === used);
          });
        }

        // Update the counter text
        const counterEl = this.element?.querySelector('[data-token-counter]');
        if (counterEl && result.attemptsRemaining !== undefined) {
          const state2 = this.dataShardService?._getState(this.item);
          const session2 = this.dataShardService?._getActorSession(state2, actor.id);
          const currentAttempt = (session2?.keyItemAttempts || 0) + 1;
          const max = config?.maxKeyItemAttempts || 3;
          counterEl.textContent = `Attempt ${currentAttempt} of ${max}`;
        }
      }
    }
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

    this._transitionActive = true;

    const result = await this.dataShardService.attemptLogin(this.item, actor, username, password);
    if (result.success) {
      await this._showTransitionSplash({
        icon: 'fas fa-user-check',
        iconStyle: 'green',
        preTitle: 'AUTHENTICATION SUCCESSFUL',
        title: 'Welcome',
        titleColor: '#00ff41',
        name: username || actor.name,
        progressColor: 'green',
        subtitle: 'Loading secure contents...',
        duration: 2500,
        sound: 'login-success',
      });
    } else if (result.locked) {
      ui.notifications.error('NCM | Account locked — too many failed attempts.');
    } else {
      ui.notifications.warn(`NCM | Login failed. ${result.attemptsRemaining ?? 0} attempts remaining.`);
    }

    this._transitionActive = false;
    this._pendingUnlockSplash = true;
    this.render(true);
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
    if (this._lockoutInterval) { clearInterval(this._lockoutInterval); this._lockoutInterval = null; }
    ui.notifications.info('NCM | Shard relocked.');
    this.render(true);
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

  // ─── Boot Sequence System (Step 3) ───

  /** @type {Array<number>} Active boot sequence timeouts for cleanup */
  _bootTimers = [];

  /**
   * Speed multipliers for boot animation timing.
   * All delays are multiplied by this factor.
   */
  static BOOT_SPEED_MULT = { fast: 0.5, normal: 1.0, dramatic: 1.4 };

  /**
   * Play the animated boot sequence splash screen.
   * Reads config.boot for icon, title, subtitle, log lines, speed, animation style.
   * Respects [data-ncm-animation] gating.
   *
   * @param {object} context — The _prepareContext result
   * @private
   */
  async _playBootSequence(context) {
    const bootEl = this.element?.querySelector('.ncm-shard-boot');
    if (!bootEl) return;

    const config = context.config?.boot ?? {};
    const animLevel = this.element?.closest('[data-ncm-animation]')?.dataset?.ncmAnimation ?? 'full';

    // Animation gating: off = skip entirely, reduced = quick fade only
    if (animLevel === 'off') {
      this._finishBoot(bootEl);
      return;
    }

    const style = config.animationStyle || 'standard-fade';
    const speedKey = config.speed || 'normal';
    const mult = speedKey === 'custom'
      ? (config.customSeconds ?? 3) / 3
      : (ItemInboxApp.BOOT_SPEED_MULT[speedKey] ?? 1.0);

    // Reduced mode: simple quick fade, no choreography
    if (animLevel === 'reduced') {
      bootEl.style.opacity = '1';
      this._buildBootDOM(bootEl, config, context);
      // Show everything immediately, quick fade out
      const allEls = bootEl.querySelectorAll('.ncm-boot-icon, .ncm-boot-title, .ncm-boot-subtitle, .ncm-boot-progress, .ncm-boot-log-line');
      allEls.forEach(el => el.style.opacity = '1');
      const fill = bootEl.querySelector('.ncm-boot-progress-fill');
      if (fill) { fill.style.transition = 'width 0.5s'; fill.style.width = '100%'; }
      this._delay(() => this._finishBoot(bootEl), 800);
      return;
    }

    // Full mode: run the choreographed sequence
    bootEl.style.opacity = '1';
    this._buildBootDOM(bootEl, config, context);
    this.soundService?.play('shard-boot');

    // Dispatch to animation style handler
    const handler = this._bootAnimations[style] ?? this._bootAnimations['standard-fade'];
    handler.call(this, bootEl, mult);
  }

  /**
   * Build boot sequence DOM elements into the container.
   * @private
   */
  _buildBootDOM(container, config, context) {
    const preset = SHARD_PRESETS[context.presetKey] ?? SHARD_PRESETS['blank'];
    const theme = preset?.theme ?? {};

    // Determine icon HTML
    let iconHTML;
    if (config.iconMode === 'image' && config.imageUrl) {
      const size = config.imageSize || 64;
      iconHTML = `<img src="${config.imageUrl}" style="width:${size}px;height:${size}px;" alt="">`;
    } else {
      const iconClass = config.faIcon || preset?.icon || 'fas fa-microchip';
      const iconColor = theme.iconColor || theme.accent || 'var(--ncm-color-primary)';
      iconHTML = `<i class="${iconClass}" style="color:${iconColor};text-shadow:0 0 30px ${iconColor}40;"></i>`;
    }

    const titleColor = theme.colorTemp === 'warm' ? '#f8f0e0' : theme.colorTemp === 'cold' ? '#e8ecf4' : '#e0e0e8';
    const subtitleColor = theme.accent || 'var(--ncm-text-muted)';
    const progressBg = theme.colorTemp === 'warm' ? '#2a1e10' : '#1a1a28';
    const progressFill = `linear-gradient(90deg, ${theme.accent || '#19f3f7'}, ${theme.accentSecondary || theme.accent || '#19f3f7'})`;
    const logColor = theme.accent ? theme.accent + '99' : 'var(--ncm-text-muted)';

    const logLinesHTML = (config.logLines || [])
      .map(line => `<div class="ncm-boot-log-line" style="color:${logColor};">${line}</div>`)
      .join('');

    container.innerHTML = `
      <div class="ncm-boot-screen-fx"></div>
      <div class="ncm-boot-scan-fx"></div>
      <div class="ncm-boot-icon">${iconHTML}</div>
      <div class="ncm-boot-title" style="color:${titleColor};">${config.title || 'DATA SHARD'}</div>
      <div class="ncm-boot-subtitle" style="color:${subtitleColor};">${config.subtitle || ''}</div>
      <div class="ncm-boot-progress">
        <div class="ncm-boot-progress-label" style="color:${logColor};">${config.progressLabel || 'Loading...'}</div>
        <div class="ncm-boot-progress-track" style="background:${progressBg};">
          <div class="ncm-boot-progress-fill" style="background:${progressFill};"></div>
        </div>
      </div>
      <div class="ncm-boot-log">${logLinesHTML}</div>
    `;
  }

  /**
   * Finish the boot sequence — fade out container, mark complete, re-render.
   * @private
   */
  _finishBoot(bootEl) {
    // Clear any pending timers
    this._bootTimers.forEach(t => clearTimeout(t));
    this._bootTimers = [];

    if (bootEl) {
      bootEl.style.transition = 'opacity 0.4s';
      bootEl.style.opacity = '0';
      this._delay(() => {
        bootEl.remove();
      }, 450);
    }

    this._bootComplete = true;
    this.eventBus?.emit(EVENTS.SHARD_BOOT_COMPLETE, { itemId: this.item?.id });
  }

  /** Schedule a callback and track the timer for cleanup. @private */
  _delay(fn, ms) {
    this._bootTimers.push(setTimeout(fn, ms));
  }

  /**
   * Animation choreography handlers. Each takes the boot container and speed multiplier.
   * @private
   */
  _bootAnimations = {

    // ─── Arasaka: Holographic snap + stepped progress ───
    'holographic-snap'(el, m) {
      const icon = el.querySelector('.ncm-boot-icon');
      const title = el.querySelector('.ncm-boot-title');
      const sub = el.querySelector('.ncm-boot-subtitle');
      const prog = el.querySelector('.ncm-boot-progress');
      const fill = el.querySelector('.ncm-boot-progress-fill');
      const lines = el.querySelectorAll('.ncm-boot-log-line');

      this._delay(() => { if (icon) icon.style.cssText += 'animation: ncm-holo-snap 0.6s ease forwards;'; }, 100 * m);
      this._delay(() => { if (title) { title.style.transition = 'opacity 0.15s'; title.style.opacity = '1'; } }, 500 * m);
      this._delay(() => { if (title) title.style.opacity = '0.4'; }, 560 * m);
      this._delay(() => { if (title) title.style.opacity = '1'; }, 620 * m);
      this._delay(() => { if (sub) { sub.style.transition = 'opacity 0.4s'; sub.style.opacity = '0.7'; } }, 700 * m);
      this._delay(() => {
        if (prog) { prog.style.transition = 'opacity 0.2s'; prog.style.opacity = '1'; }
        if (fill) fill.style.animation = `ncm-step-fill ${2 * m}s ease-out forwards`;
      }, 800 * m);
      lines.forEach((l, i) => this._delay(() => { l.style.transition = 'opacity 0.1s'; l.style.opacity = '0.7'; }, (1000 + i * 350) * m));
      this._delay(() => this._finishBoot(el), (1000 + lines.length * 350 + 500) * m);
    },

    // ─── Military: Instant dump, rapid-fire ───
    'instant-dump'(el, m) {
      const icon = el.querySelector('.ncm-boot-icon');
      const title = el.querySelector('.ncm-boot-title');
      const sub = el.querySelector('.ncm-boot-subtitle');
      const prog = el.querySelector('.ncm-boot-progress');
      const fill = el.querySelector('.ncm-boot-progress-fill');
      const lines = el.querySelectorAll('.ncm-boot-log-line');

      this._delay(() => { if (icon) icon.style.opacity = '1'; }, 50 * m);
      this._delay(() => { if (title) title.style.opacity = '1'; }, 100 * m);
      this._delay(() => { if (sub) sub.style.opacity = '0.7'; }, 150 * m);
      this._delay(() => {
        if (prog) prog.style.opacity = '1';
        if (fill) { fill.style.transition = `width ${0.3 * m}s linear`; fill.style.width = '100%'; }
      }, 200 * m);
      lines.forEach((l, i) => this._delay(() => { l.style.opacity = '0.7'; }, (300 + i * 120) * m));
      this._delay(() => this._finishBoot(el), (300 + lines.length * 120 + 400) * m);
    },

    // ─── Street: Glitch stutter + static flash ───
    'glitch-stutter'(el, m) {
      const icon = el.querySelector('.ncm-boot-icon');
      const title = el.querySelector('.ncm-boot-title');
      const sub = el.querySelector('.ncm-boot-subtitle');
      const prog = el.querySelector('.ncm-boot-progress');
      const fill = el.querySelector('.ncm-boot-progress-fill');
      const lines = el.querySelectorAll('.ncm-boot-log-line');
      const fx = el.querySelector('.ncm-boot-screen-fx');

      // Static flash
      if (fx) { fx.style.cssText = 'background:rgba(255,255,255,0.08);opacity:0.5;'; }
      this._delay(() => { if (fx) fx.style.cssText = 'opacity:0;transition:opacity 0.3s;'; }, 200 * m);
      this._delay(() => { if (icon) icon.style.cssText += 'animation: ncm-glitch-in 0.8s ease forwards;'; }, 150 * m);
      this._delay(() => { if (title) title.style.cssText += 'animation: ncm-glitch-in 0.6s ease forwards;'; }, 400 * m);
      this._delay(() => { if (sub) { sub.style.transition = 'opacity 0.3s'; sub.style.opacity = '0.5'; } }, 600 * m);
      // Second glitch
      this._delay(() => { if (fx) fx.style.cssText = 'background:rgba(255,255,255,0.06);opacity:0.4;transition:none;'; }, 700 * m);
      this._delay(() => { if (fx) fx.style.cssText = 'opacity:0;transition:opacity 0.2s;'; }, 850 * m);
      this._delay(() => {
        if (prog) { prog.style.cssText += 'opacity:1;transition:opacity 0.2s;'; }
        if (fill) fill.style.animation = `ncm-jitter-fill ${1.5 * m}s ease forwards`;
      }, 800 * m);
      lines.forEach((l, i) => this._delay(() => { l.style.transition = 'opacity 0.15s'; l.style.opacity = '0.6'; }, (1200 + i * 300) * m));
      this._delay(() => this._finishBoot(el), (1200 + lines.length * 300 + 400) * m);
    },

    // ─── Fixer: Neon breathe + flowing glow ───
    'neon-breathe'(el, m) {
      const icon = el.querySelector('.ncm-boot-icon');
      const title = el.querySelector('.ncm-boot-title');
      const sub = el.querySelector('.ncm-boot-subtitle');
      const prog = el.querySelector('.ncm-boot-progress');
      const fill = el.querySelector('.ncm-boot-progress-fill');
      const lines = el.querySelectorAll('.ncm-boot-log-line');

      this._delay(() => { if (icon) icon.style.cssText += 'animation: ncm-neon-breathe 1.2s ease forwards;'; }, 100 * m);
      this._delay(() => { if (title) { title.style.cssText += 'animation: ncm-neon-breathe 1s ease forwards;'; } }, 500 * m);
      this._delay(() => { if (sub) { sub.style.transition = 'opacity 0.6s ease'; sub.style.opacity = '0.7'; } }, 800 * m);
      this._delay(() => {
        if (prog) { prog.style.transition = 'opacity 0.5s ease'; prog.style.opacity = '1'; }
        if (fill) fill.style.animation = `ncm-smooth-fill ${2 * m}s ease-in-out forwards`;
      }, 1000 * m);
      lines.forEach((l, i) => this._delay(() => { l.style.cssText = 'animation: ncm-slide-left 0.4s ease forwards;'; }, (1200 + i * 350) * m));
      this._delay(() => this._finishBoot(el), (1200 + lines.length * 350 + 500) * m);
    },

    // ─── Black Market: Scan sweep + char-by-char typing ───
    'scan-sweep'(el, m) {
      const icon = el.querySelector('.ncm-boot-icon');
      const title = el.querySelector('.ncm-boot-title');
      const sub = el.querySelector('.ncm-boot-subtitle');
      const prog = el.querySelector('.ncm-boot-progress');
      const fill = el.querySelector('.ncm-boot-progress-fill');
      const lines = el.querySelectorAll('.ncm-boot-log-line');
      const scanFx = el.querySelector('.ncm-boot-scan-fx');

      // Scan line sweeps top to bottom
      if (scanFx) {
        scanFx.style.cssText = 'opacity:0.6;top:0;background:linear-gradient(180deg,transparent,rgba(0,229,255,0.3),transparent);height:40px;transition:top 1.5s linear;';
        this._delay(() => { scanFx.style.top = '100%'; }, 100);
        this._delay(() => { scanFx.style.opacity = '0'; }, 1600 * m);
      }
      this._delay(() => { if (icon) icon.style.cssText += 'animation: ncm-scan-reveal 0.8s ease forwards;'; }, 200 * m);
      this._delay(() => { if (title) title.style.cssText += 'animation: ncm-scan-reveal 0.6s ease forwards;'; }, 500 * m);
      this._delay(() => { if (sub) { sub.style.transition = 'opacity 0.4s'; sub.style.opacity = '0.7'; } }, 800 * m);
      this._delay(() => {
        if (prog) { prog.style.transition = 'opacity 0.3s'; prog.style.opacity = '1'; }
        if (fill) { fill.style.transition = `width ${2 * m}s linear`; fill.style.width = '100%'; }
      }, 900 * m);

      // Type characters into log lines
      lines.forEach((lineEl, i) => {
        const fullText = lineEl.textContent;
        this._delay(() => {
          lineEl.style.opacity = '1';
          lineEl.textContent = '';
          let ci = 0;
          const iv = setInterval(() => {
            if (ci < fullText.length) {
              lineEl.textContent = fullText.substring(0, ci + 1);
              ci++;
            } else {
              clearInterval(iv);
            }
          }, 18 * m);
          this._bootTimers.push(iv);
        }, (1100 + i * 500) * m);
      });
      this._delay(() => this._finishBoot(el), (1100 + lines.length * 500 + 400) * m);
    },

    // ─── Memory: Warm dissolve + gentle fade ───
    'warm-dissolve'(el, m) {
      const icon = el.querySelector('.ncm-boot-icon');
      const title = el.querySelector('.ncm-boot-title');
      const sub = el.querySelector('.ncm-boot-subtitle');
      const prog = el.querySelector('.ncm-boot-progress');
      const fill = el.querySelector('.ncm-boot-progress-fill');
      const lines = el.querySelectorAll('.ncm-boot-log-line');

      this._delay(() => { if (icon) icon.style.cssText += 'animation: ncm-warm-dissolve 1.5s ease forwards;'; }, 200 * m);
      this._delay(() => { if (title) title.style.cssText += 'animation: ncm-warm-dissolve 1.2s ease forwards;'; }, 700 * m);
      this._delay(() => { if (sub) { sub.style.transition = 'opacity 1s ease'; sub.style.opacity = '0.6'; } }, 1100 * m);
      this._delay(() => {
        if (prog) { prog.style.transition = 'opacity 0.8s ease'; prog.style.opacity = '1'; }
        if (fill) { fill.style.transition = `width ${2.5 * m}s ease-in-out`; fill.style.width = '100%'; }
      }, 1300 * m);
      lines.forEach((l, i) => this._delay(() => { l.style.transition = 'opacity 0.8s ease'; l.style.opacity = '0.6'; }, (1600 + i * 500) * m));
      this._delay(() => this._finishBoot(el), (1600 + lines.length * 500 + 600) * m);
    },

    // ─── Media: Camera flash + news slide-in ───
    'camera-flash'(el, m) {
      const icon = el.querySelector('.ncm-boot-icon');
      const title = el.querySelector('.ncm-boot-title');
      const sub = el.querySelector('.ncm-boot-subtitle');
      const prog = el.querySelector('.ncm-boot-progress');
      const fill = el.querySelector('.ncm-boot-progress-fill');
      const lines = el.querySelectorAll('.ncm-boot-log-line');
      const fx = el.querySelector('.ncm-boot-screen-fx');

      // Camera flash
      if (fx) fx.style.cssText = 'background:rgba(96,176,255,0.2);animation:ncm-camera-flash 0.5s ease forwards;';
      this._delay(() => { if (icon) icon.style.opacity = '1'; }, 50 * m);
      this._delay(() => { if (title) title.style.cssText += 'animation: ncm-news-slide 0.4s ease forwards;'; }, 300 * m);
      this._delay(() => { if (sub) sub.style.cssText += 'animation: ncm-news-slide 0.35s ease forwards; opacity: 0.7;'; }, 500 * m);
      this._delay(() => {
        if (prog) { prog.style.cssText += 'opacity:1;transition:opacity 0.15s;'; }
        if (fill) fill.style.animation = `ncm-urgent-fill ${1.5 * m}s ease forwards`;
      }, 600 * m);
      lines.forEach((l, i) => this._delay(() => { l.style.transition = 'opacity 0.1s'; l.style.opacity = '0.7'; }, (800 + i * 280) * m));
      this._delay(() => this._finishBoot(el), (800 + lines.length * 280 + 500) * m);
    },

    // ─── NetWatch: Red sweep + authority stamp ───
    'authority-stamp'(el, m) {
      const icon = el.querySelector('.ncm-boot-icon');
      const title = el.querySelector('.ncm-boot-title');
      const sub = el.querySelector('.ncm-boot-subtitle');
      const prog = el.querySelector('.ncm-boot-progress');
      const fill = el.querySelector('.ncm-boot-progress-fill');
      const lines = el.querySelectorAll('.ncm-boot-log-line');
      const fx = el.querySelector('.ncm-boot-screen-fx');

      // Red security sweep
      if (fx) fx.style.cssText = 'background:rgba(220,30,30,0.12);animation:ncm-red-sweep 1.2s ease forwards;';
      this._delay(() => { if (icon) icon.style.cssText += 'animation: ncm-stamp-in 0.5s ease forwards;'; }, 400 * m);
      this._delay(() => { if (title) { title.style.transition = 'opacity 0.2s'; title.style.opacity = '1'; } }, 700 * m);
      this._delay(() => { if (sub) { sub.style.transition = 'opacity 0.3s'; sub.style.opacity = '0.7'; } }, 900 * m);
      this._delay(() => {
        if (prog) { prog.style.transition = 'opacity 0.2s'; prog.style.opacity = '1'; }
        if (fill) { fill.style.transition = `width ${1.8 * m}s linear`; fill.style.width = '100%'; }
      }, 1000 * m);
      lines.forEach((l, i) => this._delay(() => { l.style.transition = 'opacity 0.15s'; l.style.opacity = '0.7'; }, (1200 + i * 350) * m));
      this._delay(() => this._finishBoot(el), (1200 + lines.length * 350 + 500) * m);
    },

    // ─── Default: Standard fade ───
    'standard-fade'(el, m) {
      const icon = el.querySelector('.ncm-boot-icon');
      const title = el.querySelector('.ncm-boot-title');
      const sub = el.querySelector('.ncm-boot-subtitle');
      const prog = el.querySelector('.ncm-boot-progress');
      const fill = el.querySelector('.ncm-boot-progress-fill');
      const lines = el.querySelectorAll('.ncm-boot-log-line');

      this._delay(() => { if (icon) icon.style.cssText += 'animation: ncm-standard-fade 0.6s ease forwards;'; }, 100 * m);
      this._delay(() => { if (title) { title.style.transition = `opacity ${0.4 * m}s`; title.style.opacity = '1'; } }, 400 * m);
      this._delay(() => { if (sub) { sub.style.transition = `opacity ${0.4 * m}s`; sub.style.opacity = '0.7'; } }, 600 * m);
      this._delay(() => {
        if (prog) { prog.style.transition = 'opacity 0.3s'; prog.style.opacity = '1'; }
        if (fill) { fill.style.animation = `ncm-standard-fill ${1.5 * m}s ease forwards`; }
      }, 800 * m);
      lines.forEach((l, i) => this._delay(() => { l.style.transition = `opacity ${0.3 * m}s`; l.style.opacity = '0.7'; }, (1000 + i * 300) * m));
      this._delay(() => this._finishBoot(el), (1000 + lines.length * 300 + 500) * m);
    },
  };

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

    // Guard against hook re-renders during animation
    this._transitionActive = true;

    const result = await this.dataShardService.claimEddies(this.item, entryId, actor);
    if (result.success) {
      // ─── Transfer animation ───
      const amount = result.amount ?? 0;

      // Animate the claim button to "processing" state
      const btn = target.closest('[data-action="claimEddies"]') || target;
      if (btn) {
        btn.classList.add('ncm-eddies-claim-btn--processing');
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Transferring...';
      }

      await new Promise(r => setTimeout(r, 600));

      // Show the transfer splash
      await this._showTransitionSplash({
        icon: 'fas fa-coins',
        iconStyle: 'gold',
        preTitle: 'WIRE TRANSFER COMPLETE',
        title: `${amount.toLocaleString()} eb`,
        titleColor: '#00ff41',
        name: actor.name,
        subtitle: 'Funds deposited to wealth ledger.',
        progressColor: 'green',
        footerText: 'Transaction verified.',
        duration: 2200,
        sound: 'eddies-claim',
      });
    } else {
      ui.notifications.warn(`NCM | ${result.error || 'Claim failed.'}`);
    }

    this._transitionActive = false;
    this.render(true);
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

  static async _onExecutePayload(event, target) {
    if (!this.item) return;
    const entryId = target.closest('[data-entry-id]')?.dataset.entryId;
    if (!entryId) return;

    const confirmed = await Dialog.confirm({
      title: 'Execute Payload',
      content: '<p style="color:#ff0033;"><strong>WARNING:</strong> Executing this program may have consequences. Proceed?</p>',
    });
    if (!confirmed) return;

    // Mark payload as executed on the journal page
    const journal = this.dataShardService?._getLinkedJournal(this.item);
    if (!journal) return;
    const page = journal.pages.find(p => p.flags?.[MODULE_ID]?.messageId === entryId);
    if (!page) return;

    const actor = game.user?.character;
    await page.update({
      [`flags.${MODULE_ID}.contentData.executed`]: true,
      [`flags.${MODULE_ID}.contentData.executedBy`]: actor?.id ?? null,
      [`flags.${MODULE_ID}.contentData.executedAt`]: new Date().toISOString(),
    });

    // Chat notification
    await ChatMessage.create({
      content: `<div style="border-left:3px solid #a855f7;padding:4px 8px;"><strong style="color:#a855f7;">⚡ PAYLOAD EXECUTED</strong><br>${page.flags?.[MODULE_ID]?.contentData?.name ?? 'Unknown Program'}<br><small>Executed by ${actor?.name ?? 'Unknown'}</small></div>`,
      speaker: ChatMessage.getSpeaker({ alias: 'NCM System' }),
    });

    ui.notifications.warn('NCM | Payload executed.');
    this.render();
  }

  static _onGoToScene(event, target) {
    const sceneId = target.closest('[data-scene-id]')?.dataset.sceneId;
    if (!sceneId) return;
    const scene = game.scenes?.get(sceneId);
    if (!scene) {
      ui.notifications.warn('NCM | Scene not found.');
      return;
    }
    scene.view();
    ui.notifications.info(`NCM | Viewing scene: ${scene.name}`);
  }

  static _onEditEntry(event, target) {
    if (!isGM() || !this.item) return;
    const entryId = target.closest('[data-entry-id]')?.dataset.entryId;
    if (!entryId) return;

    // Read existing entry data from the journal page
    const journal = this.dataShardService?._getLinkedJournal(this.item);
    if (!journal) return;
    const page = journal.pages.find(p => p.flags?.[MODULE_ID]?.messageId === entryId);
    if (!page) return;

    const flags = page.flags?.[MODULE_ID] ?? {};
    const editData = {
      entryId,
      contentType: flags.contentType || 'message',
      from: flags.from || '',
      subject: flags.subject || '',
      body: page.text?.content || '',
      timestamp: flags.timestamp || '',
      encrypted: flags.encrypted || false,
      encryptionDC: flags.encryptionDC,
      contentData: flags.contentData ?? {},
      networkVisibility: flags.networkVisibility ?? {},
    };

    import('./DataShardComposer.js').then(({ DataShardComposer }) => {
      new DataShardComposer({
        shardItem: this.item,
        editData,
        onSave: () => this.render(true),
      }).render(true);
    });
  }

  // ─── Effects ───

  /** @private — Orchestrate the full hacking terminal sequence */
  async _playHackSequence(result, skillName, luckSpend = 0) {
    const el = this.element;
    if (!el) return;

    const config = this.dataShardService?.getConfig(this.item) ?? {};
    const terminal = el.querySelector('[data-hack-terminal]');
    const progressFill = el.querySelector('[data-hack-progress-fill]');
    const progressLabel = el.querySelector('[data-hack-progress-label]');
    const rollDisplay = el.querySelector('[data-hack-roll-player]');
    const iceFill = el.querySelector('[data-ice-fill]');
    const iceStructure = el.querySelector('[data-ice-structure]');
    const resultOverlay = el.querySelector('[data-hack-result]');
    if (!terminal) return;

    // Helpers
    const _timers = [];
    const delay = (fn, ms) => new Promise(resolve => {
      _timers.push(setTimeout(() => { fn(); resolve(); }, ms));
    });
    const addLine = (cls, text) => {
      const div = document.createElement('div');
      div.className = `ncm-hack-line ncm-hack-line--${cls}`;
      div.innerHTML = text;
      // Insert before cursor
      const cursor = terminal.querySelector('.ncm-hack-cursor');
      if (cursor) terminal.insertBefore(div, cursor);
      else terminal.appendChild(div);
      terminal.scrollTop = terminal.scrollHeight;
    };
    const setProgress = (pct, label) => {
      if (progressFill) progressFill.style.width = `${pct}%`;
      if (progressLabel) progressLabel.textContent = label;
    };
    const setIce = (pct) => { if (iceFill) iceFill.style.width = `${pct}%`; };

    const rollData = result.roll ?? {};
    const total = rollData.total ?? 0;
    const dieRoll = rollData.processedRoll ?? rollData.rollValue ?? 0;
    const dv = rollData.dc ?? 0;
    const base = (rollData.statValue ?? 0) + (rollData.skillLevel ?? 0) + (rollData.luckSpent ?? 0);
    const encType = result.encryptionType || config?.encryptionType || 'ICE';
    const ice = result.iceInfo;
    const iceName = ice?.name || encType;

    // Phase 1: Init
    addLine('system', `░░ NCM BREACH PROTOCOL v4.6 ░░`);
    await delay(() => addLine('system', `Target: DATA SHARD // Encryption: ${iceName}`), 200);
    await delay(() => { addLine('blank', ''); setProgress(10, 'Mapping ICE architecture...'); }, 300);

    // Phase 2: Scan
    await delay(() => addLine('prompt', 'Initializing ICE scan...'), 400);
    await delay(() => addLine('data', `0x${Math.random().toString(16).slice(2,6).toUpperCase()} :: scanning port matrix :: vectors loaded`), 500);
    await delay(() => addLine('data', `0x${Math.random().toString(16).slice(2,6).toUpperCase()} :: firewall topology mapped :: layers detected`), 500);
    await delay(() => { addLine('prompt', 'ICE architecture mapped.'); setProgress(25, 'Probing defenses...'); setIce(90); }, 400);

    // Phase 3: Probe
    await delay(() => addLine('blank', ''), 200);
    await delay(() => addLine('ice', `⚠ ${iceName} DETECTED — COUNTERMEASURES ARMED`), 400);
    if (encType === 'BLACK_ICE' || encType === 'RED_ICE') {
      const iceClassStr = ice?.class ? ` [${ice.class}]` : '';
      const iceAtkStr = ice?.atk ? ` // ATK: ${ice.atk}` : '';
      await delay(() => addLine('warn', `WARNING: Lethal ICE${iceClassStr}${iceAtkStr}. Failure may cause system damage.`), 400);
    }
    await delay(() => { setProgress(40, 'Selecting exploit...'); }, 200);
    await delay(() => addLine('prompt', `Selecting exploit vector: ${skillName}`), 400);
    const luckStr = luckSpend > 0 ? ` + Luck ${luckSpend}` : '';
    await delay(() => addLine('data', `Base total: ${base}${luckStr} + 1d10`), 300);
    await delay(() => { setProgress(55, 'Injecting exploit...'); setIce(75); }, 300);

    // Phase 4: Inject
    await delay(() => addLine('blank', ''), 200);
    await delay(() => addLine('prompt', 'Injecting exploit into layer 1...'), 400);
    await delay(() => addLine('data', `0x${Math.random().toString(16).slice(2,6).toUpperCase()} :: buffer overflow targeting auth handler`), 500);
    await delay(() => addLine('prompt', 'Layer 1 response: <span style="color:#ffab00;">PARTIAL</span>'), 400);
    await delay(() => { setProgress(70, 'Escalating...'); setIce(55); }, 300);
    await delay(() => addLine('prompt', 'Escalating to layer 2...'), 400);
    await delay(() => { setProgress(85, 'Rolling dice...'); }, 300);

    // Phase 5: Roll
    await delay(() => { addLine('blank', ''); addLine('prompt', '<i class="fas fa-dice" style="margin-right:4px;"></i>Rolling 1d10...'); }, 400);

    // Show roll display and tumble
    if (rollDisplay) {
      rollDisplay.style.opacity = '1';
      const rollValueEl = rollDisplay.querySelector('.ncm-hack-roll-value');
      if (rollValueEl) {
        let count = 0;
        await new Promise(resolve => {
          const tumble = setInterval(() => {
            rollValueEl.textContent = Math.floor(Math.random() * 10) + 1;
            count++;
            if (count > 10) {
              clearInterval(tumble);
              rollValueEl.textContent = dieRoll;
              rollValueEl.style.color = result.success ? '#00ff41' : '#ff0033';
              resolve();
            }
          }, 80);
          _timers.push(tumble);
        });
      }
    }

    await delay(() => {
      addLine('roll', `1d10 → <span style="color:${result.success ? '#00ff41' : '#ff0033'};font-size:14px;">${dieRoll}</span>`);
    }, 200);
    await delay(() => {
      const luckTxt = luckSpend > 0 ? ` + Luck(${luckSpend})` : '';
      addLine('roll', `Total: ${base}${luckTxt} + ${dieRoll} = <span style="color:${result.success ? '#00ff41' : '#ff0033'};font-size:14px;">${total}</span> vs DV ${dv}`);
      setProgress(100, result.success ? 'ICE BREACHED' : 'BREACH FAILED');
    }, 400);

    // Phase 6: Result
    if (result.success) {
      await delay(() => {
        addLine('blank', '');
        addLine('success', '██ ICE BREACHED ██ ACCESS GRANTED ██');
        if (iceStructure) iceStructure.classList.add('ncm-ice-shatter');
        setIce(0);
      }, 500);
      this.soundService?.play('hack-success');
    } else {
      await delay(() => {
        addLine('blank', '');
        addLine('fail', '██ BREACH FAILED ██ ICE HOLDING ██');
        if (iceStructure) iceStructure.classList.add('ncm-ice-retaliate');
      }, 500);
      if (result.damage) {
        await delay(() => {
          addLine('ice', `⚡ ${iceName} RETALIATION — DAMAGE INCOMING`);
        }, 400);
        await delay(() => {
          const formulaStr = result.damageFormula ? ` (${result.damageFormula})` : '';
          addLine('damage', `→ ${iceName} deals ${result.damage} HP damage${formulaStr}`);
        }, 400);
      }
    }

    // Compute attempts remaining from config
    const session = this.dataShardService?._getActorSession(
      this.dataShardService?._getState(this.item),
      game.user?.character?.id
    ) ?? {};
    const attemptsRemaining = Math.max(0, (config.maxHackAttempts || 3) - (session.hackAttempts || 0));

    // Show result overlay
    await delay(() => {
      if (resultOverlay) {
        resultOverlay.style.display = 'flex';
        resultOverlay.innerHTML = this._buildHackResultHTML(result, skillName, base, dieRoll, total, dv, attemptsRemaining, luckSpend);
      }
    }, 600);

    // Wait for click to dismiss
    await new Promise(resolve => {
      const dismiss = () => { resultOverlay?.removeEventListener('click', dismiss); resolve(); };
      resultOverlay?.addEventListener('click', dismiss);
      // Auto-dismiss after 8s
      _timers.push(setTimeout(dismiss, 8000));
    });

    // Clean up timers
    _timers.forEach(t => clearTimeout(t));
  }

  /** @private — Build HTML for hack result overlay */
  _buildHackResultHTML(result, skillName, base, dieRoll, total, dv, attemptsRemaining = 0, luckSpend = 0) {
    const luckStr = luckSpend > 0 ? ` + Luck(<span class="roll">${luckSpend}</span>)` : '';
    if (result.success) {
      return `<div class="ncm-hack-result-card">
        <div class="ncm-hack-result-icon ncm-hack-result-icon--success"><i class="fas fa-lock-open"></i></div>
        <div class="ncm-hack-result-title ncm-hack-result-title--success">Access Granted</div>
        <div class="ncm-hack-result-sub">ICE neutralized. Shard contents unlocked.</div>
        <div class="ncm-hack-roll-reveal">
          <div class="ncm-hack-roll-block"><div class="ncm-hack-roll-block-label">Your Roll</div><div class="ncm-hack-roll-block-value ncm-hack-roll-block-value--player">${total}</div></div>
          <div class="ncm-hack-roll-divider">vs</div>
          <div class="ncm-hack-roll-block"><div class="ncm-hack-roll-block-label">DV</div><div class="ncm-hack-roll-block-value ncm-hack-roll-block-value--dv">${dv}</div></div>
        </div>
        <div class="ncm-hack-roll-breakdown">${skillName} <span style="color:var(--sp-text-bright)">${base}</span>${luckStr} + 1d10 (<span style="color:#00ff41">${dieRoll}</span>) = <span style="color:#00ff41;font-weight:700">${total}</span></div>
        <div class="ncm-hack-result-continue">Click to load shard contents...</div>
      </div>`;
    } else {
      let damageHTML = '';
      if (result.damage) {
        const ice = result.iceInfo;
        const diceStr = result.diceResults?.length ? result.diceResults.join(', ') : '';
        const icePortrait = ice?.img
          ? `<img src="${ice.img}" alt="${ice.name}" class="ncm-hack-damage-portrait" />`
          : '';
        const iceName = ice?.name || 'Black ICE';
        const iceClassTag = ice?.class ? ` <span class="ncm-hack-damage-class">${ice.class}</span>` : '';
        damageHTML = `<div class="ncm-hack-damage-box">
          ${icePortrait}
          <div class="ncm-hack-damage-info">
            <div class="ncm-hack-damage-label"><i class="fas fa-bolt" style="margin-right:4px;"></i> ${iceName} Retaliation${iceClassTag}</div>
            <div class="ncm-hack-damage-value">${result.damage} HP</div>
            ${diceStr ? `<div class="ncm-hack-damage-hp">${result.damageFormula || '3d6'} → [${diceStr}]</div>` : ''}
          </div>
        </div>`;
      }
      return `<div class="ncm-hack-result-card">
        <div class="ncm-hack-result-icon ncm-hack-result-icon--fail"><i class="fas fa-shield-halved"></i></div>
        <div class="ncm-hack-result-title ncm-hack-result-title--fail">Breach Failed</div>
        <div class="ncm-hack-result-sub">ICE countermeasures engaged.</div>
        <div class="ncm-hack-roll-reveal">
          <div class="ncm-hack-roll-block"><div class="ncm-hack-roll-block-label">Your Roll</div><div class="ncm-hack-roll-block-value" style="color:#ff0033">${total}</div></div>
          <div class="ncm-hack-roll-divider">vs</div>
          <div class="ncm-hack-roll-block"><div class="ncm-hack-roll-block-label">DV</div><div class="ncm-hack-roll-block-value ncm-hack-roll-block-value--dv">${dv}</div></div>
        </div>
        <div class="ncm-hack-roll-breakdown">${skillName} <span style="color:var(--sp-text-bright)">${base}</span>${luckStr} + 1d10 (<span style="color:#ff0033">${dieRoll}</span>) = <span style="color:#ff0033;font-weight:700">${total}</span></div>
        ${damageHTML}
        <div class="ncm-hack-result-sub" style="font-size:9px;color:var(--sp-text-muted);">${attemptsRemaining} attempt${attemptsRemaining !== 1 ? 's' : ''} remaining.</div>
        <div class="ncm-hack-result-continue">Click to continue...</div>
      </div>`;
    }
  }

  /** @private — Legacy effect for backward compat */
  async _playHackSuccessEffect() {
    this.soundService?.play('hack-success');
  }

  /** @private */
  async _playHackFailEffect(result) {
    const el = this.element;
    if (!el) return;
    el.classList.add('ncm-screen-shake');
    await new Promise(r => setTimeout(r, 500));
    el.classList.remove('ncm-screen-shake');
  }

  /**
   * Show a themed hack dialog combining skill selection + luck spending.
   * Includes odds gauge, segmented luck, attempt dots, BLACK ICE danger zone.
   * @param {object} opts
   * @param {string} opts.title - Dialog title
   * @param {string} opts.icon - FontAwesome class
   * @param {string} opts.color - Accent color hex
   * @param {Array} [opts.skills] - Skill objects from SkillService
   * @param {string} [opts.preSelectedSkill] - Skip skill selection
   * @param {number} [opts.preSelectedTotal] - Pre-selected total
   * @param {number} opts.dc - Difficulty value
   * @param {number} opts.availableLuck - Actor's luck
   * @param {string} opts.actorName - Actor name
   * @param {string} [opts.subtitle] - Line below title
   * @param {boolean} [opts.isBlackICE] - Danger zone
   * @param {string} [opts.encryptionType] - For damage formula
   * @param {{current:number, max:number}} [opts.attempts] - Attempt tracking
   * @returns {Promise<{skill:string, luck:number}|null>}
   * @private
   */
  async _showHackDialog(opts) {
    let selectedSkill = opts.preSelectedSkill || null;
    let selectedTotal = opts.preSelectedTotal || 0;
    let selectedDC = opts.dc;
    let luckSpend = 0;
    let cancelled = true;

    // Compute odds: P(total + 1d10 + luck >= DC) where 1d10 is [1..10]
    const calcOdds = (total, luck, dc) => {
      const needed = dc - total - luck;
      if (needed <= 1) return 100;
      if (needed > 10) return 0;
      return Math.round(((10 - needed + 1) / 10) * 100);
    };

    // ─── Skill list ───
    let skillListHTML = '';
    if (opts.skills?.length) {
      const skillRows = opts.skills.map(s => {
        const dc = s.dc ?? opts.dc;
        return `<button type="button" class="ncm-hd-skill-btn" data-skill="${s.name}" data-total="${s.total}" data-stat="${s.stat}" data-dc="${dc}">
          <div class="ncm-hd-skill-check"><i class="fas fa-check"></i></div>
          <span class="ncm-hd-skill-name">${s.name}</span>
          <span class="ncm-hd-skill-detail">${s.stat} ${s.total} + 1d10</span>
          <span class="ncm-hd-skill-total">${s.total}</span>
        </button>`;
      }).join('');
      skillListHTML = `
        <div class="ncm-hd-section-label"><i class="fas fa-crosshairs"></i> SELECT SKILL</div>
        <div class="ncm-hd-skill-list">${skillRows}</div>`;
    } else if (opts.preSelectedSkill) {
      skillListHTML = `
        <div class="ncm-hd-section-label"><i class="fas fa-check-circle" style="color:#00ff41;"></i> SKILL LOCKED</div>
        <div class="ncm-hd-skill-list">
          <div class="ncm-hd-skill-btn ncm-hd-skill-btn--selected">
            <div class="ncm-hd-skill-check"><i class="fas fa-check"></i></div>
            <span class="ncm-hd-skill-name">${opts.preSelectedSkill}</span>
            <span class="ncm-hd-skill-detail">&nbsp;</span>
            <span class="ncm-hd-skill-total">${opts.preSelectedTotal || '?'}</span>
          </div>
        </div>`;
    }

    // ─── BLACK ICE danger zone ───
    const isBlackICE = opts.isBlackICE || opts.encryptionType === 'BLACK_ICE' || opts.encryptionType === 'RED_ICE';
    const ice = opts.iceInfo;
    let dangerHTML = '';
    if (isBlackICE) {
      const iceImgHTML = ice?.img
        ? `<img src="${ice.img}" alt="${ice.name}" class="ncm-hd-danger-portrait" />`
        : `<div class="ncm-hd-danger-icon"><i class="fas fa-radiation"></i></div>`;
      const iceName = ice?.name || (opts.encryptionType === 'RED_ICE' ? 'RED ICE' : 'BLACK ICE');
      const iceClassHTML = ice?.class ? `<span class="ncm-hd-danger-class">${ice.class}</span>` : '';
      const formulaLabel = ice?.formula || (opts.encryptionType === 'RED_ICE' ? '5d6' : '3d6');
      dangerHTML = `
      <div class="ncm-hd-danger">
        ${iceImgHTML}
        <div class="ncm-hd-danger-text">
          <div class="ncm-hd-danger-label">${iceName} — Lethal Countermeasures ${iceClassHTML}</div>
          <div class="ncm-hd-danger-sub">Failure deals <strong>${formulaLabel}</strong> damage directly.</div>
        </div>
      </div>`;
    }

    // ─── Luck gauge (segmented) ───
    const maxLuck = opts.availableLuck || 0;
    let luckHTML = '';
    if (maxLuck > 0) {
      const segs = Array.from({ length: maxLuck }, (_, i) => `<div class="ncm-hd-luck-seg" data-seg="${i}"></div>`).join('');
      luckHTML = `
        <div class="ncm-hd-section-label"><i class="fas fa-clover"></i> LUCK BOOST <span class="ncm-hd-luck-avail">Available: ${maxLuck}</span></div>
        <div class="ncm-hd-luck-row">
          <button type="button" class="ncm-hd-luck-adj" data-adj="-1">&minus;</button>
          <div class="ncm-hd-luck-gauge">${segs}</div>
          <button type="button" class="ncm-hd-luck-adj" data-adj="+1">+</button>
          <span class="ncm-hd-luck-val ncm-hd-luck-val--zero">0</span>
        </div>`;
    } else {
      luckHTML = `<div class="ncm-hd-section-label" style="opacity:0.4;"><i class="fas fa-clover"></i> NO LUCK AVAILABLE</div>`;
    }

    // ─── Odds gauge + breakdown ───
    const initOdds = selectedSkill ? calcOdds(selectedTotal, 0, selectedDC) : 0;
    const oddsClass = initOdds >= 60 ? 'high' : initOdds >= 30 ? 'mid' : 'low';
    const oddsHTML = `
      <div class="ncm-hd-odds">
        <div class="ncm-hd-odds-header">
          <span class="ncm-hd-odds-label">Success Probability</span>
          <span class="ncm-hd-odds-pct ${oddsClass}" data-odds-pct>${selectedSkill ? initOdds + '%' : '—'}</span>
        </div>
        <div class="ncm-hd-odds-track">
          <div class="ncm-hd-odds-fill ${oddsClass}" data-odds-fill style="width:${selectedSkill ? initOdds : 0}%;"></div>
        </div>
      </div>
      <div class="ncm-hd-breakdown" data-breakdown>
        ${selectedSkill
          ? `<span class="ncm-hd-val">${selectedTotal}</span> <span class="ncm-hd-op">+</span> <span class="ncm-hd-die">1d10</span> <span class="ncm-hd-op" style="margin:0 4px;">vs</span> <span class="ncm-hd-vs">DV ${selectedDC}</span>`
          : 'Select a skill...'}
      </div>`;

    // ─── Attempt dots ───
    let attemptsHTML = '';
    if (opts.attempts) {
      const dots = [];
      for (let i = 1; i <= opts.attempts.max; i++) {
        if (i < opts.attempts.current) dots.push('<div class="ncm-hd-attempt-dot ncm-hd-attempt-dot--used"></div>');
        else if (i === opts.attempts.current) dots.push('<div class="ncm-hd-attempt-dot ncm-hd-attempt-dot--current"></div>');
        else dots.push('<div class="ncm-hd-attempt-dot"></div>');
      }
      attemptsHTML = `<div class="ncm-hd-attempts"><span class="ncm-hd-attempts-label">Attempt</span>${dots.join('')}</div>`;
    }

    const content = `
      <div class="ncm-hd-body">
        <div class="ncm-hd-header">
          <div class="ncm-hd-icon" style="color:${opts.color || 'var(--sp-accent)'};">
            <i class="${opts.icon || 'fas fa-bolt'}"></i>
          </div>
          ${opts.subtitle ? `<div class="ncm-hd-subtitle">${opts.subtitle}</div>` : ''}
        </div>
        ${dangerHTML}
        ${skillListHTML}
        ${luckHTML}
        ${oddsHTML}
        ${attemptsHTML}
      </div>`;

    const themeClass = isBlackICE ? 'ncm-hd-theme-black'
      : opts.color === '#f7c948' ? 'ncm-hd-theme-gold'
      : opts.color === '#00ff41' ? 'ncm-hd-theme-green'
      : 'ncm-hd-theme-cyan';
    const execLabel = isBlackICE ? 'Risk Breach' : 'Execute';
    const execIcon = isBlackICE ? 'fas fa-skull-crossbones' : 'fas fa-bolt';

    await new Promise(resolve => {
      const d = new Dialog({
        title: opts.title || 'Breach Attempt',
        content,
        buttons: {
          execute: { icon: `<i class="${execIcon}"></i>`, label: execLabel, callback: () => { cancelled = false; } },
          cancel: { icon: '<i class="fas fa-times"></i>', label: 'Abort', callback: () => {} },
        },
        default: 'cancel',
        close: () => resolve(),
        render: html => {
          const jq = html.closest ? html : $(html);
          const body = jq.find('.ncm-hd-body').length ? jq : jq.parent();

          const updateAll = () => {
            const odds = selectedSkill ? calcOdds(selectedTotal, luckSpend, selectedDC) : 0;
            const cls = odds >= 60 ? 'high' : odds >= 30 ? 'mid' : 'low';
            body.find('[data-odds-pct]').text(selectedSkill ? odds + '%' : '—').removeClass('high mid low').addClass(cls);
            body.find('[data-odds-fill]').css('width', (selectedSkill ? odds : 0) + '%').removeClass('high mid low').addClass(cls);

            const bd = body.find('[data-breakdown]');
            if (!selectedSkill) { bd.html('Select a skill...'); }
            else {
              let p = `<span class="ncm-hd-val">${selectedTotal}</span> <span class="ncm-hd-op">+</span> <span class="ncm-hd-die">1d10</span>`;
              if (luckSpend > 0) p += ` <span class="ncm-hd-op">+</span> <span class="ncm-hd-luck-color">${luckSpend} LUCK</span>`;
              p += ` <span class="ncm-hd-op" style="margin:0 4px;">vs</span> <span class="ncm-hd-vs">DV ${selectedDC}</span>`;
              bd.html(p);
            }

            const execBtn = body.closest('.dialog').find('button[data-button="execute"]');
            execBtn.prop('disabled', !selectedSkill).toggleClass('ncm-hd-btn--disabled', !selectedSkill);
          };

          body.find('.ncm-hd-skill-btn').on('click', function () {
            selectedSkill = this.dataset.skill;
            selectedTotal = parseInt(this.dataset.total) || 0;
            selectedDC = parseInt(this.dataset.dc) || opts.dc;
            body.find('.ncm-hd-skill-btn').removeClass('ncm-hd-skill-btn--selected');
            $(this).addClass('ncm-hd-skill-btn--selected');
            updateAll();
          });

          body.find('.ncm-hd-luck-adj').on('click', function () {
            luckSpend = Math.max(0, Math.min(maxLuck, luckSpend + parseInt(this.dataset.adj)));
            body.find('.ncm-hd-luck-val').text(luckSpend).toggleClass('ncm-hd-luck-val--zero', luckSpend === 0);
            body.find('.ncm-hd-luck-seg').each(function (i) { $(this).toggleClass('ncm-hd-luck-seg--filled', i < luckSpend); });
            updateAll();
          });

          if (!selectedSkill) body.closest('.dialog').find('button[data-button="execute"]').prop('disabled', true).addClass('ncm-hd-btn--disabled');
        },
      }, { classes: ['dialog', 'ncm-hack-dialog', themeClass], width: 360 });
      d.render(true);
    });

    if (cancelled || !selectedSkill) return null;
    return { skill: selectedSkill, luck: luckSpend };
  }

  /**
   * Show a full-screen transition splash overlay.
   * Injects directly into .ncm-item-inbox — bulletproof regardless of template state.
   * @param {object} opts
   * @param {string} [opts.icon] - FontAwesome icon class (e.g. 'fas fa-user-check')
   * @param {string} [opts.iconHtml] - Raw HTML for icon content (e.g. img tag)
   * @param {string} [opts.iconStyle] - 'green' | 'gold' | 'accent' | 'red'
   * @param {string} [opts.preTitle] - Small text above title
   * @param {string} [opts.title] - Main title
   * @param {string} [opts.titleColor] - CSS color
   * @param {string} [opts.name] - Large name text below title (e.g. username)
   * @param {string} [opts.subtitle] - Secondary text (supports HTML)
   * @param {string} [opts.progressColor] - 'green' | 'gold' | 'accent' | 'red'
   * @param {string} [opts.footerText] - Small muted text at bottom
   * @param {number} [opts.duration] - Milliseconds to display (default 2000)
   * @param {string} [opts.sound] - Sound to play
   * @private
   */
  async _showTransitionSplash(opts = {}) {
    const inbox = this.element?.querySelector('.ncm-item-inbox') || this.element;
    if (!inbox) return;

    const iconContent = opts.iconHtml || (opts.icon ? `<i class="${opts.icon}"></i>` : '<i class="fas fa-check"></i>');
    const iconClass = opts.iconStyle ? `ncm-sec-splash-icon--${opts.iconStyle}` : 'ncm-sec-splash-icon--accent';

    let html = `<div class="ncm-sec-splash ncm-sec-animate-in">`;
    html += `<div class="ncm-sec-splash-icon ${iconClass}">${iconContent}</div>`;
    if (opts.preTitle) html += `<div class="ncm-sec-muted" style="font-size:9px;letter-spacing:0.1em;margin-bottom:4px;">${opts.preTitle}</div>`;
    if (opts.title) html += `<div class="ncm-sec-splash-title" style="color:${opts.titleColor || 'var(--sp-accent)'};">${opts.title}</div>`;
    if (opts.name) html += `<div class="ncm-sec-splash-name">${opts.name}</div>`;
    if (opts.subtitle) html += `<div class="ncm-sec-splash-sub">${opts.subtitle}</div>`;
    if (opts.progressColor) {
      html += `<div class="ncm-sec-splash-progress"><div class="ncm-sec-splash-progress-fill ncm-sec-splash-progress-fill--${opts.progressColor}"></div></div>`;
    }
    if (opts.footerText) html += `<div class="ncm-sec-muted">${opts.footerText}</div>`;
    html += `</div>`;

    const overlay = document.createElement('div');
    overlay.className = 'ncm-sec-transition-overlay';
    overlay.innerHTML = html;
    inbox.appendChild(overlay);

    if (opts.sound) this.soundService?.play(opts.sound);

    await new Promise(r => setTimeout(r, opts.duration || 2000));
    overlay.remove();
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
    if (this._hookId) Hooks.off('updateItem', this._hookId);
    // Clean up boot sequence timers
    this._bootTimers.forEach(t => clearTimeout(t));
    this._bootTimers = [];
    return super.close(options);
  }
}
