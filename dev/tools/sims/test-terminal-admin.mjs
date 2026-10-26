// Sim: terminal ADMIN ACCESS (2026-10-26, tester: "Admin should be able to
// browse the accounts… like View As User"). Drives the pure rules
// (utils/terminalAdmin.js), the REAL TerminalService + TerminalViewerApp methods
// via prototype.call over mocked documents, renders the real partials through
// Foundry's Handlebars, and guards the wiring.
// Run: node dev/tools/sims/test-terminal-admin.mjs
import fs from 'fs';
import { createRequire } from 'module';
import { pathToFileURL, fileURLToPath } from 'url';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const MOD = 'night-city-messenger';
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };
const read = (p) => fs.readFileSync(`${ROOT}/${p}`, 'utf8');
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);

const deepClone = (o) => (o === undefined ? o : JSON.parse(JSON.stringify(o)));
globalThis.game = { user: { isGM: false }, users: { activeGM: {} }, settings: { get: () => undefined }, nightcity: {}, actors: { get: () => null }, journal: { contents: [] } };
globalThis.foundry = { utils: { deepClone, mergeObject: (a, b, { inplace = true } = {}) => { const out = inplace ? a : deepClone(a); const m = (t, s) => { for (const [k, v] of Object.entries(s || {})) { if (v && typeof v === 'object' && !Array.isArray(v) && t[k] && typeof t[k] === 'object' && !Array.isArray(t[k])) m(t[k], v); else t[k] = v; } return t; }; return m(out, b); }, randomID: () => Math.random().toString(36).slice(2, 10) } };
globalThis.Hooks = { on: () => {}, once: () => {}, off: () => {}, call: () => true, callAll: () => {} };
globalThis.ui = { notifications: { info: () => {}, warn: () => {}, error: () => {} } };

// ═══ 1. Pure rules ═══
const A = await imp('scripts/utils/terminalAdmin.js');
const C = await imp('scripts/utils/constants.js');
ok(JSON.stringify(A.resolveAdminAccess({})) === JSON.stringify({ browse: true, seeHidden: true, rights: 'full' }), 'defaults: browse on, see hidden on, full rights');
ok(A.resolveAdminAccess({ adminAccess: { browse: false, seeHidden: false, rights: 'read' } }).rights === 'read', 'read-only resolves');
ok(A.resolveAdminAccess({ adminAccess: { rights: 'bogus' } }).rights === 'full', 'unknown rights → full');
ok(A.adminLabelFor({ theme: { preset: 'retro-dos' } }, C.TERMINAL_PRESETS) === 'SYSOP', 'preset label');
ok(A.adminLabelFor({ theme: { preset: 'retro-dos', adminLabel: 'night shift key' } }, C.TERMINAL_PRESETS) === 'NIGHT SHIFT KEY', 'theme label wins, upper-cased');
ok(A.adminLabelFor({ theme: { preset: 'classic' } }, C.TERMINAL_PRESETS) === 'ADMIN OVERRIDE', 'no preset label → default');
ok(A.adminLabelFor({}, C.TERMINAL_PRESETS) === 'ADMIN OVERRIDE', 'no theme → default');
ok(A.adminLabelFor({ theme: { adminLabel: 'x'.repeat(40) } }, {}).length === 24, 'label capped at 24');
ok(Object.entries(C.TERMINAL_PRESETS).every(([, p]) => typeof p.adminLabel === 'string' && p.adminLabel), 'every built-in theme carries a label');
ok(JSON.stringify(C.DEFAULTS.TERMINAL_CONFIG.adminAccess) === JSON.stringify(A.ADMIN_ACCESS_DEFAULTS), 'DEFAULTS mirror the module defaults');
ok(C.DEFAULTS.TERMINAL_ACCOUNT.privateFromAdmin === false, 'account default: not private');

