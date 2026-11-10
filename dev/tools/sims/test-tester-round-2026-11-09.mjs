// Sim: tester round 2026-11-09 (Aegaeon), on the REAL CallService over mocked clients (harness from
// test-tester-round-2026-11-08b.mjs) plus the real node-log rules, NetworkService, ContactGroupService and
// MasterContactService methods:
//   1. a corporate switchboard in every mode that has something to show (Voicemail too, where 0 leaves a message)
//   2. a main number someone holds rings them, and the hint / Admin say so
//   3. a call that rang out into voicemail reaches both call logs; a call to someone offline too; N on voicemail
//   4. node logs: GM lines stay off the ticker, delete a line, clear, a seamless ticker that keeps its place
//   5. a pushed contact group never gives a character itself (by address too) and tidies an earlier self-contact
//   6. a pushed character carries their number; Share a number / Push to players tick a whole group
//   node dev/tools/sims/test-tester-round-2026-11-09.mjs
import { pathToFileURL, fileURLToPath } from 'url';
import fs from 'fs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.error('FAIL:', m)); };

const MODULE_ID = 'night-city-messenger';
// timers never fire on their own: the sim drives time (queued, so a test can run the ones it means)
const timers = [];
globalThis.setTimeout = (fn, ms) => { timers.push({ fn, ms, uid: globalThis.game?.user?.id }); return timers.length; }; globalThis.clearTimeout = () => {};
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
await as('gm', (s) => s.assignNumber({ actorId: 'ghost', number: '+72 NC WAT-4040' }));
await as('gm', (s) => s.assignNumber({ contactId: 'rogue', number: '+72 NC WAT-1907' }));
const OFFICE = '+72 NC ARA-0100';
const officeRow = await as('gm', (s) => s.numberContext.rows.find((r) => r.Category === 'Corporate' && r.Code === 'ARA' && r['City code'] === 'NC'));
ok(!!officeRow, 'fixture: the Arasaka Night City office row exists');
const PN = await imp('scripts/utils/phoneNumbering.js');
const KEY = PN.officeKey(officeRow);
const setOffice = (o) => { worldSettings.phoneOffices = { [KEY]: o }; };
// the GM forgets an ended call 8 seconds on: run those timers, as the client that set them
const fireEnds = (uid) => { for (const t of timers.filter((x) => x.ms === 8000 && x.uid === uid && !x.done)) { t.done = true; globalThis.game = clients[uid].g; t.fn(); } };

// ═══ 1. the switchboard rule: every mode that has something to show ═══
{
  const sb = PN.officeShowsBoard;
  ok(!sb({ answers: 'vm' }) && !sb({ answers: 'vm', exts: [{ x: '17', who: 'A', listed: false }] }), 'Voicemail with nothing to show: straight to the tone');
  ok(sb({ answers: 'vm', greet: 'Arasaka.' }) && sb({ answers: 'vm', exts: [{ x: '17', who: 'A' }] }), 'Voicemail with a greeting or a listed extension: the switchboard first');
  ok(sb({ answers: 'gm' }) && sb({ answers: 'recording' }) && !sb({}), 'You / A recording always show it; an unset office is Voicemail');
  setOffice({ answers: 'vm', greet: 'Arasaka. Dial an extension or press 0.', exts: [{ x: '17', who: 'Mr. Smith', listed: true }] });
  const r = await as('u1', (s) => s.placeCall(OFFICE));
  ok(r.ok && r.call.state === 'board' && r.call.board.vm && !r.call.board.operator, "the tester's setup (Voicemail, a greeting, an extension) now opens the switchboard");
  ok(r.call.board.greet.startsWith('Arasaka') && r.call.board.exts.map((e) => e.x).join() === '17', 'with the greeting and the listed extension');
  const left = await as('u1', (s) => s.boardPick(r.call.id, { operator: true }));
  const vm = clients.u1.svc.calls.get(left.call?.id);
  ok(left.ok && vm?.state === 'voicemail' && vm.unrung, '0 (Leave a message) goes to the office voicemail');
  ok(vm?.greeting?.text === 'Nobody is free to take your call.', 'it does not repeat the greeting they just heard');
  await as('u1', (s) => s.hangup(vm.id)); await flush();
  setOffice({ answers: 'recording', greet: '', exts: [] });
  const rec = await as('u1', (s) => s.placeCall(OFFICE));
  ok(rec.call.state === 'board' && !rec.call.board.vm && !rec.call.board.operator, 'A recording: the board, nothing behind 0');
  const no = await as('u1', (s) => s.boardPick(rec.call.id, { operator: true }));
  ok(!no.ok, 'and 0 is refused there');
  await as('u1', (s) => s.hangup(rec.call.id)); await flush();
  const hud = read('scripts/ui/Calls/CallHud.js');
  ok(hud.includes("call.board?.vm ? [['operator', '0', 'Leave a message', '']]"), 'the HUD offers "0 Leave a message" on a Voicemail board');
}

