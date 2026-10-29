// Sim: Admin → NETWORKS redesign (2026-10-27) — the Network Manager folded into the tab.
// Mock: dev/mockups/admin-networks-redesign-mock.html.
// Drives the REAL NetworksTab + NetworksEditor over mocked Foundry globals:
//   · the editor round-trips EVERY field the old Network Manager could set
//     (render the real template → read the rendered controls back → same network)
//   · the save path is NetworkService.createNetwork / updateNetwork + the scenes'
//     availability flags (Where), exactly the old paths
//   · every data-op the template uses is handled by onAct; every ncm-net2 class is styled
//   · the four views build, filter, and render; openTo grammar; the openers are repointed
//     and the standalone app is gone.
// Run: node dev/tools/sims/test-admin-networks.mjs
import fs from 'fs';
import { createRequire } from 'module';
import { pathToFileURL, fileURLToPath } from 'url';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };
const read = (p) => fs.readFileSync(`${ROOT}/${p}`, 'utf8');
const exists = (p) => fs.existsSync(`${ROOT}/${p}`);
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);

// ═══ Foundry stand-ins ═══
const MODULE_ID = 'night-city-messenger';
const clone = (o) => JSON.parse(JSON.stringify(o));
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const merge = (a, b) => { const o = { ...a }; for (const [k, v] of Object.entries(b || {})) o[k] = isObj(v) && isObj(a?.[k]) ? merge(a[k], v) : v; return o; };
globalThis.foundry = { utils: { debounce: (f) => f, deepClone: clone, mergeObject: (a, b) => merge(a, b), randomID: () => Math.random().toString(36).slice(2, 10) } };
const notes = [];
globalThis.ui = { notifications: { info: (m) => notes.push(['info', m]), warn: (m) => notes.push(['warn', m]), error: (m) => notes.push(['error', m]) } };

