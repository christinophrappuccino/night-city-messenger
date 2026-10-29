// Sim: Admin → Messages redesign (2026-10-27) — Needs a reply · All mail ·
// Outbox · Inboxes + the Send as / Broadcast header. Drives the REAL MessagesTab
// (constructed over a mocked world), the REAL messagesModel rules, the REAL
// MessageService failure log + held-mail plumbing, then renders the REAL
// template through Foundry's Handlebars and guards the wiring (every data-op is
// handled, every data-action registered, every class styled).
//   node dev/tools/sims/test-admin-messages.mjs
import { pathToFileURL, fileURLToPath } from 'url';
import { readFileSync, existsSync } from 'fs';
import { createRequire } from 'module';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const MOD = 'night-city-messenger';
const read = (p) => readFileSync(`${ROOT}/${p}`, 'utf8');
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };

// ── DOM-less globals scopePicker.js wants at import ──
globalThis.document = { addEventListener: () => {}, querySelectorAll: () => [], querySelector: () => null, createElement: () => ({ click() {} }), documentElement: { clientWidth: 1200, clientHeight: 900 } };
globalThis.window = { addEventListener: () => {} };

// ── World ──
const T = (h) => new Date(Date.UTC(2045, 7, 14, h, 0, 0)).toISOString();
const NOW = Date.UTC(2045, 7, 14, 22, 0, 0);
const settings = { npcMailAnswered: {}, deliveryFailures: [], anonSendEnabled: true, anonDefaultStyle: 'scrambled' };
const mkActor = (id, name, player, email = '') => ({ id, name, hasPlayerOwner: player, img: '', ownership: {}, getFlag: (m, k) => (k === 'email' ? email : undefined) });
const actors = new Map([
  ['v', mkActor('v', 'V', true, 'v@nightcity.net')],
  ['rache', mkActor('rache', 'Rache', true, 'rache@nightcity.net')],
  ['rogue', mkActor('rogue', 'Rogue', false, 'rogue@afterlife.nc')],
]);
const master = [
  { id: 'mc-rogue', name: 'Rogue', email: 'rogue@afterlife.nc', actorId: 'rogue', primaryIdentity: true },
  { id: 'mc-queen', name: 'Queen of Hearts', email: 'queen@void.nc', actorId: 'rogue' },
  { id: 'mc-hana', name: 'Hana Ito', email: 'h.ito@newcorp.nc', actorId: null },
  { id: 'mc-sys', name: 'NetWatch notice', email: 'notice@netwatch.nc', actorId: null, sendOnly: true },
];
let pageN = 0;
const mkPage = (f) => ({ id: `pg${++pageN}`, name: f.subject, flags: { [MOD]: { status: { read: false }, ...f } }, text: { content: f.body || '' },
  update: async (u) => { for (const [k, v] of Object.entries(u)) { const key = k.split('.').pop(); mkPage.last = { k, v }; if (k.endsWith('selfDestruct')) pagesById.get(pageN)?.flags; } } });
const pagesById = new Map();
const journals = [];
const mkJournal = (id, flags, name, pages) => {
  const pg = Object.assign(pages, {
    get: (pid) => pages.find(p => p.id === pid) || null,
    get contents() { return pages; },
  });
  const j = { id, name, folder: null, flags: { [MOD]: flags }, pages: pg,
    updates: [], deleted: [],
    async updateEmbeddedDocuments(type, ups) { this.updates.push(...ups); for (const u of ups) { const p = pages.find(x => x.id === u._id); if (p && u[`flags.${MOD}.status.read`]) p.flags[MOD].status.read = true; } },
    async deleteEmbeddedDocuments(type, ids) { this.deleted.push(...ids); },
    async delete() { journals.splice(journals.indexOf(this), 1); } };
  journals.push(j);
  return j;
};
const msg = (o) => mkPage({ subject: '(s)', body: '<p>body</p>', ...o });

mkJournal('j-rogue', { type: 'inbox', actorId: 'rogue' }, 'Rogue — Inbox', [
  msg({ messageId: 'm1', subject: 'Need a fixer', fromActorId: 'v', from: 'v@nightcity.net', toActorId: 'rogue', toContactId: 'mc-rogue', to: 'rogue@afterlife.nc', timestamp: T(10) }),
  msg({ messageId: 'm2', subject: 'Re: Need a fixer', fromActorId: 'rache', from: 'rache@nightcity.net', toActorId: 'rogue', toContactId: 'mc-rogue', timestamp: T(14) }),
  msg({ messageId: 'r1-sent', subject: 'RE: Need a fixer', fromActorId: 'rogue', fromContactId: 'mc-rogue', from: 'rogue@afterlife.nc', toActorId: 'v', to: 'v@nightcity.net', timestamp: T(12), status: { read: true, sent: true } }),
  msg({ messageId: 'm3', subject: 'Who is this', fromActorId: 'v', from: 'v@nightcity.net', toActorId: 'rogue', toContactId: 'mc-queen', to: 'queen@void.nc', timestamp: T(15) }),
  msg({ messageId: 'm4', subject: 'GM note', fromContactId: 'mc-hana', from: 'h.ito@newcorp.nc', toActorId: 'rogue', timestamp: T(9) }),
  msg({ messageId: 'm6', subject: 'The files', fromContactId: 'mc-hana', from: 'h.ito@newcorp.nc', toActorId: 'rogue', toContactId: 'mc-rogue', timestamp: T(16) }),
]);
mkJournal('j-hana', { type: 'contactInbox', contactId: 'mc-hana' }, 'Hana Ito — Mail', [
  msg({ messageId: 'm6-sent', subject: 'The files', fromContactId: 'mc-hana', from: 'h.ito@newcorp.nc', toActorId: 'rogue', timestamp: T(16), status: { read: true, sent: true }, sentVia: { machine: 'WS-7F-12', operatorName: 'Rache', impersonated: true } }),
  msg({ messageId: 'a1-sent', subject: 'I know what you did', fromContactId: 'mc-hana', from: 'h.ito@newcorp.nc', toActorId: 'v', timestamp: T(17), status: { read: true, sent: true }, anonymous: { enabled: true, alias: 'GHOST', role: 'sender' } }),
]);
mkJournal('j-v', { type: 'inbox', actorId: 'v' }, 'V — Inbox', [
  msg({ messageId: 'g1', subject: 'Job tonight', fromActorId: 'rogue', fromContactId: 'mc-rogue', from: 'rogue@afterlife.nc', toActorId: 'v', to: 'v@nightcity.net', timestamp: T(18), eddies: 500, status: { read: true, eddiesClaimed: true },
    participants: [{ role: 'from', email: 'rogue@afterlife.nc' }, { role: 'to', hint: { actorId: 'v' } }, { role: 'to', hint: { actorId: 'rache' } }] }),
  msg({ messageId: 'a1', subject: 'I know what you did', fromActorId: '', fromContactId: '', from: '▓@darknet', toActorId: 'v', timestamp: T(17), anonymous: { enabled: true, alias: 'GHOST', maskedEmail: '▓@darknet' } }),
  msg({ messageId: 'sp1', subject: 'Platinum renewal', fromContactId: 'mc-sys', from: 'notice@netwatch.nc', toActorId: 'v', timestamp: T(8), status: { read: false, spam: true } }),
]);
mkJournal('j-rache', { type: 'inbox', actorId: 'rache' }, 'Rache — Inbox', [
  msg({ messageId: 'g1', subject: 'Job tonight', fromActorId: 'rogue', fromContactId: 'mc-rogue', from: 'rogue@afterlife.nc', toActorId: 'rache', to: 'rache@nightcity.net', timestamp: T(18), eddies: 500,
    participants: [{ role: 'from', email: 'rogue@afterlife.nc' }, { role: 'to', hint: { actorId: 'v' } }, { role: 'to', hint: { actorId: 'rache' } }] }),
  msg({ messageId: 'sd1', subject: 'Diagnostics', fromActorId: 'rogue', from: 'rogue@afterlife.nc', toActorId: 'rache', timestamp: T(19), selfDestruct: { mode: '6h', expiresAt: new Date(NOW + 4 * 3600000).toISOString() } }),
]);
mkJournal('j-orphan', { type: 'contactInbox', contactId: 'mc-gone' }, 'Old Fixer — Inbox', [msg({ messageId: 'o1', fromActorId: 'v', timestamp: T(1) })]);
journals.get = (id) => journals.find(j => j.id === id) || null;
Object.defineProperty(journals, 'contents', { get: () => [...journals] });

const sent = [];
const emitted = [];
globalThis.foundry = { utils: { deepClone: (o) => JSON.parse(JSON.stringify(o)), randomID: (() => { let n = 0; return () => `r${++n}`; })(), debounce: (f) => f, mergeObject: (a, b) => ({ ...a, ...b }) } };
globalThis.ui = { notifications: { info: () => {}, warn: () => {}, error: () => {} } };
globalThis.Hooks = { on: () => {}, once: () => {}, off: () => {}, call: () => true, callAll: () => {} };
globalThis.Handlebars = { escapeExpression: (s) => String(s ?? '') };
const groups = [{ id: 'grp1', name: 'The crew', color: '#c76bff', members: [{ hint: { actorId: 'v' }, name: 'V' }, { hint: { actorId: 'rache' }, name: 'Rache' }] }];
globalThis.game = {
  user: { id: 'gm', isGM: true, name: 'GM' },
  users: Object.assign([{ id: 'gm', isGM: true, active: true, name: 'GM' }, { id: 'p1', isGM: false, active: true, name: 'Sam', character: actors.get('v') }, { id: 'p2', isGM: false, active: false, name: 'Lou', character: actors.get('rache') }], { get(id) { return this.find(u => u.id === id) || null; } }),
  actors: Object.assign([...actors.values()], { get: (id) => actors.get(id) || null }),
  settings: { get: (m, k) => settings[k], set: async (m, k, v) => { settings[k] = JSON.parse(JSON.stringify(v)); } },
  journal: journals,
  nightcity: {
    masterContactService: {
      getAll: () => master, getContact: (id) => master.find(c => c.id === id) || null,
      getByActorId: (id) => master.find(c => c.actorId === id && c.primaryIdentity) || master.find(c => c.actorId === id) || null,
      getByEmail: (e) => master.find(c => c.email === e) || null, isSendOnly: (e) => master.some(c => c.email === e && c.sendOnly),
      identityRoleOf: () => null,
    },
    contactGroupService: { getMasterGroups: () => groups, recipientsFor: (g) => ({ recipients: g.members.map(m => ({ actorId: m.hint.actorId, name: m.name })) }) },
    timeService: { getCurrentTimeMs: () => NOW, getCurrentTime: () => new Date(NOW).toISOString() },
    networkService: { getNetwork: () => null },
    socketManager: { emit: (op, data) => emitted.push({ op, data }) },
  },
};

