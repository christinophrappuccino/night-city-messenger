// Sim: the ONE CRT film (2026-10-25, v2 the same day) — scripts/utils/crt.js:
// the looks + legacy aliases, the sparse block / effective layers model, the
// player's cap, the pane applyCrt builds, and the wiring guards: every old
// baked-in film is gone, all THREE theme UIs render the shared panel, every
// host paints its own window root, a terminal/shard switches the player's off.
// Run: node dev/tools/sims/test-crt.mjs
import fs from 'fs';
import { pathToFileURL, fileURLToPath } from 'url';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
let pass = 0, fail = 0;
const ok = (c, n) => { c ? pass++ : (fail++, console.error('FAIL:', n)); };
const read = (p) => fs.readFileSync(`${ROOT}/${p}`, 'utf8');
globalThis.game = { settings: { get: () => undefined }, i18n: { localize: (k) => k } };
globalThis.foundry = { utils: { deepClone: (o) => JSON.parse(JSON.stringify(o)), mergeObject: (a, b) => ({ ...a, ...b }), randomID: () => 'x' } };
globalThis.Hooks = { on() {}, once() {}, call() {}, callAll() {} };

const css_blur = () => /filter:s*blur/.test(read('styles/components/crt.css'));
const C = await import(pathToFileURL(ROOT + '/scripts/utils/crt.js').href);
const K = await import(pathToFileURL(ROOT + '/scripts/utils/constants.js').href);

// ── looks + legacy ──
ok(C.CRT_STYLES.map(s => s.key).join(',') === 'off,glass,tube,arcade', 'four looks, off first');
ok(C.CRT_STYLES.every(s => /^fa[sr]? fa-[a-z-]+$/.test(s.icon) && s.hint), 'every look has a full FA class + a hint');
ok(C.sanitizeCrt({ style: 'fine' }).style === 'glass' && C.sanitizeCrt({ style: 'classic' }).style === 'glass' && C.sanitizeCrt({ style: 'grille' }).style === 'arcade', 'v1 keys map: fine→glass classic→glass (the old player default) grille→arcade');
ok(C.sanitizeCrt({ style: 'phosphor' }).style === 'tube' && C.sanitizeCrt({ style: 'phosphor' }).roll === true, 'phosphor → tube WITH the rolling band');
ok(C.sanitizeCrt({ style: 'phosphor', roll: false }).roll === false, '…unless the band was explicitly off');
ok(C.resolveCrt({}).style === 'off', 'nothing configured → off');
ok(C.resolveCrt({ scanlines: true }).style === 'glass' && C.resolveCrt({ scanlines: true }).intensity === 35, 'legacy scanlines:true → glass 35');
ok(C.resolveCrt({ scanlines: false }).style === 'off', 'legacy scanlines:false → off');
ok(C.resolveCrt({ scanlines: true, crt: { style: 'arcade', intensity: 60 } }).style === 'arcade', 'an explicit crt block beats the legacy boolean');
ok(C.resolveCrt({}, { style: 'tube', intensity: 50 }).style === 'tube', 'fallback (a preset) when nothing is saved');
ok(C.resolveCrt({ crt: { style: 'glass' } }, { style: 'tube' }).style === 'glass', 'saved beats the preset fallback');
ok(C.sanitizeCrt({ style: 'bogus', intensity: 999 }).style === 'glass' && C.sanitizeCrt({ intensity: 999 }).intensity === 100, 'unknown style → glass; intensity caps at 100');
ok(C.sanitizeCrt({ intensity: -5 }).intensity === 0 && C.sanitizeCrt({ intensity: 'x' }).intensity === 35, 'intensity floors at 0, NaN → default');
ok(C.sanitizeCrt({ vignette: 'false' }).vignette === false && C.sanitizeCrt({ roll: 'true' }).roll === true, 'string booleans from the DOM read correctly');

