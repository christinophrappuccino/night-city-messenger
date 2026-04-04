/**
 * Shard Conversion Flow
 * @file scripts/ui/dialogs/ShardConversionFlow.js
 * @module cyberpunkred-messenger
 * @description Tier-gated shard creation wizard. Players convert inventory
 *              items into data shards with configuration options gated by
 *              their skill level and the GM's floor setting.
 *
 *              Tiers: basic / mid / full (+ GM always = full, no roll)
 */

import { MODULE_ID, TEMPLATES, SOCKET_OPS } from '../../utils/constants.js';
import { log, isGM } from '../../utils/helpers.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

// ── Tier ordering for max() comparisons ──
const TIER_ORDER = { disabled: 0, basic: 1, mid: 2, full: 3 };

// ── DV ceiling lookup from roll total ──
const DV_CEILINGS_MID = [
  { min: 0,  max: 9,  dv: 8,  label: 'Trivial',  tier: 'low' },
  { min: 10, max: 14, dv: 12, label: 'Easy',     tier: 'mid' },
  { min: 15, max: 19, dv: 15, label: 'Moderate', tier: 'mid' },
  { min: 20, max: 24, dv: 18, label: 'Hard',     tier: 'good' },
  { min: 25, max: 99, dv: 22, label: 'Very Hard', tier: 'good' },
];

// ── Full-tier ceiling lookup ──
const DV_CEILINGS_FULL = [
  { min: 0,  max: 9,  dv: 10, label: 'DV ≤ 10, ICE only, lockout only',    canBlackICE: false, canRedICE: false, anyFailure: false, canKeyItem: false },
  { min: 10, max: 14, dv: 15, label: 'DV ≤ 15, ICE only, any failure',      canBlackICE: false, canRedICE: false, anyFailure: true,  canKeyItem: false },
  { min: 15, max: 19, dv: 18, label: 'DV ≤ 18, ICE or BLACK, any failure',  canBlackICE: true,  canRedICE: false, anyFailure: true,  canKeyItem: false },
  { min: 20, max: 24, dv: 22, label: 'DV ≤ 22, any ICE, any failure',       canBlackICE: true,  canRedICE: true,  anyFailure: true,  canKeyItem: false },
  { min: 25, max: 99, dv: 25, label: 'DV ≤ 25, any ICE, any failure, key item', canBlackICE: true,  canRedICE: true,  anyFailure: true,  canKeyItem: true },
];

// ── Default icon options ──
const ICON_OPTIONS_BASIC = [
  { value: 'fas fa-envelope',    label: 'fa-envelope — Envelope' },
  { value: 'fas fa-key',         label: 'fa-key — Key' },
  { value: 'fas fa-map-pin',     label: 'fa-map-pin — Location' },
  { value: 'fas fa-note-sticky', label: 'fa-note-sticky — Note' },
  { value: 'fas fa-file',        label: 'fa-file — File' },
];
const ICON_OPTIONS_FULL = [
  ...ICON_OPTIONS_BASIC,
  { value: 'fas fa-crosshairs',  label: 'fa-crosshairs — Crosshairs' },
  { value: 'fas fa-shield-halved', label: 'fa-shield-halved — Shield' },
  { value: 'fas fa-skull',       label: 'fa-skull — Skull' },
  { value: 'fas fa-bug',         label: 'fa-bug — Bug' },
  { value: 'fas fa-user-secret', label: 'fa-user-secret — Agent' },
];

// ── Color options ──
const COLOR_OPTIONS = [
  '#F65261', '#19f3f7', '#f7c948', '#00ff41', '#a855f7', '#aaaaaa',
];

// ── Content type definitions ──
const CONTENT_TYPES = [
  { id: 'message',  icon: 'fas fa-envelope',     label: 'Message' },
  { id: 'eddies',   icon: 'fas fa-coins',        label: 'Eddies' },
  { id: 'dossier',  icon: 'fas fa-user-secret',  label: 'Dossier' },
  { id: 'payload',  icon: 'fas fa-bug',          label: 'Payload' },
  { id: 'avlog',    icon: 'fas fa-microphone',   label: 'AV Log' },
  { id: 'location', icon: 'fas fa-map-pin',      label: 'Location' },
];

