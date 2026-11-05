// Sim: shard relays are checked against the sender (audit remediation A3b: SEC-05).
//
// SHARD_STATE_REQUEST, SHARD_INTEGRITY_REQUEST, SHARD_CONVERT_REQUEST and SHARD_UNCONVERT_REQUEST
// used to act on any shard named by UUID: wipe it, unlock it, repair or salvage it, write any
// character's session, convert or unconvert any item. Now:
//   - state / integrity: the sender must be able to REACH the shard (scripts/utils/shardAccess.js),
//     a session write is for a character they own and only sets session fields, a wipe only happens
//     on a shard that self-destructs, a failed breach takes the configured hit, a repair the
//     configured points, a reconstruct moves an entry one step its roll allows;
//   - convert / unconvert: their own character, and the world must let that character write shards
//     (canEncode judged for the SENDER, not for the GM's client).
import fs from 'fs';
import { pathToFileURL, fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const load = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
const read = (p) => fs.readFileSync(`${ROOT}/${p}`, 'utf8');
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };
const MOD = 'night-city-messenger';

// ── a small world ──
const users = { gm: { id: 'gm', name: 'GM', isGM: true }, p1: { id: 'p1', name: 'Rache', isGM: false }, p2: { id: 'p2', name: 'Kaz', isGM: false } };
const coll = (arr) => Object.assign([...arr], { contents: arr });
const doc = (flags, extra = {}) => ({ flags: { [MOD]: flags }, getFlag: (m, k) => flags[k], ...extra });
const world = { journals: [], scenes: [], messages: [], macros: [] };
let encoderEnabled = true;
globalThis.game = {
  user: users.gm,
  users: { get: (id) => users[id] ?? null, activeGM: users.gm, filter: (fn) => Object.values(users).filter(fn), find: (fn) => Object.values(users).find(fn) },
  get journal() { return coll(world.journals); },
  get scenes() { return coll(world.scenes); },
  get messages() { return coll(world.messages); },
  get macros() { return coll(world.macros); },
  actors: { get: () => null },
  settings: { get: (m, k) => (k === 'encoderConfig' ? { enabled: encoderEnabled } : undefined) },
  i18n: { localize: (s) => s },
  nightcity: { eventBus: { emit() {} }, soundService: { play() {} } },
};
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 } };
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
globalThis.Hooks = { on() {}, off() {}, once() {}, call() {}, callAll() {} };
globalThis.CONFIG = {};
globalThis.foundry = { utils: { deepClone: (o) => JSON.parse(JSON.stringify(o)), mergeObject: (a, b) => ({ ...a, ...b }), randomID: () => 'rid' }, applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (B) => B }, instances: new Map() } };

const SA = await load('scripts/utils/shardAccess.js');
// a world shard nobody has rights on (left at None, the attachment design)
const shard = { id: 'sh1', uuid: 'Item.sh1', name: 'Blackmail chip', parent: null, testUserPermission: () => false };
const reach = (u) => SA.userCanReachShard(u, shard);

// ═══ 1. Who can reach a shard ═══
ok(!reach('p1'), 'a world shard with no way in: unreachable');
ok(reach('gm'), 'the GM always');
ok(!reach(null) && !reach('nobody'), 'no or unknown sender: unreachable');
ok(SA.userCanReachShard('p1', { ...shard, testUserPermission: (u, lvl) => u.id === 'p1' && lvl <= 1 }), 'Limited permission on the item: reachable');
const myActor = { documentName: 'Actor', testUserPermission: (u) => u.id === 'p1' };
ok(SA.userCanReachShard('p1', { ...shard, uuid: 'Actor.a1.Item.sh2', parent: myActor }) && !SA.userCanReachShard('p2', { ...shard, uuid: 'Actor.a1.Item.sh2', parent: myActor }), 'in the gear of a character they own: reachable; someone else: not');

const page = (atts, readers, text = '') => doc({ attachments: atts }, { text: { content: text }, testUserPermission: (u) => readers.includes(u.id) });
world.journals = [{ pages: coll([page([{ itemUuid: 'Item.sh1' }], ['p2'])]) }];
ok(!reach('p1') && reach('p2'), 'attached to a message: only whoever can read that message');
world.journals = [{ pages: coll([page([{ itemId: 'sh1' }], ['p1'])]) }];
ok(reach('p1'), 'an older attachment that only stored the item id still counts (world item)');
world.journals = [];

