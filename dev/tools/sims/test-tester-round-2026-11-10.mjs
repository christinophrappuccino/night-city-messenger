// Sim: tester round 2026-11-10 (Aegaeon):
//   1. Hacking rules: every hidden checkbox / radio input sits inside a POSITIONED label. An unpositioned label left
//      the input placed against a far ancestor, so clicking the label scrolled the rule card's clipped content to it
//      (the card jumped, the next box was off-screen). Measured with real clicks: dev/tools/sims/cdp-cmv-click.mjs.
//   2. Closing the Admin window with unsaved Hacking rules edits asks first (each card has its own Save).
//   3. A player character's Messenger lists that character's numbers only, even when a GM (or an Assistant GM)
//      opens it — the "everybody, burners and aliases, in Speed dial" report.
//   node dev/tools/sims/test-tester-round-2026-11-10.mjs
import { pathToFileURL, fileURLToPath } from 'url';
import fs from 'fs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
const read = (p) => fs.readFileSync(`${ROOT}/${p}`, 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.error('FAIL:', m)); };
const MODULE_ID = 'night-city-messenger';

// ═══ 1. hidden inputs live inside a positioned label ═══
{
  // every "hidden input" rule in the two stylesheets of the Hacking rules screen, and the label rule it needs
  const pairs = [
    ['styles/components/countermeasures.css', '.ncm-app .ncm-cmv-mode input', '.ncm-app .ncm-cmv-mode {'],
    ['styles/components/countermeasures.css', '.ncm-app .ncm-cmv-check input', '.ncm-app label.ncm-cmv-check {'],
    ['styles/components/countermeasures.css', '.ncm-app .ncm-cmv-dvtoggle input', '.ncm-app label.ncm-cmv-dvtoggle {'],
    ['styles/components/admin-panel/tab-security.css', '.ncm-admin-panel .ncm-jkr-who__seg input', '.ncm-admin-panel .ncm-jkr-who__seg label {'],
    ['styles/components/admin-panel/tab-security.css', '.ncm-admin-panel .ncm-jkr-who__roles input', '.ncm-admin-panel .ncm-jkr-who__roles label {'],
    ['styles/components/admin-panel/tab-security.css', '.ncm-admin-panel [data-jack-card] input[type=checkbox]', '.ncm-admin-panel .ncm-jkr-tg, .ncm-admin-panel .ncm-jkr-tgl {'],
  ];
  const ruleOf = (css, sel) => { const i = css.indexOf(sel + ' {'); const j = i < 0 ? css.indexOf(sel) : i; if (j < 0) return ''; return css.slice(j, css.indexOf('}', j) + 1); };
  for (const [file, inputSel, labelSel] of pairs) {
    const css = read(file);
    const input = ruleOf(css, inputSel), label = ruleOf(css, labelSel.replace(/ \{$/, ''));
    ok(/position:\s*absolute/.test(input) && /top:\s*0/.test(input) && /left:\s*0/.test(input), `${inputSel}: pinned to its label's corner`);
    ok(/position:\s*relative/.test(label), `${labelSel.replace(/ \{$/, '')}: positioned, so its hidden input stays inside it`);
  }
  // every hidden-input rule in these two files is one of the above (a new one must be added here, with its label)
  for (const file of ['styles/components/countermeasures.css', 'styles/components/admin-panel/tab-security.css']) {
    const hidden = [...read(file).matchAll(/^([^{}\n]*\binput[^{}\n]*)\{[^}]*position:\s*absolute[^}]*opacity:\s*0/gm)].map((m) => m[1].trim());
    const known = pairs.filter(([f]) => f === file).map(([, s]) => s);
    ok(hidden.every((h) => known.includes(h)), `${file}: every hidden input is checked here (${hidden.filter((h) => !known.includes(h)).join(' | ') || 'all known'})`);
  }
  ok(fs.existsSync(`${ROOT}/dev/tools/sims/cdp-cmv-click.mjs`) && fs.existsSync(`${ROOT}/dev/mockups/cmv-click-harness.html`), 'the real-click probe and its harness are in the repo');
}

