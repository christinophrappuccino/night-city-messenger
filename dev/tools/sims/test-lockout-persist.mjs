// Sim: security lockouts and tries survive a reload (audit remediation D3: DATA-05).
//
// Who is locked out of what, and the tries used, lived only in each browser's memory: F5 gave a locked-out player a
// clean slate, a GM reload lost forced lockouts, a player offline during a forced lockout never got it. Now the active
// GM keeps them in the world setting `securityLockouts`; every client reads it.
// Two REAL SecurityService instances (GM + player) over a scripted socket and ONE fake world-settings store whose
// writes fire updateSetting on every client, like Foundry's. "Reloading" = a fresh instance.
import { pathToFileURL, fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const load = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
const read = (p) => readFileSync(`${ROOT}/${p}`, 'utf8');
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };
const MOD = 'night-city-messenger';
const flush = () => new Promise((r) => setTimeout(r, 25));

// ═══ 1. The rules ═══
const R = await load('scripts/utils/lockoutRecord.js');
{
  const now = 1000;
  const live = { attempts: 3, maxAttempts: 3, lockoutUntil: 5000, at: 1 };
  ok(R.mergeReport(live, { attempts: 0, lockoutUntil: null }, now).lockoutUntil === 5000, 'a report cannot end a running lockout early');
  ok(R.mergeReport(live, { attempts: 0 }, now).attempts === 3, '…nor lower the tries under it');
  ok(R.mergeReport(null, { attempts: 2, maxAttempts: 3 }, now).attempts === 2, 'a report adds tries');
  ok(R.mergeReport({ attempts: 2 }, { attempts: 0 }, now) === null, 'a success (no lockout running) clears the saved entry');
  ok(R.isSpent({ attempts: 3, lockoutUntil: 900 }, now) && !R.isSpent(live, now), 'an expired lockout is spent (its tries reset with it)');
  ok(Object.keys(R.prune({ 'a::t': live, 'b::t': { attempts: 0 }, junk: live }, now)).join() === 'a::t', 'prune drops spent and malformed entries');
}

// ── a two-client world ──
let NOW = 1_000_000;
const hooks = {};
const store = new Map();
const writers = [];
const GM = { id: 'gm', name: 'GM', isGM: true }, PL = { id: 'u1', name: 'Rache', isGM: false }, OTHER = { id: 'u2', name: 'Kerry', isGM: false };
const actors = { aV: { id: 'aV', name: 'V', ownership: { u1: 3 } }, aK: { id: 'aK', name: 'Kerry', ownership: { u2: 3 } } };
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3 } };
globalThis.Hooks = { on: (n, fn) => { (hooks[n] ||= []).push(fn); return hooks[n].length; }, off() {}, once() {}, callAll: (n, ...a) => (hooks[n] || []).forEach((f) => f(...a)) };
globalThis.game = {
  user: GM,
  users: Object.assign([GM, PL, OTHER], { get: (id) => ({ gm: GM, u1: PL, u2: OTHER })[id] || null, activeGM: GM }),
  actors: Object.assign(Object.values(actors), { get: (id) => actors[id] || null }),
  settings: {
    get: (m, k) => JSON.parse(JSON.stringify(store.get(k) ?? {})),
    async set(m, k, v) { writers.push(game.user.id); store.set(k, JSON.parse(JSON.stringify(v))); Hooks.callAll(store.has(`_made_${k}`) ? 'updateSetting' : 'createSetting', { key: `${MOD}.${k}` }); store.set(`_made_${k}`, 1); },
  },
  nightcity: { eventBus: { emit() {} }, timeService: { getCurrentTimeMs: () => NOW } },
};
globalThis.foundry = { utils: { deepClone: (o) => JSON.parse(JSON.stringify(o)) }, applications: { instances: new Map() } };
globalThis.ui = { windows: {}, notifications: { info() {}, warn() {}, error() {} } };

const { SecurityService } = await load('scripts/services/SecurityService.js');
const { SOCKET_OPS } = await load('scripts/utils/constants.js');
const as = (u, fn) => { const was = game.user; game.user = u; try { return fn(); } finally { game.user = was; } };
const clients = {};
game.nightcity.socketManager = {
  emit(op, data) {
    const from = game.user, toGm = !from.isGM;
    const target = toGm ? clients.gm : clients.pl;
    if (!target) return;
    as(toGm ? GM : PL, () => {
      if (op === SOCKET_OPS.SECURITY_REPORT && toGm) target.receiveReport(JSON.parse(JSON.stringify(data)), from.id);
      if (op === SOCKET_OPS.SECURITY_CLEAR && !toGm) target.receiveClear(data);
      if (op === SOCKET_OPS.SECURITY_LOCKOUT && !toGm) target.receiveForcedLockout(data);
    });
  },
};
const boot = (who) => as(who === 'gm' ? GM : PL, () => (clients[who] = new SecurityService()));
boot('gm'); boot('pl');
const T = 'term1::acct';

