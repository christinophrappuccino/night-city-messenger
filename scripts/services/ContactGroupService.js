/**
 * ContactGroupService — named lists of contacts you can message at once.
 * @file scripts/services/ContactGroupService.js
 * @module night-city-messenger
 * @description Contact groups, phase two. A group is
 *
 *     { id, name, color, members: [member], note, createdAt, updatedAt, sharedFrom: {groupId, at}|null }
 *
 *   where every member is the address-keyed record from participants.js. Two
 *   homes: a PLAYER's groups live on their actor (flag `contactGroups` — the
 *   player owns the actor, so they can write it); the GM's groups live in the
 *   world setting `masterContactGroups` and are PUSHED to players the way
 *   shared contacts are (members first, then the group, tagged `sharedFrom`).
 *
 *   Nothing here stores an id as the only key: members re-resolve by address
 *   (`resolveMember`), so a group survives export/import across worlds, a
 *   renamed contact, and a changed address (the id hint carries it meanwhile).
 */
import { MODULE_ID, EVENTS } from '../utils/constants.js';
import { log, isGM, getPlayerCharacters } from '../utils/helpers.js';
import { makeMember, dedupeMembers, resolveMember, worldAdapter, memberKey, normalizeEmail } from '../utils/participants.js';

/** The flag on an actor that holds that character's groups. */
export const GROUPS_FLAG = 'contactGroups';
/** The world setting that holds the GM's groups. */
export const MASTER_GROUPS_SETTING = 'masterContactGroups';
/** Chip colours a group can wear (the content-type palette, so they read as NCM). */
export const GROUP_COLORS = ['#19f3f7', '#f7c948', '#34d399', '#f65261', '#ffab00', '#a78bfa', '#60a5fa', '#f472b6', '#9aa0b4'];

const now = () => new Date().toISOString();
const uid = () => (globalThis.foundry?.utils?.randomID?.() || Math.random().toString(36).slice(2, 12));

/** Normalize anything group-shaped into a stored group. Members de-duped. */
export function sanitizeGroup(raw = {}) {
  const members = dedupeMembers(Array.isArray(raw.members) ? raw.members : []);
  const color = GROUP_COLORS.includes(raw.color) || /^#[0-9a-f]{6}$/i.test(raw.color || '') ? raw.color : GROUP_COLORS[0];
  return {
    id: String(raw.id || uid()),
    name: String(raw.name || '').trim().slice(0, 60) || 'Untitled group',
    color,
    members,
    note: String(raw.note || '').slice(0, 400),
    createdAt: raw.createdAt || now(),
    updatedAt: now(),
    sharedFrom: raw.sharedFrom && raw.sharedFrom.groupId ? { groupId: String(raw.sharedFrom.groupId), at: raw.sharedFrom.at || now() } : null,
    // When the group was last MESSAGED (touchActorGroup) — the Contact Manager's
    // rail puts recently used groups first. Null = never.
    lastUsedAt: raw.lastUsedAt ? String(raw.lastUsedAt) : null,
  };
}

/** A member record built from a PLAYER contact (ContactRepository shape). */
export function memberFromPlayerContact(c) {
  return makeMember({
    email: c?.email || '', name: c?.name || '',
    hint: { actorId: c?.actorId || '', contactId: c?.masterContactId || '' },
  });
}

/** A member record built from a MASTER (directory) contact. */
export function memberFromMasterContact(c) {
  return makeMember({ email: c?.email || '', name: c?.name || '', hint: { actorId: c?.actorId || '', contactId: c?.id || '' } });
}

/** A member record built from an actor (its NCM email flag, if any). */
export function memberFromActor(a) {
  const email = a?.getFlag?.(MODULE_ID, 'email') || a?.email || '';
  return makeMember({ email, name: a?.name || '', hint: { actorId: a?.id || '' } });
}

export class ContactGroupService {
  initialize() { log.info('ContactGroupService ready'); }

  /** Fire a bus event (mirrored as a Foundry hook for integrators); never throws. */
  _emit(event, payload) {
    try { game.nightcity?.eventBus?.emit?.(event, payload); } catch (err) { log.warn('group event failed', err); }
  }

