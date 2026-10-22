/**
 * Participants — who a message went to, keyed by ADDRESS.
 * @file scripts/utils/participants.js
 * @module night-city-messenger
 * @description The member record shared by multi-recipient mail (phase one) and
 *   contact groups (phase two). A member is "address first, ids as hints":
 *
 *     { email, name, kind: 'actor'|'contact'|'address', hint: { actorId?, contactId? }, role: 'from'|'to' }
 *
 *   The address is the portable key — master-contact export is a bare JSON
 *   array that is imported with FRESH ids and de-duped by email, so a member
 *   stored by id would break the moment a group crossed worlds. The ids ride
 *   along as a this-world fast path only.
 *
 *   Pure: no Foundry globals. `resolveMember` takes a `world` adapter so the
 *   sim can drive the four-step resolution with two mocked worlds and prove an
 *   exported member re-resolves by address when every id is different.
 *   `worldAdapter()` builds that adapter from the live Foundry globals.
 */

/** Lowercase + trim; '' for anything blank. */
export function normalizeEmail(s) {
  return String(s ?? '').trim().toLowerCase();
}

/** Space/punctuation-insensitive name key — the SkillService rule. */
export function normName(s) {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Build a normalized member record.
 * @param {object} o
 * @param {string} [o.email]
 * @param {string} [o.name]
 * @param {'actor'|'contact'|'address'} [o.kind]  inferred from the hints when omitted
 * @param {{actorId?: string, contactId?: string}} [o.hint]
 * @param {'from'|'to'} [o.role='to']
 * @returns {{email: string, name: string, kind: string, hint: {actorId: string, contactId: string}, role: string}}
 */
export function makeMember({ email = '', name = '', kind, hint = {}, role = 'to' } = {}) {
  const actorId = String(hint.actorId ?? '') || '';
  const contactId = String(hint.contactId ?? '') || '';
  const k = kind || (actorId ? 'actor' : contactId ? 'contact' : 'address');
  return {
    email: normalizeEmail(email),
    name: String(name ?? '').trim(),
    kind: k,
    hint: { actorId, contactId },
    role: role === 'from' ? 'from' : 'to',
  };
}

/**
 * The lowercased identifiers a member answers to — used to match "is this me"
 * and "do these two conversations share a party".
 * @param {object} m
 * @returns {Set<string>}
 */
export function memberKeys(m) {
  const set = new Set();
  const add = (v) => { const s = String(v ?? '').trim().toLowerCase(); if (s) set.add(s); };
  add(m?.email); add(m?.hint?.actorId); add(m?.hint?.contactId);
  return set;
}

/**
 * Identity keys for the viewing character (actor id, address, directory id).
 * @param {{actorId?: string, email?: string, contactId?: string}} self
 * @returns {Set<string>}
 */
export function selfKeys(self = {}) {
  return memberKeys({ email: self.email, hint: { actorId: self.actorId, contactId: self.contactId } });
}

/** A member's dedupe key: address, else the actor hint, else the contact hint, else the name. */
export function memberKey(m) {
  return normalizeEmail(m?.email) || (m?.hint?.actorId ? `actor:${m.hint.actorId}` : '')
    || (m?.hint?.contactId ? `contact:${m.hint.contactId}` : '') || `name:${normName(m?.name)}`;
}

/**
 * Collapse duplicates (same address in different casing, the same actor added
 * twice). First occurrence wins; a later one donates missing hints/name.
 * @param {Array<object>} list
 * @returns {Array<object>}
 */
export function dedupeMembers(list) {
  const out = [];
  const seen = new Map();
  for (const raw of list ?? []) {
    if (!raw) continue;
    const m = makeMember(raw);
    const k = memberKey(m);
    if (!k || k === 'name:') continue;
    const prev = seen.get(k);
    if (prev) {
      if (!prev.name && m.name) prev.name = m.name;
      if (!prev.hint.actorId && m.hint.actorId) prev.hint.actorId = m.hint.actorId;
      if (!prev.hint.contactId && m.hint.contactId) prev.hint.contactId = m.hint.contactId;
      continue;
    }
    seen.set(k, m);
    out.push(m);
  }
  return out;
}

/**
 * Everyone on the message who is not `self`.
 * @param {Array<object>} participants
 * @param {Set<string>} self   from selfKeys()
 * @returns {Array<object>}
 */
export function othersFor(participants, self) {
  const mine = self instanceof Set ? self : new Set(self || []);
  return (participants ?? []).filter((p) => {
    for (const k of memberKeys(p)) if (mine.has(k)) return false;
    return true;
  });
}

/**
 * Resolve a member against a world. Order, by design:
 *   1. hint by id — the most precise thing INSIDE one world; survives renames
 *      and address edits. If that document's current address differs from the
 *      stored one, the member is reported `stale` (rewrite on the next save).
 *   2. address — the directory entry (and its linked actor) or an actor whose
 *      address flag matches. The path an IMPORTED member takes.
 *   3. name — space/punctuation-insensitive, so the editor can offer to re-pin.
 *   4. unresolved.
 *
 * @param {object} member
 * @param {object} world  adapter:
 *   getActor(id) → {id, name, email}|null · getContact(id) → {id, name, email, actorId}|null
 *   contactByEmail(email) → contact|null · actorByEmail(email) → actor|null
 *   contactsByName(key) → contact[] · actorsByName(key) → actor[]
 * @returns {{resolvedBy: 'hint'|'email'|'name'|null, actorId: string, contactId: string, email: string, name: string, stale: boolean}}
 */
export function resolveMember(member, world) {
  const m = makeMember(member || {});
  const out = { resolvedBy: null, actorId: '', contactId: '', email: m.email, name: m.name, stale: false };
  const w = world || {};
  const fromContact = (c, by) => {
    out.resolvedBy = by; out.contactId = c.id || ''; out.actorId = c.actorId || '';
    out.name = c.name || m.name; out.email = normalizeEmail(c.email) || m.email;
    out.stale = !!(m.email && normalizeEmail(c.email) && normalizeEmail(c.email) !== m.email);
    return out;
  };
  const fromActor = (a, by) => {
    out.resolvedBy = by; out.actorId = a.id || ''; out.name = a.name || m.name;
    const ae = normalizeEmail(a.email);
    out.email = ae || m.email;
    out.stale = !!(m.email && ae && ae !== m.email);
    return out;
  };

  // 1. hints
  if (m.hint.contactId) { const c = w.getContact?.(m.hint.contactId); if (c) return fromContact(c, 'hint'); }
  if (m.hint.actorId) { const a = w.getActor?.(m.hint.actorId); if (a) return fromActor(a, 'hint'); }
  // 2. address
  if (m.email) {
    const c = w.contactByEmail?.(m.email); if (c) return fromContact(c, 'email');
    const a = w.actorByEmail?.(m.email); if (a) return fromActor(a, 'email');
  }
  // 3. name
  const key = normName(m.name);
  if (key) {
    const cs = w.contactsByName?.(key) || []; if (cs.length === 1) return fromContact(cs[0], 'name');
    const as = w.actorsByName?.(key) || []; if (as.length === 1) return fromActor(as[0], 'name');
  }
  // 4. unresolved — a raw address is still sendable as an address
  return out;
}

/**
 * The live-Foundry adapter for resolveMember. Reads lazily so a sim can
 * substitute its own object.
 * @returns {object}
 */
export function worldAdapter() {
  const g = globalThis.game;
  const master = g?.nightcity?.masterContactService;
  const emailOf = (a) => (a?.getFlag ? (a.getFlag('night-city-messenger', 'email') || '') : (a?.email || ''));
  const actorRec = (a) => (a ? { id: a.id, name: a.name, email: emailOf(a) } : null);
  const all = () => (g?.actors?.contents ?? g?.actors ?? []);
  return {
    getActor: (id) => actorRec(g?.actors?.get?.(id)),
    getContact: (id) => master?.getContact?.(id) || null,
    contactByEmail: (e) => master?.getByEmail?.(e) || null,
    actorByEmail: (e) => { const n = normalizeEmail(e); return actorRec([...all()].find((a) => normalizeEmail(emailOf(a)) === n)); },
    contactsByName: (k) => (master?.getAll?.() || []).filter((c) => normName(c.name) === k),
    actorsByName: (k) => [...all()].filter((a) => normName(a.name) === k).map(actorRec),
  };
}
