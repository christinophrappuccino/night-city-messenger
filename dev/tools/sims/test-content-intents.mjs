// Sim: content actions are intents the GM re-checks (audit remediation A3a: SEC-04).
//
// CONTENT_UPDATE_REQUEST, BANK_SIPHON_REQUEST and PAYLOAD_EFFECT_REQUEST used to carry
// a player's whole new contentData (or a free-form run request) and the GM wrote it as
// sent. Now a player's client relays an INTENT; the GM re-reads the stored entry, checks
// the sender can see it and owns the named character, and computes the change itself
// (scripts/utils/contentIntents.js, shared with the client flows).
//
// Checks: the pure rules for every action (allowed and refused), then the REAL GM
// handlers in SiphonFlow over a small world (two players, a GM, a shared shard journal
// and one player's private inbox), then source guards on the relays.
import fs from 'fs';
import { pathToFileURL, fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const load = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
const read = (p) => fs.readFileSync(`${ROOT}/${p}`, 'utf8');
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };

// ═══ 1. The pure rules ═══
const CI = await load('scripts/utils/contentIntents.js');
const ctx = { actorId: 'a1', actorName: 'V', nowIso: '2045-08-14T10:00:00.000Z', realIso: '2026-11-04T00:00:00.000Z', realMs: 123, clock: '10:00:00' };
const A = (type, cd, intent) => CI.applyContentIntent(type, cd, intent, ctx);
{
  const r = A('eddies', { amount: 500 }, { action: 'claim' });
  ok(r.ok && r.next.claimed && r.next.claimedBy === 'a1' && r.next.claimedAt === ctx.nowIso && r.next.claimedRealMs === 123, 'claim marks it claimed, by whom, game + real time');
  ok(!A('eddies', { amount: 500, claimed: true }, { action: 'claim' }).ok, 'claim refused when already claimed');
  ok(!A('eddies', { amount: 0 }, { action: 'claim' }).ok, 'claim refused with nothing to claim');
  ok(!CI.applyContentIntent('eddies', { amount: 5 }, { action: 'claim' }, { ...ctx, actorId: null }).ok, 'claim refused with no character');
  ok(!A('banking', { amount: 500 }, { action: 'claim' }).ok, 'an action on the wrong content type is refused');
  ok(!A('eddies', { amount: 500 }, { action: 'setBalance' }).ok, 'an unknown action is refused');

  const creds = { entries: [{ host: 'arasaka', encrypted: true }, { host: 'open' }] };
  ok(A('credentials', creds, { action: 'crack', index: 0 }).next.entries[0].cracked === true, 'crack opens that login');
  ok(!A('credentials', creds, { action: 'crack', index: 1 }).ok && !A('credentials', creds, { action: 'crack', index: 9 }).ok, 'crack refused on an open or missing login');

  const gal = { images: [{ locked: true }, { locked: false }] };
  const u = A('gallery', gal, { action: 'unlock', kind: 'gallery', index: 0 });
  ok(u.ok && u.next.images[0].locked === false && u.next.images[1].locked === false, 'unlock opens that frame only');
  ok(!A('gallery', gal, { action: 'unlock', kind: 'gallery', index: 1 }).ok, 'unlock refused on an open frame');
  ok(!A('gallery', gal, { action: 'unlock', kind: 'avlog' }).ok, 'an unlock kind for another content type is refused');
  ok(A('location', { locked: true }, { action: 'unlock', kind: 'location' }).next.revealedAt === ctx.realIso, 'location reveal stamps real time (the reveal animation)');
  ok(A('dossier', { faceLocked: true }, { action: 'unlock', kind: 'dossier-face' }).next.faceRevealed === true, 'dossier face');
  ok(A('dossier', { profile: { enabled: true, visibility: 'encrypted' } }, { action: 'unlock', kind: 'dossier-profile' }).next.profile.decrypted === true, 'dossier profile');
  ok(A('document', { declassify: true, paragraphs: [{ redacted: true }, { redacted: false }] }, { action: 'unlock', kind: 'document' }).next.paragraphs[0].declassified === true, 'declassify a document');
  ok(!A('document', { declassify: false, paragraphs: [{ redacted: true }] }, { action: 'unlock', kind: 'document' }).ok, 'declassify refused when the file has none armed');
  ok(A('spreadsheet', { declassify: true, redacted: ['A1'] }, { action: 'unlock', kind: 'spreadsheet' }).next.redacted.length === 0, 'declassify a spreadsheet');

  const cam = { images: [{ label: 'CAM_01' }] };
  ok(A('gallery', cam, { action: 'camLoop', index: 0 }).next.images[0].loopedTime === '10:00:00', 'a looped cam freezes on the writer\'s clock');
  ok(A('gallery', cam, { action: 'camCut', index: 0 }).next.images[0].cut === true, 'cut');
  ok(!A('gallery', { images: [{ looped: true }] }, { action: 'camLoop', index: 0 }).ok, 'loop refused when already looped');

  const bank = { balance: 10000, siphonMode: 'cap', siphonCap: 2000, accountName: 'Ops', transactions: [] };
  const s = A('banking', bank, { action: 'siphon', amount: 1500 });
  ok(s.ok && s.next.balance === 8500 && s.next.siphoned && s.next.transactions[0].amount === 1500, 'siphon drains within the cap');
  ok(!A('banking', bank, { action: 'siphon', amount: 5000 }).ok, 'siphon refused above the account\'s cap');
  ok(!A('banking', bank, { action: 'siphon', amount: -50 }).ok && !A('banking', bank, { action: 'siphon', amount: 0 }).ok, 'siphon refused for 0 or less');
  ok(!A('banking', { ...bank, siphoned: true }, { action: 'siphon', amount: 10 }).ok, 'siphon refused on a drained account');
  ok(!A('banking', { ...bank, status: 'frozen' }, { action: 'siphon', amount: 10 }).ok, 'siphon refused on a frozen account');
  ok(!A('banking', bank, { action: 'freeze' }).ok, 'freeze refused when the account has no lockout');
  ok(A('banking', { ...bank, siphonLockout: true }, { action: 'freeze' }).next.status === 'frozen', 'freeze an account that locks out');

  ok(A('malware', { deployable: true, honeypot: true }, { action: 'deploy', tripped: false }).next.tripped === true, 'a honeypot always trips, whatever the client says');
  ok(A('malware', { deployable: true }, { action: 'deploy' }).next.tripped === false, 'a clean deploy');
  ok(!A('malware', { deployable: true, deployed: true }, { action: 'deploy' }).ok && !A('malware', {}, { action: 'deploy' }).ok, 'deploy refused when done or not deployable');
  ok(A('payload', { disguised: true }, { action: 'sniff' }).next.sniffed === true && A('malware', { disguised: true }, { action: 'sniff' }).ok, 'sniff (payload or malware)');
  ok(!A('payload', { disguised: false }, { action: 'sniff' }).ok, 'sniff refused on an honest file');
  ok(JSON.stringify(CI.sanitizeIntent({ action: 'claim', index: '2', newContentData: { claimed: false }, gmToast: '<img>' })) === '{"action":"claim","index":2}', 'only intent fields survive the wire');
}

