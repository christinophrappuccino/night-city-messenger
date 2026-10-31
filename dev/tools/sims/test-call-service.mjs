// Sim: the REAL CallService over mocked clients talking through a scripted socket (build plan §11.6).
// Two players and a GM: numbers (assign / relay / taken), a player↔player call (ring → answer → hang up → both log
// pages), decline, the caller cancelling, a player calling an NPC (the GM answers as the identity), call waiting +
// hold, no signal, an offline player, the GM dropping a call, and the GM watching every call.
//   node dev/tools/sims/test-call-service.mjs
import { pathToFileURL, fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.error('FAIL:', m)); };

const MODULE_ID = 'night-city-messenger';
// timers never fire on their own: the sim drives time
globalThis.setTimeout = () => 0; globalThis.clearTimeout = () => {};
globalThis.setInterval = () => 0; globalThis.clearInterval = () => {};

// ─── the shared world ───
const users = [
  { id: 'gm', name: 'GM', isGM: true, active: true },
  { id: 'u1', name: 'Kiri', isGM: false, active: true },
  { id: 'u2', name: 'Marta', isGM: false, active: true },
  { id: 'u3', name: 'Off', isGM: false, active: false },
];
const owners = { v: ['u1'], judy: ['u2'], rache: ['u1'], ghost: ['u3'] };
const worldSettings = { phoneLines: {}, callsEnabled: true, callHomeCode: '+1', callRingSeconds: 30, callModes: ['loud', 'type', 'dictate'], callDefaultMode: 'loud', callUnknownNumbers: 'not-in-service' };
const contacts = [{ id: 'rogue', name: 'Rogue', phone: '' }, { id: 'queen', name: 'Queen of Hearts', phone: '', identityOf: 'rogue' }];
const journals = new Map();
const pagesOf = (owner) => journals.get(owner)?.pages.contents || [];

function makeActor(id, name, me) {
  const flags = {};
  return { id, name, hasPlayerOwner: !!owners[id]?.length, img: '',
    get isOwner() { return me.isGM || (owners[id] || []).includes(me.id); },
    testUserPermission: (u) => u.isGM || (owners[id] || []).includes(u.id),
    getFlag: (_m, k) => flags[k], setFlag: async (_m, k, v) => { flags[k] = v; }, unsetFlag: async (_m, k) => { delete flags[k]; } };
}

const bus = [];   // the socket: messages in flight
const clients = {};
async function makeClient(userId) {
  const me = users.find((u) => u.id === userId);
  const listeners = new Map();
  const events = [];
  const clientSettings = { callSilent: false, callScheme: { scheme: 'ncm' } };
  const actors = new Map(['v', 'judy', 'rache', 'ghost'].map((id) => [id, makeActor(id, id[0].toUpperCase() + id.slice(1), me)]));
  me.character = actors.get({ u1: 'v', u2: 'judy' }[userId]) || null;   // the assigned character (resolveOperator)
  const g = {
    user: me,
    users: Object.assign([...users], { get: (id) => users.find((u) => u.id === id), get activeGM() { return users.find((u) => u.isGM && u.active) || null; } }),
    actors: { get: (id) => actors.get(id) },
    scenes: { viewed: { name: 'Watson' } },
    settings: { get: (_m, k) => (k in clientSettings ? clientSettings[k] : worldSettings[k]),
      set: async (_m, k, v) => { if (!me.isGM && !(k in clientSettings)) throw new Error('players cannot write world settings'); (k in clientSettings ? clientSettings : worldSettings)[k] = JSON.parse(JSON.stringify(v)); } },
    nightcity: {
      eventBus: { on: (ev, cb) => { (listeners.get(ev) || listeners.set(ev, []).get(ev)).push(cb); return { unsubscribe() {} }; }, emit: (ev, d) => { events.push([ev, d]); (listeners.get(ev) || []).forEach((cb) => cb(d)); } },
      socketManager: { emit: (op, data) => bus.push({ op, data, sender: userId }), register() {} },
      soundService: { play: (id) => events.push(['sound', id]) },
      masterContactService: { getAll: () => contacts, getContact: (id) => contacts.find((c) => c.id === id) || null, getByActorId: () => null,
        updateContact: async (id, u) => { Object.assign(contacts.find((c) => c.id === id), u); } },
      networkService: { currentNetwork: { id: 'CITINET', name: 'CitiNet', type: 'PUBLIC', signalStrength: 78, theme: { color: '#19f3f7' } }, currentNetworkId: 'CITINET', signalStrength: 78, isDeadZone: false, isNodeDead: false },
      messageRepository: { getInboxJournal: async (owner) => {
        if (!journals.has(owner)) journals.set(owner, { id: `j-${owner}`, pages: { contents: [] },
          createEmbeddedDocuments: async (_t, docs) => { if (!clients[userId].g.user.isGM) throw new Error('players cannot write inboxes'); journals.get(owner).pages.contents.push(...docs.map((d, i) => { const pg = { id: `p${Date.now()}${i}${Math.random().toString(36).slice(2, 6)}`, ...d };
            pg.update = async (u) => { for (const [k, v] of Object.entries(u)) { const parts = k.split('.'); let o = pg; while (parts.length > 1) { const p = parts.shift(); o = (o[p] ??= {}); } o[parts[0]] = v; } };
            pg.delete = async () => { const list = journals.get(owner).pages.contents; list.splice(list.indexOf(pg), 1); };
            return pg; })); },
          updateEmbeddedDocuments: async () => {} });
        return journals.get(owner);
      } },
      timeService: { getCurrentTime: () => '2045-08-15T22:41:00.000Z' },
    },
    modules: new Map(),
  };
  return { g, events, me, actors, clientSettings };
}

// helpers: run code as a client; deliver the socket queue
const as = async (uid, fn) => { globalThis.game = clients[uid].g; return fn(clients[uid].svc); };
async function flush() {
  for (let guard = 0; bus.length && guard < 200; guard++) {
    const { op, data, sender } = bus.shift();
    for (const uid of Object.keys(clients)) {
      if (uid === sender) continue;
      globalThis.game = clients[uid].g;
      const s = clients[uid].svc;
      if (op === 'call:event') s.handleSocket(data, sender);
      else if (op === 'call:logRequest') await s.handleLogRequest(data);
      else if (op === 'call:lineRequest') await s.handleLineRequest(data, sender);
      else if (op === 'call:vmRequest') await s.handleVoicemailRequest(data, sender);
      else if (op === 'call:audio') await s.handleAudio(data, sender);
    }
  }
}

