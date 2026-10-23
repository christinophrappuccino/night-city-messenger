// Sim: contact groups phase two — groups as data (player flag + GM setting),
// address-keyed members, resolution, push to players, export/import across
// worlds, the composer/service groupId expansion, and the wiring drift guards.
// Drives the REAL ContactGroupService + MessageService._normalizeRecipients.
import { pathToFileURL } from 'url';
import { readFileSync } from 'fs';

const ROOT = 'C:/Users/cphan/AppData/Local/FoundryVTT/Data/modules/night-city-messenger';
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };
const MOD = 'night-city-messenger';

// ── World ──
const flagStore = new Map(); // actorId → { email, contactGroups }
const mkActor = (id, name, { email = '', owner = true, hasPlayerOwner = true, type = 'character' } = {}) => {
  flagStore.set(id, { email, contactGroups: undefined });
  return {
    id, name, type, hasPlayerOwner, isOwner: owner, img: '',
    getFlag: (m, k) => flagStore.get(id)?.[k],
    setFlag: async (m, k, v) => { flagStore.get(id)[k] = JSON.parse(JSON.stringify(v)); return true; },
  };
};
const actors = new Map([
  ['v', mkActor('v', 'V', { email: 'v@nightcity.net' })],
  ['panam', mkActor('panam', 'Panam Palmer', { email: 'panam@aldecaldos.nc' })],
  ['judy', mkActor('judy', 'Judy Alvarez', { email: 'judy@mox.nc', owner: false })],
  ['rogue', mkActor('rogue', 'Rogue', { hasPlayerOwner: false, type: 'npc' })],
]);
const master = [
  { id: 'mc-rogue', name: 'Rogue', email: 'rogue@afterlife.nc', actorId: 'rogue' },
  { id: 'mc-kerry', name: 'Kerry Eurodyne', email: 'kerry@eurodyne.nc', actorId: null },
];
const settings = { masterContactGroups: [] };
const pushed = [];
let gm = true;
globalThis.game = {
  user: { id: 'u', get isGM() { return gm; } },
  // getPlayerCharacters iterates game.users — Alice plays Panam; V is owned but unassigned.
  users: Object.assign([{ id: 'u', isGM: true, name: 'GM' }, { id: 'p1', isGM: false, name: 'Alice', character: actors.get('panam') }], { activeGM: { id: 'u' } }),
  actors: { get: (id) => actors.get(id) || null, contents: [...actors.values()], [Symbol.iterator]: function* () { yield* actors.values(); } },
  settings: { get: (m, k) => settings[k], set: async (m, k, v) => { settings[k] = JSON.parse(JSON.stringify(v)); } },
  nightcity: {
    masterContactService: {
      getContact: (id) => master.find(c => c.id === id) || null,
      getByEmail: (e) => master.find(c => c.email === String(e || '').toLowerCase().trim()) || null,
      getByActorId: (id) => master.find(c => c.actorId === id) || null,
      getAll: () => master,
      pushToPlayer: async (contactId, actorId) => { pushed.push({ contactId, actorId }); return { success: true }; },
      pushActorToPlayer: async (srcActorId, actorId) => { pushed.push({ srcActorId, actorId }); return { success: true }; },
    },
    contactRepository: {
      getActorEmail: (id) => flagStore.get(id)?.email || '',
      getContacts: async (actorId) => [
        { name: 'Panam Palmer', email: 'panam@aldecaldos.nc', actorId: 'panam', tags: ['crew'] },
        { name: 'Judy Alvarez', email: 'judy@mox.nc', actorId: 'judy', tags: ['crew'] },
        { name: 'Rogue', email: 'rogue@afterlife.nc', masterContactId: 'mc-rogue', tags: ['fixers'] },
      ],
    },
  },
};
globalThis.foundry = { utils: { randomID: (() => { let n = 0; return () => `g${++n}`; })(), deepClone: (o) => JSON.parse(JSON.stringify(o)), mergeObject: (a, b) => ({ ...a, ...b }) } };
globalThis.Hooks = { on: () => {}, once: () => {}, off: () => {} };
globalThis.ui = { notifications: { info: () => {}, warn: () => {}, error: () => {} } };
globalThis.document = { createElement: () => ({ _h: '', set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; }, querySelectorAll: () => [] }) };