const C = await imp('scripts/utils/constants.js');
const M = await imp('scripts/ui/AdminPanel/tabs/messagesModel.js');
const { MessagesTab } = await imp('scripts/ui/AdminPanel/tabs/MessagesTab.js');
const { MessageService } = await imp('scripts/services/MessageService.js');
const { ScopePicker } = await imp('scripts/utils/scopePicker.js');

const svc = Object.create(MessageService.prototype);
svc._messageQueue = [];


svc._getTimestamp = () => new Date(NOW).toISOString();
const realSend = svc.sendMessage;
svc.sendMessage = async (data) => { sent.push(JSON.parse(JSON.stringify(data))); return { success: true, delivered: data.recipients?.length || 1, failed: [] }; };
svc.getMessage = async (owner, id) => ({ messageId: id, subject: 'x' });
const schedCalls = [];
const scheduling = { getPending: () => [{ scheduleId: 's1', deliveryTime: new Date(NOW + 3600000).toISOString(), useGameTime: true, messageData: { fromActorId: 'rogue', toActorId: 'v', subject: 'Change of plans' } }],
  getScheduled: (id) => (id === 's1' ? { scheduleId: 's1', messageData: {} } : null), _deliverScheduled: async () => { schedCalls.push('deliver'); return { success: true }; }, _persistScheduled: async () => { schedCalls.push('persist'); },
  scheduleMessage: async (data, when) => { schedCalls.push({ data, when }); return { success: true }; } };
const repo = { _pageToMessage: (p) => ({ ...p.flags[MOD] }), clearCache: () => {} };
let renders = 0;
const app = { id: 'ncm-admin', _activeTab: 'messages', isPopout: false, _relativeTime: () => '1 hr ago', _saveScroll() {}, render() { renders++; },
  messageService: svc, schedulingService: scheduling, masterContactService: game.nightcity.masterContactService, messageRepository: repo, tabs: {} };
const tab = new MessagesTab(app);
app.tabs.messages = tab;

// ═══ 1. The rules (pure) ═══
{
  ok(M.baseIdOf('x-sent') === 'x' && M.convKey('o', 'a') === 'o|a' && M.convKey('o') === 'o|', 'base id + conversation key');
  const p = { messageId: 'p', fromActorId: 'v', from: 'v@nc', _ts: 10 };
  ok(!M.isAnswered(p, [], {}), 'a lone player message is waiting');
  ok(M.isAnswered(p, [{ toActorId: 'v', _ts: 11 }], {}), 'a later NPC reply to that player answers it');
  ok(!M.isAnswered(p, [{ toActorId: 'v', _ts: 9 }], {}), 'an EARLIER reply does not');
  ok(!M.isAnswered(p, [{ toActorId: 'rache', _ts: 11 }], {}), 'a reply to someone else does not');
  ok(M.isAnswered(p, [{ to: 'a@x, V@NC', _ts: 12 }], {}), 'a fan-out reply (joined address) answers it');
  ok(M.isAnswered(p, [{ participants: [{ role: 'to', hint: { actorId: 'v' } }], _ts: 12 }], {}), 'participants count');
  ok(M.isAnswered(p, [], { p: 'iso' }), 'the GM ✓ mark answers it');
  ok(Object.keys(M.pruneAnswered(Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, `2045-01-${String(i + 1).padStart(2, '0')}`])), 5)).join() === 'k19,k18,k17,k16,k15', 'answered map prunes oldest first');
  const es = [{ unread: true, fromPlayer: true }, { isAnon: true }, { eddies: 5, isGroup: true }, { isSpam: true, attachments: [1] }];
  ok(M.applyMailFilters(es, { box: 'pc' }).length === 1 && M.applyMailFilters(es, { box: 'npc' }).length === 3, 'From players / From NPCs');
  ok(M.applyMailFilters(es, { flags: ['eb', 'group'] }).length === 1 && M.applyMailFilters(es, { flags: ['spam', 'att'] }).length === 1, 'flag chips AND together');
  ok(M.flagCounts(es).anon === 1 && M.flagCounts(es).eb === 1, 'flag counts');
  const days = M.groupByDay([{ rawTimestamp: NOW - 3600000 }, { rawTimestamp: NOW - 86400000 }, { rawTimestamp: NOW - 5 * 86400000 }], NOW, () => 'older');
  ok(days.map(d => d.label).join() === 'Today,Yesterday,older', 'day groups');
  ok(M.purgeable({ status: { read: true }, timestamp: T(1) }, NOW) && !M.purgeable({ status: { read: true, saved: true }, timestamp: T(1) }, NOW) && !M.purgeable({ status: {}, timestamp: T(1) }, NOW), 'purge keeps unread + saved mail');
}

// ═══ 2. Needs a reply ═══
{
  const scan = tab._scanInboxes();
  ok(scan.inboxes.length === 5 && scan.inboxes.find(b => b.ownerId === 'mc-gone').orphan, 'scan finds every inbox, flags the orphan');
  ok(scan.viaByBase.get('m6')?.impersonated && scan.anonRealByBase.get('a1') === 'Hana Ito', 'scan indexes terminal typists and anonymous real senders');
  const convs = tab._buildConversations(scan, {});
  const main = convs.find(c => c.key === 'rogue|'), alias = convs.find(c => c.key === 'rogue|mc-queen');
  ok(main && alias, 'an alias the player wrote to is its own conversation (same key as the Overview)');
  ok(main.waiting === 2 && main.msgs.find(m => m.messageId === 'm1')._answered, 'V was answered by Rogue’s later reply; Rache and the typed message wait');
  ok(main.msgs.some(m => m.messageId === 'm6' && m._via?.impersonated), 'mail a player typed on a terminal counts as player mail');
  ok(!main.msgs.some(m => m.messageId === 'm4'), 'GM-sent mail to an NPC is left out…');
  tab._npcInboxIncludeGm = true;
  ok(tab._buildConversations(tab._scanInboxes(), {}).find(c => c.key === 'rogue|').msgs.some(m => m.messageId === 'm4'), '…unless "Include mail I sent" is on');
  tab._npcInboxIncludeGm = false;
  ok(main.replies.some(r => r.messageId === 'r1-sent') && !alias.replies.length, 'the NPC’s reply joins the main conversation only');
  ok(!convs.some(c => c.ownerId === 'v' || c.ownerId === 'mc-gone'), 'player and orphan inboxes are not conversations');

  const ctx = tab._buildContext({});
  ok(ctx.isReply && ctx.reply.queue.waiting.length === 2 && ctx.reply.queue.answered.length === 0 && ctx.nav[0].count === 2 && ctx.nav[0].tone === 'hot', 'default view: Needs a reply, both conversations waiting in the queue');
  ok(ctx.reply.desk && ctx.reply.desk.key === ctx.reply.queue.waiting[0].key && ctx.reply.queue.waiting[0].sel, 'nothing picked: the desk opens on the longest wait, and that row is marked');
  ok(ctx.reply.queue.waiting.every(r => r.meter && r.meter.pct >= 0 && r.faces.length >= 1 && r.playersN >= 1), 'every waiting row carries its wait meter, faces and a player count');
  tab._convSel = 'rogue|mc-queen';
  const c2 = tab._buildContext({}).reply.desk;
  ok(ScopePicker.value(tab.scopeId('rpas'))[0] === 'c:mc-queen', 'Reply as defaults to the identity they wrote to (the alias)');
  ok(c2.head.subline.startsWith('Alias of Rogue') && c2.aliasName, 'the alias conversation says whose alias it is');
  ok(c2.persona.isAlias && c2.persona.name === c2.compose.replyAsName, 'the persona is the identity being answered as (the alias)');
  tab._convSel = 'rogue|';
  const c1 = tab._buildContext({}).reply.desk;
  ok(ScopePicker.value(tab.scopeId('rpas'))[0] === 'c:mc-rogue', 'switching conversation resets Reply as to its own identity');
  ok(c1.hasTyped && c1.typedNotes[0].typist === 'Rache' && c1.typedNotes[0].machine === 'WS-7F-12', 'terminal-typed mail is flagged and explained');
  { const msgs = c1.entries.filter(e => e.kind === 'msg');
    ok(msgs.map(b => b.messageId).join() === 'm1,r1-sent,m2,m6' && msgs[1].mine && msgs[2].waiting && !msgs[0].waiting, 'the thread runs oldest first; the NPC\'s replies on the right; unanswered marked');
    ok(c1.entries[0].kind === 'day' && c1.entries.filter(e => e.kind === 'day').length >= 1, 'a day line opens the thread'); }
  ok(typeof c1.persona.voice.text === 'string' && 'empty' in c1.persona.voice && Array.isArray(c1.persona.identities), 'the persona carries the voice (or its empty state) and the identities to answer as');

  // Inline reply → the composer's reply path (buildReply + sendMessage), as the picked identity, to everyone waiting.
  tab._drafts.set('rogue|', 'Back booth.\nNow.');
  sent.length = 0;
  await tab._onReplySend();
  const r = sent[0];
  ok(r && r.fromContactId === 'mc-rogue' && r.fromActorId === 'rogue' && r.from === 'rogue@afterlife.nc', 'reply goes out AS the picked identity');
  ok(r?.recipients?.length === 2 && r.recipients.some(x => x.actorId === 'rache') && r.recipients.some(x => x.contactId === 'mc-hana'), 'two waiting senders → one fan-out to both');
  ok(r?.inReplyTo && r.subject.startsWith('RE:') && r.body.includes('<br>'), 'threaded like a composer reply');
  ok(settings.npcMailAnswered.m2 && settings.npcMailAnswered.m6 && !tab._drafts.has('rogue|'), 'sending marks those answered and clears the draft');
  ok(journals.get('j-rogue').updates.some(u => u._id && u[`flags.${MOD}.status.read`]), 'and marks them read (the Overview agrees)');
  ok(tab._buildConversations(tab._scanInboxes(), settings.npcMailAnswered).find(c => c.key === 'rogue|').waiting === 0, 'the conversation leaves Waiting');

  // Anonymous inline reply carries a mask block.
  tab._convSel = 'rogue|mc-queen'; tab._buildContext({});
  tab._replyAnon = true; tab._drafts.set('rogue|mc-queen', 'Nobody.');
  svc.getThreadAnonConfig = () => null;
  sent.length = 0; await tab._onReplySend();
  ok(sent[0]?.anonymous?.enabled && sent[0].anonymous.alias && sent[0].fromContactId === 'mc-queen', 'the anonymous toggle masks the reply (sent as the alias)');

  // ✓ mark answered without replying
  settings.npcMailAnswered = {};
  tab._convSel = 'rogue|'; tab._buildContext({});
  await tab._onMarkAnswered();
  ok(settings.npcMailAnswered.m2 && settings.npcMailAnswered.m6, '✓ stores the answered marker for every waiting message');

  // Open in composer hands the reply over.
  let opened = null;
  game.nightcity.openComposer = (o) => { opened = o; };
  settings.npcMailAnswered = {};
  tab._buildContext({}); tab._drafts.set('rogue|', 'draft text');
  tab._onReplyComposer();
  ok(opened?.mode === 'reply' && opened.fromContactId === 'mc-rogue' && opened.body === 'draft text' && opened.replyAll, 'Open in composer: reply mode, same identity, the draft, reply-all for a crowd');

  // openTo from the Overview
  await tab.onAct('openConversation', null, { dataset: { key: 'rogue|mc-queen' } });
  ok(tab._view === 'reply' && tab._convSel === 'rogue|mc-queen' && app._activeTab === 'messages', 'Overview "Reply" opens THAT conversation');
}

