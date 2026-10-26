// Sim: sender/recipient display-name precedence + the player send-gate's
// correspondent rule (2026-09 tester report: "From shows XXXX-Fixer, not the
// edited directory name" / "Reply to an NPC message → Contact Not Found").
// Drives the REAL helpers.resolveDisplayName / resolveDisplayPortrait,
// MessageRepository._resolveSenderName and MessageService._isKnownCorrespondent
// via prototype.call with mocked globals.
import { pathToFileURL, fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };

// ── Minimal Foundry globals ──
const actors = new Map([
  ['npc1', { id: 'npc1', name: 'Rogue-Fixer', img: 'tokens/rogue.webp' }],
  ['npc2', { id: 'npc2', name: 'Babel-Mother', img: 'icons/svg/mystery-man.svg' }],
  ['pc1',  { id: 'pc1',  name: 'V', img: 'tokens/v.webp' }],
]);
const master = [
  { id: 'mc1', name: 'Rogue', email: 'rogue@afterlife.nc', actorId: 'npc1', portrait: '' },
  { id: 'mc2', name: 'System Alerts', email: 'alerts@localhost', actorId: null, portrait: 'p/alerts.webp' },
];
globalThis.game = {
  actors: { get: (id) => actors.get(id) },
  user: { isGM: false },
  nightcity: {
    masterContactService: {
      getContact: (id) => master.find(c => c.id === id) || null,
      getByActorId: (id) => master.find(c => c.actorId === id) || null,
      getByEmail: (e) => master.find(c => c.email === String(e || '').toLowerCase().trim()) || null,
    },
  },
};
globalThis.foundry = { utils: { deepClone: (o) => JSON.parse(JSON.stringify(o)), mergeObject: (a, b) => ({ ...a, ...b }) } };
globalThis.Hooks = { on: () => {}, once: () => {}, off: () => {} };
globalThis.ui = { notifications: { info: () => {}, warn: () => {}, error: () => {} } };

const { resolveDisplayName, resolveDisplayPortrait } = await import(pathToFileURL(`${ROOT}/scripts/utils/helpers.js`).href);
const { MessageRepository } = await import(pathToFileURL(`${ROOT}/scripts/data/MessageRepository.js`).href);
const { MessageService } = await import(pathToFileURL(`${ROOT}/scripts/services/MessageService.js`).href);

// ═══ resolveDisplayName precedence ═══
ok(resolveDisplayName({ contactId: 'mc1', actorId: 'npc1', email: 'rogue@afterlife.nc' }) === 'Rogue',
  'contactId → directory name beats actor label');
ok(resolveDisplayName({ actorId: 'npc1' }) === 'Rogue',
  'actorId alone → directory entry linked to that actor wins over "Rogue-Fixer"');
ok(resolveDisplayName({ email: 'ROGUE@afterlife.nc ' }) === 'Rogue',
  'email alone → directory lookup is case/space-insensitive');
ok(resolveDisplayName({ actorId: 'npc2', storedName: 'Stored Name' }) === 'Stored Name',
  'no directory entry → stored fromName beats the actor label');
ok(resolveDisplayName({ actorId: 'npc2' }) === 'Babel-Mother',
  'no directory, no stored name → actor label');
ok(resolveDisplayName({ email: 'ghost@darknet.relay' }) === 'ghost',
  'nothing but an email → local part');
ok(resolveDisplayName({}) === 'Unknown', 'nothing at all → default fallback');
ok(resolveDisplayName({}, '') === '', 'custom fallback honored');
ok(resolveDisplayName({ contactId: 'mc2' }) === 'System Alerts', 'contact without actor resolves by id');

// ═══ resolveDisplayPortrait ═══
ok(resolveDisplayPortrait({ actorId: 'npc1' }) === 'tokens/rogue.webp',
  'directory entry with no portrait falls through to the linked actor art');
