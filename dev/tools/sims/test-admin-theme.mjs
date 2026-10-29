// Sim: admin theme carry-over (utils/adminTheme.js + BaseApplication hooks)
// + the player-window Dialog wrappers (zoomed by the player's Text Size).
// Drives the REAL wrappers/stamp/zoom/hook with mocked Foundry globals.
import { pathToFileURL, fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };

// ── Minimal Foundry globals ──
const settings = { adminTheme: { preset: 'clean-light', textScale: 130 } };
globalThis.game = { settings: { get: (m, k) => settings[k] }, user: { isGM: true } };
const hooks = {};
globalThis.Hooks = { on: (n, fn) => { (hooks[n] ??= []).push(fn); }, once() {}, off() {} };
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
class FakeDialog {
  constructor(data, options = {}) { this.data = data; this.options = { classes: ['dialog'], ...options }; FakeDialog.made.push(this); }
  static confirm(cfg) { return new FakeDialog(cfg, cfg.options); }
  static prompt(cfg) { return new FakeDialog(cfg, cfg.options); }
  static wait(data, options) { return new FakeDialog(data, options); }
}
FakeDialog.made = [];
globalThis.Dialog = FakeDialog;
// A bare-bones element double (no jsdom): dataset + style + querySelector.
class El {
  constructor() { this.dataset = {}; this.style = {}; this.content = { style: {} }; this.offsetWidth = 400; }
  querySelector(sel) { return sel === '.window-content' ? this.content : null; }
}
globalThis.HTMLElement = El;
const rootStyle = { vars: { '--ncm-text-scale-base': '1.2' }, getPropertyValue(k) { return this.vars[k] ?? ''; } };
globalThis.document = { documentElement: { style: rootStyle }, activeElement: null };

const M = await import(pathToFileURL(`${ROOT}/scripts/utils/adminTheme.js`).href);

// ═══ prefs ═══
ok(M.getAdminThemePrefs().preset === 'clean-light' && M.getAdminThemePrefs().textScale === 130, 'reads client prefs');
settings.adminTheme = { preset: 'clean-dark', textScale: 999 };
ok(M.getAdminThemePrefs().textScale === 150, 'text scale clamps to 150');
settings.adminTheme = {};
ok(M.getAdminThemePrefs().preset === 'clean-dark' && M.getAdminThemePrefs().textScale === 100, 'defaults when unset');
settings.adminTheme = { preset: 'clean-light', textScale: 130 };

// ═══ stamp + zoom ═══
const el = new El();
M.stampAdminTheme(el);
ok(el.dataset.ncmAdminTheme === 'clean-light', 'stamps the preset attribute');
ok(el.dataset.ncmScanlines === 'false' && el.dataset.ncmNeon === 'false', 'forces atmosphere off');
M.applyAdminZoom(el.content, 130);
ok(el.content.style.zoom === '1.3', 'zoom 130% → 1.3');
M.applyAdminZoom(el.content, 100);
ok(el.content.style.zoom === '', 'zoom 100% clears the inline value');
M.applyAdminZoom(null, 130);
ok(true, 'null content is a no-op');

// ═══ Dialog wrappers ═══
const d1 = M.adminDialog({ title: 'x' });
ok(d1.options.classes.join(' ') === 'dialog ncm-admin-dialog', 'adminDialog: default classes + admin tag');
const d2 = M.adminDialog({ title: 'x' }, { classes: ['ncm-pick-dialog'], width: 300 });
ok(d2.options.classes.join(' ') === 'ncm-pick-dialog ncm-admin-dialog' && d2.options.width === 300, 'adminDialog: existing classes kept, options preserved');
const d3 = M.adminDialog({}, { classes: ['dialog', 'ncm-admin-dialog'] });
ok(d3.options.classes.filter(c => c === 'ncm-admin-dialog').length === 1, 'tag not duplicated');
const d4 = M.adminConfirm({ title: 'c', content: '<p/>', options: { classes: ['ncm-burn-dialog'] } });
ok(d4.options.classes.includes('ncm-admin-dialog') && d4.options.classes.includes('ncm-burn-dialog'), 'adminConfirm merges cfg.options.classes');
const d5 = M.adminConfirm({ title: 'c' });
ok(d5.options.classes.join(' ') === 'dialog ncm-admin-dialog', 'adminConfirm without options');
const d6 = M.adminPrompt({ title: 'p', options: { width: 500 } });
ok(d6.options.width === 500 && d6.options.classes.includes('ncm-admin-dialog'), 'adminPrompt keeps width');
const d7 = M.adminWait({}, {});
ok(d7.options.classes.includes('ncm-admin-dialog'), 'adminWait tags');

