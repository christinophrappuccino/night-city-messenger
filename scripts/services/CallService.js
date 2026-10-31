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

import { MODULE_ID, EVENTS, SOCKET_OPS } from '../utils/constants.js';
import { log, isGM, resolveOperator, resolveDisplayPortrait } from '../utils/helpers.js';
import { normaliseNumber, displayNumber, generateNumbers, sanitizeRegion, DEFAULT_HOME_CODE } from '../utils/phoneNumbers.js';
import { createCall, createEndedCall, transition, resolveCallee, canCall, allowedModes, defaultMode, callSeconds, formatDuration, OUTCOMES,
  BUILT_MODES, makeLine, addLine, sideOf, transcriptOf } from '../utils/callModel.js';
import { dropReason, maskCaller, callerFor, interceptMail } from '../utils/callNet.js';
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
  get homeCode() { return this._get('callHomeCode', DEFAULT_HOME_CODE) || DEFAULT_HOME_CODE; }
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
  get region() { return sanitizeRegion(this._get('callDefaultRegion', {})); }

  // ═══════════════════════════════════════════════════════════
  //  Numbers
  // ═══════════════════════════════════════════════════════════

  /** The whole directory, keyed by normalised number. */
  lines() { return { ...(this._get('phoneLines', {}) || {}) }; }

  /** One line by any spelling of its number. */
  line(number) { return this.lines()[normaliseNumber(number, this.homeCode)] || null; }

  /** Every number that reaches a character: its own, then its burners (aliases linked to it). */
  linesFor(actorId) {
    if (!actorId) return [];
    return Object.entries(this.lines()).filter(([, l]) => l.owner?.actorId === actorId)
      .map(([normal, l]) => ({ normal, number: l.number, name: l.owner.name, contactId: l.owner.contactId || null, burner: !!l.owner.contactId }))
      .sort((a, b) => Number(a.burner) - Number(b.burner));
  }

  /** The number a character is called on (its own line, not a burner). */
  numberOf(actorId) { return this.linesFor(actorId).find((l) => !l.burner)?.number || ''; }

  /** The line a directory contact (NPC identity) answers on. */
  numberOfContact(contactId) {
    const hit = Object.values(this.lines()).find((l) => l.owner?.contactId === contactId);
    if (hit) return hit.number;
    return game.nightcity?.masterContactService?.getContact?.(contactId)?.phone || '';
  }

  /**
   * The number to ring a contact on, or '' when there is none: the contact's own phone, else the line of the directory
   * entry it copies, else the line of the character it is linked to. Never a send-only (system) address.
   */
  numberForContact(c) {
    if (!c) return '';
    const mcs = game.nightcity?.masterContactService;
    if (c.sendOnly || (c.email && mcs?.isSendOnly?.(c.email))) return '';
    if (c.phone) return c.phone;
    const mid = c.masterContactId || (c.type === 'master' ? c.id : null);
    if (mid) { const n = this.numberOfContact(mid); if (n) return n; }
    return c.actorId ? this.numberOf(c.actorId) : '';
  }

  /** Every number already in use (lines + directory contacts' phones), normalised. */
  takenNumbers() {
    const out = new Set(Object.keys(this.lines()));
    for (const c of game.nightcity?.masterContactService?.getAll?.() || []) if (c.phone) out.add(normaliseNumber(c.phone, this.homeCode));
    return out;
  }

  /** Is this number free (for `ownerKey` = the actor/contact asking, its own number counts as free)? */
  isFree(number, owner = {}) {
    const normal = normaliseNumber(number, this.homeCode);
    if (!normal) return false;
    const existing = this.lines()[normal];
    if (existing) return (owner.contactId && existing.owner?.contactId === owner.contactId) || (!owner.contactId && owner.actorId && existing.owner?.actorId === owner.actorId && !existing.owner?.contactId);
    const contact = (game.nightcity?.masterContactService?.getAll?.() || []).find((c) => c.phone && normaliseNumber(c.phone, this.homeCode) === normal);
    return !contact || contact.id === owner.contactId;
  }

  /** Numbers for the picker, never one already taken. */
  suggestNumbers({ country, region, code, count = 4, seed } = {}) {
    const r = sanitizeRegion({ ...this.region, ...(country ? { country } : {}), ...(region ? { region } : {}), ...(code ? { code } : {}) });
    return generateNumbers({ country: r.country, code: r.code, count, taken: this.takenNumbers(), seed: seed ?? Date.now(), homeCode: this.homeCode });
  }

  /**
   * Give a character (or a directory contact / an alias of a character) a number. GM writes; a player relays.
   * The old number of the same owner is released.
   * @param {{actorId?: string, contactId?: string, number: string}} o
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  async assignNumber({ actorId = null, contactId = null, number }) {
    const shown = displayNumber(number);
    if (!normaliseNumber(shown, this.homeCode)) return { ok: false, error: 'Type a number.' };
    if (!this.isFree(shown, { actorId, contactId })) return { ok: false, error: 'That number already belongs to someone.' };
    if (!isGM()) return this._relayLine({ op: 'assign', actorId, contactId, number: shown });
    return this._assignAsGm({ actorId, contactId, number: shown });
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
    await game.settings.set(MODULE_ID, 'phoneLines', lines);
    await this._mirror(l.owner, '');
    this.eventBus.emit(EVENTS.LINE_UPDATED, { number: normal });
    return { ok: true };
  }

  async _assignAsGm({ actorId, contactId, number }) {
    const lines = this.lines();
    const normal = normaliseNumber(number, this.homeCode);
    // the owner's previous line goes
    for (const [k, l] of Object.entries(lines)) {
      const same = contactId ? l.owner?.contactId === contactId : (l.owner?.actorId === actorId && !l.owner?.contactId);
      if (same && k !== normal) delete lines[k];
    }
    const owner = this._ownerRecord({ actorId, contactId });
    if (!owner) return { ok: false, error: 'Nobody to give it to.' };
    lines[normal] = { ...(lines[normal] || {}), number, owner };
    await game.settings.set(MODULE_ID, 'phoneLines', lines);
    await this._mirror(owner, number);
    this.eventBus.emit(EVENTS.LINE_UPDATED, { number: normal });
    return { ok: true, number };
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
    if (data.op === 'assign') await this._assignAsGm(data);
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
    if (as.contactId) {
      const c = game.nightcity?.masterContactService?.getContact?.(as.contactId);
      if (!c) return null;
      return { userId: game.user.id, actorId: c.actorId || null, contactId: c.id, name: c.name, number: this.numberOfContact(c.id), img: resolveDisplayPortrait({ contactId: c.id }) };
    }
    const actor = as.actorId ? game.actors?.get(as.actorId) : resolveOperator();
    if (!actor) return null;
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
    const from = this._caller(as);
    if (!from) return { ok: false, error: 'Pick a character first.' };
    // a withheld number: the callee never learns who it is (only the GM holds it) until a trace
    if (as.anon && isGM()) from.anon = true;
    if (this.myCalls().some((c) => c.state === 'ringing' && this._role(c) === 'caller')) return { ok: false, error: 'You are already calling someone.' };
    const callee = this.resolve(number);
    // an NPC caller (GM) is wherever the NPC is — the GM's own connection does not matter
    const verdict = canCall({ enabled: this.enabled, fromNumber: from.number, callee, noSignal: !isGM() && this._noSignal(), homeCode: this.homeCode, unknownNumbers: this._get('callUnknownNumbers', 'not-in-service') });
    const to = { kind: verdict.toGm && callee.kind === 'unowned' ? 'unowned' : callee.kind, actorId: callee.actorId || null, contactId: callee.contactId || null,
      number: displayNumber(number), name: callee.name || '', userIds: callee.userIds || [],
      img: callee.contactId || callee.actorId ? resolveDisplayPortrait({ contactId: callee.contactId, actorId: callee.actorId }) : '' };
    const net = this._net();
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
    const reachable = to.kind === 'player' ? (to.userIds || []).some((id) => game.users.get(id)?.active) : !!game.users.activeGM;
    const call = createCall({ from, to, net, mode: this.startMode });
    call.state = 'dialing';
    this._store(call);
    if (!isGM()) this._myNet.set(call.id, net?.id || '');
    // do not disturb: no ring at all — straight to their voicemail (or no answer when they take no messages)
    if (this.lineSettings(to.number).voicemail.dnd && ['player', 'npc'].includes(to.kind)) {
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

  /** Answer a ringing call (optionally as an NPC identity — GM). */
  answer(callId, as = null) {
    const call = this.calls.get(callId);
    if (!call || call.state !== 'ringing') return;
    // call waiting: answering a second call holds the live one
    for (const other of this.myCalls()) if (other.id !== callId && other.state === 'live') this.hold(other.id);
    const answered = transition(call, { type: 'answer', by: game.user.id });
    if (as) answered.to = { ...answered.to, ...as };
    if (!isGM()) this._myNet.set(callId, this._net()?.id || '');
    this._store(answered);
    this._stopRing(callId);
    this._send('answer', answered);
    this._sound('call-connect');
    this.eventBus.emit(EVENTS.CALL_STARTED, { call: answered, role: 'callee' });
  }

  decline(callId) {
    const call = this.calls.get(callId);
    if (!call || call.state !== 'ringing') return;
    this._send('decline', call);
    this._endLocal(callId, 'declined', { notify: false });
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
    if (type === 'audioFailed') { ui.notifications?.warn('NCM | Your recording could not be saved by the GM (the world may not accept uploads).'); return; }
    const mine = this.calls.get(callId);
    if (type === 'ring') {
      if (!call || mine) return;
      const here = this._ringsHere(call);
      const watching = game.user.isGM;
      if (!here && !watching) return;
      const ringing = { ...call, state: 'ringing' };
      // no signal here: it never rings — the caller hears why (and may reach voicemail)
      if (here && !game.user.isGM && this._noSignal()) { this._send('noSignal', ringing); return; }
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
    if (type === 'traceRequest') { this._revealTo(callId, senderId).catch(() => {}); return; }
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
          this.calls.delete(callId);
          this.eventBus.emit(EVENTS.CALL_ENDED, { call: { ...next, state: 'ended', outcome: 'answered' }, role: 'watch', quiet: true });
        } else {
          // a GM: another GM answered (the ring stops) or someone else's call went live (the switchboard updates)
          this.eventBus.emit(EVENTS.CALL_STARTED, { call: next, role });
        }
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
    const vm = { ...call, state: 'voicemail', vmStep: 'greet', vmWhy: why, greeting: greetingFor(settings) };
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
    const owner = voicemailOwner(vm?.to);
    const journal = owner ? await game.nightcity?.messageRepository?.getInboxJournal?.(owner) : null;
    if (!journal) { log.warn('Calls: a voicemail had no inbox to land in.'); return null; }
    try {
      await journal.createEmbeddedDocuments('JournalEntryPage', [{
        name: `[VOICEMAIL] from ${vm.from?.name || vm.from?.number || 'unknown'}`, type: 'text', text: { content: '' },
        flags: { [MODULE_ID]: { voicemail: { ...vm, heard: false } } },
      }]);
    } catch (err) { log.warn(`Calls: could not write a voicemail: ${err.message}`); return null; }
    const actor = vm.to?.actorId ? game.actors?.get(vm.to.actorId) : null;
    const owners = actor ? game.users.filter((u) => !u.isGM && actor.testUserPermission(u, 'OWNER')).map((u) => u.id) : [];
    const gms = game.users.filter((u) => u.isGM && u.active && u.id !== game.user.id).map((u) => u.id);
    this.socket.emit(SOCKET_OPS.CALL, { type: 'voicemail', callId: vm.vmId, vm, userIds: [...owners, ...gms] });
    this.eventBus.emit(EVENTS.VOICEMAIL_LEFT, { vm });
    return vm;
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
  async handleVoicemailRequest(data, senderId) {
    if (!isGM() || game.users.activeGM?.id !== game.user.id || !data) return;
    if (data.op === 'leave') {
      const vm = data.vm;
      // the caller must be who the message says (a player leaving as their own character / its burner)
      const sender = game.users.get(senderId);
      const fromActor = vm?.from?.actorId ? game.actors?.get(vm.from.actorId) : null;
      if (!vm?.vmId || !fromActor?.testUserPermission(sender, 'OWNER')) return;
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
      if (!sender?.isGM && !fromActor?.testUserPermission(sender, 'OWNER')) return { ok: false, error: 'Not your line.' };
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
    ui.notifications?.warn('NCM | A voice recording could not be saved (the world may not accept uploads). It was not delivered.');
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
    let dv = 15, skill = 'interface';
    try { dv = Number(game.settings.get(MODULE_ID, 'anonTraceDV')) || 15; skill = game.settings.get(MODULE_ID, 'anonTraceSkill') || 'interface'; } catch { /* defaults */ }
    const r = await skillSvc.performCheck(who, skill, { dc: dv, showChat: true, context: 'Tracing a withheld number', flavor: `Trace // DV ${dv}`,
      reveal: { title: 'Triangulating the call', ctx: 'Trace a withheld number', ok: 'Caller traced', no: 'Trace lost' } });
    if (!r?.success) return { ok: true, traced: false };
    if (!game.users.activeGM) return { ok: false, error: 'No GM is online to reveal the caller.' };
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
    const real = { ...from, anon: false };
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
    const pick = (p) => ({ actorId: p?.actorId || null, contactId: p?.contactId || null, number: p?.number || '', name: p?.name || '', ...(p?.anon ? { anon: true } : {}) });
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
  async handleLogRequest(data) {
    if (!isGM() || game.users.activeGM?.id !== game.user.id || !data?.summary) return;
    await this.writeLog(data.summary);
  }

  /**
   * Write one call-log page into each side's inbox journal (GM only). The page has NO messageId, so every mail reader
   * skips it; the Calls tab reads `flags.<id>.callLog`.
   */
  async writeLog(summary) {
    if (!isGM()) return;
    const repo = game.nightcity?.messageRepository;
    if (!repo?.getInboxJournal) return;
    summary = { ...summary, heardBy: await this._intercept(summary) };
    this._activityRow(summary);
    const hide = !!summary.from?.anon && !summary.traced;   // a withheld caller stays hidden on the callee's page until traced
    const sides = [['out', summary.from, summary.to], ['in', summary.to, summary.from]];
    const done = new Set();
    for (const [direction, me, other] of sides) {
      const ownerId = me?.actorId || me?.contactId;
      if (!ownerId || done.has(ownerId)) continue;
      done.add(ownerId);
      try {
        const journal = await repo.getInboxJournal(ownerId);
        if (!journal) continue;
        // the callee of a call that only rang sees it as missed
        const outcome = direction === 'in' && ['missed', 'busy'].includes(summary.outcome) ? 'missed' : summary.outcome;
        await journal.createEmbeddedDocuments('JournalEntryPage', [{
          name: `[CALL] ${direction === 'out' ? 'to' : 'from'} ${other?.name || other?.number || 'unknown'}`,
          type: 'text', text: { content: '' },
          flags: { [MODULE_ID]: { callLog: { ...summary, direction, me, other: direction === 'in' && hide ? maskCaller(other) : other,
            ...(direction === 'in' && hide ? { anonCall: true, from: maskCaller(summary.from) } : {}), outcome, seen: direction === 'out',
            // who listened in is the GM's business: the callee's page never says
            heardBy: game.actors?.get(me?.actorId)?.hasPlayerOwner ? [] : summary.heardBy } } },
        }]);
      } catch (err) { log.warn(`Calls: could not write a log page: ${err.message}`); }
    }
  }

  /**
   * The call log for a character (newest first): pages in its inbox carrying `callLog`.
   * @param {string} ownerId — actor or contact id
   */
  async getLog(ownerId) {
    const journal = await game.nightcity?.messageRepository?.getInboxJournal?.(ownerId);
    if (!journal) return [];
    return journal.pages.contents.map((p) => ({ pageId: p.id, journalId: journal.id, ...(p.flags?.[MODULE_ID]?.callLog || {}) }))
      .filter((l) => l.callId).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
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
      if (!this._inboxOf(repo, j)) continue;
      for (const p of j.pages?.contents ?? []) {
        const l = p.flags?.[MODULE_ID]?.callLog;
        if (!l?.callId) continue;
        if (l.heardBy?.length) heard.set(l.callId, l.heardBy);
        const prev = byCall.get(l.callId);
        if (!prev || (prev.direction !== 'out' && l.direction === 'out')) byCall.set(l.callId, { ...l, pageId: p.id, journalId: j.id });
      }
    }
    for (const [id, h] of heard) { const l = byCall.get(id); if (l && !l.heardBy?.length) l.heardBy = h; }
    return [...byCall.values()].sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
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

export { OUTCOMES };
