// test-cpr-adapter — the Cyberpunk RED system's data shapes are read in ONE place, scripts/utils/cpr.js
// (stage 2, step 10b). When the system changes a shape (its own Foundry v13 release is the likely moment), the fix
// belongs there. This sim drives the real readers against CPR-like and foreign data, and checks that no other file
// reads the moved shapes directly; what is not moved yet has a count that may only go DOWN.
// Run: node dev/tools/sims/test-cpr-adapter.mjs   (NCM_ROOT=<dir> to check another checkout)
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';

const ROOT = path.resolve(process.env.NCM_ROOT || fileURLToPath(new URL('../../../', import.meta.url)));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
const lib = path.join(ROOT, 'scripts/utils/cpr.js');
ok(existsSync(lib), 'scripts/utils/cpr.js exists');
if (!existsSync(lib)) { console.log(`test-cpr-adapter: ${pass} passed, ${fail} failed`); process.exit(1); }
const C = await import(pathToFileURL(lib).href);

// ═══ 1. the readers ═══
const role = { type: 'role', name: 'Netrunner', system: { rank: 4 } }, gear = { type: 'gear', name: 'Agent' };
const collection = (arr) => ({ contents: arr, filter: (f) => arr.filter(f), find: (f) => arr.find(f), [Symbol.iterator]: () => arr[Symbol.iterator]() });
const v = { name: 'V', type: 'character', items: collection([gear, role]), system: { stats: { luck: { value: 3, max: 6 } }, wealth: { value: 500, transactions: [['Increased by 5 to 500', 'x']] } } };
ok(C.roleItems(v).length === 1 && C.firstRole(v) === role && C.roleName(v) === 'Netrunner' && C.roleRank(role) === 4, 'roles from a Foundry-like collection');
ok(C.firstRole({ items: { find: (f) => [gear, role].find(f) } }) === role, 'a find-only items object (some sims) still gives the role');
ok(C.roleItems({ items: [role, gear] }).length === 1 && C.roleItems({ items: new Set([role]) }).length === 1, 'an array or any iterable works');
ok(C.roleItems({}).length === 0 && C.firstRole(null) === null && C.roleName({}) === '', 'no items → nothing, no throw');
ok(C.roleRank({ system: { value: 2 } }) === 2 && C.roleRank({ system: {} }) === 0 && C.roleRank(null) === 0, 'roleRank: rank, else the older value, else 0');
ok(C.luckOf(v).value === 3 && C.luckOf(v).max === 6 && C.luckOf({ system: { stats: { luck: { value: 4 } } } }).max === 4 && C.luckOf({}).value === 0, 'luck {value, max}; max falls back to value');
ok(C.wealthBalance(v) === 500 && C.wealthLedger(v).length === 1 && C.hasWealth(v), 'money: balance, ledger, has a wealth block');
ok(C.wealthBalance({}) === 0 && C.wealthLedger({ system: { wealth: { transactions: 'x' } } }).length === 0 && !C.hasWealth({ system: {} }), 'money on a foreign / empty actor: 0, [], false');
ok(C.marketPrice({ system: { price: { market: 75 } } }) === 75 && C.marketPrice({}, 100) === 100 && C.marketPrice(null) === 0, 'market price with a fallback');
const ice = { type: 'blackIce', system: { stats: { atk: 4 }, class: 'Anti-Personnel' } };
ok(C.iceAttack(ice) === 4 && C.iceAttack({}) === 0 && C.iceAttackOrNull({}) === null && C.iceAttackOrNull({ system: { stats: { atk: 0 } } }) === 0, 'ICE attack: 0 vs null kept apart');
ok(C.iceClass(ice) === 'Anti-Personnel' && C.iceClass({}) === undefined, 'ICE class');

// Black ICE: one rule
const flagged = { type: 'character', name: 'Gatekeeper', getFlag: (s, k) => s === 'night-city-messenger' && k === 'isBlackICE' };
const cases = [[{ type: 'blackIce', name: 'Hellhound' }, true], [{ type: 'black-ice', name: 'Asp' }, true], [flagged, true], [{ type: 'npc', name: 'Black ICE — Kraken' }, true],
  [{ type: 'npc', name: 'BlackICE Prime' }, true], [{ type: 'npc', name: 'blackice' }, true], [{ type: 'npc', name: 'Roadblock' }, false], [{ type: 'character', name: 'V' }, false], [null, false]];
