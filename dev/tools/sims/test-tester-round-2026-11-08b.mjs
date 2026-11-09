// Sim: tester round 2026-11-08 (second batch), on the REAL CallService over mocked clients (harness from
// test-call-service.mjs, but every log request carries its server-checked sender):
//   1. a call that never rang (a switchboard, a recording, not in service) reaches the caller's log; forged ones don't
//   2. the corporate switchboard: greeting + listed extensions + operator; a wrong extension keeps the board;
//      the operator not answering goes to the office's voicemail with its greeting
//   3. Call as from a contact's own line (an office line) calls from that number
//   4. greeting sound files (links / world paths), the Reply All To field, the messenger's opening size
//   node dev/tools/sims/test-tester-round-2026-11-08b.mjs
import { pathToFileURL, fileURLToPath } from 'url';
import fs from 'fs';

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
const worldSettings = { phoneOffices: {}, phoneLines: {}, callsEnabled: true, callRingSeconds: 30, callModes: ['loud', 'type', 'dictate'], callDefaultMode: 'loud', callUnknownNumbers: 'not-in-service' };
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
      else if (op === 'call:logRequest') await s.handleLogRequest(data, sender);
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


const read = (p) => fs.readFileSync(`${ROOT}/${p}`, 'utf8').replace(/\r\n/g, '\n');
const pagesOut = (owner) => pagesOf(owner).filter((p) => p.flags?.[MODULE_ID]?.callLog);
await as('gm', (s) => s.assignNumber({ actorId: 'v', number: '+72 NC WAT-7742' }));
await as('gm', (s) => s.assignNumber({ actorId: 'judy', number: '+72 NC WAT-3188' }));
await as('gm', (s) => s.assignNumber({ contactId: 'rogue', number: '+72 NC WAT-1907' }));
const OFFICE = '+72 NC ARA-0100';
const officeRow = await as('gm', (s) => s.numberContext.rows.find((r) => r.Category === 'Corporate' && r.Code === 'ARA' && r['City code'] === 'NC'));
ok(!!officeRow, 'fixture: the Arasaka Night City office row exists');
const { officeKey } = await imp('scripts/utils/phoneNumbering.js');
const KEY = officeKey(officeRow);
const setOffice = (o) => { worldSettings.phoneOffices = { [KEY]: o }; };

// ═══ 1. a call that never rang is logged on the caller's side ═══
{
  setOffice({ answers: 'recording', greet: 'Arasaka. Your call is important to us.', exts: [] });
  const r = await as('u1', (s) => s.placeCall(OFFICE));
  ok(r.ok && r.call.state === 'board' && r.call.unrung, 'a recording office opens the switchboard (it used to toast and hang up)');
  ok(r.call.board.greet === 'Arasaka. Your call is important to us.' && !r.call.board.operator && r.call.board.exts.length === 0, 'the board carries the greeting, no operator');
  ok(!(await as('u1', (s) => s.allCalls())).some((c) => c.id === r.call.id), 'a switchboard is never in a live list');
  const busy = await as('u1', (s) => s.placeCall('+72 NC WAT-3188'));
  ok(!busy.ok, 'a second call while the board is up is refused');
  await as('u1', (s) => s.hangup(r.call.id));
  ok(bus.some((m) => m.op === 'call:logRequest' && m.data.summary.unrung), 'hanging up sends a log marked as never rung');
  await flush();
  const mine = pagesOut('v').find((p) => p.flags[MODULE_ID].callLog.callId === r.call.id);
  ok(!!mine && mine.flags[MODULE_ID].callLog.direction === 'out' && mine.flags[MODULE_ID].callLog.outcome === 'answered', 'the GM wrote it into V\'s outgoing log (it was refused as "a call this GM never saw")');
  ok(mine?.flags[MODULE_ID].callLog.other.number === r.call.to.number && !mine.flags[MODULE_ID].callLog.other.actorId, 'the other end is only a number');
  ok(![...journals.keys()].some((o) => o !== 'v' && pagesOut(o).some((p) => p.flags[MODULE_ID].callLog.callId === r.call.id)), 'nobody else got a page');
  const n = await as('u1', (s) => s.placeCall('+72 NC WAT-0001'));
  ok(n.ok && n.call.state === 'ended' && n.call.outcome === 'not-in-service', 'a number nobody has: not in service');
  await flush();
  ok(pagesOut('v').some((p) => p.flags[MODULE_ID].callLog.callId === n.call.id), 'and it is logged now too');
}
{
  const gm = clients.gm.svc; globalThis.game = clients.gm.g;
  const base = { callId: 'fake-1', outcome: 'answered', unrung: true, from: { actorId: 'v', number: '+72 NC WAT-7742' }, to: { number: OFFICE, name: 'Arasaka' } };
  ok(!gm.checkLogRequest({ summary: base }, 'u2').ok, 'someone else cannot log a call as V');
  ok(!gm.checkLogRequest({ summary: { ...base, callId: 'fake-2', from: { actorId: 'v', number: '+72 NC WAT-3188' } } }, 'u1').ok, 'nor from a number that is not theirs');
  ok(!gm.checkLogRequest({ summary: { ...base, callId: 'fake-3', outcome: 'declined' } }, 'u1').ok, 'an outcome a no-ring call cannot have is refused');
  const good = gm.checkLogRequest({ summary: { ...base, callId: 'fake-4', lines: [{ text: 'forged words' }], to: { number: OFFICE, name: 'Arasaka', actorId: 'judy' }, seconds: 900 } }, 'u1');
  ok(good.ok && good.summary.lines.length === 0 && good.summary.seconds === 0 && good.summary.to.actorId === null, 'an accepted one says nothing, lasts nothing and names no person');
  ok(!gm.checkLogRequest({ summary: { ...base, callId: 'fake-4' } }, 'u1').ok, 'each call is logged once');
  ok(!gm.checkLogRequest({ summary: { callId: 'fake-5', outcome: 'answered' } }, 'u1').ok, 'a call that did ring still needs the GM\'s own copy');
}

