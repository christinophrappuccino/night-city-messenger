// Sim: phase one of contact groups — multi-recipient fan-out, address-keyed
// participants, Reply All, and threading over the party.
//
// Before this the composer packed 2+ chips into an ARRAY toActorId and the
// service resolved a single recipient, so the send died with "Recipient not
// found" — the module had never delivered one message to two people.
// Drives the REAL participants.js, MessageService (via prototype + mocked
// collaborators), threading.js, DataValidator, then static drift guards.
import { pathToFileURL, fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };
const MOD = 'night-city-messenger';

// ── World A ──
const flags = new Map([['v', 'v@nightcity.net'], ['panam', 'panam@aldecaldos.nc'], ['judy', 'judy@mox.nc']]);
const mkActor = (id, name, type = 'character', hasPlayerOwner = true) => ({
  id, name, type, hasPlayerOwner, img: '',
  getFlag: (m, k) => (k === 'email' ? flags.get(id) || '' : undefined),
});
const actors = new Map([
  ['v', mkActor('v', 'V')],
  ['panam', mkActor('panam', 'Panam Palmer')],
  ['judy', mkActor('judy', 'Judy Alvarez')],
  ['rogue', mkActor('rogue', 'Rogue', 'npc', false)],
]);
const master = [
  { id: 'mc-rogue', name: 'Rogue', email: 'rogue@afterlife.nc', actorId: 'rogue' },
  { id: 'mc-sys', name: 'System', email: 'system@localhost', actorId: null, sendOnly: true },
];
const settings = { requireContactVerification: false, autoRegisterNpcSenders: false, spamUnknownSenderEnabled: false, notifyGmNpcMail: false, subjectThreading: true };
const created = [];   // every createMessage call: {inbox, data}
const emitted = [];
const toasts = [];
let gmOnline = true;
globalThis.MODULE_ID = MOD;
globalThis.game = {
  user: { id: 'u-gm', isGM: true },
  users: { find: (fn) => (gmOnline ? [{ id: 'u-gm', isGM: true, active: true }] : []).find(fn) || null, get: () => ({ name: 'GM' }), activeGM: { id: 'u-gm' } },
  actors: { get: (id) => actors.get(id) || null, contents: [...actors.values()], [Symbol.iterator]: function* () { yield* actors.values(); } },
  settings: { get: (m, k) => settings[k] },
  journal: [],
  nightcity: {
    masterContactService: {
      getContact: (id) => master.find(c => c.id === id) || null,
      getByEmail: (e) => master.find(c => c.email === String(e || '').toLowerCase().trim()) || null,
      getByActorId: (id) => master.find(c => c.actorId === id) || null,
      getAll: () => master,
      isSendOnly: (e) => !!master.find(c => c.email === e)?.sendOnly,
    },
    contactRepository: {
      getActorEmail: (id) => flags.get(id) || '',
      verifyContact: (e) => { const mc = master.find(c => c.email === e); if (mc) return { verified: true, masterContactId: mc.id, actorId: mc.actorId }; const a = [...actors.values()].find(x => flags.get(x.id) === e); return a ? { verified: true, actorId: a.id } : { verified: false }; },
    },
    messageRepository: {
      createMessage: async (inbox, data) => { created.push({ inbox, data }); return { success: inbox === 'ghost' ? false : true, messageId: data.messageId, error: inbox === 'ghost' ? 'Could not access inbox journal' : undefined }; },
      getInboxJournal: async () => null,
    },
    socketManager: { emit: (op, data) => emitted.push({ op, data }) },
    soundService: { play: () => {} },
    eventBus: { emit: () => {}, on: () => {} },
    networkService: { currentNetworkId: 'citinet', getMessageAccessControl: () => null, signalStrength: 100, isDeadZone: false, getNetwork: () => null },
    terminalService: { mirrorDeliveryToAccounts: async () => {} },
    timeService: { getCurrentTime: () => '2077-10-20T12:00:00.000Z' },
  },
};
globalThis.foundry = { utils: { deepClone: (o) => JSON.parse(JSON.stringify(o)), mergeObject: (a, b) => ({ ...a, ...b }), randomID: (() => { let n = 0; return () => `id${++n}`; })() } };
globalThis.Hooks = { on: () => {}, once: () => {}, off: () => {} };
// DataValidator.sanitizeBody runs the body through a scratch <div>.
globalThis.document = { createElement: () => ({ _h: '', set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; }, querySelectorAll: () => [] }) };
globalThis.ui = { notifications: { info: (m) => toasts.push(['info', m]), warn: (m) => toasts.push(['warn', m]), error: (m) => toasts.push(['error', m]) } };

