// Sim: serialized writers (audit remediation B4: DATA-04, DATA-15, INT-02, INT-03, INT-06, INT-09, INT-11).
//
// Every writer here reads a whole record, changes it and saves it back. Two of them at once both started
// from the same copy and the later save undid the earlier one. Each test fires two writes WITHOUT awaiting
// the first, over a fake store whose saves land a few ms later (as Foundry's do), and checks both survive.
import { pathToFileURL, fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const load = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
const read = (p) => readFileSync(`${ROOT}/${p}`, 'utf8');
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };
const MOD = 'night-city-messenger';
const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
const tick = () => new Promise((r) => setTimeout(r, 3 + Math.floor(Math.random() * 4)));
const setPath = (obj, path, v) => { const ks = path.split('.'); let o = obj; for (const k of ks.slice(0, -1)) o = (o[k] ??= {}); o[ks.at(-1)] = v; };

// ── a world whose saves land late ──
const settings = new Map();
let failNextSet = null;
const mkDoc = (id, flags = {}) => {
  const d = {
    id, uuid: `Item.${id}`, name: id, isOwner: true, flags: { [MOD]: clone(flags) },
    getFlag: (m, k) => clone(d.flags[MOD][k]),
    async setFlag(m, k, v) { const c = clone(v); await tick(); d.flags[MOD][k] = c; },
    async unsetFlag(m, k) { await tick(); delete d.flags[MOD][k]; },
    async update(changes) { const c = clone(changes); await tick(); for (const [p, v] of Object.entries(c)) setPath(d, p, v); },
    testUserPermission: () => true,
  };
  return d;
};
const journals = [];
const folders = [];
let created = { journal: 0, folder: 0 };
globalThis.game = {
  user: { id: 'gm', isGM: true, name: 'GM' },
  users: { get: () => null, filter: () => [], find: () => null, activeGM: { id: 'gm' } },
  actors: Object.assign([], { get(id) { return this.find((a) => a.id === id); }, set(id, a) { this.push(a); } }),
  items: new Map(),
  journal: Object.assign(journals, { get: (id) => journals.find((j) => j.id === id) }),
  folders: Object.assign(folders, { get: (id) => folders.find((f) => f.id === id) }),
  settings: {
    get: (m, k) => clone(settings.get(k)),
    async set(m, k, v) { const c = clone(v); if (failNextSet === k) { failNextSet = null; throw new Error('disk full'); } await tick(); settings.set(k, c); return c; },
  },
  nightcity: { eventBus: { emit() {} }, soundService: { play() {} } },
};
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, OBSERVER: 2, OWNER: 3 } };
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
globalThis.Hooks = { on() {}, off() {}, once() {}, call() {}, callAll() {} };
globalThis.ChatMessage = { create: async () => ({}) };
globalThis.fromUuidSync = () => null;
globalThis.foundry = {
  utils: {
    deepClone: clone,
    randomID: (n = 16) => Math.random().toString(36).slice(2, 2 + n).padEnd(n, '0'),
    mergeObject: (a, b, o = {}) => { const out = o.inplace === false ? clone(a) : a; const m = (x, y) => { for (const [k, v] of Object.entries(y || {})) { if (v && typeof v === 'object' && !Array.isArray(v) && x[k] && typeof x[k] === 'object') m(x[k], v); else x[k] = clone(v); } }; m(out, b); return out; },
    getRoute: (p) => p,
  },
  applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (B) => B }, instances: new Map() },
};
globalThis.JournalEntry = { create: async (data) => {
  await tick(); created.journal += 1;
  const j = { id: `j${created.journal}`, ...clone(data), pages: [] };
  j.getFlag = (m, k) => j.flags?.[MOD]?.[k];
  j.createEmbeddedDocuments = async (t, docs) => { await tick(); const out = docs.map((d, i) => ({ id: `bp${j.pages.length + i}`, ...clone(d), parent: j })); j.pages.push(...out); return out; };
  j.deleteEmbeddedDocuments = async (t, ids) => { await tick(); j.pages = j.pages.filter((p) => !ids.includes(p.id)); };
  journals.push(j); return j;
} };
globalThis.Folder = { create: async (data) => { await tick(); created.folder += 1; const f = { id: `f${created.folder}`, ...clone(data) }; f.folder = data.folder ? folders.find((x) => x.id === data.folder) : null; folders.push(f); return f; } };

