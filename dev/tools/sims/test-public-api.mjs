// test-public-api — the v2 API (scripts/integrations/publicApi.js, docs/API.md; stage 2, step 18). Calls every
// method as a GM and as a player against mocked services and checks the contract: every result is { ok: true, data }
// or { ok: false, code, error } with a known code; nothing throws, even when a service does; outputs are plain
// (no functions, no class instances); permissions match the UI's (owner or GM; directory GM-only); events can be
// listened to and not emitted; the object is frozen; docs/API.md names every method and code.
// Run: node dev/tools/sims/test-public-api.mjs   (NCM_ROOT=<dir> to check another checkout)
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';

const ROOT = path.resolve(process.env.NCM_ROOT || fileURLToPath(new URL('../../../', import.meta.url)));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const lib = path.join(ROOT, 'scripts/integrations/publicApi.js');
if (!existsSync(lib)) { ok(false, 'scripts/integrations/publicApi.js exists'); console.log(`test-public-api: ${pass} passed, ${fail} failed`); process.exit(1); }

// ── a world: a GM, a player who owns V, an NPC nobody owns ──
const users = { gm: { id: 'gm', isGM: true }, p1: { id: 'p1', isGM: false } };
let me = users.gm;
const actor = (id, name, owner) => ({ id, name, get isOwner() { return me.isGM || me.id === owner; }, items: { get: () => null } });
const V = actor('V', 'V', 'p1'), NPC = actor('N', 'Rogue', null);
const actors = Object.assign([V, NPC], { get: (id) => [V, NPC].find((a) => a.id === id) || null });
const shard = { id: 'sh1', uuid: 'Item.sh1', name: 'Shard' }, term = { id: 't1', uuid: 'Item.t1', name: 'Box' };
const calls = [];
const hooks = new Map(); let hookId = 0;
globalThis.Hooks = { on: (n, fn) => { const id = ++hookId; hooks.set(id, { n, fn }); return id; }, off: (n, id) => hooks.delete(id), callAll: (n, d) => { for (const h of hooks.values()) if (h.n === n) h.fn(d); }, once() {} };
globalThis.fromUuidSync = (u) => ({ 'Item.sh1': shard, 'Item.t1': term }[u] ?? null);
let boom = false;
const msgs = [
  { messageId: 'm1', subject: 'Job', body: '<p>Meet at <b>Afterlife</b></p>', from: 'fixer@x', to: 'v@x', timestamp: '2045-01-02T00:00:00.000Z', status: { read: false }, toActorId: 'V' },
  { messageId: 'm0', subject: 'Old', body: 'hi', timestamp: '2045-01-01T00:00:00.000Z', status: { read: true } },
  { messageId: 'mx', subject: 'Gone', body: '', timestamp: '2045-01-03T00:00:00.000Z', status: { deleted: true } },
];
globalThis.game = {
  get user() { return me; },
  actors, items: { get: (id) => ({ sh1: shard, t1: term }[id] ?? null) },
  settings: { get: (m, k) => (k === 'networkSimulationEnabled' ? true : k === 'conversationsEnabled' ? false : undefined) },
  nightcity: {
    messageService: {
      sendMessage: async (d) => { calls.push(['send', d]); if (boom) throw new Error('kaboom'); return { success: true, messageId: 'new1' }; },
      getMessages: async (id) => { calls.push(['get', id]); return id === 'V' ? structuredClone(msgs) : []; },
      markAsRead: async (a, m) => ({ success: m === 'm1' }),
    },
    contactRepository: { getContacts: async (id) => [{ id: 'c1', name: 'Rogue', email: 'rogue@afterlife', actorId: 'N', trust: 4 }] },
    masterContactService: { getAll: () => [{ id: 'd1', name: 'Rogue', email: 'rogue@afterlife', notes: 'GM secret' }], getContact: (id) => (id === 'd1' ? { id: 'd1', name: 'Rogue', email: 'rogue@afterlife' } : null) },
    portraitService: { resolvePortrait: (c) => (c?.id === 'd1' ? 'img/rogue.webp' : null) },
    contactGroupService: {
      groupsFor: ({ actorId }) => [...(actorId ? [{ id: 'g1', name: 'Crew', scope: 'actor', ownerActorId: actorId, members: [{}, {}] }] : []), ...(me.isGM ? [{ id: 'gm1', name: 'Fixers', scope: 'master', members: [{}] }] : [])],
      findGroup(id, ctx) { return this.groupsFor(ctx).find((g) => g.id === id) || (id === 'gm1' ? { id: 'gm1', name: 'Fixers', members: [] } : null); },
      recipientsFor: (g) => ({ recipients: [{ actorId: 'V', contactId: null, email: 'v@x', name: 'V', secret: 'x' }], unresolved: [] }),
    },
    networkService: { currentNetwork: { id: 'CITINET', name: 'CitiNet', type: 'public', security: { password: 'hunter2' } }, signalStrength: 80, isDeadZone: false, simple: false, getAvailableNetworks: () => [{ id: 'CITINET', name: 'CitiNet', type: 'public', security: {} }], getNode: (id) => (id === 'n1' ? { id: 'n1' } : null) },
    timeService: { getCurrentTime: () => '2045-01-05T12:00:00.000Z', getCurrentTimeMs: () => 1, getProviderInfo: () => ({ mode: 'manual' }) },
    dataShardService: { isDataShard: (i) => i === shard }, terminalService: { isTerminal: (i) => i === term },
    openInbox: (a, m) => calls.push(['openInbox', a, m]), composeMessage: (o) => calls.push(['compose', o]),
    openDataShard: (i) => calls.push(['openShard', i.id]), openTerminal: (i) => calls.push(['openTerminal', i.id]), openNode: (n) => calls.push(['openNode', n]),
  },
};
globalThis.foundry = { utils: { deepClone: (x) => structuredClone(x) } };