// ═══ 2. unsaved Hacking rules edits are asked about before the Admin window closes ═══
{
  globalThis.foundry = { utils: { debounce: (f) => f, mergeObject: (a, b) => ({ ...a, ...b }) }, applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (c) => c } } };
  globalThis.game = { user: { isGM: true }, settings: { get: () => undefined } };
  const { SecurityTab } = await imp('scripts/ui/AdminPanel/tabs/SecurityTab.js');
  const tab = Object.create(SecurityTab.prototype);
  tab._dirty = new Set();
  ok(tab.unsavedEdits().length === 0, 'nothing edited: nothing to ask');
  tab._dirty.add('cmv'); tab._dirty.add('jack');
  ok(tab.unsavedEdits().join() === 'Countermeasure visibility,Jacking in', 'edited cards are named as their headers say');
  const hbs = read('templates/admin-panel/tab-security.hbs');
  for (const t of ['Netrunning resolution', 'Terminal operator access', 'Countermeasure visibility', 'Jacking in', 'Role ability rolls']) ok(hbs.includes(`<h3>${t}</h3>`), `the card "${t}" exists under that name`);
  const app = read('scripts/ui/AdminPanel/AdminPanelApp.js');
  ok(app.includes("if (!options.force && this.rendered && !(await this._confirmUnsaved())) return this;"), 'close() asks first (force skips it)');
  ok(app.includes('tab.unsavedEdits?.()') && app.includes('defaultYes: false') && app.includes("import { adminConfirm } from '../../utils/adminTheme.js';"), 'any tab can report unsaved edits; the safe answer is the default');
}

// ═══ 3. a player character's Messenger shows that character's numbers only ═══
{
  const lines = { a: { number: '+72 NC WAT-1907', owner: { name: 'Rogue' }, kind: 'main' }, b: { number: '+72 NC WAT-0666', owner: { name: 'V' }, kind: 'burner' }, c: { number: '+72 NC WAT-5151', owner: { name: 'Queen' }, kind: 'alias' } };
  const actors = new Map([
    ['pc', { id: 'pc', name: 'V', hasPlayerOwner: true, getFlag: (_m, k) => (k === 'contacts' ? [{ name: 'Judy', phone: '+72 NC WAT-3188' }, { name: 'No number', email: 'x@y' }] : null) }],
    ['npc', { id: 'npc', name: 'Fixer', hasPlayerOwner: false, getFlag: () => [] }],
  ]);
  const setUser = (isGM) => {
    globalThis.game = { user: { isGM }, actors: { get: (id) => actors.get(id) }, settings: { get: () => undefined },
      nightcity: { callService: { homeCode: '+72 NC', lines: () => lines, numberOfContact: () => '', numberOf: () => '' }, masterContactService: { getByActorId: () => null, getContact: () => null, npcKnows: () => [] } } };
  };
  const { phoneBook } = await imp('scripts/ui/MessageViewer/callsTab.js');
  setUser(false);
  const asPlayer = phoneBook({ actorId: 'pc' }).map((b) => b.name);
  ok(asPlayer.join() === 'Judy', 'the player sees their own numbers');
  setUser(true);
  const asGm = phoneBook({ actorId: 'pc' }).map((b) => b.name);
  ok(asGm.join() === 'Judy', 'a GM (or Assistant GM) opening that character\'s Messenger sees the same, not the whole directory (it listed every line, burners and aliases)');
  ok(phoneBook({ actorId: 'npc' }).length === 3, 'the GM on an NPC\'s Messenger still has every number to dial');
  ok(read('scripts/ui/MessageViewer/callsTab.js').includes('if (game.user.isGM && !actor?.hasPlayerOwner) {'), 'the rule sits in phoneBook (Speed dial, the Book and the dial-by-name all read it)');
}

console.log(`test-tester-round-2026-11-10: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
