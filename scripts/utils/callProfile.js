/**
 * Call profile — the flavour text a call shows, generated from the call itself.
 * @file scripts/utils/callProfile.js
 * @module night-city-messenger
 * @description Pure. Design: dev/design/CALLS.md §5 ("the signal line is generated from the call").
 *
 * The channel and the hex code are seeded from caller name + number + network, so the same caller always reads the
 * same; the network TYPE picks the cipher and band; the network's signal strength picks how many rings the code takes
 * to resolve (a weak signal never quite does); an anonymous caller hides the source.
 */

const CIPHERS = Object.freeze({
  CORPORATE: ['AES-512', 'VERIFIED'],
  PUBLIC: ['ENC-128', 'OPEN BAND'],
  UNDERGROUND: ['ONION', '3 HOPS'],
  GOVERNMENT: ['MIL-QX', 'SECURE'],
  HOME: ['ENC-64', 'LOCAL'],
});

/** djb2 — a stable 32-bit hash of a string. */
export function djb2(str) {
  let h = 5381;
  for (const c of String(str)) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0;
  return h;
}

function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Signal strength → quality. */
export function signalQuality(strength) {
  const s = Number(strength) || 0;
  return s < 35 ? 'weak' : s < 70 ? 'fair' : 'strong';
}

/**
 * @param {object} o
 * @param {string} [o.name]
 * @param {string} [o.number]
 * @param {{name?: string, type?: string, strength?: number}} [o.net]
 * @param {boolean} [o.anon]
 * @returns {{hex: string, ch: number, cipher: string, band: string, q: string, net: string, type: string, anon: boolean,
 *   src: string, lockRings: number, classes: string}}
 */
export function callProfile({ name = '', number = '', net = {}, anon = false } = {}) {
  const netName = net.name || 'CitiNet';
  const type = String(net.type || 'PUBLIC').toUpperCase();
  const seed = djb2(`${name}|${number}|${netName}`);
  const rnd = seeded(seed);
  const hex = Array.from({ length: 6 }, () => '0123456789ABCDEF'[Math.floor(rnd() * 16)]).join('');
  const [cipher, band] = CIPHERS[type] || CIPHERS.PUBLIC;
  const q = signalQuality(net.strength ?? 75);
  const digits = String(number).replace(/\D/g, '').slice(-7);
  const src = anon ? 'ID masked' : digits ? `src ${digits.slice(0, 3)}-${digits.slice(3)}` : 'src unlisted';
  return {
    hex, ch: 10 + (seed % 80), cipher, band, q, net: netName, type, anon: !!anon, src,
    lockRings: q === 'strong' ? 2 : q === 'fair' ? 3 : 99,
    classes: [`q-${q}`, `n-${type.toLowerCase()}`, anon ? 'is-anon' : ''].filter(Boolean).join(' '),
  };
}

/**
 * The signal line's parts for a state, as plain data (the HUD turns it into markup; escaping is the caller's job).
 * @param {object} p — a callProfile()
 * @param {'ring'|'live'|'end'|'vm'} state
 * @param {number} [rings] — rings so far (ringing only)
 * @param {(i: number) => string} [glyph] — a churn glyph for the unresolved part of the code (default '?')
 * @returns {{lead: string, warn: boolean, parts: {text: string, tone?: 'dim'|'cipher'|'warn'}[]}}
 */
export function signalLine(p, state, rings = 1, glyph = () => '?') {
  if (state === 'ring') {
    const known = Math.min(6, Math.floor((rings * 6) / Math.max(1, p.lockRings)));
    const code = [...p.hex].map((c, i) => (i < known ? c : glyph(i))).join('');
    return { lead: p.q === 'weak' ? 'Weak signal' : 'Incoming signal', warn: p.q === 'weak',
      parts: [{ text: `Ring ${String(rings).padStart(2, '0')}` }, { text: `ch${p.ch}` }, { text: `0x${code}` },
        { text: p.cipher, tone: 'cipher' }, { text: p.src, tone: p.anon ? 'cipher' : 'dim' }] };
  }
  if (state === 'live') {
    return { lead: p.q === 'weak' ? 'Signal unstable' : 'Signal locked', warn: p.q === 'weak',
      parts: [{ text: `ch${p.ch}` }, { text: p.cipher, tone: 'cipher' }, { text: `0x${p.hex}` }, { text: p.band, tone: 'dim' }] };
  }
  return { lead: 'Signal lost', warn: false, parts: [{ text: `ch${p.ch} · ${p.net}`, tone: 'dim' }] };
}
