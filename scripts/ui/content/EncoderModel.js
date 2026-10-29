/**
 * Encoder Model — the Shard Encoder's rules, as pure functions.
 * @file scripts/ui/content/EncoderModel.js
 * @module night-city-messenger
 * @description Everything the player-facing Shard Encoder decides with a number lives
 *   here, with NO Foundry globals, so it is sim-testable (dev/tools/sims/test-encoder-model.mjs)
 *   and so the GM card, the Encoder window and the tests can never disagree.
 *
 *   The shape of the GM's knobs is `ENCODER_DEFAULTS` — the world setting `encoderConfig`
 *   stores only what the GM changed, and `resolveEncoderConfig(stored)` layers it over the
 *   defaults (arrays replace, objects merge), so a new default added in a later version
 *   reaches existing worlds without a migration.
 *
 *   The ENCODE roll is the upload arc's three-rung LADDER, not pass/fail:
 *     margin >= 0 → clean · -1…-band → sloppy (it lands, with a tell) · worse → rejected.
 *   `SLOPPY_BAND` mirrors `FORGE_SLOPPY_BAND` in UploadFlow.js (the sim asserts they match).
 */

/** Mirrors UploadFlow.FORGE_SLOPPY_BAND — one ladder for the whole module. */
export const SLOPPY_BAND = 4;

/** What a botched encode can do to the blank it was written on. */
export const BOTCH_RULES = Object.freeze({
  'survives':      { label: 'Survives · wiped',  short: 'survives · wiped', bricks: false, trace: false },
  'bricked':       { label: 'Bricked',           short: 'bricked',          bricks: true,  trace: false },
  'bricked-trace': { label: 'Bricked + trace',   short: 'bricked + trace',  bricks: true,  trace: true  },
});

/** Perks a blank tier can carry. `craft` is a flat bonus to the encode roll. */
export const TIER_PERKS = Object.freeze({
  '':        { label: '—',              craft: 0 },
  'craft+1': { label: '+1 craft roll',  craft: 1 },
  'craft+2': { label: '+2 craft roll',  craft: 2 },
});

/** How a player may price what they made. */
export const PRICING_MODES = Object.freeze({
  off:     'Off — players never price shards',
  propose: 'Propose — the GM approves, counters or denies',
  free:    'Free — the player sets it outright',
  formula: 'Formula — priced automatically',
});

/** The three program families the Program branch offers. */
export const PROGRAM_FAMILIES = Object.freeze({
  utility: { label: 'Utility', type: 'payload', hint: 'runs against a host you are logged into' },
  execute: { label: 'Execute', type: 'malware', hint: 'installs a resident that fires on a trigger' },
});

/**
 * Which abilities belong to which family. Keys are PROGRAM_EFFECTS keys. Deliberately
 * absent: wipe / corrupt (they need target files picked at PUSH time, which a program
 * built on a blank cannot know) and logicBomb (its inner effect has no authoring path) —
 * a dead option is worse than no option.
 */
export const FAMILY_ABILITIES = Object.freeze({
  utility: ['scanner', 'skeletonKey', 'jammer', 'icebreaker'],
  execute: ['keylog', 'forgeAccount', 'deployICE'],
});

/** Content types whose tile routes to the Program branch instead of an editor. */
export const PROGRAM_TYPES = Object.freeze(['payload', 'malware']);

/**
 * WHO may encode. Byte-for-byte the shape of `DEFAULTS.OPERATOR_GATE`, so the very
 * same evaluator (`canOperate` in helpers.js) answers both questions and there is no
 * second gating dialect to learn or to get subtly wrong.
 *
 * It is a SEPARATE gate object from the terminal operator gate on purpose: "anyone
 * may operate a terminal, but only a Tech may forge a shard" is a sentence a GM should
 * be able to write. `canEncode` therefore evaluates this STANDALONE — it must never
 * inherit fields from the operator gate (see the `base` option on `canOperate`).
 *
 * `mode: 'anyone'` is the default, so switching player authoring on does not silently
 * restrict anybody; and a gate that is 'gated' with nothing configured stays inert
 * rather than locking the table out.
 */
export const GATE_DEFAULT = Object.freeze({
  mode: 'anyone',                // 'anyone' | 'gated'
  logic: 'any',                  // combine role/skill/gear: 'any' | 'all'
  roles: [],                     // CPR role names (substring match)
  roleLogic: 'any',
  skill: Object.freeze({ name: '', min: 0 }),   // legacy single skill, folded into `skills`
  skills: [],                    // [{name, min}] — any one qualifies
  itemGroups: [],                // OR-of-AND gear groups
  actors: [],                    // explicit actor-id allowlist (always passes)
  allowGM: true,
});

