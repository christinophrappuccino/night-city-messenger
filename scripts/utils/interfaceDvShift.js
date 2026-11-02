/**
 * Moving saved Interface DVs onto the NET scale (pure: no Foundry globals; sim dev/tools/sims/test-interface-shift.mjs).
 * @file scripts/utils/interfaceDvShift.js
 * @module night-city-messenger
 *
 * 2.1 rolls Interface as rank + d10, the rulebook's way, where it used to add TECH. A DV a GM set for the old roll is
 * now far too hard, so the upgrade offers to lower those DVs by a chosen amount (MigrationRunner v3). This module finds
 * them. Only a DV that Interface alone rolls against moves: a lock shared with other skills gets a per-skill DV instead
 * (bypassSkillDCs / skillDCs), because a Forgery roll still adds its stat. Message encryption has no per-skill DV and is
 * shared with other skills, so it is left alone.
 */

const isInterface = (s) => String(s ?? '').toLowerCase().replace(/[\s_/\\&.-]+/g, '') === 'interface';
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** [skill field, DV field(s)]: a blank skill field means Interface, which is what these rolls default to. */
const PAIRS = Object.freeze([
  ['uploadSkill', ['uploadDV']], ['deploySkill', ['deployDV']], ['executeSkill', ['executeDV']],
  ['siphonSkill', ['siphonDV']], ['crackSkill', ['crackDV']], ['unlockSkill', ['unlockDV']],
  ['declassifySkill', ['declassifyDV']], ['claimSkill', ['claimDV']], ['faceUnlockSkill', ['faceUnlockDV']],
  ['sniffSkill', ['sniffDV']], ['camSkill', ['loopDV', 'cutDV', 'controlDV']],
  ['encryptionSkill', ['encryptionDV']], ['gateSkill', ['gateDV']],
]);

/** Lower a number by n, down to a floor. @returns the new value, or the old one when it was not a number. */
function lower(v, n, floor) {
  const x = Number(v);
  if (!Number.isFinite(x) || x <= 0) return v;
  return Math.max(Math.min(floor, x), x - n);
}

function shiftBypass(o, n, floor) {
  const list = o.bypassSkills;
  if (!list.some(isInterface)) return 0;
  const key = list.find(isInterface);
  const own = o.bypassSkillDCs?.[key];
  if (list.length === 1) {
    let c = 0;
    if (Number(o.bypassDC) > 0) { o.bypassDC = lower(o.bypassDC, n, floor); c = 1; }
    if (Number(own) > 0) { o.bypassSkillDCs[key] = lower(own, n, floor); c = 1; }
    return c;
  }
  o.bypassSkillDCs = { ...(o.bypassSkillDCs || {}), [key]: lower(own ?? o.bypassDC ?? 15, n, floor) };
  return 1;
}

function shiftShardLock(o, n, floor) {
  const list = o.allowedSkills;
  if (!list.some(isInterface)) return 0;
  const key = list.find(isInterface);
  const own = o.skillDCs?.[key];
  if (list.length === 1 && own === undefined) {
    if (!(Number(o.encryptionDC) > 0)) return 0;
    o.encryptionDC = lower(o.encryptionDC, n, floor);
    return 1;
  }
  o.skillDCs = { ...(o.skillDCs || {}), [key]: lower(own ?? o.encryptionDC ?? 15, n, floor) };
  return 1;
}

/**
 * Lower every Interface DV inside a saved object, in place.
 * @param {*} node a terminal / shard config, an entry's contentData, a network, a contact, a program…
 * @param {number} n how far
 * @param {{floor?:number}} [o] never below this (a DV already under it stays where it is)
 * @returns {number} how many DVs moved
 */
export function shiftInterfaceDvs(node, n, { floor = 3 } = {}) {
  if (Array.isArray(node)) return node.reduce((c, x) => c + shiftInterfaceDvs(x, n, { floor }), 0);
  if (!isObj(node)) return 0;
  let c = 0;
  if (Array.isArray(node.bypassSkills)) c += shiftBypass(node, n, floor);
  if (Array.isArray(node.allowedSkills) && 'encryptionDC' in node) c += shiftShardLock(node, n, floor);
  for (const [sk, dvs] of PAIRS) {
    if (node[sk] && !isInterface(node[sk])) continue;
    for (const dv of dvs) {
      if (Number(node[dv]) > 0) { node[dv] = lower(node[dv], n, floor); c += 1; }
    }
  }
  // a { skill, dv } row (an exfil action, a combat profile)
  if (isInterface(node.skill) && Number(node.dv) > 0) { node.dv = lower(node.dv, n, floor); c += 1; }
  for (const [k, v] of Object.entries(node)) {
    if (k === 'bypassSkillDCs' || k === 'skillDCs') continue;
    if (v && typeof v === 'object') c += shiftInterfaceDvs(v, n, { floor });
  }
  return c;
}

/** The saved Jacking in rules: every DV is an Interface roll unless the GM changed the skill. */
export function shiftJackRules(stored, n, { floor = 3 } = {}) {
  if (!isObj(stored) || (stored.skill && !isInterface(stored.skill))) return 0;
  let c = 0;
  if (Number(stored.dv) > 0) { stored.dv = lower(stored.dv, n, floor); c += 1; }
  for (const a of Object.values(stored.actions || {})) {
    if (Number(a?.dv) > 0) { a.dv = lower(a.dv, n, floor); c += 1; }
  }
  return c;
}

/** The old defaults a saved card carried wholesale: move them to the new ones, leave anything the GM really chose. */
const OLD_MOVES = '1:2,3:3,6:4,9:5';
export function refreshJackDials(stored) {
  if (!isObj(stored?.dials)) return false;
  const d = stored.dials;
  let changed = false;
  if (d.edge === true) { d.edge = false; changed = true; }
  if (d.movesMargin === 5) { d.movesMargin = 0; changed = true; }
  const sig = (d.movesTable || []).map((r) => `${r.rank}:${r.moves}`).join(',');
  if (sig === OLD_MOVES) { d.movesTable = [{ rank: 1, moves: 2 }, { rank: 4, moves: 3 }, { rank: 7, moves: 4 }, { rank: 10, moves: 5 }]; changed = true; }
  return changed;
}
