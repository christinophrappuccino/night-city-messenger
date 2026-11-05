/**
 * SecurityService
 * @file scripts/services/SecurityService.js
 * @module night-city-messenger
 * @description Lockout tracking and attempt management for network authentication
 *              and data shard security. Maintains per-actor security state including
 *              attempt counts, lockout timers, and cooldown management.
 *
 *              This service handles the "meta" security layer — tracking attempts
 *              and enforcing lockouts. The actual authentication logic lives in
 *              NetworkService (for networks) and DataShardService (for shards).
 *
 *              Depends on: EventBus, StateManager
 *              Initialization priority: ready/40
 */

import { MODULE_ID, EVENTS, SOCKET_OPS } from '../utils/constants.js';
import { log, isGM, isPrimaryGM, userOwnsActor } from '../utils/helpers.js';
import { serialize } from '../utils/serialize.js';
import { lockoutEntry, isLive, isSpent, mergeReport, mergeLocal, prune } from '../utils/lockoutRecord.js';

/** The world setting that keeps lockouts and tries across reloads (audit D3). */
const SAVED_SETTING = 'securityLockouts';

export class SecurityService {

  constructor() {
    this.eventBus = game.nightcity.eventBus;
    this.stateManager = game.nightcity.stateManager;

    /**
     * Per-actor, per-target lockout state.
     * Key format: `${actorId}::${targetId}` where targetId is a networkId or itemId.
     * @type {Map<string, SecurityState>}
     */
    this._states = new Map();

    /**
     * Active lockout timers for auto-expiry.
     * @type {Map<string, number>} key → setTimeout ID
     */
    this._timers = new Map();

    /**
     * GM only: attempt / lockout state REPORTED by players' clients
     * (SOCKET_OPS.SECURITY_REPORT). SecurityService state is client-local, so
     * without this the GM never sees a player's failed tries or an earned
     * lockout. Kept apart from `_states` so the GM's own enforcement is untouched.
     * @type {Map<string, object>}
     */
    this._remote = new Map();

    // Lockouts and tries survive a reload (audit DATA-05): read the saved ones, follow every change to them.
    this._loadSaved();
    this._wireSaved();

    this._initialized = true;
    log.info('SecurityService initialized');
  }

  // ═══════════════════════════════════════════════════════════
  //  Saved lockouts (audit D3) — the active GM writes, everyone reads
  // ═══════════════════════════════════════════════════════════

  /** @private The saved map, or {}. */
  _savedAll() {
    try { return game.settings.get(MODULE_ID, SAVED_SETTING) || {}; } catch { return {}; }
  }

  /** @private Bring the saved lockouts and tries into this client (the newer of saved / local wins per key). */
  _loadSaved() {
    const now = this._nowMs();
    for (const [key, e] of Object.entries(this._savedAll())) {
      const i = key.indexOf('::');
      if (i < 1 || isSpent(e, now)) continue;
      const actorId = key.slice(0, i), targetId = key.slice(i + 2);
      const local = this._states.get(key);
      const merged = mergeLocal(local ? { ...local } : null, e, now);
      const state = { ...this._defaultState(actorId, targetId), ...(local || {}), ...merged, actorId, targetId };
      this._states.set(key, state);
      if (isLive(state, now)) this._startLockoutTimer(actorId, targetId);
    }
  }

  /** @private Follow the setting; a player re-reports what it holds when a GM connects. */
  _wireSaved() {
    if (typeof Hooks === 'undefined') return;
    const onSetting = (setting) => { if (setting?.key === `${MODULE_ID}.${SAVED_SETTING}`) this._loadSaved(); };
    Hooks.on('updateSetting', onSetting);
    Hooks.on('createSetting', onSetting);
    if (!isGM()) {
      Hooks.on('userConnected', (user, connected) => {
        if (connected && user?.isGM) setTimeout(() => this._resyncToGM(), 3000);
      });
    }
  }

  /** @private Player: tell a GM who just connected what this client is holding (tries made while no GM was online). */
  _resyncToGM() {
    const now = this._nowMs();
    for (const s of this._states.values()) if (s.attempts > 0 || isLive(s, now)) this._reportToGM(s);
  }

