// Sim: the ROLL REVEAL + roll timing (2026-10-27). Rules under test:
//   · every skill check waits for Dice So Nice before the result is returned
//     (and before anything reveals it), crit/fumble second dice included;
//   · the chat card posts AFTER the player has seen the result — at the shared
//     reveal's verdict (`reveal`), or at the caller's own climax (`deferChat` →
//     result.postChat(), idempotent);
//   · the beat windows of the reveal stay ordered and inside 0..1;
//   · every roll WITHOUT an animation passes `reveal`, every roll WITH one
//     defers its chat card to its climax.
// Drives the REAL SkillService.performCheck over a mocked Roll / ChatMessage /
// game.dice3d, plus wiring guards. Visual probe: dev/mockups/roll-reveal-probe.html.
// Run: node dev/tools/sims/test-roll-reveal.mjs
import fs from 'fs';
import { pathToFileURL, fileURLToPath } from 'url';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };
const read = (p) => fs.readFileSync(`${ROOT}/${p}`, 'utf8');
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);

// ── mocks ──
const events = [];
let queue = [];
globalThis.Roll = class { constructor(f) { this.formula = f; } async evaluate() { this.total = queue.shift() ?? 5; return this; } };
globalThis.renderTemplate = async () => '<div>card</div>';
globalThis.ChatMessage = { create: async () => { events.push('chat'); }, getSpeaker: () => ({}) };
globalThis.game = {
  user: { id: 'u1', isGM: false }, settings: { get: () => undefined },
  nightcity: { networkService: { getCurrentNetworkName: () => 'CITINET' } },
  dice3d: null,
};
globalThis.foundry = { utils: { deepClone: (o) => JSON.parse(JSON.stringify(o)) } };

const { SkillService } = await imp('scripts/services/SkillService.js');
const svc = Object.create(SkillService.prototype);
svc._readSkillData = () => ({ skillLevel: 4, statName: 'tech', statValue: 6, _found: true });
svc._getAvailableLuck = () => 0;
const actor = { id: 'a', name: 'V', img: '', system: {} };

// 1. no DSN, default → posts immediately
events.length = 0; queue = [7];
let r = await svc.performCheck(actor, 'Interface', { dc: 15 });
ok(events.join() === 'chat' && r.total === 17 && r.success, 'default: rolls and posts');

// 2. deferChat → nothing until postChat, which is idempotent
events.length = 0; queue = [3];
r = await svc.performCheck(actor, 'Interface', { dc: 15, deferChat: true });
ok(events.length === 0, 'deferChat: no chat card yet');
await r.postChat(); await r.postChat();
ok(events.join() === 'chat', 'postChat posts once, however often it is called');

// 3. showChat:false + postChat → never posts
events.length = 0; queue = [3];
r = await svc.performCheck(actor, 'Interface', { dc: 15, showChat: false, deferChat: true });
await r.postChat();
ok(events.length === 0, 'showChat:false never posts');

