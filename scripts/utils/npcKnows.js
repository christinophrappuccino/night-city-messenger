/**
 * Who an NPC knows — the NPC's own contact list (2026-10-30, dev: "I should be able to share NPC contacts with other
 * NPC contacts"; both directions, for every NPC, with or without an actor).
 * @file scripts/utils/npcKnows.js
 * @module night-city-messenger
 * @description Pure (no Foundry globals). An NPC's list is the field `knows` (directory contact ids) on its directory
 *   entry — on the MAIN identity of its group, so an alias shares its main's list (the identities rule, identities.js).
 *   It names specific identities: knowing an alias says nothing about its main. Players' characters keep their own
 *   lists on their actors as before (ContactRepository); this is the NPC side only.
 */

import { identitiesOfContact } from './identities.js';

/** The most ids a list keeps (a sanity cap — a list is a handful in practice). */
export const KNOWS_MAX = 500;

/** A stored `knows` value made safe: unique non-empty strings, capped. */
export function sanitizeKnows(v) {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((x) => typeof x === 'string' && x))].slice(0, KNOWS_MAX);
}

/** The directory entry that holds an NPC's list: the main identity of its group (or the contact itself). */
export function knowsHolder(contacts, c) {
  if (!c) return null;
  return identitiesOfContact(contacts || [], c)[0] || c;
}

/** The ids of an NPC's own identities (it never "knows" itself). */
export function ownIds(contacts, c) {
  return new Set(identitiesOfContact(contacts || [], c).map((x) => x.id));
}

/** The contact ids an NPC knows, oldest share first — deleted contacts and its own identities left out. */
export function knowsOf(contacts, c) {
  const holder = knowsHolder(contacts, c);
  if (!holder) return [];
  const own = ownIds(contacts, c);
  const exists = new Set((contacts || []).map((x) => x.id));
  return sanitizeKnows(holder.knows).filter((id) => exists.has(id) && !own.has(id));
}

/** Does this NPC know that contact? */
export function npcKnows(contacts, npc, target) {
  return !!(npc && target) && knowsOf(contacts, npc).includes(target.id);
}

/**
 * The NPCs (their main identities) that know a contact — never the contact's own group, never a non-NPC
 * (`isNpc(c)` decides; the tab passes "not a player's character").
 */
export function knownByNpcs(contacts, target, isNpc = () => true) {
  if (!target) return [];
  const own = ownIds(contacts, target);
  return (contacts || []).filter((c) => !own.has(c.id) && isNpc(c) && knowsHolder(contacts, c)?.id === c.id
    && sanitizeKnows(c.knows).includes(target.id));
}

/** A list with one id switched on or off. */
export function withKnows(list, id, on) {
  const s = new Set(sanitizeKnows(list));
  if (on) s.add(id); else s.delete(id);
  return [...s];
}
