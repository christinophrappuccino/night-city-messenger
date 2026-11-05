// test-gm-request — the ONE player → GM round trip (scripts/utils/gmRequest.js, stage 2 batch 4).
// Drives the real helper over the multi-client socket harness (real SocketManager per client, a fake Foundry server
// that stamps the sender), then the real shard-price and shard-unconvert callers.
// Run: node dev/tools/sims/test-gm-request.mjs   (NCM_ROOT=<dir> to check another checkout)
import { readFileSync, existsSync } from 'fs';
import { pathToFileURL, fileURLToPath } from 'url';
import { createWorld } from './lib/socketHarness.mjs';

const ROOT = (process.env.NCM_ROOT || fileURLToPath(new URL('../../../', import.meta.url))).replace(/\\/g, '/').replace(/\/+$/, '');
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
const read = (p) => (existsSync(`${ROOT}/${p}`) ? readFileSync(`${ROOT}/${p}`, 'utf8').replace(/\r\n/g, '\n') : '');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

globalThis.foundry = { utils: { randomID: (() => { let n = 0; return () => `id${++n}`; })(), deepClone: (o) => structuredClone(o) } };
globalThis.ui = { notifications: { info() {}, warn() {}, error() {}, notify() {} } };
const warns = []; const realWarn = console.warn; console.warn = (...a) => warns.push(a.join(' '));

