// Sim: SEND AS A TERMINAL ACCOUNT (2026-10-26, dev: "if I hack into a computer
// I can log into so-and-so's account and email people on their contacts").
// Drives the REAL TerminalService (identity, address book, GM verification),
// MessageService.handleMessageRelay (refuses a bad relay without delivering)
// and TerminalViewerApp._composeAsContext, plus wiring guards.
// Run: node dev/tools/sims/test-terminal-send-as.mjs
import fs from 'fs';
import { pathToFileURL, fileURLToPath } from 'url';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const MOD = 'night-city-messenger';
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };
const read = (p) => fs.readFileSync(`${ROOT}/${p}`, 'utf8');
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
const deepClone = (o) => (o === undefined ? o : JSON.parse(JSON.stringify(o)));

const visibleActors = { pc: { id: 'pc', name: 'Rache' } };   // the NPC 'npc1' is NOT visible to this client
globalThis.game = { user: { isGM: true }, users: { activeGM: {}, get: () => null }, settings: { get: () => undefined }, nightcity: {}, actors: { get: (id) => visibleActors[id] || null }, journal: { contents: [] } };
globalThis.foundry = { utils: { deepClone, mergeObject: (a, b, { inplace = true } = {}) => { const out = inplace ? a : deepClone(a); const m = (t, s) => { for (const [k, v] of Object.entries(s || {})) { if (v && typeof v === 'object' && !Array.isArray(v) && t[k] && typeof t[k] === 'object' && !Array.isArray(t[k])) m(t[k], v); else t[k] = v; } return t; }; return m(out, b); }, randomID: () => 'rid' } };
globalThis.Hooks = { on: () => {}, once: () => {}, off: () => {}, call: () => true, callAll: () => {} };
globalThis.ui = { notifications: { info: () => {}, warn: () => {}, error: () => {} } };

// directory: Marisol (linked to NPC npc1) + her burner alias + two correspondents
const contacts = [
  { id: 'mr', name: 'Marisol Reyes', email: 'm.reyes@arasaka.corp', actorId: 'npc1', primaryIdentity: true },
  { id: 'mrb', name: 'Burner', email: 'ghost@darknet', actorId: 'npc1' },
  { id: 'tk', name: 'Takeda, M.', email: 'takeda@arasaka.corp' },
  { id: 'hr', name: 'Arasaka HR', email: 'hr@arasaka.corp' },
];
const I = await imp('scripts/utils/identities.js');
game.nightcity.masterContactService = {
  getAll: () => contacts,
  getContact: (id) => contacts.find((c) => c.id === id) || null,
  getByEmail: (e) => contacts.find((c) => c.email.toLowerCase() === String(e || '').trim().toLowerCase()) || null,
  getByActorId: (a) => I.primaryOf(contacts, a),
  identitiesForContact: (id) => I.identitiesOfContact(contacts, contacts.find((c) => c.id === id)),
};
game.nightcity.messageRepository = { _pageToMessage: (p) => deepClone(p.flags[MOD]) };

// ═══ 1. TerminalService ═══
const { TerminalService } = await imp('scripts/services/TerminalService.js');
const page = (id, accountId, f) => ({ flags: { [MOD]: { messageId: id, accountId, status: {}, timestamp: '2045-01-01T00:00:00Z', ...f } } });
const pages = [
  page('a', 'mr', { from: 'hr@arasaka.corp', subject: 'Q3' }),
  page('b', 'mr', { from: 'HR@arasaka.corp', subject: 'Q3 again' }),
  page('c', 'mr', { from: 'unknown@street.nc', subject: 'hey' }),
  page('d', 'mr', { to: 'takeda@arasaka.corp, hr@arasaka.corp', folder: 'sent', subject: 're' }),
  page('e', 'mr', { from: 'ghost@darknet', subject: 'note to self' }),            // her own alias — not a contact
  page('f', 'mr', { envelope: 'file', from: 'SEC-DAEMON', file: { path: '' } }),  // a file — never an address
  page('g', 'other', { from: 'nobody@x.nc' }),
  page('h', '__shared__', { from: 'shared@x.nc' }),
];
let cfg = { accounts: [{ id: 'mr', username: 'mreyes', masterContactId: 'mr', actorId: 'npc1' }, { id: 'bare', username: 'kiosk' }, { id: 'ao', username: 'actoronly', actorId: 'npc9' }], accountMail: { compose: true, log: true } };
const item = { id: 'term', uuid: 'Item.term', name: 'WS', getFlag: (_, k) => (k === 'terminalConfig' ? cfg : k === 'terminalState' ? {} : k === 'isTerminal' ? true : null) };
const svc = Object.create(TerminalService.prototype);
Object.defineProperty(svc, 'messageRepository', { value: game.nightcity.messageRepository });
svc._getLinkedJournal = () => ({ pages: { contents: pages } });
svc.isContentVisible = () => true;
svc.isTerminal = () => true;