globalThis.foundry = { utils: {} };
globalThis.ui = { notifications: { warn() {}, info() {} } };
globalThis.CSS = { escape: (s) => s };
for (const uid of ['gm', 'u1', 'u2']) clients[uid] = await makeClient(uid);
globalThis.game = clients.gm.g;
const { CallService } = await imp('scripts/services/CallService.js');
for (const uid of Object.keys(clients)) { globalThis.game = clients[uid].g; clients[uid].svc = new CallService(); }
const evts = (uid, name) => clients[uid].events.filter(([e]) => e === name).map(([, d]) => d);

// ═══ 1. Numbers ═══
{
  await as('gm', (s) => s.assignNumber({ actorId: 'v', number: '+1 (555) 0177-42' }));
  ok(worldSettings.phoneLines['+1555017742']?.owner.actorId === 'v' && worldSettings.phoneLines['+1555017742'].owner.kind === 'player', 'the GM gives V a number (a player line)');
  ok(worldSettings.phoneLines['+1555017742'].owner.userIds.join() === 'u1', 'the line remembers V’s players');
  ok(clients.gm.actors.get('v').getFlag(MODULE_ID, 'phone') === '+1 (555) 0177-42', 'mirrored to the actor flag');
  // a player picks their own: relayed
  const r = await as('u2', (s) => s.assignNumber({ actorId: 'judy', number: '555 0131-88' }));
  ok(r.ok && r.relayed && !worldSettings.phoneLines['+1555013188'], 'a player’s pick relays to the GM');
  await flush();
  ok(worldSettings.phoneLines['+1555013188']?.owner.actorId === 'judy', 'the GM wrote it');
  const taken = await as('u1', (s) => s.assignNumber({ actorId: 'v', number: '+1 555 0131 88' }));
  ok(!taken.ok && taken.error.includes('belongs'), 'a taken number is refused (any spelling)');
  // a player cannot give a number to someone else's character
  await as('u1', (s) => s._relayLine({ op: 'assign', actorId: 'judy', number: '555 0999 99' })); await flush();
  ok(!worldSettings.phoneLines['+1555099999'], 'the GM refuses a player changing a character they do not own');
  await as('gm', (s) => s.assignNumber({ actorId: 'rache', number: '555 0118-60' }));
  await as('gm', (s) => s.assignNumber({ contactId: 'rogue', number: '555 0119-07' }));
  await as('gm', (s) => s.assignNumber({ contactId: 'queen', number: '555 0342-90' }));
  await as('gm', (s) => s.assignNumber({ actorId: 'ghost', number: '555 0666-66' }));
  ok(contacts[0].phone === '555 0119-07' && worldSettings.phoneLines['+1555011907'].owner.kind === 'npc', 'an NPC line, mirrored to the contact');
  ok(await as('u1', (s) => s.numberOf('v')) === '+1 (555) 0177-42' && (await as('u1', (s) => s.linesFor('v'))).length === 1, 'numberOf / linesFor');
  const sugg = await as('u1', (s) => s.suggestNumbers({ count: 6, seed: 4 }));
  ok(sugg.length === 6 && sugg.every((x) => /^\+1 \(555\) 555-01\d\d$/.test(x.number)), 'suggestions: the default Night City region, fiction-safe');
  // re-assigning moves the line
  await as('gm', (s) => s.assignNumber({ actorId: 'rache', number: '555 0118-61' }));
  ok(!worldSettings.phoneLines['+1555011860'] && worldSettings.phoneLines['+1555011861'], 'a new number replaces the old one');
}

// ═══ 2. Player → player: ring, answer, hang up, logs ═══
let callId;
{
  const r = await as('u1', (s) => s.placeCall('555 0131 88'));
  ok(r.ok && r.call.state === 'dialing' && r.call.to.kind === 'player', 'V dials Judy');
  callId = r.call.id;
  ok(bus.some((m) => m.op === 'call:event' && m.data.type === 'ring'), 'a ring goes out');
  await flush();
  const judyRing = evts('u2', 'call:ringing').at(-1);
  ok(judyRing?.role === 'callee' && judyRing.call.state === 'ringing', 'Judy’s client rings');
  ok(evts('gm', 'call:ringing').at(-1)?.role === 'watch', 'the GM sees it on the switchboard, without ringing');
  ok(clients.u2.events.some(([e, d]) => e === 'sound' && d === 'call-ring'), 'Judy hears the ring');
  await as('u2', (s) => s.answer(callId)); await flush();
  ok(clients.u1.svc.calls.get(callId).state === 'live' && clients.u2.svc.calls.get(callId).state === 'live', 'answered: live on both sides');
  ok(clients.gm.svc.calls.get(callId)?.state === 'live', 'the GM’s switchboard sees it live');
  ok(clients.u1.events.some(([e, d]) => e === 'sound' && d === 'call-connect'), 'V hears it connect');
  await as('u1', (s) => s.hangup(callId)); await flush();
  ok(clients.u1.svc.calls.get(callId).outcome === 'answered' && clients.u2.svc.calls.get(callId).outcome === 'answered', 'hung up on both sides');
  const vLog = pagesOf('v').map((p) => p.flags[MODULE_ID].callLog); const jLog = pagesOf('judy').map((p) => p.flags[MODULE_ID].callLog);
  ok(vLog.length === 1 && vLog[0].direction === 'out' && vLog[0].other.actorId === 'judy', 'V’s inbox gets an outgoing log page');
  ok(jLog.length === 1 && jLog[0].direction === 'in' && jLog[0].outcome === 'answered' && !jLog[0].seen, 'Judy’s gets an incoming one (unseen)');
  ok(pagesOf('v').every((p) => !p.flags[MODULE_ID].messageId), 'log pages carry no messageId — no mail reader shows them');
  ok((await as('u1', (s) => s.getLog('v'))).length === 1, 'getLog reads them back');
}

