// test-ci-checks — the automated checks run in CI and gate every dev build and release (stage 2, batch 2).
// Also: sims find Foundry's Handlebars through ONE helper (so they can run where Foundry isn't installed), and the
// exact-case path check passes (Windows ignores case; Linux hosts such as The Forge do not).
// Run: node dev/tools/sims/test-ci-checks.mjs   (NCM_ROOT=<dir> to check another checkout)
import { readFileSync, readdirSync, existsSync } from 'fs';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = (process.env.NCM_ROOT || fileURLToPath(new URL('../../../', import.meta.url))).replace(/\\/g, '/').replace(/\/+$/, '');
const read = (p) => (existsSync(`${ROOT}/${p}`) ? readFileSync(`${ROOT}/${p}`, 'utf8').replace(/\r\n/g, '\n') : '');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };

// 1. the checks workflow
const checks = read('.github/workflows/checks.yml');
ok(!!checks, '.github/workflows/checks.yml exists');
ok(/workflow_call:/.test(checks), 'checks.yml can be called by the build workflows (workflow_call)');
ok(/pull_request:/.test(checks) && /branches-ignore:\s*\n\s*- dev/.test(checks), 'checks.yml runs on pushes to other branches and on pull requests (dev runs it through dev-build)');
ok(/node dev\/tools\/run-checks\.mjs/.test(checks), 'checks.yml runs dev/tools/run-checks.mjs');
const hbPin = (checks.match(/handlebars@([0-9.]+)/) || [])[1];
ok(!!hbPin, 'checks.yml installs a pinned Handlebars');
ok(/NCM_FOUNDRY_APP=/.test(checks), 'checks.yml points the sims at it with NCM_FOUNDRY_APP');
// the pin must be the version Foundry ships (checked only where Foundry is installed)
for (const p of ['C:/Program Files/Foundry Virtual Tabletop/resources/app/node_modules/handlebars/package.json']) {
  if (!existsSync(p)) continue;
  const v = JSON.parse(readFileSync(p, 'utf8')).version;
  ok(v === hbPin, `CI's Handlebars ${hbPin} is the version Foundry ships (${v})`);
}

// 2. both publishing workflows wait for it
for (const [file, job] of [['release.yml', 'release'], ['dev-build.yml', 'dev-build']]) {
  const t = read(`.github/workflows/${file}`);
  ok(/\n  checks:\n    uses: \.\/\.github\/workflows\/checks\.yml/.test(t), `${file} runs the checks workflow`);
  ok(new RegExp(`\\n  ${job}:\\n    needs: checks`).test(t), `${file}: the ${job} job only runs once the checks pass`);
}

// 3. the runner and its tools exist
for (const f of ['dev/tools/run-checks.mjs', 'dev/tools/check-paths.mjs', 'dev/tools/check-syntax.mjs', 'dev/tools/sims/lib/foundryApp.mjs']) ok(existsSync(`${ROOT}/${f}`), `${f} exists`);
ok(/test-\.\*\\\.mjs/.test(read('dev/tools/run-checks.mjs')) && /cdp-\*\.mjs sims/.test(read('dev/tools/run-checks.mjs')), 'run-checks runs every test-*.mjs sim and says why cdp-* are left out');

// 4. no sim hard-codes a Foundry install path (they go through lib/foundryApp.mjs)
const simDir = `${ROOT}/dev/tools/sims`;
const hard = readdirSync(simDir).filter((f) => f.endsWith('.mjs'))
  .filter((f) => {
    const t = readFileSync(`${simDir}/${f}`, 'utf8');
    // a sim may still list extra install paths, but it must also ask the helper (so CI's copy is found)
    return /['"`]C:\/Program Files[^'"`]*Foundry[^'"`]*['"`]/.test(t) && !/lib\/foundryApp\.mjs/.test(t);
  });
ok(hard.length === 0, `every sim that looks for Foundry also asks lib/foundryApp.mjs (not: ${hard.join(', ')})`);

// 5. every path the module loads exists with exact case
if (existsSync(`${ROOT}/dev/tools/check-paths.mjs`)) {
  const r = spawnSync(process.execPath, [`${ROOT}/dev/tools/check-paths.mjs`], { encoding: 'utf8' });
  ok(r.status === 0, `check-paths passes:\n${(r.stderr || r.stdout).trim().split('\n').slice(0, 6).join('\n')}`);
}

console.log(`test-ci-checks: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
