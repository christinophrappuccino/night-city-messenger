/**
 * Agent → Calls (dev-approved mock dev/mockups/calls-tab-mock.html; design dev/design/CALLS.md §3).
 * @file scripts/ui/MessageViewer/callsTab.js
 * @module night-city-messenger
 * @description Everything the Calls tab needs, kept out of MessageViewerApp: the context (`buildCallsContext`),
 *   the DOM wiring for the dialer and the number picker (`wireCallsTab` — typing never re-renders), and the clicks
 *   (`handleCallsAction`, every `calls-*` data-action). The viewer calls these three and holds one state object,
 *   `viewer._calls`.
 *
 *   Rules kept here: a name shows only when the person is in this character's contacts (otherwise the number); only
 *   people WITH a number appear in speed dial and the dial matches; the Call button arms as you type (empty → a
 *   number → a contact) and decodes CALL into DIAL ▸ on hover.
 */

import { ncmNotify, tipText } from '../../utils/notify.js';
import { MODULE_ID } from '../../utils/constants.js';
import { formatCyberDate, getPlayerCharacters } from '../../utils/helpers.js';
import { showNamePicker } from '../../utils/namePicker.js';
import { PLAN_NAMES, holdsItem } from '../../utils/phoneEmergency.js';
import { splitExtension, savedContactFor, officeRowOf, normaliseNumber, parseNumber, seenFrom, fullForm, placeOf, isUnlisted, rowOf, numberAt, asKeys, PICK_STEPS, rowsAtStep, pathOf } from '../../utils/phoneNumbering.js';
import { callProfile, signalLine } from '../../utils/callProfile.js';
import { formatDuration } from '../../utils/callModel.js';
import { DIAL_SVG } from '../Calls/CallHud.js';
import { dateBands, searchSnippet, markHit, BAND_PAGE } from '../../utils/logFolds.js';
import { GREETING_KINDS, GREETING_LABELS, DEFAULT_GREETING, GREETING_MAX, greetingFor, greetingLink, isLinkedGreeting } from '../../utils/voicemail.js';
import { speak, voices, canSpeak } from '../Calls/speech.js';
import { VoiceRecorder, micStatus, blobToBase64, playAudio } from '../Calls/recorder.js';
import { themedConfirm, themedPrompt } from '../../utils/adminTheme.js';
import { dialogBodyHtml } from '../../utils/dialogBody.js';

const KEYPAD = [['1', ''], ['2', 'ABC'], ['3', 'DEF'], ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'], ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'], ['+', ''], ['0', '+'], ['#', '']]
  .map(([k, l]) => ({ k, l }));

/** What a list can be narrowed to. */
export const CALL_SHOW = [['all', 'Everything'], ['in', 'Incoming'], ['out', 'Outgoing'], ['answered', 'Answered'], ['noanswer', 'No answer'], ['dropped', 'Dropped'], ['words', 'Has a transcript'], ['withheld', 'Withheld number']];
export const VM_SHOW = [['all', 'Everything'], ['new', 'New'], ['heard', 'Heard']];
const showsCall = (r, k) => ({ all: true, in: r.dir !== 'out', out: r.dir === 'out', answered: r.outcome === 'answered', noanswer: ['missed', 'declined', 'busy'].includes(r.outcome), dropped: ['dropped', 'no-signal'].includes(r.outcome), words: r.transcript.length > 0, withheld: r.withheld }[k] ?? true);
const dayText = (d) => formatCyberDate(`${d}T12:00:00.000Z`, { dateOnly: true });
const gameNow = () => { try { return game.nightcity?.timeService?.getCurrentTime?.() || new Date().toISOString(); } catch { return new Date().toISOString(); } };
const GLYPHS = '!<>-_/[]{}=+*^?#01ABCDEFXZ';

/** The viewer's calls state, created on first use. */
export function callsState(viewer) {
  viewer._calls ??= { view: 'main', filter: 'all', q: '', show: 'all', folds: {}, limits: {}, seed: Date.now(), path: null, level: null, picked: null, typed: '', as: null, mode: null, addKind: 'extra', addLabel: '', scroll: {} };
  return viewer._calls;
}

/** The owner whose line and log this Agent shows: a character, or (GM) a directory contact's inbox. */
function owner(viewer) {
  const id = viewer.actorId;
  if (!id) return null;
  if (game.actors?.get(id)) return { actorId: id, contactId: null };
  return game.nightcity?.masterContactService?.getContact?.(id) ? { actorId: null, contactId: id } : null;
}

/** This character's contacts that have a number: [{name, number, normal, img}]. */
export function phoneBook(viewer) {
  const s = game.nightcity?.callService;
  const home = s?.homeCode;
  const actor = viewer.actorId ? game.actors?.get(viewer.actorId) : null;
  const list = (actor?.getFlag?.(MODULE_ID, 'contacts') || []).filter((c) => c.phone)
    .map((c) => ({ name: c.name || c.phone, number: c.phone, normal: normaliseNumber(c.phone, home), img: c.portrait || c.customImg || '' }));
  // an NPC's Agent: the people that NPC knows (utils/npcKnows.js), with a number — its own phone book
  const mcs = game.nightcity?.masterContactService;
  const npc = actor && !actor.hasPlayerOwner ? mcs?.getByActorId?.(actor.id) : (!actor && viewer.actorId ? mcs?.getContact?.(viewer.actorId) : null);
  if (npc && s) {
    for (const k of mcs.npcKnows?.(npc.id) || []) {
      const number = s.numberOfContact(k.id) || (k.actorId ? s.numberOf(k.actorId) : '');
      const n = normaliseNumber(number, home);
      if (n && !list.some((x) => x.normal === n)) list.push({ name: k.name, number, normal: n, img: k.portrait || '', known: true });
    }
  }
  if (game.user.isGM) {
    // the GM knows every number in the directory
    for (const l of Object.values(s?.lines?.() || {})) {
      const n = normaliseNumber(l.number, home);
      if (!list.some((x) => x.normal === n)) list.push({ name: l.owner?.name || l.number, number: l.number, normal: n, img: '' });
    }
  }
  return list;
}

/** A log row as this character may see it: a name only for someone in its contacts. */
/** A number the way this table reads it: short from home, as stored when it isn't a whole number. */
function shortNumber(raw, ctx) { const p = parseNumber(raw, ctx); return p.done ? seenFrom(p, ctx?.regions ? ctx : game.nightcity?.callService?.numberContext) || String(raw ?? '') : String(raw ?? ''); }

/**
 * The other party of a log row as this character may see it — the SAME rule as the call screen (CallHud._other):
 * a contact in their list (matched by number, or by who it is), else the name the line's type shows everyone, else
 * the number. `saved` = this number is already in their contacts; otherwise the row offers to save it, pre-filled
 * with what the call showed (`offerName` / `offerImg`), or to put it on the contact it came from (`addTo`).
 * (Tester 2026-11-07: a call from a contact showed only a number, with a blank Save as the one way to fix it.)
 */
export function shownOther(row, book, home, contacts = []) {
  const o = row.other || {};
  const number = o.number || '';
  const n = normaliseNumber(number, home);
  const hit = n ? book.find((b) => b.normal === n) : null;
  if (hit) return { name: hit.name, img: hit.img, number, known: true, saved: true };
  if (game.user.isGM) return { name: o.name || shortNumber(number, home) || 'Unknown', img: '', number, known: true, saved: true };
  const short = shortNumber(number, home) || 'Unknown number';
  const shownName = o.showOnly === 'name' ? (o.name || '') : '';
  const shownImg = !o.anon && (o.showOnly === 'name' || o.face) ? (o.img || '') : '';
  const c = o.anon ? null : savedContactFor(contacts, o, { home });
  if (c) return { name: c.name || shownName || short, img: c.portrait || c.customImg || shownImg, number, known: true, saved: false, addTo: c.id || '', addToName: c.name || '', replaces: c.phone || '' };
  // who the number belongs to, kept on a contact saved from here so their mail later finds it (tester 2026-11-08: Save
  // from a call, then Add from their mail, made two contacts). Never for a masked caller, or a line that stands for
  // something other than its holder (a burner, a business, a payphone).
  const link = !o.anon && !o.asLine ? { linkContact: o.contactId || '', linkActor: o.contactId ? '' : (o.actorId || '') } : { linkContact: '', linkActor: '' };
  if (shownName) return { name: shownName, img: shownImg, number, known: true, saved: false, offerName: shownName, offerImg: shownImg, ...link };
  return { name: short, img: '', number, known: false, saved: false, offerName: '', offerImg: '', ...link };
}

