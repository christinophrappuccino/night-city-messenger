// Sim: the dev-build channel can never reach regular users, and ships what a release ships.
//   node dev/tools/sims/test-dev-build.mjs
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const read = (p) => readFileSync(`${ROOT}${p}`, 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };

const zipList = (text) => {
  const m = text.match(/zip -r module\.zip \\\n([\s\S]*?)\n\n/);
  return m ? m[1].split('\n').map((l) => l.trim().replace(/\s*\\$/, '')).filter(Boolean).sort().join() : null;
};
const dev = read('.github/workflows/dev-build.yml');
const rel = read('.github/workflows/release.yml');
const tool = read('dev/tools/build-zip.cjs');
const mod = JSON.parse(read('module.json'));

// Ships the same files
ok(zipList(dev) && zipList(dev) === zipList(rel), 'dev build and release zip the same list');
ok(tool.includes("'dev-build.yml'") && tool.includes("'release.yml'"), 'build-zip guards both workflows');

// Cannot become a release
ok(/prerelease: true/.test(dev), 'published as a prerelease');
ok(/make_latest: false/.test(dev), 'never marked latest');
ok(/tag_name: dev-build/.test(dev), 'uses the dev-build tag');
ok(!/^v/.test('dev-build') && /tags:\n\s+- "v\*"/.test(rel), 'the tag cannot trigger release.yml');
ok(/branches:\n\s+- dev\n/.test(dev) && !/- main/.test(dev), 'only the dev branch builds');
ok(/^\s+contents: write/m.test(dev), 'may write its release');

// Stamps its own channel
ok(dev.includes('/releases/download/dev-build"') && dev.includes('--arg manifest "${BASE_URL}/module.json"'), 'manifest stays on the dev channel');
ok(dev.includes('${BASE}.${GITHUB_RUN_NUMBER}'), 'four-part version, always newer');
ok(dev.includes('(.title + " (dev)")'), 'title says dev');
ok(dev.includes('--require-ldb'), 'builds the macro packs');

// The committed module.json still points regular users at stable
ok(mod.manifest.endsWith('/releases/latest/download/module.json'), 'committed manifest is the stable URL');
ok(!mod.title.includes('(dev)'), 'committed title is clean');

console.log(`test-dev-build: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
