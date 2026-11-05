// A mock Foundry world for NCM sims — ONE place that builds the globals a sim needs (stage 2, batch 7).
//
// Most sims used to build their own `globalThis.game` / `foundry` / `ui` / `Hooks` by hand (133 of them), each a
// little different, so a sim could pass against a mock that behaves unlike Foundry. New sims use this instead;
// old ones move over only when they are next edited.
//
//   import { createMockWorld } from './lib/world.mjs';
//   const world = await createMockWorld({
//     users: [{ id: 'gm1', isGM: true }, { id: 'p1', name: 'Rache' }],   // first user is game.user unless `user` given
//     actors: [{ id: 'a1', name: 'V', type: 'character', owners: ['p1'], system: { wealth: { value: 100, transactions: [] } } }],
//     items: [{ id: 'i1', name: 'Shard', flags: { 'night-city-messenger': { isDataShard: true } } }],
//     journals: [{ id: 'j1', name: 'V — Inbox', flags: { 'night-city-messenger': { type: 'inbox', actorId: 'a1' } }, pages: [{ id: 'pg1', name: 'Hi' }] }],
//     settings: { callsEnabled: false },        // stored values, laid over the defaults
//     realSettings: true,                        // register NCM's REAL settings (SettingsManager.registerAll) — real defaults
//   });
//   world.as('p1', () => …);                     // run as another user (game.user switches)
//   world.toasts, world.chat, world.writes, world.hooks.calls  — what happened
//
// What behaves like Foundry v12:
//   - game.settings.get THROWS for an unregistered key; set() fires the `updateSetting` hook
//   - document.update(changes) takes dot paths and `-=key` deletions; setFlag / getFlag / unsetFlag
//   - isOwner: a GM owns everything; otherwise the document's `owners` list (or ownership default ≥ 3)
//   - embedded collections: actor.items, journal.pages, with create/update/deleteEmbeddedDocuments
//   - writes resolve asynchronously (a microtask, or `latencyMs`), like a server round trip
// Not modelled: permissions on the server side (a mock update never refuses unless `refuse` is set on the doc).

import { pathToFileURL, fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const MODULE_ID = 'night-city-messenger';

// ─── foundry.utils ────────────────────────────────────────────────────────────
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const deepClone = (o) => (o === undefined ? undefined : structuredClone(o));
function getProperty(obj, key) { return String(key).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj); }
function setProperty(obj, key, value) {
  const parts = String(key).split('.'); let o = obj;
  for (const p of parts.slice(0, -1)) { if (!isObj(o[p])) o[p] = {}; o = o[p]; }
  o[parts.at(-1)] = value; return true;
}
function expandObject(flat) {
  const out = {};
  for (const [k, v] of Object.entries(flat || {})) setProperty(out, k, isObj(v) ? expandObject(v) : v);
  return out;
}
/** Foundry's merge, simplified: deep, `-=key` deletes, arrays replace. */
function mergeObject(target, source, { inplace = true } = {}) {
  const t = inplace ? target : deepClone(target);
  for (const [k, v] of Object.entries(source || {})) {
    if (k.startsWith('-=')) { delete t[k.slice(2)]; continue; }
    if (isObj(v) && isObj(t[k])) mergeObject(t[k], v, { inplace: true });
    else t[k] = deepClone(v);
  }
  return t;
}
let idN = 0;
const randomID = (n = 16) => `id${String(++idN).padStart(Math.max(1, n - 2), '0')}`;

// ─── documents ────────────────────────────────────────────────────────────────
class MockCollection extends Map {
  get contents() { return [...this.values()]; }
  getName(name) { return this.contents.find((d) => d.name === name); }
  filter(fn) { return this.contents.filter(fn); }
  find(fn) { return this.contents.find(fn); }
  map(fn) { return this.contents.map(fn); }
  some(fn) { return this.contents.some(fn); }
  [Symbol.iterator]() { return this.values(); }
}

