/**
 * The number system: reading, writing, explaining and generating numbers.
 * @file scripts/utils/phoneNumbering.js
 * @module night-city-messenger
 * @description Pure (no Foundry globals). Spec: dev/design/PHONE-REVISION.md §2, §3, §18.
 *
 * A number is region code, city letters, district letters, line: `+72 NC WAT-4471`. A city with no districts has no
 * district part: `+83 OSK-1234`. Every reader (dial box, picker, explainer, Trace, matching) goes through `parseNumber`.
 *
 * Everything takes a context built once by `buildNumberContext`, so nothing here reads a setting:
 *   { home: {rc, city}, regions, rows, service }
 *
 * The dial pad spells districts (9-2-8 = WAT), so a number typed in digits reaches the same line as one typed in
 * letters. `parseNumber` resolves digits through the table; the stored key always holds the letters.
 */

import { startingRows } from '../data/phonePlaces.js';

const KEYPAD = { A: 2, B: 2, C: 2, D: 3, E: 3, F: 3, G: 4, H: 4, I: 4, J: 5, K: 5, L: 5, M: 6, N: 6, O: 6,
  P: 7, Q: 7, R: 7, S: 7, T: 8, U: 8, V: 8, W: 9, X: 9, Y: 9, Z: 9 };

/** How a line count is drawn. Four digits, so 10,000 lines per place. */
export const LINE_DIGITS = 4;

/** Letters as the pad keys that spell them ("WAT" → "928"). */
export const asKeys = (letters) => String(letters ?? '').toUpperCase().replace(/[A-Z]/g, (c) => String(KEYPAD[c]));

/** A special number as it is compared: case and spacing never matter. */
export const specialKey = (raw) => String(raw ?? '').toUpperCase().replace(/[\s-]/g, '');

const compact = (raw) => String(raw ?? '').toUpperCase().replace(/[\s()._-]/g, '');

/** Where a world starts: Night City, until the GM picks another home. */
export const DEFAULT_HOME = Object.freeze({ rc: '72', city: 'NC' });
/** Special numbers every world starts with (a GM's own are added in `phoneSpecial`). */
export const DEFAULT_SPECIAL = Object.freeze({ TRAUMA: { name: 'Trauma Team', listed: true }, NCPD: { name: 'Night City Police', listed: true } });

/**
 * The GM's table: a starting list with their changes laid over it. Never throws.
 * @param {{list?: string, changed?: Object<string, object|null>, added?: object[]}} [stored]
 * @returns {object[]}
 */
export function placeRows(stored = {}) {
  const s = stored && typeof stored === 'object' ? stored : {};
  const key = (r) => `${r['Region code']}/${r['City code']}/${r.Code || ''}`;
  const changed = s.changed && typeof s.changed === 'object' ? s.changed : {};
  const rows = [];
  for (const r of startingRows(['2045', '2077', 'blank'].includes(s.list) ? s.list : '2045')) {
    const k = key(r);
    if (!(k in changed)) rows.push(r);
    else if (changed[k]) rows.push({ ...r, ...changed[k] });
  }
  for (const r of Array.isArray(s.added) ? s.added : []) if (r?.['Region code'] && r?.['City code']) rows.push({ Status: 'live', Listed: 'yes', 'Players can pick': 'yes', ...r });
  return rows;
}

/**
 * What to store for a table: the changes from its starting list, so a later version can still add places.
 * @param {object[]} rows — the whole table as it should be
 * @param {string} list — '2045' | '2077' | 'blank'
 * @param {string[]} [extra] — the GM's own columns
 * @returns {{list: string, changed: object, added: object[], extra: string[]}}
 */
export function placesDiff(rows, list = '2045', extra = []) {
  const key = (r) => `${r['Region code']}/${r['City code']}/${r.Code || ''}`;
  const base = new Map(startingRows(list).map((r) => [key(r), r]));
  const now = new Map(rows.map((r) => [key(r), r]));
  const changed = {}, added = [];
  for (const [k, b] of base) {
    const r = now.get(k);
    if (!r) changed[k] = null;
    else if (Object.keys({ ...b, ...r }).some((c) => (b[c] ?? '') !== (r[c] ?? ''))) changed[k] = { ...r };
  }
  for (const [k, r] of now) if (!base.has(k)) added.push({ ...r });
  return { list, changed, added, extra: [...extra] };
}

