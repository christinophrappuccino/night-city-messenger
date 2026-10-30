// Sim: Admin → Security → Hacking rules keeps unsaved edits (tester 2026-10-29: "add a Role, add another, it
// glitches back to Anyone… no Saved message any more"). Background repaints (the 30 s tick, the game clock,
// settings hooks, events) must not rebuild the rules view; a card's Save says so on the card, and only repaints
// when no other card has unsaved edits; a failed save is shown, not just logged.
//   node dev/tools/sims/test-rules-unsaved.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.error('FAIL:', m)); };

// minimal Foundry for the tab module
const toasts = [];
let failSet = false;
const store = {};
globalThis.game = {
  user: { isGM: true }, users: [], actors: [], items: [], journal: [],
  settings: { get: (_m, k) => store[k], set: async (_m, k, v) => { if (failSet) throw new Error('nope'); store[k] = v; } },
  nightcity: {},
};
globalThis.ui = { notifications: { info: (m) => toasts.push(['info', m]), error: (m) => toasts.push(['error', m]), warn: () => {} } };
globalThis.Hooks = { on: () => 1, off: () => {} };
globalThis.Handlebars = { escapeExpression: (s) => String(s) };
globalThis.foundry = { utils: { deepClone: (o) => JSON.parse(JSON.stringify(o)), debounce: (f) => f } };

const { SecurityTab } = await import('../../../scripts/ui/AdminPanel/tabs/SecurityTab.js');
let renders = 0;
const app = { _activeTab: 'security', rendered: true, render: () => { renders++; }, element: null };
const tab = new SecurityTab(app);

// 1. the rules view holds background repaints; the live views do not
tab._view = 'rules'; ok(tab.holdsRender() === true, 'rules view holds background repaints');
for (const v of ['live', 'activity', 'heat', 'machines']) { tab._view = v; ok(tab.holdsRender() === false, `${v} keeps repainting`); }

// 2. a save with no other card edited repaints + toasts; with another card edited it does NOT repaint
tab._view = 'rules';
tab._dirty = new Set(['op']); renders = 0;
tab._rulesSaved('op', true, 'Terminal operator access saved.');
ok(renders === 1 && !tab._dirty.size && toasts.at(-1)[0] === 'info', 'save, nothing else edited → repaint + toast');
tab._dirty = new Set(['op', 'jack']); renders = 0;
tab._rulesSaved('op', true, 'Terminal operator access saved.');
ok(renders === 0 && tab._dirty.has('jack') && !tab._dirty.has('op'), 'save while another card is edited → no repaint, the other card keeps its edits');
ok(tab._flash?.key === 'op' && tab._flash.ok, 'the saved line is remembered for the card');

// 3. the gate save, success and failure
tab._dirty = new Set(['op']); renders = 0; toasts.length = 0;
app.element = { querySelector: () => null, querySelectorAll: () => [] };
await tab.onSaveGate();
ok(store.operatorGate && toasts.some(([t, m]) => t === 'info' && /operator access saved/.test(m)), 'gate save writes the setting and says so');
failSet = true; toasts.length = 0; renders = 0;
await tab.onSaveGate();
ok(toasts.some(([t]) => t === 'error') && tab._flash && !tab._flash.ok && renders === 0, 'a failed save is SHOWN (it used to go to the console only), no repaint');
failSet = false;

// 4. the other rule saves go through the same path
const src = read('scripts/ui/AdminPanel/tabs/SecurityTab.js');
ok(/_rulesSaved\('jack'/.test(src) && /_rulesSaved\('cmv'/.test(src) && /hackResolution' \? 'res'/.test(src), 'Jacking in, Countermeasure visibility, Resolution + Role rolls use it');
ok(/!this\.holdsRender\(\)\) this\.app\.render\(false\)/.test(src), 'the 30 s tick skips the rules view');
ok(/this\._wireRuleEdits\(el\)/.test(src) && /body\.addEventListener\('input', mark\)/.test(src) && /addEventListener\('click'/.test(src), 'edits mark the card (inputs and add/remove clicks)');

// 5. the panel asks the open tab before ANY background repaint
const ap = read('scripts/ui/AdminPanel/AdminPanelApp.js');
ok(/_debouncedRender = foundry\.utils\.debounce\(\(\) => \{[\s\S]{0,200}holdsRender/.test(ap), 'AdminPanelApp._debouncedRender asks holdsRender()');

// 6. the marks are styled
const css = read('styles/components/admin-panel/tab-security.css');
ok(css.includes('.ncm-sec-admin-fold.is-dirty') && css.includes('.ncm-sec-admin-savedmsg.ok') && css.includes('.ncm-sec-admin-savedmsg.bad'), 'unsaved + saved + failed are styled');

// 7. the tab bar SLIDES between fold states (2026-10-29, "the nav snaps from tab to tab"); the fold rule is unchanged
const hbs = read('templates/admin-panel/admin-panel.hbs');
ok(!hbs.includes('ncm-admin-tab--ico'), 'every tab keeps its label (Overview and Tools too)');
const fold = ap.slice(ap.indexOf('_wireTabFold() {'), ap.indexOf('_wireTabFold() {') + 3600);
ok(/!== openGroup\)\.forEach\(t => t\.classList\.add\('is-fold'\)\)/.test(fold), 'the fold rule: other groups first, then the rest of the open group');
ok(/this\._tabFoldPrev/.test(fold) && /lb\.animate\(/.test(fold) && /an\.cancel\(\)/.test(fold), 'replays the previous state, animates each changing label, lands a running slide before measuring');
ok(/resized && nav\.clientWidth === this\._tabFoldW/.test(fold), 'the resize observer re-folds only on a real width change');
ok(/prefers-reduced-motion: reduce/.test(fold), 'reduced motion: no slide');
const hier = read('styles/components/admin-panel/admin-hierarchy.css');
ok(hier.includes('.ncm-admin-tab.is-fold .ncm-admin-tab__lb { display: inline-block; max-width: 0;'), 'a folded label collapses by width (so it can slide)');

console.log(`test-rules-unsaved: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