function mkScene(id, name, flags = {}, extra = {}) {
  const s = { id, name, flags: { [MODULE_ID]: clone(flags) }, _stats: extra.imported ? { compendiumSource: 'Compendium.x' } : {}, folder: extra.folder ? { id: `F-${extra.folder}`, name: extra.folder } : null };
  s.getFlag = (mod, k) => (mod === MODULE_ID ? s.flags[MODULE_ID][k] : undefined);
  return s;
}
const scenes = [
  mkScene('S1', 'Arasaka Tower — 7th Floor', { networkAvailability: { CORPNET: true, DARKNET: false }, defaultNetwork: 'CORPNET' }, { folder: 'Arasaka' }),
  mkScene('S2', 'The Afterlife', { networkAvailability: { net_after: true } }),
  mkScene('S3', 'Badlands — Route 66', { deadZone: true }),
  mkScene('S4', 'Imported Ruin', {}, { imported: true }),
];
const NETS = [
  { id: 'CITINET', name: 'CitiNet', type: 'PUBLIC', isCore: true, availability: { global: true, scenes: [] }, signalStrength: 75, reliability: 90, security: { level: 'LOW', requiresAuth: false }, effects: { messageDelay: 0, traced: false, anonymity: false, canRoute: true, restrictedAccess: false, allowedRecipientNetworks: [] }, theme: { color: '#19f3f7', icon: 'fa-wifi' } },
  { id: 'CORPNET', name: 'CorpNet', type: 'CORPORATE', isCore: true, availability: { global: false, scenes: [] }, signalStrength: 95, reliability: 99,
    security: { level: 'HIGH', requiresAuth: true, password: 'kiroshi-blue', allowPassword: true, allowSkillCheck: true, authLogic: 'all',
      bypassSkills: ['Interface', 'Electronics/Security Tech'], bypassDC: 15, bypassSkillDCs: { Interface: 15, 'Electronics/Security Tech': 17 },
      allowKeyItem: true, keyItemName: 'Corporate ID', keyItemTag: 'arasaka_id', keyItemImg: 'icons/id.webp', keyItemConsume: true,
      maxAttempts: 4, lockoutDuration: 45 * 60000, encryptionType: 'BLACK_ICE', failureMode: 'damage',
      ice: { source: 'custom', actorId: null, customName: 'HELLHOUND', customPortrait: 'icons/hh.webp', customDamage: '4d6+2' } },
    effects: { messageDelay: 120, traced: true, anonymity: false, canRoute: true, restrictedAccess: true, allowedRecipientNetworks: ['CORPNET', 'CITINET'] },
    theme: { color: '#4488ff', icon: 'fa-building', iconMode: 'image', customImage: 'icons/corp.svg', glitchIntensity: 0.35 },
    description: 'Corporate communications', lore: 'Lobby layer only.', group: 'Arasaka' },
  { id: 'DARKNET', name: 'DarkNet', type: 'UNDERGROUND', isCore: true, availability: { global: false, scenes: [] }, signalStrength: 50, reliability: 70, security: { requiresAuth: false }, effects: { messageDelay: 500, anonymity: true, canRoute: true, allowedRecipientNetworks: [] }, theme: { color: '#00ff41', icon: 'fa-mask' } },
  { id: 'net_after', name: 'Afterlife mesh', type: 'CUSTOM', isCore: false, availability: { global: false, scenes: [] }, signalStrength: 64, reliability: 75, security: { requiresAuth: true, allowPassword: true, password: 'x' }, effects: { canRoute: false, allowedRecipientNetworks: [] }, theme: { color: '#c76bff', icon: 'fa-skull' }, group: '' },
];
const calls = [];
const networkService = {
  getAllNetworks: () => NETS,
  getNetwork: (id) => NETS.find((n) => n.id === id) || null,
  getAvailableNetworks: () => NETS.filter((n) => n.availability.global),
  async createNetwork(d) { calls.push(['create', clone(d)]); const n = { ...clone(d), id: 'net_new', isCore: false }; NETS.push(n); return { success: true, network: n }; },
  async updateNetwork(id, d) { calls.push(['update', id, clone(d)]); const i = NETS.findIndex((n) => n.id === id); NETS[i] = merge(NETS[i], d); return { success: true }; },
  async deleteNetwork(id) { calls.push(['delete', id]); return { success: true }; },
  async setSceneNetworkAvailability(sceneId, patch) { calls.push(['avail', sceneId, clone(patch)]); const s = scenes.find((x) => x.id === sceneId); s.flags[MODULE_ID].networkAvailability = { ...(s.flags[MODULE_ID].networkAvailability || {}), ...patch }; },
  async setSceneDefaultNetwork(sceneId, id) { calls.push(['default', sceneId, id]); scenes.find((x) => x.id === sceneId).flags[MODULE_ID].defaultNetwork = id; },
  async toggleDeadZone(sceneId, dead) { calls.push(['dead', sceneId, dead]); scenes.find((x) => x.id === sceneId).flags[MODULE_ID].deadZone = dead; },
  revokeAuth: (id) => calls.push(['revoke', id]),
};
const logEntries = [
  { id: 'L1', type: 'auth_success', networkId: 'CORPNET', networkName: 'CorpNet', actorName: 'Rache', message: 'Interface 19 vs 15', timestamp: '2045-08-14T22:05:00Z' },
  { id: 'L2', type: 'lockout', networkId: 'net_after', actorName: 'Kiri', timestamp: '2045-08-14T21:31:00Z' },
  { id: 'L3', type: 'manual', manual: true, networkId: 'CORPNET', actorName: 'GM', message: 'a note', timestamp: '2045-08-14T21:00:00Z' },
  { id: 'L4', type: 'system', networkId: 'all', networkName: 'ALL NETWORKS', actorName: 'SYSTEM', message: 'Broadcast: curfew', timestamp: '2045-08-14T20:47:00Z' },
];
const accessLogService = {
  get entryCount() { return logEntries.length; }, _entries: logEntries,
  getEntries: ({ networkId, limit = 50 } = {}) => logEntries.filter((e) => !networkId || e.networkId === networkId).slice(0, limit),
  addManualEntry: (e) => { calls.push(['logAdd', clone(e)]); logEntries.unshift({ id: 'Lx', manual: true, ...e }); },
  deleteEntry: (id) => (calls.push(['logDel', id]), true), clearLog: () => calls.push(['logClear']),
};
const users = [
  { id: 'U1', name: 'Sam', isGM: false, active: true, character: { name: 'V', img: 'v.png' }, viewedScene: 'S1', color: '#b85c7a' },
  { id: 'U2', name: 'Ana', isGM: false, active: true, character: { name: 'Jo', img: '' }, viewedScene: 'S2', color: '#b8995c' },
  { id: 'G1', name: 'GM', isGM: true, active: true, character: null },
];
users.filter = Array.prototype.filter.bind(users);
users.get = (id) => users.find((u) => u.id === id);
globalThis.game = {
  user: users[2], users, actors: { filter: () => [{ id: 'A1', name: 'Hellhound Black ICE', system: { stats: { atk: 6 } } }], get: () => null },
  items: { contents: [] },
  scenes: { contents: scenes, get: (id) => scenes.find((s) => s.id === id), viewed: scenes[0] },
  nightcity: { playerNetworks: new Map([['U1', { networkId: 'CORPNET' }], ['U2', { networkId: 'net_after' }]]), securityService: { getActiveLockouts: () => [{ actorId: 'A9', targetId: 'net_after' }], resetState: (a, t) => calls.push(['resetState', a, t]), resetAllForTarget: (t) => calls.push(['resetAll', t]) } },
  settings: { get: () => false },
  folders: { filter: (fn) => [{ id: 'F-Arasaka', name: 'Arasaka', type: 'Scene', folder: null, sort: 0 }, { id: 'F-Other', name: 'Other', type: 'Item', folder: null, sort: 0 }].filter(fn) },
};
globalThis.canvas = { scene: scenes[0] };

const E = await imp('scripts/ui/AdminPanel/tabs/NetworksEditor.js');
const { NetworksTab } = await imp('scripts/ui/AdminPanel/tabs/NetworksTab.js');
const { ScopePicker } = await imp('scripts/utils/scopePicker.js');

let renders = 0;
const app = { id: 'ncm-admin-panel', _activeTab: 'networks', element: null, isPopout: false, render() { renders++; }, constructor: {},
  get networkService() { return networkService; }, get accessLogService() { return accessLogService; } };
const tab = new NetworksTab(app);

