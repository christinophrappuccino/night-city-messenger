/**
 * The payphone booth a player opens on clicking a payphone — dial and pick up only; the call itself is the normal call
 * screen (CallHud), which stays untouched.
 * @file scripts/ui/Calls/PayphoneBooth.js
 * @module night-city-messenger
 * @description Spec dev/design/PHONE-REVISION.md §Payphones "Decided 2026-11-03"; drawing scripts/ui/Calls/boothMarkup.js;
 *   styles styles/components/payphone-booth.css. A framework-free overlay (the SecurityConsole family), body-mounted,
 *   one booth open at a time. The booth's own state is local; who is on it and the speaker go through PayphoneService.
 *   Sounds: the dial tone and key tones are synthesised (Web Audio, the player's sound switch + volume); the bell, the hook
 *   and the chip are on the Sound Board, and a booth may carry its own files.
 */

import { EVENTS, MODULE_ID } from '../../utils/constants.js';
import { log } from '../../utils/helpers.js';
import { boothHtml, keypadHtml, bookHtml, speedHtml, byHtml } from './boothMarkup.js';
import { gritTier, placeLabel, speakerOn, PP_HELP } from '../../utils/payphones.js';
import { phoneBook } from '../MessageViewer/callsTab.js';

const DTMF = { 1: [697, 1209], 2: [697, 1336], 3: [697, 1477], 4: [770, 1209], 5: [770, 1336], 6: [770, 1477], 7: [852, 1209], 8: [852, 1336], 9: [852, 1477], 0: [941, 1336] };
/** The last `n` characters of a long number, the way a phone screen scrolls: the newest digit always shows. */
export const tail = (s, n) => { const t = String(s ?? ''); return t.length > n ? '…' + t.slice(-(n - 1)) : t; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class PayphoneBooth {
  constructor(service) {
    this.svc = service;
    this.host = null;
    this.pp = null;
    /** this booth: { at, num, chip, callId } */
    this.st = null;
    /** id → the caller's speaker choice (SPKR) for the next/current call */
    this._spk = new Map();
    /** id → the last number dialled here, for Redial */
    this._last = new Map();
    this._ac = null; this._tone = null; this._cordRaf = 0; this._cordUntil = 0; this._uid = 0;
    this._key = (e) => this._onKey(e);
  }

  init() {
    const bus = game.nightcity?.eventBus;
    bus?.on(EVENTS.PAYPHONE_STATE, ({ id } = {}) => { if (this.pp?.id === id) this._refreshBusy(); });
    // a call that ends while the booth is open puts the handset back; a closed booth is shown by hungUp()
    bus?.on(EVENTS.CALL_ENDED, ({ call } = {}) => { if (this.st?.callId && call?.id === this.st.callId) this._putBack(); });
    // the booth's own record changed (the GM restyled it): reopen in place
    Hooks.on('updateSetting', (s) => { if (s?.key === `${MODULE_ID}.payphones` && this.pp) { const fresh = this.svc.get(this.pp.id); if (!fresh) this.close(); else if (this.st?.at === 'idle') this.open(fresh); } });
  }

  get reduced() { return !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches || game.nightcity?.themeService?.getAnimationLevel?.() === 'off'; }

  // ═══════════════════════════════ open / close ═══════════════════════════════

  open(pp) {
    this.close(true);
    this.pp = pp;
    const u = `b${++this._uid}`;
    const help = PP_HELP.find(([k]) => k === pp.help);
    const host = document.createElement('div');
    host.className = 'ncm-pb-host';
    host.innerHTML = `<div class="ncm-pb-frame">${boothHtml({ look: pp.look, uid: u, place: pp.name, number: pp.number, condition: pp.condition, helpKey: !!pp.help, helpLabel: help ? (pp.help === 'TRAUMA' ? 'Trauma' : 'NCPD') : 'Help' })}</div>`;
    document.body.appendChild(host);
    this.host = host;
    this.root = host.querySelector('.ncm-pb');
    if (!this.reduced) this.root.classList.add('is-enter');
    this.st = { at: 'idle', num: '', chip: false, callId: null };
    // what this booth is doing right now, as this client knows it
    const ringing = [...(this.svc._ringing?.keys?.() || [])].find((id) => this.svc.calls?.calls.get(id)?.to?.payphoneId === pp.id);
    const mine = this.svc.inUse.get(pp.id);
    if (mine?.userId === game.user.id && mine.callId) this.st = { ...this.st, at: 'oncall', callId: mine.callId };
    else if (this.svc.otherOn(pp.id)) this.st.at = 'busy';
    else if (ringing) { this.st.at = 'ringing'; this.st.ringId = ringing; }
    this._book = this._readBook();
    this.root.querySelector('[data-pb-speed]').innerHTML = speedHtml(this._book);
    this._wire();
    this._paint();
    this._fit();
    document.addEventListener('keydown', this._key, true);
    window.addEventListener('resize', this._fitBound ??= () => { this._fit(); this._cord(); });
  }

  /** Walk away. Hanging up a dial tone; a live call stays up (it is on the call screen now). */
  close(silent = false) {
    if (!this.host) return;
    if (['lifted', 'dialing', 'book'].includes(this.st?.at) && this.pp) this.svc.setUse(this.pp.id, false);
    this._stopTone();
    clearTimeout(this._handoffT); this._handoffT = 0;
    cancelAnimationFrame(this._cordRaf); this._cordRaf = 0;
    document.removeEventListener('keydown', this._key, true);
    window.removeEventListener('resize', this._fitBound);
    const h = this.host;
    this.host = null; this.root = null; this.pp = null; this.st = null;
    if (silent || this.reduced) h.remove(); else { h.classList.add('is-out'); setTimeout(() => h.remove(), 260); }
  }

  /** Scale the booth to fit the window (it is drawn at 430 × ~900). */
  _fit() {
    const frame = this.host?.querySelector('.ncm-pb-frame');
    if (!frame) return;
    frame.style.setProperty('--pb-zoom', 1);
    const h = frame.scrollHeight || 900;
    frame.style.setProperty('--pb-zoom', Math.max(0.5, Math.min(1, (window.innerHeight - 120) / h)).toFixed(3));
  }

  _readBook() {
    try {
      const op = this.svc.operator();
      return phoneBook({ actorId: op?.id || null }).filter((b) => b.number).slice(0, 60);
    } catch (err) { log.debug(`booth book: ${err.message}`); return []; }
  }

  // ═══════════════════════════════ events ═══════════════════════════════

  _wire() {
    const host = this.host, root = this.root;
    host.addEventListener('pointerdown', (e) => { if (e.target === host) this.close(); });
    root.addEventListener('click', (e) => {
      const t = e.target.closest('[data-pb], [data-k], [data-fn], [data-dial]');
      if (!t || !root.contains(t)) return;
      if (t.dataset.pb === 'handset') return this.lift();
      if (t.dataset.pb === 'slot') return this._slot();
      if (t.dataset.pb === 'close') return this.close();
      if (t.dataset.k) return this.press(t.dataset.k);
      if (t.dataset.dial) return this._dial(t.dataset.dial, true);
      if (t.dataset.fn) return this._fn(t.dataset.fn);
    });
    this._wireTorch();
  }

  _onKey(e) {
    if (!this.host) return;
    if (e.target?.closest?.('input, textarea, [contenteditable]')) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return this.close(); }
    if (/^[0-9]$/.test(e.key)) { e.preventDefault(); return this.press(e.key); }
    if (e.key === 'Backspace') { e.preventDefault(); return this.press('<'); }
    if (e.key === 'Enter') { e.preventDefault(); return this.press('OK'); }
  }

  // ═══════════════════════════════ the handset ═══════════════════════════════

  lift() {
    const pp = this.pp, st = this.st;
    if (!pp || st.at === 'busy' || st.at === 'handoff') return;
    this._sfx('hook');
    if (st.at === 'ringing') { this.svc.pickUp(st.ringId); return this._handoff(); }
    if (st.at === 'oncall') { const id = st.callId; this._putBack(); this.svc.calls?.hangup(id); return; }
    if (st.at === 'idle') {
      if (this.svc.otherOn(pp.id)) { st.at = 'busy'; return this._paint(); }
      st.at = 'lifted'; st.num = '';
      this.svc.setUse(pp.id, true);
      if (pp.condition !== 'out') this._startTone();
    } else {
      st.at = 'idle'; st.num = ''; st.chip = false;
      this._stopTone();
      this.svc.setUse(pp.id, false);
    }
    this._paint();
  }

  press(k) {
    const st = this.st, pp = this.pp;
    if (!st) return;
    const canKey = pp.condition !== 'out' && ['lifted', 'dialing'].includes(st.at);
    const key = this.root.querySelector(`[data-k="${CSS.escape(k)}"]`);
    key?.classList.add('is-down'); setTimeout(() => key?.classList.remove('is-down'), 120);
    if (!canKey || (gritTier(pp.look.grit) === 4 && k === '7') || k === 'OK' || k === '<') this._keyClick();
    if (!canKey) return;
    if (gritTier(pp.look.grit) === 4 && k === '7') return;
    if (k === 'OK') return this.call();
    if (k === '<') { st.num = st.num.slice(0, -1); if (!st.num) st.at = 'lifted'; return this._paint(); }
    this._stopTone();
    this._keyTone(k);
    if (st.num.length < 20) st.num += k;
    st.at = 'dialing';
    this._paint();
  }

  /** Type a number on the keys for you (Book, speed dial, Redial, Help), then call when `go`. */
  async _dial(number, go = false) {
    const st = this.st;
    if (!st || this.pp.condition === 'out' || ['busy', 'handoff', 'ringing', 'oncall'].includes(st.at)) return;
    if (st.at === 'idle') this.lift();
    st.at = 'dialing'; st.num = ''; this._stopTone();
    for (const ch of String(number)) {
      if (!this.st) return;
      if (DTMF[ch]) this._keyTone(ch, 0.07);
      st.num += ch; this._paint();
      await new Promise((r) => setTimeout(r, this.reduced ? 0 : 60));
    }
    if (go) this.call();
  }

  async call() {
    const st = this.st, pp = this.pp;
    if (!st || pp.condition === 'out') return;
    const number = st.num.trim();
    if (number.replace(/[^0-9A-Z]/gi, '').length < 3) { this._sfx('hook', 0.4); return; }
    this._stopTone();
    this._last.set(pp.id, number);
    st.at = 'handoff'; this._paint();
    const res = await this.svc.calls?.placeCall?.(number, { payphone: pp.id });
    if (!this.st) return;
    if (!res?.ok) {
      st.at = 'dialing'; this._paint();
      this._flash(res?.error || 'Call failed');
      return;
    }
    // the call is on the call screen now; the booth steps back and goes
    this._handoff(res.call?.id);
  }

  _handoff(callId = null) {
    if (!this.st) return;
    this.st.at = 'handoff'; this.st.callId = callId;
    this._paint();
    clearTimeout(this._handoffT);
    this._handoffT = setTimeout(() => { this._handoffT = 0; if (this.st?.at === 'handoff') this.close(); }, this.reduced ? 0 : 420);
  }

  /** The handset back on its hook: dial tone off, the booth free again (it stays open). */
  _putBack() {
    const st = this.st;
    if (!st || st.at === 'idle') return;
    clearTimeout(this._handoffT); this._handoffT = 0;
    this._stopTone();
    if (this.pp && ['lifted', 'dialing', 'book'].includes(st.at)) this.svc.setUse(this.pp.id, false);
    st.at = 'idle'; st.num = ''; st.chip = false; st.callId = null;
    this._sfx('hook');
    this._paint();
  }

  /**
   * A call on a booth I was holding ended (PayphoneService). The booth is usually closed by then (the call screen took
   * over), so it comes back for a moment to show the handset going back on the hook, then goes.
   * @param {object} pp @param {string} callId
   */
  hungUp(pp, callId) {
    if (!pp) return;
    if (this.pp?.id === pp.id && this.st) {
      if (['oncall', 'handoff'].includes(this.st.at) && (!this.st.callId || this.st.callId === callId)) this._putBack();
      return;
    }
    if (this.host || this.reduced) return;
    this.open(pp);
    if (!this.st) return;
    this.st.at = 'oncall'; this.st.callId = callId;
    this._paint();
    const host = this.host;
    let touched = false;
    host.addEventListener('pointerdown', () => { touched = true; }, { once: true, capture: true });
    setTimeout(() => { if (this.host === host) this._putBack(); }, 380);
    setTimeout(() => { if (this.host === host && !touched && this.st?.at === 'idle') this.close(); }, 1700);
  }

  _fn(f) {
    const st = this.st, pp = this.pp;
    if (f === 'eject') { this._sfx(st.chip ? 'chip' : 'hook', st.chip ? 0.8 : 0.3); st.chip = false; return this._paint(); }
    if (f === 'vol') return this._sfx('hook', 0.25);
    if (st.at === 'busy') return;
    if (f === 'spk') {
      if (pp.hear !== 'caller') { this._flash(pp.hear === 'speaker' ? 'Speaker only' : 'No speaker'); return; }
      const on = !this._spk.get(pp.id);
      this._spk.set(pp.id, on);
      if (st.at === 'oncall' && st.callId) this.svc.setSpeaker(st.callId, on);
      this._sfx('hook', 0.3);
      return this._paint();
    }
    if (f === 'book') {
      if (st.at === 'idle') this.lift();
      if (pp.condition === 'out' || !['lifted', 'dialing', 'book'].includes(this.st.at)) return;
      this.st.at = this.st.at === 'book' ? (this.st.num ? 'dialing' : 'lifted') : 'book';
      return this._paint();
    }
    if (f === 'redial') { const n = this._last.get(pp.id); return n ? this._dial(n, true) : this._flash('Nothing to redial'); }
    if (f === 'sos' && pp.help) {
      const num = pp.help === 'TRAUMA' ? (game.nightcity?.emergencyService?.traumaLine?.()?.number || 'TRAUMA') : 'NCPD';
      return this._dial(num, true);
    }
  }

  _slot() {
    const st = this.st;
    if (!st || st.chip || this.pp.condition === 'out' || st.at === 'busy') return;
    st.chip = true;
    const c = this.root.querySelector('.ncm-pb__chip');
    c.classList.remove('is-in'); void c.offsetWidth; c.classList.add('is-in');
    setTimeout(() => this._sfx('chip'), this.reduced ? 0 : 330);
    setTimeout(() => this._paint(), this.reduced ? 0 : 420);
  }

  // ═══════════════════════════════ from the service ═══════════════════════════════

  /** A booth started or stopped ringing on this client. */
  ringing(pp, callId) {
    if (!this.st) return;
    if (pp && this.pp?.id === pp.id && this.st.at === 'idle') { this.st.at = 'ringing'; this.st.ringId = callId; this._paint(); }
    if (!pp && this.st.ringId === callId && this.st.at === 'ringing') { this.st.at = 'idle'; this.st.ringId = null; this._paint(); }
  }

  speakerChoice(id) { return !!this._spk.get(id); }

  _refreshBusy() {
    if (!this.st) return;
    const other = this.svc.otherOn(this.pp.id);
    if (other && this.st.at === 'idle') this.st.at = 'busy';
    if (!other && this.st.at === 'busy') this.st.at = 'idle';
    this._paint();
  }

  /** The read-only strip for a booth call this client hears on speaker. */
  renderListen() {
    const entries = [...this.svc.listening.entries()];
    let el = document.querySelector('.ncm-pb-listen');
    if (!entries.length) { el?.remove(); if (this.st?.at === 'busy') this._paint(); return; }
    const [callId, l] = entries[entries.length - 1];
    if (!el) { el = document.createElement('div'); el.className = 'ncm-pb-listen ncm-app'; document.body.appendChild(el); }
    el.innerHTML = `<div class="ncm-pb-listen__hd"><i class="fas fa-ear-listen"></i><b>${esc(l.who)} · ${esc(l.place)}</b><button type="button" data-pb-hide aria-label="Hide" data-tooltip="Stop listening"><i class="fas fa-xmark"></i></button></div>
      <div class="ncm-pb-listen__feed">${l.lines.map((x) => `<p><b${x.who === l.who ? ' class="v"' : ''}>${esc(x.who)}:</b> ${esc(x.text)}</p>`).join('') || `<p>${esc(l.who)} is talking to ${esc(l.otherName)}.</p>`}</div>
      <div class="ncm-pb-listen__ro">On speaker — you can hear it, you can't speak on it.</div>`;
    el.querySelector('[data-pb-hide]').addEventListener('click', () => { this.svc.listening.delete(callId); this.renderListen(); });
    const feed = el.querySelector('.ncm-pb-listen__feed'); feed.scrollTop = feed.scrollHeight;
    if (this.st?.at === 'busy') this._paint();
  }

  // ═══════════════════════════════ paint ═══════════════════════════════

  _paint() {
    const r = this.root, st = this.st, pp = this.pp;
    if (!r || !st) return;
    const out = pp.condition === 'out', at = st.at;
    const l1 = r.querySelector('[data-pb-l1]'), l2 = r.querySelector('[data-pb-l2]');
    const busy = at === 'busy' ? this.svc.otherOn(pp.id) : null;
    const spk = speakerOn(pp.hear, this._spk.get(pp.id));
    if (at === 'idle') { l1.textContent = pp.look.idle; l2.textContent = ''; }
    if (['lifted', 'dialing', 'book'].includes(at)) { l1.textContent = out ? 'No dial tone' : (spk ? 'Speaker on' : 'Dial tone'); l2.textContent = tail(st.num, 14); }
    if (at === 'ringing') { l1.textContent = 'Incoming call'; l2.textContent = 'Pick up'; }
    if (at === 'handoff') { l1.textContent = 'Connecting'; l2.textContent = tail(st.num, 14); }
    if (at === 'oncall') { l1.textContent = spk ? 'On a call · speaker' : 'On a call'; l2.textContent = ''; }
    if (at === 'busy') { l1.textContent = 'In use'; l2.textContent = busy?.speaker ? 'Speaker on' : '— — —'; }
    r.dataset.at = at === 'oncall' ? 'lifted' : at;
    const off = ['lifted', 'dialing', 'book', 'handoff', 'oncall', 'busy'].includes(at);
    r.classList.toggle('is-off', off);
    r.classList.toggle('is-away', at === 'busy');
    r.classList.toggle('is-spk', (spk && ['lifted', 'dialing', 'book', 'oncall'].includes(at)) || !!busy?.speaker);
    r.querySelector('[data-fn="spk"]')?.classList.toggle('is-lit', spk && at !== 'busy');
    r.querySelector('[data-fn="book"]')?.classList.toggle('is-lit', at === 'book');
    const hint = r.querySelector('[data-pb-hint]');
    hint.textContent = at === 'ringing' ? 'Pick up' : at === 'idle' ? 'Lift' : at === 'busy' ? '' : 'Hang up';
    r.querySelector('[data-pb="handset"]').setAttribute('aria-label', at === 'idle' ? 'Lift the handset' : at === 'ringing' ? 'Pick up' : 'Hang up');
    // the touchscreen
    const tnum = r.querySelector('[data-pb-tnum]'), tsub = r.querySelector('[data-pb-tsub]'), body = r.querySelector('[data-pb-tbody]');
    if (at === 'book') { tnum.textContent = ''; tsub.textContent = 'Your Agent · tap to dial'; body.innerHTML = bookHtml(this._book); }
    else {
      tnum.textContent = ['dialing', 'handoff'].includes(at) ? tail(st.num, 10) : '';
      tsub.textContent = out ? '' : at === 'idle' ? '' : at === 'ringing' ? 'Incoming' : at === 'busy' ? 'In use' : at === 'handoff' ? 'Connecting' : at === 'oncall' ? 'On a call' : (st.chip ? 'Chip OK' : 'Enter number');
      if (!body.querySelector('.ncm-pb__tpad') || body.dataset.wrecked !== String(gritTier(pp.look.grit) === 4)) { body.innerHTML = keypadHtml({ wrecked: gritTier(pp.look.grit) === 4 }); body.dataset.wrecked = String(gritTier(pp.look.grit) === 4); }
    }
    // someone else on it
    const by = r.querySelector('[data-pb-by]');
    if (by) {
      const heard = busy?.callId ? this.svc.listening.get(busy.callId) : null;
      by.innerHTML = busy ? byHtml({ who: busy.name, speaker: !!busy.speaker && !!heard, lines: (heard?.lines || []).map((x) => ({ ...x, mine: x.who === busy.name })) }) : '';
    }
    this._cord();
  }

  _flash(text) {
    const l1 = this.root?.querySelector('[data-pb-l1]');
    if (!l1) return;
    l1.textContent = text;
    clearTimeout(this._flashT);
    this._flashT = setTimeout(() => this._paint(), 1800);
  }

  // ═══════════════════════════════ the cord, the torch ═══════════════════════════════

  /** The cord is measured each frame while the handset moves (and while it shakes on a ring). */
  _cord() {
    this._cordUntil = performance.now() + 750;
    const loop = () => {
      this._cordDraw();
      this._cordRaf = this.root && (performance.now() < this._cordUntil || this.st?.at === 'ringing') ? requestAnimationFrame(loop) : 0;
    };
    if (!this._cordRaf) this._cordRaf = requestAnimationFrame(loop);
  }

  _cordDraw() {
    const r = this.root;
    if (!r) return;
    const svg = r.querySelector('.ncm-pb__cord'), path = r.querySelector('[data-pb-cord]'), A = { x: 56, y: 516 };
    if (this.st?.at === 'busy') { path.setAttribute('d', 'M 56 516 C 40 470, 10 420, -40 380'); return; }
    const end = r.querySelector('[data-pb-cordend]')?.getBoundingClientRect(), m = svg.getScreenCTM();
    if (!end || !m) return;
    const pt = new DOMPoint(end.left + end.width / 2, end.top + end.height / 2).matrixTransform(m.inverse());
    const sag = Math.max(40, (A.y - pt.y) * 0.35 + 50);
    path.setAttribute('d', `M ${pt.x.toFixed(1)} ${pt.y.toFixed(1)} C ${(pt.x - 4).toFixed(1)} ${(pt.y + sag).toFixed(1)}, ${A.x - 34} ${A.y + 24}, ${A.x} ${A.y}`);
  }

  _wireTorch() { wireTorch(this.root); }

  // ═══════════════════════════════ sound ═══════════════════════════════

  /** The audio context the module already uses (Foundry's, unlocked by the first click), woken if the browser parked it. */
  _audio() {
    const p = game.nightcity?.settingsManager?.getTheme?.() || {};
    if (p.soundEnabled === false) return null;
    let ac = null;
    try { ac = game.nightcity?.soundService?._getAudioContext?.() || (this._ac ||= new (window.AudioContext || window.webkitAudioContext)()); } catch { return null; }
    if (!ac) return null;
    if (ac.state === 'suspended') ac.resume?.().catch(() => {});
    return { ac, vol: p.soundVolume ?? 0.5 };
  }

  _keyTone(k, dur = 0.12) {
    const own = this.pp?.sounds?.key;
    if (own) return void game.nightcity?.soundService?.playFile?.(own, { volume: 0.7 });
    const a = this._audio(); const f = DTMF[k]; if (!a || !f) return;
    const t = a.ac.currentTime, peak = 0.32 * a.vol;
    const g = a.ac.createGain(); g.connect(a.ac.destination);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + 0.005);
    g.gain.setValueAtTime(peak, t + dur - 0.015); g.gain.linearRampToValueAtTime(0, t + dur);
    for (const hz of f) { const o = a.ac.createOscillator(); o.frequency.value = hz; o.connect(g); o.start(t); o.stop(t + dur + 0.01); }
  }

  /** A key that does not dial still clicks under your finger. */
  _keyClick() {
    const a = this._audio(); if (!a) return;
    const t = a.ac.currentTime, len = Math.floor(a.ac.sampleRate * 0.02);
    const buf = a.ac.createBuffer(1, len, a.ac.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4);
    const src = a.ac.createBufferSource(), g = a.ac.createGain(), bp = a.ac.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 1.2;
    g.gain.value = 0.5 * a.vol; src.buffer = buf; src.connect(bp); bp.connect(g); g.connect(a.ac.destination); src.start(t);
  }

  _startTone() {
    this._stopTone();
    const a = this._audio(); if (!a) return;
    const g = a.ac.createGain(); g.gain.value = 0.08 * a.vol; g.connect(a.ac.destination);
    this._tone = [350, 440].map((hz) => { const o = a.ac.createOscillator(); o.frequency.value = hz; o.connect(g); o.start(); return o; });
  }

  _stopTone() { try { this._tone?.forEach((o) => o.stop()); } catch { /* already stopped */ } this._tone = null; }

  _sfx(kind, volume = 1) {
    const own = kind === 'hook' ? this.pp?.sounds?.hook : null;
    if (own) return void game.nightcity?.soundService?.playFile?.(own, { volume });
    game.nightcity?.soundService?.play(kind === 'chip' ? 'payphone-chip' : 'payphone-hook', { volume });
  }
}

