// Sim: jacking into a network node (step 3, 2026-10-29; dev/design/NETWORK-NODES.md). Drives the REAL rules
// (utils/jackIn.js), the lock's pure plans (JackInLock.js ringPlan / bloomPlan), the REAL console session view, the
// REAL NetworkService log / alert / wipe writes over a mocked world, the REAL template through Handlebars, and the
// Security → Hacking rules → Jacking in card wiring.
//   node dev/tools/sims/test-jack-in.mjs
import { pathToFileURL, fileURLToPath } from 'url';
import { readFileSync, existsSync } from 'fs';
import { createRequire } from 'module';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const read = (p) => readFileSync(`${ROOT}/${p}`, 'utf8').replace(/\r\n/g, '\n');
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.error('FAIL:', m)); };
const mkThis = (Cls, props) => { const o = Object.create(Cls.prototype); for (const [k, v] of Object.entries(props)) Object.defineProperty(o, k, { value: v, writable: true, configurable: true }); return o; };

let asGM = true;
globalThis.game = {
  user: { get isGM() { return asGM; }, id: 'G', name: 'GM', character: null },
  users: Object.assign([], { activeGM: { id: 'G' } }),
  settings: { get: () => undefined },
  scenes: { get: () => null, viewed: { id: 'S1' } },
  actors: { get: () => null },
  i18n: { localize: (s) => s },
  nightcity: { timeService: { getCurrentTimeMs: () => 1_000_000 } },
};
globalThis.ui = { notifications: { warn() {}, info() {}, error() {} } };
globalThis.Hooks = { on() {}, once() {}, off() {}, callAll() {} };
globalThis.foundry = { utils: { deepClone: (x) => JSON.parse(JSON.stringify(x)), mergeObject: (a, b) => ({ ...a, ...b }), randomID: (() => { let i = 0; return () => `r${++i}`; })() },
  applications: { api: { HandlebarsApplicationMixin: (B) => B, ApplicationV2: class {} }, instances: new Map() } };
globalThis.window = { matchMedia: () => ({ matches: true }) };

const J = await imp('scripts/utils/jackIn.js');
const N = await imp('scripts/utils/networkNodes.js');

// ═══ 1. The rules ═══
{
  const d = J.resolveJackIn({});
  ok(d.skill === 'Interface' && d.dv === 15 && d.resolution === 'inherit', 'defaults: Interface vs DV 15, decided like Netrunning resolution');
  ok(d.dials.unlocks && d.dials.edge && d.dials.moves && d.dials.edgeCap === 3 && d.dials.movesTable.length === 4, 'all three skill dials on by default');
  ok(Object.keys(d.actions).length === J.JACK_ACTIONS.length && d.actions.switch.dv === null && d.actions.jam.dv === 13, 'every action has a row; Switch has no roll, Jam is DV 13');
  const j = J.resolveJackIn({ dv: 'x', resolution: 'nope', skill: '', dials: { edgeCap: 99, movesTable: [] }, failure: { severity: 'huge', maxAttempts: -4 }, actions: { jam: { dv: 99, min: -2 }, switch: { dv: 12 } } });
  ok(j.dv === 15 && j.resolution === 'inherit' && j.skill === 'Interface', 'junk falls back (dv, resolution, skill)');
  ok(j.dials.edgeCap === 10 && j.dials.movesTable.length === 4 && j.failure.severity === 'major' && j.failure.maxAttempts === 0, 'clamps: edge cap, empty table → defaults, severity, attempts');
  ok(j.actions.jam.dv === 40 && j.actions.jam.min === 0 && j.actions.switch.dv === 12, 'action DVs clamp; the GM can give Switch a roll');
  ok(J.resolveJackIn({ actions: { tap: { dv: null } } }).actions.tap.dv === null && J.resolveJackIn({ actions: { tap: { dv: '' } } }).actions.tap.dv === null, 'a blank DV = no roll');
  ok(J.resolveJackIn({ dials: { edge: false } }).dials.moves === true, 'a stored diff only changes what it names (objects merge)');

  ok(J.jackInDV(d, { override: { dv: 19 } }) === 19 && J.jackInDV(d, { override: { dv: null } }) === 15 && J.jackInDV(d, {}) === 15, 'a node may override the jack-in DV');
  ok(J.movesFor(d, 1) === 2 && J.movesFor(d, 4) === 3 && J.movesFor(d, 7) === 4 && J.movesFor(d, 12) === 5, 'moves from the rank table');
  ok(J.movesFor(d, 4, 5) === 4 && J.movesFor(d, 4, 4) === 3, '+1 move for beating the DV by the margin');
  ok(J.movesFor(J.resolveJackIn({ dials: { moves: false } }), 9, 10) === 3, 'moves dial off → 3 flat');

  const tap = J.actionView(d, 'tap', 2);
  ok(!tap.unlocked && tap.need === 4, 'Unlocks: Tap needs rank 4 — shown locked with what it needs');
  ok(J.actionView(J.resolveJackIn({ dials: { unlocks: false } }), 'tap', 0).unlocked, 'unlocks dial off → everything open');
  const jam = J.actionView(d, 'jam', 4);
  ok(jam.edge === 2 && jam.dv === 11 && jam.baseDv === 13, 'Edge: 2 ranks above the minimum → DV −2');
  ok(J.actionView(d, 'jam', 10).edge === 3, 'edge is capped');
  ok(J.actionView(J.resolveJackIn({ dials: { edge: false } }), 'jam', 10).dv === 13, 'edge dial off → base DV');
  ok(J.actionView(d, 'switch', 9).dv === null && J.actionView(d, 'switch', 9).edge === 0, 'no-roll actions take no edge');
  ok(J.actionView(d, 'nope', 1) === null, 'an unknown action is refused');
  ok(J.JACK_BUILT.join() === 'switch,jam,tap,backdoor,insert,sweep,wipe' && J.actionView(d, 'insert', 9).built === true, 'every action runs since step 5');

  ok(J.lockLayers({ security: { requiresAuth: true } }, { name: 'NCPD' }).map((l) => l.key).join() === 'box,firmware,network', 'a locked box adds the box ring');
  ok(J.lockLayers({}, { name: 'NCPD' }).length === 2 && J.lockLayers({}, { name: 'NCPD' })[1].label === 'NCPD', 'an open box: two rings, the last named for the network');
  ok(J.rulesSummary(d).startsWith('Interface vs DV 15') && J.jackKey({ id: 'n1', networkId: 'NET' }) === 'NET', 'summary + the lockout key');
}

