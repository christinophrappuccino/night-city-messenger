/**
 * Junk senders — which addresses are spam no matter whose folder the mail sits in.
 * Pure (no Foundry globals); SpamService feeds it the templates and the GM's list.
 *
 * Three reasons an address is junk, strongest first:
 *   'generated' — the message itself was written by the spam generator (metadata.spamSource)
 *   'template'  — the address is a spam template's sender (tokens in it match anything)
 *   'listed'    — the GM marked the address, or its whole @domain, as junk
 * A player moving a message out of Spam changes its folder, never its reason.
 */

const lc = (s) => String(s ?? '').trim().toLowerCase();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** One list entry: an address (`deals@x.nc`) or a whole domain (`@x.nc` / `*@x.nc`). */
export function normalizeJunkEntry(raw) {
  let s = lc(raw).replace(/^\*@/, '@');
  if (!s) return '';
  if (s.startsWith('@')) return /^@[^@\s]+\.[^@\s]+$/.test(s) ? s : '';
  return /^[^@\s]+@[^@\s]+$/.test(s) ? s : '';
}

export function sanitizeJunkList(list) {
  const out = [];
  for (const e of Array.isArray(list) ? list : []) {
    const n = normalizeJunkEntry(e);
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

export function domainOf(email) {
  const s = lc(email);
  const at = s.lastIndexOf('@');
  return at > 0 ? s.slice(at) : '';
}

/** A template sender like `{{randomCorpo}}-deals@spam.nc` → a regex; a plain one → itself. */
function templatePattern(fromEmail) {
  const s = lc(fromEmail);
  if (!s) return null;
  if (!/\{\{[^}]+\}\}/.test(s)) return { exact: s };
  const re = new RegExp('^' + s.split(/\{\{[^}]+\}\}/).map(escapeRe).join('.+') + '$');
  return { re };
}

/**
 * @param {{templates?: Array<{fromEmail?: string, fromName?: string}>, list?: string[]}} src
 * @returns {(email: string, metadata?: object) => (null | {reason: string, label: string, entry?: string})}
 */
export function buildJunkMatcher({ templates = [], list = [] } = {}) {
  const exact = new Map();
  const patterns = [];
  for (const t of templates) {
    const p = templatePattern(t?.fromEmail);
    if (!p) continue;
    if (p.exact) { if (!exact.has(p.exact)) exact.set(p.exact, t.fromName || ''); }
    else patterns.push({ re: p.re, name: t.fromName || '' });
  }
  const entries = sanitizeJunkList(list);
  const addrs = new Set(entries.filter((e) => !e.startsWith('@')));
  const domains = new Set(entries.filter((e) => e.startsWith('@')));

  return (email, metadata = null) => {
    if (metadata?.spamSource === 'generated') return { reason: 'generated', label: 'Spam generator' };
    const s = lc(email);
    if (!s) return null;
    if (addrs.has(s)) return { reason: 'listed', label: 'You marked this address as junk', entry: s };
    const d = domainOf(s);
    if (d && domains.has(d)) return { reason: 'listed', label: `You marked ${d} as junk`, entry: d };
    if (exact.has(s)) return { reason: 'template', label: 'A spam template sends from this address' };
    if (patterns.some((p) => p.re.test(s))) return { reason: 'template', label: 'A spam template sends from this address' };
    return null;
  };
}
