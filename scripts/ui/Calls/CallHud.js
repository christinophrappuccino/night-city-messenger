/**
 * CallHud — the call over the scene (dev-approved mock dev/mockups/calls-overlay-mock.html).
 * @file scripts/ui/Calls/CallHud.js
 * @module night-city-messenger
 * @description Body-mounted, `pointer-events: none` except its prompts. One main badge (the call that is ringing for
 *   you, ringing out, or live), a call-waiting card under it, a held call's note, and missed-call badges top-right.
 *   It never opens a window. Driven by CallService events; reduced motion (the OS or the module's animation setting)
 *   paints end frames and skips every animation.
 *
 *   Phase 2 (Type): mode chips under a live call (only the modes the GM allows and that are built), and a SUBTITLES
 *   layer bottom-centre over the scene — the last few lines (the other side's type out), "X is typing…", and for a
 *   side in Type mode the thin type line (Enter sends). The subtitles live in their own layer and the type line is
 *   kept across redraws, so typing is never lost when the call badge redraws.
 */

import { MODULE_ID, EVENTS } from '../../utils/constants.js';
import { callProfile, signalLine } from '../../utils/callProfile.js';
import { OUTCOMES, MODE_INFO, formatDuration, callSeconds, sideOf, typeOutMs } from '../../utils/callModel.js';
import { Dictation, dictateStatus } from './dictation.js';
import { themedConfirm } from '../../utils/adminTheme.js';
import { dialogBodyHtml } from '../../utils/dialogBody.js';
import { normaliseNumber } from '../../utils/phoneNumbers.js';
import { voiceInfo } from '../../utils/identities.js';
import { TONE_LINE, VOICEMAIL_MAX } from '../../utils/voicemail.js';
import { speak, stopSpeaking } from './speech.js';
import { VoiceRecorder, micStatus, blobToBase64, playAudio } from './recorder.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const GLYPHS = '!<>-_/[]{}=+*^?#01ABCDEFXZ';
const RAND = () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
const BEAT = 1100;
const ENDED_HOLD_MS = 2600;
const SUBS_SHOWN = 4;          // lines on screen; the rest are in the transcript
const TYPING_CLEAR_MS = 4000;  // "is typing…" goes away after this long with nothing new

/** The ring dial (60×60): a broken outer ring that turns, 12 segments that fill once per ring. */
const pt = (r, deg) => { const t = (deg - 90) * Math.PI / 180; return [(30 + r * Math.cos(t)).toFixed(2), (30 + r * Math.sin(t)).toFixed(2)]; };
const arc = (r, a0, a1) => { const [x0, y0] = pt(r, a0), [x1, y1] = pt(r, a1); return `M${x0} ${y0} A${r} ${r} 0 0 1 ${x1} ${y1}`; };
const sector = (r1, r2, a0, a1) => { const [x0, y0] = pt(r2, a0), [x1, y1] = pt(r2, a1), [x2, y2] = pt(r1, a1), [x3, y3] = pt(r1, a0);
  return `M${x0} ${y0} A${r2} ${r2} 0 0 1 ${x1} ${y1} L${x2} ${y2} A${r1} ${r1} 0 0 0 ${x3} ${y3} Z`; };
export const DIAL_SVG = `<svg viewBox="0 0 60 60" aria-hidden="true"><g class="ncm-ch-brk">${[8, 98, 188, 278].map((d) => `<path pathLength="100" d="${arc(28, d, d + 64)}"/>`).join('')}</g>
  <g>${Array.from({ length: 12 }, (_, i) => `<path class="ncm-ch-seg" d="${sector(18.5, 21.5, i * 30 + 4, i * 30 + 26)}"/>`).join('')}</g></svg>`;
/** The portrait frame (100×110 over the 132×146 feed): notched outline, a label tab, a small right accent. */
const FRAME = (label) => `<svg class="ncm-ch-frm" viewBox="0 0 100 110" preserveAspectRatio="none" aria-hidden="true">
  <polygon class="ncm-ch-ol" points="11,0 100,0 100,79 94,85 94,110 15,110 0,96 0,11"/>
  <polygon class="ncm-ch-acc" points="16,0 52,0 49,-6 19,-6"/><text x="22" y="-1.4" style="font-size:4.4px">${esc(label)}</text>
  <rect class="ncm-ch-acc" x="98.6" y="30" width="3" height="10"/></svg>`;

export class CallHud {
  constructor(service) {
    this.service = service;
    this.root = null;
    /** @type {Map<string, {call: object, role: string, waiting?: boolean, endedAt?: number}>} */
    this.shown = new Map();
    this._mainId = null;
    this._tick = null;
    this._rendered = '';
    /** line ids to type out once (received lines), and who is typing on which call */
    this._fresh = new Set();
    this._typing = new Map();
    /** voicemail: greetings already read out (once per call), the GM's "read it out" choice per call */
    this._spoke = new Set();
    this._vmKind = new Map();
    /** a recording in progress / the clip waiting to be sent, per call; a greeting that is playing */
    this._rec = new Map();
    this._greetAudio = null;
    /** the open mic on the call this client is dictating on: { callId, d: Dictation, state, error } */
    this._dict = null;
  }

  init() {
    const bus = game.nightcity.eventBus;
    bus.on(EVENTS.CALL_RINGING, (e) => this._onEvent(e));
    bus.on(EVENTS.CALL_STARTED, (e) => this._onEvent(e));
    bus.on(EVENTS.CALL_ENDED, (e) => this._onEvent(e, true));
    bus.on(EVENTS.CALL_MISSED, (e) => this._missed(e.call));
    bus.on(EVENTS.VOICEMAIL_LEFT, (e) => { if (e?.vm) this._voicemailNotice(e.vm); });
    bus.on(EVENTS.CALL_GLITCH, (e) => this._glitch(e?.callId));
    bus.on(EVENTS.CALL_TRACED, (e) => {
      if (e?.from) ui.notifications?.info(`Trace complete — the withheld number was ${e.from.name || 'someone'}${e.from.number ? ` (${e.from.number})` : ''}.`, { permanent: true });
    });
    bus.on(EVENTS.CALL_LINE, (e) => {
      if (!e?.line) return;
      if (!e.mine) { this._fresh.add(e.line.id); this._typing.delete(e.callId); }
      this._renderSubs();
    });
    bus.on(EVENTS.CALL_TYPING, (e) => {
      if (!e?.callId) return;
      if (e.on) this._typing.set(e.callId, { side: e.side, at: Date.now(), how: e.how }); else this._typing.delete(e.callId);
      this._renderSubs();
      if (e.on) setTimeout(() => { const t = this._typing.get(e.callId); if (t && Date.now() - t.at >= TYPING_CLEAR_MS - 50) { this._typing.delete(e.callId); this._renderSubs(); } }, TYPING_CLEAR_MS);
    });
  }

  get reduced() {
    const os = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    const lvl = game.nightcity?.themeService?.getAnimationLevel?.();
    return !!os || lvl === 'off';
  }

  // ─── state ───