/**
 * Wrap the numbers in a piece of HTML in a link. Only a whole number on a row of the table: ABC-1234 in a mail
 * about a part number stays plain, because the district has to exist.
 */
export function linkNumbers(html, ctx) {
  const RE = /(\+\d{2}\s[A-Z]{2,3}(?:\s[A-Z]{3})?-\d{4}|\b[A-Z]{2,3}\s[A-Z]{3}-\d{4}\b|\b[A-Z]{3}-\d{4}\b)/g;
  return String(html ?? '').split(/(<[^>]*>)/).map((part, i, all) => {
    if (part.startsWith('<') || !part) return part;
    // never inside a link already
    let open = 0;
    for (let j = 0; j < i; j++) { if (/^<a\b/i.test(all[j])) open++; else if (/^<\/a/i.test(all[j])) open--; }
    if (open > 0) return part;
    return part.replace(RE, (m) => { const p = parseNumber(m, ctx); return p.done && !p.service && rowOf(p, ctx) ? `<a class="ncm-phone-link" data-action="dial-number" data-number="${m}" data-tooltip="Open it in Calls">${m}</a>` : m; });
  }).join('');
}

/* ─── line types (PHONE-REVISION.md §6) ─── */
const lt = (id, name, o) => ({ id, name, color: 'var(--ncm-act)', word: name, ring: 'steady', shows: 'owner', label: '', trace: 'owner', hold: 'gm', burn: false, ext: false, fixed: false, face: false, ...o });
export const DEFAULT_LINE_TYPES = Object.freeze([
  lt('std', 'Standard', { word: '', hold: 'players', builtin: true }),
  lt('corp', 'Corporate', { color: 'var(--ncm-hue-5)', shows: 'ownerOrg', ext: true, ring: 'slow' }),
  lt('burner', 'Burner', { color: 'var(--ncm-attn)', shows: 'number', trace: 'dead', hold: 'players', burn: true, ring: 'flicker' }),
  lt('pay', 'Payphone', { color: 'var(--ncm-hue-3)', shows: 'place', trace: 'place', fixed: true, ring: 'fast' }),
  lt('biz', 'Business', { color: 'var(--ncm-hue-1)', shows: 'label', label: '', trace: 'label' }),
]);
const LT_SHOWS = ['ownerOrg', 'owner', 'label', 'number', 'place', 'none'], LT_TRACE = ['owner', 'label', 'place', 'dead'], LT_RING = ['steady', 'slow', 'fast', 'flicker'];

/** One line type, every field safe. */
export function sanitizeLineType(x = {}) {
  const v = x && typeof x === 'object' ? x : {};
  return { id: String(v.id || Math.random().toString(36).slice(2, 9)), name: String(v.name ?? 'New type').slice(0, 30), color: String(v.color || 'var(--ncm-act)'), word: String(v.word ?? '').slice(0, 20),
    ring: LT_RING.includes(v.ring) ? v.ring : 'steady', shows: LT_SHOWS.includes(v.shows) ? v.shows : 'owner', label: String(v.label ?? '').slice(0, 40), trace: LT_TRACE.includes(v.trace) ? v.trace : 'owner',
    hold: v.hold === 'players' ? 'players' : 'gm', burn: !!v.burn, ext: !!v.ext, fixed: !!v.fixed, face: !!v.face, builtin: !!v.builtin };
}

