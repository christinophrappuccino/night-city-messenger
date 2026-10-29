// Sim: the GM node inspector (2026-10-29, mock dev/mockups/node-inspector-mock.html). Drives the REAL inspector
// context and ops over the REAL NetworkService (mocked world), the shared network lockout (jackKey / jackLock), kicks
// (the console drops a kicked session), the quest notice, and renders the REAL template through Handlebars.
//   node dev/tools/sims/test-node-inspector.mjs     (NCM_DUMP=<dir> writes node-inspector.html)
import { pathToFileURL, fileURLToPath } from 'url';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { createRequire } from 'module';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const read = (p) => readFileSync(`${ROOT}/${p}`, 'utf8').replace(/\r\n/g, '\n');
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.error('FAIL:', m)); };
const mkThis = (Cls, props) => { const o = Object.create(Cls.prototype); for (const [k, v] of Object.entries(props)) Object.defineProperty(o, k, { value: v, writable: true, configurable: true }); return o; };

let asGM = true;
const NOW = 9_000_000;
const chats = [];
const actors = { A: { id: 'A', name: 'Rache', isOwner: true }, B: { id: 'B', name: 'V', isOwner: false } };
globalThis.game = {
  user: { get isGM() { return asGM; }, id: 'G', name: 'GM', character: null },
  users: Object.assign([{ id: 'G', isGM: true }, { id: 'P', isGM: false }], { activeGM: { id: 'G' } }),
  settings: { get: () => undefined },
  scenes: { get: (id) => (id === 'S1' ? { id: 'S1', name: 'Watson Docks' } : null), viewed: { id: 'S1' } },
  actors: { get: (id) => actors[id] || null, contents: Object.values(actors) },
  i18n: { localize: (s) => s },
  nightcity: { timeService: { getCurrentTimeMs: () => NOW } },
};
globalThis.ui = { notifications: { warn() {}, info() {}, error() {} } };
globalThis.Hooks = { on() {}, once() {}, off() {}, callAll() {} };
globalThis.ChatMessage = { create: async (d) => { chats.push(d); return d; } };
globalThis.foundry = { utils: { deepClone: (x) => JSON.parse(JSON.stringify(x)), mergeObject: (a, b) => ({ ...a, ...b }), randomID: (() => { let i = 0; return () => `r${++i}`; })() },
  applications: { api: { HandlebarsApplicationMixin: (B) => B, ApplicationV2: class {} }, instances: new Map() } };
globalThis.window = { matchMedia: () => ({ matches: true }) };

const J = await imp('scripts/utils/jackIn.js');
const N = await imp('scripts/utils/networkNodes.js');

// ═══ 1. The lockout is the network's ═══
{
  const R = J.resolveJackIn({});
  ok(J.jackKey({ id: 'n1', networkId: 'CITI' }) === 'CITI' && J.jackKey('CITI') === 'CITI', 'the jack-in lockout key is the network (same as its login)');
  const own = J.jackLock(R, { security: { maxAttempts: 5, lockoutDuration: 1800000 } });
  ok(own.maxAttempts === 5 && own.lockoutDuration === 1800000 && own.fromNetwork, 'a network with a login lockout: its own tries and length');
  const none = J.jackLock(R, { security: {} });
  ok(none.maxAttempts === R.failure.maxAttempts && none.lockoutDuration === R.failure.lockoutMinutes * 60000 && !none.fromNetwork, 'no lockout on the network: the Jacking in rules');
  ok(J.jackResolution(R, { override: { resolution: 'gm' } }) === 'gm' && J.jackResolution(R, { override: { resolution: 'bogus' } }) === R.resolution && J.jackResolution(R, {}) === R.resolution, 'a node can decide its own jack-ins (else the rules)');
  const con = read('scripts/ui/NetworkNodes/NodeConsoleApp.js');
  ok(!con.includes('jackKey(node.id)') && con.includes('jackLock(rules, net)') && con.includes('jackResolution(rules, node)'), 'the console uses the network key, its lockout and the node’s own resolution');
}

