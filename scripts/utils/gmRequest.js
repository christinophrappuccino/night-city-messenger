/**
 * Ask the GM and wait for the answer — the ONE player → GM round trip (stage 2, batch 4; extended after stage 2).
 * @file scripts/utils/gmRequest.js
 * @module night-city-messenger
 *
 * A player's client often needs the GM to do something and say how it went: convert a shard, approve a price,
 * deliver a message, schedule one, call a netrun. The pattern is always the same — send a request with an id, wait
 * for a result op carrying that id, give up after a while. It had been written separately in several places, and two
 * copies registered a fresh result handler PER REQUEST. SocketManager keeps one handler per op, so a second request
 * from the same client replaced the first one's handler and the first request then waited out its timeout.
 *
 * Here there is ONE handler per result op and a table of waiting requests keyed by request id. An answer is accepted
 * only when:
 *   - it came from a GM (the server-checked sender, never a field in the message — audit SEC-01). Every client sees
 *     every request and its id, so without this a player could answer another player's request — the netrun verdict
 *     relay had exactly that hole until it moved here;
 *   - it is for this user, when the answer names one (`userId`);
 *   - its request is still waiting (or has an `onLate` handler).
 *
 * The GM-side handler must echo `requestId` (and `userId`, when it names one) in its result.
 *
 * Options beyond the basic wait (added when the delivery ack, scheduling and netrun round trips moved here):
 *   - `requestId`  use this id instead of a new one (the delivery ack keys by message id; a netrun's id is in the
 *                  payload the GM shows);
 *   - `extend(d)`  an answer that is not final: return how many more ms to wait (the GM "accepted" a message and is
 *                  delivering it), or a falsy value to settle with it;
 *   - `onLate(d)`  an answer that arrives after the timeout is handed here once, instead of being dropped (a
 *                  scheduled message the GM refused after the player stopped waiting gets its eddies back);
 *   - `timeoutMs: Infinity` waits until answered or withdrawn (a netrun verdict — the GM is at the table);
 *   - `external: true`  the result op keeps its OWN socket handler, which calls `settleGmRequest` first and does its
 *                  other work only when that returns false (MESSAGE_DELIVERED also settles held mail).
 * `withdrawGmRequest` ends a wait early with a value (the player stood down).
 */

import { isFromGM } from './helpers.js';

/** per SocketManager: resultOp → { waiting: Map(id → w), late: Map(id → { fn, until }) } */
const tables = new WeakMap();
const LATE_KEEP_MS = 10 * 60 * 1000;   // how long a timed-out request still takes a late answer

const newId = () => (globalThis.foundry?.utils?.randomID ? globalThis.foundry.utils.randomID(16) : Math.random().toString(36).slice(2, 18));

function tableFor(sm, resultOp, { external = false } = {}) {
  let ops = tables.get(sm);
  if (!ops) { ops = new Map(); tables.set(sm, ops); }
  let t = ops.get(resultOp);
  if (!t) {
    t = { waiting: new Map(), late: new Map(), external };
    ops.set(resultOp, t);
    if (!external) sm.register(resultOp, (data, sender) => { settle(t, data, sender); });
  }
  return t;
}

/** @returns {boolean} true when the answer belonged to a request here (waiting or late) and was used */
function settle(t, data, sender) {
  const id = data?.requestId;
  if (!id) return false;
  const w = t.waiting.get(id);
  const late = w ? null : t.late.get(id);
  if (!w && !late) return false;                                   // not ours, or already settled
  if (!isFromGM(sender)) return false;                             // only a GM's answer counts
  if (data.userId && data.userId !== globalThis.game?.user?.id) return false;
  if (late) {
    t.late.delete(id);
    if (Date.now() <= late.until) { try { late.fn(data); } catch (err) { console.error('NCM | late GM answer handler failed', err); } }
    return true;
  }
  const more = w.extend ? w.extend(data) : 0;
  if (more) { w.arm(more, true); return true; }                    // not final: keep waiting
  t.waiting.delete(id);
  clearTimeout(w.timer);
  w.resolve(w.map(data));
  return true;
}

