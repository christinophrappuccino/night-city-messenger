/**
 * COUNTERMEASURE VISIBILITY — the rules (pure: no Foundry globals).
 * @file scripts/utils/countermeasures.js
 * @module night-city-messenger
 *
 * "A layperson wouldn't know what's hidden behind it." Everyone can see that a
 * thing is LOCKED and the ways in (a password box, a skill bypass, a key item).
 * What is GUARDING it — ICE, what a failure costs, whether failures are traced,
 * how many tries you get — and, separately, the DV, are only readable by an
 * expert or by someone who scans the lock and beats it.
 *
 * Three readings of one lock:
 *   unknown     — "Security unreadable": the four facts are redacted
 *   spotted     — a scan met the scan DV: you know SOMETHING runs and that it traces
 *   identified  — an expert, or a scan that beat the DV by `identifyBy`: today's full readout
 *   open        — the world (or this object) shows everything to everyone (the old behaviour)
 *
 * World config lives in the `countermeasureVisibility` setting (sanitizeCmvConfig);
 * an object can override it (sanitizeCmvOverride) — stored on network.security /
 * account.security / shard config as `countermeasures`.
 * Mock: dev/mockups/countermeasure-visibility-mock.html.
 */

/** World modes. 'open' = everyone sees the defences (the behaviour before this existed). */
export const CMV_MODES = {
  open:    { label: 'Open',          icon: 'fa-lock-open',     blurb: 'everyone sees the defences (as before)' },
  experts: { label: 'Experts only',  icon: 'fa-user-graduate', blurb: 'qualified characters see them; nobody can scan' },
  scan:    { label: 'Scan',          icon: 'fa-satellite-dish', blurb: 'anyone can roll a scan to find out' },
  both:    { label: 'Experts + Scan', icon: 'fa-user-secret',  blurb: 'experts see them; everyone else can scan' },
};

/** Per-object visibility. */
export const CMV_VISIBILITY = {
  inherit:   { label: 'Inherit' },
  visible:   { label: 'Always visible' },
  concealed: { label: 'Concealed' },
};
/** Per-object DV display. */
export const CMV_DV = {
  inherit: { label: 'Inherit' },
  shown:   { label: 'Shown' },
  hidden:  { label: 'Hidden' },
};

/** The world default. Off ("open") so nothing changes until a GM chooses it. */
export const CMV_DEFAULTS = Object.freeze({
  mode: 'open',
  // The expert rule is the operator-gate SHAPE (helpers.canOperate, standalone).
  // An expert rule with no qualifiers names nobody (unlike an operator gate,
  // which is inert = everyone) — "nobody counts" is the safe reading here.
  expert: { roles: [], roleLogic: 'any', skills: [], itemGroups: [], logic: 'any', actors: [] },
  scan: { skills: ['Interface', 'Electronics/Security Tech'], dv: 15, identifyBy: 5, failTraced: false },
  // What a layperson cannot see (true = hidden from them).
  hide: { ice: true, iceDetail: true, attempts: true, trace: true },
  hideDV: true,
});

const num = (x, d) => { const n = Number(x); return Number.isFinite(n) ? n : d; };
const clampInt = (x, lo, hi, d) => Math.min(hi, Math.max(lo, Math.round(num(x, d))));
const str = (x) => String(x ?? '').trim();
const nameOf = (x) => (typeof x === 'string' ? x : (x?.name || ''));

/**
 * Normalise a stored world config over the defaults. Unknown mode → open,
 * skills de-duplicated, DVs clamped, every switch a boolean.
 * @param {object} [stored]
 * @returns {object}
 */
