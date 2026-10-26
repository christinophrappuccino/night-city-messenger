// Sim: the address directory export / import (Admin → Tools → Email Domains &
// Addresses, 2026-10-24). Drives the REAL pure module scripts/utils/emailDirectory.js
// + scripts/utils/csv.js with mocked worlds, then greps the wiring the dialog
// can get wrong. Run: node dev/tools/sims/test-email-import.mjs
import { pathToFileURL, fileURLToPath } from 'url';
import fs from 'fs';
import path from 'path';
import assert from 'assert';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (name, fn) => {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (err) { fail++; console.error(`  ✗ ${name}\n      ${err.message}`); }
};

const { parseCsv, toCsv, csvEscape } = await import(pathToFileURL(`${ROOT}/scripts/utils/csv.js`).href);
const D = await import(pathToFileURL(`${ROOT}/scripts/utils/emailDirectory.js`).href);

// ═══ CSV helper ═══
console.log('\ncsv.js');
ok('parses quoted fields, escaped quotes, CRLF, embedded newlines', () => {
  const g = parseCsv('a,b\r\n"x, y","he said ""hi"""\r\n"multi\nline",z\r\n');
  assert.deepStrictEqual(g, [['a', 'b'], ['x, y', 'he said "hi"'], ['multi\nline', 'z']]);
});
ok('auto-detects ; and tab delimiters from the first line', () => {
  assert.deepStrictEqual(parseCsv('a;b\n1;2'), [['a', 'b'], ['1', '2']]);
  assert.deepStrictEqual(parseCsv('a\tb\n1\t2'), [['a', 'b'], ['1', '2']]);
});
ok('blank rows are dropped', () => {
  assert.deepStrictEqual(parseCsv('a,b\n\n , \n1,2'), [['a', 'b'], ['1', '2']]);
});
ok('toCsv quotes what needs quoting and round-trips through parseCsv', () => {
  const rows = [{ name: 'Rogue, Fixer', email: 'rogue@afterlife.nc' }, { name: 'He said "hi"', email: 'x@y.z' }];
  const text = toCsv(rows, ['name', 'email']);
  assert.ok(text.startsWith('name,email\r\n'));
  assert.deepStrictEqual(parseCsv(text).slice(1), [['Rogue, Fixer', 'rogue@afterlife.nc'], ['He said "hi"', 'x@y.z']]);
  assert.strictEqual(csvEscape(' lead'), '" lead"');
});
ok('DataShardComposer delegates to the shared parser (no second copy)', () => {
  const src = read('scripts/ui/ItemInbox/DataShardComposer.js');
  assert.ok(src.includes("import { parseCsv } from '../../utils/csv.js'"));
  assert.ok(/_parseCsv\(text\) \{\n\s*return parseCsv\(text\);/.test(src));
  assert.ok(!src.includes("const delim = [',', ';', '\\t']"), 'the inline parser body is gone');
});

// ═══ A world ═══
const world = () => ({
  actors: [
    { id: 'a1', name: 'V', type: 'character', email: 'v@nightcity.net', hasPlayerOwner: true },
    { id: 'a2', name: 'Rogue-Fixer', type: 'character', email: '', hasPlayerOwner: false },
    { id: 'a3', name: 'Judy Alvarez', type: 'character', email: 'judy@mox.nc', hasPlayerOwner: false },
    { id: 'a4', name: 'Twin', type: 'character', email: '', hasPlayerOwner: false },
    { id: 'a5', name: 'Twin', type: 'character', email: '', hasPlayerOwner: false },
    { id: 'ice', name: 'Hellhound', type: 'blackIce', email: '' },
  ],
  contacts: [
    { id: 'c1', name: 'Rogue', email: 'rogue@afterlife.nc', actorId: 'a2' },
    { id: 'c2', name: 'System Alerts', email: 'alerts@localhost', actorId: null },
    { id: 'c3', name: 'Judy Alvarez', email: 'judy@mox.nc', actorId: 'a3' },
  ],
});
const plan = (rows, w = world()) => D.planDirectoryImport(rows, w);
const row = (name, email, extra = {}) => ({ line: 1, name, email, kind: '', actorId: '', contactId: '', ...extra });

// ═══ Export ═══
console.log('\nexport');
ok('every address, characters then contacts, A→Z, ICE actors excluded', () => {
  const rows = D.buildDirectoryRows(world());
  assert.deepStrictEqual(rows.map(r => `${r.kind}:${r.name}`), ['actor:Judy Alvarez', 'actor:V', 'contact:Judy Alvarez', 'contact:Rogue', 'contact:System Alerts']);
  assert.ok(!rows.some(r => r.name === 'Hellhound'));
  assert.ok(!rows.some(r => r.name === 'Rogue-Fixer'), 'an actor with no address is not exported');
  const rogue = rows.find(r => r.kind === 'contact' && r.name === 'Rogue');
  assert.strictEqual(rogue.actorId, 'a2', 'a linked contact row carries the actor link');
});
ok('CSV export round-trips: re-importing it plans ZERO writes (everything unchanged)', () => {
  const rows = D.buildDirectoryRows(world());
  const text = D.directoryToCsv(rows);
  const parsed = D.parseDirectoryImport(text);
  assert.strictEqual(parsed.format, 'csv');
  assert.strictEqual(parsed.rows.length, rows.length);
  const { summary } = plan(parsed.rows);
  assert.strictEqual(summary.updateActor + summary.updateContact + summary.createContact, 0);
  assert.strictEqual(summary.skip, rows.length);
});
ok('JSON export round-trips through the envelope', () => {
  const rows = D.buildDirectoryRows(world());
  const parsed = D.parseDirectoryImport(D.directoryToJson(rows, new Date(0)));
  assert.strictEqual(parsed.format, 'json');
  assert.strictEqual(parsed.rows.length, rows.length);
  assert.strictEqual(parsed.rows[0].actorId, 'a3');
  assert.ok(D.directoryToJson(rows, new Date(0)).includes('"ncmEmailDirectory": 1'));
});

// ═══ Parse ═══
console.log('\nparse');
ok('CSV with a header: columns found by alias, any order', () => {
  const p = D.parseDirectoryImport('Email,Character\njudy@mox.nc,Judy Alvarez\n');
  assert.deepStrictEqual([p.rows[0].name, p.rows[0].email, p.rows[0].line], ['Judy Alvarez', 'judy@mox.nc', 2]);
});
ok('CSV without a header: name, email[, kind] positional', () => {
  const p = D.parseDirectoryImport('Judy Alvarez,judy@mox.nc,contact\nRogue,rogue@afterlife.nc');
  assert.strictEqual(p.rows.length, 2);
  assert.deepStrictEqual([p.rows[0].name, p.rows[0].email, p.rows[0].kind, p.rows[0].line], ['Judy Alvarez', 'judy@mox.nc', 'contact', 1]);
});
ok('a header is not mistaken for data when its "email" cell is a real address', () => {
  const p = D.parseDirectoryImport('V,v@nightcity.net\nRogue,rogue@afterlife.nc');
  assert.strictEqual(p.rows.length, 2, 'no header detected → both rows are data');
});
ok('a lone address in the first column is an address with no name', () => {
  const p = D.parseDirectoryImport('ghost@darknet.relay');
  assert.deepStrictEqual([p.rows[0].name, p.rows[0].email], ['', 'ghost@darknet.relay']);
});
ok('JSON: envelope, bare array, name→address map, and a master-contacts export all read', () => {
  assert.strictEqual(D.parseDirectoryImport('{"entries":[{"name":"V","email":"v@x.y"}]}').rows.length, 1);
  assert.strictEqual(D.parseDirectoryImport('[{"name":"V","email":"v@x.y"}]').rows.length, 1);
  assert.strictEqual(D.parseDirectoryImport('{"V":"v@x.y","Rogue":"r@x.y"}').rows.length, 2);
  assert.strictEqual(D.parseDirectoryImport('{"ncmMasterContacts":1,"contacts":[{"id":"c9","name":"Z","email":"z@x.y"}]}').rows[0].contactId, 'c9');
});
ok('bad input reports, never throws', () => {
  assert.ok(D.parseDirectoryImport('').error);
  assert.ok(D.parseDirectoryImport('{not json').error);
  assert.ok(D.parseDirectoryImport('﻿name,email\n').rows.length === 0);
});
ok('kind words normalise: character/pc → actor, master → contact, junk → ""', () => {
  const p = D.parseDirectoryImport('[{"name":"a","email":"a@b.c","kind":"character"},{"name":"b","email":"b@b.c","type":"master"},{"name":"c","email":"c@b.c","kind":"banana"}]');
  assert.deepStrictEqual(p.rows.map(r => r.kind), ['actor', 'contact', '']);
});

// ═══ Plan ═══
console.log('\nplan');
ok('a name that matches a character (space/punctuation-insensitive) updates the character', () => {
  const [p] = plan([row('rogue fixer', 'rogue@new.nc')]).plan;
  assert.strictEqual(p.action, 'update-actor');
  assert.strictEqual(p.targetId, 'a2');
  assert.strictEqual(p.previous, '');
});
ok('…and ALSO updates the master contact linked to that character when its address differs', () => {
  const [p] = plan([row('Rogue-Fixer', 'rogue@new.nc')]).plan;
  assert.deepStrictEqual(p.also, { contactId: 'c1', name: 'Rogue' });
});
ok('a name that matches only a master contact updates the contact', () => {
  const [p] = plan([row('System Alerts', 'alerts@arasaka.corp')]).plan;
  assert.strictEqual(p.action, 'update-contact');
  assert.strictEqual(p.targetId, 'c2');
  assert.strictEqual(p.previous, 'alerts@localhost');
  assert.strictEqual(p.also, undefined);
});
ok('updating a contact ALSO updates its linked character when the flag differs', () => {
  const [p] = plan([row('Rogue', 'rogue@new.nc', { kind: 'contact' })]).plan;
  assert.strictEqual(p.action, 'update-contact');
  assert.deepStrictEqual(p.also, { actorId: 'a2', name: 'Rogue-Fixer' });
});
ok('an unknown name with no kind becomes a NEW master contact', () => {
  const [p] = plan([row('Kowalski', 'kowalski@nc.net')]).plan;
  assert.strictEqual(p.action, 'create-contact');
  assert.strictEqual(p.targetName, 'Kowalski');
});
ok('kind: actor never creates a contact — an unknown character is a skip with the reason', () => {
  const [p] = plan([row('Kowalski', 'kowalski@nc.net', { kind: 'actor' })]).plan;
  assert.strictEqual(p.action, 'skip');
  assert.match(p.reason, /no character named "Kowalski"/);
});
ok('kind: contact never touches a character even when one has that name', () => {
  const [p] = plan([row('Judy Alvarez', 'judy@new.nc', { kind: 'contact' })]).plan;
  assert.strictEqual(p.action, 'update-contact');
  assert.strictEqual(p.targetId, 'c3');
  assert.deepStrictEqual(p.also, { actorId: 'a3', name: 'Judy Alvarez' }, 'the linked actor is kept in step');
});
ok('an explicit actorId beats the name', () => {
  const [p] = plan([row('whatever', 'x@y.z', { actorId: 'a3' })]).plan;
  assert.strictEqual(p.targetId, 'a3');
});
ok('an explicit contactId beats the name', () => {
  const [p] = plan([row('whatever', 'x@y.z', { contactId: 'c2' })]).plan;
  assert.strictEqual(p.action, 'update-contact');
  assert.strictEqual(p.targetId, 'c2');
});
ok('a blank address never clears one', () => {
  const [p] = plan([row('V', '')]).plan;
  assert.strictEqual(p.action, 'skip');
  assert.match(p.reason, /blank leaves the current one/);
});
ok('a malformed address is skipped with the reason', () => {
  const [p] = plan([row('V', 'not an address')]).plan;
  assert.strictEqual(p.action, 'skip');
  assert.match(p.reason, /not an address/);
});
ok('an unchanged address is a skip, not a write', () => {
  const [p] = plan([row('V', 'V@NightCity.net ')]).plan;
  assert.strictEqual(p.action, 'skip');
  assert.match(p.reason, /already has this address/);
});
ok('two characters with the same name → skip, asks for the actorId column', () => {
  const [p] = plan([row('Twin', 'twin@x.y')]).plan;
  assert.strictEqual(p.action, 'skip');
  assert.match(p.reason, /2 characters are named "Twin"/);
});
ok('ICE actors are never a target (a "Hellhound" row makes a contact, not a flag on the ICE)', () => {
  const [p] = plan([row('Hellhound', 'hh@x.y')]).plan;
  assert.strictEqual(p.action, 'create-contact');
});
ok('the same target twice in one file: the second row is skipped and names the first', () => {
  const rows = [{ ...row('V', 'v1@x.y'), line: 1 }, { ...row('V', 'v2@x.y'), line: 2 }];
  const { plan: pl } = plan(rows);
  assert.strictEqual(pl[0].action, 'update-actor');
  assert.strictEqual(pl[1].action, 'skip');
  assert.match(pl[1].reason, /row 1/);
});
ok('the same address on two rows is a WARNING (it lands), naming the first row', () => {
  const rows = [{ ...row('V', 'same@x.y'), line: 1 }, { ...row('System Alerts', 'same@x.y'), line: 2 }];
  const { plan: pl } = plan(rows);
  assert.strictEqual(pl[1].action, 'update-contact');
  assert.ok(pl[1].warnings.some(w => /same address as row 1/.test(w)));
});
ok('an address someone else already holds is a WARNING naming them', () => {
  const [p] = plan([row('V', 'judy@mox.nc')]).plan;
  assert.strictEqual(p.action, 'update-actor');
  assert.ok(p.warnings.some(w => /already used by Judy Alvarez/.test(w)));
});
ok('…but not when the "someone else" is the linked twin being kept in step', () => {
  const [p] = plan([row('Rogue-Fixer', 'rogue@afterlife.nc')]).plan;
  // actor has no flag, contact already has this address → actor write + no also, no "used by" warning for its own contact
  assert.strictEqual(p.action, 'update-actor');
  assert.strictEqual(p.also, undefined);
  assert.ok(!p.warnings.some(w => /already used/.test(w)));
});
ok('a player character is flagged as such', () => {
  const [p] = plan([row('V', 'v2@x.y')]).plan;
  assert.ok(p.warnings.some(w => /player character/.test(w)));
});
ok('an address with no name and no id is a skip', () => {
  const [p] = plan([row('', 'ghost@x.y')]).plan;
  assert.strictEqual(p.action, 'skip');
  assert.match(p.reason, /no name/);
});
ok('summary counts add up', () => {
  const rows = [row('V', 'v2@x.y'), row('System Alerts', 'a@b.c'), row('New Guy', 'n@b.c'), row('V', '')].map((r, i) => ({ ...r, line: i + 1 }));
  const { summary } = plan(rows);
  assert.deepStrictEqual(summary, { updateActor: 1, updateContact: 1, createContact: 1, skip: 1, warnings: 1 });
});
ok('planning writes nothing — the world is untouched', () => {
  const w = world();
  const snap = JSON.stringify(w);
  plan([row('V', 'v2@x.y'), row('Rogue-Fixer', 'r@x.y'), row('New', 'n@x.y')], w);
  assert.strictEqual(JSON.stringify(w), snap);
});

// ═══ Domains ═══
console.log('\ndomains');
ok('domain envelope round-trips', () => {
  const text = D.domainsToJson({ defaultDomain: 'nightcity.net', domains: ['arasaka.corp', 'Mox.NC'], allowCustom: false }, new Date(0));
  const p = D.parseDomainsImport(text);
  assert.deepStrictEqual(p, { defaultDomain: 'nightcity.net', domains: ['arasaka.corp', 'mox.nc'], allowCustom: false });
});
ok('a bare array or one-per-line text reads as domains; the default is never cleared by an import without one', () => {
  assert.deepStrictEqual(D.parseDomainsImport('["a.b","@c.d","a.b"]').domains, ['a.b', 'c.d']);
  const p = D.parseDomainsImport('a.b\nc.d, e.f\n');
  assert.deepStrictEqual(p.domains, ['a.b', 'c.d', 'e.f']);
  assert.strictEqual(p.defaultDomain, null);
  assert.strictEqual(p.allowCustom, null);
});
ok('bad domain input reports', () => {
  assert.ok(D.parseDomainsImport('').error);
  assert.ok(D.parseDomainsImport('{oops').error);
});

// ═══ Wiring ═══
console.log('\nwiring');
const tab = read('scripts/ui/AdminPanel/tabs/ToolsTab.js');
ok('the dialog carries every button the handlers wire', () => {
  for (const id of ['ncm-dom-export', 'ncm-dom-import', 'ncm-dir-export-csv', 'ncm-dir-export-json', 'ncm-dir-import']) {
    assert.ok(tab.includes(`id="${id}"`), `markup has #${id}`);
    assert.ok(tab.includes(`#${id}'`), `handler wired for #${id}`);
  }
});
ok('the world adapter excludes non-person actors and reads the email flag', () => {
  assert.ok(tab.includes('NON_PERSON_ACTOR_TYPES.has(a.type)'));
  assert.ok(tab.includes("a.getFlag?.(MODULE_ID, 'email')"));
});
ok('characters are written through EmailService.forceSetEmail (the one writer that warns on a taken address)', () => {
  assert.ok(tab.includes('emailService.forceSetEmail(a, email)'));
  assert.ok(tab.includes("mcs?.updateContact?.(contactId, { email })"));
});
ok('the preview is an admin dialog, nothing raw', () => {
  assert.ok(!/new Dialog\(/.test(tab));
  assert.ok(tab.includes("classes: ['ncm-pick-dialog', 'ncm-dirimp-dialog']"));
});
ok('styles exist for the tool buttons and the preview, in admin-panel.css, with no raw brand hex', () => {
  const css = read('styles/components/admin-panel.css');
  for (const cls of ['.ncm-pick-dialog button.ncm-domain-dialog__tool', '.ncm-dirimp__table', '.ncm-dirimp__act--create', '.ncm-dirimp__warn']) assert.ok(css.includes(cls), cls);
  const block = css.slice(css.indexOf('Export / import tool rows'));
  assert.ok(!/#(19f3f7|2a2a45|1a1a2e|555570)/i.test(block), 'no brand literals');
  assert.ok(/\.ncm-dirimp__table \{[^}]*margin: 0/.test(block), "table margin reset (core's 1rem clips the last column)");
});
ok('the guide tells the GM where the import lives', () => {
  assert.ok(read('docs/GETTING-STARTED.md').includes('Email Domains & Addresses'));
});

console.log(`\n${fail ? '✗' : '✓'} ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