/**
 * The torch: the cursor over the hole in the casing lights what is inside, softly, where it points.
 * Shared by the booth and the admin preview.
 * @param {HTMLElement} root — a .ncm-pb
 */
export function wireTorch(root) {
  const svg = root?.querySelector('.ncm-pb__guts'), c = root?.querySelector('[data-pb-torch]');
  if (!svg || !c) return;
  let r = 0, on = false, raf = 0, at = { x: -99, y: -99 };
  const paint = () => {
    r += ((on ? 26 : 0) - r) * 0.25;
    c.setAttribute('r', r.toFixed(2)); c.setAttribute('cx', at.x); c.setAttribute('cy', at.y);
    raf = Math.abs((on ? 26 : 0) - r) > 0.2 ? requestAnimationFrame(paint) : 0;
  };
  const go = () => { if (!raf) raf = requestAnimationFrame(paint); };
  svg.addEventListener('pointermove', (e) => {
    if (!e.target.classList?.contains('torch-hit')) return;
    const m = svg.getScreenCTM(); if (!m) return;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    at = { x: pt.x.toFixed(1), y: pt.y.toFixed(1) }; on = true; go();
  });
  svg.addEventListener('pointerout', (e) => { if (e.target.classList?.contains('torch-hit')) { on = false; go(); } });
}

export { placeLabel };
