/**
 * Call history the GM writes by hand — the rules. Pure: no Foundry globals.
 * @file scripts/utils/callHistory.js
 * @module night-city-messenger
 * @description Admin → Phone → Edit a call log (tester round 2026-11-06: "this player's character would certainly have
 *   a bunch of calls, voicemails, etc they have kept before the session"; then "creating the logs from scratch … who
 *   and what, and transcript if there is one").
 *
 *   A written CALL has two ends, From and To. Each end is a party `{actorId, contactId, name, number}`; an end with an
 *   actor or contact id is a PERSON and the call is written into their inbox, the way a real call is: one `callLog`
 *   page per person, both with the same call id (`w:<id>`), so Admin → Call log shows it once and a delete takes both.
 *   The page keeps the call itself (`callLog.entry`) so the editor can open it again. A voicemail also becomes a real
 *   `voicemail` page in the box of the person it was left for (To).
 *
 *   An ENTRY of the first version (2.3 dev builds, and the legacy `phoneWrittenLogs` setting, migration v9) was one
 *   side of a call: `{dir, who, n, whoActorId, whoContactId}` relative to the log's owner. `sanitizeCall` reads both.
 */

import { makeVoicemail } from './voicemail.js';
import { maskCaller } from './callNet.js';
import { dateBands, namedGroups } from './logFolds.js';

export const HISTORY_OUTS = Object.freeze(['Answered', 'Missed', 'Declined', 'Voicemail', 'Dropped']);
export const HISTORY_OUTCOMES = Object.freeze({ Answered: 'answered', Missed: 'missed', Declined: 'declined', Voicemail: 'voicemail', Dropped: 'dropped' });
export const VM_KINDS = Object.freeze(['typed', 'tts', 'audio']);
export const LINE_MAX = 500, LINES_MAX = 300;
/** The call id of a written call: never collides with a real call's id. */
export const writtenCallId = (id) => `w:${id}`;
export const isWrittenCallId = (callId) => String(callId || '').startsWith('w:');

const str = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
/** "m:ss" → seconds. */
export const lengthSeconds = (t) => { const m = /^(\d+):(\d{1,2})$/.exec(String(t ?? '').trim()); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; };

/** One end of a call, safe. */
export const sanitizeParty = (p = {}) => ({ actorId: str(p?.actorId, 40) || null, contactId: str(p?.contactId, 40) || null, name: str(p?.name, 80), number: str(p?.number, 40) });
/** The inbox owner an end stands for, or null (a name / number nobody holds). */
export const partyOwner = (p) => p?.actorId || p?.contactId || null;
const sameParty = (a, b) => !!partyOwner(a) && partyOwner(a) === partyOwner(b);

/**
 * One call, every field safe. Reads a call (`from` / `to`) or a first-version entry (`dir` / `who`, placed against
 * `owner`, the log it was written in). A voicemail keeps its words / kind / recording / heard; any other call drops them.
 * @param {object} x
 * @param {{owner?: object, newId?: Function}} [o]
 */
export function sanitizeCall(x = {}, { owner = null, newId = () => Math.random().toString(36).slice(2, 12) } = {}) {
  const v = x && typeof x === 'object' ? x : {};
  let from = v.from, to = v.to;
  if (!from && !to && ('dir' in v || 'who' in v)) {
    const other = { actorId: v.whoActorId, contactId: v.whoContactId, name: v.who, number: v.n };
    const me = owner || {};
    [from, to] = v.dir === 'out' ? [me, other] : [other, me];
  }
  const out = HISTORY_OUTS.includes(v.out) ? v.out : 'Answered';
  const vm = out === 'Voicemail', talked = out === 'Answered' || out === 'Voicemail';
  const kind = VM_KINDS.includes(v.kind) ? v.kind : 'typed';
  const lines = (Array.isArray(v.lines) ? v.lines : []).map((l) => ({ side: l?.side === 'callee' ? 'callee' : 'caller', text: String(l?.text ?? '').trim().slice(0, LINE_MAX) })).filter((l) => l.text).slice(0, LINES_MAX);
  const net = v.net && typeof v.net === 'object' && (v.net.id || v.net.name) ? { id: str(v.net.id, 40), name: str(v.net.name, 60), color: str(v.net.color, 40) } : null;
  return {
    id: str(v.id, 40) || newId(),
    from: sanitizeParty(from), to: sanitizeParty(to),
    out, when: str(v.when, 40), len: talked && /^\d+:\d{1,2}$/.test(String(v.len ?? '').trim()) ? String(v.len).trim() : '',
    ty: str(v.ty, 40) || 'std',
    lines: out === 'Answered' || out === 'Dropped' ? lines : [],
    net, scene: str(v.scene, 80),
    anon: !!v.anon,
    why: out === 'Dropped' ? str(v.why, 160) : '',
    heardBy: (Array.isArray(v.heardBy) ? v.heardBy : String(v.heardBy ?? '').split(',')).map((h) => str(typeof h === 'object' ? h?.name : h, 60)).filter(Boolean).slice(0, 12),
    vm: vm ? String(v.vm ?? '').trim().slice(0, 1000) : '',
    kind: vm ? kind : 'typed', audio: vm && kind === 'audio' ? str(v.audio, 900) : '', voice: vm ? str(v.voice, 120) : '',
    heard: vm ? !!v.heard : false,
  };
}

