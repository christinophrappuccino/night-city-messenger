/**
 * Payphones — the world records, reach, who is on a booth, the ring on the scene, and the speaker.
 * @file scripts/services/PayphoneService.js
 * @module night-city-messenger
 * @description Spec dev/design/PHONE-REVISION.md §Payphones "Decided 2026-11-03". Rules: scripts/utils/payphones.js.
 *   A payphone is a record in the world setting `payphones` plus a line in `phoneLines` (kind 'payphone', nobody owns it).
 *   Its map pins / step-on areas are access points (kind 'payphone'). The CALL itself goes through CallService (a booth is
 *   a caller identity, `as.payphone`); this service owns everything around it:
 *   - reach: an owned, visible token within range of one of its pins (links, macros and chat cards skip it);
 *   - who is on a booth (SOCKET_OPS.PAYPHONE 'use'), so everyone else at it sees IN USE;
 *   - the ring: everyone viewing the booth's scene hears the bell and gets a prompt; only someone in reach can pick up;
 *   - the speaker: the person on the handset's client relays each line, read-only, to whoever stands in reach.
 *   GM-only writes (records, styles, lines); a player never writes a payphone.
 */

import { ncmNotify, tipText } from '../utils/notify.js';
import { MODULE_ID, EVENTS, SOCKET_OPS } from '../utils/constants.js';
import { log, isGM, resolveOperator, getSetting } from '../utils/helpers.js';
import { sanitizePayphone, sanitizePayphones, sanitizeSavedStyles, sanitizeLook, lookFromStyle, placeLabel, payphoneLine, inReach, bystanders, speakerOn } from '../utils/payphones.js';
import { normaliseNumber } from '../utils/phoneNumbering.js';
import { isFeatureOn } from '../utils/features.js';
import { payphoneTerm } from '../utils/payphoneTerm.js';

const RING_EVERY_MS = 1700;

export class PayphoneService {
  constructor() {
    /** id → { userId, name, callId, speaker, at } — who is on each booth, as last told */
    this.inUse = new Map();
    /** callId → { id, listeners: string[] } — booth calls this client relays to bystanders */
    this._relay = new Map();
    /** callId → { timer, note } — booths ringing on this client */
    this._ringing = new Map();
    /** callId → { id, place, who, lines[] } — booth calls this client is listening to on speaker */
    this.listening = new Map();
  }

  get socket() { return game.nightcity?.socketManager; }
  get calls() { return game.nightcity?.callService; }
  get bus() { return game.nightcity?.eventBus; }

  init() {
    const bus = this.bus;
    bus?.on(EVENTS.CALL_RINGING, (e) => this._onRinging(e));
    bus?.on(EVENTS.CALL_STARTED, (e) => this._onStarted(e));
    bus?.on(EVENTS.CALL_ENDED, (e) => this._onEnded(e));
    bus?.on(EVENTS.CALL_LINE, (e) => this._onLine(e));
    // a scene that goes takes its booths with it (the active GM, once)
    Hooks.on('deleteScene', (scene) => {
      if (game.users.activeGM?.id !== game.user.id) return;
      for (const p of this.getAll().filter((x) => x.sceneId === scene.id)) this.remove(p.id, { quiet: true }).catch(() => {});
    });
  }

  // ═══════════════════════════════ records ═══════════════════════════════

  getAll() { return Object.values(sanitizePayphones(this._read())).sort((a, b) => a.name.localeCompare(b.name)); }
  get(id) { const raw = this._read()[id]; return raw ? sanitizePayphone({ ...raw, id }) : null; }
  /** The booth a number rings, or null. */
  byNumber(number) {
    const home = this.calls?.homeCode;
    const key = normaliseNumber(number, home);
    return this.getAll().find((p) => p.number && normaliseNumber(p.number, home) === key) || null;
  }
  _read() { return getSetting('payphones', {}) || {}; }

