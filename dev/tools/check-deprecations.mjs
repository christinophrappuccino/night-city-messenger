// check-deprecations — NCM keeps reaching moved Foundry APIs through scripts/utils/compat.js (stage 2, step 10:
// Foundry v13 readiness). Run by run-checks (and so by CI).
//
// 1. MOVED: names Foundry v13 moved into namespaces and compat.js now covers. Any use outside compat.js fails —
//    on v13 it prints a deprecation warning, and a later version removes the old name.
// 2. RATCHET: v12-era APIs still used in many places, to be moved in later batches. Each has a recorded count; a
//    count that goes UP fails (new code must not add more), a count that goes DOWN asks you to lower the number here.
//
// Run: node dev/tools/check-deprecations.mjs   (exit 1 on a problem)
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const walk = (d, out = []) => { for (const f of readdirSync(d)) { const p = path.join(d, f); if (statSync(p).isDirectory()) walk(p, out); else if (p.endsWith('.js')) out.push(p); } return out; };
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
// comments name things without using them; strings rarely do (a template literal's ${…} still counts)
const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
const files = walk(path.join(ROOT, 'scripts')).filter((f) => rel(f) !== 'scripts/utils/compat.js');
const src = files.map((f) => [rel(f), code(readFileSync(f, 'utf8'))]);

// 1. moved names: a bare identifier (not `.Name`, not part of a longer word), excluding object keys / method names
const MOVED = {
  renderTemplate: 'compat.renderTemplate', loadTemplates: 'compat.loadTemplates', getTemplate: 'compat.getTemplate',
  FilePicker: 'compat.FilePickerClass / newFilePicker / browseFiles', ImagePopout: 'compat.ImagePopoutClass',
  DocumentOwnershipConfig: 'compat.DocumentOwnershipConfigClass', SettingsConfig: 'compat.SettingsConfigClass',
  InteractionLayer: 'compat.InteractionLayerClass',
};
const problems = [];
for (const [f, t] of src) {
  for (const [name, use] of Object.entries(MOVED)) {
    // a file that imports this very name from compat.js calls the compat version when it writes it bare
    if (new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*'[./]+utils/compat\\.js'`).test(t)) continue;
    const re =new RegExp(`(?<![\\w$.])${name}\\b(?!\\s*:)`, 'g');
    for (const m of t.matchAll(re)) {
      const line = t.slice(0, m.index).split('\n').length;
      const lineText = t.split('\n')[line - 1];
      if (new RegExp(`^\\s*(?:async\\s+)?${name}\\s*\\(`).test(lineText) && /\)\s*\{\s*$/.test(lineText)) continue;   // a method definition (SpamService.getTemplate)
      if (new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*'[./]+utils/compat\\.js'`).test(lineText)) continue;   // importing it from compat
      if (new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from`).test(lineText)) { continue; }   // a same-named import from elsewhere (resolved by that module)
      problems.push(`${f}:${line} uses ${name} directly — use ${use}`);
    }
  }
}
// the template functions must come from compat wherever they are called bare
for (const [f, t] of src) for (const fn of ['renderTemplate', 'loadTemplates', 'getTemplate']) {
  if (f.endsWith('SpamService.js') || f.endsWith('SpamTab.js')) continue;
  const calls = new RegExp(`(?<![\\w$.])${fn}\\(`).test(t.replace(new RegExp(`^\\s*(?:async\\s+)?${fn}\\s*\\([^)]*\\)\\s*\\{`, 'gm'), ''));
  const imported = new RegExp(`import\\s*\\{[^}]*\\b${fn}\\b[^}]*\\}\\s*from\\s*'[./]+utils/compat\\.js'`).test(t);
  if (calls && !imported) problems.push(`${f} calls ${fn}() without importing it from utils/compat.js (it would reach the deprecated global)`);
}

// 2. ratchet — counts as of 2026-11-05 (stage 2, step 10a). Lower a number when you migrate some; never raise it.
const RATCHET = [
  ['jQuery html.find(', /\bhtml\.find\(/g, 58],     // 110 → 58: dialog field reads moved to htmlOf (B8c)
  ['jQuery $(', /(?<![\w$.])\$\(/g, 8],             // 39 → 8: two local querySelector helpers renamed (never jQuery)
];

// 3. banned outright since step 10a-2 (handled in compat.js; v13 changed their shape)
const BANNED = [
  [/['"]renderChatMessage['"]/g, "the 'renderChatMessage' hook (deprecated in v13, removed in v15) — use compat.onRenderChatMessage"],
  [/\bcontrols\.push\(/g, 'pushing onto the scene controls (an array on v12, a record on v13) — use compat.addSceneControlGroup'],
  // since the DialogV2 switch (stage 2): every dialog is an NcmDialog (utils/ncmDialog.js) through the adminTheme.js wrappers
  [/(?<![\w$.])(?:new\s+Dialog\(|Dialog\.(?:confirm|prompt|wait)\()/g, 'the v1 Dialog (deprecated in v13, removed in v16) — use adminDialog / adminConfirm / playerDialog … (utils/adminTheme.js), which build an NcmDialog'],
];
for (const [f, t] of src) for (const [re, why] of BANNED) for (const m of t.matchAll(re)) problems.push(`${f}:${t.slice(0, m.index).split('\n').length} uses ${why}`);
const counts = [];
for (const [label, re, max] of RATCHET) {
  const n = src.reduce((s, [, t]) => s + (t.match(re) || []).length, 0);
  counts.push(`${label}: ${n}${n < max ? ` (recorded ${max} — lower it in check-deprecations.mjs)` : ''}`);
  if (n > max) problems.push(`${label}: ${n} uses, more than the recorded ${max}. New code should go through utils/compat.js (htmlOf for jQuery) instead`);
}

if (problems.length) { for (const p of problems) console.error('FAIL:', p); console.error(`check-deprecations: ${problems.length} problem(s)`); process.exit(1); }
console.log(`✓ check-deprecations: moved names only in compat.js; still to move — ${counts.join('; ')}`);
