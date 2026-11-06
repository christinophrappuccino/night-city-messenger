/**
 * Admin → Phone (COMMS) — the GM's side of calls.
 * @file scripts/ui/AdminPanel/tabs/PhoneTab.js
 * @module night-city-messenger
 * @description Mock dev/mockups/admin-phone-mock.html, design dev/design/CALLS.md §10. Four views: LIVE (NPC lines
 *   ringing for the GM — answer as the identity, decline — and the switchboard of every call in the world, with Drop),
 *   NUMBERS (every character and directory contact with a line; give, change, take away), CALL LOG (every call, by day)
 *   and SETTINGS (how calls work at this table). Gathering lives here, the rules in phoneModel.js. Context key `phone2`,
 *   built only while the tab is on screen. Voicemail and transcripts are phase 2 (CALLS.md §11).
 */

import { ncmNotify } from '../../../utils/notify.js';
import { networkLoad } from '../../../utils/callNet.js';
import { BaseTab } from '../BaseTab.js';
import { MODULE_ID } from '../../../utils/constants.js';
import { getPlayerCharacters, formatCyberDate, resolveDisplayPortrait } from '../../../utils/helpers.js';
import { showNamePicker } from '../../../utils/namePicker.js';
import { themedConfirm } from '../../../utils/adminTheme.js';
import { dialogBodyHtml } from '../../../utils/dialogBody.js';
import { formatDuration } from '../../../utils/callModel.js';
import { parseNumber, rowOf, orgKey } from '../../../utils/phoneNumbering.js';
import { ScopePicker } from '../../../utils/scopePicker.js';
import { DateRangePicker } from '../../components/DateRangePicker.js';
import { SettingsConfigClass } from '../../../utils/compat.js';
import { isFeatureOn } from '../../../utils/features.js';
import { PHONE_VIEWS, NAV_PARENT, logLanding, LOG_FILTERS, LOG_GROUPS, VM_SHOW, VM_GROUPS, QUEUE_SHOW, callQueue, liveBoard, logView, settingsView, voicemailBoxes } from './phoneModel.js';
import { PLAN_NAMES } from '../../../utils/phoneEmergency.js';
import { numbersHtml, wireNumbers, closeNumbers, newNumberState, syncFrame, requestCount } from './phoneNumbersView.js';
import { payphonesHtml, wirePayphones, newPayphoneState } from './payphonesView.js';
import { GREETING_KINDS, GREETING_LABELS, DEFAULT_GREETING, GREETING_MAX } from '../../../utils/voicemail.js';
import { speak, voices, canSpeak } from '../../Calls/speech.js';
import { VoiceRecorder, micStatus, blobToBase64, playAudio } from '../../Calls/recorder.js';
import { adminDialog } from '../../../utils/adminTheme.js';

/** The four call switches are features (utils/features.js): each reloads the world, so a change asks first. */
const FEATURE_KEYS = ['callsEnabled', 'payphonesEnabled', 'emergencyEnabled', 'overheardEnabled'];
const SETTING_KEYS = [...FEATURE_KEYS, 'callModes', 'callDefaultMode', 'callRingSeconds', 'callUnknownNumbers', 'callTranscriptNotice',
  'voicemailRecording', 'voicemailMaxSeconds', 'voicemailKeepDays'];

/** Why the GM dropped a call — shown on both ends under "Call dropped". */
const DROP_REASONS = [
  ['signal', 'The signal broke up', 'fas fa-signal'],
  ['jam', 'The line was jammed', 'fas fa-tower-broadcast'],
  ['dead', 'Dead zone — no signal', 'fas fa-ban'],
  ['cut', 'The line went dead', 'fas fa-plug-circle-xmark'],
  ['traced', 'Someone traced the call', 'fas fa-crosshairs'],
];

const nowIso = () => { try { return game.nightcity?.timeService?.getCurrentTime?.() || new Date().toISOString(); } catch { return new Date().toISOString(); } };
const dayText = (d) => formatCyberDate(`${d}T12:00:00.000Z`, { dateOnly: true });

export class PhoneTab extends BaseTab {
  get key() { return 'phone'; }

  constructor(app) {
    super(app);
    this._view = 'live';
    this._logQ = '';
    this._logFilter = 'all';
    this._logGroup = 'date';
    this._logFrom = '';
    this._logTo = '';
    this._logMenu = false;
    this._limits = {};
    this._vmQ = '';
    this._vmShow = 'all';
    this._vmGroup = 'box';
    /** Select mode on the Call log and Voicemail lists (tester round 2026-11-06): on/off, what is ticked, the last tick (Shift ranges) */
    this._pick = { log: { on: false, set: new Set(), anchor: null }, vm: { on: false, set: new Set(), anchor: null } };
    this._shut = new Set();
    this._open = new Set();
    this._tick = null;
    /** calls whose typed lines the GM is following on the switchboard */
    this._listen = new Set();
    /** the number screens' own state (phoneNumbersView.js) */
    this._pn = newNumberState();
    this._qFilt = 'all';
    this._qOpen = null;
  }

  get calls() { return game.nightcity?.callService; }