world.scenes = [{ notes: coll([doc({ accessUuid: 'Item.sh1', accessHidden: true })]), regions: coll([]) }];
ok(!reach('p1'), 'a hidden map pin does not count');
world.scenes = [{ notes: coll([doc({ accessUuid: 'Item.sh1' })]), regions: coll([]) }];
ok(reach('p1'), 'a visible map pin counts');
world.scenes = [{ notes: coll([]), regions: coll([doc({ access: { kind: 'shard', id: 'Item.sh1' } })]) }];
ok(reach('p1'), 'a step-on area counts');
world.scenes = [];

world.messages = [doc({ access: { kind: 'shard', id: 'Item.sh1' } }, { whisper: ['p2', 'gm'], author: users.gm })];
ok(!reach('p1') && reach('p2'), 'a chat card: only who it was shown to');
world.messages = [doc({ access: { kind: 'shard', id: 'Item.sh1' } }, { whisper: [], author: users.gm })];
ok(reach('p1'), 'a public chat card counts');
world.messages = [];

world.journals = [{ pages: coll([page([], ['p1'], '<p>Here: @NCM[shard:Item.sh1]{the chip}</p>')]) }];
ok(reach('p1') && !reach('p2'), 'a journal link: whoever can read that page');
world.journals = [];
world.macros = [doc({ access: { kind: 'shard', id: 'Item.sh1' } }, { testUserPermission: (u) => u.id === 'p2' })];
ok(reach('p2') && !reach('p1'), 'an access macro: whoever owns it');
world.macros = [];

// ═══ 2. Session fields and self-destruct ═══
const s = SA.sanitizeSessionUpdates({ keyItemUsed: 1, hackAttempts: -5, loggedIn: 'yes', layerHackAttempts: { login: 2, 'x y': 9 }, hackedLayers: ['login', 7], decrypted: true, gmBypassed: true });
ok(s.keyItemUsed === true && s.hackAttempts === 0 && s.loggedIn === true, 'session values are typed and floored');
ok(!('decrypted' in s) && !('gmBypassed' in s), 'non-session fields are dropped (no decrypt or GM bypass through a session write)');
ok(JSON.stringify(s.layerHackAttempts) === '{"login":2}' && JSON.stringify(s.hackedLayers) === '["login"]', 'nested session fields are cleaned');
ok(SA.shardCanSelfDestruct({ failureMode: 'destroy' }) && SA.shardCanSelfDestruct({ layerSecurity: { failureMode: 'destroy' } }), 'a shard that wipes itself on failure');
ok(!SA.shardCanSelfDestruct({ failureMode: 'lockout' }) && !SA.shardCanSelfDestruct({}), 'any other shard does not');

// ═══ 3. The REAL GM handlers ═══
const { DataShardService } = await load('scripts/services/DataShardService.js');
globalThis.fromUuidSync = (u) => (u === shard.uuid ? shard : null);
const calls = [];
const spy = (name) => async (...a) => { calls.push([name, ...a.slice(1)]); return { success: true }; };
const entryPage = doc({ messageId: 'e1', corruption: 0.5 });
const fake = {
  isDataShard: () => true,
  getConfig: () => ({ failureMode: 'lockout' }),
  getIntegrityConfig: () => ({ enabled: true, repairPts: 12, recon: { step: 25, worsen: true } }),
  _getLinkedJournal: () => ({ pages: Object.assign([entryPage], { find: (fn) => [entryPage].find(fn) }) }),
  _writeDecrypted: spy('decrypt'), _updateActorSession: spy('session'), _decryptMessage: spy('decryptPage'), _destroyShard: spy('destroy'),
  degradeIntegrity: spy('degrade'), setEntryCorruption: spy('entry'), repairIntegrity: spy('repair'), salvageShard: spy('salvage'),
};
const state = (data, sender) => DataShardService.prototype.handleStateRequest.call(fake, { itemUuid: 'Item.sh1', ...data }, sender);
const integ = (data, sender) => DataShardService.prototype.handleIntegrityRequest.call(fake, { itemUuid: 'Item.sh1', ...data }, sender);
const last = () => calls.at(-1)?.[0];

calls.length = 0;
await state({ op: 'decrypt' }, 'p1');
await state({ op: 'destroy' }, 'p1');
await integ({ op: 'repair', points: 100 }, 'p1');
ok(calls.length === 0, 'a player with no way into the shard: decrypt, wipe and repair all refused');

