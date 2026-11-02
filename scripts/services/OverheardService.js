/**
 * Overheard calls: two NPCs on a call that plays whether or not anyone is listening.
 * @file scripts/services/OverheardService.js
 * @module night-city-messenger
 * @description Spec dev/design/PHONE-REVISION.md §12, §17. The active GM's client runs every call and works out what each listener
 *   gets, line by line, so a word they have not earned never leaves that client. Players join by choosing to: a prompt when in
 *   range, a tap, a node session, or a scanner. Written calls live in the world setting `overheardCalls`; a running call is held
 *   by the GM's client and ends if that client reloads.
 */

import { MODULE_ID, SOCKET_OPS } from '../utils/constants.js';
import { log, isGM, getPlayerCharacters, generateId } from '../utils/helpers.js';
import { typeOutMs } from '../utils/callModel.js';
import { holdsItem } from '../utils/phoneEmergency.js';
import { activeEffects, nodeIsUp } from '../utils/networkNodes.js';
import { sanitizeEavesdrop, sanitizeScript, waysFor, garbleFor, garbleLine, plainHeard } from '../utils/overheard.js';

export class OverheardService {
  constructor() {
    this.socket = game.nightcity.socketManager;
    /** @type {Map<string, object>} calls running on this client (GM) */
    this.runs = new Map();
    this._clock = null;
  }

  _get(key, fallback) { try { return game.settings.get(MODULE_ID, key); } catch { return fallback; } }
  get rules() { return sanitizeEavesdrop(this._get('phoneEavesdrop', {})); }
  async saveRules(next) { if (!isGM()) return { ok: false }; await game.settings.set(MODULE_ID, 'phoneEavesdrop', next); return { ok: true }; }
  scripts() { const s = this._get('overheardCalls', {}); return (Array.isArray(s?.scripts) ? s.scripts : []).map(sanitizeScript); }
  async saveScript(script) {
    if (!isGM()) return { ok: false, error: 'GM only' };
    const clean = sanitizeScript(script), list = this.scripts();
    const i = list.findIndex((x) => x.id === clean.id);
    if (i >= 0) list[i] = clean; else list.push(clean);
    await game.settings.set(MODULE_ID, 'overheardCalls', { scripts: list });
    return { ok: true, script: clean };
  }
  async deleteScript(id) { if (!isGM()) return { ok: false }; await game.settings.set(MODULE_ID, 'overheardCalls', { scripts: this.scripts().filter((x) => x.id !== id) }); return { ok: true }; }

  // ─── who could hear ───

  _itemsOf(actor) { return actor?.items?.contents || []; }

  /** Where a side stands, or null when nobody can be in the room with them. */
  _where(side) {
    if (!side?.sceneId || side.anchor === 'off') return null;
    if (side.anchor === 'spot') return { sceneId: side.sceneId, x: side.x, y: side.y };
    const scene = game.scenes?.get(side.sceneId), actorId = side.contactId ? game.nightcity?.masterContactService?.getContact?.(side.contactId)?.actorId : null;
    const t = actorId ? scene?.tokens?.find((x) => x.actorId === actorId) : null;
    return t ? { sceneId: side.sceneId, x: t.x, y: t.y } : { sceneId: side.sceneId, x: side.x, y: side.y, noToken: true };
  }

  /** The facts `waysFor` reads, from the map, the sheet and the nodes. */
  factsFor(actor, c) {
    const r = this.rules, items = this._itemsOf(actor), ns = game.nightcity?.networkService;
    const here = (side) => { const w = this._where(c[side]); if (!w) return null; const scene = game.scenes?.get(w.sceneId); const t = scene?.tokens?.find((x) => x.actorId === actor.id && !x.hidden); if (!t) return null; const size = scene.grid?.size || 100; return { side, dist: w.noToken ? Infinity : Math.hypot(t.x - w.x, t.y - w.y) / size, sceneWide: w.noToken }; };
    const a = here('a'), b = here('b');
    const best = a && b ? (a.dist <= b.dist ? a : b) : (a || b);
    const scenes = [c.a?.sceneId, c.b?.sceneId].filter(Boolean);
    let tap = null, jack = null;
    const now = ns?._nowMs?.() ?? Date.now();
    for (const n of ns?.getNodes?.({ networkId: c.net }) || []) {
      if (!scenes.includes(n.sceneId) || !nodeIsUp(n, now)) continue;
      if (activeEffects(n, 'taps', now).some((e) => e.actorId === actor.id)) tap = { node: n.name, nodeId: n.id };
      if ((n.runs || []).some((x) => x.actorId === actor.id && x.open)) jack = { node: n.name, nodeId: n.id };
    }
    return { here: best?.side || null, dist: best ? best.dist : Infinity, tap, jack, hasAmp: !!holdsItem(items, r.amp)?.counts, hasScanner: !!holdsItem(items, r.scanner)?.counts, hasDesc: !!holdsItem(items, r.desc)?.counts };
  }

