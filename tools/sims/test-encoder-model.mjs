/**
 * Shard Encoder — model + legibility sim.
 * Run: node tools/sims/test-encoder-model.mjs
 *
 * Drives the REAL EncoderModel.js and utils/legibility.js (both pure / global-free),
 * plus the pieces of the app that can be exercised without Foundry. It asserts the
 * rules the GM card and the Encoder window both read, so the two can never disagree:
 * the config layering, blank tiers and botch rules, the three-rung ladder (and that
 * it matches UploadFlow's band), the program gating and efficiency, and that the
 * accessibility prefs clamp and can only ever LOWER motion.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); pass++; console.log(`  ok   ${name}`); }
  catch (err) { fail++; console.log(`  FAIL ${name}\n       ${err.message}`); }
};
const section = (t) => console.log(`\n── ${t} ──`);

const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const M = await imp('scripts/ui/content/EncoderModel.js');

// ═══════════════════════════════════════════════════════════════════════════
section('config resolution');

check('defaults resolve unchanged from an empty store', () => {
  const c = M.resolveEncoderConfig({});
  assert.equal(c.enabled, false, 'player authoring must be opt-in');
  assert.equal(c.pricing, 'propose');
  assert.equal(c.tiers.length, 3);
  assert.equal(c.types.document.skill, 'Forgery');
});

check('a stored override layers over the defaults, deep', () => {
  const c = M.resolveEncoderConfig({ enabled: true, types: { document: { dv: 20 } } });
  assert.equal(c.enabled, true);
  assert.equal(c.types.document.dv, 20);
  assert.equal(c.types.document.skill, 'Forgery', 'untouched keys survive');
  assert.equal(c.types.banking.dv, 18, 'untouched types survive');
});

check('a new default reaches a world that stored the old shape', () => {
  // Simulates an existing world: it stored tiers + a couple of types and nothing else.
  const old = { enabled: true, tiers: [{ id: 'standard', name: 'Standard', price: 50, buyable: true, fallback: true }] };
  const c = M.resolveEncoderConfig(old);
  assert.ok(c.programs.abilities.keylog, 'program defaults appear without a migration');
  // `optional.gear` became an object in 2026-09-22 when the placeholder toggles
  // grew real rules; a world that stored nothing still resolves to "off".
  assert.equal(c.optional.gear.on, false);
  assert.equal(c.optional.gear.stack, 'best');
});

check('arrays REPLACE (a GM who deletes a tier keeps it deleted)', () => {
  const c = M.resolveEncoderConfig({ tiers: [{ id: 'only', name: 'Only', fallback: true }] });
  assert.equal(c.tiers.length, 1);
});

check('exactly one fallback tier, always', () => {
  const none = M.resolveEncoderConfig({ tiers: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] });
  assert.equal(none.tiers.filter((t) => t.fallback).length, 1, 'none marked → the first becomes it');
  const many = M.resolveEncoderConfig({ tiers: [{ id: 'a', name: 'A', fallback: true }, { id: 'b', name: 'B', fallback: true }] });
  assert.equal(many.tiers.filter((t) => t.fallback).length, 1, 'two marked → only the first keeps it');
});

check('garbage is sanitised, not trusted', () => {
  const c = M.resolveEncoderConfig({
    pricing: 'nonsense',
    tiers: [{ id: 'x', name: 'X', price: -50, onRejected: 'vaporised', perk: 'wings', items: [{ img: 'a.png' }, { name: 'Real chip' }] }],
  });
  assert.equal(c.pricing, 'propose', 'an unknown pricing mode falls back');
  assert.equal(c.tiers[0].price, 0, 'a negative price is clamped');
  assert.equal(c.tiers[0].onRejected, 'bricked', 'an unknown botch rule falls back');
  assert.equal(c.tiers[0].perk, '', 'an unknown perk falls back');
  assert.equal(c.tiers[0].items.length, 1, 'a nameless item entry is dropped');
});

// ═══════════════════════════════════════════════════════════════════════════
section('blank tiers');

const cfg = M.resolveEncoderConfig({
  enabled: true,
  tiers: [
    { id: 'scrap', name: 'Scrap', price: 0, fallback: true, onRejected: 'bricked', onNat1: 'bricked-trace', perk: '', items: [] },
    { id: 'standard', name: 'Standard', price: 50, buyable: true, onRejected: 'bricked', onNat1: 'bricked-trace', items: [{ name: 'Blank Data Shard' }] },
    { id: 'premium', name: 'Premium', price: 200, buyable: true, onRejected: 'survives', onNat1: 'bricked', perk: 'craft+1', items: [{ name: 'Militech Hardened Shard' }] },
  ],
});

check('an item matches its tier by name', () => {
  assert.equal(M.tierForItem(cfg, { name: 'Blank Data Shard' }).id, 'standard');
  assert.equal(M.tierForItem(cfg, { name: 'Militech Hardened Shard' }).id, 'premium');
});

check('name matching ignores spacing and punctuation', () => {
  assert.equal(M.tierForItem(cfg, { name: 'blank  data-shard' }).id, 'standard');
  assert.equal(M.tierForItem(cfg, { name: 'MILITECH HARDENED SHARD' }).id, 'premium');
});

check('anything unlisted falls to the fallback tier', () => {
  assert.equal(M.tierForItem(cfg, { name: 'Half-eaten burrito' }).id, 'scrap');
  assert.equal(M.tierForItem(cfg, null).id, 'scrap', 'no item at all still resolves');
});

check('an explicit stamped tier beats the name list', () => {
  assert.equal(M.tierForItem(cfg, { name: 'Half-eaten burrito', tierId: 'premium' }).id, 'premium');
});

check('a stamped tier that no longer exists falls back', () => {
  assert.equal(M.tierForItem(cfg, { name: 'Whatever', tierId: 'deleted-tier' }).id, 'scrap');
});

check('botch rules read per tier, and a natural 1 is one step harsher', () => {
  const std = cfg.tiers.find((t) => t.id === 'standard');
  const prem = cfg.tiers.find((t) => t.id === 'premium');
  assert.equal(M.botchFor(std).bricks, true);
  assert.equal(M.botchFor(std, { nat1: true }).trace, true, 'standard + nat 1 also traces');
  assert.equal(M.botchFor(prem).bricks, false, 'premium survives a plain rejection');
  assert.equal(M.botchFor(prem, { nat1: true }).bricks, true, 'premium still bricks on a nat 1');
});

check('the premium perk is a real craft bonus', () => {
  assert.equal(M.TIER_PERKS[cfg.tiers[2].perk].craft, 1);
  assert.equal(M.TIER_PERKS[''].craft, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
section('the ladder');

check('the band matches UploadFlow — ONE ladder for the module', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/ui/content/UploadFlow.js'), 'utf8');
  const m = src.match(/FORGE_SLOPPY_BAND\s*=\s*(\d+)/);
  assert.ok(m, 'FORGE_SLOPPY_BAND not found in UploadFlow.js');
  assert.equal(Number(m[1]), M.SLOPPY_BAND, `UploadFlow says ${m[1]}, EncoderModel says ${M.SLOPPY_BAND}`);
});

check('rungs fall where the design says', () => {
  assert.equal(M.encodeOutcome(18, 18), 'clean', 'meeting the DV is clean');
  assert.equal(M.encodeOutcome(25, 18), 'clean');
  assert.equal(M.encodeOutcome(17, 18), 'sloppy', 'missing by 1 still lands');
  assert.equal(M.encodeOutcome(14, 18), 'sloppy', 'missing by the band still lands');
  assert.equal(M.encodeOutcome(13, 18), 'rejected', 'one past the band writes nothing');
});

check('odds are a real d10 distribution and always total 100', () => {
  for (const [base, dv] of [[12, 18], [3, 25], [30, 10], [14, 15]]) {
    const o = M.ladderOdds(base, dv);
    assert.equal(o.clean + o.sloppy + o.rejected, 100, `base ${base} vs ${dv}`);
    assert.ok([o.clean, o.sloppy, o.rejected].every((n) => n % 10 === 0), 'whole d10 faces');
  }
});

check('a specific spread is exactly right', () => {
  // base 12 vs DV 18: needs 6+ to be clean (5 faces), 2-5 sloppy (4), 1 rejected (1)
  const o = M.ladderOdds(12, 18);
  assert.deepEqual([o.clean, o.sloppy, o.rejected], [50, 40, 10]);
});

check('an impossible DV is honestly 100% rejected', () => {
  const o = M.ladderOdds(2, 30);
  assert.equal(o.rejected, 100);
  assert.equal(M.likelyRung(o)[0], 'rejected');
});

check('a trivial DV is honestly 100% clean', () => {
  const o = M.ladderOdds(20, 8);
  assert.equal(o.clean, 100);
  assert.equal(M.likelyRung(o)[0], 'clean');
});

check('likelyRung breaks ties toward the better rung', () => {
  assert.equal(M.likelyRung({ clean: 50, sloppy: 50, rejected: 0 })[0], 'clean');
  assert.equal(M.likelyRung({ clean: 0, sloppy: 50, rejected: 50 })[0], 'sloppy');
});

check('the odds word never relies on colour alone', () => {
  assert.equal(M.oddsClass(80), 'hi');
  assert.equal(M.oddsClass(60), 'hi');
  assert.equal(M.oddsClass(30), 'mid');
  assert.equal(M.oddsClass(20), 'lo');
});

// ═══════════════════════════════════════════════════════════════════════════
section('the program branch');

check('rank gates abilities, and the gate is the GM\'s number', () => {
  const low = M.programAbilities(cfg, 'execute', 0);
  assert.ok(low.every((a) => a.locked), 'rank 0 unlocks no execute verb by default');
  const high = M.programAbilities(cfg, 'execute', 7);
  assert.ok(high.every((a) => !a.locked), 'rank 7 unlocks them all');
  const mid = M.programAbilities(cfg, 'execute', 4);
  assert.equal(mid.find((a) => a.key === 'keylog').locked, false);
  assert.equal(mid.find((a) => a.key === 'forgeAccount').locked, true);
});

check('a family the GM switched off offers nothing', () => {
  const off = M.resolveEncoderConfig({ programs: { families: { execute: false } } });
  assert.equal(M.programAbilities(off, 'execute', 9).length, 0);
  assert.ok(M.programAbilities(off, 'utility', 9).length > 0);
});

check('only verbs with a working applier are offered', () => {
  const offered = new Set(Object.values(M.FAMILY_ABILITIES).flat());
  for (const dead of ['wipe', 'corrupt', 'logicBomb', 'plant', 'adjudicate']) {
    assert.ok(!offered.has(dead), `${dead} must not be offered — it has no authoring path here`);
  }
});

check('craft choices: the right tool is free, another trade costs DV', () => {
  const cs = M.craftChoices(cfg, 'keylog');
  assert.equal(cs[0].penalty, 0);
  assert.equal(cs[0].recommended, true);
  const est = cs.find((c) => c.skill === 'Electronics/Security Tech');
  assert.ok(est.penalty > 0);
  assert.equal(est.applies, true);
});

check('an alt skill limited to some verbs says so', () => {
  const crypto = (v) => M.craftChoices(cfg, v).find((c) => c.skill === 'Cryptography');
  assert.equal(crypto('keylog').applies, true);
  assert.equal(crypto('deployICE').applies, false, 'Cryptography is not for deploying ICE');
});

check('the DV adds up: ability + craft penalty + trojan cover', () => {
  const plain = M.programDV(cfg, { ability: 'keylog', craft: 'Interface' });
  assert.equal(plain, 15);
  assert.equal(M.programDV(cfg, { ability: 'keylog', craft: 'Electronics/Security Tech' }), 18);
  assert.equal(M.programDV(cfg, { ability: 'keylog', craft: 'Interface', disguised: true }), 17);
  assert.equal(M.programDV(cfg, { ability: 'keylog', craft: 'Cryptography', disguised: true }), 22);
});

check('charges come from rank', () => {
  assert.equal(M.chargesForRank(cfg, 0), 1);
  assert.equal(M.chargesForRank(cfg, 3), 2);
  assert.equal(M.chargesForRank(cfg, 9), 4);
});

check('a clean build pays out, a sloppy one is punished, a rejected one is nothing', () => {
  const clean = M.programEfficiency(cfg, { total: 22, dv: 18, rank: 6 });
  assert.equal(clean.rung, 'clean');
  assert.equal(clean.charges, 3);
  assert.equal(clean.stealthDV, 16, '12 + margin 4');
  assert.equal(clean.runDV, 16, 'DV - 2');
  assert.ok(clean.quality > 50);

  const sloppy = M.programEfficiency(cfg, { total: 16, dv: 18, rank: 6 });
  assert.equal(sloppy.rung, 'sloppy');
  assert.equal(sloppy.charges, 1, 'one charge regardless of rank');
  assert.equal(sloppy.stealthDV, 8, 'a sweep finds it easily');
  assert.equal(sloppy.runDV, 20, 'and it runs worse');
  assert.equal(sloppy.tell, 'GLITCHY');

  const rejected = M.programEfficiency(cfg, { total: 10, dv: 18, rank: 6 });
  assert.equal(rejected.charges, 0);
  assert.equal(rejected.quality, 0);
});

check('stealth DV is capped so a huge margin cannot make it unfindable', () => {
  const huge = M.programEfficiency(cfg, { total: 60, dv: 18, rank: 9 });
  assert.equal(huge.stealthDV, 20);
});

check('quality maps to the same 50-at-the-DV scale UploadFlow uses', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/ui/content/UploadFlow.js'), 'utf8');
  assert.ok(/50 \+ margin \* 8/.test(src), 'UploadFlow no longer uses 50 + margin*8 — re-check the Encoder');
  assert.equal(M.programEfficiency(cfg, { total: 18, dv: 18, rank: 0 }).quality, 50);
});

check('the forecast is the best case, and never lies about charges', () => {
  const f = M.programForecast(cfg, { base: 12, dv: 18, rank: 6 });
  assert.equal(f.charges, M.chargesForRank(cfg, 6));
  assert.equal(f.stealthLo, 12);
  assert.equal(f.stealthHi, 16, 'base 12 + a natural 10 = margin 4');
  assert.equal(f.runDV, 16);
});

check('suggested price scales with the work and drops for a bad build', () => {
  const p = M.suggestedPrice({ blankPrice: 50, dv: 18 });
  assert.equal(p.clean, 410);
  assert.ok(p.sloppy < p.clean);
});

check('type rows carry the GM allow-list and mark the program tiles', () => {
  const rows = M.typeRows(cfg);
  assert.equal(rows.length, 18, 'all 18 content types are present');
  assert.equal(rows.filter((r) => r.on).length, 15, '11 authorable + message/note/eddies + the 2 program tiles');
  assert.equal(rows.find((r) => r.key === 'schematic').on, false, 'off by default');
  assert.equal(rows.find((r) => r.key === 'note').noRoll, true);
  assert.equal(rows.find((r) => r.key === 'malware').isProgram, true);
});

// ═══════════════════════════════════════════════════════════════════════════
section('the content branch (forged files)');

check('a type with no craft skill needs no roll', () => {
  assert.equal(M.contentDV(cfg, { type: 'note', craft: '' }), 0);
  assert.equal(M.contentChoices(cfg, 'note').length, 0, 'and offers no craft choice');
  assert.equal(M.contentEfficiency({ total: 0, dv: 0 }).rung, 'clean', 'it simply lands');
  assert.equal(M.contentEfficiency({ total: 0, dv: 0 }).quality, 100);
});

check(`a forged type offers its skill and the GM alternative`, () => {
  const cs = M.contentChoices(cfg, 'document');
  assert.equal(cs.length, 2);
  assert.equal(cs[0].skill, 'Forgery');
  assert.equal(cs[0].penalty, 0);
  assert.equal(cs[1].skill, 'Library Search');
  assert.equal(cs[1].penalty, 3);
});

check('the alternative skill raises the DV by its penalty', () => {
  assert.equal(M.contentDV(cfg, { type: 'document', craft: 'Forgery' }), 15);
  assert.equal(M.contentDV(cfg, { type: 'document', craft: 'Library Search' }), 18);
});

check('a type the GM switched off is not in the tile list', () => {
  const keys = M.typeRows(cfg).filter((r) => r.on && !r.isProgram).map((r) => r.key);
  assert.ok(!keys.includes('schematic'), 'schematic is off by default');
  assert.ok(keys.includes('document'));
});

check('forgery quality scales with the margin and floors at the DV', () => {
  assert.equal(M.contentEfficiency({ total: 15, dv: 15 }).quality, 50, 'meeting the DV is mediocre');
  assert.ok(M.contentEfficiency({ total: 22, dv: 15 }).quality > 90);
  assert.equal(M.contentEfficiency({ total: 13, dv: 15 }).rung, 'sloppy');
  assert.equal(M.contentEfficiency({ total: 13, dv: 15 }).tell, 'FORGED');
  assert.equal(M.contentEfficiency({ total: 9, dv: 15 }).rung, 'rejected');
  assert.equal(M.contentEfficiency({ total: 9, dv: 15 }).quality, 0, 'a rejected fake is worth nothing');
});

check('the scan DV is the SAME formula the upload arc uses', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/ui/content/UploadFlow.js'), 'utf8');
  assert.ok(src.includes('Math.round(6 + (Number(forgeQuality) || 0) / 8)'),
    'UploadFlow.stealthDVFromQuality changed — re-check contentEfficiency');
  // same quality in, same scan DV out
  const q = M.contentEfficiency({ total: 18, dv: 15 });
  assert.equal(q.scanDV, Math.max(8, Math.min(20, Math.round(6 + q.quality / 8))));
});

check('a better forger is harder to catch', () => {
  const good = M.contentEfficiency({ total: 25, dv: 15 });
  const poor = M.contentEfficiency({ total: 15, dv: 15 });
  assert.ok(good.scanDV > poor.scanDV, 'a clean fake should need a better scan to spot');
});

check('the forecast brackets what the roll can buy', () => {
  const f = M.contentForecast(cfg, { base: 11, dv: 15 });
  assert.equal(f.noRoll, false);
  assert.ok(f.qualityHi > f.qualityLo);
  assert.ok(f.scanHi >= f.scanLo);
  const none = M.contentForecast(cfg, { base: 11, dv: 0 });
  assert.equal(none.noRoll, true);
});

check('the player composer collects instead of persisting', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/ui/ItemInbox/DataShardComposer.js'), 'utf8');
  assert.ok(src.includes('if (this._playerMode)') && src.includes('done?.(entryData)'),
    'DataShardComposer must hand the entry back in player mode, never write it');
  const sub = fs.readFileSync(path.join(ROOT, 'scripts/ui/ShardEncoder/PlayerEntryComposer.js'), 'utf8');
  assert.ok(/static ADMIN_THEMED = false/.test(sub), 'the player composer must wear the player theme');
});

check('the Encoder refuses to encode an empty file', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/ui/ShardEncoder/ShardEncoderApp.js'), 'utf8');
  assert.ok(src.includes("!this._isProgram() && !this._entries().length"), 'nothing written must block the roll');
  assert.ok(src.includes("ui.notifications?.warn('NCM | Write something first"), 'and Next must say so');
});

// ═══════════════════════════════════════════════════════════════════════════
section('the lock stage (a ceiling, not a check)');

check('an unrolled lock still lets you set something', () => {
  const o = M.lockOptions(cfg, {});
  assert.equal(o.rolled, false);
  assert.ok(o.maxDV > 0, 'the floor rung must still be usable');
  assert.equal(o.canBlackIce, false, 'but not the dangerous parts');
  assert.equal(o.canKeyItem, false);
});

check('a better roll raises the ceiling, monotonically', () => {
  let last = 0;
  for (const total of [0, 9, 10, 14, 15, 19, 20, 24, 25, 40]) {
    const dv = M.lockOptions(cfg, { cryptoTotal: total }).maxDV;
    assert.ok(dv >= last, `ceiling went DOWN at ${total}`);
    last = dv;
  }
});

check('the ceiling rungs match the table the old wizard used', () => {
  assert.equal(M.lockCeiling(cfg, 5).maxDV, 10);
  assert.equal(M.lockCeiling(cfg, 12).maxDV, 15);
  assert.equal(M.lockCeiling(cfg, 17).maxDV, 18);
  assert.equal(M.lockCeiling(cfg, 22).maxDV, 22);
  assert.equal(M.lockCeiling(cfg, 99).maxDV, 25);
});

check('a lock roll can never fail — only narrow what you may set', () => {
  // Whatever the total, there is always a rung, and it always allows a DV.
  for (const total of [-5, 0, 1, 7, 100]) {
    const o = M.lockOptions(cfg, { cryptoTotal: total });
    assert.ok(o.maxDV >= 10, `total ${total} left nothing lockable`);
  }
});

check('Black ICE needs the rung AND the GM', () => {
  assert.equal(M.lockOptions(cfg, { cryptoTotal: 17 }).canBlackIce, true);
  assert.equal(M.lockOptions(cfg, { cryptoTotal: 12 }).canBlackIce, false, 'a low roll cannot');
  const vetoed = M.resolveEncoderConfig({ lock: { blackIce: false } });
  assert.equal(M.lockOptions(vetoed, { cryptoTotal: 40 }).canBlackIce, false, 'the GM veto beats any roll');
});

check('the hardware gates ride their own roll', () => {
  const low = M.lockOptions(cfg, { cryptoTotal: 40, gateTotal: 5 });
  assert.equal(low.canKeyItem, false, 'a great crypto roll does not fit a reader');
  assert.equal(low.canDamage, false);
  const high = M.lockOptions(cfg, { cryptoTotal: 5, gateTotal: 22 });
  assert.equal(high.canKeyItem, true);
  assert.equal(high.canDamage, true);
  assert.equal(high.maxDV, 10, 'and it does not raise the encryption ceiling');
});

check('every offered DV is within the ceiling', () => {
  for (const total of [0, 12, 17, 22, 30]) {
    const o = M.lockOptions(cfg, { cryptoTotal: total });
    assert.ok(o.dvChoices.length, `no DV offered at ${total}`);
    assert.ok(o.dvChoices.every((dv) => dv <= o.maxDV), `a choice exceeds the ceiling at ${total}`);
    assert.deepEqual(o.dvChoices, [...new Set(o.dvChoices)], 'no duplicate DV chips');
  }
});

check('an untouched lock leaves the shard open', () => {
  assert.equal(M.lockIsSet(null), false);
  assert.equal(M.lockIsSet({ password: '', encrypted: false, keyItem: null }), false);
  assert.equal(M.lockIsSet({ password: 'ronin-42' }), true);
  assert.equal(M.lockIsSet({ encrypted: true }), true);
  assert.equal(M.lockIsSet({ keyItem: { name: 'Keycard' } }), true);
});

check('a bite-back failure is gated, the plain ones are not', () => {
  assert.equal(M.LOCK_FAILURES.lockout.needsRung, false);
  assert.equal(M.LOCK_FAILURES.nothing.needsRung, false);
  assert.equal(M.LOCK_FAILURES.damage.needsRung, true);
});

check('the Encoder writes the lock in the shard config\'s own field names', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/ui/ShardEncoder/ShardEncoderApp.js'), 'utf8');
  for (const field of ['encryptionDC', 'encryptionType', 'failureMode', 'requiresLogin', 'loginPassword', 'requiresKeyItem', 'keyItemName']) {
    assert.ok(src.includes(field), `_lockConfig never writes ${field}`);
  }
  assert.ok(src.includes('if (!lockIsSet(L)) return {}'), 'an open shard must write NO security fields');
});

check('the GM can remove the lock stage entirely', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/ui/ShardEncoder/ShardEncoderApp.js'), 'utf8');
  assert.ok(src.includes("row.key !== 'lock' || this.cfg.lock?.allowed !== false"),
    'lock.allowed:false must drop the stage from the spine and the navigation');
});

// ═══════════════════════════════════════════════════════════════════════════
section('the market (who decides what it is worth)');

const MKT = await imp('scripts/ui/ShardEncoder/ShardMarket.js');

check('a better job is worth more', () => {
  const good = MKT.suggestFor({ blankPrice: 50, dv: 15, quality: 90, outcome: 'clean' });
  const poor = MKT.suggestFor({ blankPrice: 50, dv: 15, quality: 55, outcome: 'clean' });
  const bad = MKT.suggestFor({ blankPrice: 50, dv: 15, quality: 34, outcome: 'sloppy' });
  assert.ok(good > poor, 'quality must move the figure');
  assert.ok(poor > bad, 'and a sloppy job is worth least');
});

check('harder work is worth more', () => {
  const hard = MKT.suggestFor({ blankPrice: 50, dv: 22, quality: 80, outcome: 'clean' });
  const easy = MKT.suggestFor({ blankPrice: 50, dv: 12, quality: 80, outcome: 'clean' });
  assert.ok(hard > easy);
});

check('the blank you used is part of what it cost you', () => {
  const premium = MKT.suggestFor({ blankPrice: 200, dv: 15, quality: 80, outcome: 'clean' });
  const scrap = MKT.suggestFor({ blankPrice: 0, dv: 15, quality: 80, outcome: 'clean' });
  assert.ok(premium > scrap);
});

check('the suggestion is never negative, whatever it is handed', () => {
  for (const args of [{}, { blankPrice: 0, dv: 0, quality: 0, outcome: 'clean' }, { blankPrice: 0, dv: 0, quality: 5, outcome: 'sloppy' }]) {
    assert.ok(MKT.suggestFor(args) >= 0, JSON.stringify(args));
  }
});

check('every pricing mode the config allows is a mode the market implements', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/ui/ShardEncoder/ShardEncoderApp.js'), 'utf8');
  for (const mode of Object.keys(M.PRICING_MODES)) {
    assert.ok(src.includes(`'${mode}'`), `the Encoder never mentions pricing mode "${mode}"`);
  }
});

check('the write is GM-only, wherever the ask came from', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/ui/ShardEncoder/ShardMarket.js'), 'utf8');
  assert.ok(/export async function applyShardPrice[\s\S]{0,200}if \(!item \|\| !isGM\(\)\) return false/.test(src),
    'applyShardPrice must refuse a non-GM caller');
  assert.ok(src.includes('system.price.market'), 'it must write the CPR price field');
});

check('a proposal that is never answered does not hang the window', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/ui/ShardEncoder/ShardMarket.js'), 'utf8');
  assert.ok(src.includes('setTimeout(') && src.includes('if (!settled)'), 'requestShardPrice needs a timeout');
  assert.ok(src.includes("resolve({ decision: 'pending'"), 'and it must resolve, not reject');
});

check('closing the GM prompt is a DENY, never a silent yes', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/ui/ShardEncoder/ShardMarket.js'), 'utf8');
  assert.ok(src.includes("resolve(done || { decision: 'denied', price: 0 })"),
    'an unanswered prompt must deny');
});

check('no GM online is reported, not silently swallowed', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/ui/ShardEncoder/ShardMarket.js'), 'utf8');
  assert.ok(src.includes('!game.users?.activeGM'), 'it must check for a GM');
  assert.ok(src.includes("decision: 'nogm'"), 'and say so');
});

check('the price relay is registered on the GM client', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/integrations/SocketHandlers.js'), 'utf8');
  assert.ok(src.includes('SOCKET_OPS.SHARD_PRICE_REQUEST'), 'no handler for the price request');
  const consts = fs.readFileSync(path.join(ROOT, 'scripts/utils/constants.js'), 'utf8');
  assert.ok(consts.includes('SHARD_PRICE_REQUEST') && consts.includes('SHARD_PRICE_RESULT'), 'both ops must exist');
});

// ═══════════════════════════════════════════════════════════════════════════
section('live-test fixes (2026-09-21, first run in Foundry)');

const ENC = fs.readFileSync(path.join(ROOT, 'scripts/ui/ShardEncoder/ShardEncoderApp.js'), 'utf8');
const CMP = fs.readFileSync(path.join(ROOT, 'scripts/ui/ItemInbox/DataShardComposer.js'), 'utf8');

check('the blank list can be searched and filtered', () => {
  assert.ok(ENC.includes('data-enc-search="src"'), 'no search box on the blank list');
  assert.ok(ENC.includes("case 'srcfilter'"), 'no blanks-only filter');
  assert.ok(ENC.includes("case 'srctype'"), 'no item-type filter');
  assert.ok(ENC.includes('data-src-name'), 'rows must carry a searchable name');
});

check('the filter chips are ALWAYS offered, not only when a tier matches', () => {
  // First cut only rendered them when the GM had registered blank items, so a
  // fresh world showed no filter at all — the dev's report.
  assert.ok(ENC.includes('const srcTools = cands.length ?'),
    'the tools row must render whenever the character carries anything');
});

check('the type chips are built from what the character actually carries', () => {
  assert.ok(ENC.includes('for (const c of cands) byType.set(c.item.type'),
    'types must come from the real inventory, not a hardcoded list');
  assert.ok(ENC.includes('_typeLabel('), 'and must be labelled readably');
});

check('a system item type gets a readable label', () => {
  // The labels are a plain map plus a camelCase splitter; assert the shape is
  // there and that an unknown type still comes out sentence-cased.
  assert.ok(ENC.includes("cyberware: 'Cyberware'"), 'the common CPR types need names');
  assert.ok(ENC.includes("replace(/([a-z])([A-Z])/g, '$1 $2')"), 'an unknown camelCase type must still read');
});

check('the two filters do not fight each other', () => {
  assert.ok(ENC.includes("case 'srcfilter': S.srcOnlyKnown = !S.srcOnlyKnown; if (S.srcOnlyKnown) S.srcType = ''"),
    'picking Blanks must clear the type');
  assert.ok(ENC.includes("case 'srctype':   S.srcType = arg || ''; if (arg) S.srcOnlyKnown = false"),
    'picking a type must clear Blanks');
});

check('an empty list says WHICH filter emptied it', () => {
  assert.ok(ENC.includes('No ${esc(this._typeLabel(this.S.srcType).toLowerCase())} in your gear'),
    'a type filter with no hits must name the type and offer All');
});

check('a new run clears the filters', () => {
  assert.ok(ENC.includes("this.S.srcSearch = ''; this.S.srcType = ''; this.S.srcOnlyKnown = false"),
    'a stale filter would hide the blanks on the next run');
});

check('typing in the search does NOT re-render the rail', () => {
  // A re-render per keystroke steals focus mid-word — the standing module rule.
  const i = ENC.indexOf("const sr = e.target.closest('[data-enc-search]')");
  assert.ok(i !== -1, 'the search handler is missing');
  const handler = ENC.slice(i, i + 900);
  assert.ok(handler.includes('row.hidden'), 'it must filter the live DOM');
  assert.ok(!handler.includes('_renderRail'), 'it must NOT re-render');
});

check('the player composer no longer demands an item', () => {
  // A BOUGHT blank has no item until the encode succeeds, so requiring one
  // showed the GM-only "No shard selected" panel and nothing could be written.
  assert.ok(CMP.includes('if (!this._item && !this._playerMode) return { hasItem: false }'),
    'player mode must render without an item');
  assert.ok(CMP.includes("shardName: this._item?.name ?? 'a new shard'"), 'and must not read .name off null');
  assert.ok(CMP.includes('const config = (this._item &&'), 'and must not ask for a config it has no item for');
});

check('saving from the player composer survives a missing item', () => {
  const i = CMP.indexOf('static async _onSaveEntry');
  const fn = CMP.slice(i, i + 400);
  assert.ok(fn.includes('if (!this._item && !this._playerMode) return'), 'player mode must be allowed to save');
});

check('every file-type tile names its skill, not just the selected one', () => {
  const i = ENC.indexOf('const tile = (t) => {');
  const tile = ENC.slice(i, i + 900);
  assert.ok(tile.includes('${t.skill ? `<span class="sk">'), 'the skill must render for every tile');
  assert.ok(!tile.includes('t.key === this.S.type && t.skill'), 'it must not be gated on selection');
});

check('a finished shard is findable: views refresh and the seal offers to open it', () => {
  assert.ok(ENC.includes('_refreshShardViews()'), 'nothing repaints the lists that show a shard');
  assert.ok(ENC.includes("w.id === 'ncm-message-viewer'"), "the Agent's SHARDS tab must be repainted");
  assert.ok(ENC.includes('ui.items?.render()'), 'the item directory must be repainted');
  assert.ok(ENC.includes("next.dataset.enc = 'open'"), 'the seal must offer to open it');
  assert.ok(ENC.includes("case 'open'"), 'and that action must exist');
  assert.ok(/is in \$\{esc\(this\.actor\?\.name/.test(ENC) || ENC.includes("is in ${esc(this.actor?.name"),
    'and it must say WHOSE gear it is in');
});

check('a new run forgets the shard the last one made', () => {
  assert.ok(ENC.includes('this._madeItemId = null'), 'restart must clear it, or Open it opens the wrong shard');
});

// ═══════════════════════════════════════════════════════════════════════════
section('look, filing and permissions');

const SHARDSVC = fs.readFileSync(path.join(ROOT, 'scripts/services/DataShardService.js'), 'utf8');
const REPO = fs.readFileSync(path.join(ROOT, 'scripts/data/MessageRepository.js'), 'utf8');
const CFGAPP = fs.readFileSync(path.join(ROOT, 'scripts/ui/ShardEncoder/EncoderConfigApp.js'), 'utf8');

check('a shard wears the system\'s own chip art by default', () => {
  assert.ok(ENC.includes("const GEAR_ART = 'systems/cyberpunk-red-core/icons/compendium/gear/'"),
    'the default art must come from the CPR gear set');
  assert.ok(ENC.includes("['memory_chip.svg', 'Chip']"), 'and the default should be the memory chip');
  assert.ok(ENC.includes('const DEFAULT_SHARD_IMG = GEAR_ART + SHARD_ART[0][0]'), 'the first entry is the default');
});

check('the art is changeable — quick picks AND any file', () => {
  assert.ok(ENC.includes("case 'img':"), 'no quick-pick action');
  assert.ok(ENC.includes("case 'browseimg'"), 'no file picker');
  assert.ok(ENC.includes('new FilePicker('), 'the picker must be a real FilePicker');
});

check('the chosen art lands on the ITEM, not in the shard config', () => {
  assert.ok(ENC.includes("delete look.__img;"), 'the art must be stripped from the config payload');
  assert.ok(ENC.includes('if (img && item.img !== img) patch.img = img'), 'and written to the item');
  assert.ok(ENC.includes('img: this._img()'), 'a bought blank must be born wearing it');
});

check('a look preset changes the LOOK, never the security', () => {
  // Several shipped presets carry Black ICE at DV 20. A player must not get
  // that by liking the artwork — security is rolled for at the LOCK stage.
  const i = ENC.indexOf('_lookConfig() {');
  const fn = ENC.slice(i, i + 700);
  assert.ok(fn.includes('out.theme') && fn.includes('out.boot'), 'theme + boot must carry over');
  assert.ok(!fn.includes('security'), 'a preset must NEVER hand over its security block');
});

check('the Encoder never passes a preset KEY to the converter', () => {
  // convertToDataShard(item, overrides, presetKey) applies the preset's security
  // too — so the Encoder must pass explicit overrides instead.
  assert.ok(/convertToDataShard\(item, config\)/.test(ENC), 'it must convert with overrides only');
});

check('a player-made shard is filed under its maker', () => {
  assert.ok(REPO.includes('async getSubfolderPath('), 'no nested-folder helper');
  assert.ok(SHARDSVC.includes("getSubfolderPath?.(['Data Shards', 'Player-Made', maker])"),
    'the journal must be filed under Data Shards / Player-Made / <character>');
  assert.ok(SHARDSVC.includes('configOverrides?.playerMade?.actorName'), 'filing keys off the maker');
  assert.ok(SHARDSVC.includes('await repo?.getShardFolder?.()'), 'and falls back to the flat folder');
});

check('folder creation is GM-only and degrades instead of throwing', () => {
  const i = REPO.indexOf('async getSubfolderPath(');
  const fn = REPO.slice(i, i + 1400);
  assert.ok(fn.includes('if (!game.user.isGM) return parent'),
    'a player must get the deepest existing folder, never attempt a world write');
});

check('the GM sees at a glance that a shard was player-made', () => {
  const tab = fs.readFileSync(path.join(ROOT, 'scripts/ui/AdminPanel/tabs/ShardsTab.js'), 'utf8');
  assert.ok(tab.includes('config.playerMade'), 'the Shards tab must read the flag');
  assert.ok(tab.includes('Made by ') && tab.includes('made.actorName'), 'and name the maker');
});

check('the badge colour is one the stylesheet actually defines', () => {
  const tab = fs.readFileSync(path.join(ROOT, 'scripts/ui/AdminPanel/tabs/ShardsTab.js'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'styles/components/admin-panel/tab-shards.css'), 'utf8');
  const m = tab.match(/type: made\.outcome === 'sloppy' \? '(\w+)' : '(\w+)'/);
  assert.ok(m, 'the badge type is not set the way this check expects');
  for (const colour of [m[1], m[2]]) {
    assert.ok(css.includes(`ncm-sc-badge--${colour}`), `no badge style for "${colour}"`);
  }
});

check('the GM config window refuses to open for a player', () => {
  assert.ok(/async render\([^)]*\)\s*\{[\s\S]{0,160}if \(!isGM\(\)\)/.test(CFGAPP),
    'EncoderConfigApp must refuse at the door, not at Save');
});

check('every permission an encode needs is checked BEFORE the roll', () => {
  assert.ok(ENC.includes('_permissionProblem()'), 'no up-front permission check');
  const fn = ENC.slice(ENC.indexOf('_permissionProblem() {'), ENC.indexOf('_permissionProblem() {') + 700);
  assert.ok(fn.includes('!this.actor.isOwner'), 'ownership must be checked — buying and paying both write to the actor');
  assert.ok(fn.includes('!this.cfg.enabled'), 'and authoring may have been switched off mid-session');
  // Scope to _runEncode: the LOCK stage rolls earlier in the file, so a naive
  // whole-file indexOf compares against the wrong roll.
  const body = ENC.slice(ENC.indexOf('async _runEncode() {'), ENC.indexOf('_seal(R) {'));
  const guard = body.indexOf('const problem = this._permissionProblem();');
  const roll = body.indexOf('performCheck');
  assert.ok(guard !== -1, 'the encode does not check permissions at all');
  assert.ok(guard < roll, 'the check must run before the roll');
  assert.ok(body.indexOf('_canPersist()') < roll, 'and so must the no-GM guard');
});

check('buying a blank refuses loudly when the actor is not yours', () => {
  const i = ENC.indexOf('async _createBlank(tier) {');
  const fn = ENC.slice(i, i + 400);
  assert.ok(fn.includes("if (!this.actor?.isOwner)"), 'it must check ownership');
  assert.ok(fn.includes('ui.notifications?.error'), 'and say so rather than returning a silent null');
});

check('the cosmetic writes can fail without costing the shard', () => {
  const i = ENC.indexOf('if (item.isOwner) {');
  const fn = ENC.slice(i, i + 500);
  assert.ok(fn.includes('try {') && fn.includes('catch'), 'a rename/restyle failure must not throw away the encode');
});

// ═══════════════════════════════════════════════════════════════════════════
section('the type-change bug, and the chip designer');

const IB = fs.readFileSync(path.join(ROOT, 'scripts/ui/ShardEncoder/ShardIconBuilder.js'), 'utf8');

check('the roll follows what was WRITTEN, not what was picked in the rail', () => {
  // The composer's own "Change type" could swap a message for a dossier while
  // the Encoder went on forging at the message's (nonexistent) DV.
  assert.ok(ENC.includes('_adoptEntryType(entry)'), 'the collect callback must adopt the written type');
  // With several files the encode re-derives the whole stack's DV instead of
  // re-checking one entry.
  const body = ENC.slice(ENC.indexOf('async _runEncode() {'), ENC.indexOf('_seal(R) {'));
  assert.ok(body.includes('if (!this._isProgram()) { this._syncCraft(); this._patch(); }'),
    'the encode must re-derive the stack before rolling');
  assert.ok(body.indexOf('_syncCraft()') < body.indexOf('performCheck'), 'and do it before the roll');
  const i = ENC.indexOf('_adoptEntryType(entry) {');
  const fn = ENC.slice(i, i + 900);
  assert.ok(fn.includes('this.S.type = next'), 'an allowed type must be adopted');
  assert.ok(fn.includes('entry.contentType = this.S.type'), 'a disallowed one must be reverted, not rolled');
});

check('adopting a type re-syncs the craft skill', () => {
  // Forgery is not Accounting: the old skill may not even be offered for the new
  // type, which would leave the chip forged with a skill that does not apply.
  const i = ENC.indexOf('onCollect: (entry) => {');
  const fn = ENC.slice(i, i + 600);
  assert.ok(fn.indexOf('_adoptEntryType') < fn.indexOf('_syncCraft'), 'adopt the type, THEN fix the skill');
});

check('a type the GM disallows is refused with a reason', () => {
  const i = ENC.indexOf('_adoptEntryType(entry) {');
  const fn = ENC.slice(i, i + 900);
  assert.ok(fn.includes('const allowed = this._types().some'), 'it must check the allow-list');
  assert.ok(fn.includes('ui.notifications?.warn'), 'and say why, rather than silently rolling');
});

check('the chip wears the Encoder core silhouette (corners cut in)', () => {
  // The icon should be recognisably the thing the player watched compile, so the
  // canvas path mirrors the workshop core's clip-path (top-left + bottom-right cut).
  const i = IB.indexOf("if (state.base === 'chip')");
  const fn = IB.slice(i, i + 1600);
  assert.ok(fn.includes('const chip = (inset) =>'), 'the chip must be drawn as a reusable path');
  assert.ok((fn.split('ctx.lineTo(').length - 1) >= 5, 'a chamfered hexagon needs five lineTo calls');
  assert.ok(fn.includes('chip(0)') && fn.includes('chip(Math.max'), 'it needs an outer body AND an inset face');
  const css = fs.readFileSync(path.join(ROOT, 'styles/components/malware-workshop.css'), 'utf8');
  assert.ok(css.includes('.ncm-fw-chip-core{') && css.includes('clip-path:polygon'),
    'the core shape this mirrors has moved — re-check the canvas path');
});

check('a colour can be a palette name OR any hex', () => {
  const i = IB.indexOf('function hexFor(');
  const fn = IB.slice(i, i + 300);
  assert.ok(fn.includes('#[0-9a-f]'), 'hexFor must accept a literal hex');
  assert.ok(fn.includes('SWATCH[name]'), 'and still resolve palette names');
  assert.ok(IB.includes('data-ib-hex'), 'there must be a colour input');
  assert.ok(IB.includes("String(S.colour).startsWith('#')"), 'the swatch row must know when a custom colour wins');
});

check('dragging the colour picker repaints without rebuilding the row', () => {
  const i = IB.indexOf("const hx = e.target.closest('[data-ib-hex]')");
  const fn = IB.slice(i, i + 500);
  assert.ok(fn.includes('paint();'), 'it must repaint live');
  assert.ok(fn.includes('if (!wasCustom) syncChips();'), 'and only re-stamp the row when the mode changes');
});

check('the designer bakes an image, and needs no file permission', () => {
  assert.ok(IB.includes("toDataURL('image/png')"), 'it must bake to a data URI');
  assert.ok(!IB.includes('FilePicker.upload'), 'uploading would need a permission players lack');
  assert.ok(IB.includes('runIconBuilder'), 'the entry point must be exported');
});

check('a tainted canvas is reported, not handed back broken', () => {
  const i = IB.indexOf("toDataURL('image/png')");
  const near = IB.slice(i - 120, i + 500);
  assert.ok(near.includes('try {') && near.includes('catch'), 'the export must be guarded');
  assert.ok(near.includes('ui.notifications?.warn'), 'and the player told why');
});

check('the Font Awesome glyph is read back, not guessed', () => {
  // A class name carries no character — the glyph lives in ::before { content }.
  assert.ok(IB.includes("getComputedStyle(probe, '::before')"), 'the glyph must be read from the live style');
  assert.ok(IB.includes('probe.remove()'), 'and the probe element cleaned up');
});

check('the preview and the bake paint with the SAME function', () => {
  assert.ok(IB.includes('export function paintIcon'), 'one painter');
  const uses = (IB.match(/paintIcon\(/g) || []).length;
  assert.ok(uses >= 3, 'the preview, the minis and the bake must all go through it');
});

check('every palette colour the builder offers has a real hex', () => {
  const CR = fs.readFileSync(path.join(ROOT, 'scripts/ui/content/ContentRenderers.js'), 'utf8');
  const listed = CR.match(/export const CT_COLORS = \[([^\]]+)\]/);
  assert.ok(listed, 'CT_COLORS not found');
  const colours = listed[1].split(',').map((c) => c.trim().replace(/['"]/g, '')).filter(Boolean);
  assert.ok(IB.includes('const SWATCH = Object.freeze({ ...ACCENT_HEX'), 'the builder must extend the shared map');
  for (const c of ['amber', 'blue', 'pink']) {
    assert.ok(IB.includes(`${c}:`), `${c} has no hex, so it would silently render as cyan`);
  }
  assert.ok(colours.length >= 9, 'the palette shrank — re-check the builder swatches');
});

check('the designer is reachable from the Look row', () => {
  assert.ok(ENC.includes("case 'designimg'"), 'no action');
  assert.ok(ENC.includes('ncm-enc-artopt--make'), 'no tile');
  assert.ok(ENC.includes("import('./ShardIconBuilder.js')"), 'it must be lazily imported');
});

check('the builder styles live in their own stylesheet, imported after the Encoder', () => {
  const idx = fs.readFileSync(path.join(ROOT, 'styles/night-city-messenger.css'), 'utf8');
  const enc = idx.indexOf('shard-encoder.css'), ib = idx.indexOf('shard-icon-builder.css');
  assert.ok(ib !== -1 && ib > enc, 'the modal must come after the window it opens in');
  const css = fs.readFileSync(path.join(ROOT, 'styles/components/shard-icon-builder.css'), 'utf8');
  assert.ok(!/\.ncm-enc-/.test(css), 'one prefix per stylesheet — Encoder rules belong to the Encoder');
});

// ═══════════════════════════════════════════════════════════════════════════
section('fourth live round: ground, operator, startup, filing');

check('the baked icon sits on the item-tile ground, not a hole', () => {
  assert.ok(IB.includes("const TILE_BG = '#1b1f21'"), 'the tile colour must be named once');
  const i = IB.indexOf('ctx.clearRect(0, 0, S, S)');
  const fn = IB.slice(i, i + 220);
  assert.ok(fn.includes('ctx.fillStyle = TILE_BG') && fn.includes('fillRect(0, 0, S, S)'),
    'the ground must be filled before anything is drawn on it');
});

check('the Agent encodes as the character it is OPEN as', () => {
  const V = fs.readFileSync(path.join(ROOT, 'scripts/ui/MessageViewer/MessageViewerApp.js'), 'utf8');
  assert.ok(V.includes('openEncoder?.({ actor: game.actors?.get(this.actorId)'),
    'the door must pass the viewer\'s own actor — this.actor does not exist on it');
  assert.ok(!V.includes('openEncoder?.({ actor: this.actor })'), 'the old undefined-actor call must be gone');
});

check('the Encoder always says which character it is encoding as', () => {
  const i = ENC.indexOf('_renderOperator() {');
  const fn = ENC.slice(i, i + 1200);
  assert.ok(fn.includes("this.g('encOpCard').hidden = !this.actor;"),
    'the operator card must show on every stage, not only ones that roll');
  assert.ok(fn.includes('Nothing is rolled on this stage'), 'and say so plainly when nothing rolls');
});

check('the startup is the player\'s to write', () => {
  assert.ok(ENC.includes("data-enc-in=\"bootTitle\""), 'no title field');
  assert.ok(ENC.includes("data-enc-in=\"bootSub\""), 'no subtitle field');
  assert.ok(ENC.includes("case 'bootanim'"), 'no animation picker');
  assert.ok(ENC.includes("case 'bootspeed'"), 'no speed picker');
  assert.ok(ENC.includes("case 'bootoff'"), 'it must be possible to skip the startup');
});

check('every animation offered is one the shard viewer can actually play', () => {
  const viewer = fs.readFileSync(path.join(ROOT, 'scripts/ui/ItemInbox/ItemInboxApp.js'), 'utf8');
  const listed = ENC.slice(ENC.indexOf('const BOOT_STYLES = ['), ENC.indexOf('const BOOT_SPEEDS'));
  const keys = [...listed.matchAll(/\['([a-z-]+)',/g)].map((m) => m[1]);
  assert.ok(keys.length >= 5, 'the style list did not parse');
  for (const k of keys) {
    assert.ok(viewer.includes(`'${k}'(el, m)`), `the viewer has no "${k}" boot animation`);
  }
});

check('an untouched startup keeps the preset\'s own words', () => {
  const i = ENC.indexOf('_bootConfig(base = {}) {');
  const fn = ENC.slice(i, i + 1200);
  assert.ok(fn.includes('if (B.title) out.title'), 'an empty title must not overwrite the preset');
  assert.ok(fn.includes('if (B.subtitle) out.subtitle'), 'nor an empty subtitle');
  assert.ok(ENC.includes('_bootDefaults()'), 'the placeholders must come from the preset');
});

check('picking a preset adopts its animation until the player picks their own', () => {
  const i = ENC.indexOf("case 'preset': {");
  const fn = ENC.slice(i, i + 500);
  assert.ok(fn.includes('if (!S.bootTouched)'), 'a player choice must not be overwritten by a later preset');
});

check('the GM can gather player-made shards by maker', () => {
  const tab = fs.readFileSync(path.join(ROOT, 'scripts/ui/AdminPanel/tabs/ShardsTab.js'), 'utf8');
  assert.ok(tab.includes("case 'maker':"), 'no maker grouping');
  assert.ok(tab.includes("const order = ['owner', 'maker', 'preset', 'status', 'none']"), 'it must be in the cycle');
  assert.ok(tab.includes('makerName,'), 'the row must carry the maker');
});

check('the GM card says WHERE a player-made shard lives', () => {
  const tpl = fs.readFileSync(path.join(ROOT, 'templates/admin-panel/tab-shards.hbs'), 'utf8');
  assert.ok(tpl.includes('ncm-shard-authoring__where'), 'no explanation on the card');
  assert.ok(tpl.includes('Data Shards → Player-Made'), 'it must name the journal folder');
  assert.ok(tpl.includes("character's gear"), 'and say the ITEM cannot be foldered');
});

// ═══════════════════════════════════════════════════════════════════════════
section('a cred drop is money MOVED, not made');

check('eddies loaded onto a chip come out of the operator\'s wealth', () => {
  // Without this a player mints eb from nothing: the type needs no roll, so
  // there is not even a check in the way. The old ShardConversionFlow debited;
  // the Encoder has to as well.
  assert.ok(ENC.includes('_eddiesLoad()'), 'nothing reads the amount being loaded');
  const i = ENC.indexOf('_eddiesLoad() {');
  const fn = ENC.slice(i, i + 600);
  assert.ok(fn.includes("e.contentType === 'eddies'"), 'it must only charge for cred drops');
  assert.ok(fn.includes('contentData?.amount'), 'and read the authored amount');
  assert.ok(fn.includes('Math.max(0,'), 'a negative amount must not PAY the player');
  assert.ok(fn.includes('.reduce('), 'EVERY drop on the chip is money going in, not just one');
});

check('the wealth check happens before the roll, counting blank AND load', () => {
  const body = ENC.slice(ENC.indexOf('async _runEncode() {'), ENC.indexOf('_seal(R) {'));
  assert.ok(body.includes('if (price + load > wealth)'), 'the pre-flight must count both costs');
  assert.ok(body.indexOf('price + load > wealth') < body.indexOf('performCheck'),
    'and must run before the roll, not after a blank is burnt');
});

check('the debit happens only when something is really written', () => {
  const i = ENC.indexOf('async _persist(');
  const fn = ENC.slice(i, i + 2600);
  const rejected = fn.indexOf("if (outcome === 'rejected')");
  const debit = fn.indexOf('await this._debitWealth(load');
  assert.ok(rejected !== -1 && debit !== -1, 'the persist path changed shape');
  assert.ok(rejected < debit, 'a rejected encode must return BEFORE the money moves');
});

check('a failed write gives the money back', () => {
  const i = ENC.indexOf('async _persist(');
  const fn = ENC.slice(i, i + 3200);
  assert.ok(fn.includes('debited += load'), 'the load must join the refundable total');
  assert.ok(fn.includes('await this._refundWealth(debited'), 'and be refunded on failure');
});

check('wealth is re-checked at the moment of writing', () => {
  const i = ENC.indexOf('const load = this._eddiesLoad();\n      if (load > 0)');
  assert.ok(i !== -1, 'the persist-time load check is missing');
  const fn = ENC.slice(i, i + 400);
  assert.ok(fn.includes('if (load > have) throw'), 'wealth can move between the roll and the write');
});

check('the player is told what it costs, in three places', () => {
  assert.ok(ENC.includes("['Costs you',"), 'the artifact card must show it');
  assert.ok(ENC.includes('comes out of'), 'the readout must say it in words');
  assert.ok(ENC.includes("<span>Costs you</span>"), 'and the encode stage must list it');
});

// ═══════════════════════════════════════════════════════════════════════════
section('copying shards into the Items directory');

const SVC = fs.readFileSync(path.join(ROOT, 'scripts/services/DataShardService.js'), 'utf8');
const TAB = fs.readFileSync(path.join(ROOT, 'scripts/ui/AdminPanel/tabs/ShardsTab.js'), 'utf8');

check('there is a census before anything is written', () => {
  assert.ok(SVC.includes('surveyShardArchive('), 'a GM must be able to see what would happen first');
  assert.ok(SVC.includes('archiveShardsToItems('), 'and then do it');
  assert.ok(TAB.includes('onArchiveShards()'), 'the tab must expose it');
});

check('the copy shares the source journal — a window, not a snapshot', () => {
  const i = SVC.indexOf('async archiveShardsToItems(');
  const fn = SVC.slice(i, i + 2200);
  assert.ok(fn.includes('item.toObject()'), 'the copy must carry the shard flags');
  assert.ok(!fn.includes('journalId: null') && !fn.includes("delete data.flags[MODULE_ID].journalId"),
    'stripping journalId would make the copy an empty shell');
  assert.ok(fn.includes('shardArchive:'), 'and must be marked as an archive');
});

check('an archive can never delete the journal it borrows', () => {
  // The admin Unconvert passes deleteJournal:true. Without this guard, removing
  // a COPY would gut the player's real shard.
  const i = SVC.indexOf('async removeDataShard(');
  const fn = SVC.slice(i, i + 1200);
  assert.ok(fn.includes("const isArchive = !!item.getFlag(MODULE_ID, 'shardArchive')"), 'no archive check');
  assert.ok(fn.includes('if (deleteJournal && journalId && !isArchive)'), 'the guard is not on the delete');
});

check('archives are never archived again, and never double-copied', () => {
  const i = SVC.indexOf('surveyShardArchive(');
  const fn = SVC.slice(i, i + 1400);
  assert.ok(fn.includes("if (item.getFlag(MODULE_ID, 'shardArchive')) continue"), 'a copy must not be copied');
  assert.ok(fn.includes('archivedIds.has(item.id)'), 're-running must skip what is already there');
});

check('a copy whose shard is gone is offered for removal, not left to rot', () => {
  const i = SVC.indexOf('surveyShardArchive(');
  const fn = SVC.slice(i, i + 1600);
  assert.ok(fn.includes('const orphans = archives.filter'), 'orphans must be detected');
  assert.ok(SVC.includes('if (pruneOrphans && survey.orphans.length)'), 'and removable');
  assert.ok(SVC.includes('Item.deleteDocuments('), 'by a real delete');
});

check('the copies are foldered by maker', () => {
  assert.ok(SVC.includes("const root = 'Player-Made Shards'"), 'no root folder');
  assert.ok(SVC.includes('_getOrCreateItemFolder([root, maker])'), 'no per-maker folder');
  const i = SVC.indexOf('async _getOrCreateItemFolder(');
  const fn = SVC.slice(i, i + 700);
  assert.ok(fn.includes("type: 'Item'"), 'these must be ITEM folders, not journal ones');
  assert.ok(fn.includes('if (!isGM()) return parent'), 'folder creation is a world write — GM only');
});

check('the whole tool is GM-only', () => {
  const i = SVC.indexOf('async archiveShardsToItems(');
  assert.ok(SVC.slice(i, i + 260).includes("if (!isGM())"), 'it creates world items');
});

check('the dialog explains why these are copies', () => {
  const i = TAB.indexOf('async onArchiveShards()');
  const fn = TAB.slice(i, i + 3000);
  assert.ok(fn.includes('cannot go in a folder'), 'it must say why a move is impossible');
  assert.ok(fn.includes('reference copies'), 'and what these are instead');
  assert.ok(fn.includes('never'), 'and that deleting one is safe');
});

// ═══════════════════════════════════════════════════════════════════════════
section('how much a chip holds');

check('a tier says how many entries it holds', () => {
  const c = M.resolveEncoderConfig({});
  const by = Object.fromEntries(c.tiers.map((t) => [t.id, t.capacity]));
  assert.ok(by.scrap < by.standard && by.standard < by.premium,
    'a better blank should fit more on it — that is the point of buying one');
});

check('0 means no limit, and an unset capacity IS 0', () => {
  assert.equal(M.capacityOf({ capacity: 0 }).unlimited, true);
  assert.equal(M.capacityOf({}).unlimited, true, 'an older tier must not suddenly hold nothing');
  assert.equal(M.capacityOf(null).unlimited, true);
  assert.equal(M.capacityOf({ capacity: 3 }).limit, 3);
  assert.equal(M.capacityOf({ capacity: 3 }).label, 'holds 3');
});

check('a capacity is sanitised like every other tier field', () => {
  const c = M.resolveEncoderConfig({ tiers: [{ id: 'x', name: 'X', capacity: -5, fallback: true }] });
  assert.equal(c.tiers[0].capacity, 0, 'a negative capacity must not mean "holds minus five"');
  const f = M.resolveEncoderConfig({ tiers: [{ id: 'y', name: 'Y', capacity: 2.7, fallback: true }] });
  assert.equal(f.tiers[0].capacity, 3, 'and it is a whole number of entries');
});

check('room is counted against what the chip already carries', () => {
  const t = { capacity: 3 };
  assert.equal(M.capacityLeft(t, 0).left, 3);
  assert.equal(M.capacityLeft(t, 2).ok, true);
  assert.equal(M.capacityLeft(t, 3).ok, false, 'a full chip has no room');
  assert.equal(M.capacityLeft(t, 9).left, 0, 'an over-full chip reports 0, never a negative');
  assert.equal(M.capacityLeft({ capacity: 0 }, 99).ok, true, 'no limit means no limit');
});

check('the shard itself carries the limit, so later entries can be checked', () => {
  assert.ok(ENC.includes('capacity: capacityOf(this._blank().tier).limit'),
    'the encode must stamp the tier capacity onto the shard config');
});

check('a full chip refuses the write, wherever the entry came from', () => {
  const svc = fs.readFileSync(path.join(ROOT, 'scripts/services/DataShardService.js'), 'utf8');
  const i = svc.indexOf('async addMessage(');
  const fn = svc.slice(i, i + 1400);
  assert.ok(fn.includes('Number(config.capacity)'), 'addMessage must read the limit');
  assert.ok(fn.includes('if (limit > 0)'), 'and treat 0 as no limit');
  assert.ok(fn.includes('used >= limit'), 'and compare against what is already on it');
  assert.ok(fn.includes('full: true'), 'and say WHY it refused');
});

check('a pre-capacity shard is unaffected', () => {
  // Every shard authored before this existed has no config.capacity, which must
  // resolve to "no limit" rather than "holds nothing".
  const svc = fs.readFileSync(path.join(ROOT, 'scripts/services/DataShardService.js'), 'utf8');
  assert.ok(svc.includes('Math.max(0, Math.round(Number(config.capacity) || 0))'),
    'an absent capacity must fall to 0, and 0 must mean unlimited');
});

check('burning onto a full chip reports the reason', () => {
  const ts = fs.readFileSync(path.join(ROOT, 'scripts/services/TerminalService.js'), 'utf8');
  const i = ts.indexOf('const contentType = msg.contentType || CONTENT_TYPES.MESSAGE;');
  const fn = ts.slice(i - 1400, i + 1800);
  assert.ok(fn.includes('let lastError = null;'), 'the burn loop must keep the refusal');
  assert.ok(fn.includes('count === 0 && lastError'), 'and return it when nothing copied');
});

check('the player is told what a blank holds before they pick it', () => {
  assert.ok(ENC.includes('capacityOf(t).label'), 'the source cards must advertise it');
  assert.ok(ENC.includes("['Holds',"), 'and the artifact card must list it');
});

check('the GM can set it per tier', () => {
  const cfgApp = fs.readFileSync(path.join(ROOT, 'scripts/ui/ShardEncoder/EncoderConfigApp.js'), 'utf8');
  assert.ok(cfgApp.includes('.capacity`, t.capacity'), 'no capacity field on the tier card');
  assert.ok(cfgApp.includes("'0 = no limit'"), 'and it must say what 0 does');
});

// ═══════════════════════════════════════════════════════════════════════════
section('several files on one chip');

check('the hardest file sets the floor', () => {
  // chatlog 13 · document 15 · dossier 18
  const one = M.contentStackDV(cfg, { types: ['chatlog'], craft: 'Forgery' });
  assert.equal(one.dv, 13);
  const mixed = M.contentStackDV(cfg, { types: ['chatlog', 'dossier'], craft: 'Forgery' });
  assert.equal(mixed.hardest, 'dossier', 'the worst offender sets the base');
  assert.equal(mixed.base, 18);
});

check('every file past the first adds the crowding penalty', () => {
  const per = M.ENCODER_DEFAULTS.content.extraEntryDV;
  const two = M.contentStackDV(cfg, { types: ['document', 'document'], craft: 'Forgery' });
  assert.equal(two.extra, per);
  assert.equal(two.dv, 15 + per);
  const four = M.contentStackDV(cfg, { types: ['document', 'document', 'document', 'document'], craft: 'Forgery' });
  assert.equal(four.extra, per * 3, 'it is per EXTRA file, not per file');
});

check('the GM can switch the escalation off', () => {
  const flat = M.resolveEncoderConfig({ content: { extraEntryDV: 0 } });
  const many = M.contentStackDV(flat, { types: ['document', 'dossier', 'chatlog'], craft: 'Forgery' });
  assert.equal(many.extra, 0);
  assert.equal(many.dv, 18, 'with no penalty it is just the hardest file');
});

check('the craft penalty is paid once, not once per file', () => {
  const alt = M.contentStackDV(cfg, { types: ['document', 'document'], craft: 'Library Search' });
  const straight = M.contentStackDV(cfg, { types: ['document', 'document'], craft: 'Forgery' });
  assert.equal(alt.dv - straight.dv, 3, 'the alt-skill penalty must not multiply with the file count');
});

check('a chip of no-roll files still needs no roll', () => {
  const easy = M.contentStackDV(cfg, { types: ['note', 'message', 'eddies'], craft: '' });
  assert.equal(easy.dv, 0, 'nothing on it is a forgery, so there is nothing to roll');
  assert.equal(easy.count, 3, 'though it still counts what is on the chip');
});

check('one forged file makes the whole chip a forgery', () => {
  const mixed = M.contentStackDV(cfg, { types: ['note', 'dossier'], craft: 'Forgery' });
  assert.ok(mixed.dv >= 18, 'a note beside a forged dossier does not make it easier');
  assert.ok(ENC.includes("return this._stackTypes().some((t) => this.cfg.types?.[t]?.skill);"),
    '_needsRoll must look at every file, not the selected one');
});

check('capacity is what stops you adding more', () => {
  assert.ok(ENC.includes('_room()'), 'there must be a room check');
  const i = ENC.indexOf('_room() {');
  const fn = ENC.slice(i, i + 260);
  assert.ok(fn.includes('capacityOf(this._blank().tier)'), 'room comes from the blank tier');
  assert.ok(fn.includes('return Infinity'), 'and 0 means no limit');
  assert.ok(ENC.includes("if (this._room() <= 0) { ui.notifications?.warn('NCM | That chip is full.'); return; }"),
    'adding past the limit must be refused with a reason');
});

check('every file is written, and each carries the same quality', () => {
  const i = ENC.indexOf('_buildContentEntry(eff) {');
  const fn = ENC.slice(i, i + 900);
  assert.ok(fn.includes('return this._entries().map('), 'all of them must be built');
  assert.ok(fn.includes('forgeQuality: eff.quality'), 'one roll, one quality, across the chip');
  assert.ok(ENC.includes('for (const entry of list)'), 'and the GM path must write each one');
});

check('the relay accepts a list of entries', () => {
  const sock = fs.readFileSync(path.join(ROOT, 'scripts/integrations/SocketHandlers.js'), 'utf8');
  assert.ok(sock.includes('Array.isArray(entryData) ? entryData : [entryData]'),
    'a player sending several files must not lose all but one');
});

check('"write another file" can actually REACH the editor', () => {
  // The button asks what the next file is, and picking the type opens the editor.
  // Without the second half the only way in was the pencil — which EDITS, so every
  // "new" file landed on top of the last one.
  assert.ok(ENC.includes('S.adding = true;'), 'adding another file must be an explicit intent');
  const i = ENC.indexOf("case 'type': {");
  const fn = ENC.slice(i, i + 700);
  assert.ok(fn.includes('const adding = S.adding;'), 'the type pick must read that intent');
  assert.ok(fn.includes('if (adding) return void this._openEditor();'), 'and then open the editor');
  assert.ok(ENC.includes("if (!['type', 'addwrite', 'addentry', 'dec'].includes(act)) S.adding = false;"),
    'an unrelated click must drop the intent, or a later type pick surprises the player');
});

check('a file lands in the slot the composer OPENED on', () => {
  const i = ENC.indexOf('async _openEditor() {');
  const fn = ENC.slice(i, i + 1600);
  assert.ok(fn.includes('const slot = this.S.editIndex;'), 'the slot is captured at open time');
  assert.ok(fn.includes('if (slot >= 0 && this.S.entries[slot]) this.S.entries[slot] = entry;'),
    'a reopened file is replaced');
  assert.ok(fn.includes('else this.S.entries.push(entry);'), 'and a new one is added, never replacing');
  assert.ok(!fn.includes('this.S.editIndex >= 0 ? this.S.entries[this.S.editIndex]'),
    'reading the live index at SAVE time let a second composer overwrite another file');
  assert.ok(fn.includes("ui.notifications?.warn('NCM | Finish the file you are writing first.');"),
    'the composer owns one window id, so two at once must be refused');
});

check('the startup wears the chip the player designed', () => {
  const i = ENC.indexOf('_bootConfig(base = {}) {');
  const fn = ENC.slice(i, i + 1200);
  assert.ok(fn.includes("out.iconMode = 'image'; out.imageUrl = art"), 'the art must drive the boot icon');
  assert.ok(fn.includes("else if (!out.faIcon)"), 'and a glyph must still be there if there is no art');
});

check('Copy to Items sits with Configure, not in the danger row', () => {
  const tpl = fs.readFileSync(path.join(ROOT, 'templates/admin-panel/tab-shards.hbs'), 'utf8');
  const card = tpl.indexOf('ncm-shard-authoring');
  const btn = tpl.indexOf('data-action="archiveShards"');
  const cfgBtn = tpl.indexOf('data-action="openEncoderConfig"');
  assert.ok(btn > card && btn < cfgBtn + 400, 'it belongs on the Player Authoring card');
  assert.ok(!tpl.slice(tpl.indexOf('ncm-shard-quick-actions')).includes('archiveShards'),
    'and not in Quick Actions any more');
});

// ═══════════════════════════════════════════════════════════════════════════
section('accessibility (utils/legibility.js)');

const L = await imp('scripts/utils/legibility.js');

check('prefs normalise and clamp to the slider ranges', () => {
  const p = L.normalizeLegibility({ textScale: 999, contrast: 10, motion: 'disco', density: 'huge', outlines: 'yes' });
  assert.equal(p.textScale, L.LEGIBILITY_RANGES.textScale.max);
  assert.equal(p.contrast, L.LEGIBILITY_RANGES.contrast.min);
  assert.equal(p.motion, 'full', 'an unknown motion value falls back');
  assert.equal(p.density, 'compact');
  assert.equal(p.outlines, true, 'truthy becomes a real boolean');
});

check('empty prefs are the defaults', () => {
  assert.deepEqual(L.normalizeLegibility({}), L.LEGIBILITY_DEFAULTS);
});

check('motion can only be LOWERED, never raised', () => {
  globalThis.matchMedia = () => ({ matches: true });   // the OS says reduce
  assert.equal(L.effectiveMotion({ motion: 'full' }), 'off', 'the OS setting wins');
  globalThis.matchMedia = () => ({ matches: false });
  assert.equal(L.effectiveMotion({ motion: 'full' }, { animationsEnabled: false }), 'off', 'the module pref wins too');
  assert.equal(L.effectiveMotion({ motion: 'calm' }, { animationsEnabled: true }), 'calm', 'otherwise the choice stands');
  delete globalThis.matchMedia;
});

check('every preset is a valid prefs patch', () => {
  for (const [key, preset] of Object.entries(L.LEGIBILITY_PRESETS)) {
    assert.ok(preset.label && preset.icon, `${key} needs a label + icon`);
    const merged = L.normalizeLegibility({ ...L.LEGIBILITY_DEFAULTS, ...preset.prefs });
    assert.ok(merged.textScale >= L.LEGIBILITY_RANGES.textScale.min, `${key} text size`);
    assert.ok(merged.contrast <= L.LEGIBILITY_RANGES.contrast.max, `${key} contrast`);
  }
});

check('the maximum preset actually changes everything it claims to', () => {
  const max = L.normalizeLegibility({ ...L.LEGIBILITY_DEFAULTS, ...L.LEGIBILITY_PRESETS.max.prefs });
  assert.ok(max.textScale > 100 && max.contrast > 100);
  assert.equal(max.motion, 'off');
  assert.equal(max.density, 'roomy');
  assert.ok(max.outlines && max.plainFont && max.details);
});

check('applyLegibility stamps every attribute the stylesheet reads', () => {
  const el = { style: { props: {}, setProperty(k, v) { this.props[k] = v; }, removeProperty(k) { delete this.props[k]; } }, dataset: {} };
  globalThis.matchMedia = () => ({ matches: false });
  globalThis.document = { documentElement: {} };
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
  const p = L.applyLegibility(el, { textScale: 130, contrast: 100, motion: 'calm', density: 'roomy', outlines: true, plainFont: true });
  assert.equal(el.style.props['--ncm-lg-text'], '1.3', 'the text multiplier is a ratio');
  assert.equal(el.dataset.lgMotion, 'calm');
  assert.equal(el.dataset.lgDensity, 'roomy');
  assert.equal(el.dataset.lgOutlines, 'true');
  assert.equal(el.dataset.lgFont, 'plain');
  assert.equal(p.textScale, 130);
  delete globalThis.matchMedia; delete globalThis.document; delete globalThis.getComputedStyle;
});

check('contrast at 100% leaves the palette alone (no inline overrides)', () => {
  const el = { style: { props: {}, setProperty(k, v) { this.props[k] = v; }, removeProperty(k) { delete this.props[k]; } }, dataset: {} };
  globalThis.matchMedia = () => ({ matches: false });
  globalThis.document = { documentElement: {} };
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
  L.applyLegibility(el, { ...L.LEGIBILITY_DEFAULTS });
  const colourVars = Object.keys(el.style.props).filter((k) => k.startsWith('--ncm-') && k !== '--ncm-lg-text');
  assert.equal(colourVars.length, 0, `100% contrast wrote ${colourVars.join(', ')}`);
  delete globalThis.matchMedia; delete globalThis.document; delete globalThis.getComputedStyle;
});

// ═══════════════════════════════════════════════════════════════════════════
section('wiring the window cannot get wrong');

check('the CSS defines every legibility attribute the module stamps', () => {
  const css = fs.readFileSync(path.join(ROOT, 'styles/components/shard-encoder.css'), 'utf8');
  for (const attr of ['data-lg-motion="off"', 'data-lg-motion="calm"', 'data-lg-density="roomy"',
    'data-lg-outlines="true"', 'data-lg-font="plain"', '--ncm-lg-text']) {
    assert.ok(css.includes(attr), `shard-encoder.css never reads ${attr}`);
  }
});

check('the Encoder composes the player text scale instead of replacing it', () => {
  const css = fs.readFileSync(path.join(ROOT, 'styles/components/shard-encoder.css'), 'utf8');
  assert.ok(/--ncm-text-scale:\s*calc\(var\(--ncm-text-scale-base[^)]*\)\s*\*\s*var\(--ncm-lg-text/.test(css),
    'the Agent text size must multiply the window multiplier');
});

check('the Encoder stylesheet is imported AFTER the Workshop it borrows from', () => {
  const idx = fs.readFileSync(path.join(ROOT, 'styles/night-city-messenger.css'), 'utf8');
  const w = idx.indexOf('malware-workshop.css'), e = idx.indexOf('shard-encoder.css');
  assert.ok(w !== -1 && e !== -1, 'both stylesheets must be imported');
  assert.ok(e > w, 'shard-encoder.css must come after malware-workshop.css');
});

check('both templates are registered in TEMPLATES (or the partial 404s)', () => {
  const c = fs.readFileSync(path.join(ROOT, 'scripts/utils/constants.js'), 'utf8');
  assert.ok(c.includes('SHARD_ENCODER:'), 'TEMPLATES.SHARD_ENCODER missing');
  assert.ok(c.includes('ENCODER_CONFIG:'), 'TEMPLATES.ENCODER_CONFIG missing');
  for (const f of ['templates/shard-encoder/shard-encoder.hbs', 'templates/shard-encoder/encoder-config.hbs']) {
    assert.ok(fs.existsSync(path.join(ROOT, f)), `${f} does not exist`);
  }
});

check('the class prefix does not collide with another stylesheet', () => {
  const dir = path.join(ROOT, 'styles');
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  const offenders = walk(dir)
    .filter((f) => f.endsWith('.css') && !f.endsWith('shard-encoder.css') && !f.endsWith('encoder-config.css'))
    .filter((f) => /\.ncm-enc-(?!rypt)/.test(fs.readFileSync(f, 'utf8')));
  assert.equal(offenders.length, 0, `.ncm-enc-* also styled in: ${offenders.join(', ')}`);
});

check('the player Encoder is NOT admin-themed, and the GM config IS', () => {
  const enc = fs.readFileSync(path.join(ROOT, 'scripts/ui/ShardEncoder/ShardEncoderApp.js'), 'utf8');
  const cfgSrc = fs.readFileSync(path.join(ROOT, 'scripts/ui/ShardEncoder/EncoderConfigApp.js'), 'utf8');
  assert.ok(!/static ADMIN_THEMED\s*=\s*true/.test(enc), 'the player window must stay on the player theme');
  assert.ok(/static ADMIN_THEMED\s*=\s*true/.test(cfgSrc), 'the GM window must follow the admin theme');
});

check('the player window borrows the Workshop frame class', () => {
  const enc = fs.readFileSync(path.join(ROOT, 'scripts/ui/ShardEncoder/ShardEncoderApp.js'), 'utf8');
  assert.ok(/classes:\s*\['ncm-app',\s*'ncm-malware-workshop',\s*'ncm-shard-encoder'\]/.test(enc),
    'without ncm-malware-workshop the rails/core/chips have no rules');
});

check('a player write goes through the GM relay, guarded first', () => {
  const enc = fs.readFileSync(path.join(ROOT, 'scripts/ui/ShardEncoder/ShardEncoderApp.js'), 'utf8');
  assert.ok(enc.includes('SHARD_CONVERT_REQUEST'), 'the player path must relay');
  const guard = enc.indexOf('_canPersist()');
  const roll = enc.indexOf('performCheck');
  assert.ok(guard !== -1 && guard < roll, 'the no-GM guard must run BEFORE the roll');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
