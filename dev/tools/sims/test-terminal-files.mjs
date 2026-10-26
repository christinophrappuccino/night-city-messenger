// Sim: the terminal FILE REPOSITORY (2026-10-25) — scripts/utils/terminalFiles.js
// (pure rules) + the REAL TerminalService methods via prototype.call over a
// mocked journal, + wiring guards (templates / actions / CSS / composer / sweep
// for the retired env-filter). Run: node dev/tools/sims/test-terminal-files.mjs
import fs from 'fs';
import { pathToFileURL, fileURLToPath } from 'url';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const MOD = 'night-city-messenger';
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };
const read = (p) => fs.readFileSync(`${ROOT}/${p}`, 'utf8');

// ── Minimal Foundry globals ──
let GM = true;
globalThis.game = { user: { isGM: true }, users: { activeGM: {} }, nightcity: { timeService: { getCurrentTime: () => '2046-03-13T02:14:00Z', getCurrentTimeMs: () => Date.parse('2046-03-13T02:14:00Z') } }, settings: { get: () => undefined } };
globalThis.foundry = { utils: {
  deepClone: (o) => JSON.parse(JSON.stringify(o)),
  mergeObject: (a, b, { inplace = true } = {}) => {
    const out = inplace ? a : JSON.parse(JSON.stringify(a));
    const merge = (t, s) => { for (const [k, v] of Object.entries(s || {})) { if (v && typeof v === 'object' && !Array.isArray(v) && t[k] && typeof t[k] === 'object' && !Array.isArray(t[k])) merge(t[k], v); else t[k] = v; } return t; };
    return merge(out, b);
  },
  expandObject: (o) => o, randomID: () => Math.random().toString(36).slice(2, 10),
} };
globalThis.Hooks = { on: () => {}, once: () => {}, off: () => {}, call: () => true, callAll: () => {} };
globalThis.ui = { notifications: { info: () => {}, warn: () => {}, error: () => {} } };
globalThis.Handlebars = { escapeExpression: (s) => String(s ?? '') };

const T = await import(pathToFileURL(ROOT + '/scripts/utils/terminalFiles.js').href);
const { SHARED_SCOPE } = T;

// ═══════════════ 1. Pure rules ═══════════════
ok(T.normalizeFolderPath('/records/2046/') === 'records/2046', 'normalize strips slashes');
ok(T.normalizeFolderPath('\\var\\\\spool\\') === 'var/spool', 'normalize handles backslashes + empty segments');
ok(T.normalizeFolderPath('  a / b  ') === 'a/b', 'normalize trims segments');
ok(T.parentPath('a/b/c') === 'a/b' && T.parentPath('a') === '' && T.folderName('a/b/c') === 'c', 'parent/name');
ok(T.ancestorsOf('a/b/c').join(',') === 'a,a/b' && T.ancestorsOf('').length === 0, 'ancestors');
ok(T.isUnder('a/b', 'a') && !T.isUnder('ab', 'a') && T.isUnder('x', ''), 'isUnder');
ok(T.clearanceRank('LEVEL 3') === 3 && T.clearanceRank('L4') === 4 && T.clearanceRank('OMEGA') === null, 'clearance rank = first integer');
ok(T.sanitizeFolder({ scope: 'a1', path: '/records/' }).path === 'records', 'sanitize normalises');
ok(T.sanitizeFolder({ scope: 'a1', path: '' }) === null && T.sanitizeFolder({ path: 'x' }) === null, 'sanitize refuses root / no scope');
ok(T.sanitizeFolder({ scope: 'a1', path: 'x', gate: { mode: 'bogus' } }).gate.mode === 'everyone', 'unknown gate mode → everyone (never a lock)');
const cfgS = T.sanitizeFilesConfig({ folders: [{ scope: 'a1', path: 'x' }, { scope: 'a1', path: '/x/' }, { scope: SHARED_SCOPE, path: 'y' }] });
ok(cfgS.folders.length === 2, 'sanitizeFilesConfig de-dupes scope+path');
ok(T.parseSize('18 KB') === 18432 && T.parseSize('1.5 MB') === 1572864 && T.parseSize('—') === 0, 'parseSize');
ok(T.formatSize(18432) === '18 KB' && T.formatSize(512) === '512 B' && T.formatSize(1.5 * 1024 ** 2) === '1.5 MB', 'formatSize');