// ═══ 1. Pure editor rules ═══
ok(E.NET2_STEPS.map((s) => s.key).join() === 'identity,signal,access,behaviour,where,look', 'six steps in the mock order');
const blank = E.blankNetwork();
ok(blank.effects.canRoute === true && blank.security.failureMode === 'lockout' && blank.theme.iconMode === 'fa', 'blank network = NetworkService defaults');
const pre = E.applyPreset({ ...E.draftFrom(null), name: 'Typed name' }, 'corporate');
ok(pre.name === 'Typed name' && pre.type === 'CORPORATE' && pre.effects.traced === true && pre.security.requiresAuth === true, 'a preset fills the draft but keeps the typed name');
ok(Object.keys(E.NET2_PRESETS).includes('blank') && Object.keys(E.NET2_PRESETS).length >= 6, 'Start from: blank + type presets');
const wp = E.wherePatches({ id: 'X', name: 'Xnet', availability: { scenes: ['S9'] } }, ['S1', 'S9'], [
  { id: 'S1', avail: {} }, { id: 'S2', avail: { X: true } }, { id: 'S3', avail: { Xnet: true } }, { id: 'S9', avail: {} }]);
ok(JSON.stringify(wp) === JSON.stringify([{ sceneId: 'S1', patch: { X: true } }, { sceneId: 'S2', patch: { X: false } }, { sceneId: 'S3', patch: { X: false, Xnet: false } }]),
  'wherePatches: adds, removes, clears a legacy name key, leaves the legacy availability.scenes entry alone');

// ═══ 2. The tab: views build ═══
ok(tab.prepareContext().net2 && tab.prepareContext().networks.length === 4, 'prepareContext keeps networks + adds net2');
ok(tab.prepareContext().netStats.total === 4 && 'sceneStrip' in tab.prepareContext(), 'netStats + sceneStrip survive for the panel / footer / Overview');
app._activeTab = 'overview'; ok(!tab.prepareContext().net2, 'the heavy context only builds while Networks is the active tab'); app._activeTab = 'networks';

let c = tab.prepareContext().net2;
ok(c.isScene && c.nav.length === 4 && c.nav.find((n) => n.key === 'all').count === 4, 'This scene is the default view; four sub-tabs with counts');
const sc = c.scene;
ok(sc.rows.map((r) => r.id).join() === 'CITINET,CORPNET,DARKNET', 'This scene lists ONLY global + this scene’s networks (DarkNet listed but switched off)');
ok(sc.rows.find((r) => r.id === 'DARKNET').on === false && sc.rows.find((r) => r.id === 'CORPNET').isDefault, 'off state + default chip');
ok(sc.rows.find((r) => r.id === 'CORPNET').players.map((p) => p.name).join() === 'V', 'players show on the network they reported');
ok(sc.elsewhere.length === 1 && sc.elsewhere[0].name === 'Jo' && /Afterlife/.test(sc.elsewhere[0].networkName), 'a player on a network this scene can’t reach is listed at the bottom');
ok(/data-scope-btn/.test(sc.scenePicker) && /data-scope-btn/.test(sc.bcastPicker) && /data-scope-btn/.test(sc.herePicker), 'scene, broadcast and here pickers are the shared scope picker');
ok(sc.defaultOptions.some((o) => o.id === 'CORPNET' && o.on), 'players-start-on select shows the scene default');

tab._sceneId = 'S3';
c = tab.prepareContext().net2;
ok(c.scene.jam && c.scene.rows.every((r) => r.signal === 0 && !r.live), 'a dead-zone scene shows every network dead');
tab._sceneId = null;

await tab.onAct('view', {}, { dataset: { view: 'all' } });
c = tab.prepareContext().net2;
ok(c.isAll && c.all.groups.length >= 3 && c.all.det, 'All networks: grouped list + a detail');
ok(c.all.det.id === 'CITINET' || c.all.det.id === c.all.groups[0].list[0].id, 'first row auto-selects');
await tab.onAct('select', {}, { dataset: { networkId: 'CORPNET' } });
c = tab.prepareContext().net2;
const det = c.all.det;
ok(det.ways.map((w) => w.label + (w.m ? ' ' + w.m : '')).join('|') === 'Password|Interface DV 15|Electronics/Security Tech DV 17|Corporate ID used up', 'detail: every way in, per-skill DVs included');
ok(/All of these/.test(det.waysNote) && /4 attempts/.test(det.waysNote) && /Black ICE bites/.test(det.waysNote), 'detail: logic, attempts, failure');
ok(det.tags.some((t) => /traced/.test(t.label)) && det.tags.some((t) => /Delayed|delayed/.test(t.label)) && det.tags.some((t) => /readable here/.test(t.label)), 'detail: behaviour tags incl. delay + restricted');
ok(det.scenes.map((s) => s.id).join() === 'S1' && det.users.length === 1 && det.recent.length === 2, 'detail: where, who, recent activity');
await tab.onAct('netFilter', {}, { dataset: { filter: 'sec' } });
ok(tab.prepareContext().net2.all.groups.flatMap((g) => g.list).every((r) => ['CORPNET', 'net_after'].includes(r.id)), 'filter chip: Secured');
await tab.onAct('netFilter', {}, { dataset: { filter: 'nowhere' } });
ok(tab.prepareContext().net2.all.groups.flatMap((g) => g.list).map((r) => r.id).join() === 'DARKNET', 'filter chip: On no scene');
await tab.onAct('netFilter', {}, { dataset: { filter: 'all' } });
tab._search = 'after';
ok(tab.prepareContext().net2.all.groups.flatMap((g) => g.list).map((r) => r.id).join() === 'net_after', 'search filters the list');
tab._search = '';

