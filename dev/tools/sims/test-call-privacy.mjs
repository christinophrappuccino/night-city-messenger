// Sim: payphone call privacy (audit remediation A6).
//   PRIV-01  decision (dev 2026-11-05): masking is on screen, documented honestly — the docs must say so
//   PRIV-02  whoever answers a booth's call gets the masked booth caller; each booth side is judged on its own
//   PRIV-03  "who is on this booth" no longer carries the call it is on
// Drives the real CallService._send and PayphoneService with mocked Foundry globals.
import { pathToFileURL, fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const read = (p) => readFileSync(`${ROOT}/${p}`, 'utf8');
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };

const users = { gm: { id: 'gm', isGM: true }, v: { id: 'v', isGM: false }, judy: { id: 'judy', isGM: false }, rache: { id: 'rache', isGM: false } };
globalThis.game = { user: users.v, users: { get: (id) => users[id] || null }, settings: { get: () => undefined }, nightcity: {} };
globalThis.foundry = { utils: { deepClone: (o) => JSON.parse(JSON.stringify(o)), mergeObject: (a, b) => ({ ...a, ...b }), randomID: () => 'r' } };
globalThis.Hooks = { on() {}, off() {}, once() {} };
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };

const { payphoneSendGroups } = await imp('scripts/utils/payphones.js');
const isGM = (id) => !!users[id]?.isGM;
const booth = (realUserId) => ({ name: 'Payphone, Kabuki', number: '555', payphone: 'pp1', realUserId, realActorId: `a-${realUserId}`, realName: realUserId.toUpperCase() });

// ═══ 1. The rule ═══
{
  // V calls Judy from a booth; Judy answered
  const call = { from: booth('v'), to: { actorId: 'aj', userIds: ['judy'] }, answeredBy: 'judy' };
  const g = payphoneSendGroups(call, ['gm', 'v', 'judy'], isGM);
  const of = (id) => g.find((x) => x.userIds.includes(id));
  ok(!of('gm').maskFrom && !of('v').maskFrom, 'the GM and the person on the booth see who is really calling');
  ok(of('judy').maskFrom === true, 'whoever ANSWERED the booth\'s call sees only the booth (it used to show them the real caller)');
  ok(!of('judy').maskTo, 'a side that is not a booth is never masked');

  // Judy calls a booth; Rache picked it up
  const call2 = { from: { actorId: 'aj', userId: 'judy' }, to: { kind: 'payphone', payphoneId: 'pp1', realUserId: 'rache', realName: 'RACHE' }, answeredBy: 'rache' };
  const g2 = payphoneSendGroups(call2, ['gm', 'judy', 'rache', 'v'], isGM);
  const of2 = (id) => g2.find((x) => x.userIds.includes(id));
  ok(!of2('rache').maskTo && !of2('gm').maskTo, 'the person who picked up a booth sees themselves; the GM sees them');
  ok(of2('judy').maskTo && of2('v').maskTo, 'the caller and everyone else see only the place');

  // booth to booth: V at booth A calls booth B, Rache answers at B
  const call3 = { from: booth('v'), to: { kind: 'payphone', payphoneId: 'pp2', realUserId: 'rache' }, answeredBy: 'rache' };
  const g3 = payphoneSendGroups(call3, ['v', 'rache'], isGM);
  const of3 = (id) => g3.find((x) => x.userIds.includes(id));
  ok(!of3('v').maskFrom && of3('v').maskTo, 'booth to booth: V sees themselves and only the other booth');
  ok(of3('rache').maskFrom && !of3('rache').maskTo, '…and Rache sees themselves and only V\'s booth');
}

// ═══ 2. The real _send ═══
{
  const { CallService } = await imp('scripts/services/CallService.js');
  const cs = Object.create(CallService.prototype);
  const sent = [];
  Object.defineProperty(cs, 'socket', { value: { emit: (op, d) => sent.push(d) } });
  cs._audience = () => ['gm', 'v', 'judy'];
  cs._send('answer', { id: 'c1', from: booth('v'), to: { actorId: 'aj', userIds: ['judy'], name: 'Judy' }, answeredBy: 'judy', lines: [] });
  const forJudy = sent.find((d) => d.userIds.includes('judy'));
  const forV = sent.find((d) => d.userIds.includes('v'));
  ok(forJudy && !forJudy.call.from.realName && !forJudy.call.from.realUserId && forJudy.call.from.name === 'Payphone, Kabuki', 'the packet meant for Judy carries the booth, not V');
  ok(forV?.call.from.realName === 'V', 'the packet meant for V keeps V');
  ok(sent.every((d) => !('lines' in d.call)), 'the transcript still never travels with the call');
}

// ═══ 3. PRIV-03 ═══
{
  const { PayphoneService } = await imp('scripts/services/PayphoneService.js');
  const ps = Object.create(PayphoneService.prototype);
  ps.inUse = new Map();
  const sent = [];
  Object.defineProperty(ps, 'socket', { value: { emit: (op, d) => sent.push(d) } });
  Object.defineProperty(ps, 'bus', { value: { emit() {} } });
  ps.operator = () => ({ name: 'V' });
  ps.setUse('pp1', true, { callId: 'c1', speaker: false });
  ok(sent[0]?.entry?.name === 'V' && sent[0].entry.callId === null, 'everyone is told who holds the handset, but not which call');
  ok(ps.inUse.get('pp1')?.callId === 'c1', 'the person on the booth keeps the call on their own client');
  const other = Object.create(PayphoneService.prototype);
  other.inUse = new Map();
  Object.defineProperty(other, 'bus', { value: { emit() {} } });
  game.user = users.judy;
  other.handleSocket({ type: 'use', id: 'pp1', entry: { userId: 'v', name: 'V', callId: 'c1' } }, 'v');
  ok(other.inUse.get('pp1')?.name === 'V' && other.inUse.get('pp1').callId === null, 'an older client that still sends the call has it dropped on arrival');
  game.user = users.v;
}

// ═══ 4. PRIV-01: the docs say it plainly ═══
ok(/hiding is on screen[^.]*every connected browser[^.]*developer tools/.test(read('docs/GETTING-STARTED.md')), 'the GM guide says the hiding is on screen and how a player could still find out');
// the developer notes = CLAUDE.md + the per-system notes it points to (split out 2026-11-05)
const devNotes = read('CLAUDE.md') + '\n' + read('dev/design/systems/phone.md');
ok(/This is masking on screen, not secrecy/.test(devNotes) && !/the real person never reaches the other end's client/.test(devNotes), 'the developer notes no longer claim the real person never reaches the other end');

console.log(`test-call-privacy: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
