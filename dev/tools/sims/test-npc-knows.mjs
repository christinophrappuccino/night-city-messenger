// Sim: NPC ↔ NPC sharing (2026-10-30) — the pure rules (utils/npcKnows.js), the REAL MasterContactService writing an
// NPC's list on its main identity, the Admin → Contacts wiring (context, ops, template), and the list in use (the
// composer's To search when writing as the NPC, the NPC's Calls phone book).
//   node dev/tools/sims/test-npc-knows.mjs
import fs from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
const read = (p) => fs.readFileSync(`${ROOT}/${p}`, 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.error('FAIL:', m)); };

globalThis.game = { user: { isGM: true }, users: { activeGM: {} }, settings: { get: () => undefined }, nightcity: {}, actors: { get: () => null }, journal: { contents: [] } };

// the directory: Rogue (a contact-only NPC) with an alias Queen; Takemura; Delamain; a player's character twin
const rogue = { id: 'rogue', name: 'Rogue' };
const queen = { id: 'queen', name: 'Queen of Hearts', identityOf: 'rogue' };
const take = { id: 'take', name: 'Takemura' };
const dela = { id: 'dela', name: 'Delamain' };
const vTwin = { id: 'vtwin', name: 'V', actorId: 'v' };

// ═══ 1. pure rules ═══
const N = await imp('scripts/utils/npcKnows.js');
const C1 = [{ ...rogue, knows: ['take', 'queen', 'gone', 'take', ''] }, queen, take, dela];
ok(N.sanitizeKnows(['a', 'a', '', 3, 'b']).join() === 'a,b' && N.sanitizeKnows('x').length === 0, 'sanitizeKnows: unique non-empty strings');
ok(N.knowsHolder(C1, queen).id === 'rogue' && N.knowsHolder(C1, take).id === 'take', 'an alias holds its list on its main identity; a lone NPC on itself');
ok(N.knowsOf(C1, rogue).join() === 'take' && N.knowsOf(C1, queen).join() === 'take', 'knowsOf: deleted ids and its own identities dropped; the alias reads the main\'s list');
ok(N.npcKnows(C1, queen, take) && !N.npcKnows(C1, take, rogue), 'npcKnows is one-way');
ok(N.knownByNpcs(C1, take).map((c) => c.id).join() === 'rogue', 'knownByNpcs: the main identities that know a contact');
ok(N.knownByNpcs([{ ...take, knows: ['take'] }], take).length === 0, 'an NPC never shows as knowing itself');
ok(N.knownByNpcs(C1, take, (c) => c.id !== 'rogue').length === 0, 'the isNpc filter drops non-NPCs');
ok(N.withKnows(['a'], 'b', true).join() === 'a,b' && N.withKnows(['a', 'b'], 'a', false).join() === 'b', 'withKnows');