  /** @private Change the saved map, one write at a time, on the active GM only. */
  _persistMutate(fn) {
    if (!isPrimaryGM()) return Promise.resolve();
    return serialize('securityLockouts', async () => {
      const now = this._nowMs();
      const all = prune({ ...this._savedAll() }, now);
      fn(all, now);
      try { await game.settings.set(MODULE_ID, SAVED_SETTING, all); } catch (err) { log.warn(`Saving security lockouts failed: ${err.message}`); }
    });
  }

  /** @private Save (or drop) these keys from this client's state. */
  _persistKeys(keys = []) {
    return this._persistMutate((all, now) => {
      for (const k of keys) {
        const s = this._states.get(k);
        if (!s || isSpent(s, now)) delete all[k]; else all[k] = lockoutEntry(s);
      }
    });
  }

  /** @private Stamp a state as changed now (real time; the saved/local merge keeps the newer one). */
  _touch(state) { if (state) state.at = Date.now(); return state; }

  // ═══════════════════════════════════════════════════════════
  //  Types
  // ═══════════════════════════════════════════════════════════

  /**
   * @typedef {Object} SecurityState
   * @property {number} attempts - Number of failed attempts
   * @property {number} maxAttempts - Max allowed before lockout
   * @property {number|null} lockoutUntil - Timestamp (ms) when lockout expires
   * @property {number} lockoutDuration - Duration in ms for lockouts
   * @property {string} targetId - The network or item ID
   * @property {string} actorId - The actor attempting access
   */

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API — State Queries
  // ═══════════════════════════════════════════════════════════

  /**
   * Get the security state for an actor + target pair.
   * @param {string} actorId
   * @param {string} targetId - Network ID or Item ID
   * @returns {SecurityState}
   */
  getState(actorId, targetId) {
    const key = this._key(actorId, targetId);
    return this._states.get(key) ?? this._defaultState(actorId, targetId);
  }

  /**
   * Check if an actor is currently locked out from a target.
   * @param {string} actorId
   * @param {string} targetId
   * @returns {boolean}
   */
  isLockedOut(actorId, targetId) {
    const state = this.getState(actorId, targetId);
    if (!state.lockoutUntil) return false;

    if (this._nowMs() >= state.lockoutUntil) {
      // Lockout expired — clear it
      this._clearLockout(actorId, targetId);
      return false;
    }

    return true;
  }

  /**
   * Get remaining lockout time in ms.
   * @param {string} actorId
   * @param {string} targetId
   * @returns {number} 0 if not locked out
   */
  getLockoutRemaining(actorId, targetId) {
    const state = this.getState(actorId, targetId);
    if (!state.lockoutUntil) return 0;

    const remaining = state.lockoutUntil - this._nowMs();
    return remaining > 0 ? remaining : 0;
  }

