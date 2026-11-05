// The module's and/or/not/eq… helpers REPLACE Foundry's for every template in the game, so they must give the
// same answers as Foundry's own in a subexpression. v2.0.7 counted Handlebars' options object inside `(or …)`,
// which made the token HUD's elevation box disabled for everyone (testers 2026-11-03).
// Runs the REAL helper source through the REAL Handlebars from the Foundry install, on Foundry's real token HUD template.
// Usage: node dev/tools/sims/test-core-helpers.mjs
import { FOUNDRY_APP_DIRS } from './lib/foundryApp.mjs';
import { foundryProfile } from './lib/foundryVersion.mjs';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };

let Handlebars = null, APP = null;
for (const p of [...FOUNDRY_APP_DIRS]) {
  if (!existsSync(`${p}/package.json`)) continue;
  try { Handlebars = createRequire(`${p}/package.json`)('handlebars'); APP = p; break; } catch { /* keep looking */ }
}
if (!Handlebars) { console.log('test-core-helpers: SKIPPED (no Foundry install found for Handlebars)'); process.exit(0); }

const src = readFileSync(`${ROOT}/scripts/init/registerTemplates.js`, 'utf8').split('\r').join('');
const pick = (re, what) => { const m = src.match(re); ok(!!m, `found ${what} in registerTemplates.js`); return m ? m[0] : ''; };
const body = pick(/function _isBlock[\s\S]*?\n}\n/, '_isBlock') + pick(/function _isOptions[\s\S]*?\n}\n/, '_isOptions')
  + pick(/    Handlebars\.registerHelper\('eq'[\s\S]*?Handlebars\.registerHelper\('not'[\s\S]*?\}\);/, 'the comparison + logic helpers');
new Function('Handlebars', body)(Handlebars);
Handlebars.registerHelper('disabled', (v) => (v ? 'disabled' : ''));
{ const { registerTipHelper } = await import(new URL('../../../scripts/utils/notify.js', import.meta.url).href); registerTipHelper(Handlebars); }

// Foundry's own token HUD line, read from the install when it is there. The file is named per version (v12
// token-hud.html, v13 token-hud.hbs: lib/foundryVersion.mjs). A real install (it has templates/) WITHOUT that file is a
// failure, not a quiet fall back to the copy below — the copy would keep passing after Foundry changed the line.
// CI's Handlebars-only folder has no templates/, so the copy is used there.
let hudLine = '<input type="text" name="elevation" {{disabled (or locked (and isGamePaused (not isGM)))}}>';
const hudPath = `${APP}/${foundryProfile().tokenHud}`;
if (existsSync(`${APP}/templates`)) ok(existsSync(hudPath), `the Foundry install at ${APP} has ${foundryProfile().tokenHud} (v${foundryProfile().generation})`);
if (existsSync(hudPath)) { const m = readFileSync(hudPath, 'utf8').match(/<input[^>]*name="elevation"[^>]*>/); ok(!!m, 'Foundry token HUD has an elevation input'); if (m) hudLine = m[0]; }
const hud = Handlebars.compile(hudLine);
const dis = (ctx) => /disabled/.test(hud({ elevation: 0, ...ctx }));
ok(!dis({ locked: false, isGamePaused: false, isGM: false }), 'player, unpaused, unlocked → editable');
ok(!dis({ locked: false, isGamePaused: true, isGM: true }), 'GM, paused → editable');
ok(dis({ locked: false, isGamePaused: true, isGM: false }), 'player, paused → disabled');
ok(dis({ locked: true, isGamePaused: false, isGM: true }), 'locked token → disabled');

// Subexpressions behave like plain booleans; blocks still work (the module's own templates use both).
const r = (t, ctx = {}) => Handlebars.compile(t)(ctx);
ok(r('{{#if (or a b)}}Y{{else}}N{{/if}}', { a: false, b: false }) === 'N', '(or false false) is false');
ok(r('{{#if (or a b)}}Y{{else}}N{{/if}}', { a: false, b: true }) === 'Y', '(or false true) is true');
ok(r('{{#if (and a b)}}Y{{else}}N{{/if}}', { a: true, b: true }) === 'Y', '(and true true) is true');
ok(r('{{#if (and a b)}}Y{{else}}N{{/if}}', { a: true, b: false }) === 'N', '(and true false) is false');
ok(r('{{#if (not a)}}Y{{else}}N{{/if}}', { a: false }) === 'Y', '(not false) is true');
ok(r('{{#or a b}}Y{{else}}N{{/or}}', { a: false, b: false }) === 'N', 'block or, both false');
ok(r('{{#or a b}}Y{{else}}N{{/or}}', { a: true, b: false }) === 'Y', 'block or, one true');
ok(r('{{#and a b}}Y{{else}}N{{/and}}', { a: true, b: false }) === 'N', 'block and, one false');
ok(r('{{#if (eq a "x")}}Y{{else}}N{{/if}}', { a: 'x' }) === 'Y', '(eq) in a subexpression');
ok(r('{{#if (or (eq a "x") (eq a "y"))}}Y{{else}}N{{/if}}', { a: 'z' }) === 'N', 'nested (or (eq) (eq)) false');

console.log(`test-core-helpers: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