/** The GM's knobs, with the defaults the dev locked on 2026-09-12. */
export const ENCODER_DEFAULTS = Object.freeze({
  enabled: false,                       // player authoring is opt-in, like the floor setting it replaces
  gate: GATE_DEFAULT,                   // WHO may encode — see GATE_DEFAULT
  pricing: 'propose',
  // The LOCK stage. A roll here sets a CEILING, never pass/fail — this is the
  // ceiling table the old ShardConversionFlow used, now a GM-tunable setting.
  // Each rung: from this roll total, you may set a DV up to `dv`, and the listed
  // affordances unlock. `blackIce` is a separate GM veto on top.
  lock: {
    allowed: true, blackIce: true,
    skill: 'Cryptography',                 // rolls the encryption ceiling
    gateSkill: 'Electronics/Security Tech', // rolls the hardware gates (key item / damage)
    ceilings: [
      { at: 0,  dv: 10, ice: false, failure: false, keyItem: false, label: 'Trivial' },
      { at: 10, dv: 15, ice: false, failure: true,  keyItem: false, label: 'Easy' },
      { at: 15, dv: 18, ice: true,  failure: true,  keyItem: false, label: 'Moderate' },
      { at: 20, dv: 22, ice: true,  failure: true,  keyItem: true,  label: 'Hard' },
      { at: 25, dv: 25, ice: true,  failure: true,  keyItem: true,  label: 'Very hard' },
    ],
  },
  reencode: { allowed: true, dv: 2 },   // re-encode a sloppy shard
  copy: { allowed: true, dv: 3 },       // copy a clean shard
  // What dress a player may put on a shard. Both are LOOK only — a preset's
  // security never travels with its palette, and a saved look carries no
  // security block at all — so neither can hand a player an armed shard.
  look: { presets: true, savedThemes: true, custom: true },
  audit: true,                          // PLAYER-MADE badge + a Security Activity Log row
  // Writing a second file onto one chip is harder than writing the first: the
  // forgeries have to agree with each other. Each file past the first adds this
  // to the encode DV. 0 turns the escalation off.
  content: { extraEntryDV: 2 },
  /**
   * Extra rules the GM can layer on the encode roll. All off by default — the
   * Encoder without them is one roll per stage, which is the version a table can
   * learn in a minute.
   *
   * These used to be four bare booleans that NOTHING read. `signature` is gone
   * (2026-09-22, dev: "lets just remove that") rather than left as a dead switch.
   */
  optional: {
    // Carrying the right kit helps. `items` are matched by name, the
    // space/punctuation-insensitive way skills are.
    gear: { on: false, stack: 'best', items: [] },   // items: [{ name, img, bonus }]
    // Encoding costs time on the world clock. Minutes = base + perDV × DV.
    time: { on: false, baseMinutes: 60, perDV: 10, advanceClock: true },
    // A second character lends a hand.
    assist: { on: false, bonus: 1, requireSkill: true },
  },
  // WHAT a player may write on. Any carried item used to qualify, so a player
  // could encode over their pistol or their cyberarm (tester, 2026-10-26).
  // 'gear' (default) = Gear-type items + anything the GM listed in a tier;
  // 'registered' = only listed items (and blanks bought here); 'any' = the old rule.
  blanks: { source: 'gear' },
  // Blank tiers — GM-defined. Exactly one tier is the FALLBACK (anything unlisted).
  tiers: [
    // `capacity` = how many entries the chip holds. 0 means no limit; a better
    // blank simply fits more on it, which is a reason to buy one beyond surviving
    // a botch.
    // `integrity` = shards made on this blank track integrity (they glitch and can
    // be bricked by failed breaches); `hardening` = % less integrity lost per hit.
    { id: 'scrap',    name: 'Scrap',    color: 'muted', price: 0,   buyable: false, fallback: true,  onRejected: 'bricked',  onNat1: 'bricked-trace', perk: '',        capacity: 1, integrity: false, hardening: 0,  items: [] },
    { id: 'standard', name: 'Standard', color: 'cyan',  price: 50,  buyable: true,  fallback: false, onRejected: 'bricked',  onNat1: 'bricked-trace', perk: '',        capacity: 3, integrity: false, hardening: 0,  items: [] },
    { id: 'premium',  name: 'Premium',  color: 'gold',  price: 200, buyable: true,  fallback: false, onRejected: 'survives', onNat1: 'bricked',       perk: 'craft+1', capacity: 8, integrity: false, hardening: 40, items: [] },
  ],
  // Content types — all 18 exist; `on` is the GM's allow-list. skill:'' = no roll.
  types: {
    message:     { on: true,  skill: '',               dv: 0,  alt: '',               altDV: 0 },
    note:        { on: true,  skill: '',               dv: 0,  alt: '',               altDV: 0 },
    eddies:      { on: true,  skill: '',               dv: 0,  alt: '',               altDV: 0 },
    document:    { on: true,  skill: 'Forgery',        dv: 15, alt: 'Library Search', altDV: 3 },
    record:      { on: true,  skill: 'Forgery',        dv: 15, alt: 'Bureaucracy',    altDV: 3 },
    dossier:     { on: true,  skill: 'Forgery',        dv: 18, alt: 'Library Search', altDV: 3 },
    credentials: { on: true,  skill: 'Forgery',        dv: 18, alt: 'Cryptography',   altDV: 2 },
    chatlog:     { on: true,  skill: 'Forgery',        dv: 13, alt: '',               altDV: 0 },
    spreadsheet: { on: true,  skill: 'Accounting',     dv: 13, alt: 'Forgery',        altDV: 2 },
    banking:     { on: true,  skill: 'Accounting',     dv: 18, alt: '',               altDV: 0 },
    gallery:     { on: true,  skill: 'Perception',     dv: 13, alt: '',               altDV: 0 },
    avlog:       { on: true,  skill: 'Perception',     dv: 15, alt: '',               altDV: 0 },
    location:    { on: true,  skill: 'Library Search', dv: 12, alt: '',               altDV: 0 },
    schematic:   { on: false, skill: 'Basic Tech',     dv: 15, alt: '',               altDV: 0 },
    calendar:    { on: false, skill: 'Bureaucracy',    dv: 12, alt: '',               altDV: 0 },
    syslog:      { on: false, skill: 'Interface',      dv: 15, alt: '',               altDV: 0 },
    payload:     { on: true,  skill: 'Interface',      dv: 0,  alt: '',               altDV: 0 },
    malware:     { on: true,  skill: 'Interface',      dv: 0,  alt: '',               altDV: 0 },
  },
  // The Program branch. Rank in `skill` GATES abilities; the craft skill is the player's pick.
  programs: {
    families: { utility: true, execute: true },
    skill: 'Interface',
    alts: [
      { skill: 'Electronics/Security Tech', dv: 3, only: [] },
      { skill: 'Cryptography',              dv: 5, only: ['keylog', 'forgeAccount'] },
    ],
    abilities: {
      scanner:      { dv: 12, rank: 0 },
      skeletonKey:  { dv: 15, rank: 4 },
      jammer:       { dv: 15, rank: 4 },
      icebreaker:   { dv: 18, rank: 7 },
      keylog:       { dv: 15, rank: 4 },
      forgeAccount: { dv: 18, rank: 7 },
      deployICE:    { dv: 18, rank: 7 },
    },
    chargesBase: 1, chargesPer: 3,      // charges = base + floor(rank / per)
    disguiseRank: 4, disguiseDV: 2,     // trojan cover: rank gate + DV penalty
  },
});

