// test-jquery-sweep — the jQuery → element move (stage 2 step 10, B8c) stays sound.
// Dialog callbacks read their fields with `htmlOf(html).querySelector(…)?.value / ?.checked` (compat.js), which works
// whether the dialog hands over jQuery (v12, v13) or an element (once Foundry drops jQuery). A file that calls htmlOf
// without importing it would only fail when that dialog's button is pressed, so: every caller imports it. Plus the
// ratchet numbers equal today's counts, and the two local query helpers are not named `$` (the scanner counted them).
// Run: node dev/tools/sims/test-jquery-sweep.mjs   (NCM_ROOT=<dir> to check another checkout)
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';

const ROOT = path.resolve(process.env.NCM_ROOT || fileURLToPath(new URL('../../../', import.meta.url)));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const walk = (d) => readdirSync(path.join(ROOT, d)).flatMap((f) => { const p = `${d}/${f}`; return statSync(path.join(ROOT, p)).isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : []; });

const files = walk('scripts');
const users = files.filter((f) => f !== 'scripts/utils/compat.js' && /\bhtmlOf\(/.test(read(f)));
ok(users.length >= 12, `htmlOf is used across the module (${users.length} files)`);
for (const f of users) {
  const t = read(f);
  const imp = t.match(/^import \{([^}]*)\} from '([^']*utils\/compat\.js)';$/m);
  ok(!!imp && /\bhtmlOf\b/.test(imp[1]), `${f} imports htmlOf from compat.js`);
  if (imp) {
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(f), imp[2]));
    ok(target === 'scripts/utils/compat.js', `${f}: the compat import path resolves (${imp[2]})`);
  }
}

// no uniform field read left behind on jQuery
const STR = String.raw`('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")`;
const left = files.filter((f) => new RegExp(String.raw`html\.find\(${STR}\)\.(val\(\)|is\(':checked'\))`).test(read(f)));
ok(!left.length, `no dialog field read on jQuery left (${left.join(', ') || 'none'})`);

// the ratchet equals today's count (it may only go down; check-deprecations asks to lower it when it drops)
const dep = read('dev/tools/check-deprecations.mjs');
const rec = (label) => Number((dep.match(new RegExp(String.raw`\['${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}', [^\n]*?, (\d+)\]`)) || [])[1]);
const count = (re) => files.filter((f) => f !== 'scripts/utils/compat.js').reduce((n, f) => n + (read(f).replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '').match(re) || []).length, 0);
ok(rec('jQuery html.find(') === 58 && rec('jQuery $(') === 8, `ratchet recorded at 58 / 8 (${rec('jQuery html.find(')} / ${rec('jQuery $(')})`);
ok(count(/\bhtml\.find\(/g) <= 58 && count(/(?<![\w$.])\$\(/g) <= 8, 'and the code is at or under it');
ok(read('scripts/ui/NetworkNodes/JackInLock.js').includes('const q = (s) => root.querySelector(s);') && read('scripts/ui/ShardEncoder/ShardIconBuilder.js').includes('const qs = (sel) => root.querySelector(sel);'), 'the local query helpers are q / qs, not $');

// htmlOf itself: jQuery-like and element give the same element; field reads behave like .val() / .is(':checked')
globalThis.game = { release: { generation: 12 } };
const { htmlOf } = await import(pathToFileURL(path.join(ROOT, 'scripts/utils/compat.js')).href);
const fields = { '[name="by"]': { value: '7' }, '[name="tp"]': { checked: true } };
const el = { querySelector: (s) => fields[s] ?? null };
const jq = { 0: el, length: 1, jquery: '3.7.1', get: (i) => (i === 0 ? el : undefined) };
for (const [label, h] of [['jQuery', jq], ['element', el]]) {
  ok(htmlOf(h).querySelector('[name="by"]')?.value === '7', `${label}: a field's value`);
  ok(!!htmlOf(h).querySelector('[name="tp"]')?.checked === true, `${label}: a checkbox`);
  ok(htmlOf(h).querySelector('[name="none"]')?.value === undefined && !!htmlOf(h).querySelector('[name="none"]')?.checked === false, `${label}: a missing field reads undefined / false, as jQuery's .val() / .is() did`);
}

console.log(`test-jquery-sweep: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
