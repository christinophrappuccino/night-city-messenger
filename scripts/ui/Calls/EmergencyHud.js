/**
 * Trauma Team and Backup on screen.
 * @file scripts/ui/Calls/EmergencyHud.js
 * @module night-city-messenger
 * @description Built on the real call screen (`CallHud._callHtml`): the dial, arcs, name box, network line and keys all stay,
 *   and the card sits where every call sits. Around it, a call of this size gets its own moment:
 *     · an opening sting across the screen,
 *     · a tracker beside the card that finds you and brings help in,
 *     · a closing sting, with the card and tracker leaving in their own way.
 *   It runs at a human pace with a little give in each gap (`organicBeats`), and a click moves it along.
 *   These live in one scene element that stays for the whole call. Only the card's changing panel is redrawn at each step, so the
 *   traces never restart and the card's entrance plays once. Colours come through the real `--ch-*` variables.
 *   Flashing limit: nothing faster than about twice a second, red and blue never strobe. Reduced motion or the module's
 *   animation preference shows still frames and no stings.
 */

import { tipText } from '../../utils/notify.js';
import { CallHud } from './CallHud.js';
import { vitals, organicBeats, backupLook, fillLine, miniWhy, BACKUP_SLOTS, TRAUMA_SLOTS, TRAUMA_BEATS, BACKUP_BEATS, TRAUMA_STEPS, BACKUP_STEPS, TRAUMA_HOLD, BACKUP_HOLD, PLAN_NAMES } from '../../utils/phoneEmergency.js';

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const typeMs = (t) => Math.min(4200, 500 + String(t).length * 48);

/** How long each part lasts, in milliseconds. The stylesheet's animations match these. */
export const EM_TIMES = Object.freeze({ sting: 2800, leave: 1300, closing: 2600, arrival: 8500, arrivalOut: 820 });

/** What the tracker says at each step. Pure, so the sim can read it. */
export const trackWords = (kind, phase, { place = '', busy = false } = {}) => {
  if (kind === 'trauma') return ['SIGNAL OPEN', 'LOCATING', `LOCKED · ${place}`, 'TEAM INBOUND'][phase] || '';
  if (busy) return 'NOBODY FREE';
  return ['LINE OPEN', 'CALLING', 'WAITING ON AN ANSWER', `BACKUP INBOUND · ${place}`][phase] || '';
};

const steps = (names, at) => `<div class="ncm-r5-steps">${names.map((n, i) => `<span class="${i < at ? 'done' : i === at ? 'on' : ''}">${i < at ? '<i class="fas fa-check"></i>' : ''}${esc(n)}</span>`).join('')}</div>`;
const die = (n, sides, rolling) => `<span class="ncm-r5-die${rolling ? ' is-rolling' : ''}" data-tooltip="${tipText(sides === 10 ? 'd10' : 'd6')}"><i class="fas fa-dice-d20"></i><b>${rolling ? '?' : esc(n)}</b></span>`;
const pips = (left, of, ic) => `<span class="ncm-r5-pips" aria-label="${left} rounds left">${Array.from({ length: of }, (_, i) => `<i class="fas ${ic}${i < left ? ' on' : ''}"></i>`).join('')}</span>`;
const artTag = (img) => (img ? `<img class="ncm-r5-art" src="${esc(img)}" alt="">` : '');
const ecg = (hp, max, img = '') => `<div class="ncm-r5-feed">${artTag(img)}<canvas data-ecg data-hp="${hp}" data-max="${max}" width="132" height="146" aria-label="Heart trace"></canvas><span class="rd"><b>${hp}</b>/${max} HP</span></div>`;
const wave = (mode, col, tag, img = '') => `<div class="ncm-r5-feed">${artTag(img)}<canvas data-wave="${mode}" data-col="${col}" width="132" height="146" aria-label="Radio signal"></canvas><span class="rd">${esc(tag)}</span></div>`;

export class EmergencyHud {
  constructor(service, calls) {
    this.service = service; this.calls = calls;
    this.fake = { calls: new Map(), usableModes: [], offeredModes: [], modeFor: () => 'loud', _get: (k, d) => d, homeCode: calls?.homeCode };
    this.hud = new CallHud(this.fake);
    this.hud._other = (c) => c.from;
    this.root = null; this.timers = []; this.run = null; this.n = 0; this.fx = null;
    this._hook = Hooks.on?.('updateSetting', (s) => { if (s?.key?.endsWith('.phoneEmergencyActive')) this._paintMini(); });
    setTimeout(() => this._paintMini(), 500);
  }

  get still() {
    if (matchMedia?.('(prefers-reduced-motion: reduce)').matches) return true;
    try { return game.nightcity?.themeService?.getAnimationLevel?.() === 'off'; } catch { return false; }
  }