export function sanitizeCmvConfig(stored) {
  const s = (stored && typeof stored === 'object') ? stored : {};
  const d = CMV_DEFAULTS;
  const e = (s.expert && typeof s.expert === 'object') ? s.expert : {};
  const sc = (s.scan && typeof s.scan === 'object') ? s.scan : {};
  const h = (s.hide && typeof s.hide === 'object') ? s.hide : {};
  const skillList = (arr) => [...new Set((Array.isArray(arr) ? arr : []).map(nameOf).map(str).filter(Boolean))];
  return {
    mode: CMV_MODES[s.mode] ? s.mode : d.mode,
    expert: {
      roles: skillList(e.roles),
      roleLogic: e.roleLogic === 'all' ? 'all' : 'any',
      skills: (Array.isArray(e.skills) ? e.skills : [])
        .map((x) => ({ name: str(x?.name), min: clampInt(x?.min, 0, 10, 0) }))
        .filter((x) => x.name),
      itemGroups: (Array.isArray(e.itemGroups) ? e.itemGroups : [])
        .map((g) => (Array.isArray(g) ? g : [g]).map((x) => ({ name: str(nameOf(x)), img: typeof x === 'object' ? (x?.img || '') : '' })).filter((x) => x.name))
        .filter((g) => g.length),
      logic: e.logic === 'all' ? 'all' : 'any',
      actors: (Array.isArray(e.actors) ? e.actors : []).map(str).filter(Boolean),
    },
    scan: {
      skills: Array.isArray(sc.skills) ? skillList(sc.skills) : [...d.scan.skills],
      dv: clampInt(sc.dv, 1, 40, d.scan.dv),
      identifyBy: clampInt(sc.identifyBy, 0, 20, d.scan.identifyBy),
      failTraced: !!sc.failTraced,
    },
    hide: {
      ice: h.ice !== undefined ? !!h.ice : d.hide.ice,
      iceDetail: h.iceDetail !== undefined ? !!h.iceDetail : d.hide.iceDetail,
      attempts: h.attempts !== undefined ? !!h.attempts : d.hide.attempts,
      trace: h.trace !== undefined ? !!h.trace : d.hide.trace,
    },
    hideDV: s.hideDV !== undefined ? !!s.hideDV : d.hideDV,
  };
}

/**
 * Normalise a per-object override. Absent = inherit everything (no migration).
 * @param {object} [o]
 * @returns {{visibility: 'inherit'|'visible'|'concealed', scanDV: number|null, dv: 'inherit'|'shown'|'hidden'}}
 */
export function sanitizeCmvOverride(o) {
  const s = (o && typeof o === 'object') ? o : {};
  const dv = Number(s.scanDV);
  return {
    visibility: CMV_VISIBILITY[s.visibility] ? s.visibility : 'inherit',
    scanDV: (s.scanDV === '' || s.scanDV == null || !Number.isFinite(dv) || dv <= 0) ? null : clampInt(dv, 1, 40, 15),
    dv: CMV_DV[s.dv] ? s.dv : 'inherit',
  };
}

/** Does the expert rule name anybody? An empty rule = no experts. */
export function expertHasRule(expert) {
  const e = expert || {};
  return !!((e.roles?.length) || (e.skills?.length) || (e.itemGroups?.length) || (e.actors?.length));
}

/**
 * The expert rule in the operator-gate shape `canOperate(actor, gate, {standalone:true})` reads.
 * The GM escape is OFF here — the GM is handled before the gate is ever asked.
 */
export function expertGate(expert) {
  const e = expert || {};
  return {
    mode: 'gated', logic: e.logic || 'any',
    roles: e.roles || [], roleLogic: e.roleLogic || 'any',
    skill: { name: '', min: 0 }, skills: e.skills || [],
    itemGroups: e.itemGroups || [], actors: e.actors || [], allowGM: false,
  };
}

/**
 * The effective mode for one object: an object marked Concealed in an Open world
 * behaves as Experts + Scan; Always visible is Open whatever the world says.
 */
export function effectiveMode(cfg, override) {
  const o = sanitizeCmvOverride(override);
  if (o.visibility === 'visible') return 'open';
  if (o.visibility === 'concealed' && cfg.mode === 'open') return 'both';
  return cfg.mode;
}

