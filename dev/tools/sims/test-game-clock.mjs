// Game clock vs real clock (2026-10-28). Dev: mail sent at GAME time 11 Mar 2026 read "last mail · 231d ago" in
// Admin → Contacts, because the panel's "… ago" formatter compared a game-time stamp to the computer's real date.
// Mail, trace rows, readAt, login footprints, recycle-bin rows, shard and ICE-breach lockouts are written on the
// GAME clock (timeService.getCurrentTimeMs); delivery failures, held mail, group pushes and drafts on the REAL one.
// This sim drives the real AdminPanelApp._relativeTime with a game clock 231 days behind the real date, and greps
// every site that was fixed so a Date.now() comparison against a game stamp can't come back.
import { readFileSync } from 'node:fs';

const ROOT = new URL('../../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8').replace(/\r\n/g, '\n');   // the repo is CRLF on Windows
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL:', m); } };

// ── the formatter, lifted out of AdminPanelApp and run with a game clock ≠ real clock ──
const app = read('scripts/ui/AdminPanel/AdminPanelApp.js');
const start = app.indexOf('  _relativeTime(isoTimestamp');
const end = app.indexOf('\n  }\n', start) + 4;
ok(start > 0 && end > start, 'AdminPanelApp._relativeTime found');
const body = app.slice(start, end).replace(/^  _relativeTime\(/, 'function _relativeTime(');
const GAME_NOW = Date.UTC(2026, 2, 11, 12, 0);            // the table's clock: 11 Mar 2026 12:00
const REAL_NOW = Date.UTC(2026, 9, 28, 12, 0);            // the computer: 28 Oct 2026
globalThis.game = { nightcity: { timeService: { getCurrentTimeMs: () => GAME_NOW } } };
const realDateNow = Date.now; Date.now = () => REAL_NOW;
const rel = new Function(`${body}; return _relativeTime;`)();

const mail = new Date(Date.UTC(2026, 2, 11, 10, 0)).toISOString();   // sent two game-hours ago
ok(rel(mail) === '2 hr ago', `game-time mail two game-hours old reads "2 hr ago" (got "${rel(mail)}")`);
ok(!/231d/.test(rel(mail)), 'it no longer reads the real-date gap (231d)');
const failure = new Date(REAL_NOW - 5 * 60000).toISOString();         // a real-clock stamp, 5 real minutes old
ok(rel(failure, { real: true }) === '5 min ago', `{ real: true } measures a real-clock stamp on the real clock (got "${rel(failure, { real: true })}")`);
const future = new Date(GAME_NOW + 3600000).toISOString();            // e.g. a stamp just ahead of the clock
ok(rel(future) === 'Just now', 'a stamp ahead of the clock reads "Just now", never a negative age');
Date.now = realDateNow;

// ── the call sites ──
const ct = read('scripts/ui/AdminPanel/tabs/ContactsTab.js');
ok(/g\.sharedFrom\.at, \{ real: true \}/.test(ct) && /_relativeTime\?\.\(at, \{ real: true \}\)/.test(ct), 'Contacts: group-push times (real-clock stamps) ask for the real clock');
ok(/last mail \$\{m\.lastWho\} · \$\{this\.app\._relativeTime\?\.\(m\.lastTs\)/.test(ct), 'Contacts: "last mail" uses the game-clock formatter');
const mt = read('scripts/ui/AdminPanel/tabs/MessagesTab.js');
ok(/_relativeTime\(f\.at, \{ real: true \}\)/.test(mt), 'Messages: delivery failures (real-clock stamps) ask for the real clock');
ok(/isRecent: rawTimestamp > 0 && \(this\._nowMs\(\) - rawTimestamp\)/.test(mt), 'Messages: the "recent" marker compares on the game clock');
ok(/lastActive: unread === 0 \? this\._relativeTime\(messages\[0\]\?\.timestamp\)/.test(app), 'Overview: last active (a message stamp) uses the game clock');
const sec = read('scripts/ui/AdminPanel/tabs/SecurityTab.js');
ok(/Math\.floor\(\(this\._now\(\) - ms\) \/ 1000\)/.test(sec), 'Security: trace / recycle-bin ages use the game clock');

// ── lockouts written on the game clock must be read on it ──
const inbox = read('scripts/ui/ItemInbox/ItemInboxApp.js');
ok(!/lockoutUntil > Date\.now\(\)|lockoutUntil - Date\.now\(\)/.test(inbox), 'shard viewer: lockout countdown is not on the real clock');
const cm = read('scripts/ui/ContactManager/ContactManagerApp.js');
const dh = read('scripts/utils/designHelpers.js');
ok(!/Date\.now\(\) < contact\.breachLockoutUntil|breachLockoutUntil - Date\.now\(\)/.test(cm + dh), 'contact ICE lockout is not compared on the real clock');
ok(/_nowMs\(\) \+ \(10 \* 60 \* 1000\)/.test(read('scripts/services/ContactBreachService.js')), '(the breach lockout really is written on the game clock)');

// ── the panel re-renders when the GAME CLOCK moves (set / advanced / re-provided / world time / Simple Calendar) ──
ok(app.includes("['manualTime', 'disguisedBaseTime', 'disguisedAnchor', 'timeProvider'].includes(leaf)) return this._onGameClock(true)"), 'AdminPanel: a time setting changing re-renders the open tab (forced)');
ok(app.includes('this._worldTimeHook = () => this._onGameClock(false)') && /CLOCK_RERENDER_MS = 60000/.test(app) && app.includes("CLOCK_TABS = Object.freeze(new Set(['overview', 'messages', 'security', 'terminals', 'shards']))"), 'AdminPanel: a ticking clock re-renders only a tab that prints game time, at most once per game minute (it replayed the entrance animations every second)');
ok(app.includes("Hooks.on('updateWorldTime', this._worldTimeHook)") && app.includes("Hooks.on('simple-calendar-date-time-change', this._worldTimeHook)"), 'AdminPanel: world time + Simple Calendar changes re-render');
ok(app.includes("Hooks.off('updateWorldTime', this._worldTimeHook)"), 'AdminPanel: the world-time hooks are removed on close');
{ const ov = read('scripts/ui/AdminPanel/tabs/OverviewTab.js');
  ok(ov.includes('this._clockTimer = setInterval(() => this._tickClocks(), 1000)') && ov.includes('.ncm-ov2-clockcard__t') && ov.includes('data-nl-clock'), 'Overview: the NOW label and the clock card tick every second off the game clock');
  const tick = ov.slice(ov.indexOf('_tickClocks() {'), ov.indexOf('_tickClocks() {') + 400);
  ok(tick.includes('new Date(this._now())') && !tick.includes('Date.now()'), 'Overview: the clock tick reads the GAME clock, not Date.now'); }

// ── the formatter must keep its game-clock source ──
ok(/getCurrentTimeMs/.test(body), '_relativeTime reads timeService.getCurrentTimeMs');

console.log(`test-game-clock: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
