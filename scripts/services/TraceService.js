/**
 * TraceService — the consequence spine (design doc §6).
 * @file scripts/services/TraceService.js
 * @module night-city-messenger
 * @description Every risky failure funnels through ONE `fireTrace`: it plays the
 *   local drama (trace splash + sound on the operator's client), records a durable
 *   LOG row, and bumps per-(object × actor) HEAT. The log + heat are GM-owned world
 *   settings, so a player RELAYS via SOCKET_OPS.TRACE_REQUEST and the GM records
 *   (the write-relay pattern used across the module). Heat DECAYS over game time
 *   (the time provider), so a one-off fumble cools off while sustained hammering
 *   escalates.
 *
 *   Escalation CONSEQUENCES (lockout / ICE / countdown at the heat tiers) and the
 *   Admin surface for the log + heat are later slices — this ships the spine: one
 *   funnel, a durable record, and the heat gauge. Placeholder tuning (§6b) is not
 *   locked.
 */

import { MODULE_ID, SOCKET_OPS } from '../utils/constants.js';
import { log, isGM, netVerbFor, whisperCardHtml } from '../utils/helpers.js';

const LOG_SETTING = 'traceLog';
const HEAT_SETTING = 'traceHeat';
const LOG_CAP = 250;

// Placeholder tuning (design §6b) — not locked; tune in playtest.
const HEAT_BY_SEVERITY = { minor: 10, major: 20, hostile: 35 };
const HEAT_DECAY_PER_HR = 5;
const HEAT_MAX = 100;
const TIERS = [
  { min: 80, tier: 'burned' },
  { min: 50, tier: 'hot' },
  { min: 25, tier: 'warm' },
  { min: 0, tier: 'cold' },
];

export class TraceService {
  get soundService() { return game.nightcity?.soundService; }
  get notificationService() { return game.nightcity?.notificationService; }
  get timeService() { return game.nightcity?.timeService; }

  _nowMs() { try { return this.timeService?.getCurrentTimeMs?.() ?? Date.now(); } catch { return Date.now(); } }
  _nowIso() { try { return new Date(this._nowMs()).toISOString(); } catch { return new Date().toISOString(); } }

  /** Heat tier for a value (cold < 25 ≤ warm < 50 ≤ hot < 80 ≤ burned). */
  static tierOf(value) { return (TIERS.find(t => value >= t.min) || TIERS[TIERS.length - 1]).tier; }
  static get SEVERITIES() { return { ...HEAT_BY_SEVERITY }; }

  /**
   * Fire a trace. Plays the local drama immediately (any client), then records
   * the log + heat GM-side (direct for a GM, relayed for a player).
   * @param {object} o
   * @param {Actor}  [o.actor]      the operator who tripped it
   * @param {string} [o.action]     verb — 'siphon' | 'upload' | 'unlock' | 'malware' | …
   * @param {string} [o.source]     human label for what was traced ("the vault", "affair.chat")
   * @param {Item}   [o.hostItem]   the object traced (terminal/shard) → heat key + name
   * @param {string} [o.objectId]   explicit object id (when no hostItem)
   * @param {string} [o.objectName] explicit object name
   * @param {number} [o.dv] @param {number} [o.margin]
   * @param {string} [o.severity]   'minor' | 'major' (default) | 'hostile'
   * @param {boolean}[o.quiet]      record the log + heat but SKIP the splash/sound
   *                                (for sites that already show their own fail
   *                                feedback — lockout, ICE, a dialog error — or
   *                                whose animation owns the climax)
   */
  fireTrace(o = {}) {
    if (!o.quiet) {
      const label = o.source || o.objectName || o.hostItem?.name || 'a secured system';
      try { this.soundService?.play('trace-fire'); } catch { /* no sound */ }
      try { this.notificationService?.showShardTrace?.({ itemName: label }); } catch { /* no splash */ }
    }

    const payload = this._payload(o);
    if (isGM()) this.recordTrace(payload);
    else game.nightcity?.socketManager?.emit(SOCKET_OPS.TRACE_REQUEST, payload);
  }

