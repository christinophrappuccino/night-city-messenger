// Held mail survives a reload: the real MessageService queue methods over a mocked localStorage.
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL: ' + m); } };

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { if (globalThis.__quota) throw new Error('quota'); store.set(k, v); }, removeItem: (k) => store.delete(k) };
const notes = [];
globalThis.ui = { notifications: { warn: (m, o) => notes.push({ m, o }), info() {}, error() {} } };
const payer = { isOwner: true, system: { wealth: { value: 100, transactions: [] } }, update: async (p) => { payer.system.wealth = p['system.wealth']; } };
globalThis.game = { world: { id: 'w1' }, user: { id: 'u1', isGM: false, name: 'Alex' }, users: { find: () => null }, settings: { get: () => null }, nightcity: {}, modules: { get: () => null }, actors: { get: (id) => (id === 'payer' ? payer : null) } };
globalThis.foundry = { utils: { randomID: () => 'x', mergeObject: (a, b) => ({ ...a, ...b }), deepClone: (x) => JSON.parse(JSON.stringify(x)) } };
globalThis.Hooks = { on() {}, once() {}, call() {}, callAll() {} };

const { MessageService } = await import('../../../scripts/services/MessageService.js');
const key = 'ncm.mailQueue.w1.u1';
const fresh = () => {
  const s = new MessageService();
  Object.defineProperty(s, 'eventBus', { value: { emit() {} }, configurable: true });
  Object.defineProperty(s, 'socketManager', { value: { emit() {} }, configurable: true });
  s._delay = async () => {};
  return s;
};

// queued mail is saved
const a = fresh();
a._queueMessage({ messageId: 'm1', subject: 'Pay', eddies: 500 });
a._queueMessage({ messageId: 'm2', subject: 'Later' });
ok(JSON.parse(store.get(key)).length === 2, 'queued mail is saved');
ok(JSON.parse(store.get(key))[0].eddies === 500, 'with the eddies it carries');

// a reload brings it back and sends it
const b = fresh();
ok(b.queueSize === 0, 'a new page starts empty');
const sent = [];
b.sendMessage = async (d) => { sent.push(d.messageId); return { success: true }; };
await b.flushQueue();
ok(sent.join() === 'm1,m2', 'the first flush after a reload sends what was held');
ok(!store.has(key), 'and nothing stays saved once it is gone');

// restoring twice can't double it
store.set(key, JSON.stringify([{ messageId: 'x1' }]));
const c = fresh();
c._restoreQueue(); c._restoreQueue();
ok(c.queueSize === 1, 'restoring twice does not double it');
c._restoreQueue();
const d = fresh();
d._messageQueue.push({ messageId: 'x1' });
d._restoreQueue();
ok(d.queueSize === 1, 'mail already in the queue is not added again');
store.clear();

// still waiting: stays saved
const e = fresh();
e._messageQueue.push({ messageId: 'w1' });
e.sendMessage = async (msg) => { e._queueMessage(msg); return { success: true, queued: true }; };
await e.flushQueue();
ok(e.queueSize === 1 && JSON.parse(store.get(key)).length === 1, 'mail that queues again stays saved');
store.clear();

// a reload part way through a flush loses nothing
const f = fresh();
f._messageQueue.push({ messageId: 'p1' }, { messageId: 'p2' }, { messageId: 'p3' });
let during = null;
f.sendMessage = async (msg) => { if (msg.messageId === 'p1') during = JSON.parse(store.get(key) || '[]').map((x) => x.messageId).join(); return { success: true }; };
f._saveQueue();
await f.flushQueue();
ok(during === 'p1,p2,p3', 'what has not been handled is still saved during a flush');
ok(!store.has(key), 'and clears when the flush ends');

// fan-out goes the relay way
const g = fresh();
g._messageQueue.push({ messageId: 'fan', _fanout: [{}, {}] });
let relayed = 0;
g._relayMessage = async () => { relayed++; return { success: true }; };
g.sendMessage = async () => { throw new Error('should not re-send a fan-out'); };
await g.flushQueue();
ok(relayed === 1, 'a held fan-out still relays as it is');

