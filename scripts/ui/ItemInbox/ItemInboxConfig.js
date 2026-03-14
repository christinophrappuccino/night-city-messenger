/**
 * ItemInboxConfig — GM Shard Configuration (Sprint 4.6 Tabbed Redesign)
 * @file scripts/ui/ItemInbox/ItemInboxConfig.js
 * @module cyberpunkred-messenger
 * @description GM-only tabbed configuration for data shard settings.
 *   5 tabs: Identity, Security, Network, Systems, Boot.
 */

import { MODULE_ID, DEFAULTS, SKILL_MAP, SHARD_PRESETS, NETWORK_ACCESS_MODES, NETWORK_TYPES, CONNECTION_MODES, FAILURE_MODES, ENCRYPTION_TYPES } from '../../utils/constants.js';
import { log, isGM } from '../../utils/helpers.js';
import { BaseApplication } from '../BaseApplication.js';

const BOOT_ICON_OPTIONS = [
  { value: 'fas fa-shield-halved', label: 'Shield' },
  { value: 'fas fa-star', label: 'Star' },
  { value: 'fas fa-skull', label: 'Skull' },
  { value: 'fas fa-skull-crossbones', label: 'Skull & Bones' },
  { value: 'fas fa-mask', label: 'Mask' },
  { value: 'fas fa-heart', label: 'Heart' },
  { value: 'fas fa-eye', label: 'Eye' },
  { value: 'fas fa-microchip', label: 'Microchip' },
  { value: 'fas fa-tower-broadcast', label: 'Broadcast' },
  { value: 'fas fa-hard-drive', label: 'Hard Drive' },
  { value: 'fas fa-sd-card', label: 'SD Card' },
  { value: 'fas fa-brain', label: 'Brain' },
  { value: 'fas fa-bolt', label: 'Bolt' },
  { value: 'fas fa-building', label: 'Building' },
  { value: 'fas fa-crosshairs', label: 'Crosshairs' },
  { value: 'fas fa-handshake-angle', label: 'Handshake' },
  { value: 'fas fa-ghost', label: 'Ghost' },
  { value: 'fas fa-dna', label: 'DNA' },
  { value: 'fas fa-virus', label: 'Virus' },
  { value: 'fas fa-key', label: 'Key' },
];

const KEY_ITEM_ICON_OPTIONS = [
  { value: 'fas fa-id-card', label: 'ID Card' },
  { value: 'fas fa-key', label: 'Key' },
  { value: 'fas fa-fingerprint', label: 'Fingerprint' },
  { value: 'fas fa-credit-card', label: 'Credit Card' },
  { value: 'fas fa-lock', label: 'Lock' },
  { value: 'fas fa-microchip', label: 'Microchip' },
  { value: 'fas fa-shield-halved', label: 'Shield' },
  { value: 'fas fa-passport', label: 'Passport' },
  { value: 'fas fa-sim-card', label: 'SIM Card' },
  { value: 'fas fa-barcode', label: 'Barcode' },
  { value: 'fas fa-qrcode', label: 'QR Code' },
  { value: 'fas fa-file-signature', label: 'Signature' },
];

const LAYER_FAILURE_MODES = [
  { value: 'nothing', label: 'No consequence' },
  { value: 'lockout', label: 'Timed lockout' },
  { value: 'permanent', label: 'Permanent lockout' },
  { value: 'damage', label: 'BLACK ICE damage' },
  { value: 'destroy', label: 'Destroy shard' },
];

export class ItemInboxConfig extends BaseApplication {

  item = null;
  _activeTab = 'identity';

  get dataShardService() { return game.nightcity?.dataShardService; }
  get networkService() { return game.nightcity?.networkService; }