const id = svc.accountSendIdentity(item, 'mr');
ok(id.fromContactId === 'mr' && id.fromActorId === 'npc1' && id.email === 'm.reyes@arasaka.corp' && id.username === 'mreyes', 'identity = the linked directory contact + character');
ok(svc.accountSendIdentity(item, 'bare') === null, 'an unlinked account has no identity');
ok(svc.canAccountCompose(item, 'mr'), 'switch on + identity → can send');
ok(!svc.canAccountCompose(item, 'bare'), 'no identity → no send');
ok(!svc.canAccountCompose(item, 'ao'), "an account linked only to an NPC this client can't see → no send (no directory contact)");
cfg = { ...cfg, accountMail: { compose: false } };
ok(!svc.canAccountCompose(item, 'mr'), 'GM switch off → no send');
cfg = { ...cfg, accountMail: { compose: true, log: true } };

const book = svc.accountAddressBook(item, 'mr');
const emails = book.map((b) => b.email);
ok(emails.includes('hr@arasaka.corp') && emails.includes('takeda@arasaka.corp') && emails.includes('unknown@street.nc'), 'address book: senders + Sent recipients');
ok(book.find((b) => b.email === 'hr@arasaka.corp').count === 3 && book[0].email === 'hr@arasaka.corp', 'case-insensitive, counted, most-used first');
ok(book.find((b) => b.email === 'hr@arasaka.corp').name === 'Arasaka HR' && book.find((b) => b.email === 'unknown@street.nc').name === 'unknown@street.nc', 'directory names where known, else the address');
ok(!emails.includes('ghost@darknet') && !emails.includes('m.reyes@arasaka.corp'), "her own addresses (every identity) are left out");
ok(!emails.some((e) => /nobody|shared|SEC-DAEMON/i.test(e)), 'other accounts, the shared volume and files are left out');

// GM verification of a relayed send
let v = svc.verifyAccountSend({ terminalSend: { itemUuid: 'Item.term', accountId: 'mr' }, fromContactId: 'mr', fromActorId: 'npc1' });
globalThis.fromUuidSync = (u) => (u === 'Item.term' ? item : null);
v = svc.verifyAccountSend({ terminalSend: { itemUuid: 'Item.term', accountId: 'mr' }, fromContactId: 'mr', fromActorId: 'npc1' });
ok(v.ok, 'a genuine send-as passes');
ok(svc.verifyAccountSend({ terminalSend: { itemUuid: 'Item.term', accountId: 'mr' }, fromContactId: 'mrb', fromActorId: 'npc1' }).ok, "sending as one of the owner's aliases passes");
ok(!svc.verifyAccountSend({ terminalSend: { itemUuid: 'Item.term', accountId: 'mr' }, fromContactId: 'tk' }).ok, 'a tampered sender is refused');
ok(!svc.verifyAccountSend({ terminalSend: { itemUuid: 'Item.term', accountId: 'mr' }, fromContactId: 'mr', fromActorId: 'pc' }).ok, 'a mismatched character is refused');
ok(!svc.verifyAccountSend({ terminalSend: { itemUuid: 'Item.gone', accountId: 'mr' }, fromContactId: 'mr' }).ok, 'an unknown terminal is refused');
cfg = { ...cfg, accountMail: { compose: false } };
ok(/does not allow/.test(svc.verifyAccountSend({ terminalSend: { itemUuid: 'Item.term', accountId: 'mr' }, fromContactId: 'mr' }).reason), 'switch off → refused with the reason');
cfg = { ...cfg, accountMail: { compose: true, log: true } };

