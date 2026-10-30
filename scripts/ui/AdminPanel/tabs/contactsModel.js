/**
 * Admin → Contacts — the rules, kept pure so a sim can drive them.
 * @file scripts/ui/AdminPanel/tabs/contactsModel.js
 * @module night-city-messenger
 *
 * No Foundry globals in here. ContactsTab gathers the world (master contacts,
 * player characters, their contact lists, the mail) and hands plain objects in.
 */

import { groupKeyOf, identitiesOfKey, identityRole, entryStandsFor } from '../../../utils/identities.js';

/** Trust scale (the stored 0–5) with a token colour per level. */
export const TRUST_LEVELS = [
  // One meaning scale (bad → attn → neutral → good); Trusted is good, softened, so it never reads as a link.
  { v: 0, label: 'Unknown',            color: 'var(--ncm-text-hint, var(--ncm-text-muted))' },
  { v: 1, label: 'Suspicious',         color: 'var(--ncm-bad, var(--ncm-danger))' },
  { v: 2, label: 'Cautious',           color: 'var(--ncm-attn, var(--ncm-warning))' },
  { v: 3, label: 'Neutral',            color: 'var(--ncm-text-label, var(--ncm-text-secondary))' },
  { v: 4, label: 'Trusted',            color: 'color-mix(in oklab, var(--ncm-good, var(--ncm-success)) 62%, var(--ncm-text-label, var(--ncm-text-secondary)))' },
  { v: 5, label: 'Implicitly trusted', color: 'var(--ncm-good, var(--ncm-success))' },
];
export const trustInfo = (v) => TRUST_LEVELS[Math.max(0, Math.min(5, Number(v) || 0))];

/** The edit form's five sections (key, label, icon). */
export const EDIT_SECTIONS = [
  ['identity', 'Identity', 'fa-id-card'],
  ['addr', 'Addresses & aliases', 'fa-at'],
  ['security', 'Security & ICE', 'fa-lock'],
  ['trust', 'Trust', 'fa-handshake'],
  ['notes', 'Notes', 'fa-note-sticky'],
];

/** Which edit section owns a form field (dirty dots). */
export function sectionOfField(name) {
  const n = String(name || '');
  if (/^rel:|^trust$|^revealTrust$/.test(n)) return 'trust';
  if (/^(email|phone|sendOnly)$/.test(n)) return 'addr';
  if (/^(encrypted|encryptionDV|encryptionSkill|maxBreachAttempts|blackIce|blackIceDamage|ice\w*)$/.test(n)) return 'security';
  if (n === 'notes') return 'notes';
  return 'identity';
}

/** Directory filter chips. */
export const DIR_FILTERS = [
  ['all', 'All'], ['mail', 'Mail waiting'], ['unknown', 'Nobody knows'], ['alias', 'Aliases'],
  ['ice', 'Encrypted'], ['sys', 'System addresses'], ['check', 'Needs a look'],
];

/** Who-knows-whom filter chips. */
export const MX_FILTERS = [
  ['all', 'All'], ['none', 'Nobody knows'], ['some', 'Some know'], ['every', 'Everyone knows'], ['chg', 'Changed this session'],
];

export const lc = (s) => String(s || '').trim().toLowerCase();

/** Was this contact created by the "auto-register NPC senders" rule and not yet looked at? */
export function isAutoAdded(c) {
  return !!c && !c.reviewed && /^Auto-registered when the GM sent/.test(String(c.notes || ''));
}

/**
 * Does a player's own contact entry stand for this master contact? One identity per entry: its master id, else its
 * address; the linked character only for an entry with neither, and only for the main identity (utils/identities.js).
 * @param {{contacts?: object[]}} [o] — every master contact, so an alias is known as one
 */
export function playerEntryMatches(entry, contact, { contacts = null } = {}) {
  const isAlias = contacts ? !!identityRole(contacts, contact)?.isAlias : !!contact?.identityOf;
  return entryStandsFor(entry, contact, { isAlias });
}

/**
 * Index of who knows whom: { knows(contact, actorId), entriesFor(contact, actorId) }.
 * @param {Object<string, object[]>} listsByActor — each PC's `contacts` flag
 * @param {{contacts?: object[]}} [o] — every master contact (to tell an alias from its main)
 */
export function knowIndex(listsByActor, { contacts = null } = {}) {
  const lists = listsByActor || {};
  const match = (e, c) => playerEntryMatches(e, c, { contacts });
  return {
    entriesFor: (c, actorId) => (lists[actorId] || []).filter((e) => match(e, c)),
    knows: (c, actorId) => (lists[actorId] || []).some((e) => match(e, c)),
  };
}

/**
 * Issues worth a GM's look: an auto-added sender, a shared address.
 * @param {object} c the contact
 * @param {object[]} all every master contact
 * @param {Array<{id, name, email}>} actors person actors with an address (id, name, email flag)
 * @returns {Array<{kind: 'auto'|'dup', text: string, other?: string}>}
 */
