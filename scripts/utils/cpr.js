/**
 * The Cyberpunk RED system's data — the ONE place NCM knows its shapes (stage 2, step 10b).
 * @file scripts/utils/cpr.js
 * @module night-city-messenger
 *
 * NCM runs on the `cyberpunk-red-core` system and reads its documents directly: actor and item TYPES, the role item,
 * stats, money, item price. When the system changes a shape (its own Foundry v13 release is the likely moment), the
 * fix should be here, not in forty files. Callers ask these readers; `dev/tools/sims/test-cpr-adapter.mjs` fails when
 * a file outside this one (and the few owners listed there) reads one of these shapes directly.
 *
 * Owners that stay where they are, on purpose:
 *   - skills and role-ability ranks: `SkillService` (`_readSkillData` / `_readRoleAbility`) — already the one reader,
 *     with the rank-vs-stat rules the rolls depend on;
 *   - writing money: `utils/wealth.js` (the ledger format it writes is CPR's).
 *
 * Every reader tolerates a missing / foreign shape (another system, an empty actor) and returns a neutral value.
 */

/** The system NCM is built for. */
export const CPR_SYSTEM_ID = 'cyberpunk-red-core';

// ─── Types ──────────────────────────────────────────────────────────────────
/** Actor types that are not people: no inbox, no contacts, never an operator (Black ICE, Demons, containers). */
export const NON_PERSON_ACTOR_TYPES = new Set(['blackIce', 'black-ice', 'demon', 'container']);
/** Item types that are a character's abilities, not gear — a shard can't be written onto them. */
export const NON_CARRIER_ITEM_TYPES = new Set(['skill', 'role', 'criticalInjury', 'netarch']);

/**
 * Is this actor a Black ICE program? The system's type, NCM's own flag, or a name that says so ("Black ICE",
 * "BlackICE"). One rule — it was copied ten times, two of them with a looser name match than the rest.
 * @param {Actor} actor
 */
export function isBlackIceActor(actor) {
  if (!actor) return false;
  return actor.type === 'blackIce' || actor.type === 'black-ice'
    || !!actor.getFlag?.('night-city-messenger', 'isBlackICE')
    || /black\s*ice/i.test(actor.name || '');
}

/** Every Black ICE actor in the world. */
export function blackIceActors() {
  return (globalThis.game?.actors?.filter?.(isBlackIceActor)) ?? [];
}

/** The item types the system defines (for "make a new item" choices), without Foundry's placeholder `base`. */
export function itemTypes() {
  const g = globalThis.game;
  return (g?.documentTypes?.Item || g?.system?.documentTypes?.Item || []).filter((t) => t !== 'base');
}

// ─── Roles ──────────────────────────────────────────────────────────────────
/** The actor's role items (CPR keeps a character's role as an embedded item, not a field). */
export function roleItems(actor) {
  const items = actor?.items;
  const isRole = (i) => i?.type === 'role';
  if (!items) return [];
  if (typeof items.filter === 'function') return [...items.filter(isRole)];         // a Foundry Collection or an array
  if (typeof items[Symbol.iterator] === 'function') return [...items].filter(isRole);
  return [];
}
/** The actor's first role item, or null. */
export function firstRole(actor) {
  const items = actor?.items;
  if (items && typeof items.find === 'function') return items.find((i) => i?.type === 'role') || null;
  return roleItems(actor)[0] || null;
}
/** The actor's first role's name, or ''. */
export function roleName(actor) { return firstRole(actor)?.name || ''; }
/** A role item's rank (the system stores it as `system.rank`; older data `system.value`). */
export function roleRank(roleItem) { return Number(roleItem?.system?.rank ?? roleItem?.system?.value ?? 0) || 0; }

// ─── Stats ──────────────────────────────────────────────────────────────────
/** A Black ICE / Demon actor's ATK stat (a plain number on those types), 0 when missing. */
export function iceAttack(actor) { return actor?.system?.stats?.atk ?? 0; }
/** The same, but null when the actor has no ATK at all (to tell "ATK 0" from "no ATK"). */
export function iceAttackOrNull(actor) { return actor?.system?.stats?.atk ?? null; }
/** A Black ICE actor's class (`system.class`, e.g. "Anti-Personnel"), undefined when missing. */
export function iceClass(actor) { return actor?.system?.class; }
/** The actor's Luck: `{ value, max }` (both 0 when missing). */
export function luckOf(actor) {
  const l = actor?.system?.stats?.luck;
  return { value: Number(l?.value) || 0, max: Number(l?.max ?? l?.value) || 0 };
}

// ─── Money and price ────────────────────────────────────────────────────────
/** The actor's eddies balance (`system.wealth.value`), 0 when missing. Writing money goes through utils/wealth.js. */
export function wealthBalance(actor) { return actor?.system?.wealth?.value ?? 0; }
/** The actor's wealth ledger lines (`[[description, reason], …]`), [] when missing. */
export function wealthLedger(actor) { const t = actor?.system?.wealth?.transactions; return Array.isArray(t) ? t : []; }
/** Does the actor have a wealth block at all? (A non-CPR actor, or a type without money, does not.) */
export function hasWealth(actor) { return !!actor?.system?.wealth; }
/** Where CPR keeps an item's market price — the update path for writing it. */
export const PRICE_PATH = 'system.price.market';
/** An item's market price (`system.price.market`), or `fallback`. */
export function marketPrice(item, fallback = 0) { return item?.system?.price?.market ?? fallback; }
