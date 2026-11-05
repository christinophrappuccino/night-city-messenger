// live-smoke — run NCM in a REAL running Foundry and report what breaks (stage 2, step 10e).
//
//   node dev/tools/live-smoke.mjs --url http://localhost:30001 --user Gamemaster
//   node dev/tools/live-smoke.mjs --url http://localhost:30000 --user Player --no-ui    (a player; skip the GM windows)
//
// Joins the world as an OFFLINE user in headless Chrome (never a user someone is logged in as), waits for NCM to start,
// then checks: the startup report, the compat.js lookups (and whether they come from Foundry's v13 namespaces), and —
// unless --no-ui — opens every admin tab, the composer, the sound board, the theme customizer, a v1 dialog and the name
// picker, then closes them. Every console warning and error is collected with its stack and split into:
//   NCM's       — the stack or text names /modules/night-city-messenger/, or it's an error in a hook only NCM registers
//   everyone else's (the system, other modules, Foundry) — counted, not judged
// Exit code 1 when NCM failed to start or caused an error. Deprecation warnings are listed, not failed.
// Needs Chrome (CHROME=<path> to override). Changes nothing in the world except what opening windows does.
import { spawn } from 'child_process';
import fs from 'fs'; import os from 'os'; import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const BASE = arg('--url', 'http://localhost:30000'), USER = arg('--user', 'Gamemaster'), UI = !process.argv.includes('--no-ui');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const LOG = arg('--log', null);

// the hooks NCM registers, so an anonymous hook error can be attributed
const walk = (d, o = []) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p, o); else if (p.endsWith('.js')) o.push(p); } return o; };
const NCM_HOOKS = new Set(walk(path.join(ROOT, 'scripts')).flatMap((f) => [...fs.readFileSync(f, 'utf8').matchAll(/Hooks\.(?:on|once)\(\s*['"]([A-Za-z0-9]+)['"]/g)].map((m) => m[1])));

const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'ncm-smoke-'));
const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, '--window-size=1600,1000', '--mute-audio', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const done = (code) => { try { chrome.kill(); } catch {} try { fs.rmSync(prof, { recursive: true, force: true }); } catch {} process.exit(code); };
let targets; for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break; } catch {} await sleep(200); }
if (!targets) { console.error('live-smoke: Chrome did not start'); done(1); }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const wait = new Map(); const entries = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); }
  if (m.method === 'Runtime.consoleAPICalled' && ['warn', 'warning', 'error'].includes(m.params.type)) {
    entries.push({ level: m.params.type === 'error' ? 'error' : 'warning', text: m.params.args.map((a) => a.value ?? a.description ?? '').join(' '),
      frames: (m.params.stackTrace?.callFrames || []).map((f) => f.url).join(' ') });
  }
  if (m.method === 'Runtime.exceptionThrown') entries.push({ level: 'error', text: m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text, frames: '' });
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description; };
await send('Runtime.enable');
await send('Page.navigate', { url: `${BASE}/join` });
for (let i = 0; i < 30; i++) { await sleep(1000); if (await ev("document.querySelectorAll('select[name=userid] option').length > 1")) break; }
const joined = await ev(`(() => { const s = document.querySelector('select[name="userid"]'); if (!s) return 'no join form (is a world running at ${BASE}?)'; const o = [...s.options].find((o) => o.textContent.trim() === ${JSON.stringify(USER)}); if (!o) return 'no user ' + ${JSON.stringify(USER)} + ' — users: ' + [...s.options].map((o) => o.textContent.trim()).filter(Boolean).join(', '); if (o.disabled) return 'that user is logged in already — pick an offline one'; s.value = o.value; document.querySelector('button[name="join"], button[type="submit"]').click(); return 'ok'; })()`);
if (joined !== 'ok') { console.error(`live-smoke: ${joined}`); done(1); }
for (let i = 0; i < 90; i++) { await sleep(1000); if (await ev('!!(window.game && game.ready && game.nightcity?.startupReport)')) break; }
await sleep(2000);