// ═══ 2. The REAL GM handlers ═══
const MOD = 'night-city-messenger';
const users = {
  gm: { id: 'gm', name: 'GM', isGM: true },
  p1: { id: 'p1', name: 'Rache', isGM: false },
  p2: { id: 'p2', name: 'Kaz', isGM: false },
};
const actors = {
  a1: { id: 'a1', name: 'V', owners: ['p1'] },
  a2: { id: 'a2', name: 'Judy', owners: ['p2'] },
};
for (const a of Object.values(actors)) a.testUserPermission = (u) => !!u.isGM || a.owners.includes(u.id);
// journal → who may read it (the shard journal is OBSERVER for everyone; an inbox only for its owner)
const readers = { 'j-shard': 'all', 'j-inbox-p2': ['p2'], 'j-term': 'all' };
const pages = [];
const page = (messageId, contentType, contentData, journalId = 'j-shard') => {
  const p = {
    id: `pg-${messageId}`, journalId,
    flags: { [MOD]: { messageId, contentType, contentData: JSON.parse(JSON.stringify(contentData)) } },
    testUserPermission: (u) => !!u.isGM || readers[journalId] === 'all' || (readers[journalId] || []).includes(u.id),
    async update(diff) { const v = diff[`flags.${MOD}.contentData`]; if (v) this.flags[MOD].contentData = JSON.parse(JSON.stringify(v)); return this; },
    get parent() { return journals.get(journalId); },
  };
  pages.push(p);
  return p;
};
const journals = new Map();
for (const id of Object.keys(readers)) {
  journals.set(id, { id, getFlag: () => null, pages: { find: (fn) => pages.filter((p) => p.journalId === id).find(fn), get contents() { return pages.filter((p) => p.journalId === id); } } });
}
const terminal = { id: 'term1', uuid: 'Item.term1', name: 'WS-7F', getFlag: (m, k) => ({ isTerminal: true, journalId: 'j-term' }[k] ?? null) };
const plainItem = { id: 'gun', uuid: 'Item.gun', name: 'Pistol', getFlag: () => null };
const uuids = { [terminal.uuid]: terminal, [plainItem.uuid]: plainItem };
const toasts = [];
const warns = [];
globalThis.game = {
  user: users.gm,
  users: { get: (id) => users[id] ?? null, activeGM: users.gm, find: (fn) => Object.values(users).find(fn) ?? null, filter: (fn) => Object.values(users).filter(fn) },
  actors: { get: (id) => actors[id] ?? null },
  macros: { get: () => null },
  items: [], journal: { get: (id) => journals.get(id) ?? null, [Symbol.iterator]: () => journals.values() },
  settings: { get: () => { throw new Error('none'); } },
  i18n: { localize: (s) => s },
  nightcity: { soundService: { play() {} }, traceService: { logSuccess() {}, fireTrace() {} }, eventBus: { emit() {} } },
};
globalThis.ui = { notifications: { info: (m) => toasts.push(m), warn: (m) => toasts.push(m), error: (m) => toasts.push(m) } };
globalThis.Hooks = { on() {}, off() {}, once() {}, call() {}, callAll() {} };
globalThis.CONFIG = { debug: {} };
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OBSERVER: 2, OWNER: 3 } };
globalThis.foundry = {
  utils: { deepClone: (o) => JSON.parse(JSON.stringify(o)), mergeObject: (a, b) => ({ ...a, ...b }), randomID: () => 'rid', debounce: (f) => f, getProperty: (o, p) => p.split('.').reduce((a, k) => a?.[k], o) },
  applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (B) => B }, instances: new Map() },
};
globalThis.fromUuid = async (u) => uuids[u] ?? null;
globalThis.fromUuidSync = (u) => uuids[u] ?? null;
globalThis.ChatMessage = { create: async () => ({}) };
const origWarn = console.warn; console.warn = (...a) => warns.push(a.join(' '));