  /**
   * GM: a new payphone on a scene, with a free number. It is not on the map yet — place it with openPlaceDialog.
   * @param {{name?: string, sceneId?: string, style?: string, look?: object}} o
   */
  async create({ name = '', sceneId = '', style = 'street', look = null } = {}) {
    if (!isGM()) return null;
    const scene = game.scenes.get(sceneId) || canvas?.scene || game.scenes.viewed;
    const num = this.calls?.suggestNumbers?.({ count: 1 })?.[0]?.number;
    if (!num) { ncmNotify.warn('No free number to give a payphone. Check Admin → Phone → Number setup.'); return null; }
    const pp = sanitizePayphone({ id: foundry.utils.randomID(), name: name || scene?.name || 'Payphone', sceneId: scene?.id || '', number: num, look: look || lookFromStyle(style), createdAt: Date.now() });
    await this.save(pp);
    return pp;
  }

  /** GM: write a payphone and keep its line in step. */
  async save(raw) {
    if (!isGM()) return null;
    const pp = sanitizePayphone(raw);
    if (!pp.id) return null;
    const all = this._read();
    const before = all[pp.id] ? sanitizePayphone({ ...all[pp.id], id: pp.id }) : null;
    all[pp.id] = pp;
    await game.settings.set(MODULE_ID, 'payphones', all);
    await this._writeLine(pp, before);
    this.bus?.emit(EVENTS.LINE_UPDATED, { payphone: pp.id });
    return pp;
  }

  /** The 'payphone' line in phoneLines: added, renamed, or moved to a new number (the old one is let go, not retired). */
  async _writeLine(pp, before) {
    const svc = this.calls;
    if (!svc) return;
    const home = svc.homeCode;
    const lines = svc.lines();
    if (before?.number && normaliseNumber(before.number, home) !== normaliseNumber(pp.number, home)) delete lines[normaliseNumber(before.number, home)];
    const key = pp.number ? normaliseNumber(pp.number, home) : '';
    if (key) lines[key] = payphoneLine(pp);
    else if (pp.number) log.warn(`Payphones: "${pp.number}" is not a number this world can dial`);
    await game.settings.set(MODULE_ID, 'phoneLines', lines);
  }

  /** GM: delete a payphone, its pins and areas, and free its number. */
  async remove(id, { quiet = false } = {}) {
    if (!isGM()) return false;
    const pp = this.get(id);
    const all = this._read();
    delete all[id];
    await game.settings.set(MODULE_ID, 'payphones', all);
    if (pp?.number && this.calls) {
      const lines = this.calls.lines();
      delete lines[normaliseNumber(pp.number, this.calls.homeCode)];
      await game.settings.set(MODULE_ID, 'phoneLines', lines);
    }
    await game.nightcity?.terminalScenePins?.removePinsForPayphone?.(id);
    if (!quiet && pp) ncmNotify.info(`${placeLabel(pp)} removed.`);
    return true;
  }

  // ─── saved looks ───

  styles() { try { return sanitizeSavedStyles(game.settings.get(MODULE_ID, 'payphoneStyles')); } catch { return []; } }
  async saveStyle(name, look) {
    if (!isGM() || !String(name || '').trim()) return null;
    const list = this.styles();
    const hit = list.find((s) => s.name.toLowerCase() === String(name).trim().toLowerCase());
    const entry = { id: hit?.id || foundry.utils.randomID(), name: String(name).trim().slice(0, 40), look: sanitizeLook(look) };
    const next = hit ? list.map((s) => (s.id === hit.id ? entry : s)) : [...list, entry];
    await game.settings.set(MODULE_ID, 'payphoneStyles', next);
    return entry;
  }
  async deleteStyle(id) { if (!isGM()) return; await game.settings.set(MODULE_ID, 'payphoneStyles', this.styles().filter((s) => s.id !== id)); }

  // ═══════════════════════════════ where it is, who is near ═══════════════════════════════

