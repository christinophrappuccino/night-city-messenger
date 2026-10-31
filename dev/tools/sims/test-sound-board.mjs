// Sim: the Sound board (2026-10-29) — the catalogue (every sound says where it plays), the replacement rules, the REAL
// SoundService honouring a replacement / a volume / Off, and the REAL template through Handlebars.
//   node dev/tools/sims/test-sound-board.mjs     (NCM_DUMP=<dir> writes sound-board.html)
import { pathToFileURL, fileURLToPath } from 'url';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { createRequire } from 'module';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const read = (p) => readFileSync(`${ROOT}/${p}`, 'utf8').replace(/\r\n/g, '\n');
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.error('FAIL:', m)); };

let overrides = {};
const played = [];
const hooks = {};
globalThis.game = {
  user: { isGM: true }, i18n: { localize: (s) => s },
  settings: { get: (m, k) => (k === 'soundOverrides' ? overrides : undefined) },
  audio: {},
};
globalThis.Hooks = { on: (n, f) => { (hooks[n] ||= []).push(f); }, off() {}, callAll() {} };
globalThis.ui = { notifications: { warn() {}, info() {}, error() {} } };
globalThis.foundry = { audio: { AudioHelper: { play: async (o) => { played.push(o); } } }, utils: { mergeObject: (a, b) => ({ ...a, ...b }) },
  applications: { api: { HandlebarsApplicationMixin: (B) => B, ApplicationV2: class {} }, instances: new Map() } };
globalThis.window = {};

const { SOUND_PATHS } = await imp('scripts/utils/constants.js');
const C = await imp('scripts/utils/soundCatalog.js');

// ═══ 1. The catalogue ═══
ok(!C.catalogueGaps().length, `every sound has a row saying where it plays (missing: ${C.catalogueGaps().join(', ')})`);
ok(Object.keys(C.SOUND_INFO).every((id) => SOUND_PATHS[id]), 'no catalogue row for a sound that does not exist');
ok(Object.values(C.SOUND_INFO).every((i) => i.label && i.where && C.SOUND_GROUPS.some(([k]) => k === i.group)), 'every row: a name, where it plays, a group');
// the "not used yet" list is honest: no play('<id>') for them anywhere in scripts/
{
  const { execSync } = await import('child_process');
  for (const id of Object.entries(C.SOUND_INFO).filter(([, i]) => i.group === 'other').map(([id]) => id)) {
    let hit = '';
    try { hit = execSync(`git grep -n -E "['\\"]${id}['\\"]" -- scripts`, { cwd: ROOT, encoding: 'utf8' }); } catch { hit = ''; }
    const real = hit.split('\n').filter((l) => l && !/constants\.js|soundCatalog\.js/.test(l));
    ok(!real.length, `"${id}" really is not played anywhere yet`);
  }
}

// ═══ 2. Replacement rules ═══
const S = C.sanitizeSoundOverrides({
  'receive': { src: 'worlds/w/sfx/ping.mp3', volume: 0.5 },
  'click': { src: 'javascript:alert(1)', volume: 9 },
  'nope': { src: 'x.ogg' },
  'send': { src: 'bad"name.ogg', off: true },
  'open': { src: 'https://example.com/a.wav', volume: 1 },
  'close': { src: 'not-audio.png' },
});
ok(S.receive.src === 'worlds/w/sfx/ping.mp3' && S.receive.volume === 0.5, 'a path + volume survive');
ok(!S.click.src && S.click.volume === 2, 'a script url is dropped; volume clamped to 200%');
ok(!S.nope && !S.close, 'unknown ids and non-audio files are dropped');
ok(S.send.off === true && !S.send.src, 'Off survives without a file; a path with a quote is dropped');
ok(S.open.src.startsWith('https://') && !('volume' in S.open), 'an http(s) file works; volume 100% is not stored');
const src = C.soundSource('receive', S);
ok(src.custom && src.src === 'worlds/w/sfx/ping.mp3' && src.volume === 0.5 && !src.off, 'what plays: the GM file at half volume');
ok(C.soundSource('switch', S).src === 'modules/night-city-messenger/assets/sounds/network/switch.ogg' && !C.soundSource('switch', S).custom, 'an unchanged sound plays the module’s own file');
const board = C.soundBoard(S);
ok(board.map((g) => g.key).join() === 'ui,mail,net,sec,shard,calls,other' && board.reduce((n, g) => n + g.rows.length, 0) === Object.keys(SOUND_PATHS).length, 'the board lists every sound, in groups');
ok(board.find((g) => g.key === 'mail').rows.find((r) => r.id === 'receive').file === 'ping.mp3', 'a replaced sound shows its file name');

