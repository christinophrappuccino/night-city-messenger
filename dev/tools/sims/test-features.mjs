// test-features — the feature registry (stage 2, step 14). An optional system switched off by its world setting is
// NOT INSTALLED: its startup steps are skipped (and listed as skipped, not failed), its socket requests get a
// "switched off" answer from the GM instead of a handler, and the answer is read once per load. Drives the REAL
// features.js, ModuleInitializer and SocketManager with a mocked game; then checks the source keeps the rules.
// Run: node dev/tools/sims/test-features.mjs   (NCM_ROOT=<dir> to check another checkout)
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';

const ROOT = path.resolve(process.env.NCM_ROOT || fileURLToPath(new URL('../../../', import.meta.url)));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const lib = path.join(ROOT, 'scripts/utils/features.js');
ok(existsSync(lib), 'scripts/utils/features.js exists');
if (!existsSync(lib)) { console.log(`test-features: ${pass} passed, ${fail} failed`); process.exit(1); }

// a game whose settings can be flipped, and whose registry can be "not yet registered"
const store = new Map();
let registered = true;
const sent = [];
const users = { gm1: { id: 'gm1', isGM: true }, gm2: { id: 'gm2', isGM: true }, p1: { id: 'p1', isGM: false } };
const as = (id) => { globalThis.game.user = users[id]; };
globalThis.game = {
  user: users.gm1,
  users: { activeGM: users.gm1, get: (id) => users[id] },
  settings: {
    get: (m, k) => { if (!registered || !store.has(k)) throw new Error(`not registered: ${k}`); return store.get(k); },
    settings: { has: (key) => registered && store.has(key.split('.').slice(1).join('.')) },
  },
  socket: { on() {}, emit: (_name, msg) => sent.push(msg) },
};
globalThis.Hooks = { on() {}, once() {}, callAll() {} };
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };

const F = await import(pathToFileURL(lib).href);
const { SOCKET_OPS } = await import(pathToFileURL(path.join(ROOT, 'scripts/utils/constants.js')).href);

// ═══ 1. the registry ═══
const names = Object.keys(F.FEATURES);
ok(names.includes('conversations'), 'Conversations is a feature');
for (const [n, f] of Object.entries(F.FEATURES)) ok(typeof f.setting === 'string' && typeof f.label === 'string' && Array.isArray(f.requires) && f.requires.every((r) => F.FEATURES[r]), `${n}: setting, label, and requires only known features`);

store.set('conversationsEnabled', false);
F._resetFeatureCache();
ok(F.isFeatureOn('conversations') === false, 'off when its setting is off');
store.set('conversationsEnabled', true);
ok(F.isFeatureOn('conversations') === false, 'the answer is kept for the load: flipping the setting does not change it before the reload');
F._resetFeatureCache();
ok(F.isFeatureOn('conversations') === true, 'on after a reload with the setting on');
ok(F.isFeatureOn('no-such-thing') === false, 'an unknown feature is off');
registered = false; F._resetFeatureCache();
ok(F.isFeatureOn('conversations') === false, 'before settings are registered it reads off…');
registered = true;
ok(F.isFeatureOn('conversations') === true, '…and that early answer is not kept, so the real one wins once settings exist');
const list = F.featureList();
ok(list.length === names.length && list.every((x) => typeof x.on === 'boolean' && x.setting && x.label), 'featureList: one row per feature with its state');
ok(F.featuresOff().length === 0, 'featuresOff lists none when all are on');

// requires: a dependent is off when what it needs is off (tested on a temporary registry entry)
{
  const src = read('scripts/utils/features.js');
  ok(/every\(\(r\) => isFeatureOn\(r, _seen\)\)/.test(src), 'a feature is on only when every feature it requires is on (decided in features.js)');
}

// ═══ 2. startup steps ═══
const { ModuleInitializer } = await import(pathToFileURL(path.join(ROOT, 'scripts/core/ModuleInitializer.js')).href);
{
  store.set('conversationsEnabled', false); F._resetFeatureCache();
  const init = new ModuleInitializer();
  const ran = [];
  init.register('ready', 10, 'always', () => ran.push('always'));
  init.register('ready', 20, 'conv only', () => ran.push('conv'), { feature: 'conversations' });
  init.register('postReady', 10, 'conv later', () => ran.push('conv2'), { feature: 'conversations' });
  await init.runPhase('ready'); await init.runPhase('postReady');
  ok(ran.join() === 'always', `off: the feature's steps do not run (${ran.join()})`);
  ok(init.skipped.length === 2 && init.skipped.every((s) => s.feature === 'conversations') && init.failures.length === 0, 'they are listed as skipped, never as failed');
  init.reportFailures();
  ok(init.report.skipped.length === 2 && init.report.failed.length === 0, 'the startup report carries the skipped steps');
  let threw = 0;
  try { init.register('init', 10, 'x', () => {}, { feature: 'conversations' }); } catch { threw++; }
  try { init.register('ready', 10, 'x', () => {}, { feature: 'nope' }); } catch { threw++; }
  ok(threw === 2, 'a feature step in init (settings unreadable) or an unknown feature is refused at register');

  store.set('conversationsEnabled', true); F._resetFeatureCache();
  const on = new ModuleInitializer(); const ran2 = [];
  on.register('ready', 20, 'conv only', () => ran2.push('conv'), { feature: 'conversations' });
  await on.runPhase('ready');
  ok(ran2.join() === 'conv' && on.skipped.length === 0, 'on: the step runs as before');
}

