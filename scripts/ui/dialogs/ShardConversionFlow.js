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

import { MODULE_ID, TEMPLATES, SOCKET_OPS, CONTENT_TYPES } from '../../utils/constants.js';
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

// ── Content type definitions (shared with GM composer) ──
const CONTENT_TYPE_PILLS = [
  { id: CONTENT_TYPES.MESSAGE,  icon: 'fas fa-envelope',     label: 'Message' },
  { id: CONTENT_TYPES.EDDIES,   icon: 'fas fa-coins',        label: 'Eddies' },
  { id: CONTENT_TYPES.DOSSIER,  icon: 'fas fa-user-secret',  label: 'Dossier' },
  { id: CONTENT_TYPES.PAYLOAD,  icon: 'fas fa-bug',          label: 'Payload' },
  { id: CONTENT_TYPES.AVLOG,    icon: 'fas fa-microphone',   label: 'AV Log' },
  { id: CONTENT_TYPES.LOCATION, icon: 'fas fa-map-pin',      label: 'Location' },
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
      rollSkill:          function (event, target) { return ShardConversionFlow._onRollSkill.call(this, event, target); },
      selectICEType:      function (event, target) { return ShardConversionFlow._onSelectICEType.call(this, event, target); },
      selectColor:        function (event, target) { return ShardConversionFlow._onSelectColor.call(this, event, target); },
      selectContentType:  function (event, target) { return ShardConversionFlow._onSelectContentType.call(this, event, target); },
      searchKeyItem:      function (event, target) { return ShardConversionFlow._onSearchKeyItem.call(this, event, target); },
      clearKeyItem:       function (event, target) { return ShardConversionFlow._onClearKeyItem.call(this, event, target); },
      cancel:             function (event, target) { return ShardConversionFlow._onCancel.call(this, event, target); },
      createShard:        function (event, target) { return ShardConversionFlow._onCreateShard.call(this, event, target); },
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
    this._selectedContentType = CONTENT_TYPES.MESSAGE;
    this._encoding = false;

    /** @type {{id, name, img}|null} Selected key item from inventory picker */
    this._selectedKeyItem = null;

    /** @type {Object<string, object>} Saved per-type form data across re-renders */
    this._typeFormData = {};

    /** @type {number|null} Saved scroll position to restore across re-renders */
    this._savedScroll = null;

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
    const contentTypes = CONTENT_TYPE_PILLS.map(ct => ({
      ...ct,
      active: ct.id === this._selectedContentType,
    }));

    // ── Per-content-type form state flags ──
    const isMessage  = this._selectedContentType === CONTENT_TYPES.MESSAGE;
    const isEddies   = this._selectedContentType === CONTENT_TYPES.EDDIES;
    const isDossier  = this._selectedContentType === CONTENT_TYPES.DOSSIER;
    const isPayload  = this._selectedContentType === CONTENT_TYPES.PAYLOAD;
    const isAvlog    = this._selectedContentType === CONTENT_TYPES.AVLOG;
    const isLocation = this._selectedContentType === CONTENT_TYPES.LOCATION;

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
      hasEmail: !!entryFrom,
      isMessage, isEddies, isDossier, isPayload, isAvlog, isLocation,
      typeData: this._typeFormData?.[this._selectedContentType] || {},
      actorWealth: this._actor?.system?.wealth?.value ?? 0,

      // Key item
      selectedKeyItem: this._selectedKeyItem,
      actorName: this._actor?.name || 'Unknown',

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
    // ── Scroll preservation across re-renders ──
    const body = this.element?.querySelector('.ncm-convert__body');
    if (body && this._savedScroll != null) {
      body.scrollTop = this._savedScroll;
    }
    if (body) {
      body.addEventListener('scroll', () => {
        this._savedScroll = body.scrollTop;
      });
    }

    // ── Wire security toggle live updates so stages reflect checkbox state ──
    const secInputs = this.element?.querySelectorAll(
      '[name="encrypted"], [name="requiresLogin"], [name="requiresKeyItem"]'
    );
    secInputs?.forEach(inp => {
      inp.addEventListener('change', () => this._refreshSecurityStages());
    });
    this._refreshSecurityStages();
  }

  /**
   * Update the security stages display based on currently-checked boxes.
   * Pure DOM update — no re-render needed.
   */
  _refreshSecurityStages() {
    const el = this.element;
    if (!el) return;
    const stages = el.querySelector('[data-id="security-stages"]');
    if (!stages) return;

    const isChecked = (name) => el.querySelector(`[name="${name}"]`)?.checked ?? false;
    const hasLogin = isChecked('requiresLogin');
    const hasKey = isChecked('requiresKeyItem');
    const hasICE = isChecked('encrypted');

    const items = stages.querySelectorAll('[data-stage]');
    items.forEach(it => {
      const stage = it.dataset.stage;
      let active = false;
      if (stage === 'login') active = hasLogin;
      else if (stage === 'key') active = hasKey;
      else if (stage === 'ice') active = hasICE;
      it.classList.toggle('is-active', active);
    });

    // Empty state
    const empty = stages.querySelector('[data-id="security-empty"]');
    if (empty) {
      const anyActive = hasLogin || hasKey || hasICE;
      empty.style.display = anyActive ? 'none' : '';
    }
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
    if (value === this._selectedContentType) return;

    // Preserve current form data before re-render
    this._typeFormData = this._typeFormData || {};
    const currentData = this._gatherTypeFormData(this._selectedContentType);
    this._typeFormData[this._selectedContentType] = currentData;

    this._selectedContentType = value;
    this.render();
  }

  /**
   * Gather form fields specific to the currently rendered content type.
   * @param {string} type
   * @returns {object}
   */
  _gatherTypeFormData(type) {
    const el = this.element;
    if (!el) return {};
    const v = (name) => el.querySelector(`[name="${name}"]`)?.value ?? '';
    const c = (name) => el.querySelector(`[name="${name}"]`)?.checked ?? false;

    const out = {};
    switch (type) {
      case CONTENT_TYPES.MESSAGE:
        out.entryFrom = v('entryFrom');
        out.entrySubject = v('entrySubject');
        out.entryBody = v('entryBody');
        break;
      case CONTENT_TYPES.EDDIES:
        out.eddiesTitle = v('eddiesTitle');
        out.eddiesAmount = v('eddiesAmount');
        out.eddiesNote = v('eddiesNote');
        break;
      case CONTENT_TYPES.DOSSIER:
        out.dossierTargetName = v('dossierTargetName');
        out.dossierAlias = v('dossierAlias');
        out.dossierThreat = v('dossierThreat');
        out.dossierAffiliation = v('dossierAffiliation');
        out.dossierLastKnown = v('dossierLastKnown');
        out.dossierClassification = v('dossierClassification');
        break;
      case CONTENT_TYPES.PAYLOAD:
        out.payloadName = v('payloadName');
        out.payloadType = v('payloadType');
        out.payloadDescription = v('payloadDescription');
        out.payloadEffectType = v('payloadEffectType');
        out.payloadDuration = v('payloadDuration');
        out.payloadDisguised = c('payloadDisguised');
        break;
      case CONTENT_TYPES.AVLOG:
        out.avlogTitle = v('avlogTitle');
        out.avlogMediaType = v('avlogMediaType');
        out.avlogDuration = v('avlogDuration');
        out.avlogSource = v('avlogSource');
        out.avlogTranscript = v('avlogTranscript');
        break;
      case CONTENT_TYPES.LOCATION:
        out.locationName = v('locationName');
        out.locationCoords = v('locationCoords');
        out.locationDistrict = v('locationDistrict');
        out.locationDescription = v('locationDescription');
        break;
    }
    return out;
  }

  /**
   * Open inventory picker dialog for selecting a key item.
   * Searches the actor's own inventory only (not world items).
   */
  static async _onSearchKeyItem(event, target) {
    const actor = this._actor;
    if (!actor) return;

    const items = (actor.items?.contents ?? []).filter(i => {
      // Exclude shards themselves
      if (i.getFlag(MODULE_ID, 'isDataShard')) return false;
      // Skip skill/role items — they're not real inventory
      if (['skill', 'role', 'cyberdeckProgram'].includes(i.type)) return false;
      return true;
    });

    if (items.length === 0) {
      ui.notifications.warn('NCM | No items in inventory to use as key item.');
      return;
    }

    const itemCards = items.map(item => {
      const img = item.img && !item.img.includes('mystery-man')
        ? `<img src="${item.img}" alt="">`
        : `<i class="fas fa-cube"></i>`;
      const escapedName = item.name.replace(/"/g, '&quot;').replace(/</g, '&lt;');
      return `<div class="ncm-ip-item" data-item-id="${item.id}" data-item-name="${item.name.toLowerCase()}">
        <div class="ncm-ip-item-img">${img}</div>
        <div style="flex:1;min-width:0">
          <div class="ncm-ip-item-name">${escapedName}</div>
          <div class="ncm-ip-item-type">${item.type || 'Item'}</div>
        </div>
      </div>`;
    }).join('');

    const content = `
      <div class="ncm-ip-search-wrap">
        <i class="fas fa-magnifying-glass"></i>
        <input type="text" class="ncm-ip-search" placeholder="Search ${actor.name}'s inventory..." autofocus />
      </div>
      <div class="ncm-ip-list">${itemCards}</div>
    `;

    let selectedItem = null;
    const dialog = new Dialog({
      title: 'Select Key Item from Inventory',
      content,
      buttons: { cancel: { label: 'Cancel', callback: () => {} } },
      default: 'cancel',
      render: (html) => {
        const jq = html instanceof jQuery ? html : $(html);
        const listEl = jq.find('.ncm-ip-list')[0] || jq[0]?.querySelector('.ncm-ip-list');
        const searchEl = jq.find('.ncm-ip-search')[0] || jq[0]?.querySelector('.ncm-ip-search');
        if (searchEl) {
          searchEl.addEventListener('input', () => {
            const query = searchEl.value.toLowerCase().trim();
            const cards = (listEl || jq[0]).querySelectorAll('.ncm-ip-item');
            cards.forEach(card => {
              const name = card.dataset.itemName || '';
              card.style.display = !query || name.includes(query) ? '' : 'none';
            });
          });
        }
        if (listEl) {
          listEl.addEventListener('click', (e) => {
            const card = e.target.closest('.ncm-ip-item');
            if (!card) return;
            selectedItem = actor.items.get(card.dataset.itemId);
            if (selectedItem) dialog.close();
          });
        }
      },
    }, {
      classes: ['dialog', 'ncm-item-picker-dialog'],
      width: 420, height: 480, resizable: true,
    });

    await new Promise(resolve => {
      dialog.close = new Proxy(dialog.close, {
        apply(t, ta, args) {
          const r = Reflect.apply(t, ta, args);
          resolve();
          return r;
        }
      });
      dialog.render(true);
    });

    if (!selectedItem) return;

    this._selectedKeyItem = {
      id: selectedItem.id,
      name: selectedItem.name,
      img: selectedItem.img || '',
    };
    this.render();
  }

  /**
   * Clear the selected key item.
   */
  static _onClearKeyItem(event, target) {
    this._selectedKeyItem = null;
    this.render();
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
    if (!formData) {
      console.warn('NCM | ShardConversionFlow: _gatherFormData returned null');
      return;
    }

    // Validate item selection
    const item = this._item || (formData.itemId ? this._actor?.items?.get(formData.itemId) : null);
    if (!item) {
      ui.notifications.warn('Please select an item to convert.');
      return;
    }

    // ── Pre-conversion validation: Eddies amount vs actor wealth ──
    if (this._selectedContentType === CONTENT_TYPES.EDDIES) {
      const amount = parseInt(formData.typeData?.eddiesAmount) || 0;
      const wealth = this._actor?.system?.wealth?.value ?? 0;
      if (amount <= 0) {
        ui.notifications.warn('Eddies amount must be greater than 0.');
        return;
      }
      if (amount > wealth) {
        ui.notifications.error(`Insufficient funds — you have ${wealth}eb but tried to load ${amount}eb.`);
        return;
      }
    }

    this._encoding = true;

    // Build config first (synchronous, no risk of hang)
    const config = {};
    if (formData.shardName) config.shardName = formData.shardName;
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
        if (formData.requiresKeyItem && this._ceiling?.canKeyItem && this._selectedKeyItem) {
          config.requiresKeyItem = true;
          config.keyItemId = this._selectedKeyItem.id;
          config.keyItemName = this._selectedKeyItem.name;
          config.keyItemImg = this._selectedKeyItem.img;
        }
      }
    }

    // Show overlay immediately with starting state
    this._showEncodingOverlay('INITIALIZING...');

    try {
      // ─── Step 0: Debit eddies from actor wealth (atomic with shard creation) ───
      let eddiesAmount = 0;
      if (this._selectedContentType === CONTENT_TYPES.EDDIES) {
        eddiesAmount = parseInt(formData.typeData?.eddiesAmount) || 0;
        this._setEncodingStatus('TRANSFERRING FUNDS...', 15);
        await this._debitActorWealth(eddiesAmount, item.name);
      }

      // ─── Step 1: Run conversion FIRST (real work) ───
      this._setEncodingStatus('ENCODING DATA...', 25);

      const service = this.dataShardService;
      if (!service) throw new Error('DataShardService not available');

      const runConversion = async () => {
        if (isGM()) {
          return await service.convertToDataShard(item, config);
        } else {
          return await this._requestPlayerConversion(item, config);
        }
      };

      const result = await Promise.race([
        runConversion(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('Conversion timed out after 15s')), 15000)),
      ]);

      if (isGM()) {
        if (!result?.success) throw new Error(result?.error || 'Conversion failed');
      } else {
        if (!result) throw new Error('Conversion request denied or timed out');
      }

      // ─── Step 2: Add initial entry ───
      this._setEncodingStatus('WRITING SHARD METADATA...', 70);
      try {
        await Promise.race([
          this._createInitialEntry(item, formData),
          new Promise((_, rej) => setTimeout(() => rej(new Error('Entry creation timed out')), 5000)),
        ]);
      } catch (err) {
        console.warn('NCM | Conversion: initial entry creation failed (non-fatal)', err);
      }

      // ─── Step 3: Done ───
      this._setEncodingStatus('SHARD READY', 100);
      await this._wait(500);

      ui.notifications.info(`"${item.name}" converted to data shard`);
      this.close();

      setTimeout(() => {
        ui.items?.render();
        for (const sheet of Object.values(ui.windows)) {
          if (sheet.actor?.items?.has(item.id)) sheet.render(false);
        }
      }, 150);

    } catch (err) {
      console.error('NCM | Conversion: FAILED', err);
      ui.notifications.error(`Failed to create shard: ${err.message}`);
      log.error('Shard conversion failed:', err);
    } finally {
      this._encoding = false;
      this._hideEncodingOverlay();
    }
  }

  /**
   * Debit eddies from actor wealth, mirroring DataShardService.claimEddies pattern.
   * @param {number} amount
   * @param {string} reasonItemName
   */
  async _debitActorWealth(amount, reasonItemName) {
    const actor = this._actor;
    if (!actor) throw new Error('No actor for wealth debit');

    if (isGM()) {
      // GM can update directly
      const wealth = foundry.utils.deepClone(actor.system.wealth);
      wealth.value -= amount;
      const transaction = `Decreased by ${amount} to ${wealth.value}`;
      const reason = `NCM: Loaded ${amount.toLocaleString()}eb into "${reasonItemName}" shard`;
      wealth.transactions = wealth.transactions || [];
      wealth.transactions.push([transaction, reason]);
      await actor.update({ 'system.wealth': wealth });
    } else {
      // Player: their actor.update() will go through Foundry's permission system
      // Player owns their character, so this should succeed without GM relay
      const wealth = foundry.utils.deepClone(actor.system.wealth);
      wealth.value -= amount;
      const transaction = `Decreased by ${amount} to ${wealth.value}`;
      const reason = `NCM: Loaded ${amount.toLocaleString()}eb into "${reasonItemName}" shard`;
      wealth.transactions = wealth.transactions || [];
      wealth.transactions.push([transaction, reason]);
      await actor.update({ 'system.wealth': wealth });
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Encoding Overlay Helpers
  // ═══════════════════════════════════════════════════════════

  _showEncodingOverlay(initialText = 'INITIALIZING...') {
    const overlay = this.element?.querySelector('[data-id="encoding-overlay"]');
    if (!overlay) return;
    overlay.classList.add('is-active');
    this._setEncodingStatus(initialText, 5);
  }

  _setEncodingStatus(text, progressPct) {
    const overlay = this.element?.querySelector('[data-id="encoding-overlay"]');
    if (!overlay) return;
    const status = overlay.querySelector('[data-id="encoding-status"]');
    const fill = overlay.querySelector('[data-id="encoding-fill"]');
    if (status) status.textContent = text;
    if (fill && typeof progressPct === 'number') fill.style.width = `${progressPct}%`;
  }

  _hideEncodingOverlay() {
    const overlay = this.element?.querySelector('[data-id="encoding-overlay"]');
    if (overlay) overlay.classList.remove('is-active');
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

    const type = this._selectedContentType;
    const td = formData.typeData || {};
    const entryIcon = formData.customIcon?.trim() || formData.entryIcon || 'fas fa-envelope';
    const timestamp = game.nightcity?.timeService?.getCurrentTime?.() || new Date().toISOString();

    // ── Build subject + body + contentData per type ──
    let subject = 'Untitled';
    let body = '';
    let contentData = null;

    switch (type) {
      case CONTENT_TYPES.MESSAGE: {
        subject = td.entrySubject?.trim() || 'Untitled Message';
        body = td.entryBody?.trim() || '';
        if (!body) {
          log.warn('Message entry has no body — skipping initial entry creation');
          return;
        }
        break;
      }

      case CONTENT_TYPES.EDDIES: {
        subject = td.eddiesTitle?.trim() || 'Eddies Dead Drop';
        const amount = parseInt(td.eddiesAmount) || 0;
        if (amount <= 0) {
          log.warn('Eddies entry amount must be > 0 — skipping initial entry creation');
          return;
        }
        contentData = {
          amount,
          claimed: false,
          claimedBy: null,
          claimedAt: null,
          note: td.eddiesNote || '',
          splitEnabled: false,
        };
        body = td.eddiesNote || '';
        break;
      }

      case CONTENT_TYPES.DOSSIER: {
        subject = td.dossierTargetName?.trim() || 'Unknown Subject';
        contentData = {
          targetName: td.dossierTargetName || 'Unknown',
          targetAlias: td.dossierAlias || '',
          targetImage: null,
          linkedActorId: null,
          classification: td.dossierClassification || '',
          sections: [],
          stats: {
            threat: td.dossierThreat || '',
            affiliation: td.dossierAffiliation || '',
            lastKnownLocation: td.dossierLastKnown || '',
          },
        };
        body = td.dossierClassification || '';
        break;
      }

      case CONTENT_TYPES.PAYLOAD: {
        subject = td.payloadName?.trim() || 'Unknown Program';
        contentData = {
          payloadType: td.payloadType || 'custom',
          name: td.payloadName || 'UNKNOWN.exe',
          description: td.payloadDescription || '',
          effect: {
            type: td.payloadEffectType || 'custom',
            duration: (parseInt(td.payloadDuration) || 24) * 3600000,
          },
          executed: false,
          executedBy: null,
          executedAt: null,
          disguised: !!td.payloadDisguised,
          disguiseType: 'message',
        };
        body = td.payloadDescription || '';
        break;
      }

      case CONTENT_TYPES.AVLOG: {
        subject = td.avlogTitle?.trim() || 'Recording';
        contentData = {
          mediaType: td.avlogMediaType || 'audio',
          duration: td.avlogDuration || '00:00',
          source: td.avlogSource || '',
          transcript: td.avlogTranscript ? [{ speaker: '', text: td.avlogTranscript }] : [],
          corrupted: false,
          corruptionLevel: 0,
        };
        body = td.avlogTranscript || '';
        break;
      }

      case CONTENT_TYPES.LOCATION: {
        subject = td.locationName?.trim() || 'Unknown Location';
        contentData = {
          locationName: td.locationName || 'Unknown',
          locationImage: null,
          coordinates: td.locationCoords || '',
          district: td.locationDistrict || '',
          description: td.locationDescription || '',
          linkedSceneId: null,
          pinX: null,
          pinY: null,
        };
        body = td.locationDescription || '';
        break;
      }
    }

    const flags = {
      [MODULE_ID]: {
        entryType: type,
        from: formData.entryFrom || '', // Always actor's registered email
        subject,
        icon: entryIcon,
        accentColor: this._selectedColor,
        timestamp,
        order: 0,
      },
    };
    if (contentData) flags[MODULE_ID].contentData = contentData;

    try {
      await journal.createEmbeddedDocuments('JournalEntryPage', [{
        name: subject,
        type: 'text',
        text: { content: body },
        flags,
      }]);
    } catch (err) {
      log.warn('Failed to create initial shard entry:', err);
    }
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

    // Merge stashed per-type data with whatever's currently visible in the form
    const currentTypeData = this._gatherTypeFormData(this._selectedContentType);
    const allTypeData = {
      ...(this._typeFormData || {}),
      [this._selectedContentType]: currentTypeData,
    };
    // Flatten into single object (current type wins if there are key collisions)
    const flatTypeData = Object.assign({}, ...Object.values(allTypeData));

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
      entryIcon: val('entryIcon'),
      customIcon: val('customIcon'),
      // Per-type data (combined, current type's values win)
      typeData: flatTypeData,
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
