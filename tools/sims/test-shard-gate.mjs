/**
 * Shard authoring gate — who may make a data shard.
 * @file tools/sims/test-shard-gate.mjs
 * @description Drives the REAL `sanitizeGate` / `gateSummary` (pure, from
 *   EncoderModel.js) and the REAL `canOperate` / `canEncode` (from helpers.js,
 *   with `game` mocked), so the model, the evaluator and the doors cannot drift.
 *
 *   Run: node tools/sims/test-shard-gate.mjs
 */

import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

let pass = 0, fail = 0;
const ok = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (err) { console.log(`  ✗ ${name}\n      ${err.message}`); fail++; }
};

// ── mock just enough Foundry for helpers.js ──────────────────────────────────
// helpers.js reads game.settings / game.user / actor.items and (for a skill rule)
// game.nightcity.skillService.getSkillData.
const MODULE_ID = 'night-city-messenger';
let SETTINGS = {};
let IS_GM = false;
let SKILLS = {};

globalThis.game = {
  get user() { return { isGM: IS_GM }; },
  settings: { get: (_m, k) => SETTINGS[k] },
  get nightcity() { return { skillService: { getSkillData: (_a, n) => ({ skillLevel: SKILLS[n] ?? 0 }) } }; },
  actors: [],
  items: [],
  i18n: { localize: (s) => s },
};
globalThis.ui = { notifications: { warn() {}, info() {}, error() {} } };
globalThis.foundry = { utils: { debounce: (f) => f, randomID: () => 'x', deepClone: (o) => JSON.parse(JSON.stringify(o)) } };
globalThis.CONFIG = {};
globalThis.Hooks = { on() {}, off() {}, once() {}, call() {}, callAll() {} };

/** A character: `items` is what they carry, `skills` their ranks. */
const actor = (id, { role = '', gear = [], skills = {} } = {}) => {
  Object.assign(SKILLS, skills);
  return {
    id, name: id, isOwner: true,
    items: [
      ...(role ? [{ type: 'role', name: role }] : []),
      ...gear.map((g) => ({ type: 'gear', name: g })),
    ],
  };
};

const { sanitizeGate, gateSummary, GATE_DEFAULT, ENCODER_DEFAULTS, resolveEncoderConfig } =
  await load('scripts/ui/content/EncoderModel.js');
const { canOperate, canEncode } = await load('scripts/utils/helpers.js');

const setCfg = (gate, enabled = true) => { SETTINGS.encoderConfig = { enabled, gate: sanitizeGate(gate) }; };

console.log('\n── 1 · the gate shape ──');
ok('the default gate is ungated', () => {
  assert.equal(GATE_DEFAULT.mode, 'anyone');
  assert.equal(ENCODER_DEFAULTS.gate.mode, 'anyone');
});
ok('resolveEncoderConfig always yields a full gate', () => {
  const g = resolveEncoderConfig({}).gate;
  for (const k of Object.keys(GATE_DEFAULT)) assert.ok(k in g, `missing ${k}`);
});
ok('a stored partial gate layers over the default', () => {
  const g = resolveEncoderConfig({ gate: { mode: 'gated', roles: ['Tech'] } }).gate;
  assert.equal(g.mode, 'gated');
  assert.deepEqual(g.roles, ['Tech']);
  assert.equal(g.allowGM, true, 'untouched keys keep their default');
});
ok('bare-string and {name} gear entries both read', () => {
  const g = sanitizeGate({ itemGroups: [['Cyberdeck', { name: 'Plug', img: 'p.png' }]] });
  assert.deepEqual(g.itemGroups[0].map((i) => i.name), ['Cyberdeck', 'Plug']);
  assert.equal(g.itemGroups[0][1].img, 'p.png');
});
ok('empty groups and nameless entries are dropped, never kept as an impossible rule', () => {
  const g = sanitizeGate({ itemGroups: [[], [''], [{ name: '' }], ['Real']] });
  assert.equal(g.itemGroups.length, 1);
  assert.equal(g.itemGroups[0][0].name, 'Real');
});
ok('a junk mode falls back to anyone, not to a lockout', () => {
  assert.equal(sanitizeGate({ mode: 'banana' }).mode, 'anyone');
});
ok('skill rank coerces to a non-negative integer', () => {
  assert.equal(sanitizeGate({ skill: { name: 'Interface', min: '4.6' } }).skill.min, 5);
  assert.equal(sanitizeGate({ skill: { min: -3 } }).skill.min, 0);
});

