// Sim: money and persistence guards (audit remediation B2: DATA-01, DATA-02, DATA-20, DATA-08).
//
//   DATA-01  a siphon with no GM online credited wealth but never drained the account → repeatable
//   DATA-02  a shard eddies claim with no GM online did the same; a claim that failed to save kept the money
//   DATA-20  running a program with no GM online spent the roll and said "sent"
//   DATA-08  program charges never counted down: 2+ charges ran forever. Dev's call: every run
//            (clean, failed or misfired) spends one; no charges set = one use.
import { readFileSync } from 'fs';
import { pathToFileURL, fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const load = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
const read = (p) => readFileSync(`${ROOT}/${p}`, 'utf8');
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };
const MOD = 'night-city-messenger';

// ═══ 1. The charge rule ═══
const CI = await load('scripts/utils/contentIntents.js');
ok(CI.payloadCanRun({}) && CI.payloadCanRun({ charges: 3 }), 'a program that has not run yet can run');
ok(!CI.payloadCanRun({ executed: true }) && !CI.payloadCanRun({ executed: true, charges: 0 }), 'a one-use program, or one with no charges left, cannot');
ok(CI.payloadCanRun({ executed: true, charges: 2 }), 'one with charges left can run again');
ok(CI.chargesAfterRun({ charges: 3 }) === 2 && CI.chargesAfterRun({ charges: 1 }) === 0 && CI.chargesAfterRun({}) === 0 && CI.chargesAfterRun({ charges: 'x' }) === 0, 'a run spends one; none set = used up');
let cd = { charges: 3 }, runs = 0;
while (CI.payloadCanRun(cd) && runs < 10) { runs += 1; cd = { ...cd, executed: true, charges: CI.chargesAfterRun(cd) }; }
ok(runs === 3, '3 charges = exactly 3 runs');
cd = {}; runs = 0;
while (CI.payloadCanRun(cd) && runs < 10) { runs += 1; cd = { ...cd, executed: true, charges: CI.chargesAfterRun(cd) }; }
ok(runs === 1, 'no charges set = exactly 1 run');

// ── a small world ──
const users = { gm: { id: 'gm', name: 'GM', isGM: true }, p1: { id: 'p1', name: 'Rache', isGM: false } };
const emitted = [];
const toasts = [];
const pages = [];
const journal = { id: 'j', pages: { find: (fn) => pages.find(fn), contents: pages, [Symbol.iterator]: () => pages.values() }, getFlag: () => null };
const mkActor = () => {
  const a = { id: 'a1', name: 'V', system: { wealth: { value: 100, transactions: [] } }, isOwner: true, testUserPermission: () => true, getFlag: () => null };
  a.update = async (d) => { if (d['system.wealth']) a.system.wealth = JSON.parse(JSON.stringify(d['system.wealth'])); };
  return a;
};
globalThis.game = {
  user: users.p1,
  users: { get: (id) => users[id] ?? null, activeGM: null, filter: (fn) => Object.values(users).filter(fn) },
  actors: Object.assign([], { get: () => null }),
  journal: { get: () => journal, [Symbol.iterator]: () => [journal].values() },
  items: [], settings: { get: () => undefined }, i18n: { localize: (s) => s },
  nightcity: { socketManager: { emit: (op, d) => emitted.push(d) }, soundService: { play() {} }, traceService: { fireTrace() {}, logSuccess() {} }, eventBus: { emit() {} } },
};
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OBSERVER: 2, OWNER: 3 } };
globalThis.ui = { notifications: { info: (m) => toasts.push(m), warn: (m) => toasts.push(m), error: (m) => toasts.push(m) } };
globalThis.Hooks = { on() {}, off() {}, once() {}, call() {}, callAll() {} };
globalThis.CONFIG = {};
globalThis.foundry = { utils: { deepClone: (o) => JSON.parse(JSON.stringify(o)), mergeObject: (a, b) => ({ ...a, ...b }), randomID: () => 'rid' }, applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (B) => B }, instances: new Map() } };
globalThis.fromUuidSync = () => null;
globalThis.ChatMessage = { create: async () => ({}) };

const SF = await load('scripts/ui/content/SiphonFlow.js');

