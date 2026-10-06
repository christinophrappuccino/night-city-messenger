/**
 * Factory Reset — return a world to "NCM was never here" (GM-only).
 * @file scripts/core/FactoryReset.js
 * @module night-city-messenger
 *
 * The Tools → Danger Zone → Factory Reset action. Two halves so the sim can
 * drive the real logic:
 *   • {@link gatherResetPlan} — a read-only census of everything the reset
 *     would touch (the dialog shows it before the GM types RESET).
 *   • {@link runFactoryReset} — performs it, then asks every client to reload
 *     (services cache world state; a reload is the only honest way to drop it).
 *
 * What goes:
 *   1. Every NCM journal — inboxes, NPC mail, shard + terminal journals — and
 *      anything else inside the "Night City Messenger" journal folder tree,
 *      then the folder tree itself.
 *   2. Terminal scene pins (Notes flagged `terminalItemId`) — a pin whose
 *      journal is gone is dead anyway.
 *   3. Module-managed macros (`managed: true`, i.e. installed by Tools →
 *      Import Macros) and their two folders. GM-authored macros only lose
 *      their NCM flag block.
 *   4. The `flags.night-city-messenger` block on every other document across
 *      {@link MIGRATION_SCOPES}: actors (contacts, email, wealth ledger…) and
 *      their items (shard/terminal conversions become plain items again),
 *      world items, scenes + tokens (network availability, dead zones),
 *      users, folders, chat messages.
 *   5. Optionally (`resetSettings`, default on) every registered WORLD
 *      setting back to its default — networks, the master contact directory,
 *      spam/entry/theme templates, trace log + heat, operator gate, module
 *      preferences. Two internal stamps are deliberately KEPT:
 *      `namespaceMigrationDone` (legacy Setting documents stay on disk, and
 *      un-stamping would re-prompt the id migration on next load) and
 *      `dataSchemaVersion` (set to the current schema — an empty world is
 *      already at the newest shape).
 *
 * Never touched: compendium packs, CLIENT-scoped settings (each player's
 * theme / sound prefs live in their own browser), non-NCM documents.
 */

import { MODULE_ID } from '../utils/constants.js';
import { log, isGM } from '../utils/helpers.js';
import { MIGRATION_SCOPES } from './NamespaceMigration.js';
import { DATA_SCHEMA_VERSION } from './MigrationRunner.js';
import { MessageRepository } from '../data/MessageRepository.js';

/** World settings the reset must leave stamped (see file header). */
export const RESET_KEEP_SETTINGS = Object.freeze(['namespaceMigrationDone', 'dataSchemaVersion']);

/** Folder names the macro installer creates (ToolsTab.onImportMacros). */
const MACRO_FOLDERS = Object.freeze(['NCM — Player Tools', 'NCM — GM Tools']);

/** True when a document carries a non-empty NCM flag block. */
export function hasModuleFlags(doc) {
  const f = doc?.flags?.[MODULE_ID];
  return !!f && typeof f === 'object' && Object.keys(f).length > 0;
}

/** Every folder in the NCM journal tree (root + descendants), root first. */
export function collectJournalFolderTree() {
  const rootName = MessageRepository.ROOT_FOLDER_NAME;
  const all = [...(game.folders ?? [])];
  const roots = all.filter(f => f.type === 'JournalEntry' && f.name === rootName && !f.folder);
  const out = [];
  const walk = (folder) => {
    out.push(folder);
    for (const child of all.filter(f => f.type === 'JournalEntry' && f.folder?.id === folder.id)) walk(child);
  };
  for (const r of roots) walk(r);
  return out;
}

/** Journals the reset deletes: NCM-flagged, or living anywhere in the NCM folder tree. */
export function collectNcmJournals() {
  const treeIds = new Set(collectJournalFolderTree().map(f => f.id));
  return [...(game.journal ?? [])].filter(j => hasModuleFlags(j) || (j.folder && treeIds.has(j.folder.id)));
}

/** Registered WORLD settings of this module that the reset returns to default. */
export function collectResettableSettings() {
  const out = [];
  for (const cfg of game.settings?.settings?.values?.() ?? []) {
    if (cfg.namespace !== MODULE_ID || cfg.scope !== 'world') continue;
    if (RESET_KEEP_SETTINGS.includes(cfg.key)) continue;
    out.push(cfg);
  }
  return out;
}

/**
 * Read-only census of what a reset would touch.
 * @returns {{ journals: number, folders: number, pins: number, managedMacros: number,
 *             flagged: Array<{label: string, count: number}>, settings: number }}
 */
export function gatherResetPlan() {
  const journals = collectNcmJournals();
  const folders = collectJournalFolderTree();

  let pins = 0;
  for (const scene of game.scenes ?? []) {
    for (const note of scene.notes ?? []) if (note.getFlag?.(MODULE_ID, 'terminalItemId')) pins++;
  }

  const managedMacros = [...(game.macros ?? [])].filter(m => m.getFlag?.(MODULE_ID, 'managed') === true).length;

  const flagged = [];
  for (const { collection, embedded } of MIGRATION_SCOPES) {
    const coll = game[collection];
    if (!coll) continue;
    const docs = [...coll];
    // Journals are deleted outright (pages go with them); macros are counted
    // separately when managed. Everything else: count flag blocks to strip.
    if (collection !== 'journal') {
      const n = docs.filter(d => hasModuleFlags(d) && !(collection === 'macros' && d.getFlag?.(MODULE_ID, 'managed') === true)).length;
      if (n) flagged.push({ label: collection, count: n });
    }
    for (const name of embedded) {
      if (collection === 'journal') continue;
      let n = 0;
      for (const parent of docs) {
        const sub = parent.getEmbeddedCollection?.(name);
        if (!sub) continue;
        for (const d of sub) {
          if (name === 'Note' && d.getFlag?.(MODULE_ID, 'terminalItemId')) continue; // counted as a pin
          if (hasModuleFlags(d)) n++;
        }
      }
      if (n) flagged.push({ label: `${collection} → ${name}`, count: n });
    }
  }
  return { journals: journals.length, folders: folders.length, pins, managedMacros, flagged, settings: collectResettableSettings().length };
}

