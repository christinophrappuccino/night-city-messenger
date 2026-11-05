// Conversations: the rules, and the real ConversationService over a mocked world. dev/design/CONVERSATIONS.md → Gap tracker.
import { readFileSync } from 'node:fs';
import * as C from '../../../scripts/utils/conversations.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL: ' + m); } };
const read = (p) => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');
const M = 'night-city-messenger';

/* ═══ the rules ═══ */
ok(C.lineText('  hi <3  ') === 'hi <3', 'plain text: typed as typed, trimmed');
ok(C.lineText('x'.repeat(900)).length === C.LINE_MAX, 'a line is capped');
ok(C.safeImage('worlds/a.webp') === 'worlds/a.webp' && C.safeImage('https://x.nc/a.png').startsWith('https'), 'paths and http(s) pictures');
for (const bad of ['data:image/png;base64,AAAA', 'javascript:alert(1)', 'a"b.png', '<x>', 'file:///c/x.png']) ok(C.safeImage(bad) === '', `refused: ${bad}`);
const card = C.sanitizeCard({ name: 'Dao', email: 'd@w.nc', phone: 'WAT-2208', role: 'Ripperdoc', portrait: 'data:image/png;base64,AAA', actorId: 'secret', contactId: 'c1' });
ok(card && !('actorId' in card) && card.portrait === '', 'a card holds no owner and no base64 picture');
ok(C.sanitizeCard({ name: 'x' }) === null && C.sanitizeCard({ name: 'x', email: 'a@b', encrypted: true }) === null, 'a card needs something to share, and a locked one is refused');

let m = C.sanitizeMember({ key: 'a', name: 'A', spans: [] });
ok(!C.isIn(m) && !C.canSee(m, 1), 'not in yet');
m = C.openSpan(m, 5);
ok(C.isIn(m) && !C.canSee(m, 4) && C.canSee(m, 5) && C.canSee(m, 900), 'sees from when they joined, never before');
m = C.closeSpan(m, 8);
ok(!C.isIn(m) && C.canSee(m, 8) && !C.canSee(m, 9), 'removed: keeps what they had, nothing new');
m = C.openSpan(m, 12);
ok(C.isIn(m) && C.canSee(m, 6) && !C.canSee(m, 10) && C.canSee(m, 12), 'removed and added back keeps both stretches and not the gap');
ok(C.openSpan(m, 99) === m, 'adding someone already in changes nothing');

ok(C.sortLines([{ seq: 2, lineId: 'b' }, { seq: 1, lineId: 'z' }, { seq: 2, lineId: 'a' }]).map((l) => l.lineId).join() === 'z,a,b', 'by number, then id, never by time');
const mem = (key, from, to = null) => ({ key, name: key, spans: [{ from, to }] });
ok(C.nextStarter([mem('a', 1, 4), mem('b', 3), mem('c', 2)], 'a') === 'c' && C.nextStarter([mem('a', 1), mem('b', 2)], 'a') === 'a' && C.nextStarter([mem('a', 1, 2)], 'a') === '', 'the longest-standing member takes over');
ok(C.unreadFor(mem('a', 1), 10, 7) === 3 && C.unreadFor(mem('a', 6), 10, 0) === 5 && C.unreadFor(mem('a', 1, 5), 10, 0) === 0, 'unread counts from their read position or their joining, and never after leaving');
ok(C.previewOf({ kind: 'image' }) === '[picture]' && C.previewOf({ kind: 'card', card: { name: 'Dao' } }).includes('Dao') && C.previewOf({ kind: 'gone' }) === '[line removed]', 'previews');
ok(C.titleFor({ title: 'Crew', members: [] }) === 'Crew' && C.titleFor({ members: [mem('me', 1), mem('a', 1), mem('b', 1, 2)] }, new Set(['me'])) === 'a', 'the title, else who else is still in');
ok(C.makeLine({ lineId: '1', seq: 1, kind: 'text', text: '   ' }) === null && C.makeLine({ lineId: '1', seq: 1, kind: 'image', img: 'data:x' }) === null, 'nothing to send is refused');
const g = C.goneLine({ lineId: '1', seq: 4, at: 't', text: 'awful', fromName: 'Rache', kind: 'text' });
ok(!JSON.stringify(g).includes('awful') && g.seq === 4 && g.kind === 'gone', 'a removed line: the words are gone from the data');
ok(C.waitingOn([{ seq: 1, fromKey: 'mox', fromName: 'Mox' }, { seq: 2, fromKey: 'v' }, { seq: 3, kind: 'system' }, { seq: 4, fromKey: 'v' }], new Set(['mox'])).n === 2, 'waiting: lines since the NPC last spoke');

