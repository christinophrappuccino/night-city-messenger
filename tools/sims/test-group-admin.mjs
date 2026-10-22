// Sim: contact groups phase 3 (items 1–3) — Mass Broadcast through the fan-out,
// Activity-feed collapse of a fan-out into one expandable row, and Orphan Audit
// for group members that resolve to nothing. Drives the REAL MessageService,
// MessagesTab and ToolsTab (prototype + mocked world), then static guards.
import { pathToFileURL } from 'url';
import { readFileSync } from 'fs';

const ROOT = 'C:/Users/cphan/AppData/Local/FoundryVTT/Data/modules/night-city-messenger';
const MOD = 'night-city-messenger';
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };

// ── World ──
const emailOf = new Map([['v', 'v@nightcity.net'], ['panam', 'panam@aldecaldos.nc']]);
const flagStore = new Map();
const mkActor = (id, name, type = 'character', hasPlayerOwner = true) => {
  flagStore.set(id, {});
  return {
    id, name, type, hasPlayerOwner, isOwner: true, img: '',
    getFlag: (m, k) => (k === 'email' ? emailOf.get(id) || '' : flagStore.get(id)[k]),
    setFlag: async (m, k, v) => { flagStore.get(id)[k] = JSON.parse(JSON.stringify(v)); },
  };
};
const actors = new Map([['v', mkActor('v', 'V', 'character', false)], ['panam', mkActor('panam', 'Panam Palmer')], ['rogue', mkActor('rogue', 'Rogue', 'npc', false)]]);
const master = [
  { id: 'mc-rogue', name: 'Rogue', email: 'rogue@afterlife.nc', actorId: 'rogue', role: 'fixer' },
  { id: 'mc-kerry', name: 'Kerry Eurodyne', email: 'kerry@eurodyne.nc', actorId: null, role: 'rocker' },
];
const settings = { requireContactVerification: false, autoRegisterNpcSenders: false, spamUnknownSenderEnabled: false, notifyGmNpcMail: false, masterContactGroups: [], traceHeat: {} };
const created = [];
const journals = [];
const pageFor = (data) => ({ id: `p${created.length}`, name: data.subject, flags: { [MOD]: { ...data, status: { read: false, deleted: false, ...(data.status || {}) } } }, text: { content: data.body } });
globalThis.game = {
  user: { id: 'u-gm', isGM: true },
  users: Object.assign([{ id: 'u-gm', isGM: true, name: 'GM' }, { id: 'p1', isGM: false, name: 'Alice', character: actors.get('panam') }], { find(fn) { return Array.prototype.find.call(this, fn) || null; }, activeGM: { id: 'u-gm' } }),
  actors: { get: (id) => actors.get(id) || null, contents: [...actors.values()], [Symbol.iterator]: function* () { yield* actors.values(); } },
  settings: { get: (m, k) => settings[k], set: async (m, k, v) => { settings[k] = JSON.parse(JSON.stringify(v)); } },
  get journal() { return journals; },
  scenes: [],
  items: { get: () => null },
  nightcity: {
    masterContactService: { getContact: (id) => master.find(c => c.id === id) || null, getByEmail: (e) => master.find(c => c.email === e) || null, getByActorId: (id) => master.find(c => c.actorId === id) || null, getAll: () => master, isSendOnly: () => false },
    contactRepository: { getActorEmail: (id) => emailOf.get(id) || '', verifyContact: () => ({ verified: true }) },
    messageRepository: { createMessage: async (inbox, data) => {
      created.push({ inbox, data });
      let j = journals.find(x => x._owner === inbox);
      if (!j) {
        const isActor = !!actors.get(inbox);
        j = { _owner: inbox, name: inbox, folder: null, flags: { [MOD]: isActor ? { type: 'inbox', actorId: inbox } : { type: 'contactInbox', contactId: inbox } }, pages: [] };
        journals.push(j);
      }
      j.pages.push(pageFor(data));
      return { success: true, messageId: data.messageId };
    } },
    socketManager: { emit: () => {} }, soundService: { play: () => {} }, eventBus: { emit: () => {}, on: () => {} },
    networkService: { currentNetworkId: 'citinet', getMessageAccessControl: () => null, signalStrength: 100, isDeadZone: false, getNetwork: () => null },
    terminalService: { mirrorDeliveryToAccounts: async () => {} }, timeService: { getCurrentTime: () => '2077-10-20T12:00:00.000Z' },
  },
};
globalThis.foundry = { utils: { deepClone: (o) => JSON.parse(JSON.stringify(o)), mergeObject: (a, b) => ({ ...a, ...b }), randomID: (() => { let n = 0; return () => `id${++n}`; })() } };
globalThis.Hooks = { on: () => {}, once: () => {}, off: () => {} };
globalThis.ui = { notifications: { info: () => {}, warn: () => {}, error: () => {} } };
globalThis.document = { createElement: () => ({ _h: '', set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; }, querySelectorAll: () => [] }) };
globalThis.Handlebars = { escapeExpression: (s) => String(s ?? '') };

