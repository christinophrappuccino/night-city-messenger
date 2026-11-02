// Sim: tester round 2026-11-02. (1) A player's To search offers only what they know. (2) A scheduled message names its
// recipients, keeps everything through Edit and refunds its eddies when cancelled. (3) Add on mail from an alias saves the alias, not the main address.
// Drives the REAL helpers, SchedulingService, MessageViewerApp methods and MessageService.buildReply.
//   node dev/tools/sims/test-tester-2026-11-02.mjs
import { pathToFileURL, fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
const src = (p) => readFileSync(`${ROOT}/${p}`, 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.error('FAIL:', m)); };

const MAIN = { id: 'c-main', name: 'Lucky Lin', email: 'lucky@afterlife.nc', actorId: 'npc', primaryIdentity: true, portrait: 'lucky.png' };
const ALIAS = { id: 'c-alias', name: 'Mr Grey', email: 'grey@burner.nc', actorId: 'npc' };
const LONE = { id: 'c-lone', name: 'Judy', email: 'judy@mox.nc' };
const ALL = [MAIN, ALIAS, LONE];
const { identitiesOf, identityRole } = await imp('scripts/utils/identities.js');

const mcs = {
  getAll: () => ALL,
  getContact: (id) => ALL.find((c) => c.id === id) || null,
  getByEmail: (e) => ALL.find((c) => c.email === String(e).toLowerCase()) || null,
  getByActorId: (a) => identitiesOf(ALL, a)[0] || null,
  identityRoleOf: (c) => identityRole(ALL, c),
};
const actors = new Map([
  ['npc', { id: 'npc', name: 'Lucky-NPC', img: 'npc.png', hasPlayerOwner: false, getFlag: () => 'lucky@afterlife.nc' }],
  ['pc', { id: 'pc', name: 'V', img: 'v.png', type: 'character', hasPlayerOwner: true, getFlag: () => 'v@nc.net' }],
]);
actors[Symbol.iterator] = function* () { yield* Map.prototype.values.call(this); };
globalThis.game = {
  actors, user: { id: 'P', isGM: false }, users: { activeGM: { id: 'G' } },
  settings: { get: () => [] },
  nightcity: { masterContactService: mcs, contactGroupService: { findGroup: (id) => (id === 'g1' ? { name: 'The Crew' } : null) } },
};
globalThis.foundry = { utils: { randomID: () => 'id' } };
globalThis.Hooks = { on() {} };

const { resolveDisplayName, resolveDisplayPortrait, directoryEntryFor } = await imp('scripts/utils/helpers.js');
const { scheduledRecipients, scheduledRecipientLabel } = await imp('scripts/services/SchedulingService.js');

// ═══ 1. The address decides who sent it ═══
ok(directoryEntryFor({ actorId: 'npc', email: ALIAS.email })?.id === 'c-alias', 'character + alias address = the alias');
ok(directoryEntryFor({ contactId: 'c-main', actorId: 'npc', email: ALIAS.email })?.id === 'c-alias', 'a main id beside an alias address = the alias');
ok(directoryEntryFor({ contactId: 'c-alias', email: ALIAS.email })?.id === 'c-alias', 'matching id + address');
ok(directoryEntryFor({ actorId: 'npc', email: 'lucky-npc@nightcity.net' })?.id === 'c-main', 'a synthesized address falls back to the main identity');
ok(directoryEntryFor({ contactId: 'c-alias', email: 'x@nightcity.net' })?.id === 'c-alias', 'an unknown address falls back to the contact id');
ok(directoryEntryFor({}) === null, 'nothing to go on = null');
ok(resolveDisplayName({ actorId: 'npc', email: ALIAS.email }) === 'Mr Grey', 'the alias name shows, not the main name');
ok(resolveDisplayPortrait({ actorId: 'npc', email: ALIAS.email }) === '', 'an alias does not borrow the character\'s picture');
ok(resolveDisplayName({ actorId: 'npc' }) === 'Lucky Lin', 'no address: still the main identity');
ok(resolveDisplayPortrait({ actorId: 'npc', email: MAIN.email }) === 'lucky.png', 'the main identity keeps its picture');