/** A number as coloured parts, with its place in words on hover. Escaped here, so templates print it raw. */
export function numHtml(raw, ctx, { full = false } = {}) {
  const p = parseNumber(raw, ctx);
  if (p.service) return `<span class="ncm-num" data-tooltip="${tipText(p.entry?.name || p.service)}"><span class="x">${esc(p.service)}</span></span>`;
  if (!p.done) return `<span class="ncm-num"><span class="l">${esc(raw)}</span></span>`;
  let rest = full ? fullForm(p) : seenFrom(p, ctx);
  const parts = [];
  const take = (cls, re) => { const m = rest.match(re); if (m) { parts.push(`<span class="${cls}">${esc(m[0])}</span>`); rest = rest.slice(m[0].length); } };
  take('r', /^\+\d+\s/);
  if (p.ex) { take('c', /^[A-Z]{2,3}\s(?=[A-Z]{3}-)/); take('x', /^[A-Z]{3}-/); } else take('c', /^[A-Z]{2,3}-/);
  parts.push(`<span class="l">${esc(rest)}</span>`);
  return `<span class="ncm-num" data-tooltip="${tipText(placeOf(p, ctx))}">${parts.join('')}</span>`;
}

const lineValue = (l, home) => l.normal || normaliseNumber(l.number, home);

const DIRS = {
  out: { icon: 'fa-arrow-up', word: 'Out', cls: 'out' },
  in: { icon: 'fa-arrow-down', word: 'In', cls: 'in' },
  missed: { icon: 'fa-phone-slash', word: 'Missed', cls: 'miss' },
};
const OUTCOME_WORDS = { voicemail: 'voicemail', missed: 'no answer', declined: 'declined', busy: 'busy', dropped: 'dropped', 'no-signal': 'no signal', 'not-in-service': 'not in service' };

/**
 * Pure: turn log entries into the tab's rows, in date bands, with counts. Search reads only what this character may see:
 * a name from their own contacts, the number, the network, the reason, the words on their own calls.
 */
export function buildLogRows(log, { book = [], contacts = [], home = '+1', filter = 'all', show = 'all', q = '', now, shut, open, limits = {}, dayLabel = (d) => d } = {}) {
  const rows = log.map((l) => {
    const missed = l.direction === 'in' && l.outcome === 'missed';
    const dir = missed ? 'missed' : l.direction === 'out' ? 'out' : 'in';
    const other = shownOther(l, book, home, contacts);
    const talked = l.outcome === 'answered' && l.seconds;
    // the transcript as THIS character may read it: "You" for their side, the other side as the log names them
    const mySide = l.direction === 'out' ? 'caller' : 'callee';
    const transcript = (l.lines || []).filter((x) => x?.text).map((x) => ({ who: x.side === mySide ? 'You' : other.name, mine: x.side === mySide, text: x.text }));
    return { ...l, dir, dirInfo: DIRS[dir], other, missed, unseen: missed && !l.seen, transcript,
      withheld: l.direction === 'in' && !!l.anonCall && !l.traced, why: l.dropReason || '',
      detail: talked ? formatDuration(l.seconds) : (OUTCOME_WORDS[l.outcome] || ''),
      day: (l.gameTime || '').slice(0, 10) };
  });
  const counts = { all: rows.length, missed: rows.filter((r) => r.missed).length, unseen: rows.filter((r) => r.unseen).length,
    in: rows.filter((r) => r.dir === 'in').length, out: rows.filter((r) => r.dir === 'out').length };
  const needle = String(q || '').trim().toLowerCase();
  const inTab = rows.filter((r) => filter === 'all' || (filter === 'missed' ? r.missed : r.dir === filter));
  const shown = inTab.filter((r) => showsCall(r, show) && (!needle || [r.other.name, r.other.number, r.net?.name, r.why, ...r.transcript.map((x) => x.text)].join(' ').toLowerCase().includes(needle)));
  for (const r of shown) { r.nameHtml = markHit(r.other.name, q); r.hitHtml = needle ? markHit(searchSnippet(q, r.transcript.map((x) => x.text)), q) : ''; }
  const forced = !!needle || show !== 'all';
  const bands = dateBands(shown, { now, dateOf: (r) => r.gameTime || '', dayLabel, isHot: (r) => r.unseen, shut, open, forced, limits });
  return { bands, counts, total: shown.length, of: inTab.length, forced };
}

/** Pure: speed dial — the numbers called most (known contacts only), then other contacts with a number. Max 6. */
export function speedDial(log, book, home) {
  const tally = new Map();
  for (const l of log) {
    const n = normaliseNumber(l.other?.number, home);
    if (n) tally.set(n, (tally.get(n) || 0) + 1);
  }
  return [...book].sort((a, b) => (tally.get(b.normal) || 0) - (tally.get(a.normal) || 0) || Number(!!b.known) - Number(!!a.known) || a.name.localeCompare(b.name)).slice(0, 6)
    .map((b) => ({ ...b, initials: b.name.replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '#' }));
}

/** The context for the Calls tab (built only while it is open). */
/** The picker: one step on screen at a time, all five always, numbers only after the last. */
function pickerContext(s, st) {
  const rows = s.pickRows();
  if (!rows.length) return { picker: true, noRows: true };
  const start = s.startRow();
  // a path that no longer reaches a row (the table changed, or a step was re-picked) goes back to the start row
  if (!st.path || (!st.level && !rowsAtStep(rows, st.path, PICK_STEPS.length).length)) { st.path = pathOf(start); st.level = null; }
  const cur = PICK_STEPS.findIndex((x) => x.key === st.level);
  const trail = PICK_STEPS.map((x, i) => {
    const r = rowsAtStep(rows, st.path, i + 1)[0];
    return { key: x.key, label: x.label, here: st.level === x.key, reached: cur < 0 || i <= cur, value: st.level === x.key ? 'Choosing…' : r ? (x.name(r) || x.blank || '—') : '—' };
  }).filter((x) => x.reached);
  const mode = st.mode || 'first';
  const base = { picker: true, trail, ownDigits: s.rules.ownDigits, addMode: mode === 'add', changeMode: mode === 'change', asksGm: mode === 'add' ? (!!own?.actorId && s.extraLeft(own.actorId) < 1) : mode === 'change' && s.rules.changeNeedsGm && !game.user?.isGM, addLabel: st.addLabel || '', addBurner: st.addKind === 'burner' };
  if (cur >= 0) {
    const step = PICK_STEPS[cur], seen = new Map();
    for (const r of rowsAtStep(rows, st.path, cur)) { const v = r[step.col] || ''; if (!seen.has(v)) seen.set(v, r); }
    return { ...base, step: { n: cur + 1, of: PICK_STEPS.length, label: step.label, back: cur ? PICK_STEPS[cur - 1].key : '', opts: [...seen.entries()].map(([v, r]) => ({ v, name: step.name(r) || step.blank || v, code: step.key === 'rc' ? '+' + v : step.key === 'city' || step.key === 'code' ? v : '', on: st.path[step.key] === v })) } };
  }
  const row = rowsAtStep(rows, st.path, PICK_STEPS.length)[0];
  const ctx = s.numberContext, sugg = s.suggestNumbers({ row, count: 4, seed: st.seed });
  if (!st.picked || !sugg.some((x) => x.line === st.picked)) st.picked = sugg[0]?.line || null;
  const typed = /^\d{4}$/.test(st.typed || '') ? st.typed : '';
  const show = (line) => { const p = parseNumber(numberAt(row, line), ctx); return { line, number: fullForm(p), seen: seenFrom(p, ctx) }; };
  const final = typed || st.picked; const fp = final ? parseNumber(numberAt(row, final), ctx) : null;
  return { ...base, place: row.District || row.City, prefix: seenFrom(parseNumber(numberAt(row, '0000'), ctx), ctx).replace(/0000$/, ''), typed: st.typed || '',
    suggestions: sugg.map((x) => ({ ...show(x.line), on: !typed && x.line === st.picked })),
    result: fp ? { seen: seenFrom(fp, ctx), full: fullForm(fp), where: placeOf(fp, ctx), home: ctx.regions[ctx.home.rc]?.cities?.[ctx.home.city]?.name || '' } : null };
}

