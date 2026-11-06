// Sim: the CUSTOM network routine (tester 2026-11-05: "custom malware uploads to terminals, not nodes"). Drives the REAL
// rules (utils/networkNodes.js customFires), the REAL Workshop → entry mapping (ProgramModel), the REAL NetworkService
// insert / jack-in / request checks over a mocked world, and the wiring (registry, console, inspector, workshop).
//   node dev/tools/sims/test-node-custom-routine.mjs
import { pathToFileURL, fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const read = (p) => readFileSync(`${ROOT}/${p}`, 'utf8').replace(/\r\n/g, '\n');
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.error('FAIL:', m)); };
const MID = 'night-city-messenger';
const tick = () => new Promise((r) => setTimeout(r, 0));

let asGM = true, NOW = 10_000_000;
const chats = [], ran = [];
// a shard on Rache (A) holding the program entry the Workshop wrote
const pages = [];
const journal = { id: 'jS', pages: { find: (fn) => pages.find(fn) } };
const shardA = { id: 'sh1', uuid: 'Actor.A.Item.sh1', name: 'Go-bag', parent: { id: 'A' }, getFlag: (s, k) => (k === 'journalId' ? 'jS' : undefined) };
const shardLoose = { id: 'sh2', uuid: 'Item.sh2', name: 'Loose', parent: null, getFlag: (s, k) => (k === 'journalId' ? 'jS' : undefined) };
const macros = { mGM: { id: 'mGM', name: 'Ghostwire', author: { isGM: true }, execute: async (scope) => { ran.push(scope); } },
  mPL: { id: 'mPL', name: 'Sneaky', author: { isGM: false, name: 'Player' }, execute: async (scope) => { ran.push({ bad: true, ...scope }); } } };
globalThis.game = {
  user: { get isGM() { return asGM; }, id: 'G', name: 'GM' },
  users: Object.assign([{ id: 'G', isGM: true }], { activeGM: { id: 'G' }, get: (id) => ({ G: { id: 'G', isGM: true }, P: { id: 'P', isGM: false } })[id] }),
  settings: { get: () => undefined },
  scenes: { get: () => null, viewed: { id: 'S1' } },
  actors: { get: (id) => ({ A: { id: 'A', name: 'Rache', items: [] }, B: { id: 'B', name: 'V', items: [] } })[id] || null, filter: () => [] },
  macros: { get: (id) => macros[id] || null },
  journal: { get: (id) => (id === 'jS' ? journal : null) },
  i18n: { localize: (s) => s },
  nightcity: { timeService: { getCurrentTimeMs: () => NOW } },
};
globalThis.fromUuid = async (u) => ({ 'Actor.A.Item.sh1': shardA, 'Item.sh2': shardLoose })[u] || null;
globalThis.ChatMessage = { create: async (d) => { chats.push(d); return d; } };
globalThis.ui = { notifications: { warn() {}, info() {}, error() {} } };
globalThis.Hooks = { on() {}, once() {}, off() {}, callAll() {} };
globalThis.foundry = { utils: { deepClone: (x) => JSON.parse(JSON.stringify(x)), mergeObject: (a, b) => ({ ...a, ...b }), randomID: (() => { let i = 0; return () => `r${++i}`; })() },
  applications: { api: { HandlebarsApplicationMixin: (B) => B, ApplicationV2: class {} }, instances: new Map() } };
globalThis.window = { matchMedia: () => ({ matches: true }) };

const N = await imp('scripts/utils/networkNodes.js');
const PM = await imp('scripts/ui/content/ProgramModel.js');
const CR = await imp('scripts/ui/content/ContentRenderers.js');

// ═══ 1. The rules ═══
{
  ok(N.nodeProgramKind('nodeCustom') === 'custom' && N.NODE_PROGRAMS.custom, 'nodeCustom → the custom infection kind');
  const mk = (fireOn, actorId = 'A') => N.makeInfection('custom', { id: 'c', actorId, now: 0, description: 'Lights flicker', macroId: 'mGM', params: { fireOn } });
  const ins = mk('insert'), jack = mk('jackIn'), both = mk('both'), junk = mk('whenever');
  ok(ins.fireOn === 'insert' && junk.fireOn === 'insert' && ins.description === 'Lights flicker' && ins.macroId === 'mGM', 'kept: words, macro, when (unknown → on insert)');
  ok(N.customFires(ins, 'insert') && !N.customFires(ins, 'jackIn', 'B'), 'on insert: fires on insert only');
  ok(!N.customFires(jack, 'insert') && N.customFires(jack, 'jackIn', 'B'), 'on jack-in: waits for a jack-in');
  ok(N.customFires(both, 'insert') && N.customFires(both, 'jackIn', 'B'), 'both: both');
  ok(!N.customFires(jack, 'jackIn', 'A') && !N.customFires(jack, 'jackIn', ''), 'never for its own planter, never for no one');
  ok(!N.customFires({ ...jack, jackFiredAt: 5 }, 'jackIn', 'B'), 'a jack-in trigger fires once');
  ok(!N.customFires(N.makeInfection('tap', { id: 't', now: 0 }), 'insert'), 'only custom routines fire');
  ok(N.makeInfection('worm', { id: 'w', now: 0, params: { carry: 'custom' } }).carry === '', 'a worm cannot carry a custom routine');
  ok(!('description' in N.makeInfection('tap', { id: 't', now: 0, description: 'x' })), 'other kinds carry no custom fields');
}

