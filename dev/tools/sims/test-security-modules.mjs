// Sim: Admin → Security modules (2026-10-28) — Heat = thermometers, Activity = the seismograph.
// Mocks: dev/mockups/admin-security-heat-modules-mock.html (A) + admin-security-seismograph-mock.html (A).
// 1. the pure rules in scripts/ui/AdminPanel/tabs/securityModel.js
// 2. the REAL SecurityTab over mocked globals: contexts, every new op, DOM-only toggles
// 3. template ↔ tab ↔ css wiring guards
// 4. the REAL template through Foundry's Handlebars, both views
// Run: node dev/tools/sims/test-security-modules.mjs   (NCM_DUMP=<file.json> writes the two contexts)
import fs from 'fs';
import { createRequire } from 'module';
import { pathToFileURL, fileURLToPath } from 'url';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };
const read = (p) => fs.readFileSync(`${ROOT}/${p}`, 'utf8');
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
const M = await imp('scripts/ui/AdminPanel/tabs/securityModel.js');
const MIN = 60000;
const NOW = Date.UTC(2045, 7, 14, 23, 55);

// ═══ 1. rules ═══
ok(M.heatTierOf(0) === 'cold' && M.heatTierOf(24) === 'cold' && M.heatTierOf(25) === 'warm' && M.heatTierOf(50) === 'hot' && M.heatTierOf(80) === 'burned', 'tiers 25 / 50 / 80');
ok(M.HEAT_BANDS.reduce((s, [, h]) => s + h, 0) === 100 && M.HEAT_BANDS.map(([k]) => k).join() === 'cold,warm,hot,burned', 'tube bands fill 100% bottom→top cold→burned');
let c = M.countdownClock({ id: 'c', expiresAt: NOW + 5 * MIN, startedAt: NOW - 5 * MIN, source: 'Arasaka' }, NOW);
ok(Math.abs(c.frac - 0.5) < 1e-9 && c.label === '5:00' && Number(c.offset) > 0 && Number(c.offset) < Number(c.circ), 'clock: half gone → half the ring, mm:ss left');
c = M.countdownClock({ expiresAt: NOW + 10 * MIN }, NOW);
ok(c.total === 30 * MIN && c.source === 'A trace', 'legacy countdown (no startedAt): whole length guessed ≥ 30 min, default source');
ok(M.countdownClock({ expiresAt: NOW - 1000 }, NOW).label === 'due', 'an expired countdown reads "due"');

const heatRows = [
  { objectId: 'ws7', actorId: 'R', objectName: 'WS-7F-12', actorName: 'Rache', value: 86 },
  { objectId: 'corp', actorId: 'R', objectName: 'CorpNet', actorName: 'Rache', value: 61 },
  { objectId: 'arc', actorId: 'R', objectName: 'Arasaka kiosk', actorName: 'Rache', value: 22 },
  { objectId: 'mil', actorId: 'J', objectName: 'Militech shard', actorName: 'Judy', value: 18 },
  { objectId: 'ws7', actorId: 'V', objectName: 'WS-7F-12', actorName: 'V', value: 34 },
  { objectId: 'zero', actorId: 'Z', objectName: 'Gone', actorName: 'Zed', value: 0 },
];
const cds = [{ id: 'cd1', actorId: 'R', actorName: 'Rache', source: 'Arasaka', objectName: 'WS-7F-12', expiresAt: NOW + 4 * MIN, startedAt: NOW - 6 * MIN },
  { id: 'cd2', actorId: 'B', actorName: 'Brick', source: 'Militech NetSec', objectName: 'Militech shard', expiresAt: NOW + 12 * MIN, minutes: 15 }];
