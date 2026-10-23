// Sim: no template reads a context FIELD whose name is a registered Handlebars
// HELPER. `{{sub}}` does not print the field `sub` — it CALLS the `sub` helper
// (subtraction) with no arguments and prints "NaN" (the group tray's member
// card, 2026-10-21, tester: "underneath the name it says NaN"). Handlebars
// resolves a bare mustache as a helper first, then as a field. Same trap for
// `add`, `join`, `letter`, `lower`, `upper`, `truncate`, `not`, `and`, `or`…
//
// Reads the helper names straight out of scripts/init/registerTemplates.js and
// scans every .hbs for a bare `{{name}}` / `{{name.x}}` / `{{../name}}` /
// `{{#if name}}` use. A helper used WITH arguments (`{{sub a b}}`, `{{#if (eq a b)}}`)
// is fine and is not flagged. Exits 1 on any hit.
import { fileURLToPath } from 'url';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };

const reg = readFileSync(`${ROOT}/scripts/init/registerTemplates.js`, 'utf8');
const helpers = [...reg.matchAll(/registerHelper\('([A-Za-z0-9_-]+)'/g)].map(m => m[1]);
ok(helpers.includes('sub') && helpers.includes('eq'), `helper list read from registerTemplates.js (${helpers.length} helpers)`);

// Foundry's own helpers that a field could also shadow (v12 HandlebarsHelpers).
const foundryHelpers = ['checked', 'disabled', 'concat', 'editor', 'filePicker', 'localize', 'numberFormat', 'numberInput', 'radioBoxes', 'rangePicker', 'select', 'selectOptions', 'timeSince', 'colorPicker', 'ifThen'];
const names = [...new Set([...helpers, ...foundryHelpers])].filter(n => !n.includes('-')); // ncm-* can't be a bare field

const walk = (d) => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : (f.endsWith('.hbs') ? [p] : []); });
const files = walk(`${ROOT}/templates`);
ok(files.length > 50, `${files.length} templates scanned`);

// Only the HEAD of a mustache is helper-resolved: `{{name}}` / `{{{name}}}` with nothing
// after the name. A block PARAM (`{{#if checked}}`), a path (`{{name.x}}`, `{{../name}}`)
// and a helper with arguments (`{{sub a b}}`) all read the field / call it on purpose —
// the shard + terminal configs' `{{#if checked}}` is live-proven and must not be flagged.
const bare = new RegExp(String.raw`\{\{\{?~?\s*(` + names.join('|') + String.raw`)\s*~?\}\}\}?`, 'g');
const hits = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8').replace(/\{\{!--[\s\S]*?--\}\}/g, '').replace(/\{\{![^}]*\}\}/g, '');
  for (const m of src.matchAll(bare)) hits.push(`${relative(ROOT, f).replace(/\\/g, '/')}: ${m[0]}`);
}
ok(hits.length === 0, `no template reads a field named like a helper (hits: ${hits.join(' | ') || 'none'})`);

// The fix that motivated this: the group tray's member line is `detail`, not `sub`.
const panel = readFileSync(`${ROOT}/templates/contact-manager/partials/contact-groups-panel.hbs`, 'utf8');
ok(/\{\{detail\}\}/.test(panel) && !/\{\{sub\}\}/.test(panel), 'group tray member line reads {{detail}}');
ok(/detail: \[c\.role, c\.email\]/.test(readFileSync(`${ROOT}/scripts/ui/ContactManager/ContactManagerApp.js`, 'utf8')), 'ContactManagerApp builds `detail`');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
