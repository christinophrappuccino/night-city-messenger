/**
 * contactsMapModel — the rules of Admin → Contacts → Who knows whom → MAP (pure, no Foundry globals).
 * @file scripts/ui/AdminPanel/tabs/contactsMapModel.js
 * @module night-city-messenger
 *
 * The net map (dev-approved mock dev/mockups/admin-contacts-modules-mock.html, frame 2A-cyber-grid):
 *   - characters sit on an ellipse; a contact sits between the characters who know them
 *     (known by one = just outside that character, by everyone = the middle), deterministic;
 *   - every node is snapped to a 10px grid (at most 7px — the layout still says the same thing);
 *   - a link is a circuit trace: a 45° run out of the contact, then straight into the character,
 *     every bend on a grid intersection; traces arriving on one side of a chip take adjacent grid
 *     lines, and past BUS_MAX they merge into ONE thicker bus with a count badge;
 *   - names sit on backplates placed so they cover no node, chip, plate, other name or lit trace.
 * mapView() returns everything the partial draws, as plain numbers/strings.
 */

export const MAP_W = 770;
export const MAP_H = 430;
export const PITCH = 10;
export const BUS_MAX = 6;
const CX = MAP_W / 2, CY = 212, RX = 290, RY = 156;
const PIN_INSET = 30;      // traces stop just outside the chip (the outer hex is 27)
const MIN_GAP = 40;        // contacts keep this far apart
const PC_GAP = 44;         // and this far from a character

export const snap = (v) => Math.round(v / PITCH) * PITCH;
const r1 = (v) => Math.round(v * 10) / 10;

/** Where character i of n sits on the ellipse (first one at the top). */
export function pcPos(i, n) {
  const a = (-90 + i * (360 / Math.max(1, n))) * Math.PI / 180;
  return { x: CX + Math.cos(a) * RX, y: CY + Math.sin(a) * RY };
}

/**
 * Positions for every character and every contact somebody knows.
 * @param {string[]} pcIds character actor ids, in display order
 * @param {Array<{id: string, knows: string[]}>} contacts
 * @param {{snapToGrid?: boolean}} [o]
 * @returns {Object<string, {x:number, y:number}>}
 */
export function layoutMap(pcIds, contacts, { snapToGrid = true } = {}) {
  const P = {};
  pcIds.forEach((id, i) => { P[id] = pcPos(i, pcIds.length); });
  const nodes = [], solo = {};
  contacts.filter((c) => (c.knows || []).some((k) => P[k])).forEach((c, i) => {
    const ks = c.knows.filter((k) => P[k]);
    let x, y;
    if (ks.length === 1) {
      const p = P[ks[0]], dx = p.x - CX, dy = p.y - CY, m = Math.hypot(dx, dy) || 1, ux = dx / m, uy = dy / m;
      const j = (solo[ks[0]] = (solo[ks[0]] || 0) + 1) - 1, side = j % 2 ? 1 : -1, spread = 14 + 18 * j;
      x = p.x + ux * 58 - uy * side * spread; y = p.y + uy * 58 + ux * side * spread;
    } else {
      x = ks.reduce((s, k) => s + P[k].x, 0) / ks.length; y = ks.reduce((s, k) => s + P[k].y, 0) / ks.length;
      x = CX + (x - CX) * 0.82; y = CY + (y - CY) * 0.82;
    }
    const ga = i * 2.399963; x += Math.cos(ga) * 4; y += Math.sin(ga) * 4;   // golden-angle seed: no two start on top of each other
    nodes.push({ id: c.id, x, y, x0: x, y0: y });
  });
  for (let it = 0; it < 160; it++) {
    for (let a = 0; a < nodes.length; a++) for (let b = a + 1; b < nodes.length; b++) {
      const A = nodes[a], B = nodes[b], dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy) || 0.01;
      if (d < MIN_GAP) { const f = (MIN_GAP - d) / 2 / d; A.x -= dx * f; A.y -= dy * f; B.x += dx * f; B.y += dy * f; }
    }
    for (const n of nodes) {
      for (const id of pcIds) { const q = P[id], dx = n.x - q.x, dy = n.y - q.y, d = Math.hypot(dx, dy) || 0.01; if (d < PC_GAP) { n.x += dx / d * (PC_GAP - d); n.y += dy / d * (PC_GAP - d); } }
      n.x += (n.x0 - n.x) * 0.04; n.y += (n.y0 - n.y) * 0.04;
      n.x = Math.max(16, Math.min(MAP_W - 16, n.x)); n.y = Math.max(14, Math.min(MAP_H - 14, n.y));
    }
  }
  for (const n of nodes) P[n.id] = { x: n.x, y: n.y };
  if (snapToGrid) for (const k of Object.keys(P)) P[k] = { x: snap(P[k].x), y: snap(P[k].y) };
  return P;
}

