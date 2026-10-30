/**
 * IDENTITIES — one person, several addresses (2026-10-26).
 *
 * Tester: "can one actor have multiple email addresses / aliases?" Rather than a
 * second address system, an identity is just a GM master contact in the same
 * GROUP as others:
 *   · a CHARACTER's identities = every contact linked to it (`contact.actorId`).
 *     Mail to any of them already lands in the character's inbox
 *     (MessageService._resolveRecipient).
 *   · a contact-only NPC's identities = the NPC's contact plus every contact
 *     pointing at it with `identityOf: <that contact's id>`. Mail to such an
 *     alias is routed into the NPC's own inbox (`identityInboxId`).
 * This module is the pure bookkeeping: grouping, which identity is MAIN, which
 * are aliases, how much each is used. No Foundry globals — the sims drive it.
 *
 * Words: the contact field `alias` is the display subtitle ("Alias / Subtitle");
 * these are IDENTITIES. The UI says "main" / "alias of …" / "Also known as".
 * Main = the contact flagged `primaryIdentity`, else (a character) the first
 * linked one / (a contact-only NPC) the contact the aliases point at.
 */

/**
 * The group a contact belongs to: `a:<actorId>` for a character's identities,
 * `c:<rootContactId>` for a contact-only NPC that has (or is) an alias, else null.
 */
export function groupKeyOf(contacts, c) {
  if (!c) return null;
  if (c.actorId) return `a:${c.actorId}`;
  if (c.identityOf) {
    const root = (contacts || []).find((x) => x.id === c.identityOf);
    if (root?.actorId) return `a:${root.actorId}`;   // an alias pointed at a character's contact
    return `c:${c.identityOf}`;
  }
  if ((contacts || []).some((x) => x.identityOf === c.id)) return `c:${c.id}`;
  return null;
}

/** Every contact in a group, main first (stable order otherwise). */
export function identitiesOfKey(contacts, key) {
  if (!key) return [];
  const list = (contacts || []).filter((c) => groupKeyOf(contacts, c) === key);
  const rootId = key.startsWith('c:') ? key.slice(2) : null;
  const flagged = list.filter((c) => c.primaryIdentity);
  const main = flagged[0] || (rootId && list.find((c) => c.id === rootId)) || list[0];
  return main ? [main, ...list.filter((c) => c !== main)] : [];
}

/** Every contact linked to this character, main first. */
export function identitiesOf(contacts, actorId) {
  return actorId ? identitiesOfKey(contacts, `a:${actorId}`) : [];
}

/** Every identity in this contact's group (just itself when it has none). */
export function identitiesOfContact(contacts, c) {
  const key = groupKeyOf(contacts, c);
  return key ? identitiesOfKey(contacts, key) : (c ? [c] : []);
}

/** The main identity of a character (or null). */
export function primaryOf(contacts, actorId) {
  return identitiesOf(contacts, actorId)[0] || null;
}

/**
 * Where this contact sits among its identities, or null when it is in no group
 * or is the group's only member.
 * @returns {{key: string, actorId: string|null, isPrimary: boolean, isAlias: boolean, primary: object, count: number}|null}
 */
export function identityRole(contacts, contact) {
  const key = groupKeyOf(contacts, contact);
  if (!key) return null;
  const ids = identitiesOfKey(contacts, key);
  if (ids.length < 2) return null;
  const primary = ids[0];
  const isPrimary = primary.id === contact.id;
  return { key, actorId: key.startsWith('a:') ? key.slice(2) : null, isPrimary, isAlias: !isPrimary, primary, count: ids.length };
}

/**
 * Does a player's own contact entry stand for this directory contact? An entry is ONE identity: matched by its
 * directory id, else by its address. Only an entry with neither (a hand-made link) falls back to the linked
 * character — and then only for the MAIN identity. Matching every identity by the shared character (the old rule)
 * made sharing a main address mark each alias as known, and refused sharing an alias to someone who held the main.
 * @param {object} entry   — a player's contact (masterContactId?, email?, actorId?, linkedActorId?)
 * @param {object} contact — a directory contact
 * @param {{isAlias?: boolean}} [o] — whether the contact is an alias (not the main identity) of its character
 */
