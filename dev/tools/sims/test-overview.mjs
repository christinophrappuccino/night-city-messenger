// Sim: Admin → OVERVIEW — THE NOW LINE (2026-10-28, dev-approved Version B of
// dev/mockups/admin-overview-rethink-mock.html). Drives the pure rules
// (utils/overviewModel.js: the queue, the chips, the line's layout, the table),
// renders the REAL tab template through Handlebars over a full view-model, and
// guards the wiring (actions registered, every class styled, every context key
// read, the player-network hello, the table ops on the real OverviewTab).
// Run: node dev/tools/sims/test-overview.mjs      (NCM_DUMP=<dir> also writes the render + the ov context as JSON)
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
const items = [
  { kind: 'setup', key: 'noemail-a', ts: 5 },
  { kind: 'mail', key: 'mail-x', sig: 'm1|2', count: 2, ts: 10 },
  { kind: 'mail', key: 'mail-y', sig: 'm2|5', count: 5, ts: 1 },
  { kind: 'burned', key: 'heat-1', sig: 'burned', ts: 1 },
  { kind: 'bricked', key: 'bricked-s', ts: 3 },
  { kind: 'nonsense', key: 'zzz' },
  { kind: 'countdown', key: 'cd-1', ts: 2 },
];
const ranked = M.rankNeeds(items);
ok(ranked.map((n) => n.key).join() === 'heat-1,cd-1,mail-y,mail-x,bricked-s,noemail-a', 'ranked by weight, count breaks ties within a kind; unknown kinds dropped');
ok(ranked.every((n) => n.group), 'every ranked item carries its filter group');
const dismissed = new Set([M.dismissKey(items[1])]);
ok(!M.rankNeeds(items, dismissed).some((n) => n.key === 'mail-x'), 'a dismissed item is dropped');
ok(M.rankNeeds([{ ...items[1], sig: 'm3|3' }], dismissed).length === 1, 'a dismissed item comes back when its signature changes');
const counts = M.needCounts(ranked);
ok(counts.all === 6 && counts.mail === 2 && counts.sec === 2 && counts.money === 1 && counts.setup === 1, 'counts per group');
ok(M.filterNeeds(ranked, 'mail').every((n) => n.group === 'mail') && M.filterNeeds(ranked, 'all').length === 6, 'filterNeeds by group');
ok(M.filterNeeds(ranked, 'burned').length === 1 && M.filterNeeds(ranked, 'burned')[0].key === 'heat-1', 'filterNeeds by one KIND (a chip)');
ok(M.NEED_GROUPS.every((g) => Object.values(M.NEED_KINDS).some((k) => k.group === g)), 'every group has at least one kind');
ok(M.agoLabel(1000, 1000) === 'now' && M.agoLabel(0, 12 * 60000) === '12m' && M.agoLabel(0, 3 * 3600000) === '3h' && M.agoLabel(0, 50 * 3600000) === '2d', 'agoLabel');
ok(M.agoLabel(5000, 0) === 'now', 'agoLabel never goes negative');
ok(M.untilLabel(0, 1) === 'due' && M.untilLabel(14 * 60000 + 32000, 0) === '14:32' && M.untilLabel(22 * 3600000, 0) === '22h' && M.untilLabel(60 * 3600000, 0) === '2d', 'untilLabel');
const feed = M.mergeActivity([[{ ts: 1, group: 'mail' }, { ts: 9, group: 'hack' }], [{ ts: 5, group: 'shard' }], [null]], 2);
ok(feed.length === 2 && feed[0].ts === 9 && feed[1].ts === 5, 'mergeActivity: newest first, capped, nulls dropped');
ok(M.filterFeed(feed, 'hack').length === 1 && M.filterFeed(feed, 'all').length === 2, 'filterFeed');

// 1b. the chips on the line
ok(Object.keys(M.NEED_KINDS).every((k) => M.NEED_CHIPS[k] && M.NEED_CHIPS[k].label && /^fa-/.test(M.NEED_CHIPS[k].icon) && ['bad', 'attn'].includes(M.NEED_CHIPS[k].tone)), 'every need kind has a chip: label, FA icon, tone bad|attn');
ok(Object.entries(M.NEED_KINDS).filter(([, k]) => k.group === 'sec').every(([kind]) => M.NEED_CHIPS[kind].tone === 'bad'), 'every security kind is a red chip');
ok(M.NEED_CHIPS.mail.tone === 'attn' && M.NEED_CHIPS.setup.tone === 'attn' && M.NEED_CHIPS.bricked.tone === 'attn', 'waiting / setup / bricked are amber');
const chips = M.needChips(ranked, 'mail');
ok(chips.map((c) => `${c.kind}:${c.count}`).join() === 'burned:1,countdown:1,mail:2,bricked:1,setup:1', 'chips in rank order with counts, unknown kinds never make one');
ok(chips.find((c) => c.kind === 'mail').on && !chips.find((c) => c.kind === 'burned').on, 'the open chip is marked');
ok(M.needChips([]).length === 0, 'no needs → no chips');
ok(M.activityTone('trace') === 'var(--ncm-bad)' && M.activityTone('hack') === 'var(--ncm-good)' && M.activityTone('mail') === 'var(--ncm-attn)' && M.activityTone('shard') === 'var(--ncm-hue-2)' && M.activityTone('other') === 'var(--ncm-act)' && M.activityTone('wat') === 'var(--ncm-act)', 'activity tones: fail red, success green, mail amber, shard hue-2, a session event act');

// 1c. the line's geometry
ok(M.NOW_PCT === 38, 'the NOW line sits 38% down');
ok(M.pastPct(0) === 38 && M.pastPct(1440) === 0 && M.pastPct(5000) === 0, 'pastPct: now = the line, a day = the top, beyond is clamped');
ok(M.pastPct(15) > M.pastPct(60) && M.pastPct(60) > M.pastPct(180) && M.pastPct(180) > M.pastPct(1440), 'pastPct is monotonic (older = higher)');
ok(M.pastPct(0) - M.pastPct(60) > M.pastPct(360) - M.pastPct(1440), 'pastPct is a log scale: the first hour gets more room than the last eighteen');
ok(M.futurePct(0, 60) === 38 && M.futurePct(30, 60) === 69 && M.futurePct(60, 60) === 100 && M.futurePct(200, 60) === 100, 'futurePct: linear from the line to the zoom edge, clamped');
const ax = M.nowLineAxis(60, 0);
ok(ax.filter((t) => t.past).length === 4 && ax.find((t) => t.isNow).pct === 38 && ax.filter((t) => !t.past && !t.isNow).map((t) => t.label).join() === '+15m,+30m,+45m', 'axis: four past ticks, NOW, the future ticks of the zoom');
ok(ax.every((t, i, a) => !i || a[i - 1].pct <= t.pct) && ax[0].pct >= 2.5, 'axis ticks run top to bottom and the oldest never sits on the edge');
ok(M.nowLineAxis(360, 0).filter((t) => !t.past && !t.isNow).map((t) => t.label).join() === '01:00,02:00,03:00,04:00,05:00', 'axis at 6h: hourly clock labels below the line');
const sp = M.spreadRows([{ top: 37 }, { top: 36 }, { top: 10 }, { top: 1 }], { gap: 5, line: 38, edge: 2.5, dir: -1 });
ok(sp.rows.map((r) => r.top).join() === '33,28,10' && sp.dropped === 1, 'spreadRows upward: no closer than a gap to the line or each other; off the edge = dropped');
const sp2 = M.spreadRows([{ top: 38 }, { top: 39 }, { top: 80 }, { top: 99 }], { gap: 5, line: 38, edge: 97.5, dir: 1 });
ok(sp2.rows.map((r) => r.top).join() === '43,48,80' && sp2.dropped === 1, 'spreadRows downward');

