// test-settings-access — one settings reader with honest fallbacks, and one "am I the GM who acts" check
// (stage 2, batch 6). Drives the real getSetting / isPrimaryGM, and checks the source:
//   - every getSetting('key', literal) / _get('key', literal) falls back to the setting's REGISTERED default
//   - no file keeps a private try/catch settings reader
//   - nobody hand-writes `game.users.activeGM?.id === game.user.id` (isPrimaryGM is the one answer)
// Run: node dev/tools/sims/test-settings-access.mjs   (NCM_ROOT=<dir> to check another checkout)
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';

const ROOT = path.resolve(process.env.NCM_ROOT || fileURLToPath(new URL('../../../', import.meta.url)));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const walk = (d, out = []) => { for (const f of readdirSync(d)) { const p = path.join(d, f); if (statSync(p).isDirectory()) walk(p, out); else if (p.endsWith('.js')) out.push(p); } return out; };
const src = Object.fromEntries(walk(path.join(ROOT, 'scripts')).map((f) => [rel(f), readFileSync(f, 'utf8')]));

// ═══ 1. the real helpers ═══
const store = new Map([['night-city-messenger.callsEnabled', false]]);
globalThis.game = {
  user: { id: 'gm1', isGM: true },
  users: { activeGM: { id: 'gm1' }, get: () => null },
  settings: { get: (m, k) => { const key = `${m}.${k}`; if (!store.has(key)) throw new Error(`"${key}" is not a registered game setting`); return store.get(key); } },
};
const H = await import(pathToFileURL(path.join(ROOT, 'scripts/utils/helpers.js')).href);
ok(typeof H.getSetting === 'function', 'helpers.js exports getSetting');
if (typeof H.getSetting === 'function') {
  ok(H.getSetting('callsEnabled', true) === false, 'a registered setting returns its stored value (false stays false)');
  ok(H.getSetting('notRegistered', 'fb') === 'fb', 'a setting that cannot be read returns the fallback');
}
ok(H.isPrimaryGM() === true, 'the active GM is the primary GM');
game.users.activeGM = { id: 'gm2' }; ok(H.isPrimaryGM() === false, 'another GM is the active one → not me');
game.user = { id: 'p1', isGM: false }; game.users.activeGM = { id: 'p1' }; ok(H.isPrimaryGM() === false, 'a player is never the primary GM');

// ═══ 2. fallbacks equal the registered defaults ═══
const SM = src['scripts/core/SettingsManager.js'] || '';
const defs = {};
for (const m of SM.matchAll(/settings\.register\(\s*MODULE_ID\s*,\s*'([A-Za-z0-9_]+)'\s*,\s*\{/g)) {
  let i = m.index + m[0].length, d = 1; for (; i < SM.length && d; i++) { if (SM[i] === '{') d++; else if (SM[i] === '}') d--; }
  const dm = SM.slice(m.index, i).match(/\bdefault:\s*(true|false|-?\d+(?:\.\d+)?|'[^']*')\s*[,}\r\n]/);
  if (dm) defs[m[1]] = JSON.parse(dm[1].replace(/^'(.*)'$/, '"$1"'));
}
ok(Object.keys(defs).length > 40, `registered literal defaults read from SettingsManager (${Object.keys(defs).length})`);
const lit = (s) => { s = s.trim(); if (/^(true|false)$/.test(s)) return s === 'true'; if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s); const q = s.match(/^'([^']*)'$/); return q ? q[1] : undefined; };
const wrong = [], checked = [];
for (const [f, t] of Object.entries(src)) {
  for (const m of t.matchAll(/(?:getSetting|_get)\(\s*'([A-Za-z0-9_]+)'\s*,\s*([^)]+?)\s*\)/g)) {
    const fb = lit(m[2]); if (fb === undefined || !(m[1] in defs)) continue;
    checked.push(m[1]);
    if (fb !== defs[m[1]]) wrong.push(`${f}: '${m[1]}' falls back to ${JSON.stringify(fb)}, its default is ${JSON.stringify(defs[m[1]])}`);
  }
}
ok(checked.length >= 5, `literal fallbacks found to check (${checked.length})`);
ok(wrong.length === 0, `every literal fallback is the registered default:\n  ${wrong.join('\n  ')}`);
ok(defs.anonSendEnabled === true, 'anonSendEnabled is registered on by default');
ok(!/anonSendEnabled/.test(src['scripts/ui/AdminPanel/tabs/MessagesTab.js'] || '') && /getSetting\('anonSendEnabled', true\)/.test(src['scripts/ui/MessageComposer/MessageComposerApp.js'] || ''), 'anonymous send is read in one place, the composer (Needs a reply opens it to answer)');

// ═══ 3. one reader, one primary-GM check ═══
const privateReaders = Object.entries(src).filter(([f, t]) => f !== 'scripts/utils/helpers.js' && /_get\(key, fallback\)\s*\{\s*try\s*\{/.test(t)).map(([f]) => f);
ok(privateReaders.length === 0, `no private try/catch settings reader left (${privateReaders.join(', ')})`);
// hand-written try/catch reads of a setting: 35 simple ones became getSetting (2026-11-05). The rest wrap more than
// the read (an if block, several statements), so their catch also swallows other errors — they convert when their
// file is next edited. The count may only go down.
const TRY_READS_MAX = 69;
const tryReads = Object.entries(src).filter(([f]) => f !== 'scripts/utils/helpers.js').reduce((n, [, t]) => n + (t.match(/try\s*\{[^}]{0,200}?game\.settings\.get\(MODULE_ID/g) || []).length, 0);
ok(tryReads <= TRY_READS_MAX, `try/catch settings reads: ${tryReads} (may only go down from ${TRY_READS_MAX}; use getSetting(key, registered default))`);
if (tryReads < TRY_READS_MAX) console.log(`  note: try/catch settings reads are down to ${tryReads} — lower TRY_READS_MAX`);
const handRolled = Object.entries(src).flatMap(([f, t]) => (t.match(/activeGM\??\.id\s*===\s*game\.user\??\.id|game\.user\??\.id\s*===\s*game\.users\??\.activeGM/g) ? [f] : []));
ok(handRolled.length === 0, `nobody hand-writes the active-GM comparison; isPrimaryGM() is the answer (${handRolled.join(', ')})`);

console.log(`test-settings-access: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
