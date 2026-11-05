// test-world-lib — the shared mock world (dev/tools/sims/lib/world.mjs) behaves like Foundry where sims rely on it,
// and real NCM code runs on it (stage 2, batch 7). New sims build their world with createMockWorld().
// Run: node dev/tools/sims/test-world-lib.mjs
import { pathToFileURL, fileURLToPath } from 'url';
import { createMockWorld } from './lib/world.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
const throws = async (fn) => { try { await fn(); return false; } catch { return true; } };
const M = 'night-city-messenger';
const quietInfo = console.info; console.info = () => {};

const world = await createMockWorld({
  users: [{ id: 'gm1', name: 'GM', isGM: true }, { id: 'p1', name: 'Rache' }, { id: 'p2', name: 'Kai' }],
  actors: [
    { id: 'a1', name: 'V', type: 'character', owners: ['p1'], system: { wealth: { value: 100, transactions: [] } }, items: [{ id: 'it1', name: 'Agent' }] },
    { id: 'n1', name: 'Rogue', type: 'character' },
  ],
  items: [{ id: 'i1', name: 'Shard', flags: { [M]: { isDataShard: true, config: { encrypted: true } } } }],
  journals: [
    { id: 'j1', name: 'V — Inbox', flags: { [M]: { type: 'inbox', actorId: 'a1' } }, pages: [{ id: 'pg1', name: 'Hello', flags: { [M]: { messageId: 'm1' } } }] },
    { id: 'j2', name: 'Fixer — Mail', flags: { [M]: { type: 'contactInbox', contactId: 'c9' } } },
  ],
  settings: { callsEnabled: false },
  realSettings: true,
});

// ═══ 1. globals and users ═══
ok(game.user.id === 'gm1' && game.user.isGM, 'the first user is game.user');
ok(game.users.activeGM?.id === 'gm1', 'users.activeGM is the connected GM');
ok(world.as('p1', () => game.user.name) === 'Rache' && game.user.id === 'gm1', 'world.as runs as another user and switches back');
ok(typeof foundry.utils.mergeObject === 'function' && typeof Hooks.on === 'function' && typeof ui.notifications.warn === 'function', 'foundry.utils, Hooks and ui are installed');

// ═══ 2. settings: the REAL registrations ═══
ok(game.settings.settings.size > 100, `NCM's real settings are registered (${game.settings.settings.size})`);
ok(game.settings.get(M, 'anonSendEnabled') === true, 'an unset setting reads its REAL registered default (anonSendEnabled: true)');
ok(game.settings.get(M, 'callsEnabled') === false, 'a value the sim gives is laid over the default');
ok(await throws(() => game.settings.get(M, 'noSuchSetting')), 'reading an unregistered setting throws, like Foundry');
let heard = null; const hid = Hooks.on('updateSetting', (s) => { heard = s; });
await game.settings.set(M, 'callsEnabled', true);
ok(heard?.key === `${M}.callsEnabled` && heard.value === true && game.settings.get(M, 'callsEnabled') === true, 'set() saves and fires updateSetting');
Hooks.off('updateSetting', hid);
const { getSetting } = await imp('scripts/utils/helpers.js');
ok(getSetting('anonSendEnabled', true) === true && getSetting('noSuchSetting', 'fb') === 'fb', 'the real getSetting works on it');

