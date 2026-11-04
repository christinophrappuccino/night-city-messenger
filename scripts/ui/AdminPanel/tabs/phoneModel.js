/**
 * Admin → Phone — the pure rules (no Foundry globals; driven by dev/tools/sims/test-admin-phone.mjs).
 * @file scripts/ui/AdminPanel/tabs/phoneModel.js
 * @module night-city-messenger
 * @description Mock dev/mockups/admin-phone-mock.html, design dev/design/CALLS.md §10. PhoneTab gathers the world
 *   (lines, calls, characters, the directory, the logs) and these turn it into the four views: LIVE (what rings for
 *   the GM + the switchboard), NUMBERS (every owner and their lines, grouped), CALL LOG (every call, by day) and the
 *   settings rows. Folds follow the standing rule: the first group open, the rest closed, a search opens everything,
 *   the GM's own fold wins for the session.
 */

import { formatDuration } from '../../../utils/callModel.js';
import { dateBands, namedGroups, searchSnippet, markHit } from '../../../utils/logFolds.js';

export const PHONE_VIEWS = [
  ['live', 'Live', 'fa-tower-broadcast'],
  ['numbers', 'Numbers', 'fa-sim-card'],
  ['overheard', 'Overheard calls', 'fa-ear-listen'],
  ['payphones', 'Payphones', 'fa-phone-volume'],
  ['setup', 'Number setup', 'fa-sliders'],
  ['log', 'Call log', 'fa-list'],
  ['settings', 'Settings', 'fa-gear'],
];

/** Views that live under another's nav button: the Call log holds its Calls tab, Voicemail and the log editor. */
export const NAV_PARENT = Object.freeze({ vm: 'log', logedit: 'log' });

/** Where the Call log button lands: voicemail waiting comes first, and a click from inside it stays put. */
export const logLanding = (view, unheard) => (NAV_PARENT[view] === 'log' || view === 'log' ? view : unheard > 0 ? 'vm' : 'log');

export const QUEUE_KINDS = Object.freeze({ corp: ['Company', 'fa-building'], shared: ['Shared line', 'fa-users'], special: ['Special', 'fa-star-of-life'], npc: ['NPC', 'fa-user'], pay: ['Payphone', 'fa-phone'] });
export const QUEUE_SHOW = [['all', 'All calls'], ['corp', 'Companies'], ['npc', 'NPCs'], ['shared', 'Shared lines'], ['special', 'Special numbers'], ['pay', 'Payphones'], ['hold', 'On hold']];

/**
 * The call queue: longest wait first, numbered, one call open at a time.
 * @param {object[]} ringing — liveBoard ringing rows
 * @param {{filter?: string, open?: string|null, now?: number, kindOf?: Function}} o
 */
export function callQueue(ringing, { filter = 'all', open = null, now = Date.now(), kindOf = () => 'npc' } = {}) {
  const all = [...ringing].sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0)).map((c, i) => {
    const kind = kindOf(c), [word, icon] = QUEUE_KINDS[kind] || QUEUE_KINDS.npc;
    return { ...c, pos: i + 1, kind, word, icon, held: !!c.queueHold, waitS: Math.max(0, Math.round((now - (c.startedAt || now)) / 1000)), asks: c.to?.name || c.to?.number || 'them', isSpecial: kind === 'special' };
  });
  const openId = open ?? all.find((c) => !c.held)?.id ?? all[0]?.id ?? null;
  return { count: all.length, rows: all.filter((c) => filter === 'all' || (filter === 'hold' ? c.held : c.kind === filter)).map((c) => ({ ...c, open: c.id === openId })), allHeld: all.length > 0 && all.every((c) => c.held) };
}

export const LOG_FILTERS = [['all', 'All results'], ['answered', 'Answered'], ['missed', 'Missed'], ['declined', 'Declined'], ['dropped', 'Dropped'], ['words', 'Has a transcript'], ['heard', 'Caught by a tap']];
export const LOG_GROUPS = [['date', 'By date'], ['person', 'By person']];
export const VM_SHOW = [['all', 'All messages'], ['new', 'New'], ['heard', 'Heard'], ['npc', 'NPC mailboxes'], ['pc', 'Player mailboxes']];
export const VM_GROUPS = [['box', 'By mailbox'], ['date', 'By date']];