  _sound(id, opts) { try { game.nightcity?.soundService?.play?.(id, opts); } catch { /* sound is never worth failing a call */ } }

  _mount() {
    if (this.root?.isConnected) return this.root;
    this.root = document.createElement('div');
    this.root.className = 'ncm-r5-layer';
    document.body.appendChild(this.root);
    this.root.addEventListener('click', (e) => this._click(e));
    return this.root;
  }

  /** A state of the real card, with the frame's contents and one panel added. */
  _card({ name, number, state, kind, feed = '', panel = '', why = '', stopLabel, frameWord, keys = true }) {
    const id = `em${++this.n}`, now = Date.now();
    const call = { id, from: { name, number, img: 'NOFACE', contactId: null, known: true }, to: { userId: game.user.id, name: '', number: '', kind: 'player' }, net: this.calls?._net?.() || null, mode: 'loud', state, startedAt: now - 2300, answeredAt: now - 48000, endedAt: null, outcome: null, dropReason: why };
    this.fake.calls.set(id, call);
    let html = this.hud._callHtml({ call, role: 'caller' }, {});
    if (kind) html = html.replaceAll('data-dec="Holocall"', `data-dec="${esc(kind)}"`).replaceAll('>Holocall<', `>${esc(kind)}<`).replaceAll('data-dec="Calling…"', `data-dec="${esc(kind)}"`).replaceAll('>Calling…<', `>${esc(kind)}<`);
    if (stopLabel) html = html.replace('Hang up', esc(stopLabel));
    if (frameWord) html = html.replace('● LIVE', () => esc(frameWord));
    html = html.replace('<img src="NOFACE" alt="">', () => feed);
    if (panel) html = html.includes('<div class="ncm-ch-keys">') ? html.replace('<div class="ncm-ch-keys">', () => `${panel}<div class="ncm-ch-keys">`) : html.replace('</div></div>', () => `${panel}</div></div>`);
    if (!keys) html = html.replace(/<div class="ncm-ch-keys">[\s\S]*?<\/div>/, '');
    return html;
  }

  /** Everything off the screen at once. The way out for an interruption; a normal end goes through `_leave`. */
  _stop() {
    this.timers.forEach(clearTimeout); this.timers = [];
    clearInterval(this._tick); clearTimeout(this._beepT);
    this.run = null; this.fx = null;
    if (this.root) this.root.innerHTML = '';
  }

  // ═══ The scene: built once per call ═══

  /**
   * Open the scene. `o` = { kind, color, title, subtitle, img, icon, lights, place, bpm }
   * The sting and the sound are the opening; the tracker stays until the call leaves.
   */
  _open(o) {
    const root = this._mount();
    const still = this.still;
    root.innerHTML = `<div class="ncm-r5-scene ncm-em-scene is-${esc(o.kind)}${o.kind === 'backup' && !o.lights ? ' no-lights' : ''}" style="--ch-ring:${o.color};--ch-live:${o.color};--ch-key:#fff;--em:${o.color}">
      <span class="ncm-em-sweep"></span>
      <div class="ncm-em-alert" data-em-alert></div>
      <div class="ncm-em-row">
        <div class="ncm-call-hud ncm-r5-hud" data-em-card style="--ch-ring:${o.color};--ch-live:${o.color};--ch-key:#fff"></div>
        <div class="ncm-em-track"><canvas data-em-track width="232" height="232"></canvas><div class="ncm-em-track__w" data-em-word></div></div>
      </div>
      <div data-em-sub></div>
      ${still ? '' : this._stingHtml(o, 'open')}
    </div>`;
    this.fx = { kind: o.kind, color: o.color, lights: !!o.lights, phase: 0, busy: false, bpm: o.bpm || 76, t0: performance.now(), place: o.place || '', cardKey: null, subText: null, closeMs: 3000, inMs: 11000 };
    this._setWord(o.kind, 0);
    this._runTrack(root.querySelector('[data-em-track]'));
    if (!still) this.timers.push(setTimeout(() => root.querySelector('.ncm-em-sting')?.remove(), EM_TIMES.sting));
    return root;
  }

  _stingHtml(o, how) {
    const mark = o.img ? `<img class="art" src="${esc(o.img)}" alt="">` : `<i class="fas ${o.icon || 'fa-truck-medical'}"></i>`;
    return `<div class="ncm-em-sting is-${how}"><div class="ncm-em-sting__in">${mark}<div class="tx"><b>${esc(o.title)}</b><small>${esc(o.subtitle)}</small></div></div></div>`;
  }

