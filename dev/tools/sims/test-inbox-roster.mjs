// The GM's list of every inbox: the rules, a contact inbox in Conversations, and the wiring in the drawer and Character Select.
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL: ' + m); } };
const read = (p) => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');

globalThis.game = { settings: { get: () => [] }, actors: { contents: [], get: () => null }, users: [], journal: [], nightcity: {} };
globalThis.foundry = { utils: {}, applications: { api: {} } };
const { buildInboxRoster, pushRecentInbox, RECENT_INBOXES } = await import('../../../scripts/utils/inboxRoster.js');

const contacts = [
  { id: 'c-v', name: 'V', email: 'v@nc.net', actorId: 'v', primaryIdentity: true },
  { id: 'c-silver', name: 'Silver', email: 'silver@burner.nc', actorId: 'v' },
  { id: 'c-mox', name: 'Mox', email: 'mox@lizzies.nc', actorId: 'mox', primaryIdentity: true, role: 'Fixer', portrait: 'mox.webp' },
  { id: 'c-dao', name: 'Dao', email: 'dao@watson.nc', role: 'Ripperdoc' },
  { id: 'c-doc', name: 'The Doctor', email: 'doc@burner.nc', identityOf: 'c-dao' },
  { id: 'c-gone', name: 'Deleted Guy', email: 'x@y.nc', actorId: 'hidden-or-deleted' },
  { id: 'c-sys', name: 'NetWatch', email: 'no@nw.nc', sendOnly: true },
  { id: 'c-lone', name: 'Lone Fixer', email: 'lone@nc.net' },
];
const roster = buildInboxRoster({
  players: [{ actorId: 'v', name: 'V', img: 'v.webp', email: 'v@nc.net', playerName: 'Sam' }],
  npcActors: [{ id: 'mox', name: 'Mox-sheet', img: 'icons/svg/mystery-man.svg', email: '' }, { id: 'guard', name: 'Guard', img: 'g.webp', email: '' }],
  contacts, isSendOnly: (c) => !!c.sendOnly, mail: new Map([['c-dao', { unread: 2, total: 5 }]]),
});
const by = (id) => roster.find((r) => r.id === id);
ok(roster.length === 6, 'one row per mailbox: V, Mox, Guard, Dao, NetWatch, Lone Fixer');
ok(by('c-lone')?.kind === 'npc' && by('c-lone').aliases.length === 0, 'a sheetless NPC with no aliases, the usual case, has a row');
ok(by('v').kind === 'player' && by('v').sub === 'Sam', "a player's character");
ok(by('v').aliases.join() === 'Silver' && !by('c-silver'), "a player's alias searches their row, and has no row");
ok(by('v').search.includes('burner.nc'), 'an alias address finds the row too');
ok(by('mox').name === 'Mox' && by('mox').img === 'mox.webp', 'the directory name and picture beat the sheet');
ok(by('guard').kind === 'npc' && by('guard').aliases.length === 0, 'an NPC with a sheet and no entry');
ok(by('c-dao').kind === 'npc' && by('c-dao').unread === 2 && by('c-dao').total === 5, 'an NPC with no sheet, keyed by directory id, with their mail');
ok(by('c-dao').aliases.join() === 'The Doctor' && !by('c-doc'), "a sheetless NPC's alias shares the row");
ok(by('c-sys').kind === 'system', 'a one-way address is its own group');
ok(!roster.some((r) => r.name === 'Deleted Guy'), 'an entry for a hidden or deleted character is left out');
ok(buildInboxRoster({ npcActors: [{ id: 'a', name: 'A', img: 'icons/svg/mystery-man.svg' }] })[0].img === '', 'no mystery-man portrait');
ok(pushRecentInbox(['a', 'b'], 'b').join() === 'b,a' && pushRecentInbox(['a'], null).join() === 'a', 'recent: newest first, no repeats');
let rec = []; for (let i = 0; i < 20; i++) rec = pushRecentInbox(rec, 'x' + i);
ok(rec.length === RECENT_INBOXES, 'recent is capped');

const launch = read('scripts/init/registerMessagingSystem.js');
ok(/if \(fromActorId && !game\.actors\.get\(fromActorId\)\) \{ fromContactId \|\|= fromActorId; fromActorId = null; \}/.test(launch), 'a sheetless NPC writes as its contact, not as "Unknown"');

const svc = read('scripts/services/ConversationService.js');
ok(/sheetless \? identitiesOfContact/.test(svc) && /inboxOwnerOf\(member\)/.test(svc), 'conversations know a contact inbox');

const viewer = read('scripts/ui/MessageViewer/MessageViewerApp.js');
ok(/const ownedCharacters = game\.user\.isGM \? \[\] : this\._buildOwnedCharacters\(\)/.test(viewer), "a player's list is untouched, and a GM gets the full one instead");
ok(/this\.actorId = owner;/.test(viewer), 'Start follows any NPC into their inbox');
ok(viewer.includes('this._paintInboxSwitch(true)') && viewer.split('gmInboxRoster()').length === 2, 'the list is built when the drawer opens, not on every redraw');
ok(/\{\{#if isGM\}\}[^]*data-gm-switch/.test(read('templates/message-viewer/partials/identity-drawer.hbs')), 'the drawer has it, GM only');
const cs = read('scripts/ui/CharacterSelect/CharacterSelectApp.js');
ok(/isGM\(\) \? this\._buildNpcList\(characters\) : \[\]/.test(cs), 'Character Select lists NPCs for a GM only');
ok(/\{\{#each npcs\}\}/.test(read('templates/character-select/character-select.hbs')), 'and draws them');
const css = read('styles/components/message-viewer.css');
for (const c of ['gmswitch-search', 'gmswitch-list', 'gmswitch-head', 'gmswitch-unread', 'gmswitch-none']) ok(css.includes('ncm-viewer__' + c), c + ' is styled');

console.log(`test-inbox-roster: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