export function needsALook(c, all, actors = []) {
  const out = [];
  if (isAutoAdded(c)) out.push({ kind: 'auto', text: 'Added automatically when you sent mail from this actor. Check the name and address players will see.' });
  const e = lc(c?.email);
  if (e) {
    const key = groupKeyOf(all, c);
    const twin = (all || []).find((x) => x.id !== c.id && lc(x.email) === e && !(key && groupKeyOf(all, x) === key));
    const actor = (actors || []).find((a) => lc(a.email) === e && a.id !== c.actorId);
    const other = twin?.name || actor?.name || '';
    if (other) out.push({ kind: 'dup', other, text: `${c.email} is also ${other}’s address — mail could land with either.` });
  }
  return out;
}

/** Text a search box matches against. */
export function haystack(c, extra = '') {
  return [c.name, c.email, c.organization, c.location, c.alias, c.notes, c.role, ...(c.tags || []), extra].map(lc).join(' ');
}

/**
 * Apply a directory filter. `facts(c)` → { mail, knownBy, ice, sys, check, alias }.
 */
export function passesFilter(key, f) {
  switch (key) {
    case 'mail': return f.mail > 0;
    case 'unknown': return f.knownBy === 0;
    case 'alias': return f.alias;
    case 'ice': return f.ice;
    case 'sys': return f.sys;
    case 'check': return f.check;
    default: return true;
  }
}

/** Pluralise a group heading ("Fixers", "Media", "Lawmen"). */
export function pluralRole(label) {
  const special = { Media: 'Media', Lawman: 'Lawmen', 'A.I.': 'A.I.', Gov: 'Government', Corp: 'Corp contacts' };
  if (special[label]) return special[label];
  return label.endsWith('s') ? label : `${label}s`;
}

/**
 * The directory list: groups of mains, each followed by its aliases. A contact
 * matching the filter brings its whole identity group along (an alias hit shows
 * its main, a main hit shows its aliases) so a character's burners are never
 * scattered.
 * @param {object[]} all every master contact
 * @param {(c) => boolean} hit filter + search pass
 * @param {(c) => string} groupOf group heading for a MAIN contact
 * @param {(a, b) => number} order row order inside a group
 * @returns {Array<{label: string, rows: Array<{c: object, alias: boolean}>}>}
 */
export function buildDirectory(all, hit, groupOf, order) {
  const list = all || [];
  const shownKeys = new Set();
  const shownIds = new Set();
  for (const c of list) {
    if (!hit(c)) continue;
    shownIds.add(c.id);
    const k = groupKeyOf(list, c);
    if (k) shownKeys.add(k);
  }
  const mainOf = (c) => { const k = groupKeyOf(list, c); return k ? identitiesOfKey(list, k)[0] : c; };
  const mains = [];
  const seen = new Set();
  for (const c of list) {
    const k = groupKeyOf(list, c);
    if (!(shownIds.has(c.id) || (k && shownKeys.has(k)))) continue;
    const m = mainOf(c);
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    mains.push(m);
  }
  const groups = new Map();
  for (const m of [...mains].sort(order)) {
    const g = groupOf(m);
    if (!groups.has(g)) groups.set(g, []);
    const k = groupKeyOf(list, m);
    const aliases = k ? identitiesOfKey(list, k).slice(1) : [];
    groups.get(g).push({ c: m, alias: false }, ...aliases.map((a) => ({ c: a, alias: true })));
  }
  return [...groups.entries()].map(([label, rows]) => ({ label, rows }));
}

/** Shift-click range in one matrix column: ids from a to b (inclusive) in display order. */
export function rangeIds(columnIds, fromId, toId) {
  const a = columnIds.indexOf(fromId), b = columnIds.indexOf(toId);
  if (a < 0 || b < 0) return [toId];
  return columnIds.slice(Math.min(a, b), Math.max(a, b) + 1);
}

/** Tally for one matrix group × character: { k, n, cls, all }. */
export function tally(rows, actorId, knows) {
  const k = rows.filter((c) => knows(c, actorId)).length;
  const n = rows.length;
  return { k, n, all: n > 0 && k === n, cls: n && k === n ? 'all' : k ? 'some' : '' };
}

/** Matrix row filter. */
export function mxPasses(key, knownCount, total, changed) {
  switch (key) {
    case 'none': return knownCount === 0;
    case 'some': return knownCount > 0 && knownCount < total;
    case 'every': return total > 0 && knownCount === total;
    case 'chg': return !!changed;
    default: return true;
  }
}

/**
 * Directory facets (the Filter picker): ids are `role:<id>`, `org:<name>` and `trust:<0-5>`;
 * an empty value means "none" (`role:` = no role, `org:` = no organization). Several picks of
 * one kind OR together; different kinds AND (Fixers or Execs, at Arasaka).
 */
export function facetKey(kind, c) {
  if (kind === 'role') return `role:${c.role || ''}`;
  if (kind === 'org') return `org:${(c.organization || '').trim()}`;
  return `trust:${Number(c.trust) || 0}`;
}
export function passesFacets(c, picked) {
  if (!picked?.length) return true;
  for (const kind of ['role', 'org', 'trust']) {
    const mine = picked.filter((k) => k.startsWith(kind + ':'));
    if (mine.length && !mine.includes(facetKey(kind, c))) return false;
  }
  return true;
}