  /** A step: only what changed. The card's first state plays the real entrance; later steps replace just the panel. */
  _paint() {
    const r = this.run, fx = this.fx;
    if (!r || !fx || !this.root) return;
    const v = r.html(), scene = this.root.querySelector('.ncm-em-scene');
    if (!scene) return;
    scene.classList.toggle('is-room', !!v.room);
    const alertBox = scene.querySelector('[data-em-alert]');
    if (alertBox && alertBox.innerHTML !== (v.alert || '')) alertBox.innerHTML = v.alert || '';
    const slot = scene.querySelector('[data-em-card]');
    if (fx.cardKey !== v.key) {
      fx.cardKey = v.key;
      slot.innerHTML = v.card;
      slot.querySelector('.ncm-ch-badge')?.classList.add('is-in');
      slot.querySelector('.ncm-ch-pic')?.classList.add('is-in');
      this._animate(slot);
      const t0 = performance.now();
      clearInterval(this._tick);
      this._tick = setInterval(() => { if (!slot.isConnected) return clearInterval(this._tick); const t = performance.now() - t0; slot.querySelectorAll('.ncm-ch-badge').forEach((b) => this.hud._paintBadge(b, t)); }, 120);
    } else {
      const tmp = document.createElement('div');
      tmp.innerHTML = v.card;
      const next = tmp.querySelector('.ncm-r5-em'), now = slot.querySelector('.ncm-r5-em');
      if (next && now) now.replaceWith(next);
      const nextCanvas = tmp.querySelector('canvas[data-wave]'), canvas = slot.querySelector('canvas[data-wave]');
      if (nextCanvas && canvas) { canvas.dataset.wave = nextCanvas.dataset.wave; canvas.dataset.col = nextCanvas.dataset.col; }
    }
    const subBox = scene.querySelector('[data-em-sub]');
    const subKey = v.sub ? `${v.sub.who}|${v.sub.text}` : '';
    if (fx.subText !== subKey) {
      fx.subText = subKey;
      subBox.innerHTML = v.sub ? `<div class="ncm-ch-subs ncm-r5-subs"><div class="ncm-ch-sublines"><div class="ncm-ch-sub now"><b>${esc(v.sub.who)}:</b> <span class="tx" data-type="${esc(v.sub.text)}"></span></div></div></div>` : '';
      this._animate(subBox);
    }
  }

  _setWord(kind, phase) {
    const fx = this.fx;
    if (!fx) return;
    fx.phase = phase; fx.phaseAt = performance.now();
    const el = this.root?.querySelector('[data-em-word]');
    if (el) { el.textContent = trackWords(kind, phase, { place: fx.place, busy: fx.busy }); el.classList.toggle('is-bad', !!fx.busy); }
  }

  /** The tracker: a sweep, a reticle closing on you, then the team coming in from the edge. */
  _runTrack(c) {
    if (!c) return;
    const g = c.getContext('2d'), S = c.width, mid = S / 2, R = mid - 6, still = this.still;
    const col = this.fx.color, law = this.fx.kind === 'backup';
    const seed = (this.n * 37) % 360;
    const draw = (now) => {
      const fx = this.fx;
      if (!c.isConnected || !fx) return;
      const t = now - fx.t0, since = now - (fx.phaseAt || fx.t0);
      g.clearRect(0, 0, S, S);
      g.lineWidth = 1;
      g.strokeStyle = 'rgba(255,255,255,.14)';
      for (const k of [0.33, 0.66, 1]) { g.beginPath(); g.arc(mid, mid, R * k, 0, Math.PI * 2); g.stroke(); }
      g.beginPath(); g.moveTo(mid - R, mid); g.lineTo(mid + R, mid); g.moveTo(mid, mid - R); g.lineTo(mid, mid + R); g.stroke();
      // the sweep
      const a = (t / 2800) * Math.PI * 2;
      const fan = g.createConicGradient ? g.createConicGradient(a - 0.9, mid, mid) : null;
      if (fan) { fan.addColorStop(0, 'rgba(0,0,0,0)'); fan.addColorStop(0.14, `${col}66`); fan.addColorStop(0.145, 'rgba(0,0,0,0)'); g.fillStyle = fan; g.beginPath(); g.arc(mid, mid, R, 0, Math.PI * 2); g.fill(); }
      g.strokeStyle = col; g.lineWidth = 1.4; g.beginPath(); g.moveTo(mid, mid); g.lineTo(mid + Math.cos(a) * R, mid + Math.sin(a) * R); g.stroke();
      // the reticle closes on the caller
      if (fx.phase >= 1 && !(law && fx.busy)) {
        const k = fx.phase === 1 ? Math.min(1, since / fx.closeMs) : 1, r = 84 - k * 70;
        g.strokeStyle = col; g.lineWidth = 2;
        for (let i = 0; i < 4; i++) { const b = i * Math.PI / 2 + (1 - k) * 2.2; g.beginPath(); g.arc(mid, mid, r, b + 0.25, b + Math.PI / 2 - 0.25); g.stroke(); }
        g.fillStyle = col; g.beginPath(); g.arc(mid, mid, 3, 0, Math.PI * 2); g.fill();
      }
      // the team comes in from the edge
      if (fx.phase >= 3 && !fx.busy) {
        const count = law ? 3 : 1, k = Math.min(1, since / fx.inMs);
        for (let i = 0; i < count; i++) {
          const dir = ((seed + i * 47) * Math.PI) / 180, dist = R * (1 - 0.82 * k) * (1 + i * 0.08);
          const x = mid + Math.cos(dir) * dist, y = mid + Math.sin(dir) * dist;
          g.setLineDash([3, 4]); g.strokeStyle = `${col}aa`; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(mid, mid); g.stroke(); g.setLineDash([]);
          g.fillStyle = law && fx.lights && Math.floor(t / 800) % 2 ? '#ff7b7b' : col;
          g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill();
        }
      }
      if (!still) requestAnimationFrame(draw);
    };
    if (still) draw(performance.now()); else requestAnimationFrame(draw);
  }

