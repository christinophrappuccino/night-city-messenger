// Sim: disconnects (audit remediation B6: DATA-14, DATA-17, DATA-21).
//
//   DATA-14  mail held because no GM was online stayed held when a GM connected (until the player reloaded).
//   DATA-17  a call outlived a closed tab: the other side's HUD and the GM's switchboard held it forever.
//   DATA-21  a payphone stayed "in use" by someone who had left, and any client could claim a handset for
//            someone else.
// Drives the REAL CallService / PayphoneService methods; wiring checked in the source.
import { pathToFileURL, fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const load = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
const read = (p) => readFileSync(`${ROOT}/${p}`, 'utf8');
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };

const users = {
  me: { id: 'me', name: 'Rache', isGM: false, active: true },
  gone: { id: 'gone', name: 'Kerry', isGM: false, active: false },
  other: { id: 'other', name: 'Judy', isGM: false, active: true },
  gm: { id: 'gm', name: 'GM', isGM: true, active: true },
};
const events = [];
globalThis.game = {
  user: users.me,
  users: Object.assign(Object.values(users), { get: (id) => users[id] ?? null, activeGM: users.gm }),
  actors: { get: () => null },
  settings: { get: () => undefined },
  nightcity: { eventBus: { emit: (e, d) => events.push([e, d]) }, socketManager: { emit() {} }, soundService: { play() {} } },
};
globalThis.foundry = { utils: { deepClone: (o) => JSON.parse(JSON.stringify(o)), randomID: () => 'r' } };
globalThis.Hooks = { on() {}, once() {}, off() {} };
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };

// ═══ 1. Calls end when a party leaves (DATA-17) ═══
{
  const { CallService } = await load('scripts/services/CallService.js');
  const cs = new CallService();
  cs._log = () => {};
  const call = (id, state, extra) => ({ id, state, startedAt: 1, from: { userId: 'me' }, to: { kind: 'player', userIds: ['x'] }, ...extra });
  cs._store(call('a', 'live', { from: { userId: 'gone' } }));                                            // they called me
  cs._store(call('b', 'held', { answeredBy: 'gone' }));                                                  // they answered me
  cs._store(call('c', 'ringing', { to: { kind: 'player', userIds: ['gone'] } }));                       // ringing only them
  cs._store(call('d', 'ringing', { to: { kind: 'player', userIds: ['gone', 'other'] } }));              // someone else can still answer
  cs._store(call('e', 'live', { from: { userId: 'other' }, answeredBy: 'me' }));                        // nothing to do with them
  const n = cs.onUserGone('gone');
  const st = (id) => cs.calls.get(id)?.state;
  ok(n === 3 && st('a') === 'ended' && st('b') === 'ended' && st('c') === 'ended', 'calls they made, answered, or that rang only them end');
  ok(cs.calls.get('a').outcome === 'dropped' || /disconnected/.test(cs.calls.get('a').dropReason || ''), 'as dropped, saying who disconnected');
  ok(/Kerry disconnected/.test(cs.calls.get('b').dropReason || ''), 'the reason names them');
  ok(st('d') === 'ringing' && st('e') === 'live', 'a call still ringing for someone else, and unrelated calls, carry on');
  ok(events.some(([e, d]) => /ended/i.test(e) && d?.call?.id === 'a'), 'the HUD hears the call ended');
  ok(cs.onUserGone('me') === 0, 'this client never ends its own calls for its own departure');
}

// ═══ 2. Payphone handsets (DATA-21) ═══
{
  const { PayphoneService } = await load('scripts/services/PayphoneService.js');
  const pp = new PayphoneService();
  pp.handleSocket({ type: 'use', id: 'booth1', entry: { userId: 'other', name: 'Judy' }, userId: 'other' }, 'gone');
  ok(!pp.inUse.has('booth1'), 'a client cannot put someone else on a handset');
  pp.handleSocket({ type: 'use', id: 'booth1', entry: { userId: 'gone', name: 'Kerry' }, userId: 'gone' }, 'gone');
  ok(pp.inUse.get('booth1')?.userId === 'gone', 'a user lifting their own handset is recorded');
  pp.handleSocket({ type: 'use', id: 'booth1', entry: null, userId: 'gone' }, 'other');
  ok(pp.inUse.has('booth1'), 'someone else cannot hang it up for them');
  pp.handleSocket({ type: 'use', id: 'booth2', entry: { userId: 'gone', name: 'Kerry' } }, 'gone');
  pp.handleSocket({ type: 'use', id: 'booth3', entry: { userId: 'other', name: 'Judy' } }, 'other');
  const cleared = pp.onUserGone('gone');
  ok(cleared === 2 && !pp.inUse.has('booth1') && !pp.inUse.has('booth2') && pp.inUse.has('booth3'), 'when they leave, only their handsets go back on the hook');
  pp.handleSocket({ type: 'use', id: 'booth4', entry: { userId: 'x' } }, null);
  ok(!pp.inUse.has('booth4'), 'a packet with no verified sender is ignored');
}

// ═══ 3. Wiring ═══
const reg = read('scripts/init/registerCallSystem.js');
ok(/Hooks\.on\('userConnected', \(user, connected\) => \{\s*if \(connected \|\| !user\?\.id\) return;\s*service\.onUserGone\(user\.id\);\s*if \(game\.nightcity\.payphoneService\?\.enabled\) game\.nightcity\.payphoneService\.onUserGone\(user\.id\);/.test(reg), 'every client ends calls and clears handsets when a user leaves (handsets only while payphones are on, since step 15)');
const msgReg = read('scripts/init/registerMessagingSystem.js');
ok(/if \(!game\.user\.isGM\) \{\s*Hooks\.on\('userConnected', \(user, connected\) => \{\s*if \(!connected \|\| !user\?\.isGM\) return;[\s\S]{0,260}ms\.flushQueue\(\)/.test(msgReg), 'a player sends held mail when a GM connects (DATA-14)');
ok(/GM_CONNECT_FLUSH_DELAY_MS = \d+/.test(msgReg), '…after a short wait for the GM\'s client to load');

console.log(`test-disconnects: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
