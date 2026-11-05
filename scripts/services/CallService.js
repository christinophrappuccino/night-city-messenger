/**
 * CallService — phone numbers and calls.
 * @file scripts/services/CallService.js
 * @module night-city-messenger
 * @description game.nightcity.callService. Design + build plan: dev/design/CALLS.md (§11).
 *
 * NUMBERS — the world setting `phoneLines` is the directory every client can read:
 *   { [normalisedNumber]: { number, owner: { actorId?, contactId?, name, kind: 'player'|'npc', userIds[] },
 *                           greeting?, voicemail? } }
 * Only the GM writes it; a player's own edit relays (SOCKET_OPS.CALL_LINE_REQUEST). A character's own number is also
 * mirrored to its actor flag `phone`, an NPC's to its master contact's `phone`. Directory contacts that already carry a
 * `phone` but have no line yet still resolve (callModel.resolveCallee reads both).
 *
 * CALLS — a call is a plain object (utils/callModel.js) every participant holds a copy of; events travel over ONE
 * socket op (SOCKET_OPS.CALL, `type` = ring | ringCancel | answer | decline | busy | hangup | drop | hold | resume).
 * A ring is broadcast and each client decides if it is for them (it owns the called character; or it is the active GM
 * and the number is an NPC's), so the caller never needs to see who owns what. Every GM also receives every event so
 * Admin → Phone → Live can show the switchboard. At the end, the CALLER sends one summary (CALL_LOG_REQUEST) and the
 * active GM writes a call-log page into each side's inbox journal (flag `callLog`, no `messageId`, so no mail reader
 * ever shows it as mail).
 */

import { ncmNotify } from '../utils/notify.js';
import { MODULE_ID, EVENTS, SOCKET_OPS } from '../utils/constants.js';
import { log, isGM, resolveOperator, resolveDisplayPortrait, whisperCardHtml } from '../utils/helpers.js';
import { serialize } from '../utils/serialize.js';
import { normaliseNumber, displayNumber, parseNumber, rowOf, fullForm, freeLines, numberAt, buildNumberContext, placeRows, sanitizeRules, pickableRows, sanitizeSpecial, specialKey, specialList, specialMap, specialOutcome, writtenToLog, lineTypes, lineTypeFor, lineShown, traceFinds, officeRowOf, officeKey, sanitizeOffice, splitExtension, placeOf } from '../utils/phoneNumbering.js';
import { createCall, createEndedCall, transition, resolveCallee, canCall, allowedModes, defaultMode, callSeconds, formatDuration, OUTCOMES,
  BUILT_MODES, makeLine, addLine, sideOf, transcriptOf, lineFromRightSide } from '../utils/callModel.js';
import { dropReason, maskCaller, callerFor, interceptMail } from '../utils/callNet.js';
import { placeLabel, maskPayphoneSide, payphoneSendGroups } from '../utils/payphones.js';
import { dictateStatus } from '../ui/Calls/dictation.js';
import { sanitizeLineSettings, greetingFor, goesToVoicemail, greetMs, makeVoicemail, voicemailOwner, recordingsToPurge, GREETING_RECORD_MS } from '../utils/voicemail.js';

const VOICEMAIL_OPEN_MS = 3 * 60 * 1000;   // a voicemail screen left open this long gives up (nothing is left)
const AUDIO_CHUNK = 120000;                // base64 characters per socket piece
const AUDIO_MAX_B64 = 3000000;             // ~2.2 MB: the most a recording may be (3 minutes at 32 kbps is ~1 MB)
const DATA_URL_MAX = 700000;               // a recording kept inside the message when the world cannot take files

const RING_BEAT_MS = 1100;   // one ring — the HUD dial fills on the same beat

export class CallService {
  constructor() {
    this.eventBus = game.nightcity.eventBus;
    this.socket = game.nightcity.socketManager;
    /** @type {Map<string, object>} calls this client is part of (or, for a GM, watching) */
    this.calls = new Map();
    /** @type {Map<string, number>} ring / timeout timers by call id */
    this._timers = new Map();
    this._ringLoops = new Map();
    /** @type {Map<string, string>} this client's own mode on each call (each side picks its own) */
    this._myMode = new Map();
    this._typingSent = new Map();
    /** GM: recordings arriving in pieces, by upload id */
    this._uploads = new Map();
    /** the network this client's side of each call rides (a change of it mid-call drops the call) */
    this._myNet = new Map();
  }

  // ═══════════════════════════════════════════════════════════
  //  Settings
  // ═══════════════════════════════════════════════════════════

  _get(key, fallback) { try { return game.settings.get(MODULE_ID, key); } catch { return fallback; } }
  get enabled() { return !!this._get('callsEnabled', true); }
  /** The number rules, defaults filled in. */
  get rules() { return sanitizeRules(this._get('phoneRules', {})); }
  /** The table, home and special numbers every reader uses. Rebuilt only when one of them changes. */
  get numberContext() {
    const places = this._get('phonePlaces', {}), rules = this._get('phoneRules', {}), special = this._get('phoneSpecial', {});
    const sig = JSON.stringify([places, rules, special]);
    if (this._ctxSig !== sig) { this._ctx = buildNumberContext({ rows: placeRows(places), home: sanitizeRules(rules).home, service: specialMap(specialList(special)) }); this._ctxSig = sig; }
    return this._ctx;
  }
  /** What every number reader takes. The name stays because it is passed around unopened. */
  get homeCode() { return this.numberContext; }
  get ringMs() { return Math.max(5, Number(this._get('callRingSeconds', 30)) || 30) * 1000; }
  get silent() { return !!this._get('callSilent', false); }
  get modes() { return allowedModes(this._get('callModes', ['loud', 'type', 'dictate']), { dictate: dictateStatus().ok }); }
  /** The modes this client can use on a call: the GM's list, the browser's support, and what is built. */
  get usableModes() { const m = this.modes.filter((x) => BUILT_MODES.includes(x)); return m.length ? m : ['loud']; }
  /** The chips shown: the GM's list (Dictate even where this browser can't — greyed, with the reason). */
  get offeredModes() { const gm = this._get('callModes', ['loud', 'type', 'dictate']); const m = BUILT_MODES.filter((x) => (gm || []).includes(x)); return m.length ? m : ['loud']; }
  /** Why Dictate can't be used here ('' when it can). */
  get dictateBlock() { const st = dictateStatus(); return st.ok ? '' : st.reason; }
  /** The player said yes to the notice (their voice goes to the browser's speech service) — once per browser. */
  get dictateConsent() { return !!this._get('callDictateConsent', false); }
  async setDictateConsent(v) { try { await game.settings.set(MODULE_ID, 'callDictateConsent', !!v); } catch { /* not registered */ } }
  get startMode() { return defaultMode(this._get('callDefaultMode', 'loud'), this.usableModes); }
  get transcriptNotice() { return !!this._get('callTranscriptNotice', true); }
  get recordingOn() { return this._get('voicemailRecording', true) !== false; }
  get maxRecordMs() { return Math.min(180, Math.max(10, Number(this._get('voicemailMaxSeconds', 60)) || 60)) * 1000; }
  get keepDays() { return Math.max(0, Number(this._get('voicemailKeepDays', 30)) || 0); }

  // ═══════════════════════════════════════════════════════════
  //  Numbers
  // ═══════════════════════════════════════════════════════════

  /** The whole directory, keyed by normalised number. */
  lines() { return { ...(this._get('phoneLines', {}) || {}) }; }

  /** One line by any spelling of its number. */
  line(number) { return this.lines()[normaliseNumber(number, this.homeCode)] || null; }

  /** Every number that reaches a character: its main line first, then extra lines, burners and aliases linked to it. */
  linesFor(actorId) {
    if (!actorId) return [];
    const kindOf = (l) => l.kind || (l.owner?.contactId ? 'alias' : 'main');
    const rank = { main: 0, extra: 1, burner: 2, alias: 3 };
    return Object.entries(this.lines()).filter(([, l]) => l.owner?.actorId === actorId)
      .map(([normal, l]) => { const kind = kindOf(l); return { normal, number: l.number, name: l.owner.name, contactId: l.owner.contactId || null, kind, label: l.label || '', main: kind === 'main', burner: kind !== 'main' && kind !== 'extra' }; })
      .concat(Object.entries(this.lines()).filter(([, l]) => (l.members || []).some((m) => m.actorId === actorId)).map(([normal, l]) => ({ normal, number: l.number, name: l.label, contactId: null, kind: 'shared', label: l.label || '', main: false, burner: false, shared: true })))
      .sort((a, b) => (rank[a.kind] ?? 4) - (rank[b.kind] ?? 4));
  }

  /** The number a character is called on (its own line, not a burner). */
  numberOf(actorId) { return this.linesFor(actorId).find((l) => l.main)?.number || ''; }

  /** The line a directory contact (NPC identity) answers on. */
  numberOfContact(contactId) {
    const all = Object.values(this.lines()).filter((l) => l.owner?.contactId === contactId);
    const hit = all.find((l) => !['extra', 'burner'].includes(l.kind)) || all[0];
    if (hit) return hit.number;
    return game.nightcity?.masterContactService?.getContact?.(contactId)?.phone || '';
  }

  /**
   * The number to ring a contact on, or '' when there is none. Only what the holder was given: never a fallback to the
   * directory or a linked character, because an email share must not bring a Call button, and an alias must never
   * reach its character's main line. Never a send-only (system) address.
   */
  numberForContact(c) {
    if (!c) return '';
    const mcs = game.nightcity?.masterContactService;
    if (c.sendOnly || (c.email && mcs?.isSendOnly?.(c.email))) return '';
    return c.phone || '';
  }

  /** Numbers that were changed, burned or deleted. Never handed out again. */
  retired() { const r = this._get('phoneRetired', []); return Array.isArray(r) ? r : []; }

  /** Every number already in use or retired, as keys. */
  takenNumbers() {
    const out = new Set(Object.keys(this.lines()));
    for (const r of this.retired()) if (r?.key) out.add(r.key);
    for (const c of game.nightcity?.masterContactService?.getAll?.() || []) if (c.phone) out.add(normaliseNumber(c.phone, this.homeCode));
    return out;
  }

  /** Is this number free (for `ownerKey` = the actor/contact asking, its own number counts as free)? */
  isFree(number, owner = {}) {
    const normal = normaliseNumber(number, this.homeCode);
    if (!normal) return false;
    if (this.retired().some((r) => r?.key === normal)) return false;
    const existing = this.lines()[normal];
    if (existing) return (owner.contactId && existing.owner?.contactId === owner.contactId) || (!owner.contactId && owner.actorId && existing.owner?.actorId === owner.actorId && !existing.owner?.contactId);
    const contact = (game.nightcity?.masterContactService?.getAll?.() || []).find((c) => c.phone && normaliseNumber(c.phone, this.homeCode) === normal);
    return !contact || contact.id === owner.contactId;
  }

  /** The rows this client may take a number from. */
  pickRows() { return pickableRows(this.numberContext.rows, this.rules, { gm: isGM() }); }

  /** Where a picker starts and a blank "Give a number" lands: a district in the home city, else the first row there is. */
  startRow() {
    const rows = this.pickRows(), h = this.numberContext.home;
    const here = rows.filter((r) => r['Region code'] === h.rc && r['City code'] === h.city);
    return here.find((r) => r.Code && r.Category === 'District') || here[0] || rows[0] || null;
  }

  /** Free numbers on a row (default: the start row), never one taken or retired. */
  suggestNumbers({ row = null, count = 4, seed, near = null } = {}) {
    const r = row || this.startRow();
    if (!r) return [];
    return freeLines(r, { taken: this.takenNumbers(), count, seed: seed ?? Date.now(), near }).map((line) => ({ number: numberAt(r, line), line }));
  }

  /**
   * Give a character (or a directory contact / an alias of a character) a number. GM writes; a player relays.
   * The old number of the same owner is released.
   * @param {{actorId?: string, contactId?: string, number: string}} o
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  async assignNumber({ actorId = null, contactId = null, number, why = '' }) {
    const ctx = this.homeCode, parsed = parseNumber(number, ctx);
    if (!parsed.done || parsed.service) return { ok: false, error: parsed.hint || 'Type a whole number.' };
    if (!rowOf(parsed, ctx)) return { ok: false, error: 'That place is not in the table.' };
    const shown = fullForm(parsed);
    if (this.retired().some((r) => r?.key === parsed.key)) return { ok: false, error: 'That number is retired. Pick another.' };
    if (!this.isFree(shown, { actorId, contactId })) return { ok: false, error: 'That number already belongs to someone.' };
    if (!isGM()) return this._relayLine({ op: 'assign', actorId, contactId, number: shown, why: 'They picked this themselves in the Calls tab.' });
    return this._assignAsGm({ actorId, contactId, number: shown, why });
  }

  // ─── line settings: the greeting + the voicemail switches of ONE number (utils/voicemail.js) ───

  /** A number's settings (a new number: the default greeting, takes messages). */
  lineSettings(number) {
    return sanitizeLineSettings(this.line(number)?.settings);
  }

  /** Save a number's settings. The GM writes; a player relays (only for a line of a character they own). */
  async saveLineSettings(number, settings) {
    const normal = normaliseNumber(number, this.homeCode);
    if (!normal || !this.lines()[normal]) return { ok: false, error: 'That number has no owner.' };
    if (!isGM()) return this._relayLine({ op: 'settings', number, settings });
    const lines = this.lines();
    lines[normal] = { ...lines[normal], settings: sanitizeLineSettings(settings) };
    await game.settings.set(MODULE_ID, 'phoneLines', lines);
    this.eventBus.emit(EVENTS.LINE_UPDATED, { number: normal });
    return { ok: true };
  }

  /** Release a number (it becomes not in service). */
  async releaseNumber(number) {
    if (!isGM()) return this._relayLine({ op: 'release', number });
    const lines = this.lines(); const normal = normaliseNumber(number, this.homeCode);
    const l = lines[normal];
    if (!l) return { ok: true };
    delete lines[normal];
    await this._retire([{ key: normal, line: l, why: 'Released' }]);
    await game.settings.set(MODULE_ID, 'phoneLines', lines);
    await this._mirror(l.owner, '');
    this.eventBus.emit(EVENTS.LINE_UPDATED, { number: normal });
    return { ok: true };
  }

  async _assignAsGm({ actorId, contactId, number, why = '' }) {
    const lines = this.lines();
    const normal = normaliseNumber(number, this.homeCode);
    // the owner's previous line goes, and it retires: numbers are never reused
    const gone = [];
    for (const [k, l] of Object.entries(lines)) {
      const own = !['extra', 'burner'].includes(l.kind);
      const same = own && (contactId ? l.owner?.contactId === contactId : (l.owner?.actorId === actorId && !l.owner?.contactId));
      if (same && k !== normal) { gone.push({ key: k, line: l, why: 'Changed' }); delete lines[k]; }
    }
    if (gone.length) await this._retire(gone);
    const owner = this._ownerRecord({ actorId, contactId });
    if (!owner) return { ok: false, error: 'Nobody to give it to.' };
    lines[normal] = { ...(lines[normal] || {}), number, owner, kind: contactId ? 'alias' : 'main', ...(why ? { why } : {}) };
    await game.settings.set(MODULE_ID, 'phoneLines', lines);
    await this._mirror(owner, number);
    this.eventBus.emit(EVENTS.LINE_UPDATED, { number: normal });
    return { ok: true, number };
  }

