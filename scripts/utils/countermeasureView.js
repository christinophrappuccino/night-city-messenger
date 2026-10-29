/**
 * COUNTERMEASURE VISIBILITY — the Foundry side (settings, the expert check, the
 * per-object override editor). The rules themselves are in countermeasures.js.
 * @file scripts/utils/countermeasureView.js
 * @module night-city-messenger
 */

import { MODULE_ID } from './constants.js';
import { canOperate, resolveOperator } from './helpers.js';
import {
  sanitizeCmvConfig, sanitizeCmvOverride, resolveCountermeasures, expertHasRule, expertGate,
  recallScan, effectiveMode, CMV_VISIBILITY, CMV_DV,
} from './countermeasures.js';

/** The world config, sanitized. */
export function getCmvConfig() {
  let stored = {};
  try { stored = game.settings.get(MODULE_ID, 'countermeasureVisibility') || {}; } catch { /* not registered */ }
  return sanitizeCmvConfig(stored);
}

/** Is this character an expert under the world rule? (Empty rule = nobody.) */
export function isCmvExpert(actor, cfg = getCmvConfig()) {
  if (!actor || !expertHasRule(cfg.expert)) return false;
  try { return canOperate(actor, expertGate(cfg.expert), { standalone: true }).ok === true; } catch { return false; }
}

/** A short "why you know" label: the first role the actor carries that the rule names, else "expert". */
function expertLabelFor(actor, cfg) {
  const roles = (actor?.items ?? []).filter((i) => i.type === 'role').map((i) => String(i.name));
  const hit = roles.find((r) => cfg.expert.roles.some((w) => r.toLowerCase().includes(String(w).toLowerCase())));
  return hit || 'expert';
}

/**
 * Resolve what the viewing user can tell about one lock.
 * @param {object} o
 * @param {object} [o.override]     the object's `countermeasures` block
 * @param {string} o.key            the object key the scan is remembered under (SecurityService key works)
 * @param {Actor}  [o.actor]        defaults to the resolved operator
 * @param {number} [o.attemptsUsed]
 */
export function cmvForViewer({ override, key, actor = null, attemptsUsed = 0 } = {}) {
  const cfg = getCmvConfig();
  const who = actor ?? resolveOperator();
  const isGM = !!game.user?.isGM;
  const isExpert = !isGM && isCmvExpert(who, cfg);
  const view = resolveCountermeasures(cfg, override, {
    isGM, isExpert, expertLabel: isExpert ? expertLabelFor(who, cfg) : '',
    scan: who ? recallScan(who.id, key) : null, attemptsUsed,
  });
  view.cfg = cfg;
  return view;
}

// ── the per-object override editor (templates/partials/countermeasure-override.hbs) ──

/**
 * Context for the override partial: `{{> "…/countermeasure-override.hbs" cmv=cmvOverride}}`.
 * @param {object} [override] stored block
 * @param {string} [noun] "network" | "account" | "shard"
 */
export function cmvOverrideContext(override, noun = 'object') {
  const o = sanitizeCmvOverride(override);
  const cfg = getCmvConfig();
  return {
    noun,
    visibility: o.visibility, dv: o.dv, scanDV: o.scanDV ?? '',
    worldScanDV: cfg.scan.dv, worldMode: cfg.mode,
    visOpts: Object.entries(CMV_VISIBILITY).map(([value, v]) => ({ value, label: v.label, on: value === o.visibility })),
    dvOpts: Object.entries(CMV_DV).map(([value, v]) => ({ value, label: v.label, on: value === o.dv })),
    verdict: cmvOverrideVerdict(o, cfg, noun),
  };
}

/** The one-line "Players see this … as …" under the override. */
export function cmvOverrideVerdict(override, cfg = getCmvConfig(), noun = 'object') {
  const o = sanitizeCmvOverride(override);
  const mode = effectiveMode(cfg, o);
  const dvHidden = o.dv === 'hidden' || (o.dv === 'inherit' && cfg.hideDV && mode !== 'open');
  if (mode === 'open') return `Everyone sees what guards this ${noun}${o.dv === 'hidden' ? ', but not its DV' : ''}.`;
  const scan = (mode === 'scan' || mode === 'both') ? ` or scan it at DV ${o.scanDV ?? cfg.scan.dv}` : '';
  const expert = (mode === 'experts' || mode === 'both') ? 'they\'re an expert' : '';
  const how = [expert, scan.trim()].filter(Boolean).join(' ').replace(/^or /, '');
  return `Players see this ${noun} as "Security unreadable"${how ? ` unless ${how}` : ''}${dvHidden ? '; the DV stays hidden until a roll lands' : ''}.`;
}

/**
 * Wire one override block (segments are spans — a <button> in an admin window is
 * restyled with !important). DOM-only: never re-renders, so unsaved edits elsewhere
 * in the form survive. Safe to call on every render.
 * @param {HTMLElement} root  the element holding `[data-cmv-ovr]` (or the block itself)
 * @param {object} [opts] { onChange(state) }
 */
export function wireCmvOverride(root, { onChange } = {}) {
  const blocks = root?.matches?.('[data-cmv-ovr]') ? [root] : [...(root?.querySelectorAll?.('[data-cmv-ovr]') || [])];
  for (const box of blocks) {
    if (box.dataset.cmvWired) continue;
    box.dataset.cmvWired = '1';
    const paint = () => {
      const st = readCmvOverride(box);
      box.dataset.visibility = st.visibility;
      box.querySelectorAll('[data-cmv-scanrow]').forEach((r) => { r.hidden = st.visibility === 'visible'; });
      const v = box.querySelector('[data-cmv-verdict]');
      if (v) v.textContent = cmvOverrideVerdict(st, getCmvConfig(), box.dataset.noun || 'object');
      onChange?.(st);
    };
    const pick = (seg) => {
      const group = seg.closest('[data-cmv-seg]');
      group.querySelectorAll('[data-value]').forEach((s) => {
        const on = s === seg;
        s.classList.toggle('on', on);
        s.setAttribute('aria-checked', String(on));
      });
      paint();
    };
    box.addEventListener('click', (e) => {
      const seg = e.target.closest('[data-cmv-seg] [data-value]');
      if (seg && box.contains(seg)) { e.preventDefault(); pick(seg); }
    });
    box.addEventListener('keydown', (e) => {
      const seg = e.target.closest('[data-cmv-seg] [data-value]');
      if (seg && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pick(seg); }
    });
    box.querySelector('[data-cmv-scandv]')?.addEventListener('input', paint);
    paint();
  }
}

/** Read the override back out of the DOM (sanitized). Null when the block isn't on screen. */
export function readCmvOverride(root) {
  const box = root?.matches?.('[data-cmv-ovr]') ? root : root?.querySelector?.('[data-cmv-ovr]');
  if (!box) return null;
  const seg = (k) => box.querySelector(`[data-cmv-seg="${k}"] [data-value].on`)?.dataset.value;
  return sanitizeCmvOverride({
    visibility: seg('visibility'),
    dv: seg('dv'),
    scanDV: box.querySelector('[data-cmv-scandv]')?.value,
  });
}