export class ShardConversionFlow extends HandlebarsApplicationMixin(ApplicationV2) {

  // ═══════════════════════════════════════════════════════════
  //  Static Config
  // ═══════════════════════════════════════════════════════════

  static DEFAULT_OPTIONS = {
    id: 'ncm-shard-conversion-{id}',
    classes: ['ncm-app'],
    window: {
      title: 'Create Data Shard',
      icon: 'fas fa-microchip',
      resizable: false,
    },
    position: { width: 520, height: 'auto' },
    actions: {
      rollSkill:          ShardConversionFlow._onRollSkill,
      selectICEType:      ShardConversionFlow._onSelectICEType,
      selectColor:        ShardConversionFlow._onSelectColor,
      selectContentType:  ShardConversionFlow._onSelectContentType,
      cancel:             ShardConversionFlow._onCancel,
      createShard:        ShardConversionFlow._onCreateShard,
    },
  };

  static PARTS = {
    form: { template: TEMPLATES.SHARD_CONVERSION },
  };

  // ═══════════════════════════════════════════════════════════
  //  Constructor
  // ═══════════════════════════════════════════════════════════

  /**
   * @param {Item} item — The item to convert (already selected) or null for picker
   * @param {Actor} actor — The owning actor (for skill resolution)
   * @param {object} [options]
   */
  constructor(item, actor, options = {}) {
    const id = `ncm-shard-conversion-${foundry.utils.randomID(6)}`;
    super({ ...options, id });

    /** @type {Item|null} Pre-selected item */
    this._item = item ?? null;

    /** @type {Actor|null} */
    this._actor = actor ?? null;

    /** @type {object|null} Skill roll result — null until rolled */
    this._rollResult = null;

    /** @type {string} Effective tier: 'basic' | 'mid' | 'full' */
    this._tier = 'basic';

    /** @type {object} Computed ceiling from roll */
    this._ceiling = null;

    // ── Form state ──
    this._selectedICEType = 'ICE';
    this._selectedColor = '#19f3f7';
    this._selectedContentType = 'message';
    this._encoding = false;

    // ── Compute tier ──
    this._computeTier();
  }

  // ═══════════════════════════════════════════════════════════
  //  Getters
  // ═══════════════════════════════════════════════════════════

  get dataShardService() { return game.nightcity?.dataShardService; }
  get skillService() { return game.nightcity?.skillService; }

  // ═══════════════════════════════════════════════════════════
  //  Tier Calculation
  // ═══════════════════════════════════════════════════════════

  /**
   * Determine the effective tier from GM floor setting + actor skill.
   * GM always gets full tier, no roll needed.
   */
  _computeTier() {
    if (isGM()) {
      this._tier = 'full';
      // GM gets max ceiling without rolling
      this._rollResult = { total: 99, statName: 'GM', statValue: 0, skillValue: 0, dieValue: 0 };
      this._ceiling = { maxDV: 25, canBlackICE: true, canRedICE: true, anyFailure: true, canKeyItem: true };
      return;
    }

    // Read GM floor
    const floor = game.settings.get(MODULE_ID, 'playerShardFloor') || 'disabled';
    if (floor === 'disabled') {
      this._tier = 'disabled';
      return;
    }

    // Read skill config
    const skillName = game.settings.get(MODULE_ID, 'playerShardSkill') || 'interface';
    const skillData = this.skillService?.getSkillData(this._actor, skillName);
    const skillLevel = skillData?.skillLevel ?? 0;

    // Skill-based tier: 0-3 basic, 4-6 mid, 7+ full
    let skillTier = 'basic';
    if (skillLevel >= 7) skillTier = 'full';
    else if (skillLevel >= 4) skillTier = 'mid';

    // Effective tier = max(floor, skillTier)
    const floorVal = TIER_ORDER[floor] || 0;
    const skillVal = TIER_ORDER[skillTier] || 0;
    const effectiveVal = Math.max(floorVal, skillVal);

    this._tier = Object.entries(TIER_ORDER).find(([, v]) => v === effectiveVal)?.[0] ?? 'basic';

    // Store skill info for display
    this._skillName = skillName;
    this._skillData = skillData;
  }

