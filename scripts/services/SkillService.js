/**
 * SkillService
 * @file scripts/services/SkillService.js
 * @module night-city-messenger
 * @description Single code path for ALL CPR skill checks.
 *              Handles: stat + skill + 1d10, critical (exploding 10),
 *              fumble (subtract on 1), Luck spending.
 *              Reads skill Items from actor, linked stat from actor.system.stats.
 */

import { MODULE_ID, SKILL_MAP } from '../utils/constants.js';
import { log, chatCardTime } from '../utils/helpers.js';
import { playRollReveal } from '../ui/content/RollReveal.js';

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
    // TIMING (2026-10-27): the chat card must not land before the player has
    // SEEN the result. `reveal` plays the shared Roll Reveal in that window and
    // posts at its verdict; `deferChat` hands back `result.postChat()` for a
    // caller with its own animation to fire at ITS climax. Neither → post now.
    const reveal = options.reveal || null;
    const deferChat = !!options.deferChat;
    const flavor = options.flavor ?? '';
    const context = options.context ?? '';
    // Flat situational bonus/penalty (e.g. a premium blank's "+1 craft roll" perk).
    const modifier = Number(options.modifier) || 0;

    // ─── Read Skill from Actor ───
    const { skillLevel, statName, statValue } = this._readSkillData(actor, skillName);

    // ─── Validate Luck ───
    const availableLuck = this._getAvailableLuck(actor);
    const actualLuckSpend = Math.min(Math.max(0, luckSpend), availableLuck);

    // ─── Roll 1d10 with Crit/Fumble ───
    const rollResult = await this._rollD10WithCritFumble();

    // Dice So Nice: the 3D dice play BEFORE anything reveals the number, and
    // every caller waits for them (this method does not return until they land).
    if (options.dice3d !== false) await this._showDice3d(rollResult.rolls);

    // ─── Calculate Total ───
    const total = statValue + skillLevel + rollResult.processedRoll + actualLuckSpend + modifier;
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
      modifier,
      isCritical: rollResult.isCritical,
      isFumble: rollResult.isFumble,
      dc,
      margin,
      roll: rollResult.roll,
    };

    // ─── Post to Chat — now, at the reveal's verdict, or when the caller says ───
    let posted = null;
    result.postChat = () => {
      if (!showChat) return Promise.resolve();
      if (!posted) posted = this._postChatMessage(actor, skillName, result, { flavor, context });
      return posted;
    };
    if (reveal) {
      await playRollReveal({
        host: reveal.host, result, skillName,
        title: reveal.title || context || `${skillName} check`,
        ctx: reveal.ctx || flavor || '', who: reveal.who ?? actor.name,
        ok: reveal.ok, no: reveal.no, sound: reveal.sound, verdictSound: reveal.verdictSound, hideDV: !!reveal.hideDV,
        onChat: () => result.postChat(),
      });
      await result.postChat();
    } else if (!deferChat) {
      await result.postChat();
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
   * Is a Role Ability (Interface and kin) rolled as rank + d10, with no stat?
   * World setting `roleAbilityRoll` — 'rank' (rulebook) or 'stat' (default).
   * @returns {boolean}
   */
  static roleAbilityRankOnly() {
    try { return game.settings.get(MODULE_ID, 'roleAbilityRoll') === 'rank'; } catch { return false; }
  }

  /**
   * @private
   */
  _readSkillData(actor, skillName) {
    let skillLevel = 0;
    let statName = 'tech';
    let statValue = 0;
    let statFromItem = false;
    let _found = false;
    let isRoleAbility = false;

    const wanted = this._normSkill(skillName);

    try {
      // CPR system: skills are items with type 'skill'. Match space/punctuation
      // -insensitive so config names like "Electronics/SecurityTech" resolve to
      // the actor's "Electronics/Security Tech" item.
      const skillItem = actor.items?.find(i =>
        i.type === 'skill' && this._normSkill(i.name) === wanted
      );

      if (skillItem) {
        _found = true;
        skillLevel = skillItem.system?.level ?? skillItem.system?.value ?? 0;
        const linkedStat = skillItem.system?.stat;
        if (linkedStat) { statName = String(linkedStat).toLowerCase(); statFromItem = true; }
      }

      // Role abilities (e.g. Interface from the Netrunner role) are NOT skill
      // items — resolve their rank from the actor's role item(s). Also when a
      // same-named SKILL item exists at level 0: some sheets carry an empty
      // "Interface" skill, which used to hide the role's real rank.
      if (!_found || !(Number(skillLevel) > 0)) {
        const role = this._readRoleAbility(actor, skillName);
        if (role.found && (!_found || Number(role.rank) > Number(skillLevel))) {
          _found = true;
          isRoleAbility = true;
          skillLevel = role.rank;
          statFromItem = false;
        }
      }

      // Fallback: SKILL_MAP for stat linkage when the source didn't supply one
      // (covers role abilities and skills whose item lacks a linked stat).
      if (!statFromItem) {
        const mapEntry = SKILL_MAP[skillName] ?? SKILL_MAP[(skillName ?? '').trim()];
        if (mapEntry?.stat) statName = mapEntry.stat;
      }

      // Read stat value
      if (statName && actor.system?.stats) {
        const stat = actor.system.stats[statName];
        statValue = stat?.value ?? stat ?? 0;
      }

      // World setting `roleAbilityRoll`: 'rank' = the rulebook's Role Ability
      // check (Interface = rank + d10, no stat). The default 'stat' keeps the
      // module's long-standing TECH + rank + d10.
      if (isRoleAbility && SkillService.roleAbilityRankOnly()) {
        statName = 'none';
        statValue = 0;
      }
    } catch (err) {
      log.debug(`SkillService._readSkillData: "${skillName}" on ${actor.name}: ${err.message}`);
    }

    return { skillLevel, statName, statValue, _found };
  }

  /**
   * Normalize a skill/ability name for matching — case + space/punctuation
   * insensitive, so "Electronics/SecurityTech" === "Electronics/Security Tech".
   * @private
   */
  _normSkill(s) {
    return String(s || '').toLowerCase().replace(/[\s_/\\&.-]+/g, '');
  }

  /**
   * Resolve a role-granted ability rank (e.g. Interface from the Netrunner
   * role) — these live on the actor's 'role' item, not as 'skill' items.
   * Tries the main role ability, sub-abilities, the role's own name, then a
   * small ability→role fallback. Robust across CPR data-model variants.
   * @private
   * @returns {{ rank: number, found: boolean }}
   */
  _readRoleAbility(actor, abilityName) {
    const target = this._normSkill(abilityName);
    const roles = (actor.items ?? []).filter(i => i.type === 'role');

    for (const role of roles) {
      const sys = role.system ?? {};

      // CPR's role data model stores the main ability as a plain STRING (mainRoleAbility: "Interface") with the rank
      // in system.rank; older data used an object { name, rank }. Read both — the string form never matched before,
      // so Interface was only found when the role item happened to be named "Netrunner".
      const main = sys.mainRoleAbility;
      const mainName = typeof main === 'string' ? main : main?.name;
      if (mainName && this._normSkill(mainName) === target) {
        const r = (main && typeof main === 'object') ? (main.rank ?? sys.rank ?? sys.value) : (sys.rank ?? sys.value);
        return { rank: Number(r) || 0, found: true };
      }

      const subs = sys.subRoleAbilities ?? sys.abilities ?? sys.roleskills ?? [];
      if (Array.isArray(subs)) {
        const hit = subs.find(a => this._normSkill(a?.name) === target);
        if (hit) return { rank: hit.rank ?? hit.value ?? 0, found: true };
      }

      if (this._normSkill(role.name) === target) {
        return { rank: sys.rank ?? sys.value ?? 0, found: true };
      }
    }

    // Ability lives on a known role (Interface → Netrunner's main ability)
    const ROLE_FOR_ABILITY = { interface: 'netrunner' };
    const roleSlug = ROLE_FOR_ABILITY[target];
    if (roleSlug) {
      const role = roles.find(r => this._normSkill(r.name) === roleSlug);
      if (role) {
        const sys = role.system ?? {};
        return { rank: sys.mainRoleAbility?.rank ?? sys.rank ?? sys.value ?? 0, found: true };
      }
    }

    return { rank: 0, found: false };
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
  /**
   * Play the 3D dice and wait for them to land, when Dice So Nice is active.
   * Synchronized so the table sees the same throw. Capped, so a stuck or
   * misconfigured DSN can never hang a login.
   * @param {Roll[]} rolls
   */
  async _showDice3d(rolls = []) {
    const d3 = game.dice3d;
    if (!d3?.showForRoll || !rolls.length) return;
    const cap = (ms) => new Promise((res) => setTimeout(res, ms));
    try {
      for (const r of rolls) {
        await Promise.race([d3.showForRoll(r, game.user, true), cap(12000)]);
      }
    } catch (err) {
      log.debug(`SkillService: Dice So Nice failed: ${err.message}`);
    }
  }

  async _rollD10WithCritFumble() {
    const roll = new Roll('1d10');
    await roll.evaluate();
    const rawValue = roll.total;
    const rolls = [roll];

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
        rolls.push(bonus);
        nextRoll = bonus.total;
        explosion += nextRoll;
      }
      processedRoll = explosion;
    } else if (rawValue === 1) {
      isFumble = true;
      const penalty = new Roll('1d10');
      await penalty.evaluate();
      rolls.push(penalty);
      processedRoll = rawValue - penalty.total;
    }

    return { rawValue, processedRoll, isCritical, isFumble, roll, rolls };
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
      // Map stat names to FontAwesome icons
      const statIcons = {
        INT: 'fa-brain', TECH: 'fa-wrench', REF: 'fa-crosshairs',
        DEX: 'fa-person-running', COOL: 'fa-snowflake', WILL: 'fa-hand-fist',
        LUCK: 'fa-clover', MOVE: 'fa-person-walking', BODY: 'fa-dumbbell', EMP: 'fa-heart',
      };
      const statKey = (result.statName || 'INT').toUpperCase();

      const templateData = {
        actorName: actor.name,
        actorImg: actor.img,
        skillName,
        statName: statKey,
        statIcon: statIcons[statKey] || 'fa-microchip',
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
        marginAbs: Math.abs(Number(result.margin) || 0),
        rollChanged: result.processedRoll != null && result.processedRoll !== result.rollValue,
        context: meta.context || '',
        flavor: meta.flavor || '',
        contextLine: [meta.context, meta.flavor].filter(Boolean).join(', '),
        when: chatCardTime(),
        networkDisplay: game.nightcity?.networkService?.getCurrentNetworkName?.() || 'CITINET',
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