  /** The monitor beeps with the heart. Stops when the call does. */
  _startBeep(run) {
    if (this.still) return;
    const beat = () => {
      if (this.run !== run || !this.fx) return;
      this._sound('em-monitor', { volume: 0.28 });
      this._beepT = setTimeout(beat, 60000 / this.fx.bpm);
    };
    clearTimeout(this._beepT);
    beat();
  }

  /**
   * The way a call ends. The card uses the real call screen's exit; the tracker folds and the room lets go.
   * @param {{title?: string, subtitle?: string, sound?: string}} [closing] - a closing sting, when the job went through
   */
  _leave(closing = null) {
    const run = this.run, fx = this.fx, scene = this.root?.querySelector('.ncm-em-scene');
    if (!run || !scene || this.still) { this._stop(); this._paintMini(); return; }
    if (run.leaving) return;
    run.leaving = true;
    this.timers.forEach(clearTimeout); this.timers = [];
    clearTimeout(this._beepT);
    if (closing?.sound) this._sound(closing.sound);
    if (closing) scene.insertAdjacentHTML('beforeend', this._stingHtml({ kind: fx.kind, title: closing.title, subtitle: closing.subtitle, img: closing.img }, 'close'));
    const out = () => {
      if (this.run !== run) return;
      scene.classList.add('is-leaving');
      scene.querySelector('.ncm-ch-call')?.classList.add('is-out');
      scene.querySelector('.ncm-ch-subs')?.classList.add('is-leaving');
      this.timers.push(setTimeout(() => { if (this.run === run) { this._stop(); this._paintMini(); } }, EM_TIMES.leave));
    };
    if (closing) this.timers.push(setTimeout(out, EM_TIMES.closing - EM_TIMES.leave)); else out();
  }

