// test-service-map — the startup report says what stopped working (stage 2, batch 8).
//   1. scripts/core/serviceMap.js matches the code: every service's game.nightcity.* lookups are re-derived from its
//      source and compared with the table, both ways; every service the startup assigns is in the table
//   2. affectedBy / startupImpact (pure)
//   3. the REAL ModuleInitializer: a failed step that leaves a service missing names it and its direct users
// Run: node dev/tools/sims/test-service-map.mjs   (NCM_ROOT=<dir> to check another checkout)
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';

const ROOT = path.resolve(process.env.NCM_ROOT || fileURLToPath(new URL('../../../', import.meta.url)));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const walk = (d, out = []) => { for (const f of readdirSync(d)) { const p = path.join(d, f); if (statSync(p).isDirectory()) walk(p, out); else if (p.endsWith('.js')) out.push(p); } return out; };
const files = walk(path.join(ROOT, 'scripts'));
const src = Object.fromEntries(files.map((f) => [rel(f), readFileSync(f, 'utf8')]));

const mapFile = path.join(ROOT, 'scripts/core/serviceMap.js');
ok(existsSync(mapFile), 'scripts/core/serviceMap.js exists');
if (!existsSync(mapFile)) { console.log(`test-service-map: ${pass} passed, ${fail} failed`); process.exit(1); }
const { SERVICE_MAP, affectedBy, startupImpact } = await import(pathToFileURL(mapFile).href);

// ═══ 1. the table matches the code ═══
// game.nightcity.<name> = new <Class>(…)  or  = <var>, resolving <var> to the NEAREST declaration before it
const nameToClass = {};
for (const t of Object.values(src)) {
  for (const m of t.matchAll(/game\.nightcity\.([a-zA-Z]+)\s*=\s*new\s+([A-Z][A-Za-z]+)\(/g)) nameToClass[m[1]] = m[2];
  for (const m of t.matchAll(/game\.nightcity\.([a-zA-Z]+)\s*=\s*([a-z][A-Za-z]+)\s*;/g)) {
    const before = t.slice(0, m.index);
    const decls = [...before.matchAll(new RegExp(`(?:const|let)\\s+${m[2]}\\s*=\\s*(?:new\\s+([A-Z][A-Za-z]+)\\(|([A-Z][A-Za-z]+)\\.getInstance\\(\\))`, 'g'))];
    const d = decls.at(-1); if (d) nameToClass[m[1]] = d[1] || d[2];
  }
}
const classFile = {};
for (const [f, t] of Object.entries(src)) for (const m of t.matchAll(/export class ([A-Z][A-Za-z]+)/g)) classFile[m[1]] = f;
const CORE = new Set(['eventBus', 'socketManager', 'settingsManager', 'stateManager']);   // made in registerCoreServices; everything needs them
const derivedNames = Object.keys(nameToClass).filter((n) => classFile[nameToClass[n]] && !CORE.has(n));
ok(nameToClass.callService === 'CallService' && nameToClass.conversationService === 'ConversationService', 'the derivation resolves two `service` variables in one file to their own classes');

const missingFromMap = derivedNames.filter((n) => !(n in SERVICE_MAP));
ok(missingFromMap.length === 0, `every service the startup assigns is in the table (missing: ${missingFromMap.join(', ')})`);
const notInCode = Object.keys(SERVICE_MAP).filter((n) => !derivedNames.includes(n));
ok(notInCode.length === 0, `every table entry is a service the startup assigns (unknown: ${notInCode.join(', ')})`);

const drift = [];
for (const n of derivedNames.filter((x) => x in SERVICE_MAP)) {
  const t = src[classFile[nameToClass[n]]];
  const code = new Set([...t.matchAll(/game\.nightcity\??\.([a-zA-Z]+)/g)].map((m) => m[1]).filter((x) => x !== n && x in SERVICE_MAP));
  const table = new Set(SERVICE_MAP[n].uses);
  const add = [...code].filter((x) => !table.has(x)), extra = [...table].filter((x) => !code.has(x));
  if (add.length || extra.length) drift.push(`${n}: ${add.length ? `uses ${add.join(', ')} (not in the table)` : ''}${add.length && extra.length ? '; ' : ''}${extra.length ? `table lists ${extra.join(', ')} (not in the code)` : ''}`);
}
ok(drift.length === 0, `each service's "uses" matches its code:\n  ${drift.join('\n  ')}`);
ok(Object.values(SERVICE_MAP).every((v) => typeof v.does === 'string' && v.does.trim().length > 2), 'every service says what it does, in words the GM reads');

// ═══ 2. pure rules ═══
const tiny = { a: { uses: [], does: 'alpha' }, b: { uses: ['a'], does: 'beta' }, c: { uses: ['b'], does: 'gamma' } };
ok(affectedBy(['a'], tiny).join() === 'b', 'affectedBy lists direct users only (c relies on b, not on a)');
ok(affectedBy(['b'], tiny).join() === 'c' && affectedBy([], tiny).length === 0, 'affectedBy: nothing missing → nothing affected');
ok(startupImpact({ failed: [], missing: [] }) === '', 'a clean startup has nothing to say');
const s = startupImpact({ failed: ['CallService'], missing: ['callService'] });
ok(/1 startup step failed: CallService\./.test(s) && /Not running: calls and voicemail\./.test(s), `the sentence names the step and what is not running: "${s}"`);
ok(/payphones/.test(s) && /the contact directory/.test(s) && /Data Drop/.test(s), 'and the services that use it directly');
ok(SERVICE_MAP.payphoneService.uses.includes('callService') && affectedBy(['callService']).includes('payphoneService'), 'payphones depend on calls');

// ═══ 3. the real ModuleInitializer ═══
const toasts = [];
globalThis.ui = { notifications: { error: (m, o) => toasts.push({ m, o }), warn() {}, info() {}, notify() {} } };
globalThis.foundry = { utils: { deepClone: (o) => structuredClone(o) } };
const realConsole = { info: console.info, error: console.error, log: console.log }; console.info = () => {}; console.error = () => {}; console.log = () => {};
const present = Object.fromEntries(Object.keys(SERVICE_MAP).map((k) => [k, {}]));
globalThis.game = { user: { isGM: true }, nightcity: { ...present }, settings: { get: () => false } };
const { ModuleInitializer } = await import(pathToFileURL(path.join(ROOT, 'scripts/core/ModuleInitializer.js')).href);
const mi = new ModuleInitializer();
mi.register('ready', 10, 'CallService', () => { delete game.nightcity.callService; throw new Error('boom'); });
mi.register('ready', 20, 'Later step', () => {});
await mi.runPhase('ready');
mi.reportFailures();
Object.assign(console, realConsole);
ok(mi.report?.missing?.join() === 'callService', `the report knows which service is missing (${mi.report?.missing})`);
ok(mi.report.affected.includes('payphoneService') && mi.report.affected.includes('masterContactService'), 'and which services use it');
const m = toasts.at(-1)?.m || '';
ok(/1 startup step failed: CallService/.test(m) && /Not running: calls and voicemail/.test(m) && /payphones/.test(m) && /F12/.test(m), `the GM's notice says what stopped working: "${m}"`);
const clean = new ModuleInitializer(); toasts.length = 0;
ok(clean.reportFailures() === 0 && toasts.length === 0 && clean.report.missing.length === 0, 'a clean startup still says nothing');
ok(/startupReport = initializer\.report/.test(src['scripts/main.js'] || ''), 'main.js exposes the report on game.nightcity.startupReport');

console.log(`test-service-map: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
