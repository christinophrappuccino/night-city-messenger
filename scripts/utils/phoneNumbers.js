/**
 * Phone numbers — matching, area codes, and a number generator that never makes a real person's number.
 * @file scripts/utils/phoneNumbers.js
 * @module night-city-messenger
 * @description Pure (no Foundry globals). Design: dev/design/CALLS.md §2.
 *
 * A number is free text as the player typed it ("+81 3-1234-5678", "(555) 0119-07", "1-800-ARASAKA", "TRAUMA").
 * It is SHOWN as typed and MATCHED on its normalised form:
 *   - letters become their keypad digits (vanity numbers),
 *   - everything that is not a digit is dropped,
 *   - the country code is kept; a number typed without one gets the table's home code.
 * Short service numbers (911, #77, TRAUMA) match exactly, without a country code.
 *
 * The generator only ever produces numbers from each country's range reserved for fiction (North America:
 * 555-0100…0199 in any area code; the UK's Ofcom drama ranges; Australia's drama numbers). A country with no such
 * range gets an obviously made-up pattern and is flagged `fiction: false`.
 */

/** Keypad letters → digit. */
const KEYPAD = { A: 2, B: 2, C: 2, D: 3, E: 3, F: 3, G: 4, H: 4, I: 4, J: 5, K: 5, L: 5, M: 6, N: 6, O: 6,
  P: 7, Q: 7, R: 7, S: 7, T: 8, U: 8, V: 8, W: 9, X: 9, Y: 9, Z: 9 };

/** The table's default country code when none is given (overridden by the `callHomeCode` setting). */
export const DEFAULT_HOME_CODE = '+1';

/** At most this many digits (and no leading +) is a short service number — 911, #77, TRAUMA. */
const SHORT_MAX_DIGITS = 6;

/** Digits only, letters turned into their keypad digits. */
export function keypadDigits(raw) {
  return String(raw ?? '').toUpperCase().replace(/[A-Z]/g, (ch) => String(KEYPAD[ch])).replace(/\D/g, '');
}

/** The home code as digits ("+81" → "81"). */
export function homeDigits(homeCode = DEFAULT_HOME_CODE) {
  return String(homeCode ?? DEFAULT_HOME_CODE).replace(/\D/g, '') || '1';
}

/**
 * Is this a short service number? (#77, *69, 911, TRAUMA — never one with a +.)
 * @param {string} raw
 * @returns {boolean}
 */