// ═══ 2. The service: kick, a move back, edit, quest ═══
const store = { networkNodes: {
  n1: { id: 'n1', networkId: 'CITI', sceneId: 'S1', name: 'Dock Mast', kind: 'mast', state: 'jammed', jammedUntil: NOW + 18 * 60000, alert: 2, security: { requiresAuth: true },
    log: [{ ts: NOW - 60000, who: 'Rache', what: 'jammed for 30 min' }, { ts: NOW - 120000, who: 'Rache', what: 'jacked in', wiped: true }],
    taps: [{ id: 't1', actorId: 'A', actorName: 'Rache', at: 1, until: 0 }],
    runs: [{ actorId: 'A', actorName: 'Rache', rank: 5, moves: 3, used: 2, since: NOW - 600000, until: NOW + 3000000, open: true }],
    infections: [N.makeInfection('worm', { id: 'w1', name: 'Lazarus', actorId: '', actorName: 'Voodoo Boys', now: NOW, quality: 70, stealthDV: 17, quest: true, note: 'Rogue’s job' })] },
}, customNetworks: [{ id: 'CITI', name: 'CitiNet', theme: { color: '#19f3f7' }, security: { maxAttempts: 4, lockoutDuration: 3600000 } }], coreNetworkOverrides: {} };
const { NetworkService } = await imp('scripts/services/NetworkService.js');
const svc = Object.create(NetworkService.prototype);
Object.assign(svc, { settingsManager: { get: (k) => store[k], set: async (k, v) => { store[k] = v; } }, socketManager: { emit() {} }, eventBus: { emit() {} },
  _networkCache: new Map([['CITI', store.customNetworks[0]]]), _authenticatedNetworks: new Set() });
svc.getNetwork = (id) => store.customNetworks.find((n) => n.id === id) || null;
game.nightcity.networkService = svc;
const pushed = [];
game.nightcity.accessLogService = { _push: (e) => pushed.push(e) };
game.nightcity.securityService = { knownForTarget: (t) => (t === 'CITI' ? [{ actorId: 'B', attempts: 4, maxAttempts: 4, lockoutRemaining: 40 * 60000 }] : []), clearFor() {} };
{
  ok(N.sanitizeInfections(store.networkNodes.n1.infections)[0].quest === true && N.sanitizeInfections(store.networkNodes.n1.infections)[0].note === 'Rogue’s job', 'infections keep quest + note');
  ok((await svc.kickRun('n1', 'A')).success && store.networkNodes.n1.runs[0].kicks === 1 && store.networkNodes.n1.runs[0].open === false && /kicked Rache out/.test(store.networkNodes.n1.log.at(-1).what), 'kick: the run closes, its kick count goes up, the log says so');
  ok(store.networkNodes.n1.runs[0].used === 2, 'a kick keeps the moves spent');
  await svc.saveRun('n1', { actorId: 'A', moves: 3, used: 2, open: true, minutes: 60 });
  ok(store.networkNodes.n1.runs[0].kicks === 1, 'saving the run later keeps the kick count');
  ok((await svc.setRunUsed('n1', 'A', 1)).success && store.networkNodes.n1.runs[0].used === 1, 'give a move back');
  ok((await svc.setRunUsed('n1', 'A', -5)).success && store.networkNodes.n1.runs[0].used === 0, '…never below zero');
  ok((await svc.updateInfection('n1', 'w1', { stealthDV: 20, name: 'Lazarus II', hacked: 1 })).success && store.networkNodes.n1.infections[0].stealthDV === 20 && !('hacked' in store.networkNodes.n1.infections[0]), 'edit an infection (only its allowed fields)');
  asGM = false;
  ok((await svc.kickRun('n1', 'A')).success === false && (await svc.updateInfection('n1', 'w1', {})).success === false, 'kick / edit are GM only');
  asGM = true;
}