const S = await import(pathToFileURL(`${ROOT}/scripts/services/ContactGroupService.js`).href);
const { MessageService } = await import(pathToFileURL(`${ROOT}/scripts/services/MessageService.js`).href);
const { makeMember } = await import(pathToFileURL(`${ROOT}/scripts/utils/participants.js`).href);
const svc = new S.ContactGroupService();
game.nightcity.contactGroupService = svc;

// ═══ 1. sanitizeGroup + member builders ═══
{
  const g = S.sanitizeGroup({ name: '  The Crew ', color: 'nope', members: [{ email: 'A@x.nc' }, { email: 'a@x.nc' }] });
  ok(g.name === 'The Crew' && g.color === S.GROUP_COLORS[0] && g.members.length === 1 && g.id, 'sanitize trims the name, falls back the colour, de-dupes members, mints an id');
  ok(S.sanitizeGroup({ color: '#123abc' }).color === '#123abc', 'any hex colour is accepted');
  const m = S.memberFromPlayerContact({ name: 'Rogue', email: 'Rogue@Afterlife.NC', masterContactId: 'mc-rogue' });
  ok(m.email === 'rogue@afterlife.nc' && m.hint.contactId === 'mc-rogue' && m.kind === 'contact', 'memberFromPlayerContact → address + directory hint');
  ok(S.memberFromMasterContact(master[0]).hint.actorId === 'rogue' && S.memberFromActor(actors.get('v')).email === 'v@nightcity.net', 'master-contact and actor builders carry the right hints');
}

// ═══ 2. Player groups on the actor flag ═══
{
  let r = await svc.saveActorGroup('v', { name: 'The Crew', members: [S.memberFromPlayerContact({ name: 'Panam Palmer', email: 'panam@aldecaldos.nc', actorId: 'panam' }), makeMember({ email: 'judy@mox.nc', name: 'Judy Alvarez', hint: { actorId: 'judy' } })] });
  ok(r.success && svc.getActorGroups('v').length === 1, 'a player saves a group onto their own actor');
  const id = r.group.id;
  r = await svc.saveActorGroup('v', { ...svc.getActorGroup('v', id), name: 'Crew' });
  ok(r.success && svc.getActorGroups('v').length === 1 && svc.getActorGroup('v', id).name === 'Crew', 'saving with the same id updates in place');
  r = await svc.saveActorGroup('judy', { name: 'X', members: [makeMember({ email: 'v@nightcity.net' })] });
  ok(!r.success && /own/.test(r.error), 'cannot write a group onto an actor you do not own');
  r = await svc.saveActorGroup('v', { name: 'Empty', members: [] });
  ok(!r.success, 'a group needs at least one member');
  const fromTag = await svc.groupFromTag('v', 'crew');
  ok(fromTag.name === 'crew' && fromTag.members.length === 2, '"group from tag" collects every contact carrying the tag');
  r = await svc.deleteActorGroup('v', id);
  ok(r.success && svc.getActorGroups('v').length === 0, 'delete removes it');
}

// ═══ 3. GM groups in the world setting ═══
{
  gm = false;
  let r = await svc.saveMasterGroup({ name: 'Afterlife', members: [S.memberFromMasterContact(master[0])] });
  ok(!r.success, 'a player cannot write GM groups');
  gm = true;
  r = await svc.saveMasterGroup({ name: 'Afterlife', members: [S.memberFromMasterContact(master[0]), S.memberFromMasterContact(master[1]), S.memberFromActor(actors.get('panam'))] });
  ok(r.success && svc.getMasterGroups().length === 1, 'GM saves a group into the setting');
  ok(svc.groupsFor({ actorId: 'v', isGM: true }).some(g => g.scope === 'master') && !svc.groupsFor({ actorId: 'v', isGM: false }).some(g => g.scope === 'master'), 'groupsFor offers GM groups only to the GM');
  ok(svc.searchGroups('after', { isGM: true }).length === 1 && svc.searchGroups('kerry', { isGM: true }).length === 1 && svc.searchGroups('zzz', { isGM: true }).length === 0, 'search matches the group name OR a member');
}

