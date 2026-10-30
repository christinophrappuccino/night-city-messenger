// Sim: hidden characters (tester 2026-10-30: "PC owned Actors for Vehicles and such
// that I would prefer to hide from the list of things like Who Knows Who").
//   • getPlayerCharacters / getOperatorActors / resolveOperator leave a hidden actor out,
//     and the real PCs stay in.
//   • the hide picker can still reach them (includeHidden).
//   • ToolsTab.onManageHiddenCharacters saves, keeps what it can't list, and treats a
//     dismissed picker as no change.
//   • every other list and door is wired (source guards).
//   node dev/tools/sims/test-hidden-characters.mjs
import { readFileSync } from 'fs';
import { pathToFileURL, fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const read = (p) => readFileSync(`${ROOT}/${p}`, 'utf8');
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };

const MOD = 'night-city-messenger';
const mkActor = (id, name, owners = [], type = 'character') => ({
  id, name, type, img: `${id}.webp`, isOwner: owners.includes('u1'),
  get hasPlayerOwner() { return owners.length > 0; },
  testUserPermission: (u, level) => level === 'OWNER' && owners.includes(u.id),
  getFlag: () => undefined,
});
const vee = mkActor('vee', 'V', ['u1']);
const rache = mkActor('rache', 'Rache', ['u2']);
const van = mkActor('van', 'Combat Van', ['u1']);
const fixer = mkActor('fixer', 'Rogue');
const ice = mkActor('ice', 'Hellhound', ['u1'], 'blackIce');
const actors = [vee, rache, van, fixer, ice];

const store = { hiddenCharacters: [], operatorActorId: '' };
const toasts = [];
globalThis.game = {
  user: { id: 'gm', isGM: true, character: null },
  users: [{ id: 'gm', isGM: true, name: 'GM' }, { id: 'u1', isGM: false, name: 'Ann', character: vee }, { id: 'u2', isGM: false, name: 'Bo', character: null }],
  actors: Object.assign([...actors], { contents: actors, get: (id) => actors.find((a) => a.id === id), has: (id) => actors.some((a) => a.id === id) }),
  settings: {
    get: (m, k) => { if (m !== MOD || !(k in store)) throw new Error(`unregistered ${k}`); return store[k]; },
    set: async (m, k, v) => { store[k] = v; return v; },
  },
  nightcity: {},
  i18n: { localize: (s) => s },
};
globalThis.ui = { notifications: { info: (m) => toasts.push(m), warn: (m) => toasts.push(m), error: (m) => toasts.push(m) } };
globalThis.foundry = { utils: { randomID: () => 'x' }, applications: { api: {} } };
globalThis.Hooks = { on() {}, once() {}, off() {}, call() {}, callAll() {} };

const h = await import(pathToFileURL(`${ROOT}/scripts/utils/helpers.js`).href);
const names = (rows) => rows.map((r) => r.actorName).sort();

// ── Nothing hidden: unchanged ──
ok(names(h.getPlayerCharacters()).join() === 'Combat Van,Rache,V', 'nothing hidden lists every owned person');
ok(!h.isHiddenCharacter('van'), 'van not hidden yet');
ok(!h.isHiddenCharacter(''), 'an empty id is never hidden');

// ── Hide the van ──
store.hiddenCharacters = ['van'];
ok(names(h.getPlayerCharacters()).join() === 'Rache,V', 'the van leaves, the PCs stay');
ok(names(h.getPlayerCharacters({ includeHidden: true })).join() === 'Combat Van,Rache,V', 'the picker list still reaches it');
ok(!names(h.getPlayerCharacters({ includeHidden: true })).includes('Hellhound'), 'non-person types stay out either way');
ok(!h.getOperatorActors().some((a) => a.id === 'van'), 'GM operator picker skips it');

// ── An assigned character can be hidden too, when the GM says so ──
store.hiddenCharacters = ['vee'];
ok(names(h.getPlayerCharacters()).join() === 'Combat Van,Rache', 'an assigned character hides on request');
store.hiddenCharacters = ['van'];

// ── A player: their only remaining actor resolves, a remembered hidden pick does not ──
game.user = { id: 'u1', isGM: false, character: null };
ok(h.getOperatorActors().map((a) => a.id).join() === 'vee', 'player picker skips the hidden van');
ok(h.resolveOperator()?.id === 'vee', 'the sole remaining owned actor is the operator');
store.operatorActorId = 'van';
ok(h.resolveOperator()?.id === 'vee', 'a remembered hidden pick is ignored');
store.operatorActorId = '';
game.user = game.users[0];

