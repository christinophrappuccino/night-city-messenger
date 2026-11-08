// Sim: tester round 2026-11-08 (Save from a call, then Add from their mail, made two contacts; the line-type
// dropdown promised a name to everyone). Drives the REAL module code with mocked globals:
//   1. the call log hands Save the caller's link (contact / actor), never for a masked caller or a line that is
//      not its holder (burner, business, payphone)
//   2. the message viewer finds a number-only contact as the sender (by that link, or by the sender's own line),
//      keeps Add showing, and Add fills the email into that contact instead of making a second one
//   3. the Standard type's dropdown says the name shows only to people who saved them
//   node dev/tools/sims/test-tester-round-2026-11-08.mjs
import fs from 'fs';
import { pathToFileURL, fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
const read = (p) => fs.readFileSync(`${ROOT}/${p}`, 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.error('FAIL:', m)); };

globalThis.game = { user: { id: 'u1', isGM: false }, users: { get: () => null, activeGM: null }, settings: { get: () => undefined }, actors: { get: () => null }, journal: [], nightcity: {} };
globalThis.foundry = {
  utils: { deepClone: (o) => JSON.parse(JSON.stringify(o)), mergeObject: (a, b) => ({ ...a, ...b }), randomID: () => 'r' },
  applications: { api: { ApplicationV2: class { static DEFAULT_OPTIONS = {}; }, HandlebarsApplicationMixin: (B) => class extends B {} } },
};
globalThis.Hooks = { on() { return 1; }, off() {}, once() {}, callAll() {} };
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
globalThis.CONFIG = {};
globalThis.Handlebars = { escapeExpression: (s) => String(s ?? ''), registerHelper() {} };

const PN = await imp('scripts/utils/phoneNumbering.js');
const ctx = PN.defaultNumberContext();
const row = ctx.rows.find((r) => r.Code === 'WAT');
const mainNo = PN.numberAt(row, '0111'), burnerNo = PN.numberAt(row, '0612'), pcNo = PN.numberAt(row, '0222'), extraNo = PN.numberAt(row, '0333');
const LINES = {
  [PN.normaliseNumber(mainNo, ctx)]: { number: mainNo, kind: 'main', owner: { contactId: 'dex', name: 'Dex' } },
  [PN.normaliseNumber(burnerNo, ctx)]: { number: burnerNo, kind: 'burner', owner: { contactId: 'dex', name: 'Dex' } },
  [PN.normaliseNumber(extraNo, ctx)]: { number: extraNo, kind: 'extra', owner: { contactId: 'dex', name: 'Dex' } },
  [PN.normaliseNumber(pcNo, ctx)]: { number: pcNo, owner: { actorId: 'pc2', name: 'Rogue' } },
};
game.nightcity.callService = { get homeCode() { return ctx; }, get numberContext() { return ctx; }, line: (n) => LINES[PN.normaliseNumber(n, ctx)] || null };

// ═══ 1. the call log's Save carries the link ═══
const T = await imp('scripts/ui/MessageViewer/callsTab.js');
let o = T.shownOther({ other: { number: mainNo, name: 'Dex', contactId: 'dex' } }, [], ctx, []);
ok(o.linkContact === 'dex' && o.linkActor === '' && !o.offerName, 'a stranger on a Standard line: number only on screen, but Save keeps who it is');
o = T.shownOther({ other: { number: pcNo, name: 'Rogue', actorId: 'pc2' } }, [], ctx, []);
ok(o.linkActor === 'pc2' && o.linkContact === '', 'a character calling from their own line: Save keeps the character');
o = T.shownOther({ other: { number: burnerNo, name: '', contactId: 'dex', asLine: true, showOnly: 'number' } }, [], ctx, []);
ok(!o.linkContact && !o.linkActor, 'a burner (a line that is not its holder): no link');
o = T.shownOther({ other: { name: 'Unknown caller', anon: true, contactId: 'dex' } }, [], ctx, []);
ok(!o.linkContact && !o.linkActor, 'a withheld caller: no link');
const tpl = read('templates/message-viewer/partials/calls-tab.hbs');
ok(/data-action="calls-savenum"[^>]*data-link-contact="\{\{other\.linkContact\}\}" data-link-actor="\{\{other\.linkActor\}\}"/.test(tpl), 'the Save button carries the link');
const ctab = read('scripts/ui/MessageViewer/callsTab.js');
ok(/masterContactId: target\.dataset\.linkContact \|\| null, actorId: target\.dataset\.linkActor \|\| null/.test(ctab) && /phone: num, tags: \[\], \.\.\.link/.test(ctab), 'Save stores the link on the new contact');

