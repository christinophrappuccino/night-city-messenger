/**
 * Rolls — the ONE rule for "did that beat the DV", and the ONE odds calculation (pure: no Foundry globals).
 * @file scripts/utils/rolls.js
 * @module night-city-messenger
 *
 * Cyberpunk RED: a Check has to go OVER the DV, and in a tie the defender wins. Every comparison of a roll to a DV in
 * the module goes through beatsDV(); nothing writes `total >= dv` by hand (test-rolls.mjs greps for it).
 *
 * The die is the module's real one (SkillService._rollD10WithCritFumble): 2–9 stand, a 10 explodes (add another d10,
 * again on a 10), a 1 subtracts a d10. d10Odds() is exact for that die, so a "100%" means certain and a "0%" means
 * impossible; a roll that is merely unlikely says 1%, one that is merely likely says 99%.
 */

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** Did this total beat that DV? A tie does not. */
export const beatsDV = (total, dv) => num(total) > num(dv);

/** P(an exploding d10 run is at least r): the bonus rolled after a natural 10. */
function explodeAtLeast(r, depth = 0) {
  if (r <= 1) return 1;
  if (depth > 12) return 0;
  let p = 0;
  for (let d = 1; d <= 9; d += 1) if (d >= r) p += 0.1;
  return p + 0.1 * explodeAtLeast(r - 10, depth + 1);
}

/** P(the processed d10 is at least t). */
export function dieAtLeast(t) {
  let p = 0;
  for (let f = 2; f <= 9; f += 1) if (f >= t) p += 0.1;
  p += 0.1 * explodeAtLeast(t - 10);                                     // natural 10: 10 + the run
  let low = 0;
  for (let d = 1; d <= 10; d += 1) if (1 - d >= t) low += 1;
  p += 0.1 * (low / 10);                                                 // natural 1: 1 − d10
  return p;
}

/**
 * The chance that base + the die beats the DV.
 * @param {number} base everything but the die (stat + rank + luck + modifier)
 * @param {number} dv
 * @returns {{pct:number, need:number}} pct 0–100 (never rounded onto 0 or 100 unless it truly is); need = the die must
 *   show at least this to win.
 */
export function d10Odds(base, dv) {
  const need = Math.round(num(dv)) - Math.round(num(base)) + 1;
  const raw = dieAtLeast(need);
  const p = raw > 0.999999 ? 1 : raw;   // the tenths above do not sum to exactly 1
  let pct = Math.round(p * 100);
  if (p > 0 && pct === 0) pct = 1;
  if (p < 1 && pct === 100) pct = 99;
  return { pct, need };
}

/** likely / maybe / long shot / impossible. */
export function oddsWord(pct) {
  if (pct <= 0) return 'cannot beat it';
  if (pct < 35) return 'long shot';
  if (pct < 65) return 'even';
  if (pct < 100) return 'likely';
  return 'certain';
}

/** The parts of a roll as they are added up: [{label, value}]. A role ability in rank mode has no stat part. */
export function rollParts({ statName, statValue, skillName, skillLevel, luck = 0, modifier = 0 } = {}) {
  const out = [];
  if (statName && statName !== 'none') out.push({ label: String(statName).toUpperCase(), value: num(statValue) });
  out.push({ label: skillName || 'Skill', value: num(skillLevel) });
  if (num(luck)) out.push({ label: 'Luck', value: num(luck) });
  if (num(modifier)) out.push({ label: 'Modifier', value: num(modifier) });
  return out;
}

/** "TECH 7 + Interface 5 + d10" — the one way a formula is written. */
export function formulaText(parts) {
  return `${parts.map((p) => `${p.label} ${p.value}`).join(' + ').replace(/\+ (\S+( \S+)*) -/g, '− $1 ')} + d10`;
}
