#!/usr/bin/env node
/**
 * Synthesise the call sounds (dev/design/CALLS.md §11.3) as small mono WAV files — our own tones, no licence.
 *   node dev/tools/gen-call-sounds.cjs
 * Writes assets/sounds/calls/*.wav. Not a build step: the files are committed; re-run only to change a tone.
 * The GM can replace any of them on the Sound board (Admin → Tools → Sounds).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'assets', 'sounds', 'calls');
const RATE = 22050;

/** Render `seconds` of audio from f(t) → -1..1, with a short fade at both ends so nothing clicks. */
function render(seconds, f) {
  const n = Math.round(seconds * RATE);
  const out = new Float32Array(n);
  const fade = Math.round(0.004 * RATE);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    let v = f(t);
    if (i < fade) v *= i / fade;
    if (i > n - fade) v *= (n - i) / fade;
    out[i] = Math.max(-1, Math.min(1, v));
  }
  return out;
}

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(Math.round(s * 32767), i * 2));
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

const sin = (f, t) => Math.sin(2 * Math.PI * f * t);
/** An envelope: rises over `a`, holds, falls over `r`, within [start, start+len]. */
const env = (t, start, len, a = 0.006, r = 0.03) => {
  const x = t - start;
  if (x < 0 || x > len) return 0;
  return Math.min(1, x / a, (len - x) / r);
};
let seed = 7; const noise = () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647) * 2 - 1; };

const SOUNDS = {
  // Two bright pulses with a slight warble — one ring (the service plays it once per ring, on the dial's 1.1 s beat).
  'ring': render(0.62, (t) => {
    const p = env(t, 0, 0.16) + env(t, 0.24, 0.16);
    const w = 1 + 0.004 * sin(28, t);
    return 0.34 * p * (0.6 * sin(880 * w, t) + 0.4 * sin(1320 * w, t));
  }),
  // What the caller hears while it rings: softer, lower, longer.
  'ringback': render(0.9, (t) => 0.22 * env(t, 0, 0.75, 0.02, 0.12) * (0.5 * sin(440, t) + 0.5 * sin(480, t))),
  // Answered: a rising chirp and a clean tick.
  'connect': render(0.32, (t) => 0.3 * (env(t, 0, 0.16, 0.004, 0.04) * Math.sin(2 * Math.PI * (600 * t + 2500 * t * t))
    + env(t, 0.2, 0.08) * sin(1600, t))),
  // Hung up: a falling blip.
  'end': render(0.34, (t) => 0.3 * env(t, 0, 0.28, 0.004, 0.08) * Math.sin(2 * Math.PI * (1000 * t - 1300 * t * t))),
  // Dropped: a burst of static over a low thud.
  'drop': render(0.45, (t) => {
    const st = env(t, 0, 0.32, 0.002, 0.12) * noise() * 0.28 * (0.6 + 0.4 * sin(31, t));
    const thud = env(t, 0.02, 0.3, 0.004, 0.2) * sin(110 - 60 * t, t) * 0.35;
    return st + thud;
  }),
  // A second call while you are on one: two soft short beeps.
  'waiting': render(0.42, (t) => 0.2 * (env(t, 0, 0.07) + env(t, 0.16, 0.07)) * sin(1040, t)),
  // Trauma Team opens: two rising alarm tones over a low pulse. No siren, it should feel medical and expensive.
  'em-sting-trauma': render(1.25, (t) => {
    const rise = env(t, 0, 0.5, 0.01, 0.1) * Math.sin(2 * Math.PI * (520 * t + 340 * t * t)) + env(t, 0.55, 0.6, 0.01, 0.25) * Math.sin(2 * Math.PI * (700 * (t - 0.55) + 300 * (t - 0.55) * (t - 0.55)));
    return 0.2 * rise + 0.3 * env(t, 0, 1.2, 0.02, 0.5) * sin(62, t);
  }),
  // One beep of a heart monitor. The HUD plays it with the heart.
  'em-monitor': render(0.11, (t) => 0.3 * env(t, 0, 0.1, 0.003, 0.03) * sin(1180, t)),
  // Dispatch confirms: three steps up.
  'em-sting-backup': render(1.1, (t) => 0.26 * env(t, 0, 0.012, 0.001, 0.008) + 0.1 * env(t, 0.02, 0.2, 0.006, 0.1) * noise() + 0.34 * env(t, 0.1, 0.24, 0.006, 0.05) * sin(587, t) + 0.34 * env(t, 0.34, 0.24, 0.006, 0.05) * sin(784, t) + 0.34 * env(t, 0.58, 0.5, 0.006, 0.34) * (0.6 * sin(1175, t) + 0.4 * sin(587, t))),
  'em-alert': render(0.62, (t) => 0.22 * (env(t, 0, 0.17) * sin(880, t) + env(t, 0.21, 0.17) * sin(660, t) + env(t, 0.42, 0.18, 0.006, 0.08) * sin(880, t))),
  'em-dispatch': render(0.56, (t) => 0.24 * (env(t, 0, 0.13) * sin(740, t) + env(t, 0.17, 0.13) * sin(988, t) + env(t, 0.34, 0.2, 0.006, 0.08) * sin(1318, t))),
  // Keying the radio: a click, then a breath of static.
  'em-radio-in': render(0.42, (t) => 0.45 * env(t, 0, 0.012, 0.001, 0.008) + 0.2 * env(t, 0.03, 0.36, 0.01, 0.14) * noise() + 0.24 * env(t, 0.05, 0.16, 0.004, 0.04) * sin(1450, t)),
  // Releasing it: the squelch tail.
  'em-radio-out': render(0.3, (t) => 0.32 * env(t, 0, 0.1, 0.002, 0.08) * noise() + 0.26 * env(t, 0.08, 0.14, 0.004, 0.06) * sin(980, t)),
  // Trauma Team lands: rotors winding down over a low hit.
  'em-arrive-trauma': render(1.9, (t) => {
    const chop = 0.5 + 0.5 * Math.sign(sin(13 - 4 * t, t));
    return 0.3 * env(t, 0, 1.8, 0.2, 0.8) * chop * noise() * 0.6 + 0.3 * env(t, 0, 0.6, 0.01, 0.5) * sin(70, t);
  }),
  // Backup rolls in: one soft siren yelp.
  'em-arrive-backup': render(1.2, (t) => 0.2 * env(t, 0, 1.15, 0.05, 0.3) * Math.sin(2 * Math.PI * (620 * t + 260 * Math.sin(2 * Math.PI * 1.6 * t) / (2 * Math.PI * 1.6)))),
  // The voicemail tone.
  'voicemail-beep': render(0.42, (t) => 0.28 * env(t, 0, 0.38, 0.006, 0.05) * sin(1000, t)),
};

fs.mkdirSync(OUT, { recursive: true });
for (const [name, samples] of Object.entries(SOUNDS)) {
  const file = path.join(OUT, `${name}.wav`);
  fs.writeFileSync(file, wav(samples));
  console.log(`wrote assets/sounds/calls/${name}.wav (${Math.round(fs.statSync(file).size / 1024)} KB)`);
}
