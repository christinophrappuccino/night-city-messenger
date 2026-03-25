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

      // Build chat message with ICE portrait
      const imgTag = ice.img
        ? `<img src="${ice.img}" alt="${ice.name}" style="width:36px;height:36px;object-fit:contain;border:1px solid #ff0033;border-radius:2px;margin-right:8px;vertical-align:middle;" />`
        : '';
      const classTag = ice.class
        ? `<br><span style="font-size:10px;color:#8888a0;text-transform:uppercase;letter-spacing:0.05em;">${ice.class}</span>`
        : '';

      const contextLabels = {
        shard: 'Data Shard',
        message: 'Message',
        network: 'Network',
      };
      const contextLabel = contextLabels[context] || context;

      await damageRoll.toMessage({
        speaker: ChatMessage.getSpeaker({ alias: ice.name }),
        flavor: `${imgTag}<strong style="color:#ff0033">⚡ ${ice.name} RETALIATION</strong>${classTag}<br>${actor.name} takes <strong>${damage}</strong> damage!${ice.atk ? ` (ATK ${ice.atk} + 1d10)` : ''}<br><span style="font-size:10px;color:#555;">${contextLabel}: ${targetName}</span>`,
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
        diceResults: damageRoll.dice?.[0]?.results?.map(r => r.result) ?? [],
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
      // CPR BLACK ICE actors have type 'blackIce' or specific class
      const isICE = actor.type === 'blackIce'
        || actor.type === 'black-ice'
        || actor.system?.class?.toLowerCase?.()?.includes('ice');
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