  _onEvent({ call, role, waiting, quiet }, ended = false) {
    if (!call || role === 'watch') { if (quiet && call) this._drop(call.id); return; }
    const prev = this.shown.get(call.id);
    this.shown.set(call.id, { call, role, waiting: waiting ?? prev?.waiting ?? false, endedAt: ended ? Date.now() : null });
    if (ended) setTimeout(() => this._out(call.id), ENDED_HOLD_MS);
    this.render();
  }

  _drop(id) { this.shown.delete(id); this.render(); }

  /** Animate a call out, then forget it. */
  _out(id) {
    const node = this.root?.querySelector(`[data-call="${CSS.escape(id)}"]`);
    if (!node || this.reduced) return this._drop(id);
    node.classList.add('is-out');
    node.querySelectorAll('[data-dec]').forEach((el) => this._scramble(el));
    setTimeout(() => this._drop(id), 700);
  }

  /** The call in the main badge: one ringing for me (unless I'm on a call — then it's the waiting card), else live / held / dialing / ended. */
  _layout() {
    const list = [...this.shown.values()];
    const active = list.filter((v) => v.call.state === 'live');
    const held = list.filter((v) => v.call.state === 'held');
    const ringingIn = list.filter((v) => v.call.state === 'ringing' && v.role === 'callee');
    const dialing = list.filter((v) => (v.call.state === 'dialing' || v.call.state === 'ringing') && v.role === 'caller');
    const ended = list.filter((v) => v.call.state === 'ended').sort((a, b) => b.endedAt - a.endedAt);
    const vmc = list.filter((v) => v.call.state === 'voicemail');
    const onCall = active.length || held.length;
    const main = active[0] || (onCall ? held[0] : null) || vmc[0] || dialing[0] || ringingIn[0] || ended[0] || null;
    const waiting = onCall ? ringingIn[0] || null : null;
    const heldOther = held.find((v) => v !== main) || null;
    return { main, waiting, heldOther };
  }

  // ─── render ───

  /** The HUD root: a stage for the call and a stack for missed-call badges (kept apart so one never wipes the other). */
  _ensureRoot() {
    if (this.root?.isConnected) return this.root;
    this.root = document.createElement('div');
    this.root.id = 'ncm-call-hud';
    this.root.className = 'ncm-call-hud';
    this.root.innerHTML = '<div class="ncm-ch-stage"></div><div class="ncm-ch-missedwrap"></div><div class="ncm-ch-subs" hidden></div>';
    document.body.appendChild(this.root);
    this.root.addEventListener('click', (e) => this._onClick(e));
    this.stage = this.root.querySelector('.ncm-ch-stage');
    this.subs = this.root.querySelector('.ncm-ch-subs');
    return this.root;
  }

  render() {
    this._ensureRoot();
    this._applyScheme();
    const { main, waiting, heldOther } = this._layout();
    this._renderSubs();
    if (!main) { this.stage.innerHTML = ''; this._mainId = null; this._rendered = ''; this._stopTick(); return; }
    const key = `${main.call.id}|${main.call.state}|${main.call.remoteHeld ? 1 : 0}|${waiting?.call.id || ''}|${heldOther?.call.id || ''}|${this.service.modeFor?.(main.call.id) || ''}|${main.call.vmStep || ''}`;
    if (key === this._rendered) return;
    // the call already on screen just ended: morph it in place (rebuilding replayed the entrance and jumped)
    if (main.call.state === 'ended' && this._mainId === main.call.id && this._wasState !== 'ended' && !waiting && !heldOther) {
      const node = this.stage.querySelector(`.ncm-ch-call[data-call="${CSS.escape(main.call.id)}"]`);
      if (node) { this._rendered = key; this._wasState = 'ended'; this._morphEnd(node, main.call); return; }
    }
    const fresh = this._mainId !== main.call.id || this._wasState !== main.call.state;
    this._rendered = key; this._mainId = main.call.id; this._wasState = main.call.state;
    this.stage.innerHTML = this._callHtml(main, { waiting, heldOther });
    if (fresh && !this.reduced) this._playIn(this.stage.querySelector('.ncm-ch-call'));
    this._startTick();
  }

  _applyScheme() {
    const s = this.service._get('callScheme', { scheme: 'ncm' }) || {};
    const st = this.root.style;
    const set = (ring, live, keys) => { st.setProperty('--ch-ring', ring); st.setProperty('--ch-live', live); st.setProperty('--ch-key', keys); };
    if (s.scheme === '2077') set('#5ef6ff', '#ff4b4b', '#fcee0a');
    else if (s.scheme === 'custom') set(s.ring || '#ff9d00', s.live || '#7cff4f', 'var(--ncm-accent, #f7c948)');
    else if (s.scheme === 'theme') set('var(--ncm-primary, #f65261)', 'var(--ncm-secondary, #19f3f7)', 'var(--ncm-accent, #f7c948)');
    else { st.removeProperty('--ch-ring'); st.removeProperty('--ch-live'); st.removeProperty('--ch-key'); }
  }

  /** The other party as this client may see them: a name only when they are in my contacts (the GM always sees it). */
  _other(call, role) {
    const o = role === 'caller' ? call.to : call.from;
    if (game.user.isGM) return { name: o.name || o.number || 'Unknown', img: o.img || '', number: o.number || '', known: true };
    const actor = game.actors?.get(role === 'caller' ? call.from?.actorId : call.to?.actorId);
    const contacts = actor?.getFlag?.(MODULE_ID, 'contacts') || [];
    const home = this.service.homeCode;
    const n = normaliseNumber(o.number, home);
    const hit = contacts.find((c) => (n && c.phone && normaliseNumber(c.phone, home) === n)
      || (o.contactId && c.masterContactId === o.contactId) || (o.actorId && c.actorId === o.actorId));
    return hit ? { name: hit.name || o.name || o.number, img: o.img || hit.portrait || '', number: o.number, known: true }
      : { name: o.number || 'Unknown number', img: '', number: o.number, known: false };
  }

  _netHtml(net) {
    if (!net) return '';
    const on = net.strength >= 80 ? 4 : net.strength >= 50 ? 3 : net.strength >= 25 ? 2 : 1;
    return `<span class="ncm-ch-net${on === 1 ? ' is-weak' : ''}" style="--nc:${esc(net.color || 'var(--ch-live)')}"><i class="fas fa-tower-broadcast"></i>${esc(net.name)}`
      + `<span class="ncm-ch-bars">${[1, 2, 3, 4].map((i) => `<b class="${i <= on ? 'on' : ''}"></b>`).join('')}</span></span>`;
  }

  _badgeHtml({ kind, name, tone, sigState, profile, callId, icon = 'fa-mobile-screen-button' }) {
    return `<div class="ncm-ch-badge is-${tone}" data-sig-state="${sigState}" data-profile="${esc(JSON.stringify(profile))}" data-call-ref="${esc(callId)}">
      <span class="ncm-ch-sig" data-sig></span>
      <span class="ncm-ch-dialarcs"><span class="ncm-ch-dial">${DIAL_SVG}<i class="fas ${icon}"></i></span>
        <span class="ncm-ch-arcs"><span class="a"></span><span class="a"></span><span class="a"></span></span></span>
      <span class="ncm-ch-body"><span class="ncm-ch-kind" data-dec="${esc(kind)}">${esc(kind)}</span>
        <span class="ncm-ch-chip"><span class="in"><b data-dec="${esc(name)}">${esc(name)}</b></span></span></span></div>`;
  }