// ── the sparse block / effective layers ──
const s1 = C.sanitizeCrt({ style: 'tube', pitch: 9, cut: 2, soft: 'x', bogusKey: 1 });
ok(s1.pitch === 6 && s1.cut === .7 && !('soft' in s1) && !('bogusKey' in s1), 'layer overrides clamp to their range; NaN and unknown keys are dropped (the block stays sparse)');
ok(C.CRT_LAYER_KEYS.every(k => C.CRT_LAYERS[k].min < C.CRT_LAYERS[k].max && C.CRT_LAYERS[k].label && C.CRT_LAYERS[k].hint), 'every layer has a range, a label and a hint');
ok(['off', 'glass', 'tube', 'arcade'].every(st => C.CRT_LAYER_KEYS.every(k => Number.isFinite(C.CRT_BASE[st][k]))), 'every look defines every layer');
ok(C.CRT_BASE.glass.soft >= .5 && C.CRT_BASE.tube.soft >= .6 && C.CRT_BASE.arcade.soft >= .45, 'softness raised for readability (dev: "increase that generally")');
ok(!css_blur() && C.CRT_BASE.glass.light <= .06 && C.CRT_BASE.tube.cut <= .2, 'tuned at 1x: no blur filter (it widened every line), faint lines'); ok(C.CRT_BASE.glass.cut < C.CRT_BASE.tube.cut && C.CRT_BASE.glass.fringe === 0 && C.CRT_BASE.tube.bezel > 0 && C.CRT_BASE.glass.bezel === 0, 'glass is the light look (little cut, no fringe, no bezel); tube is the full CRT');
const e35 = C.effectiveCrt({ style: 'tube', intensity: 35 });
const e70 = C.effectiveCrt({ style: 'tube', intensity: 70 });
ok(e35.cut === C.CRT_BASE.tube.cut && e35.pitch === 3, 'intensity 35 = the look as designed');
ok(Math.abs(e70.cut - Math.min(.7, C.CRT_BASE.tube.cut * 2)) < 1e-6 && e70.pitch === e35.pitch && e70.soft === e35.soft, 'intensity scales the strength layers, never the geometry');
ok(C.effectiveCrt({ style: 'tube', intensity: 35, vignette: false }).vignette === 0, 'vignette off → 0');
ok(C.effectiveCrt({ style: 'glass', intensity: 35, cut: .5 }).cut === .5, 'an override replaces the look\'s value');
ok(C.effectiveCrt({ style: 'off', intensity: 80 }).light === 0 && C.effectiveCrt({ style: 'off' }).roll === false, 'off paints nothing whatever the intensity');
ok(C.effectiveCrt({ style: 'tube', intensity: 35 }).bezelOn === true && C.effectiveCrt({ style: 'tube', intensity: 35, bezel: 0 }).bezelOn === false, 'bezel is on when its width is > 0');

// ── the cap (accessibility) ──
const authored = { style: 'tube', intensity: 60, roll: true };
ok(C.capCrt(authored, 'asis').intensity === 60 && C.capCrt(authored, 'asis').roll === true, 'asis leaves the author\'s film alone');
ok(C.capCrt(authored, 'dim').intensity === 30 && C.capCrt(authored, 'dim').roll === false && C.capCrt(authored, 'dim').flicker === 0 && C.capCrt(authored, 'dim').grain === 0, 'dim halves intensity and stops every motion layer');
ok(C.capCrt(authored, 'off').style === 'off', 'off removes it');
ok(C.capCrt({ style: 'off' }, 'asis').style === 'off', 'the cap never RAISES a film');
ok(C.playerCrtCap() === 'asis', 'no prefs → asis');
globalThis.game.nightcity = { settingsManager: { getTheme: () => ({ crtCap: 'dim' }) } };
ok(C.playerCrtCap() === 'dim', 'reads playerTheme.crtCap');
globalThis.game.nightcity.settingsManager.getTheme = () => ({ crtCap: 'nope' });
ok(C.playerCrtCap() === 'asis', 'an unknown cap reads as asis');
ok(C.CRT_CAPS.map(c => c.key).join(',') === 'asis,dim,off', 'the three caps');
ok(K.DEFAULTS.PLAYER_THEME.crtCap === 'asis' && K.DEFAULTS.PLAYER_THEME.crt.style === 'glass', 'player default: glass film, cap as designed');