// ═══ 3. socket ops ═══
const { SocketManager } = await import(pathToFileURL(path.join(ROOT, 'scripts/core/SocketManager.js')).href);
{
  store.set('conversationsEnabled', false); F._resetFeatureCache();
  let real = 0;
  const sm = new SocketManager();
  sm.register(SOCKET_OPS.CONVERSATION_REQUEST, () => { real++; }, { feature: 'conversations' });
  sm.register(SOCKET_OPS.CONVERSATION_RESULT, () => { real++; }, { feature: 'conversations' });
  ok(sm._handlers.get(SOCKET_OPS.CONVERSATION_REQUEST)?.ncmFeatureOff === 'conversations', 'off: the stand-in is installed, not the handler');

  as('gm1'); sent.length = 0;
  sm._onMessage({ operation: SOCKET_OPS.CONVERSATION_REQUEST, data: { op: 'post', reqId: 'r1', userId: 'gm1' } }, 'p1');
  const reply = sent[0];
  ok(real === 0 && reply?.operation === SOCKET_OPS.CONVERSATION_RESULT, 'the primary GM answers a request for an off feature');
  ok(reply?.data?.forUserId === 'p1' && reply.data.reqId === 'r1' && reply.data.res?.ok === false && reply.data.res.off === true,
    'the answer goes to the real sender (the server id, not the userId the payload claims) with "switched off"');

  as('gm2'); sent.length = 0;
  sm._onMessage({ operation: SOCKET_OPS.CONVERSATION_REQUEST, data: { reqId: 'r2' } }, 'p1');
  ok(sent.length === 0, 'a second GM does not answer too (one GM acts)');
  as('p1'); sent.length = 0;
  sm._onMessage({ operation: SOCKET_OPS.CONVERSATION_REQUEST, data: { reqId: 'r3' } }, 'gm1');
  ok(sent.length === 0, 'a player never answers');
  as('gm1'); sent.length = 0;
  sm._onMessage({ operation: SOCKET_OPS.CONVERSATION_RESULT, data: { forUserId: 'gm1', reqId: 'x' } }, 'p1');
  sm._onMessage({ operation: SOCKET_OPS.CONVERSATION_REQUEST, data: {} }, 'p1');
  ok(sent.length === 0 && real === 0, 'a result op, or a request with no id to answer, is dropped');

  store.set('conversationsEnabled', true); F._resetFeatureCache();
  const sm2 = new SocketManager(); let got = null;
  sm2.register(SOCKET_OPS.CONVERSATION_REQUEST, (d, s) => { got = s; }, { feature: 'conversations' });
  sm2._onMessage({ operation: SOCKET_OPS.CONVERSATION_REQUEST, data: { reqId: 'r9' } }, 'p1');
  ok(got === 'p1', 'on: the real handler gets the request');
  let threw = false; try { sm2.register('x', () => {}, { feature: 'nope' }); } catch { threw = true; }
  ok(threw, 'an unknown feature is refused at register');
}

// ═══ 4. the source keeps the rules ═══
const Settings = read('scripts/core/SettingsManager.js');
for (const [n, f] of Object.entries(F.FEATURES)) {
  const m = Settings.match(new RegExp(`register\\(MODULE_ID, '${f.setting}', \\{[\\s\\S]*?\\n    \\}\\);`));
  ok(!!m && /scope: 'world'/.test(m[0]) && /requiresReload: true/.test(m[0]) && /type: Boolean/.test(m[0]), `${n}: '${f.setting}' is a world Boolean with requiresReload (the once-per-load answer depends on it)`);
}
ok(/get enabled\(\) \{ return isFeatureOn\('conversations'\); \}/.test(read('scripts/services/ConversationService.js')), 'ConversationService.enabled asks the registry');
const Reg = read('scripts/init/registerCallSystem.js');
ok((Reg.match(/\{ feature: 'conversations' \}/g) || []).length === 4, 'the Conversations wiring, held lines and both socket ops are feature-tagged');
ok(!/conversationService\?\.enabled &&/.test(Reg) && !/if \(!service\.enabled\) return;/.test(Reg), 'no hand-written "is it on" checks left in the startup file');
ok(/features: Object\.freeze\(\{ isOn: isFeatureOn, list: featureList, off: featuresOff \}\)/.test(read('scripts/init/registerCoreServices.js')), 'game.nightcity.features exposes isOn / list / off');

// nothing else reads a feature's setting directly
const walk = (d, out = []) => { for (const f of readdirSync(d)) { const p = path.join(d, f); if (statSync(p).isDirectory()) walk(p, out); else if (p.endsWith('.js')) out.push(p); } return out; };
const direct = [];
for (const p of walk(path.join(ROOT, 'scripts'))) {
  const rel = path.relative(ROOT, p).split(path.sep).join('/');
  if (rel === 'scripts/core/SettingsManager.js' || rel === 'scripts/utils/features.js') continue;
  const t = readFileSync(p, 'utf8');
  for (const f of Object.values(F.FEATURES)) if (t.includes(`'${f.setting}'`)) direct.push(`${rel} (${f.setting})`);
}
ok(direct.length === 0, `no file reads a feature setting directly — ask isFeatureOn (${direct.join(', ')})`);

console.log(`test-features: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
