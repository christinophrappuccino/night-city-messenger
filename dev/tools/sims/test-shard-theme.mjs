/**
 * Shard theming — the palette move and the Theme tab.
 * @file dev/tools/sims/test-shard-theme.mjs
 * @description Drives the REAL `buildShardThemePrefs` and the REAL preset data,
 *   then compiles the REAL item-inbox-config.hbs to check the Theme tab's save
 *   contract against the JS that reads it (a template/handler drift guard — the
 *   controls are unnamed and data-keyed, so nothing else would catch a rename).
 *
 *   Run: node dev/tools/sims/test-shard-theme.mjs
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
const section = (s) => console.log(`\n── ${s} ──`);
const ok = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (err) { console.log(`  ✗ ${name}\n      ${err.message}`); fail++; }
};

// helpers.js touches game/document only inside functions, but it imports cleanly
// only with these present.
globalThis.game = { settings: { get: () => ({}) }, user: { isGM: false }, actors: [], items: [], i18n: { localize: (s) => s } };
globalThis.ui = { notifications: { warn() {}, info() {}, error() {} } };
globalThis.Hooks = { on() {}, off() {}, once() {}, call() {}, callAll() {} };
globalThis.CONFIG = {};
globalThis.foundry = { utils: { deepClone: (o) => JSON.parse(JSON.stringify(o)), debounce: (f) => f, randomID: () => 'x' } };

const { buildShardThemePrefs } = await load('scripts/utils/helpers.js');
const { SHARD_PRESETS, COLOR_VAR_MAP, CONTRAST_SPREAD, FONT_OPTIONS } = await load('scripts/utils/constants.js');

// ═══════════════════════════════════════════════════════════════════════════
section('the palette is data now');

ok('every themed preset carries a full palette; blank deliberately carries none', () => {
  const keys = Object.keys(COLOR_VAR_MAP);
  for (const [key, p] of Object.entries(SHARD_PRESETS)) {
    if (key === 'blank') {
      assert.ok(!p.palette, 'blank must have NO palette — it follows the player theme');
      continue;
    }
    assert.ok(p.palette, `${key} has no palette`);
    for (const k of keys) assert.ok(p.palette[k], `${key} is missing ${k}`);
  }
});

ok('the palette map gained border + textMuted, and contrast already spoke those names', () => {
  assert.ok(COLOR_VAR_MAP.border === '--ncm-border');
  assert.ok(COLOR_VAR_MAP.textMuted === '--ncm-text-muted');
  // CONTRAST_SPREAD has tone-mapped both under these keys since the slider
  // shipped, so adding them closes a gap rather than inventing a vocabulary.
  const spread = CONTRAST_SPREAD.vars.map((v) => v.key);
  assert.ok(spread.includes('border') && spread.includes('textMuted'));
  for (const k of spread) assert.ok(k in COLOR_VAR_MAP, `contrast tone-maps ${k} but it is not themeable`);
});

ok('the old stylesheet is gone and nothing imports it', () => {
  assert.ok(!fs.existsSync(path.join(ROOT, 'styles/themes/shard-presets.css')));
  assert.ok(!read('styles/night-city-messenger.css').includes('shard-presets.css'));
});

ok('the --sp-* tokens are derived in exactly ONE place', () => {
  const css = read('styles/components/item-inbox.css');
  // One rule defining the palette; the layout rule must no longer redeclare it.
  const defs = (css.match(/--sp-bg-deep:/g) || []).length;
  assert.equal(defs, 1, `--sp-bg-deep is defined ${defs} times; it must be 1`);
  assert.ok(css.includes('.ncm-app.ncm-data-shard-composer'), 'the composer/workshop must share the derivation');
});

ok('no --sp-* reads the variable that never existed', () => {
  const css = read('styles/components/item-inbox.css');
  // `--ncm-color-secondary` is undefined module-wide, so `var(--ncm-color-secondary, #19f3f7)`
  // always resolved to literal brand cyan — the blank shard could not follow the player theme.
  assert.ok(!/--sp-[a-z-]+:\s*[^;]*--ncm-color-/.test(css),
    'a --sp-* token still reads --ncm-color-*, which does not exist');
});

// ═══════════════════════════════════════════════════════════════════════════
section('buildShardThemePrefs');

ok('a preset palette becomes the prefs colours', () => {
  const p = buildShardThemePrefs(undefined, 'corporate-dossier');
  assert.equal(p.colors.secondary, SHARD_PRESETS['corporate-dossier'].palette.secondary);
  assert.equal(p.colors.border, SHARD_PRESETS['corporate-dossier'].palette.border);
});

ok('preset: null — a shard never merges the PLAYER theme presets', () => {
  assert.strictEqual(buildShardThemePrefs({}, 'blank').preset, null);
});

ok('the blank preset writes no colours, so :root shows through', () => {
  assert.deepEqual(buildShardThemePrefs(undefined, 'blank').colors, {});
});

ok('an override beats the preset', () => {
  const p = buildShardThemePrefs({ colors: { secondary: '#00ff00' } }, 'corporate-dossier');
  assert.equal(p.colors.secondary, '#00ff00');
  assert.equal(p.colors.primary, SHARD_PRESETS['corporate-dossier'].palette.primary, 'untouched keys keep the preset');
});

ok("a CLEARED override ('') falls through to the preset, exactly as an absent key would", () => {
  // The draft stores '' rather than deleting, because updateConfig merges through
  // mergeObject and a deleted key would keep its old value.
  const p = buildShardThemePrefs({ colors: { secondary: '' } }, 'corporate-dossier');
  assert.equal(p.colors.secondary, SHARD_PRESETS['corporate-dossier'].palette.secondary);
});

ok('the legacy preset-key STRING is tolerated', () => {
  // config.theme was written as val('preset') for years — a bare string.
  const p = buildShardThemePrefs('corporate-dossier', 'corporate-dossier');
  assert.equal(p.colors.secondary, SHARD_PRESETS['corporate-dossier'].palette.secondary);
  assert.equal(p.wallpaper, null);
});

ok('the legacy CHROME block (what the Encoder writes) is tolerated', () => {
  // { accent, headerBg, iconColor, watermarkIcon, footerText, colorTemp } — no
  // `colors` key, so the palette namespace cannot collide with it.
  const chrome = SHARD_PRESETS['corporate-dossier'].theme;
  assert.ok(chrome && !chrome.colors, 'the chrome block must not have a colors key');
  const p = buildShardThemePrefs(chrome, 'corporate-dossier');
  assert.equal(p.colors.secondary, SHARD_PRESETS['corporate-dossier'].palette.secondary);
});

ok('fonts fall back to the brand slots and accept both shapes', () => {
  assert.equal(buildShardThemePrefs({}, 'blank').fonts.display, 'rajdhani');
  assert.equal(buildShardThemePrefs({ fonts: { display: 'exo2' } }, 'blank').fonts.display, 'exo2');
  assert.equal(buildShardThemePrefs({ fontMono: 'firacode' }, 'blank').fonts.mono, 'firacode');
  for (const slot of ['display', 'mono', 'title']) {
    const v = buildShardThemePrefs({}, 'blank').fonts[slot];
    assert.ok(FONT_OPTIONS.some((f) => f.key === v), `${slot} default "${v}" is not a real font option`);
  }
});

ok('wallpaper rides through; text scale and contrast are the caller’s to compose', () => {
  const p = buildShardThemePrefs({ wallpaper: 'w.webp', wallpaperStrength: 40 }, 'blank', { textScale: 130, contrast: 100 });
  assert.equal(p.wallpaper, 'w.webp');
  assert.equal(p.wallpaperStrength, 40);
  assert.equal(p.textScale, 130);
  // The viewer passes contrast 100 on purpose: applyContrastToElement owns the
  // tone-map so it can read its base from the themed ancestor.
  assert.equal(p.contrast, 100);
});

// ═══════════════════════════════════════════════════════════════════════════
section('the viewer wires it the way the palette expects');

ok('the theme goes on the APP ROOT, contrast on the inbox with baseFrom', () => {
  const js = read('scripts/ui/ItemInbox/ItemInboxApp.js');
  assert.ok(js.includes('_applyShardTheme'), 'the apply step should be its own method');
  assert.ok(/applyTheme\(\s*buildShardThemePrefs\([^)]*\)[\s\S]{0,40}root,/.test(js),
    'applyTheme must target the app root so the window frame follows');
  assert.ok(js.includes('inbox === root ? {} : { baseFrom: root }'),
    'contrast must read its base from the themed root, not from :root');
});

ok('the render context carries the theme', () => {
  assert.ok(read('scripts/ui/ItemInbox/ItemInboxApp.js').includes('shardTheme: config.theme'));
});

ok('the window frame reads the palette through the compound app-root selector', () => {
  const css = read('styles/components/item-inbox.css');
  // `.ncm-app .ncm-item-inbox` (descendant) is the INNER element — the app root
  // carries both classes, so the frame needs the compound form.
  assert.ok(css.includes('.ncm-app.ncm-item-inbox > .window-header'),
    'the header rule must use the compound selector or it never matches');
});

// ═══════════════════════════════════════════════════════════════════════════
section('the Theme tab’s save contract');

const cfgJs = read('scripts/ui/ItemInbox/ItemInboxConfig.js');
const tpl = read('templates/item-inbox/item-inbox-config.hbs');

ok('the tab and its panel both exist', () => {
  assert.ok(tpl.includes('data-tab="theme"'), 'no Theme tab button');
  assert.ok(tpl.includes('data-panel="theme"'), 'no Theme panel');
});

ok('every data-stc control in the template is handled in JS', () => {
  const inTpl = [...tpl.matchAll(/data-stc="([a-zA-Z]+)"/g)].map((m) => m[1]);
  assert.ok(inTpl.length >= 8, `only ${inTpl.length} theme controls found`);
  for (const kind of [...new Set(inTpl)]) {
    assert.ok(cfgJs.includes(`'${kind}'`), `the template emits data-stc="${kind}" but no handler mentions it`);
  }
});

ok('every handled kind still exists in the template (no orphan handlers)', () => {
  const inTpl = new Set([...tpl.matchAll(/data-stc="([a-zA-Z]+)"/g)].map((m) => m[1]));
  for (const kind of ['preset', 'color', 'colorReset', 'colorResetAll', 'font',
    'wallpaper', 'wallpaperBrowse', 'wallpaperClear', 'wallpaperStrength',
    'themeSave', 'themeApply', 'themeOverwrite', 'themeDelete', 'themeExport', 'themeImport']) {
    assert.ok(inTpl.has(kind), `JS handles "${kind}" but the template never emits it`);
  }
});

ok('the preset cards drive the hidden input _onSaveConfig actually reads', () => {
  assert.ok(tpl.includes('<input type="hidden" name="preset"'), 'the save contract input is missing');
  assert.ok(cfgJs.includes("el.querySelector('[name=\"preset\"]')") || cfgJs.includes("[name=\"preset\"]"),
    'nothing reads the preset input');
});

ok('config.theme is saved as the DRAFT OBJECT, not the old preset-key string', () => {
  assert.ok(!/theme: val\('preset'/.test(cfgJs), 'theme is still being saved as a bare preset key');
  assert.ok(/theme: this\._themeDraft/.test(cfgJs), 'the draft must be what is persisted');
});

ok('a cleared override is written as empty, never deleted', () => {
  assert.ok(cfgJs.includes("d.colors[key] = ''"),
    'deleting the key would survive mergeObject in updateConfig and never clear');
});

ok('the theme tab never re-renders the sheet', () => {
  // _prepareContext reads the STORED config, so a render would discard unsaved
  // edits in Identity / Security / Network / Systems / Boot.
  const block = cfgJs.slice(cfgJs.indexOf('_onThemeAction'), cfgJs.indexOf('_onSavedThemeAction'));
  assert.ok(!/this\.render\(/.test(block), 'a theme action calls render() — it would discard other tabs’ edits');
});

ok('the saved-look library is registered and is look-only', () => {
  const sm = read('scripts/core/SettingsManager.js');
  assert.ok(sm.includes("'shardThemePresets'"), 'the world setting is not registered');
  // Applying something labelled "a look" must never arm a shard. Judge the CODE,
  // not the prose — the comment above it exists to explain this very rule.
  const block = cfgJs.slice(cfgJs.indexOf('_onSavedThemeAction'), cfgJs.indexOf('_rebuildSavedThemeList'))
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const word of ['security', 'encrypted', 'encryptionDC', 'blackIce', 'requiresLogin', 'keyItem']) {
    assert.ok(!new RegExp(word, 'i').test(block), `the saved-theme path touches "${word}" — a look must carry none`);
  }
});

ok('the full preset library is registered, and security is OPT-IN', () => {
  assert.ok(read('scripts/core/SettingsManager.js').includes("'shardPresetLibrary'"), 'not registered');
  assert.ok(cfgJs.includes('SHARD_SECURITY_KEYS'), 'no explicit security key list');
  // An explicit list, so a config field added later does not silently start
  // travelling inside a preset.
  const m = cfgJs.match(/const SHARD_SECURITY_KEYS = \[([\s\S]*?)\];/);
  assert.ok(m, 'the key list is missing');
  for (const k of ['encrypted', 'encryptionDC', 'requiresLogin', 'requiresKeyItem', 'layerSecurity', 'ice']) {
    assert.ok(m[1].includes(`'${k}'`), `the security snapshot omits ${k}`);
  }
  // The save dialog must default the checkbox OFF.
  assert.ok(/class="ncm-stc-withsec">/.test(cfgJs), 'the include-security checkbox must not be pre-checked');
  // The snapshot copies security only when asked, and the save path only asks
  // when the GM ticked the box.
  const snapStart = cfgJs.indexOf('_snapshotShard(withSecurity)');
  const snap = cfgJs.slice(snapStart, cfgJs.indexOf('static _fullPresets()', snapStart));
  assert.ok(/if \(withSecurity\) \{/.test(snap), 'the snapshot copies security unconditionally');
  assert.ok(cfgJs.includes('this._snapshotShard(picked.withSecurity)'), 'the save path ignores the checkbox');
});

ok('applying a preset that carries security says so before it does it', () => {
  const block = cfgJs.slice(cfgJs.indexOf("case 'fullApply'"), cfgJs.indexOf("case 'fullOverwrite'"));
  assert.ok(/hasSec/.test(block) && /security block/.test(block), 'the confirm must name the security overwrite');
  assert.ok(/adminConfirm/.test(block), 'applying must confirm first — it writes immediately');
});

ok('importing a preset never auto-applies it', () => {
  const block = cfgJs.slice(cfgJs.indexOf("case 'fullImport'"), cfgJs.indexOf("default:\n        log.debug(`ItemInboxConfig: unhandled full-preset"));
  assert.ok(!/updateConfig/.test(block), 'import must only add to the library');
});

ok('the borrowed Theme-Customizer button resets reach this window', () => {
  const css = read('styles/components/theme-customizer.css');
  // Those resets are root-scoped per host; without this the saved-look action
  // buttons render as Foundry's white full-width default.
  assert.ok(css.includes('.ncm-item-inbox-config .ncm-tc__citem-actions button'),
    'shard config is missing from the co-scoped reset list');
  // And the sed that added it must not have eaten a :hover.
  assert.ok(css.includes('.ncm-term-config .ncm-tc__citem-actions button:hover'),
    'the terminal config lost its :hover qualifier');
});

// ═══════════════════════════════════════════════════════════════════════════
section('the Theme panel RENDERS its data (not just declares it)');

// Handlebars ships with Foundry. A structural check on the markup is worth
// little if the data never binds — that is exactly how `_bootContext`'s
// double-nesting shipped a blank boot screen past hand-written markup tests.
const CANDIDATES = [
  'C:/Program Files/Foundry Virtual Tabletop/resources/app/package.json',
  'C:/Program Files (x86)/Foundry Virtual Tabletop/resources/app/package.json',
];
let Handlebars = null;
for (const p of CANDIDATES) {
  if (!fs.existsSync(p)) continue;
  try { Handlebars = createRequire(p)('handlebars'); break; } catch { /* keep looking */ }
}

