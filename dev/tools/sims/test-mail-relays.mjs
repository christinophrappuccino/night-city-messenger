// Sim: mail, scheduling, contact sharing and anonymous trace check who is asking
// (audit remediation A3d: SEC-07).
//
// MESSAGE_RELAY delivered whatever `from`, `fromActorId`, `anonymous` and `eddies` a player's
// client wrote; SCHEDULE_SYNC let anyone add, cancel or rewrite anyone's scheduled mail;
// CONTACT_SHARE_RELAY pushed any contact into anyone's list; ANON_TRACE_REQUEST unmasked any
// anonymous message. Now (GM side):
//   - mail: the sender's own character (or an alias of it, or a terminal account they are in);
//     the from address and name rebuilt; GM-only options dropped; eddies only when the sender's
//     ledger shows the composer's charge, which is then marked used;
//   - scheduling: only the saving GM acts; a player's add gets the mail checks + paid eddies;
//     a cancel only by its creator; an in-place edit only by a GM;
//   - contact share: from the sender's own character, the copy rebuilt from their own address book;
//   - trace: only for traceable anonymous mail in an inbox the sender owns.
import { pathToFileURL, fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const load = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
const read = (p) => readFileSync(`${ROOT}/${p}`, 'utf8');
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };
const MOD = 'night-city-messenger';

const users = { gm: { id: 'gm', name: 'GM', isGM: true }, p1: { id: 'p1', name: 'Rache', isGM: false }, p2: { id: 'p2', name: 'Kaz', isGM: false } };
const mkActor = (id, name, owner, email) => {
  const flags = { email, eddiesPaidIdx: [] };
  return {
    id, name, type: 'character', hasPlayerOwner: true,
    testUserPermission: (u) => !!u.isGM || u.id === owner,
    getFlag: (m, k) => flags[k], async setFlag(m, k, v) { flags[k] = v; }, _flags: flags,
    system: { wealth: { value: 0, transactions: [] } },
  };
};
const actors = { a1: mkActor('a1', 'V', 'p1', 'v@nc'), a2: mkActor('a2', 'Judy', 'p2', 'judy@nc') };
const directory = [
  { id: 'c-main', name: 'V', email: 'v@nc', actorId: 'a1' },
  { id: 'c-alias', name: 'Ghost', email: 'ghost@nc', actorId: 'a1' },
  { id: 'c-judy', name: 'Judy', email: 'judy@nc', actorId: 'a2' },
];
const myContacts = { a1: [{ id: 'k1', name: 'Rogue', email: 'rogue@afterlife.nc', phone: '555-0101' }], a2: [] };
let access = null;   // what TerminalService.senderAccountAccess answers
const revealed = [];
let inboxMsgs = [];
const toasts = [];
globalThis.game = {
  user: users.gm,
  users: { get: (id) => users[id] ?? null, activeGM: users.gm, filter: (fn) => Object.values(users).filter(fn), find: (fn) => Object.values(users).find(fn) },
  actors: Object.assign(Object.values(actors), { get: (id) => actors[id] ?? null }),
  settings: { get: () => undefined },
  i18n: { localize: (s) => s },
  nightcity: {
    masterContactService: { getAll: () => directory, getContact: (id) => directory.find((c) => c.id === id) || null, getByActorId: (id) => directory.find((c) => c.actorId === id) || null },
    contactRepository: { getActorEmail: (id) => actors[id]?.getFlag(MOD, 'email') || '', getContacts: async (id) => myContacts[id] || [] },
    terminalService: { senderAccountAccess: () => access },
    messageRepository: { getMessages: async () => inboxMsgs },
  },
};
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 } };
globalThis.foundry = { utils: { deepClone: (o) => JSON.parse(JSON.stringify(o)), mergeObject: (a, b) => Object.assign(a, b), randomID: () => 'rnd' } };
globalThis.Hooks = { on: () => {}, once: () => {}, off: () => {} };
globalThis.ui = { notifications: { info: (m) => toasts.push(m), warn: (m) => toasts.push(m), error: (m) => toasts.push(m) } };
globalThis.fromUuidSync = (u) => (u === 'Item.term' ? { id: 'term' } : null);