await tab.onAct('view', {}, { dataset: { view: 'scenes' } });
c = tab.prepareContext().net2;
const cardIds = (sc) => [...(sc.nav ? sc.nav.cards : []), ...sc.shelves.flatMap((x) => x.cards)].map((x) => x.id);
ok(c.isScenes && cardIds(c.scenes).includes('S4') && c.scenes.canHide && c.scenes.hideable === 1, 'Scenes: every scene shows by default (like Foundry\'s Scenes tab), imported ones included');
ok(c.scenes.shelves.map((x) => x.key).join() === 'F-Arasaka,__unfiled__' && c.scenes.shelves[0].name === 'Arasaka', 'Atlas: shelves are the GM\'s scene folders (Item folders ignored), unfiled last');
ok(!c.scenes.shelves[0].shut && c.scenes.shelves[1].shut, 'Atlas: the viewed scene\'s folder starts open, the rest closed');
{ const s1 = c.scenes.shelves[0].cards[0];
  ok(s1.id === 'S1' && s1.cur && s1.dots.map((d) => d.id).join() === 'CORPNET' && s1.start?.name === 'CorpNet' && s1.faces.length === 1, 'Atlas card: coverage dots in network colours, the start flag, the player looking at it'); }
ok(c.scenes.shelves[1].unwired === 1 && c.scenes.shelves[1].dead === 1, 'Atlas shelf head: dead / not-wired counts (the imported scene counts as not wired)');
ok(c.scenes.transmitters.at(-1).id === 'CITINET' && c.scenes.transmitters.at(-1).global && !c.scenes.transmitters[0].global && c.scenes.transmitters.find((t) => t.id === 'CORPNET').n === 1, 'Paint strip: paintable networks first, globals last (not paintable), every network with its coverage');
await tab.onAct('hideImported', {}, { dataset: {} });
ok(!cardIds(tab.prepareContext().net2.scenes).includes('S4'), 'the eye hides imported scenes you have not set up');
await tab.onAct('hideImported', {}, { dataset: {} });
ok(cardIds(tab.prepareContext().net2.scenes).includes('S4'), '…and brings them back');
tab._scShow = 'dead';
c = tab.prepareContext().net2;
ok(cardIds(c.scenes).join() === 'S3' && c.scenes.show.find((x) => x.key === 'dead').count === 1 && c.scenes.narrowed, 'Show: Dead zones (counts on the option, "Showing N of M")');
ok(c.scenes.shelves.every((x) => !x.shut), 'a filter opens every shelf');
tab._scShow = 'all';
tab._sceneSearch = 'arasaka';
ok(cardIds(tab.prepareContext().net2.scenes).join() === 'S1', 'search matches the scene name or its folder');
tab._sceneSearch = '';
// Paint: a transmitter, then cards are toggles; a global network cannot be painted
await tab.onAct('scPaint', {}, { dataset: { networkId: 'CITINET' } });
ok(!tab._scPaint && notes.some((n) => /reaches every scene/.test(n[1])), 'painting a global network is refused with a reason');
await tab.onAct('scPaint', {}, { dataset: { networkId: 'DARKNET' } });
ok(tab._scPaint === 'DARKNET' && tab.prepareContext().net2.scenes.painting.name === 'DarkNet', 'a transmitter click starts painting');
calls.length = 0;
await tab.onAct('scCard', {}, { dataset: { sceneId: 'S2' } });
ok(JSON.stringify(calls[0]) === JSON.stringify(['avail', 'S2', { DARKNET: true }]), 'painting: a card click wires the painted network');
c = tab.prepareContext().net2;
ok(c.scenes.shelves[1].cards.find((x) => x.id === 'S2').has && !c.scenes.sel, 'the wired card is marked; no inspector while painting');
ok(c.scenes.shelves[1].paintAll?.label === 'Wire all (1)', 'Wire all counts only the live scenes missing it (S4; S3 is a dead zone)');
calls.length = 0;
await tab.onAct('scShelfPaint', {}, { dataset: { key: '__unfiled__' } });
ok(calls.length === 1 && JSON.stringify(calls[0]) === JSON.stringify(['avail', 'S4', { DARKNET: true }]), 'Wire all gives it to the rest of the shelf, dead zones untouched');
ok(tab.prepareContext().net2.scenes.shelves[1].paintAll?.label === 'Unwire all (2)', '…then the same button offers to take it off again');
calls.length = 0;
await tab.onAct('scShelfPaint', {}, { dataset: { key: '__unfiled__' } });
ok(calls.map((x) => x[1]).join() === 'S4,S2' && calls.every((x) => x[2].DARKNET === false), 'Unwire all takes it off every live scene on the shelf');
await tab.onAct('scPaint', {}, { dataset: { networkId: 'DARKNET' } });
ok(!tab._scPaint, 'clicking the lit transmitter stops painting');
// the inspector carries every control the old row had
await tab.onAct('scCard', {}, { dataset: { sceneId: 'S1' } });
{ const sel = tab.prepareContext().net2.scenes.sel;
  ok(sel && sel.id === 'S1' && /data-scope-btn/.test(sel.picker) && sel.nets.map((n) => n.id).join() === 'CORPNET' && sel.startOptions.some((o) => o.on && o.id === 'CORPNET') && sel.where === 'Arasaka', 'inspector: networks + Add picker, Players start on, the folder it sits in'); }
