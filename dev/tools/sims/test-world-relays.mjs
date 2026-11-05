// Sim: world-system relays check who is asking (audit remediation A3e: SEC-21, SEC-22).
//
// NETWORK_NODE_REQUEST let anyone jam, tap or backdoor any node, give moves back, plant programs in
// someone else's name; TRACE_REQUEST forged trace rows and heat (and fired resident triggers);
// LOG_RELAY wrote any access-log row; CALL_LOG_REQUEST wrote call-log pages into any inbox;
// CALL_EMERGENCY let a player trigger arrival banners and auto-calls, or register a team that
// arrives at once; an overheard Enhance jumped straight to 100; a call's withheld caller could be
// traced by anyone; anyone could withdraw someone else's GM adjudication. Each is now checked on
// the GM side against the server-verified sender.
import { readFileSync } from 'fs';
import { pathToFileURL, fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const load = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
const read = (p) => readFileSync(`${ROOT}/${p}`, 'utf8');
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };
const MOD = 'night-city-messenger';

const users = { gm: { id: 'gm', name: 'GM', isGM: true }, p1: { id: 'p1', name: 'Rache', isGM: false, viewedScene: 'sc1' }, p2: { id: 'p2', name: 'Kaz', isGM: false, viewedScene: 'sc2' } };
const actor = (id, name, owner) => ({ id, name, hasPlayerOwner: true, testUserPermission: (u) => !!u.isGM || u.id === owner, getFlag: () => null });
const actors = { a1: actor('a1', 'V', 'p1'), a2: actor('a2', 'Judy', 'p2') };
const NOW = 1_000_000_000;
globalThis.game = {
  user: users.gm,
  users: { get: (id) => users[id] ?? null, activeGM: users.gm, filter: (fn) => Object.values(users).filter(fn), find: (fn) => Object.values(users).find(fn) },
  actors: Object.assign(Object.values(actors), { get: (id) => actors[id] ?? null }),
  settings: { get: () => undefined }, i18n: { localize: (s) => s },
  journal: [], scenes: [], messages: [], macros: [], combat: null,
  nightcity: {},
};
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 } };
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
globalThis.Hooks = { on() {}, off() {}, once() {}, call() {}, callAll() {} };
globalThis.CONFIG = {};
globalThis.foundry = { utils: { deepClone: (o) => JSON.parse(JSON.stringify(o)), mergeObject: (a, b) => ({ ...a, ...b }), randomID: () => 'rnd' }, applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (B) => B }, instances: new Map() } };
globalThis.fromUuidSync = () => null;