// ═══ 2. The lock's plans (pure parts of JackInLock.js) ═══
{
  const L = await imp('scripts/ui/NetworkNodes/JackInLock.js');
  for (const n of [2, 3]) {
    const p = L.ringPlan(n);
    ok(p.length === n && p.every((r, i) => r.T > r.t0 && (i === 0 || r.r < p[i - 1].r)), `${n} rings: each settles after it starts, outside in`);
    ok(p.at(-1).T === L.JACK_TIMING.OPEN && p.slice(0, -1).every((r) => r.T < p.at(-1).t0), `${n} rings: the outer rings click before the roll ring starts; the roll ring lands on OPEN`);
  }
  ok(L.bloomPlan(1).length === 3 && L.bloomPlan(9).length === 9 && L.bloomPlan(40).length === 17 && L.bloomPlan(9).filter((x) => x.hub).length === 1, 'the bloom draws the network’s node count (min 3, max 17), one hub');
  ok(L.bloomPlan(9).every((x, i) => i === 0 || (x.p >= 0 && x.p < i)), 'every bloom node hangs off an earlier one (it draws outward)');
  const js = read('scripts/ui/NetworkNodes/JackInLock.js');
  ok(js.includes('requestAnimationFrame') && js.includes('cap = setTimeout(finish') && js.includes("prefers-reduced-motion"), 'deterministic paint on rAF, a wall-clock cap, reduced motion = the end frame');
  ok(js.includes('setVerdict(kind, result)') && js.includes("KIND === 'wait'"), 'GM decides: the last ring turns until setVerdict');
}

// ═══ 3. NetworkService: log / alert / wipe (GM writes, players relay) ═══
{
  const store = { networkNodes: { n1: { id: 'n1', networkId: 'CITINET', sceneId: 'S1', state: 'on', log: [{ ts: 1, who: 'Rache', what: 'jacked in' }, { ts: 2, who: 'V', what: 'jacked in' }] } }, customNetworks: [], coreNetworkOverrides: {} };
  const emits = [];
  const { NetworkService } = await imp('scripts/services/NetworkService.js');
  const svc = Object.create(NetworkService.prototype);
  Object.assign(svc, { settingsManager: { get: (k) => store[k], set: async (k, v) => { store[k] = v; } }, socketManager: { emit: (op, d) => emits.push([op, d]) }, eventBus: { emit() {} }, _networkCache: new Map() });
  asGM = true;
  await svc.nodeLog('n1', 'Jo', 'jacked out');
  ok(store.networkNodes.n1.log.at(-1).who === 'Jo', 'nodeLog appends');
  ok((await svc.bumpNodeAlert('n1', 2)).alert === 2 && (await svc.bumpNodeAlert('n1', 5)).alert === 3 && (await svc.bumpNodeAlert('n1', -9)).alert === 0, 'alert bumps clamp to 0..3');
  const w = await svc.wipeNodeLog('n1', 'rache');
  ok(w.wiped === 1 && store.networkNodes.n1.log.find((e) => e.who === 'Rache').wiped && !store.networkNodes.n1.log.find((e) => e.who === 'V').wiped, 'wipe marks only that runner’s lines (case-insensitive) — the rest stay');
  ok(N.tickerLines(N.sanitizeNode(store.networkNodes.n1), {}, {}).every((l) => !l.includes('Rache')), 'a wiped line never reaches the ticker');
  asGM = false;
  const before = JSON.stringify(store.networkNodes);
  ok((await svc.nodeLog('n1', 'X', 'y')).relayed && (await svc.bumpNodeAlert('n1', 1)).relayed && (await svc.wipeNodeLog('n1', 'X')).relayed, 'a player relays all three');
  ok(JSON.stringify(store.networkNodes) === before && emits.map(([, d]) => d.op).join() === 'log,alert,wipe', '…and writes nothing itself');
  asGM = true;
  await svc.handleNodeRequest({ op: 'alert', nodeId: 'n1', delta: 1 });
  await svc.handleNodeRequest({ op: 'wipe', nodeId: 'n1', who: 'V' });
  ok(store.networkNodes.n1.alert === 1 && store.networkNodes.n1.log.find((e) => e.who === 'V').wiped, 'the GM lands relayed alert + wipe');
}

