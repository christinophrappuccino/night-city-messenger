// Sim: small compatibility fixes (audit remediation E4).
//   COMPAT-09  NCM skill rolls follow the chat roll mode (3D dice + chat card) — dev 2026-11-05
//   COMPAT-07  map notes are switched on once per user, then left alone — dev 2026-11-05
//   COMPAT-08  a canvas drop of a compendium item no longer throws in the terminal-pin handlers
//   COMPAT-10  chat-card buttons work in a popped-out chat log too
//   COMPAT-11  leftover unscoped selectors no longer style other modules' elements
// Drives the real module code with mocked Foundry globals.
import { pathToFileURL, fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const read = (p) => readFileSync(`${ROOT}/${p}`, 'utf8');
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const core = new Map([['rollMode', 'publicroll'], ['notesDisplayToggle', false]]);
const hooks = new Map();
const users = [{ id: 'gm', isGM: true }, { id: 'gm2', isGM: true }, { id: 'p1', isGM: false }];
globalThis.game = {
  user: users[2], users: Object.assign(users, { get: (id) => users.find((u) => u.id === id) }), world: { id: 'w' },
  settings: { get: (m, k) => (m === 'core' ? core.get(k) : true), set: async (m, k, v) => { if (m === 'core') core.set(k, v); return v; } },
  nightcity: {},
};
globalThis.foundry = { utils: { deepClone: (o) => JSON.parse(JSON.stringify(o)), mergeObject: (a, b) => ({ ...a, ...b }) } };
globalThis.Hooks = { on: (n, f) => { hooks.set(n, [...(hooks.get(n) || []), f]); return 1; }, off() {}, once: (n, f) => { hooks.set(n, [...(hooks.get(n) || []), f]); } };
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const chats = [];
globalThis.ChatMessage = { create: async (d) => { chats.push(d); return d; }, getSpeaker: () => ({ alias: 'V' }) };
globalThis.renderTemplate = async () => '<div>card</div>';

// ═══ 1. COMPAT-09 ═══
const { SkillService, rollModeAudience, currentRollMode } = await imp('scripts/services/SkillService.js');
{
  const g = { userId: 'p1', gmIds: ['gm', 'gm2'] };
  ok(same(rollModeAudience('publicroll', g), { whisper: null, blind: false }), 'public: everyone');
  ok(same(rollModeAudience('gmroll', g), { whisper: ['gm', 'gm2', 'p1'], blind: false }), 'GM roll: the GMs and the roller');
  ok(same(rollModeAudience('blindroll', g), { whisper: ['gm', 'gm2'], blind: true }), 'blind: the GMs only, hidden from the roller');
  ok(same(rollModeAudience('selfroll', g), { whisper: ['p1'], blind: false }), 'self: only the roller');
  core.set('rollMode', 'gmroll');
  ok(currentRollMode() === 'gmroll', 'the roll mode is read from the chat box setting');

  const svc = Object.create(SkillService.prototype);
  const thrown = [];
  game.dice3d = { showForRoll: async (...a) => { thrown.push(a.slice(2)); } };
  await svc._showDice3d([{}], 'blindroll');
  ok(same(thrown[0], [true, ['gm', 'gm2'], true]), 'Dice So Nice: a blind roll is thrown for the GMs only, hidden from the roller');
  thrown.length = 0;
  await svc._showDice3d([{}]);
  ok(same(thrown[0], [true, null, false]), 'a caller that names no mode still throws for everyone');

  await svc._postChatMessage({ name: 'V' }, 'Interface', { success: true, total: 14, dc: 12, rolls: [5], d10: 5 }, { rollMode: 'selfroll' });
  ok(same(chats.at(-1)?.whisper, ['p1']) && !chats.at(-1).blind, 'the chat card of a self roll is whispered to the roller');
  await svc._postChatMessage({ name: 'V' }, 'Interface', { success: true, total: 14, dc: 12, rolls: [5], d10: 5 }, { rollMode: 'publicroll' });
  ok(!('whisper' in chats.at(-1)), 'a public roll\'s card is public');
  const src = read('scripts/services/SkillService.js');
  ok(/const rollMode = options\.rollMode \|\| currentRollMode\(\);/.test(src) && /_showDice3d\(rollResult\.rolls, rollMode\)/.test(src) && /\{ flavor, context, rollMode \}/.test(src), 'performCheck hands the same mode to the dice and the card');
}

// ═══ 2. COMPAT-07 ═══
{
  const { TerminalScenePins } = await imp('scripts/integrations/TerminalScenePins.js');
  const pins = Object.create(TerminalScenePins.prototype);
  pins._autoShowMapNotes();
  await Promise.resolve();
  ok(core.get('notesDisplayToggle') === true, 'the first load switches map notes on');
  core.set('notesDisplayToggle', false);           // the user switches them off
  pins._autoShowMapNotes();
  await Promise.resolve();
  ok(core.get('notesDisplayToggle') === false, 'the next load leaves the user\'s choice alone');
  const pinSrc = read('scripts/integrations/TerminalScenePins.js');
  ok((pinSrc.match(/try \{ item = fromUuidSync\(data\.uuid\); \} catch \{ return; \}/g) || []).length === 2 && !/const item = fromUuidSync\(data\.uuid\)/.test(pinSrc), 'COMPAT-08: both drop handlers survive a uuid that cannot be resolved');
}

// ═══ 3. COMPAT-10 ═══
{
  const { ChatIntegration } = await imp('scripts/integrations/ChatIntegration.js');
  hooks.clear();
  ChatIntegration.register();
  const fire = (el) => (hooks.get('renderChatLog') || []).forEach((f) => f({}, [el]));
  const mk = () => { const el = { n: 0, addEventListener() { el.n += 1; } }; return el; };
  const sidebar = mk(), popout = mk();
  fire(sidebar); fire(sidebar); fire(popout);
  ok(sidebar.n === 1, 'the sidebar chat log is bound once, however often it re-renders');
  ok(popout.n === 1, 'a popped-out chat log is bound too');
}

// ═══ 4. COMPAT-11 ═══
{
  const calls = read('styles/components/calls-tab.css');
  ok(!/(^|\}\s*)\.mk-/m.test(calls) && /:where\(body:not\(\.vtt\)\) \.mk-tip/.test(calls), 'the mock-only .mk-* rules match only off Foundry');
  const mw = read('styles/components/malware-workshop.css');
  ok(!/(^|[,\s{}])\.fw-in/.test(mw.replace(/:where\(\.ncm-app\) \.fw-in/g, '')), '.fw-in only inside an NCM window');
  ok(!/^button\[data-rollp-step\]/m.test(read('styles/components/roll-panel.css')), 'the roll panel steppers are scoped to the panel');
  const term = read('styles/components/terminal.css');
  ok(!/^\s*\[data-boot-animation(="[a-z-]+")?\]\s*(::before)?\s*[{,]/m.test(term), 'no bare [data-boot-animation] root selector is left');
}

console.log(`test-compat-small: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