  _callHtml(v, { waiting, heldOther }) {
    const { call, role } = v;
    const other = this._other(call, role);
    const st = call.state;
    const gmCallee = game.user.isGM && role === 'callee';
    let kind, tone, sigState, keys = [];
    if (st === 'ringing' && role === 'callee') {
      kind = gmCallee ? `${call.from?.name || 'Someone'} is calling` : 'Incoming call'; tone = 'ring'; sigState = 'ring';
      keys = [['answer', 'Y', gmCallee ? `Answer as ${call.to?.name || 'them'}` : 'Answer', ''], ['decline', 'N', 'Decline', 'bad']];
    } else if (st === 'dialing' || (st === 'ringing' && role === 'caller')) {
      kind = 'Calling…'; tone = 'ring'; sigState = 'ring'; keys = [['cancel', 'N', 'Cancel', 'bad']];
    } else if (st === 'live') {
      kind = call.remoteHeld ? 'On hold' : 'Holocall'; tone = 'live'; sigState = 'live'; keys = [['hangup', 'N', 'Hang up', 'bad']];
      // a withheld caller can be traced from the other end (a skill check; the GM reveals it on a success)
      if (role === 'callee' && call.from?.anon && !call.traced && !game.user.isGM) keys.unshift(['trace', 'T', 'Trace', '']);
    } else if (st === 'voicemail') {
      const leaving = call.vmStep === 'leave';
      kind = leaving ? 'Leave a message' : 'Voicemail'; tone = 'vm'; sigState = 'vm';
      keys = leaving ? [['hangup', 'N', 'Hang up', 'bad']] : [['skip', '⏎', 'Skip greeting', ''], ['hangup', 'N', 'Hang up', 'bad']];
    } else if (st === 'held') {
      kind = 'On hold'; tone = 'held'; sigState = 'live'; keys = [['resume', 'H', 'Back to this call', ''], ['hangup', 'N', 'Hang up', 'bad']];
    } else {
      kind = OUTCOMES[call.outcome] || 'Call ended'; tone = 'end'; sigState = 'end';
    }
    // the GM answering an NPC line: the badge names the identity being called
    const chipName = gmCallee ? (call.to?.name || call.to?.number || 'Unknown') : other.name;
    const net = call.net;
    const profile = callProfile({ name: role === 'caller' ? call.to?.name : call.from?.name, number: other.number, net: { name: net?.name, type: net?.type, strength: net?.strength } });
    const showPic = (st === 'live' || st === 'held' || (st === 'ended' && call.answeredAt)) && other.img;
    const pic = showPic ? `<div class="ncm-ch-pic"><div class="ncm-ch-feed"><img src="${esc(other.img)}" alt=""><span class="ncm-ch-sweep"></span></div>${FRAME(st === 'ended' ? 'ENDED' : st === 'held' ? 'HOLD' : '● LIVE')}</div>` : '';
    const voice = gmCallee ? this._voiceNote(call.to?.contactId) : '';
    const alias = gmCallee && call.to?.contactId ? this._aliasNote(call.to.contactId) : '';
    const meta = st === 'live' || st === 'held'
      ? `${this._netHtml(net)}<span class="ncm-ch-sep">·</span><span class="ncm-ch-time" data-timer>${formatDuration(callSeconds(call))}</span>`
      : `<span class="ncm-ch-num">${esc(gmCallee ? (call.from?.number || '') : other.number)}</span>${net ? `<span class="ncm-ch-sep">·</span>${this._netHtml(net)}` : ''}`;
    const waitHtml = waiting ? this._waitingHtml(waiting) : '';
    const hidden = call.from?.anon && !call.traced;
    const anonHtml = !hidden ? '' : role === 'caller' ? '<span class="ncm-ch-anon"><i class="fas fa-user-secret"></i> Your number is withheld</span>'
      : `<span class="ncm-ch-anon"><i class="fas fa-user-secret"></i> Number withheld${game.user.isGM ? ' — they cannot see who' : ''}</span>`;
    const whyHtml = st === 'ended' && call.dropReason ? `<div class="ncm-ch-why"><i class="fas fa-tower-broadcast"></i> ${esc(call.dropReason)}</div>` : '';
    const heldHtml = heldOther ? `<div class="ncm-ch-heldnote"><i class="fas fa-pause"></i> On hold · ${esc(this._other(heldOther.call, heldOther.role).name)}
      <span class="ncm-ch-keys"><span class="ncm-ch-key" data-act="resume" data-id="${esc(heldOther.call.id)}"><kbd>H</kbd>Swap back</span></span></div>` : '';
    const modes = (st === 'live' && role !== 'watch') ? (this.service.offeredModes || this.service.usableModes || []) : [];
    const usable = this.service.usableModes || [];
    const myMode = this.service.modeFor?.(call.id);
    const modesHtml = modes.length > 1 ? `<div class="ncm-ch-modes">${modes.map((m) => {
      const info = MODE_INFO[m] || { label: m, icon: 'fa-circle', tip: '' };
      const off = !usable.includes(m);
      const tip = off ? (m === 'dictate' ? this.service.dictateBlock : '') || 'Not available here.' : info.tip;
      return `<span class="ncm-ch-mode${m === myMode ? ' on' : ''}${off ? ' is-off' : ''}" data-mode="${esc(m)}" data-id="${esc(call.id)}" data-tooltip="${esc(tip)}" data-tooltip-direction="DOWN"><i class="fas ${esc(info.icon)}"></i> ${esc(info.label)}</span>`;
    }).join('')}</div>` : '';
    const keysHtml = keys.length ? `<div class="ncm-ch-keys">${keys.map(([act, k, label, cls]) => `<span class="ncm-ch-key ${cls}" data-act="${act}" data-id="${esc(call.id)}"><kbd>${k}</kbd>${esc(label)}</span>`).join('')}</div>` : '';
    return `<div class="ncm-ch-call is-${tone}" data-call="${esc(call.id)}">${pic}<div class="ncm-ch-txt">
      ${this._badgeHtml({ kind, name: chipName, tone, sigState, profile, callId: call.id, icon: st === 'voicemail' ? (call.vmStep === 'leave' ? 'fa-keyboard' : 'fa-voicemail') : undefined })}
      ${alias}${anonHtml}<span class="ncm-ch-meta">${meta}</span>${whyHtml}${voice}${modesHtml}${keysHtml}${heldHtml}${waitHtml}</div></div>`;
  }

