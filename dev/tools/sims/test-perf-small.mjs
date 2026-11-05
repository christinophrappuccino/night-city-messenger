// Sim: small performance fixes (audit remediation E5).
//   PERF-08  the weak-signal waveform redraws ~12×/s, not every frame; never while minimized; once when motion is off
//   PERF-10  conversation journal lookups are kept until a journal changes, instead of scanning every journal
//   PERF-12  a ringing payphone's bell stops by itself once the call is no longer ringing
// Drives the real module code with mocked Foundry globals.
import { pathToFileURL, fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };
const MOD = 'night-city-messenger';

const hooks = new Map();
globalThis.game = { user: { id: 'gm', isGM: true }, users: { get: () => null, activeGM: null }, settings: { get: () => undefined }, journal: [], nightcity: {} };
globalThis.foundry = {
  utils: { deepClone: (o) => JSON.parse(JSON.stringify(o)), mergeObject: (a, b) => ({ ...a, ...b }), randomID: () => 'r' },
  applications: { api: { ApplicationV2: class { static DEFAULT_OPTIONS = {}; }, HandlebarsApplicationMixin: (B) => class extends B {} } },
};
globalThis.Hooks = { on: (n, f) => { hooks.set(n, [...(hooks.get(n) || []), f]); return 1; }, off() {}, once() {}, callAll() {} };
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
globalThis.CONFIG = {};
globalThis.Handlebars = { escapeExpression: (s) => String(s ?? ''), registerHelper() {} };

// ═══ 1. PERF-08 ═══
{
  const { MessageViewerApp, waveAnimates, WAVE_FRAME_MS } = await imp('scripts/ui/MessageViewer/MessageViewerApp.js');
  ok(waveAnimates('full', false) && !waveAnimates('off', false) && !waveAnimates('full', true), 'the wave animates only when neither the module nor the OS asks for less motion');

  let frames = [];
  globalThis.requestAnimationFrame = (fn) => { frames.push(fn); return frames.length; };
  globalThis.cancelAnimationFrame = () => {};
  const run = (ms, step = 16.7) => { let t = 0; while (t < ms && frames.length) { const f = frames.shift(); t += step; f(t); } };
  const mkHtml = () => {
    const wave = { isConnected: true, draws: 0, setAttribute() { wave.draws += 1; } };
    return { wave, html: { querySelector: (s) => (s === '.ncm-viewer__signal-wave-path' ? wave : null), querySelectorAll: () => [] } };
  };
  const viewer = (level, minimized = false) => {
    const v = Object.create(MessageViewerApp.prototype);
    Object.defineProperty(v, 'animationLevel', { value: level });
    Object.defineProperty(v, 'minimized', { value: minimized });
    return v;
  };
  globalThis.matchMedia = () => ({ matches: false });

  let { wave, html } = mkHtml();
  frames = [];
  viewer('full')._setupAmbientAnimations(html);
  run(1000);
  ok(wave.draws >= 10 && wave.draws <= 14, `one second of the wave draws ~12 times, not ~60 (drew ${wave.draws}; frame gap ${WAVE_FRAME_MS} ms)`);

  ({ wave, html } = mkHtml()); frames = [];
  viewer('full', true)._setupAmbientAnimations(html);
  run(1000);
  ok(wave.draws === 0, 'a minimized viewer draws nothing');

  ({ wave, html } = mkHtml()); frames = [];
  viewer('off')._setupAmbientAnimations(html);
  run(1000);
  ok(wave.draws === 1 && frames.length === 0, 'with animation off it draws one still frame and stops');

  globalThis.matchMedia = () => ({ matches: true });
  ({ wave, html } = mkHtml()); frames = [];
  viewer('full')._setupAmbientAnimations(html);
  run(1000);
  ok(wave.draws === 1 && frames.length === 0, 'with the OS asking for reduced motion, the same');
  globalThis.matchMedia = () => ({ matches: false });

  ({ wave, html } = mkHtml()); frames = [];
  viewer('full')._setupAmbientAnimations(html);
  run(200); wave.isConnected = false; run(500);
  ok(frames.length === 0, 'once the viewer re-renders the old wave away, its loop ends');
}

