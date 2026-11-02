// The one roll rule, the one odds function, the roll panel, and the Interface DV upgrade.
// Tester 2026-11-01: "a skill check that equaled the DV showed as passed by 0 — you need to exceed the DV".
// Run: node dev/tools/sims/test-rolls.mjs
import fs from 'fs';
import path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
let pass = 0, fail = 0;
const ok = (c, n) => { c ? pass++ : (fail++, console.error('FAIL:', n)); };
const read = (p) => fs.readFileSync(`${ROOT}/${p}`, 'utf8');
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);

const R = await imp('scripts/utils/rolls.js');

// ═══ 1. the rule ═══
ok(!R.beatsDV(12, 12), 'a tie fails');
ok(R.beatsDV(13, 12) && !R.beatsDV(11, 12), 'over passes, under fails');

// ═══ 2. the odds are the real die's ═══
// brute force the module's die to compare
function brute(t) {
  let p = 0;
  for (let f = 2; f <= 9; f++) if (f >= t) p += 0.1;
  for (let d = 1; d <= 10; d++) if (1 - d >= t) p += 0.01;
  const run = (sum, w, depth) => { let q = 0; for (let d = 1; d <= 10; d++) { const s = sum + d; if (d === 10 && depth < 8) q += run(s, w / 10, depth + 1); else if (s >= t) q += w / 10; } return q; };
  return p + run(10, 0.1, 0);
}
for (const t of [-12, -9, -3, 0, 1, 2, 5, 9, 10, 11, 12, 15, 20, 21, 25]) {
  ok(Math.abs(R.dieAtLeast(t) - brute(t)) < 1e-6, `dieAtLeast(${t}) matches the die`);
}
ok(R.d10Odds(11, 15).pct === 60 && R.d10Odds(11, 15).need === 5, 'TECH 7 + rank 4 vs 15: needs 5+ on the die');
ok(R.d10Odds(4, 15).pct === 9, 'rank 4 alone vs 15: a long shot, but a 10 can still do it');
ok(R.d10Odds(4, 9).pct === 50, 'rank 4 vs the new DV 9: an even chance');
ok(R.d10Odds(40, 15).pct === 100, 'only certain when a fumble cannot lose it');
ok(R.d10Odds(25, 15).pct === 99 || R.d10Odds(25, 15).pct === 100, 'near-certain reads 99 or 100');
ok(R.d10Odds(16, 15).pct < 100 && R.d10Odds(16, 15).pct > 90, 'a fumble can lose a roll already over the DV');
ok(R.d10Odds(0, 500).pct === 0, 'truly impossible says 0');
ok(R.d10Odds(0, 40).pct === 1, 'merely unlikely never rounds to 0');

// ═══ 3. the formula ═══
ok(R.formulaText(R.rollParts({ statName: 'tech', statValue: 7, skillName: 'Interface', skillLevel: 5 })) === 'TECH 7 + Interface 5 + d10', 'stat + rank formula');
ok(R.formulaText(R.rollParts({ statName: 'none', statValue: 0, skillName: 'Interface', skillLevel: 5 })) === 'Interface 5 + d10', 'rank-only has no stat part');

// ═══ 4. nothing compares a roll to a DV by hand ═══
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []));
const bad = [];
for (const f of walk(`${ROOT}/scripts`)) {
  if (f.endsWith('rolls.js') || /[\\/]tests[\\/]/.test(f)) continue;
  const src = fs.readFileSync(f, 'utf8');
  if (/\b(total|rollTotal)\s*>=\s*(dc|dv|DV)\b/.test(src) || /margin\s*>=\s*0\b(?!\s*\?)/.test(src)) bad.push(path.basename(f));
}
ok(bad.length === 0, `no hand-written tie-passes compare (${bad.join(', ')})`);
ok(read('scripts/services/SkillService.js').includes('beatsDV(total, dc)'), 'SkillService decides with beatsDV');

