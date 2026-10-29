// Sim: network nodes, step 1 (2026-10-29, dev/design/NETWORK-NODES.md) — the pure rules in utils/networkNodes.js, the
// REAL NetworkService node API + the scene rule in getAvailableNetworks + the player relay + the jam reaper over a
// mocked world, the node dialog round-trip, and the admin wiring (setting, socket op, template ↔ ops, CSS).
//   node dev/tools/sims/test-network-nodes.mjs
import { pathToFileURL, fileURLToPath } from 'url';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createRequire } from 'module';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const read = (p) => readFileSync(`${ROOT}/${p}`, 'utf8').replace(/\r\n/g, '\n');
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.error('FAIL:', m)); };

const N = await imp('scripts/utils/networkNodes.js');
/** An instance of a class without running its constructor; own props shadow prototype getters. */
const mkThis = (Cls, props) => { const o = Object.create(Cls.prototype); for (const [k, v] of Object.entries(props)) Object.defineProperty(o, k, { value: v, writable: true, configurable: true }); return o; };

// ═══ 1. sanitize / state / scene rule ═══
{
  const n = N.sanitizeNode({ id: 'a', networkId: 'NET', kind: 'nope', state: 'weird', alert: 9, flavour: ['x', '', 5], log: [{ ts: 1, who: 'V', what: 'hi' }, null] });
  ok(n.kind === 'relay' && n.state === 'on', 'an unknown kind → relay, an unknown state → on');
  ok(n.alert === N.ALERT_LEVELS.length - 1, 'alert is clamped to the levels that exist');
  ok(n.flavour.join() === 'x' && n.log.length === 1, 'flavour lines and log entries are cleaned');
  ok(n.showTraffic === true && N.sanitizeNode({ showTraffic: false }).showTraffic === false, 'show traffic defaults on');
  ok(N.sanitizeNode(null).state === 'on', 'never throws on junk');

  const jam = { state: 'jammed', jammedUntil: 1000 };
  ok(N.nodeStateAt(jam, 500) === 'jammed' && N.nodeStateAt(jam, 1000) === 'on', 'a jam reads as on the moment its time runs out');
  ok(!N.nodeIsUp({ state: 'damaged' }) && !N.nodeIsUp({ state: 'off' }) && N.nodeIsUp({ state: 'on' }), 'only on is up');

  const all = {
    a: { id: 'a', networkId: 'NET', sceneId: 'S1', state: 'off' },
    b: { id: 'b', networkId: 'NET', sceneId: 'S1', state: 'on' },
    c: { id: 'c', networkId: 'NET', sceneId: 'S2', state: 'off' },
    d: { id: 'd', networkId: 'OTHER', sceneId: 'S2', state: 'jammed', jammedUntil: 50 },
  };
  ok(!N.sceneVerdict(all, 'NET', 'S1').cut && N.sceneVerdict(all, 'NET', 'S1').up === 1, 'one node up on a scene keeps the network there');
  ok(N.sceneVerdict(all, 'NET', 'S2').cut, 'every node on a scene down cuts the network there');
  ok(!N.sceneVerdict(all, 'NET', 'S3').hasNodes && !N.sceneVerdict(all, 'NET', 'S3').cut, 'a scene with no nodes is never cut (nodes are optional)');
  ok([...N.cutNetworks(all, 'S2', 10)].sort().join() === 'NET,OTHER' && [...N.cutNetworks(all, 'S2', 60)].join() === 'NET', 'cutNetworks follows the clock (the jam ran out)');
  ok([...N.carriedNetworks(all, 'S1')].join() === 'NET' && !N.carriedNetworks(all, 'S2', 10).size && [...N.carriedNetworks(all, 'S2', 60)].join() === 'OTHER', 'an up node carries its network onto its scene (a jam that ran out counts)');
  ok(N.expiredJams(all, 60).map((x) => x.id).join() === 'd' && !N.expiredJams(all, 10).length, 'expired jams are found for the reaper');

  const p = N.statePatch('jammed', { now: 1000, minutes: 30 });
  ok(p.state === 'jammed' && p.jammedUntil === 1000 + 30 * 60000, 'a jam patch carries its end on the game clock');
  ok(N.statePatch('off').jammedUntil === 0 && N.statePatch('nope') === null, 'other states clear the jam; an unknown state is refused');
  ok(N.stateLabel({ state: 'jammed', jammedUntil: 61 * 60000 }, 0) === 'Jammed · 1h 1m' && N.stateLabel({ state: 'off' }) === 'Off', 'state labels in words');
  ok(/^0x[0-9A-F]{4}·[0-9A-F]{2}$/.test(N.nodeHex('node_abc')) && N.nodeHex('x') === N.nodeHex('x'), 'a stable hex address per node');
  ok(N.nodeFirmware({ id: 'q', kind: 'router' }).startsWith('ROUTE-OS '), 'firmware flavour follows the kind');
  const lg = Array.from({ length: N.NODE_LOG_CAP + 5 }).reduce((l, _, i) => N.appendLog(l, { ts: i, who: 'V', what: 'x' }), []);
  ok(lg.length === N.NODE_LOG_CAP && lg.at(-1).ts === N.NODE_LOG_CAP + 4, 'the log is capped, newest kept');
}