/** The types in play: the shipped ones with the GM's changes, then the GM's own. @param {{changed?: object, added?: object[], removed?: string[]}} stored */
export function lineTypes(stored = {}) {
  const s = stored && typeof stored === 'object' ? stored : {};
  const removed = Array.isArray(s.removed) ? s.removed : [];
  const base = DEFAULT_LINE_TYPES.filter((t) => t.builtin || !removed.includes(t.id)).map((t) => sanitizeLineType({ ...t, ...(s.changed?.[t.id] || {}), id: t.id, builtin: t.builtin }));
  return [...base, ...(Array.isArray(s.added) ? s.added.map(sanitizeLineType) : [])];
}

/** What to store for a list of types. */
export function lineTypesDiff(list) {
  const changed = {}, added = [], here = new Set(list.map((t) => t.id));
  for (const t of list) {
    const d = DEFAULT_LINE_TYPES.find((x) => x.id === t.id);
    if (!d) added.push(t);
    else if (Object.keys(t).some((k) => (t[k] ?? '') !== (sanitizeLineType(d)[k] ?? ''))) changed[t.id] = t;
  }
  return { changed, added, removed: DEFAULT_LINE_TYPES.filter((t) => !here.has(t.id)).map((t) => t.id) };
}

/** A line's type: what was set on it, else what its kind and place say. An unknown one reads as Standard. */
export function lineTypeFor(line, row, types) {
  const byId = (id) => types.find((t) => t.id === id);
  return byId(line?.type) || (line?.kind === 'burner' && byId('burner')) || (row?.Category === 'Corporate' && byId('corp')) || byId('std') || types[0] || sanitizeLineType({ id: 'std', name: 'Standard', word: '' });
}

/**
 * What the other end is shown for a line of this type.
 * @returns {{name: string, img: string, org: string, orgArt: string, showOnly: string, word: string, ring: string, anon: boolean, asLine: boolean}}
 */
export function lineShown(type, { name = '', img = '', org = '', orgArt = '', label = '', place = '' } = {}) {
  // face: someone who doesn't have the holder saved still sees their picture (only where the type shows the holder)
  const base = { org: '', orgArt: '', word: type.word || '', ring: type.ring, showOnly: '', anon: false, asLine: false, name, img, face: !!type.face && type.shows === 'owner' };
  switch (type.shows) {
    case 'ownerOrg': return { ...base, org, orgArt, showOnly: 'name' };
    case 'label': return { ...base, name: label || type.label || type.name, img: orgArt || '', showOnly: 'name', asLine: true };
    case 'place': return { ...base, name: place ? `${type.name}, ${place}` : type.name, img: '', showOnly: 'name', asLine: true };
    case 'number': return { ...base, name: '', img: '', showOnly: 'number', asLine: true };
    case 'none': return { ...base, name: '', img: '', anon: true, asLine: true };
    default: return base;
  }
}

/**
 * The contact in a character's own list that stands for the other party of a call, or null. Matched by the number, the
 * directory entry it was saved from, the email of the identity calling (a contact saved from mail, never linked), or
 * the character itself on their own main line.
 * @param {object[]} contacts - the character's contacts @param {object} other - call.from / call.to
 * @param {{home?: string|null, email?: string}} opts - email = the calling identity's address
 */
export function savedContactFor(contacts, other, { home = null, email = '' } = {}) {
  const o = other || {}, n = normaliseNumber(o.number, home), e = String(email || '').toLowerCase().trim();
  return (Array.isArray(contacts) ? contacts : []).find((c) => (n && c.phone && normaliseNumber(c.phone, home) === n)
    || (o.contactId && c.masterContactId === o.contactId)
    || (e && !o.asLine && String(c.email || '').toLowerCase().trim() === e)
    || (!o.asLine && !o.contactId && o.actorId && c.actorId === o.actorId)) || null;
}

/** What a Trace on this line finds: a name, or null for a dead end. The owner only when the type says so. */
export function traceFinds(type, { name = '', label = '', place = '' } = {}) {
  // 'dead' (a burner): the trace still recovers the NUMBER, never who holds it (tester 2026-11-07). A true dead
  // end is only a special number the GM set to one.
  if (type.trace === 'dead') return { name: '', owner: false, numberOnly: true };
  if (type.trace === 'place') return { name: place ? `${type.name}, ${place}` : type.name, owner: false };
  if (type.trace === 'label') return { name: label || type.label || type.name, owner: false };
  return { name, owner: true };
}