await tab.onAct('scCard', {}, { dataset: { sceneId: 'S1' } });
ok(!tab._scSel, 'clicking the picked card again closes the inspector');
// Grid
await tab.onAct('scMode', {}, { dataset: { mode: 'grid' } });
{ const g = tab.prepareContext().net2.scenes.grid;
  const r1 = g.bands.flatMap((b) => b.rows).find((r) => r.id === 'S1');
  ok(g.cols[0].global && r1.cells.find((x) => x.id === 'CORPNET').on && r1.cells.find((x) => x.id === 'CITINET').global, 'Grid: scenes × networks, globals first and not editable');
  ok(g.bands[0].tallies.find((t) => t.id === 'CORPNET').full && g.bands[0].tallies.find((t) => t.id === 'CORPNET').bandKey === 'F-Arasaka', 'Grid band tally: n/m per network, full when every live scene has it'); }
tab._scShut.delete('__unfiled__'); tab._scOpen.add('__unfiled__');
tab.prepareContext();
calls.length = 0; tab._scLast = null;
await tab.onAct('scCell', {}, { dataset: { sceneId: 'S1', networkId: 'net_after' } });
await tab.onAct('scCell', { shiftKey: true }, { dataset: { sceneId: 'S2', networkId: 'net_after' } });
ok(calls.filter((x) => x[0] === 'avail').map((x) => x[1] + ':' + x[2].net_after).join() === 'S1:true,S1:false,S2:false' && JSON.stringify(tab._scGridOrder) === JSON.stringify(['S1', 'S3', 'S4', 'S2']), 'Grid: shift-click applies the CLICKED cell’s new state (off — S2 had it) over the range in display order, skipping rows already off');
await tab.onAct('scMode', {}, { dataset: { mode: 'atlas' } });
calls.length = 0;
await tab.onAct('sceneRm', {}, { dataset: { sceneId: 'S1', networkId: 'CORPNET' } });
ok(JSON.stringify(calls[0]) === JSON.stringify(['avail', 'S1', { CORPNET: false }]), '✕ on a scene row takes the network off (NetworkService.setSceneNetworkAvailability)');
await tab._setSceneNets(scenes[0], ['CORPNET', 'net_after']);
ok(scenes[0].flags[MODULE_ID].networkAvailability.CORPNET === true && scenes[0].flags[MODULE_ID].networkAvailability.net_after === true, 'the row picker sets exactly the picked networks');
await tab.onAct('sceneDead', {}, { dataset: { sceneId: 'S2' } });
ok(calls.some((x) => x[0] === 'dead' && x[1] === 'S2' && x[2] === true), 'dead-zone switch → NetworkService.toggleDeadZone');
await tab.onAct('sceneDead', {}, { dataset: { sceneId: 'S2' } });

await tab.onAct('view', {}, { dataset: { view: 'log' } });
c = tab.prepareContext().net2;
ok(c.isLog && c.log.rows.length === 4 && c.log.lockouts.length === 1, 'Activity log: every entry + active lockouts');
ScopePicker.set(tab.scopeId('netlog'), ['CORPNET']);
ok(tab.prepareContext().net2.log.rows.every((r) => r.networkId === 'CORPNET') && tab.prepareContext().net2.log.rows.length === 2, 'network filter (scope picker, multi)');
await tab.onAct('logKind', {}, { dataset: { kind: 'manual' } });
ok(tab.prepareContext().net2.log.rows.length === 1 && tab.prepareContext().net2.log.filtered, 'kind chip: Notes');
await tab.onAct('logClearFilters', {}, { dataset: {} });
await tab.onAct('logNet', {}, { dataset: { networkId: 'net_after' } });
ok(ScopePicker.value(tab.scopeId('netlog')).join() === 'net_after', 'clicking a network name on a row filters to it');
await tab.onAct('logClearFilters', {}, { dataset: {} });
const netItems = tab.prepareContext().net2.log.netPicker;
ok(/All networks \(broadcast\)/.test(netItems) || ScopePicker.isOpen(tab.scopeId('netlog')) === false, 'the log picker lists non-network ids (a broadcast) too');
await tab.onAct('resetLockout', {}, { dataset: { actorId: 'A9', targetId: 'net_after' } });
ok(calls.some((x) => x[0] === 'resetState' && x[1] === 'A9'), 'lift one lockout');

