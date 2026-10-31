// Sim: a player sends from their aliases, the GM isn't asked for email setup, the player guide opens (2026-10-31,
// testers: "players can't figure out how to send with their alias", "Open Mailbox wants me to set up email").
// Drives the pure rules, the REAL MasterContactService / EmailService / composer + viewer methods via prototype.call,
// the REAL templates through Handlebars, and the guide wiring.
// Run: node dev/tools/sims/test-player-identities.mjs
import fs from 'fs';
import { createRequire } from 'module';
import { pathToFileURL, fileURLToPath } from 'url';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };
const read = (p) => fs.readFileSync(`${ROOT}/${p}`, 'utf8');
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);

const MID = 'night-city-messenger';
const flagged = (flags) => ({
  flags,
  getFlag(_m, k) { return this.flags[k]; },
  async setFlag(_m, k, v) { this.flags[k] = v; },
  async unsetFlag(_m, k) { delete this.flags[k]; },
});
const actor = (id, name, flags = {}, extra = {}) => ({ id, name, img: `${id}.png`, isOwner: true, hasPlayerOwner: true, ...flagged(flags), ...extra });
const actors = {};
globalThis.game = {
  user: { isGM: false }, users: { activeGM: {} }, settings: { get: () => undefined }, nightcity: {},
  actors: { get: (id) => actors[id] || null, find: () => null, filter: () => [] }, journal: { contents: [] },
};
globalThis.foundry = { utils: { deepClone: (o) => JSON.parse(JSON.stringify(o)), randomID: () => 'x', mergeObject: (a, b) => ({ ...a, ...b }) },
  applications: { api: { HandlebarsApplicationMixin: (c) => c, ApplicationV2: class { static DEFAULT_OPTIONS = {}; } } } };
globalThis.Hooks = { on: () => {}, once: () => {}, off: () => {}, call: () => true, callAll: () => {} };
const toasts = [];
globalThis.ui = { notifications: { info: (m) => toasts.push(m), warn: () => {}, error: () => {} } };

// ═══ 1. The pure rules ═══
const I = await imp('scripts/utils/identities.js');
const main = { id: 'c1', name: 'Vee', email: 'vee@nc.net', actorId: 'v' };
const burner = { id: 'c2', name: 'Ghost', email: 'ghost@dark.net', actorId: 'v', portrait: 'ghost.png' };
const other = { id: 'c3', name: 'Rache', email: 'r@nc.net', actorId: 'r' };
const noMail = { id: 'c4', name: 'Blank', email: '', actorId: 'v' };
const C = [burner, main, other, noMail];
let rows = I.senderChoices(C, { actorId: 'v', actorName: 'Vee', registered: 'vee@nc.net' });
ok(rows.map((r) => r.id).join() === 'c1,c2', 'the registered address leads; a contact with no address and other people are left out');
ok(rows[0].isMain && !rows[1].isMain, 'main is marked');
rows = I.senderChoices([burner], { actorId: 'v', actorName: 'Vee', registered: 'vee@nc.net', portrait: 'v.png' });
ok(rows[0].id === null && rows[0].name === 'Vee' && rows[0].email === 'vee@nc.net' && rows[1].id === 'c2', 'a registered address with no directory entry is still the main row, in the character\'s name');
rows = I.senderChoices(C, { actorId: 'v', registered: '', burned: ['vee@nc.net'] });
ok(rows.map((r) => r.email).join() === 'ghost@dark.net', 'a burned address is never offered');
ok(I.senderChoices(C, { actorId: 'nobody' }).length === 0, 'no identities, no choices');
ok(I.senderChoices(C, { actorId: 'v', registered: 'VEE@nc.net ' })[0].id === 'c1', 'the address match ignores case and spaces');
rows = I.senderChoices(C, { actorId: 'v', registered: 'vee@nc.net' });
ok(I.pickSenderChoice(rows, 'c2').id === 'c2', 'a stored alias is picked');
ok(I.pickSenderChoice(rows, 'gone').isMain && I.pickSenderChoice(rows, undefined).isMain, 'a deleted or absent pick falls back to main');
ok(I.pickSenderChoice([], 'c2') === null, 'nothing to pick from');

