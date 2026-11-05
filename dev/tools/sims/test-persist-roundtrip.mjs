// Sim: message fields survive save → read (audit remediation E1: DATA-13, DATA-19, INT-04; the plan's T9).
//
// MessageRepository.createMessage builds the stored flags FIELD BY FIELD, so anything it does not name is dropped —
// that is how spam routes, recovered mail and folders were lost before. This round-trips a message carrying every
// field the module writes through the REAL createMessage and the REAL _pageToMessage reader, and fails on any loss.
//   DATA-13  signalDegradation (low-signal garble + Reconstruct) was never stored — dev 2026-11-05: players' sends only
//   DATA-19  isBroadcast (the admin broadcast icon) was never stored
//   INT-04   metadata.tapLog (a tapped conversation's running log) was dropped, so the log restarted
import { pathToFileURL, fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const read = (p) => readFileSync(`${ROOT}/${p}`, 'utf8');
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };
const MOD = 'night-city-messenger';

const pages = [];
const journal = { id: 'j1', pages, async createEmbeddedDocuments(t, docs) { const out = docs.map((d) => ({ id: `p${pages.length}`, ...JSON.parse(JSON.stringify(d)) })); out.forEach((p) => { p.parent = journal; }); pages.push(...out); return out; } };
globalThis.game = { user: { id: 'gm', isGM: true }, users: { get: () => null }, actors: { get: () => null }, journal: Object.assign([journal], { get: () => journal }), settings: { get: () => undefined }, nightcity: {} };
globalThis.foundry = { utils: { deepClone: (o) => JSON.parse(JSON.stringify(o)), randomID: () => 'r' } };
globalThis.Hooks = { on() {}, off() {}, once() {} };
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };

const { MessageRepository } = await import(pathToFileURL(`${ROOT}/scripts/data/MessageRepository.js`).href);
const repo = Object.create(MessageRepository.prototype);
repo.getInboxJournal = async () => journal;
repo._resolveSenderName = () => 'V';

const deg = { originalSignal: 18, corruptionLevel: 'heavy', reconstructed: false, reconstructDC: 18, reconstructSkill: 'Electronics/Security Tech' };
const tapLog = [{ when: '2045-08-14T10:00:00Z', who: 'V', what: 'Meet at the Afterlife.' }];
const sent = {
  messageId: 'm1', threadId: 't1', inReplyTo: 'p0', references: ['p0'], from: 'v@nc', fromActorId: 'aV', fromContactId: 'cV',
  to: 'rogue@afterlife.nc', toActorId: 'aR', toContactId: 'cR', subject: 'Job', body: '<p>hi</p>', priority: 'urgent',
  timestamp: '2045-08-14T10:00:00Z', network: 'CITINET', eddies: 500, isBroadcast: true, signalDegradation: deg,
  participants: [{ email: 'v@nc', role: 'from' }, { email: 'rogue@afterlife.nc', role: 'to' }],
  status: { read: false, spam: true }, anonymous: { enabled: true, alias: 'GHOST' },
  metadata: { recovered: true, recoveredFrom: 'TAP · Relay', spamSource: 'generator', tapLog },
};
const r = await repo.createMessage('aR', sent);
ok(r.success, 'the message is saved');
const back = repo._pageToMessage(pages[0]);

// ═══ 1. The three fields E1 fixes ═══
ok(back.signalDegradation?.corruptionLevel === 'heavy' && back.signalDegradation.reconstructDC === 18, 'low-signal garble survives (DATA-13) — the Reconstruct roll can now happen');
ok(back.isBroadcast === true, 'a broadcast stays a broadcast (DATA-19) — the admin feed can show its icon');
ok(back.metadata?.tapLog?.[0]?.what === 'Meet at the Afterlife.', 'a tapped conversation\'s log survives (INT-04)');

// ═══ 2. Everything else the module writes, so the next dropped field fails here ═══
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
for (const k of ['messageId', 'threadId', 'inReplyTo', 'from', 'fromActorId', 'fromContactId', 'to', 'toActorId', 'toContactId', 'subject', 'priority', 'timestamp', 'network', 'eddies']) {
  ok(same(back[k], sent[k]), `${k} survives`);
}
ok(same(back.references, sent.references) && same(back.participants, sent.participants), 'references and participants survive');
ok(back.status?.spam === true && back.anonymous?.alias === 'GHOST', 'the spam route and the anonymous block survive');
ok(back.metadata?.recovered && back.metadata.recoveredFrom === 'TAP · Relay' && back.metadata.spamSource === 'generator', 'recovered and spam provenance survive');

// ═══ 3. A message without them stays clean ═══
pages.length = 0;
await repo.createMessage('aR', { messageId: 'm2', from: 'a@b', subject: 's', body: '', status: {} });
const plain = repo._pageToMessage(pages[0]);
ok(plain.isBroadcast === false && plain.signalDegradation === null && plain.metadata?.tapLog === undefined, 'an ordinary message carries no broadcast, garble or tap log');

// ═══ 4. Who gets garbled (dev's call) ═══
const ms = read('scripts/services/MessageService.js');
ok(/if \(signalStrength < 50 && !game\.user\?\.isGM\) \{\s*data\.signalDegradation = \{/.test(ms), 'only a PLAYER\'s weak-signal send is garbled — never the GM\'s');
ok(/delete sentCopy\.signalDegradation;/.test(ms), 'the sender\'s own sent copy is never garbled');

console.log(`test-persist-roundtrip: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