// ═══ 4. recipientsFor — resolution + unresolved reporting ═══
{
  const g = svc.getMasterGroups()[0];
  const { recipients, unresolved } = svc.recipientsFor(g);
  ok(recipients.length === 3 && unresolved.length === 0, 'three resolvable members → three recipients');
  ok(recipients.find(r => r.contactId === 'mc-rogue')?.actorId === 'rogue', 'a directory member resolves to its entry AND its linked actor');
  ok(recipients.find(r => r.name === 'Kerry Eurodyne')?.contactId === 'mc-kerry' && !recipients.find(r => r.name === 'Kerry Eurodyne')?.actorId, 'a contact-only member resolves to the directory entry alone');
  const ghost = S.sanitizeGroup({ name: 'Ghosts', members: [makeMember({ name: 'Nobody', hint: { actorId: 'gone' } }), makeMember({ email: 'raw@street.nc', name: 'Raw' })] });
  const rr = svc.recipientsFor(ghost);
  ok(rr.recipients.length === 1 && rr.recipients[0].email === 'raw@street.nc' && rr.unresolved[0] === 'Nobody', 'a dead hint with no address is REPORTED; a bare address still goes as a raw recipient');
}

// ═══ 5. Push to a player ═══
{
  const g = svc.getMasterGroups()[0];
  pushed.length = 0;
  let r = await svc.pushGroupToPlayer(g.id, 'panam');
  ok(r.success && r.shared === 2, 'push shares the members (a character never receives itself)');
  ok(pushed.some(p => p.contactId === 'mc-rogue') && pushed.some(p => p.contactId === 'mc-kerry') && !pushed.some(p => p.srcActorId === 'panam'), 'directory members go through pushToPlayer; the target is skipped');
  const copies = svc.getActorGroups('panam');
  ok(copies.length === 1 && copies[0].sharedFrom?.groupId === g.id && copies[0].id !== g.id, 'the player gets a COPY tagged sharedFrom, with its own id');
  r = await svc.pushGroupToPlayer(g.id, 'panam');
  ok(r.success && svc.getActorGroups('panam').length === 1, 're-pushing REPLACES the earlier copy (never a duplicate)');
  ok(svc.sharedWith(g.id).some(s => s.actorId === 'panam'), 'sharedWith reports who holds a copy');
  gm = false;
  r = await svc.pushGroupToPlayer(g.id, 'v');
  ok(!r.success, 'a player cannot push');
  gm = true;
}

// ═══ 6. Export / import — round trip into a world with different ids ═══
{
  const exported = svc.exportMaster();
  ok(exported.length === 1 && exported[0].sharedFrom === null && exported[0].members.every(m => m.email || m.hint.actorId), 'export carries members by address, sharedFrom stripped');
  // World B: same addresses, every id different, Panam's actor absent (name match only)
  const bActors = new Map([['b-pan', { id: 'b-pan', name: 'Panam Palmer', type: 'character', hasPlayerOwner: true, getFlag: () => 'panam@aldecaldos.nc' }]]);
  const bMaster = [{ id: 'b-rogue', name: 'Rogue', email: 'rogue@afterlife.nc', actorId: null }, { id: 'b-kerry', name: 'Kerry Eurodyne', email: 'kerry@eurodyne.nc', actorId: null }];
  const savedGame = game;
  globalThis.game = { ...savedGame, actors: { get: (id) => bActors.get(id) || null, contents: [...bActors.values()] }, nightcity: { ...savedGame.nightcity, masterContactService: { ...savedGame.nightcity.masterContactService, getContact: (id) => bMaster.find(c => c.id === id) || null, getByEmail: (e) => bMaster.find(c => c.email === e) || null, getAll: () => bMaster } } };
  settings.masterContactGroups = [];
  const r = await svc.importMaster(JSON.parse(JSON.stringify(exported)));
  ok(r.success && r.imported === 1 && r.unresolved.length === 0, 'import lands the group; every member re-resolves by ADDRESS in world B');
  const { recipients } = svc.recipientsFor(svc.getMasterGroups()[0]);
  ok(recipients.find(x => x.contactId === 'b-rogue') && recipients.find(x => x.contactId === 'b-kerry') && recipients.find(x => x.actorId === 'b-pan'), 'world-B ids come back for all three members');
  const again = await svc.importMaster(exported);
  ok(again.imported === 0 && again.skipped === 1, 're-import is a no-op (de-duped by name)');
  const bad = await svc.importMaster([{ name: 'Lost', members: [{ name: 'Nobody', hint: { actorId: 'zzz' } }] }]);
  ok(bad.imported === 1 && bad.unresolved.length === 1 && /Lost: Nobody/.test(bad.unresolved[0]), 'unresolvable members are reported by group and name, not dropped');
  globalThis.game = savedGame;
}