/** Is the call complete enough to save? The problem in words, or ''. */
export function callProblem(c) {
  if (!partyOwner(c.from) && !partyOwner(c.to)) return 'One end has to be someone with a phone: pick a character or an NPC for From or To.';
  if (sameParty(c.from, c.to)) return 'From and To are the same person.';
  if (!c.when || Number.isNaN(Date.parse(c.when))) return 'Give it a time.';
  if (c.out === 'Voicemail') {
    if (!partyOwner(c.to)) return 'A voicemail is left for someone: pick who it was for in To.';
    if (c.kind === 'audio' && !c.audio) return 'Pick the recording, or switch it to Typed or Read out.';
    if (c.kind !== 'audio' && !c.vm) return 'Write what they said.';
  }
  return '';
}

/** The inboxes a call is written into: each end that is a person, From first. */
export const callOwners = (c) => [...new Set([partyOwner(c.from), partyOwner(c.to)].filter(Boolean))];

/**
 * The `callLog` flag for one end's page: the shape a real call's page has, plus `written` and the call itself.
 * The person called sees a withheld caller as "Unknown caller", exactly as for a real call.
 * @param {object} c — a sanitized call @param {'from'|'to'} side — whose page this is
 */
export function callToLog(c, side) {
  const t = Date.parse(c.when) || 0;
  const mine = side === 'from' ? c.from : c.to, other = side === 'from' ? c.to : c.from;
  const hide = c.anon && side === 'to';
  const outcome = HISTORY_OUTCOMES[c.out] || 'answered';
  return {
    callId: writtenCallId(c.id), written: true, entry: c,
    direction: side === 'from' ? 'out' : 'in', me: mine, other: hide ? maskCaller(other) : other,
    from: hide ? maskCaller(c.from) : { ...c.from, ...(c.anon ? { anon: true } : {}) }, to: c.to,
    // the person called sees a call that only rang as missed, like a real call
    outcome: side === 'to' && outcome === 'declined' ? 'missed' : outcome,
    seconds: lengthSeconds(c.len), gameTime: c.when, startedAt: t, answeredAt: c.len ? t : null,
    seen: true, lines: c.lines, mode: c.lines.length ? 'type' : 'loud',
    net: c.net, scene: c.scene,
    dropReason: c.out === 'Dropped' ? c.why : (c.out === 'Voicemail' && c.vm ? `"${c.vm}"` : ''),
    heardBy: c.heardBy.map((name) => ({ name })),
    ...(hide ? { anonCall: true } : {}), typeId: c.ty,
  };
}

/** Whose box a written voicemail lands in: the person it was left for (To), or null. */
export const voicemailBoxOf = (c) => (c.out === 'Voicemail' ? partyOwner(c.to) : null);

/** The `voicemail` flag for a call (null when it is not a voicemail or has nothing in it). */
export function callToVoicemail(c, { voice = '', at = 0 } = {}) {
  if (c.out !== 'Voicemail' || !partyOwner(c.to)) return null;
  const from = c.anon ? maskCaller(c.from) : c.from;
  const vm = makeVoicemail({ vmId: `vm-w-${c.id}`, callId: writtenCallId(c.id), from, to: c.to, text: c.vm,
    kind: c.kind, voice: c.voice || voice, at: at || Date.parse(c.when) || 0, gameTime: c.when, audio: c.audio });
  return vm ? { ...vm, heard: !!c.heard, written: true } : null;
}