// ═══ 1. The helper ═══
const S = await load('scripts/utils/serialize.js');
{
  const order = [];
  const a = S.serialize('k', async () => { await tick(); order.push('a'); return 1; });
  const b = S.serialize('k', async () => { order.push('b'); throw new Error('x'); });
  const c = S.serialize('k', async () => { order.push('c'); return 3; });
  const other = S.serialize('other', async () => { order.push('o'); });
  const [ra, rb, rc] = await Promise.allSettled([a, b, c, other]);
  ok(order.join('') === 'oabc', 'same key runs in order; another key does not wait');
  ok(ra.value === 1 && rb.status === 'rejected' && rc.value === 3, 'a failure is reported to its caller and does not stall the queue');
  await tick();
  ok(!S.busyKeys().length, 'an idle key leaves nothing behind');
  const proto = { async w(x) { await tick(); return x * 2; } };
  S.serializeMethods(proto, ['w'], (args) => `w:${args[0] > 0}`);
  ok(proto.w.ncmSerialized && (await proto.w(4)) === 8, 'serializeMethods keeps the result');
  S.serializeMethods(proto, ['w'], () => 'again');
  ok(proto.w.ncmOriginal && !proto.w.ncmOriginal.ncmSerialized, 'wrapping twice does not double-wrap');
}

// ═══ 2. Trace log, heat, countdowns (INT-03) ═══
{
  const { TraceService } = await load('scripts/services/TraceService.js');
  const t = Object.create(TraceService.prototype);
  t._decay = (e) => e?.value || 0; t._nowIso = () => 'now'; t._nowMs = () => 1000;
  t._fireResidentTriggers = async () => {};
  settings.set('traceLog', []); settings.set('traceHeat', {}); settings.set('traceCountdowns', []);
  await Promise.all([t.recordTrace({ outcome: 'success', action: 'a' }), t.recordTrace({ outcome: 'success', action: 'b' })]);
  ok(settings.get('traceLog').length === 2, 'two traces at once both reach the log');
  await Promise.all([t.bumpHeat('obj', 'a1', 10), t.bumpHeat('obj', 'a1', 20), t.bumpHeat('obj', 'a2', 5)]);
  const heat = settings.get('traceHeat');
  ok(heat.obj.a1.value === 30 && heat.obj.a2.value === 5, 'three heat bumps at once all count');
  await Promise.all([t.startCountdown('obj', null, { minutes: 5 }), t.startCountdown('obj2', null, { minutes: 9 })]);
  ok(settings.get('traceCountdowns').length === 2, 'two countdowns started at once both run');
}

// ═══ 3. Recycle bin (DATA-04) ═══
{
  const SF = await load('scripts/ui/content/SiphonFlow.js');
  settings.set('recycleBin', []);
  // D5: the bin is a GM-only journal (one page per wiped file); the old setting is only read until the migration.
  const binJournal = () => SF.recycleJournal();
  const deleted = [];
  const page = (id) => ({ id, name: id, flags: { [MOD]: { messageId: id } }, toObject: () => ({ name: id }), delete: async () => { await tick(); deleted.push(id); } });
  const j1 = { id: 'jA', name: 'Box', pages: [page('m1'), page('m2')] };
  const j2 = { id: 'jB', name: 'Box2', pages: [page('m3')] };
  for (const j of [j1, j2]) for (const p of j.pages) p.parent = j;
  const wipe = (j, ids) => SF._applyNativeEffect('wipe', { page: null, hostItem: null, actor: null, cd: { effect: { params: { messageIds: ids } } } }).catch(() => {});
  // the effect reads the journal from page.parent; give it a carrier page
  const carrier = (j) => ({ id: 'prog', parent: j });
  await Promise.all([
    SF._applyNativeEffect('wipe', { page: carrier(j1), hostItem: null, actor: null, cd: { effect: { params: { messageIds: ['m1', 'm2'] } } } }),
    SF._applyNativeEffect('wipe', { page: carrier(j2), hostItem: null, actor: null, cd: { effect: { params: { messageIds: ['m3'] } } } }),
  ]);
  void wipe;
  const bin = SF.getRecycleBin();
  ok(bin.length === 3 && ['m1', 'm2', 'm3'].every((n) => bin.some((r) => r.pageName === n)), 'two wipes at once: every file is in the bin');
  ok(deleted.length === 3, 'and each page was deleted once it was safely binned');
  ok(created.journal >= 1 && binJournal()?.ownership?.default === 0, 'the bin is one GM-only journal');
  ok(!(binJournal()?.pages || []).some((p) => p.flags?.[MOD]?.messageId), 'a bin page never carries the wiped file\'s own message id');
  const j3 = { id: 'jC', name: 'Box3', pages: [page('m4')] }; j3.pages[0].parent = j3;
  const realAdd = binJournal().createEmbeddedDocuments;
  binJournal().createEmbeddedDocuments = async () => { throw new Error('disk full'); };
  await SF._applyNativeEffect('wipe', { page: carrier(j3), hostItem: null, actor: null, cd: { effect: { params: { messageIds: ['m4'] } } } });
  binJournal().createEmbeddedDocuments = realAdd;
  ok(!deleted.includes('m4'), 'a file the bin could not save is NOT deleted');
}