const STATE_WORDS = { dialing: 'Dialling', ringing: 'Ringing', live: 'On the line', held: 'On hold' };
const OUTCOME = {
  answered: ['Answered', 'good', 'fa-phone'], missed: ['Missed', 'bad', 'fa-phone-slash'], declined: ['Declined', 'attn', 'fa-phone-slash'],
  busy: ['Busy', 'attn', 'fa-phone-slash'], dropped: ['Dropped', 'bad', 'fa-plug-circle-xmark'], 'no-signal': ['No signal', 'bad', 'fa-signal'],
  'not-in-service': ['Not in service', 'plain', 'fa-ban'], voicemail: ['Voicemail', 'attn', 'fa-voicemail'],
};
export const outcomeInfo = (o) => { const [word, tone, icon] = OUTCOME[o] || [o || 'Ended', 'plain', 'fa-phone']; return { word, tone, icon }; };

const initials = (n) => String(n || '').replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '#';
const party = (p = {}) => ({ name: p.name || p.number || 'Unknown', number: p.number || '', img: p.img || '', initials: initials(p.name || '#'),
  actorId: p.actorId || null, contactId: p.contactId || null });
const hay = (...parts) => parts.filter(Boolean).join(' ').toLowerCase();
const matches = (q, ...parts) => !q || hay(...parts).includes(String(q).toLowerCase().trim());

/** A fold rule shared by every grouped list here: first group open by default; search opens all; the GM's choice wins. */
export function foldShut(key, { index = 0, shut = new Set(), open = new Set(), forced = false } = {}) {
  if (forced) return false;
  if (shut.has(key)) return true;
  if (open.has(key)) return false;
  return index > 0;
}

/**
 * LIVE: what rings for the GM (NPC lines, unowned numbers) and every other call in the world.
 * @param {object[]} calls — CallService.allCalls()
 * @param {{now:number, ringMs:number, ringsForMe:(c)=>boolean, roleOf:(c)=>string, voiceOf?:(contactId)=>string}} o
 */
/** A call's typed lines for the GM, newest last (names from the call's two ends — the GM sees everyone). */
export function transcriptLines(lines, from = {}, to = {}, max = 0) {
  const list = (lines || []).map((l) => ({ side: l.side, name: l.name || (l.side === 'caller' ? from.name : to.name) || '', text: l.text || '' }))
    .filter((l) => l.text);
  return max ? list.slice(-max) : list;
}

export function liveBoard(calls, { now = Date.now(), ringMs = 30000, ringsForMe = () => false, roleOf = () => 'watch', voiceOf = () => '', listening = new Set() } = {}) {
  const ringing = [], lines = [];
  for (const c of calls || []) {
    if (!c || c.state === 'ended') continue;
    const from = party(c.from), to = party(c.to);
    const role = roleOf(c);
    const row = {
      id: c.id, startedAt: c.startedAt || now, answeredAt: c.answeredAt || 0, state: c.state, stateWord: STATE_WORDS[c.state] || c.state, from, to, role, mine: role !== 'watch',
      net: c.net?.name || '', mode: (c.lines?.some((l) => l.via === 'dictate') ? 'dictate' : c.lines?.length ? 'type' : c.mode || 'loud'), unowned: c.to?.kind === 'unowned',
      lineCount: (c.lines || []).length, listening: listening.has(c.id), heard: transcriptLines(c.lines, c.from, c.to, 12),
      timer: c.answeredAt ? formatDuration(Math.max(0, Math.round((now - c.answeredAt) / 1000))) : '',
      anon: !!c.from?.anon && !c.traced,
    };
    if (c.state === 'ringing' && ringsForMe(c)) {
      const left = Math.max(0, Math.round((ringMs - (now - (c.startedAt || now))) / 1000));
      ringing.push({ ...row, voice: c.to?.contactId ? voiceOf(c.to.contactId) : '', left, pct: Math.min(100, Math.max(0, Math.round((now - (c.startedAt || now)) / ringMs * 100))) });
    } else lines.push(row);
  }
  const order = { live: 0, held: 1, ringing: 2, dialing: 3 };
  lines.sort((a, b) => (order[a.state] ?? 9) - (order[b.state] ?? 9));
  const modes = { loud: 0, type: 0, dictate: 0 };
  for (const l of lines) if (l.state === 'live' || l.state === 'held') modes[l.mode] = (modes[l.mode] || 0) + 1;
  return { ringing, lines, modes, total: ringing.length + lines.length, quiet: !ringing.length && !lines.length };
}

