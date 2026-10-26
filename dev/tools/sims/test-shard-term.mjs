// Sim: what players call a shard — the `shardTerm` world setting (tester
// 2026-10-26: "shard" is a 2077 word, a 2045 table says "memory chip").
// Drives the REAL scripts/utils/shardTerm.js, renders player-facing template
// snippets through Foundry's own Handlebars with the real helper, and guards
// that no player-facing template or string hardcodes "shard" again.
// Run: node dev/tools/sims/test-shard-term.mjs
import { readFileSync, existsSync, readdirSync } from 'fs';
import { createRequire } from 'module';
import { pathToFileURL, fileURLToPath } from 'url';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };
const read = (p) => readFileSync(`${ROOT}/${p}`, 'utf8');

let Handlebars = null;
for (const p of ['C:/Program Files/Foundry Virtual Tabletop/resources/app/package.json', 'C:/Program Files (x86)/Foundry Virtual Tabletop/resources/app/package.json']) {
  if (!existsSync(p)) continue;
  try { Handlebars = createRequire(p)('handlebars'); break; } catch { /* keep looking */ }
}

let SETTING = { shardTerm: 'shard', shardTermCustom: '' };
globalThis.game = { settings: { get: (_m, k) => { if (!(k in SETTING)) throw new Error('unregistered'); return SETTING[k]; } } };

const M = await import(pathToFileURL(`${ROOT}/scripts/utils/shardTerm.js`).href);

// ═══ 1. Resolution ═══
let t = M.resolveShardTerm('shard');
ok(t.one === 'Data Shard' && t.many === 'Data Shards' && t.short === 'Shard' && t.shortMany === 'Shards', 'default preset');
t = M.resolveShardTerm('chip');
ok(t.one === 'Memory Chip' && t.short === 'Chip' && t.shortMany === 'Chips', 'memory chip preset');
ok(M.resolveShardTerm('datachip').one === 'Data Chip', 'data chip preset');
ok(M.resolveShardTerm('bogus').one === 'Data Shard', 'unknown key → default');
ok(M.resolveShardTerm('custom', '').one === 'Data Shard', 'custom with nothing typed → default');
t = M.resolveShardTerm('custom', 'Data Wafer');
ok(t.one === 'Data Wafer' && t.many === 'Data Wafers' && t.short === 'Wafer' && t.shortMany === 'Wafers', 'custom: plural + short derived');
t = M.resolveShardTerm('custom', 'Optical Disc / Optical Discs');
ok(t.many === 'Optical Discs' && t.shortMany === 'Discs', 'custom: explicit plural');
ok(M.resolveShardTerm('custom', 'Data Box').many === 'Data Boxes' && M.resolveShardTerm('custom', 'Memory').many === 'Memories', 'custom: -es / -ies plurals');
ok(M.withArticle('chip') === 'a chip' && M.withArticle('optical disc') === 'an optical disc', 'a / an');
ok(M.caseTerm('Memory Chip', 'upper') === 'MEMORY CHIP' && M.caseTerm('Memory Chip', 'lower') === 'memory chip', 'case');

// reads the setting, and survives it being unregistered
SETTING = { shardTerm: 'chip', shardTermCustom: '' };
ok(M.shardTerm('short') === 'Chip' && M.shardTerm('one', 'upper') === 'MEMORY CHIP', 'shardTerm reads the setting');
const saved = globalThis.game; globalThis.game = undefined;
ok(M.shardTerm('one') === 'Data Shard', 'no settings yet → default, no throw');
globalThis.game = saved;
ok(Object.keys(M.SHARD_TERM_PRESETS).includes('custom') && M.SHARD_TERM_FORMS.length === 4, 'presets + forms');

// ═══ 2. The Handlebars helper through real Handlebars ═══
if (Handlebars) {
  M.registerShardTermHelper(Handlebars);
  const r = (src, ctx = {}) => Handlebars.compile(src)(ctx);
  ok(r('{{ncm-term "shortMany"}}') === 'Chips', 'helper plain');
  ok(r('{{ncm-term "short" "upper"}}') === 'CHIP', 'helper cased');
  ok(r('{{ncm-term "one"}}') === 'Memory Chip', 'helper default form');
  ok(r('{{ncm-term "short" "lower" pre="Make " a=true post=" of your own"}}') === 'Make a chip of your own', 'helper pre / a / post');
  Handlebars.registerPartial('p', '<i>{{prompt}}</i>');
  ok(r('{{> p prompt=(ncm-term "short" "upper" pre="> " post=" SLOT EMPTY") }}') === '<i>&gt; CHIP SLOT EMPTY</i>', 'helper as a partial argument');
  SETTING = { shardTerm: 'custom', shardTermCustom: 'Optical Disc' };
  ok(r('{{ncm-term "one" "lower" a=true}}') === 'an optical disc' && r('{{ncm-term "short" "lower" a=true}}') === 'a disc', 'article follows the custom word');
  // the real templates compile with the helper in place
  for (const f of ['templates/message-viewer/message-viewer.hbs', 'templates/item-inbox/item-inbox.hbs', 'templates/item-inbox/security-overlay-login.hbs',
    'templates/item-inbox/security-overlay-network.hbs', 'templates/character-select/character-select.hbs', 'templates/dialogs/dead-zone-warning.hbs',
    'templates/theme-customizer/theme-customizer.hbs', 'templates/message-composer/message-composer.hbs']) {
    let compiles = true;
    try { Handlebars.precompile(read(f)); } catch (e) { compiles = false; console.error(e.message); }
    ok(compiles, `${f} compiles`);
  }
  SETTING = { shardTerm: 'chip', shardTermCustom: '' };
} else {
  fail++; console.error('FAIL: Handlebars not found in a Foundry install — the render checks did not run');
}

