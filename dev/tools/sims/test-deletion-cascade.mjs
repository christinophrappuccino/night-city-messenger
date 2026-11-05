// Sim: references and cleanup (audit remediation E2; the plan's T14 deletion cascade).
//   DATA-09  schema migrations wait for the module-id migration; copying keeps the LOWER schema version
//   DATA-10  carried terminals: backdoors expire, onDate residents fire, trace triggers find them
//   DATA-16  deleting a main identity re-homes its aliases; mail keyed to a deleted character reaches its directory
//            entry; a failed sent copy is reported; the Orphan Audit repairs both kinds of broken link
//   INT-08   an archive copy never wipes the real shard; deleting the real shard's journal unconverts its copies
//   DATA-18  a payphone caller can leave voicemail
//   DATA-22  a call line is only accepted from the person on that side of the call
// Drives the real module code with mocked Foundry globals.
import { pathToFileURL, fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const read = (p) => readFileSync(`${ROOT}/${p}`, 'utf8');
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };
const MOD = 'night-city-messenger';

const settings = new Map();
const actors = new Map();
const items = [];
globalThis.game = {
  user: { id: 'gm', isGM: true }, users: Object.assign([], { get: (id) => ({ gm: { id: 'gm', isGM: true }, p1: { id: 'p1', isGM: false }, p2: { id: 'p2', isGM: false } }[id] || null), activeGM: null }),
  actors: { get: (id) => actors.get(id) || null, [Symbol.iterator]: () => actors.values() },
  items: Object.assign(items, { get: (id) => items.find((i) => i.id === id) || null, contents: items }),
  journal: Object.assign([], { get: () => null }),
  settings: { get: (m, k) => settings.get(k), set: async (m, k, v) => { settings.set(k, v); return v; }, settings: new Map(), storage: { get: () => [] } },
  nightcity: {},
};
globalThis.foundry = { utils: { deepClone: (o) => JSON.parse(JSON.stringify(o)), mergeObject: (a, b) => ({ ...a, ...b }), randomID: () => 'rid' } };
globalThis.Hooks = { on() {}, off() {}, once() {}, callAll() {} };
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
globalThis.CONFIG = {};
globalThis.Handlebars = { escapeExpression: (s) => String(s ?? ''), registerHelper() {} };
globalThis.ChatMessage = { create: async () => ({}) };
globalThis.fromUuidSync = (uuid) => items.find((i) => i.uuid === uuid) || null;

// ═══ 1. DATA-09: migration ordering ═══
{
  const { runMigrations, DATA_SCHEMA_VERSION } = await imp('scripts/core/MigrationRunner.js');
  settings.set('namespaceMigrationDone', false);
  settings.set('dataSchemaVersion', 0);
  const r = await runMigrations();
  ok(r.ran === 0 && settings.get('dataSchemaVersion') === 0, 'while the old-id data is still waiting to move, no schema migration runs and nothing is stamped');
  ok(/namespaceMigrationDone/.test(read('scripts/core/MigrationRunner.js')) && DATA_SCHEMA_VERSION >= 6, 'runMigrations checks the id migration first');

  const { migrateWorldSettings } = await imp('scripts/core/NamespaceMigration.js');
  const world = [{ key: 'cyberpunkred-messenger.dataSchemaVersion', value: '2' }, { key: `${MOD}.dataSchemaVersion`, value: '6' }];
  game.settings.storage.get = () => world;
  game.settings.settings = new Map([[`${MOD}.dataSchemaVersion`, {}]]);
  settings.set('dataSchemaVersion', 6);
  await migrateWorldSettings();
  ok(settings.get('dataSchemaVersion') === 2, 'accepting the move later keeps the LOWER version (2), so v3–v6 still run on the old data');
  world[1].value = '1';
  settings.set('dataSchemaVersion', 1);
  await migrateWorldSettings();
  ok(settings.get('dataSchemaVersion') === 1, 'a lower version already under the new id is left alone');
}

