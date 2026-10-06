/**
 * Syntax gate for the module's ES modules.
 * @file tools/check-syntax.mjs
 * @description `node --check path/to/file.js` is NOT sufficient here and will pass
 *   a file that cannot load. For a `.js` file with no package type, node parses it
 *   as CommonJS, and some escapes that are fatal in module context survive that.
 *   A single mis-escaped quote inside a template literal passed `--check` and then
 *   failed at import with "missing ) after argument list" — invisible until the
 *   window refused to open.
 *
 *   The fix is the file EXTENSION: `node --check` parses `.mjs` in module context.
 *   So each file is copied to a temp `.mjs` and checked there. That is parse-only —
 *   nothing is executed, which matters because several files in tools/ run a CLI on
 *   load and an `import()`-based check would fire them.
 *
 *   Usage:  node tools/check-syntax.mjs [dir ...]      (default: scripts tools)
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = process.argv.slice(2).length ? process.argv.slice(2) : ['scripts', 'tools'];
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ncm-syntax-'));

const files = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (/\.(js|mjs)$/.test(e.name)) files.push(p);
  }
};
for (const d of DIRS) {
  const abs = path.join(ROOT, d);
  if (fs.existsSync(abs)) walk(abs);
}

const check = (file, i) => new Promise((resolve) => {
  const tmp = path.join(TMP, `f${i}.mjs`);
  fs.copyFileSync(file, tmp);
  execFile(process.execPath, ['--check', tmp], (err, _out, stderr) => {
    resolve(err ? { file, msg: String(stderr).split('\n').filter(Boolean).slice(0, 4).join('\n    ') } : null);
  });
});

// Bounded concurrency — one spawn per file, a few hundred files.
const LIMIT = 12;
const results = [];
for (let i = 0; i < files.length; i += LIMIT) {
  results.push(...await Promise.all(files.slice(i, i + LIMIT).map((f, j) => check(f, i + j))));
}

const bad = results.filter(Boolean);
for (const b of bad) console.log(`✗ ${path.relative(ROOT, b.file)}\n    ${b.msg}`);

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${bad.length ? '✗' : '✓'} ${files.length} files parsed as ES modules, ${bad.length} broken\n`);
process.exit(bad.length ? 1 : 0);