const root = { id: 'root', username: 'sysadmin', isAdmin: true };
const mr = { id: 'mr', username: 'mreyes' };
const jc = { id: 'jc', username: 'jchen', hidden: true };
const ceo = { id: 'ceo', username: 'ceo_private', privateFromAdmin: true };
const off = { id: 'off', username: 'offnet', network: { restricted: true } };
const cfg = { accounts: [root, mr, jc, ceo, off] };
const vis = (a) => !a.network?.restricted;
ok(A.adminViewVerdict(cfg, root, mr, { visible: vis }).ok, 'admin views a normal account');
ok(!A.adminViewVerdict(cfg, mr, jc, { visible: vis }).ok, 'a non-admin views nobody');
ok(!A.adminViewVerdict(cfg, root, root).ok, 'not your own account');
ok(A.adminViewVerdict(cfg, root, jc, { visible: vis }).ok, 'hidden account viewable by default');
ok(!A.adminViewVerdict({ ...cfg, adminAccess: { seeHidden: false } }, root, jc, { visible: vis }).listed, 'see-hidden off → hidden not even listed');
const pv = A.adminViewVerdict(cfg, root, ceo, { visible: vis });
ok(!pv.ok && pv.listed && /private/.test(pv.reason), 'private: listed dead, with its reason');
ok(!A.adminViewVerdict(cfg, root, off, { visible: vis }).listed, 'an unreachable (net-gated) account is not listed');
ok(!A.adminViewVerdict({ ...cfg, adminAccess: { browse: false } }, root, mr).ok, 'browse off → nothing viewable');
ok(A.adminViewTargets(cfg, root, { visible: vis }).map((r) => r.account.id).join() === 'mr,jc,ceo', 'View-as list: others, hidden, private; not self, not unreachable');
ok(A.adminReadOnlyBlocks('wipe') && !A.adminReadOnlyBlocks('agent') && !A.adminReadOnlyBlocks('shard'), 'read-only blocks wipe only');

// ═══ 2. Real TerminalService ═══
const { TerminalService } = await imp('scripts/services/TerminalService.js');
const SH = '__shared__';
const page = (id, accountId, extra = {}) => ({ flags: { [MOD]: { messageId: id, accountId, subject: id, status: {}, timestamp: '2045-01-01T00:00:00Z', ...extra } } });
const pages = [
  page('m-mr', 'mr'), page('f-mr', 'mr', { envelope: 'file', file: { path: 'drafts', filename: 'a.txt' } }),
  page('f-sec', SH, { envelope: 'file', file: { path: 'secure', filename: 'vault.key' } }),
  page('m-root', 'root'),
];
let tcfg = { accounts: [root, mr, jc, ceo], files: { folders: [{ id: 'g1', scope: SH, path: 'secure', gate: { mode: 'admin' } }] } };
const item = { id: 't', name: 'WS', getFlag: (_, k) => (k === 'terminalConfig' ? tcfg : k === 'terminalState' ? {} : k === 'isTerminal' ? true : null) };
const svc = Object.create(TerminalService.prototype);
Object.defineProperty(svc, 'messageRepository', { value: { _pageToMessage: (p) => deepClone(p.flags[MOD]) } });
svc._getLinkedJournal = () => ({ pages: { contents: pages } });
svc.isContentVisible = () => true;
const ids = (list) => list.map((m) => m.messageId).sort().join();
ok(ids(svc.getAccountMessages(item, 'mr')) === 'f-mr,m-mr', "mreyes's own read: the locked shared folder is out");
ok(ids(svc.getAccountMessages(item, 'mr', { gateAccountId: 'root' })) === 'f-mr,f-sec,m-mr', "admin viewing mreyes: mreyes's entries, folders opened with the admin's rights");
ok(!svc.getAccountMessages(item, 'mr', { gateAccountId: 'root' }).some((m) => m.accountId === 'root'), "viewing never leaks the admin's own mail into the view");
ok(svc.adminViewVerdict(item, 'root', 'mr').ok && !svc.adminViewVerdict(item, 'mr', 'root').ok, 'service verdict');
ok(svc.adminViewTargets(item, 'root').length === 3, 'service targets');
tcfg = { ...tcfg, adminAccess: { browse: false } };
ok(!svc.adminViewVerdict(item, 'root', 'mr').ok, 'service honours browse off');
tcfg = { ...tcfg, adminAccess: undefined };

