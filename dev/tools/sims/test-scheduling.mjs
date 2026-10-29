// Sim: scheduled messages (tester CptWashu 2026-10-29: "a scheduled eddies payment fails — even from the GM account;
// unscheduled it sends"). Drives the REAL SchedulingService over a mocked world: any sender / recipient an immediate
// send accepts, a player's schedule saved by the GM, no GM = said out loud, one deliverer, eddies intact on delivery.
//   node dev/tools/sims/test-scheduling.mjs
import { pathToFileURL, fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.error('FAIL:', m)); };

let isGMNow = true;
let activeGM = { id: 'G' };
let userId = 'G';
const saved = [];
const emits = [];
const sent = [];
let socketHandler = null;
let now = Date.parse('2045-08-14T10:00:00Z');
globalThis.game = {
  get user() { return { id: userId, isGM: isGMNow }; },
  users: { get activeGM() { return activeGM; } },
  settings: { get: () => [] },
  nightcity: {
    settingsManager: { get: () => [], set: async (k, v) => { saved.push([k, JSON.parse(JSON.stringify(v))]); } },
    timeService: { getCurrentTime: () => new Date(now).toISOString() },
    eventBus: { emit() {} },
    socketManager: { emit: (op, d) => emits.push([op, d]), register: (op, fn) => { socketHandler = fn; } },
    messageService: { sendMessage: async (d) => { sent.push(d); return { success: true }; } },
  },
};
globalThis.foundry = { utils: { randomID: (() => { let i = 0; return () => `s${++i}`; })(), mergeObject: (a, b) => Object.assign(a, b) } };
globalThis.Hooks = { on() {} };
globalThis.setInterval = () => 0; globalThis.clearInterval = () => {};

const { SchedulingService } = await imp('scripts/services/SchedulingService.js');
const svc = new SchedulingService();
svc._registerSocketHandlers();
const later = '2045-08-14T12:00:00.000Z';

// ═══ 1. The reported case: a GM pays a player FROM an NPC directory contact, scheduled ═══
const payment = { fromContactId: 'c-fixer', from: 'rogue@afterlife.nc', fromName: 'Rogue', toActorId: 'V', subject: 'Your cut', body: '…', eddies: 500 };
let r = await svc.scheduleMessage(payment, later);
ok(r.success, 'a GM can schedule a payment from an NPC directory contact (no sender actor) — the reported failure');
ok(saved.at(-1)?.[0] === 'scheduledMessages' && saved.at(-1)[1][0].messageData.eddies === 500, 'the GM saves it, eddies and all');
ok((await svc.scheduleMessage({ fromActorId: 'NPC', toContactId: 'c-judy', to: 'judy@mox.nc', subject: 'x' }, later)).success, 'to a directory contact');
ok((await svc.scheduleMessage({ fromActorId: 'NPC', recipients: [{ actorId: 'V' }, { actorId: 'J' }], subject: 'x' }, later)).success, 'to several people (a fan-out)');
ok((await svc.scheduleMessage({ fromActorId: 'NPC', groupId: 'g1', subject: 'x' }, later)).success, 'to a group');
ok((await svc.scheduleMessage({ toActorId: 'V', subject: 'x' }, later)).success === false, 'no sender at all → refused');
ok((await svc.scheduleMessage({ fromActorId: 'NPC', subject: 'x' }, later)).success === false, 'no recipient at all → refused');

// ═══ 2. Delivery: once, by the active GM, eddies intact ═══
now = Date.parse('2045-08-14T12:30:00Z');
await svc._checkAndDeliver();
ok(sent.length === 4 && sent[0].eddies === 500 && sent[0].fromContactId === 'c-fixer', 'when due, the active GM delivers every one — the payment with its 500 eb');
await svc._checkAndDeliver();
ok(sent.length === 4, '…and only once');

// two GMs: only the active one delivers
const svc2 = new SchedulingService();
svc2._scheduled.push({ scheduleId: 'x', messageData: { fromActorId: 'A', toActorId: 'B' }, deliveryTime: later, useGameTime: true, status: 'pending' });
userId = 'G2'; isGMNow = true; activeGM = { id: 'G' };
await svc2._checkAndDeliver();
ok(sent.length === 4, 'a second GM (not the active one) does not deliver — no double payment');
userId = 'G';
await svc2._checkAndDeliver();
ok(sent.length === 5, 'the active GM does');
// the interval and a world-time hook arriving together
const svc3 = new SchedulingService();
svc3._scheduled.push({ scheduleId: 'y', messageData: { fromActorId: 'A', toActorId: 'B' }, deliveryTime: later, useGameTime: true, status: 'pending' });
game.nightcity.messageService.sendMessage = async (d) => { await new Promise((res) => setTimeout(res, 5)); sent.push(d); return { success: true }; };
await Promise.all([svc3._checkAndDeliver(), svc3._checkAndDeliver()]);
ok(sent.length === 6, 'two overlapping checks deliver it once');

// ═══ 3. A player schedules ═══
now = Date.parse('2045-08-14T10:00:00Z');
isGMNow = false; userId = 'P'; activeGM = null;
const nSaved = saved.length;
r = await svc.scheduleMessage({ fromActorId: 'V', toActorId: 'J', subject: 'later', eddies: 50 }, later);
ok(!r.success && /GM must be online/.test(r.error), 'no GM online: refused, and the player is told why (it used to vanish)');
activeGM = { id: 'G' };
r = await svc.scheduleMessage({ fromActorId: 'V', toActorId: 'J', subject: 'later', eddies: 50 }, later);
ok(r.success && saved.length === nSaved && emits.at(-1)?.[1]?.action === 'add', 'GM online: the player hands it to the GM (no doomed write of their own)');
// the GM's client receives it and SAVES it
isGMNow = true; userId = 'G';
const gm = new SchedulingService();
gm._registerSocketHandlers();
const before = saved.length;
socketHandler({ action: 'add', entry: emits.at(-1)[1].entry });
await new Promise((res) => setTimeout(res, 0));
ok(saved.length === before + 1 && saved.at(-1)[1].some((e) => e.messageData.subject === 'later'), 'the GM saves a player’s scheduled message (it used to live only in memory and die on a reload)');
socketHandler({ action: 'cancel', scheduleId: emits.at(-1)[1].entry.scheduleId });
await new Promise((res) => setTimeout(res, 0));
ok(!saved.at(-1)[1].some((e) => e.messageData.subject === 'later'), 'and saves a cancel');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