/** 45° out of the contact, then straight into the chip — on lane `off`, stopping `inset` short of it. */
export function tracePath(a, b0, off = 0, inset = PIN_INSET) {
  const horiz = Math.abs(b0.x - a.x) >= Math.abs(b0.y - a.y);
  const b = horiz ? { x: b0.x - Math.sign(b0.x - a.x) * inset, y: b0.y + off } : { x: b0.x + off, y: b0.y - Math.sign(b0.y - a.y) * inset };
  const dx = b.x - a.x, dy = b.y - a.y, d = Math.min(Math.abs(dx), Math.abs(dy));
  const m = { x: a.x + Math.sign(dx) * d, y: a.y + Math.sign(dy) * d };
  return { d: `M ${r1(a.x)} ${r1(a.y)} L ${r1(m.x)} ${r1(m.y)} L ${r1(b.x)} ${r1(b.y)}`, a, m, end: b, horiz };
}

/** Which side of character `b` a trace from `a` arrives on. */
export function sideOf(a, b) {
  return Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? (a.x < b.x ? 'w' : 'e') : (a.y < b.y ? 'n' : 's');
}

/**
 * Lanes: traces arriving on one side of a chip take adjacent grid lines (ordered by where they come
 * from, so they never cross on the way in). More than BUS_MAX on one side → one shared lane = a bus.
 * @returns {{lanes: Object<string, number>, buses: Array<{pc, side, keys: string[]}>}}  key = `${contactId}|${pcId}`
 */
export function traceLanes(P, pcIds, contacts) {
  const lanes = {}, buses = [];
  for (const pc of pcIds) {
    const b = P[pc];
    const inc = contacts.filter((c) => P[c.id] && (c.knows || []).includes(pc)).map((c) => {
      const a = P[c.id], side = sideOf(a, b);
      return { k: `${c.id}|${pc}`, side, key: side === 'w' || side === 'e' ? a.y : a.x };
    });
    for (const side of ['w', 'e', 'n', 's']) {
      const g = inc.filter((t) => t.side === side).sort((x, y) => x.key - y.key);
      if (!g.length) continue;
      if (g.length > BUS_MAX) { g.forEach((t) => { lanes[t.k] = 0; }); buses.push({ pc, side, keys: g.map((t) => t.k) }); continue; }
      const mid = Math.floor((g.length - 1) / 2);
      g.forEach((t, i) => { lanes[t.k] = (i - mid) * PITCH; });
    }
  }
  return { lanes, buses };
}

/** The name plate beside a character chip, pushed AWAY from the middle of the map. */
export function plateBox(name, q, count) {
  const cnt = `${count} known`;
  const w = Math.round(String(name).length * 8.2 + 16 + cnt.length * 6.4 + 8), h = 20;
  const top = q.y < CY - RY + 10, above = q.y < CY;
  let x0, y0;
  if (top) { x0 = q.x + 30; y0 = q.y - h / 2; }
  else if (above) { x0 = q.x - w / 2; y0 = q.y - 30 - h; }
  else { x0 = q.x - w / 2; y0 = q.y + 30; }
  x0 = Math.max(4, Math.min(MAP_W - 4 - w, x0));
  return { x0, y0, x1: x0 + w, y1: y0 + h, w, h, cnt };
}

const boxHit = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
const inBox = (p, b) => p.x > b.x0 && p.x < b.x1 && p.y > b.y0 && p.y < b.y1;
const cross = (p, q, r, s) => {
  const o = (a, b, c) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  return o(p, q, r) !== o(p, q, s) && o(r, s, p) !== o(r, s, q);
};
/** Does segment [p, q] touch box b? */
export function segHitsBox(p, q, b) {
  if (inBox(p, b) || inBox(q, b)) return true;
  const c = [{ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x1, y: b.y1 }, { x: b.x0, y: b.y1 }];
  return [0, 1, 2, 3].some((i) => cross(p, q, c[i], c[(i + 1) % 4]));
}

/**
 * Name backplates. Each label tries right/left/above/below at growing offsets and takes the first
 * box that hits no obstacle and no lit trace; then the first that hits no obstacle; then a fallback.
 * A label that ends up away from its node gets a leader line.
 * @param {Array<{id, name, x, y, r}>} items
 * @param {Array<{x0,y0,x1,y1}>} obstacles chips, plates, nodes
 * @param {Array<[{x,y},{x,y}]>} segs lit trace segments
 */
