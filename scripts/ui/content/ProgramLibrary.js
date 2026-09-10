/**
 * Program Library — world setting `programLibrary`.
 * @file scripts/ui/content/ProgramLibrary.js
 * @module night-city-messenger
 * @description GM-authored programs from the Malware Workshop, saved with the world and
 *   reusable across shards/NPCs. Records are `{ id, name, group, icon, program }` where
 *   `program` is the workshop's own definition (see ProgramModel). Mirrors the
 *   `entryTemplates` module: module-level functions, `game.settings.get/set`, fresh ids,
 *   a `{ ncmProgramLibrary: 1, … }` JSON envelope, de-dupe by name.
 */

import { MODULE_ID } from '../../utils/constants.js';
import { log } from '../../utils/helpers.js';
import { defaultProgram, programGroup, abilityInfo } from './ProgramModel.js';

const SETTING = 'programLibrary';

/** All saved programs: [{ id, name, group, icon, program }]. */
export function getPrograms() {
  try { return game.settings.get(MODULE_ID, SETTING) ?? []; }
  catch { return []; }
}

/** Build the display-meta wrapper around a program definition. */
function record(name, program, id) {
  const p = program || defaultProgram();
  return {
    id: id || `prog-${foundry.utils.randomID(8)}`,
    name: String(name || p.progName || 'Untitled').trim() || 'Untitled',
    group: programGroup(p),
    icon: p.icon || abilityInfo(p.verb)?.icon || 'fas fa-bolt',
    program: foundry.utils.deepClone(p),
  };
}

/** Save (or overwrite by id) a program. Returns the stored record. */
export async function savePrograms(name, program, id = null) {
  const list = getPrograms().map((r) => ({ ...r }));
  const rec = record(name, program, id);
  const idx = id ? list.findIndex((r) => r.id === id) : -1;
  if (idx >= 0) list[idx] = rec;
  else list.push(rec);
  await game.settings.set(MODULE_ID, SETTING, list);
  return rec;
}

export async function deleteProgram(id) {
  const list = getPrograms().filter((r) => r.id !== id);
  await game.settings.set(MODULE_ID, SETTING, list);
}

/** Blob-download the whole library (entry/terminal-preset envelope pattern). */
export function exportPrograms() {
  const programs = getPrograms();
  const payload = { ncmProgramLibrary: 1, exportedAt: new Date().toISOString(), programs };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ncm-program-library-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  return programs.length;
}

/**
 * Import from a parsed JSON payload (envelope or bare array). Fresh ids; de-duped
 * against existing by name (case-insensitive).
 * @returns {Promise<{imported:number, skipped:number}>}
 */
export async function importPrograms(payload) {
  const incoming = Array.isArray(payload) ? payload : payload?.programs;
  if (!Array.isArray(incoming)) {
    throw new Error('Invalid format — expected a program-library export or a JSON array.');
  }
  const list = getPrograms().map((r) => ({ ...r }));
  const keyOf = (n) => String(n).toLowerCase().trim();
  const existing = new Set(list.map((r) => keyOf(r.name)));

  let imported = 0, skipped = 0;
  for (const raw of incoming) {
    const program = raw?.program;
    if (!program || typeof program !== 'object') { skipped++; continue; }
    const name = String(raw.name || program.progName || 'Imported').trim() || 'Imported';
    if (existing.has(keyOf(name))) { skipped++; continue; }
    list.push(record(name, program));
    existing.add(keyOf(name));
    imported++;
  }
  if (imported > 0) await game.settings.set(MODULE_ID, SETTING, list);
  log.info(`ProgramLibrary: imported ${imported} (${skipped} skipped)`);
  return { imported, skipped };
}