  /**
   * Compute the ceiling based on roll result.
   * @param {number} total
   */
  _computeCeiling(total) {
    if (this._tier === 'mid') {
      const entry = DV_CEILINGS_MID.find(c => total >= c.min && total <= c.max);
      this._ceiling = {
        maxDV: entry?.dv ?? 8,
        dvLabel: entry?.label ?? 'Trivial',
        rollTier: entry?.tier ?? 'low',
        canBlackICE: false,
        canRedICE: false,
        anyFailure: false,
        canKeyItem: false,
      };
    } else {
      // Full tier
      const entry = DV_CEILINGS_FULL.find(c => total >= c.min && total <= c.max);
      const allowBlackICE = game.settings.get(MODULE_ID, 'playerBlackICE') ?? true;
      this._ceiling = {
        maxDV: entry?.dv ?? 10,
        ceilingLabel: entry?.label ?? '',
        canBlackICE: (entry?.canBlackICE ?? false) && allowBlackICE,
        canRedICE: (entry?.canRedICE ?? false) && allowBlackICE,
        anyFailure: entry?.anyFailure ?? false,
        canKeyItem: entry?.canKeyItem ?? false,
      };
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Context
  // ═══════════════════════════════════════════════════════════

  async _prepareContext(options) {
    const tier = this._tier;
    const isGMUser = isGM();
    const needsRoll = !isGMUser && (tier === 'mid' || tier === 'full');
    const hasRolled = !!this._rollResult && !isGMUser;
    const skillName = this._skillName || game.settings.get(MODULE_ID, 'playerShardSkill') || 'Interface';
    const ceiling = this._ceiling;

    // ── Inventory items for picker ──
    const inventoryItems = [];
    if (!this._item && this._actor) {
      for (const item of this._actor.items ?? []) {
        if (item.getFlag(MODULE_ID, 'isDataShard')) continue;
        inventoryItems.push({ id: item.id, name: item.name, selected: false });
      }
      inventoryItems.sort((a, b) => a.name.localeCompare(b.name));
    }

    // ── Roll color ──
    let rollColor = 'var(--ncm-accent)';
    let rollTier = 'mid';
    if (ceiling) {
      if (tier === 'mid') {
        rollTier = ceiling.rollTier || 'mid';
      } else {
        const total = this._rollResult?.total ?? 0;
        rollTier = total >= 20 ? 'good' : total >= 10 ? 'mid' : 'low';
      }
      rollColor = rollTier === 'good' ? 'var(--ncm-success)' : rollTier === 'low' ? 'var(--ncm-primary)' : 'var(--ncm-accent)';
    }

    // ── Ceiling items (Full tier) ──
    const ceilingItems = tier === 'full' && ceiling ? [
      { label: `DV ≤ ${ceiling.maxDV}`, active: true },
      { label: ceiling.canBlackICE ? 'Any ICE' : 'ICE Only', active: ceiling.canBlackICE },
      { label: 'All Failures', active: ceiling.anyFailure },
      { label: 'Key Item (25+)', active: ceiling.canKeyItem },
    ] : [];

    // ── Ceiling summary line ──
    const ceilingSummary = tier === 'full' && ceiling
      ? [
          ceiling.canBlackICE ? 'Any ICE' : 'ICE Only',
          ceiling.anyFailure ? 'Any Failure Mode' : 'Lockout Only',
        ].join(' · ')
      : '';

    // ── Icon options ──
    const iconOpts = tier === 'full' ? ICON_OPTIONS_FULL : ICON_OPTIONS_BASIC;
    const iconOptions = iconOpts.map((o, i) => ({ ...o, selected: i === 0 }));

    // ── Color options ──
    const colorOptions = COLOR_OPTIONS.map(c => ({
      value: c,
      active: c === this._selectedColor,
    }));

    // ── Content types (Full only) ──
    const contentTypes = CONTENT_TYPES.map(ct => ({
      ...ct,
      active: ct.id === this._selectedContentType,
    }));

    // ── Actor email for "From" field ──
    const emailService = game.nightcity?.emailService;
    const entryFrom = this._actor && emailService
      ? emailService.getEmail(this._actor) || ''
      : '';

    // ── Can create? ──
    const canCreate = isGMUser || (tier === 'basic') || (needsRoll && hasRolled);

    // ── Roll result for skill check display ──
    const rollResultData = this._rollResult && !isGMUser ? {
      total: this._rollResult.total,
      statName: this._rollResult.statName?.toUpperCase() || 'STAT',
      statValue: this._rollResult.statValue,
      skillValue: this._rollResult.skillValue,
      dieValue: this._rollResult.dieValue,
    } : null;

    // For the roll prompt (before rolling)
    if (!rollResultData && needsRoll) {
      // Still show skill info for prompt text
    }

    return {
      tier,
      isGM: isGMUser,
      skillName: this._formatSkillName(skillName),

      // Skill check
      showSkillCheck: needsRoll,
      rollResult: rollResultData,
      rollColor,
      rollTier,

      // Ceiling
      showCeiling: tier === 'full' && ceiling && !isGMUser,
      ceilingItems,
      ceilingSummary,
      ceilingLabel: ceiling?.ceilingLabel || '',

      // DV
      maxDV: ceiling?.maxDV ?? (isGMUser ? 25 : 15),
      defaultDV: ceiling?.maxDV ?? (isGMUser ? 15 : 8),
      dvLabel: ceiling?.dvLabel || '',

      // Item
      preselectedItem: this._item ? { id: this._item.id, name: this._item.name } : null,
      inventoryItems,
      shardName: this._item?.name || '',

      // Security visibility
      showPassword: tier === 'mid' || tier === 'full',
      showICE: tier === 'mid' || tier === 'full',
      showFailureMode: tier === 'full',
      showKeyItem: tier === 'full',
      canBlackICE: isGMUser || (ceiling?.canBlackICE ?? false),
      canRedICE: isGMUser || (ceiling?.canRedICE ?? false),
      canKeyItem: isGMUser || (ceiling?.canKeyItem ?? false),

      // Content
      showContentTypes: tier === 'full',
      contentTypes,
      entryFrom,

      // Appearance
      iconOptions,
      showCustomIcon: tier === 'full',
      colorOptions,

      // Basic notice
      showNoSecurityNotice: tier === 'basic' && !isGMUser,

      // Footer
      canCreate,
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  Render
  // ═══════════════════════════════════════════════════════════

  _onRender(context, options) {
    // Wire select change listeners (data-action on <select> fires on click, not change)
    const selects = this.element?.querySelectorAll('select[name]');
    selects?.forEach(sel => {
      sel.addEventListener('change', () => {
        // Nothing to do — values read at submit time
      });
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  Actions
  // ═══════════════════════════════════════════════════════════

  /**
   * Roll the encoding skill check.
   */
  static async _onRollSkill(event, target) {
    if (this._rollResult && !isGM()) return; // Already rolled

    const actor = this._actor;
    const skillName = this._skillName || game.settings.get(MODULE_ID, 'playerShardSkill') || 'interface';
    const skillData = this.skillService?.getSkillData(actor, skillName);

    const statValue = skillData?.statValue ?? 0;
    const skillValue = skillData?.skillLevel ?? 0;
    const statName = skillData?.statName ?? 'tech';

    // Roll 1d10
    const roll = new Roll('1d10');
    await roll.evaluate();
    const dieValue = roll.total;

    const total = statValue + skillValue + dieValue;

    this._rollResult = { total, statName, statValue, skillValue, dieValue };
    this._computeCeiling(total);

    // Optionally show the roll in chat
    roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: `<strong>Shard Encoding Check</strong> — ${this._formatSkillName(skillName)}<br>
               <span style="font-size:11px;color:#8888a0;">
                 ${statName.toUpperCase()} ${statValue} + ${this._formatSkillName(skillName)} ${skillValue} + 1d10
               </span>`,
    });

    this.render();
  }

  /**
   * Select ICE type pill.
   */
  static _onSelectICEType(event, target) {
    const value = target.dataset.value;
    if (!value) return;
    if (target.classList.contains('disabled')) return;

    // Deactivate all pills in parent, activate this one
    target.closest('.ncm-convert__pills')?.querySelectorAll('.ncm-convert__pill').forEach(p => {
      p.classList.toggle('active', p === target);
    });
    this._selectedICEType = value;
  }

  /**
   * Select accent color dot.
   */
  static _onSelectColor(event, target) {
    const value = target.dataset.value;
    if (!value) return;
    target.closest('.ncm-convert__colors')?.querySelectorAll('.ncm-convert__color-dot').forEach(d => {
      d.classList.toggle('active', d === target);
    });
    this._selectedColor = value;
  }

  /**
   * Select content type pill (Full tier).
   */
  static _onSelectContentType(event, target) {
    const value = target.dataset.value;
    if (!value) return;
    target.closest('.ncm-convert__pills')?.querySelectorAll('.ncm-convert__pill').forEach(p => {
      p.classList.toggle('active', p.dataset.value === value);
    });
    this._selectedContentType = value;
  }

  /**
   * Cancel — close the dialog.
   */
  static _onCancel() {
    this.close();
  }

  /**
   * Create the shard — gather form data, run conversion, play animation.
   */
  static async _onCreateShard(event, target) {
    if (this._encoding) return;

    const formData = this._gatherFormData();
    if (!formData) return;

    // Validate item selection
    const item = this._item || (formData.itemId ? this._actor?.items?.get(formData.itemId) : null);
    if (!item) {
      ui.notifications.warn('Please select an item to convert.');
      return;
    }

    this._encoding = true;

    // Play encoding animation
    await this._playEncodingAnimation();

    // Build config overrides
    const config = {};
    if (formData.shardName) config.shardName = formData.shardName;

    // Security
    if (this._tier !== 'basic') {
      if (formData.requiresLogin) {
        config.requiresLogin = true;
        config.loginPassword = formData.loginPassword || '';
      }
      if (formData.encrypted) {
        config.encrypted = true;
        config.encryptionType = this._selectedICEType;
        config.encryptionDC = Math.min(formData.encryptionDC || 15, this._ceiling?.maxDV ?? 25);
      }
      if (this._tier === 'full') {
        if (formData.failureMode) config.failureMode = formData.failureMode;
        if (formData.maxHackAttempts) config.maxHackAttempts = parseInt(formData.maxHackAttempts) || 3;
        if (formData.requiresKeyItem && this._ceiling?.canKeyItem) {
          config.requiresKeyItem = true;
          config.keyItemName = formData.keyItemName || '';
        }
      }
    }

    // Convert the item
    try {
      const service = this.dataShardService;
      if (!service) throw new Error('DataShardService not available');

      // For player conversion, we need to route through socket if not GM
      if (isGM()) {
        const result = await service.convertToDataShard(item, config);
        if (!result.success) throw new Error(result.error);
      } else {
        // Player conversion: emit socket request to GM
        const socketManager = game.nightcity?.socketManager;
        if (!socketManager) throw new Error('Socket not available');

        const success = await this._requestPlayerConversion(item, config);
        if (!success) throw new Error('Conversion request denied');
      }

      // Add the initial entry as a journal page
      await this._createInitialEntry(item, formData);

      ui.notifications.info(`"${item.name}" converted to data shard`);
      this.close();

      // Refresh sheets
      setTimeout(() => {
        ui.items?.render();
        for (const sheet of Object.values(ui.windows)) {
          if (sheet.actor?.items?.has(item.id)) sheet.render(false);
        }
      }, 150);

    } catch (err) {
      ui.notifications.error(`Failed to create shard: ${err.message}`);
      log.error('Shard conversion failed:', err);
      this._encoding = false;
      // Hide encoding overlay
      const overlay = this.element?.querySelector('[data-id="encoding-overlay"]');
      if (overlay) overlay.style.display = 'none';
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Player Conversion (Socket Relay)
  // ═══════════════════════════════════════════════════════════

  /**
   * Request the GM's client to perform the conversion via socket.
   * @param {Item} item
   * @param {object} config
   * @returns {Promise<boolean>}
   */
  async _requestPlayerConversion(item, config) {
    return new Promise((resolve) => {
      const socketManager = game.nightcity?.socketManager;
      if (!socketManager) return resolve(false);

      const requestId = foundry.utils.randomID(8);

      // Listen for response
      const handler = (data) => {
        if (data.requestId !== requestId) return;
        resolve(data.success);
      };

      socketManager.register(SOCKET_OPS.SHARD_CONVERT_RESULT, handler);

      // Send request to GM
      socketManager.emit(SOCKET_OPS.SHARD_CONVERT_REQUEST, {
        requestId,
        itemId: item.id,
        actorId: this._actor?.id,
        config,
      });

      // Timeout after 10 seconds
      setTimeout(() => resolve(false), 10000);
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  Initial Entry
  // ═══════════════════════════════════════════════════════════

  /**
   * Create the first journal page entry on the shard.
   * @param {Item} item
   * @param {object} formData
   */
  async _createInitialEntry(item, formData) {
    const journalId = item.getFlag(MODULE_ID, 'journalId');
    if (!journalId) return;

    const journal = game.journal.get(journalId);
    if (!journal) return;

    const body = formData.entryBody?.trim();
    if (!body) return;

    const entryIcon = formData.customIcon?.trim() || formData.entryIcon || 'fas fa-envelope';
    const timestamp = game.nightcity?.timeService?.getCurrentTimestamp() || new Date().toISOString();

    try {
      await journal.createEmbeddedDocuments('JournalEntryPage', [{
        name: formData.entrySubject || 'Untitled',
        type: 'text',
        text: { content: body },
        flags: {
          [MODULE_ID]: {
            entryType: this._selectedContentType,
            from: formData.entryFrom || '',
            subject: formData.entrySubject || '',
            icon: entryIcon,
            accentColor: this._selectedColor,
            timestamp,
            order: 0,
          },
        },
      }]);
    } catch (err) {
      log.warn('Failed to create initial shard entry:', err);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Encoding Animation
  // ═══════════════════════════════════════════════════════════

  async _playEncodingAnimation() {
    const overlay = this.element?.querySelector('[data-id="encoding-overlay"]');
    if (!overlay) return;

    overlay.style.display = 'flex';
    const status = overlay.querySelector('[data-id="encoding-status"]');
    const fill = overlay.querySelector('[data-id="encoding-fill"]');
    const logEl = overlay.querySelector('[data-id="encoding-log"]');

    const steps = [
      { text: 'INITIALIZING CHIP INTERFACE...', progress: 15, log: 'Chip interface ................ OK' },
      { text: 'ENCODING DATA...', progress: 40, log: 'Data encoding ................ OK' },
      { text: 'APPLYING ICE LAYER...', progress: 65, log: 'Security layer ............... OK' },
      { text: 'WRITING SHARD METADATA...', progress: 85, log: 'Metadata write ............... OK' },
      { text: 'SHARD READY', progress: 100, log: 'Verification ................. PASS' },
    ];

    const logLines = [];
    for (const step of steps) {
      if (status) status.textContent = step.text;
      if (fill) fill.style.width = `${step.progress}%`;
      logLines.push(step.log);
      if (logEl) logEl.textContent = logLines.join('\n');
      await this._wait(400 + Math.random() * 300);
    }

    // Brief pause on "SHARD READY"
    await this._wait(600);
  }

  // ═══════════════════════════════════════════════════════════
  //  Helpers
  // ═══════════════════════════════════════════════════════════

  /**
   * Read all form fields from the DOM.
   */
  _gatherFormData() {
    const el = this.element;
    if (!el) return null;

    const val = (name) => el.querySelector(`[name="${name}"]`)?.value?.trim() ?? '';
    const checked = (name) => el.querySelector(`[name="${name}"]`)?.checked ?? false;

    return {
      itemId: val('itemId'),
      shardName: val('shardName'),
      requiresLogin: checked('requiresLogin'),
      loginPassword: val('loginPassword'),
      encrypted: checked('encrypted'),
      encryptionDC: parseInt(val('encryptionDC')) || 15,
      failureMode: val('failureMode'),
      maxHackAttempts: val('maxHackAttempts'),
      requiresKeyItem: checked('requiresKeyItem'),
      keyItemName: val('keyItemName'),
      entryFrom: val('entryFrom'),
      entrySubject: val('entrySubject'),
      entryBody: el.querySelector('[name="entryBody"]')?.value?.trim() ?? '',
      entryIcon: val('entryIcon'),
      customIcon: val('customIcon'),
    };
  }

  /**
   * Format skill name for display (capitalize words).
   */
  _formatSkillName(name) {
    if (!name) return 'Skill';
    return name.replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  /** @private */
  _wait(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}
