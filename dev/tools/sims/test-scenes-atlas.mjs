// Sim: Admin → Networks → Scenes as THE ATLAS (2026-10-29; dev-picked from
// dev/mockups/admin-networks-scenes-atlas-mock.html — A as the home, C's transmitter strip as the Paint picker, B as the
// Grid switch). Drives the REAL utils/scenesAtlas.js rules, the real NetworkService.applyScenePrewire, and guards the
// wiring (setting, hook, template, CSS). The tab itself is driven by test-admin-networks.mjs.
//   node dev/tools/sims/test-scenes-atlas.mjs
import { pathToFileURL, fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const read = (p) => readFileSync(`${ROOT}/${p}`, 'utf8').replace(/\r\n/g, '\n');
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.error('FAIL:', m)); };

const A = await imp('scripts/utils/scenesAtlas.js');
const R = (id, extra = {}) => ({ id, name: id, folderKey: null, sort: 0, nets: [], players: [], ...extra });

// ═══ 1. Show / search / sort ═══
{
  ok(A.scenePasses(R('a'), 'unwired') && !A.scenePasses(R('a', { nets: ['x'] }), 'unwired'), 'Not wired: no network');
  ok(!A.scenePasses(R('a', { dead: true }), 'unwired') && A.scenePasses(R('a', { dead: true }), 'dead'), 'a dead zone is never "not wired" — nothing reaches it on purpose');
  ok(A.scenePasses(R('a', { players: [1] }), 'players') && A.scenePasses(R('a', { nav: true }), 'nav') && A.scenePasses(R('a', { imported: true }), 'imported'), 'Players here / On the nav bar / Imported');
  ok(A.scenePasses(R('a'), 'nope'), 'an unknown filter shows everything');
  ok(A.sceneMatches(R('Kabuki Market'), 'kab') && A.sceneMatches(R('Lobby'), 'arasaka', ['Arasaka Tower']) && !A.sceneMatches(R('Lobby'), 'zz', ['X']), 'search: the scene name or any folder on its path');
  const rows = [R('b', { sort: 2, nets: ['x'], modified: 5 }), R('a', { sort: 3, modified: 9 }), R('c', { sort: 1, nets: ['x', 'y'], modified: 1, cur: true })];
  ok(A.sortScenes(rows, 'folder').map((r) => r.id).join() === 'c,b,a', 'folder order = the sidebar sort; the viewed scene leads');
  ok(A.sortScenes(rows, 'az').map((r) => r.id).join() === 'c,a,b' && A.sortScenes(rows, 'recent').map((r) => r.id).join() === 'c,a,b', 'A–Z, recently changed (the viewed scene still first)');
  ok(A.sortScenes(rows.map((r) => ({ ...r, cur: false })), 'wired').map((r) => r.id).join() === 'c,b,a', 'most wired');
  ok(A.sortScenes([R('Floor 10'), R('Floor 9')], 'az').map((r) => r.id).join() === 'Floor 9,Floor 10', 'numbers sort as numbers (Floor 9 before Floor 10)');
  const cts = A.showCounts([R('a'), R('b', { dead: true }), R('c', { nets: ['x'], nav: true })]);
  ok(cts.all === 3 && cts.unwired === 1 && cts.dead === 1 && cts.nav === 1, 'show counts');
}