  /**
   * Log a notable SUCCESS — the activity-feed counterpart to fireTrace. No heat,
   * no splash/sound (you succeeded — nothing tripped); it just records the event
   * so the GM's log is the WHOLE story, not only failures. GM records / player
   * relays, same as fireTrace.
   * @param {object} o same shape as fireTrace's opts (actor, action, source, hostItem, target refs…)
   */
  logSuccess(o = {}) {
    const payload = this._payload({ ...o, outcome: 'success' });
    if (isGM()) this.recordTrace(payload);
    else game.nightcity?.socketManager?.emit(SOCKET_OPS.TRACE_REQUEST, payload);
  }

  /** @private Build the serializable record (no live objects — safe on the wire). */
  _payload(o) {
    const actor = o.actor || null;
    const it = o.hostItem || null;
    let targetKind = o.targetKind || null;
    if (!targetKind && it) {
      if (it.getFlag?.(MODULE_ID, 'isTerminal')) targetKind = 'terminal';
      else if (it.getFlag?.(MODULE_ID, 'isDataShard')) targetKind = 'shard';
    }
    return {
      ts: this._nowIso(),
      actorId: actor?.id || null,
      actorName: actor?.name || 'Unknown',
      action: o.action || 'intrusion',
      source: o.source || '',
      objectId: it?.id || o.objectId || null,
      objectName: it?.name || o.objectName || o.source || 'unknown',
      // Deep-link refs so the log's ↗ can open the exact object (design §7).
      targetKind,
      targetUuid: it?.uuid || o.targetUuid || null,
      targetNetworkId: o.targetNetworkId || null,
      targetMessageId: o.targetMessageId || o.messageId || null,
      targetContactId: o.targetContactId || null,
      dv: Number(o.dv) || null,
      margin: Number.isFinite(o.margin) ? o.margin : null,
      severity: HEAT_BY_SEVERITY[o.severity] ? o.severity : 'major',
      outcome: o.outcome === 'success' ? 'success' : 'failed',
      // The RED NET-action this abstracts (design §5's netAction tag) — derived
      // centrally from `action` so no call site has to carry it; explicit
      // o.netVerb wins. Unknown actions get none (don't invent a shape).
      netVerb: o.netVerb || netVerbFor(o.action) || null,
    };
  }

  /** GM-side: append the activity row; failures also bump heat + alert. */
  async recordTrace(p) {
    if (!isGM() || !p) return;
    try {
      const isFail = p.outcome !== 'success';
      const heatDelta = isFail ? (HEAT_BY_SEVERITY[p.severity] ?? 20) : 0;
      const rows = [...this.getLog(), { id: `tr-${foundry.utils.randomID(8)}`, ...p, heatDelta }];
      while (rows.length > LOG_CAP) rows.shift();
      await game.settings.set(MODULE_ID, LOG_SETTING, rows);

      // Successes are logged with NO heat gained (design: heat is only for tripped
      // defenses). Only failures heat + alert the GM.
      const objId = p.objectId || `label:${String(p.objectName || 'unknown').toLowerCase()}`;
      const who = p.actorId || 'unknown';
      let heat = this.getHeat(objId, who);
      if (isFail) {
        heat = await this.bumpHeat(objId, who, heatDelta);
        this._gmAlert(p, heat);
      }
      await this._fireResidentTriggers(p, heat);
    } catch (err) { log.error(`recordTrace failed: ${err.message}`); }
  }

