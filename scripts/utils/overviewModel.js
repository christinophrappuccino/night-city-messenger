/**
 * Admin → OVERVIEW — the pure rules (2026-10-26 redesign, dev-approved mock
 * dev/mockups/admin-overview-redesign-mock.html).
 *
 * The tab answers two questions: "what needs me?" (one ranked, actionable
 * queue) and "what is the state of the table?". This module ranks and filters
 * the queue, merges the durable activity feed and words the times. No Foundry
 * globals — OverviewTab gathers, this decides; the sim drives it directly.
 */

/**
 * Need kinds → { weight, group }. Higher weight = higher in the list; `group`
 * is the filter chip it counts under (mail / sec / money / setup).
 */
export const NEED_KINDS = Object.freeze({
  burned:   { weight: 100, group: 'sec' },    // heat BURNED (80+)
  countdown:{ weight: 95,  group: 'sec' },    // a trace countdown is ticking
  imp:      { weight: 85,  group: 'sec' },    // someone sent mail AS someone else
  hot:      { weight: 75,  group: 'sec' },    // heat HOT (50–79)
  mail:     { weight: 70,  group: 'mail' },   // a player's mail waiting on an NPC
  plant:    { weight: 60,  group: 'sec' },    // an armed resident on a machine
  bricked:  { weight: 50,  group: 'money' },  // a shard died
  sched:    { weight: 45,  group: 'setup' },  // scheduled mail about to fire
  setup:    { weight: 30,  group: 'setup' },  // a player with no address, etc.
  deadzone: { weight: 20,  group: 'setup' },  // the current scene is a dead zone
});

export const NEED_GROUPS = Object.freeze(['mail', 'sec', 'money', 'setup']);

/**
 * Rank the queue: heavier kinds first; within a kind, more waiting (`count`)
 * then newer (`ts`). Dismissed items (by `key|sig`) are dropped — a dismissal
 * is per SIGNATURE, so the item comes back when it changes (a third unanswered
 * message, a hotter trace).
 * @param {Array<{kind: string, key: string, sig?: string, count?: number, ts?: number}>} items
 * @param {Set<string>} [dismissed]
 */
export function rankNeeds(items, dismissed = new Set()) {
  return (items || [])
    .filter((n) => n && NEED_KINDS[n.kind] && !dismissed.has(dismissKey(n)))
    .map((n) => ({ ...n, group: NEED_KINDS[n.kind].group }))
    .sort((a, b) => (NEED_KINDS[b.kind].weight + Math.min(5, b.count || 0)) - (NEED_KINDS[a.kind].weight + Math.min(5, a.count || 0))
      || (b.ts || 0) - (a.ts || 0));
}

/** The dismissal key — item key plus a signature of its current state. */
export function dismissKey(n) { return `${n.key}|${n.sig ?? ''}`; }

/** Counts per filter chip, plus 'all'. */
export function needCounts(ranked) {
  const out = { all: ranked.length };
  for (const g of NEED_GROUPS) out[g] = ranked.filter((n) => n.group === g).length;
  return out;
}

/** The queue under one filter chip ('all' = everything). */
export function filterNeeds(ranked, filter = 'all') {
  return filter && filter !== 'all' ? ranked.filter((n) => n.group === filter) : ranked;
}

/** "now" / "12m" / "3h" / "2d" — how long AGO, on the game clock. */
export function agoLabel(ts, now) {
  const d = Math.max(0, (now || 0) - (ts || 0));
  const m = Math.floor(d / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** "6m" / "14:32" (under an hour, ticking) / "22h" / "2d" — how long UNTIL. */
export function untilLabel(ts, now) {
  const d = (ts || 0) - (now || 0);
  if (d <= 0) return 'due';
  const s = Math.floor(d / 1000);
  if (s < 3600) return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  const h = Math.floor(s / 3600);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/**
 * The durable activity feed: mail rows and Security-log rows merged, newest
 * first, capped. Each row: { kind: 'mail'|'trace'|..., group: 'mail'|'hack'|'shard', ts }.
 */
export function mergeActivity(lists, limit = 30) {
  return [].concat(...(lists || [])).filter(Boolean)
    .sort((a, b) => (b.ts || 0) - (a.ts || 0))
    .slice(0, limit);
}

/** The feed under one filter chip ('all' | 'mail' | 'hack' | 'shard'). */
export function filterFeed(rows, filter = 'all') {
  return filter && filter !== 'all' ? rows.filter((r) => r.group === filter) : rows;
}