export async function buildCallsContext(viewer) {
  const s = game.nightcity?.callService;
  const st = callsState(viewer);
  const own = owner(viewer);
  if (!s || !own) return { off: true, dialSvg: DIAL_SVG, reason: s ? 'Open a character to use their phone.' : 'Calls are not ready.' };
  if (!s.enabled) return { off: true, dialSvg: DIAL_SVG, reason: 'Calls are switched off at this table.' };
  const home = s.homeCode;
  const lines = own.actorId ? s.linesFor(own.actorId) : (s.numberOfContact(own.contactId) ? [{ number: s.numberOfContact(own.contactId), contactId: own.contactId, name: 'this line', burner: false }] : []);
  const ownerId = own.actorId || own.contactId;
  const name = own.actorId ? game.actors.get(own.actorId)?.name : game.nightcity.masterContactService.getContact(own.contactId)?.name;

  // no number yet → the picker (or its first screen)
  if (!lines.length) st.mode = null;
  if (!lines.length || st.view === 'getnum') {
    return { ...pickerContext(s, st), firstTime: !lines.length, name };
  }

  // My line — the greeting + voicemail switches of the number picked in Call as
  if (st.view === 'myline') {
    const line = lines.find((l) => lineValue(l, home) === st.as) || lines[0];
    const set = s.lineSettings(line.number);
    const g = set.greeting;
    return { myline: { number: line.number, label: line.burner ? line.name : name, burner: !!line.burner,
      kinds: GREETING_KINDS.map((k) => ({ k, label: GREETING_LABELS[k], on: g.kind === k })), kind: g.kind,
      text: g.text, voice: g.voice, defaultText: DEFAULT_GREETING, max: GREETING_MAX, on: set.voicemail.on, dnd: set.voicemail.dnd,
      canSpeak: canSpeak(), audio: g.audio || '', url: isLinkedGreeting(g.audio) ? g.audio : '', duration: g.duration || 0, length: g.duration ? formatDuration(g.duration) : '',
      recordingOn: s.recordingOn, canRecord: s.recordingOn && micStatus().ok, recReason: !s.recordingOn ? 'The GM has switched recordings off.' : micStatus().reason }, dialSvg: DIAL_SVG };
  }

  const book = phoneBook(viewer);
  const myContacts = (viewer.actorId ? game.actors?.get(viewer.actorId)?.getFlag?.(MODULE_ID, 'contacts') : null) || [];
  const log = await s.getLog(ownerId);
  const foldsOf = (k) => (st.folds[k] ??= { shut: new Set(), open: new Set() });
  const list = buildLogRows(log, { book, contacts: myContacts, home, filter: st.filter, show: st.filter === 'vm' ? 'all' : st.show, q: st.filter === 'vm' ? '' : st.q, now: gameNow(), ...foldsOf(st.filter), limits: st.limits, dayLabel: dayText });
  for (const b of list.bands) for (const d of b.days) for (const r of d.rows) r.time = r.gameTime ? formatCyberDate(r.gameTime, { timeOnly: true }) : '';
  // the card: one line after another, the one calling first in the list only by choice
  if (!st.as || !lines.some((l) => lineValue(l, home) === st.as)) st.as = lineValue(lines[0], home);
  const fromLine = lines.find((l) => lineValue(l, home) === st.as) || lines[0];
  const net = s._net();
  const prof = callProfile({ name, number: fromLine.number, net: { name: net?.name, type: net?.type, strength: net?.strength } });
  const sig = s._noSignal() ? { lead: 'No signal', warn: true, parts: [{ text: 'dead zone', tone: 'dim' }] } : signalLine(prof, 'live');
  sig.lead = sig.lead === 'Signal locked' ? 'Line ready' : sig.lead;
  // voicemail: every message left on this character's lines (main + burners), newest first
  const vms = await s.getVoicemails(ownerId);
  const burnerName = (cid) => lines.find((l) => l.contactId === cid)?.name || '';
  const vmRows = vms.map((v) => {
    const o = shownOther({ other: v.from }, book, home, myContacts);
    return { vmId: v.vmId, ownerId, who: o.name, known: o.known, number: v.from?.number || '', text: v.text, tts: v.kind === 'tts', voice: v.voice || '',
      isAudio: v.kind === 'audio', audio: v.audio || '', purged: !!v.purged, length: v.duration ? formatDuration(v.duration) : '',
      heard: !!v.heard, stamp: v.gameTime || '', when: v.gameTime ? formatCyberDate(v.gameTime, { timeOnly: true }) : '', forLine: v.to?.contactId ? burnerName(v.to.contactId) : '' };
  });
  const vmNeedle = String(st.q || '').trim().toLowerCase();
  const vmShown = vmRows.filter((r) => (st.show === 'all' || (st.show === 'new' ? !r.heard : st.show === 'heard' ? r.heard : true))
    && (!vmNeedle || [r.who, r.number, r.text].join(' ').toLowerCase().includes(vmNeedle)));
  for (const r of vmShown) { r.whoHtml = markHit(r.who, st.q); r.textHtml = markHit(r.text, st.q); }
  const vmBands = dateBands(vmShown, { now: gameNow(), dateOf: (r) => r.stamp, dayLabel: dayText, isHot: (r) => !r.heard, ...foldsOf('vm'), forced: !!vmNeedle || st.show !== 'all', limits: st.limits, prefix: 'vm:' });
  const isVm = st.filter === 'vm';
  return {
    vmView: isVm, vm: { rows: vmRows, bands: vmBands, unheard: vmRows.filter((r) => !r.heard).length },
    tools: {
      q: st.q, showing: st.show !== 'all', forced: isVm ? (!!vmNeedle || st.show !== 'all') : list.forced,
      placeholder: isVm ? 'Name, number, words left…' : 'Name, number, words said…',
      options: (isVm ? VM_SHOW : CALL_SHOW).map(([k, label]) => ({ k, label, on: k === st.show })),
      found: isVm ? `${vmShown.length} of ${vmRows.length} ${vmRows.length === 1 ? 'message' : 'messages'}` : `${list.total} of ${list.of} ${list.of === 1 ? 'call' : 'calls'}`,
    },
    scanner: (() => { const a = own.actorId ? game.actors?.get(own.actorId) : null, o = game.nightcity?.overheardService; if (!a || !o?.enabled) return null; const h = holdsItem(a.items?.contents || [], o.rules.scanner); return h?.counts ? { name: h.item.name, img: h.item.img || '' } : null; })(),
    emergency: (() => {
      const em = game.nightcity?.emergencyService, actor = own.actorId ? game.actors?.get(own.actorId) : null;
      if (!em?.enabled || !actor) return null;
      const plan = em.planFor(actor), rank = em.rankOf(actor);
      if (plan === 'none' && !rank) return null;
      const busy = em.planInUse(actor.id);
      return { trauma: plan !== 'none', traumaPlan: PLAN_NAMES[plan], traumaBusy: busy, traumaHelp: busy ? 'Your plan is in use. Your GM clears it when the job is over.' : 'Takes your Action. Any injury can justify a call.', backup: rank > 0, backupOrg: em.config.backup.orgs[em.orgOf(actor)]?.name || '' };
    })(),
    main: true, name, homeCode: home, noSignal: s._noSignal(), dialSvg: DIAL_SVG, keypad: KEYPAD,
    lines: lines.map((l) => { const set = s.lineSettings(l.number), p = parseNumber(l.number, home), g = set.greeting; return { ...l, value: lineValue(l, home), numHtml: numHtml(l.number, home), label: l.label || (l.kind === 'alias' ? l.name : l.kind === 'burner' ? 'Burner' : l.kind === 'extra' ? 'Extra line' : name), where: placeOf(p, home) + (l.main ? '' : ` · ${l.label || l.name}`), vmOn: !!set.voicemail.on, ringOn: !set.voicemail.dnd, greet: GREETING_LABELS[g.kind] || 'Default', retirable: l.kind === 'extra' || l.kind === 'burner', on: lineValue(l, home) === st.as }; }),
    multiLine: lines.length > 1, fromNumber: fromLine.number, burner: !!fromLine.burner, canAdd: !!own.actorId,
    addHelp: !own.actorId ? '' : s.extraLeft(own.actorId) === Infinity ? 'Add a line: a second number with a label, or a burner.' : s.rules.extraLines === 0 ? 'Your GM has switched extra lines off. They can still give you one.' : s.extraLeft(own.actorId) ? `Add a line: a second number with a label, or a burner. You can add ${s.extraLeft(own.actorId)} more.` : `You have used your ${s.rules.extraLines} extra line${s.rules.extraLines === 1 ? '' : 's'}. Your GM can give you more.`,
    changeHelp: s.rules.changeNeedsGm && !game.user?.isGM ? 'Ask your GM for a different number. If they agree, people who have your old one will no longer reach you.' : 'Pick a different number. People who have your old one will no longer reach you.',
    pending: own.actorId ? (s.pendingFor?.(own.actorId)?.to || '') : '',
    sig, net, speed: speedDial(log, book, home), bookJson: JSON.stringify(book.map(({ name: n, number, normal, img }) => ({ n, number, normal, img }))),
    filter: st.filter, list, missedUnseen: list.counts.unseen,
    bookView: st.filter === 'book',
    bookRows: [...book].sort((a, b) => a.name.localeCompare(b.name)).map((b) => ({ name: b.name, number: b.number, img: b.img, numHtml: numHtml(b.number, home), initials: b.name.split(/\s+/).map((w) => w[0] || '').join('').slice(0, 2).toUpperCase(), hay: (b.name + ' ' + b.number).toLowerCase() })),
    ...(() => { const held = viewer.actorId ? game.actors?.get(viewer.actorId)?.getFlag?.(MODULE_ID, 'contacts')?.length || 0 : 0, n = Math.max(0, held - book.length); return { noNumber: n, noNumberOne: n === 1 }; })(),
    logTabs: [
      { k: 'all', label: 'Calls', icon: 'fa-list', help: 'Every call on your lines', n: 0 },
      { k: 'missed', label: 'Missed', icon: 'fa-phone-slash', help: 'Calls you did not pick up', n: list.counts.unseen, hot: list.counts.unseen > 0 },
      { k: 'vm', label: 'Voicemail', icon: 'fa-voicemail', help: 'Messages left for you', n: vmRows.filter((v) => !v.heard).length, hot: vmRows.some((v) => !v.heard) },
      { k: 'book', label: 'Contacts', icon: 'fa-address-book', help: 'Everyone you have a number for', n: book.length },
    ].map((t) => ({ ...t, on: t.k === st.filter })),
  };
}

