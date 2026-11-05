// Sim: terminal relays are checked against the sender (audit remediation A3c: SEC-06).
//
// TERMINAL_EXFIL_REQUEST could wipe any file on any terminal and copy files into anyone's
// inbox; TERMINAL_SESSION_REQUEST could write any character's session; TERMINAL_NET_REQUEST
// could switch any terminal's uplink; TERMINAL_RESIDENT_REQUEST could plant anything, as anyone.
// Now the GM checks, from the machine's own state:
//   - exfil: the sender's character is IN that account (its session, or an admin account that
//     may view it); the files are that account's and visible to it; the entry's own policy
//     allows the action; copies go to the sender's own character; a burn goes onto something
//     they carry that can take a file; a forward goes out as their own character;
//   - session: their own character, a terminal they can reach, session fields naming real accounts;
//   - uplink: switching allowed, a terminal they can reach;
//   - residents: a terminal they can reach, planted by their own character, a verb a player can
//     author, known trigger and accounts, clamped numbers; a defuse needs an armed program.
import fs from 'fs';
import { pathToFileURL, fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const load = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
const read = (p) => fs.readFileSync(`${ROOT}/${p}`, 'utf8');
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };
const MOD = 'night-city-messenger';

const clone = (o) => (o === undefined ? o : JSON.parse(JSON.stringify(o)));
const merge = (a, b) => {
  const out = clone(a) ?? {};
  for (const [k, v] of Object.entries(b || {})) out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k]) ? merge(out[k], v) : clone(v);
  return out;
};
const users = { gm: { id: 'gm', name: 'GM', isGM: true }, p1: { id: 'p1', name: 'Rache', isGM: false }, p2: { id: 'p2', name: 'Kaz', isGM: false } };
const actor = (id, owner, extra = {}) => ({ id, name: id, hasPlayerOwner: true, testUserPermission: (u) => !!u.isGM || u.id === owner, getFlag: (m, k) => (k === 'email' ? `${id}@nc` : null), items: new Map(), ...extra });
const actors = { a1: actor('a1', 'p1'), a2: actor('a2', 'p2') };
const chip = { id: 'chip', name: 'Blank chip', type: 'gear', parent: actors.a1, getFlag: (m, k) => (k === 'isDataShard' ? true : null) };
const gun = { id: 'gun', name: 'Pistol', type: 'weapon', parent: actors.a1, getFlag: () => null };
const theirChip = { id: 'chip2', name: 'Their chip', type: 'gear', parent: actors.a2, getFlag: (m, k) => (k === 'isDataShard' ? true : null) };
actors.a1.items.set('chip', chip); actors.a1.items.set('gun', gun); actors.a2.items.set('chip2', theirChip);

const page = (messageId, accountId, extra = {}) => ({ flags: { [MOD]: { messageId, accountId, ...extra } } });
const journal = { id: 'jt', pages: { contents: [page('m-ops', 'ops'), page('m-ops2', 'ops'), page('m-boss', 'boss'), page('m-secret', 'ops', { file: { path: 'secure' }, envelope: 'file' }), page('m-shared', '__shared__')] } };
let config = {
  allowExfil: true,
  accounts: [{ id: 'ops', username: 'ops' }, { id: 'boss', username: 'boss' }, { id: 'root', username: 'root', isAdmin: true }],
  exfil: { wipe: { allow: true } },
  connection: { allowPlayerSwitching: true },
  files: { folders: [{ id: 'f1', scope: 'ops', path: 'secure', gate: { mode: 'admin' } }] },
};
let state = { sessions: { a1: { loggedInAccounts: ['ops'], activeAccountId: 'ops' } } };
let reachable = true;
const terminal = {
  id: 'term', uuid: 'Item.term', name: 'WS-7F',
  testUserPermission: () => reachable,
  getFlag: (m, k) => ({ isTerminal: true, terminalConfig: config, terminalState: state, journalId: 'jt' })[k] ?? null,
};
globalThis.game = {
  user: users.gm,
  users: { get: (id) => users[id] ?? null, activeGM: users.gm, filter: (fn) => Object.values(users).filter(fn) },
  actors: Object.assign(Object.values(actors), { get: (id) => actors[id] ?? null }),
  items: { get: () => null },
  journal: { get: (id) => (id === 'jt' ? journal : null), contents: [], [Symbol.iterator]: () => [][Symbol.iterator]() },
  scenes: [], messages: [], macros: [],
  settings: { get: () => undefined },
  i18n: { localize: (s) => s },
  nightcity: { messageRepository: { _pageToMessage: (p) => ({ messageId: p.flags[MOD].messageId, contentType: 'message', timestamp: '2045-01-01T00:00:00Z', ...p.flags[MOD] }) }, settingsManager: { getEncoderConfigRaw: () => ({}) } },
};
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 } };
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
globalThis.Hooks = { on() {}, off() {}, once() {}, call() {}, callAll() {} };
globalThis.CONFIG = {};
globalThis.foundry = { utils: { deepClone: clone, mergeObject: (a, b) => merge(a, b), randomID: () => 'rid', getProperty: (o, p) => p.split('.').reduce((x, k) => x?.[k], o) }, applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (B) => B }, instances: new Map() } };
globalThis.fromUuidSync = (u) => (u === terminal.uuid ? terminal : null);
globalThis.fromUuid = async (u) => globalThis.fromUuidSync(u);

