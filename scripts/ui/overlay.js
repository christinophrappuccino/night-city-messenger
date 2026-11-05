/**
 * mountOverlay — the shared base for NCM's framework-free modals (R17, after stage 2).
 * @file scripts/ui/overlay.js
 * @module night-city-messenger
 *
 * Several immersive prompts (the operator handoff, the resident console, the roll panel, the net adjudicator, the
 * conversation starter…) are plain DOM overlays rather than Foundry windows, so they can sit inside a themed viewer
 * and animate freely. Each one wrote the same frame by hand: a backdrop element in the host (or <body>), an Escape
 * listener on the document, a backdrop click, a cleanup that removes both, a reduced-motion check. This is that frame,
 * once. New overlays use it; the older ones move over when they are next edited (OperatorSelect has).
 *
 *   const o = mountOverlay({ host, className: 'ncm-x-backdrop', html: '<div class="ncm-x">…</div>',
 *                            onClose: (value) => resolve(value) });
 *   o.root          the backdrop element (its innerHTML is `html`)
 *   o.close(value)  removes it and its listeners, then calls onClose(value) — once, whatever closes it
 *   o.motion        false when the player asked for reduced motion (skip the animation beats)
 *
 * Escape and a click on the backdrop itself close it with `null` by default; pass `onEsc` / `onBackdrop` as a function
 * `(event, close)` to do something else, or `false` to ignore them.
 */

/** Does the player want reduced motion? */
export function prefersReducedMotion() {
  try { return !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches; } catch { return false; }
}

/**
 * @param {object} o
 * @param {HTMLElement} [o.host]   where to mount (a themed viewer element, so the overlay inherits its preset); <body> by default
 * @param {string} [o.className]   the backdrop's class
 * @param {string} [o.html]        the overlay's markup (inside the backdrop) — escape what a player typed
 * @param {((value:any)=>void)} [o.onClose]
 * @param {'close'|false|((e:Event, close:Function)=>void)} [o.onEsc='close']
 * @param {'close'|false|((e:Event, close:Function)=>void)} [o.onBackdrop='close']
 * @returns {{ root: HTMLElement, close: (value?: any) => void, motion: boolean, readonly closed: boolean }}
 */
export function mountOverlay({ host = null, className = '', html = '', onClose = null, onEsc = 'close', onBackdrop = 'close' } = {}) {
  const mount = host || globalThis.document.body;
  const root = globalThis.document.createElement('div');
  if (className) root.className = className;
  root.innerHTML = html;
  let closed = false;
  const onKey = (e) => {
    if (closed || e.key !== 'Escape' || !onEsc) return;
    e.preventDefault();
    if (typeof onEsc === 'function') onEsc(e, close); else close(null);
  };
  const close = (value = null) => {
    if (closed) return;
    closed = true;
    globalThis.document.removeEventListener('keydown', onKey, true);
    root.remove();
    try { onClose?.(value); } catch (err) { console.error('NCM | overlay onClose failed', err); }
  };
  root.addEventListener('click', (e) => {
    if (closed || e.target !== root || !onBackdrop) return;            // only the backdrop itself, not the panel
    if (typeof onBackdrop === 'function') onBackdrop(e, close); else close(null);
  });
  globalThis.document.addEventListener('keydown', onKey, true);
  mount.appendChild(root);
  return { root, close, motion: !prefersReducedMotion(), get closed() { return closed; } };
}