// ═══ 3. documents ═══
const v = game.actors.get('a1');
ok(world.as('p1', () => v.isOwner) && !world.as('p2', () => v.isOwner) && v.isOwner, 'isOwner: the owning player and any GM, not another player');
ok(v.hasPlayerOwner && !game.actors.get('n1').hasPlayerOwner, 'hasPlayerOwner');
await v.setFlag(M, 'email', 'v@nc.net');
ok(v.getFlag(M, 'email') === 'v@nc.net', 'setFlag / getFlag');
await v.update({ [`flags.${M}.contacts`]: [{ id: 'x' }], 'system.wealth.value': 150 });
ok(v.getFlag(M, 'contacts')?.length === 1 && v.system.wealth.value === 150 && v.system.wealth.transactions, 'update() takes dot paths and leaves siblings alone');
await v.update({ [`flags.${M}.-=contacts`]: null });
ok(v.getFlag(M, 'contacts') === undefined && v.getFlag(M, 'email') === 'v@nc.net', 'update() deletes a `-=key`');
await v.unsetFlag(M, 'email');
ok(v.getFlag(M, 'email') === undefined, 'unsetFlag');
ok(world.writes.length >= 4 && world.writes.every((w) => w.doc === 'Actor.a1'), 'every write is recorded');
ok(world.hooks.calls.some((c) => c.name === 'updateActor'), 'updates fire update<Document> hooks');

// embedded
ok(v.items.get('it1')?.parent === v && v.items.get('it1').uuid === 'Actor.a1.Item.it1', 'embedded items know their parent and uuid');
ok(world.fromUuid('Actor.a1.Item.it1') === v.items.get('it1') && fromUuidSync('JournalEntry.j1.JournalEntryPage.pg1')?.name === 'Hello', 'fromUuid / fromUuidSync resolve embedded documents');
const j1 = game.journal.get('j1');
let created = 0; Hooks.on('createJournalEntryPage', () => { created++; });
const [page] = await j1.createEmbeddedDocuments('JournalEntryPage', [{ name: 'Second', flags: { [M]: { messageId: 'm2' } } }]);
ok(j1.pages.size === 2 && page.getFlag(M, 'messageId') === 'm2' && created === 1, 'createEmbeddedDocuments adds pages and fires the hook');
await j1.deleteEmbeddedDocuments('JournalEntryPage', [page.id]);
ok(j1.pages.size === 1, 'deleteEmbeddedDocuments removes them');
const made = await Actor.create({ name: 'New', type: 'character' });
ok(game.actors.get(made.id) === made && made.items.size === 0, 'Actor.create adds a document with its embedded collection');

// a refused write and a slow one
const slow = await Actor.create({ name: 'Slow', latencyMs: 20, system: { wealth: { value: 0, transactions: [] } } });
const t0 = Date.now(); await slow.update({ name: 'Slower' });
ok(Date.now() - t0 >= 15 && slow.name === 'Slower', 'latencyMs makes a write take time, like a server round trip');
const locked = await Actor.create({ name: 'Locked', refuse: true });
ok(await throws(() => locked.update({ name: 'x' })), 'refuse: true makes a write fail, like a permission error');

// ═══ 4. real NCM code on it ═══
const { MessageRepository } = await imp('scripts/data/MessageRepository.js');
ok(MessageRepository.identifyInbox(game.journal.get('j1'))?.ownerId === 'a1' && MessageRepository.identifyInbox(game.journal.get('j2'))?.isContact === true, 'MessageRepository.identifyInbox reads the mock journals');
const { adjustWealth } = await imp('scripts/utils/wealth.js');
await Promise.all([adjustWealth(slow, 10, 'a'), adjustWealth(slow, 5, 'b')]);
ok(slow.system.wealth.value === 15 && slow.system.wealth.transactions.length === 2, 'the real adjustWealth runs on a slow mock actor and keeps both changes');
ui.notifications.warn('hello');
ok(world.toasts.at(-1)?.level === 'warn' && world.toasts.at(-1).msg === 'hello', 'toasts are recorded');
await ChatMessage.create({ content: 'x', whisper: ['gm1'] });
ok(world.chat.length === 1 && ChatMessage.getWhisperRecipients('GM').length === 1, 'chat messages are recorded; GM whisper recipients resolve');

// ═══ 5. a second world in the same process ═══
const w2 = await createMockWorld({ users: [{ id: 'p9', name: 'Solo' }], realSettings: true });
ok(game.user.id === 'p9' && game.settings.get(M, 'anonSendEnabled') === true && !game.actors.size, 'a second world replaces the first cleanly (settings registered again)');
void w2;

console.info = quietInfo;
console.log(`test-world-lib: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
