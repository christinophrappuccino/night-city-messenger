/**
 * Admin → Access points — the pure rules (no Foundry globals; sim: dev/tools/sims/test-access-tab.mjs).
 * @file scripts/ui/AdminPanel/tabs/accessModel.js
 *
 * Inputs are plain arrays the tab gathers from the world:
 *   things — every terminal / shard (+ any inbox / message an access point names):
 *            { key, kind, name, subline, img, holder, playerHeld, found }
 *   points — every way in: { id, how: 'pin'|'hotbar'|'journal'|'chat', key, kind, sceneId?, x?, y? (0–100),
 *            reach?, where, detail, broken, docUuid }
 *   scenes — { id, name, folderKey, folderPath, thumb, aspect, viewed, navOrder }
 * One `state` object: { view: 'map'|'thing', q, show, group, sort, stat, scene, thing, shut:Set }.
 * Dev-approved mock: dev/mockups/access-points-v2-mock.html (2026-10-29).
 */

export const ACCESS_HOW = Object.freeze({
  pin: { icon: 'fa-map-pin', label: 'Map pin' },
  area: { icon: 'fa-draw-polygon', label: 'Step-on area' },
  hotbar: { icon: 'fa-bolt', label: 'Hotbar macro' },
  journal: { icon: 'fa-link', label: 'Journal link' },
  chat: { icon: 'fa-comment', label: 'Chat card' },
});

export const ACCESS_KIND_INFO = Object.freeze({
  terminal: { icon: 'fa-terminal', many: 'Terminals', hue: 3 },
  shard: { icon: 'fa-microchip', many: 'Shards', hue: 2 },
  inbox: { icon: 'fa-inbox', many: 'Inboxes', hue: 5 },
  message: { icon: 'fa-envelope', many: 'Messages', hue: 7 },
  node: { icon: 'fa-tower-broadcast', many: 'Network nodes', hue: 4 },
});

/** Show = which kinds of thing. */
export const ACCESS_SHOW = Object.freeze([['all', 'All kinds'], ['terminal', 'Terminals'], ['shard', 'Shards'], ['inbox', 'Inboxes'], ['message', 'Messages'], ['node', 'Network nodes']]);
/** Group, per view. Map has one grouping, but the control is still there so the toolbar never changes shape between views. */
export const ACCESS_GROUPS = Object.freeze({
  map: [['folder', 'Scene folder']],
  thing: [['kind', 'Kind of thing'], ['holder', 'Who holds it']],
});
/** Sort, per view. */
export const ACCESS_SORTS = Object.freeze({
  map: [['folder', 'Folder order'], ['most', 'Most points'], ['az', 'A–Z']],
  thing: [['az', 'Name'], ['most', 'Most ways in'], ['fewest', 'Fewest ways in']],
});
/** The stats strip (each one is a filter). */
export const ACCESS_STATS = Object.freeze([
  ['all', 'All', '', 'Every access point'], ['map', 'On maps', '', 'Pins and step-on areas on scenes'], ['off', 'Off the map', '', 'Hotbar macros, chat cards and journal links'], ['hid', 'Hidden', 'secret', 'Hidden from players until you reveal them'], ['bad', 'Broken', 'bad', 'Point at something that was deleted'], ['none', 'Not reachable', 'attn', 'Terminals and shards players have no way to open'],
]);

const norm = (s) => String(s ?? '').toLowerCase();

/** A point passes the stats filter. ('none' is a THING filter — every point passes it.) */
export function statPasses(p, stat) {
  switch (stat) {
    case 'map': return !!p.sceneId;
    case 'off': return !p.sceneId;
    case 'bad': return !!p.broken;
    case 'hid': return !!p.hidden;
    default: return true;
  }
}

/** How many ways in a thing has, and whether a player can reach it at all (a pin, a link… or it is in a player's gear). */
export function reachOf(thing, points) {
  const ways = points.filter(p => p.key === thing.key && !p.broken && !p.hidden);
  return { ways, reachable: ways.length > 0 || !!thing.playerHeld };
}

