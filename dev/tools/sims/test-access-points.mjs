// Access points — the pure rules + the wiring a refactor can break.
// node dev/tools/sims/test-access-points.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as A from '../../../scripts/utils/accessPoints.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };

// refs
ok(A.accessRef('terminal', 'Item.abc')?.id === 'Item.abc', 'terminal ref');
ok(A.accessRef('nope', 'x') === null, 'unknown kind refused');
ok(A.accessRef('shard', '  ') === null, 'blank id refused');
ok(A.isAccessRef({ kind: 'message', id: 'a|b' }), 'message ref');

// links
const ref = A.accessRef('terminal', 'Actor.x.Item.y');
const link = A.accessLinkText(ref, 'WS-7F {12}');
ok(link === '@NCM[terminal:Actor.x.Item.y]{WS-7F 12}', 'link text strips braces: ' + link);
const found = A.findAccessLinks(`<p>Go to ${link} and @NCM[shard:Item.q] then @NCM[bogus:1]{x}</p>`);
ok(found.length === 2 && found[0].label === 'WS-7F 12' && found[1].ref.kind === 'shard' && found[1].label === '', 'findAccessLinks');
ok(A.findAccessLinks('@NCM[inbox:abc]{V}')[0].ref.id === 'abc', 'inbox link');

// macro command parses as an async function body with the predefined params
const cmd = A.accessMacroCommand(ref);
let parsed = true;
try { new (Object.getPrototypeOf(async function () {}).constructor)('speaker', 'actor', 'token', 'character', 'scope', cmd); } catch { parsed = false; }
ok(parsed, 'macro command parses');
ok(!cmd.includes('`') && !/\bconst (actor|token|character)\b/.test(cmd), 'macro command: no backticks, no reserved locals');
ok(cmd.includes('"kind":"terminal"'), 'macro carries the ref');
ok(A.accessMacroCommand({ kind: 'x' }) === '', 'bad ref → no command');