const OUT_OF = { answered: 'Answered', missed: 'Missed', busy: 'Missed', 'no-signal': 'Missed', 'not-in-service': 'Missed', declined: 'Declined', voicemail: 'Voicemail', dropped: 'Dropped' };
const mmss = (sec) => (sec > 0 ? `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}` : '');
/**
 * A call that happened in play (a real `callLog` page), shaped like a written call so one list shows both. Read-only:
 * the editor can copy it into the form, never save it back over the real page.
 * @param {object} l — the callLog flag @param {object} [vm] — the voicemail left on it, if any
 */
export function realCallAsEntry(l = {}, vm = null) {
  const out = OUT_OF[l.outcome] || 'Answered';
  return sanitizeCall({ id: String(l.callId || '').slice(0, 40), from: l.from, to: l.to, out, when: l.gameTime || (l.startedAt ? new Date(l.startedAt).toISOString() : ''),
    len: mmss(l.seconds), lines: l.lines, net: l.net, scene: l.scene, anon: !!(l.from?.anon || l.anonCall), why: l.dropReason || '',
    heardBy: l.heardBy, vm: vm?.text || '', kind: vm?.kind, audio: vm?.audio, heard: vm?.heard }, { newId: () => '' });
}

/** The same call to someone else: a copy with a new id, `to` swapped for them (a fixer calling the whole crew). */
export const copyCallTo = (c, to, id) => sanitizeCall({ ...c, id, to, heard: c.heard });

/** A first-version entry from the legacy `phoneWrittenLogs` setting, as a call in its owner's log. */
export const legacyCall = (x, owner) => sanitizeCall({ ...x, kind: 'typed', heard: true }, { owner });

/**
 * A pasted script → transcript lines. "Name: text" goes to the side whose name it is (or "caller"/"from",
 * "callee"/"to"); a line with no name, or a name that is neither, takes the other side from the line before.
 * @param {string} text @param {{fromName?: string, toName?: string}} names
 */
export function parseScript(text, { fromName = '', toName = '' } = {}) {
  const low = (s) => String(s || '').trim().toLowerCase();
  const fromKeys = new Set(['caller', 'from', low(fromName), low(fromName).split(/\s+/)[0]].filter(Boolean));
  const toKeys = new Set(['callee', 'to', low(toName), low(toName).split(/\s+/)[0]].filter(Boolean));
  const out = [];
  let last = 'callee';
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^([^:]{1,40}):\s*(.*)$/.exec(line);
    let side = null, words = line;
    if (m) { const k = low(m[1]); if (fromKeys.has(k)) side = 'caller'; else if (toKeys.has(k)) side = 'callee'; if (side) words = m[2]; }
    if (!side) side = last === 'caller' ? 'callee' : 'caller';
    if (words.trim()) out.push({ side, text: words.trim().slice(0, LINE_MAX) });
    last = side;
  }
  return out.slice(0, LINES_MAX);
}

/** Transcript lines → a script (one "Name: text" per line). */
export const scriptOf = (c) => (c.lines || []).map((l) => `${(l.side === 'caller' ? c.from.name : c.to.name) || (l.side === 'caller' ? 'Caller' : 'Callee')}: ${l.text}`).join('\n');

/* ─── spreadsheet ─── */

export const HISTORY_CSV_COLS = Object.freeze(['From', 'From number', 'To', 'To number', 'Outcome', 'When', 'Length', 'Line type', 'Network', 'Where', 'Withheld',
  'Drop reason', 'Heard by', 'Transcript', 'Voicemail', 'Voicemail kind', 'Recording', 'Heard']);

/** Rows for export (the header first). */
export function historyCsvRows(calls) {
  return [HISTORY_CSV_COLS.slice(), ...(calls || []).map((c) => [c.from.name, c.from.number, c.to.name, c.to.number, c.out, c.when, c.len, c.ty || 'std',
    c.net?.name || '', c.scene, c.anon ? 'yes' : '', c.why, c.heardBy.join(', '), scriptOf(c), c.vm,
    c.out === 'Voicemail' ? c.kind : '', c.audio || '', c.out === 'Voicemail' ? (c.heard ? 'yes' : 'no') : ''])];
}

