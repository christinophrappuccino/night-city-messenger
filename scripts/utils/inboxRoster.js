/**
 * Every inbox a GM can open, as one list: the identity drawer and Character Select both read it.
 * @file scripts/utils/inboxRoster.js
 * @module night-city-messenger
 * @description One row per MAILBOX, not per name. A character's aliases and an NPC's aliases share one inbox, so they make that row
 *   searchable rather than adding rows. An NPC with no character sheet has an inbox keyed by its directory id; openInbox and
 *   MessageRepository.getInboxJournal both take either id. buildInboxRoster is pure; gmInboxRoster reads the world.
 */

import { MODULE_ID } from './constants.js';
import { groupKeyOf, identitiesOfContact, identityRole } from './identities.js';
import { getPlayerCharacters, isSelectableCharacter } from './helpers.js';
import { MessageRepository } from '../data/MessageRepository.js';
import { memoByRevision } from './mailRevision.js';

export const ROSTER_GROUPS = [['player', 'Player characters'], ['npc', 'NPCs'], ['system', 'System addresses']];
export const RECENT_INBOXES = 5;
const usable = (img) => (img && !/mystery-man/.test(img) ? img : '');

/**
 * @param {object} w
 * @param {Array<{actorId, name, img, email, playerName}>} w.players - the players' characters
 * @param {Array<{id, name, img, email}>} w.npcActors - NPC actors a GM may open
 * @param {Array} w.contacts - the master directory
 * @param {(c: object) => boolean} [w.isSendOnly]
 * @param {Map<string, {unread: number, total: number}>} [w.mail] - by inbox owner id
 * @returns {Array<{id, name, img, email, kind, sub, aliases, unread, total, search}>}
 */
export function buildInboxRoster({ players = [], npcActors = [], contacts = [], isSendOnly = () => false, mail = new Map() }) {
  const rows = new Map();
  const add = (row) => {
    const m = mail.get(row.id) || {};
    rows.set(row.id, { aliases: [], ...row, unread: m.unread || 0, total: m.total || 0 });
  };
  for (const p of players) add({ id: p.actorId, name: p.name, img: usable(p.img), email: p.email || '', kind: 'player', sub: p.playerName || '' });
  const npcById = new Map(npcActors.map((a) => [a.id, a]));
  const seen = new Set();
  for (const c of contacts) {
    // A contact with no aliases is in no group, and is its own mailbox.
    const key = groupKeyOf(contacts, c) || `c:${c.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const group = identitiesOfContact(contacts, c);
    const main = group.find((x) => !identityRole(contacts, x)?.isAlias) || c;
    const aliases = group.filter((x) => x !== main);
    const actorId = key.startsWith('a:') ? key.slice(2) : null;
    if (actorId) {
      // A player's aliases search their row. An actor that is neither a player's nor an NPC we may list (hidden, deleted) is left out.
      if (rows.has(actorId)) { rows.get(actorId).aliases = aliases.map((x) => x.name); rows.get(actorId).aliasMail = aliases.map((x) => x.email || ''); continue; }
      const actor = npcById.get(actorId);
      if (!actor) continue;
      add({ id: actorId, name: main.name, img: usable(main.portrait) || usable(actor.img), email: main.email || actor.email || '', kind: 'npc', sub: main.role || '', aliases: aliases.map((x) => x.name), aliasMail: aliases.map((x) => x.email || '') });
    } else {
      const root = key.startsWith('c:') ? key.slice(2) : main.id;
      add({ id: root, name: main.name, img: usable(main.portrait), email: main.email || '', kind: isSendOnly(main) ? 'system' : 'npc', sub: main.role || '', aliases: aliases.map((x) => x.name), aliasMail: aliases.map((x) => x.email || '') });
    }
  }
  for (const a of npcActors) if (!rows.has(a.id)) add({ id: a.id, name: a.name, img: usable(a.img), email: a.email || '', kind: 'npc', sub: '' });
  const out = [...rows.values()];
  for (const r of out) r.search = [r.name, r.email, r.sub, ...r.aliases, ...(r.aliasMail || [])].join(' ').toLowerCase();
  return out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/** Most recent first, no repeats, capped. */
export function pushRecentInbox(list, id, cap = RECENT_INBOXES) {
  const had = Array.isArray(list) ? list : [];
  return id ? [id, ...had.filter((x) => x !== id)].slice(0, cap) : had;
}

/** Each inbox's mail counts, read once per list rather than once per row. */
function mailCounts() {
  const out = new Map();
  for (const j of game.journal ?? []) {
    const info = MessageRepository.identifyInbox(j);
    if (!info) continue;
    const m = { unread: 0, total: 0 };
    for (const p of j.pages) {
      const f = p.flags?.[MODULE_ID];
      if (!f?.messageId || f.status?.deleted || f.status?.spam) continue;
      m.total++;
      if (!f.status?.read && !f.status?.sent) m.unread++;
    }
    out.set(info.ownerId, m);
  }
  return out;
}

const ROSTER_MEMO = {};

/**
 * The world's roster. GM only: a player's list stays the characters they own. Remembered until mail, an actor, a
 * user or the directory changes (audit PERF-06: with the Switch-inbox drawer open, every viewer render walked all mail).
 */
export function gmInboxRoster() {
  return memoByRevision(ROSTER_MEMO, 'roster', null, gmInboxRosterNow);
}

function gmInboxRosterNow() {
  const flagMail = (a) => a?.getFlag?.(MODULE_ID, 'email') || '';
  const mcs = game.nightcity?.masterContactService;
  const players = getPlayerCharacters().map((p) => ({ actorId: p.actorId, name: p.actorName, img: p.actor?.img, email: flagMail(p.actor), playerName: p.playerName }));
  const pcIds = new Set(players.map((p) => p.actorId));
  const npcActors = (game.actors?.contents || []).filter((a) => isSelectableCharacter(a) && !a.hasPlayerOwner && !pcIds.has(a.id)).map((a) => ({ id: a.id, name: a.name, img: a.img, email: flagMail(a) }));
  return buildInboxRoster({ players, npcActors, contacts: mcs?.getAll?.() || [], isSendOnly: (c) => !!c.sendOnly || !!mcs?.isSendOnly?.(c.email), mail: mailCounts() });
}