// ═══ 2. Tries survive a reload ═══
as(PL, () => { clients.pl.initTracking('aV', T, { maxAttempts: 3, lockoutDuration: 600000 }); clients.pl.recordFailedAttempt('aV', T); clients.pl.recordFailedAttempt('aV', T); });
await flush();
ok(store.get('securityLockouts')?.['aV::term1::acct']?.attempts === 2, 'two misses are saved by the GM');
ok(writers.every((id) => id === 'gm'), 'only the GM writes the saved list');
boot('pl');   // the player presses F5
as(PL, () => clients.pl.initTracking('aV', T, { maxAttempts: 3, lockoutDuration: 600000 }));
ok(as(PL, () => clients.pl.getRemainingAttempts('aV', T)) === 1, 'after a reload the player still has 1 try left, not 3');

// ═══ 3. A lockout survives a reload, and cannot be talked away ═══
as(PL, () => clients.pl.recordFailedAttempt('aV', T));
await flush();
boot('pl');
ok(as(PL, () => clients.pl.isLockedOut('aV', T)), 'a locked-out player who reloads is still locked out');
as(PL, () => clients.gm && game.nightcity.socketManager.emit(SOCKET_OPS.SECURITY_REPORT, { actorId: 'aV', targetId: T, attempts: 0, lockoutUntil: null }));
await flush();
ok(store.get('securityLockouts')['aV::term1::acct'].lockoutUntil === NOW + 600000, 'a forged "I succeeded" report does not end the saved lockout');
as(OTHER, () => game.nightcity.socketManager.emit(SOCKET_OPS.SECURITY_REPORT, { actorId: 'aV', targetId: 'net9', attempts: 5, lockoutUntil: NOW + 9e9 }));
await flush();
ok(!store.get('securityLockouts')['aV::net9'], 'a player cannot report tries for someone else\'s character');

// ═══ 4. Forced lockouts: survive a GM reload, reach a player who was offline ═══
const savedPl = clients.pl; clients.pl = null;   // the player is offline
as(GM, () => clients.gm.forceLockoutMany('aV', ['node::n1'], { durationMs: 300000, reason: 'heat BURNED', label: 'Relay' }));
await flush();
boot('gm');   // the GM reloads
ok(as(GM, () => clients.gm.getKnownState('aV', 'node::n1'))?.forced === true, 'a GM-forced lockout survives the GM\'s reload, with its reason');
boot('pl');   // the player comes online later
ok(as(PL, () => clients.pl.isLockedOut('aV', 'node::n1')), 'a player who was offline gets the forced lockout when they join');
void savedPl;

// ═══ 5. A GM clear clears it everywhere, for good ═══
as(GM, () => clients.gm.clearFor('aV', [T, 'node::n1']));
await flush();
ok(!store.get('securityLockouts')['aV::term1::acct'] && !store.get('securityLockouts')['aV::node::n1'], 'a GM clear removes the saved entries');
boot('pl');
ok(as(PL, () => !clients.pl.isLockedOut('aV', T) && !clients.pl.isLockedOut('aV', 'node::n1')), 'and the player stays unlocked after a reload');

// ═══ 6. Expiry on the game clock ═══
as(GM, () => clients.gm.forceLockoutMany('aV', ['shard::s1'], { durationMs: 60000 }));
await flush();
NOW += 61000;
boot('pl');
ok(as(PL, () => !clients.pl.isLockedOut('aV', 'shard::s1')), 'an expired lockout does not come back on a reload');
as(GM, () => clients.gm.isLockedOut('aV', 'shard::s1'));   // the GM notices it expired
await flush();
ok(!store.get('securityLockouts')['aV::shard::s1'], 'and the GM drops it from the saved list');

// ═══ 7. No GM online: kept locally, saved when a GM connects ═══
game.users.activeGM = null;
const gm = clients.gm; clients.gm = null;
as(PL, () => { clients.pl.initTracking('aV', 'net2', { maxAttempts: 3 }); clients.pl.recordFailedAttempt('aV', 'net2'); });
await flush();
ok(!store.get('securityLockouts')['aV::net2'] && as(PL, () => clients.pl.getRemainingAttempts('aV', 'net2')) === 2, 'with no GM online the miss counts locally and nothing is saved');
game.users.activeGM = GM; clients.gm = gm;
as(PL, () => clients.pl._resyncToGM());   // what the userConnected hook runs (after a short wait)
await flush();
ok(store.get('securityLockouts')['aV::net2']?.attempts === 1, 'when a GM connects, the player\'s client reports it and the GM saves it');

// ═══ 8. Wiring ═══
const sh = read('scripts/integrations/SocketHandlers.js');
for (const op of ['SECURITY_LOCKOUT', 'SECURITY_CLEAR', 'TERMINAL_KICK']) {
  ok(new RegExp(`SOCKET_OPS\\.${op}, \\(data, sender\\) => \\{\\s*if \\(!isFromGM\\(sender\\)\\) return;`).test(sh), `${op} is only accepted from a GM`);
}
ok(/register\(MODULE_ID, 'securityLockouts'/.test(read('scripts/core/SettingsManager.js')), 'the setting is registered');

console.log(`test-lockout-persist: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
