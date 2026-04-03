/**
 * EmailService — Email Identity Management
 * @file scripts/services/EmailService.js
 * @module cyberpunkred-messenger
 * @description Manages actor email identities: registration, validation,
 *              burn/re-register, domain suggestions, and history.
 *              One email per actor. Burned emails show as [BURNED] in messages.
 */

import { MODULE_ID } from '../utils/constants.js';
import { log } from '../utils/helpers.js';

export class EmailService {
  /**
   * @param {Object} options
   * @param {Object} options.networkService - NetworkService instance for domain suggestions
   */
  constructor({ networkService } = {}) {
    this.networkService = networkService;
    log.info('EmailService initialized');
  }

  // ═══════════════════════════════════════════════════════════
  //  READ
  // ═══════════════════════════════════════════════════════════

  /**
   * Get the current email for an actor.
   * @param {Actor} actor
   * @returns {string|null}
   */
  getEmail(actor) {
    return actor?.getFlag(MODULE_ID, 'email') ?? null;
  }

  /**
   * Get the full email data for an actor.
   * @param {Actor} actor
   * @returns {{ email: string, handle: string, domain: string, setupComplete: boolean, history: Array }|null}
   */
  getEmailData(actor) {
    if (!actor) return null;
    return {
      email: actor.getFlag(MODULE_ID, 'email') ?? null,
      handle: actor.getFlag(MODULE_ID, 'emailHandle') ?? null,
      domain: actor.getFlag(MODULE_ID, 'emailDomain') ?? null,
      setupComplete: actor.getFlag(MODULE_ID, 'emailSetupComplete') ?? false,
      history: actor.getFlag(MODULE_ID, 'emailHistory') ?? [],
    };
  }

  /**
   * Check if an actor has completed email setup.
   * @param {Actor} actor
   * @returns {boolean}
   */
  hasEmail(actor) {
    return !!(actor?.getFlag(MODULE_ID, 'emailSetupComplete'));
  }

  /**
   * Check if an email is required before using NCM.
   * @returns {boolean}
   */
  isSetupRequired() {
    try {
      return game.settings.get(MODULE_ID, 'emailSetupRequired') ?? true;
    } catch { return true; }
  }

  /**
   * Check if players can burn their own identity.
   * @returns {boolean}
   */
  canPlayerBurn() {
    try {
      return game.settings.get(MODULE_ID, 'emailAllowPlayerBurn') ?? true;
    } catch { return true; }
  }

  /**
   * Check if custom domains are allowed.
   * @returns {boolean}
   */
  allowCustomDomains() {
    try {
      return game.settings.get(MODULE_ID, 'emailAllowCustomDomains') ?? true;
    } catch { return true; }
  }

  // ═══════════════════════════════════════════════════════════
  //  DOMAIN SUGGESTIONS
  // ═══════════════════════════════════════════════════════════

  /**
   * Get available domain suggestions from configured list.
   * @returns {Array<{ domain: string, networkName: string, networkId: string, icon: string, color: string, locked: boolean }>}
   */
  getAvailableDomains() {
    const domains = [];

    try {
      const raw = game.settings.get(MODULE_ID, 'emailDomains');
      const domainList = Array.isArray(raw) ? raw : [];

      // Default domain always first
      const fallback = this._getDefaultDomain();
      domains.push({
        domain: fallback,
        networkName: 'Default',
        networkId: '',
        icon: 'fa-at',
        color: '#00D4E6',
        locked: false,
      });

      // Additional configured domains
      for (const d of domainList) {
        if (!d || d === fallback) continue;
        domains.push({
          domain: d,
          networkName: '',
          networkId: '',
          icon: 'fa-at',
          color: '#00D4E6',
          locked: false,
        });
      }
    } catch (e) {
      log.warn('EmailService: Failed to load domain config', e);
    }

    // If nothing at all, add fallback
    if (domains.length === 0) {
      const fallback = this._getDefaultDomain();
      domains.push({
        domain: fallback,
        networkName: 'Default',
        networkId: '',
        icon: 'fa-at',
        color: '#00D4E6',
        locked: false,
      });
    }

    return domains;
  }