/**
 * What can THIS viewer tell about THIS lock?
 * @param {object} worldCfg  stored or sanitized `countermeasureVisibility`
 * @param {object} [override] the object's `countermeasures` block
 * @param {object} [facts]
 * @param {boolean} [facts.isGM]
 * @param {boolean} [facts.isExpert]      canOperate against the expert gate
 * @param {string}  [facts.expertLabel]   "Netrunner" — for the credit line
 * @param {{total:number}|null} [facts.scan] this viewer's remembered scan of this object
 * @param {number}  [facts.attemptsUsed]  failures so far (a failure tells you the attempts exist)
 * @returns {{state:'open'|'unknown'|'spotted'|'identified', mode:string, showDV:boolean,
 *   canScan:boolean, scanned:boolean, scanFailed:boolean, scanDV:number, scanSkills:string[],
 *   identifyBy:number, failTraced:boolean, credit:string, show:{ice:boolean, iceDetail:boolean, attempts:boolean, attemptsCount:boolean, trace:boolean, failure:boolean}}}
 */
export function resolveCountermeasures(worldCfg, override, facts = {}) {
  const cfg = sanitizeCmvConfig(worldCfg);
  const o = sanitizeCmvOverride(override);
  const mode = effectiveMode(cfg, o);
  const scanDV = o.scanDV ?? cfg.scan.dv;
  const canScanMode = mode === 'scan' || mode === 'both';
  const expertMode = mode === 'experts' || mode === 'both';
  const base = {
    mode, scanDV, scanSkills: cfg.scan.skills.slice(), identifyBy: cfg.scan.identifyBy,
    failTraced: cfg.scan.failTraced, scanned: false, scanFailed: false, canScan: false, credit: '',
  };
  const all = { ice: true, iceDetail: true, attempts: true, attemptsCount: true, trace: true, failure: true };
  const dvFor = (layperson) => {
    if (o.dv === 'shown') return true;
    if (o.dv === 'hidden') return !!facts.isGM;
    return layperson ? !cfg.hideDV : true;
  };

  if (facts.isGM) return { ...base, state: 'identified', credit: 'GM', showDV: true, show: all };
  if (mode === 'open') return { ...base, state: 'open', showDV: dvFor(false), show: all };
  if (expertMode && facts.isExpert) {
    return { ...base, state: 'identified', credit: facts.expertLabel ? `Identified · ${facts.expertLabel}` : 'Identified · expert', showDV: dvFor(false), show: all };
  }

  const scan = facts.scan && Number.isFinite(Number(facts.scan.total)) ? Number(facts.scan.total) : null;
  const usedOne = (Number(facts.attemptsUsed) || 0) > 0;
  const lay = {
    ice: !cfg.hide.ice, iceDetail: !cfg.hide.iceDetail,
    attempts: !cfg.hide.attempts || usedOne, attemptsCount: !cfg.hide.attempts || usedOne,
    trace: !cfg.hide.trace, failure: !cfg.hide.iceDetail,
  };
  if (canScanMode && scan != null) {
    const margin = scan - scanDV;
    if (margin >= cfg.scan.identifyBy) {
      return { ...base, state: 'identified', scanned: true, credit: 'Identified · your scan', showDV: dvFor(false), show: all };
    }
    if (margin >= 0) {
      return {
        ...base, state: 'spotted', scanned: true, showDV: dvFor(true),
        show: { ...lay, ice: true, attempts: true, trace: true },
      };
    }
    return { ...base, state: 'unknown', scanned: true, scanFailed: true, showDV: dvFor(true), show: lay };
  }
  return { ...base, state: 'unknown', canScan: canScanMode && cfg.scan.skills.length > 0, showDV: dvFor(true), show: lay };
}

/**
 * The four-cell readout (ICE · On failure · Trace · Attempts) for a resolved view.
 * A cell the viewer cannot know comes back `{known:false}` — the template draws
 * a redaction bar, and the real value is NEVER in the DOM.
 * @param {object} view      resolveCountermeasures(...)
 * @param {object} lock
 * @param {boolean} lock.icePresent
 * @param {string}  [lock.iceName]
 * @param {string}  [lock.formula]     "3d6" when a failure deals damage
 * @param {string}  [lock.failureMode] 'damage' | 'lockout' | 'permanent' | 'nothing'
 * @param {boolean} [lock.traced]
 * @param {number}  [lock.maxAttempts]
 */