console.log('\n── 2 · the summary the GM reads ──');
ok('ungated reports not-gated', () => {
  const s = gateSummary({ mode: 'anyone', roles: ['Tech'] });
  assert.equal(s.gated, false);
});
ok('gated with nothing configured reports INERT', () => {
  const s = gateSummary({ mode: 'gated' });
  assert.equal(s.inert, true, 'an empty gate must announce that it restricts nobody');
});
ok('a named character alone is not inert', () => {
  assert.equal(gateSummary({ mode: 'gated', actors: ['a1'] }).inert, false);
});
ok('the summary spells out each rule', () => {
  const s = gateSummary({ mode: 'gated', roles: ['Tech', 'Netrunner'], skill: { name: 'Interface', min: 4 }, itemGroups: [['Deck', 'Plug'], ['Falcon']] });
  assert.deepEqual(s.parts, ['Tech / Netrunner', 'Interface 4+', 'Deck + Plug or Falcon']);
});

console.log('\n── 3 · canEncode — the one answer every door reads ──');
IS_GM = false;

ok('authoring off → refused, and flagged as a WORLD switch not a character problem', () => {
  setCfg({}, false);
  const v = canEncode(actor('v'));
  assert.equal(v.ok, false);
  assert.equal(v.off, true, 'the doors need to tell these two cases apart');
});
ok('authoring on + ungated → anyone passes', () => {
  setCfg({ mode: 'anyone' });
  assert.equal(canEncode(actor('v')).ok, true);
});
ok('gated but nothing configured → inert, nobody is locked out', () => {
  setCfg({ mode: 'gated' });
  assert.equal(canEncode(actor('v')).ok, true);
});
ok('role rule: the Tech passes, the Solo does not', () => {
  setCfg({ mode: 'gated', roles: ['Tech'] });
  assert.equal(canEncode(actor('t', { role: 'Tech' })).ok, true);
  assert.equal(canEncode(actor('s', { role: 'Solo' })).ok, false);
});
ok('skill rule respects the minimum rank', () => {
  setCfg({ mode: 'gated', skill: { name: 'Interface', min: 4 } });
  assert.equal(canEncode(actor('hi', { skills: { Interface: 4 } })).ok, true);
  SKILLS = {};
  assert.equal(canEncode(actor('lo', { skills: { Interface: 3 } })).ok, false);
});
ok('gear is OR-of-ANDs: a whole option, or another whole option', () => {
  setCfg({ mode: 'gated', itemGroups: [['Cyberdeck', 'Interface Plug'], ['Militech Falcon']] });
  assert.equal(canEncode(actor('a', { gear: ['Cyberdeck', 'Interface Plug'] })).ok, true, 'option A complete');
  assert.equal(canEncode(actor('b', { gear: ['Cyberdeck'] })).ok, false, 'half of option A is not enough');
  assert.equal(canEncode(actor('c', { gear: ['Militech Falcon'] })).ok, true, 'option B alone');
});
ok('logic:any passes on one rule; logic:all demands every rule', () => {
  const rules = { mode: 'gated', roles: ['Tech'], skill: { name: 'Interface', min: 4 } };
  SKILLS = {};
  setCfg({ ...rules, logic: 'any' });
  assert.equal(canEncode(actor('t', { role: 'Tech', skills: { Interface: 0 } })).ok, true);
  SKILLS = {};
  setCfg({ ...rules, logic: 'all' });
  assert.equal(canEncode(actor('t2', { role: 'Tech', skills: { Interface: 0 } })).ok, false);
  SKILLS = {};
  assert.equal(canEncode(actor('t3', { role: 'Tech', skills: { Interface: 5 } })).ok, true);
});
ok('a named character skips every rule', () => {
  setCfg({ mode: 'gated', roles: ['Tech'], actors: ['vip'] });
  assert.equal(canEncode(actor('vip', { role: 'Solo' })).ok, true);
});
ok('no operator at all is refused when a character is required', () => {
  setCfg({ mode: 'gated', roles: ['Tech'] });
  assert.equal(canEncode(null).ok, false);
});
ok('a door with no operator yet may still render (requireActor:false)', () => {
  setCfg({ mode: 'gated', roles: ['Tech'] });
  assert.equal(canEncode(null, { requireActor: false }).ok, true);
});
ok('the refusal names what is missing, in the encoder’s own words', () => {
  setCfg({ mode: 'gated', roles: ['Tech'] });
  const v = canEncode(actor('s', { role: 'Solo' }));
  assert.match(v.reason, /^Encoding a shard requires /, `got: ${v.reason}`);
  assert.ok(!/Operator tools/.test(v.reason), 'must not say "Operator tools" — wrong feature');
});
ok('the GM always passes', () => {
  IS_GM = true;
  setCfg({ mode: 'gated', roles: ['Nobody'] }, false);
  assert.equal(canEncode(null).ok, true, 'even with authoring off and no character');
  IS_GM = false;
});