// ─── Players → Who they know: the MODULES (mock dev/mockups/admin-who-they-know-modules-mock.html) ──
//
// Orbit (rings by how recently they talked), Role equaliser, Waiting, and the picked contact's card.
// Rows in: {id, name, role, roleLabel, roleIcon, days (null = never), waiting, mail}. Every module
// narrows the same list underneath: a ring and/or roles.

export const KN_RINGS = [['week', 'This week'], ['month', 'This month'], ['older', 'Longer ago'], ['never', 'Never written']];

/** Which ring a contact sits on: 0 this week · 1 this month · 2 longer · 3 never written. */
export function knRing(days) {
  if (days == null || !Number.isFinite(days)) return 3;
  return days <= 7 ? 0 : days <= 30 ? 1 : 2;
}

/** Does a row pass the module filters (a ring, and/or any of the picked roles)? */
export function knPasses(row, { ring = null, roles = [] } = {}) {
  if (ring != null && knRing(row.days) !== ring) return false;
  if (roles.length && !roles.includes(row.role || '')) return false;
  return true;
}

const r1 = (n) => Math.round(n * 10) / 10;

/** The orbit, the equaliser and the waiting list for one character's contacts. */
export function knownModules(rows = [], { size = 280, ring = null, roles = [], sel = null } = {}) {
  const R = size / 2 - 12;
  const radii = [0.36, 0.58, 0.79, 0.98].map((k) => r1(k * R));
  const core = 18;
  const inner = (i) => (i ? radii[i - 1] : core + 4);
  const annulus = (a, b) => `M ${-b} 0 A ${b} ${b} 0 1 0 ${b} 0 A ${b} ${b} 0 1 0 ${-b} 0 M ${-a} 0 A ${a} ${a} 0 1 1 ${a} 0 A ${a} ${a} 0 1 1 ${-a} 0 Z`;
  const byRing = [[], [], [], []];
  for (const r of rows) byRing[knRing(r.days)].push(r);
  const dots = [];
  byRing.forEach((list, ri) => {
    const mid = (inner(ri) + radii[ri]) / 2;
    list.forEach((r, i) => {
      const a = (i / list.length) * Math.PI * 2 + ri * 0.7 - Math.PI / 2;
      const s = r1(3.5 + Math.min(r.mail || 0, 18) / 3.2);
      dots.push({ id: r.id, name: r.name, role: r.role || '', hueKey: r.role ? 'role:' + r.role : '', x: r1(Math.cos(a) * mid), y: r1(Math.sin(a) * mid), r: s, wr: r1(s + 3.5),
        waiting: r.waiting || 0, dim: !knPasses(r, { ring, roles }), sel: r.id === sel,
        tip: `${r.name} — ${r.days == null ? 'never written' : r.days === 0 ? 'today' : r.days === 1 ? 'yesterday' : `${r.days} days ago`}${r.waiting ? ` · ${r.waiting} waiting` : ''}` });
    });
  });
  const rings = radii.map((r, i) => ({ i, r, label: KN_RINGS[i][1], n: byRing[i].length, on: ring === i, path: annulus(inner(i), r), ly: r1(-r + 10) }));

  const roleKeys = [...new Set(rows.map((r) => r.role || ''))].sort((a, b) => (!a) - (!b) || a.localeCompare(b));
  const max = Math.max(1, ...roleKeys.map((k) => rows.filter((r) => (r.role || '') === k).length));
  const bars = roleKeys.map((k) => {
    const list = rows.filter((r) => (r.role || '') === k);
    const first = list[0] || {};
    return { key: k, hueKey: k ? 'role:' + k : '', label: k ? (first.roleLabel || k) : 'No role', icon: k ? (first.roleIcon || 'fas fa-user') : 'fas fa-circle-question',
      n: list.length, h: Math.round((list.length / max) * 66) + 6, waiting: list.some((r) => r.waiting), on: roles.includes(k), dim: roles.length > 0 && !roles.includes(k) };
  });
  const waiting = rows.filter((r) => r.waiting).sort((a, b) => (a.days ?? 1e9) - (b.days ?? 1e9) || b.waiting - a.waiting);
  const sr = radii[3];
  return { size, half: size / 2, core, sweep: `M0 0 L ${sr} 0 A ${sr} ${sr} 0 0 1 ${r1(sr * Math.cos(0.55))} ${r1(sr * Math.sin(0.55))} Z`, rings, dots, bars, waiting, waitingTotal: waiting.reduce((n, r) => n + r.waiting, 0) };
}

// ─── Players → Groups they hold: the GROUP RACK (mock dev/mockups/admin-groups-held-modules-mock.html, option A) ──
// Every group a tile with a status light; your groups they don't hold as dashed push tiles.

export const GH_FILTERS = [['all', 'All'], ['you', 'From you'], ['own', 'Their own'], ['stale', 'Out of date'], ['gone', 'Yours deleted']];
const GH_ORDER = { stale: 0, gone: 1, sync: 2, own: 3 };

