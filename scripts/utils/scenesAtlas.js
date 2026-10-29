/**
 * Admin → Networks → Scenes: THE ATLAS (2026-10-29, dev-picked from dev/mockups/admin-networks-scenes-atlas-mock.html:
 * "A as the home, C's transmitter strip as the Paint picker, B one switch away as Grid").
 *
 * Pure rules — no Foundry globals. NetworksTab gathers world scenes / folders / compendium indexes into plain rows and
 * hands them here; everything about what is shown, in which order, folded or not, lives in this file so a sim can drive it.
 *
 *   A row:    { id, name, folderKey, sort, nav, navOrder, cur, dead, start, nets:[ids], players:[…], imported, configured, modified }
 *   A folder: { key, name, depth, path:[names], parentKey }   — handed over in Foundry's tree order (depth-first)
 *
 * @module scenesAtlas
 */

/** Show filter (one at a time). */
export const SCENE_SHOW = Object.freeze([
  ['all', 'All'], ['unwired', 'Not wired'], ['dead', 'Dead zones'], ['players', 'Players here'], ['nav', 'On the nav bar'], ['imported', 'Imported'],
]);

/** Sort inside a shelf. "folder" = the GM's own order in the Foundry sidebar. */
export const SCENE_SORTS = Object.freeze([['folder', 'Folder order'], ['az', 'A–Z'], ['recent', 'Recently changed'], ['wired', 'Most wired']]);

/** Cards a shelf shows before "+N more" (a 300-scene folder must not draw 300 thumbnails on every render). */
export const SHELF_LIMIT = 36;

/** The key of the pseudo-folder for scenes in no folder. */
export const UNFILED = '__unfiled__';

const lc = (s) => String(s ?? '').toLowerCase();

/** Does a row pass the Show filter? A dead zone is never "not wired" — nothing reaches it on purpose. */
export function scenePasses(row, show = 'all') {
  switch (show) {
    case 'unwired': return !row.dead && !(row.nets || []).length;
    case 'dead': return !!row.dead;
    case 'players': return !!(row.players || []).length;
    case 'nav': return !!row.nav;
    case 'imported': return !!row.imported;
    default: return true;
  }
}

/** Search: the scene name or any folder name on its path. */
export function sceneMatches(row, q, folderPath = []) {
  const s = lc(q).trim();
  if (!s) return true;
  return lc(row.name).includes(s) || folderPath.some((f) => lc(f).includes(s));
}

/** Order rows inside one shelf. The viewed scene always leads. */
export function sortScenes(rows = [], sort = 'folder') {
  const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true });
  const cmp = {
    folder: (a, b) => (a.sort ?? 0) - (b.sort ?? 0) || byName(a, b),
    az: byName,
    recent: (a, b) => (b.modified || 0) - (a.modified || 0) || byName(a, b),
    wired: (a, b) => (b.nets || []).length - (a.nets || []).length || byName(a, b),
  }[sort] || byName;
  return [...rows].sort((a, b) => (Number(!!b.cur) - Number(!!a.cur)) || cmp(a, b));
}

/** Show-filter counts over the rows that pass search + folder (so every chip tells the truth about what you'd see). */
export function showCounts(rows = []) {
  return Object.fromEntries(SCENE_SHOW.map(([k]) => [k, rows.filter((r) => scenePasses(r, k)).length]));
}

/**
 * Is a shelf folded? The standing rule (every admin tab, 2026-10-28): the shelves the GM is most likely to want open
 * start open — the navigation bar and the folder holding the viewed scene (else the first shelf) — the rest closed; a
 * search / filter opens everything; after that the GM's own fold / unfold wins for the session.
 */
export function shelfShut(key, { defaultOpen = false, shut, open, forced = false } = {}) {
  if (forced) return false;
  if (shut?.has?.(key)) return true;
  if (open?.has?.(key)) return false;
  return !defaultOpen;
}

