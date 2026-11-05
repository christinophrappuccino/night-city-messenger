// test-access-kinds — the access-point kinds are one table (R16, after stage 2).
// ACCESS_KINDS (utils/accessPoints.js, the rules: label / icon / button text) and ACCESS_OPENERS (integrations/
// AccessPoints.js, the run time: describe / open) must list the same kinds; describeAccess and openAccess look the kind
// up there instead of each carrying its own switch. Drives the REAL module with a mocked game for every kind.
// Run: node dev/tools/sims/test-access-kinds.mjs   (NCM_ROOT=<dir> to check another checkout)
import { readFileSync } from 'fs';
import path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';

const ROOT = path.resolve(process.env.NCM_ROOT || fileURLToPath(new URL('../../../', import.meta.url)));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

const opened = [];
const warns = [];
const item = (name, flags = {}) => ({ name, img: `${name}.png`, uuid: `Item.${name}`, parent: null, getFlag: (_m, k) => flags[k] });
const items = { 'Item.T1': item('T1'), 'Item.S1': item('S1') };
const actorV = { id: 'A1', name: 'V', img: 'v.png', isOwner: true, getFlag: (_m, k) => (k === 'email' ? 'v@nc.net' : undefined) };
globalThis.fromUuidSync = (u) => items[u] ?? null;
globalThis.ui = { notifications: { info() {}, warn: (m) => warns.push(m), error() {} } };
globalThis.Hooks = { on() {}, once() {}, callAll() {} };
globalThis.foundry = { utils: { deepClone: (o) => structuredClone(o) } };
globalThis.game = {
  user: { isGM: false, id: 'U1' }, settings: { get: () => undefined },
  items: { get: () => null }, scenes: { get: (id) => (id === 'SC1' ? { name: 'Afterlife' } : null) },
  actors: { get: (id) => (id === 'A1' ? actorV : id === 'A2' ? { ...actorV, id: 'A2', isOwner: false } : null) },
  nightcity: {
    terminalService: { getConfig: () => ({ terminalName: 'Arasaka Desk', metadata: { org: 'Arasaka', location: 'Tower' }, accounts: [{}, { hidden: true }], theme: {} }) },
    dataShardService: { getConfig: () => ({ shardName: 'Blue Chip', encrypted: true, theme: {} }) },
    networkService: { getNode: (id) => (id === 'N1' ? { name: 'Relay', kind: 'relay', networkId: 'NET', sceneId: 'SC1', hidden: true } : null), getNetwork: () => ({ name: 'CitiNet', theme: { color: '#ff0' } }) },
    payphoneService: { get: (id) => (id === 'P1' ? { name: 'Booth', number: '555-0101', sceneId: 'SC1', condition: 'out', look: { case: '#111', ink: '#eee' } } : null), open: (id, o) => opened.push(['payphone', id, o?.skipReach]) },
    masterContactService: { getContact: (id) => (id === 'C1' ? { name: 'Rogue', email: 'rogue@af.net', portrait: 'r.png' } : null) },
    openTerminal: (id) => opened.push(['terminal', id]), openDataShard: (id) => opened.push(['shard', id]),
    openNode: (id) => opened.push(['node', id]), openInbox: (o, m) => opened.push(['inbox', o, m]),
  },
};

const { ACCESS_KINDS } = await imp('scripts/utils/accessPoints.js');
const { ACCESS_OPENERS, describeAccess, openAccess } = await imp('scripts/integrations/AccessPoints.js');

const rules = Object.keys(ACCESS_KINDS).sort().join();
const run = Object.keys(ACCESS_OPENERS).sort().join();
ok(rules === run, `ACCESS_KINDS and ACCESS_OPENERS list the same kinds (${rules} | ${run})`);
for (const [k, v] of Object.entries(ACCESS_OPENERS)) ok(typeof v.describe === 'function' && typeof v.open === 'function', `${k} has describe and open`);

// describe, per kind
const d = (kind, id) => describeAccess({ kind, id });
let r = d('terminal', 'Item.T1');
ok(r.found && r.name === 'Arasaka Desk' && r.sub === 'Arasaka · Tower' && r.tags.join() === '1 account', `terminal described (${JSON.stringify(r.tags)})`);
r = d('shard', 'Item.S1');
ok(r.found && r.name === 'Blue Chip' && r.tags.join() === 'locked', 'shard described');
r = d('node', 'N1');
ok(r.found && r.name === 'Relay' && r.sub === 'CitiNet · Afterlife' && r.tags.join() === 'hidden' && r.source.primary === '#ff0', 'node described');
r = d('payphone', 'P1');
ok(r.found && r.sub === '555-0101 · Afterlife' && r.tags.join() === 'out of order' && r.source.primary === '#111', 'payphone described');
r = d('inbox', 'A1');
ok(r.found && r.name === "V's inbox" && r.sub === 'v@nc.net' && r.img === 'v.png', 'inbox described');
r = d('message', 'C1|m1');
ok(r.found && r.name === 'A message for Rogue' && r.img === 'r.png', 'a message for a contact described');
for (const [kind, id] of [['terminal', 'Item.X'], ['node', 'NX'], ['payphone', 'PX'], ['inbox', 'AX']]) {
  r = d(kind, id);
  ok(!r.found && r.name === ACCESS_KINDS[kind].label && Array.isArray(r.tags), `a missing ${kind} is not found and keeps the kind's label`);
}
ok(!d('website', 'x').found, 'an unknown kind is not found');

// open, per kind
openAccess({ kind: 'terminal', id: 'Item.T1' });
openAccess({ kind: 'shard', id: 'Item.S1' });
openAccess({ kind: 'node', id: 'N1' });
openAccess({ kind: 'payphone', id: 'P1' });
openAccess({ kind: 'inbox', id: 'A1' });
openAccess({ kind: 'message', id: 'A1|m7' });
ok(JSON.stringify(opened) === JSON.stringify([['terminal', 'Item.T1'], ['shard', 'Item.S1'], ['node', 'N1'], ['payphone', 'P1', true], ['inbox', 'A1', null], ['inbox', 'A1', 'm7']]),
  `each kind opens through its own door (${JSON.stringify(opened)})`);
opened.length = 0;
openAccess({ kind: 'inbox', id: 'A2' });
ok(!opened.length && warns.some((w) => /not yours/.test(w)), "a player cannot open someone else's inbox");
openAccess({ kind: 'website', id: 'x' });
ok(!opened.length && warns.some((w) => /broken/.test(w)), 'an unknown kind is a broken access point');

const src = read('scripts/integrations/AccessPoints.js');
ok(!/switch \(ref\.kind\)/.test(src) && !/ref\.kind === '(terminal|node|payphone|shard)'\) \{/.test(src.slice(src.indexOf('export function describeAccess'), src.indexOf('export function paletteFor'))), 'describeAccess / openAccess carry no kind switch');

console.log(`test-access-kinds: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
