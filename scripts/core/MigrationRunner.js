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
import { log, isGM, isPrimaryGM } from '../utils/helpers.js';
import { tameCrtDeep } from '../utils/crt.js';
import { shiftInterfaceDvs, shiftJackRules, refreshJackDials } from '../utils/interfaceDvShift.js';
import { adminWait } from '../utils/adminTheme.js';
import { creditOldScheduled } from '../services/SchedulingService.js';

/** The schema version this build of the module writes. */
export const DATA_SCHEMA_VERSION = 5;

/**
 * Everything saved in this world that can hold an Interface DV.
 * @returns {Array<{key:string, read:()=>*, write:(v:*)=>Promise, doc?:object}>} write is only called when something moved
 */
function interfaceDvTargets() {
  const out = [];
  const items = [...(game.items ?? [])];
  for (const a of game.actors ?? []) items.push(...(a.items ?? []));
  for (const item of items) {
    for (const flag of ['terminalConfig', 'config']) {
      if (!item.getFlag?.(MODULE_ID, flag)) continue;
      out.push({ key: `${item.uuid}#${flag}`, doc: item, read: () => item.getFlag(MODULE_ID, flag), write: (v) => item.setFlag(MODULE_ID, flag, v) });
    }
  }
  for (const j of game.journal ?? []) {
    for (const p of j.pages ?? []) {
      if (!p.getFlag?.(MODULE_ID, 'contentData')) continue;
      out.push({ key: p.uuid, doc: p, read: () => p.getFlag(MODULE_ID, 'contentData'), write: (v) => p.update({ [`flags.${MODULE_ID}.contentData`]: v }) });
    }
  }
  for (const a of game.actors ?? []) {
    if (!a.getFlag?.(MODULE_ID, 'contacts')) continue;
    out.push({ key: `${a.uuid}#contacts`, doc: a, read: () => a.getFlag(MODULE_ID, 'contacts'), write: (v) => a.setFlag(MODULE_ID, 'contacts', v) });
  }
  for (const s of ['customNetworks', 'masterContacts', 'programLibrary', 'entryTemplates']) {
    out.push({ key: `setting:${s}`, read: () => { try { return game.settings.get(MODULE_ID, s); } catch { return null; } }, write: (v) => game.settings.set(MODULE_ID, s, v) });
  }
  return out;
}

/** The one-time question. @returns {Promise<{mode:'shift'|'keep'|'stat', by?:number}|null>} null = dismissed */
function askInterfaceShift(count) {
  const content = `<div class="ncm-ifaceup">
    <p><b>Interface now rolls Rank + 1d10</b>, the rulebook's way. It used to add TECH as well, so a typical roll is about 6 lower than before.</p>
    <p>This world has <b>${count}</b> saved DV${count === 1 ? '' : 's'} that Interface rolls against. They were set for the old roll and will feel much harder.</p>
    <label class="ncm-ifaceup__by">Lower them by <input type="number" name="by" value="6" min="1" max="15" step="1"></label>
    <p class="ncm-ifaceup__hint">No DV goes below 3. Locks that other skills can also open get a separate Interface DV, so those skills are not affected. Encrypted messages stay as they are, because they can be opened with other skills and have no separate Interface DV. Back up your world first if you are unsure.</p>
  </div>`;
  return adminWait({
    title: 'Night City Messenger — Interface rolls',
    content,
    buttons: {
      shift: { icon: '<i class="fas fa-arrow-down"></i>', label: 'Lower the DVs', callback: (html) => ({ mode: 'shift', by: Math.max(1, Math.min(15, Number(html.find('[name="by"]').val()) || 6)) }) },
      keep: { icon: '<i class="fas fa-equals"></i>', label: 'Keep the DVs', callback: () => ({ mode: 'keep' }) },
      stat: { icon: '<i class="fas fa-rotate-left"></i>', label: 'Keep the old roll', callback: () => ({ mode: 'stat' }) },
    },
    default: 'shift',
    close: () => null,
  }, { width: 460 }).catch(() => null);
}

/**
 * Ordered upgrade steps. Version 1 is the baseline (no steps — existing worlds
 * are already in shape 1); the first real entry will be `{ to: 2, ... }`.
 * @type {Array<{to: number, label: string, run: () => Promise<void>}>}
 */