  /** The booth's pins and areas on its scene, as points. */
  pinsOf(pp) {
    const scene = game.scenes.get(pp?.sceneId);
    if (!scene) return [];
    const pts = scene.notes.filter((n) => n.getFlag(MODULE_ID, 'accessPayphone') === pp.id).map((n) => ({ x: n.x, y: n.y, range: Number(n.getFlag(MODULE_ID, 'accessRange') ?? pp.range) || 0 }));
    for (const r of scene.regions ?? []) {
      const a = r.getFlag(MODULE_ID, 'access');
      if (a?.kind !== 'payphone' || a.id !== pp.id) continue;
      const s = r.shapes?.[0];
      if (s) pts.push({ x: s.x + (s.width || 0) / 2, y: s.y + (s.height || 0) / 2, range: Math.max(1, Math.ceil(((s.width || 0) / (scene.grid?.size || 100)) / 2)) });
    }
    return pts;
  }

  /** Owned, visible tokens on the booth's scene, as { userId, x, y } (one per owning player user). */
  _tokensOn(scene) {
    const out = [];
    for (const t of scene?.tokens ?? []) {
      if (t.hidden || !t.actor) continue;
      const g = scene.grid?.size || 100;
      const x = t.x + ((t.width || 1) * g) / 2, y = t.y + ((t.height || 1) * g) / 2;
      for (const u of game.users) if (!u.isGM && u.active && t.actor.testUserPermission?.(u, 'OWNER')) out.push({ userId: u.id, x, y });
    }
    return out;
  }

  /**
   * Is THIS user standing at the booth? A booth with no pins (opened by a link) is always in reach; the GM always is.
   * @returns {{ok: boolean, reason?: string}}
   */
  reach(pp, user = game.user) {
    if (!pp) return { ok: false, reason: `That ${payphoneTerm('lower')} is gone.` };
    if (user.isGM) return { ok: true };
    const pins = this.pinsOf(pp);
    if (!pins.length) return { ok: true };
    const scene = game.scenes.get(pp.sceneId);
    if (user.viewedScene !== pp.sceneId) return { ok: false, reason: `The ${payphoneTerm('lower')} is on ${scene?.name || 'another scene'}.` };
    const mine = this._tokensOn(scene).filter((t) => t.userId === user.id);
    if (!mine.length) return { ok: false, reason: `You need a token on this scene, standing at the ${payphoneTerm('lower')}.` };
    const g = scene.grid?.size || 100;
    return mine.some((t) => pins.some((p) => inReach(t, p, Math.max(p.range, 1), g))) ? { ok: true } : { ok: false, reason: `You're too far from the ${payphoneTerm('lower')}. Walk up to it first.` };
  }

  /** Who else is in reach of a booth (for the speaker). */
  bystandersOf(pp, except = [game.user.id]) {
    const scene = game.scenes.get(pp?.sceneId);
    if (!scene) return [];
    const pins = this.pinsOf(pp);
    return bystanders(this._tokensOn(scene), pins, Math.max(...pins.map((p) => p.range), 1), scene.grid?.size || 100, except);
  }

  // ═══════════════════════════════ opening ═══════════════════════════════

  /**
   * Open a booth. `skipReach` for links, macros and chat cards (the GM handed it out).
   * @param {string} id @param {{skipReach?: boolean}} [o]
   */
  /** On in this load? (utils/features.js — off when Calls is off too.) */
  get enabled() { return isFeatureOn('payphones'); }

  open(id, { skipReach = false } = {}) {
    const pp = this.get(id);
    if (!pp) return void ncmNotify.warn(`That ${payphoneTerm('lower')} no longer exists.`);
    if (!this.enabled) { game.nightcity?.soundService?.play('error'); return void ncmNotify.warn(`${pp.name || `This ${payphoneTerm('lower')}`} is out of order.`); }
    if (!skipReach) { const r = this.reach(pp); if (!r.ok) { game.nightcity?.soundService?.play('error'); return void ncmNotify.warn(r.reason); } }
    return game.nightcity?.payphoneBooth?.open(pp);
  }

  /** The operator a booth uses (the terminals' rule). */
  operator() { return resolveOperator(); }

  // ═══════════════════════════════ who is on it ═══════════════════════════════