// ═══ 3. Guards: no hardcoded "shard" on player-facing screens ═══
// Visible text = text between tags + title / placeholder / data-tooltip / aria-label.
const PLAYER_TEMPLATES = ['templates/message-viewer/message-viewer.hbs', 'templates/item-inbox/item-inbox.hbs',
  'templates/item-inbox/security-overlay-login.hbs', 'templates/item-inbox/security-overlay-network.hbs',
  'templates/character-select/character-select.hbs', 'templates/dialogs/dead-zone-warning.hbs',
  'templates/theme-customizer/theme-customizer.hbs', 'templates/message-composer/message-composer.hbs'];
for (const f of PLAYER_TEMPLATES) {
  const src = read(f).replace(/\{\{!--[\s\S]*?--\}\}/g, '').replace(/\{\{![^}]*\}\}/g, '');
  const hits = [];
  for (const m of src.matchAll(/(?:title|placeholder|data-tooltip|aria-label|alt)="([^"]*)"/g)) {
    if (/\bshards?\b/i.test(m[1].replace(/\{\{[^}]*\}\}/g, ''))) hits.push(m[1]);
  }
  const text = src.replace(/<[^>]*>/g, ' ').replace(/\{\{[\s\S]*?\}\}/g, ' ');
  for (const m of text.matchAll(/[^\n]*\bshards?\b[^\n]*/gi)) hits.push(m[0].trim());
  ok(!hits.length, `${f}: no hardcoded "shard" in visible text${hits.length ? ` — ${hits.slice(0, 3).join(' | ')}` : ''}`);
}

// Player-facing JS: user-visible strings (toasts, titles, labels) never say "shard".
const PLAYER_JS = ['scripts/integrations/ShardSheetOverride.js', 'scripts/ui/ShardEncoder/ShardEncoderApp.js',
  'scripts/ui/ItemInbox/ItemInboxApp.js', 'scripts/ui/MessageViewer/MessageViewerApp.js', 'scripts/ui/Terminal/TerminalViewerApp.js',
  'scripts/ui/MessageComposer/MessageComposerApp.js', 'scripts/ui/ProgramDeck/ProgramDeckApp.js', 'scripts/services/NotificationService.js'];
const VISIBLE = /(ui\.notifications\??\.(info|warn|error)\(|title:|label:|subtitle:|hint:|detail:|tag\.title|btn\.title|addOption\(|_status\(|placeholder=)/;
for (const f of PLAYER_JS) {
  const bad = [];
  read(f).split('\n').forEach((ln, i) => {
    if (/^\s*(\/\/|\*)/.test(ln) || !VISIBLE.test(ln)) return;
    const strs = [...ln.matchAll(/(['"`])((?:\\.|(?!\1).)*)\1/g)].map((m) => m[2].replace(/\$\{[^}]*\}/g, ''));
    if (strs.some((s) => /\bshards?\b/i.test(s) && !/^[\w.-]+$/.test(s))) bad.push(`${i + 1}: ${ln.trim().slice(0, 100)}`);
  });
  ok(!bad.length, `${f}: no hardcoded "shard" in visible strings${bad.length ? `\n    ${bad.slice(0, 5).join('\n    ')}` : ''}`);
}

// Wiring
ok(/'shardTerm'/.test(read('scripts/core/SettingsManager.js')) && /'shardTermCustom'/.test(read('scripts/core/SettingsManager.js')), 'both settings registered');
ok(/registerShardTermHelper\(Handlebars\)/.test(read('scripts/init/registerTemplates.js')), 'helper registered');
ok(/static get SHARD_GONE_MSG\(\)/.test(read('scripts/ui/MessageViewer/MessageViewerApp.js')), 'load-time message became a getter');
ok(/get label\(\) \{ return `Burn to \$\{T\('short'\)\}`/.test(read('scripts/ui/Terminal/TerminalViewerApp.js')), 'exfil menu label read when shown');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