const P = await import(pathToFileURL(`${ROOT}/scripts/utils/participants.js`).href);
const { MessageService } = await import(pathToFileURL(`${ROOT}/scripts/services/MessageService.js`).href);
const { resolveThreads } = await import(pathToFileURL(`${ROOT}/scripts/utils/threading.js`).href);
const { DataValidator } = await import(pathToFileURL(`${ROOT}/scripts/data/DataValidator.js`).href);
const { SOCKET_OPS } = await import(pathToFileURL(`${ROOT}/scripts/utils/constants.js`).href);

const svc = Object.create(MessageService.prototype);
svc._messageQueue = [];
const reset = () => { created.length = 0; emitted.length = 0; toasts.length = 0; };
const base = () => ({ fromActorId: 'v', subject: 'Heist tonight', body: 'Be there.' });

// ═══ 1. participants.js — the member record ═══
{
  const m = P.makeMember({ email: '  Judy@MOX.nc ', name: ' Judy ', hint: { actorId: 'judy' } });
  ok(m.email === 'judy@mox.nc' && m.name === 'Judy' && m.kind === 'actor' && m.role === 'to', 'makeMember normalizes address/name, infers kind, defaults role');
  const d = P.dedupeMembers([{ email: 'A@x.nc', name: 'A' }, { email: 'a@x.nc', hint: { actorId: 'a1' } }, { hint: { actorId: 'a1' }, name: 'A again' }, { name: '' }]);
  ok(d.length === 2 && d[0].hint.actorId === 'a1', 'dedupe collapses casing + donates a later entry\'s hint; blanks dropped');
  const parts = [P.makeMember({ email: 'v@nightcity.net', hint: { actorId: 'v' }, role: 'from' }), P.makeMember({ email: 'judy@mox.nc' }), P.makeMember({ email: 'panam@aldecaldos.nc', hint: { actorId: 'panam' } })];
  const others = P.othersFor(parts, P.selfKeys({ actorId: 'panam', email: 'PANAM@aldecaldos.nc' }));
  ok(others.length === 2 && !others.some(p => p.hint.actorId === 'panam'), 'othersFor excludes self by actor id OR address');
}

