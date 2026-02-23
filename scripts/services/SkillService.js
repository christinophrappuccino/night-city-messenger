/**
 * SkillService
 * @file scripts/services/SkillService.js
 * @module cyberpunkred-messenger
 * @description Single code path for ALL CPR skill checks.
 *              Handles: stat + skill + 1d10, critical (exploding 10),
 *              fumble (subtract on 1), Luck spending.
 *              Reads skill Items from actor, linked stat from actor.system.stats.
 */

import { MODULE_ID, SKILL_MAP } from '../utils/constants.js';
import { log } from '../utils/helpers.js';

export class SkillService {

  // ─── Service References ───

  get eventBus() { return game.nightcity?.eventBus; }
  get soundService() { return game.nightcity?.soundService; }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API — Skill Check
  // ═══════════════════════════════════════════════════════════

  /**
   * Perform a CPR skill check: stat + skill level + 1d10
   * Handles critical hits (exploding 10) and fumbles (subtract on 1).
   *
   * @param {Actor} actor - The actor performing the check
   * @param {string} skillName - Name of the skill (must match an Item on the actor)
   * @param {object} [options]
   * @param {number} [options.dc] - Difficulty Value to check against
   * @param {number} [options.luckSpend=0] - Luck points to add to the roll
   * @param {boolean} [options.showChat=true] - Whether to post the roll to chat
   * @param {string} [options.flavor] - Custom flavor text for the chat message
   * @param {string} [options.context] - Context label (e.g., "Hacking: Arasaka Shard")
   * @returns {Promise<SkillCheckResult>}
   *
   * @typedef {object} SkillCheckResult
   * @property {boolean} success - Whether the total meets or exceeds the DC
   * @property {number} total - Final total (stat + skill + roll + luck)
   * @property {number} rollValue - Raw d10 result (before crit/fumble processing)
   * @property {number} processedRoll - Roll after crit explosion or fumble subtraction
   * @property {number} statValue - The linked stat value
   * @property {string} statName - The linked stat name
   * @property {number} skillLevel - The skill level from the actor's skill item
   * @property {number} luckSpent - Luck points actually spent
   * @property {boolean} isCritical - Natural 10 (exploding)
   * @property {boolean} isFumble - Natural 1 (subtractive)
   * @property {number} dc - The DC checked against
   * @property {number} margin - total - dc
   * @property {Roll} roll - The Foundry Roll object
   */
  async performCheck(actor, skillName, options = {}) {
    if (!actor) throw new Error('SkillService.performCheck: actor is required');
    if (!skillName) throw new Error('SkillService.performCheck: skillName is required');

    const dc = options.dc ?? 0;
    const luckSpend = options.luckSpend ?? 0;
    const showChat = options.showChat !== false;
    const flavor = options.flavor ?? '';
    const context = options.context ?? '';

    // ─── Read Skill from Actor ───
    const { skillLevel, statName, statValue } = this._readSkillData(actor, skillName);

    // ─── Validate Luck ───
    const availableLuck = this._getAvailableLuck(actor);
    const actualLuckSpend = Math.min(Math.max(0, luckSpend), availableLuck);

    // ─── Roll 1d10 with Crit/Fumble ───
    const rollResult = await this._rollD10WithCritFumble();

    // ─── Calculate Total ───
    const total = statValue + skillLevel + rollResult.processedRoll + actualLuckSpend;
    const success = total >= dc;
    const margin = total - dc;

    // ─── Spend Luck (if any) ───
    if (actualLuckSpend > 0) {
      await this._spendLuck(actor, actualLuckSpend);
    }

    const result = {
      success,
      total,
      rollValue: rollResult.rawValue,
      processedRoll: rollResult.processedRoll,
      statValue,
      statName,
      skillLevel,
      luckSpent: actualLuckSpend,
      isCritical: rollResult.isCritical,
      isFumble: rollResult.isFumble,
      dc,
      margin,
      roll: rollResult.roll,
    };

    // ─── Post to Chat ───
    if (showChat) {
      await this._postChatMessage(actor, skillName, result, { flavor, context });
    }

    log.debug(`SkillCheck: ${actor.name} / ${skillName} — ` +
      `Stat(${statName}):${statValue} + Skill:${skillLevel} + Roll:${rollResult.processedRoll}` +
      `${actualLuckSpend > 0 ? ` + Luck:${actualLuckSpend}` : ''} = ${total} vs DC ${dc} → ${success ? 'SUCCESS' : 'FAIL'}`);

    return result;
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API — Luck Queries
  // ═══════════════════════════════════════════════════════════

  /**
   * @param {Actor} actor
   * @returns {number}
   */
  getAvailableLuck(actor) {
    return this._getAvailableLuck(actor);
  }

  /**
   * @param {Actor} actor
   * @returns {number}
   */
  getMaxLuck(actor) {
    try {
      return actor.system?.stats?.luck?.max ?? actor.system?.stats?.luck?.value ?? 0;
    } catch { return 0; }
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API — Skill Queries
  // ═══════════════════════════════════════════════════════════

  /**
   * Read skill data without rolling.
   * @param {Actor} actor
   * @param {string} skillName
   * @returns {{ skillLevel: number, statName: string, statValue: number, found: boolean }}
   */
  getSkillData(actor, skillName) {
    const data = this._readSkillData(actor, skillName);
    return { skillLevel: data.skillLevel, statName: data.statName, statValue: data.statValue, found: data._found };
  }

  /**
   * Get all skills on actor matching an allowed list.
   * @param {Actor} actor
   * @param {string[]} allowedSkills
   * @returns {{ name: string, level: number, stat: string, statValue: number, total: number }[]}
   */
  getAvailableSkills(actor, allowedSkills = []) {
    if (!actor) return [];
    return allowedSkills.map(skillName => {
      const { skillLevel, statName, statValue } = this._readSkillData(actor, skillName);
      return { name: skillName, level: skillLevel, stat: statName, statValue, total: statValue + skillLevel };
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  PRIVATE — Skill Resolution
  // ═══════════════════════════════════════════════════════════

  /**
   * @private
   */
  _readSkillData(actor, skillName) {
    let skillLevel = 0;
    let statName = 'tech';
    let statValue = 0;
    let _found = false;

    try {
      // CPR system: skills are items with type 'skill'
      const skillItem = actor.items?.find(i =>
        i.type === 'skill' && i.name.toLowerCase().trim() === skillName.toLowerCase().trim()
      );

      if (skillItem) {
        _found = true;
        skillLevel = skillItem.system?.level ?? skillItem.system?.value ?? 0;
        const linkedStat = skillItem.system?.stat;
        if (linkedStat) statName = linkedStat.toLowerCase();
      }

      // Fallback: SKILL_MAP for stat linkage
      if (!_found) {
        const mapEntry = SKILL_MAP[skillName];
        if (mapEntry) statName = mapEntry.stat;
      }

      // Read stat value
      if (statName && actor.system?.stats) {
        const stat = actor.system.stats[statName];
        statValue = stat?.value ?? stat ?? 0;
      }
    } catch (err) {
      log.debug(`SkillService._readSkillData: "${skillName}" on ${actor.name}: ${err.message}`);
    }

    return { skillLevel, statName, statValue, _found };
  }

  // ═══════════════════════════════════════════════════════════
  //  PRIVATE — Dice Rolling
  // ═══════════════════════════════════════════════════════════

  /**
   * Roll 1d10 with CPR crit/fumble rules:
   * - Natural 10: exploding (roll again, add; keep rolling on 10)
   * - Natural 1: roll again and subtract
   * @private
   */
  async _rollD10WithCritFumble() {
    const roll = new Roll('1d10');
    await roll.evaluate();
    const rawValue = roll.total;

    let processedRoll = rawValue;
    let isCritical = false;
    let isFumble = false;

    if (rawValue === 10) {
      isCritical = true;
      let explosion = rawValue;
      let nextRoll = 10;
      // Exploding 10s — keep rolling while we get 10
      while (nextRoll === 10) {
        const bonus = new Roll('1d10');
        await bonus.evaluate();
        nextRoll = bonus.total;
        explosion += nextRoll;
      }
      processedRoll = explosion;
    } else if (rawValue === 1) {
      isFumble = true;
      const penalty = new Roll('1d10');
      await penalty.evaluate();
      processedRoll = rawValue - penalty.total;
    }

    return { rawValue, processedRoll, isCritical, isFumble, roll };
  }

  // ═══════════════════════════════════════════════════════════
  //  PRIVATE — Luck
  // ═══════════════════════════════════════════════════════════

  /** @private */
  _getAvailableLuck(actor) {
    try {
      return actor.system?.stats?.luck?.value ?? 0;
    } catch { return 0; }
  }

  /** @private */
  async _spendLuck(actor, amount) {
    if (amount <= 0) return;
    try {
      const current = this._getAvailableLuck(actor);
      const newValue = Math.max(0, current - amount);
      await actor.update({ 'system.stats.luck.value': newValue });
      log.debug(`SkillService: ${actor.name} spent ${amount} Luck (${current} → ${newValue})`);
    } catch (err) {
      log.warn(`SkillService: Failed to spend Luck for ${actor.name}: ${err.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  PRIVATE — Chat Output
  // ═══════════════════════════════════════════════════════════

  /** @private */
  async _postChatMessage(actor, skillName, result, meta = {}) {
    try {
      const templateData = {
        actorName: actor.name,
        actorImg: actor.img,
        skillName,
        statName: result.statName?.toUpperCase() ?? 'STAT',
        statValue: result.statValue,
        skillLevel: result.skillLevel,
        rollValue: result.rollValue,
        processedRoll: result.processedRoll,
        luckSpent: result.luckSpent,
        total: result.total,
        dc: result.dc,
        success: result.success,
        isCritical: result.isCritical,
        isFumble: result.isFumble,
        margin: result.margin,
        context: meta.context || '',
        flavor: meta.flavor || '',
      };

      const content = await renderTemplate(
        `modules/${MODULE_ID}/templates/chat/hack-result.hbs`,
        templateData
      );

      await ChatMessage.create({
        content,
        speaker: ChatMessage.getSpeaker({ actor }),
        flags: {
          [MODULE_ID]: {
            type: 'skill-check',
            skillName,
            result: {
              success: result.success,
              total: result.total,
              dc: result.dc,
              isCritical: result.isCritical,
              isFumble: result.isFumble,
            },
          },
        },
      });
    } catch (err) {
      log.warn(`SkillService: Failed to post chat message: ${err.message}`);
    }
  }
}
