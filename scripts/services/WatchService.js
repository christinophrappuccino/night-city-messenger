/**
 * WatchService — the rest of the table watches one player work a terminal, a shard or a network node.
 * @file scripts/services/WatchService.js
 * @module night-city-messenger
 *
 * A player's window (static WATCHABLE = true) gets an eye button. Turning it on offers the session to everyone else: a
 * small chip names who is on what, with a Watch button. Watchers get a read-only copy (utils/watchMirror.js). A joiner
 * gets the whole picture, then only numbered edits to it, up to ten a second and slower when a lot is changing. A
 * watcher that misses a number asks for the whole picture again. Nothing is sent while nobody is watching.
 *
 * World setting `watchMode`: 'player' (the operator chooses, default) · 'always' (every session is offered) · 'off'.
 * A GM's own windows are never shared: they show hidden accounts, GM controls and unsolved locks.
 * Everything rides SOCKET_OPS.WATCH, addressed by shareId; the service is told by the socket who is watching.
 */

import { MODULE_ID, SOCKET_OPS } from '../utils/constants.js';
import { log, isGM, resolveOperator, getSetting } from '../utils/helpers.js';
import { snapshotWindow, diffText, applyText } from '../utils/watchMirror.js';

const BTN = 'ncm-watchbtn';
/** The fastest it sends. A burst of changes in one frame still goes out as one edit. */
const SEND_EVERY_MS = 100;
/** After an edit too big to send, wait this long before trying again (audit PERF-04: it retried every 30 ms). */
export const TOO_BIG_BACKOFF_MS = 2000;
const BATCH_MS = 30;
/** Slower when the edits are big, so a busy window cannot flood the server (every client receives every message). */
const BYTES_PER_MS = 200;
/** Copying the window may take at most about a tenth of the operator's time. */
const SNAPSHOT_SHARE = 10;
const RESYNC_EVERY_MS = 1500;
/** A picture past this goes unsent (huge inline images): the socket is not for that, and the watcher is told. */
export const MAX_PICTURE = 900000;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Did these DOM changes all happen inside a `[data-watch-ignore]` element? Then they are decoration (an animation
 * that redraws itself) and are not worth a send by themselves — they ride along with the next real change.
 * @param {MutationRecord[]} muts
 */
export function watchIgnoredOnly(muts = []) {
  if (!muts.length) return false;
  return muts.every((m) => {
    const el = m.target?.nodeType === 1 ? m.target : m.target?.parentElement;
    return !!el?.closest?.('[data-watch-ignore]');
  });
}

export class WatchService {
  constructor({ socket = null, snapshot = snapshotWindow } = {}) {
    this.socket = socket || game.nightcity?.socketManager;
    this._snapshot = snapshot;
    this.shares = new Map();      // appId → { app, shareId, watchers:Set<userId>, last, timer, observer }
    this.offers = new Map();      // shareId → { shareId, userId, who, what, kind }
    this.watching = new Map();    // shareId → the watcher's window
    this.received = new Map();    // shareId → { seq, html, meta } as this watcher has it
    this._asked = new Map();      // shareId → when this watcher last asked for the whole picture
    this._openWindow = null;      // set by the init file (keeps this service free of UI imports)
  }

  /** @returns {'player'|'always'|'off'} */
  mode() {
    return getSetting('watchMode', 'player') || 'player';
  }

  canShare(app) {
    return !!app?.constructor?.WATCHABLE && !isGM() && this.mode() !== 'off';
  }

  // ─── the operator's side ───

  /** Called for every window render. */
  onRender(app) {
    if (!this.canShare(app)) return;
    this._attachButton(app);
    if (this.mode() === 'always' && !this.shares.has(app.id)) this.startShare(app);
    this._paintButton(app);
    this._schedule(app.id);
  }

  startShare(app) {
    if (!this.canShare(app) || this.shares.has(app.id)) return null;
    const rec = { app, shareId: `${game.user.id}:${app.id}`, watchers: new Set(), seq: 0, html: null, meta: null, nextAt: 0, timer: null, observer: null, listening: null };
    this.shares.set(app.id, rec);
    this.socket?.emit(SOCKET_OPS.WATCH, { type: 'offer', ...this._offer(rec) });
    this._paintButton(app);
    return rec;
  }

