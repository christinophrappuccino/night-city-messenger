// test-claude-md-split — CLAUDE.md stays small and text-only, and its system index matches dev/design/systems/.
// Stage 2, batch 1 (2026-11-05): the per-system architecture notes moved out of CLAUDE.md, which had grown to 660 KB
// (loaded into every Claude Code session) and carried two raw NUL bytes, so git treated it as a binary file.
// Run: node dev/tools/sims/test-claude-md-split.mjs   (NCM_ROOT=<dir> to check another checkout)
import { readFileSync, readdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';

const ROOT = (process.env.NCM_ROOT || fileURLToPath(new URL('../../../', import.meta.url))).replace(/\\/g, '/').replace(/\/+$/, '');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };

const BUDGET = 120_000;   // bytes. A new standing rule fits; a new as-built section belongs in dev/design/systems/.
const buf = readFileSync(`${ROOT}/CLAUDE.md`);
const md = buf.toString('utf8').replace(/\r\n/g, '\n');

// 1. small and text-only
ok(buf.length <= BUDGET, `CLAUDE.md is ${buf.length} bytes; the budget is ${BUDGET}. Move system detail to dev/design/systems/<system>.md`);
ok(!buf.includes(0), 'CLAUDE.md contains a NUL byte (git then treats it as binary: no diffs). Write an escape as text, e.g. \\u0000');

// 2. the index and the folder agree
const sysDir = `${ROOT}/dev/design/systems`;
ok(existsSync(sysDir), 'dev/design/systems/ exists');
const files = existsSync(sysDir) ? readdirSync(sysDir).filter((f) => f.endsWith('.md')) : [];
const idx = md.split('\n## System notes')[1]?.split('\n## ')[0] || '';
ok(!!idx, 'CLAUDE.md has the "System notes" index section');
const listed = [...idx.matchAll(/^\| `([a-z0-9-]+\.md)` \|/gm)].map((m) => m[1]);
ok(listed.length >= 10, `the index lists the system files (found ${listed.length})`);
for (const f of listed) ok(files.includes(f), `index lists ${f}, which exists in dev/design/systems/`);
for (const f of files) ok(listed.includes(f), `dev/design/systems/${f} is listed in CLAUDE.md's index`);

// 3. each system file says where it came from, and nothing was left behind twice
const heads = new Map();
for (const f of files) {
  const t = readFileSync(`${sysDir}/${f}`, 'utf8').replace(/\r\n/g, '\n');
  ok(/^# .+\n\n> Moved verbatim from `CLAUDE\.md`/.test(t), `${f} starts with its title and the provenance note`);
  ok(!t.includes('\u0000'), `${f} has no NUL byte`);
  for (const m of t.matchAll(/^## .+$/gm)) heads.set(m[0], (heads.get(m[0]) || 0) + 1);
}
for (const m of md.matchAll(/^## .+$/gm)) heads.set(m[0], (heads.get(m[0]) || 0) + 1);
const dup = [...heads].filter(([, n]) => n > 1).map(([h]) => h);
ok(dup.length === 0, `no section heading appears in two places: ${dup.join(' | ')}`);

// 4. the rules that must stay in CLAUDE.md are still there
for (const [re, what] of [
  [/^## Verification$/m, 'Verification'], [/^## Architecture: the rules the 2026-11 audit introduced$/m, 'the audit rules'],
  [/^## Architecture: how startup works$/m, 'startup'], [/^## Foundry v12 \/ ApplicationV2 gotchas$/m, 'Foundry gotchas'],
  [/^## CSS specificity patterns$/m, 'CSS patterns'], [/^## Conventions$/m, 'Conventions'], [/^## Data layout$/m, 'Data layout'],
  [/check-syntax\.mjs/, 'the syntax-check command'],
]) ok(re.test(md), `CLAUDE.md keeps ${what}`);

// 5. every sim the notes cite still exists
const docs = md + files.map((f) => readFileSync(`${sysDir}/${f}`, 'utf8')).join('\n');
const cited = new Set([...docs.matchAll(/dev\/tools\/sims\/([a-z0-9-]+\.mjs)/g)].map((m) => m[1]));
const missing = [...cited].filter((s) => !existsSync(`${ROOT}/dev/tools/sims/${s}`));
ok(missing.length === 0, `every cited sim exists (missing: ${missing.join(', ')})`);

console.log(`test-claude-md-split: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