// palette
const src = { primary: '#ff2244', accent: '#ffaa00', bgDeep: '#100008', textPrimary: '#ffeeee', textSecondary: '#cc9999' };
ok(A.handoutPalette({ mode: 'match' }, src).p === '#ff2244', 'match uses the source');
ok(A.handoutPalette({ mode: 'match' }, null).p === A.HANDOUT_DEFAULT.p, 'match without a source → default');
ok(A.handoutPalette({ mode: 'default' }, src).p === A.HANDOUT_DEFAULT.p, 'default ignores the source');
const cu = A.handoutPalette({ mode: 'custom', custom: { primary: '#123456', accent: '#abcdef', bg: '#000000', text: '#ffffff' } }, src);
ok(cu.p === '#123456' && cu.bg === '#000000' && /^#[0-9a-f]{6}$/.test(cu.tx2), 'custom uses the four colours + derives muted');
ok(A.sanitizeHandoutStyle({ mode: 'weird' }).mode === 'match', 'unknown mode → match');
ok(A.sanitizeHandoutStyle({ mode: 'custom', custom: { primary: 'red' } }).custom.primary === '#c084fc', 'bad hex → fallback');
ok(A.handoutPalette({ mode: 'match' }, { primary: 'javascript:alert(1)' }).p === A.HANDOUT_DEFAULT.p, 'junk source colour never reaches the style');
ok(A.mixHex('#000000', '#ffffff', 0.5) === '#808080', 'mixHex');

// markup
const card = A.accessCardHtml(ref, { name: '<b>x</b>', sub: 'Arasaka', tags: ['3 accounts', ''] }, A.HANDOUT_DEFAULT);
ok(card.includes('&lt;b&gt;x&lt;/b&gt;') && !card.includes('<b>x'), 'card escapes names');
ok(card.includes(`data-ncm-access='{&quot;kind&quot;:&quot;terminal&quot;`), 'card button carries the ref');
ok((card.match(/ncm-ap-card__tag"/g) || []).length === 1, 'empty tags dropped');
ok(A.accessChipHtml(ref, 'X', A.HANDOUT_DEFAULT, true).includes('is-missing'), 'missing chip');
ok(A.HANDOUT_STYLES.length === 3, 'three style choices');

// wiring
const rt = read('scripts/integrations/AccessPoints.js');
for (const k of ['openTerminal', 'openDataShard', 'openInbox']) ok(rt.includes(k), `openAccess routes ${k}`);
ok(/whisper\?\.length \? \[\.\.\.new Set\(\[\.\.\.choice\.whisper, \.\.\.gms\]\)\] : \[\]/.test(rt), 'a whisper always includes the GMs');
ok(rt.includes("Hooks.on('hotbarDrop'"), 'hotbar drop hook');
ok(rt.includes('CONFIG.TextEditor.enrichers.push'), 'journal enricher');
const init = read('scripts/init/registerTerminalSystem.js');
ok(/register\('init', \d+, 'Access point enricher'/.test(init) && /register\('ready', 113, 'Access points'/.test(init), 'registered init + ready');
ok(read('scripts/core/SettingsManager.js').includes("'accessHandoutStyle'"), 'setting registered');
ok(read('styles/night-city-messenger.css').includes("@import 'components/access-points.css'"), 'stylesheet imported');
const css = read('styles/components/access-points.css');
ok(!/background:\s*#[0-9a-f]{3,6}\b(?!\))/i.test(css.replace(/var\([^)]*\)/g, '')), 'handout colours come from --h-* / tokens only');
const sso = read('scripts/integrations/ShardSheetOverride.js');
ok(sso.includes('_nightCityEntries(item') && sso.includes("'ncm-ctx-more'") === false && sso.includes('ncm-ctx-more'), 'directory gets the Night City ▸ entry');
ok(!/addOption\('Place on Current Scene'/.test(sso) && !/addOption\('Program Deck'/.test(sso), 'old flat entries moved behind Night City');
ok(sso.includes('accessMenuEntries(item)'), 'ACCESS section shared');
ok(read('templates/admin-panel/tab-terminals.hbs').includes('data-op="access"') && read('templates/admin-panel/tab-shards.hbs').includes('data-op="access"'), 'admin Access buttons');
ok(read('scripts/ui/AdminPanel/AdminPanelApp.js').includes('wireAccessDrag('), 'admin rows drag to the hotbar');

ok(sso.includes('static _subMenuAt(rect, ev)') && sso.split('ShardSheetOverride._subMenuAt(rect, e').length - 1 === 2 && sso.split("addEventListener('pointerdown', () => { rect = ").length - 1 === 2, 'sub-menus open beside the row measured on pointerdown (both menus)');
// Copy macro code / Make a macro (the catch-all for any tool that runs a script)
const snip = A.accessMacroSnippet(ref, 'WS\n7F');
let snipOk = true; try { new (Object.getPrototypeOf(async function () {}).constructor)('speaker', 'actor', 'token', 'character', 'scope', snip); } catch { snipOk = false; }
ok(snipOk && snip.startsWith('// Night City Messenger — opens WS 7F') && /triggering player/.test(snip) && snip.includes(A.accessMacroCommand(ref)), 'macro code: parses, names what it opens on one line, warns to run as the triggering player');
ok(rt.includes("label: 'Copy macro code'") && rt.includes("label: 'Make a macro'") && rt.includes('createAccessMacro(ref, { assign: false })') && rt.includes('command: accessMacroSnippet(ref, d.name)'), 'ACCESS menu: Copy macro code + Make a macro (no hotbar); made macros carry the header');
// dialogs (2026-10-29 round 2): Foundry's own 'dialog' class must survive; the small dialogs share one body
const D = await import('../../../scripts/utils/dialogBody.js');
ok(D.THEMED_DIALOG_CLASSES.includes('dialog') && D.THEMED_DIALOG_CLASSES.includes('ncm-themed-dialog'), "themed dialogs keep Foundry's dialog class");
const body = D.dialogBodyHtml({ tone: 'bad', title: '<x>', lead: 'Strip **A**?', goes: ['a'], stays: ['b'], field: { name: 'n', label: 'Name', value: '"q' } });
ok(body.includes('&lt;x&gt;') && body.includes('<b>A</b>') && body.includes('&quot;q') && body.includes('ncm-dlgb--bad'), 'dialog body escapes + bolds');
ok(rt.includes('classes: [...THEMED_DIALOG_CLASSES'), 'Post dialog opens with the themed classes');
ok(A.postDialogHtml({ ref, info: { name: 'x' } }).includes('ncm-ap-card'), 'the preview is in the first paint (no post-render growth)');
ok(read('scripts/utils/adminTheme.js').includes("const THEMED = ['dialog', 'ncm-themed-dialog']"), 'themedConfirm / themedPrompt keep the dialog class');
ok(sso.includes("title: 'Remove terminal data'") && sso.includes("data`, yes: 'Remove'") && sso.includes('await themedPrompt({'), 'Remove shard / Remove terminal / Rename use the themed dialog');
ok(!sso.includes("label: 'Night City'") && !sso.includes('Night City<') && sso.includes(' options<span'), 'the menu entry names the thing (… options)');
const pins = read('scripts/integrations/TerminalScenePins.js');
ok(pins.includes("document.addEventListener('contextmenu', (e) => this._onBoardContextMenu(e), true)") && pins.includes('canvas.canvasCoordinatesFromClient') && !/_onClickRight\s*=/.test(pins) && !read('scripts/init/registerTerminalSystem.js').includes('wrapNoteRightClick'), "pin menu rides the board contextmenu (after release); Foundry's note right-click is left alone");
ok(read('styles/night-city-messenger.css').includes("@import 'components/ncm-dialog.css'"), 'dialog stylesheet imported');
ok(read('styles/themes/admin-theme.css').includes('.ncm-rmgr-dialog, .ncm-themed-dialog)'), 'generic admin dialog rules leave themed dialogs alone');
ok(/ncm-themed-dialog\.ncm-themed-dialog \.dialog-buttons button\.default/.test(read('styles/components/ncm-dialog.css')), "the filled default beats admin-theme's .default rule");

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