const { MessageService } = await load('scripts/services/MessageService.js');
const ms = new MessageService();

// ═══ 1. Who sends ═══
{
  let d = { messageId: 'm1', fromActorId: 'a1', from: 'ceo@arasaka.corp', fromName: 'Saburo', anonymous: { enabled: true, alias: 'X' }, isBroadcast: true, networkOverride: true };
  ok((await ms.checkRelaySender(d, 'p1')).ok, 'a player sends as their own character');
  ok(d.from === 'v@nc' && d.fromName === 'V', 'the from address and name are rebuilt (a forged "from" never lands)');
  ok(!('anonymous' in d) && !('isBroadcast' in d) && !('networkOverride' in d), 'GM-only options are dropped');
  ok(!(await ms.checkRelaySender({ fromActorId: 'a2' }, 'p1')).ok, "sending as someone else's character is refused");
  ok(!(await ms.checkRelaySender({ fromActorId: 'a1' }, null)).ok, 'no verified sender: refused');
  ok(!(await ms.checkRelaySender({}, 'p1')).ok, 'no sending character at all: refused');
  d = { fromActorId: 'a1', fromContactId: 'c-alias' };
  ok((await ms.checkRelaySender(d, 'p1')).ok && d.from === 'ghost@nc', 'an alias of their own character is fine, and its address is used');
  ok(!(await ms.checkRelaySender({ fromActorId: 'a1', fromContactId: 'c-judy' }, 'p1')).ok, "someone else's identity is refused");
  d = { fromActorId: 'a1', from: 'x@y', _fanout: [{ toActorId: 'a2', from: 'x@y' }, { toActorId: 'z', from: 'x@y' }] };
  await ms.checkRelaySender(d, 'p1');
  ok(d._fanout.every((c) => c.from === 'v@nc' && c.fromActorId === 'a1'), 'every fan-out copy gets the rebuilt sender too');
  const g = { fromActorId: 'a2', anonymous: { enabled: true } };
  ok((await ms.checkRelaySender(g, 'gm')).ok && g.anonymous, "a GM's own relay passes untouched");
  access = null;
  ok(!(await ms.checkRelaySender({ terminalSend: { itemUuid: 'Item.term', accountId: 'mr' }, fromContactId: 'x' }, 'p1')).ok, 'a terminal send by someone not in that account is refused');
  access = { actorId: 'a1', via: null };
  ok((await ms.checkRelaySender({ terminalSend: { itemUuid: 'Item.term', accountId: 'mr' }, fromContactId: 'x' }, 'p1')).ok, 'a terminal send by someone in the account passes (impersonating the account owner is the feature)');
}

// ═══ 2. Eddies ═══
{
  const v = actors.a1;
  const charge = (n, what = `NCM: Sent ${n.toLocaleString()} eb via message`) => v.system.wealth.transactions.push([`Decreased by ${n} to 0`, what]);
  ok(!(await ms.checkRelaySender({ fromActorId: 'a1', eddies: 500 }, 'p1')).ok, 'eddies with no charge on the ledger: refused');
  charge(500);
  ok((await ms.checkRelaySender({ fromActorId: 'a1', eddies: 500 }, 'p1')).ok, 'eddies the composer charged: accepted');
  ok(!(await ms.checkRelaySender({ fromActorId: 'a1', eddies: 500 }, 'p1')).ok, 'the same charge cannot pay twice');
  charge(100);
  ok(!(await ms.checkRelaySender({ fromActorId: 'a1', eddies: 50, _fanout: [{}, {}, {}] }, 'p1')).ok, 'a group send needs every copy paid (100 does not cover 3 × 50)');
  charge(200);
  ok((await ms.checkRelaySender({ fromActorId: 'a1', eddies: 50, _fanout: [{}, {}, {}] }, 'p1')).ok, 'a group send where one recipient was refused (paid 4 × 50, 3 copies) passes');
  charge(1500, 'NCM: Sent 1.500 eb via message');
  ok((await ms.checkRelaySender({ fromActorId: 'a1', eddies: 1500 }, 'p1')).ok, "a charge written in another locale's number format still counts");
  charge(700, 'Bought a gun');
  ok(!(await ms.checkRelaySender({ fromActorId: 'a1', eddies: 700 }, 'p1')).ok, 'a decrease that was not a message charge does not count');
  v.system.wealth.transactions.push(['Decreased by 300 to 0', 'NCM: Sent 300 eb via message']);
  const [r1, r2] = await Promise.all([ms.checkRelaySender({ fromActorId: 'a1', eddies: 300 }, 'p1'), ms.checkRelaySender({ fromActorId: 'a1', eddies: 300 }, 'p1')]);
  ok(r1.ok !== r2.ok, 'two relays arriving together cannot both spend one charge');
}