let T = M.thermometers(heatRows, cds, { nowMs: NOW });
ok(T.gauges.length === 4 && !T.gauges.some((g) => g.actorName === 'Zed'), 'one gauge per operator; zero heat drops, a countdown-only operator stays');
ok(T.gauges[0].actorName === 'Rache' && T.gauges[0].peak === 86 && T.gauges[0].tier === 'burned' && T.gauges[0].peakObjectId === 'ws7', 'hottest first; the gauge shows the peak object');
ok(T.gauges[0].marks.length === 3 && T.gauges[0].marks.map((m) => m.bottom).join() === '86,61,22', 'a side tick per object at its heat');
ok(T.gauges[0].clock.has && T.gauges[0].clock.label === '4:00' && !T.gauges.find((g) => g.actorName === 'V').clock.has, 'a clock ring only where a trace is closing in');
const brick = T.gauges.find((g) => g.actorName === 'Brick');
ok(brick && brick.peak === 0 && brick.tierLabel === 'none' && brick.clock.has, 'countdown-only operator: an empty tube with its clock');
ok(T.sel.actorId === 'R' && !T.sel.objectSelected && T.sel.actOn.objectId === 'ws7' && T.sel.canEscalate && T.sel.clearsAll, 'default pick = hottest operator, acting on their hottest object, Clear = all');
ok(T.hotCount === 1 && T.traceCount === 2, 'band counts: running hot (peak ≥ 50) + traces running');
T = M.thermometers(heatRows, cds, { nowMs: NOW, selActorId: 'R', selObjectId: 'arc' });
ok(T.sel.objectSelected && T.sel.actOn.objectId === 'arc' && !T.sel.canEscalate && !T.sel.clearsAll && T.sel.objects.find((o) => o.selected).objectId === 'arc', 'an object pick: act on it alone; Escalate shut under 25');
T = M.thermometers(heatRows, cds, { nowMs: NOW, selActorId: 'B' });
ok(T.sel.actorId === 'B' && T.sel.actOn === null && !T.sel.canAdjust && !T.sel.canClear && T.sel.cd.id === 'cd2', 'countdown-only pick: nothing to adjust, the countdown is there');
T = M.thermometers(heatRows, cds, { nowMs: NOW, selActorId: 'nobody' });
ok(T.sel.actorId === 'R', 'a stale pick falls back to the hottest');
ok(M.thermometers([], [], { nowMs: NOW }).any === false && M.thermometers([], [], {}).sel === null, 'nothing hot: empty');

