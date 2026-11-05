// Sim: tooltip text, GM dialog names, macro labels (audit remediation A4b:
// SEC-16, SEC-17, SEC-18).
//
// Foundry 12 shows a tooltip with `tooltip.innerHTML = element.dataset.tooltip`.
// The browser decodes the attribute once, then Foundry parses the result as
// HTML, so a value written into data-tooltip="…" must be escaped TWICE
// (tipText / {{ncm-tip}}). A dataset.tooltip assignment is escaped once.
//
// Checks: tipText + the ncm-tip helper; every {{…}} inside a template
// data-tooltip goes through ncm-tip; every ${…} inside a JS data-tooltip goes
// through tipText (or the composer's own tip()); a REAL Handlebars render shows
// a hostile name as text after the two decodes Foundry does; the GM dialogs
// escape names; access-point macro labels drop U+2028/U+2029.
import { FOUNDRY_APP_PKGS } from './lib/foundryApp.mjs';
import fs from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };
const read = (rel) => fs.readFileSync(join(ROOT, rel), 'utf8');
const walk = (dir, ext, out = []) => { for (const e of fs.readdirSync(join(ROOT, dir), { withFileTypes: true })) { const p = `${dir}/${e.name}`; e.isDirectory() ? walk(p, ext, out) : p.endsWith(ext) && out.push(p); } return out; };