/* ─── written call logs (§9) ─── */
export const LOG_OUTCOMES = Object.freeze({ Answered: 'answered', Missed: 'missed', Declined: 'declined', Voicemail: 'voicemail', Dropped: 'dropped' });
/** "2:31" as seconds, or 0. */
export const lengthSeconds = (t) => { const m = /^(\d+):(\d{1,2})$/.exec(String(t ?? '').trim()); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; };
/** A call the GM wrote, as the log reads it. */
export function writtenToLog(e, me = {}) {
  const other = { name: e.who || '', number: e.n || '' };
  const out = e.dir === 'out';
  return { callId: 'w:' + e.id, written: true, direction: e.dir === 'out' ? 'out' : 'in', me, other, from: out ? me : other, to: out ? other : me,
    outcome: LOG_OUTCOMES[e.out] || 'answered', seconds: lengthSeconds(e.len), gameTime: e.when || '', startedAt: Date.parse(e.when) || 0, seen: true, lines: [], dropReason: e.vm ? `"${e.vm}"` : '' };
}

/* ─── corporations (§7) ─── */
export const OFFICE_LINE = '0100';
export const officeKey = (row) => `${row['Region code']}/${row['City code']}/${row.Code || ''}`;
/** The corporate row a number is the main line of, or null. */
export function officeRowOf(p, ctx) {
  if (!p?.done || p.line !== OFFICE_LINE) return null;
  const r = rowOf(p, ctx);
  return r?.Category === 'Corporate' ? r : null;
}
/** One office's settings, safe. */
export function sanitizeOffice(o = {}) {
  const v = o && typeof o === 'object' ? o : {};
  return { answers: ['gm', 'recording', 'vm'].includes(v.answers) ? v.answers : 'vm', greet: String(v.greet ?? '').slice(0, 300), art: String(v.art ?? ''), mailbox: String(v.mailbox ?? ''),
    exts: (Array.isArray(v.exts) ? v.exts : []).filter((e) => /^\d+$/.test(String(e?.x ?? ''))).map((e) => ({ x: String(e.x), who: String(e.who ?? '').slice(0, 60), contactId: e.contactId || null, listed: e.listed !== false })) };
}
/**
 * Does the main number open on the switchboard screen? Always when someone or a recording answers; with Voicemail
 * only when there is something to show first, a greeting or a listed extension (tester 2026-11-09: Voicemail, the
 * default, went straight to the tone while the dial hint promised a switchboard).
 */
export function officeShowsBoard(o) {
  const v = sanitizeOffice(o);
  return v.answers !== 'vm' || !!v.greet || v.exts.some((e) => e.listed);
}
/** A dialled string split into the number and its extension: "MIL-0100 x17". */
export function splitExtension(raw) {
  const m = /^(.*?)\s*(?:x|ext\.?)\s*(\d+)\s*$/i.exec(String(raw ?? ''));
  return m ? { number: m[1], ext: m[2] } : { number: String(raw ?? ''), ext: '' };
}

/** Has the GM changed the table from its starting list? */
export const placesEdited = (stored) => !!stored && (Object.keys(stored.changed || {}).length > 0 || (stored.added || []).length > 0);

/** What a special number can do when someone dials it. */
export const SPECIAL_ACTS = Object.freeze(['ring', 'recording', 'voicemail', 'nis', 'dead', 'macro']);