let n = C.notifyPlan(undefined, {});
ok(n.toast && n.sound && n.state.n === 1, 'first line: toast and sound');
n = C.notifyPlan(n.state, {});
ok(n.toast && !n.sound && n.state.n === 2, 'next: the same toast updates, no sound');
for (const q of [{ own: true }, { open: true }, { muted: true }]) { const x = C.notifyPlan(n.state, q); ok(!x.toast && !x.sound && x.state === n.state, `no toast or sound: ${Object.keys(q)[0]}`); }

ok(C.tapLogLine({ kind: 'card', fromName: 'R', card: { name: 'Dao', email: 'd@w', phone: '1' } }).what === '[shared a contact: Dao]', 'a tap gets the words, never the details');
let lg = []; for (let i = 0; i < C.TAP_LOG_MAX + 5; i++) lg = C.appendTapLog(lg, { i });
ok(lg.length === C.TAP_LOG_MAX && lg[0].i === 5, 'a tap log has a limit');

let rec = [];
for (const k of ['a', 'b', 'c', 'a']) rec = C.pushRecentNpc(rec, { contactId: k, name: k });
ok(rec.map((r) => r.contactId).join() === 'a,c,b', 'recent NPCs: newest first, no repeats');
for (let i = 0; i < 20; i++) rec = C.pushRecentNpc(rec, { actorId: `x${i}` });
ok(rec.length === C.RECENT_NPCS, 'recent NPCs are capped');
ok(C.pushRecentNpc(rec, {}) === rec && C.pushRecentNpc(null, {}).length === 0, 'nobody to remember changes nothing');