  /**
   * Get remaining attempts before lockout.
   * @param {string} actorId
   * @param {string} targetId
   * @returns {number}
   */
  getRemainingAttempts(actorId, targetId) {
    const state = this.getState(actorId, targetId);
    return Math.max(0, state.maxAttempts - state.attempts);
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API — Attempt Recording
  // ═══════════════════════════════════════════════════════════

  /**
   * Initialize tracking for an actor + target with specific limits.
   * Call this before the first attempt to set maxAttempts and lockoutDuration.
   * @param {string} actorId
   * @param {string} targetId
   * @param {object} config
   * @param {number} [config.maxAttempts=3]
   * @param {number} [config.lockoutDuration=3600000]
   */
  initTracking(actorId, targetId, config = {}) {
    const key = this._key(actorId, targetId);
    const existing = this._states.get(key);

    if (existing) {
      // Update limits but preserve attempts
      existing.maxAttempts = config.maxAttempts ?? existing.maxAttempts;
      existing.lockoutDuration = config.lockoutDuration ?? existing.lockoutDuration;
    } else {
      this._states.set(key, {
        actorId,
        targetId,
        attempts: 0,
        maxAttempts: config.maxAttempts ?? 3,
        lockoutUntil: null,
        lockoutDuration: config.lockoutDuration ?? 3600000,
      });
    }
  }

  /**
   * Record a failed attempt. Returns the updated state.
   * Automatically triggers lockout if maxAttempts reached.
   * @param {string} actorId
   * @param {string} targetId
   * @returns {{ state: SecurityState, lockedOut: boolean }}
   */
  recordFailedAttempt(actorId, targetId) {
    const key = this._key(actorId, targetId);
    let state = this._states.get(key);

    if (!state) {
      state = this._defaultState(actorId, targetId);
      this._states.set(key, state);
    }

    state.attempts++;
    this._touch(state);

    // Check for lockout
    if (state.attempts >= state.maxAttempts) {
      state.lockoutUntil = this._nowMs() + state.lockoutDuration;
      this._startLockoutTimer(actorId, targetId);

      this.eventBus.emit(EVENTS.NETWORK_LOCKOUT, {
        actorId,
        targetId,
        lockoutUntil: state.lockoutUntil,
        duration: state.lockoutDuration,
      });

      log.info(`Lockout triggered: actor ${actorId} → target ${targetId} for ${state.lockoutDuration}ms`);
      this._reportToGM(state);
      this._persistKeys([key]);
      return { state: { ...state }, lockedOut: true };
    }

    this._reportToGM(state);
    this._persistKeys([key]);
    return { state: { ...state }, lockedOut: false };
  }

  /**
   * Impose a lockout DIRECTLY, bypassing attempt accumulation — the primitive
   * behind trace-heat escalation (design §6b: warm tier → "lockout of the actor
   * eligible"). A normal lockout is earned by burning maxAttempts; this one is a
   * GM (or auto-escalation) decision that this actor is locked out of this target
   * NOW for `durationMs`. Sets `attempts = maxAttempts` so the login screens'
   * "N attempts left" reads 0, starts the auto-expiry poll, and emits the same
   * NETWORK_LOCKOUT event the earned path does (so every gate reacts identically).
   * @param {string} actorId
   * @param {string} targetId
   * @param {object} [o]
   * @param {number} [o.durationMs=3600000] lockout length
   * @param {string} [o.reason] audit note (logged only)
   * @returns {number} the lockout deadline (ms)
   */
  forceLockout(actorId, targetId, { durationMs = 3600000, reason = '' } = {}) {
    const until = this._applyForced(actorId, targetId, durationMs, reason);
    this.eventBus.emit(EVENTS.NETWORK_LOCKOUT, {
      actorId, targetId, lockoutUntil: until, duration: durationMs, forced: true,
    });
    log.info(`Forced lockout: actor ${actorId} → target ${targetId} for ${durationMs}ms${reason ? ` (${reason})` : ''}`);
    return until;
  }

  /**
   * Escalation entry point — force-lock an actor out of a SET of targets (a
   * terminal fans out to one key per account) as ONE operation. Lockout state is
   * CLIENT-LOCAL (an in-memory Map), so applying it here alone would only lock
   * the GM's client while the player's login checks still read "not locked" —
   * that was the "I locked them out and they logged right back in" bug. This
   * applies locally, emits ONE forced NETWORK_LOCKOUT (not N — the N-toast spam),
   * broadcasts SOCKET_OPS.SECURITY_LOCKOUT so every client mirrors the state,
   * and kicks any open session on this client too (a GM testing as the actor).
   * @param {string} actorId
   * @param {string[]} targets  lockout keys (networkId / shardId / `termId::acctId`)
   * @param {object} [o] { durationMs, reason, label } — label is the human name
   *   for the locked thing ("DOCK-TERM-4"), shown in the player's toast.
   */
  forceLockoutMany(actorId, targets = [], { durationMs = 3600000, reason = '', label = '' } = {}) {
    if (!actorId || !targets.length) return;
    for (const t of targets) this._applyForced(actorId, t, durationMs, reason);
    this._persistKeys(targets.map((t) => this._key(actorId, t)));
    this.eventBus.emit(EVENTS.NETWORK_LOCKOUT, {
      actorId, targetId: targets[0], targets, duration: durationMs, forced: true, label,
    });
    game.nightcity?.socketManager?.emit(SOCKET_OPS.SECURITY_LOCKOUT, {
      actorId, targets, durationMs, reason, label,
    });
    this._kickLockedViewers(actorId, targets, label);
    log.info(`Forced lockout (many): actor ${actorId} → ${targets.length} target(s) for ${durationMs}ms${reason ? ` (${reason})` : ''}`);
  }

  /**
   * Socket receiver for SECURITY_LOCKOUT — mirror a GM-forced lockout into THIS
   * client's local state, kick any live session on the locked target, and (if
   * this user owns the locked actor) show the in-fiction toast.
   * @param {object} p { actorId, targets, durationMs, label, reason }
   */
  receiveForcedLockout(p = {}) {
    const { actorId, targets = [], durationMs = 3600000, label = '', reason = '' } = p;
    if (!actorId || !targets.length) return;
    for (const t of targets) this._applyForced(actorId, t, durationMs, reason);
    this._persistKeys(targets.map((t) => this._key(actorId, t)));   // only acts on the active GM (another GM forced it)
    this.eventBus.emit(EVENTS.NETWORK_LOCKOUT, {
      actorId, targetId: targets[0], targets, duration: durationMs, forced: true, label,
    });
    this._kickLockedViewers(actorId, targets, label);
    // The in-fiction ping goes to the operator's player only — the GM initiated
    // this and already has the escalation chat card.
    const actor = game.actors?.get(actorId);
    if (!isGM() && actor?.isOwner) {
      const mins = Math.max(1, Math.round(durationMs / 60000));
      try {
        game.nightcity?.notificationService?.showToastV2?.({
          type: 'net-lockout', title: 'LOCKED OUT',
          detail: `${label || 'A secured system'} slammed the door — locked for ${mins} min.`,
          duration: 8000, priority: 'urgent',
        });
        game.nightcity?.soundService?.play?.('lockout');
      } catch { /* no toast */ }
    }
    log.debug(`Forced lockout received: actor ${actorId} → ${targets.length} target(s)`);
  }

  /** @private Set the forced-lockout state for one key (no events, no wire). */
  _applyForced(actorId, targetId, durationMs, reason = '') {
    const key = this._key(actorId, targetId);
    let state = this._states.get(key);
    if (!state) { state = this._defaultState(actorId, targetId); this._states.set(key, state); }
    state.forced = true;
    state.reason = reason || state.reason || '';
    state.lockoutDuration = durationMs;
    state.attempts = Math.max(state.attempts, state.maxAttempts);
    state.lockoutUntil = this._nowMs() + durationMs;
    this._touch(state);
    this._startLockoutTimer(actorId, targetId);
    return state.lockoutUntil;
  }

  /**
   * @private Bounce live sessions the lockout just invalidated: a terminal
   * viewer logged in as the locked actor drops to its login screen ("the system
   * slammed the door"); an open shard viewer on a locked shard closes. Scans
   * both app registries (AppV1 ui.windows + AppV2 foundry.applications.instances).
   */
  _kickLockedViewers(actorId, targets, label = '', message = '') {
    try {
      const apps = [
        ...Object.values(ui.windows ?? {}),
        ...(foundry.applications?.instances ? [...foundry.applications.instances.values()] : []),
      ];
      const seen = new Set();
      for (const app of apps) {
        if (!app || seen.has(app)) continue;
        seen.add(app);
        const itemId = app.item?.id;
        if (!itemId) continue;
        const hit = targets.some(t => t === itemId || String(t).startsWith(`${itemId}::`));
        if (!hit) continue;
        const opId = app.actorId || app.actor?.id || null;
        if (opId && opId !== actorId) continue;
        if (typeof app.forceLogout === 'function') {
          app.forceLogout(message || `CONNECTION TERMINATED — ${label || 'the system'} locked you out.`);
        } else if (app.element?.classList?.contains('ncm-item-inbox')) {
          app.close();
        }
      }
    } catch (err) { log.warn(`Lockout viewer kick failed: ${err.message}`); }
  }

  /**
   * Record a successful attempt. Resets the attempt counter.
   * @param {string} actorId
   * @param {string} targetId
   */
  recordSuccess(actorId, targetId) {
    const key = this._key(actorId, targetId);
    const state = this._states.get(key);
    if (state) {
      state.attempts = 0;
      state.lockoutUntil = null;
      state.forced = false;
      state.reason = '';
      this._touch(state);
    }
    this._clearTimer(key);
    this._reportToGM(state || { actorId, targetId, attempts: 0, maxAttempts: 3, lockoutUntil: null, lockoutDuration: 0, at: Date.now() });
    this._persistKeys([key]);
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API — What the GM can see of players' tries (2026-10-27)
  // ═══════════════════════════════════════════════════════════

  /**
   * @private Player → GM: report this client's attempt / lockout state for any
   * target (a terminal account, a network, a shard, a node…) so the GM can show it
   * and save it (audit D3: it used to be terminal accounts and net joins only).
   * No GM online = nothing to do now; it is re-sent when a GM connects.
   */
  _reportToGM(state) {
    try {
      if (!state || isGM() || !state.targetId) return;
      if (!game.users?.activeGM) return;
      game.nightcity?.socketManager?.emit(SOCKET_OPS.SECURITY_REPORT, {
        actorId: state.actorId, targetId: state.targetId,
        attempts: Number(state.attempts) || 0, maxAttempts: Number(state.maxAttempts) || 3,
        lockoutUntil: state.lockoutUntil || null, lockoutDuration: Number(state.lockoutDuration) || 0,
        forced: !!state.forced, reason: state.reason || '', at: Number(state.at) || Date.now(),
      });
    } catch (err) { log.debug(`Security report failed: ${err.message}`); }
  }

  /**
   * GM: store a player's reported state (SOCKET_OPS.SECURITY_REPORT), then
   * tell any open admin view (`ncmSecurityReport` hook).
   * @param {object} p { actorId, targetId, attempts, maxAttempts, lockoutUntil, lockoutDuration, forced, reason }
   * @param {string} [senderId]
   */
  receiveReport(p = {}, senderId = '') {
    if (!isGM() || !p.actorId || !p.targetId) return;
    // A player reports only their own characters' tries (audit D3: these are now saved).
    if (senderId && !userOwnsActor(senderId, p.actorId)) { log.warn(`Security report refused: the sender does not own ${p.actorId}`); return; }
    const key = this._key(p.actorId, p.targetId);
    // Save it — a report may add tries or start a lockout, never end a running one early (mergeReport).
    this._persistMutate((all, now) => { const next = mergeReport(all[key] || null, p, now); if (next) all[key] = next; else delete all[key]; });
    if (!(Number(p.attempts) > 0) && !p.lockoutUntil) this._remote.delete(key);
    else {
      this._remote.set(key, {
        actorId: p.actorId, targetId: p.targetId,
        attempts: Number(p.attempts) || 0, maxAttempts: Number(p.maxAttempts) || 3,
        lockoutUntil: Number(p.lockoutUntil) || null, lockoutDuration: Number(p.lockoutDuration) || 0,
        forced: !!p.forced, reason: String(p.reason || ''),
        reportedAt: Date.now(), reportedBy: senderId || '',
      });
    }
    try { globalThis.Hooks?.callAll?.('ncmSecurityReport', { actorId: p.actorId, targetId: p.targetId }); } catch { /* no hooks */ }
  }

  /**
   * What is known about an actor on a target: this client's own state and any
   * state a player reported, with an expired lockout read as cleared (expiry
   * resets the attempt counter, as on the player's client). A live lockout wins
   * (latest deadline); otherwise the higher attempt count.
   * @returns {{attempts:number, maxAttempts:number, lockoutUntil:number|null, lockoutRemaining:number, forced:boolean, reason:string, source:string}|null}
   */
  getKnownState(actorId, targetId) {
    const key = this._key(actorId, targetId);
    const now = this._nowMs();
    const norm = (s, source) => {
      if (!s) return null;
      const live = !!s.lockoutUntil && s.lockoutUntil > now;
      const expired = !!s.lockoutUntil && !live;
      return {
        attempts: expired ? 0 : (Number(s.attempts) || 0),
        maxAttempts: Number(s.maxAttempts) || 3,
        lockoutUntil: live ? s.lockoutUntil : null,
        lockoutRemaining: live ? s.lockoutUntil - now : 0,
        forced: live && !!s.forced,
        reason: live ? (s.reason || '') : '',
        source,
      };
    };
    const c = [norm(this._states.get(key), 'local'), norm(this._remote.get(key), 'remote')]
      .filter((s) => s && (s.attempts > 0 || s.lockoutUntil));
    if (!c.length) return null;
    const locked = c.filter((s) => s.lockoutUntil).sort((a, b) => b.lockoutUntil - a.lockoutUntil);
    if (locked.length) return locked[0];
    return c.sort((a, b) => b.attempts - a.attempts)[0];
  }

  /**
   * GM: clear an actor's tries + lockout on these targets — here AND on every
   * client (SOCKET_OPS.SECURITY_CLEAR), so the player's own login checks really
   * unblock. "Clear lockout" and "Reset tries" are both this.
   * @param {string} actorId @param {string[]} targets
   */
  clearFor(actorId, targets = []) {
    if (!actorId || !targets.length) return;
    this._clearLocal(actorId, targets);
    this._persistKeys(targets.map((t) => this._key(actorId, t)));
    game.nightcity?.socketManager?.emit(SOCKET_OPS.SECURITY_CLEAR, { actorId, targets });
    log.info(`Security cleared: actor ${actorId} → ${targets.length} target(s)`);
  }

  /** Socket receiver for SECURITY_CLEAR (every client). actorId '*' = every actor on those targets. */
  receiveClear(p = {}) {
    if (!p.actorId || !Array.isArray(p.targets) || !p.targets.length) return;
    if (p.actorId === '*') { for (const t of p.targets) this._clearTargetLocal(t); this._persistTargets(p.targets); return; }
    this._clearLocal(p.actorId, p.targets);
    this._persistKeys(p.targets.map((t) => this._key(p.actorId, t)));   // only acts on the active GM
  }

  /** @private Drop every saved entry on these targets (any actor). */
  _persistTargets(targets = []) {
    const set = new Set(targets);
    return this._persistMutate((all) => { for (const k of Object.keys(all)) if (set.has(k.slice(k.indexOf('::') + 2))) delete all[k]; });
  }

  /** @private Every actor's tries + lockout on one target, on THIS client (own states and mirrored ones). */
  _clearTargetLocal(targetId) {
    let n = 0;
    for (const map of [this._states, this._remote]) {
      for (const key of [...map.keys()]) {
        if (key.slice(key.indexOf('::') + 2) !== targetId) continue;
        map.delete(key); this._clearTimer(key); n++;
      }
    }
    return n;
  }

  /** @private */
  _clearLocal(actorId, targets) {
    for (const t of targets) {
      const key = this._key(actorId, t);
      this._states.delete(key);
      this._remote.delete(key);
      this._clearTimer(key);
    }
  }

  /**
   * GM: end an actor's live session on terminal accounts — bounce their open
   * viewer back to its login screen, here and on every client
   * (SOCKET_OPS.TERMINAL_KICK). The stored session record is the caller's write.
   * @param {string} actorId @param {string[]} targets `termId::acctId` keys
   * @param {string} [message] the login-screen error line
   */
  kickSession(actorId, targets = [], message = 'SESSION ENDED BY THE SYSTEM.') {
    if (!actorId || !targets.length) return;
    this._kickLockedViewers(actorId, targets, '', message);
    game.nightcity?.socketManager?.emit(SOCKET_OPS.TERMINAL_KICK, { actorId, targets, message });
  }

  /** Socket receiver for TERMINAL_KICK. */
  receiveKick(p = {}) {
    if (!p.actorId || !Array.isArray(p.targets) || !p.targets.length) return;
    this._kickLockedViewers(p.actorId, p.targets, '', p.message || 'SESSION ENDED BY THE SYSTEM.');
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API — Resets (GM Operations)
  // ═══════════════════════════════════════════════════════════

  /**
   * Reset security state for an actor + target pair. GM only.
   * @param {string} actorId
   * @param {string} targetId
   */
  resetState(actorId, targetId) {
    const key = this._key(actorId, targetId);
    this._states.delete(key);
    this._clearTimer(key);
    this._persistKeys([key]);
    log.debug(`Security state reset: ${key}`);
  }

  /**
   * Reset all security states for a target. GM only.
   * Useful when a network password changes or a shard is relocked.
   * @param {string} targetId
   */
  resetAllForTarget(targetId, { broadcast = true } = {}) {
    // A reset means "unlock it for everyone": the lockout a player hit lives on THEIR client
    // (and is mirrored to others), so clearing only this client's copy left them locked out
    // until game time ran the clock down (tester, 2026-10-29: Admin → Terminals → Reset did nothing).
    const n = this._clearTargetLocal(targetId);
    this._persistTargets([targetId]);
    if (broadcast) game.nightcity?.socketManager?.emit(SOCKET_OPS.SECURITY_CLEAR, { actorId: '*', targets: [targetId] });
    log.debug(`Security states reset for target: ${targetId} (${n} cleared here, every client told)`);
  }

  /**
   * Reset all security states for an actor. GM only.
   * @param {string} actorId
   */
  resetAllForActor(actorId) {
    const toDelete = [];
    for (const [key, state] of this._states) {
      if (state.actorId === actorId) {
        toDelete.push(key);
      }
    }
    for (const key of toDelete) {
      this._states.delete(key);
      this._clearTimer(key);
    }
    this._persistMutate((all) => { for (const k of Object.keys(all)) if (k.startsWith(`${actorId}::`)) delete all[k]; });
    log.debug(`Security states reset for actor: ${actorId} (${toDelete.length} cleared)`);
  }

  /**
   * Clear ALL security states. GM only.
   */
  resetAll() {
    for (const key of this._timers.keys()) {
      this._clearTimer(key);
    }
    this._states.clear();
    this._persistMutate((all) => { for (const k of Object.keys(all)) delete all[k]; });
    log.info('All security states cleared');
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API — Reporting
  // ═══════════════════════════════════════════════════════════

  /**
   * Get all active lockouts.
   * @returns {SecurityState[]}
   */
  /**
   * Every actor this client knows about on a target (own states + the ones players reported), as
   * { actorId, attempts, maxAttempts, lockoutRemaining } — the GM's node inspector reads it.
   * @param {string} targetId
   */
  knownForTarget(targetId) {
    const ids = new Set();
    for (const map of [this._states, this._remote]) for (const key of map.keys()) {
      const i = key.indexOf('::');
      if (key.slice(i + 2) === targetId) ids.add(key.slice(0, i));
    }
    return [...ids].map((actorId) => ({ actorId, ...(this.getKnownState(actorId, targetId) || {}) })).filter((x) => x.attempts > 0 || x.lockoutRemaining > 0);
  }

  getActiveLockouts() {
    const now = this._nowMs();
    const lockouts = [];
    for (const state of this._states.values()) {
      if (state.lockoutUntil && state.lockoutUntil > now) {
        lockouts.push({ ...state });
      }
    }
    return lockouts;
  }

  /**
   * Get all states for a specific target (for GM review).
   * @param {string} targetId
   * @returns {SecurityState[]}
   */
  getStatesForTarget(targetId) {
    const results = [];
    for (const state of this._states.values()) {
      if (state.targetId === targetId) {
        results.push({ ...state });
      }
    }
    return results;
  }

  // ═══════════════════════════════════════════════════════════
  //  INTERNAL
  // ═══════════════════════════════════════════════════════════

  /** Current time in epoch ms via the configured time provider. @private */
  _nowMs() {
    try {
      const ts = game.nightcity?.timeService;
      if (ts) return ts.getCurrentTimeMs();
    } catch { /* fallback */ }
    return Date.now();
  }

  /** @private */
  _key(actorId, targetId) {
    return `${actorId}::${targetId}`;
  }

  /** @private */
  _defaultState(actorId, targetId) {
    return {
      actorId,
      targetId,
      attempts: 0,
      maxAttempts: 3,
      lockoutUntil: null,
      lockoutDuration: 3600000,
    };
  }

  /** @private */
  _clearLockout(actorId, targetId) {
    const key = this._key(actorId, targetId);
    const state = this._states.get(key);
    if (state) {
      state.lockoutUntil = null;
      state.attempts = 0;
      this._touch(state);
    }
    this._clearTimer(key);
    this._persistKeys([key]);   // an expired lockout leaves the saved list (active GM)
  }

  /**
   * Auto-expire a lockout. Polls against game time and reschedules rather than
   * a single real-time setTimeout, so in world-time / manual modes the lockout
   * doesn't clear early while the game clock is paused. `lockoutUntil` is the
   * authoritative game-time deadline (isLockedOut also lazily clears on read).
   * @private
   */
  _startLockoutTimer(actorId, targetId) {
    const key = this._key(actorId, targetId);
    this._clearTimer(key);

    const tick = () => {
      const state = this._states.get(key);
      if (!state?.lockoutUntil) { this._timers.delete(key); return; }

      const remaining = state.lockoutUntil - this._nowMs();
      if (remaining <= 0) {
        this._clearLockout(actorId, targetId);
        log.debug(`Lockout expired: ${key}`);
        return;
      }

      // Re-check in real time, capped — so a paused game clock just polls
      // periodically instead of firing early.
      this._timers.set(key, setTimeout(tick, Math.min(remaining, 60000)));
    };

    const state = this._states.get(key);
    const first = state?.lockoutUntil ? (state.lockoutUntil - this._nowMs()) : 0;
    this._timers.set(key, setTimeout(tick, Math.max(0, Math.min(first, 60000))));
  }

  /** @private */
  _clearTimer(key) {
    const timerId = this._timers.get(key);
    if (timerId) {
      clearTimeout(timerId);
      this._timers.delete(key);
    }
  }
}