  stopShare(app, { closing = false } = {}) {
    const rec = this.shares.get(app?.id);
    if (!rec) return;
    clearTimeout(rec.timer);
    rec.observer?.disconnect?.();
    rec.listening?.abort();
    this.shares.delete(app.id);
    this.socket?.emit(SOCKET_OPS.WATCH, { type: 'end', shareId: rec.shareId });
    if (!closing) this._paintButton(app);
  }

  _offer(rec) {
    const app = rec.app;
    return {
      shareId: rec.shareId, userId: game.user.id,
      who: resolveOperator()?.name || game.user.name,
      what: app.item?.name || app.title || 'a machine',
    };
  }

  _attachButton(app) {
    const header = app.element?.querySelector(':scope > .window-header');
    if (!header || header.querySelector(`.${BTN}`)) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `header-control ${BTN}`;
    btn.addEventListener('click', (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      if (this.mode() === 'always') return;
      if (this.shares.has(app.id)) this.stopShare(app); else this.startShare(app);
    });
    const close = header.querySelector('[data-action="close"]');
    header.insertBefore(btn, close || null);
  }

  _paintButton(app) {
    const btn = app.element?.querySelector?.(`:scope > .window-header .${BTN}`);
    if (!btn) return;
    const rec = this.shares.get(app.id);
    const n = rec?.watchers.size || 0;
    btn.classList.toggle('is-on', !!rec);
    btn.innerHTML = `<i class="fas ${rec ? 'fa-eye' : 'fa-eye-slash'}" aria-hidden="true"></i>${n ? `<span>${n}</span>` : ''}`;
    const tip = !rec ? 'Let the table watch this'
      : this.mode() === 'always' ? `The table can watch this${n ? ` — ${n} watching` : ''} (set by the GM)`
        : n ? `${n} watching. Click to stop sharing` : 'The table can watch this. Click to stop sharing';
    btn.dataset.tooltip = tip;
    btn.setAttribute('aria-label', tip);
    btn.setAttribute('aria-pressed', String(!!rec));
  }

  /** Watchers came or went: only watch the window's DOM while someone is looking. */
  _syncObserver(rec) {
    if (rec.watchers.size && !rec.observer && typeof MutationObserver !== 'undefined' && rec.app.element) {
      // A change inside [data-watch-ignore] (a purely decorative animation, like the node console's traffic wave
      // redrawn every 70 ms) does not trigger a send on its own — it used to re-send the window ~10×/s (PERF-04).
      rec.observer = new MutationObserver((muts) => { if (!watchIgnoredOnly(muts)) this._schedule(rec.app.id); });
      rec.observer.observe(rec.app.element, { subtree: true, childList: true, attributes: true, characterData: true });
      // Scrolling, typing and picking change what is on screen without changing the DOM, so the observer never hears them.
      rec.listening = new AbortController();
      const changed = () => this._schedule(rec.app.id);
      for (const type of ['scroll', 'input', 'change']) {
        rec.app.element.addEventListener(type, changed, { capture: true, passive: true, signal: rec.listening.signal });
      }
    } else if (!rec.watchers.size && rec.observer) {
      rec.observer.disconnect();
      rec.observer = null;
      rec.listening?.abort();
      rec.listening = null;
    }
  }

  _schedule(appId) {
    const rec = this.shares.get(appId);
    if (!rec || !rec.watchers.size || rec.timer) return;
    const wait = Math.max(BATCH_MS, rec.nextAt - Date.now());
    rec.timer = setTimeout(() => { rec.timer = null; this._send(rec); }, wait);
  }

