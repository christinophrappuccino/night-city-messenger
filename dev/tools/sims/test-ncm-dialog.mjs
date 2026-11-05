// test-ncm-dialog — NCM's dialogs are NcmDialog (utils/ncmDialog.js): Foundry's DialogV2 frame with the v1 Dialog's
// settings and behaviour, so the 138 calls through the adminTheme.js wrappers did not change. This drives the REAL
// class on a stand-in DialogV2 (lib/dialogMock.mjs) and checks v1's promises: confirm / prompt / wait results, the
// button-then-close order, rejectClose, the button markup the CSS and code reach into (no <form>), namespaced
// actions (a button keyed "close" must not replace the frame's close), the options mapping, and that no v1 Dialog
// call is left in the module. Visual parity: dev/mockups/dialog-v2-mock.html.
// Run: node dev/tools/sims/test-ncm-dialog.mjs   (NCM_ROOT=<dir> to check another checkout)
import { readFileSync } from 'fs';
import path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';
import { installDialogV2 } from './lib/dialogMock.mjs';

const ROOT = path.resolve(process.env.NCM_ROOT || fileURLToPath(new URL('../../../', import.meta.url)));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

globalThis.ui = { notifications: { error() {}, warn() {}, info() {} } };
globalThis.game = { i18n: { localize: (s) => s }, user: { isGM: true }, settings: { get: () => ({}) } };
globalThis.Hooks = { on() {}, once() {}, callAll() {} };
// just enough document for _renderHTML: an element whose innerHTML we can read back
globalThis.document = { createElement: (tag) => ({ tagName: tag.toUpperCase(), className: '', innerHTML: '' }), activeElement: null };
const D = installDialogV2();
const { NcmDialogClass } = await import(pathToFileURL(path.join(ROOT, 'scripts/utils/ncmDialog.js')).href);
const NcmDialog = NcmDialogClass();
const press = (key) => { D.answer = () => key; };
const settle = () => new Promise((r) => setTimeout(r, 5));

// ═══ confirm ═══
press('yes'); ok((await NcmDialog.confirm({ title: 't', content: 'c' })) === true, 'confirm: Yes → true');
press('no'); ok((await NcmDialog.confirm({ title: 't' })) === false, 'confirm: No → false');
press(null); ok((await NcmDialog.confirm({ title: 't' })) === null, 'confirm: closed → null');
press(null); let rejected = false; await NcmDialog.confirm({ title: 't', rejectClose: true }).catch(() => { rejected = true; });
ok(rejected, 'confirm with rejectClose: closed → rejects');
press('yes'); ok((await NcmDialog.confirm({ title: 't', yes: () => 'chosen' })) === 'chosen', 'confirm: the yes callback\'s value is the result');
press(undefined); NcmDialog.confirm({ title: 'Delete it?' }); const cd = D.made.at(-1);
ok(cd.data.default === 'yes' && cd.options.buttons.find((b) => b.key === 'yes')?.default === true, 'confirm: Yes is the default (v1), not No (DialogV2)');
ok(cd.options.window.title === 'Delete it?', 'the title reaches the V2 window');

// ═══ prompt ═══
press('ok'); ok((await NcmDialog.prompt({ title: 'p', label: 'Save', callback: () => 42 })) === 42, 'prompt: the callback\'s value');
press(null); rejected = false; await NcmDialog.prompt({ title: 'p', callback: () => 1 }).catch(() => { rejected = true; });
ok(rejected, 'prompt: closed → REJECTS by default (v1 — the 4 callers .catch it)');
press(null); ok((await NcmDialog.prompt({ title: 'p', rejectClose: false })) === null, 'prompt with rejectClose:false: closed → null');

// ═══ wait ═══
press('b'); ok((await NcmDialog.wait({ buttons: { a: {}, b: {} } })) === 'b', 'wait: a button with no callback → its key');
press('a'); ok((await NcmDialog.wait({ buttons: { a: { callback: () => ({ v: 1 }) } } })).v === 1, 'wait: the callback\'s value');
press(null); ok((await NcmDialog.wait({ buttons: { a: {} }, close: () => 'dismissed' })) === 'dismissed', 'wait: closed → close()\'s value');
press(null); rejected = false; await NcmDialog.wait({ buttons: { a: {} } }).catch(() => { rejected = true; }); ok(rejected, 'wait: closed with no close value → rejects');

// ═══ a plain dialog: button, then close, every time (themedConfirm depends on it) ═══
{
  const order = [];
  press('yes');
  const dlg = new NcmDialog({ title: 't', buttons: { yes: { callback: () => order.push('button') }, no: {} }, default: 'yes', close: () => order.push('close') });
  dlg.render(true); await settle();
  ok(order.join() === 'button,close', `a button's callback runs, then close (${order.join()})`);
  await dlg.close();
  ok(order.join() === 'button,close', 'close runs once, not again on a second close');
  const order2 = []; press(null);
  new NcmDialog({ buttons: { a: { callback: () => order2.push('a') } }, close: () => order2.push('close') }).render(true); await settle();
  ok(order2.join() === 'close', 'closing without a choice runs only close');
}

