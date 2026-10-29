/**
 * Jacking in — the rules (pure: no Foundry globals; sim-tested in dev/tools/sims/test-jack-in.mjs).
 * @file scripts/utils/jackIn.js
 * @module night-city-messenger
 *
 * A character jacks into a network node (dev/design/NETWORK-NODES.md, round 2). The GM's rules live in the world
 * setting `jackInRules`, which stores ONLY what the GM changed; `resolveJackIn(stored)` layers it over JACK_DEFAULTS
 * (objects merge, arrays replace) so a default added later reaches every world with no migration.
 *
 * Skill matters three ways, each a switch the GM can turn off:
 *   Unlocks — every action has a minimum rank; below it the action is listed, locked, with the rank it needs.
 *   Edge    — every rank above an action's minimum takes 1 off its DV, up to a cap.
 *   Moves   — how many actions a session holds, from a rank table, +1 for beating the jack-in DV by a margin.
 * A node may override the jack-in DV (node.override.dv); everything else is world-wide for now.
 */

/** The session actions, in the order the session lists them. dv null = no roll. */
export const JACK_ACTIONS = Object.freeze([
  { key: 'switch', label: 'Switch off / on', icon: 'fa-power-off', blurb: 'The network goes dark on this scene (or comes back)', dv: null, min: 1, minutes: 0, move: true },
  { key: 'jam', label: 'Jam', icon: 'fa-wave-square', blurb: 'Off for a while, then back by itself', dv: 13, min: 2, minutes: 30, move: true },
  { key: 'tap', label: 'Tap', icon: 'fa-ear-listen', blurb: 'A copy of mail sent over the network comes to you', dv: 17, min: 4, minutes: 0, move: true },
  { key: 'backdoor', label: 'Backdoor', icon: 'fa-door-open', blurb: "Skip the network's login for a day", dv: 15, min: 6, minutes: 1440, move: true },
  { key: 'insert', label: 'Insert a shard', icon: 'fa-microchip', blurb: 'Plant a network program you carry (its own DV)', dv: null, min: 3, minutes: 0, move: true },
  { key: 'sweep', label: 'System sweep', icon: 'fa-satellite-dish', blurb: 'Look for anything planted here', dv: 15, min: 1, minutes: 10, move: false },
  { key: 'wipe', label: 'Wipe your log line', icon: 'fa-eraser', blurb: 'Take your name off the node log', dv: 13, min: 1, minutes: 0, move: false },
]);

/** The actions a session can run (all of them since step 5). */
export const JACK_BUILT = Object.freeze(['switch', 'jam', 'tap', 'backdoor', 'insert', 'sweep', 'wipe']);

export const JACK_DEFAULTS = Object.freeze({
  skill: 'Interface',
  dv: 15,
  gate: { mode: 'anyone' },
  // who may jack in: 'anyone' | 'operator' (the Terminal operator access rule) | 'own' (`gate` below)
  gateFrom: 'anyone',
  resolution: 'inherit',
  dials: {
    unlocks: true,
    edge: true, edgeCap: 3,
    moves: true, movesMargin: 5,
    movesTable: [{ rank: 1, moves: 2 }, { rank: 3, moves: 3 }, { rank: 6, moves: 4 }, { rank: 9, moves: 5 }],
  },
  failure: { trace: true, severity: 'major', alert: true, maxAttempts: 3, lockoutMinutes: 60 },
  actions: Object.fromEntries(JACK_ACTIONS.map((a) => [a.key, { dv: a.dv, min: a.min, minutes: a.minutes, move: a.move, on: true }])),
  infection: { symptoms: true },
  session: { minutes: 60, returnAlert: true },
  discovery: { note: '' },
});

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
function layer(base, over) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    if (v === undefined) continue;
    out[k] = isObj(v) && isObj(base?.[k]) ? layer(base[k], v) : (Array.isArray(v) ? [...v] : v);
  }
  return out;
}
const int = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
const RES = ['inherit', 'auto', 'flagged', 'gm'];
const SEV = ['minor', 'major', 'hostile'];