// ═══ 3. The REAL SoundService ═══
const { SoundService } = await imp('scripts/services/SoundService.js');
const ss = new SoundService({ getTheme: () => ({ soundEnabled: true, soundVolume: 0.5 }) });
overrides = { receive: { src: 'worlds/w/sfx/ping.mp3', volume: 0.5 }, send: { off: true } };
await ss.play('receive');
ok(played.at(-1)?.src === 'worlds/w/sfx/ping.mp3' && Math.abs(played.at(-1).volume - 0.25) < 1e-9, 'play(): the GM’s file, at their volume × the player’s slider');
const n0 = played.length;
await ss.play('send');
ok(played.length === n0, 'play(): a sound switched off plays nothing');
await ss.play('switch');
ok(played.at(-1).src.endsWith('network/switch.ogg'), 'play(): an unchanged sound plays the module’s own');
overrides = {};
await ss.play('receive');
ok(played.at(-1).src.endsWith('messages/receive.ogg') === false, 'the cache holds until the setting changes…');
hooks.updateSetting.forEach((f) => f({ key: 'night-city-messenger.soundOverrides' }));
await ss.play('receive');
ok(played.at(-1).src.endsWith('messages/receive.ogg'), '…and a change on any client is picked up at once');
await ss.preview('receive', { src: 'worlds/w/try.ogg' });
ok(played.at(-1).src === 'worlds/w/try.ogg', 'preview() plays a file being tried out');
const svcSrc = read('scripts/services/SoundService.js');
ok(svcSrc.includes('const s = this.source(soundId);') && svcSrc.includes('fetch(s.src)') && svcSrc.includes('if (s?.off) return true;'), 'the varied player (clicks, terminal sound sets) uses the replacement too');

// ═══ 4. The board: template, wiring ═══
let H = null;
for (const p of ['C:/Program Files/Foundry Virtual Tabletop/resources/app/package.json', 'C:/Program Files (x86)/Foundry Virtual Tabletop/resources/app/package.json']) {
  if (!existsSync(p)) continue; try { H = createRequire(p)('handlebars'); break; } catch { /* keep looking */ }
}
if (!H) { fail++; console.error('FAIL: no Handlebars'); }
else {
  H.registerHelper('lower', (s) => String(s ?? '').toLowerCase());
  const html = H.compile(read('templates/sounds/sound-board.hbs'))({ groups: C.soundBoard(S), changed: Object.keys(S).length, total: 34, changedOnly: false, query: '', soundOn: true });
  ok((html.match(/data-sb-row/g) || []).length === Object.keys(SOUND_PATHS).length, 'every sound has a row');
  ok(html.includes('ping.mp3') && html.includes('>off</span>') && html.includes("module's own"), 'rows say what plays: your file, off, or the module’s own');
  const acts = new Set([...html.matchAll(/data-action="(\w+)"/g)].map((m) => m[1]));
  const js = read('scripts/ui/Sounds/SoundBoardApp.js');
  for (const a of acts) ok(js.includes(`${a}: SoundBoardApp._act`) && js.includes(`case '${a}'`), `action wired + handled: ${a}`);
  if (process.env.NCM_DUMP) writeFileSync(`${process.env.NCM_DUMP}/sound-board.html`, html);
}
const js = read('scripts/ui/Sounds/SoundBoardApp.js');
ok(js.includes('static ADMIN_THEMED = true') && js.includes('minimizable: true') && js.includes("type: 'audio'"), 'admin-themed, minimizable, Browse = Foundry’s audio file picker');
ok(read('scripts/core/SettingsManager.js').includes("'soundOverrides'") && read('scripts/utils/constants.js').includes('SOUND_BOARD:') && read('styles/night-city-messenger.css').includes("@import 'components/sound-board.css';"), 'setting, template, stylesheet registered');
ok(read('scripts/ui/AdminPanel/tabs/ToolsTab.js').includes('SoundBoardApp.open()') && read('templates/admin-panel/tab-tools.hbs').includes('<span class="ncm-tool-card__name">Sounds</span>'), 'Admin → Tools → Sounds opens it');
const css = read('styles/components/sound-board.css');
ok(!/#[0-9a-f]{3,8}\b/i.test(css), 'sound board CSS: tokens only');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