const { MessageService } = await import(pathToFileURL(`${ROOT}/scripts/services/MessageService.js`).href);
const { MessagesTab } = await import(pathToFileURL(`${ROOT}/scripts/ui/AdminPanel/tabs/MessagesTab.js`).href);
const { ToolsTab } = await import(pathToFileURL(`${ROOT}/scripts/ui/AdminPanel/tabs/ToolsTab.js`).href);
const { ContactGroupService, memberFromMasterContact } = await import(pathToFileURL(`${ROOT}/scripts/services/ContactGroupService.js`).href);
const { makeMember } = await import(pathToFileURL(`${ROOT}/scripts/utils/participants.js`).href);
const groupSvc = new ContactGroupService();
game.nightcity.contactGroupService = groupSvc;

const svc = Object.create(MessageService.prototype); svc._messageQueue = [];
const tab = Object.create(MessagesTab.prototype);
tab.app = { _activeTab: 'messages', _relativeTime: () => 'just now', _getRelativeTime: () => 'just now', masterContactService: game.nightcity.masterContactService, messageRepository: game.nightcity.messageRepository, contactRepository: game.nightcity.contactRepository };
tab._npcInboxExpanded = new Set(); tab._npcInboxUnreadOnly = false; tab._npcInboxIncludeGm = false; tab._filter = 'all'; tab._limit = 50; tab._expandedId = null; tab._search = ''; tab._actorFilter = '';

// ═══ 1. A broadcast-shaped send through the fan-out (what Mass Broadcast now does) ═══
{
  const r = await svc.sendMessage({ from: 'NCPD', subject: 'Curfew', body: 'Stay in.', isBroadcast: true,
    recipients: [{ contactId: 'mc-rogue' }, { contactId: 'mc-kerry' }, { actorId: 'panam' }] });
  ok(r.success && r.delivered === 3, 'a sender-name-only broadcast fans out to three inboxes');
  ok(!created.some(c => c.data.status?.sent), 'no sent copy when the sender is a bare name (no inbox to put it in)');
  ok(created.every(c => c.data.from === 'NCPD' && c.data.isBroadcast), 'every copy keeps the typed From and the broadcast flag');
}