// ═══ 2. Scheduled recipients ═══
ok(scheduledRecipientLabel({ toActorId: 'pc', to: 'v@nc.net' }) === 'V', 'one character by name');
ok(scheduledRecipientLabel({ toContactId: 'c-lone', to: 'judy@mox.nc' }) === 'Judy', 'one contact by name');
ok(scheduledRecipientLabel({ to: 'raw@street.nc' }) === 'raw', 'a raw address reads as its handle');
const two = { toActorId: ['pc', 'npc'], recipients: [{ actorId: 'pc', name: 'V', email: 'v@nc.net' }, { actorId: 'npc', name: 'Lucky Lin', email: MAIN.email }] };
ok(scheduledRecipientLabel(two) === 'V, Lucky Lin', 'several people: the reported Unknown');
ok(scheduledRecipientLabel({ recipients: [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }, { name: 'E' }] }) === 'A, B +3', 'many people shorten with a count');
ok(scheduledRecipientLabel({ recipients: [{ actorId: 'pc', name: '' }] }) === 'V', 'a group of one, unnamed row');
ok(scheduledRecipientLabel({ groupId: 'g1' }) === 'The Crew', 'a macro group by name');
ok(scheduledRecipientLabel({ groupId: 'gone' }) === 'A group', 'a deleted group');
ok(scheduledRecipientLabel({ anonReply: { alias: 'GHOST' } }) === 'GHOST', 'an anonymous reply never names the real target');
ok(scheduledRecipientLabel({}) === 'Unknown', 'truly nobody');
ok(scheduledRecipients(two).length === 2, 'Edit gets every recipient');
ok(scheduledRecipients({ toContactId: 'c-lone', to: 'judy@mox.nc' })[0].contactId === 'c-lone', 'Edit keeps a contact\'s id');
ok(scheduledRecipients({ toActorId: ['pc', 'npc'] }).length === 2, 'older array entries still list both');
// A saved entry is JSON: it must still read after a round trip through the world setting.
ok(scheduledRecipientLabel(JSON.parse(JSON.stringify(two))) === 'V, Lucky Lin', 'survives saving');

// ═══ 3. Add on the viewer: real methods ═══
const viewerSrc = src('scripts/ui/MessageViewer/MessageViewerApp.js');
const grab = (name) => {
  const at = viewerSrc.indexOf(`\n  ${name}(`); const open = viewerSrc.indexOf('{', viewerSrc.indexOf(')', at));
  let d = 0, i = open; for (; i < viewerSrc.length; i++) { if (viewerSrc[i] === '{') d++; if (viewerSrc[i] === '}' && --d === 0) break; }
  return viewerSrc.slice(at, i + 1);
};
const Body = new Function('directoryEntryFor', `return class V {
  _findContact(a) { const n = String(a || '').toLowerCase(); return this._cachedContacts.find(c => c.email?.toLowerCase() === n) || null; }
  ${grab('_findSenderContact')}
  ${grab('_senderToAdd')}
}`)(directoryEntryFor);
const v = new Body();
const verified = new Set(ALL.map((c) => c.email).concat('v@nc.net'));
v.contactRepository = { verifyContact: (e) => ({ verified: verified.has(e) }) };
v._cachedContacts = [];
let add = v._senderToAdd({ from: ALIAS.email, fromActorId: 'npc' });
ok(add.email === ALIAS.email && add.entry.id === 'c-alias' && add.isAlias, 'character + alias address: Add saves the alias');
add = v._senderToAdd({ from: ALIAS.email, fromActorId: 'npc', fromContactId: 'c-main' });
ok(add.email === ALIAS.email && add.isAlias, 'a main id beside an alias address: Add saves the alias (the report)');
add = v._senderToAdd({ from: MAIN.email, fromActorId: 'npc', fromContactId: 'c-main' });
ok(add.email === MAIN.email && !add.isAlias, 'mail from the main address adds the main');
add = v._senderToAdd({ from: 'lucky-npc@nightcity.net', fromActorId: 'npc' });
ok(add.email === MAIN.email, 'an old synthesized address still upgrades to the directory address');
ok(/actorId: isAlias \? null/.test(viewerSrc), 'an alias contact saved by Add carries no character link');

