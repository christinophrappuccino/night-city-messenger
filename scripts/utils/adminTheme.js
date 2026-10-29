/**
 * Admin theme carry-over — ONE place that stamps the GM Admin Panel's theme
 * (preset + text size) onto any GM-tool surface.
 * @file scripts/utils/adminTheme.js
 * @module night-city-messenger
 *
 * The player theme writes --ncm-* to :root. styles/themes/admin-theme.css
 * re-defines the same variables on any element carrying
 * `data-ncm-admin-theme`, so a tagged window is themed in isolation. Two kinds
 * of surface get tagged:
 *   - BaseApplication subclasses with `static ADMIN_THEMED = true`
 *     (BaseApplication._applyAdminTheme calls stampAdminTheme on its root).
 *   - Foundry v1 `Dialog`s opened through adminDialog/adminConfirm/adminPrompt
 *     below: the wrapper adds ADMIN_DIALOG_CLASS, and the `renderDialog` hook
 *     (registerAdminDialogHook) stamps the theme + zoom when they render.
 *   - Foundry v1 `Dialog`s opened by PLAYER-facing windows (viewer, composer,
 *     contacts, shard viewer, terminal, Theme Customizer) go through
 *     playerDialog/playerConfirm/playerPrompt/playerWait: no palette change —
 *     they keep Foundry's own look — but the same hook zooms them by the
 *     player's Theme Customizer Text Size (2026-10-21, tester: "pop-up windows
 *     still not resizing for text"). A dialog follows ITS OPENER: when the
 *     opener is an admin-tagged window (a GM-view viewer, a config sheet) the
 *     player wrapper tags it as an admin dialog instead, the CyberTimePicker
 *     precedent. A raw `new Dialog(` anywhere in module code is therefore a
 *     dialog that scales with nothing — the sim greps for it.
 *
 * Text size is a CSS `zoom` on `.window-content` — the GM stylesheets are
 * hundreds of fixed-px font sizes with no --ncm-text-scale plumbing, so zoom
 * is the only honest lever; the window frame grows by the same ratio so the
 * layout keeps its proportions (see applyAdminZoom).
 *
 * Player-facing immersive windows (message viewer, composer, shard viewer,
 * terminal, Theme Customizer) deliberately never get tagged, even on a GM
 * client — the GM sees those as the players do.
 */

import { MODULE_ID } from './constants.js';
import { log } from './helpers.js';

/** Class the Dialog wrappers add so the render hook can find admin dialogs. */
export const ADMIN_DIALOG_CLASS = 'ncm-admin-dialog';
/** Class the player wrappers add: Foundry look, zoomed by the player's Text Size. */
export const PLAYER_DIALOG_CLASS = 'ncm-player-dialog';
/** The Theme Customizer slider's range (theme-customizer.hbs min/max). */
export const PLAYER_TEXT_SCALE_MIN = 80;
export const PLAYER_TEXT_SCALE_MAX = 150;

export const ADMIN_TEXT_SCALE_MIN = 100;
export const ADMIN_TEXT_SCALE_MAX = 150;

/**
 * Read the client-scoped admin theme prefs.
 * @returns {{preset: string, textScale: number}}
 */
export function getAdminThemePrefs() {
  let theme = {};
  try { theme = game.settings.get(MODULE_ID, 'adminTheme') || {}; } catch { /* pre-init */ }
  const pct = Number(theme.textScale) || 100;
  return {
    preset: theme.preset || 'clean-dark',
    textScale: Math.min(ADMIN_TEXT_SCALE_MAX, Math.max(ADMIN_TEXT_SCALE_MIN, pct)),
  };
}

/**
 * Stamp the admin preset on an element and force the diegetic atmosphere off
 * (scanlines/neon are player-theme flavour, never wanted on a GM tool).
 * @param {HTMLElement} el
 * @param {{preset?: string}} [prefs]
 */
export function stampAdminTheme(el, prefs = getAdminThemePrefs()) {
  if (!el) return;
  el.dataset.ncmAdminTheme = prefs.preset || 'clean-dark';
  el.dataset.ncmScanlines = 'false';
  el.dataset.ncmNeon = 'false';
}

/**
 * Undo stampAdminTheme on an element (the atmosphere pass re-applies the
 * player prefs on the next render). Clears the zoom too.
 * @param {HTMLElement} el
 */
export function clearAdminTheme(el) {
  if (!el) return;
  delete el.dataset.ncmAdminTheme;
  const content = el.querySelector?.('.window-content');
  if (content) content.style.zoom = '';
}

// ═══════════════════════════════════════════════════════════
//  GM view — an immersive window (message viewer, composer, contacts)
//  optionally shown to the GM in the admin theme for readability. One
//  client setting, toggled from any of those windows' header menus; every
//  open GM-view window re-renders so they agree.
// ═══════════════════════════════════════════════════════════