const admin = { id: 'root', isAdmin: true, clearance: 'OMEGA' };
const vero = { id: 'v', isAdmin: false, clearance: 'LEVEL 2' };
const guest = { id: 'g', isAdmin: false, clearance: '' };
ok(T.gatePasses({ mode: 'everyone' }, null) && T.gatePasses({ mode: 'admin' }, admin) && !T.gatePasses({ mode: 'admin' }, vero), 'gate admin');
ok(T.gatePasses({ mode: 'clearance', min: 2 }, vero) && !T.gatePasses({ mode: 'clearance', min: 3 }, vero) && !T.gatePasses({ mode: 'clearance', min: 1 }, guest), 'gate clearance (no number never passes)');
ok(T.gatePasses({ mode: 'accounts', accountIds: ['v'] }, vero) && !T.gatePasses({ mode: 'accounts', accountIds: ['v'] }, guest) && T.gatePasses({ mode: 'accounts', accountIds: [] }, admin), 'gate accounts (admin always)');
ok(T.gatePasses({ mode: 'admin' }, guest, { isGM: true }), 'GM passes every gate');

const folders = [
  T.sanitizeFolder({ scope: SHARED_SCOPE, path: 'secure', gate: { mode: 'admin' } }),
  T.sanitizeFolder({ scope: SHARED_SCOPE, path: 'secure/deeper', gate: { mode: 'everyone' } }),
  T.sanitizeFolder({ scope: SHARED_SCOPE, path: 'records' }),
  T.sanitizeFolder({ scope: 'v', path: 'drafts', gate: { mode: 'clearance', min: 3 } }),
];
ok(T.effectiveGate(folders, SHARED_SCOPE, 'secure/deeper').from === 'secure', 'an inner "everyone" does not reopen a locked parent');
ok(T.effectiveGate(folders, SHARED_SCOPE, 'secure/x/y').gate.mode === 'admin', 'a derived folder under a locked one inherits the lock');
ok(T.effectiveGate(folders, SHARED_SCOPE, 'records').gate.mode === 'everyone', 'registered everyone stays open');
ok(!T.canOpenFolder(folders, SHARED_SCOPE, 'secure', vero) && T.canOpenFolder(folders, SHARED_SCOPE, 'secure', admin), 'canOpenFolder');

const mkFile = (id, scope, path, size = '4 KB', extra = {}) => ({ messageId: id, accountId: scope, envelope: 'file', file: { filename: id + '.log', path, size }, status: {}, subject: id, timestamp: '2046-03-01T00:00:00Z', ...extra });
const entries = [
  mkFile('f1', SHARED_SCOPE, 'records', '18 KB'),
  mkFile('f2', SHARED_SCOPE, 'secure', '2 KB'),
  mkFile('f3', SHARED_SCOPE, 'secure/deeper', '1 KB'),
  mkFile('f4', SHARED_SCOPE, '', '1 KB'),
  mkFile('f5', 'v', 'drafts', '9 KB'),
  mkFile('f6', 'v', '', '31 KB'),
  mkFile('f7', 'v', 'cams/east', '3 KB'),           // derived folder, two levels
  mkFile('f8', 'v', '', '5 KB', { status: { deleted: true } }),   // in the Trash → not a live file
  { messageId: 'm1', accountId: 'v', envelope: 'mail', subject: 'hi', status: {}, timestamp: '2046-03-02T00:00:00Z' },
];
const vis = T.visibleEntries(entries, folders, vero);
ok(vis.some(e => e.messageId === 'm1') && vis.some(e => e.messageId === 'f1'), 'visible: mail + open-folder files stay');
ok(!vis.some(e => e.messageId === 'f2') && !vis.some(e => e.messageId === 'f3'), 'visible: files in a locked folder AND under it are gone');
ok(!vis.some(e => e.messageId === 'f5'), 'visible: clearance 2 cannot see a clearance-3 folder');
ok(T.visibleEntries(entries, folders, guest, { isGM: true }).length === entries.length, 'GM sees everything');