// ═══ 3. All mail ═══
{
  tab.openTo('msg:g1');
  ok(tab._view === 'all' && tab._sel === 'g1', 'openTo(message) opens All mail on it');
  tab._sel = null;
  const res = tab._gatherActivity();
  const grp = res.filtered.find(e => e.isGroupRow);
  ok(grp && grp.recipientCount === 2 && grp.messageId === 'fanout:g1', 'a fan-out is one row');
  ok(grp.recipients.find(x => x.inboxOwnerId === 'v').eddiesClaimed && !grp.recipients.find(x => x.inboxOwnerId === 'rache').eddiesClaimed, 'each copy carries its own eddies-claimed state');
  ok(!res.filtered.some(e => e.messageId === 'm6-sent') && res.filtered.find(e => e.messageId === 'm6').sentVia?.typist === 'Rache', 'a sent copy merges into its received twin (which keeps the typist)');
  const anon = res.filtered.find(e => e.messageId === 'a1');
  ok(anon.isAnon && anon.fromName === 'GHOST' && anon.anonReal === 'Hana Ito', 'anonymous mail: alias on the row, real sender for the GM');
  ok(res.filtered.find(e => e.messageId === 'm6').fromPlayer && !res.filtered.find(e => e.messageId === 'm4').fromPlayer, 'typed-on-terminal counts as From players');

  const pick = (keys) => { tab._af = new Set(keys); return tab._gatherActivity().filtered.map(e => e.messageId); };
  ok(pick(['eb']).join() === 'fanout:g1', 'Eddies chip');
  ok(pick(['anon']).join() === 'a1', 'Anonymous chip');
  ok(pick(['term']).join() === 'm6', 'Typed on a terminal chip');
  ok(pick(['sd']).join() === 'sd1', 'Self-destruct chip');
  ok(pick(['spam']).join() === 'sp1', 'Spam filter shows spam only');
  tab._af = new Set(); tab._box = 'all';
  ok(!tab._gatherActivity().filtered.some(e => e.isSpam) && tab._gatherActivity().counts.spam === 1, 'spam is out of All mail unless picked (its count is still known)');
  ok(pick(['group']).join() === 'fanout:g1', 'Group sends chip');
  ok(pick(['unread']).includes('a1') && !pick(['unread']).includes('r1-sent') && !pick(['unread']).includes('m2'), 'Unread chip (m2 was read by the reply)');
  tab._af = new Set();
  tab._box = 'npc';
  ok(!tab._gatherActivity().filtered.some(e => e.fromPlayer), 'From NPCs');
  tab._box = 'all';

  ScopePicker.set(tab.scopeId('who'), ['a:rache']);
  const who = tab._gatherActivity().filtered.map(e => e.messageId);
  ok(who.includes('m2') && who.includes('sd1') && !who.includes('a1'), 'Who: a character');
  ScopePicker.set(tab.scopeId('who'), ['c:mc-queen']);
  ok(tab._gatherActivity().filtered.map(e => e.messageId).join() === 'm3', 'Who: an alias on its own');
  ScopePicker.set(tab.scopeId('who'), ['g:grp1']);
  ok(tab._gatherActivity().filtered.some(e => e.messageId === 'fanout:g1'), 'Who: a group covers its members');
  ScopePicker.set(tab.scopeId('who'), []);

  tab._search = 'diagnostics';
  ok(tab._gatherActivity().filtered.map(e => e.messageId).join() === 'sd1', 'search');
  tab._search = '';
  tab._dateFrom = '2045-08-15';
  ok(tab._gatherActivity().filtered.length === 0, 'date range');
  tab._dateFrom = '';

  tab._view = 'all';
  tab._sel = 'fanout:g1';
  // ── THE CALENDAR NAVIGATOR (the left column) ──
  tab._calYear = 0; tab._calFollow = false;           // not placed yet → home = the game clock's year (openTo above is tested further down)
  let ctx = tab._buildContext({});
  const AUG = 7, DAY14 = Date.UTC(2045, 7, 14), WK14 = Date.UTC(2045, 7, 14);   // Mon 14 Aug 2045
  const dated = tab._gatherActivity().filtered.filter(e => e.rawTimestamp).length;
  ok(ctx.all.cal.isYear && ctx.all.cal.crumbs.length === 1 && ctx.all.cal.crumbs[0].label === '2045', 'the navigator opens on the year of the game clock');
  ok(ctx.all.cal.tiles.length === 12 && ctx.all.cal.tiles[AUG].now && ctx.all.cal.tiles[AUG].n === dated && ctx.all.cal.tiles[0].empty, 'twelve tiles: August is now and holds every dated message, January is empty');
  ok(ctx.all.cal.tiles[AUG].unread > 0 && ctx.all.cal.tiles[AUG].bars.some(b => b.hot), 'the tile carries its unread count and an amber week bar');
  ok(ctx.all.cal.quick.length === 3 && !ctx.all.cal.quick.some(q => q.on) && ctx.all.cal.prev.label === '2044' && ctx.all.cal.next.n === '—', 'quick shortcuts + ‹ › neighbours with counts');
  ok(!ctx.all.cal.canUp && !ctx.all.cal.fresh, 'year: nothing above it; no entrance plays on a plain render');
  await tab.onAct('calMonth', null, { dataset: { month: String(AUG) } });
  ctx = tab._buildContext({});
  ok(ctx.all.cal.isMonth && ctx.all.cal.anim === 'grow' && ctx.all.cal.fresh && ctx.all.cal.crumbs.map(c => c.label).join('›') === '2045›August', 'a month tile grows into the grid (entrance stamped once)');
  ok(!tab._buildContext({}).all.cal.fresh, '…and a plain re-render does not replay it');
  const cells = ctx.all.cal.cells.filter(c => !c.out);
  ok(cells.length === 31 && ctx.all.cal.cells.filter(c => c.out).length === 1 && cells[13].today && cells[13].n === dated && cells[13].v > 0 && cells[0].empty, 'a cell per day (Aug 2045 starts on a Tuesday → one blank), the 14th is today and tinted');
  ok(ctx.all.cal.weeks.some(w => w.start === WK14 && w.n === dated) && ctx.all.cal.rows.length === dated && ctx.all.cal.rows[0].calWhen.startsWith('14 · '), 'week buttons carry counts; the month’s mail lists under the grid, day · time');
  ok(ctx.all.hasRows && ctx.all.shown === dated && ctx.all.total === dated && ctx.all.grand >= dated, 'Showing N of M is honest about the range');
  ok(ctx.all.sel.isGroupRow && ctx.all.sel.recipients.length === 2 && ctx.all.sel.recipients.some(r => r.claimed), 'reading pane lists each recipient + eddies claimed');
  await tab.onAct('calDay', null, { dataset: { ms: String(DAY14) } });
  ctx = tab._buildContext({});
  ok(ctx.all.cal.isDay && ctx.all.cal.anim === 'fold' && ctx.all.cal.crumbs.map(c => c.label).join('›') === '2045›August›Mon 14', 'the grid folds into the day');
  ok(ctx.all.cal.strip.length === 7 && ctx.all.cal.strip[0].sel && ctx.all.cal.strip[0].wd === 'Mon' && ctx.all.cal.strip[0].day === 14, 'a seven-day Monday strip with the day picked');
  ok(ctx.all.cal.bands.map(b => b.label).join() === 'evening,afternoon,morning' && ctx.all.cal.bands.flatMap(b => b.rows).length === dated && /^\d\d:\d\d/.test(ctx.all.cal.bands[0].rows[0].calWhen), 'the day’s mail by evening / afternoon / morning (newest first), time only');
  ok(ctx.all.cal.quick[0].on && ctx.all.cal.canUp, 'Today is lit; up is offered');
  await tab.onAct('calStep', null, { dataset: { dir: '-1' } });
  ctx = tab._buildContext({});
  ok(ctx.all.cal.isDay && ctx.all.cal.anim === 'step-prev' && ctx.all.cal.crumbs.at(-1).label === 'Sun 13' && !ctx.all.cal.bands.length && ctx.all.cal.next.label === 'Mon 14' && ctx.all.cal.next.n === String(dated), '‹ steps to the day before (a Sunday, another week’s strip); the foot names the neighbour and its count');
  ok(ctx.all.cal.strip[6].day === 13 && ctx.all.cal.strip[6].sel, 'the strip follows the day into last week');
  await tab.onAct('calUp', null, null);
  ok(tab._calLevel === 'month' && tab._calMonth === AUG, 'Esc from a day goes to its month');
  await tab.onAct('calWeek', null, { dataset: { start: String(WK14) } });
  ctx = tab._buildContext({});
  ok(ctx.all.cal.isWeek && ctx.all.cal.crumbs.at(-1).label === 'Week 33' && ctx.all.cal.rows.length === dated && ctx.all.cal.strip.length === 7 && !ctx.all.cal.strip.some(c => c.sel), 'a week: its strip and its mail');
  await tab.onAct('calDay', null, { dataset: { ms: String(DAY14) } });
  ok(tab._calLevel === 'day' && tab._calViaWeek && tab._buildContext({}).all.cal.crumbs.map(c => c.label).join('›') === '2045›August›Week 33›Mon 14', 'a day opened from a week keeps the week in the crumb');
  await tab.onAct('calUp', null, null);
  ok(tab._calLevel === 'week', '…and Esc goes back to the week');
  await tab.onAct('calLevel', null, { dataset: { level: 'year' } });
  ok(tab._calLevel === 'year' && tab._calAnim === 'up', 'a crumb walks back to the year');
  await tab.onAct('calJump', null, { dataset: { to: 'month' } });
  ok(tab._calLevel === 'month' && tab._calMonth === AUG && tab._buildContext({}).all.cal.quick[2].on, 'This month jumps to the game clock’s month');
  await tab.onAct('calJump', null, { dataset: { to: 'week' } });
  ok(tab._calLevel === 'week' && tab._calWeek === WK14, 'This week');
  // Every filter narrows every count.
  tab._af = new Set(['anon']);
  await tab.onAct('calLevel', null, { dataset: { level: 'year' } });
  ctx = tab._buildContext({});
  ok(ctx.all.cal.tiles[AUG].n === 1 && ctx.all.grand === 1, 'the Filter picker narrows the tiles (one anonymous message)');
  tab._af = new Set();
  ScopePicker.set(tab.scopeId('who'), ['c:mc-queen']);
  ok(tab._buildContext({}).all.cal.tiles[AUG].n === 1, 'Who narrows the tiles');
  ScopePicker.set(tab.scopeId('who'), []);
  // A search whose hits sit elsewhere moves the view to the newest hit.
  await tab.onAct('calMonth', null, { dataset: { month: '0' } });
  ok(tab._buildContext({}).all.cal.rows.length === 0, 'January is empty');
  tab._search = 'diagnostics'; tab._calAuto = true;
  ctx = tab._buildContext({});
  ok(tab._calMonth === AUG && ctx.all.cal.rows.length === 1 && ctx.all.cal.rows[0].messageId === 'sd1' && ctx.all.cal.tiles === undefined, 'a new search jumps an empty view to the month of the newest hit');
  tab._search = '';
  // Paging: 50 at a time, Load more.
  await tab.onAct('calDay', null, { dataset: { ms: String(DAY14) } });
  tab._calLimit = 2;
  ctx = tab._buildContext({});
  ok(ctx.all.shown === 2 && ctx.all.total === dated && ctx.all.hasMore, 'the day’s list is paged');
  await tab.onAct('calMore', null, null);
  ok(tab._calLimit === 52 && !tab._buildContext({}).all.hasMore, 'Load more adds a page (the selection survives)');
  // openTo from the Overview lands on the day holding the message, a fan-out by its base id.
  tab.openTo('msg:g1'); tab._calLevel = 'year';
  ctx = tab._buildContext({});
  ok(ctx.all.cal.isDay && tab._calDay === DAY14 && tab._sel === 'fanout:g1' && ctx.all.sel.isGroupRow, 'openTo(message) opens the day that holds it, on the fan-out row');
  // Counts in one pass over the whole feed (aggregates, not marks).
  const cc = M.calendarCounts(tab._gatherActivity().filtered);
  ok(cc.years.get(2045).n === dated && cc.days.get(DAY14).n === dated && cc.months.get('2045-7').unread > 0, 'calendarCounts: years / months / weeks / days from one pass');
  tab._sel = 'fanout:g1';
  ctx = tab._buildContext({});
  settings.deliveryFailures = [{ id: 'f0', baseId: 'g1', toName: 'Jo', why: 'Jo: dead zone' }];
  ok(tab._buildContext({}).all.sel.dl.rcp.some(r => r.name === 'Jo' && r.state === 'fail'), 'and who it did not reach (from the failure log), in the delivery line');
  settings.deliveryFailures = [];
  tab._sel = 'm2';
  const d = tab._buildContext({}).all.sel;
  ok(d.canReplyAs && d.inboxOwnerId === 'rogue' && d.canDelete, 'player → NPC mail offers Reply as + Delete');
  tab._sel = 'a1';
  ok(tab._buildContext({}).all.sel.from.real === 'Hana Ito', 'anonymous: the real sender in the reading pane');
  let opened = null; game.nightcity.openComposer = (o) => { opened = o; };
  svc.getMessage = async (owner, id) => ({ messageId: id, toContactId: 'mc-rogue' });
  await tab.onAct('replyAs', null, { dataset: { inboxOwner: 'rogue', messageId: 'm2' } });
  ok(opened?.mode === 'reply' && opened.fromContactId === 'mc-rogue', 'Reply as opens the composer as the identity it reached');
}