  _waitingHtml(w) {
    const call = w.call;
    const other = this._other(call, 'callee');
    const profile = callProfile({ name: call.from?.name, number: other.number, net: call.net || {} });
    return `<div class="ncm-ch-wait">${this._badgeHtml({ kind: 'Call waiting', name: other.name, tone: 'ring', sigState: 'ring', profile, callId: call.id })}
      <div class="ncm-ch-note">${other.known ? esc(other.number) + ' · ' : 'Not in your contacts · '}goes to voicemail if you leave it</div>
      <div class="ncm-ch-keys"><span class="ncm-ch-key" data-act="answer" data-id="${esc(call.id)}"><kbd>H</kbd>Hold &amp; answer</span>
        <span class="ncm-ch-key bad" data-act="decline" data-id="${esc(call.id)}"><kbd>D</kbd>Decline</span></div></div>`;
  }

  _voiceNote(contactId) {
    const mcs = game.nightcity?.masterContactService;
    const c = contactId ? mcs?.getContact?.(contactId) : null;
    if (!c) return '';
    try {
      const v = voiceInfo(mcs.getAll(), c);
      return v?.text ? `<div class="ncm-ch-voice"><small>How they talk</small>${esc(v.text)}</div>` : '';
    } catch { return ''; }
  }

  _aliasNote(contactId) {
    const mcs = game.nightcity?.masterContactService;
    const c = mcs?.getContact?.(contactId);
    const main = c?.identityOf ? mcs.getContact(c.identityOf) : (c?.actorId ? mcs?.getByActorId?.(c.actorId) : null);
    return main && main.id !== c.id ? `<span class="ncm-ch-alias">alias of ${esc(main.name)}</span>` : '';
  }

  // ─── input ───

  _onClick(e) {
    const mode = e.target.closest('[data-mode]');
    if (mode) { this._pickMode(mode.dataset.id, mode.dataset.mode); return; }
    const dict = e.target.closest('[data-dict]');
    if (dict) { this._dictAct(dict.dataset.dict, dict.dataset.id); return; }
    const el = e.target.closest('[data-act]');
    if (!el) return;
    this.act(el.dataset.act, el.dataset.id);
  }

  /** A mode chip. Dictate: the reason where it can't work (and Type instead), else the notice once, then the mic. */
  async _pickMode(callId, mode) {
    const s = this.service;
    if (mode === 'dictate') {
      const block = s.dictateBlock;
      if (block) {
        ui.notifications?.warn(`NCM | ${block}`);
        if ((s.usableModes || []).includes('type')) s.setMode?.(callId, 'type');
        return;
      }
      if (!s.dictateConsent) {
        const vendor = dictateStatus().vendor;
        const ok = await themedConfirm({ title: 'Dictate', yes: 'Turn on Dictate', yesIcon: 'fas fa-microphone',
          content: dialogBodyHtml({ tone: 'act', icon: 'fas fa-microphone', title: 'Talk, and your words become subtitles',
            lead: `Your browser listens to your mic and sends the sound to **${vendor}** to turn it into text. NCM keeps only the words, like a typed call — never the sound. The mic is on only while Dictate is picked on a call, and you can mute it.`,
            hint: s.transcriptNotice ? 'The GM can read dictated calls, as with typed ones.' : '' }) });
        if (!ok) return;
        await s.setDictateConsent(true);
      }
    }
    s.setMode?.(callId, mode);
  }

  /** The dictate bar's buttons: pause / resume the mic, or fall back to Type. */
  _dictAct(act, callId) {
    if (act === 'type') { this._stopDict(); this.service.setMode?.(callId, 'type'); return; }
    if (act !== 'toggle' || !this._dict || this._dict.callId !== callId) return;
    if (this._dict.d.listening) this._dict.d.stop(); else { this._dict.error = ''; this._dict.d.start(); }
    this._paintDict();
  }

  /** Close the mic (the call moved on, the mode changed, the bar went away). */
  _stopDict() {
    const cur = this._dict;
    if (!cur) return;
    this._dict = null;
    cur.d.stop();
    this.service.sendTyping?.(cur.callId, false, 'talk');
  }

  /** The bar's live state: listening / paused / the reason it stopped; the words in progress. */
  _paintDict() {
    const bar = this.subs?.querySelector('.ncm-ch-say[data-mode="dictate"]');
    const cur = this._dict;
    if (!bar || !cur) return;
    const on = cur.d.listening;
    bar.classList.toggle('is-on', on);
    bar.classList.toggle('is-err', !!cur.error);
    const btn = bar.querySelector('[data-dict="toggle"]');
    if (btn) { btn.setAttribute('aria-pressed', String(on)); btn.dataset.tooltip = on ? 'Mute the mic' : 'Listen again'; btn.querySelector('i').className = `fas ${on ? 'fa-microphone' : 'fa-microphone-slash'}`; }
    const state = bar.querySelector('.state');
    if (state) state.textContent = cur.error ? cur.error : on ? (cur.interim ? '' : 'Listening — just talk') : 'Mic muted';
    const heard = bar.querySelector('.interim');
    if (heard) heard.textContent = on ? (cur.interim || '') : '';
    bar.querySelector('[data-dict="type"]')?.toggleAttribute('hidden', !cur.error || !(this.service.usableModes || []).includes('type'));
  }

  /** The dictate bar: a mic button, what is being heard, the notice. Opens the mic at once. */
  _dictBar(call, role) {
    const id = call.id;
    const me = this._speaker(call, role, sideOf(call, game.user.id) || 'caller');
    const vendor = dictateStatus().vendor;
    const say = document.createElement('div');
    say.className = 'ncm-ch-say is-dict';
    say.dataset.mode = 'dictate';
    say.innerHTML = `<span class="bar"><span class="who">${esc(me.name)}</span>
      <button type="button" class="ncm-ch-mic" data-dict="toggle" data-id="${esc(id)}" aria-pressed="true" aria-label="Mute or unmute the mic" data-tooltip="Mute the mic"><i class="fas fa-microphone"></i></button>
      <span class="heard"><span class="state" aria-live="polite"></span><span class="interim"></span></span>
      <button type="button" class="ncm-ch-mic is-type" data-dict="type" data-id="${esc(id)}" hidden><i class="fas fa-keyboard"></i> Type instead</button></span>
      <span class="note"><i class="fas fa-cloud"></i> Your speech goes to ${esc(vendor)} to become text${this.service.transcriptNotice && !game.user.isGM ? ' · the GM can read dictated calls' : ''}.</span>`;
    this.subs.appendChild(say);
    this._stopDict();
    const cur = { callId: id, interim: '', error: '', d: null };
    cur.d = new Dictation({
      onFinal: (text) => { if (this._dict === cur) { cur.interim = ''; this.service.sendLine(id, text, { via: 'dictate' }); this._paintDict(); } },
      onInterim: (text) => {
        if (this._dict !== cur) return;
        cur.interim = text;
        if (text) this.service.sendTyping(id, true, 'talk');
        this._paintDict();
      },
      onState: (_state, reason) => { if (this._dict !== cur) return; if (reason) cur.error = reason; this._paintDict(); },
    });
    this._dict = cur;
    cur.d.start();
    this._paintDict();
  }