// ═══ 2. MessageService.handleMessageRelay refuses without delivering ═══
game.nightcity.terminalService = svc;
const { MessageService } = await imp('scripts/services/MessageService.js');
const ms = Object.create(MessageService.prototype);
let delivered = 0, acked = null;
ms._deliverMessage = async () => { delivered++; return { success: true }; };
Object.defineProperty(ms, 'socketManager', { value: { emit: (op, d) => { acked = d; } } });
globalThis.console.warn = () => {};
await MessageService.prototype.handleMessageRelay.call(ms, { messageId: 'x1', terminalSend: { itemUuid: 'Item.term', accountId: 'mr' }, fromContactId: 'tk' }, 'u1');
ok(delivered === 0 && acked && acked.success === false && /Refused/.test(acked.error || ''), 'a bad send-as relay is refused, acked as failed, never delivered');
await MessageService.prototype.handleMessageRelay.call(ms, { messageId: 'x2', terminalSend: { itemUuid: 'Item.term', accountId: 'mr' }, fromContactId: 'mr', fromActorId: 'npc1' }, 'u1');
ok(delivered === 1 && acked.success === true, 'a genuine one is delivered');
await MessageService.prototype.handleMessageRelay.call(ms, { messageId: 'x3' }, 'u1');
ok(delivered === 2, 'ordinary relays are untouched');

// ═══ 3. Viewer context ═══
globalThis.foundry.applications = { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (B) => class extends B {} } };
const { TerminalViewerApp: V } = await imp('scripts/ui/Terminal/TerminalViewerApp.js');
const view = Object.create(V.prototype);
Object.defineProperty(view, 'terminalService', { value: svc });
view.item = item; view._accountId = 'mr'; view._viewAs = null; view._effectiveConfig = () => svc.getConfig(item);
ok(V.prototype._composeAsContext.call(view)?.username === 'mreyes', 'WRITE offered on a compose-enabled account');
view._accountId = 'bare';
ok(V.prototype._composeAsContext.call(view) === null, 'not on an account with no identity');
cfg = { ...cfg, accounts: [...cfg.accounts, { id: 'root', username: 'root', isAdmin: true }], adminAccess: { rights: 'read' } };
view._accountId = 'root'; view._viewAs = 'mr';
ok(V.prototype._composeAsContext.call(view) === null, 'read-only admin viewing cannot send');
cfg = { ...cfg, adminAccess: { rights: 'full' } };
ok(V.prototype._composeAsContext.call(view)?.username === 'mreyes', 'full-rights admin viewing sends as the viewed account');