// events (TraceService rows, oldest first)
const S0 = NOW - 355 * MIN;
const raw = [];
const add = (m, who, name, action, kind, tgt, okay, sev, verb, total, dv) => raw.push({
  id: `e${raw.length}`, ts: new Date(S0 + m * MIN).toISOString(), actorId: who, actorName: name, action, targetKind: kind, objectName: tgt, objectId: tgt.toLowerCase(),
  outcome: okay ? 'success' : 'failed', severity: sev, netVerb: verb || null, dv, margin: dv != null ? total - dv : null, heatDelta: okay ? 0 : ({ minor: 10, major: 20, hostile: 35 })[sev],
});
add(12, 'K', 'Kowalski', 'terminal-login', 'terminal', 'PD', 1, 'minor', '', 17, 15);
add(19, 'R', 'Rache', 'net-hack', 'network', 'CitiNet', 1, 'minor', 'Backdoor', 19, 15);
add(208, 'R', 'Rache', 'terminal-login', 'terminal', 'WS7', 0, 'major', '', 11, 18);
add(211, 'R', 'Rache', 'terminal-login', 'terminal', 'WS7', 0, 'major', '', 9, 18);
add(214, 'R', 'Rache', 'terminal-login', 'terminal', 'WS7', 0, 'hostile', '', 4, 18);
add(219, 'T', 'Tess', 'net-hack', 'terminal', 'WS7', 0, 'major', 'Backdoor', 13, 18);
add(232, 'K', 'Kowalski', 'siphon', 'bank', 'Ledger', 0, 'major', 'Control', 13, 19);
add(286, 'J', 'Juno', 'terminal-login', 'terminal', 'WS7', 0, 'major', '', 12, 18);
add(291, 'J', 'Juno', 'terminal-login', 'terminal', 'WS7', 1, 'minor', '', 18, 18);
add(331, 'R', 'Rache', 'net-hack', 'network', 'CorpNet', 0, 'hostile', 'Backdoor', 9, 20);
add(349, 'K', 'Kowalski', 'admin-view', 'terminal', 'PD', 1, 'minor', '', null, null);
const EV = raw.map((r, i) => M.normEvent(r, i));
ok(EV[0].ok && EV[0].heat === 0 && !EV[2].ok && EV[2].heat === 20 && EV[4].heat === 35 && EV[2].total === 11, 'normEvent: ok / heat from heatDelta / roll total = dv + margin');
ok(M.normEvent({ ts: 'x', outcome: 'failed', severity: 'weird' }).heat === 20 && M.normEvent({ outcome: 'failed', severity: 'minor' }).heat === 10, 'normEvent: unknown severity → major; no heatDelta → severity heat');
ok(M.normEvent({ actorName: 'Ghost', targetKind: 'satellite' }).kind === 'other' && M.normEvent({ actorName: 'Ghost' }).who === 'name:ghost', 'normEvent: unknown kind → other; no actor id → keyed by name');
const LAST = S0 + 280 * MIN;
ok(M.sliceOK({ who: ['R'] }, EV[2]) && !M.sliceOK({ who: ['R'] }, EV[0]) && M.sliceOK({ kind: ['bank'] }, EV[6]) && M.sliceOK({ verb: ['none'] }, EV[0]) && !M.sliceOK({ verb: ['none'] }, EV[1]), 'slices: who / kind / verb (none = no NET verb)');
ok(!M.sliceOK({ res: 'fail' }, EV[0]) && M.sliceOK({ res: 'ok' }, EV[0]) && !M.sliceOK({ sev: ['hostile'] }, EV[2]) && !M.sliceOK({ objectId: 'pd' }, EV[2]), 'slices: result / severity / object');
ok(M.slicesOn({ who: ['R', 'K'], res: 'fail', objectId: 'x' }) === 4 && M.slicesOn({}) === 0, 'slicesOn counts what narrows the view');
ok(M.chipOK('serious', EV[2]) && !M.chipOK('serious', EV[0]) && M.chipOK('fumbles', EV[2]) && !M.chipOK('fumbles', EV[0]), 'chips: serious = not minor, fumbles = failed');
ok(M.pickCount(EV, { who: ['R'] }, 'kind', 'terminal') === 3 && M.pickCount(EV, {}, 'res', 'fail') === 7, 'pickCount: what you would see if you picked it (inside the other slices)');
const order = M.whoOrder(EV);
ok(order[0].who === 'R' && order[0].n === 5 && order.find((o) => o.who === 'R').heat === 20 + 20 + 35 + 35, 'whoOrder: most events first, with heat');
const ids = (L) => L.map((e) => e.id).join();
ok(M.sortEvents(EV, 'new')[0].id === 'e10' && M.sortEvents(EV, 'old')[0].id === 'e0', 'sort newest / oldest');
ok(M.sortEvents(EV, 'heat')[0].heat === 35 && M.sortEvents(EV, 'heat')[0].t > M.sortEvents(EV, 'heat')[1].t, 'sort most heat (ties newest first)');
ok(M.sortEvents(EV, 'who', order.map((o) => o.who))[0].who === 'R' && M.sortEvents(EV, 'tgt')[0].target === 'CitiNet', 'sort character / target');
ok(M.filterLog(EV, { q: 'ledger' }).length === 1 && M.filterLog(EV, { q: 'rache' }).length === 5, 'search: who / target');
ok(M.filterLog(EV, { q: 'bypass', label: (e) => (e.action === 'net-hack' ? 'Network bypass' : e.action) }).length === 3, 'search matches the plain action label');
const sp = M.spikeRange(EV[3].t, NOW);
ok(sp[0] === EV[3].t - 4 * MIN && sp[1] === EV[3].t + 4 * MIN, 'click a spike = ±4 min');
ok(M.spikeRange(NOW - MIN, NOW)[1] === NOW, 'a spike range never runs past now');
ok(ids(M.filterLog(EV, { range: sp })) === 'e4,e3,e2', 'the range narrows the log');
const br = M.brushRange(NOW, NOW - 30 * MIN, NOW);
ok(br[0] === NOW - 30 * MIN && br[1] === NOW, 'drag either way = an ordered range');
const V = M.viewOf('session', NOW);
ok(V.t1 > NOW && Math.round(V.x(NOW)) === 678 && V.t1 - V.t0 === 6 * 60 * MIN && Math.round(V.ms(V.x(EV[3].t))) === EV[3].t, 'session view: 6 h ending a sliver after now; x ↔ ms');
ok(M.contrib(EV[2], 0, 1) > M.contrib(EV[2], 30, 1) && M.contrib(EV[2], 80, 1) === 0 && Math.abs(M.contrib(EV[0], 0, 1)) < 3, 'contrib: a failure kicks and decays; a success is a tick');
ok(M.contrib(EV[4], 0, 1) > M.contrib(EV[2], 0, 1), 'more heat = a taller kick');

