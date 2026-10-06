// Sim: contact sharing + player send resolution (2026-09 tester round 2).
//   • getPlayerCharacters — assigned characters first, then other player-owned
//     actors; non-person types skipped (the shared enumeration behind the
//     admin share dialog, "Known by", broadcast and View Inbox).
//   • MasterContactService.pushToPlayer — re-sharing never duplicates.
//   • MasterContactService.pushActorToPlayer — a PLAYER CHARACTER shares as an
//     actor-linked contact (the Admin → Contacts PC rows used to be skipped).
//   • MessageService.sendMessage on a PLAYER client whose recipient actor is
//     hidden (players don't receive actors they lack permission on): resolves
//     through the master directory / the address instead of "Recipient not
//     found"; the verification gate still applies when nothing vouches.
// Drives the REAL methods via prototype.call with mocked globals.
//   node tools/sims/test-contact-sharing.mjs
import { pathToFileURL } from 'url';

const ROOT = 'C:/Users/cphan/AppData/Local/FoundryVTT/Data/modules/night-city-messenger';
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };

// ── Minimal Foundry globals ──
const MOD = 'night-city-messenger';
function mkActor(id, name, { type = 'character', owners = [], flags = {}, img = 'tokens/x.webp' } = {}) {
  const store = { [MOD]: { ...flags } };
  return {
    id, name, type, img,
    items: { find: () => null },
    get hasPlayerOwner() { return owners.length > 0; },
    testUserPermission: (u, level) => level === 'OWNER' && owners.includes(u.id),
    getFlag: (scope, key) => store[scope]?.[key],
    setFlag: async (scope, key, val) => { (store[scope] ??= {})[key] = val; return this; },
    get isOwner() { return true; },
  };
}
const users = [
  { id: 'u-gm', name: 'GM', isGM: true, character: null, active: true },
  { id: 'u-alice', name: 'Alice', isGM: false, character: null, active: true },
  { id: 'u-bob', name: 'Bob', isGM: false, character: null, active: true },
  { id: 'u-carol', name: 'Carol', isGM: false, character: null, active: true },
];
const pc1 = mkActor('pc1', 'V', { owners: ['u-alice'], flags: { email: 'v@nightcity.net' } });
const pc2 = mkActor('pc2', 'Jackie', { owners: ['u-bob'], flags: { email: 'jackie@nightcity.net' } });
const ice = mkActor('ice1', 'Hellhound', { type: 'blackIce', owners: ['u-carol'] });
const npc1 = mkActor('npc1', 'Rogue-Fixer', {});           // GM-only NPC
const npc2 = mkActor('npc2', 'Nobody', {});                // GM-only NPC, not in directory
users[1].character = pc1;

// The GM sees everything; a PLAYER sees only pc1/pc2/ice1.
const allActors = new Map([['pc1', pc1], ['pc2', pc2], ['ice1', ice], ['npc1', npc1], ['npc2', npc2]]);
let visible = allActors;
const actorsProxy = {
  get: (id) => visible.get(id),
  [Symbol.iterator]: function* () { yield* visible.values(); },
  filter: (fn) => [...visible.values()].filter(fn),
  find: (fn) => [...visible.values()].find(fn),
};
const settings = { requireContactVerification: true, debugMode: false, masterContacts: [] };
globalThis.game = {
  actors: actorsProxy,
  users: Object.assign(users, { find: Array.prototype.find.bind(users) }),
  user: users[0],
  settings: { get: (_s, k) => settings[k], set: async (_s, k, v) => { settings[k] = v; } },
  journal: [],
  nightcity: {},
};
globalThis.foundry = {
  utils: {
    randomID: () => Math.random().toString(36).slice(2, 12),
    deepClone: (o) => JSON.parse(JSON.stringify(o)),
    mergeObject: (a, b) => ({ ...a, ...b }),
  },
};
globalThis.Hooks = { on: () => {}, once: () => {}, off: () => {}, call: () => true, callAll: () => {} };
globalThis.ui = { notifications: { info: () => {}, warn: () => {}, error: () => {} } };
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3 } };
// DataValidator.sanitizeBody round-trips the body through a DOM element.
globalThis.document = { createElement: () => ({ innerHTML: '', querySelectorAll: () => [] }) };

const helpers = await import(pathToFileURL(`${ROOT}/scripts/utils/helpers.js`).href);
const { ContactRepository } = await import(pathToFileURL(`${ROOT}/scripts/data/ContactRepository.js`).href);
const { MasterContactService } = await import(pathToFileURL(`${ROOT}/scripts/services/MasterContactService.js`).href);
const { MessageService } = await import(pathToFileURL(`${ROOT}/scripts/services/MessageService.js`).href);

// ═══ getPlayerCharacters ═══
{
  const list = helpers.getPlayerCharacters();
  ok(list.length === 2, `getPlayerCharacters → 2 entries (got ${list.length})`);
  ok(list[0]?.actorId === 'pc1' && list[0].assigned === true && list[0].playerName === 'Alice',
    'assigned character first, labelled by its user');
  ok(list[1]?.actorId === 'pc2' && list[1].assigned === false && list[1].playerName === 'Bob',
    'unassigned player-OWNED actor included, labelled by its owner');
  ok(!list.find(x => x.actorId === 'ice1'), 'Black ICE owned by a player is not a "player character"');
  ok(!list.find(x => x.actorId === 'npc1'), 'GM-only NPC excluded');
}