// ═══ 4. Delivery failures (INT-11) ═══
{
  const { MessageService } = await load('scripts/services/MessageService.js');
  const m = Object.create(MessageService.prototype);
  m._getTimestamp = () => 'gt';
  settings.set('deliveryFailures', []);
  await Promise.all([
    m.recordDeliveryFailure({ data: { messageId: 'a', subject: 'one' }, result: { error: 'x' } }),
    m.recordDeliveryFailure({ data: { messageId: 'b', subject: 'two' }, result: { error: 'y' } }),
  ]);
  ok(settings.get('deliveryFailures').length === 2, 'two failures at once are both listed');
  // a retried group send: the GM fan-out reports its refusals again, but the row is updated, not duplicated
  const rowId = settings.get('deliveryFailures')[0].id;
  m.sendMessage = async (d) => { await m.recordDeliveryFailure({ data: d, result: { failed: [{ name: 'Judy', error: 'gone' }] } }); return { success: true, failed: [{ name: 'Judy', email: 'j@x', error: 'gone' }] }; };
  await m.retryDeliveryFailure(rowId);
  const rows = settings.get('deliveryFailures');
  ok(rows.length === 2 && /Judy: gone/.test(rows.find((r) => r.id === rowId).why), 'a retried group send updates its own row instead of adding a duplicate');
  ok(rows.find((r) => r.id === rowId).retry.recipients?.[0]?.name === 'Judy', 'and the next retry is aimed only at who still failed');
}

// ═══ 5. Inbox + folder creation (DATA-15) ═══
{
  const { MessageRepository } = await load('scripts/data/MessageRepository.js');
  const r = Object.create(MessageRepository.prototype);
  r._inboxCache = new Map(); r._folderCache = new Map(); r._rootFolder = null;
  r._computeOwnership = () => ({ default: 0 });
  r._repairPermissions = async () => {};
  game.actors.set('pc1', mkDoc('pc1'));
  created = { journal: 0, folder: 0 };
  const [a, b, c] = await Promise.all([r.getInboxJournal('pc1'), r.getInboxJournal('pc1'), r.getInboxJournal('pc1')]);
  ok(created.journal === 1 && a.id === b.id && b.id === c.id, 'three first deliveries at once make ONE inbox');
  ok(created.folder === 2, '…and one root folder + one Inboxes folder');
}

// ═══ 6. Terminal state (INT-02) ═══
{
  const { TerminalService } = await load('scripts/services/TerminalService.js');
  const ts = Object.create(TerminalService.prototype);
  ts._broadcastStateChange = () => {};
  ts._checkLoginResidents = async () => {};
  const item = mkDoc('term1', { isTerminal: true, terminalState: {} });
  await Promise.all([
    ts.installResident(item, { effectType: 'plant', trigger: { kind: 'onLogin' } }),
    ts._updateSession(item, 'a1', { loggedInAccounts: ['acct'] }),
    ts.setUplink(item, null),
    ts.installResident(item, { effectType: 'keylog', trigger: { kind: 'onLogin' } }),
  ]);
  const st = item.flags[MOD].terminalState;
  ok(st.residents?.length === 2, 'two installs beside a login and an uplink switch: both plants stay');
  ok(st.sessions?.a1?.loggedInAccounts?.[0] === 'acct', 'the login stays');
  ok(st.connection?.currentNetworkId === null, 'the uplink switch stays');
  const id0 = st.residents[0].id, id1 = st.residents[1].id;
  await Promise.all([ts.updateResident(item, id0, { state: 'fired' }), ts.removeResident(item, id1)]);
  const st2 = item.flags[MOD].terminalState;
  ok(st2.residents.length === 1 && st2.residents[0].state === 'fired', 'a fire beside a removal: neither undoes the other');
}