  waysOf(actor, c) { return waysFor(this.factsFor(actor, c), c, this.rules); }

  // ─── running a call ───

  /** Start it. It plays whether or not anyone is listening. */
  start(script) {
    if (!isGM()) return null;
    const c = sanitizeScript(script);
    const run = { id: generateId(), script: c, idx: -1, playing: !c.live, ended: false, listeners: new Map(), asked: new Set(), clickAt: null, timer: null, startedAt: Date.now() };
    this.runs.set(run.id, run);
    this._offer(run);
    if (!c.live) this._advance(run);
    this._changed();
    return run;
  }

  _changed() { game.nightcity?.eventBus?.emit?.('call:overheard', {}); }

  _advance(run) {
    clearTimeout(run.timer);
    if (run.ended) return;
    if (run.idx >= run.script.lines.length - 1) { if (!run.script.live) this.end(run.id); return; }
    run.idx += 1;
    this._sendLine(run, run.idx);
    this._offer(run);
    this._changed();
    if (run.playing) this._schedule(run);
  }

  _schedule(run) {
    clearTimeout(run.timer);
    const cur = run.script.lines[run.idx], next = run.script.lines[run.idx + 1];
    run.timer = setTimeout(() => this._advance(run), typeOutMs(cur?.text || '') + 900 + (next?.delay || 0) * 1000);
  }

  setPlaying(id, on) { const run = this.runs.get(id); if (!run || run.ended) return; run.playing = !!on; clearTimeout(run.timer); if (on) this._schedule(run); this._changed(); }
  next(id) { const run = this.runs.get(id); if (run) this._advance(run); }
  jump(id, i) { const run = this.runs.get(id); if (!run || run.ended) return; run.idx = Math.max(-1, Math.min(run.script.lines.length - 1, i - 1)); this._advance(run); }

  /** I type it live: a new line, sent as it is written. */
  say(id, side, text, voice = 'text') {
    const run = this.runs.get(id); if (!run || run.ended || !String(text).trim()) return;
    run.script.lines.push({ id: generateId(), side: side === 'b' ? 'b' : 'a', text: String(text).slice(0, 500), voice, delay: 0, marks: [], means: '' });
    run.idx = run.script.lines.length - 1;
    this._sendLine(run, run.idx);
    this._changed();
  }

  /** End the call. Listeners see it end. It can leave a trail on terminals. */
  async end(id) {
    const run = this.runs.get(id); if (!run || run.ended) return;
    run.ended = true; clearTimeout(run.timer);
    for (const l of run.listeners.values()) this._to(l.userId, { op: 'ended', runId: id });
    const c = run.script;
    if (c.rec && this.rules.records) {
      const secs = Math.round((Date.now() - run.startedAt) / 1000), side = (s) => ({ contactId: s.contactId, actorId: game.nightcity?.masterContactService?.getContact?.(s.contactId)?.actorId || null, name: s.shows === 'anon' ? '' : s.name, number: s.shows === 'name' || s.shows === 'number' ? s.number : '' });
      try { await game.nightcity?.terminalService?.mirrorCallToAccounts?.({ callId: `over-${id}`, from: side(c.a), to: side(c.b), outcome: 'answered', seconds: secs, gameTime: game.nightcity?.timeService?.getCurrentTime?.() }); } catch (err) { log.warn(`Overheard: record: ${err.message}`); }
    }
    this._changed();
  }

  /** Every listener sees it. Then play out what the NPCs do. */
  click(id) { const run = this.runs.get(id); if (!run) return; run.clickAt = run.idx; for (const l of run.listeners.values()) this._to(l.userId, { op: 'click', runId: id }); this._changed(); }