const hue = (e) => `var(--hue-${e.whoName})`;
let G = M.seismograph(EV, { nowMs: NOW, lastSeen: LAST, hueOf: hue });
ok(G.peaks.length === 7 && G.ticks.length === 4 && G.runs.length > 1, 'combined: a peak per failure, a tick per success, the line split into runs');
ok(G.peaks.every((p) => p.col === 'var(--ncm-bad)') && G.ticks.every((t) => t.col === 'var(--ncm-good)'), 'combined: failures red, successes green');
ok(G.peaks.every((p) => p.y < 78 && p.y >= 0) && G.ticks.every((t) => t.y === 136), 'peaks sit above the baseline, ticks on the rail');
ok(G.yLabels.length === 5 && G.hgrid.length === 3 && G.PH === 150 && !G.lanesMode, 'combined: +10/+20/+35 grid + heat/ok caps');
ok(G.mark && G.mark.n === 4 && G.newZone && G.lastLine != null, 'last look: the dashed line + "N new" + the tinted zone');
ok(G.tot.n === 11 && G.tot.fail === 7 && G.tot.heat === 170, 'quiet totals over the window');
ok(G.future && G.future.x === G.nowX, 'hatched future after now');
G = M.seismograph(EV, { nowMs: NOW, mode: 'who', hueOf: hue });
ok(G.byWho && G.peaks.find((p) => p.id === 'e2').col === 'var(--hue-Rache)' && G.keyWho.length === 4, 'coloured: spikes in each character’s colour + a who key');
G = M.seismograph(EV, { nowMs: NOW, mode: 'lanes', hueOf: hue });
ok(G.lanesMode && G.laneLabels.length === 4 && G.PH === 4 * 46 + 4 && G.laneLabels[0].name === 'Rache' && G.laneLabels[0].heatLabel === '+110', 'per character: a lane each, heat per lane');
ok(new Set(G.peaks.map((p) => p.lane)).size === 4 && G.peaks.filter((p) => p.lane === 0).length === 4, 'per character: each spike in its own lane');
G = M.seismograph(EV, { nowMs: NOW, mode: 'lanes', f: { who: ['J'] }, hueOf: hue });
ok(G.laneLabels.length === 1 && G.laneLabels[0].who === 'J', 'per character + Who filter: only those lanes');
G = M.seismograph(EV, { nowMs: NOW, range: sp, sel: 'e3' });
ok(G.brush && G.brush.w > 0 && G.selX != null && G.peaks.find((p) => p.id === 'e3').on, 'range = the brush; the picked spike rings + a line');
G = M.seismograph(EV, { nowMs: NOW, zoom: 'hour' });
ok(G.peaks.length === 1 && G.ticks.length === 1 && G.zoomLabel === 'Last hour', 'hour zoom: only the last hour');
G = M.seismograph(EV, { nowMs: NOW, zoom: 'day', lastSeen: S0 - 60 * MIN });
ok(G.vgrid.length >= 8 && G.mark && G.mark.left >= 0, 'day zoom: 3-hour grid; last look inside');
G = M.seismograph(EV, { nowMs: NOW, zoom: 'hour', lastSeen: S0 });
ok(G.mark && G.mark.fit && /everything here is new/.test(G.mark.text), 'last look before the window: "everything here is new"');
ok(M.seismograph([], { nowMs: NOW }).empty && M.seismograph(EV, { nowMs: NOW, f: { who: ['nobody'] } }).empty, 'empty window says so');

const L = M.filterLog(EV, {});
let A = M.annotateLog(L, { page: 1, size: 5, sort: 'new', lastSeen: LAST });
ok(A.rows[0].div && A.rows[0].div.kind === 'new' && /4 new since your last look/.test(A.rows[0].div.text), 'page 1: "N new since your last look" above the first new row');
ok(A.rows[4].div && A.rows[4].div.kind === 'old', 'where new turns old: "before your last look"');
ok(A.rows.filter((r) => r.isNew).length === 4 && A.pages === 3 && A.from === 1 && A.to === 5, 'new rows flagged; pager math');
A = M.annotateLog(L, { page: 2, size: 2, sort: 'new', lastSeen: LAST });
ok(A.rows[0].div && /continued/.test(A.rows[0].div.text), 'a later page inside the new run says "continued"');
ok(M.annotateLog(L, { sort: 'heat', lastSeen: LAST }).rows.every((r) => !r.div), 'no divider on a non-time sort');
ok(M.annotateLog(L, { page: 99, size: 5 }).page === 3, 'page clamps');
ok(M.sevPips('hostile').join() === 'true,true,true' && M.sevPips('minor').join() === 'true,false,false', 'severity pips');
ok(M.clock(Date.UTC(2045, 0, 1, 7, 5)) === '07:05' && /^[A-Z][a-z]{2} \d+ \d\d:\d\d$/.test(M.stamp(NOW - 3 * 86400000, NOW)) && M.stamp(NOW - MIN, NOW) === '23:54', 'clock labels are UTC; older rows get a date');

