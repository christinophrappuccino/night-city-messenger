/**
 * crt — ONE CRT film for every NCM surface (2026-10-25, v2 the same day).
 * @file scripts/utils/crt.js
 * @module night-city-messenger
 *
 * Dev: "rather than building scanlines into each and every thing, one scanline
 * layer on top that's well built and can be toggled and configured." Before this
 * there were FOUR films; all gone, this is the one. v2 (dev, after the first
 * live look: "the bezel doesn't look like a terminal… the glass is cool… all of
 * this should be customizable"): the film is ONE PANE OF GLASS over the whole
 * window — header included — built from independent LAYERS, every layer a knob.
 *
 * The pane is real DOM, not pseudo-elements (seven layers need seven boxes):
 * `applyCrt(el, crt)` stamps attributes + `--ncm-crt-*` variables on the HOST and
 * ensures a click-through `.ncm-crt-pane` child; styles/components/crt.css paints
 * it. Nothing else creates one.
 *
 *   data-ncm-crt          off | glass | tube | arcade   (legacy fine/classic/phosphor/grille map)
 *   data-ncm-crt-roll / -bezel / -flicker / -grain   "true" when that layer is on
 *   --ncm-crt-pitch · -light · -cut · -soft · -grille · -glow · -fringe · -vignette ·
 *   -bloom · -bloom-size · -sheen · -curve · -bezel · -roll-speed · -flicker · -grain
 *
 * A crt BLOCK is sparse: { style, intensity, vignette, roll } plus any layer the
 * user moved off the look's base. `effectiveCrt()` lays the overrides over
 * `CRT_BASE[style]` and scales the strength layers by intensity (35 = the look as
 * designed), so a stored block from v1 (four fields) renders the new look with no
 * migration. Hosts: every player window root (BaseApplication, from the Theme
 * Customizer), a terminal's window root (from ITS theme), a shard's window root
 * (from ITS theme) — each machine/shard switches the player's film off on its own
 * window so the two never stack. A `[data-ncm-admin-theme]` host never shows it.
 *
 * The PLAYER'S CAP (`playerCrtCap` → `capCrt`): an accessibility ceiling in the
 * Theme Customizer — "Film on terminals & shards: as designed / dimmed / off" —
 * applied by the terminal and shard viewers over whatever the GM authored, on
 * this client only. Never a floor: it can only lower.
 *
 * `resolveCrt` / `sanitizeCrt` / `effectiveCrt` / `capCrt` / `crtPanelContext` are
 * pure (sim: dev/tools/sims/test-crt.mjs); `applyCrt` / `wireCrtPanel` /
 * `paintCrtPanel` touch the DOM.
 */

export const CRT_STYLES = Object.freeze([
  { key: 'off',    label: 'Off',    icon: 'fas fa-ban',           hint: 'No film at all.' },
  { key: 'glass',  label: 'Glass',  icon: 'fas fa-grip-lines',    hint: 'A sheet of glass over the screen: a faint light raster, a soft vignette, a little bloom. The lines live in the dark and the text stays crisp.' },
  { key: 'tube',   label: 'Tube',   icon: 'fas fa-tv',            hint: 'A real CRT: the raster cuts through the text, phosphor bleed, a red/cyan fringe, a curved face and a bezel. Old boxes, BBS nodes.' },
  { key: 'arcade', label: 'Arcade', icon: 'fas fa-grip-vertical', hint: 'Aperture grille: red/green/blue stripes under the lines. Trinitron, arcade cabinet.' },
]);
/** v1 style keys → v2 looks (a stored v1 block keeps working). */
// classic → GLASS: it was the default PLAYER film, and mapping it to Tube put a bezel and a dark cut on every
// Agent saved before v2 (dev: "the messenger inbox looks ugly"). Terminal presets name their look explicitly.
export const CRT_LEGACY = Object.freeze({ fine: 'glass', classic: 'glass', phosphor: 'tube', grille: 'arcade' });

