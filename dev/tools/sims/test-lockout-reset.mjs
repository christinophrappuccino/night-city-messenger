// A GM "Reset" (Admin → Terminals, shard relock, network reset logins) must unlock the target on
// EVERY client — the lockout a player hit lives on their own client (tester, 2026-10-29).
// Drives the real SecurityService methods on two fake clients joined by a fake socket.
globalThis.game = { nightcity: {} };
globalThis.foundry = { utils: { deepClone: (o) => structuredClone(o) } };
globalThis.Hooks = { on() {}, off() {}, callAll() {} };
const { SecurityService } = await import('../../../scripts/services/SecurityService.js');
const { SOCKET_OPS } = await import('../../../scripts/utils/constants.js');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const P = SecurityService.prototype;
const mk = () => { const o = Object.create(P); o._states = new Map(); o._remote = new Map(); o._timers = new Map(); o._clearTimer = () => {}; return o; };
const gm = mk(), player = mk();
const sent = [];
game.nightcity.socketManager = { emit: (op, data) => { sent.push(op); if (op === SOCKET_OPS.SECURITY_CLEAR) player.receiveClear(data); } };
const T = 'term1::acctA';
player._states.set('pc1::' + T, { targetId: T, attempts: 3, lockoutUntil: 9e15 });
player._states.set('pc1::other', { targetId: 'other', attempts: 1, lockoutUntil: 0 });
gm._remote.set('pc1::' + T, { attempts: 3, lockoutUntil: 9e15 });
gm.resetAllForTarget(T);
ok(!gm._remote.has('pc1::' + T), 'the GM drops its mirrored copy too');
ok(sent.includes(SOCKET_OPS.SECURITY_CLEAR), 'the reset is broadcast');
ok(!player._states.has('pc1::' + T), 'the player client unlocks');
ok(player._states.has('pc1::other'), 'other targets are untouched');
sent.length = 0; gm.resetAllForTarget(T, { broadcast: false });
ok(!sent.length, 'broadcast can be turned off');
console.log(`test-lockout-reset: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