/**
 * Send a request and wait for the GM's answer to THAT request.
 * @param {object} sm  the SocketManager (`register(op, fn)`, `emit(op, data)`)
 * @param {string} resultOp  the op the GM answers on
 * @param {(requestId: string) => void} send  emits the request carrying `requestId`
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs=15000]  Infinity = no timeout
 * @param {*|((extended:boolean)=>*)} [opts.timeoutValue=null]  the value on timeout (a function gets whether an
 *   `extend` answer had come in)
 * @param {(data: object) => *} [opts.map]  turns the GM's answer into the resolved value (default: the answer)
 * @param {string} [opts.requestId]  use this id
 * @param {(data: object) => number|false} [opts.extend]
 * @param {(data: object) => void} [opts.onLate]
 * @param {boolean} [opts.external=false]
 * @returns {Promise<*>}  never rejects
 */
export function awaitGmResult(sm, resultOp, send, { timeoutMs = 15000, timeoutValue = null, map = (d) => d, requestId = null, extend = null, onLate = null, external = false } = {}) {
  const valueOnTimeout = (extended) => (typeof timeoutValue === 'function' ? timeoutValue(extended) : timeoutValue);
  // external mode never registers (the op's own handler calls settleGmRequest), so it needs no register()
  if (!sm || (!external && !sm.register) || typeof send !== 'function') return Promise.resolve(valueOnTimeout(false));
  const t = tableFor(sm, resultOp, { external });
  return new Promise((resolve) => {
    const id = requestId || newId();
    // The same id asked again (a delivery retry keeps its message id) replaces the older wait, which is left
    // unsettled exactly as before: resolving it would hand its caller a "no answer" and could queue the mail twice.
    const prior = t.waiting.get(id);
    if (prior) { clearTimeout(prior.timer); t.waiting.delete(id); }
    const w = { resolve, map, extend, timer: null };
    w.arm = (ms, extended) => {
      clearTimeout(w.timer);
      if (!Number.isFinite(ms)) return;
      w.timer = setTimeout(() => {
        if (t.waiting.get(id) !== w) return;
        t.waiting.delete(id);
        if (onLate) t.late.set(id, { fn: onLate, until: Date.now() + LATE_KEEP_MS });
        resolve(valueOnTimeout(extended));
      }, ms);
    };
    w.arm(timeoutMs, false);
    t.waiting.set(id, w);
    try { send(id); } catch { t.waiting.delete(id); clearTimeout(w.timer); resolve(valueOnTimeout(false)); }
  });
}

/**
 * For a result op with its own handler (`external: true`): offer it an answer first.
 * @returns {boolean} true when it belonged to a waiting (or late) request and was used
 */
export function settleGmRequest(sm, resultOp, data, sender) {
  const t = tables.get(sm)?.get(resultOp);
  return t ? settle(t, data, sender) : false;
}

/**
 * End a wait now, resolving it with `value` (the player withdrew). @returns {boolean} whether it was waiting
 */
export function withdrawGmRequest(sm, resultOp, requestId, value = null) {
  const t = tables.get(sm)?.get(resultOp);
  const w = t?.waiting.get(requestId);
  if (!w) return false;
  t.waiting.delete(requestId);
  clearTimeout(w.timer);
  w.resolve(value);
  return true;
}

/** Is this request still waiting? */
export function isGmRequestWaiting(sm, resultOp, requestId) {
  return !!tables.get(sm)?.get(resultOp)?.waiting.has(requestId);
}

/** How many requests are waiting on a result op (diagnostics and sims). */
export function pendingGmRequests(sm, resultOp) {
  return tables.get(sm)?.get(resultOp)?.waiting.size || 0;
}