// ═══ 5. the ladders: a tie is sloppy, not clean ═══
for (const [p, name] of [['scripts/ui/content/EncoderModel.js', 'encodeOutcome']]) {
  const M = await imp(p);
  ok(M[name](15, 15) === 'sloppy' && M[name](16, 15) === 'clean' && M[name](11, 15) === 'sloppy' && M[name](10, 15) === 'rejected', `${name}: tie sloppy, over clean, band kept`);
}
const up = read('scripts/ui/content/UploadFlow.js');
ok(/if \(margin > 0\) return 'clean'/.test(up), 'forgeOutcome: a tie is not clean');
ok(up.includes('res.total ?? dv + 1'), 'an unrolled force still reads as clean');
ok(read('scripts/ui/NetworkNodes/NodeConsoleApp.js').includes('res.total ?? dv + 1'), 'the node insert too');
const N = await imp('scripts/utils/networkNodes.js');
ok(N.sweepFinds({ infections: [{ actorId: 'x', stealthDV: 10 }] }, 10, { actorId: 'me' }).length === 0 && N.sweepFinds({ infections: [{ actorId: 'x', stealthDV: 10 }] }, 11, { actorId: 'me' }).length === 1, 'a sweep has to beat the stealth DV');

// ═══ 6. rolls that ask ═══
const askers = {
  'scripts/ui/NetworkNodes/NodeConsoleApp.js': 2, 'scripts/ui/Terminal/TerminalViewerApp.js': 3, 'scripts/ui/NetworkManagement/NetworkAuthDialog.js': 2,
  'scripts/ui/content/BankHeist.js': 1, 'scripts/ui/content/SystemSweep.js': 1, 'scripts/services/MessageAccessService.js': 1, 'scripts/services/CallService.js': 1, 'scripts/ui/ShardEncoder/ShardEncoderApp.js': 1,
};
for (const [f, n] of Object.entries(askers)) {
  const s = read(f);
  ok((s.match(/\bask: \{/g) || []).length >= n, `${path.basename(f)}: ${n} roll(s) ask`);
  ok(/\.cancelled/.test(s), `${path.basename(f)}: backing out is not a failure`);
}
const sc = read('scripts/ui/content/SecurityConsole.js');
ok(sc.includes('rollControlsHtml(panelData)') && sc.includes('luckSpend: spend.luck') && sc.includes('modifier: spend.modifier'), 'the action console carries Luck + modifier into the roll');
ok(sc.includes("gateMode !== 'gm'"), 'no panel when the GM decides (nothing is rolled)');
ok(read('styles/night-city-messenger.css').includes("components/roll-panel.css"), 'stylesheet imported');

// the panel's view-model and the hidden-DV rule, with stubs for the DOM-free parts
globalThis.game = { settings: { get: () => true }, nightcity: { skillService: { getSkillData: () => ({ statName: 'none', statValue: 0, skillLevel: 5 }), getAvailableLuck: () => 3 } } };
const P = await imp('scripts/ui/content/RollPanel.js');
const data = P.rollPanelData({ name: 'V' }, 'Interface', 9);
const v0 = P.rollPanelView(data), v2 = P.rollPanelView(data, 2, 1);
ok(v0.base === 5 && v0.pct === R.d10Odds(5, 9).pct, 'panel: rank + nothing');
ok(v2.base === 8 && v2.pct > v0.pct && v2.parts.some((p) => p.label === 'Luck' && p.value === 2) && v2.parts.some((p) => p.label === 'Modifier' && p.value === 1), 'panel: Luck and a modifier move the chance');
ok(!v0.parts.some((p) => p.label === 'NONE'), 'panel: no stat part in rank mode');
const hidden = P.rollControlsHtml(P.rollPanelData({ name: 'V' }, 'Interface', 17, { hideDV: true }));
ok(!/DV 17/.test(hidden) && !/\d+%/.test(hidden), 'a hidden DV stays out of the DOM, chance included');
ok(/DV 9/.test(P.rollControlsHtml(data)), 'a visible DV shows');

// ═══ 7. the upgrade ═══
const U = await imp('scripts/utils/interfaceDvShift.js');
const acct = { security: { requiresAuth: true, bypassSkills: ['Interface'], bypassDC: 15, bypassSkillDCs: {} } };
ok(U.shiftInterfaceDvs(acct, 6) === 1 && acct.security.bypassDC === 9, 'an Interface-only lock moves');
const shared = { bypassSkills: ['Interface', 'Cryptography'], bypassDC: 15 };
U.shiftInterfaceDvs(shared, 6);
ok(shared.bypassDC === 15 && shared.bypassSkillDCs.Interface === 9, 'a shared lock keeps its DV; Interface gets its own');
const other = { bypassSkills: ['Cryptography'], bypassDC: 15 };
ok(U.shiftInterfaceDvs(other, 6) === 0 && other.bypassDC === 15, 'another skill is left alone');
const shard = { allowedSkills: ['Interface'], encryptionDC: 20, skillDCs: {} };
U.shiftInterfaceDvs(shard, 6);
ok(shard.encryptionDC === 14, 'a shard opened by Interface alone moves');
const shard2 = { allowedSkills: ['Interface', 'Forgery'], encryptionDC: 20, skillDCs: { Forgery: 22 } };
U.shiftInterfaceDvs(shard2, 6);
ok(shard2.encryptionDC === 20 && shard2.skillDCs.Interface === 14 && shard2.skillDCs.Forgery === 22, 'a shared shard: Interface gets its own DV');
const cd = { uploadSkill: 'Interface', uploadDV: 15, deployDV: 12, crackSkill: 'Forgery', crackDV: 15, entries: [{ crackDV: 18 }], images: [{ unlockDV: 14 }], camSkill: 'Electronics/Security Tech', loopDV: 15 };
U.shiftInterfaceDvs(cd, 6);
ok(cd.uploadDV === 9 && cd.deployDV === 6 && cd.crackDV === 15 && cd.entries[0].crackDV === 12 && cd.images[0].unlockDV === 8 && cd.loopDV === 15, 'entry fields: a blank skill means Interface, a named other skill stays, nested rows move');
const ex = { exfil: { agent: { skill: 'Interface', dv: 15 }, sell: { skill: 'Trading', dv: 15 } } };
U.shiftInterfaceDvs(ex, 6);
ok(ex.exfil.agent.dv === 9 && ex.exfil.sell.dv === 15, 'exfil rows by their own skill');
const low = { uploadDV: 4 }; U.shiftInterfaceDvs(low, 6);
ok(low.uploadDV === 3, 'never below the floor');
const lower = { uploadDV: 2 }; U.shiftInterfaceDvs(lower, 6);
ok(lower.uploadDV === 2, 'a DV already under the floor stays');
const jack = { dv: 15, actions: { tap: { dv: 17 }, switch: { dv: null } } };
ok(U.shiftJackRules(jack, 6) === 2 && jack.dv === 9 && jack.actions.tap.dv === 11 && jack.actions.switch.dv === null, 'saved Jacking in rules move; no-roll actions stay');
ok(U.shiftJackRules({ skill: 'Forgery', dv: 15 }, 6) === 0, 'rules on another skill stay');
const dials = { dials: { edge: true, movesMargin: 5, movesTable: [{ rank: 1, moves: 2 }, { rank: 3, moves: 3 }, { rank: 6, moves: 4 }, { rank: 9, moves: 5 }] } };
ok(U.refreshJackDials(dials) && dials.dials.edge === false && dials.dials.movesMargin === 0 && dials.dials.movesTable[1].rank === 4, 'old default dials move to the new ones');
const mine = { dials: { edge: false, movesMargin: 3, movesTable: [{ rank: 1, moves: 9 }] } };
ok(!U.refreshJackDials(mine) && mine.dials.movesTable[0].moves === 9, 'a table the GM chose stays');
const mr = read('scripts/core/MigrationRunner.js');
ok(/DATA_SCHEMA_VERSION = [3-9];/.test(mr) && mr.includes('to: 3,') && mr.includes("mode === 'stat'") && mr.includes('ifaceShiftDone'), 'migration v3: respects a saved stat choice, remembers what moved');
ok(mr.includes("throw new Error('The GM has not answered yet"), 'dismissing the question asks again next load');
const sm = read('scripts/core/SettingsManager.js');
ok(/'roleAbilityRoll'[\s\S]{0,700}default: 'rank'/.test(sm), 'rank + d10 is the default');
ok(/'askBeforeRoll'[\s\S]{0,400}scope: 'client'/.test(sm) && /'ifaceShiftDone'/.test(sm), 'settings registered');

// the preset scale: every shipped Interface DV has room on rank + d10
const C = read('scripts/utils/constants.js');
const dvs = [...C.matchAll(/bypassSkills: \['Interface'\], bypassDC: (\d+)/g)].map((m) => Number(m[1]));
ok(dvs.length > 5 && dvs.every((d) => d <= 16), `preset Interface DVs on the NET scale (${dvs.join(',')})`);

console.log(`test-rolls: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