// ═══ 2. the switchboard ═══
{
  setOffice({ answers: 'gm', greet: 'Arasaka Tower. Who do you want?', exts: [{ x: '17', who: 'Mr. Smith', listed: true }, { x: '66', who: 'Night desk', listed: false }] });
  const r = await as('u1', (s) => s.placeCall(OFFICE));
  const boardId = r.call.id;
  ok(r.call.state === 'board' && r.call.board.operator && r.call.board.exts.map((e) => e.x).join() === '17', 'the board lists only the listed extensions, and offers the operator');
  const wrong = await as('u1', (s) => s.boardPick(boardId, { ext: '99' }));
  ok(!wrong.ok && /No such extension/.test(wrong.error) && clients.u1.svc.calls.get(boardId)?.state === 'board', 'a wrong extension keeps the board up');
  const t = await as('u1', (s) => s.boardPick(boardId, { ext: '66' }));
  ok(t.ok && t.call.state === 'dialing' && t.call.to.name === 'Night desk', 'an unlisted extension still connects if you know it');
  ok(!clients.u1.svc.calls.has(boardId), 'the board is gone');
  ok(evts('u1', 'call:ended').some((d) => d.call.id === boardId && d.transfer && d.quiet), 'it leaves as a transfer (no ending, no log of its own)');
  await as('u1', (s) => s.cancel(t.call.id)); await flush();
  const r2 = await as('u1', (s) => s.placeCall(OFFICE));
  const op = await as('u1', (s) => s.boardPick(r2.call.id, { operator: true }));
  ok(op.ok && op.call.state === 'dialing' && op.call.to.office === KEY && op.call.to.greet === 'Arasaka Tower. Who do you want?', 'the operator rings the GM, and the call knows its office');
  await as('u1', (s) => s.cancel(op.call.id, 'timeout'));
  const vm = clients.u1.svc.calls.get(op.call.id);
  ok(vm?.state === 'voicemail' && vm.greeting.text === 'Arasaka Tower. Who do you want?', 'nobody picks up: the office voicemail, with its greeting (it used to just end)');
  await as('u1', (s) => s.hangup(op.call.id)); await flush();
  setOffice({ answers: 'vm', greet: 'Leave it.', exts: [{ x: '17', who: 'Mr. Smith', listed: true }] });
  const r3 = await as('u1', (s) => s.placeCall(OFFICE));
  ok(r3.call.state === 'voicemail' && clients.u1.svc.calls.get(r3.call.id)?.unrung, 'a voicemail office goes straight to voicemail (never rung)');
  await as('u1', (s) => s.hangup(r3.call.id)); await flush();
  ok(pagesOut('v').some((p) => p.flags[MODULE_ID].callLog.callId === r3.call.id), 'and that call is logged too (it was refused the same way)');
  setOffice({ answers: 'gm', greet: 'x', exts: [{ x: '17', who: 'Mr. Smith', listed: true }] });
  const r4 = await as('u1', (s) => s.placeCall(OFFICE + ' x17'));
  ok(r4.call.state === 'dialing' && r4.call.to.name === 'Mr. Smith', 'number + x17 goes straight through');
  await as('u1', (s) => s.cancel(r4.call.id)); await flush();
}