const tree = T.buildTree({ entries, folders, scope: 'v', account: vero });
ok(tree.dirs.map(d => d.path).join(',') === 'cams,cams/east,drafts', 'tree: registered ∪ derived ∪ ancestors, sorted');
ok(tree.dirs.find(d => d.path === 'cams').depth === 0 && tree.dirs.find(d => d.path === 'cams/east').depth === 1, 'tree depth');
ok(tree.dirs.find(d => d.path === 'drafts').locked && !tree.dirs.find(d => d.path === 'cams').locked, 'tree lock state per viewer');
ok(tree.files.length === 3 && (tree.byPath.get('') || []).length === 1, 'tree: live files only (deleted excluded), root files by path');
ok(tree.dirs.find(d => d.path === 'cams').deepCount === 1 && tree.dirs.find(d => d.path === 'cams').count === 0, 'deepCount vs direct count');
ok(tree.totalBytes === T.parseSize('9 KB') + T.parseSize('31 KB') + T.parseSize('3 KB'), 'totalBytes');
const lst = T.listingFor(tree, '', { account: vero, folders });
ok(lst.subdirs.map(d => d.path).join(',') === 'cams,drafts' && lst.files.length === 1, 'listing: direct subdirs + direct files');
ok(T.listingFor(tree, 'drafts', { account: vero, folders }).locked && T.listingFor(tree, 'drafts', { account: vero, folders }).files.length === 0, 'listing of a locked folder lists NOTHING');
ok(T.listingFor(tree, 'cams', { account: vero, folders }).crumb.map(c => c.path).join('|') === '|cams', 'breadcrumb');
const plan = T.rewritePlan(entries, SHARED_SCOPE, 'secure', 'vault');
ok(plan.length === 2 && plan.find(p => p.entry.messageId === 'f3').newPath === 'vault/deeper', 'rewritePlan renames the subtree');
ok(T.rewritePlan(entries, SHARED_SCOPE, 'secure', '').find(p => p.entry.messageId === 'f3').newPath === 'deeper', 'rewritePlan to root (delete → files move up)');
ok(T.gateLabel({ mode: 'clearance', min: 3 }) === 'clearance ≥ 3' && T.gateLabel({ mode: 'accounts', accountIds: ['a', 'b'] }) === '2 accounts', 'gateLabel');

// ═══════════════ 2. Real TerminalService over a mocked journal ═══════════════
const { TerminalService } = await import(pathToFileURL(ROOT + '/scripts/services/TerminalService.js').href);
const { DEFAULTS } = await import(pathToFileURL(ROOT + '/scripts/utils/constants.js').href);
const pages = [];
const mkPage = (flags) => { const p = { id: 'p' + pages.length, flags: { [MOD]: flags }, name: flags.subject, update: async (u) => { for (const [k, v] of Object.entries(u)) { const parts = k.split('.'); if (parts[0] !== 'flags') { p[k] = v; continue; } let o = p.flags; for (let i = 1; i < parts.length - 1; i++) { o[parts[i]] = o[parts[i]] || {}; o = o[parts[i]]; } o[parts[parts.length - 1]] = v; } return p; } }; pages.push(p); return p; };
const journal = { pages: { contents: pages, find: (fn) => pages.find(fn) }, createEmbeddedDocuments: async (_, docs) => docs.map(d => mkPage(d.flags[MOD])), deleteEmbeddedDocuments: async (_, ids) => { for (const id of ids) { const i = pages.findIndex(p => p.id === id); if (i >= 0) pages.splice(i, 1); } } };
let cfg = { accounts: [{ id: 'v', username: 'v_arasaka', isAdmin: false, clearance: 'LEVEL 2' }, { id: 'root', username: 'root', isAdmin: true }], files: { folders: [] } };
const item = { id: 'itm', name: 'WS-7F-12', getFlag: (_, k) => (k === 'terminalConfig' ? cfg : k === 'terminalState' ? {} : null), update: async (u) => { if (u[`flags.${MOD}.terminalConfig`]) cfg = u[`flags.${MOD}.terminalConfig`]; } };
const svc = Object.create(TerminalService.prototype);
Object.defineProperty(svc, 'messageRepository', { value: { _pageToMessage: (p) => ({ ...JSON.parse(JSON.stringify(p.flags[MOD])) }) } });
svc._getLinkedJournal = () => journal;
svc._nowIso = () => '2046-03-13T02:14:00Z';