ok(resolveDisplayPortrait({ contactId: 'mc2' }) === 'p/alerts.webp', 'directory portrait wins');
ok(resolveDisplayPortrait({ actorId: 'npc2' }) === '', 'mystery-man placeholder is never used');
ok(resolveDisplayPortrait({}) === '', 'no ids → empty');

// ═══ MessageRepository._resolveSenderName (journal page title) ═══
const rs = (d) => MessageRepository.prototype._resolveSenderName.call({}, d);
ok(rs({ fromActorId: 'npc1', from: 'rogue@afterlife.nc' }) === 'Rogue', 'page title uses the directory name');
ok(rs({ fromActorId: 'npc2', from: 'x@y.z' }) === 'Babel-Mother', 'page title falls back to actor label');
ok(rs({ anonymous: { enabled: true, alias: 'GHOST' }, fromActorId: 'npc1' }) === 'GHOST', 'anon alias still wins');
ok(rs({ from: 'nobody@nowhere.nc' }) === 'nobody', 'email-only → handle');

// ═══ MessageService._isKnownCorrespondent (the reply gate) ═══
const inbox = [
  { messageId: 'm1', fromActorId: 'npc2', from: 'babel-mother@nightcity.net', status: { sent: false, spam: false } },
  { messageId: 'm2', fromActorId: 'npc1', from: 'rogue@afterlife.nc', status: { sent: false, spam: true } },     // spam-routed
  { messageId: 'm3-sent', fromActorId: 'pc1', from: 'v@nc.net', status: { sent: true, spam: false } },            // own sent copy
  { messageId: 'm4', fromContactId: 'mc2', from: 'alerts@localhost', status: { sent: false, spam: false } },
  { messageId: 'm5', fromActorId: 'npc1', from: '▓▓▓▓▓@darknet.relay', status: { sent: false, spam: false },
    anonymous: { enabled: true, traced: false } },                                                                 // still masked
];
const svc = { _messageRepo: { getMessages: async (actorId) => (actorId === 'pc1' ? inbox : []) } };
const known = (target) => MessageService.prototype._isKnownCorrespondent.call(svc, 'pc1', target);

ok(await known({ actorId: 'npc2' }) === true, 'NPC actor that wrote first → known (reply allowed)');
ok(await known({ email: 'BABEL-MOTHER@nightcity.net' }) === true, 'matches by email, case-insensitive');
ok(await known({ contactId: 'mc2' }) === true, 'matches by master contact id');
ok(await known({ actorId: 'npc1' }) === false, 'spam-routed + masked-anon senders do NOT count');
ok(await known({ actorId: 'pc1' }) === false, 'own sent copies do not count');
ok(await known({ actorId: 'nobody' }) === false, 'stranger → not known');
ok(await known({}) === false, 'no target ids → false');
ok(await MessageService.prototype._isKnownCorrespondent.call(svc, null, { actorId: 'npc2' }) === false, 'no inbox actor → false');
ok(await MessageService.prototype._isKnownCorrespondent.call(
  { _messageRepo: { getMessages: async () => { throw new Error('boom'); } } }, 'pc1', { actorId: 'npc2' }) === false,
  'repo failure → false, never throws');

// ═══ MessageService._autoRegisterNpcSender (GM sends from an unregistered NPC) ═══
const toasts = [];
globalThis.ui.notifications.info = (m) => toasts.push(m);
globalThis.game.user = { isGM: true };
const settings = { autoRegisterNpcSenders: true };
globalThis.game.settings = { get: (mod, key) => settings[key] };
const added = [];
globalThis.game.nightcity.masterContactService.addContact = async (d) => {
  const contact = { id: `auto-${added.length + 1}`, ...d };
  added.push(contact); master.push(contact);
  return { success: true, contact };
};
const reg = (data, actor) => MessageService.prototype._autoRegisterNpcSender.call({}, data, actor);
const stranger = { id: 'npc9', name: 'Kowalski-Fixer', img: 'tokens/kowalski.webp', hasPlayerOwner: false,
  items: [{ type: 'role', name: 'Fixer' }] };