  /**
   * Get the default fallback domain.
   * @returns {string}
   */
  _getDefaultDomain() {
    try {
      return game.settings.get(MODULE_ID, 'emailDefaultDomain') || 'nightcity.net';
    } catch { return 'nightcity.net'; }
  }

  // ═══════════════════════════════════════════════════════════
  //  HANDLE SUGGESTIONS
  // ═══════════════════════════════════════════════════════════

  /**
   * Generate handle suggestions from an actor's name.
   * @param {Actor} actor
   * @returns {string[]}
   */
  generateHandleSuggestions(actor) {
    if (!actor?.name) return ['user'];

    const name = actor.name.trim();
    const parts = name.split(/\s+/);
    const suggestions = [];

    if (parts.length >= 2) {
      const first = parts[0].toLowerCase();
      const last = parts[parts.length - 1].toLowerCase();
      const firstInitial = first.charAt(0);
      const lastInitial = last.charAt(0);

      suggestions.push(`${firstInitial}.${last}`);        // v.stryker
      suggestions.push(`${last}_${firstInitial}`);         // stryker_v
      suggestions.push(`${first}.${lastInitial}`);         // valerie.s
      suggestions.push(`${firstInitial}${last}${Math.floor(Math.random() * 90) + 10}`); // vstryker45
    } else {
      const single = name.toLowerCase().replace(/[^a-z0-9]/g, '');
      suggestions.push(single);
      suggestions.push(`${single}_nc`);
      suggestions.push(`${single}${Math.floor(Math.random() * 90) + 10}`);
    }

    // Sanitize all suggestions
    return suggestions.map(s => this.sanitizeHandle(s)).filter(Boolean);
  }

  // ═══════════════════════════════════════════════════════════
  //  VALIDATION
  // ═══════════════════════════════════════════════════════════

  /**
   * Sanitize a handle string.
   * @param {string} handle
   * @returns {string}
   */
  sanitizeHandle(handle) {
    return (handle ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, '')
      .replace(/^[._-]+/, '')
      .replace(/[._-]+$/, '')
      .substring(0, 32);
  }

  /**
   * Validate a handle string.
   * @param {string} handle
   * @returns {{ valid: boolean, error: string|null }}
   */
  validateHandle(handle) {
    if (!handle || handle.length < 2) {
      return { valid: false, error: 'Handle must be at least 2 characters' };
    }
    if (handle.length > 32) {
      return { valid: false, error: 'Handle must be 32 characters or less' };
    }
    if (!/^[a-z0-9][a-z0-9._-]*[a-z0-9]$/.test(handle) && handle.length > 1) {
      return { valid: false, error: 'Only lowercase letters, numbers, dots, underscores, hyphens' };
    }

    // Check if handle is taken by another actor
    const existingActor = this._findActorWithHandle(handle);
    if (existingActor) {
      return { valid: false, error: `Handle taken by ${existingActor.name}` };
    }

    return { valid: true, error: null };
  }

