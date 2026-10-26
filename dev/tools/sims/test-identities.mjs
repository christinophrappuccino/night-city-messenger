// Sim: IDENTITIES — one character, several directory contacts (2026-10-26,
// tester: "can one actor have multiple email addresses / aliases?"). Drives the
// pure rules (utils/identities.js), the REAL MasterContactService +
// MessageService methods via prototype.call over mocked data, and guards the
// composer / GM-screen wiring.
// Run: node dev/tools/sims/test-identities.mjs
import fs from 'fs';
import { pathToFileURL, fileURLToPath } from 'url';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };
const read = (p) => fs.readFileSync(`${ROOT}/${p}`, 'utf8');
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);

const actors = { lin: { id: 'lin', name: 'Lucky Lin', hasPlayerOwner: true, getFlag: () => 'lin@nightcity.net' } };
globalThis.game = { user: { isGM: true }, users: { activeGM: {} }, settings: { get: () => undefined }, nightcity: {}, actors: { get: (id) => actors[id] || null }, journal: { contents: [] } };
globalThis.foundry = { utils: { deepClone: (o) => JSON.parse(JSON.stringify(o)), randomID: (() => { let n = 0; return () => `new${++n}`; })() } };
globalThis.Hooks = { on: () => {}, once: () => {}, off: () => {}, call: () => true, callAll: () => {} };
globalThis.ui = { notifications: { info: () => {}, warn: () => {}, error: () => {} } };

// ═══ 1. Pure rules ═══
const I = await imp('scripts/utils/identities.js');
const main = { id: 'c1', name: 'Lucky Lin', email: 'lin@arasaka.corp', actorId: 'lin' };
const burner = { id: 'c2', name: 'Burner', email: 'ghost99@darknet', actorId: 'lin' };
const blue = { id: 'c3', name: 'Mr. Blue', email: 'blue@fixers.nc', actorId: 'lin' };
const loner = { id: 'c4', name: 'Rogue', email: 'rogue@afterlife.nc', actorId: 'rogue' };
const free = { id: 'c5', name: 'Kiosk', email: 'kiosk@nc' };
let C = [burner, main, blue, loner, free];
ok(I.identitiesOf(C, 'lin').map((c) => c.id).join() === 'c2,c1,c3', 'no main flagged → first linked is main, order kept');
C = [burner, { ...main, primaryIdentity: true }, blue, loner, free];
ok(I.identitiesOf(C, 'lin')[0].id === 'c1' && I.primaryOf(C, 'lin').id === 'c1', 'flagged main comes first');
ok(I.identitiesOf(C, '').length === 0 && I.identitiesOf(C, null).length === 0, 'no character → none');
ok(I.identityRole(C, burner).isAlias && I.identityRole(C, burner).primary.id === 'c1' && I.identityRole(C, burner).count === 3, 'alias role');
ok(I.identityRole(C, C[1]).isPrimary, 'main role');
ok(I.identityRole(C, loner) === null && I.identityRole(C, free) === null, 'a lone linked contact / an unlinked contact has no identity role');
ok(I.aliasLabel(C, 'c2') === 'alias of Lucky Lin' && I.aliasLabel(C, 'c1') === '' && I.aliasLabel(C, 'c4') === '', 'alias label');
const msgs = [
  { toContactId: 'c2', timestamp: '2045-01-02T00:00:00Z', status: {} },
  { toContactId: 'c2', timestamp: '2045-01-05T00:00:00Z', status: {} },
  { fromContactId: 'c3', timestamp: '2045-01-03T00:00:00Z', status: { sent: true } },
  { timestamp: '2045-01-04T00:00:00Z', status: {} },                    // names no identity → main
  { toContactId: 'c9', timestamp: '2045-01-06T00:00:00Z', status: {} }, // unknown contact → main
  { toContactId: 'c2', timestamp: '2045-01-09T00:00:00Z', status: { deleted: true } },
];
const u = I.identityUsage(msgs, I.identitiesOf(C, 'lin'));
ok(u.get('c2').count === 2 && u.get('c2').last === '2045-01-05T00:00:00Z', 'usage: received on the alias (deleted ignored)');
ok(u.get('c3').count === 1, 'usage: sent from an alias counts for it');
ok(u.get('c1').count === 2, 'usage: unnamed / unknown mail counts for the main identity');
ok(I.replyIdentity(C, { toContactId: 'c2' }, 'lin')?.id === 'c2', 'reply goes out as the alias it came to');
ok(I.replyIdentity(C, { toContactId: 'c2' }, 'someoneElse') === null && I.replyIdentity(C, { toContactId: 'c5' }, 'lin') === null, "never as someone else's contact");

