/**
 * The mail revision — a number that goes up whenever anything the mail scans read changes (audit remediation D5:
 * PERF-05, PERF-06).
 * @file scripts/utils/mailRevision.js
 * @module night-city-messenger
 *
 * Admin → Messages walked every page of every journal one to three times on EVERY render, and re-rendered on every
 * mail event (a group send to N people: ~2N full walks); the GM's Switch-inbox drawer walked all mail on every viewer
 * render. Those scans now remember their result and redo it only when this number has moved.
 *
 * What moves it: any journal or journal page created / changed / deleted (mail lives there), an actor or user change
 * (names, ownership, who is a player), and the settings the scans read (directory, networks, junk senders, roles).
 * Over-invalidating is fine — a scan is only ever skipped when NOTHING it could read has changed.
 */

let rev = 0;
let wired = false;

/** The current revision. */
export function mailRevision() { return rev; }

/** Move it (tests, and anything that changes mail without a Foundry hook). */
export function bumpMailRevision() { rev += 1; }

const DOC_HOOKS = [
  'createJournalEntry', 'updateJournalEntry', 'deleteJournalEntry',
  'createJournalEntryPage', 'updateJournalEntryPage', 'deleteJournalEntryPage',
  'createActor', 'updateActor', 'deleteActor', 'updateUser',
];
const SETTING_KEYS = /\.(masterContacts|customNetworks|coreNetworkOverrides|spamJunkSenders|spamTemplates|customRoles|deliveryFailures|npcMailAnswered)$/;

/** Listen once (DocumentSyncBridge.register calls it). */
export function wireMailRevision(hooks = globalThis.Hooks) {
  if (wired || !hooks?.on) return;
  wired = true;
  for (const h of DOC_HOOKS) hooks.on(h, bumpMailRevision);
  const onSetting = (s) => { if (SETTING_KEYS.test(String(s?.key || ''))) bumpMailRevision(); };
  hooks.on('updateSetting', onSetting);
  hooks.on('createSetting', onSetting);
}

/**
 * Remember `fn()` until the revision (or `extra`, anything else the result depends on) changes.
 * @param {object} holder where the memo lives (the tab instance)
 * @param {string} slot a name for it on the holder
 * @param {*} extra compared with ===; pass a string or a reference
 * @param {() => *} fn
 */
export function memoByRevision(holder, slot, extra, fn) {
  const m = holder[slot];
  if (m && m.rev === rev && m.extra === extra) return m.value;
  const value = fn();
  holder[slot] = { rev, extra, value };
  return value;
}