  /** Drop one listener. With a trace, that fires with its heat. */
  cut(id, userId, { trace = false } = {}) {
    const run = this.runs.get(id), l = run?.listeners.get(userId); if (!l) return;
    run.listeners.delete(userId);
    this._to(userId, { op: 'cut', runId: id });
    const actor = game.actors?.get(l.actorId);
    if (trace && actor) game.nightcity?.traceService?.fireTrace?.({ actor, action: 'overheard', source: run.script.name, severity: 'major' });
    this._changed();
  }

  _to(userId, payload) {
    if (userId === game.user.id) return this.handleSocket(payload, game.user.id);
    this.socket.emit(SOCKET_OPS.CALL_OVERHEARD, { ...payload, userIds: [userId] });
  }

  /** What one listener gets for one line. The real word stays here unless they earned it. */
  lineFor(run, l, i) {
    const x = run.script.lines[i]; if (!x) return null;
    const actor = game.actors?.get(l.actorId), items = this._itemsOf(actor), r = this.rules;
    const g = garbleFor(l, x.side, i, { enc: run.script.enc, hasDesc: !!holdsItem(items, r.desc)?.counts });
    const sideDoc = run.script[x.side];
    if (g === null) return { i, id: x.id, who: 'Other side', html: null };
    return { i, id: x.id, who: sideDoc.shows === 'name' ? sideDoc.name : x.side === 'a' ? 'Side A' : 'Side B', html: garbleLine(x.id, x.text, g), g,
      stress: g < 100 && x.marks.includes('lie') && !!holdsItem(items, r.stress)?.counts, tts: (x.voice || sideDoc.voice) === 'tts' };
  }

  _sendLine(run, i) { for (const l of run.listeners.values()) { const line = this.lineFor(run, l, i); if (line) { l.heard.set(i, line); this._to(l.userId, { op: 'line', runId: run.id, line }); } } }

  /** Prompts: a choice the player makes, once per call and way. Never automatic. */
  _offer(run) {
    if (run.ended) return;
    for (const pc of getPlayerCharacters()) {
      const actor = pc.actor; if (!actor) continue;
      const user = game.users.find((u) => u.active && !u.isGM && actor.testUserPermission(u, 'OWNER'));
      if (!user || run.listeners.has(user.id)) continue;
      for (const w of this.waysOf(actor, run.script).ways) {
        if (!['room', 'tap'].includes(w.k)) continue;
        const key = `${actor.id}:${w.k}`;
        if (run.asked.has(key)) continue;
        run.asked.add(key);
        this._to(user.id, { op: 'prompt', runId: run.id, way: w.k, text: w.text, actorId: actor.id });
      }
    }
  }

  /** A token moved: walking up mid-call asks. */
  onTokenMoved() { if (isGM() && game.users.activeGM?.id === game.user.id) for (const run of this.runs.values()) this._offer(run); }

  _callerLabel(run, l) {
    for (const s of ['a', 'b']) { if (l.ways.room !== undefined && l.side !== s) continue; const d = run.script[s]; if (d.shows === 'name') return d.name; if (d.shows === 'number' && d.number) return d.number; }
    return 'Unknown caller';
  }

  /** A listener joins by one way. Checked here, not on their client. */
  _join(run, userId, actorId, way) {
    const actor = game.actors?.get(actorId), user = game.users?.get(userId);
    if (!actor || !user || !actor.testUserPermission(user, 'OWNER') || run.ended) return false;
    const found = this.waysOf(actor, run.script).ways.find((w) => w.k === way);
    if (!found) return false;
    let l = run.listeners.get(userId);
    const fresh = !l;
    if (!l) { l = { userId, actorId, name: actor.name, ways: {}, side: null, enhance: 0, line: Math.max(0, run.idx), heard: new Map() }; run.listeners.set(userId, l); }
    if (l.ways[way] === undefined) l.ways[way] = Math.max(0, run.idx);
    if (found.side) l.side = found.side;
    this._to(userId, { op: 'joined', runId: run.id, label: this._callerLabel(run, l), net: run.script.net, from: l.line, fresh, skill: this.rules.skill, dv: this.rules.dv });
    if (run.idx >= 0) { const line = this.lineFor(run, l, run.idx); if (line) { l.heard.set(run.idx, line); this._to(userId, { op: 'line', runId: run.id, line }); } }
    this._changed();
    return true;
  }

