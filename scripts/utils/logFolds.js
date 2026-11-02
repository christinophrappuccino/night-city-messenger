/**
 * Date folds for long logs: the player's Calls tab and Admin → Phone's Call log and Voicemail. Pure, no Foundry globals.
 *
 * Bands shrink with age so the list stays short however long the campaign runs:
 *   Today · Yesterday · This week · one band per month for a year · one band per year.
 * Everything is measured on the GAME clock, in UTC like every stored stamp. A log written for a date ahead of the clock (the
 * GM can write history, and a clock can be rewound) sits in Later, and a row with no date in Undated.
 *
 * Folds follow the module's standing rule: the newest band open, the rest closed; a search or filter opens everything; the
 * user's own fold or unfold wins for the session. A closed head still shows its count and what needs attention.
 */

const DAY_MS = 86400000;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Rows a band shows before "Show more". */
export const BAND_PAGE = 30;

const dayStart = (ms) => Math.floor(ms / DAY_MS) * DAY_MS;

/**
 * The band a stamp belongs to, seen from the game clock.
 * @param {string} iso
 * @param {string|number} now - the game clock
 * @returns {{key: string, label: string, order: number}} a lower order sorts nearer the top
 */
export function dateBandOf(iso, now) {
  const t = Date.parse(iso);
  const n = typeof now === 'number' ? now : Date.parse(now);
  if (!Number.isFinite(t) || !Number.isFinite(n)) return { key: 'undated', label: 'Undated', order: Number.MAX_SAFE_INTEGER };
  const ago = Math.round((dayStart(n) - dayStart(t)) / DAY_MS);
  if (ago < 0) return { key: 'later', label: 'Later', order: -1 };
  if (ago === 0) return { key: 'today', label: 'Today', order: 0 };
  if (ago === 1) return { key: 'yesterday', label: 'Yesterday', order: 1 };
  if (ago < 7) return { key: 'week', label: 'This week', order: 2 };
  const d = new Date(t), y = d.getUTCFullYear(), m = d.getUTCMonth(), c = new Date(n);
  const monthsAgo = (c.getUTCFullYear() - y) * 12 + (c.getUTCMonth() - m);
  if (monthsAgo < 12) return { key: `m:${y}-${String(m + 1).padStart(2, '0')}`, label: `${MONTHS[m]}${y === c.getUTCFullYear() ? '' : ` ${y}`}`, order: 3 + monthsAgo };
  return { key: `y:${y}`, label: String(y), order: 100 + (c.getUTCFullYear() - y) };
}

/**
 * Is this band closed? Newest open, the rest closed, the user's choice wins, and a search or filter opens everything.
 * @param {string} key @param {{index?: number, shut?: Set, open?: Set, forced?: boolean}} [o]
 */
export function bandShut(key, { index = 0, shut = new Set(), open = new Set(), forced = false } = {}) {
  if (shut.has(key)) return true;
  if (open.has(key)) return false;
  if (forced) return false;
  return index > 0;
}

/**
 * Group rows into date bands, newest first, each with day dividers.
 * @param {object[]} rows
 * @param {object} o
 * @param {string|number} o.now - the game clock
 * @param {(r: object) => string} o.dateOf - a row's stamp
 * @param {(day: string) => string} [o.dayLabel] - a divider's label, from YYYY-MM-DD
 * @param {(r: object) => boolean} [o.isHot] - needs attention (missed, unheard), counted on the head
 * @param {Set} [o.shut] @param {Set} [o.open] - the user's folds
 * @param {boolean} [o.forced] - a search or filter is on
 * @param {Object<string, number>} [o.limits] - rows to show per band, from "Show more"
 * @param {number} [o.page=BAND_PAGE]
 * @param {string} [o.prefix] - put before every key, so two lists can share fold memory
 * @returns {{key, label, dateText, total, hot, shut, shown, hidden, days: {day, label, divider, rows}[]}[]}
 */