// ═══ 2. the real tab ═══
const settings = new Map(Object.entries({ securityLogSeen: LAST, securityAlertLevel: 'serious', hackResolution: 'auto', roleAbilityRoll: 'stat', countermeasureVisibility: {}, operatorGate: {} }));
const writes = [];
const heat = { ws7: { R: 86, V: 34 }, corp: { R: 61 }, mil: { J: 18 } };
const setHeatCalls = [];
globalThis.game = {
  user: { isGM: true },
  settings: { get: (m, k) => settings.get(k), set: async (m, k, v) => { writes.push([k, v]); settings.set(k, v); } },
  actors: Object.assign([], { get: (id) => ({ R: { id: 'R', name: 'Rache' }, V: { id: 'V', name: 'V' }, J: { id: 'J', name: 'Judy' } })[id] || null, contents: [] }),
  items: Object.assign([], { get: (id) => (id === 'ws7' ? { id, name: 'WS-7F-12', getFlag: (m, k) => k === 'isTerminal' } : null) }), users: [],
  nightcity: {
    traceService: {
      _nowMs: () => NOW, getLog: () => raw, getHeat: (o, a) => heat[o]?.[a] || 0, getHeatMap: () => heat,
      setHeat: async (o, a, v) => { setHeatCalls.push([o, a, v]); },
      getCountdowns: () => cds, getRecycleBin: () => [],
    },
    networkService: { getNetwork: (id) => (id === 'corp' ? { name: 'CorpNet' } : null) },
    timeService: { getCurrentTimeMs: () => NOW, getProviderInfo: () => ({ effective: 'world-time' }) },
  },
};
globalThis.foundry = { utils: { debounce: (f) => f, deepClone: (x) => JSON.parse(JSON.stringify(x)) } };
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
globalThis.Handlebars = { escapeExpression: (s) => String(s ?? '') };
globalThis.CSS = { escape: (s) => s };
const { SecurityTab } = await imp('scripts/ui/AdminPanel/tabs/SecurityTab.js');
const { ScopePicker } = await imp('scripts/utils/scopePicker.js');
let renders = 0;
const app = { id: 'ncm-admin', _activeTab: 'security', render: () => { renders++; }, element: null, tabs: {} };
const tab = new SecurityTab(app);
let ctx = tab.prepareContext().security;
ok(ctx.sg === null && ctx.thermo === null, 'heavy builds skipped while Live is open');
tab._view = 'heat';
ctx = tab.prepareContext().security;
ok(ctx.thermo && ctx.thermo.gauges.length === 4 && ctx.sg === null, 'Heat view: thermometers built (3 heated operators + the countdown-only one)');
ok(ctx.thermo.gauges[0].actorName === 'Rache' && ctx.thermo.gauges[0].bands.length === 4 && ctx.thermo.sel.objects[0].icon === 'fa-terminal' && ctx.thermo.sel.objects[1].icon === 'fa-tower-broadcast', 'gauges carry bands; objects carry their kind icon');
await tab.onAct('heatPick', {}, { dataset: { actorId: 'V' } });
ok(tab._heatSel.actorId === 'V' && tab.prepareContext().security.thermo.sel.actorName === 'V', 'heatPick: open that operator');
await tab.onAct('heatPick', {}, { dataset: { actorId: 'R' } });
await tab.onAct('heatObj', {}, { dataset: { objectId: 'corp' } });
ctx = tab.prepareContext().security;
ok(ctx.thermo.sel.objectSelected && ctx.thermo.sel.actOn.objectId === 'corp', 'heatObj: act on one object');
await tab.onAct('heatObj', {}, { dataset: { objectId: 'corp' } });
ok(tab._heatSel.objectId === null, 'heatObj again: back to all objects');
await tab.onAct('heatClearActor', {}, { dataset: { actorId: 'R' } });
ok(setHeatCalls.length === 2 && setHeatCalls.every(([, a, v]) => a === 'R' && v === 0), 'heatClearActor: every object of that operator to zero');
ok(tab._gatherHeat(game.nightcity.traceService).all.length === 4, '_gatherHeat keeps every heated pair for the gauges');
tab._view = 'activity';
ctx = tab.prepareContext().security;
ok(ctx.sg && ctx.thermo === null && ctx.sg.trace.peaks.length === 7, 'Activity view: the seismograph built');
ok(tab._lookFrom === LAST && ctx.sg.newSince === 4 && ctx.sg.log.rows[0].div?.kind === 'new', 'last look snapshot + the divider on page 1');
settings.set('securityLogSeen', NOW);  // onRender moves the stamp on while the view is open…
ok(tab.prepareContext().security.sg.newSince === 4, '…the snapshot holds while the view stays open');
for (const k of ['who', 'kind', 'sev', 'res', 'verb', 'trace', 'sort']) ok(/data-scope-btn=/.test(ctx.sg.tools[k]), `toolbar: ${k} is a scope picker`);
ok(/Who/.test(ctx.sg.tools.who) && /Anyone/.test(ctx.sg.tools.who) && /Both/.test(ctx.sg.tools.res) && /Combined/.test(ctx.sg.tools.trace) && /Newest/.test(ctx.sg.tools.sort), 'pickers show their label + current value');
const sgIds = tab._sgIds();
ok(Object.values(sgIds).every((id) => id.startsWith('ncm-admin:security:sg-')), 'picker ids are namespaced per window');
ScopePicker.set(sgIds.who, ['R']);
ctx = tab.prepareContext().security;
ok(ctx.sg.trace.peaks.length === 4 && ctx.sg.log.total === 5 && ctx.sg.pills[0].key === 'who' && ctx.sg.filtered, 'Who = Rache narrows trace + log; a pill says so');
await tab.onAct('sgUnpick', {}, { dataset: { key: 'who', v: 'R' } });
ok(ScopePicker.value(sgIds.who).length === 0, 'sgUnpick removes that pick');
await tab.onAct('sgWho', {}, { dataset: { who: 'K' } });
ok(ScopePicker.value(sgIds.who).join() === 'K', 'sgWho: a name = only that character');
await tab.onAct('sgWho', {}, { dataset: { who: 'K' } });
ok(ScopePicker.value(sgIds.who).length === 0, 'sgWho again = everyone');
await tab.onAct('sgSpike', {}, { dataset: { eid: 'e3', t: String(EV[3].t) } });
ctx = tab.prepareContext().security;
ok(tab._sg.sel === 'e3' && ctx.sg.log.total === 3 && ctx.sg.pills.some((p) => p.key === 'range' && p.isTime), 'sgSpike: that event ±4 min, shown as a time pill');
await tab.onAct('sgSpike', {}, { dataset: {} });
ok(tab._sg.range === null && tab._sg.sel === null, 'click empty trace clears the pick');
await tab.onAct('sgBrush', {}, { dataset: { a: String(NOW - 10 * MIN), b: String(NOW - 70 * MIN) } });
ok(tab._sg.range[0] === NOW - 70 * MIN && tab._sg.range[1] === NOW - 10 * MIN, 'sgBrush: the dragged range');
await tab.onAct('sgZoom', {}, { dataset: { zoom: 'hour' } });
await tab.onAct('sgZoom', {}, { dataset: { zoom: 'nonsense' } });
ok(tab._sg.zoom === 'hour', 'sgZoom: known zooms only');
await tab.onAct('sgSel', {}, { dataset: { eid: 'e2' } });
ok(tab._sg.sel === 'e2' && tab._sg.zoom === 'session', 'sgSel an old row from the hour view → jumps out to the session');
await tab.onAct('sgChip', {}, { dataset: { chip: 'fumbles' } });
ok(tab.prepareContext().security.sg.log.rows.every((r) => !r.ok), 'sgChip fumbles = failed rows');
await tab.onAct('sgObj', {}, { dataset: { objectId: 'ws7', objectName: 'WS7' } });
ctx = tab.prepareContext().security;
ok(ctx.sg.pills.some((p) => p.key === 'obj') && ctx.sg.trace.peaks.every((p) => ['e2', 'e3', 'e4', 'e5', 'e7'].includes(p.id)), 'sgObj: one object, as a pill');
await tab.onAct('sgClearAll', {}, { dataset: {} });
ctx = tab.prepareContext().security;
ok(!ctx.sg.anyPills && tab._filter === 'all' && tab._sg.range === null && tab._objFilter === null && ScopePicker.value(sgIds.res)[0] === 'all', 'sgClearAll: everything back');
ScopePicker.set(sgIds.trace, ['lanes']);
ok(tab.prepareContext().security.sg.trace.lanesMode, 'Trace = per character → lanes');
ScopePicker.set(sgIds.trace, ['bad']);
ScopePicker.set(sgIds.sort, ['heat']);
ok(tab.prepareContext().security.sg.log.rows[0].heatLabel === '+35', 'Sort = most heat');
ScopePicker.set(sgIds.sort, ['new']);
// sgKey is pure display: no render, the key flips in place
const keyEl = { hid: true, toggleAttribute(n, f) { this.hid = f; } };
app.element = { querySelector: (s) => (s === '[data-sg-key]' ? keyEl : null) };
const btn = { classList: { toggle() {} }, setAttribute() {} };
const r0 = renders;
await tab.onAct('sgKey', {}, btn);
ok(renders === r0 && tab._sg.legend && keyEl.hid === false, 'sgKey: DOM-only, remembered');
ok(tab.prepareContext().security.sg.legend === true, 'the key state rides the next render');
app.element = null;
// rows keep the deep link + carry the new columns
const row = tab.prepareContext().security.sg.log.rows.find((r) => r.eid === 'e9');
ok(row && row.netVerb === 'Backdoor' && row.heatLabel === '+35' && row.pips.length === 3 && row.hasRoll && row.rollTotal === 9 && row.whoKey === 'R', 'log row: verb, heat, pips, roll, who key');
ok(tab.prepareContext().security.sg.log.rows.find((r) => r.eid === 'e10').hasRoll === false, 'a no-roll event says "no roll"');

