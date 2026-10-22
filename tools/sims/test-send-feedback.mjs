// Sim: "my player failed to send a message and we don't know why" (tester, 2026-10-20).
//
// The player relay used to return success the moment the socket emit went out,
// so a GM-side failure arrived as a stray toast after the composer had shown
// "Delivered" and closed. Drives the REAL MessageService._relayMessage /
// handleDeliveryConfirmation / handleMessageRelay / playerFacingError via
// prototype.call with a scripted two-client socket, then static drift guards:
// every composer error key is rendered, every failure return carries a reason.
import { pathToFileURL } from 'url';
import { readFileSync } from 'fs';

const ROOT = 'C:/Users/cphan/AppData/Local/FoundryVTT/Data/modules/night-city-messenger';
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };

// ── Minimal Foundry globals ──
let gmOnline = true;
let deadZone = false;
const toasts = [];
globalThis.game = {
  user: { id: 'u-player', isGM: false },
  users: {
    find: (fn) => (gmOnline ? [{ id: 'u-gm', isGM: true, active: true }] : []).find(fn) || null,
    get: (id) => ({ 'u-player': { name: 'Aegaeon' } })[id],
  },
  actors: { get: () => null },
  nightcity: {
    get networkService() { return { isDeadZone: deadZone }; },
    // socketManager / soundService are getters on MessageService that read
    // game.nightcity — the current fake service installs itself here.
    socketManager: null,
    soundService: null,
  },
};
globalThis.foundry = { utils: { deepClone: (o) => JSON.parse(JSON.stringify(o)), mergeObject: (a, b) => ({ ...a, ...b }), randomID: () => 'rnd' } };
globalThis.Hooks = { on: () => {}, once: () => {}, off: () => {} };
globalThis.ui = { notifications: { info: (m) => toasts.push(['info', m]), warn: (m) => toasts.push(['warn', m]), error: (m) => toasts.push(['error', m]) } };

const { MessageService } = await import(pathToFileURL(`${ROOT}/scripts/services/MessageService.js`).href);
const { SOCKET_OPS } = await import(pathToFileURL(`${ROOT}/scripts/utils/constants.js`).href);

// ── A fake service instance: prototype methods, scripted collaborators ──
function makeService() {
  const svc = Object.create(MessageService.prototype);
  svc._messageQueue = [];
  svc.emitted = [];
  svc.sounds = [];
  game.nightcity.socketManager = { emit: (op, data) => svc.emitted.push({ op, data }) };
  game.nightcity.soundService = { play: (id) => svc.sounds.push(id) };
  return svc;
}
const msg = (id) => ({ messageId: id, from: 'v@nc.net', fromName: 'V', to: 'rogue@afterlife.nc', toName: 'Rogue', subject: 'hi' });

// ═══ 1. GM offline → queued, nothing emitted, no stray toast ═══
{
  gmOnline = false; toasts.length = 0;
  const svc = makeService();
  const r = await svc._relayMessage(msg('m1'));
  ok(r.success === true && r.queued === true && r.reason === 'gm_offline', 'GM offline → queued with reason gm_offline');
  ok(svc.emitted.length === 0 && svc._messageQueue.length === 1, 'GM offline → not relayed, held in the queue');
  ok(toasts.length === 0, 'GM offline → the service no longer toasts (the composer shows the QUEUED state)');
  gmOnline = true;
}

// ═══ 2. Dead zone → queued (the "Queue" button finally means it) ═══
{
  deadZone = true;
  const svc = makeService();
  const r = await svc._relayMessage(msg('m2'));
  ok(r.success === true && r.queued === true && r.reason === 'dead_zone', 'dead zone → queued with reason dead_zone');
  ok(svc.emitted.length === 0, 'dead zone → nothing relayed to the GM');
  deadZone = false;
}

// ═══ 3. Normal relay waits for the GM's ack, then succeeds ═══
{
  const svc = makeService();
  const p = svc._relayMessage(msg('m3'));
  await Promise.resolve();
  ok(svc.emitted.length === 1 && svc.emitted[0].op === SOCKET_OPS.MESSAGE_RELAY, 'relay emits MESSAGE_RELAY');
  let settled = false; p.then(() => { settled = true; });
  await new Promise(r => setTimeout(r, 20));
  ok(!settled, 'the relay does NOT resolve before the GM answers (the old optimistic success is gone)');
  svc.handleDeliveryConfirmation({ messageId: 'm3', success: true, forUserId: 'u-player' });
  const r = await p;
  ok(r.success === true && !r.queued, 'GM ack success → relay resolves success');
  ok(svc.sounds.includes('send'), 'send sound plays only once the GM has confirmed');
}

// ═══ 4. GM-side failure → the composer gets a player-facing reason ═══
{
  const svc = makeService();
  const p = svc._relayMessage(msg('m4'));
  await Promise.resolve();
  svc.handleDeliveryConfirmation({ messageId: 'm4', success: false, error: 'Could not access inbox journal', forUserId: 'u-player' });
  const r = await p;
  ok(r.success === false && r.errorCode === 'DELIVERY_FAILED', 'GM ack failure → relay resolves failure');
  ok(/Orphan Audit/.test(r.error) && !/inbox journal/i.test(r.error), 'the error is translated for the player (names the fix, not the repository)');
  ok(r.rawError === 'Could not access inbox journal', 'the raw GM-side text survives on rawError for the console');
  ok(toasts.length === 0, 'a pending relay shows the result in the composer — no duplicate toast');
}

