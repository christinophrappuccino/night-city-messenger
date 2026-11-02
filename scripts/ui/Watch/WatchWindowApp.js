/**
 * The watcher's window: a read-only copy of what another player has on their screen.
 * @file scripts/ui/Watch/WatchWindowApp.js
 * @module night-city-messenger
 */

import { TEMPLATES } from '../../utils/constants.js';
import { BaseApplication } from '../BaseApplication.js';
import { mountMirror, refit } from '../../utils/watchMirror.js';

/** The sizes the watcher can step through. */
const ZOOMS = [0.75, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2];
const ZOOM_KEY = 'ncm.watch.zoom';

export class WatchWindowApp extends BaseApplication {
  static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
    classes: ['ncm-app', 'ncm-watch-window'],
    window: { icon: 'fas fa-eye', resizable: true, minimizable: true },
    position: { width: 760, height: 520 },
  }, { inplace: false });

  static PARTS = { main: { template: TEMPLATES.WATCH_WINDOW } };

  constructor(offer, options = {}) {
    super({ ...options, id: `ncm-watch-${String(offer.shareId).replace(/[^a-zA-Z0-9_-]/g, '-')}` });
    this.offer = offer;
    this._snap = null;
    this._autoSize = null;     // what this window last sized itself to; once the watcher resizes it, it stays theirs
    this._zoom = WatchWindowApp._readZoom();
  }

  /** One viewer's preference, so it can come back empty: null = fit the width. */
  static _readZoom() {
    try {
      const v = Number(localStorage.getItem(ZOOM_KEY));
      return ZOOMS.includes(v) ? v : null;
    } catch { return null; }
  }

  get title() { return `Watching ${this.offer.who}`; }

  async _prepareContext() {
    return { who: this.offer.who, what: this.offer.what };
  }

  _fit() { return this.element?.querySelector('[data-watch-fit]'); }

  _onRender(context, options) {
    super._onRender(context, options);
    const fit = this._fit();
    if (!fit) return;
    if (this._zoom) fit.dataset.watchZoom = String(this._zoom);
    this.element.querySelector('.ncm-watch__zoom')?.addEventListener('click', (ev) => {
      const pick = ev.target.closest('[data-watch-zoom]')?.dataset.watchZoom;
      if (pick) this._setZoom(pick);
    });
    this._paintZoom();
    if (this._snap) mountMirror(fit, this._snap);
    if (!this._ro && typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => { refit(this._fit(), this._snap); this._paintZoom(); });
      this._ro.observe(fit);
    }
  }

  /** @param {'fit'|'in'|'out'} pick */
  _setZoom(pick) {
    const fit = this._fit();
    if (!fit) return;
    const now = this._zoom ?? (Number(fit.dataset.watchScale) || 1);
    if (pick === 'fit') this._zoom = null;
    else if (pick === 'in') this._zoom = ZOOMS.find((z) => z > now + 0.001) ?? now;
    else this._zoom = [...ZOOMS].reverse().find((z) => z < now - 0.001) ?? now;
    if (this._zoom) fit.dataset.watchZoom = String(this._zoom); else delete fit.dataset.watchZoom;
    try {
      if (this._zoom) localStorage.setItem(ZOOM_KEY, String(this._zoom)); else localStorage.removeItem(ZOOM_KEY);
    } catch { /* it just won't be remembered */ }
    refit(fit, this._snap);
    this._paintZoom();
  }

  _paintZoom() {
    const label = this.element?.querySelector('[data-watch-zoom="fit"]');
    if (!label) return;
    const fit = this._fit();
    const scale = this._zoom ?? (Number(fit?.dataset.watchScale) || 1);
    label.textContent = `${Math.round(scale * 100)}%`;
    label.classList.toggle('is-set', !!this._zoom);
    label.dataset.tooltip = this._zoom ? 'Your size. Click to fit the window again' : 'Fitting the window';
  }

  /** Open at the operator's size where it fits: the frame and the read-only bar are measured, not guessed. */
  _sizeToSnap(snap, fit) {
    const el = this.element;
    const auto = this._autoSize;
    if (auto && (el.offsetWidth !== auto.w || el.offsetHeight !== auto.h)) return;   // the watcher resized it
    if (auto && auto.snapW === snap.w && auto.snapH === snap.h) return;
    const frameW = el.offsetWidth - fit.clientWidth, frameH = el.offsetHeight - fit.clientHeight;
    const w = Math.round(Math.min(snap.w + frameW, Math.max(420, window.innerWidth * 0.9)));
    const h = Math.round(Math.min(snap.h + frameH, Math.max(320, window.innerHeight * 0.9)));
    this.setPosition({ width: w, height: h });
    this._autoSize = { w: el.offsetWidth, h: el.offsetHeight, snapW: snap.w, snapH: snap.h };
  }

  /** A new picture. */
  update(snap) {
    this._snap = snap;
    const fit = this._fit();
    if (!fit) return;
    this._sizeToSnap(snap, fit);
    mountMirror(fit, snap);
    this._paintZoom();
    this._say('');
  }

  _say(text) {
    const el = this.element?.querySelector('[data-watch-note]');
    if (!el) return;
    el.textContent = text;
    el.hidden = !text;
  }

  tooBig() { this._say('Their screen has too much on it to send right now. It picks up when that changes.'); }

  /** The operator stopped sharing or closed the window. */
  ended() {
    this._ended = true;
    this._say(`${this.offer.who} has stopped sharing.`);
    setTimeout(() => { if (this.rendered) this.close(); }, 4000);
  }

  async close(options) {
    this._ro?.disconnect();
    if (!this._ended) game.nightcity?.watchService?.stopWatching(this.offer.shareId);
    return super.close(options);
  }
}
