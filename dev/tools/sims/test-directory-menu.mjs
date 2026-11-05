// test-directory-menu — NCM's Items-directory right-click entries go through Foundry's own menu hook (COMPAT-06, v13).
// They used to be <li>s added to #context-menu 80 ms after the right-click. compat.onDirectoryEntryContext registers
// the ONE hook the running version fires (v12 getItemDirectoryEntryContext, jQuery li with data-document-id; v13
// getItemContextOptions, an element with data-entry-id) and hands condition/callback the entry ELEMENT on both.
// Drives the REAL compat helper and the REAL ShardSheetOverride._directoryMenuEntries.
// Run: node dev/tools/sims/test-directory-menu.mjs   (NCM_ROOT=<dir> to check another checkout)
import { readFileSync } from 'fs';
import path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';

const ROOT = path.resolve(process.env.NCM_ROOT || fileURLToPath(new URL('../../../', import.meta.url)));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

// a Hooks with ids, and two kinds of directory entry
const hooks = new Map(); let nextId = 1;
globalThis.Hooks = { on: (e, fn) => { const id = nextId++; (hooks.get(e) || hooks.set(e, new Map()).get(e)).set(id, fn); return id; }, off: (e, id) => hooks.get(e)?.delete(id), once() {}, callAll() {} };
const fire = (e, ...a) => { for (const fn of hooks.get(e)?.values() || []) fn(...a); };
const entryEl = (attr, id) => ({ dataset: attr === 'v13' ? { entryId: id } : { documentId: id }, closest() { return this; }, querySelector: () => null, getBoundingClientRect: () => ({ left: 900, bottom: 300, width: 200, height: 30 }) });
const jq = (el) => ({ 0: el, length: 1, jquery: '3.7' });

const flags = { T1: { isTerminal: true }, S1: { isDataShard: true }, P1: {} };
const item = (id) => ({ id, name: `item ${id}`, getFlag: (_m, k) => flags[id]?.[k] });
const called = [];
globalThis.game = {
  release: { generation: 12 }, user: { isGM: true, id: 'GM' }, settings: { get: () => undefined },
  items: { get: (id) => (flags[id] ? item(id) : null) }, users: { activeGM: { id: 'GM' } }, actors: { get: () => null },
  nightcity: { openTerminal: (it) => called.push(['openTerminal', it?.id]), openDataShard: (it) => called.push(['openDataShard', it?.id]), openMalwareWorkshop: () => called.push(['workshop']) },
};
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
globalThis.foundry = { utils: { deepClone: (o) => structuredClone(o), mergeObject: (a, b) => Object.assign(a, b) } };
globalThis.CONFIG = {};

const compat = await imp('scripts/utils/compat.js');

// ═══ 1. the compat helper, per version ═══
for (const gen of [12, 13]) {
  game.release.generation = gen;
  hooks.clear();
  const reg = compat.onDirectoryEntryContext('Item', () => [
    { name: 'Only T1', icon: '<i></i>', condition: (li) => compat.directoryEntryId(li) === 'T1', callback: (li) => called.push(['cb', compat.directoryEntryId(li)]) },
    { name: 'Always', icon: '<i></i>', condition: true, callback: () => called.push(['always']) },
    { name: 'Throws', icon: '<i></i>', condition: () => { throw new Error('x'); }, callback: () => {} },
  ]);
  const want = gen >= 13 ? 'getItemContextOptions' : 'getItemDirectoryEntryContext';
  ok(reg.event === want && hooks.get(want)?.size === 1, `v${gen}: registers ${want} only`);
  ok(![...hooks.keys()].some((k) => k !== want && hooks.get(k).size), `v${gen}: and no other hook`);
  const options = [{ name: 'OWNERSHIP.Configure' }];
  fire(want, gen >= 13 ? { documentName: 'Item' } : jq({}), options);
  ok(options.length === 4 && options[0].name === 'OWNERSHIP.Configure', `v${gen}: our entries join Foundry's (after its own)`);
  const li = gen >= 13 ? entryEl('v13', 'T1') : jq(entryEl('v12', 'T1'));       // v12 hands a jQuery entry
  ok(options[1].condition(li) === true && options[1].condition(gen >= 13 ? entryEl('v13', 'S1') : jq(entryEl('v12', 'S1'))) === false, `v${gen}: condition gets the entry element and reads its id`);
  ok(options[2].condition === true, `v${gen}: a boolean condition passes through`);
  ok(options[3].condition(li) === false, `v${gen}: a condition that throws hides the entry instead of breaking the menu`);
  called.length = 0; options[1].callback(li);
  ok(called[0]?.join() === 'cb,T1', `v${gen}: callback gets the element too`);
  Hooks.off(reg.event, reg.id);
  ok(!hooks.get(want).size, `v${gen}: the returned {event, id} unregisters it`);
}
ok(compat.directoryEntryId(entryEl('v13', 'A')) === 'A' && compat.directoryEntryId(jq(entryEl('v12', 'B'))) === 'B' && compat.directoryEntryId(null) === null, 'directoryEntryId reads data-entry-id / data-document-id');