/** @returns {boolean} whether the GM wants immersive windows in the admin theme */
export function gmViewEnabled() {
  if (!globalThis.game?.user?.isGM) return false;
  try { return game.settings.get(MODULE_ID, 'gmViewAdminTheme') !== false; } catch { return false; }
}

/**
 * The header-menu control for a GM-view window. Label reflects the current
 * state; only visible to the GM.
 * @returns {object} an ApplicationV2 header-control entry
 */
export function gmViewHeaderControl() {
  const on = gmViewEnabled();
  return {
    icon: on ? 'fa-solid fa-eye' : 'fa-solid fa-user-shield',
    label: on ? 'Switch to player view' : 'Switch to GM view',
    action: 'toggleGmView',
    visible: !!globalThis.game?.user?.isGM,
  };
}

/** Flip the setting and re-render every open window that offers the toggle. */
export async function toggleGmView() {
  if (!globalThis.game?.user?.isGM) return;
  const next = !gmViewEnabled();
  await game.settings.set(MODULE_ID, 'gmViewAdminTheme', next);
  const apps = [
    ...Object.values(foundry.applications?.instances ? Object.fromEntries(foundry.applications.instances) : {}),
    ...Object.values(ui.windows || {}),
  ];
  for (const app of apps) {
    if (app?.constructor?.GM_VIEW_TOGGLE && app.rendered) {
      try { app.render(); } catch { /* non-fatal */ }
    }
  }
  ui.notifications?.info(`NCM | ${next ? 'GM view — Messenger windows use the admin theme.' : 'Player view — Messenger windows use the player theme.'}`);
}

/**
 * Per-render hook for a GM_VIEW_TOGGLE window: stamp or clear the admin
 * theme on `el` according to the setting. Returns true when stamped.
 * @param {HTMLElement} el
 * @param {{applyZoom?: (pct:number)=>void}} [opts]
 */
export function applyGmView(el, opts = {}) {
  if (!el) return false;
  const on = gmViewEnabled();
  if (on) {
    const prefs = getAdminThemePrefs();
    stampAdminTheme(el, prefs);
    if (opts.applyZoom) opts.applyZoom(prefs.textScale);
    else applyAdminZoom(el.querySelector('.window-content'), prefs.textScale);
  } else {
    clearAdminTheme(el);
  }
  syncGmViewControls(el, on);
  return on;
}

/**
 * Keep the toggle affordances honest. AppV2 builds the window frame ONCE, so
 * the ⋮-menu entry's label never re-renders on its own; and a menu entry is
 * easy to miss, so a visible header button is injected too. Both are patched
 * here on every render/toggle.
 * @param {HTMLElement} el — the app root
 * @param {boolean} on — GM view active
 */
export function syncGmViewControls(el, on) {
  if (!el || !globalThis.game?.user?.isGM) return;
  const ctl = gmViewHeaderControl();
  // ⋮ menu entry (frame-built, label frozen at first render otherwise)
  for (const btn of el.querySelectorAll('.controls-dropdown [data-action="toggleGmView"], .header-control[data-action="toggleGmView"]')) {
    const i = btn.querySelector('i');
    if (i) i.className = ctl.icon;
    else if (btn.classList.contains('header-control')) btn.className = `header-control ${ctl.icon} ncm-gmview-btn`;
    const span = btn.querySelector('span');
    if (span) span.textContent = ctl.label;
    btn.dataset.tooltip = ctl.label;
  }
  // Visible header button (before the close control)
  const header = el.querySelector(':scope > .window-header');
  if (!header) return;
  let btn = header.querySelector('.ncm-gmview-btn');
  if (!btn) {
    btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.action = 'toggleGmView';
    const close = header.querySelector('[data-action="close"]');
    header.insertBefore(btn, close || null);
  }
  btn.className = `header-control ${ctl.icon} ncm-gmview-btn`;
  btn.dataset.tooltip = ctl.label;
  btn.dataset.gmview = on ? 'on' : 'off';
  btn.setAttribute('aria-label', ctl.label);
}

/**
 * Apply the text-size zoom to a window's content element.
 * @param {HTMLElement|null} contentEl — the `.window-content` node
 * @param {number} pct — 100–150
 */
export function applyAdminZoom(contentEl, pct) {
  if (!contentEl) return;
  const clamped = Math.min(ADMIN_TEXT_SCALE_MAX, Math.max(ADMIN_TEXT_SCALE_MIN, Number(pct) || 100));
  contentEl.style.zoom = clamped === 100 ? '' : String(clamped / 100);
}

// ═══════════════════════════════════════════════════════════
//  Foundry v1 Dialog wrappers
//  GM-tool code calls these instead of `new Dialog` / `Dialog.confirm` /
//  `Dialog.prompt` so the dialog is tagged for the admin theme.
// ═══════════════════════════════════════════════════════════