  /** Add numbers to the retired list (GM). */
  async _retire(items) {
    const at = game.nightcity?.timeService?.getCurrentTime?.() || new Date().toISOString();
    const add = items.map(({ key, line, why }) => ({ key, number: line?.number || '', was: line?.owner?.name || '', why, at }));
    await game.settings.set(MODULE_ID, 'phoneRetired', [...this.retired().filter((r) => !add.some((x) => x.key === r?.key)), ...add]);
  }

  /** Who owns a line, as stored in phoneLines (the GM computes the player users once, at write time). */
  _ownerRecord({ actorId, contactId }) {
    const mcs = game.nightcity?.masterContactService;
    const contact = contactId ? mcs?.getContact?.(contactId) : null;
    const aid = actorId || contact?.actorId || null;
    const actor = aid ? game.actors?.get(aid) : null;
    if (!actor && !contact) return null;
    const player = !!actor?.hasPlayerOwner;
    const userIds = player ? game.users.filter((u) => !u.isGM && actor.testUserPermission(u, 'OWNER')).map((u) => u.id) : [];
    return { actorId: aid, contactId: contact?.id || null, name: contact?.name || actor?.name || '', kind: player ? 'player' : 'npc', userIds };
  }

  /** Keep the actor flag / contact field in step with the directory. */
  async _mirror(owner, number) {
    try {
      if (owner?.contactId) await game.nightcity?.masterContactService?.updateContact?.(owner.contactId, { phone: number });
      else if (owner?.actorId) {
        const actor = game.actors?.get(owner.actorId);
        if (actor) number ? await actor.setFlag(MODULE_ID, 'phone', number) : await actor.unsetFlag(MODULE_ID, 'phone');
      }
    } catch (err) { log.warn(`Calls: could not mirror the number: ${err.message}`); }
  }

  /** Extra lines this character may still add. A GM's are not limited. */
  extraLeft(actorId) {
    if (isGM()) return Infinity;
    const used = this.linesFor(actorId).filter((l) => l.kind === 'extra' || l.kind === 'burner').length;
    return Math.max(0, this.rules.extraLines - used);
  }

  /**
   * Add a second number to a character: one they keep, or a burner. GM writes; a player relays, inside the GM's limit.
   * @param {{actorId: string, number: string, kind?: 'extra'|'burner', label?: string}} o
   */
  async addLine({ actorId = null, contactId = null, number, kind = 'extra', label = '', why = '' }) {
    const ctx = this.homeCode, parsed = parseNumber(number, ctx);
    if (!parsed.done || parsed.service || !rowOf(parsed, ctx)) return { ok: false, error: parsed.hint || 'Type a whole number.' };
    if (!this.isFree(fullForm(parsed))) return { ok: false, error: 'That number is taken or retired. Pick another.' };
    if (!isGM() && this.extraLeft(actorId) < 1) return { ok: false, error: 'You have used your extra lines. Your GM can give you more.' };
    const clean = { actorId, contactId: isGM() ? contactId : null, number: fullForm(parsed), kind: kind === 'burner' ? 'burner' : 'extra', label: String(label || '').trim().slice(0, 24), why: isGM() ? why : 'They added this line themselves.' };
    if (!isGM()) return this._relayLine({ op: 'addLine', ...clean });
    return this._addLineAsGm(clean);
  }

  async _addLineAsGm({ actorId, contactId = null, number, kind, label, why = '' }) {
    const owner = this._ownerRecord({ actorId, contactId });
    if (!owner) return { ok: false, error: 'Nobody to give it to.' };
    const normal = normaliseNumber(number, this.homeCode);
    if (!this.isFree(number)) return { ok: false, error: 'That number is taken or retired. Pick another.' };
    const lines = this.lines();
    lines[normal] = { number, owner, kind, label, ...(why ? { why } : {}) };
    await game.settings.set(MODULE_ID, 'phoneLines', lines);
    this.eventBus.emit(EVENTS.LINE_UPDATED, { number: normal });
    return { ok: true, number };
  }

  /** Stop using an extra line or burner. The number retires for good. A main line changes instead, so it can't be retired here. */
  async retireLine(number) {
    if (!isGM()) return this._relayLine({ op: 'retire', number });
    const lines = this.lines(), normal = normaliseNumber(number, this.homeCode), l = lines[normal];
    if (!l) return { ok: true };
    if (!['extra', 'burner', 'shared'].includes(l.kind)) return { ok: false, error: 'A main line can be changed, not retired.' };
    delete lines[normal];
    await this._retire([{ key: normal, line: l, why: l.kind === 'burner' ? 'Burned' : 'Retired' }]);
    await game.settings.set(MODULE_ID, 'phoneLines', lines);
    this.eventBus.emit(EVENTS.LINE_UPDATED, { number: normal });
    return { ok: true };
  }

  /** Requests for a different number, waiting on the GM. */
  requests() { const r = this._get('phoneRequests', []); return Array.isArray(r) ? r : []; }
  /** What this character has asked for, if anything. */
  pendingFor(actorId) { return this.requests().find((r) => r.actorId === actorId) || null; }

  /** Ask for a different number. The old one stays until the GM answers. */
  async requestChange({ actorId, number }) {
    const parsed = parseNumber(number, this.homeCode);
    if (!parsed.done || parsed.service) return { ok: false, error: parsed.hint || 'Type a whole number.' };
    if (!this.isFree(fullForm(parsed), { actorId })) return { ok: false, error: 'That number is taken or retired. Pick another.' };
    if (!isGM()) return this._relayLine({ op: 'request', actorId, number: fullForm(parsed) });
    return this._requestAsGm({ actorId, number: fullForm(parsed) });
  }

  async _requestAsGm({ actorId, number }) {
    const id = (foundry.utils.randomID?.() || Math.random().toString(36).slice(2, 12));
    const rest = this.requests().filter((r) => r.actorId !== actorId);
    await game.settings.set(MODULE_ID, 'phoneRequests', [...rest, { id, actorId, kind: 'change', to: number, at: game.nightcity?.timeService?.getCurrentTime?.() || new Date().toISOString() }]);
    this.eventBus.emit(EVENTS.LINE_UPDATED, { number: null });
    return { ok: true, id };
  }

  /** Ask for one more line than the GM's limit allows. */
  async requestLine({ actorId, number, kind = 'extra', label = '' }) {
    const parsed = parseNumber(number, this.homeCode);
    if (!parsed.done || parsed.service) return { ok: false, error: parsed.hint || 'Type a whole number.' };
    if (!this.isFree(fullForm(parsed))) return { ok: false, error: 'That number is taken or retired. Pick another.' };
    const clean = { actorId, number: fullForm(parsed), lineKind: kind === 'burner' ? 'burner' : 'extra', label: String(label || '').trim().slice(0, 24) };
    if (!isGM()) return this._relayLine({ op: 'requestLine', ...clean });
    return this._requestLineAsGm(clean);
  }

  async _requestLineAsGm({ actorId, number, lineKind, label }) {
    const id = (foundry.utils.randomID?.() || Math.random().toString(36).slice(2, 12));
    await game.settings.set(MODULE_ID, 'phoneRequests', [...this.requests(), { id, actorId, kind: 'line', lineKind, label, to: number, at: game.nightcity?.timeService?.getCurrentTime?.() || new Date().toISOString() }]);
    this.eventBus.emit(EVENTS.LINE_UPDATED, { number: null });
    return { ok: true, id };
  }

  /** Withdraw a request. A player only withdraws their own. */
  async cancelRequest(actorId) {
    if (!isGM()) return this._relayLine({ op: 'unrequest', actorId });
    await game.settings.set(MODULE_ID, 'phoneRequests', this.requests().filter((r) => r.actorId !== actorId));
    this.eventBus.emit(EVENTS.LINE_UPDATED, { number: null });
    return { ok: true };
  }

  /** GM: approve (the old number retires) or deny a request. */
  async answerRequest(id, approve) {
    if (!isGM()) return { ok: false, error: 'GM only' };
    const req = this.requests().find((r) => r.id === id);
    if (!req) return { ok: true };
    const res = !approve ? { ok: true }
      : req.kind === 'line' ? await this.addLine({ actorId: req.actorId, number: req.to, kind: req.lineKind, label: req.label, why: 'They asked for this and you approved it.' })
      : await this.assignNumber({ actorId: req.actorId, number: req.to, why: 'They asked for this and you approved it.' });
    if (!res.ok) return res;
    await game.settings.set(MODULE_ID, 'phoneRequests', this.requests().filter((r) => r.id !== id));
    this.eventBus.emit(EVENTS.LINE_UPDATED, { number: null });
    if (!approve) this._tellOwners(req.actorId, `Your GM said no to ${req.to}. You keep what you have.`);
    return res;
  }

  // ─── GM tools: switching a line off, the retired list, the setup settings, undo ───

  /** Switch a line off (a lost phone, an unpaid bill) or back on. Same number. Callers hear not in service meanwhile. */
  async setLineOff(number, off) {
    if (!isGM()) return { ok: false, error: 'GM only' };
    const lines = this.lines(), normal = normaliseNumber(number, this.homeCode), l = lines[normal];
    if (!l) return { ok: false, error: 'That number has no owner.' };
    lines[normal] = { ...l, off: !!off };
    await game.settings.set(MODULE_ID, 'phoneLines', lines);
    this.eventBus.emit(EVENTS.LINE_UPDATED, { number: normal });
    if (l.owner?.actorId) this._tellOwners(l.owner.actorId, off ? `${l.number} has been switched off. Callers hear not in service.` : `${l.number} is back in service.`);
    return { ok: true };
  }

  /** A character or contact is gone: their lines retire with them. Lines of an alias survive the character only if the alias does. */
  async retireOwner({ actorId = null, contactId = null, why = 'Contact deleted' }) {
    if (!isGM() || game.users.activeGM?.id !== game.user.id) return;
    const lines = this.lines(), gone = [];
    let membersChanged = false;
    for (const [k, l] of Object.entries(lines)) {
      if (l.members) {
        const left = l.members.filter((m) => !(contactId ? m.contactId === contactId : m.actorId === actorId));
        if (left.length !== l.members.length) { lines[k] = { ...l, members: left, owner: this._sharedOwner(l.label, left) }; membersChanged = true; }
        continue;
      }
      const hit = contactId ? l.owner?.contactId === contactId : (l.owner?.actorId === actorId && !l.owner?.contactId);
      if (hit) { gone.push({ key: k, line: l, why }); delete lines[k]; }
    }
    if (!gone.length && !membersChanged) return;
    if (gone.length) await this._retire(gone);
    await game.settings.set(MODULE_ID, 'phoneLines', lines);
    await game.settings.set(MODULE_ID, 'phoneRequests', this.requests().filter((r) => r.actorId !== actorId || !actorId));
    this.eventBus.emit(EVENTS.LINE_UPDATED, { number: null });
  }

  /** The line types in play. */
  get lineTypes() { return lineTypes(this._get('phoneLineTypes', {})); }
  /** An office's settings by its table row. */
  office(row) { return sanitizeOffice((this._get('phoneOffices', {}) || {})[officeKey(row)]); }
  /** Set a line's type and its own name. */
  async setLineType(number, { type = null, label = null } = {}) {
    if (!isGM()) return { ok: false, error: 'GM only' };
    const lines = this.lines(), normal = normaliseNumber(number, this.homeCode), l = lines[normal];
    if (!l) return { ok: false, error: 'That number has no owner.' };
    lines[normal] = { ...l, ...(type !== null ? { type } : {}), ...(label !== null ? { label: String(label).slice(0, 24) } : {}) };
    await game.settings.set(MODULE_ID, 'phoneLines', lines);
    this.eventBus.emit(EVENTS.LINE_UPDATED, { number: normal });
    return { ok: true };
  }

  /** How a caller reads on the other end: what the line's type shows. Only called for a real line. */
  _dressCaller(from) {
    const ctx = this.numberContext, p = parseNumber(from.number, ctx);
    if (!p.done || p.service) return from;
    const line = this.lines()[p.key], row = rowOf(p, ctx), type = lineTypeFor(line, row, this.lineTypes);
    const contact = from.contactId ? game.nightcity?.masterContactService?.getContact?.(from.contactId) : null;
    const office = row?.Category === 'Corporate' ? this.office(row) : null;
    const shown = lineShown(type, { name: from.name, img: from.img, org: contact?.organization || row?.District || '', orgArt: office?.art || '', label: line?.label || '', place: row?.District || row?.City || '' });
    const { anon, ...rest } = shown;
    return { ...from, ...rest, realName: from.name, anon: from.anon || anon, asLine: from.asLine || rest.asLine, typeId: type.id };
  }

  // ─── shared lines: one number, several people (§7) ───

  /** Who rings on a shared line: player users, and whether a GM answers for an NPC on it. */
  _sharedOwner(name, members) {
    const userIds = new Set(); let npc = false;
    for (const m of members) {
      const c = m.contactId ? game.nightcity?.masterContactService?.getContact?.(m.contactId) : null;
      const actor = game.actors?.get(m.actorId || c?.actorId);
      if (actor?.hasPlayerOwner) for (const u of game.users.filter((x) => !x.isGM && actor.testUserPermission(x, 'OWNER'))) userIds.add(u.id);
      else npc = true;
    }
    return { actorId: null, contactId: null, name, kind: userIds.size ? 'player' : 'npc', userIds: [...userIds], gmMember: npc };
  }

  /** Make a shared line. Nobody owns it; everyone on it answers, calls out and hears its voicemail. */
  async createSharedLine({ name, number, members = [], why = 'You made this a shared line.' }) {
    if (!isGM()) return { ok: false, error: 'GM only' };
    const parsed = parseNumber(number, this.homeCode);
    if (!parsed.done || parsed.service || !rowOf(parsed, this.homeCode)) return { ok: false, error: parsed.hint || 'Type a whole number.' };
    if (!this.isFree(fullForm(parsed))) return { ok: false, error: 'That number is taken or retired. Pick another.' };
    const lines = this.lines();
    const label = String(name || '').trim().slice(0, 40) || 'Shared line';
    lines[parsed.key] = { number: fullForm(parsed), kind: 'shared', label, why, members, owner: this._sharedOwner(label, members) };
    await game.settings.set(MODULE_ID, 'phoneLines', lines);
    this.eventBus.emit(EVENTS.LINE_UPDATED, { number: parsed.key });
    return { ok: true, number: fullForm(parsed) };
  }

  /** Change who is on a shared line. The number stays with the others. */
  async setSharedMembers(number, members) {
    if (!isGM()) return { ok: false, error: 'GM only' };
    const lines = this.lines(), normal = normaliseNumber(number, this.homeCode), l = lines[normal];
    if (!l?.members) return { ok: false, error: 'That is not a shared line.' };
    lines[normal] = { ...l, members, owner: this._sharedOwner(l.label, members) };
    await game.settings.set(MODULE_ID, 'phoneLines', lines);
    this.eventBus.emit(EVENTS.LINE_UPDATED, { number: normal });
    return { ok: true };
  }

