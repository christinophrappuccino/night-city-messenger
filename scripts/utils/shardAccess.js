/**
 * Shard relays: may this player act on this shard? (audit SEC-05, batch A3b)
 * @file scripts/utils/shardAccess.js
 * @module night-city-messenger
 *
 * A player hacks shards they do not own on purpose: a shard that arrives as a message attachment
 * is a WORLD item left at None so it stays out of the Items sidebar (2026-10-21), and access
 * points hand out ways into shards the player has no rights on. So "the player can see the item"
 * is not the rule. A player can REACH a shard when:
 *   - they can see the item (Limited or better), or
 *   - it is in the gear of a character they own, or
 *   - it is attached to a message they can read, or
 *   - the GM gave them a way in that they can see: a map pin or step-on area that is not hidden,
 *     a chat card they can see, a journal link in a page they can read, or a macro they own.
 * The GM-side handlers for SHARD_STATE_REQUEST and SHARD_INTEGRITY_REQUEST check this, so a
 * modified client can no longer unlock, wipe or repair a shard it was never given.
 *
 * Sim: dev/tools/sims/test-shard-relays.mjs.
 */

import { MODULE_ID, DEFAULTS, FAILURE_MODES } from './constants.js';

const LEVEL = (name, fallback) => globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.[name] ?? fallback;
const flag = (doc, key) => doc?.getFlag?.(MODULE_ID, key) ?? doc?.flags?.[MODULE_ID]?.[key];
const each = (coll) => (coll?.contents ?? (coll ? [...coll] : []));

/** Can this user see this chat message? (Public, whispered to them, or theirs.) */
function seesMessage(msg, user) {
  const whisper = msg.whisper ?? [];
  return !whisper.length || whisper.includes(user.id) || (msg.author?.id ?? msg.user?.id) === user.id;
}

/**
 * Where a player could have got into this shard or terminal. GM-side; a full scan, but it only
 * runs for a relayed request, never per render. Terminals use the same rule (batch A3c): a
 * world terminal is reached through a map pin, a step-on area, a chat card, a link or a macro.
 * @param {string} userId the server-verified sender
 * @param {Item} item the shard or terminal
 * @param {'shard'|'terminal'} [kind] the access-point kind its links use
 * @returns {boolean}
 */
export function userCanReachItem(userId, item, kind = 'shard') {
  const user = userId ? globalThis.game?.users?.get(userId) : null;
  if (!user || !item) return false;
  if (user.isGM) return true;
  if (item.testUserPermission?.(user, LEVEL('LIMITED', 1))) return true;
  const owner = item.parent;
  if (owner?.documentName === 'Actor' || owner?.items) {
    if (owner.testUserPermission?.(user, LEVEL('OWNER', 3))) return true;
  }
  const uuid = item.uuid, id = item.id, worldItem = !owner;
  const OBSERVER = LEVEL('OBSERVER', 2);
  const game = globalThis.game;

  // Attached to a message they can read.
  for (const j of each(game.journal)) {
    for (const p of each(j.pages)) {
      const atts = flag(p, 'attachments');
      if (!Array.isArray(atts) || !atts.length) continue;
      if (!atts.some((a) => a && (a.itemUuid === uuid || (worldItem && a.itemId === id)))) continue;
      if (p.testUserPermission?.(user, OBSERVER)) return true;
    }
  }
  // A map pin or step-on area that is not hidden.
  for (const s of each(game.scenes)) {
    for (const n of each(s.notes)) {
      if ((flag(n, 'accessUuid') === uuid || flag(n, 'terminalItemUuid') === uuid) && !flag(n, 'accessHidden')) return true;
    }
    for (const r of each(s.regions)) {
      if (flag(r, 'access')?.id === uuid && !flag(r, 'accessHidden')) return true;
    }
  }
  // A chat card they can see.
  for (const m of each(game.messages)) {
    if (flag(m, 'access')?.id === uuid && seesMessage(m, user)) return true;
  }
  // A journal link in a page they can read.
  const link = `@NCM[${kind}:${uuid}]`;
  for (const j of each(game.journal)) {
    for (const p of each(j.pages)) {
      if (String(p.text?.content ?? '').includes(link) && p.testUserPermission?.(user, OBSERVER)) return true;
    }
  }
  // A macro they own (the hotbar access macro).
  for (const mac of each(game.macros)) {
    if (flag(mac, 'access')?.id === uuid && mac.testUserPermission?.(user, LEVEL('OWNER', 3))) return true;
  }
  return false;
}

/** A shard: see userCanReachItem. */
export const userCanReachShard = (userId, item) => userCanReachItem(userId, item, 'shard');

/** The session fields a relayed write may set, each with its type. Anything else is dropped. */
export function sanitizeSessionUpdates(updates) {
  const u = updates && typeof updates === 'object' ? updates : {};
  const out = {};
  const num = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0);
  for (const key of Object.keys(DEFAULTS.ACTOR_SESSION || {})) {
    if (!(key in u)) continue;
    const v = u[key];
    switch (key) {
      case 'loggedIn': case 'keyItemUsed': out[key] = !!v; break;
      case 'lockoutUntil': case 'layerLockoutUntil': out[key] = v === null ? null : num(v); break;
      case 'hackedLayers': out[key] = Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 10) : []; break;
      case 'layerHackAttempts': {
        const o = {};
        for (const [k, n] of Object.entries(v && typeof v === 'object' ? v : {})) if (/^[\w-]{1,30}$/.test(k)) o[k] = num(n);
        out[key] = o;
        break;
      }
      default: out[key] = num(v);
    }
  }
  return out;
}

/** Does this shard's own config make it wipe itself on failed hacks? */
export function shardCanSelfDestruct(config) {
  const c = config && typeof config === 'object' ? config : {};
  return c.failureMode === FAILURE_MODES.DESTROY || c.layerSecurity?.failureMode === FAILURE_MODES.DESTROY;
}