/** The `blanks.source` choices, in the order the GM card lists them. */
export const BLANK_SOURCES = Object.freeze({
  gear:       'Gear only — plus anything listed in a tier (recommended)',
  registered: 'Only items listed in a tier, or blanks bought here',
  any:        'Any carried item (weapons, cyberware and armor included)',
});

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function layer(base, over) {
  if (!isObj(over)) return clone(base);
  const out = clone(base);
  for (const [k, v] of Object.entries(over)) {
    if (isObj(v) && isObj(out[k])) out[k] = layer(out[k], v);
    else if (v !== undefined) out[k] = clone(v);      // arrays + scalars REPLACE
  }
  return out;
}

/**
 * Stored setting → the full config the Encoder reads. Guarantees: every default type
 * and ability exists, there is exactly one fallback tier, and every tier has an id.
 */
export function resolveEncoderConfig(stored) {
  const cfg = layer(ENCODER_DEFAULTS, stored);
  if (!Array.isArray(cfg.tiers) || !cfg.tiers.length) cfg.tiers = clone(ENCODER_DEFAULTS.tiers);
  cfg.tiers = cfg.tiers.map((t, i) => ({
    id: String(t.id || `tier${i}`), name: String(t.name || `Tier ${i + 1}`), color: t.color || 'cyan',
    price: Math.max(0, num(t.price)), buyable: !!t.buyable, fallback: !!t.fallback,
    onRejected: BOTCH_RULES[t.onRejected] ? t.onRejected : 'bricked',
    onNat1: BOTCH_RULES[t.onNat1] ? t.onNat1 : 'bricked-trace',
    perk: TIER_PERKS[t.perk] ? t.perk : '',
    capacity: Math.max(0, Math.round(num(t.capacity))),        // 0 = no limit
    integrity: !!t.integrity,
    // An older world's stored tiers have no hardening — they take the default for
    // a tier of the same id, so a Premium blank is hardened without a migration.
    hardening: Math.min(90, Math.max(0, Math.round(num(t.hardening ?? (ENCODER_DEFAULTS.tiers.find((d) => d.id === t.id)?.hardening ?? 0))))),
    items: Array.isArray(t.items) ? t.items.filter((x) => x && x.name).map((x) => ({ name: String(x.name), img: x.img || '' })) : [],
  }));
  const fb = cfg.tiers.findIndex((t) => t.fallback);
  cfg.tiers.forEach((t, i) => { t.fallback = i === (fb === -1 ? 0 : fb); });
  if (!PRICING_MODES[cfg.pricing]) cfg.pricing = 'propose';
  if (!BLANK_SOURCES[cfg.blanks?.source]) cfg.blanks = { ...(cfg.blanks || {}), source: 'gear' };
  cfg.gate = sanitizeGate(cfg.gate);
  cfg.optional = sanitizeOptional(cfg.optional);
  return cfg;
}

