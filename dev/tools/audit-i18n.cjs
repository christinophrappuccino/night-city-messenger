#!/usr/bin/env node
/**
 * audit-i18n.cjs — dev-only. Cross-checks languages/en.json against every key
 * the module actually asks Foundry to resolve.
 *
 * Two live consumers, and the second one is easy to forget:
 *   1. explicit  game.i18n.localize/format('NCM.…')  and  {{localize "NCM.…"}}
 *   2. game.settings.register({ name, hint })  — Foundry localizes these for
 *      the Module Settings menu, so an absent key renders the RAW KEY on screen.
 *
 * Reports: MISSING (asked for, not in en.json — a visible bug) and
 *          UNUSED  (in en.json, nothing asks for it — dead weight).
 *
 * Run: node dev/tools/audit-i18n.cjs
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const LANG = path.join(ROOT, 'languages', 'en.json');

/** Recursively collect every file under dir matching one of the extensions. */
function walk(dir, exts, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, exts, out);
    else if (exts.some(x => e.name.endsWith(x))) out.push(p);
  }
  return out;
}

/** Flatten a nested locale object into dotted keys. */
function flatten(obj, prefix = '', out = new Map()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out.set(key, v);
  }
  return out;
}

const present = flatten(JSON.parse(fs.readFileSync(LANG, 'utf8')));
// `_`-prefixed entries are file comments (JSON has none), not lookup keys.
for (const k of [...present.keys()]) if (k.split('.').some(p => p.startsWith('_'))) present.delete(k);

// ── Collect requested keys ──
const requested = new Map(); // key -> Set of "file:line"
const dynamic = [];          // non-literal lookups we can't resolve statically

function note(key, file, line) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  if (!requested.has(key)) requested.set(key, new Set());
  requested.get(key).add(`${rel}:${line}`);
}

const files = [
  ...walk(path.join(ROOT, 'scripts'), ['.js']),
  ...walk(path.join(ROOT, 'templates'), ['.hbs']),
];

// Explicit lookups: game.i18n.localize('X') / .format('X') / .has('X')
const RE_I18N = /i18n\.(?:localize|format|has)\(\s*(['"`])([^'"`]+)\1/g;
// Handlebars: {{localize "X"}} / (localize "X")
const RE_HBS = /localize\s+(['"])([^'"]+)\1/g;
// Non-literal i18n lookups — a variable/template key we can't resolve
const RE_I18N_DYN = /i18n\.(?:localize|format|has)\(\s*[^'"`)]/g;
// Settings name:/hint: values that are i18n keys (Foundry localizes these)
const RE_SETTING = /\b(?:name|hint|label)\s*:\s*(['"])((?:NCM)\.[^'"]+)\1/g;

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const lineOf = (idx) => src.slice(0, idx).split('\n').length;
  for (const re of [RE_I18N, RE_HBS, RE_SETTING]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) note(m[2], file, lineOf(m.index));
  }
  RE_I18N_DYN.lastIndex = 0;
  let d;
  while ((d = RE_I18N_DYN.exec(src))) {
    dynamic.push(`${path.relative(ROOT, file).replace(/\\/g, '/')}:${lineOf(d.index)}`);
  }
}

// ── Report ──
const missing = [...requested.keys()].filter(k => !present.has(k)).sort();
const unused = [...present.keys()].filter(k => !requested.has(k)).sort();

console.log(`en.json keys: ${present.size}`);
console.log(`keys requested by code/templates: ${requested.size}\n`);

if (missing.length) {
  console.log(`✗ MISSING — asked for but NOT in en.json (renders the raw key on screen): ${missing.length}`);
  for (const k of missing) console.log(`    ${k}\n        ← ${[...requested.get(k)].join(', ')}`);
} else {
  console.log('✓ MISSING: none — every requested key exists.');
}

console.log(`\n${unused.length ? '•' : '✓'} UNUSED — in en.json, nothing asks for it: ${unused.length}`);
for (const k of unused) console.log(`    ${k}`);

if (dynamic.length) {
  console.log(`\n! NON-LITERAL i18n lookups (verify by hand): ${dynamic.length}`);
  for (const d of [...new Set(dynamic)]) console.log(`    ${d}`);
}

process.exitCode = missing.length ? 1 : 0;
