/**
 * ItemInboxConfig — GM Shard Configuration
 * @file scripts/ui/ItemInbox/ItemInboxConfig.js
 * @module cyberpunkred-messenger
 * @description GM-only dialog for configuring data shard security layers.
 */

import { MODULE_ID, DEFAULTS, SKILL_MAP } from '../../utils/constants.js';
import { log, isGM } from '../../utils/helpers.js';
import { BaseApplication } from '../BaseApplication.js';

const SHARD_THEME_OPTIONS = [
  { value: 'classic', label: 'Default' }, { value: 'arasaka', label: 'Arasaka' },
  { value: 'militech', label: 'Militech' }, { value: 'biotechnica', label: 'Biotechnica' },
  { value: 'kang-tao', label: 'Kang Tao' }, { value: 'trauma-team', label: 'Trauma Team' },
  { value: 'darknet', label: 'Darknet' }, { value: 'netwatch', label: 'NetWatch' },
];

export class ItemInboxConfig extends BaseApplication {

  item = null;

  get dataShardService() { return game.nightcity?.dataShardService; }
  get networkService() { return game.nightcity?.networkService; }

  static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
    id: 'ncm-item-inbox-config',
    classes: ['ncm-app', 'ncm-item-inbox-config'],
    window: { title: 'NCM.DataShard.Config', icon: 'fas fa-cog', resizable: true, minimizable: false },
    position: { width: 520, height: 680 },
    actions: {
      saveConfig: ItemInboxConfig._onSaveConfig,
      addSkill: ItemInboxConfig._onAddSkill,
      removeSkill: ItemInboxConfig._onRemoveSkill,
      resetDefaults: ItemInboxConfig._onResetDefaults,
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

  async _prepareContext(options) {
    if (!this.item || !isGM()) return { hasItem: false };
    const config = this.dataShardService?.getConfig(this.item) ?? { ...DEFAULTS.SHARD_CONFIG };
    const networks = this.networkService?.getAllNetworks() ?? [];

    const skillEntries = (config.allowedSkills || []).map(name => ({
      name, dc: config.skillDCs?.[name] ?? config.encryptionDC ?? 15,
      stat: SKILL_MAP[name]?.stat?.toUpperCase() ?? '?',
    }));
    const allSkills = Object.keys(SKILL_MAP).filter(s => !(config.allowedSkills || []).includes(s)).sort();

    const encryptionTypes = [
      { value: 'ICE', label: 'ICE (Standard)', selected: config.encryptionType === 'ICE' },
      { value: 'BLACK_ICE', label: 'BLACK ICE (Damage)', selected: config.encryptionType === 'BLACK_ICE' },
      { value: 'RED_ICE', label: 'RED ICE (Lethal)', selected: config.encryptionType === 'RED_ICE' },
    ];
    const failureModes = [
      { value: 'nothing', label: 'No consequence', selected: config.failureMode === 'nothing' },
      { value: 'lockout', label: 'Lockout (timed)', selected: config.failureMode === 'lockout' },
      { value: 'permanent', label: 'Permanent lockout', selected: config.failureMode === 'permanent' },
      { value: 'damage', label: 'BLACK ICE damage + lockout', selected: config.failureMode === 'damage' },
      { value: 'destroy', label: 'Self-destruct shard', selected: config.failureMode === 'destroy' },
    ];
    const networkOptions = networks.map(n => ({ value: n.id, label: n.name, selected: config.requiredNetwork === n.id }));
    const themeOptions = SHARD_THEME_OPTIONS.map(t => ({ ...t, selected: config.theme === t.value }));
    const lockoutMinutes = Math.round((config.lockoutDuration || 3600000) / 60000);

    return {
      hasItem: true, itemName: this.item.name, config, encryptionTypes,
      isEncrypted: config.encrypted, encryptionDC: config.encryptionDC,
      encryptionModeShard: config.encryptionMode === 'shard',
      encryptionModeMessage: config.encryptionMode === 'message',
      skillEntries, allSkills, hasSkills: skillEntries.length > 0,
      failureModes, maxHackAttempts: config.maxHackAttempts, lockoutMinutes,
      requiresLogin: config.requiresLogin, loginUsername: config.loginUsername,
      loginPassword: config.loginPassword, loginDisplayName: config.loginDisplayName,
      maxLoginAttempts: config.maxLoginAttempts,
      requiresKeyItem: config.requiresKeyItem, keyItemName: config.keyItemName,
      keyItemId: config.keyItemId, keyItemTag: config.keyItemTag,
      keyItemDisplayName: config.keyItemDisplayName, keyItemIcon: config.keyItemIcon,
      keyItemBypassLogin: config.keyItemBypassLogin, keyItemBypassEncryption: config.keyItemBypassEncryption,
      keyItemConsumeOnUse: config.keyItemConsumeOnUse,
      requiresNetwork: config.requiresNetwork, networkOptions, themeOptions,
      singleMessage: config.singleMessage,
    };
  }

  static async _onSaveConfig(event, target) {
    if (!isGM() || !this.item) return;
    const form = this.element.querySelector('form');
    if (!form) return;
    const fd = new FormDataExtended(form);
    const data = fd.object;

    const config = {
      encrypted: !!data.encrypted, encryptionType: data.encryptionType || 'ICE',
      encryptionDC: parseInt(data.encryptionDC) || 15, encryptionMode: data.encryptionMode || 'shard',
      allowedSkills: this._collectSkills(), skillDCs: this._collectSkillDCs(),
      failureMode: data.failureMode || 'lockout', maxHackAttempts: parseInt(data.maxHackAttempts) || 3,
      lockoutDuration: (parseInt(data.lockoutMinutes) || 60) * 60000,
      requiresLogin: !!data.requiresLogin, loginUsername: data.loginUsername || '',
      loginPassword: data.loginPassword || '', loginDisplayName: data.loginDisplayName || '',
      maxLoginAttempts: parseInt(data.maxLoginAttempts) || 3,
      requiresKeyItem: !!data.requiresKeyItem, keyItemName: data.keyItemName || null,
      keyItemId: data.keyItemId || null, keyItemTag: data.keyItemTag || null,
      keyItemDisplayName: data.keyItemDisplayName || '', keyItemIcon: data.keyItemIcon || 'fa-id-card',
      keyItemBypassLogin: !!data.keyItemBypassLogin, keyItemBypassEncryption: !!data.keyItemBypassEncryption,
      keyItemConsumeOnUse: !!data.keyItemConsumeOnUse,
      requiresNetwork: !!data.requiresNetwork, requiredNetwork: data.requiredNetwork || null,
      theme: data.theme || 'classic', singleMessage: !!data.singleMessage,
    };

    const result = await this.dataShardService.updateConfig(this.item, config);
    if (result.success) { ui.notifications.info('NCM | Shard configuration saved.'); this.close(); }
    else { ui.notifications.error(`NCM | Failed: ${result.error}`); }
  }

  static _onAddSkill(event, target) {
    const select = this.element.querySelector('[name="newSkill"]');
    const skillName = select?.value;
    if (!skillName) return;
    const container = this.element.querySelector('.ncm-skill-list');
    if (!container) return;
    const dc = parseInt(this.element.querySelector('[name="encryptionDC"]')?.value) || 15;
    const entry = document.createElement('div');
    entry.classList.add('ncm-skill-entry'); entry.dataset.skill = skillName;
    entry.innerHTML = `<span class="ncm-skill-name">${skillName}</span>
      <label>DV: <input type="number" name="skillDC-${skillName}" value="${dc}" min="1" max="30" class="ncm-skill-dc" /></label>
      <button type="button" class="ncm-btn-icon" data-action="removeSkill" data-skill="${skillName}" title="Remove"><i class="fas fa-times"></i></button>`;
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

  static async _onResetDefaults(event, target) {
    const confirm = await Dialog.confirm({ title: 'Reset', content: '<p>Reset config to defaults?</p>' });
    if (!confirm) return;
    await this.dataShardService.updateConfig(this.item, { ...DEFAULTS.SHARD_CONFIG });
    this.render();
  }

  _collectSkills() {
    return Array.from(this.element?.querySelectorAll('.ncm-skill-entry') || []).map(el => el.dataset.skill).filter(Boolean);
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
}