/** Every layer, its slider range and what it does — the Advanced fold renders this list. */
export const CRT_LAYERS = Object.freeze({
  pitch:     { label: 'Line pitch',   min: 2,  max: 6,   step: 1,    unit: 'px', hint: 'Rows between scanlines. 3 reads as a tube at desk distance; 2 shimmers on a 1× screen and halves the text.' },
  light:     { label: 'Light line',   min: 0,  max: .4,  step: .01,  unit: '',   hint: 'The bright line of the raster. Lives in the dark; adds almost nothing on a bright fill.' },
  cut:       { label: 'Cut',          min: 0,  max: .7,  step: .01,  unit: '',   hint: 'The dark gap between lines. Invisible on black; this is what makes text look scanned.' },
  soft:      { label: 'Softness',     min: 0,  max: 1.2, step: .05,  unit: '',   hint: 'Takes the edge off the lines (lower contrast, never wider). Higher keeps text readable under a strong cut.' },
  grille:    { label: 'RGB grille',   min: 0,  max: .5,  step: .01,  unit: '',   hint: 'Red/green/blue subpixel stripes (aperture grille).' },
  glow:      { label: 'Glow',         min: 0,  max: 10,  step: .5,   unit: 'px', hint: 'Phosphor bleed on every glyph.' },
  fringe:    { label: 'Fringe',       min: 0,  max: 1.2, step: .05,  unit: 'px', hint: 'Red/cyan colour fringe on the text (chromatic aberration).' },
  vignette:  { label: 'Vignette',     min: 0,  max: .8,  step: .01,  unit: '',   hint: 'Darkened edges and corners.' },
  bloom:     { label: 'Bloom',        min: 0,  max: .5,  step: .01,  unit: '',   hint: 'The machine\'s primary colour bleeding in from the edges.' },
  bloomSize: { label: 'Bloom size',   min: 30, max: 200, step: 5,    unit: 'px', hint: 'How far the bloom reaches.' },
  sheen:     { label: 'Sheen',        min: 0,  max: .08, step: .005, unit: '',   hint: 'A faint diagonal reflection on the glass.' },
  curve:     { label: 'Curvature',    min: 0,  max: 40,  step: 1,    unit: '%',  hint: 'The raster fades toward the edges, like a curved face.' },
  bezel:     { label: 'Bezel',        min: 0,  max: 16,  step: 1,    unit: 'px', hint: 'A dark lip with a hairline around the screen. 0 = none.' },
  rollSpeed: { label: 'Band speed',   min: 3,  max: 20,  step: 1,    unit: 's',  hint: 'Seconds per pass of the rolling band (the band itself is the switch above).' },
  flicker:   { label: 'Flicker',      min: 0,  max: .12, step: .01,  unit: '',   hint: 'Occasional brightness dips. Off under reduced motion.' },
  grain:     { label: 'Grain',        min: 0,  max: .2,  step: .01,  unit: '',   hint: 'Analogue noise. Off under reduced motion.' },
});
export const CRT_LAYER_KEYS = Object.freeze(Object.keys(CRT_LAYERS));
/** The layers intensity scales (geometry — pitch, softness, sizes, bezel, speed — it leaves alone). */
export const CRT_STRENGTH_KEYS = Object.freeze(['light', 'cut', 'grille', 'glow', 'fringe', 'vignette', 'bloom', 'sheen', 'grain', 'flicker']);
/** Intensity at which a look renders exactly as designed. */
export const CRT_INTENSITY_BASE = 35;

/** The looks (2026-10-25, second pass — dev in Foundry: "too thick, too wide apart, too intense, no
 *  animation"). The first values were judged on 2× renders, where a 1px line looks half as thick;
 *  these are tuned at 1×: fine pitch, faint lines, a slow band on every look. */
