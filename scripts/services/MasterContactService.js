/**
 * MasterContactService
 * @file scripts/services/MasterContactService.js
 * @module cyberpunkred-messenger
 * @description GM-only master contact directory. CRUD for NPC contacts with email,
 *              alias, organization, portrait, and tags. Source of truth for NPC
 *              identities across all player contact lists. Stores in world settings.
 */

import { MODULE_ID, EVENTS } from '../utils/constants.js';
import { log, isGM } from '../utils/helpers.js';

export class MasterContactService {

  /** @type {Array<object>} In-memory cache of master contacts */
  _contacts = [];

  // ─── Service Accessors ───

  get settingsManager() { return game.nightcity?.settingsManager; }
  get eventBus() { return game.nightcity?.eventBus; }

  // ═══════════════════════════════════════════════════════════════
  //  INITIALIZATION
  // ═══════════════════════════════════════════════════════════════

  /**
   * Initialize — load master contacts from settings.
   */
  initialize() {
    this._loadContacts();
    log.info(`MasterContactService initialized — ${this._contacts.length} contacts loaded`);
  }

  // ═══════════════════════════════════════════════════════════════
  //  PUBLIC API — CRUD
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get all master contacts.
   * @returns {Array<object>}
   */
  getAll() {
    return [...this._contacts];
  }

  /**
   * Get a single contact by ID.
   * @param {string} contactId
   * @returns {object|null}
   */
  getContact(contactId) {
    return this._contacts.find(c => c.id === contactId) ?? null;
  }

  /**
   * Find contacts by email address.
   * @param {string} email
   * @returns {object|null}
   */
  getByEmail(email) {
    if (!email) return null;
    const normalized = email.toLowerCase().trim();
    return this._contacts.find(c => c.email?.toLowerCase().trim() === normalized) ?? null;
  }

  /**
   * Find contacts by linked actor ID.
   * @param {string} actorId
   * @returns {object|null}
   */
  getByActorId(actorId) {
    return this._contacts.find(c => c.actorId === actorId) ?? null;
  }

  /**
   * Search contacts by name, email, alias, organization, or tags.
   * @param {string} query
   * @returns {Array<object>}
   */
  search(query) {
    if (!query?.trim()) return this.getAll();

    const q = query.toLowerCase().trim();
    return this._contacts.filter(c =>
      c.name?.toLowerCase().includes(q) ||
      c.email?.toLowerCase().includes(q) ||
      c.alias?.toLowerCase().includes(q) ||
      c.organization?.toLowerCase().includes(q) ||
      c.tags?.some(t => t.toLowerCase().includes(q))
    );
  }

  /**
   * Filter contacts by tag.
   * @param {string} tag
   * @returns {Array<object>}
   */
  filterByTag(tag) {
    if (!tag) return this.getAll();
    const t = tag.toLowerCase().trim();
    return this._contacts.filter(c =>
      c.tags?.some(ct => ct.toLowerCase() === t)
    );
  }

  /**
   * Filter contacts by organization.
   * @param {string} org
   * @returns {Array<object>}
   */
  filterByOrganization(org) {
    if (!org) return this.getAll();
    const o = org.toLowerCase().trim();
    return this._contacts.filter(c =>
      c.organization?.toLowerCase() === o
    );
  }

  /**
   * Get all unique tags from all contacts.
   * @returns {Array<string>}
   */
  getAllTags() {
    const tags = new Set();
    for (const c of this._contacts) {
      if (c.tags) c.tags.forEach(t => tags.add(t));
    }
    return [...tags].sort();
  }

  /**
   * Get all unique organizations.
   * @returns {Array<string>}
   */
  getAllOrganizations() {
    const orgs = new Set();
    for (const c of this._contacts) {
      if (c.organization) orgs.add(c.organization);
    }
    return [...orgs].sort();
  }

