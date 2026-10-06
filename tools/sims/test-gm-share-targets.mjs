/**
 * Sim — the GM Contact Manager's Share targets + the network broadcast audience.
 * @file tools/sims/test-gm-share-targets.mjs
 * @description Compiles the REAL gm-contact-manager.hbs through Handlebars with a
 *   realistic context and asserts the Share selects actually list the player-owned
 *   characters. The bug this guards: the detail panel's select used `../shareTargetPlayers`
 *   while sitting inside `{{#if}}` blocks with no parent context, so the optgroup
 *   rendered its "Players" label with nothing under it.
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

// ═══════════════════════════════════════════════════════════════════════════
section('the Share selects name the player characters');

check('no Share list reaches out of its block for the data', () => {
  // `../` walks out of the enclosing {{#if}}, and at this depth there is no parent
  // context — the list silently resolves to nothing. `@root` is depth-proof.
  assert.ok(!/\.\.\/shareTarget/.test(src), '../shareTarget* resolves to nothing here');
  assert.ok(!/\.\.\/hasShareNPCs/.test(src), '../hasShareNPCs resolves to nothing here');
  assert.ok(src.includes('@root.shareTargetPlayers'), 'the detail panel must read the root context');
});

if (!Handlebars) {
  fail++;
  console.log('  FAIL could not load Handlebars from a Foundry install — render checks did not run');
} else {
  const ctx = {
    hasService: true,
    // The detail panel is the third arm of an {{#if}}/{{else if}} chain, which is
    // exactly why it sat a frame deeper than the top bar.
    hasSelection: true, isCreating: false, showForm: false,
    contacts: [], groups: [], roleOptions: [], customRoles: [], playerActors: [],
    shareTargetPlayers: [{ id: 'a1', name: 'V' }, { id: 'a2', name: 'Judy' }],
    shareTargetNPCs: [{ id: 'n1', name: 'Wakako' }],
    hasShareNPCs: true,
    selectedContact: { id: 'c1', name: 'Rogue', notes: '', playerRelationships: [], chips: [], tags: [] },
    availableActors: [],
  };
  // Foundry's own helpers, stubbed just enough to let the template compile.
  const H = {
    not: (v) => !v, eq: (a, b) => a === b, ne: (a, b) => a !== b,
    gt: (a, b) => a > b, lt: (a, b) => a < b, gte: (a, b) => a >= b, lte: (a, b) => a <= b,
    and: (...a) => a.slice(0, -1).every(Boolean), or: (...a) => a.slice(0, -1).some(Boolean),
    concat: (...a) => a.slice(0, -1).join(''), localize: (k) => String(k),
    selectOptions: () => '', letter: (i) => String.fromCharCode(65 + Number(i || 0)),
  };
  for (const [k, fn] of Object.entries(H)) Handlebars.registerHelper(k, fn);
  // Anything else the template reaches for is chrome, not data — render it empty
  // rather than letting one unknown helper hide the thing under test.
  Handlebars.registerHelper('helperMissing', function (...args) {
    const opts = args[args.length - 1];
    return opts && typeof opts.fn === 'function' ? opts.fn(this) : '';
  });
  Handlebars.registerPartial(
    'modules/night-city-messenger/templates/contact-manager/partials/contact-form.hbs',
    '<!-- contact form -->');
  const html = Handlebars.compile(src)(ctx);

  // Each select is judged on its own — the top bar one was always fine, and a
  // whole-document search would let it cover for the broken one.
  const selects = [...html.matchAll(/<select[^>]*name="(pushAllTargetActor|pushTargetActor)"[\s\S]*?<\/select>/g)];

  check('both Share selects are rendered', () => {
    assert.equal(selects.length, 2, `expected 2 share selects, found ${selects.length}`);
  });

  for (const [block, which] of selects.map((m) => [m[0], m[1]])) {
    const where = which === 'pushTargetActor' ? 'the contact detail panel' : 'the top bar';
    check(`${where}: every player character is listed`, () => {
      assert.ok(block.includes('>V (Player)<'), 'V is missing');
      assert.ok(block.includes('>Judy (Player)<'), 'Judy is missing');
    });
    check(`${where}: the NPC group is not dropped`, () => {
      assert.ok(block.includes('label="NPCs"'), 'the NPC group is missing');
      assert.ok(block.includes('>Wakako<'), 'Wakako is missing');
    });
    check(`${where}: no group is labelled with nothing under it`, () => {
      const players = block.match(/label="Players"([\s\S]*?)<\/optgroup>/);
      assert.ok(players, 'the Players group is missing');
      assert.ok(/<option/.test(players[1]), 'a "Players" heading with no players under it is the reported bug');
    });
  }
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