// ═══ 2. MasterContactService + EmailService ═══
const { MasterContactService } = await imp('scripts/services/MasterContactService.js');
const mcs = Object.create(MasterContactService.prototype);
mcs._contacts = [main, burner, other];
game.nightcity.masterContactService = mcs;
const vee = actors.v = actor('v', 'Vee', { email: 'vee@nc.net', emailSetupComplete: true });
ok(mcs.senderChoicesFor(vee).length === 2 && mcs.senderChoicesFor(null).length === 0, 'senderChoicesFor reads the character');
const burned = actor('v', 'Vee', { emailHistory: [{ email: 'vee@nc.net' }] });
ok(mcs.senderChoicesFor(burned).every((c) => c.email !== 'vee@nc.net'), 'senderChoicesFor reads the burn history');

const { EmailService } = await imp('scripts/services/EmailService.js');
const es = Object.create(EmailService.prototype);
ok(es.hasEmail(actor('a', 'A', { emailSetupComplete: true })), 'hasEmail: finished setup');
ok(es.hasEmail(actor('a', 'A', { email: 'a@x' })), 'hasEmail: an address on the actor, no setup flag (setActorEmail)');
mcs._contacts = [{ id: 'd', name: 'D', email: 'd@x', actorId: 'dir' }];
ok(es.hasEmail(actor('dir', 'D')), 'hasEmail: an address only on the linked directory contact');
ok(!es.hasEmail(actor('dir', 'D', { emailSetupComplete: false, emailHistory: [{ email: 'd@x' }] })), 'hasEmail: a burned address does not count');
ok(!es.hasEmail(actor('none', 'N')), 'hasEmail: nothing anywhere');
ok(!es.hasEmail(null), 'hasEmail: no actor');
mcs._contacts = [main, burner, other];

// ═══ 3. The door that asked the GM ═══
const cs = read('scripts/ui/CharacterSelect/CharacterSelectApp.js');
ok(/if \(!isGM\(\) && actor && emailService\?\.isSetupRequired\(\) && !emailService\.hasEmail\(actor\)\)/.test(cs), 'Character Select: no setup for a GM, and it respects Require Email Setup');

// ═══ 4. The composer (real methods) ═══
globalThis.Application = class {};
const compSrc = read('scripts/ui/MessageComposer/MessageComposerApp.js');
const { MessageComposerApp } = await imp('scripts/ui/MessageComposer/MessageComposerApp.js').catch((e) => { console.error(e); return {}; });
const P = MessageComposerApp?.prototype;
ok(!!P, 'the composer module loads');
const comp = (over = {}) => Object.assign(Object.create(P), { fromActorId: 'v', fromContact: null, terminalSend: null }, over);
let c = comp();
ok(c._senderChoices().length === 2, 'a player gets their own addresses');
ok(comp({ terminalSend: {} })._senderChoices().length === 0, 'never while sending as a terminal account');
game.user.isGM = true;
ok(comp()._senderChoices().length === 0, 'a GM keeps Send-as instead');
game.user.isGM = false;
c = comp(); c._applyDefaultSender();
ok(c.fromContact === null, 'no pick: a new message starts on main');
vee.flags.sendAsContactId = 'c2';
c = comp(); c._applyDefaultSender();
ok(c.fromContact?.id === 'c2' && c.fromContact.email === 'ghost@dark.net', 'the pick sticks: a new message starts on the alias');
c = comp({ fromContact: { id: 'c1' } }); c._applyDefaultSender();
ok(c.fromContact.id === 'c1', 'an explicit sender is not overridden');
vee.flags.sendAsContactId = 'deleted';
c = comp(); c._applyDefaultSender();
ok(c.fromContact === null, 'a deleted alias falls back to main');
delete vee.flags.sendAsContactId;
ok(comp()._mainSenderName() === 'Vee' && comp({ fromContact: { id: 'c2' } })._mainSenderName() === null, 'on main, the name is main\'s');
ok(/this\.mode !== 'reply' && !this\._pendingDraftId\) this\._applyDefaultSender\(\)/.test(compSrc), 'a reply keeps the address the mail reached; a draft keeps its own');
ok(/canSwitchFrom: \(isGM \|\| sendChoices\.length > 1\) && !this\.terminalSend/.test(compSrc), 'the From switcher shows for a player with an alias');
ok(/!game\.user\.isGM && this\._senderChoices\(\)\.length < 2\) return/.test(compSrc), 'the toggle refuses a player with one address');