// ═══ 3. wiring ═══
const tpl = read('templates/admin-panel/tab-security.hbs');
const js = read('scripts/ui/AdminPanel/tabs/SecurityTab.js');
const css = read('styles/components/admin-panel/tab-security.css');
const onAct = js.slice(js.indexOf('async onAct('), js.indexOf('async _saveSetting('));
for (const op of ['heatPick', 'heatObj', 'heatClearActor', 'sgZoom', 'sgKey', 'sgSel', 'sgSpike', 'sgBrush', 'sgWho', 'sgObj', 'sgUnpick', 'sgClearAll', 'sgChip']) ok(onAct.includes(`case '${op}'`), `onAct handles ${op}`);
for (const op of [...tpl.matchAll(/data-op="([a-zA-Z]+)"/g)].map((m) => m[1])) ok(onAct.includes(`case '${op}'`), `template op ${op} is handled`);
for (const a of ['securityHeatAdjust', 'securityHeatClear', 'securityEscalate', 'securityCountdownCancel', 'securityJump', 'securityPage', 'securityClearLog', 'securityHeatClearAll']) ok(tpl.includes(`data-action="${a}"`), `the modules reuse ${a}`);
const sec = tpl.slice(tpl.indexOf('═══ ACTIVITY'), tpl.indexOf('═══ MACHINES'));
ok(!/ncm-sec-(?!admin-)[a-z]/.test(sec), 'no ncm-sec-* (non-admin) class in the new sections');
ok(!/\{\{\s*(sub|gt|lt|lower|upper|concat|add|join|log)\b/.test(sec) && !/\{\{#with/.test(sec), 'no helper-named fields, no #with');
ok(!/\.\.\/\.\.\//.test(sec), 'no deep ../');
const used = new Set([...sec.matchAll(/ncm-sec-admin-[a-z0-9_-]+/g)].map((m) => m[0]).filter((x) => !x.endsWith('-')));
for (const cl of used) ok(css.includes(`.${cl}`), `.${cl} is styled`);
const block = css.slice(css.indexOf('MODULES 2026-10-28'));
ok(block.length > 1000 && !/#[0-9a-f]{3,8}\b/i.test(block.replace(/rgba\(0,0,0,[.0-9]+\)/g, '')), 'the module CSS uses tokens only (no hex)');
ok(/@media \(prefers-reduced-motion: reduce\)[\s\S]*ncm-sec-admin-sg__pen \{ animation: none/.test(block), 'reduced motion stops the pen + the fills');
ok(!/rotate\(/.test(block), 'no CSS rotation in the module CSS (the clock ring uses an SVG transform attribute)');
ok(/transform="rotate\(-90 20 20\)"/.test(tpl), 'the clock arc starts at 12 o\'clock via the SVG attribute');
ok(/_wireSeismograph\(el\)/.test(js) && /AbortController/.test(js) && /this\._sgAbort\?\.abort\(\)/.test(js), 'pointer listeners: once per window, torn down on close');
ok(/securityLogSeen', this\._now\(\)/.test(js), 'the last-look stamp is on the game clock');
ok(/startedAt: this\._nowMs\(\)/.test(read('scripts/services/TraceService.js')), 'new countdowns record when they started (for the ring)');
ok(/ScopePicker\.after\(\)/.test(js), 'onRender places the picker popovers');
ok(!/game\.|foundry\.|ui\./.test(read('scripts/ui/AdminPanel/tabs/securityModel.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), 'securityModel is pure (no Foundry globals)');

// ═══ 4. real render ═══
let H = null;
for (const p of ['C:/Program Files/Foundry Virtual Tabletop/resources/app/package.json', 'C:/Program Files (x86)/Foundry Virtual Tabletop/resources/app/package.json']) {
  if (!fs.existsSync(p)) continue;
  try { H = createRequire(p)('handlebars'); break; } catch { /* keep looking */ }
}
if (!H) { fail++; console.error('FAIL: could not load Handlebars from a Foundry install — render checks did not run'); }
else {
  H.registerHelper('eq', (a, b) => String(a) === String(b));
  H.registerHelper('gt', (a, b) => Number(a) > Number(b));
  H.registerHelper('letter', (i) => String.fromCharCode(65 + Number(i)));
  H.registerHelper('ncm-hue', (t) => (t ? 'var(--ncm-hue-1)' : 'var(--ncm-text-label)'));
  const render = H.compile(tpl);
  const dump = {};
  tab._view = 'activity'; tab._lookFrom = null; settings.set('securityLogSeen', LAST);
  ScopePicker.set(sgIds.who, ['R', 'T']); ScopePicker.set(sgIds.kind, ['terminal']); ScopePicker.set(sgIds.trace, ['lanes']);
  tab._sg.range = [S0 + 207 * MIN, S0 + 235 * MIN]; tab._sg.sel = 'e3';
  let sc = tab.prepareContext().security; dump.activityPicked = sc;
  let html = render({ activeTab: 'security', security: sc });
  ok((html.match(/<circle class="peak/g) || []).length === sc.sg.trace.peaks.length && sc.sg.trace.peaks.length === 4, 'render: a circle per failure in view');
  ok(/class="lane"[^>]*data-who="R"/.test(html) && /class="lane"[^>]*data-who="T"/.test(html), 'render: lane labels per character');
  ok((html.match(/ncm-sec-admin-sg__pill/g) || []).length >= 4 && html.includes('Clear all'), 'render: the filter pills + Clear all');
  ok(/class="brush"/.test(html) && /class="selln"/.test(html) && /peak on/.test(html), 'render: the brush, the picked line, the ringed spike');
  ok(html.includes('data-sg-plot') && html.includes('data-t0=') && html.includes('data-sg-tip'), 'render: the plot carries its time domain + the tooltip host');
  ok(/data-op="sgSel" data-eid="e3"/.test(html) && /sglog__row f-major sel/.test(html), 'render: the picked log row is lit');
  ScopePicker.set(sgIds.who, []); ScopePicker.set(sgIds.kind, []); ScopePicker.set(sgIds.trace, ['bad']); tab._sg.range = null; tab._sg.sel = null; tab._lookFrom = null;
  sc = tab.prepareContext().security; dump.activity = sc;
  html = render({ activeTab: 'security', security: sc });
  ok(html.includes('4 new since your last look') && html.includes('before your last look'), 'render: the new-since divider + the old divider');
  ok((html.match(/<polyline class="trace"/g) || []).length === sc.sg.trace.runs.length && (html.match(/class="okt/g) || []).length === 4, 'render: the needle runs + success ticks');
  ok(html.includes('last look') && html.includes('class="lastln"') && html.includes('class="nowln"'), 'render: last look + now lines');
  ok(/ncm-sec-admin-sg__key" data-sg-key\s*>/.test(html) || /data-sg-key\s*>/.test(html), 'render: the key shows when toggled on');
  ok(html.includes('data-action="securityJump"') && html.includes('Ping me: serious') && html.includes('Clear log'), 'render: deep links + ping select + clear log kept');
  tab._view = 'heat'; tab._heatSel = { actorId: null, objectId: null };
  sc = tab.prepareContext().security; dump.heat = sc;
  html = render({ activeTab: 'security', security: sc });
  ok((html.match(/ncm-sec-admin-hx__g t-/g) || []).length === 4, 'render: a gauge per operator');
  ok((html.match(/class="arc"/g) || []).length === 2, 'render: a clock ring per countdown');
  ok(/data-op="heatPick" data-actor-id="R" aria-pressed="true"/.test(html), 'render: the hottest is picked');
  ok(/data-action="securityEscalate" data-object-id="ws7" data-actor-id="R"/.test(html) && /data-op="heatClearActor"/.test(html) && /data-action="securityCountdownCancel" data-countdown-id="cd1"/.test(html), 'render: Escalate on the hottest object, Clear all, Call off');
  ok(html.includes('drains −5 / game hr') && html.includes('running hot'), 'render: legend + band summary');
  tab._heatSel = { actorId: 'R', objectId: 'corp' };
  html = render({ activeTab: 'security', security: tab.prepareContext().security });
  ok(/data-action="securityHeatClear" data-object-id="corp"/.test(html) && /hx__obj t-hot sel/.test(html), 'render: an object pick → Clear that object, the row lit');
  if (process.env.NCM_DUMP) fs.writeFileSync(process.env.NCM_DUMP, JSON.stringify(dump));
}

console.log(`\ntest-security-modules: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