// ═══ 2. the real menu entries ═══
const { ShardSheetOverride } = await imp('scripts/integrations/ShardSheetOverride.js');
const sso = Object.create(ShardSheetOverride.prototype);
sso._nightCityEntries = (it) => (it.id === 'T1' ? [{ label: 'Place on scene' }] : []);
const shown = [];
sso._showContextMenu = (pos, entries, o) => shown.push({ pos, entries, o });
sso._configure = (it) => called.push(['configure', it.id]);
sso._convertToTerminal = (it) => called.push(['toTerminal', it.id]);
sso._launchConversionFlow = (it) => called.push(['toShard', it.id]);
game.nightcity._shardSheetOverride = undefined;
const early = ShardSheetOverride.directoryMenuEntries();
ok(early.every((e) => typeof e.condition !== 'function' || !e.condition(entryEl('v13', 'T1'))), 'built before ready (v13 asks at first render): every entry hidden until the override exists');
game.nightcity._shardSheetOverride = sso;
const entries = early;
const visible = (id) => entries.filter((e) => (typeof e.condition === 'function' ? e.condition(entryEl('v13', id)) : e.condition)).map((e) => e.name);
ok(visible('T1').join('|') === 'Open Terminal|Configure Terminal|Terminal options ▸', `a terminal: open, configure, options (${visible('T1').join('|')})`);
ok(visible('S1').length === 2 && visible('S1')[0].startsWith('Open ') && visible('S1')[1].startsWith('Configure '), `a shard with nothing behind "options": open + configure only (${visible('S1').join('|')})`);
ok(visible('P1').length === 3 && visible('P1').every((n) => /^Convert to |^Malware Workshop$/.test(n)), `a plain item (GM): convert ×2 + workshop (${visible('P1').join('|')})`);
ok(visible('ZZ').length === 0, 'an entry that is not an item (or another directory) shows nothing');
game.user.isGM = false;
ok(visible('T1').join('|') === 'Open Terminal|Terminal options ▸' && visible('P1').length === 0, 'a player: no configure, no convert');
game.user.isGM = true;
called.length = 0;
const byName = (n) => entries.find((e) => e.name === n);
byName('Open Terminal').callback(entryEl('v13', 'T1'));
byName('Configure Terminal').callback(entryEl('v13', 'T1'));
byName('Convert to Terminal').callback(entryEl('v13', 'P1'));
byName('Terminal options ▸').callback(entryEl('v13', 'T1'));
ok(called.map((c) => c.join(':')).join() === 'openTerminal:T1,configure:T1,toTerminal:P1', `callbacks act on the right item (${called.map((c) => c.join(':')).join()})`);
ok(shown.length === 1 && shown[0].entries[0].label === 'Place on scene' && shown[0].pos.clientX === 908 && shown[0].pos.clientY === 300 && shown[0].o.icon === 'fas fa-terminal', 'options ▸ opens the grouped menu under the entry');
ok(entries.every((e) => e.group === 'ncm' && /^<i class="fas fa-[\w-]+" style="color:#[0-9a-fA-F]{6}"><\/i>$/.test(e.icon)), 'each entry has a full icon class and sits in one group');

// ═══ 3. the old injection is gone ═══
const src = read('scripts/integrations/ShardSheetOverride.js');
ok(!src.includes('_injectDirectoryContextOptions') && !src.includes("entry.addEventListener('contextmenu'") && !src.includes("querySelector('#context-menu')"), 'no DOM injection into #context-menu left');
ok(/register\('init', \d+, 'Items directory menu', \(\) => \{\s*onDirectoryEntryContext\('Item', \(\) => ShardSheetOverride\.directoryMenuEntries\(\)\);/.test(read('scripts/init/registerDataShardSystem.js')), "registered at INIT (v13 builds the menu at the directory's first render, before ready)");
ok(!read('styles/components/access-points.css').includes('ncm-ctx-more'), 'the injected row\'s CSS is gone');

console.log(`test-directory-menu: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