let d = { from: 'kowalski-fixer@nightcity.net', subject: 'Job' };
let c = await reg(d, stranger);
ok(c && c.actorId === 'npc9' && c.name === 'Kowalski-Fixer', 'unregistered NPC → master contact created, linked to the actor');
ok(c.role === 'fixer' && c.portrait === 'tokens/kowalski.webp' && c.email === d.from, 'carries CPR role, portrait, and the resolved email');
ok(d.fromContactId === 'auto-1', 'send data now points at the new directory entry');
ok(toasts.length === 1 && toasts[0].includes('Kowalski-Fixer'), 'GM is notified');
ok(resolveDisplayName({ actorId: 'npc9' }) === 'Kowalski-Fixer', 'later name resolution finds the new entry');

c = await reg({ from: 'kowalski-fixer@nightcity.net' }, stranger);
ok(c === null && added.length === 1, 'second send from the same actor → no duplicate');

d = { from: 'rogue@afterlife.nc' };
c = await reg(d, actors.get('npc1'));
ok(c === null && d.fromContactId === 'mc1', 'already-registered actor → no create, fromContactId back-filled');

c = await reg({ from: 'alerts@localhost' }, { id: 'npcX', name: 'X', hasPlayerOwner: false, items: [] });
ok(c === null && added.length === 1, 'email already in the directory (unlinked) → left alone');

c = await reg({ from: 'v@nc.net' }, { id: 'pc1', name: 'V', hasPlayerOwner: true, items: [] });
ok(c === null && added.length === 1, 'player-owned sender → never registered');

settings.autoRegisterNpcSenders = false;
c = await reg({ from: 'z@nc.net' }, { id: 'npcZ', name: 'Z', hasPlayerOwner: false, items: [] });
ok(c === null && added.length === 1, 'setting off → no-op');
settings.autoRegisterNpcSenders = true;

globalThis.game.user = { isGM: false };
c = await reg({ from: 'z@nc.net' }, { id: 'npcZ', name: 'Z', hasPlayerOwner: false, items: [] });
ok(c === null && added.length === 1, 'non-GM client → no-op');
globalThis.game.user = { isGM: true };

globalThis.game.nightcity.masterContactService.addContact = async () => { throw new Error('boom'); };
c = await reg({ from: 'q@nc.net' }, { id: 'npcQ', name: 'Q', hasPlayerOwner: false, items: [] });
ok(c === null, 'directory write failure → send is not blocked');


// ═══ _senderEmailFor — the directory beats the synthesized address (tester 2026-10-24: the GM
// picked "example@ARK.com" from Send-as, the player saw example@nightcity.net) ═══
const flags = { npc1: '' };
const svcEmail = { _contactRepo: { getActorEmail: (id) => flags[id] || '' } };
const sendFrom = (data, actor) => MessageService.prototype._senderEmailFor.call(svcEmail, data, actor);
ok(sendFrom({ fromActorId: 'npc1' }, actors.get('npc1')) === 'rogue@afterlife.nc',
  'actor-backed pick with NO flag → the directory entry linked to the actor, not name@nightcity.net');
ok(sendFrom({ fromActorId: 'npc1', fromContactId: 'mc2' }, actors.get('npc1')) === 'alerts@localhost',
  'an explicit fromContactId wins over the actor link');
flags.npc1 = 'rogue@registered.nc';
ok(sendFrom({ fromActorId: 'npc1' }, actors.get('npc1')) === 'rogue@registered.nc',
  'a registered Email-Setup flag still beats the directory (same order as _recipientEmailFor)');
flags.npc1 = '';
ok(sendFrom({ fromActorId: 'npc2' }, actors.get('npc2')) === '',
  'no flag, no directory entry → empty so the caller synthesizes');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