/* ═══ a world ═══ */
const hooks = new Map();
globalThis.Hooks = { on: (k, f) => { (hooks.has(k) ? hooks.get(k) : hooks.set(k, []).get(k)).push(f); return 1; }, off() {}, once() {} };
const fire = (k, ...a) => (hooks.get(k) || []).forEach((f) => f(...a));
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, OBSERVER: 2, OWNER: 3 } };
let rid = 0;
globalThis.foundry = { utils: { randomID: () => `id${++rid}`, deepClone: (x) => JSON.parse(JSON.stringify(x)), mergeObject: (a, b) => ({ ...a, ...b }) } };
const setPath = (o, path, v) => { const k = path.split('.'); let t = o; for (const p of k.slice(0, -1)) t = (t[p] ??= {}); t[k.at(-1)] = v; };
const writes = { page: [], journal: [] };
class Page {
  constructor(data, parent) { Object.assign(this, data); this.parent = parent; this.id = `p${++rid}`; }
  getFlag(_, k) { return this.flags?.[M]?.[k]; }
  async update(up, op) { writes.page.push({ up, op }); const diff = {}; for (const [p, v] of Object.entries(up)) { setPath(this, p, v); setPath(diff, p, v); } fire('updateJournalEntryPage', this, diff); }
}
class Journal {
  constructor(data) { Object.assign(this, data); this.id = `j${++rid}`; const list = (data.pages || []).map((p) => new Page(p, this)); this.pages = { contents: list, slice: (a) => list.slice(a) }; }
  getFlag(_, k) { return this.flags?.[M]?.[k]; }
  async update(up, op) { writes.journal.push({ up, op }); for (const [p, v] of Object.entries(up)) setPath(this, p, v); fire('updateJournalEntry', this, Object.fromEntries(Object.entries(up).map(([k]) => [k, 1])) && { flags: { [M]: Object.fromEntries(Object.entries(up).map(([k, v]) => [k.split('.').at(-1), v])) } }); }
  async createEmbeddedDocuments(_, list) { const made = list.map((p) => new Page(p, this)); this.pages.contents.push(...made); made.forEach((p) => fire('createJournalEntryPage', p)); return made; }
  async delete() { journals.splice(journals.indexOf(this), 1); fire('deleteJournalEntry', this); }
}
const journals = [];
globalThis.JournalEntry = { create: async (data, op) => { const j = new Journal(data); journals.push(j); globalThis.__createOp = op; fire('createJournalEntry', j); return j; } };
const actor = (id, name, owned, email) => ({ id, name, img: '', hasPlayerOwner: owned, isOwner: true, getFlag: (_, k) => (k === 'email' ? email : k === 'contacts' ? actor.contacts[id] : undefined), testUserPermission: (u) => (u.owns || []).includes(id) });
actor.contacts = { v: [{ email: 'locked@x.nc', encrypted: true }] };
const actors = [actor('v', 'V', true, 'v@nc.net'), actor('ra', 'Rache', true, 'rache@nc.net'), actor('rogue', 'Rogue', false, 'rogue@nc.net')];
const dir = [
  { id: 'c-v', name: 'V', email: 'v@nc.net', actorId: 'v', primaryIdentity: true },
  { id: 'c-silver', name: 'Silver', email: 'silver@burner.nc', actorId: 'v' },
  { id: 'c-rogue', name: 'Rogue', email: 'rogue@nc.net', actorId: 'rogue', primaryIdentity: true },
  { id: 'c-sys', name: 'NetWatch', email: 'no@nw.nc', sendOnly: true },
];
const users = [{ id: 'gm', isGM: true }, { id: 'u1', isGM: false, owns: ['v'] }, { id: 'u2', isGM: false, owns: ['ra'] }];
const userFlags = {};
const toasts = [], sounds = [], emitted = [];
globalThis.game = {
  user: Object.assign(users[0], { getFlag: (_, k) => userFlags[k], setFlag: async (_, k, v) => { userFlags[k] = v; } }),
  users: Object.assign(users, { activeGM: users[0], get: (id) => users.find((u) => u.id === id) }),
  world: { id: 'w' }, journal: journals, scenes: { viewed: { id: 's1' } },
  actors: Object.assign(actors, { get: (id) => actors.find((a) => a.id === id), contents: actors }),
  settings: { get: (_, k) => { if (k === 'conversationsEnabled') return true; if (k === 'conversationGmBell') return {}; if (k === 'notifyGmConversations') return true; throw new Error('none'); }, set: async () => {} },
  nightcity: {
    masterContactService: { getAll: () => dir, isSendOnly: (e) => e === 'no@nw.nc', getByActorId: (id) => dir.find((c) => c.actorId === id && c.primaryIdentity) },
    socketManager: { emit: (op, d) => emitted.push([op, d]) }, soundService: { play: (id) => sounds.push(id) },
    notificationService: { upsertToast: (k, t) => toasts.push([k, t]), dismissKeyed() {}, refreshBadge() {} },
    messageRepository: { getSubfolderPath: async (p) => ({ id: p.join('/') }), getMessage: async () => null, createMessage: async (a, d) => { taplogs.push([a, d]); return { success: true }; }, updateMessageFlags: async () => {} },
    timeService: { getCurrentTime: () => '2045-08-15T10:00:00.000Z' }, eventBus: { emit() {}, on() {} },
  },
};
const taplogs = [];
globalThis.ui = { notifications: { warn() {}, info() {} } };
globalThis.window = {};

const { ConversationService } = await import('../../../scripts/services/ConversationService.js');
const svc = new ConversationService();
svc.wire();

/* ═══ starting one ═══ */
const made = await svc.start({ as: { contactId: 'c-v', actorId: 'v' }, members: [{ actorId: 'ra' }, { contactId: 'c-rogue' }, { contactId: 'c-sys' }], title: ' Dockside  crew ' });
ok(made.ok && made.refused.length === 1 && /one-way/.test(made.refused[0]), 'a one-way address is refused, by name');
let conv = svc.get(made.id);
ok(conv.title === 'Dockside crew' && conv.members.length === 3 && conv.starterKey === 'v@nc.net', 'it starts with who could be added');
ok(journals[0].ownership.default === 0 && journals[0].getFlag(M, 'type') === 'conversation', 'found by flag, and hidden from every sidebar');
ok(globalThis.__createOp.render === false, 'making one does not redraw the sidebar');
ok(!(await svc.start({ as: { actorId: 'v' }, members: [] })).ok, 'nobody to talk to is refused');

