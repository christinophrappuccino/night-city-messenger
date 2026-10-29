// Sim: a terminal login lasts as long as the WINDOW (tester 2026-10-27).
// Before: "unlocked" lived on the item's session record (loggedInAccounts),
// which closing, refreshing, Log out and a GM password change all left alone —
// a player who typed a password once got in forever until Relock.
// Drives the REAL TerminalViewerApp session methods via prototype.call over a
// mocked TerminalService, plus wiring guards.
// Run: node dev/tools/sims/test-terminal-session.mjs
import fs from 'fs';
import { pathToFileURL, fileURLToPath } from 'url';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };
const read = (p) => fs.readFileSync(`${ROOT}/${p}`, 'utf8').replace(/\r\n/g, '\n');

// Foundry surface the module touches at import time
globalThis.foundry = { utils: { mergeObject: (a, b) => ({ ...a, ...b }), deepClone: (o) => JSON.parse(JSON.stringify(o)), hasProperty: () => true, randomID: () => 'r' },
  applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (B) => class extends B {} } } };
globalThis.game = { user: { isGM: false, id: 'u' }, settings: { get: () => undefined }, nightcity: {}, actors: { get: () => null } };
globalThis.Hooks = { on: () => {}, once: () => {}, off: () => {}, call: () => true, callAll: () => {} };
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
globalThis.CONFIG = {}; globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3 } };

let TerminalViewerApp;
try { ({ TerminalViewerApp } = await import(pathToFileURL(`${ROOT}/scripts/ui/Terminal/TerminalViewerApp.js`).href)); }
catch (e) { console.error('import failed:', e.message); }

if (TerminalViewerApp) {
  const P = TerminalViewerApp.prototype;
  const account = { id: 'exec', security: { requiresAuth: true, allowPassword: true, password: 'hunter2' } };
  const openAcct = { id: 'guest', security: { requiresAuth: false } };
  const state = { gmBypassed: false };
  const logouts = [];
  const session = { activeAccountId: 'exec', loggedInAccounts: ['exec'] };
  const svc = {
    getAccount: (_i, id) => (id === 'exec' ? account : id === 'guest' ? openAcct : null),
    getState: () => state,
    getSession: () => session,
    logout: async (_i, actorId, full) => { logouts.push({ actorId, full }); session.activeAccountId = null; if (full) session.loggedInAccounts = []; },
  };
  const v = Object.create(P);
  Object.defineProperty(v, 'terminalService', { get: () => svc });
  v.item = { id: 'term' }; v.actorId = 'pc'; v._unlocked = new Map();
  let entered = null; v._enterState = (s) => { entered = s; };

  // the stored record no longer opens anything
  ok(P._needsAuth.call(v, 'exec') === true, 'a stored "unlocked" record does NOT skip the password');
  ok(P._needsAuth.call(v, 'guest') === false, 'an open account needs no login');
  state.gmBypassed = true;
  ok(P._needsAuth.call(v, 'exec') === false, 'GM force-unlock still opens everything');
  state.gmBypassed = false;

  // unlocked in this window → in, until the credentials change
  v._unlocked.set('exec', P._credKey.call(v, 'exec'));
  ok(P._needsAuth.call(v, 'exec') === false, 'unlocked in this window → straight in (the account switcher still works)');
  account.security.password = 'newpass';
  ok(P._needsAuth.call(v, 'exec') === true, 'GM changes the password → the unlock no longer holds');
  v._unlocked.set('exec', P._credKey.call(v, 'exec'));
  account.security.allowSkillCheck = true;
  ok(P._needsAuth.call(v, 'exec') === true, 'any login-method change re-locks too');

  // ending the session
  v._unlocked.set('exec', P._credKey.call(v, 'exec'));
  v._accountId = 'exec';
  P._endSession.call(v, 'bye');
  ok(v._unlocked.size === 0 && v._accountId === null && entered === 'login' && v._manualError === 'bye', 'end session: everything forgotten, back to login with the reason');
  ok(logouts.at(-1)?.full === true, 'end session clears the stored record (full logout)');

  // a stale record (refresh / closed browser) is cleared; an empty one is not rewritten
  logouts.length = 0;
  session.activeAccountId = 'exec'; session.loggedInAccounts = ['exec'];
  P._clearStoredSession.call(v);
  ok(logouts.length === 1 && logouts[0].full, 'a leftover record is cleared on open');
  logouts.length = 0;
  P._clearStoredSession.call(v);
  ok(logouts.length === 0, 'an empty record is not rewritten (no write spam)');
}

// ── wiring ──
const src = read('scripts/ui/Terminal/TerminalViewerApp.js');
ok(!/terminalService\.requiresAuth\(/.test(src), 'no login path consults the stored record any more');
ok((src.match(/this\._needsAuth\(id\)/g) || []).length === 3, 'select / focus / switch all ask the window');
ok(/this\._unlocked\.set\(accountId, this\._credKey\(accountId\)\);\n\s*await this\.terminalService\.recordLoginSuccess/.test(src), 'a login remembers the credentials it beat');
ok(/async close\(options\) \{\n\s*\/\/[^\n]*\n\s*this\._unlocked\.clear\(\);\n\s*this\._clearStoredSession\(\);/.test(src), 'closing the window ends the session');
ok(/async _onLogout\(\) \{[\s\S]{0,160}this\._endSession\(''\);/.test(src), 'Log out ends the whole session');
ok(/this\._needsAuth\(this\._accountId\)\) \{\n\s*this\._endSession\('CREDENTIALS CHANGED/.test(src), 'a credential change kicks an open session back to login');
ok(/if \(this\.actorId !== prev\) \{\n\s*this\._unlocked\.clear\(\);/.test(src), 'switching operator forgets the previous character\'s unlocks');
ok(/forceLogout\([^)]*\) \{\n\s*const lockedAcct = this\._accountId;\n\s*this\._unlocked\.clear\(\);/.test(src), 'a forced lockout forgets the unlocks too');

console.log(`test-terminal-session: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
