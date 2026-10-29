// Sim: Admin → Networks → This scene as the RADIO DIAL (2026-10-28, dev-approved Version A of
// dev/mockups/admin-networks-scene-modules-mock.html).
//   1. the pure rules (tabs/networksDial.js): quality words, segments, crowd height,
//      pointer → percent, keys, the access sentence, the dial view-model
//   2. the REAL NetworksTab scene context + ops (pick, start flag, broadcast-to, on/off, dead zone)
//   3. the drag: DOM-only while moving, ONE updateNetwork({signalStrength}) on release;
//      keys debounce to one write; a dead zone locks the meters
//   4. a REAL Handlebars render; CSS (tokens, network colour toward text on clean-light,
//      reduced motion, button resets, no prefix collision)
// Run: node dev/tools/sims/test-networks-dial.mjs
import fs from 'fs';
import { createRequire } from 'module';
import { pathToFileURL, fileURLToPath } from 'url';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };
const read = (p) => fs.readFileSync(`${ROOT}/${p}`, 'utf8');
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
const MODULE_ID = 'night-city-messenger';
const clone = (o) => JSON.parse(JSON.stringify(o));

// ═══ 1. Pure rules ═══
const D = await imp('scripts/ui/AdminPanel/tabs/networksDial.js');
ok(['Strong', 'Good', 'Weak', 'Faint', 'None'].join() === [82, 55, 30, 12, 0].map(D.signalQuality).join() && D.signalQuality(80) === 'Strong' && D.signalQuality(50) === 'Good' && D.signalQuality(25) === 'Weak', 'quality words on the app-wide thresholds');
ok(D.litCount(82) === 16 && D.litCount(0) === 0 && D.litCount(100) === 20 && D.litCount(140) === 20 && D.litCount(-5) === 0, 'litCount (clamped)');
const segs = D.dialSegments(30);
ok(segs.length === D.DIAL_SEGS && segs[0].b === 0 && segs[19].b === 95 && segs.filter((s) => s.lit).length === 6 && segs.filter((s) => s.top).map((s, i) => s.b).join() === '20,25', 'segments: 20, bottom first, the two top lit ones are the head');
ok(D.crowdBottom(0) === D.CROWD_MIN && D.crowdBottom(100) === D.CROWD_MAX && D.crowdBottom(40) === 40, 'faces stay inside the meter');
ok(D.pctAtPointer(100, { bottom: 200, height: 200 }) === 50 && D.pctAtPointer(500, { bottom: 200, height: 200 }) === 0 && D.pctAtPointer(-50, { bottom: 200, height: 200 }) === 100, 'pointer → percent, clamped');
ok(D.stepSignal(50, 'ArrowUp') === 51 && D.stepSignal(50, 'ArrowDown', true) === 40 && D.stepSignal(95, 'PageUp') === 100 && D.stepSignal(5, 'Home') === 0 && D.stepSignal(5, 'End') === 100 && D.stepSignal(5, 'a') === null, 'keys: ±1, Shift ±10, Page ±10, Home/End');
ok(/^Open/.test(D.accessWords({ requiresAuth: false })), 'access: open');
ok(D.accessWords({ requiresAuth: true, allowPassword: true, allowSkillCheck: true, bypassSkills: ['Interface'], bypassDC: 15 }) === 'Password or Interface DV 15', 'access: OR');
ok(D.accessWords({ requiresAuth: true, authLogic: 'all', allowPassword: true, allowKeyItem: true, keyItemName: 'Corporate ID', failureMode: 'damage' }) === 'Password and key item (Corporate ID) · Black ICE', 'access: AND + key item + Black ICE');
ok(D.accessWords({ requiresAuth: true, allowSkillCheck: true, bypassSkills: ['Interface', 'Tech'] }, (s, k) => (k === 'Tech' ? 17 : 15)) === 'Interface DV 15 / Tech DV 17', 'access: per-skill DVs through the injected reader');
const rows = [
  { id: 'A', name: 'CitiNet', on: true, isGlobal: true, isDefault: false, level: 82, players: [{ name: 'V' }] },
  { id: 'B', name: 'Watson', on: true, isDefault: true, level: 55, players: [] },
  { id: 'C', name: 'Dark', on: false, level: 12, players: [] },
];
let V = D.buildDial(rows, {});
ok(V.picked.id === 'B' && V.startName === 'Watson' && V.liveCount === 2, 'default pick = the start network; summary counts the networks on here');
ok(V.cols[0].pctLabel === '82' && V.cols[0].quality === 'Strong' && V.cols[0].playerCount === 1 && !V.cols[0].nobody && V.cols[1].nobody, 'columns: level, quality, faces');
ok(V.cols[2].canStart === false && V.cols[0].canStart, 'a network switched off here cannot be the start');
V = D.buildDial(rows, { sel: 'C' });
ok(V.picked.id === 'C' && V.cols[2].sel && !V.cols[1].sel, 'an explicit pick wins');
V = D.buildDial(rows, { jam: true });
ok(V.cols.every((c) => c.pctLabel === '—' && c.quality === 'Jammed' && !c.canStart) && V.cols[0].level === 82 && V.liveCount === 0, 'dead zone: every meter jammed, the level kept');
ok(D.buildDial([], {}).picked === null, 'no networks → nothing picked');