/* ═══ an alias never leads back ═══ */
const al = await svc.start({ as: { contactId: 'c-silver' }, members: [{ actorId: 'ra' }] });
const alConv = svc.get(al.id);
const silver = alConv.members.find((x) => x.contactId === 'c-silver');
ok(silver && silver.actorId === null && silver.name === 'Silver', 'an alias member carries no character');
ok(svc.isMine(silver, 'v') && !svc.isMine(silver, 'ra'), 'but the owner still finds their own chat');
await svc._apply('send', { id: al.id, asKey: silver.key, lineId: 'al1', text: 'hello' }, 'u1');
const alLine = svc.lines(al.id)[0];
ok(alLine.fromName === 'Silver' && alLine.fromActorId === null && !JSON.stringify(alLine).includes('"v"'), 'an alias line carries no character');

/* ═══ sending ═══ */
writes.page.length = 0; writes.journal.length = 0;
const vKey = 'v@nc.net', raKey = 'rache@nc.net';
ok((await svc._run('send', { id: made.id, asKey: vKey, lineId: 'L1', text: 'one' }, 'u1')).ok, 'a member can send');
ok(writes.page.length === 1 && Object.keys(writes.page[0].up).length === 1 && Object.keys(writes.page[0].up)[0].endsWith('.lines.L1'), 'a send writes one key');
ok(writes.page[0].op.render === false && writes.journal.every((w) => w.op.render === false), 'neither write redraws the sidebar');
ok((await svc._run('send', { id: made.id, asKey: vKey, lineId: 'L1', text: 'one again' }, 'u1')).already && svc.lines(made.id).length === 1, 'a retry cannot post twice');
ok(!(await svc._run('send', { id: made.id, asKey: vKey, lineId: 'X', text: 'forged' }, 'u2')).ok, 'someone else cannot speak for you');
ok(!(await svc._run('send', { id: made.id, asKey: 'nobody', lineId: 'X', text: 'x' }, 'u2')).ok, 'someone not in it cannot speak');
const burst = await Promise.all(Array.from({ length: 12 }, (_, i) => svc._run('send', { id: made.id, asKey: i % 2 ? vKey : raKey, lineId: `B${i}`, text: `b${i}` }, i % 2 ? 'u1' : 'u2')));
const seqs = svc.lines(made.id).map((l) => l.seq);
ok(burst.every((r) => r.ok) && new Set(seqs).size === seqs.length && seqs.join() === [...seqs].sort((a, b) => a - b).join(), 'twelve at once: none lost, numbers only go up');
conv = svc.get(made.id);
ok(conv.lastSeq === 13 && conv.lastPreview.text === 'b11', 'the summary keeps up');

/* ═══ pages roll over ═══ */
const big = await svc.start({ as: { contactId: 'c-v', actorId: 'v' }, members: [{ actorId: 'ra' }] });
for (let i = 0; i < C.PAGE_LINES + 3; i++) await svc._apply('send', { id: big.id, asKey: vKey, lineId: `P${i}`, text: 'x' }, 'u1');
const bigJ = svc._journal(big.id);
ok(bigJ.pages.contents.length === 2 && svc.lines(big.id).length === C.PAGE_LINES + 3, 'a full page starts a new one');
ok(svc.lines(big.id, { pages: 1 }).length === 3 && svc.lines(big.id, { pages: 1 }).hasEarlier, 'opening loads the newest pages, and knows there is more');