// ═══ 5. Someone else's ack is ignored; silence → RELAY_TIMEOUT ═══
{
  const saved = MessageService.RELAY_ACK_TIMEOUT_MS;
  MessageService.RELAY_ACK_TIMEOUT_MS = 40;
  const svc = makeService();
  const p = svc._relayMessage(msg('m5'));
  await Promise.resolve();
  svc.handleDeliveryConfirmation({ messageId: 'm5', success: true, forUserId: 'u-other' });
  const r = await p;
  ok(r.success === false && r.errorCode === 'RELAY_TIMEOUT', 'an ack addressed to another user is ignored, and no answer in time → RELAY_TIMEOUT');
  ok(/Retry/.test(r.error), 'the timeout copy tells the player what to do');
  ok(!(svc._pendingRelays?.has('m5')), 'the pending entry is cleaned up after the timeout');
  MessageService.RELAY_ACK_TIMEOUT_MS = saved;
}

// ═══ 6. Late / unsolicited acks: only MINE may toast ═══
{
  const svc = makeService(); toasts.length = 0;
  svc.handleDeliveryConfirmation({ messageId: 'zz', success: false, error: 'No recipient inbox target', forUserId: 'u-other' });
  ok(toasts.length === 0, 'a failure for another user never toasts here (the old broadcast-to-everyone bug)');
  svc.handleDeliveryConfirmation({ messageId: 'zz', success: false, error: 'No recipient inbox target', forUserId: 'u-player' });
  ok(toasts.length === 1 && /No inbox exists/.test(toasts[0][1]), 'a late failure for ME falls back to a translated toast');
  toasts.length = 0;
  svc.handleDeliveryConfirmation({ messageId: 'zz', success: true, forUserId: 'u-player' });
  ok(toasts.length === 0, 'a late success is logged, not toasted');
}

// ═══ 7. GM side: handleMessageRelay addresses the ack + toasts the GM on failure ═══
{
  game.user = { id: 'u-gm', isGM: true };
  const svc = makeService(); toasts.length = 0;
  svc._deliverMessage = async () => ({ success: false, error: 'Could not access inbox journal' });
  await svc.handleMessageRelay(msg('m7'), 'u-player');
  const ack = svc.emitted.find(e => e.op === SOCKET_OPS.MESSAGE_DELIVERED);
  ok(ack && ack.data.forUserId === 'u-player' && ack.data.success === false, 'GM emits MESSAGE_DELIVERED addressed to the relaying user');
  ok(toasts.some(t => t[0] === 'warn' && /V → Rogue/.test(t[1]) && /inbox journal/.test(t[1])), 'GM is warned with sender → recipient + the raw reason');
  toasts.length = 0; svc.emitted.length = 0;
  svc._deliverMessage = async () => ({ success: true });
  await svc.handleMessageRelay(msg('m8'), 'u-player');
  ok(toasts.length === 0 && svc.emitted[0]?.data.success === true, 'a successful relay acks silently');
  game.user = { id: 'u-player', isGM: false };
}

// ═══ 8. playerFacingError — every known raw string maps, unknown ones are still attributed ═══
{
  const f = MessageService.playerFacingError;
  ok(/Orphan Audit/.test(f('Could not access inbox journal')), 'inbox journal → Orphan Audit hint');
  ok(/No inbox exists/.test(f('No recipient inbox target')), 'no inbox target → check recipient');
  ok(/anonymous sender/i.test(f('Anonymous reply target could not be resolved.')), 'anon target → tell the GM');
  ok(/permission/.test(f('User Player lacks permission to update JournalEntry')), 'permission text → permission hint');
  ok(f('Something odd') === "Delivery failed on the GM's side: Something odd", 'unknown → attributed to the GM side with the raw text');
  ok(/unknown reason/.test(f('')), 'empty → honest unknown');
}

// ═══ 9. Drift guards (static) ═══
{
  const composerJs = readFileSync(`${ROOT}/scripts/ui/MessageComposer/MessageComposerApp.js`, 'utf8');
  const composerHbs = readFileSync(`${ROOT}/templates/message-composer/message-composer.hbs`, 'utf8');
  const keys = [...new Set([...composerJs.matchAll(/_errors\.([A-Za-z_]+)\s*=/g)].map(m => m[1]))];
  ok(keys.length >= 2, `composer sets at least two error keys (${keys.join(', ')})`);
  for (const k of keys) {
    ok(new RegExp(`\\{\\{errors\\.${k}\\}\\}`).test(composerHbs), `composer template renders errors.${k} (it set '${k}' silently before)`);
  }
  ok(/result\.queued/.test(composerJs), 'composer branches on result.queued (a queued send is not shown as Delivered)');

  // Every failure return in the send/deliver services carries a reason.
  for (const file of ['scripts/services/MessageService.js', 'scripts/data/MessageRepository.js']) {
    const src = readFileSync(`${ROOT}/${file}`, 'utf8');
    const bare = [];
    let i = 0;
    while ((i = src.indexOf('success: false', i)) !== -1) {
      const end = src.indexOf('}', i);
      const obj = src.slice(i, end);
      if (!/error\s*:/.test(obj) && !/roll\s*:/.test(obj)) bare.push(src.slice(0, i).split('\n').length);
      i = end;
    }
    ok(bare.length === 0, `${file}: every { success: false } carries an error (bare at lines: ${bare.join(', ') || 'none'})`);
  }

  const sockets = readFileSync(`${ROOT}/scripts/integrations/SocketHandlers.js`, 'utf8');
  ok(/handleMessageRelay\(data,\s*sender\)/.test(sockets), 'SocketHandlers passes the relaying user id into handleMessageRelay');
}

console.log(`\ntest-send-feedback: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