// ═══ 2. Shelves, folds, the tree ═══
{
  const folders = [
    { key: 'nc', name: 'Night City', depth: 0, path: ['Night City'], parentKey: null },
    { key: 'int', name: 'Interiors', depth: 1, path: ['Night City', 'Interiors'], parentKey: 'nc' },
    { key: 'bad', name: 'Badlands', depth: 0, path: ['Badlands'], parentKey: null },
    { key: 'empty', name: 'Empty', depth: 0, path: ['Empty'], parentKey: null },
  ];
  const rows = [
    R('bar', { folderKey: 'nc', nets: ['ara'] }), R('apt', { folderKey: 'int', dead: true }), R('camp', { folderKey: 'bad' }),
    R('loose', { folderKey: null }), R('ghost', { folderKey: 'deleted-folder' }),
    ...Array.from({ length: 40 }, (_, i) => R(`b${String(i).padStart(2, '0')}`, { folderKey: 'bad' })),
  ];
  const sh = A.buildShelves(rows, folders, { limit: A.SHELF_LIMIT, globalIds: new Set(['citi']) });
  ok(sh.map((s) => s.key).join() === `nc,int,bad,${A.UNFILED}`, 'shelves follow the tree order; an empty folder makes no shelf; unfiled last');
  ok(sh[1].depth === 1 && sh[1].rows[0].id === 'apt', 'a sub-folder is its own shelf, one level in, holding only its own scenes');
  ok(sh.find((s) => s.key === A.UNFILED).ids.join() === 'ghost,loose', 'a scene whose folder is gone lands in Not in a folder');
  const bad = sh.find((s) => s.key === 'bad');
  ok(bad.total === 41 && bad.rows.length === A.SHELF_LIMIT && bad.hidden === 41 - A.SHELF_LIMIT && bad.ids.length === 41, `a big shelf shows ${A.SHELF_LIMIT} then "+N more" (ids still list every scene)`);
  const opened = A.buildShelves(rows, folders, { more: new Set(['bad']) }).find((s) => s.key === 'bad');
  ok(opened.rows.length === 41 && opened.hidden === 0, '+N more opens the whole shelf');
  const picked = A.buildShelves(rows, folders, { selId: 'camp' }).find((s) => s.key === 'bad');
  ok(picked.rows.some((r) => r.id === 'camp'), 'the picked scene is always on its shelf, even past the fold');
  ok(A.buildShelves(rows, folders, { limit: 0 }).find((s) => s.key === 'bad').rows.length === 41, 'limit 0 (the Grid) shows every row');
  const sum = A.shelfSummary([R('a', { nets: ['citi', 'ara'] }), R('b', { dead: true }), R('c', { players: [1, 2] })], new Set(['citi']));
  ok(sum.nets.join() === 'ara' && sum.dead === 1 && sum.unwired === 1 && sum.players === 2, 'a shelf head: its networks (globals left out), dead / not wired / players');
  ok(A.ancestorKeys('int', folders).join() === 'int,nc' && A.ancestorKeys(null, folders).length === 0, 'the viewed scene\'s folder and every folder above it');
  ok([...A.subtreeKeys('nc', folders)].sort().join() === 'int,nc' && A.subtreeKeys(null, folders) === null, 'the Folder picker narrows to a folder and everything under it');
  ok(A.navShelf([R('x', { nav: true, navOrder: 2 }), R('y'), R('z', { nav: true, navOrder: 1 })]).map((r) => r.id).join() === 'z,x', 'the nav shelf: nav-bar scenes in their nav order');

  const shut = new Set(['a']), open = new Set(['b']);
  ok(A.shelfShut('x', { defaultOpen: true }) === false && A.shelfShut('x', {}) === true, 'default: open when the rule says so, else closed');
  ok(A.shelfShut('a', { defaultOpen: true, shut }) === true && A.shelfShut('b', { open }) === false, 'the GM\'s own fold / unfold wins');
  ok(A.shelfShut('a', { shut, forced: true }) === false, 'a search / filter opens everything');
}

// ═══ 3. Paint, coverage, the Grid range ═══
{
  const rows = [R('a', { nets: ['n'] }), R('b'), R('c', { dead: true })];
  const pa = A.shelfPaint(rows, 'n');
  ok(pa.on && pa.ids.join() === 'b', 'Wire all: on for the live scenes missing it (dead zones left alone)');
  const pb = A.shelfPaint([R('a', { nets: ['n'] }), R('b', { nets: ['n'] }), R('c', { dead: true })], 'n');
  ok(!pb.on && pb.ids.join() === 'a,b', 'when every live scene has it, the same button takes it off');
  ok(A.shelfPaint([R('c', { dead: true })], 'n').ids.length === 0, 'a shelf of dead zones has nothing to paint');
  ok(A.coverage(rows, 'n').n === 1 && A.coverage(rows, 'n').of === 3 && A.coverage(rows, 'n').pct === 33, 'coverage of a network');
  ok(A.coverage(rows, 'g', { global: true }).n === 2, 'a global network reaches every scene that is not dead');
  ok(A.coverage([], 'n').pct === 0, 'no scenes, no divide by zero');
  const order = ['s1', 's2', 's3', 's4'];
  ok(A.rangeIds(order, 's1', 's3').join() === 's1,s2,s3' && A.rangeIds(order, 's4', 's2').join() === 's2,s3,s4', 'the shift-click range, either direction');
  ok(A.rangeIds(order, 'gone', 's2').join() === 's2', 'a stale anchor falls back to the clicked row');
}