// ═══ 3. Anonymous trace ═══
{
  ms.revealAnonSender = async (id, inbox) => { revealed.push([id, inbox]); return { success: true }; };
  ms.notificationService; // getter may be undefined in the sim
  inboxMsgs = [{ messageId: 'anon1', anonymous: { enabled: true, traceable: true } }, { messageId: 'anon2', anonymous: { enabled: true, traceable: false } }, { messageId: 'anon3', anonymous: { enabled: true, traceable: true, traced: true } }];
  await ms.handleAnonTraceRequest({ messageId: 'anon1', inboxActorId: 'a2', success: true }, 'p1');
  ok(revealed.length === 0, "tracing mail in someone else's inbox is refused");
  await ms.handleAnonTraceRequest({ messageId: 'anon2', inboxActorId: 'a1', success: true }, 'p1');
  await ms.handleAnonTraceRequest({ messageId: 'anon3', inboxActorId: 'a1', success: true }, 'p1');
  await ms.handleAnonTraceRequest({ messageId: 'nope', inboxActorId: 'a1', success: true }, 'p1');
  ok(revealed.length === 0, 'untraceable, already traced, or unknown mail: refused');
  await ms.handleAnonTraceRequest({ messageId: 'anon1', inboxActorId: 'a1', success: true, byActorName: '<img src=x>' }, 'p1');
  ok(revealed.length === 1 && revealed[0][1] === 'a1', 'traceable anonymous mail in their own inbox is traced');
}

// ═══ 4. Contact share ═══
{
  const { ContactShareService } = await load('scripts/services/ContactShareService.js');
  const cs = new ContactShareService();
  const base = { shareId: 's1', senderActorId: 'a1', sourceContactId: 'k1', options: { send: 'both' }, contact: { name: 'Evil Corp', email: 'evil@corp' }, recipientActorIds: ['a2', 'a1', 'ghost'], senderName: 'Saburo' };
  const r = await cs.checkShareRelay(base, 'p1');
  ok(r.ok && r.payload.contact.name === 'Rogue' && r.payload.contact.email === 'rogue@afterlife.nc', 'the shared copy is rebuilt from the sender\'s own address book (a forged contact never lands)');
  ok(r.ok && JSON.stringify(r.payload.recipientActorIds) === '["a2"]', 'recipients: real characters, never the sender');
  ok(r.ok && r.payload.senderName === 'V' && r.payload.senderUserId === 'p1', 'sender name and user come from the GM\'s side');
  const num = await cs.checkShareRelay({ ...base, options: { send: 'number' } }, 'p1');
  ok(num.ok && num.payload.contact.email === '' && num.payload.contact.phone === '555-0101', 'the player\'s choice of what to send is honoured');
  ok(!(await cs.checkShareRelay({ ...base, senderActorId: 'a2' }, 'p1')).ok, "sharing from someone else's character is refused");
  ok(!(await cs.checkShareRelay({ ...base, sourceContactId: 'nope' }, 'p1')).ok, 'a contact not in their address book is refused');
  ok(!(await cs.checkShareRelay({ ...base, recipientActorIds: ['a1'] }, 'p1')).ok, 'nobody (but themselves) to share with: refused');
}

