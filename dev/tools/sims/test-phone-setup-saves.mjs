// test-phone-setup-saves — every save on the GM's phone setup screens reaches its world setting (2.2.1 hotfix).
// The Line types and Corporations screens saved through CallService.saveNumberSetting, whose accepted list left out
// phoneLineTypes and phoneOffices: every colour, dial, checkbox, greeting and extension was refused and the screen
// redrew the old value with no message (tester CptWashu, 2026-11-06). This drives the REAL method on the shared mock
// world with NCM's real settings, and checks every key the setup view passes is accepted.
// Run: node dev/tools/sims/test-phone-setup-saves.mjs
import fs from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'url';
import { createMockWorld } from './lib/world.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
const read = (p) => fs.readFileSync(`${ROOT}/${p}`, 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
const M = 'night-city-messenger';
const quietInfo = console.info; console.info = () => {};

const world = await createMockWorld({ users: [{ id: 'gm1', name: 'GM', isGM: true }, { id: 'p1', name: 'Rache' }], realSettings: true });
const { CallService, NUMBER_SETTINGS } = await imp('scripts/services/CallService.js');
const PN = await imp('scripts/utils/phoneNumbering.js');
const emitted = [];
const svc = { eventBus: { emit: (e, d) => emitted.push(e) } };
const save = (k, v) => CallService.prototype.saveNumberSetting.call(svc, k, v);

// ═══ 1. every key the setup view saves is accepted and registered ═══
const view = read('scripts/ui/AdminPanel/tabs/phoneNumbersView.js');
const used = [...new Set([...view.matchAll(/saveSetting\('([A-Za-z]+)'/g)].map((m) => m[1]))];
ok(used.length >= 6, `found the setup screens' saves (${used.length})`);
for (const k of used) {
  ok(NUMBER_SETTINGS.includes(k), `${k} is accepted by saveNumberSetting`);
  ok(world.settings?.has ? world.settings.has(`${M}.${k}`) : (() => { try { game.settings.get(M, k); return true; } catch { return false; } })(), `${k} is a registered setting`);
}
ok((view.match(/SVC\.saveNumberSetting\(/g) || []).length === 1, 'the view saves only through saveSetting (a refused save warns)');
ok(/const refuse = [^\n]*!r\.told/.test(view) && /saveSetting = [^\n]*told: true/.test(view), 'a refusal warns once, not again in undoable');

// ═══ 2. line types: a colour, a dial, a checkbox and a new type stick ═══
let types = PN.lineTypes(game.settings.get(M, 'phoneLineTypes'));
const corp = types.find((t) => t.id === 'corp');
corp.color = 'var(--ncm-good)'; corp.ring = 'fast'; corp.burn = true;
types.push(PN.sanitizeLineType({ id: 'tnew', name: 'Fixer line', word: 'Fixer' }));
const r1 = await save('phoneLineTypes', PN.lineTypesDiff(types.map(PN.sanitizeLineType)));
ok(r1.ok === true, 'line types save');
types = PN.lineTypes(game.settings.get(M, 'phoneLineTypes'));
const back = types.find((t) => t.id === 'corp');
ok(back.color === 'var(--ncm-good)' && back.ring === 'fast' && back.burn === true, 'a line type\'s colour, dial and checkbox read back');
ok(types.some((t) => t.id === 'tnew' && t.name === 'Fixer line'), 'a new line type reads back');
ok(emitted.length >= 1, 'a save tells the screens to redraw');

// ═══ 3. corporations: who answers, greeting, art and an extension stick ═══
const key = 'NC:ARA';
const office = PN.sanitizeOffice({ answers: 'recording', greet: 'Arasaka. How may we direct your call?', art: 'worlds/x/ara.webp', exts: [{ x: '17', who: 'Security desk', listed: true }] });
const r2 = await save('phoneOffices', { [key]: office });
ok(r2.ok === true, 'corporation offices save');
const o = PN.sanitizeOffice(game.settings.get(M, 'phoneOffices')[key]);
ok(o.answers === 'recording' && /Arasaka/.test(o.greet) && o.art === 'worlds/x/ara.webp', 'who answers, greeting and art read back');
ok(o.exts.length === 1 && o.exts[0].x === '17' && o.exts[0].who === 'Security desk', 'an added extension reads back');

// ═══ 4. still refused: a non-number setting, and a player ═══
ok((await save('debugMode', true)).ok === false, 'a setting that is not a number setting is refused');
await world.as('p1', async () => ok((await save('phoneLineTypes', {})).ok === false, 'a player is refused'));

console.info = quietInfo;
console.log(`test-phone-setup-saves: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