// ═══ 3. Decline, cancel, offline ═══
{
  const r = await as('u1', (s) => s.placeCall('555 0131 88')); await flush();
  await as('u2', (s) => s.decline(r.call.id)); await flush();
  ok(clients.u1.svc.calls.get(r.call.id).state === 'voicemail' && clients.u1.svc.calls.get(r.call.id).vmWhy === 'declined', 'declined: the caller goes to her voicemail (her line takes messages)');
  await as('u1', (s) => s.hangup(r.call.id)); await flush();
  ok(clients.u1.svc.calls.get(r.call.id).outcome === 'missed', 'hanging up on the voicemail screen leaves nothing (no answer)');
  const c = await as('u1', (s) => s.placeCall('555 0131 88')); await flush();
  await as('u1', (s) => s.cancel(c.call.id)); await flush();
  ok(clients.u2.svc.calls.get(c.call.id).outcome === 'missed' && evts('u2', 'call:missed').some((e) => e.call.id === c.call.id), 'the caller hangs up first: Judy has a missed call');
  const before = bus.length;
  const off = await as('u1', (s) => s.placeCall('555 0666 66'));
  ok(off.ok && bus.length === before, 'an offline player: no ring is sent');
}

// ═══ 4. A player calls an NPC: the GM answers as the identity ═══
{
  const r = await as('u1', (s) => s.placeCall('555 0342 90'));
  ok(r.call.to.kind === 'npc' && r.call.to.contactId === 'queen', 'calling an alias number reaches that identity');
  await flush();
  ok(evts('gm', 'call:ringing').at(-1)?.role === 'callee', 'the GM’s phone rings for the NPC');
  ok(!evts('u2', 'call:ringing').some((e) => e.call.id === r.call.id && e.role === 'callee'), 'no player rings for an NPC line');
  await as('gm', (s) => s.answer(r.call.id)); await flush();
  ok(clients.u1.svc.calls.get(r.call.id).state === 'live' && clients.u1.svc.calls.get(r.call.id).answeredBy === 'gm', 'live, answered by the GM');
  await as('gm', (s) => s.hangup(r.call.id)); await flush();
  const q = pagesOf('queen').map((p) => p.flags[MODULE_ID].callLog);
  ok(q.length === 1 && q[0].direction === 'in', 'the NPC identity’s inbox gets the log');
}

// ═══ 5. Call waiting + hold ═══
{
  const a = await as('u1', (s) => s.placeCall('555 0131 88')); await flush();
  await as('u2', (s) => s.answer(a.call.id)); await flush();
  // Rache (u1's other character) calls Judy while she's on with V — use the GM calling as Rogue instead (u1 is busy)
  const b = await as('gm', (s) => s.placeCall('555 0131 88', { contactId: 'rogue' })); await flush();
  const w = evts('u2', 'call:ringing').at(-1);
  ok(w.call.id === b.call.id && w.waiting === true, 'Judy gets a waiting ring');
  ok(clients.u2.events.some(([e, d]) => e === 'sound' && d === 'call-waiting'), 'with the call-waiting tone');
  await as('u2', (s) => s.answer(b.call.id)); await flush();
  ok(clients.u2.svc.calls.get(a.call.id).state === 'held' && clients.u2.svc.calls.get(b.call.id).state === 'live', 'Hold & answer: V on hold, Rogue live');
  ok(clients.u1.svc.calls.get(a.call.id).remoteHeld === true, 'V sees he is on hold');
  await as('u2', (s) => s.resume(a.call.id)); await flush();
  ok(clients.u2.svc.calls.get(a.call.id).state === 'live' && clients.u2.svc.calls.get(b.call.id).state === 'held', 'swap back');
  await as('u2', (s) => s.hangup(a.call.id)); await as('u2', (s) => s.hangup(b.call.id)); await flush();
  ok(clients.gm.svc.calls.get(b.call.id).state === 'ended', 'both end');
}

// ═══ 6. No signal; the GM drops a call ═══
{
  clients.u1.g.nightcity.networkService.isDeadZone = true;
  const r = await as('u1', (s) => s.placeCall('555 0131 88'));
  ok(r.ok && r.call.state === 'ended' && r.call.outcome === 'no-signal', 'no signal: the call ends at once');
  clients.u1.g.nightcity.networkService.isDeadZone = false;
  const nis = await as('u1', (s) => s.placeCall('555 4040 40'));
  ok(nis.call.outcome === 'not-in-service', 'an unowned number: not in service');
  const own = await as('u1', (s) => s.placeCall('555 0177 42'));
  ok(!own.ok && own.error.includes('own'), 'your own number');
  const c = await as('u1', (s) => s.placeCall('555 0131 88')); await flush();
  await as('u2', (s) => s.answer(c.call.id)); await flush();
  await as('gm', (s) => s.drop(c.call.id)); await flush();
  ok(clients.u1.svc.calls.get(c.call.id).outcome === 'dropped' && clients.u2.svc.calls.get(c.call.id).outcome === 'dropped', 'the GM drops the line for both');
  ok(clients.u1.events.some(([e, d]) => e === 'sound' && d === 'call-drop'), 'with the drop sound');
  // losing signal mid-call
  const d = await as('u1', (s) => s.placeCall('555 0131 88')); await flush();
  await as('u2', (s) => s.answer(d.call.id)); await flush();
  clients.u2.g.nightcity.networkService.isNodeDead = true;
  await as('u2', (s) => s.checkSignal()); await flush();
  ok(clients.u1.svc.calls.get(d.call.id).outcome === 'dropped', 'a node going down on Judy’s scene drops the call');
  clients.u2.g.nightcity.networkService.isNodeDead = false;
}

