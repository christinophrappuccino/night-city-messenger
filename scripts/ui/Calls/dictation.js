/**
 * Dictate — the browser's own speech-to-text on a call (calls phase 5).
 * @file scripts/ui/Calls/dictation.js
 * @module night-city-messenger
 * @description Design dev/design/CALLS.md §9. Each side transcribes ITS OWN mic and sends the words as ordinary typed
 *   lines, so subtitles, the transcript, the GM's Listen in and taps all work unchanged. Where it exists the browser
 *   sends the audio to its maker's speech service (Google for Chrome, Microsoft for Edge, Apple for Safari), so a
 *   player switches it on themselves after a notice that says so. Firefox has none, and the Foundry desktop app usually
 *   none that works; there the chip is greyed with the reason and Type is offered instead. The pure helpers take the
 *   globals as an argument so the sim can drive them.
 */

/** Which company turns the speech into text, from the user agent — said in plain words on the notice. */
export function speechVendor(ua = '') {
  const u = String(ua);
  if (/Edg\//.test(u)) return 'Microsoft';
  if (/Chrome\//.test(u) && !/Electron\//.test(u)) return 'Google';
  if (/Safari\//.test(u) && !/Chrome\//.test(u)) return 'Apple';
  return 'your browser’s speech service';
}

/**
 * Can this client dictate? `{ ok, reason, vendor }`. Needs the recognition API, a secure page (https / The Forge /
 * localhost) and, in practice, not the Foundry desktop app (Electron ships the API without the service keys).
 */
export function dictateStatus(g = globalThis) {
  const ua = g.navigator?.userAgent || '';
  const vendor = speechVendor(ua);
  const Rec = g.SpeechRecognition || g.webkitSpeechRecognition;
  if (!Rec) return { ok: false, vendor, reason: /Firefox\//.test(ua) ? 'Firefox cannot turn speech into text. Use Type, or join in Chrome, Edge or Safari.' : 'This browser cannot turn speech into text. Use Type, or join in Chrome, Edge or Safari.' };
  if (/Electron\//.test(ua)) return { ok: false, vendor, reason: 'The Foundry app cannot turn speech into text. Use Type, or join the game in Chrome, Edge or Safari.' };
  if (g.isSecureContext === false) return { ok: false, vendor, reason: 'This connection does not allow the microphone. The GM can turn on HTTPS (Foundry’s SSL settings), or play on localhost.' };
  return { ok: true, vendor, reason: '' };
}

/** A recognition error in words (null = not worth telling the player). */
export function dictateError(code) {
  switch (code) {
    case 'not-allowed': case 'service-not-allowed': return 'The microphone (or speech service) was not allowed — allow it in the browser’s address bar and pick Dictate again.';
    case 'audio-capture': return 'No microphone was found.';
    case 'network': return 'The speech service could not be reached. Use Type for now.';
    case 'language-not-supported': return 'The speech service does not support this language.';
    case 'no-speech': case 'aborted': return null;
    default: return code ? `Dictation stopped (${code}).` : null;
  }
}

/** A spoken phrase as a line: whitespace folded, the first letter capitalised, cut into lines of at most `max`. */
export function spokenLines(text, max = 500) {
  let t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return [];
  t = t[0].toUpperCase() + t.slice(1);
  const out = [];
  while (t.length > max) {
    let cut = t.lastIndexOf(' ', max);
    if (cut < max * 0.5) cut = max;
    out.push(t.slice(0, cut).trim());
    t = t.slice(cut).trim();
  }
  if (t) out.push(t);
  return out;
}

/** The language to listen for: Foundry's, else the browser's. */
export function dictateLang(g = globalThis) {
  const fl = g.game?.i18n?.lang;
  const nav = g.navigator?.language || 'en-US';
  if (fl && nav.toLowerCase().startsWith(String(fl).toLowerCase())) return nav;
  return fl ? (fl.includes('-') ? fl : `${fl}-${fl === 'en' ? 'US' : fl.toUpperCase()}`) : nav;
}

/**
 * One open mic on one call. `start()` listens until `stop()`; the browser ends a session after a silence, so it is
 * restarted while still wanted. Each final phrase goes to `onFinal`, the words in progress to `onInterim`.
 */
export class Dictation {
  /** @param {{onFinal?: (string)=>void, onInterim?: (string)=>void, onState?: (state: 'listening'|'paused'|'stopped', reason?: string)=>void, g?: object}} o */
  constructor({ onFinal, onInterim, onState, g = globalThis } = {}) {
    this.onFinal = onFinal || (() => {});
    this.onInterim = onInterim || (() => {});
    this.onState = onState || (() => {});
    this.g = g;
    this.want = false;
    this.rec = null;
    this._fails = 0;
  }

  get listening() { return this.want; }

  start() {
    const st = dictateStatus(this.g);
    if (!st.ok) { this.onState('stopped', st.reason); return false; }
    if (this.want) return true;
    this.want = true;
    this._open();
    return true;
  }

  _open() {
    const Rec = this.g.SpeechRecognition || this.g.webkitSpeechRecognition;
    const rec = new Rec();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = dictateLang(this.g);
    rec.onstart = () => { this._openedAt = Date.now(); this.onState('listening'); };
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const said = r[0]?.transcript || '';
        if (r.isFinal) { this.onInterim(''); for (const l of spokenLines(said)) this.onFinal(l); }
        else interim += said;
      }
      if (interim) this.onInterim(interim.trim());
    };
    rec.onerror = (e) => {
      const why = dictateError(e?.error);
      if (why) { this.want = false; this.onInterim(''); this.onState('stopped', why); }
    };
    rec.onend = () => {
      if (this.rec !== rec) return;
      this.rec = null;
      if (!this.want) { this.onState('stopped'); return; }
      // the browser closed the session (silence, a time limit): open another while the player still wants the mic
      // a session that closes at once, again and again, is broken (a long one that ends on a silence is not)
      this._fails = Date.now() - (this._openedAt || 0) < 1500 ? this._fails + 1 : 0;
      if (this._fails > 5) { this.want = false; this.onState('stopped', 'Dictation kept stopping. Pick Dictate again, or use Type.'); return; }
      try { this._open(); } catch { this.want = false; this.onState('stopped', 'Dictation could not restart.'); }
    };
    this.rec = rec;
    rec.start();
  }

  /** Stop listening (the words already said still arrive). */
  stop() {
    this.want = false;
    const r = this.rec;
    this.rec = null;
    try { r?.stop?.(); } catch { /* already stopped */ }
    this.onInterim('');
    this.onState('stopped');
  }
}
