/**
 * Composer drafts — the pure rules (2026-10-28).
 * @file scripts/utils/drafts.js
 * @module night-city-messenger
 * @description Drafts are a LIST per character: actor flag `composerDrafts`
 *   = `{ [draftId]: draft }`, capped at DRAFT_CAP (oldest pruned). The single
 *   legacy `composerDraft` flag is lifted into the list once at read time.
 *   A fresh composer NEVER restores a draft by itself (tester Cobain: "when I
 *   go to the same character that already has a draft and try to create
 *   another draft it just opens the last saved one") — a draft is opened on
 *   purpose, from the footer's "N drafts" link or the Agent's Drafts tab.
 *
 *   No Foundry globals: `readDrafts` takes the actor-like object it reads and
 *   the module id, so the sim can drive it with a mock.
 */

export const DRAFT_CAP = 20;
export const DRAFTS_FLAG = 'composerDrafts';
export const LEGACY_DRAFT_FLAG = 'composerDraft';

/** A fresh draft id (no Foundry needed — the sim calls this too). */
export function newDraftId(rand = Math.random) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = 'd';
  for (let i = 0; i < 10; i++) s += chars[Math.floor(rand() * chars.length)];
  return s;
}

/** Real-clock ms of a draft's save stamp (0 when absent/invalid). */
export function savedMs(draft) {
  const ms = Date.parse(draft?.savedAt || '');
  return Number.isFinite(ms) ? ms : 0;
}

/** Newest first. */
export function sortDrafts(drafts) {
  return [...(drafts || [])].sort((a, b) => savedMs(b) - savedMs(a));
}

/**
 * Keep the newest `cap` drafts. Returns the kept map and the ids that fell off
 * (the caller writes `-=id` for those).
 * @param {Record<string, object>} map
 * @param {number} [cap]
 */
export function pruneDrafts(map, cap = DRAFT_CAP) {
  const list = sortDrafts(Object.values(map || {}).filter(d => d && d.id));
  const kept = {};
  const dropped = [];
  list.forEach((d, i) => { if (i < cap) kept[d.id] = d; else dropped.push(d.id); });
  return { kept, dropped };
}

/**
 * Lift the legacy single draft into the list shape. Pure: takes the two flag
 * values, returns the merged map and whether anything was lifted. A legacy
 * draft older than a day is dropped rather than lifted (the old rule).
 * @param {{ composerDrafts?: Record<string, object>|null, composerDraft?: object|null }} flags
 * @param {number} [nowMs]
 */
export function liftLegacy(flags, nowMs = Date.now()) {
  const map = { ...(flags?.composerDrafts && typeof flags.composerDrafts === 'object' ? flags.composerDrafts : {}) };
  const legacy = flags?.composerDraft;
  if (!legacy || typeof legacy !== 'object') return { map, lifted: false };
  const age = nowMs - savedMs(legacy);
  if (!legacy.savedAt || age > 86400000) return { map, lifted: true, dropped: true };
  const id = legacy.id || `legacy-${savedMs(legacy)}`;
  map[id] = { ...legacy, id, mode: legacy.mode || 'compose' };
  return { map, lifted: true, dropped: false };
}

/**
 * Read a character's drafts. Lifts a legacy draft once (and persists the lift
 * when `persist` is on — the actor's setFlag/unsetFlag, both guarded).
 * @param {{ getFlag: Function, setFlag?: Function, unsetFlag?: Function }} actor
 * @param {string} moduleId
 * @param {{ persist?: boolean, nowMs?: number }} [o]
 * @returns {{ map: Record<string, object>, list: object[] }}
 */
export function readDrafts(actor, moduleId, { persist = true, nowMs = Date.now() } = {}) {
  if (!actor?.getFlag) return { map: {}, list: [] };
  const flags = { composerDrafts: actor.getFlag(moduleId, DRAFTS_FLAG), composerDraft: actor.getFlag(moduleId, LEGACY_DRAFT_FLAG) };
  const { map, lifted } = liftLegacy(flags, nowMs);
  if (lifted && persist) {
    try {
      const p = actor.unsetFlag?.(moduleId, LEGACY_DRAFT_FLAG);
      if (p?.then) p.then(() => actor.setFlag?.(moduleId, DRAFTS_FLAG, map)).catch(() => {});
    } catch { /* read-only context — the lift happens next time */ }
  }
  const list = sortDrafts(Object.values(map).filter(d => d && d.id));
  return { map, list };
}

/** The recipient a draft is for, in words. */
export function draftRecipientName(draft, resolveActorName = () => null) {
  const r = draft?.recipients?.[0];
  if (!r) return '';
  if (r.groupId && r.name) return `${r.name} (group)`;
  return r.name || (r.actorId ? resolveActorName(r.actorId) : null) || r.email || '';
}

/** Reply / Forward / '' — the tag on a draft row. */
export function draftKind(draft) {
  if (draft?.mode === 'reply') return 'reply';
  if (draft?.mode === 'forward') return 'forward';
  return '';
}

/** Strip tags for a one-line body preview. */
export function draftPlainBody(draft, max = 80) {
  const t = String(draft?.body || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Does a draft carry anything worth keeping? */
export function draftHasContent(draft) {
  if (!draft) return false;
  if ((draft.recipients || []).length) return true;
  if (String(draft.subject || '').trim()) return true;
  return draftPlainBody(draft).length > 0;
}

/**
 * "just now" / "2 min" / "1 h" / "yesterday" / "3 d" — the composer's own
 * relative formatter on the REAL clock (a draft's savedAt is wall time).
 */
export function relativeAge(ms, nowMs = Date.now()) {
  if (!ms) return '';
  const d = Math.max(0, nowMs - ms);
  const m = Math.floor(d / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h`;
  const days = Math.floor(h / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} d`;
  return `${Math.floor(days / 30)} mo`;
}

/** One line for a picker row / the Drafts tab: subject or "(no subject)". */
export function draftLabel(draft) {
  const s = String(draft?.subject || '').trim();
  return s || '(no subject)';
}