// ═══ 2. The REAL NetworksTab ═══
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const merge = (a, b) => { const o = { ...a }; for (const [k, v] of Object.entries(b || {})) o[k] = isObj(v) && isObj(a?.[k]) ? merge(a[k], v) : v; return o; };
globalThis.foundry = { utils: { debounce: (f) => f, deepClone: clone, mergeObject: (a, b) => merge(a, b), randomID: () => Math.random().toString(36).slice(2, 10) } };
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
const mkScene = (id, name, flags = {}) => { const s = { id, name, flags: { [MODULE_ID]: clone(flags) }, _stats: {}, folder: null }; s.getFlag = (m, k) => (m === MODULE_ID ? s.flags[MODULE_ID][k] : undefined); return s; };
const scenes = [mkScene('S1', 'Night Market', { networkAvailability: { WAT: true, ARA: true, DARK: false }, defaultNetwork: 'WAT' }), mkScene('S2', 'Badlands', { deadZone: true })];
const NETS = [
  { id: 'CITI', name: 'CitiNet', type: 'PUBLIC', availability: { global: true, scenes: [] }, signalStrength: 82, security: { requiresAuth: false }, effects: {}, theme: { color: '#19f3f7', icon: 'fa-tower-broadcast' } },
  { id: 'WAT', name: 'Watson Free', type: 'PUBLIC', availability: { global: false, scenes: [] }, signalStrength: 55, security: { requiresAuth: false }, effects: {}, theme: { color: '#f5a623', icon: 'fa-wifi' } },
  { id: 'ARA', name: 'Arasaka CorpNet', type: 'CORPORATE', availability: { global: false, scenes: [] }, signalStrength: 30, security: { requiresAuth: true, allowPassword: true, allowSkillCheck: true, bypassSkills: ['Interface'], bypassDC: 15 }, effects: {}, theme: { color: '#4a8ab5', icon: 'fa-building' } },
  { id: 'DARK', name: 'Darknet node', type: 'UNDERGROUND', availability: { global: false, scenes: [] }, signalStrength: 12, security: { requiresAuth: true, allowSkillCheck: true, bypassSkills: ['Interface'], bypassDC: 17, failureMode: 'damage' }, effects: {}, theme: { color: '#b87aff', icon: 'fa-user-secret' } },
  { id: 'FAR', name: 'Far mesh', type: 'CUSTOM', availability: { global: false, scenes: [] }, signalStrength: 40, security: {}, effects: {}, theme: { color: '#00ff41', icon: 'fa-skull' } },
];
const calls = [];
const networkService = {
  getAllNetworks: () => NETS, getNetwork: (id) => NETS.find((n) => n.id === id) || null, getAvailableNetworks: () => NETS.filter((n) => n.availability.global),
  async updateNetwork(id, d) { calls.push(['update', id, clone(d)]); const i = NETS.findIndex((n) => n.id === id); NETS[i] = merge(NETS[i], d); return { success: true }; },
  async setSceneNetworkAvailability(sceneId, patch) { calls.push(['avail', sceneId, clone(patch)]); const s = scenes.find((x) => x.id === sceneId); s.flags[MODULE_ID].networkAvailability = { ...(s.flags[MODULE_ID].networkAvailability || {}), ...patch }; },
  async setSceneDefaultNetwork(sceneId, id) { calls.push(['default', sceneId, id]); scenes.find((x) => x.id === sceneId).flags[MODULE_ID].defaultNetwork = id; },
  async toggleDeadZone(sceneId, dead) { calls.push(['dead', sceneId, dead]); scenes.find((x) => x.id === sceneId).flags[MODULE_ID].deadZone = dead; },
};
const users = [
  { id: 'U1', name: 'Sam', isGM: false, active: true, character: { name: 'V', img: '' }, color: '#b85c7a' },
  { id: 'U2', name: 'Ana', isGM: false, active: true, character: { name: 'Judy', img: 'j.png' }, color: '#5c86b8' },
  { id: 'U3', name: 'Lee', isGM: false, active: true, character: { name: 'Rache', img: '' }, color: '#7ab85c' },
  { id: 'U4', name: 'Mo', isGM: false, active: true, character: { name: 'Panam', img: '' }, color: '#b8995c' },
  { id: 'G1', name: 'GM', isGM: true, active: true, character: null },
];
users.get = (id) => users.find((u) => u.id === id);
globalThis.game = {
  user: users[4], users, actors: { filter: () => [], get: () => null }, items: { contents: [] },
  scenes: { contents: scenes, get: (id) => scenes.find((s) => s.id === id), viewed: scenes[0] },
  nightcity: { playerNetworks: new Map([['U1', { networkId: 'CITI' }], ['U2', { networkId: 'CITI' }], ['U3', { networkId: 'FAR' }]]), securityService: { getActiveLockouts: () => [] } },
  settings: { get: () => false },
};
globalThis.canvas = { scene: scenes[0] };
const { NetworksTab } = await imp('scripts/ui/AdminPanel/tabs/NetworksTab.js');
const { ScopePicker } = await imp('scripts/utils/scopePicker.js');
let renders = 0;
const app = { id: 'ncm-admin-panel', _activeTab: 'networks', element: null, isPopout: false, render() { renders++; }, constructor: {},
  get networkService() { return networkService; }, get accessLogService() { return { entryCount: 0, getEntries: () => [], _entries: [] }; } };
