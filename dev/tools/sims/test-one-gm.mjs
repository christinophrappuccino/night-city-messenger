// Sim: one GM handles each player request (audit remediation B1, INT-01).
//
// With two GM users connected (a GM and an Assistant, or one GM on two devices),
// every player→GM relay that only checked `game.user.isGM` ran on BOTH: mail
// delivered twice, traces and heat logged twice, plants fired twice, macros run
// twice, two shard journals. The fix is isPrimaryGM() (helpers.js) — the one GM
// `game.users.activeGM` names — on every request handler that DOES something, on
// every timed reaper (checked per tick, so the other GM takes over when the
// active one leaves), and on the migration runner.
//
// Drives the REAL SocketHandlers.register() on three simulated clients
// (lib/socketHarness.mjs: a full GM, an Assistant GM, a player) with counting
// service stand-ins, then the real reap functions.
import fs from 'fs';
import { pathToFileURL, fileURLToPath } from 'url';
import { createWorld } from './lib/socketHarness.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const read = (p) => fs.readFileSync(`${ROOT}/${p}`, 'utf8');
const load = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };

globalThis.foundry = { utils: { deepClone: (o) => JSON.parse(JSON.stringify(o)), mergeObject: (a, b) => ({ ...a, ...b }), randomID: () => 'rid', debounce: (f) => f } };
globalThis.Hooks = { on() {}, off() {}, once() {}, call() {}, callAll() {} };
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3 } };
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };

const { SOCKET_OPS } = await load('scripts/utils/constants.js');
const { SocketHandlers } = await load('scripts/integrations/SocketHandlers.js');
const { isPrimaryGM } = await load('scripts/utils/helpers.js');

const world = await createWorld({
  users: [
    { id: 'gm1', name: 'GM', isGM: true, role: 4 },
    { id: 'gm2', name: 'Assistant', isGM: true, role: 3 },
    { id: 'p1', name: 'Rache', isGM: false },
  ],
  actors: [{ id: 'a-v', name: 'V', owners: ['p1'] }],
});

// A terminal item every client can resolve.
const terminal = { id: 'term1', uuid: 'Item.term1', name: 'WS-7F', getFlag: (m, k) => (k === 'isTerminal' ? true : null) };
const shardItem = { id: 'it-chip', name: 'Chip' };
globalThis.fromUuidSync = (u) => (u === terminal.uuid ? terminal : null);
globalThis.fromUuid = async (u) => globalThis.fromUuidSync(u);

// Counting service stand-ins, one set per GM client.
const calls = { gm1: [], gm2: [] };
for (const id of ['gm1', 'gm2']) {
  const c = world.client(id);
  const hit = (name) => async () => { calls[id].push(name); return { success: true, count: 1 }; };
  // a-v is p1's character (shard relays check ownership since A3b)
  c.game.actors = { get: (aid) => (aid === 'a-v' ? { id: 'a-v', name: 'V', items: { get: () => shardItem }, testUserPermission: (u) => u.id === 'p1' || !!u.isGM } : null), [Symbol.iterator]: function* () {} };
  const prevGet = c.game.settings?.get?.bind(c.game.settings);
  c.game.settings = { ...(c.game.settings || {}), get: (m, k) => (k === 'encoderConfig' ? { enabled: true } : prevGet?.(m, k)) };
  c.game.items = { get: () => null };
  c.game.nightcity = {
    socketManager: c.sockets,
    eventBus: { emit() {} },
    messageService: { handleMessageRelay: hit('mail-relay'), handleAnonTraceRequest: hit('anon-trace'), receiveQueueSync: hit('queue-sync'), handleDeliveryConfirmation() {}, handleMessageNotification() {} },
    terminalService: {
      getConfig: () => ({ connection: { allowPlayerSwitching: true } }),
      setUplink: hit('uplink'), applySessionUpdate: hit('session'),
      exfilToInbox: hit('exfil'), exfilSaveFrame: hit('exfil'), exfilForward: hit('exfil'), exfilWipe: hit('exfil'), exfilToShard: hit('exfil'),
    },
    traceService: { handleTraceRequest: hit('trace') },
    dataShardService: { convertToDataShard: hit('shard-convert'), addMessage: hit('shard-entry') },
    securityService: { receiveReport: hit('security-report') },
    accessLogService: { _push: () => calls[id].push('access-log') },
  };
  world.as(id, () => SocketHandlers.register());
}
world.client('p1').game.nightcity = { socketManager: world.client('p1').sockets, messageService: {} };
// Code that continues after an `await` runs with whatever `game` is global then
// (see the harness header). The active GM is the one that continues, so make it
// the baseline.
globalThis.game = world.client('gm1').game;

const send = (op, data) => { world.as('p1', () => world.client('p1').sockets.emit(op, data)); world.flush(); };
const count = (id, name) => calls[id].filter((n) => n === name).length;
const settle = () => new Promise((r) => setTimeout(r, 0));