if (!Handlebars) {
  console.log('  ~ skipped — no Handlebars from a Foundry install');
} else {
  // The exact shape _prepareContext builds for the Theme tab.
  const pal = SHARD_PRESETS['corporate-dossier'].palette;
  const ctx = {
    hasItem: true,   // the whole template is behind this
    config: { preset: 'corporate-dossier' },
    previewName: 'Ghost\'s Go-Bag',
    themeDirty: true,
    themePresetCards: Object.entries(SHARD_PRESETS).map(([key, p]) => ({
      key, label: p.label, active: key === 'corporate-dossier',
      sw1: p.palette?.secondary || '#19f3f7', sw2: p.palette?.accent || '#f7c948', sw3: p.palette?.bgSurface || '#1a1a2e',
    })),
    themeColors: Object.keys(COLOR_VAR_MAP).map((key) => ({
      key, label: key, value: pal[key], hasOverride: key === 'secondary',
    })),
    themeFonts: [{ slot: 'display', label: 'Body / Display', options: [{ value: 'rajdhani', label: 'Rajdhani', selected: true }] }],
    savedThemes: [{ index: 0, name: 'Arasaka internal', sw1: '#ee3030', sw2: '#e0b040', sw3: '#120a0a' }],
    fullPresets: [{ index: 0, name: 'Arasaka dead drop', hasSecurity: true }],
    themeWallpaper: 'worlds/x.webp', themeWallpaperStrength: 40,
    textScale: 120, contrast: 110,
  };
  Handlebars.registerHelper('helperMissing', () => '');
  const out = Handlebars.compile(tpl)(ctx);
  // Handlebars strips {{!-- --}} comments, so slice to the NEXT panel instead.
  const start = out.indexOf('data-panel="theme"');
  const end = out.indexOf('data-panel="security"', start);
  assert.ok(start > -1 && end > start, 'the theme panel did not render at all');
  const panel = out.slice(start, end);

  ok('a preset card renders for every preset, with the active one marked', () => {
    const cards = (panel.match(/data-stc="preset"/g) || []).length;
    assert.equal(cards, Object.keys(SHARD_PRESETS).length, `${cards} cards for ${Object.keys(SHARD_PRESETS).length} presets`);
    assert.ok(panel.includes('ncm-tc__pcard--active'), 'the active preset is not marked');
    assert.ok(panel.includes(pal.secondary), 'a card swatch does not show the palette colour');
  });

  ok('a colour row renders for every themeable key, carrying its own reset', () => {
    const rows = (panel.match(/data-stc-row="/g) || []).length;
    assert.equal(rows, Object.keys(COLOR_VAR_MAP).length, `${rows} rows for ${Object.keys(COLOR_VAR_MAP).length} keys`);
    assert.equal((panel.match(/data-stc="colorReset"/g) || []).length, rows, 'a row is missing its reset');
    assert.ok(/data-stc-row="secondary"[^>]*class="[^"]*is-override|class="[^"]*is-override[^"]*"[^>]*data-stc-row="secondary"/.test(panel)
      || /is-override.*?data-stc-row="secondary"|data-stc-row="secondary".*?is-override/.test(panel.replace(/\n/g, ' ')),
      'the overridden key is not flagged');
    assert.ok(panel.includes(`value="${pal.bgDeep}"`), 'a swatch does not open on the colour in use');
  });

  ok('both libraries render their rows, and an armed preset is chipped', () => {
    assert.ok(panel.includes('Arasaka internal'), 'the saved look is missing');
    assert.ok(panel.includes('Arasaka dead drop'), 'the shard preset is missing');
    assert.ok(panel.includes('ncm-stc-secchip'), 'a security-carrying preset must be chipped on its row');
  });

  ok('the readability + wallpaper values bind', () => {
    assert.ok(panel.includes('value="120"') && panel.includes('value="110"'), 'the sliders lost their values');
    assert.ok(panel.includes('worlds/x.webp'), 'the wallpaper path did not bind');
    assert.ok(panel.includes('>40%<'), 'the strength readout did not bind');
  });
}

// ═══════════════════════════════════════════════════════════════════════════
section('the Encoder offers looks to players — dress only');

const encJs = read('scripts/ui/ShardEncoder/ShardEncoderApp.js');
const { ENCODER_DEFAULTS, resolveEncoderConfig } = await load('scripts/ui/content/EncoderModel.js');

ok('both look sources are GM-switchable and default on', () => {
  assert.equal(ENCODER_DEFAULTS.look.presets, true);
  assert.equal(ENCODER_DEFAULTS.look.savedThemes, true);
  const cfg = resolveEncoderConfig({ look: { savedThemes: false } });
  assert.equal(cfg.look.savedThemes, false);
  assert.equal(cfg.look.presets, true, 'the other half must keep its default');
});

ok('each switch actually gates its own source', () => {
  assert.ok(encJs.includes("this.cfg.look?.presets === false"), 'the preset chips ignore their switch');
  assert.ok(encJs.includes("this.cfg.look?.savedThemes === false"), 'the saved looks ignore their switch');
});

ok('a saved look and a preset are mutually exclusive picks', () => {
  // Two chips both lit, both claiming to set the look, reads as a bug.
  assert.ok(/case 'savedlook':/.test(encJs), 'no savedlook action');
  assert.ok(/S\.savedLook = ''/.test(encJs), 'picking a preset must clear the saved look');
  assert.ok(/!this\.S\.savedLook && p\.key === this\.S\.preset/.test(encJs),
    'a preset chip must not stay lit while a saved look is chosen');
});

ok('_lookConfig still refuses to carry security', () => {
  const body = encJs.slice(encJs.indexOf('_lookConfig()'), encJs.indexOf('_lookConfig()') + 1800)
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const word of ['security', 'encrypted', 'encryptionDC', 'blackIce', 'requiresKeyItem']) {
    assert.ok(!new RegExp(word, 'i').test(body), `_lookConfig touches "${word}" — a player must not get security from dress`);
  }
  assert.ok(/out\.theme = \{ \.\.\.\(out\.theme \|\| \{\}\), \.\.\.t \}/.test(body),
    'the saved palette should layer onto the preset chrome, not replace it');
});