const yes = (v) => /^(y|yes|true|1|heard)$/i.test(String(v ?? '').trim());
const pickOut = (v) => HISTORY_OUTS.find((o) => o.toLowerCase() === String(v ?? '').trim().toLowerCase()) || '';
const pickDir = (v) => { const s = String(v ?? '').trim().toLowerCase(); return ['in', 'incoming', 'from'].includes(s) ? 'in' : ['out', 'outgoing', 'to'].includes(s) ? 'out' : ''; };
const pickKind = (v) => { const s = String(v ?? '').trim().toLowerCase(); return s === 'tts' || s === 'read out' ? 'tts' : s === 'audio' || s === 'recording' ? 'audio' : 'typed'; };

/**
 * Parse a spreadsheet into calls. Columns are found by their header (any order, any case); unknown columns are
 * ignored. A row that cannot be read is skipped and named in `problems`, never half-imported. A file in the first
 * layout (Direction / Who / Number) is read against `owner`, the log it is imported into.
 * @param {string[][]} table — parsed CSV (utils/csv.js parseCsv), header first
 * @param {{people?: {id: string, name: string, actor?: boolean, number?: string}[], types?: string[], nets?: {id: string, name: string, color?: string}[], owner?: object, newId?: Function}} o
 * @returns {{calls: object[], problems: string[]}}
 */
export function historyFromTable(table, { people = [], types = [], nets = [], owner = null, newId } = {}) {
  const [head, ...rows] = Array.isArray(table) ? table : [];
  if (!head) return { calls: [], problems: ['The file is empty.'] };
  const idx = (c) => head.findIndex((h) => String(h ?? '').trim().toLowerCase() === c.toLowerCase());
  const has = (c) => idx(c) >= 0;
  if (!has('When') || !has('Outcome')) return { calls: [], problems: ['It needs at least a When and an Outcome column. Export a log to see the layout.'] };
  const firstLayout = !has('From') && !has('To') && (has('Direction') || has('Who'));
  const get = (r, c) => { const i = idx(c); return i >= 0 ? String(r[i] ?? '').trim() : ''; };
  const person = (name, number) => {
    const p = name ? people.find((x) => x.name.toLowerCase() === name.toLowerCase()) : null;
    return p ? { actorId: p.actor ? p.id : null, contactId: p.actor ? null : p.id, name: p.name, number: number || p.number || '' } : { name, number };
  };
  const calls = [], problems = [];
  rows.forEach((r, i) => {
    if (!r || r.every((x) => !String(x ?? '').trim())) return;
    const line = i + 2;
    const out = pickOut(get(r, 'Outcome'));
    if (!out) { problems.push(`Row ${line}: Outcome must be one of ${HISTORY_OUTS.join(', ')}.`); return; }
    const when = get(r, 'When');
    if (!when || Number.isNaN(Date.parse(when))) { problems.push(`Row ${line}: When is not a date (use 2045-03-12T21:40:00Z).`); return; }
    let from, to;
    if (firstLayout) {
      if (!owner) { problems.push(`Row ${line}: this file has no From / To columns, so import it into one person's log.`); return; }
      const dirRaw = get(r, 'Direction'), dir = dirRaw ? pickDir(dirRaw) : 'in';
      if (!dir) { problems.push(`Row ${line}: Direction is in or out.`); return; }
      const other = person(get(r, 'Who'), get(r, 'Number'));
      [from, to] = dir === 'out' ? [owner, other] : [other, owner];
    } else {
      from = person(get(r, 'From'), get(r, 'From number'));
      to = person(get(r, 'To'), get(r, 'To number'));
    }
    const ty = get(r, 'Line type'), netName = get(r, 'Network');
    const net = netName ? (nets.find((n) => n.name.toLowerCase() === netName.toLowerCase()) || { id: '', name: netName }) : null;
    const c = sanitizeCall({ from, to, out, when: new Date(Date.parse(when)).toISOString(), len: get(r, 'Length'), ty: types.includes(ty) ? ty : 'std',
      net, scene: get(r, 'Where'), anon: yes(get(r, 'Withheld')), why: get(r, 'Drop reason'), heardBy: get(r, 'Heard by'),
      lines: parseScript(get(r, 'Transcript'), { fromName: from?.name, toName: to?.name }),
      vm: get(r, 'Voicemail'), kind: pickKind(get(r, 'Voicemail kind')), audio: get(r, 'Recording'), heard: yes(get(r, 'Heard')) }, newId ? { newId } : {});
    const bad = callProblem(c);
    if (bad) { problems.push(`Row ${line}: ${bad}`); return; }
    calls.push(c);
  });
  return { calls, problems };
}