  /** Run a prompt: answer | decline | cancel | hangup | resume — also what the key bindings call. */
  act(act, id) {
    const s = this.service;
    if (!id) return;
    if (act === 'answer') s.answer(id);
    else if (act === 'decline') s.decline(id);
    else if (act === 'cancel') s.cancel(id);
    else if (act === 'hangup') s.hangup(id);
    else if (act === 'resume') s.resume(id);
    else if (act === 'skip') s.skipGreeting?.(id);
    else if (act === 'trace') s.traceCall?.(id);
  }

  /** A key binding: the call it applies to, by what is on screen. */
  key(which) {
    const { main, waiting, heldOther } = this._layout();
    if (!main) return false;
    const c = main.call;
    if (which === 'answer' && c.state === 'ringing' && main.role === 'callee') { this.act('answer', c.id); return true; }
    if (which === 'decline') {
      if (c.state === 'ringing' && main.role === 'callee') this.act('decline', c.id);
      else if (c.state === 'dialing' || (c.state === 'ringing' && main.role === 'caller')) this.act('cancel', c.id);
      else if (c.state === 'live' || c.state === 'held') this.act('hangup', c.id);
      else return false;
      return true;
    }
    if (which === 'hold') {
      if (waiting) { this.act('answer', waiting.call.id); return true; }
      if (heldOther) { this.act('resume', heldOther.call.id); return true; }
      if (c.state === 'held') { this.act('resume', c.id); return true; }
      return false;
    }
    if (which === 'declineWaiting' && waiting) { this.act('decline', waiting.call.id); return true; }
    return false;
  }

  // ─── motion ───

  _playIn(node) {
    if (!node) return;
    node.querySelectorAll('.ncm-ch-badge, .ncm-ch-pic, .ncm-ch-txt').forEach((el) => el.classList.add('is-in'));
    node.querySelectorAll('.ncm-ch-kind[data-dec]').forEach((el) => this._decode(el, el.dataset.dec, 420, 120));
    node.querySelectorAll('.ncm-ch-chip b[data-dec]').forEach((el) => this._decode(el, el.dataset.dec, 520, 300));
  }

  /**
   * A call on screen ends: the same elements, changed in place. The call word scrambles into how it ended, the
   * colours slide to grey and the picture drains, the frame says ENDED, the prompts / mode chips / notes fade out.
   * Then _out folds it away as before. Reduced motion lands on the end frame at once.
   */
  _morphEnd(node, call) {
    const word = OUTCOMES[call.outcome] || 'Call ended';
    const sent = call.outcome === 'voicemail';
    node.classList.remove('is-ring', 'is-live', 'is-held', 'is-vm');
    node.classList.add('is-end', 'is-ending');
    const badge = node.querySelector(':scope > .ncm-ch-txt > .ncm-ch-badge');
    if (badge) {
      badge.classList.remove('is-ring', 'is-live', 'is-held', 'is-in', 'is-vm');
      // a voicemail that went: green, the dial closes full with a check (mock calls-overlay vm-sent)
      badge.classList.add(sent ? 'is-sent' : 'is-end');
      badge.dataset.sigState = sent ? 'sent' : 'end';
      if (sent) { const i = badge.querySelector('.ncm-ch-dial > i'); if (i) i.className = 'fas fa-check'; }
    }
    const label = node.querySelector('.ncm-ch-frm text');
    if (label) label.textContent = 'ENDED';
    for (const el of node.querySelectorAll(':scope > .ncm-ch-txt > :is(.ncm-ch-keys, .ncm-ch-modes, .ncm-ch-voice, .ncm-ch-heldnote, .ncm-ch-wait)')) el.classList.add('ncm-ch-fadeaway');
    if (call.dropReason && !node.querySelector('.ncm-ch-why')) {
      const why = document.createElement('div');
      why.className = 'ncm-ch-why ncm-ch-fadein';
      why.innerHTML = `<i class="fas fa-tower-broadcast"></i> ${esc(call.dropReason)}`;
      node.querySelector(':scope > .ncm-ch-txt > .ncm-ch-meta')?.after(why);
    }
    const kind = node.querySelector('.ncm-ch-kind');
    if (!kind) return;
    if (this.reduced) { kind.textContent = word; return; }
    // scramble what it said, then decode the outcome into the same place
    this._scramble(kind, 220);
    setTimeout(() => { if (kind.isConnected) this._decode(kind, word, 420); }, 230);
  }

  /** The GM glitched the line: the call stutters, the word reads "Signal unstable", the subtitles scramble. */
  _glitch(callId) {
    const node = callId && this.stage?.querySelector(`.ncm-ch-call[data-call="${CSS.escape(callId)}"]`);
    if (!node) return;
    game.nightcity?.soundService?.play?.('dead-zone', { volume: 0.5 });
    node.classList.add('is-glitch');
    const kind = node.querySelector('.ncm-ch-kind');
    const was = kind?.textContent || '';
    if (kind) { if (this.reduced) kind.textContent = 'Signal unstable'; else this._decode(kind, 'Signal unstable', 260); }
    if (!this.reduced) for (const l of this.root?.querySelectorAll('.ncm-ch-subs .ncm-ch-sub .tx') ?? []) {
      const real = l.textContent; this._scramble(l, 500); setTimeout(() => { if (l.isConnected) this._decode(l, real, 500); }, 1400);
    }
    setTimeout(() => {
      node.classList.remove('is-glitch');
      if (kind?.isConnected && kind.textContent === 'Signal unstable') { if (this.reduced) kind.textContent = was; else this._decode(kind, was, 320); }
    }, 2600);
  }

  _lockWidth(el, text) { el.textContent = text; el.style.width = ''; const w = el.getBoundingClientRect().width; Object.assign(el.style, { display: 'inline-block', width: `${w}px`, whiteSpace: 'nowrap', overflow: 'hidden' }); }

  _decode(el, text, ms, delay = 0) {
    this._lockWidth(el, text); el.style.visibility = 'hidden';
    const n = text.length; const t0 = performance.now() + delay;
    const tick = (now) => {
      if (!el.isConnected) return;
      const p = (now - t0) / ms;
      if (p < 0) return requestAnimationFrame(tick);
      el.style.visibility = '';
      const set = Math.floor(p * n);
      el.textContent = [...text].map((c, i) => (i < set || c === ' ' ? c : RAND())).join('');
      if (p < 1) requestAnimationFrame(tick); else el.textContent = text;
    };
    requestAnimationFrame(tick);
  }

