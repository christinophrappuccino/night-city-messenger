// Sim: a player's contact stands for ONE identity (tester 2026-10-30: "If I share a contact each email shows it's
// shared with them, not the specific one I shared"). Every alias of a character shares the linked character, and the
// "who knows" rule matched by that character — so sharing the main address marked every alias as known, and sharing
// an alias to someone who held the main was skipped as "already has it". The rule (utils/identities.js), the admin
// index (contactsModel.knowIndex) and the REAL MasterContactService.pushToPlayer.
//   node dev/tools/sims/test-alias-known.mjs
import { pathToFileURL, fileURLToPath } from 'url';
import fs from 'fs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.error('FAIL:', m)); };

// a character with three identities, and a contact-only NPC with an alias
const contacts = [
  { id: 'main', name: 'Lucky Lin', email: 'lucky@nc.net', actorId: 'lin', primaryIdentity: true },
  { id: 'burn1', name: 'Jade', email: 'jade@burner.net', actorId: 'lin' },
  { id: 'burn2', name: 'Mr. Blue', email: 'blue@burner.net', actorId: 'lin' },
  { id: 'rogue', name: 'Rogue', email: 'rogue@afterlife.nc' },
  { id: 'queen', name: 'Queen of Hearts', email: 'queen@afterlife.nc', identityOf: 'rogue' },
];

const I = await imp('scripts/utils/identities.js');
const M = await imp('scripts/ui/AdminPanel/tabs/contactsModel.js');

// ═══ 1. the rule ═══
{
  const shared = { masterContactId: 'main', email: 'lucky@nc.net', actorId: 'lin' };   // what pushToPlayer writes
  ok(I.entryStandsFor(shared, contacts[0]), 'the shared main address is the main identity');
  ok(!I.entryStandsFor(shared, contacts[1], { isAlias: true }) && !I.entryStandsFor(shared, contacts[2], { isAlias: true }), 'it is NOT either alias (they share the character, not the address)');
  ok(I.entryStandsFor({ email: 'JADE@burner.net ' }, contacts[1], { isAlias: true }), 'an entry the player typed matches its own address (case, spaces)');
  ok(I.entryStandsFor({ masterContactId: 'gone', email: 'blue@burner.net' }, contacts[2], { isAlias: true }), 'a stale master id (a re-imported world) still matches by address');
  ok(!I.entryStandsFor({ masterContactId: 'burn1' }, contacts[0]), 'an entry naming another directory entry is that entry, not the main');
  const linkOnly = { name: 'Lin', actorId: 'lin' };   // a hand-made link with no address
  ok(I.entryStandsFor(linkOnly, contacts[0]) && !I.entryStandsFor(linkOnly, contacts[1], { isAlias: true }), 'a link-only entry stands for the main identity alone');
  ok(!I.entryStandsFor({ actorId: 'lin' }, contacts[3]), 'a contact with no character never matches by character');
}

// ═══ 2. the admin index (Who knows them, Players → Who they know, the map, the table) ═══
{
  const lists = { v: [{ id: 'e1', masterContactId: 'main', email: 'lucky@nc.net', actorId: 'lin' }], judy: [{ id: 'e2', masterContactId: 'burn2', email: 'blue@burner.net', actorId: 'lin' }] };
  const kx = M.knowIndex(lists, { contacts });
  ok(kx.knows(contacts[0], 'v') && !kx.knows(contacts[1], 'v') && !kx.knows(contacts[2], 'v'), 'V knows only the main address she was given');
  ok(kx.knows(contacts[2], 'judy') && !kx.knows(contacts[0], 'judy') && !kx.knows(contacts[1], 'judy'), 'Judy knows only Mr. Blue');
  ok(kx.entriesFor(contacts[2], 'judy')[0].email === 'blue@burner.net', 'the entry says which address she holds');
  ok(!kx.knows(contacts[4], 'v'), 'a contact-only alias is its own contact too');
  // taking back an alias leaves the main where it is
  ok(kx.entriesFor(contacts[1], 'v').length === 0, 'taking back an alias finds nothing of the main to remove');
}

// ═══ 3. the REAL pushToPlayer: sharing an alias to someone who holds the main adds it ═══
{
  const held = { v: [{ id: 'e1', masterContactId: 'main', email: 'lucky@nc.net', actorId: 'lin' }] };
  globalThis.game = { user: { isGM: true }, users: [], actors: { get: () => null }, settings: { get: () => undefined },
    nightcity: { contactRepository: {
      getContacts: async (aid) => held[aid] || [],
      addContact: async (aid, c) => { (held[aid] ||= []).push({ id: `e${Math.random()}`, ...c }); return { success: true }; },
    } } };
  globalThis.foundry = { utils: { randomID: () => 'x' + Math.random().toString(36).slice(2) } };
  const { MasterContactService } = await imp('scripts/services/MasterContactService.js');
  const svc = Object.create(MasterContactService.prototype);
  svc.getAll = () => contacts;
  svc.getContact = (id) => contacts.find((c) => c.id === id) || null;
  const again = await svc.pushToPlayer('main', 'v');
  ok(again.success && again.existing && held.v.length === 1, 're-sharing the main address is still a no-op');
  const alias = await svc.pushToPlayer('burn1', 'v');
  ok(alias.success && !alias.existing && held.v.length === 2 && held.v[1].email === 'jade@burner.net', 'sharing an alias to someone who holds the main ADDS it');
  const twice = await svc.pushToPlayer('burn1', 'v');
  ok(twice.existing && held.v.length === 2, 'and sharing that alias again is a no-op');
}

// ═══ 4. wiring ═══
{
  const read = (p) => fs.readFileSync(`${ROOT}/${p}`, 'utf8');
  const tab = read('scripts/ui/AdminPanel/tabs/ContactsTab.js');
  ok(tab.includes('knowIndex(lists, { contacts: all })'),'the tab builds the index with the directory');
  ok(!/knowIndex\(\{ \[actorId\]: list \}\)\./.test(tab), 'take back / knows-now pass the directory too');
  ok(/held:/.test(tab) && /has \{\{#if held\}\}\{\{held\}\}/.test(read('templates/admin-panel/tab-contacts.hbs')), 'a share chip says which address the player holds');
  ok(/entryStandsFor\(pc, contact, \{ isAlias \}\)/.test(read('scripts/services/MasterContactService.js')), 'pushToPlayer’s duplicate check uses the same rule');
}

console.log(`test-alias-known: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