// ═══ Master directory + repositories (real) ═══
const mcs = new MasterContactService();
mcs._contacts = [
  { id: 'mc1', name: 'Rogue', email: 'rogue@afterlife.nc', actorId: 'npc1', portrait: 'p/rogue.webp', tags: [] },
  { id: 'mc3', name: 'Ghost', email: 'ghost@blackwall.nc', actorId: null, portrait: '', tags: [] },
];
mcs._saveContacts = async () => {}; // never hits settings in the sim
const contactRepo = new ContactRepository();
game.nightcity.masterContactService = mcs;
game.nightcity.contactRepository = contactRepo;

// ═══ pushToPlayer — re-share is duplicate-safe ═══
{
  game.user = users[0]; // GM
  const r1 = await mcs.pushToPlayer('mc1', 'pc2');
  const r2 = await mcs.pushToPlayer('mc1', 'pc2');
  const list = await contactRepo.getContacts('pc2');
  ok(r1.success && !r1.existing, 'first share adds');
  ok(r2.success && r2.existing === true, 'second share reports existing');
  ok(list.filter(c => c.email === 'rogue@afterlife.nc').length === 1, 'exactly one copy on the player');
  ok(list[0].masterContactId === 'mc1' && list[0].linkedActorId === 'npc1', 'player contact links master id + actor');
}

// ═══ pushActorToPlayer — a PC shares as an actor-linked contact ═══
{
  const r1 = await mcs.pushActorToPlayer('pc1', 'pc2');
  const r2 = await mcs.pushActorToPlayer('pc1', 'pc2');
  const self = await mcs.pushActorToPlayer('pc2', 'pc2');
  const list = await contactRepo.getContacts('pc2');
  const v = list.find(c => c.actorId === 'pc1');
  ok(r1.success && v, 'PC pushed to another player');
  ok(v?.name === 'V' && v?.email === 'v@nightcity.net' && v?.customImg === 'tokens/x.webp' && v?.type === 'player',
    'PC contact built from the actor (name/email flag/portrait/type)');
  ok(r2.success && r2.existing === true && list.filter(c => c.actorId === 'pc1').length === 1, 'PC re-share is duplicate-safe');
  ok(self.success && self.existing === true && !list.find(c => c.actorId === 'pc2'), 'a character never receives itself');
  const missing = await mcs.pushActorToPlayer('nope', 'pc2');
  ok(missing.success === false, 'unknown actor → honest failure');
}

// ═══ sendMessage on a PLAYER client whose recipient actor is hidden ═══
{
  game.user = users[1]; // Alice (player)
  visible = new Map([['pc1', pc1], ['pc2', pc2], ['ice1', ice]]); // NPCs hidden from the player
  const fake = Object.create(MessageService.prototype);
  let relayed = null;
  fake._relayMessage = async (d) => { relayed = d; return { success: true }; };
  fake._isKnownCorrespondent = async () => false;
  fake._autoRegisterNpcSender = async () => null;
  fake._getTimestamp = () => '2045-01-01T00:00:00.000Z';
  const send = (d) => MessageService.prototype.sendMessage.call(fake, { subject: 's', body: 'b', fromActorId: 'pc1', ...d });

  // 1. Shared imported-NPC contact (in the directory), composer passes actor + address
  relayed = null;
  let r = await send({ toActorId: 'npc1', to: 'rogue@afterlife.nc' });
  ok(r.success === true, `hidden actor + directory entry → sends (${r.error || 'ok'})`);
  ok(relayed?.toContactId === 'mc1' && relayed?._recipientInboxId === 'npc1', 'resolved via getByActorId; inbox keyed by the actor');

  // 2. Same, but no address (a pre-fix composer payload)
  relayed = null;
  r = await send({ toActorId: 'npc1' });
  ok(r.success === true && relayed?.to === 'rogue@afterlife.nc', 'directory resolution works without an address; to is back-filled');

  // 3. Hidden actor, NOT in the directory, address given, not a correspondent → gate refuses honestly
  r = await send({ toActorId: 'npc2', to: 'nobody@nightcity.net' });
  ok(r.success === false && r.errorCode === 'NO_CONTACT', `unvouched hidden actor → CONTACT NOT FOUND (${r.errorCode})`);

  // 4. Hidden actor, not in the directory, no address → recipient truly unresolvable
  r = await send({ toActorId: 'npc2' });
  ok(r.success === false && /Recipient not found/.test(r.error || ''), 'no directory, no address → Recipient not found');

  // 5. Verification off → the player's own actor link is trusted; the GM delivers by actor id
  settings.requireContactVerification = false;
  relayed = null;
  r = await send({ toActorId: 'npc2', to: 'nobody@nightcity.net' });
  ok(r.success === true && relayed?._recipientInboxId === 'npc2', 'verification off → actor-link-only recipient delivers to that actor inbox');
  settings.requireContactVerification = true;

  // 6. Contact-only recipient by master id (no actor) — unchanged path still works
  relayed = null;
  r = await send({ toContactId: 'mc3', to: 'ghost@blackwall.nc' });
  ok(r.success === true && relayed?._recipientInboxId === 'mc3', 'contact-only recipient → contact inbox');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
