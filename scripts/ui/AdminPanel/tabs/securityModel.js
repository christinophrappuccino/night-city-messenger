/**
 * securityModel — the pure rules behind Admin → Security's two modules.
 * @file scripts/ui/AdminPanel/tabs/securityModel.js
 * @module night-city-messenger
 * @description No Foundry globals, so dev/tools/sims/test-security-modules.mjs drives it.
 *   · HEAT → thermometers (dev/mockups/admin-security-heat-modules-mock.html, version A):
 *     one gauge per operator showing their hottest object, a tick per object on the side,
 *     a red clock ring when a trace countdown is closing in on them, and a detail model
 *     for the picked operator.
 *   · ACTIVITY → the seismograph (dev/mockups/admin-security-seismograph-mock.html, version A):
 *     the trace log as a needle line over time. A failure kicks the line up and rings for a
 *     moment (damped — the "decay"), taller = more heat; a success is a tick on the rail.
 *     Slicing (who / target kind / severity / result / NET verb), counts per option, sort,
 *     per-character lanes, click-a-spike = ±4 min, drag = a range, "new since your last look".
 *   All times are game-clock milliseconds (TraceService stamps rows through the time
 *   provider). Labels use UTC getters, like every other NCM timestamp.
 */

// ═════════════════════════════ shared ═════════════════════════════

export const SEV_HEAT = { minor: 10, major: 20, hostile: 35 };
export const SEV_N = { minor: 1, major: 2, hostile: 3 };
export const SEV_LIST = [['minor', 'Minor'], ['major', 'Major'], ['hostile', 'Hostile']];
export const RESULTS = [['all', 'Both'], ['fail', 'Failed'], ['ok', 'Succeeded']];
export const TRACE_MODES = [
  ['bad', 'Combined', 'One line, failures in red'],
  ['who', 'Coloured', 'One line, each spike in its character’s colour'],
  ['lanes', 'Per character', 'A line per character, stacked'],
];
export const SORTS = [['new', 'Newest'], ['old', 'Oldest'], ['heat', 'Most heat'], ['who', 'Character'], ['tgt', 'Target']];
export const KIND_LIST = [
  ['terminal', 'Terminals', 'fa-terminal'], ['network', 'Networks', 'fa-tower-broadcast'], ['shard', 'Shards', 'fa-sd-card'],
  ['message', 'Messages', 'fa-envelope'], ['contact', 'Contacts', 'fa-user'], ['camera', 'Cameras', 'fa-video'],
  ['bank', 'Accounts', 'fa-building-columns'], ['other', 'Other', 'fa-circle-question'],
];
export const kindIcon = (k) => (KIND_LIST.find(([x]) => x === k) || KIND_LIST[KIND_LIST.length - 1])[2];
export const kindName = (k) => (KIND_LIST.find(([x]) => x === k) || KIND_LIST[KIND_LIST.length - 1])[1];

