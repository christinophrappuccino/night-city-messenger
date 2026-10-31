/**
 * Call model — the rules of a call, as pure functions.
 * @file scripts/utils/callModel.js
 * @module night-city-messenger
 * @description Pure (no Foundry globals). Design: dev/design/CALLS.md §1–§4, build plan §11.2.
 *
 * A call is a plain object both clients hold a copy of; every change goes through `transition(call, event)`, which
 * returns a NEW object (or the same one when the event does not apply). The world is passed in as plain data
 * (`resolveCallee`'s `world`), so the sims drive the real rules with no Foundry.
 */

import { normaliseNumber, isShortNumber, DEFAULT_HOME_CODE } from './phoneNumbers.js';

/** Every state a call can be in. */
export const CALL_STATES = Object.freeze(['dialing', 'ringing', 'live', 'held', 'voicemail', 'ended']);

/** How a call can end, and the words the HUD shows for it. */
export const OUTCOMES = Object.freeze({
  answered: 'Call ended',
  missed: 'No answer',
  declined: 'Declined',
  busy: 'Busy',
  dropped: 'Call dropped',
  'no-signal': 'No signal',
  'not-in-service': 'Not in service',
  voicemail: 'Voicemail sent',
});

/** The ways to talk on a call, in the order the chips show them. */
export const CALL_MODES = Object.freeze(['loud', 'type', 'dictate']);
export const MODE_INFO = Object.freeze({
  loud: { label: 'Out loud', icon: 'fa-users', tip: 'Talk at the table or on Discord. The call just shows.' },
  type: { label: 'Type', icon: 'fa-keyboard', tip: 'Write your lines. They appear as subtitles.' },
  dictate: { label: 'Dictate', icon: 'fa-microphone', tip: 'Talk into your mic — your words become subtitles (the browser’s speech service does the listening).' },
});

/** A call id: unique enough for a session and a log page. */
export function newCallId(rand = Math.random) {
  return 'call-' + Date.now().toString(36) + '-' + Math.floor(rand() * 1e9).toString(36);
}

/**
 * A new call, ringing.
 * @param {object} o
 * @param {object} o.from — {userId, actorId, contactId, number, name}
 * @param {object} o.to   — {kind, userIds, actorId, contactId, number, name}
 * @param {object} [o.net] — {id, name, type, strength, color}
 * @param {string} [o.mode]
 * @param {number} [o.now]
 * @param {string} [o.id]
 */
export function createCall({ from, to, net = null, mode = 'loud', now = Date.now(), id = newCallId() }) {
  return { id, from: { ...from }, to: { ...to }, net: net ? { ...net } : null, mode,
    state: 'ringing', startedAt: now, answeredAt: null, endedAt: null, outcome: null,
    answeredBy: null, heldAt: null };
}

/** A call that never rang (no signal, not in service): created already ended. */
export function createEndedCall(args, outcome, now = Date.now()) {
  return { ...createCall({ ...args, now }), state: 'ended', endedAt: now, outcome };
}

/**
 * Apply an event. Unknown or out-of-place events return the call unchanged (so a late socket message is harmless).
 * @param {object} call
 * @param {{type: string, by?: string, mode?: string}} ev
 * @param {number} [now]
 * @returns {object}
 */
export function transition(call, ev, now = Date.now()) {
  if (!call || !ev?.type) return call;
  const ringing = call.state === 'ringing' || call.state === 'dialing';
  const live = call.state === 'live' || call.state === 'held';
  const end = (outcome) => ({ ...call, state: 'ended', endedAt: now, outcome });
  switch (ev.type) {
    case 'answer': return ringing ? { ...call, state: 'live', answeredAt: now, answeredBy: ev.by ?? null } : call;
    case 'decline': return ringing ? end('declined') : call;
    case 'cancel': return ringing ? end('missed') : call;
    case 'timeout': return ringing ? end('missed') : call;
    case 'busy': return ringing ? end('busy') : call;
    case 'voicemail': return ringing ? end('voicemail') : call;
    case 'hangup': return live ? end('answered') : ringing ? end('missed') : call;
    case 'drop': return (live || ringing) ? end('dropped') : call;
    case 'hold': return call.state === 'live' ? { ...call, state: 'held', heldAt: now } : call;
    case 'resume': return call.state === 'held' ? { ...call, state: 'live', heldAt: null } : call;
    case 'mode': return (live && CALL_MODES.includes(ev.mode)) ? { ...call, mode: ev.mode } : call;
    default: return call;
  }
}

/** Seconds on the line (0 before it is answered). */
export function callSeconds(call, now = Date.now()) {
  if (!call?.answeredAt) return 0;
  return Math.max(0, Math.floor(((call.endedAt ?? now) - call.answeredAt) / 1000));
}

