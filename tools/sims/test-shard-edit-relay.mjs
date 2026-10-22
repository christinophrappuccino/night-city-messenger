/**
 * Shard state relay + re-encode + the per-shard editing rule.
 * @file tools/sims/test-shard-edit-relay.mjs
 * @description Drives the REAL DataShardService state writers (on a mocked item
 *   + journal) as a GM, as a player who OWNS the item (a shard on their sheet),
 *   and as a player who does NOT (a shard that arrived as a message attachment —
 *   a world item with no permission), plus the REAL `reencodeShard`, the REAL
 *   `resolveShardEditing` / `canEditShard`, and the wiring every door must share.
 *
 *   Why: a player hacking a world shard used to succeed on the roll and then throw
 *   on item.update, so the shard never unlocked unless the GM handed over Owner
 *   rights — which also put the item in the Items sidebar before its reveal.
 *
 *   Run: node tools/sims/test-shard-edit-relay.mjs
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
const ok = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (err) { console.log(`  ✗ ${name}\n      ${err.message}`); fail++; }
};
const section = (t) => console.log(`\n── ${t} ──`);

// ── Foundry stubs ──────────────────────────────────────────────────────────
const emitted = [];
const settings = {};
let IS_GM = true;
let ACTIVE_GM = { id: 'gm' };
globalThis.game = {
  get user() { return { isGM: IS_GM, id: IS_GM ? 'gm' : 'p1' }; },
  get users() { return { activeGM: ACTIVE_GM }; },
  settings: { get: (m, k) => settings[k], set: async () => {} },
  actors: { get: () => null, contents: [] }, items: { get: () => null }, journal: { get: () => null, contents: [] },
  folders: { find: () => null },
  i18n: { localize: (s) => s },
  nightcity: { socketManager: { emit: (op, d) => emitted.push({ op, d }) }, eventBus: { emit() {} }, soundService: { play() {} } },
};
const warns = [];
globalThis.ui = { notifications: { warn: (m) => warns.push(m), info() {}, error() {} } };
globalThis.Hooks = { on() {}, off() {}, once() {}, call() {}, callAll() {} };
globalThis.CONFIG = {};
const clone = (o) => JSON.parse(JSON.stringify(o));
const merge = (a, b) => {
  const out = clone(a);
  for (const [k, v] of Object.entries(b || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' ? merge(out[k], v) : clone(v);
  }
  return out;
};
globalThis.foundry = {
  utils: {
    deepClone: clone, mergeObject: (a, b) => merge(a, b), randomID: () => 'rid', debounce: (f) => f,
    getProperty: (o, p) => p.split('.').reduce((a, k) => a?.[k], o),
  },
  applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (B) => B }, instances: new Map() },
};
let UUIDS = {};
globalThis.fromUuidSync = (u) => UUIDS[u] || null;

const { MODULE_ID, SOCKET_OPS } = await load('scripts/utils/constants.js');
const { SHARD_EDIT_MODES, resolveShardEditing } = await load('scripts/ui/content/EncoderModel.js');
const { canEditShard } = await load('scripts/utils/helpers.js');
const { DataShardService } = await load('scripts/services/DataShardService.js');

/** A shard item + its GM-owned journal. `owner` = does THIS client own the item? */
function mockShard({ owner = true, config = {}, state = {}, pages: pageSeeds = [] } = {}) {
  const flags = { isDataShard: true, config: clone(config), state: clone(state), journalId: 'j1' };
  const writes = [];
  const pages = pageSeeds.map((p, i) => ({
    id: `pg${i}`, flags: { [MODULE_ID]: { type: 'shard-message', messageId: p.id || `m${i}`, contentType: p.contentType || 'note', contentData: clone(p.contentData || {}) } },
    async update(d) { writes.push({ kind: 'page', id: this.id, d }); for (const [k, v] of Object.entries(d)) { const key = k.replace(`flags.${MODULE_ID}.`, ''); this.flags[MODULE_ID][key] = v; } },
  }));
  const journal = {
    id: 'j1', pages: Object.assign(pages, { find: pages.find.bind(pages), map: pages.map.bind(pages), size: pages.length }),
    async updateEmbeddedDocuments(_t, ups) { writes.push({ kind: 'pages', n: ups.length }); for (const u of ups) { const p = pages.find((x) => x.id === u._id); for (const [k, v] of Object.entries(u)) if (k !== '_id') p.flags[MODULE_ID][k.replace(`flags.${MODULE_ID}.`, '')] = v; } },
    async deleteEmbeddedDocuments(_t, ids) { writes.push({ kind: 'delete', n: ids.length }); },
  };
  const item = {
    id: 'i1', uuid: 'Item.i1', name: 'Shard', isOwner: owner, parent: null,
    getFlag: (_m, k) => flags[k],
    async update(d) {
      if (!owner && !IS_GM) throw new Error('User lacks permission to update Item');
      writes.push({ kind: 'item', d });
      for (const [k, v] of Object.entries(d)) flags[k.replace(`flags.${MODULE_ID}.`, '')] = v;
    },
    async unsetFlag() {}, async setFlag(_m, k, v) { flags[k] = v; },
  };
  game.journal.get = () => journal;
  UUIDS = { 'Item.i1': item };
  return { item, journal, pages, writes, flags };
}
const svc = new DataShardService();
const asGM = () => { IS_GM = true; };
const asPlayer = () => { IS_GM = false; };
const lastEmit = () => emitted.at(-1);