/**
 * CALL LOG: search, filters, then groups: date bands, or one group per person on the call.
 * @param {object[]} entries
 * @param {{q?: string, filter?: string, who?: string, net?: string, from?: string, to?: string, group?: 'date'|'person', now?: string, shut?: Set, open?: Set, limits?: object, fmtDay?: Function, fmtTime?: Function, fmtWhen?: Function}} o
 */
export function logView(entries, { q = '', filter = 'all', who = '', net = '', from = '', to = '', group = 'date', now, shut, open, limits = {}, fmtDay = (d) => d, fmtTime = () => '', fmtWhen = fmtTime } = {}) {
  const all = (entries || []).map((l) => {
    const info = outcomeInfo(l.outcome);
    const talked = l.outcome === 'answered' && l.seconds;
    return { id: l.callId, from: party(l.from), to: party(l.to), outcome: l.outcome, info, net: l.net?.name || '', scene: l.scene || '',
      detail: talked ? formatDuration(l.seconds) : '', mode: l.mode || '', day: (l.gameTime || '').slice(0, 10), gameTime: l.gameTime || '',
      transcript: transcriptLines(l.lines, l.from, l.to),
      anon: !!l.from?.anon && !l.traced, why: l.dropReason || '',
      heardBy: (l.heardBy || []).map((h) => h?.name).filter(Boolean),
      journalId: l.journalId, pageId: l.pageId };
  });
  const passes = (r, k) => k === 'all' || (k === 'words' ? r.transcript.length > 0 : k === 'heard' ? r.heardBy.length > 0 : r.outcome === k);
  const counts = Object.fromEntries(LOG_FILTERS.map(([k]) => [k, all.filter((r) => passes(r, k)).length]));
  const lower = from ? String(from).slice(0, 10) : '', upper = to ? String(to).slice(0, 10) : '';
  const shown = all.filter((r) => passes(r, filter) && (!who || r.from.name === who || r.to.name === who) && (!net || r.net === net)
    && (!lower || r.day >= lower) && (!upper || r.day <= upper)
    && matches(q, r.from.name, r.from.number, r.to.name, r.to.number, r.net, r.scene, r.why, ...r.transcript.map((x) => x.text)));
  const hasQ = !!String(q || '').trim();
  for (const r of shown) {
    r.fromHtml = markHit(r.from.name, q); r.toHtml = markHit(r.to.name, q);
    r.hitHtml = hasQ ? markHit(searchSnippet(q, r.transcript.map((x) => x.text)), q) : '';
    r.time = !r.gameTime ? '' : group === 'person' ? fmtWhen(r.gameTime) : fmtTime(r.gameTime);
  }
  const forced = hasQ || filter !== 'all' || !!who || !!net || !!lower || !!upper;
  const common = { dateOf: (r) => r.gameTime, isHot: (r) => r.info.tone === 'bad', shut, open, forced, limits, prefix: 'log:' };
  const bands = group === 'person'
    ? namedGroups(shown, { ...common, prefix: 'log:p:', keysOf: (r) => [r.from.name, r.to.name].filter(Boolean), head: (k) => ({ label: k }) })
    : dateBands(shown, { ...common, now, dayLabel: fmtDay });
  const uniq = (list) => [...new Set(list.filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return { bands, counts, total: shown.length, of: all.length, forced, people: uniq(all.flatMap((r) => [r.from.name, r.to.name])), networks: uniq(all.map((r) => r.net)) };
}

/**
 * VOICEMAIL: every message, one box per line owner — NPCs first (most unheard first), then players' boxes.
 * Folds: the first box open, the rest closed; the GM's own fold wins; a box with unheard messages says so when closed.
 * @param {object[]} vms — CallService.allVoicemails() rows with {ownerId, ownerIsContact}
 * @param {{ownerName:(v)=>string, isNpc:(v)=>boolean, fmt:(iso)=>string, shut?:Set, open?:Set}} o
 */
export function voicemailBoxes(vms, { ownerName = () => '', isNpc = () => true, fmt = (x) => x, shut = new Set(), open = new Set(), q = '', show = 'all', group = 'box', now, limits = {}, fmtDay = (d) => d, fmtTime = fmt } = {}) {
  const by = new Map();
  for (const v of vms || []) {
    const key = v.ownerId;
    if (!by.has(key)) by.set(key, { ownerId: key, name: ownerName(v), npc: !!isNpc(v), rows: [] });
    by.get(key).rows.push({ vmId: v.vmId, ownerId: key, boxName: by.get(key).name, npc: by.get(key).npc, stamp: v.gameTime || '', from: party(v.from), toName: v.to?.name || '', toContactId: v.to?.contactId || '', toActorId: v.to?.actorId || '',
      text: v.text || '', tts: v.kind === 'tts', voice: v.voice || '', heard: !!v.heard, when: v.gameTime ? fmt(v.gameTime) : '',
      isAudio: v.kind === 'audio', audio: v.audio || '', length: v.duration ? formatDuration(v.duration) : '' });
  }
  const boxes = [...by.values()].map((b) => ({ ...b, count: b.rows.length, unheard: b.rows.filter((r) => !r.heard).length }));
  const boxOrder = (a, b) => Number(b.npc) - Number(a.npc) || b.unheard - a.unheard || a.name.localeCompare(b.name);
  boxes.sort(boxOrder);
  boxes.forEach((b, i) => { b.shut = foldShut(`vm:${b.ownerId}`, { index: i, shut, open }); });
  const npcUnheard = boxes.filter((b) => b.npc).reduce((n, b) => n + b.unheard, 0);

  // what the screen lists: search, Show, then a mailbox or date grouping
  const passes = (r) => ({ all: true, new: !r.heard, heard: r.heard, npc: r.npc, pc: !r.npc }[show] ?? true);
  const shown = boxes.flatMap((b) => b.rows).filter((r) => passes(r) && matches(q, r.from.name, r.from.number, r.toName, r.boxName, r.text));
  for (const r of shown) {
    r.fromHtml = markHit(r.from.name, q); r.toHtml = markHit(r.toName, q); r.textHtml = markHit(r.text, q);
    if (group === 'date') r.when = r.stamp ? fmtTime(r.stamp) : '';
  }
  const forced = !!String(q || '').trim() || show !== 'all';
  const common = { dateOf: (r) => r.stamp, isHot: (r) => !r.heard, shut, open, forced, limits };
  const groups = group === 'date'
    ? dateBands(shown, { ...common, now, dayLabel: fmtDay, prefix: 'vm:d:' })
    : namedGroups(shown, { ...common, prefix: 'vm:', keysOf: (r) => [r.ownerId], order: boxOrder,
      head: (k, rows) => ({ name: rows[0].boxName, label: rows[0].boxName, npc: rows[0].npc, player: !rows[0].npc, unheard: rows.filter((r) => !r.heard).length }) });
  return { boxes, groups, total: (vms || []).length, shownCount: shown.length, forced, npcUnheard, empty: !boxes.length };
}

/** SETTINGS: the rows, read from the current values. Pure so the sim can check every key reaches a control. */
export function settingsView(v = {}, { modesAvailable = ['loud', 'type', 'dictate'] } = {}) {
  const modeNames = { loud: 'Out loud', type: 'Type', dictate: 'Dictate' };
  const modes = (Array.isArray(v.callModes) ? v.callModes : []);
  return {
    enabled: !!v.callsEnabled,
    modes: modesAvailable.map((m) => ({ key: m, label: modeNames[m] || m, on: modes.includes(m) })),
    startModes: modesAvailable.filter((m) => modes.includes(m)).map((m) => ({ key: m, label: modeNames[m] || m, on: v.callDefaultMode === m })),
    ringSeconds: Number(v.callRingSeconds) || 30,
    unknown: [['not-in-service', 'Not in service'], ['gm', 'Ring me (the GM)']].map(([k, l]) => ({ key: k, label: l, on: (v.callUnknownNumbers || 'not-in-service') === k })),
    notice: v.callTranscriptNotice !== false,
    recording: v.voicemailRecording !== false,
    maxSeconds: Number(v.voicemailMaxSeconds) || 60,
    keepDays: v.voicemailKeepDays == null ? 30 : Number(v.voicemailKeepDays) || 0,
  };
}