// ═══ 2. resolveMember — the four steps, two worlds ═══
{
  const worldA = {
    getActor: (id) => ({ v: { id: 'v', name: 'V', email: 'v@nightcity.net' }, judy: { id: 'judy', name: 'Judy Alvarez', email: 'judy@mox.nc' } })[id] || null,
    getContact: (id) => ({ 'mc-rogue': { id: 'mc-rogue', name: 'Rogue', email: 'rogue@afterlife.nc', actorId: 'rogue' } })[id] || null,
    contactByEmail: (e) => (e === 'rogue@afterlife.nc' ? { id: 'mc-rogue', name: 'Rogue', email: e, actorId: 'rogue' } : null),
    actorByEmail: (e) => (e === 'judy@mox.nc' ? { id: 'judy', name: 'Judy Alvarez', email: e } : null),
    contactsByName: () => [], actorsByName: (k) => (k === 'judyalvarez' ? [{ id: 'judy', name: 'Judy Alvarez', email: 'judy@mox.nc' }] : []),
  };
  let r = P.resolveMember({ email: 'judy@mox.nc', hint: { actorId: 'judy' } }, worldA);
  ok(r.resolvedBy === 'hint' && r.actorId === 'judy' && !r.stale, '1. hint by id resolves first');
  r = P.resolveMember({ email: 'old@mox.nc', hint: { actorId: 'judy' } }, worldA);
  ok(r.resolvedBy === 'hint' && r.stale && r.email === 'judy@mox.nc', 'hint wins over a changed address, and reports it stale with the current address');
  r = P.resolveMember({ email: 'rogue@afterlife.nc', hint: { contactId: 'gone', actorId: 'gone' } }, worldA);
  ok(r.resolvedBy === 'email' && r.contactId === 'mc-rogue' && r.actorId === 'rogue', '2. dead hints → address → directory entry + its linked actor');
  r = P.resolveMember({ email: 'nope@x.nc', name: 'judy alvarez!' }, worldA);
  ok(r.resolvedBy === 'name' && r.actorId === 'judy', '3. unknown address → punctuation-insensitive name match');
  r = P.resolveMember({ email: 'stranger@x.nc', name: 'Nobody' }, worldA);
  ok(r.resolvedBy === null && r.email === 'stranger@x.nc', '4. unresolved keeps the address (still sendable as a raw address)');
  // Cross-world round trip: export from A (ids a*), import into B (ids b*), every id different.
  const exported = [{ email: 'judy@mox.nc', name: 'Judy Alvarez', kind: 'actor', hint: { actorId: 'judy' } }, { email: 'rogue@afterlife.nc', name: 'Rogue', kind: 'contact', hint: { contactId: 'mc-rogue' } }];
  const worldB = {
    getActor: () => null, getContact: () => null,
    contactByEmail: (e) => (e === 'rogue@afterlife.nc' ? { id: 'b-mc-9', name: 'Rogue', email: e, actorId: 'b-rogue' } : null),
    actorByEmail: (e) => (e === 'judy@mox.nc' ? { id: 'b-judy', name: 'Judy Alvarez', email: e } : null),
    contactsByName: () => [], actorsByName: () => [],
  };
  const back = exported.map(m => P.resolveMember(m, worldB));
  ok(back.every(x => x.resolvedBy === 'email') && back[0].actorId === 'b-judy' && back[1].contactId === 'b-mc-9', 'ROUND TRIP: members exported from world A re-resolve by ADDRESS in world B where every id differs');
}

// ═══ 3. _normalizeRecipients ═══
{
  ok(svc._normalizeRecipients({ recipients: [{ actorId: 'v' }, { email: 'X@y.nc' }, { actorId: 'v' }, { email: 'x@y.nc' }] }).length === 2, 'recipients list wins and de-dupes (id, address casing)');
  ok(svc._normalizeRecipients({ toActorId: ['v', 'judy'] }).length === 2, 'the legacy ARRAY toActorId (old multi-chip composer) normalizes to two');
  ok(svc._normalizeRecipients({ toActorId: 'v' }).length === 1 && svc._normalizeRecipients({}).length === 0, 'single + empty');
  ok(svc._normalizeRecipients({ anonReply: { parentMessageId: 'p' } }).length === 0, 'an anonymous reply names nobody (the GM resolves it)');
}