const tab = new NetworksTab(app);
let sc = tab.prepareContext().net2.scene;
ok(sc.dial.cols.map((c) => c.id).join() === 'CITI,WAT,ARA,DARK', 'the dial lists the networks that reach this scene (global + listed; DARK listed but off)');
ok(sc.dial.picked.id === 'WAT' && sc.dial.startName === 'Watson Free' && sc.dial.liveCount === 3, 'picked = the start network; 3 on here');
const col = (id) => sc.dial.cols.find((c) => c.id === id);
ok(col('CITI').players.map((p) => p.name).join() === 'V,Judy' && col('CITI').level === 82 && col('CITI').ic.color === '#19f3f7', 'CitiNet: V + Judy on it, 82%, its own colour');
ok(col('ARA').accessText === 'Password or Interface DV 15' && col('DARK').reach === 'Switched off here' && col('CITI').reach === 'Every scene', 'access sentence + reach');
ok(sc.foot.map((p) => `${p.name}:${p.state}`).join() === 'V:on,Judy:on,Rache:away,Panam:none', 'foot: on here / on a network this scene can’t reach / not reported');
ok(sc.rows && sc.elsewhere && sc.defaultOptions, 'the older keys survive (sims + Overview read them)');

const el = (ds) => ({ dataset: ds, closest: () => null });
await tab.onAct('dialPick', {}, el({ networkId: 'ARA' }));
sc = tab.prepareContext().net2.scene;
ok(tab._dialSel === 'ARA' && sc.dial.picked.id === 'ARA' && col('ARA').sel, 'dialPick picks a network for the readout');
await tab.onAct('dialStart', {}, el({ networkId: 'ARA', sceneId: 'S1' }));
ok(calls.at(-1).join() === 'default,S1,ARA', 'the flag moves where players start');
await tab.onAct('dialStart', {}, el({ networkId: 'ARA', sceneId: 'S1' }));
ok(calls.at(-1).join() === 'default,S1,', 'clicking the lit flag clears it (no start network)');
await tab.onAct('dialBcast', {}, el({ networkId: 'CITI' }));
ok(ScopePicker.value(tab.scopeId('bcast')).join() === 'CITI' && tab._bcastFocus, 'Broadcast from the readout aims the broadcast box at that network');
await tab.onAct('sceneNet', {}, el({ networkId: 'DARK', sceneId: 'S1' }));
ok(calls.at(-1)[0] === 'avail' && calls.at(-1)[2].DARK === true, 'on/off is the existing sceneNet op');
await tab.onAct('sceneDead', {}, el({ sceneId: 'S1' }));
ok(calls.at(-1).join() === 'dead,S1,true', 'the lever is the existing dead-zone op');
sc = tab.prepareContext().net2.scene;
ok(sc.jam && sc.dial.jam && sc.dial.cols.every((c) => c.quality === 'Jammed') && col('CITI').level === 82, 'dead zone: meters jam, levels kept');
ok(sc.foot.find((p) => p.name === 'V').state === 'jam', 'dead zone: online players read "no signal"');
await tab.onAct('sceneDead', {}, el({ sceneId: 'S1' }));

