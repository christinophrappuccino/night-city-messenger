// Sim: the leftovers queued during the audit remediation (dev 2026-11-05: "lets just do all of them").
//   1. the GM re-runs a player's send-only + directory checks on every relayed message (each person of a group)
//   2. contacts writers in CallService / ContactShareService / MigrationRunner use the B4 contacts queue
//   3. the rich-text cleaner keeps the space between two inline tags
//   4. one GM saves the network access log; other GMs reload it
//   5. Force Refresh redraws NCM windows on every client (GM-sent only)
//   6. the Shard Encoder's conversion results: one handler, any number of requests in flight
// Drives the real module code with mocked Foundry globals.
import { pathToFileURL, fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const read = (p) => readFileSync(`${ROOT}/${p}`, 'utf8');
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MOD = 'night-city-messenger';

const hooks = new Map();
const settings = new Map();
globalThis.game = {
  user: { id: 'gm', isGM: true }, users: { get: (id) => ({ gm: { id: 'gm', isGM: true }, gm2: { id: 'gm2', isGM: true } }[id] || { id, isGM: false }), activeGM: { id: 'gm' } },
  actors: { get: () => null, contents: [] }, settings: { get: (m, k) => settings.get(k), set: async (m, k, v) => settings.set(k, v) }, nightcity: {},
};
globalThis.foundry = { utils: { deepClone: (o) => JSON.parse(JSON.stringify(o)), mergeObject: (a, b) => ({ ...a, ...b }), randomID: (() => { let n = 0; return () => `r${++n}`; })() },
  applications: { api: { ApplicationV2: class { static DEFAULT_OPTIONS = {}; }, HandlebarsApplicationMixin: (B) => class extends B {} } } };
globalThis.Hooks = { on: (n, f) => { hooks.set(n, [...(hooks.get(n) || []), f]); return 1; }, off() {}, once() {}, callAll() {} };
globalThis.ui = { notifications: { info() {}, warn() {}, error() {}, notify() {} } };
globalThis.CONFIG = {};
globalThis.Handlebars = { escapeExpression: (s) => String(s ?? ''), registerHelper() {} };
const quiet = console.warn; console.warn = () => {};

// ═══ 1. The GM re-checks a player's recipients ═══
{
  const { MessageService } = await imp('scripts/services/MessageService.js');
  const gm = Object.create(MessageService.prototype);
  const acks = [], delivered = [];
  Object.defineProperty(gm, 'socketManager', { value: { emit: (op, d) => acks.push(d) } });
  gm.checkRelaySender = async () => ({ ok: true });
  gm._hasSentCopy = () => false;
  gm.recordDeliveryFailure = async () => {};
  gm._deliverMessage = async (d) => { delivered.push(d.to); return { success: true }; };
  gm._deliverMany = async (base, copies) => { copies.forEach((c) => delivered.push(c.to)); return { success: true, delivered: copies.length, failed: [], results: copies.map((c) => ({ name: c.to, success: true })) }; };
  const refuse = new Set(['system@localhost', 'stranger@nc']);
  gm.checkRecipientsAsPlayer = async (d) => (refuse.has(d.to) ? { ok: false, error: 'TRANSMISSION REFUSED — this address does not accept incoming messages.', errorCode: 'SEND_ONLY' } : { ok: true });
  const final = () => acks.filter((a) => !a.accepted).at(-1);

  await gm.handleMessageRelay({ messageId: 'm1', to: 'system@localhost' }, 'p1');
  ok(delivered.length === 0 && final()?.success === false && /TRANSMISSION REFUSED/.test(final().error), 'a player\'s message to a send-only address is refused by the GM too, in the same words');
  await gm.handleMessageRelay({ messageId: 'm2', to: 'judy@mox.nc' }, 'p1');
  ok(delivered.join() === 'judy@mox.nc' && final()?.success === true, 'an allowed message is delivered as before');
  delivered.length = 0;
  await gm.handleMessageRelay({ messageId: 'm3', _fanout: [{ to: 'judy@mox.nc' }, { to: 'stranger@nc' }, { to: 'rogue@nc' }] }, 'p1');
  ok(delivered.join() === 'judy@mox.nc,rogue@nc', 'in a group, only the refused person is dropped');
  ok(final()?.failed?.some((x) => x.name === 'stranger@nc' && x.errorCode === 'SEND_ONLY'), '…and is named in the answer, so the player is told who and why');
  delivered.length = 0;
  await gm.handleMessageRelay({ messageId: 'm4', _fanout: [{ to: 'system@localhost' }, { to: 'stranger@nc' }] }, 'p1');
  ok(delivered.length === 0 && final()?.success === false && final().errorCode === 'ALL_RECIPIENTS_FAILED', 'a group where everyone is refused delivers nothing');
  await gm.handleMessageRelay({ messageId: 'm5', anonReply: { parentMessageId: 'x' } }, 'p1');
  ok(final()?.success === true, 'an anonymous reply (the player cannot know the target) is not re-checked');
}

// ═══ 2. Contacts writers share the queue ═══
{
  const { serialize } = await imp('scripts/utils/serialize.js');
  const { CallService } = await imp('scripts/services/CallService.js');
  const cs = Object.create(CallService.prototype);
  const actor = { id: 'v', flags: { [MOD]: { contacts: [{ id: 'a', phone: '1' }] } }, getFlag: (m, k) => actor.flags[MOD][k], setFlag: async (m, k, v) => { await sleep(3); actor.flags[MOD][k] = v; } };
  // a ContactRepository write already in the queue adds a contact…
  const added = serialize('contacts:v', async () => { const cur = actor.getFlag(MOD, 'contacts'); await sleep(10); await actor.setFlag(MOD, 'contacts', [...cur, { id: 'b' }]); });
  // …while CallService changes a number
  const patched = cs._patchContacts(actor, (now) => now.map((c) => (c.id === 'a' ? { ...c, phone: '2' } : c)));
  await Promise.all([added, patched]);
  const list = actor.getFlag(MOD, 'contacts');
  ok(list.length === 2 && list.find((c) => c.id === 'a')?.phone === '2', 'a number change made while a contact was being added keeps both');
  ok(/serialize\(`contacts:\$\{actorId\}`/.test(read('scripts/services/ContactShareService.js')) && /serialize\(`contacts:\$\{a\.id\}`/.test(read('scripts/core/MigrationRunner.js')), 'sharing and the phone migration write in the same queue');
  ok(!/setFlag\(MODULE_ID, 'contacts', cur\.map/.test(read('scripts/services/CallService.js')), 'no direct contacts write is left in CallService');
}

// ═══ 3. The rich-text cleaner keeps spaces between words ═══
{
  const { cleanHtml } = await imp('scripts/utils/richText.js');
  for (const mode of ['inline', 'block', 'rich', 'mail']) {
    ok(cleanHtml('<b>Hello</b> <i>world</i>', { mode }) === '<b>Hello</b> <i>world</i>', `${mode}: "<b>Hello</b> <i>world</i>" keeps its space`);
  }
  ok(cleanHtml('<p>one</p>\n  <p>two</p>', { mode: 'mail' }) === '<p>one</p><p>two</p>', 'space between two paragraphs is still tidied away');
  ok(cleanHtml('<b>a</b>\n<i>b</i>', { mode: 'mail' }) === '<b>a</b> <i>b</i>', 'a line break between two inline words becomes one space');
  ok(cleanHtml('<ul> <li>x</li> <li>y</li> </ul>', { mode: 'mail' }) === '<ul><li>x</li><li>y</li></ul>', 'list markup stays tight');
}

// ═══ 4. One GM saves the access log ═══
{
  const { NetworkAccessLogService } = await imp('scripts/services/NetworkAccessLogService.js');
  const svc = Object.create(NetworkAccessLogService.prototype);
  const saved = [];
  svc.settingsManager = { set: (k, v) => saved.push(v.length), get: () => settings.get('networkAccessLog') };
  svc._entries = [{ id: 1 }];
  game.user = { id: 'gm2', isGM: true };
  svc._saveNow();
  ok(saved.length === 0, 'a second GM does not save its own copy over the log');
  game.user = { id: 'gm', isGM: true };
  svc._saveNow();
  ok(saved.length === 1, 'the active GM saves it');
  game.user = { id: 'gm2', isGM: true };
  hooks.clear();
  svc._reloadWired = false;
  svc._wireSettingReload();
  settings.set('networkAccessLog', [{ id: 1 }, { id: 2 }, { id: 3 }]);
  for (const f of hooks.get('updateSetting') || []) f({ key: `${MOD}.networkAccessLog` });
  ok(svc._entries.length === 3, '…and the second GM reloads the saved log when it changes');
  game.user = { id: 'gm', isGM: true };
}

// ═══ 5. Force Refresh ═══
{
  const { refreshNcmWindows } = await imp('scripts/utils/forceRefresh.js');
  let reloaded = 0;
  const mk = (ncm, rendered = true) => ({ id: `w${Math.random()}`, rendered, n: 0, element: { classList: { contains: (c) => c === 'ncm-app' && ncm } }, render() { this.n += 1; } });
  const wins = [mk(true), mk(true), mk(false), mk(true, false)];
  const n = refreshNcmWindows({ windows: wins, reloaders: [() => { reloaded += 1; }] });
  ok(n === 2 && wins[0].n === 1 && wins[2].n === 0 && wins[3].n === 0, 'it redraws the open NCM windows only');
  ok(reloaded === 1, 'and re-reads the directory first');
  const sh = read('scripts/integrations/SocketHandlers.js');
  ok(/register\(SOCKET_OPS\.ADMIN_FORCE_REFRESH, \(data, sender\) => \{\s*if \(!isFromGM\(sender\)\) return;/.test(sh), 'only a GM can make the other clients refresh');
  ok(/emit\?\.\(SOCKET_OPS\.ADMIN_FORCE_REFRESH/.test(read('scripts/ui/AdminPanel/tabs/ToolsTab.js')) && !/type: 'forceRefresh'/.test(read('scripts/ui/AdminPanel/tabs/ToolsTab.js')), 'the button sends the message the clients listen for');
}

// ═══ 6. Shard Encoder conversion results ═══
{
  const { awaitConvertResult } = await imp('scripts/ui/ShardEncoder/ShardEncoderApp.js');
  let handler = null, registers = 0;
  const sent = [];
  const sm = { register: (op, f) => { registers += 1; handler = f; }, emit() {} };
  const a = awaitConvertResult(sm, (id) => sent.push(id), 500);
  const b = awaitConvertResult(sm, (id) => sent.push(id), 500);
  handler({ requestId: sent[1], success: true }, 'gm');      // answers count only from a GM (the server-checked sender)
  handler({ requestId: sent[0], success: false }, 'gm');
  ok((await b) === true && (await a) === false, 'two requests in flight each get their own answer');
  ok(registers === 1, 'one handler, registered once');
  const c = awaitConvertResult(sm, () => {}, 30);
  ok((await c) === false, 'no answer in time reads as a failure');
  ok(!/sm\.register\(SOCKET_OPS\.SHARD_CONVERT_RESULT, handler\)/.test(read('scripts/ui/ShardEncoder/ShardEncoderApp.js')), 'no request registers its own handler any more');
}
console.warn = quiet;

console.log(`test-leftovers: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
