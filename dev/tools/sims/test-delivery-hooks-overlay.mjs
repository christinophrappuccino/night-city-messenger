// test-delivery-hooks-overlay — two small shared pieces (R19, R17; after stage 2).
// (1) MessageService.onDelivered: what happens after every delivered message (the terminal mirror, network taps) is a
//     list the owning features register into — run in order, awaited, a failure logged and never fatal, the same name
//     replacing itself, each given the RECIPIENT-facing clone. (2) ui/overlay.js mountOverlay: the frame every
//     framework-free modal shares — Escape and a backdrop click close with null, a click inside the panel does not,
//     close runs onClose once and removes its listener; OperatorSelect is its first user.
// Run: node dev/tools/sims/test-delivery-hooks-overlay.mjs   (NCM_ROOT=<dir> to check another checkout)
import { readFileSync } from 'fs';
import path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';

const ROOT = path.resolve(process.env.NCM_ROOT || fileURLToPath(new URL('../../../', import.meta.url)));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

// ═══ 1. after delivery ═══
globalThis.game = { user: { isGM: true }, settings: { get: () => undefined }, nightcity: {} };
globalThis.Hooks = { on() {}, once() {}, callAll() {} };
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
globalThis.foundry = { utils: { deepClone: (o) => structuredClone(o), randomID: () => 'r' } };
const warns = []; const realWarn = console.warn; console.warn = (...a) => warns.push(a.join(' '));
{
  const { MessageService } = await imp('scripts/services/MessageService.js');
  const ms = Object.create(MessageService.prototype);
  const ran = [];
  ms.onDelivered('taps', async (r) => { await new Promise((x) => setTimeout(x, 5)); ran.push(`taps:${r.from}`); }, { order: 20 });
  ms.onDelivered('mirror', (r, ctx) => { ran.push(`mirror:${r.from}:${ctx.recipientInboxId}`); }, { order: 10 });
  ms.onDelivered('broken', () => { throw new Error('boom'); }, { order: 15 });
  await ms._runAfterDelivery({ from: 'masked@anon' }, { recipientInboxId: 'J1' });
  ok(ran.join() === 'mirror:masked@anon:J1,taps:masked@anon', `in order, each awaited, given the recipient clone and the context (${ran.join()})`);
  ok(warns.some((w) => /after delivery, "broken" failed/.test(w)), 'a failing one is logged and the rest still run');
  ran.length = 0;
  ms.onDelivered('mirror', () => ran.push('mirror-2'), { order: 10 });
  ms.onDelivered('broken', () => {}, { order: 15 });
  await ms._runAfterDelivery({ from: 'x' }, {});
  ok(ran.join() === 'mirror-2,taps:x', 'registering a name again replaces it (no double mirror)');
  const MS = read('scripts/services/MessageService.js');
  ok(MS.includes('await this._runAfterDelivery(recipientData, { data, recipientInboxId, spamFiltered });') && !/mirrorDeliveryToAccounts|tapDelivery/.test(MS), '_deliverMessage runs the list and no longer calls the mirror or the taps itself');
  ok(read('scripts/init/registerTerminalSystem.js').includes("onDelivered('terminal-mirror',") && read('scripts/init/registerNetworkSystem.js').includes("onDelivered('node-taps',"), 'the terminal and network systems register their own');
}
console.warn = realWarn;

// ═══ 2. the overlay frame ═══
{
  // a small DOM: elements with children, listeners, remove(); a document with keydown listeners
  class El {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null; this.className = ''; this.innerHTML = ''; this._l = {}; }
    appendChild(c) { c.parentElement = this; this.children.push(c); return c; }
    remove() { const p = this.parentElement; if (p) { p.children.splice(p.children.indexOf(this), 1); this.parentElement = null; } }
    addEventListener(t, fn) { (this._l[t] ||= []).push(fn); }
    fire(t, e) { for (const fn of this._l[t] || []) fn(e); }
  }
  const docL = {};
  globalThis.document = { body: new El('body'), createElement: (t) => new El(t),
    addEventListener: (t, fn) => { (docL[t] ||= new Set()).add(fn); }, removeEventListener: (t, fn) => docL[t]?.delete(fn) };
  const key = (k) => { let prevented = false; for (const fn of [...(docL.keydown || [])]) fn({ key: k, preventDefault: () => { prevented = true; } }); return prevented; };
  globalThis.matchMedia = (q) => ({ matches: q.includes('reduce') && globalThis.__reduced === true });
  const { mountOverlay, prefersReducedMotion } = await imp('scripts/ui/overlay.js');

  const closes = [];
  let o = mountOverlay({ className: 'ncm-x-backdrop', html: '<div class="ncm-x"></div>', onClose: (v) => closes.push(v) });
  ok(document.body.children.includes(o.root) && o.root.className === 'ncm-x-backdrop' && o.root.innerHTML.includes('ncm-x'), 'mounts the backdrop (with its markup) in <body> by default');
  ok(key('Escape') && closes.length === 1 && closes[0] === null && !document.body.children.includes(o.root) && o.closed, 'Escape closes it with null and removes it');
  ok((docL.keydown?.size || 0) === 0, 'and its Escape listener goes with it');
  o.close('again');
  ok(closes.length === 1, 'onClose runs once, however many times close is called');

  const host = new El('section');
  o = mountOverlay({ host, onClose: (v) => closes.push(v) });
  ok(host.children.includes(o.root), 'mounts in the host when given one (so it inherits the viewer\'s theme)');
  const inner = new El('div');
  o.root.fire('click', { target: inner });
  ok(!o.closed, 'a click inside the panel does not close it');
  o.root.fire('click', { target: o.root });
  ok(o.closed && closes.at(-1) === null, 'a click on the backdrop itself closes it with null');

  let escSeen = 0;
  o = mountOverlay({ onEsc: (e, close) => { escSeen++; close('custom'); }, onBackdrop: false, onClose: (v) => closes.push(v) });
  o.root.fire('click', { target: o.root });
  ok(!o.closed, 'onBackdrop:false ignores the backdrop');
  key('Escape');
  ok(escSeen === 1 && closes.at(-1) === 'custom', 'onEsc as a function decides');
  globalThis.__reduced = true;
  ok(prefersReducedMotion() === true && mountOverlay({}).motion === false, 'motion is false under reduced motion');

  const OS = read('scripts/ui/content/OperatorSelect.js');
  ok(/const o = mountOverlay\(\{ host, className: 'ncm-opsel-backdrop', onClose: resolve,/.test(OS) && !/document\.addEventListener\('keydown'/.test(OS), 'OperatorSelect uses the shared frame (no hand-written Escape listener left)');
}

console.log(`test-delivery-hooks-overlay: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