// ═══════════════════════════════════════════════════════════════════════════
section('the state writers — GM and an OWNING player write directly');

await ok('GM: hack success flips decrypted on the item', async () => {
  asGM(); emitted.length = 0;
  const { item, flags } = mockShard();
  await svc._writeDecrypted(item);
  assert.equal(flags.state.decrypted, true);
  assert.equal(emitted.length, 0, 'no relay for a GM');
});
await ok('player who OWNS the item (shard on their sheet): still a direct write, exactly as before', async () => {
  asPlayer(); emitted.length = 0;
  const { item, flags } = mockShard({ owner: true });
  await svc._updateActorSession(item, 'a1', { hackAttempts: 2 });
  assert.equal(flags.state.sessions.a1.hackAttempts, 2);
  assert.equal(emitted.length, 0);
});

section('the state writers — a player who does NOT own the item relays');

await ok('decrypt relays SHARD_STATE_REQUEST instead of throwing', async () => {
  asPlayer(); emitted.length = 0;
  const { item, flags } = mockShard({ owner: false });
  const r = await svc._writeDecrypted(item);
  assert.equal(r, true);
  assert.equal(flags.state.decrypted, undefined, 'nothing written locally');
  assert.equal(lastEmit().op, SOCKET_OPS.SHARD_STATE_REQUEST);
  assert.equal(lastEmit().d.op, 'decrypt');
  assert.equal(lastEmit().d.itemUuid, 'Item.i1');
});
await ok('a session write (attempts / lockout / login / key item) relays with the actor + the patch', async () => {
  asPlayer(); emitted.length = 0;
  const { item } = mockShard({ owner: false });
  await svc._updateActorSession(item, 'a1', { loginAttempts: 1, lockoutUntil: 99 });
  assert.equal(lastEmit().d.op, 'session');
  assert.equal(lastEmit().d.actorId, 'a1');
  assert.deepEqual(lastEmit().d.updates, { loginAttempts: 1, lockoutUntil: 99 });
});
await ok('a per-entry decrypt relays (the journal is GM-owned whoever owns the item)', async () => {
  asPlayer(); emitted.length = 0;
  const { item, pages } = mockShard({ owner: true, pages: [{ id: 'mX' }] });
  await svc._decryptMessage(item, 'mX');
  assert.equal(lastEmit().d.op, 'decryptPage');
  assert.equal(lastEmit().d.messageId, 'mX');
  assert.equal(pages[0].flags[MODULE_ID].decrypted, undefined);
});
await ok('self-destruct relays — a player cannot delete GM-owned pages', async () => {
  asPlayer(); emitted.length = 0;
  const { item, writes } = mockShard({ owner: true, pages: [{}] });
  await svc._destroyShard(item);
  assert.equal(lastEmit().d.op, 'destroy');
  assert.ok(!writes.some((w) => w.kind === 'delete'));
});
await ok('no GM online: the relay refuses OUT LOUD and returns false (nothing silently lost)', async () => {
  asPlayer(); emitted.length = 0; warns.length = 0; ACTIVE_GM = null;
  const { item } = mockShard({ owner: false });
  const r = await svc._writeDecrypted(item);
  ACTIVE_GM = { id: 'gm' };
  assert.equal(r, false);
  assert.equal(emitted.length, 0);
  assert.ok(warns.some((w) => /No GM/i.test(w)), 'the player is told');
});