// the real isGM() reads game.user.isGM
const asGM = (v) => { game.user.isGM = v; };
asGM(true);
let r = await svc.addAccountMessage(item, SHARED_SCOPE, { subject: 'readme', envelope: 'file', file: { filename: 'readme.txt', path: '/pub//' }, body: '' });
ok(r.success, 'addAccountMessage accepts the shared scope');
ok(pages[0].flags[MOD].accountId === SHARED_SCOPE && pages[0].flags[MOD].file.path === 'pub', 'shared page tagged + path normalised at write');
r = await svc.addAccountMessage(item, 'nope', { subject: 'x' });
ok(!r.success, 'addAccountMessage still refuses an unknown account');
await svc.addAccountMessage(item, 'v', { subject: 'payroll', envelope: 'file', file: { filename: 'q3.xls', path: 'home-docs', size: '31 KB' } });
await svc.addAccountMessage(item, 'v', { subject: 'mail1', envelope: 'mail', from: 'hr@arasaka.nc' });
await svc.addAccountMessage(item, SHARED_SCOPE, { subject: 'vault', envelope: 'file', file: { filename: 'vault.key', path: 'secure', size: '2 KB' } });
await svc.addAccountMessage(item, 'root', { subject: 'rootmail', envelope: 'mail' });

r = await svc.saveFileFolder(item, { scope: SHARED_SCOPE, path: 'secure', gate: { mode: 'admin' } });
ok(r.success && cfg.files.folders.length === 1 && cfg.files.folders[0].gate.mode === 'admin', 'saveFileFolder registers a gated folder in config.files');
r = await svc.saveFileFolder(item, { scope: SHARED_SCOPE, path: '/secure/', gate: { mode: 'clearance', min: 4 } });
ok(cfg.files.folders.length === 1 && cfg.files.folders[0].gate.mode === 'clearance', 'saveFileFolder upserts by scope+path');

let list = svc.getAccountMessages(item, 'v');
ok(list.length === 4, 'GM read: own entries + every shared entry');
ok(list.find(m => m.subject === 'readme').shared === true && list.find(m => m.subject === 'payroll').shared === false, 'shared flag stamped on messages');
asGM(false);
list = svc.getAccountMessages(item, 'v');
ok(list.length === 3 && !list.some(m => m.subject === 'vault'), 'player read: the clearance-4 folder\'s file is gone for LEVEL 2');
list = svc.getAccountMessages(item, 'root');
ok(list.some(m => m.subject === 'vault'), 'admin account sees the gated file');
ok(svc.getAccountMessages(item, 'v', { includeShared: false }).length === 2, 'includeShared:false = own only');
ok(!svc.getAccountMessages(item, 'v').some(m => m.subject === 'rootmail'), 'another account\'s mail never leaks');
asGM(true);
ok(svc.getSharedMessages(item).length === 2 && svc.getAllMessages(item).length === 5, 'getSharedMessages / getAllMessages');

asGM(false);
const vt = svc.buildFileTree(item, SHARED_SCOPE, 'v');
ok(vt.dirs.map(d => d.path).join(',') === 'pub,secure' && vt.dirs.find(d => d.path === 'secure').locked, 'buildFileTree for the shared volume, locked for v (as a player)');
asGM(true);
ok(!svc.buildFileTree(item, SHARED_SCOPE, 'v').dirs.find(d => d.path === 'secure').locked, 'the GM sees the same folder unlocked');
ok(svc.canOpenFolder(item, SHARED_SCOPE, 'secure', 'root') === true, 'canOpenFolder(root) on the admin gate');
asGM(false);
ok(svc.canOpenFolder(item, SHARED_SCOPE, 'secure', 'v') === false, 'canOpenFolder(v) refused as a player');
asGM(true);