/** A held group's state: sync | stale | gone (your original deleted) | own (they made it). */
export function ghState(g) { return !g.fromYou ? 'own' : g.gone ? 'gone' : g.stale ? 'stale' : 'sync'; }

export function ghPasses(filter, state) {
  return filter === 'all' || (filter === 'you' && state !== 'own') || (filter === 'own' && state === 'own') || filter === state;
}

/** tiles in → { tiles (filtered + ordered), counts, filters } */
export function groupRack(tiles = [], filter = 'all') {
  const counts = { all: tiles.length, you: 0, own: 0, stale: 0, gone: 0 };
  for (const t of tiles) { if (t.state === 'own') counts.own++; else counts.you++; if (t.state === 'stale') counts.stale++; if (t.state === 'gone') counts.gone++; }
  const f = GH_FILTERS.some(([k]) => k === filter) && (filter === 'all' || counts[filter]) ? filter : 'all';
  return {
    filter: f, counts,
    tiles: tiles.filter((t) => ghPasses(f, t.state)).sort((a, b) => (GH_ORDER[a.state] - GH_ORDER[b.state]) || String(a.name).localeCompare(String(b.name))),
    filters: GH_FILTERS.map(([k, label]) => ({ k, label, n: counts[k], on: k === f, tone: k === 'stale' ? 'attn' : k === 'gone' ? 'bad' : '' })).filter((x) => x.k === 'all' || x.n),
  };
}

/** What changed between your group and their copy: keys added to yours since, keys you removed. */
export function ghDiff(masterKeys = [], copyKeys = []) {
  const m = new Set(masterKeys), c = new Set(copyKeys);
  return { added: masterKeys.filter((k) => !c.has(k)), removed: copyKeys.filter((k) => !m.has(k)) };
}

// ─── Directory → an NPC → Who's writing to them: the SWITCHBOARD ──
// (mock dev/mockups/admin-npc-orbit-mock.html, version C)
// The NPC is a hub split into one wedge per identity; every correspondent's line plugs
// into the wedge they wrote to. Distance = how much the NPC owes them: unanswered mail
// pulls a dot inside the "your turn" ring (longer wait = closer), answered people sit
// out in the "even" band, never-written contacts on the rim. Pure: rows in, geometry out.

const DAY_MS = 86400000;
export const SB = { size: 336, hubIn: 22, hubOut: 40, oweR: 108, evenR: 118, neverR: 140, labelGap: [245, 295] };
const rr = (n) => Math.round(n * 100) / 100;
const sbPt = (r, d) => [rr(Math.cos(d * Math.PI / 180) * r), rr(Math.sin(d * Math.PI / 180) * r)];
const sbNorm = (a) => ((a % 360) + 360) % 360;
const sbDist = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

/** "<1h" · "5h" · "3d" · "2w" — how long, short. */
export function sbAge(ms) {
  const m = Math.max(0, Number(ms) || 0);
  if (m < 3600000) return '<1h';
  if (m < DAY_MS) return `${Math.floor(m / 3600000)}h`;
  const d = Math.floor(m / DAY_MS);
  return d < 14 ? `${d}d` : d < 60 ? `${Math.round(d / 7)}w` : `${Math.round(d / 30)}mo`;
}

/** One annulus sector (degrees, SVG: 0 = right, 90 = down). A full turn is drawn as two halves. */
export function sbAnnulus(r0, r1, a0, a1) {
  if (a1 - a0 >= 359.9) {
    return `M ${-r1} 0 A ${r1} ${r1} 0 1 1 ${r1} 0 A ${r1} ${r1} 0 1 1 ${-r1} 0 Z M ${-r0} 0 A ${r0} ${r0} 0 1 0 ${r0} 0 A ${r0} ${r0} 0 1 0 ${-r0} 0 Z`;
  }
  const big = (a1 - a0) > 180 ? 1 : 0;
  const [x0, y0] = sbPt(r1, a0), [x1, y1] = sbPt(r1, a1), [x2, y2] = sbPt(r0, a1), [x3, y3] = sbPt(r0, a0);
  return `M ${x0} ${y0} A ${r1} ${r1} 0 ${big} 1 ${x1} ${y1} L ${x2} ${y2} A ${r0} ${r0} 0 ${big} 0 ${x3} ${y3} Z`;
}

/**
 * Per-correspondent facts from the mail rows: counts per identity, who wrote last,
 * and what is still unanswered (mail IN newer than the last mail OUT to them).
 * @param {Array} rows  { ts(ms), sent, ident, key, name, actorId, isPc, hueKey, subject, journalId, pageId, messageId, inboxId, spam }
 * @param {Array} knowers { key, name, actorId, isPc, hueKey } — characters who hold the contact (never-written rim)
 */
// A message the GM ticked in Messages → Needs a reply (npcMailAnswered, keyed by the BASE id —
// the -sent suffix stripped, the same rule as messagesModel.baseIdOf) counts as answered.
const sbBaseId = (id) => String(id || '').replace(/-sent$/, '');