/**
 * Strip the module flag block from a batch of documents.
 * @param {Document[]} docs
 * @param {(updates: object[]) => Promise<any>} applyUpdates
 * @returns {Promise<number>} documents updated
 */
export async function stripModuleFlags(docs, applyUpdates) {
  const updates = docs.filter(hasModuleFlags).map(d => ({ _id: d.id, [`flags.-=${MODULE_ID}`]: null }));
  if (!updates.length) return 0;
  await applyUpdates(updates);
  return updates.length;
}

/**
 * Perform the reset. GM only. Does NOT confirm — the caller owns the dialog.
 * @param {object} [options]
 * @param {boolean} [options.resetSettings=true] — return world settings to defaults
 * @param {boolean} [options.reload=true] — prompt every client to reload afterwards
 * @returns {Promise<{ journals: number, folders: number, pins: number, macros: number, stripped: number, settings: number }>}
 */
export async function runFactoryReset({ resetSettings = true, reload = true } = {}) {
  if (!isGM()) throw new Error('Factory reset is GM-only');
  const result = { journals: 0, folders: 0, pins: 0, macros: 0, stripped: 0, settings: 0 };

  // 1. Journals, then the folder tree (contents already gone; deleteSubfolders
  //    takes the children with the root, deepest first is unnecessary).
  const journals = collectNcmJournals();
  if (journals.length) {
    await JournalEntry.deleteDocuments(journals.map(j => j.id));
    result.journals = journals.length;
  }
  const tree = collectJournalFolderTree();
  const roots = tree.filter(f => !f.folder);
  for (const root of roots) {
    await root.delete({ deleteSubfolders: true, deleteContents: true });
  }
  result.folders = tree.length;

  // 2. Terminal scene pins.
  for (const scene of game.scenes ?? []) {
    const ids = [...(scene.notes ?? [])].filter(n => n.getFlag?.(MODULE_ID, 'terminalItemId')).map(n => n.id);
    if (ids.length) {
      await scene.deleteEmbeddedDocuments('Note', ids);
      result.pins += ids.length;
    }
  }

  // 3. Managed macros + their folders.
  const managed = [...(game.macros ?? [])].filter(m => m.getFlag?.(MODULE_ID, 'managed') === true);
  if (managed.length) {
    await Macro.deleteDocuments(managed.map(m => m.id));
    result.macros = managed.length;
  }
  for (const name of MACRO_FOLDERS) {
    const folder = [...(game.folders ?? [])].find(f => f.type === 'Macro' && f.name === name);
    if (folder && !folder.contents?.length) await folder.delete();
  }

  // 4. Flag blocks everywhere else.
  for (const { collection, embedded } of MIGRATION_SCOPES) {
    if (collection === 'journal') continue; // deleted above
    const coll = game[collection];
    if (!coll) continue;
    const docs = [...coll];
    // Managed macros and pin notes were DELETED above — never re-touch them
    // (a collection snapshot can still hold them until the delete settles).
    const isGone = (name, d) =>
      (name === 'macros' && d.getFlag?.(MODULE_ID, 'managed') === true) ||
      (name === 'Note' && !!d.getFlag?.(MODULE_ID, 'terminalItemId'));
    result.stripped += await stripModuleFlags(docs.filter(d => !isGone(collection, d)), (updates) => coll.documentClass.updateDocuments(updates));
    for (const parent of docs) {
      for (const name of embedded) {
        const sub = parent.getEmbeddedCollection?.(name);
        if (!sub) continue;
        result.stripped += await stripModuleFlags([...sub].filter(d => !isGone(name, d)), (updates) => parent.updateEmbeddedDocuments(name, updates));
      }
    }
  }

  // 5. World settings.
  if (resetSettings) {
    for (const cfg of collectResettableSettings()) {
      try {
        const def = (typeof cfg.default === 'object' && cfg.default !== null)
          ? foundry.utils.deepClone(cfg.default)
          : cfg.default;
        await game.settings.set(MODULE_ID, cfg.key, def);
        result.settings++;
      } catch (err) {
        log.warn(`Factory reset: could not reset setting ${cfg.key}: ${err?.message || err}`);
      }
    }
  }
  try { await game.settings.set(MODULE_ID, 'namespaceMigrationDone', true); } catch { /* not registered */ }
  try { await game.settings.set(MODULE_ID, 'dataSchemaVersion', DATA_SCHEMA_VERSION); } catch { /* not registered */ }

  log.info(`Factory reset: ${result.journals} journal(s), ${result.folders} folder(s), ${result.pins} pin(s), `
    + `${result.macros} macro(s), ${result.stripped} flag block(s), ${result.settings} setting(s)`);

  if (reload) requestWorldReload();
  return result;
}

/** Prompt every client to reload so cached services rebuild from the empty world. */
function requestWorldReload() {
  const SC = (typeof SettingsConfig !== 'undefined') ? SettingsConfig : foundry.applications?.settings?.SettingsConfig;
  if (SC?.reloadConfirm) SC.reloadConfirm({ world: true });
  else globalThis.location?.reload?.();
}
