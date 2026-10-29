/**
 * A visible MINIMIZE button on every NCM window (2026-10-29, dev: "the admin panel needs a minimize option
 * along with all the popups … stylize it cyberpunk-like but mostly it needs to be clear").
 * @file scripts/utils/windowMinimize.js
 *
 * Most NCM windows could already minimize — by double-clicking the title bar, which nobody knew. This puts
 * a button beside the ✕ (– to minimize, the restore glyph when rolled up) on:
 *   - every ApplicationV2 window carrying `ncm-app` with `window.minimizable` on (ONE global
 *     `renderApplicationV2` hook — Foundry fires `render<Class>` for every class in the chain), and
 *   - the bigger v1 Dialogs (Post to chat, the name picker, the Role Manager, the time settings, themed
 *     prompts) via `renderDialog`. Small yes/no confirms (`ncm-dlg-confirm`) are skipped on purpose.
 * Windows that must NOT roll up mid-flow keep `minimizable: false` (network login, dead-zone warning,
 * email setup) and get no button. The glyph follows the window's state through a MutationObserver on the
 * frame's `minimized` class, so a title-bar double-click keeps it honest too.
 */

const BTN = 'ncm-minbtn';
const DIALOG_CLASSES = ['ncm-themed-dialog', 'ncm-pkr-dialog', 'ncm-rmgr-dialog', 'ncm-time-config-dialog', 'ncm-ap-dialog'];

/** Pure: should this window get the button? */
export function wantsMinimize({ classes = [], minimizable = true, v1 = false }) {
  const has = (c) => classes.includes(c);
  if (minimizable === false) return false;
  if (v1) return DIALOG_CLASSES.some(has) && !has('ncm-dlg-confirm');
  return has('ncm-app');
}

/** Pure: the button's face for a state. */
export function minimizeFace(minimized) {
  return minimized
    ? { icon: 'fa-window-restore', label: 'Restore' }
    : { icon: 'fa-minus', label: 'Minimize — roll it up to its title bar' };
}

function paint(btn, minimized) {
  const f = minimizeFace(minimized);
  btn.innerHTML = `<i class="fas ${f.icon}" aria-hidden="true"></i>`;
  btn.dataset.tooltip = f.label;
  btn.setAttribute('aria-label', f.label);
  btn.setAttribute('aria-pressed', String(!!minimized));
}

/**
 * Put the button in a window's header (idempotent).
 * @param {HTMLElement} frame — the window element
 * @param {{isMin:()=>boolean, toggle:()=>any, closeSel:string, tag:string, v1:boolean}} o
 */
function attach(frame, o) {
  const header = frame?.querySelector(':scope > .window-header');
  if (!header || header.querySelector(`.${BTN}`)) return;
  const btn = document.createElement(o.tag);
  btn.className = o.v1 ? `header-button control ${BTN}` : `header-control ${BTN}`;
  if (o.tag === 'button') btn.type = 'button';
  btn.dataset.ncmMin = '1';
  paint(btn, o.isMin());
  btn.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); o.toggle(); });
  // A double-click on the button must not ALSO hit the title bar's own double-click toggle.
  btn.addEventListener('dblclick', (ev) => { ev.preventDefault(); ev.stopPropagation(); });
  const close = header.querySelector(o.closeSel);
  header.insertBefore(btn, close || null);
  try {
    new MutationObserver(() => paint(btn, frame.classList.contains('minimized') || frame.classList.contains('minimizing')))
      .observe(frame, { attributes: true, attributeFilter: ['class'] });
  } catch { /* no observer — the click still repaints */ }
}

/** Register the two hooks. Call at init. */
export function registerMinimizeControls() {
  Hooks.on('renderApplicationV2', (app) => {
    try {
      const frame = app?.element;
      if (!frame || !app.hasFrame) return;
      if (!wantsMinimize({ classes: [...frame.classList], minimizable: app.options?.window?.minimizable })) return;
      attach(frame, { tag: 'button', v1: false, closeSel: '[data-action="close"]', isMin: () => !!app.minimized,
        toggle: () => (app.minimized ? app.maximize() : app.minimize()) });
    } catch (err) { console.warn('NCM | minimize button', err); }
  });
  Hooks.on('renderDialog', (app, html) => {
    try {
      const frame = (html?.[0] ?? html)?.closest?.('.app') ?? app?.element?.[0];
      if (!frame) return;
      if (!wantsMinimize({ classes: [...frame.classList], minimizable: app.options?.minimizable, v1: true })) return;
      attach(frame, { tag: 'a', v1: true, closeSel: '.header-button.close', isMin: () => !!app._minimized,
        toggle: () => (app._minimized ? app.maximize() : app.minimize()) });
    } catch (err) { console.warn('NCM | minimize button', err); }
  });
}
