// Sim: socket sender identity (audit remediation A1, finding SEC-01).
//
// Before A1 the SocketManager trusted `message.sender`, a field the EMITTING
// client writes, so any player could claim to be the GM or another player.
// Foundry's server appends the authenticated user id as the listener's second
// argument; A1 routes that id to every handler instead.
//
// Drives the REAL SocketManager on several simulated clients through
// lib/socketHarness.mjs (a fake server with Foundry 12's forwarding rule), plus
// the new helpers (isPrimaryGM / isFromGM / userOwnsActor) and the SOCKET_TRUST
// table. Checks: forged senders are ignored (T1), honest player→GM requests,
// GM→player acknowledgements and player↔player peer traffic still arrive with
// the right sender, data-only handlers are unaffected, malformed packets are
// dropped quietly, and every op has exactly one trust class (T16).
import { pathToFileURL, fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { createWorld } from './lib/socketHarness.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };

// helpers.js reads a few Foundry globals lazily; give it what it touches at import.
globalThis.foundry ??= { utils: { deepClone: (o) => JSON.parse(JSON.stringify(o)), mergeObject: (a, b) => ({ ...a, ...b }) } };
globalThis.Hooks ??= { on: () => {}, once: () => {}, off: () => {}, callAll: () => {} };
globalThis.CONST ??= { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 } };

const { SOCKET_OPS, SOCKET_TRUST } = await import(pathToFileURL(`${ROOT}/scripts/utils/constants.js`).href);
const { isPrimaryGM, isFromGM, userOwnsActor } = await import(pathToFileURL(`${ROOT}/scripts/utils/helpers.js`).href);

const USERS = [
  { id: 'gm1', name: 'GM', isGM: true },
  { id: 'gm2', name: 'Assistant', isGM: true, role: 3 },
  { id: 'p1', name: 'Rache', isGM: false },
  { id: 'p2', name: 'Aegaeon', isGM: false },
  { id: 'px', name: 'Hostile', isGM: false },
];
const ACTORS = [
  { id: 'a-v', name: 'V', owners: ['p1'] },
  { id: 'a-judy', name: 'Judy', owners: ['p2'] },
  { id: 'a-npc', name: 'Rogue', owners: [] },
];

// ═══ 1. The listener takes the server's id ═══
{
  const world = await createWorld({ users: USERS, actors: ACTORS });
  const fns = world.client('gm1').listeners.get('module.night-city-messenger') || [];
  ok(fns.length === 1, 'SocketManager registers exactly one module listener');
  ok(fns[0]?.length === 2, 'the listener accepts (message, userId)');
}

// ═══ 2. T1 — a forged payload sender is ignored ═══
{
  const world = await createWorld({ users: USERS, actors: ACTORS });
  const seen = [];
  world.as('gm1', () => world.client('gm1').sockets.register(SOCKET_OPS.MESSAGE_RELAY, (data, sender) => seen.push({ data, sender })));
  world.client('px').rawEmit({ operation: SOCKET_OPS.MESSAGE_RELAY, data: { subject: 'forged' }, sender: 'gm1' });
  world.client('px').rawEmit({ operation: SOCKET_OPS.MESSAGE_RELAY, data: { subject: 'as p1' }, sender: 'p1' });
  world.flush();
  ok(seen.length === 2, 'both forged packets still reach the GM handler');
  ok(seen.every((s) => s.sender === 'px'), 'the handler sees the REAL sender (px), never the payload sender');
  ok(world.as('gm1', () => !isFromGM(seen[0].sender)), 'isFromGM(real sender) is false for the forger claiming to be the GM');
}