/** Search across the thing, the scene, the folder and the point's own words. */
export function matches(q, ...parts) {
  const n = norm(q).trim();
  if (!n) return true;
  return parts.some(x => norm(x).includes(n));
}

/** The stats strip numbers. */
export function accessStats(points, things) {
  return {
    all: points.length,
    map: points.filter(p => p.sceneId).length,
    off: points.filter(p => !p.sceneId).length,
    bad: points.filter(p => p.broken).length,
    hid: points.filter(p => p.hidden).length,
    none: things.filter(t => t.found !== false && !reachOf(t, points).reachable).length,
  };
}

/** Fold rule (the standing one): the viewed scene's folder + the selection's folder open, else the first shelf; the GM's choice wins; a search / filter opens all. */
export function shelfShut(key, { index, forced, shut, open, holds }) {
  if (forced) return false;
  if (shut?.has(key)) return true;
  if (open?.has(key)) return false;
  if (holds) return false;
  return index !== 0;
}

/**
 * The MAP view: scene shelves by folder. Only scenes with points (that pass the filters) are listed,
 * plus the scene the GM is looking at (so Place… has somewhere to go).
 */
export function mapShelves({ points, scenes, things, state }) {
  const thingByKey = new Map(things.map(t => [t.key, t]));
  const kindOk = (p) => state.show === 'all' || !state.show || p.kind === state.show;
  const forced = !!(state.q || (state.stat && state.stat !== 'all') || (state.show && state.show !== 'all'));
  const shown = (p, sc) => kindOk(p) && statPasses(p, state.stat) && matches(state.q, thingByKey.get(p.key)?.name, p.where, p.detail, sc?.name, sc?.folderPath);
  const rows = [];
  const byFolder = new Map();
  for (const sc of scenes) {
    const ps = points.filter(p => p.sceneId === sc.id && shown(p, sc));
    if (!ps.length && !sc.viewed) continue;
    if (!byFolder.has(sc.folderKey)) byFolder.set(sc.folderKey, { key: sc.folderKey, name: sc.folderPath || 'Not in a folder', scenes: [] });
    byFolder.get(sc.folderKey).scenes.push({ ...sc, points: ps.map(p => ({ ...p, isArea: p.how === 'area', hue: ACCESS_KIND_INFO[p.kind]?.hue ?? 1 })), count: ps.length, hasBad: ps.some(p => p.broken), hasHidden: ps.some(p => p.hidden) });
  }
  const sortScenes = (list) => {
    if (state.sort === 'most') return list.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    if (state.sort === 'az') return list.sort((a, b) => a.name.localeCompare(b.name));
    return list.sort((a, b) => (a.navOrder ?? 0) - (b.navOrder ?? 0));
  };
  let i = 0;
  for (const f of byFolder.values()) {
    sortScenes(f.scenes);
    const holds = f.scenes.some(s => s.id === state.scene || s.viewed);
    const count = f.scenes.reduce((n, s) => n + s.count, 0);
    rows.push({ ...f, count, sceneCount: f.scenes.length, dots: f.scenes.flatMap(s => s.points).slice(0, 8).map(p => p.hue),
      shut: shelfShut(f.key, { index: i++, forced, shut: state.shut, open: state.open, holds }) });
  }
  const off = points.filter(p => !p.sceneId && kindOk(p) && statPasses(p, state.stat) && matches(state.q, thingByKey.get(p.key)?.name, p.where, p.detail))
    .map(p => ({ ...p, name: thingByKey.get(p.key)?.name || p.where, hue: ACCESS_KIND_INFO[p.kind]?.hue ?? 1, icon: ACCESS_HOW[p.how]?.icon, howLabel: ACCESS_HOW[p.how]?.label }));
  return { shelves: rows, off, empty: !rows.length && !off.length };
}