// a refusal is said out loud, naming the eddies
notes.length = 0;
const h = fresh();
h._messageQueue.push({ messageId: 'r1', subject: 'Payment', eddies: 250, fromActorId: 'payer' }, { messageId: 'r2', subject: 'Note' });
h.sendMessage = async (msg) => (msg.messageId === 'r1' ? { success: false, error: 'Recipient not found' } : { success: true });
await h.flushQueue();
ok(notes.length === 1 && notes[0].m.includes('Payment') && notes[0].m.includes('250 eb went back') && notes[0].m.includes('Recipient not found') && notes[0].o?.permanent, 'a refused message with eddies is named and stays on screen');
ok(payer.system.wealth.value === 350 && payer.system.wealth.transactions.length === 1, 'and its eddies go back');
payer.system.wealth = { value: 100, transactions: [] };
const hf = fresh();
hf._messageQueue.push({ messageId: 'f1', subject: 'Crew pay', eddies: 50, fromActorId: 'payer', _fanout: [{}, {}, {}] });
hf._relayMessage = async () => ({ success: true, failed: [{}] });
await hf.flushQueue();
ok(payer.system.wealth.value === 150, 'a group that partly fails gives back only the failed share');
payer.system.wealth = { value: 100, transactions: [] };
const hc = fresh();
hc._queueMessage({ messageId: 'x9', subject: 'Crew', eddies: 50, fromActorId: 'payer', _fanout: [{}, {}] });
await hc.cancelQueued('x9');
ok(payer.system.wealth.value === 200, 'cancelling held mail gives back all of it');
const hg = fresh();
hg._queueMessage({ messageId: 'x8', subject: 'Crew', eddies: 10, fromActorId: 'nobody' });
ok(await hg._refundHeld(hg._messageQueue[0]) === 0, 'no sender to pay back is not an error');
hg._messageQueue.length = 0; hg._saveQueue();
ok(!store.has(key), 'a refused message is not retried forever');
notes.length = 0;
const i = fresh();
i._messageQueue.push({ messageId: 't1', subject: 'Boom' });
i.sendMessage = async () => { throw new Error('exploded'); };
await i.flushQueue();
ok(notes.length === 1 && notes[0].m.includes('exploded'), 'one failing send does not stop the flush or vanish');

// the GM's commands reach the saved copy
store.clear();
const j = fresh();
j._queueMessage({ messageId: 'c1', subject: 'x' });
j.handleQueueCommand({ messageId: 'c1', op: 'delivered' });
ok(!store.has(key), 'mail the GM delivered is dropped from the saved copy');
const k = fresh();
k._queueMessage({ messageId: 'c2', subject: 'y' });
await k.cancelQueued('c2');
ok(!store.has(key), 'mail cancelled is dropped too');

// a browser that refuses to save warns once and keeps working
notes.length = 0; globalThis.__quota = true;
const l = fresh();
l._queueMessage({ messageId: 'q1' }); l._queueMessage({ messageId: 'q2' });
ok(l.queueSize === 2 && notes.length === 1, 'a full browser store warns once and the queue still works');
globalThis.__quota = false;

// another user or world keeps its own
store.clear();
const m = fresh();
m._queueMessage({ messageId: 'mine' });
game.user.id = 'u2';
const n = fresh();
n._restoreQueue();
ok(n.queueSize === 0, 'another user on this browser does not get my held mail');
game.user.id = 'u1';

// wiring
const src = readFileSync(new URL('../../../scripts/services/MessageService.js', import.meta.url), 'utf8');
ok(/async flushQueue\(\) \{\s*this\._restoreQueue\(\);/.test(src), 'the flush at startup restores first');
const init = readFileSync(new URL('../../../scripts/init/registerMessagingSystem.js', import.meta.url), 'utf8');
ok(/'Flush message queue'[\s\S]{0,160}flushQueue\(\)/.test(init), 'startup runs that flush');

console.log(`test-mail-queue-persist: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