const SF = await load('scripts/ui/content/SiphonFlow.js');
const cdOf = (id) => pages.find((p) => p.flags[MOD].messageId === id).flags[MOD].contentData;

{
  page('edd', 'eddies', { amount: 500 });
  await SF.handleContentUpdateRequest({ messageId: 'edd', intent: { action: 'claim' }, actorId: 'a1' }, 'p1');
  ok(cdOf('edd').claimed === true && cdOf('edd').claimedBy === 'a1', 'a player claims eddies they can see, as their character');
  ok(toasts.at(-1) === 'NCM | V claimed 500 eb.', 'the GM writes its own toast from what is stored');
  // the attack the audit found: resetting a claim with a whole new contentData
  await SF.handleContentUpdateRequest({ messageId: 'edd', newContentData: { amount: 999999, claimed: false }, gmToast: '<img src=x onerror=alert(1)>' }, 'p1');
  ok(cdOf('edd').claimed === true && cdOf('edd').amount === 500, 'a whole new contentData is ignored (no intent = nothing)');
  ok(!toasts.some((t) => t.includes('<img')), 'a gmToast from the wire is never shown');

  page('edd2', 'eddies', { amount: 100 });
  await SF.handleContentUpdateRequest({ messageId: 'edd2', intent: { action: 'claim' }, actorId: 'a2' }, 'p1');
  ok(!cdOf('edd2').claimed, 'claiming as someone else\'s character is refused');
  await SF.handleContentUpdateRequest({ messageId: 'edd2', intent: { action: 'claim' }, actorId: 'a1' }, null);
  ok(!cdOf('edd2').claimed, 'no verified sender: refused');

  page('inbox-edd', 'eddies', { amount: 300 }, 'j-inbox-p2');
  await SF.handleContentUpdateRequest({ messageId: 'inbox-edd', intent: { action: 'claim' }, actorId: 'a1' }, 'p1');
  ok(!cdOf('inbox-edd').claimed, 'acting on another player\'s inbox is refused (they cannot see it)');
  await SF.handleContentUpdateRequest({ messageId: 'inbox-edd', intent: { action: 'claim' }, actorId: 'a2' }, 'p2');
  ok(cdOf('inbox-edd').claimed && cdOf('inbox-edd').claimedBy === 'a2', 'the inbox owner can');

  page('creds', 'credentials', { entries: [{ host: 'arasaka', encrypted: true }] });
  await SF.handleContentUpdateRequest({ messageId: 'creds', intent: { action: 'crack', index: 0 }, actorId: 'a1' }, 'p1');
  ok(cdOf('creds').entries[0].cracked === true, 'crack through the relay');

  page('gal', 'gallery', { images: [{ locked: true }, { locked: true }] });
  await SF.handleContentUpdateRequest({ messageId: 'gal', intent: { action: 'unlock', kind: 'gallery', index: 1 } }, 'p1');
  ok(cdOf('gal').images[1].locked === false && cdOf('gal').images[0].locked === true, 'unlock one frame, no character needed');

  page('bank', 'banking', { balance: 10000, siphonMode: 'cap', siphonCap: 2000, accountName: 'Ops' });
  await SF.handleSiphonRequest({ outcome: 'success', messageId: 'bank', amount: 9000, actorId: 'a1' }, 'p1');
  ok(cdOf('bank').balance === 10000 && !cdOf('bank').siphoned, 'a siphon over the account\'s cap is refused');
  await SF.handleSiphonRequest({ outcome: 'success', messageId: 'bank', amount: 1500, actorId: 'a1', newContentData: { balance: 99999999 } }, 'p1');
  ok(cdOf('bank').balance === 8500 && cdOf('bank').siphoned, 'a siphon drains what the account allows; a sent balance is ignored');
  ok(/SIPHON: V drained 1,500/.test(toasts.at(-1)), 'siphon toast names the character, read on the GM');
  await SF.handleContentUpdateRequest({ messageId: 'bank', intent: { action: 'freeze' } }, 'p1');
  ok(cdOf('bank').status !== 'frozen', 'freeze refused on an account with no lockout');

  page('mal', 'malware', { deployable: true, honeypot: true, name: 'Bait.exe' });
  await SF.handleContentUpdateRequest({ messageId: 'mal', intent: { action: 'deploy', tripped: false }, actorId: 'a1' }, 'p1');
  ok(cdOf('mal').deployed && cdOf('mal').tripped === true, 'a honeypot deploy trips even when the client says clean');
}

