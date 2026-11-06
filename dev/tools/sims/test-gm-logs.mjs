// test-gm-logs — the trace log and the network access log live in a GM-only journal, not world settings (stage 2,
// step 13; measured ~100 KB / ~170 KB at their caps, re-sent to every client on each write). Drives the REAL
// data/gmLogStore.js and the v7/v8 migrations against a mocked journal: reads fall back to the old setting until it
// moves, the journal is GM-only, overlapping writes all land, the migration verifies before it empties the setting
// (and keeps it when the read-back is short), and nothing else writes the old settings.
// Run: node dev/tools/sims/test-gm-logs.mjs   (NCM_ROOT=<dir> to check another checkout)
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';
import { installJournals } from './lib/journalMock.mjs';

const ROOT = path.resolve(process.env.NCM_ROOT || fileURLToPath(new URL('../../../', import.meta.url)));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const lib = path.join(ROOT, 'scripts/data/gmLogStore.js');
if (!existsSync(lib)) { ok(false, 'scripts/data/gmLogStore.js exists'); console.log(`test-gm-logs: ${pass} passed, ${fail} failed`); process.exit(1); }

const MOD = 'night-city-messenger';
const store = new Map([['traceLog', [{ id: 't1', action: 'crack' }, { id: 't2', action: 'siphon' }]], ['networkAccessLog', [{ id: 'a1', type: 'connect' }]], ['ifaceShiftDone', { a: true, b: true }]]);
globalThis.game = {
  user: { id: 'gm', isGM: true }, users: { activeGM: { id: 'gm' } },
  settings: { get: (m, k) => { if (!store.has(k)) throw new Error('none'); return store.get(k); }, set: async (m, k, v) => { store.set(k, structuredClone(v)); return v; } },
  nightcity: {},
};
globalThis.Hooks = { on() {}, once() {}, callAll() {} };
globalThis.ui = { notifications: { warn() {}, info() {}, error() {} } };
globalThis.foundry = { utils: { deepClone: (x) => structuredClone(x), randomID: () => 'r' } };
const J = installJournals(game);
const G = await import(pathToFileURL(lib).href);

// ═══ 1. before the move: the old setting still reads ═══
ok(G.readGmLog('traceLog').map((r) => r.id).join() === 't1,t2', 'with no journal yet, a log reads its old world setting');
ok(G.gmLogJournal() === null, 'nothing is created by reading');

// ═══ 2. the migration ═══
let n = await G.migrateGmLog('traceLog');
ok(n === 2 && J.gmLogRows('traceLog')?.map((r) => r.id).join() === 't1,t2', 'migrateGmLog moves every row into the journal page');
ok(store.get('traceLog').length === 0, '…and empties the old setting once they read back');
const j = G.gmLogJournal();
ok(j && j.ownership?.default === 0 && j.flags?.[MOD]?.[G.GM_LOG_FLAG] === true && j.name === 'NCM — GM logs', 'the journal is GM-only (ownership NONE) and flagged');
ok(G.readGmLog('traceLog').length === 2, 'reads now come from the journal');
n = await G.migrateGmLog('traceLog');
ok(n === 0 && J.gmLogRows('traceLog').length === 2, 'running it again moves nothing and duplicates nothing');
// a short read-back keeps the setting
store.set('networkAccessLog', [{ id: 'a1' }, { id: 'a2' }]);
const realCreate = j.createEmbeddedDocuments;
j.createEmbeddedDocuments = async (type, list) => { const made = await realCreate(type, list); for (const p of made) { const up = p.update; p.update = async (patch) => { const key = `flags.${MOD}.rows`; if (patch[key]) patch = { [key]: patch[key].slice(0, 1) }; return up(patch); }; } return made; };
n = await G.migrateGmLog('networkAccessLog');
ok(n === -1 && store.get('networkAccessLog').length === 2, 'when the journal does not read back every row, the old setting is KEPT (-1)');
j.createEmbeddedDocuments = realCreate;
for (const p of j.pages) if (p.flags[MOD].gmLog === 'networkAccessLog') delete p.update;   // a fresh page writer
j.pages.splice(j.pages.findIndex((p) => p.flags[MOD].gmLog === 'networkAccessLog'), 1);
n = await G.migrateGmLog('networkAccessLog');
ok(n === 2 && store.get('networkAccessLog').length === 0, 'next load it moves cleanly');