// ── attrs + the pane ──
const a = C.crtAttrs({ style: 'arcade', intensity: 45, roll: true });
ok(a['data-ncm-crt'] === 'arcade' && a['data-ncm-crt-roll'] === 'true' && a['--ncm-crt-pitch'] === '3px' && a['--ncm-crt-curve'].endsWith('%') && a['--ncm-crt-grille'] !== '0', 'crtAttrs: style, band, pitch in px, curve in %, grille on for arcade');
ok(C.crtAttrs(null)['data-ncm-crt'] === 'off', 'crtAttrs(null) → off');
// a fake element with just enough DOM
const mkEl = () => { const el = { attrs: {}, children: [], style: { setProperty(k, v) { el.attrs[k] = v; } }, setAttribute(k, v) { el.attrs[k] = v; }, querySelector(sel) { return sel.includes('.ncm-crt-pane') ? (el.children.find(c => c.className === 'ncm-crt-pane') || null) : null; }, appendChild(c) { el.children = el.children.filter(x => x !== c); el.children.push(c); c.remove = () => { el.children = el.children.filter(x => x !== c); }; }, get lastElementChild() { return el.children[el.children.length - 1] || null; } }; return el; };
globalThis.document = { createElement: () => ({ className: '', innerHTML: '', setAttribute() {}, remove() {} }) };
const fake = mkEl();
C.applyCrt(fake, { style: 'tube', intensity: 50 });
ok(fake.attrs['data-ncm-crt'] === 'tube' && fake.attrs['--ncm-crt-cut'] && fake.children.length === 1 && fake.children[0].className === 'ncm-crt-pane', 'applyCrt stamps attrs + vars and builds ONE pane');
ok(fake.children[0].innerHTML.includes('ncm-crt__cut') && fake.children[0].innerHTML.includes('ncm-crt__bezel'), 'the pane carries every layer');
C.applyCrt(fake, { style: 'glass' });
ok(fake.children.length === 1, 'a second apply reuses the pane');
C.applyCrt(fake, { style: 'off' });
ok(fake.children.length === 0 && fake.attrs['data-ncm-crt'] === 'off', 'off removes the pane');
C.applyCrt(null, {}); ok(true, 'applyCrt(null) is a no-op');
const bare = { attrs: {}, style: { setProperty(k, v) { bare.attrs[k] = v; } }, setAttribute(k, v) { bare.attrs[k] = v; } };
C.applyCrt(bare, { style: 'glass' }); ok(bare.attrs['data-ncm-crt'] === 'glass', 'a host without querySelector still gets its attributes');

// ── the panel context ──
const pc = C.crtPanelContext({ style: 'glass', intensity: 40, cut: .3 });
ok(pc.styles.find(s => s.active).key === 'glass' && pc.layers.length === C.CRT_LAYER_KEYS.length && pc.layers.find(l => l.key === 'cut').value === .3 && pc.layers.find(l => l.key === 'cut').overridden && !pc.layers.find(l => l.key === 'pitch').overridden && pc.hasOverrides, 'crtPanelContext: active chip, one row per layer, overrides marked');

// ── stylesheet ──
const css = read('styles/components/crt.css');
ok(['cut', 'light', 'grille', 'room', 'grain', 'roll', 'bezel'].every(k => css.includes(`.ncm-crt__${k}`)), 'crt.css paints every pane layer');
ok(css.includes('mix-blend-mode: screen') && css.includes('mix-blend-mode: multiply'), 'light lines screen, the cut multiplies (lines live in the dark; the cut shows across glyphs)');
ok(css.includes('mask-image') && css.includes('--ncm-crt-curve'), 'curvature masks the raster toward the edges');
ok(css.includes('text-shadow') && css.includes('--ncm-crt-glow') && css.includes('--ncm-crt-fringe'), 'glow + fringe ride a text-shadow on the host');
ok(css.includes('[data-ncm-admin-theme] .ncm-crt-pane') && css.includes('prefers-reduced-motion'), 'admin hosts never show it; reduced motion stops the motion layers');
ok(!css.includes('::after') && !css.includes('::before'), 'the pane is real DOM — no pseudo-element film left');
ok(read('styles/night-city-messenger.css').includes('components/crt.css'), 'crt.css imported');
// the old films are gone
const term = read('styles/components/terminal.css');
ok(!term.includes('.ncm-terminal-viewer::after {') && !term.includes('data-term-scanlines'), 'terminal.css: always-on film + Scanlines-switch film removed');
ok(!read('styles/base/atmosphere.css').includes('data-ncm-scanlines="true"]::after'), 'atmosphere.css: the player film removed');
ok(!read('styles/components/item-inbox.css').includes('.ncm-app .ncm-item-inbox::after {'), 'item-inbox.css: the shard root film removed');

