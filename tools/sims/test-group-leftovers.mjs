// Sim: contact groups — the last three follow-ups. (4) the Contact Manager's
// last-interaction index reads a group copy's participants, (5) assigning an
// address a second character already holds WARNS (never blocks), (6) group
// changes fire bus events the IntegrationBridge mirrors as Foundry hooks.
import { pathToFileURL } from 'url';
import { readFileSync } from 'fs';

const ROOT = 'C:/Users/cphan/AppData/Local/FoundryVTT/Data/modules/night-city-messenger';
const MOD = 'night-city-messenger';
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };

const flagStore = new Map();
const mkActor = (id, name, email = '') => {
  flagStore.set(id, { email });
  return { id, name, isOwner: true, hasPlayerOwner: true, type: 'character',
    getFlag: (m, k) => flagStore.get(id)?.[k], setFlag: async (m, k, v) => { flagStore.get(id)[k] = JSON.parse(JSON.stringify(v)); } };
};
const actors = new Map([['v', mkActor('v', 'V', 'v@nightcity.net')], ['judy', mkActor('judy', 'Judy Alvarez', 'judy@mox.nc')], ['panam', mkActor('panam', 'Panam Palmer', 'panam@aldecaldos.nc')]]);
const toasts = [];
const events = [];
const settings = { masterContactGroups: [] };
globalThis.game = {
  user: { id: 'u', isGM: true },
  users: Object.assign([{ id: 'u', isGM: true, name: 'GM' }], { find(fn) { return Array.prototype.find.call(this, fn) || null; } }),
  actors: { get: (id) => actors.get(id) || null, contents: [...actors.values()], [Symbol.iterator]: function* () { yield* actors.values(); } },
  settings: { get: (m, k) => settings[k], set: async (m, k, v) => { settings[k] = JSON.parse(JSON.stringify(v)); } },
  nightcity: {
    eventBus: { emit: (e, p) => events.push({ e, p }), on: () => {} },
    masterContactService: { getContact: () => null, getByEmail: () => null, getByActorId: () => null, getAll: () => [], pushToPlayer: async () => ({ success: true }), pushActorToPlayer: async () => ({ success: true }) },
    contactRepository: { getActorEmail: (id) => flagStore.get(id)?.email || '' },
  },
};
globalThis.foundry = { utils: { deepClone: (o) => JSON.parse(JSON.stringify(o)), mergeObject: (a, b) => ({ ...a, ...b }), randomID: (() => { let n = 0; return () => `g${++n}`; })() } };
globalThis.Hooks = { on: () => {}, once: () => {}, off: () => {}, callAll: () => {} };
globalThis.ui = { notifications: { info: (m) => toasts.push(['info', m]), warn: (m) => toasts.push(['warn', m]), error: (m) => toasts.push(['error', m]) } };

const { MessageRepository } = await import(pathToFileURL(`${ROOT}/scripts/data/MessageRepository.js`).href);
const { EmailService } = await import(pathToFileURL(`${ROOT}/scripts/services/EmailService.js`).href);
const { ContactGroupService, memberFromActor } = await import(pathToFileURL(`${ROOT}/scripts/services/ContactGroupService.js`).href);
const { EVENTS } = await import(pathToFileURL(`${ROOT}/scripts/utils/constants.js`).href);
const { makeMember } = await import(pathToFileURL(`${ROOT}/scripts/utils/participants.js`).href);

// ═══ 4. Last-interaction index over participants ═══
{
  const repo = Object.create(MessageRepository.prototype);
  const crew = [
    makeMember({ email: 'v@nightcity.net', name: 'V', hint: { actorId: 'v' }, role: 'from' }),
    makeMember({ email: 'judy@mox.nc', name: 'Judy Alvarez', hint: { actorId: 'judy' } }),
    makeMember({ email: 'panam@aldecaldos.nc', name: 'Panam Palmer', hint: { actorId: 'panam' } }),
  ];
  repo.getMessages = async () => [
    // V's sent group copy — joined "to", participants carry the party
    { messageId: 'g1-sent', status: { sent: true }, timestamp: '2077-10-20T12:00:00Z', to: 'judy@mox.nc, panam@aldecaldos.nc', toActorId: null, toName: 'Judy Alvarez, Panam Palmer', participants: crew },
    // an older one-to-one with Judy (legacy shape, no participants)
    { messageId: 'o1', status: {}, timestamp: '2077-10-19T09:00:00Z', from: 'judy@mox.nc', fromActorId: 'judy' },
  ];
  const index = await repo.getLastMessagesByCounterparty('v');
  ok(index.byActorId.get('judy')?.messageId === 'g1-sent', 'the group send is Judy\'s newest interaction (found via participants)');
  ok(index.byActorId.get('panam')?.messageId === 'g1-sent' && index.byEmail.get('panam@aldecaldos.nc')?.messageId === 'g1-sent', 'Panam indexes by actor AND address');
  ok(!index.byActorId.has('v') && !index.byEmail.has('v@nightcity.net'), 'the viewer is never their own counterparty');
  ok(!index.byEmail.has('judy@mox.nc, panam@aldecaldos.nc'), 'the joined "a, b" address is NOT used as a key');
  ok(MessageRepository.pickLatestFor(index, { email: 'judy@mox.nc', actorId: 'judy' })?.messageId === 'g1-sent', 'pickLatestFor resolves the contact to the group copy');
}