/** Space/punctuation-insensitive name key — the SkillService rule, reused. */
const normName2 = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Clean the optional-depth block, and UPGRADE the legacy shape.
 *
 * Until 2026-09-22 each of these was a bare boolean that nothing read. A stored
 * `{gear: true}` must not end up where an object is expected, so a boolean is
 * lifted into `{on: <bool>}` over the defaults. `signature` is dropped on sight —
 * it was removed rather than left as a switch with no rule behind it.
 */
export function sanitizeOptional(stored) {
  const base = ENCODER_DEFAULTS.optional;
  const lift = (v) => (typeof v === 'boolean' ? { on: v } : (isObj(v) ? v : {}));
  const o = {
    gear: layer(base.gear, lift(stored?.gear)),
    time: layer(base.time, lift(stored?.time)),
    assist: layer(base.assist, lift(stored?.assist)),
  };

  o.gear.on = !!o.gear.on;
  o.gear.stack = o.gear.stack === 'sum' ? 'sum' : 'best';
  o.gear.items = (Array.isArray(o.gear.items) ? o.gear.items : [])
    .map((x) => ({ name: String(x?.name ?? ''), img: x?.img || '', bonus: clamp(Math.round(num(x?.bonus, 1)), -5, 10) }))
    .filter((x) => x.name);

  o.time.on = !!o.time.on;
  o.time.advanceClock = o.time.advanceClock !== false;
  o.time.baseMinutes = clamp(Math.round(num(o.time.baseMinutes, 60)), 0, 10080);
  o.time.perDV = clamp(Math.round(num(o.time.perDV, 10)), 0, 600);

  o.assist.on = !!o.assist.on;
  o.assist.requireSkill = o.assist.requireSkill !== false;
  o.assist.bonus = clamp(Math.round(num(o.assist.bonus, 1)), 0, 5);
  return o;
}

/**
 * What the operator's kit is worth on this encode.
 *
 * `best` (the default) takes the single most useful thing they carry — stacking a
 * deck, a kit and a workshop into one unbounded number is how a +9 happens by
 * accident. `sum` is there for a GM who wants exactly that.
 *
 * @param {object} cfg resolved config
 * @param {string[]} carried item names the operator has
 * @returns {{ bonus: number, from: string[] }} the bonus and what earned it
 */
export function gearBonusFor(cfg, carried = []) {
  const g = cfg?.optional?.gear;
  if (!g?.on || !g.items.length) return { bonus: 0, from: [] };
  const have = new Set(carried.map(normName2));
  const hits = g.items.filter((i) => have.has(normName2(i.name)));
  if (!hits.length) return { bonus: 0, from: [] };
  if (g.stack === 'sum') {
    return { bonus: hits.reduce((a, i) => a + i.bonus, 0), from: hits.map((i) => i.name) };
  }
  const best = hits.reduce((a, i) => (i.bonus > a.bonus ? i : a), hits[0]);
  return { bonus: best.bonus, from: [best.name] };
}

/**
 * How long this encode takes, in minutes. Scales with the DV, so a throwaway note
 * is not the same afternoon as a forged corporate dossier.
 */
export function timeCostFor(cfg, dv = 0) {
  const t = cfg?.optional?.time;
  if (!t?.on) return 0;
  return Math.max(0, t.baseMinutes + t.perDV * Math.max(0, num(dv)));
}

/** "1h 20m" / "45m" / "2h". Plain minutes read badly past an hour. */
export function formatMinutes(mins) {
  const m = Math.max(0, Math.round(num(mins)));
  if (!m) return 'no time';
  const h = Math.floor(m / 60), r = m % 60;
  if (!h) return `${r}m`;
  return r ? `${h}h ${r}m` : `${h}h`;
}