v._cachedContacts = [{ id: 'x', email: MAIN.email, actorId: 'npc', masterContactId: 'c-main' }];
ok(v._findSenderContact({ from: ALIAS.email, fromActorId: 'npc' }) === null, 'holding the main does not hide Add on alias mail');
ok(v._findSenderContact({ from: MAIN.email, fromActorId: 'npc' })?.id === 'x', 'main mail finds the main contact');
ok(v._findSenderContact({ from: 'lucky-npc@nightcity.net', fromActorId: 'npc' })?.id === 'x', 'old synthesized mail finds the main contact');
v._cachedContacts = [{ id: 'y', email: ALIAS.email, masterContactId: 'c-alias' }];
ok(v._findSenderContact({ from: ALIAS.email, fromActorId: 'npc' })?.id === 'y', 'alias mail finds the alias contact');
ok(v._findSenderContact({ from: MAIN.email, fromActorId: 'npc' }) === null, 'holding the alias does not reveal the main as known');
v._cachedContacts = [{ id: 'z', email: ALIAS.email, actorId: 'npc', masterContactId: 'c-alias' }];
ok(v._findSenderContact({ from: MAIN.email, fromActorId: 'npc' }) === null, 'an alias saved by the old Add (with a link) is not the main');
v._cachedContacts = [{ id: 'h', email: 'hand@made.nc', actorId: 'pc' }];
ok(v._findSenderContact({ from: 'v@nc.net', fromActorId: 'pc' })?.id === 'h', 'a hand-made link to a character still matches');

// ═══ 4. Reply answers the identity the mail came from ═══
const { MessageService } = await imp('scripts/services/MessageService.js');
const reply = (orig) => MessageService.prototype.buildReply.call({ _buildReferences: () => [] }, { subject: 'x', messageId: 'm', ...orig }, 'pc', 'hi');
let r = reply({ from: ALIAS.email, fromActorId: 'npc' });
ok(r.toContactId === 'c-alias' && r.to === ALIAS.email, 'no contact id: the reply goes to the alias');
r = reply({ from: ALIAS.email, fromActorId: 'npc', fromContactId: 'c-main' });
ok(r.toContactId === 'c-alias' && r.to === ALIAS.email, 'main id + alias address: the reply goes to the alias');
r = reply({ from: 'lucky-npc@nightcity.net', fromActorId: 'npc' });
ok(!r.toContactId && r.toActorId === 'npc', 'an old synthesized address replies to the character');

// ═══ 5. Wiring ═══
const svcSrc = src('scripts/services/MessageService.js');
ok(/byAddress\?\.actorId === fromActor\.id \? byAddress : byActor/.test(svcSrc), 'sending from an alias address records the alias');
ok(/recipients: options\.recipients \?\? null/.test(src('scripts/init/registerMessagingSystem.js')), 'the launcher forwards recipients');
ok(/options\.recipients \|\| \[\]/.test(src('scripts/ui/MessageComposer/MessageComposerApp.js')), 'the composer opens with them');
ok(/recipients: msgData\.anonReply \? \[\] : scheduledRecipients\(msgData\)/.test(viewerSrc), 'Edit passes every recipient');
ok(/fromContactId: msgData\.fromContactId/.test(viewerSrc), 'Edit keeps the alias it was written as');
ok(/toName: scheduledRecipientLabel\(e\.messageData\)/.test(viewerSrc), 'the Agent\'s Scheduled tab names recipients');
const tabSrc = src('scripts/ui/AdminPanel/tabs/MessagesTab.js');
ok((tabSrc.match(/scheduledRecipientLabel\(/g) || []).length >= 2, 'Admin Outbox + its edit dialog name recipients');
ok(/import \{[^}]*scheduledRecipientLabel[^}]*\} from '..\/..\/..\/services\/SchedulingService\.js'/.test(tabSrc), 'MessagesTab imports the label');
ok(/getRecipientDirectory\(\{ isGM: game\.user\.isGM \}\)/.test(src('scripts/ui/MessageComposer/MessageComposerApp.js')), 'a player To search is limited');

// ═══ 6. Scheduled eddies: refund on cancel, exactly what was paid ═══
const { SchedulingService, scheduledComposerState, selfDestructAtDelivery, creditOldScheduled } = await imp('scripts/services/SchedulingService.js');
globalThis.foundry.utils.deepClone = (o) => JSON.parse(JSON.stringify(o));
const toasts = [];
globalThis.ui = { notifications: { error: (m) => toasts.push(m), warn: (m) => toasts.push(m), info() {} } };
const wallet = (over = {}) => ({
  id: 'pc', name: 'V', isOwner: true, system: { wealth: { value: 100, transactions: [] } },
  update(u) { this.system.wealth = u['system.wealth']; return Promise.resolve(); }, ...over,
});
const later = new Date(Date.now() + 3600000).toISOString();
const makeSvc = () => { const s = new SchedulingService(); s._persistScheduled = async () => {}; return s; };
game.nightcity.socketManager = { emit() {}, register() {} };
game.nightcity.eventBus = { emit() {} };
game.user.isGM = false;