/* ═══ members ═══ */
ok(!(await svc._run('remove', { id: made.id, asKey: raKey, key: vKey }, 'u2')).ok, 'only whoever started it can remove someone');
ok((await svc._run('remove', { id: made.id, asKey: vKey, key: raKey }, 'u1')).ok, 'the starter can');
conv = svc.get(made.id);
const ra = conv.members.find((x) => x.key === raKey);
ok(!C.isIn(ra), 'they are out');
ok(!(await svc._run('send', { id: made.id, asKey: raKey, lineId: 'late', text: 'still here' }, 'u2')).ok, 'a line queued before removal is refused when it lands');
await svc._run('send', { id: made.id, asKey: vKey, lineId: 'after', text: 'SECRET after' }, 'u1');
const raRow = svc.rowsFor('ra').find((r) => r.id === made.id);
ok(raRow.left && !raRow.preview.includes('SECRET') && raRow.unread === 0, 'the row of someone removed shows nothing new');
ok(!(await svc._run('rename', { id: made.id, asKey: raKey, title: 'x' }, 'u2')).ok, 'only whoever started it renames it');
await svc._run('add', { id: made.id, asKey: vKey, raw: { actorId: 'ra' } }, 'u1');
const back = svc.get(made.id).members.find((x) => x.key === raKey);
ok(C.isIn(back) && back.spans.length === 2 && C.visibleLines(svc.lines(made.id), back).every((l) => !l.text?.includes('SECRET')), 'added back: they do not get the gap');
await svc._run('leave', { id: made.id, asKey: vKey }, 'u1');
const st = svc.get(made.id);
ok(st.starterKey !== vKey && !C.isIn(st.members.find((x) => x.key === vKey)), 'the starter leaves: someone else takes over');

/* ═══ a locked contact, a removed line ═══ */
const cc = await svc.start({ as: { contactId: 'c-v', actorId: 'v' }, members: [{ actorId: 'ra' }] });
ok(!(await svc._run('send', { id: cc.id, asKey: vKey, lineId: 'k1', kind: 'card', card: { name: 'Locked', email: 'locked@x.nc' } }, 'u1')).ok, 'an ICE-locked contact cannot be shared, even by a forged relay');
ok((await svc._run('send', { id: cc.id, asKey: vKey, lineId: 'k2', kind: 'card', card: { name: 'Dao', phone: 'WAT-2208' } }, 'u1')).ok, 'a normal one can');
await svc._run('send', { id: cc.id, asKey: vKey, lineId: 'bad', text: 'awful words' }, 'u1');
ok(!(await svc._run('removeLine', { id: cc.id, lineId: 'bad' }, 'u1')).ok, 'a player cannot remove a line');
ok((await svc._run('removeLine', { id: cc.id, lineId: 'bad' }, 'gm')).ok && !JSON.stringify(svc.lines(cc.id)).includes('awful'), 'the GM can, and the words are gone');
ok(!(await svc._run('delete', { id: cc.id }, 'u1')).ok, 'a player cannot delete one');

/* ═══ a player's side ═══ */
game.user = Object.assign(users[1], { getFlag: (_, k) => userFlags[k], setFlag: async (_, k, v) => { userFlags[k] = v; } });
const asked = svc._request('send', { id: big.id });
ok(emitted.at(-1)[0] === 'conversation:request', 'a player asks the GM');
svc.handleResult({ forUserId: 'other', reqId: emitted.at(-1)[1].reqId, res: { ok: true } });
let settled = false; asked.then(() => { settled = true; });
await 0; ok(!settled, 'someone else\'s answer is ignored');
svc.handleResult({ forUserId: 'u1', reqId: emitted.at(-1)[1].reqId, res: { ok: true, mine: 1 } });
ok((await asked).mine === 1, 'the answer comes back');
// no GM: held, saved, sent later
const realGM = game.users.activeGM; game.users.activeGM = null;
const key = 'ncm.convQueue.w.u1';
const held = await svc.send(big.id, { asKey: vKey, text: 'held line' });
ok(held.queued && svc.pendingFor(big.id)[0].state === 'queued' && /No GM/.test(svc.pendingFor(big.id)[0].reason), 'no GM online: held, and it says why');
ok(JSON.parse(store.get(key)).length === 1, 'and saved, so a reload cannot lose it');
const svc2 = new ConversationService();
game.users.activeGM = realGM;
let relays = 0; svc2._request = async () => { relays++; return { ok: true }; };
await svc2.restorePending();
ok(relays === 1 && !store.has(key), 'a reload brings it back and sends it');
// failed: stays, retry keeps the id
const svc3 = new ConversationService();
svc3._request = async () => ({ ok: false, error: 'You are no longer in this conversation.' });
await svc3.send(big.id, { asKey: vKey, text: 'late' });
const f = svc3.pendingFor(big.id)[0];
ok(f.state === 'failed' && /no longer/.test(f.reason), 'a refused line says why, in place');
svc3._request = async (op, d) => { ok(d.lineId === f.lineId, 'a retry keeps the id'); return { ok: true }; };
await svc3.retry(big.id, f.lineId);
ok(!svc3.pendingFor(big.id).length, 'and clears when it lands');
// dead zone
game.nightcity.networkService = { isDeadZone: true, currentNetworkId: 'n1' };
const dz = await svc3.send(big.id, { asKey: vKey, text: 'dead' });
ok(dz.queued && /signal/.test(svc3.pendingFor(big.id)[0].reason), 'a dead zone holds it');
delete game.nightcity.networkService;
store.clear();

