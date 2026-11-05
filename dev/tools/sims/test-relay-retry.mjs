// Sim: relay acknowledgement and retry (audit remediation B3: DATA-06, INT-12, ARCH-01).
//
//   DATA-06  a slow GM made the player's send time out after 8 s; the composer refunded the
//            eddies, then the GM delivered anyway (money from nothing), and Retry made a new id
//            (a second copy).
//   INT-12   the GM force-delivered held mail while the player's flush was sending it → twice.
//   ARCH-01  an error in the GM handler meant no final answer at all.
//
// Two REAL MessageService instances (player + GM) over a scripted socket with delays.
import { pathToFileURL, fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const read = (p) => readFileSync(`${ROOT}/${p}`, 'utf8');
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PLAYER = { id: 'u-p', name: 'Rache', isGM: false, active: true };
const GM = { id: 'u-gm', name: 'GM', isGM: true, active: true };
const toasts = [];
globalThis.game = {
  user: PLAYER,
  users: { find: (fn) => [GM, PLAYER].find(fn) || null, get: (id) => ({ 'u-p': PLAYER, 'u-gm': GM })[id] },
  actors: { get: () => null },
  journal: [],
  nightcity: { networkService: { isDeadZone: false }, soundService: { play() {} } },
};
globalThis.foundry = { utils: { deepClone: (o) => JSON.parse(JSON.stringify(o)), mergeObject: (a, b) => ({ ...a, ...b }), randomID: () => 'rnd' } };
globalThis.Hooks = { on() {}, once() {}, off() {} };
globalThis.localStorage = (() => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; })();
globalThis.ui = { notifications: { info: (m) => toasts.push(['info', m]), warn: (m) => toasts.push(['warn', m]), error: (m) => toasts.push(['error', m]) } };

const { MessageService } = await import(pathToFileURL(`${ROOT}/scripts/services/MessageService.js`).href);
const { SOCKET_OPS } = await import(pathToFileURL(`${ROOT}/scripts/utils/constants.js`).href);
MessageService.RELAY_RETRY_MS = 1e9;   // the sim drives flushes by hand

/**
 * A player + a GM joined by a socket. `gmDelay` = how long the GM's delivery takes,
 * `drop(op, data)` returning true loses that packet.
 */
function pair({ gmDelay = 0, deliver = null, drop = () => false } = {}) {
  const player = Object.create(MessageService.prototype);
  const gm = Object.create(MessageService.prototype);
  // the GM re-check of a player's recipients (audit leftover) has its own sim, test-relay-gates.mjs; this one has no directory
  gm.checkRecipientsAsPlayer = async () => ({ ok: true });
  player._messageQueue = []; gm._messageQueue = [];
  const deliveries = [];
  const refunds = [];
  const gmAcks = [];
  player._refundHeld = async (d, copies = null) => { refunds.push({ id: d.messageId, copies }); return 10; };
  player.sendMessage = (d) => player._relayMessage(d);   // a held single message is resent through the relay
  gm.checkRelaySender = async () => ({ ok: true });
  gm.recordDeliveryFailure = async () => null;
  gm._deliverMessage = deliver || (async (d) => { await sleep(gmDelay); deliveries.push(d.messageId); return { success: true, messageId: d.messageId }; });
  const toGm = (op, data) => {
    if (drop(op, data)) return;
    if (op !== SOCKET_OPS.MESSAGE_RELAY) return;
    setTimeout(() => { const u = game.user; game.user = GM; gm.handleMessageRelay(JSON.parse(JSON.stringify(data)), PLAYER.id); game.user = u; }, 1);
  };
  const toPlayer = (op, data) => {
    if (op === SOCKET_OPS.MESSAGE_DELIVERED) gmAcks.push(data);
    if (drop(op, data)) return;
    if (op === SOCKET_OPS.MESSAGE_DELIVERED) setTimeout(() => player.handleDeliveryConfirmation(JSON.parse(JSON.stringify(data))), 1);
  };
  Object.defineProperty(player, 'socketManager', { value: { emit: toGm } });
  Object.defineProperty(gm, 'socketManager', { value: { emit: toPlayer } });
  Object.defineProperty(player, 'soundService', { value: { play() {} } });
  Object.defineProperty(player, 'eventBus', { value: { emit() {} } });
  return { player, gm, deliveries, refunds, gmAcks };
}
const msg = (id, extra = {}) => ({ messageId: id, sendKey: id, fromActorId: 'a1', from: 'v@nc.net', fromName: 'V', to: 'r@x.nc', toName: 'Rogue', subject: `s-${id}`, eddies: 10, ...extra });
const withTimeouts = async (ack, final, fn) => {
  const a = MessageService.RELAY_ACK_TIMEOUT_MS, f = MessageService.RELAY_FINAL_TIMEOUT_MS;
  MessageService.RELAY_ACK_TIMEOUT_MS = ack; MessageService.RELAY_FINAL_TIMEOUT_MS = final;
  try { await fn(); } finally { MessageService.RELAY_ACK_TIMEOUT_MS = a; MessageService.RELAY_FINAL_TIMEOUT_MS = f; }
};

