#!/usr/bin/env node
/**
 * Brand hex → --ncm-* variable sweep for stylesheets that must follow a theme.
 * @file tools/sweep-brand-hex.mjs
 *
 * The module's brand palette (variables.css defaults) was hand-typed into many
 * GM stylesheets. A hardcoded #19f3f7 never follows the admin (or player)
 * theme; var(--ncm-secondary) does. This rewrites the literal brand values
 * to their variables — the same discipline the 2026-06 admin-tab sweep used.
 *
 *   node tools/sweep-brand-hex.mjs <file.css> [...]            rewrite in place
 *   node tools/sweep-brand-hex.mjs --check <file.css> [...]    report only (exit 1 if any remain)
 *   node tools/sweep-brand-hex.mjs --only '<selector regex>' <file.css>
 *        only touch rule blocks whose selector matches (e.g. the composer-only
 *        half of a stylesheet shared with a player-facing viewer)
 *
 * Deliberately untouched: black/white (shadows/overlays are theme-agnostic),
 * fallbacks inside var(--x, #hex) (harmless; the var already wins), any colour
 * not in the tables (network-type colours, per-preset art, status oranges),
 * and `--*-net-*` custom-property declarations (network-TYPE identity).
 */
import fs from 'fs';

const HEX = {
  // palette
  '#f65261': '--ncm-primary',
  '#19f3f7': '--ncm-secondary',
  '#f7c948': '--ncm-accent',
  '#00ff41': '--ncm-success',
  '#ffab00': '--ncm-warning',
  '#ff0033': '--ncm-danger',
  '#ff4444': '--ncm-danger',
  '#a855f7': '--ncm-purple',
  // surfaces
  '#0a0a0f': '--ncm-bg-deep',
  '#0d0d1a': '--ncm-bg-deep',
  '#12121a': '--ncm-bg-base',
  '#1a1a2e': '--ncm-bg-surface',
  '#1e1e30': '--ncm-bg-surface',
  '#252540': '--ncm-bg-elevated',
  // borders
  '#2a2a45': '--ncm-border',
  '#3a3a5a': '--ncm-border-active',
  // text
  '#e0e0e8': '--ncm-text-primary',
  '#e8e8f0': '--ncm-text-primary',
  '#ededf0': '--ncm-text-primary',
  '#8888a0': '--ncm-text-secondary',
  '#bdbdd0': '--ncm-text-secondary',
  '#555570': '--ncm-text-muted',
  '#6a6a85': '--ncm-text-muted',
  '#6a6a8a': '--ncm-text-muted',
  '#8e8ea8': '--ncm-text-muted',
  // Tier 2 — hand-picked near-brand neutrals the config sheets typed in
  // (shard-config / gm-contact-manager / network-management / terminal config).
  // Left alone they stay near-black on the light preset while the text flips
  // dark ("the configs look rough", 2026-09-10).
  '#0a0a12': '--ncm-bg-deep',
  '#0d0d14': '--ncm-bg-deep',
  '#0e0e16': '--ncm-bg-deep',
  '#14141e': '--ncm-bg-base',
  '#16161f': '--ncm-bg-base',
  '#303050': '--ncm-border',
  '#4a4a65': '--ncm-border-active',
  '#5a5a7a': '--ncm-text-muted',      // as a border it becomes --ncm-border-active (BORDER_OVERRIDES)
  '#7a7a98': '--ncm-text-muted',
  '#8a8aa8': '--ncm-text-muted',
  '#9090a8': '--ncm-text-secondary',
  '#9999b0': '--ncm-text-secondary',
  '#a0a0b8': '--ncm-text-secondary',
  '#b0b0c8': '--ncm-text-secondary',
  '#c0c0d0': '--ncm-text-secondary',
  '#c9c9da': '--ncm-text-secondary',
  '#d0d0d8': '--ncm-text-primary',
  '#d9d9e6': '--ncm-text-primary',
  // Tier 3 — the terminal config's account editor (terminal.css `.ncm-acct-*`)
  // typed its own shades again. NOT mapped on purpose: the boot/login/
  // screensaver PREVIEW stages (#050508 / #07070c / #06060a / #030305) mimic a
  // terminal screen and must stay dark under any admin preset.
  '#0b0b14': '--ncm-bg-deep',
  '#0c0c15': '--ncm-bg-deep',
  '#22223a': '--ncm-border',
  '#3a3a55': '--ncm-border-active',
  '#55557a': '--ncm-text-muted',
  '#6fa8ab': '--ncm-text-secondary',
  '#b9b9cc': '--ncm-text-secondary',
  '#dde':    '--ncm-text-primary',
  '#eef':    '--ncm-text-primary',
  '#8fd':    '--ncm-secondary',
  '#ff5261': '--ncm-primary',
  // Tier 4 — the message viewer / contacts / composer sheets' ALTERNATE accent
  // palette (Tailwind-ish cyan/red/violet/emerald/amber) and their neutrals.
  // These are player-facing sheets: under the player theme the variables
  // resolve to the same brand colours, so players see no change; under the GM
  // view (admin theme) the accents finally follow the preset instead of
  // painting brand cyan/white over a light surface.
  '#00d4e6': '--ncm-secondary',
  '#ef4444': '--ncm-danger',
  '#ff4455': '--ncm-danger',
  '#a78bfa': '--ncm-purple',
  '#34d399': '--ncm-success',
  '#fbbf24': '--ncm-warning',
  '#ffbb33': '--ncm-warning',
  '#f0c55b': '--ncm-accent',
  '#444460': '--ncm-border-active',
  '#666680': '--ncm-text-muted',
  '#7777a0': '--ncm-text-muted',
  '#aaaacc': '--ncm-text-secondary',
  '#d0d0dc': '--ncm-text-primary',
};
/**
 * `color: #fff` in a themed sheet means "the primary text colour". Only `color:` —
 * white backgrounds/borders stay.
 *
 * NEAR-white counts too. The first pass matched only pure white, so literals like
 * `#f0f0f5` sailed through — and a near-white that never flips is just as unreadable
 * on the light preset as a pure white one. That is how the message SUBJECT came out
 * white-on-white under GM view (measured 1.05:1). Anything whose channels are all
 * >= 0xE0 is text-white for our purposes.
 */