// ═══ 5. Duplicate-address warning ═══
{
  const svc = Object.create(EmailService.prototype);
  toasts.length = 0;
  ok(svc.findActorsByEmail('JUDY@mox.nc').length === 1 && svc.findActorsByEmail('judy@mox.nc', { excludeId: 'judy' }).length === 0, 'findActorsByEmail is case-insensitive and excludes the holder');
  const others = svc.warnIfAddressTaken('judy@mox.nc', actors.get('panam'));
  ok(others.length === 1 && others[0].id === 'judy', 'assigning Judy\'s address to Panam reports Judy');
  ok(toasts.length === 1 && toasts[0][0] === 'warn' && /Judy Alvarez/.test(toasts[0][1]), 'it WARNS, naming the other holder');
  toasts.length = 0;
  ok(svc.warnIfAddressTaken('fresh@nc.net', actors.get('panam')).length === 0 && toasts.length === 0, 'a fresh address warns nobody');
  const src = readFileSync(`${ROOT}/scripts/services/EmailService.js`, 'utf8');
  ok((src.match(/this\.warnIfAddressTaken\(email, actor\)/g) || []).length === 2, 'registerEmail AND forceSetEmail both warn before writing');
  ok(/warnIfAddressTaken/.test(readFileSync(`${ROOT}/scripts/data/ContactRepository.js`, 'utf8')), 'ContactRepository.setActorEmail warns too');
}

// ═══ 6. Group events ═══
{
  const svc = new ContactGroupService();
  events.length = 0;
  const r1 = await svc.saveActorGroup('v', { name: 'Crew', members: [memberFromActor(actors.get('judy'))] });
  ok(events.at(-1)?.e === EVENTS.GROUP_CREATED && events.at(-1).p.scope === 'actor' && events.at(-1).p.actorId === 'v' && events.at(-1).p.group.id === r1.group.id, 'creating a player group emits groups:created');
  await svc.saveActorGroup('v', { ...r1.group, name: 'Crew 2' });
  ok(events.at(-1)?.e === EVENTS.GROUP_UPDATED, 'saving it again emits groups:updated');
  await svc.deleteActorGroup('v', r1.group.id);
  ok(events.at(-1)?.e === EVENTS.GROUP_DELETED && events.at(-1).p.groupId === r1.group.id, 'deleting emits groups:deleted');
  const r2 = await svc.saveMasterGroup({ name: 'Afterlife', members: [memberFromActor(actors.get('judy'))] });
  ok(events.at(-1)?.e === EVENTS.GROUP_CREATED && events.at(-1).p.scope === 'master', 'a GM group emits with scope master');
  await svc.pushGroupToPlayer(r2.group.id, 'panam');
  ok(events.at(-1)?.e === EVENTS.GROUP_PUSHED && events.at(-1).p.targetActorId === 'panam' && events.at(-1).p.shared === 1, 'pushing emits groups:pushed with the share count');
  const bridge = readFileSync(`${ROOT}/scripts/integrations/IntegrationBridge.js`, 'utf8');
  for (const e of ['groups:created', 'groups:updated', 'groups:deleted', 'groups:pushed']) ok(bridge.includes(`'${e}'`), `IntegrationBridge mirrors ${e}`);
  ok(/groups:pushed/.test(readFileSync(`${ROOT}/INTEGRATION.md`, 'utf8')), 'INTEGRATION.md documents the group hooks');
  for (const k of ['GROUP_CREATED', 'GROUP_UPDATED', 'GROUP_DELETED', 'GROUP_PUSHED']) ok(typeof EVENTS[k] === 'string', `EVENTS.${k} exists`);
}

console.log(`\ntest-group-leftovers: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