// ═══ 2. Real MasterContactService ═══
const { MasterContactService } = await imp('scripts/services/MasterContactService.js');
const mcs = Object.create(MasterContactService.prototype);
mcs._contacts = [{ ...burner }, { ...main }, { ...blue }, { ...loner }];
mcs._persistContacts = async () => {};
mcs._onMasterListChanged = async () => {};
mcs._generateEmail = (n) => `${n}@nc`;
Object.defineProperty(mcs, 'eventBus', { value: { emit: () => {} } });
ok(mcs.getByActorId('lin').id === 'c2', 'getByActorId with no main → first (unchanged behaviour)');
await mcs.setPrimaryIdentity('c1');
ok(mcs.getByActorId('lin').id === 'c1', 'getByActorId returns the MAIN identity');
ok(mcs._contacts.filter((c) => c.primaryIdentity).length === 1, 'exactly one main per character');
await mcs.setPrimaryIdentity('c3');
ok(mcs.getByActorId('lin').id === 'c3' && !mcs.getContact('c1').primaryIdentity, 'moving the star clears the old main');
ok(!(await mcs.setPrimaryIdentity('nope')).success, 'unknown / unlinked contact refused');
ok(mcs.identitiesFor('lin').length === 3 && mcs.identityRoleOf('c2').isAlias, 'service identity helpers');
const add = await mcs.addIdentity('lin', { name: 'Night Shift', email: 'ns@nc' });
ok(add.success && add.contact.actorId === 'lin' && add.contact.email === 'ns@nc' && !add.contact.primaryIdentity, 'addIdentity links a new contact to the character');
ok(mcs.identitiesFor('lin').length === 4, 'four identities now');
ok(!(await mcs.addIdentity('ghost', { name: 'x' })).success, 'addIdentity needs a real character');
game.user.isGM = false;
ok(!(await mcs.setPrimaryIdentity('c1')).success && !(await mcs.addIdentity('lin', { name: 'x' })).success, 'GM only');
game.user.isGM = true;
ok(/'primaryIdentity'/.test(read('scripts/services/MasterContactService.js')), 'primaryIdentity is an updatable field');

// ═══ 3. Real MessageService: replies + the sender address ═══
game.nightcity.masterContactService = mcs;
const { MessageService } = await imp('scripts/services/MessageService.js');
const ms = Object.create(MessageService.prototype);
ms._buildReferences = () => [];
Object.defineProperty(ms, '_contactRepo', { value: { getActorEmail: (id) => (id === 'lin' ? 'lin@nightcity.net' : '') } });
// mail FROM Lin's burner → the reply goes back to the burner, not Lin's main address
let r = MessageService.prototype.buildReply.call(ms, { messageId: 'm1', subject: 'job', fromActorId: 'lin', fromContactId: 'c2', from: 'ghost99@darknet' }, 'v', '');
ok(r.toActorId === 'lin' && r.toContactId === 'c2' && r.to === 'ghost99@darknet', 'reply targets the alias it came from');
// mail TO Lin's burner → Lin replies AS the burner
r = MessageService.prototype.buildReply.call(ms, { messageId: 'm2', subject: 'job', fromActorId: 'v', toContactId: 'c2', to: 'ghost99@darknet' }, 'lin', '');
ok(r.fromContactId === 'c2' && r.from === 'ghost99@darknet', 'reply goes out from the alias it reached');
r = MessageService.prototype.buildReply.call(ms, { messageId: 'm3', subject: 'hi', fromActorId: 'v' }, 'lin', '');
ok(!r.fromContactId && !r.toContactId, 'plain mail: no identity invented');
// Send-as an alias: its own address wins over the registered one
ok(MessageService.prototype._senderEmailFor.call(ms, { fromActorId: 'lin', fromContactId: 'c2' }, actors.lin) === 'ghost99@darknet', 'sending as an alias uses its address');
ok(MessageService.prototype._senderEmailFor.call(ms, { fromActorId: 'lin' }, actors.lin) === 'lin@nightcity.net', 'no alias picked → registered address as before');
ok(MessageService.prototype._senderEmailFor.call(ms, { fromActorId: 'lin', fromContactId: 'c4' }, actors.lin) === 'lin@nightcity.net', "someone else's contact id never lends its address");