  _scramble(el, ms = 360) {
    const text = el.textContent; this._lockWidth(el, text);
    const n = text.length; const t0 = performance.now();
    const tick = (now) => {
      if (!el.isConnected) return;
      const p = (now - t0) / ms; const gone = Math.floor(p * n);
      el.textContent = [...text].map((c, i) => (c === ' ' ? c : i < gone ? ' ' : RAND())).join('');
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /** One timer drives the signal lines, the dial fills and the call timer. */
  _startTick() {
    if (this._tick) return;
    const t0 = performance.now();
    const step = () => {
      if (!this.stage?.querySelector('.ncm-ch-call')) return this._stopTick();
      const now = performance.now();
      this.root.querySelectorAll('.ncm-ch-badge').forEach((b) => this._paintBadge(b, now - t0));
      this.root.querySelectorAll('[data-timer]').forEach((el) => {
        const call = this.service.calls.get(el.closest('[data-call]')?.dataset.call);
        if (call) el.textContent = formatDuration(callSeconds(call));
      });
    };
    step();
    this._tick = setInterval(step, this.reduced ? 1000 : 120);
  }

  _stopTick() { clearInterval(this._tick); this._tick = null; }

  _paintBadge(b, elapsed) {
    let p; try { p = JSON.parse(b.dataset.profile || '{}'); } catch { p = {}; }
    const state = b.dataset.sigState;
    const call = this.service.calls.get(b.dataset.callRef);
    if (state === 'sent') {
      const sig = b.querySelector('[data-sig]');
      if (sig) sig.innerHTML = 'Voicemail<span class="dim"> // </span>delivered';
      b.querySelectorAll('.ncm-ch-seg').forEach((g) => g.classList.add('on'));
      return;
    }
    if (state === 'vm') {
      const leaving = call?.vmStep === 'leave';
      // read from the HUD's own state — the badge is redrawn after the box is built, so nothing can live on it
      const id = b.dataset.callRef;
      const audio = this._vmKind.get(id) === 'audio';
      const len = this.subs?.querySelector('.ncm-ch-say.is-vm input')?.value.length || 0;
      const recMs = this._rec.get(id)?.ms || 0;
      const max = this.service.maxRecordMs || 60000;
      const sig = b.querySelector('[data-sig]');
      if (sig) sig.innerHTML = !leaving ? 'No answer<span class="dim"> // </span>routing to voicemail'
        : audio ? `<span class="rec">●</span> Recording<span class="dim"> // </span>voice<span class="dim"> · </span>${formatDuration(recMs / 1000)} / ${formatDuration(max / 1000)}`
        : `<span class="rec">●</span> Recording<span class="dim"> // </span>voicemail<span class="dim"> · </span>${len} / ${VOICEMAIL_MAX}`;
      const lit = leaving ? Math.ceil((audio ? recMs / max : len / VOICEMAIL_MAX) * 12) : (this.reduced ? 12 : Math.floor(((elapsed % (BEAT * 2)) / (BEAT * 2)) * 13));
      b.querySelectorAll('.ncm-ch-seg').forEach((g, i) => g.classList.toggle('on', i < lit));
      return;
    }
    const rings = call ? Math.max(1, Math.floor((Date.now() - call.startedAt) / BEAT) + 1) : 1;
    const line = signalLine(p, state, rings, this.reduced ? () => '·' : RAND);
    const sig = b.querySelector('[data-sig]');
    if (sig) sig.innerHTML = `${state === 'ring' ? '<span class="ar">▸</span> ' : ''}<span class="${line.warn ? 'warn' : ''}">${esc(line.lead)}</span><span class="dim"> // </span>`
      + line.parts.map((x) => `<span class="${x.tone === 'cipher' ? 'ci' : x.tone === 'dim' ? 'dim' : ''}">${esc(x.text)}</span>`).join('<span class="dim"> · </span>');
    const segs = b.querySelectorAll('.ncm-ch-seg');
    const lit = state === 'ring' ? (this.reduced ? 12 : Math.floor(((elapsed % BEAT) / BEAT) * 13)) : state === 'live' ? 12 : 0;
    segs.forEach((g, i) => g.classList.toggle('on', i < lit));
  }

  // ─── subtitles (phase 2) ───

  /** Names on a line: my side = who I am on the call, the other side = as I may see them (contacts rule). */
  _speaker(call, role, side) {
    const mine = sideOf(call, game.user.id) === side;
    if (mine) return { name: (side === 'caller' ? call.from?.name : call.to?.name) || 'You', mine: true };
    if (game.user.isGM) return { name: (side === 'caller' ? call.from?.name : call.to?.name) || 'Unknown', mine: false };
    return { name: this._other(call, role).name, mine: false };
  }

  /**
   * Paint the subtitles for the call in the main badge: the last lines, "is typing…", and the type line when this
   * side is typing. The type line element is created once per call and kept, so a redraw never eats what is typed.
   */
  _renderSubs() {
    if (!this.subs) return;
    const { main } = this._layout();
    const call = main ? this.service.calls.get(main.call.id) || main.call : null;
    const role = main?.role;
    const vmState = !!call && call.state === 'voicemail' && role === 'caller';
    const live = !!call && ((call.state === 'live' || call.state === 'held') && role !== 'watch' || vmState);
    const myMode = live && call.state === 'live' ? this.service.modeFor?.(call.id) : null;
    const typingMe = myMode === 'type';
    const talkingMe = myMode === 'dictate';
    if (this._dict && (!talkingMe || this._dict.callId !== call?.id)) this._stopDict();
    const vmLeave = vmState && call.vmStep === 'leave';
    // the voicemail screen's subtitles: their greeting (typed out once), then the tone line
    const lines = vmState
      ? [{ id: `greet-${call.id}`, side: 'callee', text: call.greeting?.text || (call.greeting?.kind === 'recorded' ? '♪ (their recorded greeting)' : ''), greet: true }, ...(vmLeave ? [{ id: `tone-${call.id}`, side: 'system', text: TONE_LINE }] : [])]
      : (live ? (call.lines || []) : []);
    const who = live && !vmState ? this._typing.get(call.id) : null;
    if (vmState && !this._spoke.has(call.id)) {
      this._spoke.add(call.id);
      this._fresh.add(`greet-${call.id}`);
      if (call.greeting?.readOut) speak(call.greeting.text, { voice: call.greeting.voice, rate: call.greeting.rate, pitch: call.greeting.pitch });
      if (call.greeting?.kind === 'recorded' && call.greeting.audio) { this._greetAudio?.pause?.(); this._greetAudio = playAudio(call.greeting.audio); }
    }
    if (vmLeave && !this._spoke.has(`tone-${call.id}`)) { this._spoke.add(`tone-${call.id}`); stopSpeaking(); this._greetAudio?.pause?.(); this._greetAudio = null; }
    // a call that left the voicemail screen: drop any recording still open
    for (const [cid, r] of this._rec) if (!vmLeave || cid !== call?.id) { r.rec?.cancel?.(); this._rec.delete(cid); }
    if (!vmState && this._greetAudio) { this._greetAudio.pause?.(); this._greetAudio = null; }
    if (!live || (!lines.length && !typingMe && !talkingMe && !who && !vmLeave)) {
      if (this.subs.hidden || this.subs.classList.contains('is-leaving')) return;
      const clear = () => { this.subs.hidden = true; this.subs.classList.remove('is-leaving'); this.subs.replaceChildren(); this._subsFor = null; };
      if (this.reduced || !this.subs.childElementCount) return clear();
      this.subs.classList.add('is-leaving');
      this.subs.querySelector('input')?.blur();
      setTimeout(() => { if (this.subs.classList.contains('is-leaving')) clear(); }, 450);
      return;
    }
    this.subs.classList.remove('is-leaving');
    this.subs.hidden = false;
    if (this._subsFor !== call.id) { this.subs.replaceChildren(); this._subsFor = call.id; }
    let list = this.subs.querySelector('.ncm-ch-sublines');
    if (!list) { list = document.createElement('div'); list.className = 'ncm-ch-sublines'; this.subs.prepend(list); }
    const shown = lines.slice(-SUBS_SHOWN);
    list.innerHTML = shown.map((l, i) => {
      const last = i === shown.length - 1;
      if (l.side === 'system') return `<div class="ncm-ch-sub tone now" data-line="${esc(l.id)}"><i class="fas fa-voicemail"></i> <span class="tx">${esc(l.text)}</span></div>`;
      const sp = this._speaker(call, role, l.side);
      return `<div class="ncm-ch-sub${last ? ' now' : ''}${sp.mine ? ' mine' : ''}${l.greet ? ' greet' : ''}" data-line="${esc(l.id)}"><b>${esc(sp.name)}${l.greet ? ' <small>· greeting</small>' : ''}:</b><span class="tx">${esc(l.text)}</span></div>`;
    }).join('') + (who && call.state === 'live' ? `<div class="ncm-ch-sub typing"><b>${esc(this._speaker(call, role, who.side).name)}</b> ${who.how === 'talk' ? 'is talking…' : 'is typing…'}</div>` : '')
      + (call.state === 'held' ? '<div class="ncm-ch-sub typing"><i class="fas fa-pause"></i> On hold</div>' : '');
    // a received line types out once
    for (const el of list.querySelectorAll('[data-line]')) {
      const id = el.dataset.line;
      if (!this._fresh.has(id)) continue;
      this._fresh.delete(id);
      if (this.reduced) continue;
      const tx = el.querySelector('.tx'); const text = tx.textContent;
      const ms = typeOutMs(text); const t0 = performance.now();
      tx.textContent = ''; el.insertAdjacentHTML('beforeend', '<span class="caret"></span>');
      const step = (now) => {
        if (!tx.isConnected) return;
        const k = Math.ceil(Math.min(1, (now - t0) / ms) * text.length);
        tx.textContent = text.slice(0, k);
        if (k < text.length) requestAnimationFrame(step); else el.querySelector('.caret')?.remove();
      };
      requestAnimationFrame(step);
      setTimeout(() => { if (tx.isConnected) { tx.textContent = text; el.querySelector('.caret')?.remove(); } }, ms + 200);
    }
    // the type line — kept across redraws
    let say = this.subs.querySelector('.ncm-ch-say');
    const barMode = vmLeave ? 'vm' : typingMe ? 'type' : talkingMe ? 'dictate' : null;
    if (say && say.dataset.mode !== barMode) { say.remove(); say = null; }
    if (barMode === 'vm' && !say) return this._vmBar(call);
    if (barMode === 'dictate') { if (!say) this._dictBar(call, role); else this._paintDict(); return; }
    if (typingMe && !say) {
      const me = this._speaker(call, role, sideOf(call, game.user.id) || 'caller');
      say = document.createElement('div');
      say.className = 'ncm-ch-say';
      say.dataset.mode = 'type';
      say.innerHTML = `<span class="bar"><span class="who">${esc(me.name)}</span><input type="text" class="in" maxlength="500" placeholder="Say something…" autocomplete="off" spellcheck="true" aria-label="Type a line"><kbd>Enter</kbd></span>`
        + (this.service.transcriptNotice && !game.user.isGM ? '<span class="note"><i class="fas fa-eye"></i> The GM can read typed calls.</span>' : '');
      this.subs.appendChild(say);
      const input = say.querySelector('input');
      const id = call.id;
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();   // Y / N / H are call keys — never while typing a line
        if (e.key === 'Enter') { e.preventDefault(); if (this.service.sendLine(id, input.value)) input.value = ''; }
        else if (e.key === 'Escape') input.blur();
      });
      input.addEventListener('input', () => this.service.sendTyping(id, !!input.value.trim()));
      input.addEventListener('blur', () => { if (!input.value.trim()) this.service.sendTyping(id, false); });
      setTimeout(() => input.focus({ preventScroll: true }), 0);
    } else if (!barMode && say) say.remove();
  }