export function placeLabels(items, obstacles, segs = [], W = MAP_W, H = MAP_H) {
  const obs = [...obstacles, ...items.map((t) => ({ x0: t.x - t.r, y0: t.y - t.r, x1: t.x + t.r, y1: t.y + t.r }))];
  const out = [];
  for (const t of [...items].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const r = t.r + 5, w = Math.round(String(t.name).length * 6.4 + 12), h = 17, pref = t.x < W / 2 + 30 ? ['r', 'l'] : ['l', 'r'];
    const tries = [...pref.map((s) => [s, 0]), ...pref.flatMap((s) => [[s, -14], [s, 14]]), ['c', -r - 10], ['c', r + 10],
      ...pref.flatMap((s) => [[s, -26], [s, 26], [s, -38], [s, 38]]), ['c', -r - 26], ['c', r + 26], ...pref.flatMap((s) => [[s, -50], [s, 50], [s, -62], [s, 62]]),
      ['c', -r - 42], ['c', r + 42], ...pref.flatMap((s) => [[s + s, 0], [s + s, -14], [s + s, 14], [s + s, -28], [s + s, 28]])];
    const box = ([s, dy]) => {
      const x0 = s === 'r' ? t.x + r : s === 'l' ? t.x - r - w : s === 'rr' ? t.x + r + 36 : s === 'll' ? t.x - r - 36 - w : Math.max(4, Math.min(W - 4 - w, t.x - w / 2)), y0 = t.y + dy - h / 2;
      return { x0, y0, x1: x0 + w, y1: y0 + h };
    };
    const inside = (b) => b.x0 >= 3 && b.x1 <= W - 3 && b.y0 >= 3 && b.y1 <= H - 3;
    const clearOf = (b) => !obs.some((o) => boxHit(b, o));
    const offTraces = (b) => !segs.some(([p, q]) => segHitsBox(p, q, b));
    const cands = tries.map(box).filter(inside);
    let pick = cands.find((b) => clearOf(b) && offTraces(b)) || cands.find(clearOf);
    if (!pick) {   // crowded: the spot that covers the fewest things (names first, then nodes, then traces)
      const cost = (b) => obs.reduce((n, o) => n + (boxHit(b, o) ? (o.weight || 10) : 0), 0) + segs.reduce((n, [p, q]) => n + (segHitsBox(p, q, b) ? 1 : 0), 0);
      pick = cands.sort((x, y) => cost(x) - cost(y))[0];
    }
    if (!pick) { const x0 = t.x < W / 2 ? t.x + r : t.x - r - w; pick = { x0, y0: t.y - h / 2, x1: x0 + w, y1: t.y + h / 2 }; }
    obs.push(pick);
    const cy = (pick.y0 + pick.y1) / 2;
    const ex = pick.x1 < t.x ? pick.x1 : pick.x0 > t.x ? pick.x0 : t.x;
    const ey = Math.abs(cy - t.y) < 3 ? cy : (cy < t.y ? pick.y1 : pick.y0);
    const lead = Math.hypot(ex - t.x, ey - t.y) > t.r + 7 ? { x1: r1(t.x), y1: r1(t.y), x2: r1(ex), y2: r1(ey) } : null;
    out.push({ id: t.id, name: t.name, x: r1(pick.x0), y: r1(pick.y0), w, h, tx: r1(pick.x0 + 6), ty: r1(pick.y0 + 12.5), lead, box: pick });
  }
  return out;
}

const hexPts = (r) => [0, 1, 2, 3, 4, 5].map((k) => { const a = (k * 60 - 90) * Math.PI / 180; return `${r1(Math.cos(a) * r)},${r1(Math.sin(a) * r)}`; }).join(' ');
export const nodeSize = (n) => 5 + n * 0.9;

/**
 * Everything the partial draws.
 * @param {object} o
 * @param {Array<{id, name, initials}>} o.pcs
 * @param {Array<{id, name, hue, knows: string[], tip?}>} o.contacts  (contacts nobody knows are left off the map)
 * @param {string|null} o.sel     a picked character or contact id
 * @param {string[]|null} o.hi    highlighted contact ids (a highlight chip), or null
 * @param {string[]} [o.framed]   contact ids that get the dashed group frame
 */