// 1d. nowLineLayout
const NOW = Date.UTC(2045, 2, 11, 23, 41);
const act = (kind, agoMin, html) => ({ kind, ts: NOW - agoMin * MIN, html, icon: 'fa-x', subline: 's' });
const activity = [act('trace', 4, 'Hiro failed'), act('hack', 11, 'V breached'), act('mail', 180, 'V → Rogue'), act('shard', 300, 'Rache encoded'), act('other', 360, 'Kiri joined'), act('mail', 2000, 'ancient')];
const timers = [
  { id: 'trace:1', kind: 'trace', at: NOW + 9 * MIN, name: 'Arasaka on Rache', subline: 'Trace · WS', lines: [{ k: 'Who', v: 'Arasaka' }, { k: 'Why', v: '' }], actions: [{ label: 'Call off', icon: 'fa-ban', tone: 'pri', action: 'securityCountdownCancel', data: { 'countdown-id': 'C1' } }] },
  { id: 'mail:1', kind: 'mail', at: NOW + 25 * MIN, name: '"Meet at the dock"' },
  { id: 'destruct:1', kind: 'destruct', at: NOW + 70 * MIN, name: '"burn after reading"' },
  { id: 'backdoor:1', kind: 'backdoor', at: NOW + 6 * 60 * MIN, name: 'ghost@' },
  { id: 'lockout:1', kind: 'lockout', at: NOW + 20 * 60 * MIN, name: 'Hiro' },
  { id: 'past', kind: 'mail', at: NOW - MIN, name: 'gone' },
  { id: 'odd', kind: 'nonsense', at: NOW + MIN, name: 'unknown' },
];
let L = M.nowLineLayout({ activity, needs: ranked, timers, nowMs: NOW, zoom: 60 });
ok(L.now === NOW && L.zoom === 60 && L.nowPct === 38 && L.nowClock === '23:41', 'layout: the clock, the zoom, the line');
ok(L.past.length === 4 && L.past[0].html === 'Hiro failed' && L.past[0].top > L.past[1].top && L.past.every((r, i, a) => !i || r.top < a[i - 1].top), 'the past: newest nearest the line, older ones higher');
ok(L.past[0].tc === 'var(--ncm-bad)' && L.past[1].tc === 'var(--ncm-good)' && !L.past[0].far && L.past[2].far, 'past rows wear their tone; past an hour = far (fades)');
ok(L.past.every((r) => r.ago) && L.past[0].ago === '4m' && L.past[2].ago === '3h', 'past rows carry an ago label on the game clock');
ok(L.past.every((r, i, a) => !i || a[i - 1].top - r.top >= L.gap - 1e-6) && L.past[0].top <= 38 - L.gap * 1.5 + 1e-6 && L.past[L.past.length - 1].top >= L.gap, 'past rows never overlap, keep 1.5 gaps off the line (room for the chips) and a gap at the top (room for +N earlier)');
ok(L.pastMore === 2 && L.counts.past === 6 && !L.past.some((r) => r.html === 'ancient'), 'four rows on the line; the one older than a day and the one with no room fold into +2 earlier');
ok(L.chips.length === 5 && L.open === null && L.openItems.length === 0 && L.needTotal === 6, 'chips on the line, nothing open');
L = M.nowLineLayout({ activity, needs: ranked, timers, nowMs: NOW, zoom: 60, open: 'mail' });
ok(L.open === 'mail' && L.openLabel === 'Mail waiting' && L.openTone === 'attn' && L.openTop === +(38 + L.gap).toFixed(3) && L.openItems.length === 2 && L.openItems[0].key === 'mail-y' && L.chips.find((c) => c.kind === 'mail').on, 'an open chip lists its ranked items under the line');
ok(M.nowLineLayout({ activity, needs: ranked, timers, nowMs: NOW, open: 'nonsense' }).open === null && M.nowLineLayout({ activity, needs: ranked, timers, nowMs: NOW, open: 'all' }).open === null, 'an unknown or "all" open = nothing open');
ok(L.future.map((t) => t.id).join() === 'trace:1,mail:1' && L.later === 3 && L.laterZoom === 360, 'the future at 1h: the two inside the hour, "+3 later" zooms to 6h');
ok(L.future[0].top === M.futurePct(9, 60) && L.future[0].urg === 'bad' && L.future[0].mc === 'var(--ncm-bad)' && L.future[0].leftLabel === '9m', 'a 9-minute trace: placed by time, red');
ok(L.future[1].urg === 'attn' && L.future[1].mc === 'var(--ncm-attn)' && L.future[1].icon === 'fa-paper-plane' && L.future[1].kindShort === 'Mail', 'inside the hour = amber; the kind gives the icon');
ok(L.future[0].lines.length === 1 && L.future[0].actions[0].dataAttrs[0].k === 'countdown-id', 'empty facts dropped; actions carry data attributes');
ok(L.zoneBad > 10.3 && L.zoneBad < 10.4 && L.zoneAttn === 0, 'at 1h the red zone is 10 min of the future half; no amber band (it is all amber)');
ok(L.counts.bad === 1 && L.counts.attn === 1 && L.counts.total === 5, 'counts: 5 live (past + unknown dropped), 1 under 10 min, 1 this hour');
ok(L.legend.map((l) => `${l.kind}:${l.count}`).join() === 'mail:1,trace:1,destruct:1,backdoor:1,lockout:1' && L.legend.every((l) => /^var\(--ncm-/.test(l.tc)), 'the legend: every kind in order with its count, tokens for colours');
L = M.nowLineLayout({ activity, needs: ranked, timers, nowMs: NOW, zoom: 1440, sel: 'lockout:1', off: ['backdoor'] });
ok(L.future.map((t) => t.id).join() === 'trace:1,mail:1,destruct:1,lockout:1' && L.later === 0 && L.laterZoom === 0, 'at 24h everything in view; a hidden kind is left off the line');
ok(L.future[3].sel && !L.future[0].sel && L.legend.find((l) => l.kind === 'backdoor').off && L.legend.find((l) => l.kind === 'backdoor').count === 1, 'the picked row is marked; the hidden kind keeps its count');
ok(L.zoneAttn > 2.5 && L.zoneAttn < 2.7 && L.zoneBad < 0.5, 'at 24h an amber band marks the first hour');
ok(L.future.every((t, i, a) => !i || t.top - a[i - 1].top >= L.gap - 1e-6) && L.future[0].top >= 38 + L.gap * 1.5 - 1e-6, 'future rows never overlap and keep 1.5 gaps off the line');
// crowding: many timers in the first minutes fold the overflow into "later"
const crowd = Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, kind: 'mail', at: NOW + (i + 1) * MIN, name: `t${i}` }));
L = M.nowLineLayout({ activity: [], needs: [], timers: crowd, nowMs: NOW, zoom: 60, trackPx: 600 });
ok(L.future.length < 30 && L.future.length + L.later === 30 && L.future[L.future.length - 1].top <= 100 - L.gap + 1e-6, 'rows with no room fold into "+N later" instead of overlapping (a gap stays free for the chip)');
const old = Array.from({ length: 20 }, (_, i) => act('mail', 30 + i * 30, `m${i}`));
L = M.nowLineLayout({ activity: old, needs: [], timers: [], nowMs: NOW });
ok(L.past.length < 20 && L.past.length + L.pastMore === 20, 'past rows with no room fold into "+N earlier"');
ok(M.nowLineLayout({ nowMs: NOW }).empty && !M.nowLineLayout({ nowMs: NOW, needs: ranked }).empty, 'empty only when nothing is on the line at all');
ok(M.nowLineLayout({ nowMs: NOW, zoom: 999 }).zoom === 60, 'an unknown zoom falls back to 1h');
ok(M.nowLineLayout({ nowMs: NOW, clock: (ms) => `T${ms}` }).nowClock === `T${NOW}`, 'the clock formatter is injected');