export function cmvReadout(view, lock = {}) {
  const s = view.show || {};
  const spotted = view.state === 'spotted';
  const redact = (w) => ({ known: false, w });
  const ice = s.iceDetail
    ? { known: true, text: lock.icePresent ? (lock.iceName || 'ICE') : 'None' }
    : (s.ice ? { known: true, text: lock.icePresent ? 'Running' : 'None', sub: lock.icePresent ? 'type ?' : '' } : redact(74));
  const failText = lock.failureMode === 'damage' && lock.formula ? `${lock.formula} to HP`
    : lock.failureMode === 'permanent' ? 'Locks for good'
      : lock.failureMode === 'nothing' ? 'Nothing' : 'Lockout';
  const failure = s.failure ? { known: true, text: failText } : redact(56);
  const trace = s.trace ? { known: true, text: lock.traced ? 'Yes' : 'No' } : redact(38);
  const max = Number(lock.maxAttempts) || 0;
  let attempts;
  if (s.attemptsCount && max) attempts = { known: true, text: String(max) };
  else if (s.attempts || spotted) attempts = { known: true, text: max ? 'Limited' : 'Unlimited', sub: max ? 'count ?' : '' };
  else attempts = redact(22);
  return [
    { key: 'ice', icon: 'fa-shield-halved', label: 'ICE', ...ice },
    { key: 'fail', icon: 'fa-skull', label: 'On failure', ...failure },
    { key: 'trace', icon: 'fa-satellite-dish', label: 'Trace', ...trace },
    { key: 'att', icon: 'fa-lock', label: 'Attempts', ...attempts },
  ];
}

/** One plain sentence for the admin card's "Right now…" line. */
export function cmvSummary(worldCfg, expertParts = []) {
  const c = sanitizeCmvConfig(worldCfg);
  if (c.mode === 'open') return 'Everyone sees every defence — ICE, damage, traces, attempts and the DV — exactly as before. Objects can still be marked Concealed.';
  const who = expertParts.length ? expertParts.join(', ') : '';
  const expertLine = (c.mode === 'experts' || c.mode === 'both')
    ? (who ? `${who} see every defence. ` : 'No expert rule is set, so nobody qualifies as an expert. ')
    : '';
  const scanLine = (c.mode === 'scan' || c.mode === 'both')
    ? (c.scan.skills.length
      ? `Everyone else sees "Security unreadable" and can scan (${c.scan.skills.join(' or ')} vs DV ${c.scan.dv}${c.hideDV ? '; the DV itself stays hidden' : ''}).`
      : 'Scanning is on but no scan skill is set, so nobody can scan.')
    : `Everyone else sees "Security unreadable"${c.hideDV ? ' and no DV' : ''}.`;
  return `${expertLine}${scanLine} The GM always sees everything.`;
}

/** The short summary chip on the folded rule card ("Experts + scan · DV hidden"). */
export function cmvChip(worldCfg) {
  const c = sanitizeCmvConfig(worldCfg);
  if (c.mode === 'open') return { text: 'Open', off: true };
  return { text: CMV_MODES[c.mode].label, dvHidden: c.hideDV };
}

// ── session scan memory ─────────────────────────────────────────────
// A scan is remembered per actor + object for the rest of the session, on THIS
// client only (deliberately not persisted: "one try" per sitting, and a reload
// forgets — a world write per scan would be a GM relay for flavour).
const SCAN_MEMORY = new Map();
const scanKey = (actorId, objectKey) => `${actorId || '?'}::${objectKey || '?'}`;
export function rememberScan(actorId, objectKey, total) {
  SCAN_MEMORY.set(scanKey(actorId, objectKey), { total: Number(total) || 0, at: Date.now() });
}
export function recallScan(actorId, objectKey) { return SCAN_MEMORY.get(scanKey(actorId, objectKey)) || null; }
export function forgetScans() { SCAN_MEMORY.clear(); }
