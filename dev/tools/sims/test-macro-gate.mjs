// Sim: macros a player could make the GM run (audit remediation A2, SEC-02).
//
// A program, payload, malware or resident can link a world macro, and the GM's
// client runs it with GM rights. The macro id used to come from the PLAYER's
// request (`applyUploadRun`'s macroId, a resident's params.macroId) or from
// entry data a player's request could write (content updates, encoded entries).
// A2:
//   1. runGmMacro (helpers.js) is the one place a linked macro runs, and only
//      when a GM wrote that macro; a refusal is reported to the GM.
//   2. an upload run / a relayed resident reads the link from the program's own
//      shard entry (`source`), never from the request;
//   3. relays cannot create or change a link: applySiphonToJournal keeps the
//      stored one, encoded entries and residents are stripped (stripMacroRefs).
//
// Drives the real helpers, SiphonFlow, UploadFlow and TerminalService over a
// mocked world with a GM-written and a player-written macro.
import fs from 'fs';
import { pathToFileURL, fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const read = (p) => fs.readFileSync(`${ROOT}/${p}`, 'utf8');
const load = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };

// ── A small world ──
const MOD = 'night-city-messenger';
const users = {
  gm: { id: 'gm', name: 'GM', isGM: true },
  ag: { id: 'ag', name: 'Assistant', isGM: true },
  p1: { id: 'p1', name: 'Rache', isGM: false },
};
const ran = [];   // every macro execution: { id, scope }
const mkMacro = (id, name, author) => ({ id, name, author: users[author], _source: { author }, execute: async (scope) => { ran.push({ id, scope }); } });
const macros = new Map([
  ['m-gm', mkMacro('m-gm', 'GM door opener', 'gm')],
  ['m-ag', mkMacro('m-ag', 'Assistant lights', 'ag')],
  ['m-p1', mkMacro('m-p1', 'Player payload', 'p1')],
  ['m-boom', { id: 'm-boom', name: 'Throws', author: users.gm, execute: async () => { throw new Error('boom'); } }],
]);

const pages = [];
const page = (messageId, contentData, journalId = 'j-shard') => {
  const p = {
    id: `pg-${messageId}`, journalId,
    flags: { [MOD]: { messageId, contentData: JSON.parse(JSON.stringify(contentData)) } },
    async update(diff) {
      const v = diff[`flags.${MOD}.contentData`];
      if (v) this.flags[MOD].contentData = JSON.parse(JSON.stringify(v));
      return this;
    },
  };
  pages.push(p);
  return p;
};
const journals = new Map();
const journal = (id) => { const j = { id, pages: { find: (fn) => pages.filter((p) => p.journalId === id).find(fn) }, get [Symbol.iterator]() { return [this].values(); } }; journals.set(id, j); return j; };
journal('j-shard');
const shard = { id: 'shard1', uuid: 'Actor.v.Item.shard1', name: 'Go-bag', getFlag: (m, k) => (k === 'journalId' ? 'j-shard' : null) };
// every player can see the terminal (resident relays check the sender can reach it, A3c)
const host = { id: 'term1', uuid: 'Item.term1', name: 'WS-7F', getFlag: (m, k) => (k === 'isTerminal' ? true : null), testUserPermission: () => true };
const uuids = { [shard.uuid]: shard, [host.uuid]: host };

const toasts = [];
globalThis.game = {
  user: users.gm,
  users: { get: (id) => users[id] ?? null, activeGM: users.gm, find: (fn) => Object.values(users).find(fn) ?? null, filter: (fn) => Object.values(users).filter(fn) },
  macros: { get: (id) => macros.get(id) ?? null },
  journal: { get: (id) => journals.get(id) ?? null, [Symbol.iterator]: () => journals.values() },
  // a1 is Rache's character (the player p1 owns it)
  actors: { get: (id) => (id === 'a1' ? { id: 'a1', name: 'V', testUserPermission: (u) => u.id === 'p1' || !!u.isGM } : null) },
  settings: { get: () => { throw new Error('none'); } },
  i18n: { localize: (s) => s },
  nightcity: { soundService: { play() {} }, traceService: { logSuccess() {}, fireTrace() {} }, eventBus: { emit() {} } },
};
globalThis.ui = { notifications: { info: (m) => toasts.push(['info', m]), warn: (m) => toasts.push(['warn', m]), error: (m) => toasts.push(['error', m]) } };
globalThis.Hooks = { on() {}, off() {}, once() {}, call() {}, callAll() {} };
globalThis.CONFIG = {};
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3 } };
globalThis.foundry = {
  utils: { deepClone: (o) => JSON.parse(JSON.stringify(o)), mergeObject: (a, b) => ({ ...a, ...b }), randomID: () => 'rid', debounce: (f) => f, getProperty: (o, p) => p.split('.').reduce((a, k) => a?.[k], o) },
  applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (B) => B }, instances: new Map() },
};
globalThis.fromUuid = async (u) => uuids[u] ?? null;
globalThis.fromUuidSync = (u) => uuids[u] ?? null;
globalThis.ChatMessage = { create: async () => ({}) };

