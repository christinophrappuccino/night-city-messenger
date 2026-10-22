/**
 * Sim — the GM Contact Manager's Share targets + the network broadcast audience.
 * @file tools/sims/test-gm-share-targets.mjs
 * @description Compiles the REAL gm-contact-manager.hbs through Handlebars with a
 *   realistic context and asserts the Share affordances are what ships.
 *
 *   History: the Share targets used to be two <select>s. The first bug (2026-09)
 *   was the detail panel reading `../shareTargetPlayers` from inside an {{#if}}
 *   chain, which resolved to nothing — a "Players" heading with no one under it.
 *   The second (2026-10-20, picker sweep 2) was the design itself: both selects
 *   listed EVERY actor in the world with no search. They are now Share BUTTONS
 *   that open the shared searchable picker (`GMContactManagerApp._pickShareTarget`,
 *   Players chip first, then top-level folders). This sim guards that neither
 *   select — and neither bug — comes back.
 *
 *   Run: node tools/sims/test-gm-share-targets.mjs
 */
import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); pass++; console.log(`  ok   ${name}`); }
  catch (err) { fail++; console.log(`  FAIL ${name}\n       ${err.message}`); }
};
const section = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 58 - t.length))}`);

// Handlebars ships with Foundry; the sim is useless without it, so say so loudly.
const CANDIDATES = [
  'C:/Program Files/Foundry Virtual Tabletop/resources/app/package.json',
  'C:/Program Files (x86)/Foundry Virtual Tabletop/resources/app/package.json',
];
let Handlebars = null;
for (const p of CANDIDATES) {
  if (!fs.existsSync(p)) continue;
  try { Handlebars = createRequire(p)('handlebars'); break; } catch { /* keep looking */ }
}

const TPL = path.join(ROOT, 'templates/gm-contact-manager/gm-contact-manager.hbs');
const src = fs.readFileSync(TPL, 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'scripts/ui/GMContactManager/GMContactManagerApp.js'), 'utf8');

// ═══════════════════════════════════════════════════════════════════════════
section('the Share targets go through the searchable picker');

check('no Share <select> survives in the template', () => {
  assert.ok(!/name="pushAllTargetActor"|name="pushTargetActor"/.test(src), 'a whole-world share select is back');
  assert.ok(!/shareTargetPlayers|shareTargetNPCs|hasShareNPCs/.test(src), 'the template still expects the old share lists');
  assert.ok(!/\.\.\/shareTarget|\.\.\/hasShareNPCs/.test(src), '../shareTarget* resolves to nothing at that depth');
});

check('the context no longer enumerates every actor for the template', () => {
  assert.ok(!/shareTargetPlayers|shareTargetNPCs|hasShareNPCs|availableActors/.test(APP), 'the old share/actor lists are still built on every render');
});

check('both Share handlers pick the target through the picker', () => {
  const pick = APP.indexOf('async _pickShareTarget(');
  assert.ok(pick > 0, '_pickShareTarget is missing');
  const one = APP.slice(APP.indexOf('static async _onPushToPlayer('), APP.indexOf('static async _onPushAllToPlayer('));
  const all = APP.slice(APP.indexOf('static async _onPushAllToPlayer('), APP.indexOf('static async _onPushAllToPlayer(') + 1200);
  assert.ok(one.includes('this._pickShareTarget('), 'Share (one contact) does not open the picker');
  assert.ok(all.includes('this._pickShareTarget('), 'Share All does not open the picker');
  assert.ok(!one.includes('querySelector(\'[name="pushTargetActor"]\')') && !all.includes('pushAllTargetActor'), 'a handler still reads the dead select');
  const body = APP.slice(pick, pick + 900);
  assert.ok(body.includes('showNamePicker(') && body.includes('documentEntries('), 'the picker is the shared one');
  assert.ok(body.includes("'Players'"), 'player characters get their own chip');
});

check('_pickShareTarget is an INSTANCE method (static handlers call it through `this`)', () => {
  // The static-method trap: `this.foo()` from a bound static handler silently
  // returns undefined when `foo` is also static.
  assert.ok(/\n  async _pickShareTarget\(/.test(APP) && !/static async _pickShareTarget\(/.test(APP));
});

if (!Handlebars) {
  fail++;
  console.log('  FAIL could not load Handlebars from a Foundry install — render checks did not run');
} else {
  const ctx = {
    hasService: true,
    hasSelection: true, isCreating: false, showForm: false,
    contacts: [], groups: [], roleOptions: [], customRoles: [], playerActors: [],
    selectedContact: { id: 'c1', name: 'Rogue', notes: '', playerRelationships: [], chips: [], tags: [] },
  };
  const H = {
    not: (v) => !v, eq: (a, b) => a === b, ne: (a, b) => a !== b,
    gt: (a, b) => a > b, lt: (a, b) => a < b, gte: (a, b) => a >= b, lte: (a, b) => a <= b,
    and: (...a) => a.slice(0, -1).every(Boolean), or: (...a) => a.slice(0, -1).some(Boolean),
    concat: (...a) => a.slice(0, -1).join(''), localize: (k) => String(k),
    selectOptions: () => '', letter: (i) => String.fromCharCode(65 + Number(i || 0)),
  };
  for (const [k, fn] of Object.entries(H)) Handlebars.registerHelper(k, fn);
  Handlebars.registerHelper('helperMissing', function (...args) {
    const opts = args[args.length - 1];
    return opts && typeof opts.fn === 'function' ? opts.fn(this) : '';
  });
  Handlebars.registerPartial(
    'modules/night-city-messenger/templates/contact-manager/partials/contact-form.hbs',
    '<!-- contact form -->');
  const html = Handlebars.compile(src)(ctx);

  check('the real template renders both Share buttons', () => {
    assert.ok(/data-action="pushAllToPlayer"/.test(html), 'Share All button missing from the top bar');
    assert.ok(/data-action="pushToPlayer"/.test(html), 'Share button missing from the detail panel');
    assert.ok(/name="pushIncludePortrait"/.test(html), 'the include-portrait toggle must survive beside the Share button');
  });
  check('…and no share select', () => {
    assert.ok(!/<select[^>]*name="push/.test(html));
  });
}

// ═══════════════════════════════════════════════════════════════════════════
section('a broadcast reaches the whole table');

const NET = fs.readFileSync(path.join(ROOT, 'scripts/ui/AdminPanel/tabs/NetworksTab.js'), 'utf8');

check('the GM can see their own broadcast', () => {
  const i = NET.indexOf('async onSendBroadcast(');
  const fn = NET.slice(i, i + 2200);
  assert.ok(fn.includes('game.users.filter(u => u.active).map(u => u.id)'),
    'GMs must not be filtered out of the audience');
  assert.ok(!fn.includes("filter(u => u.active && !u.isGM)"),
    'the old filter excluded every GM, so the sender had no record of it');
});

check('an empty audience can never make a whisper public', () => {
  const i = NET.indexOf('async onSendBroadcast(');
  const fn = NET.slice(i, i + 2200);
  assert.ok(fn.includes('if (!whisperTargets.includes(game.user.id)) whisperTargets.push(game.user.id);'),
    'Foundry treats whisper:[] as PUBLIC — the sender keeps the list non-empty');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