// ═══ 2. The real NetworkService ═══
{
  const store = { networkNodes: {}, customNetworks: [], coreNetworkOverrides: {} };
  const emits = [], hooks = {}, toasts = [];
  let isGM = true;
  let now = 1_000_000;
  const scenes = new Map([['S1', { id: 'S1', name: 'Kabuki', getFlag: () => undefined }], ['S2', { id: 'S2', name: 'Docks', getFlag: () => undefined }]]);
  globalThis.game = {
    user: { get isGM() { return isGM; }, id: 'G', name: 'Player', character: { name: 'Rache' } },
    users: { activeGM: { id: 'G' } },
    settings: { get: (m, k) => store[k], set: async () => {} },
    scenes: { get: (id) => scenes.get(id), viewed: scenes.get('S1') },
    i18n: { localize: (s) => s },
    nightcity: { timeService: { getCurrentTimeMs: () => now } },
  };
  globalThis.ui = { notifications: { warn: (m) => toasts.push(['warn', m]), info: (m) => toasts.push(['info', m]) } };
  globalThis.Hooks = { on: (k, fn) => { (hooks[k] ||= []).push(fn); }, once() {}, callAll() {} };
  globalThis.foundry = { utils: { deepClone: (x) => JSON.parse(JSON.stringify(x)), mergeObject: (a, b) => ({ ...a, ...b }), randomID: () => 'r' } };
  const { NetworkService } = await imp('scripts/services/NetworkService.js');
  const { DEFAULTS } = await imp('scripts/utils/constants.js');
  const core = DEFAULTS.CORE_NETWORKS;
  const NET = core.find((n) => n.availability?.global)?.id || core[0].id;
  const svc = Object.create(NetworkService.prototype);
  Object.assign(svc, {
    settingsManager: { get: (k) => store[k], set: async (k, v) => { store[k] = v; } },
    socketManager: { emit: (op, d) => emits.push([op, d]) },
    eventBus: { emit() {} }, soundService: { play() {} },
    _networkCache: new Map(), _authenticatedNetworks: new Set(), _isDeadZone: false, _nodeDead: false, _preNodeCutNetworkId: null,
    _currentNetworkId: NET, _signalStrength: 75,
  });
  svc._buildNetworkCache();
  let switched = null;
  svc.switchNetwork = async (id) => { switched = id; svc._currentNetworkId = id; return { success: true }; };

  ok(svc.getAvailableNetworks().some((n) => n.id === NET), 'before any node, the network reaches the scene as it always did');
  const LOCAL = core.find((n) => !n.availability?.global)?.id;
  if (LOCAL) {
    ok(!svc.getAvailableNetworks().some((n) => n.id === LOCAL), '(a network not wired to this scene does not reach it)');
    const rl = await svc.saveNode({ networkId: LOCAL, sceneId: 'S1', name: 'Drop' });
    ok(svc.getAvailableNetworks().some((n) => n.id === LOCAL), 'an up node carries its network onto a scene it was never wired to');
    await svc.deleteNode(rl.node.id);
  }
  const r1 = await svc.saveNode({ networkId: NET, sceneId: 'S1', name: 'Mast', kind: 'mast' });
  ok(r1.success && r1.node.id.startsWith('node_') && store.networkNodes[r1.node.id].name === 'Mast', 'saveNode writes a sanitized node with a fresh id');
  ok((await svc.saveNode({ networkId: 'nope' })).success === false, 'a node for a network that does not exist is refused');
  const nid = r1.node.id;
  ok(svc.getNodes({ networkId: NET }).length === 1 && svc.getNode(nid).kind === 'mast', 'getNodes / getNode read it back');
  ok(svc.getAvailableNetworks().some((n) => n.id === NET), 'its node is on → still reaches');

  await svc.setNodeState(nid, 'off', { who: 'GM' });
  ok(store.networkNodes[nid].state === 'off' && store.networkNodes[nid].log.at(-1).what === 'switched off', 'switch off writes the state and a log line');
  ok(!svc.getAvailableNetworks().some((n) => n.id === NET), 'every node on the scene down → the network no longer reaches it');
  game.scenes.viewed = scenes.get('S2');
  ok(svc.getAvailableNetworks().some((n) => n.id === NET), '…but only on THAT scene (another scene is untouched)');
  game.scenes.viewed = scenes.get('S1');

  // this client is on NET when it gets cut: it moves to another network, then comes back
  svc._currentNetworkId = NET;
  svc._reevaluateNodes();   // the GM's own connection follows the scene too
  const others = svc.getAvailableNetworks();
  if (others.length) {
    ok(switched && switched !== NET && toasts.some(([, m]) => /signal lost/.test(m)), 'the client on the cut network is moved off it, with a "signal lost" toast');
    const sw1 = switched;
    isGM = false; svc._reevaluateNodes(); ok(switched === sw1, 'nothing changed → nothing happens (no repeat toast/switch every clock tick)'); isGM = true;
    await svc.setNodeState(nid, 'on');
    isGM = false; svc._reevaluateNodes(); isGM = true;
    ok(switched === NET && toasts.some(([, m]) => /is back/.test(m)), 'when the node comes back on, the client returns to it');
  } else ok(svc._nodeDead && svc._isDeadZone, 'with nothing else in reach, the client drops into the dead-zone path');

  // jam + reaper
  await svc.setNodeState(nid, 'jammed', { minutes: 10 });
  ok(store.networkNodes[nid].state === 'jammed' && store.networkNodes[nid].jammedUntil === now + 600000, 'a jam is stored with its end on the game clock');
  now += 11 * 60000;
  ok(svc.getAvailableNetworks().some((n) => n.id === NET), 'a jam that ran out reads as on at once');
  await svc.reapNodeJams();
  ok(store.networkNodes[nid].state === 'on' && /jam ended/.test(store.networkNodes[nid].log.at(-1).what), 'the GM reaper tidies the record');

  // player relay
  isGM = false;
  const before = JSON.stringify(store.networkNodes);
  const pr = await svc.setNodeState(nid, 'off');
  ok(pr.relayed && emits.at(-1)[0] === 'network:nodeRequest' && emits.at(-1)[1].nodeId === nid && emits.at(-1)[1].who === 'Rache', 'a player relays the change (named by their character)');
  ok(JSON.stringify(store.networkNodes) === before, 'a player never writes the setting');
  ok((await svc.saveNode({ networkId: NET })).success === false && (await svc.deleteNode(nid)).success === false, 'a player cannot create or delete nodes');
  game.users.activeGM = null;
  ok((await svc.setNodeState(nid, 'off')).success === false, 'with no GM connected the player is told nothing can change');
  game.users.activeGM = { id: 'G' };
  isGM = true;
  await svc.handleNodeRequest({ op: 'state', nodeId: nid, state: 'off', who: 'Rache' });
  ok(store.networkNodes[nid].state === 'off' && store.networkNodes[nid].log.at(-1).who === 'Rache', 'the GM lands the relayed change and logs who did it');
  ok((await svc.deleteNode(nid)).success && !store.networkNodes[nid], 'deleteNode removes it');
}