r = await svc.renameFileFolder(item, SHARED_SCOPE, 'secure', 'vault');
ok(r.success && r.moved === 1 && pages.find(p => p.flags[MOD].subject === 'vault').flags[MOD].file.path === 'vault', 'renameFileFolder rewrites the file path');
ok(cfg.files.folders.some(f => f.path === 'vault') && !cfg.files.folders.some(f => f.path === 'secure'), 'renameFileFolder moves the registry row (gate kept)');
ok(cfg.files.folders.find(f => f.path === 'vault').gate.mode === 'clearance', 'gate survives the rename');
r = await svc.moveFile(item, pages.find(p => p.flags[MOD].subject === 'payroll').flags[MOD].messageId, { scope: SHARED_SCOPE, path: 'vault/old' });
ok(r.success && pages.find(p => p.flags[MOD].subject === 'payroll').flags[MOD].accountId === SHARED_SCOPE, 'moveFile re-homes an entry onto the shared volume');
ok(pages.find(p => p.flags[MOD].subject === 'payroll').flags[MOD].file.path === 'vault/old', 'moveFile re-files it');
r = await svc.moveFile(item, 'nope', { scope: SHARED_SCOPE, path: '' });
ok(!r.success, 'moveFile reports a missing entry');
r = await svc.removeFileFolder(item, SHARED_SCOPE, 'vault');
ok(r.success && r.moved === 2, 'removeFileFolder moves every file up a level');
ok(pages.find(p => p.flags[MOD].subject === 'vault').flags[MOD].file.path === '' && pages.find(p => p.flags[MOD].subject === 'payroll').flags[MOD].file.path === 'old', 'files landed one level up (subtree kept its shape)');
ok(!cfg.files.folders.some(f => f.path === 'vault'), 'registry row removed');
r = await svc.removeFileFolder(item, SHARED_SCOPE, '');
ok(!r.success, 'the root cannot be deleted');
r = await svc.updateAccountMessage(item, pages[0].flags[MOD].messageId, { accountId: 'v', file: { path: '/moved/' } });
ok(r.success && pages[0].flags[MOD].accountId === 'v' && pages[0].flags[MOD].file.path === 'moved', 'updateAccountMessage accepts accountId + file (path normalised)');
asGM(false);
r = await svc.saveFileFolder(item, { scope: 'v', path: 'x' });
ok(!r.success, 'saveFileFolder is GM-only');
asGM(true);

// ═══════════════ 3. Wiring guards ═══════════════
const consts = read('scripts/utils/constants.js');
ok(consts.includes("TERMINAL_CONFIG_CONTENT: `${T}/terminal/partials/config-content.hbs`"), 'config-content partial registered in TEMPLATES');
ok(fs.existsSync(`${ROOT}/templates/terminal/partials/config-content.hbs`), 'config-content.hbs exists');
ok(/files: \{ folders: \[\] \}/.test(consts), 'DEFAULTS.TERMINAL_CONFIG.files default');
ok(/customSeconds: null,\s+\/\/ whole-boot length in seconds when speed === 'custom'/.test(consts), 'terminal boot customSeconds default');

const viewer = read('scripts/ui/Terminal/TerminalViewerApp.js');
// 2026-10-25: the detail pane / FILES tree / list rows live in templates/terminal/mailbox/ (shared by the mailbox styles)
const vhbs = ['templates/terminal/terminal-viewer.hbs', 'templates/terminal/mailbox/detail.hbs', 'templates/terminal/mailbox/tree.hbs', 'templates/terminal/mailbox/rows.hbs'].map(read).join('\n');
for (const a of ['terminalView', 'terminalFsOpen', 'terminalFsBack']) {
  ok(viewer.includes(`${a}: action(`) && vhbs.includes(`data-action="${a}"`), `viewer action ${a} wired in JS + template`);
}
ok(!viewer.includes('_envFilter') && !vhbs.includes('terminalEnvFilter') && !vhbs.includes('activeEnvFilter'), 'the old MAIL/FILES solo filter is fully gone');
ok(viewer.includes('static BOOT_SPEED_MULT') && viewer.includes("boot.speed === 'custom'") && !/\}, 2100\);/.test(viewer), 'boot speed honoured (no literal 2100 hold)');
ok(vhbs.includes('{{#if fs.showListing}}') && vhbs.includes('{{else if selectedMessage}}'), 'listing branch precedes the message detail');
ok(vhbs.includes('data-locked="1"') && vhbs.includes('data-lock-label'), 'locked folders carry their reason into the DOM');
ok(viewer.includes("target.dataset.locked === '1'"), '_onFsOpen refuses a locked folder');