  /**
   * Resident triggers ride the trace funnel.
   *
   * Every gated content action already reports here carrying an `action` tag and
   * its host item, so this ONE hook reaches siphon / crack / decrypt / camera /
   * deploy / execute / exfil / upload. The alternative was a
   * `checkActionResidents()` call at each site — only exfil ever got one, which
   * is why `onAction` and `onHeat` residents were installable but unreachable.
   *
   * - `onAction` fires only when the action SUCCEEDED: the thing actually
   *   happened. A failed attempt is the trace's business, not the bomb's.
   * - `onHeat` is checked either way, because heat is what moved.
   *
   * Resolved through the `game.nightcity` namespace rather than an import so the
   * trace spine stays independent of the terminal service.
   * @private
   */
  async _fireResidentTriggers(p, heat) {
    if (p.targetKind !== 'terminal' || !p.objectId) return;
    const svc = game.nightcity?.terminalService;
    const item = game.items?.get(p.objectId);
    if (!svc || !item) return;
    try {
      // 'exfil' is deliberately NOT handled here: it has its own EVENTS.TERMINAL_EXFIL
      // listener (registerTerminalSystem, ready/68) which also catches UNGATED
      // exfils that never reach this funnel. Running both would propose the same
      // resident twice.
      if (p.outcome === 'success' && p.action !== 'exfil') {
        await svc.checkActionResidents?.(item, p.action, { actorId: p.actorId });
      }
      await svc.checkHeatResidents?.(item, heat, { actorId: p.actorId });
    } catch (err) { log.warn(`Resident trigger check failed: ${err.message}`); }
  }

  /** GM-side socket handler body for TRACE_REQUEST (player relay). */
  async handleTraceRequest(data) { if (isGM()) await this.recordTrace(data); }

  // ─── Log ───
  getLog() { try { return game.settings.get(MODULE_ID, LOG_SETTING) ?? []; } catch { return []; } }
  async clearLog() { if (isGM()) await game.settings.set(MODULE_ID, LOG_SETTING, []); }

  // ─── Heat (per object × actor, decayed over game time) ───
  getHeatMap() { try { return game.settings.get(MODULE_ID, HEAT_SETTING) ?? {}; } catch { return {}; } }

  /** @private Decay a stored { value, ts } entry to now. */
  _decay(entry) {
    if (!entry) return 0;
    const now = this._nowMs();
    const t = Date.parse(entry.ts) || now;
    const hrs = Math.max(0, (now - t) / 3600000);
    return Math.max(0, (Number(entry.value) || 0) - HEAT_DECAY_PER_HR * hrs);
  }

  /** Decayed heat for one (object, actor). */
  getHeat(objectId, actorId) { return this._decay(this.getHeatMap()?.[objectId]?.[actorId]); }

  /** Bump heat (GM-side). Decays first, adds, clamps, stamps. Returns the new value. */
  async bumpHeat(objectId, actorId, amount) {
    if (!isGM()) return 0;
    const map = foundry.utils.deepClone(this.getHeatMap());
    const obj = map[objectId] || (map[objectId] = {});
    const cur = this._decay(obj[actorId]);
    const next = Math.min(HEAT_MAX, cur + (Number(amount) || 0));
    obj[actorId] = { value: next, ts: this._nowIso() };
    await game.settings.set(MODULE_ID, HEAT_SETTING, map);
    return next;
  }

  /**
   * GM manually SETS heat on a (object × actor) and posts a chat line (design §7).
   * Optional reason; `tellPlayer` also whispers the reason to the operator's
   * player as an in-fiction cue. GM-only (the Security tab is GM-only).
   * @returns {Promise<number>} the new value
   */
  async setHeat(objectId, actorId, value, { reason = '', tellPlayer = false, objectName = '' } = {}) {
    if (!isGM()) return 0;
    const map = foundry.utils.deepClone(this.getHeatMap());
    const obj = map[objectId] || (map[objectId] = {});
    const v = Math.max(0, Math.min(HEAT_MAX, Math.round(Number(value) || 0)));
    obj[actorId] = { value: v, ts: this._nowIso() };
    await game.settings.set(MODULE_ID, HEAT_SETTING, map);
    this._heatChat(actorId, objectName || objectId, v, reason, tellPlayer);
    return v;
  }

