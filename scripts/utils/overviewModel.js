/**
 * Admin → OVERVIEW — the pure rules. Since 2026-10-28 the tab is THE NOW LINE
 * (dev-approved Version B of dev/mockups/admin-overview-rethink-mock.html): one
 * vertical timeline — the past above a fixed NOW line, what is waiting ON it,
 * the future below — with a dock (clock, the table, quick actions, tiles).
 * This module ranks and filters the queue, merges the durable activity feed,
 * words the times, judges each player (assessPlayer) and lays the line out
 * (nowLineLayout). No Foundry globals — OverviewTab gathers, this decides;
 * the sims drive it directly.
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

/** The queue under one filter ('all' = everything; a group name, or — since the NOW LINE — one kind). */
export function filterNeeds(ranked, filter = 'all') {
  return filter && filter !== 'all' ? ranked.filter((n) => n.group === filter || n.kind === filter) : ranked;
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

// ═══════════════════════════════════════════════════════════
//  AT THE TABLE (2026-10-27, dev-approved mock dev/mockups/admin-guides-v5-mock.html
//  slot "table") — players grouped by the scene each USER is looking at, one
//  status word per player and the facts behind it.
// ═══════════════════════════════════════════════════════════

/** Below this signal a recorded network counts as weak (long mail can garble). */
export const WEAK_SIGNAL = 50;

/** The id of the "not on any scene" band (offline users, users looking at nothing). */
export const NO_SCENE = '__none__';

/** 0–4 bars, the app-wide thresholds (80 / 50 / 25 / 1). */
export function signalBars(pct) {
  const s = Number(pct) || 0;
  return s >= 80 ? 4 : s >= 50 ? 3 : s >= 25 ? 2 : s > 0 ? 1 : 0;
}

/** [{on}] × 4 for a template to paint the bars. */
export function barList(pct) {
  const n = signalBars(pct);
  return [1, 2, 3, 4].map((i) => ({ on: i <= n }));
}

/**
 * The networks that reach a scene: global ones, ones listing the scene, and the
 * scene's own availability map (by id or name). Disabled networks are left out.
 * A dead zone reaches nothing.
 * @param {Array<{id,name,signalStrength?,enabled?,availability?}>} nets
 * @param {{id: string, deadZone?: boolean, availability?: object}} scene
 */
export function sceneNetworks(nets, scene) {
  if (!scene || scene.deadZone) return [];
  const avail = scene.availability || {};
  return (nets || [])
    .filter((n) => n && n.enabled !== false)
    .filter((n) => n.availability?.global || (n.availability?.scenes || []).includes(scene.id)
      || avail[n.id] === true || (n.name && avail[n.name] === true))
    .map((n) => ({ id: n.id, name: n.name || n.id, signal: Number(n.signalStrength ?? 75) || 0 }));
}

const escT = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * One player's state → the status word, its tone, the facts behind it and the fixes.
 * Tones: 'bad' (they can't mail at all) · 'warn' (something is in the way) ·
 * 'ok' (ready) · 'off' (offline, nothing wrong). Fact tones: 'ok' | 'w' | 'b'.
 * Fix keys: 'setEmail' · 'deliver' · 'share' — the tab turns them into buttons.
 * @param {{online, playerName, address, deadZone, sceneName, network, signal, contacts, unread, held}} p
 */
export function assessPlayer(p) {
  const facts = [];
  const fixes = [];
  const online = !!p.online;
  const contacts = Number(p.contacts) || 0;
  const held = Number(p.held) || 0;
  const unread = Number(p.unread) || 0;
  const signal = Number(p.signal) || 0;
  const dead = online && !!p.deadZone;
  const onNet = online && !dead && !!p.network;
  const weak = onNet && signal < WEAK_SIGNAL;

  if (!online) facts.push({ tone: 'ok', icon: 'fa-moon', html: `<b>Offline</b> — ${escT(p.playerName || 'their player')} isn't connected.${unread ? ` ${unread} unread will be waiting.` : ''}` });
  if (!p.address) {
    facts.push({ tone: 'b', icon: 'fa-at', html: '<b>No address</b> — they can\'t send or receive. The Agent asks them to pick one the first time it opens.' });
    fixes.push('setEmail');
  } else {
    facts.push({ tone: 'ok', icon: 'fa-at', html: `Address <span class="ncm-addr">${escT(p.address)}</span>` });
  }
  if (dead) facts.push({ tone: 'b', icon: 'fa-tower-broadcast', html: `<b>No signal</b> — ${escT(p.sceneName || 'this scene')} is a dead zone. Mail they write waits on their Agent.` });
  else if (onNet) facts.push({ tone: weak ? 'w' : 'ok', icon: 'fa-wifi', html: `On <b>${escT(p.network)}</b> at ${signal}%${weak ? ' — long messages can arrive garbled' : ''}` });
  else if (online) facts.push({ tone: 'ok', icon: 'fa-wifi', html: 'Network not reported yet — it shows once their Agent connects.' });
  if (held) {
    facts.push({ tone: 'w', icon: 'fa-hourglass-half', html: `<b>${held} message${held === 1 ? '' : 's'} held</b> on their Agent — waiting for signal or a GM.` });
    fixes.push('deliver');
  }
  if (!contacts) {
    facts.push({ tone: 'w', icon: 'fa-address-book', html: '<b>No contacts</b> — nobody to pick when they write. Share a fixer or the crew.' });
    fixes.push('share');
  } else {
    facts.push({ tone: 'ok', icon: 'fa-address-book', html: `${contacts} contact${contacts === 1 ? '' : 's'}` });
  }
  if (unread && online) facts.push({ tone: 'ok', icon: 'fa-envelope', html: `${unread} unread waiting for them` });

  const tone = facts.some((f) => f.tone === 'b') ? 'bad' : facts.some((f) => f.tone === 'w') ? 'warn' : online ? 'ok' : 'off';
  const status = tone === 'bad' ? (!p.address ? 'can\'t mail' : 'no signal')
    : tone === 'warn' ? (held ? 'mail held' : !contacts ? 'no contacts' : 'weak signal')
    : tone === 'ok' ? 'ready' : 'offline';
  return { tone, status, facts, fixes, dead, onNet, weak, needsYou: tone === 'bad' || tone === 'warn' };
}

/**
 * Group players by the scene their user is looking at. `players[].sceneId` is
 * null/'' for offline users and users on no scene → the NO_SCENE band, always
 * last. The GM's own scene leads; the rest by name. Scenes with no players are
 * dropped.
 * @param {Array<{sceneId?: string}>} players
 * @param {Array<{id, name}>} scenes   — every scene a player might be on
 * @param {string} [gmSceneId]
 */
export function groupByScene(players, scenes, gmSceneId = '') {
  const byId = new Map((scenes || []).map((s) => [s.id, s]));
  const bands = new Map();
  for (const p of players || []) {
    const id = p.sceneId && byId.has(p.sceneId) ? p.sceneId : NO_SCENE;
    if (!bands.has(id)) bands.set(id, { ...(id === NO_SCENE ? { id: NO_SCENE, name: 'Not on any scene', idle: true } : byId.get(id)), you: id === gmSceneId && id !== NO_SCENE, players: [] });
    bands.get(id).players.push(p);
  }
  return [...bands.values()].sort((a, b) => (!!a.idle - !!b.idle) || (!!b.you - !!a.you) || String(a.name).localeCompare(String(b.name)));
}

/** The header line: "N online · M need you" — or all ready. */
export function tableSummary(players) {
  const list = players || [];
  return {
    online: list.filter((p) => p.online).length,
    need: list.filter((p) => p.needsYou).length,
  };
}



// ═══════════════════════════════════════════════════════════
//  THE NOW LINE (2026-10-28, dev-approved Version B of
//  dev/mockups/admin-overview-rethink-mock.html). ONE vertical timeline owns the
//  tab: the past ABOVE a fixed NOW line (what just happened, newest nearest the
//  line, older ones fading, on a log scale), what is waiting ON the line (the
//  needs-you queue folded into lit chips by kind), and the future BELOW it
//  (every timer placed by time-to-go, zoom 1h / 6h / 24h, the first 10 min red
//  and the first hour amber). Everything here is pure; OverviewTab gathers.
// ═══════════════════════════════════════════════════════════

/** Where the NOW line sits (% of the track from the top). */
export const NOW_PCT = 38;
/** The past zone reaches back this far (game minutes) on a log scale… */
export const PAST_SPAN_MIN = 1440;
/** …with this knee (minutes): the first minutes get the most room. */
export const PAST_LOG_K = 5;
/** Default track height (px) and row height (px) — the push-apart gap is their ratio. */
export const NL_TRACK_PX = 600;
export const NL_ROW_PX = 30;

/** Timer kinds (the future rows). `tc` is the kind's category colour. */
export const TIMER_KINDS = Object.freeze({
  mail:     { label: 'Scheduled mail', short: 'Mail',     icon: 'fa-paper-plane',    tc: 'var(--ncm-hue-3)' },
  trace:    { label: 'Traces',         short: 'Trace',    icon: 'fa-satellite-dish', tc: 'var(--ncm-hue-1)' },
  destruct: { label: 'Self-destruct',  short: 'Destruct', icon: 'fa-hourglass-half', tc: 'var(--ncm-hue-6)' },
  backdoor: { label: 'Backdoors',      short: 'Backdoor', icon: 'fa-door-open',      tc: 'var(--ncm-secret)' },
  lockout:  { label: 'Lockouts',       short: 'Lockout',  icon: 'fa-lock',           tc: 'var(--ncm-hue-7)' },
});
export const TIMER_ORDER = Object.freeze(['mail', 'trace', 'destruct', 'backdoor', 'lockout']);

/** The three zooms, in minutes. */
export const RUNWAY_ZOOMS = Object.freeze([{ min: 60, label: '1h' }, { min: 360, label: '6h' }, { min: 1440, label: '24h' }]);
/** Under this many minutes a timer is red; under URGENT_ATTN amber. */
export const URGENT_BAD = 10;
export const URGENT_ATTN = 60;

/**
 * The needs-you queue folded into chips ON the line: one chip per need KIND
 * that is present. Tone = meaning: red for anything security / wrong, amber
 * for "waiting on you". Every NEED_KINDS key has a chip (the sim asserts it).
 */
export const NEED_CHIPS = Object.freeze({
  burned:    { label: 'Burned',         icon: 'fa-fire',                          tone: 'bad' },
  countdown: { label: 'Trace closing',  icon: 'fa-stopwatch',                     tone: 'bad' },
  imp:       { label: 'Impersonation',  icon: 'fa-user-secret',                   tone: 'bad' },
  hot:       { label: 'Running hot',    icon: 'fa-temperature-three-quarters',    tone: 'bad' },
  mail:      { label: 'Mail waiting',   icon: 'fa-envelope',                      tone: 'attn' },
  plant:     { label: 'Armed',          icon: 'fa-bomb',                          tone: 'bad' },
  bricked:   { label: 'Bricked',        icon: 'fa-heart-crack',                   tone: 'attn' },
  sched:     { label: 'Scheduled due',  icon: 'fa-clock',                         tone: 'attn' },
  setup:     { label: 'No address',     icon: 'fa-at',                            tone: 'attn' },
  deadzone:  { label: 'Dead zone',      icon: 'fa-ban',                           tone: 'bad' },
});

/**
 * Chips for a RANKED queue: kinds in rank order (first appearance), each with
 * its count; `on` marks the open one. Unknown kinds never make a chip.
 * @param {Array<{kind}>} ranked  — rankNeeds output
 * @param {string|null} [open]    — the kind whose list is expanded
 */
export function needChips(ranked, open = null) {
  const out = [];
  for (const n of ranked || []) {
    const c = NEED_CHIPS[n.kind];
    if (!c) continue;
    let chip = out.find((x) => x.kind === n.kind);
    if (!chip) { chip = { kind: n.kind, label: c.label, icon: c.icon, tone: c.tone, count: 0, on: n.kind === open }; out.push(chip); }
    chip.count++;
  }
  return out;
}

/** Activity row kind → the tone it wears on the line (ONE meaning per colour). */
export const ACTIVITY_TONES = Object.freeze({
  trace: 'var(--ncm-bad)',      // a failed roll
  hack:  'var(--ncm-good)',     // a roll that worked
  shard: 'var(--ncm-hue-2)',    // shard work
  mail:  'var(--ncm-attn)',     // mail landed
  imp:   'var(--ncm-secret)',   // sent as someone else
  other: 'var(--ncm-act)',      // a session event (joined a network, added a contact…)
});
export function activityTone(kind) { return ACTIVITY_TONES[kind] || ACTIVITY_TONES.other; }

/** 'bad' (< 10 min) · 'attn' (< 1 h) · '' */
export function timerUrgency(leftMin) {
  const l = Number(leftMin) || 0;
  return l < URGENT_BAD ? 'bad' : l < URGENT_ATTN ? 'attn' : '';
}

/** "3m" · "2h 05m" · "5h" · "2d 4h" — how long until, in game minutes. */
export function leftLabel(min) {
  const m = Math.max(0, Math.round(Number(min) || 0));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60), r = m % 60;
  if (h < 48) return r ? `${h}h ${String(r).padStart(2, '0')}m` : `${h}h`;
  const d = Math.floor(h / 24), hh = h % 24;
  return hh ? `${d}d ${hh}h` : `${d}d`;
}

const pad2 = (n) => String(n).padStart(2, '0');
/** HH:MM on the UTC game clock (the default axis/when formatter). */
export function clockLabel(ms) { const d = new Date(ms); return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`; }

/** The zoom that would show more (60 → 360 → 1440), or 0 at the widest. */
export function widerZoom(zoom) {
  const i = RUNWAY_ZOOMS.findIndex((z) => z.min === zoom);
  return i >= 0 && i < RUNWAY_ZOOMS.length - 1 ? RUNWAY_ZOOMS[i + 1].min : 0;
}

/** The future ticks for a zoom: "now HH:MM" at 0, then every 15 min / 1 h / 4 h (pct of the zoom). */
export function runwayAxis(zoom, now, clock = clockLabel) {
  const step = zoom <= 60 ? 15 : zoom <= 360 ? 60 : 240;
  const out = [{ pct: 0, label: `now ${clock(now)}`, isNow: true }];
  for (let m = step; m < zoom; m += step) out.push({ pct: +(m / zoom * 100).toFixed(3), label: zoom <= 60 ? `+${m}m` : clock(now + m * 60000), isNow: false });
  return { step, ticks: out, gridPct: +(step / zoom * 100).toFixed(3) };
}

/** Where "N minutes ago" sits on the track (% from the top): 0 = a day ago, NOW_PCT = now. Log scale. */
export function pastPct(agoMin) {
  const a = Math.max(0, Number(agoMin) || 0);
  const f = Math.log1p(a / PAST_LOG_K) / Math.log1p(PAST_SPAN_MIN / PAST_LOG_K);
  return +(NOW_PCT * (1 - Math.min(1, f))).toFixed(3);
}

/** Where "N minutes from now" sits at a zoom (% from the top): NOW_PCT = now, 100 = the zoom's edge. Linear. */
export function futurePct(leftMin, zoom) {
  const l = Math.max(0, Number(leftMin) || 0);
  return +(NOW_PCT + Math.min(1, l / (Number(zoom) || 60)) * (100 - NOW_PCT)).toFixed(3);
}

/** The gutter ticks: the past (-24h … -15m, log scale), NOW, and the future (runwayAxis mapped below the line). */
export function nowLineAxis(zoom, now, clock = clockLabel) {
  const past = [[1440, '−24h'], [360, '−6h'], [60, '−1h'], [15, '−15m']].map(([m, label]) => ({ pct: Math.max(2.5, pastPct(m)), label, isNow: false, past: true }));
  const fut = runwayAxis(zoom, now, clock).ticks.slice(1).map((t) => ({ pct: +(NOW_PCT + t.pct / 100 * (100 - NOW_PCT)).toFixed(3), label: t.label, isNow: false, past: false }));
  return [...past, { pct: NOW_PCT, label: 'NOW', isNow: true, past: false }, ...fut];
}

/**
 * Push rows apart so none overlaps: `rows` sorted from the line outward
 * ([0] nearest the line), each with an ideal `top`. The first row may sit no
 * closer than `gap` to the line; each next one no closer than `gap` to the
 * previous. Rows pushed past the zone's edge are dropped (counted in `dropped`).
 * @param {Array<{top:number}>} rows
 * @param {{gap:number, line:number, edge:number, dir:1|-1}} o   dir 1 = downward (future), -1 = upward (past)
 */
export function spreadRows(rows, { gap, line, edge, dir }) {
  const out = [];
  let dropped = 0;
  let prev = line;   // the line itself occupies the first slot
  for (const r of rows) {
    const bound = prev + dir * gap;
    const top = dir > 0 ? Math.max(r.top, bound) : Math.min(r.top, bound);
    if ((dir > 0 && top > edge) || (dir < 0 && top < edge)) { dropped++; continue; }
    out.push({ ...r, top: +top.toFixed(3) });
    prev = top;
  }
  return { rows: out, dropped };
}

/**
 * Build the NOW LINE view-model.
 * @param {object} o
 * @param {Array<{kind, ts, html, icon, subline?, ago?}>} o.activity   — merged activity rows (mergeActivity output)
 * @param {Array} o.needs           — rankNeeds output (with dismissKey/actions already shaped by the tab)
 * @param {Array<{id, kind, name, subline?, at:number, lines?, actions?}>} o.timers   — every timer, `at` on the game clock
 * @param {number} o.nowMs          — the game clock
 * @param {number} [o.zoom]         — 60 | 360 | 1440
 * @param {string|null} [o.open]    — the need kind whose list is expanded ('all' / null = none)
 * @param {string|null} [o.sel]     — the future row whose facts are open
 * @param {Set<string>|string[]} [o.off]   — timer kinds hidden from the line
 * @param {number} [o.trackPx]      — the track's height, for the push-apart gap
 * @param {(ms:number)=>string} [o.clock]  — HH:MM formatter
 */
export function nowLineLayout(o = {}) {
  const now = Number(o.nowMs) || 0;
  const zoom = RUNWAY_ZOOMS.some((z) => z.min === o.zoom) ? o.zoom : 60;
  const off = new Set(o.off || []);
  const clock = o.clock || clockLabel;
  const gap = +(NL_ROW_PX / (Number(o.trackPx) || NL_TRACK_PX) * 100).toFixed(3);
  const half = gap / 2;

  // ── the past: newest nearest the line, pushed apart upward, older ones fade ──
  const pastIdeal = (o.activity || []).filter((r) => r && Number.isFinite(Number(r.ts)))
    .map((r) => { const agoMin = Math.max(0, (now - Number(r.ts)) / 60000); return { ...r, agoMin, top: pastPct(agoMin), tc: activityTone(r.kind), far: agoMin > 60, ago: r.ago || agoLabel(Number(r.ts), now) }; })
    .sort((a, b) => a.agoMin - b.agoMin);
  // The first row on either side sits 1.5 gaps off the line (the chips ON the line need the room,
  // two rows of them at a busy table); the outer edge keeps one gap for the "+N earlier / later" chip.
  const pastRes = spreadRows(pastIdeal, { gap, line: NOW_PCT - half, edge: gap, dir: -1 });

  // ── on the line: the queue as chips; the open kind's items under it ──
  const needs = o.needs || [];
  const open = o.open && o.open !== 'all' && needs.some((n) => n.kind === o.open) ? o.open : null;
  const chips = needChips(needs, open);
  const openChip = open ? chips.find((c) => c.kind === open) : null;

  // ── the future: every timer by time-to-go, pushed apart downward ──
  const live = (o.timers || [])
    .filter((t) => t && TIMER_KINDS[t.kind] && Number(t.at) > now)
    .map((t) => {
      const left = (Number(t.at) - now) / 60000;
      const urg = timerUrgency(left);
      const k = TIMER_KINDS[t.kind];
      return {
        ...t, left, leftLabel: leftLabel(left), urg, icon: k.icon, tc: k.tc, kindShort: k.short,
        mc: urg === 'bad' ? 'var(--ncm-bad)' : urg === 'attn' ? 'var(--ncm-attn)' : k.tc,
        sel: !!o.sel && t.id === o.sel, top: futurePct(left, zoom),
        lines: (t.lines || []).filter((l) => l && l.v !== undefined && l.v !== null && l.v !== ''),
        actions: (t.actions || []).map((a) => ({ ...a, dataAttrs: Object.entries(a.data || {}).map(([k2, v]) => ({ k: k2, v })) })),
      };
    })
    .sort((a, b) => a.at - b.at || String(a.id).localeCompare(String(b.id)));
  const shown = live.filter((t) => !off.has(t.kind));
  const inView = shown.filter((t) => t.left <= zoom);
  const futRes = spreadRows(inView, { gap, line: NOW_PCT + half, edge: 100 - gap, dir: 1 });
  const beyond = shown.length - inView.length;
  const later = beyond + futRes.dropped;

  const legend = TIMER_ORDER.map((kind) => ({ kind, label: TIMER_KINDS[kind].label, short: TIMER_KINDS[kind].short, icon: TIMER_KINDS[kind].icon, tc: TIMER_KINDS[kind].tc, count: live.filter((t) => t.kind === kind).length, off: off.has(kind) }));

  return {
    now, nowPct: NOW_PCT, nowClock: clock(now), zoom, gap,
    zooms: RUNWAY_ZOOMS.map((z) => ({ min: z.min, label: z.label, on: z.min === zoom })),
    axis: nowLineAxis(zoom, now, clock),
    past: pastRes.rows, pastMore: pastRes.dropped + Math.max(0, (o.activity || []).length - pastIdeal.length),
    chips, open, openTop: +(NOW_PCT + gap).toFixed(3), openLabel: openChip ? openChip.label : '', openTone: openChip ? openChip.tone : '', openItems: open ? needs.filter((n) => n.kind === open) : [], needTotal: needs.length,
    future: futRes.rows, later, laterZoom: beyond ? widerZoom(zoom) : 0,
    zoneBad: +(Math.min(1, URGENT_BAD / zoom) * (100 - NOW_PCT)).toFixed(3),
    zoneAttn: zoom > URGENT_ATTN ? +(Math.min(1, URGENT_ATTN / zoom) * (100 - NOW_PCT)).toFixed(3) : 0,
    legend,
    counts: { bad: live.filter((t) => t.urg === 'bad').length, attn: live.filter((t) => t.urg === 'attn').length, total: live.length, past: pastIdeal.length },
    empty: !live.length && !pastIdeal.length && !needs.length,
  };
}