// ═══ 6b. Typed lines (phase 2): modes, lines both ways, typing, the GM listening, the transcript in the log ═══
{
  const M = await imp('scripts/utils/callModel.js');
  ok(M.makeLine({ side: 'caller', text: '  hi \n there ' }).text === 'hi there' && M.makeLine({ side: 'caller', text: '   ' }) === null && M.makeLine({ side: 'x', text: 'a' }) === null, 'makeLine: one line, trimmed, never empty, a real side');
  ok(M.makeLine({ side: 'callee', text: 'x'.repeat(900) }).text.length === M.LINE_MAX, 'makeLine: capped');
  const base = { id: 'c', lines: [] }; const l1 = M.makeLine({ side: 'caller', text: 'a' });
  ok(M.addLine(M.addLine(base, l1), l1).lines.length === 1, 'addLine: an echo is kept once');
  ok(M.typeOutMs('abc') === 90 && M.typeOutMs('x'.repeat(500)) === 2400, 'typeOutMs: 30 ms a character, capped');
  ok(M.BUILT_MODES.join() === 'loud,type,dictate', 'built modes: Out loud, Type, Dictate (phase 5)');
  ok(clients.u1.svc.usableModes.join() === 'loud,type' && clients.u1.svc.offeredModes.join() === 'loud,type,dictate' && /speech/.test(clients.u1.svc.dictateBlock), 'a browser that cannot dictate: the chip shows, greyed, with the reason; it is not usable');

  const r = await as('u1', (s) => s.placeCall('555 0131 88')); await flush();
  const id = r.call.id;
  await as('u2', (s) => s.answer(id)); await flush();
  ok(clients.u1.svc.modeFor(id) === 'loud', 'a call starts in the GM default mode');
  await as('u1', (s) => s.setMode(id, 'type'));
  ok(clients.u1.svc.modeFor(id) === 'type' && clients.u2.svc.modeFor(id) === 'loud', 'each side picks its own mode');
  await as('u1', (s) => s.setMode(id, 'dictate'));
  ok(clients.u1.svc.modeFor(id) === 'type', 'a mode this browser cannot use is refused');
  // typing
  await as('u1', (s) => s.sendTyping(id, true)); await flush();
  ok(evts('u2', 'call:typing').at(-1)?.on === true && evts('u2', 'call:typing').at(-1).side === 'caller', 'Judy sees V typing');
  const n = bus.length; await as('u1', (s) => s.sendTyping(id, true));
  ok(bus.length === n, 'typing is throttled (no second notice inside 2 s)');
  // lines both ways
  const before = bus.length;
  const sent = await as('u1', (s) => s.sendLine(id, 'Evelyn\'s gone dark.'));
  const msg = bus.slice(before).find((m) => m.data.type === 'line');
  ok(sent && msg?.data.line.text === 'Evelyn\'s gone dark.' && !('lines' in msg.data.call), 'a line goes out on its own — the transcript never rides along');
  ok(msg.data.userIds.includes('gm'), 'every GM gets the line (switchboard / Listen in)');
  await flush();
  ok(clients.u2.svc.calls.get(id).lines.length === 1 && evts('u2', 'call:line').at(-1)?.mine === false, 'Judy gets it (to type out)');
  ok(clients.gm.svc.calls.get(id).lines.length === 1, 'the GM watching has it too');
  await as('u2', (s) => s.sendLine(id, 'Last ping was Jig-Jig Street.')); await flush();
  ok(clients.u1.svc.calls.get(id).lines.map((l) => l.side).join() === 'caller,callee', 'and back: both sides hold the whole conversation');
  ok(await as('u1', (s) => s.sendLine(id, '   ')) === null, 'an empty line is not sent');
  // a held call takes no lines
  await as('u1', (s) => s.hold(id)); await flush();
  ok(await as('u1', (s) => s.sendLine(id, 'hello?')) === null, 'no lines on hold');
  await as('u1', (s) => s.resume(id)); await flush();
  ok(clients.u1.svc.calls.get(id).lines.length === 2, 'hold/resume keep the transcript (merges never drop it)');
  await as('u1', (s) => s.hangup(id)); await flush();
  const page = pagesOf('v').map((p) => p.flags?.[MODULE_ID]?.callLog).find((l) => l?.callId === id);
  ok(page?.mode === 'type' && page.lines.length === 2 && page.lines[0].name === 'V' && page.lines[1].side === 'callee', 'the log keeps the transcript with names, and marks the call typed');
  ok(pagesOf('judy').map((p) => p.flags?.[MODULE_ID]?.callLog).find((l) => l?.callId === id)?.lines.length === 2, 'both sides’ log pages carry it');
}

