/**
 * Contact Repository
 * @file scripts/data/ContactRepository.js
 * @module cyberpunkred-messenger
 * @description Actor flag-based contact storage. Contacts are stored in
 * actor.flags['cyberpunkred-messenger'].contacts as an array.
 */

import { MODULE_ID } from '../utils/constants.js';

export class ContactRepository {

  // ─── Contact CRUD ─────────────────────────────────────────

  /**
   * Get all contacts for an actor.
   * @param {string} actorId 
   * @returns {Promise<Array>}
   */
  async getContacts(actorId) {
    try {
      const actor = game.actors.get(actorId);
      if (!actor) return [];
      return actor.getFlag(MODULE_ID, 'contacts') || [];
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

      // Check permission — must own the actor or be GM
      if (!actor.isOwner && !game.user.isGM) {
        return { success: false, error: 'No permission to modify contacts' };
      }

      const contacts = await this.getContacts(actorId);

      // Check for duplicate email
      if (contactData.email && contacts.some(c => c.email === contactData.email)) {
        return { success: false, error: 'Contact with this email already exists' };
      }

      const contact = {
        id: foundry.utils.randomID(),
        name: contactData.name || 'Unknown',
        email: contactData.email || '',
        organization: contactData.organization || '',
        phone: contactData.phone || '',
        alias: contactData.alias || '',
        tags: contactData.tags || [],
        customImg: contactData.customImg || '',
        notes: contactData.notes || '',
        actorId: contactData.actorId || null,
        type: contactData.type || 'npc',
      };

      contacts.push(contact);
      await actor.setFlag(MODULE_ID, 'contacts', contacts);

      return { success: true, contact };
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

      // Merge updates, preserving id
      contacts[index] = { ...contacts[index], ...updates, id: contactId };
      await actor.setFlag(MODULE_ID, 'contacts', contacts);

      return { success: true, contact: contacts[index] };
    } catch (error) {
      console.error(`${MODULE_ID} | ContactRepository.updateContact:`, error);
      return { success: false, error: error.message };
    }
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
   * Find a contact by email address across an actor's contacts.
   * @param {string} actorId
   * @param {string} email
   * @returns {Promise<Object|null>}
   */
  async findByEmail(actorId, email) {
    const contacts = await this.getContacts(actorId);
    return contacts.find(c => c.email?.toLowerCase() === email?.toLowerCase()) || null;
  }

  /**
   * Search contacts by query string (matches name, email, alias, tags).
   * @param {string} actorId
   * @param {string} query
   * @returns {Promise<Array>}
   */
  async searchContacts(actorId, query) {
    if (!query) return this.getContacts(actorId);

    const contacts = await this.getContacts(actorId);
    const q = query.toLowerCase();

    return contacts.filter(c => {
      return (
        c.name?.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q) ||
        c.alias?.toLowerCase().includes(q) ||
        c.organization?.toLowerCase().includes(q) ||
        c.tags?.some(t => t.toLowerCase().includes(q))
      );
    });
  }

  // ─── Actor Email Management ───────────────────────────────

  /**
   * Get the email address configured for an actor.
   * @param {string} actorId
   * @returns {string}
   */
  getActorEmail(actorId) {
    const actor = game.actors.get(actorId);
    if (!actor) return '';
    return actor.getFlag(MODULE_ID, 'email') || '';
  }

  /**
   * Set the email address for an actor.
   * @param {string} actorId
   * @param {string} email
   * @returns {Promise<{success: boolean}>}
   */
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

  /**
   * Get the quick-reply templates for an actor.
   * @param {string} actorId
   * @returns {Array<string>}
   */
  getQuickReplies(actorId) {
    const actor = game.actors.get(actorId);
    if (!actor) return ['ACK', 'WILCO', 'NEGATIVE'];
    return actor.getFlag(MODULE_ID, 'quickReplies') || ['ACK', 'WILCO', 'NEGATIVE', 'On my way', 'Hold position'];
  }

  // ─── Bulk Operations ──────────────────────────────────────

  /**
   * Build a global contact lookup from all actors (for recipient autocomplete).
   * Returns actors with configured email addresses.
   * @returns {Array<{actorId: string, name: string, email: string, img: string}>}
   */
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

  /**
   * Get all actors the current user owns (for FROM dropdown).
   * GM gets all actors.
   * @returns {Array<{actorId: string, name: string, email: string, img: string}>}
   */
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