/** The rules in force: the stored diff over the defaults, sanitized. Never throws. */
export function resolveJackIn(stored = {}) {
  const r = layer(JACK_DEFAULTS, isObj(stored) ? stored : {});
  r.skill = typeof r.skill === 'string' && r.skill.trim() ? r.skill.trim().slice(0, 60) : JACK_DEFAULTS.skill;
  r.dv = int(r.dv, 1, 40, JACK_DEFAULTS.dv);
  r.resolution = RES.includes(r.resolution) ? r.resolution : 'inherit';
  r.gate = isObj(r.gate) ? r.gate : { mode: 'anyone' };
  // a rule saved before the switch existed: a gated `gate` means its own rule
  if (!['anyone', 'operator', 'own'].includes(r.gateFrom)) r.gateFrom = 'anyone';
  if (r.gateFrom === 'anyone' && stored?.gateFrom === undefined && r.gate.mode === 'gated') r.gateFrom = 'own';
  r.gate = {
    mode: r.gateFrom === 'own' ? 'gated' : 'anyone',
    logic: r.gate.logic === 'all' ? 'all' : 'any',
    roles: (Array.isArray(r.gate.roles) ? r.gate.roles : []).map((x) => String(x).trim()).filter(Boolean).slice(0, 12),
    roleLogic: 'any',
    skills: (Array.isArray(r.gate.skills) ? r.gate.skills : []).map((x) => ({ name: String(x?.name || '').trim().slice(0, 60), min: int(x?.min, 0, 20, 0) })).filter((x) => x.name).slice(0, 6),
    allowGM: true,
  };
  const d = r.dials;
  d.unlocks = !!d.unlocks; d.edge = !!d.edge; d.moves = !!d.moves;
  d.edgeCap = int(d.edgeCap, 0, 10, 3);
  d.movesMargin = int(d.movesMargin, 0, 20, 5);
  d.movesTable = (Array.isArray(d.movesTable) ? d.movesTable : [])
    .map((row) => ({ rank: int(row?.rank, 0, 20, 1), moves: int(row?.moves, 1, 12, 2) }))
    .sort((a, b) => a.rank - b.rank);
  if (!d.movesTable.length) d.movesTable = JACK_DEFAULTS.dials.movesTable.map((x) => ({ ...x }));
  const f = r.failure;
  f.trace = !!f.trace; f.alert = !!f.alert;
  f.severity = SEV.includes(f.severity) ? f.severity : 'major';
  f.maxAttempts = int(f.maxAttempts, 0, 20, 3);
  f.lockoutMinutes = int(f.lockoutMinutes, 0, 1440 * 7, 60);
  r.infection = { symptoms: r.infection?.symptoms !== false };
  r.session = { minutes: int(r.session?.minutes, 0, 1440 * 7, 60), returnAlert: r.session?.returnAlert !== false };
  for (const a of JACK_ACTIONS) {
    const x = isObj(r.actions[a.key]) ? r.actions[a.key] : {};
    r.actions[a.key] = {
      dv: (x.dv === null || x.dv === '' || (x.dv === undefined && a.dv === null)) ? null : int(x.dv ?? a.dv, 1, 40, a.dv ?? 15),
      min: int(x.min, 0, 20, a.min),
      minutes: int(x.minutes, 0, 1440 * 7, a.minutes),
      move: x.move === undefined ? a.move : !!x.move,
      on: x.on === undefined ? true : !!x.on,
    };
  }
  return r;
}

/** The jack-in DV for a node: its own override, else the rules'. */
export function jackInDV(rules, node) {
  const o = Number(node?.override?.dv);
  return Number.isFinite(o) && o > 0 ? Math.round(o) : rules.dv;
}

/** Moves a session holds: from the rank table (+1 for a big margin); dial off = 3 flat. */
export function movesFor(rules, rank = 0, margin = 0) {
  const d = rules.dials;
  if (!d.moves) return 3;
  let m = d.movesTable[0].moves;
  for (const row of d.movesTable) if (rank >= row.rank) m = row.moves;
  if (d.movesMargin > 0 && margin >= d.movesMargin) m += 1;
  return m;
}