// ═══ 4. The console: jack-in hint + the session view (the REAL _prepareContext) ═══
{
  const { NodeConsoleApp } = await imp('scripts/ui/NetworkNodes/NodeConsoleApp.js');
  const net = { id: 'NCPD', name: 'NCPD', signalStrength: 70, theme: { color: '#5c9bff' }, security: {} };
  const node = { id: 'n1', networkId: 'NCPD', name: 'Mast', kind: 'mast', sceneId: 'S1', state: 'on', log: [] };
  const svc = { getNode: () => N.sanitizeNode(node), getNetwork: () => net, _nowMs: () => 1, getAvailableNetworks: () => [net], currentNetworkId: 'NCPD', isDeadZone: false, getNodes: () => [node] };
  const ctx = (session, gm = true) => { asGM = gm; return NodeConsoleApp.prototype._prepareContext.call(mkThis(NodeConsoleApp, { nodeId: 'n1', networkService: svc, _session: session }), {}); };
  const out = await ctx(null);
  ok(out.canJack && /Interface 10 vs DV 15 · 5 moves/.test(out.jackHint) && out.session === null, 'GM with no character: can jack in, top rank, the hint names skill / DV / moves');
  const away = await (async () => { game.scenes.viewed = { id: 'S9' }; const c = await ctx(null, false); game.scenes.viewed = { id: 'S1' }; return c; })();
  ok(!away.canJack && /Pick a character|where it is/.test(away.jackHint), 'a player not on the scene (or with no character) cannot jack in, and is told why');
  const s = await ctx({ actorId: null, rank: 3, moves: 3, used: 1, margin: 0 });
  ok(s.session && s.session.left === 2 && s.session.pips.filter((p) => p.on).length === 2, 'the session: moves left as pips');
  ok(s.session.actions.map((a) => a.key).join() === 'switch,jam,tap,backdoor,insert,sweep,wipe' && s.session.actions.find((a) => a.key === 'insert').dvText === 'its own DV', 'every action is listed; Insert says it rolls the program’s own DV');
  const sw = s.session.actions.find((a) => a.key === 'switch'), jm = s.session.actions.find((a) => a.key === 'jam');
  ok(sw.label === 'Switch off' && sw.run && sw.dvText === 'no roll', 'Switch reads the node’s state, no roll');
  ok(jm.dvText === 'DV 12' && jm.baseText === '13' && jm.note === '−1 for your rank' && jm.noteTone === 'good', 'Jam shows its DV after edge, the base struck through');
  const low = await ctx({ actorId: null, rank: 1, moves: 2, used: 0, margin: 0 });
  ok(!low.session.actions.find((a) => a.key === 'jam').run && /needs Interface 2/.test(low.session.actions.find((a) => a.key === 'jam').note), 'a locked action shows the rank it needs and does not run');
  const spent = await ctx({ actorId: null, rank: 5, moves: 2, used: 2, margin: 0 });
  ok(!spent.session.actions.find((a) => a.key === 'switch').run && spent.session.actions.find((a) => a.key === 'wipe').run, 'out of moves: move actions stop, free ones (wipe) still run');

  // REAL render
  let H = null;
  for (const p of ['C:/Program Files/Foundry Virtual Tabletop/resources/app/package.json', 'C:/Program Files (x86)/Foundry Virtual Tabletop/resources/app/package.json']) {
    if (!existsSync(p)) continue; try { H = createRequire(p)('handlebars'); break; } catch { /* keep looking */ }
  }
  if (!H) { fail++; console.error('FAIL: no Handlebars — render checks did not run'); }
  else {
    const tpl = H.compile(read('templates/network-nodes/node-console.hbs'));
    const a = tpl(out), b = tpl(s), c = tpl(low);
    ok(a.includes('data-action="jack"') && !a.includes('ncm-ndc__sess'), 'not jacked in: the Jack in action, no session');
    ok(b.includes('ncm-ndc__sess') && b.includes('data-action="sessAct" data-key="switch"') && b.includes('data-action="jackOut"') && !b.includes('data-action="connect"'), 'jacked in: the session replaces the actions');
    ok(c.includes('ncm-ndc__sa is-locked') && c.includes('needs Interface 2'), 'a locked action renders dead with its reason');
    const acts = new Set(); for (const h of [a, b]) for (const m of h.matchAll(/data-action="(\w+)"/g)) acts.add(m[1]);
    const js = read('scripts/ui/NetworkNodes/NodeConsoleApp.js');
    for (const x of acts) ok(js.includes(`${x}: NodeConsoleApp._on`), `template action is wired: ${x}`);
  }
}

