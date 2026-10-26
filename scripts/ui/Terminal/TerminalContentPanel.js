/**
 * TerminalContentPanel — the view-model for Configure Terminal → Accounts'
 * CONTENT blocks (2026-10-25): the shared volume and every account's MAIL +
 * FILES, drawn as the folder tree the player will see.
 * @file scripts/ui/Terminal/TerminalContentPanel.js
 * @module night-city-messenger
 *
 * Pure shaping — no writes, no DOM. TerminalConfigApp owns the state (which
 * blocks / folders are open) and the handlers; the rules are terminalFiles.js.
 * Mock: dev/mockups/terminal-file-repository-mock.html (frame 2).
 */

import { SHARED_SCOPE, buildTree, entryFolderPath, gateLabel, effectiveGate, isLiveFile, formatSize } from '../../utils/terminalFiles.js';
import { resolveEnvelope, CONTENT_TYPE_INFO, displayContentType } from '../content/ContentRenderers.js';
import { formatCyberDate } from '../../utils/helpers.js';

/** One entry as a config row (file or mail). */
export function entryRow(m, { isGM = true } = {}) {
  const ct = displayContentType(m, { isGM });
  const info = ct ? CONTENT_TYPE_INFO[ct] : null;
  const env = resolveEnvelope({ ...m, contentType: ct });
  return {
    messageId: m.messageId,
    isFile: env.isFile,
    filename: env.filename || m.subject || '(file)',
    subject: m.subject || '(no subject)',
    from: m.from || 'unknown',
    typeLabel: env.isFile ? env.typeLabel : (info?.label || 'Message'),
    typeIcon: env.isFile ? env.typeIcon : (info?.icon || 'fas fa-envelope'),
    accent: env.accent || info?.accent || '',
    size: env.isFile && env.size !== '—' ? env.size : '',
    isStream: !!env.isStream,
    date: env.isStream ? 'LIVE' : (m.timestamp ? formatCyberDate(m.timestamp, { dateOnly: true }) : ''),
    encrypted: !!m.status?.encrypted,
    unread: !m.status?.read,
    scope: m.accountId,
    path: entryFolderPath(m),
  };
}

/**
 * "Move to…" options across every volume: the root and every folder of the
 * shared volume and of each account, plus a trailing "new folder" choice.
 * @param {object[]} volumes - [{ scope, label, dirs: string[] }]
 * @param {string} scope @param {string} path - the entry's current location
 */
export function moveOptions(volumes, scope, path) {
  const out = [];
  for (const v of volumes) {
    out.push({ value: `${v.scope}|`, label: `${v.label}: /`, selected: v.scope === scope && !path, group: v.label });
    for (const d of v.dirs) out.push({ value: `${v.scope}|${d}`, label: `${v.label}: /${d}`, selected: v.scope === scope && d === path, group: v.label });
  }
  out.push({ value: '__new__', label: '＋ New folder…', selected: false, group: '' });
  return out;
}

/**
 * Build the content context for the config sheet.
 * @param {object} o
 * @param {object} o.svc        - TerminalService
 * @param {Item}   o.item
 * @param {object[]} o.accounts - raw config accounts
 * @param {object[]} o.folderDefs - TerminalService.getFolders(item) (the MAIL folders)
 * @param {{open:Set<string>, dirClosed:Set<string>, mailOpen:Set<string>, tab?:Map<string,string>}} o.ui
 * @returns {{ shared: object, byAccount: Object<string, object>, totals: object, volumes: object[] }}
 */