export function sbPeople(rows = [], knowers = [], now = 0, answered = {}) {
  const by = new Map();
  const add = (k, base) => { if (!by.has(k)) by.set(k, { key: k, name: base.name || '?', actorId: base.actorId || '', isPc: !!base.isPc, hueKey: base.hueKey || '', msgs: [] }); return by.get(k); };
  for (const r of rows) {
    if (!r || r.spam || !r.key) continue;
    const p = add(r.key, r);
    if (r.isPc) p.isPc = true;
    if (!p.hueKey && r.hueKey) p.hueKey = r.hueKey;
    p.msgs.push(r);
  }
  for (const k of knowers) add(k.key, k);
  return [...by.values()].map((p) => {
    p.msgs.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    const lastOut = p.msgs.find((m) => m.sent);
    const waitMsgs = p.msgs.filter((m) => !m.sent && (!lastOut || (m.ts || 0) > (lastOut.ts || 0)) && !(answered && answered[sbBaseId(m.messageId)]));
    const perIdent = {};
    for (const m of p.msgs) perIdent[m.ident] = (perIdent[m.ident] || 0) + 1;
    const oldest = waitMsgs.length ? Math.min(...waitMsgs.map((m) => m.ts || 0)) : null;
    return {
      ...p, perIdent, count: p.msgs.length, waitMsgs, waiting: waitMsgs.length,
      waitMs: oldest == null ? 0 : Math.max(0, now - oldest),
      lastTs: p.msgs[0]?.ts || 0, lastDir: p.msgs.length ? (p.msgs[0].sent ? 'out' : 'in') : null,
    };
  });
}

/** How far out a correspondent sits: owed → inside the "your turn" ring, longer wait = closer. */
export function sbRadius(p, now = 0) {
  if (!p.count) return SB.neverR;
  if (p.waiting) {
    const pull = Math.min(1, 0.35 + 0.12 * p.waiting + 0.07 * (p.waitMs / DAY_MS));
    return rr(60 + (1 - pull) * 40);
  }
  const days = Math.max(0, (now - (p.lastTs || now)) / DAY_MS);
  return rr(SB.evenR + Math.min(1, days / 60) * 12);
}

/** Identity wedges: sized by mail share (never under 40°), the main identity centred on the left. */
export function sbWedges(identities = [], counts = {}) {
  const total = identities.reduce((n, i) => n + (counts[i.id] || 0), 0);
  const MIN = Math.min(40, 360 / Math.max(1, identities.length));
  const share = identities.map((i) => (total ? (counts[i.id] || 0) / total : 1 / Math.max(1, identities.length)));
  // Small identities are held at the minimum; the rest of the turn is shared by mail.
  const fixed = new Set();
  let spans = share.map((s) => s * 360);
  for (let guard = 0; guard < identities.length; guard++) {
    const low = spans.findIndex((s, n) => !fixed.has(n) && s < MIN);
    if (low < 0) break;
    fixed.add(low);
    const free = 360 - fixed.size * MIN;
    const rest = share.reduce((acc, s, n) => acc + (fixed.has(n) ? 0 : s), 0) || 1;
    spans = share.map((s, n) => (fixed.has(n) ? MIN : free * s / rest));
  }
  let a = 180 - (spans[0] || 360) / 2;
  return identities.map((i, n) => { const span = spans[n]; const w = { id: i.id, name: i.name, isAlias: n > 0, count: counts[i.id] || 0, a0: rr(a), a1: rr(a + span) }; a += span; return w; });
}

