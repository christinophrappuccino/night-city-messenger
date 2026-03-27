/**
 * ICEService — Shared BLACK ICE Resolution & Damage
 * @file scripts/services/ICEService.js
 * @module cyberpunkred-messenger
 * @description Unified service for resolving ICE configurations and applying
 *              BLACK ICE damage. Used by DataShardService, MessageService,
 *              and NetworkAuthDialog.
 *
 *              Three ICE source modes:
 *                - 'default': Generic dice by type (3d6 BLACK_ICE, 5d6 RED_ICE)
 *                - 'actor':   Links a BLACK ICE actor, pulls ATK stat + portrait
 *                - 'custom':  GM-defined name + damage formula
 *
 *              Each consumer keeps its own animation (shard terminal, message
 *              cipher matrix, network auth dialog). This service only handles
 *              the data layer: resolve ICE → roll damage → apply HP → post chat.
 *
 *              Depends on: SoundService (optional), EventBus (optional)
 *              Initialization priority: ready/42
 */

import { MODULE_ID, EVENTS, ENCRYPTION_TYPES } from '../utils/constants.js';
import { log } from '../utils/helpers.js';

export class ICEService {

  constructor() {
    this._initialized = true;
    log.info('ICEService initialized');
  }

  // ─── Service Accessors ───

  get soundService() { return game.nightcity?.soundService; }
  get eventBus() { return game.nightcity?.eventBus; }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API — ICE Resolution
  // ═══════════════════════════════════════════════════════════

  /**
   * Resolve an ICE configuration to concrete combat data.
   * Works for shard configs, message encryption, and network security.
   *
   * Accepts either format:
   *   Shard/Network: { encryptionType: 'BLACK_ICE', ice: { source, actorId, ... } }
   *   Message:       { type: 'BLACK_ICE', dc: 18, ice: { source, actorId, ... } }
   *
   * @param {object} config
   * @returns {ICEInfo}
   *
   * @typedef {object} ICEInfo
   * @property {string} name — Display name
   * @property {string|null} img — Portrait URL
   * @property {string} formula — Damage formula
   * @property {number|null} atk — ATK stat (actor source only)
   * @property {string|null} class — ICE class from actor
   * @property {string|null} actorId — Linked actor ID
   * @property {string} encryptionType — 'BLACK_ICE' or 'RED_ICE'
   */
  resolveICE(config) {
    const encType = config?.encryptionType || config?.type || 'BLACK_ICE';
    const iceConfig = config?.ice ?? {};
    const source = iceConfig.source ?? 'default';

    // ─── Actor source: pull stats from linked Black ICE actor ───
    if (source === 'actor' && iceConfig.actorId) {
      const iceActor = game.actors?.get(iceConfig.actorId);
      if (iceActor) {
        const atk = iceActor.system?.stats?.atk ?? 0;
        return {
          name: iceActor.name || 'BLACK ICE',
          img: iceActor.img || null,
          formula: `${atk} + 1d10`,
          atk,
          class: iceActor.system?.class || null,
          actorId: iceActor.id,
          encryptionType: encType,
        };
      }
      log.warn(`ICE actor "${iceConfig.actorId}" not found, falling back to default`);
    }

    // ─── Custom source: GM-defined name + formula ───
    if (source === 'custom' && iceConfig.customDamage) {
      return {
        name: iceConfig.customName || (encType === ENCRYPTION_TYPES.RED_ICE ? 'RED ICE' : 'BLACK ICE'),
        img: iceConfig.customPortrait || null,
        formula: iceConfig.customDamage,
        atk: null,
        class: null,
        actorId: null,
        encryptionType: encType,
      };
    }

    // ─── Default source: generic dice by type ───
    const isRed = encType === ENCRYPTION_TYPES.RED_ICE;
    return {
      name: isRed ? 'RED ICE' : 'BLACK ICE',
      img: null,
      formula: isRed ? '5d6' : '3d6',
      atk: null,
      class: null,
      actorId: null,
      encryptionType: encType,
    };
  }