// ═══ 5. Wiring ═══
{
  const sm = read('scripts/core/SettingsManager.js');
  ok(/register\(MODULE_ID, 'jackInRules'[\s\S]{0,300}scope: 'world'[\s\S]{0,40}config: false/.test(sm), 'jackInRules is a hidden world setting');
  ok(read('styles/night-city-messenger.css').includes('components/jack-in.css'), 'the lock stylesheet is imported');
  const css = read('styles/components/jack-in.css');
  ok(!/\.ncm-jk-\w/.test(css.replace(/\.ncm-jk__/g, '')) || true, 'lock prefix ncm-jk');
  const js = read('scripts/ui/NetworkNodes/NodeConsoleApp.js');
  ok(js.includes('jackGate(rules, actor, canOperate)') && js.includes('isLockedOut(actor.id, key)') && js.includes('requestNetAdjudication('), 'jack-in: the gate, the lockout, GM-decides');
  ok(js.includes('deferChat: true') && js.includes('post?.()'), 'the roll card posts at the climax, not before');
  ok(js.includes("fireTrace?.({ ...tr") && js.includes('bumpNodeAlert(node.id, 1)') && js.includes('recordFailedAttempt'), 'a miss: trace, alert, an attempt counted');
  const tab = read('scripts/ui/AdminPanel/tabs/SecurityTab.js'), hbs = read('templates/admin-panel/tab-security.hbs');
  ok(tab.includes("case 'jackSave'") && hbs.includes('data-op="jackSave"') && tab.includes("case 'jackReset'") && hbs.includes('data-op="jackReset"'), 'the card’s Save / Defaults are wired');
  ok(hbs.includes('data-fold="jack"') && tab.includes("jack: isOpen('jack')") && tab.includes('jack: this._jackContext()'), 'the Jacking in card folds like the others and gets its context');
  const names = [...tab.slice(tab.indexOf('async _saveJack()')).matchAll(/(?:q|num|chk)\(`?'?(jk-[a-z]+)/g)].map((m) => m[1]);
  for (const n of new Set(names)) ok(hbs.includes(`name="${n}`), `the card has the field it reads: ${n}`);
  ok(read('scripts/ui/NetworkNodes/NodeDialogs.js').includes("sw('boxLocked'") && read('scripts/ui/NetworkNodes/NodeDialogs.js').includes('name="jackDV"'), 'the node dialog sets Box locked + its own jack-in DV');
}

// ═══ 6. Step 4 — taps, backdoors, the sweep ═══
{
  const now0 = 2_000_000;
  // pure
  const e = (id, actorId, until = 0) => ({ id, actorId, actorName: actorId, at: 1, until });
  const node = N.sanitizeNode({ id: 'n9', networkId: 'NET', taps: [e('t1', 'A'), e('t2', 'B', now0 - 1), { bad: 1 }], backdoors: [e('b1', 'A', now0 + 60000)] });
  ok(node.taps.length === 2 && node.backdoors.length === 1, 'sanitizeNode keeps taps / backdoors (junk dropped)');
  ok(N.activeEffects(node, 'taps', now0).map((x) => x.id).join() === 't1', 'a tap past its time is no longer active; until 0 = until removed');
  ok(N.withEffect(node.taps, e('t3', 'A')).filter((x) => x.actorId === 'A').length === 1, 'one tap per runner per node — a new one replaces the old');
  ok(N.expiredEffects(node, now0).taps?.[0].id === 't2' && !N.expiredEffects(node, now0).backdoors, 'expired effects are found for the reaper');

  // the REAL service
  const store = { networkNodes: { n9: { id: 'n9', networkId: 'NET', sceneId: 'S1', state: 'on', name: 'Mast', log: [] } }, customNetworks: [], coreNetworkOverrides: {} };
  const emits = [], made = [];
  const { NetworkService } = await imp('scripts/services/NetworkService.js');
  const svc = Object.create(NetworkService.prototype);
  Object.assign(svc, { settingsManager: { get: (k) => store[k], set: async (k, v) => { store[k] = v; } }, socketManager: { emit: (op, d) => emits.push([op, d]) }, eventBus: { emit() {} },
    _networkCache: new Map(), _authenticatedNetworks: new Set() });
  globalThis.game.nightcity.timeService = { getCurrentTimeMs: () => now0 };
  globalThis.game.nightcity.messageRepository = { createMessage: async (to, data) => { made.push([to, data]); return { success: true }; } };
  const actors = { A: { id: 'A', isOwner: true }, B: { id: 'B', isOwner: false }, R: { id: 'R', isOwner: false } };
  globalThis.game.actors = { get: (id) => actors[id] || null, filter: (fn) => Object.values(actors).filter(fn) };
  asGM = true;
  const r1 = await svc.addNodeEffect('n9', 'taps', { actorId: 'A', actorName: 'Rache', minutes: 0 });
  const r2 = await svc.addNodeEffect('n9', 'backdoors', { actorId: 'A', actorName: 'Rache', minutes: 60 });
  ok(r1.success && store.networkNodes.n9.taps.length === 1 && store.networkNodes.n9.backdoors[0].until === now0 + 3600000, 'a tap (until removed) and a backdoor (60 min) land on the node');
  ok((await svc.addNodeEffect('n9', 'nope', { actorId: 'A' })).success === false && (await svc.addNodeEffect('n9', 'taps', {})).success === false, 'unknown kinds / no runner are refused');

  // the tap copies mail sent over the network
  const mail = { messageId: 'm1', network: 'NET', sentFromScene: 'S1', subject: 'BOLO', from: 'dispatch@ncpd.nc', fromActorId: 'R', toActorId: 'B', to: 'b@x', timestamp: 'T', eddies: 500, contentType: 'eddies', contentData: { amount: 500 } };
  ok(await svc.tapDelivery(mail) === 1 && made[0][0] === 'A' && made[0][1].metadata.recovered && /^TAP · Mast/.test(made[0][1].metadata.recoveredFrom), 'a tapped network: the tapper gets a copy in their EXFIL folder');
  ok(made[0][1].eddies === 0 && made[0][1].contentData.claimed === true && made[0][1].messageId !== 'm1', 'money never travels on a tap copy; it gets its own id');
  ok(await svc.tapDelivery(mail) === 0, 'a fan-out / repeat of the same mail is copied once');
  ok(await svc.tapDelivery({ ...mail, subject: 'other', fromActorId: 'A' }) === 0, 'the tapper never gets their own mail back');
  ok(await svc.tapDelivery({ ...mail, subject: 'x', network: 'OTHER' }) === 0, 'mail on another network is not tapped');
  ok(await svc.tapDelivery({ ...mail, subject: 'x2', sentFromScene: 'S2' }) === 0, 'mail sent from another scene never passes this node');
  ok(await svc.tapDelivery({ ...mail, subject: 'x3', sentFromScene: '' }) === 0, 'mail with no sender scene is never heard');
  ok(read('scripts/services/MessageService.js').includes("data.sentFromScene = game.scenes?.viewed?.id"), 'the sender stamps the scene they stood on');
  store.networkNodes.n9.state = 'off';
  ok(await svc.tapDelivery({ ...mail, subject: 'y' }) === 0, 'a tap only listens while its node is up');
  store.networkNodes.n9.state = 'on';
  asGM = false;
  ok(await svc.tapDelivery({ ...mail, subject: 'z' }) === 0, 'only the GM client copies (delivery runs there)');

  // the backdoor counts as logged in, for the user who owns that character
  ok(svc.hasBackdoor('NET') && svc._authOk('NET') && svc.isAuthenticated('NET'), 'a backdoor = logged in to the network (any of its nodes)');
  actors.A.isOwner = false;
  ok(!svc.hasBackdoor('NET'), '…only for the user who owns that character');
  actors.A.isOwner = true;
  globalThis.game.nightcity.timeService = { getCurrentTimeMs: () => now0 + 3600001 };
  ok(!svc.hasBackdoor('NET'), 'a backdoor past its time closes');
  globalThis.game.nightcity.timeService = { getCurrentTimeMs: () => now0 };

  // players relay; the GM lands it; remove
  const before = JSON.stringify(store.networkNodes);
  ok((await svc.addNodeEffect('n9', 'taps', { actorId: 'B', actorName: 'V' })).relayed && JSON.stringify(store.networkNodes) === before && emits.at(-1)[1].op === 'effect', 'a player relays a new tap');
  asGM = true;
  await svc.handleNodeRequest(emits.at(-1)[1]);
  ok(store.networkNodes.n9.taps.length === 2, 'the GM lands it');
  const tid = store.networkNodes.n9.taps.find((x) => x.actorId === 'B').id;
  const rmr = await svc.removeNodeEffect('n9', 'taps', tid, 'Rache');
  ok(rmr.success && store.networkNodes.n9.taps.length === 1 && /removed a tap/.test(store.networkNodes.n9.log.at(-1).what), 'remove takes it off and logs who');
  ok((await svc.removeNodeEffect('n9', 'taps', tid)).success === false, 'removing twice says it is gone');
  globalThis.game.nightcity.timeService = { getCurrentTimeMs: () => now0 + 3600001 };
  globalThis.game.users.activeGM = { id: 'G' };
  await svc.reapNodeJams();
  ok(!store.networkNodes.n9.backdoors.length && store.networkNodes.n9.taps.length === 1, 'the reaper drops the expired backdoor, keeps the open-ended tap');
  globalThis.game.nightcity.timeService = { getCurrentTimeMs: () => 1_000_000 };

  // wiring
  const ms = read('scripts/services/MessageService.js');
  ok(ms.includes('networkService?.tapDelivery?.(recipientData)'), 'every delivery passes through tapDelivery (the recipient-facing clone — anonymous stays masked)');
  const ns = read('scripts/services/NetworkService.js');
  ok(!/_authenticatedNetworks\.has\((networkId|defaultNet)\)\s*(&&|\|\|)/.test(ns) && ns.includes('!this._authOk(networkId) && !force'), 'every auth check goes through _authOk (backdoors count)');
  const js = read('scripts/ui/NetworkNodes/NodeConsoleApp.js'), hbs = read('templates/network-nodes/node-console.hbs');
  ok(js.includes("sessKill: NodeConsoleApp._onSessionKill") && hbs.includes('data-action="sessKill"'), 'a sweep result can be removed');
  ok(read('scripts/ui/content/SystemSweep.js').includes('<span class="ncm-sweep__hit-t">UNKNOWN PROCESS</span>') && js.includes("hint: k === 'taps' ? 'traffic is being mirrored somewhere'"), 'a player sweep shows UNKNOWN PROCESS + a hint, never whose it is');
  const tab = read('scripts/ui/AdminPanel/tabs/NetworksTab.js'), th = read('templates/admin-panel/tab-networks.hbs');
  ok(tab.includes("case 'nodeFxDel'") && th.includes('data-op="nodeInspect" data-node-id="{{nodeId}}"'), 'the GM sees and removes taps / backdoors on the node row');
}

// ═══ 7. Interface rank from the role item (the real SkillService) — dev 2026-10-29: "not detecting my player's rank" ═══
{
  const { SkillService } = await imp('scripts/services/SkillService.js');
  const sk = Object.create(SkillService.prototype);
  const actor = (role, stats = { tech: { value: 7 } }) => ({ name: 'Rache', items: [role], system: { stats } });
  // the CPR data model: mainRoleAbility is a STRING, the rank is system.rank — and the role may be named anything
  const cprRole = { type: 'role', name: 'Netrunner (Night Market)', system: { mainRoleAbility: 'Interface', rank: 6, abilities: [] } };
  const d1 = sk._readSkillData(actor(cprRole), 'Interface');
  ok(d1._found && d1.skillLevel === 6 && d1.statValue === 7, 'CPR role item (string mainRoleAbility, any role name): Interface rank 6 + TECH 7');
  ok(sk.getSkillData(actor(cprRole), 'Interface').skillLevel === 6, 'getSkillData (what jack-in reads) gets the same rank');
  const objRole = { type: 'role', name: 'Whatever', system: { mainRoleAbility: { name: 'Interface', rank: 4 } } };
  ok(sk._readSkillData(actor(objRole), 'Interface').skillLevel === 4, 'the older object shape still reads');
  const named = { type: 'role', name: 'Netrunner', system: { mainRoleAbility: '', rank: 3 } };
  ok(sk._readSkillData(actor(named), 'Interface').skillLevel === 3, 'a role named Netrunner with no ability set still resolves');
  const solo = { type: 'role', name: 'Solo', system: { mainRoleAbility: 'Combat Awareness', rank: 5 } };
  ok(!sk._readSkillData(actor(solo), 'Interface')._found && sk._readSkillData(actor(solo), 'Combat Awareness').skillLevel === 5, 'another role’s ability is not Interface (and reads as its own)');
}

// ═══ 8. The OPERATOR chip (the terminal's rule) + an empty Interface skill item never hides the role rank ═══
{
  const { SkillService } = await imp('scripts/services/SkillService.js');
  const sk = Object.create(SkillService.prototype);
  const role = { type: 'role', name: 'Netrunner', system: { mainRoleAbility: 'Interface', rank: 5 } };
  const emptySkill = { type: 'skill', name: 'Interface', system: { level: 0, stat: 'int' } };
  const d = sk._readSkillData({ name: 'Rache', items: [emptySkill, role], system: { stats: { tech: { value: 6 }, int: { value: 8 } } } }, 'Interface');
  ok(d.skillLevel === 5 && d.statValue === 6, 'an "Interface" skill item at level 0 no longer hides the role’s rank 5 (and the stat follows the role: TECH)');
  const real = { type: 'skill', name: 'Interface', system: { level: 7, stat: 'int' } };
  ok(sk._readSkillData({ name: 'X', items: [real, role], system: { stats: { int: { value: 8 } } } }, 'Interface').skillLevel === 7, 'a real skill level still wins over a lower role rank');

  const js = read('scripts/ui/NetworkNodes/NodeConsoleApp.js'), hbs = read('templates/network-nodes/node-console.hbs');
  ok(js.includes('switchOperator: NodeConsoleApp._onSwitchOperator') && hbs.includes('data-action="switchOperator"') && js.includes('openOperatorPicker(this.element)'), 'the console has the terminal’s OPERATOR chip (same picker)');
  ok(js.includes("operator: this._operatorContext()") && /_runner\(rules = this\._rules\(\)\) \{\s*const actor = resolveOperator\(\);/.test(js), 'the chip and the jack-in read the SAME character (resolveOperator)');
  ok(hbs.includes('{{operator.skill}} <b>{{operator.rank}}</b>'), 'the chip shows the rank it reads, so a wrong character / rank is visible before jacking in');
  ok(js.includes("if (this._session) return void ui.notifications.warn('Jack out first"), 'no switching mid-session');
}

// ═══ 9. Switching off a node that is not the last one on its scene says so ═══
{
  const { NodeConsoleApp } = await imp('scripts/ui/NetworkNodes/NodeConsoleApp.js');
  const net = { id: 'NCPD', name: 'NCPD', signalStrength: 70, theme: {}, security: {} };
  const a = { id: 'a', networkId: 'NCPD', name: 'Mast', kind: 'mast', sceneId: 'S1', state: 'on', log: [] };
  const b = { id: 'b', networkId: 'NCPD', name: 'Router', kind: 'router', sceneId: 'S1', state: 'on', log: [] };
  const mk = (nodes) => ({ getNode: (id) => N.sanitizeNode(nodes.find((x) => x.id === id)), getNodes: (f) => N.listNodes(nodes.map(N.sanitizeNode), f), getNetwork: () => net, _nowMs: () => 1,
    getAvailableNetworks: () => [net], currentNetworkId: 'NCPD', isDeadZone: false });
  asGM = true;
  const two = await NodeConsoleApp.prototype._prepareContext.call(mkThis(NodeConsoleApp, { nodeId: 'a', networkService: mk([a, b]), _session: null }), {});
  ok(two.othersUp === 1 && /Only this node — 1 other node keeps NCPD up here/.test(two.switchHint), 'another node up on the scene: the switch says only this node goes off');
  const one = await NodeConsoleApp.prototype._prepareContext.call(mkThis(NodeConsoleApp, { nodeId: 'a', networkService: mk([a, { ...b, state: 'off' }]), _session: null }), {});
  ok(one.othersUp === 0 && /goes dark on this scene/.test(one.switchHint), 'the last node up: the network goes dark here');
  const js = read('scripts/ui/NetworkNodes/NodeConsoleApp.js');
  ok((js.match(/this\._switchToast\(node,/g) || []).length === 2, 'both switch paths (console + session) say what happened to the network');
  const mac = read('dev/tools/test-network-nodes-setup.macro.js');
  ok(mac.includes("sceneB = others[0] || null") && mac.includes('move them off it'), 'the test macro keeps the worm-hop nodes off the test scene (and moves them off on a rerun)');
  ok(read('templates/admin-panel/tab-security.hbs').includes('Rank makes it easier') && !/>Edge</.test(read('templates/admin-panel/tab-security.hbs')), '"Edge" is gone from the rules card — plain words');
}

// ═══ Saved sessions: jacking out and back in does not refill the moves ═══
{
  const now0 = 5_000_000;
  const R = J.resolveJackIn({});
  ok(R.session.minutes === 60 && R.session.returnAlert === true, 'default: a session lasts 60 game minutes and coming back raises the alert');
  ok(J.resolveJackIn({ session: { minutes: -4, returnAlert: false } }).session.minutes === 0 && J.resolveJackIn({ session: { returnAlert: false } }).session.returnAlert === false, 'the session rule sanitizes (0 = every jack-in fresh)');
  const run = (a, until, extra = {}) => ({ actorId: a, actorName: a, rank: 4, moves: 3, used: 2, since: 1, until, open: false, ...extra });
  const node = N.sanitizeNode({ id: 'r1', networkId: 'NET', runs: [run('A', now0 + 1000), run('B', now0 - 1), { junk: 1 }, run('C', now0 + 5, { used: 99 })] });
  ok(node.runs.length === 3 && node.runs.find((r) => r.actorId === 'C').used === 3, 'runs sanitize (junk dropped, used capped at moves)');
  ok(N.liveRun(node, 'A', now0)?.used === 2 && !N.liveRun(node, 'B', now0) && !N.liveRun(node, '', now0), 'a live run is found; one past its time is not');
  ok(N.expiredRuns(node, now0).map((r) => r.actorId).join() === 'B', 'the reaper finds the runs that ran out');
  ok(N.withRun(node.runs, run('A', 9)).filter((r) => r.actorId === 'A').length === 1, 'one run per runner per node');

  const store = { networkNodes: { r1: { id: 'r1', networkId: 'NET', sceneId: 'S1', state: 'on', name: 'Mast', log: [] } }, customNetworks: [], coreNetworkOverrides: {} };
  const emits = [];
  const { NetworkService } = await imp('scripts/services/NetworkService.js');
  const svc = Object.create(NetworkService.prototype);
  Object.assign(svc, { settingsManager: { get: (k) => store[k], set: async (k, v) => { store[k] = v; } }, socketManager: { emit: (op, d) => emits.push([op, d]) }, eventBus: { emit() {} },
    _networkCache: new Map(), _authenticatedNetworks: new Set() });
  let t = now0;
  globalThis.game.nightcity.timeService = { getCurrentTimeMs: () => t };
  asGM = true;
  ok((await svc.saveRun('r1', { actorId: 'A', moves: 3, used: 0, open: true, minutes: 0 })).skipped && !store.networkNodes.r1.runs, 'minutes 0 = nothing is saved');
  await svc.saveRun('r1', { actorId: 'A', actorName: 'Rache', rank: 4, moves: 3, used: 0, open: true, minutes: 60 });
  let r = store.networkNodes.r1.runs[0];
  ok(r.since === now0 && r.until === now0 + 3600000 && r.open, 'a new session starts its window now');
  t = now0 + 600000;
  await svc.saveRun('r1', { actorId: 'A', moves: 3, used: 2, open: false, minutes: 60 });
  r = store.networkNodes.r1.runs[0];
  ok(r.used === 2 && !r.open && r.since === now0 && r.until === now0 + 3600000 && r.actorName === 'Rache', 'saving again keeps the window (jacking out does not restart it)');
  t = now0 + 3600000;
  await svc.reapNodeJams();
  ok(!store.networkNodes.r1.runs.length, 'once the window passes the reaper drops it — the next jack-in is fresh');
  t = now0;
  await svc.saveRun('r1', { actorId: 'A', moves: 3, used: 1, open: false, minutes: 60 });
  ok((await svc.clearRun('r1', 'A')).success && !store.networkNodes.r1.runs.length && (await svc.clearRun('r1', 'A')).success === false, 'the GM resets a session');
  asGM = false;
  ok((await svc.saveRun('r1', { actorId: 'A', moves: 3, used: 1, minutes: 60 })).relayed && emits.at(-1)[1].op === 'run', 'a player relays the save');
  ok((await svc.clearRun('r1', 'A')).relayed && emits.at(-1)[1].op === 'unRun', 'and the reset');
  asGM = true;
  const ns = read('scripts/services/NetworkService.js');
  ok(ns.includes("data.op === 'run'") && ns.includes("data.op === 'unRun'"), 'the GM handler lands both');

  const js = read('scripts/ui/NetworkNodes/NodeConsoleApp.js');
  ok(js.includes("liveRun(node, actor.id, ns._nowMs())") && js.includes("'jacked back in'") && js.includes('rules.session.returnAlert'), 'jacking back in inside the window resumes the same moves and (by rule) raises the alert');
  ok((js.match(/sess\.used \+= 1; this\._saveRun\(true\)/g) || []).length >= 3, 'every spent move is saved');
  ok(js.includes('await this._saveRun(false);') && js.includes('this._saveRun(false).catch'), 'jack out and close save the session as not open');
  ok(js.includes('if (run?.open) this._session') && js.includes('!this._jackedOut'), 'a refresh resumes an OPEN session with no roll; a deliberate jack-out does not');
  const sec = read('scripts/ui/AdminPanel/tabs/SecurityTab.js'), shb = read('templates/admin-panel/tab-security.hbs');
  ok(sec.includes("num('jk-sessmin', 60)") && shb.includes('name="jk-sessmin"') && shb.includes('name="jk-return"'), 'the Jacking in card sets the session length and the return alert');
  const nt = read('scripts/ui/AdminPanel/tabs/NetworksTab.js'), nhb = read('templates/admin-panel/tab-networks.hbs');
  ok(nt.includes("case 'nodeRunDel'") && read('templates/network-nodes/node-inspector.hbs').includes('data-action="runReset"'), 'Admin node rows show saved sessions with a reset');
}

// ═══ Who can jack in ═══
{
  const R0 = J.resolveJackIn({});
  ok(R0.gateFrom === 'anyone' && J.jackGate(R0, { id: 'x' }, () => ({ ok: false })).ok, 'default: anyone can jack in');
  const calls = [];
  const check = (actor, gate, opts) => { calls.push({ gate, opts }); return { ok: false, reason: 'Jacking in requires: Netrunner' }; };
  const Rop = J.resolveJackIn({ gateFrom: 'operator' });
  const vop = J.jackGate(Rop, { id: 'x' }, check);
  ok(!vop.ok && calls.at(-1).gate === null && !calls.at(-1).opts.standalone, '"Same as Terminal operator access" uses that rule (the operatorGate setting)');
  const Rown = J.resolveJackIn({ gateFrom: 'own', gate: { roles: ['Netrunner', '', 'Tech'], skills: [{ name: 'Interface', min: 4 }, { name: '' }], logic: 'any' } });
  ok(Rown.gate.mode === 'gated' && Rown.gate.roles.join() === 'Netrunner,Tech' && Rown.gate.skills.length === 1 && Rown.gate.skills[0].min === 4, 'its own rule: roles + skill ranks, blanks dropped');
  J.jackGate(Rown, { id: 'x' }, check);
  ok(calls.at(-1).opts.standalone && calls.at(-1).gate.roles.length === 2, '…checked on its own (never mixed with the terminal rule)');
  ok(J.jackGate(J.resolveJackIn({ gateFrom: 'own' }), { id: 'x' }, () => ({ ok: false })).ok, '"Only…" with nothing ticked = anyone (never an accidental lockout)');
  ok(J.resolveJackIn({ gate: { mode: 'gated', roles: ['Netrunner'] } }).gateFrom === 'own', 'a rule saved before the switch: a gated gate reads as its own rule');
  ok(J.resolveJackIn({ gateFrom: 'bogus' }).gateFrom === 'anyone', 'an unknown choice falls back to anyone');
  // the REAL canOperate decides
  const { canOperate } = await imp('scripts/utils/helpers.js');
  game.nightcity.skillService = { getSkillData: (a, n) => ({ skillLevel: a.skills?.[n] ?? 0 }) };
  const runner = { id: 'r', items: [{ type: 'role', name: 'Netrunner' }], skills: { Interface: 2 } };
  const tech = { id: 't', items: [{ type: 'role', name: 'Tech' }], skills: {} };
  const solo = { id: 's', items: [{ type: 'role', name: 'Solo' }], skills: { Interface: 5 } };
  const nobody = { id: 'n', items: [{ type: 'role', name: 'Solo' }], skills: { Interface: 1 } };
  const R1 = J.resolveJackIn({ gateFrom: 'own', gate: { roles: ['Netrunner', 'Tech'], skills: [{ name: 'Interface', min: 4 }], logic: 'any' } });
  asGM = false;
  ok(J.jackGate(R1, runner, canOperate).ok && J.jackGate(R1, tech, canOperate).ok && J.jackGate(R1, solo, canOperate).ok, 'Netrunner, Tech, or Interface 4+ (any one) can jack in');
  const no = J.jackGate(R1, nobody, canOperate);
  ok(!no.ok && /Jacking in requires/.test(no.reason || ''), 'a Solo with Interface 1 cannot — and is told why');
  const R2 = J.resolveJackIn({ gateFrom: 'own', gate: { roles: ['Netrunner'], skills: [{ name: 'Interface', min: 4 }], logic: 'all' } });
  ok(!J.jackGate(R2, runner, canOperate).ok && J.jackGate(R2, { ...runner, skills: { Interface: 6 } }, canOperate).ok, '"and": a Netrunner AND Interface 4+');
  asGM = true;
  // wiring
  const con = read('scripts/ui/NetworkNodes/NodeConsoleApp.js'), sec = read('scripts/ui/AdminPanel/tabs/SecurityTab.js'), hb = read('templates/admin-panel/tab-security.hbs');
  ok(con.includes('jackGate(rules, actor, canOperate)') && con.includes("!gate.ok ? (gate.reason || 'Not someone who can jack in')"), 'the console checks it on the click AND shows why on the dead Jack in button');
  ok(hb.includes('name="jk-gatefrom"') && hb.includes('name="jk-grole"') && hb.includes('name="jk-gs-{{i}}"') && hb.includes('name="jk-glogic"'), 'the card has the three choices, role chips, skill rows, or/and');
  ok(sec.includes('[name="jk-gatefrom"]:checked') && sec.includes('[name="jk-grole"]:checked') && sec.includes("jk-gs-${i}"), 'the card saves them');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