/**
 * One session action as the runner sees it.
 * @returns {{key,label,icon,blurb,on,unlocked,need,dv,baseDv,edge,minutes,move,built}}
 */
export function actionView(rules, key, rank = 0) {
  const def = JACK_ACTIONS.find((a) => a.key === key);
  if (!def) return null;
  const a = rules.actions[key];
  const unlocked = !rules.dials.unlocks || rank >= a.min;
  const edge = a.dv !== null && rules.dials.edge ? Math.min(rules.dials.edgeCap, Math.max(0, rank - a.min)) : 0;
  return {
    key, label: def.label, icon: def.icon, blurb: def.blurb,
    on: a.on, unlocked, need: unlocked ? 0 : a.min,
    baseDv: a.dv, dv: a.dv === null ? null : Math.max(1, a.dv - edge), edge,
    minutes: a.minutes, move: a.move, built: JACK_BUILT.includes(key),
  };
}

/** The layers a node's lock shows, outside in (the jack-in rings): box (if locked) · firmware · network. */
export function lockLayers(node, network = {}) {
  const out = [];
  if (node?.security?.requiresAuth) out.push({ key: 'box', label: 'Box lock', icon: 'fa-lock' });
  out.push({ key: 'firmware', label: 'Firmware', icon: 'fa-microchip' });
  out.push({ key: 'network', label: network?.name || 'Network', icon: 'fa-tower-broadcast' });
  return out;
}

/** A short line for the folded rules card. */
export function rulesSummary(rules) {
  const bits = [`${rules.skill} vs DV ${rules.dv}`];
  const on = ['unlocks', 'edge', 'moves'].filter((k) => rules.dials[k]);
  const words = { unlocks: 'rank unlocks', edge: 'rank eases DVs', moves: 'rank adds moves' };
  bits.push(on.length ? on.map((k) => words[k]).join(' · ') : 'rank has no effect');
  return bits.join(' · ');
}

/**
 * The SecurityService key for jack-in attempts: the node's NETWORK — the same lockout as that network's login, so a
 * failed jack-in counts against the login and the other way round (dev 2026-10-29).
 * @param {object|string} node — a node (its networkId), or a network id
 */
export const jackKey = (node) => (node && typeof node === 'object' ? node.networkId : node) || '';

/** Tries + lockout length for a jack-in: the network's own login settings when it has them, else the rules'. */
export function jackLock(rules, net) {
  const s = net?.security || {};
  const own = Number(s.maxAttempts) > 0;
  return {
    maxAttempts: own ? Math.round(Number(s.maxAttempts)) : rules.failure.maxAttempts,
    lockoutDuration: Number(s.lockoutDuration) > 0 ? Number(s.lockoutDuration) : rules.failure.lockoutMinutes * 60000,
    fromNetwork: own,
  };
}

/** Who decides a jack-in: the node's own choice (`node.override.resolution`), else the rules'. */
export function jackResolution(rules, node) {
  const o = node?.override?.resolution;
  return ['inherit', 'auto', 'flagged', 'gm'].includes(o) ? o : rules.resolution;
}

/**
 * May this character jack in? { ok, reason } — reads the rule the GM picked: anyone, the Terminal operator access rule,
 * or the Jacking in card's own (roles and/or skill ranks). `check` is helpers.canOperate (passed in: this module is pure).
 */
export function jackGate(rules, actor, check) {
  if (rules.gateFrom === 'operator') return check(actor, null, { label: 'Jacking in requires' });
  if (rules.gateFrom === 'own') {
    if (!rules.gate.roles.length && !rules.gate.skills.length) return { ok: true };   // gated with nothing set = inert
    return check(actor, rules.gate, { standalone: true, label: 'Jacking in requires' });
  }
  return { ok: true };
}

/** The CPR roles the card offers as quick picks. */
export const CPR_ROLES = Object.freeze(['Netrunner', 'Tech', 'Solo', 'Fixer', 'Media', 'Medtech', 'Exec', 'Lawman', 'Nomad', 'Rockerboy']);