/* ─── the Call history list: search, Show, Group, dates, folds (dev 2026-11-06: "that side will get crowded") ─── */

export const HISTORY_SHOW = Object.freeze([['all', 'Everything'], ['play', 'In play'], ['yours', 'Yours'], ['in', 'Incoming'], ['out', 'Outgoing'],
  ['vm', 'Voicemail'], ['missed', 'Missed or declined'], ['said', 'Has a transcript']]);
export const HISTORY_GROUPS = Object.freeze([['date', 'By date'], ['person', 'By person'], ['none', 'No groups']]);

const partyKey = (p) => p?.actorId || p?.contactId || (p?.name ? `n:${p.name}` : '') || (p?.number ? `#:${p.number}` : '');

/**
 * The list as the Call history shows it: filtered, searched, then grouped by date band or by the other person.
 * Folding follows the Call log's rules (logFolds.js): the first group open, the GM's own folds win, a filter opens all.
 * @param {object[]} calls — sanitized calls, real ones flagged `real`
 * @param {{me?: object, q?: string, show?: string, group?: string, from?: string, to?: string, now?: string, shut?: Set, open?: Set, limits?: object, dayLabel?: Function}} o
 * @returns {{groups: object[], total: number, of: number, counts: object, forced: boolean}}
 */
export function historyList(calls, { me = {}, q = '', show = 'all', group = 'date', from = '', to = '', now, shut = new Set(), open = new Set(), limits = {}, dayLabel = (d) => d } = {}) {
  const mine = partyKey(me);
  const all = (calls || []).map((c) => {
    const inbound = !!mine && partyKey(c.to) === mine;
    return { c, inbound, other: inbound ? c.from : c.to };
  });
  const passes = (x, k) => ({ all: true, play: !!x.c.real, yours: !x.c.real, in: x.inbound, out: !x.inbound, vm: x.c.out === 'Voicemail',
    missed: x.c.out === 'Missed' || x.c.out === 'Declined', said: x.c.lines.length > 0 }[k] ?? true);
  const counts = Object.fromEntries(HISTORY_SHOW.map(([k]) => [k, all.filter((x) => passes(x, k)).length]));
  const needle = String(q || '').trim().toLowerCase();
  const lower = from ? String(from).slice(0, 10) : '', upper = to ? String(to).slice(0, 10) : '';
  const shown = all.filter((x) => {
    if (!passes(x, show)) return false;
    const day = String(x.c.when || '').slice(0, 10);
    if (lower && day < lower) return false;
    if (upper && day > upper) return false;
    if (!needle) return true;
    const c = x.c;
    return [c.from.name, c.from.number, c.to.name, c.to.number, c.vm, c.scene, c.net?.name, c.why, c.out, ...c.lines.map((l) => l.text)].join(' ').toLowerCase().includes(needle);
  });
  const forced = !!needle || show !== 'all' || !!lower || !!upper;
  const common = { dateOf: (x) => x.c.when, isHot: (x) => x.c.out === 'Missed', shut, open, forced, limits };
  let groups;
  if (group === 'person') {
    groups = namedGroups(shown, { ...common, prefix: 'lg:p:', keysOf: (x) => [x.other.name || x.other.number || 'Unknown'], head: (k) => ({ label: k }) });
  } else if (group === 'none') {
    const list = [...shown].sort((a, b) => String(b.c.when).localeCompare(String(a.c.when)));
    const lim = limits['lg:all'] || 60;
    groups = [{ key: 'lg:all', label: '', flat: true, total: list.length, hot: 0, shut: false, shown: Math.min(lim, list.length), hidden: Math.max(0, list.length - lim), days: [{ day: '', label: '', divider: false, rows: list.slice(0, lim) }] }];
  } else {
    groups = dateBands(shown, { ...common, now, dayLabel, prefix: 'lg:' });
  }
  return { groups, total: shown.length, of: all.length, counts, forced };
}