/**
 * What a helper is worth. `requireSkill` means they must actually have a rank in
 * the craft skill — someone holding the torch is not the same as someone who
 * knows forgery.
 */
export function assistBonusFor(cfg, { helperRank = 0 } = {}) {
  const a = cfg?.optional?.assist;
  if (!a?.on) return 0;
  if (a.requireSkill && helperRank < 1) return 0;
  return a.bonus;
}

/** A gear/role entry is either a bare name or `{name, img}`. One reader for both. */
export const gateNameOf = (x) => (typeof x === 'string' ? x : String(x?.name ?? ''));

/**
 * Clean a stored gate into the exact shape the evaluator expects. Empty groups and
 * nameless entries are dropped rather than kept as a requirement nothing can satisfy
 * — an unsatisfiable gate reads to the table as "the button is broken".
 */
export function sanitizeGate(stored) {
  const g = layer(GATE_DEFAULT, stored);
  g.mode = g.mode === 'gated' ? 'gated' : 'anyone';
  g.logic = g.logic === 'all' ? 'all' : 'any';
  g.roleLogic = g.roleLogic === 'all' ? 'all' : 'any';
  g.allowGM = g.allowGM !== false;
  g.roles = (Array.isArray(g.roles) ? g.roles : []).map(gateNameOf).filter(Boolean);
  g.actors = (Array.isArray(g.actors) ? g.actors : []).map((a) => String(a || '')).filter(Boolean);
  // Skills are a list now (any one qualifies). A stored single `skill` is
  // folded in so an older gate keeps its rule, then cleared so it is never
  // evaluated twice.
  const cleanSkill = (s) => ({ name: String(s?.name || '').trim(), min: Math.max(0, Math.round(num(s?.min))) });
  let skills = (Array.isArray(g.skills) ? g.skills : []).map(cleanSkill).filter((s) => s.name);
  if (!skills.length && g.skill?.name) skills = [cleanSkill(g.skill)];
  g.skills = skills;
  g.skill = { name: '', min: 0 };
  g.itemGroups = (Array.isArray(g.itemGroups) ? g.itemGroups : [])
    .map((grp) => (Array.isArray(grp) ? grp : [grp])
      .map((x) => ({ name: gateNameOf(x), img: (typeof x === 'string' ? '' : (x?.img || '')) }))
      .filter((x) => x.name))
    .filter((grp) => grp.length);
  return g;
}

/**
 * Is this gate actually restricting anybody? A 'gated' gate with no qualifier set is
 * inert by design (no accidental lockout), and the GM card says so rather than
 * implying a restriction that is not there.
 * @returns {{ gated: boolean, inert: boolean, parts: string[] }}
 */
export function gateSummary(gate) {
  const g = sanitizeGate(gate);
  const parts = [];
  if (g.roles.length) parts.push(g.roles.join(g.roleLogic === 'all' ? ' + ' : ' / '));
  if (g.skills.length) parts.push(g.skills.map((s) => `${s.name} ${s.min}+`).join(' or '));
  if (g.itemGroups.length) parts.push(g.itemGroups.map((grp) => grp.map((i) => i.name).join(' + ')).join(' or '));
  const gated = g.mode === 'gated';
  return { gated, inert: gated && !parts.length && !g.actors.length, parts };
}

const normName = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Which tier a blank belongs to. An explicit tier id stamped on the item wins (a blank
 * BOUGHT through the Encoder carries one); else the GM's item lists by name
 * (space/punctuation-insensitive, the SkillService rule); else the fallback tier.
 */
export function tierForItem(cfg, item) {
  const tiers = cfg?.tiers || [];
  const fallback = tiers.find((t) => t.fallback) || tiers[0] || null;
  if (!item) return fallback;
  if (item.tierId) { const t = tiers.find((x) => x.id === item.tierId); if (t) return t; }
  const n = normName(item.name);
  return tiers.find((t) => !t.fallback && t.items.some((i) => normName(i.name) === n)) || fallback;
}

/**
 * Which carried items a player may write on — the GM's `blanks.source` rule.
 * Items the GM listed in a tier (or a blank bought here, `tierId`) always
 * qualify; 'gear' adds every Gear-type item; 'any' is everything carryable
 * (the caller already filters sheet-only types like skills and roles).
 * @param {object} cfg resolved config
 * @param {{name: string, type?: string, tierId?: string}} item a plain descriptor
 */
export function isEligibleBlank(cfg, item) {
  if (!item) return false;
  const source = cfg?.blanks?.source || 'gear';
  if (source === 'any') return true;
  if (item.tierId) return true;
  const n = normName(item.name);
  const listed = (cfg?.tiers || []).some((t) => (t.items || []).some((i) => normName(i.name) === n));
  if (listed) return true;
  return source === 'gear' && item.type === 'gear';
}