  /** Open on a view from openAdminTab('phone', { select: 'numbers' | 'log' | 'vm' | 'settings' | 'live' | { log: target } | { person: id } }). */
  openTo(select) {
    if (select === 'vm') this._view = 'vm';
    else if (PHONE_VIEWS.some(([k]) => k === select)) { this._view = select; syncFrame(this, select); }
    else if (select?.person) { this._view = 'numbers'; this._pn.f = 'numbers'; this._pn.sel = select.person; this._pn.show = 'all'; this._pn.q = ''; }
    else if (typeof select === 'string' && select.startsWith('payphone:')) { this._view = 'payphones'; (this._pp ??= newPayphoneState()).sel = select.slice(9); }
    else if (select?.log) { this._view = 'logedit'; this._pn.f = 'editlog'; this._pn.lgT = select.log; this._pn.lgE = null; }
  }

  // ═══════════════════════════════ context ═══════════════════════════════

  prepareContext() {
    if (this.app._activeTab !== 'phone') return { phone2: null };
    const s = this.calls;
    if (!s) return { phone2: { missing: true } };
    const ctx = {
      view: this._view, enabled: s.enabled, isPopout: !!this.app.isPopout,
      // which parts of calls are off in this load (a part needs Calls on too)
      partsOff: s.enabled ? [['payphones', 'Payphones'], ['emergency', 'Emergency lines'], ['overheard', 'Overheard calls']].filter(([k]) => !isFeatureOn(k)).map(([, l]) => l) : [],
      viewOff: (this._view === 'payphones' && !isFeatureOn('payphones')) ? 'Payphones are switched off: players see every booth as out of order. You can still edit them here.'
        : (this._view === 'overheard' && !isFeatureOn('overheard')) ? 'Overheard calls are switched off: nothing can be overheard. You can still write scripts here.' : '',
      nav: PHONE_VIEWS.map(([key, label, icon]) => ({ key, label, icon, on: key === (NAV_PARENT[this._view] || this._view) })),
    };
    const mcs = game.nightcity?.masterContactService;
    try {
      // LIVE is cheap and drives the nav count, so it is always built
      const live = liveBoard(s.allCalls(), {
        now: Date.now(), ringMs: s.ringMs, ringsForMe: (c) => s._ringsHere(c), roleOf: (c) => s._role(c),
        voiceOf: (id) => mcs?.getContact?.(id)?.voice || '', listening: this._listen,
      });
      for (const id of [...this._listen]) if (!s.calls.has(id)) this._listen.delete(id);
      ctx.nav.find((n) => n.key === 'live').count = live.ringing.length || live.lines.length || 0;
      ctx.nav.find((n) => n.key === 'live').hot = live.ringing.length > 0;
      // voicemail: the nav counts unheard messages left for NPCs (the ones only the GM can pick up)
      const vmb = voicemailBoxes(s.allVoicemails?.() || [], {
        ownerName: (v) => (v.ownerIsContact ? mcs?.getContact?.(v.ownerId)?.name : game.actors?.get(v.ownerId)?.name) || v.to?.name || 'Unknown',
        isNpc: (v) => v.ownerIsContact || !game.actors?.get(v.ownerId)?.hasPlayerOwner,
        fmt: (t) => formatCyberDate(t), shut: this._shut, open: this._open,
        q: this._vmQ, show: this._vmShow, group: this._vmGroup, limits: this._limits, now: nowIso(),
        fmtDay: dayText, fmtTime: (t) => formatCyberDate(t, { timeOnly: true }),
      });
      // voicemail lives inside the Call log, so its waiting count rides that button
      const vmNav = ctx.nav.find((n) => n.key === 'log');
      if (vmNav) { vmNav.count = vmb.npcUnheard; vmNav.hot = vmb.npcUnheard > 0; }
      this._unheard = vmb.npcUnheard;
      ctx.logTabs = [['log', 'Calls', 'fa-list'], ['vm', 'Voicemail', 'fa-voicemail']].map(([key, label, icon]) => ({ key, label, icon, on: key === this._view, count: key === 'vm' ? vmb.npcUnheard : 0 }));
      if (this._view === 'vm') {
        this._order = { ...(this._order || {}), vm: vmb.keys };
        const pk = this._pickView('vm', vmb.keys);
        for (const g of vmb.groups) for (const d of (g.days || [])) for (const r of d.rows) { r.picking = pk.on; r.picked = pk.on && this._pick.vm.set.has(r.key); }
        ctx.vm = { ...vmb, pick: pk, q: this._vmQ, showing: this._vmShow !== 'all', found: `${vmb.shownCount} of ${vmb.total} messages`,
          showOptions: VM_SHOW.map(([k, l]) => ({ k, l, on: k === this._vmShow })), groupOptions: VM_GROUPS.map(([k, l]) => ({ k, l, on: k === this._vmGroup })) };
      }
      if (this._view === 'live') {
        ctx.live = { ...live, emergencies: (game.nightcity?.emergencyService?.active?.() || []).map((e) => ({ ...e, isTrauma: e.kind === 'trauma', who: e.kind === 'trauma' ? e.patient : e.name, word: e.kind === 'trauma' ? `${PLAN_NAMES[e.plan] || ''} plan` : e.org,
          detail: e.kind === 'trauma' ? `HP ${e.hp}/${e.max} · ${e.place}${e.onPlanOf ? ` · on ${e.onPlanOf}'s plan` : ''}` : `${e.group} · ${e.place}` })) };
        ctx.load = this._load(s);
        ctx.queue = callQueue(live.ringing, { filter: this._qFilt, open: this._qOpen, kindOf: (c) => this._queueKind(c) });
        ctx.queueShow = QUEUE_SHOW.map(([k, l]) => ({ k, l, on: k === this._qFilt }));
        ctx.active = live.lines.find((c) => c.mine && c.state === 'live') || null;
        ctx.overheard = [...(game.nightcity?.overheardService?.runs?.values() || [])].filter((r) => !r.ended).map((r) => ({ id: r.id, name: r.script.name, a: r.script.a.name, b: r.script.b.name, line: r.idx + 1, of: r.script.lines.length, listening: r.listeners.size, faces: [...r.listeners.values()].map((l) => ({ name: l.name, ini: String(l.name).split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() })) }));
      }

      const numNav = ctx.nav.find((n) => n.key === 'numbers');
      if (numNav) { numNav.count = requestCount(this); numNav.hot = numNav.count > 0; }
      if (this._view === 'numbers' || this._view === 'setup' || this._view === 'overheard' || this._view === 'logedit') { syncFrame(this, this._view); ctx.numbersHtml = numbersHtml(this); }
      if (this._view === 'payphones') ctx.payphonesHtml = payphonesHtml(this);
      if (this._view === 'log') {
        const whoId = this.scopeId('logwho'), netId = this.scopeId('lognet');
        const who = ScopePicker.value(whoId)[0] || '', net = ScopePicker.value(netId)[0] || '';
        const v = logView(s.allLogs(), {
          q: this._logQ, filter: this._logFilter, who, net, from: this._logFrom, to: this._logTo, group: this._logGroup,
          now: nowIso(), shut: this._shut, open: this._open, limits: this._limits,
          fmtDay: dayText,
          fmtTime: (t) => formatCyberDate(t, { timeOnly: true }), fmtWhen: (t) => formatCyberDate(t),
        });
        const pills = [who && { k: 'who', text: who }, net && { k: 'net', text: net }, (this._logFrom || this._logTo) && { k: 'dates', text: `${this._logFrom || '…'} to ${this._logTo || '…'}` }].filter(Boolean);
        this._order = { ...(this._order || {}), log: v.ids };
        const pk = this._pickView('log', v.ids);
        for (const b of v.bands) for (const d of b.days) for (const r of d.rows) { r.picking = pk.on; r.picked = pk.on && this._pick.log.set.has(r.id); }
        ctx.log = { ...v, pick: pk, q: this._logQ, menu: this._logMenu, pills, filterCount: pills.length, found: `${v.total} of ${v.of} calls`,
          resultOptions: LOG_FILTERS.map(([k, l]) => ({ k, l: `${l} (${v.counts[k] || 0})`, on: k === this._logFilter })),
          groupOptions: LOG_GROUPS.map(([k, l]) => ({ k, l, on: k === this._logGroup })),
          whoPicker: ScopePicker.html(whoId, { noun: 'person', nouns: 'people', icon: 'fa-user', allLabel: 'Anyone', items: v.people.map((name) => ({ id: name, name })) }),
          netPicker: ScopePicker.html(netId, { noun: 'network', nouns: 'networks', icon: 'fa-wifi', allLabel: 'Any network', items: v.networks.map((name) => ({ id: name, name })) }) };
      }
      if (this._view === 'settings') {
        const vals = Object.fromEntries(SETTING_KEYS.map((k) => { try { return [k, game.settings.get(MODULE_ID, k)]; } catch { return [k, undefined]; } }));
        ctx.settings = settingsView(vals, { modesAvailable: ['loud', 'type', 'dictate'] });
        const recs = (s.allVoicemails?.() || []).filter((v) => v.kind === 'audio' && v.audio);
        ctx.settings.recordings = recs.length;
        ctx.settings.recordingsInline = recs.filter((v) => String(v.audio).startsWith('data:')).length;
      }
    } catch (err) {
      console.error('NCM | Phone tab:', err);
      ctx.error = err.message;
    }
    return { phone2: ctx };
  }

  // ═══════════════════════════════ DOM ═══════════════════════════════

  onRender() {
    const root = this.element?.querySelector('.ncm-ph2');
    if (!root) return;
    wireNumbers(this, root);
    wirePayphones(this, root);
    // searches re-render after a pause (never per key)
    root.querySelectorAll('select[data-ph-qfilt]').forEach((sel) => sel.addEventListener('change', () => { this._qFilt = sel.value; this.app.render(); }));
    root.querySelectorAll('[data-ph-q]').forEach((q) => q.addEventListener('input', () => {
      clearTimeout(this._qT);
      this._qT = setTimeout(() => {
        if (q.dataset.phQ === 'vm') this._vmQ = q.value; else this._logQ = q.value;
        this.app.render();
      }, 220);
    }));
    // the log + voicemail controls
    root.querySelector('select[data-ph-logresult]')?.addEventListener('change', (e) => { this._logFilter = e.target.value; this.app.render(); });
    root.querySelector('select[data-ph-loggroup]')?.addEventListener('change', (e) => { this._logGroup = e.target.value; this.app.render(); });
    root.querySelector('select[data-ph-vmshow]')?.addEventListener('change', (e) => { this._vmShow = e.target.value; this.app.render(); });
    root.querySelector('select[data-ph-vmgroup]')?.addEventListener('change', (e) => { this._vmGroup = e.target.value; this.app.render(); });
    const menu = root.querySelector('details[data-ph-logmenu]');
    menu?.addEventListener('toggle', () => { this._logMenu = menu.open; });
    for (const name of ['logwho', 'lognet']) {
      const id = this.scopeId(name);
      // it also fires when the list opens: only a real change re-renders
      this._pickWas ??= {};
      this._pickWas[id] = ScopePicker.value(id)[0] || '';
      ScopePicker.on(id, (v) => { const now = v?.[0] || ''; if (now !== this._pickWas[id]) { this._pickWas[id] = now; this.app.render(); } });
    }
    ScopePicker.after();
    // settings write as they change
    root.querySelectorAll('[data-ph-set]').forEach((el) => el.addEventListener('change', () => this._saveSetting(el)));
    // folds: DOM only
    root.querySelectorAll('[data-ph-fold]').forEach((h) => h.addEventListener('click', (ev) => {
      if (ev.target.closest('button')) return;
      const g = h.closest('[data-ph-group]');
      if (!g) return;
      const key = g.dataset.phGroup;
      const shut = !g.classList.contains('is-shut');
      g.classList.toggle('is-shut', shut);
      h.setAttribute('aria-expanded', String(!shut));
      if (shut) { this._shut.add(key); this._open.delete(key); } else { this._open.add(key); this._shut.delete(key); }
    }));
    // timers + ring clocks tick on the live DOM
    clearInterval(this._tick);
    if (root.querySelector('[data-ph-since], [data-ph-ring]')) {
      const ringMs = this.calls?.ringMs || 30000;
      const step = () => {
        if (!root.isConnected) { clearInterval(this._tick); return; }
        const now = Date.now();
        root.querySelectorAll('[data-ph-since]').forEach((el) => { el.textContent = formatDuration(Math.max(0, Math.round((now - Number(el.dataset.phSince)) / 1000))); });
        root.querySelectorAll('[data-ph-ring]').forEach((el) => {
          const t0 = Number(el.dataset.phRing);
          el.style.setProperty('--p', `${Math.min(100, Math.max(0, (now - t0) / ringMs * 100))}%`);
          const left = el.parentElement?.querySelector('[data-ph-left]');
          if (left) left.textContent = `${Math.max(0, Math.round((ringMs - (now - t0)) / 1000))} s`;
        });
      };
      this._tick = setInterval(step, 1000);
    }
  }

  onClose() {
    clearInterval(this._tick);
    clearTimeout(this._qT);
    closeNumbers(this);
  }

  // ═══════════════════════════════ actions ═══════════════════════════════

  /**
   * What the Select bar needs. Ticks that left the list (deleted, filtered out) are dropped first.
   * @param {'log'|'vm'} which @param {string[]} keys — every key the filters leave, all pages
   */
  _pickView(which, keys = []) {
    const p = this._pick[which], here = new Set(keys);
    for (const k of [...p.set]) if (!here.has(k)) p.set.delete(k);
    return { on: p.on, count: p.set.size, none: !p.set.size, total: keys.length, all: keys.length > 0 && keys.every((k) => p.set.has(k)) };
  }

  /** Tick or untick one row; Shift ticks the range from the last one, in list order. */
  _pickToggle(which, key, range = false) {
    const p = this._pick[which], order = this._order?.[which] || [];
    const a = range && p.anchor ? order.indexOf(p.anchor) : -1, b = order.indexOf(key);
    if (a >= 0 && b >= 0) { const [lo, hi] = a < b ? [a, b] : [b, a]; for (const k of order.slice(lo, hi + 1)) p.set.add(k); }
    else if (p.set.has(key)) p.set.delete(key);
    else p.set.add(key);
    p.anchor = key;
  }

  /** Delete what is ticked, after a confirm that says how many and what it means. */
  async _pickDelete(which) {
    const p = this._pick[which], n = p.set.size, s = this.calls;
    if (!n || !s) return;
    const log = which === 'log';
    const ok = await themedConfirm({ title: log ? 'Delete calls' : 'Delete voicemail', bad: true, yes: 'Delete', yesIcon: 'fas fa-trash',
      content: dialogBodyHtml({ tone: 'bad', icon: log ? 'fas fa-phone-slash' : 'fas fa-voicemail', title: `Delete ${n} ${log ? (n === 1 ? 'call' : 'calls') : (n === 1 ? 'voicemail' : 'voicemails')}?`,
        lead: log ? 'They go from everyone\'s log, as if they never happened. A voicemail left on one of them stays in Voicemail. This cannot be undone.' : 'They go from the mailbox they are in, players\' boxes included. This cannot be undone.' }) });
    if (!ok) return;
    const r = log ? await s.deleteCalls([...p.set]) : await s.voicemailsBatch([...p.set].map((k) => { const [ownerId, vmId] = k.split('|'); return { ownerId, vmId }; }), 'delete');
    if (r?.ok === false) ncmNotify.warn(r.error || 'That did not work.');
    else ncmNotify.info(`Deleted ${n} ${log ? (n === 1 ? 'call' : 'calls') : (n === 1 ? 'voicemail' : 'voicemails')}.`);
    p.set.clear(); p.anchor = null;
    return this.app.render();
  }

  async onAct(op, event, target) {
    const d = target.dataset;
    const s = this.calls;
    switch (op) {
      case 'view': this._view = d.view === 'log' ? logLanding(this._view, this._unheard || 0) : d.view; return this.app.render();
      case 'logTab': this._view = d.view; return this.app.render();
      case 'logEdit': this._view = 'logedit'; this._pn.f = 'editlog'; if (d.out) this._pn.lgOut = d.out; return this.app.render();
      case 'clearQ': if (d.which === 'vm') this._vmQ = ''; else this._logQ = ''; return this.app.render();
      case 'more': { const k = d.band; this._limits[k] = (this._limits[k] || 30) + 30; return this.app.render(); }
      case 'foldToggle': {
        const secs = [...(this.element?.querySelectorAll('.ncm-ph2 [data-ph-group]') ?? [])];
        const close = secs.some((x) => !x.classList.contains('is-shut'));
        for (const x of secs) { const k = x.dataset.phGroup; (close ? this._shut : this._open).add(k); (close ? this._open : this._shut).delete(k); }
        return this.app.render();
      }
      case 'logDates': DateRangePicker.open({ from: this._logFrom, to: this._logTo, title: 'Calls between', onApply: (from, to) => { this._logFrom = from; this._logTo = to; this.app.render(); }, onClear: () => { this._logFrom = ''; this._logTo = ''; this.app.render(); } }); return;
      case 'logUnfilter':
        if (d.k === 'dates') { this._logFrom = ''; this._logTo = ''; }
        else ScopePicker.set(this.scopeId(d.k === 'who' ? 'logwho' : 'lognet'), []);
        return this.app.render();
      case 'logClear':
        this._logQ = ''; this._logFilter = 'all'; this._logFrom = ''; this._logTo = '';
        ScopePicker.set(this.scopeId('logwho'), []); ScopePicker.set(this.scopeId('lognet'), []);
        return this.app.render();
      case 'vmClear': this._vmQ = ''; this._vmShow = 'all'; return this.app.render();
      // Select mode (Call log / Voicemail)
      case 'pickMode': { const p = this._pick[d.which]; p.on = !p.on; p.set.clear(); p.anchor = null; return this.app.render(); }
      case 'pickRow': this._pickToggle(d.which, d.k, !!event?.shiftKey); return this.app.render();
      case 'pickAll': {
        const p = this._pick[d.which], all = this._order?.[d.which] || [];
        if (all.length && all.every((k) => p.set.has(k))) p.set.clear(); else for (const k of all) p.set.add(k);
        return this.app.render();
      }
      case 'pickDel': return this._pickDelete(d.which);
      case 'pickHeard': {
        const list = [...this._pick.vm.set].map((k) => { const [ownerId, vmId] = k.split('|'); return { ownerId, vmId }; });
        const r = await s?.voicemailsBatch(list, d.v === 'new' ? 'new' : 'heard');
        if (r?.ok === false) ncmNotify.warn(r.error || 'That did not work.');
        this._pick.vm.set.clear();
        return this.app.render();
      }
      case 'foldAll': {
        const open = d.open === '1';
        this._shut.clear(); this._open.clear();
        for (const g of this.element?.querySelectorAll('.ncm-ph2 [data-ph-group]') ?? []) (open ? this._open : this._shut).add(g.dataset.phGroup);
        return this.app.render();
      }
      // live
      case 'answer': s?.answer(d.id); return this.app.render();
      case 'decline': s?.decline(d.id); return this.app.render();
      case 'qOpen': this._qOpen = this._qOpen === d.id ? '' : d.id; return this.app.render();
      case 'qAsWho': {
        const call = s?.calls.get(d.id), who = await this._pickSpeaker(call, 'Answer as…');
        if (!who) return;
        s.answer(d.id, who);
        return this.app.render();
      }
      case 'qPass': {
        const call = s?.calls.get(d.id), who = await this._pickSpeaker(call, 'Pass to…');
        if (who) s.passTo(d.id, who);
        return this.app.render();
      }
      case 'qHold': s?.queueHold(d.id, d.on !== '0'); return this.app.render();
      case 'qRingOut': s?.decline(d.id, { ringOut: true }); return this.app.render();
      case 'qHoldAll': for (const c of s?.allCalls?.() || []) if (c.state === 'ringing' && s._ringsHere(c) && !c.queueHold) s.queueHold(c.id, true); return this.app.render();
      case 'qVmAll': for (const c of s?.allCalls?.() || []) if (c.state === 'ringing' && s._ringsHere(c)) s.decline(c.id); return this.app.render();
      case 'hangup': s?.hangup(d.id); return this.app.render();
      case 'drop': {
        const why = await showNamePicker({ title: 'Drop the call', hint: 'Both sides see the call drop, and this reason under it.', placeholder: 'search reasons…',
          entries: DROP_REASONS.map(([id, name, icon]) => ({ id, name, icon })) });
        if (why?.id) s?.drop(d.id, DROP_REASONS.find((r) => r[0] === why.id)?.[1] || undefined);
        return this.app.render();
      }
      case 'glitch': s?.glitch(d.id); return;
      case 'callAs': return this._callAs(d.contactId);
      // voicemail
      case 'vmPlay': speak(d.text || '', { voice: d.voice || '' }); if (d.heard !== '1') await s?.setVoicemailHeard(d.ownerId, d.vm, true); return this.app.render();
      case 'vmHeard': await s?.setVoicemailHeard(d.ownerId, d.vm, d.heard === '1'); return this.app.render();
      case 'vmDel': {
        const ok = await themedConfirm({ title: 'Delete voicemail', bad: true, yes: 'Delete', yesIcon: 'fas fa-trash',
          content: dialogBodyHtml({ tone: 'bad', icon: 'fas fa-voicemail', title: 'Delete this voicemail?', lead: 'It cannot be brought back.' }) });
        if (ok) await s?.deleteVoicemail(d.ownerId, d.vm);
        return this.app.render();
      }
      case 'vmCallBack': {
        const as = d.toContact ? { contactId: d.toContact } : { actorId: d.toActor };
        const r = await s?.placeCall(d.number, as);
        if (r && !r.ok && r.error) ncmNotify.warn(r.error);
        this._view = 'live'; return this.app.render();
      }
      case 'vmReply': {
        const mcs = game.nightcity?.masterContactService;
        const fromContact = d.toContact ? mcs?.getContact?.(d.toContact) : null;
        return game.nightcity?.composeMessage?.({ ...(fromContact ? { fromContact } : { fromActorId: d.toActor }), toActorId: d.fromActor || null, toContactId: d.fromContact || null, subject: 'Re: your message' });
      }
      case 'greeting': return this._editGreeting(d.number, d.name);
      case 'purge': {
        const days = this.calls?.keepDays || 0;
        if (!days) { ncmNotify.info('Keep recordings is set to forever — set a number of days first.'); return; }
        const ok = await themedConfirm({ title: 'Purge old recordings', bad: true, yes: 'Purge', yesIcon: 'fas fa-broom',
          content: dialogBodyHtml({ tone: 'bad', icon: 'fas fa-broom', title: `Recordings older than ${days} days`,
            lead: 'Their recordings are cleared from the voicemails; any words they had stay.',
            hint: 'Files already saved in the world\'s **ncm-voicemail** folder stay on disk — Foundry cannot delete files. Delete them in your file browser if you need the space.' }) });
        if (!ok) return;
        const r = await this.calls.purgeRecordings(days);
        ncmNotify.info(`Cleared ${r.count} recording${r.count === 1 ? '' : 's'}.`);
        return this.app.render();
      }
      case 'ovOpenRun': this._pn.ovRun = d.id; this._pn.f = 'ovrun'; this._view = 'overheard'; return this.app.render();
      case 'emHold': await game.nightcity?.emergencyService?.toggleHold(d.id); return this.app.render();
      case 'emMinus': await game.nightcity?.emergencyService?.minusRound(d.id); return this.app.render();
      case 'emArrive': await game.nightcity?.emergencyService?.arrive(d.id); return this.app.render();
      case 'emOff': await game.nightcity?.emergencyService?.remove(d.id); return this.app.render();
      case 'listen': if (this._listen.has(d.id)) this._listen.delete(d.id); else this._listen.add(d.id); return this.app.render();
      default: return false;
    }
  }

  // ═══════════════════════════════ helpers ═══════════════════════════════

  /** Edit any number's greeting + voicemail switches (an NPC's, or a player's on their behalf). */
  async _editGreeting(number, name) {
    const s = this.calls;
    if (!s || !number) return;
    const set = s.lineSettings(number);
    const g = set.greeting;
    const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const content = dialogBodyHtml({ tone: 'act', icon: 'fas fa-voicemail', title: name || number, sub: number, kind: 'Line',
      extraHtml: `<div class="ncm-ph2-gr" data-kind="${g.kind}">
        <label class="ncm-ph2-gr__row"><span>Greeting</span><select name="kind">${GREETING_KINDS.map((k) => `<option value="${k}"${k === g.kind ? ' selected' : ''}>${GREETING_LABELS[k]}</option>`).join('')}</select></label>
        <div class="ncm-ph2-gr__rec">${this.calls.recordingOn && micStatus().ok ? '<button type="button" data-gr-rec><i class="fas fa-circle"></i> Record</button>' : `<span class="hint">${esc(!this.calls.recordingOn ? 'Recordings are switched off (Settings).' : micStatus().reason)}</span>`}
          <button type="button" data-gr-play><i class="fas fa-play"></i> Play</button><span class="hint" data-gr-rect>${g.audio ? 'A recording is saved.' : 'Up to 20 seconds.'}</span></div>
        <textarea name="text" rows="3" maxlength="${GREETING_MAX}" placeholder="${esc(DEFAULT_GREETING)}">${esc(g.text)}</textarea>
        ${canSpeak() ? `<label class="ncm-ph2-gr__row ncm-ph2-gr__voice"><span>Voice</span><select name="voice"><option value="">This browser's default voice</option></select></label>` : ''}
        <div class="ncm-ph2-gr__row"><button type="button" data-gr-preview><i class="fas fa-play"></i> Preview</button><span class="hint">Voices are this computer's; another computer may read it in its own default voice.</span></div>
        <label class="ncm-ph2-gr__chk"><input type="checkbox" name="on"${set.voicemail.on ? ' checked' : ''}> Take messages</label>
        <label class="ncm-ph2-gr__chk"><input type="checkbox" name="dnd"${set.voicemail.dnd ? ' checked' : ''}> Do not disturb — calls go straight to voicemail</label>
      </div>` });
    let out = null;
    let clip = null; let rec = null;
    await new Promise((resolve) => {
      adminDialog({
        title: 'Greeting & voicemail', content,
        buttons: {
          no: { icon: '<i class="fas fa-xmark"></i>', label: 'Cancel' },
          yes: { icon: '<i class="fas fa-check"></i>', label: 'Save', callback: (html) => {
            const root = html[0] ?? html;
            out = { greeting: { kind: root.querySelector('[name=kind]').value, text: root.querySelector('[name=text]').value, voice: root.querySelector('[name=voice]')?.value || '' },
              voicemail: { on: root.querySelector('[name=on]').checked, dnd: root.querySelector('[name=dnd]').checked } };
          } },
        },
        default: 'yes',
        render: (html) => {
          const root = html[0] ?? html;
          const box = root.querySelector('.ncm-ph2-gr');
          root.querySelector('[name=kind]')?.addEventListener('change', (e) => { box.dataset.kind = e.target.value; });
          const sel = root.querySelector('[name=voice]');
          if (sel) voices().then((list) => { sel.innerHTML = `<option value="">This browser's default voice</option>` + list.map((v) => `<option value="${esc(v.name)}"${v.name === g.voice ? ' selected' : ''}>${esc(v.name)} (${esc(v.lang)})</option>`).join(''); });
          const rect = root.querySelector('[data-gr-rect]');
          root.querySelector('[data-gr-rec]')?.addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            if (rec?.recording) { clip = await rec.stop(); rec = null; btn.innerHTML = '<i class="fas fa-rotate-left"></i> Again'; if (rect) rect.textContent = `${formatDuration(clip.ms / 1000)} recorded — Save to keep it`; return; }
            rec = new VoiceRecorder();
            try { await rec.start({ maxMs: 20000, onTick: (ms) => { if (rect) rect.textContent = `${formatDuration(ms / 1000)} / 0:20`; }, onLimit: () => btn.click() }); btn.innerHTML = '<i class="fas fa-square"></i> Stop'; }
            catch (err) { ncmNotify.warn(err.message); rec = null; }
          });
          root.querySelector('[data-gr-play]')?.addEventListener('click', () => { const src = clip?.blob ? URL.createObjectURL(clip.blob) : g.audio; if (src) playAudio(src); else ncmNotify.info('Nothing recorded yet.'); });
          root.querySelector('[data-gr-preview]')?.addEventListener('click', () => {
            const kind = root.querySelector('[name=kind]').value;
            const text = kind === 'default' ? DEFAULT_GREETING : (root.querySelector('[name=text]').value || DEFAULT_GREETING);
            if (kind === 'tts' || kind === 'default') speak(text, { voice: sel?.value || '' });
            else ncmNotify.info(`Callers will see: “${text}”`);
          });
        },
        close: () => { rec?.cancel?.(); resolve(); },
      }, { width: 460, classes: ['dialog', 'ncm-themed-dialog'] }).render(true);
    });
    if (!out) return;
    let r;
    if (out.greeting.kind === 'recorded') {
      if (clip?.blob?.size) r = await s.saveRecordedGreeting(number, out, { base64: await blobToBase64(clip.blob), mime: clip.mime, ms: clip.ms });
      else if (g.audio) r = await s.saveLineSettings(number, { ...out, greeting: { ...out.greeting, audio: g.audio, duration: g.duration } });
      else { ncmNotify.warn('Record a greeting first.'); return; }
    } else r = await s.saveLineSettings(number, out);
    if (!r.ok) ncmNotify.warn(r.error); else ncmNotify.info(`${name || number}: greeting saved.`);
    return this.app.render();
  }

  /** What kind of call is in the queue. */
  _queueKind(c) {
    const s = this.calls, ctx = s.numberContext, p = parseNumber(c.to?.number || '', ctx);
    if (c.to?.shared) return 'shared';
    if (c.from?.payphone || c.to?.kind === 'payphone') return 'pay';
    if (p.service) return 'special';
    if (rowOf(p, ctx)?.Category === 'Corporate') return 'corp';
    return 'npc';
  }

  /** Who picks up: who they asked for, then that company, then anyone else. Search and filter. */
  async _pickSpeaker(call, title) {
    const s = this.calls, mcs = game.nightcity?.masterContactService;
    const all = (mcs?.getAll?.() || []).filter((c) => !c.sendOnly);
    const asked = call?.to?.contactId ? mcs?.getContact?.(call.to.contactId) : null;
    const ctx = s.numberContext, row = rowOf(parseNumber(call?.to?.number || '', ctx), ctx);
    const orgName = asked?.organization || (row?.Category === 'Corporate' ? row.District : '');
    const entries = all.map((c) => {
      const inOrg = !!orgName && orgKey(c.organization || '') === orgKey(orgName);
      return { id: c.id, name: c.name, img: resolveDisplayPortrait({ contactId: c.id }) || '', sub: c.organization || c.role || '', group: c.id === asked?.id ? 'Asked for' : inOrg ? orgName : 'Anyone else' };
    }).sort((a, b) => (['Asked for', orgName].indexOf(b.group) - ['Asked for', orgName].indexOf(a.group)) || 0);
    const pick = await showNamePicker({ title, hint: 'Who picks up? Search, or filter by company.', placeholder: 'search people…', entries });
    return pick?.id ? s.answerAs(mcs.getContact(pick.id)) : null;
  }

  /** NETWORK LOAD: calls on each network right now and today, and the networks a node is cutting on the viewed scene. */
  _load(s) {
    const ns = game.nightcity?.networkService;
    let today = '';
    try { today = String(game.nightcity?.timeService?.getCurrentTime?.() || '').slice(0, 10); } catch { /* no clock */ }
    const nets = (ns?.getAllNetworks?.() || []).map((n) => ({ id: n.id, name: n.name, color: n.theme?.color || n.color || '' }));
    let blocks = {};
    try { blocks = ns?.getSceneBlocks?.(game.scenes?.viewed?.id) || {}; } catch { /* none */ }
    return networkLoad({ calls: s.allCalls(), logs: s.allLogs(), nets, today, blocks });
  }

  /** Call a player's character (or anyone with a number) as an NPC identity. */
  async _callAs(contactId = null) {
    const s = this.calls; const mcs = game.nightcity?.masterContactService;
    if (!s) return;
    let id = contactId;
    if (!id) {
      const npcs = (mcs?.getAll?.() || []).filter((c) => !c.sendOnly && s.numberOfContact(c.id));
      if (!npcs.length) { ncmNotify.warn('No NPC has a number yet — give one in Phone → Numbers.'); return; }
      const pick = await showNamePicker({ title: 'Call as…', hint: 'The NPC (or alias) the call comes from.', placeholder: 'search NPCs…',
        entries: npcs.map((c) => ({ id: c.id, name: c.name, img: resolveDisplayPortrait({ contactId: c.id }) || 'icons/svg/mystery-man.svg', sub: s.numberOfContact(c.id) })) });
      if (!pick?.id) return;
      id = pick.id;
    }
    if (!s.numberOfContact(id)) { ncmNotify.warn('That contact has no number — give them one first.'); return; }
    const targets = getPlayerCharacters().map((p) => ({ id: p.actorId, name: p.actorName, img: p.actor?.img || '', sub: s.numberOf(p.actorId) || 'no number', group: 'Players' }))
      .filter((t) => t.sub !== 'no number');
    if (!targets.length) { ncmNotify.warn("No player's character has a number yet."); return; }
    const who = await showNamePicker({ title: `Call as ${mcs?.getContact?.(id)?.name || 'NPC'}…`, hint: 'Who to ring.', placeholder: 'search characters…', entries: targets });
    if (!who?.id) return;
    const how = await showNamePicker({ title: 'Their screen shows…', hint: 'A withheld number shows as Unknown caller; they can try to trace it.',
      entries: [{ id: 'show', name: `${mcs?.getContact?.(id)?.name || 'The NPC'} — ${s.numberOfContact(id)}`, icon: 'fas fa-id-badge' },
        { id: 'anon', name: 'Number withheld', icon: 'fas fa-user-secret' }] });
    if (!how?.id) return;
    const r = await s.placeCall(s.numberOf(who.id), { contactId: id, anon: how.id === 'anon' });
    if (r && !r.ok && r.error) ncmNotify.warn(r.error);
    this._view = 'live';
    return this.app.render();
  }

  /** Hand a number to characters: it lands on their saved contact for that person, or a new contact if they have none. */
  async _shareLine(person, line) {
    if (!person || !line) return;
    const pcs = getPlayerCharacters().filter((p) => p.actorId !== person.id);
    const pick = await showNamePicker({ title: `Share ${line.n}`, hint: 'Who gets this number? Nothing else about them is shared.', placeholder: 'search characters…', multi: true,
      preselected: pcs.filter((p) => line.holders.includes(p.actorId)).map((p) => p.actorId), doneLabel: 'Share',
      entries: pcs.map((p) => ({ id: p.actorId, name: p.actorName, img: p.actor?.img || '', sub: p.playerName || '' })) });
    if (!pick) return;
    const ids = pick.map((x) => x.id ?? x);
    // a second line never names who holds it
    const second = ['extra', 'burner', 'shared'].includes(line.kind);
    const r = await this.calls?.shareNumber?.({ number: line.n, name: second ? (line.label || line.n) : person.kind === 'pc' ? '' : person.name, ownerContactId: !second && person.kind === 'npc' ? person.id : null, ownerActorId: !second && person.kind === 'pc' ? person.id : null, actorIds: ids });
    if (r && !r.ok) ncmNotify.warn(r.error);
    return this.app.render();
  }

  async _saveSetting(el) {
    const key = el.dataset.phSet;
    let val;
    if (key === 'callModes') {
      val = [...this.element.querySelectorAll('[data-ph-set="callModes"]:checked')].map((c) => c.value);
      if (!val.length) { ncmNotify.warn('Leave at least one way to talk.'); el.checked = true; return; }
    } else if (el.type === 'checkbox') val = el.checked;
    else if (key === 'callRingSeconds') val = Math.min(120, Math.max(5, Number(el.value) || 30));
    else if (key === 'voicemailMaxSeconds') val = Math.min(180, Math.max(10, Number(el.value) || 60));
    else if (key === 'voicemailKeepDays') val = Math.min(3650, Math.max(0, Math.round(Number(el.value) || 0)));
    else val = el.value;
    if (!SETTING_KEYS.includes(key)) return;
    try {
      const before = game.settings.get(MODULE_ID, key);
      await game.settings.set(MODULE_ID, key, val);
      // a call switch is a feature: nothing changes until the world reloads (Foundry only asks from its own menu)
      if (FEATURE_KEYS.includes(key) && before !== val) { SettingsConfigClass()?.reloadConfirm?.({ world: true }); return; }
      // a start mode that was just switched off falls back to the first one left
      if (key === 'callModes' && !val.includes(game.settings.get(MODULE_ID, 'callDefaultMode'))) await game.settings.set(MODULE_ID, 'callDefaultMode', val[0]);
    } catch (err) { ncmNotify.error(`Could not save: ${err.message}`); }
    this.app.render();
  }
}
