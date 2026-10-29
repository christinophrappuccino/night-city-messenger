/**
 * Admin → Networks → This scene — the RADIO DIAL (2026-10-28, dev-approved
 * Version A of dev/mockups/admin-networks-scene-modules-mock.html).
 * @file scripts/ui/AdminPanel/tabs/networksDial.js
 * @module night-city-messenger
 *
 * Pure rules, no Foundry globals (the sim drives them directly). Each network
 * that reaches the scene is a segmented signal meter in its own colour; the
 * players on it sit on the meter as faces at the level they get; a flag marks
 * where players start; a lever turns the scene into a dead zone. NetworksTab
 * builds the rows, this decides what the meters show, and the same paint rules
 * run while a meter is dragged (DOM only — the write happens on release).
 */

/** Segments in one meter. */
export const DIAL_SEGS = 20;
/** The crowd of faces rides the level but stays inside the meter (percent of its height). */
export const CROWD_MIN = 6;
export const CROWD_MAX = 66;

const clampPct = (v) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));

/** Strong (80+) · Good (50+) · Weak (25+) · Faint (1+) · None — the app-wide thresholds. */
export function signalQuality(pct) {
  const v = Number(pct) || 0;
  return v >= 80 ? 'Strong' : v >= 50 ? 'Good' : v >= 25 ? 'Weak' : v > 0 ? 'Faint' : 'None';
}

/**
 * The meaning colour of a signal quality, for the picked readout:
 * Strong/Good = good (green) · Weak/Faint = attn (amber) · None / Jammed = bad (red).
 */
export function qualityTone(quality) {
  return { Strong: 'good', Good: 'good', Weak: 'attn', Faint: 'attn' }[quality] || 'bad';
}

/** How you get on, as a meaning: open = plain · secured = secret (violet) · Black ICE = bad (red). */
export function accessTone(cls) {
  return { sec: 'secret', ice: 'bad' }[cls] || 'plain';
}

/** How many segments a level lights (0..DIAL_SEGS). */
export function litCount(pct, segs = DIAL_SEGS) {
  return Math.round(clampPct(pct) / 100 * segs);
}

/**
 * The segments, bottom first: { b: bottom %, lit, top } — `top` marks the two
 * brightest (the meter's head).
 */
export function dialSegments(pct, segs = DIAL_SEGS) {
  const lit = litCount(pct, segs);
  return Array.from({ length: segs }, (_, i) => ({ b: +(i / segs * 100).toFixed(3), lit: i < lit, top: i < lit && i >= lit - 2 }));
}

/** Where the faces sit (bottom %), clamped inside the meter. */
export function crowdBottom(pct) {
  return Math.max(CROWD_MIN, Math.min(CROWD_MAX, clampPct(pct)));
}

/** A pointer at clientY over a meter box (getBoundingClientRect) → 0..100. */
export function pctAtPointer(clientY, rect) {
  const h = Number(rect?.height) || 1;
  return clampPct(((Number(rect?.bottom) || 0) - Number(clientY)) / h * 100);
}

/** Arrow keys: ±1 (Shift ±10); Home/End = 0/100; PageUp/PageDown ±10. null = not a meter key. */
export function stepSignal(pct, key, shift = false) {
  const s = shift ? 10 : 1;
  const d = { ArrowUp: s, ArrowRight: s, ArrowDown: -s, ArrowLeft: -s, PageUp: 10, PageDown: -10 }[key];
  if (key === 'Home') return 0;
  if (key === 'End') return 100;
  return d === undefined ? null : clampPct((Number(pct) || 0) + d);
}

/**
 * How you get on a network, in words: "Open" · "Password or Interface DV 15" ·
 * "Password and key item (Corporate ID)" · Black ICE noted.
 * @param {object} sec  — the network's security block
 * @param {(sec, skill) => number} [dcFor] — per-skill DV (bypassSkills.bypassDCFor)
 */
export function accessWords(sec = {}, dcFor = (s) => Number(s?.bypassDC) || 15) {
  if (!sec?.requiresAuth) return 'Open — anyone in range joins';
  const ways = [];
  if (sec.allowPassword || sec.password) ways.push('Password');
  if (sec.allowSkillCheck) {
    const skills = (sec.bypassSkills || []).filter(Boolean);
    ways.push(skills.length ? skills.map((k) => `${k} DV ${dcFor(sec, k)}`).join(' / ') : `a skill check DV ${Number(sec.bypassDC) || 15}`);
  }
  if (sec.allowKeyItem) ways.push(sec.keyItemName ? `key item (${sec.keyItemName})` : 'a key item');
  const joined = ways.length ? ways.join(sec.authLogic === 'all' ? ' and ' : ' or ') : 'Secured';
  return sec.failureMode === 'damage' ? `${joined} · Black ICE` : joined;
}

/**
 * The dial view-model.
 * @param {Array<{id, name, on, isGlobal, isDefault, players:Array, level:number}>} rows
 *        `level` = the network's configured signal (kept through a dead zone).
 * @param {{sel?: string|null, jam?: boolean}} o
 * @returns {{cols: Array, picked: object|null, startName: string, liveCount: number}}
 */
export function buildDial(rows, o = {}) {
  const jam = !!o.jam;
  const list = rows || [];
  const pick = list.find((r) => r.id === o.sel) || list.find((r) => r.isDefault) || list[0] || null;
  const cols = list.map((r) => {
    const level = clampPct(r.level);
    const players = r.players || [];
    const quality = jam ? 'Jammed' : signalQuality(level);
    return {
      ...r, level, sel: !!pick && r.id === pick.id,
      segs: dialSegments(level), pctLabel: jam ? '—' : String(level), pctUnit: jam ? '' : '%',
      quality, qtone: qualityTone(quality), atone: accessTone(r.access?.cls), crowdAt: crowdBottom(level),
      canStart: r.on && !jam, playerCount: players.length, nobody: !players.length,
    };
  });
  const start = list.find((r) => r.isDefault);
  return {
    cols, jam,
    picked: pick ? cols.find((c) => c.id === pick.id) : null,
    startName: start?.name || '',
    liveCount: jam ? 0 : list.filter((r) => r.on).length,
  };
}
