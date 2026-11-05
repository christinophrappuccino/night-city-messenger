// run-checks — every automated check NCM has, in one command. CI runs this before a dev build or a release.
//
//   node dev/tools/run-checks.mjs              syntax + paths + deprecations + every dev/tools/sims/test-*.mjs (as v12)
//   node dev/tools/run-checks.mjs --sims       only the sims
//   node dev/tools/run-checks.mjs --jobs 8     run 8 sims at once (default 4)
//   node dev/tools/run-checks.mjs --foundry 13 run the sims as Foundry v13 (12, 13 or all; default NCM_FOUNDRY_VERSION or 12)
//
// The sims run with dev/tools/sims/lib/profilePreload.mjs loaded first, which stamps the chosen version's
// game.release onto every mocked `game` (lib/foundryVersion.mjs holds the profiles). CI runs the suite once per version.
// The cdp-*.mjs sims drive headless Chrome against the mockup server and are NOT run here.
// Sims that render templates need Foundry's Handlebars: on this machine they find the Foundry install; elsewhere
// set NCM_FOUNDRY_APP to a folder with node_modules/handlebars (see dev/tools/sims/lib/foundryApp.mjs).
// Exit code 1 when anything fails.
import { spawn } from 'child_process';
import { readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const args = process.argv.slice(2);
const onlySims = args.includes('--sims');
const jobs = Math.max(1, Number(args[args.indexOf('--jobs') + 1]) || 4);
const want = args.includes('--foundry') ? args[args.indexOf('--foundry') + 1] : (process.env.NCM_FOUNDRY_VERSION || '12');
const VERSIONS = want === 'all' ? ['12', '13'] : [String(want)];
if (VERSIONS.some((v) => !['12', '13'].includes(v))) { console.error(`--foundry ${want}: use 12, 13 or all`); process.exit(2); }
const PRELOAD = pathToFileURL(path.join(ROOT, 'dev/tools/sims/lib/profilePreload.mjs')).href;
const TIMEOUT_MS = 120_000;   // one sim; the slowest today takes a few seconds

const run = (file, version = null) => new Promise((resolve) => {
  const started = Date.now();
  const argv = version ? ['--import', PRELOAD, file] : [file];
  const env = version ? { ...process.env, NCM_FOUNDRY_VERSION: version } : process.env;
  const child = spawn(process.execPath, argv, { cwd: ROOT, env });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const timer = setTimeout(() => { out += `\n(timed out after ${TIMEOUT_MS / 1000}s)`; child.kill(); }, TIMEOUT_MS);
  child.on('close', (code) => { clearTimeout(timer); resolve({ file, version, code, out, ms: Date.now() - started }); });
});

const failures = [];
const report = (r) => {
  const name = path.relative(ROOT, r.file).split(path.sep).join('/') + (r.version && VERSIONS.length > 1 ? ` @v${r.version}` : '');
  if (r.code === 0) return;
  failures.push(name);
  const tail = r.out.trim().split('\n').slice(-15).join('\n');
  console.log(`\n✗ ${name} (exit ${r.code})\n${tail}`);
};

if (!onlySims) {
  for (const tool of ['check-syntax.mjs', 'check-paths.mjs', 'check-deprecations.mjs']) {
    const r = await run(path.join(ROOT, 'dev/tools', tool));
    console.log(r.out.trim().split('\n').slice(-1)[0] || `${tool} done`);
    report(r);
  }
}

const simDir = path.join(ROOT, 'dev/tools/sims');
const sims = readdirSync(simDir).filter((f) => /^test-.*\.mjs$/.test(f)).sort().map((f) => path.join(simDir, f));
for (const version of VERSIONS) {
  let next = 0, done = 0;
  const before = failures.length;
  const t0 = Date.now();
  await Promise.all(Array.from({ length: Math.min(jobs, sims.length) }, async () => {
    while (next < sims.length) { const r = await run(sims[next++], version); done++; report(r); }
  }));
  console.log(`\nsims (Foundry v${version}): ${done - (failures.length - before)} of ${done} passed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

if (failures.length) { console.log(`\nFAILED (${failures.length}): ${failures.join(', ')}`); process.exit(1); }
console.log('\nall checks passed');
