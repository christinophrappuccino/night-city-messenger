// All mail: the CALENDAR NAVIGATOR's rules (2026-10-28) — one pass of counts, the four
// levels, the breadcrumb, ‹ › and Esc, the day bands — plus the wiring in the template,
// the tab and the CSS. The older period rules (periodOf / groupByPeriod) stay exported
// and are still checked here.
import fs from 'node:fs';
const root = new URL('../../../', import.meta.url);
const M = await import(new URL('scripts/ui/AdminPanel/tabs/messagesModel.js', root));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const DAY = 86400000;
const now = Date.UTC(2045, 7, 14, 18);               // Mon 14 Aug 2045
const at = (d, h = 12, m = 7) => Date.UTC(2045, m, d, h);
const fmt = (ms) => new Date(ms).toISOString().slice(0, 10);

// ── the period rules kept for other callers ──
ok(M.periodOf(at(14), now, 'day', fmt).label === 'Today' && M.periodOf(at(13), now, 'day', fmt).label === 'Yesterday', 'day labels');
ok(M.periodOf(at(14, 2), now, 'week', fmt).label === 'This week' && M.periodOf(at(13), now, 'week', fmt).label === 'Last week', 'week labels');
ok(M.periodOf(at(1), now, 'month', fmt).label === 'This month' && M.periodOf(Date.UTC(2045, 6, 9), now, 'month', fmt).label === 'July 2045', 'month labels');
const legacy = [at(14), at(14, 9), at(13), at(6), at(1)].map((t, i) => ({ rawTimestamp: t, unread: i % 2 === 0 }));
ok(M.groupByPeriod(legacy, now, 'day', fmt).length === 4 && M.groupByPeriod(legacy, now, 'month', fmt)[0].count === 5, 'groupByPeriod still groups');

// ── the calendar grid ──
ok(M.dow(at(14)) === 0 && M.dow(at(13)) === 6 && M.dow(Date.UTC(2045, 7, 1)) === 1, 'Monday = 0 … Sunday = 6; Aug 2045 starts on a Tuesday');
ok(M.daysInMonth(2045, 1) === 28 && M.daysInMonth(2044, 1) === 29 && M.daysInMonth(2045, 7) === 31, 'days in a month (leap year 2044)');
ok(M.isoWeek(at(14)) === 33 && M.isoWeek(Date.UTC(2045, 0, 1)) === 52 && M.isoWeek(Date.UTC(2045, 0, 2)) === 1, 'ISO week numbers (1 Jan 2045 is a Sunday of week 52)');
ok(M.weekMonthOf(M.weekStartOf(Date.UTC(2045, 8, 1))).month === 7 && M.weekMonthOf(M.weekStartOf(Date.UTC(2045, 8, 4))).month === 8, 'a week spanning two months belongs to the one holding its Thursday (Fri 1 Sep sits in August’s last week)');
const mw = M.monthWeeks(2045, 7);
ok(mw.length === 5 && mw[0].start === M.weekStartOf(Date.UTC(2045, 7, 1)) && mw[0].days.length === 7 && mw.at(-1).days.includes(Date.UTC(2045, 7, 31)), 'the weeks overlapping a month, Monday-start, covering its last day');

// ── one pass of counts ──
const rows = [
  { rawTimestamp: at(14, 20), unread: true }, { rawTimestamp: at(14, 9) }, { rawTimestamp: at(13), unread: true },
  { rawTimestamp: at(6), isPending: true }, { rawTimestamp: at(6), isPending: true, held: true }, { rawTimestamp: at(1) },
  { rawTimestamp: Date.UTC(2045, 6, 20) }, { rawTimestamp: Date.UTC(2044, 11, 31) }, { rawTimestamp: 0 },
];
const c = M.calendarCounts(rows);
ok(c.total === 9 && c.undated === 1 && c.years.get(2045).n === 7 && c.years.get(2044).n === 1, 'years counted, undated set aside');
ok(c.months.get('2045-7').n === 6 && c.months.get('2045-7').unread === 2 && c.months.get('2045-7').failed === 1 && c.months.get('2045-6').n === 1, 'month buckets: n, unread, failed (held is not failed)');
ok(c.days.get(M.dayStart(at(14))).n === 2 && c.days.get(M.dayStart(at(6))).failed === 1 && c.weeks.get(M.weekStartOf(at(14))).n === 2 && c.weeks.get(M.weekStartOf(at(13))).n === 1, 'day and week buckets');
ok(M.calendarCounts([]).total === 0 && M.yearTiles(M.calendarCounts([]), 2045).tiles.every(t => t.empty), 'no mail: every tile empty, nothing throws');

