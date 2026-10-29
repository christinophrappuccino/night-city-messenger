// Sim: Admin → Overview — the FUTURE half of THE NOW LINE (2026-10-28, dev-approved Version B
// of dev/mockups/admin-overview-rethink-mock.html; it replaced the Coming-up runway).
//   1. the pure rules (overviewModel.js): urgency, labels, zooms, the future axis, placement
//      by time-to-go, "+N later", hidden kinds, the picked row
//   2. the REAL OverviewTab._gatherTimers over mocked Foundry globals: scheduled mail (game +
//      real clock), trace countdowns, self-destruct mail, forged backdoors, lockouts (local +
//      reported, de-duplicated) — and that every action is an EXISTING handler
//   3. the ops (zoom / hide a kind / open a row's facts / lift / close) and the DOM clock
//   4. a REAL Handlebars render of the future half; CSS wiring (tokens, reduced motion, resets)
// Run: node dev/tools/sims/test-overview-runway.mjs
import fs from 'fs';
import { createRequire } from 'module';
import { pathToFileURL, fileURLToPath } from 'url';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };
const read = (p) => fs.readFileSync(`${ROOT}/${p}`, 'utf8');
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
const MIN = 60000;

// ═══ 1. Pure rules ═══
const M = await imp('scripts/utils/overviewModel.js');
ok(M.TIMER_ORDER.join() === 'mail,trace,destruct,backdoor,lockout' && M.TIMER_ORDER.every((k) => M.TIMER_KINDS[k]), 'five timer kinds in the legend order, each known');
ok(Object.values(M.TIMER_KINDS).every((k) => /^var\(--ncm-/.test(k.tc) && /^fa-/.test(k.icon)), 'kind colours are tokens, icons FA classes');
ok(M.timerUrgency(3) === 'bad' && M.timerUrgency(9.9) === 'bad' && M.timerUrgency(10) === 'attn' && M.timerUrgency(59) === 'attn' && M.timerUrgency(60) === '', 'urgency: red under 10 min, amber under an hour');
ok(M.leftLabel(3) === '3m' && M.leftLabel(125) === '2h 05m' && M.leftLabel(300) === '5h' && M.leftLabel(52 * 60) === '2d 4h' && M.leftLabel(48 * 60) === '2d' && M.leftLabel(-4) === '0m', 'leftLabel');
ok(M.widerZoom(60) === 360 && M.widerZoom(360) === 1440 && M.widerZoom(1440) === 0, 'widerZoom');
const ax = M.runwayAxis(60, 0);
ok(ax.ticks[0].isNow && ax.ticks[0].label === 'now 00:00' && ax.ticks.slice(1).map((t) => t.label).join() === '+15m,+30m,+45m' && ax.gridPct === 25, 'future ticks at 1h: now, +15/+30/+45');
ok(M.runwayAxis(360, 0).ticks.slice(1).map((t) => t.label).join() === '01:00,02:00,03:00,04:00,05:00', 'future ticks at 6h: hourly clock labels');
ok(M.runwayAxis(1440, 0).ticks.length === 6 && M.runwayAxis(1440, 0, (ms) => `T${ms / MIN}`).ticks[1].label === 'T240', 'future ticks at 24h: every 4h, formatter injected');
ok(M.nowLineAxis(60, 0).filter((t) => !t.past && !t.isNow).every((t) => t.pct > 38 && t.pct < 100), 'on the line the future ticks sit below NOW');

const T = [
  { id: 't1', kind: 'trace', at: 3 * MIN, name: 'Arasaka closing in on Rache', subline: 'Trace · WS-7F-12', actions: [{ label: 'Call off', icon: 'fa-ban', tone: 'pri', action: 'securityCountdownCancel', data: { 'countdown-id': 'C1' } }], lines: [{ k: 'Who', v: 'Arasaka' }, { k: 'Why', v: '' }] },
  { id: 't2', kind: 'lockout', at: 8 * MIN, name: 'V locked out of CitiNet' },
  { id: 't3', kind: 'mail', at: 26 * MIN, name: '"The job is off"' },
  { id: 't4', kind: 'destruct', at: 52 * MIN, name: '"Burn after reading"' },
  { id: 't5', kind: 'trace', at: 100 * MIN, name: 'Maelstrom on Judy' },
  { id: 't6', kind: 'mail', at: 185 * MIN, name: '"Payment received"' },
  { id: 't8', kind: 'backdoor', at: 540 * MIN, name: 'Backdoor "svc_maint"' },
  { id: 't10', kind: 'backdoor', at: 1200 * MIN, name: 'Backdoor "ghost01"' },
  { id: 'past', kind: 'mail', at: -1, name: 'gone' },
  { id: 'odd', kind: 'nonsense', at: 5 * MIN, name: 'unknown kind' },
];
let R = M.nowLineLayout({ timers: T, nowMs: 0, zoom: 60 });
ok(R.counts.total === 8 && R.counts.bad === 2 && R.counts.attn === 2, 'counts: 8 live (past + unknown dropped), 2 under 10 min, 2 this hour');
ok(R.legend.map((l) => l.kind).join() === M.TIMER_ORDER.join() && R.legend.map((l) => l.count).join() === '2,2,1,2,1', 'the legend: every kind in order with its count, empty ones too');
ok(R.future.map((t) => t.id).join() === 't1,t2,t3,t4' && R.later === 4 && R.laterZoom === 360, 'at 1h: the four inside the hour in time order; "+4 later" zooms to 6h');
ok(R.future[0].top === +(38 + R.gap * 1.5).toFixed(3) && R.future[0].top >= M.futurePct(3, 60) && R.future[0].urg === 'bad' && R.future[0].mc === 'var(--ncm-bad)', 'a 3-minute trace sits 1.5 gaps under the line (the chips need the room) and is red');
ok(R.future[2].mc === 'var(--ncm-attn)' && R.future[3].urg === 'attn', 'inside the hour = amber');
ok(R.future.every((t, i, a) => !i || t.top - a[i - 1].top >= R.gap - 1e-6), 'rows never overlap (the 3- and 8-minute ones are pushed apart)');
ok(R.zoneBad > 10.3 && R.zoneBad < 10.4 && R.zoneAttn === 0, 'at 1h the red zone is 10 min of the future half, no amber band (it is all amber)');
R = M.nowLineLayout({ timers: T, nowMs: 0, zoom: 1440 });
ok(R.later === 0 && R.future.length === 8 && R.future.filter((t) => t.kind === 'backdoor').every((t) => t.mc === 'var(--ncm-secret)'), 'at 24h everything is in view; far timers wear their kind colour');
ok(R.zoneAttn > 2.5 && R.zoneAttn < 2.7, 'at 24h an amber band marks the first hour');
R = M.nowLineLayout({ timers: [{ id: 'x', kind: 'mail', at: 3000 * MIN, name: 'two days out' }], nowMs: 0, zoom: 1440 });
ok(R.later === 1 && R.laterZoom === 0 && R.future.length === 0, 'past 24h: "+1 later" with nowhere wider to zoom');
R = M.nowLineLayout({ timers: T, nowMs: 0, zoom: 60, off: new Set(['mail']), sel: 't4' });
ok(!R.future.some((t) => t.kind === 'mail') && R.legend.find((l) => l.kind === 'mail').off && R.legend.find((l) => l.kind === 'mail').count === 2, 'a hidden kind leaves the line (its count stays on the legend key)');
ok(R.later === 3, 'hidden timers never count as "later"');
ok(R.future.find((t) => t.id === 't4').sel && !R.future.find((t) => t.id === 't1').sel && R.future.find((t) => t.id === 't4').kindShort === 'Destruct', 'the picked row is marked');
R = M.nowLineLayout({ timers: T, nowMs: 0, sel: 'gone-id' });
ok(!R.future.some((t) => t.sel), 'an unknown pick marks nothing');
ok(R.future[0].lines.length === 1 && R.future[0].lines[0].k === 'Who', 'empty fact lines are left out');
ok(R.future[0].actions[0].dataAttrs[0].k === 'countdown-id' && R.future[0].actions[0].dataAttrs[0].v === 'C1', 'actions carry their data attributes');
ok(M.nowLineLayout({ timers: T, nowMs: 0, zoom: 999 }).zoom === 60, 'an unknown zoom falls back to 1h');
ok(M.nowLineLayout({ timers: [], nowMs: 0 }).empty && M.nowLineLayout({ timers: [], nowMs: 0 }).future.length === 0, 'nothing counting down → nothing on the future half');

// ═══ 2. The REAL OverviewTab._gatherTimers ═══
const NOW = Date.UTC(2045, 7, 14, 21, 10);
const realNow = Date.now();
const actors = { v: { id: 'v', name: 'V', items: { get: () => null } }, judy: { id: 'judy', name: 'Judy Alvarez', items: { get: () => null } } };
const term = { id: 'T1', name: 'WS-7F-12' };
const accounts = [
  { id: 'A1', username: 'svc_maint', forged: { byName: 'Rache Bartmoss', expiresAt: new Date(NOW + 540 * MIN).toISOString() } },
  { id: 'A2', username: 'old', forged: { byName: 'x', expiresAt: new Date(NOW - MIN).toISOString() } },
  { id: 'A3', username: 'boss' },
];
const cleared = []; const removed = []; let confirmed = 0;
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
globalThis.Dialog = { confirm: async () => { confirmed++; return true; } };
globalThis.game = {
  settings: { get: () => undefined },
  actors: Object.assign([...Object.values(actors)], { get: (id) => actors[id] }),
  items: { get: (id) => (id === 'T1' ? term : null) },
  nightcity: {
    timeService: { getCurrentTimeMs: () => NOW },
    traceService: { getCountdowns: () => [{ id: 'C1', expiresAt: NOW + 3 * MIN, source: 'Arasaka', actorName: 'Rache', objectName: 'WS-7F-12', reason: 'heat 82' }] },
    terminalService: {
      collectTerminals: () => [term], getConfig: () => ({ terminalName: 'WS-7F-12', accounts }),
      getAccount: (it, id) => accounts.find((a) => a.id === id) || null,
      removeAccount: async (it, id) => { removed.push([it.id, id]); },
    },
    securityService: {
      _nowMs: () => NOW,
      getActiveLockouts: () => [{ actorId: 'v', targetId: 'CITINET', lockoutUntil: NOW + 8 * MIN }, { actorId: 'v', targetId: 'OLD', lockoutUntil: NOW - MIN }],
      _remote: new Map([['v::CITINET', { actorId: 'v', targetId: 'CITINET', lockoutUntil: NOW + 9 * MIN }], ['judy::T1::A3', { actorId: 'judy', targetId: 'T1::A3', lockoutUntil: NOW + 270 * MIN, forced: true }]]),
      clearFor: (a, t) => cleared.push([a, ...t]),
    },
  },
};
const { OverviewTab } = await imp('scripts/ui/AdminPanel/tabs/OverviewTab.js');
let renders = 0;
const app = { _activeTab: 'overview', render: () => { renders++; }, networkService: { getNetwork: (id) => (id === 'CITINET' ? { id, name: 'CitiNet' } : null) }, tabs: {} };
const tab = new OverviewTab(app);
const sched = [
  { id: 'S1', deliveryTime: new Date(NOW + 26 * MIN).toISOString(), useGameTime: true, fromName: 'Rogue', toName: 'Jackie', subject: 'The job is off' },
  { id: 'S2', deliveryTime: new Date(realNow + 90 * MIN).toISOString(), useGameTime: false, fromName: 'Bank', toName: 'V', subject: 'Payment received' },
];
const mail = { inboxes: [{ ownerId: 'judy', name: 'Judy Alvarez', msgs: [
  { messageId: 'M1', subject: 'Burn after reading', anonymous: { enabled: true }, selfDestruct: { mode: '1h', expiresAt: new Date(NOW + 52 * MIN).toISOString() }, _journalId: 'J1', _pageId: 'P1' },
  { messageId: 'M2-sent', subject: 'sent copy', selfDestruct: { mode: '1h', expiresAt: new Date(NOW + 52 * MIN).toISOString() } },
  { messageId: 'M3', subject: 'read-once', selfDestruct: { mode: 'after_read' } },
] }], viaByBase: new Map() };
const timers = tab._gatherTimers(sched, mail, NOW);
const by = (k) => timers.filter((t) => t.kind === k);
ok(by('mail').length === 2 && by('mail')[0].at === NOW + 26 * MIN, 'scheduled mail: a game-time entry sits at its delivery time');
ok(Math.abs(by('mail')[1].at - (NOW + 90 * MIN)) < 5000, 'scheduled mail: a real-time entry is placed by what is left on the real clock');
ok(by('trace').length === 1 && by('trace')[0].name === 'Arasaka closing in on Rache' && by('trace')[0].at === NOW + 3 * MIN, 'trace countdown');
ok(by('destruct').length === 1 && by('destruct')[0].lines[0].v === 'Anonymous', 'self-destruct: timed only, no sent copy, the masked sender stays masked');
ok(by('backdoor').length === 1 && by('backdoor')[0].name === '"svc_maint" on WS-7F-12 closes' && by('backdoor')[0].lines.some((l) => l.k === 'Login' && l.mono && l.v === 'svc_maint'), 'backdoors: live forged accounts only (expired + normal left out), named without the kind (the row prefixes it), login in mono');
ok(by('lockout').length === 2, 'lockouts: local + reported, a key seen twice counted once, expired dropped');
ok(by('lockout').some((t) => /locked out of CitiNet/.test(t.name)) && by('lockout').some((t) => /WS-7F-12 · boss/.test(t.name) && /Escalation by you/.test(t.lines[2].v)), 'lockout labels: a network by name, a terminal account as "Terminal · account", forced = escalation');
const acts = timers.flatMap((t) => t.actions || []);
const panel = read('scripts/ui/AdminPanel/AdminPanelApp.js');
for (const a of new Set(acts.map((x) => x.action))) ok(new RegExp(`^\\s+${a}: AdminPanelApp\\._on`, 'm').test(panel), `action "${a}" is a registered panel action`);
const msgTab = read('scripts/ui/AdminPanel/tabs/MessagesTab.js');
for (const a of acts.filter((x) => x.data?.owner === 'messages')) ok(msgTab.includes(`case '${a.data.op}':`), `Messages op "${a.data.op}" exists (reused, not re-implemented)`);
for (const a of acts.filter((x) => x.data?.owner === 'overview')) ok(OverviewTab.RUNWAY_OPS.includes(a.data.op), `Overview op "${a.data.op}" is a line op`);
ok(acts.some((a) => a.action === 'hardDeleteMessage' && a.data['inbox-owner'] === 'judy' && a.data['message-id'] === 'M1'), 'Erase now = the panel hard delete (message + inbox owner)');
ok(acts.some((a) => a.data?.op === 'stopTimer' && a.data['journal-id'] === 'J1' && a.data['page-id'] === 'P1'), 'Stop = Messages stopTimer (journal + page)');
ok(acts.some((a) => a.action === 'editScheduled') && acts.some((a) => a.data?.op === 'schedSendNow'), 'mail: Change time + Send now are the Outbox handlers');

// ═══ 3. Ops + the context ═══
const nl = tab._nowLine({ needs: [], feed: [], scheduledEntries: sched, mail, now: NOW });
ok(nl.counts.total === timers.length && nl.zoom === 60 && typeof nl.nowClock === 'string' && nl.nowClock.length >= 4 && nl.now === NOW, 'the line context: every timer, default 1h, the game clock');
const el = (ds) => ({ dataset: ds, closest: (sel) => (sel === '[data-timer-id]' && ds.timerId ? { dataset: ds } : null) });
await tab.onAct('rwZoom', {}, el({ zoom: '360' }));
ok(tab._rwZoom === 360 && renders === 1, 'rwZoom sets the zoom');
await tab.onAct('rwZoom', {}, el({ zoom: '7' }));
ok(tab._rwZoom === 360, 'rwZoom ignores an unknown zoom');
await tab.onAct('rwLane', {}, el({ kind: 'mail' }));
ok(tab._rwOff.has('mail'), 'rwLane hides a kind'); await tab.onAct('rwLane', {}, el({ kind: 'mail' }));
ok(!tab._rwOff.has('mail'), '…and brings it back');
await tab.onAct('rwPick', {}, el({ timerId: 'trace:C1' }));
ok(tab._rwSel === 'trace:C1', 'rwPick opens a row\'s facts');
ok(tab._nowLine({ needs: [], feed: [], scheduledEntries: sched, mail, now: NOW }).future.find((t) => t.id === 'trace:C1')?.sel, '…the row is marked in the context');
await tab.onAct('rwPick', {}, el({ timerId: 'trace:C1' }));
ok(tab._rwSel === null, '…the same row again folds them');
await tab.onAct('rwLift', {}, el({ lockActor: 'v', lockTarget: 'CITINET' }));
ok(cleared.length === 1 && cleared[0].join() === 'v,CITINET', 'rwLift → SecurityService.clearFor (everywhere)');
await tab.onAct('rwClose', {}, el({ itemId: 'T1', accountId: 'A1' }));
ok(confirmed === 1 && removed.length === 1 && removed[0].join() === 'T1,A1', 'rwClose confirms, then TerminalService.removeAccount');
const src = read('scripts/ui/AdminPanel/tabs/OverviewTab.js');
for (const op of OverviewTab.RUNWAY_OPS) ok(src.includes(`case '${op}':`), `onAct handles ${op}`);
ok(/nl: this\._nowLine\(/.test(src) && !/_gatherSoon|buildRunway|_rwFresh/.test(src), 'the context is the line; the runway builder is gone');
// DOM clock: rows move up with the game clock, landed ones hide, labels tick, no render
{
  const mk = (atMin, top) => ({ dataset: { at: String(NOW + atMin * MIN), top: String(top) }, style: {}, hidden: false, classList: { toggle() {} }, querySelector: (q) => (q === '[data-nl-left]' ? { textContent: '' } : null) });
  const f1 = mk(30, 69), f2 = mk(2, 45), landed = mk(-1, 38.5);
  const agoEl = { textContent: 'stale' };
  const past = { dataset: { ts: String(NOW - 10 * MIN) }, querySelector: () => agoEl };
  const lbl = { dataset: { at: String(NOW + 5 * MIN), rwLeft: '' }, textContent: '', classList: { toggle() {} } };
  const clock = { textContent: '' };
  const root = {
    querySelector: (q) => (q.startsWith('.ncm-ov2-nl[') ? { dataset: { nlZoom: '60', nlNow: String(NOW - 15 * MIN) } } : q === '[data-nl-clock]' ? clock : null),
    querySelectorAll: (q) => (q.startsWith('[data-nl-ev="f"]') ? [f1, f2, landed] : q.startsWith('[data-nl-ev="p"]') ? [past] : q.startsWith('[data-rw-left]') ? [lbl] : []),
  };
  app.element = root;
  const before = renders;
  tab._tickRunway();
  // 15 game minutes passed since the render at 1h zoom: every row rises 15/60 × 62% = 15.5%
  ok(f1.style.top === '53.500%' && f1.querySelector('[data-nl-left]').textContent === '' && !f1.hidden, 'a future row moves up by the time that passed, keeping its laid-out offset');
  ok(f2.hidden && landed.hidden, 'a row that reached the line, or landed, is hidden');
  ok(agoEl.textContent === '10m', 'a past row ago label is refreshed');
  ok(lbl.textContent === '5m' && clock.textContent.length >= 4 && renders === before, 'countdown labels + the NOW clock tick — no re-render');
  tab.onRender(); ok(tab._rwTimer, 'onRender starts the clock while the line is on screen');
  tab.onClose(); ok(!tab._rwTimer, 'onClose stops it');
  app.element = { querySelector: () => null, querySelectorAll: () => [] };
  tab.onRender(); ok(!tab._rwTimer, 'no line on screen → no clock');
}

// ═══ 4. REAL render + CSS ═══
const tpl = read('templates/admin-panel/tab-overview.hbs');
let Handlebars = null;
for (const p of ['C:/Program Files/Foundry Virtual Tabletop/resources/app/package.json', 'C:/Program Files (x86)/Foundry Virtual Tabletop/resources/app/package.json']) {
  if (!fs.existsSync(p)) continue;
  try { Handlebars = createRequire(p)('handlebars'); break; } catch { /* keep looking */ }
}
if (!Handlebars) { fail++; console.error('FAIL: could not load Handlebars from a Foundry install — render checks did not run'); }
else {
  const H = Handlebars.create();
  H.registerHelper('eq', (a, b) => String(a) === String(b));
  H.registerHelper('ncm-hue', () => 'var(--ncm-hue-1)');
  const render = H.compile(tpl);
  const base = { clock: 'x', time: '21:10', date: '2045-08-14', sceneName: '', sceneDead: false, table: { players: [], hasPlayers: false, online: 0, need: 0 }, tiles: [] };
  const ov = { ...base, nl: { ...M.nowLineLayout({ timers: T, nowMs: 0, zoom: 60, sel: 't1' }), feedFilter: 'all' } };
  const html = render({ activeTab: 'overview', ov });
  if (process.env.NCM_DUMP) fs.writeFileSync(`${process.env.NCM_DUMP}/overview-runway.html`, html);
  ok((html.match(/data-op="rwLane"/g) || []).length === 5 && /data-op="rwLane" data-kind="mail"[^>]*><i class="fas fa-paper-plane"><\/i>Mail<b>2<\/b>/.test(html), 'five legend keys with counts');
  ok((html.match(/data-nl-ev="f"/g) || []).length === 4, 'four future rows inside the hour');
  ok(/is-future is-bad is-sel"[^>]*data-timer-id="t1" data-at="180000" data-top="[\d.]+"/.test(html), 'the picked red row carries its id, when, and laid-out top (for the DOM clock)');
  ok(/data-op="rwZoom" data-zoom="360"[^>]*>\+4 later</.test(html), '"+N later" zooms out');
  ok(/ncm-ov2-zoom__b is-on" [^>]*data-zoom="60"/.test(html), 'the current zoom is lit');
  ok(/<b class="is-bad">2<\/b> under 10 min · <b class="is-attn">2<\/b> this hour · <b>8<\/b> timers/.test(html), 'the summary line');
  ok(/data-action="securityCountdownCancel" data-countdown-id="C1" data-tooltip="Call off"><i class="fas fa-ban"><\/i>Call off/.test(html), 'a row carries its action');
  ok(/ncm-ov2-nl__facts"><span class="ncm-ov2-nl__facts-sub">Trace · WS-7F-12<\/span><span class="ncm-ov2-nl__fk">Who<\/span>/.test(html), 'the picked row shows its facts');
  ok(/data-nl-left>3m</.test(html), 'the countdown is clock-driven');
  ok(/ncm-ov2-nl__now" style="top:38%"><b>NOW · <span data-nl-clock>00:00<\/span>/.test(html), 'the NOW line with the game clock');
  ok(!/undefined|\[object Object\]|NaN/.test(html), 'no undefined / NaN leaks');
  const empty = render({ activeTab: 'overview', ov: { ...base, nl: { ...M.nowLineLayout({ timers: [], nowMs: 0 }), feedFilter: 'all' } } });
  ok(empty.includes('Quiet.') && !empty.includes('data-nl-ev=') && !empty.includes('+0 later'), 'empty states');
  const bal = (s) => (s.match(/<div\b/g) || []).length === (s.match(/<\/div>/g) || []).length && (s.match(/<button\b/g) || []).length === (s.match(/<\/button>/g) || []).length;
  ok(bal(html) && bal(empty), 'div + button tags balance');
}
const css = read('styles/components/admin-panel/tab-overview.css');
const used = new Set([...(tpl + src).matchAll(/ncm-ov2-nl[a-z0-9_-]*/g)].map((m) => m[0]).filter((c) => !c.endsWith('-')));
for (const c of used) ok(css.includes(`.${c}`), `.${c} is styled`);
const nlCss = css.slice(css.indexOf('THE INSTRUMENT'), css.indexOf('THE DOCK'));
ok(!(nlCss.replace(/\/\*[\s\S]*?\*\//g, '').match(/#[0-9a-fA-F]{3,6}\b/g)), 'instrument CSS: tokens only');
ok(/prefers-reduced-motion[\s\S]*is-future\.is-bad::before \{ animation: none/.test(css), 'reduced motion stops the pulse');
ok(/button\.ncm-ov2-nl__pick[^{]*\{[^}]*appearance: none !important[^}]*width: auto !important/.test(css), 'the line\'s buttons reset Foundry button defaults');
const futureBlock = tpl.slice(tpl.indexOf('the future: every timer'), tpl.indexOf('ov.nl.empty'));
ok(!/data-action="(?!tabAct|switchTab|ov[A-Z]|\{\{action\}\})[a-zA-Z]+"/.test(futureBlock), 'the future markup uses tabAct (the buttons come from the data)');
ok(!/\{\{(sub|gt|lower|concat)\b/.test(futureBlock), 'no helper names as fields');
const others = fs.readdirSync(`${ROOT}/styles`, { recursive: true }).filter((f) => String(f).endsWith('.css') && !String(f).endsWith('tab-overview.css'));
ok(!others.some((f) => read(`styles/${String(f).replace(/\\/g, '/')}`).includes('.ncm-ov2-nl')), 'the ncm-ov2-nl prefix is used by no other stylesheet');

console.log(`\ntest-overview-runway: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