// ═══ 3. openTo grammar ═══
tab.openTo('view:scenes'); ok(tab._view === 'scenes', "openTo('view:scenes')");
tab.openTo('show:DARKNET'); ok(tab._view === 'all' && tab._selId === 'DARKNET' && !tab._edit, "openTo('show:<id>')");
tab.openTo('log:CORPNET'); ok(tab._view === 'log' && ScopePicker.value(tab.scopeId('netlog')).join() === 'CORPNET', "openTo('log:<id>')");
tab.openTo('new'); ok(tab._view === 'all' && tab._edit && tab._isNew, "openTo('new')");
tab.openTo('CORPNET'); ok(tab._view === 'all' && tab._edit && !tab._isNew && tab._selId === 'CORPNET', "openTo('<id>') edits that network");

// ═══ 4. REAL render + the editor round trip ═══
let Handlebars = null;
for (const p of ['C:/Program Files/Foundry Virtual Tabletop/resources/app/package.json', 'C:/Program Files (x86)/Foundry Virtual Tabletop/resources/app/package.json']) {
  if (!fs.existsSync(p)) continue;
  try { Handlebars = createRequire(p)('handlebars'); break; } catch { /* keep looking */ }
}
const tpl = read('templates/admin-panel/tab-networks.hbs');
if (!Handlebars) { fail++; console.error('FAIL: could not load Handlebars from a Foundry install — render checks did not run'); }
else {
  const H = Handlebars;
  { const { registerTagHueHelper } = await import(new URL('../../../scripts/utils/tagHue.js', import.meta.url)); registerTagHueHelper(H); }
  H.registerHelper('eq', (a, b) => String(a) === String(b));
  H.registerHelper('gt', (a, b) => a > b);
  H.registerHelper('lower', (s) => String(s ?? '').toLowerCase());
  // The Access step includes the shared countermeasure-override partial.
  H.registerPartial('modules/night-city-messenger/templates/partials/countermeasure-override.hbs', read('templates/partials/countermeasure-override.hbs'));
  const render = H.compile(tpl);
  const renderView = (view, setup) => { tab._view = view; setup?.(); return render({ activeTab: 'networks', ...tab.prepareContext() }); };

  // the editor, filled from CorpNet
  tab.openTo('CORPNET');
  const html = renderView('all');
  ok(/data-edit-session="\d+"/.test(html) && html.includes('data-cmv-ovr') && tpl.includes('partials/countermeasure-override.hbs'), 'editor renders the shared countermeasure override');
  ok(tpl.indexOf('countermeasure-override.hbs') > tpl.indexOf('data-step-sec="access"') && tpl.indexOf('countermeasure-override.hbs') < tpl.indexOf('data-step-sec="behaviour"'), 'the override sits in the Access step');
  for (const s of E.NET2_STEPS) ok(html.includes(`data-step-sec="${s.key}"`), `step section rendered: ${s.key}`);
  for (const f of E.NET2_FIELDS) ok(new RegExp(`name="${f}"`).test(html), `the editor has a control for "${f}"`);

  // Build a fake form from the rendered HTML: inputs, selects (selected option), textareas, checkboxes, the bypass rows, the where scenes.
  const formHtml = html.slice(html.indexOf('class="ncm-net2-form"'), html.indexOf('class="ncm-net2-foot"'));
  const attr = (tag, a) => { const m = tag.match(new RegExp(`\\s${a}="([^"]*)"`)); return m ? m[1].replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x3D;/g, '=') : null; };
  const fields = {};
  for (const m of formHtml.matchAll(/<input\b[^>]*>/g)) {
    const t = m[0], n = attr(t, 'name'); if (!n) continue;
    fields[n] = { value: attr(t, 'value') ?? '', checked: /\schecked\b/.test(t) };
  }
  for (const m of formHtml.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)) {
    const n = attr(m[1], 'name'); if (!n) continue;
    const sel = [...m[2].matchAll(/<option value="([^"]*)"\s*(selected)?/g)];
    fields[n] = { value: (sel.find((o) => o[2]) || sel[0] || [])[1] ?? '' };
  }
  for (const m of formHtml.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/g)) fields[attr(m[1], 'name')] = { value: m[2] };
  const bypassRows = [...formHtml.matchAll(/data-bypass-row>([\s\S]*?)<\/div>/g)].map((m) => ({
    skill: (m[1].match(/<option value="([^"]*)" selected/) || [])[1], dv: (m[1].match(/class="ncm-bypass__dv[^"]*" value="(\d+)"/) || [])[1] }));
  const where = [...formHtml.matchAll(/<input type="checkbox" data-where-scene="([^"]+)"\s*(checked)?/g)].map((m) => ({ id: m[1], checked: !!m[2] }));
  const rowEl = (r) => ({ querySelector: (q) => (q === '.ncm-bypass__skill' ? { value: r.skill } : q === '.ncm-bypass__dv' ? { value: r.dv } : null) });
  const box = { matches: () => true, querySelectorAll: () => bypassRows.map(rowEl) };
  const fakeForm = {
    querySelector: (q) => { if (q === '[data-bypass-rows]') return box; const n = (q.match(/\[name="([^"]+)"\]/) || [])[1]; return n && fields[n] ? fields[n] : null; },
    querySelectorAll: (q) => (q === '[data-where-scene]' ? where.map((w) => ({ checked: w.checked, dataset: { whereScene: w.id } })) : []),
  };
  const back = E.readEditorForm(fakeForm, { recipients: ScopePicker.value(tab.scopeId('recip')) });
  const orig = NETS.find((n) => n.id === 'CORPNET');
  const same = (a, b, label) => ok(JSON.stringify(a) === JSON.stringify(b), `round trip: ${label} (${JSON.stringify(a)} vs ${JSON.stringify(b)})`);
  same(back.name, orig.name, 'name'); same(back.type, orig.type, 'type'); same(back.description, orig.description, 'description');
  same(back.lore, orig.lore, 'GM notes (lore)'); same(back.group, orig.group, 'folder (group)');
  same([back.signalStrength, back.reliability, back.effects.messageDelay], [95, 99, 120], 'signal / reliability / delay');
  for (const k of ['level', 'requiresAuth', 'password', 'allowPassword', 'allowSkillCheck', 'authLogic', 'allowKeyItem', 'keyItemName', 'keyItemTag', 'keyItemImg', 'keyItemConsume', 'maxAttempts', 'lockoutDuration', 'encryptionType', 'failureMode'])
    same(back.security[k], orig.security[k], `security.${k}`);
  same(back.security.bypassSkills, orig.security.bypassSkills, 'bypass skills');
  same(back.security.bypassSkillDCs, orig.security.bypassSkillDCs, 'per-skill bypass DVs');
  same(back.security.ice, orig.security.ice, 'ICE source / name / damage / portrait');
  for (const k of ['traced', 'anonymity', 'canRoute', 'restrictedAccess']) same(back.effects[k], orig.effects[k], `effects.${k}`);
  same(back.effects.allowedRecipientNetworks, orig.effects.allowedRecipientNetworks, 'allowed recipient networks');
  same(back.availability.global, false, 'everywhere (global)');
  same(back.where, ['S1'], 'Where: the scenes it is on');
  for (const k of ['color', 'icon', 'iconMode', 'customImage', 'glitchIntensity']) same(back.theme[k], orig.theme[k], `theme.${k}`);

  // ── the save path ──
  calls.length = 0;
  tab._editSession; // the form the sim "mounted"
  const fakeEl = { querySelector: (q) => (q.startsWith('.ncm-net2-form') ? fakeForm : null), querySelectorAll: () => [], contains: () => false };
  app.element = fakeEl;
  where.find((w) => w.id === 'S2').checked = true; // put it on the Afterlife too
  fields.signalStrength.value = '0';                 // 0 must survive (the old editor turned it into 75)
  await tab.onAct('save', {}, { dataset: {} });
  const up = calls.find((x) => x[0] === 'update');
  ok(up && up[1] === 'CORPNET' && up[2].signalStrength === 0 && !('where' in up[2]), 'Save → NetworkService.updateNetwork (signal 0 kept, where stripped)');
  ok(calls.some((x) => x[0] === 'avail' && x[1] === 'S2' && x[2].CORPNET === true), 'Save → Where writes the scene’s availability flag');
  ok(!tab._edit, 'saving leaves edit mode');

  // ── New network ──
  calls.length = 0;
  tab.openTo('new');
  app.element = null;
  const nh = renderView('all');
  ok(/Start from/.test(nh) && /data-op="preset"/.test(nh) && /Create network/.test(nh), 'New network: the same editor with Start from + Create');
  app.element = fakeEl;
  fields.name.value = '';
  await tab.onAct('save', {}, { dataset: {} });
  ok(!calls.some((x) => x[0] === 'create') && notes.some((n) => /needs a name/.test(n[1])), 'a nameless network is refused');
  fields.name.value = 'Militech Staging';
  await tab.onAct('save', {}, { dataset: {} });
  ok(calls.some((x) => x[0] === 'create' && x[1].name === 'Militech Staging'), 'Create → NetworkService.createNetwork');
  ok(calls.some((x) => x[0] === 'avail' && x[2].net_new !== undefined), 'the new network’s Where uses its new id');
  app.element = null;

  // ── draft survives a re-render ──
  tab.openTo('CORPNET');
  const sess = tab._editSession;
  fields.name.value = 'CorpNet (edited)';
  app.element = { querySelector: (q) => (q === `.ncm-net2-form[data-edit-session="${sess}"]` ? fakeForm : null), querySelectorAll: () => [], contains: () => false };
  tab.prepareContext();
  ok(tab._draft?.name === 'CorpNet (edited)', 'an unrelated re-render keeps what the GM typed (draft read from the mounted form)');
  app.element = null;
  tab._edit = false; tab._draft = null;

  // ── every view renders, no "undefined" leaks ──
  for (const v of ['scene', 'all', 'scenes', 'log']) {
    const h = renderView(v);
    ok(h.includes('class="ncm-net2 ') && !/undefined|\[object Object\]/.test(h), `view "${v}" renders cleanly`);
  }
  const popHtml = (() => { app.isPopout = true; const h = renderView('all'); app.isPopout = false; return h; })();
  ok(!popHtml.includes('data-action="popOutTab"') && popHtml.includes('is-pop'), 'pop-out: no Pop out button inside the pop-out');
}

// ═══ 5. Wiring guards ═══
const js = read('scripts/ui/AdminPanel/tabs/NetworksTab.js');
const ops = new Set([...tpl.matchAll(/data-op="([a-zA-Z]+)"/g)].map((m) => m[1]));
ok(ops.size >= 30, `found the template's ops (${ops.size})`);
for (const op of ops) ok(new RegExp(`case '${op}'`).test(js), `onAct handles "${op}"`);
ok(!/data-action="(?!tabAct|popOutTab)/.test(tpl), 'every button is tabAct (or the shared popOutTab) — no new static delegators');
ok(/data-owner="networks"/.test(tpl), 'the tab root names its owner');
const css = read('styles/components/admin-panel/tab-networks.css');
const used = new Set([...(tpl + js).matchAll(/ncm-net2-[a-z0-9_-]+/g)].map((m) => m[0]).filter((x) => !x.endsWith('-') && !/ncm-net2-groups-/.test(x) && !/ncm-net2-(auth|tone)--$/.test(x)));
for (const k of used) {
  if (/^ncm-net2-(auth|tone)--/.test(k) && !/--[a-z]+$/.test(k)) continue;
  ok(css.includes(`.${k}`), `.${k} is styled`);
}
for (const t of ['open', 'sec', 'ice']) ok(css.includes(`.ncm-net2-auth--${t}`), `access badge .ncm-net2-auth--${t}`);
for (const t of ['ok', 'bad', 'warn', 'info', 'note', 'muted']) ok(css.includes(`.ncm-net2-tone--${t}`), `tone .ncm-net2-tone--${t}`);
const lit = (css.replace(/\/\*[\s\S]*?\*\//g, '').match(/#[0-9a-fA-F]{3,6}\b/g) || []);
ok(lit.length === 0, `tab CSS carries no literal colour (${lit.join(',')})`);
ok(/\.ncm-net2 \[hidden\] \{ display: none !important; \}/.test(css), '[hidden] beats the author display rules');
ok(/\.ncm-admin-panel--pop \.ncm-net2-split/.test(css), 'the pop-out widens the split');
ok(!/ncm-term-admin-btn/.test(tpl), 'no borrowed button classes from another tab');

// prefix is free elsewhere (class-collision rule)
// admin-hierarchy.css (the shared colour hierarchy) deliberately names every tab's list/detail/row classes.
const otherCss = fs.readdirSync(`${ROOT}/styles/components`, { recursive: true }).filter((f) => String(f).endsWith('.css') && !String(f).endsWith('tab-networks.css') && !String(f).endsWith('admin-hierarchy.css'));
ok(!otherCss.some((f) => read(`styles/components/${f}`.replace(/\\/g, '/')).includes('.ncm-net2-')), 'no other stylesheet uses the ncm-net2- prefix');

// the openers + retirement
const reg = read('scripts/init/registerNetworkSystem.js');
ok(/openAdminTab\?\.\('networks', \{ popout: true, select \}\)/.test(reg), 'launchers open the tab popped out');
for (const fn of ['openNetworkManagement', 'openNetworkManager', 'openNetworkManagerToNetwork', 'openNetworkManagerToLogs', 'openNetworkManagerToCreate']) ok(reg.includes(`ns.${fn} =`), `ns.${fn} still exists`);
ok(reg.includes("openNetworksTab('view:log')") && reg.includes("openNetworksTab('new')"), 'logs / create launchers pick their view');
ok(read('scripts/ui/NetworkManagement/CreateNetworkDialog.js').includes("select: `show:${networkId}`"), 'Quick Create opens the tab on the new network');
ok(!exists('scripts/ui/NetworkManagement/NetworkManagementApp.js') && !exists('templates/network-management/network-management.hbs'), 'the standalone app + template are gone');
ok(!exists('styles/components/network-management.css') && !exists('styles/components/activity-log.css') && !exists('templates/admin-panel/partials/network-card.hbs'), 'its stylesheet, the old log stylesheet and the old card partial are gone');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]));
const strays = [...walk(`${ROOT}/scripts`), ...walk(`${ROOT}/templates`), ...walk(`${ROOT}/styles`)]
  .filter((f) => /\.(js|hbs|css)$/.test(f) && /NetworkManagementApp|NETWORK_MANAGEMENT\b|ADMIN_NETWORK_CARD|network-management\.(hbs|css)|activity-log\.css|ncm-netmgr__|ncm-actlog__/.test(fs.readFileSync(f, 'utf8')));
ok(strays.length === 0, `nothing references the retired files (${strays.map((f) => f.replace(ROOT + '/', '')).join(', ') || 'none'})`);
const apx = read('scripts/ui/AdminPanel/AdminPanelApp.js');
ok(/openNetworkManager: AdminPanelApp\._onOpenNetworkManager/.test(apx) && /createNetwork: AdminPanelApp\._onCreateNetwork/.test(apx), 'Overview button + keyboard N still route to the tab');
ok(!/sendBroadcast: AdminPanelApp|toggleSceneDeadZone: AdminPanelApp|clearNetworkLogs: AdminPanelApp/.test(apx), 'the retired network delegators are gone from the panel');
ok(/\.\.\.networkContext/.test(apx), 'the panel SPREADS the networks context');

console.log(`\ntest-admin-networks: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
