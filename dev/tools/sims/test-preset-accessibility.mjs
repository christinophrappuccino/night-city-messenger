/**
 * test-preset-accessibility.mjs — every shipped palette stays legible (2026-10-25).
 *
 * Dev: "run through and clean up any of the preset themes and make sure they're
 * okay and accessible." The audit that day found muted text at 3.8–4.5:1 on the
 * lighter surfaces of ten terminal presets, secondary text under 4.5:1 on six
 * Agent presets, muted text down to 2.7:1 on shard presets, two terminal presets
 * naming boot animations that did not exist (they rendered the base look) and
 * three presets with no mailbox layout. This sim pins the fixed state:
 *
 *   TERMINAL_PRESETS  textPrimary ≥ 7:1 · textSecondary ≥ 4.5:1 · textMuted ≥ 4.5:1
 *                     on ALL FOUR surfaces (bgDeep / bgBase / bgSurface / bgElevated);
 *                     primary / secondary / accent ≥ 3:1 on bgDeep + bgSurface (chips,
 *                     labels); bgDeep on primary ≥ 4.5:1 (the TTY's inverted row);
 *                     every enum field a registry key; a mailboxStyle + a crt block on
 *                     every preset; the five terminal.css mirror rules equal the JS.
 *   THEME_PRESETS     textPrimary ≥ 7:1, textSecondary ≥ 4.5:1 on all four surfaces,
 *                     and variables.css's --ncm-text-muted (the value every Agent
 *                     preset actually inherits) ≥ 4.5:1 on each preset's surfaces.
 *   SHARD_PRESETS     textPrimary ≥ 7:1, textSecondary + textMuted ≥ 4.5:1.
 *
 * Contrast is WCAG 2.x relative-luminance contrast. Run: node dev/tools/sims/test-preset-accessibility.mjs
 */