export const CRT_BASE = Object.freeze({
  off:    Object.freeze({ pitch: 3, light: 0,   cut: 0,   soft: 0,   grille: 0,   glow: 0,   fringe: 0,   vignette: 0,   bloom: 0,   bloomSize: 90,  sheen: 0,    curve: 0,  bezel: 0, rollSpeed: 9,  flicker: 0,   grain: 0 }),
  glass:  Object.freeze({ pitch: 2, light: .05, cut: 0,   soft: .5,  grille: 0,   glow: .5,  fringe: 0,   vignette: .25, bloom: .10, bloomSize: 110, sheen: .02,  curve: 10, bezel: 0, rollSpeed: 8,  flicker: 0,   grain: .02 }),
  tube:   Object.freeze({ pitch: 3, light: .08, cut: .16, soft: .6,  grille: 0,   glow: 2.5, fringe: .35, vignette: .4,  bloom: .18, bloomSize: 130, sheen: .02,  curve: 18, bezel: 6, rollSpeed: 10, flicker: .02, grain: .04 }),
  arcade: Object.freeze({ pitch: 3, light: .05, cut: .10, soft: .5,  grille: .16, glow: 1.5, fringe: .2,  vignette: .3,  bloom: .12, bloomSize: 120, sheen: .015, curve: 14, bezel: 0, rollSpeed: 9,  flicker: 0,   grain: .02 }),
});

export const CRT_DEFAULT = Object.freeze({ style: 'glass', intensity: CRT_INTENSITY_BASE, vignette: true, roll: true });
export const CRT_OFF = Object.freeze({ style: 'off', intensity: 0, vignette: false, roll: false });
export const CRT_CAPS = Object.freeze([
  { key: 'asis', label: 'As designed', hint: 'Each terminal and shard shows the film its maker gave it.' },
  { key: 'dim',  label: 'Dimmed',      hint: 'Half strength, no motion — the look survives, the strain does not.' },
  { key: 'off',  label: 'Off',         hint: 'No film on any terminal or shard you open. Nobody else is affected.' },
]);

const STYLE_KEYS = new Set(CRT_STYLES.map(s => s.key));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const styleOf = (raw) => (STYLE_KEYS.has(raw) ? raw : CRT_LEGACY[raw] || null);

/** Clamp/shape a crt block; unknown style → the fallback style, never a crash. Layer overrides are kept SPARSE. */
export function sanitizeCrt(raw = {}, fallbackStyle = 'glass') {
  const style = styleOf(raw?.style) || styleOf(fallbackStyle) || 'glass';
  const n = num(raw?.intensity);
  const intensity = n === null ? CRT_DEFAULT.intensity : Math.round(clamp(n, 0, 100));
  // v1's phosphor look was "classic with a glow and the rolling band" — keep the band unless told otherwise.
  const rollDefault = raw?.style === 'phosphor';
  const out = {
    style, intensity,
    vignette: raw?.vignette !== false && raw?.vignette !== 'false',
    roll: raw?.roll === true || raw?.roll === 'true' || (rollDefault && raw?.roll !== false && raw?.roll !== 'false'),
  };
  for (const k of CRT_LAYER_KEYS) {
    const v = num(raw?.[k]);
    if (v === null) continue;
    const r = CRT_LAYERS[k];
    out[k] = Math.round(clamp(v, r.min, r.max) * 1000) / 1000;
  }
  return out;
}

/**
 * The effective crt block for a theme-ish object.
 * @param {object} src       - { crt?, scanlines? } (player prefs or a terminal / shard theme)
 * @param {object|null} [fallback] - e.g. the preset's crt
 */
export function resolveCrt(src = {}, fallback = null) {
  if (src?.crt && typeof src.crt === 'object') return sanitizeCrt(src.crt);
  if (src?.scanlines === true) return { ...CRT_DEFAULT };          // legacy boolean
  if (src?.scanlines === false) return { ...CRT_OFF };
  if (fallback && typeof fallback === 'object') return sanitizeCrt(fallback);
  return { ...CRT_OFF };
}