  static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
    id: 'ncm-item-inbox-config',
    classes: ['ncm-app', 'ncm-item-inbox-config'],
    window: { title: 'NCM.DataShard.Config', icon: 'fas fa-cog', resizable: true, minimizable: false },
    position: { width: 680, height: 720 },
    actions: {
      saveConfig: ItemInboxConfig._onSaveConfig,
      applyPreset: ItemInboxConfig._onApplyPreset,
      addSkill: ItemInboxConfig._onAddSkill,
      removeSkill: ItemInboxConfig._onRemoveSkill,
      addBootLogLine: ItemInboxConfig._onAddBootLogLine,
      removeBootLogLine: ItemInboxConfig._onRemoveBootLogLine,
      resetDefaults: ItemInboxConfig._onResetDefaults,
      selectIcon: ItemInboxConfig._onSelectIcon,
      browseImage: ItemInboxConfig._onBrowseImage,
      changeIconMode: ItemInboxConfig._onChangeIconMode,
      selectIconColor: ItemInboxConfig._onSelectIconColor,
      relockShard: ItemInboxConfig._onRelockShard,
      switchTab: ItemInboxConfig._onSwitchTab,
      selectAccessMode: ItemInboxConfig._onSelectAccessMode,
      selectConnMode: ItemInboxConfig._onSelectConnMode,
      toggleNetwork: ItemInboxConfig._onToggleNetwork,
      selectIceMode: ItemInboxConfig._onSelectIceMode,
      selectIceActor: ItemInboxConfig._onSelectIceActor,
      searchKeyItem: ItemInboxConfig._onSearchKeyItem,
      clearKeyItem: ItemInboxConfig._onClearKeyItem,
      previewBoot: ItemInboxConfig._onPreviewBoot,
      toggleNetworkType: ItemInboxConfig._onToggleNetworkType,
    },
  }, { inplace: false });

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/item-inbox/item-inbox-config.hbs` },
  };

  constructor(options = {}) {
    super(options);
    if (options.item) this.item = options.item;
  }

  get title() { return `Configure Shard: ${this.item?.name ?? 'Unknown'}`; }

  // ═══════════════════════════════════════════════════════════
  //  LIFECYCLE — Wire change listeners for reactive UI
  // ═══════════════════════════════════════════════════════════

  _onRender(context, options) {
    super._onRender?.(context, options);
    const el = this.element;
    if (!el) return;

    // ─── Restore active tab ───
    if (this._activeTab && this._activeTab !== 'identity') {
      el.querySelectorAll('.ncm-cfg-tab').forEach(t => t.classList.toggle('ncm-cfg-tab--active', t.dataset.tab === this._activeTab));
      el.querySelectorAll('.ncm-cfg-panel').forEach(p => p.classList.toggle('ncm-cfg-panel--active', p.dataset.panel === this._activeTab));
    }

    // ─── Pipeline auto-update on checkbox change ───
    const layerCheckboxes = el.querySelectorAll('[name="networkRequired"], [name="requiresKeyItem"], [name="requiresLogin"], [name="encrypted"]');
    layerCheckboxes.forEach(cb => {
      cb.addEventListener('change', () => this._updatePipeline());
    });

    // ─── ICE type dropdown → show/hide ICE source section ───
    const iceTypeSel = el.querySelector('[name="encryptionType"]');
    if (iceTypeSel) {
      iceTypeSel.addEventListener('change', () => this._updateIceVisibility());
      this._updateIceVisibility(); // Initial state
    }

    // ─── Network access mode → show/hide conditional sections ───
    this._updateNetworkConditionals();

    // ─── Icon mode instant switching ───
    const iconModeSel = el.querySelector('[name="bootIconMode"]');
    if (iconModeSel) {
      iconModeSel.addEventListener('change', () => {
        const mode = iconModeSel.value;
        el.querySelectorAll('.ncm-cfg-icon-mode-section').forEach(s => {
          s.style.display = s.dataset.iconMode === mode ? '' : 'none';
        });
      });
    }
  }

  /** Update pipeline node states from current checkbox values */
  _updatePipeline() {
    const el = this.element;
    if (!el) return;
    const mapping = [
      { name: 'networkRequired', index: 0 },
      { name: 'requiresKeyItem', index: 1 },
      { name: 'requiresLogin', index: 2 },
      { name: 'encrypted', index: 3 },
    ];
    const nodes = el.querySelectorAll('.ncm-cfg-pipe-node');
    const arrows = el.querySelectorAll('.ncm-cfg-pipe-arrow');
    mapping.forEach(({ name, index }) => {
      const checked = !!el.querySelector(`[name="${name}"]`)?.checked;
      const node = nodes[index];
      const arrow = arrows[index];
      if (node) {
        node.querySelector('.ncm-cfg-pipe-icon')?.classList.toggle('ncm-cfg-pipe-icon--on', checked);
        node.querySelector('.ncm-cfg-pipe-label')?.classList.toggle('ncm-cfg-pipe-label--on', checked);
      }
      if (arrow) arrow.classList.toggle('ncm-cfg-pipe-arrow--on', checked);
    });
    // Also update layer card borders
    mapping.forEach(({ name }) => {
      const checked = !!el.querySelector(`[name="${name}"]`)?.checked;
      const layer = el.querySelector(`[name="${name}"]`)?.closest('.ncm-cfg-layer');
      if (layer) layer.classList.toggle('ncm-cfg-layer--enabled', checked);
    });
  }

  /** Show/hide ICE source based on encryption type */
  _updateIceVisibility() {
    const el = this.element;
    if (!el) return;
    const iceType = el.querySelector('[name="encryptionType"]')?.value || 'ICE';
    const isLethal = iceType === 'BLACK_ICE' || iceType === 'RED_ICE';
    const iceSource = el.querySelector('[data-ice-source]');
    if (iceSource) iceSource.style.display = isLethal ? '' : 'none';
    // Update damage dice display
    const diceEl = el.querySelector('[data-dmg-dice]');
    if (diceEl) diceEl.textContent = iceType === 'RED_ICE' ? '5d6' : '3d6';
  }

  /** Show/hide network sections based on access mode */
  _updateNetworkConditionals() {
    const el = this.element;
    if (!el) return;
    const mode = el.querySelector('[name="accessMode"]')?.value || 'any';
    const netGrid = el.querySelector('[data-net-section="whitelist"]');
    const typeSection = el.querySelector('[data-net-section="type"]');
    if (netGrid) netGrid.style.display = (mode === 'whitelist' || mode === 'both') ? '' : 'none';
    if (typeSection) typeSection.style.display = (mode === 'type' || mode === 'both') ? '' : 'none';
  }

  // ═══════════════════════════════════════════════════════════
  //  DATA PREPARATION
  // ═══════════════════════════════════════════════════════════

  async _prepareContext(options) {
    if (!this.item) return { hasItem: false };
    const config = this.dataShardService?.getConfig(this.item) ?? foundry.utils.deepClone(DEFAULTS.SHARD_CONFIG);
    const networks = this.networkService?.getAllNetworks?.() ?? [];
    const meta = config.metadata ?? {};

    // ─── Presets ───
    const presetOptions = Object.entries(SHARD_PRESETS).map(([key, p]) => ({
      value: key, label: p.label, selected: config.preset === key,
    }));

    // ─── Encryption types ───
    const encryptionTypes = [
      { value: 'ICE', label: 'Standard ICE', selected: config.encryptionType === 'ICE' },
      { value: 'BLACK_ICE', label: 'BLACK ICE (3d6 damage)', selected: config.encryptionType === 'BLACK_ICE' },
      { value: 'RED_ICE', label: 'RED ICE (5d6, lethal)', selected: config.encryptionType === 'RED_ICE' },
    ];

    // ─── Skills ───
    const skillEntries = (config.allowedSkills || []).map(name => ({
      name, dc: config.skillDCs?.[name] ?? config.encryptionDC ?? 15,
      stat: SKILL_MAP[name]?.stat?.toUpperCase() ?? '?',
    }));
    const allSkills = Object.keys(SKILL_MAP).filter(s => !(config.allowedSkills || []).includes(s)).sort();

    // ─── Failure modes ───
    const failureModes = [
      { value: 'nothing', label: 'No consequence', selected: config.failureMode === 'nothing' },
      { value: 'lockout', label: 'Lockout (timed)', selected: config.failureMode === 'lockout' },
      { value: 'permanent', label: 'Permanent lockout', selected: config.failureMode === 'permanent' },
      { value: 'damage', label: 'BLACK ICE damage + lockout', selected: config.failureMode === 'damage' },
      { value: 'destroy', label: 'Self-destruct shard', selected: config.failureMode === 'destroy' },
    ];
    const lockoutMinutes = Math.round((config.lockoutDuration || 3600000) / 60000);

    // ─── Layer failure modes (reusable list) ───
    const layerFailureModes = LAYER_FAILURE_MODES;

    // ─── Per-layer hack config ───
    const layerSec = config.layerSecurity ?? {};
    const perLayer = layerSec.perLayer ?? {};

    // ─── Network ───
    const netConfig = config.network ?? {};
    const networkRequired = netConfig.required ?? config.requiresNetwork ?? false;
    const accessMode = netConfig.accessMode ?? 'any';

    const networkOptions = networks.map(n => ({
      value: n.id, label: n.name, type: n.type || 'PUBLIC',
      color: n.theme?.color || '#19f3f7',
      icon: n.theme?.icon || 'fa-wifi',
      selected: (netConfig.allowedNetworks ?? []).includes(n.id),
    }));
    const networkTypeChecks = Object.values(NETWORK_TYPES).map(t => ({
      value: t, label: t, checked: (netConfig.allowedTypes ?? []).includes(t),
    }));

    // ─── Tracing ───
    const tracing = netConfig.tracing ?? {};

    // ─── Integrity ───
    const integrity = config.integrity ?? {};

    // ─── Expiration ───
    const expiration = config.expiration ?? {};
    const expirationHours = Math.round((expiration.timerDuration || 172800000) / 3600000);

    // ─── Boot ───
    const boot = config.boot ?? {};
    const bootIconOptions = BOOT_ICON_OPTIONS.map(o => ({ ...o, selected: boot.faIcon === o.value }));
    const bootLogLines = boot.logLines ?? [];

    // ─── Icon colors ───
    const ICON_COLORS = [
      { key: 'red', hex: '#F65261' }, { key: 'cyan', hex: '#19f3f7' },
      { key: 'gold', hex: '#f7c948' }, { key: 'green', hex: '#00ff41' },
      { key: 'purple', hex: '#a855f7' }, { key: 'danger', hex: '#ff0033' },
      { key: 'orange', hex: '#e88030' }, { key: 'white', hex: '#e0e0e8' },
      { key: 'muted', hex: '#888888' },
    ];
    const bootIconColor = boot.iconColor || '';
    const iconColorOptions = ICON_COLORS.map(c => ({ ...c, isActive: bootIconColor === c.hex }));

    // ─── Key Item icon options ───
    const keyItemIconOptions = KEY_ITEM_ICON_OPTIONS.map(o => ({
      ...o, selected: config.keyItemIcon === o.value,
    }));

    // ─── ICE source ───
    const iceConfig = config.ice ?? {};
    const iceSource = iceConfig.source ?? 'default';

    // ─── Black ICE actors ───
    const blackIceActors = (game.actors?.filter(a =>
      a.type === 'blackIce' || a.type === 'black-ice' ||
      a.getFlag(MODULE_ID, 'isBlackICE') ||
      a.name?.toLowerCase().includes('black ice')
    ) ?? []).map(a => ({
      id: a.id, name: a.name, img: a.img,
      damage: a.system?.stats?.atk?.value ? `ATK: ${a.system.stats.atk.value}` : '',
      selected: iceConfig.actorId === a.id,
    }));

    // ─── Security layer count ───
    let securityLayerCount = 0;
    if (networkRequired) securityLayerCount++;
    if (config.requiresKeyItem) securityLayerCount++;
    if (config.requiresLogin) securityLayerCount++;
    if (config.encrypted) securityLayerCount++;

    // ─── Timestamp conversion for datetime-local ───
    let metaTimestampLocal = '';
    if (meta.timestamp) {
      try { metaTimestampLocal = new Date(meta.timestamp).toISOString().slice(0, 16); } catch (e) {}
    }

    // ─── ICE damage dice display ───
    const iceDamageDice = config.encryptionType === 'RED_ICE' ? '5d6'
      : config.encryptionType === 'BLACK_ICE' ? '3d6' : '—';

    return {
      hasItem: true,
      itemName: this.item.name,
      itemImg: this.item.img,
      itemType: this.item.type || 'Item',
      config,

      // Preset
      presetOptions,

      // Identity
      shardName: config.shardName || '',
      shardDescription: config.shardDescription || '',

      // Metadata
      metaCreator: meta.creator || '',
      metaNetwork: meta.network || '',
      metaLocation: meta.location || '',
      metaTimestamp: meta.timestamp || '',
      metaTimestampLocal,
      metaClassification: meta.classification || '',
      typeLineModePresetStatus: (meta.typeLineMode ?? 'preset-status') === 'preset-status',
      typeLineModeStatusOnly: meta.typeLineMode === 'status-only',
      typeLineModeCustom: meta.typeLineMode === 'custom',
      typeLineCustom: meta.typeLineCustom || '',

      // Encryption
      isEncrypted: config.encrypted,
      encryptionTypes,
      encryptionDC: config.encryptionDC,
      encryptionModeShard: config.encryptionMode === 'shard',
      encryptionModeMessage: config.encryptionMode === 'message',

      // Skills
      skillEntries, allSkills, hasSkills: skillEntries.length > 0,

      // Failure (encryption layer)
      failureModes, maxHackAttempts: config.maxHackAttempts, lockoutMinutes,

      // Layer failure modes list
      layerFailureModes,

      // Per-layer hack config
      networkHackMaxAttempts: perLayer.network?.maxAttempts ?? 3,
      networkHackFailureMode: perLayer.network?.failureMode ?? 'nothing',
      networkHackLockoutMin: Math.round((perLayer.network?.lockoutDuration || 3600000) / 60000),
      keyitemHackMaxAttempts: perLayer.keyitem?.maxAttempts ?? 3,
      keyitemHackFailureMode: perLayer.keyitem?.failureMode ?? 'nothing',
      loginHackMaxAttempts: perLayer.login?.maxAttempts ?? 3,
      loginHackFailureMode: perLayer.login?.failureMode ?? 'nothing',

      // Security
      securityLayerCount,

      // Login
      requiresLogin: config.requiresLogin,
      loginUsername: config.loginUsername,
      loginPassword: config.loginPassword,
      loginDisplayName: config.loginDisplayName,
      maxLoginAttempts: config.maxLoginAttempts,

      // Key Item
      requiresKeyItem: config.requiresKeyItem,
      keyItemName: config.keyItemName,
      keyItemId: config.keyItemId,
      keyItemTag: config.keyItemTag,
      keyItemDisplayName: config.keyItemDisplayName,
      keyItemIcon: config.keyItemIcon,
      keyItemImg: config.keyItemImg || '',
      keyItemBypassLogin: config.keyItemBypassLogin,
      keyItemBypassEncryption: config.keyItemBypassEncryption,
      keyItemConsumeOnUse: config.keyItemConsumeOnUse,
      keyItemIconOptions,

      // Network
      networkRequired,
      accessModeValue: accessMode,
      accessModeAny: accessMode === 'any',
      accessModeWhitelist: accessMode === 'whitelist',
      accessModeType: accessMode === 'type',
      networkTypeChecks,
      networkOptions,
      connectionModeValue: netConfig.connectionMode ?? 'offline',
      connectionModeOffline: (netConfig.connectionMode ?? 'offline') === 'offline',
      connectionModeTethered: (netConfig.connectionMode ?? 'offline') === 'tethered',
      signalThreshold: netConfig.signalThreshold ?? 40,
      signalDVModifier: netConfig.signalDVModifier ?? true,
      signalDegradation: netConfig.signalDegradation ?? false,

      // Tracing
      tracingEnabled: tracing.enabled ?? false,
      tracingMode: tracing.mode ?? 'silent',
      tracingModeSilent: (tracing.mode ?? 'silent') === 'silent',
      tracingModeWarned: tracing.mode === 'warned',
      tracingModeVisible: tracing.mode === 'visible',
      tracingTriggerOn: tracing.triggerOn ?? 'access',
      tracingRevealIdentity: tracing.revealIdentity ?? true,
      tracingRevealLocation: tracing.revealLocation ?? false,

      // Integrity
      integrityEnabled: integrity.enabled ?? false,
      integrityModeCosmetic: (integrity.mode ?? 'cosmetic') === 'cosmetic',
      integrityModeMechanical: (integrity.mode ?? 'cosmetic') === 'mechanical',
      integrityMax: integrity.maxIntegrity ?? 100,
      integrityDegradePerFailure: integrity.degradePerFailure ?? 15,
      integrityCorruptionThreshold: integrity.corruptionThreshold ?? 40,
      integrityCorruptionChance: Math.round((integrity.corruptionChance ?? 0.3) * 100),

      // Expiration
      expirationEnabled: expiration.enabled ?? false,
      expirationModeTimer: (expiration.mode ?? 'timer') === 'timer',
      expirationModeCalendar: (expiration.mode ?? 'timer') === 'calendar',
      expirationModeAccess: (expiration.mode ?? 'timer') === 'on-access',
      expirationHours,
      expirationAccessCount: expiration.accessCount ?? 1,

      // Boot
      bootEnabled: boot.enabled ?? true,
      bootIconModeFa: (boot.iconMode ?? 'fa') === 'fa',
      bootIconModeImage: (boot.iconMode ?? 'fa') === 'image',
      bootIconModeItem: boot.iconMode === 'item',
      bootIconOptions,
      bootFaIconCustom: boot.faIcon || '',
      bootImageUrl: boot.imageUrl || '',
      bootImageSize: boot.imageSize || 64,
      bootTitle: boot.title || '',
      bootSubtitle: boot.subtitle || '',
      bootProgressLabel: boot.progressLabel || '',
      bootSpeed: boot.speed || 'normal',
      bootSpeedFast: boot.speed === 'fast',
      bootSpeedNormal: (boot.speed ?? 'normal') === 'normal',
      bootSpeedDramatic: boot.speed === 'dramatic',
      bootSpeedCustom: boot.speed === 'custom',
      bootCustomSeconds: boot.customSeconds ?? '',
      bootLogLines,
      bootIconColor,
      iconColorOptions,

      // ICE source
      iceSource,
      iceSourceDefault: iceSource === 'default',
      iceSourceCustom: iceSource === 'custom',
      iceSourceActor: iceSource === 'actor',
      iceCustomName: iceConfig.customName || '',
      iceCustomPortrait: iceConfig.customPortrait || '',
      iceCustomDamage: iceConfig.customDamage || '',
      iceActorId: iceConfig.actorId || '',
      iceDamageDice,
      blackIceActors,

      // Display
      singleMessage: config.singleMessage,
      notifyGM: config.notifyGM ?? true,
      notifyContact: config.notifyContact ?? false,
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  SAVE CONFIG
  // ═══════════════════════════════════════════════════════════

  static async _onSaveConfig(event, target) {
    if (!isGM() || !this.item) return;
    const el = this.element;
    const val = (name, fallback = '') => el.querySelector(`[name="${name}"]`)?.value ?? fallback;
    const checked = (name) => !!el.querySelector(`[name="${name}"]`)?.checked;

    const allowedSkills = this._collectSkills();
    const skillDCs = this._collectSkillDCs();
    const bootLogLines = this._collectBootLogLines();
    const allowedNetworks = this._collectNetworks();
    const allowedTypes = this._collectCheckedValues('allowedType');

    // Timestamp conversion
    let metaTimestamp = val('metaTimestamp');
    if (metaTimestamp && !metaTimestamp.includes('T')) {
      // datetime-local gives "YYYY-MM-DDTHH:MM", convert to ISO
      try { metaTimestamp = new Date(metaTimestamp).toISOString(); } catch (e) {}
    }

    const config = {
      preset: val('preset', 'blank'),
      shardName: val('shardName'),
      shardDescription: val('shardDescription'),

      metadata: {
        creator: val('metaCreator'),
        network: val('metaNetwork'),
        location: val('metaLocation'),
        timestamp: metaTimestamp,
        classification: val('metaClassification'),
        typeLineMode: val('typeLineMode', 'preset-status'),
        typeLineCustom: val('typeLineCustom'),
        custom: {},
      },

      encrypted: checked('encrypted'),
      encryptionType: val('encryptionType', 'ICE'),
      encryptionDC: parseInt(val('encryptionDC')) || 15,
      encryptionMode: val('encryptionMode', 'shard'),
      allowedSkills,
      skillDCs,
      failureMode: val('failureMode', 'lockout'),
      maxHackAttempts: parseInt(val('maxHackAttempts')) || 3,
      lockoutDuration: (parseInt(val('lockoutMinutes')) || 60) * 60000,

      requiresLogin: checked('requiresLogin'),
      loginUsername: val('loginUsername'),
      loginPassword: val('loginPassword'),
      loginDisplayName: val('loginDisplayName'),
      maxLoginAttempts: parseInt(val('maxLoginAttempts')) || 3,

      requiresKeyItem: checked('requiresKeyItem'),
      keyItemName: val('keyItemName') || null,
      keyItemId: val('keyItemId') || null,
      keyItemTag: val('keyItemTag') || null,
      keyItemImg: val('keyItemImg') || null,
      keyItemDisplayName: val('keyItemDisplayName'),
      keyItemIcon: val('keyItemIcon', 'fa-id-card'),
      keyItemBypassLogin: checked('keyItemBypassLogin'),
      keyItemBypassEncryption: checked('keyItemBypassEncryption'),
      keyItemConsumeOnUse: checked('keyItemConsumeOnUse'),

      // Per-layer hack security
      layerSecurity: {
        enabled: true,
        perLayer: {
          network: {
            maxAttempts: parseInt(val('networkHackMaxAttempts')) || 3,
            failureMode: val('networkHackFailureMode', 'nothing'),
            lockoutDuration: (parseInt(val('networkHackLockoutMin')) || 60) * 60000,
          },
          keyitem: {
            maxAttempts: parseInt(val('keyitemHackMaxAttempts')) || 3,
            failureMode: val('keyitemHackFailureMode', 'nothing'),
          },
          login: {
            maxAttempts: parseInt(val('loginHackMaxAttempts')) || 3,
            failureMode: val('loginHackFailureMode', 'nothing'),
          },
        },
      },

      // ICE source
      ice: {
        source: val('iceSource', 'default'),
        customName: val('iceCustomName'),
        customPortrait: val('iceCustomPortrait'),
        customDamage: val('iceCustomDamage'),
        actorId: val('iceActorId'),
      },

      network: {
        required: checked('networkRequired'),
        accessMode: val('accessMode', 'any'),
        allowedNetworks,
        allowedTypes,
        connectionMode: val('connectionMode', 'offline'),
        signalThreshold: parseInt(val('signalThreshold')) || 40,
        signalDVModifier: checked('signalDVModifier'),
        signalDegradation: checked('signalDegradation'),
        tracing: {
          enabled: checked('tracingEnabled'),
          mode: val('tracingMode', 'silent'),
          triggerOn: val('tracingTriggerOn', 'access'),
          traceTarget: null,
          traceMessage: null,
          traceDelay: 0,
          revealIdentity: checked('tracingRevealIdentity'),
          revealLocation: checked('tracingRevealLocation'),
          cooldown: 0,
        },
      },

      requiresNetwork: checked('networkRequired'),
      requiredNetwork: allowedNetworks[0] || null,

      integrity: {
        enabled: checked('integrityEnabled'),
        mode: val('integrityMode', 'cosmetic'),
        maxIntegrity: parseInt(val('integrityMax')) || 100,
        currentIntegrity: parseInt(val('integrityMax')) || 100,
        degradePerFailure: parseInt(val('integrityDegradePerFailure')) || 15,
        corruptionThreshold: parseInt(val('integrityCorruptionThreshold')) || 40,
        corruptionChance: (parseInt(val('integrityCorruptionChance')) || 30) / 100,
      },

      expiration: {
        enabled: checked('expirationEnabled'),
        mode: val('expirationMode', 'timer'),
        timerDuration: (parseInt(val('expirationHours')) || 48) * 3600000,
        calendarDate: null,
        accessCount: parseInt(val('expirationAccessCount')) || 1,
      },

      boot: {
        enabled: checked('bootEnabled'),
        iconMode: val('bootIconMode', 'fa'),
        faIcon: val('bootFaIcon', 'fas fa-microchip'),
        iconColor: val('bootIconColor'),
        imageUrl: val('bootImageUrl') || null,
        imageSize: parseInt(val('bootImageSize')) || 64,
        imageTint: val('bootImageTint') || '',
        imageBorderRadius: 'rounded',
        title: val('bootTitle'),
        subtitle: val('bootSubtitle'),
        progressLabel: val('bootProgressLabel'),
        logLines: bootLogLines,
        speed: val('bootSpeed', 'normal'),
        customSeconds: parseFloat(val('bootCustomSeconds')) || null,
        animationStyle: SHARD_PRESETS[val('preset')]?.boot?.animationStyle || 'standard-fade',
      },

      linkedShards: [],
      notifyGM: checked('notifyGM'),
      notifyContact: checked('notifyContact'),
      notifyContactId: null,
      theme: val('preset', 'blank'),
      singleMessage: checked('singleMessage'),
    };

    const result = await this.dataShardService.updateConfig(this.item, config);
    if (result.success) {
      ui.notifications.info('NCM | Shard configuration saved.');
      this.close();
    } else {
      ui.notifications.error(`NCM | Failed: ${result.error}`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  TAB SWITCHING
  // ═══════════════════════════════════════════════════════════

  static _onSwitchTab(event, target) {
    const tab = target.dataset.tab;
    if (!tab) return;
    this._activeTab = tab;

    // Update tab bar
    this.element.querySelectorAll('.ncm-cfg-tab').forEach(t => {
      t.classList.toggle('ncm-cfg-tab--active', t.dataset.tab === tab);
    });
    // Update panels
    this.element.querySelectorAll('.ncm-cfg-panel').forEach(p => {
      p.classList.toggle('ncm-cfg-panel--active', p.dataset.panel === tab);
    });
    // Scroll content to top
    const content = this.element.querySelector('.ncm-cfg-content');
    if (content) content.scrollTop = 0;
  }

  // ═══════════════════════════════════════════════════════════
  //  NETWORK INTERACTIVE ACTIONS
  // ═══════════════════════════════════════════════════════════

  static _onSelectAccessMode(event, target) {
    const mode = target.dataset.mode || target.closest('[data-mode]')?.dataset.mode;
    if (!mode) return;
    this.element.querySelectorAll('.ncm-cfg-am-card').forEach(c => c.classList.remove('ncm-cfg-am-card--sel'));
    (target.closest('.ncm-cfg-am-card') || target).classList.add('ncm-cfg-am-card--sel');
    const input = this.element.querySelector('[name="accessMode"]');
    if (input) input.value = mode;
    this._updateNetworkConditionals();
  }

  static _onSelectConnMode(event, target) {
    const mode = target.dataset.mode || target.closest('[data-mode]')?.dataset.mode;
    if (!mode) return;
    this.element.querySelectorAll('.ncm-cfg-cm-card').forEach(c => c.classList.remove('ncm-cfg-cm-card--sel'));
    (target.closest('.ncm-cfg-cm-card') || target).classList.add('ncm-cfg-cm-card--sel');
    const input = this.element.querySelector('[name="connectionMode"]');
    if (input) input.value = mode;
  }

  static _onToggleNetwork(event, target) {
    const card = target.closest('.ncm-cfg-net-card') || target;
    const netId = card.dataset.netId;
    if (!netId) return;
    card.classList.toggle('ncm-cfg-net-card--on');
    const isOn = card.classList.contains('ncm-cfg-net-card--on');
    const container = this.element.querySelector('#ncm-network-hidden-inputs');
    if (!container) return;

    if (isOn) {
      if (!container.querySelector(`[data-net-hidden="${netId}"]`)) {
        const inp = document.createElement('input');
        inp.type = 'hidden'; inp.name = 'allowedNetwork'; inp.value = netId;
        inp.dataset.netHidden = netId;
        container.appendChild(inp);
      }
    } else {
      container.querySelector(`[data-net-hidden="${netId}"]`)?.remove();
    }
  }

  static _onToggleNetworkType(event, target) {
    const card = target.closest('.ncm-cfg-type-card') || target;
    const typeVal = card.dataset.typeValue;
    if (!typeVal) return;
    card.classList.toggle('ncm-cfg-type-card--on');
    // Toggle the hidden checkbox
    const cb = this.element.querySelector(`input[name="allowedType"][value="${typeVal}"]`);
    if (cb) cb.checked = card.classList.contains('ncm-cfg-type-card--on');
  }

  // ═══════════════════════════════════════════════════════════
  //  ICE SOURCE
  // ═══════════════════════════════════════════════════════════

  static _onSelectIceMode(event, target) {
    const mode = target.dataset.mode || target.closest('[data-mode]')?.dataset.mode;
    if (!mode) return;
    this.element.querySelectorAll('.ncm-cfg-ice-card').forEach(c => c.classList.remove('ncm-cfg-ice-card--sel'));
    (target.closest('.ncm-cfg-ice-card') || target).classList.add('ncm-cfg-ice-card--sel');
    this.element.querySelectorAll('.ncm-cfg-ice-panel').forEach(p => p.classList.remove('ncm-cfg-ice-panel--on'));
    this.element.querySelector(`[data-ice-panel="${mode}"]`)?.classList.add('ncm-cfg-ice-panel--on');
    const input = this.element.querySelector('[name="iceSource"]');
    if (input) input.value = mode;
  }

  static _onSelectIceActor(event, target) {
    const card = target.closest('.ncm-cfg-actor-card') || target;
    const actorId = card.dataset.actorId;
    if (!actorId) return;
    this.element.querySelectorAll('.ncm-cfg-actor-card').forEach(c => c.classList.remove('ncm-cfg-actor-card--sel'));
    card.classList.add('ncm-cfg-actor-card--sel');
    const input = this.element.querySelector('[name="iceActorId"]');
    if (input) input.value = actorId;
  }

  // ═══════════════════════════════════════════════════════════
  //  KEY ITEM PICKER
  // ═══════════════════════════════════════════════════════════

  static async _onSearchKeyItem(event, target) {
    // Open a Foundry Dialog listing all items the GM can pick from
    const items = game.items?.contents ?? [];
    if (items.length === 0) {
      ui.notifications.warn('NCM | No items found in the world.');
      return;
    }
    let selectedItem = null;
    const itemButtons = {};
    items.slice(0, 50).forEach((item, i) => {
      itemButtons[`item${i}`] = {
        label: `<img src="${item.img}" width="20" height="20" style="vertical-align:middle;margin-right:6px;border:none;"> ${item.name} <small style="opacity:0.5">(${item.type})</small>`,
        callback: () => { selectedItem = item; },
      };
    });
    itemButtons.cancel = { label: 'Cancel', callback: () => {} };
    await new Promise(resolve => {
      new Dialog({
        title: 'Select Key Item',
        content: `<p style="margin-bottom:8px;">Select the item required for shard access:</p>`,
        buttons: itemButtons,
        default: 'cancel',
        close: resolve,
      }, { classes: ['dialog', 'ncm-hack-dialog', 'ncm-hd-theme-cyan'], width: 400 }).render(true);
    });
    if (!selectedItem) return;

    // Update hidden inputs
    const el = this.element;
    const setVal = (name, v) => { const inp = el.querySelector(`[name="${name}"]`); if (inp) inp.value = v; };
    setVal('keyItemName', selectedItem.name);
    setVal('keyItemId', selectedItem.id);
    setVal('keyItemImg', selectedItem.img);
    // Re-render to show the filled state
    this.render();
  }

  static _onClearKeyItem(event, target) {
    const el = this.element;
    const setVal = (name, v) => { const inp = el.querySelector(`[name="${name}"]`); if (inp) inp.value = v; };
    setVal('keyItemName', '');
    setVal('keyItemId', '');
    setVal('keyItemImg', '');
    this.render();
  }

  // ═══════════════════════════════════════════════════════════
  //  BOOT PREVIEW
  // ═══════════════════════════════════════════════════════════

  static async _onPreviewBoot(event, target) {
    const el = this.element;
    const frame = el.querySelector('[data-boot-preview]');
    if (!frame) return;

    // Read current form values
    const title = el.querySelector('[name="bootTitle"]')?.value || 'DATA SHARD';
    const subtitle = el.querySelector('[name="bootSubtitle"]')?.value || '';
    const progressLabel = el.querySelector('[name="bootProgressLabel"]')?.value || 'Loading...';
    const speedSel = el.querySelector('[name="bootSpeed"]')?.value || 'normal';
    const speed = { fast: 1500, normal: 3500, dramatic: 5000 }[speedSel] || 3500;
    const iconEl = el.querySelector('[name="bootFaIcon"]');
    const iconClass = iconEl?.value || 'fas fa-microchip';
    const iconColor = el.querySelector('[name="bootIconColor"]')?.value || '#19f3f7';
    const logInputs = el.querySelectorAll('[name="bootLogLine"]');
    const logLines = Array.from(logInputs).map(i => i.value).filter(Boolean);

    // Clear and build preview
    frame.innerHTML = '';
    frame.style.position = 'relative';

    const area = document.createElement('div');
    area.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;';
    frame.appendChild(area);

    // Icon
    const icon = document.createElement('div');
    icon.style.cssText = `width:40px;height:40px;border-radius:50%;border:2px solid ${iconColor};color:${iconColor};display:flex;align-items:center;justify-content:center;font-size:18px;opacity:0;transform:scale(0.5);transition:all 0.4s ease;`;
    icon.innerHTML = `<i class="${iconClass}"></i>`;
    area.appendChild(icon);

    // Title
    const titleEl = document.createElement('div');
    titleEl.style.cssText = `font-family:'Orbitron',sans-serif;font-size:10px;font-weight:700;color:${iconColor};text-transform:uppercase;letter-spacing:0.12em;opacity:0;transform:translateY(4px);transition:all 0.3s ease;`;
    titleEl.textContent = title;
    area.appendChild(titleEl);

    // Subtitle
    const subEl = document.createElement('div');
    subEl.style.cssText = `font-family:'Share Tech Mono',monospace;font-size:9px;color:#555570;opacity:0;transition:all 0.3s ease;`;
    subEl.textContent = subtitle;
    area.appendChild(subEl);

    // Progress
    const track = document.createElement('div');
    track.style.cssText = 'width:50%;height:3px;background:#1a1a2e;border-radius:2px;overflow:hidden;opacity:0;transition:opacity 0.3s;';
    const fill = document.createElement('div');
    fill.style.cssText = `height:100%;width:0;background:${iconColor};border-radius:2px;transition:width 0.1s linear;`;
    track.appendChild(fill);
    area.appendChild(track);

    const pLabel = document.createElement('div');
    pLabel.style.cssText = 'font-family:"Share Tech Mono",monospace;font-size:8px;color:#555570;opacity:0;transition:all 0.3s;';
    pLabel.textContent = progressLabel;
    area.appendChild(pLabel);

    // Log area
    const logArea = document.createElement('div');
    logArea.style.cssText = 'position:absolute;bottom:8px;left:10px;right:10px;font-family:"Share Tech Mono",monospace;font-size:8px;color:#00ff41;line-height:1.5;';
    frame.appendChild(logArea);

    // Animate
    const wait = ms => new Promise(r => setTimeout(r, ms));
    await wait(200);
    icon.style.opacity = '1'; icon.style.transform = 'scale(1)';
    await wait(400);
    titleEl.style.opacity = '1'; titleEl.style.transform = 'translateY(0)';
    await wait(250);
    subEl.style.opacity = '1';
    await wait(200);
    track.style.opacity = '1'; pLabel.style.opacity = '1';

    // Progress fill
    const progressDuration = speed * 0.5;
    const steps = 20;
    for (let i = 1; i <= steps; i++) {
      fill.style.width = (i / steps * 100) + '%';
      await wait(progressDuration / steps);
    }

    // Log lines
    for (const line of logLines) {
      const lineEl = document.createElement('div');
      lineEl.style.cssText = 'opacity:0;transform:translateX(-4px);transition:all 0.2s;';
      lineEl.textContent = `> ${line}`;
      logArea.appendChild(lineEl);
      await wait(50);
      lineEl.style.opacity = '0.6'; lineEl.style.transform = 'translateX(0)';
      await wait(Math.max(100, (speed * 0.3) / logLines.length));
    }

    await wait(600);
    area.style.transition = 'opacity 0.4s'; area.style.opacity = '0';
    logArea.style.transition = 'opacity 0.4s'; logArea.style.opacity = '0';
    await wait(500);

    frame.innerHTML = '<div class="ncm-cfg-pf-idle">Click Preview to test</div>';
  }

  // ═══════════════════════════════════════════════════════════
  //  PRESET APPLICATION
  // ═══════════════════════════════════════════════════════════

  static async _onApplyPreset(event, target) {
    if (!isGM() || !this.item) return;
    const presetKey = this.element.querySelector('[name="preset"]')?.value;
    if (!presetKey || !SHARD_PRESETS[presetKey]) return;
    const confirm = await Dialog.confirm({
      title: 'Apply Preset',
      content: `<p>Apply <strong>${SHARD_PRESETS[presetKey].label}</strong>? Overwrites security, boot, and theme.</p>`,
    });
    if (!confirm) return;
    const result = await this.dataShardService.applyPreset(this.item, presetKey);
    if (result.success) {
      ui.notifications.info(`NCM | Preset "${SHARD_PRESETS[presetKey].label}" applied.`);
      this.render();
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  SKILL MANAGEMENT
  // ═══════════════════════════════════════════════════════════

  static _onAddSkill(event, target) {
    const select = this.element.querySelector('[name="newSkill"]');
    const skillName = select?.value;
    if (!skillName) return;
    const container = this.element.querySelector('.ncm-cfg-skill-list');
    if (!container) return;
    const dc = parseInt(this.element.querySelector('[name="encryptionDC"]')?.value) || 15;
    const entry = document.createElement('div');
    entry.classList.add('ncm-cfg-skill-row');
    entry.dataset.skill = skillName;
    const stat = SKILL_MAP[skillName]?.stat?.toUpperCase() ?? '?';
    entry.innerHTML = `<span class="ncm-cfg-skill-name">${skillName} <small>(${stat})</small></span>
      <span class="ncm-cfg-skill-dv-label">DV</span>
      <input type="number" name="skillDC-${skillName}" value="${dc}" min="1" max="30" class="ncm-cfg-skill-dv" />
      <button type="button" class="ncm-cfg-btn-icon ncm-cfg-btn-icon--danger" data-action="removeSkill" data-skill="${skillName}"><i class="fas fa-times"></i></button>`;
    container.appendChild(entry);
    const opt = select.querySelector(`option[value="${skillName}"]`);
    if (opt) opt.remove();
    select.value = '';
  }

  static _onRemoveSkill(event, target) {
    const skillName = target.dataset.skill || target.closest('[data-skill]')?.dataset.skill;
    if (!skillName) return;
    this.element.querySelector(`.ncm-cfg-skill-row[data-skill="${skillName}"]`)?.remove();
  }

  // ═══════════════════════════════════════════════════════════
  //  BOOT LOG LINE MANAGEMENT
  // ═══════════════════════════════════════════════════════════

  static _onAddBootLogLine(event, target) {
    const container = this.element.querySelector('.ncm-cfg-boot-log-list');
    if (!container) return;
    const entry = document.createElement('div');
    entry.classList.add('ncm-cfg-boot-log-entry');
    entry.innerHTML = `<input type="text" name="bootLogLine" class="ncm-cfg-input" value="" placeholder="Log line..." />
      <button type="button" class="ncm-cfg-btn-icon ncm-cfg-btn-icon--danger" data-action="removeBootLogLine"><i class="fas fa-times"></i></button>`;
    container.appendChild(entry);
  }

  static _onRemoveBootLogLine(event, target) {
    target.closest('.ncm-cfg-boot-log-entry')?.remove();
  }

  // ═══════════════════════════════════════════════════════════
  //  RESET & RELOCK
  // ═══════════════════════════════════════════════════════════

  static async _onResetDefaults(event, target) {
    const confirm = await Dialog.confirm({ title: 'Reset', content: '<p>Reset all to defaults? Cannot be undone.</p>' });
    if (!confirm) return;
    await this.dataShardService.updateConfig(this.item, foundry.utils.deepClone(DEFAULTS.SHARD_CONFIG));
    this.render();
  }

  static async _onRelockShard(event, target) {
    if (!this.item) return;
    const confirm = await Dialog.confirm({
      title: 'Relock All Security',
      content: `<p>Resets ALL security for all players. Cannot be undone.</p>`,
    });
    if (!confirm) return;
    const result = await this.dataShardService?.relockShard(this.item);
    if (result?.success) {
      ui.notifications.info('NCM | All security relocked.');
      for (const app of Object.values(ui.windows)) {
        if (app.item?.id === this.item.id && app !== this) app.render(true);
      }
    } else {
      ui.notifications.error(`NCM | Relock failed: ${result?.error || 'Unknown'}`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  ICON & IMAGE PICKERS
  // ═══════════════════════════════════════════════════════════

  static _onSelectIcon(event, target) {
    const icon = target.dataset.icon;
    const targetInput = target.dataset.target;
    if (!icon || !targetInput) return;
    const input = this.element?.querySelector(`[name="${targetInput}"]`);
    if (input) input.value = icon;
    const grid = target.closest('.ncm-cfg-icon-grid');
    grid?.querySelectorAll('.ncm-cfg-ig-item').forEach(el => {
      el.classList.toggle('ncm-cfg-ig-item--active', el.dataset.icon === icon);
    });
  }

  static _onBrowseImage(event, target) {
    const targetInput = target.dataset.target;
    if (!targetInput) return;
    const input = this.element?.querySelector(`[name="${targetInput}"]`);
    new FilePicker({
      type: 'image',
      current: input?.value || '',
      callback: (path) => { if (input) input.value = path; },
    }).render(true);
  }

  static _onChangeIconMode(event, target) {
    const mode = target.value;
    const sections = this.element.querySelectorAll('.ncm-cfg-icon-mode-section');
    sections.forEach(s => {
      s.style.display = s.dataset.iconMode === mode ? '' : 'none';
    });
  }

  static _onSelectIconColor(event, target) {
    const color = target.dataset.color;
    const targetInput = target.dataset.target;
    if (!color || !targetInput) return;
    const input = this.element?.querySelector(`[name="${targetInput}"]`);
    if (input) input.value = color;
    const row = target.closest('.ncm-cfg-color-dots');
    row?.querySelectorAll('.ncm-cfg-color-dot').forEach(dot => {
      dot.classList.toggle('ncm-cfg-color-dot--active', dot.dataset.color === color);
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  COLLECTION HELPERS
  // ═══════════════════════════════════════════════════════════

  _collectSkills() {
    return Array.from(this.element?.querySelectorAll('.ncm-cfg-skill-row') || [])
      .map(el => el.dataset.skill).filter(Boolean);
  }

  _collectSkillDCs() {
    const dcs = {};
    for (const el of this.element?.querySelectorAll('.ncm-cfg-skill-row') || []) {
      const name = el.dataset.skill;
      const dc = el.querySelector('.ncm-cfg-skill-dv');
      if (name && dc) dcs[name] = parseInt(dc.value) || 15;
    }
    return dcs;
  }

  _collectBootLogLines() {
    return Array.from(this.element?.querySelectorAll('[name="bootLogLine"]') || [])
      .map(el => el.value?.trim()).filter(Boolean);
  }

  _collectNetworks() {
    return Array.from(this.element?.querySelectorAll('[data-net-hidden]') || [])
      .map(el => el.value).filter(Boolean);
  }

  _collectCheckedValues(namePrefix) {
    const checked = Array.from(this.element?.querySelectorAll(`[name^="${namePrefix}"]:checked`) || []);
    const hidden = Array.from(this.element?.querySelectorAll(`input[type="hidden"][name^="${namePrefix}"]`) || []);
    return [...checked, ...hidden].map(el => el.value).filter(Boolean);
  }
}
