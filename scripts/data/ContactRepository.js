/**
 * Contact Repository — Sprint 3 Update
 * @file scripts/data/ContactRepository.js
 * @module cyberpunkred-messenger
 * @description Actor flag-based contact storage. Contacts are stored in
 * actor.flags['cyberpunkred-messenger'].contacts as an array.
 *
 * Sprint 3 additions:
 *   - trust (0-5), burned, encrypted, encryptionDV, encryptionSkill
 *   - portrait (base64 or path), favorite, status override
 *   - Custom tag aggregation across all contacts
 *   - Actor-level tag storage for filter persistence
 */

import { MODULE_ID } from '../utils/constants.js';

/**
 * Default contact shape — ensures all fields exist even on legacy data.
 * @param {object} data — Incoming contact data (partial)
 * @returns {object} Normalized contact with all fields
 */
function _normalizeContact(data) {
  return {
    // ── Existing fields  ──
    id: data.id || foundry.utils.randomID(),
    name: data.name || 'Unknown',
    email: data.email || '',
    organization: data.organization || '',
    phone: data.phone || '',
    location: data.location || '',
    alias: data.alias || '',
    tags: Array.isArray(data.tags) ? data.tags : [],
    customImg: data.customImg || '',
    notes: data.notes || '',
    actorId: data.actorId || null,
    type: data.type || 'npc',

    // ── Sprint 3 fields ──
    portrait: data.portrait || '',
    trust: typeof data.trust === 'number' ? Math.max(0, Math.min(5, data.trust)) : 0,
    burned: !!data.burned,
    encrypted: !!data.encrypted,
    encryptionDV: data.encryptionDV || 15,
    encryptionSkill: data.encryptionSkill || 'Interface',
    favorite: !!data.favorite,
    role: data.role || '',
    network: data.network || 'citinet',
    statusOverride: data.statusOverride || null,

    // ── Verification fields ──
    verified: !!data.verified,
    masterContactId: data.masterContactId || null,
    linkedActorId: data.linkedActorId || data.actorId || null,
    verifiedOverride: !!data.verifiedOverride,   // true = GM force-verified
  };
}

export class ContactRepository {

  // ═══════════════════════════════════════════════════════════
  //  Contact CRUD
  // ═══════════════════════════════════════════════════════════

  /**
   * Get all contacts for an actor, normalized to current schema.
   * @param {string} actorId
   * @returns {Promise<Array>}
   */
  async getContacts(actorId) {
    try {
      const actor = game.actors.get(actorId);
      if (!actor) return [];
      const raw = actor.getFlag(MODULE_ID, 'contacts') || [];
      return raw.map(_normalizeContact);
    } catch (error) {
      console.error(`${MODULE_ID} | ContactRepository.getContacts:`, error);
      return [];
    }
  }