/** Unseen missed calls for the tab badge (cheap enough to run every render). */
export async function missedCount(viewer) {
  const s = game.nightcity?.callService;
  const own = owner(viewer);
  if (!s?.enabled || !own) return 0;
  const log = await s.getLog(own.actorId || own.contactId);
  const vms = await s.getVoicemails?.(own.actorId || own.contactId) || [];
  return log.filter((l) => l.direction === 'in' && l.outcome === 'missed' && !l.seen).length + vms.filter((v) => !v.heard).length;
}

// ═══════════════════════════════════════════════════════════
//  Clicks
// ═══════════════════════════════════════════════════════════

/** Every `calls-*` data-action. Returns true when handled. */
export async function handleCallsAction(viewer, action, target) {
  const st = callsState(viewer);
  const s = game.nightcity?.callService;
  const own = owner(viewer);
  const rerender = () => viewer.render();
  switch (action) {
    case 'calls-filter': st.filter = target.dataset.f || 'all'; st.q = ''; st.show = 'all'; return rerender();
    case 'calls-more': { const k = target.dataset.band; st.limits[k] = (st.limits[k] || BAND_PAGE) + BAND_PAGE; return rerender(); }
    case 'calls-clear': st.q = ''; st.show = 'all'; return rerender();
    case 'calls-foldall': {
      const f = (st.folds[st.filter] ??= { shut: new Set(), open: new Set() });
      const secs = [...(viewer.element?.querySelectorAll('[data-calls-band]') ?? [])];
      const close = secs.some((x) => !x.classList.contains('is-shut'));
      for (const x of secs) { const k = x.dataset.callsBand; (close ? f.shut : f.open).add(k); (close ? f.open : f.shut).delete(k); }
      return rerender();
    }
    case 'calls-getnum': st.view = 'getnum'; st.mode = 'change'; st.seed = Date.now(); st.path = null; st.level = null; return rerender();
    case 'calls-addline': st.view = 'getnum'; st.mode = 'add'; st.addKind = 'extra'; st.addLabel = ''; st.seed = Date.now(); st.path = null; st.level = null; return rerender();
    case 'calls-scan': { const a = game.actors?.get(own?.actorId); if (a) game.nightcity?.overheardService?.scan(a); return; }
    case 'calls-trauma': { const a = game.actors?.get(own?.actorId); if (a) game.nightcity?.emergencyHud?.trauma(a); return; }
    case 'calls-traumafor': {
      const a = game.actors?.get(own?.actorId); if (!a) return;
      const pick = await showNamePicker({ admin: false, title: 'Who is it for?', hint: 'One person at a time.', placeholder: 'search characters…', entries: getPlayerCharacters().map((p) => ({ id: p.actorId, name: p.actorName, img: p.actor?.img || '' })) });
      const who = pick?.id ? game.actors.get(pick.id) : null;
      if (who) game.nightcity?.emergencyHud?.trauma(a, who);
      return;
    }
    case 'calls-backup': {
      const a = game.actors?.get(own?.actorId), em = game.nightcity?.emergencyService; if (!a || !em) return;
      const list = em.optionsFor(a);
      if (!list.length) { ncmNotify.warn('Your GM has given your organization nobody you can call.'); return; }
      const pick = list.length === 1 ? { id: list[0].name } : await showNamePicker({ admin: false, title: 'Call who?', hint: 'Your rank, or any group below it.', placeholder: 'search groups…', selected: em.defaultGroup(a)?.name, entries: list.map((r) => ({ id: r.name, name: r.name, sub: r.r1 === r.r2 ? `Rank ${r.r1}` : `Rank ${r.r1}-${r.r2}`, icon: 'fas fa-people-group' })) });
      if (pick?.id) game.nightcity?.emergencyHud?.backup(a, pick.id);
      return;
    }
    case 'calls-sharemine': {
      const num = target.dataset.number; if (!num || !own?.actorId) return;
      const pcs = getPlayerCharacters().filter((p) => p.actorId !== own.actorId);
      if (!pcs.length) { ncmNotify.info('There is nobody to share it with yet.'); return; }
      const pick = await showNamePicker({ admin: false, title: 'Share this number', hint: 'They get the number on a contact. A second line does not say it is yours.', placeholder: 'search characters…', multi: true, doneLabel: 'Share',
        entries: pcs.map((p) => ({ id: p.actorId, name: p.actorName, img: p.actor?.img || '', sub: p.playerName || '' })) });
      if (!pick?.length) return;
      const r = await s.shareMine({ actorId: own.actorId, number: num, actorIds: pick.map((x) => x.id ?? x) });
      if (!r.ok) ncmNotify.warn(r.error); else ncmNotify.info('Number shared.');
      return;
    }
    case 'calls-savenum': {
      const num = target.dataset.number; if (!num || !own?.actorId) return;
      // pre-filled with the name the call showed, and their picture kept (tester 2026-11-07)
      const shown = target.dataset.name || '', img = target.dataset.img || '';
      const name = await themedPrompt({ title: 'Save this number', label: 'Save', icon: 'fas fa-address-book', content: dialogBodyHtml({ tone: 'act', icon: 'fas fa-address-book', title: num, lead: shown ? 'The name and picture their call showed. Change the name if you like.' : '', field: { label: 'Name', name: 'name', value: shown, placeholder: 'What to call them' } }), read: (root) => root.querySelector('input[name=name]')?.value?.trim() || null });
      if (!name) return;
      const link = { masterContactId: target.dataset.linkContact || null, actorId: target.dataset.linkActor || null };
      const r = await game.nightcity?.contactRepository?.addContact?.(own.actorId, { name, email: '', phone: num, tags: [], ...link, ...(img ? { portrait: img } : {}) });
      if (r && !r.success) ncmNotify.warn(r.error || 'Could not save it.'); else ncmNotify.info(`${name} saved.`);
      return rerender();
    }
    case 'calls-addnum': {
      // the call came from someone already in their contacts, without this number on file: put it there
      const num = target.dataset.number, cid = target.dataset.contact, who = target.dataset.name || 'this contact', was = target.dataset.replaces || '';
      if (!num || !cid || !own?.actorId) return;
      if (was) {
        const yes = await themedConfirm({ title: 'Update their number?', yes: 'Use the new number', yesIcon: 'fas fa-phone', content: dialogBodyHtml({ tone: 'act', icon: 'fas fa-address-book', title: who, lead: `${who} is saved with ${was}. This call came from ${num}.` }) });
        if (!yes) return;
      }
      const r = await game.nightcity?.contactRepository?.updateContact?.(own.actorId, cid, { phone: num });
      if (r && !r.success) ncmNotify.warn(r.error || 'Could not save it.'); else ncmNotify.info(`${num} saved to ${who}.`);
      return rerender();
    }
    case 'calls-addkind': st.addKind = target.dataset.k === 'burner' ? 'burner' : 'extra'; return rerender();
    case 'calls-retire': {
      const yes = await themedConfirm({ title: 'Retire this line?', yes: 'Retire it', yesIcon: 'fas fa-ban', content: dialogBodyHtml({ tone: 'bad', icon: 'fas fa-ban', title: target.dataset.number, lead: 'The number retires for good, and it can never be given to anyone else. People who saved it will hear not in service.' }) });
      if (!yes) return;
      const r = await s.retireLine(target.dataset.number);
      if (r && !r.ok) ncmNotify.warn(r.error);
      st.as = null; setTimeout(rerender, r?.relayed ? 600 : 0);
      return;
    }
    case 'calls-unrequest': await s.cancelRequest(own?.actorId); setTimeout(rerender, 300); return;
    case 'calls-copy': try { await navigator.clipboard.writeText(target.dataset.number); ncmNotify.info('Number copied.'); } catch { ncmNotify.info(target.dataset.number); } return;
    case 'calls-set': {
      const number = target.dataset.number, cur = s.lineSettings(number);
      const next = target.dataset.k === 'vm' ? { ...cur, voicemail: { ...cur.voicemail, on: !cur.voicemail.on } } : { ...cur, voicemail: { ...cur.voicemail, dnd: !cur.voicemail.dnd } };
      const r = await s.saveLineSettings(number, next);
      if (r && !r.ok) ncmNotify.warn(r.error);
      setTimeout(rerender, r?.relayed ? 400 : 0);
      return;
    }
    case 'calls-level': st.level = target.dataset.k; return rerender();
    case 'calls-level-done': st.level = null; return rerender();
    case 'calls-step': {
      const i = PICK_STEPS.findIndex((x) => x.key === st.level);
      st.path = { ...st.path, [st.level]: target.dataset.v };
      PICK_STEPS.slice(i + 1).forEach((x) => { st.path[x.key] = null; });
      st.level = i + 1 < PICK_STEPS.length ? PICK_STEPS[i + 1].key : null;
      st.picked = null; st.typed = ''; st.seed = Date.now();
      return rerender();
    }
    case 'calls-back': st.view = 'main'; return rerender();
    case 'calls-shuffle': st.seed = Date.now(); st.picked = null; return rerender();
    case 'calls-pick': st.picked = target.dataset.line; st.typed = ''; return rerender();
    case 'calls-use': {
      const rows = s.pickRows(), row = st.path ? rowsAtStep(rows, st.path, PICK_STEPS.length)[0] : null;
      const typed = /^\d{4}$/.test(st.typed || '') ? st.typed : '';
      const number = row && (typed || st.picked) ? numberAt(row, typed || st.picked) : '';
      if (!number) return;
      const mode = st.mode;
      const overLimit = mode === 'add' && !!own?.actorId && s.extraLeft(own.actorId) < 1;
      const asks = overLimit || (mode === 'change' && s.rules.changeNeedsGm && !game.user?.isGM && !!own?.actorId);
      const r = overLimit ? await s.requestLine({ actorId: own.actorId, number, kind: st.addKind, label: st.addLabel })
        : mode === 'add' ? await s.addLine({ actorId: own?.actorId, number, kind: st.addKind, label: st.addLabel })
        : asks ? await s.requestChange({ actorId: own.actorId, number })
          : await s.assignNumber({ actorId: own?.actorId, contactId: own?.contactId, number });
      if (!r.ok) { ncmNotify.warn(r.error); return; }
      if (asks) ncmNotify.info(overLimit ? `Asked your GM for ${number}.` : `Asked your GM for ${number}. You keep this number until they answer.`);
      else if (r.relayed) ncmNotify.info(`Number requested: ${number}. It is yours as soon as the GM's screen confirms it.`);
      if (mode === 'add' && !overLimit) st.as = normaliseNumber(number, s.homeCode);
      st.view = 'main'; st.mode = null; st.typed = ''; st.path = null; st.level = null;
      setTimeout(rerender, r.relayed ? 600 : 0);
      return;
    }
    case 'calls-dial': return dial(viewer, target.dataset.number);
    case 'calls-trace': { const r = await s.traceCall(target.dataset.call); if (r && !r.ok && r.error) ncmNotify.warn(r.error); return setTimeout(rerender, 800); }
    // voicemail
    case 'calls-vm-play': {
      const d = target.dataset;
      speak(d.text || target.closest('[data-vm-text]')?.dataset.vmText || '', { voice: d.voice || '' });
      if (d.heard !== '1') await s.setVoicemailHeard(d.owner, d.vm, true);
      return setTimeout(rerender, 300);
    }
    case 'calls-vm-heard': await s.setVoicemailHeard(target.dataset.owner, target.dataset.vm, target.dataset.heard === '1'); return setTimeout(rerender, 300);
    case 'calls-vm-del': {
      const ok = await themedConfirm({ title: 'Delete voicemail', content: '<p>Delete this voicemail? It cannot be brought back.</p>', yes: 'Delete', yesIcon: 'fas fa-trash', bad: true });
      if (!ok) return;
      await s.deleteVoicemail(target.dataset.owner, target.dataset.vm); return setTimeout(rerender, 300);
    }
    // My line
    case 'calls-myline': st.view = 'myline'; return rerender();
    case 'calls-ml-preview': {
      const root = viewer.element;
      const kind = root?.querySelector('[data-calls-mlk].on')?.dataset.callsMlk || 'default';
      const text = root?.querySelector('[data-calls-ml-text]')?.value || '';
      const g = greetingFor({ greeting: { kind, text, voice: root?.querySelector('[data-calls-ml-voice]')?.value || '' } });
      const strip = root?.querySelector('[data-calls-ml-strip]');
      if (strip) strip.textContent = g.text;
      if (g.readOut) speak(g.text, { voice: g.voice });
      return;
    }
    case 'calls-ml-save': {
      const root = viewer.element;
      const number = target.dataset.number;
      const settings = {
        greeting: { kind: root?.querySelector('[data-calls-mlk].on')?.dataset.callsMlk || 'default', text: root?.querySelector('[data-calls-ml-text]')?.value || '',
          voice: root?.querySelector('[data-calls-ml-voice]')?.value || '' },
        voicemail: { on: !!root?.querySelector('[data-calls-ml-on]')?.checked, dnd: !!root?.querySelector('[data-calls-ml-dnd]')?.checked },
      };
      let r;
      if (settings.greeting.kind === 'recorded') {
        const clip = st.mlClip;
        const url = root?.querySelector('[data-calls-ml-url]')?.value.trim() || '';
        const cur = s.lineSettings(number).greeting;
        if (clip?.blob?.size) r = await s.saveRecordedGreeting(number, settings, { base64: await blobToBase64(clip.blob), mime: clip.mime, ms: clip.ms });
        else if (url) {
          // a sound file: every caller plays the same one (tester 2026-11-08)
          const link = greetingLink(url);
          if (!link) { ncmNotify.warn('Use an https:// link, or the path of a sound file in your world.'); return; }
          r = await s.saveLineSettings(number, { ...settings, greeting: { ...settings.greeting, audio: link, duration: 0 } });
        } else {
          if (!cur.audio || isLinkedGreeting(cur.audio)) { ncmNotify.warn('Record a greeting, or give a sound file.'); return; }
          r = await s.saveLineSettings(number, { ...settings, greeting: { ...settings.greeting, audio: cur.audio, duration: cur.duration } });
        }
      } else r = await s.saveLineSettings(number, settings);
      st.mlClip = null;
      if (!r.ok) { ncmNotify.warn(r.error); return; }
      ncmNotify.info(r.relayed ? 'Saved — it is yours as soon as the GM\'s screen confirms it.' : 'Your line is set.');
      st.view = 'main'; return setTimeout(rerender, r.relayed ? 600 : 0);
    }
    case 'calls-go': {
      const v = viewer.element?.querySelector('[data-calls-num]')?.value || '';
      return dial(viewer, v);
    }
    default: return false;
  }
}