/** What a player is told when they try to write on something the rule excludes. */
export function blankRuleRefusal(cfg) {
  return (cfg?.blanks?.source || 'gear') === 'registered'
    ? 'Only the blanks your GM has listed can be written on. Buy one, or ask your GM.'
    : 'Only gear can be written on — not weapons, armor or cyberware. Use a blank chip or another piece of gear.';
}

/**
 * How many entries a tier's chip holds, and what to call it. 0 means no limit —
 * and an unset capacity resolves to 0, so an older world keeps behaving exactly
 * as it did before tiers could be sized.
 */
export function capacityOf(tier) {
  const n = Math.max(0, Math.round(num(tier?.capacity)));
  return { limit: n, label: n ? `holds ${n}` : 'no limit', unlimited: n === 0 };
}

/**
 * Is there room for another entry? `used` is what the shard already carries.
 * @returns {{ ok: boolean, limit: number, used: number, left: number }}
 */
export function capacityLeft(tier, used = 0) {
  const { limit } = capacityOf(tier);
  const u = Math.max(0, Math.round(num(used)));
  if (!limit) return { ok: true, limit: 0, used: u, left: Infinity };
  return { ok: u < limit, limit, used: u, left: Math.max(0, limit - u) };
}

/** What a botch does to a blank of this tier. `nat1` = the die showed a natural 1. */
export function botchFor(tier, { nat1 = false } = {}) {
  const key = (nat1 ? tier?.onNat1 : tier?.onRejected) || 'bricked';
  return { key, ...(BOTCH_RULES[key] || BOTCH_RULES.bricked) };
}

/** The ladder rung for a roll. */
export function encodeOutcome(total, dv) {
  const margin = num(total) - num(dv);
  if (margin >= 0) return 'clean';
  if (margin >= -SLOPPY_BAND) return 'sloppy';
  return 'rejected';
}

/** Chance of each rung on a d10, as whole percents. `base` = stat + skill + bonuses. */
export function ladderOdds(base, dv) {
  let c = 0, s = 0, r = 0;
  for (let d = 1; d <= 10; d++) {
    const o = encodeOutcome(num(base) + d, dv);
    if (o === 'clean') c++; else if (o === 'sloppy') s++; else r++;
  }
  return { clean: c * 10, sloppy: s * 10, rejected: r * 10, base: num(base), dv: num(dv) };
}

/** The most likely rung + its chance (ties favour the better rung). */
export function likelyRung(odds) {
  if (odds.clean >= odds.sloppy && odds.clean >= odds.rejected) return ['clean', odds.clean];
  if (odds.sloppy >= odds.rejected) return ['sloppy', odds.sloppy];
  return ['rejected', odds.rejected];
}

/** hi / mid / lo — a word, so the odds chip never relies on colour alone. */
export function oddsClass(cleanPct) { return cleanPct >= 60 ? 'hi' : cleanPct >= 30 ? 'mid' : 'lo'; }

/** Abilities a family offers, with the GM's DV + rank gate and whether this rank unlocks it. */
export function programAbilities(cfg, family, rank = 0) {
  const p = cfg?.programs || {};
  if (p.families && p.families[family] === false) return [];
  return (FAMILY_ABILITIES[family] || []).map((key) => {
    const a = p.abilities?.[key] || { dv: 15, rank: 0 };
    return { key, dv: num(a.dv, 15), needRank: num(a.rank), locked: num(rank) < num(a.rank) };
  });
}

/** The craft skills offered for an ability: the recommended one + any alt that applies. */
export function craftChoices(cfg, abilityKey) {
  const p = cfg?.programs || {};
  const out = [{ skill: p.skill || 'Interface', penalty: 0, recommended: true, applies: true }];
  for (const a of p.alts || []) {
    if (!a?.skill) continue;
    const only = Array.isArray(a.only) ? a.only : [];
    out.push({ skill: a.skill, penalty: num(a.dv), recommended: false, applies: !only.length || only.includes(abilityKey) });
  }
  return out;
}

/** The encode DV for a program: ability DV + craft-skill penalty + trojan penalty. */
export function programDV(cfg, { ability, craft, disguised = false }) {
  const p = cfg?.programs || {};
  const base = num(p.abilities?.[ability]?.dv, 15);
  const pen = craftChoices(cfg, ability).find((c) => c.skill === craft)?.penalty ?? 0;
  return base + pen + (disguised ? num(p.disguiseDV, 2) : 0);
}

/** Base charges a rank is worth. */
export function chargesForRank(cfg, rank) {
  const p = cfg?.programs || {};
  return Math.max(1, num(p.chargesBase, 1) + Math.floor(num(rank) / Math.max(1, num(p.chargesPer, 3))));
}