// ═══ 3. The node dialog round-trip (pure markup + reader) ═══
{
  globalThis.game.scenes.contents = [];
  const D = await imp('scripts/ui/NetworkNodes/NodeDialogs.js');
  const html = D.nodeEditHtml({ id: 'node_x', networkId: 'NET', name: 'Mast <b>', kind: 'router', place: 'roof', hidden: true, flavour: ['KEEPALIVE'] }, { networkName: 'NCPD', sceneName: 'Kabuki' });
  ok(html.includes('Mast &lt;b&gt;') && !html.includes('Mast <b>'), 'names are escaped');
  ok(/ncm-nde__kind is-on" data-v="router"/.test(html) && html.includes('KEEPALIVE') && html.includes('name="hidden" checked'), 'the dialog shows the node as it is');
  const fake = (vals, kind) => ({ querySelector: (sel) => {
    if (sel.includes('[data-nde-kinds]')) return { dataset: { v: kind } };
    const m = sel.match(/name="(\w+)"/); if (!m) return null;
    const v = vals[m[1]]; return typeof v === 'boolean' ? { checked: v } : { value: v };
  } });
  const back = D.readNodeEdit(fake({ name: ' Relay 03 ', sceneId: 'S1', place: 'x', hidden: false, discoverable: true, showTraffic: false, flavour: 'a\n\nb' }, 'antenna'), { id: 'node_x', networkId: 'NET', alert: 2 });
  ok(back.name === 'Relay 03' && back.kind === 'antenna' && back.discoverable && !back.showTraffic && back.flavour.join() === 'a,b', 'the reader takes every field back');
  ok(back.id === 'node_x' && back.alert === 2, 'fields the dialog does not show are kept');
}

// ═══ 4. Wiring ═══
{
  const sm = read('scripts/core/SettingsManager.js'), con = read('scripts/utils/constants.js'), reg = read('scripts/init/registerNetworkSystem.js');
  ok(/register\(MODULE_ID, 'networkNodes'[\s\S]{0,400}scope: 'world'[\s\S]{0,60}config: false/.test(sm), 'the networkNodes world setting is registered (hidden)');
  ok(con.includes("NETWORK_NODE_REQUEST: 'network:nodeRequest'") && reg.includes('SOCKET_OPS.NETWORK_NODE_REQUEST') && reg.includes('handleNodeRequest'), 'the relay op is registered and lands in handleNodeRequest (one GM)');
  const tab = read('scripts/ui/AdminPanel/tabs/NetworksTab.js'), hbs = read('templates/admin-panel/tab-networks.hbs');
  for (const op of ['nodeAdd', 'nodeScene', 'nodeToggle', 'nodeInspect', 'nodeMenu']) ok(hbs.includes(`data-op="${op}"`) && tab.includes(`case '${op}'`), `template ↔ op: ${op}`);
  ok(tab.includes("this._nodeState(nodeId, 'jammed')") && tab.includes('this._editNode(nodeId, netId)') && tab.includes('this._deleteNode(nodeId)') && tab.includes('...nodeAccessEntries(nodeId)'), 'the ⋯ menu holds jam / switch on, console, place, edit, ways in, remove');
  ok(tab.includes('nodes: this._nodesContext(n)') && hbs.includes('nodes.list') && hbs.includes('nodes.scenes'), 'the detail context carries the nodes and the template reads them');
  ok(!/\{\{\.\.\/(name|id)\}\}/.test(hbs.slice(hbs.indexOf('ncm-net2-nodes'), hbs.indexOf('Getting in'))), 'no ../ inside the nodes block (block-depth trap) — rows carry netId / netName');
  const css = read('styles/components/admin-panel/tab-networks.css');
  ok(css.includes('.ncm-net2-node__acts') && !/#[0-9a-f]{3,6}\b/i.test(css.slice(css.indexOf('Network nodes (2026-10-29'))), 'node rows are styled with tokens only');
  ok(read('styles/components/ncm-dialog.css').includes('.ncm-nde__sw'), 'the node dialog is styled');
  ok(read('scripts/services/NetworkService.js').includes("The GM's connection follows the scene too"), 'the GM is moved off a cut network too (no GM exemption)');
  ok(read('scripts/services/TerminalService.js').includes('_nodeCutsUplink(wantedId') && read('scripts/ui/Terminal/TerminalViewerApp.js').includes("Hooks.off('updateSetting', this._onNodesChange)"), 'a terminal uplink over a cut network is LOCAL ONLY; an open terminal refreshes on a node change');
  ok(read('scripts/services/NetworkService.js').includes("from '../utils/networkNodes.js'") && tab.includes("from '../../../utils/networkNodes.js'"), 'one rules module read by the service and the tab');
}

// ═══ 5. The console: the REAL _prepareContext over a mocked node, the REAL template through Handlebars ═══
{
  globalThis.foundry.applications = { api: { HandlebarsApplicationMixin: (B) => B, ApplicationV2: class {} }, instances: new Map() };
  globalThis.game.settings.get = (m, k) => (k === 'dateFormat' ? 'YMD' : k === 'timeFormat' ? '24h' : undefined);
  globalThis.window = globalThis.window || { matchMedia: () => ({ matches: true }) };
  const { NodeConsoleApp } = await imp('scripts/ui/NetworkNodes/NodeConsoleApp.js');
  const T0 = Date.parse('2045-08-14T22:10:00Z');
  const net = { id: 'NCPD', name: 'NCPD Dispatch', signalStrength: 78, theme: { color: '#5c9bff' }, security: { requiresAuth: true } };
  const mk = (over) => ({ id: 'node_kab', networkId: 'NCPD', name: 'Kabuki relay mast', kind: 'mast', sceneId: 'S1', place: 'rooftop, 4th & Kabuki', state: 'on', alert: 1, showTraffic: true,
    flavour: ['NCPD-07 keepalive'], log: [{ ts: T0 - 600000, who: 'Rache', what: 'switched on' }, { ts: T0 - 300000, who: 'GM', what: 'secret', wiped: true }], ...over });
  const fakeSvc = (node, { cur = 'NCPD', reach = true } = {}) => ({ getNode: () => N.sanitizeNode(node), getNetwork: () => net, _nowMs: () => T0,
    getAvailableNetworks: () => (reach ? [net] : []), currentNetworkId: cur, isDeadZone: false });
  globalThis.game.scenes.viewed = { id: 'S1' };
  globalThis.game.users = Object.assign([{ active: true, isGM: false, viewedScene: 'S1' }, { active: true, isGM: false, viewedScene: 'S2' }, { active: true, isGM: true, viewedScene: 'S1' }], { activeGM: { id: 'G' } });
  let asGM = false;
  Object.defineProperty(globalThis.game.user, 'isGM', { get: () => asGM, configurable: true });
  const ctxOf = async (node, o, gm = false) => { asGM = gm; return NodeConsoleApp.prototype._prepareContext.call(mkThis(NodeConsoleApp, { nodeId: node.id, networkService: fakeSvc(node, o), _session: null }), {}); };

  const on = await ctxOf(mk({}), { cur: 'CITINET' });
  ok(on.name === 'Kabuki relay mast' && on.networkName === 'NCPD Dispatch' && on.color === '#5c9bff' && /^0x/.test(on.hex) && on.firmware.startsWith('MAST-CTRL'), 'the console shows the real node, its network colour, hex and firmware');
  ok(on.signal === 78 && on.bars.filter((b) => b.on).length === 3 && on.here === 1, 'signal = the network’s, bars from it; "on this scene" counts players viewing the node’s scene');
  ok(on.canConnect && !on.onIt && /asks for its login/.test(on.connectHint), 'Connect is offered (and says the network asks for a login)');
  ok(on.canSwitch && /goes dark here/.test(on.switchHint) && !on.boxLocked, 'a player can switch off a node whose box is open');
  ok(on.ticker.includes('Rache — switched on') && !on.ticker.includes('secret') && on.ticker.includes('NCPD-07 keepalive') && /ncpd-dispatch\.unit-/.test(on.ticker), 'the ticker: the real log (never a wiped line), flavour, traffic in the network’s naming');
  ok(on.alertPips.filter((p) => p.cls).length === 1 && on.alertLabel === 'Wary', 'alert pips follow the node’s alert level');
  const locked = await ctxOf(mk({ security: { requiresAuth: true } }), {});
  ok(locked.boxLocked && !locked.canSwitch && /jack in/.test(locked.switchHint) && locked.onIt && !locked.canConnect, 'a locked box: no switch for a player (jack in later); already on it → Connected');
  const off = await ctxOf(mk({ state: 'off' }), { reach: false });
  ok(off.state === 'off' && off.signal === 0 && off.ticker === '— no carrier —' && !off.canConnect && off.canSwitch && /back up/.test(off.switchHint), 'off: flat, no carrier, nothing to connect to, a player can switch it back on');
  globalThis.game.scenes.viewed = { id: 'S2' };
  const away = await ctxOf(mk({}), { cur: 'X' });
  ok(!away.canConnect && /where it is/.test(away.connectHint), 'connecting needs you to be on the node’s scene');
  globalThis.game.scenes.viewed = { id: 'S1' };
  const gm = await ctxOf(mk({ security: { requiresAuth: true } }), {}, true);
  ok(gm.isGM && gm.canSwitch, 'the GM can always switch it');
  asGM = true;

  let H = null;
  for (const p of ['C:/Program Files/Foundry Virtual Tabletop/resources/app/package.json', 'C:/Program Files (x86)/Foundry Virtual Tabletop/resources/app/package.json']) {
    if (!existsSync(p)) continue; try { H = createRequire(p)('handlebars'); break; } catch { /* keep looking */ }
  }
  if (!H) { fail++; console.error('FAIL: could not load Handlebars from a Foundry install — render checks did not run'); }
  else {
    const tpl = H.compile(read('templates/network-nodes/node-console.hbs'));
    const html = tpl(on), htmlL = tpl(locked), htmlG = tpl(gm), htmlO = tpl(off);
    ok(html.includes('data-action="connect"') && html.includes('data-action="toggle"') && !html.includes('data-action="edit"'), 'player render: Connect + Switch off, no GM buttons');
    ok(!htmlL.includes('data-action="toggle"') && htmlL.includes('is-dead') && htmlL.includes('fa-lock'), 'locked render: the switch is shown dead with the lock');
    ok(htmlG.includes('data-action="edit"') && htmlG.includes('data-action="jam"'), 'GM render: Edit + Jam');
    ok(htmlO.includes('data-state="off"') && htmlO.includes('no carrier'), 'off render');
    const acts = new Set();
    for (const h of [html, htmlG]) for (const m of h.matchAll(/data-action="(\w+)"/g)) acts.add(m[1]);
    const js = read('scripts/ui/NetworkNodes/NodeConsoleApp.js');
    for (const a of acts) ok(js.includes(`${a}: NodeConsoleApp._on`), `template action is wired: ${a}`);
    if (process.env.NCM_DUMP) for (const [k, c] of Object.entries({ on, locked, off, gm })) writeFileSync(`${process.env.NCM_DUMP}/node-console-${k}.json`, JSON.stringify(c));
  }
  ok(read('scripts/utils/constants.js').includes('NODE_CONSOLE:') && read('styles/night-city-messenger.css').includes('components/node-console.css'), 'the template is registered and the stylesheet imported');
  ok(read('scripts/init/registerNetworkSystem.js').includes('ns.openNode = (nodeId) => NodeConsoleApp.open(nodeId)'), 'game.nightcity.openNode opens the console');
  const css = read('styles/components/node-console.css');
  ok(!/\.ncm-nc-/.test(css) && /prefers-reduced-motion/.test(css), 'console CSS: own prefix (ncm-nc- is taken), reduced-motion veto');
  const ap = read('scripts/utils/accessPoints.js'), apr = read('scripts/integrations/AccessPoints.js'), pins = read('scripts/integrations/TerminalScenePins.js');
  ok(ap.includes("node: { label: 'Network node'") && ap.includes('|message|node)'), 'node is an access-point kind (refs, journal links)');
  ok(apr.includes("case 'node': return ns?.openNode?.(ref.id);") && apr.includes('export function nodeAccessEntries') && apr.includes('export async function openNodePlaceDialog'), 'openAccess opens a node; nodes have their own ways-in menu and place dialog');
  ok(pins.includes('async placeNode(') && pins.includes('nodePinOf(doc)') && pins.includes('removePinsForNode') && pins.includes('setNodeHidden'), 'node pins: place, open, hide with the node, removed with it');
  for (const k of Object.keys(N.NODE_KINDS)) ok(existsSync(`${ROOT}/assets/icons/nodes/${k}.svg`), `pin icon for ${k}`);
}

// ═══ 6. A terminal's uplink over a cut network (TerminalService._nodeCutsUplink, the REAL method) ═══
{
  const { TerminalService } = await imp('scripts/services/TerminalService.js');
  const T1 = 5_000_000;
  const mkNs = (nodes) => ({ getNodes: ({ networkId, sceneId }) => nodes.filter((n) => n.networkId === networkId && n.sceneId === sceneId).map(N.sanitizeNode), _nowMs: () => T1 });
  globalThis.game.scenes.viewed = { id: 'S1' };
  const cuts = (nodes, wired = false) => TerminalService.prototype._nodeCutsUplink.call({ networkService: mkNs(nodes) }, 'NET', wired);
  ok(!cuts([]), 'no nodes on the scene → the uplink is untouched');
  ok(!cuts([{ id: 'a', networkId: 'NET', sceneId: 'S1', state: 'on' }, { id: 'b', networkId: 'NET', sceneId: 'S1', state: 'off' }]), 'one node up → the uplink holds');
  ok(cuts([{ id: 'a', networkId: 'NET', sceneId: 'S1', state: 'off' }]), 'every node down → LOCAL ONLY');
  ok(cuts([{ id: 'a', networkId: 'NET', sceneId: 'S1', state: 'jammed', jammedUntil: T1 + 1 }]) && !cuts([{ id: 'a', networkId: 'NET', sceneId: 'S1', state: 'jammed', jammedUntil: T1 + 1 }], true), 'a jam cuts a wireless uplink; a wired drop rides it out');
  ok(cuts([{ id: 'a', networkId: 'NET', sceneId: 'S1', state: 'damaged' }], true), 'a damaged node cuts even a wired drop');
  ok(!cuts([{ id: 'a', networkId: 'NET', sceneId: 'S2', state: 'off' }]), 'a node down on ANOTHER scene does not touch this one');
}

// ═══ 7. Jammed networks in the selector + Unjam in the console ═══
{
  const T2 = 9_000_000;
  const all = {
    a: { id: 'a', networkId: 'J', sceneId: 'S1', state: 'jammed', jammedUntil: T2 + 18 * 60000 },
    b: { id: 'b', networkId: 'J', sceneId: 'S1', state: 'off' },
    c: { id: 'c', networkId: 'D', sceneId: 'S1', state: 'damaged' },
    d: { id: 'd', networkId: 'O', sceneId: 'S1', state: 'off' },
    e: { id: 'e', networkId: 'U', sceneId: 'S1', state: 'on' },
  };
  const bl = N.sceneBlocks(all, 'S1', T2);
  ok(bl.J.state === 'jammed' && bl.J.until === T2 + 18 * 60000 && bl.D.state === 'damaged' && bl.O.state === 'off' && !bl.U, 'sceneBlocks: why each network is cut here (jammed wins, then damaged, then off); an up network is not listed');

  // the REAL selector builder over a fake service
  const viewerSrc = read('scripts/ui/MessageViewer/MessageViewerApp.js');
  const start = viewerSrc.indexOf('  _buildSelectorNetworks() {');
  const body = viewerSrc.slice(start, viewerSrc.indexOf('\n  _signalToLevel(', start));
  // eslint-disable-next-line no-new-func
  const build = new Function(`return ({ ${body.trim()} })._buildSelectorNetworks;`)();
  const nets = ['J', 'U', 'X'].map((id) => ({ id, name: id, type: 'public', signalStrength: 70, theme: {}, security: {} }));
  const fake = (o) => ({ networkService: { isDeadZone: false, isNodeDead: false, getAllNetworks: () => nets, getAvailableNetworks: () => nets.filter((n) => n.id === 'U'),
    currentNetworkId: 'U', isAuthenticated: () => true, getSceneBlocks: () => ({ J: { state: 'jammed', until: T2 + 18 * 60000 } }), _nowMs: () => T2, ...o } });
  globalThis.game.user = { isGM: false };
  const r1 = build.call(fake({}));
  const j = r1.selectorNetworks.find((n) => n.id === 'J');
  ok(j && j.state === 'jammed' && j.blockLabel === 'Jammed · 18m', 'a jammed network is its own row with the time left');
  ok(!r1.selectorNetworks.find((n) => n.id === 'X') && r1.selectorNetworks.at(-1).id === 'J', 'an out-of-range network still hides; jammed rows sort last');
  ok(r1.availableCount === 1, 'the "N networks available" count leaves jammed ones out');
  const r2 = build.call(fake({ isDeadZone: true, isNodeDead: true, getAvailableNetworks: () => [] }));
  ok(r2.selectorNetworks.length === 1 && r2.selectorNetworks[0].state === 'jammed', 'cut off by nodes: the selector still lists the jammed network (not the dead-zone panel)');
  ok(build.call(fake({ isDeadZone: true, isNodeDead: false })).selectorNetworks.length === 0, 'a real dead-zone scene still shows the dead-zone panel');
  const sel = read('templates/message-viewer/partials/network-selector.hbs');
  ok(sel.includes("(eq this.state 'jammed')") && sel.includes('ncm-net-option__chip--jammed') && !sel.includes('{{#if isDeadZone}}') && viewerSrc.includes('selectorDead: isDeadZone && !this.networkService?.isNodeDead'), 'the selector template draws the jammed row and keys its dead-zone panel on selectorDead');
  ok(viewerSrc.includes("is ${block.state === 'jammed' ? 'jammed' : 'down'} here"), 'clicking a jammed row says why instead of trying to connect');
  ok(read('styles/components/network-selector.css').includes('.ncm-net-option--jammed'), 'the jammed row is styled');

  // Unjam in the console (GM)
  const { NodeConsoleApp } = await imp('scripts/ui/NetworkNodes/NodeConsoleApp.js');
  let gm = true;
  globalThis.game.user = { get isGM() { return gm; }, id: 'G' };
  const net = { id: 'J', name: 'J', signalStrength: 70, theme: {}, security: {} };
  const ctx = (state) => NodeConsoleApp.prototype._prepareContext.call(mkThis(NodeConsoleApp, { nodeId: 'a', _session: null, networkService: { getNode: () => N.sanitizeNode({ ...all.a, state }), getNetwork: () => net, _nowMs: () => T2, getAvailableNetworks: () => [], currentNetworkId: 'U', isDeadZone: false, getNodes: () => [] } }), {});
  const cj = await ctx('jammed');
  ok(cj.switchLabel === 'Unjam' && cj.canSwitch && cj.isJammed && /end the jam now/.test(cj.switchHint), 'GM: a jammed node offers Unjam');
  ok((await ctx('damaged')).switchLabel === 'Repair', 'GM: a damaged node offers Repair');
  gm = false;
  const pj = await ctx('jammed');
  ok(!pj.canSwitch && pj.switchLabel === 'Switch on' && /comes back by itself/.test(pj.switchHint), 'a player cannot unjam it — it comes back by itself');
  ok(read('templates/network-nodes/node-console.hbs').includes('<b>{{switchLabel}}</b>'), 'the console button reads switchLabel');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
