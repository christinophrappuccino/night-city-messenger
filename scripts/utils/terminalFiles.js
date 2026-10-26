/**
 * terminalFiles — the FILE REPOSITORY rules for a terminal (2026-10-25).
 * @file scripts/utils/terminalFiles.js
 * @module night-city-messenger
 *
 * Pure: no Foundry globals, no DOM. TerminalService / the viewer / the config
 * sheet / the composer all read these, and `dev/tools/sims/test-terminal-files.mjs`
 * drives them directly.
 *
 * The model, in one paragraph. A terminal already holds mail AND files — every
 * entry is a typed content entry, and a file is one with `envelope: 'file'`.
 * What was missing was structure: a file's folder was a free-text `file.path`
 * typed in the composer, nothing could be stored on the MACHINE (only on a
 * login), and nothing was gated. Now:
 *   · a file's folder is still `file.path` (so every entry ever authored keeps
 *     its place), but it is NORMALISED (`records/2046`, no leading slash) and
 *     the paths are what the tree is built from;
 *   · a SHARED VOLUME is an entry whose page `accountId` is SHARED_SCOPE — it
 *     lives on the terminal, not on an account, so every login sees it;
 *   · a FOLDER REGISTRY (`config.files.folders`) adds what a path string cannot
 *     carry — an empty folder, and a GATE (everyone / admins / clearance / named
 *     accounts). A folder that exists only because files sit in it is DERIVED
 *     and ungated; registering it is what the gate select does.
 * A player who cannot open a folder sees it LOCKED, never empty — the folder
 * stays in the tree with its reason; only its files (and everything under it)
 * leave the lists. Admin accounts open everything.
 */

/** Reserved page `accountId` for entries stored on the machine itself. */
export const SHARED_SCOPE = '__shared__';

/** Gate modes a registered folder can carry. */
export const GATE_MODES = Object.freeze(['everyone', 'admin', 'clearance', 'accounts']);

export const GATE_LABELS = Object.freeze({
  everyone: 'everyone',
  admin: 'admins only',
  clearance: 'clearance',
  accounts: 'chosen accounts',
});

/**
 * Normalise a folder path: forward slashes, no leading/trailing slash, no empty
 * segments, trimmed segments. '' is the root.
 * @param {string} p
 * @returns {string}
 */