// ═══ 4. Compendium pre-wiring ═══
{
  ok(JSON.stringify(A.sanitizePrewire({ nets: ['a', 'a', '', 'b'], start: 'zz', dead: 1, junk: 1 })) === JSON.stringify({ nets: ['a', 'b'], start: '', dead: true }), 'sanitize: de-dupe, drop blanks, a start that is not wired is cleared');
  let r = A.togglePrewire(null, 'a');
  ok(r.nets.join() === 'a', 'toggle on');
  r = A.togglePrewire({ nets: ['a'], start: 'a' }, 'a');
  ok(r === null, 'toggling the last network off removes the record');
  ok(A.togglePrewire({ nets: ['a', 'b'], start: 'a' }, 'a').start === '', 'taking off the start network clears the start');
  ok(A.togglePrewire({ nets: ['a'], dead: true }, 'a')?.dead === true, 'a dead-zone record survives losing its networks');
  ok(JSON.stringify(A.prewireFlags({ nets: ['a', 'b'], start: 'b' })) === JSON.stringify({ networkAvailability: { a: true, b: true }, defaultNetwork: 'b' }), 'the flags an import receives');
  ok(A.prewireFlags({ nets: [], dead: false }) === null && A.prewireFlags(undefined) === null, 'nothing to apply → null');
  ok(A.prewireFlags({ dead: true }).deadZone === true, 'a pre-wired dead zone');
  ok(A.sourceUuidOf({ _stats: { compendiumSource: 'Compendium.p.Scene.x' } }) === 'Compendium.p.Scene.x' && A.sourceUuidOf({ flags: { core: { sourceId: 'Compendium.q.Scene.y' } } }) === 'Compendium.q.Scene.y' && A.sourceUuidOf({}) === null, 'the pack uuid an import came from (v12 and older)');
}

// ═══ 5. The real NetworkService.applyScenePrewire ═══
{
  const MOD = 'night-city-messenger';
  const store = { scenePrewire: { 'Compendium.maps.Scene.abc': { nets: ['corp'], start: 'corp' } } };
  globalThis.game = { user: { isGM: true, id: 'G' }, settings: { get: (m, k) => store[k], set: async () => {} }, i18n: { localize: (s) => s } };
  globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
  globalThis.Hooks = { on() {}, once() {}, callAll() {} };
  globalThis.foundry = { utils: { deepClone: (x) => JSON.parse(JSON.stringify(x)), mergeObject: Object.assign, randomID: () => 'r' } };
  let NetworkService = null;
  try { ({ NetworkService } = await imp('scripts/services/NetworkService.js')); } catch (e) { ok(false, `NetworkService imports (${e.message})`); }
  if (NetworkService) {
    const updates = [];
    const scene = (src) => ({ name: 'Imported', _stats: { compendiumSource: src }, update: async (d) => updates.push(d) });
    const applied = await NetworkService.prototype.applyScenePrewire.call({}, scene('Compendium.maps.Scene.abc'));
    ok(applied && JSON.stringify(updates[0]) === JSON.stringify({ [`flags.${MOD}`]: { networkAvailability: { corp: true }, defaultNetwork: 'corp' } }), 'an import from a pre-wired pack scene gets its networks + start');
    ok(await NetworkService.prototype.applyScenePrewire.call({}, scene('Compendium.maps.Scene.other')) === false && updates.length === 1, 'an import with no record is left alone');
    ok(await NetworkService.prototype.applyScenePrewire.call({}, { name: 'Made here', _stats: {} }) === false, 'a scene made in the world is left alone');
    game.user.isGM = false;
    ok(await NetworkService.prototype.applyScenePrewire.call({}, scene('Compendium.maps.Scene.abc')) === false && updates.length === 1, 'a player never writes it');
  }
}