  /** Canvases and typed dispatch lines. */
  _animate(root) {
    const still = this.still;
    root.querySelectorAll('[data-type]').forEach((el) => {
      const text = el.dataset.type;
      if (still) { el.textContent = text; return; }
      const ms = typeMs(text), t0 = performance.now();
      const tick = (now) => { if (!el.isConnected) return; const k = Math.ceil(Math.min(1, (now - t0) / ms) * text.length); el.textContent = text.slice(0, k); if (k < text.length) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    root.querySelectorAll('canvas[data-ecg],canvas[data-wave]').forEach((c) => {
      const g = c.getContext('2d'), W = c.width, H = c.height, isWave = 'wave' in c.dataset, col = c.dataset.col || getComputedStyle(c).getPropertyValue('--ch-live') || '#ff5a66', t0 = performance.now();
      let x = 0, last = H / 2, jit = 0;
      if (still) { g.strokeStyle = col; g.lineWidth = 1.6; g.beginPath(); g.moveTo(0, H / 2); [0.2, 0.23, 0.26, 0.29, 0.32].forEach((k, i) => g.lineTo(W * k, H / 2 + [0, -H * 0.36, H * 0.15, 0, 0][i])); g.lineTo(W, H / 2); g.stroke(); return; }
      const frame = (now) => {
        if (!c.isConnected) return;
        if (isWave) {
          g.clearRect(0, 0, W, H);
          const tx = c.dataset.wave === 'tx', burst = c.dataset.wave === 'static';
          g.strokeStyle = c.dataset.col || col; g.lineWidth = 1.6; g.beginPath();
          for (let i = 0; i < W; i += 2) { const k = i / W, env = burst ? 1 : Math.sin(k * Math.PI), a = burst ? Math.random() * H * 0.46 : (tx ? H * 0.38 : H * 0.05) * env * (0.45 + 0.55 * Math.abs(Math.sin((now - t0) / 170 + i * 0.15))); const y = H / 2 + (i % 4 ? a : -a); if (i) g.lineTo(i, y); else g.moveTo(i, y); }
          g.stroke(); requestAnimationFrame(frame); return;
        }
        const { bpm, wob } = vitals(Number(c.dataset.hp), Number(c.dataset.max)), period = 60000 / bpm, ph = ((now - t0) % period) / period;
        const blip = ph < 0.08 ? -Math.sin(ph / 0.08 * Math.PI) * H * 0.4 : ph < 0.13 ? Math.sin((ph - 0.08) / 0.05 * Math.PI) * H * 0.16 : ph > 0.3 && ph < 0.42 ? -Math.sin((ph - 0.3) / 0.12 * Math.PI) * H * 0.08 : 0;
        jit += (Math.random() - 0.5) * wob; jit *= 0.9;
        const y = H / 2 + blip + jit * 2;
        // fades the old trace away, not to black, so a picture behind it stays
        g.globalCompositeOperation = 'destination-out'; g.fillStyle = 'rgba(0,0,0,.09)'; g.fillRect(0, 0, W, H); g.globalCompositeOperation = 'source-over'; g.clearRect(x + 2, 0, 10, H);
        g.strokeStyle = col; g.lineWidth = 1.6; g.beginPath(); g.moveTo(x, last); x = (x + 1.4) % W; g.lineTo(x, y); if (x > 2) g.stroke(); last = y;
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
  }

  _click(e) {
    const r = this.run;
    if (!r || r.leaving) return;
    const key = e.target.closest?.('[data-act]');
    if (key?.dataset.act === 'hangup' || key?.dataset.act === 'cancel') return r.hang?.();
    if (e.target.closest?.('[data-em-retry]') && r.retryOk) return r.retry?.();
    r.skip?.();
  }

  /** Run steps on their timers; a click jumps to the next that waits on a die. */
  _beats(list, onBeat, jumpTo) {
    this.timers.forEach(clearTimeout); this.timers = [];
    if (this.still) { onBeat(jumpTo); return; }
    onBeat(0);
    list.forEach((ms, i) => { if (i && i <= jumpTo) this.timers.push(setTimeout(() => onBeat(i), ms)); });
  }

  /** The call never went out. A short card in the same place. */
  _noSignalCard(o, name, number, why, stopLabel) {
    this._stop();
    this._open({ ...o, title: name, subtitle: 'No signal' });
    this.root.querySelector('.ncm-em-sting')?.remove();
    this.root.querySelector('.ncm-em-track')?.setAttribute('hidden', '');
    this.fx.busy = true;
    const run = { html: () => ({ key: 'ended', card: this._card({ name, number, state: 'ended', why, stopLabel }) }), skip: () => this._leave(), hang: () => this._leave() };
    this.run = run;
    this._paint();
    this.timers.push(setTimeout(() => { if (this.run === run) this._leave(); }, 5000));
  }

  // ═══ Trauma Team ═══

  /** @param {Actor} actor — whose plan @param {Actor} patient — who it is for */
  async trauma(actor, patient = actor, { auto = false, preview = false } = {}) {
    if (!preview && !this.service?.enabled) return;   // utils/features.js: the emergency lines are switched off
    const svc = this.service, info = svc.traumaInfo(actor, patient);
    const line = svc.traumaLine(), callName = line.name.toUpperCase();
    const noSignal = !preview && this.calls?._noSignal?.();
    const word = auto ? 'Biomonitor alert' : 'Emergency';
    const pulse = vitals(info.hp, info.max || 1);
    const frameWord = info.plan === 'exec' ? 'EXECUTIVE' : 'SILVER';
    const planName = PLAN_NAMES[info.plan] || '';
    const voice = info.voice;
    const say = (key, extra = {}) => fillLine(voice[key], { place: info.place, name: info.patient, line: line.name, plan: planName, ...extra });
    const scene = {
      kind: 'trauma', color: '#ff5a66', title: callName, subtitle: auto ? 'Biomonitor alert · line open' : `${planName} plan · priority line`, img: line.img, icon: 'fa-truck-medical', place: info.place, bpm: pulse.bpm,
    };
    this._stop();
    if (noSignal) return this._noSignalCard(scene, callName, line.number, auto ? 'Your Biomonitor could not get a signal. No call went out.' : 'No signal. The call did not go out.');
    this._open(scene);
    const root = this.root.querySelector('.ncm-em-scene');
    root.style.setProperty('--beat', `${60 / pulse.bpm}s`);
    const lines = ['<b>Checking your plan.</b>', `<b>${esc(planName)} plan active.</b>`, `<b>${esc(info.place)}.</b> Sending a team.`];
    let beat = 0, rounds = 0, hung = false;
    const alert = auto ? `<div class="ncm-r5-alert"><i class="fas fa-heart-pulse"></i> HP ${info.hp} is under BODY ${info.body}. Your Biomonitor is calling for you.</div>` : '';
    const run = {
      html: () => {
        if (beat < 1) return { key: 'dial', alert, card: this._card({ name: callName, number: line.number, state: 'dialing', kind: word, keys: false }) };
        const at = Math.min(beat - 1, 3);
        const body = beat >= 4 ? `<div class="ncm-r5-row">${die(rounds, 6)}<span><b>${esc(say('team'))} inbound.</b> ${rounds} round${rounds === 1 ? '' : 's'} out, first in the order.</span>${pips(rounds, rounds, 'fa-truck-medical')}</div>`
          : beat === 3 ? `<div class="ncm-r5-row">${die('', 6, true)}<span>${lines[2]}</span></div>` : `<div class="ncm-r5-row"><span class="ncm-r5-scan"></span><span>${lines[beat - 1]}</span></div>`;
        return { key: 'live', room: true, alert,
          card: this._card({ name: callName, number: line.number, state: 'live', kind: word, feed: ecg(info.hp, info.max, line.img), frameWord, panel: `<div class="ncm-r5-em">${steps(TRAUMA_STEPS, beat >= 4 ? 4 : at)}${body}</div>` }),
          sub: { who: say('speaker'), text: beat >= 4 ? say('inbound', { rounds }) : beat === 3 ? say('send') : beat === 2 ? say('locate') : say('confirm') } };
      },
      hang: () => { hung = true; this._leave(); },
      skip: () => { if (beat < 3) { this.timers.forEach(clearTimeout); this.timers = []; go(3); } },
    };
    this.run = run;
    if (!preview) svc.announce(info, { auto });
    this._sound('em-sting-trauma');
    const pace = organicBeats(TRAUMA_BEATS);
    this.fx.closeMs = (pace[2] - pace[1]) * 0.85;
    this.fx.inMs = TRAUMA_HOLD;
    // it rings a few times before anyone picks up
    if (!this.still) for (const at of [pace[1] * 0.35, pace[1] * 0.68]) this.timers.push(setTimeout(() => { if (this.run === run) this._sound('call-ringback'); }, at));
    const roll = async () => {
      if (preview) await svc.showDie('1d6', 3);
      rounds = preview ? 3 : await svc.rollTrauma(info, { auto });
      if (!preview) await svc.register({ ...info, auto }, rounds);
      if (this.run !== run || hung) return;
      beat = 4; this._setWord('trauma', 3); this._paint();
      this.timers.push(setTimeout(() => { if (this.run === run) this._leave({ title: say('closeTitle', { rounds }).toUpperCase(), subtitle: `${rounds} round${rounds === 1 ? '' : 's'} out · stay where you are`, img: line.img, icon: 'fa-truck-medical' }); }, TRAUMA_HOLD));
    };
    const go = (i) => {
      beat = i;
      if (this.run !== run) return;
      if (i === 1) { this._sound('call-connect'); this._startBeep(run); }
      if (i === 1 || i === 2) this._setWord('trauma', i);
      if (i === 3) { this._sound('em-dispatch'); this.timers.forEach(clearTimeout); this.timers = []; this.timers.push(setTimeout(roll, this.still ? 0 : pace[4] - pace[3])); }
      this._paint();
    };
    this._beats(pace, go, 3);
  }

  // ═══ Backup ═══

  async backup(actor, groupName = null, { preview = false, previewBusy = false } = {}) {
    if (!preview && !this.service?.enabled) return;   // utils/features.js: the emergency lines are switched off
    const svc = this.service, info = svc.backupInfo(actor, groupName);
    const look = info.look, col = look.color, red = '#ff7b7b', chan = info.voice.channel || `CH-${(actor.id.charCodeAt(0) % 8) + 1}`;
    const say = (key, extra = {}) => fillLine(info.voice[key], { place: info.place, name: info.name, org: info.org, group: info.group, ...extra });
    const noSignal = !preview && this.calls?._noSignal?.();
    const name = info.org.toUpperCase();
    const scene = {
      kind: 'backup', color: col, lights: look.lights, title: say('openTitle').toUpperCase(), subtitle: `${info.org} · ${chan}`, img: info.img, icon: look.icon, place: info.place,
    };
    this._stop();
    if (noSignal) return this._noSignalCard(scene, name, 'BACKUP', 'No signal. The call did not go out.');
    this._open(scene);
    let beat = 0, d10 = null, res = null, busy = false;
    const run = {
      retryOk: false,
      html: () => {
        if (beat < 1) return { key: 'dial', card: this._card({ name, number: 'BACKUP', state: 'dialing', kind: 'Backup', keys: false }) };
        let body = '';
        if (beat === 1) body = `<div class="ncm-r5-row"><span class="ncm-r5-scan"></span><span><b>Calling it in.</b> ${esc(info.org)} · ${esc(chan)}</span></div>`;
        else if (beat === 2) body = `<div class="ncm-r5-row">${die('', 10, true)}<span>Rank ${info.rank}: you need ${info.rank} or lower.</span></div>`;
        else if (busy) body = `<div class="ncm-r5-row">${die(d10, 10)}<span><b>Nobody free.</b> Rolled ${d10}, needed ${info.rank} or lower. Try again next Turn.</span></div><div class="ncm-r5-row"><button type="button" class="ncm-r5-retry"${run.retryOk ? '' : ' disabled'} data-em-retry data-tooltip="${tipText(run.retryOk ? 'Another Action, another roll' : 'Available on your next Turn')}"><i class="fas fa-rotate-right"></i> Call again</button></div>`;
        else if (beat === 3) body = `<div class="ncm-r5-row">${die(d10, 10)}<span><b>${esc(info.group)} responding.</b> Rolled ${d10}.</span></div>`;
        else body = `<div class="ncm-r5-row">${die(res.rounds, 6)}<span><b>${esc(res.who)} inbound.</b> ${res.rounds} round${res.rounds === 1 ? '' : 's'} out.${res.up ? ' The d6 came up 6, so the next group up answers.' : ''}</span>${pips(res.rounds, res.rounds, look.icon)}</div>`;
        const signal = busy && beat >= 3 ? 'static' : beat <= 2 ? 'tx' : 'idle';
        return { key: 'live', room: !busy && beat >= 3,
          card: this._card({ name, number: 'BACKUP', state: 'live', kind: 'Backup', frameWord: chan, feed: wave(signal, busy && beat >= 3 ? red : col, chan, info.img), panel: `<div class="ncm-r5-em">${steps(BACKUP_STEPS, busy && beat >= 3 ? 1 : beat >= 4 ? 4 : beat - 1)}${body}</div>` }),
          sub: { who: beat >= 2 ? say('speaker') : say('caller'), text: beat >= 4 ? say('inbound', { group: res.who, rounds: res.rounds }) : beat === 3 ? (busy ? say('busy') : say('answer')) : beat === 2 ? say('standby') : say('ask') } };
      },
      hang: () => this._leave(),
      skip: () => { if (beat < 2) { this.timers.forEach(clearTimeout); this.timers = []; go(2); } },
      retry: () => { this._stop(); this.backup(actor, groupName, { preview, previewBusy }); },
    };
    this.run = run;
    if (!preview) svc.announce(info);
    this._sound(look.openSound);
    const pace = organicBeats(BACKUP_BEATS);
    if (!this.still) for (const at of [pace[1] * 0.3, pace[1] * 0.62]) this.timers.push(setTimeout(() => { if (this.run === run) this._sound('call-ringback'); }, at));
    this.fx.closeMs = (pace[2] - pace[1]) * 0.85;
    this.fx.inMs = BACKUP_HOLD;
    const answer = async () => {
      d10 = previewBusy ? Math.min(10, (info.rank || 0) + 1) : preview ? Math.max(1, Math.min(info.rank || 1, 4)) : await svc.rollBackupAnswer(info);
      if (preview) await svc.showDie('1d10', d10);
      if (this.run !== run) return;
      busy = previewBusy || (!preview && d10 > info.rank); beat = 3;
      this.fx.busy = busy;
      this._setWord('backup', 2);
      this._sound(busy ? 'call-drop' : 'em-radio-out');
      this._paint();
      if (busy) {
        // no combat means there is no Turn to wait for
        if (!game.combat?.started) { run.retryOk = true; this._paint(); }
        else { const h = Hooks.on('updateCombat', () => { Hooks.off('updateCombat', h); run.retryOk = true; if (this.run === run) this._paint(); }); }
        return;
      }
      this.timers.push(setTimeout(async () => {
        if (preview) await svc.showDie('1d6', 3);
        res = preview ? { rounds: 3, who: info.group, up: false } : await svc.rollBackupRounds(info, d10);
        if (!preview) await svc.register({ ...info, group: res.who }, res.rounds);
        if (this.run !== run) return;
        beat = 4; this._setWord('backup', 3); this._sound('em-dispatch'); this._paint();
        this.timers.push(setTimeout(() => { if (this.run === run) this._leave({ title: say('closeTitle', { group: res.who, rounds: res.rounds }).toUpperCase(), subtitle: `${res.who} · ${res.rounds} round${res.rounds === 1 ? '' : 's'} out`, img: info.img, icon: look.icon, sound: 'em-radio-out' }); }, BACKUP_HOLD));
      }, this.still ? 0 : pace[4] - pace[3]));
    };
    const go = (i) => {
      beat = i;
      if (this.run !== run) return;
      if (i === 1) { this._sound('em-radio-in'); this._setWord('backup', 1); }
      if (i === 2) { this._setWord('backup', 2); this.timers.forEach(clearTimeout); this.timers = []; this.timers.push(setTimeout(answer, this.still ? 0 : pace[3] - pace[2])); }
      this._paint();
    };
    this._beats(pace, go, 2);
  }

  // ═══ what stays on screen ═══

  /** A small strip for each team on its way to this player's characters. The team still comes after a hang up. */
  _paintMini() {
    let box = document.getElementById('ncm-r5-minis');
    const mine = (this.service.active?.() || []).filter((e) => !e.arrived && game.actors?.get(e.actorId)?.isOwner && !game.user.isGM);
    if (!mine.length) { box?.remove(); return; }
    if (!box) {
      box = document.createElement('div'); box.id = 'ncm-r5-minis'; document.body.appendChild(box);
      box.addEventListener('click', (ev) => { const b = ev.target.closest('[data-mini]'); if (!b) return; this._miniOpen = this._miniOpen === b.dataset.mini ? null : b.dataset.mini; this._paintMini(); });
    }
    const combatOn = !!game.combat?.started;
    box.innerHTML = mine.map((e) => `<button type="button" class="ncm-r5-mini" data-mini="${esc(e.id)}" aria-expanded="${this._miniOpen === e.id}" data-tooltip="What is this?"><i class="fas ${e.kind === 'trauma' ? 'fa-truck-medical' : backupLook(e.lights ? 'Police' : 'Private').icon}"></i><b>${esc(e.kind === 'trauma' ? this.service.traumaLine().name : e.group)}</b> ${pips(e.left, e.rounds, e.kind === 'trauma' ? 'fa-truck-medical' : backupLook(e.lights ? 'Police' : 'Private').icon)}<small>${e.left} round${e.left === 1 ? '' : 's'}${e.held ? ' · held' : ''}</small></button>${this._miniOpen === e.id ? `<div class="ncm-r5-miniwhy">${esc(miniWhy(e, { combatOn }))}</div>` : ''}`).join('');
  }

  /** They arrive: searchlights, or red and blue sweeps. Never a strobe. It leaves the way it came in. */
  arrival(show) {
    const el = document.createElement('div');
    const tt = show.kind === 'trauma';
    const look = backupLook(show.lights ? 'Police' : 'Private', { color: show.color, arriveSound: show.arriveSound });
    const lineName = this.service.traumaLine().name;
    const heading = fillLine(show.arriveTitle || (tt ? TRAUMA_SLOTS : BACKUP_SLOTS).find((s) => s.key === 'arriveTitle').def, { place: show.place, name: show.name, org: show.org, group: show.group, line: lineName, plan: show.plan }).toUpperCase();
    el.className = `ncm-r5-scene ncm-r5-landing ${tt ? 'is-ttarrive' : 'is-bkarrive'}`;
    el.innerHTML = `<div class="ncm-r5-arrive ${tt ? 'is-tt' : look.lights ? 'is-bk' : 'is-ally'}"${!tt && show.color ? ` style="--a:${esc(show.color)}"` : ''}><span class="beam"></span><span class="beam b"></span><div class="in">${show.img ? `<img class="art" src="${esc(show.img)}" alt="">` : `<i class="fas ${tt ? 'fa-truck-medical' : look.icon}"></i>`}<b>${esc(heading)}</b><small>${esc(tt ? `${show.place} · first in the order` : `${show.group} · ${show.place}`)}</small></div></div>`;
    document.body.appendChild(el);
    this._sound(tt ? 'em-arrive-trauma' : look.arriveSound);
    const still = this.still;
    let gone = false;
    const out = () => {
      if (gone) return;
      gone = true;
      if (still) { el.remove(); return; }
      el.classList.add('is-out');
      setTimeout(() => el.remove(), EM_TIMES.arrivalOut);
    };
    el.addEventListener('click', out);
    setTimeout(out, EM_TIMES.arrival);
    this._paintMini();
  }
}
