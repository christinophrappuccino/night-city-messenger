// Sim: TimeService ↔ Simple Calendar date mapping.
//
// Tester report (2026-10-20): "Date is one day off from Simple Calendar — one
// day behind." SimpleCalendar.api.currentDateTime() returns `month` and `day`
// as ZERO-BASED INDICES (its bundle: `getMonthAndDayIndex()` → `day: e.day||0`).
// Date.UTC's month is zero-based too, but day-of-month is 1-based, so passing
// the day index straight through produced "day 0" = the last day of the
// previous month. Drives the REAL TimeService (static helper + the instance
// read path with a mocked SimpleCalendar global).
import { pathToFileURL } from 'url';

const ROOT = 'C:/Users/cphan/AppData/Local/FoundryVTT/Data/modules/night-city-messenger';
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };

// ── Minimal Foundry globals ──
let scNow = { year: 2045, month: 0, day: 0, hour: 12, minute: 30, seconds: 5 };
globalThis.SimpleCalendar = { api: { currentDateTime: () => scNow } };
globalThis.game = {
  settings: { get: () => 'simple-calendar' },
  modules: { get: () => ({ active: true }) },
  time: { worldTime: 0 },
  users: { find: () => null },
};
globalThis.Hooks = { on: () => {}, once: () => {}, off: () => {} };
globalThis.ui = { notifications: { info: () => {}, warn: () => {}, error: () => {} } };

const { TimeService } = await import(pathToFileURL(`${ROOT}/scripts/services/TimeService.js`).href);

// ═══ Static helper — the pure mapping ═══
const iso = (dt) => new Date(TimeService.scDateTimeToMs(dt)).toISOString();

ok(iso({ year: 2045, month: 0, day: 0, hour: 0, minute: 0, seconds: 0 }) === '2045-01-01T00:00:00.000Z',
  'month index 0 / day index 0 → January 1st (was December 31st of the prior year)');
ok(iso({ year: 2045, month: 2, day: 14, hour: 9, minute: 5, seconds: 0 }) === '2045-03-15T09:05:00.000Z',
  'month index 2 / day index 14 → March 15th');
ok(iso({ year: 2045, month: 11, day: 30, hour: 23, minute: 59, seconds: 59 }) === '2045-12-31T23:59:59.000Z',
  'last index of December → December 31st, same year');
ok(iso({ year: 2045, month: 1, day: 27 }) === '2045-02-28T00:00:00.000Z',
  'missing hour/minute/seconds default to midnight; Feb index 27 → Feb 28');
ok(iso({ year: 2044, month: 1, day: 28 }) === '2044-02-29T00:00:00.000Z',
  'leap-year February index 28 → Feb 29 (JS Date handles the calendar)');

// The ONE-DAY-BEHIND regression, stated directly: for any SC reading, the UTC
// day-of-month must equal the SC day index + 1.
let monotone = true;
for (let m = 0; m < 12; m++) {
  for (let d = 0; d < 28; d++) {
    const dt = new Date(TimeService.scDateTimeToMs({ year: 2045, month: m, day: d, hour: 6 }));
    if (dt.getUTCMonth() !== m || dt.getUTCDate() !== d + 1) { monotone = false; break; }
  }
}
ok(monotone, 'for every month/day index the UTC date is (month index, day index + 1)');

// ═══ Instance read path — the real _getSimpleCalendarTime ═══
const svc = Object.create(TimeService.prototype);
svc._hasSimpleCalendar = true;
ok(svc._getSimpleCalendarTime() === '2045-01-01T12:30:05.000Z',
  '_getSimpleCalendarTime maps the live SC reading with the +1 day');

scNow = { year: 2077, month: 9, day: 19, hour: 14, minute: 28, seconds: 0 };
ok(svc._getSimpleCalendarTime() === '2077-10-20T14:28:00.000Z',
  'a second reading (Oct index 9, day index 19) → 2077-10-20');

// SC not installed → real time, never throws
svc._hasSimpleCalendar = false;
ok(typeof svc._getSimpleCalendarTime() === 'string', 'without SC the read path falls back to a real-time ISO string');

// SC API throwing → falls back, never throws out
svc._hasSimpleCalendar = true;
globalThis.SimpleCalendar.api.currentDateTime = () => { throw new Error('boom'); };
let threw = false;
try { svc._getSimpleCalendarTime(); } catch { threw = true; }
ok(!threw, 'an SC API error is caught and falls back to real time');

console.log(`\ntest-simple-calendar-date: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