const cfgApp = read('scripts/ui/Terminal/TerminalConfigApp.js');
const cfgHbs = read('templates/terminal/terminal-config.hbs');
const partial = read('templates/terminal/partials/config-content.hbs');
for (const a of ['ctToggle', 'ctDirToggle', 'ctMailToggle', 'ctFolderFocus', 'ctFolderAddSub', 'ctFolderRename', 'ctFolderRemove', 'ctGateAccounts', 'ctAdd', 'ctEntryEdit', 'ctEntryDelete', 'ctOpenTerminal']) {
  ok(cfgApp.includes(`${a}: TerminalConfigApp._on`) && (cfgHbs.includes(`data-action="${a}"`) || partial.includes(`data-action="${a}"`)), `config action ${a} wired`);
}
for (const sel of ['data-ct-gate', 'data-ct-gatemin', 'data-ct-move', 'data-ct-newdir']) {
  ok(partial.includes(sel) && cfgApp.includes(`[${sel}]`), `config select/input ${sel} has a manual listener`);
}
ok(cfgApp.includes('_wireContentTab(el)') && cfgApp.includes('buildContentContext('), 'config builds + wires the content blocks');
ok(cfgHbs.includes('{{#with content.shared}}') && cfgHbs.includes('{{#with ct}}'), 'config template renders shared + per-account blocks');
ok(cfgApp.includes("speedOptions: ['fast', 'normal', 'dramatic', 'custom']") && cfgHbs.includes('name="bootCustomSeconds"'), 'config offers custom boot seconds');

const comp = read('scripts/ui/ItemInbox/DataShardComposer.js');
const chbs = read('templates/item-inbox/data-shard-composer.hbs');
ok(chbs.includes('name="fileScope"') && chbs.includes('data-store-of="account"') && chbs.includes('data-store-of="shared"') && chbs.includes('data-file-newdir'), 'composer Store-on + Folder controls present');
ok(comp.includes('storeSeg: DataShardComposer._onStoreSeg') && comp.includes("data.fileScope === 'shared'") && comp.includes('entryData.accountId ='), 'composer collects scope + folder into entryData');
ok(comp.includes('saveFileFolder?.(this._item') , 'composer registers a brand-new folder on save');
ok(chbs.includes('{{#if fileStore.isTerminal}}') && chbs.includes('name="filePath"'), 'shard targets keep the plain path box');
ok(/data-env-only="mail">\s*<label class="ncm-config-label">Folder<\/label>/.test(chbs), 'the mail Folder select is mail-only');