/* ═══ notifications: a player ═══ */
const nsvc = new ConversationService();
const nc = await (async () => { game.user = users[0]; const r = await svc.start({ as: { contactId: 'c-rogue' }, members: [{ actorId: 'v' }] }); return svc.get(r.id); })();
game.user = Object.assign(users[1], { getFlag: (_, k) => userFlags[k], setFlag: async (_, k, v) => { userFlags[k] = v; } });
actors.forEach((a) => { a.isOwner = a.id === 'v'; });
toasts.length = 0; sounds.length = 0;
const lineFrom = (i, key = 'rogue@nc.net', name = 'Rogue') => ({ lineId: `n${i}`, seq: i, kind: 'text', text: `t${i}`, fromKey: key, fromName: name });
for (let i = 1; i <= 6; i++) nsvc._noticeLine(nc, lineFrom(i));
ok(toasts.length === 6 && new Set(toasts.map(([k]) => k)).size === 1, 'six lines update one toast');
ok(toasts.at(-1)[1].detail.startsWith('6 new'), 'and it counts them');
ok(sounds.length === 1, 'one sound');
toasts.length = 0; sounds.length = 0;
nsvc._noticeLine(nc, lineFrom(7, 'v@nc.net', 'V'));
ok(!toasts.length && !sounds.length, 'your own line never notifies you');
nsvc.setOpen(nc.id, true); nsvc._noticeLine(nc, lineFrom(8));
ok(!toasts.length, 'nothing while it is open');
nsvc.setOpen(nc.id, false);
userFlags.conversationState = { [nc.id]: { muted: true } };
nsvc._noticeLine(nc, lineFrom(9));
ok(!toasts.length, 'nothing when muted');
ok(nsvc.rowsFor('v').find((r) => r.id === nc.id).unread === 0, 'and a muted one shows no badge');
userFlags.conversationState = {};
nsvc._noticeLine(nc, { ...lineFrom(10), kind: 'system' });
ok(!toasts.length, 'system lines are quiet');
nsvc._notes.clear();
nsvc.markRead(nc.id, 'v@nc.net', 10);
nsvc._noticeLine(nc, lineFrom(11));
ok(sounds.length === 1, 'reading it lets the next line make a sound again');
ok(nsvc.readSeq(nc.id, 'v@nc.net') === 10, 'read position holds in memory first');
await nsvc.flushReads();
ok(userFlags.conversationState[nc.id].read['v@nc.net'] === 10 && !nsvc._reads.size, 'and is saved on the user, so no character sheet redraws');

