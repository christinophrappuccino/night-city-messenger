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

export const PHONE_VIEWS = [
  ['live', 'Live', 'fa-tower-broadcast'],
  ['numbers', 'Numbers', 'fa-sim-card'],
  ['log', 'Call log', 'fa-list'],
  ['vm', 'Voicemail', 'fa-voicemail'],
  ['settings', 'Settings', 'fa-sliders'],
];

export const LOG_FILTERS = [['all', 'All calls'], ['answered', 'Answered'], ['missed', 'Missed'], ['declined', 'Declined'], ['dropped', 'Dropped']];
export const NUMBER_SHOW = [['all', 'Everyone'], ['has', 'Has a number'], ['none', 'No number'], ['burner', 'Burners']];
export const LOG_PER_PAGE = 40;

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
 * NUMBERS: every owner and their lines, grouped Players' characters / NPCs / Unowned lines.
 * @param {{lines:object, pcs:{actorId,actorName,playerName,img?}[], contacts:{id,name,phone?,actorId?,identityOf?,sendOnly?,img?}[], q?:string, show?:string, shut?:Set, open?:Set}} o
 */
export function numberGroups({ lines = {}, pcs = [], contacts = [], q = '', show = 'all', shut = new Set(), open = new Set() } = {}) {
  const byActor = new Map(), byContact = new Map(), used = new Set();
  for (const [normal, l] of Object.entries(lines)) {
    const o = l.owner || {};
    if (o.contactId) byContact.set(o.contactId, { normal, number: l.number, owner: o });
    else if (o.actorId) byActor.set(o.actorId, { normal, number: l.number, owner: o });
  }
  const contactById = new Map(contacts.map((c) => [c.id, c]));
  const players = [], npcs = [], unowned = [];
  const pcIds = new Set(pcs.map((p) => p.actorId));
  for (const p of pcs) {
    const main = byActor.get(p.actorId);
    if (main) used.add(main.normal);
    players.push({ key: `a:${p.actorId}`, name: p.actorName, subline: p.playerName, img: p.img || '', initials: initials(p.actorName), number: main?.number || '',
      kind: main ? 'main' : 'none', actorId: p.actorId, contactId: null, player: true });
    // a player character's burners (aliases with a line)
    for (const [cid, b] of byContact) {
      if (b.owner.actorId !== p.actorId) continue;
      used.add(b.normal);
      const c = contactById.get(cid);
      players.push({ key: `c:${cid}`, name: c?.name || b.owner.name, subline: `burner · ${p.actorName}`, img: c?.img || '', initials: initials(c?.name || b.owner.name),
        number: b.number, kind: 'burner', actorId: p.actorId, contactId: cid, player: true, alias: true });
    }
  }
  for (const c of contacts) {
    if (c.sendOnly || (c.actorId && pcIds.has(c.actorId))) continue;
    const line = byContact.get(c.id);
    if (line) used.add(line.normal);
    const number = line?.number || c.phone || '';
    if (!number) continue;                        // NPCs are listed when they have a line; Give a number adds one
    npcs.push({ key: `c:${c.id}`, name: c.name, subline: c.identityOf ? `alias of ${contactById.get(c.identityOf)?.name || 'someone'}` : '', img: c.img || '',
      initials: initials(c.name), number, kind: 'main', actorId: c.actorId || null, contactId: c.id, alias: !!c.identityOf, fromDirectory: !line });
  }
  for (const [normal, l] of Object.entries(lines)) {
    if (used.has(normal)) continue;
    const o = l.owner || {};
    if (o.actorId && !o.contactId && !pcIds.has(o.actorId)) {
      npcs.push({ key: `a:${o.actorId}`, name: o.name || l.number, subline: 'character', img: '', initials: initials(o.name), number: l.number, kind: 'main', actorId: o.actorId, contactId: null });
      continue;
    }
    unowned.push({ key: `n:${normal}`, name: o.name || 'Owner gone', subline: 'the owner no longer exists', img: '', initials: '?', number: l.number, kind: 'orphan', actorId: null, contactId: null });
  }
  const pass = (r) => matches(q, r.name, r.subline, r.number) && (show === 'all' || (show === 'has' ? r.kind !== 'none' : show === 'none' ? r.kind === 'none' : r.kind === 'burner'));
  const forced = !!q || show !== 'all';
  const raw = [
    { key: 'players', label: "Players' characters", icon: 'fa-user', hue: 'var(--ncm-hue-3)', rows: players },
    { key: 'npcs', label: 'NPCs', icon: 'fa-user-secret', hue: 'var(--ncm-hue-1)', rows: npcs.sort((a, b) => a.name.localeCompare(b.name)) },
    { key: 'unowned', label: 'Lines with no owner', icon: 'fa-circle-question', hue: 'var(--ncm-bad)', rows: unowned },
  ];
  const groups = [];
  for (const g of raw) {
    const rows = g.rows.filter(pass);
    if (!rows.length) continue;
    groups.push({ ...g, rows, count: rows.length, noNumber: rows.filter((r) => r.kind === 'none').length,
      shut: foldShut(g.key, { index: groups.length, shut, open, forced }) });
  }
  return { groups, total: players.length + npcs.length + unowned.length, noNumber: players.filter((r) => r.kind === 'none').length,
    shown: groups.reduce((n, g) => n + g.count, 0), empty: !groups.length, forced };
}

