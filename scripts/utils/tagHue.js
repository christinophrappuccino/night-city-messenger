/**
 * Category colours for admin tag pills — pure, no Foundry globals.
 * A tag's NAME picks one of eight hues (--ncm-hue-1..8, defined per admin preset), so the
 * same organization / role / scene reads the same colour wherever it appears. Hues say
 * "which one", never "what's wrong" — meaning has its own tokens (act/attn/bad/…).
 */
export const TAG_HUE_COUNT = 8;

export function tagHueIndex(text) {
  const s = String(text ?? '').trim().toLowerCase();
  if (!s) return 0;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return (h % TAG_HUE_COUNT) + 1;
}

/** CSS value for --tc on an .ncm-tagp pill. */
/**
 * A custom role the GM coloured in the Role Manager wears that colour on every `role:<id>`
 * tag; anything else (built-ins, orgs, scenes) keeps its name-picked hue. The resolver is
 * injected (registerTemplates) so this module stays pure.
 */
let _roleColor = null;
export function setRoleColorResolver(fn) { _roleColor = typeof fn === 'function' ? fn : null; }

export function tagHue(text) {
  const t = String(text ?? '');
  if (_roleColor && t.startsWith('role:')) { try { const c = _roleColor(t.slice(5)); if (c) return c; } catch { /* fall through */ } }
  const n = tagHueIndex(text);
  return n ? `var(--ncm-hue-${n})` : 'var(--ncm-text-label)';
}

export function registerTagHueHelper(H = globalThis.Handlebars) {
  H?.registerHelper?.('ncm-hue', (text) => tagHue(text));
}
