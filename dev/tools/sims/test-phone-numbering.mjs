// The number system's rules: reading, writing, generating, and matching organizations. Spec: PHONE-REVISION.md §2, §3, §5.
import { BOOK_ROWS, ERA_2077, CAMPAIGNS, startingRows, COLS } from '../../../scripts/data/phonePlaces.js';
import { buildNumberContext, parseNumber, normaliseNumber, sameNumber, fullForm, seenFrom, placeOf, isUnlisted, freeLines, numberAt, keyAt, rowOf, asKeys, specialKey, keyOf, matchOrganization, orgKey, rowsAtStep, pathOf, PICK_STEPS } from '../../../scripts/utils/phoneNumbering.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) pass++; else { fail++; console.log('  FAIL', n); } };
const eq = (a, b, n) => ok(JSON.stringify(a) === JSON.stringify(b), `${n}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const rows = startingRows('2045');
const ctx = buildNumberContext({ rows, home: { rc: '72', city: 'NC' }, service: { TRAUMA: { name: 'Trauma Team' }, '666': { name: 'The Voice' } } });

console.log('§1 the table');
ok(rows.length > 200, 'the 2045 list is the full table: ' + rows.length);
ok(COLS.includes('Listed') && COLS.includes('Players can pick'), 'columns');
ok(rows.every((r) => COLS.every((c) => c in r)), 'every row has every column');
const seen = new Set(); let dup = 0; for (const r of rows) { const k = r['Region code'] + '/' + r['City code'] + '/' + (r.Code || ''); if (seen.has(k)) dup++; seen.add(k); } eq(dup, 0, 'no row twice');
// region codes must never be the real country's dialling code
ok(ctx.regions['83']?.name === 'Japan' && !ctx.regions['81'], 'Japan is not +81');
for (const r of rows) if (r.Code) ok(/^[A-Z]{3}$/.test(r.Code), 'district code is three letters: ' + r.Code);
// pad keys must reach one place only, or digits would dial the wrong line
for (const [rc, R] of Object.entries(ctx.regions)) for (const [city, C] of Object.entries(R.cities)) { const m = new Map(); for (const code of Object.keys(C.ex)) { const k = asKeys(code); if (m.has(k)) ok(false, `pad keys clash in ${rc} ${city}: ${m.get(k)} and ${code}`); m.set(k, code); } }
{ const r2077 = startingRows('2077'); ok(r2077.some((r) => r.Code === 'JPT') && !r2077.some((r) => r.Code === 'NCM'), '2077 swaps the Night City districts'); ok(r2077.some((r) => r['City code'] === 'TKY'), '2077 keeps the rest of the world'); eq(startingRows('blank').length, 0, 'blank is empty'); ok(BOOK_ROWS.length > 0 && ERA_2077.length > 0 && CAMPAIGNS.dallas, 'exports'); }
{ const a = startingRows('2045'), b = startingRows('2045'); a[0].District = 'x'; ok(b[0].District !== 'x', 'each call gets fresh copies'); }
eq(rows.filter((r) => r.Category === 'Corporate').length, 116, '116 corporate offices');
ok(rows.find((r) => r.Code === 'ARA' && r['City code'] === 'NC')?.Listed === 'no', 'Arasaka Night City ships hidden');
{ const nc = rows.filter((r) => r['City code'] === 'NC' && r.Category !== 'Corporate' && r.Code); for (const c of ['HOT', 'NCM', 'EXZ']) ok(nc.find((r) => r.Code === c)?.['Players can pick'] === 'no', c + ' is not player-pickable'); ok(nc.find((r) => r.Code === 'WAT')?.['Players can pick'] === 'yes', 'Watson is'); }

console.log('§2 reading a whole number');
const WAT = keyOf('72', 'NC', 'WAT', '4471');
eq(normaliseNumber('WAT-4471', ctx), WAT, 'local');
eq(normaliseNumber('wat 4471', ctx), WAT, 'case and spacing');
eq(normaliseNumber('+72 NC WAT-4471', ctx), WAT, 'full');
eq(normaliseNumber('9284471', ctx), WAT, 'pad digits');
eq(normaliseNumber('928-4471', ctx), WAT, 'pad digits with a dash');
eq(normaliseNumber('+72 62 928 4471', ctx), WAT, 'pad digits all the way');
ok(sameNumber('WAT-4471', '9284471', ctx), 'letters and digits reach the same line');
ok(!sameNumber('WAT-4471', 'WAT-4472', ctx), 'different lines');
ok(!sameNumber('', '', ctx), 'empty is never the same');
eq(normaliseNumber('SEA DWN-2210', ctx), keyOf('72', 'SEA', 'DWN', '2210'), 'same region');
eq(normaliseNumber('+72 SEA DWN-2210', ctx), keyOf('72', 'SEA', 'DWN', '2210'), 'full, another city');
eq(normaliseNumber('+83 OSK-1234', ctx), keyOf('83', 'OSK', '', '1234'), 'a city with no districts');
eq(normaliseNumber('+10 DC MIL-0100', ctx), keyOf('10', 'DC', 'MIL', '0100'), 'a corporate office');
eq(normaliseNumber('TRAUMA', ctx), '#TRAUMA', 'special word');
eq(normaliseNumber('trauma', ctx), '#TRAUMA', 'special word, any case');
eq(normaliseNumber('666', ctx), '#666', 'special digits');

console.log('§3 part-typed numbers explain themselves');
ok(parseNumber('', ctx).empty, 'empty');
ok(parseNumber('+', ctx).hint.includes('region code'), '+ asks for a region');
ok(parseNumber('+99', ctx).bad, 'an unknown region is bad');
ok(parseNumber('+72', ctx).hint.includes('Pacifica'), 'region named');
ok(parseNumber('W', ctx).hint.includes('WAT'), 'first letter suggests');
{ const p = parseNumber('WAT-44', ctx); ok(p.partial && p.ex === 'WAT' && p.line === '44' && !p.done && !p.key, 'part line'); }
ok(parseNumber('QQQ-1234', ctx).bad, 'unknown district is bad');
eq(normaliseNumber('QQQ-1234', ctx), '', 'and never a key');
eq(normaliseNumber('WAT-44', ctx), '', 'a part number is never a key');
eq(parseNumber('WAT-44719', ctx).line, '4471', 'extra digits stop at the line');

console.log('§4 writing');
{ const p = parseNumber('WAT-4471', ctx); eq(fullForm(p), '+72 NC WAT-4471', 'full form'); eq(seenFrom(p, ctx), 'WAT-4471', 'from home'); eq(seenFrom(p, ctx, { rc: '72', city: 'SEA' }), 'NC WAT-4471', 'from the same region'); eq(seenFrom(p, ctx, { rc: '83', city: 'TKY' }), '+72 NC WAT-4471', 'from far away'); }
{ const p = parseNumber('SEA DWN-2210', ctx); eq(seenFrom(p, ctx), 'SEA DWN-2210', 'another city reads short'); eq(fullForm(p), '+72 SEA DWN-2210', 'and full'); }
{ const p = parseNumber('+83 OSK-1234', ctx); eq(fullForm(p), '+83 OSK-1234', 'no district'); eq(seenFrom(p, ctx), '+83 OSK-1234', 'from far'); ok(placeOf(p, ctx).includes('Japan'), 'names the region when far'); }
eq(placeOf(parseNumber('WAT-4471', ctx), ctx), 'Watson Development, Night City', 'in words');
{ const p = parseNumber('+72 NC ARA-1234', ctx); ok(isUnlisted(p, ctx), 'hidden office'); eq(placeOf(p, ctx), 'Unlisted number', 'says nothing else'); }
eq(fullForm(parseNumber('TRAUMA', ctx)), 'TRAUMA', 'special word keeps its form');
{ const row = rowOf(parseNumber('WAT-4471', ctx), ctx); eq(row.District, 'Watson Development', 'rowOf'); eq(numberAt(row, '4471'), '+72 NC WAT-4471', 'numberAt'); eq(keyAt(row, '4471'), WAT, 'keyAt'); eq(normaliseNumber(numberAt(row, '1111'), ctx), keyAt(row, '1111'), 'a written number reads back as its key'); }

console.log('§5 other homes');
{ const dal = buildNumberContext({ rows, home: { rc: '14', city: 'DAL' } }); eq(normaliseNumber('+14 DAL CEN-3345', dal) === '' ? 'none' : 'some', rows.some((r) => r['City code'] === 'DAL' && r.Code === 'CEN') ? 'some' : 'none', 'Dallas row'); eq(normaliseNumber('+72 NC WAT-4471', dal), WAT, 'a Night City number from Dallas'); eq(seenFrom(parseNumber('+72 NC WAT-4471', dal), dal), '+72 NC WAT-4471', 'reads long from there'); }
{ const lost = buildNumberContext({ rows, home: { rc: '99', city: 'ZZ' } }); ok(!!lost.regions[lost.home.rc], 'a home no longer in the table falls back'); parseNumber('WAT-4471', lost); }
{ const none = buildNumberContext({ rows: [], home: { rc: '72', city: 'NC' } }); ok(parseNumber('WAT-4471', none).partial, 'a blank table does not throw'); eq(normaliseNumber('WAT-4471', none), '', 'and has no numbers'); }

console.log('§6 generating');
{ const row = rowOf(parseNumber('WAT-1', ctx), ctx) || rows.find((r) => r.Code === 'WAT'); const a = freeLines(row, { seed: 7 }), b = freeLines(row, { seed: 7 }); eq(a, b, 'same seed, same lines'); eq(a.length, 4, 'four by default'); ok(a.every((l) => /^\d{4}$/.test(l)), 'four digits'); eq(new Set(a).size, 4, 'all different');
  const taken = a.map((l) => keyAt(row, l)); const c = freeLines(row, { seed: 7, taken }); ok(c.every((l) => !a.includes(l)), 'never a taken or retired line');
  eq(freeLines(row, { near: '3302', count: 1, seed: 1 }), ['3303'], 'beside a coworker'); eq(freeLines(row, { near: '3302', count: 1, seed: 1, taken: [keyAt(row, '3303')] }), ['3304'], 'next free beside them'); eq(freeLines(row, { near: '9999', count: 1, seed: 1 }), ['0000'], 'wraps at the end');
  const full = Array.from({ length: 9999 }, (_, i) => keyAt(row, String(i).padStart(4, '0'))); eq(freeLines(row, { taken: full, seed: 3 }), ['9999'], 'a nearly full row still finds the last line'); eq(freeLines(row, { taken: [...full, keyAt(row, '9999')], seed: 3 }), [], 'a full row says so with nothing'); }

console.log('§7 the picker walk');
{ const row = rows.find((r) => r.Code === 'WAT'), p = pathOf(row); eq(p.code, 'WAT', 'path'); eq(rowsAtStep(rows, p, PICK_STEPS.length).length, 1, 'all five steps reach one row'); ok(rowsAtStep(rows, p, 1).length > rowsAtStep(rows, p, 3).length, 'each step narrows'); eq(PICK_STEPS.map((s) => s.label), ['Region', 'State', 'City', 'Area', 'District'], 'the five steps'); }
{ const noEx = rows.find((r) => r['City code'] === 'OSK'); eq(PICK_STEPS[4].name(noEx) || PICK_STEPS[4].blank, 'No district', 'a blank is an option'); }

console.log('§8 organizations');
const corps = [...new Set(rows.filter((r) => r.Category === 'Corporate').map((r) => r.District))];
const M = 'Militech International';
for (const o of ['Militech', 'militech', 'Militech International', 'Militech Security', 'Militech Corp', 'MILITECH, INC.']) eq(matchOrganization(o, corps).corp, M, o);
eq(matchOrganization('Milltech', corps), { state: 'guess', guess: M }, 'a typo asks');
eq(matchOrganization('Maelstrom', corps).state, 'miss', 'a gang misses');
eq(matchOrganization('', corps).state, 'none', 'empty');
eq(matchOrganization('Team Alpha', corps).state, 'miss', 'a shared word is no match');
eq(matchOrganization('Trauma Team', corps).corp, 'Trauma Team', 'two-word corp');
eq(matchOrganization('Danger Zone', corps).state, 'guess', 'half a name is a question');
eq(matchOrganization('Rocklin', corps).state, 'guess', 'half a name, again');
eq(matchOrganization('Milltech', corps, { [orgKey('Milltech')]: M }), { state: 'ok', corp: M, remembered: true }, 'a decision is remembered');
eq(matchOrganization('Maelstrom', corps, { [orgKey('Maelstrom')]: '' }).state, 'notCorp', 'not a corporation is remembered');
eq(orgKey('Militech Security'), orgKey('militech'), 'filler words do not split a decision');
eq(specialKey('tr au-ma'), 'TRAUMA', 'special key');

console.log(fail ? `\n${pass} passed, ${fail} FAILED` : `\nALL ${pass} PASS`);
process.exit(fail ? 1 : 0);
