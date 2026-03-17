/**
 * ContactBreachService
 * @file scripts/services/ContactBreachService.js
 * @module cyberpunkred-messenger
 * @description Handles encrypted contact breach attempts. Simplified version
 *   of DataShardService's hack flow, tailored for contacts:
 *     - Skill check via SkillService.performCheck()
 *     - Success → decryptContact() + unscramble animation
 *     - Failure → denied animation + optional lockout
 *     - GM force-decrypt bypass
 *     - Chat card via existing hack-result.hbs template
 *     - EventBus + toast notifications
 *
 *   Registered at priority 83 (after ContactRepository@80, before PortraitService@82).
 */

import { MODULE_ID, EVENTS } from '../utils/constants.js';
import { log, isGM } from '../utils/helpers.js';

export class ContactBreachService {

  // ─── Service Accessors ───

  get eventBus()            { return game.nightcity?.eventBus; }
  get skillService()        { return game.nightcity?.skillService; }
  get contactRepo()         { return game.nightcity?.contactRepository; }
  get notificationService() { return game.nightcity?.notificationService; }
  get soundService()        { return game.nightcity?.soundService; }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API — Breach Attempt
  // ═══════════════════════════════════════════════════════════

  /**
   * Attempt to breach an encrypted contact's ICE.
   * Routes through SkillService for the dice roll, handles success/failure,
   * updates contact data, and fires events.
   *
   * @param {string} actorId     — The actor who owns the contact
   * @param {string} contactId   — The encrypted contact's ID
   * @param {Actor}  actor       — The Foundry actor performing the check
   * @param {object} [options]
   * @param {number} [options.luckSpend=0]  — Luck points to add
   * @param {string} [options.skillOverride] — Use a different skill than contact's encryptionSkill
   * @returns {Promise<ContactBreachResult>}
   *
   * @typedef {object} ContactBreachResult
   * @property {boolean} success
   * @property {object}  [roll]         — SkillCheckResult from SkillService
   * @property {string}  [error]        — Error message if something went wrong
   * @property {string}  contactName    — Name of the contact (for UI feedback)
   */
  async attemptBreach(actorId, contactId, actor, options = {}) {
    // ── Validate prerequisites ──
    if (!actor) return { success: false, error: 'No actor provided' };
    if (!this.skillService) return { success: false, error: 'SkillService not available' };
    if (!this.contactRepo) return { success: false, error: 'ContactRepository not available' };

    // Get the contact
    const contacts = await this.contactRepo.getContacts(actorId);
    const contact = contacts.find(c => c.id === contactId);
    if (!contact) return { success: false, error: 'Contact not found' };
    if (!contact.encrypted) return { success: false, error: 'Contact is not encrypted' };

    const skillName = options.skillOverride || contact.encryptionSkill || 'Interface';
    const dc = contact.encryptionDV || 15;

    log.info(`ContactBreachService: ${actor.name} attempting breach on "${contact.name}" ` +
      `(${skillName} vs DV ${dc})`);

    // ── Perform Skill Check ──
    let rollResult;
    try {
      rollResult = await this.skillService.performCheck(actor, skillName, {
        dc,
        luckSpend: options.luckSpend ?? 0,
        showChat: true,
        context: `Breaching ICE: ${contact.name}`,
        flavor: `CONTACT ICE // DV ${dc}`,
      });
    } catch (err) {
      log.error('ContactBreachService: Skill check failed:', err);
      return { success: false, error: `Skill check error: ${err.message}`, contactName: contact.name };
    }

    // ── Handle Result ──
    if (rollResult.success) {
      return this._handleSuccess(actorId, contactId, contact, actor, rollResult);
    } else {
      return this._handleFailure(actorId, contactId, contact, actor, rollResult);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API — GM Force Decrypt
  // ═══════════════════════════════════════════════════════════

  /**
   * GM bypasses encryption on a contact — no skill check.
   *
   * @param {string} actorId    — The actor who owns the contact
   * @param {string} contactId  — The encrypted contact's ID
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  async forceDecrypt(actorId, contactId) {
    if (!isGM()) return { success: false, error: 'GM only' };
    if (!this.contactRepo) return { success: false, error: 'ContactRepository not available' };

    const contacts = await this.contactRepo.getContacts(actorId);
    const contact = contacts.find(c => c.id === contactId);
    if (!contact) return { success: false, error: 'Contact not found' };
    if (!contact.encrypted) return { success: false, error: 'Contact is not encrypted' };

    log.info(`ContactBreachService: GM force-decrypting "${contact.name}" for actor ${actorId}`);

    const result = await this.contactRepo.decryptContact(actorId, contactId);
    if (!result.success) return result;

    // Sound + notification
    this.soundService?.play('hack-success');
    this.notificationService?.showToast(
      'GM Override',
      `Decrypted contact: ${contact.name}`,
      'success',
      3000
    );

    // Emit for UI refresh
    this.eventBus?.emit(EVENTS.CONTACT_DECRYPTED, {
      actorId,
      contactId,
      contactName: contact.name,
      forced: true,
    });

    return { success: true, contactName: contact.name };
  }

  // ═══════════════════════════════════════════════════════════
  //  PRIVATE — Result Handlers
  // ═══════════════════════════════════════════════════════════

  /**
   * Handle successful breach — decrypt contact, fire events.
   * @private
   */
  async _handleSuccess(actorId, contactId, contact, actor, rollResult) {
    // Decrypt the contact
    const decryptResult = await this.contactRepo.decryptContact(actorId, contactId);
    if (!decryptResult.success) {
      log.error('ContactBreachService: Decrypt failed after successful roll:', decryptResult.error);
      return { success: false, error: 'Decrypt failed', roll: rollResult, contactName: contact.name };
    }

    // Sound
    this.soundService?.play('hack-success');

    // Toast
    this.notificationService?.showToastV2({
      type: 'success',
      title: 'ICE Breached',
      detail: `Contact decrypted: ${contact.name}`,
      icon: 'fas fa-lock-open',
      duration: 4000,
    });

    // Emit for UI refresh + animations
    this.eventBus?.emit(EVENTS.CONTACT_DECRYPTED, {
      actorId,
      contactId,
      contactName: contact.name,
      forced: false,
      roll: {
        success: rollResult.success,
        total: rollResult.total,
        dc: rollResult.dc,
        isCritical: rollResult.isCritical,
      },
    });

    log.info(`ContactBreachService: SUCCESS — ${actor.name} breached "${contact.name}" ` +
      `(${rollResult.total} vs DV ${rollResult.dc}, margin +${rollResult.margin})`);

    return {
      success: true,
      roll: rollResult,
      contactName: contact.name,
    };
  }

  /**
   * Handle failed breach — fire events, play denied animation.
   * BLACK ICE contacts deal damage on failure.
   * @private
   */
  async _handleFailure(actorId, contactId, contact, actor, rollResult) {
    // Sound
    this.soundService?.play('hack-fail');

    // Toast
    this.notificationService?.showToastV2({
      type: 'error',
      title: 'Breach Failed',
      detail: `ICE holds — ${contact.name}`,
      icon: 'fas fa-shield-halved',
      duration: 4000,
    });

    // Emit for UI animations (denied flash, shake)
    this.eventBus?.emit(EVENTS.CONTACT_BREACH_FAILED, {
      actorId,
      contactId,
      contactName: contact.name,
      roll: {
        success: rollResult.success,
        total: rollResult.total,
        dc: rollResult.dc,
        isFumble: rollResult.isFumble,
      },
    });

    // BLACK ICE damage on failure
    let blackIceResult = null;
    if (contact.blackIce) {
      blackIceResult = await this._applyBlackICEDamage(actor, contact);

      this.eventBus?.emit(EVENTS.CONTACT_BLACK_ICE, {
        actorId,
        contactId,
        contactName: contact.name,
        damage: blackIceResult.damage,
        formula: blackIceResult.formula,
      });

      this.notificationService?.showToastV2({
        type: 'danger',
        title: 'BLACK ICE',
        detail: `${blackIceResult.damage} damage dealt to ${actor.name}!`,
        icon: 'fas fa-skull-crossbones',
        duration: 6000,
      });
    }

    log.info(`ContactBreachService: FAILED — ${actor.name} failed breach on "${contact.name}" ` +
      `(${rollResult.total} vs DV ${rollResult.dc}, margin ${rollResult.margin})`);

    return {
      success: false,
      roll: rollResult,
      contactName: contact.name,
      blackIce: blackIceResult,
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  PRIVATE — BLACK ICE Damage
  // ═══════════════════════════════════════════════════════════

  /**
   * Apply BLACK ICE damage to the actor who failed a breach.
   * Mirrors DataShardService._applyBlackICEDamage() pattern.
   * @param {Actor} actor
   * @param {object} contact — must have blackIceDamage formula
   * @returns {Promise<{ damage: number, formula: string }>}
   * @private
   */
  async _applyBlackICEDamage(actor, contact) {
    const formula = contact.blackIceDamage || '3d6';
    try {
      const roll = new Roll(formula);
      await roll.evaluate();
      const damage = roll.total;

      // Apply to actor HP (CPR system paths)
      const currentHP = actor.system?.derivedStats?.hp?.value ?? actor.system?.hp?.value ?? 0;
      const newHP = Math.max(0, currentHP - damage);
      const hpUpdate = actor.system?.derivedStats?.hp
        ? { 'system.derivedStats.hp.value': newHP }
        : { 'system.hp.value': newHP };
      await actor.update(hpUpdate);

      // Chat message
      await roll.toMessage({
        speaker: ChatMessage.getSpeaker({ alias: 'BLACK ICE' }),
        flavor: `<strong style="color:#ff0033">⚡ BLACK ICE RETALIATION</strong><br>${actor.name} takes <strong>${damage}</strong> damage!`,
      });

      this.soundService?.play('black-ice');
      log.info(`BLACK ICE dealt ${damage} damage to ${actor.name} (HP: ${currentHP} → ${newHP})`);
      return { damage, formula };
    } catch (err) {
      log.error(`Failed to apply BLACK ICE damage: ${err.message}`);
      return { damage: 0, formula };
    }
  }
}