// ═══ 6c. Voicemail (phase 3a): unanswered → greeting → tone → a message, the GM writes it, the owner hears it ═══
{
  const V = await imp('scripts/utils/voicemail.js');
  ok(V.sanitizeLineSettings({}).voicemail.on === true && V.sanitizeLineSettings({}).greeting.kind === 'default', 'a new number: default greeting, takes messages');
  ok(V.sanitizeLineSettings({ greeting: { kind: 'typed', text: '' } }).greeting.kind === 'default', 'a typed greeting with no words falls back to the default');
  ok(V.greetingFor({ greeting: { kind: 'tts', text: 'Leave it short.' } }).readOut, 'a read-out greeting');
  ok(!V.goesToVoicemail({ toKind: 'unowned', why: 'missed' }) && !V.goesToVoicemail({ toKind: 'player', why: 'not-in-service' }), 'never for a number nobody owns, never when the call never got through');
  ok(!V.goesToVoicemail({ toKind: 'player', why: 'missed', settings: { voicemail: { on: false } } }), 'never for a line that takes no messages');
  ok(V.makeVoicemail({ text: '   ' }) === null && V.makeVoicemail({ text: 'x'.repeat(2000) }).text.length === V.VOICEMAIL_MAX, 'makeVoicemail: never empty, capped');

  // V calls Judy, nobody answers → her voicemail
  const r = await as('u1', (s) => s.placeCall('555 0131 88')); await flush();
  const id = r.call.id;
  await as('u1', (s) => s.cancel(id, 'timeout')); await flush();
  const c1 = clients.u1.svc.calls.get(id);
  ok(c1.state === 'voicemail' && c1.vmStep === 'greet' && c1.greeting.text === V.DEFAULT_GREETING, 'no answer: V gets her greeting (the default one)');
  ok(clients.u2.svc.calls.get(id).outcome === 'missed', 'Judy still has a missed call');
  await as('u1', (s) => s.skipGreeting(id));
  ok(clients.u1.svc.calls.get(id).vmStep === 'leave' && clients.u1.events.some(([e, d]) => e === 'sound' && d === 'voicemail-beep'), 'the tone, and the box opens');
  ok(!(await as('u1', (s) => s.leaveVoicemail(id, '   '))).ok, 'an empty message is not left');
  const left = await as('u1', (s) => s.leaveVoicemail(id, 'Judy — call me back. Pier 4.'));
  ok(left.ok && bus.some((m) => m.op === 'call:vmRequest' && m.data.op === 'leave'), 'a player hands the message to the GM');
  await flush();
  ok(clients.u1.svc.calls.get(id).outcome === 'voicemail', 'the call ends as Voicemail sent');
  const vms = await as('u2', (s) => s.getVoicemails('judy'));
  ok(vms.length === 1 && vms[0].text.includes('Pier 4') && !vms[0].heard && vms[0].from.actorId === 'v', 'the GM wrote it into Judy’s inbox');
  ok(evts('u2', 'call:voicemail').some((e) => e.vm?.vmId === vms[0].vmId), 'Judy is told');
  ok(pagesOf('judy').every((p) => !p.flags[MODULE_ID].messageId), 'a voicemail page has no messageId — no mail reader shows it');
  await as('u2', (s) => s.setVoicemailHeard('judy', vms[0].vmId, true)); await flush();
  ok((await as('u2', (s) => s.getVoicemails('judy')))[0].heard, 'Judy marks it heard (relayed to the GM)');
  await as('u2', (s) => s.deleteVoicemail('judy', vms[0].vmId)); await flush();
  ok((await as('u2', (s) => s.getVoicemails('judy'))).length === 0, 'and deletes it');
  // nobody can leave a message as someone else
  const forged = { vmId: 'forged', from: { actorId: 'judy', name: 'Judy' }, to: { actorId: 'v', name: 'V' }, text: 'it was me' };
  bus.push({ op: 'call:vmRequest', data: { op: 'leave', vm: forged }, sender: 'u1' }); await flush();
  ok(!pagesOf('v').some((p) => p.flags[MODULE_ID].voicemail?.vmId === 'forged'), 'a message "from" a character the sender does not own is refused');

  // do not disturb: no ring, straight to voicemail (Judy sets it herself, relayed)
  await as('u2', (s) => s.saveLineSettings('555 0131 88', { greeting: { kind: 'typed', text: 'Busy. Talk later.' }, voicemail: { on: true, dnd: true } })); await flush();
  ok(clients.gm.svc.lineSettings('555 0131 88').voicemail.dnd, 'Judy’s My line reaches the GM');
  const before = bus.length;
  const d = await as('u1', (s) => s.placeCall('555 0131 88'));
  ok(!bus.slice(before).some((m) => m.data?.type === 'ring') && clients.u1.svc.calls.get(d.call.id).state === 'voicemail' && clients.u1.svc.calls.get(d.call.id).greeting.text === 'Busy. Talk later.', 'do not disturb: no ring, her own greeting');
  await as('u1', (s) => s.hangup(d.call.id));
  // a line that takes no messages: declined just ends
  await as('gm', (s) => s.saveLineSettings('555 0131 88', { voicemail: { on: false } }));
  const n = await as('u1', (s) => s.placeCall('555 0131 88')); await flush();
  await as('u2', (s) => s.decline(n.call.id)); await flush();
  ok(clients.u1.svc.calls.get(n.call.id).outcome === 'declined', 'messages off: declined is just declined');
  await as('gm', (s) => s.saveLineSettings('555 0131 88', {}));
  // a player calls an NPC; the GM declines → the NPC's voicemail, written into the identity's inbox
  const q = await as('u1', (s) => s.placeCall('555 0119 07')); await flush();
  await as('gm', (s) => s.decline(q.call.id)); await flush();
  ok(clients.u1.svc.calls.get(q.call.id).state === 'voicemail', 'an NPC that does not pick up has voicemail too');
  await as('u1', (s) => s.skipGreeting(q.call.id));
  await as('u1', (s) => s.leaveVoicemail(q.call.id, 'Rogue, it is V.')); await flush();
  ok((await as('gm', (s) => s.getVoicemails('rogue'))).length === 1, 'the GM finds it in Rogue’s inbox');
  // a number nobody owns never goes to voicemail
  const u = await as('u1', (s) => s.placeCall('555 0999 00'));
  ok(u.call?.outcome === 'not-in-service', 'a number nobody owns: not in service, no voicemail');
  ok((await import('node:fs')).readFileSync(`${ROOT}/scripts/init/registerCallSystem.js`, 'utf8').includes('SOCKET_OPS.CALL_VM_REQUEST'), 'the voicemail request is registered');
}