function makeDocClass(world, documentName) {
  return class MockDocument {
    constructor(data = {}, parent = null) {
      this.documentName = documentName;
      this.id = data.id || data._id || randomID();
      this._id = this.id;
      this.name = data.name ?? `${documentName} ${this.id}`;
      this.type = data.type ?? 'base';
      this.img = data.img ?? null;
      this.flags = deepClone(data.flags) || {};
      this.system = deepClone(data.system) || {};
      this.ownership = deepClone(data.ownership) || { default: 0 };
      this.owners = data.owners || [];
      this.folder = data.folder ?? null;
      this.parent = parent;
      this.refuse = !!data.refuse;
      this.latencyMs = data.latencyMs ?? 0;
      for (const [k, v] of Object.entries(data)) if (!(k in this) && k !== 'pages' && k !== 'items') this[k] = deepClone(v);
    }
    get uuid() { return this.parent ? `${this.parent.uuid}.${documentName}.${this.id}` : `${documentName}.${this.id}`; }
    get isOwner() { const u = globalThis.game?.user; return !!u && (u.isGM || this.owners.includes(u.id) || (this.ownership[u.id] ?? this.ownership.default ?? 0) >= 3); }
    get hasPlayerOwner() { return this.owners.some((id) => !world.users.get(id)?.isGM); }
    toObject() { return deepClone({ ...this, parent: undefined }); }
    getFlag(scope, key) { return getProperty(this.flags?.[scope], key); }
    setFlag(scope, key, value) { return this.update({ [`flags.${scope}.${key}`]: value }); }
    unsetFlag(scope, key) { const parts = `${scope}.${key}`.split('.'); return this.update({ [`flags.${parts.slice(0, -1).join('.')}.-=${parts.at(-1)}`]: null }); }
    async update(changes = {}, options = {}) {
      await (this.latencyMs ? new Promise((r) => setTimeout(r, this.latencyMs)) : Promise.resolve());
      if (this.refuse) throw new Error(`User ${globalThis.game?.user?.name} lacks permission to update ${documentName} ${this.name}`);
      for (const [path, value] of Object.entries(changes)) {
        const parts = path.split('.'); const last = parts.at(-1);
        if (last.startsWith('-=')) { const holder = getProperty(this, parts.slice(0, -1).join('.')); if (isObj(holder)) delete holder[last.slice(2)]; continue; }
        if (parts.length === 1 && isObj(value) && isObj(this[path])) mergeObject(this[path], value);
        else setProperty(this, path, deepClone(value));
      }
      world.writes.push({ doc: this.uuid, changes: deepClone(changes), options });
      world.hooks.callAll(`update${documentName}`, this, changes, options, globalThis.game?.user?.id);
      return this;
    }
    async delete() {
      const coll = this.parent ? this.parent[EMBED[documentName]] : world.collections[documentName];
      coll?.delete(this.id);
      world.hooks.callAll(`delete${documentName}`, this, {}, globalThis.game?.user?.id);
      return this;
    }
  };
}
const EMBED = { Item: 'items', JournalEntryPage: 'pages' };

function withEmbedded(doc, collName, Cls, list = []) {
  doc[collName] = new MockCollection();
  for (const d of list) { const c = new Cls(d, doc); c._world = doc._world; doc[collName].set(c.id, c); }
  doc.createEmbeddedDocuments = async (type, datas = []) => {
    await Promise.resolve();
    const made = datas.map((d) => { const c = new Cls(d, doc); c._world = doc._world; doc[collName].set(c.id, c); return c; });
    for (const c of made) doc._world.hooks.callAll(`create${type}`, c, {}, globalThis.game?.user?.id);
    return made;
  };
  doc.updateEmbeddedDocuments = async (type, updates = []) => Promise.all(updates.map((u) => doc[collName].get(u._id)?.update(Object.fromEntries(Object.entries(u).filter(([k]) => k !== '_id')))));
  doc.deleteEmbeddedDocuments = async (type, ids = []) => Promise.all(ids.map((id) => doc[collName].get(id)?.delete()));
  return doc;
}