// ═══ 7. Shard state + integrity (INT-02, INT-09) ═══
{
  const { DataShardService } = await load('scripts/services/DataShardService.js');
  const ds = Object.create(DataShardService.prototype);
  const shard = mkDoc('shard1', { isDataShard: true, state: {}, config: { integrity: { enabled: true, maxIntegrity: 100, currentIntegrity: 100, degradePerFailure: 10, mode: 'cosmetic' } } });
  await Promise.all([ds._updateActorSession(shard, 'a1', { hackAttempts: 2 }), ds._updateActorSession(shard, 'a2', { hackAttempts: 1 }), ds._writeDecrypted(shard)]);
  const ss = shard.flags[MOD].state;
  ok(ss.sessions?.a1?.hackAttempts === 2 && ss.sessions?.a2?.hackAttempts === 1 && ss.decrypted === true, 'two sessions and a decrypt at once all stay');
  ds._nowIso = () => 'now';
  await Promise.all([ds.degradeIntegrity(shard, { rollLoss: false }), ds.degradeIntegrity(shard, { rollLoss: false })]);
  ok(shard.flags[MOD].config.integrity.currentIntegrity === 80, 'two failed hacks at once cost two hits');
}

// ═══ 8. Contacts + groups (INT-06) ═══
{
  const { ContactRepository } = await load('scripts/data/ContactRepository.js');
  const { ContactGroupService } = await load('scripts/services/ContactGroupService.js');
  const pc = mkDoc('pc2', { contacts: [], contactGroups: [{ id: 'g1', name: 'Crew', members: [{ email: 'a@x', name: 'A' }] }, { id: 'g2', name: 'Fixers', members: [{ email: 'b@x', name: 'B' }] }] });
  game.actors.set('pc2', pc);
  const repo = Object.create(ContactRepository.prototype);
  await Promise.all([repo.addContact('pc2', { name: 'Judy', email: 'judy@x' }), repo.addContact('pc2', { name: 'Panam', email: 'panam@x' })]);
  ok(pc.flags[MOD].contacts.length === 2, 'two contacts added at once both stay');
  const c0 = pc.flags[MOD].contacts[0].id;
  await Promise.all([repo.updateContact('pc2', c0, { notes: 'n' }), repo.addContact('pc2', { name: 'Rogue', email: 'rogue@x' })]);
  ok(pc.flags[MOD].contacts.length === 3 && pc.flags[MOD].contacts.find((c) => c.id === c0).notes === 'n', 'an edit beside an add: both stay');
  const groups = Object.create(ContactGroupService.prototype);
  groups._emit = () => {};
  await Promise.all([groups.touchActorGroup('pc2', 'g1'), groups.touchActorGroup('pc2', 'g2')]);   // the composer's unawaited loop
  const gl = pc.flags[MOD].contactGroups;
  ok(gl.every((g) => g.lastUsedAt), 'the composer stamping two groups at once: both stamps stay');
}

// ═══ 9. Wiring ═══
ok(/serialize\('bin'/.test(read('scripts/ui/content/SiphonFlow.js')) && /if \(!kept\)[\s\S]{0,140}return false;\s*\}\s*await page\.delete\(\);/.test(read('scripts/ui/content/SiphonFlow.js')), 'the bin deletes a page only after the record reads back');
ok(!/_sessionWrites/.test(read('scripts/services/TerminalService.js')), 'terminal sessions share the machine queue (no second private chain)');
ok(/payload\._retryOf = id/.test(read('scripts/services/MessageService.js')), 'an Outbox retry carries the row it updates');

console.log(`test-serialized-writers: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