// The real list, through the real click handler's attributes.
const list = { innerHTML: '' };
c = comp({ element: { querySelector: () => list } });
globalThis.getComputedStyle = () => ({});
c._renderSendAsList();
ok(/ghost@dark\.net/.test(list.innerHTML) && /vee@nc\.net/.test(list.innerHTML) && !/r@nc\.net/.test(list.innerHTML), 'the list holds only this character\'s addresses');
ok(/data-ncm-contact-id=""/.test(list.innerHTML) && /data-ncm-contact-id="c2"/.test(list.innerHTML), 'picking main clears the contact; picking the alias sets it');
ok(/ncm-sendas-item--active[^>]*[\s\S]*?vee@nc\.net/.test(list.innerHTML), 'main is lit by default');

// A draft comes back on the address it was written from (the real _applyDraft).
const draftComp = () => comp({ recipients: [], _resetForDraft() {} });
c = draftComp(); await c._applyDraft({ id: 'd1', fromContactId: 'c2' });
ok(c.fromContact?.id === 'c2', 'a draft restores its alias');
c = draftComp(); c.fromContact = { id: 'c2' }; await c._applyDraft({ id: 'd1', fromContactId: null });
ok(c.fromContact === null, 'a draft written from main ignores the sticky alias');
c = draftComp(); await c._applyDraft({ id: 'd1', fromContactId: 'gone' });
ok(c.fromContact === null, 'a draft whose alias is gone opens on main');

// ═══ 5. The viewer (real methods) ═══
globalThis.Dialog = class {};
const { MessageViewerApp } = await imp('scripts/ui/MessageViewer/MessageViewerApp.js').catch((e) => { console.error(e); return {}; });
const VP = MessageViewerApp?.prototype;
ok(!!VP, 'the viewer module loads');
const view = (actorId = 'v') => Object.assign(Object.create(VP), { actorId });
let vr = view()._sendAsChoices();
ok(vr.length === 2 && vr[0].isActive && vr[0].pickId === '' && vr[1].pickId === 'c2', 'Sending as: main active by default');
actors.solo = actor('solo', 'Solo', { email: 's@x' });
ok(view('solo')._sendAsChoices().length === 0, 'one address: no section');
game.user.isGM = true;
ok(view()._sendAsChoices().length === 0, 'a GM viewing the inbox can\'t change the player\'s default');
game.user.isGM = false;
const rowsDom = [
  { dataset: { contactId: '', email: 'vee@nc.net' }, on: true, classList: { toggle(_c, v) { rowsDom[0].on = v; } } },
  { dataset: { contactId: 'c2', email: 'ghost@dark.net' }, on: false, classList: { toggle(_c, v) { rowsDom[1].on = v; } } },
];
const vv = Object.assign(view(), { element: { querySelectorAll: () => rowsDom } });
await vv._setSendIdentity('c2');
ok(vee.flags.sendAsContactId === 'c2', 'picking an alias stores it on the character');
ok(rowsDom[1].on && !rowsDom[0].on, 'the rows update without a re-render');
ok(toasts.at(-1)?.includes('ghost@dark.net'), 'it says where new mail now goes');
ok(view()._sendAsChoices()[1].isActive, 'the pick is read back');
await vv._setSendIdentity('');
ok(!('sendAsContactId' in vee.flags), 'picking main clears the flag');
vee.isOwner = false;
await vv._setSendIdentity('c2');
ok(!('sendAsContactId' in vee.flags), 'a non-owner can\'t change it');
vee.isOwner = true;