world.scenes = [{ notes: coll([doc({ accessUuid: 'Item.sh1' })]), regions: coll([]) }]; // p1 now has a way in
globalThis.game.actors = { get: (id) => (id === 'a1' ? { id: 'a1', testUserPermission: (u) => u.id === 'p1' } : id === 'a2' ? { id: 'a2', testUserPermission: (u) => u.id === 'p2' } : null) };
await state({ op: 'decrypt' }, 'p1');
ok(last() === 'decrypt', 'with a way in, a reported unlock lands (rolls are reported by the client)');
calls.length = 0;
await state({ op: 'session', actorId: 'a2', updates: { loggedIn: true } }, 'p1');
ok(!calls.length, "a session write for someone else's character is refused");
await state({ op: 'session', actorId: 'a1', updates: { loggedIn: true, decrypted: true } }, 'p1');
ok(last() === 'session' && JSON.stringify(calls.at(-1)[2]) === '{"loggedIn":true}', 'a session write for their own character, session fields only');
calls.length = 0;
await state({ op: 'destroy' }, 'p1');
ok(!calls.length, 'a wipe of a shard that does not self-destruct is refused');
fake.getConfig = () => ({ failureMode: 'destroy' });
await state({ op: 'destroy' }, 'p1');
ok(last() === 'destroy', 'a wipe of a self-destructing shard lands');

calls.length = 0;
await integ({ op: 'degrade', amount: 999 }, 'p1');
ok(last() === 'degrade' && calls.at(-1)[1].amount === undefined, 'a failed breach takes the configured hit, never a sent amount');
await integ({ op: 'repair', points: 100 }, 'p1');
ok(last() === 'repair' && calls.at(-1)[1] === 12, 'a repair restores the configured points, not the sent ones');
calls.length = 0;
await integ({ op: 'entry', entryId: 'e1', level: 0 }, 'p1');
ok(!calls.length, 'a reconstruct cannot jump an entry from 50% to whole');
await integ({ op: 'entry', entryId: 'e1', level: 0.25 }, 'p1');
ok(last() === 'entry' && calls.at(-1)[2] === 0.25, 'a successful reconstruct moves it one step');
await integ({ op: 'entry', entryId: 'e1', level: 0.75 }, 'p1');
ok(calls.at(-1)[2] === 0.75, 'a botched one makes it worse, when the shard is set that way');
calls.length = 0;
await integ({ op: 'entry', entryId: 'nope', level: 0 }, 'p1');
ok(!calls.length, 'an entry that is not on this shard is refused');
await integ({ op: 'salvage', actorId: 'a2', ok: true }, 'p1');
ok(!calls.length, "a salvage for someone else's character is refused");
await integ({ op: 'salvage', actorId: 'a1', ok: true }, 'p1');
ok(last() === 'salvage', 'a salvage for their own character lands');
world.scenes = [];

// ═══ 4. Gates judged for the sender ═══
const H = await load('scripts/utils/helpers.js');
encoderEnabled = false;
ok(H.canEncode({ id: 'a1' }).ok, 'on the GM client, the GM may always write shards');
ok(!H.canEncode({ id: 'a1' }, { user: users.p1 }).ok, 'judged for a player: authoring off means no (the GM no longer answers for them)');
encoderEnabled = true;
ok(H.canEncode({ id: 'a1' }, { user: users.p1 }).ok, 'authoring on: yes');
ok(!H.canEditShard({ getFlag: (m, k) => ({ isDataShard: true, config: {} })[k] }, { id: 'a1' }, { user: users.p1 }).ok, 'a GM-made shard is read-only when judged for a player');

const sh = read('scripts/integrations/SocketHandlers.js');
const block = (op) => { const i = sh.indexOf(`register(SOCKET_OPS.${op}`); return sh.slice(i, sh.indexOf('socketManager.register(', i + 30)); };
for (const op of ['SHARD_CONVERT_REQUEST', 'SHARD_UNCONVERT_REQUEST', 'SHARD_STATE_REQUEST', 'SHARD_INTEGRITY_REQUEST']) {
  ok(block(op).includes('async (data, sender)') && block(op).includes('isPrimaryGM()'), `${op}: one GM, with the verified sender`);
}
ok(/userOwnsActor\(sender, actor\)/.test(block('SHARD_CONVERT_REQUEST')) && /canEncode\(actor, \{ user: game\.users\.get\(sender\) \}\)/.test(block('SHARD_CONVERT_REQUEST')), 'convert: their own character, allowed to write shards');
ok(/canEditShard\(item, actor, \{ user: game\.users\.get\(sender\) \}\)/.test(block('SHARD_CONVERT_REQUEST')), 're-encode: the shard\'s own edit rule, for the sender');
ok(/userOwnsActor\(sender, actor\)/.test(block('SHARD_UNCONVERT_REQUEST')) && /canEncode\(actor, \{ user/.test(block('SHARD_UNCONVERT_REQUEST')), 'unconvert: their own character, allowed to author');

console.log(`test-shard-relays: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