// ═══ 2. the REAL MasterContactService ═══
const { MasterContactService } = await imp('scripts/services/MasterContactService.js');
const mcs = Object.create(MasterContactService.prototype);
mcs._contacts = [{ ...rogue }, { ...queen }, { ...take }, { ...dela }, { ...vTwin }];
mcs._persistContacts = async () => {};
game.nightcity.eventBus = { emit() {}, on() {} };
mcs._onMasterListChanged = async () => {};
let r = await mcs.setNpcKnows('queen', 'take', true);
ok(r.success !== false && mcs.getContact('rogue').knows?.join() === 'take' && !mcs.getContact('queen').knows?.length, 'sharing with an alias writes on its main identity');
ok(mcs.npcKnows('rogue').map((c) => c.id).join() === 'take' && mcs.npcKnows('queen').map((c) => c.id).join() === 'take', 'both identities read the same list');
await mcs.setNpcKnows('rogue', 'dela', true);
await mcs.setNpcKnows('take', 'queen', true);
ok(mcs.knownByNpcs('dela').map((c) => c.id).join() === 'rogue' && mcs.knownByNpcs('queen').map((c) => c.id).join() === 'take', 'knownByNpcs through the service');
r = await mcs.setNpcKnows('rogue', 'queen', true);
ok(r.success === false && /own identities/.test(r.error), 'an NPC cannot be given its own alias');
r = await mcs.setNpcKnows('rogue', 'take', true);
ok(r.unchanged, 'sharing twice changes nothing');
await mcs.setNpcKnows('queen', 'take', false);
ok(mcs.npcKnows('rogue').map((c) => c.id).join() === 'dela', 'take back through an alias takes it off the main\'s list');
game.user.isGM = false;
ok((await mcs.setNpcKnows('rogue', 'take', true)).success === false, 'players cannot change an NPC\'s list');
game.user.isGM = true;
const svc = read('scripts/services/MasterContactService.js');
ok(/'identityOf', 'knows'/.test(svc) && /knows: sanitizeKnows\(data\.knows\)/.test(svc) && /key === 'knows'/.test(svc), 'knows: created clean, updatable, sanitized on update');
ok(!/knows/.test(svc.slice(svc.indexOf('async pushToPlayer('), svc.indexOf('async pushToPlayer(') + 1800)), 'an NPC\'s list never travels to a player with a pushed contact');

// ═══ 3. Admin → Contacts wiring ═══
const tab = read('scripts/ui/AdminPanel/tabs/ContactsTab.js');
const hbs = read('templates/admin-panel/tab-contacts.hbs');
for (const op of ['npcWhoAdd', 'npcWhoDel', 'knowsAdd', 'knowsDel']) ok(tab.includes(`case '${op}'`) && hbs.includes(`data-op="${op}"`), `op ${op}: template ↔ handler`);
ok(/npcWho: \(this\.masterContactService\?\.knownByNpcs/.test(tab) && /knows: \(this\.masterContactService\?\.npcKnows/.test(tab), 'the detail context carries both directions');
ok(/Who \{\{name\}\} knows/.test(hbs) && /ncm-ct2-whonpc/.test(hbs), 'the NPCs row + the Who-they-know section');
ok(/_npcKnowsSet\(npcId, targetId, on\)[\s\S]{0,400}adminConfirm/.test(tab), 'taking back asks first (the standing rule)');
ok(!/\{\{#each npcWho\}\}[^]*?\.\.\//.test(hbs.slice(hbs.indexOf('{{#each npcWho}}'), hbs.indexOf('{{#each npcWho}}') + 600)), 'no ../ inside the new loops (ids ride each row)');
ok(read('styles/components/admin-panel/tab-contacts.css').includes('.ncm-ct2-whonpc'), 'styled');

// the ⋯ menu's Share with… (and every other share dialog) offers NPCs beside the players
ok(/group: 'NPCs'/.test(tab) && tab.includes('id: `npc:${n.id}`') && /p\.id\.startsWith\('npc:'\)[\s\S]{0,300}setNpcKnows/.test(tab), 'Share with…: NPCs are a group in the picker and go on the NPC\'s list');
ok(/taken: knowsAlready/.test(tab), 'Share with…: NPCs who already know them are greyed');

// ═══ 4. the list in use ═══
const comp = read('scripts/ui/MessageComposer/MessageComposerApp.js');
ok(/_sendingNpcId\(\)/.test(comp) && /npcKnows\?\.\(npcId\)/.test(comp) && /results\.sort\(\(a, b\) => Number\(!!b\.known\)/.test(comp), 'writing as an NPC: its known people come first');
ok(/ncm-autocomplete__known/.test(comp) && read('styles/components/message-composer.css').includes('.ncm-autocomplete__known'), '…marked, and styled');
const calls = read('scripts/ui/MessageViewer/callsTab.js');
ok(/mcs\.npcKnows\?\.\(npc\.id\)/.test(calls) && /known: true/.test(calls) && /Number\(!!b\.known\)/.test(calls), 'the NPC\'s Agent → Calls: its contacts with numbers make the phone book and lead speed dial');

console.log(`test-npc-knows: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