const MIGRATIONS = [
  {
    // The CRT film v2 retune (2026-10-25): terminals and shards set up earlier carry their own stored
    // film at the old, stronger levels (up to 55) under the old style names. Bring every stored block —
    // on world items, items on actors, saved themes and the preset libraries — to the new levels.
    to: 2,
    label: 'CRT film: stored terminal + shard films to the v2 levels',
    run: async () => {
      let changed = 0;
      const items = [...(game.items ?? [])];
      for (const a of game.actors ?? []) items.push(...(a.items ?? []));
      for (const item of items) {
        for (const key of ['terminalConfig', 'config']) {
          const cfg = item.getFlag?.(MODULE_ID, key);
          if (!cfg || typeof cfg !== 'object') continue;
          const copy = foundry.utils.deepClone(cfg);
          if (tameCrtDeep(copy)) { await item.setFlag(MODULE_ID, key, copy); changed++; }
        }
      }
      for (const key of ['terminalThemePresets', 'terminalPresetLibrary', 'shardThemePresets', 'shardPresetLibrary']) {
        let v; try { v = game.settings.get(MODULE_ID, key); } catch { continue; }
        if (!v || typeof v !== 'object') continue;
        const copy = foundry.utils.deepClone(v);
        if (tameCrtDeep(copy)) { await game.settings.set(MODULE_ID, key, copy); changed++; }
      }
      log.info(`CRT film retune: ${changed} stored terminal/shard/library entr${changed === 1 ? 'y' : 'ies'} updated`);
    },
  },
  {
    // 2.1: Interface rolls rank + d10 by default. Ask the GM what to do with DVs set for the old roll. Dismissing the
    // question leaves the world unstamped, so it is asked again on the next load.
    to: 3,
    label: 'Interface rolls: rank + 1d10, and what to do with saved DVs',
    run: async () => {
      let jack = {};
      try { jack = foundry.utils.deepClone(game.settings.get(MODULE_ID, 'jackInRules') || {}); } catch { /* not registered */ }
      const dialsMoved = refreshJackDials(jack);
      if (dialsMoved) await game.settings.set(MODULE_ID, 'jackInRules', jack);

      // A GM who already chose stat + rank on the Security tab has said what they want.
      let mode = 'rank';
      try { mode = game.settings.get(MODULE_ID, 'roleAbilityRoll'); } catch { /* not registered */ }
      if (mode === 'stat') return;

      const targets = interfaceDvTargets();
      let count = shiftJackRules(foundry.utils.deepClone(jack), 6);
      for (const t of targets) {
        const v = t.read();
        if (v) count += shiftInterfaceDvs(foundry.utils.deepClone(v), 6);
      }
      if (!count) return;   // a new world, or one that never set an Interface DV

      const choice = await askInterfaceShift(count);
      if (!choice) throw new Error('The GM has not answered yet; asking again next load.');
      if (choice.mode === 'stat') { await game.settings.set(MODULE_ID, 'roleAbilityRoll', 'stat'); return; }
      if (choice.mode === 'keep') return;

      // A crash part way must not lower anything twice: each document remembers it has moved, and so does the setting.
      let done = {};
      try { done = foundry.utils.deepClone(game.settings.get(MODULE_ID, 'ifaceShiftDone') || {}); } catch { /* */ }
      for (const t of targets) {
        if (done[t.key]) continue;
        const v = foundry.utils.deepClone(t.read());
        if (v && shiftInterfaceDvs(v, choice.by)) await t.write(v);
        done[t.key] = true;
        await game.settings.set(MODULE_ID, 'ifaceShiftDone', done);
      }
      if (!done.jackInRules) {
        if (shiftJackRules(jack, choice.by)) await game.settings.set(MODULE_ID, 'jackInRules', jack);
        done.jackInRules = true;
        await game.settings.set(MODULE_ID, 'ifaceShiftDone', done);
      }
      log.info(`Interface DVs lowered by ${choice.by} across ${targets.length} saved records`);
    },
  },
  {
    // The phone's own number system (dev/design/PHONE-REVISION.md §18). Old numbers were flavour text, so they are wiped
    // with no conversion. Call logs and voicemail stay as history. Safe to run twice.
    to: 4,
    label: 'Phone numbers: clear old-format numbers',
    run: async () => {
      await game.settings.set(MODULE_ID, 'phoneLines', {});
      for (const a of game.actors ?? []) {
        if (a.getFlag?.(MODULE_ID, 'phone') !== undefined) await a.unsetFlag(MODULE_ID, 'phone');
        const contacts = a.getFlag?.(MODULE_ID, 'contacts');
        if (Array.isArray(contacts) && contacts.some((c) => c?.phone)) await a.setFlag(MODULE_ID, 'contacts', contacts.map((c) => (c?.phone ? { ...c, phone: '' } : c)));
      }
      const mcs = game.nightcity?.masterContactService;
      for (const c of mcs?.getAll?.() || []) if (c.phone) await mcs.updateContact(c.id, { phone: '' });
    },
  },
  {
    // Cancelling a scheduled message now refunds what it paid, which each message records. Messages already waiting have no
    // record, so give them one. Safe to run twice: an entry with a figure is left alone.
    to: 5,
    label: 'Scheduled messages: record the eddies already paid',
    run: async () => {
      const { list, changed } = creditOldScheduled(game.settings.get(MODULE_ID, 'scheduledMessages') || []);
      if (!changed) return;
      await game.settings.set(MODULE_ID, 'scheduledMessages', list);
      game.nightcity?.schedulingService?._loadScheduled?.();
      log.info(`Scheduled messages: recorded the eddies paid on ${changed}`);
    },
  },
];

/**
 * Run every migration above the world's stored schema version, then stamp the
 * current version. GM-only; safe to call on every startup (no-ops when
 * already current).
 * @returns {Promise<{ran: number, from: number, to: number}>}
 */
export async function runMigrations() {
  // One GM migrates: two GMs loading together could each run a step (v3 lowered
  // Interface DVs by twice the amount — INT-01 / DATA-09).
  if (!isPrimaryGM()) return { ran: 0, from: 0, to: 0 };

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