  // ─── Player groups (actor flag) ─────────────────────────────

  /** @returns {Array<Object>} this character's groups (sanitized, never null) */
  getActorGroups(actorId) {
    const actor = game.actors?.get(actorId);
    const list = actor?.getFlag?.(MODULE_ID, GROUPS_FLAG);
    return Array.isArray(list) ? list.map(sanitizeGroup) : [];
  }

  getActorGroup(actorId, groupId) {
    return this.getActorGroups(actorId).find(g => g.id === groupId) || null;
  }

  /**
   * Create or update one of a character's groups. The actor's owner can write
   * this (it is their own actor); the GM can write anyone's.
   * @returns {Promise<{success: boolean, group?: Object, error?: string}>}
   */
  async saveActorGroup(actorId, group) {
    const actor = game.actors?.get(actorId);
    if (!actor) return { success: false, error: 'Character not found' };
    if (!actor.isOwner) return { success: false, error: 'You do not own this character' };
    const clean = sanitizeGroup(group);
    if (!clean.members.length) return { success: false, error: 'A group needs at least one member' };
    const list = this.getActorGroups(actorId);
    const i = list.findIndex(g => g.id === clean.id);
    if (i === -1) list.push(clean); else list[i] = { ...clean, createdAt: list[i].createdAt };
    try {
      await actor.setFlag(MODULE_ID, GROUPS_FLAG, list);
      this._emit(i === -1 ? EVENTS.GROUP_CREATED : EVENTS.GROUP_UPDATED, { scope: 'actor', actorId, group: clean });
      return { success: true, group: clean };
    } catch (err) {
      log.error('saveActorGroup failed', err);
      return { success: false, error: err.message };
    }
  }

