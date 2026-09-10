/**
 * NamespaceMigration — one-time carry-over of a world's NCM data from the
 * module's ORIGINAL id (`cyberpunkred-messenger`, v1.0) to the current one
 * (`night-city-messenger`).
 * @file scripts/core/NamespaceMigration.js
 * @module night-city-messenger
 *
 * WHY: a Foundry module id is not cosmetic — it is the flags namespace on
 * every actor/item/journal/page/scene/note, the world- and client-settings
 * namespace, the socket name and the compendium pack ids. Renaming the module
 * therefore orphans every existing world's inboxes, contacts, shards,
 * terminals, trace log and preferences unless the data is moved. This module
 * moves it, ONCE, on the first GM load of the renamed module.
 *
 * TWO PASSES, TWO PHASES:
 *   - `migrateClientSettings()` — preInit/1 on EVERY client: copies
 *     localStorage keys `<legacy>.<key>` → `<id>.<key>` (never clobbers).
 *     Cheap, local, idempotent, needs no permission.
 *   - `runNamespaceMigration()` — ready/1 on the GM client only, BEFORE any
 *     service loads world state: scans for legacy world settings + document
 *     flags, asks the GM to confirm (it rewrites flags in place), copies world
 *     settings, then per collection copies each document's legacy flag block
 *     into the new namespace, VERIFIES the copy read back equal, and only then
 *     deletes the legacy block. A document whose copy doesn't verify keeps its
 *     legacy flags and is listed in the warning. Ends with a world reload
 *     prompt so every client's cached state is rebuilt from the moved data.
 *
 * The hidden world setting `namespaceMigrationDone` short-circuits the scan on
 * later loads. A declined prompt does NOT stamp it — the GM is asked again
 * next load (the module runs empty until then). A fresh world (nothing legacy
 * found) stamps it silently.
 *
 * This uses a raw `Dialog.confirm` deliberately: it runs at ready/1, before
 * the admin-dialog hook (registerGMTools, ready/111) exists, and it is boot
 * plumbing rather than a GM tool.
 */

import { MODULE_ID, LEGACY_MODULE_ID } from '../utils/constants.js';
import { log, isGM } from '../utils/helpers.js';

/** Hidden world setting stamped once the world has been checked/migrated. */
export const NAMESPACE_MIGRATION_SETTING = 'namespaceMigrationDone';

/**
 * Primary world collections that can carry NCM flags, with the embedded
 * collections (by document name) that can too. Scenes carry dead-zone /
 * availability flags; their Notes carry terminal scene pins; Tokens are
 * included cheaply in case a token was ever flagged directly. Unlinked token
 * actor deltas are NOT walked (NCM never writes flags there).
 */
export const MIGRATION_SCOPES = Object.freeze([
  { collection: 'actors',   embedded: ['Item'] },
  { collection: 'items',    embedded: [] },
  { collection: 'journal',  embedded: ['JournalEntryPage'] },
  { collection: 'scenes',   embedded: ['Note', 'Token'] },
  { collection: 'users',    embedded: [] },
  { collection: 'macros',   embedded: [] },
  { collection: 'folders',  embedded: [] },
  { collection: 'messages', embedded: [] },
]);

/** True when a document still carries a non-empty legacy flag block. */
export function hasLegacyFlags(doc) {
  const f = doc?.flags?.[LEGACY_MODULE_ID];
  return !!f && typeof f === 'object' && Object.keys(f).length > 0;
}

/**
 * Copy client-scoped settings (localStorage) from the legacy namespace.
 * Never overwrites a key already present under the new id.
 * @param {Storage} [storage]
 * @returns {number} keys copied
 */
export function migrateClientSettings(storage = globalThis.localStorage) {
  if (!storage) return 0;
  const prefix = `${LEGACY_MODULE_ID}.`;
  const keys = [];
  for (let i = 0; i < storage.length; i++) keys.push(storage.key(i));
  let copied = 0;
  for (const key of keys) {
    if (!key?.startsWith(prefix)) continue;
    const target = `${MODULE_ID}.${key.slice(prefix.length)}`;
    if (storage.getItem(target) !== null) continue;
    storage.setItem(target, storage.getItem(key));
    copied++;
  }
  if (copied) log.info(`Namespace migration: ${copied} client setting(s) carried over from ${LEGACY_MODULE_ID}`);
  return copied;
}