  /** @private Announce a manual heat change (GM audit whisper; optional player cue). */
  _heatChat(actorId, objectName, value, reason, tellPlayer) {
    try {
      const actor = actorId ? game.actors?.get(actorId) : null;
      const who = actor?.name || 'operator';
      const tier = TraceService.tierOf(value);
      const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      const gmIds = game.users?.filter(u => u.isGM).map(u => u.id) ?? [];
      if (gmIds.length) ChatMessage.create({
        content: whisperCardHtml({
          tone: 'warn', icon: 'fa-fire', title: 'Heat Adjusted',
          lines: [
            `<b>${esc(who)}</b> on <b>${esc(objectName)}</b> → <b>${value}</b> <span style="opacity:.75">(${tier.toUpperCase()})</span>`,
            reason ? `<span class="ncm-cc__sub"><i>${esc(reason)}</i></span>` : '',
          ],
        }), whisper: gmIds,
      });
      if (tellPlayer && reason && actor) {
        const owners = game.users?.filter(u => !u.isGM && actor.testUserPermission?.(u, 'OWNER')).map(u => u.id) ?? [];
        if (owners.length) ChatMessage.create({
          content: whisperCardHtml({ tone: 'warn', icon: 'fa-satellite-dish', title: 'Signal', lines: [`<i>${esc(reason)}</i>`] }),
          whisper: owners,
        });
      }
    } catch (err) { log.warn(`Heat chat failed: ${err.message}`); }
  }

  // ═══════════════════════════════════════════════════════════
  //  Escalation — trace countdown ("the corp found you", §6b)
  // ═══════════════════════════════════════════════════════════

  getCountdowns() { try { return game.settings.get(MODULE_ID, 'traceCountdowns') || []; } catch { return []; } }

  /**
   * GM starts a trace countdown on a (object × actor). Fires on expiry (game time).
   * @param {object} [o]
   * @param {number} [o.minutes=30]
   * @param {string} [o.source]  WHO is closing in — free text, optional. Defaults
   *   to "A trace"; a table might set "Arasaka counterintel", "the Maelstrom", a
   *   fixer's name — it isn't always a corp. Shown in both whispers.
   * @param {string} [o.reason]  WHY / any note (the "where/why" slot).
   * @param {string} [o.playerWarning] custom player-facing cue (overrides default).
   * @param {boolean}[o.tellPlayer]
   * @param {string} [o.objectName]
   */
  async startCountdown(objectId, actorId, { minutes = 30, source = '', reason = '', playerWarning = '', tellPlayer = false, objectName = '' } = {}) {
    if (!isGM()) return;
    const a = actorId ? game.actors?.get(actorId) : null;
    const expiresAt = this._nowMs() + Math.max(1, Number(minutes) || 30) * 60000;
    const src = (source || '').trim() || 'A trace';
    const list = [...this.getCountdowns(), {
      id: `cd-${foundry.utils.randomID(8)}`, objectId, actorId, objectName: objectName || objectId,
      actorName: a?.name || 'operator', expiresAt, source: src, reason, playerWarning, tellPlayer: !!tellPlayer,
    }];
    await game.settings.set(MODULE_ID, 'traceCountdowns', list);
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const gmIds = game.users?.filter(u => u.isGM).map(u => u.id) ?? [];
    if (gmIds.length) ChatMessage.create({
      content: whisperCardHtml({
        tone: 'danger', icon: 'fa-hourglass-half', title: 'Trace Started',
        lines: [
          `<b>${esc(src)}</b> is closing in on <b>${esc(a?.name || 'operator')}</b>`,
          `On <b>${esc(objectName)}</b> · <b>${minutes} min</b> on the game clock`,
          reason ? `<span class="ncm-cc__sub"><i>${esc(reason)}</i></span>` : '',
        ],
      }), whisper: gmIds,
    });
    if (tellPlayer && a) {
      const owners = game.users?.filter(u => !u.isGM && a.testUserPermission?.(u, 'OWNER')).map(u => u.id) ?? [];
      const warn = (playerWarning || '').trim() || `${src} is closing in — you feel the heat. A trace is running.`;
      if (owners.length) ChatMessage.create({
        content: whisperCardHtml({
          tone: 'danger', icon: 'fa-triangle-exclamation', title: 'Incoming Trace',
          lines: [`<b>${esc(warn)}</b>`, reason ? `<span class="ncm-cc__sub"><i>${esc(reason)}</i></span>` : ''],
        }), whisper: owners,
      });
    }
  }