// ═══ 4. GM fan-out: 3 recipients → 3 copies + 1 sent copy ═══
{
  reset();
  const r = await svc.sendMessage({ ...base(), recipients: [{ actorId: 'panam' }, { actorId: 'judy' }, { contactId: 'mc-rogue' }] });
  ok(r.success && r.delivered === 3 && r.failed.length === 0, 'fan-out delivers to all three');
  const inboxCopies = created.filter(c => !c.data.status?.sent);
  const sent = created.filter(c => c.data.status?.sent);
  ok(inboxCopies.length === 3 && sent.length === 1, 'three inbox copies, ONE sent copy');
  ok(new Set(created.map(c => c.data.messageId.replace(/-sent$/, ''))).size === 1, 'every copy shares one base messageId');
  ok(new Set(created.map(c => c.data.threadId)).size === 1, 'every copy shares one threadId');
  const copy = inboxCopies.find(c => c.inbox === 'judy')?.data || {};
  ok(copy.to === 'judy@mox.nc' && copy.toActorId === 'judy' && copy.toName === 'Judy Alvarez', 'each copy is addressed to its own recipient only');
  ok(Array.isArray(copy.participants) && copy.participants.length === 4, 'each copy carries the whole party (sender + 3)');
  ok(copy.participants[0].role === 'from' && copy.participants[0].email === 'v@nightcity.net' && copy.participants[0].hint.actorId === 'v', 'the sender rides as role:from, address-keyed with an actor hint');
  ok(copy.participants.find(p => p.hint.contactId === 'mc-rogue')?.email === 'rogue@afterlife.nc', 'a directory recipient carries its address + contact hint');
  ok(sent[0].inbox === 'v' && sent[0].data.to === 'panam@aldecaldos.nc, judy@mox.nc, rogue@afterlife.nc' && /Panam Palmer, Judy Alvarez, Rogue/.test(sent[0].data.toName), 'the sent copy lists everyone (addresses + names)');
  ok(!('_fanout' in sent[0].data) && !('_recipientInboxId' in sent[0].data), 'internal fields never persist');
  ok(emitted.filter(e => e.op === SOCKET_OPS.MESSAGE_NOTIFY).length === 3, 'one recipient toast per actor-backed copy (the directory entry resolves to its linked actor)');
}

// ═══ 5. Partial failure: an inbox that can't be written is reported, the rest land ═══
{
  reset();
  actors.set('ghost', mkActor('ghost', 'Ghost'));
  const r = await svc.sendMessage({ ...base(), recipients: [{ actorId: 'panam' }, { actorId: 'ghost' }] });
  actors.delete('ghost');
  ok(r.success && r.delivered === 1 && r.failed.length === 1 && r.failed[0].name === 'Ghost' && /inbox journal/.test(r.failed[0].error), 'partial: one delivered, the failure names who and why');
  ok(created.some(c => c.data.status?.sent), 'a partial success still writes the sent copy');
}

// ═══ 6. Everyone refused → nothing written, nothing relayed ═══
{
  reset();
  game.user = { id: 'u-p', isGM: false };
  const r = await svc.sendMessage({ ...base(), recipients: [{ email: 'system@localhost' }, { email: 'stranger@nowhere.nc' }] });
  ok(!r.success && r.errorCode === 'ALL_RECIPIENTS_FAILED' && r.failed.length === 2, 'player: send-only + unknown → all refused with reasons');
  ok(r.failed.find(x => x.errorCode === 'SEND_ONLY') && r.failed.find(x => x.errorCode === 'NOT_FOUND'), 'each refusal keeps its own errorCode');
  ok(created.length === 0 && emitted.length === 0, 'nothing written or relayed when every recipient fails');
  game.user = { id: 'u-gm', isGM: true };
}

// ═══ 7. Player relay carries the copies; GM acks once with per-recipient results ═══
{
  reset();
  game.user = { id: 'u-p', isGM: false };
  const p = svc.sendMessage({ ...base(), recipients: [{ actorId: 'panam' }, { actorId: 'judy' }, { email: 'system@localhost' }] });
  await new Promise(r => setTimeout(r, 10));
  const relay = emitted.find(e => e.op === SOCKET_OPS.MESSAGE_RELAY);
  ok(relay && Array.isArray(relay.data._fanout) && relay.data._fanout.length === 2, 'ONE relay carrying the two deliverable copies (the send-only one refused locally)');
  ok(relay.data._fanout.every(c => Array.isArray(c.participants) && c.participants.length === 3), 'relayed copies carry participants (sender + the two who passed)');
  // GM side handles it
  game.user = { id: 'u-gm', isGM: true };
  await svc.handleMessageRelay(relay.data, 'u-p');
  const ack = emitted.find(e => e.op === SOCKET_OPS.MESSAGE_DELIVERED);
  ok(ack && ack.data.delivered === 2 && ack.data.forUserId === 'u-p' && Array.isArray(ack.data.results), 'GM fans out and acks with delivered count + results');
  ok(created.filter(c => c.data.status?.sent).length === 1, 'the GM wrote exactly one sent copy for the relayed fan-out');
  game.user = { id: 'u-p', isGM: false };
  svc.handleDeliveryConfirmation(ack.data);
  const r = await p;
  ok(r.success && r.delivered === 2 && r.failed.length === 1 && r.failed[0].errorCode === 'SEND_ONLY', 'player result merges the local refusal with the GM ack');
  game.user = { id: 'u-gm', isGM: true };
}