// ═══ 1. Network nodes ═══
{
  const { NetworkService } = await load('scripts/services/NetworkService.js');
  const ns = Object.create(NetworkService.prototype);
  const nodes = {
    n1: { id: 'n1', networkId: 'net', name: 'Relay 7', sceneId: 'sc1', state: 'on', security: { requiresAuth: false }, runs: [{ actorId: 'a1', actorName: 'V', moves: 3, used: 1, since: NOW - 1000, until: NOW + 3_600_000 }], infections: [{ id: 'inf1', family: 'fam1', kind: 'sniffer', actorId: 'a1' }, { id: 'inf2', family: 'fam2', kind: 'tap', actorId: 'a2' }] },
    n2: { id: 'n2', networkId: 'net', name: 'Mast', sceneId: 'sc1', state: 'on', security: { requiresAuth: true }, runs: [] },
    n3: { id: 'n3', networkId: 'net', name: 'Hidden', sceneId: 'sc1', state: 'on', hidden: true, runs: [] },
  };
  ns._nowMs = () => NOW;
  ns.getNode = (id) => (nodes[id] ? { infections: [], runs: [], ...nodes[id] } : null);
  ns.getNodes = () => Object.values(nodes).map((n) => ({ infections: [], runs: [], ...n }));
  const c = (d, s = 'p1') => ns.checkNodeRequest(d, s);

  ok(!c({ op: 'state', nodeId: 'n1', state: 'off' }, null).ok, 'no verified sender: refused');
  ok(c({ op: 'state', nodeId: 'n1', state: 'off' }).ok, 'a runner with a session switches the node');
  ok(c({ op: 'state', nodeId: 'n1', state: 'off' }, 'p2').ok === false, 'p2 (no session, viewing another scene) cannot switch it');
  users.p2.viewedScene = 'sc1';
  ok(c({ op: 'state', nodeId: 'n1', state: 'off' }, 'p2').ok, 'an unlocked box on the scene they are viewing: switchable without a session');
  ok(!c({ op: 'state', nodeId: 'n2', state: 'off' }, 'p2').ok, 'a locked box needs a session');
  users.p2.viewedScene = 'sc2';
  ok(!c({ op: 'state', nodeId: 'n1', state: 'damaged' }).ok, 'a player never marks a node damaged');
  const jam = c({ op: 'state', nodeId: 'n1', state: 'jammed', minutes: 9999, who: 'Saburo' });
  ok(jam.ok && jam.data.minutes === 30 && jam.data.who === 'V', 'a jam is held to the rules\' minutes, and named by the GM');
  ok(!c({ op: 'state', nodeId: 'n1', state: 'jammed' }, 'p2').ok, 'jamming without a session is refused');
  ok(!c({ op: 'state', nodeId: 'n3', state: 'off' }).ok, 'a hidden node is refused');
  ok(c({ op: 'alert', nodeId: 'n1', delta: 3 }).data.delta === 1 && c({ op: 'alert', nodeId: 'n1', delta: -2 }).data.delta === 0, 'an alert rises one step at most, never falls');
  const tap = c({ op: 'effect', nodeId: 'n1', kind: 'taps', effect: { actorId: 'a1', minutes: 0 } });
  ok(tap.ok && tap.data.effect.actorId === 'a1', 'a tap by the runner');
  ok(!c({ op: 'effect', nodeId: 'n1', kind: 'taps', effect: { actorId: 'a2' } }).ok, 'a tap in someone else\'s name is refused');
  const bd = c({ op: 'effect', nodeId: 'n1', kind: 'backdoors', effect: { actorId: 'a1', minutes: 99999 } });
  ok(bd.ok && bd.data.effect.minutes === 1440, 'a backdoor lasts the rules\' minutes at most');
  ok(!c({ op: 'effect', nodeId: 'n1', kind: 'taps', effect: { actorId: 'a2' } }, 'p2').ok, 'no session: no effect');
  const back = c({ op: 'run', nodeId: 'n1', run: { actorId: 'a1', moves: 99, used: 0, minutes: 9999 } });
  ok(back.ok && back.data.run.moves === 3 && back.data.run.used === 1, 'a saved session never gives moves back or grows');
  const fresh = c({ op: 'run', nodeId: 'n2', run: { actorId: 'a1', moves: 99, used: 0, minutes: 9999 } });
  ok(fresh.ok && fresh.data.run.moves <= 5 && fresh.data.run.minutes === 60, 'a new session starts within the rules\' moves and minutes');
  ok(!c({ op: 'run', nodeId: 'n1', run: { actorId: 'a2' } }).ok, 'a session for someone else\'s character is refused');
  const inf = c({ op: 'infect', nodeId: 'n1', kind: 'worm', program: { actorId: 'a1', stealthDV: 40, quality: 500, quest: true, note: 'x' } });
  ok(inf.ok && inf.data.program.stealthDV === 20 && inf.data.program.quality === 100 && !('quest' in inf.data.program), 'a program: the runner\'s, numbers clamped, GM-only fields dropped');
  ok(!c({ op: 'infect', nodeId: 'n1', kind: 'worm', program: { actorId: 'a2' } }).ok, 'a program planted in someone else\'s name is refused');
  ok(c({ op: 'recall', family: 'fam1', actorId: 'a1' }).ok && !c({ op: 'recall', family: 'fam2', actorId: 'a1' }).ok, 'recall: only their own family');
  ok(c({ op: 'collect', nodeId: 'n1', infectionId: 'inf1', actorId: 'a1' }).ok && !c({ op: 'collect', nodeId: 'n1', infectionId: 'inf2', actorId: 'a1' }).ok, 'collect: only their own sniffer');
  ok(c({ op: 'wipe', nodeId: 'n1', who: 'Judy' }).data.who === 'V', 'a wipe takes the runner\'s own lines off, never someone else\'s');
  ok(!c({ op: 'clean', nodeId: 'n1', infectionId: 'inf2' }, 'p2').ok, 'cleaning without a session is refused');
  ok(c({ op: 'log', nodeId: 'n1', what: 'x'.repeat(500), who: 'Saburo' }).data.what.length === 120, 'a log line is short and named by the GM');
}