// ═══ 2. OverviewTab: every need kind it emits is a known kind; every context key is read ═══
const tab = read('scripts/ui/AdminPanel/tabs/OverviewTab.js');
const emitted = [...tab.matchAll(/kind: (?:burned \? 'burned' : 'hot'|'([a-z]+)')/g)].map((m) => m[1]).filter(Boolean);
for (const k of new Set(emitted)) if (!['mail', 'hack', 'shard', 'trace', 'imp', 'other'].includes(k) && !(k in M.TIMER_KINDS)) ok(k in M.NEED_KINDS, `need kind "${k}" is in NEED_KINDS`);
const tpl = read('templates/admin-panel/tab-overview.hbs');
const ctxBlock = tab.slice(tab.indexOf('ov: {'), tab.indexOf('},', tab.indexOf('tiles: this._gatherTiles')));
const ctxKeys = [...ctxBlock.matchAll(/^\s+([a-zA-Z]+)[:,]/gm)].map((m) => m[1]);
ok(ctxKeys.length >= 7, `found the ov keys (${ctxKeys.length})`);
for (const k of ctxKeys) ok(tpl.includes(`ov.${k}`), `template reads ov.${k}`);
ok(/\.\.\.this\.tabs\.overview\.prepareContext\(/.test(read('scripts/ui/AdminPanel/AdminPanelApp.js')), 'the panel SPREADS the overview context');
ok(/_activeTab !== 'overview'\) return \{ ov: null \}/.test(tab), 'the scan only runs while the Overview is open');
ok(/nl: this\._nowLine\(/.test(tab) && /nowLineLayout\(\{/.test(tab) && !/_gatherPcs|_gatherNpcs|buildRunway|_runway\(/.test(tab), 'the context is the NOW LINE; the old sections are gone');
ok(/formatCyberDate\(iso, \{ timeOnly: true \}\)/.test(tab) && /formatCyberDate\(iso, \{ dateOnly: true \}\)/.test(tab), 'the dock clock uses formatCyberDate (time + date)');
ok(tpl.includes('class="ncm-tabhd"') && (tpl.match(/<header class="ncm-tabhd">/g) || []).length === 1, 'the shared page head opens the tab');

// ═══ 3. Actions: everything the tab or its needs fire is registered on the panel ═══
const app = read('scripts/ui/AdminPanel/AdminPanelApp.js');
const actions = new Set([...tpl.matchAll(/data-action="([a-zA-Z]+)"/g)].map((m) => m[1]).concat([...tab.matchAll(/action: '([a-zA-Z]+)'/g)].map((m) => m[1])));
for (const a of actions) ok(new RegExp(`^\\s+${a}: AdminPanelApp\\._on`, 'm').test(app), `action "${a}" is registered`);
for (const a of ['ovReplyAs', 'ovOpenInboxOf', 'ovWriteTo', 'ovSetEmail', 'ovNeedFilter', 'ovFeedFilter']) {
  ok(app.includes(`this.tabs.overview.on${a.slice(2)}(event, target)`), `${a} delegates to the tab`);
  ok(new RegExp(`\\n  (async )?on${a.slice(2)}\\(`).test(tab), `OverviewTab implements on${a.slice(2)}`);
}
ok(/onBroadcast\(\) \{\s*this\.app\._activeTab = 'networks'/.test(tab), 'Broadcast goes to the Networks tab (where Network Broadcast lives)');
ok(['openComposer', 'openGMContacts', 'ovBroadcast', 'openTimeSettings'].every((a) => tpl.includes(`data-action="${a}"`)), 'quick actions: Write / Contact / Broadcast / Set time are existing actions');
ok(/data-action="ovNeedFilter" data-filter="\{\{kind\}\}"/.test(tpl) && /data-action="ovNeedFilter" data-filter="all"/.test(tpl), 'a chip opens its kind (ovNeedFilter); the panel closes with "all"');
ok(/_needFilter = k === 'all' \|\| k === this\._needFilter \? 'all' : k/.test(tab), 'clicking the open chip again folds it');
ok(tpl.includes('data-action="ovDismissAlert"') && tpl.includes('data-action="ovClearAlerts"') && tpl.includes('data-alert-key="{{dismissKey}}"'), 'the open list keeps per-item dismiss + Dismiss all');

// ═══ 4. CSS: every class used is styled; tokens only; the old runway is gone ═══
const css = read('styles/components/admin-panel/tab-overview.css');
const used = new Set([...(tpl + tab).matchAll(/ncm-ov2-[a-z0-9_-]+/g)].map((m) => m[0]).filter((c) => !c.endsWith('-')));
for (const c of used) {
  if (/^ncm-ov2-k--/.test(c)) continue;
  ok(css.includes(`.${c}`), `.${c} is styled`);
}
for (const k of new Set(Object.keys(M.NEED_KINDS).concat(['hack', 'shard', 'trace', 'other']))) ok(css.includes(`.ncm-ov2-k--${k}`), `kind accent .ncm-ov2-k--${k}`);
ok(tpl.includes('ncm-ov2-scroll--table') && /\.ncm-ov2-scroll--table\s*\{[^}]*max-height/.test(css), 'the table list scrolls in its own box');
ok(tpl.includes('ncm-ov2-scroll--needs') && /\.ncm-ov2-scroll--needs\s*\{[^}]*min-height: 0/.test(css) && /\.ncm-ov2-nl__open\s*\{[^}]*max-height/.test(css), 'the open chip panel scrolls inside a capped panel');
ok(/\.ncm-ov2-scroll \{[^}]*overflow-y: auto;[^}]*overflow-x: hidden/.test(css) && /\.ncm-ov2-dock \{[^}]*overflow-y: auto;[^}]*overflow-x: hidden/.test(css), 'scrollers pair overflow-y with overflow-x:hidden');
const hexes = (css.replace(/\/\*[\s\S]*?\*\//g, '').match(/#[0-9a-fA-F]{3,6}\b/g) || []).filter((h) => h.toLowerCase() !== '#fff');
ok(hexes.length === 0, `no literal colours besides #fff (${hexes.join(',')})`);
ok(!/border-radius:\s*(?:[3-9]|\d\d)px/.test(css.replace(/border-radius: 50%|border-radius: 7px|border-radius: 3px; background: var\(--ncm-bg-elevated\)/g, '')), 'chrome radius stays 1–2px (avatars/badge/heat bar excepted)');
const others = fs.readdirSync(`${ROOT}/styles`, { recursive: true }).filter((f) => String(f).endsWith('.css') && !String(f).endsWith('tab-overview.css'));
ok(!others.some((f) => read(`styles/${String(f).replace(/\\/g, '/')}`).includes('.ncm-ov2-')), 'prefix ncm-ov2 is used by no other stylesheet');
ok(!/ncm-ov2-rw/.test(css + tpl + tab), 'the old runway (ncm-ov2-rw*) is gone');
ok(['ncm-ov-hl--cyan', 'ncm-ov-hl--green', 'ncm-ov-hl--purple'].every((c) => css.includes(c)), 'logActivity highlight spans are still styled');
const gridH = Number(/\.ncm-app \.ncm-ov2-grid \{[^}]*height: (\d+)px/.exec(css)?.[1]);
ok(gridH >= M.NL_TRACK_PX && gridH <= M.NL_TRACK_PX + 80, `the grid height (${gridH}) frames a track of about NL_TRACK_PX (${M.NL_TRACK_PX})`);
ok(/prefers-reduced-motion[\s\S]*is-bad::before \{ animation: none/.test(css), 'reduced motion stops the pulse');
ok(/\.ncm-ov2-nl:has\(\.ncm-ov2-nl__open\) \.ncm-ov2-nl__ev\.is-future \{[^}]*pointer-events: none/.test(css), 'the future dims and goes inert behind an open chip panel');

// ═══ 5. Player network hello (the "At the table" network column) ═══
const net = read('scripts/init/registerNetworkSystem.js');
ok(/case 'hello':[\s\S]{0,400}playerNetworks[\s\S]{0,40}\.set\(sender/.test(net), 'GM records a player hello by socket sender');
const helloAt = net.indexOf("case 'hello':");
ok(!/NETWORK_CHANGED/.test(net.slice(helloAt, net.indexOf('break;', helloAt)).replace(/\/\/.*$/gm, '')), 'a hello never emits NETWORK_CHANGED (auto-spam would fire on every login)');
ok(/case 'helloRequest':[\s\S]{0,300}type: 'hello'/.test(net), 'a player answers a GM helloRequest');
ok(/case 'switch':[\s\S]{0,400}playerNetworks/.test(net), 'switches update the record too');
ok(/register\('postReady', 40, 'Network hello/.test(net), 'the hello task is registered');
ok(/_gatherTable[\s\S]{0,800}playerNetworks/.test(tab), 'the table reads the record');

// ═══ 6. REAL render through Handlebars ═══
let Handlebars = null;
for (const p of ['C:/Program Files/Foundry Virtual Tabletop/resources/app/package.json', 'C:/Program Files (x86)/Foundry Virtual Tabletop/resources/app/package.json']) {
  if (!fs.existsSync(p)) continue;
  try { Handlebars = createRequire(p)('handlebars'); break; } catch { /* keep looking */ }
}
const need = (kind, extra = {}) => ({ kind, icon: 'fa-bell', key: `${kind}-k`, sig: 's', dismissKey: `${kind}-k|s`, html: `<b>${kind}</b> thing`, subline: 'sub line', actions: [{ label: 'Go', action: 'switchTab', primary: true, dataAttrs: [{ k: 'tab', v: 'messages' }] }, { label: 'Stop', action: 'securityDefuse', danger: true, dataAttrs: [{ k: 'item-id', v: 'I1' }, { k: 'resident-id', v: 'R1' }] }], ...extra });
const needsR = M.rankNeeds([need('mail', { count: 2 }), need('burned'), need('mail', { key: 'mail-2', dismissKey: 'mail-2|s' })]);
const tableCtx = (() => {
  const p = (o) => { const a = M.assessPlayer(o); return { ...o, ...a, bars: M.barList(o.signal), hue: 'var(--ncm-hue-2)', netHue: 'var(--ncm-hue-5)', initials: o.name[0], fixes: [] }; };
  const V = p({ userId: 'u1', actorId: 'A1', name: 'V', playerName: 'Marta', online: true, address: 'v@nightcity.net', sceneName: 'Night Market', network: 'CitiNet', signal: 82, contacts: 6, unread: 2, held: 0 });
  const R = { ...p({ userId: 'u3', actorId: 'A3', name: 'Rache', playerName: 'Sam', online: true, address: '', deadZone: true, sceneName: 'The Docks', sceneDead: true, network: 'CitiNet', signal: 82, contacts: 0, unread: 0, held: 1 }), isOpen: true, img: 'r.png',
    fixes: [{ op: 'tblSetEmail', label: 'Set an address', primary: true }, { op: 'tblDeliver', label: 'Deliver it now', primary: true }, { op: 'tblShareGroup', label: 'Share The Crew', primary: true, groupId: 'g1' }] };
  const J = p({ userId: 'u4', actorId: 'A4', name: 'Panam', playerName: 'Jo', online: false, address: 'p@a.nc', sceneName: '', network: '', signal: 0, contacts: 4, unread: 3, held: 0 });
  const K = p({ userId: 'u5', actorId: 'A5', name: 'Kiri', playerName: 'Pat', online: true, address: 'k@a.nc', sceneName: 'Night Market', network: 'Watson Free', signal: 40, contacts: 2, unread: 0, held: 0 });
  return { hasPlayers: true, online: 3, need: 2, players: [V, R, K, J], scenes: [] };
})();
const ov = {
  clock: '2045-03-11 23:41', time: '23:41', date: '2045-03-11', sceneName: 'Afterlife', sceneDead: true,
  nl: { ...M.nowLineLayout({ activity, needs: needsR, timers, nowMs: NOW, zoom: 60, open: 'mail', sel: 'trace:1' }), feedFilter: 'all' },
  table: tableCtx,
  tiles: [{ tab: 'messages', icon: 'fa-envelope', color: 'var(--ncm-hue-2)', label: 'Messages', n: 12, lines: ['<b>3</b> unread'], bad: '' }, { tab: 'shards', icon: 'fa-microchip', color: 'var(--ncm-hue-6)', label: 'Shards', n: 4, lines: ['x'], bad: '1 bricked' }],
};
if (process.env.NCM_DUMP) fs.writeFileSync(`${process.env.NCM_DUMP}/overview-nowline-ctx.json`, JSON.stringify({ activity, needs: needsR, timers, now: NOW, ov }, null, 1));
if (!Handlebars) { fail++; console.error('FAIL: could not load Handlebars from a Foundry install — render checks did not run'); }
else {
  const H = Handlebars.create();
  H.registerHelper('eq', (a, b) => String(a) === String(b));
  H.registerHelper('ncm-hue', (t) => (t ? 'var(--ncm-hue-1)' : 'var(--ncm-text-label)'));
  const render = H.compile(tpl);
  const html = render({ activeTab: 'overview', ov });
  if (process.env.NCM_DUMP) fs.writeFileSync(`${process.env.NCM_DUMP}/overview.html`, html);
  ok(render({ activeTab: 'messages', ov }).trim() === '', 'renders nothing on another tab');
  ok(render({ activeTab: 'overview', ov: null }).trim() === '', 'renders nothing when the context is null');
  ok(/class="ncm-ov2-nl" data-nl-zoom="60" data-nl-now="\d+"/.test(html.replace(/ncm-ov2-mod /, '')), 'the instrument carries its zoom + render time for the DOM clock');
  ok((html.match(/data-nl-ev="p"/g) || []).length === 4 && /data-nl-ev="p" data-ts="\d+" data-tooltip="s"/.test(html), 'four past rows, each with its stamp + subline tooltip');
  ok(/is-past is-far"[^>]*--tc:var\(--ncm-attn\)/.test(html) && /is-past"[^>]*--tc:var\(--ncm-bad\)/.test(html), 'past rows: a far one in amber, the fresh failure in red');
  ok(/data-nl-ago>4m</.test(html) && /<b>Hiro failed<\/b>/.test(html) === false && html.includes('Hiro failed'), 'past row: html raw, ago label clock-driven');
  ok(/ncm-ov2-nl__wait is-attn is-on"[^>]*data-filter="mail"[^>]*aria-expanded="true"[^>]*>[\s\S]*?Mail waiting<span class="ncm-ov2-nl__n">2<\/span>/.test(html), 'the open chip: amber, lit, its count');
  ok(/ncm-ov2-nl__wait is-bad"[^>]*data-filter="burned"/.test(html), 'a security chip is red');
  ok(/ncm-ov2-nl__open is-attn"[^>]*style="top:43%"/.test(html) && /<b>Mail waiting<\/b><span>2 of 3 waiting · ranked<\/span>/.test(html), 'the open panel hangs under the line and names what it holds');
  ok((html.match(/class="ncm-ov2-need /g) || []).length === 2 && html.includes('data-alert-key="mail-k|s"') && html.includes('data-item-id="I1" data-resident-id="R1"') && /ncm-ov2-need ncm-ov2-k--mail is-top/.test(html), 'the open items: the two mail needs, dismiss keys, action data, the top one marked');
  ok(html.includes('data-action="ovClearAlerts"') && /data-action="ovNeedFilter" data-filter="all" aria-label="Close"/.test(html), 'Dismiss all + close in the panel head');
  ok((html.match(/data-nl-ev="f"/g) || []).length === 2 && /is-future is-bad is-sel"[^>]*data-timer-id="trace:1" data-at="\d+" data-top="[\d.]+"/.test(html), 'two future rows inside the hour; the picked red trace carries id + when + its laid-out top');
  ok(/data-op="rwPick"[^>]*aria-expanded="true"[^>]*><b>Trace<\/b> Arasaka on Rache<\/button>/.test(html) && /data-nl-left>9m</.test(html), 'a future row: kind + name, a clock-driven countdown');
  ok(/data-action="securityCountdownCancel" data-countdown-id="C1" data-tooltip="Call off"><i class="fas fa-ban"><\/i>Call off/.test(html), 'a future row carries its existing action with data attributes');
  ok(/ncm-ov2-nl__facts"><span class="ncm-ov2-nl__facts-sub">Trace · WS<\/span><span class="ncm-ov2-nl__fk">Who<\/span><span class="ncm-ov2-nl__fv">Arasaka<\/span><\/div>/.test(html), 'the picked row shows its facts (empty ones dropped)');
  ok(/data-op="rwZoom" data-zoom="360"[^>]*>\+3 later</.test(html), '"+N later" zooms out');
  ok(/ncm-ov2-zoom__b is-on"[^>]*data-zoom="60"/.test(html) && (html.match(/data-op="rwLane"/g) || []).length === 5, 'the zoom is lit; five legend keys');
  ok(/<b class="is-bad">1<\/b> under 10 min · <b class="is-attn">1<\/b> this hour · <b>5<\/b> timers/.test(html), 'the summary line');
  ok(/ncm-ov2-nl__tick is-now" style="top:38%">NOW</.test(html) && /ncm-ov2-nl__tick is-past"/.test(html) && /data-nl-clock>23:41</.test(html), 'the axis: NOW at 38%, past ticks, the clock on the line');
  ok(/ncm-ov2-nl__zone is-bad" style="top:38%;height:10\.333%"/.test(html), 'the red zone is drawn under the line');
  // the dock
  ok(/ncm-ov2-clockcard__t">23:41</.test(html) && /ncm-ov2-clockcard__d">2045-03-11</.test(html) && /ncm-ov2-clockcard__scn is-dead"[^>]*><i class="fas fa-ban"><\/i><span>Afterlife<\/span><span class="ncm-tagp is-bad">dead zone/.test(html), 'the clock card: time, date, the scene red when a dead zone');
  ok((html.match(/class="ncm-ov2-pp /g) || []).length === 4 && /ncm-ov2-pp is-ok"[^>]*data-op="tblToggle" data-user-id="u1"/.test(html), 'four player rows, each a tabAct toggle carrying its user');
  ok(/ncm-ov2-pp is-bad is-open/.test(html) && html.includes('aria-expanded="true"') && /ncm-ov2-pp__nm">Rache<small>Sam · The Docks · <span class="is-warn">1 held<\/span> · <span class="is-bad">no address<\/span>/.test(html), 'the open row: its facts in words');
  ok(/ncm-ov2-pp__net is-net" style="--nc:var\(--ncm-hue-5\)"><span class="ncm-ov2-sig">(<i class="is-on"><\/i>){4}<\/span>CitiNet/.test(html) && /ncm-ov2-pp__net is-nosig"[^>]*><i class="fas fa-ban"><\/i>no signal/.test(html) && /ncm-ov2-pp__net is-net is-weak"/.test(html) && /ncm-ov2-pp__net is-off"[^>]*>offline/.test(html), 'network cell: bars + name / red no signal / weak / offline');
  ok(html.includes('<img src="r.png"') && /ncm-ov2-badge">2</.test(html) && /ncm-ov2-badge">3</.test(html), 'portrait + unread badges');
  ok((html.match(/class="ncm-ov2-why"/g) || []).length === 1 && /ncm-ov2-why" data-user-id="u3" data-actor-id="A3"/.test(html) && /Rache — can&#x27;t mail/.test(html), 'one why panel under the open row, carrying user + actor');
  ok((html.match(/ncm-ov2-why__ul">([\s\S]*?)<\/ul>/)?.[1].match(/<li /g) || []).length >= 4 && html.includes('<li class="is-b"><i class="fas fa-at">'), 'why lines with meaning tones');
  ok(/data-op="tblSetEmail">Set an address[\s\S]*data-op="tblDeliver">Deliver it now[\s\S]*data-op="tblShareGroup" data-group-id="g1">Share The Crew/.test(html), 'fix buttons');
  ok(['tblInbox', 'tblWrite', 'tblContacts', 'tblClose'].every((o) => html.includes(`data-op="${o}"`)), 'inbox / write / contacts / close');
  ok(/ncm-ov2-mod__n is-attn">2 need you</.test(html), 'the table head counts who needs you (amber)');
  ok(/3 online/.test(render({ activeTab: 'overview', ov: { ...ov, table: { ...ov.table, need: 0 } } })), 'the table head: N online when nobody needs you');
  ok((html.match(/data-action="switchTab" data-tab="/g) || []).length >= 2 && /ncm-ov2-tile is-bad"[^>]*data-tab="shards"[\s\S]*?ncm-ov2-tile__n is-bad">4<\/b>[\s\S]*?ncm-ov2-tile__bad">1 bricked/.test(html), 'tiles link to their tab; a bad line turns the number red');
  ok(['openComposer', 'openGMContacts', 'ovBroadcast', 'openTimeSettings'].every((a) => new RegExp(`ncm-ov2-quick[\\s\\S]*data-action="${a}"`).test(html)), 'quick actions in the dock');
  const empty = render({ activeTab: 'overview', ov: { ...ov, nl: { ...M.nowLineLayout({ nowMs: NOW }), feedFilter: 'all' }, table: { players: [], scenes: [], hasPlayers: false, online: 0, need: 0 }, tiles: [] } });
  ok(empty.includes('nothing is waiting on you') && empty.includes('Quiet.') && empty.includes('No players in this world yet') && !empty.includes('data-nl-ev=') && !empty.includes('ncm-ov2-nl__open'), 'empty states');
  ok(!/undefined|\[object Object\]|NaN/.test(html + empty), 'no undefined / NaN leaks');
  const bal = (s) => (s.match(/<div\b/g) || []).length === (s.match(/<\/div>/g) || []).length && (s.match(/<button\b/g) || []).length === (s.match(/<\/button>/g) || []).length;
  ok(bal(html) && bal(empty), 'div + button tags balance in the render');
}

// ═══ 7. AT THE TABLE — the rules + the REAL OverviewTab ═══
// 7a. pure rules
{
  ok(M.signalBars(82) === 4 && M.signalBars(60) === 3 && M.signalBars(30) === 2 && M.signalBars(5) === 1 && M.signalBars(0) === 0, 'signalBars thresholds 80/50/25/1');
  ok(M.barList(60).filter((b) => b.on).length === 3 && M.barList(60).length === 4, 'barList');
  const nets = [
    { id: 'citi', name: 'CitiNet', signalStrength: 82, availability: { global: true } },
    { id: 'wat', name: 'Watson Free', signalStrength: 60, availability: { scenes: ['market'] } },
    { id: 'ara', name: 'Arasaka', signalStrength: 90, availability: {} },
    { id: 'off', name: 'Off', enabled: false, availability: { global: true } },
  ];
  const mk = M.sceneNetworks(nets, { id: 'market' });
  ok(mk.map((n) => n.name).join() === 'CitiNet,Watson Free' && mk[0].signal === 82, 'sceneNetworks: global + listed, disabled left out');
  ok(M.sceneNetworks(nets, { id: 'x', availability: { ara: true } }).some((n) => n.id === 'ara'), 'sceneNetworks: the scene availability map (by id)');
  ok(M.sceneNetworks(nets, { id: 'x', availability: { Arasaka: true } }).some((n) => n.id === 'ara'), 'sceneNetworks: the scene availability map (by name)');
  ok(M.sceneNetworks(nets, { id: 'market', deadZone: true }).length === 0, 'a dead zone reaches nothing');

  const base = { online: true, playerName: 'Marta', address: 'v@nightcity.net', deadZone: false, sceneName: 'Night Market', network: 'CitiNet', signal: 82, contacts: 6, unread: 2, held: 0 };
  const st = (o) => M.assessPlayer({ ...base, ...o });
  ok(st({}).status === 'ready' && st({}).tone === 'ok' && !st({}).needsYou, 'everything fine → ready (ok)');
  ok(st({ address: '' }).status === "can't mail" && st({ address: '' }).tone === 'bad', "no address → can't mail (bad)");
  ok(st({ address: '' }).fixes.includes('setEmail'), 'no address → Set an address fix');
  ok(st({ deadZone: true }).status === 'no signal' && st({ deadZone: true }).tone === 'bad', 'dead zone → no signal (bad)');
  ok(st({ address: '', deadZone: true }).status === "can't mail", "no address beats no signal");
  ok(st({ held: 1 }).status === 'mail held' && st({ held: 1 }).tone === 'warn' && st({ held: 1 }).fixes.includes('deliver'), 'held mail → mail held (warn) + Deliver');
  ok(st({ contacts: 0 }).status === 'no contacts' && st({ contacts: 0 }).fixes.includes('share'), 'no contacts → no contacts (warn) + Share');
  ok(st({ held: 2, contacts: 0 }).status === 'mail held', 'mail held beats no contacts');
  ok(st({ signal: 30 }).status === 'weak signal' && st({ signal: 30 }).weak, 'signal under 50 → weak signal (warn)');
  ok(st({ contacts: 0, signal: 30 }).status === 'no contacts', 'no contacts beats weak signal');
  ok(st({ online: false, network: '' }).status === 'offline' && st({ online: false }).tone === 'off' && !st({ online: false }).needsYou, 'offline with nothing wrong → offline');
  ok(st({ online: false, address: '' }).status === "can't mail", 'offline but no address still needs you');
  ok(st({ online: false, deadZone: true }).tone === 'off', 'an offline player is not on a dead zone');
  ok(st({ network: '' }).status === 'ready' && !st({ network: '' }).onNet, 'network not reported yet is not a problem');
  ok(st({ deadZone: true }).facts.some((f) => f.tone === 'b' && /dead zone/.test(f.html)), 'the dead-zone fact names the scene');
  ok(st({ address: '<x>' }).facts[0].html.includes('&lt;x&gt;'), 'fact text is escaped');
  ok(st({}).facts.every((f) => ['ok', 'w', 'b'].includes(f.tone) && /^fa-/.test(f.icon)), 'every fact has a tone + icon');

  const scenes = [{ id: 'market', name: 'Night Market' }, { id: 'docks', name: 'The Docks' }, { id: 'alley', name: 'Alley' }];
  const players = [{ n: 'V', sceneId: 'market' }, { n: 'Rache', sceneId: 'docks' }, { n: 'Panam', sceneId: '' }, { n: 'Judy', sceneId: 'market' }, { n: 'Kerry', sceneId: 'gone' }, { n: 'Mo', sceneId: 'alley' }];
  const bands = M.groupByScene(players, scenes, 'docks');
  ok(bands.map((b) => b.id).join() === `docks,alley,market,${M.NO_SCENE}`, "the GM's scene first, then by name, then Not on any scene");
  ok(bands[0].you && !bands[1].you, '"you are here" on the GM\'s scene only');
  ok(bands.find((b) => b.id === 'market').players.length === 2, 'two players on one scene share a band');
  const none = bands.find((b) => b.id === M.NO_SCENE);
  ok(none.idle && none.name === 'Not on any scene' && none.players.map((p) => p.n).join() === 'Panam,Kerry', 'no scene / an unknown scene → Not on any scene');
  ok(!M.groupByScene([{ sceneId: 'market' }], scenes).some((b) => b.id === 'docks'), 'scenes with no players are not shown');
  const sum = M.tableSummary([{ online: true, needsYou: true }, { online: true }, { online: false, needsYou: true }]);
  ok(sum.online === 2 && sum.need === 2, 'tableSummary: online + need you');
}

// 7b. the REAL OverviewTab._gatherTable + onAct over mocked globals
{
  const flags = (o) => ({ getFlag: (_m, k) => o[k] });
  const scene = (id, name, extra = {}) => ({ id, name, ...flags(extra) });
  const SC = { market: scene('market', 'Night Market', { networkAvailability: { wat: true } }), docks: scene('docks', 'The Docks', { deadZone: true }) };
  const actor = (id, name, f) => ({ id, name, img: 'icons/svg/mystery-man.svg', hasPlayerOwner: true, ownership: {}, ...flags(f) });
  const A = {
    v: actor('v', 'V', { email: 'v@nightcity.net', contacts: [1, 2, 3, 4, 5, 6] }),
    judy: actor('judy', 'Judy', { email: 'judy@mox.nc', contacts: [] }),
    rache: actor('rache', 'Rache', { email: '', contacts: [1, 2, 3] }),
    panam: actor('panam', 'Panam', { email: 'panam@aldecaldo.nc', contacts: [1, 2, 3, 4] }),
  };
  const users = [
    { id: 'gm', isGM: true, active: true, name: 'GM' },
    { id: 'u1', name: 'Marta', active: true, character: A.v, viewedScene: 'market' },
    { id: 'u2', name: 'Ana', active: true, character: A.judy, viewedScene: 'market' },
    { id: 'u3', name: 'Sam', active: true, character: A.rache, viewedScene: 'docks' },
    { id: 'u4', name: 'Jo', active: false, character: A.panam, viewedScene: 'market' },
  ];
  const NETS = [{ id: 'citi', name: 'CitiNet', signalStrength: 82, availability: { global: true } }, { id: 'wat', name: 'Watson Free', signalStrength: 40, availability: {} }];
  const delivered = [];
  const notes = [];
  const queue = [{ messageId: 'h1', remote: true, userId: 'u3', fromActorId: 'rache' }];
  let pushed = null, shared = null, emailed = null, wrote = null, inboxed = null, viewed = null;
  globalThis.ui = { notifications: { info: (m) => notes.push(m), warn: (m) => notes.push(m), error: () => {} } };
  globalThis.game = {
    users, user: users[0],
    actors: { get: (id) => A[id], find: (f) => Object.values(A).find(f) },
    scenes: { get: (id) => SC[id], viewed: SC.market },
    settings: { get: () => ({}) },
    nightcity: {
      playerNetworks: new Map([['u1', { networkId: 'citi' }], ['u2', { networkId: 'wat' }], ['u3', { networkId: 'citi' }]]),
      emailService: { getEmail: (a) => a.getFlag('', 'email') || null, hasEmail: (a) => !!a.getFlag('', 'email') },
      contactGroupService: { getMasterGroups: () => [{ id: 'g1', name: 'The Crew' }], getMasterGroup: () => ({ id: 'g1', name: 'The Crew' }), pushGroupToPlayer: async (g, a) => { pushed = [g, a]; return { success: true, shared: 2 }; } },
      openInbox: (id) => { inboxed = id; },
      openComposer: (o) => { wrote = o; },
      openEmailSetup: async (a) => { emailed = a.id; },
    },
  };
  const { OverviewTab } = await imp('scripts/ui/AdminPanel/tabs/OverviewTab.js');
  let renders = 0;
  const appStub = {
    _activeTab: 'overview', render: () => { renders++; },
    networkService: { getAllNetworks: () => NETS, getNetwork: (id) => NETS.find((n) => n.id === id) },
    messageService: { getQueue: () => queue.slice(), forceDeliver: async (id) => { delivered.push(id); queue.splice(queue.findIndex((q) => q.messageId === id), 1); return { success: true }; } },
    tabs: { contacts: { _sharePickerFor: async (a) => { shared = a; }, _pushGroupPickerFor: async () => {}, onViewPlayerContacts: (e, t) => { viewed = t.closest('[data-actor-id]')?.dataset.actorId; } } },
  };
  const t = new OverviewTab(appStub);
  const stats = { actorStats: [{ actorId: 'v', unreadMessages: 2 }, { actorId: 'panam', unreadMessages: 3 }] };
  let T = t._gatherTable(stats);
  ok(T.scenes.map((s) => s.name).join() === 'Night Market,The Docks,Not on any scene', 'bands: GM scene (market) first, docks, then offline (kept for callers)');
  const mk = T.scenes[0];
  ok(mk.you && mk.nets.map((n) => n.name).join() === 'CitiNet,Watson Free', 'market band: you are here + its networks (global + availability map)');
  ok(mk.nets.every((n) => /^var\(--ncm-hue-\d\)$/.test(n.hue)), 'network tags carry a category hue');
  ok(T.scenes[1].deadZone && T.scenes[1].nets.length === 0, 'docks band is a dead zone with no networks');
  ok(T.players.map((p) => p.name).join() === 'Judy,Rache,V,Panam', 'the dock list: online first, A→Z, offline last');
  const P = Object.fromEntries(T.players.map((p) => [p.name, p]));
  ok(P.V.status === 'ready' && P.V.network === 'CitiNet' && P.V.signal === 82 && P.V.unread === 2 && P.V.sceneName === 'Night Market' && P.V.you, 'V: ready on CitiNet 82%, 2 unread, on the scene you are looking at');
  ok(P.Judy.status === 'no contacts' && P.Judy.weak, 'Judy: no contacts (and on a weak network)');
  ok(P.Rache.status === "can't mail" && P.Rache.dead && P.Rache.held === 1 && P.Rache.sceneDead && P.Rache.sceneName === 'The Docks', "Rache: no address on a dead zone with 1 held → can't mail");
  ok(P.Panam.status === 'offline' && P.Panam.sceneId === '' && P.Panam.sceneName === '' && !P.Panam.onNet, "Panam: offline → no scene (her last viewedScene ignored)");
  ok(P.V.img === null && P.V.initials && /--ncm-hue-/.test(P.V.hue), 'mystery-man portrait → initials in the name hue');
  ok(T.online === 3 && T.need === 2, 'head: 3 online · 2 need you');
  ok(P.Rache.fixes.map((f) => f.op).join() === 'tblSetEmail,tblDeliver', 'Rache fixes: Set an address, Deliver it now');
  ok(P.Judy.fixes.map((f) => f.op).join() === 'tblShareGroup,tblShareContacts' && P.Judy.fixes[0].label === 'Share The Crew' && P.Judy.fixes[0].groupId === 'g1', 'Judy fixes: Share The Crew (the one GM group) + Share contacts');
  ok(T.players.every((p) => !p.isOpen), 'nothing open by default');

  // open state
  const el = (ds, parentDs = {}) => ({ dataset: ds, closest: (sel) => { const k = sel.match(/data-([a-z-]+)/)?.[1]?.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); if (k && k in ds) return { dataset: ds }; if (k && k in parentDs) return { dataset: parentDs }; return null; } });
  t.onAct('tblToggle', {}, el({ userId: 'u3' }));
  T = t._gatherTable(stats);
  ok(t._tableOpen === 'u3' && T.players.find((p) => p.isOpen)?.name === 'Rache', 'tblToggle opens one player');
  t.onAct('tblToggle', {}, el({ userId: 'u1' }));
  ok(t._tableOpen === 'u1', 'one at a time: opening another closes the first');
  T = t._gatherTable(stats);
  ok(T.players.filter((p) => p.isOpen).map((p) => p.name).join() === 'V', '…and survives a fresh gather (re-render)');
  t.onAct('tblToggle', {}, el({ userId: 'u1' }));
  ok(t._tableOpen === null, 'clicking the open row closes it');
  t.onAct('tblToggle', {}, el({ userId: 'u2' }));
  t.onAct('tblClose', {}, el({}));
  ok(t._tableOpen === null, 'tblClose closes it');
  t._tableOpen = 'gone'; t._gatherTable(stats);
  ok(t._tableOpen === null, 'an open player who left is forgotten');

  // every op handled
  const why = { userId: 'u3', actorId: 'rache' };
  await t.onAct('tblDeliver', {}, el({}, why));
  ok(delivered.join() === 'h1' && notes.some((n) => /Delivered 1 held/.test(n)), 'tblDeliver → messageService.forceDeliver for each held message');
  await t.onAct('tblSetEmail', {}, el({}, why));
  ok(emailed === 'rache', 'tblSetEmail → openEmailSetup (ovSetEmail)');
  await t.onAct('tblShareContacts', {}, el({}, { userId: 'u2', actorId: 'judy' }));
  ok(shared === 'judy', 'tblShareContacts → the Contacts tab share picker');
  await t.onAct('tblShareGroup', {}, el({ groupId: 'g1' }, { userId: 'u2', actorId: 'judy' }));
  ok(pushed?.join() === 'g1,judy', 'tblShareGroup → contactGroupService.pushGroupToPlayer');
  t.onAct('tblInbox', {}, el({}, why));
  ok(inboxed === 'rache', 'tblInbox → openInbox');
  t.onAct('tblWrite', {}, el({}, why));
  ok(wrote?.toActorId === 'rache', 'tblWrite → composer to them');
  t.onAct('tblContacts', {}, el({}, why));
  ok(viewed === 'rache', 'tblContacts → their contacts (viewPlayerContacts)');
  // the chip toggle
  t.onNeedFilter({}, { dataset: { filter: 'mail' } }); ok(t._needFilter === 'mail', 'ovNeedFilter opens a kind');
  t.onNeedFilter({}, { dataset: { filter: 'mail' } }); ok(t._needFilter === 'all', '…the same chip again folds it');
  t.onNeedFilter({}, { dataset: { filter: 'hot' } }); t.onNeedFilter({}, { dataset: { filter: 'all' } }); ok(t._needFilter === 'all', '…and "all" closes it');
  const ops = [...OverviewTab.TABLE_OPS, ...OverviewTab.RUNWAY_OPS, ...OverviewTab.QUICK_OPS];
  const tplOps = [...tpl.matchAll(/data-owner="overview" data-op="([a-zA-Z]+)"/g)].map((m) => m[1]);
  const srcOps = [...tab.matchAll(/op: '((?:tbl|rw|q)[a-zA-Z]+)'/g)].map((m) => m[1]);
  for (const op of new Set(tplOps.concat(srcOps))) {
    ok(ops.includes(op), `op ${op} is in TABLE_OPS / RUNWAY_OPS / QUICK_OPS`);
    ok(tab.includes(`case '${op}':`), `onAct handles ${op}`);
  }
  ok(ops.every((op) => tab.includes(`case '${op}':`)), 'every TABLE_OPS / RUNWAY_OPS / QUICK_OPS op has a case');
  // Quick (2026-10-28): the four mid-session verbs the dev agreed to, each wired to an existing door.
  for (const op of OverviewTab.QUICK_OPS) ok(tplOps.includes(op), `Quick: ${op} is a button in the dock`);
  ok(/data-op="qClock" data-add="3600"/.test(tpl) && /data-op="qClock" data-add="86400"/.test(tpl), 'Quick: +1 h and +1 day advance the clock');
  ok(/advanceManualTime\(seconds\)/.test(tab) && /game\.time\?\.advance\?\.\(seconds\)/.test(tab) && /cannot be advanced/.test(tab), 'Quick: the clock advance follows the time provider (manual / world time) and refuses real time honestly');
  ok(/showNamePicker\(/.test(tab) && /pushToPlayer\(contact\.id, pc\.id\)/.test(tab) && /openInbox\?\.\(pick\.id\)/.test(tab) && /_createBlankShard\?\.\(\)/.test(tab), 'Quick: inbox + push go through the shared picker and the existing services; New shard reuses the Shards tab');
  ok(/\.ncm-ov2-quick__row/.test(css), 'Quick: the clock row is styled');
  ok(/tabAct: AdminPanelApp\._onTabAct/.test(app), 'tabAct is registered on the panel');
  ok(/forceDeliver/.test(tab) && /getQueue/.test(tab), 'held mail reads + delivers through the Outbox store');
}

// 7c. the dock renders the compact rows
ok(tpl.includes('ncm-ov2-scroll--table') && /\.ncm-ov2-scroll--table\s*\{[^}]*max-height/.test(css), 'At the table scrolls in its own box');
ok(/\{\{#each ov\.table\.players\}\}/.test(tpl) && !/ov\.table\.scenes/.test(tpl), 'the dock reads the flat player list (the scene is in words on the row)');
ok((tpl.match(/At the table/g) || []).length === 1, 'one At the table module');

console.log(`\ntest-overview: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