// ═══ 6d. Recorded voice (phase 3b): the relay in pieces, the GM saves the file, recorded greetings, the fallbacks ═══
{
  const V = await imp('scripts/utils/voicemail.js');
  ok(V.recordingsToPurge([{ kind: 'audio', audio: 'a', at: 0 }, { kind: 'audio', audio: 'b', at: Date.now() }, { kind: 'typed', at: 0 }], 30).length === 1, 'purge: only recordings older than the keep setting');
  ok(V.recordingsToPurge([{ kind: 'audio', audio: 'a', at: 0 }], 0).length === 0, 'purge: 0 days keeps everything');
  ok(V.greetMs('', { duration: 4 }) === 4700, 'a recorded greeting holds the tone until it has played');
  ok(V.sanitizeLineSettings({ greeting: { kind: 'recorded' } }).greeting.kind === 'default', 'a recorded greeting with no recording falls back to the default');

  const uploads = [];
  let uploadFails = false;
  globalThis.FilePicker = {
    createDirectory: async () => {},
    upload: async (source, dir, file) => { if (uploadFails) throw new Error('no uploads here'); uploads.push({ source, dir, name: file.name, size: file.size }); return { path: `${dir}/${file.name}` }; },
  };
  for (const uid of Object.keys(clients)) clients[uid].g.world = { id: 'nc' };
  const judyNo = '555 0131 88';
  await as('gm', (s) => s.saveLineSettings(judyNo, {}));
  const ringOut = async () => { const r = await as('u1', (s) => s.placeCall(judyNo)); await flush(); await as('u1', (s) => s.cancel(r.call.id, 'timeout')); await flush(); await as('u1', (s) => s.skipGreeting(r.call.id)); return r.call.id; };

  // a voice message: in pieces to the GM, saved as a file, written as a voicemail
  let id = await ringOut();
  const b64 = 'A'.repeat(250000);
  const before = bus.length;
  const left = await as('u1', (s) => s.leaveVoicemail(id, '', { kind: 'audio', audio: { base64: b64, mime: 'audio/webm;codecs=opus', ms: 12000 } }));
  const pieces = bus.slice(before).filter((m) => m.op === 'call:audio');
  ok(left.ok && pieces.length === 3 && pieces.every((m) => m.data.chunk.length <= 120000) && !!pieces.at(-1).data.meta && !pieces[0].data.meta, 'a player sends the recording in pieces; what to do with it rides the last one');
  await flush();
  ok(uploads.length === 1 && uploads[0].dir === 'worlds/nc/ncm-voicemail' && uploads[0].name.endsWith('.webm') && uploads[0].source === 'data', 'the GM saves it as a file in the world\'s ncm-voicemail folder');
  const vm = (await as('u2', (s) => s.getVoicemails('judy'))).find((v) => v.kind === 'audio');
  ok(vm && vm.audio.startsWith('worlds/nc/ncm-voicemail/') && vm.duration === 12 && clients.u1.svc.calls.get(id).outcome === 'voicemail', 'the voicemail points at the file, with its length');

  // nobody can send a recording as someone else
  bus.push({ op: 'call:audio', data: { uploadId: 'f1', i: 0, n: 1, chunk: 'AAAA', mime: 'audio/webm', meta: { purpose: 'vm', vm: { from: { actorId: 'v' }, to: { actorId: 'judy' }, kind: 'audio' } } }, sender: 'u2' });
  const nUp = uploads.length; await flush();
  ok(uploads.length === nUp, 'a recording "from" a character the sender does not own is never saved');
  // pieces from two senders never mix
  bus.push({ op: 'call:audio', data: { uploadId: 'mix', i: 0, n: 2, chunk: 'AAAA', mime: 'audio/webm', meta: null }, sender: 'u1' });
  bus.push({ op: 'call:audio', data: { uploadId: 'mix', i: 1, n: 2, chunk: 'AAAA', mime: 'audio/webm', meta: { purpose: 'vm', vm: { from: { actorId: 'judy' }, to: { actorId: 'v' }, kind: 'audio' } } }, sender: 'u2' });
  await flush();
  ok(uploads.length === nUp, 'a piece from another user never joins an upload');

  // too long, or recordings switched off
  id = await ringOut();
  ok(!(await as('u1', (s) => s.leaveVoicemail(id, '', { kind: 'audio', audio: { base64: 'A'.repeat(3000004), mime: 'audio/webm', ms: 1 } }))).ok, 'a recording over the size cap is refused');
  worldSettings.voicemailRecording = false;
  ok(/switched recorded voicemail off/.test((await as('u1', (s) => s.leaveVoicemail(id, '', { kind: 'audio', audio: { base64: 'AAAA', mime: 'audio/webm', ms: 1000 } }))).error || ''), 'recordings switched off: refused with the reason');
  worldSettings.voicemailRecording = true;
  await as('u1', (s) => s.hangup(id));

  // the world cannot take files: a short recording is kept inside the message
  uploadFails = true;
  id = await ringOut();
  await as('u1', (s) => s.leaveVoicemail(id, '', { kind: 'audio', audio: { base64: 'AAAA'.repeat(1000), mime: 'audio/webm;codecs=opus', ms: 3000 } })); await flush();
  const inline = (await as('u2', (s) => s.getVoicemails('judy'))).find((v) => v.kind === 'audio' && v.audio.startsWith('data:'));
  ok(inline && inline.audio.startsWith('data:audio/webm;base64,'), 'uploads impossible: a short recording is kept inside the message');
  uploadFails = false;

  // a recorded greeting (Judy's My line), then a caller hears it
  await as('u2', (s) => s.saveRecordedGreeting(judyNo, { greeting: { kind: 'recorded', text: 'It is Judy.' }, voicemail: { on: true } }, { base64: 'AAAA', mime: 'audio/webm', ms: 4000 })); await flush();
  const g = clients.gm.svc.lineSettings(judyNo).greeting;
  ok(g.kind === 'recorded' && g.audio.includes('greeting-') && g.duration === 4 && g.text === 'It is Judy.', 'a player\'s recorded greeting is saved through the GM, with its words');
  ok(!(await as('u2', (s) => s.saveRecordedGreeting(judyNo, {}, { base64: 'AAAA', mime: 'audio/webm', ms: 25000 }))).ok, 'a greeting is 20 seconds at most');
  const r = await as('u1', (s) => s.placeCall(judyNo)); await flush();
  await as('u1', (s) => s.cancel(r.call.id, 'timeout'));
  const c = clients.u1.svc.calls.get(r.call.id);
  ok(c.greeting.kind === 'recorded' && c.greeting.audio === g.audio, 'a caller reaching her voicemail gets her recording');
  await as('u1', (s) => s.hangup(r.call.id));
  ok((await import('node:fs')).readFileSync(`${ROOT}/scripts/init/registerCallSystem.js`, 'utf8').includes('SOCKET_OPS.CALL_AUDIO'), 'the recording relay is registered');
}