  /** A new number for everyone on a shared line. The old one retires. */
  async changeSharedNumber(oldNumber, number) {
    if (!isGM()) return { ok: false, error: 'GM only' };
    const old = normaliseNumber(oldNumber, this.homeCode), parsed = parseNumber(number, this.homeCode);
    const lines = this.lines(), l = lines[old];
    if (!l?.members) return { ok: false, error: 'That is not a shared line.' };
    if (!parsed.done || parsed.service || !rowOf(parsed, this.homeCode)) return { ok: false, error: parsed.hint || 'Type a whole number.' };
    if (!this.isFree(fullForm(parsed))) return { ok: false, error: 'That number is taken or retired. Pick another.' };
    delete lines[old];
    lines[parsed.key] = { ...l, number: fullForm(parsed) };
    await this._retire([{ key: old, line: l, why: 'Changed' }]);
    await game.settings.set(MODULE_ID, 'phoneLines', lines);
    this.eventBus.emit(EVENTS.LINE_UPDATED, { number: parsed.key });
    return { ok: true, number: fullForm(parsed) };
  }

  /** Everyone whose inbox holds a line's log and voicemail. Empty for an ordinary line. */
  _sharedInboxes(number) {
    return (this.line(number)?.members || []).map((m) => m.actorId || m.contactId).filter(Boolean);
  }

  // ─── calls the GM wrote by hand (§9) ───

  /** The calls written into a character's or contact's log. */
  writtenLog(ownerId) { const all = this._get('phoneWrittenLogs', {}) || {}; return Array.isArray(all[ownerId]) ? all[ownerId] : []; }

  /** Replace them. */
  async saveWrittenLog(ownerId, list) {
    if (!isGM()) return { ok: false, error: 'GM only' };
    await game.settings.set(MODULE_ID, 'phoneWrittenLogs', { ...(this._get('phoneWrittenLogs', {}) || {}), [ownerId]: list });
    this.eventBus.emit(EVENTS.LINE_UPDATED, { number: null });
    return { ok: true };
  }

  // ─── a terminal's number (§9): dialling it never logs anyone in ───

  /** The line a terminal holds. */
  lineOfItem(uuid) { return Object.values(this.lines()).find((l) => l.kind === 'terminal' && l.itemUuid === uuid) || null; }

  /** Give a terminal a number, or change what a caller hears. A number it drops retires. */
  async setTerminalNumber(item, { number = undefined, when, text } = {}) {
    if (!isGM()) return { ok: false, error: 'GM only' };
    const lines = this.lines(), cur = this.lineOfItem(item.uuid), curKey = cur ? normaliseNumber(cur.number, this.homeCode) : null;
    if (number === null) {
      if (!cur) return { ok: true };
      delete lines[curKey];
      await this._retire([{ key: curKey, line: cur, why: 'Retired' }]);
    } else if (number !== undefined) {
      const p = parseNumber(number, this.homeCode);
      if (!p.done || p.service || !rowOf(p, this.homeCode)) return { ok: false, error: p.hint || 'Type a whole number.' };
      if (!this.isFree(fullForm(p))) return { ok: false, error: 'That number is taken or retired. Pick another.' };
      if (cur) { delete lines[curKey]; await this._retire([{ key: curKey, line: cur, why: 'Changed' }]); }
      lines[p.key] = { kind: 'terminal', itemUuid: item.uuid, label: item.name, when: cur?.when || 'modem', text: cur?.text || '', owner: { actorId: null, contactId: null, name: item.name, kind: 'npc', userIds: [] }, number: fullForm(p) };
    } else if (cur) {
      lines[curKey] = { ...cur, ...(when ? { when } : {}), ...(text !== undefined ? { text: String(text).slice(0, 300) } : {}) };
    }
    await game.settings.set(MODULE_ID, 'phoneLines', lines);
    this.eventBus.emit(EVENTS.LINE_UPDATED, { number: null });
    return { ok: true };
  }

  /** Trauma Team and Backup setup. */
  async _saveEmergency(cfg) {
    if (!isGM()) return { ok: false, error: 'GM only' };
    await game.settings.set(MODULE_ID, 'phoneEmergency', cfg);
    this.eventBus.emit(EVENTS.LINE_UPDATED, { number: null });
    return { ok: true };
  }

  /** Let a retired number be handed out again. */
  async releaseRetired(number) {
    if (!isGM()) return { ok: false, error: 'GM only' };
    const key = normaliseNumber(number, this.homeCode);
    await game.settings.set(MODULE_ID, 'phoneRetired', this.retired().filter((r) => r?.key !== key));
    this.eventBus.emit(EVENTS.LINE_UPDATED, { number: null });
    return { ok: true };
  }

  /** Write any number setting from the GM's setup screens. */
  async saveNumberSetting(key, value) {
    if (!isGM()) return { ok: false, error: 'GM only' };
    if (!['phoneRules', 'phonePlaces', 'phoneSpecial', 'phoneOrgNames'].includes(key)) return { ok: false, error: 'Not a number setting.' };
    await game.settings.set(MODULE_ID, key, value);
    this.eventBus.emit(EVENTS.LINE_UPDATED, { number: null });
    return { ok: true };
  }

  /** Which characters have each number saved: number key → character ids. Read once per render. */
  savedNumbers() {
    const out = new Map();
    for (const a of game.actors?.contents || []) {
      if (!a.hasPlayerOwner) continue;
      const list = a.getFlag?.(MODULE_ID, 'contacts');
      if (!Array.isArray(list)) continue;
      for (const c of list) { const k = normaliseNumber(this.numberForContact(c), this.homeCode); if (k) { if (!out.has(k)) out.set(k, []); if (!out.get(k).includes(a.id)) out.get(k).push(a.id); } }
    }
    return out;
  }

  /**
   * Hand a number to characters. A contact they already hold for that person gets the number; otherwise a new contact
   * with only the number and the name. Taking it away from someone no longer in the list clears the number, not the contact.
   */
  async shareNumber({ number, name = '', ownerContactId = null, ownerActorId = null, actorIds = [] }) {
    if (!isGM()) return { ok: false, error: 'GM only' };
    const normal = normaliseNumber(number, this.homeCode);
    if (!normal) return { ok: false, error: 'Not a whole number.' };
    const mcs = game.nightcity?.masterContactService, master = ownerContactId ? mcs?.getContact?.(ownerContactId) : null;
    const isTheirs = (c) => (ownerContactId && c.masterContactId === ownerContactId) || (ownerActorId && c.actorId === ownerActorId) || (c.phone && normaliseNumber(c.phone, this.homeCode) === normal);
    for (const a of game.actors?.contents || []) {
      if (!a.hasPlayerOwner || a.id === ownerActorId) continue;
      const list = a.getFlag(MODULE_ID, 'contacts');
      const cur = Array.isArray(list) ? list : [];
      const wants = actorIds.includes(a.id);
      const has = cur.find(isTheirs);
      if (wants && has) {
        if (normaliseNumber(has.phone, this.homeCode) !== normal) await this._patchContacts(a, (now) => { const h = now.find(isTheirs); return h && normaliseNumber(h.phone, this.homeCode) !== normal ? now.map((c) => (c === h ? { ...c, phone: number } : c)) : null; });
      }
      else if (wants) {
        const label = name || game.actors.get(ownerActorId)?.name || number;
        const res = await game.nightcity?.contactRepository?.addContact?.(a.id, { name: label, email: '', phone: number, customImg: master?.portrait || '', masterContactId: ownerContactId || '', tags: [] });
        if (res && !res.success) return { ok: false, error: res.error || 'Could not add the contact.' };
      } else if (has && normaliseNumber(has.phone, this.homeCode) === normal) {
        await this._patchContacts(a, (now) => { const h = now.find(isTheirs); return h && normaliseNumber(h.phone, this.homeCode) === normal ? now.map((c) => (c === h ? { ...c, phone: '' } : c)) : null; });
      }
    }
    return { ok: true };
  }

  /** A player hands out one of their own lines. A second line stays anonymous. */
  async shareMine({ actorId, number, actorIds = [] }) {
    const l = this.line(number);
    if (!l || l.owner?.actorId !== actorId) return { ok: false, error: 'That is not your line.' };
    if (!isGM()) return this._relayLine({ op: 'shareMine', actorId, number, actorIds });
    const second = ['extra', 'burner'].includes(l.kind), alias = !!l.owner?.contactId;
    const holders = this.savedNumbers().get(normaliseNumber(number, this.homeCode)) || [];
    return this.shareNumber({ number: l.number, name: second ? (l.label || l.number) : l.owner.name, ownerContactId: alias ? l.owner.contactId : null, ownerActorId: second || alias ? null : actorId, actorIds: [...new Set([...holders, ...actorIds])] });
  }

  /** Point the saved contacts of these characters at a new number, and tell them. */
  async pushNewNumber(oldNumber, newNumber, actorIds = []) {
    if (!isGM()) return;
    const old = normaliseNumber(oldNumber, this.homeCode);
    for (const id of actorIds) {
      const a = game.actors?.get(id), list = a?.getFlag?.(MODULE_ID, 'contacts');
      if (!Array.isArray(list)) continue;
      await this._patchContacts(a, (now) => now.map((c) => (c.phone && normaliseNumber(c.phone, this.homeCode) === old ? { ...c, phone: newNumber } : c)));
      this._tellOwners(id, `${oldNumber} changed to ${newNumber}. Your contact is updated.`);
    }
  }

  /**
   * Change a character's contact list in the same queue as every other contacts write (audit B4 leftover): the list is
   * read fresh INSIDE the queue, so a contact added a moment earlier is not written over. `fn(list)` returns the new
   * list, or null for "no change". Never call a contacts writer from inside `fn` (it would wait on itself).
   */
  _patchContacts(actor, fn) {
    return serialize(`contacts:${actor.id}`, async () => {
      const cur = actor.getFlag(MODULE_ID, 'contacts');
      const next = fn(Array.isArray(cur) ? cur : []);
      if (next) await actor.setFlag(MODULE_ID, 'contacts', next);
    });
  }

  /** A short note to the players of a character. Never throws. */
  _tellOwners(actorId, text) {
    try {
      const actor = game.actors?.get(actorId);
      const ids = (game.users?.contents || []).filter((u) => !u.isGM && actor?.testUserPermission?.(u, 'OWNER')).map((u) => u.id);
      if (ids.length) ChatMessage.create({ content: whisperCardHtml({ tone: 'info', icon: 'fa-sim-card', title: 'Phone', lines: [text] }), whisper: ids });
    } catch (err) { log.warn(`Calls: could not tell the player: ${err.message}`); }
  }

  /** Everything the number screens can change, for an honest undo. */
  phoneSnapshot() {
    return Object.fromEntries(['phoneLines', 'phoneRetired', 'phoneRequests', 'phonePlaces', 'phoneRules', 'phoneSpecial', 'phoneOrgNames', 'phoneLineTypes', 'phoneOffices', 'phoneWrittenLogs', 'phoneEmergency'].map((k) => [k, foundry.utils.deepClone ? foundry.utils.deepClone(this._get(k, null)) : JSON.parse(JSON.stringify(this._get(k, null)))]));
  }

  /** Put a snapshot back, unless the world moved on after `after` was taken. */
  async restorePhoneSnapshot(snap, after) {
    if (!isGM()) return { ok: false, error: 'GM only' };
    if (after && JSON.stringify(this.phoneSnapshot()) !== JSON.stringify(after)) return { ok: false, error: 'Something else changed since, so this can no longer be undone.' };
    const was = this.lines();
    for (const [k, v] of Object.entries(snap)) if (v !== null) await game.settings.set(MODULE_ID, k, v);
    // saved flags and contact fields follow the lines
    const now = this.lines();
    for (const key of new Set([...Object.keys(was), ...Object.keys(now)])) {
      if (was[key]?.number === now[key]?.number) continue;
      const o = (now[key] || was[key]).owner;
      if (['extra', 'burner'].includes((now[key] || was[key]).kind)) continue;
      await this._mirror(o, o?.contactId ? this.numberOfContactLine(o.contactId) : this.numberOf(o?.actorId));
    }
    this.eventBus.emit(EVENTS.LINE_UPDATED, { number: null });
    return { ok: true };
  }

  /** A contact's own line in phoneLines, ignoring the contact's stored field. */
  numberOfContactLine(contactId) {
    const all = Object.values(this.lines()).filter((l) => l.owner?.contactId === contactId && !['extra', 'burner'].includes(l.kind));
    return all[0]?.number || '';
  }

  /** A player's line edit goes to the active GM. */
  _relayLine(payload) {
    if (!game.users.activeGM) return { ok: false, error: 'No GM is online to register the number.' };
    this.socket.emit(SOCKET_OPS.CALL_LINE_REQUEST, payload);
    return { ok: true, relayed: true };
  }

