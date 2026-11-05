// Sim: the Agent's footer follows the tab (2026-11-05, dev: "they don't really apply to calls or chips"). Messages keeps
// its keys; Calls lists / Dial · Enter Call · Esc Close and `/` jumps to the number box; Chips lists / Search · ↑↓ ·
// Enter Open, with its own search term, a pill filter that is state (it survives the search re-render) and a cursor.
// Drives the REAL MessageViewerApp.filterShardItems and renders the REAL footer / search markup through Handlebars.
//   node dev/tools/sims/test-viewer-footer.mjs
import { FOUNDRY_APP_PKGS } from './lib/foundryApp.mjs';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync } from 'fs';
import { createRequire } from 'module';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const read = (p) => readFileSync(`${ROOT}/${p}`, 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };

const js = read('scripts/ui/MessageViewer/MessageViewerApp.js');
const hbs = read('templates/message-viewer/message-viewer.hbs');
const calls = read('scripts/ui/MessageViewer/callsTab.js');

// ═══ 1. The chips filter (the real static, lifted out of the class) ═══
{
  const at = js.indexOf('  static filterShardItems(');
  const body = js.slice(at, js.indexOf('\n  }\n', at) + 4).replace('static filterShardItems', 'function filterShardItems');
  const filterShardItems = new Function(`${body}; return filterShardItems;`)();
  const items = [
    { name: 'Arasaka payroll', fromName: 'Rogue', isReceived: true, isEncrypted: true },
    { name: 'Club map', fromName: null, isReceived: false, isEncrypted: false },
    { name: 'Dead drop', fromName: 'Hana Ito', isReceived: true, isEncrypted: false },
  ];
  const names = (l) => l.map((x) => x.name).join(',');
  ok(names(filterShardItems(items)) === 'Arasaka payroll,Club map,Dead drop', 'All: everything');
  ok(names(filterShardItems(items, 'received')) === 'Arasaka payroll,Dead drop' && names(filterShardItems(items, 'inventory')) === 'Club map' && names(filterShardItems(items, 'encrypted')) === 'Arasaka payroll', 'the pills');
  ok(names(filterShardItems(items, 'all', 'HANA')) === 'Dead drop' && names(filterShardItems(items, 'all', 'rogue payroll')) === 'Arasaka payroll', 'search: name or sender, every word, any case');
  ok(filterShardItems(items, 'inventory', 'rogue').length === 0, 'pill and search together');
}

// ═══ 2. Wiring ═══
ok(/shardSearch = '';\n  _shardFilter = 'all';\n  _shardCursor = -1;/.test(js), 'Chips keep their own search, pill and cursor as state');
ok(/if \(getPrimaryTab\(this\.currentFilter\) === 'shards'\) \{ this\.shardSearch = value\.trim\(\);/.test(js), 'the box searches the tab it is on (a Chips search never filters Messages)');
ok(/_filterShards\(filter, pillEl\) \{\n    this\._shardFilter = /.test(js) && !/_filterShardsDom|item\.style\.display = show/.test(js), 'the pill filter is state, not a DOM toggle a re-render undoes');
ok(/if \(tab === 'calls'\) this\.element\.querySelector\('\[data-calls-num\]'\)\?\.focus\(\);/.test(js), 'Calls: / jumps to the number box');
ok(/else if \(isShards\) \{ event\.preventDefault\(\); this\._moveShardCursor\(dir\); \}/.test(js) && /if \(row\) \{ event\.preventDefault\(\); row\.click\(\); \}/.test(js), 'Chips: ↑↓ move the cursor, Enter opens the chip');
ok(/if \(isMessages\) \{ event\.preventDefault\(\); this\._navigateMessages\(dir\); \}/.test(js), 'the arrows only stop scrolling where they do something');
ok(/if \(e\.key !== 'Escape'\) return;[\s\S]{0,200}x\.remove\(\)/.test(calls) && /e\.stopPropagation\(\); x\.remove\(\)/.test(calls), 'Calls: Esc closes the directory before Foundry can close the Agent');
ok(/\.ncm-viewer__shard-item\.is-cursor \{/.test(read('styles/components/message-viewer.css')), 'the cursor shows');

// ═══ 3. Real render of the footer and the search box ═══
let HB = null;
for (const p of [...FOUNDRY_APP_PKGS]) { if (!existsSync(p)) continue; try { HB = createRequire(p)('handlebars'); break; } catch { /* next */ } }
if (!HB) { fail++; console.error('FAIL: could not load Handlebars from a Foundry install — render checks did not run'); }
else {
  HB.registerHelper('eq', (a, b) => a === b);
  HB.registerHelper('and', (a, b) => a && b);
  HB.registerHelper('ncm-term', (f, m) => (m === 'lower' ? 'chips' : 'Chips'));
  const cut = (from, to) => { const a = hbs.indexOf(from); return hbs.slice(a, hbs.indexOf(to, a) + to.length); };
  const footer = HB.compile(cut('<footer class="ncm-viewer__footer">', '</footer>'));
  const search = HB.compile(cut("{{#unless (eq primaryTab 'calls')}}\n    <div class=\"ncm-viewer__nav-search\">", '{{/unless}}'));
  const keys = (h) => [...h.matchAll(/<kbd>([^<]+)<\/kbd> ([^<]+)<\/span>/g)].map((m) => `${m[1]} ${m[2].trim()}`).join(' · ');
  ok(keys(footer({ primaryTab: 'calls' })) === '/ Dial · Enter Call · Esc Close · N New message', 'Calls footer');
  ok(keys(footer({ primaryTab: 'shards' })) === '/ Search · ↑↓ Navigate · Enter Open · N New message', 'Chips footer');
  ok(keys(footer({ primaryTab: 'messages', isMessagesTab: true })) === '/ Search · ↑↓ Navigate · Enter Select · N New message', 'Messages footer, nothing picked (unchanged)');
  ok(keys(footer({ primaryTab: 'messages', isMessagesTab: true, selectedMessage: {} })).startsWith('R Reply · F Fwd · S Save'), 'Messages footer, a message open (unchanged)');
  ok(search({ primaryTab: 'calls' }).trim() === '', 'no top search on Calls (the log has its own)');
  const sh = search({ primaryTab: 'shards', tabSearchTerm: 'map', tabSearchCount: 2, totalMessages: 40 });
  ok(sh.includes('placeholder="Search chips..."') && sh.includes('value="map"') && /search-count">2</.test(sh), 'on Chips the box says what it searches and counts chips');
  ok(/search-count">40</.test(search({ primaryTab: 'messages', tabSearchTerm: '', totalMessages: 40 })), 'on Messages it counts messages');
}

console.log(`\ntest-viewer-footer: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