// ═══ 2. PERF-10 ═══
{
  const { ConversationService } = await imp('scripts/services/ConversationService.js');
  const mkJ = (id, type = 'conversation') => ({ id: `j-${id}`, flags: { [MOD]: { type, conversationId: id } }, getFlag: (m, k) => ({ type, conversationId: id }[k]) });
  const js = [mkJ('a'), mkJ('b'), mkJ('x', 'inbox'), mkJ('c')];
  let scans = 0;
  game.journal = { get contents() { scans += 1; return js; } };
  const cs = Object.create(ConversationService.prototype);
  cs._journal('a'); cs._journal('b');
  ok(scans === 2, 'before the hooks are wired, every lookup reads the journals fresh (as before)');
  hooks.clear();
  game.nightcity.eventBus = { on() {}, emit() {} };
  globalThis.window = { addEventListener() {} };
  cs.wire();
  scans = 0;
  for (let i = 0; i < 50; i++) { cs._journal('b'); cs.all(); }
  ok(scans === 1, '100 lookups after wiring scan the journals once');
  ok(cs._journal('c')?.id === 'j-c' && cs._journal('x') === null && cs.all().length === 3, 'the cached answers are right');
  const fresh = mkJ('d'); js.push(fresh);
  for (const f of hooks.get('createJournalEntry') || []) f(fresh);
  ok(cs._journal('d') === fresh, 'a new conversation journal is found at once (the cache drops on create)');
  js.splice(js.indexOf(fresh), 1);
  for (const f of hooks.get('deleteJournalEntry') || []) f(fresh);
  ok(cs._journal('d') === null, '…and a deleted one is gone at once');
}

// ═══ 3. PERF-12 ═══
{
  const { PayphoneService, ringShouldStop } = await imp('scripts/services/PayphoneService.js');
  ok(ringShouldStop(null, 0, 1) && ringShouldStop({ state: 'live' }, 0, 1), 'a call that is gone or answered stops the bell');
  ok(!ringShouldStop({ state: 'ringing' }, 0, 5000, 30000) && ringShouldStop({ state: 'ringing' }, 0, 41000, 30000), 'a ringing call keeps ringing until well past its ring time');

  const ps = Object.create(PayphoneService.prototype);
  ps._ringing = new Map();
  const call = { id: 'c1', state: 'ringing', to: { kind: 'payphone', payphoneId: 'pp1' } };
  Object.defineProperty(ps, 'calls', { value: { calls: new Map([['c1', call]]), ringMs: 30000 } });
  ps.get = () => ({ id: 'pp1', name: 'Kabuki', sounds: {} });
  ps.pinsOf = () => [];
  let noteGone = 0;
  ps._ringNotice = () => ({ remove() { noteGone += 1; } });
  let rings = 0;
  game.nightcity.soundService = { play: () => { rings += 1; } };
  const timers = [];
  const realSet = globalThis.setInterval, realClear = globalThis.clearInterval;
  globalThis.setInterval = (fn) => { timers.push(fn); return timers.length; };
  globalThis.clearInterval = () => {};
  try {
    ps._onRinging({ call, role: 'callee' });
    timers[0](); timers[0]();
    ok(rings === 3 && ps._ringing.has('c1'), 'while the call rings, the bell rings');
    call.state = 'ended';                               // and the "ended" event never arrives
    timers[0]();
    ok(rings === 3 && !ps._ringing.has('c1') && noteGone === 1, 'once the call is over, the next bell notices, stays quiet and clears the prompt');
  } finally { globalThis.setInterval = realSet; globalThis.clearInterval = realClear; }
}

console.log(`test-perf-small: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