// ═══ 6e. The network (phase 4): drops with a reason, no signal on the ring, the glitch, a withheld number + trace, taps, the log ═══
{
  const judyNo = '555 0131 88';
  for (const uid of Object.keys(clients)) {
    const n = clients[uid].g.nightcity.networkService;
    clients[uid].g.scenes.viewed = { id: 'watson', name: 'Watson' };
    n.getSceneBlocks = () => ({}); n.getNodes = () => [];
    n.getAllNetworks = () => [{ id: 'CITINET', name: 'CitiNet', theme: { color: '#19f3f7' } }];
  }
  const taps = [], rows = [];
  clients.gm.g.nightcity.networkService.tapDelivery = async (data, heard) => { taps.push(data); heard?.push({ actorId: 'rache', name: 'Rache', node: 'Watson relay' }); return 1; };
  clients.gm.g.nightcity.accessLogService = { addEntry: (type, data) => rows.push({ type, ...data }) };
  clients.gm.g.nightcity.messageRepository.identifyInbox = () => ({});
  Object.defineProperty(clients.gm.g, 'journal', { get: () => [...journals.values()], configurable: true });
  const settle = async () => { globalThis.game = clients.gm.g; for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); await flush(); };
  const call = async () => { const r = await as('u1', (s) => s.placeCall(judyNo)); await flush(); await as('u2', (s) => s.answer(r.call.id)); await flush(); return r.call.id; };

  // the line changes under Judy: both ends say why
  let id = await call();
  clients.u2.g.nightcity.networkService.currentNetworkId = 'DARKNET';
  await as('u2', (s) => s.checkSignal()); await flush();
  ok(/Changed network/.test(clients.u2.svc.calls.get(id).dropReason || ''), 'moving to another network drops the call, and says so');
  ok(/^Their end: Changed network/.test(clients.u1.svc.calls.get(id).dropReason || ''), 'the other end hears it was their end');
  clients.u2.g.nightcity.networkService.currentNetworkId = 'CITINET';
  // a node jammed on her scene: named
  id = await call();
  clients.u2.g.nightcity.networkService.isNodeDead = true;
  clients.u2.g.nightcity.networkService.getSceneBlocks = () => ({ CITINET: { state: 'jammed' } });
  clients.u2.g.nightcity.networkService.getNodes = () => [{ name: 'Watson relay' }];
  await as('u2', (s) => s.checkSignal()); await flush();
  ok(clients.u2.svc.calls.get(id).dropReason === 'Watson relay is jammed', 'a jammed node is named');
  clients.u2.g.nightcity.networkService.isNodeDead = false;
  clients.u2.g.nightcity.networkService.getSceneBlocks = () => ({});
  // the GM's own client never drops (an NPC is wherever the NPC is)
  await as('gm', (s) => s.checkSignal());
  ok(true, 'the GM side is never moved off a call');

  // no signal where the callee stands: it never rings, the caller reaches voicemail
  clients.u2.g.nightcity.networkService.isDeadZone = true;
  const ns = await as('u1', (s) => s.placeCall(judyNo)); await flush();
  ok(!clients.u2.svc.calls.has(ns.call.id), 'it never rings in a dead zone');
  ok(clients.u1.svc.calls.get(ns.call.id)?.state === 'voicemail', 'the caller goes to voicemail (she is unreachable)');
  await as('u1', (s) => s.hangup(ns.call.id)); await flush();
  clients.u2.g.nightcity.networkService.isDeadZone = false;

  // the GM glitches a live call; drops one with a reason
  id = await call();
  clients.u1.events.length = 0; clients.u2.events.length = 0;
  await as('gm', (s) => s.glitch(id)); await flush();
  ok(evts('u1', 'call:glitch').some((e) => e.callId === id) && evts('u2', 'call:glitch').some((e) => e.callId === id), 'the glitch reaches both ends');
  await as('gm', (s) => s.drop(id, 'The line was jammed')); await flush();
  ok(clients.u1.svc.calls.get(id).dropReason === 'The line was jammed' && clients.u2.svc.calls.get(id).dropReason === 'The line was jammed', 'a GM drop carries its reason to both, unprefixed');

  // a withheld number: Judy's client never holds who it is
  const anon = await as('gm', (s) => s.placeCall(judyNo, { contactId: 'rogue', anon: true })); await flush();
  const aid = anon.call.id;
  const seen = clients.u2.svc.calls.get(aid);
  ok(seen?.from?.name === 'Unknown caller' && !seen.from.number && !seen.from.contactId, 'the callee sees Unknown caller, no number, no id');
  ok(clients.gm.svc.calls.get(aid).from.name === 'Rogue', 'the GM holds the real caller');
  ok(!clients.u1.svc.calls.has(aid), 'a client the call is not addressed to ignores it (the socket reaches everyone)');
  await as('u2', (s) => s.answer(aid)); await flush();
  ok(clients.u2.svc.calls.get(aid).from.name === 'Unknown caller', 'answering does not unmask it');
  await as('gm', (s) => s.hangup(aid)); await settle();
  const jp = pagesOf('judy').map((p) => p.flags?.[MODULE_ID]?.callLog).find((l) => l?.callId === aid);
  ok(jp && jp.anonCall && jp.from.name === 'Unknown caller' && !jp.other.contactId, 'her log page keeps it masked');
  const rp = pagesOf('rogue').map((p) => p.flags?.[MODULE_ID]?.callLog).find((l) => l?.callId === aid);
  ok(rp?.from?.name === 'Rogue' && rp.from.anon, 'the NPC side page keeps the truth, marked withheld');
  ok(taps.some((t) => t.network === 'CITINET' && t.sentFromScene === 'watson' && /Number withheld/.test(t.subject)), 'a tap on the network catches it — still withheld');
  ok(rp.heardBy?.[0]?.name === 'Rache' && !(jp.heardBy || []).length, 'who listened in rides the NPC page only, never the player’s');
  ok((await as('gm', (s) => s.allLogs())).find((l) => l.callId === aid)?.heardBy?.length === 1, 'the GM log sees who heard it');
  ok(rows.some((r) => r.type === 'call' && /a withheld number/.test(r.actorName) && /heard by 1 tap/.test(r.message) && r.sceneId === 'watson'), 'an Activity-log row, withheld, with the tap count and scene');

  // the trace: a skill check, then the GM reveals it to her alone
  const anon2 = await as('gm', (s) => s.placeCall(judyNo, { contactId: 'rogue', anon: true })); await flush();
  await as('u2', (s) => s.answer(anon2.call.id)); await flush();
  clients.u2.g.nightcity.skillService = { performCheck: async () => ({ success: false }) };
  const miss = await as('u2', (s) => s.traceCall(anon2.call.id)); await flush();
  ok(miss.ok && !miss.traced && clients.u2.svc.calls.get(anon2.call.id).from.name === 'Unknown caller', 'a missed trace reveals nothing');
  clients.u2.g.nightcity.skillService = { performCheck: async () => ({ success: true }) };
  const hit = await as('u2', (s) => s.traceCall(anon2.call.id)); await flush();
  ok(hit.traced && clients.u2.svc.calls.get(anon2.call.id).from.name === 'Rogue' && clients.u2.svc.calls.get(anon2.call.id).traced, 'a hit: the GM reveals the caller to her');
  ok(evts('u2', 'call:traced').some((e) => e.from?.name === 'Rogue') && !evts('u1', 'call:traced').length, 'only the tracer is told');
  await as('u2', (s) => s.hangup(anon2.call.id)); await flush(); await settle();
  const jp2 = pagesOf('judy').map((p) => p.flags?.[MODULE_ID]?.callLog).find((l) => l?.callId === anon2.call.id);
  ok(jp2 && !jp2.anonCall && jp2.other.name === 'Rogue', 'a traced call logs the real caller');
  // a player cannot withhold
  const pa = await as('u1', (s) => s.placeCall(judyNo, { anon: true })); await flush();
  ok(!clients.u1.svc.calls.get(pa.call.id)?.from?.anon && clients.u2.svc.calls.get(pa.call.id)?.from?.name !== 'Unknown caller', 'withholding is the GM’s alone');
  await as('u1', (s) => s.cancel(pa.call.id)); await flush();

  // the rules
  const net = await imp('scripts/utils/callNet.js');
  ok(net.dropReason({ wasNet: 'A', curNet: 'A' }) === null, 'still on the network: no reason');
  ok(net.dropReason({ deadZone: true, sceneName: 'Badlands' }) === 'Dead zone at Badlands — no signal', 'a dead zone names the scene');
  ok(net.dropReason({ wasNet: 'A', curNet: 'A', block: { state: 'off' }, nodeName: 'Mast 3' }) === 'Mast 3 went dark', 'a node switched off');
  ok(net.callerFor({ name: 'Rogue', anon: true }, { isCaller: true }).name === 'Rogue' && net.callerFor({ name: 'Rogue', anon: true }).name === 'Unknown caller', 'callerFor: the caller sees themselves, others the mask');
  const im = net.interceptMail({ from: { name: '<b>x</b>' }, to: { name: 'Judy' }, lines: [{ side: 'caller', text: '<script>' }] });
  ok(!im.body.includes('<script>') && !im.body.includes('<b>x'), 'an intercepted transcript is escaped');
  const load = net.networkLoad({ calls: [{ state: 'live', net: { id: 'A', name: 'A' } }], logs: [{ gameTime: '2045-08-15T10:00Z', net: { id: 'A' } }, { gameTime: '2045-08-14T10:00Z', net: { id: 'A' } }],
    nets: [{ id: 'A', name: 'A' }, { id: 'B', name: 'B' }], today: '2045-08-15', blocks: { B: { state: 'jammed' } } });
  ok(load.now === 1 && load.today === 1 && load.rows.length === 2 && load.rows.find((r) => r.id === 'B').cut === 'jammed', 'network load: now, today, a cut network listed');
}