/**
 * CALL LOG: every call, newest first, by day, filtered and paged.
 * @param {object[]} entries — CallService.allLogs()
 */
export function logView(entries, { q = '', filter = 'all', page = 1, per = LOG_PER_PAGE, fmtDay = (d) => d, fmtTime = () => '' } = {}) {
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
  const counts = Object.fromEntries(LOG_FILTERS.map(([k]) => [k, k === 'all' ? all.length : all.filter((r) => r.outcome === k).length]));
  const shown = all.filter((r) => (filter === 'all' || r.outcome === filter) && matches(q, r.from.name, r.from.number, r.to.name, r.to.number, r.net, r.scene, ...r.transcript.map((x) => x.text)));
  const pages = Math.max(1, Math.ceil(shown.length / per));
  const p = Math.min(Math.max(1, page), pages);
  const slice = shown.slice((p - 1) * per, p * per);
  const days = [];
  for (const r of slice) {
    r.time = r.gameTime ? fmtTime(r.gameTime) : '';
    const last = days.at(-1);
    if (last && last.day === r.day) last.rows.push(r); else days.push({ day: r.day, label: r.day ? fmtDay(r.day) : 'Earlier', rows: [r] });
  }
  for (const d of days) d.bad = d.rows.filter((r) => r.info.tone === 'bad').length;
  return { days, counts, page: p, pages, total: shown.length, from: shown.length ? (p - 1) * per + 1 : 0, to: (p - 1) * per + slice.length };
}

/**
 * VOICEMAIL: every message, one box per line owner — NPCs first (most unheard first), then players' boxes.
 * Folds: the first box open, the rest closed; the GM's own fold wins; a box with unheard messages says so when closed.
 * @param {object[]} vms — CallService.allVoicemails() rows with {ownerId, ownerIsContact}
 * @param {{ownerName:(v)=>string, isNpc:(v)=>boolean, fmt:(iso)=>string, shut?:Set, open?:Set}} o
 */
export function voicemailBoxes(vms, { ownerName = () => '', isNpc = () => true, fmt = (x) => x, shut = new Set(), open = new Set() } = {}) {
  const by = new Map();
  for (const v of vms || []) {
    const key = v.ownerId;
    if (!by.has(key)) by.set(key, { ownerId: key, name: ownerName(v), npc: !!isNpc(v), rows: [] });
    by.get(key).rows.push({ vmId: v.vmId, ownerId: key, from: party(v.from), toName: v.to?.name || '', toContactId: v.to?.contactId || '', toActorId: v.to?.actorId || '',
      text: v.text || '', tts: v.kind === 'tts', voice: v.voice || '', heard: !!v.heard, when: v.gameTime ? fmt(v.gameTime) : '',
      isAudio: v.kind === 'audio', audio: v.audio || '', length: v.duration ? formatDuration(v.duration) : '' });
  }
  const boxes = [...by.values()].map((b) => ({ ...b, count: b.rows.length, unheard: b.rows.filter((r) => !r.heard).length }));
  boxes.sort((a, b) => Number(b.npc) - Number(a.npc) || b.unheard - a.unheard || a.name.localeCompare(b.name));
  boxes.forEach((b, i) => { b.shut = foldShut(`vm:${b.ownerId}`, { index: i, shut, open }); });
  const npcUnheard = boxes.filter((b) => b.npc).reduce((n, b) => n + b.unheard, 0);
  return { boxes, total: (vms || []).length, npcUnheard, empty: !boxes.length };
}

/** SETTINGS: the rows, read from the current values. Pure so the sim can check every key reaches a control. */
export function settingsView(v = {}, { modesAvailable = ['loud', 'type', 'dictate'] } = {}) {
  const modeNames = { loud: 'Out loud', type: 'Type', dictate: 'Dictate' };
  const modes = (Array.isArray(v.callModes) ? v.callModes : []);
  return {
    enabled: !!v.callsEnabled,
    modes: modesAvailable.map((m) => ({ key: m, label: modeNames[m] || m, on: modes.includes(m) })),
    startModes: modesAvailable.filter((m) => modes.includes(m)).map((m) => ({ key: m, label: modeNames[m] || m, on: v.callDefaultMode === m })),
    homeCode: v.callHomeCode || '+1',
    ringSeconds: Number(v.callRingSeconds) || 30,
    unknown: [['not-in-service', 'Not in service'], ['gm', 'Ring me (the GM)']].map(([k, l]) => ({ key: k, label: l, on: (v.callUnknownNumbers || 'not-in-service') === k })),
    notice: v.callTranscriptNotice !== false,
    recording: v.voicemailRecording !== false,
    maxSeconds: Number(v.voicemailMaxSeconds) || 60,
    keepDays: v.voicemailKeepDays == null ? 30 : Number(v.voicemailKeepDays) || 0,
  };
}