/** What a shelf head says about its scenes: networks present, dead / not-wired / players counts. */
export function shelfSummary(rows = [], globalIds = new Set()) {
  const nets = [...new Set(rows.flatMap((r) => r.nets || []))].filter((id) => !globalIds.has(id));
  return {
    n: rows.length,
    nets,
    dead: rows.filter((r) => r.dead).length,
    unwired: rows.filter((r) => scenePasses(r, 'unwired')).length,
    players: rows.reduce((n, r) => n + (r.players || []).length, 0),
  };
}

/**
 * Build the shelves. `folders` come in tree order; a folder shelf holds only its OWN scenes (sub-folders get their own
 * shelf, indented by depth), so a nested tree reads the way the Foundry sidebar does. Empty shelves are dropped.
 * Returns [{ key, name, depth, path, rows (shown), ids (every row on the shelf), summary, total, hidden }].
 */
export function buildShelves(rows = [], folders = [], {
  sort = 'folder', limit = SHELF_LIMIT, more = new Set(), globalIds = new Set(), selId = null,
} = {}) {
  const byFolder = new Map();
  for (const r of rows) {
    const k = r.folderKey && folders.some((f) => f.key === r.folderKey) ? r.folderKey : UNFILED;
    if (!byFolder.has(k)) byFolder.set(k, []);
    byFolder.get(k).push(r);
  }
  const out = [];
  const push = (f, list) => {
    if (!list?.length) return;
    const sorted = sortScenes(list, sort);
    const open = more.has(f.key) || limit <= 0 || sorted.length <= limit;
    let shown = open ? sorted : sorted.slice(0, limit);
    // the picked scene is always on its shelf, even past the fold
    if (!open && selId && !shown.some((r) => r.id === selId)) { const s = sorted.find((r) => r.id === selId); if (s) shown = [...shown, s]; }
    out.push({ key: f.key, name: f.name, depth: f.depth || 0, path: f.path || [f.name], rows: shown, ids: sorted.map((r) => r.id), total: sorted.length,
      hidden: sorted.length - shown.length, summary: shelfSummary(sorted, globalIds) });
  };
  for (const f of folders) push(f, byFolder.get(f.key));
  push({ key: UNFILED, name: 'Not in a folder', depth: 0, path: [] }, byFolder.get(UNFILED));
  return out;
}

/** The navigation-bar shelf: the scenes the GM keeps within reach, in their nav order. */
export function navShelf(rows = []) {
  return rows.filter((r) => r.nav).sort((a, b) => (a.navOrder ?? 0) - (b.navOrder ?? 0) || String(a.name).localeCompare(String(b.name)));
}

/** The folder a scene sits in and every folder above it — used to open the viewed scene's shelf. */
export function ancestorKeys(folderKey, folders = []) {
  const by = new Map(folders.map((f) => [f.key, f]));
  const out = [];
  let k = folderKey, guard = 0;
  while (k && by.has(k) && guard++ < 32) { out.push(k); k = by.get(k).parentKey || null; }
  return out;
}

/** A folder and everything under it (the Folder picker narrows to a subtree). */
export function subtreeKeys(rootKey, folders = []) {
  if (!rootKey) return null;
  const keys = new Set([rootKey]);
  let grew = true;
  while (grew) { grew = false; for (const f of folders) if (f.parentKey && keys.has(f.parentKey) && !keys.has(f.key)) { keys.add(f.key); grew = true; } }
  return keys;
}

/**
 * Wire / unwire one network across a set of rows ("Wire all" on a shelf head while painting): if every row already has
 * it, take it off all of them; otherwise put it on the ones missing it. Dead zones are left alone either way.
 * Returns { on, ids } — the new state and the rows that change.
 */
export function shelfPaint(rows = [], netId) {
  const live = rows.filter((r) => !r.dead);
  const all = live.length > 0 && live.every((r) => (r.nets || []).includes(netId));
  return { on: !all, ids: live.filter((r) => (r.nets || []).includes(netId) === all).map((r) => r.id) };
}

