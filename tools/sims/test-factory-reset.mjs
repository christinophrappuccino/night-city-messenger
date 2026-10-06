// Sim: Tools → Danger Zone → Factory Reset (scripts/core/FactoryReset.js).
// Drives the REAL gatherResetPlan / runFactoryReset against a mocked world:
//   • the census counts what the run then removes (journals + folder tree,
//     terminal pins, managed macros, flag blocks incl. embedded, settings)
//   • non-NCM documents and GM-authored macros survive (flags stripped only)
//   • the two internal stamps are kept / re-stamped; resetSettings:false keeps
//     configuration but still stamps the schema
//   node tools/sims/test-factory-reset.mjs
import { pathToFileURL } from 'url';

const ROOT = 'C:/Users/cphan/AppData/Local/FoundryVTT/Data/modules/night-city-messenger';
const MOD = 'night-city-messenger';
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };

// ── Document mocks ──
const ops = { deletedJournals: [], deletedMacros: [], deletedFolders: [], deletedNotes: [], updates: [], settingsSet: [] };
function doc(id, extra = {}, ncmFlags = null) {
  const d = { id, flags: ncmFlags ? { [MOD]: ncmFlags } : {}, ...extra };
  d.getFlag = (s, k) => d.flags?.[s]?.[k];
  return d;
}
function collection(name, docs, embeddedName) {
  const arr = [...docs];
  arr.documentClass = { updateDocuments: async (u) => { ops.updates.push({ coll: name, u }); } };
  for (const d of arr) {
    d.getEmbeddedCollection = (n) => (n === embeddedName ? d[`_${n}`] ?? null : null);
    d.updateEmbeddedDocuments = async (n, u) => { ops.updates.push({ coll: `${name}.${n}`, parent: d.id, u }); };
    d.deleteEmbeddedDocuments = async (n, ids) => { ops.deletedNotes.push(...ids); d._Note = d._Note.filter(x => !ids.includes(x.id)); };
  }
  return arr;
}

const rootFolder = doc('f-root', { type: 'JournalEntry', name: 'Night City Messenger', folder: null });
const inboxFolder = doc('f-inbox', { type: 'JournalEntry', name: 'Inboxes', folder: rootFolder });
const deletedFolder = doc('f-del', { type: 'JournalEntry', name: 'Deleted', folder: rootFolder });
const userFolder = doc('f-user', { type: 'JournalEntry', name: 'Lore', folder: null });
const macroFolder = doc('f-mac', { type: 'Macro', name: 'NCM — GM Tools', folder: null, contents: [] });
for (const f of [rootFolder, inboxFolder, deletedFolder, userFolder, macroFolder]) {
  f.delete = async (opts) => { ops.deletedFolders.push({ id: f.id, opts }); };
}

const journals = [
  doc('j-inbox', { name: 'V — Inbox', folder: inboxFolder }, { type: 'inbox', actorId: 'pc1' }),
  doc('j-term', { name: 'Term', folder: rootFolder }, { type: 'terminal', linkedItemId: 'it-term' }),
  doc('j-stray', { name: 'Stray in Deleted', folder: deletedFolder }),      // no flags, but inside the tree
  doc('j-lore', { name: 'Lore', folder: userFolder }),                      // untouched
  doc('j-lore2', { name: 'Loose', folder: null }),                          // untouched
];
const pc1 = doc('pc1', {}, { contacts: [{ id: 'c1' }], email: 'v@nc.net' });
pc1._Item = [doc('it-shard', {}, { isDataShard: true }), doc('it-plain', {})];
const npc = doc('npc', {});
npc._Item = [];
const scene = doc('s1', {}, { deadZone: true });
scene._Note = [doc('n-pin', {}, { terminalItemId: 'it-term' }), doc('n-map', {})];
// Scene#notes is the live embedded collection in Foundry — mirror it.
Object.defineProperty(scene, 'notes', { get() { return scene._Note; } });
const macros = [
  doc('m-managed', {}, { managed: true, sourceId: 'x' }),
  doc('m-mine', {}, { sourceId: 'y' }),   // GM-detached: flags stripped, macro kept
  doc('m-other', {}),
];

const settingsMap = new Map();
const reg = (key, scope, def) => settingsMap.set(`${MOD}.${key}`, { namespace: MOD, key, scope, default: def });
reg('masterContacts', 'world', []);
reg('networks', 'world', {});
reg('traceLog', 'world', []);
reg('adminTheme', 'client', { preset: 'clean-dark' });
reg('namespaceMigrationDone', 'world', false);
reg('dataSchemaVersion', 'world', 0);
settingsMap.set('other-module.thing', { namespace: 'other-module', key: 'thing', scope: 'world', default: 1 });

