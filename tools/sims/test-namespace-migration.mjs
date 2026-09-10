/**
 * Sim — NamespaceMigration (cyberpunkred-messenger → night-city-messenger).
 * Run: node tools/sims/test-namespace-migration.mjs
 *
 * Drives the REAL module functions against a mocked Foundry: a WorldSettings
 * collection, world collections of fake documents whose update() semantics
 * mirror Foundry's flag merge / `-=` deletion, localStorage, Dialog.confirm.
 */
import assert from 'node:assert/strict';

const NEW = 'night-city-messenger';
const OLD = 'cyberpunkred-messenger';

// ─── Foundry mocks ───────────────────────────────────────────────────────────
const deepClone = (o) => (o === undefined ? o : JSON.parse(JSON.stringify(o)));
const objectsEqual = (a, b) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
const sortKeys = (v) => (v && typeof v === 'object' && !Array.isArray(v))
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])]))
  : Array.isArray(v) ? v.map(sortKeys) : v;
globalThis.foundry = { utils: { deepClone, objectsEqual } };

let notices = [];
globalThis.ui = { notifications: { info: (m) => notices.push(['info', m]), warn: (m) => notices.push(['warn', m]), error: (m) => notices.push(['error', m]) } };
globalThis.window = { location: { reload: () => { reloads++; } } };
let reloads = 0;
let confirmAnswer = true, confirmCalls = 0;
globalThis.Dialog = { confirm: async () => { confirmCalls++; return confirmAnswer; } };

/** Apply a Foundry-style flag update to a fake doc (flags.<ns> merge, flags.-=<ns> delete). */
function applyFlagUpdate(doc, update, { corrupt } = {}) {
  for (const [k, v] of Object.entries(update)) {
    if (k === '_id') continue;
    let m = k.match(/^flags\.-=(.+)$/);
    if (m) { delete doc.flags[m[1]]; continue; }
    m = k.match(/^flags\.(.+)$/);
    if (m) {
      const ns = m[1];
      const merged = { ...(doc.flags[ns] ?? {}), ...deepClone(v) };
      if (corrupt && corrupt(doc)) merged.__corrupt = true;
      doc.flags[ns] = merged;
    }
  }
}

class FakeDoc {
  constructor(name, flags, documentName = 'Doc', embedded = {}) {
    this.id = name; this.name = name; this.documentName = documentName;
    this.flags = flags; this._embedded = embedded; this.updates = 0;
  }
  getEmbeddedCollection(n) { return this._embedded[n]; }
  async updateEmbeddedDocuments(n, updates) {
    for (const u of updates) { const d = this._embedded[n].find(x => x.id === u._id); applyFlagUpdate(d, u); d.updates++; }
  }
}
function collection(docs, opts = {}) {
  const arr = [...docs];
  arr.documentClass = { updateDocuments: async (updates) => { for (const u of updates) { const d = arr.find(x => x.id === u._id); applyFlagUpdate(d, u, opts); d.updates++; } } };
  return arr;
}

function makeSettings(registered, worldRows) {
  const world = worldRows.map(r => ({ key: r.key, value: JSON.stringify(r.value) }));
  const store = {
    get: (scope) => (scope === 'world' ? world : null),
  };
  return {
    settings: new Map(registered.map(k => [`${NEW}.${k}`, {}])),
    storage: store,
    get: (ns, key) => { const r = world.find(x => x.key === `${ns}.${key}`); return r ? JSON.parse(r.value) : (key === 'namespaceMigrationDone' ? false : undefined); },
    set: async (ns, key, value) => { const k = `${ns}.${key}`; const r = world.find(x => x.key === k); if (r) r.value = JSON.stringify(value); else world.push({ key: k, value: JSON.stringify(value) }); },
    world,
  };
}
function makeStorage(entries) {
  const m = new Map(Object.entries(entries));
  return { get length() { return m.size; }, key: (i) => [...m.keys()][i], getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), map: m };
}

// ─── Import the REAL module (after globals exist) ───────────────────────────
const mod = await import('../../scripts/core/NamespaceMigration.js');
const { migrateClientSettings, scanLegacyData, migrateWorldSettings, migrateDocumentFlags, migrateAllDocuments, runNamespaceMigration, hasLegacyFlags, MIGRATION_SCOPES } = mod;
const { LEGACY_MODULE_ID, MODULE_ID } = await import('../../scripts/utils/constants.js');

