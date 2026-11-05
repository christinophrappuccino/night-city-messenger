// Sim: scan caching and growth (audit remediation D5: PERF-05, PERF-06, PERF-07, PERF-09).
//
//   PERF-05  Admin → Messages walked every page in the world on every render, and re-rendered once per mail event.
//   PERF-06  the GM's Switch-inbox drawer walked all mail on every viewer render.
//   PERF-07  the recycle bin was one ever-growing world setting, re-sent whole to every client on each wipe.
//   PERF-09  heat entries that had cooled to zero were kept forever.
// Drives the REAL mailRevision, MessagesTab, SiphonFlow bin and TraceService methods over fakes.
import { pathToFileURL, fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const load = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
const read = (p) => readFileSync(`${ROOT}/${p}`, 'utf8');
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };
const MOD = 'night-city-messenger';

// ── a small world ──
const hooks = {};
const settings = new Map();
const journals = [];
globalThis.Hooks = { on: (n, fn) => { (hooks[n] ||= []).push(fn); return hooks[n].length; }, off() {}, once() {}, callAll: (n, ...a) => (hooks[n] || []).forEach((f) => f(...a)) };
globalThis.game = {
  user: { id: 'gm', isGM: true },
  users: Object.assign([], { get: () => null, activeGM: { id: 'gm' } }),
  actors: Object.assign([], { get: () => null }),
  journal: Object.assign(journals, { get: (id) => journals.find((j) => j.id === id) || null }),
  settings: { get: (m, k) => JSON.parse(JSON.stringify(settings.get(k) ?? null)), set: async (m, k, v) => { settings.set(k, JSON.parse(JSON.stringify(v))); } },
  nightcity: {},
};
const mkJournal = (data) => {
  const j = { id: `j${journals.length + 1}`, ...data, pages: [] };
  j.getFlag = (m, k) => j.flags?.[MOD]?.[k];
  j.createEmbeddedDocuments = async (t, docs) => { const out = docs.map((d, i) => ({ id: `p${j.pages.length + i}`, ...JSON.parse(JSON.stringify(d)), parent: j })); j.pages.push(...out); return out; };
  j.deleteEmbeddedDocuments = async (t, ids) => { j.pages = j.pages.filter((p) => !ids.includes(p.id)); };
  journals.push(j); return j;
};
globalThis.JournalEntry = { create: async (d) => mkJournal(d) };
globalThis.foundry = { utils: { deepClone: (o) => JSON.parse(JSON.stringify(o)), randomID: (n = 8) => Math.random().toString(36).slice(2, 2 + n), mergeObject: (a, b) => ({ ...a, ...b }) }, applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (B) => B }, instances: new Map() } };
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
globalThis.CONFIG = {};

const MR = await load('scripts/utils/mailRevision.js');

// ═══ 1. The revision and the memo ═══
{
  const holder = {};
  let runs = 0;
  const f = () => MR.memoByRevision(holder, 'x', 'a', () => ++runs);
  f(); f();
  ok(runs === 1, 'nothing changed: the scan runs once');
  MR.bumpMailRevision(); f();
  ok(runs === 2, 'the revision moved: it runs again');
  MR.memoByRevision(holder, 'x', 'b', () => ++runs);
  ok(runs === 3, 'something else it depends on changed: it runs again');
  MR.wireMailRevision(); MR.wireMailRevision();
  const r0 = MR.mailRevision();
  Hooks.callAll('updateJournalEntryPage', {});
  ok(MR.mailRevision() === r0 + 1, 'a mail page change moves it (once, however often it was wired)');
  Hooks.callAll('updateActor', {}); Hooks.callAll('deleteJournalEntry', {});
  ok(MR.mailRevision() === r0 + 3, 'so does an actor or a journal change');
  Hooks.callAll('updateSetting', { key: `${MOD}.masterContacts` });
  ok(MR.mailRevision() === r0 + 4, 'and a directory change');
  Hooks.callAll('updateSetting', { key: `${MOD}.soundVolume` });
  ok(MR.mailRevision() === r0 + 4, 'an unrelated setting does not');
}

