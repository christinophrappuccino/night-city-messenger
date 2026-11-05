// Sim: payphones (dev/design/PHONE-REVISION.md §Payphones "Decided 2026-11-03").
// The pure rules, the booth's drawing, and the REAL CallService + PayphoneService over mocked clients: calling from a
// booth (the place calls, the person stays with the GM), wired (no signal needed), a call TO a booth (rings the scene,
// first pick-up wins), the logs (a GM-only booth page; nothing in the caller's own log; nothing leaks into a player's
// page), and the wiring guards (settings, sounds, socket, access kind, admin page, styles).
//   node dev/tools/sims/test-payphones.mjs
import { pathToFileURL, fileURLToPath } from 'url';
import fs from 'fs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
const read = (p) => fs.readFileSync(`${ROOT}/${p}`, 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.error('FAIL:', m)); };
const MODULE_ID = 'night-city-messenger';

// ═══ 1. The rules ═══
const P = await imp('scripts/utils/payphones.js');
{
  const l = P.sanitizeLook({ style: 'nope', grit: 300, wire: -4, case: 'red', tags: [['TOO LONG A TAG FOR THE CASING 123', '#zzzzzz']] });
  ok(l.style === 'street' && l.grit === 100 && l.wire === 0, 'a broken look falls back (style, grit 0..100, wire 0..100)');
  ok(l.case === P.PP_STYLES.street.case, 'a colour that is not #rrggbb falls back to the style');
  ok(l.tags.length === 3 && l.tags[0][0].length === 24 && l.tags[0][1] === P.PP_STYLES.street.tags[0][1], 'three tags, capped at 24, bad colour falls back');
  ok(P.lookFromStyle('corp').grit === 4 && P.lookFromStyle('ncpd').brand === 'NCPD', 'each style starts with its own look');
  ok([0, 19, 20, 39, 40, 59, 60, 84, 85, 100].map(P.gritTier).join() === '0,0,1,1,2,2,3,3,4,4', 'grit tiers');
  ok([0, 9, 10, 39, 40, 74, 75, 100].map(P.wireTier).join() === '0,0,1,1,2,2,3,3', 'wiring tiers');
  ok(P.safeSound('sounds/bell.ogg') && !P.safeSound('javascript:alert(1).ogg') && !P.safeSound('data:audio/ogg;base64,AAAA') && !P.safeSound('evil.js'), 'a booth sound is an audio file, never a script or data url');
  const pp = P.sanitizePayphone({ id: 'p1', name: 'Kabuki, Night Market', number: '+72 NC WAT-0412', look: { style: 'ncpd' }, hear: 'loud', condition: 'broken', range: 99 });
  ok(pp.hear === 'caller' && pp.condition === 'working' && pp.range === 20 && pp.help === 'NCPD', 'a record: unknown rules fall back; the NCPD box carries its help key');
  ok(P.placeLabel(pp) === 'Payphone, Kabuki, Night Market', 'what the screen and a trace show');
  ok(P.speakerOn('caller', true) && !P.speakerOn('caller', false) && P.speakerOn('speaker', false) && !P.speakerOn('private', true), 'the booth rule wins over the caller\'s choice');
  ok(P.inReach({ x: 150, y: 100 }, { x: 100, y: 100 }, 1, 100) && !P.inReach({ x: 260, y: 100 }, { x: 100, y: 100 }, 1, 100), 'reach: centre to centre in squares, half-square grace');
  ok(P.bystanders([{ userId: 'a', x: 100, y: 120 }, { userId: 'b', x: 900, y: 900 }, { userId: 'me', x: 100, y: 100 }], [{ x: 100, y: 100 }], 1, 100, ['me']).join() === 'a', 'bystanders: in reach, not the person on the handset');
  const masked = P.maskPayphoneSide({ payphone: 'p1', name: 'Payphone, X', realActorId: 'v', realName: 'V', realUserId: 'u1', actorId: 'v' });
  ok(!masked.realActorId && !masked.realName && !masked.realUserId && masked.actorId === null && masked.name === 'Payphone, X', 'a booth side as others see it: the place, never the person');
  ok(P.maskPayphoneSide({ actorId: 'judy', name: 'Judy' }).actorId === 'judy', 'a normal side passes through unchanged');
  ok(P.payphoneLine(pp).kind === 'payphone' && P.payphoneLine(pp).owner.kind === 'payphone' && !P.payphoneLine(pp).owner.actorId, 'its line: nobody owns it');
  ok(P.sanitizeSavedStyles([{ id: 'a', name: 'Watson', look: { style: 'bar' } }, { id: '', name: 'x' }]).length === 1, 'saved looks need an id and a name');
}