// ═══ 3b. Portraits — an alias never borrows its character's face ═══
actors.lin.img = 'faces/lucky-lin.webp';
const H = await imp('scripts/utils/helpers.js');
mcs._contacts = [{ ...main, primaryIdentity: true }, { ...burner }, { ...blue, portrait: 'faces/mr-blue.webp' }];
ok(H.resolveDisplayPortrait({ contactId: 'c1' }) === 'faces/lucky-lin.webp', 'main identity with no picture → the character');
ok(H.resolveDisplayPortrait({ contactId: 'c2', actorId: 'lin' }) === '', 'alias with no picture → initials, never the character');
ok(H.resolveDisplayPortrait({ contactId: 'c3', actorId: 'lin' }) === 'faces/mr-blue.webp', "alias with its own picture → that picture");
ok(H.resolveDisplayPortrait({ actorId: 'lin' }) === 'faces/lucky-lin.webp', 'by character only → the main identity / character');
const { PortraitService } = await imp('scripts/services/PortraitService.js');
const ps = Object.create(PortraitService.prototype);
ok(PortraitService.prototype.resolvePortrait.call(ps, { id: 'c2', actorId: 'lin' }) === null, 'PortraitService: alias → initials');
ok(PortraitService.prototype.resolvePortrait.call(ps, { id: 'x', masterContactId: 'c2', actorId: 'lin' }) === null, "PortraitService: a player's copy of an alias → initials");
ok(PortraitService.prototype.resolvePortrait.call(ps, { id: 'c1', actorId: 'lin' }) === 'faces/lucky-lin.webp', 'PortraitService: main → the character');
ok(PortraitService.prototype.resolvePortrait.call(ps, { id: 'c3', actorId: 'lin', portrait: 'faces/mr-blue.webp' }) === 'faces/mr-blue.webp', "PortraitService: alias's own picture");
ok(/name="ncmIdPortrait"/.test(read('scripts/ui/GMContactManager/GMContactManagerApp.js')) && /portrait: root\.querySelector\('\[name="ncmIdPortrait"\]'\)/.test(read('scripts/ui/GMContactManager/GMContactManagerApp.js')), '+ Add alias takes a picture');

// ═══ 3c. NPCs with NO actor — a contact-only NPC can have aliases too ═══
const fixer = { id: 'f1', name: 'Rogue', email: 'rogue@afterlife.nc' };
const fixAlias = { id: 'f2', name: 'The Queen', email: 'queen@darknet', identityOf: 'f1' };
const fixAlias2 = { id: 'f3', name: 'R.', email: 'r@relay.nc', identityOf: 'f2' };   // pointed at an alias — still Rogue's
let NC = [fixer, fixAlias, { ...fixAlias2, identityOf: 'f1' }, main, burner];
ok(I.groupKeyOf(NC, fixer) === 'c:f1' && I.groupKeyOf(NC, fixAlias) === 'c:f1', 'contact-only group keyed on the NPC contact');
ok(I.groupKeyOf(NC, { id: 'z', name: 'z' }) === null, 'a contact with no aliases is in no group');
ok(I.identitiesOfContact(NC, fixAlias)[0].id === 'f1', 'the NPC contact is main by default');
ok(I.identityRole(NC, fixAlias).isAlias && I.identityRole(NC, fixAlias).actorId === null, 'contact-only alias role');
ok(I.identityInboxId(NC, fixAlias) === 'f1' && I.identityInboxId(NC, fixer) === 'f1' && I.identityInboxId(NC, burner) === null, 'an alias routes into the NPC contact inbox');
ok(I.groupKeyOf([...NC, { id: 'p1', name: 'Pointer', identityOf: 'c1' }], { id: 'p1', name: 'Pointer', identityOf: 'c1' }) === 'a:lin', 'an alias pointed at a character contact joins the character');
ok(I.replyIdentity(NC, { toContactId: 'f2' }, { contactId: 'f1' })?.id === 'f2', 'the NPC replies AS the alias the mail reached');
ok(I.replyIdentity(NC, { toContactId: 'f2' }, { contactId: 'c1' }) === null, "never as another person's alias");

// the service: add an alias to a contact-only NPC
mcs._contacts = [{ ...fixer }];
const fa = await mcs.addContactIdentity('f1', { name: 'The Queen', email: 'queen@darknet' });
ok(fa.success && fa.contact.identityOf === 'f1' && !fa.contact.actorId, 'addContactIdentity points the alias at the NPC');
const fa2 = await mcs.addContactIdentity(fa.contact.id, { name: 'R.', email: 'r@relay.nc' });
ok(fa2.contact.identityOf === 'f1', 'an alias of an alias joins the same NPC (the root)');
ok(mcs.identitiesForContact('f1').length === 3 && mcs.identityRoleOf(fa.contact.id).isAlias, 'three identities in the NPC group');
await mcs.setPrimaryIdentity(fa.contact.id);
ok(mcs.identitiesForContact('f1')[0].id === fa.contact.id, 'the star moves inside a contact-only group too');
ok(!(await mcs.setPrimaryIdentity('nope')).success, 'no group → refused');