/** Coverage of one network over the rows: { n, of, pct }. A global network reaches every scene that is not dead. */
export function coverage(rows = [], netId, { global = false } = {}) {
  const of = rows.length;
  const n = global ? rows.filter((r) => !r.dead).length : rows.filter((r) => !r.dead && (r.nets || []).includes(netId)).length;
  return { n, of, pct: of ? Math.round((n / of) * 100) : 0 };
}

/** Past this many networks the Paint strip becomes a dock + a searchable picker. */
export const PAINT_DOCK_AT = 8;

/**
 * The Paint dock (2026-10-29, dev: "a lot of networks potentially being a thing"): the network being painted, then
 * the recently painted ones (most recent first), then the most widely placed — paintable networks only, `limit`
 * tiles. Everything else lives in the "All networks" picker.
 * @param {Array<{id:string, global:boolean, n:number, name:string}>} transmitters
 * @param {{paint?:string|null, recent?:string[], limit?:number}} o
 * @returns {{dock:Array, more:number}}
 */
export function paintDock(transmitters = [], { paint = null, recent = [], limit = 6 } = {}) {
  const usable = transmitters.filter((t) => !t.global);
  const byId = new Map(usable.map((t) => [t.id, t]));
  const out = [];
  const add = (t) => { if (t && !out.includes(t) && out.length < limit) out.push(t); };
  add(byId.get(paint));
  for (const id of recent) add(byId.get(id));
  for (const t of [...usable].sort((a, b) => (b.n - a.n) || String(a.name).localeCompare(String(b.name)))) add(t);
  return { dock: out, more: usable.length - out.length };
}

/** Rows between two ids in display order (the Grid's shift-click range), inclusive, either direction. */
export function rangeIds(order = [], fromId, toId) {
  const a = order.indexOf(fromId), b = order.indexOf(toId);
  if (a < 0 || b < 0) return toId ? [toId] : [];
  return order.slice(Math.min(a, b), Math.max(a, b) + 1);
}

// ─── Compendium pre-wiring ───
// A scene still in a pack can hold no flags, so its coverage is kept in a world setting keyed by the PACK uuid and
// applied the moment the scene is imported (Foundry stamps _stats.compendiumSource on the copy).

/** A blank pre-wire record. */
export const PREWIRE_BLANK = Object.freeze({ nets: [], start: '', dead: false });

/** Normalise a stored record (unknown fields dropped, nets de-duplicated). */
export function sanitizePrewire(rec) {
  const nets = [...new Set((Array.isArray(rec?.nets) ? rec.nets : []).map(String).filter(Boolean))];
  const start = typeof rec?.start === 'string' && nets.includes(rec.start) ? rec.start : '';
  return { nets, start, dead: !!rec?.dead };
}

/** Toggle one network on a pre-wire record; returns the new record (null when it ends up empty — the key is removed). */
export function togglePrewire(rec, netId) {
  const r = sanitizePrewire(rec);
  r.nets = r.nets.includes(netId) ? r.nets.filter((x) => x !== netId) : [...r.nets, netId];
  if (r.start && !r.nets.includes(r.start)) r.start = '';
  return (r.nets.length || r.dead) ? r : null;
}

/**
 * The scene flags an import should receive from its pre-wire record: { networkAvailability, defaultNetwork?, deadZone? }.
 * Null when there is nothing to apply.
 */
export function prewireFlags(rec) {
  const r = sanitizePrewire(rec);
  if (!r.nets.length && !r.dead) return null;
  const out = { networkAvailability: Object.fromEntries(r.nets.map((id) => [id, true])) };
  if (r.start) out.defaultNetwork = r.start;
  if (r.dead) out.deadZone = true;
  return out;
}

/** The pack uuid an imported scene came from (v12 `_stats.compendiumSource`, older `flags.core.sourceId`). */
export function sourceUuidOf(sceneLike) {
  return sceneLike?._stats?.compendiumSource || sceneLike?.flags?.core?.sourceId || null;
}