export function entryStandsFor(entry, contact, { isAlias = false } = {}) {
  if (!entry || !contact) return false;
  if (entry.masterContactId && entry.masterContactId === contact.id) return true;
  const a = String(contact.email || '').trim().toLowerCase();
  const b = String(entry.email || '').trim().toLowerCase();
  if (a && b) return a === b;
  if (entry.masterContactId) return false;   // it names another directory entry
  if (isAlias || !contact.actorId) return false;
  return entry.actorId === contact.actorId || entry.linkedActorId === contact.actorId;
}

/**
 * The CONTACT INBOX an alias's mail belongs in — the root NPC contact of a
 * contact-only group. Null for a character's identities (they use the
 * character's inbox) and for a contact in no group (its own inbox, as ever).
 */
export function identityInboxId(contacts, c) {
  const key = groupKeyOf(contacts, c);
  return key && key.startsWith('c:') ? key.slice(2) : null;
}

/** "alias of Lucky Lin" for an alias, '' otherwise. */
export function aliasLabel(contacts, contactId, primaryName = '') {
  const c = (contacts || []).find((x) => x.id === contactId);
  const role = identityRole(contacts, c);
  if (!role?.isAlias) return '';
  return `alias of ${primaryName || role.primary.name || 'their main identity'}`;
}

/**
 * VOICE — "how this NPC talks" (2026-10-28), a GM-only master-contact field
 * (`contact.voice`, never copied to players). An alias speaks like its main
 * identity unless it has a voice of its own; a contact-only NPC's alias inherits
 * the root's. Returns the text, and where it came from.
 * @returns {{text: string, own: boolean, inherited: boolean, from: object|null}}
 *   `from` = the identity the text was inherited from (null when own / none).
 */
export function voiceInfo(contacts, contact) {
  const own = String(contact?.voice ?? '').trim();
  if (own) return { text: own, own: true, inherited: false, from: null };
  const role = identityRole(contacts, contact);
  const main = role?.isAlias ? role.primary : null;
  const theirs = String(main?.voice ?? '').trim();
  if (theirs) return { text: theirs, own: false, inherited: true, from: main };
  return { text: '', own: false, inherited: false, from: null };
}

/** The voice to use for this contact: its own, else its main identity's, else ''. */
export function voiceFor(contacts, contact) {
  return voiceInfo(contacts, contact).text;
}

/**
 * How much each identity is used, from the person's own mailbox. A message
 * counts for the identity it names (`toContactId` on mail it received,
 * `fromContactId` on mail it sent); one that names none is the main identity's.
 * @param {object[]} messages the person's inbox messages (received + sent copies)
 * @param {object[]} identities identitiesOf(...) / identitiesOfContact(...)
 * @returns {Map<string, {count: number, last: string}>} by contact id
 */
export function identityUsage(messages, identities) {
  const ids = new Set((identities || []).map((c) => c.id));
  const main = identities?.[0]?.id || null;
  const out = new Map((identities || []).map((c) => [c.id, { count: 0, last: '' }]));
  for (const m of messages || []) {
    if (!m || m.status?.deleted) continue;
    const named = m.status?.sent ? m.fromContactId : m.toContactId;
    const id = ids.has(named) ? named : main;
    if (!id) continue;
    const row = out.get(id);
    row.count += 1;
    if (m.timestamp && (!row.last || m.timestamp > row.last)) row.last = m.timestamp;
  }
  return out;
}

/**
 * The contact a reply should be SENT AS: the identity the original was addressed
 * to, when it belongs to the replier — a character (`replier` = actor id, or
 * `{actorId}`) or a contact-only NPC (`{contactId}`). Otherwise null.
 */
export function replyIdentity(contacts, original, replier) {
  const r = typeof replier === 'string' ? { actorId: replier } : (replier || {});
  const c = (contacts || []).find((x) => x.id === original?.toContactId);
  if (!c) return null;
  if (r.actorId && c.actorId === r.actorId) return c;
  if (r.contactId) {
    const me = (contacts || []).find((x) => x.id === r.contactId);
    const key = groupKeyOf(contacts, me);
    if (key && key === groupKeyOf(contacts, c)) return c;
  }
  return null;
}