section('the GM handler lands each op');

await ok('decrypt', async () => {
  asGM();
  const { item, flags } = mockShard();
  await svc.handleStateRequest({ op: 'decrypt', itemUuid: 'Item.i1' });
  assert.equal(flags.state.decrypted, true);
});
await ok('session merges the patch into THAT actor only', async () => {
  asGM();
  const { item, flags } = mockShard({ state: { sessions: { a2: { hackAttempts: 5 } } } });
  await svc.handleStateRequest({ op: 'session', itemUuid: 'Item.i1', actorId: 'a1', updates: { keyItemUsed: true } });
  assert.equal(flags.state.sessions.a1.keyItemUsed, true);
  assert.equal(flags.state.sessions.a2.hackAttempts, 5, 'another actor\'s session untouched');
});
await ok('decryptPage flips the page flag', async () => {
  asGM();
  const { pages } = mockShard({ pages: [{ id: 'mX' }] });
  await svc.handleStateRequest({ op: 'decryptPage', itemUuid: 'Item.i1', messageId: 'mX' });
  assert.equal(pages[0].flags[MODULE_ID].decrypted, true);
});
await ok('destroy deletes the pages and marks the item', async () => {
  asGM();
  const { writes, flags } = mockShard({ pages: [{}, {}] });
  await svc.handleStateRequest({ op: 'destroy', itemUuid: 'Item.i1' });
  assert.ok(writes.some((w) => w.kind === 'delete' && w.n === 2));
  assert.equal(flags.state.destroyed, true);
});
await ok('an unknown shard or op is ignored, never thrown', async () => {
  asGM();
  UUIDS = {};
  await svc.handleStateRequest({ op: 'decrypt', itemUuid: 'Item.nope' });
  mockShard();
  await svc.handleStateRequest({ op: 'banana', itemUuid: 'Item.i1' });
});
await ok('a non-GM client ignores the request entirely', async () => {
  asPlayer();
  const { flags } = mockShard({ owner: true });
  await svc.handleStateRequest({ op: 'decrypt', itemUuid: 'Item.i1' });
  assert.equal(flags.state.decrypted, undefined);
});

section('the hack path really goes through the writer');

