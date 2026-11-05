// test-content-types — the content-type touches agree (R16, after stage 2).
// A content type is: a CONTENT_TYPES value (constants.js), a CONTENT_TYPE_INFO row (rules/contentTypes.js), an optional
// ENRICHERS function (ui/content/ContentRenderers.js) and an `is<Type>` branch in templates/content/content-body.hbs.
// The plan's registerContentType() wrapper would not remove any of those (the template branch chain stays), so this is
// the useful half: a type missing a row or a branch fails here instead of rendering the raw fallback in play.
// Run: node dev/tools/sims/test-content-types.mjs   (NCM_ROOT=<dir> to check another checkout)
import { readFileSync } from 'fs';
import path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';

const ROOT = path.resolve(process.env.NCM_ROOT || fileURLToPath(new URL('../../../', import.meta.url)));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

globalThis.game = { settings: { get: () => undefined }, user: { isGM: true } };
const { CONTENT_TYPES } = await imp('scripts/utils/constants.js');
const { CONTENT_TYPE_INFO, getContentTypeInfo } = await imp('scripts/rules/contentTypes.js');

const types = Object.values(CONTENT_TYPES);
const flag = (v) => 'is' + v.charAt(0).toUpperCase() + v.slice(1);
ok(types.length === 18 && new Set(types).size === 18, `18 distinct content types (${types.length})`);

// INFO rows
const infoKeys = Object.keys(CONTENT_TYPE_INFO);
ok(infoKeys.sort().join() === [...types].sort().join(), `CONTENT_TYPE_INFO has exactly one row per type (${infoKeys.filter((k) => !types.includes(k)).join() || 'no extras'} / missing ${types.filter((t) => !infoKeys.includes(t)).join() || 'none'})`);
for (const t of types) {
  const i = CONTENT_TYPE_INFO[t] || {};
  ok(i.label && /^fa[srb]? fa-/.test(i.icon || '') && i.accent && /^fa[srb]? fa-/.test(i.indexIcon || ''), `${t}: label, a full icon class, accent, index icon`);
}
ok(typeof getContentTypeInfo === 'function' && getContentTypeInfo('no-such-type')?.label, 'an unknown type still gets display info');

// ENRICHERS keys are real types
const cr = read('scripts/ui/content/ContentRenderers.js');
const ea = cr.indexOf('const ENRICHERS = {');
const block = cr.slice(ea, cr.indexOf('\n};', ea));
const enrKeys = [...block.matchAll(/^ {2}\[CONTENT_TYPES\.(\w+)\]:/gm)].map((m) => m[1]);
ok(enrKeys.length > 0 && enrKeys.every((k) => CONTENT_TYPES[k]), `every ENRICHERS key is a CONTENT_TYPES key (${enrKeys.filter((k) => !CONTENT_TYPES[k]).join() || 'all'})`);
ok(new Set(enrKeys).size === enrKeys.length, 'no type enriched twice');
ok(/enriched\[_flagName\(value\)\] = type === value;/.test(cr) && /return 'is' \+ typeValue\.charAt\(0\)\.toUpperCase\(\) \+ typeValue\.slice\(1\);/.test(cr), 'enrichContent sets an is<Type> flag per type, named as here');

// the template's top-level branch chain
const tpl = read('templates/content/content-body.hbs');
const top = new Set([...tpl.matchAll(/^\{\{(?:#if|else if) (is[A-Z]\w*)\}\}/gm)].map((m) => m[1]));
for (const t of types) ok(top.has(flag(t)), `content-body.hbs has a top-level {{… ${flag(t)}}} branch`);
const strays = [...top].filter((f) => !types.some((t) => flag(t) === f));
ok(!strays.length, `no top-level branch for a type that does not exist (${strays.join() || 'none'})`);
ok(/^\{\{else\}\}/m.test(tpl), 'and a fallback branch for an unknown type');

console.log(`test-content-types: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