console.log('\n── 4 · the two gates stay independent ──');
ok('canEncode never inherits the terminal operator gate', () => {
  // The trap: `canOperate(actor, override)` merges the operatorGate SETTING in.
  // A shard gate that omits `roles` must not silently pick up the terminal's.
  SETTINGS.operatorGate = { mode: 'gated', roles: ['Netrunner'], logic: 'any' };
  setCfg({ mode: 'gated', skill: { name: 'Forgery', min: 2 } });
  SKILLS = {};
  const solo = actor('s', { role: 'Solo', skills: { Forgery: 2 } });
  assert.equal(canEncode(solo).ok, true, 'the shard rule alone decides');
  SKILLS = {};
  const runner = actor('r', { role: 'Netrunner', skills: { Forgery: 0 } });
  assert.equal(canEncode(runner).ok, false, 'being a Netrunner is the TERMINAL rule, not this one');
});
ok('standalone:false still reads the operatorGate setting (terminals unchanged)', () => {
  SETTINGS.operatorGate = { mode: 'gated', roles: ['Netrunner'], logic: 'any' };
  assert.equal(canOperate(actor('r', { role: 'Netrunner' })).ok, true);
  assert.equal(canOperate(actor('s', { role: 'Solo' })).ok, false);
});
ok('canOperate keeps its own wording by default', () => {
  SETTINGS.operatorGate = { mode: 'gated', roles: ['Netrunner'] };
  const v = canOperate(actor('s', { role: 'Solo' }));
  assert.match(v.reason, /^Operator tools require /, `got: ${v.reason}`);
});

console.log('\n── 5 · the retired wizard leaves nothing behind ──');
const fs = await import('node:fs');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
ok('ShardConversionFlow and its assets are gone', () => {
  for (const f of [
    'scripts/ui/dialogs/ShardConversionFlow.js',
    'templates/dialogs/shard-conversion.hbs',
    'styles/components/shard-conversion.css',
    'styles/components/admin-panel/shard-conversion.css',
  ]) assert.ok(!fs.existsSync(path.join(ROOT, f)), `${f} still exists`);
});
ok('nothing imports it and no template/stylesheet still registers it', () => {
  assert.ok(!read('scripts/integrations/ShardSheetOverride.js').includes('ShardConversionFlow'));
  assert.ok(!read('scripts/utils/constants.js').includes('SHARD_CONVERSION'));
  assert.ok(!read('styles/night-city-messenger.css').includes('shard-conversion.css'));
});
ok('the three wizard-only settings are no longer registered', () => {
  const sm = read('scripts/core/SettingsManager.js');
  for (const k of ['playerShardFloor', 'playerShardSkill', 'playerBlackICE']) {
    assert.ok(!sm.includes(`'${k}'`), `${k} is still registered — a dead knob in Module Settings`);
  }
});
ok('the old two-route statics are gone; one question remains', () => {
  const s = read('scripts/integrations/ShardSheetOverride.js');
  // Call sites, not mentions — the doc comment explains what they were replaced by.
  assert.ok(!s.includes('.playerAuthoringOn('), 'playerAuthoringOn is still called');
  assert.ok(!s.includes('.encoderEnabled('), 'encoderEnabled is still called');
  assert.ok(!/static (playerAuthoringOn|encoderEnabled)\(/.test(s), 'the statics still exist');
  assert.ok(s.includes('static canAuthor'), 'canAuthor should be the one door-side answer');
});
ok('every door judges through canEncode', () => {
  assert.ok(read('scripts/init/registerReadyServices.js').includes('canEncode'), 'the openEncoder funnel');
  assert.ok(read('scripts/ui/MessageViewer/MessageViewerApp.js').includes('canEncodeShard('), 'the Agent pill');
  assert.ok(read('scripts/ui/ProgramDeck/ProgramDeckApp.js').includes('canEncode(resolveOperator())'), 'the Program Deck slot');
  assert.ok(read('scripts/ui/ShardEncoder/ShardEncoderApp.js').includes('canEncode(this.actor)'), 'the window itself');
});
ok('the item door no longer forces the Program branch', () => {
  const s = read('scripts/integrations/ShardSheetOverride.js');
  assert.ok(!/openEncoder\?\.\(\{ item, actor, stage: 'program' \}\)/.test(s),
    'right-clicking an item must open the blank/content flow, not the program branch');
});

console.log('\n── 6 · the shared picker replaced the copies ──');
ok('namePicker exists and filters with inline display, not the hidden attribute', () => {
  const s = read('scripts/utils/namePicker.js');
  assert.ok(s.includes('r.style.display'), 'must set display inline to beat the author rule');
  assert.ok(!/\.hidden = /.test(s), 'the hidden attribute loses to .ncm-burn-row{display:flex}');
});
ok('the Encoder config picks through the shared picker', () => {
  const s = read('scripts/ui/ShardEncoder/EncoderConfigApp.js');
  assert.ok(s.includes('showNamePicker'), 'should use the shared picker');
  assert.ok(!s.includes('row.hidden'), 'the buggy local filter should be gone');
});

console.log(`\n${fail ? '✗' : '✓'} ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
