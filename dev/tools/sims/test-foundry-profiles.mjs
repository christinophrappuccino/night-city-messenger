// test-foundry-profiles — the sims' Foundry version profiles (stage 2 step 10, part 4) agree with the module.
// lib/foundryVersion.mjs is the one table of v12 / v13 differences the sims model; run-checks --foundry 12|13 (and CI,
// once per version) stamps that version's game.release onto every mocked game through lib/profilePreload.mjs.
// Checks: the REAL compat.js registers the hook names the profile says, per version; the preload stamps a bare game and
// leaves a sim's own release alone; createMockWorld takes the run's version and an explicit one wins.
// Run: node dev/tools/sims/test-foundry-profiles.mjs   (NCM_ROOT=<dir> to check another checkout)
import { spawnSync } from 'child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';

const ROOT = path.resolve(process.env.NCM_ROOT || fileURLToPath(new URL('../../../', import.meta.url)));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
const url = (p) => pathToFileURL(path.join(ROOT, p)).href;

const { FOUNDRY_PROFILES, foundryProfile, applyFoundryProfile, SIM_FOUNDRY_VERSION } = await import(url('dev/tools/sims/lib/foundryVersion.mjs'));
ok(Object.keys(FOUNDRY_PROFILES).join() === '12,13', 'profiles for v12 and v13');
ok([12, 13].includes(SIM_FOUNDRY_VERSION) && foundryProfile().generation === SIM_FOUNDRY_VERSION, `this run models v${SIM_FOUNDRY_VERSION}`);

// 1. the real compat registers what each profile says
const seen = [];
globalThis.Hooks = { on: (e) => { seen.push(e); return seen.length; }, off() {}, once() {}, callAll() {} };
const compat = await import(url('scripts/utils/compat.js'));
for (const v of [12, 13]) {
  const p = FOUNDRY_PROFILES[v];
  globalThis.game = { release: { generation: v } };
  seen.length = 0;
  compat.onRenderChatMessage(() => {});
  ok(seen.join() === p.chatHook, `v${v}: chat cards hook ${p.chatHook} (${seen.join()})`);
  seen.length = 0;
  compat.onDirectoryEntryContext('Item', () => []);
  ok(seen.join() === p.directoryMenuHook('Item'), `v${v}: the Items menu hook is ${p.directoryMenuHook('Item')} (${seen.join()})`);
  ok(compat.foundryGeneration() === p.generation, `v${v}: compat reads generation ${p.generation}`);
  const controls = p.sceneControls === 'array' ? [] : {};
  compat.addSceneControlGroup(controls, { name: 'ncm', title: 'NCM', icon: 'fas fa-x', tools: [{ name: 't', title: 'T', icon: 'fas fa-y', button: true, onClick() {} }] });
  ok(p.sceneControls === 'array' ? Array.isArray(controls) && controls.length === 1 : !!controls.ncm, `v${v}: scene controls are ${p.sceneControls === 'array' ? 'an array' : 'a record'}`);
}

// 2. applyFoundryProfile
const g = applyFoundryProfile({}, 13);
ok(g.release.generation === 13 && g.release.version === '13.351' && g.release.build === 351 && g.version === '13.351', 'stamps Foundry\'s release shape');
ok(applyFoundryProfile({ release: { generation: 12 } }, 13).release.generation === 12, 'a game that has a release keeps it');
ok(applyFoundryProfile(null, 13) === null, 'no game, nothing to do');

// 3. the preload, in a child process per version
const dir = mkdtempSync(path.join(os.tmpdir(), 'ncm-prof-'));
try {
  const probe = path.join(dir, 'probe.mjs');
  writeFileSync(probe, `globalThis.game = { user: {} };
const a = game.release?.generation;
globalThis.game = { release: { generation: 99 } };
const b = game.release.generation;
const { createMockWorld } = await import(${JSON.stringify(url('dev/tools/sims/lib/world.mjs'))});
await createMockWorld();
const c = game.release.generation;
await createMockWorld({ foundryVersion: 12 });
const d = game.release.generation;
console.log(JSON.stringify([a, b, c, d]));`);
  for (const v of ['12', '13']) {
    const r = spawnSync(process.execPath, ['--import', url('dev/tools/sims/lib/profilePreload.mjs'), probe], { env: { ...process.env, NCM_FOUNDRY_VERSION: v }, encoding: 'utf8' });
    const got = (r.stdout.trim().split('\n').pop() || '');
    ok(got === JSON.stringify([Number(v), 99, Number(v), 12]), `preload as v${v}: a bare game gets v${v}, a sim's own release wins, createMockWorld takes v${v}, an explicit version wins (${got || r.stderr.trim().split('\n').pop()})`);
  }
  const bad = spawnSync(process.execPath, ['--import', url('dev/tools/sims/lib/profilePreload.mjs'), probe], { env: { ...process.env, NCM_FOUNDRY_VERSION: '11' }, encoding: 'utf8' });
  ok(bad.status !== 0 && /no such profile/.test(bad.stderr), 'an unknown version is an error, not a silent v12');
} finally { rmSync(dir, { recursive: true, force: true }); }

console.log(`test-foundry-profiles: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