// ═══ 3. A packet claiming to be from the receiver itself is not dropped as "own" ═══
// (the old rule skipped any packet whose payload sender equalled the receiver, so
// a forger could silence a client; now only a real loopback is skipped)
{
  const world = await createWorld({ users: USERS, actors: ACTORS });
  const seen = [];
  world.as('p1', () => world.client('p1').sockets.register(SOCKET_OPS.MESSAGE_DELIVERED, (d, s) => seen.push(s)));
  world.client('px').rawEmit({ operation: SOCKET_OPS.MESSAGE_DELIVERED, data: {}, sender: 'p1' });
  world.flush();
  ok(seen.length === 1 && seen[0] === 'px', 'a packet whose payload names the receiver is delivered with its real sender');
  // a genuine loopback (same id from the transport) is still ignored
  const seenLoop = [];
  world.as('p1', () => {
    world.client('p1').sockets.register(SOCKET_OPS.MESSAGE_NOTIFY, () => seenLoop.push(1));
    world.client('p1').sockets._onMessage({ operation: SOCKET_OPS.MESSAGE_NOTIFY, data: {} }, 'p1');
  });
  ok(seenLoop.length === 0, 'a real loopback (transport id = own id) is ignored');
}

// ═══ 4. Honest flows keep working ═══
{
  const world = await createWorld({ users: USERS, actors: ACTORS });
  const gmGot = [], p1Got = [], p2Got = [], gmPeer = [], dataOnly = [];

  // player → GM request
  world.as('gm1', () => world.client('gm1').sockets.register(SOCKET_OPS.MESSAGE_RELAY, (data, sender) => gmGot.push({ data, sender })));
  // GM → player acknowledgement
  world.as('p1', () => world.client('p1').sockets.register(SOCKET_OPS.MESSAGE_DELIVERED, (data, sender) => {
    if (data.forUserId !== game.user.id) return;          // what MessageService does
    p1Got.push({ data, sender, fromGM: isFromGM(sender) });
  }));
  // player ↔ player peer (a call line), the GM also listens
  world.as('p2', () => world.client('p2').sockets.register(SOCKET_OPS.CALL, (data, sender) => p2Got.push({ data, sender })));
  world.as('gm1', () => world.client('gm1').sockets.register(SOCKET_OPS.CALL, (data, sender) => gmPeer.push({ data, sender })));
  // a handler written as (data) only, like most of SocketHandlers.js
  world.as('p2', () => world.client('p2').sockets.register(SOCKET_OPS.MESSAGE_STATUS_UPDATE, (data) => dataOnly.push(data)));

  world.as('p1', () => world.client('p1').sockets.emit(SOCKET_OPS.MESSAGE_RELAY, { messageId: 'm1', fromActorId: 'a-v' }));
  world.flush();
  ok(gmGot.length === 1 && gmGot[0].sender === 'p1' && gmGot[0].data.messageId === 'm1', 'player→GM request arrives with sender p1 and its data');

  world.as('gm1', () => world.client('gm1').sockets.emit(SOCKET_OPS.MESSAGE_DELIVERED, { messageId: 'm1', forUserId: 'p1', success: true }));
  world.flush();
  ok(p1Got.length === 1 && p1Got[0].sender === 'gm1' && p1Got[0].fromGM && p1Got[0].data.success, 'GM→player acknowledgement arrives, sender is a GM');

  world.as('p1', () => world.client('p1').sockets.emit(SOCKET_OPS.CALL, { type: 'line', callId: 'c1', text: 'hey' }));
  world.flush();
  ok(p2Got.length === 1 && p2Got[0].sender === 'p1' && p2Got[0].data.text === 'hey', 'peer call line reaches the other player with sender p1');
  ok(gmPeer.length === 1 && gmPeer[0].sender === 'p1', 'the GM also receives the peer packet with sender p1');

  world.as('p1', () => world.client('p1').sockets.emit(SOCKET_OPS.MESSAGE_STATUS_UPDATE, { actorId: 'a-v', messageId: 'm1' }));
  world.flush();
  ok(dataOnly.length === 1 && dataOnly[0].messageId === 'm1', 'a (data)-only handler still gets the same data');

  // the emitter never receives its own packet
  ok(!world.log.some((e) => e.from === e.to), 'no client ever receives its own emit');
}