ok(cases.every(([a, want]) => C.isBlackIceActor(a) === want), `isBlackIceActor: type, flag, or a name saying Black ICE (${cases.filter(([a, w]) => C.isBlackIceActor(a) !== w).map(([a]) => a?.name).join(', ') || 'all right'})`);
globalThis.game = { actors: { filter: (f) => [{ type: 'blackIce', name: 'A' }, { type: 'character', name: 'B' }].filter(f) }, documentTypes: { Item: ['base', 'gear', 'weapon'] } };
ok(C.blackIceActors().length === 1 && C.itemTypes().join() === 'gear,weapon', 'blackIceActors / itemTypes (base dropped)');
globalThis.game = { system: { documentTypes: { Item: ['gear'] } } };
ok(C.itemTypes().join() === 'gear', 'itemTypes falls back to the system\'s list');
globalThis.game = {};
ok(C.itemTypes().length === 0 && C.blackIceActors().length === 0, 'no game → empty lists');
ok(C.NON_PERSON_ACTOR_TYPES.has('demon') && C.NON_CARRIER_ITEM_TYPES.has('role') && C.CPR_SYSTEM_ID === 'cyberpunk-red-core', 'the type lists and the system id');

// ═══ 2. nobody else reads the moved shapes ═══
const walk = (d, out = []) => { for (const f of readdirSync(d)) { const p = path.join(d, f); if (statSync(p).isDirectory()) walk(p, out); else if (p.endsWith('.js')) out.push(p); } return out; };
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
// comments are blanked (not removed) so reported line numbers stay right
const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
const src = walk(path.join(ROOT, 'scripts')).map((f) => [rel(f), code(readFileSync(f, 'utf8'))]);
const OWNERS = new Set(['scripts/utils/cpr.js']);
const BANNED = [
  [/type\s*===\s*'(?:blackIce|black-ice)'/g, "an actor-type test for Black ICE — use isBlackIceActor"],
  [/new Set\(\[\s*'blackIce'/g, 'a copy of the non-person actor types — use NON_PERSON_ACTOR_TYPES'],
  [/system\??\.wealth\b/g, 'system.wealth — use wealthBalance / wealthLedger / hasWealth (writing: utils/wealth.js)', ['scripts/utils/wealth.js']],
  [/documentTypes\??\.Item/g, "the system's item types — use itemTypes()"],
  [/stats\??\.atk\b/g, 'an ICE ATK read — use iceAttack / iceAttackOrNull'],
  [/system\??\.price\b/g, 'an item price read — use marketPrice'],
  [/system\??\.class\b/g, 'an ICE class read — use iceClass'],
  [/\.find\??\.?\(\(?i\)?\s*=>\s*i\.type === 'role'\)/g, 'a role-item lookup — use firstRole / roleItems'],
];
const hits = [];
for (const [f, t] of src) {
  if (OWNERS.has(f)) continue;
  for (const [re, why, extraOwners = []] of BANNED) { if (extraOwners.includes(f)) continue; for (const m of t.matchAll(re)) hits.push(`${f}:${t.slice(0, m.index).split('\n').length} — ${why}`); }
}
ok(hits.length === 0, `no file outside utils/cpr.js reads the moved shapes:\n  ${hits.join('\n  ')}`);

// 3. not moved yet — counts may only go down (lower them here when you move some)
const RATCHET = [
  ['actor.system.stats reads (SkillService owns skill math; the rest are display)', /\.system\??\.stats\b/g, 7],
  ["type === 'skill' (SkillService owns skills)", /type === 'skill'/g, 5],
  ["role lookups by name in lists (namePicker, phoneEmergency)", /type === 'role'/g, 2],
];
for (const [label, re, max] of RATCHET) {
  const n = src.filter(([f]) => !OWNERS.has(f)).reduce((s, [, t]) => s + (t.match(re) || []).length, 0);
  ok(n <= max, `${label}: ${n} (may only go down from ${max})`);
  if (n < max) console.log(`  note: ${label} is down to ${n} — lower its number in test-cpr-adapter.mjs`);
}

console.log(`test-cpr-adapter: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