const WHITE_TEXT = /(\bcolor\s*:\s*)(#[0-9a-f]{3}\b|#[0-9a-f]{6}\b|white\b)/gi;
/** Is this literal near enough to white that, as TEXT, it must follow the theme? */
function isTextWhite(lit) {
  if (/^white$/i.test(lit)) return true;
  let h = lit.slice(1);
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  if (h.length !== 6) return false;
  return [0, 2, 4].every((k) => parseInt(h.slice(k, k + 2), 16) >= 0xe0);
}
/** Colours that mean "border" when they appear in a border declaration. */
const BORDER_OVERRIDES = { '#5a5a7a': '--ncm-border-active', '#7a7a98': '--ncm-border-active' };
const RGB = {
  '246,82,97': '--ncm-primary',
  '25,243,247': '--ncm-secondary',
  '247,201,72': '--ncm-accent',
  '0,255,65': '--ncm-success',
  '255,171,0': '--ncm-warning',
  '255,0,51': '--ncm-danger',
  '255,68,68': '--ncm-danger',
  '168,85,247': '--ncm-purple',
  // Tier 4 accents (see HEX) + the neutral triplets the viewer sheets use for tints
  '0,212,230': '--ncm-secondary',
  '239,68,68': '--ncm-danger',
  '255,68,85': '--ncm-danger',
  '240,197,91': '--ncm-accent',
  '52,211,153': '--ncm-success',
  '251,191,36': '--ncm-warning',
  '255,187,51': '--ncm-warning',
  '167,139,250': '--ncm-purple',
  '10,10,15': '--ncm-bg-deep',
  '18,18,26': '--ncm-bg-base',
  '26,26,46': '--ncm-bg-surface',
  '37,37,64': '--ncm-bg-elevated',
  '42,42,69': '--ncm-border',
  '58,58,90': '--ncm-border-active',
  '85,85,112': '--ncm-text-muted',
  '102,102,128': '--ncm-text-muted',
  '136,136,160': '--ncm-text-secondary',
  '224,224,232': '--ncm-text-primary',
};
/** Hardcoded font stacks → the theme's font slots (the standing font rule). */
const FONTS = [
  [/font-family\s*:\s*(['"])Rajdhani\1[^;!}]*/gi, 'font-family: var(--ncm-font-display)'],
  [/font-family\s*:\s*(['"])Share Tech Mono\1[^;!}]*/gi, 'font-family: var(--ncm-font-mono)'],
  [/font-family\s*:\s*(['"])Orbitron\1[^;!}]*/gi, 'font-family: var(--ncm-font-title)'],
];
/**
 * Declarations that keep their literal even though it's a brand hex:
 * network-TYPE identity colours (CorpNet blue, CitiNet cyan…) are not theme.
 */
const KEEP_DECL = /--[a-z-]*net-[a-z-]+\s*:[^;]*;/gi;
const VAR_FALLBACK = /var\(--[\w-]+\s*,[^()]*(?:\([^()]*\)[^()]*)*\)/g;

const args = process.argv.slice(2);
const check = args.includes('--check');
let only = null;
const oi = args.indexOf('--only');
if (oi >= 0) { only = new RegExp(args[oi + 1]); args.splice(oi, 2); }
const files = args.filter(a => !a.startsWith('--'));
if (!files.length) { console.error('usage: sweep-brand-hex.mjs [--check] [--only <regex>] <file.css>...'); process.exit(2); }

const hexRe = /#([0-9a-f]{3,8})\b/gi;
const rgbaRe = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([0-9.]+)\s*)?\)/gi;

function sweepDecls(text, stats) {
  // Guards protect var() fallbacks and keep-decls. The placeholder can never
  // collide with real CSS text (a bare ` 1 ` in `flex: 1 1 auto` would).
  const guards = [];
  const guard = (m) => { guards.push(m); return `@@G${guards.length - 1}@@`; };
  let t = text.replace(KEEP_DECL, guard).replace(VAR_FALLBACK, guard);
  // Border declarations first — a neutral that reads as "text" elsewhere is a
  // border tone here.
  t = t.replace(/(border[a-z-]*\s*:[^;{}]*?)(#[0-9a-f]{6})\b/gi, (m, head, hex) => {
    const v = BORDER_OVERRIDES[hex.toLowerCase()];
    if (!v) return m;
    stats.hex++;
    return `${head}var(${v})`;
  });
  t = t.replace(hexRe, (m) => {
    const v = HEX[m.toLowerCase()];
    if (!v) return m;
    stats.hex++;
    return `var(${v})`;
  });
  t = t.replace(rgbaRe, (m, r, g, b, a) => {
    const v = RGB[`${r},${g},${b}`];
    if (!v) return m;
    stats.rgba++;
    const pct = a === undefined ? 100 : Math.round(parseFloat(a) * 100);
    return pct >= 100 ? `var(${v})` : `color-mix(in srgb, var(${v}) ${pct}%, transparent)`;
  });
  for (const [re, to] of FONTS) t = t.replace(re, () => { stats.fonts++; return to; });
  t = t.replace(WHITE_TEXT, (m, head, lit) => {
    if (!isTextWhite(lit)) return m;
    stats.hex++;
    return `${head}var(--ncm-text-primary)`;
  });
  return t.replace(/@@G(\d+)@@/g, (_, i) => guards[+i]);
}

/** Walk rule blocks; sweep declarations of blocks whose selector passes `only`. */
function sweepFile(src, stats) {
  if (!only) return sweepDecls(src, stats);
  let out = '';
  let i = 0;
  const stack = []; // true = sweep this block's declarations
  let segStart = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 2; if (i < 2) i = src.length; continue; }
    if (ch === '{') {
      const head = src.slice(segStart, i);
      const sel = head.split(/[{};]/).pop().trim();
      const isAt = sel.startsWith('@');
      const parentOn = stack.length ? stack[stack.length - 1] : false;
      const on = isAt ? parentOn : (only.test(sel) || (parentOn && /^[\d.]+%|^from$|^to$/.test(sel)));
      out += src.slice(segStart, i + 1);
      stack.push(on);
      segStart = i + 1;
      i++;
      continue;
    }
    if (ch === '}') {
      const on = stack.pop();
      const body = src.slice(segStart, i);
      out += on ? sweepDecls(body, stats) : body;
      out += '}';
      segStart = i + 1;
      i++;
      continue;
    }
    i++;
  }
  out += src.slice(segStart);
  return out;
}

function remaining(src) {
  const t = src.replace(KEEP_DECL, '').replace(VAR_FALLBACK, '');
  const hex = [...t.matchAll(hexRe)].filter(m => HEX[m[0].toLowerCase()]).map(m => m[0].toLowerCase());
  const rgb = [...t.matchAll(rgbaRe)].filter(m => RGB[`${m[1]},${m[2]},${m[3]}`]).map(m => m[0]);
  const white = [...t.matchAll(WHITE_TEXT)].filter(m => isTextWhite(m[2])).map(m => m[2].toLowerCase());
  return { hex, rgb, white };
}

let exit = 0;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  if (check) {
    const r = remaining(src);
    const n = r.hex.length + r.rgb.length + r.white.length;
    console.log(`${n ? 'REMAINING' : 'clean    '} ${f}: ${r.hex.length} hex, ${r.rgb.length} rgba, ${r.white.length} text-white${n ? '  e.g. ' + [...r.hex, ...r.rgb, ...r.white].slice(0, 4).join(' ') : ''}`);
    if (n) exit = 1;
    continue;
  }
  const stats = { hex: 0, rgba: 0, fonts: 0 };
  const out = sweepFile(src, stats);
  if (out !== src) fs.writeFileSync(f, out);
  console.log(`swept ${f}: ${stats.hex} hex, ${stats.rgba} rgba, ${stats.fonts} font stacks`);
}
process.exit(exit);
