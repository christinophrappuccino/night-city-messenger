// test-inbox-select — mass delete in the inbox (tester round 2026-11-06: "a way to mass delete messages").
// The bulk bar and its four methods existed, but nothing ever ticked a message, so the bar never showed. Now: a Select
// pill puts the list in Select mode (rows tick, Shift-click ticks a range, Select all covers every page), Move to Trash
// soft-deletes, and a strip says where they went with Open Trash and Undo (a single delete gets the strip too). Inside
// Trash the bar offers Restore and Delete forever; inside Spam, Not spam.
// Lifts the REAL methods out of MessageViewerApp.js and renders the REAL template sections through Handlebars.
//   node dev/tools/sims/test-inbox-select.mjs
import { FOUNDRY_APP_PKGS } from './lib/foundryApp.mjs';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync } from 'fs';
import { createRequire } from 'module';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const read = (p) => readFileSync(`${ROOT}/${p}`, 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };

const js = read('scripts/ui/MessageViewer/MessageViewerApp.js');
const hbs = read('templates/message-viewer/message-viewer.hbs');
const item = read('templates/message-viewer/partials/message-list-item.hbs');

// ═══ 1. the real methods, lifted out of the class ═══
const method = (name) => {
  const at = js.search(new RegExp(`\\n  (async )?${name}\\(`));
  if (at < 0) throw new Error(`no ${name}`);
  const end = js.indexOf('\n  }\n', at) + 4;
  return js.slice(at + 1, end).trim();   // "async _bulkDelete() { … }" — a method in an object literal
};
const names = ['_bulkContext', '_toggleSelectMode', '_toggleBulk', '_bulkSelectAll', '_bulkEach', '_bulkMarkRead', '_bulkDelete', '_bulkMarkSpam', '_bulkNotSpam', '_bulkRestore', '_undoTrash', '_deleteMessage'];
const SELECTABLE = js.match(/export const SELECTABLE_FILTERS = new Set\((\[[^\]]+\])\)/)?.[1];
ok(!!SELECTABLE, 'the folders Select works in are one list');
const toasts = [];
const proto = new Function('SELECTABLE_FILTERS', 'ncmNotify', 'playerConfirm', `return { ${names.map(method).join(',\n')} };`)(new Set(JSON.parse(SELECTABLE.replace(/'/g, '"'))), { warn: (m) => toasts.push(m) }, async () => true);

const store = new Map();
const mk = (id, extra = {}) => ({ messageId: id, status: { read: false, deleted: false, spam: false, ...extra } });
for (let i = 1; i <= 30; i++) store.set('m' + i, mk('m' + i));
const svc = {
  calls: [],
  async deleteMessage(a, id) { this.calls.push(['del', id]); if (id === 'm-fail') return { success: false }; store.get(id).status.deleted = true; return { success: true }; },
  async restoreFromTrash(a, id) { this.calls.push(['restore', id]); store.get(id).status.deleted = false; return { success: true }; },
  async markAsRead(a, id) { store.get(id).status.read = true; return { success: true }; },
  async markSpam(a, id) { store.get(id).status.spam = true; return { success: true }; },
  async unmarkSpam(a, id) { store.get(id).status.spam = false; return { success: true }; },
};
let renders = 0;
const view = Object.assign(Object.create(proto), {
  actorId: 'v', currentFilter: 'inbox', selectMode: false, bulkSelected: new Set(), _bulkAnchor: null, _trashNote: null, selectedMessageId: 'm2',
  messageService: svc, render() { renders++; },
});
const folder = () => { view._cachedMessages = [...store.values()].filter((m) => (view.currentFilter === 'trash' ? m.status.deleted : !m.status.deleted)); };
folder();

let ctx = view._bulkContext(true, view._cachedMessages.slice(0, 10));
ok(ctx.selectable && !ctx.selectMode && !ctx.showBulkActions, 'inbox: Select is offered, off');
ok(!view._bulkContext(false, []).selectable, 'not on the Calls / Chips tabs');
view.currentFilter = 'conversations';
ok(!view._bulkContext(true, []).selectable, 'not in Conversations');
view.currentFilter = 'inbox';

view._toggleSelectMode();
ok(view.selectMode && view.selectedMessageId === null, 'Select on: the open message closes, so a click ticks');
ctx = view._bulkContext(true, view._cachedMessages.slice(0, 10));
ok(ctx.showBulkActions && ctx.bulkNone && ctx.bulkCount === 0 && ctx.bulkTotal === 30, 'the bar shows with nothing ticked, knows all 30');

view._toggleBulk('m3'); view._toggleBulk('m7', { range: true });
ok(['m3', 'm4', 'm5', 'm6', 'm7'].every((id) => view.bulkSelected.has(id)) && view.bulkSelected.size === 5, 'Shift-click ticks the range');
view._toggleBulk('m5');
ok(!view.bulkSelected.has('m5') && view.bulkSelected.size === 4, 'a plain click unticks one');
view._bulkSelectAll();
ok(view.bulkSelected.size === 30 && view._bulkContext(true, []).allSelected, 'Select all ticks every page, not just the one showing');
view._bulkSelectAll();
ok(view.bulkSelected.size === 0, '…and again unticks them all');

// Move to Trash
for (const id of ['m1', 'm2', 'm3']) view.bulkSelected.add(id);
await view._bulkDelete();
ok(['m1', 'm2', 'm3'].every((id) => store.get(id).status.deleted), 'Move to Trash soft-deletes (Trash, not gone)');
ok(view.bulkSelected.size === 0 && view._trashNote?.count === 3, 'the ticks clear, the strip remembers what went');
folder();
ctx = view._bulkContext(true, []);
ok(ctx.trashNote?.count === 3 && !ctx.trashNote.one && ctx.bulkTotal === 27, 'the strip shows "3 moved to Trash"; the folder lost them');
await view._undoTrash();
ok(['m1', 'm2', 'm3'].every((id) => !store.get(id).status.deleted) && !view._trashNote, 'Undo puts all three back and closes the strip');

// a failure is counted, not hidden
store.set('m-fail', mk('m-fail')); folder();
view.bulkSelected.add('m4'); view.bulkSelected.add('m-fail');
toasts.length = 0;
await view._bulkDelete();
ok(view._trashNote?.count === 1 && view._trashNote.ids[0] === 'm4' && toasts.some((t) => /1 of 2/.test(t)), 'one that fails is reported; the strip counts only what moved');
await view._undoTrash(); store.delete('m-fail'); folder();

// a single delete gets the strip too
await view._deleteMessage('m9');
ok(store.get('m9').status.deleted && view._trashNote?.count === 1 && view._bulkContext(true, []).trashNote.one, 'one message deleted: "Moved to Trash" with Open Trash and Undo');
view.currentFilter = 'trash'; folder();
ok(!view._bulkContext(true, []).trashNote, 'the strip is not shown inside Trash itself');

// inside Trash: Restore
view.selectMode = true; view.bulkSelected.add('m9');
ctx = view._bulkContext(true, []);
ok(ctx.bulkInTrash && ctx.bulkCount === 1, 'in Trash the bar is the Trash bar');
await view._bulkRestore();
ok(!store.get('m9').status.deleted, 'Restore puts it back');

// a tick that left the folder stops counting
view.currentFilter = 'inbox'; folder(); view.bulkSelected.add('m10'); view.bulkSelected.add('gone');
ok(view._bulkContext(true, []).bulkCount === 1, 'a ticked message no longer in the folder is dropped');
// leaving the tab leaves Select mode
view._bulkContext(false, []);
ok(!view.selectMode && view.bulkSelected.size === 0, 'off the Messages tab, Select mode ends');

// ═══ 2. wiring ═══
ok(/'select-message': async function \(target, messageId\) \{\n    if \(this\.selectMode && SELECTABLE_FILTERS\.has\(this\.currentFilter\)\) \{ this\._toggleBulk\(messageId, \{ range: !!this\._clickEvent\?\.shiftKey \}\); return; \}/.test(js), 'a row click ticks in Select mode, Shift for a range');
ok(/_setFilter\(filter\) \{[\s\S]{0,300}this\.selectMode = false;[\s\S]{0,80}this\._trashNote = null;/.test(js), 'changing folder leaves Select mode and the strip');
ok(/case 'Escape':\n\s*if \(this\.selectMode\) \{/.test(js) && /if \(this\.selectMode && this\.bulkSelected\.size && isMessages\)/.test(js), 'Esc leaves Select mode; Delete acts on the ticks');
ok(/async _bulkDeleteForever\(\) \{[\s\S]{0,200}playerConfirm\(/.test(js), 'Delete forever asks first');
for (const a of ['toggle-select', 'bulk-select-all', 'bulk-not-spam', 'bulk-restore', 'bulk-delete-forever', 'trash-undo', 'trash-note-close']) ok(js.includes(`'${a}': async function`), `${a} is handled`);
const css = read('styles/components/message-viewer.css');
ok(['ncm-viewer__select-pill', 'ncm-viewer__msg-tick', 'ncm-viewer__msg--ticked', 'ncm-viewer__trash-note', 'ncm-viewer__bulk-gap'].every((c) => css.includes('.' + c)), 'the new pieces are styled');

// ═══ 3. the real templates ═══
let HB = null;
for (const p of [...FOUNDRY_APP_PKGS]) { if (!existsSync(p)) continue; try { HB = createRequire(p)('handlebars'); break; } catch { /* next */ } }
if (!HB) { fail++; console.error('FAIL: could not load Handlebars from a Foundry install — render checks did not run'); }
else {
  HB.registerHelper('eq', (a, b) => a === b);
  HB.registerHelper('and', (a, b) => a && b);
  HB.registerHelper('ncm-tip', (s) => String(s));
  const cut = (from, to) => { const a = hbs.indexOf(from); if (a < 0) throw new Error('no ' + from); return hbs.slice(a, hbs.indexOf(to, a) + to.length); };
  const bar = HB.compile(cut('  {{#if showBulkActions}}', "  {{#if (and (eq currentFilter 'unread') counts.unread)}}").replace(/  \{\{#if \(and \(eq currentFilter 'unread'\) counts\.unread\)\}\}$/, ''));
  const pill = HB.compile(cut('      {{#if selectable}}', '      {{/if}}\n'));
  const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  ok(/data-action="toggle-select"/.test(pill({ selectable: true })) && pill({ selectable: false }).trim() === '', 'the Select pill shows only where it works');
  ok(/aria-pressed="true"/.test(pill({ selectable: true, selectMode: true })), 'the pill says when it is on');
  const inbox = bar({ showBulkActions: true, bulkCount: 2, bulkTotal: 30 });
  ok(/2 selected/.test(text(inbox)) && /Select all 30/.test(text(inbox)) && /Move to Trash/.test(inbox) && /Mark read/.test(inbox) && /data-action="bulk-mark-spam"/.test(inbox) && /Done/.test(inbox), 'inbox bar: count, Select all N, Mark read, Spam, Move to Trash, Done');
  ok(/disabled/.test(bar({ showBulkActions: true, bulkNone: true })), 'nothing ticked: the actions are disabled');
  ok(/Not spam/.test(bar({ showBulkActions: true, bulkInSpam: true })) && !/bulk-mark-spam/.test(bar({ showBulkActions: true, bulkInSpam: true })), 'in Spam: Not spam instead of Spam');
  const trash = bar({ showBulkActions: true, bulkInTrash: true });
  ok(/Restore/.test(trash) && /Delete forever/.test(trash) && !/Move to Trash/.test(trash), 'in Trash: Restore and Delete forever');
  const note = bar({ trashNote: { count: 3 } });
  ok(/3 moved to Trash\. Trash is under More\./.test(text(note)) && /data-action="set-filter" data-filter="trash"/.test(note) && /Open Trash/.test(note) && /data-action="trash-undo"/.test(note), 'the strip: where they went, Open Trash, Undo');
  ok(/Moved to Trash\./.test(text(bar({ trashNote: { count: 1, one: true } }))), 'one message: "Moved to Trash"');
  const row = HB.compile(item.slice(item.indexOf('<div class="ncm-viewer__msg'), item.indexOf('{{!-- Avatar.')));
  ok(/ncm-viewer__msg--picking/.test(row({ picking: true, status: {} })) && /fa-square"/.test(row({ picking: true, status: {} })), 'a row in Select mode has an empty tick box');
  ok(/ncm-viewer__msg--ticked/.test(row({ picking: true, bulkSelected: true, status: {} })) && /fa-square-check/.test(row({ picking: true, bulkSelected: true, status: {} })), 'a ticked row shows the tick');
  ok(!/msg-tick/.test(row({ status: {} })), 'out of Select mode, no tick box');
}

console.log(`test-inbox-select: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