// ═══ 2. a main number someone holds rings them; the screens say so ═══
{
  setOffice({ answers: 'gm', greet: 'Arasaka.', exts: [] });
  const held = await as('u1', (s) => s.resolve(OFFICE));
  ok(held.kind === 'unowned', 'fixture: nobody holds the main number yet');
  contacts.find((c) => c.id === 'queen').phone = OFFICE;
  const r = await as('u1', (s) => s.placeCall(OFFICE));
  ok(r.ok && r.call.state !== 'board' && !r.call.board && r.call.to.name === 'Queen of Hearts', 'held: it rings the holder, no switchboard');
  await as('u1', (s) => s.cancel(r.call.id)); await flush();
  contacts.find((c) => c.id === 'queen').phone = '';
  const ct = read('scripts/ui/MessageViewer/callsTab.js'), nv = read('scripts/ui/AdminPanel/tabs/phoneNumbersView.js');
  ok(ct.includes("s.resolve(bare).kind !== 'unowned'") && ct.includes("officeShowsBoard(o) ? `A switchboard.${menu}` : 'It takes a message.'"), 'the dial hint checks the holder and the mode (it promised a switchboard every time)');
  ok(nv.includes('holder: officeHolder(numAt(r, OFFICE_LINE))') && nv.includes('holds this number, so calls ring them, not the switchboard'), 'Admin → Corporations warns when someone holds the main number');
  ok(nv.includes('<label class="ncm-pn-f" data-tooltip="What they hear first, on the switchboard">Greeting') && !nv.includes("o.answer === 'recording' || o.answer === 'gm' ? `<label"), 'the Greeting box shows in every mode (it hid under Voicemail and still played)');
  ok(nv.includes('const shows = officeShowsBoard({ answers: o.answer, greet: o.greet, exts: o.ext });'), 'the player-side preview follows the same rule');
}

// ═══ 3. a call that rang out into voicemail reaches both call logs ═══
{
  const r = await as('u1', (s) => s.placeCall('+72 NC WAT-1907'));
  await flush();
  ok(clients.gm.svc.calls.get(r.call.id)?.state === 'ringing', 'it rang the GM (Rogue is an NPC line)');
  await as('u1', (s) => s.cancel(r.call.id, 'timeout'));
  ok(clients.u1.svc.calls.get(r.call.id)?.state === 'voicemail', 'nobody picked up: voicemail');
  await flush();
  fireEnds('gm');
  ok(!clients.gm.svc.calls.has(r.call.id) && clients.gm.svc._ended?.has(r.call.id), 'the GM forgot it 8 s after the ring stopped, but kept it to check a log against');
  await as('u1', (s) => s.skipGreeting(r.call.id));
  const left = await as('u1', (s) => s.leaveVoicemail(r.call.id, 'Call me back.'));
  ok(left.ok, 'a message left');
  await flush();
  const out = pagesOut('v').find((p) => p.flags[MODULE_ID].callLog.callId === r.call.id);
  ok(!!out, 'V\'s log has the call (it was refused as "a call this GM never saw")');
  ok(out?.flags[MODULE_ID].callLog.outcome === 'voicemail', 'as a voicemail, not a plain miss');
  ok(pagesOut('rogue').some((p) => p.flags[MODULE_ID].callLog.callId === r.call.id), "and Rogue's side has it too (the GM's own copy names her)");
  globalThis.game = clients.gm.g;
  ok(!clients.gm.svc.checkLogRequest({ summary: { callId: r.call.id, outcome: 'voicemail' } }, 'u2').ok, 'someone not on the call still cannot log it');
}
{
  // someone offline: nothing ever rang, so the call is logged the never-rang way
  const r = await as('u1', (s) => s.placeCall('+72 NC WAT-4040'));
  ok(clients.u1.svc.calls.get(r.call.id)?.unrung, 'calling someone offline is marked never rung');
  await as('u1', (s) => s.hangup(r.call.id)); await flush();
  ok(pagesOut('v').some((p) => p.flags[MODULE_ID].callLog.callId === r.call.id), "and reaches V's log");
  const hud = read('scripts/ui/Calls/CallHud.js');
  ok(hud.includes("c.state === 'board' || c.state === 'voicemail') this.act('hangup', c.id);"), 'N hangs up the voicemail screen too (the first N did nothing there)');
}