/* ═══ notifications: the GM ═══ */
game.user = Object.assign(users[0], { getFlag: (_, k) => userFlags[k], setFlag: async (_, k, v) => { userFlags[k] = v; } });
actors.forEach((a) => { a.isOwner = true; });
toasts.length = 0; sounds.length = 0;
const gsvc = new ConversationService();
const npcConv = svc.get(nc.id);
await svc._run('send', { id: nc.id, asKey: 'v@nc.net', lineId: 'g1', text: 'hello Rogue' }, 'u1');
toasts.length = 0; sounds.length = 0;
gsvc._noticeLine(npcConv, { lineId: 'g2', seq: 90, kind: 'text', text: 'hi', fromKey: 'v@nc.net', fromName: 'V' });
gsvc._noticeLine(npcConv, { lineId: 'g3', seq: 91, kind: 'text', text: 'hi', fromKey: 'v@nc.net', fromName: 'V' });
ok(toasts.length === 2 && toasts.every(([k]) => k === 'conv:gm') && sounds.length === 1, 'the GM: one combined toast, one sound');
toasts.length = 0;
gsvc._noticeLine(npcConv, { lineId: 'g4', seq: 92, kind: 'text', text: 'hi', fromKey: 'rogue@nc.net', fromName: 'Rogue' });
ok(!toasts.length, 'not for the GM\'s own NPC line');
const pcm = await svc.start({ as: { contactId: 'c-v', actorId: 'v' }, members: [{ actorId: 'ra' }] });
const pc = svc.get(pcm.id);
gsvc._noticeLine(pc, { lineId: 'g5', seq: 93, kind: 'text', text: 'hi', fromKey: 'v@nc.net', fromName: 'V' });
ok(!toasts.length, 'a players-only chat stays quiet unless the GM asks');

/* ═══ tap logs ═══ */
taplogs.length = 0;
game.nightcity.networkService = { tappersAt: () => new Map([['ra', { node: { name: 'Kabuki relay' }, sloppy: false }], ['v', { node: { name: 'Kabuki relay' }, sloppy: false }]]), isDeadZone: false };
const tc = await svc.start({ as: { contactId: 'c-v', actorId: 'v' }, members: [{ contactId: 'c-rogue' }] });
await svc._apply('send', { id: tc.id, asKey: vKey, lineId: 'tap1', kind: 'card', card: { name: 'Dao', phone: 'WAT-2208' }, network: 'n1', scene: 's1' }, 'u1');
await new Promise((r) => setTimeout(r, 5));
ok(taplogs.length === 1 && taplogs[0][0] === 'ra', 'a tap logs it, unless the tapper is in the chat');
ok(taplogs[0][1].status.read === true && taplogs[0][1].metadata.recovered, 'written read, into their Exfil folder');
ok(taplogs[0][1].body.includes('[shared a contact: Dao]') && !taplogs[0][1].body.includes('WAT-2208'), 'it gets the words and not the details');
taplogs.length = 0;
await svc._apply('send', { id: tc.id, asKey: vKey, lineId: 'tap2', text: 'no scene', network: 'n1' }, 'u1');
await new Promise((r) => setTimeout(r, 5));
ok(!taplogs.length, 'a line with no scene is heard by nobody');
delete game.nightcity.networkService;

/* ═══ it stays out of mail ═══ */
const { MessageRepository } = await import('../../../scripts/data/MessageRepository.js').catch(() => ({}));
if (MessageRepository) ok(!MessageRepository.identifyInbox(journals[0]), 'mail scanners do not see a conversation');
const noMsg = JSON.stringify(journals[0].pages.contents.map((p) => p.flags));
ok(!noMsg.includes('"messageId"'), 'a line has no messageId, so by-id mail lookups skip it');

/* ═══ wiring ═══ */
const Set1 = read('scripts/core/SettingsManager.js');
ok(/'conversationsEnabled'[\s\S]{0,300}default: false/.test(Set1), 'off by default while it is being built');
const Reg = read('scripts/init/registerCallSystem.js');
ok(/'Conversations: hooks', \(\) => game\.nightcity\.conversationService\.wire\(\), \{ feature: 'conversations' \}/.test(Reg) && (Reg.match(/\{ feature: 'conversations' \}/g) || []).length === 4,
  'off means no hooks and no sockets (since step 14 the feature registry skips the wiring and stands in for both socket ops)');
const Svc = read('scripts/services/ConversationService.js');
ok(!/EVENTS\.MESSAGE_|INBOX_REFRESH/.test(Svc), 'it fires no mail events');
ok(/tappersAt\(network, sceneId/.test(read('scripts/services/NetworkService.js')), 'taps ask the network who is listening');

console.log(`test-conversations: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