// ── the levels ──
const y = M.yearTiles(c, 2045, now);
ok(y.tiles.length === 12 && y.tiles[7].n === 6 && y.tiles[7].unread === 2 && y.tiles[7].failed === 1 && y.tiles[7].now && !y.tiles[6].now && y.tiles[0].empty, 'year tiles: counts, now, empty');
ok(y.tiles[7].bars.length === 5 && y.tiles[7].bars.some(b => b.hot) && y.tiles[7].bars.every(b => b.h >= 0 && b.h <= 14) && y.tiles[7].bars.filter(b => b.h === 14).length >= 1, 'a bar per week, 1–14px against the year’s busiest week, amber where unread');
ok(y.year.n === 7 && y.prev.year === 2044 && y.prev.n === 1 && y.next.n === 0, 'the year head + ‹ › neighbours');
const m = M.monthCells(c, 2045, 7, now);
ok(m.cells.filter(x => x.out).length === 1 && m.cells.filter(x => !x.out).length === 31, 'one leading blank for a Tuesday start');
const d14 = m.cells.find(x => x.day === 14), d6 = m.cells.find(x => x.day === 6), d2 = m.cells.find(x => x.day === 2);
ok(d14.today && d14.n === 2 && d14.unread === 1 && d14.v === 28 && d6.failed === 1 && d6.v > 0 && d2.empty && d2.v === 0, 'cells: today, counts, the tint scaled to the busiest day, a failed dot, empty cells dim');
ok(m.weeks.length === 5 && m.weeks.find(w => w.start === M.weekStartOf(at(14))).n === 2 && m.weeks[0].label === 'WK 31' && m.prev.month === 6 && m.prev.n === 1 && m.next.month === 8 && m.next.n === 0, 'week buttons with counts; ‹ › months with counts');
ok(M.monthCells(c, 2045, 0, now).prev.year === 2044 && M.monthCells(c, 2045, 0, now).prev.month === 11, 'January’s ‹ is last December');
const s = M.weekStrip(c, M.weekStartOf(at(14)), now, { selDay: M.dayStart(at(14)) });
ok(s.length === 7 && s[0].wd === 'Mon' && s[0].day === 14 && s[0].today && s[0].sel && s[6].day === 20 && s[6].empty, 'the strip: seven days from Monday, the pick and today marked');

// ── the navigation ──
let st = M.calStateFor('year', now);
ok(st.level === 'year' && st.year === 2045 && M.calRange(st).from === Date.UTC(2045, 0, 1) && M.calRange(st).to === Date.UTC(2046, 0, 1), 'a year’s range');
st = M.calStateFor('month', now);
ok(M.calRange(st).from === Date.UTC(2045, 7, 1) && M.calRange(st).to === Date.UTC(2045, 8, 1) && M.inRange(at(31), M.calRange(st)) && !M.inRange(Date.UTC(2045, 8, 1), M.calRange(st)), 'a month’s range is [first, next first)');
const wk = M.calStateFor('week', Date.UTC(2045, 8, 1));
ok(wk.month === 7 && wk.year === 2045 && M.calRange(wk).from === M.weekStartOf(Date.UTC(2045, 8, 1)), 'a week state carries the month holding its Thursday');
const dy = M.calStateFor('day', at(14, 23));
ok(dy.day === M.dayStart(at(14)) && dy.week === M.weekStartOf(at(14)) && dy.month === 7 && M.calRange(dy).to - M.calRange(dy).from === DAY, 'a day state carries its week and month');
ok(M.calStep(dy, -1).day === M.dayStart(at(13)) && M.calStep(dy, -1).week === M.weekStartOf(at(13)) && M.calStep(dy, -1).week !== dy.week, '‹ from Monday lands on Sunday of the week before (the strip follows)');
ok(M.calStep(M.calStateFor('month', Date.UTC(2045, 0, 5)), -1).year === 2044 && M.calStep(M.calStateFor('month', Date.UTC(2045, 11, 5)), 1).month === 0, '‹ › across a year boundary');
ok(M.calStep(wk, 1).week === wk.week + 7 * DAY && M.calStep(M.calStateFor('year', now), 1).year === 2046, '‹ › a week / a year');
ok(M.calUp(dy).level === 'month' && M.calUp({ ...dy, viaWeek: true }).level === 'week' && M.calUp(wk).level === 'month' && M.calUp(M.calStateFor('month', now)).level === 'year' && M.calUp(M.calStateFor('year', now)).level === 'year', 'Esc: day → month (or the week it came from) → year, and no further');
ok(M.calCrumbs(dy).map(x => x.label).join('›') === '2045›August›Mon 14' && M.calCrumbs({ ...dy, viaWeek: true }).map(x => x.label).join('›') === '2045›August›Week 33›Mon 14' && M.calCrumbs(wk).at(-1).label === 'Week 35' && M.calCrumbs(M.calStateFor('year', now)).length === 1, 'the breadcrumb');
ok(M.calCrumbs(dy).at(-1).here && !M.calCrumbs(dy)[0].here, 'only the last crumb is "here"');