  /** Tell every client this user lifted / hung up a booth's handset. */
  setUse(id, on, { callId = null, speaker = false } = {}) {
    const name = this.operator()?.name || game.user.name;
    const entry = on ? { userId: game.user.id, name, callId, speaker: !!speaker, at: Date.now() } : null;
    if (entry) this.inUse.set(id, entry); else if (this.inUse.get(id)?.userId === game.user.id) this.inUse.delete(id);
    // Everyone is told who holds the handset (bystanders see it on the booth) — but not WHICH call: that tied the
    // masked booth call to the real player for anyone listening (audit PRIV-03). The call stays on this client.
    this.socket?.emit(SOCKET_OPS.PAYPHONE, { type: 'use', id, entry: entry ? { ...entry, callId: null } : null, userId: game.user.id });
    this.bus?.emit(EVENTS.PAYPHONE_STATE, { id });
  }

  /** Someone else on this booth, or null. */
  otherOn(id) { const u = this.inUse.get(id); return u && u.userId !== game.user.id ? u : null; }

  /** A user left: their handsets go back on the hook on this client (audit DATA-21). */
  onUserGone(userId) {
    let n = 0;
    for (const [id, u] of [...this.inUse]) {
      if (u?.userId !== userId) continue;
      this.inUse.delete(id); n += 1;
      this.bus?.emit(EVENTS.PAYPHONE_STATE, { id });
    }
    return n;
  }

  // ═══════════════════════════════ the ring ═══════════════════════════════

  _boothOfCall(call) {
    if (call?.from?.payphone) return { id: call.from.payphone, side: 'from' };
    if (call?.to?.kind === 'payphone' && call.to.payphoneId) return { id: call.to.payphoneId, side: 'to' };
    return null;
  }

  _onRinging({ call, role }) {
    if (!call || role !== 'callee' || call.to?.kind !== 'payphone' || this._ringing.has(call.id)) return;
    const pp = this.get(call.to.payphoneId);
    if (!pp) return;
    const started = Date.now();
    const ring = () => {
      // The bell checks for itself (audit PERF-12): a missed "ended" event used to leave it ringing for good.
      if (ringShouldStop(this.calls?.calls?.get?.(call.id), started, Date.now(), this.calls?.ringMs)) { this._stopRing(call.id); return; }
      const src = pp.sounds?.ring;
      if (src) game.nightcity?.soundService?.playFile?.(src);
      else game.nightcity?.soundService?.play('payphone-ring');
      for (const p of this.pinsOf(pp)) try { canvas?.ping?.({ x: p.x, y: p.y }, { style: 'pulse', duration: 900 }); } catch { /* no canvas */ }
    };
    ring();
    const note = this._ringNotice(call, pp);
    this._ringing.set(call.id, { timer: setInterval(ring, RING_EVERY_MS), note });
    game.nightcity?.payphoneBooth?.ringing?.(pp, call.id);
  }

  /** The prompt everyone on the scene gets. Pick up is live only in reach. */
  _ringNotice(call, pp) {
    const near = this.reach(pp);
    const el = document.createElement('div');
    el.className = 'ncm-pb-ringnote ncm-app';
    el.innerHTML = `<i class="fas fa-phone-volume"></i><div class="t"><b>${foundry.utils.escapeHTML?.(payphoneTerm('', { a: true })) ?? payphoneTerm('', { a: true })} is ringing</b><small>${foundry.utils.escapeHTML?.(placeLabel(pp)) ?? placeLabel(pp)}${near.ok ? ' — right next to you.' : ' — somewhere nearby.'}</small></div>
      <button type="button" data-pb-up ${near.ok ? '' : 'disabled'} data-tooltip="${tipText(near.ok ? 'Answer it. The caller sees the place, not you.' : 'Walk up to it to answer')}"><i class="fas fa-phone"></i> Pick up</button>
      <button type="button" data-pb-let data-tooltip="Anyone else near it can still answer">Let it ring</button>`;
    el.querySelector('[data-pb-up]').addEventListener('click', () => this.pickUp(call.id));
    el.querySelector('[data-pb-let]').addEventListener('click', () => el.remove());
    document.body.appendChild(el);
    return el;
  }