// ═══ options and markup ═══
{
  press(undefined);
  const dlg = new NcmDialog({ title: 'T', content: '<p>Hi</p>', default: 'go',
    buttons: { close: { icon: '<i class="fas fa-times"></i>', label: 'Close' }, go: { icon: '<i class="fas fa-bolt"></i>', label: 'Go' } } },
    { classes: ['dialog', 'ncm-hack-dialog'], width: 360, height: 300, resizable: true });
  ok(dlg.options.classes.includes('ncm-hack-dialog') && dlg.options.classes.includes('ncm-dialog-v2'), 'the caller\'s classes are kept, ncm-dialog-v2 added');
  ok(dlg.options.position.width === 360 && dlg.options.position.height === 300 && dlg.options.window.resizable === true, 'width / height / resizable map onto the V2 options');
  ok(dlg.options.window.minimizable === true && new NcmDialog({ buttons: { a: {} } }, { minimizable: false }).options.window.minimizable === false, 'minimizable: on unless the caller said false');
  ok(dlg.options.buttons.every((b) => b.action.startsWith('ncmb-')) && dlg.options.buttons.find((b) => b.key === 'close').action === 'ncmb-close', 'button actions are namespaced: a button keyed "close" does not replace the frame\'s close');
  ok(dlg.options.buttons.find((b) => b.key === 'go').icon === 'fas fa-bolt', 'a v1 icon (markup) becomes a V2 icon (class)');
  const body = await dlg._renderHTML();
  ok(body.tagName === 'DIV' && body.className === 'ncm-dialog-body' && !/<form/.test(body.innerHTML), 'the body is a plain div, never a <form> (the system styles form labels)');
  ok(/<div class="dialog-content"><p>Hi<\/p><\/div><div class="dialog-buttons">/.test(body.innerHTML), 'v1\'s .dialog-content and .dialog-buttons, so the dialog CSS keeps matching');
  ok(/<button type="button" class="dialog-button go default" data-button="go" data-action="ncmb-go"><i class="fas fa-bolt"><\/i>Go<\/button>/.test(body.innerHTML), 'buttons carry v1\'s class / data-button (code reaches for button[data-button="execute"]) (the default gets focus in _onRender, not by autofocus)');
  const none = new NcmDialog({ title: 'x', content: 'y' });
  ok(none.options.buttons.length === 1 && none.options.buttons[0].class === 'ncm-dialog-nobutton', 'a v1 dialog with no buttons gets one hidden button (DialogV2 needs one)');
}

// ═══ focus on open (no DOM here, so checked in the source; live: test-s2-dialogv2.macro.js) ═══
{
  const src = read('scripts/utils/ncmDialog.js');
  ok(src.includes("if (options?.isFirstRender && !this.element.querySelector('.dialog-content')?.contains(document.activeElement)) {") && src.includes("this.element.querySelector('button.dialog-button.default')?.focus();"),
    'on open the default button takes focus unless focus is already in the CONTENT (showing a <dialog> focuses its header close button first — v12 tester fail)');
  ok(!/' autofocus'/.test(src), 'no autofocus attribute on the default button (Foundry focuses [autofocus] after the render callbacks)');
}

// ═══ the module ═══
const AT = read('scripts/utils/adminTheme.js');
ok((AT.match(/NcmDialogClass\(\)/g) || []).length === 8 && !/new Dialog\(|Dialog\.(confirm|prompt|wait)\(/.test(AT.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')), 'all eight wrappers build an NcmDialog; none builds a v1 Dialog');
ok(/for \(const hook of \['renderNcmDialog', 'renderDialog'\]\)/.test(AT), 'the admin theme and the player Text Size follow the new render hook');
ok(/const ncmDialog = frame\.classList\.contains\('ncm-dialog-v2'\);/.test(read('scripts/utils/windowMinimize.js')), 'the minimize button keeps the v1 dialog rule for NCM dialogs');
ok(/NcmDialogClass\(\)\.confirm\(/.test(read('scripts/core/NamespaceMigration.js')), 'the id-migration prompt is an NcmDialog too');
ok(/'the v1 Dialog \(deprecated in v13, removed in v16\)/.test(read('dev/tools/check-deprecations.mjs')), 'check-deprecations bans a new v1 Dialog');
ok(/@import 'components\/dialog-v2\.css';/.test(read('styles/night-city-messenger.css')), 'the V2 frame styles are imported');

console.log(`test-ncm-dialog: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