  /**
   * Copy the window and bring the watchers up to date.
   * @param {object} rec the share
   * @param {object} [opts]
   * @param {string} [opts.to] a watcher who needs the whole picture (they just joined, or missed an edit)
   */
  _send(rec, { to = null } = {}) {
    if (!rec.watchers.size || !rec.app.element) return;
    const began = Date.now();
    let snap = null;
    try { snap = this._snapshot(rec.app.element); } catch (err) { log.debug(`Watch: snapshot failed: ${err.message}`); }
    if (!snap) return;
    const { html: rawHtml, ...rest } = snap;
    const html = String(rawHtml ?? '');
    const meta = JSON.stringify(rest);
    let bytes = 0;

    if (html !== rec.html || meta !== rec.meta) {
      const others = [...rec.watchers].filter((u) => u !== to);
      if (others.length && rec.html !== null) {
        const edit = html === rec.html ? null : diffText(rec.html, html);
        const body = { edit, meta: meta === rec.meta ? null : rest };
        const size = (edit?.[2].length || 0) + (body.meta ? meta.length : 0);
        if (size > MAX_PICTURE) {
          // Their copy stays where it was, and the next edit is measured from there. Back off before trying again:
          // returning without a next time let it retry every 30 ms with a snapshot near 900 KB (PERF-04).
          this.socket?.emit(SOCKET_OPS.WATCH, { type: 'tooBig', shareId: rec.shareId, userIds: others });
          rec.nextAt = Date.now() + TOO_BIG_BACKOFF_MS;
          if (!to) return;
        } else {
          rec.seq += 1; rec.html = html; rec.meta = meta; bytes += size;
          this.socket?.emit(SOCKET_OPS.WATCH, { type: 'edit', shareId: rec.shareId, userIds: others, seq: rec.seq, ...body });
        }
      } else {
        rec.seq += 1; rec.html = html; rec.meta = meta;
      }
    }

    if (to) {
      const size = rec.html.length + rec.meta.length;
      if (size > MAX_PICTURE) this.socket?.emit(SOCKET_OPS.WATCH, { type: 'tooBig', shareId: rec.shareId, userIds: [to] });
      else {
        bytes += size;
        this.socket?.emit(SOCKET_OPS.WATCH, { type: 'snap', shareId: rec.shareId, userIds: [to], seq: rec.seq, snap: { html: rec.html, ...JSON.parse(rec.meta) } });
      }
    }

    const now = Date.now();
    rec.nextAt = now + Math.max(SEND_EVERY_MS, bytes / BYTES_PER_MS, (now - began) * SNAPSHOT_SHARE);
  }

  // ─── the watcher's side ───

  watch(shareId) {
    const offer = this.offers.get(shareId);
    if (!offer) return;
    let win = this.watching.get(shareId);
    if (!win) {
      win = this._openWindow?.(offer);
      if (win) this.watching.set(shareId, win);
    }
    this.socket?.emit(SOCKET_OPS.WATCH, { type: 'join', shareId, userId: game.user.id });
    this._removeChip(shareId);
  }

  /** The watcher closed the copy. */
  stopWatching(shareId) {
    if (!this.watching.has(shareId)) return;
    this.watching.delete(shareId);
    this.received.delete(shareId);
    this.socket?.emit(SOCKET_OPS.WATCH, { type: 'leave', shareId, userId: game.user.id });
    if (this.offers.has(shareId)) this._showChip(this.offers.get(shareId));
  }

  dismiss(shareId) {
    this.offers.get(shareId) && (this.offers.get(shareId).dismissed = true);
    this._removeChip(shareId);
  }

  _showChip(offer) {
    if (typeof document === 'undefined' || offer.dismissed || this.watching.has(offer.shareId)) return;
    let dock = document.getElementById('ncm-watch-dock');
    if (!dock) { dock = document.createElement('div'); dock.id = 'ncm-watch-dock'; document.body.appendChild(dock); }
    if (dock.querySelector(`[data-share="${CSS.escape(offer.shareId)}"]`)) return;
    const chip = document.createElement('div');
    chip.className = 'ncm-watch-chip';
    chip.dataset.share = offer.shareId;
    chip.innerHTML = `<i class="fas fa-eye" aria-hidden="true"></i><span><b>${esc(offer.who)}</b> is on <b>${esc(offer.what)}</b></span>
      <button type="button" data-w="go">Watch</button><button type="button" data-w="no" aria-label="Dismiss" data-tooltip="Dismiss"><i class="fas fa-xmark"></i></button>`;
    chip.addEventListener('click', (ev) => {
      const w = ev.target.closest('[data-w]')?.dataset.w;
      if (w === 'go') this.watch(offer.shareId);
      else if (w === 'no') this.dismiss(offer.shareId);
    });
    dock.appendChild(chip);
  }

  _removeChip(shareId) {
    if (typeof document === 'undefined') return;
    const dock = document.getElementById('ncm-watch-dock');
    dock?.querySelector(`[data-share="${CSS.escape(shareId)}"]`)?.remove();
    if (dock && !dock.childElementCount) dock.remove();
  }

  // ─── the wire ───