// ─── the world ────────────────────────────────────────────────────────────────
/**
 * Build a mock world and install the Foundry globals. Returns handles to inspect what happened.
 * @returns {Promise<object>}
 */
export async function createMockWorld({ users = [{ id: 'gm1', name: 'GM', isGM: true }], user = null, actors = [], items = [], journals = [], scenes = [], settings = {}, realSettings = false } = {}) {
  const world = { writes: [], toasts: [], chat: [], collections: {} };

  // hooks
  const handlers = new Map(); let hookId = 0;
  world.hooks = {
    calls: [],
    on(name, fn) { const id = ++hookId; if (!handlers.has(name)) handlers.set(name, new Map()); handlers.get(name).set(id, fn); return id; },
    once(name, fn) { const id = world.hooks.on(name, (...a) => { world.hooks.off(name, id); return fn(...a); }); return id; },
    off(name, idOrFn) { const m = handlers.get(name); if (!m) return; for (const [id, fn] of m) if (id === idOrFn || fn === idOrFn) m.delete(id); },
    callAll(name, ...args) { world.hooks.calls.push({ name, args }); for (const fn of [...(handlers.get(name)?.values() || [])]) { try { fn(...args); } catch (e) { console.error(`hook ${name}:`, e); } } return true; },
    call(name, ...args) { world.hooks.calls.push({ name, args }); for (const fn of [...(handlers.get(name)?.values() || [])]) { if (fn(...args) === false) return false; } return true; },
    count(name) { return handlers.get(name)?.size || 0; },
  };

  // users
  world.users = new MockCollection();
  for (const u of users) world.users.set(u.id, { id: u.id, name: u.name ?? u.id, isGM: !!u.isGM, role: u.role ?? (u.isGM ? 4 : 1), active: u.active ?? true, character: u.character ?? null, flags: deepClone(u.flags) || {} });
  Object.defineProperty(world.users, 'activeGM', { get() { return world.users.contents.filter((u) => u.isGM && u.active).sort((a, b) => a.id.localeCompare(b.id))[0] || null; } });

  // documents
  const Actor = makeDocClass(world, 'Actor'), Item = makeDocClass(world, 'Item'), JournalEntry = makeDocClass(world, 'JournalEntry'),
    JournalEntryPage = makeDocClass(world, 'JournalEntryPage'), Scene = makeDocClass(world, 'Scene');
  const coll = (name, Cls, list, embed) => {
    const c = new MockCollection();
    for (const d of list) { const doc = new Cls(d); doc._world = world; if (embed) withEmbedded(doc, embed[0], embed[1], d[embed[0]]); c.set(doc.id, doc); }
    world.collections[name] = c; return c;
  };
  const gameActors = coll('Actor', Actor, actors, ['items', Item]);
  const gameItems = coll('Item', Item, items);
  const gameJournal = coll('JournalEntry', JournalEntry, journals, ['pages', JournalEntryPage]);
  const gameScenes = coll('Scene', Scene, scenes);
  Actor.create = async (data) => { const doc = new Actor(data); doc._world = world; withEmbedded(doc, 'items', Item, data.items); gameActors.set(doc.id, doc); world.hooks.callAll('createActor', doc, {}, globalThis.game?.user?.id); return doc; };
  Item.create = async (data) => { const doc = new Item(data); doc._world = world; gameItems.set(doc.id, doc); world.hooks.callAll('createItem', doc, {}, globalThis.game?.user?.id); return doc; };
  JournalEntry.create = async (data) => { const doc = new JournalEntry(data); doc._world = world; withEmbedded(doc, 'pages', JournalEntryPage, data.pages); gameJournal.set(doc.id, doc); world.hooks.callAll('createJournalEntry', doc, {}, globalThis.game?.user?.id); return doc; };

  // settings — get throws for an unregistered key, like Foundry
  const registered = new Map(); const stored = new Map();
  const gameSettings = {
    settings: registered,
    register(scope, key, data) { registered.set(`${scope}.${key}`, { ...data, key, namespace: scope }); },
    registerMenu() {},
    get(scope, key) {
      const id = `${scope}.${key}`;
      if (!registered.has(id)) throw new Error(`"${id}" is not a registered game setting`);
      return stored.has(id) ? deepClone(stored.get(id)) : deepClone(registered.get(id).default);
    },
    async set(scope, key, value) {
      const id = `${scope}.${key}`;
      if (!registered.has(id)) throw new Error(`"${id}" is not a registered game setting`);
      stored.set(id, deepClone(value));
      world.hooks.callAll('updateSetting', { key: id, value: deepClone(value) }, {}, {}, globalThis.game?.user?.id);
      return value;
    },
  };

  const current = world.users.get(user || users[0]?.id);
  globalThis.game = {
    user: current, users: world.users, actors: gameActors, items: gameItems, journal: gameJournal, scenes: gameScenes,
    settings: gameSettings, i18n: { localize: (s) => s, format: (s) => s }, modules: new Map([[MODULE_ID, { id: MODULE_ID, active: true, version: 'sim' }]]),
    keybindings: { register() {} }, socket: { on() {}, emit() {} }, nightcity: {}, ready: true,
  };
  globalThis.foundry = { utils: { deepClone, mergeObject, getProperty, setProperty, expandObject, randomID, isEmpty: (o) => !o || !Object.keys(o).length } };
  globalThis.ui = { notifications: Object.fromEntries(['info', 'warn', 'error', 'notify'].map((lvl) => [lvl, (msg) => { world.toasts.push({ level: lvl, msg: String(msg) }); return { id: world.toasts.length }; }])) };
  globalThis.Hooks = world.hooks;
  globalThis.CONFIG = globalThis.CONFIG || {};
  globalThis.CONST = globalThis.CONST || { KEYBINDING_PRECEDENCE: { NORMAL: 0 }, DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 } };
  globalThis.ChatMessage = { create: async (data) => { world.chat.push(deepClone(data)); return data; }, getWhisperRecipients: (n) => (n === 'GM' ? world.users.filter((u) => u.isGM) : []) };
  globalThis.Actor = Actor; globalThis.Item = Item; globalThis.JournalEntry = JournalEntry;
  globalThis.fromUuidSync = (uuid) => world.fromUuid(uuid);
  globalThis.fromUuid = async (uuid) => world.fromUuid(uuid);

  world.fromUuid = (uuid) => {
    const parts = String(uuid || '').split('.'); let doc = null;
    for (let i = 0; i < parts.length; i += 2) {
      const [type, id] = [parts[i], parts[i + 1]];
      if (!doc) doc = world.collections[type]?.get(id) || null;
      else doc = doc[EMBED[type]]?.get(id) || null;
      if (!doc) return null;
    }
    return doc;
  };
  world.as = (userId, fn) => {
    const prev = globalThis.game.user; globalThis.game.user = world.users.get(userId);
    try { const r = fn(); if (r && typeof r.then === 'function') return r.finally(() => { globalThis.game.user = prev; }); globalThis.game.user = prev; return r; }
    catch (e) { globalThis.game.user = prev; throw e; }
  };
  world.setting = (key) => gameSettings.get(MODULE_ID, key);

  // NCM's real settings (their real defaults), then the sim's own values on top
  if (realSettings) {
    const { SettingsManager } = await import(pathToFileURL(`${ROOT}/scripts/core/SettingsManager.js`).href);
    const sm = SettingsManager.getInstance();
    sm._registered = false;          // a second world in the same sim registers again
    sm.registerAll();
  }
  for (const [k, v] of Object.entries(settings)) {
    const id = `${MODULE_ID}.${k}`;
    if (!registered.has(id)) registered.set(id, { key: k, namespace: MODULE_ID, scope: 'world', default: undefined });
    stored.set(id, deepClone(v));
  }
  return world;
}