// ═══ 2. the message viewer ═══
const { MessageViewerApp } = await imp('scripts/ui/MessageViewer/MessageViewerApp.js');
const viewer = (contacts) => { const v = Object.create(MessageViewerApp.prototype); v._cachedContacts = contacts; return v; };
const find = (contacts, msg) => viewer(contacts)._phoneOnlyContactFor(msg, msg.fromContactId ? { id: msg.fromContactId, actorId: null } : null);
const stub = { id: 'k1', name: 'Fixer guy', email: '', phone: mainNo };
ok(find([stub], { fromContactId: 'dex', from: 'dex@x.net' }) === stub, 'a contact saved before the fix (no link): found by the sender\'s own line');
ok(find([{ ...stub, phone: burnerNo }], { fromContactId: 'dex', from: 'dex@x.net' }) === null, 'a number-only contact on their BURNER is never tied to their mail');
ok(find([{ ...stub, phone: extraNo }], { fromContactId: 'dex', from: 'dex@x.net' }) === null, 'nor one on an extra line');
ok(find([{ ...stub, email: 'other@x.net' }], { fromContactId: 'dex', from: 'dex@x.net' }) === null, 'a contact that already has an email is not a number-only stub');
ok(find([{ ...stub, phone: pcNo }], { fromActorId: 'pc2', from: 'rogue@x.net' })?.id === 'k1', 'a character\'s own line matches mail from that character');
ok(find([stub], { fromContactId: 'someone-else', from: 's@x.net' }) === null, 'someone else\'s mail does not match');
const mv = read('scripts/ui/MessageViewer/MessageViewerApp.js');
ok(/const byPhone = this\._phoneOnlyContactFor\(msg, entry\);/.test(mv), '_findSenderContact looks for the number-only contact');
ok(/const senderIsContact = !!contact && !!contact\.email;/.test(mv), 'Add stays on mail from a contact that has no email yet');
ok(/if \(existing && !existing\.email\) return this\._addEmailToContact\(existing, msg\);/.test(mv), 'Add on such mail fills that contact in');

// Add fills in the email on the existing contact (no second contact)
let updated = null, added = null;
const v = viewer([stub]);
Object.assign(v, {
  actorId: 'pc1', render() {}, _refreshContactCache: async () => {}, _findContact: () => null,
  _senderToAdd: () => ({ entry: { id: 'dex' }, email: 'dex@x.net', isAlias: false }),
});
Object.defineProperty(v, 'contactRepository', { value: { updateContact: async (a, id, u) => { updated = { a, id, u }; return { success: true }; }, addContact: async () => { added = true; return { success: true }; } } });
Object.defineProperty(v, 'soundService', { value: null });
await v._addEmailToContact(stub, { from: 'dex@x.net', fromContactId: 'dex', network: 'CITINET' });
ok(updated?.id === 'k1' && updated.u.email === 'dex@x.net' && updated.u.masterContactId === 'dex' && !added, 'Add puts the email (and the link) on the existing contact; no second contact');
ok(!('name' in (updated?.u || {})), 'the player\'s own name for them is kept');

const repo = read('scripts/data/ContactRepository.js');
ok(/updates\.masterContactId = verification\.masterContactId \|\| updates\.masterContactId \|\| null;/.test(repo), 'an email change keeps a link the caller passed');

// ═══ 3. the dropdown says what it does ═══
const pnv = read('scripts/ui/AdminPanel/tabs/phoneNumbersView.js');
ok(pnv.includes("owner: ['Their name, only if saved', 'People who have them saved see their name and picture. Everyone else sees only the number."), 'the saved-only option says so');
ok(pnv.includes("ownerOrg: ['Their name, to everyone', 'Everyone sees their name and picture, saved or not.") && pnv.includes('or the district of the number when they have none'), 'the show-to-everyone option says so, and names the district fallback');
ok(pnv.includes("dead: ['The number only', 'A Trace finds the number, never a name']") && pnv.includes("owner: ['Who holds it',"), 'the trace choices say what a trace finds');
const guide = read('docs/GETTING-STARTED.md');
ok(guide.includes('**Their name, to everyone**') && guide.includes("**People who don't have them saved still see their picture**") && !guide.includes('Show their picture to strangers'), 'the guide uses the editor\'s own words');

console.log(`test-tester-round-2026-11-08: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