  /**
   * Check if an encryption config represents lethal ICE.
   * @param {object} config — Encryption config (any format)
   * @returns {boolean}
   */
  isLethalICE(config) {
    const encType = config?.encryptionType || config?.type || '';
    return encType === ENCRYPTION_TYPES.BLACK_ICE || encType === ENCRYPTION_TYPES.RED_ICE;
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API — Damage Application
  // ═══════════════════════════════════════════════════════════

  /**
   * Apply BLACK ICE damage to an actor.
   * Rolls the damage formula, reduces actor HP, posts a chat card.
   *
   * @param {Actor} actor — The actor taking damage
   * @param {object} encryptionConfig — Config with encryptionType and optional ice sub-object
   * @param {object} [opts]
   * @param {string} [opts.context='shard'] — Source context ('shard' | 'message' | 'network')
   * @param {string} [opts.targetName] — Name of the thing being hacked (shard name, message subject, network name)
   * @returns {Promise<ICEDamageResult>}
   *
   * @typedef {object} ICEDamageResult
   * @property {number} damage — Total damage dealt
   * @property {string} formula — The formula that was rolled
   * @property {number[]} diceResults — Individual die results
   * @property {ICEInfo} iceInfo — Resolved ICE data
   * @property {Roll} roll — The Foundry Roll object
   */
  async applyDamage(actor, encryptionConfig, opts = {}) {
    const ice = this.resolveICE(encryptionConfig);
    const context = opts.context || 'shard';
    const targetName = opts.targetName || 'Unknown';

    try {
      const damageRoll = new Roll(ice.formula);
      await damageRoll.evaluate();
      const damage = damageRoll.total;

      // Apply damage to actor HP (try both CPR HP paths)
      const currentHP = actor.system?.derivedStats?.hp?.value ?? actor.system?.hp?.value ?? 0;
      const newHP = Math.max(0, currentHP - damage);
      const hpUpdate = actor.system?.derivedStats?.hp
        ? { 'system.derivedStats.hp.value': newHP }
        : { 'system.hp.value': newHP };
      await actor.update(hpUpdate);

      // Build chat card via template
      const contextLabels = { shard: 'Data Shard', message: 'Message', network: 'Network' };
      const contextLabel = contextLabels[context] || context;
      const contextIcons = { shard: 'fa-hard-drive', message: 'fa-envelope', network: 'fa-network-wired' };

      // Map d6 results to FA dice-face icons (1–6)
      const diceFaceMap = ['', 'fa-dice-one', 'fa-dice-two', 'fa-dice-three', 'fa-dice-four', 'fa-dice-five', 'fa-dice-six'];
      const diceResults = damageRoll.dice?.flatMap(d => d.results?.map(r => r.result) ?? []) ?? [];
      const diceIcons = diceResults.map(v => diceFaceMap[Math.min(v, 6)] || 'fa-dice');

      // Build ICE class display string
      let iceClassDisplay = ice.encryptionType?.replace('_', ' ') || 'BLACK ICE';
      if (ice.atk != null) iceClassDisplay += ` · ATK ${ice.atk}`;
      if (ice.class) iceClassDisplay += ` · ${ice.class}`;

      const templateData = {
        iceName: ice.name,
        iceImg: ice.img || null,
        iceClassDisplay,
        actorName: actor.name,
        damage,
        formulaDisplay: ice.atk != null
          ? `ATK ${ice.atk} + 1d10 → ${ice.formula}`
          : `${ice.formula}`,
        hpDisplay: `HP: ${currentHP} → ${newHP}`,
        diceIcons: diceIcons.length ? diceIcons : null,
        contextLabel,
        contextIcon: contextIcons[context] || 'fa-hard-drive',
        networkDisplay: game.nightcity?.networkService?.getCurrentNetworkName?.() || 'CITINET',
      };

      const content = await renderTemplate(
        `modules/${MODULE_ID}/templates/chat/ice-retaliation.hbs`,
        templateData
      );

      await ChatMessage.create({
        content,
        speaker: ChatMessage.getSpeaker({ alias: ice.name }),
      });

      this.soundService?.play('black-ice');

      // Emit event for UI layers to react
      this.eventBus?.emit(EVENTS.BLACK_ICE_DAMAGE, {
        actorId: actor.id,
        damage,
        iceInfo: ice,
        context,
        targetName,
      });

      log.info(`${ice.name} dealt ${damage} damage to ${actor.name} (HP: ${currentHP} → ${newHP}) [${context}: ${targetName}]`);

      return {
        damage,
        formula: ice.formula,
        diceResults,
        iceInfo: ice,
        roll: damageRoll,
      };
    } catch (err) {
      log.error(`Failed to apply BLACK ICE damage: ${err.message}`);
      return { damage: 0, formula: ice.formula, diceResults: [], iceInfo: ice, roll: null };
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API — Actor Browsing
  // ═══════════════════════════════════════════════════════════

  /**
   * Get all BLACK ICE actors available in the world.
   * Useful for ICE source picker dropdowns in editors.
   * @returns {Array<{id: string, name: string, img: string, atk: number, class: string|null}>}
   */
  getAvailableICEActors() {
    const actors = [];
    for (const actor of game.actors) {
      const isICE = actor.type === 'blackIce'
        || actor.type === 'black-ice'
        || actor.getFlag?.('cyberpunkred-messenger', 'isBlackICE')
        || actor.name?.toLowerCase().includes('black ice');
      if (isICE) {
        actors.push({
          id: actor.id,
          name: actor.name,
          img: actor.img,
          atk: actor.system?.stats?.atk ?? 0,
          class: actor.system?.class || null,
        });
      }
    }
    return actors.sort((a, b) => a.name.localeCompare(b.name));
  }
}
