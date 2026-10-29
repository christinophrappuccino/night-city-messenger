// Admin → Access points — the pure rules, the REAL tab gathering a mocked world, and a REAL Handlebars render.
// node dev/tools/sims/test-access-tab.mjs      (NCM_DUMP=<dir> writes acc-map.html / acc-thing.html for the preview)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const MID = 'night-city-messenger';

// ═══ a mocked world ═══
const flagsDoc = (flags) => ({ getFlag: (s, k) => (s === MID ? flags?.[k] : undefined) });
const mkItem = (id, name, flags, parent = null) => ({ id, name, img: `icons/${id}.svg`, uuid: parent ? `Actor.${parent.id}.Item.${id}` : `Item.${id}`, parent, ...flagsDoc(flags) });
const rache = { id: 'a1', name: 'Rache', hasPlayerOwner: true, items: [] };
const npc = { id: 'a2', name: 'Fixer', hasPlayerOwner: false, items: [] };
const ws = mkItem('ws', 'WS-7F-12', { isTerminal: true });
const kiosk = mkItem('kiosk', 'LOBBY-KIOSK', { isTerminal: true });
const lonely = mkItem('lonely', 'Forgotten box', { isTerminal: true });
const bag = mkItem('bag', "Ghost's go-bag", { isDataShard: true }, rache); rache.items.push(bag);
const drop = mkItem('drop', 'Market drop', { isDataShard: true });
const archive = mkItem('arc', 'copy', { isDataShard: true, shardArchive: { of: 'x' } });
const plain = mkItem('gun', 'Pistol', {});
const worldItems = [ws, kiosk, lonely, drop, archive, plain];
const byUuid = new Map([...worldItems, bag].map(i => [i.uuid, i]));
const coll = (arr) => { const a = [...arr]; a.get = (id) => arr.find(x => x.id === id) || null; a.contents = arr; return a; };
const note = (id, x, y, flags, text = '') => ({ id, x, y, text, uuid: `Scene.s.Note.${id}`, ...flagsDoc(flags) });
const folderA = { id: 'fA', name: 'Arasaka Tower', folder: null };
const s1 = { id: 's1', name: 'Tower 7F', folder: folderA, thumb: 'thumb1.webp', navigation: true, navOrder: 1, dimensions: { sceneX: 100, sceneY: 100, sceneWidth: 2000, sceneHeight: 1000 }, grid: { size: 100 },
  notes: coll([note('n1', 600, 400, { terminalItemId: 'ws', terminalItemUuid: 'Item.ws' }, 'Desk'), note('n2', 1700, 900, { terminalItemId: 'gone', terminalItemUuid: 'Item.gone' }, 'Old desk'), note('n3', 300, 300, {})]) };
const s2 = { id: 's2', name: 'Lobby', folder: folderA, thumb: '', navigation: true, navOrder: 2, dimensions: { sceneX: 0, sceneY: 0, sceneWidth: 1000, sceneHeight: 1000 }, grid: { size: 100 },
  notes: coll([note('n4', 500, 500, { terminalItemId: 'kiosk', terminalItemUuid: 'Item.kiosk' })]) };