function _withAdminClass(options = {}) {
  const base = Array.isArray(options.classes) && options.classes.length ? options.classes : ['dialog'];
  const classes = base.includes(ADMIN_DIALOG_CLASS) ? base : [...base, ADMIN_DIALOG_CLASS];
  return { ...options, classes };
}

/** `new Dialog(data, options)` tagged for the admin theme. */
export function adminDialog(data, options = {}) {
  return new Dialog(data, _withAdminClass(options));
}

/** `Dialog.confirm(config)` tagged for the admin theme (config.options merged). */
export function adminConfirm(config = {}) {
  return Dialog.confirm({ ...config, options: _withAdminClass(config.options) });
}

/** `Dialog.prompt(config)` tagged for the admin theme (config.options merged). */
export function adminPrompt(config = {}) {
  return Dialog.prompt({ ...config, options: _withAdminClass(config.options) });
}

/** `Dialog.wait(data, options)` tagged for the admin theme. */
export function adminWait(data, options = {}) {
  return Dialog.wait(data, _withAdminClass(options));
}

// ═══════════════════════════════════════════════════════════
//  Player-window Dialog wrappers
//  A dialog opened by an immersive window keeps Foundry's own chrome (the
//  player palette is written to :root and a body-mounted Dialog does not read
//  it — by design, see the header) but MUST follow the player's Text Size, or
//  a 150% player reads a 100% confirm. Same zoom lever as the admin path.
// ═══════════════════════════════════════════════════════════

/**
 * The player's Theme Customizer Text Size as a percentage (80–150).
 * ThemeService.applyTheme publishes it on :root as --ncm-text-scale-base
 * (inline), which is the live value even mid-drag; the saved setting is the
 * fallback when nothing has been applied yet.
 * @returns {number}
 */
export function getPlayerTextScale() {
  let mult = NaN;
  try {
    mult = parseFloat(globalThis.document?.documentElement?.style?.getPropertyValue?.('--ncm-text-scale-base'));
  } catch { /* no DOM */ }
  if (!Number.isFinite(mult) || mult <= 0) {
    try {
      const prefs = game.settings.get(MODULE_ID, 'playerTheme') || {};
      mult = (Number(prefs.textScale) || 100) / 100;
    } catch { mult = 1; }
  }
  const pct = Math.round(mult * 100);
  return Math.min(PLAYER_TEXT_SCALE_MAX, Math.max(PLAYER_TEXT_SCALE_MIN, Number.isFinite(pct) ? pct : 100));
}

/**
 * Whether the element that currently has focus sits inside an admin-tagged
 * window — i.e. the dialog about to open was launched from a GM-view viewer
 * or a config sheet and should wear the admin theme rather than the player's.
 * @returns {boolean}
 */
export function openerIsAdminThemed() {
  try { return !!globalThis.document?.activeElement?.closest?.('[data-ncm-admin-theme]'); } catch { return false; }
}

function _withPlayerClass(options = {}) {
  const base = Array.isArray(options.classes) && options.classes.length ? options.classes : ['dialog'];
  if (base.includes(ADMIN_DIALOG_CLASS)) return { ...options, classes: base }; // caller already chose admin
  const tag = openerIsAdminThemed() ? ADMIN_DIALOG_CLASS : PLAYER_DIALOG_CLASS;
  const classes = base.includes(tag) ? base : [...base, tag];
  return { ...options, classes };
}

/** `new Dialog(data, options)` from a player-facing window — zoomed by the player's Text Size. */
export function playerDialog(data, options = {}) {
  return new Dialog(data, _withPlayerClass(options));
}

/** `Dialog.confirm(config)` from a player-facing window (config.options merged). */
export function playerConfirm(config = {}) {
  return Dialog.confirm({ ...config, options: _withPlayerClass(config.options) });
}

/** `Dialog.prompt(config)` from a player-facing window (config.options merged). */
export function playerPrompt(config = {}) {
  return Dialog.prompt({ ...config, options: _withPlayerClass(config.options) });
}

/** `Dialog.wait(data, options)` from a player-facing window. */
export function playerWait(data, options = {}) {
  return Dialog.wait(data, _withPlayerClass(options));
}

/**
 * Apply the player's text-size zoom to a dialog's content element.
 * @param {HTMLElement|null} contentEl — the `.window-content` node
 * @param {number} pct — 80–150
 */
export function applyPlayerZoom(contentEl, pct) {
  if (!contentEl) return;
  const clamped = Math.min(PLAYER_TEXT_SCALE_MAX, Math.max(PLAYER_TEXT_SCALE_MIN, Number(pct) || 100));
  contentEl.style.zoom = clamped === 100 ? '' : String(clamped / 100);
}