/** One special number, every field filled in. */
export function sanitizeSpecial(x = {}) {
  const v = x && typeof x === 'object' ? x : {};
  return { id: String(v.id || specialKey(v.num) || Math.random().toString(36).slice(2, 9)), num: String(v.num ?? '').trim().slice(0, 32), name: String(v.name ?? '').slice(0, 60), img: String(v.img ?? ''),
    seen: v.seen === 'hidden' ? 'hidden' : 'listed', act: SPECIAL_ACTS.includes(v.act) ? v.act : 'ring', text: String(v.text ?? '').slice(0, 400), macro: String(v.macro ?? ''),
    who: v.who === 'some' ? 'some' : 'all', allow: Array.isArray(v.allow) ? v.allow.map(String) : [], show: v.show === 'none' ? 'none' : 'name',
    trace: ['name', 'false', 'dead'].includes(v.trace) ? v.trace : 'name', falseName: String(v.falseName ?? '').slice(0, 60), alert: !!v.alert };
}

/** The GM's special numbers: their own list once they have one, else the shipped two. */
export function specialList(stored) {
  if (Array.isArray(stored)) return stored.map(sanitizeSpecial);
  return Object.entries(DEFAULT_SPECIAL).map(([num, d]) => sanitizeSpecial({ id: num, num, name: d.name, seen: d.listed ? 'listed' : 'hidden' }));
}

/** Special numbers by the key they are dialled on. The first of two with one key wins. */
export function specialMap(list) {
  const out = {};
  for (const x of list) { const k = specialKey(x.num); if (k && !(k in out)) out[k] = x; }
  return out;
}

/**
 * What dialling a special number does for this character.
 * @returns {{outcome: 'ring'|'recording'|'voicemail'|'nis'|'dead'|'macro', alert: boolean}}
 */
export function specialOutcome(x, actorId) {
  const lets = x.who !== 'some' || (x.allow || []).includes(actorId);
  return { outcome: lets ? x.act : 'nis', alert: !!x.alert };
}

/** The number rules, with every default filled in. */
export function sanitizeRules(r = {}) {
  const v = r && typeof r === 'object' ? r : {};
  const n = Number(v.extraLines);
  return {
    home: v.home?.rc && v.home?.city ? { rc: String(v.home.rc), city: String(v.home.city) } : { ...DEFAULT_HOME },
    reach: ['home', 'region', 'all'].includes(v.reach) ? v.reach : 'all',
    ownDigits: v.ownDigits !== false,
    extraLines: Number.isFinite(n) && n >= 0 ? Math.floor(n) : 1,
    changeNeedsGm: v.changeNeedsGm !== false,
  };
}

/** The rows a player may take a number from: live, marked pickable, and inside the reach rule. A GM gets every live row. */
export function pickableRows(rows, rules, { gm = false } = {}) {
  const live = rows.filter((r) => r.Status !== 'dead');
  if (gm) return live;
  const R = sanitizeRules(rules);
  return live.filter((r) => r['Players can pick'] === 'yes' && (R.reach === 'all' || (R.reach === 'region' ? r['Region code'] === R.home.rc : r['Region code'] === R.home.rc && r['City code'] === R.home.city)));
}

/** The context for callers that have none: the shipped table, home Night City. */
let _defaultCtx = null;
export const defaultNumberContext = () => (_defaultCtx ??= buildNumberContext({ rows: startingRows('2045'), home: DEFAULT_HOME, service: DEFAULT_SPECIAL }));
const useCtx = (ctx) => (ctx?.regions ? ctx : defaultNumberContext());

/**
 * Index the place table and hold everything a reader needs.
 * @param {object} o
 * @param {object[]} o.rows — place rows (scripts/data/phonePlaces.js shape)
 * @param {{rc: string, city: string}} o.home — the campaign's home city
 * @param {Object<string, *>} [o.service] — special numbers by `specialKey`
 * @returns {{home: object, regions: object, rows: object[], service: object}}
 */