// ── the three hosts render the shared panel and wire it ──
ok(K.TEMPLATES.CRT_PANEL?.endsWith('partials/crt-panel.hbs') && fs.existsSync(`${ROOT}/templates/partials/crt-panel.hbs`), 'TEMPLATES.CRT_PANEL exists on disk');
const panel = read('templates/partials/crt-panel.hbs');
ok(panel.includes('data-crt-panel') && panel.includes('data-crt-style') && panel.includes('data-crt-intensity') && panel.includes('data-crt-toggle="vignette"') && panel.includes('data-crt-toggle="roll"') && panel.includes('data-crt-k="{{key}}"') && panel.includes('data-crt-adv') && panel.includes('data-crt-reset'), 'the partial carries chips, intensity, switches, an Advanced fold of layer sliders and Reset');
for (const [label, hbs, js, key] of [
  ['Theme Customizer', 'templates/theme-customizer/theme-customizer.hbs', 'scripts/ui/ThemeCustomizer/ThemeCustomizerApp.js', 'crt=crt'],
  ['terminal config', 'templates/terminal/terminal-config.hbs', 'scripts/ui/Terminal/TerminalConfigApp.js', 'crt=themeCrt'],
  ['shard config', 'templates/item-inbox/item-inbox-config.hbs', 'scripts/ui/ItemInbox/ItemInboxConfig.js', 'crt=themeCrt'],
]) {
  const h = read(hbs), j = read(js);
  ok(h.includes(`partials/crt-panel.hbs" ${key}}}`), `${label} renders the shared panel`);
  ok(j.includes('wireCrtPanel(') && j.includes('crtPanelContext('), `${label} wires it through crt.js`);
  ok(!h.includes('data-ttc-crt=') && !h.includes('data-action="setCrtStyle"'), `${label}: the old private CRT rows are gone`);
}
ok(read('templates/theme-customizer/theme-customizer.hbs').includes('name="crtCap"') && read('scripts/ui/ThemeCustomizer/ThemeCustomizerApp.js').includes("this._workingPrefs.crtCap ="), 'the Theme Customizer offers the cap (Film on terminals & shards) and saves it with the theme');

// ── hosts paint their own window root ──
const tv = read('scripts/ui/Terminal/TerminalViewerApp.js');
ok(/refreshCrt\(opts = \{\}\)[\s\S]*applyCrt\(this\.element, capCrt\(resolveCrt\(theme, presetCrt\), opts\.cap \?\? playerCrtCap\(\)\)\)/.test(tv), 'the terminal paints ITS film on the window root, capped by the player');
ok(tv.includes('applyCrt(viewerEl, CRT_OFF)'), 'the terminal viewer element carries none (one pane per window)');
const sv = read('scripts/ui/ItemInbox/ItemInboxApp.js');
ok(/refreshCrt\(opts = \{\}\)[\s\S]*SHARD_PRESETS\[preset\]\?\.crt[\s\S]*playerCrtCap\(\)/.test(sv) && sv.includes("this.refreshCrt({ theme: context.shardTheme, preset: context.presetKey || 'blank' })"), 'the shard paints ITS film (theme.crt, else the preset\'s) on the window root, capped by the player');
ok(Object.values(K.SHARD_PRESETS).every(p => p.crt && C.CRT_STYLES.some(s => s.key === p.crt.style)), 'every shard preset carries a crt block with a known look');
const presetCrts = [...Object.values(K.SHARD_PRESETS).map(p => p.crt), ...Object.values(K.TERMINAL_PRESETS).map(p => p.theme.crt)].filter(c => c.style !== 'off');
ok(presetCrts.every(c => c.intensity <= 30 && c.roll === true), 'built-in terminal + shard films stay subtle (intensity <= 30) and move (dev: "adjust it for shards and terminals too")');
ok(Object.values(K.TERMINAL_PRESETS).every(p => p.theme?.crt && C.CRT_STYLES.some(s => s.key === p.theme.crt.style)), 'every terminal preset carries a v2 look (no legacy keys left in constants)');
const base = read('scripts/ui/BaseApplication.js');
ok(base.includes("applyCrt(el, prefs.scanlines === false ? CRT_OFF : resolveCrt(prefs))"), 'BaseApplication stamps the player film on every window root');
const tc = read('scripts/ui/ThemeCustomizer/ThemeCustomizerApp.js');
ok(tc.includes("el.classList.contains('ncm-terminal-app') || el.classList.contains('ncm-item-inbox')") && tc.includes('app.refreshCrt({ cap: this._workingPrefs.crtCap })'), 'the Theme Customizer leaves machines/shards to their own film and previews the cap on them');
const ic = read('scripts/ui/ItemInbox/ItemInboxConfig.js');
ok(ic.includes("delete d.crt;") && ic.includes('app.refreshCrt?.({ theme, preset: presetKey })'), 'shard config: a preset card brings its own film; the draft previews on open viewers');