const { TerminalService } = await load('scripts/services/TerminalService.js');
const svc = Object.create(TerminalService.prototype);
svc.isContentVisible = () => true;
const ex = (d, sender = 'p1') => svc.checkExfilRequest({ itemUuid: terminal.uuid, accountId: 'ops', messageIds: ['m-ops'], dest: 'inbox', targetActorId: 'a1', ...d }, sender);

// ═══ 1. Exfil ═══
ok(ex({}).ok, 'a copy of a file in the account they are in, to their own character');
ok(!ex({}, 'p2').ok, 'a sender whose character is not in that account is refused');
ok(!ex({}, null).ok, 'no verified sender: refused');
ok(!ex({ accountId: 'boss', messageIds: ['m-boss'] }).ok, 'an account they never logged into is refused');
ok(!ex({ targetActorId: 'a2' }).ok, "a copy into someone else's inbox is refused");
const w = ex({ dest: 'wipe', messageIds: ['m-ops', 'm-boss', 'nope', 'm-ops'] });
ok(w.ok && JSON.stringify(w.ids) === '["m-ops"]', 'a wipe only touches files of that account (others dropped, de-duplicated)');
ok(!ex({ dest: 'wipe', messageIds: ['m-boss'] }).ok, 'a wipe of another account\'s file alone is refused');
ok(!ex({ messageIds: ['m-secret'] }).ok, 'a file in a folder the account cannot open is not theirs to take');
ok(ex({ messageIds: ['m-shared'] }).ok, 'a file on the shared volume is in every account');
config = merge(config, { exfil: { agent: { allow: false } } });
ok(!ex({}).ok, 'the terminal\'s policy turned the action off: refused');
config.exfil.agent.allow = true;
config.allowExfil = false;
ok(!ex({}).ok && !ex({ dest: 'wipe' }).ok, 'exfil switched off on the box: nothing leaves');
config.allowExfil = true;
ok(!ex({ dest: 'teleport' }).ok, 'an unknown exfil kind is refused');
const fw = ex({ dest: 'forward', targetActorId: 'a2', forwarder: { email: 'boss@arasaka', actorId: 'a2' } });
ok(fw.ok && fw.forwarder.actorId === 'a1' && fw.forwarder.email === 'a1@nc', 'a forward goes out as the sender\'s own character, whatever the request says');
ok(ex({ dest: 'shard', targetItemId: 'chip' }).ok, 'a burn onto a shard they carry');
ok(!ex({ dest: 'shard', targetItemId: 'chip2' }).ok, 'a burn onto someone else\'s shard is refused');
ok(!ex({ dest: 'shard', targetItemId: 'gun' }).ok, 'a burn onto a weapon (not a blank) is refused');
// admin view: logged into root, viewing ops
state = { sessions: { a1: { loggedInAccounts: ['root'], activeAccountId: 'root' } } };
ok(ex({ messageIds: ['m-secret'] }).ok, 'an admin viewing the account may take it (admins open every folder)');
config.adminAccess = { rights: 'read' };
ok(!ex({ dest: 'wipe' }).ok && ex({}).ok, 'read-only admin access: no wipe, but a copy is fine');
delete config.adminAccess;
state = { sessions: { a1: { loggedInAccounts: ['ops'], activeAccountId: 'ops' } } };