// ═══ 2. DATA-16: identities, pure rules ═══
const { reparentAliases, planIdentityRepairs, groupKeyOf } = await imp('scripts/utils/identities.js');
{
  const contacts = [
    { id: 'root', name: 'Rogue' },
    { id: 'a1', name: 'Ghost', identityOf: 'root' },
    { id: 'a2', name: 'Queen', identityOf: 'root', primaryIdentity: true },
    { id: 'other', name: 'Judy' },
  ];
  const p = Object.fromEntries(reparentAliases(contacts, ['root']).map(({ id, patch }) => [id, patch]));
  ok(p.a2?.identityOf === null && p.a1?.identityOf === 'a2', 'the starred alias becomes the main and the other alias follows it');
  ok(!p.other, 'contacts outside the group are untouched');

  const charRoot = [{ id: 'm', actorId: 'act1' }, { id: 'm2', actorId: 'act1' }, { id: 'al', identityOf: 'm' }];
  const q = reparentAliases(charRoot, ['m']);
  ok(q.length === 1 && q[0].id === 'al' && q[0].patch.identityOf === 'm2', 'an alias of a character\'s removed identity points at that character\'s next identity');

  const world = [
    { id: 'alias', name: 'Stray', identityOf: 'deleted' },
    { id: 'v1', name: 'V', actorId: 'deadActor', primaryIdentity: true },
    { id: 'v2', name: 'Vee', actorId: 'deadActor' },
    { id: 'judy', name: 'Judy', actorId: 'liveActor' },
  ];
  const plan = planIdentityRepairs(world, (id) => id === 'liveActor');
  const pp = Object.fromEntries(plan.patches.map(({ id, patch }) => [id, patch]));
  ok(plan.stranded.map((c) => c.id).join() === 'alias' && pp.alias?.identityOf === null, 'the audit finds an alias whose main is gone and makes it its own main');
  ok(plan.deadLinks.length === 2 && pp.v1?.actorId === null && pp.v2?.actorId === null, 'contacts linked to a deleted character lose the dead link');
  ok(pp.v1.identityOf === null && pp.v2.identityOf === 'v1', '…and stay one group: the starred one is the main');
  ok(!pp.judy, 'a contact linked to a living character is untouched');
  const after = world.map((c) => { const x = { ...c }; for (const [k, v] of Object.entries(pp[c.id] || {})) { if (v === null) delete x[k]; else x[k] = v; } return x; });
  ok(groupKeyOf(after, after.find((c) => c.id === 'v2')) === 'c:v1', 'after the repair, mail to the second identity routes into the first one\'s inbox');
}

// ═══ 3. DATA-16: the real MasterContactService ═══
{
  const { MasterContactService } = await imp('scripts/services/MasterContactService.js');
  const mcs = Object.create(MasterContactService.prototype);
  mcs._contacts = [{ id: 'root', name: 'Rogue' }, { id: 'a1', name: 'Ghost', identityOf: 'root' }, { id: 'a2', name: 'Queen', identityOf: 'root' }];
  let persisted = 0;
  mcs._persistContacts = async () => { persisted += 1; };
  mcs._onMasterListChanged = async () => {};
  Object.defineProperty(mcs, "eventBus", { value: { emit() {} } });
  const r = await mcs.removeContact('root');
  const a1 = mcs._contacts.find((c) => c.id === 'a1'), a2 = mcs._contacts.find((c) => c.id === 'a2');
  ok(r.success && !('identityOf' in a1) && a2.identityOf === 'a1', 'deleting a main identity: its first alias becomes the main, the other points at it');
  ok(persisted === 1, 'one save');

  mcs._contacts = [{ id: 'r', name: 'R' }, { id: 'x', identityOf: 'r' }, { id: 'y', identityOf: 'r' }];
  await mcs.bulkRemove(['r']);
  ok(!('identityOf' in mcs._contacts.find((c) => c.id === 'x')) && mcs._contacts.find((c) => c.id === 'y').identityOf === 'x', 'bulk delete re-homes aliases the same way');

  mcs._contacts = [{ id: 'v', name: 'V', actorId: 'gone' }];
  const dry = await mcs.repairIdentityLinks();
  ok(dry.deadLinks.length === 1 && mcs._contacts[0].actorId === 'gone', 'the audit reports without writing');
  const wet = await mcs.repairIdentityLinks({ apply: true });
  ok(wet.changed === 1 && !('actorId' in mcs._contacts[0]), 'Clean Up clears the dead link');
}