const s3 = { id: 's3', name: 'Empty alley', folder: null, thumb: '', navigation: false, navOrder: 9, dimensions: { sceneX: 0, sceneY: 0, sceneWidth: 1000, sceneHeight: 1000 }, grid: { size: 100 }, notes: coll([]) };
const macro = (id, name, access) => ({ id, name, uuid: `Macro.${id}`, isOwner: true, ...flagsDoc({ access }) });
const page = (id, name, html) => ({ id, name, type: 'text', uuid: `JournalEntry.j.JournalEntryPage.${id}`, text: { content: html } });
const users = [{ id: 'gm', name: 'GM', isGM: true, hotbar: { 3: 'm1' } }, { id: 'p1', name: 'Rache', isGM: false, hotbar: { 1: 'm1', 2: 'm2' } }];
globalThis.game = {
  user: { id: 'gm', isGM: true, viewedScene: 's2' },
  users: coll(users),
  items: coll(worldItems),
  actors: coll([rache, npc]),
  scenes: coll([s1, s2, s3]),
  macros: coll([macro('m1', 'WS-7F-12', { kind: 'terminal', id: 'Item.ws' }), macro('m2', 'Dead', { kind: 'shard', id: 'Item.nope' }), { id: 'm3', name: 'Other', ...flagsDoc({}) }]),
  journal: coll([{ id: 'j', name: '7F', pages: coll([page('p1', 'Office', '<p>On @NCM[terminal:Item.ws]{the desk} and @NCM[shard:Item.drop]</p>'), page('p2', 'Img', '')])}]),
  messages: coll([{ id: 'c1', uuid: 'ChatMessage.c1', whisper: ['p1', 'gm'], timestamp: Date.now() - 7200000, ...flagsDoc({ access: { kind: 'shard', id: 'Actor.a1.Item.bag' } }) }]),
  nightcity: {
    terminalService: { getConfig: (it) => ({ terminalName: '', metadata: { org: it.id === 'ws' ? 'Arasaka' : '', location: '' }, scenePin: { range: it.id === 'ws' ? 2 : 0 }, accounts: [] }) },
    dataShardService: { getConfig: () => ({ shardName: '', encrypted: true }) },
  },
  settings: { get: () => ({ mode: 'match' }) },
};
globalThis.fromUuidSync = (u) => byUuid.get(u) || null;
globalThis.Hooks = { on: () => 1, off: () => {} };

const M = await import('../../../scripts/ui/AdminPanel/tabs/accessModel.js');
const { AccessTab } = await import('../../../scripts/ui/AdminPanel/tabs/AccessTab.js');

// ═══ 1. pure rules ═══
const pts = [{ id: 'a', key: 'terminal:x', sceneId: 's', how: 'pin' }, { id: 'b', key: 'terminal:x', how: 'hotbar' }, { id: 'c', key: 'terminal:y', how: 'chat', broken: true }];
const ths = [{ key: 'terminal:x', found: true }, { key: 'terminal:z', found: true }, { key: 'shard:h', found: true, playerHeld: true }, { key: 'terminal:y', found: false }];
const st = M.accessStats(pts, ths);
ok(st.all === 3 && st.map === 1 && st.off === 2 && st.bad === 1, 'stats count points');
ok(st.none === 1, 'not reachable = found things with no way in, a player-held shard counts as reachable, a deleted one is not counted');
ok(M.reachOf({ key: 'terminal:y' }, pts).reachable === false, 'a broken point does not make a thing reachable');
ok(M.shelfShut('a', { index: 0 }) === false && M.shelfShut('b', { index: 1 }) === true && M.shelfShut('b', { index: 1, holds: true }) === false && M.shelfShut('b', { index: 1, forced: true }) === false, 'fold rule: first open, selection/viewed holds, a filter opens all');
ok(M.shelfShut('a', { index: 0, shut: new Set(['a']) }) === true && M.shelfShut('b', { index: 1, open: new Set(['b']) }) === false, "the GM's fold wins");
ok(M.matches('', 'x') && M.matches('TOW', 'tower 7f') && !M.matches('zzz', 'a', null), 'search');