// ═══ 2. No GM online: nothing is paid out, no roll is spent ═══
{
  const actor = mkActor();
  emitted.length = 0;
  await SF.runSiphon({ actor, raw: { balance: 5000, siphonMode: 'full' }, messageId: 'b1' });
  ok(actor.system.wealth.value === 100 && !emitted.length, 'a siphon with no GM online pays nothing and sends nothing (DATA-01)');
  const r = await SF.runPayloadExecute({ actor, raw: { name: 'Ice.exe' }, messageId: 'p1' });
  ok(r === null && !emitted.length, 'a program run with no GM online is refused before the roll (DATA-20)');
  game.users.activeGM = users.gm;
  const r2 = await SF.runPayloadExecute({ actor, raw: { name: 'Ice.exe', executed: true, charges: 0 }, messageId: 'p1' });
  ok(r2 === null && toasts.some((t) => /no charges left/.test(t)), 'a program with no charges left says so');
  game.users.activeGM = null;
}

// ═══ 3. The GM spends a charge on every run ═══
{
  game.user = users.gm; game.users.activeGM = users.gm;
  const page = { id: 'pg', parent: journal, flags: { [MOD]: { messageId: 'prog', contentType: 'payload', contentData: { name: 'Ice.exe', charges: 2, effect: { type: 'adjudicate' } } } } };
  page.update = async (d) => { page.flags[MOD].contentData = JSON.parse(JSON.stringify(d[`flags.${MOD}.contentData`])); };
  pages.push(page);
  await SF.applyPayloadEffect({ messageId: 'prog', actorId: null, outcome: 'success' });
  ok(page.flags[MOD].contentData.charges === 1 && page.flags[MOD].contentData.executed, 'a clean run spends a charge');
  await SF.applyPayloadEffect({ messageId: 'prog', actorId: null, outcome: 'fail' });
  ok(page.flags[MOD].contentData.charges === 0, 'a failed or misfired run spends one too (the program still ran)');
  ok(!SF.checkPayloadRequest({ messageId: 'prog', outcome: 'success', actorId: null }, 'gm').ok, 'used up: the GM refuses another relayed run');
  page.flags[MOD].contentData.charges = 2;
  ok(SF.checkPayloadRequest({ messageId: 'prog', outcome: 'success', actorId: null }, 'gm').ok, 'with charges left, it may run again');
}

// ═══ 4. A shard eddies claim ═══
{
  const { DataShardService } = await load('scripts/services/DataShardService.js');
  const ds = Object.create(DataShardService.prototype);
  const ePage = { id: 'e', parent: journal, flags: { [MOD]: { messageId: 'edd', contentType: 'eddies', contentData: { amount: 500 } } } };
  pages.push(ePage);
  ds._getLinkedJournal = () => journal;
  // no GM online
  game.user = users.p1; game.users.activeGM = null;
  let actor = mkActor();
  let r = await ds.claimEddies({ name: 'Chip' }, 'edd', actor);
  ok(!r.success && actor.system.wealth.value === 100, 'a claim with no GM online pays nothing (DATA-02)');
  // GM online, but the claim cannot be saved
  game.user = users.gm; game.users.activeGM = users.gm;
  ePage.update = async () => { throw new Error('disk on fire'); };
  actor = mkActor();
  r = await ds.claimEddies({ name: 'Chip' }, 'edd', actor);
  ok(!r.success && actor.system.wealth.value === 100 && /reversed/.test(actor.system.wealth.transactions.at(-1)?.[1] || ''), 'a claim that cannot be recorded takes the money back, on the ledger');
  // and the normal path still pays once
  ePage.update = async (d) => { ePage.flags[MOD].contentData = JSON.parse(JSON.stringify(d[`flags.${MOD}.contentData`])); };
  actor = mkActor();
  r = await ds.claimEddies({ name: 'Chip' }, 'edd', actor);
  ok(r.success && actor.system.wealth.value === 600 && ePage.flags[MOD].contentData.claimed, 'a normal claim pays once and is marked claimed');
  r = await ds.claimEddies({ name: 'Chip' }, 'edd', mkActor());
  ok(!r.success, 'and cannot be claimed again');
}

// ═══ 5. Wiring ═══
const sf = read('scripts/ui/content/SiphonFlow.js');
const body = (name) => { const i = sf.indexOf(`export async function ${name}(`); return sf.slice(i, i + 700); };
ok(/if \(!canPersistContent\(\)\) return;/.test(body('runSiphon')), 'runSiphon checks for a GM first');
ok(/if \(!canPersistContent\(\)\) return null;/.test(body('runPayloadExecute')), 'runPayloadExecute checks for a GM first');
ok(!/charges > 1/.test(sf) && /canRun: !cd\.executed \|\| \(isActive === false && payloadCanRun\(cd\)\)/.test(read('scripts/ui/content/ContentRenderers.js')), 'every charge check uses the one rule');

console.log(`test-money-guards: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