// ═══ 4. DATA-16: delivery to a deleted character ═══
{
  const { MessageService } = await imp('scripts/services/MessageService.js');
  const svc = Object.create(MessageService.prototype);
  const wrote = [];
  Object.defineProperty(svc, "_messageRepo", { value: { createMessage: async (id, d) => { wrote.push({ id, d }); return { success: true, messageId: d.messageId }; } } });
  svc._shouldSpamFilter = async () => false;
  let sentFail = 0;
  svc._createSentCopy = async () => ({ success: false, error: 'outbox missing' });
  svc._notifyGmOfNpcMail = () => {}; svc._mirrorTaps = () => {};
  Object.defineProperty(svc, "eventBus", { value: { emit() {} } });
  Object.defineProperty(svc, "socket", { value: { emit() {} } });
  game.nightcity.masterContactService = { getContact: (id) => (id === 'cV' ? { id: 'cV', name: 'V' } : null), getByActorId: () => null, getAll: () => [] };
  const warn = ui.notifications.warn;
  ui.notifications.warn = (m) => { if (/sent copy/.test(m)) sentFail += 1; };
  let res;
  try { res = await svc._deliverMessage({ messageId: 'm1', subject: 'Job', toActorId: 'deadActor', toContactId: 'cV', _recipientInboxId: 'deadActor', from: 'a@b', status: {} }); }
  catch (e) { res = { error: e.message }; }
  ui.notifications.warn = warn;
  ok(wrote[0]?.id === 'cV', 'mail keyed to a deleted character lands in its directory entry\'s inbox');
  ok(sentFail === 1, 'a sent copy that could not be saved is reported to the GM (the mail still went)');
}

// ═══ 5. DATA-10: carried terminals ═══
{
  const { TerminalService } = await imp('scripts/services/TerminalService.js');
  const ts = Object.create(TerminalService.prototype);
  const carried = { id: 'term1', uuid: 'Actor.a.Item.term1', name: 'WS-7F', parent: { id: 'a' } };
  const now = 1_000_000;
  ts._nowMs = () => now;
  ts.collectTerminals = () => [carried];
  ts.isTerminal = (i) => i === carried;
  ts.getConfig = () => ({ accounts: [{ id: 'bd', username: 'ghost', forged: { expiresAt: new Date(now - 1000).toISOString() } }] });
  const removed = [];
  ts.removeAccount = async (item, id) => { removed.push(`${item.id}:${id}`); };
  ts._residentGmAlert = () => {};
  await ts.reapForgedAccounts();
  ok(removed.join() === 'term1:bd', 'a backdoor on a terminal in someone\'s gear expires');

  ts.getResidents = () => [{ id: 'r1', state: 'armed', trigger: { kind: 'onDate', atMs: now - 5 } }];
  const fired = [];
  ts._proposeResidentFire = async (item, r) => { fired.push(`${item.id}:${r.id}`); };
  await ts.reapResidents();
  ok(fired.join() === 'term1:r1', 'an onDate resident on a carried terminal fires');

  const { TraceService } = await imp('scripts/services/TraceService.js');
  const tr = Object.create(TraceService.prototype);
  const seen = [];
  game.nightcity.terminalService = { isTerminal: (i) => i === carried, collectTerminals: () => [carried],
    checkActionResidents: async (item, action) => { seen.push(`action:${item.id}:${action}`); },
    checkHeatResidents: async (item) => { seen.push(`heat:${item.id}`); } };
  await tr._fireResidentTriggers({ targetKind: 'terminal', objectId: 'term1', targetUuid: carried.uuid, outcome: 'success', action: 'siphon' }, 30);
  ok(seen.join() === 'action:term1:siphon,heat:term1', 'a trace on a carried terminal reaches its onAction and onHeat residents (by uuid)');
  seen.length = 0;
  await tr._fireResidentTriggers({ targetKind: 'terminal', objectId: 'term1', outcome: 'success', action: 'crack' }, 30);
  ok(seen.join() === 'action:term1:crack,heat:term1', '…and by id when the row has no uuid');
}

