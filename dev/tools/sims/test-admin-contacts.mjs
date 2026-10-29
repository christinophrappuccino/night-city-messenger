// Sim: Admin → Contacts redesign (2026-10-27) — the GM Contact Manager folded into the tab.
// Drives the REAL ContactsTab + contactsModel + MasterContactService (prototype, in-memory
// contacts) over a mocked world, renders the REAL tab-contacts.hbs through Foundry's
// Handlebars for each view, and guards the wiring (every data-op handled, every class
// styled, every opener repointed, the retired window gone).
//   Run: node dev/tools/sims/test-admin-contacts.mjs
import { pathToFileURL, fileURLToPath } from 'url';
import { readFileSync, existsSync, readdirSync, statSync, writeFileSync } from 'fs';
import { createRequire } from 'module';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const MOD = 'night-city-messenger';
const read = (f) => readFileSync(`${ROOT}/${f}`, 'utf8');
let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) pass++; else { fail++; console.error('FAIL:', name); } };

// ═══ World ═══
const flags = new Map();
const mkActor = (id, name, { type = 'character', player = false, email = '', img = '' } = {}) => {
  flags.set(id, { email, contacts: [] });
  return {
    id, name, type, hasPlayerOwner: player, isOwner: true, img, items: [],
    getFlag: (m, k) => flags.get(id)[k],
    setFlag: async (m, k, v) => { flags.get(id)[k] = JSON.parse(JSON.stringify(v)); },
    testUserPermission: () => player,
  };
};
const actors = new Map([
  ['v', mkActor('v', 'V', { player: true, email: 'v@nightcity.net', img: 'v.png' })],
  ['rache', mkActor('rache', 'Rache', { player: true, email: '' })],
  ['rogue', mkActor('rogue', 'Rogue', { type: 'npc', email: 'rogue@afterlife.nc', img: 'rogue.png' })],
  ['hound', mkActor('hound', 'Hellhound', { type: 'blackIce' })],
]);
const settings = { contactsGroupBy: 'role', masterContactGroups: [] };
const journals = [];
const mkPage = (id, f) => ({ id, name: f.subject, flags: { [MOD]: f } });
const mkJournal = (id, owner, isContact, pages) => {
  const list = Object.assign([...pages], { contents: pages, get: (pid) => pages.find((p) => p.id === pid) });
  return { id, name: `${owner} — Inbox`, folder: null, flags: { [MOD]: isContact ? { type: 'contactInbox', contactId: owner } : { type: 'inbox', actorId: owner } }, pages: list };
};
const users = [{ id: 'gm', isGM: true, name: 'GM' }, { id: 'u1', isGM: false, name: 'Marta', character: actors.get('v'), color: { css: '#b85c7a' } }, { id: 'u2', isGM: false, name: 'Sam', character: actors.get('rache'), color: { css: '#5c86b8' } }];
let renders = 0;
const toasts = [];
globalThis.game = {
  user: { id: 'gm', isGM: true },
  users: Object.assign(users, { find(fn) { return Array.prototype.find.call(this, fn) || null; } }),
  actors: { get: (id) => actors.get(id) || null, get contents() { return [...actors.values()]; }, [Symbol.iterator]: function* () { yield* actors.values(); } },
  settings: { get: (m, k) => settings[k], set: async (m, k, v) => { settings[k] = JSON.parse(JSON.stringify(v)); } },
  get journal() { return Object.assign(journals, { get: (id) => journals.find((j) => j.id === id) }); },
  nightcity: {},
};
let rid = 0;
globalThis.foundry = { utils: { deepClone: (o) => JSON.parse(JSON.stringify(o)), mergeObject: (a, b) => ({ ...a, ...b }), randomID: () => `id${++rid}`, debounce: (f) => f } };
globalThis.Hooks = { on: () => {}, once: () => {}, off: () => {}, callAll: () => {} };
globalThis.ui = { notifications: { info: (m) => toasts.push(['info', m]), warn: (m) => toasts.push(['warn', m]), error: (m) => toasts.push(['error', m]) } };
globalThis.CSS = { escape: (s) => String(s) };
const confirms = []; let confirmAnswer = true;
globalThis.Dialog = { confirm: async (cfg) => { confirms.push(cfg); return confirmAnswer; } };
globalThis.__ncmScopePickerWired = true;   // the scope picker's document listeners are a browser concern

const { MasterContactService } = await import(pathToFileURL(`${ROOT}/scripts/services/MasterContactService.js`).href);
const { ContactGroupService } = await import(pathToFileURL(`${ROOT}/scripts/services/ContactGroupService.js`).href);
const { ContactsTab } = await import(pathToFileURL(`${ROOT}/scripts/ui/AdminPanel/tabs/ContactsTab.js`).href);
const M = await import(pathToFileURL(`${ROOT}/scripts/ui/AdminPanel/tabs/contactsModel.js`).href);
const vocab = await import(pathToFileURL(`${ROOT}/scripts/utils/contactVocab.js`).href);

// Real MasterContactService over an in-memory list.
const mcs = Object.create(MasterContactService.prototype);
mcs._contacts = [
  { id: 'c-rogue', name: 'Rogue', email: 'rogue@afterlife.nc', actorId: 'rogue', role: 'fixer', organization: 'Afterlife', primaryIdentity: true, trust: 4, relationships: { v: { type: 'ally', trust: 5, note: 'owes V' } }, notes: 'Runs the Afterlife.', tags: ['AFTERLIFE'] },
  { id: 'c-queen', name: 'Queen of Hearts', email: 'queen.h@darknet', actorId: 'rogue', role: 'fixer' },
  { id: 'c-dex', name: 'Dexter DeShawn', email: 'dex@nightcity.net', role: 'fixer', notes: 'Auto-registered when the GM sent "job" from this actor.' },
  { id: 'c-judy', name: 'Judy Alvarez', email: 'v@nightcity.net', role: 'tech' },
  { id: 'c-net', name: 'NetWatch notice', email: 'notice@netwatch.gov', sendOnly: true, role: 'government' },
  { id: 'c-brick', name: 'Brick', email: 'brick@maelstrom.gang', role: 'solo', encrypted: true, organization: 'Maelstrom' },
  { id: 'c-vself', name: 'V', email: 'v@nightcity.net', actorId: 'v' },   // a PC-linked contact → Players view, not the directory
];
mcs._persistContacts = async () => {};
mcs._onMasterListChanged = async () => {};
mcs._syncActorEmail = async () => {};
game.nightcity.eventBus = { emit: () => {}, on: () => {} };
mcs.getCustomRoles = () => [];
mcs.getAllTags = () => ['AFTERLIFE'];
const repo = {
  getContacts: async (aid) => flags.get(aid).contacts,
  addContact: async (aid, data) => { flags.get(aid).contacts.push({ id: `pc${++rid}`, ...data }); return { success: true }; },
  removeContact: async (aid, cid) => { flags.get(aid).contacts = flags.get(aid).contacts.filter((c) => c.id !== cid); return { success: true }; },
};
const groupSvc = new ContactGroupService();
const opened = [];
Object.assign(game.nightcity, {
  masterContactService: mcs, contactRepository: repo, contactGroupService: groupSvc,
  messageRepository: { _pageToMessage: (p) => ({ ...p.flags[MOD], pageId: p.id }) },
  composeMessage: (o) => opened.push(['compose', o]), openComposer: (o) => opened.push(['composer', o]),
  openInbox: (id, m) => opened.push(['inbox', id, m]),
});
// V knows Rogue already (by master id); nobody knows Brick.
flags.get('v').contacts.push({ id: 'pc-rogue', name: 'Rogue', email: 'rogue@afterlife.nc', masterContactId: 'c-rogue' });
// Player mail waiting: V wrote to the Queen alias (unread) and to Rogue (read).
journals.push(mkJournal('j-rogue', 'rogue', false, [
  mkPage('p1', { messageId: 'm1', subject: 'Need a job', fromActorId: 'v', toContactId: 'c-queen', timestamp: '2077-10-20T10:00:00Z', status: { read: false } }),
  mkPage('p2', { messageId: 'm2', subject: 'Thanks', fromActorId: 'v', toContactId: 'c-rogue', timestamp: '2077-10-19T10:00:00Z', status: { read: true } }),
]));

const app = { _activeTab: 'contacts', element: null, id: 'ncm-admin-panel', isPopout: false, render: () => { renders++; }, _relativeTime: () => '1h ago', masterContactService: mcs, contactRepository: repo, messageRepository: game.nightcity.messageRepository };
const tab = new ContactsTab(app);
const ctx = () => tab.prepareContext();

// ═══ 1. Context gate + the HUD count ═══
{
  app._activeTab = 'overview';
  const off = ctx();
  ok(off.contactSummary.total === 7 && !off.ct2, 'off-tab: only the HUD count, no Contacts work');
  app._activeTab = 'contacts';
  ok(!!ctx().ct2?.dir, 'on-tab: the directory context is built');
}

// ═══ 2. Directory: NPCs only, aliases nested under the main, row indicators ═══
{
  const d = ctx().ct2.dir;
  const rows = d.groups.flatMap((g) => g.rows);
  ok(!rows.some((r) => r.id === 'c-vself'), 'a PC-linked contact stays out of the directory');
  const iR = rows.findIndex((r) => r.id === 'c-rogue'), iQ = rows.findIndex((r) => r.id === 'c-queen');
  ok(iR >= 0 && iQ === iR + 1 && rows[iQ].alias, 'the alias sits right under its main');
  ok(rows[iQ].mail === 1 && rows[iR].mail === 0, 'mail waiting counts on the identity it reached');
  ok(rows.find((r) => r.id === 'c-rogue').knows.length === 1 && rows.find((r) => r.id === 'c-brick').knows.length === 0, 'who-knows dots come from the players’ own lists');
  ok(rows.find((r) => r.id === 'c-dex').check && rows.find((r) => r.id === 'c-judy').check, 'needs-a-look: auto-added + duplicate address');
  ok(rows.find((r) => r.id === 'c-brick').ice, 'encrypted marker');
  ok(d.groups.some((g) => g.label === 'Fixers') && d.groups.some((g) => g.label === 'Government'), 'grouped by role with plural headings');
  const n = (k) => d.chips.find((c) => c.key === k).n;
  ok(n('all') === 5 && n('mail') === 1 && n('alias') === 1 && n('sys') === 1 && n('ice') === 1 && n('check') === 2, `filter counts (mains): ${d.chips.map((c) => `${c.key}=${c.n}`).join(' ')}`);
  tab._filter = 'unknown';
  const unknown = ctx().ct2.dir.groups.flatMap((g) => g.rows).map((r) => r.id);
  ok(unknown.includes('c-brick') && unknown.includes('c-queen') && unknown.indexOf('c-rogue') === unknown.indexOf('c-queen') - 1, 'Nobody knows filter (an unknown alias brings its main along)');
  tab._filter = 'mail';
  const mailRows = ctx().ct2.dir.groups.flatMap((g) => g.rows).map((r) => r.id);
  ok(mailRows.includes('c-rogue') && mailRows.includes('c-queen'), 'Mail waiting: an alias hit brings its main along');
  tab._filter = 'all'; tab._search = 'maelstrom';
  ok(ctx().ct2.dir.groups.flatMap((g) => g.rows).map((r) => r.id).join() === 'c-brick', 'search matches the organization');
  tab._search = '';
  tab._groupBy = 'org';
  ok(ctx().ct2.dir.groups.at(-1).label === 'No organization', 'group by organization, catch-all last');
  tab._groupBy = 'role';
}