// ═══ 5. Missing transport id → sender null, handler still runs (data-only handlers unaffected) ═══
{
  const world = await createWorld({ users: USERS, actors: ACTORS });
  const seen = [];
  world.as('gm1', () => {
    world.client('gm1').sockets.register(SOCKET_OPS.TRACE_REQUEST, (d, s) => seen.push({ d, s }));
    world.client('gm1').sockets._onMessage({ operation: SOCKET_OPS.TRACE_REQUEST, data: { x: 1 } });
  });
  ok(seen.length === 1 && seen[0].s === null && seen[0].d.x === 1, 'no transport id → handler runs with sender null');
}

// ═══ 6. Malformed packets are dropped quietly; a throwing handler is contained ═══
{
  const world = await createWorld({ users: USERS, actors: ACTORS });
  let calls = 0, after = 0;
  world.as('gm1', () => {
    const sm = world.client('gm1').sockets;
    sm.register(SOCKET_OPS.SECURITY_REPORT, () => { calls++; throw new Error('boom'); });
    sm.register(SOCKET_OPS.TRACE_REQUEST, () => { after++; });
  });
  for (const bad of [null, undefined, 'string', 42, { operation: 5 }, { data: {} }]) world.client('px').rawEmit(bad);
  world.client('px').rawEmit({ operation: SOCKET_OPS.SECURITY_REPORT, data: {} });
  world.client('px').rawEmit({ operation: SOCKET_OPS.TRACE_REQUEST, data: {} });
  let threw = false;
  try { world.flush(); } catch { threw = true; }
  ok(!threw, 'malformed packets and a throwing handler never break delivery');
  ok(calls === 1 && after === 1, 'the next packet after a throwing handler is still handled');
}

// ═══ 7. Helpers: isPrimaryGM / isFromGM / userOwnsActor ═══
{
  const world = await createWorld({ users: USERS, actors: ACTORS });
  ok(world.as('gm1', () => isPrimaryGM()) === true, 'isPrimaryGM: the active GM (full GM) → true');
  ok(world.as('gm2', () => isPrimaryGM()) === false, 'isPrimaryGM: a second GM (Assistant) → false');
  ok(world.as('p1', () => isPrimaryGM()) === false, 'isPrimaryGM: a player → false');
  world.client('gm1').connected = false;
  ok(world.as('gm2', () => isPrimaryGM()) === true, 'isPrimaryGM: the Assistant becomes primary when the full GM is offline');
  world.client('gm1').connected = true;

  ok(world.as('p1', () => isFromGM('gm2')) === true, 'isFromGM: an Assistant counts as a GM');
  ok(world.as('p1', () => isFromGM('p2')) === false, 'isFromGM: a player is not');
  ok(world.as('p1', () => isFromGM(null)) === false && world.as('p1', () => isFromGM('nobody')) === false, 'isFromGM: null / unknown → false');

  ok(world.as('gm1', () => userOwnsActor('p1', 'a-v')) === true, 'userOwnsActor: owner by id');
  ok(world.as('gm1', () => userOwnsActor('p1', game.actors.get('a-v'))) === true, 'userOwnsActor: owner by Actor');
  ok(world.as('gm1', () => userOwnsActor('p2', 'a-v')) === false, "userOwnsActor: another player's character → false");
  ok(world.as('gm1', () => userOwnsActor('p1', 'a-npc')) === false, 'userOwnsActor: an unowned NPC → false');
  ok(world.as('gm1', () => userOwnsActor('gm2', 'a-npc')) === true, 'userOwnsActor: any GM owns every actor');
  ok(world.as('gm1', () => userOwnsActor(null, 'a-v')) === false && world.as('gm1', () => userOwnsActor('p1', 'gone')) === false, 'userOwnsActor: missing user / actor → false');
}

