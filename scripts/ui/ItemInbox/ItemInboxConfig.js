/**
 * ItemInboxConfig — GM Shard Configuration (Sprint 4.6 Expansion)
 * @file scripts/ui/ItemInbox/ItemInboxConfig.js
 * @module cyberpunkred-messenger
 * @description GM-only dialog for configuring all data shard settings.
 *   13 sections: Preset, Metadata, Encryption, Skills, Failure, Login,
 *   Key Item, Network (expanded), Tracing, Integrity, Expiration, Boot, Linked Shards.
 */

import { MODULE_ID, DEFAULTS, SKILL_MAP, SHARD_PRESETS, NETWORK_ACCESS_MODES, NETWORK_TYPES, CONNECTION_MODES } from '../../utils/constants.js';
import { log, isGM } from '../../utils/helpers.js';
import { BaseApplication } from '../BaseApplication.js';

/** Common FA icons for the boot icon dropdown */
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

export class ItemInboxConfig extends BaseApplication {

  item = null;

  get dataShardService() { return game.nightcity?.dataShardService; }
  get networkService() { return game.nightcity?.networkService; }

  static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
    id: 'ncm-item-inbox-config',
    classes: ['ncm-app', 'ncm-item-inbox-config'],
    window: { title: 'NCM.DataShard.Config', icon: 'fas fa-cog', resizable: true, minimizable: false },
    position: { width: 540, height: 720 },
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
      addNetworkTag: ItemInboxConfig._onAddNetworkTag,
      removeNetworkTag: ItemInboxConfig._onRemoveNetworkTag,
      changeIconMode: ItemInboxConfig._onChangeIconMode,
      selectIconColor: ItemInboxConfig._onSelectIconColor,
      relockShard: ItemInboxConfig._onRelockShard,
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
  //  DATA PREPARATION
  // ═══════════════════════════════════════════════════════════

