// Sim: the GM directory reloads on every client (audit remediation D2: DATA-07).
//
// MasterContactService read the masterContacts setting once, at start-up. When the GM added or edited a directory
// entry, players kept checking addresses, send-only rules and names against the old list until they reloaded, and a
// second GM saved its old list over the first GM's additions. Now the setting change re-reads the list on every
// client — also for the very FIRST save (Foundry fires createSetting, not updateSetting, for that).
// Drives the REAL MasterContactService + DocumentSyncBridge over a fake settings store and fake Hooks.
import { pathToFileURL, fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const load = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };
const MOD = 'night-city-messenger';

const hooks = {};
const store = new Map();
let writes = 0;
const PLAYER = { id: 'p', isGM: false }, GM = { id: 'gm', isGM: true };
globalThis.Hooks = { on: (n, fn) => { (hooks[n] ||= []).push(fn); return hooks[n].length; }, off() {}, once() {}, callAll: (n, ...a) => (hooks[n] || []).forEach((f) => f(...a)) };
const events = [];
globalThis.game = {
  user: PLAYER,
  users: { activeGM: GM, get: () => null, find: () => null },
  actors: Object.assign([], { get: () => null }),
  settings: { get: () => undefined },
  nightcity: {
    settingsManager: { get: (k) => JSON.parse(JSON.stringify(store.get(k) ?? null)), set: async (k, v) => { writes += 1; store.set(k, v); } },
    eventBus: { emit: (e, d) => events.push([e, d]) },
  },
};
globalThis.foundry = { utils: { deepClone: (o) => JSON.parse(JSON.stringify(o)), randomID: () => 'r' } };
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };

const { MasterContactService } = await load('scripts/services/MasterContactService.js');
const { DocumentSyncBridge } = await load('scripts/integrations/DocumentSyncBridge.js');
const { EVENTS } = await load('scripts/utils/constants.js');

const contact = (id, email, extra = {}) => ({ id, name: id, email, role: '', folder: '', relationships: {}, trust: 0, location: '', ...extra });
store.set('masterContacts', [contact('rogue', 'rogue@afterlife.nc')]);
const mcs = new MasterContactService();
mcs.initialize();
game.nightcity.masterContactService = mcs;
DocumentSyncBridge.register(game.nightcity.eventBus);

// ═══ 1. The GM adds an entry on another client: this client sees it ═══
ok(!mcs.getByEmail?.('judy@mox.nc'), 'before: Judy is not in this client\'s directory');
store.set('masterContacts', [contact('rogue', 'rogue@afterlife.nc'), contact('judy', 'judy@mox.nc')]);
const before = events.length;
Hooks.callAll('updateSetting', { key: `${MOD}.masterContacts` }, {}, {}, 'gm');
ok(!!mcs.getByEmail?.('judy@mox.nc'), 'after the setting changes, the new entry is there without a reload');
ok(events.slice(before).some(([e]) => e === (EVENTS.CONTACT_UPDATED ?? 'contact:updated')), 'and "contacts updated" still fires (after the list was re-read)');
// a send-only flag set by the GM is enforced at once
store.set('masterContacts', [contact('rogue', 'rogue@afterlife.nc', { sendOnly: true }), contact('judy', 'judy@mox.nc')]);
Hooks.callAll('updateSetting', { key: `${MOD}.masterContacts` });
ok(mcs.isSendOnly?.('rogue@afterlife.nc') === true, 'a send-only flag the GM just set applies here at once');

// ═══ 2. The very first save (createSetting) is caught too ═══
store.set('masterContacts', [contact('rogue', 'rogue@afterlife.nc'), contact('panam', 'panam@aldecaldo.nc')]);
Hooks.callAll('createSetting', { key: `${MOD}.masterContacts` });
ok(!!mcs.getByEmail?.('panam@aldecaldo.nc'), 'the first-ever save of the directory reaches other clients');
Hooks.callAll('createSetting', { key: `${MOD}.somethingElse` });
ok(true, 'another setting\'s first save is not routed here');

// ═══ 3. A re-read never writes from a player; the active GM saves a schema touch-up once ═══
writes = 0;
store.set('masterContacts', [{ id: 'old', name: 'Old', email: 'old@x', type: 'fixer' }]);   // an old-schema entry
Hooks.callAll('updateSetting', { key: `${MOD}.masterContacts` });
ok(writes === 0 && mcs.getContact?.('old')?.role === 'fixer', 'a player re-reads and upgrades its copy in memory, and writes nothing');
game.user = GM;
Hooks.callAll('updateSetting', { key: `${MOD}.masterContacts` });
await new Promise((r) => setTimeout(r, 5));
ok(writes === 1, 'the active GM saves the touch-up once');
const w = writes;
Hooks.callAll('updateSetting', { key: `${MOD}.masterContacts` });   // the GM's own save echoes back
await new Promise((r) => setTimeout(r, 5));
ok(writes === w, '…and its own echo does not save again (no loop)');

console.log(`test-directory-reload: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
