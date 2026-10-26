/**
 * What the world calls a data shard — the `shardTerm` world setting.
 *
 * "Shard" is the 2077 word; a 2045 table may want "Memory Chip" (tester,
 * 2026-10-26). This is the ONE reader for the player-facing noun: every
 * player-facing surface asks `shardTerm(form)` (JS) or `{{ncm-term "form"}}`
 * (templates). GM tools (Admin → Shards, Configure Shard, the composer) stay on
 * "shard" — plain language for the GM, the table's word for the players.
 *
 * Stored flags, setting keys, CSS classes and data-actions never change; this
 * is a label, so switching it needs no migration.
 *
 * Forms:  one       "Data Shard"   (an item, a heading)
 *         many      "Data Shards"
 *         short     "Shard"        (a tab, a chip, a sentence)
 *         shortMany "Shards"
 */

export const SHARD_TERM_PRESETS = Object.freeze({
  shard:    { label: 'Data Shard (default)', one: 'Data Shard',  many: 'Data Shards',  short: 'Shard', shortMany: 'Shards' },
  chip:     { label: 'Memory Chip',          one: 'Memory Chip', many: 'Memory Chips', short: 'Chip',  shortMany: 'Chips' },
  datachip: { label: 'Data Chip',            one: 'Data Chip',   many: 'Data Chips',   short: 'Chip',  shortMany: 'Chips' },
  custom:   { label: 'Custom (below)' },
});

export const SHARD_TERM_FORMS = Object.freeze(['one', 'many', 'short', 'shortMany']);

const plural = (w) => (/(s|x|z|ch|sh)$/i.test(w) ? `${w}es` : /[^aeiou]y$/i.test(w) ? `${w.slice(0, -1)}ies` : `${w}s`);

/**
 * The four forms for a preset key, or for a custom name. A custom value is
 * "Singular" or "Singular / Plural"; the short form is its last word.
 * Pure — the sims drive it directly.
 * @param {string} key  a SHARD_TERM_PRESETS key
 * @param {string} [custom]
 * @returns {{one: string, many: string, short: string, shortMany: string}}
 */
export function resolveShardTerm(key, custom = '') {
  if (key === 'custom') {
    const [a, b] = String(custom || '').split('/').map((s) => s.trim());
    if (a) {
      const many = b || plural(a);
      const short = a.split(/\s+/).pop();
      const shortMany = (b ? b.split(/\s+/).pop() : '') || plural(short);
      return { one: a, many, short, shortMany };
    }
  }
  const p = SHARD_TERM_PRESETS[key] && key !== 'custom' ? SHARD_TERM_PRESETS[key] : SHARD_TERM_PRESETS.shard;
  return { one: p.one, many: p.many, short: p.short, shortMany: p.shortMany };
}

/** Apply a case to a term: 'upper' | 'lower' | '' (as stored, Title Case). */
export function caseTerm(s, mode = '') {
  if (mode === 'upper') return s.toUpperCase();
  if (mode === 'lower') return s.toLowerCase();
  return s;
}

/** "a chip" / "an optical disc" — the indefinite article for a term. */
export function withArticle(s) {
  return `${/^[aeiou]/i.test(String(s)) ? 'an' : 'a'} ${s}`;
}

/** The current world's forms (falls back to the default before settings exist). */
export function shardTerms() {
  let key = 'shard', custom = '';
  try {
    key = game.settings.get('night-city-messenger', 'shardTerm') || 'shard';
    custom = game.settings.get('night-city-messenger', 'shardTermCustom') || '';
  } catch { /* setting not registered yet */ }
  return resolveShardTerm(key, custom);
}

/**
 * One form of the world's term, optionally cased.
 * @param {'one'|'many'|'short'|'shortMany'} [form='one']
 * @param {''|'upper'|'lower'} [mode]
 */
export function shardTerm(form = 'one', mode = '') {
  const t = shardTerms();
  return caseTerm(t[form] ?? t.one, mode);
}

/**
 * Handlebars: `{{ncm-term "short"}}`, `{{ncm-term "short" "upper"}}`, and as a
 * subexpression with a prefix/suffix: `prompt=(ncm-term "short" "upper" pre="> " post=" SLOT EMPTY")`.
 * `a=true` puts "a"/"an" in front of the term (after `pre`).
 */
export function registerShardTermHelper(Handlebars) {
  Handlebars.registerHelper('ncm-term', function (form, mode, options) {
    const opts = options ?? (mode && typeof mode === 'object' ? mode : form && typeof form === 'object' ? form : {});
    const f = typeof form === 'string' ? form : 'one';
    const m = typeof mode === 'string' ? mode : '';
    const h = opts?.hash || {};
    const t = shardTerm(f, m);
    return `${h.pre ?? ''}${h.a ? withArticle(t) : t}${h.post ?? ''}`;
  });
}