globalThis.game = {
  folders: [rootFolder, inboxFolder, deletedFolder, userFolder, macroFolder],
  journal: collection('journal', journals, 'JournalEntryPage'),
  actors: collection('actors', [pc1, npc], 'Item'),
  items: collection('items', [doc('it-term', {}, { isTerminal: true }), doc('it-x', {})]),
  scenes: collection('scenes', [scene], 'Note'),
  users: collection('users', [doc('u1', {}, { seen: true })]),
  macros: collection('macros', macros),
  messages: collection('messages', [doc('cm1', {}, { card: true })]),
  user: { isGM: true },
  settings: {
    settings: settingsMap,
    get: () => false,
    set: async (ns, key, val) => { ops.settingsSet.push({ key, val }); },
  },
};
// scenes need Note as the embedded collection name
game.scenes[0].getEmbeddedCollection = (n) => (n === 'Note' ? scene._Note : null);
game.scenes[0].deleteEmbeddedDocuments = async (n, ids) => { ops.deletedNotes.push(...ids); scene._Note = scene._Note.filter(x => !ids.includes(x.id)); };
globalThis.JournalEntry = { deleteDocuments: async (ids) => { ops.deletedJournals.push(...ids); } };
globalThis.Macro = { deleteDocuments: async (ids) => { ops.deletedMacros.push(...ids); } };
globalThis.foundry = { utils: { deepClone: (o) => JSON.parse(JSON.stringify(o)), randomID: () => 'id', mergeObject: (a, b) => ({ ...a, ...b }) } };
globalThis.Hooks = { on: () => {}, once: () => {}, off: () => {}, call: () => true };
globalThis.ui = { notifications: { info: () => {}, warn: () => {}, error: () => {} } };

const FR = await import(pathToFileURL(`${ROOT}/scripts/core/FactoryReset.js`).href);

// ═══ Census ═══
const plan = FR.gatherResetPlan();
ok(plan.journals === 3, `plan: 3 journals (flagged + inside the tree) — got ${plan.journals}`);
ok(plan.folders === 3, `plan: 3 folders in the NCM tree — got ${plan.folders}`);
ok(plan.pins === 1, 'plan: 1 terminal pin');
ok(plan.managedMacros === 1, 'plan: 1 managed macro');
ok(plan.settings === 3, `plan: 3 resettable world settings (client + keep-list + other module excluded) — got ${plan.settings}`);
const flagged = Object.fromEntries(plan.flagged.map(f => [f.label, f.count]));
ok(flagged.actors === 1 && flagged['actors → Item'] === 1, 'plan: actor + its shard item counted');
ok(flagged.items === 1 && flagged.scenes === 1 && flagged.users === 1 && flagged.messages === 1, 'plan: items/scenes/users/messages counted');
ok(flagged.macros === 1, 'plan: the GM-detached macro counts as a flag strip, the managed one does not');
ok(!('scenes → Note' in flagged), 'plan: the pin is not double-counted as a Note flag');

// ═══ Run ═══
const r = await FR.runFactoryReset({ resetSettings: true, reload: false });
ok(r.journals === 3 && ops.deletedJournals.sort().join() === 'j-inbox,j-stray,j-term', 'run: the 3 NCM journals deleted, user journals kept');
ok(ops.deletedFolders.some(f => f.id === 'f-root' && f.opts?.deleteSubfolders && f.opts?.deleteContents), 'run: root folder deleted with its subtree');
ok(!ops.deletedFolders.some(f => f.id === 'f-user'), 'run: user journal folder untouched');
ok(r.pins === 1 && ops.deletedNotes.join() === 'n-pin', 'run: only the terminal pin note deleted');
ok(r.macros === 1 && ops.deletedMacros.join() === 'm-managed', 'run: managed macro deleted, GM macros kept');
ok(ops.deletedFolders.some(f => f.id === 'f-mac'), 'run: empty macro folder removed');
const strip = (coll) => ops.updates.filter(u => u.coll === coll).flatMap(u => u.u);
ok(strip('actors').length === 1 && strip('actors')[0][`flags.-=${MOD}`] === null && strip('actors')[0]._id === 'pc1', 'run: actor flag block stripped via -= key');
ok(strip('actors.Item').length === 1 && strip('actors.Item')[0]._id === 'it-shard', 'run: only the flagged embedded item updated');
ok(strip('items').length === 1 && strip('scenes').length === 1 && strip('users').length === 1 && strip('messages').length === 1, 'run: items/scenes/users/messages stripped');
ok(strip('macros').length === 1 && strip('macros')[0]._id === 'm-mine', 'run: detached macro loses its flag block only');
ok(strip('journal').length === 0, 'run: journals are never "stripped" (they are deleted)');
ok(r.stripped === 7, `run: 7 flag blocks stripped — got ${r.stripped}`);
const setKeys = ops.settingsSet.map(s => s.key);
ok(r.settings === 3 && ['masterContacts', 'networks', 'traceLog'].every(k => setKeys.includes(k)), 'run: world settings reset to defaults');
ok(!setKeys.includes('adminTheme'), 'run: client settings untouched');
ok(ops.settingsSet.find(s => s.key === 'namespaceMigrationDone')?.val === true, 'run: migration stamp KEPT true (no re-prompt)');
ok(typeof ops.settingsSet.find(s => s.key === 'dataSchemaVersion')?.val === 'number' && ops.settingsSet.find(s => s.key === 'dataSchemaVersion').val >= 1, 'run: schema stamped current');
const mcDefault = ops.settingsSet.find(s => s.key === 'masterContacts').val;
ok(Array.isArray(mcDefault) && mcDefault !== settingsMap.get(`${MOD}.masterContacts`).default, 'run: object defaults are cloned, not shared');

// ═══ resetSettings:false — data wiped, configuration kept ═══
ops.settingsSet.length = 0;
const r2 = await FR.runFactoryReset({ resetSettings: false, reload: false });
ok(r2.settings === 0 && !ops.settingsSet.find(s => s.key === 'masterContacts'), 'keep-config: no world setting reset');
ok(ops.settingsSet.find(s => s.key === 'dataSchemaVersion'), 'keep-config: schema still stamped');

// ═══ GM gate ═══
game.user.isGM = false;
let threw = false;
try { await FR.runFactoryReset({ reload: false }); } catch { threw = true; }
ok(threw, 'non-GM call throws');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