import fs from 'fs';
import { fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const read = (p) => fs.readFileSync(ROOT + p, 'utf8');
let pass = 0, fail = 0;
const check = (name, fn) => { try { const r = fn(); if (r === false) throw new Error('returned false'); pass++; } catch (e) { fail++; console.log('  FAIL ' + name + ' — ' + (e.message || e)); } };

globalThis.game = { settings: { get: () => undefined }, i18n: { localize: (k) => k } };
globalThis.foundry = { utils: { deepClone: (o) => JSON.parse(JSON.stringify(o)), mergeObject: (a, b) => ({ ...a, ...b }), randomID: () => 'x' } };
globalThis.Hooks = { on() {}, once() {}, call() {}, callAll() {} };
const C = await import('../../../scripts/utils/constants.js');

const hex2rgb = (h) => { h = String(h).replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255); };
const lum = (h) => { const [r, g, b] = hex2rgb(h).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const BGS = ['bgDeep', 'bgBase', 'bgSurface', 'bgElevated'];
const worst = (fg, pal) => Math.min(...BGS.filter(b => pal[b]).map(b => contrast(fg, pal[b])));
const f1 = (n) => n.toFixed(2);

console.log('\n[1] terminal presets — text on every surface');
const anims = new Set(C.BOOT_ANIMATIONS.map(a => a.key));
const logins = new Set(C.TERMINAL_LOGIN_STYLES.map(s => s.key));
const mbs = new Set(C.TERMINAL_MAILBOX_STYLES.map(s => s.key));
const sounds = new Set(Object.keys(C.TERMINAL_SOUND_SETS));
const crts = new Set(['off', 'glass', 'tube', 'arcade']);   // crt.js v2 looks (2026-10-25)
const css = read('styles/components/terminal.css');
for (const [k, p] of Object.entries(C.TERMINAL_PRESETS)) {
  const t = p.theme || {};
  check(`${k}: textPrimary ≥ 7:1 everywhere (${f1(worst(t.textPrimary, t))})`, () => worst(t.textPrimary, t) >= 7);
  check(`${k}: textSecondary ≥ 4.5:1 everywhere (${f1(worst(t.textSecondary, t))})`, () => worst(t.textSecondary, t) >= 4.5);
  check(`${k}: textMuted present and ≥ 4.5:1 everywhere (${t.textMuted ? f1(worst(t.textMuted, t)) : 'missing'})`, () => !!t.textMuted && worst(t.textMuted, t) >= 4.5);
  for (const a of ['primary', 'secondary', 'accent']) check(`${k}: ${a} ≥ 3:1 on bgDeep + bgSurface`, () => contrast(t[a], t.bgDeep) >= 3 && contrast(t[a], t.bgSurface) >= 3);
  check(`${k}: bgDeep on primary ≥ 4.5:1 (TTY inverted row)`, () => contrast(t.bgDeep, t.primary) >= 4.5);
  check(`${k}: boot.animationStyle is a BOOT_ANIMATIONS key`, () => anims.has(p.boot?.animationStyle));
  check(`${k}: boot.speed valid`, () => ['fast', 'normal', 'dramatic', 'custom'].includes(p.boot?.speed));
  check(`${k}: loginStyle / mailboxStyle / soundSet are registry keys`, () => logins.has(p.loginStyle) && mbs.has(p.mailboxStyle) && sounds.has(p.soundSet));
  check(`${k}: screensaver.motion valid`, () => ['drift', 'bounce', 'static'].includes(p.screensaver?.motion));
  check(`${k}: crt block present with a known style`, () => !!t.crt && crts.has(t.crt.style));
  check(`${k}: icon is a full FA class`, () => /^fa[sr]? fa-[a-z0-9-]+$/.test(p.icon));
  check(`${k}: folder names + at least one seed account`, () => !!p.folderNames?.inbox && (p.accounts || []).length > 0);
  const sel = `[data-terminal-preset="${k}"]`;
  if (css.includes(sel)) {
    const block = css.slice(css.indexOf(sel), css.indexOf('}', css.indexOf(sel)));
    const map = { primary: '--ncm-primary', secondary: '--ncm-secondary', accent: '--ncm-accent', bgDeep: '--ncm-bg-deep', bgBase: '--ncm-bg-base', bgSurface: '--ncm-bg-surface', bgElevated: '--ncm-bg-elevated', textPrimary: '--ncm-text-primary', textSecondary: '--ncm-text-secondary', textMuted: '--ncm-text-muted' };
    check(`${k}: the terminal.css mirror rule equals the JS palette`, () => {
      for (const [key, prop] of Object.entries(map)) { const m = new RegExp(`${prop}:\\s*(#[0-9a-fA-F]{3,8})`).exec(block); if (m && m[1].toLowerCase() !== String(t[key]).toLowerCase()) throw new Error(`${prop} css ${m[1]} vs js ${t[key]}`); }
    });
  }
}

console.log('\n[2] Agent (player) presets');
const vars = read('styles/base/variables.css');
const rootMuted = /--ncm-text-muted:\s*(#[0-9a-fA-F]{3,8})/.exec(vars)?.[1];
check('variables.css defines --ncm-text-muted', () => !!rootMuted);
for (const [k, p] of Object.entries(C.THEME_PRESETS)) {
  check(`${k}: textPrimary ≥ 7:1 everywhere (${f1(worst(p.textPrimary, p))})`, () => worst(p.textPrimary, p) >= 7);
  check(`${k}: textSecondary ≥ 4.5:1 everywhere (${f1(worst(p.textSecondary, p))})`, () => worst(p.textSecondary, p) >= 4.5);
  // A preset without its own textMuted inherits variables.css; Netrunner and Combat Zone carry one
  // (the root grey-violet sat at 3.96 / 4.44 on their elevated surfaces).
  check(`${k}: muted text (${p.textMuted ? 'own' : 'inherited --ncm-text-muted'}) ≥ 4.5:1 everywhere (${f1(worst(p.textMuted || rootMuted, p))})`, () => worst(p.textMuted || rootMuted, p) >= 4.5);
  for (const a of ['primary', 'secondary', 'accent']) check(`${k}: ${a} ≥ 3:1 on bgDeep + bgSurface`, () => contrast(p[a], p.bgDeep) >= 3 && contrast(p[a], p.bgSurface) >= 3);
}

console.log('\n[3] shard presets');
for (const [k, p] of Object.entries(C.SHARD_PRESETS || {})) {
  const pal = p.palette; if (!pal) continue;
  check(`${k}: textPrimary ≥ 7:1 everywhere (${f1(worst(pal.textPrimary, pal))})`, () => worst(pal.textPrimary, pal) >= 7);
  check(`${k}: textSecondary ≥ 4.5:1 everywhere (${f1(worst(pal.textSecondary, pal))})`, () => worst(pal.textSecondary, pal) >= 4.5);
  check(`${k}: textMuted ≥ 4.5:1 everywhere (${f1(worst(pal.textMuted, pal))})`, () => worst(pal.textMuted, pal) >= 4.5);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