/** The angles a sector offers once padded and with the label gap at the top cut out. */
function sbArcs(a0, a1, pad = 8) {
  const s = a0 + pad, e = a1 - pad;
  if (e <= s) return [[(a0 + a1) / 2, (a0 + a1) / 2]];
  const [g0, g1] = SB.labelGap;
  const out = [];
  let cur = null;
  for (let x = s; x <= e + 1e-9; x += 1) {   // 1° steps: cheap, and robust across the 0/360 seam
    const inGap = sbNorm(x) >= g0 && sbNorm(x) <= g1;
    if (!inGap) { if (!cur) cur = [x, x]; else cur[1] = x; } else if (cur) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out.length ? out : [[(a0 + a1) / 2, (a0 + a1) / 2]];
}

/**
 * The whole module: wedges, every correspondent placed with its lines, the arrow for who
 * wrote last, who is owed a reply (`firstWaiting` = the longest wait) and the picked correspondent.
 * @param {object} o { identities:[{id,name}] (main first), rows, knowers, now, ident:'all'|id, sel:key|null }
 */
export function npcSwitchboard({ identities = [], rows = [], knowers = [], now = 0, ident = 'all', sel = null, answered = {} } = {}) {
  const ids = identities.length ? identities : [{ id: '', name: '?' }];
  const people = sbPeople(rows, knowers, now, answered);
  const counts = {};
  for (const p of people) for (const [k, n] of Object.entries(p.perIdent)) counts[k] = (counts[k] || 0) + n;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const wedges = sbWedges(ids, counts);
  const showIdent = (id) => ident === 'all' || ident === id;
  const dominant = (p) => {
    let best = ids[0].id, n = -1;
    for (const i of ids) { const c = p.perIdent[i.id] || 0; if (c > n) { n = c; best = i.id; } }
    return best;
  };
  // Place: each identity's sector holds the people who mostly wrote to it.
  const placed = new Map();
  for (const w of wedges) {
    const list = people.filter((p) => dominant(p) === w.id)
      .sort((a, b) => b.waitMs - a.waitMs || b.waiting - a.waiting || b.count - a.count || a.name.localeCompare(b.name));
    const arcs = sbArcs(w.a0, w.a1);
    const L = arcs.reduce((s, [x, y]) => s + (y - x), 0);
    list.forEach((p, i) => {
      let t = L ? ((i + 0.5) / list.length) * L : 0, a = arcs[0][0];
      for (const [x, y] of arcs) { if (t <= y - x) { a = x + t; break; } t -= (y - x); a = y; }
      placed.set(p.key, sbNorm(a));
    });
  }
  const many = people.length > 14;
  const out = people.map((p, i) => {
    const a = placed.get(p.key) ?? 180;
    const r = sbRadius(p, now) + (!p.waiting && p.count ? (i % 2 ? 4 : -4) : 0);
    const [x, y] = sbPt(r, a);
    const s = !p.count ? 5.5 : !p.isPc ? 5.5 : rr(6 + Math.min(p.count, 14) / 3.5);
    const shown = ident === 'all' || (p.perIdent[ident] || 0) > 0 || (!p.count && ident === ids[0].id);
    const links = [];
    for (const w of wedges) {
      const n = p.perIdent[w.id] || 0;
      if (!n || !showIdent(w.id)) continue;
      const inside = sbDist(a, (w.a0 + w.a1) / 2) <= (w.a1 - w.a0) / 2;
      const pa = inside ? a : (sbDist(a, w.a0) < sbDist(a, w.a1) ? w.a0 + 5 : w.a1 - 5);
      const [sx, sy] = sbPt(SB.hubOut, pa), [ex, ey] = sbPt(r - s - 2, a);
      const mid = sbDist(a, pa) > 30 ? sbNorm(a + (((pa - a + 540) % 360) - 180) / 2) : a;
      const [cx, cy] = sbPt((SB.hubOut + r) / 2 + 6, mid);
      const owe = p.waitMsgs.some((m) => m.ident === w.id);
      links.push({ d: `M ${sx} ${sy} Q ${cx} ${cy} ${ex} ${ey}`, tone: owe ? 'owe' : (w.isAlias ? 'alias' : 'main'), w: rr(1 + Math.min(n, 12) / 3.5) });
    }
    let arrow = null;
    if (p.lastDir) {
      const [ax, ay] = sbPt(r - s - (p.waiting ? 12 : 8), a);
      arrow = { tf: `translate(${ax} ${ay}) rotate(${rr(p.lastDir === 'in' ? a + 180 : a)})`, theirs: p.lastDir === 'in',
        tip: p.lastDir === 'in' ? `${p.name} wrote last — your turn` : `Answered — waiting on ${p.name}` };
    }
    const cxu = Math.cos(a * Math.PI / 180), cyu = Math.sin(a * Math.PI / 180), off = s + (p.waiting ? 11 : 7);
    const label = (!many || p.isPc || p.waiting)
      ? { x: rr(x + cxu * off), y: rr(y + cyu * off + (Math.abs(cxu) < 0.35 ? (cyu > 0 ? 4 : -4) : 0)), anchor: Math.abs(cxu) < 0.35 ? 'middle' : cxu > 0 ? 'start' : 'end' }
      : null;
    const days = p.count ? Math.max(0, (now - p.lastTs) / DAY_MS) : null;
    return {
      key: p.key, name: p.name, actorId: p.actorId, isPc: p.isPc, hueKey: p.hueKey,
      x, y, r: s, haloR: rr(s + 4.5), selR: rr(s + (p.waiting ? 9 : 5)), angle: rr(a), radius: rr(r),
      never: !p.count, count: p.count, waiting: p.waiting, waitMs: p.waitMs, waitLabel: p.waiting ? sbAge(p.waitMs) : '',
      // waiting pulls the colour toward amber; recency is brightness
      mix: p.waiting ? Math.max(20, Math.round(70 - (p.waitMs / DAY_MS) * 6)) : 100,
      bright: days == null ? 0.55 : days <= 7 ? 1 : days <= 30 ? 0.8 : 0.58,
      dim: !shown, sel: p.key === sel, links, arrow, label,
      tip: `${p.name}${p.waiting ? ` — ${p.waiting} waiting · ${sbAge(p.waitMs)}` : !p.count ? ' — has the contact, never written' : ''}`,
      perIdent: p.perIdent, msgs: p.msgs, waitMsgs: p.waitMsgs, lastDir: p.lastDir, lastTs: p.lastTs,
    };
  });
  // Who is owed a reply (on the shown identity), longest wait first — the default correspondent.
  const waiters = out.filter((p) => p.waiting && (ident === 'all' || p.waitMsgs.some((m) => m.ident === ident)))
    .sort((a, b) => b.waitMs - a.waitMs || b.waiting - a.waiting || a.name.localeCompare(b.name));
  const pick = out.find((p) => p.key === sel) || null;
  const [g1x, g1y] = sbPt(SB.oweR - 9, 270), [g2x, g2y] = sbPt(SB.oweR + 9, 270), [g3x, g3y] = sbPt(SB.neverR, 270);
  return {
    size: SB.size, half: SB.size / 2, hubIn: SB.hubIn, coreR: SB.hubIn - 2, oweR: SB.oweR, neverR: SB.neverR,
    guides: [{ x: g1x, y: g1y, text: 'Your turn', owe: true }, { x: g2x, y: g2y, text: 'Even' }, { x: g3x, y: g3y, text: 'Never written' }],
    wedges: wedges.map((w) => {
      const mid = (w.a0 + w.a1) / 2;
      const [lx, ly] = sbPt((SB.hubIn + SB.hubOut) / 2, mid);
      // the name runs along the wedge and never upside down
      const rot = sbNorm(mid) < 180 ? mid - 90 : mid + 90;
      return { ...w, d: sbAnnulus(SB.hubIn, SB.hubOut, w.a0, w.a1), lx, ly, rot: rr(rot), short: String(w.name).split(/\s+/)[0],
        on: ident === w.id, dim: ident !== 'all' && ident !== w.id, labelFits: (w.a1 - w.a0) >= 50 };
    }),
    people: out, pick, firstWaiting: waiters[0]?.key || null,
    total, waitingTotal: waiters.reduce((n, q) => n + q.waiting, 0), waitingPeople: waiters.length,
    empty: !out.length,
  };
}

// ── Default folds (Directory groups, Players → Who they know) ─────────────────
// The rule (dev-approved 2026-10-28): the first group is open and the rest are closed; a closed
// group shows its count plus whatever needs the GM; the group holding the selection is open; a
// search or an active filter opens everything; a fold the GM chose wins over the default.

/**
 * Is group #index shut?
 * @param {object} o
 * @param {number} o.index       position in the shown list (0 = first)
 * @param {string} o.key         the group's key
 * @param {Map|object} [o.choices] key → true (GM shut it) | false (GM opened it)
 * @param {boolean} [o.forced]   a search / filter / facet is active
 * @param {string|null} [o.selKey] the key of the group holding the selection
 */
export function foldShut({ index = 0, key = '', choices = null, forced = false, selKey = null } = {}) {
  if (forced) return false;
  if (selKey && key === selKey) return false;
  const has = choices instanceof Map ? choices.has(key) : !!(choices && Object.prototype.hasOwnProperty.call(choices, key));
  if (has) return !!(choices instanceof Map ? choices.get(key) : choices[key]);
  return index > 0;
}

/** What a closed group head shows besides its count: waiting mail and problems. */
export function foldBadges(rows = [], { mailKey = 'mail', checkKey = 'check' } = {}) {
  let waiting = 0, checks = 0;
  for (const r of rows) { waiting += Number(r?.[mailKey]) || 0; if (r?.[checkKey]) checks++; }
  return { waiting, checks };
}

/** Read the stored Directory fold choices; accepts the pre-2026-10-28 array of shut keys. */
export function readFoldChoices(raw) {
  const out = new Map();
  if (Array.isArray(raw)) { for (const k of raw) if (typeof k === 'string') out.set(k, true); return out; }
  if (raw && typeof raw === 'object') for (const [k, v] of Object.entries(raw)) out.set(k, !!v);
  return out;
}

// ── Players + Groups toolbars (2026-10-28, dev: "a better filtering and search and sort function —
//    the same idea from directory"). Both sub-tabs wear the Directory's one-row toolbar; the rules
//    behind its Show / Group / Sort live here so a sim can drive them.

/** Players → Show. A row: { unread, email, online, groupsN }. */
export const PLAYER_FILTERS = [
  ['all', 'All'], ['unread', 'Has unread'], ['noaddr', 'No address'], ['online', 'Online'], ['offline', 'Offline'], ['group', 'Holds a group'],
];
export function passesPlayerFilter(row, key) {
  const r = row || {};
  switch (key) {
    case 'unread': return (Number(r.unread) || 0) > 0;
    case 'noaddr': return !lc(r.email);
    case 'online': return !!r.online;
    case 'offline': return !r.online;
    case 'group': return (Number(r.groupsN) || 0) > 0;
    default: return true;
  }
}

/** Players → Sort: name · unread (most first) · last (newest mail first, never-mailed last) · player. */
export const PLAYER_SORTS = [['name', 'Sort: A–Z'], ['unread', 'Sort: Unread'], ['last', 'Sort: Last mail'], ['player', 'Sort: Player']];
export function sortPlayers(rows = [], mode = 'name') {
  const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''));
  const list = [...rows];
  switch (mode) {
    case 'unread': return list.sort((a, b) => (Number(b.unread) || 0) - (Number(a.unread) || 0) || byName(a, b));
    case 'last': return list.sort((a, b) => (!a.lastTs) - (!b.lastTs) || String(b.lastTs || '').localeCompare(String(a.lastTs || '')) || byName(a, b));
    case 'player': return list.sort((a, b) => (!a.player) - (!b.player) || String(a.player || '').localeCompare(String(b.player || '')) || byName(a, b));
    default: return list.sort(byName);
  }
}

