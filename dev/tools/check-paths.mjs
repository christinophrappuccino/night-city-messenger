// check-paths — every path the module loads exists with EXACT case.
// Windows (where NCM is developed) ignores case in file names; Linux (The Forge, most hosted servers, CI) does not.
// A wrong-case import or template path works on the dev machine and breaks the module for everyone on Linux.
// Checks: relative imports in scripts/**/*.js (static and dynamic), every TEMPLATES path in constants.js, every
// @import in the stylesheets, and module.json's esmodules / styles / languages / packs.
// Run: node dev/tools/check-paths.mjs   (exit 1 on any problem)
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const problems = [];
const dirCache = new Map();
const listDir = (d) => { if (!dirCache.has(d)) { try { dirCache.set(d, new Set(readdirSync(d))); } catch { dirCache.set(d, null); } } return dirCache.get(d); };

/** true when `abs` exists and every segment below ROOT matches the on-disk name exactly */
function existsExact(abs) {
  const rel = path.relative(ROOT, abs);
  if (rel.startsWith('..')) return existsSync(abs);   // outside the module (e.g. Foundry's own files): not ours to check
  let cur = ROOT;
  for (const seg of rel.split(path.sep)) {
    const names = listDir(cur);
    if (!names || !names.has(seg)) return false;
    cur = path.join(cur, seg);
  }
  return true;
}
const check = (from, target, abs) => { if (!existsExact(abs)) problems.push(`${from}: "${target}" does not exist with that exact case`); };

// 1. JS imports
const walk = (d, out = []) => { for (const f of readdirSync(d)) { const p = path.join(d, f); if (statSync(p).isDirectory()) walk(p, out); else if (p.endsWith('.js')) out.push(p); } return out; };
const jsFiles = walk(path.join(ROOT, 'scripts'));
// block comments and whole-line // comments hold example paths ("await import('./modules/…')") — not real loads
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const assetPaths = [];   // [from, rel] — module-relative files the code names in full
for (const f of jsFiles) {
  const t = stripComments(readFileSync(f, 'utf8'));
  const rel = path.relative(ROOT, f).split(path.sep).join('/');
  const specs = [
    ...[...t.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+['"](\.{1,2}\/[^'"]+)['"]/gms)].map((m) => m[1]),
    ...[...t.matchAll(/^\s*import\s+['"](\.{1,2}\/[^'"]+)['"]/gm)].map((m) => m[1]),
    ...[...t.matchAll(/import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)].map((m) => m[1]),
  ];
  for (const s of specs) check(rel, s, path.resolve(path.dirname(f), s));
  // 2a. module-relative files named in full: `modules/${MODULE_ID}/templates/x.hbs`, 'modules/night-city-messenger/assets/…'
  for (const m of t.matchAll(/['"`]modules\/(?:\$\{MODULE_ID\}|night-city-messenger)\/([^'"`$?#]+\.(?:hbs|css|js|svg|png|webp|jpg|ogg|mp3|wav|pdf|json))['"`]/g)) assetPaths.push([rel, m[1]]);
  // 2b. constants.js's TEMPLATES: `${T}/x.hbs` where T = `modules/${MODULE_ID}/templates`
  if (rel === 'scripts/utils/constants.js') for (const m of t.matchAll(/`\$\{T\}\/([^`$]+\.hbs)`/g)) assetPaths.push([rel + ' TEMPLATES', `templates/${m[1]}`]);
}

// 2. the module-relative files found above
for (const [from, p] of assetPaths) check(from, p, path.join(ROOT, p));
const hbsTotal = assetPaths.length;

// 3. stylesheet @imports (recursively from the entry)
const seenCss = new Set();
const cssWalk = (abs) => {
  if (seenCss.has(abs)) return; seenCss.add(abs);
  const t = readFileSync(abs, 'utf8');
  for (const m of t.matchAll(/@import\s+(?:url\()?['"]([^'"]+)['"]/g)) {
    if (/^(https?:)?\/\//.test(m[1])) continue;
    const next = path.resolve(path.dirname(abs), m[1]);
    const rel = path.relative(ROOT, abs).split(path.sep).join('/');
    if (!existsExact(next)) { problems.push(`${rel}: @import "${m[1]}" does not exist with that exact case`); continue; }
    cssWalk(next);
  }
};
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'module.json'), 'utf8'));
for (const s of manifest.styles || []) { const abs = path.join(ROOT, s); check('module.json styles', s, abs); if (existsExact(abs)) cssWalk(abs); }

// 4. the rest of module.json
for (const s of manifest.esmodules || []) check('module.json esmodules', s, path.join(ROOT, s));
for (const l of manifest.languages || []) check('module.json languages', l.path, path.join(ROOT, l.path));
for (const p of manifest.packs || []) {
  // the LevelDB folder is generated (gitignored); its .db twin is the committed source
  const dir = path.join(ROOT, p.path);
  if (!existsExact(dir) && !existsExact(`${dir}.db`)) problems.push(`module.json packs: neither "${p.path}" nor "${p.path}.db" exists with that exact case`);
}

if (problems.length) { for (const p of problems) console.error('FAIL:', p); console.error(`check-paths: ${problems.length} problem(s)`); process.exit(1); }
console.log(`✓ check-paths: ${jsFiles.length} scripts, ${hbsTotal} named files (templates, icons, sounds), ${seenCss.size} stylesheets — every path exists with exact case`);
