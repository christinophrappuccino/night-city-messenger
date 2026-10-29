/**
 * Sim — the GM's Share targets + the network broadcast audience.
 * @file dev/tools/sims/test-gm-share-targets.mjs
 * @description Guards that every place the GM shares a contact lists the players'
 *   characters, and that no whole-world actor <select> comes back.
 *
 *   History: the GM Contact Manager's Share targets used to be two <select>s. The
 *   first bug (2026-09) was the detail panel reading `../shareTargetPlayers` from
 *   inside an {{#if}} chain, which resolved to nothing — a "Players" heading with
 *   no one under it. The second (2026-10-20) was the design itself: both selects
 *   listed EVERY actor in the world with no search. On 2026-10-27 the window was
 *   folded into Admin → Contacts: sharing is now (a) "Who knows them" — one chip
 *   per player character, click to share or take back, (b) the searchable picker
 *   (`ContactsTab._shareDialog`, `_sharePickerFor`) over getPlayerCharacters(),
 *   and (c) the Who-knows-whom grid (one column per character). This sim renders
 *   the REAL tab-contacts.hbs and checks every character shows up in each.
 *
 *   Run: node dev/tools/sims/test-gm-share-targets.mjs
 */
import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); pass++; console.log(`  ok   ${name}`); }
  catch (err) { fail++; console.log(`  FAIL ${name}\n       ${err.message}`); }
};
const section = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 58 - t.length))}`);

const CANDIDATES = [
  'C:/Program Files/Foundry Virtual Tabletop/resources/app/package.json',
  'C:/Program Files (x86)/Foundry Virtual Tabletop/resources/app/package.json',
];
let Handlebars = null;
for (const p of CANDIDATES) {
  if (!fs.existsSync(p)) continue;
  try { Handlebars = createRequire(p)('handlebars'); break; } catch { /* keep looking */ }
}

const src = fs.readFileSync(path.join(ROOT, 'templates/admin-panel/tab-contacts.hbs'), 'utf8');
const TAB = fs.readFileSync(path.join(ROOT, 'scripts/ui/AdminPanel/tabs/ContactsTab.js'), 'utf8');

// ═══════════════════════════════════════════════════════════════════════════
section('the Share targets are the players’ characters, through the picker');

check('the GM Contact Manager window (and its share selects) is gone', () => {
  assert.ok(!fs.existsSync(path.join(ROOT, 'templates/gm-contact-manager/gm-contact-manager.hbs')));
  assert.ok(!/<select[^>]*name="push|shareTargetPlayers|shareTargetNPCs|pushTargetActor/.test(src), 'a share select is back');
});

check('every share picker is built from getPlayerCharacters() and the shared name picker', () => {
  for (const fn of ['async _shareDialog(', 'async onGroupPush(']) {
    const i = TAB.indexOf(fn);
    assert.ok(i > 0, `${fn} is missing`);
    const body = TAB.slice(i, i + 1600);
    assert.ok(body.includes('getPlayerCharacters()') && body.includes('showNamePicker('), `${fn} does not list the characters through the picker`);
  }
  assert.ok(/\n  async _shareDialog\(/.test(TAB) && !/static async _shareDialog\(/.test(TAB), '_shareDialog is an instance method (the static-method trap)');
});

check('the "Who knows them" chips and the grid columns come from the same character list', () => {
  assert.ok(/who: pcs\.map\(/.test(TAB), 'detail chips are one per character');
  assert.ok(/to: pcs\.map\(/.test(TAB), 'group pushed-to chips are one per character');
  assert.ok(/const cols = pcs\.filter\(/.test(TAB), 'grid columns are the characters (scoped by the Columns picker)');
  assert.ok(/_pcs\(\) \{\s*return getPlayerCharacters\(\)/.test(TAB), '_pcs() is getPlayerCharacters()');
});

if (!Handlebars) {
  fail++;
  console.log('  FAIL could not load Handlebars from a Foundry install — render checks did not run');
} else {
  const H = Handlebars.create();
  H.registerPartial('modules/night-city-messenger/templates/admin-panel/partials/contacts-map.hbs', fs.readFileSync(path.join(ROOT, 'templates/admin-panel/partials/contacts-map.hbs'), 'utf8'));   // Who knows whom → Map
  { const { registerTagHueHelper } = await import(new URL('../../../scripts/utils/tagHue.js', import.meta.url).href); registerTagHueHelper(H); }
  H.registerHelper('eq', (a, b) => a === b);
  const pcs = [{ actorId: 'v', name: 'V', img: '', initials: 'V', on: true }, { actorId: 'rache', name: 'Rache', img: '', initials: 'R', on: false }];
  const ctx = {
    activeTab: 'contacts',
    ct2: {
      isDirectory: true, nav: [],
      dir: { groups: [], chips: [], sendAs: [], groupOpts: [], sortOpts: [],
        sel: { id: 'c1', name: 'Rogue', onMain: true, tags: [], meta: [], needs: [], who: pcs, hasPcs: true, trust: { segs: [], rows: [] }, ids: { rows: [] }, recent: [], kv: [] } },
    },
  };
  const html = H.compile(src)(ctx);
  check('the real template renders a share chip for every character, carrying the contact id', () => {
    for (const p of pcs) assert.ok(new RegExp(`data-op="whoToggle" data-id="c1" data-actor="${p.actorId}"`).test(html), `no chip for ${p.name}`);
  });
  const mx = H.compile(src)({ activeTab: 'contacts', ct2: { isMatrix: true, nav: [], mx: { chips: [], groupOpts: [], cols: pcs.map((p) => ({ ...p, knows: 1 })), groups: [{ label: 'Fixers', n: 1, open: true, tallies: [], rows: [{ id: 'c1', name: 'Rogue', cells: pcs.map((p) => ({ actorId: p.actorId, on: p.on })) }] }] } } });
  check('…and a grid column + cell per character', () => {
    for (const p of pcs) assert.ok(new RegExp(`data-op="mxCell" data-cid="c1" data-actor="${p.actorId}"`).test(mx), `no cell for ${p.name}`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
section('a broadcast reaches the whole table');

const NET = fs.readFileSync(path.join(ROOT, 'scripts/ui/AdminPanel/tabs/NetworksTab.js'), 'utf8');

check('the GM can see their own broadcast', () => {
  const i = NET.indexOf('async _sendBroadcast(');
  assert.ok(i > 0, 'the broadcast sender exists');
  const fn = NET.slice(i, i + 2600);
  assert.ok(fn.includes('const gms = game.users.filter(u => u.active && u.isGM)'), 'every online GM gets a copy, whoever the target is');
  assert.ok(/whisper = \[\.\.\.new Set\(\[[^\]]*\.\.\.gms/.test(fn), 'the GMs are in the whisper list');
});

check('an empty audience can never make a whisper public', () => {
  const i = NET.indexOf('async _sendBroadcast(');
  const fn = NET.slice(i, i + 2600);
  assert.ok(/whisper = \[\.\.\.new Set\(\[[^\]]*game\.user\.id\]/.test(fn), 'Foundry treats whisper:[] as PUBLIC — the sender keeps the list non-empty');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