// ── A missing setting never throws ──
const saved = store.hiddenCharacters; delete store.hiddenCharacters;
ok(h.hiddenCharacterIds().size === 0, 'unregistered setting reads as nothing hidden');
ok(names(h.getPlayerCharacters()).length === 3, 'list still works before the setting exists');
store.hiddenCharacters = saved;

// ── The Tools handler, with the picker's rules read from the source ──
const tools = read('scripts/ui/AdminPanel/tabs/ToolsTab.js');
const body = tools.slice(tools.indexOf('async onManageHiddenCharacters()'), tools.indexOf('async onOpenSoundSettings'));
const run = async (pickerResult) => {
  let opened = null;
  const AsyncFunction = (async () => {}).constructor;
  const inner = body.slice(body.indexOf('{') + 1, body.lastIndexOf('}'));
  const fn = new AsyncFunction('hiddenCharacterIds', 'getPlayerCharacters', 'showNamePicker', 'MODULE_ID', 'game', 'ui', inner);
  const self = { render() {} };
  await fn.call(self, h.hiddenCharacterIds, h.getPlayerCharacters, async (o) => { opened = o; return pickerResult; }, MOD, game, ui);
  return opened;
};
store.hiddenCharacters = ['van'];
const opened = await run(null);
ok(store.hiddenCharacters.join() === 'van', 'dismissing the picker changes nothing');
ok(opened.preselected.has('van') && opened.multi, 'the picker opens with the current list ticked');
ok(opened.entries.some((e) => e.id === 'van'), 'a hidden actor is listed so it can come back');
await run([]);
ok(store.hiddenCharacters.length === 0, 'saving nothing ticked clears the list');
await run([{ id: 'rache' }]);
ok(store.hiddenCharacters.join() === 'rache', 'a save writes the picks');
store.hiddenCharacters = ['fixer'];
await run([{ id: 'van' }]);
ok(store.hiddenCharacters.sort().join() === 'fixer,van', 'an actor that lost its owner stays hidden');
store.hiddenCharacters = ['gone'];
await run([]);
ok(store.hiddenCharacters.length === 0, 'a deleted actor is pruned');

// ── Picker contract ──
const picker = read('scripts/utils/namePicker.js');
ok(picker.includes("(preselected ? null : [])"), 'a preselected picker tells dismiss from an empty save');
ok(picker.includes("startTicked.has(e.id) ? ' is-picked'"), 'preselected rows start ticked');
ok(picker.includes('${esc(doneLabel)}'), 'the Done label is the caller\'s');

// ── Wiring ──
ok(read('scripts/core/SettingsManager.js').includes("'hiddenCharacters'"), 'setting registered');
const hbs = read('templates/admin-panel/tab-tools.hbs');
ok(hbs.includes('data-action="manageHiddenCharacters"'), 'Tools card');
ok(hbs.includes('{{hiddenCharacterCount}}') && tools.includes('hiddenCharacterCount:'), 'count reaches the card');
const app = read('scripts/ui/AdminPanel/AdminPanelApp.js');
ok(app.includes('manageHiddenCharacters: AdminPanelApp._onManageHiddenCharacters') && app.includes('static async _onManageHiddenCharacters'), 'action + delegator');
ok(read('templates/admin-panel/tab-contacts.hbs').includes('data-op="pHide"') && read('scripts/ui/AdminPanel/tabs/ContactsTab.js').includes("case 'pHide'"), 'Players → Hide');
for (const [file, n] of [
  ['scripts/services/SpamService.js', 1], ['scripts/ui/CharacterSelect/CharacterSelectApp.js', 2],
  ['scripts/ui/Terminal/TerminalViewerApp.js', 2], ['scripts/ui/ShardEncoder/EncoderConfigApp.js', 1],
  ['scripts/ui/AdminPanel/tabs/OverviewTab.js', 1], ['scripts/ui/MessageComposer/MessageComposerApp.js', 3],
  ['scripts/ui/MessageViewer/MessageViewerApp.js', 2], ['scripts/data/ContactRepository.js', 1],
]) {
  const uses = (read(file).match(/isHiddenCharacter\(/g) || []).length;
  ok(uses >= n, `${file} checks it (${uses}/${n})`);
  ok(read(file).includes('isHiddenCharacter') && /import \{[^}]*isHiddenCharacter[^}]*\} from '[^']*helpers\.js'/.test(read(file)), `${file} imports it`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