// ═══ 4. node logs: GM lines, the ticker, removing lines ═══
{
  const N = await imp('scripts/utils/networkNodes.js');
  let log = [];
  for (const [who, what, ts] of [['GM', 'switched on', 1], ['Rache', 'jacked in', 2], ['', 'intrusion attempt', 3], ['GM', 'jacked out', 4], ['Kiri', 'jacked out', 5]]) log = N.appendLog(log, { ts, who, what });
  ok(log[0].gm && log[3].gm && !log[1].gm && !log[2].gm, 'a line the GM wrote as GM is marked GM-only');
  ok(N.sanitizeNode({ log: [{ ts: 1, who: 'GM', what: 'switched off' }] }).log[0].gm, 'lines stored before the flag read the same by name');
  log = log.map((e) => (e.who === 'Rache' ? { ...e, wiped: true } : e));
  const node = N.sanitizeNode({ id: 'n1', name: 'Relay', log, showTraffic: false });
  ok(N.tickerLogLines(node).map((e) => e.ts).join() === '3,5', "the ticker reads what is neither wiped nor the GM's");
  const t = N.tickerLines(node, { name: 'CitiNet' }, { fmt: (ts) => `t${ts}` });
  ok(!t.some((l) => l.includes('GM —')) && t[0].includes('Kiri') && t[1].includes('intrusion'), 'no "GM — …" on the ticker; newest first');
  let many = []; for (let i = 1; i <= 9; i++) many = N.appendLog(many, { ts: i, who: 'X', what: `line ${i}` });
  ok(N.tickerLogLines({ log: many }).length === N.TICKER_LOG_LINES, 'still only the newest five');
  ok(N.removeLogLine(log, 2, 3)?.length === 4 && N.removeLogLine(log, 2, 99) === null && N.removeLogLine(log, 9, 1) === null, 'a line is removed only when its place AND stamp still match');
  ok(N.tickerSeconds('x'.repeat(70)) === 12 && N.tickerSeconds('x'.repeat(700)) === 100, 'one lap reads at a steady speed (never under 12 s)');
}
{
  const { NetworkService } = await imp('scripts/services/NetworkService.js');
  const N = await imp('scripts/utils/networkNodes.js');
  let stored = N.sanitizeNode({ id: 'n1', name: 'Relay', log: [{ ts: 1, who: 'GM', what: 'a' }, { ts: 2, who: 'Kiri', what: 'b' }, { ts: 3, who: 'Kiri', what: 'c' }] });
  const fake = { getNode: () => N.sanitizeNode(stored), _writeNode: async (_id, n) => { stored = n; } };
  globalThis.game = clients.gm.g;
  const r1 = await NetworkService.prototype.removeNodeLogLine.call(fake, 'n1', 1, 2);
  ok(r1.success && stored.log.map((e) => e.what).join() === 'a,c', 'GM: delete one line');
  const r2 = await NetworkService.prototype.removeNodeLogLine.call(fake, 'n1', 0, 2);
  ok(!r2.success && stored.log.length === 2, 'a stale delete changes nothing');
  const r3 = await NetworkService.prototype.clearNodeLog.call(fake, 'n1');
  ok(r3.success && r3.cleared === 2 && stored.log.length === 0, 'GM: clear the whole log');
  globalThis.game = clients.u1.g;
  ok(!(await NetworkService.prototype.clearNodeLog.call(fake, 'n1')).success, 'a player cannot');
  const ns = read('scripts/services/NetworkService.js');
  ok(/const NODE_WRITERS = \[[^\]]*'removeNodeLogLine', 'clearNodeLog'/.test(ns), 'both run through the node writer queue');
  const ins = read('scripts/ui/NetworkNodes/NodeInspectorApp.js'), hbs = read('templates/network-nodes/node-inspector.hbs');
  ok(ins.includes('logDel: NodeInspectorApp._act, logClear: NodeInspectorApp._act') && ins.includes("case 'logDel'") && ins.includes("case 'logClear'"), 'Inspect Node: Delete a line, Clear');
  ok(hbs.includes('data-action="logDel" data-i="{{i}}" data-ts="{{ts}}"') && hbs.includes('data-action="logClear"') && hbs.includes('{{#if ticker}}') && hbs.includes('GM only'), 'the log marks what is on the ticker and what is GM-only');
  ok(ins.includes('ticker: onTicker.has(e)') && ins.includes('i, ts: e.ts'), 'each row knows its place and whether the ticker shows it');
  const con = read('templates/network-nodes/node-console.hbs'), css = read('styles/components/node-console.css'), app = read('scripts/ui/NetworkNodes/NodeConsoleApp.js');
  ok(con.includes('ncm-ndc__tick-dup') && css.includes('to { transform: translateX(-50%); }') && !css.includes('padding-left: 100%'), 'the ticker is one seamless loop (two copies, half a strip)');
  ok(app.includes('this._tickT0 ??= performance.now()') && app.includes('tick.style.animationDelay'), 'a redraw keeps its place instead of restarting it');
}