// ═══ 1. A slow GM: "accepted" buys time, the answer is the real one ═══
await withTimeouts(30, 500, async () => {
  const { player, deliveries, refunds } = pair({ gmDelay: 120 });
  const r = await player._relayMessage(msg('slow1'));
  ok(r.success === true && !r.queued, 'a GM slower than the first wait still answers — the "accepted" ack extended it');
  ok(deliveries.length === 1 && refunds.length === 0, 'delivered once, nothing refunded');
});

// ═══ 2. Slower than the long wait: held, not failed; the late answer settles it ═══
await withTimeouts(30, 60, async () => {
  const { player, deliveries, refunds } = pair({ gmDelay: 150 });
  const r = await player._relayMessage(msg('late1'));
  ok(r.success === true && r.queued && r.reason === 'no_answer', 'no final answer in time → held as "no answer", not failed');
  ok(player._messageQueue.some((d) => d.messageId === 'late1' && d.sendKey === 'late1'), 'the held copy keeps its id');
  ok(refunds.length === 0, 'and the eddies are NOT refunded (the GM may still deliver)');
  await sleep(200);
  ok(deliveries.length === 1, 'the GM delivered it once');
  ok(!player._messageQueue.some((d) => d.messageId === 'late1') && refunds.length === 0, 'the late success settles the held copy, still no refund');
  ok(toasts.some((t) => /was delivered/.test(t[1])), 'and the player is told it arrived');
  // a duplicate late answer does nothing more
  await player.handleDeliveryConfirmation({ messageId: 'late1', success: false, error: 'x', forUserId: 'u-p' });
  ok(refunds.length === 0, 'a second answer for a settled message refunds nothing');
});

// ═══ 3. A late FAILURE refunds exactly once ═══
await withTimeouts(30, 40, async () => {
  const { player, refunds } = pair({ deliver: async () => { await sleep(120); return { success: false, error: 'No recipient inbox target' }; } });
  const r = await player._relayMessage(msg('lf1'));
  ok(r.queued && refunds.length === 0, 'held while unanswered');
  await sleep(200);
  ok(refunds.length === 1 && refunds[0].id === 'lf1' && refunds[0].copies === null, 'a definite failure refunds the whole amount — once');
  ok(!player._messageQueue.some((d) => d.messageId === 'lf1'), 'and drops the held copy');
  await player.handleDeliveryConfirmation({ messageId: 'lf1', success: false, error: 'again', forUserId: 'u-p' });
  ok(refunds.length === 1, 'a repeated failure answer cannot refund twice');
});

// ═══ 4. The GM drops a second copy of an id it is working on or has delivered ═══
{
  const { gm, deliveries, gmAcks } = pair({ gmDelay: 50 });
  game.user = GM;
  const p1 = gm.handleMessageRelay(msg('dup1'), PLAYER.id);
  const p2 = gm.handleMessageRelay(msg('dup1'), PLAYER.id);   // a retry while the first is still running
  await Promise.all([p1, p2]);
  ok(deliveries.length === 1, 'a retry while the first is running is answered "accepted", not delivered again');
  await gm.handleMessageRelay(msg('dup1'), PLAYER.id);         // a retry after it was delivered
  ok(deliveries.length === 1, 'a retry after delivery is not delivered again');
  ok(gmAcks.filter((a) => a.messageId === 'dup1' && !a.accepted && a.success).length === 2, '…and gets the same final answer again');
  // another player's message with the same id is a different message
  await gm.handleMessageRelay(msg('dup1'), 'u-other');
  ok(deliveries.length === 2, 'the same id from another sender is not mistaken for it');
  game.user = PLAYER;
}

