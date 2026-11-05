// test-trace-consequences — stage 2, step 16. (1) Trace consequences is a LIVE switch: off, a failure is still
// logged but gains no heat, alerts no GM and shows the player no splash; flipping it takes effect at once.
// (2) Residents no longer ride inside the trace funnel: recordTrace announces EVENTS.TRACE_RECORDED { row, heat }
// and TerminalService.residentsOnTrace answers it. Drives the REAL TraceService and features.js with a mocked game.
// Run: node dev/tools/sims/test-trace-consequences.mjs   (NCM_ROOT=<dir> to check another checkout)
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';

const ROOT = path.resolve(process.env.NCM_ROOT || fileURLToPath(new URL('../../../', import.meta.url)));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);
if (!existsSync(path.join(ROOT, 'scripts/utils/features.js')) || !/traceConsequences/.test(read('scripts/utils/features.js'))) {
  ok(false, 'the traceConsequences feature exists'); console.log(`test-trace-consequences: ${pass} passed, ${fail} failed`); process.exit(1);
}

// ── a GM's game ──
const store = new Map([['traceLog', []], ['traceHeat', {}], ['traceCountdowns', []], ['securityAlertLevel', 'every'], ['traceConsequencesEnabled', true]]);
const toasts = [], chats = [], sounds = [], splashes = [], events = [];
let id = 0;
globalThis.foundry = { utils: { randomID: () => `r${++id}`, deepClone: (o) => structuredClone(o) } };
globalThis.ui = { notifications: { warn: (m) => toasts.push(m), info() {}, error() {} } };
globalThis.ChatMessage = { create: async (d) => { chats.push(d); } };
globalThis.Hooks = { on() {}, once() {}, callAll() {} };
const gm = { id: 'gm1', isGM: true };
globalThis.game = {
  user: gm,
  users: Object.assign([gm], { activeGM: gm, get: (i) => (i === 'gm1' ? gm : null) }),
  settings: {
    get: (m, k) => { if (!store.has(k)) throw new Error(`not registered: ${k}`); return store.get(k); },
    set: async (m, k, v) => { store.set(k, structuredClone(v)); return v; },
    settings: { has: (key) => store.has(key.split('.').slice(1).join('.')) },
  },
  actors: { get: () => null },
  items: { get: () => null },
  nightcity: {
    soundService: { play: (s) => sounds.push(s) },
    notificationService: { showShardTrace: (d) => splashes.push(d) },
    timeService: { getCurrentTimeMs: () => 1_000_000 },
    eventBus: { emit: (e, d) => events.push([e, d]) },
  },
};

const { EVENTS } = await imp('scripts/utils/constants.js');
const { TraceService } = await imp('scripts/services/TraceService.js');
const F = await imp('scripts/utils/features.js');
const tr = new TraceService();
const { installJournals } = await import('./lib/journalMock.mjs');
const J = installJournals(globalThis.game);   // the trace log is a GM-only journal page since stage 2 step 13
const reset = () => { for (const a of [toasts, chats, sounds, splashes, events]) a.length = 0; store.set('traceLog', []); store.set('traceHeat', {}); for (const j of J.all()) j.pages.length = 0; };

// ═══ 1. on (today's behaviour) ═══
ok(F.FEATURES.traceConsequences?.live === true, 'traceConsequences is a live feature');
reset();
tr.fireTrace({ action: 'crack', objectId: 'box', objectName: 'The Box', severity: 'major' });
await new Promise((r) => setTimeout(r, 20));
ok(splashes.length === 1 && sounds.includes('trace-fire'), 'on: the trace splash and sound play');
ok(tr.getLog().length === 1 && tr.getLog()[0].heatDelta === 20, 'on: the row is logged with its heat');
ok(tr.getHeat('box', 'unknown') === 20, 'on: heat goes up');
ok(toasts.length === 1 && chats.length === 1, 'on: the GM gets the toast and the whisper');
const ev = events.find(([e]) => e === EVENTS.TRACE_RECORDED);
ok(!!ev && ev[1].row?.action === 'crack' && ev[1].row.id && ev[1].heat === 20, 'on: EVENTS.TRACE_RECORDED carries the written row and the heat');