// ═══ 6. Wiring ═══
{
  const sm = read('scripts/core/SettingsManager.js');
  ok(/register\(MODULE_ID, 'scenePrewire', \{[\s\S]{0,300}scope: 'world',[\s\S]{0,60}config: false,[\s\S]{0,40}type: Object/.test(sm), 'the scenePrewire world setting is registered (hidden)');
  const reg = read('scripts/init/registerNetworkSystem.js');
  ok(/Hooks\.on\('createScene', \(scene, _opts, userId\) => \{\s*if \(userId !== game\.user\.id\) return;\s*game\.nightcity\?\.networkService\?\.applyScenePrewire\?\.\(scene\);/.test(reg), 'the createScene hook applies pre-wiring on the importing client only');
  const js = read('scripts/ui/AdminPanel/tabs/NetworksTab.js');
  ok(js.includes("from '../../../utils/scenesAtlas.js'") && read('scripts/services/NetworkService.js').includes("from '../utils/scenesAtlas.js'"), 'one rules module, in utils — the tab and the service both read it (no service → tab import)');
  for (const op of ['scMode', 'scPaint', 'scPaintStop', 'scCard', 'scClose', 'scShelfPaint', 'scBandNet', 'scMore', 'scCell', 'scImport', 'scView', 'scThis', 'scPreRm', 'scPreDead']) {
    ok(js.includes(`case '${op}':`), `op ${op} is handled`);
  }
  ok(!/case 'sceneChip'/.test(js) && !/_sceneChip/.test(js), 'the old chip filter is gone (Show replaced it)');
  ok(/if \(k === this\._scFolder\) return;/.test(js), 'the Folder picker callback ignores the open/close fire (the standing ScopePicker rule)');
  ok(/document\.removeEventListener\('keydown', this\._scKeys, true\)/.test(js), 'the Esc listener is removed on close');
  ok(/importFromCompendium\(pack, id\)/.test(js), 'Import uses the core importer (Foundry stamps the source → the hook applies the pre-wire)');
  const tpl = read('templates/admin-panel/tab-networks.hbs');
  ok(tpl.includes('{{#*inline "ncmNet2Card"}}') && tpl.includes('{{#*inline "ncmNet2Shelf"}}') && tpl.indexOf('ncmNet2Card') < tpl.indexOf("(eq activeTab 'networks')"), 'the card + shelf partials are defined at the top level, before use');
  ok(/data-op="scPaint" data-network-id="\{\{id\}\}" data-sc-tx="\{\{id\}\}"/.test(tpl), 'the transmitter strip is the Paint picker (and the hover preview)');
  ok(/data-op="scMode" data-mode="atlas"/.test(tpl) && /data-op="scMode" data-mode="grid"/.test(tpl), 'Atlas | Grid switch');
  ok(/data-sc-shelf="\{\{key\}\}"/.test(tpl) && /data-sc-fold="\{\{key\}\}"/.test(tpl), 'shelves + grid bands fold DOM-only');
  ok(/data-key="\{\{bandKey\}\}"/.test(tpl) && /data-scene-id="\{\{sceneId\}\}"/.test(tpl), 'grid cells / tallies carry their own ids (no ../ through #if)');
  ok(/@root\.net2\.scenes\.sel\.isPack/.test(tpl), 'the inspector\'s chips reach the selection via @root');
  const block = tpl.slice(tpl.indexOf('SCENES — THE ATLAS'), tpl.indexOf('ACTIVITY LOG'));
  ok(!/\{\{\s*(sub|add|eq|join|lower|upper|truncate)\s*\}\}/.test(block), 'no helper-name fields');
  const css = read('styles/components/admin-panel/tab-networks.css');
  const atlas = css.slice(css.indexOf('Scenes — THE ATLAS'));
  ok(atlas.length > 4000 && !/#[0-9a-f]{3,8}\b/i.test(atlas.replace(/\/\*[\s\S]*?\*\//g, '')), 'Atlas CSS: tokens only');
  ok(/--ncm-bad/.test(atlas) && /--ncm-attn/.test(atlas) && /--ncm-good/.test(atlas) && /var\(--c\)/.test(atlas), 'meaning colours + each network in its own colour');
  ok(/prefers-reduced-motion/.test(atlas), 'reduced motion');
  ok(/\.ncm-net2-atbody\.is-painting \.ncm-net2-atcard\.is-has \.ncm-net2-atcard__ck \{ display: grid; \}/.test(atlas), 'a wired card shows its check while painting');
}

// ── the Paint dock (many networks, 2026-10-29) ──
{
  const tx = Array.from({ length: 20 }, (_, i) => ({ id: 'n' + i, name: 'Net ' + String(i).padStart(2, '0'), n: i, global: i === 19 }));
  const d = A.paintDock(tx, { paint: 'n3', recent: ['n5', 'n3', 'n7'], limit: 6 });
  ok(d.dock.map((t) => t.id).join() === 'n3,n5,n7,n18,n17,n16', 'dock: the painted one, then recent (most recent first, no repeats), then the most widely placed');
  ok(!d.dock.some((t) => t.global) && d.more === 13, 'globals never in the dock; the rest are counted for the picker');
  ok(A.PAINT_DOCK_AT === 8, 'the dock takes over past 8 networks');
  const js2 = read('scripts/ui/AdminPanel/tabs/NetworksTab.js'), tpl2 = read('templates/admin-panel/tab-networks.hbs');
  ok(js2.includes("ScopePicker.on(this.scopeId('paint')") && js2.includes('if (!id || id === this._scPaint) return;') && tpl2.includes('{{{paintPicker}}}') && tpl2.includes('{{#each paintRecent}}') && tpl2.includes('ncm-net2-brush') && !tpl2.includes('ncm-net2-attx'), 'the picker starts painting (ignores the open-fire); the brush bar = the picker + recent swaps, no tile strip');
}

console.log(`\ntest-scenes-atlas: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