/** Place a call from this Agent (as its character, or a burner picked in Call as). */
async function dial(viewer, raw) {
  const s = game.nightcity?.callService;
  const own = owner(viewer);
  const st = callsState(viewer);
  if (!s || !own || !String(raw || '').trim()) return;
  // a name typed in the box: the first contact it matches
  let number = String(raw).trim();
  if (/[a-z]{3,}/i.test(number) && !/^\+|\d{3}/.test(number)) {
    const hit = phoneBook(viewer).find((b) => b.name.toLowerCase().includes(number.toLowerCase()));
    if (hit) number = hit.number;
  }
  const line = s.linesFor?.(own.actorId)?.find((l) => l.normal === st.as);
  const as = line?.contactId ? { contactId: line.contactId } : own.actorId ? { actorId: own.actorId, line: line && !line.main ? line.normal : null } : { contactId: own.contactId };
  const r = await s.placeCall(number, as);
  if (!r.ok && r.error) ncmNotify.warn(r.error);
}

// ═══════════════════════════════════════════════════════════
//  DOM wiring (typing never re-renders)
// ═══════════════════════════════════════════════════════════

const fmt = (d) => d;   // shown as typed
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The Call button's state as you type: empty → a number → a contact (the "arming"). */
function armState(value, book, home) {
  const v = String(value || '').trim();
  if (!v) return { state: 'empty' };
  const p = parseNumber(v, home);
  if (p.service) return { state: 'ready', name: p.entry?.name || p.service, number: v };
  if (p.done) {
    const hit = book.find((b) => b.normal === p.key);
    return hit ? { state: 'ready', name: hit.name, img: hit.img } : { state: 'number' };
  }
  if (/[a-z]{2,}/i.test(v)) {
    const byName = book.find((b) => b.name.toLowerCase().includes(v.toLowerCase()));
    if (byName) return { state: 'ready', name: byName.name, img: byName.img, number: byName.number };
  }
  return { state: 'empty' };
}

/** The line under the dial box. It explains a number as it is typed, and never names an owner who isn't in your contacts. */
function dialHint(value, book, ctx) {
  const { number: bare, ext } = splitExtension(value);
  const p = parseNumber(bare, ctx);
  const officeRow = officeRowOf(p, ctx);
  if (officeRow && !book.find((b) => b.normal === p.key)) {
    const o = game.nightcity?.callService?.office?.(officeRow), listed = (o?.exts || []).filter((e) => e.listed);
    const menu = listed.length ? ` Extensions: ${listed.map((e) => `x${esc(e.x)} ${esc(e.who)}`).join(', ')}.` : '';
    return `<b>${esc(placeOf(p, ctx))}.</b> ${ext ? `Extension ${esc(ext)}.` : `A switchboard.${menu}`} Add x and digits for an extension.`;
  }
  if (p.empty) return '';   // the box's own placeholder says it; an empty hint takes no room (the column must fit a 600px window)
  if (p.service) return `<span class="ok">${esc(p.entry?.name || p.service)}.</span> A service line, works from anywhere.`;
  if (!p.done) {
    if (p.ex && !p.bad && p.line !== undefined) { const left = 4 - (p.line || '').length; return `<b>${esc(placeOf(p, ctx))}.</b> ${left} more digit${left === 1 ? '' : 's'}.`; }
    return p.bad ? `<span class="bad">${esc(p.hint)}</span>` : esc(p.hint || '');
  }
  if (isUnlisted(p, ctx) && rowOf(p, ctx)?.Status !== 'dead') return '<b>Unlisted number.</b> The directory has nothing on it. You can still try it.';
  if (rowOf(p, ctx)?.Status === 'dead') return `<b>${esc(placeOf(p, ctx))}.</b> <span class="bad">This exchange is dead. Nothing should answer.</span>`;
  const who = book.find((b) => b.normal === p.key)?.name;
  return who ? `<b>${esc(placeOf(p, ctx))}.</b> <span class="ok">${esc(who)}.</span>` : `<b>${esc(placeOf(p, ctx))}.</b> Not in your contacts.`;
}