// ═══ 8. Anonymous: the recipient copy never names the sender in participants ═══
{
  const masked = svc._maskAnonForRecipient({ anonymous: { enabled: true, alias: 'GHOST' }, from: 'v@nightcity.net', fromActorId: 'v', participants: [P.makeMember({ email: 'v@nightcity.net', hint: { actorId: 'v' }, role: 'from' }), P.makeMember({ email: 'judy@mox.nc' })] });
  ok(masked.participants.length === 1 && masked.participants[0].email === 'judy@mox.nc', 'anon mask strips the role:from participant');
}

// ═══ 9. Reply All ═══
{
  const parts = [P.makeMember({ email: 'v@nightcity.net', name: 'V', hint: { actorId: 'v' }, role: 'from' }), P.makeMember({ email: 'panam@aldecaldos.nc', name: 'Panam Palmer', hint: { actorId: 'panam' } }), P.makeMember({ email: 'judy@mox.nc', name: 'Judy Alvarez', hint: { actorId: 'judy' } }), P.makeMember({ email: 'rogue@afterlife.nc', name: 'Rogue', hint: { contactId: 'mc-rogue' } })];
  const orig = { messageId: 'm1', subject: 'Heist tonight', fromActorId: 'v', from: 'v@nightcity.net', participants: parts };
  const all = svc.buildReply(orig, 'judy', 'count me in', { all: true });
  ok(Array.isArray(all.recipients) && all.recipients.length === 3 && !all.recipients.some(r => r.actorId === 'judy'), 'Reply All → sender + the other two, never the replier');
  ok(all.recipients.find(r => r.contactId === 'mc-rogue')?.email === 'rogue@afterlife.nc', 'contact participants come back with address + contact id');
  ok(all.toActorId === 'v' && all.inReplyTo === 'm1', 'the plain reply target is still set alongside');
  const plain = svc.buildReply(orig, 'judy', 'x');
  ok(!plain.recipients, 'plain Reply has no recipients list');
  ok(svc.replyAllRecipients({ ...orig, anonymous: { enabled: true } }, 'judy').length === 0, 'anonymous mail → no Reply All (the mask would leak)');
  ok(svc.replyAllRecipients({ ...orig, participants: [] }, 'judy').length === 0, 'legacy one-to-one mail (no participants) → no Reply All');
}