// ═══════════════════════════════════════════════════════════════════════════
section('optional depth — three real rules, and no dead fourth');

const OPT = await load('scripts/ui/content/EncoderModel.js');

ok('the signature placeholder is gone entirely', () => {
  const d = OPT.ENCODER_DEFAULTS.optional;
  assert.ok(!('signature' in d), 'signature must be removed, not left as a dead switch');
  assert.deepEqual(Object.keys(d).sort(), ['assist', 'gear', 'time']);
  assert.ok(!/optional\.signature/.test(read('scripts/ui/ShardEncoder/EncoderConfigApp.js')));
});

ok('a LEGACY boolean block upgrades instead of poisoning the shape', () => {
  // Worlds that saw the placeholder stored `{gear:true,...}` — a bare boolean
  // where an object now lives. It must lift, not overwrite the block.
  const c = OPT.resolveEncoderConfig({ optional: { gear: true, time: false, assist: true, signature: true } });
  assert.equal(c.optional.gear.on, true);
  assert.equal(c.optional.gear.stack, 'best', 'the rest of the defaults must fill in');
  assert.equal(c.optional.assist.on, true);
  assert.ok(!('signature' in c.optional));
});

ok('gear matches names the SkillService way, and BEST is the default', () => {
  const c = OPT.resolveEncoderConfig({ optional: { gear: { on: true, items: [{ name: 'Cyberdeck', bonus: 2 }, { name: 'Forgery Kit', bonus: 1 }] } } });
  assert.equal(OPT.gearBonusFor(c, ['cyber  deck']).bonus, 2, 'spacing must not matter');
  assert.equal(OPT.gearBonusFor(c, ['Cyberdeck', 'Forgery Kit']).bonus, 2, 'best, not sum');
  const sum = OPT.resolveEncoderConfig({ optional: { gear: { on: true, stack: 'sum', items: c.optional.gear.items } } });
  assert.equal(OPT.gearBonusFor(sum, ['Cyberdeck', 'Forgery Kit']).bonus, 3);
  assert.deepEqual(OPT.gearBonusFor(c, ['Cyberdeck']).from, ['Cyberdeck'], 'it must name what helped');
});

