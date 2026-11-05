// Sim: scheduled mail as GM requests (audit remediation B5: DATA-11, DATA-12).
//
//   DATA-11  a player's cancel near delivery time refunded at once while the GM delivered anyway → paid twice.
//   DATA-12  a player's scheduled mail was delivered by the GM AS the GM, skipping the send-only and
//            directory rules and the terminal account's permission.
//
// Two REAL SchedulingService instances (player + GM) over a scripted socket; the REAL MessageService
// recipient rules. Delivery of the mail itself is stubbed.
import { pathToFileURL, fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const load = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
const read = (p) => readFileSync(`${ROOT}/${p}`, 'utf8');
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MOD = 'night-city-messenger';

const PLAYER = { id: 'u-p', name: 'Rache', isGM: false, active: true };
const GM = { id: 'u-gm', name: 'GM', isGM: true, active: true };
const OTHER = { id: 'u-o', name: 'Kerry', isGM: false, active: true };
const wallet = () => ({ id: 'pc', name: 'V', isOwner: true, system: { wealth: { value: 100, transactions: [] } }, getFlag: (m, k) => (k === 'email' ? 'v@nc' : null), async update(u) { this.system.wealth = u['system.wealth']; } });
const actors = { pc: wallet(), npc: { id: 'npc', name: 'Rogue', getFlag: () => null } };
const directory = [
  { id: 'c-rogue', name: 'Rogue', email: 'rogue@afterlife.nc', actorId: 'npc' },
  { id: 'c-sys', name: 'System', email: 'system@localhost', sendOnly: true },
];
const toasts = [];
globalThis.game = {
  user: PLAYER,
  users: { get: (id) => ({ 'u-p': PLAYER, 'u-gm': GM, 'u-o': OTHER })[id] || null, activeGM: GM, find: (fn) => [GM, PLAYER].find(fn) || null, filter: (fn) => [GM, PLAYER].filter(fn) },
  actors: Object.assign(Object.values(actors), { get: (id) => actors[id] ?? null }),
  journal: [],
  settings: { get: () => undefined },
  nightcity: {
    masterContactService: { getAll: () => directory, getContact: (id) => directory.find((c) => c.id === id) || null, getByActorId: (id) => directory.find((c) => c.actorId === id) || null, getByEmail: (e) => directory.find((c) => c.email === e) || null },
    contactRepository: { getActorEmail: (id) => actors[id]?.getFlag?.(MOD, 'email') || '', verifyContact: (e) => ({ verified: directory.some((c) => c.email === e) }) },
    messageRepository: { getMessages: async () => [] },
    timeService: { getCurrentTime: () => new Date().toISOString() },
    eventBus: { emit() {} },
  },
};
globalThis.foundry = { utils: { deepClone: (o) => JSON.parse(JSON.stringify(o)), mergeObject: (a, b) => Object.assign(a, b), randomID: () => Math.random().toString(36).slice(2, 12) } };
globalThis.Hooks = { on() {}, once() {}, off() {} };
globalThis.ui = { notifications: { info: (m) => toasts.push(m), warn: (m) => toasts.push(m), error: (m) => toasts.push(m) } };
globalThis.ChatMessage = { create: async () => ({}) };

const { MessageService } = await load('scripts/services/MessageService.js');
const { SchedulingService } = await load('scripts/services/SchedulingService.js');
const ms = new MessageService();
game.nightcity.messageService = ms;
SchedulingService.REQUEST_TIMEOUT_MS = 80;
const later = new Date(Date.now() + 3600000).toISOString();
const asUser = (u, fn) => { const prev = game.user; game.user = u; try { return fn(); } finally { game.user = prev; } };

/** A player + a GM scheduler. `gmDelay` = how long the GM takes to answer; `forge` = make a non-GM answer. */
function pair({ gmDelay = 1 } = {}) {
  const player = new SchedulingService();
  const gm = new SchedulingService();
  const saved = [];
  gm._persistScheduled = async () => { saved.push(gm._scheduled.map((e) => e.scheduleId)); };
  player._persistScheduled = async () => { throw new Error('a player never saves'); };
  player._isDeliverer = () => false;
  gm._isDeliverer = () => true;
  const handlers = {};
  const emits = [];
  const sockFor = (side) => ({
    register: (op, fn) => { handlers[side] = fn; },
    emit: (op, data) => {
      emits.push({ side, data });
      const to = side === 'p' ? 'g' : 'p';
      const from = side === 'p' ? PLAYER.id : GM.id;
      setTimeout(() => asUser(to === 'g' ? GM : PLAYER, () => handlers[to]?.(JSON.parse(JSON.stringify(data)), from)), side === 'p' ? gmDelay : 1);
    },
  });
  Object.defineProperty(player, 'socketManager', { value: sockFor('p') });
  Object.defineProperty(gm, 'socketManager', { value: sockFor('g') });
  asUser(PLAYER, () => player._registerSocketHandlers());
  asUser(GM, () => gm._registerSocketHandlers());
  return { player, gm, saved, emits, handlers };
}
// The GM side's sender checks (A3d) — this sim is about the request/answer and the recipient rules.
ms.checkRelaySender = async (d) => (d.subject === 'forged' ? { ok: false, why: 'Rache can only send as their own character' } : { ok: true });
ms.verifyEddiesPaid = async () => true;
const mail = (extra = {}) => ({ fromActorId: 'pc', toActorId: 'npc', to: 'rogue@afterlife.nc', subject: 'job', body: 'b', eddies: 50, ...extra });

// ═══ 1. A player's schedule is saved by the GM, as a player's ═══
{
  const { player, gm, saved } = pair();
  const r = await asUser(PLAYER, () => player.scheduleMessage(mail(), later, { useGameTime: false, eddiesHeld: 50 }));
  ok(r.success && gm._scheduled.length === 1 && saved.length === 1, 'the player waits for the GM, who saves it');
  ok(gm._scheduled[0].asPlayer === true && gm._scheduled[0].createdBy === PLAYER.id, 'the saved entry is marked as a player\'s, created by them');
  ok(!player._scheduled.length, 'the player keeps no copy of its own (it follows the saved setting)');
}

// ═══ 2. Player recipient rules at schedule time (DATA-12) ═══
{
  const { player, emits } = pair();
  const r = await asUser(PLAYER, () => player.scheduleMessage(mail({ toActorId: null, to: 'system@localhost' }), later, { useGameTime: false }));
  ok(!r.success && r.errorCode === 'SEND_ONLY' && !emits.length, 'scheduling to a send-only address is refused at once, nothing is sent');
  const r2 = await asUser(PLAYER, () => player.scheduleMessage(mail({ toActorId: null, to: 'nobody@nowhere' }), later, { useGameTime: false }));
  ok(!r2.success && ['NO_CONTACT', 'NOT_FOUND'].includes(r2.errorCode), 'so is an address outside the directory');
  const r3 = await asUser(PLAYER, () => player.scheduleMessage(mail({ toActorId: null, to: undefined, recipients: [{ email: 'system@localhost' }, { email: 'rogue@afterlife.nc' }] }), later, { useGameTime: false, eddiesHeld: 100 }));
  ok(r3.success, 'a group passes when someone in it can be reached (as a live send does)');
}

// ═══ 3. The GM refuses a forged add: the player hears it (the composer refunds) ═══
{
  const { player, gm } = pair();
  const r = await asUser(PLAYER, () => player.scheduleMessage(mail({ subject: 'forged' }), later, { useGameTime: false, eddiesHeld: 50 }));
  ok(!r.success && /own character/.test(r.error) && !gm._scheduled.length, 'a refused add comes back as a failure with the reason');
}

// ═══ 4. Cancel: refund only once the GM confirms (DATA-11) ═══
{
  const { player, gm } = pair();
  actors.pc = wallet(); game.actors = Object.assign(Object.values(actors), { get: (id) => actors[id] ?? null });
  await asUser(PLAYER, () => player.scheduleMessage(mail(), later, { useGameTime: false, eddiesHeld: 50 }));
  const id = gm._scheduled[0].scheduleId;
  const c = await asUser(PLAYER, () => player.cancelScheduled(id));
  ok(c.success && c.refunded === 50 && actors.pc.system.wealth.value === 150, 'a pending message: the GM takes it out, then the player is refunded');
  ok(!gm._scheduled.length, 'and it has left the schedule');
  const c2 = await asUser(PLAYER, () => player.cancelScheduled(id));
  ok(!c2.success && actors.pc.system.wealth.value === 150, 'a second cancel refunds nothing');
}

// ═══ 5. A cancel during delivery is refused; the message arrives once, nothing refunded ═══
{
  const { player, gm } = pair();
  actors.pc = wallet(); game.actors = Object.assign(Object.values(actors), { get: (id) => actors[id] ?? null });
  await asUser(PLAYER, () => player.scheduleMessage(mail(), later, { useGameTime: false, eddiesHeld: 50 }));
  const entry = gm._scheduled[0];
  entry.deliveryTime = new Date(Date.now() - 1000).toISOString();
  let sends = 0;
  ms.sendMessage = async () => { sends += 1; await sleep(60); return { success: true }; };
  const delivering = asUser(GM, () => gm._checkAndDeliver());
  await sleep(5);
  const c = await asUser(PLAYER, () => player.cancelScheduled(entry.scheduleId));
  await delivering;
  ok(!c.success && /being delivered/.test(c.error), 'a cancel that arrives mid-delivery is refused');
  ok(sends === 1 && actors.pc.system.wealth.value === 100, 'the message went once and nothing was refunded');
  delete ms.sendMessage;
}

// ═══ 6. A late answer: no refund while unsure, the refund comes with the answer ═══
{
  const { player, gm } = pair({ gmDelay: 150 });
  actors.pc = wallet(); game.actors = Object.assign(Object.values(actors), { get: (id) => actors[id] ?? null });
  gm._scheduled.push({ scheduleId: 'slow', createdBy: PLAYER.id, messageData: mail(), eddiesHeld: 50, status: 'pending', deliveryTime: later });
  const c = await asUser(PLAYER, () => player.cancelScheduled('slow'));
  ok(!c.success && /No answer/.test(c.error) && actors.pc.system.wealth.value === 100, 'no answer in time: not cancelled as far as the player knows, nothing refunded');
  await sleep(250);
  ok(!gm._scheduled.length && actors.pc.system.wealth.value === 150, 'when the GM\'s yes arrives, the refund follows — once');
  const add = await asUser(PLAYER, () => player.scheduleMessage(mail({ subject: 'forged' }), later, { useGameTime: false, eddiesHeld: 50 }));
  ok(add.success, 'an add with no answer in time is treated as handed over (nothing refunded yet)');
  await sleep(250);
  ok(actors.pc.system.wealth.value === 200 && toasts.some((t) => /was refused/.test(t)), 'a late refusal of an add refunds it then, and says so');
}

// ═══ 7. Only a GM's answer counts; only the creator may cancel ═══
{
  const { player, handlers, gm } = pair();
  actors.pc = wallet(); game.actors = Object.assign(Object.values(actors), { get: (id) => actors[id] ?? null });
  player._late.set('fake', (r) => player._refund({ messageData: { fromActorId: r.fromActorId } }, r.refund, 'x'));
  await asUser(PLAYER, () => handlers.p({ action: 'result', requestId: 'fake', forUserId: PLAYER.id, ok: true, refund: 9999, fromActorId: 'pc' }, OTHER.id));
  ok(actors.pc.system.wealth.value === 100, 'an "answer" from another player is ignored (it would mint money)');
  gm._scheduled.push({ scheduleId: 'kerry', createdBy: OTHER.id, messageData: mail(), eddiesHeld: 50, status: 'pending', deliveryTime: later });
  const c = await asUser(PLAYER, () => player.cancelScheduled('kerry'));
  ok(!c.success && gm._scheduled.length === 1 && actors.pc.system.wealth.value === 100, 'cancelling someone else\'s message is refused and refunds nothing');
}

// ═══ 8. A player's message is delivered under the player's rules (DATA-12) ═══
{
  const { gm } = pair();
  actors.pc = wallet(); game.actors = Object.assign(Object.values(actors), { get: (id) => actors[id] ?? null });
  ms._deliverMessage = async () => ({ success: true });
  ms._stampOutgoing = async () => {};
  let rec = 0; ms.recordDeliveryFailure = async () => { rec += 1; };
  // scheduled to Rogue, then the GM made Rogue's address send-only before delivery
  gm._scheduled.push({ scheduleId: 'p1', createdBy: PLAYER.id, asPlayer: true, messageData: mail({ toActorId: null, to: 'system@localhost', body: '' }), eddiesHeld: 50, status: 'pending', deliveryTime: new Date(Date.now() - 1000).toISOString() });
  // the GM's own scheduled mail to the same address
  gm._scheduled.push({ scheduleId: 'g1', createdBy: GM.id, messageData: { fromContactId: 'c-sys', from: 'system@localhost', to: 'system@localhost', subject: 's', body: '' }, status: 'pending', deliveryTime: new Date(Date.now() - 1000).toISOString() });
  game.user = GM;   // the whole delivery runs on the GM's client (asUser would switch back at the first await)
  await gm._checkAndDeliver();
  game.user = PLAYER;
  ok(!gm._scheduled.some((e) => e.scheduleId === 'p1' && e.status === 'pending') && actors.pc.system.wealth.value === 150 && rec === 1, 'a player\'s message to a send-only address is refused at delivery and refunded');
  ok(gm._scheduled.find((e) => e.scheduleId === 'g1')?.status === 'delivered', 'the GM\'s own scheduled mail is not held to player rules');
}

// ═══ 9. Wiring ═══
const ss = read('scripts/services/SchedulingService.js');
ok(/entry\.delivering = true;[\s\S]{0,200}sendMessage\(msgData\)/.test(ss), 'an entry is marked "delivering" before it is sent');
ok(/if \(data\.forUserId === game\.user\?\.id && isFromGM\(sender\)\) this\._onResult\(data\);/.test(ss), 'only a GM\'s answer is acted on');
ok(/asPlayer: true/.test(ss) && /msgData\._asPlayer = true/.test(ss), 'a player\'s entry is delivered as a player\'s');
ok(/const asPlayer = !game\.user\.isGM \|\| !!data\._asPlayer;/.test(read('scripts/services/MessageService.js')), 'the recipient rules apply to a player-scheduled send');

console.log(`test-schedule-requests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