// ═══ 2. Traces ═══
{
  const { TraceService } = await load('scripts/services/TraceService.js');
  const ts = Object.create(TraceService.prototype);
  ts._nowIso = () => '2045-01-01T00:00:00.000Z';
  const r = ts.checkTraceRequest({ actorId: 'a1', actorName: 'Saburo', action: 'siphon', severity: 'apocalyptic', outcome: 'success', source: 'x'.repeat(500) }, 'p1');
  ok(r.ok && r.row.actorName === 'V' && r.row.severity === 'major' && r.row.source.length === 120, 'a trace row is rebuilt: the real name, a known severity, short text');
  ok(!ts.checkTraceRequest({ actorId: 'a2', action: 'siphon' }, 'p1').ok, 'a trace for someone else\'s character is refused');
  ok(!ts.checkTraceRequest({ actorId: 'a1' }, null).ok, 'no verified sender: refused');
  ok(ts.checkTraceRequest({ actorId: 'a1', action: '<img onerror=x>' }, 'p1').row.action === 'intrusion', 'an action tag that is not a plain word is replaced');
  const term = { id: 't1', uuid: 'Item.t1', name: 'WS-7F', testUserPermission: () => false, getFlag: (m, k) => (k === 'isTerminal' ? true : null) };
  globalThis.fromUuidSync = (u) => (u === 'Item.t1' ? term : null);
  ok(!ts.checkTraceRequest({ actorId: 'a1', action: 'exfil', targetUuid: 'Item.t1' }, 'p1').ok, 'a trace on a terminal they have no way into is refused (it would fire its residents)');
  term.testUserPermission = (u, lvl) => lvl <= 1;
  ok(ts.checkTraceRequest({ actorId: 'a1', action: 'exfil', targetUuid: 'Item.t1' }, 'p1').row.objectName === 'WS-7F', 'on one they can reach, the object is named from the item');
}

// ═══ 3. Calls: logs and trace-back ═══
{
  const { CallService } = await load('scripts/services/CallService.js');
  const cs = Object.create(CallService.prototype);
  cs.calls = new Map([['c1', { id: 'c1', from: { userId: 'p1', actorId: 'a1', name: 'V', number: '1' }, to: { userIds: ['p2'], actorId: 'a2', name: 'Judy', number: '2' }, state: 'ended', lines: [{ side: 'caller', text: 'hi', at: 1 }], startedAt: 1, endedAt: 2, outcome: 'answered' }]]);
  cs.allLogs = () => [{ callId: 'old', direction: 'in', me: { actorId: 'a2' } }];
  const l = cs.checkLogRequest({ summary: { callId: 'c1', lines: [{ text: 'forged' }], from: { actorId: 'a2' } } }, 'p1');
  ok(l.ok && l.summary.from.actorId === 'a1' && l.summary.lines[0].text === 'hi' && l.summary.sceneId === 'sc1', 'a call log is written from the GM\'s own copy of the call');
  ok(!cs.checkLogRequest({ summary: { callId: 'c1' } }, 'p1').ok, 'each call is logged once');
  cs.calls.set('c2', { ...cs.calls.get('c1'), id: 'c2' });
  ok(!cs.checkLogRequest({ summary: { callId: 'c2' } }, 'gm2-not-a-user').ok, 'an unknown sender cannot log');
  users.p3 = { id: 'p3', name: 'Stranger', isGM: false };
  ok(!cs.checkLogRequest({ summary: { callId: 'c2' } }, 'p3').ok, 'someone not on the call cannot log it');
  ok(!cs.checkLogRequest({ summary: { callId: 'never' } }, 'p1').ok, 'a call the GM never saw cannot be logged');
  ok(cs.mayTraceCall('c1', 'p2') && !cs.mayTraceCall('c1', 'p1') && !cs.mayTraceCall('c1', 'p3'), 'only the callee may trace a withheld caller');
  ok(cs.mayTraceCall('old', 'p2') && !cs.mayTraceCall('old', 'p1'), 'after the call, the callee is whoever owns its incoming log');
}