ok('gear is inert while the rule is off', () => {
  const c = OPT.resolveEncoderConfig({ optional: { gear: { on: false, items: [{ name: 'Cyberdeck', bonus: 9 }] } } });
  assert.equal(OPT.gearBonusFor(c, ['Cyberdeck']).bonus, 0);
});

ok('time scales with the DV and reads as hours', () => {
  const c = OPT.resolveEncoderConfig({ optional: { time: { on: true, baseMinutes: 60, perDV: 10 } } });
  assert.equal(OPT.timeCostFor(c, 15), 210);
  assert.equal(OPT.timeCostFor(c, 0), 60, 'a no-roll file still costs the base');
  assert.equal(OPT.formatMinutes(210), '3h 30m');
  assert.equal(OPT.formatMinutes(45), '45m');
  assert.equal(OPT.formatMinutes(120), '2h');
  assert.equal(OPT.timeCostFor(OPT.resolveEncoderConfig({}), 15), 0, 'off by default');
});

ok('an assistant must have the skill when the GM says so', () => {
  const c = OPT.resolveEncoderConfig({ optional: { assist: { on: true, bonus: 2, requireSkill: true } } });
  assert.equal(OPT.assistBonusFor(c, { helperRank: 0 }), 0);
  assert.equal(OPT.assistBonusFor(c, { helperRank: 1 }), 2);
  const loose = OPT.resolveEncoderConfig({ optional: { assist: { on: true, bonus: 2, requireSkill: false } } });
  assert.equal(OPT.assistBonusFor(loose, { helperRank: 0 }), 2);
});

ok('every bonus reaches the roll through ONE accessor', () => {
  // A bonus added at the call site is how the readout and the roll end up
  // quoting different numbers.
  const js = read('scripts/ui/ShardEncoder/ShardEncoderApp.js');
  assert.ok(js.includes('_bonuses()'), 'there should be a single bonus accessor');
  assert.ok(js.includes('modifier: bonuses.total'), 'the roll must use it');
  assert.ok(js.includes('this._skill(this.S.craft).total + this._bonuses().total'), 'the readout base must use it');
  assert.ok(!/ladderOdds\(this\._skill\([^)]*\)\.total \+ this\._blank\(\)\.perk/.test(js),
    'a ladder preview still adds the perk by hand — it would disagree with the roll');
});

ok('the time charge can never cost a shard that was already rolled for', () => {
  const js = read('scripts/ui/ShardEncoder/ShardEncoderApp.js');
  const body = js.slice(js.indexOf('async _spendTime()'), js.indexOf('async _spendTime()') + 2200);
  assert.ok((body.match(/try \{/g) || []).length >= 2, 'both the clock write and the report must be guarded');
  assert.ok(/advanceClock/.test(body), 'the GM must be able to switch the clock move off');
});


console.log(`\n${fail ? '✗' : '✓'} ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
