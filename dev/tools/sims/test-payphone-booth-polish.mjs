// Sim: payphone booth polish (dev live test 2026-11-05, Foundry desktop app).
//   1. The handset cord did not reach the handset in the Foundry app (fine in Chrome). The cord's end was found with
//      getScreenCTM and the handset with getBoundingClientRect; under the booth's CSS zoom the Chromium Foundry ships
//      counts the zoom in one and not the other. Both are now rects (`cordPoint`).
//   2. Hanging up no longer brings the booth back on screen.
//   3. Walk away and "who is on it" sit above the booth, not over its hanging wires.
import { pathToFileURL, fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const read = (p) => readFileSync(`${ROOT}/${p}`, 'utf8');
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };
const near = (a, b) => Math.abs(a - b) < 1e-6;

globalThis.game = { user: { id: 'u', isGM: false }, settings: { get: () => undefined }, nightcity: {} };
globalThis.foundry = { utils: { deepClone: (o) => JSON.parse(JSON.stringify(o)) } };
globalThis.Hooks = { on() {}, off() {}, once() {} };
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
globalThis.window = { matchMedia: () => ({ matches: false }) };

const { cordPoint, PayphoneBooth } = await import(pathToFileURL(`${ROOT}/scripts/ui/Calls/PayphoneBooth.js`).href);
const { boothHtml } = await import(pathToFileURL(`${ROOT}/scripts/ui/Calls/boothMarkup.js`).href);

// ═══ 1. The cord ═══
const vb = { x: 0, y: 0, width: 112, height: 520 };
{
  const box = { left: 100, top: 50, width: 112, height: 520 };
  const p = cordPoint({ x: 140, y: 426 }, box, vb);
  ok(near(p.x, 40) && near(p.y, 376), 'unzoomed: a screen point maps straight into the cord\'s units');
  const z = 0.62, zb = { left: 100 * z, top: 50 * z, width: 112 * z, height: 520 * z };
  const q = cordPoint({ x: 140 * z, y: 426 * z }, zb, vb);
  ok(near(q.x, 40) && near(q.y, 376), 'zoomed to 62%: the same handset point lands on the same spot (both rects scale together)');
  const wide = { left: 0, top: 0, width: 224, height: 520 };   // a wider box: meet letterboxes left and right
  const r = cordPoint({ x: 56 + 40, y: 376 }, wide, vb);
  ok(near(r.x, 40) && near(r.y, 376), 'a letterboxed svg (xMidYMid meet) still maps correctly');
}
const booth = read('scripts/ui/Calls/PayphoneBooth.js');
const draw = booth.slice(booth.indexOf('  _cordDraw() {'), booth.indexOf('  _wireTorch()'));
ok(!draw.includes('.getScreenCTM(') && /cordPoint\(/.test(draw), 'the cord no longer mixes getScreenCTM with getBoundingClientRect');

// ═══ 2. Hang up ═══
{
  const b = Object.create(PayphoneBooth.prototype);
  b.host = null; b.pp = null; b.st = null;
  let opened = 0; b.open = () => { opened += 1; };
  const played = [];
  game.nightcity.soundService = { play: (id) => played.push(id), playFile: (f) => played.push(f) };
  b.hungUp({ id: 'pp1', sounds: {} }, 'c1');
  ok(opened === 0, 'a call ending while the booth is closed does not bring the booth back');
  ok(played.join() === 'payphone-hook', '…the handset is just heard going back on the hook');
  played.length = 0;
  b.hungUp({ id: 'pp1', sounds: { hook: 'my/hook.ogg' } }, 'c1');
  ok(played.join() === 'my/hook.ogg', 'a booth with its own hook sound plays that one');

  let closed = 0, putBack = 0;
  b.pp = { id: 'pp1' }; b.st = { at: 'handoff', callId: 'c1' }; b.host = {};
  b._putBack = () => { putBack += 1; b.st.at = 'idle'; }; b.close = () => { closed += 1; };
  b.hungUp({ id: 'pp1' }, 'c1');
  ok(putBack === 1 && closed === 1, 'a booth still open for that call puts the handset back and closes');
}
ok(/bus\?\.on\(EVENTS\.CALL_ENDED[^\n]*this\._putBack\(\); this\.close\(\);/.test(booth), 'its own call ending closes an open booth too');

// ═══ 3. The bar above the booth ═══
{
  const html = boothHtml({ look: {}, uid: 't', place: 'Kabuki', number: '555' });
  const foot = html.indexOf('ncm-pb__foot'), by = html.indexOf('data-pb-by'), cas = html.indexOf('ncm-pb__case');
  ok(foot > 0 && by > 0 && foot < cas && by < cas, 'Walk away and "who is on it" come before the booth');
  ok(!/ncm-pb__foot|data-pb-by/.test(boothHtml({ look: {}, uid: 'p', preview: true })), 'the admin preview has neither');
  const css = read('styles/components/payphone-booth.css');
  ok(/\.ncm-pb__foot \{[^}]*margin-bottom: 8px/.test(css) && /\.ncm-pb__by \{[^}]*margin: 0 0 10px/.test(css), 'their spacing sits below them now');
}

console.log(`test-payphone-booth-polish: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
