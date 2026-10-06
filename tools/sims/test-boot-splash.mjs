/**
 * Sim — the NCM boot splash (the Monogram Etch).
 * @file tools/sims/test-boot-splash.mjs
 * @description Drives the REAL `scripts/ui/BootSplash.js`. The module is
 *   deliberately DOM-free at import time, so the pure half (markup, motion veto,
 *   pacing constants) is testable in plain node; the parts that need a document
 *   are asserted against the source and against the stylesheet they must agree
 *   with. Run: node tools/sims/test-boot-splash.mjs
 */
import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';
import * as B from '../../scripts/ui/BootSplash.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); pass++; console.log(`  ok   ${name}`); }
  catch (err) { fail++; console.log(`  FAIL ${name}\n       ${err.message}`); }
};
const section = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 56 - t.length))}`);

const SRC = fs.readFileSync(path.join(ROOT, 'scripts/ui/BootSplash.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'styles/components/character-select.css'), 'utf8');
const REG = fs.readFileSync(path.join(ROOT, 'scripts/init/registerMessagingSystem.js'), 'utf8');

// ═══════════════════════════════════════════════════════════════════════════
section('the markup the painter has to find');

check('every hook the painter reaches for exists', () => {
  const m = B.splashMarkup();
  for (const el of ['clip', 'etch', 'scan', 'rule', 'name', 'hair', 'state', 'ready']) {
    assert.ok(m.includes(`data-el="${el}"`), `missing data-el="${el}"`);
  }
});

check('each splash gets its OWN clip id', () => {
  // An SVG clipPath is addressed document-wide. Two splashes sharing an id means
  // the second one never fills in — which is exactly what the preview caught.
  const idOf = (m) => (m.match(/<clipPath id="([^"]+)"/) || [])[1];
  const a = idOf(B.splashMarkup());
  const b = idOf(B.splashMarkup());
  assert.ok(a && b, 'no clipPath id at all');
  assert.notEqual(a, b, 'two splashes on one page would share a clip');
});

check('the solid group points at its own clip', () => {
  const m = B.splashMarkup();
  const id = (m.match(/<clipPath id="([^"]+)"/) || [])[1];
  assert.ok(m.includes(`clip-path="url(#${id})"`), 'the fill is clipped by a different id');
});

check('the version is written as text, never as markup', () => {
  const m = B.splashMarkup({ version: '<img src=x onerror=alert(1)>' });
  assert.ok(!m.includes('<img'), 'a world-supplied version reached the DOM as markup');
  assert.ok(m.includes('&lt;img'), 'it should still be shown, escaped');
});

check('no version means no empty label', () => {
  assert.ok(B.splashMarkup({ version: '' }).includes('>agent<'), 'the bottom bar should still read');
});

// ═══════════════════════════════════════════════════════════════════════════
section('motion can be vetoed, never raised');

check('the OS setting and the module pref each veto', () => {
  assert.equal(B.splashReduced({ animationsEnabled: false }), true, 'the module pref must win');
  // matchMedia does not exist in node, which is the "no OS opinion" case.
  assert.equal(B.splashReduced({ animationsEnabled: true }), false);
});

check('an absent option does not silently disable motion', () => {
  assert.equal(B.splashReduced(), false, 'the default must be "animate"');
  assert.equal(B.splashReduced({}), false);
});

check('reduced motion is the SAME painter, not a second look', () => {
  // The whole reason the animation is one paint(p): "no motion" is the last
  // frame of the same thing, so the two can never drift apart visually.
  const branch = SRC.slice(SRC.indexOf('if (reduced) {'), SRC.indexOf('const t0 = performance.now()'));
  assert.ok(branch.includes('paint(1);'), 'reduced motion paints the finished frame');
  assert.ok(!branch.includes('innerHTML'), 'it must not build markup of its own');
  assert.equal((SRC.match(/innerHTML/g) || []).length, 1, 'there is exactly ONE markup path');
});

// ═══════════════════════════════════════════════════════════════════════════
section('it always finishes');

check('a stalled frame loop cannot strand the splash', () => {
  // requestAnimationFrame stops in a hidden tab, and openNCM AWAITS this promise
  // before opening the inbox — so the wall clock has to be able to end it.
  assert.ok(SRC.includes('const capAfter = (ms)'), 'there must be a wall-clock net');
  assert.ok(SRC.includes('capAfter(duration + HOLD_MS + 500);'), 'armed for the whole run');
  assert.ok(SRC.includes('capAfter(STILL_MS);'), 'the reduced path needs it too');
});

check('finishing twice is harmless', () => {
  assert.ok(SRC.includes('if (finished) return;'), 'finish() must be idempotent');
  assert.ok(SRC.includes('clearTimeout(cap);'), 'the net is disarmed by whoever wins');
});

check('the element is removed, not just hidden', () => {
  assert.ok(SRC.includes('root.remove(); resolve();'), 'a hidden overlay still eats the screen');
});

// ═══════════════════════════════════════════════════════════════════════════
section('the pace is one number, and the CSS agrees with it');

check('the stages run in order and stay inside the run', () => {
  const stage = SRC.match(/const STAGE = \{([\s\S]*?)\};/)[1];
  const nums = [...stage.matchAll(/\[([\d.]+), ([\d.]+)\]/g)].map((m) => [Number(m[1]), Number(m[2])]);
  assert.ok(nums.length >= 4, 'expected draw/fill/rule/name windows');
  for (const [a, b] of nums) {
    assert.ok(a >= 0 && b <= 1, `window ${a}..${b} runs outside the animation`);
    assert.ok(a < b, `window ${a}..${b} is inverted`);
  }
  const starts = nums.map(([a]) => a);
  assert.deepEqual(starts, [...starts].sort((x, y) => x - y), 'the beats must not run backwards');
});

check('the fade constant matches the CSS transition', () => {
  // They are two halves of one timing: the JS removes the node after the fade.
  const m = CSS.match(/\.ncm-boot-splash\s*\{[\s\S]*?transition:\s*opacity\s+([\d.]+)s/);
  assert.ok(m, 'no opacity transition on the splash root');
  assert.equal(Math.round(Number(m[1]) * 1000), B.FADE_MS,
    'the node would be removed before or after the fade actually ends');
});

check('the whole thing is short enough to sit through', () => {
  const total = B.DURATION_MS + B.HOLD_MS + B.FADE_MS;
  assert.ok(total <= 2600, `a splash on every page load must stay brief (is ${total}ms)`);
});

// ═══════════════════════════════════════════════════════════════════════════
section('wiring');

check('the old progress-bar splash is gone', () => {
  for (const dead of ['ncm-boot-splash__bar', 'ncm-boot-splash__icon', 'Loading services']) {
    assert.ok(!REG.includes(dead), `${dead} still in registerMessagingSystem`);
    assert.ok(!CSS.includes(dead), `${dead} still in the stylesheet`);
  }
});

check('the caller still awaits it before opening anything', () => {
  assert.ok(REG.includes('await _playBootSplash();'), 'the inbox must open after the splash');
  assert.ok(REG.includes("import('../ui/BootSplash.js')"), 'it should load the real module');
});

check('motion is resolved from the module preference, not assumed', () => {
  assert.ok(REG.includes("game.nightcity?.themeService?.getAnimationLevel?.() !== 'off'"),
    'a player who turned animations off must not get one');
});

check('the stylesheet carries hard fallbacks (it is body-mounted)', () => {
  const block = CSS.slice(CSS.indexOf('.ncm-boot-splash {'), CSS.indexOf('.ncm-boot-splash.fade-out'));
  assert.ok(/var\(--ncm-secondary, #/.test(block), 'no fallback for the accent');
  assert.ok(/var\(--ncm-text-primary, #/.test(block), 'no fallback for the ink');
});

check('clicks are never trapped behind it', () => {
  assert.ok(/\.ncm-boot-splash\s*\{[\s\S]*?pointer-events:\s*none/.test(CSS),
    'a splash that eats clicks can hold the table hostage');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
