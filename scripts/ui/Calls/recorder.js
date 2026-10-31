/**
 * Recording a voice — voicemail messages and recorded greetings (calls phase 3b).
 * @file scripts/ui/Calls/recorder.js
 * @module night-city-messenger
 * @description The browser's MediaRecorder (Opus in WebM where it can; whatever the browser prefers otherwise), with
 *   a live input level for the meter. The mic needs a SECURE page: https, The Forge, or localhost — a player joining
 *   a self-hosted game at http://192.168.x.x gets no mic in any browser, so `micStatus` says so in words the GM can
 *   act on, and the Record option is greyed with that reason (never a silent failure).
 */

/** Can this browser record here? `{ ok, reason }`. */
export function micStatus() {
  const g = globalThis;
  if (g.isSecureContext === false) return { ok: false, reason: 'This connection does not allow the microphone. The GM can turn on HTTPS (Foundry\'s SSL settings), or play on localhost.' };
  if (!g.navigator?.mediaDevices?.getUserMedia) return { ok: false, reason: 'This browser cannot use a microphone here.' };
  if (typeof g.MediaRecorder === 'undefined') return { ok: false, reason: 'This browser cannot record audio.' };
  return { ok: true, reason: '' };
}

/** The best recording type this browser offers. */
function pickMime() {
  const MR = globalThis.MediaRecorder;
  for (const m of ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/mp4']) if (MR?.isTypeSupported?.(m)) return m;
  return '';
}

/** One recording: start() asks for the mic and records; stop() resolves the clip; cancel() throws it away. */
export class VoiceRecorder {
  constructor() { this._chunks = []; this._rec = null; this._stream = null; this._ctx = null; this._raf = 0; this._timer = 0; this.startedAt = 0; }

  /**
   * @param {{maxMs?: number, onLevel?: (0..1)=>void, onTick?: (ms)=>void, onLimit?: ()=>void}} o
   * @returns {Promise<void>} rejects with a readable message when the mic is refused / missing
   */
  async start({ maxMs = 60000, onLevel, onTick, onLimit } = {}) {
    const st = micStatus();
    if (!st.ok) throw new Error(st.reason);
    try { this._stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch (err) { throw new Error(err?.name === 'NotAllowedError' ? 'The microphone was not allowed — allow it in the browser\'s address bar and try again.' : 'No microphone was found.'); }
    const mime = pickMime();
    this._rec = new MediaRecorder(this._stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined);
    this._chunks = [];
    this._rec.ondataavailable = (e) => { if (e.data?.size) this._chunks.push(e.data); };
    this._rec.start(250);
    this.startedAt = performance.now();
    // the live level for the meter
    try {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (AC && onLevel) {
        this._ctx = new AC();
        const src = this._ctx.createMediaStreamSource(this._stream);
        const an = this._ctx.createAnalyser(); an.fftSize = 512; src.connect(an);
        const buf = new Uint8Array(an.fftSize);
        const loop = () => {
          an.getByteTimeDomainData(buf);
          let peak = 0; for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
          onLevel(Math.min(1, peak / 64));
          this._raf = requestAnimationFrame(loop);
        };
        loop();
      }
    } catch { /* no meter — recording still works */ }
    this._timer = setInterval(() => {
      const ms = performance.now() - this.startedAt;
      onTick?.(ms);
      if (ms >= maxMs) { clearInterval(this._timer); onLimit?.(); }
    }, 200);
  }

  get recording() { return this._rec?.state === 'recording'; }

  /** Stop and hand back the clip: `{ blob, ms, mime }`. */
  stop() {
    return new Promise((resolve) => {
      const ms = this.startedAt ? Math.round(performance.now() - this.startedAt) : 0;
      const done = () => {
        const mime = this._rec?.mimeType || 'audio/webm';
        const blob = new Blob(this._chunks, { type: mime });
        this._release();
        resolve({ blob, ms, mime });
      };
      if (this._rec && this._rec.state !== 'inactive') { this._rec.onstop = done; this._rec.stop(); } else done();
    });
  }

  cancel() { try { if (this._rec?.state !== 'inactive') this._rec?.stop(); } catch { /* ignore */ } this._chunks = []; this._release(); }

  _release() {
    clearInterval(this._timer); cancelAnimationFrame(this._raf);
    try { this._ctx?.close(); } catch { /* ignore */ }
    for (const t of this._stream?.getTracks?.() || []) t.stop();
    this._stream = null; this._ctx = null;
  }
}

/** A Blob as base64 (no data: prefix) — for the socket relay. */
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** Play a recording (the player's volume). Returns the Audio element so a caller can stop it. */
export function playAudio(src) {
  if (!src) return null;
  const a = new Audio(src);
  try {
    const prefs = game.nightcity?.settingsManager?.getTheme?.() || game.settings.get('night-city-messenger', 'playerTheme') || {};
    if (prefs.soundEnabled === false) return null;
    a.volume = Math.min(1, Math.max(0, Number(prefs.soundVolume ?? 0.8)));
  } catch { /* defaults */ }
  a.play().catch(() => {});
  return a;
}
