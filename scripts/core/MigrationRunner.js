/**
 * MigrationRunner — version-keyed world-data upgrades.
 * @file scripts/core/MigrationRunner.js
 * @module night-city-messenger
 *
 * WHY THIS EXISTS: NCM stores evolving shapes in flags and world settings
 * (terminal state, shard entries, residents, program entries…). Historically
 * every breaking shape change had to either stay read-time back-compatible
 * forever or be fixed with a hand-run console snippet (the `uploadable:false`
 * legacy-program episode). This runner gives the NEXT breaking change a real
 * upgrade hook instead.
 *
 * HOW TO ADD A MIGRATION:
 *   1. Bump DATA_SCHEMA_VERSION.
 *   2. Push an entry onto MIGRATIONS: { to: <new version>, label, run }.
 *      `run` executes on the GM client only, once per world, in order.
 *      It must be idempotent (a crash mid-run means it runs again).
 *   3. Never renumber or remove shipped entries — worlds upgrade from any
 *      older version by running every entry above their stored version.
 *
 * This is separate from the two ad-hoc shape-detecting migrations that predate
 * it (MessageRepository.migrateJournalOrganization, MasterContactService
 * _migrateContacts) — those key on detecting legacy data, not on a version,
 * and stay as they are.
 */

import { MODULE_ID } from '../utils/constants.js';
import { log, isGM } from '../utils/helpers.js';

/** The schema version this build of the module writes. */
export const DATA_SCHEMA_VERSION = 1;

/**
 * Ordered upgrade steps. Version 1 is the baseline (no steps — existing worlds
 * are already in shape 1); the first real entry will be `{ to: 2, ... }`.
 * @type {Array<{to: number, label: string, run: () => Promise<void>}>}
 */
const MIGRATIONS = [];

/**
 * Run every migration above the world's stored schema version, then stamp the
 * current version. GM-only; safe to call on every startup (no-ops when
 * already current).
 * @returns {Promise<{ran: number, from: number, to: number}>}
 */
export async function runMigrations() {
  if (!isGM()) return { ran: 0, from: 0, to: 0 };

  let from = 0;
  try { from = Number(game.settings.get(MODULE_ID, 'dataSchemaVersion')) || 0; }
  catch { return { ran: 0, from: 0, to: 0 }; } // setting not registered yet

  if (from >= DATA_SCHEMA_VERSION) return { ran: 0, from, to: from };

  const pending = MIGRATIONS
    .filter(m => m.to > from && m.to <= DATA_SCHEMA_VERSION)
    .sort((a, b) => a.to - b.to);

  let ran = 0;
  for (const m of pending) {
    try {
      log.info(`Migration → v${m.to}: ${m.label}`);
      await m.run();
      // Stamp after each successful step so a later failure resumes here.
      await game.settings.set(MODULE_ID, 'dataSchemaVersion', m.to);
      ran++;
    } catch (err) {
      log.error(`Migration to v${m.to} failed (${m.label}): ${err.message} — stopping; will retry next startup.`);
      return { ran, from, to: m.to - 1 };
    }
  }

  await game.settings.set(MODULE_ID, 'dataSchemaVersion', DATA_SCHEMA_VERSION);
  if (ran > 0) log.info(`Schema migrations complete: v${from} → v${DATA_SCHEMA_VERSION}`);
  return { ran, from, to: DATA_SCHEMA_VERSION };
}