const H = await load('scripts/utils/helpers.js');
const SF = await load('scripts/ui/content/SiphonFlow.js');
const UF = await load('scripts/ui/content/UploadFlow.js');

// ═══ 1. runGmMacro ═══
{
  ran.length = 0; toasts.length = 0;
  ok(await H.runGmMacro('m-gm', { item: host }, 'Test') === true && ran[0]?.id === 'm-gm', 'a GM-written macro runs');
  ok(ran[0]?.scope?.item === host, 'the scope is passed to Macro#execute');
  ok(await H.runGmMacro('m-ag', {}, 'Test') === true, 'an Assistant GM\'s macro runs (Assistants are GMs)');
  ran.length = 0;
  ok(await H.runGmMacro('m-p1', {}, 'Payload "X"') === false && ran.length === 0, 'a player-written macro does NOT run');
  ok(toasts.some(([k, m]) => k === 'warn' && /Player payload/.test(m) && /Rache/.test(m) && /Payload "X"/.test(m)), 'the GM is told which macro, who wrote it, and what linked it');
  ok(await H.runGmMacro('m-missing', {}, 'Test') === false, 'a missing macro → false, no throw');
  ok(await H.runGmMacro('', {}, 'Test') === false, 'no id → false');
  let threw = false; try { ok(await H.runGmMacro('m-boom', {}, 'Test') === false, 'a macro that throws → false'); } catch { threw = true; }
  ok(!threw, 'a throwing macro never breaks the caller');
  game.user = users.p1; ran.length = 0;
  ok(await H.runGmMacro('m-gm', {}, 'Test') === false && ran.length === 0, 'never runs on a player\'s client through this path');
  game.user = users.gm;
}

// ═══ 2. stripMacroRefs ═══
{
  const input = { a: 1, macroId: 'x', effect: { type: 'adjudicate', macroId: 'x', params: { macroId: 'y', keep: 2 } }, list: [{ macroId: 'z', k: 3 }] };
  const out = H.stripMacroRefs(input);
  ok(!JSON.stringify(out).includes('macroId'), 'every macroId key removed, at any depth, in arrays too');
  ok(out.a === 1 && out.effect.type === 'adjudicate' && out.effect.params.keep === 2 && out.list[0].k === 3, 'everything else kept');
  ok(input.macroId === 'x' && input.effect.macroId === 'x', 'the input is not changed');
  ok(H.stripMacroRefs(null) === null && H.stripMacroRefs('s') === 's', 'non-objects pass through');
}

// ═══ 3. Upload runs read the link from the program's entry ═══
{
  page('prog-gm', { name: 'Door', effect: { type: 'adjudicate', macroId: 'm-gm' } });
  page('prog-none', { name: 'Plain', effect: { type: 'adjudicate' } });
  ran.length = 0;
  // the attack: a relayed upload run naming a GM macro the program never linked
  await SF.handlePayloadEffectRequest({ kind: 'uploadRun', actorId: 'a1', itemUuid: host.uuid, effectType: 'adjudicate', params: { macroId: 'm-gm' }, name: 'Evil', macroId: 'm-gm' }, 'p1');
  ok(ran.length === 0, 'relayed upload run: a macro id in the request is ignored');
  await SF.handlePayloadEffectRequest({ kind: 'uploadRun', actorId: 'a1', itemUuid: host.uuid, effectType: 'adjudicate', name: 'Plain', source: { itemUuid: shard.uuid, entryId: 'prog-none' }, macroId: 'm-gm' }, 'p1');
  ok(ran.length === 0, 'relayed upload run: a program with no linked macro runs none, whatever the request says');
  await SF.handlePayloadEffectRequest({ kind: 'uploadRun', actorId: 'a1', itemUuid: host.uuid, effectType: 'adjudicate', name: 'Door', source: { itemUuid: shard.uuid, entryId: 'prog-gm' } }, 'p1');
  ok(ran.length === 1 && ran[0].id === 'm-gm', 'relayed upload run: the program\'s OWN linked GM macro still runs (intended automation kept)');
  ok(await SF.programMacroId({ itemUuid: shard.uuid, entryId: 'prog-gm' }) === 'm-gm', 'programMacroId reads the entry');
  ok(await SF.programMacroId({ itemUuid: 'nope', entryId: 'prog-gm' }) === '' && await SF.programMacroId(null) === '', 'programMacroId: unknown source → ""');
}

// ═══ 4. Content updates cannot create or change a link ═══
{
  const pg = page('pay-1', { name: 'Payload', effect: { type: 'icebreaker', macroId: 'm-gm' }, executed: false });
  await SF.applySiphonToJournal('pay-1', { name: 'Payload', effect: { type: 'icebreaker', macroId: 'm-p1' }, executed: true });
  ok(pg.flags[MOD].contentData.effect.macroId === 'm-gm', 'a relayed update cannot swap the stored link');
  ok(pg.flags[MOD].contentData.executed === true, 'the legitimate change still lands');
  const pg2 = page('eddies-1', { amount: 100, claimed: false });
  await SF.applySiphonToJournal('eddies-1', { amount: 100, claimed: true, effect: { macroId: 'm-gm' }, macroId: 'm-gm' });
  ok(!JSON.stringify(pg2.flags[MOD].contentData).includes('macroId') && pg2.flags[MOD].contentData.claimed === true, 'a relayed update cannot plant a link where there was none');
}