// ═══ 5. A failed delivery can be retried; a delivery error still gets an answer ═══
{
  let n = 0;
  const { gm, gmAcks } = pair({ deliver: async () => { n += 1; if (n === 1) return { success: false, error: 'busy' }; if (n === 2) throw new Error('boom'); return { success: true }; } });
  game.user = GM;
  await gm.handleMessageRelay(msg('rt1'), PLAYER.id);
  await gm.handleMessageRelay(msg('rt1'), PLAYER.id);
  ok(n === 2, 'after a failure the GM forgets the id, so a retry is tried again');
  const finals = gmAcks.filter((a) => a.messageId === 'rt1' && !a.accepted);
  ok(finals.length === 2 && finals[1].success === false && /boom/.test(finals[1].error), 'a delivery that throws still sends a final answer (ARCH-01)');
  await gm.handleMessageRelay(msg('rt1'), PLAYER.id);
  ok(n === 3 && gmAcks.filter((a) => a.messageId === 'rt1' && !a.accepted).at(-1).success, 'and the third try delivers');
  game.user = PLAYER;
}

// ═══ 6. A lost relay: held, resent with the SAME id by the flush, delivered once ═══
await withTimeouts(30, 60, async () => {
  let lost = true;
  const { player, deliveries, refunds } = pair({ drop: (op) => op === SOCKET_OPS.MESSAGE_RELAY && lost && !(lost = false) });
  const r = await player._relayMessage(msg('lost1'));
  ok(r.queued && r.reason === 'no_answer' && deliveries.length === 0, 'a relay the GM never got is held');
  await player.flushQueue();
  ok(deliveries.length === 1 && deliveries[0] === 'lost1', 'the flush resends it with the same id and it arrives once');
  ok(!player._messageQueue.length && !player._flushing && refunds.length === 0, 'nothing held, nothing refunded');
});

// ═══ 7. INT-12: the GM delivers held mail while the player's flush is sending ═══
{
  const { player, deliveries } = pair();
  player._messageQueue = [msg('q1'), msg('q2'), msg('q3')];
  player._queueRestored = true;
  const realRelay = player._relayMessage.bind(player);
  player._relayMessage = async (d) => {
    // while q1 goes out, the GM's "delivered q2" command arrives
    if (d.messageId === 'q1') player.handleQueueCommand({ op: 'delivered', messageId: 'q2', forUserId: 'u-p' });
    return realRelay(d);
  };
  await player.flushQueue();
  ok(deliveries.join(',') === 'q1,q3', 'a message the GM already delivered is skipped by the running flush');
}

// ═══ 8. A GM reload: the sent copy already in the sender's mailbox means delivered ═══
{
  const { gm, deliveries, gmAcks } = pair();
  Object.defineProperty(gm, '_messageRepo', { value: { constructor: { identifyInbox: (j) => j.inbox } } });
  game.journal = [{ inbox: { ownerId: 'a1' }, pages: [{ flags: { 'night-city-messenger': { messageId: 'old1-sent' } } }] }];
  game.user = GM;
  await gm.handleMessageRelay(msg('old1'), PLAYER.id);
  ok(deliveries.length === 0 && gmAcks.at(-1).success === true, 'a message whose sent copy exists is acknowledged, not written again');
  await gm.handleMessageRelay(msg('bad id!'), PLAYER.id);
  ok(gmAcks.at(-1).success === false && /bad message id/.test(gmAcks.at(-1).error), 'an id that is not a plain id is refused');
  game.user = PLAYER; game.journal = [];
}

// ═══ 9. Wiring ═══
const ms = read('scripts/services/MessageService.js');
const sh = read('scripts/integrations/SocketHandlers.js');
ok(/MessageService\.validSendKey\(data\.sendKey\) \|\| foundry\.utils\.randomID\(\)/.test(ms), 'stamping keeps the sender\'s id across retries');
ok(/this\._sendKey \|\|= foundry\.utils\.randomID\(\);\s*\n\s*const messageData = \{\s*\n\s*sendKey: this\._sendKey,/.test(read('scripts/ui/MessageComposer/MessageComposerApp.js').replace(/\r\n/g, '\n')), 'the composer gives one id to every Retry of a message');
ok(/MESSAGE_DELIVERED, \(data, sender\) => \{[\s\S]{0,300}if \(!isFromGM\(sender\)\) return;/.test(sh), 'only a GM\'s delivery answer is believed (a failure answer refunds now)');
ok(/MESSAGE_QUEUE_CMD, \(data, sender\) => \{[\s\S]{0,200}!isFromGM\(sender\)/.test(sh), 'only a GM may tell a player to drop held mail');
ok(/r\.catch\(\(error\) => log\.error/.test(read('scripts/core/SocketManager.js')), 'an async socket handler\'s rejection is caught');
ok(!/'RELAY_TIMEOUT'/.test(ms), 'no path turns "no answer" into a failure any more');

console.log(`test-relay-retry: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