let pcA = wallet(); actors.set('pc', pcA);
let sch = makeSvc();
let made = await sch.scheduleMessage({ fromActorId: 'pc', toActorId: 'npc', to: MAIN.email, subject: 's', eddies: 200, recipients: [{ actorId: 'a' }, { actorId: 'b' }] }, later, { useGameTime: false, eddiesHeld: 400 });
ok(made.success && sch.getScheduled(made.scheduleId).eddiesHeld === 400, 'the entry records what was paid');
let can = await sch.cancelScheduled(made.scheduleId);
ok(can.success && can.refunded === 400 && pcA.system.wealth.value === 500, 'cancel refunds the whole fan-out share, once');
ok(/Refund/.test(pcA.system.wealth.transactions.at(-1)?.[1]), 'the ledger says it was a refund');
ok((await sch.cancelScheduled(made.scheduleId)).success === false && pcA.system.wealth.value === 500, 'a second cancel refunds nothing');

pcA = wallet(); actors.set('pc', pcA);
made = await sch.scheduleMessage({ fromActorId: 'pc', toActorId: 'npc', subject: 's', eddies: 200 }, later, { useGameTime: false });
can = await sch.cancelScheduled(made.scheduleId);
ok(can.refunded === 0 && pcA.system.wealth.value === 100, 'eddies never paid (a macro, an older entry) mint nothing');

pcA = wallet({ isOwner: false }); actors.set('pc', pcA); toasts.length = 0;
made = await sch.scheduleMessage({ fromActorId: 'pc', toActorId: 'npc', subject: 's', eddies: 50 }, later, { useGameTime: false, eddiesHeld: 50 });
can = await sch.cancelScheduled(made.scheduleId);
ok(can.success && can.refunded === 0 && pcA.system.wealth.value === 100 && toasts.some((t) => /50 eb/.test(t)), 'no permission on the sender: says so instead of losing it silently');
game.user.isGM = true; game.nightcity.settingsManager = { set: async () => {} };
made = await sch.scheduleMessage({ fromActorId: 'pc', toActorId: 'npc', subject: 's', eddies: 50 }, later, { useGameTime: false, eddiesHeld: 50 });
can = await sch.cancelScheduled(made.scheduleId);
ok(can.refunded === 50 && pcA.system.wealth.value === 150, 'a GM can refund any sender');
game.user.isGM = false;

// ═══ 7. Edit brings everything back ═══
const entry = JSON.parse(JSON.stringify({
  deliveryTime: later, useGameTime: true, eddiesHeld: 400,
  messageData: {
    threadId: 't', inReplyTo: 'p', eddies: 200, network: 'NET', networkOverride: true,
    attachments: [{ name: 'Shard', itemUuid: 'u' }, { isEddies: true, name: 'Eddies' }],
    encryption: { type: 'RED_ICE', dc: 18, failureMode: 'damage', maxAttempts: 2, bypassSkills: ['Interface'], ice: { source: 'actor', actorId: 'ice' } },
    selfDestruct: { mode: '1h', expiresAt: 'x', duration: 3600000 },
    anonymous: { enabled: true, style: 'ghost', alias: 'NOBODY', allowReplies: false, traceDV: 11 },
  },
}));
let st = scheduledComposerState(entry, { isGM: true });
ok(st.attachments.length === 1 && st.attachments[0].itemUuid === 'u', 'attachments return, without a stale eddies card');
ok(st.eddiesAmount === 200 && st.eddiesNotRestored === 0, 'the per-person eddies return when they were paid');
ok(st.encryption.type === 'RED_ICE' && st.encryption.dv === 18 && st.encryption.iceActorId === 'ice' && st.encryption.bypassSkills[0] === 'Interface', 'encryption and its ICE return');
ok(st.selfDestructMode === '1h' && st.scheduledTime === later && st.scheduleGameTime === true, 'self-destruct and the delivery time return');
ok(st.anonymous.alias === 'NOBODY' && st.anonymous.allowReplies === false && st.sendNetworkId === 'NET', 'GM: anonymous and send-via return');
const stP = scheduledComposerState(entry, { isGM: false });
ok(stP.anonymous === null && stP.sendNetworkId === null, 'a player never gets GM-only settings');
ok(scheduledComposerState({ messageData: { eddies: 70 } }).eddiesNotRestored === 70 && scheduledComposerState({ messageData: { eddies: 70 } }).eddiesAmount === 0, 'an entry with no record of payment is not charged twice, and says so');
ok(scheduledComposerState({ messageData: {} }).encryption === null, 'a plain message stays plain');

