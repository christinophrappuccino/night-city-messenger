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

import { MODULE_ID } from '../../utils/constants.js';
import { formatCyberDate } from '../../utils/helpers.js';
import { normaliseNumber, displayNumber, AREA_CODES, sanitizeRegion, kindLabel } from '../../utils/phoneNumbers.js';
import { callProfile, signalLine } from '../../utils/callProfile.js';
import { formatDuration } from '../../utils/callModel.js';
import { DIAL_SVG } from '../Calls/CallHud.js';
import { GREETING_KINDS, GREETING_LABELS, DEFAULT_GREETING, GREETING_MAX, greetingFor } from '../../utils/voicemail.js';
import { speak, voices, canSpeak } from '../Calls/speech.js';
import { VoiceRecorder, micStatus, blobToBase64, playAudio } from '../Calls/recorder.js';
import { themedConfirm } from '../../utils/adminTheme.js';

const KEYPAD = [['1', ''], ['2', 'ABC'], ['3', 'DEF'], ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'], ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'], ['*', ''], ['0', '+'], ['#', '']]
  .map(([k, l]) => ({ k, l }));

export const CALLS_PER_PAGE = 25;
const GLYPHS = '!<>-_/[]{}=+*^?#01ABCDEFXZ';

/** The viewer's calls state, created on first use. */
export function callsState(viewer) {
  viewer._calls ??= { view: 'main', filter: 'all', page: 1, seed: Date.now(), region: null, picked: null, typed: '', as: null };
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
function shownOther(row, book, home) {
  const n = normaliseNumber(row.other?.number, home);
  const hit = n ? book.find((b) => b.normal === n) : null;
  if (hit) return { name: hit.name, img: hit.img, number: row.other.number, known: true };
  if (game.user.isGM) return { name: row.other?.name || row.other?.number || 'Unknown', img: '', number: row.other?.number || '', known: true };
  return { name: row.other?.number || 'Unknown number', img: '', number: row.other?.number || '', known: false };
}

const DIRS = {
  out: { icon: 'fa-arrow-up', word: 'Out', cls: 'out' },
  in: { icon: 'fa-arrow-down', word: 'In', cls: 'in' },
  missed: { icon: 'fa-phone-slash', word: 'Missed', cls: 'miss' },
};
const OUTCOME_WORDS = { missed: 'no answer', declined: 'declined', busy: 'busy', dropped: 'dropped', 'no-signal': 'no signal', 'not-in-service': 'not in service' };

/** Pure: turn log entries into the tab's rows, grouped by day, with counts. */
export function buildLogRows(log, { book = [], home = '+1', filter = 'all', page = 1 } = {}) {
  const rows = log.map((l) => {
    const missed = l.direction === 'in' && l.outcome === 'missed';
    const dir = missed ? 'missed' : l.direction === 'out' ? 'out' : 'in';
    const other = shownOther(l, book, home);
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
  const shown = rows.filter((r) => filter === 'all' || (filter === 'missed' ? r.missed : r.dir === filter));
  const pages = Math.max(1, Math.ceil(shown.length / CALLS_PER_PAGE));
  const p = Math.min(Math.max(1, page), pages);
  const slice = shown.slice((p - 1) * CALLS_PER_PAGE, p * CALLS_PER_PAGE);
  const days = [];
  for (const r of slice) {
    const last = days.at(-1);
    if (last && last.day === r.day) last.rows.push(r); else days.push({ day: r.day, rows: [r] });
  }
  return { days, counts, page: p, pages, total: shown.length, from: shown.length ? (p - 1) * CALLS_PER_PAGE + 1 : 0, to: (p - 1) * CALLS_PER_PAGE + slice.length };
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
  if (!lines.length || st.view === 'getnum') {
    const region = sanitizeRegion(st.region || s.region);
    st.region = region;
    const sugg = s.suggestNumbers({ ...region, count: 4, seed: st.seed });
    if (!st.picked || !sugg.some((x) => x.number === st.picked)) st.picked = sugg[0]?.number || null;
    const countries = Object.entries(AREA_CODES).map(([code, c]) => ({ code, label: c.label, on: code === region.country }));
    const regions = Object.keys(AREA_CODES[region.country].regions).map((r) => ({ name: r, on: r === region.region }));
    const codes = AREA_CODES[region.country].regions[region.region].map(([code, label]) => ({ code, label, on: code === region.code }));
    return { picker: true, firstTime: !lines.length, name, homeCode: home, region, countries, regions, codes,
      suggestions: sugg.map((x) => ({ ...x, label: kindLabel(x.kind), on: x.number === st.picked })), picked: st.picked,
      fiction: !!AREA_CODES[region.country].fiction, typed: st.typed || '' };
  }

  // My line — the greeting + voicemail switches of the number picked in Call as
  if (st.view === 'myline') {
    const as0 = st.as && lines.some((l) => (l.contactId || '') === st.as) ? st.as : (lines[0].contactId || '');
    const line = lines.find((l) => (l.contactId || '') === as0) || lines[0];
    const set = s.lineSettings(line.number);
    const g = set.greeting;
    return { myline: { number: line.number, label: line.burner ? line.name : name, burner: !!line.burner,
      kinds: GREETING_KINDS.map((k) => ({ k, label: GREETING_LABELS[k], on: g.kind === k })), kind: g.kind,
      text: g.text, voice: g.voice, defaultText: DEFAULT_GREETING, max: GREETING_MAX, on: set.voicemail.on, dnd: set.voicemail.dnd,
      canSpeak: canSpeak(), audio: g.audio || '', duration: g.duration || 0, length: g.duration ? formatDuration(g.duration) : '',
      recordingOn: s.recordingOn, canRecord: s.recordingOn && micStatus().ok, recReason: !s.recordingOn ? 'The GM has switched recordings off.' : micStatus().reason }, dialSvg: DIAL_SVG };
  }

  const book = phoneBook(viewer);
  const log = await s.getLog(ownerId);
  const list = buildLogRows(log, { book, home, filter: st.filter, page: st.page });
  st.page = list.page;
  for (const d of list.days) {
    d.label = d.day ? formatCyberDate(`${d.day}T12:00:00.000Z`, { dateOnly: true }) : 'Earlier';
    for (const r of d.rows) r.time = r.gameTime ? formatCyberDate(r.gameTime, { timeOnly: true }) : '';
  }
  // Call as: this character's own line, then its burners
  const as = st.as && lines.some((l) => (l.contactId || '') === st.as) ? st.as : (lines[0].contactId || '');
  st.as = as;
  const fromLine = lines.find((l) => (l.contactId || '') === as) || lines[0];
  const net = s._net();
  const prof = callProfile({ name, number: fromLine.number, net: { name: net?.name, type: net?.type, strength: net?.strength } });
  const sig = s._noSignal() ? { lead: 'No signal', warn: true, parts: [{ text: 'dead zone', tone: 'dim' }] } : signalLine(prof, 'live');
  sig.lead = sig.lead === 'Signal locked' ? 'Line ready' : sig.lead;
  // voicemail: every message left on this character's lines (main + burners), newest first
  const vms = await s.getVoicemails(ownerId);
  const burnerName = (cid) => lines.find((l) => l.contactId === cid)?.name || '';
  const vmRows = vms.map((v) => {
    const o = shownOther({ other: v.from }, book, home);
    return { vmId: v.vmId, ownerId, who: o.name, known: o.known, number: v.from?.number || '', text: v.text, tts: v.kind === 'tts', voice: v.voice || '',
      isAudio: v.kind === 'audio', audio: v.audio || '', purged: !!v.purged, length: v.duration ? formatDuration(v.duration) : '',
      heard: !!v.heard, when: v.gameTime ? formatCyberDate(v.gameTime) : '', forLine: v.to?.contactId ? burnerName(v.to.contactId) : '' };
  });
  return {
    vmView: st.filter === 'vm', vm: { rows: vmRows, unheard: vmRows.filter((r) => !r.heard).length },
    main: true, name, homeCode: home, noSignal: s._noSignal(), dialSvg: DIAL_SVG, keypad: KEYPAD,
    lines: lines.map((l) => ({ ...l, value: l.contactId || '', label: l.burner ? `${l.name} (burner)` : name, on: (l.contactId || '') === as })),
    multiLine: lines.length > 1, fromNumber: fromLine.number, burner: !!fromLine.burner,
    sig, net, speed: speedDial(log, book, home), bookJson: JSON.stringify(book.map(({ name: n, number, normal, img }) => ({ n, number, normal, img }))),
    filter: st.filter, list, missedUnseen: list.counts.unseen,
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
    case 'calls-filter': st.filter = target.dataset.f || 'all'; st.page = 1; return rerender();
    case 'calls-page': st.page = Math.max(1, st.page + Number(target.dataset.d || 0)); return rerender();
    case 'calls-page-to': st.page = Number(target.dataset.p) || 1; return rerender();
    case 'calls-getnum': st.view = 'getnum'; st.seed = Date.now(); return rerender();
    case 'calls-back': st.view = 'main'; return rerender();
    case 'calls-shuffle': st.seed = Date.now(); st.picked = null; return rerender();
    case 'calls-pick': st.picked = target.dataset.number; st.typed = ''; return rerender();
    case 'calls-code': st.region = { ...st.region, code: target.dataset.code }; st.picked = null; return rerender();
    case 'calls-use': {
      const root = viewer.element;
      const typed = root?.querySelector('[data-calls-own]')?.value?.trim();
      const code = st.region?.code;
      const number = typed ? (typed.startsWith('+') ? typed : `+${st.region?.country || '1'} ${code && st.region?.country === '1' && !/^\(?\d{3}\)?\s/.test(typed) ? `(${code}) ` : ''}${typed}`) : st.picked;
      if (!number) return;
      const r = await s.assignNumber({ actorId: own?.actorId, contactId: own?.contactId, number });
      if (!r.ok) { ui.notifications?.warn(r.error); return; }
      if (r.relayed) ui.notifications?.info(`Number requested: ${number}. It is yours as soon as the GM's screen confirms it.`);
      st.view = 'main'; st.typed = '';
      setTimeout(rerender, r.relayed ? 600 : 0);
      return;
    }
    case 'calls-dial': return dial(viewer, target.dataset.number);
    case 'calls-trace': { const r = await s.traceCall(target.dataset.call); if (r && !r.ok && r.error) ui.notifications?.warn(r.error); return setTimeout(rerender, 800); }
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
        if (clip?.blob?.size) r = await s.saveRecordedGreeting(number, settings, { base64: await blobToBase64(clip.blob), mime: clip.mime, ms: clip.ms });
        else {
          const cur = s.lineSettings(number).greeting;
          if (!cur.audio) { ui.notifications?.warn('Record a greeting first.'); return; }
          r = await s.saveLineSettings(number, { ...settings, greeting: { ...settings.greeting, audio: cur.audio, duration: cur.duration } });
        }
      } else r = await s.saveLineSettings(number, settings);
      st.mlClip = null;
      if (!r.ok) { ui.notifications?.warn(r.error); return; }
      ui.notifications?.info(r.relayed ? 'Saved — it is yours as soon as the GM\'s screen confirms it.' : 'Your line is set.');
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
  const as = st.as ? { contactId: st.as } : own.actorId ? { actorId: own.actorId } : { contactId: own.contactId };
  const r = await s.placeCall(number, as);
  if (!r.ok && r.error) ui.notifications?.warn(r.error);
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
  const n = normaliseNumber(v, home);
  const byNumber = n && n.replace(/\D/g, '').length >= 5 ? book.find((b) => b.normal === n) : null;
  if (byNumber) return { state: 'ready', name: byNumber.name, img: byNumber.img };
  if (/[a-z]{2,}/i.test(v)) {
    const byName = book.find((b) => b.name.toLowerCase().includes(v.toLowerCase()));
    if (byName) return { state: 'ready', name: byName.name, img: byName.img, number: byName.number };
  }
  return v.replace(/\D/g, '').length >= 3 ? { state: 'number' } : { state: 'empty' };
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
  const home = game.nightcity?.callService?.homeCode || '+1';

  // the picker's selects (country / region) — a <select> fires on change, never as a data-action
  root.querySelectorAll('[data-calls-region]').forEach((sel) => sel.addEventListener('change', () => {
    const key = sel.dataset.callsRegion;
    st.region = { ...st.region, [key]: sel.value, ...(key === 'country' ? { region: null, code: null } : { code: null }) };
    st.picked = null; viewer.render();
  }));
  const own = root.querySelector('[data-calls-own]');
  own?.addEventListener('input', () => { st.typed = own.value; root.querySelectorAll('.ncm-calls-opt.on').forEach((o) => o.classList.toggle('on', !own.value)); });

  // Call as
  root.querySelector('[data-calls-as]')?.addEventListener('change', (e) => { st.as = e.target.value; viewer.render(); });

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
      } catch (err) { ui.notifications?.warn(err.message); rec = null; }
    });
    playBtn?.addEventListener('click', () => {
      const src = st.mlClip?.blob ? URL.createObjectURL(st.mlClip.blob) : playBtn.dataset.src;
      if (src) playAudio(src); else ui.notifications?.info('Nothing recorded yet.');
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
    if (a.state !== 'ready' && prev === 'ready') decodeTo(sub, 'not in your contacts', 300);
    if (match) match.innerHTML = a.state === 'ready' ? `<i class="fas fa-address-book"></i> ${esc(a.name)}${a.number ? ` · ${esc(a.number)}` : ''}` : '';
    btn.dataset.number = a.number || input.value.trim();
    prev = a.state;
  };
  input.addEventListener('input', update);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (!btn.disabled) dial(viewer, btn.dataset.number); } });
  root.querySelectorAll('[data-calls-key]').forEach((k) => k.addEventListener('click', () => {
    input.value += k.dataset.callsKey; input.dispatchEvent(new Event('input')); input.focus();
    k.classList.add('hit'); setTimeout(() => k.classList.remove('hit'), 140);
  }));
  root.querySelector('[data-calls-del]')?.addEventListener('click', () => { input.value = input.value.slice(0, -1); input.dispatchEvent(new Event('input')); input.focus(); });
  btn.addEventListener('click', () => { if (!btn.disabled) dial(viewer, btn.dataset.number); });
  // hover: CALL decodes into DIAL ▸ (and back)
  btn.addEventListener('mouseenter', () => { if (!btn.disabled) decodeTo(kind, 'Dial ▸', 260); });
  btn.addEventListener('mouseleave', () => { if (!btn.disabled) decodeTo(kind, 'Call', 200); });
  if (st.dial && !input.value) { input.value = st.dial; }
  input.addEventListener('input', () => { st.dial = input.value; });
  update();
}
