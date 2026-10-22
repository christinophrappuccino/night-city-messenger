#!/usr/bin/env node
// Build the distributable module.zip locally — the SAME allowlist the GitHub
// release workflow uses, so a hand-packaged (Discord) build and the workflow
// can't drift. Zero dependencies: on Windows it drives the built-in bsdtar
// (C:\Windows\System32\tar.exe can write zips), elsewhere `zip -r`.
//
//   node tools/build-zip.cjs              → dist/night-city-messenger-v<version>.zip
//   node tools/build-zip.cjs --out x.zip  → that path
//   node tools/build-zip.cjs --dry-run    → list what would ship, build nothing
//
// What ships (and only this): module.json, LICENSE, README.md,
// scripts/, styles/, templates/, assets/, languages/, and the two NeDB macro
// packs. tools/, ALL of docs/ (the Getting Started guide is uploaded separately —
// dev, 2026-10-21 — plus design notes, mockups, the
// guide export, the gitignored rulebook PDFs), mockups/, .github/, CLAUDE.md,
// INTEGRATION.md and the Foundry-generated LevelDB pack folders never ship.
// scripts/tests/ DOES ship — main.js and five register* files import it
// statically (it runs only under debugMode).
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const outIdx = args.indexOf('--out');

/** The allowlist. Keep in step with .github/workflows/release.yml (asserted below). */
const SHIP = [
  'module.json',
  'LICENSE',
  'README.md',
  'scripts',
  'styles',
  'templates',
  'assets',
  'languages',
  'packs/ncm-macros-player.db',
  'packs/ncm-macros-gm.db',
];

/** Anything matching these must never end up inside the archive. */
const FORBIDDEN = [/^tools\//, /^docs\//, /^mockups\//, /^\.github\//, /^CLAUDE\.md$/, /^INTEGRATION\.md$/, /\.pdf$/i, /^packs\/ncm-macros-(gm|player)\//, /^\.claude\//];

function die(msg) { console.error(`build-zip: ${msg}`); process.exit(1); }

// ── 1. Drift guard: the workflow's zip list must equal ours ──
const wf = path.join(ROOT, '.github/workflows/release.yml');
if (fs.existsSync(wf)) {
  // Normalised to LF: a CRLF checkout (core.autocrlf) must not read as a missing block.
  const text = fs.readFileSync(wf, 'utf8').replace(/\r\n/g, '\n');
  const m = text.match(/zip -r module\.zip \\\n([\s\S]*?)\n\n/);
  if (!m) die('could not find the `zip -r module.zip` block in release.yml');
  const wfList = m[1].split('\n').map(l => l.trim().replace(/\s*\\$/, '')).filter(Boolean);
  const a = [...wfList].sort().join('\n'), b = [...SHIP].sort().join('\n');
  if (a !== b) die(`allowlist drift between tools/build-zip.cjs and release.yml:\n  workflow: ${wfList.join(', ')}\n  script:   ${SHIP.join(', ')}`);
}

// ── 2. Every listed path must exist ──
for (const rel of SHIP) {
  if (!fs.existsSync(path.join(ROOT, rel))) die(`listed path missing: ${rel}`);
}

// ── 3. Enumerate what will ship + forbid leaks ──
function walk(rel, out) {
  const abs = path.join(ROOT, rel);
  const st = fs.statSync(abs);
  if (st.isDirectory()) {
    for (const name of fs.readdirSync(abs).sort()) walk(path.posix.join(rel, name), out);
  } else {
    out.push(rel);
  }
}
const files = [];
for (const rel of SHIP) walk(rel, files);
const leaks = files.filter(f => FORBIDDEN.some(re => re.test(f)));
if (leaks.length) die(`forbidden files would ship:\n  ${leaks.join('\n  ')}`);
const bytes = files.reduce((n, f) => n + fs.statSync(path.join(ROOT, f)).size, 0);

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'module.json'), 'utf8'));
const version = manifest.version || '0.0.0';
const outPath = outIdx !== -1 && args[outIdx + 1]
  ? path.resolve(args[outIdx + 1])
  : path.join(ROOT, 'dist', `${manifest.id || 'night-city-messenger'}-v${version}.zip`);

console.log(`build-zip: ${manifest.id} v${version} — ${files.length} files, ${(bytes / 1024 / 1024).toFixed(2)} MB uncompressed`);
if (dryRun) {
  for (const rel of SHIP) {
    const n = files.filter(f => f === rel || f.startsWith(rel + '/')).length;
    console.log(`  ${rel}${n > 1 ? `  (${n} files)` : ''}`);
  }
  console.log('  (dry run — nothing written)');
  process.exit(0);
}

// ── 4. Write the archive ──
fs.mkdirSync(path.dirname(outPath), { recursive: true });
if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

let res;
if (process.platform === 'win32') {
  const tar = 'C:\\Windows\\System32\\tar.exe'; // bsdtar — `-a` picks the zip format from the extension
  if (!fs.existsSync(tar)) die(`${tar} not found — Windows 10 1803+ ships it`);
  res = spawnSync(tar, ['-a', '-c', '-f', outPath, ...SHIP], { cwd: ROOT, stdio: 'inherit' });
} else {
  res = spawnSync('zip', ['-r', '-q', outPath, ...SHIP], { cwd: ROOT, stdio: 'inherit' });
}
if (res.error) die(`archiver failed to start: ${res.error.message}`);
if (res.status !== 0) die(`archiver exited ${res.status}`);

// ── 5. Verify the archive lists exactly our files ──
const list = process.platform === 'win32'
  ? spawnSync('C:\\Windows\\System32\\tar.exe', ['-t', '-f', outPath], { encoding: 'utf8' })
  : spawnSync('unzip', ['-Z1', outPath], { encoding: 'utf8' });
if (list.status === 0) {
  const inZip = list.stdout.split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.endsWith('/'));
  const missing = files.filter(f => !inZip.includes(f));
  const extra = inZip.filter(f => !files.includes(f));
  if (missing.length || extra.length) die(`archive mismatch — missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'}`);
  console.log(`build-zip: verified ${inZip.length} entries`);
}
console.log(`build-zip: wrote ${path.relative(ROOT, outPath)} (${(fs.statSync(outPath).size / 1024 / 1024).toFixed(2)} MB)`);
