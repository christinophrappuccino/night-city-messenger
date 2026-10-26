/**
 * @file scripts/utils/emailDirectory.js
 * @module night-city-messenger
 * @description Export / import of the world's ADDRESSES — every registered
 *   character address (the actor `email` flag) and every master contact's
 *   address — plus the email-domain list. Pure: no Foundry globals. The
 *   Tools-tab "Email Domains" dialog builds the `world` adapter from Foundry
 *   and does the writes; `dev/tools/sims/test-email-import.mjs` drives this
 *   module with mocked worlds.
 *
 *   Tester ask (2026-10-24): "an import and export so we can mass import a csv
 *   or json of emails." Master contacts already had JSON import/export; actor
 *   addresses had neither, so handing twenty characters addresses meant opening
 *   each sheet.
 *
 *   The import is a PLAN first, a write second: every row resolves to exactly
 *   one action (update a character · update a contact · create a contact ·
 *   skip, with the reason) and the GM sees the whole plan before anything is
 *   written. A blank address never clears one. Mail already sent keeps the
 *   address it was stamped with.
 */

import { parseCsv, toCsv } from './csv.js';

/** Actor types that are never a person with an address (helpers.getPlayerCharacters' list). */
export const NON_PERSON_ACTOR_TYPES = new Set(['blackIce', 'black-ice', 'demon', 'container']);

/** Export column order. `kind` is 'actor' | 'contact'. */
export const DIRECTORY_COLUMNS = ['name', 'email', 'kind', 'actorId', 'contactId'];

/** Header words accepted for each column on import (lower-cased, punctuation stripped). */
const HEADER_ALIASES = {
  name: ['name', 'character', 'actor', 'contact', 'who', 'handle', 'npc'],
  email: ['email', 'e-mail', 'mail', 'address', 'emailaddress', 'netaddress'],
  kind: ['kind', 'type', 'target'],
  actorId: ['actorid', 'actor_id', 'actor id', 'actor-id'],
  contactId: ['contactid', 'contact_id', 'contact id', 'contact-id', 'mastercontactid', 'masterid'],
};