export function dateBands(rows, { now, dateOf, dayLabel = (d) => d, isHot = () => false, shut, open, forced = false, limits = {}, page = BAND_PAGE, prefix = '' } = {}) {
  const by = new Map();
  for (const r of rows || []) {
    const stamp = dateOf(r), band = dateBandOf(stamp, now);
    if (!by.has(band.key)) by.set(band.key, { ...band, all: [] });
    by.get(band.key).all.push({ r, ms: Date.parse(stamp) || 0, stamp });
  }
  return [...by.values()].sort((a, b) => a.order - b.order).map((b, index) => {
    const key = prefix + b.key;
    b.all.sort((x, y) => y.ms - x.ms);
    const visible = b.all.slice(0, limits[key] || page);
    // a band that is one day says its date on the head; a divider would repeat it
    const oneDay = b.key === 'today' || b.key === 'yesterday';
    const days = [];
    for (const { r, stamp } of visible) {
      const day = String(stamp || '').slice(0, 10);
      if (days.at(-1)?.day !== day) days.push({ day, label: day ? dayLabel(day) : 'Undated', divider: !oneDay, rows: [] });
      days.at(-1).rows.push(r);
    }
    return {
      key, label: b.label, dateText: oneDay ? (days[0]?.label || '') : '', total: b.all.length, hot: b.all.filter(({ r }) => isHot(r)).length,
      shut: bandShut(key, { index, shut, open, forced }), shown: visible.length, hidden: b.all.length - visible.length, days,
    };
  });
}

/**
 * Group rows under names (a person, a mailbox), newest first inside each. There are no dividers: most days hold one row, so
 * the caller puts the date on the row. The same fold rule and "Show more" as the date bands.
 * @param {object[]} rows
 * @param {object} o
 * @param {(r: object) => string[]} o.keysOf - the groups a row belongs in. A call belongs to both people on it.
 * @param {(key: string, rows: object[]) => object} [o.head] - the group's label, plus anything else its head needs
 * @param {(a: object, b: object) => number} [o.order] - groups; by default, most rows first
 * @returns the same shape as dateBands
 */
export function namedGroups(rows, { keysOf, head = (k) => ({ label: k }), order = (a, b) => b.total - a.total, dateOf, isHot = () => false, shut, open, forced = false, limits = {}, page = BAND_PAGE, prefix = '' } = {}) {
  const by = new Map();
  for (const r of rows || []) for (const k of new Set(keysOf(r))) { if (!by.has(k)) by.set(k, []); by.get(k).push(r); }
  const list = [...by.entries()].map(([k, all]) => ({ raw: k, all, total: all.length, hot: all.filter(isHot).length, ...head(k, all) }));
  return list.sort(order).map((g, index) => {
    const { raw, all, ...rest } = g, key = prefix + raw;
    const sorted = [...all].sort((x, y) => (Date.parse(dateOf(y)) || 0) - (Date.parse(dateOf(x)) || 0));
    const visible = sorted.slice(0, limits[key] || page);
    return { dateText: '', ...rest, key, shut: bandShut(key, { index, shut, open, forced }), shown: visible.length, hidden: all.length - visible.length, days: visible.length ? [{ day: '', label: '', divider: false, rows: visible }] : [] };
  });
}

/** A piece of text, escaped, with the search term marked. Safe to print raw. */
export function markHit(text, q) {
  const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const s = String(text ?? ''), needle = String(q || '').trim().toLowerCase();
  const at = needle ? s.toLowerCase().indexOf(needle) : -1;
  if (at < 0) return esc(s);
  return `${esc(s.slice(0, at))}<mark>${esc(s.slice(at, at + needle.length))}</mark>${esc(s.slice(at + needle.length))}`;
}

/**
 * The words around a search hit in something the row hides (a transcript, a voicemail), so a result says why it matched.
 * @param {string} q @param {string[]} texts
 * @returns {string} '' when none of them match
 */
export function searchSnippet(q, texts = [], around = 34) {
  const needle = String(q || '').trim().toLowerCase();
  if (!needle) return '';
  for (const text of texts) {
    const s = String(text || ''), at = s.toLowerCase().indexOf(needle);
    if (at < 0) continue;
    const from = Math.max(0, at - around), to = Math.min(s.length, at + needle.length + around);
    return `${from > 0 ? '…' : ''}${s.slice(from, to)}${to < s.length ? '…' : ''}`;
  }
  return '';
}