  async _prepareContext(options) {
    if (!this.item || !isGM()) return { hasItem: false };
    const config = this.dataShardService?.getConfig(this.item) ?? foundry.utils.deepClone(DEFAULTS.SHARD_CONFIG);
    const networks = this.networkService?.getAllNetworks() ?? [];

    // ─── Preset ───
    const presetOptions = Object.entries(SHARD_PRESETS).map(([key, preset]) => ({
      value: key, label: preset.label, selected: config.preset === key,
    }));

    // ─── Metadata ───
    const meta = config.metadata ?? {};

    // ─── Encryption ───
    const encryptionTypes = [
      { value: 'ICE', label: 'ICE (Standard)', selected: config.encryptionType === 'ICE' },
      { value: 'BLACK_ICE', label: 'BLACK ICE (Damage)', selected: config.encryptionType === 'BLACK_ICE' },
      { value: 'RED_ICE', label: 'RED ICE (Lethal)', selected: config.encryptionType === 'RED_ICE' },
    ];

    // ─── Skills ───
    const skillEntries = (config.allowedSkills || []).map(name => ({
      name, dc: config.skillDCs?.[name] ?? config.encryptionDC ?? 15,
      stat: SKILL_MAP[name]?.stat?.toUpperCase() ?? '?',
    }));
    const allSkills = Object.keys(SKILL_MAP).filter(s => !(config.allowedSkills || []).includes(s)).sort();

    // ─── Failure ───
    const failureModes = [
      { value: 'nothing', label: 'No consequence', selected: config.failureMode === 'nothing' },
      { value: 'lockout', label: 'Lockout (timed)', selected: config.failureMode === 'lockout' },
      { value: 'permanent', label: 'Permanent lockout', selected: config.failureMode === 'permanent' },
      { value: 'damage', label: 'BLACK ICE damage + lockout', selected: config.failureMode === 'damage' },
      { value: 'destroy', label: 'Self-destruct shard', selected: config.failureMode === 'destroy' },
    ];
    const lockoutMinutes = Math.round((config.lockoutDuration || 3600000) / 60000);

    // ─── Network (expanded) ───
    const netConfig = config.network ?? {};
    const networkRequired = netConfig.required ?? config.requiresNetwork ?? false;
    const networkOptions = networks.map(n => ({
      value: n.id, label: n.name,
      selected: (netConfig.allowedNetworks ?? []).includes(n.id),
    }));
    const accessModeOptions = [
      { value: 'any', label: 'Any Network', selected: netConfig.accessMode === 'any' },
      { value: 'whitelist', label: 'Specific Networks', selected: netConfig.accessMode === 'whitelist' },
      { value: 'type', label: 'Network Types', selected: netConfig.accessMode === 'type' },
      { value: 'both', label: 'Types + Whitelist', selected: netConfig.accessMode === 'both' },
    ];
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
    const bootIconOptions = BOOT_ICON_OPTIONS.map(o => ({
      ...o, selected: boot.faIcon === o.value,
    }));
    const bootLogLines = boot.logLines ?? [];

    // ─── Icon Color Palette (shared) ───
    const ICON_COLORS = [
      { key: 'red', hex: '#F65261' }, { key: 'cyan', hex: '#19f3f7' },
      { key: 'gold', hex: '#f7c948' }, { key: 'green', hex: '#00ff41' },
      { key: 'purple', hex: '#a855f7' }, { key: 'danger', hex: '#ff0033' },
      { key: 'orange', hex: '#e88030' }, { key: 'white', hex: '#e0e0e8' },
      { key: 'muted', hex: '#888888' },
    ];
    const bootIconColor = boot.iconColor || '';
    const bootImageTint = boot.imageTint || '';
    const iconColorOptions = ICON_COLORS.map(c => ({
      ...c, isActive: bootIconColor === c.hex,
    }));

    // ─── Legacy network compat ───
    const legacyNetworkOptions = networks.map(n => ({
      value: n.id, label: n.name,
      selected: config.requiredNetwork === n.id,
    }));

    return {
      hasItem: true,
      itemName: this.item.name,
      config,

      // Preset
      presetOptions,
      currentPreset: config.preset || 'blank',

      // Metadata
      metaCreator: meta.creator || '',
      metaNetwork: meta.network || '',
      metaLocation: meta.location || '',
      metaTimestamp: meta.timestamp || '',
      metaClassification: meta.classification || '',

      // Type line display mode
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

      // Failure
      failureModes,
      maxHackAttempts: config.maxHackAttempts,
      lockoutMinutes,

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
      keyItemBypassLogin: config.keyItemBypassLogin,
      keyItemBypassEncryption: config.keyItemBypassEncryption,
      keyItemConsumeOnUse: config.keyItemConsumeOnUse,

      // Network
      networkRequired,
      accessModeOptions,
      networkTypeChecks,
      networkOptions,
      connectionModeOffline: (netConfig.connectionMode ?? 'offline') === 'offline',
      connectionModeTethered: (netConfig.connectionMode ?? 'offline') === 'tethered',
      signalThreshold: netConfig.signalThreshold ?? 40,
      signalDVModifier: netConfig.signalDVModifier ?? true,
      signalDegradation: netConfig.signalDegradation ?? false,

      // Tracing
      tracingEnabled: tracing.enabled ?? false,
      tracingMode: tracing.mode ?? 'silent',
      tracingModeSilent: tracing.mode === 'silent',
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
      bootIconModeValue: boot.iconMode ?? 'fa',
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
      hasBootLogLines: bootLogLines.length > 0,

      // Icon colors (shared palette)
      iconColorOptions,
      bootIconColor,
      bootImageTint,

      // Key item icon
      keyItemIconOptions: BOOT_ICON_OPTIONS.map(o => ({
        ...o, selected: config.keyItemIcon === o.value,
      })),
      keyItemIconMode: 'fa',
      keyItemIconModeFa: true,
      keyItemIconModeImage: false,
      keyItemImageUrl: config.keyItemImageUrl || '',

      // Display
      singleMessage: config.singleMessage,
      shardName: config.shardName || '',

      // Notifications
      notifyGM: config.notifyGM ?? true,
      notifyContact: config.notifyContact ?? false,
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  SAVE CONFIG
  // ═══════════════════════════════════════════════════════════

  static async _onSaveConfig(event, target) {
    if (!isGM() || !this.item) return;
    const form = this.element.querySelector('form');
    if (!form) return;
    const fd = new FormDataExtended(form);
    const data = fd.object;

    // Collect complex fields
    const allowedSkills = this._collectSkills();
    const skillDCs = this._collectSkillDCs();
    const bootLogLines = this._collectBootLogLines();
    const allowedNetworks = this._collectCheckedValues('allowedNetwork');
    const allowedTypes = this._collectCheckedValues('allowedType');

    const config = {
      // Identity
      preset: data.preset || 'blank',
      shardName: data.shardName || '',

      // Metadata
      metadata: {
        creator: data.metaCreator || '',
        network: data.metaNetwork || '',
        location: data.metaLocation || '',
        timestamp: data.metaTimestamp || '',
        classification: data.metaClassification || '',
        typeLineMode: data.typeLineMode || 'preset-status',
        typeLineCustom: data.typeLineCustom || '',
        custom: {},
      },

      // Encryption
      encrypted: !!data.encrypted,
      encryptionType: data.encryptionType || 'ICE',
      encryptionDC: parseInt(data.encryptionDC) || 15,
      encryptionMode: data.encryptionMode || 'shard',
      allowedSkills,
      skillDCs,

      // Failure
      failureMode: data.failureMode || 'lockout',
      maxHackAttempts: parseInt(data.maxHackAttempts) || 3,
      lockoutDuration: (parseInt(data.lockoutMinutes) || 60) * 60000,

      // Login
      requiresLogin: !!data.requiresLogin,
      loginUsername: data.loginUsername || '',
      loginPassword: data.loginPassword || '',
      loginDisplayName: data.loginDisplayName || '',
      maxLoginAttempts: parseInt(data.maxLoginAttempts) || 3,

      // Key Item
      requiresKeyItem: !!data.requiresKeyItem,
      keyItemName: data.keyItemName || null,
      keyItemId: data.keyItemId || null,
      keyItemTag: data.keyItemTag || null,
      keyItemDisplayName: data.keyItemDisplayName || '',
      keyItemIcon: data.keyItemIcon || 'fa-id-card',
      keyItemBypassLogin: !!data.keyItemBypassLogin,
      keyItemBypassEncryption: !!data.keyItemBypassEncryption,
      keyItemConsumeOnUse: !!data.keyItemConsumeOnUse,

      // Network (expanded)
      network: {
        required: !!data.networkRequired,
        accessMode: data.accessMode || 'any',
        allowedNetworks,
        allowedTypes,
        connectionMode: data.connectionMode || 'offline',
        signalThreshold: parseInt(data.signalThreshold) || 40,
        signalDVModifier: !!data.signalDVModifier,
        signalDegradation: !!data.signalDegradation,
        tracing: {
          enabled: !!data.tracingEnabled,
          mode: data.tracingMode || 'silent',
          triggerOn: data.tracingTriggerOn || 'access',
          traceTarget: data.traceTarget || null,
          traceMessage: data.traceMessage || null,
          traceDelay: parseInt(data.traceDelay) || 0,
          revealIdentity: !!data.tracingRevealIdentity,
          revealLocation: !!data.tracingRevealLocation,
          cooldown: parseInt(data.tracingCooldown) || 0,
        },
      },

      // Legacy compat (keep in sync)
      requiresNetwork: !!data.networkRequired,
      requiredNetwork: allowedNetworks[0] || null,

      // Integrity
      integrity: {
        enabled: !!data.integrityEnabled,
        mode: data.integrityMode || 'cosmetic',
        maxIntegrity: parseInt(data.integrityMax) || 100,
        currentIntegrity: parseInt(data.integrityMax) || 100,
        degradePerFailure: parseInt(data.integrityDegradePerFailure) || 15,
        corruptionThreshold: parseInt(data.integrityCorruptionThreshold) || 40,
        corruptionChance: (parseInt(data.integrityCorruptionChance) || 30) / 100,
      },

      // Expiration
      expiration: {
        enabled: !!data.expirationEnabled,
        mode: data.expirationMode || 'timer',
        timerDuration: (parseInt(data.expirationHours) || 48) * 3600000,
        calendarDate: data.expirationCalendarDate || null,
        accessCount: parseInt(data.expirationAccessCount) || 1,
        triggered: false,
        triggeredAt: null,
      },

      // Boot Sequence
      boot: {
        enabled: !!data.bootEnabled,
        iconMode: data.bootIconMode || 'fa',
        faIcon: data.bootFaIconManual?.trim() || data.bootFaIcon || 'fas fa-microchip',
        iconColor: data.bootIconColor || '',
        imageUrl: data.bootImageUrl || null,
        imageSize: parseInt(data.bootImageSize) || 64,
        imageTint: data.bootImageTint || '',
        imageBorderRadius: data.bootImageBorderRadius || 'rounded',
        title: data.bootTitle || '',
        subtitle: data.bootSubtitle || '',
        progressLabel: data.bootProgressLabel || '',
        logLines: bootLogLines,
        speed: data.bootSpeed || 'normal',
        customSeconds: parseFloat(data.bootCustomSeconds) || null,
        animationStyle: SHARD_PRESETS[data.preset]?.boot?.animationStyle || 'standard-fade',
      },

      // Linked Shards (shell)
      linkedShards: [],

      // Notifications
      notifyGM: !!data.notifyGM,
      notifyContact: !!data.notifyContact,
      notifyContactId: data.notifyContactId || null,

      // Display
      theme: data.preset || 'blank',
      singleMessage: !!data.singleMessage,
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
  //  PRESET APPLICATION
  // ═══════════════════════════════════════════════════════════

  static async _onApplyPreset(event, target) {
    if (!isGM() || !this.item) return;
    const presetKey = this.element.querySelector('[name="preset"]')?.value;
    if (!presetKey || !SHARD_PRESETS[presetKey]) return;

    const confirm = await Dialog.confirm({
      title: 'Apply Preset',
      content: `<p>Apply <strong>${SHARD_PRESETS[presetKey].label}</strong> preset? This will overwrite security, boot, and theme settings.</p>`,
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
    const container = this.element.querySelector('.ncm-skill-list');
    if (!container) return;
    const dc = parseInt(this.element.querySelector('[name="encryptionDC"]')?.value) || 15;
    const entry = document.createElement('div');
    entry.classList.add('ncm-skill-entry');
    entry.dataset.skill = skillName;
    entry.innerHTML = `<span class="ncm-skill-name">${skillName}</span>
      <label>DV: <input type="number" name="skillDC-${skillName}" value="${dc}" min="1" max="30" class="ncm-skill-dc" /></label>
      <button type="button" class="ncm-shard-hdr-btn" data-action="removeSkill" data-skill="${skillName}" title="Remove"><i class="fas fa-times"></i></button>`;
    container.appendChild(entry);
    const opt = select.querySelector(`option[value="${skillName}"]`);
    if (opt) opt.remove();
    select.value = '';
  }

  static _onRemoveSkill(event, target) {
    const skillName = target.dataset.skill || target.closest('[data-skill]')?.dataset.skill;
    if (!skillName) return;
    const entry = this.element.querySelector(`.ncm-skill-entry[data-skill="${skillName}"]`);
    if (entry) entry.remove();
  }

  // ═══════════════════════════════════════════════════════════
  //  BOOT LOG LINE MANAGEMENT
  // ═══════════════════════════════════════════════════════════

  static _onAddBootLogLine(event, target) {
    const container = this.element.querySelector('.ncm-boot-log-list');
    if (!container) return;
    const entry = document.createElement('div');
    entry.classList.add('ncm-boot-log-entry');
    entry.innerHTML = `<input type="text" name="bootLogLine" class="ncm-config-input" value="" placeholder="Log line text..." />
      <button type="button" class="ncm-shard-hdr-btn ncm-shard-hdr-btn--danger" data-action="removeBootLogLine" title="Remove"><i class="fas fa-times"></i></button>`;
    container.appendChild(entry);
  }

  static _onRemoveBootLogLine(event, target) {
    const entry = target.closest('.ncm-boot-log-entry');
    if (entry) entry.remove();
  }

  // ═══════════════════════════════════════════════════════════
  //  RESET
  // ═══════════════════════════════════════════════════════════

  static async _onResetDefaults(event, target) {
    const confirm = await Dialog.confirm({ title: 'Reset', content: '<p>Reset all configuration to defaults? This cannot be undone.</p>' });
    if (!confirm) return;
    await this.dataShardService.updateConfig(this.item, foundry.utils.deepClone(DEFAULTS.SHARD_CONFIG));
    this.render();
  }

  // ═══════════════════════════════════════════════════════════
  //  ICON GRID & FILE PICKER
  // ═══════════════════════════════════════════════════════════

  static _onSelectIcon(event, target) {
    const icon = target.dataset.icon;
    const targetInput = target.dataset.target;
    if (!icon || !targetInput) return;
    const input = this.element?.querySelector(`[name="${targetInput}"]`);
    if (input) input.value = icon;
    const grid = target.closest('.ncm-icon-grid');
    grid?.querySelectorAll('.ncm-icon-grid__item').forEach(el => {
      el.classList.toggle('ncm-icon-grid__item--active', el.dataset.icon === icon);
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

  // ═══════════════════════════════════════════════════════════
  //  NETWORK TAG +/- MANAGEMENT
  // ═══════════════════════════════════════════════════════════

  static _onAddNetworkTag(event, target) {
    const select = this.element?.querySelector('#ncm-add-network-select');
    const value = select?.value;
    if (!value) return;
    const label = select.options[select.selectedIndex]?.text || value;
    const container = this.element?.querySelector('#ncm-network-tags');
    if (!container) return;
    if (container.querySelector(`[data-value="${value}"]`)) return;

    const tag = document.createElement('div');
    tag.classList.add('ncm-tag');
    tag.dataset.value = value;
    tag.innerHTML = `<span>${label}</span>
      <button type="button" class="ncm-tag__remove" data-action="removeNetworkTag" data-value="${value}"><i class="fas fa-times"></i></button>
      <input type="hidden" name="allowedNetwork" value="${value}" />`;
    container.appendChild(tag);

    const opt = select.querySelector(`option[value="${value}"]`);
    if (opt) opt.remove();
    select.value = '';
  }

  static _onRemoveNetworkTag(event, target) {
    const value = target.dataset.value || target.closest('[data-value]')?.dataset.value;
    if (!value) return;
    const tag = this.element?.querySelector(`#ncm-network-tags [data-value="${value}"]`);
    if (tag) {
      const label = tag.querySelector('span')?.textContent || value;
      tag.remove();
      const select = this.element?.querySelector('#ncm-add-network-select');
      if (select) {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = label;
        select.appendChild(opt);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  ICON MODE TOGGLE & COLOR SELECTION
  // ═══════════════════════════════════════════════════════════

  static _onChangeIconMode(event, target) {
    const group = target.closest('.ncm-icon-mode-group');
    if (!group) return;
    const mode = target.value;
    group.dataset.activeMode = mode;
  }

  static _onSelectIconColor(event, target) {
    const color = target.dataset.color;
    const targetInput = target.dataset.target;
    if (!color || !targetInput) return;
    const input = this.element?.querySelector(`[name="${targetInput}"]`);
    if (input) input.value = color;
    const row = target.closest('.ncm-icon-color-row');
    row?.querySelectorAll('.ncm-icon-color-dot').forEach(dot => {
      dot.classList.toggle('ncm-icon-color-dot--active', dot.dataset.color === color);
    });
  }

  static async _onRelockShard(event, target) {
    if (!this.item) return;
    const confirm = await Dialog.confirm({
      title: 'Relock All Security',
      content: `<p>This will reset <strong>ALL</strong> security state for this shard:</p>
        <ul style="margin:8px 0 8px 16px;font-size:13px;">
          <li>Re-encrypt the shard</li>
          <li>Reset all login sessions</li>
          <li>Clear key item authorizations</li>
          <li>Reset hack attempts and lockouts</li>
          <li>Replay boot sequence</li>
          <li>Reset expiration timers</li>
          <li>Restore destroyed shards</li>
        </ul>
        <p>This affects <strong>all players</strong>. Continue?</p>`,
    });
    if (!confirm) return;

    const result = await this.dataShardService?.relockShard(this.item);
    if (result?.success) {
      ui.notifications.info('NCM | All security relocked.');
      // Force re-render any open viewer for this shard
      const itemId = this.item.id;
      for (const app of Object.values(ui.windows)) {
        if (app.item?.id === itemId && app !== this) {
          app.render(true);
        }
      }
    } else {
      ui.notifications.error(`NCM | Relock failed: ${result?.error || 'Unknown'}`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  COLLECTION HELPERS
  // ═══════════════════════════════════════════════════════════

  _collectSkills() {
    return Array.from(this.element?.querySelectorAll('.ncm-skill-entry') || [])
      .map(el => el.dataset.skill).filter(Boolean);
  }

  _collectSkillDCs() {
    const dcs = {};
    for (const el of this.element?.querySelectorAll('.ncm-skill-entry') || []) {
      const name = el.dataset.skill;
      const dc = el.querySelector('.ncm-skill-dc');
      if (name && dc) dcs[name] = parseInt(dc.value) || 15;
    }
    return dcs;
  }

  _collectBootLogLines() {
    return Array.from(this.element?.querySelectorAll('[name="bootLogLine"]') || [])
      .map(el => el.value?.trim()).filter(Boolean);
  }

  _collectCheckedValues(namePrefix) {
    // Collect checked checkboxes/radios AND hidden inputs with matching name prefix
    // (hidden inputs are used by the tag-list UI pattern for network whitelists)
    const checked = Array.from(this.element?.querySelectorAll(`[name^="${namePrefix}"]:checked`) || []);
    const hidden = Array.from(this.element?.querySelectorAll(`input[type="hidden"][name^="${namePrefix}"]`) || []);
    const combined = [...checked, ...hidden];
    return combined.map(el => el.value).filter(Boolean);
  }
}