// ═══ 8. T16 — every op has exactly one trust class ═══
{
  const ops = Object.keys(SOCKET_OPS), trust = Object.keys(SOCKET_TRUST);
  const CLASSES = new Set(['request', 'result', 'peer', 'unused']);
  ok(Object.isFrozen(SOCKET_TRUST), 'SOCKET_TRUST is frozen');
  ok(ops.every((k) => k in SOCKET_TRUST), `every SOCKET_OPS key has a trust class (missing: ${ops.filter((k) => !(k in SOCKET_TRUST)).join(', ') || 'none'})`);
  ok(trust.every((k) => k in SOCKET_OPS), `no trust entry for an unknown op (extra: ${trust.filter((k) => !(k in SOCKET_OPS)).join(', ') || 'none'})`);
  ok(Object.values(SOCKET_TRUST).every((v) => CLASSES.has(v)), 'every trust class is request / result / peer / unused');

  // 'unused' ops have no handler; every handler's op is not 'unused'
  const files = ['scripts/integrations/SocketHandlers.js', 'scripts/init/registerCallSystem.js', 'scripts/init/registerNetworkSystem.js',
    'scripts/init/registerWatchSystem.js', 'scripts/services/SchedulingService.js', 'scripts/integrations/ShardSheetOverride.js',
    'scripts/ui/ShardEncoder/ShardEncoderApp.js', 'scripts/ui/ShardEncoder/ShardMarket.js', 'scripts/ui/content/NetResolve.js'];   // NetResolve: its answer op is gmRequest's
  const registered = new Set();
  for (const f of files) for (const m of readFileSync(`${ROOT}/${f}`, 'utf8').matchAll(/(?:register\(\s*|awaitGmResult\([^,]+,\s*)SOCKET_OPS\.([A-Z_0-9]+)/g)) registered.add(m[1]);   // awaitGmResult registers its result op (utils/gmRequest.js)
  const unusedButHandled = [...registered].filter((k) => SOCKET_TRUST[k] === 'unused');
  const handledButMissing = ops.filter((k) => SOCKET_TRUST[k] !== 'unused' && !registered.has(k));
  ok(unusedButHandled.length === 0, `no 'unused' op has a handler (${unusedButHandled.join(', ') || 'ok'})`);
  ok(handledButMissing.length === 0, `every op not marked 'unused' has a handler (${handledButMissing.join(', ') || 'ok'})`);
}

// ═══ 9. Static guards: nothing routes on the payload's sender again ═══
{
  const sm = readFileSync(`${ROOT}/scripts/core/SocketManager.js`, 'utf8');
  const code = sm.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  ok(/game\.socket\.on\([^,]+,\s*\(\s*message\s*,\s*userId\s*\)/.test(code), 'SocketManager listener is (message, userId)');
  ok(!/message\.sender|\{\s*[^}]*\bsender\b[^}]*\}\s*=\s*message/.test(code), 'SocketManager never reads message.sender');
  const watch = readFileSync(`${ROOT}/scripts/init/registerWatchSystem.js`, 'utf8');
  ok(/register\(SOCKET_OPS\.WATCH,\s*\(data,\s*sender\)\s*=>[\s\S]{0,80}onSocket\(data,\s*sender\)/.test(watch), 'WATCH handler passes the real sender to WatchService');
  const calls = readFileSync(`${ROOT}/scripts/init/registerCallSystem.js`, 'utf8');
  ok(/register\(SOCKET_OPS\.PAYPHONE,\s*\(data,\s*sender\)\s*=>\s*game\.nightcity\.payphoneService\.handleSocket\(data,\s*sender\)/.test(calls), 'PAYPHONE handler passes the real sender to PayphoneService');
  // no script reads a sender id out of a socket payload instead of the handler argument
  const offenders = [];
  for (const f of files2()) { const s = readFileSync(`${ROOT}/${f}`, 'utf8'); if (/\b(data|message|msg|payload)\.sender\b/.test(s)) offenders.push(f); }
  ok(offenders.length === 0, `no script reads payload.sender (${offenders.join(', ') || 'ok'})`);
}

function files2() {
  return ['scripts/integrations/SocketHandlers.js', 'scripts/services/CallService.js', 'scripts/services/ConversationService.js',
    'scripts/services/WatchService.js', 'scripts/services/PayphoneService.js', 'scripts/services/MessageService.js',
    'scripts/services/SecurityService.js', 'scripts/services/OverheardService.js', 'scripts/services/EmergencyService.js',
    'scripts/services/NetworkService.js', 'scripts/services/SchedulingService.js', 'scripts/init/registerNetworkSystem.js'];
}

console.log(`test-socket-identity: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