// ═══ 6f. The real MessageRepository shape: identifyInbox is STATIC (the admin log + voicemail read nothing when it was called on the instance) ═══
{
  class Repo { static identifyInbox(j) { return j?.flags?.ncm ? { ownerId: j.flags.ncm, isContact: false } : null; } }
  const svc = clients.gm.svc;
  ok(svc._inboxOf(new Repo(), { flags: { ncm: 'v' } })?.ownerId === 'v' && svc._inboxOf(new Repo(), {}) === null, 'a static identifyInbox is found through the instance');
  ok(svc._inboxOf({ identifyInbox: () => ({ ownerId: 'm' }) }, {})?.ownerId === 'm', 'an instance method still works (older mocks)');
  const fsm = await import('node:fs');
  const src = fsm.readFileSync(`${ROOT}/scripts/services/CallService.js`, 'utf8');
  ok(!/repo\?\.identifyInbox\?\.\(/.test(src), 'no call site asks the instance for identifyInbox directly');
  const reg = fsm.readFileSync(`${ROOT}/scripts/init/registerCallSystem.js`, 'utf8');
  ok(/createJournalEntryPage/.test(reg) && /CALL_LOGGED/.test(reg), 'a log / voicemail page tells the windows to refresh');
  const ap = fsm.readFileSync(`${ROOT}/scripts/ui/AdminPanel/AdminPanelApp.js`, 'utf8');
  const mv = fsm.readFileSync(`${ROOT}/scripts/ui/MessageViewer/MessageViewerApp.js`, 'utf8');
  ok(/EVENTS\.CALL_LOGGED\]/.test(ap) && /EVENTS\.CALL_LOGGED/.test(mv), 'Admin → Phone and the Agent refresh on it');
}

// ═══ 6g. End to end: the REAL Admin → Phone tab reading the REAL service — Live during a call, the log and voicemail after ═══
{
  globalThis.Hooks = globalThis.Hooks || { on: () => 1, off: () => {} };
  const gmRepo = clients.gm.g.nightcity.messageRepository;
  delete gmRepo.identifyInbox;   // the real repository: identifyInbox lives on the class
  gmRepo.constructor = { identifyInbox: (j) => ({ ownerId: String(j.id).replace(/^j-/, ''), isContact: false }) };
  clients.gm.g.nightcity.callService = clients.gm.svc;
  const { PhoneTab } = await imp('scripts/ui/AdminPanel/tabs/PhoneTab.js');
  const app = { _activeTab: 'phone', isPopout: false, render() {}, element: null };
  const tab = new PhoneTab(app);
  const view = (v) => { globalThis.game = clients.gm.g; tab._view = v; return tab.prepareContext().phone2; };
  const r = await as('u1', (s) => s.placeCall('555 0131 88')); await flush();
  let ctx = view('live');
  ok(!ctx.error && (ctx.live.lines.some((l) => l.id === r.call.id) || ctx.live.ringing.some((l) => l.id === r.call.id)), 'Live shows a player↔player call while it rings');
  await as('u2', (s) => s.answer(r.call.id)); await flush();
  ctx = view('live');
  ok(ctx.live.lines.find((l) => l.id === r.call.id)?.state === 'live', 'Live shows it connected');
  await as('u1', (s) => s.hangup(r.call.id)); await flush();
  for (let i = 0; i < 20; i++) await new Promise((res) => setImmediate(res));
  await flush();
  ctx = view('live');
  ok(!ctx.live.lines.some((l) => l.id === r.call.id), 'an ended call leaves Live');
  ctx = view('log');
  ok(!ctx.error && ctx.log.total > 0 && ctx.log.days.some((d) => d.rows.some((x) => x.id === r.call.id)), 'Call log lists it (identifyInbox through the class)');
  ctx = view('vm');
  ok(!ctx.error && (ctx.vm.boxes || ctx.vm.groups || []).length > 0, 'Voicemail lists the messages left earlier');
}

// ═══ 7. Wiring ═══
{
  const fs = await import('fs');
  const read = (p) => fs.readFileSync(`${ROOT}/${p}`, 'utf8');
  ok(read('scripts/main.js').includes('registerCallSystem(initializer)'), 'the call system is registered');
  ok(read('styles/night-city-messenger.css').includes("@import 'components/call-hud.css'"), 'the HUD stylesheet is imported');
  const consts = read('scripts/utils/constants.js');
  ok(["CALL: 'call:event'", "CALL_LOG_REQUEST", "CALL_LINE_REQUEST", "'call-ring': 'calls/ring.wav'"].every((k) => consts.includes(k)), 'socket ops + sounds declared');
  ok(['ring', 'ringback', 'connect', 'end', 'drop', 'waiting', 'voicemail-beep'].every((n) => fs.existsSync(`${ROOT}/assets/sounds/calls/${n}.wav`)), 'every call sound file exists');
  const sm = read('scripts/core/SettingsManager.js');
  ok(['callsEnabled', 'callModes', 'callDefaultMode', 'callHomeCode', 'callDefaultRegion', 'callRingSeconds', 'callUnknownNumbers', 'phoneLines', 'callSilent', 'callScheme'].every((k) => sm.includes(`'${k}'`)), 'every call setting is registered');
  const css = read('styles/components/call-hud.css');
  ok(!/#[0-9a-f]{3,6}\b/i.test(css.replace(/var\([^)]*\)/g, '').replace(/#fff\b|#000\b|#0b0709|#c9ccd2|#e8e3f5|#04130b|#ff4b4b|#8a8f99|#4be38a/gi, '')), 'the HUD stylesheet has no stray literal colours');
}

console.log(`test-call-service: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