const { buildApiV2, API_CODES, API_V2_VERSION } = await import(pathToFileURL(lib).href);
const api = buildApiV2();

// ── the result contract, checked on every call below ──
const plain = (v, seen = new Set()) => {
  if (v === null || ['string', 'number', 'boolean', 'undefined'].includes(typeof v)) return true;
  if (typeof v === 'function') return false;
  if (seen.has(v)) return true; seen.add(v);
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== Array.prototype && proto !== null) return false;
  return Object.values(v).every((x) => plain(x, seen));
};
const shapes = [];
const call = async (label, p) => {
  let r; let threw = null;
  try { r = await p(); } catch (e) { threw = e; }
  const good = !threw && r && typeof r === 'object' && (r.ok === true ? 'data' in r : (r.ok === false && API_CODES.includes(r.code) && typeof r.error === 'string'));
  shapes.push([label, good, threw?.message, r]);
  return r || {};
};

// ═══ GM ═══
me = users.gm;
let r = await call('features.list', async () => ({ ok: true, data: api.features.list() }));
ok(Array.isArray(r.data) && r.data.some((f) => f.name === 'networks' && f.on === true) && r.data.some((f) => f.name === 'conversations' && f.on === false), 'features.list: each feature and whether it is on');
ok(api.features.has('networks') === true && api.features.has('nope') === false, 'features.has');
r = await call('time.now', async () => ({ ok: true, data: api.time.now() }));
ok(r.data === '2045-01-05T12:00:00.000Z' && api.time.nowMs() === 1 && api.time.provider()?.mode === 'manual', 'time: now / nowMs / provider');