/** Space/punctuation-insensitive name key (the SkillService rule). */
export function normName(s) {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** One local part, one @, one domain with a dot or at least two chars, no spaces. */
export function isValidEmail(e) {
  const s = String(e ?? '').trim();
  return /^[^\s@]+@[^\s@]{2,}$/.test(s);
}

const normEmail = (e) => String(e ?? '').trim().toLowerCase();

// ═══════════════════════════════════════════════════════════════
//  Export
// ═══════════════════════════════════════════════════════════════

/**
 * Every address in the world as flat rows, characters first then contacts,
 * each group A→Z. A contact linked to an actor exports as its own row (kind
 * 'contact', carrying both ids) — the two addresses CAN differ, and the GM
 * should see it when they do.
 * @param {{ actors: Array<{id, name, email?, type?}>, contacts: Array<{id, name, email?, actorId?}> }} world
 * @returns {Array<{name, email, kind, actorId, contactId}>}
 */
export function buildDirectoryRows(world) {
  const byName = (a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' });
  const actors = (world?.actors ?? [])
    .filter(a => a?.email && !NON_PERSON_ACTOR_TYPES.has(a.type))
    .sort(byName)
    .map(a => ({ name: a.name, email: a.email, kind: 'actor', actorId: a.id, contactId: '' }));
  const contacts = (world?.contacts ?? [])
    .filter(c => c?.email)
    .sort(byName)
    .map(c => ({ name: c.name, email: c.email, kind: 'contact', actorId: c.actorId || '', contactId: c.id }));
  return [...actors, ...contacts];
}

/** @param {Array<object>} rows */
export function directoryToCsv(rows) {
  return toCsv(rows, DIRECTORY_COLUMNS);
}

/** @param {Array<object>} rows @param {Date} [now] */
export function directoryToJson(rows, now = new Date()) {
  return JSON.stringify({ ncmEmailDirectory: 1, exportedAt: now.toISOString(), entries: rows }, null, 2);
}

// ═══════════════════════════════════════════════════════════════
//  Import — parse
// ═══════════════════════════════════════════════════════════════

/**
 * Read a CSV / TSV / JSON text into neutral rows.
 *
 * JSON: the export envelope (`entries`), a bare array of objects, or an
 * object map `{ "Name": "address", … }`. CSV: a header row is recognised by
 * ANY cell matching a known header alias; without one, columns are taken as
 * `name, email[, kind]`. A row whose name cell is itself an address and has
 * no email cell is read as an address with no name (`"v@nc.net"` alone).
 * @param {string} text
 * @returns {{ rows: Array<{line:number, name:string, email:string, kind:string, actorId:string, contactId:string}>, format: 'csv'|'json', error?: string }}
 */
export function parseDirectoryImport(text) {
  const src = String(text ?? '').replace(/^﻿/, '').trim();
  if (!src) return { rows: [], format: 'csv', error: 'The file is empty.' };

  if (src[0] === '{' || src[0] === '[') {
    let parsed;
    try { parsed = JSON.parse(src); }
    catch (err) { return { rows: [], format: 'json', error: `Not valid JSON: ${err.message}` }; }
    let list;
    if (Array.isArray(parsed)) list = parsed;
    else if (Array.isArray(parsed?.entries)) list = parsed.entries;
    else if (Array.isArray(parsed?.contacts)) list = parsed.contacts;       // a master-contacts export works too
    else if (parsed && typeof parsed === 'object') list = Object.entries(parsed).map(([name, email]) => ({ name, email }));
    else return { rows: [], format: 'json', error: 'Expected an array of entries.' };
    const rows = list.map((e, i) => _row(i + 1, e)).filter(Boolean);
    return { rows, format: 'json' };
  }

  const grid = parseCsv(src);
  if (!grid.length) return { rows: [], format: 'csv', error: 'No rows found.' };
  const header = _detectHeader(grid[0]);
  const body = header ? grid.slice(1) : grid;
  const firstLine = header ? 2 : 1;
  const rows = body.map((cells, i) => {
    const pick = (key, fallbackIdx) => {
      const idx = header ? header[key] : fallbackIdx;
      return idx == null || idx < 0 ? '' : String(cells[idx] ?? '').trim();
    };
    let name = pick('name', 0);
    let email = pick('email', 1);
    // A lone address in the first column with nothing beside it.
    if (!email && isValidEmail(name) && !pick('kind', 2)) { email = name; name = ''; }
    return _row(firstLine + i, { name, email, kind: pick('kind', 2), actorId: pick('actorId', -1), contactId: pick('contactId', -1) });
  }).filter(Boolean);
  return { rows, format: 'csv' };
}

function _detectHeader(cells) {
  const map = {};
  let hits = 0;
  cells.forEach((c, i) => {
    const key = String(c ?? '').trim().toLowerCase().replace(/[^a-z0-9 _-]+/g, '');
    for (const [col, aliases] of Object.entries(HEADER_ALIASES)) {
      if (map[col] == null && aliases.includes(key)) { map[col] = i; hits++; }
    }
  });
  // A header must name the name or the email column, must not contain an
  // address anywhere (a header never does; a data row usually does), and must
  // be MOSTLY header words — `Judy Alvarez,judy@mox.nc,contact` has one alias
  // hit ("contact" is a name alias) and is a data row.
  if (!hits || (map.name == null && map.email == null)) return null;
  if (cells.some(c => isValidEmail(c))) return null;
  if (hits < 2 && cells.filter(c => String(c ?? '').trim()).length !== hits) return null;
  return map;
}

function _row(line, e) {
  if (!e || typeof e !== 'object') return null;
  const name = String(e.name ?? e.character ?? e.actor ?? '').trim();
  const email = String(e.email ?? e.address ?? '').trim();
  const kind = String(e.kind ?? e.type ?? '').trim().toLowerCase();
  const actorId = String(e.actorId ?? '').trim();
  const contactId = String(e.contactId ?? e.id ?? '').trim();
  if (!name && !email && !actorId && !contactId) return null;
  return {
    line,
    name,
    email,
    kind: kind === 'actor' || kind === 'character' || kind === 'pc' || kind === 'npc-actor' ? 'actor'
      : kind === 'contact' || kind === 'master' || kind === 'master-contact' ? 'contact' : '',
    actorId,
    contactId,
  };
}

// ═══════════════════════════════════════════════════════════════
//  Import — plan
// ═══════════════════════════════════════════════════════════════

/**
 * Decide what each row would do, writing nothing.
 *
 * Resolution order per row: an explicit actor id → an explicit contact id →
 * a character by name → a master contact by name → (no `kind`, has a name)
 * a NEW master contact. `kind: 'actor'` never touches a contact and never
 * creates one; `kind: 'contact'` never touches a character. Updating a
 * character whose linked master contact holds a different address ALSO
 * updates that contact (and the reverse), so the flag and the directory
 * never disagree after an import — `also` names the second write.
 *
 * @param {Array} rows — from parseDirectoryImport
 * @param {{ actors: Array<{id, name, email?, type?, hasPlayerOwner?}>, contacts: Array<{id, name, email?, actorId?}> }} world
 * @returns {{ plan: Array<PlanEntry>, summary: {updateActor:number, updateContact:number, createContact:number, skip:number, warnings:number} }}
 *
 * @typedef {object} PlanEntry
 * @property {number} line
 * @property {string} name
 * @property {string} email
 * @property {'update-actor'|'update-contact'|'create-contact'|'skip'} action
 * @property {string} [targetId]
 * @property {string} [targetName]
 * @property {string} [previous] — the address being replaced
 * @property {{actorId?: string, contactId?: string, name: string}} [also]
 * @property {string} [reason] — why skipped
 * @property {string[]} warnings
 */
export function planDirectoryImport(rows, world) {
  const actors = (world?.actors ?? []).filter(a => a && !NON_PERSON_ACTOR_TYPES.has(a.type));
  const contacts = (world?.contacts ?? []).filter(Boolean);
  const actorById = new Map(actors.map(a => [a.id, a]));
  const contactById = new Map(contacts.map(c => [c.id, c]));
  const actorsByName = _groupBy(actors, a => normName(a.name));
  const contactsByName = _groupBy(contacts, c => normName(c.name));
  const contactByActorId = new Map(contacts.filter(c => c.actorId).map(c => [c.actorId, c]));

  // Who holds which address right now (for the "already used by" warning).
  const owners = new Map();
  for (const a of actors) if (a.email) _push(owners, normEmail(a.email), { kind: 'actor', id: a.id, name: a.name });
  for (const c of contacts) if (c.email) _push(owners, normEmail(c.email), { kind: 'contact', id: c.id, name: c.name });

  const seenEmails = new Map();   // email → first line
  const seenTargets = new Map();  // `${action}:${id|name}` → first line
  const plan = [];

  for (const row of rows ?? []) {
    const entry = { line: row.line, name: row.name, email: normEmail(row.email), kind: row.kind, action: 'skip', warnings: [] };
    plan.push(entry);
    const skip = (reason) => { entry.action = 'skip'; entry.reason = reason; };

    if (!row.name && !row.email && !row.actorId && !row.contactId) { skip('empty row'); continue; }
    if (!entry.email) { skip('no address — a blank leaves the current one alone'); continue; }
    if (!isValidEmail(entry.email)) { skip(`"${row.email}" is not an address`); continue; }

    // ── Resolve the target ──
    let actor = row.actorId ? actorById.get(row.actorId) || null : null;
    let contact = row.contactId ? contactById.get(row.contactId) || null : null;
    if (row.actorId && !actor && row.kind === 'actor') { skip(`no character with id ${row.actorId}`); continue; }
    const key = normName(row.name);
    if (!actor && !contact && key) {
      if (row.kind !== 'contact') {
        const hits = actorsByName.get(key) || [];
        if (hits.length > 1) { skip(`${hits.length} characters are named "${row.name}" — add the actorId column`); continue; }
        actor = hits[0] || null;
      }
      if (!actor && row.kind !== 'actor') {
        const hits = contactsByName.get(key) || [];
        if (hits.length > 1) { skip(`${hits.length} contacts are named "${row.name}" — add the contactId column`); continue; }
        contact = hits[0] || null;
      }
    }
    if (row.kind === 'contact') actor = null;

    // ── Decide the action ──
    // `twin` = the other half of a character↔master-contact link. It is kept
    // in step when the primary CHANGES (`also`), and it is never reported as a
    // stranger already holding the address.
    let twin = null;
    if (actor) {
      entry.action = 'update-actor';
      entry.targetId = actor.id;
      entry.targetName = actor.name;
      entry.previous = actor.email || '';
      const linked = contactByActorId.get(actor.id);
      if (linked) twin = { contactId: linked.id, name: linked.name, email: linked.email };
      if (actor.hasPlayerOwner) entry.warnings.push('player character — this overrides the address the player chose');
    } else if (contact) {
      entry.action = 'update-contact';
      entry.targetId = contact.id;
      entry.targetName = contact.name;
      entry.previous = contact.email || '';
      const linkedActor = contact.actorId ? actorById.get(contact.actorId) : null;
      if (linkedActor) twin = { actorId: linkedActor.id, name: linkedActor.name, email: linkedActor.email };
    } else if (row.kind === 'actor') {
      skip(row.name ? `no character named "${row.name}"` : 'no name');
      continue;
    } else if (row.name) {
      entry.action = 'create-contact';
      entry.targetName = row.name;
    } else {
      skip('an address with no name — nothing to attach it to');
      continue;
    }

    // ── Unchanged / duplicate targets ──
    // An unchanged row is a skip even when its twin differs: "nothing to do"
    // must mean nothing — re-importing an export plans zero writes.
    if (entry.action !== 'create-contact' && normEmail(entry.previous) === entry.email) {
      skip(`${entry.targetName} already has this address`);
      continue;
    }
    if (twin && normEmail(twin.email) !== entry.email) {
      entry.also = twin.contactId ? { contactId: twin.contactId, name: twin.name } : { actorId: twin.actorId, name: twin.name };
    }
    const tKey = `${entry.action}:${entry.targetId || key}`;
    if (seenTargets.has(tKey)) { skip(`${entry.targetName} was already assigned an address on row ${seenTargets.get(tKey)}`); continue; }
    seenTargets.set(tKey, row.line);

    // ── Warnings ──
    if (seenEmails.has(entry.email)) entry.warnings.push(`same address as row ${seenEmails.get(entry.email)}`);
    else seenEmails.set(entry.email, row.line);
    const twinId = twin?.contactId || twin?.actorId || null;
    const others = (owners.get(entry.email) || []).filter(o => o.id !== entry.targetId && o.id !== twinId);
    if (others.length) entry.warnings.push(`address already used by ${others.map(o => o.name).join(', ')}`);
  }

  const summary = { updateActor: 0, updateContact: 0, createContact: 0, skip: 0, warnings: 0 };
  for (const p of plan) {
    if (p.action === 'update-actor') summary.updateActor++;
    else if (p.action === 'update-contact') summary.updateContact++;
    else if (p.action === 'create-contact') summary.createContact++;
    else summary.skip++;
    summary.warnings += p.warnings.length;
  }
  return { plan, summary };
}

function _groupBy(list, keyFn) {
  const m = new Map();
  for (const x of list) { const k = keyFn(x); if (!k) continue; _push(m, k, x); }
  return m;
}
function _push(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

// ═══════════════════════════════════════════════════════════════
//  Domains
// ═══════════════════════════════════════════════════════════════

/**
 * @param {{ defaultDomain: string, domains: string[], allowCustom: boolean }} cfg
 * @param {Date} [now]
 * @returns {string}
 */
export function domainsToJson(cfg, now = new Date()) {
  return JSON.stringify({
    ncmEmailDomains: 1,
    exportedAt: now.toISOString(),
    default: String(cfg?.defaultDomain ?? '').trim(),
    domains: (cfg?.domains ?? []).map(d => String(d).trim()).filter(Boolean),
    allowCustom: cfg?.allowCustom !== false,
  }, null, 2);
}

/**
 * Accepts the envelope, a bare array of domains, or newline/comma-separated
 * text. The default domain is never cleared by an import that doesn't carry one.
 * @param {string} text
 * @returns {{ defaultDomain: string|null, domains: string[], allowCustom: boolean|null, error?: string }}
 */
export function parseDomainsImport(text) {
  const src = String(text ?? '').replace(/^﻿/, '').trim();
  const clean = (list) => [...new Set(list.map(d => String(d ?? '').trim().replace(/^@/, '').toLowerCase()).filter(d => d && !/\s/.test(d)))];
  if (!src) return { defaultDomain: null, domains: [], allowCustom: null, error: 'The file is empty.' };
  if (src[0] === '{' || src[0] === '[') {
    let parsed;
    try { parsed = JSON.parse(src); }
    catch (err) { return { defaultDomain: null, domains: [], allowCustom: null, error: `Not valid JSON: ${err.message}` }; }
    if (Array.isArray(parsed)) return { defaultDomain: null, domains: clean(parsed), allowCustom: null };
    if (parsed && typeof parsed === 'object') {
      return {
        defaultDomain: parsed.default ? String(parsed.default).trim() : null,
        domains: clean(Array.isArray(parsed.domains) ? parsed.domains : []),
        allowCustom: typeof parsed.allowCustom === 'boolean' ? parsed.allowCustom : null,
      };
    }
    return { defaultDomain: null, domains: [], allowCustom: null, error: 'Expected a list of domains.' };
  }
  return { defaultDomain: null, domains: clean(src.split(/[\r\n,;]+/)), allowCustom: null };
}