export function buildNumberContext({ rows = [], home = { rc: '72', city: 'NC' }, service = {} } = {}) {
  const regions = {};
  for (const r of rows) {
    const rc = r['Region code'], city = r['City code'], code = r.Code || '';
    if (!rc || !city) continue;
    const R = (regions[rc] ??= { name: r.Region, cities: {} });
    const C = (R.cities[city] ??= { name: r.City, state: r.State || '', ex: {}, noEx: false });
    if (code) C.ex[code] = r; else { C.noEx = true; C.row = r; }
  }
  // a home that is no longer in the table falls back to the first place there is, so nothing throws
  let h = home;
  if (!regions[h?.rc]?.cities?.[h?.city]) {
    const rc = Object.keys(regions)[0];
    h = rc ? { rc, city: Object.keys(regions[rc].cities)[0] } : { rc: '', city: '' };
  }
  const svc = {};
  for (const [k, v] of Object.entries(service || {})) svc[specialKey(k)] = v;
  return { home: h, regions, rows, service: svc };
}

/** The table row a parsed number sits on, or null. */
export function rowOf(p, context) {
  const ctx = useCtx(context);
  if (!p?.city) return null;
  const C = ctx.regions[p.rc]?.cities?.[p.city];
  if (!C) return null;
  return (p.ex ? C.ex[p.ex] : C.row) || null;
}

/** First code in `codes` whose letters (or, for a digits-only entry, pad keys) start `rest`. Longest wins. */
function matchCode(rest, codes) {
  const sorted = [...codes].sort((a, b) => b.length - a.length);
  const digits = /^\d/.test(rest);
  return sorted.find((c) => rest.startsWith(digits ? asKeys(c) : c)) || null;
}
const usedLen = (rest, code) => code.length; // letters and pad keys take the same number of characters

/**
 * Read any number, whole or part-typed. The one rule the explainer, picker and dial box share.
 * @param {string} raw
 * @param {object} ctx — from buildNumberContext
 * @returns {{empty?: true, service?: string, entry?: *, done?: boolean, partial?: boolean, bad?: boolean, hint?: string,
 *            rc?: string, city?: string, ex?: string, line?: string, far?: boolean, key?: string}}
 */
export function parseNumber(raw, context) {
  const ctx = useCtx(context);
  const s = compact(raw);
  if (!s) return { empty: true };
  const svc = ctx.service[specialKey(raw)];
  if (svc !== undefined) return { service: specialKey(raw), entry: svc, done: true, key: '#' + specialKey(raw) };
  let rest = s, rc = ctx.home.rc, city = ctx.home.city, far = false;
  if (rest.startsWith('+')) {
    rc = rest.slice(1, 3); rest = rest.slice(3); far = true;
    if (rc.length < 2) return { partial: true, hint: 'A + starts a region code, two digits.' };
    if (!ctx.regions[rc]) return { partial: true, bad: true, hint: `No region uses +${rc}.` };
    const code = matchCode(rest, Object.keys(ctx.regions[rc].cities));
    if (!code) return { rc, partial: true, hint: `${ctx.regions[rc].name}. Next, the city: ${Object.keys(ctx.regions[rc].cities).join(', ')}.` };
    city = code; rest = rest.slice(usedLen(rest, code));
  } else {
    const R = ctx.regions[rc];
    const here = R?.cities?.[city];
    // a home district always wins over another city in the region with the same letters
    if (here && !matchCode(rest, Object.keys(here.ex))) {
      const other = Object.keys(R.cities).filter((c) => c !== city);
      const code = matchCode(rest, other);
      if (code && rest.length > code.length) { city = code; rest = rest.slice(usedLen(rest, code)); far = true; }
    }
  }
  const C = ctx.regions[rc]?.cities?.[city];
  if (!C) return { partial: true, hint: 'Start with a district, or + and a region code.' };
  const lineOf = (t) => t.replace(/\D/g, '').slice(0, LINE_DIGITS);
  const known = Object.keys(C.ex);
  const code = known.length ? matchCode(rest, known) : null;
  if (!code) {
    if (C.noEx && !/^[A-Z]/.test(rest)) {
      const line = lineOf(rest), done = line.length === LINE_DIGITS;
      return { rc, city, line, far, done, partial: !done, key: done ? keyOf(rc, city, '', line) : undefined };
    }
    if (!rest) return { rc, city, partial: true, far, hint: `${C.name}. Next, the district.` };
    const letters = /^[A-Z]+/.exec(rest)?.[0] || '';
    if (letters.length >= 3 || (!letters && rest.length >= 3)) return { rc, city, ex: letters.slice(0, 3), partial: true, far, bad: true, hint: `${letters.slice(0, 3) || rest.slice(0, 3)} isn't a district in ${C.name}.` };
    const could = known.filter((x) => (letters ? x.startsWith(letters) : asKeys(x).startsWith(rest))).slice(0, 6);
    return { rc, city, partial: true, far, hint: could.length ? `Could be: ${could.join(', ')}.` : 'No district starts like that.' };
  }
  const line = lineOf(rest.slice(usedLen(rest, code))), done = line.length === LINE_DIGITS;
  return { rc, city, ex: code, line, far, done, partial: !done, key: done ? keyOf(rc, city, code, line) : undefined };
}