// ═══ 3. Detail ═══
{
  tab._selId = 'c-queen';
  const s = ctx().ct2.dir.sel;
  ok(s.tags.some((t) => /alias of Rogue/.test(t.label)), 'detail: alias tag names the main');
  ok(s.mail?.count === 1, 'detail: mail waiting bar');
  ok(s.who.length === 2 && s.who.every((w) => !w.on), 'detail: every PC offered, nobody knows the alias yet');
  ok(s.ids.many && s.ids.rows[0].id === 'c-rogue' && s.ids.rows[0].main, 'detail: identities, main first');
  tab._selId = 'c-dex';
  ok(ctx().ct2.dir.sel.needs.some((n) => n.isAuto), 'detail: auto-added fix bar');
  tab._selId = 'c-judy';
  const dup = ctx().ct2.dir.sel.needs.find((n) => n.isDup);
  ok(dup && /V/.test(dup.text), 'detail: duplicate-address fix bar names the other holder');
  tab._selId = 'c-rogue';
  const r = ctx().ct2.dir.sel;
  ok(r.trust.rows.some((t) => t.actorId === 'v' && t.override && t.rel === 'ALLY'), 'detail: per-player trust override + relationship');
}

// ═══ 3b. Directory groups fold — the default-fold rule (2026-10-28) ═══
// First group open, the rest closed; a closed head shows its count + waiting mail + problems; the
// group holding the selection is open; a search / filter / facet opens everything; GM choices win.
{
  // the pure rule
  ok(M.foldShut({ index: 0, key: 'a' }) === false && M.foldShut({ index: 1, key: 'b' }) === true, 'rule: first group open, the rest shut');
  ok(M.foldShut({ index: 3, key: 'b', forced: true }) === false && M.foldShut({ index: 0, key: 'a', forced: true, choices: new Map([['a', true]]) }) === false, 'rule: a search/filter opens everything, even a GM fold');
  ok(M.foldShut({ index: 2, key: 'b', selKey: 'b' }) === false, 'rule: the group holding the selection is open');
  ok(M.foldShut({ index: 0, key: 'a', choices: new Map([['a', true]]) }) === true && M.foldShut({ index: 4, key: 'z', choices: { z: false } }) === false, "rule: the GM's own choice beats the default (Map or object)");
  const fb = M.foldBadges([{ mail: 2 }, { mail: 0, check: true }, { mail: 1, check: true }]);
  ok(fb.waiting === 3 && fb.checks === 2, 'rule: badges sum waiting mail and count contacts that need a look');
  ok(M.foldBadges([{ waiting: 4 }], { mailKey: 'waiting' }).waiting === 4, 'rule: badges read another mail key (Who they know)');
  const legacy = M.readFoldChoices(['role:Fixers']);
  ok(legacy.get('role:Fixers') === true && legacy.size === 1 && M.readFoldChoices({ a: false }).get('a') === false && M.readFoldChoices(null).size === 0, 'stored choices: the old shut-key array reads as shut choices; the new map round-trips');

  // the real tab
  tab._dirFold = new Map(); tab._dirSelSeen = undefined; tab._dirSelKey = null; tab._selId = null; tab._filter = 'all'; tab._facets = []; tab._search = '';
  let gs = ctx().ct2.dir.groups;
  ok(gs.length > 2 && gs[0].shut === false && gs.slice(1).every((g) => g.shut), 'Directory default: only the first group is open');
  ok(gs[0].rows.some((r) => r.sel), 'Directory default: the auto-picked contact sits in the open group');
  const fixers = gs.find((g) => g.label === 'Fixers');
  ok(fixers && fixers.waiting === 1 && fixers.checks >= 1 && fixers.n === 2, 'a group carries its main count, waiting mail and needs-a-look count');
  tab._selId = 'c-brick';
  gs = ctx().ct2.dir.groups;
  ok(gs.find((g) => g.rows.some((r) => r.id === 'c-brick')).shut === false && gs[0].shut === false, 'selecting a contact opens its group; the first stays open');
  const g0 = gs[0];
  await tab.onAct('dirFold', {}, { dataset: { key: g0.key, shut: '' } });
  ok(ctx().ct2.dir.groups.find((g) => g.key === g0.key)?.shut === true && tab._dirFold.get(g0.key) === true, "clicking an open head folds it and records the GM's choice");
  const bk = gs.find((g) => g.rows.some((r) => r.id === 'c-brick')).key;
  await tab.onAct('dirFold', {}, { dataset: { key: bk, shut: '' } });
  ok(ctx().ct2.dir.groups.find((g) => g.key === bk)?.shut === true, 'the GM can fold the group holding the selection');
  tab._search = g0.rows[0].name.slice(0, 3);
  ok(ctx().ct2.dir.groups.every((g) => !g.shut) && ctx().ct2.dir.canFold === false, 'a search opens every group (a fold never hides a match)');
  tab._search = ''; tab._filter = 'mail';
  ok(ctx().ct2.dir.groups.every((g) => !g.shut), 'a filter opens every group');
  tab._filter = 'all'; tab._facets = ['role:fixer'];
  ok(ctx().ct2.dir.groups.every((g) => !g.shut), 'a facet opens every group');
  tab._facets = [];
  ok(ctx().ct2.dir.groups.find((g) => g.key === g0.key)?.shut === true, "the GM's fold comes back once the search/filter is cleared");
  await tab.onAct('dirFold', {}, { dataset: { key: g0.key, shut: '1' } });
  ok(ctx().ct2.dir.groups.find((g) => g.key === g0.key)?.shut === false && tab._dirFold.get(g0.key) === false, 'clicking a shut head opens it again');
  const late = ctx().ct2.dir.groups.at(-1);
  await tab.onAct('dirFold', {}, { dataset: { key: late.key, shut: '1' } });
  ok(ctx().ct2.dir.groups.at(-1).shut === false, 'a GM-opened later group stays open');
  { const src = read('scripts/ui/AdminPanel/tabs/ContactsTab.js'); ok(src.includes('this._saveDirFold(); return this.render') && src.includes("'ncm.ct2.dirFolds'"), 'choices persist per viewer (localStorage ncm.ct2.dirFolds)'); }
  const tpl = readFileSync(new URL('../../../templates/admin-panel/tab-contacts.hbs', import.meta.url), 'utf8');
  ok(tpl.includes('data-op="dirFold" data-key="{{key}}" data-shut="{{#if shut}}1{{/if}}"') && /\{\{#unless shut\}\}\s*\{\{#each rows\}\}/.test(tpl) && tpl.includes('data-op="dirFoldAll"'), 'template: header folds (and says its state), rows hide when shut, Collapse/Expand all');
  tab._dirFold = new Map(); tab._dirSelSeen = undefined; tab._dirSelKey = null; tab._selId = 'c-rogue';
}

// ═══ 4. Detail actions ═══
{
  await tab.onAct('looksRight', {}, { dataset: { id: 'c-dex' } });
  ok(mcs.getContact('c-dex').reviewed === true && !M.isAutoAdded(mcs.getContact('c-dex')), '"Looks right" stores reviewed (whitelisted) and the bar goes');
  await tab.onAct('replyAs', {}, { dataset: { id: 'c-queen' } });
  const rep = opened.findLast((o) => o[0] === 'composer');
  ok(rep?.[1].mode === 'reply' && rep[1].fromContactId === 'c-queen' && rep[1].originalMessage?.messageId === 'm1', 'Reply as answers AS the identity the mail reached');
  await tab.onAct('sendAs', {}, { dataset: { id: 'c-queen' } });
  ok(opened.at(-1)[1].fromContactId === 'c-queen', 'Send as passes the contact, never a bare actor id');
  await tab.onAct('whoToggle', {}, { dataset: { id: 'c-brick', actor: 'rache' } });
  ok(flags.get('rache').contacts.some((c) => c.email === 'brick@maelstrom.gang'), 'Who knows them: click shares (pushToPlayer)');
  confirmAnswer = false; confirms.length = 0;
  await tab.onAct('whoToggle', {}, { dataset: { id: 'c-brick', actor: 'rache' } });
  ok(confirms.length === 1 && /Take back/.test(confirms[0].title) && flags.get('rache').contacts.some((c) => c.email === 'brick@maelstrom.gang'), 'taking back asks first; No keeps the contact');
  confirmAnswer = true;
  await tab.onAct('whoToggle', {}, { dataset: { id: 'c-brick', actor: 'rache' } });
  ok(!flags.get('rache').contacts.some((c) => c.email === 'brick@maelstrom.gang'), 'click again takes it back (removed from their list)');
  await tab.onAct('trustPlayer', {}, { dataset: { id: 'c-rogue', actor: 'rache', v: '2' } });
  ok(mcs.getContact('c-rogue').relationships.rache.trust === 2 && mcs.getContact('c-rogue').relationships.v.trust === 5, 'per-player trust click writes only that player');
  await tab.onAct('trustDefault', {}, { dataset: { id: 'c-rogue', v: '3' } });
  ok(mcs.getContact('c-rogue').trust === 3, 'default trust click');
}

// ═══ 5. Edit in place: draft, guard, save through updateContact ═══
{
  tab._selId = 'c-brick';
  await tab.onAct('edit', {}, { dataset: { id: 'c-brick' } });
  let e = ctx().ct2.dir.edit;
  ok(e && !ctx().ct2.dir.sel && e.f.name === 'Brick' && e.encOn, 'Edit turns the detail into the form, prefilled');
  ok(e.secs.map((s) => s.key).join() === 'identity,addr,security,trust,notes', 'five sections');
  // Change things the way the widgets do (draft writes).
  tab._edSetValue('name', 'Brick Jones');
  tab._edSetValue('encryptionSkill', 'Cryptography');
  tab._edSetValue('maxBreachAttempts', '5');
  tab._edSeg({ closest: () => null }, 'ice', 'custom');
  tab._edSetValue('iceCustomName', 'Killer'); tab._edSetValue('iceCustomDamage', '5d6'); tab._edSetValue('iceCustomPortrait', 'k.png');
  tab._edSetValue('rel:v:trust', '1'); tab._draft['rel:v:type'] = 'hostile';
  tab._edSetValue('tags', 'gang, muscle');
  ok(tab._dirty.has('identity') && tab._dirty.has('security') && tab._dirty.has('trust'), 'dirty sections tracked per field');
  e = ctx().ct2.dir.edit;
  ok(e.iceIsCustom && e.f.name === 'Brick Jones', 'a re-render keeps the draft (other events cannot wipe edits)');
  // Guard: clicking another contact with unsaved edits asks first.
  const before = tab._selId;
  await tab.onAct('sel', {}, { dataset: { id: 'c-net' } });
  ok(tab._selId === before && tab._guardTo === 'c-net' && ctx().ct2.dir.guard, 'guard: the row click is held');
  await tab.onAct('guard', {}, { dataset: { choice: 'stay' } });
  ok(tab._editing && tab._guardTo === null, 'Keep editing');
  // Save.
  let upd = null;
  const realUpd = mcs.updateContact.bind(mcs);
  mcs.updateContact = async (id, data) => { upd = { id, data }; return realUpd(id, data); };
  const saved = await tab._save();
  mcs.updateContact = realUpd;
  const b = mcs.getContact('c-brick');
  ok(saved && upd.id === 'c-brick' && b.name === 'Brick Jones', 'Save goes through MasterContactService.updateContact');
  ok(b.encryptionSkill === 'Cryptography' && b.maxBreachAttempts === 5 && b.blackIce && b.iceSource === 'custom' && b.iceCustomName === 'Killer' && b.blackIceDamage === '5d6' && b.iceCustomPortrait === 'k.png', 'the ICE fields the old window dropped now save');
  ok(b.relationships.v?.trust === 1 && b.relationships.v.type === 'hostile', 'per-player relationship saved');
  ok(b.tags.join() === 'GANG,MUSCLE' && b.reviewed === true, 'tags upper-cased; a save marks it reviewed');
  ok(!tab._editing && !tab._draft && !tab._dirty.size, 'edit mode closes after save');
  // Guard → discard moves on.
  await tab.onAct('edit', {}, { dataset: { id: 'c-brick' } });
  ctx(); tab._edSetValue('name', 'X');
  await tab.onAct('sel', {}, { dataset: { id: 'c-net' } });
  await tab.onAct('guard', {}, { dataset: { choice: 'discard' } });
  ok(tab._selId === 'c-net' && !tab._editing && mcs.getContact('c-brick').name === 'Brick Jones', 'Discard drops the edits and opens the other contact');
  // Cancel.
  await tab.onAct('edit', {}, { dataset: { id: 'c-net' } }); ctx();
  await tab.onAct('edCancel', {}, { dataset: {} });
  ok(!tab._editing, 'Cancel');
  // Name required.
  await tab.onAct('edit', {}, { dataset: { id: 'c-net' } }); ctx();
  tab._edSetValue('name', '');
  ok(!(await tab._save()) && tab._editing, 'a nameless save is refused and the form stays');
  tab._cancelEdit();
}

// ═══ 6. New contact from an actor (ActorImportPickerApp → openTo) ═══
{
  tab.openTo({ create: 'actor', actorId: 'rogue' });
  const e = ctx().ct2.dir.edit;
  ok(e?.isNew && e.f.name === 'Rogue' && e.f.actorId === 'rogue' && e.f.email === 'rogue@afterlife.nc', 'openTo({create:"actor"}) pre-fills from the actor');
  const n0 = mcs.getAll().length;
  await tab._save();
  const made = mcs.getAll().at(-1);
  ok(mcs.getAll().length === n0 + 1 && made.actorId === 'rogue' && tab._selId === made.id, 'Create goes through addContact and selects the new contact');
  await mcs.removeContact(made.id);
  tab.openTo('c-judy');
  ok(tab._view === 'directory' && tab._selId === 'c-judy' && !tab._editing, 'openTo(contactId) opens the directory on it');
}

// ═══ 7. Players + Groups views ═══
{
  tab._view = 'players'; tab._pSel = 'rache';
  const p = ctx().ct2.players;
  ok(p.rows.length === 2 && p.rows.find((r) => r.actorId === 'rache').noEmail, 'Players: every PC, the missing address flagged');
  ok(p.sel.noEmail && p.sel.knownN === 0, 'Players detail');
  tab._pSel = 'v';
  const pv = ctx().ct2.players.sel;
  const knRows = (x) => x.kn.groups.flatMap((g) => g.rows);
  ok(knRows(pv).some((k) => k.id === 'c-rogue') && pv.hasIds && pv.ids[0].id === 'c-vself', 'who they know + their identities');
  const g = await groupSvc.saveMasterGroup({ name: 'The crew', members: [{ email: 'rogue@afterlife.nc', name: 'Rogue', hint: { contactId: 'c-rogue' } }, { email: 'brick@maelstrom.gang', name: 'Brick', hint: { contactId: 'c-brick' } }] });
  const gid = g.group?.id || groupSvc.getMasterGroups()[0].id;
  tab._view = 'groups';
  const gc = ctx().ct2.groups;
  ok(gc.rows.length === 1 && gc.sel.members.length === 2 && gc.sel.to.every((t) => !t.on), 'Groups: members + nobody pushed yet');
  await tab.onAct('gToggle', {}, { dataset: { groupId: gid, actor: 'rache' } });
  ok(groupSvc.getActorGroups('rache').some((x) => x.sharedFrom?.groupId === gid) && ctx().ct2.groups.sel.to.find((t) => t.actorId === 'rache').on, 'Pushed to: click pushes');
  await tab.onAct('gToggle', {}, { dataset: { groupId: gid, actor: 'rache' } });
  ok(!groupSvc.getActorGroups('rache').some((x) => x.sharedFrom?.groupId === gid), 'click again takes the group back');
  await tab.onAct('gMessage', {}, { dataset: { groupId: gid } });
  ok(opened.at(-1)[1].groupId === gid, 'Message the group');
}

// ═══ 7b. Players + Groups toolbars (2026-10-28) — the Directory's row on both sub-tabs ═══
{
  // ── pure rules ──
  const pr = (o) => ({ name: 'X', player: '', email: 'x@y', online: false, groupsN: 0, unread: 0, lastTs: '', sceneName: '', ...o });
  ok(M.passesPlayerFilter(pr({ unread: 2 }), 'unread') && !M.passesPlayerFilter(pr(), 'unread'), 'players: Has unread');
  ok(M.passesPlayerFilter(pr({ email: '' }), 'noaddr') && !M.passesPlayerFilter(pr(), 'noaddr'), 'players: No address');
  ok(M.passesPlayerFilter(pr({ online: true }), 'online') && M.passesPlayerFilter(pr(), 'offline') && !M.passesPlayerFilter(pr(), 'online'), 'players: Online / Offline');
  ok(M.passesPlayerFilter(pr({ groupsN: 1 }), 'group') && !M.passesPlayerFilter(pr(), 'group') && M.passesPlayerFilter(pr(), 'all') && M.passesPlayerFilter(pr(), 'bogus'), 'players: Holds a group; All and an unknown key pass');
  const prs = [pr({ name: 'Zed', player: 'Ann', unread: 1, lastTs: '2077-01-01' }), pr({ name: 'Amy', player: 'Bob', unread: 3 }), pr({ name: 'Kay', player: '', unread: 3, lastTs: '2077-03-01' })];
  ok(M.sortPlayers(prs, 'name').map((r) => r.name).join() === 'Amy,Kay,Zed', 'sort players: A–Z');
  ok(M.sortPlayers(prs, 'unread').map((r) => r.name).join() === 'Amy,Kay,Zed', 'sort players: unread desc, ties A–Z');
  ok(M.sortPlayers(prs, 'last').map((r) => r.name).join() === 'Kay,Zed,Amy', 'sort players: last mail newest first, never-mailed last');
  ok(M.sortPlayers(prs, 'player').map((r) => r.name).join() === 'Zed,Amy,Kay', 'sort players: by player name, no player last');
  ok(M.sortPlayers(prs, 'name') !== prs && prs[0].name === 'Zed', 'sort players never mutates the input');
  const gp = M.groupPlayers([pr({ name: 'A', player: 'Ann' }), pr({ name: 'B', player: '' }), pr({ name: 'C', player: 'Ann' })], 'player');
  ok(gp.map((g) => `${g.label}:${g.rows.length}`).join() === 'Ann:2,No player:1' && gp[0].key === 'player:Ann' && gp[1].last, 'group players by player, "No player" last');
  const gs = M.groupPlayers([pr({ name: 'A', online: true, sceneName: 'Afterlife' }), pr({ name: 'B', online: false, sceneName: 'Afterlife' }), pr({ name: 'C', online: true, sceneName: '' })], 'scene');
  ok(gs.map((g) => g.label).join() === 'Afterlife,No scene,Offline' && gs[0].hue === 'Afterlife', 'group players by scene: only an ONLINE user is on a scene; No scene / Offline last');
  const go = M.groupPlayers([pr({ online: false }), pr({ online: true })], 'online');
  ok(go.map((g) => g.label).join() === 'Online,Offline' && M.groupPlayers(prs, 'none').length === 1 && M.groupPlayers(prs, 'none')[0].rows.length === 3, 'group players by online; none = one group');
  ok(M.playerHaystack(pr({ name: 'V', player: 'Marta', email: 'v@nc', sceneName: 'Lizzie’s' })).includes('marta') && M.playerHaystack(pr({ sceneName: 'Lizzie’s' })).includes('lizzie'), 'player search text: character, player, address, scene');
  const gr = (o) => ({ name: 'G', pushed: 0, stale: false, lastUsedAt: '', n: 1, memberNames: [], memberEmails: [], ...o });
  ok(M.passesGroupFilter(gr({ pushed: 2 }), 'pushed') && M.passesGroupFilter(gr(), 'unpushed') && !M.passesGroupFilter(gr({ pushed: 1 }), 'unpushed'), 'groups: Pushed / Not pushed');
  ok(M.passesGroupFilter(gr({ stale: true }), 'stale') && !M.passesGroupFilter(gr(), 'stale') && M.passesGroupFilter(gr(), 'unused') && !M.passesGroupFilter(gr({ lastUsedAt: '2077' }), 'unused') && M.passesGroupFilter(gr(), 'all'), 'groups: Out of date / Never used / All');
  const grs = [gr({ name: 'Crew', n: 2, pushed: 1, lastUsedAt: '2077-02-01' }), gr({ name: 'Afterlife', n: 5, pushed: 0 }), gr({ name: 'Mox', n: 3, pushed: 3, lastUsedAt: '2077-05-01' })];
  ok(M.sortGroups(grs, 'name').map((g) => g.name).join() === 'Afterlife,Crew,Mox', 'sort groups: A–Z');
  ok(M.sortGroups(grs, 'recent').map((g) => g.name).join() === 'Mox,Crew,Afterlife', 'sort groups: recently used first, never-used last');
  ok(M.sortGroups(grs, 'size').map((g) => g.name).join() === 'Afterlife,Mox,Crew', 'sort groups: size');
  ok(M.sortGroups(grs, 'pushed').map((g) => g.name).join() === 'Mox,Crew,Afterlife', 'sort groups: pushed to most');
  ok(M.groupHaystack(gr({ name: 'Crew', memberNames: ['Rogue'], memberEmails: ['brick@maelstrom.gang'] })).includes('rogue') && M.groupHaystack(gr({ memberEmails: ['brick@maelstrom.gang'] })).includes('maelstrom'), 'group search text: name, member names, member addresses');
  ok(M.groupSig({ name: 'a', color: 'x', members: [{ email: 'B@c' }, { name: 'n' }] }) === M.groupSig({ name: 'a', color: 'x', members: [{ name: 'N' }, { email: 'b@c' }] }) && M.groupSig({ name: 'a' }) !== M.groupSig({ name: 'b' }), 'groupSig: order/case-insensitive members; name/colour count');
  const many = Array.from({ length: 15 }, (_, i) => ({ id: `g${i}` }));
  const ft = M.foldTail(many, { limit: 12 });
  ok(ft.list.length === 12 && ft.hidden === 3, 'foldTail: past the limit the rest hide behind a count');
  ok(M.foldTail(many, { limit: 12, keepId: 'g14' }).list.at(-1).id === 'g14' && M.foldTail(many, { limit: 12, keepId: 'g14' }).hidden === 2, 'foldTail: the selected group is always shown');
  ok(M.foldTail(many, { limit: 12, open: true }).hidden === 0 && M.foldTail(many, { limit: 12, forced: true }).hidden === 0 && M.foldTail(many.slice(0, 12), { limit: 12 }).hidden === 0, 'foldTail: "+N more" clicked, a search / filter, or a short list → everything');
  ok(M.GROUPS_RAIL_LIMIT === 12, 'the rail folds past 12');

  // ── the real tab: PLAYERS ──
  users[1].active = true; users[1].viewedScene = 'sc1';   // Marta (V) online at the Afterlife; Sam (Rache) offline
  game.scenes = { get: (id) => (id === 'sc1' ? { id: 'sc1', name: 'Afterlife' } : null) };
  journals.push(mkJournal('j-v', 'v', false, [mkPage('pv1', { messageId: 'mv1', subject: 'Hey', fromActorId: 'rogue', toActorId: 'v', timestamp: '2077-10-21T10:00:00Z', status: { read: false } })]));
  tab._mailCache = null;
  tab._view = 'players'; tab._pSel = 'v'; tab._pSearch = ''; tab._pShow = 'all'; tab._pGroup = 'none'; tab._pSort = 'name'; tab._pFold = new Map(); tab._pSelSeen = undefined; tab._pSelKey = null;
  let P = ctx().ct2.players;
  ok(P.rows.length === 2 && P.groups.length === 0 && !P.narrowed && P.shown === 2 && P.total === 2, 'Players: flat list by default, nothing narrowed');
  const rv = P.rows.find((r) => r.actorId === 'v');
  ok(rv.unread === 1 && rv.online && rv.sceneName === 'Afterlife' && rv.lastTs === '2077-10-21T10:00:00Z' && !P.rows.find((r) => r.actorId === 'rache').online, 'Players rows carry unread, online, scene and last mail');
  const chip = (k) => P.chips.find((c) => c.key === k).n;
  ok(chip('all') === 2 && chip('unread') === 1 && chip('noaddr') === 1 && chip('online') === 1 && chip('offline') === 1 && chip('group') === 0, `Players Show counts: ${P.chips.map((c) => `${c.key}=${c.n}`).join(' ')}`);
  ok(P.alerts.map((a) => `${a.key}:${a.n}:${a.tone}`).join() === 'unread:1:attn,noaddr:1:bad', 'Players alerts: an amber unread sum and a red no-address count');
  ok(P.groupOpts.length === 4 && P.sortOpts.length === 4 && P.groupOpts.find((o) => o.on).v === 'none' && P.sortOpts.find((o) => o.on).v === 'name' && !P.canFold, 'Players toolbar: Group + Sort options; no fold button on a flat list');
  await tab.onAct('pFilter', {}, { dataset: { filter: 'noaddr' } });
  P = ctx().ct2.players;
  ok(tab._pShow === 'noaddr' && P.rows.length === 1 && P.rows[0].actorId === 'rache' && P.narrowed && P.shown === 1 && P.showOn && P.alerts.find((a) => a.key === 'noaddr').on, 'the red count button solos "No address"; Showing 1 of 2');
  await tab.onAct('pFilter', {}, { dataset: { filter: 'noaddr' } });
  ok(tab._pShow === 'all', 'clicking it again shows all');
  tab._onSelect('pShow', 'online');
  ok(ctx().ct2.players.rows.map((r) => r.actorId).join() === 'v', 'Show select → Online');
  tab._onSelect('pShow', 'all'); tab._pSearch = 'afterlife';
  ok(ctx().ct2.players.rows.map((r) => r.actorId).join() === 'v', 'search matches the scene the player is looking at');
  tab._pSearch = 'sam';
  ok(ctx().ct2.players.rows.map((r) => r.actorId).join() === 'rache', 'search matches the player name');
  tab._pSearch = '';
  tab._onSelect('pSort', 'unread');
  ok(ctx().ct2.players.rows.map((r) => r.actorId).join() === 'v,rache', 'Sort → Unread puts V first');
  tab._onSelect('pSort', 'name');
  ok(ctx().ct2.players.rows.map((r) => r.actorId).join() === 'rache,v', 'Sort → A–Z');
  // grouped: folds follow the Directory rule
  tab._pSel = 'v'; tab._onSelect('pGroup', 'online');
  P = ctx().ct2.players;
  ok(P.grouped && P.rows.length === 0 && P.groups.map((g) => g.label).join() === 'Online,Offline' && P.canFold, 'Group → Online: two groups, fold button on');
  ok(P.groups[0].shut === false && P.groups[1].shut === true && P.groups[1].noaddr === 1 && P.groups[0].unread === 1, 'default folds: first open (holds V), the rest shut; a shut head carries its no-address count');
  tab._pSel = 'rache';
  P = ctx().ct2.players;
  ok(P.groups[1].shut === false, 'selecting a character in a shut group opens it');
  await tab.onAct('pFold', {}, { dataset: { key: P.groups[1].key, shut: '' } });
  ok(ctx().ct2.players.groups[1].shut === true && tab._pFold.get(P.groups[1].key) === true, 'clicking an open head folds it and records the choice');
  tab._pSearch = 'r';
  ok(ctx().ct2.players.groups.every((g) => !g.shut) && !ctx().ct2.players.canFold, 'a search opens every group');
  tab._pSearch = '';
  await tab.onAct('pFoldAll', {}, { dataset: { fold: 'close' } });
  ok(ctx().ct2.players.allShut && ctx().ct2.players.groups.every((g) => g.shut), 'Collapse all');
  await tab.onAct('pFoldAll', {}, { dataset: { fold: 'open' } });
  ok(!ctx().ct2.players.allShut && ctx().ct2.players.groups.every((g) => !g.shut), 'Expand all');
  tab._onSelect('pGroup', 'scene');
  ok(ctx().ct2.players.groups.map((g) => g.label).join() === 'Afterlife,Offline', 'Group → Scene: the viewed scene, offline last');
  tab._onSelect('pGroup', 'player');
  ok(ctx().ct2.players.groups.map((g) => g.label).join() === 'Marta,Sam', 'Group → Player');
  tab._onSelect('pGroup', 'none'); tab._pFold = new Map(); tab._pSel = 'v';
  tab._mailCache = null; journals.pop(); tab._mailCache = null;

  // ── the real tab: GROUPS ──
  tab._view = 'groups'; tab._gSearch = ''; tab._gShow = 'all'; tab._gSort = 'name'; tab._gMore = false;
  const crew = groupSvc.getMasterGroups()[0];
  await groupSvc.pushGroupToPlayer(crew.id, 'rache');
  const extra = [];
  for (let i = 0; i < 14; i++) { const r = await groupSvc.saveMasterGroup({ name: `Group ${String(i).padStart(2, '0')}`, members: [{ email: `m${i}@x.nc`, name: `Member ${i}` }] }); extra.push(r.group?.id || groupSvc.getMasterGroups().at(-1).id); }
  await groupSvc.saveMasterGroup({ ...groupSvc.getMasterGroup(extra[0]), lastUsedAt: '2077-09-01T00:00:00Z' });
  tab._gSel = extra[0];   // 'Group 00' sits inside the fold; 'The crew' sorts last
  let G = ctx().ct2.groups;
  ok(G.total === 15 && G.shown === 15 && G.rows.length === 12 && G.hidden === 3 && !G.more && !G.rows.some((r) => r.id === crew.id), 'Groups: past 12 the rest fold behind "+3 more"');
  const gc = (k) => G.chips.find((c) => c.key === k).n;
  ok(gc('all') === 15 && gc('pushed') === 1 && gc('unpushed') === 14 && gc('stale') === 0 && gc('unused') === 14, `Groups Show counts: ${G.chips.map((c) => `${c.key}=${c.n}`).join(' ')}`);
  ok(G.alerts.length === 0 && G.sortOpts.length === 4 && !G.narrowed, 'no out-of-date button while nothing is stale; nothing narrowed');
  await tab.onAct('gMore', {}, { dataset: {} });
  G = ctx().ct2.groups;
  ok(G.rows.length === 15 && G.hidden === 0 && G.more, '"+N more" opens the whole rail and offers "Show fewer"');
  await tab.onAct('gMore', {}, { dataset: {} });
  tab._gSel = extra[13];   // the last one by name sits past the fold
  G = ctx().ct2.groups;
  ok(G.rows.length === 13 && G.rows.at(-1).id === extra[13] && G.hidden === 2, 'the selected group is always shown, even past the fold');
  tab._gSel = crew.id;
  // out of date: change the master after the push
  await groupSvc.saveMasterGroup({ ...groupSvc.getMasterGroup(crew.id), members: [...groupSvc.getMasterGroup(crew.id).members, { email: 'judy@mox.nc', name: 'Judy' }] });
  G = ctx().ct2.groups;
  ok(G.rows.find((r) => r.id === crew.id).stale && G.alerts.length === 1 && G.alerts[0].key === 'stale' && G.alerts[0].n === 1, 'a pushed copy that differs reads out of date; the amber count appears');
  await tab.onAct('gFilter', {}, { dataset: { filter: 'stale' } });
  G = ctx().ct2.groups;
  ok(G.rows.length === 1 && G.rows[0].id === crew.id && G.narrowed && G.shown === 1 && G.total === 15 && G.hidden === 0 && G.alerts[0].on, 'the out-of-date button solos them; Showing 1 of 15; a filter opens the rail');
  await tab.onAct('gFilter', {}, { dataset: { filter: 'stale' } });
  tab._onSelect('gShow', 'pushed');
  ok(ctx().ct2.groups.rows.map((r) => r.id).join() === crew.id, 'Show → Pushed to players');
  tab._onSelect('gShow', 'unused');
  ok(ctx().ct2.groups.rows.length === 14 && !ctx().ct2.groups.rows.some((r) => r.id === extra[0]), 'Show → Never used leaves out the one with lastUsedAt');
  tab._onSelect('gShow', 'all'); tab._gSearch = 'brick';
  ok(ctx().ct2.groups.rows.map((r) => r.id).join() === crew.id && ctx().ct2.groups.hidden === 0, 'search finds a group by a MEMBER name and opens the rail');
  tab._gSearch = 'm3@x';
  ok(ctx().ct2.groups.rows.map((r) => r.id).join() === extra[3], 'search finds a group by a member address');
  tab._gSearch = 'zzz';
  ok(ctx().ct2.groups.nothing && ctx().ct2.groups.rows.length === 0 && ctx().ct2.groups.narrowed, 'nothing matches → the empty line + Showing 0 of 15');
  tab._gSearch = '';
  tab._onSelect('gSort', 'recent');
  ok(ctx().ct2.groups.rows[0].id === extra[0], 'Sort → Recently used puts the messaged group first');
  tab._onSelect('gSort', 'size');
  ok(ctx().ct2.groups.rows[0].id === crew.id, 'Sort → Size puts the 3-member crew first');
  tab._onSelect('gSort', 'pushed');
  ok(ctx().ct2.groups.rows[0].id === crew.id, 'Sort → Pushed to most');
  tab._onSelect('gSort', 'name');
  // wiring
  const src = read('scripts/ui/AdminPanel/tabs/ContactsTab.js');
  ok(/which === 'players'\) this\._pSearch = inp\.value/.test(src) && /which === 'groups'\) this\._gSearch = inp\.value/.test(src), 'the search boxes ride the Directory’s debounced [data-ct2-q] listener (caret kept)');
  ok(/which === 'pShow'/.test(src) && /which === 'pGroup'/.test(src) && /which === 'pSort'/.test(src) && /which === 'gShow'/.test(src) && /which === 'gSort'/.test(src), 'every new select is a change-listener branch of _onSelect');
  ok(/'ncm\.ct2\.playerFolds'/.test(src), 'player folds persist per viewer');
  // restore the world so later sections see the one crew group (2 members), pushed to nobody
  for (const id of extra) await groupSvc.deleteMasterGroup(id);
  await groupSvc.saveMasterGroup({ ...groupSvc.getMasterGroup(crew.id), members: crew.members });
  for (const c of groupSvc.getActorGroups('rache').filter((x) => x.sharedFrom?.groupId === crew.id)) await groupSvc.deleteActorGroup('rache', c.id);
  users[1].active = false; users[1].viewedScene = '';
}

// ═══ 8. Who knows whom ═══
{
  tab._view = 'matrix';
  let mx = ctx().ct2.mx;
  ok(mx.cols.length === 2 && mx.groups.length > 0 && mx.groups.every((g) => !g.open || g.rows.length), 'grid: columns = characters, groups fold');
  const fix = mx.groups.find((g) => g.label === 'Fixers');
  ok(fix && fix.tallies.find((t) => t.actorId === 'v').k === 1 && fix.tallies.find((t) => t.actorId === 'v').n === 3, 'per-group n/m tally per character');
  await tab.onAct('mxTally', {}, { dataset: { grp: 'Fixers', actor: 'v' } });
  ok(['c-rogue', 'c-queen', 'c-dex'].every((id) => tab._knowsNow(id, 'v')), 'tally click shares the whole group');
  ok(tab._mxChanges.length === 2, 'changes recorded (only the ones that moved)');
  await tab.onAct('mxTally', {}, { dataset: { grp: 'Fixers', actor: 'v' } });
  ok(!tab._knowsNow('c-dex', 'v'), 'tally again takes the whole group back');
  const nBefore = tab._mxChanges.length;
  await tab.onAct('mxUndo', {}, { dataset: {} });
  ok(tab._mxChanges.length === nBefore - 1 && tab._knowsNow(tab._mxChanges.length ? 'c-dex' : 'c-dex', 'v') === true, 'Undo last walks one change back');
  tab._mxFilter = 'chg';
  ok(ctx().ct2.mx.groups.flatMap((g) => g.rows).every((r) => tab._mxChanges.some((c) => c.cid === r.id)), '"Changed this session" filter');
  tab._mxFilter = 'none';
  mx = ctx().ct2.mx;
  ok(mx.groups.flatMap((g) => g.rows).every((r) => r.cells.every((c) => !c.on)), '"Nobody knows" filter (and opens every group with a hit)');
  tab._mxFilter = 'all';
  ok(JSON.stringify(M.rangeIds(['a', 'b', 'c', 'd'], 'd', 'b')) === '["b","c","d"]', 'shift-click range helper');
}

// ═══ 8b. Pop out mid-edit carries the draft; a shared copy is not "added themselves" ═══
{
  tab._view = 'directory';
  await tab.onAct('edit', {}, { dataset: { id: 'c-net' } }); ctx();
  tab._edSetValue('name', 'NetWatch Notice (edited)');
  let handed = null;
  app.constructor = { openTabWindow: async (t, o) => { handed = { t, o }; return {}; } };
  await tab.onAct('edPop', {}, { dataset: {} });
  ok(handed?.t === 'contacts' && handed.o.select.edit.draft.name === 'NetWatch Notice (edited)' && !tab._editing, 'Pop out hands the unsaved draft to the bigger window and stops editing here');
  const pop = new ContactsTab({ ...app, isPopout: true });
  pop.openTo(handed.o.select);
  const pe = pop.prepareContext().ct2.dir.edit;
  ok(pe && pe.f.name === 'NetWatch Notice (edited)' && pe.dirtyN === 1 && pop.prepareContext().ct2.isPopout, 'the pop-out opens in edit mode on the same draft, dirty dots intact');
  tab._view = 'players'; tab._pSel = 'v';
  ok(!ctx().ct2.players.sel.own.some((o) => o.name === 'Rogue'), 'a shared directory contact is not listed as one they added themselves');
}

// ═══ 9. Pure rules ═══
{
  ok(M.sectionOfField('rel:v:trust') === 'trust' && M.sectionOfField('iceCustomName') === 'security' && M.sectionOfField('email') === 'addr' && M.sectionOfField('folder') === 'identity', 'sectionOfField');
  ok(M.playerEntryMatches({ email: 'A@B' }, { id: 'x', email: 'a@b' }) && !M.playerEntryMatches({ email: 'c@d' }, { id: 'x', email: 'a@b' }), 'playerEntryMatches by address, case-insensitive');
  ok(M.pluralRole('Lawman') === 'Lawmen' && M.pluralRole('Fixer') === 'Fixers' && M.pluralRole('Media') === 'Media', 'pluralRole');
  ok(vocab.TRUST_LABELS[5] === 'IMPLICITLY TRUSTED' && vocab.RELATIONSHIP_TYPES.ally.label === 'ALLY', 'contactVocab keeps the API shape');
}

// ═══ 10. The REAL template through Handlebars, every view ═══
const HB_CANDIDATES = ['C:/Program Files/Foundry Virtual Tabletop/resources/app/package.json', 'C:/Program Files (x86)/Foundry Virtual Tabletop/resources/app/package.json'];
let Handlebars = null;
for (const p of HB_CANDIDATES) { if (!existsSync(p)) continue; try { Handlebars = createRequire(p)('handlebars'); break; } catch { /* next */ } }
const tpl = read('templates/admin-panel/tab-contacts.hbs');
const js = read('scripts/ui/AdminPanel/tabs/ContactsTab.js');
const css = read('styles/components/admin-panel/tab-contacts.css') + read('styles/components/admin-panel/contacts-map.css');   // + the Who-knows-whom map
if (!Handlebars) { fail++; console.error('FAIL: Handlebars not found (Foundry install) — template not rendered'); }
else {
  const H = Handlebars.create();
  H.registerPartial('modules/night-city-messenger/templates/admin-panel/partials/contacts-map.hbs', readFileSync(`${ROOT}/templates/admin-panel/partials/contacts-map.hbs`, 'utf8'));   // Who knows whom → Map
  { const { registerTagHueHelper } = await import(new URL('../../../scripts/utils/tagHue.js', import.meta.url)); registerTagHueHelper(H); }
  H.registerHelper('eq', (a, b) => a === b);
  const render = H.compile(tpl);
  const html = [];
  const views = [['directory', () => { tab._selId = 'c-rogue'; }], ['directory', () => { tab._startEdit('c-brick'); }], ['directory', () => { tab._cancelEdit(); tab._selId = 'c-queen'; tab._moreOpen = true; tab._newOpen = true; }], ['players', () => { tab._pSel = 'v'; }], ['players', () => { tab._pSel = 'v'; tab._pTabFor = 'v'; tab._pTab = 'glance'; }], ['directory', () => { tab._selId = 'c-rogue'; tab._dTabFor = 'c-rogue'; tab._dTab = 'corr'; }], ['groups', () => {}], ['matrix', () => { tab._mxOpen.add('Fixers'); }], ['matrix', () => { tab._mxMode = 'table'; }]];
  for (const [view, setup] of views) {
    tab._view = view; setup();
    const out = render({ activeTab: 'contacts', ...tab.prepareContext() });
    html.push(out);
    if (process.env.NCM_DUMP) writeFileSync(`${process.env.NCM_DUMP}/ct-${html.length}-${view}.html`, out);   // for a headless look
    ok(!/undefined|\[object Object\]|NaN/.test(out.replace(/data-tooltip="[^"]*"/g, '')), `${view}: renders with no undefined/NaN`);
    tab._moreOpen = false; tab._newOpen = false;
  }
  { // Default folds, rendered (2026-10-28)
    tab._view = 'directory'; tab._dirFold = new Map(); tab._dirSelSeen = undefined; tab._dirSelKey = null; tab._selId = 'c-brick';
    tab._dirFold.set('role:Fixers', true);
    const d = render({ activeTab: 'contacts', ...tab.prepareContext() });
    if (process.env.NCM_DUMP) writeFileSync(`${process.env.NCM_DUMP}/ct-folds-dir.html`, d);
    const fixHead = (d.match(/<div class="ncm-ct2-grp is-shut"[^>]*data-key="role:Fixers"[\s\S]*?<\/div>/) || [''])[0];
    ok(/ncm-ct2-grp__w[^>]*>[\s\S]*?1 waiting/.test(fixHead) && tpl.includes('{{#if checks}}<span class="ncm-ct2-grp__p"') &&/<span class="n">2<\/span>/.test(fixHead), 'Directory render: a closed group head shows its count, "1 waiting" and the needs-a-look count');
    ok(!/data-op="sel" data-id="c-queen"/.test(d), 'Directory render: a closed group renders no rows');
    const openHeads = [...d.matchAll(/<div class="ncm-ct2-grp "[^>]*>/g)].length;
    ok(openHeads >= 1 && !/<div class="ncm-ct2-grp "[^>]*data-key="role:Fixers"/.test(d), 'Directory render: the selection group is open, the folded one is not');
    ok(!/ncm-ct2-grp__w/.test(d.replace(fixHead, '')), 'Directory render: an OPEN group head carries no badge (its rows say it)');
    // Players → Who they know: give V a second group (a Solo) and one waiting message from Brick.
    const vList = flags.get('v').contacts;
    vList.push({ id: 'pc-brick', name: 'Brick', email: 'brick@maelstrom.gang', masterContactId: 'c-brick' });
    tab._view = 'players'; tab._pSel = 'v'; tab._pTabFor = 'v'; tab._pTab = 'main'; tab._knFold = new Map();
    const pctx = tab.prepareContext();
    const kn = pctx.ct2.players.sel.kn;
    ok(kn.groups.length >= 2 && kn.groups[0].shut === false && kn.groups.slice(1).every((g) => g.shut && g.dshut), 'Who they know default: the first group open, the rest closed');
    const p = render({ activeTab: 'contacts', ...pctx });
    ok(/<div class="ncm-ct2-kn__gh" data-g="role:Fixers"/.test(p) && /<div class="ncm-ct2-kn__gh is-shut" data-g="role:Solos" data-dshut="1"/.test(p), 'Who they know render: head 1 open, head 2 closed with the default stamped for the DOM wiring');
    ok(/data-g="role:Solos" style="display:none"/.test(p) && !/data-g="role:Fixers" style="display:none"/.test(p), 'Who they know render: rows of a closed group start hidden');
    tab._knRoles = new Set(['solo']);
    const f = tab.prepareContext().ct2.players.sel.kn;
    ok(f.forced && f.groups.every((g) => !g.shut), 'Who they know: an active filter opens every group');
    tab._knRoles = new Set();
    kn.groups[1].waiting = 2;   // a waiting count on a closed head → the amber badge
    const p2 = render({ activeTab: 'contacts', ...pctx });
    ok(/data-g="role:Solos"[^>]*>[\s\S]{0,200}?<span class="wt"[^>]*><i class="fas fa-envelope"><\/i>2 waiting<\/span>/.test(p2), 'Who they know render: a closed head shows "N waiting"');
    const src = read('scripts/ui/AdminPanel/tabs/ContactsTab.js');
    ok(/this\._knSolo\.key = \(!k \|\| this\._knSolo\.key === k\) \? null : k/.test(src) && /const out = !!only && k !== only/.test(src) && /_knIsShut\(gh\)/.test(src) && /knForced === '1'/.test(src), 'Who they know wiring: a jump chip narrows to ONE group (the lit chip / All undoes it, other groups hidden not folded); folds read the GM choice, else the stamped default; a filter forces open');
    ok((() => { const t = read('templates/admin-panel/tab-contacts.hbs'); const b = t.indexOf('<div class="ncm-ct2-kn__bar">'); const j = t.indexOf('ncm-ct2-kn__jumps'); return b > 0 && j > b; })() && !read('scripts/ui/AdminPanel/tabs/ContactsTab.js').includes("icon = 'fas fa-font'"), 'Who they know: the search / Role · Org · A–Z row sits above the chips; A–Z groups carry no icon (fa-font drew an extra A)');
    ok(read('scripts/ui/AdminPanel/tabs/ContactsTab.js').includes('if (!list) return;') && read('scripts/ui/AdminPanel/AdminPanelApp.js').includes('try { activeTab.onRender(context, options); }'), 'At a glance (a .ncm-ct2-kn with no list) cannot break the panel: the wiring skips it, and a tab error never stops the shared after-render steps');
    ok(/data-kn-jump="" role="button"[^>]*>[\s\S]{0,80}All/.test(read('templates/admin-panel/tab-contacts.hbs')) && /this\._knSolo\.actor !== actor/.test(src), 'Who they know: an All chip; the narrowing resets for another character');
    vList.splice(vList.findIndex((c) => c.id === 'pc-brick'), 1);
    tab._selId = 'c-rogue';
  }
  const all = html.join('\n');
  // Inner tabs + page titles (2026-10-28)
  ok(['Directory', 'Players', 'Groups', 'Who knows whom'].every((t) => all.includes('<h2>' + t + '</h2>')) && html.every((h) => /<header class="ncm-tabhd">/.test(h)), 'every sub-tab render opens with its page title');
  ok(/data-op="pTab" data-tab="glance"/.test(html[3]) && /ncm-ct2-knnav/.test(html[3]) && !/ncm-ct2-km__orbit/.test(html[3]), 'player Profile: the list, not the orbit');
  ok(/ncm-ct2-itab on" data-action="tabAct" data-op="pTab" data-tab="glance"/.test(html[4]) && /ncm-ct2-km__orbit/.test(html[4]) && /ncm-ct2-km__eq/.test(html[4]) && !/ncm-ct2-knnav/.test(html[4]) && !/Groups they hold/.test(html[4]), 'player At a glance: orbit, roles, waiting, card — and nothing else');
  ok(/data-op="dTab" data-tab="corr"/.test(html[0]) && !/ncm-ct2-sb__dial/.test(html[0]) && /Who knows them/.test(html[0]), 'NPC Profile: everything but the switchboard');
  ok(/ncm-ct2-sb__dial/.test(html[5]) && !/Who knows them/.test(html[5]) && !/GM notes/.test(html[5]), 'NPC Correspondents: the switchboard + card only');
  { // Directory toolbar is ONE row: search · Show select · needs-you counts · Filter · Group · Sort · fold
    const tb = (html[0].match(/<div class="ncm-ct2-tb ncm-ct2-tb--one">[\s\S]*?\n    <\/div>/) || [''])[0];
    ok(/data-ct2-select="show"/.test(tb) && /data-ct2-select="groupBy"/.test(tb) && /data-ct2-select="sort"/.test(tb) && /data-op="dirFoldAll"/.test(tb) && /ncm-scope-btn/.test(tb), 'Directory: search, Show, Filter, Group, Sort and fold share one toolbar row');
    ok(!/class="ncm-ct2-chips"/.test(html[0].split('ncm-ct2-split')[0] || html[0]), 'Directory: the old quick-filter chip row is gone');
    ok(/Show: Mail waiting/.test(tb), 'Directory: the quick filters are options of the Show select');
    ok(/data-mapkey-toggle aria-expanded="false"/.test(html[7]) && /ncm-ct2-mapkey__pop/.test(html[7]) && /function wireMapKey/.test(readFileSync(`${ROOT}/scripts/ui/AdminPanel/tabs/contactsMap.js`, 'utf8')), 'Who knows whom: the ROLES key is one button that opens a list under it (closed by default)');
    ok(!/ncm-ct2-sendas/.test(html[0]) && /class="ncm-ct2-navsend"[\s\S]*?Send as/.test(html[0]), 'Directory: Send as is one picker in the sub-tab bar, the strip row is gone');
  }
  ok(!/Reply queue/.test(all), 'no reply queue anywhere');
  ok(/data-op="sel" data-id="c-queen"/.test(all) && /class="ncm-ct2-r alias/.test(all), 'rows render with their id and the alias class');
  ok(/data-op="whoToggle" data-id="c-rogue" data-actor="v"/.test(all), 'who-knows chips carry the contact id from the parent frame');
  ok(/data-op="trustPlayer" data-id="c-rogue" data-actor="v"/.test(all), 'trust segments carry contact + character (two frames up)');
  ok(/data-op="mxCell" data-cid="c-rogue" data-actor="v" data-mx-grp="Fixers"/.test(all), 'matrix cells carry contact, character and group');
  ok(/name="encryptionSkill"/.test(all) && /name="rel:v:trust"/.test(all) && /name="iceSource"/.test(all), 'the edit form renders its named fields');
  ok(/data-ct2-scroll="dirlist"/.test(all) && /data-ct2-q="dir"/.test(all) && /data-field="contactSearch"/.test(all), 'scroll memo, search box, "/" shortcut hook');
  // Every data-op the template uses is a case in onAct.
  const ops = new Set([...tpl.matchAll(/data-op="([a-zA-Z]+)"/g)].map((m) => m[1]));
  const cases = new Set([...js.matchAll(/case '([a-zA-Z]+)':/g)].map((m) => m[1]));
  const missing = [...ops].filter((o) => !cases.has(o));
  ok(missing.length === 0, `every data-op is handled by onAct (missing: ${missing.join(', ') || 'none'})`);
  // Every ncm-ct2 class used is styled.
  const used = new Set([...all.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)).filter((c) => c.startsWith('ncm-ct2')));
  const unstyled = [...used].filter((c) => !css.includes(`.${c}`));
  ok(unstyled.length === 0, `every ncm-ct2 class is styled (missing: ${unstyled.join(', ') || 'none'})`);
  // Every ct2.<key> the template reads is produced by some view.
  const keys = [...new Set([...tpl.matchAll(/ct2\.([a-zA-Z]+)/g)].map((m) => m[1]))];
  const produced = new Set();
  for (const v of ['directory', 'players', 'groups', 'matrix']) { tab._view = v; Object.keys(tab.prepareContext().ct2).forEach((k) => produced.add(k)); }
  const unread = keys.filter((k) => !produced.has(k));
  ok(unread.length === 0, `every ct2 key the template reads is produced (missing: ${unread.join(', ') || 'none'})`);
  ok(!/\{\{sub\}\}/.test(tpl), 'no {{sub}} (helper collision)');

  { // Players + Groups toolbars, rendered (2026-10-28): the Directory's row on both, one piece each
    const tbOf = (h) => (h.match(/<div class="ncm-ct2-tb ncm-ct2-tb--one">[\s\S]*?\n    <\/div>/) || [''])[0];
    users[1].active = true; users[1].viewedScene = 'sc1';
    journals.push(mkJournal('j-v2', 'v', false, [mkPage('pv2', { messageId: 'mv2', subject: 'Hey', fromActorId: 'rogue', toActorId: 'v', timestamp: '2077-10-21T10:00:00Z', status: { read: false } })]));
    tab._mailCache = null;
    tab._view = 'players'; tab._pSel = 'v'; tab._pTabFor = 'v'; tab._pTab = 'main'; tab._pGroup = 'online'; tab._pFold = new Map(); tab._pSelSeen = undefined; tab._pSelKey = null;
    const ph = render({ activeTab: 'contacts', ...tab.prepareContext() });
    if (process.env.NCM_DUMP) writeFileSync(`${process.env.NCM_DUMP}/ct-players-tb.html`, ph);
    const ptb = tbOf(ph);
    ok(/data-ct2-q="players"/.test(ptb) && /data-ct2-select="pShow"/.test(ptb) && /data-ct2-select="pGroup"/.test(ptb) && /data-ct2-select="pSort"/.test(ptb) && /data-op="pFoldAll"/.test(ptb), 'Players: search, Show, Group, Sort and fold share one toolbar row');
    ok(/Show: Has unread \(1\)/.test(ptb) && /Show: Holds a group \(0\)/.test(ptb) && /Group: Scene/.test(ptb) && /Sort: Last mail/.test(ptb), 'Players: the Show / Group / Sort options read as designed');
    ok(/class="ncm-ct2-tbalert is-attn [^"]*" data-action="tabAct" data-op="pFilter" data-filter="unread"/.test(ptb) && /class="ncm-ct2-tbalert is-bad [^"]*" data-action="tabAct" data-op="pFilter" data-filter="noaddr"/.test(ptb), 'Players: an amber unread button and a red no-address button');
    ok(/<div class="ncm-ct2-grp "[^>]*data-op="pFold" data-key="online:Online"/.test(ph) && /<div class="ncm-ct2-grp is-shut"[^>]*data-key="online:Offline"[\s\S]*?ncm-ct2-grp__p[^>]*><i class="fas fa-at"><\/i>1<\/span>/.test(ph), 'Players render: Online open (holds V), Offline shut with its no-address count');
    ok(/data-op="pSel" data-actor="v"/.test(ph) && !/data-op="pSel" data-actor="rache"/.test(ph) && /ncm-ct2-online/.test(ph), 'Players render: a shut group renders no rows; the online dot shows');
    tab._pGroup = 'none'; tab._pShow = 'noaddr';
    const ph2 = render({ activeTab: 'contacts', ...tab.prepareContext() });
    ok(/class="ncm-ct2-facets"><span class="lab">Showing<\/span><span class="n">1 of 2<\/span>/.test(ph2) && /ncm-ct2-show is-on/.test(ph2), 'Players render: "Showing 1 of 2" when narrowed, the Show select lit');
    tab._pShow = 'all'; users[1].active = false; users[1].viewedScene = ''; journals.pop(); tab._mailCache = null;
    // groups: 15 of them, one stale, so the dump shows the fold + the amber count
    const crew = groupSvc.getMasterGroups()[0];
    const ids = [];
    for (let i = 0; i < 14; i++) { const r = await groupSvc.saveMasterGroup({ name: `Group ${String(i).padStart(2, '0')}`, members: [{ email: `m${i}@x.nc`, name: `Member ${i}` }] }); ids.push(r.group?.id || groupSvc.getMasterGroups().at(-1).id); }
    await groupSvc.pushGroupToPlayer(crew.id, 'rache');
    await groupSvc.saveMasterGroup({ ...groupSvc.getMasterGroup(crew.id), color: '#ff8800' });
    tab._view = 'groups'; tab._gSel = ids[0]; tab._gSearch = ''; tab._gShow = 'all'; tab._gSort = 'name'; tab._gMore = false;
    const gh = render({ activeTab: 'contacts', ...tab.prepareContext() });
    if (process.env.NCM_DUMP) writeFileSync(`${process.env.NCM_DUMP}/ct-groups-tb.html`, gh);
    const gtb = tbOf(gh);
    ok(/data-ct2-q="groups"/.test(gtb) && /data-ct2-select="gShow"/.test(gtb) && /data-ct2-select="gSort"/.test(gtb) && !/data-ct2-select="gGroup"/.test(gtb), 'Groups: search, Show and Sort share one toolbar row (no Group select — one flat rail)');
    ok(/Show: Out of date \(1\)/.test(gtb) && /Sort: Recently used/.test(gtb) && /class="ncm-ct2-tbalert is-attn [^"]*" data-action="tabAct" data-op="gFilter" data-filter="stale"[^>]*><i class="fas fa-rotate"><\/i>1<\/button>/.test(gtb), 'Groups: the Show options + the amber out-of-date count');
    ok(/data-op="gMore"[^>]*><span><\/span><span><i class="fas fa-ellipsis"><\/i> \+3 more<\/span>/.test(gh) && (gh.match(/data-op="gSel"/g) || []).length === 12, 'Groups render: 12 rows then "+3 more"');
    tab._gSel = crew.id;
    const gh2 = render({ activeTab: 'contacts', ...tab.prepareContext() });
    ok(/class="ncm-ct2-r sel is-stale"/.test(gh2) && /\+2 more/.test(gh2) && /data-op="gNew"/.test(gh2), 'Groups render: the selected stale row is marked and shown past the fold (+2 more); New group stays at the end');
    ok(!/undefined|\[object Object\]|NaN/.test((ph + gh).replace(/data-tooltip="[^"]*"/g, '')), 'both toolbar renders: no undefined/NaN');
    for (const id of ids) await groupSvc.deleteMasterGroup(id);
    await groupSvc.saveMasterGroup({ ...groupSvc.getMasterGroup(crew.id), color: crew.color });
    for (const c of groupSvc.getActorGroups('rache').filter((x) => x.sharedFrom?.groupId === crew.id)) await groupSvc.deleteActorGroup('rache', c.id);
    tab._view = 'directory'; tab._selId = 'c-rogue';
  }
}

// ═══ 11. Wiring guards ═══
{
  ok(!existsSync(`${ROOT}/scripts/ui/GMContactManager/GMContactManagerApp.js`) && !existsSync(`${ROOT}/templates/gm-contact-manager/gm-contact-manager.hbs`), 'the GM Contact Manager window is retired');
  ok(!/GM_CONTACT_MANAGER/.test(read('scripts/utils/constants.js')), 'its TEMPLATES entry is gone');
  const walk = (d) => readdirSync(d).flatMap((f) => { const p = `${d}/${f}`; return statSync(p).isDirectory() ? walk(p) : [p]; });
  const refs = walk(`${ROOT}/scripts`).filter((f) => /\.js$/.test(f) && /GMContactManagerApp/.test(readFileSync(f, 'utf8')));
  ok(refs.length === 0, `nothing in scripts/ imports or names GMContactManagerApp (${refs.map((f) => f.replace(ROOT + '/', '')).join(', ') || 'none'})`);
  ok(/ns\.openGMContacts = async \(select = null\) => ns\.openAdminTab\('contacts'/.test(read('scripts/init/registerGMTools.js')), 'openGMContacts is an alias for openAdminTab("contacts")');
  ok(/openAdminTab\?\.\('contacts', \{ select: \{ create: 'actor', actorId \} \}\)/.test(read('scripts/ui/GMContactManager/ActorImportPickerApp.js')), 'Actor Import picks open the tab’s create form');
  ok(/openAdminTab\?\.\('contacts'\)/.test(read('scripts/ui/ContactManager/ContactManagerApp.js')), 'the player Contact Manager’s GM button opens the tab');
  ok(/contactVocab\.js/.test(read('scripts/integrations/IntegrationBridge.js')), 'IntegrationBridge reads the vocabulary from contactVocab.js');
  ok(/'reviewed'/.test(read('scripts/services/MasterContactService.js')), 'updateContact whitelists reviewed');
  ok(!/fromActorId: contact\.actorId/.test(js), 'no Send As by bare actor id');
  ok(!/class="ncm-ct-/.test(tpl), 'no old ncm-ct-* markup left in the tab');
  ok(/:has\(> \.ncm-ct2\)/.test(css) && /ncm-admin-panel--pop/.test(css), 'the tab fills the content area; pop-out widens it');
  ok(!/#[0-9a-f]{3,8}\b/i.test(css.replace(/#fff\b/g, '')), 'tab-contacts.css: tokens only (one #fff)');
}

// ═══ 12. Players → Who they know + Groups they hold ═══
{
  const gid = groupSvc.getMasterGroups()[0].id;
  await groupSvc.pushGroupToPlayer(gid, 'rache');
  await tab._setKnows('c-rogue', 'v', true);
  const knRows = (x) => x.kn.groups.flatMap((g) => g.rows);
  // Players → Who they know + Groups they hold
  const TPLK = readFileSync(new URL('../../../templates/admin-panel/tab-contacts.hbs', import.meta.url), 'utf8');
  tab._view = 'players'; tab._pSel = 'v';
  let kv = ctx().ct2.players.sel.kn;
  ok(kv.by === 'role' && kv.groups.every((g) => g.label && g.n === g.rows.length) && kv.byOpts.find((o) => o.on).key === 'role', 'Who they know: grouped by role by default, counts match');
  ok(kv.groups.flatMap((g) => g.rows).every((r) => typeof r.search === 'string' && r.search.includes(r.name.toLowerCase())), 'every row carries its search text');
  await tab.onAct('knBy', {}, { dataset: { by: 'org' } });
  kv = ctx().ct2.players.sel.kn;
  ok(kv.by === 'org' && kv.groups.flatMap((g) => g.rows).every((r) => !r.org), 'group by org: the org tag leaves the rows');
  await tab.onAct('knBy', {}, { dataset: { by: 'az' } });
  ok(ctx().ct2.players.sel.kn.groups.every((g) => g.label.length === 1), 'group A–Z: one heading per letter');
  tab._knBy = 'role';
  tab._pSel = 'rache';
  let ps = ctx().ct2.players.sel;
  ok(ps.groupsFromYou.length === 1 && ps.groupsFromYou[0].masterId === gid && !ps.groupsFromYou[0].stale && ps.groupsN === 1, 'Groups they hold: a pushed copy is "from you", up to date');
  const cur = groupSvc.getMasterGroup(gid);
  await groupSvc.saveMasterGroup({ ...cur, members: [...cur.members, { email: 'judy@mox.nc', name: 'Judy' }] });
  ps = ctx().ct2.players.sel;
  ok(ps.groupsFromYou[0].stale, 'Groups they hold: a member added to your group reads out of date');
  await tab.onAct('pGroupUpdate', {}, { dataset: { groupId: gid, actor: 'rache' } });
  ok(!ctx().ct2.players.sel.groupsFromYou[0].stale && ctx().ct2.players.sel.groupsFromYou[0].n === 3, 'Update re-pushes the group');
  ok(/data-op="knTake"/.test(TPLK) && /data-op="pGroupUpdate"/.test(TPLK) && /data-op="pGroupTake"/.test(TPLK) && /data-kn-q/.test(TPLK), 'template: take back, update, take group back, search box');
  tab._pSel = 'v';
  const before = knRows(ctx().ct2.players.sel).length;
  await tab.onAct('knTake', {}, { dataset: { id: 'c-rogue', actor: 'v' } });
  ok(!knRows(ctx().ct2.players.sel).some((k) => k.id === 'c-rogue') && knRows(ctx().ct2.players.sel).length < before, 'take back removes the contact from their list');
}


// ═══ 13. VOICE — a GM-only "how they talk" box beside GM notes (2026-10-28) ═══
{
  tab._cancelEdit(); tab._view = 'directory'; tab._dTab = 'main'; tab._dTabFor = null;
  // Storage: whitelisted, trimmed, defaults empty; never on a player's copy.
  ok(/'tags', 'notes', 'voice', 'actorId'/.test(read('scripts/services/MasterContactService.js')), 'updateContact whitelists voice');
  await mcs.updateContact('c-rogue', { voice: '  Runs the room. Short sentences, long pauses.  ' });
  ok(mcs.getContact('c-rogue').voice === 'Runs the room. Short sentences, long pauses.', 'voice saved, trimmed');
  ok(mcs.getContact('c-queen').voice === undefined || mcs.getContact('c-queen').voice === '', 'the alias has none of its own');
  await mcs.pushToPlayer('c-rogue', 'v');
  const vCopy = flags.get('v').contacts.find((c) => c.masterContactId === 'c-rogue' || c.email === 'rogue@afterlife.nc');
  ok(vCopy && !vCopy.voice && vCopy.notes === '', 'a pushed copy carries neither the voice text nor the notes (the service blanks both; the real ContactRepository normalizer has no voice field at all)');
  ok(!/voice/.test(read('scripts/data/ContactRepository.js')), 'ContactRepository has no voice field (a player copy can never hold one)');
  // Detail pane: own vs inherited.
  tab._selId = 'c-rogue';
  let d = ctx().ct2.dir.sel;
  ok(d.voice.own === 'Runs the room. Short sentences, long pauses.' && !d.voice.inherited && d.voice.placeholder === ContactsTab.VOICE_PLACEHOLDER, 'detail: the main shows its own voice, prompt placeholder');
  tab._selId = 'c-queen';
  d = ctx().ct2.dir.sel;
  ok(d.voice.own === '' && d.voice.inherited === 'Runs the room. Short sentences, long pauses.' && d.voice.from === 'Rogue' && d.voice.placeholder === d.voice.inherited, 'detail: the alias shows the main’s voice dimmed, "from Rogue"');
  tab._selId = 'c-brick';
  d = ctx().ct2.dir.sel;
  ok(d.voice.own === '' && !d.voice.inherited && !d.voice.from && d.voice.placeholder === ContactsTab.VOICE_PLACEHOLDER, 'detail: a lone contact with none → the prompt');
  // Autosave on blur: writes only the contact's OWN text; an unchanged value is a no-op; clearing an alias lets the main's through.
  let writes = 0; const realUpd = mcs.updateContact.bind(mcs);
  mcs.updateContact = async (id, data) => { writes++; return realUpd(id, data); };
  await tab._saveVoice('c-queen', '  ');
  ok(writes === 0 && !mcs.getContact('c-queen').voice, 'blur with nothing typed on an alias writes nothing (the inherited text is never copied down)');
  await tab._saveVoice('c-queen', ' Sweeter. Sells you the knife first. ');
  ok(writes === 1 && mcs.getContact('c-queen').voice === 'Sweeter. Sells you the knife first.', 'typing over the inherited voice overrides it');
  tab._selId = 'c-queen'; d = ctx().ct2.dir.sel;
  ok(d.voice.own === 'Sweeter. Sells you the knife first.' && !d.voice.inherited, 'detail: the override shows as its own');
  await tab._saveVoice('c-queen', '');
  ok(writes === 2 && mcs.getContact('c-queen').voice === '' && ctx().ct2.dir.sel.voice.inherited === 'Runs the room. Short sentences, long pauses.', 'clearing it brings the main’s back');
  await tab._saveVoice('c-rogue', 'Runs the room. Short sentences, long pauses.');
  ok(writes === 2, 'an unchanged value is a no-op');
  mcs.updateContact = realUpd;
  ok(/data-ct2-voice\]/.test(js) && /this\._saveVoice\(voice\.dataset\.ct2Voice, voice\.value\)/.test(js), 'onRender wires [data-ct2-voice] blur → _saveVoice (the notes pattern)');
  // The edit form: the field sits in the Notes section, the draft carries it, Save writes it.
  tab._startEdit('c-queen');
  let e = ctx().ct2.dir.edit;
  ok(e.f.voice === '' && e.voice.inherited === 'Runs the room. Short sentences, long pauses.' && e.voice.from === 'Rogue', 'edit form: an alias with none shows the main’s as the placeholder');
  tab._edSetValue('voice', 'Whispers. Never twice.');
  ok(tab._dirty.has('notes') && !tab._dirty.has('identity'), 'voice dirties the Notes section');
  e = ctx().ct2.dir.edit;
  ok(e.f.voice === 'Whispers. Never twice.' && !e.voice.inherited, 'the draft survives a re-render and the placeholder stops saying "from"');
  ok(await tab._save() && mcs.getContact('c-queen').voice === 'Whispers. Never twice.', '_collectForm saves voice through updateContact');
  await mcs.updateContact('c-queen', { voice: '' });
  tab._startEdit('c-brick'); ctx(); tab._edSetValue('voice', 'Grunts.'); await tab._save();
  ok(mcs.getContact('c-brick').voice === 'Grunts.', 'a lone contact saves its own');
  await mcs.updateContact('c-brick', { voice: '' });
  // New contact → voice lands on addContact.
  tab.openTo({ create: 'blank' }); ctx();
  tab._edSetValue('name', 'Padre'); tab._edSetValue('voice', ' Scripture and threats. ');
  await tab._save();
  const padre = mcs.getAll().find((c) => c.name === 'Padre');
  ok(padre && padre.voice === 'Scripture and threats.', 'Create carries voice into addContact');
  if (padre) await mcs.removeContact(padre.id);
  // Import carries it.
  ok(/notes: c\.notes \|\| '', voice: c\.voice \|\| ''/.test(js), 'import passes voice (export writes the whole contact)');
  // Markup + CSS + the shared partial (GM fieldset only).
  ok(/<textarea class="ncm-ct2-notes ncm-ct2-voice" data-ct2-voice="\{\{id\}\}" placeholder="\{\{voice\.placeholder\}\}">\{\{voice\.own\}\}<\/textarea>/.test(tpl), 'detail template: the Voice box reads the view-model');
  ok(/<em class="from">from \{\{voice\.from\}\}<\/em>/.test(tpl) && /an alias uses the main identity’s voice unless it has its own/.test(tpl), 'detail template: "from <main>" + the hint');
  ok(/data-esec="notes">[\s\S]*?<textarea name="voice" placeholder="\{\{@root\.ct2\.dir\.edit\.voice\.placeholder\}\}">\{\{f\.voice\}\}<\/textarea>/.test(tpl), 'edit form: the Voice field is in the Notes section and reaches its placeholder via @root (never ../ inside an {{#if}})');
  ok(!/\.\.\/voice/.test(tpl), 'no ../voice in the template');
  for (const cls of ['ncm-ct2-gmnotes', 'ncm-ct2-gmnote', 'ncm-ct2-voice', 'is-inherited']) ok(css.includes(cls), `css styles ${cls}`);
  const partial = read('templates/contact-manager/partials/contact-form.hbs');
  const gmStart = partial.indexOf('GM-ONLY FIELDS');
  const voiceAt = partial.indexOf('name="voice"');
  ok(gmStart > 0 && voiceAt > gmStart && partial.slice(voiceAt).indexOf('{{/if}}') < partial.slice(voiceAt).indexOf('ncm-form-actions'), 'shared contact-form partial: Voice is inside the GM-only fieldset (closed before the form actions)');
  ok(!/voice/.test(read('scripts/ui/ContactManager/ContactManagerApp.js')), 'the player Contact Manager never reads or writes a voice');
  // Rendered: the detail pane for the alias prints the inherited voice as the placeholder and never as the value.
  if (Handlebars) {
    const H2 = Handlebars.create();
    H2.registerPartial('modules/night-city-messenger/templates/admin-panel/partials/contacts-map.hbs', '');
    { const { registerTagHueHelper } = await import(new URL('../../../scripts/utils/tagHue.js', import.meta.url)); registerTagHueHelper(H2); }
    H2.registerHelper('eq', (a, b) => a === b);
    const r2 = H2.compile(tpl);
    tab._cancelEdit(); tab._selId = 'c-queen'; tab._dTab = 'main';
    const out = r2({ activeTab: 'contacts', ...ctx() });
    ok(/<em class="from">from Rogue<\/em>/.test(out) && /data-ct2-voice="c-queen" placeholder="Runs the room\. Short sentences, long pauses\."><\/textarea>/.test(out), 'render: alias → "from Rogue", inherited text as the placeholder, empty value');
    tab._selId = 'c-rogue';
    const out2 = r2({ activeTab: 'contacts', ...ctx() });
    ok(/data-ct2-voice="c-rogue" placeholder="How they talk — short, never apologises, calls everyone kid…">Runs the room\. Short sentences, long pauses\.<\/textarea>/.test(out2) && !/<em class="from">/.test(out2), 'render: main → its own voice as the value, no "from"');
    tab._startEdit('c-queen');
    const out3 = r2({ activeTab: 'contacts', ...ctx() });
    ok(/<textarea name="voice" placeholder="Runs the room\. Short sentences, long pauses\."><\/textarea>/.test(out3) && /from Rogue — type to override/.test(out3), 'render: the edit form shows the inherited placeholder + "type to override"');
    tab._cancelEdit();
  }
  await mcs.updateContact('c-rogue', { voice: '' });
}

console.log(`\ntest-admin-contacts: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
