// Sim: hotbar drops with the Cyberpunk RED system loaded (audit remediation C3: COMPAT-02).
//
// CPR registers its own `hotbarDrop` hook first and returns false for every drop, so NCM's hook never ran: a converted
// terminal became a "toggle the item sheet" macro (which then showed the raw gear sheet), and an NCMAccess drag threw
// inside CPR's hook. NCM now claims ITS drags in the capture phase on #hotbar, before Foundry's own drop handling, and
// opens a terminal (not its sheet) when an item sheet is asked for.
// Drives the REAL registerAccessPoints listener and ShardSheetOverride._onRenderItemSheet with a fake DOM.
import { pathToFileURL, fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const load = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };
const MOD = 'night-city-messenger';

// ── a fake DOM: an element knows its ancestors ──
const el = (sel, parent = null, dataset = {}) => ({ sel, parent, dataset, closest(q) { for (let e = this; e; e = e.parent) if (q.split(' ').pop() === e.sel || (q === '#hotbar [data-slot]' && e.dataset.slot && hasAncestor(e, '#hotbar'))) return e; return null; } });
const hasAncestor = (e, sel) => { for (let x = e.parent; x; x = x.parent) if (x.sel === sel) return true; return false; };
const listeners = [];
globalThis.document = { addEventListener: (type, fn, cap) => listeners.push({ type, fn, cap }), createElement: () => ({ style: {}, classList: { add() {} }, append() {}, addEventListener() {} }), body: { appendChild() {} } };
const items = {
  'Item.term': { uuid: 'Item.term', name: 'WS-7F', getFlag: (m, k) => (k === 'isTerminal' ? true : null) },
  'Item.shard': { uuid: 'Item.shard', name: 'Chip', getFlag: (m, k) => (k === 'isDataShard' ? true : null) },
  'Item.gun': { uuid: 'Item.gun', name: 'Pistol', getFlag: () => null },
};
globalThis.fromUuidSync = (u) => items[u] ?? null;
const made = [];
globalThis.game = { user: { id: 'u', isGM: true }, items: { get: () => null }, nightcity: {}, settings: { get: () => undefined }, i18n: { localize: (s) => s }, users: { get: () => null } };
globalThis.Hooks = { on() { return 1; }, once() {}, off() {} };
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
globalThis.CONFIG = { TextEditor: { enrichers: [] } };
globalThis.foundry = { utils: { deepClone: (o) => JSON.parse(JSON.stringify(o)), randomID: () => 'r' }, applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (B) => B } } };
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);

const AP = await load('scripts/integrations/AccessPoints.js');
// createAccessMacro is the real macro writer; record what it is asked for instead (it needs Foundry's Macro class)
game.nightcity.__made = made;

// ═══ 1. What counts as an NCM drop ═══
ok(AP.hotbarRefFor({ type: 'NCMAccess', ref: { kind: 'terminal', id: 'Item.term' } })?.kind === 'terminal', 'an NCMAccess drag is ours');
ok(AP.hotbarRefFor({ type: 'Item', uuid: 'Item.term' })?.kind === 'terminal' && AP.hotbarRefFor({ type: 'Item', uuid: 'Item.shard' })?.kind === 'shard', 'a converted terminal or shard item is ours');
ok(AP.hotbarRefFor({ type: 'Item', uuid: 'Item.gun' }) === null && AP.hotbarRefFor({ type: 'Macro', uuid: 'Macro.x' }) === null && AP.hotbarRefFor(null) === null, 'a plain item, a macro or nothing is NOT ours (CPR / Foundry keep it)');
const bar = el('#hotbar');
const slot7 = el('li', bar, { slot: '7' });
const icon = el('img', slot7);
ok(AP.hotbarSlotOf(icon) === 7 && AP.hotbarSlotOf(el('div')) === null, 'the slot is read from the li the drop landed on');

// ═══ 2. The capture-phase claim ═══
{
  const realCreate = AP.createAccessMacro;
  void realCreate;
  AP.registerAccessPoints();
  const drop = listeners.find((l) => l.type === 'drop');
  ok(drop && drop.cap === true, 'a capture-phase drop listener is registered');
  const fire = (target, payload) => {
    const ev = { target, prevented: false, stopped: false, dataTransfer: { getData: () => JSON.stringify(payload) }, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
    drop.fn(ev); return ev;
  };
  // createAccessMacro will fail (no Macro class) — what matters is that the drop is CLAIMED before CPR sees it
  globalThis.Folder = { create: async (d) => ({ id: 'f', ...d }) };
  globalThis.Macro = { create: async (d) => { made.push(d); return { id: 'm', ...d }; } };
  game.macros = Object.assign([], { find: () => null, filter: () => [] });
  game.folders = Object.assign([], { find: () => null });
  game.user.assignHotbarMacro = async (m, s) => { made.push({ assigned: s }); };
  const ev1 = fire(icon, { type: 'Item', uuid: 'Item.term' });
  ok(ev1.prevented && ev1.stopped, 'a terminal dropped on the hotbar is claimed before the system\'s hook');
  const ev2 = fire(icon, { type: 'NCMAccess', ref: { kind: 'shard', id: 'Item.shard' } });
  ok(ev2.prevented && ev2.stopped, 'an NCMAccess drag is claimed (it used to throw inside the system\'s hook)');
  const ev3 = fire(icon, { type: 'Item', uuid: 'Item.gun' });
  ok(!ev3.prevented && !ev3.stopped, 'a plain item passes through to CPR (its weapon / skill macros still work)');
  const ev4 = fire(el('div', el('#board')), { type: 'Item', uuid: 'Item.term' });
  ok(!ev4.prevented, 'a drop anywhere else (the canvas) is not touched here');
  const ev5 = { target: icon, dataTransfer: { getData: () => 'not json' }, preventDefault() { this.p = true; }, stopImmediatePropagation() {} };
  drop.fn(ev5);
  ok(!ev5.p, 'a drop with no JSON payload passes through');
  await new Promise((r) => setTimeout(r, 20));
  ok(made.some((m) => m.assigned === 7), 'the macro lands in the slot it was dropped on');
}

// ═══ 3. A terminal's item sheet opens the terminal ═══
{
  const { ShardSheetOverride } = await load('scripts/integrations/ShardSheetOverride.js');
  const opened = [];
  game.nightcity.openTerminal = (i) => opened.push(['terminal', i.uuid]);
  game.nightcity.openDataShard = (i) => opened.push(['shard', i.uuid]);
  const sheet = (item, bypass = false) => ({ document: item, _ncmBypass: bypass, element: { style: {} }, closed: false, close() { this.closed = true; } });
  const sso = Object.create(ShardSheetOverride.prototype);
  const s1 = sheet(items['Item.term']); sso._onRenderItemSheet(s1);
  ok(s1.closed && opened.at(-1)?.[0] === 'terminal', 'a terminal\'s item sheet closes and the terminal opens instead');
  const s2 = sheet(items['Item.shard']); sso._onRenderItemSheet(s2);
  ok(s2.closed && opened.at(-1)?.[0] === 'shard', 'a shard still opens its viewer');
  const s3 = sheet(items['Item.gun']); sso._onRenderItemSheet(s3);
  ok(!s3.closed, 'a plain item keeps its sheet');
  const s4 = sheet(items['Item.term'], true); sso._onRenderItemSheet(s4);
  ok(!s4.closed, 'the GM\'s "Edit item sheet" still opens the real sheet');
}

console.log(`test-hotbar-drop: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