// ═══ 5. Relayed residents ═══
{
  const installed = [];
  game.nightcity.terminalService = { installResident: async (item, r) => installed.push(r), updateResident: async () => {}, getConfig: () => ({ accounts: [] }), getResidents: () => [] };
  // planted by Rache's character a1, sent by Rache (p1) — the relay checks both since A3c
  const by = { provenance: { plantedBy: 'a1' } };
  await UF.handleResidentRequest({ itemUuid: host.uuid, resident: { effectType: 'adjudicate', params: { name: 'Evil', macroId: 'm-gm' }, ...by } }, 'p1');
  ok(installed[0] && !installed[0].params.macroId, 'a resident naming a macro is installed WITHOUT it');
  await UF.handleResidentRequest({ itemUuid: host.uuid, resident: { effectType: 'adjudicate', params: { name: 'Door', macroId: 'm-p1' }, source: { itemUuid: shard.uuid, entryId: 'prog-gm' }, ...by } }, 'p1');
  ok(installed[1]?.params?.macroId === 'm-gm', 'a custom-routine resident gets its link from its program entry');
  await UF.handleResidentRequest({ itemUuid: host.uuid, resident: { effectType: 'logicBomb', params: { inner: { effectType: 'adjudicate', params: { macroId: 'm-gm' } } }, ...by } }, 'p1');
  ok(installed.length === 2, 'a logic bomb (and the macro link nested in it) is not a program a player can leave behind (A3c)');
  await UF.handleResidentRequest({ itemUuid: host.uuid, resident: { effectType: 'keylog', params: { name: 'Ears' }, ...by } }, 'p1');
  ok(installed[2]?.effectType === 'keylog' && installed[2]?.params?.name === 'Ears', 'ordinary residents install unchanged');
}

// ═══ 6. A fired custom routine goes through the gate ═══
{
  const { TerminalService } = await load('scripts/services/TerminalService.js');
  ran.length = 0;
  const r1 = await TerminalService.prototype._fireResidentEffect.call({}, host, 'adjudicate', { name: 'Door', macroId: 'm-gm' }, {});
  ok(ran[0]?.id === 'm-gm' && /Door fired/.test(r1), 'resident custom routine: a GM macro runs');
  ran.length = 0;
  await TerminalService.prototype._fireResidentEffect.call({}, host, 'adjudicate', { name: 'Sneaky', macroId: 'm-p1' }, {});
  ok(ran.length === 0, 'resident custom routine: a player macro (from an old resident) does not run');
}

// ═══ 7. Static guards ═══
{
  const sh = read('scripts/integrations/SocketHandlers.js');
  ok(/const entryData = data\.entryData == null \? data\.entryData : stripMacroRefs\(data\.entryData\);/.test(sh), 'encode / re-encode relay strips macro links from player entries');
  ok(/source: \{ itemUuid: shard\.uuid, entryId: e\.id \}/.test(read('scripts/ui/Terminal/TerminalViewerApp.js')), 'carried programs record their source entry (the entry id is `id`; `messageId` is the page flag — live 2026-11-06)');
  const uf = read('scripts/ui/content/UploadFlow.js');
  ok(/kind: 'uploadRun'[^}]*source: p\.source \|\| null/.test(uf) && !/kind: 'uploadRun'[^}]*macroId:/.test(uf), 'the upload relay sends the source, not a macro id');
  // every macro execution in module code is one of the known, reviewed sites
  const files = [];
  (function walk(d) { for (const n of fs.readdirSync(d)) { const p = `${d}/${n}`; fs.statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') && files.push(p); } })(`${ROOT}/scripts`);
  const ALLOWED = {
    'scripts/utils/helpers.js': 'runGmMacro — the gate',
    'scripts/services/CallService.js': 'a special number\'s macro runs on the dialling player\'s own client, with their own rights',
    'scripts/ui/AdminPanel/tabs/AccessTab.js': 'the GM clicks an access macro',
  };
  const offenders = [];
  for (const f of files) {
    const rel = f.replace(`${ROOT}/`, '');
    const src = fs.readFileSync(f, 'utf8');
    if (/\b(macro|game\.macros\??\.get\([^)]*\)\??)\s*\??\.execute\??\.?\(|doc\??\.execute\??\.?\(/.test(src) && !ALLOWED[rel]) offenders.push(rel);
  }
  ok(offenders.length === 0, `no macro runs outside the reviewed sites (${offenders.join(', ') || 'ok'})`);
}

console.log(`test-macro-gate: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