/** The stored identity of a line. Letters, never pad digits, so two spellings can't make two keys. */
export const keyOf = (rc, city, ex, line) => `+${rc}-${city}-${ex || ''}-${line}`;

/** The form two numbers are compared on, or '' for anything that isn't a whole number. */
export function normaliseNumber(raw, ctx) { const p = parseNumber(raw, ctx); return p.done ? p.key : ''; }

/** The form a number is stored and shown in: full when it is a whole number, else as typed. */
export function displayNumber(raw, ctx) { const p = parseNumber(raw, ctx); return p.done ? fullForm(p) : String(raw ?? '').trim(); }

/** Do two typed numbers reach the same line? */
export function sameNumber(a, b, ctx) { const na = normaliseNumber(a, ctx); return !!na && na === normaliseNumber(b, ctx); }

/** The form a number is stored and exported in. */
export function fullForm(p) {
  if (p?.service) return p.service;
  if (!p?.city) return '';
  return `+${p.rc} ${p.city}${p.ex ? ` ${p.ex}-` : '-'}${p.line ?? ''}`;
}

/** What a number looks like from where a given number is from (default: the campaign's home). */
export function seenFrom(p, ctx, from = ctx.home) {
  if (p?.service) return p.service;
  if (!p?.city) return '';
  const tail = p.ex ? `${p.ex}-${p.line}` : `${p.line}`;
  if (p.rc === from.rc && p.city === from.city) return tail;
  if (p.rc === from.rc) return `${p.city}${p.ex ? ' ' : '-'}${tail}`;
  return `+${p.rc} ${p.city}${p.ex ? ' ' : '-'}${tail}`;
}

/** Is this number on a row that isn't listed? It still works; nothing says whose it is. */
export function isUnlisted(p, ctx) { return rowOf(p, ctx)?.Listed === 'no'; }

/**
 * A number in words: district, city, and the region when it isn't home. Never names an owner.
 * @returns {string} "Unlisted number" for a hidden row
 */
export function placeOf(p, ctx) {
  if (!p?.city) return '';
  if (isUnlisted(p, ctx)) return 'Unlisted number';
  const C = ctx.regions[p.rc]?.cities?.[p.city];
  const row = rowOf(p, ctx);
  return [p.ex ? row?.District : null, C?.name, p.rc === ctx.home.rc ? null : ctx.regions[p.rc]?.name].filter(Boolean).join(', ');
}

/** A number written on a row. */
export const numberAt = (row, line) => (row.Code ? `+${row['Region code']} ${row['City code']} ${row.Code}-${line}` : `+${row['Region code']} ${row['City code']}-${line}`);

/** The key of a line on a row. */
export const keyAt = (row, line) => keyOf(row['Region code'], row['City code'], row.Code || '', line);

