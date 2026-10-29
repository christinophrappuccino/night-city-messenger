// Sim: network-node INFECTIONS (step 5, 2026-10-29; dev/design/NETWORK-NODES.md). Drives the REAL rules
// (utils/networkNodes.js), the REAL NetworkService install / clean / recall / collect / tick / tap+sniffer delivery over
// a mocked world, the console's carried-program gathering + "your programs" view, and the authoring wiring (the
// registry's `node` mode, the composer verb list + settings, the CSS that shows them).
//   node dev/tools/sims/test-infections.mjs
import { pathToFileURL, fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const read = (p) => readFileSync(`${ROOT}/${p}`, 'utf8').replace(/\r\n/g, '\n');
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.error('FAIL:', m)); };
const mkThis = (Cls, props) => { const o = Object.create(Cls.prototype); for (const [k, v] of Object.entries(props)) Object.defineProperty(o, k, { value: v, writable: true, configurable: true }); return o; };

let asGM = true, NOW = 10_000_000;
globalThis.game = {
  user: { get isGM() { return asGM; }, id: 'G', name: 'GM' },
  users: Object.assign([], { activeGM: { id: 'G' } }),
  settings: { get: () => undefined },
  scenes: { get: () => null, viewed: { id: 'S1' } },
  actors: { get: (id) => ({ A: { id: 'A', name: 'Rache', items: [] }, B: { id: 'B', name: 'V' } })[id] || null, filter: () => [] },
  i18n: { localize: (s) => s },
  nightcity: { timeService: { getCurrentTimeMs: () => NOW } },
};
globalThis.ui = { notifications: { warn() {}, info() {}, error() {} } };
globalThis.Hooks = { on() {}, once() {}, off() {}, callAll() {} };
globalThis.foundry = { utils: { deepClone: (x) => JSON.parse(JSON.stringify(x)), mergeObject: (a, b) => ({ ...a, ...b }), randomID: (() => { let i = 0; return () => `r${++i}`; })() },
  applications: { api: { HandlebarsApplicationMixin: (B) => B, ApplicationV2: class {} }, instances: new Map() } };
globalThis.window = { matchMedia: () => ({ matches: true }) };

const N = await imp('scripts/utils/networkNodes.js');
const H = 3600000;

// ═══ 1. The rules ═══
{
  ok(N.nodeProgramKind('nodeWorm') === 'worm' && N.nodeProgramKind('nodeSniffer') === 'sniffer' && N.nodeProgramKind('keylog') === null && N.nodeProgramKind('nodeNope') === null, 'registry key → infection kind');
  const clean = N.makeInfection('worm', { id: 'i1', name: 'GHOST', actorId: 'A', actorName: 'Rache', now: 0, quality: 80, stealthDV: 16, params: { every: 3, maxNodes: 4, carry: 'bomb' } });
  ok(clean.family === 'i1' && clean.nextAt === 3 * H && !clean.sloppy && clean.carry === 'bomb' && clean.maxNodes === 4, 'a clean worm: its own family, next hop after "every", carries a bomb');
  const sloppy = N.makeInfection('worm', { id: 'i2', now: 0, quality: 30, params: { every: 3 } });
  ok(sloppy.sloppy && sloppy.every === 6 && sloppy.nextAt === 6 * H, 'a sloppy worm spreads half as fast');
  ok(N.makeInfection('worm', { id: 'i3', now: 0, params: { carry: 'worm' } }).carry === '' && N.makeInfection('worm', { id: 'i4', now: 0, params: { carry: 'patch' } }).carry === '', 'a worm cannot carry a worm or a patch');
  ok(N.makeInfection('bomb', { id: 'b', now: 100, params: { delay: 2 } }).fireAt === 100 + 2 * H, 'a bomb fires after its delay');
  ok(N.sanitizeInfections([{ id: 'x', kind: 'nope' }, { id: 'y', kind: 'tap' }, null]).length === 1, 'unknown kinds are dropped');

  const all = [
    { id: 'a', networkId: 'NET', sceneId: 'S1', infections: [clean] },
    { id: 'b', networkId: 'NET', sceneId: 'S1', infections: [] },
    { id: 'c', networkId: 'NET', sceneId: 'S2', infections: [] },
    { id: 'z', networkId: 'OTHER', sceneId: 'S3', infections: [] },
  ].map(N.sanitizeNode);
  ok(N.wormTarget(all, all[0], clean).id === 'c', 'a worm spreads to another scene first, same network only');
  all[2].infections = [{ ...clean, id: 'i1b' }];
  ok(N.wormTarget(all, all[0], clean).id === 'b', '…then the same scene');
  ok(N.wormTarget(all, all[0], { ...clean, maxNodes: 2 }) === null, 'a worm at its limit stops');
  ok(N.familyNodes(all, 'i1').map((n) => n.id).join() === 'a,c', 'family nodes');

  const node = N.sanitizeNode({ id: 'n', infections: [N.makeInfection('tap', { id: 't', actorId: 'A', stealthDV: 18, now: 0 }), N.makeInfection('tap', { id: 'u', actorId: 'B', stealthDV: 10, now: 0 })] });
  ok(N.sweepFinds(node, 12).map((x) => x.id).join() === 'u' && N.sweepFinds(node, 20).length === 2, 'a sweep finds what its total beats (a clean insert hides better)');
  ok(N.sweepFinds(node, 20, { actorId: 'A' }).map((x) => x.id).join() === 'u' && N.sweepFinds(node, 0, { force: true }).length === 2, 'never your own; force (GM) = all');
  ok(N.symptomLines(node).length === 2 && !N.symptomLines(node).join(' ').includes('Tap') && N.symptomLines({ infections: [] }).length === 0, 'symptoms: a glitch, never the program’s name');
  ok(N.tickerLines(node, {}, { symptoms: true }).some((l) => /checksum/.test(l)) && !N.tickerLines(node, {}, { symptoms: false }).some((l) => /checksum/.test(l)), 'the ticker shows symptoms only when the rules say so');
}