// ═══ 7. MessageService: groupId expands to recipients ═══
{
  settings.masterContactGroups = [];
  await svc.saveMasterGroup({ name: 'Afterlife', members: [S.memberFromMasterContact(master[0]), S.memberFromMasterContact(master[1])] });
  const g = svc.getMasterGroups()[0];
  const ms = Object.create(MessageService.prototype);
  const data = { groupId: g.id, fromActorId: 'v', recipients: [{ actorId: 'panam' }] };
  const list = ms._normalizeRecipients(data);
  ok(list.length === 3 && !('groupId' in data), 'a groupId expands to its members and merges with an explicit list; the id is consumed');
  ok(ms._normalizeRecipients({ groupId: 'nope', fromActorId: 'v' }).length === 0, 'an unknown group yields nothing (the validator then refuses the send)');
}

// ═══ 8. Drift guards ═══
{
  const r = (f) => readFileSync(`${ROOT}/${f}`, 'utf8');
  ok(/CONTACT_GROUPS_PANEL/.test(r('scripts/utils/constants.js')), 'the panel partial is registered in TEMPLATES (else "Partial not found")');
  ok(/contact-groups\.css/.test(r('styles/night-city-messenger.css')), 'contact-groups.css is imported');
  ok(/'masterContactGroups'/.test(r('scripts/core/SettingsManager.js')), 'the GM groups setting is registered');
  ok(/contactGroupService = new ContactGroupService/.test(r('scripts/init/registerGMTools.js')), 'the service is constructed at ready');
  ok(/get contactGroupService/.test(r('scripts/ui/BaseApplication.js')), 'BaseApplication exposes the service');
  const cm = r('scripts/ui/ContactManager/ContactManagerApp.js');
  for (const a of ['cgNew', 'cgEdit', 'cgDelete', 'cgMessage']) ok(new RegExp(`${a}:\\s+ContactManagerApp\\._on`).test(cm), `player Contact Manager wires ${a}`);
  // Rail + tray (2026-10-21): chips open ONE tray, members click through, the rail folds.
  for (const a of ['cgOpen', 'cgClose', 'cgMore', 'cgMember']) ok(new RegExp(`${a}:\\s+ContactManagerApp\\._on`).test(cm), `player Contact Manager wires ${a}`);
  ok(/static GROUP_RAIL_LIMIT = \d+;/.test(cm) && /_findGroupMemberContact\(/.test(cm), 'rail limit + member→contact resolver exist');
  const panel = r('templates/contact-manager/partials/contact-groups-panel.hbs');
  ok(/ncm-cgr__rail/.test(panel) && /ncm-cgr__tray/.test(panel) && /data-action="cgOpen"/.test(panel) && /data-action="cgMember"/.test(panel), 'panel renders the rail, the tray, chip + member actions');
  ok(/data-action="cgMore"/.test(panel) && /contactGroups\.hiddenCount/.test(panel), 'panel folds past the limit behind "+N more"');
  ok(!/ncm-cgp/.test(panel), 'old .ncm-cgp markup gone from the panel');
  const gcss = r('styles/components/contact-groups.css');
  ok(/\.ncm-cgr__chip\b/.test(gcss) && /\.ncm-cgr__tray\b/.test(gcss) && !/\.ncm-cgp\b/.test(gcss), 'contact-groups.css carries the rail rules and no .ncm-cgp leftovers');
  ok(/lastUsedAt: raw\.lastUsedAt/.test(r('scripts/services/ContactGroupService.js')) && /async touchActorGroup\(/.test(r('scripts/services/ContactGroupService.js')), 'sanitizeGroup keeps lastUsedAt; touchActorGroup exists');
  ok(/touchActorGroup\?\.\(this\.fromActorId, r\.groupId\)/.test(r('scripts/ui/MessageComposer/MessageComposerApp.js')), 'a successful composer send touches each of my group chips');

  ok(/contactGroups: this\._contactGroupsContext\(\)/.test(cm), 'player context carries contactGroups');
  ok(/contact-groups-panel\.hbs/.test(r('templates/contact-manager/contact-manager.hbs')), 'player template renders the panel');
  const ap = r('scripts/ui/AdminPanel/AdminPanelApp.js');
  for (const a of ['cgAdminNew', 'cgAdminEdit', 'cgAdminDelete', 'cgAdminPush']) ok(new RegExp(`${a}:\\s+AdminPanelApp\\._on`).test(ap), `AdminPanelApp wires ${a}`);
  const ct = r('scripts/ui/AdminPanel/tabs/ContactsTab.js');
  for (const m of ['onGroupNew', 'onGroupEdit', 'onGroupDelete', 'onGroupPush']) ok(new RegExp(`async ${m}\\(`).test(ct), `ContactsTab implements ${m}`);
  ok(/ncmMasterContacts: 1/.test(ct) && /parsed\?\.contacts/.test(ct) && /importMaster/.test(ct), 'admin export writes the envelope; import accepts envelope or bare array and imports groups');
  ok(/parsed\?\.contacts/.test(r('scripts/ui/GMContactManager/GMContactManagerApp.js')), 'GM Contact Manager import accepts the envelope too');
  ok(/ncm-cg__list/.test(r('templates/admin-panel/tab-contacts.hbs')), 'admin tab renders the Groups card');
  // The panel merges each tab's context into ONE template context. Lifting named
  // keys out of the Contacts tab context dropped `masterGroups` (tester 2026-10-22:
  // "groups save but never appear in the admin UI") — the tab context must be
  // SPREAD, and every key the tab returns must reach the template.
  ok(/\.\.\.contactContext,/.test(ap), 'AdminPanelApp spreads the whole Contacts tab context');
  const ctReturn = ct.match(/prepareContext\(\) \{[\s\S]*?return \{([\s\S]*?)\};/)?.[1] || '';
  const ctKeys = [...ctReturn.matchAll(/^\s*([A-Za-z]+):/gm)].map(m => m[1]);
  ok(ctKeys.includes('masterGroups'), 'ContactsTab.prepareContext returns masterGroups');
  for (const k of ctKeys) ok(new RegExp(`\\{\\{[^}]*\\b${k}\\b`).test(r('templates/admin-panel/tab-contacts.hbs')), `tab-contacts.hbs reads ${k}`);
  const comp = r('scripts/ui/MessageComposer/MessageComposerApp.js');
  ok(/_addGroupRecipient\(/.test(comp) && /groupHits/.test(comp) && /r\.isGroup\) \{ hasGroup = true/.test(comp), 'composer searches groups, adds a group chip, and flattens it at send');
  ok(/groupId: options\.groupId \?\? null/.test(r('scripts/init/registerMessagingSystem.js')), 'the compose launcher forwards groupId');
  ok(/ncm-composer__chip--group/.test(r('templates/message-composer/message-composer.hbs')), 'composer template renders the group chip');
  // The composer does NOT extend BaseApplication — every `this.<service>` it reads must be
  // ITS OWN getter (the first build read this.contactGroupService → undefined → the group
  // never appeared in To; live-test report 2026-10-20).
  for (const svcName of [...new Set([...comp.matchAll(/this\.(\w+Service)\b/g)].map(m => m[1]))]) {
    ok(new RegExp(`get ${svcName}\\(\\)`).test(comp), `composer defines its own getter for this.${svcName}`);
  }
  ok(/multi = false/.test(r('scripts/utils/namePicker.js')) && /is-picked/.test(r('scripts/utils/namePicker.js')), 'the shared picker has a multi-select mode');
  ok(/pushGroupToPlayer/.test(r('scripts/integrations/MacroAPI.js')), 'macro API exposes the group calls');
}

console.log(`\ntest-contact-groups: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