r = await call('messages.send (GM as contact)', () => api.messages.send({ toActorId: 'V', fromContactId: 'd1', subject: 'Hi', body: 'x' }));
ok(r.ok && r.data.messageId === 'new1' && calls.at(-1)[1].fromContactId === 'd1' && calls.at(-1)[1].priority === 'normal', 'messages.send as GM from a directory contact goes to MessageService.sendMessage');
r = await call('messages.send (no to)', () => api.messages.send({ fromActorId: 'V' }));
ok(r.ok === false && r.code === 'BAD_INPUT', 'messages.send without a recipient: BAD_INPUT');
boom = true;
r = await call('messages.send (service throws)', () => api.messages.send({ toActorId: 'N', fromActorId: 'V', subject: 's', body: 'b' }));
boom = false;
ok(r.ok === false && r.code === 'FAILED' && /kaboom/.test(r.error), 'a service that throws becomes FAILED — the API never throws');
r = await call('messages.listFor', () => api.messages.listFor('V'));
ok(r.ok && r.data.map((m) => m.id).join() === 'm1,m0', 'messages.listFor: newest first, deleted left out');
ok(r.data[0].preview === 'Meet at Afterlife' && !('body' in r.data[0]) && r.data[0].read === false, 'summaries carry a text preview, not the body');
r = await call('messages.listFor unread', () => api.messages.listFor('V', { unreadOnly: true, limit: 1 }));
ok(r.ok && r.data.length === 1 && r.data[0].id === 'm1', 'listFor: unreadOnly + limit');
r = await call('messages.markRead', () => api.messages.markRead('V', 'm1'));
ok(r.ok && r.data.messageId === 'm1', 'messages.markRead');
r = await call('messages.markRead missing', () => api.messages.markRead('V', 'zzz'));
ok(r.ok === false && r.code === 'NOT_FOUND', 'markRead on an unknown message: NOT_FOUND');
r = await call('contacts.listFor', () => api.contacts.listFor('V'));
ok(r.ok && r.data[0].email === 'rogue@afterlife' && r.data[0].trust === 4, 'contacts.listFor');
r = await call('contacts.resolveName', () => api.contacts.resolveName({ contactId: 'd1' }));
ok(r.ok && typeof r.data === 'string', `contacts.resolveName gives a name (${r.data})`);
r = await call('contacts.resolvePortrait', () => api.contacts.resolvePortrait('d1'));
ok(r.ok && r.data === 'img/rogue.webp', 'contacts.resolvePortrait');
r = await call('directory.list (GM)', () => api.directory.list());
ok(r.ok && r.data.length === 1 && !('notes' in r.data[0]), 'directory.list for the GM, without GM-only fields in the summary');
r = await call('directory.get', () => api.directory.get('d1'));
ok(r.ok && r.data.id === 'd1', 'directory.get');
r = await call('groups.list (GM)', () => api.groups.list());
ok(r.ok && r.data.some((g) => g.scope === 'master' && g.members === 1), 'groups.list: the GM sees the master groups, with a member count');
r = await call('groups.recipientsFor', () => api.groups.recipientsFor('gm1'));
ok(r.ok && r.data.recipients[0].actorId === 'V' && !('secret' in r.data.recipients[0]), 'groups.recipientsFor: plain recipients only');
r = await call('networks.status', () => api.networks.status());
ok(r.ok && r.data.network.name === 'CitiNet' && r.data.signal === 80 && r.data.deadZone === false && r.data.simple === false && !('security' in r.data.network), 'networks.status: no network passwords leave');
r = await call('networks.available', () => api.networks.available());
ok(r.ok && r.data[0].id === 'CITINET' && !('security' in r.data[0]), 'networks.available');
for (const [label, fn, want] of [
  ['open.inbox', () => api.open.inbox('V', { messageId: 'm1' }), 'openInbox'], ['open.composer', () => api.open.composer({ subject: 's' }), 'compose'],
  ['open.shard (uuid)', () => api.open.shard('Item.sh1'), 'openShard'], ['open.terminal (id)', () => api.open.terminal('t1'), 'openTerminal'], ['open.node', () => api.open.node('n1'), 'openNode']]) {
  r = await call(label, fn); ok(r.ok && calls.at(-1)[0] === want, `${label} opens it`);
}
r = await call('open.shard (a terminal)', () => api.open.shard('t1'));
ok(r.ok === false && r.code === 'NOT_FOUND', 'open.shard on something that is not a shard: NOT_FOUND (no toast)');
r = await call('open.node missing', () => api.open.node('zz'));
ok(r.ok === false && r.code === 'NOT_FOUND', 'open.node on an unknown node: NOT_FOUND');