/** Players → Group: none · player (the user) · scene (the user's viewed scene) · online. Catch-alls last. */
export const PLAYER_GROUPS = [['none', 'Group: None'], ['player', 'Group: Player'], ['scene', 'Group: Scene'], ['online', 'Group: Online']];
export function groupPlayers(rows = [], mode = 'none') {
  const groups = new Map();
  const put = (label, icon, row, { last = false, hue = '' } = {}) => {
    if (!groups.has(label)) groups.set(label, { key: `${mode}:${label}`, label, icon, rows: [], last, hue });
    groups.get(label).rows.push(row);
  };
  for (const r of rows) {
    switch (mode) {
      case 'player': r.player ? put(r.player, 'fas fa-user', r, { hue: r.player }) : put('No player', 'fas fa-user-slash', r, { last: true }); break;
      case 'scene': r.online && r.sceneName ? put(r.sceneName, 'fas fa-map', r, { hue: r.sceneName }) : put(r.online ? 'No scene' : 'Offline', r.online ? 'fas fa-map' : 'fas fa-circle', r, { last: true }); break;
      case 'online': r.online ? put('Online', 'fas fa-circle', r) : put('Offline', 'fas fa-circle', r, { last: true }); break;
      default: put('All characters', 'fas fa-users', r);
    }
  }
  return [...groups.values()].sort((a, b) => (a.last - b.last) || a.label.localeCompare(b.label));
}