// ═══ 2. The drawing ═══
const B = await imp('scripts/ui/Calls/boothMarkup.js');
{
  const look = P.lookFromStyle('street');
  const a = B.boothHtml({ look, uid: 'a1', place: 'Kabuki', number: 'NC-WAT-0412', helpKey: true, helpLabel: 'NCPD' });
  const b = B.boothHtml({ look, uid: 'b2', place: 'Kabuki', number: 'NC-WAT-0412' });
  const ids = (h) => [...h.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  ok(ids(a).length > 10 && ids(a).every((id) => !ids(b).includes(id)), 'two booths on one page never share an SVG id');
  ok(ids(a).every((id) => [...a.matchAll(/url\(#([^)]+)\)|href="#([^"]+)"/g)].length) && [...a.matchAll(/url\(#([^)]+)\)|href="#([^"]+)"/g)].every((m) => ids(a).includes(m[1] || m[2])), 'every url(#…) / href="#…" points at an id in the same booth');
  ok(/data-fn="sos"/.test(a) && !/data-fn="sos"/.test(b), 'the help key only when the booth has one');
  ok((a.match(/class="ncm-pb__tag t\d"[^>]*hidden/g) || []).length === 1, 'an empty graffiti tag is not drawn (street: two of three)');
  ok(!/data-pb="close"/.test(B.boothHtml({ look, uid: 'p', preview: true })), 'the admin preview has no walk-away button');
  ok(/data-grit-tier="3"/.test(a) && /data-wire-tier="3"/.test(a), 'the street booth\'s grit and wiring tiers are stamped');
  ok(/is-gone/.test(B.keypadHtml({ wrecked: true })) && !/is-gone/.test(B.keypadHtml()), 'a wrecked booth has a dead 7');
  ok(/data-dial="NC-WAT-2207"/.test(B.speedHtml([{ name: 'Rogue', number: 'NC-WAT-2207' }])) && (B.speedHtml([]).match(/is-empty/g) || []).length === 4, 'speed dial: four keys, empty ones dead');
  ok(/&lt;b&gt;/.test(B.bookHtml([{ name: '<b>x</b>', number: '1' }])), 'names on the touchscreen are escaped');
  ok(/Private/.test(B.byHtml({ who: 'Rache' })) && /Speaker/.test(B.byHtml({ who: 'Rache', speaker: true, lines: [{ who: 'X', text: 'hi' }] })), 'someone else on it: private, or on speaker with the lines');
  // every control the drawing has, the booth handles
  const ctl = read('scripts/ui/Calls/PayphoneBooth.js');
  const fns = [...new Set([...a.matchAll(/data-fn="([^"]+)"/g)].map((m) => m[1]))];
  ok(fns.length >= 6 && fns.every((f) => ctl.includes(`f === '${f}'`)), `every function key has a handler (${fns.join(', ')})`);
  for (const pb of [...new Set([...a.matchAll(/data-pb="([^"]+)"/g)].map((m) => m[1]))]) ok(ctl.includes(`dataset.pb === '${pb}'`), `the booth handles data-pb="${pb}"`);
}

// ═══ 3. Calls, with the real services ═══
globalThis.setTimeout = () => 0; globalThis.clearTimeout = () => {};
globalThis.setInterval = () => 0; globalThis.clearInterval = () => {};
const users = [
  { id: 'gm', name: 'GM', isGM: true, active: true, viewedScene: 'S1' },
  { id: 'u1', name: 'Kiri', isGM: false, active: true, viewedScene: 'S1' },
  { id: 'u2', name: 'Marta', isGM: false, active: true, viewedScene: 'S2' },
  { id: 'u4', name: 'Tam', isGM: false, active: true, viewedScene: 'S1' },
];
const owners = { v: ['u1'], judy: ['u2'], tam: ['u4'] };
const worldSettings = { phoneLines: {}, payphones: {}, payphoneStyles: [], callsEnabled: true, callRingSeconds: 30, callModes: ['loud', 'type'], callDefaultMode: 'loud', callUnknownNumbers: 'not-in-service' };
const journals = new Map();
const created = [];
const bus = [];
const clients = {};
function makeActor(id, name, me) {
  const flags = {};
  return { id, name, hasPlayerOwner: true, img: '', get isOwner() { return me.isGM || (owners[id] || []).includes(me.id); },
    testUserPermission: (u) => u.isGM || (owners[id] || []).includes(u.id), getFlag: (_m, k) => flags[k], setFlag: async (_m, k, v) => { flags[k] = v; } };
}
function journal(key, userId) {
  if (!journals.has(key)) journals.set(key, { id: `j-${key}`, flags: {}, pages: { contents: [] }, getFlag: (_m, k) => journals.get(key).flags[k],
    createEmbeddedDocuments: async (_t, docs) => { if (!clients[userId].g.user.isGM) throw new Error('players cannot write journals'); journals.get(key).pages.contents.push(...docs.map((d, i) => ({ id: `p${journals.get(key).pages.contents.length}${i}`, ...d }))); } });
  return journals.get(key);
}
async function makeClient(userId) {
  const me = users.find((u) => u.id === userId);
  const listeners = new Map();
  const events = [];
  const actors = new Map(['v', 'judy', 'tam'].map((id) => [id, makeActor(id, id[0].toUpperCase() + id.slice(1), me)]));
  me.character = actors.get({ u1: 'v', u2: 'judy', u4: 'tam' }[userId]) || null;
  const net = { currentNetwork: { id: 'CITINET', name: 'CitiNet', type: 'PUBLIC', signalStrength: 78, theme: {} }, currentNetworkId: 'CITINET', signalStrength: 78, isDeadZone: false, isNodeDead: false };
  const g = {
    user: me,
    users: Object.assign([...users], { get: (id) => users.find((u) => u.id === id), get activeGM() { return users.find((u) => u.isGM && u.active) || null; } }),
    actors: { get: (id) => actors.get(id) },
    scenes: { viewed: { id: me.viewedScene, name: me.viewedScene }, get: (id) => ({ id, name: id, notes: [], regions: [], tokens: [], grid: { size: 100 } }) },
    journal: { find: (fn) => [...journals.values()].find(fn), [Symbol.iterator]: () => journals.values() },
    settings: { get: (_m, k) => worldSettings[k], set: async (_m, k, v) => { if (!me.isGM) throw new Error('players cannot write world settings'); worldSettings[k] = JSON.parse(JSON.stringify(v)); } },
    nightcity: {
      eventBus: { on: (ev, cb) => { (listeners.get(ev) || listeners.set(ev, []).get(ev)).push(cb); }, emit: (ev, d) => { events.push([ev, d]); (listeners.get(ev) || []).forEach((cb) => cb(d)); } },
      socketManager: { emit: (op, data) => bus.push({ op, data, sender: userId }), register() {} },
      soundService: { play: (id) => events.push(['sound', id]) },
      masterContactService: { getAll: () => [], getContact: () => null, getByActorId: () => null },
      networkService: net,
      messageRepository: { getInboxJournal: async (owner) => journal(owner, userId) },
      timeService: { getCurrentTime: () => '2045-08-15T22:41:00.000Z' },
    },
    modules: new Map(),
  };
  return { g, events, me, net };
}
const as = async (uid, fn) => { globalThis.game = clients[uid].g; return fn(clients[uid].svc, clients[uid].pp); };
async function flush() {
  for (let guard = 0; bus.length && guard < 200; guard++) {
    const { op, data, sender } = bus.shift();
    for (const uid of Object.keys(clients)) {
      if (uid === sender) continue;
      globalThis.game = clients[uid].g;
      if (op === 'call:event') clients[uid].svc.handleSocket(data, sender);
      else if (op === 'call:logRequest') await clients[uid].svc.handleLogRequest(data);
      else if (op === 'call:payphone') clients[uid].pp.handleSocket(data);
    }
  }
}
globalThis.foundry = { utils: { randomID: () => Math.random().toString(36).slice(2, 10) } };
globalThis.ui = { notifications: { warn() {}, info() {}, error() {} } };
globalThis.CSS = { escape: (s) => s };
globalThis.Hooks = { on() {} };
globalThis.JournalEntry = { create: async (d) => { const j = journal('payphoneLog', 'gm'); j.flags = d.flags[MODULE_ID]; created.push(d); return j; } };
for (const uid of ['gm', 'u1', 'u2', 'u4']) clients[uid] = await makeClient(uid);
globalThis.game = clients.gm.g;
const { CallService } = await imp('scripts/services/CallService.js');
const { PayphoneService } = await imp('scripts/services/PayphoneService.js');
for (const uid of Object.keys(clients)) { globalThis.game = clients[uid].g; clients[uid].svc = new CallService(); clients[uid].pp = new PayphoneService(); clients[uid].g.nightcity.callService = clients[uid].svc; clients[uid].g.nightcity.payphoneService = clients[uid].pp; }

{
  // numbers + a booth on scene S1
  await as('gm', (s) => s.assignNumber({ actorId: 'judy', number: '+72 NC WAT-3188' }));
  await as('gm', (s) => s.assignNumber({ actorId: 'v', number: '+72 NC WAT-7742' }));
  const saved = await as('gm', (_s, pp) => pp.save({ id: 'pp1', name: 'Kabuki, Night Market', number: '+72 NC WAT-0412', sceneId: 'S1', look: { style: 'street' } }));
  ok(saved?.id === 'pp1' && worldSettings.payphones.pp1, 'the GM saves a payphone');
  const line = Object.values(worldSettings.phoneLines).find((l) => l.kind === 'payphone');
  ok(line && line.payphoneId === 'pp1' && line.owner.kind === 'payphone', 'its number is a payphone line nobody owns');
  ok(await as('u2', (_s, pp) => pp.byNumber('+72 NC WAT-0412')?.id) === 'pp1', 'a booth is found by its number (any client)');
  const refused = await as('u1', (_s, pp) => pp.save({ id: 'x', name: 'mine', number: '1', sceneId: 'S1' }).catch(() => null));
  ok(!refused && !worldSettings.payphones.x, 'a player cannot write a payphone');

  // ── V calls Judy from the booth, in a dead zone ──
  clients.u1.net.isDeadZone = true;
  const r = await as('u1', (s) => s.placeCall('+72 NC WAT-3188', { payphone: 'pp1' }));
  ok(r.ok && r.call.from.payphone === 'pp1' && r.call.from.actorId === null, 'V calls from the booth: the place calls, not V');
  ok(r.call.from.realActorId === 'v' && r.call.from.realName === 'V', 'V\'s own client knows who is on the handset');
  ok(r.call.from.name === 'Payphone, Kabuki, Night Market', 'the other end sees the place');
  ok(r.call.net?.id === '' && r.call.net?.type === 'wired', 'wired: no network, so a dead zone does not stop it');
  ok(bus.some((m) => m.op === 'call:event' && m.data.type === 'ring'), 'it rings Judy');
  const ringToJudy = bus.find((m) => m.op === 'call:event' && m.data.type === 'ring' && (m.data.userIds || []).includes('u2'));
  const ringToGm = bus.find((m) => m.op === 'call:event' && m.data.type === 'ring' && (m.data.userIds || []).includes('gm'));
  ok(ringToJudy && !ringToJudy.data.call.from.realName && !ringToJudy.data.call.from.realActorId && !ringToJudy.data.call.from.realUserId, 'what reaches Judy carries no trace of V');
  ok(ringToGm?.data.call.from.realName === 'V', 'the GM is told who really called');
  await flush();
  const id = r.call.id;
  ok(await as('u2', (s) => s.calls.get(id)?.from?.realName) === undefined, 'Judy\'s copy of the call has no real name');
  await as('u2', (s) => s.answer(id)); await flush();
  ok(await as('u1', (s) => s.calls.get(id)?.state) === 'live', 'Judy answers; the call is live');
  await as('u1', (s) => s.hangup(id)); await flush();
  const boothPages = journals.get('payphoneLog')?.pages.contents || [];
  ok(created.length === 1 && created[0].ownership.default === 0, 'the booth log is a GM-only journal');
  const bp = boothPages.find((p) => p.flags[MODULE_ID].callLog.callId === id);
  ok(bp && bp.flags[MODULE_ID].callLog.boothPage && /^V via Payphone/.test(bp.flags[MODULE_ID].callLog.from.name), 'the booth page reads "V via Payphone, …" for the GM');
  ok(!(journals.get('v')?.pages.contents || []).some((p) => p.flags[MODULE_ID].callLog.callId === id), 'nothing goes into V\'s own call log');
  const jp = (journals.get('judy')?.pages.contents || []).find((p) => p.flags[MODULE_ID].callLog.callId === id);
  const jl = jp?.flags[MODULE_ID].callLog;
  ok(jl && !JSON.stringify(jl).includes('"realName"') && !JSON.stringify(jl).includes('"v"'), 'Judy\'s log page names the place only');
  const all = await as('gm', (s) => s.allLogs());
  ok(all.find((l) => l.callId === id)?.boothPage, 'the GM\'s call log shows the booth page');
  ok((await as('gm', (_s, pp) => pp.logOf('pp1'))).some((l) => l.callId === id), 'the booth\'s own log lists it');
  clients.u1.net.isDeadZone = false;

  // ── Judy calls the booth: it rings the scene; two pick up at once ──
  const r2 = await as('u2', (s) => s.placeCall('+72 NC WAT-0412'));
  ok(r2.ok && r2.call.to.kind === 'payphone' && r2.call.to.sceneId === 'S1', 'calling a booth rings a payphone on its scene');
  await flush();
  const id2 = r2.call.id;
  ok(await as('u1', (s) => s._role(s.calls.get(id2))) === 'callee' && await as('u4', (s) => s._role(s.calls.get(id2))) === 'callee', 'it rings everyone viewing the scene');
  ok(await as('gm', (s) => s._ringsHere(s.calls.get(id2))) === false, 'not the GM');
  ok(clients.u1.events.some(([e, d]) => e === 'call:ringing' && d.role === 'callee') || clients.u1.events.some(([e]) => /ring/i.test(e)), 'V\'s client hears it ring');
  await as('u1', (s) => s.answer(id2));
  await as('u4', (s) => s.answer(id2));
  await flush();
  ok(await as('u2', (s) => s.calls.get(id2)?.answeredBy) === 'u1', 'the first pick-up wins');
  ok(await as('u4', (s) => s.calls.get(id2)?.state) !== 'live', 'the second is told it was taken');
  ok(await as('u2', (s) => s.calls.get(id2)?.to?.realName) === undefined, 'Judy never learns who picked up');
  ok(await as('gm', (s) => s.calls.get(id2)?.to?.realName) === 'V', 'the GM does');
  await as('u2', (s) => s.hangup(id2)); await flush();
  const jp2 = (journals.get('judy')?.pages.contents || []).find((p) => p.flags[MODULE_ID].callLog.callId === id2);
  ok(jp2 && !JSON.stringify(jp2.flags[MODULE_ID].callLog).includes('"realName":"V"'), 'Judy\'s page for it names the place only');
  const bp2 = (journals.get('payphoneLog')?.pages.contents || []).find((p) => p.flags[MODULE_ID].callLog.callId === id2);
  ok(bp2 && /V via Payphone/.test(bp2.flags[MODULE_ID].callLog.to.name), 'the booth page says V answered');

  // ── out of order: it never rings ──
  await as('gm', (_s, pp) => pp.save({ ...pp.get('pp1'), condition: 'out' }));
  const before = bus.length;
  const r3 = await as('u2', (s) => s.placeCall('+72 NC WAT-0412'));
  ok(r3.ok && !bus.slice(before).some((m) => m.data?.type === 'ring'), 'an out-of-order booth rings out');
  bus.length = 0;

  // ── moving a booth to another number frees the old one ──
  await as('gm', (_s, pp) => pp.save({ ...pp.get('pp1'), condition: 'working', number: '+72 NC WAT-0413' }));
  const kinds = Object.entries(worldSettings.phoneLines).filter(([, l]) => l.kind === 'payphone').map(([k]) => k);
  ok(kinds.length === 1 && kinds[0].endsWith('0413') && !('' in worldSettings.phoneLines), 'a new number: the old payphone line goes');
}

// ═══ 4. Wiring ═══
{
  const sm = read('scripts/core/SettingsManager.js');
  ok(/register\(MODULE_ID, 'payphones'/.test(sm) && /register\(MODULE_ID, 'payphoneStyles'/.test(sm), 'both settings are registered');
  const C = read('scripts/utils/constants.js');
  for (const s of ['payphone-ring', 'payphone-hook', 'payphone-chip']) {
    const m = C.match(new RegExp(`'${s}': '([^']+)'`));
    ok(m && fs.existsSync(`${ROOT}/assets/sounds/${m[1]}`), `sound ${s} exists on disk`);
    ok(read('scripts/utils/soundCatalog.js').includes(`'${s}':`), `sound ${s} is on the Sound Board`);
  }
  ok(/PAYPHONE: 'call:payphone'/.test(C) && /PAYPHONE_STATE:/.test(C), 'socket op + event');
  const reg = read('scripts/init/registerCallSystem.js');
  ok(/SOCKET_OPS\.PAYPHONE/.test(reg) && /new PayphoneService/.test(reg) && /new PayphoneBooth/.test(reg), 'service, booth and socket handler are wired at startup');
  ok(/@import 'components\/payphone-booth\.css'/.test(read('styles/night-city-messenger.css')), 'the stylesheet is imported');
  ok(read('scripts/utils/accessPoints.js').includes("payphone: { label: 'Payphone'") && /node\|payphone\)/.test(read('scripts/utils/accessPoints.js')), 'payphone is an access-point kind with journal links');
  const ap = read('scripts/integrations/AccessPoints.js');
  ok(/case 'payphone': return ns\?\.payphoneService\?\.open\?\.\(ref\.id, \{ skipReach: true \}\)/.test(ap), 'links, macros and chat cards open a booth without a reach check');
  const pins = read('scripts/integrations/TerminalScenePins.js');
  ok(/accessPayphone/.test(pins) && /_reachBlock\(doc, Number\(doc\.getFlag\(MODULE_ID, 'accessRange'\)\) \|\| 0, 'the payphone'\)/.test(pins), 'a payphone pin checks reach');
  ok(/removePinsForPayphone/.test(pins), 'a deleted payphone takes its pins');
  const fr = read('scripts/core/FactoryReset.js');
  ok(/accessPayphone/.test(fr) && /deleteEmbeddedDocuments\('Region', areas\)/.test(fr), 'Factory Reset clears payphone pins and step-on areas');
  ok(/accessPayphone/.test(read('scripts/ui/AdminPanel/tabs/ToolsTab.js')), 'Orphan Audit finds dead payphone pins');
  const tab = read('scripts/ui/AdminPanel/tabs/PhoneTab.js');
  ok(/payphonesHtml\(this\)/.test(tab) && /wirePayphones\(this, root\)/.test(tab) && /payphone:/.test(tab), 'the Phone tab shows the page and opens to a booth');
  ok(/\['payphones', 'Payphones'/.test(read('scripts/ui/AdminPanel/tabs/phoneModel.js')), 'Payphones in the Phone nav');
  ok(/\{\{\{payphonesHtml\}\}\}/.test(read('templates/admin-panel/tab-phone.hbs')), 'the template prints it');
  const view = read('scripts/ui/AdminPanel/tabs/payphonesView.js');
  const acts = [...new Set([...view.matchAll(/data-pph="([a-zA-Z]+)"/g)].map((m) => m[1]))];
  ok(acts.length >= 14 && acts.every((a) => view.includes(`case '${a}':`)), `every admin button has a case (${acts.length})`);
  const css = read('styles/components/payphone-booth.css');
  for (const cls of [...new Set([...view.matchAll(/class="(ncm-pph-[\w-]+)/g)].map((m) => m[1]))]) ok(css.includes(`.${cls}`), `styled: .${cls}`);
  const others = fs.readdirSync(`${ROOT}/styles`, { recursive: true }).filter((f) => f.endsWith('.css') && !f.endsWith('payphone-booth.css'));
  ok(!others.some((f) => /\.ncm-pb[_-]|\.ncm-pph-/.test(read(`styles/${f}`.replace(/\\/g, '/')))), 'no other stylesheet uses the ncm-pb / ncm-pph prefixes');
  ok(/kind === 'payphone'/.test(read('scripts/ui/Calls/CallHud.js')), 'the call screen leaves a booth\'s ring to the booth');
  ok(/'pay'/.test(read('scripts/ui/AdminPanel/tabs/phoneModel.js')) && /return 'pay'/.test(tab), 'booth calls are their own kind in the GM\'s queue');
  ok(/ringPayphone/.test(read('scripts/integrations/MacroAPI.js')) && /openPayphone/.test(read('scripts/integrations/MacroAPI.js')), 'macros: open a payphone, ring a payphone');
}

console.log(`test-payphones: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