// ═══ 2. Admin → Messages remembers its scans (PERF-05) ═══
{
  const { MessagesTab } = await load('scripts/ui/AdminPanel/tabs/MessagesTab.js');
  const tab = Object.create(MessagesTab.prototype);
  let scans = 0, walks = 0, vias = 0;
  let clock = 60_000 * 1000;
  tab._nowMs = () => clock;
  tab._scanInboxesNow = () => { scans += 1; return { inboxes: [], viaByBase: new Map(), anonRealByBase: new Map() }; };
  tab._sentViaIndexNow = () => { vias += 1; return new Map(); };
  tab._activityEntriesNow = () => { walks += 1; return [{ messageId: 'm1', rawTimestamp: clock - 1000 }, { messageId: 'm2', rawTimestamp: clock - 3_600_000 }]; };
  tab._pendingEntries = () => [];
  tab._filterActivity = (entries) => ({ entries });
  tab._scanInboxes(); tab._scanInboxes(); tab._sentViaIndex(); tab._sentViaIndex();
  ok(scans === 1 && vias === 1, 'two renders with no mail change scan the inboxes once');
  tab._expandedId = 'm2';
  let res = tab._gatherActivity();
  tab._gatherActivity();
  ok(walks === 1, 'the activity feed walks the pages once while nothing changes');
  ok(res.entries.find((e) => e.messageId === 'm2').isExpanded && !res.entries.find((e) => e.messageId === 'm1').isExpanded, 'the open row is this render\'s (not the remembered one)');
  ok(res.entries.find((e) => e.messageId === 'm1').isRecent, '"just now" is worked out fresh');
  tab._expandedId = 'm1';
  res = tab._gatherActivity();
  ok(walks === 1 && res.entries.find((e) => e.messageId === 'm1').isExpanded, 'opening another row needs no new walk');
  clock += 60_000;
  tab._gatherActivity();
  ok(walks === 2, 'a new game minute walks again ("… ago" labels move)');
  Hooks.callAll('createJournalEntryPage', {});
  tab._gatherActivity(); tab._scanInboxes();
  ok(walks === 3 && scans === 2, 'new mail walks again');
  const admin = read('scripts/ui/AdminPanel/AdminPanelApp.js');
  ok(/_refreshIfTab\(\.\.\.tabs\) \{[\s\S]{0,300}this\._debouncedRender\(\);/.test(admin), 'mail events re-render the panel once per burst (debounced)');
}

// ═══ 3. The Switch-inbox roster is remembered (PERF-06) ═══
ok(/return memoByRevision\(ROSTER_MEMO, 'roster', null, gmInboxRosterNow\);/.test(read('scripts/utils/inboxRoster.js')), 'the GM\'s inbox roster is remembered until mail / actors / the directory change');
ok(/wireMailRevision\(\);/.test(read('scripts/integrations/DocumentSyncBridge.js')), 'the revision is wired with the document hooks');

// ═══ 4. The recycle bin is a GM-only journal (PERF-07) ═══
{
  const SF = await load('scripts/ui/content/SiphonFlow.js');
  settings.set('recycleBin', [
    { id: 'rb-old1', ts: '2045-01-01T00:00:00Z', pageName: 'Old memo', journalId: null, pageData: { name: 'Old memo' } },
    { id: 'rb-old2', ts: '2045-01-02T00:00:00Z', pageName: 'Old log', journalId: null, pageData: { name: 'Old log' } },
  ]);
  ok(SF.getRecycleBin().length === 2 && SF.getRecycleBin().every((r) => r.legacy), 'before the migration the old bin entries still show');
  const moved = await SF.migrateRecycleBin();
  const j = SF.recycleJournal();
  ok(moved === 2 && j?.pages.length === 2 && j.ownership?.default === 0, 'the migration moves them into one GM-only journal');
  ok(!(settings.get('recycleBin') || []).length, '…and empties the old setting');
  ok((await SF.migrateRecycleBin()) === 0 && j.pages.length === 2, 'running it twice moves nothing twice');
  ok(SF.getRecycleBin().map((r) => r.pageName).join() === 'Old memo,Old log', 'the bin reads oldest first');
  // a real wipe, then restore and empty
  const box = mkJournal({ name: 'Box', flags: { [MOD]: { type: 'inbox', actorId: 'v' } } });
  const page = { id: 'pg1', name: 'Secret', parent: box, flags: { [MOD]: { messageId: 'm-secret', contentType: 'message' } }, toObject: () => ({ name: 'Secret', flags: { [MOD]: { messageId: 'm-secret' } } }), delete: async () => { box.pages = box.pages.filter((p) => p !== page); } };
  box.pages.push(page);
  await SF._applyNativeEffect('wipe', { page: { id: 'prog', parent: box }, hostItem: null, actor: null, cd: { effect: { params: { messageIds: ['m-secret'] } } } });
  const rec = SF.getRecycleBin().find((r) => r.pageName === 'Secret');
  ok(rec && !box.pages.length && j.pages.length === 3, 'a wipe adds ONE page to the bin journal and removes the file');
  ok(!j.pages.some((p) => p.flags?.[MOD]?.messageId), 'no bin page carries a message id (a lookup can never act on a wiped file)');
  rec.journalId = box.id; j.pages.find((p) => p.flags[MOD].recycled.id === rec.id).flags[MOD].recycled.journalId = box.id;
  ok(await SF.restoreWiped(rec.id), 'Restore puts it back…');
  ok(box.pages.some((p) => p.name === 'Secret') && !SF.getRecycleBin().some((r) => r.id === rec.id), '…in its own journal, and it leaves the bin');
  await SF.emptyRecycleBin(['rb-old1']);
  ok(SF.getRecycleBin().map((r) => r.id).join() === 'rb-old2', 'Purge removes just that one');
  await SF.emptyRecycleBin();
  ok(!SF.getRecycleBin().length && !j.pages.length, 'Empty removes everything');
  const sec = read('scripts/ui/AdminPanel/tabs/SecurityTab.js');
  ok(/const binAll = getRecycleBin\(\)/.test(sec) && !/ts\.getRecycleBin/.test(sec), 'the Security tab reads the real bin (it asked the trace service, which has none — the card was always empty)');
  ok(/to: 6,[\s\S]{0,400}migrateRecycleBin/.test(read('scripts/core/MigrationRunner.js')), 'migration v6 moves the old bin');
}

// ═══ 5. Cold heat is dropped (PERF-09) ═══
{
  const { TraceService } = await load('scripts/services/TraceService.js');
  const t = Object.create(TraceService.prototype);
  const now = Date.parse('2045-08-14T12:00:00Z');
  t._nowMs = () => now;
  const map = {
    term1: { aV: { value: 30, ts: '2045-08-14T11:00:00Z' }, aR: { value: 5, ts: '2045-08-13T00:00:00Z' } },
    net1: { aV: { value: 10, ts: '2045-08-12T00:00:00Z' } },
  };
  t._pruneHeat(map);
  ok(map.term1.aV && !map.term1.aR && !map.net1, 'entries cooled to 0 go, and objects left empty go with them');
  const src = read('scripts/services/TraceService.js');
  ok((src.match(/game\.settings\.set\(MODULE_ID, HEAT_SETTING, this\._pruneHeat\(map\)\)/g) || []).length === 2, 'both heat writers prune before saving');
}

console.log(`test-mail-scan-cache: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
