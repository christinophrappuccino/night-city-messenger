/**
 * Where the call screen sits (tester 2026-11-05: "it overlaps some of the UI elements on the side").
 * @file scripts/ui/Calls/hudPlace.js
 * @module night-city-messenger
 * @description The call badge used to sit at a fixed 76px / 74px from the top-left, which is under v12's second
 *   scene-control column (the tools of the open layer) and any module that widens that column. Now:
 *   - by default it measures Foundry's left controls and the scene bar, then probes its own rows for anything else
 *     clickable down the left (another module's toolbar) and stands clear of all of it; it measures again when the
 *     scene controls re-render, the window resizes, or a new call shows;
 *   - a player can drag it like any overlay (grip, portrait, dial or name chip); the spot is kept per client
 *     (localStorage) and clamped to the screen;
 *   - a double-click on the grip puts it back.
 *   The emergency call screen reads the same two variables, so it follows. Set on <html> (both are body-mounted).
 */

export const HUD_DEFAULT = Object.freeze({ left: 76, top: 74 });
const KEY = 'ncm.callHudPos';
const GAP_X = 16, GAP_Y = 14;
/** Foundry's left column (v12 the two `ol.control-tools`, v13 the layers + tools menus) and the scene bar. */
const LEFT_UI = ['#controls ol.control-tools', '#scene-controls-layers', '#scene-controls-tools'];
const TOP_UI = ['#navigation', '#scene-navigation'];

const shown = (el) => {
  if (!el) return null;
  const r = el.getBoundingClientRect?.();
  if (!r || !r.width || !r.height) return null;
  const cs = globalThis.getComputedStyle?.(el);
  if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return null;
  return r;
};

/**
 * The default spot: right of Foundry's left controls, under the scene bar, never nearer than HUD_DEFAULT.
 * @param {Document} [doc]
 * @returns {{left:number, top:number}}
 */
export function autoPlace(doc = globalThis.document) {
  let { left, top } = HUD_DEFAULT;
  if (!doc?.querySelectorAll) return { left, top };
  for (const sel of LEFT_UI) for (const el of doc.querySelectorAll(sel)) {
    const r = shown(el);
    // only the controls near the top matter: the badge is ~200px tall from `top`
    if (r && r.top < top + 220) left = Math.max(left, Math.round(r.right + GAP_X));
  }
  for (const sel of TOP_UI) {
    const r = shown(doc.querySelector(sel));
    if (r && r.top < 120) top = Math.max(top, Math.round(r.bottom + GAP_Y));
  }
  left = Math.max(left, scanLeft(doc, top));
  return { left, top };
}

/** Not UI to dodge: the canvas, the page, our own call screen, and open windows (they move; the badge should not chase them). */
const SKIP = '#board, canvas, #ncm-call-hud, .app, .application, .window-app, #tooltip';
const SCAN_MAX_X = 420, SCAN_STEP = 6, SCAN_GAP = 36, BAND = 200;

/**
 * Whatever a module puts down the left side (a second toolbar, a token-action column, a bigger controls theme):
 * probe the badge's own rows with elementFromPoint (which skips pointer-events:none, so the click-through UI
 * wrappers never count) and walk right while there is clickable UI, allowing small gaps between buttons.
 * @returns {number} the x the badge must start at (0 when nothing is there)
 */
export function scanLeft(doc = globalThis.document, top = HUD_DEFAULT.top) {
  if (typeof doc?.elementsFromPoint !== 'function') return 0;
  // the topmost thing that is not our own call screen (the badge may be sitting on the very controls being measured)
  const hit = (x, y) => doc.elementsFromPoint(x, y).find((el) => !el.closest?.('#ncm-call-hud')) || null;
  let edge = 0;
  for (let y = top; y <= top + BAND; y += 20) {
    let last = -1;
    for (let x = 2; x <= SCAN_MAX_X; x += SCAN_STEP) {
      const el = hit(x, y);
      const ui = el && el !== doc.body && el !== doc.documentElement && !el.closest?.(SKIP);
      if (ui) last = x;
      else if (last < 0 ? x > SCAN_GAP : x - last > SCAN_GAP) break;
    }
    if (last >= 0) edge = Math.max(edge, last + SCAN_STEP + GAP_X);
  }
  return Math.round(edge);
}

/** Keep a spot on screen (the badge's grip must stay reachable after a window resize). */
export function clampPlace(p, vw = globalThis.innerWidth || 1920, vh = globalThis.innerHeight || 1080) {
  const n = (v, lo, hi) => Math.round(Math.min(Math.max(Number(v) || 0, lo), Math.max(lo, hi)));
  return { left: n(p.left, 24, vw - 160), top: n(p.top, 8, vh - 80) };
}

export function loadPlace() {
  try {
    const p = JSON.parse(globalThis.localStorage?.getItem(KEY) || 'null');
    return p && Number.isFinite(p.left) && Number.isFinite(p.top) ? p : null;
  } catch { return null; }
}

export function savePlace(p) {
  try { if (p) globalThis.localStorage?.setItem(KEY, JSON.stringify({ left: Math.round(p.left), top: Math.round(p.top) })); else globalThis.localStorage?.removeItem(KEY); } catch { /* private window: the spot lasts until reload */ }
}

/** The spot to use now: the player's own, else the measured default. */
export function currentPlace(doc = globalThis.document) {
  const own = loadPlace();
  return own ? clampPlace(own) : autoPlace(doc);
}

/** Write the spot where the call screens read it. */
export function applyPlace(p, doc = globalThis.document) {
  const st = doc?.documentElement?.style;
  if (!st) return;
  st.setProperty('--ncm-ch-left', `${p.left}px`);
  st.setProperty('--ncm-ch-top', `${p.top}px`);
}