const compSrc = src('scripts/ui/MessageComposer/MessageComposerApp.js');
const grabC = (name) => {
  const at = compSrc.indexOf(`\n  ${name}(`); const open = compSrc.indexOf('{', compSrc.indexOf(')', at));
  let d = 0, i = open; for (; i < compSrc.length; i++) { if (compSrc[i] === '{') d++; if (compSrc[i] === '}' && --d === 0) break; }
  return compSrc.slice(at, i + 1);
};
const Comp = new Function('getAvatarColor', `return class C { recipients = []; attachments = []; eddiesAmount = 0; ${grabC('_applyScheduled')} }`)(() => '#000');
const c = new Comp(); c._applyScheduled(st);
ok(c.eddiesAmount === 200 && c.attachments.length === 2 && c.attachments.filter((a) => a.isEddies).length === 1, 'the composer shows the eddies card once');
ok(c.encryptionEnabled && c.selfDestructEnabled && c.anonymousEnabled && c.scheduleEnabled, 'every drawer comes back switched on');
const c2 = new Comp(); c2._applyScheduled(scheduledComposerState({ messageData: { anonReply: { alias: 'GHOST', parentMessageId: 'm' } } }));
ok(c2.anonReplyTo?.parentMessageId === 'm' && c2.recipients[0]?.isAnonTarget && c2.recipients[0].locked, 'an anonymous reply keeps its locked masked chip');
ok(/_preTickAnonThread\(\);[\s\S]{0,160}_applyScheduled\(options\.scheduled\)/.test(compSrc), 'applied after the anonymous defaults, which would overwrite it');
ok(/eddiesHeld: this\.fromActorId \? this\.eddiesAmount \* Math\.max\(1, sendList\.length\) : 0/.test(compSrc), 'scheduling records exactly what the send path debited');
ok(/scheduled: options\.scheduled \?\? null/.test(src('scripts/init/registerMessagingSystem.js')), 'the launcher forwards it');
ok(/recipients: msgData\.anonReply \? \[\]/.test(viewerSrc), 'an anonymous reply passes no visible recipient');

// ═══ 8. A timed self-destruct counts from arrival ═══
const t0 = Date.parse('2045-01-01T12:00:00Z');
ok(selfDestructAtDelivery({ mode: '1h', duration: 3600000, expiresAt: 'old' }, t0).expiresAt === '2045-01-01T13:00:00.000Z', 'one hour from delivery, not from scheduling');
ok(selfDestructAtDelivery({ mode: 'after_read', duration: null, expiresAt: null }, t0).expiresAt === null, 'after-read untouched');
game.user.isGM = true; game.users.activeGM = { id: 'P' };
const delivered = []; game.nightcity.messageService = { sendMessage: async (d) => { delivered.push(d); return { success: true }; } };
game.nightcity.timeService = { getCurrentTime: () => new Date(t0).toISOString() };
await new SchedulingService()._deliverScheduled({ scheduleId: 'x', useGameTime: true, deliveryTime: 'd', messageData: { toActorId: 'pc', selfDestruct: { mode: '1h', duration: 3600000, expiresAt: '2044-01-01T00:00:00.000Z' } } });
ok(delivered[0].selfDestruct.expiresAt === '2045-01-01T13:00:00.000Z', 'the real delivery path restamps it on the game clock');

// ═══ 9. The migration ═══
let mig = creditOldScheduled([
  { messageData: { eddies: 100, fromActorId: 'pc', recipients: [{}, {}, {}] } },
  { messageData: { eddies: 100, fromActorId: 'pc', toActorId: 'x' } },
  { messageData: { eddies: 100, fromActorId: 'pc', toActorId: ['x', 'y'] } },
  { messageData: { eddies: 100, fromContactId: 'c' } },
  { messageData: { fromActorId: 'pc' } },
  { eddiesHeld: 0, messageData: { eddies: 100, fromActorId: 'pc' } },
  { eddiesHeld: 40, messageData: { eddies: 100, fromActorId: 'pc' } },
]);
ok(mig.list.map((e) => e.eddiesHeld).join() === '300,100,200,,,0,40' && mig.changed === 3, 'old entries get eddies × recipients; no character, no eddies or a recorded figure are left alone');
ok(creditOldScheduled(mig.list).changed === 0, 'running it twice changes nothing');
const mrSrc = src('scripts/core/MigrationRunner.js');
ok(/DATA_SCHEMA_VERSION = 5;/.test(mrSrc) && mrSrc.includes('to: 5,') && mrSrc.includes('_loadScheduled'), 'migration v5 is registered and refreshes the running service');