export function normalizeFolderPath(p) {
  return String(p ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .map(s => s.trim())
    .filter(Boolean)
    .join('/');
}

/** Parent of a path ('' for a root-level folder). */
export function parentPath(p) {
  const n = normalizeFolderPath(p);
  const i = n.lastIndexOf('/');
  return i < 0 ? '' : n.slice(0, i);
}

/** Last segment of a path ('' for the root). */
export function folderName(p) {
  const n = normalizeFolderPath(p);
  const i = n.lastIndexOf('/');
  return i < 0 ? n : n.slice(i + 1);
}

/** Every ancestor of a path, shallowest first, excluding the root and itself. */
export function ancestorsOf(p) {
  const n = normalizeFolderPath(p);
  if (!n) return [];
  const segs = n.split('/');
  const out = [];
  for (let i = 1; i < segs.length; i++) out.push(segs.slice(0, i).join('/'));
  return out;
}

/** Is `p` equal to or nested under `base`? ('' is under everything.) */
export function isUnder(p, base) {
  const a = normalizeFolderPath(p), b = normalizeFolderPath(base);
  if (!b) return true;
  return a === b || a.startsWith(b + '/');
}

/**
 * Scope of a stored entry: SHARED_SCOPE, or the account id. The service stamps
 * `accountId` onto the message object it reads back.
 */
export function entryScope(entry) {
  return entry?.accountId === SHARED_SCOPE ? SHARED_SCOPE : (entry?.accountId || '');
}

/** The folder an entry lives in ('' = the volume root). */
export function entryFolderPath(entry) {
  return normalizeFolderPath(entry?.file?.path || '');
}

/** True for a non-deleted file entry (a deleted file sits in the mail Trash). */
export function isLiveFile(entry) {
  return entry?.envelope === 'file' && !entry?.status?.deleted;
}

/**
 * Sanitise one registered folder. Unknown gate modes fall back to 'everyone'
 * (never to a lock — an accidental lockout reads as a broken machine).
 * Returns null for an unusable record (no scope, root path).
 */
export function sanitizeFolder(raw = {}) {
  const path = normalizeFolderPath(raw.path);
  const scope = raw.scope === SHARED_SCOPE ? SHARED_SCOPE : String(raw.scope || '');
  if (!path || !scope) return null;
  const g = raw.gate || {};
  const mode = GATE_MODES.includes(g.mode) ? g.mode : 'everyone';
  const min = Number.isFinite(Number(g.min)) ? Math.max(0, Math.floor(Number(g.min))) : 0;
  const accountIds = Array.isArray(g.accountIds) ? g.accountIds.filter(x => typeof x === 'string' && x) : [];
  return {
    id: String(raw.id || `fdir_${scope}_${path}`.replace(/[^a-zA-Z0-9_]/g, '_')),
    scope,
    path,
    gate: { mode, min, accountIds },
  };
}

/**
 * Sanitise the whole `config.files` block. Duplicate (scope, path) pairs keep
 * the first; the result is sorted by scope then path so the config is stable.
 */
export function sanitizeFilesConfig(files = {}) {
  const seen = new Set();
  const folders = [];
  for (const raw of Array.isArray(files?.folders) ? files.folders : []) {
    const f = sanitizeFolder(raw);
    if (!f) continue;
    const key = `${f.scope}:${f.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    folders.push(f);
  }
  folders.sort((a, b) => (a.scope === b.scope ? a.path.localeCompare(b.path) : a.scope.localeCompare(b.scope)));
  return { folders };
}

/**
 * Numeric rank of a free-text clearance ("LEVEL 3", "L4", "SECRET 2") — the
 * first integer in the string; null when there is none. Clearance gates compare
 * ranks, so an account whose clearance has no number never passes one.
 */
export function clearanceRank(str) {
  const m = /(\d+)/.exec(String(str ?? ''));
  return m ? parseInt(m[1], 10) : null;
}

/**
 * May this account open a folder with this gate? GM and admin accounts always
 * can. `account` may be null (no login) — then only 'everyone' passes.
 */
export function gatePasses(gate, account, { isGM = false } = {}) {
  if (isGM) return true;
  const mode = gate?.mode || 'everyone';
  if (mode === 'everyone') return true;
  if (account?.isAdmin) return true;
  if (mode === 'admin') return false;
  if (mode === 'clearance') {
    const rank = clearanceRank(account?.clearance);
    return rank !== null && rank >= (gate?.min ?? 0);
  }
  if (mode === 'accounts') return !!account?.id && (gate?.accountIds || []).includes(account.id);
  return false;
}

/**
 * The gate that applies to a path: its own registered gate, else the nearest
 * registered ancestor's non-'everyone' gate (a locked parent locks everything
 * under it), else 'everyone'. Returns { gate, from } where `from` is the path
 * whose gate applies ('' when nothing does).
 */
export function effectiveGate(folders, scope, path) {
  const n = normalizeFolderPath(path);
  const chain = [...ancestorsOf(n), n].filter(Boolean);
  // Innermost registered folder with a real gate wins; an inner 'everyone' does
  // NOT reopen a locked parent (you cannot reach it to begin with).
  let found = { gate: { mode: 'everyone', min: 0, accountIds: [] }, from: '' };
  for (const p of chain) {
    const reg = folders.find(f => f.scope === scope && f.path === p);
    if (reg && reg.gate?.mode && reg.gate.mode !== 'everyone') { found = { gate: reg.gate, from: p }; break; }
  }
  return found;
}

/** Can this account open the folder at `path` in `scope`? */
export function canOpenFolder(folders, scope, path, account, opts = {}) {
  return gatePasses(effectiveGate(folders, scope, path).gate, account, opts);
}

/**
 * Entries this account may see: every mail entry, plus the files whose folder
 * it can open. Files in a locked folder (or under one) are removed outright —
 * the leak rule: a hidden file is never in the DOM.
 */
export function visibleEntries(entries, folders, account, opts = {}) {
  if (opts.isGM) return entries.slice();
  return entries.filter(e => {
    if (!isLiveFile(e)) return true;
    return canOpenFolder(folders, entryScope(e), entryFolderPath(e), account, opts);
  });
}

/** "18 KB" / "1.4 MB" / "512 B" → bytes (0 when unparseable or a stream's '—'). */
export function parseSize(str) {
  const m = /([\d.]+)\s*(B|KB|MB|GB|TB)?/i.exec(String(str ?? ''));
  if (!m) return 0;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return 0;
  const mult = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 }[(m[2] || 'B').toUpperCase()] || 1;
  return Math.round(n * mult);
}

/** bytes → "18 KB" (the envelope resolver's units). */
export function formatSize(bytes) {
  const b = Math.max(0, Number(bytes) || 0);
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${Math.round(b / 1024)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(b < 10 * 1024 ** 2 ? 1 : 0)} MB`;
  return `${(b / 1024 ** 3).toFixed(1)} GB`;
}

/**
 * Build the directory tree for ONE volume (scope).
 *
 * @param {object} o
 * @param {object[]} o.entries   - every entry on the terminal (any scope); files
 *                                 of other scopes are ignored, mail is ignored
 * @param {object[]} o.folders   - the sanitised folder registry (all scopes)
 * @param {string}   o.scope     - SHARED_SCOPE or an account id
 * @param {object}   [o.account] - the viewing account (for lock state)
 * @param {boolean}  [o.isGM]
 * @param {(e)=>number} [o.sizeOf] - bytes of an entry (default: parse e.file.size)
 * @returns {{ dirs: object[], files: object[], byPath: Map<string, object[]>, totalFiles: number, totalBytes: number }}
 *   dirs: every folder (registered ∪ derived ∪ ancestors), sorted by path, each
 *   { path, name, depth, parent, registered, gate, gateFrom, locked, count, bytes, deepCount }
 *   files: the entries of this scope (live files only), each tagged `folderPath`
 */
export function buildTree({ entries = [], folders = [], scope, account = null, isGM = false, sizeOf = null }) {
  const size = sizeOf || (e => parseSize(e?.file?.size || ''));
  const files = entries
    .filter(e => isLiveFile(e) && entryScope(e) === scope)
    .map(e => ({ ...e, folderPath: entryFolderPath(e) }));

  const paths = new Set();
  for (const f of folders) if (f.scope === scope) { paths.add(f.path); for (const a of ancestorsOf(f.path)) paths.add(a); }
  for (const e of files) if (e.folderPath) { paths.add(e.folderPath); for (const a of ancestorsOf(e.folderPath)) paths.add(a); }

  const byPath = new Map();
  byPath.set('', []);
  for (const p of paths) byPath.set(p, []);
  for (const e of files) byPath.get(e.folderPath).push(e);

  const dirs = [...paths].sort().map(path => {
    const reg = folders.find(f => f.scope === scope && f.path === path) || null;
    const eff = effectiveGate(folders, scope, path);
    const direct = byPath.get(path) || [];
    const deep = files.filter(e => isUnder(e.folderPath, path));
    return {
      path,
      name: folderName(path),
      depth: path.split('/').length - 1,
      parent: parentPath(path),
      registered: !!reg,
      id: reg?.id || null,
      gate: reg?.gate || { mode: 'everyone', min: 0, accountIds: [] },
      effectiveGate: eff.gate,
      gateFrom: eff.from,
      locked: !gatePasses(eff.gate, account, { isGM }),
      count: direct.length,
      deepCount: deep.length,
      bytes: direct.reduce((s, e) => s + size(e), 0),
    };
  });

  return {
    scope,
    dirs,
    files,
    byPath,
    totalFiles: files.length,
    totalBytes: files.reduce((s, e) => s + size(e), 0),
  };
}

/**
 * The listing for one folder of a built tree: its direct subfolders and its
 * direct files, plus the breadcrumb. A locked folder lists NOTHING (the caller
 * renders the lock instead) — never trust the UI alone to hide it.
 */
export function listingFor(tree, path, { account = null, isGM = false, folders = [] } = {}) {
  const n = normalizeFolderPath(path);
  const dir = tree.dirs.find(d => d.path === n) || null;
  const locked = n ? (dir ? dir.locked : !canOpenFolder(folders, tree.scope, n, account, { isGM })) : false;
  const crumb = ['', ...ancestorsOf(n), n].filter((p, i, a) => a.indexOf(p) === i).map(p => ({ path: p, name: p ? folderName(p) : '' }));
  if (locked) return { path: n, dir, locked: true, crumb, subdirs: [], files: [], bytes: 0 };
  const subdirs = tree.dirs.filter(d => d.parent === n && d.path !== n && d.path !== '');
  const files = (tree.byPath.get(n) || []).slice();
  return { path: n, dir, locked: false, crumb, subdirs, files, bytes: dir ? dir.bytes : files.reduce((s, e) => s + parseSize(e?.file?.size || ''), 0) };
}

/**
 * Rewrite plan for renaming/moving a folder: every file whose folder is the old
 * path or under it gets the prefix swapped. Pure — returns [{ entry, newPath }].
 */
export function rewritePlan(files, scope, oldPath, newPath) {
  const o = normalizeFolderPath(oldPath), nw = normalizeFolderPath(newPath);
  const out = [];
  for (const e of files) {
    if (!isLiveFile(e) || entryScope(e) !== scope) continue;
    const p = entryFolderPath(e);
    if (!isUnder(p, o) || !o) continue;
    const rest = p === o ? '' : p.slice(o.length + 1);
    out.push({ entry: e, newPath: normalizeFolderPath(nw ? (rest ? `${nw}/${rest}` : nw) : rest) });
  }
  return out;
}

/** Human label for a gate ("admins only", "clearance ≥ 3", "2 accounts"). */
export function gateLabel(gate) {
  const mode = gate?.mode || 'everyone';
  if (mode === 'clearance') return `clearance ≥ ${gate?.min ?? 0}`;
  if (mode === 'accounts') { const n = (gate?.accountIds || []).length; return n === 1 ? '1 account' : `${n} accounts`; }
  return GATE_LABELS[mode] || 'everyone';
}