/** A deterministic random from a seed (mulberry32), so the same seed shows the same numbers. */
function rng(seed) {
  let a = (Number(seed) >>> 0) || 1;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * Free lines on a row: never one held, never one retired.
 * @param {object} row
 * @param {object} o
 * @param {Iterable<string>} [o.taken] — keys held or retired
 * @param {number} [o.count=4]
 * @param {string} [o.near] — a line to sit beside (a coworker's); the first result is the nearest free one after it
 * @param {number} [o.seed]
 * @returns {string[]} line digits. Shorter than `count` only when the row is nearly full.
 */
export function freeLines(row, { taken = [], count = 4, near = null, seed = Date.now() } = {}) {
  const used = new Set(taken); const out = [];
  const free = (l) => !used.has(keyAt(row, l)) && !out.includes(l);
  if (near !== null && near !== undefined && near !== '') {
    const base = Number(near);
    for (let d = 1; d < 10000 && !out.length; d++) { const l = String((base + d) % 10000).padStart(LINE_DIGITS, '0'); if (free(l)) out.push(l); }
  }
  const rand = rng(seed);
  for (let tries = 0; out.length < count && tries < 5000; tries++) { const l = String(1000 + Math.floor(rand() * 9000)); if (free(l)) out.push(l); }
  // a nearly full row: walk it rather than give up
  for (let n = 0; out.length < count && n < 10000; n++) { const l = String(n).padStart(LINE_DIGITS, '0'); if (free(l)) out.push(l); }
  return out.slice(0, count);
}

/** The next step down the picker: the rows still possible after these choices. */
export const PICK_STEPS = Object.freeze([
  { key: 'rc', label: 'Region', col: 'Region code', name: (r) => r.Region, blank: '' },
  { key: 'state', label: 'State', col: 'State', name: (r) => r.State, blank: 'No state' },
  { key: 'city', label: 'City', col: 'City code', name: (r) => r.City, blank: '' },
  { key: 'area', label: 'Area', col: 'Area', name: (r) => r.Area, blank: 'Whole city' },
  { key: 'code', label: 'District', col: 'Code', name: (r) => r.District, blank: 'No district' },
]);
/** Rows that fit the first `upto` steps of a path. */
export const rowsAtStep = (rows, path, upto) => rows.filter((r) => PICK_STEPS.slice(0, upto).every((w) => (r[w.col] || '') === (path[w.key] ?? '')));
/** A row as a picker path. */
export const pathOf = (row) => Object.fromEntries(PICK_STEPS.map((w) => [w.key, row[w.col] || '']));

// ═════════════════════════════════════════════════
//  An Organization field → an office in the table
// ═════════════════════════════════════════════════

const ORG_NOISE = new Set(['the', 'inc', 'corp', 'corporation', 'co', 'company', 'ltd', 'llc', 'group', 'international', 'intl', 'security', 'division', 'global', 'holdings', 'of', 'and']);
export const orgWords = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w && !ORG_NOISE.has(w));
/** The form a remembered decision is stored under. */
export const orgKey = (t) => orgWords(t).join(' ') || String(t || '').trim().toLowerCase();

function wordDist(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) { const cur = [i]; for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return prev[b.length];
}

/**
 * Match free text against the corporations in the table. Never guesses silently.
 * @param {string} org — the contact's Organization field
 * @param {string[]} corps — office names
 * @param {Object<string, string>} [remembered] — orgKey → office name, or '' for "not a corporation"
 * @returns {{state: 'none'|'ok'|'guess'|'miss'|'notCorp', corp?: string, guess?: string, remembered?: boolean}}
 */
export function matchOrganization(org, corps, remembered = {}) {
  if (!String(org || '').trim()) return { state: 'none' };
  const k = orgKey(org);
  if (Object.prototype.hasOwnProperty.call(remembered, k)) return remembered[k] ? { state: 'ok', corp: remembered[k], remembered: true } : { state: 'notCorp' };
  const words = orgWords(org), list = corps.map((c) => ({ c, w: orgWords(c) }));
  const full = list.find((x) => x.w.length && x.w.every((y) => words.includes(y)));
  if (full) return { state: 'ok', corp: full.c };
  const part = list.find((x) => x.w[0] && words.includes(x.w[0])) || list.find((x) => x.w[0] && x.w[0].length > 4 && words.some((y) => wordDist(y, x.w[0]) <= 2));
  return part ? { state: 'guess', guess: part.c } : { state: 'miss' };
}