// ═══ 3. Real TerminalViewerApp methods ═══
globalThis.foundry.applications = { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (B) => class extends B {} } };
let V = null;
try { ({ TerminalViewerApp: V } = await imp('scripts/ui/Terminal/TerminalViewerApp.js')); } catch (e) { console.error('viewer import failed:', e.message); }
if (V) {
  const v = Object.create(V.prototype);
  Object.defineProperty(v, 'terminalService', { value: svc });
  v.item = item; v._accountId = 'root'; v._viewAs = null;
  v._effectiveConfig = () => svc.getConfig(item);
  v._terminalName = () => 'WS'; v._accountPortrait = () => null; v.render = () => {}; v._playTermSound = () => {};
  ok(V.prototype._boxId.call(v) === 'root', 'box = own account when not viewing');
  v._viewAs = 'mr';
  ok(V.prototype._boxId.call(v) === 'mr', 'box = the viewed account');
  ok(ids(V.prototype._boxMessages.call(v)) === 'f-mr,f-sec,m-mr', 'box messages use the admin rights');
  ok(!V.prototype._adminReadOnly.call(v, 'wipe'), 'full rights: wipe allowed');
  tcfg = { ...tcfg, adminAccess: { rights: 'read' } };
  ok(V.prototype._adminReadOnly.call(v, 'wipe') && !V.prototype._adminReadOnly.call(v, 'agent'), 'read-only: wipe blocked, download allowed');
  const bar = V.prototype._adminViewContext.call(v, svc.getConfig(item));
  ok(bar && bar.username === 'mreyes' && bar.readOnly && bar.label === 'ADMIN OVERRIDE', 'banner view-model');
  v._viewAs = null; tcfg = { ...tcfg, adminAccess: undefined };
  ok(V.prototype._adminViewContext.call(v, svc.getConfig(item)) === null, 'no banner when not viewing');
  ok(V.prototype._adminTargetsContext.call(v).map((t) => `${t.id}:${t.ok}`).join() === 'mr:true,jc:true,ceo:false', 'switcher list: private listed dead');
  v._accountId = 'mr';
  ok(V.prototype._adminTargetsContext.call(v).length === 0 && V.prototype._otherHomesContext.call(v).length === 0, 'a non-admin gets no list and no other homes');
  v._accountId = 'root'; v._viewAs = 'mr';
  const homes = V.prototype._otherHomesContext.call(v);
  ok(homes[0].isBack && homes[0].tag === 'YOU' && !homes.some((h) => h.id === 'mr'), 'other homes: YOU first (back), not the one on screen');
  // start / stop
  v._viewAs = null; v.actor = null; let logged = null;
  game.nightcity.traceService = { logSuccess: (o) => { logged = o; } };
  V.prototype._startAdminView.call(v, 'ceo');
  ok(v._viewAs === null, 'cannot start viewing a private account');
  V.prototype._startAdminView.call(v, 'mr', { files: true });
  ok(v._viewAs === 'mr' && v._view === 'files', 'start viewing (straight into FILES)');
  ok(logged?.action === 'admin-view' && /sysadmin viewed mreyes/.test(logged.source) && logged.severity === 'minor', 'logged to the Activity Log as the admin, no heat severity');
  V.prototype._onAdminBack.call(v);
  ok(v._viewAs === null, 'back to my account');
} else { fail++; }

// ═══ 4. The real partials through Foundry's Handlebars ═══
let Handlebars = null;
for (const p of ['C:/Program Files/Foundry Virtual Tabletop/resources/app/package.json', 'C:/Program Files (x86)/Foundry Virtual Tabletop/resources/app/package.json']) {
  if (!fs.existsSync(p)) continue;
  try { Handlebars = createRequire(p)('handlebars'); break; } catch { /* keep looking */ }
}
if (Handlebars) {
  const bar = Handlebars.compile(read('templates/terminal/partials/admin-bar.hbs'));
  const h1 = bar({ adminView: { label: 'SYSOP', username: 'mreyes', initials: 'MR', readOnly: true } });
  ok(/SYSOP/.test(h1) && /READ-ONLY/.test(h1) && /terminalAdminBack/.test(h1) && /terminalAdminPick/.test(h1), 'banner renders label, rights and both buttons');
  const h2 = bar({ msTty: true, adminView: { label: 'SYSOP', username: 'mreyes', readOnly: false } });
  ok(/adminbar--tty/.test(h2) && /exit/.test(h2) && !/terminalAdminPick/.test(h2), 'TTY variant is a session line');
  const list = Handlebars.compile(read('templates/terminal/partials/admin-view-list.hbs'));
  const h3 = list({ adminView: { label: 'X' }, adminTargets: [{ id: 'mr', displayName: 'Marisol', initials: 'MR', ok: true }, { id: 'ceo', displayName: 'ceo', initials: 'C', ok: false, reason: 'private from admin' }, { id: 'jc', displayName: 'Jae', initials: 'J', ok: true, hidden: true }] });
  ok(/VIEW AS ADMIN/.test(h3) && /data-account-id="mr"/.test(h3) && !/data-account-id="ceo"/.test(h3) && /HIDDEN/.test(h3) && /Back to my account/.test(h3), 'View-as list: viewable rows act, private is dead, hidden tagged, back row while viewing');
  ok(list({ adminTargets: [] }).trim() === '', 'no list for a non-admin');
} else { fail++; console.error('FAIL: Handlebars not found'); }

