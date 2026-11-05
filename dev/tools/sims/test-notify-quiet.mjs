// Sim: notifications and flag writes (audit remediation E3).
//   INT-07  the doc-sync toast skips already-read pages, tap/exfil copies and files, and a second GM is no longer
//           toasted for everyone's mail
//   INT-05  a conversation's tap log is written one line at a time (no duplicate log pages, no lost lines)
//   INT-10  updateMessageFlags writes only the fields it changes, so a stale copy can't put back a claimed/read flag
// Drives the real module code with mocked Foundry globals.
import { pathToFileURL, fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };
const MOD = 'night-city-messenger';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const actors = new Map([['v', { id: 'v', isOwner: true }]]);
globalThis.game = {
  user: { id: 'p1', isGM: false, character: { id: 'v' } }, users: { get: () => null },
  actors: { get: (id) => actors.get(id) || null },
  settings: { get: () => undefined }, nightcity: {},
};
globalThis.foundry = { utils: { deepClone: (o) => JSON.parse(JSON.stringify(o)), mergeObject: (a, b) => ({ ...a, ...b }), randomID: () => 'r' } };
globalThis.Hooks = { on() {}, off() {}, once() {} };
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };

// ═══ 1. INT-07 ═══
const { DocumentSyncBridge, isNewMailPage } = await imp('scripts/integrations/DocumentSyncBridge.js');
ok(isNewMailPage({ messageId: 'm', status: {} }), 'ordinary new mail is news');
ok(!isNewMailPage({ status: { read: true } }), 'a page that lands already read (a tap log) is not');
ok(!isNewMailPage({ status: {}, metadata: { recovered: true } }), 'a tap or exfil copy is not');
ok(!isNewMailPage({ status: {}, envelope: 'file' }), 'a file is not');
{
  const emitted = [];
  DocumentSyncBridge._eventBus = { emit: (e, d) => emitted.push(d) };
  const journal = { flags: { [MOD]: { type: 'inbox', actorId: 'v' } }, name: 'V — Inbox' };
  const page = (flags) => ({ parent: journal, flags: { [MOD]: { messageId: `m${emitted.length}-${Math.random()}`, subject: 's', status: {}, ...flags } } });
  DocumentSyncBridge._onJournalPageCreated(page({}), 'gm');
  ok(emitted.length === 1, 'the player is toasted for new mail to their character');
  DocumentSyncBridge._onJournalPageCreated(page({ metadata: { recovered: true, recoveredFrom: 'TAP · Relay' } }), 'gm');
  DocumentSyncBridge._onJournalPageCreated(page({ status: { read: true } }), 'gm');
  DocumentSyncBridge._onJournalPageCreated(page({ envelope: 'file' }), 'gm');
  ok(emitted.length === 1, 'not for a tap copy, a read tap log or a file');

  game.user = { id: 'gm2', isGM: true, character: null };
  DocumentSyncBridge._onJournalPageCreated(page({}), 'gm');
  ok(emitted.length === 1, 'a second GM is not toasted for a player\'s mail');
  game.user = { id: 'gm2', isGM: true, character: { id: 'v' } };
  DocumentSyncBridge._onJournalPageCreated(page({}), 'gm');
  ok(emitted.length === 2, 'a GM is still toasted for their OWN assigned character');
  game.user = { id: 'p1', isGM: false, character: { id: 'v' } };
}

// ═══ 2. INT-10 ═══
const { MessageRepository, flagChangePaths } = await imp('scripts/data/MessageRepository.js');
{
  const p = flagChangePaths({ status: { read: true, readAt: 'T' }, body: 'b', metadata: { tapLog: [1, 2] }, x: null, empty: {} }, `flags.${MOD}`);
  ok(p[`flags.${MOD}.status.read`] === true && p[`flags.${MOD}.status.readAt`] === 'T' && p[`flags.${MOD}.body`] === 'b', 'nested fields become their own paths');
  ok(Array.isArray(p[`flags.${MOD}.metadata.tapLog`]) && p[`flags.${MOD}.x`] === null, 'arrays and nulls are written whole');
  ok(!Object.keys(p).some((k) => k.includes('empty')) && !(`flags.${MOD}.status` in p), 'an empty object writes nothing and no parent is rewritten');
  ok(`flags.${MOD}.status.-=spam` in flagChangePaths({ status: { '-=spam': null } }, `flags.${MOD}`), 'a deletion key still works');

  const repo = Object.create(MessageRepository.prototype);
  const writes = [];
  const pg = { flags: { [MOD]: { messageId: 'm1', status: { read: false, eddiesClaimed: false } } }, update: async (u) => { writes.push(u); } };
  repo.getInboxJournal = async () => ({ pages: [pg] });
  pg.flags[MOD].status.eddiesClaimed = false;        // this client's (stale) copy says unclaimed
  const r = await repo.updateMessageFlags('v', 'm1', { status: { read: true } });
  const keys = Object.keys(writes[0] || {});
  ok(r.success && keys.length === 1 && keys[0] === `flags.${MOD}.status.read`, 'marking read writes ONLY the read flag');
  ok(!keys.some((k) => k.includes('eddiesClaimed')), '…so a stale copy can no longer put back the player\'s claimed eddies');
}

// ═══ 3. INT-05 ═══
{
  const { ConversationService } = await imp('scripts/services/ConversationService.js');
  const cs = Object.create(ConversationService.prototype);
  cs.membersOf = () => [];
  const store = new Map();
  let created = 0;
  game.nightcity.networkService = { tappersAt: () => new Map([['tapper', { node: { name: 'Relay' }, sloppy: false }]]) };
  game.nightcity.messageRepository = {
    getMessage: async (a, id) => { await sleep(5); return store.get(id) ? JSON.parse(JSON.stringify(store.get(id))) : null; },
    createMessage: async (a, d) => { await sleep(5); created += 1; store.set(d.messageId, d); return { success: true }; },
    updateMessageFlags: async (a, id, u) => { await sleep(5); store.set(id, { ...store.get(id), ...u }); return { success: true }; },
  };
  const conv = { id: 'c1' };
  const line = (n) => ({ network: 'NET', at: '2045-08-14T10:00:00Z', fromName: 'V', text: `line ${n}`, kind: 'text' });
  await Promise.all([cs._tap(conv, line(1), 's1'), cs._tap(conv, line(2), 's1'), cs._tap(conv, line(3), 's1')]);
  const log = store.get('convtap-c1-tapper')?.metadata?.tapLog || [];
  ok(created === 1, 'three lines at once make ONE tap log page');
  ok(log.length === 3 && log.map((e) => e.what).join() === 'line 1,line 2,line 3', 'and the log holds all three, in order');
}

console.log(`test-notify-quiet: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