/**
 * Every layer as a NUMBER for this block: the look's base, the block's overrides on
 * top, the strength layers scaled by intensity (35 = as designed), the vignette and
 * rolling-band switches applied. What crt.css actually paints.
 */
export function effectiveCrt(crt) {
  const c = sanitizeCrt(crt || CRT_OFF, 'off');
  const base = CRT_BASE[c.style] || CRT_BASE.off;
  const out = { style: c.style };
  const mult = c.style === 'off' ? 0 : c.intensity / CRT_INTENSITY_BASE;
  for (const k of CRT_LAYER_KEYS) {
    const r = CRT_LAYERS[k];
    let v = k in c ? c[k] : base[k];
    if (CRT_STRENGTH_KEYS.includes(k)) v = clamp(v * mult, r.min, r.max);
    out[k] = Math.round(v * 1000) / 1000;
  }
  if (!c.vignette) out.vignette = 0;
  out.roll = c.style !== 'off' && !!c.roll;
  out.bezelOn = c.style !== 'off' && out.bezel > 0;
  out.flickerOn = c.style !== 'off' && out.flicker > 0;
  out.grainOn = c.style !== 'off' && out.grain > 0;
  return out;
}

/** The attribute + variable set a host carries for a crt block (pure). */
export function crtAttrs(crt) {
  const e = effectiveCrt(crt);
  const on = e.style !== 'off';
  return {
    'data-ncm-crt': e.style,
    'data-ncm-crt-roll': String(on && e.roll),
    'data-ncm-crt-bezel': String(on && e.bezelOn),
    'data-ncm-crt-flicker': String(on && e.flickerOn),
    'data-ncm-crt-grain': String(on && e.grainOn),
    '--ncm-crt-intensity': String(Math.round(sanitizeCrt(crt || CRT_OFF, 'off').intensity) / 100),   // v1 var, kept for anything that still reads it
    '--ncm-crt-pitch': `${e.pitch}px`,
    // Softness LOWERS the lines' contrast. It used to be a blur filter, which smeared every 1px line into a
    // 2–3px band — fatter and heavier the softer you asked for (dev: "thicker and more intense in Foundry").
    '--ncm-crt-light': String(Math.round(e.light * (1 - e.soft * 0.35) * 1000) / 1000),
    '--ncm-crt-cut': String(Math.round(e.cut * (1 - e.soft * 0.45) * 1000) / 1000),
    '--ncm-crt-roll-a': String(Math.round(Math.min(.12, .045 * (e.style === 'off' ? 0 : sanitizeCrt(crt || CRT_OFF, 'off').intensity / CRT_INTENSITY_BASE)) * 1000) / 1000),
    '--ncm-crt-grille': String(e.grille),
    '--ncm-crt-glow': `${e.glow}px`,
    '--ncm-crt-fringe': String(e.fringe),
    '--ncm-crt-fringe-a': e.fringe > 0 ? '.55' : '0',
    '--ncm-crt-fringe-b': e.fringe > 0 ? '.45' : '0',
    '--ncm-crt-vignette': String(e.vignette),
    '--ncm-crt-bloom': String(e.bloom),
    '--ncm-crt-bloom-size': `${e.bloomSize}px`,
    '--ncm-crt-sheen': String(e.sheen),
    '--ncm-crt-curve': `${e.curve}%`,
    '--ncm-crt-bezel': `${e.bezel}px`,
    '--ncm-crt-roll-speed': `${e.rollSpeed}s`,
    '--ncm-crt-flicker': String(e.flicker),
    '--ncm-crt-grain': String(e.grain),
  };
}

/** The pane's layer order, back to front. */
export const CRT_PANE_LAYERS = Object.freeze(['cut', 'light', 'grille', 'room', 'grain', 'roll', 'bezel']);