// ═══ 10. Threading over the party ═══
{
  const mk = (id, subject, from, parts, extra = {}) => ({ messageId: id, subject, from, fromActorId: from.split('@')[0], timestamp: '2077-10-20T12:00:00Z', participants: parts, ...extra });
  const crew = [P.makeMember({ email: 'v@nightcity.net', hint: { actorId: 'v' }, role: 'from' }), P.makeMember({ email: 'judy@mox.nc', hint: { actorId: 'judy' } }), P.makeMember({ email: 'panam@aldecaldos.nc', hint: { actorId: 'panam' } })];
  const other = [P.makeMember({ email: 'rogue@afterlife.nc', hint: { contactId: 'mc-rogue' }, role: 'from' }), P.makeMember({ email: 'judy@mox.nc', hint: { actorId: 'judy' } }), P.makeMember({ email: 'kerry@eurodyne.nc' })];
  const viewer = { viewingActorId: 'judy', viewingKeys: P.selfKeys({ actorId: 'judy', email: 'judy@mox.nc' }), subjectThreading: true };
  // Same subject, two different groups that share ONLY the viewer → must NOT merge.
  let { groupOf } = resolveThreads([mk('a', 'Payday', 'v@nightcity.net', crew), mk('b', 'Payday', 'rogue@afterlife.nc', other)], viewer);
  ok(groupOf.get('a') !== groupOf.get('b'), 'two group threads sharing only ME (the viewer) stay separate');
  // Same subject, the other group also contains Panam → merge.
  const other2 = [...other, P.makeMember({ email: 'panam@aldecaldos.nc', hint: { actorId: 'panam' } })];
  ({ groupOf } = resolveThreads([mk('a', 'Payday', 'v@nightcity.net', crew), mk('b', 'RE: Payday', 'rogue@afterlife.nc', other2)], viewer));
  ok(groupOf.get('a') === groupOf.get('b'), 'a shared counterparty OTHER than the viewer merges them');
  // A member's reply-all (threadId carried) joins the original group's thread.
  ({ groupOf } = resolveThreads([mk('a', 'Payday', 'v@nightcity.net', crew, { threadId: 'a' }), mk('c', 'RE: Payday', 'panam@aldecaldos.nc', crew, { threadId: 'a', inReplyTo: 'a' })], viewer));
  ok(groupOf.get('a') === groupOf.get('c'), 'a Reply All copy threads into the original conversation');
  // Legacy mail without participants still threads as before.
  ({ groupOf } = resolveThreads([{ messageId: 'x', subject: 'Hi', from: 'v@nightcity.net', fromActorId: 'v', to: 'judy@mox.nc' }, { messageId: 'y', subject: 'RE: Hi', from: 'v@nightcity.net', fromActorId: 'v', to: 'judy@mox.nc' }], viewer));
  ok(groupOf.get('x') === groupOf.get('y'), 'pre-fan-out mail (no participants) threads exactly as before');
}

// ═══ 11. Validator ═══
{
  ok(DataValidator.validateMessage({ fromActorId: 'v', subject: 's', recipients: [{ actorId: 'judy' }] }).valid, 'a recipients list satisfies "recipient required"');
  ok(!DataValidator.validateMessage({ fromActorId: 'v', subject: 's', recipients: [] }).valid, 'an empty list does not');
}

// ═══ 12. Drift guards ═══
{
  for (const [f, re] of [
    ['scripts/data/MessageRepository.js', /participants: Array\.isArray\(messageData\.participants\)/],
    ['scripts/data/MessageRepository.js', /participants: Array\.isArray\(flags\.participants\)/],
    ['scripts/services/TerminalService.js', /participants: Array\.isArray\(data\.participants\)/],
  ]) ok(re.test(readFileSync(`${ROOT}/${f}`, 'utf8')), `${f} persists participants (the field-by-field rule)`);
  const composer = readFileSync(`${ROOT}/scripts/ui/MessageComposer/MessageComposerApp.js`, 'utf8');
  ok(/recipients: \(sendList\.length > 1 \|\| hasGroup\) \? sendList : undefined/.test(composer), 'composer sends a recipients list for 2+ chips or any group chip');
  ok(/eddiesTotal/.test(composer) && /this\.eddiesAmount \* result\.failed\.length/.test(composer), 'composer debits eddies × recipients and refunds the failed share');
  ok(/\{ all: !!options\.replyAll \}/.test(composer), 'composer asks buildReply for Reply All');
  ok(/replyAll: options\.replyAll \?\? false/.test(readFileSync(`${ROOT}/scripts/init/registerMessagingSystem.js`, 'utf8')), 'the compose launcher forwards replyAll');
  const viewer = readFileSync(`${ROOT}/scripts/ui/MessageViewer/MessageViewerApp.js`, 'utf8');
  ok(/case 'reply-all-message'/.test(viewer) && /viewingKeys/.test(viewer), 'viewer routes Reply All and passes its own keys to threading');
  const tpl = readFileSync(`${ROOT}/templates/message-viewer/partials/message-detail.hbs`, 'utf8');
  ok((tpl.match(/data-action="reply-all-message"/g) || []).length === 2 && /message\.participantCount/.test(tpl), 'detail template has Reply All beside both Reply buttons + the party chip');
}

console.log(`\ntest-group-send: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