// ═══ 3. writes ═══
await Promise.all([1, 2, 3, 4, 5].map((i) => G.updateGmLog('traceLog', (rows) => { rows.push({ id: `x${i}` }); return rows; })));
ok(G.readGmLog('traceLog').length === 7, 'five changes at once all land (one at a time per log)');
const copy = G.readGmLog('traceLog'); copy.push({ id: 'oops' });
ok(G.readGmLog('traceLog').length === 7, 'readGmLog hands out a copy');
game.user = { id: 'p1', isGM: false };
ok((await G.writeGmLog('traceLog', [])) === false && G.readGmLog('traceLog').length === 7, 'a player cannot write a GM log');
game.user = { id: 'gm', isGM: true };
ok((await G.writeGmLog('nope', [])) === false, 'an unknown log name is refused');

// ═══ 4. the services, the migrations, and nobody else writes the old settings ═══
const TS = read('scripts/services/TraceService.js');
ok(/getLog\(\) \{ return readGmLog\(LOG_NAME\); \}/.test(TS) && /await updateGmLog\(LOG_NAME, \(rows\) => \{ rows\.push\(row\); while \(rows\.length > LOG_CAP\) rows\.shift\(\); return rows; \}\);/.test(TS), 'TraceService reads and appends through the store (cap kept)');
const NA = read('scripts/services/NetworkAccessLogService.js');
ok(/readGmLog\('networkAccessLog'\)/.test(NA) && /writeGmLog\('networkAccessLog'/.test(NA) && /updateJournalEntryPage/.test(NA), 'the access log loads, saves and reloads through the store');
const MR = read('scripts/core/MigrationRunner.js');
ok(Number(MR.match(/export const DATA_SCHEMA_VERSION = (\d+);/)?.[1]) >= 8 && /to: 7,\n\s*label: 'Trace \+ network access logs: move into a GM-only journal'/.test(MR) && /to: 8,\n\s*label: 'Interface rolls: clear the finished v3 ledger'/.test(MR), 'migrations v7 (logs) and v8 (ledger) are registered; schema 8 or later');
ok(/if \(n < 0\) throw new Error/.test(MR), 'v7 throws on a short read-back, so the version is not stamped and it runs again next load');
const { MIGRATIONS } = await import(pathToFileURL(path.join(ROOT, 'scripts/core/MigrationRunner.js')).href).catch(() => ({}));
const v8 = (MIGRATIONS || []).find((m) => m.to === 8);
if (v8) { await v8.run(); ok(JSON.stringify(store.get('ifaceShiftDone')) === '{}', 'v8 empties the finished Interface ledger'); }
else ok(/ifaceShiftDone', \{\}\)/.test(MR), 'v8 empties the finished Interface ledger');
const walk = (d, out = []) => { for (const f of readdirSync(d)) { const p = path.join(d, f); if (statSync(p).isDirectory()) walk(p, out); else if (p.endsWith('.js')) out.push(p); } return out; };
const writers = walk(path.join(ROOT, 'scripts')).map((p) => path.relative(ROOT, p).split(path.sep).join('/'))
  .filter((p) => p !== 'scripts/data/gmLogStore.js')
  .filter((p) => /settings\.set\(\s*MODULE_ID,\s*['"](traceLog|networkAccessLog)['"]|settingsManager\?*\.set\(\s*['"](traceLog|networkAccessLog)['"]/.test(read(p)));
ok(writers.length === 0, `nothing but the store writes the old settings (${writers.join(', ')})`);

console.log(`test-gm-logs: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