// ═══ 3. The drag — DOM only, one write on release ═══
{
  const handlers = {}; const docH = {};
  globalThis.document = { addEventListener: (t, f) => { docH[t] = f; }, removeEventListener: (t) => { delete docH[t]; } };
  const cls = () => { const s = new Set(); return { add: (c) => s.add(c), remove: (c) => s.delete(c), contains: (c) => s.has(c), toggle: (c, on) => (on ? s.add(c) : s.delete(c)), has: (c) => s.has(c) }; };
  const segEls = Array.from({ length: 20 }, () => ({ classList: cls() }));
  const thumb = { style: {} }, crowd = { style: {} }, pctB = { textContent: '' }, q = { textContent: '' };
  const colEl = { querySelector: (sel) => ({ '.ncm-net2-dialcrowd': crowd, '.ncm-net2-dialpct b': pctB, '.ncm-net2-dialq': q }[sel] || null) };
  const attrs = { 'aria-valuenow': '82' };
  const meter = { dataset: { networkId: 'CITI' }, classList: cls(), addEventListener: (t, f) => { handlers[t] = f; }, closest: () => colEl,
    querySelectorAll: (sel) => (sel === '.ncm-net2-dialseg' ? segEls : []), querySelector: (sel) => (sel === '.ncm-net2-dialthumb' ? thumb : null),
    getBoundingClientRect: () => ({ bottom: 200, height: 158 }), setAttribute: (k, v) => { attrs[k] = v; }, getAttribute: (k) => attrs[k], focus() {} };
  const locked = { dataset: { networkId: 'WAT' }, classList: { contains: (c) => c === 'is-locked' }, addEventListener: () => { throw new Error('a locked meter must not be wired'); } };
  const root = { querySelectorAll: (sel) => (sel === '.ncm-net2-dialm[data-network-id]' ? [meter, locked] : []), querySelector: () => null };
  tab._wireDialMeters(root);
  const writes = () => calls.filter((c) => c[0] === 'update').length;
  const w0 = writes(), r0 = renders;
  handlers.pointerdown({ button: 0, clientY: 200 - 79, preventDefault() {} });           // 50%
  docH.pointermove({ clientY: 200 - 158 * 0.3 });                                         // 30%
  docH.pointermove({ clientY: 200 - 158 * 0.25 });                                        // 25%
  ok(writes() === w0 && renders === r0, 'dragging writes nothing and re-renders nothing');
  ok(meter.classList.has('is-drag') && thumb.style.bottom === '25%' && pctB.textContent === '25' && q.textContent === 'Weak' && crowd.style.bottom === '25%' && attrs['aria-valuenow'] === '25', 'the drag paints the thumb, number, quality, faces and aria');
  ok(segEls.filter((s) => s.classList.has('is-lit')).length === 5 && segEls[4].classList.has('is-top') && !segEls[5].classList.has('is-lit'), 'the drag lights the segments the template would');
  await docH.pointerup();
  ok(writes() === w0 + 1 && calls.at(-1).join() === 'update,CITI,[object Object]' && calls.at(-1)[2].signalStrength === 25 && !meter.classList.has('is-drag') && !docH.pointermove, 'release: ONE updateNetwork({signalStrength}) and the listeners come off');
  // keys: several presses, one write
  const realSet = globalThis.setTimeout; const timers = [];
  globalThis.setTimeout = (f) => { timers.push(f); return timers.length; };
  globalThis.clearTimeout = (id) => { timers[id - 1] = null; };
  const ev = (key, shiftKey = false) => ({ key, shiftKey, preventDefault() {} });
  handlers.keydown(ev('ArrowUp')); handlers.keydown(ev('ArrowUp')); handlers.keydown(ev('ArrowUp', true));
  ok(attrs['aria-valuenow'] === '37' && writes() === w0 + 1, 'arrow keys paint at once (25 → 37)…');
  for (const f of timers) if (f) await f();
  ok(writes() === w0 + 2 && calls.at(-1)[2].signalStrength === 37, '…and write once when they stop');
  globalThis.setTimeout = realSet;
  const before = writes(); handlers.keydown(ev('x'));
  ok(writes() === before, 'other keys do nothing');
}

