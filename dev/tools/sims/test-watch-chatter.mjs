// Sim: watch chatter (audit remediation D6: PERF-04).
//
// A watched node console re-sent the window ~10× a second for as long as anyone watched: its traffic wave redraws
// every 70 ms and every redraw was a DOM change the watch observer reported. And an edit too big to send returned
// without a "next time", so it could retry every 30 ms with a snapshot near 900 KB.
// Drives the REAL WatchService over a scripted socket, a fake MutationObserver and fake DOM nodes.
import { pathToFileURL, fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const read = (p) => readFileSync(`${ROOT}/${p}`, 'utf8');
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };

globalThis.game = { user: { id: 'op', isGM: false }, users: { get: () => ({ name: 'Rache' }) }, settings: { get: () => 'player' }, nightcity: {} };
globalThis.foundry = { utils: { deepClone: (o) => JSON.parse(JSON.stringify(o)), mergeObject: (a, b) => ({ ...a, ...b }), randomID: () => 'id' } };
globalThis.Hooks = { on() {}, once() {}, off() {} };
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
globalThis.CONFIG = {};
globalThis.Handlebars = { escapeExpression: (s) => String(s ?? ''), registerHelper() {} };
let observerCb = null;
globalThis.MutationObserver = class { constructor(cb) { observerCb = cb; } observe() {} disconnect() {} };

const { WatchService, MAX_PICTURE, TOO_BIG_BACKOFF_MS, watchIgnoredOnly } = await import(pathToFileURL(`${ROOT}/scripts/services/WatchService.js`).href);

// ── fake DOM nodes: an element knows whether it sits inside [data-watch-ignore] ──
const el = (ignored) => ({ nodeType: 1, closest: (s) => (s === '[data-watch-ignore]' && ignored ? {} : null) });
const text = (ignored) => ({ nodeType: 3, parentElement: el(ignored) });

// ═══ 1. The rule ═══
ok(watchIgnoredOnly([{ target: el(true) }, { target: text(true) }]), 'changes only inside a [data-watch-ignore] element are decoration');
ok(!watchIgnoredOnly([{ target: el(true) }, { target: el(false) }]), 'one real change among them is a real change');
ok(!watchIgnoredOnly([]), 'no changes reported is not "decoration" (nothing is skipped by accident)');

// ═══ 2. The observer skips the wave, not the window ═══
{
  const sent = [];
  const svc = new WatchService({ socket: { emit: (op, d) => sent.push(d) }, snapshot: () => ({ html: '<b>x</b>' }) });
  class App { static WATCHABLE = true; constructor() { this.id = 'node'; this.title = 'Relay'; this.element = { querySelector: () => null, addEventListener() {} }; } }
  const rec = svc.startShare(new App());
  let scheduled = 0;
  svc._schedule = () => { scheduled += 1; };
  rec.watchers.add('w1');
  svc._syncObserver(rec);
  ok(typeof observerCb === 'function', 'a watcher joining starts the observer');
  for (let i = 0; i < 14; i++) observerCb([{ target: el(true) }]);   // a second of the wave redrawing every 70 ms
  ok(scheduled === 0, 'a second of the traffic wave redrawing triggers no send');
  observerCb([{ target: el(false) }]);
  ok(scheduled === 1, 'a real change in the window still does');
}

// ═══ 3. Too big: back off instead of retrying every 30 ms ═══
{
  const sent = [];
  let snap = { html: '<b>one</b>' };
  const svc = new WatchService({ socket: { emit: (op, d) => sent.push(d) }, snapshot: () => snap });
  class App { static WATCHABLE = true; constructor() { this.id = 'term'; this.title = 'WS'; this.element = { querySelector: () => null, addEventListener() {} }; } }
  const rec = svc.startShare(new App());
  rec.watchers.add('w1');
  svc._send(rec, { to: 'w1' });                        // the joiner's picture
  snap = { html: 'x'.repeat(MAX_PICTURE + 10) };
  const t0 = Date.now();
  svc._send(rec);
  ok(sent.at(-1)?.type === 'tooBig', 'a picture too big to send tells the watcher');
  ok(rec.nextAt >= t0 + TOO_BIG_BACKOFF_MS - 5, `and waits about ${TOO_BIG_BACKOFF_MS / 1000} s before trying again (it used to have no next time)`);
  const delays = [];
  const realSet = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms) => { delays.push(ms); return 0; };
  try { svc._schedule(rec.app.id); } finally { globalThis.setTimeout = realSet; }
  ok(delays[0] >= TOO_BIG_BACKOFF_MS - 50, 'the next scheduled send really waits for it');
}

// ═══ 4. Wiring ═══
ok(/<svg[^>]*data-watch-ignore[^>]*><path data-ndc-wave/.test(read('templates/network-nodes/node-console.hbs')), 'the node console\'s traffic wave is marked data-watch-ignore');

console.log(`test-watch-chatter: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