// ═══ 2. The Workshop → shard entry ═══
{
  const e = CR.PROGRAM_EFFECTS.nodeCustom;
  ok(e && e.modes.join() === 'node' && e.host === 'node' && e.group === 'Network' && e.params[0].f === 'fireOn', 'registry: a node-only Network program with a Fires choice');
  ok(PM.abilitiesFor('malware').some((a) => a.key === 'nodeCustom') && PM.isNodeVerb('nodeCustom'), 'the Workshop offers it under malware');
  const prog = { ...PM.defaultProgram('malware'), verb: 'nodeCustom', progName: 'Ghostwire', description: 'Lights flicker', mode: 'macro', macroId: 'mGM', params: { fireOn: 'both' } };
  const entry = PM.programToEntry(prog);
  const cd = entry.contentData;
  ok(cd.uploadEffect === 'nodeCustom' && cd.uploadParams.fireOn === 'both' && cd.effect?.macroId === 'mGM' && cd.description === 'Lights flicker', 'entry: verb, when, macro, words');
  ok(cd.deployable === false && !cd.uploadTrigger, 'nothing to run from the shard; no terminal trigger');
  const back = PM.entryToProgram(entry);
  ok(back.verb === 'nodeCustom' && back.mode === 'macro' && back.macroId === 'mGM' && back.params.fireOn === 'both', 'round-trips for editing');
  ok(/inserted into a network node/.test(PM.programSentence(prog).tail) && /inserted into a network node/.test(PM.programSentence({ ...prog, verb: 'nodeWorm' }).tail), 'readout: a network program says "once inserted", not a terminal trigger');
  const text = PM.programToEntry({ ...prog, mode: 'text' }).contentData;
  ok(!text.effect, 'Describe it: no macro link');
  pages.push({ flags: { [MID]: { messageId: 'e1', contentData: cd } } });
  pages.push({ flags: { [MID]: { messageId: 'e2', contentData: { ...cd, effect: { type: 'nodeCustom', macroId: 'mPL' }, uploadParams: { fireOn: 'insert' } } } } });
  pages.push({ flags: { [MID]: { messageId: 'e3', contentData: { ...cd, uploadEffect: 'nodeTap' } } } });
}

// ═══ 3. The REAL service ═══
const store = { customNetworks: [], coreNetworkOverrides: {}, networkNodes: {
  n1: { id: 'n1', networkId: 'NET', sceneId: 'S1', name: 'Tower relay', state: 'on', log: [] },
} };
const emits = [];
const { NetworkService } = await imp('scripts/services/NetworkService.js');
const svc = Object.create(NetworkService.prototype);
Object.assign(svc, { settingsManager: { get: (k) => store[k], set: async (k, v) => { store[k] = v; } }, socketManager: { emit: (op, d) => emits.push([op, d]) }, eventBus: { emit() {} }, _networkCache: new Map(), _authenticatedNetworks: new Set() });
const prog = (extra = {}) => ({ name: 'spoofed', actorId: 'A', actorName: 'Rache', quality: 80, stealthDV: 14, params: {}, source: { itemUuid: 'Actor.A.Item.sh1', entryId: 'e1' }, ...extra });
const infs = () => store.networkNodes.n1.infections || [];
{
  const r = await svc.insertProgram('n1', 'custom', prog({ description: 'IGNORED', macroId: 'mPL', params: { fireOn: 'insert' } }));
  await tick(); await tick();
  const inf = infs()[0];
  ok(r.success && inf.kind === 'custom' && inf.name === 'Ghostwire' && inf.description === 'Lights flicker' && inf.macroId === 'mGM' && inf.fireOn === 'both', 'insert: words, macro and when come from the shard entry, never the request');
  ok(inf.firedAt === NOW && chats.length === 1 && /Ghostwire/.test(chats[0].content) && /Lights flicker/.test(chats[0].content) && /fired as it was inserted/.test(chats[0].content), 'fires on insert: the GM gets the card');
  ok(chats[0].whisper.join() === 'G', '…whispered to the GMs only');
  ok(ran.length === 1 && ran[0].trigger === 'insert' && ran[0].node.id === 'n1' && ran[0].planter.id === 'A' && !('actor' in ran[0]), 'the GM macro runs with node / infection / planter / runner / trigger (no `actor`)');

  ok((await svc.insertProgram('n1', 'custom', prog({ source: { itemUuid: 'Actor.A.Item.sh1', entryId: 'e3' } }))).success === false, 'an entry that is not a custom network routine is refused');
  ok((await svc.insertProgram('n1', 'custom', prog({ source: { itemUuid: 'Item.sh2', entryId: 'e1' } }))).success === false, 'a shard not on the planter is refused');
  ok((await svc.insertProgram('n1', 'custom', prog({ source: null }))).success === false, 'no source, no routine');

  // jack-in: V comes in, the routine fires once; Rache (its planter) never sets it off
  chats.length = 0; ran.length = 0;
  ok((await svc.noteJackIn('n1', 'A')).fired === 0 && !chats.length, "the planter's own jack-in does nothing");
  const j = await svc.noteJackIn('n1', 'B');
  await tick(); await tick();
  ok(j.fired === 1 && infs()[0].jackFiredAt === NOW && /when V jacked in/.test(chats[0]?.content || '') && ran[0]?.runner?.id === 'B' && ran[0]?.trigger === 'jackIn', 'someone else jacks in: it fires, the runner is passed to the macro');
  ok((await svc.noteJackIn('n1', 'B')).fired === 0, '…once');

  // a player-written macro never runs (runGmMacro)
  chats.length = 0; ran.length = 0;
  await svc.insertProgram('n1', 'custom', prog({ source: { itemUuid: 'Actor.A.Item.sh1', entryId: 'e2' } }));
  await tick(); await tick();
  ok(chats.length === 1 && !ran.length, "a macro a player wrote is not run (the card still comes)");

  // a macro that changes this node while it runs does not deadlock the node queue
  macros.mGM.execute = async () => { await svc.nodeLog('n1', 'macro', 'the lights flicker'); ran.push('logged'); };
  const before = infs().length;
  await Promise.race([svc.insertProgram('n1', 'custom', prog()).then(tick).then(tick).then(tick), new Promise((r) => setTimeout(r, 1500))]);
  await tick(); await tick(); await tick();
  ok(infs().length === before + 1 && ran.includes('logged') && store.networkNodes.n1.log.some((l) => l.what === 'the lights flicker'), "a macro that writes to the node finishes (it runs after the insert's write)");

  // the relay: a player sends which program, not what it does
  asGM = false; emits.length = 0;
  ok((await svc.noteJackIn('n1', 'B')).relayed && emits[0][1].op === 'jackIn', 'a player relays the jack-in');
  asGM = true;
}