// ═══ 6. INT-08: archive copies ═══
{
  const { DataShardService } = await imp('scripts/services/DataShardService.js');
  const ds = Object.create(DataShardService.prototype);
  const deletedPages = [];
  const journal = { id: 'J', pages: [{ id: 'p1' }, { id: 'p2' }], deleteEmbeddedDocuments: async (t, ids) => { deletedPages.push(...ids); }, delete: async () => { journal.gone = true; } };
  const mkItem = (id, flags) => {
    const it = { id, name: id, flags: { [MOD]: { ...flags } }, writes: [],
      getFlag: (m, k) => it.flags[MOD][k],
      setFlag: async (m, k, v) => { it.flags[MOD][k] = v; it.writes.push(['set', k]); },
      unsetFlag: async (m, k) => { delete it.flags[MOD][k]; it.writes.push(['unset', k]); },
      update: async (u) => { it.writes.push(['update', Object.keys(u)]); if (`flags.-=${MOD}` in u) it.flags[MOD] = {}; } };
    return it;
  };
  ds._getLinkedJournal = () => journal;
  Object.defineProperty(ds, "soundService", { value: { play() {} } });
  const archive = mkItem('copy', { isDataShard: true, journalId: 'J', shardArchive: { sourceId: 'src' }, state: { sessions: { a: 1 } } });
  await ds._destroyShard(archive);
  ok(deletedPages.length === 0, 'destroying an archive copy never wipes the real shard\'s files');
  ok(archive.flags[MOD].state?.destroyed === true && Object.keys(archive.flags[MOD].state.sessions).length === 0, 'it marks only itself destroyed, with its old sessions really cleared');

  const src = mkItem('src', { isDataShard: true, journalId: 'J', state: { sessions: { a: 1, b: 2 } } });
  await ds._destroyShard(src);
  ok(deletedPages.join() === 'p1,p2' && Object.keys(src.flags[MOD].state.sessions).length === 0, 'destroying the real shard wipes its files and its sessions');

  const copy2 = mkItem('copy2', { isDataShard: true, journalId: 'J', shardArchive: { sourceId: 'src' } });
  const unrelated = mkItem('other', { isDataShard: true, journalId: 'K', shardArchive: { sourceId: 'z' } });
  items.push(src, copy2, unrelated);
  game.journal.get = (id) => (id === 'J' ? journal : null);
  game.nightcity.settingsManager = { getShardNamePrefix: () => '' };
  await ds.removeDataShard(src, true);
  ok(journal.gone === true, 'purging the real shard deletes its journal');
  ok(Object.keys(copy2.flags[MOD]).length === 0 && unrelated.flags[MOD].journalId === 'K', '…and unconverts the archive copies of it (only those)');
}

// ═══ 7. DATA-18 / DATA-22: calls ═══
{
  const { makeVoicemail } = await imp('scripts/utils/voicemail.js');
  const vm = makeVoicemail({ callId: 'c1', from: { name: 'Payphone, Kabuki', number: '555', payphone: 'pp1', realActorId: 'v', realName: 'V' }, to: { actorId: 'judy' }, text: 'Call me back.' });
  ok(vm.from.payphone === 'pp1' && !('realActorId' in vm.from) && !('realName' in vm.from), 'a booth voicemail keeps the booth and never the real caller');

  const { CallService } = await imp('scripts/services/CallService.js');
  const cs = Object.create(CallService.prototype);
  cs.calls = new Map([['c1', { id: 'c1', from: { payphone: 'pp1', realUserId: 'p1' } }]]);
  ok(cs._isBoothCaller(vm, 'p1'), 'the GM accepts a booth voicemail from the person on the booth');
  ok(!cs._isBoothCaller(vm, 'p2'), '…and refuses it from anyone else');
  cs.calls = new Map();
  game.nightcity.payphoneService = { inUse: new Map([['pp1', { userId: 'p1' }]]) };
  ok(cs._isBoothCaller(vm, 'p1') && !cs._isBoothCaller(vm, 'p2'), 'with the call already over, who is on the booth decides');
  ok(!cs._isBoothCaller({ ...vm, from: { name: 'x' } }, 'p1'), 'a voicemail that is not from a booth is not a booth voicemail');

  const { lineFromRightSide } = await imp('scripts/utils/callModel.js');
  const call = { from: { userId: 'p1' }, to: { userIds: ['p2', 'p3'] }, answeredBy: 'p2' };
  ok(lineFromRightSide(call, { side: 'caller' }, 'p1') && !lineFromRightSide(call, { side: 'caller' }, 'p2'), 'a caller line only from the caller');
  ok(lineFromRightSide(call, { side: 'callee' }, 'p2') && !lineFromRightSide(call, { side: 'callee' }, 'p3'), 'a callee line only from whoever answered — the losing pick-up is ignored');
  ok(lineFromRightSide({ ...call, answeredBy: null }, { side: 'callee' }, 'p3'), 'before the answer is known, any of the callee\'s users may');
  ok(lineFromRightSide(call, { side: 'callee' }, 'gm', true), 'the GM may always speak');
  ok(/lineFromRightSide\(mine, line, senderId/.test(read('scripts/services/CallService.js')), 'the call socket checks every incoming line');
}

console.log(`test-deletion-cascade: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
