// Sim: TerminalService login footprints + MessageRepository.pickLatestFor
// Drives the REAL methods via prototype.call with mocked globals.
import { pathToFileURL } from 'url';

const MOD = 'night-city-messenger';
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };

// ── Minimal Foundry globals ──
globalThis.game = {
  actors: new Map([['a1', { name: 'V' }], ['a2', { name: 'Panam' }]]),
  nightcity: { timeService: { getCurrentTime: () => '2077-01-01T12:00:00Z' } },
};
game.actors.get = Map.prototype.get.bind(new Map([['a1', { name: 'V' }], ['a2', { name: 'Panam' }]]));
globalThis.foundry = { utils: { deepClone: (o) => JSON.parse(JSON.stringify(o)) } };
globalThis.Hooks = { on: () => {}, once: () => {}, off: () => {} };
globalThis.ui = { notifications: { info: () => {}, warn: () => {}, error: () => {} } };

const { TerminalService } = await import(pathToFileURL('C:/Users/cphan/AppData/Local/FoundryVTT/Data/modules/night-city-messenger/scripts/services/TerminalService.js').href);
const { MessageRepository } = await import(pathToFileURL('C:/Users/cphan/AppData/Local/FoundryVTT/Data/modules/night-city-messenger/scripts/data/MessageRepository.js').href);

// Fake service context: only what _appendLoginLog / getLastLogin touch.
const state = { sessions: {}, loginLog: undefined };
const item = { id: 'itm1' };
const svc = {
  getState: () => state,
  getAccount: (i, id) => ({ acct1: { username: 'sysadmin' }, acct2: { username: 'guest' } })[id],
};

// 1) First append creates the list with one entry.
state.loginLog = TerminalService.prototype._appendLoginLog.call(svc, state.loginLog, item, 'acct1', 'a1');
ok(state.loginLog.length === 1, 'first append → 1 entry');
ok(state.loginLog[0].username === 'sysadmin', 'entry resolves the username');
ok(state.loginLog[0].operatorName === 'V', 'entry resolves the operator name');
ok(state.loginLog[0].ts === '2077-01-01T12:00:00Z', 'ts from the time provider');

// 2) Appends accumulate, newest last.
state.loginLog = TerminalService.prototype._appendLoginLog.call(svc, state.loginLog, item, 'acct2', 'a2');
ok(state.loginLog.length === 2 && state.loginLog[1].accountId === 'acct2', 'appends accumulate');

// 3) getLastLogin finds the newest entry FOR THAT ACCOUNT.
state.loginLog = TerminalService.prototype._appendLoginLog.call(svc, state.loginLog, item, 'acct1', 'a2');
const last1 = TerminalService.prototype.getLastLogin.call(svc, item, 'acct1');
ok(last1?.operatorName === 'Panam', 'getLastLogin → newest for the account');
ok(TerminalService.prototype.getLastLogin.call(svc, item, 'nope') === null, 'unknown account → null');

// 4) Cap: 60 appends keep only the newest LOGIN_LOG_CAP.
let lg = [];
for (let i = 0; i < 60; i++) lg = TerminalService.prototype._appendLoginLog.call(svc, lg, item, 'acct1', 'a1');
ok(lg.length === TerminalService.LOGIN_LOG_CAP, `cap holds at ${TerminalService.LOGIN_LOG_CAP}`);

// 5) Unknown account id degrades to the id, missing actor to ''.
const lg2 = TerminalService.prototype._appendLoginLog.call(svc, [], item, 'ghost', 'missing');
ok(lg2[0].username === 'ghost' && lg2[0].operatorName === '', 'unknown account/actor degrade cleanly');

// ── pickLatestFor ──
const mk = (ts) => ({ timestamp: ts, subject: ts });
const index = {
  byEmail: new Map([['v@net.nc', mk('2077-01-03T00:00:00Z')]]),
  byActorId: new Map([['a9', mk('2077-01-05T00:00:00Z')]]),
  byContactId: new Map([['mc1', mk('2077-01-04T00:00:00Z')]]),
};
ok(MessageRepository.pickLatestFor(index, { email: 'V@Net.nc' })?.timestamp === '2077-01-03T00:00:00Z', 'email match is case-insensitive');
ok(MessageRepository.pickLatestFor(index, { email: 'v@net.nc', actorId: 'a9', masterContactId: 'mc1' })?.timestamp === '2077-01-05T00:00:00Z', 'newest wins across keys');
ok(MessageRepository.pickLatestFor(index, { email: 'nobody@x' }) === null, 'no match → null');
ok(MessageRepository.pickLatestFor(null, { email: 'x' }) === null, 'null index → null');

console.log(`${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