export function buildContentContext({ svc, item, accounts = [], folderDefs = [], ui }) {
  const all = svc.getAllMessages(item);
  const folders = svc.getFileFolders(item);
  const volumes = [];
  const trees = {};
  const addVolume = (scope, label) => {
    const tree = buildTree({ entries: all, folders, scope, account: null, isGM: true });
    trees[scope] = tree;
    volumes.push({ scope, label, dirs: tree.dirs.map(d => d.path) });
  };
  addVolume(SHARED_SCOPE, 'shared');
  for (const a of accounts) addVolume(a.id, a.username || a.displayName || a.id);

  const dirRow = (scope, d, open) => {
    const eff = effectiveGate(folders, scope, d.path);
    const own = d.registered ? d.gate : { mode: 'everyone', min: 0, accountIds: [] };
    const inherited = !d.registered || own.mode === 'everyone' ? (eff.from && eff.from !== d.path) : false;
    return {
      isDir: true, scope, path: d.path, name: d.name, depth: d.depth, open,
      registered: d.registered,
      count: d.count, size: d.bytes ? formatSize(d.bytes) : '',
      gate: {
        mode: own.mode, min: own.min,
        isEveryone: own.mode === 'everyone', isAdmin: own.mode === 'admin', isClearance: own.mode === 'clearance', isAccounts: own.mode === 'accounts',
        isGated: own.mode !== 'everyone' || inherited,
        accountCount: (own.accountIds || []).length,
        accountsLabel: (own.accountIds || []).map(id => accounts.find(a => a.id === id)?.username || '?').join(', ') || 'pick…',
        inherited, inheritedFrom: inherited ? `/${eff.from}` : '',
        label: gateLabel(eff.gate),
      },
    };
  };

  const filesBlock = (scope, rootLabel) => {
    const tree = trees[scope];
    const rows = [];
    // A dir row carries its OWN direct files (rendered in a scroller right under
    // it, so a folder with a hundred files scrolls on its own); sub-folders
    // follow as further rows; the root's files come last in one holder.
    const emit = (parent) => {
      for (const d of tree.dirs.filter(x => x.parent === parent && x.path !== '')) {
        const open = !ui.dirClosed.has(`${scope}:${d.path}`);
        const files = open ? (tree.byPath.get(d.path) || []).map(e => ({ ...entryRow(e), depth: d.depth + 1, moveOptions: moveOptions(volumes, scope, d.path) })) : [];
        rows.push({ ...dirRow(scope, d, open), files });
        if (open) emit(d.path);
      }
    };
    emit('');
    const rootFiles = (tree.byPath.get('') || []).map(e => ({ ...entryRow(e), depth: 0, moveOptions: moveOptions(volumes, scope, '') }));
    if (rootFiles.length) rows.push({ isRootFiles: true, scope, files: rootFiles });
    return { scope, root: rootLabel, rows, count: tree.totalFiles, folderCount: tree.dirs.length, size: formatSize(tree.totalBytes) };
  };

  // MAIL folders per account — the viewer's location semantics (Trash >
  // Saved > custom > Inbox), a deleted file counts as mail in the Trash.
  const customIds = new Set(folderDefs.filter(fd => fd.kind === 'custom').map(fd => fd.id));
  const inFolder = {
    inbox: m => !m.status?.deleted && !m.status?.saved && !m.status?.sent && !(m.folder && customIds.has(m.folder)),
    saved: m => m.status?.saved && !m.status?.deleted,
    trash: m => !!m.status?.deleted,
  };
  for (const id of customIds) inFolder[id] = m => m.folder === id && !m.status?.deleted && !m.status?.saved && !m.status?.sent;
  const mailBlock = (a) => {
    const mine = all.filter(m => m.accountId === a.id && (m.envelope !== 'file' || m.status?.deleted));
    const folders = folderDefs.map(fd => {
      const list = mine.filter(inFolder[fd.id] || (() => false));
      const open = ui.mailOpen.has(`${a.id}:${fd.id}`);
      return {
        id: fd.id, scope: a.id, name: fd.name, icon: fd.icon, open,
        sys: fd.kind === 'custom' ? '' : fd.kind.toUpperCase(),
        count: list.length, unread: list.filter(m => !m.status?.read && !m.status?.deleted).length,
        rows: open ? list.map(m => entryRow(m)) : [],
      };
    });
    return { folders, total: mine.filter(m => !m.status?.deleted).length };
  };

  const shared = {
    scope: SHARED_SCOPE, isShared: true, accountId: null,
    open: ui.open.has(SHARED_SCOPE),
    files: filesBlock(SHARED_SCOPE, '/shared'),
    mail: null,
    // No mail on the machine itself → no tab strip, straight to FILES.
    tabMail: false, tabFiles: true,
  };
  const byAccount = {};
  for (const a of accounts) {
    byAccount[a.id] = {
      scope: a.id, isShared: false, accountId: a.id,
      open: ui.open.has(a.id),
      files: filesBlock(a.id, `/home/${a.username || a.id}`),
      mail: mailBlock(a),
      // MAIL | FILES tab — remembered per account, MAIL by default.
      tabMail: (ui.tab?.get(a.id) || 'mail') !== 'files',
      tabFiles: (ui.tab?.get(a.id) || 'mail') === 'files',
    };
  }
  const live = all.filter(isLiveFile);
  return {
    shared, byAccount, volumes,
    totals: {
      mail: all.filter(m => m.envelope !== 'file' && !m.status?.deleted).length,
      files: live.length,
      folders: folders.length + Object.values(trees).reduce((s, t) => s + t.dirs.filter(d => !d.registered).length, 0),
      shared: live.filter(m => m.shared).length,
    },
  };
}
