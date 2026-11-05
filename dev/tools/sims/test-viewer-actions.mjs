// test-viewer-actions — the message viewer's clicks go through ONE table (stage 2, step 12). _onDelegatedClick looks
// the clicked element's data-action up in VIEWER_ACTIONS and calls the entry with the viewer as `this`. This checks:
// every data-action in the viewer's template tree (followed through its partials) has an entry or is a calls-* action
// (callsTab.js); the dispatcher is the table, not a switch; each entry is a plain async function taking
// (target, messageId); aliases point at real entries. Entries no template names are listed (some are built in JS).
// Run: node dev/tools/sims/test-viewer-actions.mjs   (NCM_ROOT=<dir> to check another checkout)
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(process.env.NCM_ROOT || fileURLToPath(new URL('../../../', import.meta.url)));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

const V = read('scripts/ui/MessageViewer/MessageViewerApp.js');
ok(/^const VIEWER_ACTIONS = \{$/m.test(V), 'VIEWER_ACTIONS exists');
const keys = new Set([...V.matchAll(/^ {2}'([\w-]+)': async function \(target, messageId\) \{$/gm)].map((m) => m[1]));
const aliases = [...V.matchAll(/^VIEWER_ACTIONS\['([\w-]+)'\] = VIEWER_ACTIONS\['([\w-]+)'\];$/gm)].map((m) => [m[1], m[2]]);
ok(keys.size >= 100, `the table has its entries (${keys.size})`);
ok(aliases.every(([, to]) => keys.has(to)), 'every alias points at a real entry');
for (const [a] of aliases) keys.add(a);
ok(/Object\.freeze\(VIEWER_ACTIONS\);/.test(V), 'the table is frozen');

// the dispatcher
const disp = V.match(/async _onDelegatedClick\(event\) \{[\s\S]*?\n {2}\}\n/)?.[0] || '';
ok(/const run = VIEWER_ACTIONS\[action\];\n\s*if \(run\) await run\.call\(this, target, messageId\);/.test(disp), '_onDelegatedClick dispatches through the table, with the viewer as this');
ok(!/switch \(action\)/.test(disp) && disp.split('\n').length < 20, 'no switch left in the click router');
ok(/if \(action\.startsWith\('calls-'\)\) \{ await handleCallsAction\(this, action, target\); return; \}/.test(disp), 'calls-* actions still go to callsTab.js first');
// a body uses only what the router hands it (no `event`, `action` from the old scope)
const tableSrc = V.slice(V.indexOf('const VIEWER_ACTIONS = {'), V.indexOf('Object.freeze(VIEWER_ACTIONS);'));
ok(!/\bbreak;\s*\n\s*\},?\n/.test(tableSrc), 'no stray switch break left at the end of an entry');

// every data-action in the template tree
const seen = new Set(), actions = new Map();
const visit = (p) => {
  if (seen.has(p) || !existsSync(path.join(ROOT, p))) return; seen.add(p);
  const t = read(p);
  for (const m of t.matchAll(/data-action="([^"{}]+)"/g)) { if (!actions.has(m[1])) actions.set(m[1], new Set()); actions.get(m[1]).add(p); }
  for (const m of t.matchAll(/\{\{>\s*"modules\/night-city-messenger\/([^"]+\.hbs)"/g)) visit(m[1]);
};
visit('templates/message-viewer/message-viewer.hbs');
ok(seen.size >= 5, `followed the viewer's template tree (${seen.size} files)`);
const missing = [...actions.keys()].filter((a) => !keys.has(a) && !a.startsWith('calls-'));
ok(missing.length === 0, `every data-action in the viewer's templates has a VIEWER_ACTIONS entry (${missing.map((a) => `${a} in ${[...actions.get(a)].join(', ')}`).join('; ')})`);
// the same for the HTML the viewer builds in JS
const jsActions = [...V.matchAll(/data-action="([\w-]+)"/g)].map((m) => m[1]);
const jsMissing = [...new Set(jsActions)].filter((a) => !keys.has(a) && !a.startsWith('calls-'));
ok(jsMissing.length === 0, `every data-action the viewer writes in JS has an entry (${jsMissing.join(', ')})`);

const unused = [...keys].filter((k) => !actions.has(k) && !jsActions.includes(k));
if (unused.length) console.log(`  note: ${unused.length} entries no viewer template or viewer JS names (built elsewhere, or dead): ${unused.join(', ')}`);

console.log(`test-viewer-actions: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