// ── Program runs (PAYLOAD_EFFECT_REQUEST) ──
{
  page('prog', 'payload', { name: 'Ice.exe', executed: true, effect: { type: 'adjudicate' } });
  ok(!SF.checkPayloadRequest({ messageId: 'prog', outcome: 'success', actorId: 'a1' }, 'p1').ok, 'a program already run is refused');
  page('prog2', 'payload', { name: 'Wiper', effect: { type: 'wipe' } }, 'j-term');
  page('file-a', 'message', {}, 'j-term');
  page('file-b', 'message', {}, 'j-term');
  const t = SF.checkPayloadRequest({ messageId: 'prog2', outcome: 'success', actorId: 'a1', targets: ['file-a', 'edd', 'prog2', 'file-b', 'file-a'] }, 'p1');
  ok(t.ok && JSON.stringify(t.targets) === '["file-a","file-b"]', 'targets are cut to files on the program\'s own host, never itself');
  ok(!SF.checkPayloadRequest({ messageId: 'prog2', outcome: 'kill', actorId: 'a1' }, 'p1').ok, 'kill refused when nothing is running');
  ok(!SF.checkPayloadRequest({ messageId: 'prog2', outcome: 'explode', actorId: 'a1' }, 'p1').ok, 'an unknown outcome is refused');
  ok(!SF.checkPayloadRequest({ messageId: 'edd', outcome: 'success', actorId: 'a1' }, 'p1').ok, 'a run against a non-program entry is refused');
  ok(!SF.checkPayloadRequest({ messageId: 'prog2', outcome: 'success', actorId: 'a2' }, 'p1').ok, 'a run as someone else\'s character is refused');
  page('mal2', 'malware', { deployable: true, effect: { type: 'jammer' } });
  ok(SF.checkPayloadRequest({ kind: 'malware', messageId: 'mal2', actorId: 'a1' }, 'p1').ok, 'a clean malware effect is allowed');
  ok(!SF.checkPayloadRequest({ kind: 'malware', messageId: 'mal', actorId: 'a1' }, 'p1').ok, 'an already-deployed honeypot cannot run an effect');

  const up = (o) => SF.checkUploadRunRequest({ kind: 'uploadRun', itemUuid: terminal.uuid, effectType: 'wipe', actorId: 'a1', params: { messageIds: ['file-a', 'edd'] }, ...o }, 'p1');
  const good = await up({});
  ok(good.ok && JSON.stringify(good.params.messageIds) === '["file-a"]', 'an upload run on a terminal, file targets cut to that terminal');
  ok(!(await up({ actorId: 'a2' })).ok, 'upload run as someone else\'s character refused');
  ok(!(await up({ effectType: 'jammer' })).ok, 'a verb that does not write a box is refused');
  ok(!(await up({ itemUuid: plainItem.uuid })).ok, 'an upload run on something that is not a terminal is refused');
  ok(!('macroId' in (await up({ params: { macroId: 'm' } })).params), 'macro ids are stripped from params');
}
console.warn = origWarn;