// ═══ 2. The REAL service ═══
const store = { customNetworks: [], coreNetworkOverrides: {}, networkNodes: {
  n1: { id: 'n1', networkId: 'NET', sceneId: 'S1', name: 'Mast', state: 'on', log: [] },
  n2: { id: 'n2', networkId: 'NET', sceneId: 'S2', name: 'Router', state: 'on', log: [] },
  n3: { id: 'n3', networkId: 'NET', sceneId: 'S3', name: 'Junction', state: 'on', log: [] },
} };
const made = [], emits = [];
globalThis.game.nightcity.messageRepository = { createMessage: async (to, d) => { made.push([to, d]); return { success: true }; } };
const { NetworkService } = await imp('scripts/services/NetworkService.js');
const svc = Object.create(NetworkService.prototype);
Object.assign(svc, { settingsManager: { get: (k) => store[k], set: async (k, v) => { store[k] = v; } }, socketManager: { emit: (op, d) => emits.push([op, d]) }, eventBus: { emit() {} }, _networkCache: new Map(), _authenticatedNetworks: new Set() });
const prog = (extra = {}) => ({ name: 'GHOST', actorId: 'A', actorName: 'Rache', quality: 80, stealthDV: 16, ...extra });
{
  const r = await svc.insertProgram('n1', 'worm', prog({ params: { every: 1, maxNodes: 3, carry: 'bomb', delay: 10 } }));
  const n1 = store.networkNodes.n1.infections;
  ok(r.success && n1.length === 2 && n1[0].kind === 'worm' && n1[1].kind === 'bomb' && n1[1].family === n1[0].id, 'a worm carrying a bomb: both land, one family');
  // spread
  NOW += 1 * H + 1;
  let t = await svc.tickInfections();
  ok(t.spread === 1 && store.networkNodes.n2.infections.length === 2 && store.networkNodes.n2.infections.some((x) => x.kind === 'bomb'), 'the worm hops (other scene first) and takes its bomb');
  NOW += 1 * H + 1;
  t = await svc.tickInfections();
  ok(store.networkNodes.n3.infections.length === 2 && t.spread >= 1, 'it keeps spreading');
  NOW += 1 * H + 1;
  t = await svc.tickInfections();
  ok(t.spread === 0 && N.familyNodes(Object.values(store.networkNodes).map(N.sanitizeNode), n1[0].family).length === 3, 'at its limit (3) it stops');
  // the bomb (10 h after insert) goes off
  NOW += 10 * H;
  t = await svc.tickInfections();
  const states = Object.values(store.networkNodes).map((n) => n.state);
  ok(states.every((s) => s === 'off') && Object.values(store.networkNodes).every((n) => !(n.infections || []).some((x) => x.kind === 'bomb')), 'the bomb: every node the family reached goes dark, and the bombs are spent');
  ok(store.networkNodes.n1.log.some((l) => /BLACKOUT/.test(l.what)), 'it says so in each node log');
  for (const n of Object.values(store.networkNodes)) n.state = 'on';
  // clean one node: the worm goes from THAT node only
  const w2 = store.networkNodes.n2.infections.find((x) => x.kind === 'worm');
  await svc.cleanInfection('n2', w2.id, 'V');
  ok(!store.networkNodes.n2.infections.length && store.networkNodes.n1.infections.length && /cleaned a worm/.test(store.networkNodes.n2.log.at(-1).what), 'cleaning one node cleans one node (and logs who)');
  ok((await svc.cleanInfection('n2', w2.id)).success === false, 'cleaning twice says it is gone');
  // recall
  const r2 = await svc.recallFamily(store.networkNodes.n1.infections[0].family, 'A');
  ok(r2.success && r2.nodes === 2 && Object.values(store.networkNodes).every((n) => !(n.infections || []).length), 'the planter recalls it from every node');
  // patch
  await svc.insertProgram('n1', 'tap', prog());
  await svc.insertProgram('n1', 'sniffer', prog({ params: { cap: 2 } }));
  const p = await svc.insertProgram('n1', 'patch', prog({ actorId: 'B', actorName: 'V' }));
  ok(p.cleaned === 2 && !store.networkNodes.n1.infections.length && /patched/.test(store.networkNodes.n1.log.at(-1).what), 'Patch cleans every infection on the node');
}
{
  // tap + sniffer infections ride the delivery hook
  await svc.insertProgram('n1', 'tap', prog({ quality: 30 }));       // sloppy tap
  await svc.insertProgram('n2', 'sniffer', prog({ params: { cap: 2 } }));
  made.length = 0;
  const mail = (k, sc) => ({ messageId: `m${k}`, network: 'NET', sentFromScene: sc, subject: `S${k}`, from: 'x@y', fromActorId: 'R', toActorId: 'B', body: '<p>secret</p>', timestamp: `T${k}` });
  await svc.tapDelivery(mail(1, 'S1'));
  ok(made.length === 1 && made[0][0] === 'A' && /garbled/.test(made[0][1].body) && made[0][1].subject === 'S1', 'a SLOPPY tap infection catches the subject line only');
  await svc.tapDelivery(mail(2, 'S2')); await svc.tapDelivery(mail(3, 'S2'));
  ok(made.length === 1, 'the tap on S1 does not hear mail sent on S2');
  const sn = store.networkNodes.n2.infections.find((x) => x.kind === 'sniffer');
  ok(sn.loot.length === 2 && sn.loot.at(-1).subject === 'S3', 'the sniffer records, keeping its cap (newest)');
  await svc.tapDelivery(mail(3, 'S2'));
  ok(store.networkNodes.n2.infections.find((x) => x.kind === 'sniffer').loot.length === 2, 'the same mail is recorded once');
  made.length = 0;
  ok((await svc.collectSniffer('n2', sn.id, 'B')).success === false, 'only the planter collects');
  const c = await svc.collectSniffer('n2', sn.id, 'A');
  ok(c.collected === 2 && made.every(([to, d]) => to === 'A' && /^SNIFFER · Router/.test(d.metadata.recoveredFrom)) && !store.networkNodes.n2.infections.find((x) => x.kind === 'sniffer').loot.length, 'collect: the catch goes to the planter’s EXFIL folder and the sniffer starts over');
  // players relay every write
  asGM = false;
  const before = JSON.stringify(store.networkNodes);
  for (const [fn, args] of [['insertProgram', ['n1', 'tap', prog()]], ['cleanInfection', ['n1', 'x']], ['recallFamily', ['f', 'A']], ['collectSniffer', ['n2', 'x', 'A']]]) {
    ok((await svc[fn](...args)).relayed, `a player relays ${fn}`);
  }
  ok(JSON.stringify(store.networkNodes) === before && emits.slice(-4).map(([, d]) => d.op).join() === 'infect,clean,recall,collect', '…and writes nothing itself');
  ok((await svc.tickInfections()).spread === 0, 'only the GM ticks');
  asGM = true;
  await svc.handleNodeRequest({ op: 'infect', nodeId: 'n3', kind: 'tap', program: prog({ actorId: 'B' }) });
  ok(store.networkNodes.n3.infections.some((x) => x.actorId === 'B'), 'the GM lands a relayed insert');
}