/**
 * Count what a world still holds under the legacy id (drives the prompt).
 * @returns {{settings: number, docs: number, embedded: number}}
 */
export function scanLegacyData() {
  const found = { settings: 0, docs: 0, embedded: 0 };
  const world = game.settings?.storage?.get?.('world');
  if (world) for (const s of world) if (s.key?.startsWith(`${LEGACY_MODULE_ID}.`)) found.settings++;
  for (const { collection, embedded } of MIGRATION_SCOPES) {
    const coll = game[collection];
    if (!coll) continue;
    for (const doc of coll) {
      if (hasLegacyFlags(doc)) found.docs++;
      for (const name of embedded) {
        const sub = doc.getEmbeddedCollection?.(name);
        if (!sub) continue;
        for (const e of sub) if (hasLegacyFlags(e)) found.embedded++;
      }
    }
  }
  return found;
}

/**
 * Copy world-scoped settings from the legacy namespace. Only keys the current
 * build registers are copied (an unregistered key can't be `set`); a key that
 * already has a value under the new id is left alone (never clobber). Legacy
 * Setting documents are left in place — they are inert (unregistered) and
 * make a rollback to v1.0 possible.
 * @returns {Promise<{copied: number, skipped: string[]}>}
 */
export async function migrateWorldSettings() {
  const world = game.settings.storage.get('world');
  const prefix = `${LEGACY_MODULE_ID}.`;
  const result = { copied: 0, skipped: [] };
  for (const s of [...world]) {
    if (!s.key?.startsWith(prefix)) continue;
    const key = s.key.slice(prefix.length);
    const newKey = `${MODULE_ID}.${key}`;
    if (!game.settings.settings.has(newKey)) { result.skipped.push(key); continue; }
    if (world.find(x => x.key === newKey)) continue;
    let value = s.value;
    if (typeof value === 'string') { try { value = JSON.parse(value); } catch { /* keep raw */ } }
    await game.settings.set(MODULE_ID, key, value);
    result.copied++;
  }
  return result;
}

/**
 * Move the legacy flag block of each document in `docs` into the new
 * namespace: copy → verify read-back → delete legacy (verified docs only).
 * @param {Document[]} docs
 * @param {(updates: object[]) => Promise<any>} applyUpdates - batch updater for these docs
 * @returns {Promise<{migrated: number, mismatched: string[]}>}
 */
export async function migrateDocumentFlags(docs, applyUpdates) {
  const targets = docs.filter(hasLegacyFlags);
  if (!targets.length) return { migrated: 0, mismatched: [] };
  const copies = new Map(targets.map(d => [d.id, foundry.utils.deepClone(d.flags[LEGACY_MODULE_ID])]));

  await applyUpdates(targets.map(d => ({ _id: d.id, [`flags.${MODULE_ID}`]: copies.get(d.id) })));

  const ok = [], mismatched = [];
  for (const d of targets) {
    const now = d.flags?.[MODULE_ID];
    if (now && foundry.utils.objectsEqual(now, copies.get(d.id))) ok.push(d);
    else mismatched.push(`${d.documentName ?? 'Document'} "${d.name ?? d.id}"`);
  }
  if (ok.length) await applyUpdates(ok.map(d => ({ _id: d.id, [`flags.-=${LEGACY_MODULE_ID}`]: null })));
  return { migrated: ok.length, mismatched };
}

/**
 * Walk every MIGRATION_SCOPES collection (primary docs, then each parent's
 * embedded docs) through migrateDocumentFlags.
 * @returns {Promise<{migrated: number, mismatched: string[]}>}
 */