  /** Which running call a way reaches for this character. */
  _firstRunFor(actor, way) {
    for (const run of this.runs.values()) if (!run.ended && this.waysOf(actor, run.script).ways.some((w) => w.k === way)) return run;
    return null;
  }

  /** Saved to EXFIL as an audio log, as garbled as it was heard, from the line they joined on. */
  async _save(run, l) {
    const repo = game.nightcity?.messageRepository; if (!repo) return false;
    const lines = [...l.heard.entries()].sort((a, b) => a[0] - b[0]).map(([, x]) => ({ speaker: x.who, text: x.html === null ? "[can't hear this side]" : plainHeard(x.html) }));
    const res = await repo.createMessage(l.actorId, { messageId: generateId(), subject: `Intercept: ${this._callerLabel(run, l)}`, from: 'intercept', to: '', body: '', contentType: 'avlog', contentData: { mediaType: 'audio', source: 'Intercept', transcript: lines }, status: { read: false }, eddies: 0,
      timestamp: game.nightcity?.timeService?.getCurrentTime?.() || new Date().toISOString(), metadata: { recovered: true, recoveredFrom: `INTERCEPT · ${run.script.net}`, recoveredTo: '', recoveredAt: new Date().toISOString() } });
    return !!res?.success;
  }

  // ─── a player's client asks ───

  /** Listen to traffic in a node session. The roll and the move are the console's. */
  async listenFromNode(actor) { return this._ask({ op: 'join', way: 'jack', actorId: actor.id }); }
  async scan(actor) { return this._ask({ op: 'join', way: 'scanner', actorId: actor.id }); }
  join(runId, way, actorId) { return this._ask({ op: 'join', runId, way, actorId }); }
  leave(runId) { return this._ask({ op: 'leave', runId }); }
  enhanceBy(runId, amount) { return this._ask({ op: 'enhance', runId, amount }); }
  saveHeard(runId) { return this._ask({ op: 'save', runId }); }

  _ask(data) {
    if (isGM()) return this.handleSocket(data, game.user.id);
    if (!game.users.activeGM) { ui.notifications?.warn('No GM is online.'); return false; }
    this.socket.emit(SOCKET_OPS.CALL_OVERHEARD, data);
    return true;
  }

  /** SOCKET_OPS.CALL_OVERHEARD */
  async handleSocket(data, senderId) {
    if (Array.isArray(data.userIds) && !data.userIds.includes(game.user.id)) return;
    const hud = game.nightcity?.overheardHud;
    switch (data.op) {
      case 'prompt': case 'joined': case 'line': case 'ended': case 'click': case 'cut': case 'none': case 'saved': return hud?.receive(data);
      default: break;
    }
    if (!isGM() || game.users.activeGM?.id !== game.user.id) return;
    const run = data.runId ? this.runs.get(data.runId) : null, l = run?.listeners.get(senderId);
    if (data.op === 'join') {
      const actor = game.actors?.get(data.actorId);
      const target = run || (actor ? this._firstRunFor(actor, data.way) : null);
      if (!target || !this._join(target, senderId, data.actorId, data.way)) this._to(senderId, { op: 'none', way: data.way });
    } else if (data.op === 'leave' && l) { run.listeners.delete(senderId); this._changed(); }
    else if (data.op === 'enhance' && l) {
      l.enhance = Math.min(100, (l.enhance || 0) + Math.max(0, Number(data.amount) || 0));
      for (const i of l.heard.keys()) { const line = this.lineFor(run, l, i); if (line) { l.heard.set(i, line); this._to(senderId, { op: 'line', runId: run.id, line, again: true }); } }
      this._changed();
    } else if (data.op === 'save' && l) { const ok = await this._save(run, l); this._to(senderId, { op: 'saved', runId: run.id, ok }); }
  }

  /** Scheduled calls start on the game clock. */
  tick() {
    if (!isGM() || game.users.activeGM?.id !== game.user.id) return;
    const now = Date.parse(game.nightcity?.timeService?.getCurrentTime?.() || '') || 0;
    for (const c of this.scripts()) {
      if (!c.at || !now || Date.parse(c.at) > now) continue;
      this.start(c);
      this.saveScript({ ...c, at: '' });
    }
  }

  wire() {
    Hooks.on('updateToken', () => this.onTokenMoved());
    this._clock = setInterval(() => this.tick(), 15000);
  }
}