// ═══ 4. The request checks (what a player may ask) ═══
{
  const src = read('scripts/services/NetworkService.js');
  ok(/case 'jackIn':[\s\S]{0,400}owns\(data\.actorId\)[\s\S]{0,200}needRun: true/.test(src), "jack-in: only the sender's own character, session checked in the queue");
  ok(/needRun && !liveRun\(node, actorId, this\._nowMs\(\)\)/.test(src), '…noteJackIn needs a live session for a player');
  ok(/data\.kind === 'custom' && !src\) return fail/.test(src) && /source: src/.test(src) && !/program: \{[^}]*description/.test(src.match(/case 'infect':[\s\S]*?case 'jackIn'/)?.[0] || 'description'), 'insert: a custom routine names its entry; its words / macro are not passed on');
  ok(src.includes("'tapDelivery', 'noteJackIn']"), 'noteJackIn runs through the node queue');
  ok(/_afterQueue\(\(\) => this\._fireCustom/.test(src), 'firing waits for the queue');
}

// ═══ 5. Wiring ═══
{
  const con = read('scripts/ui/NetworkNodes/NodeConsoleApp.js');
  ok(con.includes("source: { itemUuid: pick.shard.uuid, entryId: pick.entry.id }") && con.includes('await ns.noteJackIn?.(node.id, actor.id)'), 'the console sends the source on insert, and reports a jack-in');
  // live test 2026-11-06: a shard entry (getShardMessages) carries its id as `id` — `messageId` is the PAGE flag. Every
  // source was built from `e.messageId` (undefined), so the GM could never read the routine — on nodes AND on terminal
  // uploads (a player's custom routine never got its macro). Guard: the entry shape, and no source built from messageId.
  ok(/_pageToShardMessage\(page\) \{[\s\S]{0,300}id: flags\.messageId,/.test(read('scripts/services/DataShardService.js')), 'a shard entry carries its id as `id`');
  const bad = ['scripts/ui/NetworkNodes/NodeConsoleApp.js', 'scripts/ui/Terminal/TerminalViewerApp.js', 'scripts/ui/content/UploadFlow.js', 'scripts/ui/content/SiphonFlow.js']
    .filter((f) => /entryId:\s*[\w.]*\.messageId/.test(read(f)));
  ok(!bad.length, `no program source is built from an entry's messageId (${bad.join(', ')})`);
  const insp = read('scripts/ui/NetworkNodes/NodeInspectorApp.js');
  ok(insp.includes("waits for someone else to jack in") && insp.includes("macro: ${game.macros?.get(i.macroId)?.name || 'missing'}"), 'the inspector says when it fires and which macro');
  const ws = read('scripts/ui/MalwareWorkshop/MalwareWorkshopApp.js');
  ok(ws.includes("S.verb === 'adjudicate' || S.verb === 'nodeCustom'") && ws.includes('<code>runner</code>'), 'the Workshop gives it the Describe it / Run a macro block, with the macro scope named');
  ok(read('scripts/ui/content/SiphonFlow.js').includes('return (await programEntry(source))?.contentData?.effect?.macroId'), "the terminal upload's macro lookup uses the same entry reader");
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
