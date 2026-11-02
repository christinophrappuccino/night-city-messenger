/**
 * Phone polish round: Data Drop sends email, number or both; item pickers save; the call row keeps its buttons together;
 * voicemail and the phone contact list can be reached from the Calls tab.
 * node dev/tools/sims/test-phone-round-2026-11-02.mjs
 */
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };

const flags = new Map();
const actor = (id) => ({ id, getFlag: (_, k) => flags.get(id + k), setFlag: async (_, k, v) => { flags.set(id + k, v); } });
globalThis.game = {
  actors: { get: (id) => actor(id), contents: [] }, user: { isGM: true }, settings: { get: () => null },
  nightcity: { callService: { homeCode: { home: { rc: '72', city: 'NC' }, regions: { 72: { cities: { NC: { name: 'Night City', ex: { WAT: { District: 'Watson' } } } } } }, service: {} } } },
};
globalThis.foundry = { utils: { randomID: () => 'new' } };
globalThis.Hooks = { on() {}, once() {}, callAll() {} };

const { ContactShareService: Svc } = await import('../../../scripts/services/ContactShareService.js');
const svc = Object.create(Svc.prototype);
Object.defineProperty(svc, 'portraitService', { value: null });
const full = { id: 'c', name: 'Rogue', email: 'rogue@afterlife.net', phone: '+72 NC WAT-4471', actorId: 'a1', masterContactId: 'm1', notes: 'x' };

// what each choice sends
{
  const both = await svc._prepareShareData(full, { send: 'both' });
  ok(both.email && both.phone, 'both sends both');
  const dflt = await svc._prepareShareData(full, {});
  ok(dflt.email && dflt.phone, 'with no choice it sends both');
  const em = await svc._prepareShareData(full, { send: 'email' });
  ok(em.email && !em.phone, 'just the email leaves the number out');
  const nu = await svc._prepareShareData(full, { send: 'number' });
  ok(!nu.email && nu.phone, 'just the number leaves the address out');
  ok(!nu.actorId && nu.masterContactId === 'm1', 'just the number does not link the character, but keeps who it is');
}

// re-sharing adds the missing part
{
  Object.defineProperty(svc, 'contactRepo', { value: { getContacts: async (id) => flags.get(id + 'contacts') || [] }, configurable: true });
  flags.set('p1contacts', [{ id: 'k', name: 'Rogue', email: 'rogue@afterlife.net', phone: '', masterContactId: 'm1' }]);
  const r = await svc._mergeExisting('p1', { name: 'Rogue', email: '', phone: '+72 NC WAT-4471', masterContactId: 'm1' });
  ok(r?.success && r.merged, 'someone with the contact gets a merge, not a duplicate error');
  ok(flags.get('p1contacts').length === 1 && flags.get('p1contacts')[0].phone === '+72 NC WAT-4471', 'the number lands on the contact they had');
  flags.set('p2contacts', [{ id: 'k', name: 'Rogue', email: '', phone: '+72 NC WAT-4471', masterContactId: 'm1' }]);
  await svc._mergeExisting('p2', { name: 'Rogue', email: 'rogue@afterlife.net', phone: '', masterContactId: 'm1' });
  ok(flags.get('p2contacts')[0].email === 'rogue@afterlife.net' && flags.get('p2contacts')[0].phone, 'an email is added to a number they had, and the number stays');
  flags.set('p3contacts', [{ id: 'k', name: 'Old', email: 'keep@x.net', phone: '', masterContactId: 'm1' }]);
  await svc._mergeExisting('p3', { name: 'Rogue', email: 'other@x.net', phone: '', masterContactId: 'm1' });
  ok(flags.get('p3contacts')[0].email === 'keep@x.net', 'nothing they already have is overwritten');
  flags.set('p4contacts', []);
  ok((await svc._mergeExisting('p4', { name: 'Rogue', email: 'rogue@afterlife.net', phone: '' })) === null, 'someone without it gets a new contact');
}

