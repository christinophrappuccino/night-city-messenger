/**
 * Trauma Team and Lawman Backup: the calls.
 * @file scripts/services/EmergencyService.js
 * @module night-city-messenger
 * @description Spec dev/design/PHONE-REVISION.md §10, §17. The caller's client rolls real dice, plays the call and posts each
 *   chat card the moment its die lands. An emergency that is on its way lives in the world setting `phoneEmergencyActive`,
 *   written by the active GM (a player relays through SOCKET_OPS.CALL_EMERGENCY). Rounds follow the combat tracker when one is
 *   running, and on the clock outside combat (ROUND_MS); the GM can hold, skip or call off a team from Live.
 */

import { MODULE_ID, SOCKET_OPS, EVENTS } from '../utils/constants.js';
import { log, isGM, formatCyberDate, getSetting } from '../utils/helpers.js';
import { sanitizeEmergency, traumaPlan, traumaLine, backupArt, holdsItem, roleRank, backupOptions, backupDefault, backupResult, backupLook, autoCallDue, PLAN_NAMES, roundDue, orgForPerson, pickVoice, backupLayers, traumaLayers, BACKUP_SLOTS, TRAUMA_SLOTS } from '../utils/phoneEmergency.js';
import { specialList, specialKey } from '../utils/phoneNumbering.js';
import { isFeatureOn } from '../utils/features.js';

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class EmergencyService {
  constructor() { this.socket = game.nightcity.socketManager; }

  _get(key, fallback) { return getSetting(key, fallback); }
  /** On in this load? (utils/features.js — off when Calls is off too.) */
  get enabled() { return isFeatureOn('emergency'); }
  get config() { return sanitizeEmergency(this._get('phoneEmergency', {})); }
  active() { const a = this._get('phoneEmergencyActive', []); return Array.isArray(a) ? a : []; }
  async saveConfig(next) { if (!isGM()) return { ok: false, error: 'GM only' }; await game.settings.set(MODULE_ID, 'phoneEmergency', next); return { ok: true }; }

  /** The special number Trauma Team calls use: its dialled key, name, number and picture. */
  traumaLine() { return traumaLine(specialList(this._get('phoneSpecial', null)), this.config.trauma.specialId, specialKey); }

  // ─── who has what ───

  planFor(actor) { return actor ? traumaPlan(this.config, { actorId: actor.id, items: actor.items?.contents || [] }) : 'none'; }
  biomonitorOf(actor) { return holdsItem(actor?.items?.contents || [], this.config.trauma.bioItem); }
  rankOf(actor) { return roleRank(actor?.items?.contents || [], 'Lawman'); }
  orgOf(actor) { const c = this.config; const id = c.backup.chars[actor?.id]; return c.backup.orgs[id] ? id : (c.backup.orgs.book ? 'book' : Object.keys(c.backup.orgs)[0]); }
  optionsFor(actor) { return backupOptions(orgForPerson(this.config, this.orgOf(actor), actor?.id), this.rankOf(actor)); }
  defaultGroup(actor) { return backupDefault(orgForPerson(this.config, this.orgOf(actor), actor?.id), this.rankOf(actor)); }
  /** A plan is in use until the GM clears it. */
  planInUse(actorId) { return this.active().some((e) => e.kind === 'trauma' && e.payerId === actorId); }

  vitalsOf(actor) {
    const hp = actor?.system?.derivedStats?.hp;
    return { hp: Number(hp?.value) || 0, max: Number(hp?.max) || 0, body: Number(actor?.system?.stats?.body?.value) || 0 };
  }

  // ─── telling the GM ───

  /** A call really went out. Every GM hears about it, whoever is rolling and however the dice are hidden. */
  announce(info, { auto = false, here = false } = {}) {
    const data = { op: 'started', kind: info.kind, name: info.name, patient: info.patient || '', org: info.org || '', group: info.group || '', place: info.place || '', plan: PLAN_NAMES[info.plan] || '', auto };
    this.socket.emit(SOCKET_OPS.CALL_EMERGENCY, data);
    if (here && isGM()) this.gmAlert(data);
    this._callCard(info, { auto }).catch((e) => log.warn(`Emergency: call card failed: ${e.message}`));
  }

  /**
   * One chat card so the table knows it happened. It follows the caller's roll mode like the dice, so a whispered call stays
   * whispered. Later steps are not narrated: the dice cards and the arrival banner cover those.
   */
  async _callCard(info, { auto = false } = {}) {
    if (!this._get('emergencyChatCard', true)) return null;
    const trauma = info.kind === 'trauma';
    const line = trauma ? this.traumaLine().name : '';
    const forOther = trauma && info.patient && info.patient !== info.name;
    const title = !trauma ? `${info.name} is calling for backup`
      : auto ? `${info.patient || info.name}'s Biomonitor is calling ${line}`
      : forOther ? `${info.name} is calling ${line} for ${info.patient}` : `${info.name} is calling ${line}`;
    const sub = trauma ? info.place : [info.org, info.place].filter(Boolean).join(' · ');
    const when = (() => { try { return formatCyberDate(game.nightcity.timeService.getCurrentTime()); } catch { return ''; } })();
    const content = `<div class="ncm-cc ncm-cc--${trauma ? 'fail' : 'gm'}"><div class="ncm-cc__rec"><span class="ncm-cc__kind"><i class="fas ${trauma ? 'fa-truck-medical' : 'fa-shield-halved'}"></i> ${trauma ? 'Emergency call' : 'Backup call'}</span><span class="ncm-cc__time">${esc(when)}</span></div><div class="ncm-cc__hero"><i class="ncm-cc__tr"></i><i class="ncm-cc__bl"></i><div class="ncm-cc__subject">${esc(title)}<small>${esc(sub)}</small></div></div></div>`;
    const data = { content, speaker: ChatMessage.getSpeaker?.() };
    try { ChatMessage.applyRollMode?.(data, game.settings.get('core', 'rollMode')); } catch { /* the default */ }
    return ChatMessage.create(data);
  }

  /** What the GM sees: a toast they can act on and one short tone. World setting `notifyGmEmergency`. */
  gmAlert(d) {
    if (!isGM() || !this._get('notifyGmEmergency', true)) return;
    const trauma = d.kind === 'trauma';
    try { game.nightcity?.soundService?.play?.('em-alert'); } catch { /* sound is never worth failing a call */ }
    game.nightcity?.notificationService?.showToastV2?.({
      type: 'message', priority: 'urgent', icon: trauma ? 'fas fa-truck-medical' : 'fas fa-shield-halved',
      title: trauma ? (d.auto ? 'Trauma Team: Biomonitor alert' : 'Trauma Team called') : 'Backup called',
      detail: trauma ? `${d.patient || d.name} at ${d.place}${d.plan ? ` · ${d.plan} plan` : ''}${d.patient && d.patient !== d.name ? ` · called by ${d.name}` : ''}` : `${d.name} at ${d.place} · ${d.group ? `${d.org}: ${d.group}` : d.org}`,
      actionLabel: 'Live', onAction: () => game.nightcity?.openAdminTab?.('phone', { select: 'live' }),
      duration: 9000,
    });
  }

  // ─── dice and chat ───

  /** A real die. Waits for Dice So Nice, then the caller posts the card. */
  async _roll(formula) {
    const roll = await new Roll(formula).evaluate();
    await game.nightcity?.skillService?._showDice3d?.([roll]);
    return roll;
  }

  /** A preview's die: Dice So Nice shows the result the preview needs, on this screen only, with no chat card. */
  async showDie(formula, value) {
    const d3 = game.dice3d;
    if (!d3?.showForRoll) return;
    try {
      const roll = await new Roll(formula).evaluate();
      const die = roll.terms?.[0]?.results?.[0];
      if (die) { die.result = value; roll._total = value; }
      await Promise.race([d3.showForRoll(roll, game.user, false), new Promise((res) => setTimeout(res, 12000))]);
    } catch (e) { log.debug(`Emergency: preview die failed: ${e.message}`); }
  }

  /** A card in the module's chat family, following the player's roll mode. */
  async _chat({ tone = 'gm', kind, who, num, of = '', verdict, line = '', ro = [], roll = null }) {
    const when = (() => { try { return formatCyberDate(game.nightcity.timeService.getCurrentTime()); } catch { return ''; } })();
    const place = game.scenes?.viewed?.name || '';
    const content = `<div class="ncm-cc ncm-cc--${tone}"><div class="ncm-cc__rec"><span class="ncm-cc__kind">${esc(kind)}</span><span class="ncm-cc__time">${esc(when)}</span><span class="ncm-cc__sub"><span>${esc(who)}</span><span>${esc(place)}</span></span></div>`
      + `<div class="ncm-cc__hero"><i class="ncm-cc__tr"></i><i class="ncm-cc__bl"></i><div class="ncm-cc__numrow"><div class="ncm-cc__num">${esc(num)}${of !== '' ? `<small>/ ${esc(of)}</small>` : ''}</div><div class="ncm-cc__verdict">${esc(verdict)}<span>${esc(line)}</span></div></div></div>`
      + `<div class="ncm-cc__ro">${ro.map(([k, v]) => `<div><div class="ncm-cc__k">${esc(k)}</div><div class="ncm-cc__v">${esc(v)}</div></div>`).join('')}</div></div>`;
    const data = { content, speaker: ChatMessage.getSpeaker?.() };
    try { const mode = game.settings.get('core', 'rollMode'); ChatMessage.applyRollMode?.(data, mode); } catch { /* the default */ }
    void roll;
    return ChatMessage.create(data);
  }

  // ─── starting a call: the steps run on the caller's screen ───

  /** Pick up the phone. `patient` is who it is for; the plan is the caller's. */
  traumaInfo(actor, patient = actor) {
    const v = this.vitalsOf(patient), voice = pickVoice(TRAUMA_SLOTS, traumaLayers(this.config));
    return { kind: 'trauma', voice, arriveTitle: voice.arriveTitle, actorId: actor.id, name: actor.name, patientId: patient.id, patient: patient.name, onPlanOf: patient.id !== actor.id ? actor.name : '', plan: this.planFor(actor), payerId: actor.id, img: this.traumaLine().img, ...v, place: game.scenes?.viewed?.name || 'somewhere', sceneId: game.scenes?.viewed?.id || '' };
  }

  async rollTrauma(info, { auto = false } = {}) {
    const roll = await this._roll('1d6'), rounds = roll.total;
    await this._chat({ tone: 'gm', kind: 'Trauma Team', who: info.patient, num: rounds, verdict: 'Rounds out', line: 'First in the order on arrival', ro: [['Plan', PLAN_NAMES[info.plan]], ['1d6', rounds], ['Called by', auto ? 'Biomonitor' : info.name]], roll });
    return rounds;
  }

  backupInfo(actor, groupName = null) {
    const cfg = this.config, id = this.orgOf(actor), o = orgForPerson(cfg, id, actor.id), rank = this.rankOf(actor), person = cfg.backup.people?.[actor.id];
    const from = backupOptions(o, rank).find((r) => r.name === groupName) || backupDefault(o, rank);
    const look = backupLook(o?.kind, o?.look, person?.look), voice = pickVoice(BACKUP_SLOTS, backupLayers(cfg, id, actor.id));
    return { kind: 'backup', actorId: actor.id, name: actor.name, org: id === 'book' ? (from?.name || 'Backup') : (o?.name || 'Backup'), orgId: id, look, voice, lights: look.lights, color: look.color, arriveSound: look.arriveSound, arriveTitle: voice.arriveTitle, rank, group: from?.name || '', img: backupArt(o, from, person), from, place: game.scenes?.viewed?.name || 'somewhere', sceneId: game.scenes?.viewed?.id || '' };
  }

  async rollBackupAnswer(info) {
    const roll = await this._roll('1d10'), d10 = roll.total, ok = d10 <= info.rank;
    await this._chat({ tone: ok ? 'ok' : 'fail', kind: 'Backup', who: info.name, num: d10, of: info.rank, verdict: ok ? 'They answer' : 'Nobody free', line: ok ? info.group : 'Try again next Turn', ro: [['Rank', info.rank], ['1d10', d10]], roll });
    return d10;
  }

  async rollBackupRounds(info, d10) {
    const o = orgForPerson(this.config, info.orgId, info.actorId);
    const first = (await this._roll('1d6')).total;
    const second = first === 6 ? (await this._roll('1d6')).total : null;
    const res = backupResult(o, info.from, { d10, rank: info.rank, d6: first, second });
    await this._chat({ tone: 'gm', kind: 'Backup', who: info.name, num: res.rounds, verdict: 'Rounds out', line: res.who, ro: res.up ? [['First d6', first], ['Group', 'Next one up'], ['Second d6', second]] : [['1d6', first], ['Group', res.who]] });
    return res;
  }

  /** The team is on its way. */
  async register(info, rounds) {
    const row = { id: foundry.utils.randomID(), ...info, from: undefined, voice: undefined, look: undefined, left: rounds, rounds, at: Date.now(), combatRound: game.combat?.round ?? null };
    if (!isGM()) { this.socket.emit(SOCKET_OPS.CALL_EMERGENCY, { op: 'add', row }); return row; }
    await this._write([...this.active(), row]);
    return row;
  }

  async _write(list) {
    await game.settings.set(MODULE_ID, 'phoneEmergencyActive', list);
    game.nightcity?.eventBus?.emit?.(EVENTS.LINE_UPDATED, { number: null });
  }

  // ─── the GM moves them on ───

  async minusRound(id) {
    const e = this.active().find((x) => x.id === id);
    if (!e) return;
    if (e.left <= 1) return this.arrive(id);
    await this._write(this.active().map((x) => (x.id === id ? { ...x, left: x.left - 1 } : x)));
  }

  /** They arrive: everyone looking at that scene sees it. A plan stays in use until the job is over. */
  async arrive(id) {
    const e = this.active().find((x) => x.id === id);
    if (!e) return;
    const next = e.kind === 'trauma' ? this.active().map((x) => (x.id === id ? { ...x, left: 0, arrived: true } : x)) : this.active().filter((x) => x.id !== id);
    await this._write(next);
    const show = this.arrivalFor(e);
    this.socket.emit(SOCKET_OPS.CALL_EMERGENCY, { op: 'arrive', show });
    this._showArrival(show);
  }

  /** What the on scene banner needs, from an active row or a call's info. */
  arrivalFor(e) {
    return { kind: e.kind, sceneId: e.sceneId, place: e.place, org: e.org, group: e.group, img: e.img || '', lights: !!e.lights, name: e.patient || e.name, plan: PLAN_NAMES[e.plan] || '', color: e.color || '', arriveSound: e.arriveSound || '', arriveTitle: e.arriveTitle || '' };
  }

  async remove(id) { await this._write(this.active().filter((x) => x.id !== id)); }

  _showArrival(show) { if (!show.sceneId || game.scenes?.viewed?.id === show.sceneId) game.nightcity?.emergencyHud?.arrival(show); }

  /** Stop a team's countdown, or start it again. They stay on the way. */
  async toggleHold(id) { await this._write(this.active().map((x) => (x.id === id ? { ...x, held: !x.held } : x))); }

  /** Outside combat, count the rounds down on the clock. One GM does it; a reload just restarts the round in progress. */
  async tickRounds(now = Date.now()) {
    if (!isGM() || game.users.activeGM?.id !== game.user.id || this._ticking) return;
    this._ticking = true;
    try {
      this._tickAt ??= new Map();
      const combatOn = !!game.combat?.started, paused = !!game.paused, list = this.active();
      for (const id of [...this._tickAt.keys()]) if (!list.some((e) => e.id === id)) this._tickAt.delete(id);
      for (const e of list) {
        if (e.arrived) continue;
        // waiting does not bank rounds: they count from when the clock can run again
        if (!this._tickAt.has(e.id) || combatOn || paused || e.held) { this._tickAt.set(e.id, now); continue; }
        if (roundDue(e, { now, lastAt: this._tickAt.get(e.id), combatOn, paused })) { this._tickAt.set(e.id, now); await this.minusRound(e.id); }
      }
    } finally { this._ticking = false; }
  }

  /** A round of combat passed. */
  async onCombatRound() {
    if (!isGM() || game.users.activeGM?.id !== game.user.id) return;
    // Also a team called before the fight started: it would otherwise sit there until the GM moved it by hand.
    for (const e of this.active()) if (!e.arrived && !e.held) await this.minusRound(e.id);
  }

  /** HP dropped: a linked Biomonitor calls by itself, on the owner's screen when they are here. */
  async onHpChange(actor, wasHp) {
    if (!isGM() || game.users.activeGM?.id !== game.user.id) return;
    const v = this.vitalsOf(actor);
    const items = actor.items?.contents || [];
    if (!autoCallDue(this.config, { hp: v.hp, body: v.body, wasHp, items })) return;
    if (this.planFor(actor) === 'none' || this.planInUse(actor.id)) return;
    const owners = game.users.filter((u) => u.active && !u.isGM && actor.testUserPermission(u, 'OWNER'));
    if (owners.length) { this.socket.emit(SOCKET_OPS.CALL_EMERGENCY, { op: 'auto', actorId: actor.id, userId: owners[0].id }); return; }
    // nobody is at the screen: the call still goes out
    const info = this.traumaInfo(actor);
    this.announce(info, { auto: true, here: true });
    const rounds = await this.rollTrauma(info, { auto: true });
    await this.register({ ...info, auto: true }, rounds);
  }

  /** SOCKET_OPS.CALL_EMERGENCY */
  async handleSocket(data, senderId) {
    const fromGM = !!game.users?.get?.(senderId)?.isGM;
    // An arrival banner and an automatic Trauma call only ever come from a GM (audit SEC-22).
    if (data.op === 'arrive') { if (fromGM) this._showArrival(data.show || {}); return; }
    if (data.op === 'started') { if (senderId) this.gmAlert(this._cleanStarted(data)); return; }
    if (data.op === 'auto') { if (fromGM && data.userId === game.user.id) { const a = game.actors.get(data.actorId); if (a) game.nightcity?.emergencyHud?.trauma(a, a, { auto: true }); } return; }
    if (data.op !== 'add' || !isGM() || game.users.activeGM?.id !== game.user.id) return;
    const sender = game.users?.get?.(senderId), actor = game.actors.get(data.row?.actorId);
    if (!sender || !actor?.testUserPermission(sender, 'OWNER')) return;
    const row = this.cleanRow(data.row, actor);
    if (!row) { log.warn('Emergency: a tracker row that does not make sense was refused'); return; }
    await this._write([...this.active(), row]);
  }

  /** The GM's toast for a call: short text only (it is escaped when shown). */
  _cleanStarted(d = {}) {
    const s = (v) => String(v ?? '').slice(0, 80);
    return { op: 'started', kind: d.kind === 'trauma' ? 'trauma' : 'backup', name: s(d.name), patient: s(d.patient), org: s(d.org), group: s(d.group), place: s(d.place), plan: s(d.plan), auto: false };
  }

  /**
   * A player's tracker row, rebuilt from checked fields (audit SEC-22). The countdown is the
   * client's roll (the gameplay boundary) but held to a sane range, so a forged row cannot make
   * a team arrive at once or never; who it is for, and when, come from the GM's side.
   * @returns {object|null}
   */
  cleanRow(raw, actor) {
    const r = raw && typeof raw === 'object' ? raw : {};
    if (!['backup', 'trauma'].includes(r.kind)) return null;
    const s = (v, n) => String(v ?? '').slice(0, n);
    const rounds = Math.round(Number(r.rounds));
    if (!Number.isFinite(rounds) || rounds < 1 || rounds > 30) return null;
    // Plain values only (strings capped, finite numbers, booleans): the display fields, the patient's vitals.
    const out = {};
    for (const [k, v] of Object.entries(r)) {
      if (!/^[A-Za-z]\w{0,30}$/.test(k)) continue;
      if (typeof v === 'string') out[k] = s(v, 300);
      else if (typeof v === 'boolean') out[k] = v;
      else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    }
    if ('color' in out && !/^#[0-9a-f]{6}$/i.test(out.color)) out.color = '';
    // Who it is for, how long, and when: the GM's side decides.
    const patient = r.kind === 'trauma' && r.patientId ? game.actors.get(r.patientId) : null;
    Object.assign(out, {
      id: foundry.utils.randomID(), kind: r.kind, actorId: actor.id, name: actor.name,
      left: rounds, rounds, at: Date.now(), combatRound: game.combat?.round ?? null, held: false, arrived: false,
    });
    if (r.kind === 'trauma') Object.assign(out, { payerId: actor.id, patientId: patient?.id || actor.id, patient: (patient || actor).name, onPlanOf: patient && patient.id !== actor.id ? actor.name : '' });
    return out;
  }
}

/** Register the setting hooks once the service exists. */
export function wireEmergency(service) {
  setInterval(() => service.tickRounds().catch((e) => log.warn(`Emergency: ${e.message}`)), 1000);
  Hooks.on('updateCombat', (combat, changes) => { if (changes.round !== undefined) service.onCombatRound().catch((e) => log.warn(`Emergency: ${e.message}`)); });
  const was = new Map();
  Hooks.on('preUpdateActor', (actor, changes) => { if (changes?.system?.derivedStats?.hp?.value !== undefined) was.set(actor.id, service.vitalsOf(actor).hp); });
  Hooks.on('updateActor', (actor) => { if (!was.has(actor.id)) return; const w = was.get(actor.id); was.delete(actor.id); service.onHpChange(actor, w).catch((e) => log.warn(`Emergency: ${e.message}`)); });
}