// ═══ 2. off — live, no reset needed ═══
store.set('traceConsequencesEnabled', false);
reset();
tr.fireTrace({ action: 'crack', objectId: 'box', objectName: 'The Box', severity: 'hostile' });
await new Promise((r) => setTimeout(r, 20));
ok(splashes.length === 0 && !sounds.includes('trace-fire'), 'off: no splash, no trace sound (takes effect without a reload)');
ok(tr.getLog().length === 1 && tr.getLog()[0].heatDelta === 0 && tr.getLog()[0].outcome === 'failed', 'off: the failure is still logged, with no heat');
ok(tr.getHeat('box', 'unknown') === 0, 'off: heat does not move');
ok(toasts.length === 0 && chats.length === 0, 'off: no GM toast, no whisper');
const ev2 = events.find(([e]) => e === EVENTS.TRACE_RECORDED);
ok(!!ev2 && ev2[1].heat === 0, 'off: the event still fires (a success still reaches its onAction residents), with heat 0');
reset();
tr.logSuccess({ action: 'siphon', objectId: 'box' });
await new Promise((r) => setTimeout(r, 20));
ok(tr.getLog().length === 1 && events.some(([e, d]) => e === EVENTS.TRACE_RECORDED && d.row.outcome === 'success'), 'off: a success is logged and announced as before');
store.set('traceConsequencesEnabled', true);
ok(F.isFeatureOn('traceConsequences') === true, 'turned back on: read at once, never cached');

// the GM's own tools are untouched
store.set('traceConsequencesEnabled', false);
reset();
await tr.setHeat('box', 'a1', 60, { objectName: 'The Box' });
ok(tr.getHeat('box', 'a1') === 60, 'off: the GM can still set heat by hand');
store.set('traceConsequencesEnabled', true);

// ═══ 3. residents answer the event; the trace spine calls no one ═══
const TS = read('scripts/services/TraceService.js');
ok(!/terminalService/.test(TS) && !/_fireResidentTriggers/.test(TS), 'TraceService no longer reaches the terminal service');
ok(/eventBus\?\.emit\(EVENTS\.TRACE_RECORDED, \{ row, heat \}\)/.test(TS), 'recordTrace announces EVENTS.TRACE_RECORDED');
const RT = read('scripts/init/registerTerminalSystem.js');
ok(/bus\.on\(EVENTS\.TRACE_RECORDED, \(\{ row, heat \} = \{\}\) => \{\n\s*if \(!isGM\(\)\) return;\n\s*game\.nightcity\?\.terminalService\?\.residentsOnTrace\?\.\(row, heat\)/.test(RT), 'the terminal system listens and hands the row to residentsOnTrace (GM only)');
{
  const { TerminalService } = await imp('scripts/services/TerminalService.js');
  const term = { id: 't1', uuid: 'Item.t1' };
  globalThis.fromUuidSync = (u) => (u === 'Item.t1' ? term : null);
  const seen = [];
  const ts = { isTerminal: (i) => i === term, collectTerminals: () => [term],
    checkActionResidents: async (i, a) => { seen.push(`action:${a}`); }, checkHeatResidents: async (i, h) => { seen.push(`heat:${h}`); } };
  const run = (row, heat) => TerminalService.prototype.residentsOnTrace.call(ts, row, heat);
  await run({ targetKind: 'terminal', objectId: 't1', targetUuid: 'Item.t1', outcome: 'success', action: 'siphon' }, 30);
  ok(seen.join() === 'action:siphon,heat:30', 'a success on a terminal reaches onAction and onHeat residents');
  seen.length = 0;
  await run({ targetKind: 'terminal', objectId: 't1', outcome: 'failed', action: 'crack' }, 45);
  ok(seen.join() === 'heat:45', 'a failure reaches only onHeat');
  seen.length = 0;
  await run({ targetKind: 'terminal', objectId: 't1', outcome: 'success', action: 'exfil' }, 0);
  ok(seen.join() === 'heat:0', "'exfil' is left to its own listener (no double proposal)");
  seen.length = 0;
  await run({ targetKind: 'shard', objectId: 's1', outcome: 'success', action: 'decrypt' }, 10);
  await run(null, 0);
  ok(seen.length === 0, 'a shard row, or no row, reaches no resident');
}

// ═══ 4. a live feature cannot tag startup steps or socket ops ═══
{
  const { ModuleInitializer } = await imp('scripts/core/ModuleInitializer.js');
  const { SocketManager } = await imp('scripts/core/SocketManager.js');
  let threw = 0;
  try { new ModuleInitializer().register('ready', 1, 'x', () => {}, { feature: 'traceConsequences' }); } catch { threw++; }
  try { new SocketManager().register('x', () => {}, { feature: 'traceConsequences' }); } catch { threw++; }
  ok(threw === 2, 'a live feature is refused as a startup-step or socket tag (it is checked where it applies)');
  ok(Object.values(F.FEATURES).every((f) => !(f.requires || []).some((r) => F.FEATURES[r]?.live)), 'no feature requires a live one');
}

console.log(`test-trace-consequences: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
