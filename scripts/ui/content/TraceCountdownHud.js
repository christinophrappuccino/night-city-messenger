/**
 * TraceCountdownHud — the player-facing "a trace is closing in" indicator.
 * @file scripts/ui/content/TraceCountdownHud.js
 * @module night-city-messenger
 * @description A GM-started trace countdown (TraceService) used to be invisible
 *   to the player except a one-off whisper they had to opt into — "I did
 *   countdown and I don't see anything on the player side." This is a persistent
 *   floating HUD: whenever an active countdown targets an actor THIS user owns,
 *   a red panel sits bottom-right showing WHO is closing in, on WHAT, and a live
 *   MM:SS remaining. It ticks on the game clock (the same basis the GM reaper
 *   fires on, so the two never disagree) and clears itself when the countdown
 *   ends or is called off.
 *
 *   Every client runs one; it filters to the viewer's own actors, so a GM
 *   normally sees nothing (they own the Security tab) unless they own the
 *   targeted PC. Reads the GM-owned `traceCountdowns` world setting (world-scope
 *   settings are readable by everyone) — no socket needed.
 */

import { MODULE_ID } from '../../utils/constants.js';
import { log } from '../../utils/helpers.js';

const esc = (s) => Handlebars.escapeExpression(String(s ?? ''));

export class TraceCountdownHud {
  constructor() {
    this._el = null;
    this._tick = null;
    this._seen = new Set();   // countdown ids already shown (for the entrance flash)
  }

  init() {
    // Rebuild when the countdown list changes (start / call-off / expiry all
    // write the setting — fires on every client incl. the writer).
    this._hook = (setting) => {
      if (setting?.key === `${MODULE_ID}.traceCountdowns`) this.refresh();
    };
    Hooks.on('updateSetting', this._hook);
    this.refresh();
    log.debug('TraceCountdownHud ready');
  }

  destroy() {
    if (this._hook) Hooks.off('updateSetting', this._hook);
    if (this._tick) { clearInterval(this._tick); this._tick = null; }
    this._el?.remove(); this._el = null;
  }

  _nowMs() {
    try { return game.nightcity?.timeService?.getCurrentTimeMs?.() ?? Date.now(); } catch { return Date.now(); }
  }

  /** Countdowns targeting an actor this user owns, still ticking. */
  _relevant() {
    let list = [];
    try { list = game.settings.get(MODULE_ID, 'traceCountdowns') || []; } catch { return []; }
    const now = this._nowMs();
    return list.filter(c => {
      if (!c?.actorId || (c.expiresAt || 0) <= now) return false;
      const a = game.actors?.get(c.actorId);
      return !!a?.isOwner;
    });
  }

  _fmt(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  refresh() {
    const rows = this._relevant();
    if (!rows.length) {
      if (this._tick) { clearInterval(this._tick); this._tick = null; }
      this._el?.remove(); this._el = null;
      this._seen.clear();
      return;
    }
    if (!this._el) {
      this._el = document.createElement('div');
      this._el.id = 'ncm-trace-hud';
      document.body.appendChild(this._el);
    }
    const now = this._nowMs();
    this._el.innerHTML = rows.map(c => {
      const fresh = !this._seen.has(c.id);
      this._seen.add(c.id);
      const src = (c.source || '').trim() || 'A trace';
      return `<div class="ncm-trace-hud__row${fresh ? ' is-new' : ''}" data-cd="${esc(c.id)}">
        <i class="fas fa-satellite-dish ncm-trace-hud__ico"></i>
        <div class="ncm-trace-hud__txt">
          <div class="ncm-trace-hud__ttl">INCOMING TRACE</div>
          <div class="ncm-trace-hud__src">${esc(src)} → ${esc(c.objectName || 'you')}</div>
        </div>
        <div class="ncm-trace-hud__time" data-exp="${c.expiresAt || 0}">${this._fmt((c.expiresAt || 0) - now)}</div>
      </div>`;
    }).join('');
    // prune _seen to current ids so a re-started countdown flashes again
    this._seen = new Set(rows.map(r => r.id));

    if (!this._tick) this._tick = setInterval(() => this._tickTimes(), 1000);
  }

  /** Cheap per-second update of just the MM:SS numbers (no rebuild). */
  _tickTimes() {
    if (!this._el) return;
    const now = this._nowMs();
    let anyLive = false;
    for (const cell of this._el.querySelectorAll('.ncm-trace-hud__time')) {
      const rem = Number(cell.dataset.exp || 0) - now;
      if (rem <= 0) { cell.closest('.ncm-trace-hud__row')?.classList.add('is-over'); cell.textContent = '00:00'; }
      else { anyLive = true; cell.textContent = this._fmt(rem); }
    }
    // When everything's expired, the setting write from the GM reaper will
    // refresh us; but if that client is offline, drop the panel ourselves.
    if (!anyLive) this.refresh();
  }
}
