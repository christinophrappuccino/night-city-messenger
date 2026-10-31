/**
 * The browser's own voice (speechSynthesis) — read-out greetings and read-out voicemail (calls phase 3a).
 * @file scripts/ui/Calls/speech.js
 * @module night-city-messenger
 * @description Works offline in every browser Foundry runs in; the voices are whatever this computer has, so a voice
 *   picked by name falls back to the default when another computer lacks it. Respects the player's sound switch.
 */

/** Can this browser speak? */
export function canSpeak() {
  return typeof globalThis.speechSynthesis !== 'undefined' && typeof globalThis.SpeechSynthesisUtterance !== 'undefined';
}

/** The voices this browser has (they load late in Chrome — wait for them once). */
export function voices() {
  if (!canSpeak()) return Promise.resolve([]);
  const now = speechSynthesis.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => resolve(speechSynthesis.getVoices());
    speechSynthesis.addEventListener?.('voiceschanged', done, { once: true });
    setTimeout(done, 1500);
  });
}

/** Read text out. Resolves when it ends (or at once when speech is off). */
export async function speak(text, { voice = '', rate = 1, pitch = 1 } = {}) {
  if (!canSpeak() || !String(text || '').trim()) return;
  // the player's own sound switch + volume (the Theme Customizer's, the same SoundService reads)
  let prefs = {};
  try { prefs = game.nightcity?.settingsManager?.getTheme?.() || game.settings.get('night-city-messenger', 'playerTheme') || {}; } catch { /* defaults */ }
  if (prefs.soundEnabled === false) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(String(text));
  const v = voice ? (await voices()).find((x) => x.name === voice) : null;
  if (v) u.voice = v;
  u.rate = rate; u.pitch = pitch;
  u.volume = Math.min(1, Math.max(0, Number(prefs.soundVolume ?? 0.8)));
  return new Promise((resolve) => { u.onend = resolve; u.onerror = resolve; speechSynthesis.speak(u); });
}

export function stopSpeaking() { if (canSpeak()) speechSynthesis.cancel(); }