/** Ensure (or remove) the click-through pane under a host. DOM; safe on a non-element. */
export function ensureCrtPane(el, on) {
  if (!el || typeof el.querySelector !== 'function') return null;
  let pane = el.querySelector(':scope > .ncm-crt-pane');
  if (!on) { pane?.remove(); return null; }
  if (!pane) {
    pane = document.createElement('div');
    pane.className = 'ncm-crt-pane';
    pane.setAttribute('aria-hidden', 'true');
    pane.innerHTML = CRT_PANE_LAYERS.map(k => `<i class="ncm-crt__${k}"></i>`).join('');
    el.appendChild(pane);
  } else if (pane !== el.lastElementChild) {
    el.appendChild(pane);   // a re-render may have appended content after it — the pane stays on top
  }
  return pane;
}

/** Stamp the film onto a host element (DOM). Safe on null. */
export function applyCrt(el, crt) {
  if (!el) return;
  const a = crtAttrs(crt);
  for (const [k, v] of Object.entries(a)) {
    if (k.startsWith('--')) el.style?.setProperty?.(k, v);
    else el.setAttribute?.(k, v);
  }
  ensureCrtPane(el, a['data-ncm-crt'] !== 'off');
}

// ── taming stored films (the v2 retune, migration v2) ─────────────────────────

/** The ceiling a stored film is brought down to: glass 25, every other look 30. */
export const CRT_TAME_MAX = Object.freeze({ glass: 25, tube: 30, arcade: 30 });

/**
 * A stored crt block brought to the v2 levels (pure): the legacy style key renamed,
 * intensity capped, the rolling band on. Returns null when nothing changes.
 */
export function tameCrtBlock(block) {
  if (!block || typeof block !== 'object' || !('style' in block)) return null;
  const style = styleOf(block.style) || 'glass';
  const out = { ...block, style };
  if (style !== 'off') {
    const n = num(block.intensity);
    const cap = CRT_TAME_MAX[style] ?? 30;
    out.intensity = n === null ? Math.min(CRT_INTENSITY_BASE, cap) : Math.min(Math.round(n), cap);
    out.roll = true;
  }
  return JSON.stringify(out) === JSON.stringify(block) ? null : out;
}

/** Walk any object (a config, a saved-theme list, a preset library) and tame every `crt` block in place. Returns how many changed. */
export function tameCrtDeep(obj, seen = new Set()) {
  if (!obj || typeof obj !== 'object' || seen.has(obj)) return 0;
  seen.add(obj);
  let n = 0;
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'crt' && v && typeof v === 'object') { const t = tameCrtBlock(v); if (t) { obj[k] = t; n++; } continue; }
    if (v && typeof v === 'object') n += tameCrtDeep(v, seen);
  }
  return n;
}

// ── the player's accessibility cap ───────────────────────────────────────────

/** 'asis' | 'dim' | 'off' from the player's theme prefs (client setting); 'asis' when unreadable. */
export function playerCrtCap() {
  try {
    const t = globalThis.game?.nightcity?.settingsManager?.getTheme?.();
    return CRT_CAPS.some(c => c.key === t?.crtCap) ? t.crtCap : 'asis';
  } catch { return 'asis'; }
}

/** Apply the cap to an authored block (pure). It only ever LOWERS. */
export function capCrt(crt, cap = 'asis') {
  const c = sanitizeCrt(crt || CRT_OFF, 'off');
  if (cap === 'off') return { ...CRT_OFF };
  if (cap === 'dim') return { ...c, intensity: Math.round(c.intensity * 0.5), roll: false, flicker: 0, grain: 0 };
  return c;
}

// ── the shared config panel (templates/partials/crt-panel.hbs) ────────────────

/** Context for the panel partial: chips, the four switches, and one row per layer showing the current value. */
export function crtPanelContext(crt) {
  const c = sanitizeCrt(crt || CRT_OFF, 'off');
  const base = CRT_BASE[c.style] || CRT_BASE.off;
  const hasOverrides = CRT_LAYER_KEYS.some(k => k in c);
  return {
    style: c.style, isOff: c.style === 'off', intensity: c.intensity, vignette: c.vignette, roll: c.roll, hasOverrides,
    styles: CRT_STYLES.map(s => ({ ...s, active: s.key === c.style })),
    layers: CRT_LAYER_KEYS.map(k => ({ key: k, ...CRT_LAYERS[k], value: k in c ? c[k] : base[k], overridden: k in c })),
  };
}