// ═══ 5. Scheduling ═══
{
  const { SchedulingService } = await load('scripts/services/SchedulingService.js');
  game.nightcity.messageService = ms;
  const ss = Object.create(SchedulingService.prototype);
  let handler = null, saves = 0;
  Object.defineProperty(ss, 'socketManager', { value: { register: (op, fn) => { handler = fn; } } });
  ss._scheduled = [{ scheduleId: 'theirs', createdBy: 'p2', messageData: { fromActorId: 'a2', subject: 'Judy\'s' }, status: 'pending' }];
  ss._persistScheduled = async () => { saves++; };
  ss._isDeliverer = () => true;
  ss._registerSocketHandlers();
  await handler({ action: 'cancel', scheduleId: 'theirs' }, 'p1');
  ok(ss._scheduled.length === 1 && saves === 0, "cancelling someone else's scheduled message is refused");
  await handler({ action: 'edit', scheduleId: 'theirs', updates: { messageData: { eddies: 99999 } } }, 'p1');
  ok(!ss._scheduled[0].messageData.eddies, 'a player cannot edit scheduled mail in place');
  await handler({ action: 'add', entry: { scheduleId: 'forged', createdBy: 'p2', messageData: { fromActorId: 'a2', subject: 'x' } } }, 'p1');
  ok(!ss._scheduled.some((e) => e.scheduleId === 'forged'), "scheduling as someone else's character is refused");
  await handler({ action: 'add', entry: { scheduleId: 'unpaid', messageData: { fromActorId: 'a1', toActorId: 'a2', eddies: 5000 }, eddiesHeld: 5000 } }, 'p1');
  ok(!ss._scheduled.some((e) => e.scheduleId === 'unpaid'), 'scheduled eddies with no charge on the ledger are refused');
  actors.a1.system.wealth.transactions.push(['Decreased by 80 to 0', 'NCM: Sent 80 eb via message']);
  await handler({ action: 'add', entry: { scheduleId: 'paid', createdBy: 'p2', messageData: { fromActorId: 'a1', toActorId: 'a2', from: 'ceo@x', eddies: 40, recipients: [{ actorId: 'a2' }, { actorId: 'zz' }] }, eddiesHeld: 80 } }, 'p1');
  const paid = ss._scheduled.find((e) => e.scheduleId === 'paid');
  ok(paid && paid.createdBy === 'p1' && paid.messageData.from === 'v@nc' && saves === 1, 'an honest scheduled message is saved, as its real creator, with the sender rebuilt');
  await handler({ action: 'cancel', scheduleId: 'paid' }, 'p1');
  ok(!ss._scheduled.some((e) => e.scheduleId === 'paid'), 'its creator can cancel it');
}

// ═══ 6. Wiring ═══
const sh = read('scripts/integrations/SocketHandlers.js');
ok(/handleMessageRelay\(data, sender\)/.test(sh) && /handleAnonTraceRequest\(data, sender\)/.test(sh) && /handleShareRelay\(data, sender\)/.test(sh), 'mail, trace and share handlers get the verified sender');
ok(/register\(SOCKET_OPS\.CONTACT_SHARE_RELAY, async \(data, sender\) => \{\s*if \(!isPrimaryGM\(\)\) return;/.test(sh), 'contact share: one GM');
ok(/const who = await this\.checkRelaySender\(data, senderUserId\)/.test(read('scripts/services/MessageService.js')), 'every relay goes through checkRelaySender');
ok(/if \(!this\._isDeliverer\(\)\) return;/.test(read('scripts/services/SchedulingService.js')), 'only the saving GM acts on a schedule sync');
ok(/sourceContactId: contactId/.test(read('scripts/services/ContactShareService.js')), 'a share names its source contact');

console.log(`test-mail-relays: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