// ═══ 5. Wiring ═══
const viewer = read('scripts/ui/Terminal/TerminalViewerApp.js');
for (const a of ['terminalAdminView', 'terminalAdminBack', 'terminalAdminPick']) ok(new RegExp(`${a}: action\\(`).test(viewer), `action ${a} registered`);
ok((viewer.match(/getAccountMessages\(this\.item, this\._accountId\)/g) || []).length === 1 && /const msgs = this\.terminalService\?\.getAccountMessages\(this\.item, this\._accountId\)/.test(viewer), 'every content read goes through _boxMessages (only the own-login "new since" count reads the login directly)');
ok(/isAdmin: !!this\.terminalService\?\.getAccount\(this\.item, this\._accountId\)\?\.isAdmin/.test(viewer), 'HUD ADMIN chip reads the logged-in account');
ok(/su\\s\+/.test(viewer) && /lower === 'exit' && this\._viewAs/.test(viewer), 'TTY su / exit');
const tv = read('templates/terminal/terminal-viewer.hbs');
ok(/admin-bar\.hbs/.test(tv), 'banner included under the HUD');
for (const f of ['templates/terminal/terminal-viewer.hbs', 'templates/terminal/mailbox/tabs.hbs', 'templates/terminal/mailbox/desktop.hbs']) ok(/admin-view-list\.hbs/.test(read(f)), `${f}: View-as list in the switcher`);
ok(/fs\.otherHomes/.test(read('templates/terminal/mailbox/tree.hbs')) && /fs\.otherHomes/.test(read('templates/terminal/mailbox/desktop.hbs')), 'other homes in the tree + desktop');
ok(/TERMINAL_ADMIN_BAR/.test(read('scripts/utils/constants.js')) && /TERMINAL_ADMIN_LIST/.test(read('scripts/utils/constants.js')), 'partials registered in TEMPLATES');
const css = read('styles/components/terminal.css');
for (const c of ['ncm-term__adminbar', 'ncm-term__acdrop-hd--admin', 'ncm-term__fs-home', 'ncm-cfg-adminlabel', 'ncm-term-cfg-tag--private']) ok(css.includes(`.${c}`), `css .${c}`);
const cfgHbs = read('templates/terminal/terminal-config.hbs');
const cfgApp = read('scripts/ui/Terminal/TerminalConfigApp.js');
ok(/data-ttc-adminlabel/.test(cfgHbs) && /draft\.adminLabel = v/.test(cfgApp), 'Theme tab edits the label (draft key)');
ok(/data-tab="theme" data-focus="\[data-ttc-adminlabel\]"/.test(cfgHbs) && /target\.dataset\.focus/.test(cfgApp), 'Admin access names it and links to the field');
ok(/'fontTitle', 'adminLabel'\]\) delete draft/.test(cfgApp), 'a preset card clears a custom label');
ok(/name="adminBrowse"/.test(cfgHbs) && /name="adminSeeHidden"/.test(cfgHbs) && /name="adminRights"/.test(cfgHbs) && /v\('adminRights'\) \? \{ adminAccess:/.test(cfgApp), 'Admin access save contract (and only when on screen)');
ok(/name="acctPrivateAdmin"/.test(read('templates/terminal/partials/config-account.hbs')) && /privateFromAdmin: chk\('acctPrivateAdmin'\)/.test(cfgApp), 'per-account private checkbox saves');
ok(/&amp; admin label/.test(cfgHbs), 'saved-themes heading says the label travels');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