// ═══ 2. Activity feed collapses the fan-out ═══
{
  const feed = tab._gatherActivity();
  const rows = feed.entries;
  ok(rows.length === 1 && rows[0].isGroupRow && rows[0].recipientCount === 3, 'three copies collapse into ONE group row');
  ok(rows[0].unread && rows[0].statusLabel === '3 / 3 unread', 'the group row reports per-recipient read state');
  ok(rows[0].messageId.startsWith('fanout:') && rows[0].inboxOwnerId === '', 'the group row has a synthetic id and no single inbox owner');
  tab._expandedId = rows[0].messageId;
  const g = tab._gatherActivity().entries[0];
  ok(g.isExpanded && g.recipients.length === 3 && g.recipients.every(x => x.messageId && x.inboxOwnerId && x.toName), 'expanding lists each copy with the ids its Open/Delete buttons need');
  // mark one read → counts follow
  journals.find(j => j._owner === 'panam').pages[0].flags[MOD].status.read = true;
  ok(tab._gatherActivity().entries[0].statusLabel === '2 / 3 unread', 'reading one copy updates the group row');
  // unread filter keeps a partially-read group
  tab._filter = 'unread';
  ok(tab._gatherActivity().entries.length === 1 && tab._gatherActivity().entries[0].recipientCount === 2, 'the Unread filter narrows the group to its unread copies');
  tab._filter = 'all';
  // a lone message is untouched
  await svc.sendMessage({ from: 'NCPD', subject: 'Solo', body: 'x', recipients: [{ actorId: 'panam' }] });
  const rows2 = tab._gatherActivity().entries;
  ok(rows2.some(e => !e.isGroupRow && e.subject === 'Solo') && rows2.filter(e => e.isGroupRow).length === 1, 'a single-recipient send stays an ordinary row');
}

// ═══ 3. Orphan Audit: dead group members ═══
{
  const tools = Object.create(ToolsTab.prototype);
  tools.app = { masterContactService: game.nightcity.masterContactService };
  Object.defineProperty(tools, 'masterContactService', { value: game.nightcity.masterContactService });
  await groupSvc.saveMasterGroup({ name: 'Afterlife', members: [memberFromMasterContact(master[0]), makeMember({ name: 'Ghost', hint: { actorId: 'deleted-actor' } }), makeMember({ email: 'raw@street.nc', name: 'Raw' })] });
  await groupSvc.saveActorGroup('panam', { name: 'Old crew', members: [makeMember({ name: 'Gone', hint: { contactId: 'deleted-contact' } })] });
  const found = tools._gatherOrphans();
  ok(found.groupMembers.length === 2, 'two dead members found (one GM group, one player group); the raw address is NOT an orphan');
  ok(found.groupMembers.some(g => g.scope === 'master' && g.memberName === 'Ghost') && found.groupMembers.some(g => g.scope === 'actor' && g.actorId === 'panam' && g.memberName === 'Gone'), 'each is attributed to its group and owner');
  const removed = await tools._pruneGroupMembers(found.groupMembers);
  ok(removed === 2, 'prune reports both removals');
  ok(groupSvc.getMasterGroups()[0].members.length === 2 && groupSvc.getMasterGroups()[0].members.every(m => m.name !== 'Ghost'), 'the GM group keeps its live members');
  ok(groupSvc.getActorGroups('panam').length === 0, 'a group left empty is deleted');
  ok(tools._gatherOrphans().groupMembers.length === 0, 'a second audit is clean');
}

// ═══ 4. Drift guards ═══
{
  const mt = readFileSync(`${ROOT}/scripts/ui/AdminPanel/tabs/MessagesTab.js`, 'utf8');
  ok(/name="target"/.test(mt) && /groupSvc\.recipientsFor\(group\)\.recipients/.test(mt) && /isBroadcast: true, recipients/.test(mt), 'Mass Broadcast offers a target select and sends ONE fan-out with recipients');
  ok(!/for \(const pa of playerActors\) \{\s*try \{\s*\/\/ `to` is left/.test(mt), 'the old per-player broadcast loop is gone');
  ok(/_collapseFanout\(filtered\)/.test(mt), 'the feed runs the fan-out collapse after filtering, before pagination');
  const tpl = readFileSync(`${ROOT}/templates/admin-panel/tab-messages.hbs`, 'utf8');
  ok(/this\.isGroupRow/.test(tpl) && /ncm-msg-feed-recip/.test(tpl) && /data-mode="gm"/.test(tpl), 'feed template renders the group row, its recipient list, and the Include GM-sent chip');
  const tt = readFileSync(`${ROOT}/scripts/ui/AdminPanel/tabs/ToolsTab.js`, 'utf8');
  ok(/found\.groupMembers\.length/.test(tt) && /_pruneGroupMembers/.test(tt), 'Orphan Audit counts, lists and prunes dead group members');
}

console.log(`\ntest-group-admin: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