/** "4:12" / "1:02:03". */
export function formatDuration(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

/**
 * Who owns a number.
 * @param {string} raw — as dialled
 * @param {object} world
 * @param {string} [world.homeCode]
 * @param {{id, name, phone, playerOwned, userIds?: string[]}[]} world.actors
 * @param {{id, name, phone, actorId?, sendOnly?}[]} world.contacts
 * @returns {{kind: 'player'|'npc'|'unowned', number: string, normal: string, actorId?, contactId?, name?, userIds?: string[], sendOnly?: boolean}}
 */
export function resolveCallee(raw, world = {}) {
  const home = world.homeCode || DEFAULT_HOME_CODE;
  const normal = normaliseNumber(raw, home);
  const base = { number: String(raw ?? '').trim(), normal };
  if (!normal) return { ...base, kind: 'unowned' };
  const actors = world.actors || [];
  const actor = actors.find((a) => a.phone && normaliseNumber(a.phone, home) === normal);
  if (actor) return { ...base, kind: actor.playerOwned ? 'player' : 'npc', actorId: actor.id, name: actor.name, userIds: actor.userIds || [] };
  const contact = (world.contacts || []).find((c) => c.phone && normaliseNumber(c.phone, home) === normal);
  if (contact) {
    // An identity of a player character (a burner) rings that player; anything else is an NPC line the GM answers.
    const linked = contact.actorId ? actors.find((a) => a.id === contact.actorId) : null;
    const isPlayer = !!linked?.playerOwned;
    return { ...base, kind: isPlayer ? 'player' : 'npc', contactId: contact.id, actorId: contact.actorId || null,
      name: contact.name, userIds: isPlayer ? (linked.userIds || []) : [], sendOnly: !!contact.sendOnly };
  }
  return { ...base, kind: 'unowned' };
}

/**
 * May this call be placed, and if not, how does it end?
 * @param {object} o
 * @param {boolean} [o.enabled=true]  — the callsEnabled setting
 * @param {string} o.fromNumber       — the caller's line (as typed)
 * @param {object} o.callee           — resolveCallee()
 * @param {boolean} [o.noSignal]      — dead zone / a node cut here / no network
 * @param {string} [o.homeCode]
 * @param {string} [o.unknownNumbers='not-in-service'] — 'not-in-service' | 'gm'
 * @returns {{ok: boolean, outcome?: string, reason?: string, toGm?: boolean}}
 */
export function canCall({ enabled = true, fromNumber, callee, noSignal = false, homeCode = DEFAULT_HOME_CODE, unknownNumbers = 'not-in-service' }) {
  if (!enabled) return { ok: false, reason: 'Calls are switched off at this table.' };
  if (!fromNumber) return { ok: false, reason: 'You need a number first.' };
  if (!callee?.normal) return { ok: false, reason: 'Type a number.' };
  if (normaliseNumber(fromNumber, homeCode) === callee.normal) return { ok: false, reason: 'That is your own number.' };
  if (noSignal) return { ok: false, outcome: 'no-signal', reason: 'No signal here.' };
  if (callee.sendOnly) return { ok: false, outcome: 'not-in-service', reason: 'That line does not take calls.' };
  if (callee.kind === 'unowned') {
    if (unknownNumbers === 'gm') return { ok: true, toGm: true };
    return { ok: false, outcome: 'not-in-service', reason: 'The number you have dialled is not in service.' };
  }
  return { ok: true, toGm: callee.kind === 'npc' };
}

/**
 * The modes a player may use: the GM's list, minus Dictate where the browser can't, never empty.
 * @param {string[]} gmModes
 * @param {{dictate?: boolean}} [support]
 */
export function allowedModes(gmModes = CALL_MODES, support = {}) {
  const list = CALL_MODES.filter((m) => (gmModes || []).includes(m) && (m !== 'dictate' || support.dictate));
  return list.length ? list : ['loud'];
}

/** The mode a call opens in: the GM's default when allowed, else the first allowed. */
export function defaultMode(gmDefault, allowed) {
  return allowed.includes(gmDefault) ? gmDefault : allowed[0];
}

// ═══════════════════════════════════════════════════════════
//  Typed lines (phase 2)
// ═══════════════════════════════════════════════════════════

/** The longest line, and the most lines a call keeps (the transcript). */
export const LINE_MAX = 500;
export const TRANSCRIPT_MAX = 300;

/** Modes that are built (Dictate since phase 5). */
export const BUILT_MODES = Object.freeze(['loud', 'type', 'dictate']);

/**
 * A line as sent: plain text on one line, trimmed, capped. Null when there is nothing to send.
 * @param {{side: 'caller'|'callee', text: string, at?: number, id?: string, via?: 'type'|'dictate'}} o
 */
export function makeLine({ side, text, at = Date.now(), id, via } = {}) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, LINE_MAX);
  if (!t || !['caller', 'callee'].includes(side)) return null;
  return { id: id || newCallId(), side, text: t, at, ...(via === 'dictate' ? { via } : {}) };
}

/** A call with one more line (the same line twice — a socket echo — is kept once; the oldest fall off past the cap). */
export function addLine(call, line) {
  if (!call || !line) return call;
  const lines = Array.isArray(call.lines) ? call.lines : [];
  if (lines.some((l) => l.id === line.id)) return call;
  return { ...call, lines: [...lines, line].slice(-TRANSCRIPT_MAX) };
}

/** How long a received line takes to type out on screen: ~30 ms a character, never more than 2.4 s. */
export function typeOutMs(text, perChar = 30, cap = 2400) {
  return Math.min(cap, Math.max(0, String(text ?? '').length * perChar));
}

/** Which side of a call a user is on: 'caller' | 'callee' | null. */
export function sideOf(call, userId) {
  if (!call || !userId) return null;
  if (call.from?.userId === userId) return 'caller';
  if (call.answeredBy === userId) return 'callee';
  return null;
}

/** The transcript as the log keeps it: who said what, oldest first — names from the call's two ends. */
export function transcriptOf(call) {
  return (call?.lines || []).map((l) => ({ side: l.side, name: (l.side === 'caller' ? call.from?.name : call.to?.name) || '', text: l.text, at: l.at }));
}

/** Is a number a short service number? (re-export for callers that only import the model) */
export { isShortNumber };