// ═══ 4. Outbox — the failure log, held mail, scheduled, timers ═══
{
  const row = await svc.recordDeliveryFailure({ data: { messageId: 'x1', fromName: 'Kiri', subject: 'hi', body: 'b', eddies: 100, fromActorId: 'v', _fanout: [{}, {}] },
    result: { failed: [{ name: 'Jo', actorId: 'jo', error: 'dead zone' }], results: [{}, {}] }, source: 'relay', byUserName: 'Sam' });
  ok(row && settings.deliveryFailures.length === 1 && settings.deliveryFailures[0].why === 'Jo: dead zone', 'a failure is written to the log');
  ok(row.retry.recipients?.[0]?.actorId === 'jo' && row.retry.eddies === undefined && !row.retry._fanout && row.retry.fromActorId === 'v', 'retry re-sends to the failed recipients, without eddies or the fan-out');
  ok(row.hadEddies, 'the row remembers money was involved (the note says it is not re-sent)');
  sent.length = 0;
  const rr = await svc.retryDeliveryFailure(row.id);
  ok(rr.success && sent[0]?.recipients?.[0]?.actorId === 'jo' && settings.deliveryFailures.length === 0, 'Retry sends it and clears the row');
  await svc.recordDeliveryFailure({ data: { messageId: 'x2', subject: 's' }, result: { error: 'Refused: send-only' } });
  svc.sendMessage = async () => ({ success: false, error: 'still refused' });
  await svc.retryDeliveryFailure(settings.deliveryFailures[0].id);
  ok(settings.deliveryFailures[0].why === 'still refused' && settings.deliveryFailures[0].retriedAt, 'a failed retry updates the reason');
  svc.sendMessage = async (data) => { sent.push(data); return { success: true, failed: [] }; };
  await svc.dismissDeliveryFailure(settings.deliveryFailures[0].id);
  ok(settings.deliveryFailures.length === 0, 'Dismiss');
  const src = read('scripts/services/MessageService.js');
  ok(/recordDeliveryFailure\(\{ data, result, source: 'relay'/.test(src), 'the GM relay-failure toast also writes the log');
  ok((src.match(/recordDeliveryFailure\(\{ data, result: res, source: 'gm' \}\)/g) || []).length === 2, 'GM fan-out refusals (some / all) write the log');

  // Held mail: a player's report, deliver now / cancel.
  svc.receiveQueueSync({ userName: 'Sam', entries: [{ messageId: 'q1', fromName: 'V', toName: 'Viktor', subject: 'Arm', _queueReason: 'dead_zone', _queuedAt: new Date().toISOString() }, { messageId: 'q2', subject: 'x' }] }, 'p1');
  const q = svc.getQueue();
  ok(q.length === 2 && q[0].remote && q[0].userName === 'Sam' && q[0].reason.startsWith('Dead zone'), 'the GM sees what a player is holding, and why');
  let relayed = null; svc.handleMessageRelay = async (data, uid) => { relayed = { data, uid }; };
  emitted.length = 0;
  const fd = await svc.forceDeliver('q1');
  ok(fd.success && relayed?.uid === 'p1' && relayed.data.messageId === 'q1', 'Deliver now: the GM delivers the reported message itself');
  ok(emitted.some(e => e.op === C.SOCKET_OPS.MESSAGE_QUEUE_CMD && e.data.forUserId === 'p1' && e.data.messageId === 'q1'), '…and tells the player to drop it');
  await svc.cancelQueued('q2');
  ok(emitted.some(e => e.op === C.SOCKET_OPS.MESSAGE_QUEUE_CMD && e.data.op === 'cancel' && e.data.messageId === 'q2') && svc.getQueue().length === 0, 'Cancel tells the player too');
  // Player side drops it.
  const pl = Object.create(MessageService.prototype); pl._messageQueue = [{ messageId: 'z', subject: 's' }]; 
  game.user.isGM = false; pl.handleQueueCommand({ op: 'cancel', messageId: 'z' }); game.user.isGM = true;
  ok(pl._messageQueue.length === 0, 'the player client removes a delivered / cancelled message');

  tab._view = 'outbox';
  settings.deliveryFailures = [{ id: 'f1', fromName: 'Kiri', toName: 'Jo', subject: 's', why: 'w', at: new Date().toISOString(), gameAt: T(20), hadEddies: true }];
  svc.receiveQueueSync({ entries: [{ messageId: 'q3', subject: 'held' }] }, 'p1');
  const ob = tab._buildContext({}).outbox;
  ok(ob.failures.length === 1 && ob.failures[0].eddiesNote && ob.queue.length === 1 && ob.scheduled.length === 1 && ob.timers.length === 1, 'Outbox: didn’t arrive · waiting · scheduled · timers');
  ok(ob.timers[0].messageId === 'sd1' && ob.timers[0].when.startsWith('in '), 'a timed self-destruct counts down');
  ok(tab._buildContext({}).nav[2].tone === 'bad', 'a failure turns the Outbox badge red');
  await tab.onAct('schedSendNow', null, { dataset: { scheduleId: 's1' } });
  ok(schedCalls.join() === 'deliver,persist', 'Send now delivers the scheduled entry and saves');
  let upd = null; journals.get('j-rache').pages.find(p => p.flags[MOD].messageId === 'sd1').update = async (u) => { upd = u; };
  await tab.onAct('stopTimer', null, { dataset: { journalId: 'j-rache', pageId: journals.get('j-rache').pages.find(p => p.flags[MOD].messageId === 'sd1').id } });
  ok(upd && upd[`flags.${MOD}.selfDestruct`] === null, 'Stop clears the self-destruct');
}

// ═══ 5. Inboxes ═══
{
  tab._view = 'inboxes';
  const ib = tab._buildContext({}).inboxes;
  const labels = ib.groups.map(g => g.label);
  ok(labels.join() === 'Players’ characters,NPCs & their aliases,Owner gone', 'grouped players / NPCs / owner gone');
  const rogue = ib.groups[1].rows.find(r => r.ownerId === 'rogue');
  ok(rogue && rogue.aliases === 1, 'an NPC row covers its aliases');
  ok(ib.groups[2].rows[0].orphan, 'the orphaned inbox sits under Owner gone');
  const vrow = ib.groups[0].rows.find(r => r.ownerId === 'v');
  ok(vrow.unread === 2, 'counts per inbox (spam counts as unread, like getUnreadCount)');
  ok(/^last mail .+ ago$/.test(vrow.line) && tab._ibSort === 'recent', 'the default sort is Latest mail, and the row says so');
  ok(ib.sorts.length === 5 && ib.sorts.every(x => x.hint) && ib.shows[0].label === 'Everyone', 'every sort explains itself; Show starts on Everyone');
  tab._ibSort = 'busy';
  ok(/in 14 days$/.test(tab._buildContext({}).inboxes.groups[0].rows[0].line), 'Busiest prints the count it sorts by');
  tab._ibSort = 'recent';
  ok(ib.look && !ib.detail && Array.isArray(ib.look.most) && ib.look.gone.some(r => r.ownerId === 'mc-gone'), 'nothing picked: the desk is Needs a look (most unread, gone quiet, owner gone)');
  await tab.onAct('ibSel', null, { dataset: { ownerId: 'rogue' } });
  const picked = tab._buildContext({}).inboxes;
  ok(picked.detail?.ownerId === 'rogue' && !picked.look && picked.detail.spark.length === 14 && picked.detail.writeLabel === 'Write as' && picked.groups[1].rows.find(r => r.ownerId === 'rogue').sel, 'picking a mailbox puts it on the desk');
  await tab.onAct('ibSel', null, { dataset: { ownerId: 'rogue' } });
  ok(!tab._ibSel, 'picking it again goes back to Needs a look');
  tab._ibSearch = 'hana';
  ok(tab._buildContext({}).inboxes.groups.flatMap(g => g.rows).map(r => r.ownerId).join() === 'mc-hana', 'inbox search');
  tab._ibSearch = '';
  const n = await tab._ibMarkRead(['j-v']);
  ok(n === 2, 'mark an inbox read');
}

// ═══ 6. Header — Send as + Broadcast ═══
{
  const items = tab._sendAsItems();
  ok(items.some(i => i.id === 'rogue|mc-queen' && i.meta.startsWith('alias of')) && items.some(i => i.group === 'System addresses' && i.name === 'NetWatch notice'), 'Send as lists every identity, aliases and system addresses');
  let composed = null; game.nightcity.composeMessage = (o) => { composed = o; };
  tab._sendAsPicker();
  ScopePicker.set(tab.scopeId('sendas'), ['rogue|mc-queen']);
  MessagesTab.prototype.onNpcQuickSend.call(tab, null, { closest: () => ({ dataset: { npcId: 'rogue', contactId: 'mc-queen' } }) });
  ok(composed?.fromContactId === 'mc-queen', 'Send as an alias opens the composer AS the alias');

  tab._bcOpen = true;
  ok(tab._bcRecipients().map(r => r.actorId).sort().join() === 'rache,v', 'Broadcast to nobody picked = every player character');
  ScopePicker.set(tab.scopeId('bcto'), ['online']);
  ok(tab._bcRecipients().map(r => r.actorId).join() === 'v', 'Everyone online');
  ScopePicker.set(tab.scopeId('bcto'), ['g:grp1', 'a:v']);
  ok(tab._bcRecipients().length === 2, 'a group + a character, deduped');
  ScopePicker.set(tab.scopeId('bcfrom'), ['rogue|mc-rogue']);
  tab._bc = { subject: 'Curfew', body: 'Stay in', priority: 'urgent', later: false, when: '' };
  sent.length = 0;
  await tab._onBroadcastSend();
  ok(sent[0]?.isBroadcast && sent[0].recipients.length === 2 && sent[0].fromContactId === 'mc-rogue' && sent[0].priority === 'urgent', 'Broadcast sends ONE fan-out as the picked identity');
  ok(!tab._bcOpen, 'the panel closes after a send');
  tab._bcOpen = true; tab._bc = { subject: 's', body: 'b', priority: 'normal', later: true, when: '2045-08-15T08:00' };
  ScopePicker.set(tab.scopeId('bcfrom'), ['rogue|mc-rogue']);
  schedCalls.length = 0;
  await tab._onBroadcastSend();
  ok(schedCalls[0]?.when === '2045-08-15T08:00:00.000Z' && schedCalls[0].data.recipients.length === 2 && schedCalls[0].data.fromActorId === 'rogue', 'Send later schedules the fan-out (game time)');
}

// ═══ 6b. The delivery line (All mail → reading pane) ═══
{
  // ── The rules (pure) ──
  const D = M.deliveryLine, G = M.groupDeliveryLine;
  const opsOf = (x) => (x.fixes || []).map(f => f.op || f.action);
  const held = D({ toName: 'Judy', messageId: 'h', held: { reason: 'dead_zone', by: 'Rache', place: 'The Docks' } });
  ok(held.tone === 'wait' && /Held on Rache’s Agent/.test(held.line) && opsOf(held).join() === 'dlDeliver,dlNetworks', 'held: amber, says whose Agent, Deliver now + the scene’s networks');
  ok(held.grid.some(g => g.screen?.mark === '◷ MESSAGE QUEUED') && held.grid.some(g => g.k === 'By itself'), 'held: what Rache saw + what happens by itself');
  ok(D({ held: { reason: 'gm_offline', by: 'Rache' } }).fixes.length === 1, 'held with no GM online: no network fix');
  const ref = D({ toName: 'NetWatch', failure: { id: 'f', sendOnly: true, contactId: 'mc', addr: 'n@x', sender: 'V', senderActorId: 'v', source: 'relay' } });
  ok(ref.tone === 'bad' && /Refused/.test(ref.line) && opsOf(ref).join() === 'dlUnlock,dlAnswerAs' && ref.grid.some(g => g.screen?.mark === '✕ TRANSMISSION REFUSED'), 'refused (send-only): red, the player’s screen, let them write / answer as');
  const unl = D({ toName: 'NetWatch', failure: { sendOnly: true, unlocked: true, contactId: 'mc', sender: 'V' } });
  ok(unl.tone === 'good' && /Players can write to it now/.test(unl.line) && opsOf(unl).join() === 'dlRelock', 'after Let players write: green, with the way back');
  const nd = D({ toName: 'Jo', failure: { id: 'f9', why: 'Jo: no inbox', source: 'gm', contactId: 'mc-j' } });
  ok(nd.tone === 'bad' && opsOf(nd).join() === 'failRetry,dlContact' && nd.grid.some(g => g.k === 'Who knows'), 'not delivered: red, Retry (the Outbox retry) + open the contact');
  const ans = D({ toName: 'V', readAt: '21:30', reply: { at: '21:41', snippet: 'On my way.', owner: 'v', id: 'r' } });
  ok(ans.tone === 'good' && /read it at 21:30 and replied at 21:41/.test(ans.line) && ans.pips.join() === 'on,on,on,on', 'answered: read time + reply time, all four pips');
  ok(ans.steps.map(s => s.label).join() === 'Sent,Delivered,Read,Replied' && ans.steps[3].time === '21:41', 'answered: the steps carry their times');
  ok(/opened it at 20:00\./.test(D({ toName: 'V', read: true, readAt: '20:00' }).line) && /opened it\. No reply/.test(D({ toName: 'V', read: true }).line), 'read: with a time when known, without one for old mail');
  const un = D({ toName: 'V', toIsPlayer: true, playerName: 'Sam', playerOnline: false, toActorId: 'v', messageId: 'u', inboxOwnerId: 'v' });
  ok(un.tone === 'wait' && /Sam\) is offline/.test(un.line) && opsOf(un).join() === 'dlNudge,openMsgInInbox' && /log in/.test(un.fixes[0].label), 'unread by a player: amber, offline player, nudge when they log in');
  ok(D({ toName: 'Misty', toIsPlayer: false, inboxOwnerId: 'm', messageId: 'x' }).tone === 'good', 'delivered to an NPC: green (it’s for the GM)');
  ok(D({ toName: 'V', gone: true }).tone === 'wait', 'a sent copy whose received copy is gone');
  ok(!/<script>/.test(D({ toName: '<script>x</script>', read: true }).line), 'names are escaped (the line prints raw)');
  const g = G({ messageId: 'fanout:z', fromName: 'Queen', alias: { of: 'Rogue' }, rcp: [
    { name: 'V', state: 'ans' }, { name: 'Judy', state: 'read' }, { name: 'Misty', state: 'got' }, { name: 'Rache', state: 'held' }, { name: 'Brick', state: 'fail' }, { name: 'Ana', state: 'got', toIsPlayer: true, actorId: 'ana' }] });
  ok(/Sent to <b class="is-n">6<\/b>/.test(g.line) && /2 read/.test(g.line) && /2 delivered/.test(g.line) && /1 waiting/.test(g.line) && /1 not delivered/.test(g.line), 'group: Sent to N · read · delivered · waiting · not delivered');
  ok(g.tone === 'bad' && g.rcp.map(r => r.sq).join() === 'read,read,got,held,fail,got', 'group: red when anyone failed; one square per recipient');
  ok(/they see the alias, not Rogue/.test(g.foot.text) && g.foot.fixes.some(f => f.op === 'dlNudgeAll'), 'group: sent as an alias, Nudge everyone who hasn’t read it');
  ok(G({ rcp: [{ name: 'a', state: 'held' }] }).tone === 'wait' && G({ rcp: [{ name: 'a', state: 'read' }] }).tone === 'good', 'group tones: amber when held, green when fine');

  // ── Through the tab ──
  tab._view = 'all'; tab._af = new Set(); tab._box = 'all'; tab._search = ''; tab._filter = 'all'; ScopePicker.set(tab.scopeId('who'), []);
  settings.deliveryFailures = [];
  svc._remoteQueues = new Map();
  const vj = journals.get('j-v'), rj = journals.get('j-rogue');
  vj.pages.push(msg({ messageId: 'dl1', subject: 'Meet', fromActorId: 'rogue', fromContactId: 'mc-rogue', from: 'rogue@afterlife.nc', toActorId: 'v', to: 'v@nightcity.net', timestamp: T(20), status: { read: true, readAt: T(21) } }));
  rj.pages.push(msg({ messageId: 'dl1r', subject: 'RE: Meet', inReplyTo: 'dl1', fromActorId: 'v', from: 'v@nightcity.net', toActorId: 'rogue', timestamp: T(21) + '', body: '<p>On my way.</p>' }));
  rj.pages[rj.pages.length - 1].flags[MOD].timestamp = new Date(Date.UTC(2045, 7, 14, 21, 10)).toISOString();
  vj.pages.push(msg({ messageId: 'dl2', subject: 'Payment', fromActorId: 'rogue', fromContactId: 'mc-rogue', from: 'rogue@afterlife.nc', toActorId: 'v', to: 'v@nightcity.net', timestamp: T(19) }));
  const detail = (id) => { tab._sel = id; return tab._buildContext({}).all.sel; };
  const a = detail('dl1');
  ok(a.dl && !a.dl.group && a.dl.tone === 'good' && /Answered/.test(a.dl.line) && a.dl.steps[2].time && a.dl.steps[3].time, 'tab: a read + replied message is Answered, with both times');
  ok(a.dl.grid.some(x => x.k === 'Their answer' && /On my way/.test(x.v)) && a.dl.fixes.some(f => f.action === 'openMsgInInbox' && f.data['message-id'] === 'dl1r'), 'tab: their answer quoted, and a door to it');
  ok(!a.dl.open, 'the line starts closed');
  const u = detail('dl2');
  ok(u.dl.tone === 'wait' && /Sam\) is online/.test(u.dl.line) && u.dl.fixes[0].op === 'dlNudge', 'tab: unread by V, Sam is online → Nudge');

  // open state: a Set on the tab, so a re-render keeps it
  const boxCls = new Set(['ncm-msg2-dl']);
  const btn = { dataset: { id: 'dl2' }, setAttribute() {}, closest: () => ({ classList: { toggle: (c, on) => (on ? boxCls.add(c) : boxCls.delete(c)) } }) };
  const before = renders;
  await tab.onAct('dlToggle', null, btn);
  ok(tab._dlOpen.has('dl2') && boxCls.has('is-open') && renders === before, 'dlToggle opens it in the DOM, no re-render');
  ok(detail('dl2').dl.open, 'and it is still open after a re-render');
  await tab.onAct('dlToggle', null, btn);
  ok(!tab._dlOpen.has('dl2') && !boxCls.has('is-open'), 'click again closes it');

  // Nudge → the recipient's client gets the same MESSAGE_NOTIFY a delivery sends
  emitted.length = 0;
  await tab.onAct('dlNudge', null, { dataset: { id: 'dl2', actor: 'v' } });
  ok(emitted.some(e => e.op === C.SOCKET_OPS.MESSAGE_NOTIFY && e.data.toActorId === 'v' && e.data.messageId === 'dl2' && e.data.subject === 'Payment'), 'Nudge (player online) re-sends the new-message toast');
  ok(/you nudged/.test(detail('dl2').dl.line) && !detail('dl2').dl.fixes.some(f => f.op === 'dlNudge'), 'after a nudge the line says so');
  // offline → a whisper waits for them
  const chats = []; globalThis.ChatMessage = { create: async (m) => chats.push(m) };
  actors.get('rache').ownership = {}; game.users.find(u2 => u2.id === 'p2').active = false;
  ok(await tab._nudge('x', 'rache', { subject: 'S', fromName: 'Rogue' }) && chats[0]?.whisper?.join() === 'p2', 'Nudge (player offline) whispers their user, never public');

  // Held on a player's Agent: a row of its own, Deliver now → forceDeliver (the Outbox flow)
  svc.receiveQueueSync({ userName: 'Lou', entries: [{ messageId: 'hq1', fromActorId: 'rache', from: 'rache@nightcity.net', toActorId: 'rogue', subject: 'Get me out', body: 'Docks', _queueReason: 'dead_zone', _queuedAt: new Date().toISOString(), timestamp: T(21) }] }, 'p2');
  const hrow = tab._gatherActivity().filtered.find(e => e.messageId === 'hq1');
  ok(hrow?.isPending && hrow.held && tab._rowFlags(hrow).some(f => f.label === 'Held'), 'a held message is listed in All mail, flagged Held');
  const hd = detail('hq1');
  ok(hd.dl.tone === 'wait' && /Held on Rache’s Agent/.test(hd.dl.line) && hd.dl.fixes[0].op === 'dlDeliver' && !hd.canDelete && !hd.openId, 'held: the line + Deliver now; no page-only buttons');
  let relayed = null; svc.handleMessageRelay = async (data, uid) => { relayed = { data, uid }; };
  await tab.onAct('dlDeliver', null, { dataset: { id: 'hq1' } });
  ok(relayed?.data?.messageId === 'hq1' && relayed.uid === 'p2', 'Deliver it now delivers it through forceDeliver → handleMessageRelay');
  let opened = null; game.nightcity.openAdminTab = async (t, o) => { opened = { t, o }; };
  await tab.onAct('dlNetworks', null, { dataset: {} });
  ok(opened?.t === 'networks' && opened.o.select === 'view:scene', 'Open this scene’s networks → Admin → Networks, this scene');

  // Refused (send-only): a failure with no page
  settings.deliveryFailures = [{ id: 'fx1', baseId: 'fx1', source: 'relay', fromName: 'V', toName: 'NetWatch notice', subject: 'Turning myself in', why: 'Refused: notice@netwatch.nc is send-only', at: new Date().toISOString(), gameAt: T(20),
    retry: { fromActorId: 'v', to: 'notice@netwatch.nc', toContactId: 'mc-sys', subject: 'Turning myself in', body: 'I know.' } }];
  const rf = detail('fx1');
  ok(rf.dl.tone === 'bad' && /Refused/.test(rf.dl.line) && rf.dl.fixes.map(f => f.op).join() === 'dlUnlock,dlAnswerAs', 'refused: red line with Let players write / Answer as');
  let upd = null; game.nightcity.masterContactService.updateContact = async (id, u2) => { upd = { id, u2 }; master.find(c => c.id === id).sendOnly = u2.sendOnly; return { success: true }; };
  await tab.onAct('dlUnlock', null, { dataset: { contact: 'mc-sys' } });
  ok(upd?.id === 'mc-sys' && upd.u2.sendOnly === false && /Players can write to it now/.test(detail('fx1').dl.line), 'Let players write to it: send-only off (updateContact), the line turns green');
  await tab.onAct('dlRelock', null, { dataset: { contact: 'mc-sys' } });
  ok(master.find(c => c.id === 'mc-sys').sendOnly === true, 'Make it send-only again');
  let composed = null; game.nightcity.composeMessage = (o) => { composed = o; };
  await tab.onAct('dlAnswerAs', null, { dataset: { contact: 'mc-sys', actor: 'v', subject: 'Turning myself in' } });
  ok(composed?.fromContactId === 'mc-sys' && composed.toActorId === 'v' && /^RE:/.test(composed.subject), 'Answer as the system address opens the composer as it, to the player');
  await tab.onAct('dlContact', null, { dataset: { contact: 'mc-sys' } });
  ok(opened?.t === 'contacts' && opened.o.select === 'mc-sys', 'Open the contact → Admin → Contacts on it');

  // Group: the fan-out row g1 + a recipient whose character was deleted (in a group)
  groups[0].members.push({ hint: { actorId: 'ghost' }, name: 'Brick' });
  settings.deliveryFailures = [{ id: 'fg1', baseId: 'g1', source: 'gm', fromName: 'Rogue', toName: 'Brick', subject: 'Job tonight', why: 'Brick: Recipient not found', retry: { recipients: [{ actorId: 'ghost', name: 'Brick' }] } }];
  const gd = detail('fanout:g1');
  ok(gd.dl.group && gd.dl.rcp.length === 3 && gd.dl.tone === 'bad' && /Sent to <b class="is-n">3<\/b>/.test(gd.dl.line), 'group mail: one row per recipient incl. the one it didn’t reach');
  const brick = gd.dl.rcp.find(r => r.name === 'Brick');
  ok(brick.state === 'fail' && /character was deleted/.test(brick.why) && brick.fix.op === 'dlRemoveMember', 'a deleted member: why + Remove from the group');
  const vr = gd.dl.rcp.find(r => r.name === 'V');
  ok(vr.state === 'read', 'V read their copy');
  let savedGroup = null; game.nightcity.contactGroupService.getMasterGroup = (id) => groups.find(x => x.id === id); game.nightcity.contactGroupService.saveMasterGroup = async (gg) => { savedGroup = gg; };
  await tab.onAct('dlRemoveMember', null, { dataset: { group: 'grp1', actor: 'ghost' } });
  ok(savedGroup && !savedGroup.members.some(m => m.hint?.actorId === 'ghost') && savedGroup.members.length === 2, 'Remove from the group saves it without them');
  ok(gd.dl.foot.fixes.some(f => f.op === 'dlNudgeAll'), 'Nudge everyone who hasn’t read it (Rache has not)');
  ok(!M.groupDeliveryLine({ rcp: [{ name: 'a', state: 'got', toIsPlayer: true, actorId: 'a', nudged: true }] }).foot.fixes.length, '…and not once everyone unread was nudged');
  emitted.length = 0; chats.length = 0;
  await tab.onAct('dlNudgeAll', null, { dataset: { id: 'fanout:g1' } });
  ok(chats.length === 1 && chats[0].whisper.join() === 'p2', 'Nudge everyone: only the unread copy (Rache, offline → a whisper)');
  settings.deliveryFailures = [];

  // ── readAt: the data change ──
  const { MessageRepository } = await imp('scripts/data/MessageRepository.js');
  ok(MessageRepository.readStamp() === new Date(NOW).toISOString(), 'the read stamp is the game clock (time provider)');
  let created = null;
  const fakeRepo = { getInboxJournal: async () => ({ createEmbeddedDocuments: async (t, docs) => { created = docs[0]; return [docs[0]]; } }), _getTimestamp: () => T(9), _resolveSenderName: () => 'X' };
  globalThis.foundry.utils.randomID = () => 'newid';
  await MessageRepository.prototype.createMessage.call(fakeRepo, 'v', { subject: 's', body: 'b', toActorId: 'v' });
  ok(created && created.flags[MOD].status.readAt === null && 'readAt' in created.flags[MOD].status, 'createMessage: new mail has status.readAt null (built field by field)');
  const back = MessageRepository.prototype._pageToMessage.call({}, { id: 'p', parent: { id: 'j' }, flags: created.flags });
  ok(back.status.readAt === null && back.status.read === false, '_pageToMessage reads it back');
  const back2 = MessageRepository.prototype._pageToMessage.call({}, { id: 'p', parent: { id: 'j' }, flags: { [MOD]: { ...created.flags[MOD], status: { read: true, readAt: T(21) } } } });
  ok(back2.status.readAt === T(21), '…and a stamped one round-trips');
  ok(MessageRepository.prototype._pageToMessage.call({}, { id: 'p', flags: { [MOD]: { messageId: 'old', status: { read: true } } } }).status.readAt === null, 'old mail (no readAt) reads as null');
  let ups = null;
  await MessageRepository.prototype.markAsRead.call({ updateMessage: async (a2, id, u2) => { ups = u2; return { success: true }; } }, 'v', 'm');
  ok(ups?.['status.read'] === true && ups['status.readAt'] === new Date(NOW).toISOString(), 'markAsRead stamps status.readAt from the time provider');
  const jpages = [{ id: 'x1', flags: { [MOD]: { messageId: 'x1', status: { read: false } } } }];
  let batch = null;
  await MessageRepository.prototype.markAllAsRead.call({ getInboxJournal: async () => ({ pages: { contents: jpages }, updateEmbeddedDocuments: async (t, u2) => { batch = u2; } }) }, 'v');
  ok(batch?.[0]?.[`flags.${MOD}.status.readAt`] === new Date(NOW).toISOString(), 'markAllAsRead stamps it too');
  const tabSrc = read('scripts/ui/AdminPanel/tabs/MessagesTab.js');
  ok((tabSrc.match(/status\.readAt`\]: MessageRepository\.readStamp\(\)/g) || []).length === 3, 'the admin panel’s own mark-read writers stamp it (bulk, inbox, the reading pane toggle)');

  // ── every fix the line can offer is handled ──
  const modelSrc = read('scripts/ui/AdminPanel/tabs/messagesModel.js');
  const dlSrc = tabSrc.slice(tabSrc.indexOf('_deliveryFor('), tabSrc.indexOf('_nudge('));
  const fixOps = new Set([...(modelSrc + dlSrc).matchAll(/op: '([a-zA-Z]+)'/g)].map(m2 => m2[1]));
  ok(fixOps.size >= 9, 'the line offers its fixes as tabAct ops');
  for (const op of fixOps) ok(new RegExp(`case '${op}'`).test(tabSrc), `fix op "${op}" is handled by onAct`);
  for (const act of new Set([...(modelSrc + dlSrc).matchAll(/action: '([a-zA-Z]+)'/g)].map(m2 => m2[1]))) ok(new RegExp(`^\\s+${act}: AdminPanelApp\\._`, 'm').test(read('scripts/ui/AdminPanel/AdminPanelApp.js')), `fix action "${act}" is registered`);
  ok(!/computed per row|_deliveryFor\(e,/.test(tabSrc.slice(tabSrc.indexOf('const rows = res.entries.map'), tabSrc.indexOf('const rows = res.entries.map') + 900)), 'the line is not built per row (only for the open message)');
}

// ═══ 7. Wiring guards ═══
const tpl = read('templates/admin-panel/tab-messages.hbs');
const js = read('scripts/ui/AdminPanel/tabs/MessagesTab.js');
const css = read('styles/components/admin-panel/tab-messages.css');
const appSrc = read('scripts/ui/AdminPanel/AdminPanelApp.js');
{
  const ops = new Set([...tpl.matchAll(/data-op="([a-zA-Z]+)"/g)].map(m => m[1]));
  for (const op of ops) ok(new RegExp(`case '${op}'`).test(js), `data-op "${op}" is handled by onAct`);
  ok(/case 'openConversation'/.test(js), 'onAct handles the Overview jump');
  const acts = new Set([...tpl.matchAll(/data-action="([a-zA-Z]+)"/g)].map(m => m[1]));
  for (const a of acts) ok(new RegExp(`^\\s+${a}: AdminPanelApp\\._`, 'm').test(appSrc), `data-action "${a}" is registered`);
  const classes = new Set([...tpl.matchAll(/class="([^"]+)"/g)].flatMap(m => m[1].replace(/\{\{[^}]*\}\}/g, ' ').split(/\s+/)).filter(c => c.startsWith('ncm-msg')));
  for (const c of classes) ok(css.includes(`.${c}`), `class .${c} is styled`);
  ok(!/\.ncm-msg-(?!alias|feed-recip)[a-z]/.test(tpl), 'no old ncm-msg-* classes left in the template (except the two sims guard)');
  ok(/\.ncm-admin-panel--pop \.ncm-msg2-split/.test(css), 'pop-out widens the split');
  ok(!/#[0-9a-f]{6}/i.test(css.replace(/\/\*[\s\S]*?\*\//g, '')), 'tab CSS uses tokens, no literal brand hex');
  ok(!/style="[^"]*#[0-9a-f]{6}/i.test(js), 'no inline literal colours in JS-built dialogs');
  ok(/'npcMailAnswered'/.test(read('scripts/core/SettingsManager.js')) && /'deliveryFailures'/.test(read('scripts/core/SettingsManager.js')), 'answered marker + failure log are registered world settings');
  const sh = read('scripts/integrations/SocketHandlers.js');
  ok(/MESSAGE_QUEUE_SYNC/.test(sh) && /MESSAGE_QUEUE_CMD/.test(sh) && C.SOCKET_OPS.MESSAGE_QUEUE_SYNC && C.SOCKET_OPS.MESSAGE_QUEUE_CMD, 'held-mail socket ops are defined and handled');
  const ov = read('scripts/ui/AdminPanel/tabs/OverviewTab.js');
  ok(/op: 'openConversation', key: convKey\(g\.ownerId, g\.aliasId\)/.test(ov) && /isAnswered\(m, sent, answered\)/.test(ov), 'Overview mail items jump to the conversation and count waiting by the same rule');
  ok(/msg2:/.test(js) && !/return \{\s*npcSendEntries/.test(js), 'context is namespaced under msg2');
}

// ═══ 8. REAL render through Handlebars ═══
let H = null;
for (const p of ['C:/Program Files/Foundry Virtual Tabletop/resources/app/package.json', 'C:/Program Files (x86)/Foundry Virtual Tabletop/resources/app/package.json']) {
  if (!existsSync(p)) continue;
  try { H = createRequire(p)('handlebars'); break; } catch { /* keep looking */ }
}
if (!H) { fail++; console.error('FAIL: could not load Handlebars from a Foundry install — render checks did not run'); }
else {
  H.registerHelper('eq', (a, b) => String(a) === String(b));
  H.registerHelper('gt', (a, b) => Number(a) > Number(b));
  // ncm-hue is registered globally in Foundry (scripts/utils/tagHue.js); the template uses it for people's hues.
  { const { registerTagHueHelper } = await import(new URL('../../../scripts/utils/tagHue.js', import.meta.url)); registerTagHueHelper(H); }
  const render = H.compile(tpl);
  settings.deliveryFailures = [{ id: 'f1', fromName: 'Kiri', toName: 'Jo', subject: 's', why: 'w', at: new Date().toISOString(), gameAt: T(20) }];
  ScopePicker.set(tab.scopeId('sendas'), []); ScopePicker.set(tab.scopeId('bcfrom'), []); ScopePicker.set(tab.scopeId('bcto'), []);
  for (const view of ['reply', 'all', 'outbox', 'inboxes']) {
    tab._view = view; tab._sel = view === 'all' ? 'fanout:g1' : tab._sel; tab._bcOpen = view === 'reply';
    const msg2 = tab._buildContext({});
    const html = render({ activeTab: 'messages', msg2 });
    // NCM_DUMP=<dir>: write each rendered view for dev/mockups/admin-messages-preview.html.
    if (process.env.NCM_DUMP) (await import('fs')).writeFileSync(`${process.env.NCM_DUMP}/msg2-${view}.html`, html);
    ok(html.includes('ncm-msg2-nav') && !/undefined|\[object Object\]|NaN/.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), `${view}: renders with no undefined / [object Object] / NaN`);
    if (view === 'reply') ok(html.includes('data-op="replySend"') && html.includes('ncm-msg2-bc') && html.includes('Reply as'), 'reply: conversation + reply box + the broadcast panel');
    if (view === 'all') {
      ok(html.includes('Each recipient') && html.includes('ncm-msg2-cal__crumb') && html.includes('Filter') && html.includes('data-scope-btn'), 'all: the navigator, the Filter picker, the group send’s recipients');
      const acts = html.slice(html.indexOf('ncm-msg2-acts--line'), html.indexOf('ncm-msg2-body'));
      ok(/Share to chat/.test(acts) && /data-op="copyToTerminal"/.test(acts) && /ncm-msg2-junkbtn|hardDeleteMessage/.test(acts), 'the action row holds Share · Copy to terminal · Junk ▾ / Delete (a fan-out row has no single inbox)');
      tab._sel = 'm2';
      const h1 = render({ activeTab: 'messages', msg2: tab._buildContext({}) });
      const acts1 = h1.slice(h1.indexOf('ncm-msg2-acts--line'), h1.indexOf('ncm-msg2-body'));
      ok(/data-op="actReply"/.test(acts1) && /Reply as Rogue/.test(acts1) && /data-op="actInbox"/.test(acts1) && /Rogue’s inbox/.test(acts1) && /shareMsgToChat/.test(acts1) && /copyToTerminal/.test(acts1) && /hardDeleteMessage/.test(acts1) && !/ncm-msg2-acts">/.test(h1), 'a lone message: ONE Reply as · ONE Inbox · Share · Copy · Delete on the one line, the names in the tooltips');
      ok((acts1.match(/<button/g) || []).length <= 6, 'never more than six buttons on the row');
      // ONE button each: a single choice acts at once, several open the picker.
      const d1 = tab._buildContext({}).all.sel;
      ok(d1.replyAs.length === 2 && d1.replyAsMany && d1.replyAs[0].contactId === 'mc-rogue' && d1.replyAs[1].contactId === 'mc-queen', 'Reply as offers the identity it reached first, then the NPC’s other identities');
      ok(d1.inboxes.length === 1 && !d1.inboxMany && d1.inboxes[0].owner === 'rogue', 'one inbox → one choice');
      let openedBox = null; game.nightcity.openInbox = (o, id) => { openedBox = { o, id }; };
      await tab.onAct('actInbox', null, { dataset: { messageId: 'm2' } });
      ok(openedBox?.o === 'rogue' && openedBox.id === 'm2', 'a single inbox opens at once, no picker');
      tab._sel = 'm6';
      const d2 = tab._buildContext({}).all.sel;
      ok(d2.inboxes.length === 2 && d2.inboxMany && /sent copy/.test(d2.inboxes[1].label) && d2.replyAs.length === 2, 'a received copy with a sent twin: two inboxes to pick from (the twin’s sent copy second)');
      tab._sel = 'dl1';
      ok(tab._buildContext({}).all.sel.replyAs.length === 0, 'mail to a player character offers no Reply as');
      ok(/\.ncm-msg2-cal__grip \{[^}]*cursor: row-resize/.test(css) && /data-cal-grip/.test(tpl) && /\[data-cal-grip\]/.test(js) && /dblclick/.test(js) && /ArrowUp/.test(js.slice(js.indexOf('data-cal-grip'))), 'the grip: drag, double-click reset, ↑ ↓ nudge');
      tab._sel = 'fanout:g1';
      ok(/\.ncm-msg2-acts--line \{[^}]*flex-wrap: nowrap/.test(css) && /\.ncm-msg2-acts--line \.lb \{ display: none/.test(css) && /\.ncm-admin-panel--pop \.ncm-msg2-acts--line \.lb \{ display: inline/.test(css), 'it never wraps: quiet buttons are icon-only at 820px and labelled in the pop-out');
      // Every level, for the preview (NCM_DUMP writes msg2-all-<level>.html).
      const DAY14 = Date.UTC(2045, 7, 14);
      for (const [lvl, set] of [['year', () => tab._calSet(M.calStateFor('year', DAY14))], ['month', () => tab._calSet(M.calStateFor('month', DAY14), 'grow')], ['week', () => tab._calSet(M.calStateFor('week', DAY14), 'fold')], ['day', () => tab._calSet(M.calStateFor('day', DAY14), 'fold')]]) {
        set();
        const h2 = render({ activeTab: 'messages', msg2: tab._buildContext({}) });
        ok(h2.includes(`data-cal-level="${lvl}"`) && !/undefined|NaN|\[object Object\]/.test(h2), `all (${lvl}): renders`);
        if (lvl === 'year') ok((h2.match(/ncm-msg2-cal__mt/g) || []).length === 12 && h2.includes('is-now') && h2.includes('is-hot'), 'year: 12 tiles, now, an amber bar');
        if (lvl === 'month') ok(h2.includes('ncm-msg2-cal__days') && h2.includes('is-today') && h2.includes('data-op="calWeek"') && h2.includes('ncm-msg2-r--cal'), 'month: grid, today, week buttons, rows');
        if (lvl === 'day') ok(h2.includes('ncm-msg2-cal__strip') && h2.includes('is-on') && /ncm-msg2-cal__hr">evening/.test(h2) && h2.includes('data-cal-anim="fold"') && h2.includes('is-fresh'), 'day: strip, the picked cell, the hour bands, the fold entrance');
        if (process.env.NCM_DUMP) (await import('fs')).writeFileSync(`${process.env.NCM_DUMP}/msg2-all-${lvl}.html`, h2);
      }
      tab._calSet(M.calStateFor('day', DAY14));
    }
    if (view === 'outbox') ok(html.includes('data-op="failRetry"') && html.includes('data-delivery-time') && html.includes('data-op="stopTimer"'), 'outbox: all four cards with their actions');
    if (view === 'inboxes') {
      ok(html.includes('ncm-ib__list') && html.includes('ncm-ib__r') && html.includes('Needs a look') && html.includes('data-msg2-ibsel="sort"') && html.includes('data-op="ibFoldAll"'), 'inboxes: the list, Needs a look, the Show/Group/Sort selects, the ⋯ menu');
      tab._ibSel = 'mc-gone';
      const h3 = render({ activeTab: 'messages', msg2: tab._buildContext({}) });
      ok(h3.includes('Fix in Orphan Audit') && h3.includes('data-op="ibDelete"') && !/undefined|\[object Object\]|NaN/.test(h3), 'inboxes: an orphan on the desk offers the Orphan Audit and Delete');
      tab._ibSel = 'rogue';
      const h4 = render({ activeTab: 'messages', msg2: tab._buildContext({}) });
      ok(h4.includes('Open inbox') && h4.includes('Write as') && h4.includes('ncm-ib__bars') && h4.includes('Housekeeping') && !/undefined|\[object Object\]|NaN/.test(h4), 'inboxes: a mailbox on the desk — open, write, traffic, housekeeping');
      if (process.env.NCM_DUMP) (await import('fs')).writeFileSync(`${process.env.NCM_DUMP}/msg2-inboxes-drawer.html`, h4);
      tab._ibSel = null;
    }
  }
  // The delivery line, rendered open, for each state (NCM_DUMP writes msg2-dl-<state>.html for the preview).
  {
    svc.receiveQueueSync({ userName: 'Lou', entries: [{ messageId: 'hq2', fromActorId: 'rache', from: 'rache@nightcity.net', toActorId: 'rogue', subject: 'Get me out', body: 'Docks are crawling.', _queueReason: 'dead_zone', _queuedAt: new Date().toISOString(), timestamp: T(21) }] }, 'p2');
    settings.deliveryFailures = [
      { id: 'fx2', baseId: 'fx2', source: 'relay', fromName: 'V', toName: 'NetWatch notice', subject: 'Turning myself in', why: 'Refused: send-only', at: new Date().toISOString(), gameAt: T(20), retry: { fromActorId: 'v', to: 'notice@netwatch.nc', toContactId: 'mc-sys', subject: 'Turning myself in', body: 'I know what’s on the shard.' } },
      { id: 'fg2', baseId: 'g1', source: 'gm', fromName: 'Rogue', toName: 'Brick', subject: 'Job tonight', why: 'Brick: Recipient not found', retry: { recipients: [{ actorId: 'ghost', name: 'Brick' }] } },
    ];
    tab._view = 'all';
    for (const [state, id] of [['answered', 'dl1'], ['unread', 'dl2'], ['held', 'hq2'], ['refused', 'fx2'], ['group', 'fanout:g1']]) {
      tab._sel = id; tab._dlOpen.add(id);
      const html = render({ activeTab: 'messages', msg2: tab._buildContext({}) });
      ok(html.includes('ncm-msg2-jr is-') && html.includes('Where it went') && (state === 'group' ? html.includes('ncm-msg2-jr__p') : html.includes('ncm-msg2-jr__st')) && !/undefined|NaN|\[object Object\]/.test(html), `delivery line (${state}) renders open`);
      if (state === 'group') ok(html.includes('ncm-msg2-dl__rcp') && html.includes('data-op="dlRemoveMember"') && html.includes("you nudged them"), "group line renders each recipient + their fixes (Rache was nudged above)");
      if (state === 'held') ok(html.includes('data-op="dlDeliver" data-id="hq2"'), 'held line renders Deliver now with its id');
      if (state === 'answered') ok(html.includes('data-action="openMsgInInbox" data-owner="messages" data-inbox-owner="rogue" data-message-id="dl1r"'), 'answered line opens the answer');
      if (process.env.NCM_DUMP) (await import('fs')).writeFileSync(`${process.env.NCM_DUMP}/msg2-dl-${state}.html`, html);
    }
    tab._dlOpen.clear();
    tab._sel = 'dl2';
    ok(!render({ activeTab: 'messages', msg2: tab._buildContext({}) }).includes('ncm-msg2-jr is-wait is-open'), 'closed unless the GM opened it');
    settings.deliveryFailures = []; svc._remoteQueues = new Map();
  }
  // empty world
  const saved = journals.splice(0);
  settings.deliveryFailures = [];
  svc._remoteQueues = new Map();
  const sched = scheduling.getPending; scheduling.getPending = () => [];
  for (const view of ['reply', 'all', 'outbox', 'inboxes']) {
    tab._view = view; tab._sel = null; tab._convSel = null; tab._bcOpen = false;
    const html = render({ activeTab: 'messages', msg2: tab._buildContext({}) });
    ok(!/undefined|NaN/.test(html), `${view}: empty state renders cleanly`);
  }
  journals.push(...saved); scheduling.getPending = sched;
  ok(render({ activeTab: 'overview', msg2: null }).trim() === '', 'renders nothing on another tab');
}

console.log(`\ntest-admin-messages: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