  /**
   * Validate a domain string.
   * @param {string} domain
   * @returns {{ valid: boolean, error: string|null }}
   */
  validateDomain(domain) {
    if (!domain || domain.length < 2) {
      return { valid: false, error: 'Domain required' };
    }
    if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(domain)) {
      return { valid: false, error: 'Invalid domain format' };
    }
    return { valid: true, error: null };
  }

  /**
   * Find an actor that currently uses a given handle (for uniqueness check).
   * @param {string} handle
   * @returns {Actor|null}
   * @private
   */
  _findActorWithHandle(handle) {
    if (!handle) return null;
    return game.actors?.find(a =>
      a.getFlag(MODULE_ID, 'emailHandle') === handle &&
      a.getFlag(MODULE_ID, 'emailSetupComplete')
    ) ?? null;
  }

  // ═══════════════════════════════════════════════════════════
  //  REGISTRATION
  // ═══════════════════════════════════════════════════════════

  /**
   * Register a new email identity for an actor.
   * @param {Actor} actor
   * @param {string} handle
   * @param {string} domain
   * @returns {Promise<string>} The full email address
   */
  async registerEmail(actor, handle, domain) {
    if (!actor) throw new Error('Actor required');

    const hResult = this.validateHandle(handle);
    if (!hResult.valid) throw new Error(hResult.error);

    const dResult = this.validateDomain(domain);
    if (!dResult.valid) throw new Error(dResult.error);

    const email = `${handle}@${domain}`;

    await actor.setFlag(MODULE_ID, 'email', email);
    await actor.setFlag(MODULE_ID, 'emailHandle', handle);
    await actor.setFlag(MODULE_ID, 'emailDomain', domain);
    await actor.setFlag(MODULE_ID, 'emailSetupComplete', true);

    // ── Add/update in GM master contact directory ──
    try {
      const mcs = game.nightcity?.masterContactService;
      if (mcs) {
        const existing = mcs.getByActorId(actor.id);
        if (existing) {
          // Update email on existing contact
          await mcs.updateContact(existing.id, { email });
          log.info(`EmailService: Updated master contact email → ${email}`);
        } else {
          // Create new master contact
          await mcs.addContact({
            name: actor.name,
            email,
            portrait: actor.img,
            actorId: actor.id,
            type: actor.hasPlayerOwner ? 'player' : 'npc',
          });
          log.info(`EmailService: Created master contact for ${actor.name}`);
        }
      }
    } catch (e) {
      // Non-fatal — email is registered even if contact creation fails
      log.warn('EmailService: Could not sync to master contacts', e);
    }

    log.info(`EmailService: Registered ${email} for ${actor.name}`);
    return email;
  }

  // ═══════════════════════════════════════════════════════════
  //  BURN
  // ═══════════════════════════════════════════════════════════

  /**
   * Burn an actor's current email identity.
   * Moves current email to history, clears active identity.
   * @param {Actor} actor
   * @param {string} [reason='manual'] - Reason for burn
   * @returns {Promise<void>}
   */
  async burnEmail(actor, reason = 'manual') {
    if (!actor) throw new Error('Actor required');

    const current = this.getEmailData(actor);
    if (!current?.email) {
      log.warn('EmailService: No email to burn');
      return;
    }

    // Build history entry
    const historyEntry = {
      email: current.email,
      handle: current.handle,
      domain: current.domain,
      burnedAt: new Date().toISOString(),
      reason,
    };

    // Get existing history
    const history = current.history ?? [];
    history.push(historyEntry);

    // Clear current and add to history
    await actor.unsetFlag(MODULE_ID, 'email');
    await actor.unsetFlag(MODULE_ID, 'emailHandle');
    await actor.unsetFlag(MODULE_ID, 'emailDomain');
    await actor.setFlag(MODULE_ID, 'emailSetupComplete', false);
    await actor.setFlag(MODULE_ID, 'emailHistory', history);

    log.info(`EmailService: Burned ${current.email} for ${actor.name} (${reason})`);
  }

  // ═══════════════════════════════════════════════════════════
  //  BURNED EMAIL DETECTION
  // ═══════════════════════════════════════════════════════════

  /**
   * Check if a given email address has been burned by any actor.
   * @param {string} email
   * @returns {{ burned: boolean, actorName: string|null, burnedAt: string|null }}
   */
  isBurnedEmail(email) {
    if (!email) return { burned: false, actorName: null, burnedAt: null };

    for (const actor of (game.actors ?? [])) {
      const history = actor.getFlag(MODULE_ID, 'emailHistory') ?? [];
      const entry = history.find(h => h.email === email);
      if (entry) {
        return {
          burned: true,
          actorName: actor.name,
          burnedAt: entry.burnedAt,
        };
      }
    }

    return { burned: false, actorName: null, burnedAt: null };
  }

  /**
   * GM utility: Force-set an email on an actor, bypassing the setup flow.
   * @param {Actor} actor
   * @param {string} email - Full email address
   * @returns {Promise<void>}
   */
  async forceSetEmail(actor, email) {
    if (!actor) throw new Error('Actor required');
    if (!game.user.isGM) throw new Error('GM only');

    const [handle, domain] = email.split('@');
    if (!handle || !domain) throw new Error('Invalid email format');

    await actor.setFlag(MODULE_ID, 'email', email);
    await actor.setFlag(MODULE_ID, 'emailHandle', handle);
    await actor.setFlag(MODULE_ID, 'emailDomain', domain);
    await actor.setFlag(MODULE_ID, 'emailSetupComplete', true);

    log.info(`EmailService: Force-set ${email} on ${actor.name}`);
  }
}