// ═══ 4. Emergency ═══
{
  const { EmergencyService } = await load('scripts/services/EmergencyService.js');
  const es = Object.create(EmergencyService.prototype);
  let shown = 0;
  es._showArrival = () => { shown++; };
  game.nightcity.emergencyHud = { trauma: () => { shown += 10; } };
  await es.handleSocket({ op: 'arrive', show: { sceneId: '' } }, 'p1');
  await es.handleSocket({ op: 'auto', userId: 'gm', actorId: 'a1' }, 'p1');
  ok(shown === 0, 'a player cannot trigger an arrival banner or an automatic Trauma call');
  await es.handleSocket({ op: 'arrive', show: { sceneId: '' } }, 'gm');
  ok(shown === 1, 'a GM can');
  const row = es.cleanRow({ kind: 'backup', actorId: 'a2', name: 'Saburo', rounds: 3, left: 0, color: 'red;}', group: 'NCPD', at: 0, evil: { x: 1 } }, actors.a1);
  ok(row && row.actorId === 'a1' && row.name === 'V' && row.left === 3 && row.color === '' && !('evil' in row) && row.group === 'NCPD', 'a tracker row is rebuilt: the owner\'s character, a fresh countdown, a checked colour, plain values only');
  ok(es.cleanRow({ kind: 'backup', rounds: 0 }, actors.a1) === null && es.cleanRow({ kind: 'army', rounds: 3 }, actors.a1) === null, 'an instant arrival or an unknown kind is refused');
  const t = es.cleanRow({ kind: 'trauma', rounds: 2, payerId: 'a2', patientId: 'a2' }, actors.a1);
  ok(t.payerId === 'a1' && t.patient === 'Judy' && t.onPlanOf === 'V', 'a Trauma call is paid by the caller\'s own plan');
}

// ═══ 5. Overheard Enhance ═══
{
  const { OverheardService } = await load('scripts/services/OverheardService.js');
  const os = Object.create(OverheardService.prototype);
  const l = { userId: 'p1', heard: new Map(), enhance: 0 };
  os.runs = new Map([['r1', { id: 'r1', listeners: new Map([['p1', l]]) }]]);
  os.lineFor = () => null; os._changed = () => {}; os._to = () => {};
  await os.handleSocket({ op: 'enhance', runId: 'r1', amount: 1000 }, 'p1');
  ok(l.enhance === 50, 'one Enhance clears at most what a very good roll earns');
  await os.handleSocket({ op: 'enhance', runId: 'r1', amount: 40 }, 'p1');
  ok(l.enhance === 50, 'a second one straight after is ignored');
}

// ═══ 6. Wiring ═══
const sh = read('scripts/integrations/SocketHandlers.js');
ok(/handleTraceRequest\(data, sender \?\? null\)/.test(sh), 'trace: checked against the sender');
ok(/handleNetResolveRequest\(data, sender \?\? null\)/.test(sh) && /handleNetResolveCancel\(data, sender \?\? null\)/.test(sh), 'GM adjudication: the asker gets the answer, and only they may withdraw it');
ok(/LOG_RELAY, \(data, sender\)/.test(sh) && /userName: user\.name/.test(sh), 'access-log relay: rebuilt from the sender');
ok(/handleNodeRequest\(data, sender \?\? null\)/.test(read('scripts/init/registerNetworkSystem.js')), 'nodes: checked against the sender');
ok(/handleLogRequest\(data, sender \?\? null\)/.test(read('scripts/init/registerCallSystem.js')), 'call logs: checked against the sender');
ok(/mayTraceCall\(callId, senderId\)/.test(read('scripts/services/CallService.js')), 'call trace-back: checked');
const nr = read('scripts/ui/content/NetResolve.js');
ok(/_promptOwners\.get\(data\?\.requestId\) !== senderId/.test(nr) && /data = \{ \.\.\.data, userId: senderId \}/.test(nr), 'NetResolve: owner check + the answer goes to the real asker');

console.log(`test-world-relays: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