let pass = 0, fail = 0;
const check = (name, fn) => { try { fn(); pass++; console.log('  ok  ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + ' — ' + e.message); } };

console.log('constants');
check('MODULE_ID is the new id', () => assert.equal(MODULE_ID, NEW));
check('LEGACY_MODULE_ID is the old id', () => assert.equal(LEGACY_MODULE_ID, OLD));
check('scopes cover actors/items/journal/scenes/users/macros', () => {
  for (const c of ['actors', 'items', 'journal', 'scenes', 'users', 'macros']) assert.ok(MIGRATION_SCOPES.some(s => s.collection === c), c);
});

console.log('client settings');
{
  const st = makeStorage({ [`${OLD}.playerTheme`]: '{"preset":"arasaka"}', [`${OLD}.gmViewAdminTheme`]: 'false', [`${NEW}.gmViewAdminTheme`]: 'true', 'other.thing': '1' });
  const n = migrateClientSettings(st);
  check('copies only legacy keys without a new-id twin', () => assert.equal(n, 1));
  check('value carried verbatim', () => assert.equal(st.getItem(`${NEW}.playerTheme`), '{"preset":"arasaka"}'));
  check('existing new-id key not clobbered', () => assert.equal(st.getItem(`${NEW}.gmViewAdminTheme`), 'true'));
  check('unrelated keys untouched', () => assert.equal(st.map.size, 5));
  check('idempotent', () => assert.equal(migrateClientSettings(st), 0));
  check('no storage → 0', () => assert.equal(migrateClientSettings(null), 0));
}

console.log('world settings');
{
  globalThis.game = { user: { isGM: true }, settings: makeSettings(['traceLog', 'dataSchemaVersion', 'spamAutoConfig', 'namespaceMigrationDone'], [
    { key: `${OLD}.traceLog`, value: [{ a: 1 }] },
    { key: `${OLD}.dataSchemaVersion`, value: 1 },
    { key: `${OLD}.spamAutoConfig`, value: { n1: { enabled: true } } },
    { key: `${NEW}.spamAutoConfig`, value: { n1: { enabled: false } } },
    { key: `${OLD}.retiredSetting`, value: 'x' },
    { key: 'someone-else.key', value: 3 },
  ]) };
  const r = await migrateWorldSettings();
  check('copies registered legacy keys', () => assert.equal(r.copied, 2));
  check('traceLog value round-trips', () => assert.deepEqual(game.settings.get(NEW, 'traceLog'), [{ a: 1 }]));
  check('dataSchemaVersion carried (MigrationRunner sees the right version)', () => assert.equal(game.settings.get(NEW, 'dataSchemaVersion'), 1));
  check('existing new-id value not clobbered', () => assert.deepEqual(game.settings.get(NEW, 'spamAutoConfig'), { n1: { enabled: false } }));
  check('unregistered legacy key skipped + reported', () => assert.deepEqual(r.skipped, ['retiredSetting']));
  check('legacy rows left in place (rollback-safe)', () => assert.ok(game.settings.world.some(x => x.key === `${OLD}.traceLog`)));
}

console.log('document flags');
{
  const page = new FakeDoc('msg-1', { [OLD]: { messageId: 'm1', subject: 'Hi', status: { read: false } } }, 'JournalEntryPage');
  const journal = new FakeDoc('V — Inbox', { [OLD]: { type: 'inbox', actorId: 'a1' } }, 'JournalEntry', { JournalEntryPage: [page, new FakeDoc('plain', {}, 'JournalEntryPage')] });
  const shard = new FakeDoc('Chip', { [OLD]: { isDataShard: true, config: { preset: 'blank' } }, 'other-module': { keep: 1 } }, 'Item');
  const actor = new FakeDoc('V', { [OLD]: { email: 'v@nc.net', contacts: [{ id: 'c1' }] } }, 'Actor', { Item: [shard, new FakeDoc('Gun', {}, 'Item')] });
  const clean = new FakeDoc('Nobody', {}, 'Actor', { Item: [] });
  const scene = new FakeDoc('Docks', { [OLD]: { deadZone: true } }, 'Scene', { Note: [new FakeDoc('pin', { [OLD]: { terminalItemId: 't1' } }, 'Note')], Token: [] });
  globalThis.game = {
    user: { isGM: true },
    settings: makeSettings(['namespaceMigrationDone'], []),
    actors: collection([actor, clean]), items: collection([]), journal: collection([journal]),
    scenes: collection([scene]), users: collection([]), macros: collection([]), folders: collection([]), messages: collection([]),
  };
  const found = scanLegacyData();
  check('scan counts primary docs', () => assert.equal(found.docs, 3));
  check('scan counts embedded docs', () => assert.equal(found.embedded, 3));
  const r = await migrateAllDocuments();
  check('all six flagged docs migrated, none mismatched', () => assert.deepEqual(r, { migrated: 6, mismatched: [] }));
  check('actor flags moved verbatim', () => assert.deepEqual(actor.flags[NEW], { email: 'v@nc.net', contacts: [{ id: 'c1' }] }));
  check('legacy block deleted', () => assert.equal(actor.flags[OLD], undefined));
  check('embedded shard moved, other module flags untouched', () => { assert.deepEqual(shard.flags[NEW], { isDataShard: true, config: { preset: 'blank' } }); assert.deepEqual(shard.flags['other-module'], { keep: 1 }); assert.equal(shard.flags[OLD], undefined); });
  check('journal page moved', () => assert.equal(page.flags[NEW].subject, 'Hi'));
  check('scene + note moved', () => { assert.equal(scene.flags[NEW].deadZone, true); assert.equal(scene._embedded.Note[0].flags[NEW].terminalItemId, 't1'); });
  check('unflagged docs never updated', () => { assert.equal(clean.updates, 0); assert.equal(actor._embedded.Item[1].updates, 0); });
  check('each migrated doc took exactly 2 writes (copy, then delete)', () => assert.equal(actor.updates, 2));
  check('second run finds nothing', () => assert.deepEqual(scanLegacyData(), { settings: 0, docs: 0, embedded: 0 }));
  check('hasLegacyFlags false for empty block', () => assert.equal(hasLegacyFlags(new FakeDoc('e', { [OLD]: {} })), false));
}

console.log('verification guard');
{
  const good = new FakeDoc('good', { [OLD]: { a: 1 } }, 'Actor');
  const bad = new FakeDoc('bad', { [OLD]: { a: 2 } }, 'Actor');
  const coll = collection([good, bad], { corrupt: (d) => d.id === 'bad' });
  const r = await migrateDocumentFlags(coll, (u) => coll.documentClass.updateDocuments(u));
  check('mismatched doc reported by name', () => assert.deepEqual(r, { migrated: 1, mismatched: ['Actor "bad"'] }));
  check('mismatched doc KEEPS its legacy flags', () => assert.deepEqual(bad.flags[OLD], { a: 2 }));
  check('good doc lost its legacy flags', () => assert.equal(good.flags[OLD], undefined));
}

console.log('runner');
{
  const mk = (docs, rows = []) => ({
    user: { isGM: true }, settings: makeSettings(['namespaceMigrationDone', 'traceLog'], rows),
    actors: collection(docs), items: collection([]), journal: collection([]), scenes: collection([]), users: collection([]), macros: collection([]), folders: collection([]), messages: collection([]),
  });
  globalThis.game = mk([]);
  confirmCalls = 0; reloads = 0; notices = [];
  check('fresh world: stamps done without prompting or reloading', async () => {});
  const fresh = await runNamespaceMigration();
  check('fresh → "fresh", no dialog, no reload, flag set', () => { assert.equal(fresh, 'fresh'); assert.equal(confirmCalls, 0); assert.equal(reloads, 0); assert.equal(game.settings.get(NEW, 'namespaceMigrationDone'), true); });
  check('stamped world short-circuits', async () => {});
  const again = await runNamespaceMigration();
  check('done flag → "skipped"', () => assert.equal(again, 'skipped'));

  const legacyActor = () => new FakeDoc('V', { [OLD]: { email: 'v@nc.net' } }, 'Actor');
  globalThis.game = mk([legacyActor()], [{ key: `${OLD}.traceLog`, value: [] }]);
  confirmAnswer = false; confirmCalls = 0; reloads = 0;
  const declined = await runNamespaceMigration();
  check('declined → nothing written, not stamped, no reload', () => { assert.equal(declined, 'declined'); assert.equal(confirmCalls, 1); assert.equal(reloads, 0); assert.equal(game.settings.get(NEW, 'namespaceMigrationDone'), false); assert.ok(hasLegacyFlags(game.actors[0])); });

  confirmAnswer = true; confirmCalls = 0; reloads = 0; notices = [];
  const migrated = await runNamespaceMigration();
  check('accepted → migrated, stamped, reload requested', () => { assert.equal(migrated, 'migrated'); assert.equal(reloads, 1); assert.equal(game.settings.get(NEW, 'namespaceMigrationDone'), true); assert.equal(game.actors[0].flags[NEW].email, 'v@nc.net'); assert.deepEqual(game.settings.get(NEW, 'traceLog'), []); });
  check('success notice posted', () => assert.ok(notices.some(([lvl, m]) => lvl === 'info' && /migrated/i.test(m))));

  globalThis.game = mk([legacyActor()]); globalThis.game.user.isGM = false; confirmCalls = 0;
  const player = await runNamespaceMigration();
  check('non-GM never prompts or writes', () => { assert.equal(player, 'skipped'); assert.equal(confirmCalls, 0); assert.ok(hasLegacyFlags(game.actors[0])); });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