// ═══ renderDialog hook ═══
M.registerAdminDialogHook();
ok(hooks.renderDialog?.length === 1, 'hook registered');
const fire = (app) => hooks.renderDialog[0](app);
const tagged = { options: { classes: ['dialog', 'ncm-admin-dialog'] }, element: [new El()], position: { width: 400 }, setPosition(p) { this.position = { ...this.position, ...p }; } };
fire(tagged);
ok(tagged.element[0].dataset.ncmAdminTheme === 'clean-light', 'tagged dialog gets the preset');
ok(tagged.element[0].content.style.zoom === '1.3', 'tagged dialog gets the zoom');
ok(tagged.position.width === 520, 'dialog width grows once by the ratio (400 → 520)');
fire(tagged);
ok(tagged.position.width === 520, 're-render does not grow it again');
const plain = { options: { classes: ['dialog', 'ncm-burn-dialog'] }, element: [new El()], position: { width: 400 }, setPosition() { throw new Error('should not resize'); } };
fire(plain);
ok(plain.element[0].dataset.ncmAdminTheme === undefined, 'untagged (player) dialog untouched');
fire({ options: null });
ok(true, 'malformed app is a no-op');

// ═══ Player-window Dialog wrappers (2026-10-21: "pop-up windows still not resizing for text") ═══
ok(M.getPlayerTextScale() === 120, 'player text scale read from :root --ncm-text-scale-base (1.2 → 120)');
rootStyle.vars['--ncm-text-scale-base'] = '3';
ok(M.getPlayerTextScale() === 150, 'player scale clamps to the slider max');
rootStyle.vars['--ncm-text-scale-base'] = '';
settings.playerTheme = { textScale: 90 };
ok(M.getPlayerTextScale() === 90, 'falls back to the saved playerTheme.textScale when :root has nothing');
delete settings.playerTheme;
ok(M.getPlayerTextScale() === 100, 'defaults to 100');
rootStyle.vars['--ncm-text-scale-base'] = '1.2';
const p1 = M.playerDialog({ title: 'x' });
ok(p1.options.classes.join(' ') === 'dialog ncm-player-dialog', 'playerDialog: default classes + player tag');
const p2 = M.playerConfirm({ title: 'c', options: { classes: ['ncm-time-config-dialog'], width: 320 } });
ok(p2.options.classes.includes('ncm-player-dialog') && p2.options.classes.includes('ncm-time-config-dialog') && p2.options.width === 320, 'playerConfirm merges cfg.options');
const p3 = M.playerPrompt({ title: 'p' });
ok(p3.options.classes.includes('ncm-player-dialog'), 'playerPrompt tags');
const p4 = M.playerWait({}, { classes: ['dialog', 'ncm-admin-dialog'] });
ok(p4.options.classes.includes('ncm-admin-dialog') && !p4.options.classes.includes('ncm-player-dialog'), 'an explicit admin class wins over the player tag');
globalThis.document.activeElement = { closest: (sel) => sel === '[data-ncm-admin-theme]' ? {} : null };
const p5 = M.playerDialog({ title: 'from a GM-view window' });
ok(p5.options.classes.includes('ncm-admin-dialog') && !p5.options.classes.includes('ncm-player-dialog'), 'opened from an admin-tagged window → admin dialog (follows its opener)');
globalThis.document.activeElement = null;
const pl = { options: { classes: ['dialog', 'ncm-player-dialog'] }, element: [new El()], position: { width: 400 }, setPosition(p) { this.position = { ...this.position, ...p }; } };
fire(pl);
ok(pl.element[0].content.style.zoom === '1.2', 'player dialog zoomed by the player scale');
ok(pl.element[0].dataset.ncmAdminTheme === undefined, 'player dialog gets NO admin palette');
ok(pl.position.width === 480, 'player dialog width grows once by the ratio (400 → 480)');
fire(pl);
ok(pl.position.width === 480, 're-render does not grow it again');
rootStyle.vars['--ncm-text-scale-base'] = '1';
const pl100 = { options: { classes: ['dialog', 'ncm-player-dialog'] }, element: [new El()], position: { width: 400 }, setPosition() { throw new Error('should not resize at 100%'); } };
fire(pl100);
ok(pl100.element[0].content.style.zoom === '', 'at 100% the player dialog is left exactly as Foundry built it');
rootStyle.vars['--ncm-text-scale-base'] = '1.2';

