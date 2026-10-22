/**
 * Thread resolution — connects messages into conversations using multiple signals.
 * @file scripts/utils/threading.js
 * @module night-city-messenger
 *
 * @description
 * A single message can be linked into a conversation by several independent
 * signals, in descending order of confidence:
 *
 *   1. threadId          — the canonical group id (replies + connected forwards)
 *   2. inReplyTo         — points at the parent message's id
 *   3. references[]      — the full ancestor chain (survives forward-of-forward,
 *                          and lets a thread reconstruct even if threadId is lost)
 *   4. subject + party   — fuzzy fallback: identical normalized subject AND a
 *                          shared counterparty. Rescues forwards-to-strangers,
 *                          hand-composed same-subject mail, and legacy messages
 *                          stored before threadId existed. Toggleable.
 *
 * All signals are merged with a union-find so that any one connection is enough
 * to join two messages into the same conversation. Pure functions only — no
 * Foundry globals — so this stays trivially testable and reusable.
 */

import { memberKeys } from './participants.js';

/** Strip a trailing "-sent" so a sent copy and its received twin share one identity. */
export function baseId(id) {
  return typeof id === 'string' ? id.replace(/-sent$/, '') : id;
}

/**
 * Normalize a subject for fuzzy grouping: strip any leading run of reply/forward
 * markers (RE:, FWD:, FW:), collapse whitespace, lowercase.
 * "RE: Fwd: RE:  The Job " → "the job"
 */
export function normalizeSubject(subject) {
  if (!subject) return '';
  let s = String(subject).trim();
  let prev;
  do {
    prev = s;
    s = s.replace(/^\s*(re|fwd|fw)\s*:\s*/i, '');
  } while (s !== prev);
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * The external parties on a message, from the viewing actor's perspective.
 * If the actor sent it, the counterparties are the recipients; otherwise the
 * sender. The actor's own ids are deliberately excluded so the fuzzy fallback
 * keys on *who else* is involved, not on the actor (who is in every message).
 * @returns {Set<string>} lowercased emails / actor ids / contact ids
 */
export function counterparties(msg, viewingActorId, viewingKeys = null) {
  const set = new Set();
  const add = (v) => { if (v) set.add(String(v).toLowerCase()); };
  const mine = new Set(viewingKeys instanceof Set ? viewingKeys : (viewingKeys || []));
  if (viewingActorId) mine.add(String(viewingActorId).toLowerCase());

  // Multi-recipient mail carries the whole party (address-keyed members). Every
  // member except the viewer is a counterparty — so two group threads with the
  // same subject merge only when they really share someone OTHER than me.
  if (Array.isArray(msg.participants) && msg.participants.length) {
    for (const p of msg.participants) {
      for (const k of memberKeys(p)) if (!mine.has(k)) set.add(k);
    }
    // Legacy single fields still contribute (a group copy's own to/from).
  }
  const sentByActor = !!msg.status?.sent
    || (viewingActorId && String(msg.fromActorId) === String(viewingActorId));
  if (sentByActor) {
    for (const v of String(msg.to || '').split(',')) add(v.trim());
    if (!Array.isArray(msg.toActorId)) add(msg.toActorId);
    add(msg.toContactId);
  } else {
    add(msg.from); add(msg.fromActorId); add(msg.fromContactId);
  }
  for (const k of mine) set.delete(k);
  return set;
}

/**
 * Merge a flat message list into conversations.
 * @param {Array<Object>} messages
 * @param {Object} [opts]
 * @param {string|null} [opts.viewingActorId]
 * @param {Set<string>} [opts.viewingKeys] the viewer's address/directory id too (see participants.selfKeys)
 * @param {boolean} [opts.subjectThreading=true] enable the fuzzy subject+party fallback
 * @returns {{ groupOf: Map<string, number> }} maps each messageId → its group root index
 */
export function resolveThreads(messages, opts = {}) {
  const { viewingActorId = null, subjectThreading = true, viewingKeys = null } = opts;
  const n = messages.length;

  // ── Union-find ──
  const parent = messages.map((_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };

  // Index every message by its base id (sent twin shares the received id).
  const byBaseId = new Map();
  messages.forEach((m, i) => {
    const b = baseId(m.messageId);
    if (b && !byBaseId.has(b)) byBaseId.set(b, i);
  });

  // ── Signals 1-3: explicit links ──
  // FILES never thread (#37). A file is not a message — it has no sender and no
  // conversation, and signal 4 (subject + shared counterparty) would happily
  // merge two unrelated `dock-cam.feed` files from the same node into one
  // "conversation". Skipped here, so each file stays its own singleton group.
  const isFile = (m) => m?.envelope === 'file';
  const firstWithThread = new Map();
  for (let i = 0; i < n; i++) {
    const m = messages[i];
    if (isFile(m)) continue;

    if (m.threadId) {
      const t = baseId(m.threadId);
      if (firstWithThread.has(t)) union(i, firstWithThread.get(t));
      else firstWithThread.set(t, i);
      if (byBaseId.has(t)) union(i, byBaseId.get(t));   // threadId may name another message
    }

    if (m.inReplyTo) {
      const p = byBaseId.get(baseId(m.inReplyTo));
      if (p != null) union(i, p);
    }

    if (Array.isArray(m.references)) {
      for (const ref of m.references) {
        const r = byBaseId.get(baseId(ref));
        if (r != null) union(i, r);
      }
    }
  }

  // ── Signal 4: fuzzy fallback (subject + shared counterparty) ──
  if (subjectThreading) {
    const bySubject = new Map();
    for (let i = 0; i < n; i++) {
      if (isFile(messages[i])) continue; // files never thread (#37)
      const key = normalizeSubject(messages[i].subject);
      if (!key) continue;
      if (!bySubject.has(key)) bySubject.set(key, []);
      bySubject.get(key).push(i);
    }
    for (const group of bySubject.values()) {
      if (group.length < 2) continue;
      const parties = group.map(i => counterparties(messages[i], viewingActorId, viewingKeys));
      for (let a = 0; a < group.length; a++) {
        for (let b = a + 1; b < group.length; b++) {
          if (find(group[a]) === find(group[b])) continue;
          let overlap = false;
          for (const x of parties[a]) { if (parties[b].has(x)) { overlap = true; break; } }
          if (overlap) union(group[a], group[b]);
        }
      }
    }
  }

  const groupOf = new Map();
  for (let i = 0; i < n; i++) groupOf.set(messages[i].messageId, find(i));
  return { groupOf };
}

/**
 * All messages in the same conversation as `targetMessageId`, oldest → newest.
 * @returns {Array<Object>}
 */
export function getThreadMessages(messages, targetMessageId, opts = {}) {
  if (!targetMessageId) return [];
  const { groupOf } = resolveThreads(messages, opts);
  const root = groupOf.get(targetMessageId);
  if (root == null) return [];
  return messages
    .filter(m => groupOf.get(m.messageId) === root)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}