// ═══ 1. Each action-taking request runs on exactly one GM ═══
const cases = [
  ['mail-relay', SOCKET_OPS.MESSAGE_RELAY, { messageId: 'm1', fromActorId: 'a-v' }],
  ['anon-trace', SOCKET_OPS.ANON_TRACE_REQUEST, { messageId: 'm1' }],
  ['uplink', SOCKET_OPS.TERMINAL_NET_REQUEST, { itemUuid: terminal.uuid, networkId: 'net' }],
  ['session', SOCKET_OPS.TERMINAL_SESSION_REQUEST, { itemUuid: terminal.uuid, actorId: 'a-v', updates: {} }],
  ['exfil', SOCKET_OPS.TERMINAL_EXFIL_REQUEST, { itemUuid: terminal.uuid, accountId: 'acc', messageIds: ['x'], dest: 'inbox', targetActorId: 'a-v' }],
  ['trace', SOCKET_OPS.TRACE_REQUEST, { actorId: 'a-v' }],
  ['shard-convert', SOCKET_OPS.SHARD_CONVERT_REQUEST, { requestId: 'r', itemId: 'it-chip', actorId: 'a-v', config: {} }],
];
for (const [name, op, data] of cases) {
  send(op, data);
  await settle();
  const n1 = count('gm1', name), n2 = count('gm2', name);
  ok(n1 + n2 === 1, `${name}: handled once across two GMs (gm1 ${n1}, Assistant ${n2})`);
  ok(n1 === 1, `${name}: the full GM (the active GM) is the one that handled it`);
}

// ═══ 2. State mirrors still reach EVERY GM (their own view) ═══
send(SOCKET_OPS.MESSAGE_QUEUE_SYNC, { queue: [] });
send(SOCKET_OPS.SECURITY_REPORT, { actorId: 'a-v' });
send(SOCKET_OPS.LOG_RELAY, { type: 'test' });
await settle();
ok(count('gm1', 'queue-sync') === 1 && count('gm2', 'queue-sync') === 1, 'held-mail report reaches both GMs (each shows it in its own Outbox)');
ok(count('gm1', 'security-report') === 1 && count('gm2', 'security-report') === 1, 'security report reaches both GMs (each shows it in its own admin view)');
ok(count('gm1', 'access-log') === 1 && count('gm2', 'access-log') === 1, 'access-log relay reaches both GMs (unchanged in B1; its save is a B4 item)');

// ═══ 3. Hand-over: the active GM leaves, the other GM takes over ═══
world.client('gm1').connected = false;
send(SOCKET_OPS.TRACE_REQUEST, { actorId: 'a-v' });
await settle();
ok(count('gm2', 'trace') === 1, 'with the full GM offline, the Assistant handles requests');
world.client('gm1').connected = true;

// ═══ 4. The other gated requests (dynamic imports) carry the same gate ═══
{
  const src = read('scripts/integrations/SocketHandlers.js');
  for (const op of ['BANK_SIPHON_REQUEST', 'CONTENT_UPDATE_REQUEST', 'PAYLOAD_EFFECT_REQUEST', 'TERMINAL_RESIDENT_REQUEST', 'SHARD_PRICE_REQUEST', 'SHARD_UNCONVERT_REQUEST']) {
    const at = src.indexOf(`register(SOCKET_OPS.${op},`);
    ok(at >= 0 && /if \(!isPrimaryGM\(\)\) return;/.test(src.slice(at, at + 260)), `${op}: gated to one GM`);
  }
  for (const op of ['MESSAGE_QUEUE_SYNC', 'SECURITY_REPORT', 'LOG_RELAY', 'TRACE_COMPLETE']) {
    const at = src.indexOf(`register(SOCKET_OPS.${op},`);
    ok(at >= 0 && !/isPrimaryGM\(\)/.test(src.slice(at, at + 200)), `${op}: still reaches every GM (state mirror)`);
  }
}

// ═══ 5. Reapers and the migration runner check per call ═══
{
  const body = (file, sig) => { const s = read(file); const i = s.indexOf(sig); return s.slice(i, i + 220); };
  const reapers = [
    ['scripts/services/MessageService.js', 'async reapSelfDestruct() {'],
    ['scripts/ui/content/SiphonFlow.js', 'export async function reapExpiredPayloads() {'],
    ['scripts/services/TerminalService.js', 'async reapResidents() {'],
    ['scripts/services/TerminalService.js', 'async reapForgedAccounts() {'],
    ['scripts/services/TraceService.js', 'async reapCountdowns() {'],
    ['scripts/core/MigrationRunner.js', 'export async function runMigrations() {'],
  ];
  for (const [f, sig] of reapers) ok(/if \(!isPrimaryGM\(\)\) return/.test(body(f, sig)), `${sig.replace(/\s*\{$/, '')}: one GM, checked each run`);

  // drive one for real: the Assistant's countdown reaper does nothing while the full GM is active
  const { TraceService } = await load('scripts/services/TraceService.js');
  let touched = 0;
  const fake = { _nowMs: () => 1e15, getCountdowns: () => { touched++; return []; } };
  await world.as('gm2', () => TraceService.prototype.reapCountdowns.call(fake));
  ok(touched === 0, 'reapCountdowns on the Assistant: returns before touching anything');
  await world.as('gm1', () => TraceService.prototype.reapCountdowns.call(fake));
  ok(touched === 1, 'reapCountdowns on the active GM: runs');
  ok(world.as('gm2', () => isPrimaryGM()) === false && world.as('gm1', () => isPrimaryGM()) === true, 'isPrimaryGM agrees with the active GM');
}

console.log(`test-one-gm: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