  /**
   * @param {object} data
   * @param {string|null} [senderId] - server-verified sender (SocketManager).
   *
   * Who may send what (audit SEC-09): a share id is "<operator's user id>:<app id>", so an offer, a picture, an
   * edit, a too-big note and the end of a share are only taken from that operator; join / leave / resync / ask are
   * only taken for the user who sent them. Anything else is dropped. A picture is still cleaned on mount.
   */
  onSocket(data = {}, senderId = null) {
    const me = game.user.id;
    if (!data || typeof data !== 'object' || !senderId) return;
    const owns = () => typeof data.shareId === 'string' && data.shareId.startsWith(`${senderId}:`);
    const self = () => data.userId === senderId;
    if (['offer', 'end', 'snap', 'edit', 'tooBig'].includes(data.type) && !owns()) return;
    if (['offer', 'join', 'leave', 'resync', 'ask'].includes(data.type) && !self()) return;
    switch (data.type) {
      case 'offer': {
        if (data.userId === me) return;
        if (data.to && data.to !== me) return;
        const known = this.offers.get(data.shareId);
        const offer = { shareId: data.shareId, userId: data.userId, who: data.who, what: data.what, dismissed: !!known?.dismissed };
        this.offers.set(data.shareId, offer);
        this._showChip(offer);
        return;
      }
      case 'end': {
        this.offers.delete(data.shareId);
        this._removeChip(data.shareId);
        const win = this.watching.get(data.shareId);
        this.received.delete(data.shareId);
        if (win) { this.watching.delete(data.shareId); win.ended?.(); }
        return;
      }
      case 'join': case 'leave': {
        for (const rec of this.shares.values()) {
          if (rec.shareId !== data.shareId) continue;
          if (data.type === 'join') rec.watchers.add(data.userId); else rec.watchers.delete(data.userId);
          this._syncObserver(rec);
          this._paintButton(rec.app);
          if (data.type === 'join') this._send(rec, { to: data.userId });
        }
        return;
      }
      case 'resync': {
        for (const rec of this.shares.values()) {
          if (rec.shareId === data.shareId && rec.watchers.has(data.userId)) this._send(rec, { to: data.userId });
        }
        return;
      }
      case 'snap': {
        if (!(data.userIds || []).includes(me) || !this.watching.has(data.shareId)) return;
        const { html, ...meta } = data.snap;
        const got = { seq: data.seq, html: String(html ?? ''), meta };
        const had = this.received.get(data.shareId);
        // An edit can overtake the whole picture it follows; never go backwards.
        if (had && had.seq > got.seq) return;
        this.received.set(data.shareId, got);
        this.watching.get(data.shareId).update?.({ html: got.html, ...got.meta });
        return;
      }
      case 'edit': {
        if (!(data.userIds || []).includes(me) || !this.watching.has(data.shareId)) return;
        const got = this.received.get(data.shareId);
        if (got && data.seq <= got.seq) return;
        if (!got || data.seq !== got.seq + 1) { this._askForWhole(data.shareId); return; }
        if (data.edit) got.html = applyText(got.html, data.edit);
        if (data.meta) got.meta = data.meta;
        got.seq = data.seq;
        this.watching.get(data.shareId).update?.({ html: got.html, ...got.meta });
        return;
      }
      case 'tooBig': {
        if (!(data.userIds || []).includes(me)) return;
        this.watching.get(data.shareId)?.tooBig?.();
        return;
      }
      case 'ask': {
        // someone just loaded: tell them what is on offer
        for (const rec of this.shares.values()) {
          this.socket?.emit(SOCKET_OPS.WATCH, { type: 'offer', to: data.userId, ...this._offer(rec) });
        }
        return;
      }
      default:
    }
  }

  /** This copy missed an edit. Asking is throttled, because every edit until the answer arrives would ask again. */
  _askForWhole(shareId) {
    const now = Date.now();
    if (now - (this._asked.get(shareId) || 0) < RESYNC_EVERY_MS) return;
    this._asked.set(shareId, now);
    this.socket?.emit(SOCKET_OPS.WATCH, { type: 'resync', shareId, userId: game.user.id });
  }

  /** A user dropped: a watcher is gone, and so is whatever they were offering. */
  onUserGone(userId) {
    for (const rec of this.shares.values()) {
      if (rec.watchers.delete(userId)) { this._syncObserver(rec); this._paintButton(rec.app); }
    }
    for (const offer of [...this.offers.values()]) {
      if (offer.userId === userId) this.onSocket({ type: 'end', shareId: offer.shareId }, userId);
    }
  }

  /** On load: ask what is on offer. */
  hello() {
    this.socket?.emit(SOCKET_OPS.WATCH, { type: 'ask', userId: game.user.id });
  }
}