// routing + sent copy through the REAL methods
const NCS = mcs._contacts;
const msvc = { getAll: () => NCS, getContact: (id) => NCS.find((c) => c.id === id), getByEmail: () => null, getByActorId: () => null, isSendOnly: () => false };
game.nightcity.masterContactService = msvc;
const ms2 = Object.create(MessageService.prototype);
Object.defineProperty(ms2, '_contactRepo', { value: { getActorEmail: () => '' } });
let routed = null;
ms2._isKnownCorrespondent = async () => true;
const d1 = { toContactId: fa.contact.id, subject: 's', body: 'b' };
try { await MessageService.prototype._resolveRecipient.call(ms2, d1); } catch (e) { /* later gates may need more mocks */ }
ok(d1._recipientInboxId === 'f1' && d1.toContactId === fa.contact.id, "mail to the NPC's alias is delivered into the NPC's inbox, still addressed to the alias");
let filedIn = null;
Object.defineProperty(ms2, '_messageRepo', { value: { createMessage: async (inbox) => { filedIn = inbox; return { success: true }; } } });
ms2._maskAnonReplyForSender = (x) => x;
game.nightcity.terminalService = null;
await MessageService.prototype._createSentCopy.call(ms2, { messageId: 'z', fromContactId: fa.contact.id });
ok(filedIn === 'f1', "mail sent AS the NPC's alias is filed in the NPC's inbox");
await MessageService.prototype._createSentCopy.call(ms2, { messageId: 'z2', fromContactId: 'loose' });
ok(filedIn === 'loose', 'a contact in no group keeps its own inbox (unchanged)');
game.nightcity.masterContactService = mcs;
ok(/addContactIdentity\(contactId, picked\)/.test(read('scripts/ui/GMContactManager/GMContactManagerApp.js')) && /data-contact-id="\{\{selectedContact\.identities\.contactId\}\}"/.test(read('templates/gm-contact-manager/gm-contact-manager.hbs')), 'GM card: + Add alias works for a contact-only NPC');

// ═══ 4. Wiring ═══
const cmp = read('scripts/ui/MessageComposer/MessageComposerApp.js');
ok(/_addRecipient\(actorId, locked = false, ident = null\)/.test(cmp) && /contactId = ident\.contactId/.test(cmp), 'composer chips keep the picked identity');
ok(/this\._addRecipient\(result\.actorId, false, result\.contactId \?/.test(cmp), 'autocomplete passes the identity');
ok(/r\.contactId === mc\.id \|\|/.test(cmp), 'GM search lists every identity (dedupe by contact/address, not character)');
ok(/actorRecipients\[0\]\.contactId \|\| undefined/.test(cmp), 'a sole recipient sends its identity id');
ok(/this\.fromContact = mc \? \{ id: mc\.id/.test(cmp) && /if \(this\.fromContact\?\.email\) return this\.fromContact\.email;/.test(cmp), 'Send-as keeps the identity');
ok(/reply\.fromContactId && this\.fromContact\?\.id !== reply\.fromContactId/.test(cmp) && /fromContactId: this\.fromContact\?\.id \|\| null/.test(cmp), 'reply composer sends as the alias (character or contact-only NPC)');
const gm = read('scripts/ui/GMContactManager/GMContactManagerApp.js');
for (const a of ['identOpen', 'identSetPrimary', 'identAdd']) ok(new RegExp(`${a}:\\s+GMContactManagerApp\\._on`).test(gm), `GM Contact Manager action ${a}`);
ok(/selectedEnriched\.identities = this\._identitiesContext/.test(gm) && /selectedContact\.identities\.rows/.test(read('templates/gm-contact-manager/gm-contact-manager.hbs')), 'Identities card wired');
const ct = read('scripts/ui/AdminPanel/tabs/ContactsTab.js');
ok(/case 'aliases':/.test(ct) && /data-filter="aliases"/.test(read('templates/admin-panel/tab-contacts.hbs')) && /ncm-ct-row--alias/.test(read('templates/admin-panel/tab-contacts.hbs')), 'Admin Contacts: Aliases filter + nested alias rows');
ok(/hitGroups/.test(ct), 'Admin Contacts: a search hit brings the other identities');
const mt = read('scripts/ui/AdminPanel/tabs/MessagesTab.js');
ok(/fromAlias: this\._aliasNote\(fromContactId\)/.test(mt) && /this\.fromAlias/.test(read('templates/admin-panel/tab-messages.hbs')), 'Activity feed names the alias used');
ok(/identitiesOfContact\(all, self\) : identitiesOf\(all, actId\)/.test(mt), 'filtering by a character or an NPC includes its aliases');
ok(/senderAlias: this\._aliasNote/.test(mt), 'NPC Inbox names the alias');
for (const [f, c] of [['styles/components/gm-contact-manager.css', '.ncm-gm-ident'], ['styles/components/admin-panel/tab-contacts.css', '.ncm-ct-badge--alias'], ['styles/components/admin-panel/tab-messages.css', '.ncm-msg-alias']]) ok(read(f).includes(c), `css ${c}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