/** Repaint a rendered panel from a block — DOM only (chips, switches, slider positions, labels). */
export function paintCrtPanel(panel, crt) {
  if (!panel) return;
  const ctx = crtPanelContext(crt);
  panel.classList.toggle('is-off', ctx.isOff);
  panel.querySelectorAll('[data-crt-style]').forEach(ch => ch.classList.toggle('is-on', ch.dataset.crtStyle === ctx.style));
  const inten = panel.querySelector('[data-crt-intensity]'); if (inten) inten.value = String(ctx.intensity);
  const intenVal = panel.querySelector('[data-crt-intensity-val]'); if (intenVal) intenVal.textContent = `${ctx.intensity}%`;
  panel.querySelectorAll('[data-crt-toggle]').forEach(sw => sw.classList.toggle('ncm-tc__switch--on', !!ctx[sw.dataset.crtToggle]));
  for (const l of ctx.layers) {
    const s = panel.querySelector(`[data-crt-k="${l.key}"]`); if (s) s.value = String(l.value);
    const v = panel.querySelector(`[data-crt-val="${l.key}"]`); if (v) v.textContent = `${l.value}${l.unit}`;
    s?.closest('.ncm-crt-panel__lrow')?.classList.toggle('is-override', l.overridden);
  }
  panel.querySelector('[data-crt-reset]')?.classList.toggle('is-idle', !ctx.hasOverrides);
}

/**
 * Wire a rendered panel to a draft block. `draft()` returns the live block to
 * mutate (created on first touch by the caller); `onChange()` runs after every
 * edit (live preview). Manual listeners, never a re-render — the draft contract.
 */
export function wireCrtPanel(panel, { draft, onChange } = {}) {
  if (!panel || typeof draft !== 'function' || panel.dataset.crtWired) return;
  panel.dataset.crtWired = '1';
  const changed = () => { paintCrtPanel(panel, draft()); onChange?.(); };
  panel.querySelectorAll('[data-crt-style]').forEach(ch => ch.addEventListener('click', () => {
    const d = draft();
    d.style = ch.dataset.crtStyle;
    for (const k of CRT_LAYER_KEYS) delete d[k];      // a look is a clean start; Advanced edits from here
    if (d.style !== 'off') d.roll = true;   // every look moves a little; the switch turns it off
    changed();
  }));
  panel.querySelector('[data-crt-intensity]')?.addEventListener('input', (e) => { draft().intensity = Math.round(clamp(Number(e.target.value) || 0, 0, 100)); changed(); });
  panel.querySelectorAll('[data-crt-toggle]').forEach(sw => sw.addEventListener('click', () => { const d = draft(); const k = sw.dataset.crtToggle; d[k] = !d[k]; changed(); }));
  panel.querySelectorAll('[data-crt-k]').forEach(sl => sl.addEventListener('input', (e) => {
    const k = e.target.dataset.crtK; const r = CRT_LAYERS[k]; if (!r) return;
    draft()[k] = Math.round(clamp(Number(e.target.value) || 0, r.min, r.max) * 1000) / 1000;
    changed();
  }));
  panel.querySelector('[data-crt-adv]')?.addEventListener('click', (e) => {
    e.preventDefault();
    const adv = panel.querySelector('[data-crt-advanced]');
    const open = adv?.classList.toggle('is-open');
    e.currentTarget.classList.toggle('is-on', !!open);
  });
  panel.querySelector('[data-crt-reset]')?.addEventListener('click', (e) => { e.preventDefault(); const d = draft(); for (const k of CRT_LAYER_KEYS) delete d[k]; changed(); });
  paintCrtPanel(panel, draft());
}
