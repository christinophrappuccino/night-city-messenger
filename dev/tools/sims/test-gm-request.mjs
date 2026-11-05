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

console.warn = realWarn;
console.log(`test-gm-request: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