  /** Answer a ringing booth (in reach only). */
  pickUp(callId) {
    const call = this.calls?.calls.get(callId);
    const pp = call?.to?.kind === 'payphone' ? this.get(call.to.payphoneId) : null;
    if (!call || !pp) return;
    const r = this.reach(pp);
    if (!r.ok) return void ncmNotify.warn(r.reason);
    game.nightcity?.soundService?.play('payphone-hook');
    this._stopRing(callId);
    this.calls.answer(callId);
  }

  _stopRing(callId) {
    const r = this._ringing.get(callId);
    if (!r) return;
    clearInterval(r.timer);
    r.note?.remove();
    this._ringing.delete(callId);
    game.nightcity?.payphoneBooth?.ringing?.(null, callId);
  }

  // ═══════════════════════════════ the call goes live / ends ═══════════════════════════════

  _onStarted({ call, role }) {
    if (!call) return;
    this._stopRing(call.id);
    const b = this._boothOfCall(call);
    if (!b) return;
    const mineOnBooth = (b.side === 'from' && role === 'caller') || (b.side === 'to' && role === 'callee');
    if (!mineOnBooth || call.state !== 'live') return;
    const pp = this.get(b.id);
    if (!pp) return;
    const chosen = game.nightcity?.payphoneBooth?.speakerChoice?.(pp.id) ?? false;
    this.setUse(pp.id, true, { callId: call.id, speaker: speakerOn(pp.hear, chosen) });
    this.setSpeaker(call.id, speakerOn(pp.hear, chosen));
  }

  _onEnded({ call, transfer }) {
    // a switchboard handing over to the real call: the booth is still in use
    if (!call || transfer) return;
    this._stopRing(call.id);
    const b = this._boothOfCall(call);
    const u = b ? this.inUse.get(b.id) : null;
    // mine on this booth: confirmed with this call, or still waiting for it to connect (rang out, refused)
    if (u?.userId === game.user.id && (u.callId === call.id || !u.callId)) {
      this.setUse(b.id, false);
      game.nightcity?.payphoneBooth?.hungUp?.(this.get(b.id), call.id);
    }
    if (this._relay.has(call.id)) this._sendSpeaker(call.id, false);
    if (this.listening.has(call.id)) { this.listening.delete(call.id); game.nightcity?.payphoneBooth?.renderListen?.(); }
  }

  /**
   * The person on the handset turns the speaker on or off. The booth's own rule wins (always private / always speaker).
   * @param {string} callId @param {boolean} on
   */
  setSpeaker(callId, on) {
    const call = this.calls?.calls.get(callId);
    const b = this._boothOfCall(call);
    const pp = b ? this.get(b.id) : null;
    if (!pp) return false;
    const want = speakerOn(pp.hear, on);
    const u = this.inUse.get(pp.id);
    if (u?.userId === game.user.id) { u.speaker = want; this.socket?.emit(SOCKET_OPS.PAYPHONE, { type: 'use', id: pp.id, entry: u, userId: game.user.id }); }
    this._sendSpeaker(callId, want, pp);
    return want;
  }

  _sendSpeaker(callId, on, pp = null) {
    const prev = this._relay.get(callId);
    if (!on) {
      if (prev?.listeners?.length) this.socket?.emit(SOCKET_OPS.PAYPHONE, { type: 'speaker', callId, on: false, userIds: prev.listeners });
      this._relay.delete(callId);
      return;
    }
    pp = pp || this.get(prev?.id);
    if (!pp) return;
    const listeners = this.bystandersOf(pp);
    this._relay.set(callId, { id: pp.id, listeners });
    if (!listeners.length) return;
    const call = this.calls.calls.get(callId);
    const other = call?.from?.payphone === pp.id ? call.to : call?.from;
    const lines = (call?.lines || []).slice(-12).map((l) => ({ ...l, who: this._sideName(call, l.side, pp) }));
    this.socket?.emit(SOCKET_OPS.PAYPHONE, { type: 'speaker', callId, on: true, userIds: listeners, id: pp.id, place: placeLabel(pp),
      who: this.operator()?.name || game.user.name, otherName: other?.anon ? 'Unknown caller' : (other?.name || other?.number || 'the other end'), lines });
  }