await ok('_handleHackSuccess no longer calls item.update by hand', () => {
  const s = read('scripts/services/DataShardService.js');
  const i = s.indexOf('async _handleHackSuccess(');
  const fn = s.slice(i, s.indexOf('async _handleHackFailure('));
  assert.ok(fn.includes('this._writeDecrypted(shardItem)'), 'must route through _writeDecrypted');
  assert.ok(!/shardItem\.update\(/.test(fn), 'a bare item.update throws for a non-owner');
});
await ok('every state writer checks ownership first', () => {
  const s = read('scripts/services/DataShardService.js');
  for (const fn of ['_writeDecrypted(item)', '_updateActorSession(item, actorId, updates)']) {
    const i = s.indexOf(`async ${fn} {`);
    assert.ok(i !== -1, `${fn} missing`);
    assert.ok(s.slice(i, i + 200).includes('_canWriteItem(item)'), `${fn} must ask _canWriteItem`);
  }
  for (const fn of ['_decryptMessage(shardItem, messageId)', '_destroyShard(shardItem)']) {
    const i = s.indexOf(`async ${fn} {`);
    assert.ok(s.slice(i, i + 220).includes("if (!isGM()) return this._relayState("), `${fn} must relay for a player`);
  }
});
await ok('the socket op is registered, GM-only, one GM lands it', () => {
  const s = read('scripts/integrations/SocketHandlers.js');
  const i = s.indexOf('SOCKET_OPS.SHARD_STATE_REQUEST');
  assert.ok(i !== -1);
  const blk = s.slice(i, i + 500);
  assert.ok(blk.includes('if (!game.user.isGM) return;'));
  assert.ok(blk.includes('game.users.activeGM.id !== game.user.id'));
  assert.ok(blk.includes('handleStateRequest(data)'));
});

// ═══════════════════════════════════════════════════════════════════════════
section('who may rewrite a shard — the per-shard rule');

await ok('three modes, each with a label and a short word', () => {
  assert.deepEqual(Object.keys(SHARD_EDIT_MODES), ['locked', 'maker', 'qualified']);
  for (const m of Object.values(SHARD_EDIT_MODES)) { assert.ok(m.label && m.short && m.blurb); }
});
await ok('a missing value resolves by provenance: GM-made → locked, player-made → maker', () => {
  assert.equal(resolveShardEditing({}), 'locked');
  assert.equal(resolveShardEditing(undefined), 'locked');
  assert.equal(resolveShardEditing({ playerMade: { actorId: 'a1' } }), 'maker');
  assert.equal(resolveShardEditing({ playerMade: { actorName: 'V' } }), 'locked', 'no actor id = nobody to be the maker');
});
await ok('an explicit value wins over provenance; junk falls back', () => {
  assert.equal(resolveShardEditing({ playerEditing: 'qualified' }), 'qualified');
  assert.equal(resolveShardEditing({ playerEditing: 'locked', playerMade: { actorId: 'a1' } }), 'locked');
  assert.equal(resolveShardEditing({ playerEditing: 'banana', playerMade: { actorId: 'a1' } }), 'maker');
  assert.equal(resolveShardEditing({ playerEditing: '' }), 'locked');
});

const shardWith = (config) => ({ getFlag: (_m, k) => (k === 'isDataShard' ? true : k === 'config' ? config : undefined) });
const actor = (id) => ({ id, name: id, isOwner: true, items: [] });
settings.encoderConfig = { enabled: true, gate: { mode: 'anyone' } };

await ok('canEditShard: the GM always may', () => {
  asGM();
  assert.equal(canEditShard(shardWith({}), null).ok, true);
});
await ok('canEditShard: a GM-made shard is locked for players, with the reason', () => {
  asPlayer();
  const v = canEditShard(shardWith({}), actor('a1'));
  assert.equal(v.ok, false); assert.equal(v.locked, true); assert.match(v.reason, /read-only/);
});
await ok('canEditShard: maker only — the maker may, another character may not', () => {
  asPlayer();
  const sh = shardWith({ playerMade: { actorId: 'a1', actorName: 'V' } });
  assert.equal(canEditShard(sh, actor('a1')).ok, true);
  const v = canEditShard(sh, actor('a2'));
  assert.equal(v.ok, false); assert.match(v.reason, /Only V/);
});
await ok('canEditShard: qualified opens it to anyone who passes the encoder gate', () => {
  asPlayer();
  const sh = shardWith({ playerEditing: 'qualified' });
  assert.equal(canEditShard(sh, actor('a9')).ok, true);
  settings.encoderConfig = { enabled: false };
  const v = canEditShard(sh, actor('a9'));
  assert.equal(v.ok, false); assert.equal(v.off, true, 'the world switch still governs');
  settings.encoderConfig = { enabled: true, gate: { mode: 'anyone' } };
});
await ok('canEditShard: the GM\'s "rewrite a sloppy shard" switch is honoured (it used to be a dead knob)', () => {
  asPlayer();
  settings.encoderConfig = { enabled: true, gate: { mode: 'anyone' }, reencode: { allowed: false } };
  const v = canEditShard(shardWith({ playerMade: { actorId: 'a1' } }), actor('a1'));
  assert.equal(v.ok, false); assert.match(v.reason, /rewriting/);
  settings.encoderConfig = { enabled: true, gate: { mode: 'anyone' } };
});
await ok('canEditShard: not a shard at all', () => {
  asPlayer();
  assert.equal(canEditShard({ getFlag: () => undefined }, actor('a1')).ok, false);
  assert.equal(canEditShard(null, actor('a1')).ok, false);
});

// ═══════════════════════════════════════════════════════════════════════════
section('re-encode — the write');

await ok('GM-only; a player gets a refusal, not a throw', async () => {
  asPlayer();
  const { item } = mockShard({ owner: true });
  const r = await svc.reencodeShard(item, {});
  assert.equal(r.success, false);
});
await ok('re-stamps quality + scan DV on PLAYER-MADE files only, adds the new ones, keeps the original maker', async () => {
  asGM();
  const { item, flags, pages } = mockShard({
    config: { playerMade: { actorId: 'a1', actorName: 'V', at: '2026-01-01T00:00:00Z', quality: 30, outcome: 'sloppy', kind: 'dossier' }, capacity: 0 },
    pages: [
      { id: 'mine', contentData: { sniffDV: 8, provenance: { playerMade: true, forgeQuality: 30, outcome: 'sloppy' } } },
      { id: 'gms', contentData: { sniffDV: 15 } },
    ],
  });
  let added = [];
  svc.addMessage = async (_i, e) => { added.push(e); return { success: true }; };
  const r = await svc.reencodeShard(item, { actorId: 'a1', actorName: 'V', outcome: 'clean', quality: 74, scanDV: 15, skill: 'Forgery', total: 19, dv: 16, entries: [{ subject: 'new' }] });
  assert.equal(r.success, true);
  assert.equal(r.restamped, 1); assert.equal(r.added, 1);
  assert.equal(pages[0].flags[MODULE_ID].contentData.provenance.forgeQuality, 74);
  assert.equal(pages[0].flags[MODULE_ID].contentData.sniffDV, 15);
  assert.equal(pages[1].flags[MODULE_ID].contentData.sniffDV, 15 /* unchanged */);
  assert.equal(pages[1].flags[MODULE_ID].contentData.provenance, undefined, 'a GM-authored entry is never re-stamped');
  assert.equal(flags.config.playerMade.quality, 74);
  assert.equal(flags.config.playerMade.outcome, 'clean');
  assert.equal(flags.config.playerMade.actorId, 'a1');
  assert.equal(flags.config.playerMade.at, '2026-01-01T00:00:00Z', 'the first encode date survives');
  assert.equal(flags.config.playerMade.reencodes, 1);
  assert.equal(flags.config.playerMade.kind, 'dossier', 'the original kind survives');
  assert.deepEqual(added.map((e) => e.subject), ['new']);
});
await ok('a refused file (full chip) is REPORTED, not dropped silently', async () => {
  asGM();
  const { item } = mockShard({ config: {} });
  svc.addMessage = async () => ({ success: false, full: true, error: 'That chip is full.' });
  const r = await svc.reencodeShard(item, { quality: 50, entries: [{ subject: 'x' }] });
  assert.equal(r.success, true);
  assert.deepEqual(r.failed, ['That chip is full.']);
});
await ok('a shard that was GM-made and opened to a player gains a maker on its first re-encode', async () => {
  asGM();
  const { item, flags } = mockShard({ config: { playerEditing: 'qualified' } });
  svc.addMessage = async () => ({ success: true });
  await svc.reencodeShard(item, { actorId: 'a3', actorName: 'Judy', quality: 60, outcome: 'clean', entries: [] });
  assert.equal(flags.config.playerMade.actorId, 'a3');
  assert.equal(flags.config.playerEditing, 'qualified', 'the GM\'s explicit rule is untouched');
});
await ok('the conversion relay understands a re-encode and never converts', () => {
  const s = read('scripts/integrations/SocketHandlers.js');
  const i = s.indexOf('SOCKET_OPS.SHARD_CONVERT_REQUEST');
  const blk = s.slice(i, i + 1600);
  const re = blk.indexOf('if (data.reencode)');
  const conv = blk.indexOf('service.convertToDataShard(item, config');
  assert.ok(re !== -1 && conv !== -1 && re < conv, 'the re-encode branch must come BEFORE the conversion');
  assert.ok(blk.slice(re, conv).includes('service.reencodeShard(item'));
  assert.ok(blk.slice(re, conv).includes('return;'), 'and must return without converting');
});

// ═══════════════════════════════════════════════════════════════════════════
section('the Encoder\'s re-encode door');

const ENC = read('scripts/ui/ShardEncoder/ShardEncoderApp.js');
await ok('a shard handed to the Encoder opens as a re-encode only when canEditShard says so', () => {
  assert.ok(ENC.includes("const editing = isShard && canEditShard(options.item, this.actor).ok ? options.item : null;"));
  assert.ok(ENC.includes("srcMode: editing ? 'edit' : 'own'"));
});
await ok('a rejected re-encode never bricks the shard', () => {
  const i = ENC.indexOf('_botch(opts = {}) {');
  const fn = ENC.slice(i, i + 300);
  assert.ok(fn.includes("if (!this._isEdit()) return b;"));
  assert.ok(fn.includes("bricks: false"));
  assert.ok(!/botchFor\(tier, \{ nat1/.test(ENC), 'the roll must read the botch through _botch');
});
await ok('the lock stage is absent on a re-encode, and the GM\'s re-encode DV is added', () => {
  assert.ok(ENC.includes("(this.cfg.lock?.allowed !== false && !this._isEdit())"));
  const i = ENC.indexOf('_dv() {');
  assert.ok(ENC.slice(i, i + 400).includes("this.cfg.reencode?.dv"));
});
await ok('room on a re-encode is the chip\'s OWN stamped capacity less what is on it', () => {
  const i = ENC.indexOf('_room() {');
  const fn = ENC.slice(i, i + 500);
  assert.ok(fn.includes("if (this._isEdit())"));
  assert.ok(fn.includes("'config')?.capacity"));
  assert.ok(fn.includes("limit - this._onChip() - this._entries().length"));
});
await ok('the write relays with a `reencode` block through the conversion socket; no conversion, no config', () => {
  const i = ENC.indexOf('async _writeReencode(');
  const fn = ENC.slice(i, ENC.indexOf('async _writeShard('));
  assert.ok(fn.includes('svc?.reencodeShard(item'));
  assert.ok(fn.includes('reencode: patch'));
  assert.ok(!fn.includes('convertToDataShard'));
  const p = ENC.indexOf('const ok = this._isEdit()');
  assert.ok(p !== -1, '_persist must branch on the edit door');
});
await ok('the permission check judges the shard\'s rule again before the roll', () => {
  const i = ENC.indexOf('_permissionProblem() {');
  const fn = ENC.slice(i, ENC.indexOf('_mount() {'));
  assert.ok(fn.includes('canEditShard(item, this.actor)'));
});

section('every door reads canEditShard');
await ok('viewer, sheet rows, directory menu, launch flow, admin badge, config select', () => {
  const inbox = read('scripts/ui/ItemInbox/ItemInboxApp.js');
  assert.ok(inbox.includes('canPlayerEdit: !isGM() && canEditShard(this.item, actor).ok'));
  assert.ok(inbox.includes("game.nightcity?.openEncoder?.({ item: this.item, actor })"), 'a player\'s Add Entry opens the Encoder');
  const hbs = read('templates/item-inbox/item-inbox.hbs');
  assert.ok(hbs.includes('{{#if canPlayerEdit}}'));
  assert.ok(hbs.includes('{{else if canPlayerEdit}}'));
  const so = read('scripts/integrations/ShardSheetOverride.js');
  assert.equal((so.match(/canEditShard\(/g) || []).length, 3, 'directory menu, inventory row, launch flow');
  const tab = read('scripts/ui/AdminPanel/tabs/ShardsTab.js');
  assert.ok(tab.includes('resolveShardEditing(config)'));
  assert.ok(tab.includes("isWorldItem: ownerKey === 'world'"));
  assert.ok(tab.includes('onShardOwnership('));
  const app = read('scripts/ui/AdminPanel/AdminPanelApp.js');
  assert.ok(app.includes('shardOwnership: AdminPanelApp._onShardOwnership'));
  const sh = read('templates/admin-panel/tab-shards.hbs');
  assert.equal((sh.match(/data-action="shardOwnership"/g) || []).length, 2, 'row + expanded actions');
  assert.ok(sh.includes('{{#if this.isWorldItem}}'), 'an embedded item has no ownership of its own');
  const cfg = read('scripts/ui/ItemInbox/ItemInboxConfig.js');
  assert.ok(cfg.includes("playerEditing: val('playerEditing', '')"));
  assert.ok(read('templates/item-inbox/item-inbox-config.hbs').includes('name="playerEditing"'));
});
await ok('the ownership dialog is referenced BARE with a typeof guard (the ImagePopout lesson)', () => {
  const tab = read('scripts/ui/AdminPanel/tabs/ShardsTab.js');
  assert.ok(tab.includes("(typeof DocumentOwnershipConfig !== 'undefined') ? DocumentOwnershipConfig : foundry.applications?.apps?.DocumentOwnershipConfig"));
  assert.ok(!tab.includes('globalThis.DocumentOwnershipConfig'));
});

console.log(`\n${fail ? '✗' : '✓'} ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