// ═══ 2. the REAL tab gathering the mocked world ═══
const app = { _activeTab: 'access', isPopout: false, id: 'ncm-admin', render() { this.renders = (this.renders || 0) + 1; } };
const tab = new AccessTab(app);
const things = tab._things();
ok(things.length === 5 && !things.some(t => t.name === 'copy' || t.name === 'Pistol'), 'things = terminals + shards, archive copies and plain items skipped');
ok(things.find(t => t.name === "Ghost's go-bag")?.playerHeld === true && things.find(t => t.name === "Ghost's go-bag").holder === 'Rache', 'a shard in a player\'s gear is held');
const scenes = tab._scenes();
const points = tab._points(scenes, things);
const pins = points.filter(p => p.how === 'pin');
ok(pins.length === 3, 'every NCM pin on every scene, plain notes ignored');
const p1 = pins.find(p => p.id === 'pin:s1:n1');
ok(Math.round(p1.x) === 25 && Math.round(p1.y) === 30, 'pin position = % of the scene rectangle (padding removed)');
ok(p1.reach === 2 && p1.ring > 0 && /2 squares/.test(p1.detail), 'reach ring from the terminal\'s scene-pin range');
ok(pins.find(p => p.id === 'pin:s1:n2').broken === true, 'a pin whose terminal is gone is broken');
ok(points.find(p => p.id === 'macro:m1')?.detail.includes('Rache 1') && points.find(p => p.id === 'macro:m1').detail.includes('GM 3'), 'hotbar macro lists whose hotbar slots hold it');
ok(points.find(p => p.id === 'macro:m2')?.broken === true, 'a macro for a deleted shard is broken');
ok(!points.some(p => p.id === 'macro:m3'), 'non-NCM macros ignored');
const links = points.filter(p => p.how === 'journal');
ok(links.length === 2 && links[0].detail === '"the desk"' && links[0].where === '7F › Office', 'journal links found in page text');
const card = points.find(p => p.how === 'chat');
ok(card && /to Rache/.test(card.detail) && /2h ago/.test(card.detail) && card.key === 'shard:Actor.a1.Item.bag', 'chat cards: who it went to + when');
ok(things.some(t => t.found === false && /gone/.test(t.name)), 'a deleted thing a point names shows up as gone');

// ═══ 3. context ═══
const ctx = tab.prepareContext().acc2;
ok(ctx && ctx.isMap && ctx.map.shelves.length >= 1, 'map view context');
ok(ctx.desk?.id === 's2', 'the desk opens on the viewed scene');
ok(ctx.map.shelves.flatMap(f => f.scenes).every(s => s.id !== 's3'), 'scenes with nothing (not viewed) are not listed');
ok(ctx.map.off.length === 5, 'off-map = 2 hotbar macros + 2 journal links + 1 chat card');
ok(ctx.stats.find(s => s.k === 'none').n === 1, 'not reachable: the forgotten box only (the shard in Rache\'s gear is reachable, kiosk + ws have pins, drop has a link)');
tab._stat = 'bad';
const bad = tab.prepareContext().acc2;
ok(bad.map.off.every(p => p.broken) && bad.map.shelves.flatMap(f => f.scenes).flatMap(s => s.points).every(p => p.broken), 'the bad filter narrows every list');
tab._stat = 'none';
await tab.onAct('stat', {}, { dataset: { stat: 'none' } }); // toggles off
ok(tab._stat === 'all', 'clicking the lit stat again clears it');
await tab.onAct('stat', {}, { dataset: { stat: 'none' } });
ok(tab._view === 'thing', '"Not reachable" jumps to By thing');
const tctx = tab.prepareContext().acc2;
ok(tctx.isThing && tctx.byThing.groups.flatMap(g => g.rows).length === 1 && tctx.byThing.groups[0].rows[0].name === 'Forgotten box', 'By thing + not reachable = the forgotten box');
tab._stat = 'all'; tab._q = 'go-bag';
const q = tab.prepareContext().acc2;
ok(q.byThing.groups.flatMap(g => g.rows).length === 1, 'search narrows By thing');
tab._q = ''; tab._group = 'holder';
const hg = tab.prepareContext().acc2;
ok(hg.byThing.groups.map(g => g.name).at(-1) === 'World items' && hg.byThing.groups[0].name === 'Rache', 'group by holder: people first, world items last');
tab._group = 'kind'; tab._thing = 'terminal:Item.ws';
const td = tab.prepareContext().acc2.tdesk;
ok(td && td.wayCount === 3 && td.canMake, 'thing desk: WS has a pin + a macro + a link, and can make more');
tab.openTo('scene:s1'); ok(tab._view === 'map' && tab._scene === 's1', 'openTo scene:');
tab.openTo('shard:Item.drop'); ok(tab._view === 'thing' && tab._thing === 'shard:Item.drop', 'openTo a thing key');

