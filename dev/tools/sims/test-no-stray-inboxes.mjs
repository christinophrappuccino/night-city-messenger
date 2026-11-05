// Sim: no inbox journals from counting (audit remediation D1: PERF-01).
//
// The GM's unread badge asked every actor the GM owns (all of them) for its unread count. The count read the inbox
// through getInboxJournal, which CREATED a journal when none existed — so the world filled with empty inboxes for
// every NPC, container and Black ICE. The badge then recounted every inbox two to four times per mail event.
// Drives the REAL MessageRepository and NotificationService.
import { pathToFileURL, fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const load = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
const read = (p) => readFileSync(`${ROOT}/${p}`, 'utf8');
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };
const MOD = 'night-city-messenger';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const journals = [];
let created = 0;
const actors = ['pc', 'npc1', 'npc2', 'van', 'ice'].map((id) => ({ id, name: id, isOwner: true, hasPlayerOwner: id === 'pc', getFlag: () => null, ownership: {} }));
const mkJournal = (data) => {
  const pages = [];
  const j = { id: `j${journals.length + 1}`, ...data, pages: Object.assign(pages, { contents: pages }), getFlag: (m, k) => data.flags?.[MOD]?.[k],
    async createEmbeddedDocuments(t, docs) { const out = docs.map((d, i) => ({ id: `p${pages.length + i}`, ...d, parent: j })); pages.push(...out); return out; },
    async update() {} };
  return j;
};
journals.push(mkJournal({ name: 'pc — Inbox', flags: { [MOD]: { type: 'inbox', actorId: 'pc' } } }));
globalThis.game = {
  user: { id: 'gm', isGM: true },
  actors: Object.assign(actors, { get: (id) => actors.find((a) => a.id === id) || null }),
  journal: Object.assign(journals, { get: (id) => journals.find((j) => j.id === id) || null }),
  folders: Object.assign([], { get: () => null }),
  settings: { get: () => undefined },
  nightcity: { masterContactService: { getContact: () => null } },
};
globalThis.JournalEntry = { create: async (d) => { created += 1; const j = mkJournal(d); journals.push(j); return j; } };
globalThis.Folder = { create: async (d) => ({ id: `f${Math.random()}`, ...d }) };
globalThis.foundry = { utils: { deepClone: (o) => JSON.parse(JSON.stringify(o)), randomID: () => 'r', mergeObject: (a, b) => ({ ...a, ...b }) } };
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, OBSERVER: 2, OWNER: 3 } };
globalThis.Hooks = { on() {}, off() {}, once() {} };
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };

const { MessageRepository } = await load('scripts/data/MessageRepository.js');
const repo = new MessageRepository();
repo._repairPermissions = async () => {};

// ═══ 1. Reading, counting and changing mail never make an inbox ═══
for (const a of actors) await repo.getUnreadCount(a.id);
ok(created === 0, 'counting unread for every actor makes no inbox (it made one per NPC, van and Black ICE)');
await repo.getMessages('npc1');
await repo.getMessage('npc1', 'm1');
await repo.markAllAsRead('npc2');
await repo.updateMessage('van', 'm1', { subject: 'x' });
await repo.hardDeleteMessage('ice', 'm1');
ok(created === 0, 'reading one, marking read, editing or deleting mail makes no inbox either');
ok((await repo.getInboxJournal('npc1', { create: false })) === null, 'asking without create gives null when there is none');
ok((await repo.getInboxJournal('pc', { create: false }))?.id === 'j1', '…and the inbox when there is one');

// ═══ 2. Writing mail still makes one ═══
const r = await repo.createMessage('npc1', { messageId: 'm9', subject: 'job', body: '', from: 'v@nc', status: {}, timestamp: new Date().toISOString() });
ok(created === 1 && journals.some((j) => j.flags?.[MOD]?.actorId === 'npc1'), `the first mail to an NPC creates its inbox${r?.success === false ? ` (createMessage said: ${r.error})` : ''}`);

// ═══ 3. One recount for a burst of mail events ═══
{
  const { NotificationService } = await load('scripts/services/NotificationService.js');
  const ns = Object.create(NotificationService.prototype);
  let recounts = 0;
  ns._refreshAllUnreadCounts = async () => { recounts += 1; };
  const ps = [ns.refreshBadge(), ns.refreshBadge(), ns.refreshBadge(), ns.refreshBadge()];
  ok(ps.every((p) => p === ps[0]), 'every call in a burst shares one promise');
  await Promise.all(ps);
  ok(recounts === 1, 'four refreshes in a burst recount once');
  await ns.refreshBadge();
  ok(recounts === 2, 'a later refresh recounts again');
}

// ═══ 4. Orphan Audit lists empty inboxes (deleted only if the GM ticks the box) ═══
{
  const { ToolsTab } = await load('scripts/ui/AdminPanel/tabs/ToolsTab.js');
  const tools = Object.create(ToolsTab.prototype);
  Object.defineProperty(tools, 'masterContactService', { value: { getContact: () => null } });
  game.scenes = []; game.settings.get = () => ({});
  const empty = mkJournal({ name: 'npc2 — Inbox', flags: { [MOD]: { type: 'inbox', actorId: 'npc2' } } });
  journals.push(empty);
  let found = null;
  try { found = tools._gatherOrphans(); } catch (err) { ok(false, `_gatherOrphans runs (${err.message})`); }
  if (found) {
    const withMail = journals.find((j) => j.flags?.[MOD]?.actorId === 'npc1');   // got its first mail in section 2
    ok(found.emptyInboxes.some((o) => o.journal === empty), 'an inbox with no pages, for an actor that exists, is listed as empty');
    ok(!found.emptyInboxes.some((o) => o.journal === withMail) && !found.inboxes.some((o) => o.journal === empty), 'an inbox with mail is not, and an empty one is not called an orphan');
  }
  const src = read('scripts/ui/AdminPanel/tabs/ToolsTab.js');
  ok(/name="ncm-orphan-empty"/.test(src) && /if \(delEmpty\)/.test(src) && !/name="ncm-orphan-empty" checked/.test(src), 'they are deleted only when the unticked box is ticked');
}

// ═══ 5. Wiring ═══
const reg = read('scripts/init/registerMessagingSystem.js');
const wiring = reg.slice(reg.indexOf("'Messaging event wiring'"), reg.indexOf("eventBus.on(EVENTS.MESSAGE_SENT"));
ok(!/refreshBadge/.test(wiring), 'the messaging wiring no longer recounts the badge (NotificationService already does)');
const repoSrc = read('scripts/data/MessageRepository.js');
const callers = repoSrc.match(/await this\.getInboxJournal\([^)]*\)/g) || [];
ok(callers.filter((c) => !/create: false/.test(c)).length === 1 && /getInboxJournal\(recipientId\)/.test(repoSrc), 'inside the repository, only createMessage may create an inbox');

console.log(`test-no-stray-inboxes: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