export async function migrateAllDocuments() {
  const total = { migrated: 0, mismatched: [] };
  const add = (r) => { total.migrated += r.migrated; total.mismatched.push(...r.mismatched); };
  for (const { collection, embedded } of MIGRATION_SCOPES) {
    const coll = game[collection];
    if (!coll) continue;
    const docs = [...coll];
    add(await migrateDocumentFlags(docs, (updates) => coll.documentClass.updateDocuments(updates)));
    for (const parent of docs) {
      for (const name of embedded) {
        const sub = parent.getEmbeddedCollection?.(name);
        if (!sub) continue;
        add(await migrateDocumentFlags([...sub], (updates) => parent.updateEmbeddedDocuments(name, updates)));
      }
    }
  }
  return total;
}

/** The GM prompt. Split out so the sim can stub it. */
export async function confirmNamespaceMigration(found) {
  const content = `
    <p><b>Night City Messenger</b> found data stored under the module's previous id
    (<code>${LEGACY_MODULE_ID}</code>):</p>
    <ul>
      <li>${found.settings} world setting(s)</li>
      <li>${found.docs} document(s) and ${found.embedded} embedded document(s) with NCM flags</li>
    </ul>
    <p>Move it to <code>${MODULE_ID}</code> now? This rewrites flags in place and cannot be
    undone — <b>back up the world first</b>. The world reloads afterwards.</p>
    <p>Choosing <i>Not now</i> leaves the world untouched; NCM runs empty until you migrate.</p>`;
  return Dialog.confirm({
    title: 'Night City Messenger — migrate module data',
    content,
    yes: () => true,
    no: () => false,
    defaultYes: true,
    options: { width: 480 },
  });
}

/** Prompt every client to reload so cached services rebuild from the moved data. */
function requestWorldReload() {
  const SC = (typeof SettingsConfig !== 'undefined') ? SettingsConfig : foundry.applications?.settings?.SettingsConfig;
  if (SC?.reloadConfirm) SC.reloadConfirm({ world: true });
  else window.location.reload();
}

/**
 * GM-only, once per world. Safe to call on every startup.
 * @returns {Promise<'skipped'|'fresh'|'declined'|'migrated'>}
 */
export async function runNamespaceMigration() {
  if (!isGM()) return 'skipped';
  try { if (game.settings.get(MODULE_ID, NAMESPACE_MIGRATION_SETTING)) return 'skipped'; }
  catch { return 'skipped'; } // setting not registered — nothing sane to do

  const found = scanLegacyData();
  if (found.settings + found.docs + found.embedded === 0) {
    await game.settings.set(MODULE_ID, NAMESPACE_MIGRATION_SETTING, true);
    return 'fresh';
  }

  if (!(await confirmNamespaceMigration(found))) {
    log.warn(`Namespace migration declined — ${LEGACY_MODULE_ID} data left in place; you will be asked again next load.`);
    ui.notifications?.warn('NCM | Module data was NOT migrated. Reload to be asked again.', { permanent: true });
    return 'declined';
  }

  log.info(`Namespace migration: ${LEGACY_MODULE_ID} → ${MODULE_ID} (${found.settings} settings, ${found.docs} docs, ${found.embedded} embedded)`);
  const settings = await migrateWorldSettings();
  const docs = await migrateAllDocuments();
  await game.settings.set(MODULE_ID, NAMESPACE_MIGRATION_SETTING, true);

  if (settings.skipped.length) log.warn(`Namespace migration: ${settings.skipped.length} legacy setting(s) no longer registered, left in place: ${settings.skipped.join(', ')}`);
  if (docs.mismatched.length) {
    log.error(`Namespace migration: ${docs.mismatched.length} document(s) did not verify and KEEP their legacy flags: ${docs.mismatched.join('; ')}`);
    ui.notifications?.error(`NCM | Migrated ${docs.migrated} document(s); ${docs.mismatched.length} did not verify (see console). Their legacy flags were kept.`, { permanent: true });
  } else {
    ui.notifications?.info(`NCM | Module data migrated: ${settings.copied} setting(s), ${docs.migrated} document(s). Reloading…`, { permanent: true });
  }
  requestWorldReload();
  return 'migrated';
}