// ═══ 2. Session ═══
const se = (d, sender = 'p1') => svc.checkSessionRequest({ itemUuid: terminal.uuid, actorId: 'a1', ...d }, sender);
const s1 = se({ updates: { loggedInAccounts: ['ops', 'boss', 'ghost'], activeAccountId: 'boss', firstAccessedAt: '2045-01-01', gmBypassed: true } });
ok(s1.ok && JSON.stringify(s1.updates) === '{"loggedInAccounts":["ops","boss"],"activeAccountId":"boss","firstAccessedAt":"2045-01-01"}', 'a login writes session fields naming real accounts only (no gmBypassed)');
ok(!se({ actorId: 'a2', updates: { activeAccountId: null } }).ok, "a session for someone else's character is refused");
ok(!se({ updates: { activeAccountId: 'boss' } }).ok, 'an active account that is not logged in is refused');
ok(se({ updates: { activeAccountId: null } }).ok, 'a logout is fine');
reachable = false;
ok(!se({ updates: { activeAccountId: null } }).ok, 'a terminal the sender has no way into is refused');
reachable = true;

// ═══ 3. Uplink ═══
ok(svc.checkUplinkRequest({ itemUuid: terminal.uuid }, 'p1').ok, 'a switch on a box that allows it, by someone who can reach it');
config.connection.allowPlayerSwitching = false;
ok(!svc.checkUplinkRequest({ itemUuid: terminal.uuid }, 'p1').ok, 'switching off: refused');
config.connection.allowPlayerSwitching = true;
reachable = false;
ok(!svc.checkUplinkRequest({ itemUuid: terminal.uuid }, 'p1').ok, 'no way in: refused');
reachable = true;

// ═══ 4. Residents ═══
const UF = await load('scripts/ui/content/UploadFlow.js');
const term = { getConfig: () => config };
const res = (r, sender = 'p1') => UF.sanitizeResidentRequest({ effectType: 'plant', params: { accountId: 'ops' }, trigger: { kind: 'onLogin', accountId: 'ops' }, provenance: { plantedBy: 'a1', forgeQuality: 70 }, stealthDV: 14, ...r }, sender, terminal, term);
ok(res({}).ok, 'a plant by their own character, aimed at a real mailbox');
ok(!res({ provenance: { plantedBy: 'a2' } }).ok, 'planted in someone else\'s name: refused');
ok(!res({ effectType: 'logicBomb' }).ok && !res({ effectType: 'wipe' }).ok, 'a verb a player cannot leave behind: refused');
ok(!res({ trigger: { kind: 'onEverything' } }).ok, 'an unknown trigger: refused');
ok(!res({ params: { accountId: 'nobody' } }).ok && !res({ trigger: { kind: 'onLogin', accountId: 'nobody' } }).ok, 'an account the terminal does not have: refused');
const clamped = res({ stealthDV: 999, provenance: { plantedBy: 'a1', forgeQuality: 500 }, params: { accountId: 'ops', macroId: 'm' } });
ok(clamped.value.stealthDV === 30 && clamped.value.provenance.forgeQuality === 100 && !('macroId' in clamped.value.params), 'numbers are clamped, macro links dropped');
ok(!('id' in clamped.value) && !('state' in clamped.value), 'id and state are the installer\'s, never the request\'s');

// ═══ 5. Wiring ═══
const sh = read('scripts/integrations/SocketHandlers.js');
const block = (op) => { const i = sh.indexOf(`register(SOCKET_OPS.${op}`); return sh.slice(i, sh.indexOf('socketManager.register(', i + 30)); };
ok(/checkExfilRequest\(data, sender\)/.test(block('TERMINAL_EXFIL_REQUEST')) && /userId: sender/.test(block('TERMINAL_EXFIL_REQUEST')), 'exfil: checked, and the result goes to the real sender');
ok(!/svc\.exfil\w+\([^)]*messageIds/.test(block('TERMINAL_EXFIL_REQUEST')), 'exfil: only the checked ids reach the service');
ok(/checkUplinkRequest\(data, sender\)/.test(block('TERMINAL_NET_REQUEST')), 'uplink: checked');
ok(/checkSessionRequest\(data, sender\)/.test(block('TERMINAL_SESSION_REQUEST')) && /ok\.updates/.test(block('TERMINAL_SESSION_REQUEST')), 'session: checked, cleaned fields only');
ok(/handleResidentRequest\(data, sender\)/.test(block('TERMINAL_RESIDENT_REQUEST')), 'residents: the handler gets the sender');
const uf = read('scripts/ui/content/UploadFlow.js');
ok(/userCanReachItem\(senderId, item, 'terminal'\)/.test(uf) && /state === 'armed'/.test(uf), 'a defuse needs a way in and an armed program');

console.log(`test-terminal-relays: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