// ═══ 6. The real templates ═══
const require = createRequire(import.meta.url);
let Handlebars = null;
for (const p of [process.env.NCM_HANDLEBARS, 'C:/Program Files/Foundry Virtual Tabletop/resources/app/node_modules/handlebars/dist/cjs/handlebars.js']) {
  try { if (p && fs.existsSync(p)) { const m = require(p); Handlebars = m.default || m; break; } } catch { /* next */ }
}
if (Handlebars) {
  Handlebars.registerHelper('eq', (a, b) => a === b);
  const drawer = Handlebars.compile(read('templates/message-viewer/partials/identity-drawer.hbs'));
  const on = drawer({ viewingAsName: 'Vee', viewingAsEmail: 'vee@nc.net', canChangeIdentity: true, sendAsChoices: view()._sendAsChoices() });
  ok(/Sending as/.test(on) && /data-action="set-send-identity" data-contact-id="c2"/.test(on) && /is-alias/.test(on), 'drawer: Sending as renders with its rows');
  ok(!/Sending as/.test(drawer({ sendAsChoices: [] })), 'drawer: no section with no aliases');
  ok(/fa-fire/.test(on) && !/fa-pen"/.test(on), 'drawer: the burn button is a flame');
  ok(/data-action="open-player-guide"/.test(on), 'drawer: the guide button');
} else {
  console.log('(Handlebars not found: skipped the template renders; set NCM_HANDLEBARS)');
}
const drawerSrc = read('templates/message-viewer/partials/identity-drawer.hbs');
ok(/set-send-identity/.test(drawerSrc) && /open-player-guide/.test(drawerSrc), 'drawer actions in the template');
const cmpHbs = read('templates/message-composer/message-composer.hbs');
ok(/\{\{#if canSwitchFrom\}\}\s*<div class="ncm-composer__sendas-dropdown/.test(cmpHbs), 'the dropdown exists for a player too');
ok(/\{\{else if fromIsAlias\}\}/.test(cmpHbs), 'the ALIAS tag');
const viewerHbs = read('templates/message-viewer/message-viewer.hbs');
ok(/\{\{#unless isGM\}\}\s*<button[^>]*data-action="open-player-guide"/.test(viewerHbs), 'the header ? is for players (the GM header stays at its measured width)');
const viewerSrc = read('scripts/ui/MessageViewer/MessageViewerApp.js');
ok(/case 'set-send-identity'/.test(viewerSrc) && /case 'open-player-guide'/.test(viewerSrc), 'both actions are routed');

// ═══ 7. The guide ═══
const { openGuide } = await imp('scripts/utils/guides.js');
const opened = [];
globalThis.window = { open: (u) => opened.push(u) };
openGuide('player'); openGuide('gm'); openGuide('nope');
ok(opened.length === 2 && opened[0].endsWith('docs/NCM-Player-Guide.pdf') && opened[1].endsWith('docs/NCM-Getting-Started.pdf'), 'openGuide opens the right PDF');
ok(fs.existsSync(`${ROOT}/docs/PLAYER-GUIDE.md`), 'the source exists');
ok(fs.existsSync(`${ROOT}/docs/NCM-Player-Guide.pdf`), 'the PDF is built (node dev/tools/build-guide.cjs)');
const pg = read('docs/PLAYER-GUIDE.md');
for (const m of pg.matchAll(/<!-- fig:\s*([^|]+?)\s*\|/g)) ok(fs.existsSync(`${ROOT}/dev/guide-export/img/${m[1]}`), `figure ${m[1]} exists`);
for (const spoiler of [/honeypot/i, /trojan/i, /disguis/i, /Admin Panel/, /Malware Workshop/, /phone call/i]) ok(!spoiler.test(pg), `the player guide doesn't say ${spoiler}`);
ok(/\bdocs\b/.test(read('.github/workflows/release.yml')), 'docs/ ships in the release zip');

console.log(`test-player-identities: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