/** Text the Players search box matches: character, player, address, scene. */
export function playerHaystack(r) { return [r?.name, r?.player, r?.email, r?.sceneName].map(lc).join(' '); }

/** The content signature a pushed copy is compared against: name, colour, members by address/id/name. */
export function groupSig(g) {
  const key = (m) => lc(m?.email) || m?.hint?.contactId || m?.hint?.actorId || lc(m?.name);
  return JSON.stringify([g?.name || '', g?.color || '', g?.img || '', (g?.members || []).map(key).sort()]);
}

/** Groups → Show. A row: { pushed (count), stale (a pushed copy differs), lastUsedAt }. */
export const GROUP_FILTERS = [['all', 'All'], ['pushed', 'Pushed to players'], ['unpushed', 'Not pushed'], ['stale', 'Out of date'], ['unused', 'Never used']];
export function passesGroupFilter(row, key) {
  const r = row || {};
  switch (key) {
    case 'pushed': return (Number(r.pushed) || 0) > 0;
    case 'unpushed': return !(Number(r.pushed) || 0);
    case 'stale': return !!r.stale;
    case 'unused': return !r.lastUsedAt;
    default: return true;
  }
}

/** Groups → Sort: name · recent (last messaged first, never-used last A→Z) · size · pushed (to most). */
export const GROUP_SORTS = [['name', 'Sort: A–Z'], ['recent', 'Sort: Recently used'], ['size', 'Sort: Size'], ['pushed', 'Sort: Pushed to most']];
export function sortGroups(rows = [], mode = 'name') {
  const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''));
  const list = [...rows];
  switch (mode) {
    case 'recent': return list.sort((a, b) => (!a.lastUsedAt) - (!b.lastUsedAt) || String(b.lastUsedAt || '').localeCompare(String(a.lastUsedAt || '')) || byName(a, b));
    case 'size': return list.sort((a, b) => (Number(b.n) || 0) - (Number(a.n) || 0) || byName(a, b));
    case 'pushed': return list.sort((a, b) => (Number(b.pushed) || 0) - (Number(a.pushed) || 0) || byName(a, b));
    default: return list.sort(byName);
  }
}

/** Text the Groups search box matches: the group name and every member's name / address. */
export function groupHaystack(r) { return [r?.name, ...(r?.memberNames || []), ...(r?.memberEmails || [])].map(lc).join(' '); }

/** Past this many groups the rail folds the rest behind "+N more" (the player panel's GROUP_RAIL_LIMIT idea). */
export const GROUPS_RAIL_LIMIT = 12;

/**
 * Fold a flat list past `limit`: the first `limit` rows stay, the row `keepId` is always shown, the rest
 * count as hidden. `open` (the GM clicked "+N more") or `forced` (a search / filter) shows everything.
 * @returns {{ list: object[], hidden: number }}
 */
export function foldTail(rows = [], { limit = GROUPS_RAIL_LIMIT, open = false, forced = false, keepId = null } = {}) {
  if (open || forced || rows.length <= limit) return { list: rows, hidden: 0 };
  const list = rows.slice(0, limit);
  const kept = rows.slice(limit).find((r) => keepId && r.id === keepId);
  if (kept) list.push(kept);
  return { list, hidden: rows.length - list.length };
}