// ═══ 3. Call as from a contact's own line ═══
{
  await as('gm', (s) => s.addLine({ contactId: 'rogue', number: '+72 NC WAT-5555', kind: 'extra', label: 'Office' }));
  const fromLine = await as('gm', (s) => s._caller({ contactId: 'rogue', line: '+72 NC WAT-5555' }));
  ok(fromLine.number === '+72 NC WAT-5555', 'Call as from her office line calls from that number');
  ok((await as('gm', (s) => s._caller({ contactId: 'rogue' }))).number === '+72 NC WAT-1907', 'with no line: her main number');
  ok((await as('gm', (s) => s._caller({ contactId: 'rogue', line: '+72 NC WAT-3188' }))).number === '+72 NC WAT-1907', 'a line that is not hers is ignored');
  const pt = read('scripts/ui/AdminPanel/tabs/PhoneTab.js'), nv = read('scripts/ui/AdminPanel/tabs/phoneNumbersView.js');
  ok(nv.includes('data-do="lineCall" data-id="${p.id}" data-n="${esc(l.n)}"') && nv.includes('TAB._callAs(el.dataset.id, el.dataset.n || null)'), 'the line\'s Dial button passes its number');
  ok(pt.includes('async _callAs(contactId = null, fromNumber = null)') && pt.includes('${fromNum}${lineName}'), 'the "Their screen shows" choice names the line it calls from');
}

// ═══ 4. greeting sound files, Reply All, the messenger's size ═══
{
  const V = await imp('scripts/utils/voicemail.js');
  ok(V.greetingLink('https://cdn.example.com/hello.mp3') === 'https://cdn.example.com/hello.mp3' && V.greetingLink('worlds/w/audio/hi.ogg') === 'worlds/w/audio/hi.ogg', 'a link or a world path is a sound file');
  ok(V.greetingLink('javascript:alert(1)') === '' && V.greetingLink('data:audio/webm;base64,AAAA') === '' && V.greetingLink('a "b"') === '', 'scripts, data URLs and quotes are not');
  ok(V.isLinkedGreeting('https://x/y.mp3') && !V.isLinkedGreeting('worlds/w/ncm-voicemail/greeting-1.webm') && !V.isLinkedGreeting(''), 'a recording made here is not a linked file');
  const set = V.sanitizeLineSettings({ greeting: { kind: 'recorded', audio: 'https://cdn.example.com/hello.mp3' } });
  ok(set.greeting.kind === 'recorded' && set.greeting.audio === 'https://cdn.example.com/hello.mp3' && V.greetingPlays(V.greetingFor(set)), 'a linked greeting is kept and plays for every caller');
  ok(V.GREETING_LABELS.recorded === 'Audio', 'the kind reads Audio (a recording or a file)');
  const ct = read('scripts/ui/MessageViewer/callsTab.js'), hbs = read('templates/message-viewer/partials/calls-tab.hbs'), pt = read('scripts/ui/AdminPanel/tabs/PhoneTab.js');
  ok(hbs.includes('data-calls-ml-url') && ct.includes('greetingLink(url)') && pt.includes('name="url"') && pt.includes('data-gr-browse') && pt.includes("newFilePicker({ type: 'audio'"), 'both greeting editors take a sound file (the GM can browse for one)');
  ok(hbs.includes('Voices belong to each computer'), 'the player editor says a read-out voice is each computer\'s own');
  const comp = read('scripts/ui/MessageComposer/MessageComposerApp.js');
  ok(comp.includes("recipientLocked: this.mode === 'reply' && this.recipients.length > 0 && (!!this.anonReplyTo || !this._replyAll)") && comp.includes('this._replyAll = true;') && comp.includes('this._replyAll = false;'), 'Reply All keeps the To field open; a plain or anonymous reply stays locked');
}
{
  // the messenger's opening size, the real methods lifted out of the class
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  globalThis.innerWidth = 1600; globalThis.innerHeight = 900;
  let scaleVar = '1.25';
  globalThis.document = { documentElement: {} };
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => scaleVar });
  class Base { static DEFAULT_OPTIONS = { position: { width: 880, height: 600 } }; }
  const mvSrc = read('scripts/ui/MessageViewer/MessageViewerApp.js');
  const pick = (name) => { const i = mvSrc.indexOf(`  static ${name}(`); if (i < 0) throw new Error('no ' + name); const end = mvSrc.indexOf('\n  }\n', i); return mvSrc.slice(i, end + 4); };
  const sizeKey = mvSrc.slice(mvSrc.indexOf('  static _sizeKey('), mvSrc.indexOf('\n', mvSrc.indexOf('  static _sizeKey(')));
  const Cls = new Function('Base', 'game', 'getSetting', 'MODULE_ID', `return class extends Base { ${sizeKey} ${pick('_openingSize')} }`)(Base, { user: { id: 'u1' } }, () => ({}), MODULE_ID);
  const big = Cls._openingSize();
  ok(big?.width === 1100 && big?.height === 750, 'Text Size 125%: the default opens 25% bigger');
  scaleVar = '2';
  ok(Cls._openingSize().height === 880 && Cls._openingSize().width === 1580, 'never bigger than the screen');
  scaleVar = '1';
  ok(Cls._openingSize() === null, 'at 100% the normal default');
  store.set('ncm-viewer-size:u1', JSON.stringify({ width: 1000, height: 700 }));
  const back = Cls._openingSize();
  ok(back.width === 1000 && back.height === 700, 'a size the player left it at wins');
}

console.log(`test-tester-round-2026-11-08b: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