  async cancelCountdown(id) { if (isGM()) await game.settings.set(MODULE_ID, 'traceCountdowns', this.getCountdowns().filter(c => c.id !== id)); }

  /** GM reaper — fire expired countdowns (game time). Registered on an interval. */
  async reapCountdowns() {
    if (!isGM()) return;
    const now = this._nowMs();
    const due = this.getCountdowns().filter(c => c.expiresAt <= now);
    if (!due.length) return;
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const gmIds = game.users?.filter(u => u.isGM).map(u => u.id) ?? [];
    for (const c of due) {
      const src = (c.source || '').trim() || 'The trace';
      if (gmIds.length) ChatMessage.create({
        content: whisperCardHtml({
          tone: 'danger', icon: 'fa-crosshairs', title: 'Trace Complete',
          lines: [
            `<b>${esc(src)}</b> found <b>${esc(c.actorName)}</b>`,
            `The trace on <b>${esc(c.objectName)}</b> ran out.`,
            c.reason ? `<span class="ncm-cc__sub"><i>${esc(c.reason)}</i></span>` : '',
          ],
        }), whisper: gmIds,
      });
      if (c.tellPlayer) {
        const a = c.actorId ? game.actors?.get(c.actorId) : null;
        const owners = a ? (game.users?.filter(u => !u.isGM && a.testUserPermission?.(u, 'OWNER')).map(u => u.id) ?? []) : [];
        if (owners.length) ChatMessage.create({
          content: whisperCardHtml({ tone: 'danger', icon: 'fa-crosshairs', title: 'Traced', lines: [`<b>${esc(src)} found you. The trace completed.</b>`] }),
          whisper: owners,
        });
      }
      try { this.soundService?.play('trace-fire'); } catch { /* no sound */ }
      // A completed trace is the WORST outcome — it lands in the durable
      // Activity Log and burns heat (hostile: +35 → typically BURNED), which
      // also pops the GM alert toast. Before this, expiry was only a whispered
      // chat line — easy to miss entirely ("I did countdown, nothing happened").
      try {
        await this.recordTrace(this._payload({
          actor: c.actorId ? game.actors?.get(c.actorId) : null,
          action: 'trace-complete',
          objectId: c.objectId, objectName: c.objectName,
          severity: 'hostile',
        }));
      } catch (err) { log.warn(`Trace-complete log failed: ${err.message}`); }
    }
    await game.settings.set(MODULE_ID, 'traceCountdowns', this.getCountdowns().filter(c => c.expiresAt > now));
  }

  /** GM-side toast + whisper. (The durable record IS the log; this is the ping.)
   *  Respects the client `securityAlertLevel` — every | serious (default) | off. */
  _gmAlert(p, heat) {
    let level = 'serious';
    try { level = game.settings.get(MODULE_ID, 'securityAlertLevel') || 'serious'; } catch { /* not registered */ }
    if (level === 'off') return;
    if (level === 'serious' && p.severity === 'minor') return; // dial down credential fumbles
    const tier = TraceService.tierOf(heat);
    const on = p.objectName && p.objectName !== 'unknown' ? ` on ${p.objectName}` : '';
    const msg = `${p.actorName} tripped a trace — ${p.action}${on} (heat ${Math.round(heat)} · ${tier.toUpperCase()}).`;
    try { ui.notifications.warn(`NCM | ${msg}`); } catch { /* no ui */ }
    try {
      const gmIds = game.users?.filter(u => u.isGM).map(u => u.id) ?? [];
      if (gmIds.length) {
        const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        ChatMessage.create({ content: `<b>NCM trace:</b> ${esc(msg)}`, whisper: gmIds });
      }
    } catch (err) { log.warn(`Trace GM alert failed: ${err.message}`); }
  }
}