// one animation per drop
{
  const fx = Object.create(Svc.prototype);
  game.user = { id: 'player', isGM: false };
  ok(fx._wantsShareFx({ shareId: 's1', senderUserId: 'other' }), 'the player receiving it sees the animation');
  ok(!fx._wantsShareFx({ shareId: 's1', senderUserId: 'other' }), 'a share to two of their characters animates once');
  ok(!fx._wantsShareFx({ shareId: 's2', senderUserId: 'player' }), 'the sender does not see it again, even if they own the recipient');
  game.user = { id: 'gm', isGM: true };
  ok(!Object.create(Svc.prototype)._wantsShareFx({ shareId: 's3', senderUserId: 'player' }), 'a GM owning every actor does not get a receive animation');
  const src = read('scripts/services/ContactShareService.js');
  ok(src.includes('senderUserId: game.user.id') && src.includes('senderUserId: payload.senderUserId'), 'the notify says who sent it');
  ok(src.includes('game.users.activeGM.id !== game.user.id'), 'only one GM delivers a relayed share');
}

// wiring
{
  const dlg = read('scripts/ui/ContactManager/ContactShareDialog.js'), hbs = read('templates/contact-share/contact-share-dialog.hbs');
  ok(dlg.includes('setSend:') && dlg.includes('static _onSetSend') && hbs.includes('data-action="setSend"'), 'the dialog offers the choice');
  ok(dlg.includes('this.contact.email && this.contact.phone'), 'the choice only shows when the contact has both');
  ok(read('scripts/data/ContactRepository.js').includes('verification.masterContactId || contactData.masterContactId'), 'a number-only contact keeps who it is');
  const calls = read('templates/message-viewer/partials/calls-tab.hbs'), tabJs = read('scripts/ui/MessageViewer/callsTab.js');
  ok(calls.includes('data-action="calls-filter"') && tabJs.includes("case 'calls-filter'"), 'the log tabs can be clicked');
  for (const k of ['all', 'missed', 'vm', 'book']) ok(tabJs.includes(`k: '${k}'`), `the ${k} tab exists`);
  ok(calls.includes('{{#if bookView}}') && calls.includes('data-calls-bookq') && tabJs.includes('[data-calls-bookq]'), 'the contact list renders and searches');
  const row = calls.slice(calls.indexOf('<span class="tm">{{time}}</span>'), calls.indexOf('{{/each}}', calls.indexOf('<span class="tm">{{time}}</span>')));
  ok(row.indexOf('<span class="acts">') > 0 && row.indexOf('calls-dial') > row.indexOf('<span class="acts">') && row.indexOf('</span>\n          </div>') > row.indexOf('calls-dial'), 'every button on a call row sits in one cell');
  const view = read('scripts/ui/AdminPanel/tabs/phoneNumbersView.js');
  ok(view.includes('id: norm(e.name)'), 'the item picker keys entries by name, since the world list has no ids');
  ok((view.match(/await pickItems\(/g) || []).length === 2, 'both item lists use the one picker');
  ok(!/worldItemEntries\(\);\s*const pick/.test(view), 'no phone screen feeds the raw list to the picker');
  const hd = read('templates/admin-panel/tab-contacts.hbs'), ct = read('scripts/ui/AdminPanel/tabs/ContactsTab.js');
  ok(hd.includes('ncm-ct2-pphone') && ct.includes("case 'pPhone'") && ct.includes('phoneLines:'), 'Players shows numbers and opens them in Phone');
  ok(read('scripts/ui/AdminPanel/tabs/PhoneTab.js').includes('select?.person'), 'Phone opens on that character');
  ok(view.includes('data-k="biz"') && view.includes("SVC.setLineType(a.n, { type: 'biz' })"), 'Add a line can make a business line');
  ok(view.includes('data-in="lineLabel"') && view.includes('lineLabel: (el)'), 'a line that shows a name can have one written');
  for (const f of ['tab-phone', 'contacts-map', 'tab-contacts']) for (const m of read(`styles/components/admin-panel/${f}.css`).matchAll(/[^\n{}]*\.tags \{([^}]*display: flex[^}]*)\}/g)) ok(m[1].includes('justify-content'), f + ': a flex .tags says where it starts, since another module centres bare .tags');
  const c = read('styles/components/admin-panel/tab-phone.css');
  ok(c.includes('.ncm-pn-ph > h5:has(.ncm-r3-dialw)'), 'the line type name and dial words have their row');
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