// ═══ 4. REAL render + CSS ═══
const tpl = read('templates/admin-panel/tab-networks.hbs');
const js = read('scripts/ui/AdminPanel/tabs/NetworksTab.js');
let Handlebars = null;
for (const p of ['C:/Program Files/Foundry Virtual Tabletop/resources/app/package.json', 'C:/Program Files (x86)/Foundry Virtual Tabletop/resources/app/package.json']) {
  if (!fs.existsSync(p)) continue;
  try { Handlebars = createRequire(p)('handlebars'); break; } catch { /* keep looking */ }
}
if (!Handlebars) { fail++; console.error('FAIL: could not load Handlebars from a Foundry install — render checks did not run'); }
else {
  const H = Handlebars.create();
  const { registerTagHueHelper } = await imp('scripts/utils/tagHue.js'); registerTagHueHelper(H);
  H.registerHelper('eq', (a, b) => String(a) === String(b));
  H.registerHelper('gt', (a, b) => a > b);
  H.registerHelper('lower', (s) => String(s ?? '').toLowerCase());
  H.registerPartial('modules/night-city-messenger/templates/partials/countermeasure-override.hbs', read('templates/partials/countermeasure-override.hbs'));
  const render = H.compile(tpl);
  // back to the opening state (the op/drag checks above moved things)
  NETS.find((n) => n.id === 'CITI').signalStrength = 82;
  Object.assign(scenes[0].flags[MODULE_ID], { defaultNetwork: 'WAT', networkAvailability: { WAT: true, ARA: true, DARK: false } });
  tab._view = 'scene'; tab._dialSel = 'ARA';
  const html = render({ activeTab: 'networks', ...tab.prepareContext() });
  if (process.env.NCM_DUMP) fs.writeFileSync(`${process.env.NCM_DUMP}/networks-dial.html`, html);
  ok((html.match(/class="ncm-net2-dialcol[ "]/g) || []).length === 4, 'four meters');
  ok((html.match(/class="ncm-net2-dialseg/g) || []).length === 80, 'twenty segments each');
  ok(/ncm-net2-dialcol" style="--nc:#19f3f7" data-network-id="CITI"/.test(html), 'a column wears the network’s own colour');
  ok(/class="ncm-net2-dialm" data-network-id="CITI" role="slider" tabindex="0" aria-label="Signal for CitiNet" aria-valuemin="0" aria-valuemax="100" aria-valuenow="82" aria-valuetext="82% · Strong"/.test(html), 'the meter is a real, focusable slider');
  ok(/ncm-net2-dialcol is-sel" style="--nc:#4a8ab5" data-network-id="ARA"/.test(html) && /ncm-net2-dialread__nm">Arasaka CorpNet</.test(html), 'the picked network is lit and read out');
  ok(/ncm-net2-dialcol is-off"[^>]*data-network-id="DARK"/.test(html) && !/data-op="dialStart"[^>]*data-network-id="DARK"/.test(html), 'switched off here: dimmed, no start flag');
  ok(/data-op="dialStart" data-scene-id="S1" data-network-id="WAT" aria-pressed="true"/.test(html) || /dialflag is-on" data-action="tabAct" data-op="dialStart" data-scene-id="S1" data-network-id="WAT"/.test(html), 'the start network’s flag is lit');
  ok(/data-op="sceneDead" data-scene-id="S1" role="switch" aria-checked="false"/.test(html), 'the lever is a switch');
  // the number box + ▲▼ beside each meter (dev 2026-10-28)
  ok((html.match(/<input type="number" class="ncm-net2-dialnum" data-dial-num min="0" max="100" step="1" value="\d+"/g) || []).length === 4, 'every meter has a 0–100 number box holding its level');
  ok((html.match(/data-dial-step="1"/g) || []).length === 4 && (html.match(/data-dial-step="-1"/g) || []).length === 4, 'every meter has ▲ and ▼');
  ok(html.includes('ncm-net2-dialrk ncm-net2-dialrk--dead"><i class="fas fa-tower-broadcast"></i>Dead zone'), 'the dead-zone heading is its own red label');
  ok(/ncm-net2-dialtog is-on is-lock"/.test(html) && /data-op="sceneNet" data-scene-id="S1" data-network-id="ARA"/.test(html), 'global = locked on; others switch here');
  ok(/data-op="edit" data-network-id="ARA"/.test(html) && /data-op="dialBcast" data-network-id="ARA"/.test(html) && /data-op="logFor" data-network-id="ARA"/.test(html), 'readout: Edit / Broadcast / Log');
  ok(/Rache<\/b><span class="ncm-net2-dialp__s">on Far mesh — not reachable here/.test(html) && /Panam<\/b><span class="ncm-net2-dialp__s">hasn’t reported/.test(html), 'the foot names who is where');
  ok(html.includes('data-scope-btn') && /data-op="goScenes"/.test(html), 'the scene + broadcast + here pickers and Every scene survive');
  ok(!/select data-net2-default/.test(html) && !/ncm-net2-jamsw/.test(html), 'the flags and the lever replaced the start select and the dead-zone button');
  ok(!/undefined|\[object Object\]|NaN/.test(html), 'no undefined / NaN leaks');
  scenes[0].flags[MODULE_ID].deadZone = true;
  const dead = render({ activeTab: 'networks', ...tab.prepareContext() });
  ok(!/data-dial-num/.test(dead) && !/data-dial-step/.test(dead), 'dead zone: no number box or arrows (nothing to set)');
  ok(/ncm-net2-dial is-dead/.test(dead) && (dead.match(/ncm-net2-dialm is-locked" data-network-id="[A-Z]+" role="slider" tabindex="-1"/g) || []).length === 4 && /aria-checked="true"/.test(dead) && /Dead zone on/.test(dead), 'dead zone: every meter locked + out of the tab order, the lever on');
  scenes[0].flags[MODULE_ID].deadZone = false;
  // 2026-10-28 round: scene + broadcast share one row; the readout carries colour hierarchy; every view has a page title
  { const row = html.slice(html.indexOf('ncm-net2-scenerow'), html.indexOf('ncm-net2-dial"'));
    ok(row.includes('class="ncm-net2-scene ') && row.includes('class="ncm-net2-bc"') && row.includes('data-net2-bcast') && row.includes('data-op="broadcast"'), 'scene card + broadcast card sit in the one row'); }
  ok(/<header class="ncm-tabhd"><i class="fas fa-location-crosshairs"><\/i><div><h2>This scene<\/h2><p>[^<]+<\/p><\/div><\/header>/.test(html), 'This scene opens with the shared page title');
  const rd = html.slice(html.indexOf('class="ncm-net2-dialread'), html.indexOf('ncm-net2-addrow'));
  ok(/ncm-net2-dialread__hd/.test(rd) && /ncm-net2-dialread__ic/.test(rd), 'readout: a band in the network colour');
  ok(/ncm-net2-dialread__sig is-(good|attn)"/.test(rd) && /ncm-net2-dialread__bar"><span style="width:\d+%/.test(rd), 'readout: the signal in its quality colour, with a bar');
  ok(/class="ncm-tagp" style="--tc:var\(--ncm-hue-\d\)">[A-Z]/.test(rd), 'readout: the type is a hue pill');
  ok(/ncm-tagp is-(act|good|attn)"><i class="fas fa-(globe|location-dot|power-off)"/.test(rd), 'readout: reach is a meaning pill');
  ok(/ncm-tagp ncm-net2-dialkv__wrap is-(secret|bad|plain)"/.test(rd), 'readout: access is a meaning pill (secured = secret, ICE = bad)');
  ok(/ncm-net2-btn--primary" data-action="tabAct" data-op="edit"/.test(rd) && (rd.match(/ncm-net2-btn--quiet/g) || []).length === 2, 'readout: Edit filled, Broadcast + Log quiet');
  ok(/ncm-net2-dialread is-jam"/.test(dead) && /ncm-net2-dialread__sig is-bad"/.test(dead) && />Jammed</.test(dead), 'dead zone: the readout reads Jammed in red');
  for (const [v, h] of [['all', 'All networks'], ['scenes', 'Scenes'], ['log', 'Activity log']]) {
    tab._view = v; const o = render({ activeTab: 'networks', ...tab.prepareContext() });
    ok(new RegExp('<header class="ncm-tabhd"><i class="fas fa-[a-z-]+"></i><div><h2>' + h + '</h2><p>[^<]+</p></div>(<div class="ncm-tabhd__end">.*?</div>)?</header>').test(o), h + ' opens with the shared page title');
  }
  tab._view = 'scene';
  const bal = (s) => (s.match(/<div\b/g) || []).length === (s.match(/<\/div>/g) || []).length && (s.match(/<button\b/g) || []).length === (s.match(/<\/button>/g) || []).length;
  ok(bal(html) && bal(dead), 'div + button tags balance');
}
const dialTpl = tpl.slice(tpl.indexOf('THE RADIO DIAL'), tpl.indexOf('ALL NETWORKS'));
ok(!/\{\{(sub|gt|lower|concat)\b|\(gt |\(lower |\(concat /.test(dialTpl), 'the dial uses no sub/gt/lower/concat');
ok(!/\.\.\/\.\.\//.test(dialTpl), 'no deep ../ (it uses @root)');
for (const op of new Set([...dialTpl.matchAll(/data-op="([a-zA-Z]+)"/g)].map((m) => m[1]))) ok(new RegExp(`case '${op}'`).test(js), `onAct handles "${op}"`);
ok(/_wireDialMeters\(el\)/.test(js) && !/_wireSignalSliders/.test(js), 'onRender wires the dial; the old slider wiring is gone');
ok(/pointerup[\s\S]{0,40}up\b/.test(js) && /updateNetwork\?\.\(m\.dataset\.networkId, \{ signalStrength: pct \}\)/.test(js), 'the write is updateNetwork({signalStrength}) — the same path the slider used');
const css = read('styles/components/admin-panel/tab-networks.css');
const dialCss = css.slice(css.indexOf('THIS SCENE — the RADIO DIAL'));
for (const c of new Set([...(dialTpl + js).matchAll(/ncm-net2-dial[a-z0-9_-]*/g)].map((m) => m[0]).filter((x) => !x.endsWith('-') && !x.endsWith('--')))) ok(dialCss.includes(`.${c}`), `.${c} is styled`);
ok(!(dialCss.replace(/\/\*[\s\S]*?\*\//g, '').match(/#[0-9a-fA-F]{3,6}\b/g)), 'dial CSS: tokens only (the network colour arrives inline as --nc)');
ok(/\[data-ncm-admin-theme="clean-light"\] \.ncm-net2-dialcol[^{]*\{ --ncv: color-mix\(in oklab, var\(--nc\) 55%, var\(--ncm-text-primary\)\)/.test(dialCss), 'clean-light pulls the network colour toward the text');
ok(/prefers-reduced-motion[\s\S]*ncm-net2-dialseg[\s\S]*transition: none/.test(dialCss), 'reduced motion: no transitions');
ok(/button\.ncm-net2-dialhd[^{]*\{[^}]*appearance: none !important[^}]*width: auto !important/.test(dialCss), 'dial buttons reset Foundry button defaults');
const others = fs.readdirSync(`${ROOT}/styles`, { recursive: true }).filter((f) => String(f).endsWith('.css') && !String(f).endsWith('tab-networks.css'));
ok(!others.some((f) => read(`styles/${String(f).replace(/\\/g, '/')}`).includes('.ncm-net2-dial')), 'the ncm-net2-dial prefix is used by no other stylesheet');

ok(D.qualityTone('Strong') === 'good' && D.qualityTone('Good') === 'good' && D.qualityTone('Weak') === 'attn' && D.qualityTone('Faint') === 'attn' && D.qualityTone('None') === 'bad' && D.qualityTone('Jammed') === 'bad', 'qualityTone: good / attn / bad');
ok(D.accessTone('open') === 'plain' && D.accessTone('sec') === 'secret' && D.accessTone('ice') === 'bad' && D.accessTone(undefined) === 'plain', 'accessTone: open plain, secured violet, ICE red');
ok(/\.ncm-net2-scenerow \{ display: grid; grid-template-columns: repeat\(auto-fit, minmax\(300px, 1fr\)\)/.test(css), 'scene + broadcast: two columns, stacking only when narrow');
{ const js = fs.readFileSync(new URL('../../../scripts/ui/AdminPanel/tabs/NetworksTab.js', import.meta.url), 'utf8');
  ok(/const commit = \(raw\) => \{[\s\S]{0,120}Math\.max\(0, Math\.min\(100, Math\.round/.test(js), 'typed values are clamped to 0–100 and rounded');
  ok(/\[data-dial-step\][\s\S]{0,200}e\.shiftKey \? 10 : 1/.test(js), '▲▼ step by 1, Shift by 10');
  ok(js.includes('document.activeElement !== num'), 'a drag never overwrites the box while it is being typed in');
  ok(/button\.ncm-net2-dialkill \{[\s\S]{0,200}repeating-linear-gradient/.test(css) && /dialkill\.is-on \{[\s\S]{0,300}0 0 14px -4px var\(--ncm-bad\)/.test(css), 'dead zone: red-edged + striped when live, glowing red when on'); }
ok(!/ncm-net2-viewhd/.test(tpl + css), 'the old per-tab view header is gone (shared .ncm-tabhd)');
console.log(`\ntest-networks-dial: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