// ═══ player (owns V) ═══
me = users.p1;
r = await call('p: send as own', () => api.messages.send({ toActorId: 'N', fromActorId: 'V', subject: 's', body: 'b' }));
ok(r.ok, 'a player sends as their own character');
r = await call('p: send as NPC', () => api.messages.send({ toActorId: 'V', fromActorId: 'N', subject: 's', body: 'b' }));
ok(r.ok === false && r.code === 'NOT_OWNER', "a player cannot send as a character they don't own");
r = await call('p: send as contact', () => api.messages.send({ toActorId: 'V', fromContactId: 'd1' }));
ok(r.ok === false && r.code === 'NOT_GM', 'a player cannot send as a directory contact');
r = await call('p: list own', () => api.messages.listFor('V'));
ok(r.ok && r.data.length === 2, "a player reads their own character's mail");
r = await call('p: list other', () => api.messages.listFor('N'));
ok(r.ok === false && r.code === 'NOT_OWNER', "…and not someone else's");
r = await call('p: contacts other', () => api.contacts.listFor('N'));
ok(r.ok === false && r.code === 'NOT_OWNER', "a player cannot read another character's contacts");
r = await call('p: directory', () => api.directory.list());
ok(r.ok === false && r.code === 'NOT_GM', 'the directory is GM-only');
r = await call('p: directory.get', () => api.directory.get('d1'));
ok(r.ok === false && r.code === 'NOT_GM', 'directory.get is GM-only');
r = await call('p: groups', () => api.groups.list({ actorId: 'V' }));
ok(r.ok && r.data.length === 1 && r.data[0].scope === 'actor', "a player sees their character's own groups, not the GM's");
r = await call('p: GM group', () => api.groups.recipientsFor('gm1', { actorId: 'V' }));
ok(r.ok === false && r.code === 'NOT_FOUND', "a player cannot resolve the GM's group");
r = await call('p: open inbox other', () => api.open.inbox('N'));
ok(r.ok === false && r.code === 'NOT_OWNER', "a player cannot open another character's inbox");
r = await call('p: unknown actor', () => api.messages.listFor('ghost'));
ok(r.ok === false && r.code === 'NOT_FOUND', 'an unknown actor: NOT_FOUND');

// simple network mode refuses nodes
game.settings.get = (m, k) => (k === 'networkSimulationEnabled' ? false : undefined);
const F = await import(pathToFileURL(path.join(ROOT, 'scripts/utils/features.js')).href); F._resetFeatureCache();
me = users.gm;
r = await call('open.node simple', () => api.open.node('n1'));
ok(r.ok === false && r.code === 'FEATURE_OFF', 'open.node in simple network mode: FEATURE_OFF');

// ═══ the contract over every call ═══
const bad = shapes.filter(([, good]) => !good);
ok(bad.length === 0, `every result is { ok, data } or { ok:false, code, error } and nothing threw (${bad.map(([l, , t]) => l + (t ? ': ' + t : '')).join('; ')})`);
const notPlain = shapes.filter(([, , , res]) => res && !plain(res));
ok(notPlain.length === 0, `every result is plain data (${notPlain.map(([l]) => l).join(', ')})`);
ok(shapes.length >= 38, `covered ${shapes.length} calls`);

// ═══ events: listen, never emit ═══
const heard = [];
const off = api.events.on('message:sent', (d) => heard.push(d.messageId));
Hooks.callAll('night-city-messenger.message:sent', { messageId: 'e1' });
off();
Hooks.callAll('night-city-messenger.message:sent', { messageId: 'e2' });
ok(heard.join() === 'e1', 'events.on hears a documented event; the returned function stops it');
ok(api.events.on('network:changed', () => {}) === null && api.events.on('message:sent', 'x') === null, 'only documented names, only functions');
ok(!('emit' in api.events) && !JSON.stringify(Object.keys(api)).includes('eventBus'), 'no emit, no raw event bus');
ok(Object.isFrozen(api) && Object.isFrozen(api.messages) && Object.isFrozen(api.open), 'the object and its namespaces are frozen');
ok(API_V2_VERSION === '2.0.0' && api.version === '2.0.0', 'version 2.0.0');

// ═══ wiring + docs ═══
const B = read('scripts/integrations/IntegrationBridge.js');
ok(/v2: buildApiV2\(\),/.test(B) && /apiVersion: '1\.2\.0'/.test(B), 'the bridge exposes it as api.v2 (v1 stays, apiVersion 1.2.0)');
const doc = existsSync(path.join(ROOT, 'docs/API.md')) ? read('docs/API.md') : '';
const methods = [];
for (const [ns, v] of Object.entries(api)) if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k, f] of Object.entries(v)) if (typeof f === 'function') methods.push(`${ns}.${k}`);
const undocumented = methods.filter((m) => !doc.includes('`' + m));
ok(doc && undocumented.length === 0, `docs/API.md documents every method (${undocumented.join(', ')})`);
ok(API_CODES.every((c) => doc.includes('`' + c + '`')), 'docs/API.md lists every error code');

console.log(`test-public-api: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