// ═══ 5. contact groups: nobody gets themselves ═══
{
  const { ContactGroupService, sanitizeGroup } = await imp('scripts/services/ContactGroupService.js');
  const P = await imp('scripts/utils/participants.js');
  const emails = { v: 'v@nc.net', judy: 'judy@nc.net' };
  const actorFlags = { v: {}, judy: {} };
  const mkActor = (id, name) => ({ id, name, getFlag: (_m, k) => (k === 'email' ? emails[id] : actorFlags[id][k]), setFlag: async (_m, k, val) => { actorFlags[id][k] = val; } });
  const actors = [mkActor('v', 'V'), mkActor('judy', 'Judy')];
  const dir = [{ id: 'v-entry', name: 'V', email: 'v@nc.net', actorId: '' }, { id: 'rogue', name: 'Rogue', email: 'rogue@afterlife.nc' }];
  const pushed = [], removed = [];
  let vContacts = [{ id: 'c-self', name: 'V', email: 'v@nc.net' }, { id: 'c-rogue', name: 'Rogue', email: 'rogue@afterlife.nc' }];
  globalThis.game = { user: { isGM: true, id: 'gm' }, actors: Object.assign(actors, { get: (id) => actors.find((a) => a.id === id), contents: actors }),
    settings: { get: () => undefined },
    nightcity: {
      masterContactService: { getContact: (id) => dir.find((c) => c.id === id) || null, getByEmail: (e) => dir.find((c) => c.email === P.normalizeEmail(e)) || null, getAll: () => dir,
        identitiesFor: (aid) => dir.filter((c) => c.actorId === aid),
        pushToPlayer: async (cid, to) => { pushed.push(['contact', cid, to]); return { success: true }; },
        pushActorToPlayer: async (aid, to) => { pushed.push(['actor', aid, to]); return { success: true }; } },
      contactRepository: { getContacts: async () => vContacts, removeContact: async (_a, id) => { removed.push(id); vContacts = vContacts.filter((c) => c.id !== id); } },
      eventBus: { emit() {} },
    } };
  // stored groups are sanitized (a colour, a picture field): the fixture is too
  const group = sanitizeGroup({ id: 'g1', name: 'Edgerunners', members: [{ name: 'V', email: 'v@nc.net' }, { name: 'Judy', email: 'judy@nc.net', hint: { actorId: 'judy' } }, { name: 'Rogue', email: 'rogue@afterlife.nc', hint: { contactId: 'rogue' } }] });
  const svc = Object.create(ContactGroupService.prototype);
  svc.getMasterGroup = () => group; svc.getActorGroups = (id) => Object.values(actorFlags[id]).find(Array.isArray) || []; svc._emit = () => {};
  const r = await ContactGroupService.prototype.pushGroupToPlayer.call(svc, 'g1', 'v');
  ok(r.success && r.shared === 2, 'pushed to V: two shared');
  ok(!pushed.some(([, id]) => id === 'v-entry' || id === 'v'), "V is never shared to V, though V's directory entry is not linked to the sheet (it was)");
  ok(pushed.some(([k, id]) => k === 'actor' && id === 'judy') && pushed.some(([k, id]) => k === 'contact' && id === 'rogue'), 'Judy and Rogue are');
  ok(removed.join() === 'c-self' && vContacts.length === 1, 'the self-contact an earlier push left is taken out; Rogue stays');
  const copy = Object.values(actorFlags.v).find(Array.isArray)?.find((g) => g?.sharedFrom?.groupId === 'g1');
  ok(copy && copy.members.length === 2 && !copy.members.some((m) => m.email === 'v@nc.net'), "V's copy of the group lists everyone else");
  ok(group.members.length === 3, "the GM's own group is untouched");
  const M = await imp('scripts/ui/AdminPanel/tabs/contactsModel.js');
  ok(M.groupSig(copy) !== M.groupSig(group) && M.groupSig(copy) === M.groupSig(ContactGroupService.prototype.copyFor.call(svc, group, 'v')), 'a fresh push is not "Out of date": the check compares with what their copy holds');
  const ctab5 = read('scripts/ui/AdminPanel/tabs/ContactsTab.js');
  ok((ctab5.match(/groupSig\(svc\?\.copyFor\?\.\(/g) || []).length === 2, 'both Out-of-date checks (Players and Groups) read copyFor');
  pushed.length = 0;
  await ContactGroupService.prototype.pushGroupToPlayer.call(svc, 'g1', 'judy');
  ok(pushed.some(([, id]) => id === 'v-entry') && !pushed.some(([, id]) => id === 'judy'), 'pushed to Judy: V goes, Judy does not');
  ok(ContactGroupService.prototype.characterIdsOf.call(svc, group).sort().join() === 'judy,v', "the group's characters, by sheet link or by address");
}

// ═══ 6. phone numbers ride with a pushed group; Share ticks a group ═══
{
  const { MasterContactService } = await imp('scripts/services/MasterContactService.js');
  const added = [], updated = [];
  let existing = [];
  globalThis.game = { user: { isGM: true }, actors: { get: (id) => ({ id, name: 'Judy', img: '', items: { contents: [] }, getFlag: () => 'judy@nc.net' }) },
    nightcity: { callService: { numberOf: (id) => (id === 'judy' ? '+72 NC WAT-3188' : '') },
      contactRepository: { getContacts: async () => existing, addContact: async (_t, c) => { added.push(c); return { success: true }; }, updateContact: async (_t, id, u) => { updated.push([id, u]); } } } };
  const r = await MasterContactService.prototype.pushActorToPlayer.call({}, 'judy', 'v');
  ok(r.success && added[0]?.phone === '+72 NC WAT-3188', 'a pushed character arrives with their number');
  existing = [{ id: 'c1', actorId: 'judy', phone: '' }];
  await MasterContactService.prototype.pushActorToPlayer.call({}, 'judy', 'v');
  ok(updated.some(([id, u]) => id === 'c1' && u.phone === '+72 NC WAT-3188'), 'one already saved without it gets the number');
  const pt = read('scripts/ui/AdminPanel/tabs/PhoneTab.js'), np = read('scripts/utils/namePicker.js'), ctab = read('scripts/ui/AdminPanel/tabs/ContactsTab.js');
  ok(pt.includes('multi: true, sets,') && pt.includes('cgs.characterIdsOf?.(g)'), "Share a number: the GM's groups tick their characters");
  ok(np.includes('sets = [],') && np.includes('ncm-pkr__set') && np.includes(".ncm-pkr__chip:not(.ncm-pkr__set)')"), "the picker's sets tick rows and never act as filters");
  ok(ctab.includes('sets: [{ label: group.name') && ctab.includes('with their phone numbers'), "Push to players can tick the group's own characters, and says numbers go too");
}

console.log(`test-tester-round-2026-11-09: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
