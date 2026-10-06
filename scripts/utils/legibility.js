/**
 * Legibility — ONE place for the adjustable accessibility options of NCM's FUI windows.
 * @file scripts/utils/legibility.js
 * @module night-city-messenger
 * @description The Shard Encoder is the first consumer; any FUI surface can adopt it by
 *   calling `applyLegibility(rootEl)` in its `_onRender` and reacting to the attributes
 *   in its stylesheet. Prefs are PER PLAYER (client setting `legibilityPrefs`) and sit ON
 *   TOP of the Theme Customizer — text size MULTIPLIES the player's own Text Size (the
 *   per-shard slider pattern: `--ncm-text-scale-base` × `--ncm-lg-text`), contrast is the
 *   same OKLCH tone-map (`applyContrastToElement`), so nothing here fights the theme.
 *
 *   What it stamps on the root element:
 *     --ncm-lg-text            text-size multiplier (0.8–1.6); the surface's CSS composes it
 *     data-lg-motion           full | calm | off   (off is FORCED by prefers-reduced-motion
 *                              and by the module's own animation pref — never overridable UP)
 *     data-lg-density          compact | roomy
 *     data-lg-outlines         true | false        (stronger box edges + focus rings)
 *     data-lg-font             theme | plain       (plain swaps display/mono for the body face)
 *   plus the contrast palette inline (100% removes it, so an untouched window follows the theme).
 */

import { MODULE_ID } from './constants.js';
import { applyContrastToElement } from './helpers.js';

export const LEGIBILITY_DEFAULTS = Object.freeze({
  textScale: 100,      // 80–160 (%), step 5
  contrast: 100,       // 70–140 (%), step 5
  motion: 'full',      // full | calm | off
  density: 'compact',  // compact | roomy
  outlines: false,     // stronger box separation
  plainFont: false,    // body font everywhere (no mono / display caps)
  details: false,      // open number disclosures by default
});

export const LEGIBILITY_RANGES = Object.freeze({
  textScale: { min: 80, max: 160, step: 5 },
  contrast:  { min: 70, max: 140, step: 5 },
});

/** Named starting points — one click, then fine-tune. */
export const LEGIBILITY_PRESETS = Object.freeze({
  default:  { label: 'Default',        icon: 'fas fa-rotate-left',      prefs: { ...LEGIBILITY_DEFAULTS } },
  large:    { label: 'Large text',     icon: 'fas fa-text-height',      prefs: { textScale: 130, density: 'roomy' } },
  contrast: { label: 'High contrast',  icon: 'fas fa-circle-half-stroke', prefs: { contrast: 130, outlines: true } },
  calm:     { label: 'Calm',           icon: 'fas fa-feather',          prefs: { motion: 'calm', plainFont: true } },
  max:      { label: 'Maximum',        icon: 'fas fa-universal-access', prefs: { textScale: 140, contrast: 130, motion: 'off', density: 'roomy', outlines: true, plainFont: true, details: true } },
});

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/** Sanitize a prefs object (unknown keys dropped, ranges clamped). */
export function normalizeLegibility(p = {}) {
  const d = LEGIBILITY_DEFAULTS, r = LEGIBILITY_RANGES;
  return {
    textScale: clamp(Number(p.textScale) || d.textScale, r.textScale.min, r.textScale.max),
    contrast: clamp(Number(p.contrast) || d.contrast, r.contrast.min, r.contrast.max),
    motion: ['full', 'calm', 'off'].includes(p.motion) ? p.motion : d.motion,
    density: ['compact', 'roomy'].includes(p.density) ? p.density : d.density,
    outlines: !!p.outlines,
    plainFont: !!p.plainFont,
    details: !!p.details,
  };
}

export function getLegibility() {
  try { return normalizeLegibility(game.settings.get(MODULE_ID, 'legibilityPrefs')); }
  catch { return { ...LEGIBILITY_DEFAULTS }; }
}

export async function setLegibility(patch) {
  const next = normalizeLegibility({ ...getLegibility(), ...patch });
  try { await game.settings.set(MODULE_ID, 'legibilityPrefs', next); } catch { /* setting not registered yet */ }
  return next;
}

/**
 * The motion level actually in force. The player's choice can only ever be LOWERED:
 * the OS reduced-motion flag and the module's animation pref both force `off`.
 */
export function effectiveMotion(prefs, { animationsEnabled = true } = {}) {
  const osReduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (osReduced || !animationsEnabled) return 'off';
  return prefs?.motion || 'full';
}

/** Stamp the prefs onto a surface root. Safe to call on every render / slider tick. */
export function applyLegibility(el, prefs = getLegibility(), opts = {}) {
  if (!el?.style) return prefs;
  const p = normalizeLegibility(prefs);
  el.style.setProperty('--ncm-lg-text', String(p.textScale / 100));
  el.dataset.lgMotion = effectiveMotion(p, opts);
  el.dataset.lgDensity = p.density;
  el.dataset.lgOutlines = String(p.outlines);
  el.dataset.lgFont = p.plainFont ? 'plain' : 'theme';
  applyContrastToElement(el, p.contrast);
  return p;
}