const css = read('styles/components/terminal.css');
ok(css.includes('.ncm-term__fs-view') && css.includes('.ncm-term__fs-tree') && css.includes('.ncm-term__fs-table') && css.includes('.ncm-acctl-dir') && css.includes('.ncm-acctl-ent-row'), 'viewer + config CSS blocks present');
ok(!/--ncm-text-muted: #555570;/.test(css) && /--ncm-text-muted: #8e8ea8;/.test(css), 'terminal base muted token raised');
ok((css.match(/--ncm-text-muted: #[0-9a-f]{6};/g) || []).length >= 6, 'every CSS preset rule carries a muted colour');
const tpBlock = consts.slice(consts.indexOf('export const TERMINAL_PRESETS'), consts.indexOf('export const TERMINAL_PRESETS') + 20000).split('\nexport const ')[0];
ok((tpBlock.match(/textMuted: '#[0-9a-f]{6}'/g) || []).length === 12, 'all 12 TERMINAL_PRESETS carry textMuted');
ok(css.includes("'Add message or file (GM)'") || vhbs.includes('Add message or file (GM)'), 'the sidebar button says message OR file');
// no literal brand hex in the new CSS blocks (tokens only) — the fallback form var(--x, #hex) is allowed
const newBlocks = css.slice(css.indexOf('FILE REPOSITORY (2026-10-25'));
ok(!/(^|[^,(\s])\s*#(19f3f7|2a2a45|1a1a2e|555570|F65261|f7c948)\b/i.test(newBlocks.replace(/var\([^)]*\)/g, '')), 'new CSS uses tokens only');
// A sim-level guard against the sweep rule: nothing else filters pages by a bare accountId.
const svcSrc = read('scripts/services/TerminalService.js');
ok((svcSrc.match(/flags\?\.\[MODULE_ID\]\?\.accountId === accountId/g) || []).length === 0, 'the old bare accountId page filter is gone (shared-aware reader only)');
ok(read('scripts/tests/Phase6Verification.js').includes("'6.18'"), 'Phase 6 gained 6.18');
// Dev live-test revisions (2026-10-25 pm)
ok(/ncm-acctl-row\{\{#if ct\.open\}\} is-open\{\{\/if\}\}" data-action="ctToggle"/.test(cfgHbs), 'account row click folds the content open (the pen edits)');
ok(cfgApp.includes('async _preRender(') && cfgApp.includes('[data-ct-scroll]') && cfgApp.includes('_scrollReset'), 'config sheet remembers scroll across renders');
ok(partial.includes('{{#*inline "ncmCtFile"}}') && partial.includes('data-ct-scroll="{{scope}}:{{path}}"') && partial.includes('data-ct-scroll="{{scope}}:mail:{{id}}"'), 'per-folder scrollers in the content partial');
ok(css.includes('.ncm-acctl-scroll {') && css.includes(':has(.ncm-acct-editor)'), 'scroller + flush sticky footer CSS');
ok(viewer.includes("tree: el.querySelector('.ncm-term__fs-tree')") && viewer.includes('memo.fsKey'), 'viewer FILES tree/listing keep their scroll');
ok(chbs.includes('class="ncm-envpick"') && chbs.includes('data-cmp-chip="env"') && !chbs.includes('>Show as<'), 'composer asks message-or-file up front');
ok(comp.includes("set('env', isFile"), 'composer summary chip names the envelope');
// Boot VIDEO (2026-10-25)
ok(fs.existsSync(`${ROOT}/scripts/ui/content/BootVideo.js`) && fs.existsSync(`${ROOT}/styles/components/boot-video.css`) && read('styles/night-city-messenger.css').includes("components/boot-video.css"), 'BootVideo module + stylesheet registered');
ok(viewer.includes("import { playBootVideo }") && viewer.includes('bootCfg.videoUrl') && viewer.includes('this._bootVideo?.destroy'), 'terminal viewer plays and tears down the boot video');
ok(read('scripts/ui/ItemInbox/ItemInboxApp.js').includes("import { playBootVideo }") && read('scripts/ui/ItemInbox/ItemInboxApp.js').includes('config.videoUrl'), 'shard viewer plays the boot video');
ok(read('templates/terminal/terminal-boot.hbs').includes('{{#if boot.isVideo}}') && cfgHbs.includes('name="bootVideoUrl"') && read('templates/item-inbox/item-inbox-config.hbs').includes('name="bootVideoUrl"'), 'boot video authorable on both config sheets');
ok(cfgApp.includes("videoUrl: val('bootVideoUrl')") && read('scripts/ui/ItemInbox/ItemInboxConfig.js').includes("videoUrl: val('bootVideoUrl')"), 'both config saves persist the video');
ok(/videoUrl: null,\s+\/\/ a video as the boot screen/.test(consts) && /videoUrl: '',\s+\/\/ a video as the boot screen/.test(consts), 'defaults carry videoUrl on shard + terminal');
ok(partial.includes('data-action="ctTab"') && partial.includes('{{#if tabMail}}') && partial.includes('{{#if tabFiles}}') && cfgApp.includes('ctTab: TerminalConfigApp._onCtTab') && cfgApp.includes('_ctTab'), 'MAIL | FILES tabs inside the account fold');

console.log(`\n${fail ? '⚠️' : '✅'} test-terminal-files: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