/**
 * What the roll's MARGIN buys — the "efficiency" of the build.
 *   clean  → full charges · stealth DV 12+margin (cap 20) · run DV = encode DV − 2
 *   sloppy → 1 charge · stealth DV 8 (a SWEEP sees it) · run DV = encode DV + 2 · GLITCHY
 *   rejected → nothing compiles
 */
export function programEfficiency(cfg, { total, dv, rank }) {
  const rung = encodeOutcome(total, dv);
  const margin = num(total) - num(dv);
  if (rung === 'rejected') return { rung, margin, charges: 0, stealthDV: 0, runDV: 0, quality: 0, tell: '' };
  if (rung === 'sloppy') return { rung, margin, charges: 1, stealthDV: 8, runDV: num(dv) + 2, quality: clamp(50 + margin * 8, 5, 100), tell: 'GLITCHY' };
  return { rung, margin, charges: chargesForRank(cfg, rank), stealthDV: clamp(12 + margin, 12, 20), runDV: Math.max(6, num(dv) - 2), quality: clamp(50 + margin * 8, 5, 100), tell: '' };
}

/** The forecast range shown BEFORE the roll (best case = a natural 10). */
export function programForecast(cfg, { base, dv, rank }) {
  const best = Math.max(0, num(base) + 10 - num(dv));
  return { charges: chargesForRank(cfg, rank), stealthLo: 12, stealthHi: clamp(12 + best, 12, 20), runDV: Math.max(6, num(dv) - 2) };
}

/**
 * A content type's craft choices: the GM's skill for it, plus the "another way"
 * alternative at its DV penalty. A type with no skill needs no roll at all.
 */
export function contentChoices(cfg, typeKey) {
  const t = cfg?.types?.[typeKey];
  if (!t?.skill) return [];
  const out = [{ skill: t.skill, penalty: 0, recommended: true, applies: true }];
  if (t.alt) out.push({ skill: t.alt, penalty: num(t.altDV), recommended: false, applies: true });
  return out;
}

/** The encode DV for a forged file: the type's DV + the penalty for the skill used. */
export function contentDV(cfg, { type, craft }) {
  const t = cfg?.types?.[type];
  if (!t?.skill) return 0;                       // no roll — a note is a note
  const pen = contentChoices(cfg, type).find((c) => c.skill === craft)?.penalty ?? 0;
  return num(t.dv) + pen;
}

/**
 * What a forgery roll buys. Quality is the same 50-at-the-DV scale the upload arc
 * uses, and the scan DV mirrors UploadFlow.stealthDVFromQuality — so a shard a
 * player forged reads to ANALYZE and SWEEP exactly like one they uploaded.
 * A no-roll type (dv 0) is simply clean: there is nothing to fake.
 */
export function contentEfficiency({ total, dv }) {
  if (!num(dv)) return { rung: 'clean', margin: 0, quality: 100, scanDV: 20, tell: '' };
  const rung = encodeOutcome(total, dv);
  const margin = num(total) - num(dv);
  if (rung === 'rejected') return { rung, margin, quality: 0, scanDV: 0, tell: '' };
  const quality = clamp(Math.round(50 + margin * 8), 5, 100);
  return { rung, margin, quality, scanDV: clamp(Math.round(6 + quality / 8), 8, 20), tell: rung === 'sloppy' ? 'FORGED' : '' };
}

/** The forgery forecast shown BEFORE the roll (best case = a natural 10). */
export function contentForecast(cfg, { base, dv }) {
  if (!num(dv)) return { qualityLo: 100, qualityHi: 100, scanLo: 20, scanHi: 20, noRoll: true };
  const best = contentEfficiency({ total: num(base) + 10, dv });
  const worst = contentEfficiency({ total: num(dv), dv });
  return { qualityLo: worst.quality, qualityHi: best.quality, scanLo: worst.scanDV, scanHi: best.scanDV, noRoll: false };
}

/** Failure modes a player may wire into a lock, in order of nastiness. */
export const LOCK_FAILURES = Object.freeze({
  nothing: { label: 'Nothing', hint: 'a wrong answer just fails', needsRung: false },
  lockout: { label: 'Lock them out', hint: 'three tries, then it seals for an hour', needsRung: false },
  damage:  { label: 'Bite back', hint: 'the ICE hurts whoever forces it', needsRung: true },
});

/**
 * What a lock roll BUYS. This is a ceiling, not a check: a low roll still locks the
 * shard, it just cannot lock it hard. Returns the highest rung the total reaches.
 */