// ═══ 4. Wiring ═══
const viewer = read('scripts/ui/Terminal/TerminalViewerApp.js');
for (const a of ['terminalComposeAs', 'terminalReplyAs']) ok(new RegExp(`${a}: action\\(`).test(viewer), `action ${a}`);
ok(/lower === 'write'/.test(viewer) && /lower === 'reply'/.test(viewer), 'TTY write / reply');
ok(/composeAs/.test(read('templates/terminal/terminal-viewer.hbs')) && /terminalReplyAs/.test(read('templates/terminal/mailbox/detail.hbs')), 'WRITE in the HUD (every layout) + Reply as on mail');
const launch = read('scripts/init/registerMessagingSystem.js');
ok(/if \(options\.terminalSend\)/.test(launch) && /terminalSend: options\.terminalSend \?\? null/.test(launch) && /addressBook: options\.addressBook \?\? null/.test(launch), 'launcher passes a terminal send through without owner resolution');
const cmp = read('scripts/ui/MessageComposer/MessageComposerApp.js');
ok(/if \(this\.terminalSend\) \{\s*\/\/ The account's own address book/.test(cmp), 'composer To search = the address book');
ok(/their money isn't yours/.test(cmp), 'writing as someone else explains why there are no eddies');
ok(/messageData\.terminalSend = \{ itemUuid/.test(cmp) && /_logTerminalSend\(\)/.test(cmp), 'composer sends the terminal marker + logs');
ok(/canSwitchFrom: \(isGM \|\| sendChoices\.length > 1\) && !this\.terminalSend/.test(cmp) && /canSwitchFrom/.test(read('templates/message-composer/message-composer.hbs')), 'sender locked (no Send-as switcher)');
const cfgHbs = read('templates/terminal/terminal-config.hbs');
ok(/name="acctMailCompose"/.test(cfgHbs) && /v\('acctMailCompose'\) \? \{ accountMail:/.test(read('scripts/ui/Terminal/TerminalConfigApp.js')), 'GM switch saves (only when on screen)');
// Your OWN account (you own its character) is your own mail, not an impersonation.
ok(/const own = !isGM\(\) && !!ownerActor\?\.isOwner;/.test(viewer) && /operatorName: op\?\.name/.test(viewer), 'viewer marks an owned account + who is typing');
ok(/eddies: \(this\.terminalSend && !this\.terminalSend\.own\) \? 0/.test(cmp) && /this\.terminalSend && !this\.terminalSend\.own\) return ui\.notifications\.warn/.test(cmp), 'eddies work on your own account, never as someone else');
ok(/if \(this\.terminalSend && !this\.terminalSend\.own\) this\._logTerminalSend\(\)/.test(cmp), 'your own sends are not logged as intrusions');
ok(/impersonated: !this\.terminalSend\.own/.test(cmp), 'every terminal send records sentVia');
const repo = read('scripts/data/MessageRepository.js');
ok(/sentVia: \(messageData\.status\?\.sent && messageData\.sentVia\) \? messageData\.sentVia : null/.test(repo), "sentVia is persisted on the SENDER's sent copy only — never the recipient's");
ok(/sentVia: flags\.sentVia \|\| null/.test(repo), 'sentVia reads back');
ok(/flags\.sentVia \?/.test(read('scripts/ui/AdminPanel/tabs/MessagesTab.js')) && /typed by <b>\{\{via\.typist\}\}<\/b>/.test(read('templates/admin-panel/tab-messages.hbs')) && /flag\('typed', e\.sentVia\.typist\)/.test(read('scripts/ui/AdminPanel/tabs/MessagesTab.js')), 'GM feed (All mail row flag + reading pane) shows the machine + the real typist');
ok(/terminalSend\.impersonating/.test(read('templates/message-composer/message-composer.hbs')) && /impersonating: !this\.terminalSend\.own/.test(cmp), 'eddies button hidden only when impersonating');


{ const mtSrc = read('scripts/ui/AdminPanel/tabs/MessagesTab.js');
  ok(mtSrc.includes("viaByBase.set(e.messageId.slice(0, -5), e.sentVia)") && mtSrc.includes("if (!e.sentVia && viaByBase.has(e.messageId)) e.sentVia = viaByBase.get(e.messageId)"), "GM feed lends the sent copy's sentVia to the matching RECEIVED row"); }

{ const mtSrc = read('scripts/ui/AdminPanel/tabs/MessagesTab.js');
  ok(mtSrc.includes('const viaByBase = this._sentViaIndex();') && mtSrc.includes('!!fromActor?.hasPlayerOwner || !!via?.impersonated') && mtSrc.includes('sentVia: via,'), 'NPC Inbox: impersonations count as player mail and carry the note');
  ok(mtSrc.includes("senderName: fromActor?.name ||"), 'NPC Inbox: a sender with no visible character no longer throws');
  // The NPC Inbox panel became Messages → Needs a reply (2026-10-27): the conversation flags the typist and explains it.
  ok(read('templates/admin-panel/tab-messages.hbs').split(String.fromCharCode(10)).some((l) => l.includes('typedNotes') && l.includes('typed by {{typist}}')), 'Needs a reply shows the note'); }

const C = await imp('scripts/utils/constants.js');
ok(C.DEFAULTS.TERMINAL_CONFIG.accountMail.compose === false && C.DEFAULTS.TERMINAL_CONFIG.accountMail.log === true, 'defaults: off, logging on');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