  /** "Rache" for the booth's side, the other end's shown name for theirs. */
  _sideName(call, side, pp) {
    const boothSide = call?.from?.payphone === pp.id ? 'a' : 'b';
    if (side === boothSide) return this.operator()?.name || game.user.name;
    const other = boothSide === 'a' ? call.to : call.from;
    return other?.anon ? 'Unknown caller' : (other?.name || other?.number || 'Them');
  }

  _onLine({ callId, line }) {
    const r = this._relay.get(callId);
    if (!r?.listeners?.length || !line) return;
    const pp = this.get(r.id), call = this.calls?.calls.get(callId);
    this.socket?.emit(SOCKET_OPS.PAYPHONE, { type: 'line', callId, userIds: r.listeners, line: { ...line, who: this._sideName(call, line.side, pp) } });
  }

  // ═══════════════════════════════ socket ═══════════════════════════════

  /**
   * @param {object} data
   * @param {string|null} [senderId] - server-verified sender (SocketManager)
   */
  handleSocket(data = {}, senderId = null) {
    if (Array.isArray(data.userIds) && !data.userIds.includes(game.user.id)) return;
    switch (data.type) {
      case 'use': {
        if (!data.id || !senderId) return;
        // A user only says THEY lifted or hung up a handset (audit DATA-21): an entry naming someone else, or a
        // hang-up of someone else's handset, is ignored.
        if (data.entry) {
          if (data.entry.userId !== senderId) return;
          this.inUse.set(data.id, { ...data.entry, userId: senderId, callId: null });
        } else if (this.inUse.get(data.id)?.userId === senderId) this.inUse.delete(data.id);
        this.bus?.emit(EVENTS.PAYPHONE_STATE, { id: data.id });
        return;
      }
      case 'speaker': {
        if (!data.callId) return;
        if (data.on) this.listening.set(data.callId, { id: data.id, place: data.place, who: data.who, otherName: data.otherName, lines: Array.isArray(data.lines) ? data.lines.slice(-40) : [] });
        else this.listening.delete(data.callId);
        game.nightcity?.payphoneBooth?.renderListen?.();
        return;
      }
      case 'line': {
        const l = this.listening.get(data.callId);
        if (!l || !data.line?.text) return;
        l.lines.push(data.line); if (l.lines.length > 60) l.lines.shift();
        game.nightcity?.payphoneBooth?.renderListen?.();
        return;
      }
      default: return;
    }
  }

  // ═══════════════════════════════ the GM ═══════════════════════════════

  /**
   * GM: ring a booth as an NPC (a directory contact). The call comes from that NPC's number.
   * @param {string} id @param {{contactId?: string}} [as]
   */
  async ringAs(id, as = {}) {
    if (!isGM()) return null;
    const pp = this.get(id);
    if (!pp) return null;
    const res = await this.calls?.placeCall?.(pp.number, as);
    if (res && !res.ok) ncmNotify.warn(res.error || 'The call could not be placed.');
    return res;
  }

  /** The booth's own call log (GM): pages in the payphone log journal for this booth, newest first. */
  logOf(id) { return (this.calls?.payphoneLog?.() || []).filter((l) => l.me?.payphone === id); }
}

/**
 * Should a booth's bell stop (audit PERF-12)? When the call is gone or no longer ringing, or it has rung well past
 * the ring time (the call clears itself then, so this is only a backstop). Pure.
 */
export function ringShouldStop(call, startedMs, nowMs, ringMs = 30000) {
  if (!call || call.state !== 'ringing') return true;
  return nowMs - startedMs > (Number(ringMs) || 30000) + 10000;
}