// ═══ 10. Refused at delivery ═══
const rig = (sendResult) => {
  const failures = [];
  game.nightcity.messageService = {
    sendMessage: async () => sendResult, playerFacingError: (e) => e,
    recordDeliveryFailure: async (r) => { failures.push(r); },
  };
  const svc = new SchedulingService();
  let saves = 0; svc._persistScheduled = async () => { saves++; };
  return { svc, failures, saves: () => saves };
};
game.users.get = () => ({ id: 'P', isGM: true });
game.user.isGM = true; game.user.id = 'G'; game.users.activeGM = { id: 'G' };
const dueTime = '2020-01-01T00:00:00.000Z';
toasts.length = 0;
pcA = wallet(); actors.set('pc', pcA);
let R = rig({ success: false, error: 'Contact not found', errorCode: 'CONTACT_NOT_FOUND' });
R.svc._scheduled = [{ scheduleId: 'a', status: 'pending', useGameTime: true, deliveryTime: dueTime, eddiesHeld: 300, messageData: { fromActorId: 'pc', toActorId: 'pc', subject: 'x', eddies: 300 } }];
await R.svc._checkAndDeliver();
ok(R.svc.getPending().length === 0 && R.saves() === 1, 'refused: it leaves the schedule and the save happens');
ok(pcA.system.wealth.value === 400, 'refused: all its eddies go back');
ok(R.failures.length === 1 && R.failures[0].data.toName === 'V' && R.failures[0].source === 'scheduled', 'refused: listed under Didn\'t arrive, with a name');
ok(toasts.some((t) => /not delivered/.test(t) && /300 eb refunded/.test(t)), 'refused: the GM is told, and told about the refund');
await R.svc._checkAndDeliver();
ok(R.failures.length === 1 && pcA.system.wealth.value === 400, 'no retry loop and no second refund');

pcA = wallet(); actors.set('pc', pcA);
R = rig({ success: false, error: 'No recipient could be reached', errorCode: 'ALL_RECIPIENTS_FAILED', failed: [{ name: 'A', error: 'x' }, { name: 'B', error: 'y' }] });
R.svc._scheduled = [{ scheduleId: 'b', status: 'pending', useGameTime: true, deliveryTime: dueTime, eddiesHeld: 200, messageData: { fromActorId: 'pc', subject: 'x', eddies: 100, recipients: [{ name: 'A' }, { name: 'B' }] } }];
await R.svc._checkAndDeliver();
ok(R.failures.length === 0 && pcA.system.wealth.value === 300, 'everyone refused: the full refund, and MessageService\'s own listing is not doubled');

pcA = wallet(); actors.set('pc', pcA);
R = rig({ success: true, failed: [{ name: 'B', error: 'gone' }] });
R.svc._scheduled = [{ scheduleId: 'c', status: 'pending', useGameTime: true, deliveryTime: dueTime, eddiesHeld: 300, messageData: { fromActorId: 'pc', subject: 'x', eddies: 100, recipients: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] } }];
await R.svc._checkAndDeliver();
ok(pcA.system.wealth.value === 200 && R.svc.getPending().length === 0, 'one of three refused: only that share comes back');

pcA = wallet(); actors.set('pc', pcA);
R = rig({ success: true });
R.svc._scheduled = [{ scheduleId: 'd', status: 'pending', useGameTime: true, deliveryTime: dueTime, eddiesHeld: 100, messageData: { fromActorId: 'pc', toActorId: 'npc', subject: 'x', eddies: 100 } }];
await R.svc._checkAndDeliver();
ok(pcA.system.wealth.value === 100, 'a clean delivery refunds nothing');
game.nightcity.messageService = { sendMessage: async () => { throw new Error('boom'); } };
const thrown = new SchedulingService(); thrown._persistScheduled = async () => {};
thrown._scheduled = [{ scheduleId: 'e', status: 'pending', useGameTime: true, deliveryTime: dueTime, messageData: { fromActorId: 'pc', toActorId: 'npc' } }];
const origErr = console.error; console.error = () => {};
await thrown._checkAndDeliver();
console.error = origErr;
ok(thrown.getPending().length === 1, 'an exception stays pending');
ok(/r\?\.refused/.test(tabSrc), 'Send now saves a refused message too');
ok(/constructor\?\.playerFacingError/.test(src('scripts/services/SchedulingService.js')) && /static playerFacingError/.test(svcSrc), 'the player sees the translated reason (the method is static)');