const HOSTILE = '<img src=x onerror="window.__pwned=1">';
// What Foundry ends up parsing as HTML: decode the attribute once (the browser), then innerHTML.
const decodeAttr = (s) => s.replace(/&(amp|lt|gt|quot|#39|#x27|#x3D|#x60);/g, (m, n) => ({ amp: "&", lt: "<", gt: ">", quot: "\"", "#39": "'", "#x27": "'", "#x3D": "=", "#x60": "`" }[n]));

// ═══ 1. tipText ═══
const { tipText, escapeHtml, registerTipHelper } = await import(pathToFileURL(join(ROOT, 'scripts/utils/notify.js')).href);
ok(tipText('R&D') === 'R&amp;amp;D', 'tipText escapes twice');
ok(decodeAttr(tipText(HOSTILE)) === escapeHtml(HOSTILE), 'after the attribute decode, the tooltip HTML is escaped text');
ok(!/<img/.test(decodeAttr(tipText(HOSTILE))), 'no live tag reaches the tooltip');
ok(tipText(null) === '' && tipText(undefined) === '', 'null / undefined → empty');
ok(tipText(5) === '5', 'numbers pass through');

// ═══ 2. Templates: every {{…}} in data-tooltip goes through ncm-tip ═══
const reg = read('scripts/init/registerTemplates.js');
ok(/registerTipHelper\(Handlebars\)/.test(reg), 'ncm-tip helper registered through registerTipHelper');
ok(/import \{ registerTipHelper \} from '\.\.\/utils\/notify\.js'/.test(reg), 'registerTemplates imports registerTipHelper');
const bareTpl = [];
for (const f of walk('templates', '.hbs')) {
  const src = read(f);
  for (const m of src.matchAll(/data-tooltip="([^"]*)"/g)) {
    for (const mm of m[1].matchAll(/(?<!{){{(?!{)\s*([^}]*?)\s*\}\}/g)) {
      const t = mm[1];
      if (/^[#/!>^]|^else\b|^ncm-tip\b/.test(t) || t.includes('~')) continue;
      bareTpl.push(`${f}: {{${t}}}`);
    }
  }
}
ok(bareTpl.length === 0, `every template tooltip interpolation goes through ncm-tip (${bareTpl.slice(0, 5).join(' | ')})`);

// ═══ 3. JS: every ${…} in data-tooltip="…" goes through tipText ═══
function exprEnd(src, i) {
  let depth = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'") { const q = c; i++; while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; } i++; continue; }
    if (c === '`') { i++; while (i < src.length && src[i] !== '`') { if (src[i] === '\\') { i += 2; continue; } if (src[i] === '$' && src[i + 1] === '{') { i = exprEnd(src, i + 2) + 1; continue; } i++; } i++; continue; }
    if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === '}') { if (depth === 0) return i; depth--; }
    i++;
  }
  return -1;
}
const bareJs = [];
let jsSites = 0;
for (const f of walk('scripts', '.js')) {
  if (f.endsWith('utils/notify.js')) continue;
  const src = read(f);
  let i = 0;
  while ((i = src.indexOf('data-tooltip="', i)) >= 0) {
    let j = i + 14;
    while (j < src.length && src[j] !== '"' && src[j] !== '`' && src[j] !== '\n') {
      if (src[j] === '$' && src[j + 1] === '{') {
        const end = exprEnd(src, j + 2);
        const e = src.slice(j + 2, end).trim();
        jsSites++;
        if (!/^(tipText|tip)\(/.test(e)) bareJs.push(`${f}: \${${e.slice(0, 50)}}`);
        j = end + 1; continue;
      }
      j++;
    }
    // string concatenation form: data-tooltip="' + EXPR + '
    if (src.startsWith("' + ", j) && src[j - 1] !== '"') { /* not this form */ }
    i = j;
  }
  for (const m of src.matchAll(/data-tooltip="[^"'`]*' \+ (\S+?)\(/g)) { jsSites++; if (m[1] !== 'tipText') bareJs.push(`${f}: '+ ${m[1]}(`); }
  for (const m of src.matchAll(/data-tooltip="[^"'`]*' \+ (?![a-zA-Z_.]+\()([^+]+?) \+ '/g)) { jsSites++; bareJs.push(`${f}: '+ ${m[1]}`); }
}
ok(jsSites > 80, `the scan found the JS tooltip sites (${jsSites})`);
ok(bareJs.length === 0, `every JS tooltip interpolation goes through tipText (${bareJs.slice(0, 5).join(' | ')})`);
// The composer's own tip() escapes twice too.
const comp = read('scripts/ui/MessageComposer/MessageComposerApp.js');
ok(/data-tooltip="[^"]*\$\{tip\(/.test(comp) && /const tip = \(s\) => h\(h\(s\)\)/.test(comp), "composer's tip() is a double escape");
// A page-head description copied into dataset.tooltip is escaped once.
ok(/p\.dataset\.tooltip = h\(p\.textContent\.trim\(\)\)/.test(read('scripts/ui/AdminPanel/AdminPanelApp.js')), 'page-head dataset.tooltip escaped');

// ═══ 4. REAL Handlebars render ═══
let Handlebars = null;
for (const p of [...FOUNDRY_APP_PKGS]) {
  if (!fs.existsSync(p)) continue;
  try { Handlebars = createRequire(p)('handlebars'); break; } catch { /* keep looking */ }
}
if (!Handlebars) { fail++; console.error('FAIL: could not load Handlebars — render checks did not run'); }
else {
  registerTipHelper(Handlebars); // the real helper
  Handlebars.registerHelper('join', (arr, sep) => (Array.isArray(arr) ? arr.join(typeof sep === 'string' ? sep : ', ') : ''));
  const t = Handlebars.compile('<span data-tooltip="Open {{ncm-tip name}}">x</span><b data-tooltip="{{ncm-tip (join list ", ")}}">y</b>');
  const html = t({ name: HOSTILE, list: [HOSTILE, 'R&D'] });
  const tips = [...html.matchAll(/data-tooltip="([^"]*)"/g)].map((m) => decodeAttr(m[1]));
  ok(tips.length === 2, 'two tooltips rendered');
  ok(tips.every((s) => !/<img/.test(s)), 'no live tag in either tooltip after the attribute decode');
  ok(tips[0] === `Open ${escapeHtml(HOSTILE)}`, 'the name shows as text');
  ok(tips[1].includes('R&amp;D'), 'an ampersand survives as text');
  ok(Handlebars.compile('{{ncm-tip}}')({}) === '', 'ncm-tip with no value renders nothing');
  // Every template still compiles.
  let bad = 0;
  for (const f of walk('templates', '.hbs')) { try { Handlebars.precompile(read(f)); } catch { bad++; console.error('compile:', f); } }
  ok(bad === 0, 'every template compiles');
}

// ═══ 5. GM dialogs escape names (SEC-17) ═══
const dlg = [
  ['scripts/ui/AdminPanel/tabs/ContactsTab.js', /escapeHtml\(who\)/],
  ['scripts/ui/AdminPanel/tabs/ShardsTab.js', /escapeHtml\(item\.name\)/],
  ['scripts/ui/ContactManager/ContactManagerApp.js', /escapeHtml\(existing\.name\)/],
  ['scripts/ui/ItemInbox/ItemInboxConfig.js', /escapeHtml\(placeholder\)/],
  ['scripts/ui/ItemInbox/ItemInboxApp.js', /escapeHtml\(selectedItem\.name\)/],
  ['scripts/ui/ThemeCustomizer/ThemeCustomizerApp.js', /escapeHtml\(name\)/],
  ['scripts/ui/MessageViewer/MessageViewerApp.js', /escapeHtml\(currentEmail\)/],
  ['scripts/ui/MessageViewer/MessageViewerApp.js', /escapeHtml\(netName\)/],
  ['scripts/ui/Terminal/TerminalConfigApp.js', /escapeHtml\(name\)/],
  ['scripts/ui/MessageComposer/MessageComposerApp.js', /value="\$\{escapeHtml\(sceneName\)\}"/],
];
for (const [f, re] of dlg) ok(re.test(read(f)), `${f.split('/').pop()} escapes ${re.source.slice(0, 40)}`);

// ═══ 6. Macro labels drop line terminators (SEC-18) ═══
const ap = read('scripts/utils/accessPoints.js');
ok(!/[\u2028\u2029]/.test(ap), 'accessPoints.js holds no raw U+2028 / U+2029');
ok((ap.match(/\\u2028\\u2029/g) || []).length >= 2, 'both label sites strip U+2028 / U+2029');
const apMod = await import(pathToFileURL(join(ROOT, 'scripts/utils/accessPoints.js')).href).catch(() => null);
ok(!!apMod?.accessMacroSnippet, 'accessPoints.js loads');
if (apMod?.accessMacroSnippet) {
  const code = apMod.accessMacroSnippet({ kind: 'terminal', id: 'Item.x' }, 'Evil\u2028alert(1)//\u2029');
  ok(!/[\u2028\u2029]/.test(code), 'a generated macro holds no line terminator from the label');
  let parsed = true; try { new Function(`return (async () => {${code}\n})`); } catch { parsed = false; }
  ok(parsed, 'the generated macro still parses');
}

console.log(`test-tooltip-text: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
