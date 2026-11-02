// Admin → Phone → Numbers + Number setup: every control has a handler, and the rules behind them.
// plain node. The screens themselves are walked in a browser by dev/mockups/admin-phone-numbers-probe.html.
import fs from 'fs';
import { buildNumberContext, placesDiff, placesEdited, placeRows, specialList, specialMap, specialOutcome, sanitizeSpecial, linkNumbers, parseNumber, defaultNumberContext } from '../../../scripts/utils/phoneNumbering.js';
import { startingRows } from '../../../scripts/data/phonePlaces.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL:', m); } };
const read = (p) => fs.readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');
const view = read('scripts/ui/AdminPanel/tabs/phoneNumbersView.js');

/* ── every control is wired ── */
const section = (name, end) => view.slice(view.indexOf(`const ${name} = {`), view.indexOf(end, view.indexOf(`const ${name} = {`)));
const ACT = section('ACT', '\nconst CH = {'), CH = section('CH', '\nconst INP = {'), INP = view.slice(view.indexOf('const INP = {'), view.indexOf('/* ─── the number popover'));
const has = (block, k) => new RegExp(`(^|[\\s{,])${k}: `, 'm').test(block);
const names = (re) => [...new Set([...view.matchAll(re)].map((m) => m[1]))];
const stat = names(/data-do="([A-Za-z]+)"/g), statCh = names(/data-ch="([A-Za-z]+)"/g), statIn = names(/data-in="([A-Za-z]+)"/g);
for (const d of stat) ok(has(ACT, d), `button data-do="${d}" has a handler`);
for (const d of statCh) ok(has(CH, d), `control data-ch="${d}" has a handler`);
for (const d of statIn) ok(has(INP, d), `box data-in="${d}" has a handler`);
// helpers build a data-do from a name
for (const m of view.matchAll(/seg\('([a-z]+)'/g)) ok(has(ACT, m[1]), `segment ${m[1]} has a handler`);
ok(stat.length > 50, 'the scan found the buttons');

/* ── nothing from the mock's demo world is left ── */
ok(!/SAMPLE_ART|sampleCsv|csvSample|document\.getElementById|window\.NCM_R2|Math\.random\(\)\.toString\(36\)\.slice\(2, 7\)/.test(view), 'no mock-only code');
ok(!/data-do="toast"/.test(view), 'no button only says what it would do');
ok(!/\bfor \(;;\)/.test(view), 'no loop that cannot end');
ok(!/REGIONS\[HOME\.rc\]\.cities/.test(view), 'an empty table cannot throw');
ok(!view.includes('ncm-pn-kv"><span>${esc(k)}'), 'remembered names use their own row');
const css = read('styles/components/admin-panel/tab-phone.css');
ok((css.match(/^\.ncm-pn-kv \{/gm) || []).length === 1, 'the line card key/value rule is not overridden');
ok(!/\.mk-|#mk-/.test(css), 'no page chrome came along');
ok(!/#[0-9a-f]{3,8}\b/i.test(css), 'tokens only');

/* ── the tab ── */
const tab = read('scripts/ui/AdminPanel/tabs/PhoneTab.js'), tpl = read('templates/admin-panel/tab-phone.hbs');
ok(tpl.includes('{{{numbersHtml}}}') && tab.includes('wireNumbers(this, root)') && tab.includes('closeNumbers(this)'), 'the screens are mounted, wired and cleaned up');
ok(!/numberGroups|NUMBER_SHOW/.test(tab + read('scripts/ui/AdminPanel/tabs/phoneModel.js')), 'the old list is gone');
ok(read('scripts/ui/AdminPanel/tabs/phoneModel.js').includes("['setup', 'Number setup'"), 'Number setup is on the nav');
ok(read('scripts/core/SettingsManager.js').includes("'phoneOrgNames'"), 'remembered organization names have a setting');

/* ── the table's stored form ── */
{
  const rows = startingRows('2045').map((r) => ({ ...r }));
  ok(!placesEdited(placesDiff(rows, '2045')), 'an untouched table stores nothing');
  rows[0].Listed = 'no'; rows.splice(3, 1); rows.push({ 'Region code': '99', Region: 'R', 'City code': 'MC', City: 'My', Code: 'UPT', District: 'Uptown', 'Players can pick': 'yes', Status: 'live', Listed: 'yes', 'Gang turf': 'Claws' });
  const stored = placesDiff(rows, '2045', ['Gang turf']);
  ok(placesEdited(stored) && stored.extra[0] === 'Gang turf', 'an edit is stored as a change');
  const back = placeRows(JSON.parse(JSON.stringify(stored)));
  const key = (r) => `${r['Region code']}/${r['City code']}/${r.Code || ''}`;
  ok(back.length === rows.length && rows.every((r) => back.some((b) => key(b) === key(r))), 'it comes back whole');
  ok(back.find((r) => key(r) === key(rows[0])).Listed === 'no' && back.find((r) => r.Code === 'UPT')['Gang turf'] === 'Claws', 'with the edit and the GM\'s column');
  ok(placeRows(placesDiff([], 'blank')).length === 0, 'a blank list stays blank');
  const ctx = buildNumberContext({ rows: [], home: { rc: '72', city: 'NC' } });
  ok(parseNumber('WAT-4471', ctx).done !== true, 'an empty table reads nothing, and does not throw');
}

/* ── special numbers ── */
{
  const dflt = specialList({});
  ok(dflt.map((x) => x.num).join() === 'TRAUMA,NCPD', 'a new world has the two');
  ok(specialList([]).length === 0, 'a GM can delete them');
  const x = sanitizeSpecial({ num: 'Black Wall', act: 'nope', who: 'some', allow: ['ks'], trace: 'false', falseName: 'Water Board' });
  ok(x.act === 'ring' && x.seen === 'listed', 'an unknown act falls back');
  ok(specialMap([x]).BLACKWALL === x, 'dialled however it is spelled');
  ok(specialOutcome(x, 'ks').outcome === 'ring' && specialOutcome(x, 'v').outcome === 'nis', 'chosen characters get through, others hear not in service');
  ok(specialOutcome(sanitizeSpecial({ num: '1', act: 'recording', alert: true }), 'v').alert, 'an alert is carried');
  const ctx = buildNumberContext({ rows: startingRows('2045'), home: { rc: '72', city: 'NC' }, service: specialMap([x]) });
  ok(parseNumber('BLACKWALL', ctx).service === 'BLACKWALL', 'the number reads as special');
}

/* ── clickable numbers ── */
{
  const ctx = defaultNumberContext();
  const a = linkNumbers('Call WAT-4471 now', ctx);
  ok(a.includes('data-number="WAT-4471"') && a.includes('data-action="dial-number"'), 'a number on a row links');
  ok(!linkNumbers('Part ZZZ-1234', ctx).includes('<a'), 'a code no district uses stays plain');
  ok(!linkNumbers('<a href="#">WAT-4471</a>', ctx).includes('dial-number'), 'never inside a link');
  ok(!linkNumbers('<img alt="WAT-4471">', ctx).includes('dial-number'), 'never inside a tag');
  ok(linkNumbers('+14 DAL CEN-1234', ctx).includes('dial-number'), 'the full form links');
}

/* ── alias rules (§8), as the code stands ── */
{
  const svc = read('scripts/services/CallService.js');
  const fn = svc.slice(svc.indexOf('  numberForContact(c) {'), svc.indexOf('/** Numbers that were changed'));
  ok(!fn.includes('numberOfContact') && !fn.includes('numberOf('), 'a contact never falls back to a directory or character number');
  const mcs = read('scripts/services/MasterContactService.js');
  ok(mcs.includes('actorId: aliasCopy ? null : contact.actorId'), 'an alias copy does not carry the character');
  ok(!/identityOf: rootId,[\s\S]{0,40}organization/.test(mcs) && !/type: root\.type \|\| 'npc', organization/.test(mcs), 'a new alias does not copy the organization');
  ok(svc.includes("['extra', 'burner'].includes(l.kind), alias = !!l.owner?.contactId"), 'a second line shares without naming its holder');
}

console.log(`test-phone-gm-tools: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