// ═══ 3. The console: carried programs + your programs here ═══
{
  const { NodeConsoleApp } = await imp('scripts/ui/NetworkNodes/NodeConsoleApp.js');
  const shard = { id: 'sh1', name: "Ghost's go-bag", img: 'x.png' };
  const entries = [
    { messageId: 'e1', subject: 'GHOSTWORM', contentType: 'malware', contentData: { uploadable: true, uploadEffect: 'nodeWorm', uploadDV: 16, uploadParams: { every: 2 } } },
    { messageId: 'e2', subject: 'keylogger', contentType: 'malware', contentData: { uploadable: true, uploadEffect: 'keylog' } },
    { messageId: 'e3', subject: 'not uploadable', contentType: 'malware', contentData: { uploadEffect: 'nodeTap' } },
  ];
  globalThis.game.nightcity.dataShardService = { isDataShard: (i) => i === shard, getShardMessages: () => entries, exportEntry: (s, e) => e };
  const app = mkThis(NodeConsoleApp, { nodeId: 'n1', networkService: svc, _session: null });
  const progs = app._carriedNodePrograms({ items: [shard, { id: 'other' }] });
  ok(progs.length === 1 && progs[0].kind === 'worm' && progs[0].name === 'GHOSTWORM' && progs[0].cd.uploadDV === 16, 'only uploadable NETWORK programs on carried shards are offered');
  // my programs view
  store.networkNodes.n1.infections = [];
  await svc.insertProgram('n1', 'sniffer', prog());
  store.networkNodes.n1.infections[0].loot = [{ subject: 'a' }];
  globalThis.game.actors.get = (id) => ({ A: { id: 'A', name: 'Rache' } })[id] || null;
  const ctx = await NodeConsoleApp.prototype._prepareContext.call(mkThis(NodeConsoleApp, { nodeId: 'n1', networkService: { ...svc, getNode: (id) => svc.getNode(id), getNodes: (f) => svc.getNodes(f), getNetwork: () => ({ name: 'NET', theme: {}, security: {} }), _nowMs: () => NOW, getAvailableNetworks: () => [], currentNetworkId: 'X', isDeadZone: false }, _session: { actorId: 'A', rank: 5, moves: 3, used: 0 } }), {});
  ok(ctx.session.mine.length === 1 && ctx.session.mine[0].canCollect && /1 caught/.test(ctx.session.mine[0].detail), 'your programs here: the sniffer with what it caught, Collect offered');
  ok(ctx.session.actions.some((a) => a.key === 'insert' && a.dvText === 'its own DV'), 'Insert a shard is in the session');
  const js = read('scripts/ui/NetworkNodes/NodeConsoleApp.js'), hbs = read('templates/network-nodes/node-console.hbs');
  ok(js.includes("forgeOutcome(total, dv)") && js.includes("rung === 'rejected'") && js.includes('stealthDVFromQuality(quality, pick.cd.uploadStealthDV)'), 'insert rolls the upload ladder against the program’s DV; quality sets its stealth');
  ok(js.includes("await runUploadConsole({") && js.includes("tag: 'INSERT A SHARD'") && js.includes('delivery: false') && js.includes("await runSecurityConsole({") && js.includes("verdictFor:"), 'insert = the terminal upload: the picker + compile beat, then the verdict console with the ladder');
  const uc = read('scripts/ui/content/UploadConsole.js');
  ok(uc.includes("tag = 'UPLOAD'") && uc.includes("delivery = true") && uc.includes("typeof outcomeFor === 'function'"), 'UploadConsole: node options (tag, no delivery panel, own outcome words) — terminal defaults unchanged');
  ok(js.includes("_flash(kind, label)") && (js.match(/this\._flash\(/g) || []).length >= 8, 'every action that lands flashes (power, jam, tap, backdoor, wipe, insert, fail)');
  ok(hbs.includes('ncm-ndc__cover is-{{state}}') && hbs.includes('ncm-ndc__banner is-{{state}}') && hbs.includes('{{#each statusTags}}') && hbs.includes('has-symptoms') && js.includes('_statusTags(node, now'), 'the console shows its state: covers + banner (jammed / off / damaged), status tags along the top, symptoms');
  ok(js.includes("runSystemSweep({ actor, host:") && js.includes("if (kind === 'inf') await ns.cleanInfection(node.id, fid, who)") && js.includes("stealthDV: x.stealthDV"), 'the sweep is the terminal’s modal over the node: infections hide behind their stealth DV; Defuse cleans');
  const sw = read('scripts/ui/content/SystemSweep.js');
  ok(sw.includes('source = null') && sw.includes('function terminalSource(term, item)') && !sw.includes('term._sweepItem'), 'SystemSweep takes a source; the terminal is the default source');
  for (const a of ['sessRecall', 'sessCollect']) ok(hbs.includes(`data-action="${a}"`) && js.includes(`${a}: NodeConsoleApp._on`), `wired: ${a}`);
}

// ═══ 4. Authoring + admin wiring ═══
{
  const CR = read('scripts/ui/content/ContentRenderers.js');
  for (const k of ['nodeWorm', 'nodeTap', 'nodeBomb', 'nodeSniffer', 'nodePatch']) ok(new RegExp(`${k}:\\s+\\{[^\\n]*modes: \\['node'\\]`).test(CR), `registry: ${k} in mode 'node' only`);
  const comp = read('scripts/ui/ItemInbox/DataShardComposer.js');
  ok(comp.includes("programEffectOptions({ mode: 'node' })") && comp.includes('uploadParams: {') && comp.includes("data.nodeEvery"), 'the composer offers network programs and saves their settings');
  const tpl = read('templates/item-inbox/data-shard-composer.hbs');
  for (const n of ['nodeEvery', 'nodeMax', 'nodeCarry', 'nodeDelay', 'nodeCap']) ok(tpl.includes(`name="${n}"`), `composer field: ${n}`);
  const css = read('styles/components/item-inbox.css');
  ok(css.includes('.ncm-cmp-upl.is-on:has(select[name="uploadEffect"] option[value^="node"]:checked) .ncm-cmp-node'), 'the network fields show only for a network verb (CSS, no re-render)');
  const tab = read('scripts/ui/AdminPanel/tabs/NetworksTab.js'), th = read('templates/admin-panel/tab-networks.hbs');
  ok(tab.includes("case 'nodeInfClean'") && tab.includes("case 'nodeInfRecall'") && read('templates/network-nodes/node-inspector.hbs').includes('data-action="infClean"') && read('templates/network-nodes/node-inspector.hbs').includes('data-action="infRecall"'), 'the GM cleans a node or removes a program everywhere from the node row');
  const ns = read('scripts/services/NetworkService.js');
  ok(ns.includes('this.reapNodeJams().then(() => this.tickInfections())'), 'the GM reaper ticks infections');
  ok(read('templates/admin-panel/tab-security.hbs').includes('name="jk-symptoms"') && read('scripts/ui/AdminPanel/tabs/SecurityTab.js').includes("infection: { symptoms: chk('jk-symptoms') }"), 'the rules card switches symptoms');
}

// ═══ 5. Status tags along the top of the console ═══
{
  const { NodeConsoleApp } = await imp('scripts/ui/NetworkNodes/NodeConsoleApp.js');
  const node = N.sanitizeNode({ id: 'nt', networkId: 'NET', name: 'Mast', state: 'jammed', jammedUntil: NOW + 18 * 60000, alert: 2, security: { requiresAuth: true },
    taps: [{ id: 't1', actorId: 'A', actorName: 'Rache', at: 1, until: 0 }], backdoors: [{ id: 'b1', actorId: 'B', actorName: 'V', at: 1, until: 0 }],
    infections: [N.makeInfection('worm', { id: 'w1', actorId: 'B', actorName: 'V', now: 0, quality: 30 })] });
  const app = (sess = null) => mkThis(NodeConsoleApp, { nodeId: 'nt', networkService: svc, _session: sess, _rules: () => ({ infection: { symptoms: true } }) });
  globalThis.game.settings.get = () => undefined;
  asGM = true;
  const gm = app()._statusTags(node, NOW, { symptoms: false, jamLeft: 18 }).map((t) => t.label);
  ok(gm.join('|') === 'Jammed · 18m|Alert: Alarmed|Box locked|Tapped|Backdoor|Infected', 'GM: state, alert, box, and everything planted (names in the tooltips)');
  const gmTips = app()._statusTags(node, NOW, { symptoms: false, jamLeft: 18 });
  ok(gmTips.find((t) => t.label === 'Infected').tip.includes('Worm — V (sloppy)') && gmTips.find((t) => t.label === 'Tapped').tip === 'For Rache', 'the GM tooltips name who and what');
  asGM = false;
  const pl = app({ actorId: 'A', moves: 3, used: 1, rank: 4 })._statusTags(node, NOW, { symptoms: true, jamLeft: 18 }).map((t) => t.label);
  ok(pl.join('|') === 'Jammed · 18m|Alert: Alarmed|Box locked|Jacked in · 2 moves|Your tap|Unstable', 'player: state, alert, box, their session, THEIR tap, someone else’s worm only as Unstable');
  ok(!pl.some((l) => /Backdoor|Infected|Tapped/.test(l)), 'a player never sees someone else’s backdoor / tap / program by name');
  asGM = true;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
