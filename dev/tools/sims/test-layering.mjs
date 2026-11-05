// test-layering — which folders may import which (stage 2, step 11). Rules are pure and live in scripts/rules/ (or
// utils/), never under ui/; the lower layers (rules, utils, data, core, services, integrations) do not import ui/
// files statically, except the few real UI pieces a service still calls (R9b, listed below, may only shrink);
// helpers.js — imported by nearly every file — imports no UI at all. The old ui/ paths of the moved rules stay as
// pure re-exports so existing imports keep working.
// Run: node dev/tools/sims/test-layering.mjs   (NCM_ROOT=<dir> to check another checkout)
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(process.env.NCM_ROOT || fileURLToPath(new URL('../../../', import.meta.url)));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const walk = (d, out = []) => { if (!existsSync(d)) return out; for (const f of readdirSync(d)) { const p = path.join(d, f); if (statSync(p).isDirectory()) walk(p, out); else if (p.endsWith('.js')) out.push(p); } return out; };
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const resolveImport = (from, spec) => path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));

const imports = (file) => {
  const t = read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
  const out = [];
  for (const m of t.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+['"]([^'"]+)['"]/gm)) out.push({ spec: m[1], kind: 'static' });
  for (const m of t.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push({ spec: m[1], kind: 'dynamic' });
  return out.filter((i) => i.spec.startsWith('.')).map((i) => ({ ...i, to: resolveImport(file, i.spec) }));
};

const LOWER = ['scripts/rules', 'scripts/utils', 'scripts/data', 'scripts/core', 'scripts/services', 'scripts/integrations'];
const lowerFiles = LOWER.flatMap((d) => walk(path.join(ROOT, d))).map(rel);
ok(lowerFiles.some((f) => f.startsWith('scripts/rules/')), 'scripts/rules/ exists');

// 1. helpers.js imports no UI file, static or dynamic
const helperUi = imports('scripts/utils/helpers.js').filter((i) => i.to.startsWith('scripts/ui/'));
ok(helperUi.length === 0, `helpers.js imports no UI file (${helperUi.map((i) => i.spec).join(', ')})`);

// 2. rules/ imports only utils/ (constants, helpers…) and other rules
const rulesBad = lowerFiles.filter((f) => f.startsWith('scripts/rules/')).flatMap((f) => imports(f).filter((i) => !/^scripts\/(utils|rules)\//.test(i.to)).map((i) => `${f} → ${i.to}`));
ok(rulesBad.length === 0, `rules/ depends only on utils/ and rules/ (${rulesBad.join(', ')})`);

// 3. lower layers import NO ui/ file, static or lazy (R9b, after stage 2: what a service needs from the UI is handed
// to it through core/providers.js). The exception is WIRING: the two integration files that route sockets and item
// sheets into GM-side flows and config windows — composition code, like the init/ files — and only lazily.
const WIRING = new Set(['scripts/integrations/SocketHandlers.js', 'scripts/integrations/ShardSheetOverride.js']);
const uiImports = lowerFiles.flatMap((f) => imports(f).filter((i) => i.to.startsWith('scripts/ui/')).map((i) => ({ f, ...i })));
const bad = uiImports.filter((i) => !WIRING.has(i.f) || i.kind === 'static');
ok(bad.length === 0, `no lower layer imports a ui/ file — move a rule to rules/, or have the UI provide it (core/providers.js) (${bad.map((i) => `${i.f} → ${i.to}`).join('; ')})`);
ok(uiImports.filter((i) => WIRING.has(i.f)).length <= 11, `the two wiring files reach the UI lazily, no more than today (${uiImports.filter((i) => WIRING.has(i.f)).length} of 11)`);

// 3b. every provider a service asks for is declared and provided at init
{
  const P = read('scripts/core/providers.js');
  const declared = new Set([...P.matchAll(/^ {2}([a-zA-Z]+): ['"]/gm)].map((m) => m[1]));
  const providedAt = new Set([...read('scripts/init/registerUIComponents.js').matchAll(/provide\('([a-zA-Z]+)'/g)].map((m) => m[1]));
  const asked = new Set(lowerFiles.flatMap((f) => [...read(f).matchAll(/\b(?:need|provided)\('([a-zA-Z]+)'\)/g)].map((m) => m[1])));
  ok(declared.size >= 7 && [...asked].every((n) => declared.has(n)), `every provider asked for is declared in PROVIDERS (${[...asked].filter((n) => !declared.has(n)).join(', ') || 'all'})`);
  ok([...declared].every((n) => providedAt.has(n)), `the "UI providers" init step provides every declared one (${[...declared].filter((n) => !providedAt.has(n)).join(', ') || 'all'})`);
  ok(/initializer\.register\('init', \d+, 'UI providers'/.test(read('scripts/init/registerUIComponents.js')), 'the providers are registered at init');
}
// none of those lazy targets is one of the moved pure files
const MOVED = { 'scripts/ui/content/EncoderModel.js': 'scripts/rules/encoder.js', 'scripts/ui/content/IntegrityModel.js': 'scripts/rules/integrity.js', 'scripts/ui/Calls/dictation.js': 'scripts/utils/dictation.js' };
const viaOld = lowerFiles.flatMap((f) => imports(f).filter((i) => MOVED[i.to] || (i.to === 'scripts/ui/content/ContentRenderers.js')).map((i) => `${f} → ${i.spec}`));
ok(viaOld.length === 0, `lower layers import the moved rules from their new home (${viaOld.join(', ')})`);

// 4. the old paths are pure re-exports of the new files, and the new files are self-contained
for (const [old, now] of Object.entries(MOVED)) {
  const o = read(old).replace(/\/\*[\s\S]*?\*\//g, '').trim();
  const target = path.posix.relative(path.posix.dirname(old), now);
  ok(o === `export * from '${target.startsWith('.') ? target : './' + target}';`, `${old} only re-exports ${now}`);
  ok(!/^\s*import /m.test(read(now)), `${now} imports nothing (pure)`);
}
const CR = read('scripts/ui/content/ContentRenderers.js');
const ctNames = [...read('scripts/rules/contentTypes.js').matchAll(/^export (?:const|function) (\w+)/gm)].map((m) => m[1]);
const reexp = CR.match(/export \{ ([^}]+) \} from '\.\.\/\.\.\/rules\/contentTypes\.js';/);
ok(!!reexp && ctNames.every((n) => reexp[1].split(',').map((s) => s.trim()).includes(n)), `ContentRenderers re-exports every name rules/contentTypes.js has (${ctNames.length})`);
ok(ctNames.every((n) => !new RegExp(`^export (?:const|function) ${n}\\b`, 'm').test(CR)), 'and no longer defines them itself');

// 5. the operator picker is UI and lives with its window
ok(/export async function openOperatorPicker/.test(read('scripts/ui/content/OperatorSelect.js')) && !/openOperatorPicker/.test(read('scripts/utils/helpers.js')), 'openOperatorPicker lives in ui/content/OperatorSelect.js, not helpers.js');

console.log(`test-layering: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