// ═══ 4. wiring ═══
const app2 = read('scripts/ui/AdminPanel/AdminPanelApp.js');
ok(app2.includes('access: new AccessTab(this)') && app2.includes('...this.tabs.access.prepareContext()'), 'tab registered + context spread');
ok(app2.includes("'9': 'access', '0': 'tools'"), 'number keys follow the bar');
const shell = read('templates/admin-panel/admin-panel.hbs');
ok(/data-tab-group="world"[\s\S]*data-tab="access"[\s\S]*data-tab-group="tools"/.test(shell) && shell.includes('tab-access.hbs'), 'nav button in WORLD + the partial included');
ok(read('scripts/utils/constants.js').includes('ADMIN_TAB_ACCESS'), 'template constant (preloaded)');
ok(read('styles/components/admin-panel.css').includes("tab-access.css"), 'stylesheet imported');
ok(read('scripts/ui/AdminPanel/AdminTabWindow.js').includes("access: 'Access points'"), 'pop-out title');
const tpl = read('templates/admin-panel/tab-access.hbs');
const ops = [...tpl.matchAll(/data-op="([a-zA-Z]+)"/g)].map(m => m[1]);
const js = read('scripts/ui/AdminPanel/tabs/AccessTab.js');
for (const op of new Set(ops)) ok(js.includes(`case '${op}'`), `op ${op} handled`);
const opens = (tpl.match(/\{\{~?#(if|unless|each|with)/g) || []).length, closes = (tpl.match(/\{\{~?\/(if|unless|each|with)/g) || []).length;
ok(opens === closes, `template balanced ${opens}/${closes}`);
const css = read('styles/components/admin-panel/tab-access.css');
for (const cls of new Set([...tpl.matchAll(/class="([^"{]+)/g)].flatMap(m => m[1].split(/\s+/)).filter(c => c.startsWith('ncm-acc2')))) ok(css.includes(`.${cls}`), `styled: ${cls}`);
ok(!/#[0-9a-f]{6}/i.test(css.replace(/#fff\b|#000\b/g, '')), 'tokens only');
ok(css.includes('.ncm-acc2 > :not(.ncm-acc2-split) { flex: 0 0 auto; }'), 'only the two columns flex — the stats bar (overflow:hidden) can never be squashed by a long list');

// ═══ 5. REAL Handlebars render ═══
let Handlebars = null;
for (const p of ['C:/Program Files/Foundry Virtual Tabletop/resources/app/package.json', 'C:/Program Files (x86)/Foundry Virtual Tabletop/resources/app/package.json']) {
  if (!fs.existsSync(p)) continue;
  try { Handlebars = createRequire(p)('handlebars'); break; } catch { /* keep looking */ }
}
if (!Handlebars) { fail++; console.error('FAIL: could not load Handlebars — render checks did not run'); }
else {
  const { registerTagHueHelper } = await import(new URL('../../../scripts/utils/tagHue.js', import.meta.url)); registerTagHueHelper(Handlebars);
  Handlebars.registerHelper('eq', (a, b) => String(a) === String(b));
  const render = Handlebars.compile(tpl);
  tab._view = 'map'; tab._stat = 'all'; tab._scene = 's1'; tab._q = '';
  const mapHtml = render({ activeTab: 'access', ...tab.prepareContext() });
  ok(mapHtml.includes('Tower 7F') && mapHtml.includes('data-pt-id="pin:s1:n1"') && mapHtml.includes('class="ring"') && mapHtml.includes('points at a deleted terminal'), 'map render: scene card, numbered pins, reach ring, broken row');
  ok(mapHtml.includes('Off the map') && mapHtml.includes('7F › Office'), 'map render: the off-map shelf');
  tab._view = 'thing'; tab._thing = 'terminal:Item.lonely';
  const thHtml = render({ activeTab: 'access', ...tab.prepareContext() });
  ok(thHtml.includes('not reachable anywhere') && thHtml.includes("in Rache's gear") && thHtml.includes("players can't reach it yet"), 'thing render: not-reachable + held chips, the desk says so');
  ok(!/NaN|undefined|\[object Object\]/.test(mapHtml + thHtml), 'nothing prints NaN / undefined');
  if (process.env.NCM_DUMP) { fs.writeFileSync(path.join(process.env.NCM_DUMP, 'acc-map.html'), mapHtml); fs.writeFileSync(path.join(process.env.NCM_DUMP, 'acc-thing.html'), thHtml); }
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