export function lockCeiling(cfg, total) {
  const rungs = cfg?.lock?.ceilings || ENCODER_DEFAULTS.lock.ceilings;
  const t = num(total);
  let best = rungs[0];
  for (const r of rungs) if (t >= num(r.at)) best = r;
  return { ...best, maxDV: num(best.dv) };
}

/**
 * The whole lock state resolved: what this operator may set, given the two optional
 * rolls. Nothing rolled = the floor rung, which is deliberately still usable — a
 * player who never rolls can still put a password on a chip.
 */
export function lockOptions(cfg, { cryptoTotal = null, gateTotal = null } = {}) {
  const enc = lockCeiling(cfg, cryptoTotal ?? 0);
  const gate = lockCeiling(cfg, gateTotal ?? 0);
  return {
    rolled: cryptoTotal !== null,
    gateRolled: gateTotal !== null,
    maxDV: enc.maxDV,
    rungLabel: enc.label,
    canBlackIce: !!enc.ice && cfg?.lock?.blackIce !== false,
    canKeyItem: !!gate.keyItem,
    canDamage: !!gate.failure,
    // Every DV the ceiling allows, as pickable steps.
    dvChoices: (cfg?.lock?.ceilings || ENCODER_DEFAULTS.lock.ceilings)
      .map((r) => num(r.dv)).filter((dv, i, a) => dv <= enc.maxDV && a.indexOf(dv) === i),
  };
}

/** Is there anything on this lock at all? An untouched lock leaves the shard open. */
export function lockIsSet(lock) {
  return !!(lock && (lock.password || lock.encrypted || lock.keyItem));
}

/**
 * The DV for a chip carrying SEVERAL files. The hardest file sets the floor —
 * you are only as good as the fake that takes the most work — and every file
 * past the first adds the GM's crowding penalty on top.
 * @param {object} cfg
 * @param {object} o
 * @param {string[]} o.types   the content types on the chip, in order
 * @param {string} [o.craft]   the skill being used (its penalty applies once)
 * @returns {{dv:number, base:number, hardest:string, extra:number, count:number}}
 */
export function contentStackDV(cfg, { types = [], craft = '' } = {}) {
  const rolled = types.filter((t) => cfg?.types?.[t]?.skill);
  if (!rolled.length) return { dv: 0, base: 0, hardest: '', extra: 0, count: types.length };

  let hardest = rolled[0];
  for (const t of rolled) if (num(cfg.types[t].dv) > num(cfg.types[hardest].dv)) hardest = t;

  const base = contentDV(cfg, { type: hardest, craft });
  const per = Math.max(0, num(cfg?.content?.extraEntryDV, 2));
  const extra = per * Math.max(0, types.length - 1);
  return { dv: base + extra, base, hardest, extra, count: types.length };
}

/** Suggested sale price: blank + DV × 20, scaled down for a sloppy build. */
export function suggestedPrice({ blankPrice = 0, dv = 0 }) {
  const work = num(dv) * 20;
  return { clean: num(blankPrice) + work, sloppy: num(blankPrice) + Math.round(work * 0.4) };
}

/**
 * Who may REWRITE a shard that already exists — add a file to it, or re-roll it
 * through the Encoder. Stored per shard as `config.playerEditing`:
 *   locked     → read-only for players (hack, claim and read as ever; never write)
 *   maker      → only the character stamped in `config.playerMade` may re-open it
 *   qualified  → any character who passes the encoder gate
 * A missing / unknown value resolves by provenance: a player-made shard is the
 * maker's, everything else (every GM-made shard, every pre-existing one) is
 * locked. So a GM never has to remember to lock a shard, and no migration runs.
 */
export const SHARD_EDIT_MODES = Object.freeze({
  locked:    { label: 'Locked',    short: 'read-only', blurb: 'Players can read, hack and claim it, but never add to or rewrite it.' },
  maker:     { label: 'Maker only', short: 'its maker', blurb: 'Only the character who encoded it can re-open it in the Encoder.' },
  qualified: { label: 'Anyone who qualifies', short: 'qualified', blurb: 'Any character who passes the encoder gate can add to it.' },
});
export function resolveShardEditing(config) {
  const v = config?.playerEditing;
  if (v && Object.prototype.hasOwnProperty.call(SHARD_EDIT_MODES, v)) return v;
  return config?.playerMade?.actorId ? 'maker' : 'locked';
}

/** Content-type rows for a tile grid / the GM table, in the catalog's order. */
export function typeRows(cfg) {
  return Object.entries(cfg?.types || {}).map(([key, t]) => ({
    key, on: !!t.on, skill: t.skill || '', dv: num(t.dv), alt: t.alt || '', altDV: num(t.altDV),
    isProgram: PROGRAM_TYPES.includes(key), noRoll: !t.skill,
  }));
}