// ═══ 11. A stale list can't refund delivered mail ═══
game.user.isGM = false; game.user.id = 'P';
let hook = null; const realOn = Hooks.on; Hooks.on = (k, f) => { if (k === 'updateSetting') hook = f; };
game.nightcity.settingsManager = { get: () => [], set: async () => {} };
const stale = new SchedulingService(); stale._registerSettingSync();
Hooks.on = realOn;
stale._scheduled = [{ scheduleId: 's', status: 'pending', eddiesHeld: 100, messageData: { fromActorId: 'pc' } }];
hook({ key: 'night-city-messenger.scheduledMessages' });
ok(stale.getPending().length === 0, 'a player\'s list follows the saved one');
ok((await stale.cancelScheduled('s')).success === false, 'nothing left to refund');
stale._scheduled = [{ scheduleId: 't', status: 'pending', eddiesHeld: 100, messageData: { fromActorId: 'pc' } }];
hook({ key: 'night-city-messenger.other' });
ok(stale.getPending().length === 1, 'other settings leave the list alone');
const gmWas = game.users.activeGM; game.users.activeGM = null;
pcA = wallet(); actors.set('pc', pcA);
ok((await stale.cancelScheduled('t')).success === false && stale.getPending().length === 1 && pcA.system.wealth.value === 100, 'no GM online: a player can\'t cancel, so it can\'t refund then come back');
game.users.activeGM = gmWas;

// ═══ 12. A terminal send reopens as a terminal send ═══
const tsSrc = src('scripts/services/TerminalService.js');
const at = tsSrc.indexOf('\n  reopenScheduledSend('); const open = tsSrc.indexOf('{', tsSrc.indexOf(')', at));
let dp = 0, ip = open; for (; ip < tsSrc.length; ip++) { if (tsSrc[ip] === '{') dp++; if (tsSrc[ip] === '}' && --dp === 0) break; }
const TS = new Function(`return class T {${tsSrc.slice(at, ip + 1)}}`)();
const ts = new TS();
ts.verifyAccountSend = () => ({ ok: true, item: { name: 'WS-7F' } }); ts.accountSendIdentity = () => ({ username: 'kowalski' }); ts.accountAddressBook = () => [{ email: 'a@b.c' }];
let re = ts.reopenScheduledSend({ terminalSend: { itemUuid: 'u', accountId: 'a' }, sentVia: { machine: 'WS-12', account: 'rache', operatorId: 'o', operatorName: 'Op', impersonated: true } });
ok(re.ok && re.terminalSend.machine === 'WS-12' && re.terminalSend.username === 'rache' && re.terminalSend.own === false && re.addressBook.length === 1, 'an impersonation stays an impersonation, with its machine and address book');
re = ts.reopenScheduledSend({ terminalSend: { itemUuid: 'u', accountId: 'a' }, sentVia: { impersonated: false } });
ok(re.terminalSend.own === true && re.terminalSend.machine === 'WS-7F' && re.terminalSend.username === 'kowalski', 'your own account stays yours; missing details come from the machine');
ts.verifyAccountSend = () => ({ ok: false, reason: 'this terminal does not allow sending as its accounts' });
ok(ts.reopenScheduledSend({ terminalSend: {} }).reason.includes('does not allow'), 'a machine that can no longer send says why');
const vNow = src('scripts/ui/MessageViewer/MessageViewerApp.js');
ok(vNow.indexOf('reopenScheduledSend') < vNow.indexOf('This will <strong>cancel the scheduled delivery'), 'the check runs before anything is cancelled');
ok(/terminalSend: viaTerminal\.terminalSend, addressBook: viaTerminal\.addressBook/.test(vNow), 'Edit passes them to the composer');

console.log(`${pass} passed, ${fail} failed`);

process.exit(fail ? 1 : 0);