  /** GM side of CALL_LINE_REQUEST. */
  async handleLineRequest(data, senderId) {
    if (!isGM() || game.users.activeGM?.id !== game.user.id) return;
    const sender = game.users.get(senderId);
    // a player may only change numbers of characters they own (or those characters' aliases)
    const contact = data.contactId ? game.nightcity?.masterContactService?.getContact?.(data.contactId) : null;
    const actor = game.actors?.get(data.actorId || contact?.actorId);
    if (data.op === 'assign' && !(actor && actor.testUserPermission(sender, 'OWNER'))) return;
    const ownsActor = (id) => !!game.actors?.get(id)?.testUserPermission(sender, 'OWNER');
    if (data.op === 'addLine') {
      if (!ownsActor(data.actorId)) return;
      const used = this.linesFor(data.actorId).filter((l) => l.kind === 'extra' || l.kind === 'burner').length;
      if (used >= this.rules.extraLines) return;
      await this._addLineAsGm(data);
      return;
    }
    if (data.op === 'request') { if (ownsActor(data.actorId)) await this._requestAsGm(data); return; }
    if (data.op === 'requestLine') { if (ownsActor(data.actorId)) await this._requestLineAsGm(data); return; }
    if (data.op === 'shareMine') { if (ownsActor(data.actorId)) await this.shareMine(data); return; }
    if (data.op === 'unrequest') { if (ownsActor(data.actorId)) await this.cancelRequest(data.actorId); return; }
    if (data.op === 'retire') {
      const l = this.line(data.number);
      if (l?.owner?.actorId && ownsActor(l.owner.actorId)) await this.retireLine(data.number);
      return;
    }
    if (data.op === 'assign') {
      // a player changing their own number under "needs the GM's OK" can't skip the question
      const had = this.numberOf(data.actorId);
      if (had && !data.contactId && this.rules.changeNeedsGm) { await this._requestAsGm(data); return; }
      await this._assignAsGm(data);
    }
    else if (data.op === 'settings') {
      const l = this.line(data.number);
      const owned = l?.owner?.actorId && game.actors?.get(l.owner.actorId)?.testUserPermission(sender, 'OWNER');
      if (owned) await this.saveLineSettings(data.number, data.settings);
    } else if (data.op === 'release') {
      const l = this.line(data.number);
      const owned = l?.owner?.actorId && game.actors?.get(l.owner.actorId)?.testUserPermission(sender, 'OWNER');
      if (owned) await this.releaseNumber(data.number);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  World adapter for callModel.resolveCallee
  // ═══════════════════════════════════════════════════════════

  _world() {
    const lines = this.lines();
    const actors = [];
    for (const l of Object.values(lines)) {
      if (l.owner?.actorId && !l.owner.contactId) actors.push({ id: l.owner.actorId, name: l.owner.name, phone: l.number, playerOwned: l.owner.kind === 'player', userIds: l.owner.userIds || [] });
    }
    // characters with no line of their own still count for "is this burner a player's"
    for (const l of Object.values(lines)) {
      if (l.owner?.contactId && l.owner.actorId && !actors.some((a) => a.id === l.owner.actorId)) actors.push({ id: l.owner.actorId, name: '', phone: '', playerOwned: l.owner.kind === 'player', userIds: l.owner.userIds || [] });
    }
    const contacts = [];
    const seen = new Set();
    for (const l of Object.values(lines)) if (l.owner?.contactId) { contacts.push({ id: l.owner.contactId, name: l.owner.name, phone: l.number, actorId: l.owner.actorId }); seen.add(l.owner.contactId); }
    for (const c of game.nightcity?.masterContactService?.getAll?.() || []) {
      if (c.phone && !seen.has(c.id)) contacts.push({ id: c.id, name: c.name, phone: c.phone, actorId: c.actorId || null, sendOnly: !!c.sendOnly });
    }
    return { homeCode: this.homeCode, actors, contacts };
  }

  /** Who a typed number reaches. */
  resolve(number) { return resolveCallee(number, this._world()); }

  // ═══════════════════════════════════════════════════════════
  //  Who I am on a call
  // ═══════════════════════════════════════════════════════════

  /**
   * The identity a call is placed from. Players: the operator character, or one of its burners (`as.contactId`).
   * GM: an NPC — `as.contactId` / `as.actorId`.
   */
  _caller(as = {}) {
    // a special number has no NPC behind it: the GM speaks for it
    if (as.special && isGM()) {
      const x = specialList(this._get('phoneSpecial', null)).find((y) => y.id === as.special);
      if (!x) return null;
      return { userId: game.user.id, actorId: null, contactId: null, name: x.show === 'name' ? (x.name || x.num) : '', number: x.num, img: x.show === 'name' ? x.img : '', anon: x.show !== 'name', asLine: true, special: true };
    }
    // a payphone: the PLACE calls; who is really on it stays with the GMs (and this client)
    if (as.payphone) {
      const pp = game.nightcity?.payphoneService?.get?.(as.payphone);
      if (!pp?.number) return null;
      const actor = as.actorId ? game.actors?.get(as.actorId) : resolveOperator();
      return { userId: game.user.id, actorId: null, contactId: null, name: placeLabel(pp), number: pp.number, img: '', asLine: true, wired: true,
        payphone: pp.id, realActorId: actor?.id || null, realName: actor?.name || game.user.name, realUserId: game.user.id };
    }
    if (as.contactId) {
      const c = game.nightcity?.masterContactService?.getContact?.(as.contactId);
      if (!c) return null;
      return { userId: game.user.id, actorId: c.actorId || null, contactId: c.id, name: c.name, number: this.numberOfContact(c.id), img: resolveDisplayPortrait({ contactId: c.id }) };
    }
    const actor = as.actorId ? game.actors?.get(as.actorId) : resolveOperator();
    if (!actor) return null;
    // a second line: whoever you call sees that number, not who is behind it
    const second = as.line ? this.lines()[as.line] : null;
    if (second?.members?.some((m) => m.actorId === actor.id)) return { userId: game.user.id, actorId: actor.id, contactId: null, name: second.label || second.number, number: second.number, img: '', asLine: true };
    if (second?.owner?.actorId === actor.id && ['extra', 'burner'].includes(second.kind)) return { userId: game.user.id, actorId: actor.id, contactId: null, name: second.label || second.number, number: second.number, img: '', asLine: true };
    return { userId: game.user.id, actorId: actor.id, contactId: null, name: actor.name, number: this.numberOf(actor.id), img: resolveDisplayPortrait({ actorId: actor.id }) };
  }

  /** The network a call rides from this client, with its colour and signal. */
  _net() {
    const ns = game.nightcity?.networkService;
    const n = ns?.currentNetwork;
    if (!n) return null;
    return { id: n.id, name: n.name, type: n.type, strength: ns.signalStrength ?? n.signalStrength ?? 75, color: n.theme?.color || '' };
  }

  _noSignal() {
    const ns = game.nightcity?.networkService;
    if (!ns) return false;
    return !!(ns.isDeadZone || ns.isNodeDead || !ns.currentNetworkId);
  }

  // ═══════════════════════════════════════════════════════════
  //  Calls
  // ═══════════════════════════════════════════════════════════

  /** Calls this client is on (not just watching), newest first. */
  myCalls() {
    return [...this.calls.values()].filter((c) => this._role(c) !== 'watch').sort((a, b) => b.startedAt - a.startedAt);
  }

  /** Every call this client knows about that has not ended (a GM sees every call in the world). */
  allCalls() {
    return [...this.calls.values()].filter((c) => c.state !== 'ended').sort((a, b) => b.startedAt - a.startedAt);
  }

  /** caller | callee | watch (a GM seeing someone else's call). */
  _role(call) {
    if (call.from?.userId === game.user.id) return 'caller';
    if (call.answeredBy === game.user.id) return 'callee';
    if (call.state === 'ringing' && this._ringsHere(call)) return 'callee';
    return 'watch';
  }

  /** Would this ring reach this client? */
  _ringsHere(call) {
    const to = call.to || {};
    if (to.kind === 'payphone') return !game.user.isGM && game.user.viewedScene === to.sceneId;
    if (to.shared) return game.user.isGM ? (!!to.gmMember && game.users.activeGM?.id === game.user.id) : (to.userIds || []).includes(game.user.id);
    if (to.kind === 'player') {
      if (game.user.isGM) return false;
      const actor = game.actors?.get(to.actorId);
      return !!actor?.isOwner;
    }
    // an NPC line (or an unowned number sent to the GM): the active GM answers
    return game.user.isGM && game.users.activeGM?.id === game.user.id;
  }

  /** Everyone an event about this call must reach: both sides and every GM (for the switchboard). */
  _audience(call) {
    const ids = new Set(game.users.filter((u) => u.isGM && u.active).map((u) => u.id));
    if (call.from?.userId) ids.add(call.from.userId);
    for (const id of call.to?.userIds || []) ids.add(id);
    if (call.answeredBy) ids.add(call.answeredBy);
    ids.delete(game.user.id);
    return [...ids];
  }

  _send(type, call, extra = {}) {
    const { lines, ...lite } = call;   // each client keeps its own transcript; lines travel one at a time ('line')
    const ids = this._audience(call);
    // A payphone: each booth side is shown for real only to the GMs and the person on THAT booth; everyone else sees
    // the place. Judged per side (audit PRIV-02): the person who answered a booth's call is not the booth caller, so
    // they get the masked caller like everyone else. (Module messages reach every client; this is what each SHOWS.)
    if (call.from?.payphone || call.to?.kind === 'payphone') {
      for (const g of payphoneSendGroups(call, ids, (id) => !!game.users.get(id)?.isGM)) {
        const shown = { ...lite, from: g.maskFrom ? maskPayphoneSide(call.from) : call.from, to: g.maskTo ? maskPayphoneSide(call.to) : call.to };
        this.socket.emit(SOCKET_OPS.CALL, { type, callId: call.id, call: shown, userIds: g.userIds, ...extra });
      }
      return;
    }
    if (!call.from?.anon || call.traced) { this.socket.emit(SOCKET_OPS.CALL, { type, callId: call.id, call: lite, userIds: ids, ...extra }); return; }
    // a withheld number: the real caller goes to the GMs (and the caller's own client); everyone else gets the mask
    const open = ids.filter((id) => game.users.get(id)?.isGM || id === call.from.userId);
    const masked = ids.filter((id) => !open.includes(id));
    if (open.length) this.socket.emit(SOCKET_OPS.CALL, { type, callId: call.id, call: lite, userIds: open, ...extra });
    if (masked.length) this.socket.emit(SOCKET_OPS.CALL, { type, callId: call.id, call: { ...lite, from: maskCaller(call.from) }, userIds: masked, ...extra });
  }

  // ═══════════════════════════════════════════════════════════
  //  Typed lines (phase 2)
  // ═══════════════════════════════════════════════════════════

  /** This client's mode on a call (Out loud by default per the GM's setting). */
  modeFor(callId) {
    const m = this._myMode.get(callId);
    return m && this.usableModes.includes(m) ? m : this.startMode;
  }

  /** Switch this client's own mode on a call (the other side keeps theirs). */
  setMode(callId, mode) {
    const call = this.calls.get(callId);
    if (!call || !this.usableModes.includes(mode)) return;
    this._myMode.set(callId, mode);
    this.eventBus.emit(EVENTS.CALL_STARTED, { call, role: this._role(call) });
  }

  /** Send a line on a live call this client is on — typed, or dictated (`via: 'dictate'`). */
  sendLine(callId, text, { via } = {}) {
    const call = this.calls.get(callId);
    if (!call || call.state !== 'live') return null;
    const side = sideOf(call, game.user.id);
    const line = makeLine({ side, text, via });
    if (!line) return null;
    this._store(addLine(call, line));
    this._send('line', call, { line });
    this._typingSent.delete(callId);
    this.eventBus.emit(EVENTS.CALL_LINE, { callId, line, mine: true });
    return line;
  }

  /** Tell the other side this client is typing (throttled: at most every 2 s while typing; once when it stops). */
  sendTyping(callId, on, how = 'type') {
    const call = this.calls.get(callId);
    if (!call || call.state !== 'live') return;
    const side = sideOf(call, game.user.id);
    if (!side) return;
    const last = this._typingSent.get(callId) || 0;
    if (on && Date.now() - last < 2000) return;
    if (!on && !last) return;
    if (on) this._typingSent.set(callId, Date.now()); else this._typingSent.delete(callId);
    this._send('typing', call, { side, on: !!on, how: how === 'talk' ? 'talk' : 'type' });
  }

  /**
   * Place a call.
   * @param {string} number — as dialled
   * @param {{actorId?: string, contactId?: string}} [as] — who is calling (default: the operator character)
   * @returns {Promise<{ok: boolean, call?: object, error?: string}>}
   */
  async placeCall(number, as = {}) {
    let from = this._caller(as);
    if (!from) return { ok: false, error: 'Pick a character first.' };
    if (from.payphone) { const keep = { name: from.name, realName: from.realName, img: '' }; from = { ...this._dressCaller(from), ...keep, anon: false, asLine: true, showOnly: 'name' }; }
    else if (!from.special) from = this._dressCaller(from);
    // a withheld number: the callee never learns who it is (only the GM holds it) until a trace
    if (as.anon && isGM()) from.anon = true;
    if (this.myCalls().some((c) => c.state === 'ringing' && this._role(c) === 'caller')) return { ok: false, error: 'You are already calling someone.' };
    const { number: dialledNumber, ext } = splitExtension(number);
    number = dialledNumber;
    const callee = this.resolve(number);
    const special = this.numberContext.service[specialKey(number)];
    // a payphone: nobody owns it; it rings everyone on its scene, and only someone standing at it can pick up
    const ppLine = this.line(number);
    if (ppLine?.kind === 'payphone') {
      const booth = game.nightcity?.payphoneService?.get?.(ppLine.payphoneId);
      if (!booth) callee.lineOff = true;
      else Object.assign(callee, { kind: 'payphone', actorId: null, contactId: null, name: placeLabel(booth), payphoneId: booth.id, sceneId: booth.sceneId,
        userIds: game.users.filter((u) => !u.isGM && u.active && u.id !== game.user.id).map((u) => u.id), outOfOrder: booth.condition === 'out' });
    }
    // Trauma Team: someone with a plan starts the real call; someone with none is refused, or rings the GM, as the GM set it
    const selfId = from.actorId || from.realActorId;
    if (selfId && !isGM() && game.nightcity?.emergencyService && specialKey(number) === game.nightcity.emergencyService.traumaLine().key) {
      const em = game.nightcity.emergencyService, actor = game.actors?.get(selfId);
      if (em.planFor(actor) !== 'none') {
        if (em.planInUse(selfId)) return { ok: false, error: 'Your plan is in use. Your GM clears it when the job is over.' };
        game.nightcity.emergencyHud?.trauma(actor);
        return { ok: true, emergency: true };
      }
      if (em.config.trauma.noPlan === 'refuse') return this._dialSpecial(number, sanitizeSpecial({ ...special, act: 'recording', text: 'This number is for subscribers.' }), 'recording', from);
    }
    const dialled = special ? specialOutcome(special, from.actorId) : null;
    if (dialled?.alert) this._alertSpecial(special, from);
    if (dialled && dialled.outcome !== 'ring') return this._dialSpecial(number, special, dialled.outcome, from);
    // a line switched off answers like a number nobody has
    if (this.line(number)?.off) callee.lineOff = true;
    // a machine answers its own number, and a caller only ever hears it
    const machine = this.line(number);
    if (machine?.kind === 'terminal') {
      const said = machine.when === 'modem' ? 'Connected, then a screech of modem tone. Then nothing.' : machine.when === 'recording' ? machine.text : machine.when === 'vm' ? 'Leave a message after the tone.' : '';
      return this._dialSpecial(number, sanitizeSpecial({ num: machine.number, show: 'none', act: said ? 'recording' : 'dead', text: said }), said ? 'recording' : 'missed', from);
    }
    // a shared line: nobody owns it, and it rings everyone on it
    const sharedLine = this.line(number);
    if (sharedLine?.members) { if (!sharedLine.members.length) callee.lineOff = true; Object.assign(callee, { kind: sharedLine.owner.kind, actorId: null, contactId: null, name: sharedLine.label, userIds: sharedLine.owner.userIds || [], shared: true, gmMember: !!sharedLine.owner.gmMember }); }
    // a corporate main number: the switchboard, then an extension if one was dialled
    const officeRow = callee.kind === 'unowned' && !callee.special ? officeRowOf(parseNumber(number, this.homeCode), this.numberContext) : null;
    if (officeRow) {
      const o = this.office(officeRow), hit = ext ? o.exts.find((e) => e.x === ext) : null;
      if (ext && !hit) return { ok: false, error: 'No such extension.' };
      if (hit?.contactId && this.numberOfContact(hit.contactId)) return this.placeCall(this.numberOfContact(hit.contactId), as);
      callee.special = true; callee.name = hit ? hit.who : officeRow.District;
      // voicemail takes a real message; keeping one needs a GM's client, so with none online it plays as a recording
      if (!hit && o.answers === 'vm' && game.users?.activeGM) { callee.kind = 'npc'; callee.office = officeKey(officeRow); callee.greet = o.greet; callee.goVm = true; if (o.mailbox) callee.contactId = o.mailbox; }
      else if (!hit && o.answers !== 'gm') return this._dialSpecial(number, sanitizeSpecial({ num: displayNumber(number, this.homeCode), name: officeRow.District, img: o.art, act: o.answers === 'recording' ? 'recording' : 'voicemail', text: o.greet }), o.answers === 'recording' ? 'recording' : 'voicemail', from);
    }
    // an NPC caller (GM) is wherever the NPC is — the GM's own connection does not matter
    const verdict = canCall({ enabled: this.enabled, fromNumber: from.number, callee, noSignal: !isGM() && !from.wired && this._noSignal(), homeCode: this.homeCode, unknownNumbers: this._get('callUnknownNumbers', 'not-in-service') });
    const to = { kind: verdict.toGm && callee.kind === 'unowned' ? 'unowned' : callee.kind, actorId: callee.actorId || null, contactId: callee.contactId || null,
      number: displayNumber(number, this.homeCode), name: callee.name || '', userIds: callee.userIds || [], ...(callee.shared ? { shared: true, gmMember: callee.gmMember } : {}), ...(callee.office ? { office: callee.office, greet: callee.greet || '' } : {}), ...(callee.kind === 'payphone' ? { payphoneId: callee.payphoneId, sceneId: callee.sceneId } : {}),
      img: callee.contactId || callee.actorId ? resolveDisplayPortrait({ contactId: callee.contactId, actorId: callee.actorId }) : '' };
    // a payphone is wired: no network, no signal to lose, nothing for a node tap to hear
    const net = from.wired ? { id: '', name: 'Payphone line', type: 'wired', strength: 100, color: '' } : this._net();
    if (!verdict.ok) {
      if (!verdict.outcome) return { ok: false, error: verdict.reason };
      const ended = createEndedCall({ from, to, net }, verdict.outcome);
      this._store(ended);
      this.eventBus.emit(EVENTS.CALL_ENDED, { call: ended, role: 'caller' });
      this._sound(verdict.outcome === 'no-signal' ? 'call-drop' : 'call-end');
      this._log(ended);
      return { ok: true, call: ended };
    }
    // nobody there to pick up: the player is offline, or no GM for an NPC line
    const reachable = to.kind === 'payphone'
      ? (!callee.outOfOrder && game.users.some((u) => !u.isGM && u.active && u.id !== game.user.id && u.viewedScene === to.sceneId))
      : (to.kind === 'player' && (to.userIds || []).some((id) => game.users.get(id)?.active)) || ((to.kind !== 'player' || to.gmMember) && !!game.users.activeGM);
    const call = createCall({ from, to, net, mode: this.startMode });
    call.state = 'dialing';
    this._store(call);
    if (!isGM()) this._myNet.set(call.id, net?.id || '');
    // do not disturb: no ring at all — straight to their voicemail (or no answer when they take no messages)
    if (callee.goVm || (this.lineSettings(to.number).voicemail.dnd && ['player', 'npc'].includes(to.kind))) {
      if (!this._toVoicemail(call.id, 'dnd')) this._endLocal(call.id, 'missed', { notify: false });
      return { ok: true, call: this.calls.get(call.id) };
    }
    this.eventBus.emit(EVENTS.CALL_RINGING, { call, role: 'caller' });
    if (!reachable) {
      setTimeout(() => { if (!this._toVoicemail(call.id, 'offline')) this._endLocal(call.id, 'missed', { notify: false }); }, 4 * RING_BEAT_MS);
      this._startRingback(call.id); return { ok: true, call };
    }
    this._send('ring', call);
    this._startRingback(call.id);
    this._timers.set(call.id, setTimeout(() => this.cancel(call.id, 'timeout'), this.ringMs));
    return { ok: true, call };
  }

  /** The GM is told someone dialled a special number. */
  _alertSpecial(x, from) {
    const text = `${from.name} dialled ${x.num}.`;
    if (isGM()) { ncmNotify.info(text); return; }
    try { ChatMessage.create({ content: whisperCardHtml({ tone: 'warn', icon: 'fa-bell', title: 'Special number', lines: [text] }), whisper: game.users.filter((u) => u.isGM).map((u) => u.id) }); } catch (err) { log.warn(err.message); }
  }

  /** A special number that does not ring: say what happened and end the call. It works with no GM online. */
  _dialSpecial(number, x, outcome, from) {
    const shows = x.show === 'name';
    const to = { kind: 'unowned', actorId: null, contactId: null, number: x.num, name: shows ? x.name : '', userIds: [], img: shows ? x.img : '' };
    const net = this._net();
    if (outcome === 'macro') { try { game.macros?.get?.(x.macro)?.execute?.(); } catch (err) { log.warn(`Calls: special number macro: ${err.message}`); } }
    if (outcome === 'recording' && x.text) ncmNotify.info(`${shows && x.name ? x.name : x.num}: ${x.text}`);
    const ended = createEndedCall({ from, to, net }, outcome === 'nis' ? 'not-in-service' : outcome === 'missed' ? 'missed' : 'answered');
    this._store(ended);
    this.eventBus.emit(EVENTS.CALL_ENDED, { call: ended, role: 'caller' });
    this._sound('call-end');
    this._log(ended);
    return { ok: true, call: ended };
  }

  /** Answer a ringing call (optionally as an NPC identity — GM). */
  answer(callId, as = null) {
    const call = this.calls.get(callId);
    if (!call || call.state !== 'ringing') return;
    // call waiting: answering a second call holds the live one
    for (const other of this.myCalls()) if (other.id !== callId && other.state === 'live') this.hold(other.id);
    const answered = transition(call, { type: 'answer', by: game.user.id });
    if (as) answered.to = { ...answered.to, ...as };
    // a payphone: who picked up stays with the GMs; everyone else it rang still hears the answer (their ring stops)
    let rang = null;
    if (answered.to?.kind === 'payphone') {
      const op = resolveOperator();
      rang = answered.to.userIds || [];
      answered.to = { ...answered.to, userIds: [game.user.id], realActorId: op?.id || null, realName: op?.name || game.user.name, realUserId: game.user.id };
    }
    if (!isGM()) this._myNet.set(callId, answered.to?.kind === 'payphone' ? '' : (this._net()?.id || ''));
    this._store(answered);
    this._stopRing(callId);
    this._send('answer', rang ? { ...answered, to: { ...answered.to, userIds: [...new Set([...rang, game.user.id])] } } : answered);
    this._sound('call-connect');
    this.eventBus.emit(EVENTS.CALL_STARTED, { call: answered, role: 'callee' });
  }

  /** Decline. With ringOut the caller just hears it ring out, no voicemail. */
  decline(callId, { ringOut = false } = {}) {
    const call = this.calls.get(callId);
    if (!call || call.state !== 'ringing') return;
    this._send(ringOut ? 'ringOut' : 'decline', call);
    this._endLocal(callId, 'declined', { notify: false });
  }

  /**
   * GM: hold a call in the queue. The caller sees On hold and their ring clock stops, so they don't drop to voicemail.
   * @param {string} callId @param {boolean} on
   */
  queueHold(callId, on = true) {
    const call = this.calls.get(callId);
    if (!isGM() || !call || call.state !== 'ringing') return;
    const next = { ...call, queueHold: !!on };
    this._store(next);
    clearTimeout(this._timers.get(callId)); this._timers.delete(callId);
    if (!on) this._timers.set(callId, setTimeout(() => { if (this.calls.get(callId)?.state === 'ringing') this._endLocal(callId, 'missed', { notify: false }); }, this.ringMs + 5000));
    this._send('queueHold', next, { on: !!on });
    this.eventBus.emit(EVENTS.CALL_RINGING, { call: next, role: 'watch' });
  }

  /** GM: the call stays up and someone else speaks. The caller's screen follows, and they are told to wait a moment. */
  passTo(callId, as) {
    const call = this.calls.get(callId);
    if (!isGM() || !call || !['live', 'held'].includes(call.state)) return;
    const next = { ...call, to: { ...call.to, ...as } };
    this._store(next);
    this._send('pass', next);
    this.eventBus.emit(EVENTS.CALL_STARTED, { call: next, role: this._role(next) });
  }

  /** What the caller sees when the GM speaks as this directory contact. */
  answerAs(contact) {
    if (!contact) return null;
    return { name: contact.name, contactId: contact.id, actorId: contact.actorId || null, img: resolveDisplayPortrait({ contactId: contact.id }) || '', showOnly: 'name', org: contact.organization || '' };
  }

  /** The caller hangs up before an answer (or the ring timed out). */
  cancel(callId, why = 'cancel') {
    const call = this.calls.get(callId);
    if (!call) return;
    if (call.state === 'ringing' || call.state === 'dialing') {
      this._send('ringCancel', call, { why });
      // nobody picked up: their voicemail, when the line takes messages
      if (why === 'timeout' && this._toVoicemail(callId, 'missed')) return;
      this._endLocal(callId, 'missed', { notify: false });
    } else this.hangup(callId);
  }

  hangup(callId) {
    const call = this.calls.get(callId);
    if (!call) return;
    if (call.state === 'voicemail') return this._endLocal(callId, 'missed', { notify: false });
    if (call.state === 'ringing' || call.state === 'dialing') return this._role(call) === 'caller' ? this.cancel(callId) : this.decline(callId);
    this._send('hangup', call);
    this._endLocal(callId, 'answered', { notify: false });
  }

  hold(callId) {
    const call = this.calls.get(callId);
    if (!call || call.state !== 'live') return;
    const held = transition(call, { type: 'hold' });
    this._store(held); this._send('hold', held);
    this.eventBus.emit(EVENTS.CALL_STARTED, { call: held, role: this._role(held) });
  }

  resume(callId) {
    const call = this.calls.get(callId);
    if (!call || call.state !== 'held') return;
    for (const other of this.myCalls()) if (other.id !== callId && other.state === 'live') this.hold(other.id);
    const live = transition(call, { type: 'resume' });
    this._store(live); this._send('resume', live);
    this.eventBus.emit(EVENTS.CALL_STARTED, { call: live, role: this._role(live) });
  }

  /** GM: cut a call off (it ends as "Call dropped" on both sides). */
  drop(callId, reason = 'The signal broke up') {
    const call = this.calls.get(callId);
    if (!call || !isGM()) return;
    this._send('drop', call, { reason, byGm: true });
    this._endLocal(callId, 'dropped', { notify: false, reason });
  }

  /** GM: the line stutters for a few seconds on both ends (the subtitles scramble, the signal reads unstable). */
  glitch(callId) {
    const call = this.calls.get(callId);
    if (!call || !isGM() || !['live', 'held'].includes(call.state)) return;
    this._send('glitch', call);
    this.eventBus.emit(EVENTS.CALL_GLITCH, { callId });
  }

  /**
   * A user left the game (audit DATA-17). Every client runs this for itself — nobody sends it — and ends each call
   * that user was a party to as "dropped": the caller, the one who answered, or (still ringing) the only one it was
   * ringing. Before this a call outlived a closed tab: the HUD and the GM's switchboard held it forever.
   * @param {string} userId
   * @returns {number} how many calls ended
   */
  onUserGone(userId) {
    if (!userId || userId === game.user?.id) return 0;
    let ended = 0;
    for (const call of [...this.calls.values()]) {
      if (call.state === 'ended') continue;
      const ringOnlyThem = call.state === 'ringing' && !call.answeredBy && Array.isArray(call.to?.userIds) && call.to.userIds.includes(userId)
        && !call.to.userIds.some((id) => id !== userId && game.users?.get(id)?.active);
      const party = call.from?.userId === userId || call.answeredBy === userId || ringOnlyThem;
      if (!party) continue;
      const who = game.users?.get(userId)?.name;
      this._endLocal(call.id, 'dropped', { notify: false, reason: who ? `${who} disconnected` : 'The other end disconnected' });
      ended += 1;
    }
    return ended;
  }

  /** End a call on this client. `notify` false = the other side already knows. */
  _endLocal(callId, outcome, { notify = true, reason = '' } = {}) {
    const call = this.calls.get(callId);
    if (!call || call.state === 'ended') return;
    const role = this._role(call);
    const ev = { answered: 'hangup', missed: 'cancel', declined: 'decline', busy: 'busy', dropped: 'drop' }[outcome] || 'hangup';
    let ended = transition(call, { type: ev });
    if (ended === call) ended = { ...call, state: 'ended', endedAt: Date.now(), outcome };
    if (reason) ended = { ...ended, dropReason: reason };
    this._store(ended);
    this._stopRing(callId);
    clearTimeout(this._timers.get(callId)); this._timers.delete(callId);
    if (notify) this._send(ev, ended);
    if (role !== 'watch') this._sound(outcome === 'dropped' ? 'call-drop' : 'call-end');
    this.eventBus.emit(EVENTS.CALL_ENDED, { call: ended, role });
    if (outcome === 'missed' && role === 'callee') this.eventBus.emit(EVENTS.CALL_MISSED, { call: ended });
    if (role === 'caller') this._log(ended);
    setTimeout(() => { if (this.calls.get(callId)?.state === 'ended') { this.calls.delete(callId); this._myMode.delete(callId); this._typingSent.delete(callId); this._myNet.delete(callId); } }, 8000);
  }

  _store(call) { this.calls.set(call.id, call); }

  // ─── socket ───

  /** SOCKET_OPS.CALL handler (every client). */
  handleSocket(data, senderId) {
    const { type, callId, call } = data || {};
    if (!type || !callId) return;
    // the socket reaches every client: an event addressed to others is not ours (a withheld caller must never land here)
    if (Array.isArray(data.userIds) && !data.userIds.includes(game.user.id)) return;
    if (type === 'voicemail') {
      if (data.vm) this.eventBus.emit(EVENTS.VOICEMAIL_LEFT, { vm: data.vm });
      return;
    }
    if (type === 'audioFailed') { ncmNotify.warn('NCM | Your recording could not be saved by the GM (the world may not accept uploads).'); return; }
    const mine = this.calls.get(callId);
    if (type === 'ring') {
      if (!call || mine) return;
      const here = this._ringsHere(call);
      const watching = game.user.isGM;
      if (!here && !watching) return;
      const ringing = { ...call, state: 'ringing' };
      // no signal here: it never rings — the caller hears why (and may reach voicemail)
      if (here && !game.user.isGM && call.to?.kind !== 'payphone' && this._noSignal()) { this._send('noSignal', ringing); return; }
      this._store(ringing);
      if (!here) { this.eventBus.emit(EVENTS.CALL_RINGING, { call: ringing, role: 'watch' }); return; }
      const busy = this.myCalls().some((c) => c.id !== callId && (c.state === 'live' || c.state === 'held'));
      this.eventBus.emit(EVENTS.CALL_RINGING, { call: ringing, role: 'callee', waiting: busy });
      this._startRing(callId, busy);
      // a ring that is never answered or cancelled (the caller vanished) clears itself
      this._timers.set(callId, setTimeout(() => { if (this.calls.get(callId)?.state === 'ringing') this._endLocal(callId, 'missed', { notify: false }); }, this.ringMs + 5000));
      return;
    }
    if (type === 'glitch') { if (mine) this.eventBus.emit(EVENTS.CALL_GLITCH, { callId }); return; }
    if (type === 'traceRequest') { if (this.mayTraceCall(callId, senderId)) this._revealTo(callId, senderId).catch(() => {}); else log.warn('Calls: trace refused — only the callee may trace a withheld caller'); return; }
    if (type === 'reveal') {
      if (mine && data.from) { const next = { ...mine, from: { ...data.from }, traced: true }; this._store(next); this.eventBus.emit(EVENTS.CALL_STARTED, { call: next, role: this._role(next) }); }
      this.eventBus.emit(EVENTS.CALL_TRACED, { callId, from: data.from || null });
      return;
    }
    if (type === 'noSignal') {
      if (mine && this._role(mine) === 'caller') { this._stopRing(callId); if (!this._toVoicemail(callId, 'offline')) this._endLocal(callId, 'no-signal', { notify: false, reason: 'They have no signal' }); }
      return;
    }
    if (type === 'line' || type === 'typing') {
      if (!mine) return;
      if (type === 'line') {
        const line = data.line;
        if (!line?.id || !line.text) return;
        if (!lineFromRightSide(mine, line, senderId, !!game.users.get(senderId)?.isGM)) { log.warn('Calls: a line from someone not on that side of the call was ignored'); return; }
        this._store(addLine(mine, line));
        this.eventBus.emit(EVENTS.CALL_LINE, { callId, line, mine: false });
      } else this.eventBus.emit(EVENTS.CALL_TYPING, { callId, side: data.side, on: !!data.on, how: data.how === 'talk' ? 'talk' : 'type' });
      return;
    }
    if (!mine) {
      // a GM watching may have missed the ring (they loaded mid-call): adopt the call as sent
      if (game.user.isGM && call) this._store({ ...call });
      else return;
    }
    const cur = this.calls.get(callId);
    switch (type) {
      case 'answer': {
        // a payphone picked up twice at once: the first pick-up the caller saw wins. The caller tells the loser and
        // confirms the winner to the GMs; anyone else keeps the first pick-up it saw until the caller confirms.
        const by = call?.answeredBy ?? senderId;
        // a GM remembers each pick-up of a booth as it arrived (only a GM is told who really picked up)
        if (game.user.isGM && cur.to?.kind === 'payphone' && call?.to && !data.confirmed) (this._ppAnswers ??= new Map()).set(`${callId}:${by}`, call.to);
        if (cur.to?.kind === 'payphone' && data.confirmed) {
          const to = this._ppAnswers?.get(`${callId}:${by}`) || cur.to;
          const next = { ...cur, state: 'live', answeredBy: by, to };
          this._store(next);
          this.eventBus.emit(EVENTS.CALL_STARTED, { call: next, role: this._role(next) });
          break;
        }
        if (cur.state === 'live' && cur.answeredBy && cur.to?.kind === 'payphone' && by !== cur.answeredBy) {
          if (this._role(cur) === 'caller') {
            this.socket.emit(SOCKET_OPS.CALL, { type: 'taken', callId, userIds: [senderId] });
            this.socket.emit(SOCKET_OPS.CALL, { type: 'answer', callId, call: { answeredBy: cur.answeredBy }, confirmed: true, userIds: game.users.filter((u) => u.isGM && u.active && u.id !== game.user.id).map((u) => u.id) });
            break;
          }
          break;
        }
        const next = { ...cur, ...call, from: cur.from || call?.from, state: 'live', answeredAt: call?.answeredAt ?? Date.now(), answeredBy: call?.answeredBy ?? senderId };
        this._stopRing(callId); clearTimeout(this._timers.get(callId)); this._timers.delete(callId);
        const wasRingingHere = cur.state === 'ringing' && this._ringsHere(cur);
        this._store(next);
        const role = this._role(next);
        if (role === 'caller') {
          this._sound('call-connect');
          this.eventBus.emit(EVENTS.CALL_STARTED, { call: next, role });
        } else if (wasRingingHere && !game.user.isGM) {
          // another of this character's players picked up: the ring here just goes away
          if (cur.to?.shared || cur.to?.kind === 'payphone') ncmNotify.info(`${cur.to.name}: picked up by ${game.users.get(next.answeredBy)?.character?.name || game.users.get(next.answeredBy)?.name || 'someone else'}.`);
          this.calls.delete(callId);
          this.eventBus.emit(EVENTS.CALL_ENDED, { call: { ...next, state: 'ended', outcome: 'answered' }, role: 'watch', quiet: true });
        } else {
          // a GM: another GM answered (the ring stops) or someone else's call went live (the switchboard updates)
          this.eventBus.emit(EVENTS.CALL_STARTED, { call: next, role });
        }
        break;
      }
      case 'ringOut': this._endLocal(callId, 'missed', { notify: false }); break;
      case 'taken': ncmNotify.info('Someone else picked up first.'); this._endLocal(callId, 'answered', { notify: false }); break;
      case 'queueHold': {
        const next = { ...cur, queueHold: !!data.on };
        this._store(next);
        clearTimeout(this._timers.get(callId)); this._timers.delete(callId);
        // the ring clock starts again from the top when they come off hold
        if (!data.on && this._role(next) === 'caller') this._timers.set(callId, setTimeout(() => this.cancel(callId, 'timeout'), this.ringMs));
        this.eventBus.emit(EVENTS.CALL_RINGING, { call: next, role: this._role(next) });
        break;
      }
      case 'pass': {
        const next = { ...cur, to: { ...(call?.to || cur.to) } };
        this._store(next);
        if (this._role(next) === 'caller') ncmNotify.info('One moment.');
        this.eventBus.emit(EVENTS.CALL_STARTED, { call: next, role: this._role(next) });
        break;
      }
      case 'decline': if (!this._toVoicemail(callId, 'declined')) this._endLocal(callId, 'declined', { notify: false }); break;
      case 'busy': if (!this._toVoicemail(callId, 'busy')) this._endLocal(callId, 'busy', { notify: false }); break;
      case 'ringCancel': this._endLocal(callId, 'missed', { notify: false }); break;
      case 'cancel': this._endLocal(callId, 'missed', { notify: false }); break;
      case 'hangup': this._endLocal(callId, 'answered', { notify: false }); break;
      case 'drop': this._endLocal(callId, 'dropped', { notify: false, reason: data.reason ? (data.byGm ? data.reason : `Their end: ${data.reason}`) : '' }); break;
      case 'hold': case 'resume': {
        const next = { ...cur, ...call, from: cur.from || call?.from, remoteHeld: type === 'hold' };
        this._store(next);
        this.eventBus.emit(EVENTS.CALL_STARTED, { call: next, role: this._role(next) });
        break;
      }
      default: break;
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Voicemail (phase 3a — greetings, typed and read-out messages)
  // ═══════════════════════════════════════════════════════════

  /**
   * The caller's side of an unanswered call: their greeting, the tone, a message. Only for a real line that takes
   * messages (utils/voicemail.js goesToVoicemail). Returns false when the call should just end.
   * @param {string} callId
   * @param {'missed'|'declined'|'busy'|'dnd'|'offline'} why
   */
  _toVoicemail(callId, why) {
    const call = this.calls.get(callId);
    if (!call || call.state === 'ended' || call.state === 'voicemail' || this._role(call) !== 'caller') return false;
    const settings = this.line(call.to?.number)?.settings;
    if (!goesToVoicemail({ toKind: call.to?.kind, settings, why })) return false;
    this._stopRing(callId);
    clearTimeout(this._timers.get(callId));
    const greeting = call.to?.office && call.to.greet ? { ...greetingFor(settings), kind: 'typed', text: call.to.greet } : greetingFor(settings);
    const vm = { ...call, state: 'voicemail', vmStep: 'greet', vmWhy: why, greeting };
    this._store(vm);
    this.eventBus.emit(EVENTS.CALL_STARTED, { call: vm, role: 'caller' });
    this._timers.set(callId, setTimeout(() => this._vmTone(callId), greetMs(vm.greeting.text, { duration: vm.greeting.kind === 'recorded' ? vm.greeting.duration : 0 })));
    return true;
  }

  /** The greeting is over: the tone, and the message box opens. */
  _vmTone(callId) {
    const c = this.calls.get(callId);
    if (!c || c.state !== 'voicemail' || c.vmStep !== 'greet') return;
    const next = { ...c, vmStep: 'leave', vmToneAt: Date.now() };
    this._store(next);
    this._sound('voicemail-beep');
    this.eventBus.emit(EVENTS.CALL_STARTED, { call: next, role: 'caller' });
    this._timers.set(callId, setTimeout(() => { if (this.calls.get(callId)?.state === 'voicemail') this._endLocal(callId, 'missed', { notify: false }); }, VOICEMAIL_OPEN_MS));
  }

  /** Skip the rest of the greeting (Enter / the key on the HUD). */
  skipGreeting(callId) { this._vmTone(callId); }

  /**
   * Leave the message and end the call. The GM writes it into the line owner's inbox; a player hands it to the GM.
   * @param {string} callId
   * @param {string} text
   * @param {{kind?: 'typed'|'tts'}} [o] — tts: read out by the browser's voice when played (the GM, as an NPC)
   */
  async leaveVoicemail(callId, text, { kind = 'typed', audio = null } = {}) {
    const call = this.calls.get(callId);
    if (!call || call.state !== 'voicemail' || call.vmStep !== 'leave') return { ok: false, error: 'There is no message box open.' };
    const voice = kind === 'tts' ? this.lineSettings(call.from?.number).greeting.voice : '';
    const gameTime = game.nightcity?.timeService?.getCurrentTime?.() || new Date().toISOString();
    // a recording: the GM's client saves the file, then writes the voicemail around it
    if (kind === 'audio') {
      if (!this.recordingOn) return { ok: false, error: 'The GM has switched recorded voicemail off.' };
      if (!audio?.base64) return { ok: false, error: 'Record a message first.' };
      const meta = { purpose: 'vm', vm: { callId, from: call.from, to: call.to, text: String(text || ''), kind: 'audio', gameTime, duration: (audio.ms || 0) / 1000, at: Date.now() } };
      const r = await this._sendAudio(audio.base64, audio.mime, meta);
      if (!r.ok) return r;
      this._endLocal(callId, 'voicemail', { notify: false });
      return { ok: true };
    }
    const vm = makeVoicemail({ callId, from: call.from, to: call.to, text, kind, voice, gameTime });
    if (!vm) return { ok: false, error: 'Type a message first.' };
    if (isGM() && game.users.activeGM?.id === game.user.id) await this.writeVoicemail(vm);
    else if (game.users.activeGM) this.socket.emit(SOCKET_OPS.CALL_VM_REQUEST, { op: 'leave', vm });
    else return { ok: false, error: 'No GM is online to keep the message — try again when they are.' };
    this._endLocal(callId, 'voicemail', { notify: false });
    return { ok: true, vm };
  }

  /** GM: write a voicemail page into the line owner's inbox and tell the owner's players (and every GM). */
  async writeVoicemail(vm) {
    if (!isGM()) return null;
    const shared = this._sharedInboxes(vm?.to?.number);
    const officeBox = vm?.to?.office && !voicemailOwner(vm.to) ? await this._officeMailbox(vm.to.office, vm.to.name) : null;
    if (officeBox) vm = { ...vm, to: { ...vm.to, contactId: officeBox } };
    const boxes = shared.length ? shared : [voicemailOwner(vm?.to)].filter(Boolean);
    const journals = (await Promise.all(boxes.map((o) => game.nightcity?.messageRepository?.getInboxJournal?.(o)))).filter(Boolean);
    if (!journals.length) { log.warn('Calls: a voicemail had no inbox to land in.'); return null; }
    try {
      for (const journal of journals) await journal.createEmbeddedDocuments('JournalEntryPage', [{
        name: `[VOICEMAIL] from ${vm.from?.name || vm.from?.number || 'unknown'}`, type: 'text', text: { content: '' },
        flags: { [MODULE_ID]: { voicemail: { ...vm, heard: false } } },
      }]);
    } catch (err) { log.warn(`Calls: could not write a voicemail: ${err.message}`); return null; }
    const actor = vm.to?.actorId ? game.actors?.get(vm.to.actorId) : null;
    const owners = shared.length ? (this.line(vm.to.number)?.owner?.userIds || []) : actor ? game.users.filter((u) => !u.isGM && actor.testUserPermission(u, 'OWNER')).map((u) => u.id) : [];
    const gms = game.users.filter((u) => u.isGM && u.active && u.id !== game.user.id).map((u) => u.id);
    this.socket.emit(SOCKET_OPS.CALL, { type: 'voicemail', callId: vm.vmId, vm, userIds: [...owners, ...gms] });
    this.eventBus.emit(EVENTS.VOICEMAIL_LEFT, { vm });
    return vm;
  }

  /**
   * The directory contact an office's messages land with: the one the GM picked, else one made for it the first time
   * someone leaves a message. It is send-only, so players can't add it or write to it.
   * @param {string} key - officeKey @param {string} name @returns {Promise<string|null>} contact id
   */
  async _officeMailbox(key, name = 'Office') {
    const mcs = game.nightcity?.masterContactService;
    const all = { ...(this._get('phoneOffices', {}) || {}) };
    const o = sanitizeOffice(all[key]);
    if (o.mailbox && mcs?.getContact?.(o.mailbox)) return o.mailbox;
    const made = await mcs?.addContact?.({ name: `${name} switchboard`, email: `switchboard-${String(key).replace(/[^a-z0-9]+/gi, '-').toLowerCase()}@local`, type: 'npc', sendOnly: true, notes: `Holds voicemail left for ${name}. Made automatically.` });
    if (!made?.success || !made.contact?.id) { log.warn(`Calls: could not make a mailbox for ${name}: ${made?.error || 'unknown'}`); return null; }
    all[key] = { ...o, mailbox: made.contact.id };
    await game.settings.set(MODULE_ID, 'phoneOffices', all);
    return made.contact.id;
  }

  /** A line owner's voicemails, newest first (`ownerId` = the actor or the directory identity). */
  async getVoicemails(ownerId) {
    const journal = ownerId ? await game.nightcity?.messageRepository?.getInboxJournal?.(ownerId) : null;
    if (!journal) return [];
    return journal.pages.contents.map((p) => ({ pageId: p.id, journalId: journal.id, ownerId, ...(p.flags?.[MODULE_ID]?.voicemail || {}) }))
      .filter((v) => v.vmId).sort((a, b) => (b.at || 0) - (a.at || 0));
  }

  /** Every voicemail in the world (GM — Admin → Phone → Voicemail), newest first, with the inbox it is in. */
  /**
   * Which inbox a journal is. MessageRepository.identifyInbox is STATIC — calling it on the instance found nothing,
   * which left Admin → Phone's call log and voicemail empty.
   */
  _inboxOf(repo, journal) {
    const fn = repo?.constructor?.identifyInbox || repo?.identifyInbox;
    try { return fn ? fn.call(repo?.constructor?.identifyInbox ? repo.constructor : repo, journal) : null; } catch { return null; }
  }

  allVoicemails() {
    const repo = game.nightcity?.messageRepository;
    const out = [];
    for (const j of game.journal ?? []) {
      const id = this._inboxOf(repo, j);
      if (!id) continue;
      for (const p of j.pages?.contents ?? []) {
        const v = p.flags?.[MODULE_ID]?.voicemail;
        if (v?.vmId) out.push({ ...v, pageId: p.id, journalId: j.id, ownerId: id.ownerId, ownerIsContact: !!id.isContact });
      }
    }
    return out.sort((a, b) => (b.at || 0) - (a.at || 0));
  }

  /** Mark a voicemail heard (or not) / delete it. The GM writes; a player relays for their own lines. */
  async setVoicemailHeard(ownerId, vmId, heard = true) { return this._vmWrite({ op: 'heard', ownerId, vmId, heard }); }
  async deleteVoicemail(ownerId, vmId) { return this._vmWrite({ op: 'delete', ownerId, vmId }); }

  async _vmWrite(data) {
    if (!isGM()) {
      if (!game.users.activeGM) return { ok: false, error: 'No GM is online.' };
      this.socket.emit(SOCKET_OPS.CALL_VM_REQUEST, data);
      return { ok: true, relayed: true };
    }
    const journal = await game.nightcity?.messageRepository?.getInboxJournal?.(data.ownerId);
    const page = journal?.pages.contents.find((p) => p.flags?.[MODULE_ID]?.voicemail?.vmId === data.vmId);
    if (!page) return { ok: false, error: 'That voicemail is gone.' };
    if (data.op === 'delete') await page.delete();
    else await page.update({ [`flags.${MODULE_ID}.voicemail`]: { ...page.flags[MODULE_ID].voicemail, heard: !!data.heard } });
    this.eventBus.emit(EVENTS.VOICEMAIL_LEFT, { vm: null, changed: data.vmId });
    return { ok: true };
  }

  /** GM side of CALL_VM_REQUEST: a player leaving a message, or marking / deleting one of their own. */
  /**
   * Is `senderId` the person on the payphone this voicemail comes from (audit DATA-18)? The voicemail carries the
   * booth, not a character; the GM's copy of the call (or, if the call is already gone, who is on the booth now)
   * names the real person. @private
   */
  _isBoothCaller(vm, senderId) {
    const booth = vm?.from?.payphone;
    if (!booth || !senderId) return false;
    const call = vm.callId ? this.calls.get(vm.callId) : null;
    if (call) return call.from?.payphone === booth && call.from?.realUserId === senderId;
    return game.nightcity?.payphoneService?.inUse?.get?.(booth)?.userId === senderId;
  }

  async handleVoicemailRequest(data, senderId) {
    if (!isGM() || game.users.activeGM?.id !== game.user.id || !data) return;
    if (data.op === 'leave') {
      const vm = data.vm;
      // the caller must be who the message says (a player leaving as their own character / its burner)
      const sender = game.users.get(senderId);
      const fromActor = vm?.from?.actorId ? game.actors?.get(vm.from.actorId) : null;
      // A payphone caller has no character on the call (audit DATA-18): the GM's own record says who is really on it.
      if (!vm?.vmId || !(fromActor?.testUserPermission(sender, 'OWNER') || this._isBoothCaller(vm, senderId))) return;
      const clean = makeVoicemail(vm);
      if (clean) await this.writeVoicemail({ ...clean, vmId: vm.vmId, at: vm.at || clean.at });
      return;
    }
    // heard / delete: only for a line the sender owns
    const actor = game.actors?.get(data.ownerId);
    if (!actor?.testUserPermission(game.users.get(senderId), 'OWNER')) return;
    await this._vmWrite(data);
  }

  // ═══════════════════════════════════════════════════════════
  //  Recordings (phase 3b) — players can't upload: the GM's client saves the file
  // ═══════════════════════════════════════════════════════════

  /**
   * Hand a recording to whoever saves it: the active GM does it here; a player sends it in pieces
   * (`SOCKET_OPS.CALL_AUDIO`) with what to do once it is saved (`meta.purpose`: 'vm' | 'greeting').
   */
  async _sendAudio(base64, mime, meta) {
    if (!base64) return { ok: false, error: 'Nothing was recorded.' };
    if (base64.length > AUDIO_MAX_B64) return { ok: false, error: 'That recording is too long.' };
    if (isGM() && game.users.activeGM?.id === game.user.id) return this._audioArrived(base64, mime, meta, game.user.id);
    if (!game.users.activeGM) return { ok: false, error: 'No GM is online to keep the recording — try again when they are.' };
    const uploadId = `up-${Math.random().toString(36).slice(2, 10)}`;
    const n = Math.max(1, Math.ceil(base64.length / AUDIO_CHUNK));
    for (let i = 0; i < n; i++) {
      this.socket.emit(SOCKET_OPS.CALL_AUDIO, { uploadId, i, n, chunk: base64.slice(i * AUDIO_CHUNK, (i + 1) * AUDIO_CHUNK), mime, meta: i === n - 1 ? meta : null });
    }
    return { ok: true, relayed: true };
  }

  /** GM side of CALL_AUDIO: collect the pieces; when they are all in, save and act. */
  async handleAudio(data, senderId) {
    if (!isGM() || game.users.activeGM?.id !== game.user.id || !data?.uploadId) return;
    const now = Date.now();
    for (const [k, u] of this._uploads) if (now - u.at > 120000) this._uploads.delete(k);   // abandoned uploads
    const u = this._uploads.get(data.uploadId) || { parts: [], n: data.n, sender: senderId, at: now, mime: data.mime, meta: null };
    if (u.sender !== senderId) return;
    u.parts[data.i] = data.chunk;
    if (data.meta) u.meta = data.meta;
    this._uploads.set(data.uploadId, u);
    if (u.parts.filter((p) => typeof p === 'string').length < u.n || !u.meta) return;
    this._uploads.delete(data.uploadId);
    const base64 = u.parts.join('');
    if (base64.length > AUDIO_MAX_B64) return;
    await this._audioArrived(base64, u.mime, u.meta, senderId);
  }

  /** GM: a whole recording is here — check who sent it, save the file, then do what it was for. */
  async _audioArrived(base64, mime, meta, senderId) {
    const sender = game.users.get(senderId);
    if (meta?.purpose === 'vm') {
      const vm = meta.vm || {};
      const fromActor = vm.from?.actorId ? game.actors?.get(vm.from.actorId) : null;
      if (!sender?.isGM && !fromActor?.testUserPermission(sender, 'OWNER') && !this._isBoothCaller(vm, sender?.id)) return { ok: false, error: 'Not your line.' };
      const ref = await this._storeAudio(base64, mime, `vm-${vm.callId || 'msg'}`);
      if (!ref) { this._tellUploadFailed(senderId); return { ok: false, error: 'The recording could not be saved.' }; }
      const clean = makeVoicemail({ ...vm, kind: 'audio', audio: ref });
      if (clean) await this.writeVoicemail(clean);
      return { ok: true };
    }
    if (meta?.purpose === 'greeting') {
      const l = this.line(meta.number);
      const owned = sender?.isGM || (l?.owner?.actorId && game.actors?.get(l.owner.actorId)?.testUserPermission(sender, 'OWNER'));
      if (!l || !owned) return { ok: false, error: 'Not your line.' };
      const ref = await this._storeAudio(base64, mime, `greeting-${String(meta.number).replace(/\D/g, '')}`);
      if (!ref) { this._tellUploadFailed(senderId); return { ok: false, error: 'The recording could not be saved.' }; }
      const settings = meta.settings || {};
      return this.saveLineSettings(meta.number, { ...settings, greeting: { ...(settings.greeting || {}), kind: 'recorded', audio: ref, duration: meta.duration || 0 } });
    }
    return { ok: false };
  }

  /**
   * GM: save a recording. A file in the world's `ncm-voicemail` folder when uploads work (The Forge uses its own
   * store); otherwise, when it is short enough, the recording is kept inside the message as data. Null = no room.
   */
  async _storeAudio(base64, mime = 'audio/webm', name = 'voicemail') {
    const ext = /ogg/.test(mime) ? 'ogg' : /mp4|m4a/.test(mime) ? 'm4a' : 'webm';
    const FP = (typeof FilePicker !== 'undefined' ? FilePicker : null) || foundry.applications?.apps?.FilePicker?.implementation;
    try {
      if (FP?.upload && typeof File !== 'undefined') {
        const bin = atob(base64); const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const file = new File([bytes], `${name}-${Date.now().toString(36)}.${ext}`, { type: mime.split(';')[0] });
        const source = (typeof ForgeVTT !== 'undefined' && ForgeVTT?.usingTheForge) ? 'forgevtt' : 'data';
        const dir = `worlds/${game.world.id}/ncm-voicemail`;
        try { await FP.createDirectory(source, dir, {}); } catch { /* already there */ }
        const r = await FP.upload(source, dir, file, {}, { notify: false });
        if (r?.path) return r.path;
      }
    } catch (err) { log.warn(`Calls: could not save a recording as a file: ${err.message}`); }
    return base64.length <= DATA_URL_MAX ? `data:${mime.split(';')[0]};base64,${base64}` : null;
  }

  _tellUploadFailed(senderId) {
    ncmNotify.warn('NCM | A voice recording could not be saved (the world may not accept uploads). It was not delivered.');
    if (senderId !== game.user.id) this.socket.emit(SOCKET_OPS.CALL, { type: 'audioFailed', callId: 'audio', userIds: [senderId] });
  }

  /** Save a recorded greeting for a number (GM here, a player relays the recording). */
  async saveRecordedGreeting(number, settings, audio) {
    if (!this.recordingOn) return { ok: false, error: 'The GM has switched recordings off.' };
    if (!audio?.base64) return { ok: false, error: 'Record a greeting first.' };
    if ((audio.ms || 0) > GREETING_RECORD_MS + 1000) return { ok: false, error: 'A greeting is 20 seconds at most.' };
    return this._sendAudio(audio.base64, audio.mime, { purpose: 'greeting', number, settings, duration: (audio.ms || 0) / 1000 });
  }

  /** GM: clear recordings older than the keep setting (their words stay). Files on disk stay — Foundry cannot delete them. */
  async purgeRecordings(days = this.keepDays) {
    if (!isGM()) return { ok: false, count: 0 };
    const old = recordingsToPurge(this.allVoicemails(), days);
    for (const v of old) {
      const page = game.journal?.get(v.journalId)?.pages?.get(v.pageId);
      if (page) await page.update({ [`flags.${MODULE_ID}.voicemail`]: { ...page.flags[MODULE_ID].voicemail, audio: '', purged: true } });
    }
    return { ok: true, count: old.length };
  }

  // ─── the network drops a live call ───

  /**
   * Called on NETWORK_CHANGED (and when nodes change): a side whose network is gone — a dead zone, a node jammed /
   * off / damaged on its scene, or moved to another network — drops every call it is on, and says why on both ends.
   * A GM answering as an NPC is wherever the NPC is, so only players' calls drop.
   */
  checkSignal() {
    if (isGM()) return;
    for (const c of this.myCalls()) {
      if (!['live', 'held', 'dialing', 'ringing'].includes(c.state)) continue;
      const reason = this._lostLine(c.id);
      if (!reason) continue;
      this._send('drop', c, { reason });
      this._endLocal(c.id, 'dropped', { notify: false, reason });
    }
  }

  /** Why this client's side of a call has no line any more (or null). */
  _lostLine(callId) {
    const ns = game.nightcity?.networkService;
    if (!ns) return null;
    const wasNet = this._myNet.get(callId) ?? '';
    if (!wasNet && !this._noSignal()) return null;
    const scene = game.scenes?.viewed;
    const block = wasNet ? (ns.getSceneBlocks?.(scene?.id) || {})[wasNet] || null : null;
    const node = block ? (ns.getNodes?.({ networkId: wasNet, sceneId: scene?.id }) || [])[0] : null;
    return dropReason({ wasNet, curNet: ns.currentNetworkId || '', deadZone: !!ns.isDeadZone, nodeDead: !!ns.isNodeDead, block, nodeName: node?.name || '', sceneName: scene?.name || '' });
  }

  // ═══ a withheld number: the trace ═══

  /**
   * The callee traces a withheld caller (live, or later from the log): a skill check (the anonymous-mail trace
   * settings), and on a success the GM reveals who it was — to this user only — and fixes their log page.
   */
  async traceCall(callId, { actor } = {}) {
    const skillSvc = game.nightcity?.skillService;
    const who = actor || resolveOperator();
    if (!who || !skillSvc) return { ok: false, error: 'Pick a character first.' };
    let dv = 9, skill = 'interface';
    try { dv = Number(game.settings.get(MODULE_ID, 'anonTraceDV')) || 9; skill = game.settings.get(MODULE_ID, 'anonTraceSkill') || 'interface'; } catch { /* defaults */ }
    const r = await skillSvc.performCheck(who, skill, { dc: dv, showChat: true, ask: { title: 'Tracing a withheld number' }, context: 'Tracing a withheld number', flavor: `Trace // DV ${dv}`,
      reveal: { title: 'Triangulating the call', ctx: 'Trace a withheld number', ok: 'Caller traced', no: 'Trace lost' } });
    if (r?.cancelled) return { ok: true, traced: false, cancelled: true };
    const ts = game.nightcity?.traceService;
    try {
      if (r?.success) ts?.logSuccess?.({ actor: who, action: 'call-trace', source: 'A withheld call', severity: 'minor' });
      else ts?.fireTrace?.({ actor: who, action: 'call-trace', source: 'A withheld call', severity: 'minor' });
    } catch (err) { log.warn(`Calls: trace log: ${err.message}`); }
    if (!r?.success) return { ok: true, traced: false };
    if (!game.users.activeGM) return { ok: false, error: 'No GM is online to reveal the caller.' };
    if (game.user.isGM) { await this._revealTo(callId, game.user.id); return { ok: true, traced: true }; }
    this.socket.emit(SOCKET_OPS.CALL, { type: 'traceRequest', callId, userIds: [game.users.activeGM.id] });
    return { ok: true, traced: true };
  }

  /** GM: tell one user who a withheld caller really was, and un-mask their log page. */
  async _revealTo(callId, userId) {
    if (!isGM() || game.users.activeGM?.id !== game.user.id) return;
    const live = this.calls.get(callId);
    const logs = this.allLogs();
    const out = logs.find((l) => l.callId === callId);   // allLogs prefers the caller's own (unmasked) page
    const from = live?.from || out?.from;
    if (!from || (!from.actorId && !from.contactId && !from.number)) return;   // only a mask is left: nothing to reveal
    const sp = from.special ? specialMap(specialList(this._get('phoneSpecial', null)))[specialKey(from.number)] : null;
    if (sp?.trace === 'dead') return;
    let real = { ...from, anon: false, ...(sp ? { name: sp.trace === 'false' ? (sp.falseName || sp.name || sp.num) : (sp.name || sp.num) } : {}) };
    if (!sp && !from.special) {
      const ctx = this.numberContext, p = parseNumber(from.number, ctx), line = this.lines()[p.key], row = rowOf(p, ctx), type = lineTypeFor(line, row, this.lineTypes);
      const found = traceFinds(type, { name: from.realName || from.name, label: line?.label || '', place: row?.District || row?.City || '' });
      if (!found) return;
      if (!found.owner) real = { number: from.number, name: found.name, img: '', anon: false, asLine: true, showOnly: 'name' };
      else real = { ...real, name: found.name, showOnly: 'name' };
    }
    if (live) this.calls.set(callId, { ...live, traced: true });   // the GM's own copy: a later log page shows the caller
    this.socket.emit(SOCKET_OPS.CALL, { type: 'reveal', callId, from: real, userIds: [userId] });
    // the callee's own log page: show the real caller from now on
    for (const j of game.journal ?? []) {
      for (const p of j.pages?.contents ?? []) {
        const l = p.flags?.[MODULE_ID]?.callLog;
        if (l?.callId === callId && l.direction === 'in' && l.anonCall) await p.update({ [`flags.${MODULE_ID}.callLog`]: { ...l, other: { ...real }, traced: true } });
      }
    }
  }

  // ─── the network drops a live call ───

  // ─── sounds ───

  _sound(id) { try { game.nightcity?.soundService?.play?.(id); } catch { /* ignore */ } }

  _startRing(callId, waiting) {
    this._stopRing(callId);
    if (this.silent) return;
    const id = waiting ? 'call-waiting' : 'call-ring';
    this._sound(id);
    this._ringLoops.set(callId, setInterval(() => {
      if (this.calls.get(callId)?.state !== 'ringing') return this._stopRing(callId);
      this._sound(id);
    }, waiting ? RING_BEAT_MS * 3 : RING_BEAT_MS * 2));
  }

  _startRingback(callId) {
    this._stopRing(callId);
    this._sound('call-ringback');
    this._ringLoops.set(callId, setInterval(() => {
      const st = this.calls.get(callId)?.state;
      if (st !== 'dialing' && st !== 'ringing') return this._stopRing(callId);
      this._sound('call-ringback');
    }, RING_BEAT_MS * 2));
  }

  _stopRing(callId) { clearInterval(this._ringLoops.get(callId)); this._ringLoops.delete(callId); }

  // ═══════════════════════════════════════════════════════════
  //  The call log
  // ═══════════════════════════════════════════════════════════

  /** The caller hands its summary to the active GM, who writes both sides' log pages. */
  _log(call) {
    const summary = this._summary(call);
    if (isGM() && game.users.activeGM?.id === game.user.id) return this.writeLog(summary).catch((e) => log.warn(`Calls: log failed: ${e.message}`));
    if (game.users.activeGM) this.socket.emit(SOCKET_OPS.CALL_LOG_REQUEST, { summary });
  }

  _summary(call) {
    const pick = (p) => ({ actorId: p?.actorId || null, contactId: p?.contactId || null, number: p?.number || '', name: p?.name || '', ...(p?.anon ? { anon: true } : {}),
      ...(p?.payphone || p?.payphoneId ? { payphone: p.payphone || p.payphoneId, realActorId: p.realActorId || null, realName: p.realName || '' } : {}) });
    return { callId: call.id, from: pick(call.from), to: pick(call.to), sceneId: game.scenes?.viewed?.id || '', dropReason: call.dropReason || '', traced: !!call.traced, startedAt: call.startedAt, answeredAt: call.answeredAt, endedAt: call.endedAt,
      outcome: call.outcome, mode: (call.lines?.length ? 'type' : call.mode), seconds: callSeconds(call), net: call.net ? { id: call.net.id, name: call.net.name } : null,
      lines: transcriptOf(call),
      gameTime: game.nightcity?.timeService?.getCurrentTime?.() || new Date().toISOString(), scene: game.scenes?.viewed?.name || '' };
  }

  /**
   * GM: taps and sniffers on a node of the network a connected call rode, on the caller's scene, catch it — a
   * mail-shaped copy (NetworkService.tapDelivery, never the people on the call). Returns who heard it.
   */
  async _intercept(summary) {
    const ns = game.nightcity?.networkService;
    if (!ns?.tapDelivery || summary.outcome !== 'answered' || !summary.net?.id || !summary.sceneId) return [];
    const { subject, body } = interceptMail(summary, { fmtDuration: formatDuration });
    const heard = [];
    try {
      await ns.tapDelivery({ network: summary.net.id, sentFromScene: summary.sceneId, subject, body, timestamp: summary.gameTime,
        from: summary.from?.anon ? 'withheld' : (summary.from?.number || ''), to: summary.to?.number || '',
        fromActorId: summary.from?.actorId || null, toActorId: summary.to?.actorId || null, fromContactId: summary.from?.contactId || null }, heard);
    } catch (err) { log.warn(`Calls: a tap could not catch a call: ${err.message}`); }
    return heard;
  }

  /** GM: a row in Admin → Networks → Activity log for every call (who called whom, how it ended). */
  _activityRow(s) {
    const log = game.nightcity?.accessLogService;
    if (!log?.addEntry || !s.net?.id) return;
    const who = (p) => (p?.anon ? 'a withheld number' : (p?.name || p?.number || 'someone'));
    const how = s.outcome === 'answered' ? (s.seconds ? formatDuration(s.seconds) : 'connected') : (OUTCOMES[s.outcome] || s.outcome || '').toLowerCase();
    log.addEntry('call', { networkId: s.net.id, networkName: s.net.name, actorId: s.from?.actorId || null, actorName: who(s.from),
      sceneId: s.sceneId || '', sceneName: s.scene || '',
      message: `called ${who(s.to)} — ${how}${s.dropReason ? ` (${s.dropReason})` : ''}${s.heardBy?.length ? ` · heard by ${s.heardBy.length} tap${s.heardBy.length === 1 ? '' : 's'}` : ''}`,
      extra: { callId: s.callId } });
  }

  /** GM side of CALL_LOG_REQUEST. */
  async handleLogRequest(data, senderId = undefined) {
    if (!isGM() || game.users.activeGM?.id !== game.user.id || !data?.summary) return;
    if (senderId === undefined) { await this.writeLog(data.summary); return; }
    // A relayed log is written from the GM's own copy of the call (audit SEC-22): the call must be one this
    // GM saw, the sender must have been on it, and each call is logged once. Only the typed lines come
    // from the request when the GM's copy has none, as plain text.
    const ok = this.checkLogRequest(data, senderId);
    if (!ok.ok) { log.warn(`Calls: log request refused: ${ok.why}`); return; }
    await this.writeLog(ok.summary);
  }

  /** @returns {{ok:true, summary:object}|{ok:false, why:string}} */
  checkLogRequest(data = {}, senderId = null) {
    const user = senderId ? game.users?.get(senderId) : null;
    if (!user) return { ok: false, why: 'unknown sender' };
    const callId = String(data.summary?.callId || '');
    const call = this.calls.get(callId);
    if (!call) return { ok: false, why: 'a call this GM never saw' };
    const onIt = call.from?.userId === senderId || call.from?.realUserId === senderId || (call.to?.userIds || []).includes(senderId) || call.to?.userId === senderId;
    if (!user.isGM && !onIt) return { ok: false, why: 'the sender was not on that call' };
    this._loggedCalls ??= new Set();
    if (this._loggedCalls.has(callId)) return { ok: false, why: 'already logged' };
    this._loggedCalls.add(callId);
    const summary = { ...this._summary(call), sceneId: user.viewedScene || '' };
    if (!summary.lines?.length && Array.isArray(data.summary?.lines)) {
      summary.lines = data.summary.lines.slice(0, 300).map((l) => ({ ...(l && typeof l === 'object' ? l : {}), text: String(l?.text ?? '').slice(0, 500) }))
        .map(({ text, name, side, at }) => ({ text, name: String(name ?? '').slice(0, 60), side: side === 'callee' ? 'callee' : 'caller', at: Number(at) || 0 }));
    }
    return { ok: true, summary };
  }

  /** May this user ask for a withheld caller to be traced? Only the callee (audit SEC-21). */
  mayTraceCall(callId, userId) {
    const user = userId ? game.users?.get(userId) : null;
    if (!user) return false;
    if (user.isGM) return true;
    const live = this.calls.get(callId);
    if (live) return (live.to?.userIds || []).includes(userId) || live.to?.userId === userId;
    const OWNER = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
    return this.allLogs().some((l) => l.callId === callId && l.direction === 'in' && !!game.actors?.get(l.me?.actorId)?.testUserPermission?.(user, OWNER));
  }

  /**
   * Write one call-log page into each side's inbox journal (GM only). The page has NO messageId, so every mail reader
   * skips it; the Calls tab reads `flags.<id>.callLog`.
   */
  async writeLog(summary) {
    if (!isGM()) return;
    const repo = game.nightcity?.messageRepository;
    if (!repo?.getInboxJournal) return;
    // a booth side: the caller never learns who picked up a payphone, the GM does — fill it in from the GM's own copy
    for (const side of ['from', 'to']) {
      const p = summary[side], mine = this.calls.get(summary.callId)?.[side];
      if (p?.payphone && !p.realName && mine?.realName) summary = { ...summary, [side]: { ...p, realActorId: mine.realActorId || null, realName: mine.realName } };
    }
    summary = { ...summary, heardBy: await this._intercept(summary) };
    this._activityRow(summary);
    try { await game.nightcity?.terminalService?.mirrorCallToAccounts?.(summary); } catch (err) { log.warn(`Calls: terminal mirror: ${err.message}`); }
    const hide = !!summary.from?.anon && !summary.traced;   // a withheld caller stays hidden on the callee's page until traced
    const sides = [['out', summary.from, summary.to], ['in', summary.to, summary.from]];
    const done = new Set();
    for (const [direction, me, other] of sides) {
      const inboxes = this._sharedInboxes(me?.number);
      // a booth has no inbox: its side goes to the GM-only payphone log, where the real name is kept
      const booth = me?.payphone ? `pp:${me.payphone}` : null;
      for (const ownerId of booth ? [booth] : inboxes.length ? inboxes : [me?.actorId || me?.contactId]) {
      if (!ownerId || done.has(ownerId)) continue;
      done.add(ownerId);
      try {
        const journal = booth ? await this._payphoneLogJournal() : await repo.getInboxJournal(ownerId);
        if (!journal) continue;
        // the callee of a call that only rang sees it as missed
        const outcome = direction === 'in' && ['missed', 'busy'].includes(summary.outcome) ? 'missed' : summary.outcome;
        await journal.createEmbeddedDocuments('JournalEntryPage', [{
          name: `[CALL] ${direction === 'out' ? 'to' : 'from'} ${other?.name || other?.number || 'unknown'}`,
          type: 'text', text: { content: '' },
          flags: { [MODULE_ID]: { callLog: { ...summary, direction, me, other: direction === 'in' && hide ? maskCaller(other) : (booth ? other : maskPayphoneSide(other)),
            ...(booth ? { boothPage: true, from: viaName(summary.from), to: viaName(summary.to) } : { from: maskPayphoneSide(summary.from), to: maskPayphoneSide(summary.to) }),
            ...(direction === 'in' && hide ? { anonCall: true, from: maskCaller(summary.from) } : {}), outcome, seen: direction === 'out',
            // who listened in is the GM's business: the callee's page never says
            heardBy: game.actors?.get(me?.actorId)?.hasPlayerOwner ? [] : summary.heardBy } } },
        }]);
      } catch (err) { log.warn(`Calls: could not write a log page: ${err.message}`); }
      }
    }
  }

  /**
   * The call log for a character (newest first): pages in its inbox carrying `callLog`.
   * @param {string} ownerId — actor or contact id
   */
  async getLog(ownerId) {
    const journal = await game.nightcity?.messageRepository?.getInboxJournal?.(ownerId);
    const written = this.writtenLog(ownerId).map((e) => writtenToLog(e));
    if (!journal) return written.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
    return [...journal.pages.contents.map((p) => ({ pageId: p.id, journalId: journal.id, ...(p.flags?.[MODULE_ID]?.callLog || {}) })).filter((l) => l.callId), ...written]
      .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  }

  /**
   * Every call in the world (GM): one entry per call, read from every inbox journal, newest first. A call logged on
   * both sides is kept once, as the caller's page (or the only page there is).
   */
  allLogs() {
    const repo = game.nightcity?.messageRepository;
    const byCall = new Map();
    const heard = new Map();   // who listened in rides only the non-player side's page
    for (const j of game.journal ?? []) {
      if (!this._inboxOf(repo, j) && !j.getFlag?.(MODULE_ID, 'payphoneLog')) continue;
      for (const p of j.pages?.contents ?? []) {
        const l = p.flags?.[MODULE_ID]?.callLog;
        if (!l?.callId) continue;
        if (l.heardBy?.length) heard.set(l.callId, l.heardBy);
        const prev = byCall.get(l.callId);
        // the booth's own page wins: it is the only one that knows who was really on the payphone
        if (!prev || (l.boothPage && !prev.boothPage) || (!prev.boothPage && prev.direction !== 'out' && l.direction === 'out')) byCall.set(l.callId, { ...l, pageId: p.id, journalId: j.id });
      }
    }
    for (const [id, h] of heard) { const l = byCall.get(id); if (l && !l.heardBy?.length) l.heardBy = h; }
    const nameOf = (id) => game.actors?.get(id)?.name || game.nightcity?.masterContactService?.getContact?.(id)?.name || '';
    const written = Object.entries(this._get('phoneWrittenLogs', {}) || {}).flatMap(([id, list]) => (Array.isArray(list) ? list : []).map((e) => writtenToLog(e, { name: nameOf(id), number: '' })));
    return [...byCall.values(), ...written].sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  }

  /** The GM-only journal booth call logs live in (a booth has no inbox; who really called is the GM's business). */
  async _payphoneLogJournal() {
    let j = game.journal.find((e) => e.getFlag(MODULE_ID, 'payphoneLog'));
    if (!j && isGM()) j = await JournalEntry.create({ name: 'NCM — Payphone calls', ownership: { default: 0 }, flags: { [MODULE_ID]: { payphoneLog: true } } });
    return j || null;
  }

  /** Every booth call page (GM), newest first. */
  payphoneLog() {
    const j = game.journal?.find?.((e) => e.getFlag(MODULE_ID, 'payphoneLog'));
    return (j?.pages?.contents || []).map((p) => ({ pageId: p.id, journalId: j.id, ...(p.flags?.[MODULE_ID]?.callLog || {}) })).filter((l) => l.callId)
      .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  }

  /** Mark a character's missed calls as seen (the Calls tab opens). */
  async markSeen(ownerId) {
    const journal = await game.nightcity?.messageRepository?.getInboxJournal?.(ownerId);
    if (!journal) return;
    const updates = journal.pages.contents.filter((p) => { const l = p.flags?.[MODULE_ID]?.callLog; return l && !l.seen; })
      .map((p) => ({ _id: p.id, [`flags.${MODULE_ID}.callLog.seen`]: true }));
    if (!updates.length) return;
    try { await journal.updateEmbeddedDocuments('JournalEntryPage', updates); } catch { /* a player without write access: the GM's view still shows them */ }
  }
}

/** A booth's side as the GM's log reads it: "Rache via Payphone, Kabuki". */
function viaName(p) { return p?.payphone && p.realName ? { ...p, name: `${p.realName} via ${p.name}` } : p; }

export { OUTCOMES };
