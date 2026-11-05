/**
 * GM logs in a GM-only journal (stage 2, step 13).
 * @file scripts/data/gmLogStore.js
 * @module night-city-messenger
 *
 * The trace log and the network access log used to be world settings. A world setting is sent WHOLE to every
 * connected client each time it is written, and loaded by every client at login, so two logs that only the GM ever
 * reads cost every player bandwidth on every trace (measured: ~100 KB and ~170 KB at their caps). Each log is now one
 * page of a hidden journal, "NCM — GM logs", that only GMs can see (ownership NONE): its rows are a flag on the page,
 * a write reaches GM clients only, and players never download it. Same idea as the recycle bin (audit D5).
 *
 * Until the v7 migration runs, a log with no page still reads its old world setting, so nothing goes missing in the
 * meantime. Writes are GM-only and one at a time per log (serialize).
 */

import { MODULE_ID } from '../utils/constants.js';
import { log, isGM } from '../utils/helpers.js';
import { serialize } from '../utils/serialize.js';

export const GM_LOG_FLAG = 'gmLogs';                 // on the journal
export const GM_LOG_PAGE_FLAG = 'gmLog';             // on each page: which log it holds
export const GM_LOG_JOURNAL_NAME = 'NCM — GM logs';
/** log name → the world setting it used to live in (read until the v7 migration empties it). */
export const GM_LOGS = Object.freeze({ traceLog: 'traceLog', networkAccessLog: 'networkAccessLog' });

/** The GM-logs journal, if there is one (only GMs can see it). */
export function gmLogJournal() {
  return (game.journal?.contents || [...(game.journal ?? [])]).find((j) => j.getFlag?.(MODULE_ID, GM_LOG_FLAG)) || null;
}

/** The page holding one log, if there is one. */
export function gmLogPage(name) {
  const j = gmLogJournal();
  return (j?.pages?.contents || [...(j?.pages ?? [])]).find((p) => p.getFlag?.(MODULE_ID, GM_LOG_PAGE_FLAG) === name) || null;
}

/**
 * A log's rows, oldest first (a copy; change it and write it back with writeGmLog). A player gets [] — the journal is
 * not theirs. With no page yet, the old world setting's rows.
 * @param {string} name a key of GM_LOGS
 * @returns {object[]}
 */
export function readGmLog(name) {
  const page = gmLogPage(name);
  if (page) { const rows = page.getFlag(MODULE_ID, 'rows'); return Array.isArray(rows) ? [...rows] : []; }
  try { const legacy = game.settings.get(MODULE_ID, GM_LOGS[name]); return Array.isArray(legacy) ? [...legacy] : []; } catch { return []; }
}

/** @private The journal, made on the first write (GM only). */
async function _journalOrCreate() {
  const have = gmLogJournal();
  if (have || !isGM()) return have;
  let folder = null;
  try { folder = await game.nightcity?.messageRepository?._getOrCreateRootFolder?.(); } catch { /* top level is fine */ }
  return JournalEntry.create({ name: GM_LOG_JOURNAL_NAME, ownership: { default: 0 }, folder: folder?.id || null, flags: { [MODULE_ID]: { [GM_LOG_FLAG]: true } } });
}

/** @private The log's page, made on the first write. */
async function _pageOrCreate(name) {
  const have = gmLogPage(name);
  if (have) return have;
  const j = await _journalOrCreate();
  if (!j) return null;
  const [p] = await j.createEmbeddedDocuments('JournalEntryPage', [{ name, type: 'text', text: { content: '' }, flags: { [MODULE_ID]: { [GM_LOG_PAGE_FLAG]: name, rows: [] } } }]);
  return p || gmLogPage(name);
}

/**
 * Replace a log's rows. GM only; one write at a time per log. Returns false if it could not be saved.
 * @param {string} name a key of GM_LOGS
 * @param {object[]} rows
 */
export async function writeGmLog(name, rows) {
  if (!isGM() || !GM_LOGS[name]) return false;
  try {
    const page = await _pageOrCreate(name);
    if (!page) return false;
    await page.update({ [`flags.${MODULE_ID}.rows`]: Array.isArray(rows) ? rows : [] });
    return true;
  } catch (err) { log.warn(`GM log "${name}" could not be saved: ${err.message}`); return false; }
}

/**
 * Change a log in place, one change at a time: `fn(rows) → rows`. Use this, not read + write, when two changes can
 * overlap (two traces at once). The serialize key is `gmlog:<name>`.
 */
export function updateGmLog(name, fn) {
  return serialize(`gmlog:${name}`, async () => { const next = await fn(readGmLog(name)); await writeGmLog(name, next); return next; });
}

/**
 * Move a log's old world-setting rows into its page (MigrationRunner v7). Safe to run twice: rows already on the
 * page (by id) are not added again, and the setting is emptied only once every one of its rows reads back from the
 * page. Returns how many rows moved, or -1 when the read-back did not match (the setting is then left as it was).
 */
export async function migrateGmLog(name) {
  let legacy = [];
  try { legacy = game.settings.get(MODULE_ID, GM_LOGS[name]) ?? []; } catch { return 0; }
  if (!Array.isArray(legacy) || !legacy.length) return 0;
  const idOf = (r) => r?.id ?? JSON.stringify(r);
  const onPage = gmLogPage(name) ? (gmLogPage(name).getFlag(MODULE_ID, 'rows') || []) : [];
  const have = new Set(onPage.map(idOf));
  const merged = [...legacy.filter((r) => !have.has(idOf(r))), ...onPage];
  await writeGmLog(name, merged);
  const back = new Set((gmLogPage(name)?.getFlag(MODULE_ID, 'rows') || []).map(idOf));
  if (!legacy.every((r) => back.has(idOf(r)))) return -1;
  await game.settings.set(MODULE_ID, GM_LOGS[name], []);
  return legacy.length;
}