// ═══ 3. Source guards ═══
const sf = read('scripts/ui/content/SiphonFlow.js');
const sh = read('scripts/integrations/SocketHandlers.js');
const relayBody = (op) => { const i = sf.indexOf(`emit(SOCKET_OPS.${op}, {`); return sf.slice(i, sf.indexOf('});', i)); };
ok(!/newContentData|gmToast/.test(relayBody('CONTENT_UPDATE_REQUEST')), 'CONTENT_UPDATE_REQUEST carries no contentData and no toast');
ok(!/newContentData|accountLabel|actorName/.test(relayBody('BANK_SIPHON_REQUEST')), 'BANK_SIPHON_REQUEST carries no contentData and no display text');
for (const op of ['BANK_SIPHON_REQUEST', 'CONTENT_UPDATE_REQUEST', 'PAYLOAD_EFFECT_REQUEST']) {
  ok(new RegExp(`register\\(SOCKET_OPS\\.${op}, async \\(data, sender\\)`).test(sh), `${op} handler takes the verified sender`);
}
ok(/handlePayloadEffectRequest\(data, sender\)/.test(sh) && !/flow\.applyPayloadKill\(/.test(sh), 'kill goes through the checked handler too');
// every client-side write goes through the shared rule, except the GM-only tools
const direct = [...sf.matchAll(/await persistContentData\(/g)].length;
ok(direct === 4, `only the GM-only paths (schematic lock, camera restore / force loop / force cut) call persistContentData directly (${direct})`);
ok(read('scripts/services/DataShardService.js').includes("applyContentIntent(CONTENT_TYPES.EDDIES"), 'the shard claim uses the shared rule');

console.log(`test-content-intents: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
