// The minimize button — who gets one, its face, and the wiring.   node dev/tools/sims/test-window-minimize.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { wantsMinimize, minimizeFace } from '../../../scripts/utils/windowMinimize.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };

ok(wantsMinimize({ classes: ['ncm-app', 'ncm-admin-panel'] }), 'an NCM window gets it');
ok(!wantsMinimize({ classes: ['sheet', 'actor'] }), 'other modules\' / core windows are left alone');
ok(!wantsMinimize({ classes: ['ncm-app'], minimizable: false }), 'a window that must not roll up gets none');
ok(wantsMinimize({ classes: ['dialog', 'ncm-themed-dialog'], v1: true }), 'themed dialogs (Post to chat, Rename) get it');
ok(wantsMinimize({ classes: ['dialog', 'ncm-pkr-dialog'], v1: true }) && wantsMinimize({ classes: ['ncm-rmgr-dialog'], v1: true }) && wantsMinimize({ classes: ['ncm-time-config-dialog'], v1: true }), 'picker, role manager, time settings get it');
ok(!wantsMinimize({ classes: ['dialog', 'ncm-themed-dialog', 'ncm-dlg-confirm'], v1: true }), 'a yes/no confirm does not');
ok(!wantsMinimize({ classes: ['dialog', 'ncm-admin-dialog'], v1: true }), 'a plain admin dialog does not');
ok(minimizeFace(false).icon === 'fa-minus' && minimizeFace(true).icon === 'fa-window-restore' && /Restore/.test(minimizeFace(true).label), 'faces: a centred dash, the restore glyph');

const js = read('scripts/utils/windowMinimize.js');
ok(js.includes("Hooks.on('renderApplicationV2'") && js.includes("Hooks.on('renderDialog'"), 'one hook for every AppV2 window + one for dialogs');
ok(js.includes('MutationObserver') && js.includes("btn.addEventListener('dblclick'"), 'the glyph follows a title-bar double-click; a double-click on the button is not a second toggle');
ok(!/dataset\.action\s*=/.test(js), 'no data-action (Foundry would look for a handler)');
ok(/register\('init', 21, 'Minimize buttons'/.test(read('scripts/init/registerUIComponents.js')), 'registered at init');
for (const f of ['scripts/ui/ItemInbox/ItemInboxConfig.js', 'scripts/ui/ItemInbox/DataShardComposer.js', 'scripts/ui/Terminal/TerminalConfigApp.js', 'scripts/ui/NetworkManagement/CreateNetworkDialog.js']) {
  ok(/minimizable: true/.test(read(f)) && !/minimizable: false/.test(read(f)), `${path.basename(f)} can roll up`);
}
for (const f of ['scripts/ui/NetworkManagement/NetworkAuthDialog.js', 'scripts/ui/NetworkManagement/DeadZoneWarningApp.js', 'scripts/ui/dialogs/PlayerEmailSetup.js']) {
  ok(/minimizable: false/.test(read(f)), `${path.basename(f)} still cannot (mid-flow)`);
}
ok(read('scripts/utils/adminTheme.js').includes("'ncm-dlg-confirm'"), 'themedConfirm marks itself a confirm');
const css = read('styles/base/window-chrome.css');
ok(css.includes('.window-header .ncm-minbtn') && css.includes('.minimized > .window-header'), 'styled, with the rolled-up accent strip');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