  /**
   * Add a new master contact. GM only.
   * @param {object} data
   * @param {string} data.name - Display name (required)
   * @param {string} [data.email] - Email address
   * @param {string} [data.alias] - Alias / handle
   * @param {string} [data.organization] - Organization / corp
   * @param {string} [data.phone] - Phone number
   * @param {string} [data.location] - Location / district
   * @param {string} [data.portrait] - Image path
   * @param {Array<string>} [data.tags] - Tags for filtering
   * @param {string} [data.notes] - GM notes
   * @param {string} [data.actorId] - Linked Foundry actor ID
   * @param {string} [data.type] - Contact type: npc, player (deprecated — use role)
   * @param {string} [data.role] - Role: fixer, solo, netrunner, etc. (or custom role ID)
   * @param {number} [data.trust] - Party-wide trust level (0-5)
   * @param {object} [data.relationships] - Per-player relationships { [actorId]: { type, trust, note } }
   * @param {string} [data.folder] - Manual folder name for grouping
   * @returns {{ success: boolean, contact?: object, error?: string }}
   */
  async addContact(data) {
    if (!isGM()) return { success: false, error: 'GM only' };

    if (!data.name?.trim()) {
      return { success: false, error: 'Contact name is required' };
    }

    const contact = {
      id: foundry.utils.randomID(),
      name: data.name.trim(),
      email: data.email?.trim() || this._generateEmail(data.name),
      alias: data.alias?.trim() || '',
      organization: data.organization?.trim() || '',
      phone: data.phone?.trim() || '',
      location: data.location?.trim() || '',
      portrait: data.portrait || null,
      tags: Array.isArray(data.tags) ? data.tags.map(t => t.trim()).filter(Boolean) : [],
      notes: data.notes?.trim() || '',
      actorId: data.actorId || null,
      type: data.type || 'npc',
      role: data.role?.trim() || '',
      trust: typeof data.trust === 'number' ? data.trust : 0,
      relationships: data.relationships || {},
      folder: data.folder?.trim() || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this._contacts.push(contact);
    await this._persistContacts();

    this.eventBus?.emit('contacts:masterUpdated', { action: 'add', contactId: contact.id });
    log.info(`Master contact added: ${contact.name} (${contact.id})`);
    await this._onMasterListChanged();
    return { success: true, contact };
  }

  /**
   * Update an existing master contact. GM only.
   * @param {string} contactId
   * @param {object} updates - Partial updates
   * @returns {{ success: boolean, contact?: object, error?: string }}
   */
  async updateContact(contactId, updates) {
    if (!isGM()) return { success: false, error: 'GM only' };

    const contact = this._contacts.find(c => c.id === contactId);
    if (!contact) return { success: false, error: 'Contact not found' };

    // Apply updates (whitelist fields)
    const allowed = [
      'name', 'email', 'alias', 'organization', 'phone', 'location', 'portrait',
      'tags', 'notes', 'actorId', 'type', 'role', 'folder',
      'trust', 'relationships', 'burned',
      'encrypted', 'encryptionDV', 'blackIce', 'blackIceDamage',
    ];
    for (const key of allowed) {
      if (key in updates) {
        if (key === 'tags' && Array.isArray(updates.tags)) {
          contact.tags = updates.tags.map(t => t.trim()).filter(Boolean);
        } else if (key === 'relationships' && typeof updates.relationships === 'object') {
          // Deep-merge relationships (don't trim — it's an object)
          contact.relationships = updates.relationships;
        } else if (typeof updates[key] === 'string') {
          contact[key] = updates[key].trim();
        } else {
          contact[key] = updates[key];
        }
      }
    }
    contact.updatedAt = new Date().toISOString();
    await this._persistContacts();
    this.eventBus?.emit('contacts:masterUpdated', { action: 'update', contactId });
    log.info(`Master contact updated: ${contact.name} (${contactId})`);
    if (updates.email) await this._onMasterListChanged(); 
    return { success: true, contact };
  }

  /**
   * Remove a master contact. GM only.
   * @param {string} contactId
   * @returns {{ success: boolean, error?: string }}
   */
  async removeContact(contactId) {
    if (!isGM()) return { success: false, error: 'GM only' };

    const idx = this._contacts.findIndex(c => c.id === contactId);
    if (idx === -1) return { success: false, error: 'Contact not found' };

    const removed = this._contacts.splice(idx, 1)[0];
    await this._persistContacts();

    this.eventBus?.emit('contacts:masterUpdated', { action: 'remove', contactId });
    log.info(`Master contact removed: ${removed.name} (${contactId})`);
    await this._onMasterListChanged();
    return { success: true };
  }

  /**
   * Bulk remove contacts by IDs. GM only.
   * @param {Array<string>} contactIds
   * @returns {{ success: boolean, removed: number }}
   */
  async bulkRemove(contactIds) {
    if (!isGM()) return { success: false, removed: 0 };

    const before = this._contacts.length;
    this._contacts = this._contacts.filter(c => !contactIds.includes(c.id));
    const removed = before - this._contacts.length;

    if (removed > 0) {
      await this._persistContacts();
      this.eventBus?.emit('contacts:masterUpdated', { action: 'bulkRemove', count: removed });
      log.info(`Bulk removed ${removed} master contacts`);
      await this._onMasterListChanged();
    }

    return { success: true, removed };
  }

  /**
   * Push a master contact to a player's personal address book.
   * Creates or updates the contact in the player actor's contact repository.
   * @param {string} contactId - Master contact ID
   * @param {string} actorId - Target player actor ID
   * @returns {{ success: boolean, error?: string }}
   */
  async pushToPlayer(contactId, actorId) {
    if (!isGM()) return { success: false, error: 'GM only' };

    const contact = this.getContact(contactId);
    if (!contact) return { success: false, error: 'Contact not found' };

    const contactRepo = game.nightcity?.contactRepository;
    if (!contactRepo) return { success: false, error: 'ContactRepository not available' };

    try {
      const playerContact = {
        name: contact.name,
        email: contact.email,
        alias: contact.alias,
        organization: contact.organization,
        phone: contact.phone,
        location: contact.location || '',
        customImg: contact.portrait,
        tags: [...(contact.tags || [])],
        notes: '', // Don't copy GM notes to players
        actorId: contact.actorId,
        type: contact.type,
        role: contact.role || '',
      };

      await contactRepo.addContact(actorId, playerContact);
      log.info(`Pushed contact ${contact.name} to actor ${actorId}`);
      return { success: true };
    } catch (error) {
      console.error(`${MODULE_ID} | MasterContactService.pushToPlayer:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Sync all master contacts to a player's address book.
   * @param {string} actorId
   * @returns {{ success: boolean, synced: number }}
   */
  async syncAllToPlayer(actorId) {
    if (!isGM()) return { success: false, synced: 0 };

    let synced = 0;
    for (const contact of this._contacts) {
      const result = await this.pushToPlayer(contact.id, actorId);
      if (result.success) synced++;
    }

    log.info(`Synced ${synced} contacts to actor ${actorId}`);
    return { success: true, synced };
  }

  /**
   * Import contacts from actors in the world.
   * Creates master contacts for all NPCs that don't already have one.
   * @returns {{ success: boolean, imported: number }}
   */
  async importFromActors() {
    if (!isGM()) return { success: false, imported: 0 };

    let imported = 0;
    for (const actor of game.actors) {
      // Skip if already in master contacts
      if (this.getByActorId(actor.id)) continue;

      // Check if actor has an NCM email set
      const email = actor.getFlag(MODULE_ID, 'email');
      if (!email) continue;

      await this.addContact({
        name: actor.name,
        email,
        portrait: actor.img,
        actorId: actor.id,
        type: actor.hasPlayerOwner ? 'player' : 'npc',
      });
      imported++;
    }

    log.info(`Imported ${imported} contacts from actors`);
    return { success: true, imported };
  }

  /**
   * Re-verify all player contacts after a master list change.
   * When the GM adds/removes/edits a master contact, any player who
   * already typed in that email gets auto-verified or auto-unverified.
   * @private
   */
  async _onMasterListChanged() {
    if (!isGM()) return;

    const contactRepo = game.nightcity?.contactRepository;
    if (!contactRepo?.reverifyAllContacts) return;

    let totalUpdated = 0;

    for (const actor of game.actors) {
      // Only re-verify player-owned actors — NPC contacts are GM-managed
      if (!actor.hasPlayerOwner) continue;

      try {
        const result = await contactRepo.reverifyAllContacts(actor.id);
        if (result.updated > 0) {
          totalUpdated += result.updated;
          log.info(`Re-verified contacts for ${actor.name}: `
            + `${result.nowVerified} newly verified, ${result.nowUnverified} newly unverified`);
        }
      } catch (error) {
        console.error(`${MODULE_ID} | Failed to re-verify contacts for ${actor.name}:`, error);
      }
    }

    if (totalUpdated > 0) {
      // Notify open ContactManagers to refresh
      this.eventBus?.emit(EVENTS.CONTACTS_REVERIFIED, { updated: totalUpdated });
      log.info(`Master list change triggered ${totalUpdated} contact verification updates`);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  CUSTOM ROLES
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get all custom roles defined by the GM.
   * @returns {Array<{ id: string, label: string, icon: string, color: string }>}
   */
  getCustomRoles() {
    try {
      return this.settingsManager?.get('customRoles') ?? [];
    } catch {
      return [];
    }
  }

  /**
   * Save custom roles to settings.
   * @param {Array<{ id: string, label: string, icon: string, color: string }>} roles
   */
  async setCustomRoles(roles) {
    if (!isGM()) return;
    await this.settingsManager?.set('customRoles', roles);
    this.eventBus?.emit('roles:updated', { roles });
    log.info(`Custom roles saved — ${roles.length} roles`);
  }

  /**
   * Add a single custom role.
   * @param {{ label: string, icon: string, color: string }} roleData
   * @returns {{ success: boolean, role?: object, error?: string }}
   */
  async addCustomRole(roleData) {
    if (!isGM()) return { success: false, error: 'GM only' };
    if (!roleData.label?.trim()) return { success: false, error: 'Role name is required' };

    const id = roleData.label.trim().toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');

    // Check for duplicates against built-in + existing custom
    const builtIn = [
      'fixer','netrunner','runner','corp','exec','solo','tech','medtech',
      'ripperdoc','media','nomad','lawman','rockerboy','rocker',
      'gang','civilian','government','ai','npc',
    ];
    if (builtIn.includes(id)) return { success: false, error: 'Cannot override a built-in role' };

    const existing = this.getCustomRoles();
    if (existing.some(r => r.id === id)) return { success: false, error: 'A role with this name already exists' };

    const role = {
      id,
      label: roleData.label.trim(),
      icon: roleData.icon || 'tag',
      color: roleData.color || '#888888',
    };

    existing.push(role);
    await this.setCustomRoles(existing);
    return { success: true, role };
  }

  /**
   * Update an existing custom role.
   * @param {string} roleId
   * @param {{ label?: string, icon?: string, color?: string }} updates
   * @returns {{ success: boolean, error?: string }}
   */
  async updateCustomRole(roleId, updates) {
    if (!isGM()) return { success: false, error: 'GM only' };

    const roles = this.getCustomRoles();
    const role = roles.find(r => r.id === roleId);
    if (!role) return { success: false, error: 'Custom role not found' };

    if (updates.label != null) role.label = updates.label.trim();
    if (updates.icon != null) role.icon = updates.icon;
    if (updates.color != null) role.color = updates.color;

    await this.setCustomRoles(roles);
    return { success: true };
  }

  /**
   * Delete a custom role. Contacts using it will have their role cleared.
   * @param {string} roleId
   * @returns {{ success: boolean, affectedContacts: number, error?: string }}
   */
  async deleteCustomRole(roleId) {
    if (!isGM()) return { success: false, affectedContacts: 0, error: 'GM only' };

    const roles = this.getCustomRoles();
    const idx = roles.findIndex(r => r.id === roleId);
    if (idx < 0) return { success: false, affectedContacts: 0, error: 'Custom role not found' };

    roles.splice(idx, 1);
    await this.setCustomRoles(roles);

    // Clear role on any contacts that used it
    let affected = 0;
    for (const contact of this._contacts) {
      if (contact.role === roleId) {
        contact.role = '';
        affected++;
      }
    }
    if (affected > 0) {
      await this._persistContacts();
      this.eventBus?.emit('contacts:masterUpdated', { action: 'roleDeleted', roleId });
    }

    return { success: true, affectedContacts: affected };
  }

  // ═══════════════════════════════════════════════════════════════
  //  INTERNAL
  // ═══════════════════════════════════════════════════════════════

  /** @private */
  _loadContacts() {
    try {
      this._contacts = this.settingsManager?.get('masterContacts') ?? [];
      this._migrateContacts();
    } catch {
      log.warn('Failed to load master contacts — starting fresh');
      this._contacts = [];
    }
  }

  /**
   * Migrate contacts from older schema versions.
   * - type → role (if role doesn't exist yet and type is a known role name)
   * - relationship (string) → relationships (per-player object)
   * - Ensure new fields have defaults
   * @private
   */
  _migrateContacts() {
    let dirty = false;

    // Known role names that should migrate from type → role
    const knownRoles = new Set([
      'fixer', 'netrunner', 'runner', 'corp', 'exec', 'solo', 'tech',
      'medtech', 'ripperdoc', 'media', 'nomad', 'lawman', 'rockerboy',
      'rocker', 'gang', 'civilian', 'government', 'ai',
    ]);

    for (const contact of this._contacts) {
      // ── Migrate type → role ──
      if (!contact.role && contact.type && knownRoles.has(contact.type.toLowerCase())) {
        contact.role = contact.type.toLowerCase();
        dirty = true;
      }

      // ── Migrate single relationship → per-player relationships ──
      if (contact.relationship && !contact.relationships) {
        // Build per-player relationships from the old single value
        const playerActorIds = [];
        for (const user of game.users ?? []) {
          if (!user.isGM && user.character) {
            playerActorIds.push(user.character.id);
          }
        }
        contact.relationships = {};
        for (const actorId of playerActorIds) {
          contact.relationships[actorId] = {
            type: contact.relationship,
            trust: null, // inherit party trust
            note: '',
          };
        }
        delete contact.relationship;
        dirty = true;
      }

      // ── Ensure new fields have defaults ──
      if (contact.role === undefined) { contact.role = ''; dirty = true; }
      if (contact.folder === undefined) { contact.folder = ''; dirty = true; }
      if (contact.relationships === undefined) { contact.relationships = {}; dirty = true; }
      if (contact.trust === undefined) { contact.trust = 0; dirty = true; }
      if (contact.location === undefined) { contact.location = ''; dirty = true; }
    }

    if (dirty) {
      log.info('MasterContactService: Migrated contacts to updated schema');
      // Persist silently — don't emit events during init
      this._persistContacts().catch(err =>
        console.error(`${MODULE_ID} | Migration persist failed:`, err)
      );
    }
  }

  /** @private */
  async _persistContacts() {
    try {
      await this.settingsManager?.set('masterContacts', this._contacts);
    } catch (error) {
      console.error(`${MODULE_ID} | MasterContactService._persistContacts:`, error);
    }
  }

  /**
   * Generate a default email from a name.
   * @param {string} name
   * @returns {string}
   * @private
   */
  _generateEmail(name) {
    const handle = name.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, '.')
      .substring(0, 30);
    return `${handle}@nightcity.net`;
  }
}
