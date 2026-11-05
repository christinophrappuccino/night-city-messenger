/**
 * Ask the GM and wait for the answer — the ONE player → GM round trip (stage 2, batch 4).
 * @file scripts/utils/gmRequest.js
 * @module night-city-messenger
 *
 * A player's client often needs the GM to do something and say how it went: convert a shard, approve a price,
 * remove shard data. The pattern is always the same — send a request with an id, wait for a result op carrying that
 * id, give up after a while. It had been written separately in several places, and two copies registered a fresh
 * result handler PER REQUEST. SocketManager keeps one handler per op, so a second request from the same client
 * replaced the first one's handler and the first request then waited out its timeout ("the GM never answered").
 *
 * Here there is ONE handler per result op (registered the first time it is needed) and a table of waiting requests
 * keyed by request id. An answer is accepted only when:
 *   - it came from a GM (the server-checked sender, never a field in the message — audit SEC-01). Every client sees
 *     every request and its id, so without this a player could answer another player's request;
 *   - it is for this user, when the answer names one (`userId`);
 *   - its request is still waiting (a late answer after the timeout is dropped).
 *
 * The request's GM-side handler must echo `requestId` (and `userId`, when it names one) in its result.
 */

import { isFromGM } from './helpers.js';

/** per SocketManager: resultOp → Map(requestId → { resolve, timer, map }) */
const waiting = new WeakMap();

const newId = () => (globalThis.foundry?.utils?.randomID ? globalThis.foundry.utils.randomID(16) : Math.random().toString(36).slice(2, 18));

function tableFor(sm, resultOp) {
  let ops = waiting.get(sm);
  if (!ops) { ops = new Map(); waiting.set(sm, ops); }
  let table = ops.get(resultOp);
  if (!table) {
    table = new Map();
    ops.set(resultOp, table);
    sm.register(resultOp, (data, sender) => {
      const w = table.get(data?.requestId);
      if (!w) return;                                                // not ours, or already settled
      if (!isFromGM(sender)) return;                                 // only a GM's answer counts
      if (data.userId && data.userId !== globalThis.game?.user?.id) return;
      table.delete(data.requestId);
      clearTimeout(w.timer);
      w.resolve(w.map(data));
    });
  }
  return table;
}

/**
 * Send a request and wait for the GM's answer to THAT request.
 * @param {object} sm  the SocketManager (`register(op, fn)`, `emit(op, data)`)
 * @param {string} resultOp  the op the GM answers on
 * @param {(requestId: string) => void} send  emits the request carrying `requestId`
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs=15000]
 * @param {*} [opts.timeoutValue=null]  what the promise resolves to when no answer arrives in time
 * @param {(data: object) => *} [opts.map]  turns the GM's answer into the resolved value (default: the answer itself)
 * @returns {Promise<*>}  never rejects
 */
export function awaitGmResult(sm, resultOp, send, { timeoutMs = 15000, timeoutValue = null, map = (d) => d } = {}) {
  if (!sm?.register || typeof send !== 'function') return Promise.resolve(timeoutValue);
  const table = tableFor(sm, resultOp);
  return new Promise((resolve) => {
    const requestId = newId();
    const timer = setTimeout(() => { if (table.delete(requestId)) resolve(timeoutValue); }, timeoutMs);
    table.set(requestId, { resolve, timer, map });
    try { send(requestId); } catch (err) { table.delete(requestId); clearTimeout(timer); resolve(timeoutValue); }
  });
}

/** How many requests are waiting on a result op (diagnostics and sims). */
export function pendingGmRequests(sm, resultOp) {
  return waiting.get(sm)?.get(resultOp)?.size || 0;
}