// ── the day bands ──
const bands = M.daySplit([{ rawTimestamp: at(14, 20) }, { rawTimestamp: at(14, 9) }, { rawTimestamp: at(14, 12) }, { rawTimestamp: at(14, 0) }]);
ok(bands.map(b => `${b.key}:${b.rows.length}`).join() === 'morning:2,afternoon:1,evening:1', 'morning < 12 ≤ afternoon < 18 ≤ evening');
ok(M.orderBands(bands)[0].key === 'evening' && M.orderBands(bands, true)[0].key === 'morning', 'newest first puts the evening on top; oldest first the morning');
ok(M.daySplit([]).length === 0 && M.daySplit([{ rawTimestamp: at(14, 23) }]).length === 1, 'empty bands are dropped');

// ── the wiring ──
const nl = /\r?\n/;
const js = fs.readFileSync(new URL('scripts/ui/AdminPanel/tabs/MessagesTab.js', root), 'utf8');
const hbs = fs.readFileSync(new URL('templates/admin-panel/tab-messages.hbs', root), 'utf8');
const css = fs.readFileSync(new URL('styles/components/admin-panel/tab-messages.css', root), 'utf8');
for (const op of ['calLevel', 'calMonth', 'calWeek', 'calDay', 'calStep', 'calUp', 'calJump', 'calMore', 'mailOrder']) ok(hbs.includes(`data-op="${op}"`) && new RegExp(`case '${op}'`).test(js), `op ${op} wired`);
ok(!hbs.includes('data-op="mailPeriod"') && !hbs.includes('data-op="mailFoldAll"') && !hbs.includes('data-msg2-fold=') && !hbs.includes('openDateRangePicker'), 'the old group-by control, date folds and Dates button are gone from All mail');
ok(/calendarCounts\(all\)/.test(js) && !/calendarCounts\([^)]*\)[\s\S]{0,200}calendarCounts\(/.test(js.slice(js.indexOf('_calendar(all'), js.indexOf('_onCalAct'))), 'counts come from ONE pass per render');
ok(js.includes('if (this._oldest) filtered = [...filtered].reverse()') && js.indexOf('if (this._oldest)') < js.indexOf('const page = list.slice(0, this._calLimit)'), 'oldest-first is decided before the page cut');
ok(js.includes('_calLimit = 50') && js.includes("case 'calMore': this._calLimit += 50"), 'paged 50 at a time');
ok(/this\._calAuto = true/.test(js.slice(js.indexOf("wireSearch('[data-msg2-search]'"), js.indexOf("wireSearch('[data-msg2-search]'") + 200)) && js.includes("ScopePicker.on(whoId, (v) => { if (same(v, whoWas)) return;"), 'search / Who / Filter changes let an empty view jump; picker callbacks compare before acting');
ok(/ev\.key === 'Escape' \|\| ev\.key === 'Backspace'/.test(js) && /ArrowLeft/.test(js) && js.includes("document.removeEventListener('keydown', this._calKeys)"), 'Esc / Backspace / ← → on a document listener, removed on close');
ok(js.includes("getAnimationLevel?.() === 'off'") && js.includes("prefers-reduced-motion") && hbs.includes('{{#if fresh}} is-fresh{{/if}}') && hbs.includes('data-cal-anim="{{anim}}"'), 'the entrance is vetoed by reduced motion / the animation pref and stamped once per level change');
for (const a of ['grow', 'fold', 'step-next', 'step-prev', 'up']) ok(css.includes(`[data-cal-anim="${a}"]`) && js.includes(`'${a}'`), `entrance ${a} styled + stamped`);
ok(css.split(nl).some(l => l.includes('prefers-reduced-motion') && l.includes('ncm-msg2-cal__body.is-fresh')), 'reduced motion kills the entrance in CSS too');
ok(hbs.includes('data-op="calJump" data-to="{{to}}"') && js.includes("d.to === 'today'") && js.includes("d.to === 'week'"), 'Today · This week · This month');
ok(/\.ncm-msg2-cal__dc \.dot \{[^}]*--ncm-attn/.test(css) && /\.ncm-msg2-cal__dc \.dot\.is-x \{[^}]*--ncm-bad/.test(css) && /\.ncm-msg2-cal__mt \.bars i\.is-hot \{[^}]*--ncm-attn/.test(css), 'amber = unread, red = not delivered');
ok(!/#[0-9a-f]{6}/i.test(css.slice(css.indexOf('CALENDAR NAVIGATOR')).replace(/\/\*[\s\S]*?\*\//g, '')), 'tokens only');
ok(hbs.includes('{{> ncmMsg2CalRow}}') && hbs.includes('{{#*inline "ncmMsg2CalRow"}}') && !/\{\{\.\.\//.test(hbs.slice(hbs.indexOf('{{#with all.cal}}'), hbs.indexOf('{{/with}}', hbs.indexOf('{{#with all.cal}}')))), 'one row partial; @root, never ../, inside the navigator');
// the action row
const acts = hbs.slice(hbs.indexOf('<div class="ncm-msg2-acts '), hbs.indexOf('<div class="ncm-msg2-body">'));
ok(acts.includes('ncm-msg2-acts--line') && acts.includes('data-op="actReply"') && acts.includes('data-op="actInbox"') && acts.includes('shareMsgToChat') && acts.includes('data-op="copyToTerminal"') && acts.includes('ncm-msg2-junkbtn') && acts.includes('hardDeleteMessage'), 'Reply as · Inbox · Share · Copy to terminal · Junk ▾ · Delete on one row');
ok((acts.match(/data-op="actReply"/g) || []).length === 1 && (acts.match(/data-op="actInbox"/g) || []).length === 1 && !acts.includes('data-op="replyAs"'), 'ONE Reply as and ONE Inbox button (a picker when there are several)');
ok(js.includes("case 'actReply': return this._onActPick('reply'") && js.includes("case 'actInbox': return this._onActPick('inbox'") && /if \(list\.length > 1\) \{[\s\S]{0,400}showNamePicker/.test(js), 'one choice acts, several pick');
ok(hbs.includes('data-cal-grip') && hbs.includes('data-cal-top') && css.includes('max-height: var(--cal-grid-h, none)') && js.includes('_calGridH'), 'the grip resizes the month list in place and is remembered for the session');
ok(acts.indexOf('shareMsgToChat') < acts.indexOf('copyToTerminal') && acts.indexOf('copyToTerminal') < acts.indexOf('ncm-msg2-junkbtn') && acts.indexOf('ncm-msg2-junkbtn') < acts.indexOf('hardDeleteMessage'), '…in that order');
ok(/\.ncm-msg2-acts--line \{[^}]*flex-wrap: nowrap[^}]*overflow: hidden/.test(css) && (acts.match(/ncm-msg2-btn--quietact/g) || []).length >= 2 && acts.split('ncm-msg2-btn--quietact').slice(1).every(x => /data-tooltip="/.test(x.slice(0, 200))), 'it never wraps; every icon-only button carries a tooltip');
console.log(`test-mail-periods: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