  /**
   * The voicemail box. Ways: Record (when the GM allows it and this browser can — else greyed with the reason),
   * Type, and for the GM Read it out. Type / Read it out: the thin type line, Enter leaves it. Record: Record / Stop,
   * a live level, the time against the limit (the dial is the clock), Enter sends, R starts over.
   */
  _vmBar(call) {
    const id = call.id;
    const me = { name: call.from?.name || 'You' };
    const say = document.createElement('div');
    say.className = 'ncm-ch-say is-vm';
    say.dataset.mode = 'vm';
    const mic = micStatus();
    const canRecord = this.service.recordingOn && mic.ok;
    const recTip = !this.service.recordingOn ? 'The GM has switched recorded voicemail off.' : mic.reason;
    const ways = [['typed', 'fa-keyboard', 'Type', '']];
    if (this.service.recordingOn) ways.unshift(['audio', 'fa-microphone', 'Record', canRecord ? 'Leave a voice message' : recTip]);
    if (game.user.isGM) ways.push(['tts', 'fa-volume-high', 'Read it out', 'Played in a voice when they listen']);
    const kind = this._vmKind.get(id) || 'typed';
    say.innerHTML = `<span class="ncm-ch-vmkind">${ways.map(([k, ic, lb, tip]) => `<span data-vmk="${k}" class="${kind === k ? 'on' : ''}${k === 'audio' && !canRecord ? ' is-off' : ''}"${tip ? ` data-tooltip="${esc(tip)}"` : ''}><i class="fas ${ic}"></i> ${lb}</span>`).join('')}</span><span class="ncm-ch-vmbody"></span>`;
    this.subs.appendChild(say);
    const paint = (k) => {
      const body = say.querySelector('.ncm-ch-vmbody');
      if (k !== 'audio') { this._rec.get(id)?.rec?.cancel?.(); this._rec.delete(id); }
      if (k === 'audio') {
        body.innerHTML = `<span class="bar rec"><span class="who">${esc(me.name)}</span><span class="ncm-ch-recbtn" data-rec><i class="fas fa-circle"></i> Record</span>
          <span class="ncm-ch-lvl">${'<i></i>'.repeat(10)}</span><span class="ncm-ch-rectime" data-rect>0:00 / ${formatDuration(this.service.maxRecordMs / 1000)}</span><kbd>Enter</kbd></span>
          <span class="note">Enter sends · R starts over · the recording stops at ${formatDuration(this.service.maxRecordMs / 1000)}</span>`;
        say.tabIndex = -1; say.focus({ preventScroll: true });
        return;
      }
      body.innerHTML = `<span class="bar"><span class="who">${esc(me.name)}</span><input type="text" class="in" maxlength="${VOICEMAIL_MAX}" placeholder="${k === 'tts' ? 'Type what they will hear…' : 'Leave a message…'}" autocomplete="off" spellcheck="true" aria-label="Leave a message"><kbd>Enter</kbd></span>`;
      const input = body.querySelector('input');
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); this.service.leaveVoicemail(id, input.value, { kind: this._vmKind.get(id) || 'typed' }).then((r) => { if (!r?.ok && r?.error) ui.notifications?.warn(r.error); }); }
        else if (e.key === 'Escape') input.blur();
      });
      setTimeout(() => input.focus({ preventScroll: true }), 0);
    };
    say.querySelectorAll('[data-vmk]').forEach((c) => c.addEventListener('click', () => {
      if (c.classList.contains('is-off')) { ui.notifications?.warn(c.dataset.tooltip || 'Recording is not available.'); return; }
      this._vmKind.set(id, c.dataset.vmk);
      say.querySelectorAll('[data-vmk]').forEach((x) => x.classList.toggle('on', x === c));
      paint(c.dataset.vmk);
    }));
    // recording: Record / Stop, the level and the clock
    const startRec = async () => {
      this._rec.get(id)?.rec?.cancel?.();
      const rec = new VoiceRecorder();
      const slot = { rec, clip: null };
      this._rec.set(id, slot);
      const btn = say.querySelector('[data-rec]'); const time = say.querySelector('[data-rect]'); const bars = [...say.querySelectorAll('.ncm-ch-lvl i')];
      try {
        await rec.start({
          maxMs: this.service.maxRecordMs,
          onLevel: (v) => bars.forEach((b, i) => b.classList.toggle('on', i < Math.round(v * bars.length))),
          onTick: (ms) => { slot.ms = ms; if (time) time.textContent = `${formatDuration(ms / 1000)} / ${formatDuration(this.service.maxRecordMs / 1000)}`; },
          onLimit: () => stopRec(),
        });
        if (btn) btn.innerHTML = '<i class="fas fa-square"></i> Stop';
        say.classList.add('is-recording');
      } catch (err) { ui.notifications?.warn(err.message); this._rec.delete(id); }
    };
    const stopRec = async () => {
      const slot = this._rec.get(id);
      if (!slot?.rec?.recording) return slot?.clip || null;
      slot.clip = await slot.rec.stop();
      say.classList.remove('is-recording');
      const btn = say.querySelector('[data-rec]'); if (btn) btn.innerHTML = '<i class="fas fa-rotate-left"></i> Again';
      say.querySelectorAll('.ncm-ch-lvl i').forEach((b) => b.classList.remove('on'));
      return slot.clip;
    };
    const sendRec = async () => {
      const clip = await stopRec();
      if (!clip?.blob?.size) { ui.notifications?.warn('Record a message first.'); return; }
      const base64 = await blobToBase64(clip.blob);
      const r = await this.service.leaveVoicemail(id, '', { kind: 'audio', audio: { base64, mime: clip.mime, ms: clip.ms } });
      if (!r?.ok && r?.error) ui.notifications?.warn(r.error);
      this._rec.delete(id);
    };
    say.addEventListener('click', (e) => {
      if (!e.target.closest('[data-rec]')) return;
      const slot = this._rec.get(id);
      if (slot?.rec?.recording) stopRec(); else startRec();
    });
    say.addEventListener('keydown', (e) => {
      if ((this._vmKind.get(id) || 'typed') !== 'audio') return;
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); sendRec(); }
      else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); startRec(); }
    });
    paint(kind === 'audio' && !canRecord ? 'typed' : kind);
  }

  /** A voicemail was left for a line this client follows: an amber notice with Play and Call back. */
  _voicemailNotice(vm) {
    const to = vm.to || {};
    const actor = to.actorId ? game.actors?.get(to.actorId) : null;
    const mine = game.user.isGM ? !actor?.hasPlayerOwner : !!actor?.isOwner;
    if (!mine) return;
    // a name only when the caller is in this character's contacts (the GM sees everyone)
    let name = vm.from?.name || vm.from?.number || 'Unknown';
    if (!game.user.isGM) {
      const contacts = actor?.getFlag?.(MODULE_ID, 'contacts') || [];
      const home = this.service.homeCode; const n = normaliseNumber(vm.from?.number, home);
      const hit = contacts.find((c) => (n && c.phone && normaliseNumber(c.phone, home) === n) || (vm.from?.contactId && c.masterContactId === vm.from.contactId) || (vm.from?.actorId && c.actorId === vm.from.actorId));
      name = hit?.name || vm.from?.number || 'Unknown number';
    }
    const wrap = this._ensureRoot().querySelector('.ncm-ch-missedwrap');
    const el = document.createElement('div');
    el.className = 'ncm-ch-missed ncm-ch-vmnote';
    el.innerHTML = `<span class="ncm-ch-x" data-close><i class="fas fa-xmark"></i></span><span class="ncm-ch-dial">${DIAL_SVG}<i class="fas fa-voicemail"></i></span>
      <span class="t"><b>Voicemail${game.user.isGM && to.name ? ` · for ${esc(to.name)}` : ''}</b><span>${esc(name)}</span><small>${vm.kind === 'audio' && !vm.text ? `♪ voice message · ${formatDuration(vm.duration || 0)}` : esc(vm.text.length > 90 ? vm.text.slice(0, 88) + '…' : vm.text)}</small></span>
      <span class="acts">${vm.kind === 'tts' || (vm.kind === 'audio' && vm.audio) ? '<span class="play" data-play><i class="fas fa-play"></i> Play</span>' : ''}${vm.from?.number ? `<span class="go" data-callback="${esc(vm.from.number)}"><i class="fas fa-phone"></i> Call back</span>` : ''}</span>`;
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) el.remove();
      if (e.target.closest('[data-play]')) { if (vm.kind === 'audio') playAudio(vm.audio); else speak(vm.text, { voice: vm.voice }); }
      const cb = e.target.closest('[data-callback]');
      if (cb) { el.remove(); this.service.placeCall(cb.dataset.callback, game.user.isGM && to.contactId ? { contactId: to.contactId } : {}).then((r) => { if (!r.ok && r.error) ui.notifications?.warn(r.error); }); }
    });
    wrap.appendChild(el);
    setTimeout(() => el.remove(), 20000);
  }

  // ─── missed calls ───

  _missed(call) {
    if (!call) return;
    const wrap = this._ensureRoot().querySelector('.ncm-ch-missedwrap');
    const other = this._other(call, 'callee');
    const el = document.createElement('div');
    el.className = 'ncm-ch-missed';
    el.innerHTML = `<span class="ncm-ch-x" data-close><i class="fas fa-xmark"></i></span><span class="ncm-ch-dial">${DIAL_SVG}<i class="fas fa-phone-slash"></i></span>
      <span class="t"><b>Missed call</b><span>${esc(other.name)}</span><small>${other.known ? esc(other.number || '') : 'Not in your contacts'}</small></span>
      ${other.number ? `<span class="acts"><span class="go" data-callback="${esc(other.number)}"><i class="fas fa-phone"></i> Call back</span></span>` : ''}`;
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) el.remove();
      const cb = e.target.closest('[data-callback]');
      if (cb) { el.remove(); this.service.placeCall(cb.dataset.callback).then((r) => { if (!r.ok && r.error) ui.notifications?.warn(r.error); }); }
    });
    wrap.appendChild(el);
    setTimeout(() => el.remove(), 12000);
  }
}