const facts = await ev(`(async () => {
  const C = await import('/modules/night-city-messenger/scripts/utils/compat.js');
  const n = (c) => c?.name || null;
  return { foundry: game.release.generation + '.' + game.release.build, system: game.system.id + ' ' + game.system.version, user: game.user.name, isGM: game.user.isGM,
    ncm: game.modules.get('night-city-messenger')?.version, active: !!game.modules.get('night-city-messenger')?.active,
    report: game.nightcity?.startupReport || null, api: game.modules.get('night-city-messenger')?.api?.apiVersion || null,
    compat: { FilePicker: n(C.FilePickerClass()), fromV13Namespace: C.FilePickerClass() === foundry.applications?.apps?.FilePicker?.implementation, ImagePopout: n(C.ImagePopoutClass()), SettingsConfig: n(C.SettingsConfigClass()), InteractionLayer: n(C.InteractionLayerClass()), DocumentOwnershipConfig: n(C.DocumentOwnershipConfigClass()) } };
})()`);
let ui = null;
if (UI && facts?.isGM) {
  ui = await ev(`(async () => {
    const ns = game.nightcity, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), res = {};
    const step = async (label, fn) => { try { await fn(); await sleep(900); res[label] = 'ok'; } catch (e) { res[label] = 'ERR ' + (e?.message || e); } };
    await step('admin panel', () => ns.openAdmin());
    for (const t of ['overview', 'messages', 'contacts', 'spam', 'phone', 'networks', 'security', 'terminals', 'shards', 'access', 'tools']) await step('admin: ' + t, () => ns.openAdminTab(t));
    await step('composer', () => ns.composeMessage());
    await step('sound board', () => ns.openSoundBoard());
    await step('theme customizer', () => ns.openThemeCustomizer());
    await step('v1 dialog (adminConfirm)', async () => { const { adminConfirm } = await import('/modules/night-city-messenger/scripts/utils/adminTheme.js'); adminConfirm({ title: 'NCM smoke', content: '<p>smoke</p>' }); await sleep(700); for (const w of Object.values(ui.windows)) if (w.title === 'NCM smoke') await w.close(); });
    await step('name picker', async () => { const { showNamePicker } = await import('/modules/night-city-messenger/scripts/utils/namePicker.js'); showNamePicker({ title: 'NCM smoke picker', entries: [{ id: 'a', name: 'A' }] }); await sleep(700); for (const w of Object.values(ui.windows)) if (/NCM smoke picker/.test(w.title)) await w.close(); });
    for (const a of [...foundry.applications.instances.values()]) if (/Admin|Composer|SoundBoard|ThemeCustomizer/.test(a.constructor.name)) await a.close();
    return res;
  })()`);
}

// attribute
// an error in a hook NCM registers, or Foundry saying a hook NCM uses is deprecated, counts as NCM's (another module
// using the same hook would be counted too — the stack of an anonymous hook function names no file)
const isNcm = (e) => /\/modules\/night-city-messenger\//.test(e.text + ' ' + e.frames)
  || [...NCM_HOOKS].some((h) => (new RegExp(`for hook '${h}'`).test(e.text) || new RegExp(`The ${h} hook is deprecated`).test(e.text)) && !/\/(systems|modules)\/(?!night-city-messenger)/.test(e.text));
const seen = new Set(); const uniq = (list) => list.filter((e) => { const k = e.level + e.text.split('\n')[0]; if (seen.has(k)) return false; seen.add(k); return true; });
const all = uniq(entries.filter((e) => !/^Foundry VTT \| Error thrown in hooked function/.test(e.text)   // Foundry logs each hook error twice
  && !/^NCM \|/.test(e.text)));                                                                        // NCM's own notices (e.g. "No character assigned") are on purpose
const ncm = all.filter(isNcm), others = all.filter((e) => !isNcm(e));
const first = (e) => e.text.split('\n')[0].replace(/^Error: /, '').slice(0, 220);

console.log(`\nlive-smoke @ ${BASE} as ${facts?.user} — Foundry ${facts?.foundry}, system ${facts?.system}, NCM ${facts?.ncm} (${facts?.active ? 'active' : 'NOT ACTIVE'}), api ${facts?.api}`);
const rep = facts?.report;
console.log(`startup: ${rep ? (rep.failed.length ? `FAILED steps: ${rep.failed.join(', ')}; not running: ${rep.missing.join(', ') || 'none'}` : 'clean (no failed step)') : 'no startup report — NCM did not finish starting'}`);
console.log(`compat:  ${Object.entries(facts?.compat || {}).map(([k, v]) => `${k}=${v}`).join(', ')}`);
if (ui) { const bad = Object.entries(ui).filter(([, v]) => v !== 'ok'); console.log(`windows: ${Object.keys(ui).length - bad.length} of ${Object.keys(ui).length} opened${bad.length ? ` — ${bad.map(([k, v]) => `${k}: ${v}`).join('; ')}` : ''}`); }
console.log(`\nNCM's problems (${ncm.length}):`); for (const e of ncm) console.log(`  ${e.level === 'error' ? 'ERROR  ' : 'warning'} ${first(e)}`);
console.log(`other packages / Foundry: ${others.filter((e) => e.level === 'error').length} errors, ${others.filter((e) => e.level === 'warning').length} warnings${others.length ? ` (e.g. ${first(others[0]).slice(0, 120)})` : ''}`);
if (LOG) fs.writeFileSync(LOG, entries.map((e) => `[${e.level}] ${e.text}\n    @@ ${e.frames}`).join('\n'));
const failed = !rep || rep.failed.length || !facts?.active || ncm.some((e) => e.level === 'error') || (ui && Object.values(ui).some((v) => v !== 'ok'));
console.log(failed ? '\nRESULT: problems found' : '\nRESULT: NCM ran cleanly (warnings above are deprecations to plan for)');
done(failed ? 1 : 0);