/** The selected scene's desk: its points numbered in reading order. */
export function sceneDesk({ points, scenes, things, sceneId }) {
  const sc = scenes.find(s => s.id === sceneId);
  if (!sc) return null;
  const thingByKey = new Map(things.map(t => [t.key, t]));
  const ps = points.filter(p => p.sceneId === sc.id)
    .sort((a, b) => (a.y - b.y) || (a.x - b.x))
    .map((p, i) => ({ ...p, n: i + 1, isArea: p.how === 'area', howIcon: ACCESS_HOW[p.how]?.icon, name: thingByKey.get(p.key)?.name || p.where, icon: ACCESS_KIND_INFO[p.kind]?.icon, hue: ACCESS_KIND_INFO[p.kind]?.hue ?? 1, howLabel: ACCESS_HOW[p.how]?.label }));
  return { ...sc, points: ps, count: ps.length };
}

/** The BY THING view: groups of things with the chips saying where players reach each. */
export function thingGroups({ points, things, state }) {
  const kindOk = (t) => state.show === 'all' || !state.show || t.kind === state.show;
  const rows = things.filter(kindOk).map(t => {
    const all = points.filter(p => p.key === t.key);
    const ways = all.filter(p => statPasses(p, state.stat));
    const r = reachOf(t, points);
    return { ...t, ways, wayCount: r.ways.length, reachable: r.reachable, hue: ACCESS_KIND_INFO[t.kind]?.hue ?? 1, icon: ACCESS_KIND_INFO[t.kind]?.icon,
      chips: ways.map(p => ({ id: p.id, icon: ACCESS_HOW[p.how]?.icon, label: p.where, broken: p.broken, hidden: p.hidden })) };
  }).filter(t => {
    if (state.stat === 'none') return !t.reachable && t.found !== false;
    if (state.stat === 'bad') return t.ways.some(p => p.broken) || t.found === false;
    if (state.stat === 'map' || state.stat === 'off' || state.stat === 'hid') return t.ways.length > 0;
    return true;
  }).filter(t => matches(state.q, t.name, t.subline, t.holder, ...t.ways.map(p => p.where)));
  const sorter = state.sort === 'most' ? (a, b) => b.wayCount - a.wayCount || a.name.localeCompare(b.name)
    : state.sort === 'fewest' ? (a, b) => a.wayCount - b.wayCount || a.name.localeCompare(b.name)
    : (a, b) => a.name.localeCompare(b.name);
  const groups = new Map();
  for (const t of rows) {
    const gk = state.group === 'holder' ? (t.holder || 'World items') : t.kind;
    const gname = state.group === 'holder' ? (t.holder || 'World items') : (ACCESS_KIND_INFO[t.kind]?.many || t.kind);
    if (!groups.has(gk)) groups.set(gk, { key: gk, name: gname, icon: state.group === 'holder' ? 'fa-user' : ACCESS_KIND_INFO[t.kind]?.icon, hue: ACCESS_KIND_INFO[t.kind]?.hue ?? 1, rows: [] });
    groups.get(gk).rows.push(t);
  }
  const out = [...groups.values()];
  for (const g of out) { g.rows.sort(sorter); g.count = g.rows.length; }
  if (state.group !== 'holder') out.sort((a, b) => Object.keys(ACCESS_KIND_INFO).indexOf(a.key) - Object.keys(ACCESS_KIND_INFO).indexOf(b.key));
  else out.sort((a, b) => (a.key === 'World items') - (b.key === 'World items') || a.name.localeCompare(b.name));
  return { groups: out, empty: !out.length };
}

/** The selected thing's desk. */
export function thingDesk({ points, things, key }) {
  const t = things.find(x => x.key === key);
  if (!t) return null;
  const r = reachOf(t, points);
  const ways = points.filter(p => p.key === key).map(p => ({ ...p, onMap: !!p.sceneId, howIcon: ACCESS_HOW[p.how]?.icon, howLabel: ACCESS_HOW[p.how]?.label }));
  return { ...t, ways, wayCount: r.ways.length, reachable: r.reachable, icon: ACCESS_KIND_INFO[t.kind]?.icon, hue: ACCESS_KIND_INFO[t.kind]?.hue ?? 1 };
}
