// Sim: startup hygiene (audit remediation E6).
//   ARCH-02  a startup step that fails is remembered and the GM is told once startup is over
//   ARCH-03  the startup log names the real version (module.json), not "v4.1"
// Drives the real ModuleInitializer with mocked Foundry globals.
import { pathToFileURL, fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const read = (p) => readFileSync(`${ROOT}/${p}`, 'utf8');
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };

const toasts = [];
globalThis.game = { user: { isGM: true }, settings: { get: () => false } };
globalThis.ui = { notifications: { info() {}, warn() {}, error: (m, o) => toasts.push({ m, o }), notify() {} } };
const quiet = console.error; console.error = () => {};   // the FAILED lines the initializer logs on purpose

const { ModuleInitializer } = await import(pathToFileURL(`${ROOT}/scripts/core/ModuleInitializer.js`).href);
{
  const mi = new ModuleInitializer();
  let after = 0;
  mi.register('init', 10, 'Settings', () => { throw new Error('boom'); });
  mi.register('init', 20, 'Templates', async () => { throw new Error('404'); });
  mi.register('init', 30, 'Helpers', () => { after += 1; });
  mi.register('ready', 10, 'Services', async () => { throw new Error('nope'); });
  mi.register('ready', 20, 'Badge', async () => { after += 1; });
  await mi.runPhaseNow('init');
  await mi.runPhase('ready');
  ok(after === 2, 'a failed step still does not stop the steps after it');
  ok(mi.failures.map((f) => `${f.phase}:${f.name}:${f.message}`).join() === 'init:Settings:boom,init:Templates:404,ready:Services:nope', 'every failure is remembered with its phase, step and reason — sync and async');
  const n = mi.reportFailures();
  ok(n === 3 && toasts.length === 1 && toasts[0].o?.permanent === true, 'the GM gets ONE permanent notice');
  ok(/3 startup steps failed: Settings, Templates, Services/.test(toasts[0].m) && /F12/.test(toasts[0].m), '…that names the steps and says where to look');

  toasts.length = 0;
  game.user = { isGM: false };
  mi.reportFailures();
  ok(toasts.length === 0, 'a player is not told (they cannot fix it)');
  game.user = { isGM: true };

  const clean = new ModuleInitializer();
  clean.register('init', 10, 'Fine', () => {});
  await clean.runPhaseNow('init');
  ok(clean.reportFailures() === 0 && toasts.length === 0, 'a clean startup says nothing');

  const many = new ModuleInitializer();
  for (let i = 0; i < 6; i++) many.register('ready', i, `Step${i}`, () => { throw new Error('x'); });
  await many.runPhase('ready');
  many.reportFailures();
  ok(/Step0, Step1, Step2, Step3, and 2 more/.test(toasts.at(-1)?.m || ''), 'a long list is cut short');
}
console.error = quiet;

const main = read('scripts/main.js');
ok(!/v4\.1/.test(main) && /game\.modules\?\.get\?\.\(MODULE_ID\)\?\.version/.test(main), 'the startup log reads the version from module.json');
ok(/runPhase\('postReady'\);\s*\n\s*initializer\.reportFailures\(\);/.test(main), 'failures are reported right after postReady');

console.log(`test-startup-report: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