// ── taming stored films + the leftovers (2026-10-25, third pass) ──
ok(C.tameCrtBlock({ style: 'classic', intensity: 55, vignette: true, roll: false }).style === 'glass' && C.tameCrtBlock({ style: 'classic', intensity: 55 }).intensity === 25 && C.tameCrtBlock({ style: 'classic', intensity: 55 }).roll === true, 'tame: legacy classic → glass, capped at 25, band on');
ok(C.tameCrtBlock({ style: 'phosphor', intensity: 50 }).intensity === 30 && C.tameCrtBlock({ style: 'grille', intensity: 45 }).style === 'arcade', 'tame: tube/arcade cap at 30');
ok(C.tameCrtBlock({ style: 'glass', intensity: 20, vignette: true, roll: true }) === null, 'tame: an already-tame block is left alone (null = no write)');
ok(C.tameCrtBlock({ style: 'off', intensity: 0, vignette: false, roll: false }) === null, 'tame: off stays off');
const lib = [{ name: 'a', theme: { crt: { style: 'tube', intensity: 55 } } }, { name: 'b', config: { theme: { crt: { style: 'glass', intensity: 20, roll: true, vignette: true } } } }];
ok(C.tameCrtDeep(lib) === 1 && lib[0].theme.crt.intensity === 30, 'tameCrtDeep walks saved themes / libraries and counts only real changes');
const mr = read('scripts/core/MigrationRunner.js');
ok(/DATA_SCHEMA_VERSION = 2;/.test(mr) && mr.includes('to: 2,') && mr.includes('tameCrtDeep(copy)') && ['terminalThemePresets', 'terminalPresetLibrary', 'shardThemePresets', 'shardPresetLibrary'].every(k => mr.includes(`'${k}'`)), 'migration v2 tames stored films on items (world + actor) and in all four libraries');
const termCss = read('styles/components/terminal.css');
ok(!/\.ncm-term__hero::after \{[^}]*repeating-linear-gradient/.test(termCss) && !/\.ncm-term__console::after \{[^}]*repeating-linear-gradient/.test(termCss) && !/\.ncm-term__crt::after \{[^}]*repeating-linear-gradient/.test(termCss), 'terminal.css: the hero, console and CRT-login baked line films are gone');
ok(/\.ncm-crt__light \{[\s\S]*?var\(--ncm-primary/.test(css), 'the light line takes the machine colour — it vanishes on primary fills (active tab, selected row)');

ok(!fs.existsSync(ROOT + '/styles/effects/scanlines.css') && !read('styles/night-city-messenger.css').includes("@import 'effects/scanlines.css'"), 'the legacy body-class film (effects/scanlines.css) is deleted — it drew lines over the terminal viewer whatever its CRT setting');
console.log(`${fail ? '⚠️' : '✅'} test-crt: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