export function mapView({ pcs = [], contacts = [], sel = null, hi = null, framed = [] }) {
  const pcIds = pcs.map((p) => p.id);
  const on = contacts.filter((c) => (c.knows || []).some((k) => pcIds.includes(k)));
  const P = layoutMap(pcIds, on);
  const { lanes, buses } = traceLanes(P, pcIds, on);
  const isPc = !!sel && pcIds.includes(sel), fc = !isPc && sel ? on.find((c) => c.id === sel) : null;
  const hiSet = hi ? new Set(hi) : null, frameSet = new Set(framed);
  const lit = (c) => (isPc ? c.knows.includes(sel) : fc ? c.id === fc.id : hiSet ? hiSet.has(c.id) : true);
  const busOf = new Map(); buses.forEach((b, i) => b.keys.forEach((k) => busOf.set(k, i)));

  const traces = [], vias = [], pins = [], segs = [], busGeo = buses.map(() => ({ far: null, end: null, horiz: true, hot: false, part: false }));
  for (const c of on) for (const pc of c.knows) {
    if (!P[pc]) continue;
    const k = `${c.id}|${pc}`, t = tracePath(P[c.id], P[pc], lanes[k] || 0);
    const hot = (isPc && pc === sel) || (fc && fc.id === c.id), dim = sel ? !hot : (hiSet ? !hiSet.has(c.id) : false);
    traces.push({ k, d: t.d, cls: hot ? 'is-hot' : dim ? 'is-dim' : '', contact: c.id, pc });
    if (hot) { vias.push({ x: r1(t.m.x), y: r1(t.m.y), rx: r1(t.m.x - 2.5), ry: r1(t.m.y - 2.5) }); segs.push([t.a, t.m], [t.m, t.end]); }
    const bi = busOf.get(k);
    if (bi != null) {
      const g = busGeo[bi], dist = Math.hypot(t.m.x - t.end.x, t.m.y - t.end.y);
      g.end = t.end; g.horiz = t.horiz;
      if (!g.far || dist > g.farDist) { g.far = t.m; g.farDist = dist; }
      if (hot) g.hot = true;
      if (fc && fc.id === c.id) g.part = true;
    } else if (hot) pins.push({ x: r1(t.end.x - 3), y: r1(t.end.y - 3) });
  }
  const busView = buses.map((b, i) => {
    const g = busGeo[i], isHot = isPc && b.pc === sel;
    const dim = sel ? !(isHot || g.part) : false;
    if (isHot && g.far) segs.push([g.far, g.end]);
    const bx = g.horiz ? g.end.x + (b.side === 'w' ? -22 : 22) - 11 : g.end.x + 8, by = g.horiz ? g.end.y - 17 : g.end.y + (b.side === 'n' ? -22 : 22) - 7;
    return { pc: b.pc, n: b.keys.length, d: `M ${r1(g.far.x)} ${r1(g.far.y)} L ${r1(g.end.x)} ${r1(g.end.y)}`,
      cls: isHot ? 'is-hot' : g.part ? 'is-part' : dim ? 'is-dim' : '', bx: r1(bx), by: r1(by), tx: r1(bx + 11), ty: r1(by + 10.5),
      px: r1(g.end.x - 4), py: r1(g.end.y - 4) };
  });

  const nodes = on.map((c) => {
    const p = P[c.id], s = nodeSize(c.knows.length), f = s + 5;
    return { id: c.id, name: c.name, tip: c.tip || c.name, hue: c.hue, x: p.x, y: p.y,
      pts: `0,${r1(-s)} ${r1(s)},0 0,${r1(s)} ${r1(-s)},0`, framePts: frameSet.has(c.id) ? `0,${r1(-f)} ${r1(f)},0 0,${r1(f)} ${r1(-f)},0` : '',
      cls: [lit(c) ? '' : 'is-dim', sel === c.id ? 'is-sel' : ''].filter(Boolean).join(' ') };
  });
  const obstacles = [];
  const chips = pcs.map((pc) => {
    const q = P[pc.id], n = on.filter((c) => c.knows.includes(pc.id)).length, pl = plateBox(pc.name, q, n);
    obstacles.push({ x0: q.x - 27, y0: q.y - 27, x1: q.x + 27, y1: q.y + 27, weight: 40 }, { ...pl, weight: 40 });   // never put a name on a chip or its plate if anything else is possible
    const chipLit = isPc ? pc.id === sel : fc ? fc.knows.includes(pc.id) : true;
    return { id: pc.id, name: pc.name, initials: pc.initials, x: r1(q.x), y: r1(q.y), hex: hexPts(21), hex2: hexPts(27),
      px: r1(pl.x0 - q.x), py: r1(pl.y0 - q.y), pw: pl.w, ph: pl.h, nx: r1(pl.x0 - q.x + 9), ny: r1(pl.y0 - q.y + 14),
      cx: r1(pl.x0 - q.x + pl.w - 7), cnt: pl.cnt, cls: [chipLit ? '' : 'is-dim', sel === pc.id ? 'is-sel' : ''].filter(Boolean).join(' ') };
  });
  const labeled = on.filter((c) => (isPc && c.knows.includes(sel)) || (fc && fc.id === c.id) || (!sel && hiSet && hiSet.has(c.id)));
  const labels = placeLabels(labeled.map((c) => ({ id: c.id, name: c.name, x: P[c.id].x, y: P[c.id].y, r: nodeSize(c.knows.length) + 2 })), obstacles, segs)
    .map((l) => ({ ...l, hot: fc && fc.id === l.id }));

  return { w: MAP_W, h: MAP_H, traces, vias, pins, buses: busView, nodes, chips, labels,
    idle: !sel && !hiSet, focus: isPc ? 'pc' : fc ? 'contact' : '' };
}