const hasLib = existsSync(`${ROOT}/scripts/utils/gmRequest.js`);
ok(hasLib, 'scripts/utils/gmRequest.js exists');
if (hasLib) {
  const { awaitGmResult, pendingGmRequests } = await imp('scripts/utils/gmRequest.js');
  const world = await createWorld({ users: [
    { id: 'gm1', name: 'GM', isGM: true }, { id: 'p1', name: 'Rache', isGM: false }, { id: 'p2', name: 'Kai', isGM: false },
  ] });
  const gm = world.client('gm1'), p1 = world.client('p1'), p2 = world.client('p2');
  const REQ = 'test:request', RES = 'test:result';
  const seenByGm = [], seenByP2 = [];
  gm.sockets.register(REQ, (data) => seenByGm.push(data));
  p2.sockets.register(REQ, (data) => seenByP2.push(data));   // every client sees every request

  // ── two requests in flight from one client: each gets its own answer ──
  const a = world.as('p1', () => awaitGmResult(p1.sockets, RES, (id) => p1.sockets.emit(REQ, { requestId: id, n: 'a' }), { timeoutMs: 400, timeoutValue: 'timeout' }));
  const b = world.as('p1', () => awaitGmResult(p1.sockets, RES, (id) => p1.sockets.emit(REQ, { requestId: id, n: 'b' }), { timeoutMs: 400, timeoutValue: 'timeout' }));
  world.flush();
  ok(seenByGm.length === 2 && seenByGm[0].requestId !== seenByGm[1].requestId, 'both requests reach the GM, with different ids');
  ok(world.as('p1', () => pendingGmRequests(p1.sockets, RES)) === 2, 'both are waiting');
  // answer them in reverse order
  world.as('gm1', () => gm.sockets.emit(RES, { requestId: seenByGm[1].requestId, v: 'B' }));
  world.as('gm1', () => gm.sockets.emit(RES, { requestId: seenByGm[0].requestId, v: 'A' }));
  world.flush();
  ok((await a)?.v === 'A' && (await b)?.v === 'B', 'two requests in flight each get their own answer (it used to be the last one only)');
  ok(world.as('p1', () => pendingGmRequests(p1.sockets, RES)) === 0, 'nothing is left waiting');

  // ── a forged answer from another player is ignored ──
  const c = world.as('p1', () => awaitGmResult(p1.sockets, RES, (id) => p1.sockets.emit(REQ, { requestId: id, n: 'c' }), { timeoutMs: 300, timeoutValue: 'timeout' }));
  world.flush();
  const seenId = seenByP2.at(-1)?.requestId;
  ok(!!seenId, 'another player can see the request and its id');
  world.as('p2', () => p2.sockets.emit(RES, { requestId: seenId, v: 'FORGED' }));
  world.flush();
  ok(world.as('p1', () => pendingGmRequests(p1.sockets, RES)) === 1, 'an answer from a player does not settle the request');
  world.as('p2', () => p2.rawEmit({ operation: RES, data: { requestId: seenId, v: 'FORGED2' }, sender: 'gm1' }));
  world.flush();
  ok(world.as('p1', () => pendingGmRequests(p1.sockets, RES)) === 1, 'nor does a player writing "sender: gm" into the message (the server says who sent it)');
  world.as('gm1', () => gm.sockets.emit(RES, { requestId: seenId, v: 'REAL' }));
  world.flush();
  ok((await c)?.v === 'REAL', 'the GM\'s real answer still lands afterwards');

  // ── an answer naming another user is ignored ──
  const d = world.as('p1', () => awaitGmResult(p1.sockets, RES, (id) => p1.sockets.emit(REQ, { requestId: id }), { timeoutMs: 150, timeoutValue: 'timeout' }));
  world.flush();
  world.as('gm1', () => gm.sockets.emit(RES, { requestId: seenByGm.at(-1).requestId, userId: 'p2', v: 'for p2' }));
  world.flush();
  ok((await d) === 'timeout', 'an answer addressed to another user is not taken');

  // ── timeout, late answer, a send that throws ──
  const e = world.as('p1', () => awaitGmResult(p1.sockets, RES, (id) => p1.sockets.emit(REQ, { requestId: id }), { timeoutMs: 30, timeoutValue: { decision: 'pending' } }));
  world.flush();
  const lateId = seenByGm.at(-1).requestId;
  ok((await e)?.decision === 'pending', 'no answer in time resolves with the timeout value (never rejects)');
  world.as('gm1', () => gm.sockets.emit(RES, { requestId: lateId, v: 'late' }));
  world.flush();
  ok(world.as('p1', () => pendingGmRequests(p1.sockets, RES)) === 0, 'a late answer is dropped');
  const f = await world.as('p1', () => awaitGmResult(p1.sockets, RES, () => { throw new Error('socket down'); }, { timeoutMs: 1000, timeoutValue: false }));
  ok(f === false, 'a send that throws resolves with the timeout value at once');
  ok((await awaitGmResult(null, RES, () => {}, { timeoutValue: 'nosm' })) === 'nosm', 'no socket manager resolves with the timeout value');

  // ── one handler per result op ──
  ok(!warns.some((w) => /registered twice/.test(w)), 'the helper registered each result op once (no "registered twice" warning)');
  const map = world.as('p1', () => awaitGmResult(p1.sockets, RES, (id) => p1.sockets.emit(REQ, { requestId: id }), { timeoutMs: 300, map: (r) => r.v.toUpperCase() }));
  world.flush(); world.as('gm1', () => gm.sockets.emit(RES, { requestId: seenByGm.at(-1).requestId, v: 'mapped' })); world.flush();
  ok((await map) === 'MAPPED', 'map turns the answer into the resolved value');

  // ── SocketManager warns when a handler replaces another ──
  warns.length = 0;
  world.as('gm1', () => { gm.sockets.register('test:dup', () => 1); gm.sockets.register('test:dup', () => 2); });
  ok(warns.some((w) => /test:dup' was registered twice/.test(w)), 'SocketManager warns when a second handler replaces the first');
  warns.length = 0;
  const same = () => 3;
  world.as('gm1', () => { gm.sockets.register('test:same', same); gm.sockets.register('test:same', same); });
  ok(!warns.some((w) => /test:same/.test(w)), 'registering the same handler again is not a warning');

  // ═══ The real callers ═══
  const { SOCKET_OPS } = await imp('scripts/utils/constants.js');
  // shard pricing: two proposals in flight from one player
  {
    const { requestShardPrice } = await imp('scripts/ui/ShardEncoder/ShardMarket.js');
    const asks = [];
    gm.sockets.register(SOCKET_OPS.SHARD_PRICE_REQUEST, (data) => asks.push(data));
    const setNc = () => { globalThis.game.nightcity = { socketManager: p1.sockets }; };
    const r1 = world.as('p1', () => { setNc(); return requestShardPrice({ item: { id: 'i1' }, actor: { id: 'a1' }, price: 100 }); });
    const r2 = world.as('p1', () => { setNc(); return requestShardPrice({ item: { id: 'i2' }, actor: { id: 'a1' }, price: 900 }); });
    world.flush();
    ok(asks.length === 2, 'both price proposals reach the GM');
    for (const ask of [...asks].reverse()) world.as('gm1', () => gm.sockets.emit(SOCKET_OPS.SHARD_PRICE_RESULT, { requestId: ask.requestId, userId: ask.userId, decision: 'approved', price: ask.price }));
    world.flush();
    const [v1, v2] = [await r1, await r2];
    ok(v1?.price === 100 && v2?.price === 900 && v1.decision === 'approved', `two price proposals at once each get their own verdict (${v1?.price}, ${v2?.price})`);
  }
  // shard unconvert: two items at once
  {
    const { ShardSheetOverride } = await imp('scripts/integrations/ShardSheetOverride.js');
    const asks = [];
    gm.sockets.register(SOCKET_OPS.SHARD_UNCONVERT_REQUEST, (data) => asks.push(data));
    const ask = (id) => world.as('p1', () => { globalThis.game.nightcity = { socketManager: p1.sockets }; return ShardSheetOverride.prototype._requestPlayerUnconvert.call({}, { id, actor: { id: 'a1' } }); });
    const u1 = ask('x1'), u2 = ask('x2');
    world.flush();
    ok(asks.length === 2, 'both unconvert requests reach the GM');
    world.as('gm1', () => gm.sockets.emit(SOCKET_OPS.SHARD_UNCONVERT_RESULT, { requestId: asks.find((q) => q.itemId === 'x2').requestId, success: true }));
    world.as('gm1', () => gm.sockets.emit(SOCKET_OPS.SHARD_UNCONVERT_RESULT, { requestId: asks.find((q) => q.itemId === 'x1').requestId, success: false }));
    world.flush();
    ok((await u1) === false && (await u2) === true, 'two unconvert requests at once each get their own answer');
  }
}

// ═══ Source: nobody registers a result handler per request any more ═══
for (const f of ['scripts/ui/ShardEncoder/ShardMarket.js', 'scripts/integrations/ShardSheetOverride.js', 'scripts/ui/ShardEncoder/ShardEncoderApp.js']) {
  const t = read(f);
  ok(!/register\(SOCKET_OPS\.SHARD_(PRICE|UNCONVERT|CONVERT)_RESULT/.test(t), `${f} no longer registers a result handler itself`);
  ok(/awaitGmResult\(/.test(t), `${f} waits through utils/gmRequest.js`);
}
ok(/registered twice/.test(read('scripts/core/SocketManager.js')), 'SocketManager.register warns on a replaced handler');

// ═══ the options the delivery ack, scheduling and netrun round trips needed (after stage 2) ═══
if (hasLib) {
  const G = await imp('scripts/utils/gmRequest.js');
  const world = await createWorld({ users: [{ id: 'gm1', name: 'GM', isGM: true }, { id: 'p1', name: 'Rache', isGM: false }, { id: 'p2', name: 'Kai', isGM: false }] });
  const gm = world.client('gm1'), p1 = world.client('p1'), p2 = world.client('p2');
  const answer = (op, data) => world.as('gm1', () => gm.sockets.emit(op, data));
  // requestId + extend (the delivery ack: "accepted", then the real answer)
  {
    let sent = null;
    const r = world.as('p1', () => G.awaitGmResult(p1.sockets, 'x:ack', (id) => { sent = id; }, { requestId: 'msg-1', timeoutMs: 60, timeoutValue: (ext) => ({ timeout: true, ext }), extend: (d) => (d.accepted ? 300 : 0) }));
    ok(sent === 'msg-1', 'requestId: the caller\'s id is used');
    answer('x:ack', { requestId: 'msg-1', accepted: true }); world.flush();
    await tick(120);
    ok(world.as('p1', () => G.isGmRequestWaiting(p1.sockets, 'x:ack', 'msg-1')), 'extend: an "accepted" answer keeps it waiting past the first timeout');
    answer('x:ack', { requestId: 'msg-1', success: true }); world.flush();
    ok((await r).success === true, 'extend: the final answer settles it');
    const r2 = world.as('p1', () => G.awaitGmResult(p1.sockets, 'x:ack', () => {}, { requestId: 'msg-2', timeoutMs: 30, timeoutValue: (ext) => ({ timeout: true, ext }), extend: (d) => (d.accepted ? 40 : 0) }));
    answer('x:ack', { requestId: 'msg-2', accepted: true }); world.flush();
    const t2 = await r2;
    ok(t2.timeout && t2.ext === true, 'timeoutValue(extended): a timeout after "accepted" says so');
  }
  // onLate (scheduling: a refusal after the player stopped waiting)
  {
    const late = [];
    const r = world.as('p1', () => G.awaitGmResult(p1.sockets, 'x:sched', () => {}, { requestId: 's-1', timeoutMs: 20, timeoutValue: 'timeout', onLate: (d) => late.push(d.ok) }));
    ok((await r) === 'timeout', 'onLate: the wait still times out');
    answer('x:sched', { requestId: 's-1', ok: false }); world.flush();
    answer('x:sched', { requestId: 's-1', ok: false }); world.flush();
    ok(late.join() === 'false', 'onLate: the late answer is handed over once');
  }
  // Infinity + withdraw (a netrun verdict), and only a GM answers
  {
    const r = world.as('p1', () => G.awaitGmResult(p1.sockets, 'x:net', () => {}, { requestId: 'nr-1', timeoutMs: Infinity, map: (d) => d.choiceId }));
    world.as('p2', () => p2.sockets.emit('x:net', { requestId: 'nr-1', userId: 'p1', choiceId: 'pass' })); world.flush();
    ok(world.as('p1', () => G.isGmRequestWaiting(p1.sockets, 'x:net', 'nr-1')), 'a forged verdict from another player is ignored (the netrun relay had no GM check before)');
    ok(world.as('p1', () => G.withdrawGmRequest(p1.sockets, 'x:net', 'nr-1', 'withdrawn')) === true && (await r) === 'withdrawn', 'withdraw: ends the wait with the given value');
    ok(world.as('p1', () => G.withdrawGmRequest(p1.sockets, 'x:net', 'nr-1', 'again')) === false, 'withdrawing twice does nothing');
  }
  // external: the op keeps its own handler, which offers answers first
  {
    const own = [];
    world.as('p1', () => p1.sockets.register('x:ext', (data, sender) => { if (!world.as('p1', () => G.settleGmRequest(p1.sockets, 'x:ext', data, sender))) own.push(data.requestId); }));
    const r = world.as('p1', () => G.awaitGmResult(p1.sockets, 'x:ext', () => {}, { requestId: 'e-1', timeoutMs: 200, external: true }));
    answer('x:ext', { requestId: 'e-1', ok: 1 }); answer('x:ext', { requestId: 'held-9', ok: 1 }); world.flush();
    ok((await r).ok === 1 && own.join() === 'held-9', 'external: a waiting request takes its answer; anything else falls through to the op\'s own work');
  }
}

// ═══ the three callers ═══
{
  const MS = read('scripts/services/MessageService.js'), SS = read('scripts/services/SchedulingService.js'), NR = read('scripts/ui/content/NetResolve.js'), SH = read('scripts/integrations/SocketHandlers.js');
  ok(/return awaitGmResult\(this\.socketManager, SOCKET_OPS\.MESSAGE_DELIVERED, send, \{\s*requestId: messageId/.test(MS) && /settleGmRequest\(this\.socketManager, SOCKET_OPS\.MESSAGE_DELIVERED, keyed, sender\)/.test(MS) && !/_pendingRelays/.test(MS), 'the delivery ack is on the shared round trip (keyed by message id, external handler)');
  ok(/requestId: data\?\.messageId, userId: senderUserId/.test(MS), 'the GM\'s delivery answer carries the round trip\'s keys');
  ok(/awaitGmResult\(this\.socketManager, SOCKET_OPS\.SCHEDULE_RESULT,/.test(SS) && !/_waiters|_onResult/.test(SS), 'scheduling requests are on the shared round trip (its own answer op)');
  ok(/awaitGmResult\(sm, SOCKET_OPS\.NET_RESOLVE_RESULT,/.test(NR) && /timeoutMs: Infinity/.test(NR) && !/register\(SOCKET_OPS\.NET_RESOLVE_RESULT/.test(SH), 'the netrun verdict is on the shared round trip (no timeout; its old unchecked handler is gone)');
}

console.warn = realWarn;
console.log(`test-gm-request: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