// 4. Dice So Nice: awaited BEFORE the method returns; crit rolls both dice
const shown = [];
game.dice3d = { showForRoll: (roll) => new Promise((res) => setTimeout(() => { shown.push(roll.total); events.push(`dsn:${roll.total}`); res(true); }, 5)) };
events.length = 0; queue = [10, 6];
r = await svc.performCheck(actor, 'Interface', { dc: 20, deferChat: true });
events.push('returned');
ok(events.join() === 'dsn:10,dsn:6,returned', 'DSN plays every die (crit + bonus) before performCheck returns');
ok(r.isCritical && r.processedRoll === 16 && r.total === 26, 'crit explodes: 10 + 6');
events.length = 0; queue = [1, 7];
r = await svc.performCheck(actor, 'Interface', { dc: 15 });
ok(events.join() === 'dsn:1,dsn:7,chat', 'fumble: both dice, then the chat card');
ok(r.isFumble && r.processedRoll === -6, 'fumble subtracts the second die');
queue = [5]; events.length = 0;
await svc.performCheck(actor, 'Interface', { dc: 15, dice3d: false });
ok(events.join() === 'chat', 'dice3d:false skips DSN');
game.dice3d = { showForRoll: () => Promise.reject(new Error('boom')) };
queue = [5]; events.length = 0;
r = await svc.performCheck(actor, 'Interface', { dc: 15 });
ok(events.join() === 'chat' && r.total === 15, 'a failing DSN never blocks the roll');
game.dice3d = null;
ok(/Promise\.race\(\[d3\.showForRoll/.test(read('scripts/services/SkillService.js')), 'DSN wait is capped (a stuck DSN cannot hang a login)');

// 5. reveal → the chat card fires from the reveal (stub the module's DOM need by host:null → body missing)
const RR = await imp('scripts/ui/content/RollReveal.js');
for (const second of [false, true]) {
  const S = RR.revealStages(second);
  const order = ['open', 'stat', 'skill', 'die', 'count', 'verdict', 'chat'];
  ok(Object.values(S).every(([a, b]) => a >= 0 && b <= 1 && a <= b), `stages inside 0..1 (${second ? 'second die' : 'plain'})`);
  ok(order.every((k, i) => i === 0 || S[k][0] >= S[order[i - 1]][0]), `beats in order (${second ? 'second die' : 'plain'})`);
  ok(S.chat[0] >= S.verdict[1], `chat after the verdict has landed (${second ? 'second die' : 'plain'})`);
  if (second) ok(S.die2[0] >= S.flag[0] && S.count[0] >= S.die2[1], 'second die between the flag and the count');
}
const rrSrc = read('scripts/ui/content/RollReveal.js');
const css = read('styles/components/roll-reveal.css');
ok(/const FADE_MS = 200;/.test(rrSrc) && /transition: opacity \.2s/.test(css), 'FADE_MS matches the CSS fade');
ok(/capTimer = setTimeout\(land, duration \+ 400\)/.test(rrSrc), 'a wall clock lands the reveal when rAF stalls');
ok(/motionVetoed\(\)\) \{ fired\.add\('spin'\); land\(\)/.test(rrSrc), 'reduced motion: straight to the verdict, no stacked spin sound');
ok(read('styles/night-city-messenger.css').includes("@import 'components/roll-reveal.css'"), 'stylesheet imported');
ok(!/#[0-9a-f]{3,6}\b(?![^;]*var\()/i.test(css.replace(/var\([^)]*\)/g, '').replace(/rgba\([^)]*\)/g, '')), 'roll-reveal.css: every colour is a token (fallbacks inside var())');
const sk = read('scripts/services/SkillService.js');
ok(/if \(reveal\) \{\s*await playRollReveal\(/.test(sk) && /onChat: \(\) => result\.postChat\(\)/.test(sk), 'SkillService: reveal posts from the verdict');

// 6. wiring — rolls without an animation get the reveal
const REVEAL = {
  'scripts/ui/NetworkManagement/NetworkAuthDialog.js': 'reveal: {',
  'scripts/ui/Terminal/TerminalViewerApp.js': 'reveal: { host: this.element',
  'scripts/ui/MessageViewer/MessageViewerApp.js': "reveal: { host: this.element, title: 'Triangulating the relay'",
  'scripts/services/MessageAccessService.js': 'reveal: reveal ?',
  'scripts/ui/ItemInbox/ItemInboxApp.js': "reveal: { host: this.element, title: 'Decrypting the entry'",
};
for (const [f, needle] of Object.entries(REVEAL)) ok(read(f).includes(needle), `${f.split('/').pop()} plays the reveal`);
const tv = read('scripts/ui/Terminal/TerminalViewerApp.js');
ok((tv.match(/reveal: \{ host: this\.element/g) || []).length === 3, 'terminal: bypass, spoof and join all reveal');
ok(read('scripts/ui/MessageViewer/MessageViewerApp.js').includes("title: 'Breaking the message cipher'"), 'message decrypt without the cipher grid reveals');
ok(read('scripts/ui/NetworkManagement/NetworkAuthDialog.js').includes('checkSkill(total, skillName, { silent: !!this._revealPlayed })'), 'network dialog: the reveal owns the outcome sound');

// 7. wiring — rolls WITH an animation defer the card to their climax
const DEFER = [
  ['scripts/ui/content/SecurityConsole.js', 'deferChat: true', 'await rolled?.postChat?.()'],
  ['scripts/ui/content/BankHeist.js', 'deferChat: true', 'await rolled?.postChat?.()'],
  ['scripts/ui/content/SystemSweep.js', 'deferChat: true', 'rolled?.postChat?.()'],
  ['scripts/ui/MessageViewer/MessageViewerApp.js', 'deferChat: true,   // posted when the result card lands', 'await result?.roll?.postChat?.()'],
  ['scripts/ui/MessageViewer/MessageViewerApp.js', "context: 'ncm-signal-reconstruct',\n      deferChat: true", 'await result?.postChat?.()'],
  ['scripts/ui/ContactManager/ContactManagerApp.js', 'deferChat: true }', 'await result.postChat?.()'],
  ['scripts/ui/ItemInbox/ItemInboxApp.js', 'deferChat: true,   // posted after _playLayerHackSequence', 'await rollResult.postChat?.()'],
  ['scripts/ui/ItemInbox/ItemInboxApp.js', 'silent: true', 'finally { await result?.postChat?.(); }'],
];
for (const [f, a, b] of DEFER) {
  const src = read(f).replace(/\r\n/g, '\n');
  ok(src.includes(a) && src.includes(b), `${f.split('/').pop()}: defers the card (${b.slice(0, 32)}…)`);
}
const ds = read('scripts/services/DataShardService.js');
ok(ds.includes('deferChat: !!options.silent && !options.reveal') && (ds.match(/\.postChat = rollResult\.postChat/g) || []).length === 2, 'shard breach: the animated caller gets postChat on both outcomes');
const cb = read('scripts/services/ContactBreachService.js');
ok(cb.includes('deferChat: !!options.deferChat') && (cb.match(/postChat: rollResult\.postChat/g) || []).length === 2, 'contact breach: postChat on both outcomes');
const ms = read('scripts/services/MessageService.js');
ok(ms.includes('if (!quiet) this.soundService?.play(\'hack-success\')') && ms.includes('if (!quiet) ui.notifications.warn(`NCM | Decryption failed.'), 'message decrypt: no early sound or toast while the grid is still rolling');

// 8. no caller left that rolls with an immediate card and then animates
const callers = ['scripts/ui/content/SecurityConsole.js', 'scripts/ui/content/BankHeist.js', 'scripts/ui/content/SystemSweep.js'];
for (const f of callers) ok(!/performCheck\([^)]*\{[^}]*showChat: true,\s*context/.test(read(f)) || read(f).includes('deferChat'), `${f.split('/').pop()}: no undeferred animated roll`);

console.log(`test-roll-reveal: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