// Source guard: every Dialog the module opens goes through a wrapper — a raw
// one scales with nothing. Exempt: the wrappers themselves and the namespace
// migration prompt (it runs before the hook exists).
{
  const fsx = await import('fs');
  const pathx = await import('path');
  const walk = (d) => fsx.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(pathx.join(d, e.name)) : (e.name.endsWith('.js') ? [pathx.join(d, e.name)] : []));
  const raw = [];
  for (const f of walk(`${ROOT}/scripts`)) {
    const rel = f.split(pathx.sep).join('/').split('/scripts/')[1];
    if (rel === 'utils/adminTheme.js' || rel === 'core/NamespaceMigration.js') continue;
    const src = fsx.readFileSync(f, 'utf8');
    if (/\bnew Dialog\(|\bDialog\.(confirm|prompt|wait)\(/.test(src)) raw.push(rel);
  }
  ok(raw.length === 0, `no raw Dialog call outside the wrappers (found: ${raw.join(', ') || 'none'})`);
  const hookReg = fsx.readFileSync(`${ROOT}/scripts/init/registerGMTools.js`, 'utf8');
  ok(hookReg.includes('registerAdminDialogHook();'), 'hook registered at ready');
}

// ═══ BaseApplication contract (static reads only — no Foundry ApplicationV2 here) ═══
import fs from 'fs';
const base = fs.readFileSync(`${ROOT}/scripts/ui/BaseApplication.js`, 'utf8');
ok(/static ADMIN_THEMED = false;/.test(base), 'BaseApplication defaults ADMIN_THEMED=false');
ok(/if \(this\.constructor\.ADMIN_THEMED\) this\._applyAdminTheme\(\);/.test(base), 'BaseApplication._onRender applies it after atmosphere');
const flagged = [
  'ui/AdminPanel/AdminPanelApp.js', 'ui/GMContactManager/ActorImportPickerApp.js',   // the GM Contact Manager window lives in Admin → Contacts now
  'ui/NetworkManagement/CreateNetworkDialog.js', 'ui/Terminal/TerminalConfigApp.js',
  'ui/ItemInbox/ItemInboxConfig.js', 'ui/ItemInbox/DataShardComposer.js', 'ui/MalwareWorkshop/MalwareWorkshopApp.js',
  'ui/ContactManager/ContactShareDialog.js',
];
for (const f of flagged) ok(/static ADMIN_THEMED = true;/.test(fs.readFileSync(`${ROOT}/scripts/${f}`, 'utf8')), `flagged: ${f}`);
const immersive = ['ui/MessageViewer/MessageViewerApp.js', 'ui/MessageComposer/MessageComposerApp.js', 'ui/ItemInbox/ItemInboxApp.js',
  'ui/Terminal/TerminalViewerApp.js', 'ui/ThemeCustomizer/ThemeCustomizerApp.js', 'ui/ContactManager/ContactManagerApp.js', 'ui/ProgramDeck/ProgramDeckApp.js'];
for (const f of immersive) ok(!/ADMIN_THEMED = true/.test(fs.readFileSync(`${ROOT}/scripts/${f}`, 'utf8')), `immersive stays player-themed: ${f}`);
ok(/this\._applyAdminTheme\(\);/.test(fs.readFileSync(`${ROOT}/scripts/ui/ItemInbox/DataShardComposer.js`, 'utf8')), 'composer (no super._onRender) calls it explicitly');
const css = fs.readFileSync(`${ROOT}/styles/themes/admin-theme.css`, 'utf8');
ok(/:is\(\.ncm-app, \.ncm-admin-dialog\)\[data-ncm-admin-theme\] \{/.test(css), 'palette re-scoped to the attribute');
ok(/\[data-ncm-admin-theme="clean-light"\]/.test(css) && !/\.ncm-app\.ncm-admin-panel\[/.test(css), 'presets keyed by attribute, not the panel class');
ok(/\.ncm-admin-dialog\[data-ncm-admin-theme\] \.dialog-buttons button/.test(css), 'dialog chrome rules present');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