/**
 * Zoom a rendered player Dialog by the player's Text Size; the width grows by
 * the same ratio once per dialog (height is auto, so Foundry re-measures it
 * from the zoomed content on the setPosition call).
 * @param {Dialog} app
 */
export function scalePlayerDialog(app) {
  const el = app?.element?.[0] ?? app?.element;
  if (!(el instanceof HTMLElement)) return;
  const pct = getPlayerTextScale();
  applyPlayerZoom(el.querySelector('.window-content'), pct);
  if (pct !== 100 && !app._ncmPlayerScaled) {
    app._ncmPlayerScaled = true;
    const width = app.position?.width || el.offsetWidth;
    if (width) {
      try { app.setPosition({ width: Math.round(width * pct / 100) }); } catch { /* non-fatal */ }
    }
  }
}

/**
 * Stamp theme + zoom on a rendered admin Dialog. Width grows with the zoom
 * once per dialog (height is auto).
 * @param {Dialog} app
 */
export function themeAdminDialog(app) {
  const el = app?.element?.[0] ?? app?.element;
  if (!(el instanceof HTMLElement)) return;
  const prefs = getAdminThemePrefs();
  stampAdminTheme(el, prefs);
  applyAdminZoom(el.querySelector('.window-content'), prefs.textScale);
  if (prefs.textScale !== 100 && !app._ncmAdminScaled) {
    app._ncmAdminScaled = true;
    const width = app.position?.width || el.offsetWidth;
    if (width) {
      try { app.setPosition({ width: Math.round(width * prefs.textScale / 100) }); } catch { /* non-fatal */ }
    }
  }
}

/**
 * Register the `renderDialog` hook that themes admin-tagged dialogs and zooms
 * player-tagged ones. Call once at ready (every client — players open their
 * own dialogs).
 */
export function registerAdminDialogHook() {
  Hooks.on('renderDialog', (app) => {
    try {
      const classes = app?.options?.classes;
      if (classes?.includes?.(ADMIN_DIALOG_CLASS)) themeAdminDialog(app);
      else if (classes?.includes?.(PLAYER_DIALOG_CLASS)) scalePlayerDialog(app);
    } catch (err) {
      log.debug(`adminTheme: renderDialog stamp skipped — ${err?.message || err}`);
    }
  });
}

// ═══════════════════════════════════════════════════════════
//  Themed small dialogs (2026-10-29) — the `ncm-themed-dialog` look (styles/components/ncm-dialog.css)
//  with a dialogBodyHtml() body. A GM gets the admin preset, a player their own theme.
// ═══════════════════════════════════════════════════════════

const THEMED = ['dialog', 'ncm-themed-dialog'];

/**
 * A two-button confirm. Resolves true only on the action button; closing = false.
 * @param {{title:string, content:string, yes?:string, yesIcon?:string, no?:string, bad?:boolean, width?:number}} o
 */
export function themedConfirm(o = {}) {
  const gm = !!globalThis.game?.user?.isGM;
  const make = gm ? adminDialog : playerDialog;
  return new Promise((resolve) => {
    let ok = false;
    make({
      title: o.title, content: o.content,
      buttons: {
        no: { icon: '<i class="fas fa-xmark"></i>', label: o.no || 'Cancel' },
        yes: { icon: `<i class="${o.yesIcon || 'fas fa-check'}"></i>`, label: o.yes || 'Confirm', callback: () => { ok = true; } },
      },
      default: 'yes',
      close: () => resolve(ok),
    }, { width: o.width || 440, classes: [...THEMED, 'ncm-dlg-confirm', ...(o.bad ? ['ncm-dlg-bad'] : [])] }).render(true);
  });
}

/**
 * A one-field prompt. `read(root)` returns the value; resolves null on cancel.
 * @param {{title:string, content:string, label?:string, icon?:string, read:(root:HTMLElement)=>any, width?:number}} o
 */
export function themedPrompt(o = {}) {
  const gm = !!globalThis.game?.user?.isGM;
  const make = gm ? adminDialog : playerDialog;
  return new Promise((resolve) => {
    let val = null;
    make({
      title: o.title, content: o.content,
      buttons: {
        no: { icon: '<i class="fas fa-xmark"></i>', label: 'Cancel' },
        yes: { icon: `<i class="${o.icon || 'fas fa-check'}"></i>`, label: o.label || 'Save', callback: (html) => { val = o.read?.(html[0] ?? html) ?? null; } },
      },
      default: 'yes',
      render: (html) => {
        const root = html[0] ?? html;
        const input = root.querySelector('input[type=text]');
        if (input) { input.focus(); input.select(); }
      },
      close: () => resolve(val),
    }, { width: o.width || 420, classes: THEMED }).render(true);
  });
}