/** Keys on the pad: three digits that spell a district become that district, and a local number gets its dash. */
function tidyDial(v, ctx) {
  const split = splitExtension(v);
  if (split.ext) return `${tidyDial(split.number, ctx)} x${split.ext}`;
  let s = String(v).toUpperCase().replace(/[^A-Z0-9+# -]/g, '');
  const here = ctx.regions[ctx.home.rc]?.cities?.[ctx.home.city]?.ex || {};
  const bare = s.replace(/[\s-]/g, '');
  if (/^\d{3}/.test(bare)) { const hit = Object.keys(here).find((x) => asKeys(x) === bare.slice(0, 3)); if (hit) s = hit + bare.slice(3); }
  if (parseNumber(s, ctx).service || s.startsWith('+')) return s;
  const b = s.replace(/[\s-]/g, '');
  const m = b.match(/^([A-Z]{3})(\d{0,4})$/);
  if (m && here[m[1]]) return m[2] ? `${m[1]}-${m[2]}` : m[1];
  const m2 = b.match(/^([A-Z]{2,3})([A-Z]{3})(\d{0,4})$/);
  if (m2 && ctx.regions[ctx.home.rc]?.cities?.[m2[1]]) return `${m2[1]} ${m2[2]}${m2[3] ? `-${m2[3]}` : ''}`;
  return s;
}

/* ─── the directory. Only what the GM has left listed. A row starts dialling it. ─── */
function dirEntries(ctx) {
  const out = [];
  for (const r of ctx.rows) {
    if (r.Listed === 'no' || r.Status === 'dead') continue;
    const home = r['Region code'] === ctx.home.rc && r['City code'] === ctx.home.city, near = r['Region code'] === ctx.home.rc;
    const dial = (near ? '' : '+' + r['Region code'] + ' ') + (home ? '' : r['City code'] + (r.Code ? ' ' : '-')) + (r.Code ? r.Code + '-' : '');
    if (r.Category === 'Corporate') out.push({ tab: 'corps', corp: r.District, code: r.Code, name: r.District, hq: r.Area === 'Headquarters', city: r['City code'], cityName: r.City, dial });
    else if (home) out.push({ tab: 'home', group: r.Area || r.City, code: r.Code, name: r.District || r.City, dial });
    else if (!out.some((e) => e.tab === 'other' && e.rc === r['Region code'] && e.code === r['City code'])) out.push({ tab: 'other', rc: r['Region code'], region: r.Region, near, code: r['City code'], name: r.City, dial: (near ? '' : '+' + r['Region code'] + ' ') + r['City code'] + ' ' });
  }
  for (const [c, e] of Object.entries(ctx.service)) if (e?.seen !== 'hidden' && e?.listed !== false) out.push({ tab: 'service', code: c, name: e?.name || c, sub: 'Works from anywhere', dial: c });
  return out;
}
const dirRow = (e, sub) => `<button type="button" class="ncm-calls-xrow" data-xpick="${esc(e.dial)}" data-tooltip="Start dialling ${tipText(e.dial.trim())}"><code>${esc(e.code)}</code><span class="nm">${esc(e.name)}</span>${sub && e.sub ? `<small>${esc(e.sub)}</small>` : ''}</button>`;
function dirPanel(ctx, tab, entries = dirEntries(ctx)) {
  const all = entries.filter((e) => e.tab === tab);
  if (tab === 'home') return [...new Set(all.map((e) => e.group))].map((g) => `<div class="ncm-calls-row"><span class="lbl">${esc(g)}</span><span class="ln"></span></div><div class="ncm-calls-xgrid">${all.filter((e) => e.group === g).map((e) => dirRow(e)).join('')}</div>`).join('');
  if (tab === 'other') return '<p class="ncm-calls-xhint">Long-distance numbers start with the region\'s + code, then the city.</p>' + [...new Set(all.map((e) => e.rc))].sort((a, b) => Number(b === ctx.home.rc) - Number(a === ctx.home.rc)).map((rc) => { const rows = all.filter((e) => e.rc === rc), near = rc === ctx.home.rc; return `<details class="ncm-calls-xreg"${near ? ' open' : ''}><summary><code>${near ? 'Nearby' : '+' + esc(rc)}</code>${esc(rows[0].region)}<small>${rows.length}${rows.length === 1 ? ' city' : ' cities'}</small></summary><div class="ncm-calls-xgrid">${rows.map((e) => dirRow(e)).join('')}</div></details>`; }).join('');
  if (tab === 'corps') return '<p class="ncm-calls-xhint">Main numbers ring a switchboard. Add an extension to reach a desk.</p>' + [...new Set(all.map((e) => e.corp))].sort((a, b) => a.localeCompare(b)).map((c) => { const rows = all.filter((e) => e.corp === c).sort((a, b) => Number(b.hq) - Number(a.hq)); const here = rows.find((e) => e.city === ctx.home.city); return `<details class="ncm-calls-xreg"><summary><code>${esc(rows[0].code)}</code>${esc(c)}${here ? `<em>In ${esc(here.cityName)}</em>` : ''}<small>${rows.length}${rows.length === 1 ? ' office' : ' offices'}</small></summary><div class="ncm-calls-xgrid">${rows.map((e) => `<button type="button" class="ncm-calls-xrow" data-xpick="${esc(e.dial)}" data-tooltip="Start dialling ${tipText(e.dial.trim())}"><code>${esc(e.city)}</code><span class="nm">${esc(e.cityName)}${e.hq ? ' <i class="hq">HQ</i>' : ''}</span></button>`).join('')}</div></details>`; }).join('');
  return `<div class="ncm-calls-xgrid ncm-calls-xgrid--one">${all.map((e) => dirRow(e, true)).join('')}</div>`;
}
function dirHtml(ctx) {
  const all = dirEntries(ctx), n = (t) => all.filter((e) => e.tab === t).length, homeName = ctx.regions[ctx.home.rc]?.cities?.[ctx.home.city]?.name || 'Home';
  const tab = (k, t, h, on) => `<button type="button" role="tab" aria-selected="${!!on}" class="${on ? 'on' : ''}" data-xtab="${k}" data-tooltip="${tipText(h)}">${esc(t)}<small>${n(k)}</small></button>`;
  return `<div class="ncm-calls-xlist"><div class="ncm-calls-xhd"><h3>Directory</h3><input type="text" data-xfind placeholder="Find a place, code or corp" aria-label="Find a place, code or corp" autocomplete="off" spellcheck="false" data-tooltip="Searches every tab, by name or code"><button type="button" class="ncm-calls-btn" data-xclose data-tooltip="Back to the dial pad">Close</button></div><div class="ncm-calls-xtabs" role="tablist" aria-label="Directory">${tab('home', homeName, 'Districts in ' + homeName, true)}${tab('other', 'Other places', 'Regions and cities, with their codes')}${tab('corps', 'Corporations', 'Main numbers at each office')}${tab('service', 'Service', 'Words you can dial from anywhere')}</div><div class="ncm-calls-xpanel" role="tabpanel">${dirPanel(ctx, 'home', all)}</div></div>`;
}

/* ─── the first-open card, reopened from the ? on My line ─── */
function introHtml(ctx, number) {
  const p = parseNumber(number, ctx), ex = p.ex || Object.keys(ctx.regions[ctx.home.rc]?.cities?.[ctx.home.city]?.ex || {})[0] || 'WAT';
  const where = ctx.regions[ctx.home.rc]?.cities?.[ctx.home.city];
  const near = Object.entries(ctx.regions[ctx.home.rc]?.cities || {}).find(([c, C]) => c !== ctx.home.city && Object.keys(C.ex).length);
  return `<div class="ncm-calls-intro" role="dialog" aria-label="How numbers work"><div class="ncm-calls-intro__box"><h3>How numbers work here</h3>
    <div class="ncm-calls-intro__big ncm-num" style="border:0;cursor:default"><div class="ncm-calls-intro__part"><b class="x">${esc(ex)}-</b><small>District: ${esc(where?.ex?.[ex]?.District || '')}</small></div><div class="ncm-calls-intro__part"><b class="l">4471</b><small>The person</small></div></div>
    <ul><li><span class="ncm-num"><span class="x">${esc(ex)}-</span><span class="l">4471</span></span><span><b>Same city:</b> just the district and four digits.</span></li>
    ${near ? `<li><span class="ncm-num"><span class="c">${esc(near[0])} </span><span class="x">${esc(Object.keys(near[1].ex)[0])}-</span><span class="l">2210</span></span><span><b>Nearby city:</b> add the city.</span></li>` : ''}
    <li><span class="ncm-num"><span class="r">+${esc(ctx.home.rc === '14' ? '72' : '14')} </span><span class="c">${esc(ctx.home.rc === '14' ? 'NC' : 'DAL')} </span><span class="x">${esc(ctx.home.rc === '14' ? 'WAT' : 'CEN')}-</span><span class="l">3345</span></span><span><b>Far away:</b> add a + code for the region.</span></li></ul>
    <p class="ncm-calls-intro__p">A number says where it was issued, not where someone is now. It stays with them when they move. Hover any number to see what it means.</p>
    <div class="ncm-calls-intro__ft"><small>Reopen this with the ? on your My line card.</small><button type="button" class="ncm-calls-btn go" data-intro-done data-tooltip="Close this"><i class="fas fa-check"></i> Got it</button></div></div></div>`;
}

function decodeTo(el, to, ms) {
  if (!el) return;
  const n = to.length; const t0 = performance.now(); el._dec = t0;
  const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  if (reduced) { el.textContent = to; return; }
  const tick = (now) => {
    if (el._dec !== t0 || !el.isConnected) return;
    const p = (now - t0) / ms; const set = Math.floor(p * n);
    el.textContent = [...to].map((c, i) => (i < set || c === ' ' ? c : GLYPHS[Math.floor(Math.random() * GLYPHS.length)])).join('');
    if (p < 1) requestAnimationFrame(tick); else el.textContent = to;
  };
  requestAnimationFrame(tick);
}

/** Wire the dialer + the picker. Called from the viewer's _onRender while the Calls tab is open. */
export function wireCallsTab(viewer, html) {
  const root = html.querySelector('.ncm-calls');
  if (!root || root._wired) return;
  root._wired = true;
  const st = callsState(viewer);
  const home = game.nightcity?.callService?.homeCode;

  // every button here re-renders the viewer: each scroller keeps its place across it
  const SCROLLERS = ['.ncm-calls', '.ncm-calls-gn', '.ncm-calls-list', '.ncm-calls-dl', '.ncm-calls-dist'];
  const scrollerKey = (el) => SCROLLERS.find((s) => el.matches?.(s));
  for (const s of SCROLLERS) { const el = root.matches(s) ? root : root.querySelector(s); if (el && st.scroll[s]) el.scrollTop = st.scroll[s]; }
  root.addEventListener('scroll', (e) => { const k = scrollerKey(e.target); if (k) st.scroll[k] = e.target.scrollTop; }, { capture: true, passive: true });

  // the log: search after a pause, keeping the cursor; the Show dropdown; folds on the live DOM so they animate
  const find = root.querySelector('[data-calls-q]');
  if (find) {
    if (st.qFocus) { st.qFocus = false; find.focus(); const at = Math.min(st.qCaret ?? find.value.length, find.value.length); find.setSelectionRange(at, at); }
    find.addEventListener('input', () => {
      clearTimeout(st.qT);
      st.qT = setTimeout(() => { st.q = find.value; st.qFocus = document.activeElement === find; st.qCaret = find.selectionStart; viewer.render(); }, 220);
    });
  }
  root.querySelector('[data-calls-show]')?.addEventListener('change', (e) => { st.show = e.target.value; viewer.render(); });
  const foldBand = (h) => {
    const sec = h.closest('[data-calls-band]');
    if (!sec) return;
    const f = (st.folds[st.filter] ??= { shut: new Set(), open: new Set() }), key = sec.dataset.callsBand, shut = !sec.classList.contains('is-shut');
    sec.classList.toggle('is-shut', shut);
    h.setAttribute('aria-expanded', String(!shut));
    (shut ? f.shut : f.open).add(key); (shut ? f.open : f.shut).delete(key);
  };
  root.querySelectorAll('[data-calls-fold]').forEach((h) => {
    h.addEventListener('click', () => foldBand(h));
    h.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); foldBand(h); } });
  });

  // add a line: what it is called
  const addLabel = root.querySelector('[data-calls-addlabel]');
  addLabel?.addEventListener('input', () => { st.addLabel = addLabel.value; });

  // My line: the number opens into the list, and picking one patches the card so the chip keeps running
  const card = root.querySelector('.ncm-calls-line');
  if (card) {
    const toggle = (open) => { const on = open ?? !card.classList.contains('is-open'); card.classList.toggle('is-open', on); card.querySelector('[data-linetoggle]')?.setAttribute('aria-expanded', String(on)); card.querySelectorAll('[data-linepick]').forEach((b) => { b.tabIndex = on ? 0 : -1; }); };
    card.querySelector('[data-linetoggle]')?.addEventListener('click', () => toggle());
    const after = (b) => {
      st.as = b.dataset.linepick;
      card.querySelectorAll('[data-linepick]').forEach((x) => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-selected', String(on)); x.querySelector('i').className = on ? 'fas fa-circle-dot' : 'far fa-circle'; });
      card.querySelector('[data-show="num"]').innerHTML = b.querySelector('.t .ncm-num').outerHTML;
      card.querySelector('[data-show="where"]').textContent = b.dataset.where;
      card.querySelectorAll('[data-lineonly]').forEach((el) => { el.hidden = el.dataset.lineonly !== b.dataset.linepick; });
      const row = card.querySelector('.ncm-calls-line__row'); row.classList.remove('is-swap'); void row.offsetWidth; row.classList.add('is-swap');
      const sim = card.querySelector('.ncm-calls-sim'); sim?.classList.toggle('is-quiet', b.dataset.ring !== '1');
    };
    card.querySelectorAll('[data-linepick]').forEach((b) => b.addEventListener('click', () => { toggle(false); if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) after(b); else setTimeout(() => after(b), 230); }));
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape' && card.classList.contains('is-open')) { toggle(false); card.querySelector('[data-linetoggle]')?.focus(); } });
  }

  // first open, and the ? on the card
  const showIntro = () => { if (root.querySelector('.ncm-calls-intro')) return; const s = game.nightcity?.callService; root.insertAdjacentHTML('beforeend', introHtml(s?.numberContext, root.querySelector('[data-show="num"]')?.textContent || '')); root.querySelector('[data-intro-done]')?.addEventListener('click', () => { root.querySelector('.ncm-calls-intro')?.remove(); try { localStorage.setItem('ncm.calls.intro', '1'); } catch { /* private window */ } }); };
  root.querySelector('[data-calls-intro]')?.addEventListener('click', showIntro);
  if (card) { let seen = '1'; try { seen = localStorage.getItem('ncm.calls.intro') || ''; } catch { /* private window */ } if (!seen) showIntro(); }

  // the phone contact list narrows without a re-render
  root.addEventListener('input', (e) => {
    if (!e.target.matches?.('[data-calls-bookq]')) return;
    const q = e.target.value.trim().toLowerCase();
    root.querySelectorAll('[data-bk]').forEach((row) => { row.style.display = !q || row.dataset.bk.includes(q) ? '' : 'none'; });
  });

  // Esc: the directory, then the first-open card — before Foundry's own Esc (which would close the Agent)
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const x = root.querySelector('.ncm-calls-xlist'), intro = root.querySelector('.ncm-calls-intro');
    if (x) { e.preventDefault(); e.stopPropagation(); x.remove(); root.querySelector('[data-calls-num]')?.focus(); }
    else if (intro) { e.preventDefault(); e.stopPropagation(); intro.querySelector('[data-intro-done]')?.click(); }
  });

  // the directory opens over the pad without a re-render, so what you typed stays
  root.addEventListener('click', (e) => {
    const s = game.nightcity?.callService, ctx = s?.numberContext; if (!ctx) return;
    if (e.target.closest('[data-calls-xopen]')) { if (!root.querySelector('.ncm-calls-xlist')) root.insertAdjacentHTML('beforeend', dirHtml(ctx)); root.querySelector('[data-xfind]')?.focus(); return; }
    if (e.target.closest('[data-xclose]')) { root.querySelector('.ncm-calls-xlist')?.remove(); root.querySelector('[data-calls-num]')?.focus(); return; }
    const tab = e.target.closest('[data-xtab]');
    if (tab) { root.querySelectorAll('[data-xtab]').forEach((b) => { const on = b === tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); }); root.querySelector('.ncm-calls-xpanel').innerHTML = dirPanel(ctx, tab.dataset.xtab); return; }
    const pick = e.target.closest('[data-xpick]');
    if (pick) { root.querySelector('.ncm-calls-xlist')?.remove(); const i = root.querySelector('[data-calls-num]'); if (i) { i.value = pick.dataset.xpick; i.dispatchEvent(new Event('input')); i.focus(); } }
  });
  root.addEventListener('input', (e) => {
    if (!e.target.matches?.('[data-xfind]')) return;
    const s = game.nightcity?.callService, ctx = s?.numberContext; const q = e.target.value.trim().toLowerCase();
    const panel = root.querySelector('.ncm-calls-xpanel'), tabs = root.querySelector('.ncm-calls-xtabs'); if (!panel) return;
    tabs.classList.toggle('is-searching', !!q);
    if (!q) { panel.innerHTML = dirPanel(ctx, root.querySelector('[data-xtab].on')?.dataset.xtab || 'home'); return; }
    const hits = dirEntries(ctx).filter((x) => [x.name, x.code, x.cityName, x.region, x.corp].filter(Boolean).join(' ').toLowerCase().includes(q)).slice(0, 80);
    panel.innerHTML = hits.length ? `<div class="ncm-calls-xgrid">${hits.map((x) => dirRow({ ...x, sub: x.cityName || x.region || x.group }, true)).join('')}</div>` : '<p class="ncm-calls-xhint">Nothing matches.</p>';
  });

  const own = root.querySelector('[data-calls-own]');
  own?.addEventListener('input', () => { own.value = own.value.replace(/\D/g, '').slice(0, 4); st.typed = own.value; root.querySelectorAll('.ncm-calls-opt.on').forEach((o) => o.classList.toggle('on', own.value.length !== 4)); });

  // My line: the greeting kind (DOM only — the form survives until Save), the voices this browser has
  const ml = root.querySelector('.ncm-calls-ml');
  if (ml) {
    const sync = (k) => {
      ml.querySelectorAll('[data-calls-mlk]').forEach((b) => b.classList.toggle('on', b.dataset.callsMlk === k));
      ml.dataset.kind = k;
    };
    ml.querySelectorAll('[data-calls-mlk]').forEach((b) => b.addEventListener('click', () => sync(b.dataset.callsMlk)));
    // a recorded greeting: Record / Stop (20 s at most), Play — the clip waits in st.mlClip until Save
    const recBtn = ml.querySelector('[data-calls-ml-rec]');
    const playBtn = ml.querySelector('[data-calls-ml-play]');
    const recTime = ml.querySelector('[data-calls-ml-rect]');
    let rec = null;
    recBtn?.addEventListener('click', async () => {
      if (rec?.recording) {
        st.mlClip = await rec.stop(); rec = null;
        recBtn.innerHTML = '<i class="fas fa-rotate-left"></i> Record again'; ml.classList.remove('is-recording');
        if (recTime) recTime.textContent = `${formatDuration(st.mlClip.ms / 1000)} recorded — Save to keep it`;
        return;
      }
      rec = new VoiceRecorder();
      try {
        await rec.start({ maxMs: 20000, onTick: (ms) => { if (recTime) recTime.textContent = `${formatDuration(ms / 1000)} / 0:20`; },
          onLimit: () => recBtn.click() });
        recBtn.innerHTML = '<i class="fas fa-square"></i> Stop'; ml.classList.add('is-recording');
      } catch (err) { ncmNotify.warn(err.message); rec = null; }
    });
    playBtn?.addEventListener('click', () => {
      const typed = ml.querySelector('[data-calls-ml-url]')?.value.trim() || '';
      const src = st.mlClip?.blob ? URL.createObjectURL(st.mlClip.blob) : (typed ? greetingLink(typed) : playBtn.dataset.src);
      if (typed && !src) { ncmNotify.warn('Use an https:// link, or the path of a sound file in your world.'); return; }
      if (src) playAudio(src); else ncmNotify.info('Nothing recorded yet.');
    });
    const sel = ml.querySelector('[data-calls-ml-voice]');
    if (sel) voices().then((list) => {
      const cur = sel.dataset.current || '';
      sel.innerHTML = `<option value="">This browser's default voice</option>` + list.map((v) => `<option value="${esc(v.name)}"${v.name === cur ? ' selected' : ''}>${esc(v.name)} (${esc(v.lang)})</option>`).join('');
    });
  }

  // a voice message: playing it marks it heard
  root.querySelectorAll('audio[data-vm-audio]').forEach((a) => a.addEventListener('play', () => {
    if (a.dataset.heard === '1') return;
    a.dataset.heard = '1';
    game.nightcity?.callService?.setVoicemailHeard(a.dataset.owner, a.dataset.vmAudio, true);
  }, { once: true }));

  // the dialer
  const input = root.querySelector('[data-calls-num]');
  const btn = root.querySelector('[data-calls-btn]');
  if (!input || !btn) return;
  let book = [];
  try { book = JSON.parse(root.dataset.book || '[]').map((b) => ({ name: b.n, number: b.number, normal: b.normal, img: b.img })); } catch { /* none */ }
  const label = btn.querySelector('.who'); const sub = btn.querySelector('small'); const kind = btn.querySelector('.ncm-calls-cb__tx b');
  const match = root.querySelector('[data-calls-match]');
  let prev = 'empty';
  const update = () => {
    const a = armState(input.value, book, home);
    btn.classList.remove('is-empty', 'is-number', 'is-ready', 'arming', 'disarming');
    void btn.offsetWidth;
    btn.classList.add(`is-${a.state}`);
    btn.disabled = a.state === 'empty' || btn.dataset.nosig === '1';
    if (prev === 'empty' && a.state !== 'empty') { btn.classList.add('arming'); decodeTo(label, a.name || fmt(input.value), 360); decodeTo(sub, a.name ? 'calling a contact' : 'not in your contacts', 320); }
    else if (prev !== 'empty' && a.state === 'empty') { btn.classList.add('disarming'); decodeTo(label, 'Type a number', 300); decodeTo(sub, 'or a name', 300); }
    else if (a.state === 'ready' && prev !== 'ready') decodeTo(label, a.name, 420);
    else if (a.state === 'number') label.textContent = input.value.trim();
    if (a.state === 'number' && prev === 'ready') decodeTo(sub, 'not in your contacts', 300);
    if (match) match.innerHTML = a.state === 'ready' ? `<i class="fas fa-address-book"></i> ${esc(a.name)}${a.number ? ` · ${esc(a.number)}` : ''}` : '';
    btn.dataset.number = a.number || input.value.trim();
    prev = a.state;
  };
  const hintEl = root.querySelector('[data-calls-hint]');
  const ctxNow = () => game.nightcity?.callService?.numberContext;
  input.addEventListener('input', () => {
    // pad digits become the district they spell; never fight the caret when it is mid-number
    const atEnd = input.selectionStart === input.value.length;
    if (atEnd) { const t = tidyDial(input.value, ctxNow()); if (t !== input.value) input.value = t; }
    update();
    if (hintEl) hintEl.innerHTML = dialHint(input.value, book, ctxNow());
  });
  if (hintEl) hintEl.innerHTML = dialHint(input.value, book, ctxNow());
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (!btn.disabled) dial(viewer, btn.dataset.number); } });

  // a key stays lit while it is held, and typing presses the key that letter is on. Inside this tab only.
  const simPing = () => { const c = root.querySelector('.ncm-calls-sim'); if (!c) return; c.classList.remove('is-ping'); void c.offsetWidth; c.classList.add('is-ping'); };
  const keyFor = (ch) => { const u = String(ch).toUpperCase(); const k = KEYPAD.find((x) => x.k === u || x.l.includes(u)); return k ? root.querySelector(`[data-calls-key="${CSS.escape(k.k)}"]`) : null; };
  const held = new Map();
  const letGo = (code) => { const b = held.get(code); if (!b) return; held.delete(code); if (![...held.values()].includes(b)) { b.classList.remove('held'); b.classList.remove('press'); void b.offsetWidth; b.classList.add('press'); } };
  root.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1 || e.target !== input) return;
    const b = keyFor(e.key); if (b) { b.classList.add('held'); held.set(e.code, b); simPing(); }
  });
  root.addEventListener('keyup', (e) => letGo(e.code));
  input.addEventListener('blur', () => { for (const c of [...held.keys()]) letGo(c); });
  root.querySelectorAll('[data-calls-key]').forEach((k) => {
    k.addEventListener('pointerdown', () => { k.classList.add('held'); held.set('pointer', k); simPing(); });
    k.addEventListener('pointerup', () => letGo('pointer')); k.addEventListener('pointerleave', () => letGo('pointer'));
    k.addEventListener('click', () => { input.value += k.dataset.callsKey; input.dispatchEvent(new Event('input')); input.focus(); });
  });
  root.querySelector('[data-calls-del]')?.addEventListener('click', () => { input.value = input.value.slice(0, -1).replace(/[\s-]$/, ''); input.dispatchEvent(new Event('input')); input.focus(); });
  btn.addEventListener('click', () => { if (!btn.disabled) dial(viewer, btn.dataset.number); });
  // hover: CALL decodes into DIAL ▸ (and back)
  btn.addEventListener('mouseenter', () => { if (!btn.disabled) decodeTo(kind, 'Dial ▸', 260); });
  btn.addEventListener('mouseleave', () => { if (!btn.disabled) decodeTo(kind, 'Call', 200); });
  if (st.dial && !input.value) { input.value = st.dial; }
  input.addEventListener('input', () => { st.dial = input.value; });
  update();
}