  async deleteActorGroup(actorId, groupId) {
    const actor = game.actors?.get(actorId);
    if (!actor) return { success: false, error: 'Character not found' };
    if (!actor.isOwner) return { success: false, error: 'You do not own this character' };
    const list = this.getActorGroups(actorId).filter(g => g.id !== groupId);
    try {
      await actor.setFlag(MODULE_ID, GROUPS_FLAG, list);
      this._emit(EVENTS.GROUP_DELETED, { scope: 'actor', actorId, groupId });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Stamp a character's group as just used (messaged). Silent: no event, no
   * updatedAt bump, never throws — a recency hint must not be able to break a
   * send. Only the actor's owner (or the GM) can write the flag.
   * @param {string} actorId
   * @param {string} groupId
   */
  async touchActorGroup(actorId, groupId) {
    try {
      const actor = game.actors?.get(actorId);
      if (!actor?.isOwner || !groupId) return false;
      const raw = actor.getFlag(MODULE_ID, GROUPS_FLAG);
      if (!Array.isArray(raw)) return false;
      const i = raw.findIndex(g => g?.id === groupId);
      if (i === -1) return false;
      const list = raw.map((g, k) => (k === i ? { ...g, lastUsedAt: now() } : g));
      await actor.setFlag(MODULE_ID, GROUPS_FLAG, list);
      return true;
    } catch (err) {
      log.debug(`touchActorGroup skipped — ${err?.message || err}`);
      return false;
    }
  }

  /**
   * A group built from everyone in a character's contacts carrying a tag —
   * the "make a group from this tag" shortcut. Not saved; hand it to saveActorGroup.
   */
  async groupFromTag(actorId, tag) {
    const repo = game.nightcity?.contactRepository;
    const contacts = (await repo?.getContacts?.(actorId)) || [];
    const t = String(tag || '').toLowerCase();
    const members = contacts.filter(c => (c.tags || []).some(x => String(x).toLowerCase() === t)).map(memberFromPlayerContact);
    return sanitizeGroup({ name: tag, members });
  }

  // ─── GM groups (world setting) ──────────────────────────────

  /** @returns {Array<Object>} the GM's groups (every client can read a world setting) */
  getMasterGroups() {
    try {
      const list = game.settings.get(MODULE_ID, MASTER_GROUPS_SETTING);
      return Array.isArray(list) ? list.map(sanitizeGroup) : [];
    } catch { return []; }
  }

  getMasterGroup(groupId) {
    return this.getMasterGroups().find(g => g.id === groupId) || null;
  }

  async saveMasterGroup(group) {
    if (!isGM()) return { success: false, error: 'GM only' };
    const clean = sanitizeGroup(group);
    if (!clean.members.length) return { success: false, error: 'A group needs at least one member' };
    const list = this.getMasterGroups();
    const i = list.findIndex(g => g.id === clean.id);
    if (i === -1) list.push(clean); else list[i] = { ...clean, createdAt: list[i].createdAt };
    await game.settings.set(MODULE_ID, MASTER_GROUPS_SETTING, list);
    this._emit(i === -1 ? EVENTS.GROUP_CREATED : EVENTS.GROUP_UPDATED, { scope: 'master', actorId: null, group: clean });
    return { success: true, group: clean };
  }

  async deleteMasterGroup(groupId) {
    if (!isGM()) return { success: false, error: 'GM only' };
    await game.settings.set(MODULE_ID, MASTER_GROUPS_SETTING, this.getMasterGroups().filter(g => g.id !== groupId));
    this._emit(EVENTS.GROUP_DELETED, { scope: 'master', actorId: null, groupId });
    return { success: true };
  }

  /**
   * Which player characters hold a copy of a GM group (pushed earlier).
   * @returns {Array<{actorId: string, name: string}>}
   */
  sharedWith(groupId) {
    const out = [];
    // getPlayerCharacters() rows are { actorId, actorName, playerName, actor }.
    for (const pc of getPlayerCharacters()) {
      const actor = pc.actor || game.actors?.get(pc.actorId);
      if (!actor) continue;
      if (this.getActorGroups(actor.id).some(g => g.sharedFrom?.groupId === groupId)) out.push({ actorId: actor.id, name: actor.name });
    }
    return out;
  }

  // ─── Lookup for the composer ────────────────────────────────

  /**
   * Every group a composer may send to: the from-character's own groups, plus
   * the GM's groups when the user is the GM. Each tagged `scope`.
   */
  groupsFor({ actorId = null, isGM: gm = isGM() } = {}) {
    const own = actorId ? this.getActorGroups(actorId).map(g => ({ ...g, scope: 'actor', ownerActorId: actorId })) : [];
    const master = gm ? this.getMasterGroups().map(g => ({ ...g, scope: 'master' })) : [];
    return [...own, ...master];
  }

  findGroup(groupId, ctx = {}) {
    return this.groupsFor(ctx).find(g => g.id === groupId) || this.getMasterGroup(groupId) || null;
  }

  searchGroups(query, ctx = {}) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    return this.groupsFor(ctx).filter(g => g.name.toLowerCase().includes(q)
      || g.members.some(m => (m.name || '').toLowerCase().includes(q) || (m.email || '').includes(q)));
  }

  // ─── Resolution ─────────────────────────────────────────────

  /** Each member with its live resolution (participants.resolveMember). */
  resolveMembers(group, world = worldAdapter()) {
    return (group?.members || []).map(m => ({ member: m, resolved: resolveMember(m, world) }));
  }

  /**
   * The composer/service recipient list for a group. Unresolved members with an
   * address still go (as raw addresses — the verification gate decides);
   * members with no address and no live id are reported, not silently dropped.
   * @returns {{recipients: Array<{actorId: string|null, contactId: string|null, email: string, name: string}>, unresolved: Array<string>}}
   */
  recipientsFor(group, world = worldAdapter()) {
    const recipients = [];
    const unresolved = [];
    const seen = new Set();
    for (const { member, resolved } of this.resolveMembers(group, world)) {
      const email = normalizeEmail(resolved.email || member.email);
      const actorId = resolved.actorId || null;
      const contactId = resolved.contactId || null;
      if (!actorId && !contactId && !email) { unresolved.push(member.name || '(no address)'); continue; }
      const key = actorId ? `a:${actorId}` : contactId ? `c:${contactId}` : `e:${email}`;
      if (seen.has(key)) continue;
      seen.add(key);
      recipients.push({ actorId, contactId, email, name: resolved.name || member.name || email });
    }
    return { recipients, unresolved };
  }

  /** Names for a tooltip / chip, in member order. */
  memberNames(group) {
    return (group?.members || []).map(m => m.name || m.email).filter(Boolean);
  }

  // ─── GM → player ────────────────────────────────────────────

  /**
   * Push a GM group to a player character: every member the player does not
   * have yet is shared first (directory entries via pushToPlayer, bare actors via
   * pushActorToPlayer — both duplicate-safe), then the group lands in the
   * character's list tagged `sharedFrom`, replacing an earlier push of the same
   * group. Re-pushing is therefore a refresh, never a duplicate.
   * @returns {Promise<{success: boolean, shared: number, failed: Array<string>, error?: string}>}
   */
  async pushGroupToPlayer(groupId, targetActorId) {
    if (!isGM()) return { success: false, shared: 0, failed: [], error: 'GM only' };
    const group = this.getMasterGroup(groupId);
    if (!group) return { success: false, shared: 0, failed: [], error: 'Group not found' };
    const actor = game.actors?.get(targetActorId);
    if (!actor) return { success: false, shared: 0, failed: [], error: 'Character not found' };
    const master = game.nightcity?.masterContactService;
    const world = worldAdapter();
    let shared = 0;
    const failed = [];
    for (const { member, resolved } of this.resolveMembers(group, world)) {
      // A character never receives itself.
      if (resolved.actorId && resolved.actorId === targetActorId) continue;
      try {
        let r = null;
        if (resolved.contactId) r = await master?.pushToPlayer?.(resolved.contactId, targetActorId);
        else if (resolved.actorId) r = await master?.pushActorToPlayer?.(resolved.actorId, targetActorId);
        else continue; // a bare address has nothing to share; it still rides in the group
        if (r?.success) shared++; else failed.push(member.name || member.email);
      } catch (err) {
        failed.push(member.name || member.email);
        log.warn('pushGroupToPlayer member failed', err);
      }
    }
    const copy = sanitizeGroup({ ...group, id: undefined, sharedFrom: { groupId: group.id, at: now() } });
    const list = this.getActorGroups(targetActorId).filter(g => g.sharedFrom?.groupId !== group.id);
    list.push(copy);
    try {
      await actor.setFlag(MODULE_ID, GROUPS_FLAG, list);
    } catch (err) {
      return { success: false, shared, failed, error: err.message };
    }
    this._emit(EVENTS.GROUP_PUSHED, { groupId, targetActorId, shared, failed: [...failed] });
    return { success: true, shared, failed };
  }

  // ─── Export / import (GM groups travel with the master contacts) ───

  exportMaster() {
    return this.getMasterGroups().map(g => ({ ...g, sharedFrom: null }));
  }

  /**
   * Merge imported groups: de-duped by name (case-insensitive) against the
   * existing list; members re-resolve lazily by address. Returns what landed and
   * which members could not be resolved in THIS world (reported, not dropped).
   */
  async importMaster(list) {
    if (!isGM()) return { success: false, imported: 0, skipped: 0, unresolved: [] };
    const existing = this.getMasterGroups();
    const names = new Set(existing.map(g => g.name.toLowerCase()));
    const world = worldAdapter();
    let imported = 0, skipped = 0;
    const unresolved = [];
    for (const raw of Array.isArray(list) ? list : []) {
      const g = sanitizeGroup({ ...raw, id: undefined, sharedFrom: null });
      if (!g.members.length || names.has(g.name.toLowerCase())) { skipped++; continue; }
      for (const m of g.members) if (!resolveMember(m, world).resolvedBy && !m.email) unresolved.push(`${g.name}: ${m.name || '?'}`);
      existing.push(g);
      names.add(g.name.toLowerCase());
      imported++;
    }
    if (imported) await game.settings.set(MODULE_ID, MASTER_GROUPS_SETTING, existing);
    return { success: true, imported, skipped, unresolved };
  }

  /** The dedupe key of a member (exposed for pickers' `taken` sets). */
  static memberKey(m) { return memberKey(m); }
}