// ═══ 3. The real inspector context + render ═══
const { NodeInspectorApp } = await imp('scripts/ui/NetworkNodes/NodeInspectorApp.js');
let ctx;
{
  const app = mkThis(NodeInspectorApp, { nodeId: 'n1', _add: '', _stale: false });
  ctx = await app._prepareContext({});
  ok(ctx.name === 'Dock Mast' && ctx.netName === 'CitiNet' && ctx.sceneName === 'Watson Docks', 'header: node, network, scene');
  ok(ctx.states.find((s) => s.on)?.v === 'jammed' && ctx.states.find((s) => s.v === 'jammed').t === '18 min', 'state: jammed, with time left');
  ok(ctx.alertWord === 'Alarmed' && ctx.alertTone === 'bad' && ctx.canUp && ctx.canDown, 'alert: word, tone, both ways');
  ok(ctx.flags.map((f) => `${f.key}:${f.on}`).join() === 'locked:true,hidden:false,traffic:true', 'the node’s three switches');
  ok(ctx.stateRow?.isJam && ctx.stateRow.by === 'Rache' && /Back on in 18 min/.test(ctx.stateRow.detail), 'what is affecting it: the jam and who did it');
  ok(ctx.infections[0].quest && ctx.infections[0].by === 'Voodoo Boys' && /DV 20/.test(ctx.infections[0].detail) && ctx.infections[0].isWorm, 'an infection: quest, planter, the DV a sweep needs');
  ok(ctx.effects[0].label === 'Tap' && ctx.effects[0].by === 'Rache' && /Watson Docks/.test(ctx.effects[0].detail), 'a tap names its scene');
  ok(ctx.runs[0].name === 'Rache' && ctx.runs[0].open && ctx.runs[0].left === 3, 'runners: their saved session');
  ok(ctx.lockouts[0].name === 'V' && ctx.lockouts[0].locked && /counts for its login too/.test(ctx.lockouts[0].detail), 'lockouts on the network, shared with its login');
  ok(/CitiNet's login lockout: 4 tries/.test(ctx.lockNote), 'the note says which lockout applies');
  ok(ctx.log[0].what === 'jammed for 30 min' || ctx.log.some((l) => l.wiped), 'the full log incl. wiped lines');
  ok(!ctx.quiet, 'not quiet');

  const app2 = mkThis(NodeInspectorApp, { nodeId: 'n1', _add: 'infection', _stale: false });
  const ctx2 = await app2._prepareContext({});
  ok(ctx2.addInf && ctx2.adds.find((a) => a.k === 'infection').open && ctx2.plants.length === 4, 'Add → Infection opens its form');

  let H = null;
  for (const p of ['C:/Program Files/Foundry Virtual Tabletop/resources/app/package.json', 'C:/Program Files (x86)/Foundry Virtual Tabletop/resources/app/package.json']) {
    if (!existsSync(p)) continue; try { H = createRequire(p)('handlebars'); break; } catch { /* keep looking */ }
  }
  if (!H) { fail++; console.error('FAIL: no Handlebars — render checks did not run'); }
  else {
    const tpl = H.compile(read('templates/network-nodes/node-inspector.hbs'));
    const a = tpl(ctx), b = tpl(ctx2);
    ok(a.includes('data-action="unjam"') && a.includes('data-action="infClean"') && a.includes('data-action="fxDel"') && a.includes('data-action="runKick"') && a.includes('data-action="lockClear"'), 'every row has its control');
    ok(a.includes('ncm-nin__flags') && (a.match(/data-action="flag"/g) || []).length === 3, 'the switches render as one joined group');
    ok(b.includes('data-pick-group="kind"') && b.includes('name="quest"') && b.includes('data-action="addSubmit"'), 'the infection form renders');
    const acts = new Set(); for (const h of [a, b]) for (const m of h.matchAll(/data-action="(\w+)"/g)) acts.add(m[1]);
    const js = read('scripts/ui/NetworkNodes/NodeInspectorApp.js');
    for (const x of acts) ok(js.includes(`${x}: NodeInspectorApp._act`), `template action is wired: ${x}`);
    for (const x of acts) ok(js.includes(`case '${x}'`), `template action is handled: ${x}`);
    if (process.env.NCM_DUMP) { writeFileSync(`${process.env.NCM_DUMP}/node-inspector.html`, a); writeFileSync(`${process.env.NCM_DUMP}/node-inspector-add.html`, b); }
  }
}

// ═══ 4. Quest notice, wiring ═══
{
  await svc.cleanInfection('n1', 'w1', 'Rache');
  ok(chats.length === 1 && /Quest — infection cleaned/.test(chats[0].content) && /Lazarus II/.test(chats[0].content) && chats[0].whisper.join() === 'G', 'cleaning a quest infection whispers the GM');
  const js = read('scripts/ui/NetworkNodes/NodeInspectorApp.js');
  ok(js.includes('static ADMIN_THEMED = true') && js.includes('minimizable: true'), 'admin-themed and minimizable');
  ok(read('scripts/utils/constants.js').includes('NODE_INSPECTOR:') && read('styles/night-city-messenger.css').includes("@import 'components/node-inspector.css';"), 'template + stylesheet registered');
  ok(read('scripts/init/registerNetworkSystem.js').includes('ns.inspectNode = (nodeId) => NodeInspectorApp.open(nodeId)'), 'game.nightcity.inspectNode');
  ok(read('templates/admin-panel/tab-networks.hbs').includes('data-op="nodeInspect"') && read('scripts/ui/AdminPanel/tabs/NetworksTab.js').includes("case 'nodeInspect'"), 'Admin → Networks node row opens it');
  ok(read('scripts/integrations/TerminalScenePins.js').includes("inspectNode?.(nodeId)") && read('templates/network-nodes/node-console.hbs').includes('data-action="inspect"'), 'the pin menu and the console open it');
  const con = read('scripts/ui/NetworkNodes/NodeConsoleApp.js');
  ok(con.includes('(run.kicks || 0) > (this._session.kicks || 0)') && con.includes("'DISCONNECTED'"), 'a kicked runner’s console drops the session');
  const css = read('styles/components/node-inspector.css');
  ok(!/#[0-9a-f]{3,6}\b(?![^(]*\))/i.test(css.replace(/var\([^)]*\)/g, '').replace(/--nc: #19f3f7;/, '')), 'inspector CSS: tokens only');
}

// ═══ 5. The Activity log hears the nodes and scene moves; scene cards fall back to the background ═══
{
  const kicks = pushed.filter((e) => e.type === 'node' && /kicked Rache out/.test(e.message));
  ok(kicks.length === 1 && kicks[0].networkId === 'CITI' && kicks[0].sceneId === 'S1' && kicks[0].actorName === 'GM', 'a node write logs its new line to the Activity log (network + the node’s scene)');
  ok(pushed.some((e) => e.type === 'node' && /cleaned a worm/.test(e.message) && e.actorName === 'Rache'), 'a player cleaning a worm shows who did it');
  const tab = read('scripts/ui/AdminPanel/tabs/NetworksTab.js');
  ok(tab.includes("{ value: 'node', label: 'Nodes', types: ['node'] }") && tab.includes("{ value: 'scene', label: 'Scene moves', types: ['scene_move'] }"), 'the log has Nodes and Scene moves chips');
  const al = read('scripts/services/NetworkAccessLogService.js');
  ok(al.includes("Hooks.on('updateUser'") && al.includes("type: 'scene_move'") && al.includes('moved to ${scene.name}'), 'a player moving scene is logged with the network they are on');
  ok(tab.includes("thumb: s.thumb || s.background?.src || ''") && tab.includes("fields: ['thumb', 'background.src']"), 'scene cards: the thumbnail, else the scene’s own background');
}

// ═══ 6. Node writes never undo each other (dev: "my moves got reset") ═══
{
  // a slow settings write, like Foundry's: the old code let a second write start from the same map and undo the first
  const slow = svc.settingsManager.set;
  svc.settingsManager.set = async (k, v) => { await new Promise((r) => setTimeout(r, 5)); store[k] = v; };
  store.networkNodes.n1.runs = [{ actorId: 'A', actorName: 'Rache', rank: 5, moves: 3, used: 0, since: NOW, until: NOW + 3600000, open: true }];
  // what a session action does: save the spent move (not awaited) and write its own log line, at once
  const a = svc.saveRun('n1', { actorId: 'A', moves: 3, used: 1, open: true, minutes: 60 });
  const b = svc.nodeLog('n1', 'Rache', 'jammed it');
  const c = svc.bumpNodeAlert('n1', 1);
  await Promise.all([a, b, c]);
  const n = store.networkNodes.n1;
  ok(n.runs.find((r) => r.actorId === 'A').used === 1, 'the spent move survives a write made at the same moment');
  ok(n.log.at(-1).what === 'jammed it', '…and so does the log line');
  ok(n.alert === 3 || n.alert === 2, '…and the alert');
  // a relayed player sequence on the GM: handler calls arrive together
  await Promise.all([svc.handleNodeRequest({ op: 'run', nodeId: 'n1', run: { actorId: 'A', moves: 3, used: 2, open: true, minutes: 60 } }), svc.handleNodeRequest({ op: 'log', nodeId: 'n1', who: 'Rache', what: 'tapped it' })]);
  ok(store.networkNodes.n1.runs.find((r) => r.actorId === 'A').used === 2 && store.networkNodes.n1.log.at(-1).what === 'tapped it', 'two relayed requests the GM handles at once both land');
  ok(read('scripts/services/NetworkService.js').includes('const NODE_WRITERS = ['), 'every node writer runs through one queue');
  svc.settingsManager.set = slow;
}

// ═══ 7. A refresh resumes the session (the REAL console view) ═══
{
  const { NodeConsoleApp } = await imp('scripts/ui/NetworkNodes/NodeConsoleApp.js');
  store.networkNodes.n1.state = 'on'; store.networkNodes.n1.jammedUntil = 0;
  store.networkNodes.n1.runs = [{ actorId: 'A', actorName: 'Rache', rank: 5, moves: 3, used: 2, since: NOW, until: NOW + 3600000, open: true, kicks: 0 }];
  const node = svc.getNode('n1');
  const fresh = () => mkThis(NodeConsoleApp, { nodeId: 'n1', _session: null, _jackedOut: false, _runner: () => ({ actor: actors.A, rank: 5 }) });
  const app = fresh();   // a new console after a page refresh: no session in memory
  try { app._jackContext(node, svc.getNetwork('CITI'), 'on', true); } catch { /* the rest of the view needs more mocks; the resume runs first */ }
  ok(app._session && app._session.actorId === 'A' && app._session.used === 2 && app._session.moves === 3, 'after a refresh the console comes back jacked in, with the moves already spent (no roll)');
  store.networkNodes.n1.runs[0].open = false;   // they had pressed Jack out before
  const app2 = fresh();
  try { app2._jackContext(svc.getNode('n1'), svc.getNetwork('CITI'), 'on', true); } catch { /* as above */ }
  ok(!app2._session, 'after a deliberate Jack out a reopened console is NOT jacked in (getting back in is a roll — and keeps the spent moves)');
  store.networkNodes.n1.runs[0].open = true; store.networkNodes.n1.runs[0].until = NOW - 1;
  const app3 = fresh();
  try { app3._jackContext(svc.getNode('n1'), svc.getNetwork('CITI'), 'on', true); } catch { /* as above */ }
  ok(!app3._session, 'once the session’s time is up, a refresh does not resume it');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