const MIN = 60000;
const pad = (n) => String(n).padStart(2, '0');
/** HH:MM on the game clock (UTC getters). */
export function clock(ms) { const d = new Date(ms); return Number.isFinite(d.getTime()) ? `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` : '--:--'; }
/** "HH:MM" today, "Mmm D HH:MM" further back. */
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function stamp(ms, nowMs) {
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return '--:--';
  if (Math.abs(nowMs - ms) < 20 * 3600000) return clock(ms);
  return `${MON[d.getUTCMonth()]} ${d.getUTCDate()} ${clock(ms)}`;
}
export function mmss(ms) { const s = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`; }
export const initials = (name) => String(name || '?').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';

// ═════════════════════════════ HEAT — thermometers ═════════════════════════════

/** The tube's bands, bottom to top: cold 0–24 · warm 25–49 · hot 50–79 · burned 80+. */
export const HEAT_BANDS = [['cold', 25], ['warm', 25], ['hot', 30], ['burned', 20]];
export const HEAT_MARKS = [25, 50, 80];
export function heatTierOf(v) { return v >= 80 ? 'burned' : v >= 50 ? 'hot' : v >= 25 ? 'warm' : 'cold'; }
const CIRC = 2 * Math.PI * 17;   // the clock ring's r=17 circumference

/**
 * A countdown's clock ring. A countdown records `startedAt` + `minutes` since 2026-10-28;
 * one stored before that has only `expiresAt`, so its whole length is a guess
 * (at least what remains, at least 30 minutes).
 */
export function countdownClock(cd, nowMs) {
  const left = Math.max(0, (Number(cd?.expiresAt) || 0) - nowMs);
  let total = Number(cd?.startedAt) ? (Number(cd.expiresAt) - Number(cd.startedAt)) : (Number(cd?.minutes) || 0) * MIN;
  if (!(total > 0)) total = Math.max(left, 30 * MIN);
  total = Math.max(total, left);
  const frac = total ? left / total : 0;
  return {
    id: cd?.id, source: String(cd?.source || '').trim() || 'A trace', objectName: cd?.objectName || '', objectId: cd?.objectId || null,
    left, total, frac, label: left <= 0 ? 'due' : mmss(left),
    circ: CIRC.toFixed(2), offset: (CIRC * (1 - frac)).toFixed(2),
  };
}

/**
 * @param {Array<{objectId, actorId, objectName, actorName, value, icon?, kindLabel?}>} rows  every heat entry above 0
 * @param {Array} countdowns  TraceService.getCountdowns()
 * @param {{nowMs:number, selActorId?:string, selObjectId?:string}} o
 */
export function thermometers(rows, countdowns, { nowMs = 0, selActorId = null, selObjectId = null } = {}) {
  const by = new Map();
  const ensure = (actorId, actorName) => {
    if (!by.has(actorId)) by.set(actorId, { actorId, actorName: actorName || 'Unknown', objects: [], cd: null });
    return by.get(actorId);
  };
  for (const r of rows || []) {
    const v = Math.max(0, Math.min(100, Math.round(Number(r.value) || 0)));
    if (v <= 0) continue;
    ensure(r.actorId, r.actorName).objects.push({ objectId: r.objectId, objectName: r.objectName, value: v, tier: heatTierOf(v), icon: r.icon || 'fa-circle-question', kindLabel: r.kindLabel || '' });
  }
  for (const c of countdowns || []) {
    if (!c?.actorId) continue;
    if ((Number(c.expiresAt) || 0) - nowMs <= -60000) continue;      // long expired: the reaper will clear it
    const g = ensure(c.actorId, c.actorName);
    const clk = countdownClock(c, nowMs);
    if (!g.cd || clk.left < g.cd.left) g.cd = clk;                  // the soonest one closing in
  }
  const gauges = [...by.values()].map((g) => {
    g.objects.sort((a, b) => b.value - a.value || String(a.objectName).localeCompare(String(b.objectName)));
    const top = g.objects[0] || null;
    const peak = top ? top.value : 0;
    return {
      actorId: g.actorId, actorName: g.actorName, initials: initials(g.actorName),
      peak, tier: heatTierOf(peak), tierLabel: peak ? heatTierOf(peak) : 'none',
      peakObjectId: top?.objectId || null, peakObjectName: top?.objectName || '',
      fillPct: peak,
      marks: g.objects.map((o) => ({ tier: o.tier, bottom: o.value, title: `${o.objectName}: ${o.value}` })),
      clock: g.cd ? { has: true, ...g.cd, title: `${g.cd.source} closing in — ${g.cd.label} left` } : { has: false },
      objects: g.objects, cd: g.cd,
      title: `${g.actorName} · peak ${peak}${top ? ` on ${top.objectName}` : ''}`,
    };
  });
  // hottest first; a trace closing in breaks ties upward
  gauges.sort((a, b) => b.peak - a.peak || (a.cd ? 0 : 1) - (b.cd ? 0 : 1) || a.actorName.localeCompare(b.actorName));

  const pick = gauges.find((g) => g.actorId === selActorId) || gauges[0] || null;
  for (const g of gauges) g.selected = !!pick && g.actorId === pick.actorId;
  let sel = null;
  if (pick) {
    const objSel = pick.objects.find((o) => o.objectId === selObjectId) || null;
    const actOn = objSel || pick.objects[0] || null;
    sel = {
      actorId: pick.actorId, actorName: pick.actorName, initials: pick.initials, peak: pick.peak, tier: pick.tier,
      objCount: pick.objects.length, objWord: pick.objects.length === 1 ? 'object' : 'objects',
      objects: pick.objects.map((o) => ({ ...o, selected: !!objSel && o.objectId === objSel.objectId })),
      objectSelected: !!objSel,
      actOn: actOn ? { objectId: actOn.objectId, objectName: actOn.objectName, value: actOn.value } : null,
      actOnLabel: objSel ? objSel.objectName : (pick.objects.length > 1 ? `${actOn?.objectName || ''} (hottest)` : (actOn?.objectName || 'nothing')),
      canEscalate: !!actOn && actOn.value >= 25,
      canAdjust: !!actOn, canClear: pick.objects.length > 0,
      clearsAll: !objSel && pick.objects.length > 1,
      cd: pick.cd,
    };
  }
  return {
    gauges, sel, any: gauges.length > 0,
    hotCount: gauges.filter((g) => g.peak >= 50).length,
    traceCount: gauges.filter((g) => g.cd && g.cd.left > 0).length,
  };
}

// ═════════════════════════════ ACTIVITY — the seismograph ═════════════════════════════

/** One TraceService row → the event shape every rule below reads. */
export function normEvent(r, i = 0) {
  const t = Date.parse(r?.ts);
  const ok = r?.outcome === 'success' || r?.success === true;
  const sev = SEV_HEAT[r?.severity] ? r.severity : 'major';
  const heat = ok ? 0 : (Number.isFinite(Number(r?.heatDelta)) && r.heatDelta != null ? Number(r.heatDelta) : SEV_HEAT[sev]);
  const kind = KIND_LIST.some(([k]) => k === r?.targetKind) ? r.targetKind : 'other';
  const whoName = r?.actorName || r?.operatorName || 'Unknown';
  return {
    id: r?.id || `ev${i}`, t: Number.isFinite(t) ? t : 0,
    who: r?.actorId || `name:${whoName.toLowerCase()}`, whoName,
    action: r?.action || 'activity', kind, target: r?.objectName || 'unknown', objectId: r?.objectId || null,
    ok, sev, verb: r?.netVerb || '', heat,
    dv: r?.dv != null ? Number(r.dv) : null,
    total: (r?.dv != null && r?.margin != null) ? Number(r.dv) + Number(r.margin) : null,
    raw: r,
  };
}

/** The slices the toolbar sets. Empty lists pass everything. */
export function sliceOK(f, e) {
  if (f?.who?.length && !f.who.includes(e.who)) return false;
  if (f?.kind?.length && !f.kind.includes(e.kind)) return false;
  if (f?.sev?.length && !f.sev.includes(e.sev)) return false;
  if (f?.verb?.length && !f.verb.includes(e.verb || 'none')) return false;
  if (f?.res === 'fail' && e.ok) return false;
  if (f?.res === 'ok' && !e.ok) return false;
  if (f?.objectId && e.objectId !== f.objectId) return false;
  return true;
}
export const slicesOn = (f) => (f?.who?.length || 0) + (f?.kind?.length || 0) + (f?.sev?.length || 0) + (f?.verb?.length || 0) + (f?.res && f.res !== 'all' ? 1 : 0) + (f?.objectId ? 1 : 0);

/** The log seg chips: all · serious (not minor) · fumbles (failed). */
export function chipOK(chip, e) {
  if (chip === 'serious') return e.sev !== 'minor';
  if (chip === 'fumbles') return !e.ok;
  return true;
}

/** Characters in a stable order: most events first, then A–Z. */
export function whoOrder(events) {
  const n = new Map();
  for (const e of events) { const c = n.get(e.who) || { who: e.who, name: e.whoName, n: 0, heat: 0 }; c.n++; c.heat += e.heat; n.set(e.who, c); }
  return [...n.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
}

export function sortEvents(list, sort = 'new', order = []) {
  const L = [...list];
  const idx = (w) => { const i = order.indexOf(w); return i < 0 ? 1e9 : i; };
  if (sort === 'old') L.sort((a, b) => a.t - b.t);
  else if (sort === 'heat') L.sort((a, b) => b.heat - a.heat || SEV_N[b.sev] - SEV_N[a.sev] || b.t - a.t);
  else if (sort === 'who') L.sort((a, b) => idx(a.who) - idx(b.who) || b.t - a.t);
  else if (sort === 'tgt') L.sort((a, b) => a.target.localeCompare(b.target) || b.t - a.t);
  else L.sort((a, b) => b.t - a.t);
  return L;
}

/** Everything the log shows: chip + search + slices + time range, sorted. */
export function filterLog(events, { f = {}, chip = 'all', q = '', range = null, sort = 'new', order = [], label = (e) => e.action } = {}) {
  const s = String(q || '').trim().toLowerCase();
  const L = events.filter((e) => {
    if (!chipOK(chip, e)) return false;
    if (!sliceOK(f, e)) return false;
    if (range && (e.t < range[0] || e.t > range[1])) return false;
    if (s && ![e.whoName, label(e), e.action, e.target, e.verb].join(' ').toLowerCase().includes(s)) return false;
    return true;
  });
  return sortEvents(L, sort, order);
}

/** How many events a picker option would show if it were the only pick of its kind. */
export function pickCount(events, f, key, value) {
  const patch = key === 'res' ? { res: value } : { [key]: [value] };
  return events.filter((e) => sliceOK({ ...f, ...patch }, e)).length;
}

/** Click a spike → that moment, ±4 minutes. */
export function spikeRange(t, nowMs = Infinity) { return [t - 4 * MIN, Math.min(nowMs, t + 4 * MIN)]; }
/** Drag → a range, ordered, clamped to now. */
export function brushRange(a, b, nowMs = Infinity) { return [Math.min(a, b), Math.min(nowMs, Math.max(a, b))]; }

export const ZOOMS = {
  hour: { span: 60 * MIN, label: 'Last hour', step: 10 * MIN },
  session: { span: 6 * 60 * MIN, label: 'Session', step: 60 * MIN },
  day: { span: 24 * 60 * MIN, label: 'Day', step: 3 * 60 * MIN },
};
export const PLOT_W = 688;
export const GUTTER = 64;
const KPX = 1.15;
const LANE_H = 46;
/** The visible window: `span` ending a sliver after now (so the pen has room). */
export function viewOf(zoom, nowMs, W = PLOT_W) {
  const z = ZOOMS[zoom] || ZOOMS.session;
  const t1 = nowMs + z.span * 0.014, t0 = t1 - z.span;
  return { t0, t1, W, x: (ms) => (ms - t0) / (t1 - t0) * W, ms: (x) => t0 + x / W * (t1 - t0) };
}

const hash = (n) => { const s = Math.sin(n * 12.9898) * 43758.5453; return s - Math.floor(s); };
/** Px above the baseline that one event puts at dx px from it: a failure kicks and rings, damped. */
export function contrib(e, dx, k) {
  if (e.ok) return dx > -2 && dx < 2 ? (2 - Math.abs(dx)) * 0.9 * Math.min(1, k) : 0;
  const amp = e.heat * KPX * k;
  if (dx < -2.5 || dx > 70) return 0;
  if (dx < 0) return amp * (dx + 2.5) / 2.5;
  return amp * Math.exp(-dx / 9) * Math.cos(dx * 0.85);
}
const r1 = (n) => Math.round(n * 10) / 10;

/** One needle line, split into runs coloured by the failure that dominates each stretch. */
export function traceLine(evs, { base, k, top, bot, seed = 0, colourFor = () => 'var(--ncm-bad)', V, nowX }) {
  const runs = []; let cur = null;
  const xs = evs.map((e) => V.x(e.t));
  const lim = Math.min(V.W, nowX);
  for (let x = 0; x <= lim; x += 1) {
    let y = (hash(x + seed) - 0.5) * 1.8 * Math.min(1, k), best = 0, who = null;
    for (let i = 0; i < evs.length; i++) {
      const dx = x - xs[i];
      if (dx < -3 || dx > 71) continue;
      const c = contrib(evs[i], dx, k); y += c;
      if (!evs[i].ok && Math.abs(c) > Math.abs(best) && Math.abs(c) > 0.9) { best = c; who = evs[i]; }
    }
    const key = who ? who.id : '_';
    const pt = [x, r1(Math.max(top, Math.min(bot, base - y)))];
    if (!cur || cur.key !== key) { cur = { key, col: who ? colourFor(who) : 'var(--ncm-text-label)', pts: cur ? [cur.pts[cur.pts.length - 1]] : [] }; runs.push(cur); }
    cur.pts.push(pt);
  }
  const peakY = (e) => {
    const ex = V.x(e.t); let mx = 0;
    for (let dx = -2; dx <= 3; dx++) { let y = 0; for (let i = 0; i < evs.length; i++) y += contrib(evs[i], ex + dx - xs[i], k); mx = Math.max(mx, y); }
    return Math.max(top, base - mx);
  };
  return {
    runs: runs.filter((r) => r.pts.length > 1).map((r) => ({ col: r.col, points: r.pts.map((p) => p.join(',')).join(' ') })),
    peakY, penY: runs.length ? runs[runs.length - 1].pts.slice(-1)[0][1] : base,
  };
}

/**
 * The whole seismograph view-model.
 * @param {object[]} events  normEvent()s (all of them)
 * @param {object} o  { f, mode:'bad'|'who'|'lanes', zoom, nowMs, lastSeen, range, sel, hueOf(event)→css, labelOf(event)→text }
 */
export function seismograph(events, o = {}) {
  const { f = {}, mode = 'bad', zoom = 'session', nowMs = 0, lastSeen = 0, range = null, sel = null } = o;
  const hueOf = o.hueOf || (() => 'var(--ncm-act)');
  const labelOf = o.labelOf || ((e) => e.action);
  const V = viewOf(zoom, nowMs);
  const nowX = r1(V.x(nowMs));
  const S = events.filter((e) => sliceOK(f, e));
  const inV = S.filter((e) => e.t >= V.t0 && e.t <= nowMs);
  const lanesMode = mode === 'lanes';
  const order = whoOrder(events);
  const laneWho = lanesMode ? order.filter((w) => !f.who?.length || f.who.includes(w.who)).filter((w) => inV.some((e) => e.who === w.who)) : [null];
  const lanes = lanesMode && !laneWho.length ? [] : laneWho;
  const PH = lanesMode ? Math.max(1, lanes.length) * LANE_H + 4 : 150;
  const byWho = lanesMode || mode === 'who';
  const colourFor = (e) => (byWho ? hueOf(e) : 'var(--ncm-bad)');
  const seedBase = zoom === 'day' ? 7 : zoom === 'hour' ? 3 : 0;
  const out = { runs: [], peaks: [], ticks: [], hgrid: [], yLabels: [], laneLabels: [], pens: [], baselines: [], rails: [], lanesep: [] };
  lanes.forEach((w, li) => {
    const evs = w ? inV.filter((e) => e.who === w.who) : inV;
    const top = lanesMode ? li * LANE_H + 2 : 0;
    const base = lanesMode ? top + 28 : 78, rail = lanesMode ? top + 39 : 136, k = lanesMode ? 0.62 : 1.7;
    const T = traceLine(evs, { base, k, top: top + 3, bot: lanesMode ? rail - 4 : rail - 12, seed: seedBase + li * 13, colourFor, V, nowX });
    out.runs.push(...T.runs);
    for (const e of evs) {
      const x = r1(V.x(e.t));
      const tip = { t: clock(e.t), who: e.whoName, what: `${labelOf(e)}${e.verb ? ` · ${e.verb}` : ''}`, tgt: e.target, ok: e.ok, heat: e.heat };
      if (!e.ok) out.peaks.push({ id: e.id, t: e.t, heat: e.heat, x, y: r1(T.peakY(e)), r: e.sev === 'hostile' ? 4 : 3.2, col: colourFor(e), on: sel === e.id, lane: li, tip });
      else { const h = lanesMode ? 3 : 6; out.ticks.push({ id: e.id, t: e.t, heat: 0, x, y1: rail - h, y2: rail + h, y: rail, col: byWho ? hueOf(e) : 'var(--ncm-good)', on: sel === e.id, lane: li, tip }); }
    }
    out.pens.push({ x: nowX, y: T.penY });
    if (lanesMode) {
      const heat = evs.reduce((s, e) => s + e.heat, 0);
      out.baselines.push({ y: base, x2: nowX });
      if (li) out.lanesep.push({ y: top - 2 });
      out.laneLabels.push({ who: w.who, name: w.name, col: hueOf({ who: w.who, whoName: w.name }), top: top + 22, heat, heatLabel: heat ? `+${heat}` : '0', zero: !heat });
    } else {
      const yl = [10, 20, 35].map((h) => r1(base - h * KPX * k));
      out.hgrid.push(...yl);
      out.baselines.push({ y: base, x2: nowX });
      out.rails.push({ y: rail, x2: nowX });
      out.yLabels.push(...[10, 20, 35].map((h, i) => ({ top: yl[i], text: `+${h}`, cap: false })), { top: base, text: 'heat', cap: true }, { top: rail, text: 'ok', cap: true });
    }
  });
  const z = ZOOMS[zoom] || ZOOMS.session;
  const vt = []; for (let m = Math.ceil(V.t0 / z.step) * z.step; m <= V.t1; m += z.step) vt.push(m);
  const vgrid = vt.map((m) => r1(V.x(m)));
  const xLabels = vt.filter((m) => Math.abs(V.x(m) - nowX) > 48 && V.x(m) > 14).map((m) => ({ left: r1(V.x(m)), text: clock(m) }));
  const lastX = lastSeen ? r1(V.x(lastSeen)) : -1;
  const newShown = inV.filter((e) => e.t > lastSeen).length;
  let mark = null;
  if (lastSeen && lastX >= 0 && lastX <= nowX) mark = { left: lastX, fit: false, text: `last look ${clock(lastSeen)}`, n: newShown };
  else if (lastX < 0 && newShown) mark = { left: 0, fit: true, text: lastSeen ? `everything here is new since your last look (${clock(lastSeen)})` : 'nothing here has been seen yet', n: null };
  let brush = null;
  if (range) {
    const a = Math.max(0, V.x(Math.min(range[0], range[1]))), b = Math.min(V.W, V.x(Math.max(range[0], range[1])));
    if (b > a) brush = { a: r1(a), w: r1(b - a), b: r1(b), rw: r1(V.W - b) };
  }
  const selE = sel ? S.find((e) => e.id === sel) : null;
  const tot = { n: inV.length, fail: inV.filter((e) => !e.ok).length, heat: inV.reduce((s, e) => s + e.heat, 0) };
  return {
    W: V.W, PH, gutter: GUTTER, t0: Math.round(V.t0), t1: Math.round(V.t1), nowMs, nowX, nowLabel: clock(nowMs),
    lanesMode, byWho, empty: !inV.length,
    ...out, vgrid, xLabels,
    newZone: lastSeen && lastX < nowX ? { x: Math.max(0, lastX), w: r1(nowX - Math.max(0, lastX)) } : null,
    lastLine: lastSeen && lastX >= 0 && lastX <= nowX ? lastX : null,
    future: nowX < V.W ? { x: nowX, w: r1(V.W - nowX) } : null,
    brush, selX: selE && selE.t >= V.t0 ? r1(V.x(selE.t)) : null, mark, tot,
    keyWho: byWho ? (lanesMode ? lanes : order.filter((w) => inV.some((e) => e.who === w.who))).map((w) => ({ name: w.name, col: hueOf({ who: w.who, whoName: w.name }) })) : [],
    zoomLabel: z.label,
  };
}

/**
 * The page of log rows with the "new since your last look" divider: on time sorts, a divider
 * before the first new row and "before your last look" where new turns old. Page 1 only says
 * the count; a later page that opens inside the new run says "continued".
 */
export function annotateLog(all, { page = 1, size = 12, sort = 'new', lastSeen = 0 } = {}) {
  const pages = Math.max(1, Math.ceil(all.length / size));
  const p = Math.min(Math.max(1, page), pages);
  const start = (p - 1) * size;
  const rows = all.slice(start, start + size);
  const timeSort = sort === 'new' || sort === 'old';
  const isNew = (e) => !!e && e.t > lastSeen;
  const nNew = all.filter(isNew).length;
  const out = rows.map((e, i) => {
    const gi = start + i, prev = all[gi - 1];
    let div = null;
    if (timeSort && nNew) {
      const flip = !prev ? isNew(e) : isNew(prev) !== isNew(e);
      if (flip && isNew(e)) div = { kind: 'new', text: `${nNew} new since your last look`, at: lastSeen ? clock(lastSeen) : '' };
      else if (flip && prev) div = { kind: 'old', text: 'before your last look' };
      else if (i === 0 && gi > 0 && isNew(e)) div = { kind: 'new', text: 'new since your last look, continued', at: '' };
    }
    return { e, isNew: isNew(e), div };
  });
  return { rows: out, page: p, pages, total: all.length, from: all.length ? start + 1 : 0, to: Math.min(all.length, start + size), hasPrev: p > 1, hasNext: p < pages, nNew, timeSort };
}

/** Severity pips: three bars, `n` lit. */
export const sevPips = (sev) => [1, 2, 3].map((n) => n <= (SEV_N[sev] || 2));