  /**
   * Add a contact to an actor's contact list.
   * @param {string} actorId
   * @param {Object} contactData
   * @returns {Promise<{success: boolean, contact?: Object}>}
   */
  async addContact(actorId, contactData) {
    try {
      const actor = game.actors.get(actorId);
      if (!actor) return { success: false, error: 'Actor not found' };
      if (!actor.isOwner && !game.user.isGM) {
        return { success: false, error: 'No permission to modify contacts' };
      }

      const contacts = await this.getContacts(actorId);

      // Check for duplicate email
      if (contactData.email && contacts.some(c => c.email === contactData.email)) {
        return { success: false, error: 'Contact with this email already exists' };
      }

      // ── Verify against master directory ──
      const verification = this.verifyContact(contactData.email);

      const contact = _normalizeContact({
        ...contactData,
        id: foundry.utils.randomID(),
        verified: verification.verified,
        masterContactId: verification.masterContactId || null,
        linkedActorId: verification.actorId || contactData.actorId || null,
      });

      contacts.push(contact);
      await actor.setFlag(MODULE_ID, 'contacts', contacts);

      return { success: true, contact, verified: verification.verified };
    } catch (error) {
      console.error(`${MODULE_ID} | ContactRepository.addContact:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Update an existing contact.
   * @param {string} actorId
   * @param {string} contactId
   * @param {Object} updates
   * @returns {Promise<{success: boolean, contact?: Object}>}
   */
  async updateContact(actorId, contactId, updates) {
    try {
      const actor = game.actors.get(actorId);
      if (!actor) return { success: false, error: 'Actor not found' };
      if (!actor.isOwner && !game.user.isGM) {
        return { success: false, error: 'No permission' };
      }

      const contacts = await this.getContacts(actorId);
      const index = contacts.findIndex(c => c.id === contactId);
      if (index === -1) return { success: false, error: 'Contact not found' };

      // ── Re-verify if email changed ──
      if (updates.email && updates.email !== contacts[index].email) {
        const verification = this.verifyContact(updates.email);
        updates.verified = verification.verified;
        updates.masterContactId = verification.masterContactId || null;
        updates.linkedActorId = verification.actorId || updates.actorId || contacts[index].linkedActorId || null;
        // Clear GM override when email changes — new address needs fresh verification
        if (!game.user.isGM) {
          updates.verifiedOverride = false;
        }
      }

      // Merge updates, preserving id, re-normalize
      contacts[index] = _normalizeContact({ ...contacts[index], ...updates, id: contactId });
      await actor.setFlag(MODULE_ID, 'contacts', contacts);

      return { success: true, contact: contacts[index] };
    } catch (error) {
      console.error(`${MODULE_ID} | ContactRepository.updateContact:`, error);
      return { success: false, error: error.message };
    }
  }

/**
 * Verify a contact's email against the master contact directory
 * and registered actor emails.
 * @param {string} email - Email to verify
 * @returns {{ verified: boolean, masterContactId?: string, actorId?: string }}
 */
  verifyContact(email) {
    if (!email) return { verified: false };

    const normalized = email.toLowerCase().trim();

    // ── Check 1: Master contact directory ──
    const masterService = game.nightcity?.masterContactService;
    if (masterService) {
      const masterContact = masterService.getByEmail(normalized);
      if (masterContact) {
        return {
          verified: true,
          masterContactId: masterContact.id,
          actorId: masterContact.actorId || null,
        };
      }
    }

    // ── Check 2: Actor email flags (for player characters not in master list) ──
    for (const actor of game.actors) {
      const actorEmail = actor.getFlag(MODULE_ID, 'email');
      if (actorEmail && actorEmail.toLowerCase().trim() === normalized) {
        return {
          verified: true,
          masterContactId: null,
          actorId: actor.id,
        };
      }
    }

    return { verified: false };
  }

  /**
   * Re-verify all contacts for an actor against the current master list.
   * Called when the master contact list changes so players get auto-verified
   * when a GM adds a matching NPC mid-session.
   * Skips GM-overridden contacts.
   * @param {string} actorId
   * @returns {Promise<{ updated: number, nowVerified: number, nowUnverified: number }>}
   */
  async reverifyAllContacts(actorId) {
    const actor = game.actors.get(actorId);
    if (!actor) return { updated: 0, nowVerified: 0, nowUnverified: 0 };

    const contacts = await this.getContacts(actorId);
    let updated = 0, nowVerified = 0, nowUnverified = 0;

    for (const contact of contacts) {
      // Never overwrite a GM override
      if (contact.verifiedOverride) continue;

      const result = this.verifyContact(contact.email);
      const wasVerified = contact.verified;

      contact.verified = result.verified;
      contact.masterContactId = result.masterContactId || null;
      contact.linkedActorId = result.actorId || contact.linkedActorId;

      if (wasVerified !== result.verified) {
        updated++;
        if (result.verified) nowVerified++;
        else nowUnverified++;
      }
    }

    if (updated > 0) {
      await actor.setFlag(MODULE_ID, 'contacts', contacts);
    }

    return { updated, nowVerified, nowUnverified };
  }

  /**
   * GM override: force-verify or force-unverify a contact.
   * @param {string} actorId - Owner actor
   * @param {string} contactId - Contact to override
   * @param {boolean} verified - true = force verify, false = force unverify
   * @returns {Promise<{success: boolean}>}
   */
  async gmOverrideVerification(actorId, contactId, verified) {
    if (!game.user.isGM) return { success: false, error: 'GM only' };

    const actor = game.actors.get(actorId);
    if (!actor) return { success: false, error: 'Actor not found' };

    const contacts = await this.getContacts(actorId);
    const contact = contacts.find(c => c.id === contactId);
    if (!contact) return { success: false, error: 'Contact not found' };

    contact.verified = verified;
    contact.verifiedOverride = verified; // Only set override flag when forcing ON
    // If GM is explicitly unverifying, clear the override flag too
    if (!verified) contact.verifiedOverride = false;

    await actor.setFlag(MODULE_ID, 'contacts', contacts);

    console.log(`${MODULE_ID} | GM ${verified ? 'verified' : 'unverified'} contact `
      + `${contact.name} (${contact.email}) for actor ${actor.name}`);

    return { success: true };
  }

  /**
   * Remove a contact from an actor's list.
   * @param {string} actorId
   * @param {string} contactId
   * @returns {Promise<{success: boolean}>}
   */
  async removeContact(actorId, contactId) {
    try {
      const actor = game.actors.get(actorId);
      if (!actor) return { success: false, error: 'Actor not found' };
      if (!actor.isOwner && !game.user.isGM) {
        return { success: false, error: 'No permission' };
      }

      let contacts = await this.getContacts(actorId);
      contacts = contacts.filter(c => c.id !== contactId);
      await actor.setFlag(MODULE_ID, 'contacts', contacts);

      return { success: true };
    } catch (error) {
      console.error(`${MODULE_ID} | ContactRepository.removeContact:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Find a contact by email address.
   * @param {string} actorId
   * @param {string} email
   * @returns {Promise<Object|null>}
   */
  async findByEmail(actorId, email) {
    const contacts = await this.getContacts(actorId);
    return contacts.find(c => c.email?.toLowerCase() === email?.toLowerCase()) || null;
  }

  /**
   * Search contacts by query string (matches name, email, alias, org, tags).
   * @param {string} actorId
   * @param {string} query
   * @returns {Promise<Array>}
   */
  async searchContacts(actorId, query) {
    if (!query) return this.getContacts(actorId);

    const contacts = await this.getContacts(actorId);
    const q = query.toLowerCase();

    return contacts.filter(c =>
      c.name?.toLowerCase().includes(q) ||
      c.email?.toLowerCase().includes(q) ||
      c.alias?.toLowerCase().includes(q) ||
      c.organization?.toLowerCase().includes(q) ||
      c.role?.toLowerCase().includes(q) ||
      c.tags?.some(t => t.toLowerCase().includes(q))
    );
  }

  // ═══════════════════════════════════════════════════════════
  //  Sprint 3 — Trust, Burned, Encrypted, Favorites
  // ═══════════════════════════════════════════════════════════

  /**
   * Set trust level for a contact (GM action).
   * @param {string} actorId
   * @param {string} contactId
   * @param {number} trust — 0-5
   * @returns {Promise<{success: boolean}>}
   */
  async setTrust(actorId, contactId, trust) {
    return this.updateContact(actorId, contactId, {
      trust: Math.max(0, Math.min(5, trust)),
    });
  }

  /**
   * Mark a contact as burned (GM action).
   * @param {string} actorId
   * @param {string} contactId
   * @param {boolean} burned
   * @returns {Promise<{success: boolean}>}
   */
  async setBurned(actorId, contactId, burned = true) {
    return this.updateContact(actorId, contactId, { burned });
  }

  /**
   * Mark a contact as encrypted (GM action — for pushed contacts).
   * @param {string} actorId
   * @param {string} contactId
   * @param {object} encryptionData — { encrypted, encryptionDV, encryptionSkill }
   * @returns {Promise<{success: boolean}>}
   */
  async setEncryption(actorId, contactId, encryptionData) {
    return this.updateContact(actorId, contactId, {
      encrypted: encryptionData.encrypted ?? true,
      encryptionDV: encryptionData.encryptionDV ?? 15,
      encryptionSkill: encryptionData.encryptionSkill ?? 'Interface',
    });
  }

  /**
   * Decrypt a contact (after successful hack).
   * @param {string} actorId
   * @param {string} contactId
   * @returns {Promise<{success: boolean}>}
   */
  async decryptContact(actorId, contactId) {
    return this.updateContact(actorId, contactId, { encrypted: false });
  }

  /**
   * Toggle favorite status.
   * @param {string} actorId
   * @param {string} contactId
   * @returns {Promise<{success: boolean, favorite?: boolean}>}
   */
  async toggleFavorite(actorId, contactId) {
    const contacts = await this.getContacts(actorId);
    const contact = contacts.find(c => c.id === contactId);
    if (!contact) return { success: false, error: 'Contact not found' };

    const result = await this.updateContact(actorId, contactId, { favorite: !contact.favorite });
    return { ...result, favorite: !contact.favorite };
  }

  /**
   * Set portrait for a contact.
   * @param {string} actorId
   * @param {string} contactId
   * @param {string} portraitData — Base64 string or file path
   * @returns {Promise<{success: boolean}>}
   */
  async setPortrait(actorId, contactId, portraitData) {
    return this.updateContact(actorId, contactId, { portrait: portraitData });
  }

  // ═══════════════════════════════════════════════════════════
  //  Sprint 3 — Tag Management
  // ═══════════════════════════════════════════════════════════

  /**
   * Get all unique tags across an actor's contacts.
   * @param {string} actorId
   * @returns {Promise<string[]>}
   */
  async getAllTags(actorId) {
    const contacts = await this.getContacts(actorId);
    const tagSet = new Set();
    for (const c of contacts) {
      if (c.tags) c.tags.forEach(t => tagSet.add(t));
    }

    // Also include actor-level custom tags (user-created, may not be on any contact yet)
    const actor = game.actors.get(actorId);
    const customTags = actor?.getFlag(MODULE_ID, 'contactTags') || [];
    customTags.forEach(t => tagSet.add(t));

    return [...tagSet].sort();
  }

  /**
   * Add a custom tag to the actor's tag list (persists even if no contacts use it).
   * @param {string} actorId
   * @param {string} tag
   * @returns {Promise<{success: boolean}>}
   */
  async addCustomTag(actorId, tag) {
    try {
      const actor = game.actors.get(actorId);
      if (!actor) return { success: false, error: 'Actor not found' };
      if (!actor.isOwner && !game.user.isGM) {
        return { success: false, error: 'No permission' };
      }

      const tags = actor.getFlag(MODULE_ID, 'contactTags') || [];
      const normalized = tag.toUpperCase().trim();
      if (!normalized || tags.includes(normalized)) return { success: true }; // Already exists

      tags.push(normalized);
      await actor.setFlag(MODULE_ID, 'contactTags', tags);
      return { success: true };
    } catch (error) {
      console.error(`${MODULE_ID} | ContactRepository.addCustomTag:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Remove a custom tag from the actor's tag list.
   * Does NOT remove the tag from individual contacts.
   * @param {string} actorId
   * @param {string} tag
   * @returns {Promise<{success: boolean}>}
   */
  async removeCustomTag(actorId, tag) {
    try {
      const actor = game.actors.get(actorId);
      if (!actor) return { success: false, error: 'Actor not found' };
      if (!actor.isOwner && !game.user.isGM) {
        return { success: false, error: 'No permission' };
      }

      let tags = actor.getFlag(MODULE_ID, 'contactTags') || [];
      tags = tags.filter(t => t !== tag);
      await actor.setFlag(MODULE_ID, 'contactTags', tags);
      return { success: true };
    } catch (error) {
      console.error(`${MODULE_ID} | ContactRepository.removeCustomTag:`, error);
      return { success: false, error: error.message };
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Actor Email Management (unchanged from Phase 2)
  // ═══════════════════════════════════════════════════════════

  getActorEmail(actorId) {
    const actor = game.actors.get(actorId);
    if (!actor) return '';
    return actor.getFlag(MODULE_ID, 'email') || '';
  }

  async setActorEmail(actorId, email) {
    try {
      const actor = game.actors.get(actorId);
      if (!actor) return { success: false, error: 'Actor not found' };
      if (!actor.isOwner && !game.user.isGM) {
        return { success: false, error: 'No permission' };
      }
      await actor.setFlag(MODULE_ID, 'email', email);
      return { success: true };
    } catch (error) {
      console.error(`${MODULE_ID} | ContactRepository.setActorEmail:`, error);
      return { success: false, error: error.message };
    }
  }

  getQuickReplies(actorId) {
    const actor = game.actors.get(actorId);
    if (!actor) return ['ACK', 'WILCO', 'NEGATIVE'];
    return actor.getFlag(MODULE_ID, 'quickReplies') || ['ACK', 'WILCO', 'NEGATIVE', 'On my way', 'Hold position'];
  }

  // ═══════════════════════════════════════════════════════════
  //  Bulk Operations (unchanged from Phase 2)
  // ═══════════════════════════════════════════════════════════

  getGlobalActorDirectory() {
    const directory = [];
    for (const actor of game.actors) {
      const email = actor.getFlag(MODULE_ID, 'email');
      if (email) {
        directory.push({
          actorId: actor.id,
          name: actor.name,
          email,
          img: actor.img,
          type: actor.type,
          isPlayerOwned: actor.hasPlayerOwner,
        });
      }
    }
    return directory;
  }

  getOwnedActorsWithEmail() {
    const actors = [];
    for (const actor of game.actors) {
      if (!actor.isOwner) continue;
      const email = actor.getFlag(MODULE_ID, 'email') || '';
      actors.push({
        actorId: actor.id,
        name: actor.name,
        email,
        img: actor.img,
      });
    }
    return actors;
  }
}