export function isShortNumber(raw) {
  const s = String(raw ?? '').trim();
  if (!s || s.startsWith('+')) return false;
  if (/^[#*]/.test(s)) return true;
  return keypadDigits(s).length > 0 && keypadDigits(s).length <= SHORT_MAX_DIGITS;
}

/**
 * The form two numbers are compared on.
 *   full numbers → "+<country><digits>"      ("+1 (555) 0119-07" and "555 0119 07" at home +1 → "+1555011907")
 *   short numbers → "#<UPPER alnum>"          ("Trauma" → "#TRAUMA", "911" → "#911", "#77" → "##77")
 * @param {string} raw
 * @param {string} [homeCode]
 * @returns {string} '' for an empty number
 */
export function normaliseNumber(raw, homeCode = DEFAULT_HOME_CODE) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (isShortNumber(s)) return '#' + s.toUpperCase().replace(/[^A-Z0-9#*]/g, '');
  const home = homeDigits(homeCode);
  let digits = keypadDigits(s);
  if (!digits) return '';
  if (s.startsWith('+')) return '+' + digits;
  if (digits.startsWith('00')) return '+' + digits.slice(2);           // international prefix "00 81 …"
  // "1-800-ARASAKA" at home +1: a long number that already starts with the home code carries it.
  if (digits.length > 10 && digits.startsWith(home)) return '+' + digits;
  return '+' + home + digits;
}

/** Do two typed numbers reach the same line? */
export function sameNumber(a, b, homeCode = DEFAULT_HOME_CODE) {
  const na = normaliseNumber(a, homeCode);
  return !!na && na === normaliseNumber(b, homeCode);
}

/** Shown as it was written — trimmed, nothing else. */
export function displayNumber(raw) {
  return String(raw ?? '').trim();
}

// ═══════════════════════════════════════════════════════════
//  Countries, regions, area codes, fiction ranges
// ═══════════════════════════════════════════════════════════

/**
 * Country → its regions → [code, label]. US states use real area codes (public facts); "Night City" is the
 * fictional 555 and is the default. For the UK / Australia the "codes" are the drama ranges' fixed prefixes.
 * `fiction`: true when the country has an official range reserved for fiction, which the generator uses.
 */
export const AREA_CODES = Object.freeze({
  '1': {
    label: 'United States', fiction: true,
    regions: {
      'Night City': [['555', 'Night City']],
      'California': [['415', 'San Francisco'], ['510', 'Oakland'], ['213', 'Los Angeles'], ['310', 'West LA'], ['916', 'Sacramento'], ['619', 'San Diego'], ['408', 'San Jose']],
      'New York': [['212', 'Manhattan'], ['718', 'Brooklyn'], ['917', 'New York mobile'], ['518', 'Albany']],
      'Texas': [['512', 'Austin'], ['713', 'Houston'], ['214', 'Dallas'], ['210', 'San Antonio']],
      'Washington': [['206', 'Seattle'], ['509', 'Spokane']],
      'Oregon': [['503', 'Portland']],
      'Nevada': [['702', 'Las Vegas'], ['775', 'Reno']],
      'Arizona': [['602', 'Phoenix'], ['520', 'Tucson']],
      'Colorado': [['303', 'Denver']],
      'Illinois': [['312', 'Chicago'], ['773', 'Chicago']],
      'Michigan': [['313', 'Detroit']],
      'Georgia': [['404', 'Atlanta']],
      'Florida': [['305', 'Miami'], ['407', 'Orlando']],
      'Massachusetts': [['617', 'Boston']],
      'District of Columbia': [['202', 'Washington']],
    },
  },
  '44': {
    label: 'United Kingdom', fiction: true,
    regions: { 'London': [['20 7946 0', 'London']], 'Mobile': [['7700 900', 'Mobile']] },
  },
  '61': {
    label: 'Australia', fiction: true,
    regions: { 'Mobile': [['491 570', 'Mobile']] },
  },
  '81': {
    label: 'Japan', fiction: false,
    regions: { 'Tokyo': [['3', 'Tokyo']], 'Osaka': [['6', 'Osaka']] },
  },
});

/** The region a table starts on when it has never picked one. */
export const DEFAULT_REGION = Object.freeze({ country: '1', region: 'Night City', code: '555' });

/** Australia's reserved drama numbers (0491 570 xxx) — only these endings. */
const AU_DRAMA_ENDINGS = ['006', '156', '157', '158', '159', '110', '313', '737'];

/** A deterministic random from a seed (mulberry32), so the same seed shows the same numbers. */
function rng(seed) {
  let a = (Number(seed) >>> 0) || 1;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * Every fiction-safe local ending for a country + code, with a word on why it is memorable.
 * @returns {{tail: string, kind: 'repeating'|'run'|'random'}[]}
 */
function endingsFor(country) {
  const kindOf = (t) => (/^(\d)\1+$/.test(t.slice(-2)) ? 'repeating' : '0123456789'.includes(t.slice(-3)) || '0123456789'.includes(t.slice(-2) + String(+t.slice(-1) + 1)) ? 'run' : 'random');
  if (country === '61') return AU_DRAMA_ENDINGS.map((t) => ({ tail: t, kind: kindOf(t) }));
  if (country === '44') return Array.from({ length: 1000 }, (_, i) => String(i).padStart(3, '0')).map((t) => ({ tail: t, kind: kindOf(t) }));
  if (country === '1') return Array.from({ length: 100 }, (_, i) => String(i).padStart(2, '0')).map((t) => ({ tail: t, kind: /^(\d)\1$/.test(t) ? 'repeating' : (+t[1] === +t[0] + 1 ? 'run' : 'random') }));
  return Array.from({ length: 10000 }, (_, i) => String(i).padStart(4, '0')).map((t) => ({ tail: t, kind: kindOf(t) }));
}

/** Format one generated number. */
function formatGenerated(country, code, tail) {
  if (country === '1') return `+1 (${code}) 555-01${tail}`;
  if (country === '44') return `+44 ${code}${tail}`;
  if (country === '61') return `+61 ${code} ${tail}`;
  return `+${country} ${code} 5550 ${tail}`;
}

/**
 * Make `count` numbers for a country + area code: one repeating, one run, the rest random, never one already taken.
 * Always inside the country's fiction range (see the file header); `fiction` says whether that range is official.
 * @param {object} o
 * @param {string} [o.country='1']
 * @param {string} [o.code='555']
 * @param {number} [o.count=4]
 * @param {Iterable<string>} [o.taken] — numbers (any format) that already belong to someone
 * @param {number} [o.seed]
 * @param {string} [o.homeCode]
 * @returns {{number: string, kind: string, fiction: boolean}[]}
 */
export function generateNumbers({ country = '1', code = '555', count = 4, taken = [], seed = Date.now(), homeCode = DEFAULT_HOME_CODE } = {}) {
  const c = String(country).replace(/\D/g, '') || '1';
  const fiction = !!AREA_CODES[c]?.fiction;
  const takenSet = new Set([...taken].map((t) => normaliseNumber(t, homeCode)).filter(Boolean));
  const rand = rng(seed);
  const pool = endingsFor(c).map((e) => ({ ...e, number: formatGenerated(c, code, e.tail) }))
    .filter((e) => !takenSet.has(normaliseNumber(e.number, homeCode)));
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const out = [];
  const take = (kind) => { const i = pool.findIndex((e) => !kind || e.kind === kind); if (i >= 0) out.push(pool.splice(i, 1)[0]); };
  take('repeating'); take('run');
  while (out.length < count && pool.length) take(null);
  return out.slice(0, count).map(({ number, kind }) => ({ number, kind, fiction }));
}

/** Plain words for a generated number's kind (the picker's sub-line). */
export function kindLabel(kind) {
  return { repeating: 'repeating — easy to remember', run: 'a run — easy to remember', random: 'random' }[kind] || '';
}

/**
 * The country → region → code pick, sanitised (unknown → the default).
 * @returns {{country: string, region: string, code: string}}
 */
export function sanitizeRegion(r = {}) {
  const country = AREA_CODES[r.country] ? r.country : DEFAULT_REGION.country;
  const regions = AREA_CODES[country].regions;
  const region = regions[r.region] ? r.region : Object.keys(regions)[0];
  const codes = regions[region].map(([code]) => code);
  const code = codes.includes(r.code) ? r.code : codes[0];
  return { country, region, code };
}
