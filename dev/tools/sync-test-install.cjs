// sync-test-install — copy NCM into ANOTHER Foundry data folder (e.g. a v13 test install), exactly what a release ships.
//
//   node dev/tools/sync-test-install.cjs --data C:/Users/cphan/AppData/Local/FoundryVTT-v13/Data
//   node dev/tools/sync-test-install.cjs --data <Data folder> --dry-run      (list, copy nothing)
//   node dev/tools/sync-test-install.cjs --data <Data folder> --any-system   (the copy loads in any system — see below)
//
// The file list is read from dev/tools/build-zip.cjs (its SHIP array), so the test install can't differ from a release.
// It COPIES (never links): a Foundry update of the module in the test install must not be able to reach this git
// checkout (the standing rule — never install a build over the checkout). The target folder is replaced each run.
// Re-run it after a change; then reload the test world.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const args = process.argv.slice(2);
const dataIdx = args.indexOf('--data');
const dry = args.includes('--dry-run');
if (dataIdx < 0 || !args[dataIdx + 1]) { console.error('sync-test-install: give --data <the other Foundry Data folder>'); process.exit(1); }
const DATA = path.resolve(args[dataIdx + 1]);
const id = JSON.parse(fs.readFileSync(path.join(ROOT, 'module.json'), 'utf8')).id;
const TARGET = path.join(DATA, 'modules', id);

// refuse anything that could touch this checkout
const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
if (real(TARGET) === real(ROOT) || real(TARGET).startsWith(real(ROOT) + path.sep) || real(ROOT).startsWith(real(TARGET) + path.sep)) {
  console.error(`sync-test-install: refusing — ${TARGET} is this checkout (or inside / around it)`); process.exit(1);
}
if (!fs.existsSync(path.join(DATA, 'modules'))) { console.error(`sync-test-install: ${DATA} has no modules/ folder — is it a Foundry Data folder?`); process.exit(1); }

// the release allowlist, read from build-zip.cjs
const zipSrc = fs.readFileSync(path.join(__dirname, 'build-zip.cjs'), 'utf8');
const SHIP = [...((zipSrc.match(/const SHIP = \[([\s\S]*?)\];/) || [])[1] || '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
if (SHIP.length < 5) { console.error('sync-test-install: could not read SHIP from build-zip.cjs'); process.exit(1); }
const SKIP = /(^|[\\/])(LOCK|LOG|LOG\.old)$/;   // LevelDB lock/log files are never copied

let files = 0, bytes = 0;
const copy = (rel) => {
  const from = path.join(ROOT, rel), to = path.join(TARGET, rel);
  if (!fs.existsSync(from)) { console.warn(`  (missing in the checkout: ${rel})`); return; }
  const st = fs.statSync(from);
  if (st.isDirectory()) { for (const f of fs.readdirSync(from)) copy(path.join(rel, f)); return; }
  if (SKIP.test(rel)) return;
  files++; bytes += st.size;
  if (!dry) { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); }
};

if (!dry && fs.existsSync(TARGET)) fs.rmSync(TARGET, { recursive: true, force: true });
for (const rel of SHIP) copy(rel);
console.log(`sync-test-install: ${dry ? 'would copy' : 'copied'} ${files} files (${(bytes / 1048576).toFixed(1)} MB) → ${TARGET}`);

// --any-system: in THE COPY only, drop module.json's systems relationship so NCM can load in a world of another system
// (a Foundry version the Cyberpunk RED system doesn't support yet). Tests Foundry-level code; CPR data paths can't run.
if (args.includes('--any-system') && !dry) {
  const mf = path.join(TARGET, 'module.json');
  const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
  if (m.relationships) delete m.relationships.systems;
  m.title = `${m.title} (test copy — any system)`;
  fs.writeFileSync(mf, JSON.stringify(m, null, 2) + '\n');
  console.log('sync-test-install: --any-system — the copy\'s module.json no longer requires a system (the repo\'s is unchanged)');
}
